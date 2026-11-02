const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function compile(file, globals) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(output, { exports, URL, Headers, Response, Map, Set, Promise, JSON, crypto: require('node:crypto').webcrypto, ...globals }, { filename: file });
  return exports;
}
const source = 'packages/web-client/src/session.ts';
const session = token => ({ apiVersion: 'v1', accessToken: token, refreshToken: token, expiresIn: 60, customer: { customerId: 'p1', displayName: 'Person', customerType: 'personal' }, workspaces: [], workspace: { workspaceCode: 'camera' } });
const response = value => new Response(JSON.stringify(value));
function environment() {
  const map = new Map(), locks = new Map();
  const localStorage = { getItem: key => map.get(key) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const navigator = { locks: { request: (name, fn) => { const result = (locks.get(name) ?? Promise.resolve()).then(fn); locks.set(name, result.catch(() => {})); return result; } } };
  return { map, localStorage, navigator, window: { addEventListener() {}, location: { href: 'https://shop.example/demo/enterprise', origin: 'https://shop.example' } } };
}
async function login(api, token = 'old') { await api.customerLogin('demo', '/api/client/v1', '/auth/login', { token, tenantCode: 'demo', loginIdentifier: 'synthetic', password: 'synthetic' }); }
function publicLogin(url, init) { if (url.endsWith('/auth/login')) return response(session(JSON.parse(init.body).token)); }
function deferred() { let resolve; return { promise: new Promise(r => resolve = r), resolve: value => resolve(value) }; }
test('relative and same-origin absolute API bases share the actual named lock', async () => {
  const env = environment(); let rotations = 0;
  const fetch = async (url, init) => {
    const logged = publicLogin(url, init); if (logged) return logged;
    if (url.endsWith('/auth/refresh')) { rotations++; await Promise.resolve(); return response(session('new')); }
    return new Response('{}', { status: init.headers.get('Authorization') === 'Bearer old' ? 401 : 200 });
  };
  const first = compile(source, { ...env, fetch }), second = compile(source, { ...env, fetch });
  await login(first);
  const responses = await Promise.all([first.customerFetch('demo', '/api/client/v1', '/enterprise/entry'), second.customerFetch('demo', 'https://shop.example/api/client/v1/', '/enterprise/entry')]);
  assert.equal(rotations, 1); assert.ok(responses.every(r => r.status === 200));
});
test('logout waits for refresh and revokes its real successor, not the consumed token', async () => {
  const env = environment(), sent = deferred(), finish = deferred(), active = new Set();
  const fetch = async (url, init) => {
    const logged = publicLogin(url, init); if (logged) { active.add('old'); return logged; }
    if (url.endsWith('/auth/refresh')) { active.delete('old'); active.add('new'); sent.resolve(); await finish.promise; return response(session('new')); }
    if (url.endsWith('/auth/logout')) { const token = JSON.parse(init.body).refreshToken; assert.equal(token, 'new'); active.delete(token); return response({ success: true }); }
    throw new Error('Unexpected request');
  };
  const first = compile(source, { ...env, fetch }), second = compile(source, { ...env, fetch });
  await login(first);
  const pending = first.refreshCustomerSession('demo', '/api/client/v1', first.loadCustomerSession('demo'));
  await sent.promise;
  const logout = second.logoutCustomerSession('demo', '/api/client/v1');
  finish.resolve(); await pending; await logout;
  assert.equal(active.size, 0); assert.equal(first.loadCustomerSession('demo'), null);
});
test('a new login queued during response parsing owns the final session', async () => {
  const env = environment(), parsing = deferred(), finish = deferred();
  const fetch = async (url, init) => {
    const logged = publicLogin(url, init); if (logged) return logged;
    return { status: 200, ok: true, json: async () => { parsing.resolve(); await finish.promise; return session('refreshed'); } };
  };
  const first = compile(source, { ...env, fetch }), second = compile(source, { ...env, fetch });
  await login(first);
  const pending = first.refreshCustomerSession('demo', '/api/client/v1', first.loadCustomerSession('demo'));
  await parsing.promise;
  const replacement = login(second, 'replacement');
  finish.resolve(); await pending; await replacement;
  assert.equal(first.loadCustomerSession('demo').accessToken, 'replacement');
});
test('logout queued behind a different login does not revoke the new identity', async () => {
  const env = environment(), sent = deferred(), finish = deferred(); let logouts = 0;
  const fetch = async (url, init) => {
    if (url.endsWith('/auth/logout')) { logouts++; return response({ success: true }); }
    const token = JSON.parse(init.body).token;
    if (token === 'replacement') { sent.resolve(); await finish.promise; }
    return response(session(token));
  };
  const first = compile(source, { ...env, fetch }), second = compile(source, { ...env, fetch });
  await login(first);
  const replacement = login(first, 'replacement'); await sent.promise;
  const logout = second.logoutCustomerSession('demo', '/api/client/v1');
  finish.resolve(); await replacement; await assert.rejects(logout);
  assert.equal(logouts, 0); assert.equal(first.loadCustomerSession('demo').accessToken, 'replacement');
});
test('unknown refresh is not repeated and local logout does not claim successor revocation', async () => {
  const env = environment(); let rotations = 0;
  const fetch = async (url, init) => {
    const logged = publicLogin(url, init); if (logged) return logged;
    if (url.endsWith('/auth/logout')) return response({ success: true });
    rotations++; throw new Error('network');
  };
  const api = compile(source, { ...env, fetch }); await login(api);
  const original = api.loadCustomerSession('demo');
  await assert.rejects(api.refreshCustomerSession('demo', '/api/client/v1', original));
  await assert.rejects(api.refreshCustomerSession('demo', '/api/client/v1', original));
  assert.equal(rotations, 1);
  await assert.rejects(api.logoutCustomerSession('demo', '/api/client/v1'), error => error.code === 'logout_unknown');
  assert.equal(api.loadCustomerSession('demo'), null);
  await assert.rejects(api.logoutCustomerSession('demo', '/api/client/v1'), error => error.code === 'logout_unknown');
});
test('workspace change is serialized and a late old-owner read is discarded', async () => {
  const env = environment(), sent = deferred(), finish = deferred();
  const fetch = async (url, init) => {
    const logged = publicLogin(url, init); if (logged) return logged;
    if (url.endsWith('/auth/switch-workspace')) return response({ ...session('switched'), workspace: { workspaceCode: 'camping' } });
    sent.resolve(); await finish.promise; return response({});
  };
  const api = compile(source, { ...env, fetch }); await login(api);
  const read = api.customerFetch('demo', '/api/client/v1', '/orders'); await sent.promise;
  await api.switchCustomerWorkspace('demo', '/api/client/v1', 'camping'); finish.resolve();
  await assert.rejects(read); assert.equal(api.loadCustomerSession('demo').workspace.workspaceCode, 'camping');
});
test('writes do not refresh or retry; unsupported locks and cross-origin credentials refuse', async () => {
  const env = environment(); let calls = 0;
  const fetch = async (url, init) => { const logged = publicLogin(url, init); if (logged) return logged; calls++; return new Response('{}', { status: 401 }); };
  const api = compile(source, { ...env, fetch }); await login(api);
  assert.equal((await api.customerFetch('demo', '/api/client/v1', '/orders', { method: 'POST' })).status, 401);
  assert.equal(calls, 1);
  const unsafe = compile(source, { ...env, navigator: {}, fetch });
  await assert.rejects(unsafe.refreshCustomerSession('demo', '/api/client/v1', session('old')));
  await assert.rejects(unsafe.customerLogin('demo', '/api/client/v1', '/auth/login', {}));
  await assert.rejects(api.customerFetch('demo', 'https://other.example/api/client/v1', '/orders'));
  assert.equal(calls, 1);
});
test('invitation fragment survives same-tab login without appearing in the safe return URL or another merchant', () => {
  const routes = compile('packages/web-client/src/enterprise-entry.ts', {}), values = new Map(), code = 'A'.repeat(43);
  const location = { pathname: '/demo/enterprise/join', hash: `#invite=${code}` };
  let scrubbed;
  const history = { replaceState: (_state, _unused, path) => { scrubbed = path; location.hash = ''; } };
  const sessionStorage = { setItem: (key, value) => values.set(key, value), getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  const api = compile('packages/web-client/src/enterprise-invite.ts', { window: { location, history }, URLSearchParams, sessionStorage, require: () => routes });
  api.captureEnterpriseInvite(); assert.equal(scrubbed, '/demo/enterprise/join'); assert.equal(location.hash, '');
  assert.equal(api.readEnterpriseInvite('/demo/enterprise'), code); assert.equal(api.readEnterpriseInvite('/other/enterprise'), null);
  assert.equal(routes.safeCustomerReturn(scrubbed, 'demo', false), scrubbed); assert.equal(scrubbed.includes(code), false);
  api.clearEnterpriseInvite('/demo/enterprise'); assert.equal(api.readEnterpriseInvite('/demo/enterprise'), null);
  location.pathname = '/demo/enterprise/orders'; location.hash = `#invite=${code}`; api.captureEnterpriseInvite(); assert.equal(values.size, 0);
  location.pathname = '/demo/enterprise/join'; sessionStorage.setItem = () => { throw new Error('storage denied'); };
  assert.throws(() => api.captureEnterpriseInvite()); assert.equal(location.hash, '', 'raw code scrubbed even when storage fails');
});

test('registered paths and safe return refuse tenant switches and external URLs', () => {
  const api = compile('packages/web-client/src/enterprise-entry.ts', {});
  assert.equal(api.parseEnterpriseRoute('/demo/enterprise/members').tenantCode, 'demo');
  assert.equal(api.parseEnterpriseRoute('/enterprise').boundDomain, true);
  assert.equal(api.safeCustomerReturn('/other/enterprise', 'demo', false), null);
  assert.equal(api.safeCustomerReturn('//evil.example', 'demo', false), null);
  assert.equal(api.safeCustomerReturn('/demo/enterprise?token=secret', 'demo', false), null);
  assert.equal(api.safeCustomerReturn('/demo/enterprise', 'demo', false), '/demo/enterprise');
});
