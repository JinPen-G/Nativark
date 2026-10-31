'use strict';
// Real editor lifecycle and source, no DOM, HTTP, provider, keys or database.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
function load(name) {
  const filename = path.resolve(__dirname, '../apps/admin/src/features/ai-native', name);
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = request => request === './settings-operation-reference' ? load('settings-operation-reference.ts') : originalRequire(request);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const { ModelSettingsSession } = load('model-settings-session.ts');
const { PlatformModelSettingsSession } = load('platform-model-settings-session.ts');
function storage() {
  const values = new Map(); return { values, failWrite: false, failRead: false, failClear: false, discardWrite: false,
    getItem(key) { if (this.failRead) throw Error('storage read unavailable'); return values.get(key) ?? null; },
    setItem(key, value) { if (this.failWrite) throw Error('quota exceeded'); if (!this.discardWrite) values.set(key, value); },
    removeItem(key) { if (this.failClear) throw Error('clear unavailable'); values.delete(key); } };
}
function harness(kind, store) {
  let writes = 0, keys = 0, unknown = false, lostRead = false;
  const current = { value: true }, key = 'fixture-settings-journal';
  const tenant = { draftVersion: 'ain-c07-draft-2', tenantId: 'tenant-a', configId: 'tenant-a', configRevision: 1,
    enabled: true, connectionState: 'not_tested', mode: 'platform_managed', serviceName: 'Rental OS AI', routing: 'automatic', availability: 'unavailable' };
  const platform = { profileId: 'profile-a', revision: 1, enabled: true, credentialConfigured: true,
    mode: 'platform_managed', protocol: 'synthetic', model: 'model-a', allowedCapabilities: [],
    verification: 'not_assessed_by_configuration_read', observation: 'current_configuration_not_write_receipt' };
  let received;
  const ports = { read: async () => { if (lostRead) throw Error('current read unavailable'); return kind === 'tenant' ? tenant : platform; },
    legacy: async () => ({ state: 'not_recorded', source: null, currentConfiguration: 'present', automaticImport: false, sourcePreserved: true, execution: 'not_granted' }),
    save: async (...args) => { writes++; received = args.at(-1); if (unknown) throw Error('response lost'); return kind === 'tenant'
      ? { ...tenant, configRevision: 2 } : { profileId: 'profile-a', revision: 2, enabled: true, credentialConfigured: true }; },
    operation: async (...args) => ({ operationKey: args.at(-1), automaticRetry: false, execution: 'not_granted', observation: 'original_configuration_save',
      state: 'recorded', expectedRevision: 1, resultRevision: 2, recordedAt: '2026-10-30T10:00:00Z',
      result: kind === 'tenant' ? { ...tenant, configRevision: 2 } : { profileId: 'profile-a', revision: 2, enabled: true, credentialConfigured: true } }) };
  const create = () => kind === 'tenant' ? new ModelSettingsSession('tenant-a', ports, () => current.value, () => `op-${++keys}`, store, key)
    : new PlatformModelSettingsSession('profile-a', ports, () => current.value, () => true, () => `op-${++keys}`, store, key);
  const command = () => kind === 'tenant' ? { configId: 'tenant-a', expectedRevision: 1, mode: 'platform_managed', enabled: true }
    : { expectedRevision: 1, protocol: 'synthetic', model: 'model-a', enabled: true, secretChange: { operation: 'replace', apiKey: 'fixture-private-key' } };
  return { create, command, key, current, get writes() { return writes; }, get received() { return received; },
    unknown(value) { unknown = value; }, failRead(value) { lostRead = value; } };
}
for (const kind of ['tenant', 'platform']) {
  test(`${kind}: no save is dispatched unless the original non-secret reference is stored and read back`, async () => {
    for (const failure of ['absent', 'write', 'discard', 'read', 'corrupt']) {
      const s = failure === 'absent' ? undefined : storage();
      if (failure === 'read') s.failRead = true;
      if (failure === 'corrupt') s.values.set('fixture-settings-journal', '{"secret":"must-not-overwrite"}');
      const h = harness(kind, s), editor = h.create(); await editor.load();
      if (failure === 'write') s.failWrite = true;
      if (failure === 'discard') s.discardWrite = true;
      await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 0);
      assert.equal(editor.snapshot().feedback, 'reference_unavailable');
      await editor.load(); await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 0);
    }
  });
  test(`${kind}: unknown survives reopening and current read cannot erase it or produce another key`, async () => {
    const s = storage(), h = harness(kind, s), editor = h.create(); await editor.load(); h.unknown(true);
    await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 1);
    const pending = structuredClone(editor.snapshot().pending); assert.ok(pending);
    const raw = s.getItem(h.key); assert.equal(raw.includes('fixture-private-key'), false); assert.equal(raw.includes('apiKey'), false);
    const reopened = h.create(); assert.deepEqual(reopened.snapshot().pending, pending);
    await reopened.load(); await assert.rejects(reopened.save(h.command())); assert.equal(h.writes, 1);
    await reopened.reconcile(); assert.equal(reopened.snapshot().pending, null); assert.equal(reopened.snapshot().feedback, 'recorded');
    assert.equal(reopened.snapshot().summary, null); assert.equal(s.getItem(h.key), null); assert.equal(h.writes, 1);
  });
  test(`${kind}: failed journal removal retains the original key until its receipt and cleanup are both observed`, async () => {
    const s = storage(), h = harness(kind, s), editor = h.create(); await editor.load(); s.failClear = true;
    await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 1); assert.ok(editor.snapshot().pending);
    await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 1);
    await editor.reconcile(); assert.ok(editor.snapshot().pending); assert.equal(h.writes, 1);
    s.failClear = false; await editor.reconcile(); assert.equal(editor.snapshot().pending, null); assert.equal(h.writes, 1);
  });
  test(`${kind}: editor cannot overwrite or remove another editor's retained operation`, async () => {
    const s = storage(), h = harness(kind, s), editor = h.create(); await editor.load();
    const other = JSON.stringify(kind === 'tenant' ? { operationKey: 'other-op', expectedRevision: 1, mode: 'platform_managed' }
      : { operationKey: 'other-op', expectedRevision: 1 }); s.setItem(h.key, other);
    await assert.rejects(editor.save(h.command())); assert.equal(h.writes, 0); assert.equal(s.getItem(h.key), other);
    const activeStore = storage(), active = harness(kind, activeStore), saving = active.create(); await saving.load();
    const priorRemove = activeStore.removeItem;
    activeStore.removeItem = function(key) { assert.notEqual(this.getItem(key), other); return priorRemove.call(this, key); };
    // A readback of a different reference after the API returned must neither
    // clear that reference nor mark the old operation ready for another save.
    const priorGet = activeStore.getItem; let reads = 0;
    activeStore.getItem = function(key) { if (++reads === 3) this.values.set(key, other); return priorGet.call(this, key); };
    await assert.rejects(saving.save(active.command())); assert.equal(active.writes, 1);
    assert.ok(saving.snapshot().pending); assert.equal(activeStore.getItem(active.key), other);
  });
}
