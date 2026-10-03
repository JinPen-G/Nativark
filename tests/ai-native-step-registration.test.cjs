'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, validatorsFor, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
const h = require('./fixtures/ai-native/step-registration.cjs');
const { code } = require('./fixtures/ai-native/step-repository.cjs');
const { AI_TASK_DRAFT_COMPONENT_SCHEMAS: schemas } = require('../apps/api/src/contracts/ai-task-draft-schemas');
const { AI_NATIVE_COMPONENT_SCHEMAS: foundation } = require('../apps/api/src/contracts/ai-native-schemas');
const validate = validatorsFor(schemas, foundation).AiTaskEventDraft;
const snapshot = f => h.clone({ task: f.state.task, run: f.state.run, steps: f.state.steps, events: f.state.events });
const of = (f, kind) => f.state.calls.find(c => c.kind === kind)?.args;

test('server plan registers PENDING/NONE under task lock and live run fencing, with one event', async () => {
  const f = h.setup(), out = await f.run(), row = f.state.steps[0];
  assert.equal(out.replayed, false); assert.equal(out.taskRevision, 4); assert.equal(out.runRevision, 6); assert.equal(out.stepRevision, 1); assert.equal(out.sequence, 1);
  assert.equal(row.status, 'PENDING'); assert.equal(row.effect, 'NONE'); assert.equal(row.resultRef, null); assert.equal(row.errorCode, null);
  assert.match(row.actionId, /^ai-action-[a-f0-9]{64}$/); assert.equal(row.requestFingerprint, 'a'.repeat(64)); assert.equal(row.inputRef, 'input-1');
  assert.equal(row.scopeId, 'scope-1'); assert.equal(row.taskId, 'task-1'); assert.equal(row.runId, 'run-1');
  assert.equal(f.state.task.revision, 4); assert.equal(f.state.task.eventCursor, 8n); assert.equal(f.state.run.fencingToken, 9007199254740993n);
  assert.equal(validate(out.event), true, JSON.stringify(validate.errors));
  assert.deepEqual(f.state.calls.map(c => c.kind), ['authorize', 'transaction', 'task.read', 'step.read', 'task.lock', 'steps.read', 'run.lock', 'authorize', 'run.recheck', 'step.create', 'event.create']);
  assert.deepEqual(f.state.calls[1].options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  assert.equal(of(f, 'steps.read').take, 1001); assert.equal('inputRef' in out, false); assert.equal('actionId' in out.event.data, false);
});

test('registered event round-trips through real polling and remains distinct from start', async () => {
  const f = h.setup(), out = await f.run();
  const page = await f.reader.readPage({ taskId: 'task-1', after: '7', limit: 10 });
  assert.deepEqual(page.events, [out.event]); assert.equal(page.nextCursor, '8');
  for (const secret of ['input-1', 'plan-action-1', 'policy:1']) assert.equal(JSON.stringify(page).includes(secret), false);
  assert.equal(page.events[0].type, 'step.registered'); assert.equal('reason' in page.events[0].data, false);
  assert.deepEqual(compileConsumer('import type { AiTaskEventDraft } from "../packages/shared/src/ai-task-draft"; declare const e: AiTaskEventDraft; if (e.type === "step.registered") { const r: 1 = e.data.stepRevision; e.data.sequence; }'), []);
  for (const patch of [{ stepRevision: 2 }, { sequence: 0 }, { sequence: 4294967296 }, { actorId: 'forged' }]) assert.equal(validate({ ...out.event, data: { ...out.event.data, ...patch } }), false);
});

test('registration composes with real step transition and event reader without business dispatch', async () => {
  const f = h.setup(), first = await f.run();
  const changed = await f.transition().transition({ taskId: 'task-1', stepId: first.stepId, expectedTaskRevision: 4, expectedStepRevision: 1,
    evidenceId: 'start-evidence-1', reason: 'start', lease: { ...h.command.lease, revision: 6 } });
  assert.equal(f.state.steps[0].status, 'RUNNING'); assert.equal(f.state.steps[0].effect, 'NONE');
  assert.equal(changed.runRevision, 7); assert.equal(changed.event.taskRevision, 5);
  const page = await f.reader.readPage({ taskId: 'task-1', after: '7', limit: 10 });
  assert.deepEqual(page.events.map(e => [e.cursor, e.type]), [['8', 'step.registered'], ['9', 'step.changed']]);
  assert.equal(f.state.steps.length, 1); assert.equal(f.state.steps[0].actionId, of(f, 'step.create').data.actionId);
});

for (const status of ['PENDING', 'RUNNING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED']) test(`same reference replays original ${status} identity, never resetting status or lease`, async () => {
  const f = h.setup(), first = await f.run(); f.state.steps[0].status = status; f.state.steps[0].revision = 7;
  f.state.run.leaseExpiresAt = h.now; f.state.task.status = 'CANCEL_REQUESTED'; f.state.task.cancelRequestedAt = h.now;
  const before = snapshot(f), calls = f.state.calls.length, ids = f.state.ids;
  const replay = await f.run({ ...h.command, lease: { ...h.command.lease, runId: 'another-run' } });
  assert.equal(replay.replayed, true); assert.equal(replay.stepId, first.stepId); assert.equal(replay.runId, 'run-1'); assert.equal(replay.stepRevision, 7);
  assert.equal(replay.event, null); assert.equal(replay.runRevision, null); assert.equal(f.state.ids, ids); assert.deepEqual(snapshot(f), before);
  assert.deepEqual(f.state.calls.slice(calls).map(c => c.kind), ['authorize', 'transaction', 'task.read', 'step.read', 'authorize']);
});

for (const key of ['inputRef', 'requestFingerprint', 'toolVersion', 'toolCode']) test(`same plan with changed ${key} conflicts rather than creates another action`, async () => {
  const f = h.setup(); await f.run(); const before = snapshot(f);
  f.state.grant[key] = key === 'requestFingerprint' ? 'b'.repeat(64) : key === 'toolCode' ? 'rental.order.commit' : 'changed';
  await assert.rejects(f.run(), code('AI_REVISION_CONFLICT')); assert.deepEqual(snapshot(f), before);
});

for (const context of h.contexts) test(`registration owner/scope queries are complete for ${context.actor.kind}/${context.audience}`, async () => {
  const f = h.setup(context); await f.run();
  for (const kind of ['task.read', 'task.lock']) {
    const where = of(f, kind).where;
    assert.equal(where.ownerId, f.state.task.ownerId); assert.equal(where.ownerKind, f.state.task.ownerKind); assert.equal(where.audience, f.state.task.audience);
    assert.deepEqual(where.scope.is, f.state.task.scope); assert.equal(where.archivedAt, null);
  }
  for (const kind of ['run.lock', 'run.recheck']) {
    const where = of(f, kind).where; assert.equal(where.actorId, f.state.task.ownerId); assert.equal(where.scopeId, 'scope-1'); assert.equal(where.taskId, 'task-1');
    assert.equal(where.fencingToken.toString(), h.command.lease.fencingToken); assert.equal(where.leaseOwnerId, 'worker-1');
  }
});

test('sequence is server-allocated per original run and total task steps are bounded', async () => {
  const f = h.setup(); f.state.steps = [{ id: 'old', scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', sequence: 5, status: 'SUCCEEDED' },
    { id: 'other-run-step', scopeId: 'scope-1', taskId: 'task-1', runId: 'run-other', sequence: 99, status: 'SUCCEEDED' }];
  assert.equal((await f.run()).sequence, 6);
  for (const [count, expected] of [[999, true], [1000, false], [1001, false]]) {
    const f = h.setup(); f.state.steps = Array.from({ length: count }, (_, i) => ({ scopeId: 'scope-1', taskId: 'task-1', runId: 'run-1', sequence: i + 1, status: 'PENDING' }));
    if (expected) assert.equal((await f.run()).sequence, 1000); else await assert.rejects(f.run(), code('AI_INVALID_INPUT'));
  }
});

for (const status of ['RUNNING', 'UNKNOWN']) test(`unresolved ${status} forbids registering a new action around the old one`, async () => {
  const f = h.setup(); f.state.steps = [{ scopeId: 'scope-1', taskId: 'task-1', runId: 'original-run', sequence: 1, status }]; const before = snapshot(f);
  await assert.rejects(f.run(), code('AI_INVALID_INPUT')); assert.deepEqual(snapshot(f), before);
});

for (const [label, mutate, expected] of [
  ['different owner', f => { f.state.task.ownerId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['different tenant', f => { f.state.task.scope.tenantId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['different workspace', f => { f.state.task.scope.workspaceId = 'other'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['different audience', f => { f.state.task.audience = 'CLIENT'; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['archived', f => { f.state.task.archivedAt = h.now; }, 'AI_RESOURCE_UNAVAILABLE'],
  ['old version', f => { f.state.task.contractVersion = 'old'; }, 'AI_INVALID_INPUT'],
  ['cancelled intent', f => { f.state.task.cancelRequestedAt = h.now; }, 'AI_INVALID_INPUT'],
  ['waiting task', f => { f.state.task.status = 'WAITING_EXTERNAL'; }, 'AI_INVALID_INPUT'],
  ['completed task', f => { f.state.task.status = 'SUCCEEDED'; }, 'AI_INVALID_INPUT'],
  ['old task revision', f => f.state.task.revision++, 'AI_REVISION_CONFLICT'],
  ['max cursor', f => { f.state.task.eventCursor = 18446744073709551615n; }, 'AI_REVISION_CONFLICT'],
  ['expired lease', f => { f.state.run.leaseExpiresAt = h.now; }, 'AI_REVISION_CONFLICT'],
  ['other holder', f => { f.state.run.leaseOwnerId = 'other'; }, 'AI_REVISION_CONFLICT'],
  ['other fence', f => f.state.run.fencingToken++, 'AI_REVISION_CONFLICT'],
  ['other run task', f => { f.state.run.taskId = 'other'; }, 'AI_REVISION_CONFLICT'],
  ['terminal run', f => { f.state.run.status = 'SUCCEEDED'; }, 'AI_REVISION_CONFLICT']
]) test(`fresh registration rejects ${label} without partial changes`, async () => {
  const f = h.setup(); mutate(f); const before = snapshot(f);
  await assert.rejects(f.run(), code(expected)); assert.deepEqual(snapshot(f), before);
});

for (const kind of ['task.lock', 'steps.read', 'run.lock', 'run.recheck', 'step.create', 'event.create', 'commit', 'id', 'unique']) test(`failure at ${kind} rolls back metadata and exposes no event`, async () => {
  const f = h.setup(); f.state.fail = kind; const before = snapshot(f);
  await assert.rejects(f.run(), code(kind === 'unique' ? 'AI_REVISION_CONFLICT' : 'AI_STORAGE_UNAVAILABLE')); assert.deepEqual(snapshot(f), before);
  assert.equal(f.state.calls.filter(c => c.kind === 'transaction').length, 1);
});

for (const mutate of [g => { g.registrationAllowed = false; }, g => { g.authorizationKey = 'changed'; }, g => { g.context.access.permissions = []; },
  g => { g.inputRef = 'other'; }, g => { g.requestFingerprint = 'b'.repeat(64); }, g => { g.expiresAt = h.now.toISOString(); }]) test('authorization or frozen input change after run lock aborts before create', async () => {
  const f = h.setup(); f.state.authHooks[2] = mutate; const before = snapshot(f);
  await assert.rejects(f.run(), code('AI_ACCESS_DENIED')); assert.deepEqual(snapshot(f), before); assert.equal(f.state.calls.some(c => c.kind === 'step.create'), false);
});

test('lease expiry during lock wait is checked against fresh clock', async () => {
  const f = h.setup(); f.state.hooks['run.lock'] = () => { f.state.clock = new Date(h.now.getTime() + 11000); };
  await assert.rejects(f.run(), code('AI_REVISION_CONFLICT')); assert.equal(f.state.steps.length, 0);
});

test('concurrent same-plan registration has one identity and one event in serialized test store', async () => {
  const f = h.setup(), results = await Promise.all([f.run(), f.run()]);
  assert.equal(results[0].stepId, results[1].stepId); assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(f.state.steps.length, 1); assert.equal(f.state.events.length, 1);
});

test('ambiguous commit is not automatically retried; an explicit replay finds the original step', async () => {
  const f = h.setup(); f.state.fail = 'commit_ack';
  await assert.rejects(f.run(), code('AI_STORAGE_UNAVAILABLE')); assert.equal(f.state.steps.length, 1);
  f.state.fail = null; const again = await f.run(); assert.equal(again.replayed, true); assert.equal(f.state.steps.length, 1); assert.equal(f.state.events.length, 1);
});

test('replay must reauthorize and cannot disclose an original step after revocation', async () => {
  const f = h.setup(); await f.run(); f.state.authHooks[4] = () => { throw Error('revoked'); };
  await assert.rejects(f.run(), code('AI_ACCESS_DENIED')); assert.equal(f.state.steps.length, 1);
});

test('caller cannot supply action identity, fingerprint, input, effect or scope', async () => {
  for (const patch of [{ actionId: 'forged' }, { sequence: 1 }, { requestFingerprint: 'a'.repeat(64) }, { inputRef: 'input-1' }, { effect: 'committed' },
    { tenantId: 'other' }, { actorId: 'admin' }, { expectedTaskRevision: 0 }, { lease: { ...h.command.lease, fencingToken: '0' } }]) {
    const f = h.setup(); await assert.rejects(f.run({ ...h.command, ...patch }), code('AI_INVALID_INPUT')); assert.equal(f.state.calls.length, 0);
  }
  assert.throws(() => new h.AiStepRegistrationRepository({}, null), code('AI_ACCESS_DENIED'));
});

test('forged grant shape or unrelated frozen reference fails before opening a transaction', async () => {
  for (const mutate of [g => { g.taskId = 'other'; }, g => { g.registrationRef = 'other'; }, g => { g.toolCode = 'arbitrary.http'; },
    g => { g.requestFingerprint = 'unhashed'; }, g => { g.registrationAllowed = false; }, g => { g.context.audience = 'client'; }]) {
    const f = h.setup(); f.state.authHooks[1] = mutate; await assert.rejects(f.run(), code('AI_ACCESS_DENIED')); assert.equal(f.state.calls.length, 1);
  }
});
