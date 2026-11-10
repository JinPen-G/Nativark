'use strict';
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const apiRequire = createRequire(path.join(root, 'apps/api/package.json'));
const offlinePreload = require.resolve(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const protectedOffline = process.env.DATABASE_URL === 'mysql://offline:offline@127.0.0.1:1/rental_os_offline'
  && Boolean(require.cache[offlinePreload]);
// The approved preload maps the API import to this tree's private client.
// Retain the normal API-package guard, and reject shared/foreign clients when
// running under that preload instead of weakening the ownership assertion.
const clientRoot = fs.realpathSync(path.resolve(root, protectedOffline
  ? process.env.AI_OFFLINE_PRISMA_CLIENT_ROOT ?? 'output/repair-current-20261101-uotDQk/generated'
  : 'apps/api/node_modules/@prisma/client'));
if (protectedOffline) assert.ok(clientRoot.startsWith(path.join(fs.realpathSync(root), 'output') + path.sep));
assert.ok(fs.realpathSync(apiRequire.resolve('@prisma/client')).startsWith(clientRoot + path.sep));
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { AiStepTransitionRepository } = require(path.join(root, 'apps/api/src/modules/ai-native/ai-step-transition.repository'));
const { AiTaskEventRepository } = require(path.join(root, 'apps/api/src/modules/ai-native/ai-task-event.repository'));
const { AiTaskRepositoryError } = require(path.join(root, 'apps/api/src/modules/ai-native/ai-task.repository'));
const { aiPersistenceScopeColumns } = require(path.join(root, 'apps/api/src/modules/ai-native/persistence-scope'));
const { contexts } = require('./contract-consumer.cjs');
const clone = value => structuredClone(value);
const now = new Date('2026-10-03T10:00:00Z');
const command = { taskId: 'task-1', stepId: 'step-1', expectedTaskRevision: 3, expectedStepRevision: 2,
  evidenceId: 'evidence-1', reason: 'result_observed', lease: { runId: 'run-1', holderId: 'worker-1', revision: 5, fencingToken: '9007199254740993' } };
const outcomes = {
  pending: { status: 'pending', effect: 'none' }, running: { status: 'running', effect: 'possible' }, readRunning: { status: 'running', effect: 'none' },
  succeeded: { status: 'succeeded', effect: 'committed', facts: [{ scope: clone(contexts[0].scope), resourceType: 'order', resourceId: 'order-1', observedAt: now.toISOString(), basis: { kind: 'snapshot', version: 'v1' } }] },
  read: { status: 'succeeded', effect: 'none', facts: [] },
  failed: { status: 'failed', effect: 'none', error: { code: 'AI_BUSINESS_REJECTED', message: 'Synthetic failure', retryable: false, nextAction: 'manual', missingFields: [] } },
  retryable: { status: 'failed', effect: 'none', error: { code: 'AI_BUSINESS_REJECTED', message: 'Synthetic known failure', retryable: true, nextAction: 'retry_later', missingFields: [] } },
  unknown: { status: 'unknown', effect: 'possible', error: { code: 'AI_RESULT_UNKNOWN', message: 'Synthetic unknown', retryable: false, nextAction: 'reconcile', missingFields: [] } },
  cancelled: { status: 'cancelled', effect: 'none' }
};
const identity = { stepId: 'step-1', runId: 'run-1', sequence: 1, actionId: 'action-original', requestFingerprint: 'a'.repeat(64), toolCode: 'rental.order.commit', toolVersion: 'draft-1' };
const resultRef = step => ['succeeded', 'failed', 'unknown'].includes(step.outcome.status);
const error = step => step.outcome.error?.code ?? null;

// Executes the query predicates; the serialized callback is only a test double, not MySQL.
function matches(value, rule) {
  if (rule === null || typeof rule !== 'object') return value === rule;
  if (rule instanceof Date) return value instanceof Date && value.getTime() === rule.getTime();
  if (typeof rule.toFixed === 'function') return String(value) === rule.toFixed(0);
  return Object.entries(rule).every(([key, child]) => {
    if (key === 'is') return matches(value, child);
    if (key === 'in') return child.includes(value);
    if (key === 'not') return !matches(value, child);
    if (key === 'gt') return value != null && value > child;
    if (key === 'lte') return value != null && value <= child;
    if (key === 'OR') return child.some(item => matches(value, item));
    return matches(value?.[key], child);
  });
}
function project(row, select) { return row && clone(Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))); }
function apply(row, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment;
    else row[key] = clone(value);
  }
}
function setup(from = 'running', to = 'succeeded', context = contexts[0]) {
  const previous = { ...identity, revision: 2, outcome: clone(outcomes[from]) }, next = { ...identity, revision: 3, outcome: clone(outcomes[to]) };
  for (const step of [previous, next]) if (step.outcome.facts) for (const fact of step.outcome.facts) fact.scope = clone(context.scope);
  const owner = context.actor.userId ?? context.actor.customerId ?? context.actor.subjectId;
  const state = { calls: [], fail: null, hooks: {}, authHooks: {}, authCount: 0, clock: new Date(now), commits: 0, rollbacks: 0,
    grant: { context: clone(context), transitionAllowed: true, authorizationKey: 'policy:revision:1', taskId: 'task-1', evidenceId: 'evidence-1', evidenceRevision: 1,
      expiresAt: '2026-10-03T10:01:00Z', reason: 'result_observed', previous, next, previousResultRef: resultRef(previous) ? 'result-old' : null, resultRef: resultRef(next) ? 'result-new' : null },
    task: { id: 'task-1', scopeId: 'scope-1', scopeKind: context.scope.kind.toUpperCase(), scope: aiPersistenceScopeColumns(context.scope),
      audience: context.audience.toUpperCase(), ownerKind: context.actor.kind.toUpperCase(), ownerId: owner, archivedAt: null,
      revision: 3, status: 'RUNNING', contractVersion: 'ain-c04-draft-1', cancelRequestedAt: null, eventCursor: 9007199254740993n,
      ...(context.actor.kind === 'automation' ? { policyId: context.actor.policyId, policyRevision: context.actor.policyRevision, policyExpiresAt: new Date(context.actor.expiresAt) } : {}) },
    run: { id: 'run-1', scopeId: 'scope-1', taskId: 'task-1', revision: 5, fencingToken: 9007199254740993n,
      leaseOwnerId: 'worker-1', leaseExpiresAt: new Date(now.getTime() + 10000), actorKind: context.actor.kind.toUpperCase(), actorId: owner, status: 'RUNNING' },
    step: { id: 'step-1', scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', sequence: 1, revision: 2,
      actionId: identity.actionId, requestFingerprint: identity.requestFingerprint, toolCode: identity.toolCode, toolVersion: identity.toolVersion,
      status: previous.outcome.status.toUpperCase(), effect: previous.outcome.effect.toUpperCase(), resultRef: resultRef(previous) ? 'result-old' : null, errorCode: error(previous) }, events: [] };
  const authority = { resolve: async input => {
    state.calls.push({ kind: 'authorize', input: clone(input) });
    const grant = clone(state.grant), count = ++state.authCount;
    if (state.authHooks[count]) await state.authHooks[count](grant, input);
    return grant;
  } };
  let queue = Promise.resolve();
  const db = { aiTask: {}, aiRun: {}, $transaction: async (callback, options) => {
    const before = queue; let release; queue = new Promise(resolve => { release = resolve; }); await before;
    state.calls.push({ kind: 'transaction', options });
    const working = clone({ task: state.task, run: state.run, step: state.step, events: state.events });
    const hook = async (kind, args) => {
      state.calls.push({ kind, args });
      if (state.hooks[kind]) await state.hooks[kind](working, args);
      if (state.fail === kind) throw new Error('synthetic SQL private detail');
    };
    const update = async (kind, row, args) => {
      await hook(kind, args);
      if (!matches(row, args.where)) return { count: 0 };
      apply(row, args.data); return { count: 1 };
    };
    let runUpdates = 0;
    const tx = {
      aiTask: { findFirst: async args => { await hook('task.read', args); return matches(working.task, args.where) ? project(working.task, args.select) : null; }, updateMany: args => update('task.lock', working.task, args) },
      aiStep: { findFirst: async args => { await hook('step.read', args); return matches(working.step, args.where) ? project(working.step, args.select) : null; }, updateMany: args => update('step.update', working.step, args) },
      aiRun: { updateMany: args => update(++runUpdates === 1 ? 'run.lock' : 'run.recheck', working.run, args) },
      aiTaskEvent: { create: async args => { await hook('event.create', args); working.events.push(clone(args.data)); return { cursor: args.data.cursor }; },
        findMany: async args => { await hook('event.read', args); return working.events.filter(e => matches(e, args.where)).sort((a, b) => a.cursor < b.cursor ? -1 : 1).slice(0, args.take).map(e => project(e, args.select)); } }
    };
    try {
      const result = await callback(tx);
      if (state.fail === 'commit') throw Error('synthetic commit failed');
      Object.assign(state, working); state.commits++;
      if (state.fail === 'commit_ack') throw Error('synthetic ambiguous commit acknowledgement');
      return result;
    } catch (error) { state.rollbacks++; throw error; }
    finally { release(); }
  } };
  const repository = new AiStepTransitionRepository(db, authority, () => new Date(state.clock));
  const reader = new AiTaskEventRepository(db, { resolve: async () => clone(state.grant.context) }, () => new Date(state.clock));
  return { state, db, authority, repository, reader, run: reason => { const input = clone(command); input.reason = reason ?? state.grant.reason; return repository.transition(input); } };
}
const code = expected => error => error instanceof AiTaskRepositoryError && error.code === expected && error.message === expected;
module.exports = { setup, command, now, outcomes, code, clone, contexts, matches, AiStepTransitionRepository };
