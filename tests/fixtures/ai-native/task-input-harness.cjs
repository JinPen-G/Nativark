'use strict';
const assert = require('node:assert/strict');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
const { AI_TASK_DRAFT_VERSION, AI_CONTRACT_DRAFT_VERSION } = require('./local-shared.cjs');
const { createTaskInputStore, clone } = require('./task-input-store.cjs');
const { AiTaskRepository } = require('../../../apps/api/src/modules/ai-native/ai-task.repository');
const { AiStepRegistrationRepository } = require('../../../apps/api/src/modules/ai-native/ai-step-registration.repository');
const { AiStepTransitionRepository } = require('../../../apps/api/src/modules/ai-native/ai-step-transition.repository');
const { AiTaskTransitionRepository } = require('../../../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { createAiTaskRunnerOutcomePort } = require('../../../apps/api/src/modules/ai-native/runner/ai-task-runner-outcome-adapter');
const { composePersistentTaskRunner } = require('../../../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { requestFingerprint } = require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository');
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const syntheticContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'synthetic-request', authorizedAt: '2026-10-06T12:00:00Z',
  audience: 'operator', actor: { kind: 'user', userId: 'user-a' }, scope,
  access: { permissions: ['rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };

// Auth, plan policy, registered input and tool responses are explicit synthetic dependencies.
async function taskInputHarness(extraTables = {}, constraints = {}) {
  const control = { now: new Date('2026-10-06T12:00:00Z'), tick: 0, revoked: false, context: structuredClone(syntheticContext), execute: null };
  const stored = createTaskInputStore({
    aiTask: [{ id: 'task-a', scopeId: 'scope-a', scopeKind: 'WORKSPACE', scope: aiPersistenceScopeColumns(scope), ownerKind: 'USER', ownerId: 'user-a', audience: 'OPERATOR',
      status: 'RUNNING', revision: 1, eventCursor: 0n, cancelRequestedAt: null, archivedAt: null, contractVersion: AI_TASK_DRAFT_VERSION,
      sceneCode: 'synthetic-clarification', sceneVersion: '1', createdAt: new Date(control.now), updatedAt: new Date(control.now) }],
    aiRun: [{ id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', revision: 1, fencingToken: new Prisma.Decimal(1), leaseOwnerId: 'bootstrap',
      leaseExpiresAt: new Date(control.now.getTime() + 100000), status: 'RUNNING', actorKind: 'USER', actorId: 'user-a' }],
    aiStep: [], aiTaskRunPlan: [], aiTaskResultArtifact: [], aiTaskExecutionBudget: [], aiTaskExecutionCharge: [], aiTaskEvent: [],
    aiGatewayInvocation: [], aiGatewayAccountingReceipt: [], aiInvocationAdmission: [], operationLog: [], ...extraTables
  }, constraints);
  const { state, db, trace } = stored;
  const context = () => { if (control.revoked) throw Error('synthetic revoked'); return structuredClone(control.context); };
  const taskAuthority = { resolve: async (_id, op) => { trace.push(`authority:${op}`); return context(); } };
  const tasks = new AiTaskRepository(db, taskAuthority, () => new Date(control.now));
  const plan = { taskId: 'task-a', runId: 'run-a', taskRevision: 1,
    steps: ['clarify', 'continue'].map(registrationRef => ({ registrationRef, operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: '1' })),
    limits: { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 } };
  const inputFor = ref => ({ orderId: 'synthetic-order', phase: ref });
  const registrationAuthority = { resolve: async c => ({ context: context(), registrationAllowed: true, authorizationKey: 'synthetic-registration',
    taskId: c.taskId, registrationRef: c.registrationRef, expiresAt: '2026-10-07T12:00:00Z', toolCode: 'rental.order.explain', toolVersion: '1',
    inputRef: `input-${c.registrationRef}`, requestFingerprint: requestFingerprint(inputFor(c.registrationRef)) }) };
  const registrations = new AiStepRegistrationRepository(db, registrationAuthority, () => new Date(control.now), undefined, { resolve: async () => context() });
  const stepState = row => ({ stepId: row.id, runId: row.runId, sequence: row.sequence, revision: row.revision, toolCode: row.toolCode,
    toolVersion: row.toolVersion, actionId: row.actionId, requestFingerprint: row.requestFingerprint,
    outcome: { status: row.status.toLowerCase(), effect: row.effect.toLowerCase(), ...(row.status === 'SUCCEEDED' ? { facts: [] } : {}) } });
  const transitions = new AiStepTransitionRepository(db, { resolve: async c => {
    const row = state.aiStep.find(s => s.id === c.stepId); assert.ok(row);
    const previous = stepState(row), artifact = state.aiTaskResultArtifact.find(a => a.id === c.evidenceId);
    const next = c.reason === 'start' ? { ...previous, revision: previous.revision + 1, outcome: { status: 'running', effect: 'none' } }
      : artifact?.outcome === 'SUCCEEDED' ? { ...previous, revision: previous.revision + 1, outcome: { status: 'succeeded', effect: 'none', facts: [] } }
      : { ...previous, revision: previous.revision + 1, outcome: { status: 'unknown', effect: 'possible', reconcileAfter: '2026-10-06T12:01:00Z' } };
    return { context: context(), transitionAllowed: true, authorizationKey: 'synthetic-transition', taskId: c.taskId,
      evidenceId: c.evidenceId, evidenceRevision: 1, expiresAt: '2026-10-07T12:00:00Z', reason: c.reason,
      previous, next, previousResultRef: row.resultRef, resultRef: c.reason === 'start' ? null : c.evidenceId };
  } }, () => new Date(control.now));
  const aggregate = new AiTaskTransitionRepository(db, taskAuthority, () => new Date(control.now));
  const commands = { register: (p, l) => ({ taskId: l.taskId, registrationRef: p.registrationRef, expectedTaskRevision: state.aiTask[0].revision,
    lease: { runId: l.runId, holderId: l.holderId, revision: l.revision, fencingToken: l.fencingToken } }),
    transition: (kind, ref, l, resultRef) => ({ taskId: l.taskId, stepId: ref.registered.stepId, expectedTaskRevision: ref.registered.taskRevision,
      expectedStepRevision: ref.registered.stepRevision, evidenceId: resultRef ?? `start-${ref.registered.stepId}`,
      reason: kind === 'start' ? 'start' : kind === 'unknown' ? 'result_unknown' : 'result_observed',
      lease: { runId: l.runId, holderId: l.holderId, revision: l.revision, fencingToken: l.fencingToken } }) };
  const planAuthority = { authorize: async () => { context(); return { authorityHash: 'a'.repeat(64), policyVersion: 'synthetic-policy', expiresAt: '2026-10-07T12:00:00Z' }; } };
  const executions = [];
  const make = inputs => composePersistentTaskRunner({ db, tasks, registrations, replays: registrations, transitions, commands,
    taskOutcome: createAiTaskRunnerOutcomePort({ transitions: aggregate, commands: { transition: c => c }, tasks }),
    planAuthority, toolCatalog: { resolve: async () => ({ modelCall: false }) }, inputs,
    executors: { resolve: async () => ({ operation: 'readonly', execute: async (binding, signal) => {
      executions.push(binding.inputRef); trace.push(`execute:${binding.inputRef}`); control.tick += 10;
      return control.execute ? control.execute(binding, signal) : { kind: 'succeeded', payload: { synthetic: true, phase: binding.inputRef } };
    } }) }, wall: () => new Date(control.now), monotonic: () => control.tick });
  const held = () => ({ taskId: 'task-a', runId: 'run-a', holderId: state.aiRun[0].leaseOwnerId, revision: state.aiRun[0].revision,
    fencingToken: state.aiRun[0].fencingToken.toFixed(0), expiresAt: state.aiRun[0].leaseExpiresAt?.toISOString() ?? '' });
  await make().evidence.savePlan(plan, held());
  await tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: 'bootstrap', expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '1' });
  const claim = () => ({ taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', expectedTaskRevision: state.aiTask[0].revision,
    expectedRunRevision: state.aiRun[0].revision, expectedFencingToken: state.aiRun[0].fencingToken.toFixed(0), leaseMs: 100000 });
  return { ...stored, control, storeControl: stored.control, tasks, taskAuthority, planAuthority, registrations, transitions, aggregate,
    plan, inputFor, executions, make, claim, held, context, clone };
}
module.exports = { taskInputHarness };
