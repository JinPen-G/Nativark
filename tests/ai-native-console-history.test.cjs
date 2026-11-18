'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ skipProject: true, transpileOnly: true, moduleTypes: { '**': 'cjs' }, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { NativeOperatorSession, nativeAgentRun } = require('../apps/admin/src/features/ai-operator/native-session');

test('archived history and later pages remain readable with a full journal of unresolved sends', async () => {
  const scene = 'order_explanation', signal = new AbortController().signal;
  const originals = Array.from({ length: 100 }, (_, index) => ({ chatId: `chat-${index}`, scene, conversationId: null, pending: true }));
  const storage = { getItem: () => JSON.stringify(originals), setItem: () => assert.fail('history wrote to the journal') };
  const session = new NativeOperatorSession({ storage, identity: 'owner', current: () => true, tasks: {}, api: {
    list: async query => { assert.equal(query.status, 'archived'); assert.equal(query.beforeId, 'cursor'); return { items: [], nextBeforeId: null }; },
    detail: async () => ({ conversation: { status: 'archived', currentTurn: null }, turns: { items: [] } }),
  } });
  assert.equal((await session.history(scene, signal, 'archived', 'cursor')).nextBeforeId, null);
  assert.equal((await session.open('history', 'original', scene, signal)).historical, true);
  assert.deepEqual(session.locatorsSnapshot(), originals);
});

test('the actual run distinguishes partial completion and an unknown step', () => {
  const run = nativeAgentRun({ status: 'partially_succeeded', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:05Z',
    steps: [{ stepId: 'step', sequence: 1, kind: 'model', status: 'unknown' }] });
  assert.equal(run.status, 'partial'); assert.equal(run.steps[0].status, 'unknown');
});

test('Copilot verifies the original order, closure and idle revision before releasing a local conversation', async () => {
  const { CopilotOrderSession } = require('../apps/admin/src/features/copilot/copilot-order-session');
  const { commandHash } = require('../apps/admin/src/features/ai-native/budget-settings-session');
  const shared = require('@rental-os/shared');
  const draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION, conversationId = 'conversation';
  const requestHash = await commandHash({sceneCode:'order_explanation',input:{orderId:'order',question:'fees'}});
  const proof = {operationKey:'close',admissionKey:'admit',turnId:'turn',originalInputRef:'input',requestHash};
  const head = {draftVersion,conversationId,revision:3,status:'active',capabilityCode:'order_explanation',currentTurn:null,closedTurn:proof};
  const turn = {admissionKey:'admit',turnId:'turn',originalRequestKey:'request',requestHash,capabilityCode:'order_explanation',capabilityVersion:'v1',
    createdAt:new Date().toISOString(),status:'original_bound',automaticRetry:false,original:{draftVersion:shared.AI_SCENE_REQUEST_DRAFT_VERSION,inputRef:'input'},
    execution:'not_inferred_from_association',material:'retained',task:null,creation:'permanently_closed',closeOperationKey:'close'};
  const receipt = {draftVersion:shared.AI_CONVERSATION_UNSTARTED_DRAFT_VERSION,status:'observed',operationKey:'close',retryable:false,
    conversationId,revision:3,operation:'close_unstarted',creation:'permanently_closed',task:'not_created',taskCancellation:'not_requested',businessRecords:'not_modified'};
  for (const scenario of ['closed','empty','otherOrder','oldReceipt','changedOnRead','changedBeforeClear','wrongKey']) {
    const raw = JSON.stringify({version:1,createKey:'create',conversationId}), key = 'ai-copilot-order:owner:order';
    const records = new Map([[key,raw]]); let reads = 0;
    const session = new CopilotOrderSession({
      detail: async (_input,_scene,_signal,includeClosedTurn) => {
        assert.equal(includeClosedTurn,true); reads++;
        return {conversation:{...head,revision:scenario === 'changedOnRead' && reads > 1 || scenario === 'changedBeforeClear' && reads > 2 ? 5 : 3,
          closedTurn:scenario === 'empty' ? undefined : scenario === 'otherOrder' ? {...proof,requestHash:'a'.repeat(64)} : proof}};
      },
      admission: async () => ({draftVersion,conversationId,admissionKey:'admit',result:turn,absence:'not_proof_of_no_commit',retryable:false}),
      operation: async () => ({...receipt,revision:scenario === 'oldReceipt' ? 2 : 3,operationKey:scenario === 'wrongKey' ? 'different' : 'close'}),
    }, {getItem:key => records.get(key) ?? null,removeItem:key => records.delete(key),setItem:() => assert.fail('unexpected write')},'owner','order',() => true);
    session.activate();
    if (scenario === 'closed' || scenario === 'changedBeforeClear') {
      await session.read(); assert.equal(session.snapshot().complete,true);
      if (scenario === 'closed') { await session.newChat(); assert.equal(records.has(key),false); continue; }
    } else await assert.rejects(session.read());
    await assert.rejects(session.newChat()); assert.equal(records.get(key),raw);
  }
});
