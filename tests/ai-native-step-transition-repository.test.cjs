'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const h = require('./fixtures/ai-native/step-repository.cjs');
const argsFor = (f, kind) => f.state.calls.find(c => c.kind === kind)?.args;
const snapshot = f => h.clone({ task: f.state.task, run: f.state.run, step: f.state.step, events: f.state.events });

for (const [from, to, reason] of [
  ['pending', 'running', 'start'], ['pending', 'cancelled', 'not_started_cancelled'],
  ['running', 'succeeded', 'result_observed'], ['running', 'failed', 'result_observed'],
  ['running', 'unknown', 'result_unknown'], ['unknown', 'succeeded', 'reconciled_committed'],
  ['unknown', 'failed', 'reconciled_not_committed'], ['retryable', 'running', 'retry_known_failure'],
  ['readRunning', 'read', 'result_observed']
]) test(`atomic ${from} to ${to} preserves action identity and records only references`, async () => {
  const f = h.setup(from, to); f.state.grant.reason = reason;
  const before = snapshot(f), result = await f.run();
  assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
  assert.equal(f.state.task.revision, 4); assert.equal(f.state.task.eventCursor, 9007199254740994n);
  assert.equal(f.state.task.status, 'RUNNING'); assert.equal(f.state.run.revision, 6);
  assert.equal(f.state.run.fencingToken, before.run.fencingToken);
  assert.equal(f.state.step.status, f.state.grant.next.outcome.status.toUpperCase()); assert.equal(f.state.step.revision, 3);
  for (const key of ['id', 'runId', 'scopeId', 'taskId', 'sequence', 'toolCode', 'toolVersion', 'actionId', 'requestFingerprint']) assert.equal(f.state.step[key], before.step[key]);
  assert.equal(f.state.step.resultRef, f.state.grant.resultRef);
  assert.equal(f.state.events.length, 1); assert.equal(result.runRevision, 6); assert.equal(result.event.cursor, '9007199254740994');
  assert.deepEqual(result.event.data, { stepId: 'step-1', runId: 'run-1', stepRevision: 3, status: f.state.grant.next.outcome.status, reason });
  assert.equal('evidence' in result.event, false); assert.equal('facts' in result.event.data, false);
  assert.equal('resultRef' in result.event.data, false); assert.equal('error' in result.event.data, false);
  assert.equal(f.state.events[0].payload.evidence.id, 'evidence-1');
  assert.equal(f.state.events[0].payload.evidence.digest.length, 64);
  assert.equal(f.state.calls.find(c => c.kind === 'transaction').options.isolationLevel, 'Serializable');
  assert.deepEqual(f.state.calls.map(c => c.kind), ['authorize', 'transaction', 'task.read', 'task.lock', 'step.read', 'run.lock', 'authorize', 'run.recheck', 'step.update', 'event.create']);
});

test('committed step event is readable through real polling repository without internal evidence', async () => {
  const f = h.setup(); const result = await f.run();
  const page = await f.reader.readPage({ taskId: 'task-1', after: '9007199254740993', limit: 1 });
  assert.deepEqual(page.events, [result.event]); assert.equal(page.nextCursor, '9007199254740994'); assert.equal(page.hasMore, false);
  assert.equal(JSON.stringify(page).includes('evidence-1'), false); assert.equal(JSON.stringify(page).includes('result-new'), false);
});

for (const context of h.contexts) test(`task/step/run writes bind full principal for ${context.actor.kind}/${context.audience}`, async () => {
  const f = h.setup('readRunning', 'read', context); await f.run();
  for (const kind of ['task.read', 'task.lock']) {
    const where = argsFor(f, kind).where;
    assert.equal(where.ownerId, f.state.task.ownerId); assert.equal(where.ownerKind, f.state.task.ownerKind);
    assert.equal(where.audience, f.state.task.audience); assert.deepEqual(where.scope.is, f.state.task.scope);
    assert.equal(where.archivedAt, null);
  }
  for (const kind of ['run.lock', 'run.recheck']) {
    const where = argsFor(f, kind).where;
    assert.equal(where.id, 'run-1'); assert.equal(where.scopeId, 'scope-1'); assert.equal(where.taskId, 'task-1');
    assert.equal(where.actorId, f.state.task.ownerId); assert.equal(where.actorKind, f.state.task.ownerKind);
    assert.equal(where.fencingToken.toString(), h.command.lease.fencingToken); assert.equal(where.leaseOwnerId, 'worker-1');
  }
  const where = argsFor(f, 'step.update').where;
  assert.equal(where.revision, 2); assert.equal(where.taskId, 'task-1'); assert.equal(where.scopeId, 'scope-1'); assert.equal(where.runId, 'run-1');
  assert.equal(where.actionId, f.state.step.actionId); assert.equal(where.requestFingerprint, 'a'.repeat(64));
});

for (const [label, mutate, expected] of [
  ['task revision', f => f.state.task.revision++, 'AI_REVISION_CONFLICT'],
  ['cursor overflow', f => { f.state.task.eventCursor = 18446744073709551615n; }, 'AI_REVISION_CONFLICT'],
  ['old task contract', f => { f.state.task.contractVersion = 'old'; }, 'AI_INVALID_INPUT'],
  ['terminal task', f => { f.state.task.status = 'SUCCEEDED'; }, 'AI_INVALID_INPUT'],
  ['queued task', f => { f.state.task.status = 'QUEUED'; }, 'AI_INVALID_INPUT'],
  ['waiting for confirmation', f => { f.state.task.status = 'WAITING_CONFIRMATION'; }, 'AI_INVALID_INPUT'],
  ['other tenant', f => { f.state.task.scope.tenantId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other workspace', f => { f.state.task.scope.workspaceId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other owner', f => { f.state.task.ownerId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other audience', f => { f.state.task.audience = 'CLIENT'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['archived task', f => { f.state.task.archivedAt = h.now; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other step task', f => { f.state.step.taskId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other step scope', f => { f.state.step.scopeId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['other step run', f => { f.state.step.runId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['step revision', f => f.state.step.revision++, 'AI_REVISION_CONFLICT'],
  ['different action', f => { f.state.step.actionId = 'other'; }, 'AI_REVISION_CONFLICT'],
  ['different fingerprint', f => { f.state.step.requestFingerprint = 'b'.repeat(64); }, 'AI_REVISION_CONFLICT'],
  ['different input version', f => { f.state.step.toolVersion = 'future'; }, 'AI_REVISION_CONFLICT'],
  ['stored result changed', f => { f.state.step.resultRef = 'other'; }, 'AI_REVISION_CONFLICT'],
  ['new lease holder', f => { f.state.run.leaseOwnerId = 'other'; }, 'AI_REVISION_CONFLICT'],
  ['new lease revision', f => f.state.run.revision++, 'AI_REVISION_CONFLICT'],
  ['new fence', f => f.state.run.fencingToken++, 'AI_REVISION_CONFLICT'],
  ['expired lease', f => { f.state.run.leaseExpiresAt = h.now; }, 'AI_REVISION_CONFLICT'],
  ['terminal run', f => { f.state.run.status = 'SUCCEEDED'; }, 'AI_REVISION_CONFLICT'],
  ['inconsistent cancel marker', f => { f.state.task.cancelRequestedAt = h.now; }, 'AI_INVALID_INPUT']
]) test(`reject ${label} without event or partial mutation`, async () => {
  const f = h.setup(); mutate(f); const before = snapshot(f);
  await assert.rejects(f.run(), h.code(expected)); assert.deepEqual(snapshot(f), before); assert.equal(f.state.commits, 0);
});

for (const kind of ['task.lock', 'step.read', 'run.lock', 'run.recheck', 'step.update', 'event.create', 'commit']) test(`failure at ${kind} rolls back the transaction double and never auto-retries`, async () => {
  const f = h.setup(), before = snapshot(f); f.state.fail = kind;
  await assert.rejects(f.run(), kind === 'commit'
    ? error => error.code === 'AI_RESULT_UNKNOWN' && error.retryable === false && error.nextAction === 'reconcile'
    : h.code('AI_STORAGE_UNAVAILABLE'));
  assert.deepEqual(snapshot(f), before); assert.equal(f.state.rollbacks, 1);
  assert.equal(f.state.calls.filter(c => c.kind === 'transaction').length, 1);
});

for (const kind of ['task.lock', 'run.lock', 'run.recheck', 'step.update']) test(`zero matched ${kind} never reports success`, async () => {
  const f = h.setup(), before = snapshot(f); f.state.hooks[kind] = (_, args) => { args.where.id = 'absent'; };
  await assert.rejects(f.run(), h.code('AI_REVISION_CONFLICT')); assert.deepEqual(snapshot(f), before);
});

test('commit acknowledgement loss can retain a write but never reports success or repeats it', async () => {
  const f = h.setup(); f.state.fail = 'commit_ack';
  await assert.rejects(f.run(), error => error.code === 'AI_RESULT_UNKNOWN'
    && error.retryable === false && error.nextAction === 'reconcile');
  assert.equal(f.state.step.revision, 3); assert.equal(f.state.events.length, 1);
  assert.equal(f.state.calls.filter(c => c.kind === 'transaction').length, 1);
});

for (const mutate of [
  g => { g.context.scope.workspaceId = 'other'; }, g => { g.context.actor.userId = 'other'; },
  g => { g.authorizationKey = 'revoked-policy'; }, g => { g.transitionAllowed = false; },
  g => { g.context.access.dataScope = 'self'; }, g => { g.context.access.permissions = []; },
  g => { g.evidenceRevision++; }, g => { g.next.outcome.facts[0].resourceId = 'other'; },
  g => { g.resultRef = 'other'; }, g => { g.expiresAt = h.now.toISOString(); }
]) test('authorization or evidence change after task and run locks discards all mutations', async () => {
  const f = h.setup(), before = snapshot(f); f.state.authHooks[2] = mutate;
  await assert.rejects(f.run(), h.code('AI_ACCESS_DENIED')); assert.deepEqual(snapshot(f), before);
  assert.equal(f.state.calls.some(c => c.kind === 'step.update'), false);
});

test('lease expiry during a lock wait is checked with refreshed server time', async () => {
  const f = h.setup(), before = snapshot(f);
  f.state.hooks['run.lock'] = () => { f.state.clock = new Date(h.now.getTime() + 11000); };
  await assert.rejects(f.run(), h.code('AI_REVISION_CONFLICT')); assert.deepEqual(snapshot(f), before);
  assert.equal(argsFor(f, 'run.recheck').where.leaseExpiresAt.gt.getTime(), h.now.getTime() + 11000);
});

for (const mutate of [
  g => { g.taskId = 'other'; }, g => { g.evidenceId = 'other'; }, g => { g.previous.revision++; },
  g => { g.previous.stepId = 'other'; }, g => { g.previous.runId = 'other'; },
  g => { g.next.outcome.facts = []; }, g => { g.next.outcome.facts[0].scope.tenantId = 'other'; },
  g => { g.next.outcome.facts[0].observedAt = '2027-01-01T00:00:00Z'; },
  g => { g.resultRef = null; }, g => { g.previousResultRef = 'forged-old-result'; },
  g => { g.previous.sequence = 4294967296; }, g => { g.next.outcome.approved = true; },
  g => { g.transitionAllowed = false; }, g => { g.authorizationKey = ''; }
]) test('invalid server evidence is rejected before opening the transaction', async () => {
  const f = h.setup(); f.state.authHooks[1] = mutate;
  await assert.rejects(f.run(), h.code('AI_ACCESS_DENIED'));
  assert.equal(f.state.calls.length, 1);
});

for (const key of ['actionId', 'requestFingerprint', 'toolCode', 'toolVersion', 'runId', 'stepId', 'sequence']) test(`a transition cannot replace stable ${key}`, async () => {
  const f = h.setup();
  f.state.grant.next[key] = key === 'sequence' ? 2 : key === 'requestFingerprint' ? 'b'.repeat(64) : key === 'toolCode' ? 'rental.order.explain' : 'other';
  await assert.rejects(f.run(), h.code('AI_INVALID_INPUT')); assert.equal(f.state.events.length, 0);
});

for (const [from, to, reason] of [
  ['unknown', 'running', 'retry_known_failure'], ['unknown', 'cancelled', 'not_started_cancelled'],
  ['unknown', 'read', 'reconciled_committed'], ['failed', 'running', 'retry_known_failure'],
  ['succeeded', 'running', 'start'], ['cancelled', 'running', 'start'],
  ['readRunning', 'unknown', 'result_unknown'], ['readRunning', 'succeeded', 'result_observed'],
  ['running', 'failed', 'reconciled_not_committed']
]) test(`deny unsafe ${from} to ${to} (${reason})`, async () => {
  const f = h.setup(from, to); f.state.grant.reason = reason;
  const before = snapshot(f); await assert.rejects(f.run(), h.code('AI_INVALID_INPUT')); assert.deepEqual(snapshot(f), before);
});

for (const status of ['CANCEL_REQUESTED', 'WAITING_EXTERNAL']) test(`${status} allows reconciliation but never a new start`, async () => {
  const reconcile = h.setup('unknown', 'succeeded'); reconcile.state.grant.reason = 'reconciled_committed';
  reconcile.state.task.status = status; if (status === 'CANCEL_REQUESTED') reconcile.state.task.cancelRequestedAt = h.now;
  await reconcile.run(); assert.equal(reconcile.state.task.status, status);
  for (const from of ['pending', 'retryable']) {
    const start = h.setup(from, 'running'); start.state.grant.reason = from === 'pending' ? 'start' : 'retry_known_failure';
    start.state.task.status = status; if (status === 'CANCEL_REQUESTED') start.state.task.cancelRequestedAt = h.now;
    const before = snapshot(start); await assert.rejects(start.run(), h.code('AI_INVALID_INPUT')); assert.deepEqual(snapshot(start), before);
  }
});

test('unknown cannot be made retryable or relabelled failed-with-effect', async () => {
  for (const patch of [{ retryable: true }, { nextAction: 'retry_later' }]) {
    const f = h.setup('running', 'unknown'); f.state.grant.reason = 'result_unknown'; Object.assign(f.state.grant.next.outcome.error, patch);
    await assert.rejects(f.run(), h.code('AI_ACCESS_DENIED')); assert.equal(f.state.calls.length, 1);
  }
  const f = h.setup('running', 'failed'); f.state.grant.next.outcome.effect = 'committed';
  await assert.rejects(f.run(), h.code('AI_ACCESS_DENIED'));
});

test('a repeat or competing completion cannot append twice', async () => {
  const f = h.setup(); const results = await Promise.allSettled([f.run(), f.run()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'AI_REVISION_CONFLICT');
  assert.equal(f.state.events.length, 1); assert.equal(f.state.step.revision, 3);
});

test('caller cannot provide outcomes, facts, scope, actor, clock, or a zero/overflow revision', async () => {
  for (const patch of [{ outcome: h.outcomes.succeeded }, { facts: [] }, { tenantId: 'other' }, { actorId: 'admin' }, { occurredAt: h.now.toISOString() },
    { expectedStepRevision: 4294967295 }, { expectedTaskRevision: 0 }, { lease: { ...h.command.lease, fencingToken: '0' } }, { evidenceId: '' }]) {
    const f = h.setup(); await assert.rejects(f.repository.transition({ ...h.command, ...patch }), h.code('AI_INVALID_INPUT')); assert.equal(f.state.calls.length, 0);
  }
  assert.throws(() => new h.AiStepTransitionRepository({}, null), h.code('AI_ACCESS_DENIED'));
});

test('fresh authorization timestamps and request IDs do not invalidate unchanged evidence', async () => {
  const f = h.setup(); f.state.authHooks[2] = g => { g.context.authorizedAt = h.now.toISOString(); g.context.requestId = 'reauthorize-2'; };
  assert.equal((await f.run()).event.data.status, 'succeeded');
});

for (const kind of ['missing', 'legacy_current_fallback']) test(`${kind} alone cannot prove a committed write`, async () => {
  const f = h.setup(); f.state.grant.next.outcome.facts[0].basis = { kind, reason: 'snapshot_missing' };
  await assert.rejects(f.run(), h.code('AI_ACCESS_DENIED')); assert.equal(f.state.calls.length, 1);
});

test('removing the run-fence condition violates the stale-worker oracle', async () => {
  const safe = h.setup(); safe.state.run.fencingToken++;
  await assert.rejects(safe.run(), h.code('AI_REVISION_CONFLICT'));
  const mutant = h.setup(); mutant.state.run.fencingToken++;
  mutant.state.hooks['run.lock'] = (_, args) => { delete args.where.fencingToken; };
  mutant.state.hooks['run.recheck'] = (_, args) => { delete args.where.fencingToken; };
  assert.equal((await mutant.run()).event.data.status, 'succeeded', 'in-memory unsafe predicate mutant must break the oracle');
});
