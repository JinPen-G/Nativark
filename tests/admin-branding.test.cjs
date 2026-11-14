// Offline image/source/DOM-adapter checks only. No browser, real fetch or tenant API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, overrides = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => Object.hasOwn(overrides, id) ? overrides[id] : require(id), module, module.exports);
  return module.exports;
}
const canonical = read('apps/admin/public/brand/nativark-icon.svg');
const icons = load('apps/admin/src/app/brandIcon.ts', {
  '../../public/brand/nativark-icon.svg?raw': canonical,
});
const brand = load('apps/admin/src/app/branding.ts');
const tenant = { brandLogoUrl: '/uploads/tenant.svg', faviconUrl: '/uploads/not-the-logo.png' };
const member = { isSaasAdmin: false };
for (const resolve of [brand.resolveAdminMark, brand.resolveAdminFavicon]) {
  assert.equal(resolve(tenant, member), tenant.brandLogoUrl);
  assert.equal(resolve({ faviconUrl: tenant.faviconUrl }, member), brand.ADMIN_DEFAULT_MARK);
  assert.equal(resolve(tenant, { isSaasAdmin: true }), brand.ADMIN_DEFAULT_MARK);
  assert.equal(resolve(tenant, undefined), brand.ADMIN_DEFAULT_MARK);
}
const decode = value => decodeURIComponent(value.split(',').slice(1).join(','));
// The approved mark uses masked rectangles and dots, so path-only comparison
// would accept two empty arrays and miss a changed overlap or missing page.
const geometry = svg => [...svg.matchAll(/<(path|rect|circle|ellipse|line|polyline|polygon|g|mask)\b([^>]*)>/g)].map(match => [
  match[1],
  [...match[2].matchAll(/\b(id|d|x|y|cx|cy|width|height|rx|ry|r|points|transform|mask|maskUnits|maskContentUnits|stroke-width|stroke-linejoin)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]),
]);
const masks = svg => svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
assert.ok(geometry(canonical).length > 0, 'the default artwork comparison must include actual shapes');
assert.equal((canonical.match(/<mask\b/g) ?? []).length, 3);
assert.equal((canonical.match(/<circle\b/g) ?? []).length, 2);
const bootstrap = read('apps/admin/public/brand/nativark-favicon.svg');
assert.deepEqual(geometry(bootstrap), geometry(canonical), 'bootstrap must use the provided icon artwork, not a redraw');
assert.equal(masks(bootstrap), masks(canonical), 'favicon recoloring cannot change the page masks');
assert.match(bootstrap, /prefers-color-scheme:dark/);
assert.match(bootstrap, /(?:fill|stroke)="currentColor"/);
assert.match(read('apps/admin/index.html'), /href="\/brand\/nativark-favicon.svg"/);
const wordmark = read('apps/admin/public/brand/nativark-logo-mono.svg');
assert.deepEqual(geometry(wordmark), geometry(canonical), 'the login wordmark must embed the same mark');
assert.equal(masks(wordmark), masks(canonical));
assert.match(wordmark, />Nativark<\/text>/);
for (const dark of [false, true]) {
  const svg = decode(icons.defaultAdminBrandIcon(dark));
  assert.deepEqual(geometry(svg), geometry(canonical));
  assert.equal(masks(svg), masks(canonical), 'root contrast cannot invert or flatten the black/white masks');
  assert.match(svg, new RegExp(`color="${dark ? '#ffffff' : '#000000'}"`));
}
for (const url of ['/uploads/logo.svg?signature=x', 'https://brand.invalid/logo.png', 'data:image/svg+xml,%3Csvg%3E', 'data:image/png;base64,AA==']) assert.equal(icons.safeBrandIconUrl(url), url);
for (const url of ['javascript:alert(1)', 'data:text/html,<svg>', 'file:///C:/logo.svg', 'vbscript:a', 'https://a\n.invalid/logo.png', '']) assert.equal(icons.safeBrandIconUrl(url), undefined);
assert.equal(icons.isSvgBrandIcon('/logo.SVG?version=2'), true);
assert.equal(icons.isSvgBrandIcon('/logo.png?name=x.svg.other'), false);
const mono = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="black" d="M0 0h10v10z"/></svg>';
for (const dark of [false, true]) {
  const converted = decode(icons.adaptMonochromeBrandSvg(mono, dark));
  assert.match(converted, new RegExp(`fill="${dark ? '#ffffff' : '#000000'}"`));
  assert.deepEqual(geometry(converted), geometry(mono));
}
const stroke = '<svg viewBox="0 0 24 24" fill="none"><path stroke="#fff" d="M1 1L5 5"/></svg>';
assert.match(decode(icons.adaptMonochromeBrandSvg(stroke, false)), /fill="none"/);
assert.match(decode(icons.adaptMonochromeBrandSvg(stroke, false)), /stroke="#000000"/);
for (const svg of [
  '<svg><path fill="red"/></svg>', '<svg><rect fill="white"/><path fill="black"/></svg>',
  '<svg><rect fill="white"/><path d="M1 1L2 2"/></svg>',
  '<svg><style>@media(prefers-color-scheme:dark){path{fill:white}}</style><path/></svg>',
  '<svg><script>alert(1)</script></svg>', '<svg onload="alert(1)"><path/></svg>',
  '<svg><image href="https://brand.invalid/a"/></svg>', '<svg><path fill="url(#gradient)"/></svg>',
  '<svg><foreignObject/></svg>', '<!DOCTYPE svg><svg></svg>', '<svg><path style="fill:black"/></svg>',
  'not svg', '<svg>' + ' '.repeat(512 * 1024) + '</svg>',
]) assert.equal(icons.adaptMonochromeBrandSvg(svg, true), undefined, 'unsafe/complex/multicolor artwork must not be flattened or injected');

// Favicon reflects the shared source; PNG must not keep the old SVG MIME hint.
const listeners = new Set();
const link = { href: '', type: '', getAttribute: name => link[name], addEventListener: (_event, callback) => listeners.add(callback), removeEventListener: (_event, callback) => listeners.delete(callback) };
global.document = { querySelector: () => link };
let failures = 0;
const cleanup = brand.applyAdminFavicon('/logo.svg', () => failures++);
assert.equal(link.type, 'image/svg+xml');
const pngCleanup = brand.applyAdminFavicon('/logo.png', () => failures += 10);
assert.equal(link.type, '');
for (const fail of listeners) fail();
assert.equal(failures, 10, 'an old asset error must not invalidate the current icon');
cleanup(); pngCleanup();
assert.equal(listeners.size, 0);
delete global.document;

const provider = read('apps/admin/src/app/BrandIconProvider.tsx');
assert.match(provider, /user\?\.id, user\?\.isSaasAdmin, tenant\?\.tenantId, source/);
assert.match(provider, /if \(!controller.signal.aborted\) setInspection\(\{ scope, svg \}\)/);
assert.match(provider, /inspection\?\.scope === scope/);
assert.match(provider, /failedScope === scope \? fallback/);
assert.match(provider, /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
assert.match(provider, /faviconFailedScope === scope \? defaultAdminBrandIcon\(browserDark\) : source/);
assert.match(provider, /applyAdminFavicon\(favicon, \(\) => \{\s*if \(source !== ADMIN_DEFAULT_MARK\) setFaviconFailedScope\(scope\);/);
assert.doesNotMatch(provider, /applyAdminFavicon\(icon\.src, icon\.onError\)/, 'favicon failure must remain independent of the sidebar icon');
assert.match(read('apps/admin/src/components/WorkspaceSwitcher.tsx'), /src=\{brandIcon.src\}[^>]*onError=\{brandIcon.onError\}/);
assert.doesNotMatch(provider, /innerHTML|rentalCoreApi|Authorization/);
assert.match(read('apps/admin/src/app/App.tsx'), /<BrandIconProvider><RouterProvider router=\{router\} \/><\/BrandIconProvider>/);

async function checkImageRead() {
  const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return new Response(mono, { headers: { 'content-type': 'image/svg+xml' } }); };
  const signal = new AbortController().signal;
  assert.equal(await icons.readBrandSvg('/logo.svg', signal), mono);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.signal, signal);
  assert.equal(await icons.readBrandSvg('/logo.png', signal), undefined);
  assert.equal(await icons.readBrandSvg('javascript:a', signal), undefined);
  assert.equal(calls.length, 1, 'ordinary images are not fetched for SVG inspection');
  global.fetch = async () => new Response('oversized', { headers: { 'content-length': String(512 * 1024 + 1) } });
  assert.equal(await icons.readBrandSvg('/large.svg', signal), undefined);
  global.fetch = async () => new Response('x'.repeat(512 * 1024 + 1));
  assert.equal(await icons.readBrandSvg('/chunked.svg', signal), undefined, 'missing Content-Length must not bypass the inspection byte cap');
  delete global.fetch;
}
checkImageRead().then(() => console.log('PASS shared tenant-brand priority, SVG artwork/theme/classification, favicon lifecycle and bounded offline image inspection')).catch(error => { console.error(error); process.exitCode = 1; });
