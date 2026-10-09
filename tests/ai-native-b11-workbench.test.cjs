'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, mount, deferred } = require('./fixtures/ai-native/b09-host.cjs');

test('pickup and return actual pages stay default-off and bind private hosts only to the current session', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
  let session = { tenant: { tenantId: 'tenant-1' }, user: { id: 'staff-1' }, currentWorkspaceId: 'space-1' }, version = 1;
  const listeners = new Set(), exports = {};
  const file = path.resolve('apps/staff-miniprogram/src/components/ai-native/inspection-page-binding.ts');
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, require: () => ({ currentSession: () => session, contextVersion: () => version,
      sessionEvents: { on: fn => { listeners.add(fn); return () => listeners.delete(fn); } } }) });
  for (const stage of ['pickup', 'return']) {
    let page, shown = 0, attached = 0, detached = 0, bound;
    const source = fs.readFileSync(`apps/staff-miniprogram/src/pages/${stage}/index.ts`, 'utf8').replace(/^import[^\n]*\n/gm, '');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText,
      { Page: value => { page = value; }, themeBehavior: {}, loadingState: () => ({}), isSignedIn: () => true, ...exports });
    const child = { attachHost: host => { attached++; bound = host; }, detachHost: () => { detached++; bound = undefined; },
      hostShow: async () => { shown++; }, hostHide: () => { shown--; } };
    const instance = { ...page, data: { ...page.data, id: 'order-1' }, order: {}, template: { id: 'template-1' },
      setData(patch) { Object.assign(this.data, patch); }, selectComponent: () => child };
    instance.onShow(); assert.equal(attached, 0); assert.notEqual(instance.data.aiInspectionVisible, true);
    const host = { context: { audience: 'staff', tenantId: 'tenant-1', workspaceId: session.currentWorkspaceId, ownerId: 'staff-1' },
      target: { orderId: 'order-1', allocationId: 'allocation-1', templateId: 'template-1', stage },
      serverEnabled: false, draftId: 'draft-1', current: () => true };
    instance.attachInspectionHost(host); assert.equal(attached, 0);
    host.serverEnabled = true; instance.attachInspectionHost(host); assert.equal(attached, 1); assert.equal(bound.current(), true);
    const old = bound; instance.data.id = 'order-2'; assert.equal(old.current(), false); instance.data.id = 'order-1';
    instance.onHide(); instance.onShow(); assert.ok(shown >= 1);
    version++; session = { ...session, currentWorkspaceId: 'space-2' };
    for (const listener of [...listeners]) listener();
    assert.equal(old.current(), false); assert.equal(instance.data.aiInspectionVisible, false);
    instance.onUnload(); assert.equal(listeners.size, 0); assert.ok(detached > 0);
  }
});

test('staff inspection host consumes original draft, edits, evidence and submission ports with disable/epoch isolation', async () => {
  const { StaffInspectionHostBinding } = load('apps/staff-miniprogram/src/components/ai-native/inspection-host.ts');
  const target = { orderId: 'order-1', allocationId: 'allocation-1', templateId: 'template-1', stage: 'pickup' };
  const template = { id: 'template-1', version: 'v1', stage: 'pickup', fields: [{ code: 'reading', label: '读数', type: 'number', required: true }] };
  const detail = { draftId: 'draft-1', revision: 1, status: 'draft_saved', target, templateVersion: 'v1', bindingFingerprint: 'binding',
    state: { version: 1, fields: { reading: { value: 4, decision: 'manual', actorId: 'staff-1' } }, candidates: [],
      evidence: [{ attachmentId: 'file-1', attachmentRevision: 1 }], missingFields: [], reviewRequired: false } };
  const calls = []; let view;
  const binding = new StaffInspectionHostBinding(value => { view = value; });
  const host = { context: { tenantId: 'tenant-1', workspaceId: 'space-1', ownerId: 'staff-1', audience: 'staff' },
    target, draftId: 'draft-1', serverEnabled: false, current: () => true, actionId: 'original-action',
    operationId: (kind, revision) => `${kind}-${revision}`,
    evidence: { fingerprint: async () => { calls.push('evidence'); return 'trusted-evidence'; } },
    templates: { read: async () => { calls.push('template'); return { bindingFingerprint: 'binding', template }; } },
    drafts: { read: async () => { calls.push('read'); return structuredClone(detail); },
      edit: async request => { calls.push(request); const edit = request.edits[0];
        const candidate = detail.state.candidates.find(row => row.candidateId === edit.candidateId);
        detail.state.fields.reading = { value: edit.decision === 'accepted' ? candidate.value.value : edit.decision === 'rejected' ? null : edit.value,
          decision: edit.decision, candidateId: edit.candidateId, actorId: 'staff-1' }; detail.revision++; },
      replaceEvidence: async request => { calls.push(request); detail.state.evidence = request.evidence; detail.revision++; } },
    submission: { prepareReview: async request => { calls.push(request); detail.status = 'prepared'; detail.revision++; detail.state.submission = { mode: 'manual_review_only' }; },
      prepare: async request => { calls.push(request); detail.status = 'prepared'; detail.revision++; detail.state.submission = { mode: 'original_single' }; },
      submit: async request => { calls.push(request); detail.status = 'submission_unknown'; detail.revision++; return { status: detail.status }; },
      reconcile: async () => { calls.push('reconcile'); detail.status = 'submitted'; return { status: 'submitted' }; } } };
  binding.attachHost(host); await binding.show(); assert.equal(calls.length, 0); assert.equal(view.phase, 'unavailable');
  host.serverEnabled = true;
  detail.state.candidates = [{ candidateId: 'candidate-1', fieldCode: 'reading', status: 'candidate',
    value: { kind: 'number', value: 9 }, sources: [{ attachmentId: 'file-1', attachmentRevision: 1 }] }];
  binding.attachHost(host); await binding.show();
  const candidateDefinition = load('apps/staff-miniprogram/src/components/ai-native/ai-inspection-draft/index.ts');
  const candidateComponent = mount(candidateDefinition, { items: view.items, readonly: false, candidateActions: true, revision: detail.revision });
  const oldRevision = detail.revision;
  candidateComponent.onCandidateDecision({ currentTarget: { dataset: { key: 'reading', candidate: 'candidate-1', decision: 'accepted', revision: oldRevision } } });
  const decision = candidateComponent.events.at(-1);
  assert.equal(decision.name, 'candidatedecision');
  await binding.decideCandidate(decision.detail.key, decision.detail.candidateId, decision.detail.decision, decision.detail.revision);
  assert.equal(detail.state.fields.reading.value, 9); assert.equal(detail.state.fields.reading.decision, 'accepted');
  const acceptedRequest = calls.find(call => call?.edits?.[0].decision === 'accepted');
  assert.equal(acceptedRequest.expectedRevision, oldRevision); assert.equal(Object.hasOwn(acceptedRequest.edits[0], 'value'), false);
  const writesBeforeStale = calls.filter(call => call?.edits).length;
  await binding.decideCandidate('reading', 'candidate-1', 'rejected', oldRevision);
  await binding.decideCandidate('reading', 'foreign-candidate', 'accepted', detail.revision);
  assert.equal(calls.filter(call => call?.edits).length, writesBeforeStale);
  await binding.edit('reading', '7'); assert.equal(detail.state.fields.reading.value, 7);
  await binding.decideCandidate('reading', 'candidate-1', 'rejected', detail.revision);
  assert.equal(detail.state.fields.reading.value, null); assert.equal(detail.state.fields.reading.decision, 'rejected');
  candidateComponent.update({ readonly: true }); const eventCount = candidateComponent.events.length;
  candidateComponent.onCandidateDecision({ currentTarget: { dataset: { key: 'reading', candidate: 'candidate-1', decision: 'accepted', revision: oldRevision } } });
  assert.equal(candidateComponent.events.length, eventCount); candidateComponent.detach();
  await binding.removeEvidence('file-1'); assert.equal(detail.state.evidence.length, 0);
  await binding.prepareReview(); assert.equal(detail.state.submission.mode, 'manual_review_only');
  await binding.submit(true); assert.equal(view.phase, 'unknown');
  const submits = calls.filter(call => typeof call === 'object' && call.operationId?.startsWith('submit')).length;
  await binding.submit(true); assert.equal(calls.filter(call => typeof call === 'object' && call.operationId?.startsWith('submit')).length, submits);
  await binding.reconcile(); assert.equal(view.phase, 'submitted');
  await binding.submit(true); assert.equal(calls.filter(call => typeof call === 'object' && call.operationId?.startsWith('submit')).length, submits);
  const late = deferred(); host.drafts.read = () => late.promise; binding.attachHost(host); const reading = binding.show();
  binding.attachHost({ ...host, context: { ...host.context, workspaceId: 'space-2' }, serverEnabled: false });
  late.resolve(structuredClone(detail)); await reading; assert.equal(view.phase, 'unavailable'); assert.equal(view.items.length, 0);
  const definition = load('apps/staff-miniprogram/src/components/ai-native/ai-inspection-assist/index.ts');
  const instance = mount(definition); instance.selectComponent = () => null;
  await instance.hostShow(); assert.equal(instance.data.phase, 'unavailable'); instance.detach();
});

test('staff preparation reconciliation keeps exact commands unknown until a receipt and current draft are read', async () => {
  const { StaffInspectionHostBinding } = load('apps/staff-miniprogram/src/components/ai-native/inspection-host.ts');
  for (const kind of ['prepareReview', 'prepare']) {
    let view, original, writes = 0, submits = 0, failRead = false;
    const target = { orderId: 'order-1', allocationId: 'allocation-1', templateId: 'template-1', stage: 'return' };
    const template = { id: target.templateId, version: 'v1', stage: 'return', fields: [] };
    const detail = { draftId: 'draft-1', revision: 1, status: 'draft_saved', target, templateVersion: 'v1', bindingFingerprint: 'binding',
      state: { fields: {}, candidates: [], evidence: [], missingFields: [], reviewRequired: false } };
    let result = { status: 'absent', execution: 'not_attested' };
    const lookups = [];
    const host = { context: { tenantId: 'tenant-1', workspaceId: 'space-1', ownerId: 'staff-1', audience: 'staff' },
      target, draftId: 'draft-1', serverEnabled: true, current: () => true, actionId: 'original-action', handoverSignatureFileAssetId: 'signature-1',
      operationId: (action, revision) => `${action}-${revision}`,
      templates: { read: async () => ({ bindingFingerprint: 'binding', template }) },
      drafts: { read: async () => { if (failRead) throw Error('read unavailable'); return structuredClone(detail); } },
      submission: { prepare: async request => prepare(request), prepareReview: async request => prepare(request),
        submit: async () => { submits++; return { status: 'submitted' }; },
        reconcilePreparation: async command => { lookups.push(structuredClone(command)); return result; } } };
    function prepare(request) {
      writes++; original = structuredClone(request); detail.status = 'prepared'; detail.revision++;
      detail.state.submission = { mode: kind === 'prepare' ? 'original_single' : 'manual_review_only', actionId: request.actionId };
      request.operationId = 'callback-mutated-command'; // Host objects must not mutate our private recovery command.
      throw Error('committed but reply lost');
    }
    const binding = new StaffInspectionHostBinding(next => { view = next; });
    binding.attachHost(host); await binding.show();
    if (kind === 'prepare') await binding.submit(true); else await binding.prepareReview();
    assert.equal(view.phase, 'unknown'); assert.equal(view.canReconcile, true);
    binding.hide(); assert.equal(view.phase, 'unavailable'); await binding.show();
    assert.equal(view.phase, 'unknown'); assert.equal(writes, 1);
    await binding.reconcile(); assert.equal(view.phase, 'unknown'); assert.equal(view.canSubmit, false);
    assert.deepEqual(lookups[0], { kind, request: original });
    result = { status: 'unavailable', execution: 'not_attested' }; await binding.reconcile(); assert.equal(view.phase, 'unknown');
    result = { status: 'found', execution: 'not_attested', mode: detail.state.submission.mode,
      result: { draftId: detail.draftId, revision: detail.revision, status: 'prepared', inspectionId: null } };
    failRead = true; await binding.reconcile(); assert.equal(view.phase, 'unknown'); assert.equal(view.canSubmit, false);
    failRead = false; await binding.reconcile(); assert.equal(view.phase, 'prepared');
    assert.equal(writes, 1); assert.equal(submits, 0); // A receipt cannot authorize automatic submission.
    binding.detachHost();

    detail.status = 'draft_saved'; detail.state.submission = undefined;
    const late = deferred(); host.submission.reconcilePreparation = () => late.promise;
    binding.attachHost(host); await binding.show(); await binding.prepareReview();
    const reading = binding.reconcile(); binding.detachHost(); late.resolve(result); await reading;
    assert.equal(view.phase, 'unavailable'); assert.equal(view.items.length, 0); assert.equal(submits, 0);

    delete host.submission.reconcilePreparation;
    let contextCurrent = true; host.current = () => contextCurrent;
    const component = mount(load('apps/staff-miniprogram/src/components/ai-native/ai-inspection-assist/index.ts'));
    let childDetached = 0;
    component.selectComponent = () => ({ detachHost: () => { childDetached++; } });
    component.attachHost(host); await component.hostShow(); await component.onReview();
    assert.equal(component.data.phase, 'unknown'); assert.equal(component.data.canReconcile, false);
    const writesBefore = writes; await component.onReconcile(); assert.equal(writes, writesBefore);
    assert.equal(Object.hasOwn(component.data, 'uncertain'), false);
    const detachedBefore = childDetached;
    contextCurrent = false; await component.hostShow(); assert.equal(component.data.phase, 'unavailable');
    assert.equal(childDetached, detachedBefore + 1);
    contextCurrent = true; await component.hostShow(); assert.equal(component.data.phase, 'unavailable');
    assert.equal(writes, writesBefore); component.detach();
  }
});

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' workbench binds host only through instance methods and isolates late detail', async () => {
    const definition = load('apps/' + app + '/src/components/ai-native/ai-task-workbench/index.ts');
    const children = new Map();
    const instance = mount(definition, { tasks: [{ id: 'task-1' }] });
    const rawSetData = instance.setData;
    instance.setData = (patch, callback) => { rawSetData.call(instance, patch); if (typeof callback === 'function') callback(); };
    instance.selectComponent = selector => children.get(selector) ?? null;
    for (const selector of ['#clarification', '#confirmation', '#sources']) {
      children.set(selector, { attached: 0, detached: 0, attachHost(fn) { this.attached += 1; this.fn = fn; }, detachHost() { this.detached += 1; this.fn = undefined; } });
    }
    let reads = 0;
    const pending = deferred();
    const host = {
      context: { audience: app === 'miniprogram' ? 'client' : 'staff', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      readDetail: async () => { reads += 1; return pending.promise; },
      submitInput: async () => {},
    };
    instance.attachHost(host);
    assert.equal(instance.data.phase, 'paused');
    instance.hostShow(true);
    const selecting = instance.selectTask({ detail: { taskId: 'task-1' } });
    assert.equal(reads, 1);
    instance.detachHost();
    pending.resolve({ steps: [], inputRevision: 'r1' });
    await selecting;
    await Promise.resolve(); await Promise.resolve();
    assert.equal(instance.data.phase, 'no_host');
    assert.equal(instance.data.ready, false);
    assert.equal(children.get('#clarification').detached > 0, true);
    assert.equal(children.get('#clarification').fn, undefined);
  });

  test(app + ' workbench default lifecycle has no host read or polling side effect', () => {
    const definition = load('apps/' + app + '/src/components/ai-native/ai-task-workbench/index.ts');
    let reads = 0;
    const instance = mount(definition, { tasks: [{ id: 'task-1' }] });
    instance.selectComponent = () => null;
    instance.hostShow(true);
    assert.equal(reads, 0);
    assert.equal(instance.data.phase, 'no_host');
  });
}
