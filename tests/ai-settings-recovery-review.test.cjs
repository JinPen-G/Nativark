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
// Execute the page's reference adapters without rendering a synthetic host.
// Only the named, unmodified source functions enter this existing Node harness.
function creditAdapters() {
  const filename = path.resolve(__dirname, '../apps/admin/src/features/ai-native/AiCreditSettings.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const names = new Set(['referenceStorage', 'savedPending', 'savedAllocation', 'savedDecision']);
  const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text));
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = request => request === './credit-operation-reference' ? load('credit-operation-reference.ts') : module.require(request);
  const helper = fs.existsSync(path.join(path.dirname(filename), 'credit-operation-reference.ts'))
    ? "const { readCreditOperationReference } = require('./credit-operation-reference');\n" : '';
  const code = helper + functions.map(node => node.getText(source)).join('\n') + '\nmodule.exports = {'
    + functions.map(node => node.name.text).join(',') + '};';
  mod._compile(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
test('credit: corrupt or unavailable original references never become an empty writable journal', () => {
  const adapters = creditAdapters(), previous = globalThis.window;
  try {
    for (const failure of ['corrupt', 'read', 'getter']) {
      const s = storage(); if (failure === 'corrupt') s.setItem('credit', '{invalid');
      if (failure === 'read') s.failRead = true;
      globalThis.window = failure === 'getter' ? Object.defineProperty({}, 'sessionStorage', { get() { throw Error('blocked storage getter'); } }) : { sessionStorage: s };
      assert.equal(adapters.savedPending('credit')?.blocked, true);
      assert.equal(adapters.savedAllocation('credit')?.blocked, true);
    }
    const s = storage(); globalThis.window = { sessionStorage: s };
    s.setItem('credit', JSON.stringify({ operationKey: 'original-request', currency: 'USD', amount: '1.000001' }));
    assert.equal(adapters.savedPending('credit').reference.operationKey, 'original-request');
    const legacy = { operationKey: 'original-allocation', currency: 'USD', expectedRevision: 7,
      allocations: Array.from({ length: 64 }, (_, index) => ({ workspaceId: `workspace-${index}-${'a'.repeat(100)}`, amount: '1.000001' })) };
    s.setItem('credit', JSON.stringify(legacy)); assert.ok(s.getItem('credit').length > 1024);
    const allocation = adapters.savedAllocation('credit'); assert.equal(allocation.blocked, false);
    assert.deepEqual(allocation.reference, { operationKey: legacy.operationKey, currency: 'USD', expectedRevision: 7 });
    assert.equal(allocation.marker, JSON.stringify(legacy)); assert.equal(s.getItem('credit'), allocation.marker);
    s.setItem('decision', 'original-legacy-decision');
    assert.deepEqual(adapters.savedDecision('decision', 'request-a').reference, { requestId: 'request-a', operationKey: 'original-legacy-decision' });
  } finally { globalThis.window = previous; }
});

test('credit: verified non-secret locators survive unknown and cannot clear another editor or silently lost storage', () => {
  const { readCreditOperationReference, retainCreditOperationReference, clearCreditOperationReference } = load('credit-operation-reference.ts');
  const references = [{ operationKey: 'original-request', currency: 'USD', amount: '1.000001' },
    { operationKey: 'original-allocation', currency: 'USD', expectedRevision: 7 }, { requestId: 'request-a', operationKey: 'original-decision' }];
  for (const reference of references) {
    for (const failure of ['absent', 'write', 'discard', 'read', 'existing']) {
      const s = failure === 'absent' ? undefined : storage();
      if (failure === 'write') s.failWrite = true;
      if (failure === 'discard') s.discardWrite = true;
      if (failure === 'read') s.failRead = true;
      if (failure === 'existing') s.setItem('credit', 'another-editor-marker');
      let sends = 0;
      assert.throws(() => { retainCreditOperationReference(s, 'credit', reference); sends++; });
      assert.equal(sends, 0); if (failure === 'existing') assert.equal(s.getItem('credit'), 'another-editor-marker');
    }
    const s = storage(), original = retainCreditOperationReference(s, 'credit', reference);
    const reopened = readCreditOperationReference(s, 'credit', value => value);
    assert.deepEqual(reopened.reference, reference); assert.equal(reopened.marker, original.marker);
    assert.equal(reopened.marker.includes('allocations'), false); assert.equal(reopened.marker.includes('apiKey'), false);
    assert.throws(() => retainCreditOperationReference(s, 'credit', { ...reference, operationKey: 'new-operation' }));
    s.failClear = true; assert.throws(() => clearCreditOperationReference(s, 'credit', original));
    assert.equal(s.getItem('credit'), original.marker); s.failClear = false;
    const remove = s.removeItem; s.removeItem = () => {};
    assert.throws(() => clearCreditOperationReference(s, 'credit', original)); assert.equal(s.getItem('credit'), original.marker);
    s.removeItem = remove; s.setItem('credit', 'other-original-operation');
    assert.throws(() => clearCreditOperationReference(s, 'credit', original)); assert.equal(s.getItem('credit'), 'other-original-operation');
    s.setItem('credit', original.marker); clearCreditOperationReference(s, 'credit', original); assert.equal(s.getItem('credit'), null);
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/features/ai-native/AiCreditSettings.tsx'), 'utf8');
  for (const call of ['request(command)', 'allocate(command)', 'platformDecide({']) assert.ok(source.includes(`aiCreditApi.${call}`));
  assert.equal((source.match(/retainCreditOperationReference\(referenceStorage\(\),/gu) ?? []).length, 3);
  assert.ok(source.includes('requestJournal.blocked')); assert.ok(source.includes('allocationJournal.blocked')); assert.ok(source.includes('journal.blocked'));
  assert.ok(!source.includes('sessionStorage.removeItem('));
});

test('budget: a definite rejection may clear only its own reference and cannot unlock another unknown', async () => {
  const { BudgetSettingsSession } = load('budget-settings-session.ts');
  const selector = { scope: 'tenant', sceneCode: 'original-scene' }, journalKey = 'original-budget-journal';
  const fields = { state: 'limited', unit: 'calls', amount: '7', currency: '', concurrent: '2', calls: '2', enabled: false };
  const settings = { budget: { state: 'limited', quantity: { unit: 'calls', value: 7 } }, allowedScenes: [selector.sceneCode],
    maxConcurrent: 2, maxCallsPerRun: 2, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: false, revision: 1 }, scene: { enabled: true, revision: 1 } } };
  for (const operation of ['change', 'initialize', 'refreshConfiguration']) for (const code of ['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT']) {
    for (const outcome of ['same', 'other', 'read-unavailable', 'clear-dropped']) {
      const s = storage(); let sends = 0, keys = 0, sentMarker;
      const foreign = JSON.stringify({ ...selector, expectedRevision: 1, operationKey: 'other-original-key',
        commandHash: 'c'.repeat(64), operation: 'change' });
      const reject = async () => {
        sends++; sentMarker = s.getItem(journalKey);
        if (outcome === 'other') s.setItem(journalKey, foreign);
        if (outcome === 'read-unavailable') s.failRead = true;
        if (outcome === 'clear-dropped') s.removeItem = () => {};
        throw Object.assign(Error('definite original-command rejection'), { response: { status: code === 'AI_INVALID_INPUT' ? 400 : 409, data: { code } } });
      };
      const ports = { read: async () => operation === 'initialize'
        ? { ...selector, state: 'not_configured', revision: null, settings: null, modelPolicy: null, admission: 'not_granted' }
        : { ...selector, state: 'configured', revision: 1, settings, admission: 'not_granted',
          configurationMeaning: 'saved_policy_reference_not_current_selection', modelPolicy: { mode: 'platform_managed', serviceName: 'Rental OS AI', selection: 'managed_by_platform' } },
        readOperation: async () => assert.fail('a rejection is not an observation of another operation'), change: reject,
        initialize: reject, refreshConfiguration: reject };
      const session = new BudgetSettingsSession(selector, ports, () => true, s, journalKey, () => `original-key-${++keys}`);
      await session.read();
      await assert.rejects(operation === 'refreshConfiguration' ? session.refresh() : session.save(fields));
      assert.equal(sends, 1); assert.equal(keys, 1);
      if (outcome === 'same') {
        assert.equal(s.getItem(journalKey), null); assert.equal(session.snapshot().locked, false);
        assert.equal(session.snapshot().feedback, code === 'AI_INVALID_INPUT' ? 'invalid' : 'conflict');
      } else {
        assert.equal(s.values.get(journalKey), outcome === 'other' ? foreign : sentMarker);
        assert.equal(session.snapshot().locked, true); assert.equal(session.snapshot().feedback, 'unknown');
        s.failRead = false; await session.read();
        await assert.rejects(operation === 'refreshConfiguration' ? session.refresh() : session.save(fields));
        assert.equal(sends, 1); assert.equal(keys, 1);
      }
    }
  }
});

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
