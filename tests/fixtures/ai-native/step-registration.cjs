'use strict';
const { clone, matches, contexts, now, AiStepTransitionRepository } = require('./step-repository.cjs');
const { createRequire } = require('node:module');
const path = require('node:path');
const apiRequire = createRequire(path.resolve(__dirname, '../../../apps/api/package.json'));
const { Prisma } = apiRequire('@prisma/client');
const { AiStepRegistrationRepository } = require('../../../apps/api/src/modules/ai-native/ai-step-registration.repository');
const { AiTaskEventRepository } = require('../../../apps/api/src/modules/ai-native/ai-task-event.repository');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const command = { taskId: 'task-1', registrationRef: 'plan-action-1', expectedTaskRevision: 3,
  lease: { runId: 'run-1', holderId: 'worker-1', revision: 5, fencingToken: '9007199254740993' } };
const project = (row, select) => row && clone(Object.fromEntries(Object.keys(select).map(k => [k, row[k]])));
function apply(row, data) { for (const [key, v] of Object.entries(data)) row[key] = v && typeof v === 'object' && 'increment' in v ? row[key] + v.increment : clone(v); }
function setup(context = contexts[0]) {
  const ownerId = context.actor.userId ?? context.actor.customerId ?? context.actor.subjectId;
  const state = { calls: [], fail: null, hooks: {}, authHooks: {}, authCount: 0, commits: 0, rollbacks: 0, clock: new Date(now), ids: 0,
    grant: { context: clone(context), registrationAllowed: true, authorizationKey: 'policy:1', taskId: 'task-1', registrationRef: 'plan-action-1',
      expiresAt: '2026-10-03T10:01:00Z', toolCode: 'rental.order.explain', toolVersion: 'draft-1', inputRef: 'input-1', requestFingerprint: 'a'.repeat(64) },
    task: { id: 'task-1', scopeId: 'scope-1', scopeKind: context.scope.kind.toUpperCase(), scope: aiPersistenceScopeColumns(context.scope),
      audience: context.audience.toUpperCase(), ownerKind: context.actor.kind.toUpperCase(), ownerId, archivedAt: null,
      contractVersion: 'ain-c04-draft-1', revision: 3, eventCursor: 7n, status: 'RUNNING', cancelRequestedAt: null,
      ...(context.actor.kind === 'automation' ? { policyId: context.actor.policyId, policyRevision: context.actor.policyRevision, policyExpiresAt: new Date(context.actor.expiresAt) } : {}) },
    run: { id: 'run-1', scopeId: 'scope-1', taskId: 'task-1', revision: 5, fencingToken: 9007199254740993n, leaseOwnerId: 'worker-1',
      leaseExpiresAt: new Date(now.getTime() + 10000), status: 'RUNNING', actorKind: context.actor.kind.toUpperCase(), actorId: ownerId }, steps: [], events: [] };
  const authority = { resolve: async input => { state.calls.push({ kind: 'authorize', input: clone(input) }); const grant = clone(state.grant); if (state.authHooks[++state.authCount]) await state.authHooks[state.authCount](grant, input); return grant; } };
  let queue = Promise.resolve();
  const db = { aiTask: {}, aiRun: {}, $transaction: async (callback, options) => {
    const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous;
    state.calls.push({ kind: 'transaction', options });
    const w = clone({ task: state.task, run: state.run, steps: state.steps, events: state.events });
    const hook = async (kind, args) => { state.calls.push({ kind, args }); if (state.hooks[kind]) await state.hooks[kind](w, args); if (state.fail === kind) throw Error('synthetic private SQL failure'); };
    const update = async (kind, row, args) => { await hook(kind, args); if (!row || !matches(row, args.where)) return { count: 0 }; apply(row, args.data); return { count: 1 }; };
    let runUpdates = 0;
    const tx = {
      aiTask: { findFirst: async args => { await hook('task.read', args); return matches(w.task, args.where) ? project(w.task, args.select) : null; }, updateMany: args => update('task.lock', w.task, args) },
      aiRun: { updateMany: args => update(++runUpdates === 1 ? 'run.lock' : 'run.recheck', w.run, args) },
      aiStep: {
        findFirst: async args => { await hook('step.read', args); return project(w.steps.find(s => matches(s, args.where)) ?? null, args.select); },
        findMany: async args => { await hook('steps.read', args); return w.steps.filter(s => matches(s, args.where)).slice(0, args.take).map(s => project(s, args.select)); },
        updateMany: args => update('step.update', w.steps.find(s => matches(s, args.where)), args),
        create: async args => {
          await hook('step.create', args);
          if (state.fail === 'unique' || w.steps.some(s => s.id === args.data.id || (s.scopeId === args.data.scopeId && s.taskId === args.data.taskId && s.actionId === args.data.actionId) || (s.scopeId === args.data.scopeId && s.runId === args.data.runId && s.sequence === args.data.sequence))) throw new Prisma.PrismaClientKnownRequestError('synthetic unique', { code: 'P2002', clientVersion: 'test' });
          w.steps.push(clone(args.data)); return { id: args.data.id };
        }
      },
      aiTaskEvent: { create: async args => { await hook('event.create', args); w.events.push(clone(args.data)); return { cursor: args.data.cursor }; },
        findMany: async args => { await hook('event.read', args); return w.events.filter(e => matches(e, args.where)).sort((a,b) => a.cursor < b.cursor ? -1 : 1).slice(0, args.take).map(e => project(e, args.select)); } }
    };
    try { const result = await callback(tx); if (state.fail === 'commit') throw Error('synthetic failed commit'); Object.assign(state, w); state.commits++; if (state.fail === 'commit_ack') throw Error('synthetic commit acknowledgement loss'); return result; }
    catch (error) { state.rollbacks++; throw error; } finally { release(); }
  } };
  const newId = () => { state.ids++; return state.fail === 'id' ? 'invalid' : `00000000-0000-4000-8000-${String(state.ids).padStart(12, '0')}`; };
  const repository = new AiStepRegistrationRepository(db, authority, () => new Date(state.clock), newId);
  const reader = new AiTaskEventRepository(db, { resolve: async () => clone(state.grant.context) }, () => new Date(state.clock));
  const transition = () => new AiStepTransitionRepository(db, { resolve: async input => {
    const row = state.steps.find(s => s.id === input.stepId);
    const step = { stepId: row.id, runId: row.runId, sequence: row.sequence, revision: row.revision, actionId: row.actionId, requestFingerprint: row.requestFingerprint,
      toolCode: row.toolCode, toolVersion: row.toolVersion, outcome: { status: 'pending', effect: 'none' } };
    return { context: clone(context), transitionAllowed: true, authorizationKey: 'policy:1', taskId: input.taskId, evidenceId: input.evidenceId, evidenceRevision: 1,
      expiresAt: '2026-10-03T10:01:00Z', reason: input.reason, previous: step, next: { ...step, revision: row.revision + 1, outcome: { status: 'running', effect: 'none' } }, previousResultRef: null, resultRef: null };
  } }, () => new Date(state.clock));
  return { state, db, authority, repository, reader, transition, run: (input = command) => repository.register(clone(input)) };
}
module.exports = { setup, command, now, contexts, clone, AiStepRegistrationRepository };
