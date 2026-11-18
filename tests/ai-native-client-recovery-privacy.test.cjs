'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { AI_TASK_INPUT_DRAFT_VERSION, clientTaskInputReference, aiClientTaskInputSubmissionRequestSchema,
  clientGoalStorageKey, minimizeClientRecoveryRecord, clientGoalFingerprint, clientQuoteStorageKey, clientQuoteOwner,
  createClientQuoteSession, createClientQuoteBookingSession, aiClientBookingReadRequestSchema, aiClientQuoteBookingRequestSchema,
  originalLegacyBookingSelection, AI_CLIENT_HOST_CAPABILITIES_VERSION, AI_CLIENT_QUOTE_PREPARATION_VERSION,
  AI_CLIENT_QUOTE_BOOKING_VERSION } = require('../packages/shared/src/index.ts');
const task = { creationKey: 'creation', materialRef: '3b5733a7-e021-4fbf-9e50-6fd1804e950f' };
const material = { materialRef: task.materialRef, inputHash: 'b'.repeat(64), materialHash: 'a'.repeat(64), expiresAt: '2026-11-19T12:00:00Z' };
const submission = { ...task, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, requestId: 'question', expectedRevision: 2,
  submissionKey: 'original', answers: [{ fieldId: 'clarification_text', value: 'private response' }] } };
const owner = clientGoalStorageKey({ tenantCode: 'tenant', serviceCode: 'shop', customerId: 'customer', surface: 'tenant_website' });

test('legacy answers become receipt selectors while submit still requires the complete human answer', () => {
  const reference = clientTaskInputReference(submission);
  assert.deepEqual(reference.submission, { requestId: 'question', expectedRevision: 2, submissionKey: 'original' });
  assert.equal(aiClientTaskInputSubmissionRequestSchema.safeParse(reference).success, false);
  const journal = { version: 'client-goal-operation-1', owner, goal: { operationKey: 'goal', goalHash: 'c'.repeat(64) },
    material, task, phase: 'answer_pending', answer: submission, continued: false, quote: null };
  const migrated = minimizeClientRecoveryRecord(owner, journal);
  assert.equal(migrated.phase, 'answer_pending'); assert.deepEqual(migrated.answer, reference);
  assert.equal(JSON.stringify(migrated).includes('private response'), false);
});

test('an archived selection retains its original operation and canonical digest, never the selected location or address', () => {
  const selection = { bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false }, fulfillmentMode: 'delivery',
    fulfillmentLocationId: 'private-location', deliveryAddressId: 'private-address', startAt: '2026-11-20T12:00:00Z', endAt: '2026-11-21T12:00:00Z',
    lines: [{ itemGroupId: 'item', quantity: 1, pricingUnit: 'day_24h' }] };
  const journal = { version: 'client-goal-operation-1', owner, goal: { operationKey: 'goal', goalHash: 'c'.repeat(64) }, material, task,
    phase: 'quoted', answer: null, continued: false, quote: { material, request: { ...task, operationKey: 'quoted-operation',
      expectedMaterialHash: material.materialHash, expectedProjectionHash: 'd'.repeat(64), decision: 'prepare_original_quote', input: selection } } };
  const migrated = minimizeClientRecoveryRecord(`${owner}:history:goal`, journal);
  assert.equal(migrated.quote.request.operationKey, 'quoted-operation');
  assert.equal(migrated.quote.request.selectionHash, clientGoalFingerprint(selection));
  assert.equal(JSON.stringify(migrated).includes('private-'), false);
  assert.equal(clientGoalFingerprint({ b: [1, '家'], a: 2 }), createHash('sha256').update('{"a":2,"b":[1,"家"]}').digest('hex'));
  assert.deepEqual(minimizeClientRecoveryRecord(owner, migrated), migrated);
});

const context = { tenantCode: 'tenant', serviceCode: 'shop', customerId: 'customer', surface: 'tenant_website', current: () => true };
const selection = { fulfillmentMode: 'delivery', fulfillmentLocationId: 'private-location', deliveryAddressId: 'private-address',
  startAt: '2026-11-20T12:00:00Z', endAt: '2026-11-21T12:00:00Z', lines: [{ itemGroupId: 'private-item', quantity: 1, pricingUnit: 'day_24h' }] };
const currentTime = '2026-11-18T12:00:00Z';
const sessionDefaults = { context, changed() {}, now: () => Date.parse(currentTime), newKey: () => 'original-preparation',
  readHost: async () => ({ contractVersion: AI_CLIENT_HOST_CAPABILITIES_VERSION, enabled: true, audience: 'customer', surface: context.surface,
    channel: 'web', tenantCode: context.tenantCode, serviceCode: context.serviceCode, customerId: context.customerId, customerType: 'personal',
    scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'shop' }, policy: { revision: 1, allowRead: true, allowCreate: true },
    releaseRevision: 'publication', observedAt: currentTime, expiresAt: material.expiresAt, authorization: 'observation_only_recheck_each_action',
    capabilities: { entryActions: ['CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'], bookingDrafts: true, savedDeliveryAddresses: false, bookingReceiptRead: true } }) };
const original = { materialRef: material.materialRef, expectedMaterialHash: material.materialHash };
const packet = { contractVersion: AI_CLIENT_QUOTE_PREPARATION_VERSION, ...material, revision: 1,
  preparation: 'normalized_parameters', eligibility: 'not_attested', quotePersistence: 'not_attempted', inventoryReservation: 'not_attempted',
  humanAction: 'explicit_confirmation_required', freshness: 'recheck_at_confirmation', parameterReview: { configurationHash: 'c'.repeat(64),
    lines: [{ lineIndex: 0, ...selection.lines[0], source: 'user_explicit', basis: 'user_input' }] } };
const bookingSelection = { quoteId: 'quote', timeZone: 'UTC', startAt: selection.startAt, endAt: selection.endAt,
  fulfillmentMode: selection.fulfillmentMode, fulfillmentLocationId: selection.fulfillmentLocationId, deliveryAddressId: selection.deliveryAddressId,
  bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false }, lines: [{ itemGroupId: 'private-item', quantity: 1 }],
  services: [{ serviceId: 'private-service', quantity: 2, scheduledEndAt: selection.endAt }] };
const bookingKey = `${clientQuoteStorageKey(context)}:booking`;
const legacyBooking = { version: 'client-quote-booking-operation-1', owner: clientQuoteOwner(context),
  request: { original, operationKey: 'booking-operation', selection: bookingSelection }, stage: 'preparation_pending',
  material: null, createKey: null, chooseKey: null, handoffKey: null, draftId: null, handoffRef: null };
function journal(value) {
  return { read: () => structuredClone(value), write: next => { value = structuredClone(next); } };
}

test('lost quote preparation and confirmation each recover the original operation across reload', async () => {
  const storage = journal(null), writes = [], reads = [];
  let unavailable = false;
  const api = {
    async prepare(command) { writes.push('prepare'); assert.deepEqual(command.input, selection); throw Error('response lost'); },
    async readPreparation(reference) { reads.push('preparation'); assert.deepEqual(reference, { operationKey: 'original-preparation', selectionHash: clientGoalFingerprint(selection) });
      if (unavailable) throw Error('material retired');
      return { ...packet, originalSelection: selection, state: 'observed', retryable: false, execution: 'read_only' }; },
    async confirm(reference) { writes.push('confirm'); assert.deepEqual(reference, original); throw Error('response lost'); },
    async readOriginal(reference) { reads.push('quote'); assert.deepEqual(reference, original); return { contractVersion: packet.contractVersion,
      state: 'observed', source: { materialRef: original.materialRef, materialHash: original.expectedMaterialHash }, quotePersistence: 'saved',
      observedAt: currentTime, inventoryReservation: 'not_attempted', orderExecution: 'not_attempted', retryable: false,
      confirmation: 'parameters_only_not_order_approval', nextAction: 'read_original_quote', quote: { quoteId: 'quote', currency: 'USD',
        payableAmount: 12, depositAmount: null, preAuthAmount: null, pricingPlanVersion: null, ruleVersion: null,
        priceVersionId: null, calendarVersion: null, categoryVersionId: null, createdAt: null, expiresAt: null, chargeLines: null } }; }
  };
  const reopen = async () => { const instance = createClientQuoteSession({ ...sessionDefaults, api, storage, selection: () => selection }); await instance.open(); return instance; };
  let instance = await reopen();
  try {
    await instance.prepare(); assert.equal(instance.snapshot().status, 'unknown');
    assert.doesNotMatch(JSON.stringify(storage.read()), /private-|parameterReview/u); instance.dispose();
    instance = await reopen(); assert.equal(instance.originalInput(), null); await instance.recover();
    assert.equal(instance.snapshot().canConfirm, true); assert.deepEqual(instance.originalInput(), selection);
    assert.doesNotMatch(JSON.stringify(storage.read()), /private-|parameterReview/u);
    await instance.confirm(); assert.equal(instance.snapshot().status, 'unknown'); instance.dispose();
    instance = await reopen(); unavailable = true; await instance.recover();
    assert.equal(instance.snapshot().status, 'quoted'); assert.equal(instance.snapshot().quote.payableAmount, 12); assert.equal(instance.originalInput(), null);
    assert.deepEqual(writes, ['prepare','confirm']); assert.deepEqual(reads, ['preparation','preparation','quote','preparation']);
  } finally { instance.dispose(); }
});

test('both booking journals migrate legacy defaulted fields without retaining the selections', async () => {
  const goalBookingKey = `${owner}:booking:${original.materialRef}`;
  const normalized = { ...bookingSelection, returnLocationId: 'private-location', services: [{ ...bookingSelection.services[0],
    scheduledStartAt: selection.startAt, serviceLocationId: 'private-location' }] };
  for (const key of [bookingKey, goalBookingKey]) {
    const migrated = minimizeClientRecoveryRecord(key, legacyBooking);
    assert.doesNotMatch(JSON.stringify(migrated), /private-|2026-11-20/u);
    assert.deepEqual(minimizeClientRecoveryRecord(key, migrated), migrated);
    assert.equal(aiClientBookingReadRequestSchema.safeParse(migrated.request).success, true);
    assert.equal(aiClientQuoteBookingRequestSchema.safeParse(migrated.request).success, false);
    const restored = originalLegacyBookingSelection(normalized, migrated.request.legacyShape);
    assert.deepEqual(restored, bookingSelection); assert.equal(clientGoalFingerprint(restored), migrated.request.selectionHash);
    assert.notEqual(clientGoalFingerprint({ ...restored, returnLocationId: 'different' }), migrated.request.selectionHash);
  }
  const storage = journal(legacyBooking); let changed = true;
  const instance = createClientQuoteBookingSession({ ...sessionDefaults, original, selection: () => null, storage, api: {
    async readBookingPreparation(reference) {
      assert.equal(reference.operationKey, 'booking-operation'); assert.doesNotMatch(JSON.stringify(reference), /private-/u);
      return { contractVersion: AI_CLIENT_QUOTE_BOOKING_VERSION, operationKey: reference.operationKey, state: 'observed',
        source: { materialRef: original.materialRef, materialHash: original.expectedMaterialHash }, originalSelection: changed ? normalized : bookingSelection,
        material: { ...material, revision: 1, createdAt: currentTime, observedAt: currentTime, materialValidity: 'not_revalidated' },
        currentUse: 'not_authorized_by_receipt', execution: 'not_attested', retryable: false, nextAction: 'revalidate_material_before_action' };
    }
  }});
  try {
    await instance.open(); assert.doesNotMatch(JSON.stringify(storage.read()), /private-/u);
    await instance.recover(); assert.equal(instance.snapshot().canSave, false);
    changed = false; await instance.recover(); assert.equal(instance.snapshot().canSave, true); assert.equal(instance.snapshot().observed, true);
  } finally { instance.dispose(); }
});

test('a retired selection still permits original booking receipt observation without enabling actions', async () => {
  const storage = journal({ ...legacyBooking, stage: 'draft_pending', material, createKey: 'draft-operation' }), seen = [];
  const instance = createClientQuoteBookingSession({ ...sessionDefaults, original, storage, selection: () => null, api: {
    async readBookingOperation(query) { seen.push(query.operationKey); return { state: 'observed', operationKey: query.operationKey, kind: 'create',
      bookingDraftId: original.materialRef, resultRevision: 1, handoffRef: null, businessSubmission: 'not_attested', retryable: false }; },
    async readBookingPreparation() { throw Error('material retired'); }
  }});
  try {
    await instance.open(); await instance.recover(); const view = instance.snapshot();
    assert.equal(view.status, 'observed'); assert.equal(view.operation.operationKey, 'draft-operation'); assert.equal(view.pendingCore, true);
    assert.equal(view.readOnly, true); assert.equal(view.canChoose, false); assert.deepEqual(seen, ['draft-operation']);
  } finally { instance.dispose(); }
});

test('browser cleanup waits for the original writer, handles damaged JSON per key and preserves pending operations', async () => {
  const { withClientRecoveryLock, minimizeClientRecoveryStorage } = require('../apps/tenant-website/src/data/clientRecoveryStorage.ts');
  const locks = new Map();
  const fake = { request: async (name, options, action) => {
    if (locks.has(name) && options.ifAvailable) return action(null);
    if (locks.has(name)) await locks.get(name);
    let release; locks.set(name, new Promise(resolve => { release = resolve; }));
    try { return await action({ name }); } finally { locks.delete(name); release(); }
  } };
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: fake });
  const scope = JSON.stringify([context.tenantCode, context.customerId, context.serviceCode]);
  const quoteKey = clientQuoteStorageKey(context), broken = `${owner}:history:damaged`;
  const items = Object.assign(Object.create({ getItem(key) { return this[key] ?? null; }, setItem(key, text) { this[key] = text; } }),
    { [broken]: 'private-invalid-json', [bookingKey]: JSON.stringify(legacyBooking), [quoteKey]: JSON.stringify({ version: 'client-quote-operation-1',
      owner: clientQuoteOwner(context), request: { operationKey: 'same-quote', input: selection }, phase: 'confirmation_pending', material: { ...packet, replayed: false } }) });
  try {
    let finish; const pending = withClientRecoveryLock(scope, () => new Promise(resolve => { finish = resolve; }));
    await assert.rejects(withClientRecoveryLock(scope, () => assert.fail('second writer entered')), /in_use/u);
    const cleaning = minimizeClientRecoveryStorage(items); finish(); await Promise.all([pending, cleaning]);
    assert.equal(JSON.parse(items[broken]).version, 'client-recovery-unavailable-1');
    assert.equal(JSON.parse(items[quoteKey]).phase, 'confirmation_pending'); assert.equal(JSON.parse(items[bookingKey]).request.operationKey, 'booking-operation');
    assert.doesNotMatch(JSON.stringify(items), /private-|parameterReview/u);
    Object.defineProperty(navigator, 'locks', { value: undefined });
    await assert.rejects(withClientRecoveryLock(scope, () => assert.fail('unlocked writer entered')), /lock_unavailable/u);
  } finally { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else delete navigator.locks; }
});
