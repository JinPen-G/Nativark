'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { authorizedRunnerHarness } = require('./task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { composePersistedTaskAuthorization } = require('../../../apps/api/src/modules/ai-native/task-authorization.composition');
const { composeTaskModelHost } = require('../../../apps/api/src/modules/ai-native/runner/model-task-host.composition');
const { PrismaGatewayInvocationBindings } = require('../../../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
const { PrismaGatewayAccountingFacts } = require('../../../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
const { requestFingerprint } = require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository');

async function modelHostHarness(kind) {
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1,
    credentialRef: 'vault-a', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model',
    serviceMode: 'tenant_managed', enabled: true, disabledAt: null };
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProviderProfile: [profile], aiBudgetReservation: [] });
  h.state.aiTaskRunPlan = []; h.state.aiTask[0].status = 'QUEUED'; h.state.aiRun[0].status = 'QUEUED';
  h.state.aiRun[0].sequence = 1;
  h.identity.user.permissions.push('system:params:manage');
  const transaction = h.db.$transaction.bind(h.db);
  h.db.$transaction = (callback, options) => transaction(tx => callback({ ...tx,
    aiGatewayInvocation: { ...tx.aiGatewayInvocation, create: args => tx.aiGatewayInvocation.create({ ...args, data: { id: randomUUID(), ...args.data } }) },
    aiGatewayAccountingReceipt: { ...tx.aiGatewayAccountingReceipt, create: args => tx.aiGatewayAccountingReceipt.create({ ...args,
      data: { id: randomUUID(), usageHash: null, inputTokens: null, outputTokens: null, ...args.data } }) }
  }), options);
  const clock = () => new Date(h.control.now);
  const authorization = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock });
  const bindings = new PrismaGatewayInvocationBindings(h.db, authorization.scopes, clock);
  const financial = new PrismaGatewayAccountingFacts(h.db, bindings, authorization.scopes,
    { quantity: async () => assert.fail('task resource accounting must not price money') }, clock);
  const control = { verified: true, beforeRoute: null, onInvoke: null,
    result: { text: 'Synthetic model result', usage: { inputTokens: 1, outputTokens: 2 } }, sent: [], events: [], claimed: new Set() };
  let root;
  // Route/transport and monetary reservation lifecycle are synthetic; bindings, financial facts and task accounting are real repositories.
  const ports = {
    routing: { resolve: async (_caller, required) => {
      if (control.beforeRoute) await control.beforeRoute();
      const context = await authorization.execution.authorize('task-a');
      return { context, consumerScope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
        route: { profile: structuredClone(h.state.aiProviderProfile[0]), scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant-a' },
          role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } },
        selection: { mode: 'tenant_managed', revision: 1 }, scene: kind ? 'vision' : 'chat', requiredCapabilities: required };
    }, assertCurrent: async (_caller, route) => {
      if (route.route.profile.configRevision !== h.state.aiProviderProfile[0].configRevision) throw Error('synthetic stale route');
    } },
    admission: { admit: async value => {
      const admission = { ...value, id: randomUUID() };
      await h.db.aiInvocationAdmission.create({ data: { ...admission, tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId,
        status: 'admitted', revokedAt: null, completedAt: null } });
      return admission;
    } },
    dispatch: { claim: async binding => {
      assert.equal(control.claimed.has(binding.callId), false); control.claimed.add(binding.callId);
      const updated = await h.db.aiInvocationAdmission.updateMany({ where: { id: binding.id, status: 'admitted' }, data: { dispatchId: binding.dispatchId } });
      assert.equal(updated.count, 1); control.events.push('claim');
    }, finish: async binding => {
      await h.db.aiInvocationAdmission.updateMany({ where: { id: binding.id }, data: { status: 'completed' } });
    } },
    budget: { reserve: async call => {
      await financial.assertClaim(call);
      const binding = await bindings.resolveForReserve(call.context, call.request), a = binding.association, id = randomUUID();
      await h.db.aiBudgetReservation.create({ data: { id, scopeId: call.binding.scope.id, scopeKind: 'WORKSPACE',
        ...call.context, callId: call.request.callId, requestId: a.requestId, idempotencyKey: a.idempotencyKey,
        runId: a.runId, stepId: a.stepId, actionId: a.actionId, sceneCode: binding.sceneCode, priceVersion: a.priceVersion,
        configRevision: a.config.configRevision, configurationHash: requestFingerprint(a.config), status: 'reserved', dispatchState: 'not_dispatched' } });
      await financial.link(call, id); control.events.push('reserve'); return { id };
    }, dispatch: async (call, id) => {
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { dispatchState: 'dispatched' } });
      await financial.dispatch(call, id);
      await h.db.aiInvocationAdmission.updateMany({ where: { id: call.binding.id }, data: { status: 'dispatching' } });
      control.events.push('dispatch');
    }, recordUsage: async (call, id, usage) => { await financial.recordUsage(call, id, usage); }, settle: async (call, id, _event, usage) => {
      await financial.recordUsage(call, id, usage);
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { status: 'settled' } }); control.events.push('settle');
    }, abandon: async (call, id) => {
      const unsent = await financial.cancelIfUnsent(call, id);
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { status: unsent ? 'cancelled' : 'unknown' } });
      control.events.push('unknown');
    } },
    audit: { append: async () => {} },
    transport: { invoke: async (_context, request, _route, signal) => {
      assert.equal(signal.aborted, false); control.sent.push(structuredClone(request)); h.control.tick += 10;
      if (control.onInvoke) await control.onInvoke();
      return structuredClone(control.result);
    }, stream: async function* () { throw Error('invoke-only host'); } }
  };
  if (kind) {
    const { AuthorizedGatewayMediaAttachmentResolver } = require('../../../apps/api/src/modules/ai-native/gateway-media-attachment.resolver');
    const bytes = kind === 'audio' ? Buffer.alloc(1644) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4aQAAAAASUVORK5CYII=', 'base64');
    if (kind === 'audio') {
      bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
      bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);bytes.writeUInt32LE(16000,28);
      bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(1600,40);
    }
    const contentHash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    control.mediaActive = true;
    ports.media = new AuthorizedGatewayMediaAttachmentResolver({ authorize: async (context, ref) =>
      control.mediaActive && context.tenantId === 'tenant-a' && context.workspaceId === 'workspace-a'
        && ref.attachmentId === 'file-a' && ref.attachmentRevision === 1 ? {
        attachmentId: 'file-a', attachmentRevision: 1, mediaType: kind === 'audio' ? 'audio/wav' : 'image/png', sizeBytes: bytes.length,
        contentHash, readBinding: 'synthetic-original-file' } : null
    }, { read: async () => new Uint8Array(bytes) });
  }
  const task = { taskId: 'task-a', runId: 'run-a', registrationRef: 'summary-a', material: {
    messages: [{ role: 'user', content: [{ kind: 'text', text: 'Explain authorized facts.' }] }], maxOutputTokens: 32 },
    limits: { ...h.plan.limits, maxTotalMs: 60000, maxStepMs: 10000 } };
  if (kind) task.material.messages[0].content.push({ kind, attachmentId: 'file-a', attachmentRevision: 1 });
  const config = { ...h.authorization, db: h.db, clock,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    ...(kind ? { kind } : {}),
    scene: { code: 'synthetic-clarification', version: '1' }, gatewayScene: { sceneCode: 'synthetic-clarification', routeScene: kind ? 'vision' : 'chat', maxOutputTokens: 64 },
    priceVersion: 'synthetic-price-1', runtime: { ports, evidence: 'mock', verifyEvidence: async () => control.verified },
    task, host: { holderId: 'model-host', leaseMs: 100000 }, inputSource: h.source, financialEvidence: financial, monotonic: () => h.control.tick };
  root = composeTaskModelHost(config);
  await root.model.policy.put({ expectedRevision: null, enabled: true, limits: task.limits, expiresAt: '2027-01-01T00:00:00Z' });
  return { ...h, modelControl: control, root, config, financial, query: { taskId: task.taskId, runId: task.runId } };
}
module.exports = { modelHostHarness };
