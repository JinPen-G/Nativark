'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
const { AiBusinessScenesModule, AI_BUSINESS_SCENES } = require('../apps/api/src/modules/ai-native/scenes/business-scenes.module');
async function setup() {
  const order = await orderSetup(), business = await businessSetup();
  return { order, business, tools: composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard,
    credentials: order.credentials, business: business.business, reports: business.reports, memberships: business.memberships }) };
}
test('AIN13 AIN14 AIN15 scene preparation fixes original parent bindings before Guard waits', async () => {
  for (const kind of ['order', 'opening', 'quote']) {
    const h = kind === 'order' ? await setup() : await businessSetup(), scenes = h.tools.scenes;
    const deps = scenes.dependencies, subject = kind === 'order' ? h.order.state.user : h.h.identity.user;
    const command = kind === 'order' ? { requestKey: 'bound-order', orderId: 'order-a', question: 'status' }
      : kind === 'opening' ? { requestKey: 'bound-opening', sections: ['item_groups'] }
      : { requestKey: 'bound-quote', candidate: structuredClone(h.candidate) };
    const method = kind === 'order' ? 'prepareOrderExplanation' : kind === 'opening' ? 'prepareOpeningDiagnosis' : 'prepareQuoteClarification';
    const invoke = parent => scenes[method](command, parent);
    const acquire = () => kind === 'order'
      ? deps.orderAuthority('order-a').withOrderRead(async context => structuredClone(context))
      : (kind === 'opening' ? deps.openingAuthority : deps.quoteAuthority).withRead(kind === 'opening' ? 'opening' : 'quote_context', kind === 'opening' ? { limit: 50 } : {}, async context => structuredClone(context));
    const parent = await acquire(), originalParent = structuredClone(parent), originalCommand = structuredClone(command);
    const actorId = subject.id, writes = (kind === 'order' ? h.business : h).businessFacts.writes.length;
    const orderBefore = kind === 'order' ? structuredClone(h.order.state.order) : undefined;
    const check = result => {
      assert.equal(result.payload.status, 'prepared_not_persisted');
      assert.equal(result.payload.request.ownerId, subject.id); assert.equal(result.payload.task.status, 'unavailable');
      assert.equal(result.payload.request.persistence, 'not_attempted_missing_original_request_repository');
      assert.equal(result.payload.execution, 'not_attempted'); assert.equal(result.payload.model, 'not_called');
      assert.equal(result.payload.request.inputRef, undefined);
      if (kind === 'opening') assert.deepEqual(result.payload.materials.sections.map(row => row.key), ['item_groups']);
      if (kind === 'quote') { assert.equal(result.payload.quotation, 'not_created'); assert.equal(result.payload.orderApproval, 'not_granted'); }
    };
    check(await invoke({ ...structuredClone(parent), requestId: 'another-observation', authorizedAt: '2020-01-01T00:00:00Z' }));
    let materialReads = 0, intercepted = false;
    const originalMaterial = kind === 'order' ? deps.orderMaterial : kind === 'opening' ? deps.opening.read : deps.quote.prepareInput;
    if (kind === 'order') deps.orderMaterial = (...args) => {
      const material = originalMaterial(...args), prepare = material.prepare.bind(material);
      material.prepare = (...values) => { materialReads++; return prepare(...values); }; return material;
    };
    else {
      const source = kind === 'opening' ? deps.opening : deps.quote, operation = kind === 'opening' ? 'read' : 'prepareInput';
      source[operation] = function(...args) { materialReads++; return originalMaterial.apply(this, args); };
    }
    const authority = kind === 'opening' ? deps.openingAuthority : deps.quoteAuthority;
    const originalAuthority = kind === 'order' ? deps.orderAuthority : authority.withRead;
    const alterWaitingCaller = async () => {
      await Promise.resolve();
      if (!intercepted) {
        intercepted = true;
        // Caller-owned expected context and the new synthetic current subject
        // change before the real Guard runs. No Guard, token, permission or
        // business-source success is forged; each new actor gets a real grant.
        parent.actor.userId = 'new-scene-current-reader'; subject.id = parent.actor.userId;
      }
    };
    if (kind === 'order') deps.orderAuthority = (...args) => {
      const current = originalAuthority(...args), withRead = current.withOrderRead.bind(current);
      current.withOrderRead = async (...values) => { await alterWaitingCaller(); return withRead(...values); }; return current;
    };
    else authority.withRead = async function(...args) { await alterWaitingCaller(); return originalAuthority.apply(this, args); };
    const restoreAuthority = () => { if (kind === 'order') deps.orderAuthority = originalAuthority; else authority.withRead = originalAuthority; };
    try {
      // Preserve the order route's existing public scope-error mapping.
      const deniedCode = kind === 'order' ? 'AI_ACCESS_DENIED' : 'FORBIDDEN';
      await assert.rejects(invoke(parent), error => error.code === deniedCode, `${kind}: mutating the waiting caller cannot replace its original parent`);
      assert.equal(intercepted, true); assert.equal(materialReads, 0, 'reject before source material reads');
      restoreAuthority();
      const fresh = await acquire(); assert.equal(fresh.actor.userId, 'new-scene-current-reader');
      check(await invoke(fresh)); assert.ok(materialReads > 0, 'the new actor can still use a genuinely new current request');
      subject.id = actorId; check(await invoke(originalParent));
      subject.permissions = [];
      await assert.rejects(invoke(originalParent), error => error.code === deniedCode, 'an immutable assertion cannot survive live withdrawal');
      assert.deepEqual(command, originalCommand);
      if (kind === 'order') assert.deepEqual(h.order.state.order, orderBefore);
      assert.equal((kind === 'order' ? h.business : h).businessFacts.writes.length, writes);
    } finally {
      restoreAuthority(); subject.id = actorId;
      if (kind === 'order') deps.orderMaterial = originalMaterial;
      else if (kind === 'opening') deps.opening.read = originalMaterial;
      else deps.quote.prepareInput = originalMaterial;
    }
  }
});

test('scene request collects actual authorized minimal order material, without inventing a persisted request/task', async () => {
  const h = await setup();
  const input = { requestKey: 'original-1', orderId: 'order-a', question: 'status' };
  const result = await h.tools.scenes.prepareOrderExplanation(input);
  assert.equal(result.payload.status, 'prepared_not_persisted');
  assert.equal(result.payload.materials.payload.orderId, 'order-a');
  assert.equal(result.payload.materials.payload.facts.payments, undefined);
  assert.equal(result.payload.request.ownerId, h.order.state.user.id);
  assert.equal(result.payload.request.scope.workspaceId, 'workspace-a');
  assert.equal(result.payload.request.inputRef, undefined);
  assert.equal(result.payload.task.status, 'unavailable');
  assert.equal(result.payload.execution, 'not_attempted');
  assert.ok(Object.isFrozen(result.payload.request.body));
  const hash = result.payload.request.contentHash;
  input.question = 'payments';
  assert.equal(result.payload.request.body.question, 'status');
  assert.equal((await h.tools.scenes.prepareOrderExplanation({ ...input, question: 'status' })).payload.request.contentHash, hash);
});
test('request schema rejects caller authority and revocation cannot degrade to old facts', async () => {
  const h = await setup();
  await assert.rejects(() => h.tools.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status', creationAllowed: true }), e => e.code === 'INVALID_REQUEST');
  h.order.state.session = false;
  await assert.rejects(() => h.tools.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status' }), e => e.code === 'AI_ACCESS_DENIED');
});
test('opening request binds explicit sections and does not emit unselected configuration', async () => {
  const h = await businessSetup();
  const result = await h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'opening-1', sections: ['item_groups'] });
  assert.equal(result.payload.status, 'prepared_not_persisted');
  assert.deepEqual(result.payload.materials.sections.map(row => row.key), ['item_groups']);
  assert.equal(result.payload.materials.configuration.pricing, undefined);
  assert.equal(result.payload.materials.configuration.fulfillment, undefined);
  assert.equal(result.payload.materials.configuration.products.rows.length > 0, true);
  assert.equal(result.payload.task.status, 'unavailable');
  await assert.rejects(() => h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'r', sections: ['arbitrary.path'] }), e => e.code === 'INVALID_REQUEST');
  await assert.rejects(() => h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'r', sections: ['item_groups', 'item_groups'] }), e => e.code === 'INVALID_REQUEST');
});
test('quote scene consumes actual clarification without creating a quote or treating IDs as approval', async () => {
  const h = await businessSetup();
  h.business.createQuote = () => { throw Error('preparation must not save a quote'); };
  const result = await h.tools.scenes.prepareQuoteClarification({ requestKey: 'quote-original-1', candidate: { customerType: 'personal' } });
  assert.equal(result.payload.materials.payload.facts.status, 'missing_input');
  assert.equal(result.payload.humanSelection, 'not_attested');
  assert.equal(result.payload.quotation, 'not_created');
  assert.equal(result.payload.orderApproval, 'not_granted');
  await assert.rejects(() => h.tools.scenes.prepareQuoteClarification({ requestKey: 'r', candidate: { customerType: 'personal', payableAmount: 0 } }), e => e.code === 'INVALID_REQUEST');
});
test('opt-in module provider composes actual services but import/registration performs no read or action', async () => {
  const order = await orderSetup(), business = await businessSetup();
  let calls = 0;
  const guard = { canActivate: async () => { calls++; throw Error('unavailable current authority'); } };
  const module = AiBusinessScenesModule.register({ core: order.core, guard, credentials: order.credentials,
    business: business.business, reports: business.reports, memberships: business.memberships });
  const provider = module.providers.find(row => row.provide === AI_BUSINESS_SCENES);
  const application = provider.useFactory();
  assert.equal(calls, 0); assert.deepEqual(order.state.reads, []);
  assert.equal(application.orderActions.availability, 'unavailable');
  await assert.rejects(() => application.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status' }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(calls, 1); assert.deepEqual(order.state.reads, []);
  assert.equal(module.controllers, undefined);
});
