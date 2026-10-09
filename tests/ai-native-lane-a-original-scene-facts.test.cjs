'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');

test('original request source reopening derives order and scope server-side and survives AI shutdown without bypassing revocation', async () => {
  const h = await setup(), created = await h.app.create(h.command());
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const command = { ...h.ref(created.receipt.inputRef), version: '2026-01-01T00:00:00Z', field: 'order' };
  const result = await h.app.reopenOrderCitation(command);
  assert.equal(result.source.status, 'available'); assert.equal(result.source.orderId, 'order-a');
  assert.equal((await h.app.reopenOrderCitation({ ...command, version: 'old' })).source.status, 'stale');
  await assert.rejects(h.app.reopenOrderCitation({ ...command, scope: { workspaceId: 'other' } }), e => e.code === 'AI_INVALID_INPUT');
  h.b.h.identity.session = false;
  await assert.rejects(h.app.reopenOrderCitation(command), e => e.code === 'AI_ACCESS_DENIED');
});

test('opening section consumer confines changes to originally selected partitions and never publishes candidates', async () => {
  const h = await setup(), input = h.command('opening_diagnosis'); input.input.sections = ['workspace_profile'];
  const created = await h.app.create(input), profile = h.b.core.getProfile('tenant_001');
  const section = { key: 'workspace_profile', expectedVersion: profile.configVersion, changes: [{ field: 'itemLabel', value: 'Selected label' }] };
  const result = await h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [section] });
  assert.equal(result.sections.rows[0].candidate.status, 'candidate_only'); assert.equal(result.publication, 'not_attempted');
  assert.equal(result.sections.rows[0].candidate.changes[0].before, profile.terminology.itemLabel);
  assert.equal(h.b.core.getProfile('tenant_001').terminology.itemLabel, profile.terminology.itemLabel);
  await assert.rejects(h.app.prepareOpeningSections({ ...h.ref(created.receipt.inputRef), sections: [{ ...section, key: 'item_groups' }] }), e => e.code === 'AI_ACCESS_DENIED');
});

test('quote review uses the immutable original candidates and never turns them into human selection or approval', async () => {
  const h = await setup(), created = await h.app.create(h.command('quote_clarification'));
  h.b.business.createQuote = async () => { throw Error('review must not persist a quote'); };
  const result = await h.app.reviewQuote(h.ref(created.receipt.inputRef));
  assert.equal(result.facts.status, 'missing_input'); assert.equal(result.humanSelection, 'not_attested');
  assert.equal(result.quotePersistence, 'not_attempted'); assert.equal(result.orderApproval, 'not_granted');
  assert.ok(Object.isFrozen(result.sources)); assert.equal(h.state.aiTask.length, 1);
  await assert.rejects(h.app.reviewQuote({ ...h.ref(created.receipt.inputRef), confirmed: true }), e => e.code === 'AI_INVALID_INPUT');
});

test('explicit original quote confirmation uses actual Core storage and receipt recovery never creates another quote', async () => {
  const h = await setup({ rentalQuote: [], businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001', status: 'ACTIVE' }] });
  const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const transaction = h.db.$transaction;
  let loseQuoteReply = false;
  // Database transport only. Pricing, original authorization, Guard/ALS,
  // repository and scene consumption all execute their real implementation.
  h.db.$transaction = work => transaction(tx => work({ ...tx,
    rentalQuote: { ...tx.rentalQuote, create: args => {
      if (loseQuoteReply) { h.control.loseReply = true; loseQuoteReply = false; }
      return tx.rentalQuote.create({ ...args,
        data: Object.fromEntries(Object.entries(args.data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v])) });
    } },
    $queryRaw: async (...args) => String(args[0]?.sql ?? args[0]).includes('business_workspaces')
      ? [{ categoryVersionId: null, categoryAdoptionRevision: 0 }]
      : tx.$queryRaw(...args) }));
  h.b.business.factStore = new RentalBusinessFactRepository(h.db);
  const createQuote = h.b.business.createQuoteForOriginalOperation.bind(h.b.business);
  let coreFailure;
  h.b.business.createQuoteForOriginalOperation = async (...args) => {
    try { return await createQuote(...args); } catch (error) { coreFailure = error.message; throw error; }
  };
  const original = h.command('quote_clarification'); original.input.candidate = h.b.candidate;
  const created = await h.app.create(original), ref = h.ref(created.receipt.inputRef);
  const reviewed = await h.app.reviewQuote(ref);
  const command = { ...ref, selectionRevision: reviewed.facts.selectionRevision,
    inputFingerprint: reviewed.sources.inputFingerprint };
  await assert.rejects(h.app.confirmQuote(command), e => e.code === 'AI_INVALID_INPUT');
  const absent = await h.app.readQuoteReceipt(command);
  assert.equal(absent.result.quotePersistence, 'unknown'); assert.equal(h.state.rentalQuote.length, 0);
  loseQuoteReply = true;
  const uncertain = await h.app.confirmQuote({ ...command, confirmQuote: true });
  assert.equal(uncertain.result.quotePersistence, 'unknown'); assert.equal(h.state.rentalQuote.length, 1, coreFailure);
  const recovered = await h.app.readQuoteReceipt(command);
  assert.equal(recovered.result.status, 'quoted'); assert.equal(recovered.result.quotePersistence, 'saved');
  assert.equal(recovered.orderApproval, 'not_granted'); assert.equal(recovered.result.quote.reservation, 'not_reserved');
  assert.equal(h.state.rentalQuote.length, 1);
  await assert.rejects(h.app.confirmQuote({ ...command, confirmQuote: true, inputFingerprint: 'a'.repeat(64) }), e => e.code === 'AI_REVISION_CONFLICT');
  h.b.h.identity.session = false;
  await assert.rejects(h.app.readQuoteReceipt(command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.rentalQuote.length, 1);
});
