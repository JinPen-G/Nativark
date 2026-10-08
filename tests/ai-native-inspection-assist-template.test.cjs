'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/lane-b-functional.cjs');
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const { composeInspectionAssist } = require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
function setup(audience = 'operator', evidence) {
  const state = { user: user(), active: true, visible: true, reads: 0 };
  const auth = new AuthService({ getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: 'workspace-a' } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => [] },
  { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-test-secret' : undefined });
  const credentials = { current: async () => ({ audience, requestId: 'request-a', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: audience, exp: Math.floor(Date.now()/1000)+600 })}` }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => state.visible ? { id: 'order-a' } : null } });
  const template = { id: 'template-a', tenantId: 'tenant-a', categoryCode: 'vehicle', code: 'return', name: 'Synthetic frozen template', stage: 'return', version: 'v1', enabled: true,
    fields: [{ code: 'mileage', label: 'Mileage', type: 'number', required: true, usageMetric: true }] };
  const order = { id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', inspectionTemplateSnapshots: [template],
    allocations: [{ id: 'allocation-a', orderId: 'order-a', assetId: 'asset-a', status: 'picked_up' }] };
  const core = { getOrder: async () => { state.reads++; if(state.onRead) state.onRead(); return structuredClone(order); },
    listInspectionTemplates: async (_tenant, _stage, source) => structuredClone(source.inspectionTemplateSnapshots) };
  return { state, order, template, services: composeInspectionAssist({ guard, credentials, core, evidence }) };
}
const input = { orderId: 'order-a', allocationId: 'allocation-a', templateId: 'template-a', stage: 'return' };
for (const audience of ['operator','staff']) test(`actual Auth/Guard and template application: ${audience}`, async () => {
  const f = setup(audience), result = await f.services.templates.read(input);
  assert.equal(result.template.version, 'v1'); assert.equal(result.assetId, 'asset-a');
  assert.equal(result.semantics, 'read_projection_not_inspection_or_action_authorization');
  assert.equal(result.bindingFingerprint.length, 64);
  f.state.active = false;
  await assert.rejects(f.services.templates.read(input), { code: 'ACCESS_DENIED' });
});

test('shared candidate contract is enforced and current evidence required, no model execution claimed', async () => {
  const evidence = { verify: async (binding, source) => binding.assetId === 'asset-a' && source.attachmentId === 'file-a' && source.attachmentRevision === 2 };
  const f = setup('staff', evidence), observed = await f.services.templates.read(input);
  const candidate = { candidateId: 'candidate-a', fieldCode: 'mileage', status: 'candidate', value: { kind: 'number', value: 42 }, confidence: 0.7,
    sources: [{ attachmentId: 'file-a', attachmentRevision: 2, kind: 'image', region: { x: 0, y: 0, width: 0.5, height: 0.5 } }] };
  const request = { ...input, bindingFingerprint: observed.bindingFingerprint, candidates: [candidate] };
  const result = await f.services.candidates.consume(request);
  assert.equal(result.status, 'awaiting_human_review'); assert.equal(result.persistence, 'unavailable');
  assert.equal(result.recognitionEvidence, 'caller_supplied_not_model_execution_proof');
  await assert.rejects(setup().services.candidates.consume(request), { code: 'STORAGE_UNAVAILABLE' });
  await assert.rejects(f.services.candidates.consume({ ...request, candidates: [{ ...candidate, chargeAmount: 10 }] }), { code: 'INVALID_INPUT' });
  const foreign = structuredClone(candidate); foreign.sources[0].attachmentRevision = 3;
  await assert.rejects(f.services.candidates.consume({ ...request, candidates: [foreign] }), { code: 'ACCESS_DENIED' });
  evidence.verify = async () => false;
  await assert.rejects(f.services.candidates.consume(request), { code: 'ACCESS_DENIED' });
});
test('candidate input is snapshotted before authorization awaits', async () => {
  const f = setup('staff', { verify: async () => true });
  const observed = await f.services.templates.read(input);
  const candidate = { candidateId: 'candidate-a', fieldCode: 'mileage', status: 'candidate', value: { kind: 'number', value: 42 }, confidence: 0.7,
    sources: [{ attachmentId: 'file-a', attachmentRevision: 2, kind: 'image', region: { x: 0, y: 0, width: 0.5, height: 0.5 } }] };
  f.state.onRead = () => { candidate.value.value = 99; };
  const result = await f.services.candidates.consume({ ...input, bindingFingerprint: observed.bindingFingerprint, candidates: [candidate] });
  assert.equal(result.candidates[0].value.value, 42);
});

test('missing frozen snapshot never falls back, changed allocation and late revocation reject', async () => {
  const a = setup(); delete a.order.inspectionTemplateSnapshots;
  await assert.rejects(a.services.templates.read(input));
  const b = setup(); b.state.onRead = () => { if(b.state.reads === 2) b.order.allocations[0].assetId = 'another-asset'; };
  await assert.rejects(b.services.templates.read(input));
  const c = setup(); c.state.onRead = () => { c.state.active = false; };
  await assert.rejects(c.services.templates.read(input), { code: 'ACCESS_DENIED' });
  const d = setup('staff'); d.state.user.dataScope = 'own'; d.state.visible = false;
  await assert.rejects(d.services.templates.read(input), { code: 'ACCESS_DENIED' });
  await assert.rejects(setup().services.templates.read({ ...input, scope: { tenantId: 'other' } }), { code: 'INVALID_INPUT' });
});

test('manual materials preserve zero, reject foreign fields/negative usage and stale binding, never submit', async () => {
  const f = setup(), observed = await f.services.templates.read(input);
  const request = { ...input, bindingFingerprint: observed.bindingFingerprint, results: { mileage: 0 } };
  const result = await f.services.manual.prepare(request);
  assert.equal(result.results.mileage, 0);
  assert.equal(result.status, 'prepared_not_saved_or_submitted');
  assert.equal(result.submission, 'unavailable');
  const missing = await f.services.manual.prepare({ ...request, results: {} });
  assert.deepEqual(missing.missingFields, ['mileage']);
  await assert.rejects(f.services.manual.prepare({ ...request, results: { mileage: -1 } }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.services.manual.prepare({ ...request, results: { chargeAmount: 50 } }), { code: 'INVALID_INPUT' });
  f.template.version = 'v2';
  await assert.rejects(f.services.manual.prepare(request), { code: 'BINDING_CHANGED' });
});
