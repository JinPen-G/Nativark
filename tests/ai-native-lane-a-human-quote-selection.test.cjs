'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, moduleTypes: { [`${process.cwd().replace(/\\/g, '/')}/apps/admin/src/**`]: 'cjs' }, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022', 'DOM'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { PrismaQuoteSelectionRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-quote-selection.repository');
const { composeHumanQuoteOrder } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { AI_QUOTE_SELECTION_DRAFT_VERSION } = require('../packages/shared/src/ai-quote-selection-draft');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiGuardedQuoteCoreContextSource } = require('../apps/api/src/modules/ai-native/tools/quote-route.composition');

async function harness(prepareProposal = false, withMembership = false, enterprise = false) {
  const h = await setup({ aiTaskQuoteSelection: [], aiApprovedOrderSnapshot: [], aiProposal: [],
    aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], aiTaskResultArtifact: [], aiTaskEvent: [] }, withMembership);
  if (enterprise) {
    const rows=h.b.membershipRows;
    rows.corporateCustomers=[{id:'company-a',tenantId:'tenant_001',customerType:'corporate',name:'Synthetic enterprise'}];
    rows.corporateLinks=[{tenantId:'tenant_001',customerId:'company-a',status:'active'}];
    rows.bookingOptions=[{id:'relationship-a',tenantId:'tenant_001',personalCustomerId:'customer-a',corporateCustomerId:'company-a',
      corporateCustomer:{name:'Synthetic enterprise'},role:'employee',status:'active',effectiveFrom:new Date('2020-01-01T00:00:00Z'),effectiveTo:null}];
    h.b.candidate.bookingIdentity={bookingIdentity:'enterprise_employee',corporateCustomerId:'company-a',enterpriseContractAndPayer:false};
  }
  if (prepareProposal) {
    h.b.h.control.now = Date.now();
    const policy = h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification');
    policy.allowedTools = [{ code: 'rental.order.commit', version: require('./fixtures/ai-native/local-shared.cjs').AI_TOOL_DRAFT_VERSION }];
    policy.limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
    const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
    for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant_001' }]]) h.state.aiScope.push({ id, ...aiPersistenceScopeColumns(scope) });
    h.state.aiBudgetPolicy = h.b.h.state.aiBudgetPolicy.map(row => JSON.parse(JSON.stringify(row)
      .replaceAll('tenant-a', 'tenant_001').replaceAll('synthetic-clarification', 'quote_clarification')));
  }
  const created = await h.app.create(h.command('quote_clarification', 'quote-original'));
  const candidate = await h.app.tools.quote.candidates.prepare(h.b.candidate);
  const preview = await h.app.tools.quote.previewSelection({ ...h.b.candidate, selectionRevision: candidate.selectionRevision });
  assert.equal(preview.status, 'quoted');
  const routes = new AiBusinessReadRouteAuthority(h.dependencies.guard, h.dependencies.credentials);
  const contexts = new AiGuardedQuoteCoreContextSource(h.b.core, routes);
  const quote = await routes.withRead('quote_context', {}, async current =>
    h.b.business.getQuote('tenant_001', await contexts.current(current.scope), preview.quote.id));
  const confirmation = Object.create(RentalOrderConfirmationService.prototype);
  const dependencies = { ...h.dependencies, originals: h.app.requests, confirmation,
    scene: { code: 'quote_clarification', version: '1' },
    quoteFacts: { findQuote: async (tenant, id) => tenant === quote.tenantId && id === quote.id ? structuredClone(quote) : null } };
  const selections = composeHumanQuoteOrder(dependencies);
  const { fulfillmentMode, fulfillmentLocationId, returnLocationId, startAt, endAt, lines } = quote.request;
  const order = { quoteId: quote.id, customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic customer',
    ...(quote.request.bookingIdentity ? { bookingIdentity: quote.request.bookingIdentity } : {}),
    fulfillmentMode, fulfillmentLocationId, ...(returnLocationId ? { returnLocationId } : {}), startAt, endAt,
    lines: lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId, quantity,
      ...(pricingGroupId ? { pricingGroupId } : {}), ...(note ? { note } : {}) })) };
  const command = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: created.receipt.inputRef,
    taskId: created.task.taskId, runId: created.task.runId, selectionKey: 'selection-a', expectedSelectionRevision: 0, order };
  const Ajv = require('ajv'), ajv = new Ajv({ strict: true }); require('ajv-formats')(ajv);
  const valid = ajv.compile(require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiQuoteSelectionCreateDraft);
  assert.equal(valid(command), true, JSON.stringify(valid.errors));
  return { ...h, selections, command, quote, created, orderDependencies: dependencies, repository: new PrismaQuoteSelectionRepository(dependencies) };
}

async function exerciseMultilineApprovedConsumer(enterprise = false, expireBeforeExecution = false, loseInventoryAtLock = false, cancelAfterApproval = false, cancelAfterCommittedReplyLoss = false, categoryCode = 'camera', withReviewedQualificationFixture = false, returnWaitingFixture = false, withDeliveryFixture = false, withExtensionFixture = false, withProfileFixture = false, standardPreparationFixture = false) {
  const shared = require('@rental-os/shared');
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const { composeClarifiedQuoteSelectionRequests } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { composeSelectedQuoteTaskApplication } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
  const { RentalIdempotencyRepository } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const candidate = { customerType: 'personal', customerId: 'customer-a',
    bookingIdentity: { bookingIdentity: enterprise ? 'enterprise_employee' : 'personal' },
    fulfillmentMode: withDeliveryFixture ? 'delivery' : 'store_pickup_return', start: '2027-02-01T00:00:00.000Z', end: '2027-02-02T00:00:00.000Z' };
  const quotes = []; let groups, deliveryFixture, preparedSelection;
  // Begin category delivery opt-in marker.
  const categoryDelivery = withDeliveryFixture === 'category_delivery'; let tenantAddressReads = 0;
  // End category delivery opt-in marker.
  const h = await originalModelApplicationHarness('quote_clarification', undefined, candidate,
    [{ code: 'rental.order.commit', version: shared.AI_TOOL_DRAFT_VERSION }], async b => {
      // Begin same name fixture setup.
      if (['same_name', 'same_name_revoked'].includes(standardPreparationFixture)) {
        const first = { ...structuredClone(b.membershipRows.customer), id: 'customer-a', name: 'Synthetic duplicate customer', phoneMasked: '138****0001' };
        const selected = { ...structuredClone(first), id: 'customer-b', phoneMasked: '138****0002' };
        b.membershipRows.customer = selected;
        b.membershipRows.link = { ...b.membershipRows.link, customerId: selected.id };
        const profiles = [first, selected];
        // Declared same-tenant profile/membership storage rows only. Actual
        // MembershipService pagination, ambiguity and booking checks still run.
        b.memberships.prisma.customerProfile.findMany = async ({ where, take }) => {
          assert.equal(where.tenantId, 'tenant_001'); assert.equal(where.customerType, 'personal');
          return structuredClone(profiles.filter(row => (!where.id || row.id === where.id)
            && (!where.name?.contains || row.name.includes(where.name.contains)))
            .map(row => ({ ...row, membership: { status: row.id === selected.id ? b.membershipRows.link.status : 'active' } })).slice(0, take));
        };
        b.memberships.prisma.customerProfile.findFirst = async ({ where }) => structuredClone(profiles.find(row => row.id === where.id
          && row.tenantId === where.tenantId && (!where.customerType || row.customerType === where.customerType)) ?? null);
        b.memberships.prisma.customerMembership.findUnique = async ({ where }) => {
          const key = where.tenantId_customerId;
          if (key.tenantId !== 'tenant_001') return null;
          return key.customerId === selected.id ? structuredClone(b.membershipRows.link)
            : key.customerId === first.id ? { tenantId: key.tenantId, customerId: first.id, status: 'active' } : null;
        };
        delete candidate.customerId; candidate.customerName = first.name;
      }
      // End same name fixture setup.
      if (withReviewedQualificationFixture) {
        const category = b.core.listCategories().find(row => row.code === categoryCode);
        assert.equal(category.businessModel.supportsQualificationReview, true);
        // Declared synthetic, already-reviewed legacy qualification facts for
        // these two fixture customers only. Read via the original membership
        // service before quoting and again under Core's commit locks; never put
        // qualificationApproved in a client command or change Core's review gate.
        const qualifications = category.businessModel.defaults.rules.qualificationDocumentTypes.map((qualificationType, index) => ({
          id: `synthetic-reviewed-${categoryCode}-${index}`, tenantId: 'tenant_001', customerId: 'customer-a', qualificationType,
          referenceNoMasked: 'SYNTHETIC-****', issuedAt: new Date('2020-01-01T00:00:00Z'), expiresAt: new Date('2028-01-01T00:00:00Z'),
          status: 'approved', source: 'manual', evidenceRef: `synthetic-review-${categoryCode}-${index}`,
          verifiedAt: new Date('2026-01-01T00:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'), currentRevisionId: null
        }));
        assert.ok(qualifications.length > 0);
        b.memberships.prisma.customerQualificationRef.findMany = async ({ where }) => structuredClone(qualifications
          .filter(row => row.tenantId === where.tenantId && row.customerId === where.customerId));
      }
      if (enterprise) {
        // Original membership service reads these explicit new fixture rows;
        // enterprise intent supplies neither a selected company nor a payer.
        const rows = b.membershipRows;
        rows.corporateCustomers = [{ id: 'company-a', tenantId: 'tenant_001', customerType: 'corporate', name: 'Synthetic enterprise' }];
        rows.corporateLinks = [{ tenantId: 'tenant_001', customerId: 'company-a', status: 'active' }];
        rows.bookingOptions = [{ id: 'relationship-a', tenantId: 'tenant_001', personalCustomerId: 'customer-a',
          corporateCustomerId: 'company-a', corporateCustomer: { name: 'Synthetic enterprise' }, role: 'employee', status: 'active',
          effectiveFrom: new Date('2020-01-01T00:00:00Z'), effectiveTo: null }];
      }
      // Begin original delivery selection opt-in fixture.
      if (withDeliveryFixture) {
        assert.equal(enterprise, false); if (!categoryDelivery) assert.equal(categoryCode, 'camera');
        deliveryFixture = { id: 'delivery-address-original', tenantId: 'tenant_001', customerId: 'customer-a', status: 'active', revision: 1,
          recipient: 'Synthetic original recipient', phone: '13800000000', phoneMasked: '138****0000', countryCode: 'CN',
          province: 'Synthetic province', city: 'Synthetic city', district: null, detail: 'Synthetic original delivery detail', postalCode: null,
          latitude: null, longitude: null, isDefault: true, updatedAt: new Date('2026-10-07T00:00:00Z') };
        // Only this new fixture's storage leaf. Actual Core list/ownership,
        // selection revision, quote and historical snapshot remain product code.
        b.business.prisma = { customerDeliveryAddress: {
          findMany: async ({ where }) => deliveryFixture.tenantId === where.tenantId && deliveryFixture.customerId === where.customerId
            && deliveryFixture.status === where.status ? [structuredClone(deliveryFixture)] : [],
          findFirst: async ({ where }) => deliveryFixture.tenantId === where.tenantId && deliveryFixture.customerId === where.customerId
            && deliveryFixture.id === where.id && deliveryFixture.status === where.status ? structuredClone(deliveryFixture) : null
        } };
        // Begin category delivery station address denial.
        if (categoryDelivery && categoryCode === 'vehicle') {
          const rejectAddressRead = () => { tenantAddressReads++; throw Error('Tenant-location delivery must not access a customer address book'); };
          b.business.prisma.customerDeliveryAddress = { findMany: rejectAddressRead, findFirst: rejectAddressRead };
        }
        // End category delivery station address denial.
      }
      // End original delivery selection opt-in fixture.
      groups = b.core.listItemGroups('tenant_001').filter(row => row.status === 'enabled').slice(0, 2);
      assert.equal(groups.length, 2); candidate.items = groups.map((row, index) => ({ itemGroupId: row.id, quantity: index + 1 }));
      candidate.locationId = b.location.id;
      // Existing offline persistence/inventory leaves only. Original services
      // decide the two-line quote and later order; no quote/order is invented.
      b.facts.listAssets = async () => groups.flatMap((group, row) => [1, 2, 3].map(index => ({
        id: `approved-line-asset-${row}-${index}`, tenantId: 'tenant_001', workspaceId: 'workspace-a',
        itemGroupId: group.id, locationId: b.location.id, status: 'available' })));
      b.facts.listStockBalances = async () => groups.map(group => ({ itemGroupId: group.id, locationId: b.location.id, onHandQuantity: 10, maintenanceQuantity: 0 }));
      b.businessFacts.findQuoteForOriginalOperation = async (tenantId, proof) => {
        const row = quotes.find(row => row.quote.tenantId === tenantId && row.key === proof.key);
        if (row && row.inputHash !== proof.inputHash) throw new (require('@nestjs/common').ConflictException)('Original input changed');
        return row && structuredClone(row.quote);
      };
      b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => {
        const row = quotes.find(row => row.quote.tenantId === tenantId && row.key === key); return row && structuredClone(row.quote);
      };
      b.businessFacts.saveQuoteForOriginalOperation = async (quote, proof) => {
        const existing = await b.businessFacts.findQuoteForOriginalOperation(quote.tenantId, proof);
        if (existing) return existing;
        quotes.push({ ...proof, quote: structuredClone(quote) }); return structuredClone(quote);
      };
    }, { maxSteps: 8, maxCalls: 8 }, { ...(withExtensionFixture ? { rentalAsset: [] } : {}),
      ...(withExtensionFixture === 'application' ? { rentalOrderExtension: [] } : {}),
      ...(withProfileFixture ? { customerProfile: [{ id: 'customer-a', tenantId: 'tenant_001', customerType: 'personal', name: 'Synthetic customer',
        ordinaryRevision: 1, status: 'active', mergedIntoCustomerId: null, email: 'retained@example.test', phone: 'synthetic-phone', identityVerified: false }],
        customerMembership: [{ tenantId: 'tenant_001', customerId: 'customer-a', status: 'active' }],
        customerApprovedProfileChange: [], customerApprovedProfileOperation: [] } : {}) }, undefined, categoryCode);
  assert.equal(h.b.core.getProfile('tenant_001').categoryCode, categoryCode);
  assert.equal(h.b.quoteConfiguration.categoryCode, categoryCode);
  const app = h.model.createApplication({ holderId: 'same-quote-clarification', leaseMs: 100000 }, { ...h.run, inputSource: 'original_scene' });
  const original = structuredClone(candidate), history = [], touched = new Set(), enterpriseFields = new Set(); let finalQuery, reviewed;
  assert.equal((await app.start(h.reference)).execution.outcome.status, 'paused');
  for (let round = 0; round < 6; round++) {
    const pending = await app.readInput(h.reference), before = applyOriginalQuoteAnswers(original, history);
    for (const field of pending.contract.fields) {
      if (field.fieldId === 'pricing_unit_selection') touched.add(field.target.rowIndex);
      if (['enterprise_selection', 'enterprise_payer_selection'].includes(field.fieldId)) enterpriseFields.add(field.fieldId);
    }
    const submission = { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId,
      requestId: pending.requestId, expectedRevision: pending.revision, submissionKey: `approved-two-lines-${round}`,
      answers: pending.contract.fields.map(field => ({ fieldId: field.fieldId, value: field.kind === 'choice'
        ? withDeliveryFixture && field.fieldId === 'fulfillment_selection' ? before.fulfillmentMode
          : field.options.find(option => field.fieldId === 'item_selection' && option.value === before.items[field.target?.rowIndex ?? 0].itemGroupId)?.value ?? field.options[0].value
        : field.kind === 'integer' ? 1 : field.fieldId === 'starts_at' ? candidate.start : field.fieldId === 'ends_at' ? candidate.end : 'Parameters only; no quote or order approval.' })) };
    // Begin same name explicit answer.
    if (['same_name', 'same_name_revoked'].includes(standardPreparationFixture)) {
      const field = pending.contract.fields.find(row => row.fieldId === 'customer_selection');
      if (field) {
        const alreadySelected = history.some(round => round.answers.some(row => row.fieldId === 'customer_selection' && row.value === 'customer-b'));
        if (alreadySelected) {
          assert.equal(before.customerId, 'customer-b'); assert.deepEqual(field.options.map(row => row.value), ['customer-b']);
        } else {
          assert.equal(before.customerId, undefined); assert.deepEqual(field.options.map(row => row.value), ['customer-a', 'customer-b']);
        }
        assert.equal(quotes.length, 0); assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0);
        // First choose the NON-first offered ID; subsequent offers keep only
        // the same explicitly selected customer while other parameters change.
        submission.answers.find(row => row.fieldId === field.fieldId).value = 'customer-b';
      }
    }
    // End same name explicit answer.
    const calls = h.execution.sent.length;
    await app.submitAnswer({ original: h.reference, submission }); assert.equal(h.execution.sent.length, calls);
    history.push({ contract: pending.contract, answers: submission.answers }); finalQuery = { original: h.reference, submission };
    reviewed = await app.readQuotePreparation(finalQuery);
    assert.equal(reviewed.quotation, 'not_attempted'); assert.equal(reviewed.orderApproval, 'not_granted');
    if (touched.size === 2 && reviewed.preparation.status === 'ready') break;
    await app.continueAnswer(finalQuery);
  }
  assert.equal(touched.size, 2); assert.equal(reviewed.preparation.status, 'ready');
  if (enterprise) {
    assert.deepEqual([...enterpriseFields].sort(), ['enterprise_payer_selection', 'enterprise_selection']);
    assert.deepEqual(reviewed.candidate.bookingIdentity, { bookingIdentity: 'enterprise_employee',
      corporateCustomerId: 'company-a', enterpriseContractAndPayer: false });
  }
  const quoted = await app.confirmClarifiedQuote({ ...finalQuery, selectionRevision: reviewed.preparation.selectionRevision,
    inputFingerprint: reviewed.formalInputFingerprint, confirmQuote: true });
  assert.equal(quoted.result.status, 'quoted'); assert.equal(quotes.length, 1);
  const receipt = await app.readClarifiedQuoteReceipt(finalQuery), quote = quotes[0].quote;
  assert.equal(receipt.result.quote.id, quote.id); assert.equal(quote.request.lines.length, 2);
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0); assert.deepEqual(candidate, original);

  // Same existing TaskInputStore, not a SQL emulator. Membership and storage
  // delegates expose the original fixture facts to the actual Core transaction.
  const membershipDb = h.b.memberships.prisma, transaction = h.db.$transaction.bind(h.db);
  h.db.$transaction = (work, ...options) => transaction(tx => work(Object.assign(tx, ...['customerProfile', 'customerMembership',
    'customerQualificationRef', 'customerMembershipQualificationType', 'customerMembershipPlanAssignment', 'customerCorporateMembership']
    .map(name => withProfileFixture && ['customerProfile', 'customerMembership'].includes(name) ? {} : ({ [name]: membershipDb[name] })))), ...options);
  const coreFacts = Object.assign(h.b.facts, {
    findOrder: async (tenant, id, tx) => (tx ?? h.db).rentalOrder.findFirst({ where: { tenantId: tenant, id } }),
    countOrders: async tenant => (await h.db.rentalOrder.findMany({ where: { tenantId: tenant } })).length,
    allocateOrderNumber: async () => `RC260101${String((await h.db.rentalOrder.findMany({})).length + 1).padStart(4, '0')}`,
    saveOrderAggregate: async (order, _lines, tx) => tx.rentalOrder.create({ data: { ...structuredClone(order),
      workspaceId: require('../apps/api/src/common/request-identity').getRequestWorkspaceId() } })
  });
  await h.db.rentalQuote.create({ data: { id: quote.id, tenantId: quote.tenantId, snapshot: structuredClone(quote), consumedAt: null, consumedOrderId: null } });
  const quoteFacts = {
    findQuote: async (tenant, id, tx) => { const row = await (tx ?? h.db).rentalQuote.findFirst({ where: { tenantId: tenant, id } });
      return row ? { ...row.snapshot, ...(row.consumedAt ? { consumedAt: row.consumedAt, consumedOrderId: row.consumedOrderId } : {}) } : null; },
    consumeQuoteIfAvailable: async (tenant, id, orderId, at, tx) => (await tx.rentalQuote.updateMany({
      where: { tenantId: tenant, id, consumedAt: null }, data: { consumedAt: at, consumedOrderId: orderId } })).count === 1
  };
  const confirmation = new RentalOrderConfirmationService(h.db, h.b.core, h.b.business, coreFacts, quoteFacts,
    new RentalIdempotencyRepository(h.db), undefined, undefined, undefined, undefined, h.b.memberships);
  const dependencies = { ...h.dependencies, originals: h.model.scenes.requests, scene: { code: 'quote_clarification', version: '1' },
    core: h.b.core, business: h.b.business, memberships: h.b.memberships, confirmation, quoteFacts };
  const repository = new PrismaQuoteSelectionRepository(dependencies);
  const request = { headers: { authorization: (await h.dependencies.credentials.current()).authorization } };
  // Method-level delegates keep the actual original read/select commands and
  // their real Guards. This is not a fake receipt or an HTTP/server-host test.
  let selectionConsumer = composeClarifiedQuoteSelectionRequests({ readClarifiedQuoteReceipt: (_request, value) => app.readClarifiedQuoteReceipt(value) }, {
    select: (_request, value) => repository.select(value), reconcile: (_request, value) => repository.reconcile(value)
  });
  const { fulfillmentMode, fulfillmentLocationId, returnLocationId, startAt, endAt, lines } = quote.request;
  const order = { quoteId: quote.id, customerType: 'personal', customerId: 'customer-a', customerName: h.b.membershipRows.customer.name,
    ...(quote.request.bookingIdentity ? { bookingIdentity: quote.request.bookingIdentity } : {}), fulfillmentMode, fulfillmentLocationId,
    ...(returnLocationId ? { returnLocationId } : {}), startAt, endAt,
    lines: lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId, quantity,
      ...(pricingGroupId ? { pricingGroupId } : {}), ...(note ? { note } : {}) })) };
  // Begin same name original order binding.
  if (['same_name', 'same_name_revoked'].includes(standardPreparationFixture)) {
    assert.equal(original.customerId, undefined); assert.equal(original.customerName, 'Synthetic duplicate customer');
    assert.ok(history.some(round => round.answers.some(row => row.fieldId === 'customer_selection' && row.value === 'customer-b')));
    assert.equal(reviewed.candidate.customerId, 'customer-b'); assert.equal(quote.request.customerId, 'customer-b');
    assert.equal(quote.membershipSnapshot.personalCustomerId, 'customer-b'); order.customerId = quote.request.customerId;
  }
  // End same name original order binding.
  const command = { draftVersion: shared.AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: h.reference.inputRef,
    taskId: receipt.receipt.taskId, runId: receipt.receipt.runId, selectionKey: 'same-clarified-two-line-quote', expectedSelectionRevision: 0, order };
  let selectionClarification = finalQuery;
  // Begin standard clarified selection preparation opt-in.
  if (standardPreparationFixture) {
    assert.equal(withDeliveryFixture, false);
    const { composeRequestBoundClarifiedQuoteSelectionPreparation, composeRequestBoundQuoteSelections } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
    const { credentials: _credentials, originals: _originals, ...requestDependencies } = dependencies;
    // Existing actual persisted model receipt is delegated, not replaced with a
    // fake quote/result. The request-bound Core and selection Guards still run.
    const modelReader = { readClarifiedQuoteReceipt: (current, value) => {
      assert.deepEqual(current.headers, request.headers); return app.readClarifiedQuoteReceipt(value);
    } };
    const options = { enabled: true, audience: 'operator' };
    const selectedRequests = composeRequestBoundQuoteSelections(requestDependencies, options);
    const preparation = composeRequestBoundClarifiedQuoteSelectionPreparation(modelReader, requestDependencies, options);
    selectionConsumer = composeClarifiedQuoteSelectionRequests(modelReader, selectedRequests, preparation);
    if (['http_reference', 'conversation_consumer'].includes(standardPreparationFixture)) {
      const answer = finalQuery.submission;
      selectionClarification = { original: finalQuery.original, reference: { taskId: answer.taskId, requestId: answer.requestId,
        expectedRevision: answer.expectedRevision, submissionKey: answer.submissionKey } };
    }
    const prepareCommand = { clarification: selectionClarification, selectionKey: command.selectionKey, expectedSelectionRevision: command.expectedSelectionRevision };
    if (standardPreparationFixture === 'stock_inconsistent') {
      const readAvailability = dependencies.core.readAvailability, clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
      const before = clone(h.state), beforeQuotes = clone(quotes), beforeCalls = h.execution.sent.length;
      let reads = 0, corruption;
      dependencies.core.readAvailability = async function (...args) {
        reads++; const stock = clone(await readAvailability.apply(this, args));
        assert.equal(stock.available, true); assert.ok(stock.lines.every(line => line.available === true));
        if (corruption === 'insufficient_quantity') stock.lines[0].availableQuantity = 0;
        else if (corruption === 'fractional_quantity') stock.lines[0].availableQuantity = 1.5;
        else stock.lines[0].inventoryMode = 'unregistered_inventory';
        return stock;
      };
      for (corruption of ['insufficient_quantity', 'fractional_quantity', 'unregistered_inventory']) {
        await assert.rejects(selectionConsumer.prepareSelection(request, prepareCommand), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
      }
      assert.equal(reads, 3); assert.deepEqual(h.state, before); assert.deepEqual(quotes, beforeQuotes);
      assert.equal(h.execution.sent.length, beforeCalls); assert.equal(h.state.aiTaskQuoteSelection.length, 0);
      assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0);
      return { inconsistentStockRejected: true, stockReads: reads };
    }
    // Begin current stock selection preparation opt-in.
    if (standardPreparationFixture === 'stock_withdrawn' || standardPreparationFixture === 'stock_unchanged') {
      const withdrawn = standardPreparationFixture === 'stock_withdrawn';
      const availabilityInput = { locationId: quote.request.fulfillmentLocationId, startAt: quote.request.startAt,
        endAt: quote.request.endAt, lines: quote.request.lines.map(row => ({ itemGroupId: row.itemGroupId, quantity: row.quantity })) };
      if (withdrawn) {
        h.b.facts.listAssets = async () => [];
        h.b.facts.listStockBalances = async () => quote.request.lines.map(row => ({ itemGroupId: row.itemGroupId,
          locationId: quote.request.fulfillmentLocationId, onHandQuantity: 0, maintenanceQuantity: 0 }));
        const routes = new AiBusinessReadRouteAuthority(dependencies.guard, dependencies.credentials, dependencies.clock);
        const stock = await routes.withRead('availability', availabilityInput, context => dependencies.core.availability(context.scope.tenantId, availabilityInput));
        assert.equal(stock.available, false); assert.equal(stock.lines.length, quote.request.lines.length);
      }
      // Observe, but do not replace, the actual R0 Core implementation. Both
      // branches must read exactly this original period/location/model/quantity.
      const readAvailability = dependencies.core.readAvailability; let stockReads = 0;
      dependencies.core.readAvailability = async function (tenantId, value) {
        stockReads++; assert.equal(tenantId, quote.tenantId); assert.deepEqual(value, availabilityInput);
        return readAvailability.call(this, tenantId, value);
      };
      const clone = require('./fixtures/ai-native/task-input-store.cjs').clone, before = clone(h.state), beforeQuotes = clone(quotes), beforeCalls = h.execution.sent.length;
      if (withdrawn) {
        await assert.rejects(selectionConsumer.prepareSelection(request, prepareCommand), error => error.code === 'AI_REVISION_CONFLICT');
      } else {
        const prepared = await selectionConsumer.prepareSelection(request, prepareCommand);
        assert.deepEqual(prepared.selection, command); assert.equal(prepared.quote.id, quote.id);
        assert.equal(prepared.selectionState, 'not_saved'); assert.equal(prepared.quotation, 'original_unchanged');
        assert.equal(prepared.approval, 'not_granted'); assert.equal(prepared.order, 'not_created');
      }
      assert.equal(stockReads, withdrawn ? 1 : 2);
      assert.deepEqual(h.state, before); assert.deepEqual(quotes, beforeQuotes); assert.equal(h.execution.sent.length, beforeCalls);
      assert.equal(h.state.aiTaskQuoteSelection.length, 0); assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0);
      return { originalSelectionRefusedBeforePersistence: withdrawn, originalSelectionPreparedReadOnly: !withdrawn,
        originalQuoteId: quote.id, stockReads, modelCalls: beforeCalls };
    }
    // End current stock selection preparation opt-in.
    // Begin quote lifecycle selection preparation opt-in.
    if (typeof standardPreparationFixture === 'string' && standardPreparationFixture.startsWith('lifecycle:')
      && standardPreparationFixture !== 'lifecycle:unchanged_to_core') {
      const mode = standardPreparationFixture.slice('lifecycle:'.length), expiry = Date.parse(quote.expiresAt);
      assert.ok(Number.isFinite(expiry));
      const clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
      const before = clone(h.state), beforeQuotes = clone(quotes), beforeCalls = h.execution.sent.length;
      let stockReads = 0, receiptReads = 0;
      const stockRead = dependencies.core.readAvailability, receiptRead = modelReader.readClarifiedQuoteReceipt;
      dependencies.core.readAvailability = async function (...args) {
        stockReads++; const result = await stockRead.apply(this, args);
        if (mode === 'expired_during_stock') h.b.h.control.now = expiry;
        return result;
      };
      modelReader.readClarifiedQuoteReceipt = async (...args) => {
        const result = await receiptRead(...args); receiptReads++;
        if (mode === 'expired_during_receipt' && receiptReads === 2) h.b.h.control.now = expiry;
        if (mode === 'consumed_during_receipt' && receiptReads === 2) {
          // Explicit concurrent-consumption storage sample only. No order or
          // successful Core receipt is invented; immutable quote bytes stay put.
          const row = h.state.rentalQuote.find(row => row.id === quote.id);
          row.consumedAt = h.dependencies.clock(); row.consumedOrderId = 'synthetic-concurrent-consumption';
        }
        return result;
      };
      if (mode === 'expired_before') h.b.h.control.now = expiry;
      const expectedCode = ['consumed_during_receipt', 'expired_during_stock'].includes(mode)
        ? 'AI_REVISION_CONFLICT' : 'AI_RESOURCE_UNAVAILABLE';
      await assert.rejects(selectionConsumer.prepareSelection(request, prepareCommand), error => error.code === expectedCode);
      assert.equal(stockReads, mode === 'expired_before' ? 0 : 1);
      const after = clone(h.state);
      if (mode === 'consumed_during_receipt') {
        assert.equal(receiptReads, 2);
        const row = after.rentalQuote.find(row => row.id === quote.id);
        assert.equal(row.consumedOrderId, 'synthetic-concurrent-consumption');
        assert.deepEqual(row.snapshot, quote); row.consumedAt = null; row.consumedOrderId = null;
      }
      assert.deepEqual(after, before); assert.deepEqual(quotes, beforeQuotes); assert.equal(h.execution.sent.length, beforeCalls);
      assert.equal(h.state.aiTaskQuoteSelection.length, 0); assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0);
      modelReader.readClarifiedQuoteReceipt = receiptRead;
      const historical = await app.readClarifiedQuoteReceipt(finalQuery);
      assert.equal(historical.receipt.state, 'observed'); assert.equal(historical.result.quote.id, quote.id);
      assert.equal(historical.result.quote.expiresAt, quote.expiresAt);
      return { rejectedPreparation: true, originalQuoteId: quote.id, historicalReceiptObserved: true };
    }
    // End quote lifecycle selection preparation opt-in.
    // Begin closing stock wait opt-in.
    const closingStockMode = typeof standardPreparationFixture === 'string' && standardPreparationFixture.startsWith('stock_wait:')
      ? standardPreparationFixture.slice('stock_wait:'.length) : null;
    let closingStockReads = 0, closingReceiptReads = 0; const closingStockObservations = [];
    if (closingStockMode) {
      const readStock = dependencies.core.readAvailability, readReceipt = modelReader.readClarifiedQuoteReceipt;
      const expectedStockInput = { locationId: quote.request.fulfillmentLocationId, startAt: quote.request.startAt,
        endAt: quote.request.endAt, lines: quote.request.lines.map(row => ({ itemGroupId: row.itemGroupId, quantity: row.quantity })) };
      dependencies.core.readAvailability = async function (tenant, value) {
        closingStockReads++; assert.equal(tenant, quote.tenantId); assert.deepEqual(value, expectedStockInput);
        const result = await readStock.call(this, tenant, value); closingStockObservations.push(structuredClone(result));
        if (closingStockMode === 'consumed_during_closing_stock' && closingStockReads === 2) {
          // Concurrent consumption is only a storage sample, never a fabricated
          // successful Core order/receipt. The original immutable snapshot stays.
          const row = h.state.rentalQuote.find(row => row.id === quote.id);
          row.consumedAt = h.dependencies.clock(); row.consumedOrderId = 'synthetic-closing-stock-consumption';
        }
        return result;
      };
      modelReader.readClarifiedQuoteReceipt = async (...args) => {
        const result = await readReceipt(...args); closingReceiptReads++;
        if (closingReceiptReads === 2) {
          const remaining = closingStockMode === 'withdrawn_during_receipt' ? [] : [1, 2];
          // Only the fixture's current inventory storage leaves change. Both
          // observations still execute the original Core availability algorithm.
          h.b.facts.listAssets = async () => groups.flatMap((group, row) => remaining.map(index => ({
            id: `approved-line-asset-${row}-${index}`, tenantId: 'tenant_001', workspaceId: 'workspace-a',
            itemGroupId: group.id, locationId: h.b.location.id, status: 'available' })));
          h.b.facts.listStockBalances = async () => groups.map(group => ({ itemGroupId: group.id, locationId: h.b.location.id,
            onHandQuantity: remaining.length ? 4 : 0, maintenanceQuantity: 0 }));
        }
        return result;
      };
      if (closingStockMode !== 'available_to_original_core') {
        const clone = require('./fixtures/ai-native/task-input-store.cjs').clone, before = clone(h.state), beforeQuotes = clone(quotes), beforeCalls = h.execution.sent.length;
        await assert.rejects(selectionConsumer.prepareSelection(request, prepareCommand), error => error.code === 'AI_REVISION_CONFLICT');
        assert.equal(closingStockReads, 2); assert.equal(closingReceiptReads, 2);
        assert.equal(closingStockObservations[0].available, true);
        assert.equal(closingStockObservations[1].available, closingStockMode !== 'withdrawn_during_receipt');
        const after = clone(h.state);
        if (closingStockMode === 'consumed_during_closing_stock') {
          const row = after.rentalQuote.find(row => row.id === quote.id);
          assert.equal(row.consumedOrderId, 'synthetic-closing-stock-consumption'); assert.deepEqual(row.snapshot, quote);
          row.consumedAt = null; row.consumedOrderId = null;
        }
        assert.deepEqual(after, before); assert.deepEqual(quotes, beforeQuotes); assert.equal(h.execution.sent.length, beforeCalls);
        assert.equal(h.state.aiTaskQuoteSelection.length, 0); assert.equal(h.state.aiApproval.length, 0);
        assert.equal(h.state.aiApprovalConsumption.length, 0); assert.equal(h.state.rentalOrder.length, 0);
        modelReader.readClarifiedQuoteReceipt = readReceipt;
        const historical = await app.readClarifiedQuoteReceipt(finalQuery);
        assert.equal(historical.receipt.state, 'observed'); assert.equal(historical.result.quote.id, quote.id);
        return { rejectedClosingStock: true, historicalReceiptObserved: true };
      }
    }
    // End closing stock wait opt-in.
    const before = require('./fixtures/ai-native/task-input-store.cjs').clone(h.state), beforeCalls = h.execution.sent.length, beforeQuotes = quotes.length;
    await assert.rejects(composeClarifiedQuoteSelectionRequests(modelReader, selectedRequests).prepareSelection(request, prepareCommand),
      error => error.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(selectionConsumer.prepareSelection(request, { ...prepareCommand, quoteId: 'caller-selected-quote' }),
      error => error.code === 'AI_INVALID_INPUT');
    if (['http_reference', 'conversation_consumer'].includes(standardPreparationFixture)) {
      const { AiClarifiedQuoteSelectionController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
      const controller = new AiClarifiedQuoteSelectionController(selectionConsumer);
      const path = shared.AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT;
      assert.equal(Reflect.getMetadata('path', AiClarifiedQuoteSelectionController.prototype.prepareSelection), path.prepareSelection);
      const guarded = { ...request, method: 'POST', originalUrl: `/api/${path.basePath}/${path.prepareSelection}`, url: `/api/${path.basePath}/${path.prepareSelection}` };
      await dependencies.guard.canActivate({ getClass: () => AiClarifiedQuoteSelectionController, getHandler: () => controller.prepareSelection,
        switchToHttp: () => ({ getRequest: () => guarded }) });
      await assert.rejects(controller.prepareSelection(request, { ...prepareCommand, clarification: { ...selectionClarification,
        submission: finalQuery.submission } }), error => error.getResponse().code === 'AI_INVALID_INPUT');
      preparedSelection = await controller.prepareSelection(request, prepareCommand);
      assert.deepEqual(preparedSelection.clarification, selectionClarification);
      const original = selectionConsumer;
      selectionConsumer = { ...original, select: (r, selection, clarification) => controller.select(r, { selection, clarification }),
        readOperation: (r, selection, clarification) => controller.readOperation(r, { selection, clarification }) };
    } else preparedSelection = await selectionConsumer.prepareSelection(request, prepareCommand);
    assert.deepEqual(preparedSelection.selection, command); assert.equal(preparedSelection.selectionState, 'not_saved');
    // Begin closing stock positive assertions.
    if (closingStockMode) {
      assert.equal(closingStockReads, 2); assert.equal(closingReceiptReads, 2);
      assert.ok(closingStockObservations.every(row => row.available === true && row.lines.every(line => line.available === true)));
      assert.notDeepEqual(closingStockObservations[0], closingStockObservations[1]);
      assert.equal(preparedSelection.selection.order.quoteId, quote.id);
    }
    // End closing stock positive assertions.
    assert.equal(preparedSelection.approval, 'not_granted'); assert.equal(preparedSelection.order, 'not_created');
    assert.equal(preparedSelection.quote.id, quote.id); assert.equal(preparedSelection.quotation, 'original_unchanged');
    assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, beforeCalls); assert.equal(quotes.length, beforeQuotes);
    assert.equal(h.state.aiTaskQuoteSelection.length, 0); assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0);
  }
  // End standard clarified selection preparation opt-in.
  // Begin original delivery selection preparation handoff.
  if (withDeliveryFixture) {
    const { composeClarifiedQuoteSelectionPreparation } = require('../apps/api/src/modules/ai-native/scenes/clarified-quote-selection-preparation');
    const preparation = composeClarifiedQuoteSelectionPreparation({ readClarifiedQuoteReceipt: (_request, value) => app.readClarifiedQuoteReceipt(value) }, dependencies);
    preparedSelection = await preparation.prepareSelection(request, { clarification: finalQuery,
      selectionKey: command.selectionKey, expectedSelectionRevision: command.expectedSelectionRevision });
    assert.deepEqual(preparedSelection.selection, command);
    // Begin category delivery material projection.
    if (categoryDelivery && categoryCode === 'vehicle') {
      assert.equal(preparedSelection.material.fulfillment.deliveryAddress, undefined);
      assert.equal(preparedSelection.material.fulfillment.pickupLocationId, quote.request.fulfillmentLocationId);
      assert.equal(quote.deliveryAddressSnapshot, undefined); assert.equal(tenantAddressReads, 0);
    } else {
      assert.equal(preparedSelection.material.fulfillment.deliveryAddress.detail, deliveryFixture.detail);
      assert.equal(preparedSelection.material.fulfillment.deliveryAddress.recipient, deliveryFixture.recipient);
      assert.equal(preparedSelection.material.fulfillment.deliveryAddress.phone, undefined);
    }
    // End category delivery material projection.
    assert.equal(preparedSelection.selectionState, 'not_saved'); assert.equal(preparedSelection.approval, 'not_granted');
    assert.equal(preparedSelection.selection.order.deliveryAddressId, undefined);
    if (!categoryDelivery || categoryCode !== 'vehicle') assert.equal(quote.request.deliveryAddressId, deliveryFixture.id);
  }
  // End original delivery selection preparation handoff.
  assert.equal(command.taskId, h.created.task.taskId);
  await assert.rejects(selectionConsumer.select(request, { ...command, order: { ...order, quoteId: 'different-quote' } }, finalQuery),
    error => (error.code ?? error.getResponse?.().code) === 'AI_ACCESS_DENIED');
  await assert.rejects(repository.select({ ...command, order: { ...order, lines: order.lines.map((line, index) => index ? line : { ...line, quantity: line.quantity + 1 }) } }));
  assert.equal(h.state.aiTaskQuoteSelection.length, 0); assert.equal(h.state.rentalOrder.length, 0);
  let selected, conversationConsumer;
  if (standardPreparationFixture === 'conversation_consumer') {
    const { AiClarifiedQuoteSelectionController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
    const controller = new AiClarifiedQuoteSelectionController(selectionConsumer), Module = require('node:module');
    const queryFile = require.resolve('../apps/admin/src/app/queryClient'), httpFile = require.resolve('../apps/admin/src/api/http');
    const oldQuery = Module._cache[queryFile], oldHttp = Module._cache[httpFile], stored = new Map(), calls = [];
    const turn = { admissionKey: 'selection-admission', turnId: 'selection-turn', originalRequestKey: h.created.receipt.requestKey,
      requestHash: 'a'.repeat(64), capabilityCode: 'quote_clarification', capabilityVersion: h.created.receipt.sceneVersion,
      createdAt: h.created.receipt.createdAt, automaticRetry: false, status: 'original_bound', execution: 'not_inferred_from_association',
      material: 'retained', original: h.reference, task: { taskId: h.created.task.taskId, runId: h.created.task.runId } };
    let current = true, changedMaterial = false, loseSelection = true, loseStart = true, taskController, taskCenterController;
    const source = { answer: { reference: selectionClarification.reference, receiptId: receipt.receipt.receiptId }, quoteId: quote.id, runId: receipt.receipt.runId };
    Module._cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: { currentSessionSignal: () => new AbortController().signal, currentSessionEpoch: () => 1 } };
    Module._cache[httpFile] = { id: httpFile, filename: httpFile, loaded: true, exports: { http: { post: async (url, input, options) => {
      const action = url.split('/').at(-1); calls.push({ action, input: structuredClone(input), url }); assert.equal(options.signal.aborted, false);
      if (action === 'admission') return { data: { data: { ...input, result: turn, absence: 'not_proof_of_no_commit', retryable: false } } };
      if (action === 'select' || action === 'start') {
        const original = JSON.parse(stored.get('original-selection')); assert.equal(original.phase, action === 'select' ? 'selected' : 'start_requested');
        assert.equal('order' in original.command.selection, false); assert.equal('submission' in original.command.clarification, false);
        assert.doesNotMatch(stored.get('original-selection'), /"(?:customerName|contactPhone|lines)"\s*:|Synthetic customer/);
      }
      let value;
      if (url.includes('/clarified/')) {
        const method = { prepare: 'prepareSelection', select: 'select', 'original-operation': 'readOriginalOperation' }[action];
        assert.ok(method); value = await controller[method](request, input);
        if (changedMaterial && action === 'prepare') value.material.fulfillment.returnLocationId += '-changed';
        if (action === 'select' && loseSelection) { loseSelection = false; throw Error('Lost frontend selection reply'); }
      } else if (url.startsWith('/' + shared.AI_TASK_CENTER_HTTP_DRAFT.basePath + '/')) {
        value = await taskCenterController[action](request, input);
      } else {
        assert.equal(url.startsWith('/' + shared.AI_SELECTED_QUOTE_TASK_HTTP_DRAFT.basePath + '/'), true);
        value = await taskController[action === 'start' ? 'start' : 'readResult'](request, input);
        if (action === 'start' && loseStart) { loseStart = false; throw Error('Lost original host reply'); }
      }
      return { data: { data: JSON.parse(JSON.stringify(value)) } };
    } } } };
    const { aiQuoteSelectionsApi } = require('../apps/admin/src/api/aiQuoteSelections');
    const { aiConversationsApi } = require('../apps/admin/src/api/aiConversations');
    const { ConversationQuoteSelectionSession } = require('../apps/admin/src/features/ai-native/conversation-quote-selection-session');
    const { aiTaskCenterApi } = require('../apps/admin/src/api/aiTaskCenter');
    const ports = { ...aiQuoteSelectionsApi, admission: aiConversationsApi.admission };
    const create = () => new ConversationQuoteSelectionSession('selection-conversation', turn, ports, () => current, () => source,
      { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }, 'original-selection');
    let session = create(); assert.equal(calls.length, 0); await session.inspect(); assert.equal(session.snapshot().ready, true);
    changedMaterial = true; await assert.rejects(session.select(), /AI_REVISION_CONFLICT/); assert.equal(stored.size, 0);
    changedMaterial = false; await session.inspect(); command.selectionKey = session.snapshot().preparation.selection.selectionKey;
    await assert.rejects(session.select(), /Lost frontend selection reply/); assert.equal(h.state.aiTaskQuoteSelection.length, 1);
    assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0); session.dispose();
    const beforeReload = calls.length; session = create(); assert.equal(calls.length, beforeReload); await session.reconcile();
    if (process.env.AI_OFFLINE_WRITE_ROOT) require('node:fs').writeFileSync(path.join(process.env.AI_OFFLINE_WRITE_ROOT, 'original-selection-material.json'), JSON.stringify(preparedSelection.material));
    selected = { receipt: session.snapshot().receipt, replayed: false }; await assert.rejects(session.select(), /AI_RESULT_UNKNOWN/);
    assert.equal(calls.filter(row => row.action === 'select').length, 1);
    conversationConsumer = { get session() { return session; }, calls, api: aiTaskCenterApi, setupCenter(controller) { taskCenterController = controller; }, async start(controller) {
      taskController = controller; await assert.rejects(session.start(), /Lost original host reply/); assert.equal(session.snapshot().startRequested, true);
      session.dispose(); session = create(); await session.reconcile(); await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/);
      assert.equal(calls.filter(row => row.action === 'start').length, 1);
    }, async result() { await session.readResult(); assert.equal(session.snapshot().result.status, 'committed');
      assert.equal(session.snapshot().result.order.quoteId, quote.id); current = false; session.retract();
      assert.equal(session.snapshot().result, null); const before = calls.length; await assert.rejects(session.readResult(), /AI_SCOPE_CHANGED/);
      assert.equal(calls.length, before); session.dispose(); }, restore() {
      if (oldQuery) Module._cache[queryFile] = oldQuery; else delete Module._cache[queryFile];
      if (oldHttp) Module._cache[httpFile] = oldHttp; else delete Module._cache[httpFile];
    } };
  } else if (standardPreparationFixture === 'http_reference') {
    const { AiClarifiedQuoteSelectionController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
    const controller = new AiClarifiedQuoteSelectionController(selectionConsumer);
    const clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
    const locator = { draftVersion: command.draftVersion, originalInputRef: command.originalInputRef, taskId: command.taskId,
      runId: command.runId, selectionKey: command.selectionKey, expectedSelectionRevision: command.expectedSelectionRevision, quoteId: command.order.quoteId };
    const read = { selection: locator, clarification: selectionClarification };
    const beforeMissing = clone(h.state);
    assert.equal((await controller.readOriginalOperation(request, read)).state, 'not_observed');
    assert.deepEqual(h.state, beforeMissing);
    await assert.rejects(async () => {
      await selectionConsumer.select(request, preparedSelection.selection, selectionClarification);
      throw Error('Lost selection transport reply');
    }, /Lost selection transport reply/);
    const beforeRead = clone(h.state), original = await controller.readOriginalOperation(request, read);
    assert.equal(original.state, 'observed'); assert.deepEqual(h.state, beforeRead);
    assert.equal(h.state.aiTaskQuoteSelection.length, 1); assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalOrder.length, 0);
    assert.equal('order' in locator, false); assert.equal('submission' in selectionClarification, false);
    await assert.rejects(controller.readOriginalOperation(request, { ...read, selection: { ...locator, quoteId: 'foreign-quote' } }),
      error => error.getResponse().code === 'AI_ACCESS_DENIED');
    await assert.rejects(controller.readOriginalOperation(request, { ...read, selection: { ...locator, expectedSelectionRevision: 1 } }),
      error => error.getResponse().code === 'AI_REVISION_CONFLICT');
    await assert.rejects(controller.readOriginalOperation(request, { ...read, selection: { ...locator, order: command.order } }),
      error => error.getResponse().code === 'AI_INVALID_INPUT');
    selected = { receipt: original.receipt, replayed: false };
  } else selected = await selectionConsumer.select(request, withDeliveryFixture || standardPreparationFixture ? preparedSelection.selection : command, selectionClarification);
  assert.equal(selected.receipt.approval, 'not_granted'); assert.equal(selected.receipt.runId, receipt.receipt.runId);
  assert.equal((await selectionConsumer.readOperation(request, command, selectionClarification)).receipt.selectionId, selected.receipt.selectionId);
  await assert.rejects(app.continueAnswer(finalQuery), error => error.code === 'AI_REVISION_CONFLICT');
  const selection = { draftVersion: selected.receipt.draftVersion, originalInputRef: selected.receipt.originalInputRef,
    selectionId: selected.receipt.selectionId, taskId: selected.receipt.taskId, runId: selected.receipt.runId, inputHash: selected.receipt.inputHash };
  const limits = structuredClone(h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification').limits); let ticks = 0;
  const orderTask = composeSelectedQuoteTaskApplication(dependencies, { host: { holderId: 'same-clarified-order', leaseMs: 100000 }, limits, monotonic: () => ++ticks });
  const modelCalls = h.execution.sent.length, taskCalls = h.state.aiTaskExecutionBudget[0].consumedCalls;
  if (conversationConsumer) {
    const { composeRequestBoundSelectedQuoteTask } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
    const { AiSelectedQuoteTaskController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
    const { credentials: _credentials, originals: _originals, ...requestDependencies } = dependencies;
    const requests = composeRequestBoundSelectedQuoteTask(requestDependencies, { enabled: true, audience: 'operator' },
      { host: { holderId: 'same-clarified-order', leaseMs: 100000 }, limits });
    await conversationConsumer.start(new AiSelectedQuoteTaskController(requests));
    assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION');
  } else assert.equal((await orderTask.start({ selection })).outcome.status, 'paused');
  const step = h.state.aiStep.find(row => row.runId === selection.runId), waiting = await orderTask.readConfirmation({ selection, stepId: step.id });
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0);
  h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: selection.taskId, operation: 'decide_approval', revision: 1,
    requiredPermissions: ['rental-os:order:create'], expiresAt: new Date('2027-01-01') });
  const human = composeHumanQuoteOrder(dependencies);
  let review, centerReview, centerQuery;
  if (conversationConsumer) {
    const { composeRequestBoundTaskCenter, AiTaskCenterController } = require('../apps/api/src/modules/ai-native/task-center.application');
    const { composeRequestBoundSelectedQuoteTask } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
    const { credentials: _credentials, originals: _originals, ...requestDependencies } = dependencies;
    const selectedRequests = composeRequestBoundSelectedQuoteTask(requestDependencies, { enabled: true, audience: 'operator' },
      { host: { holderId: 'same-clarified-order', leaseMs: 100000 }, limits });
    // The settings domain is explicitly unused; all order authority, persistence,
    // original host and Core ports are actual compositions over the same fixture.
    const center = composeRequestBoundTaskCenter({ db: h.db, auth: dependencies.auth, clock: dependencies.clock,
      humanApprovals: { order: requestDependencies, settings: { db: h.db }, decisions: { order: true, settings: false } },
      continuation: { db: h.db, order: selectedRequests }, business: { db: h.db, selectedOrderResult: selectedRequests } });
    conversationConsumer.setupCenter(new AiTaskCenterController(center)); centerQuery = { taskId: selection.taskId, runId: selection.runId, stepId: step.id };
    centerReview = await conversationConsumer.api.review(centerQuery, new AbortController().signal);
    assert.equal(centerReview.kind, 'order'); assert.equal(centerReview.businessExecution, 'not_attested'); review = centerReview.review;
  } else review = await human.readSelectedProposal({ selection, proposal: waiting.proposal });
  if (returnWaitingFixture) return { h, dependencies, quotes, quote, selection, waiting, human, review, orderTask, repository,
    original, candidate: reviewed.candidate, limits, request, finalQuery, modelCalls, taskCalls,
    ...(withDeliveryFixture ? { deliveryFixture, preparedSelection } : {}),
    ...(categoryDelivery ? { tenantAddressReads: () => tenantAddressReads } : {}) };
  let decision;
  if (conversationConsumer) {
    const received = await conversationConsumer.api.decision({ ...centerQuery, proposal: { ...waiting.proposal, decision: 'approve',
      reviewVersion: review.draftVersion } }, new AbortController().signal);
    assert.equal(received.receipt.kind, 'recorded'); assert.equal(received.businessExecution, 'not_attested'); decision = { approval: received.receipt.record };
  } else decision = await human.decideSelectedProposal({ selection, proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
  assert.equal(decision.approval.decision, 'approved'); if (!conversationConsumer) assert.equal(decision.order, 'not_created_by_decision');
  // Begin same name chosen membership withdrawal.
  if (standardPreparationFixture === 'same_name_revoked') {
    const beforeQuote = structuredClone(quote), resolve = h.b.memberships.resolveBookingIdentity;
    let membershipFailures = 0, failureStatus;
    h.b.memberships.resolveBookingIdentity = async function (...args) {
      assert.equal(args[2], 'customer-b');
      try { return await resolve.apply(this, args); }
      catch (error) { membershipFailures++; failureStatus = error.getStatus?.(); throw error; }
    };
    h.b.membershipRows.link.status = 'suspended';
    let blocked;
    try { blocked = await orderTask.continueConfirmation({ selection, checkpointRef: waiting.checkpointRef }); }
    catch (error) { blocked = { rejected: true, code: error.code ?? null }; }
    assert.ok(membershipFailures > 0); assert.equal(failureStatus, 409);
    assert.notEqual(blocked.outcome?.status, 'succeeded'); assert.equal(h.state.rentalOrder.length, 0);
    assert.equal(h.state.aiApprovalConsumption.length, 0); assert.equal(h.state.rentalOrderIdempotencyRecord.length, 0);
    assert.deepEqual(quotes[0].quote, beforeQuote); assert.equal(quotes.length, 1);
    const retained = await human.readSelectedDecisionReceipt({ selection,
      proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
    assert.equal(retained.record.approvalId, decision.approval.approvalId);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.execution.sent.length, modelCalls);
    return { chosenMemberRefused: true };
  }
  // End same name chosen membership withdrawal.
  if (cancelAfterApproval) {
    assert.equal(expireBeforeExecution, false); assert.equal(loseInventoryAtLock, false);
    const quoteBefore = structuredClone(quote), orderBefore = structuredClone(order), approvalId = decision.approval.approvalId;
    const create = confirmation.createApprovedOrder; let coreExecutions = 0;
    confirmation.createApprovedOrder = function(...args) { coreExecutions++; return create.apply(this, args); };
    const cancel = await orderTask.requestCancel({ selection, expectedRevision: h.state.aiTask[0].revision });
    assert.equal(cancel.cancellation, 'requested_not_rollback'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
    assert.ok(h.state.aiTask[0].cancelRequestedAt);
    // This is the original request-to-cancel transition after a recorded human
    // decision, not a rollback receipt or an authorization to retry the write.
    let stopped;
    try { stopped = await orderTask.continueConfirmation({ selection, checkpointRef: waiting.checkpointRef }); }
    catch (error) { stopped = { rejected: true, code: error.code ?? null }; }
    assert.notEqual(stopped.outcome?.status, 'succeeded'); assert.equal(coreExecutions, 0);
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 0); assert.equal(h.state.rentalQuote[0].consumedAt, null);
    assert.equal(h.state.rentalQuote[0].consumedOrderId, null); assert.deepEqual(h.state.rentalQuote[0].snapshot, quoteBefore);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApproval[0].id, approvalId);
    assert.equal(h.state.aiApproval[0].decision, 'APPROVED'); assert.deepEqual(quote, quoteBefore); assert.deepEqual(order, orderBefore);
    const retained = await human.readSelectedDecisionReceipt({ selection,
      proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
    assert.equal(retained.record.approvalId, approvalId);
    const observation = await orderTask.readResult({ selection });
    assert.ok(['not_observed', 'unknown'].includes(observation.status)); assert.equal(observation.retryable, false);
    assert.equal(observation.nextAction, 'read_selected_order_result'); assert.deepEqual(await orderTask.readResult({ selection }), observation);
    const center = require('../apps/api/src/modules/ai-native/task-center-scene.composition').composeAiTaskCenterScene({
      list: { readPage: async () => { throw Error('not used'); } }, scenes: h.model.scenes, selections: repository, orders: orderTask });
    const displayed = await center.readOrderResult({ original: h.reference, reference: { selection } });
    assert.deepEqual(displayed.result, observation); assert.equal(displayed.runId, selection.runId);
    assert.equal(displayed.execution, 'read_only_no_start_no_reconnect_side_effect');
    assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, taskCalls);
    assert.equal(h.execution.sent.length, modelCalls); assert.equal(quotes.length, 1); assert.equal(coreExecutions, 0);
    // Do not fake cancellation completion, erase the old decision, reconcile a
    // new action, restore a waiting state or silently reuse the approved quote.
    return;
  }
  if (loseInventoryAtLock) {
    assert.equal(expireBeforeExecution, false);
    const quoteBefore = structuredClone(quote), orderBefore = structuredClone(order), approvalId = decision.approval.approvalId;
    const lock = h.b.facts.lockInventoryTargets, stock = h.b.facts.listStockBalances;
    const checkInventory = h.b.core.assertAvailabilityWithLocks;
    let locks = 0, rechecks = 0, failures = 0, failureStatus, failureMessage;
    h.b.facts.lockInventoryTargets = async function(...args) {
      assert.equal(args[0], 'tenant_001'); assert.equal(args[1], h.b.location.id); assert.ok(args[2].length > 0); assert.ok(args[3]);
      await lock.apply(this, args); locks++;
      // Only this new fixture's physical inventory changes AFTER the original
      // lock port returns. Catalog, frozen quote, person/approval and permissions
      // stay unchanged; no substitute item, restored stock or second operation.
      const balances = await stock.call(this);
      h.b.facts.listAssets = async () => [];
      h.b.facts.listStockBalances = async () => balances.map(row => ({ ...row, onHandQuantity: 0, maintenanceQuantity: 0 }));
    };
    h.b.core.assertAvailabilityWithLocks = async function(...args) {
      rechecks++;
      try { return await checkInventory.apply(this, args); }
      catch (error) { failures++; failureStatus = error.getStatus?.(); failureMessage = error.message; throw error; }
    };
    let blocked;
    try { blocked = await orderTask.continueConfirmation({ selection, checkpointRef: waiting.checkpointRef }); }
    catch (error) { blocked = { rejected: true, code: error.code ?? null }; }
    assert.ok(locks > 0); assert.ok(rechecks > 0); assert.ok(failures > 0);
    assert.equal(failureStatus, 409); assert.equal(failureMessage, '库存已被其他订单占用，请重新选择租期或数量');
    assert.notEqual(blocked.outcome?.status, 'succeeded');
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 0); assert.equal(h.state.rentalQuote[0].consumedAt, null);
    assert.equal(h.state.rentalQuote[0].consumedOrderId, null);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApproval[0].id, approvalId);
    assert.equal(h.state.aiApproval[0].decision, 'APPROVED'); assert.deepEqual(quote, quoteBefore); assert.deepEqual(order, orderBefore);
    assert.deepEqual(h.state.rentalQuote[0].snapshot, quoteBefore);
    const retained = await human.readSelectedDecisionReceipt({ selection,
      proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
    assert.equal(retained.record.approvalId, approvalId);
    const observation = await orderTask.readResult({ selection });
    assert.ok(['not_observed', 'unknown'].includes(observation.status)); assert.equal(observation.retryable, false);
    assert.equal(observation.nextAction, 'read_selected_order_result'); assert.deepEqual(await orderTask.readResult({ selection }), observation);
    const center = require('../apps/api/src/modules/ai-native/task-center-scene.composition').composeAiTaskCenterScene({
      list: { readPage: async () => { throw Error('not used'); } }, scenes: h.model.scenes, selections: repository, orders: orderTask });
    const displayed = await center.readOrderResult({ original: h.reference, reference: { selection } });
    assert.deepEqual(displayed.result, observation); assert.equal(displayed.runId, selection.runId);
    assert.equal(displayed.execution, 'read_only_no_start_no_reconnect_side_effect');
    assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, taskCalls);
    assert.equal(h.execution.sent.length, modelCalls); assert.equal(quotes.length, 1);
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
    return;
  }
  if (expireBeforeExecution) {
    assert.equal(enterprise, true);
    const quoteBefore = structuredClone(quotes[0].quote), approvalId = decision.approval.approvalId;
    const resolveMember = h.b.memberships.resolveBookingIdentity.bind(h.b.memberships); let currentChecks = 0, membershipFailures = 0;
    h.b.memberships.resolveBookingIdentity = async (...args) => {
      currentChecks++;
      try { return await resolveMember(...args); } catch (error) { membershipFailures++; throw error; }
    };
    // Only this new synthetic relation expires. Never revoke the caller, edit
    // the old quote/approval, restore the relationship or retry an unknown write.
    h.b.membershipRows.bookingOptions[0].effectiveTo = new Date(h.dependencies.clock().getTime() - 1);
    let blocked;
    try { blocked = await orderTask.continueConfirmation({ selection, checkpointRef: waiting.checkpointRef }); }
    catch (error) { blocked = { rejected: true, code: error.code ?? null }; }
    assert.ok(currentChecks > 0); assert.ok(membershipFailures > 0, 'the original current-membership service must reject this execution');
    assert.notEqual(blocked.outcome?.status, 'succeeded');
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 0); assert.equal(h.state.rentalQuote[0].consumedAt, null);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApproval[0].id, approvalId);
    assert.equal(h.state.aiApproval[0].decision, 'APPROVED'); assert.deepEqual(quotes[0].quote, quoteBefore);
    const originalDecision = await human.readSelectedDecisionReceipt({ selection,
      proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
    assert.equal(originalDecision.record.approvalId, approvalId);
    const observation = await orderTask.readResult({ selection });
    assert.ok(['not_observed', 'unknown'].includes(observation.status)); assert.equal(observation.retryable, false);
    assert.equal(observation.nextAction, 'read_selected_order_result');
    assert.deepEqual(await orderTask.readResult({ selection }), observation);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, taskCalls);
    assert.equal(h.execution.sent.length, modelCalls); assert.equal(quotes.length, 1);
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
    return;
  }
  assert.equal(h.state.rentalOrder.length, 0); let lost = false;
  h.control.beforeCommit = async draft => { if (draft.rentalOrder.length === 1 && h.state.rentalOrder.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  let uncertain;
  if (conversationConsumer) {
    const current = await conversationConsumer.api.review(centerQuery, new AbortController().signal);
    uncertain = await conversationConsumer.api.continue({ ...centerQuery, checkpointRef: current.checkpointRef,
      expectedTaskRevision: current.taskRevision, proposal: { ...waiting.proposal, reviewVersion: current.review.draftVersion } }, new AbortController().signal);
    assert.equal(uncertain.businessExecution, 'read_original_receipt'); assert.equal(uncertain.automaticRetry, false);
  } else uncertain = await orderTask.continueConfirmation({ selection, checkpointRef: waiting.checkpointRef });
  assert.equal(lost, true); assert.equal(conversationConsumer ? uncertain.status : uncertain.outcome.status, 'unknown'); assert.equal(h.state.rentalOrder.length, 1);
  const originalResult = await orderTask.readResult({ selection }); assert.equal(originalResult.status, 'committed');
  if (conversationConsumer) { await conversationConsumer.result(); conversationConsumer.restore(); }
  // Begin same name original Core customer.
  if (standardPreparationFixture === 'same_name') {
    assert.equal(h.state.rentalOrder[0].customerId, 'customer-b');
    assert.equal(h.state.rentalOrder[0].membershipSnapshot.personalCustomerId, 'customer-b');
    assert.notEqual(h.state.rentalOrder[0].customerId, 'customer-a');
  }
  // End same name original Core customer.
  assert.equal(originalResult.order.quoteId, quote.id);
  if (cancelAfterCommittedReplyLoss) {
    assert.equal(enterprise, false); assert.equal(expireBeforeExecution, false);
    assert.equal(loseInventoryAtLock, false); assert.equal(cancelAfterApproval, false);
    assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
    const before = structuredClone({ orders: h.state.rentalOrder, quotes: h.state.rentalQuote,
      approvals: h.state.aiApproval, consumptions: h.state.aiApprovalConsumption, idempotency: h.state.rentalOrderIdempotencyRecord });
    const originalQuote = structuredClone(quote), budgets = structuredClone(h.state.aiTaskExecutionBudget), runs = h.state.aiRun.map(row => row.id);
    const create = confirmation.createApprovedOrder; let repeatedExecutions = 0;
    confirmation.createApprovedOrder = function(...args) { repeatedExecutions++; return create.apply(this, args); };
    // Original Core has committed the ONE approved order. This later cancel is
    // the task's request transition, not an order cancellation/rollback receipt.
    // Observe only the original consumption/idempotency and decision evidence;
    // never reconcile/start a new action to make the uncertain runner green.
    const cancellation = await orderTask.requestCancel({ selection, expectedRevision: h.state.aiTask[0].revision });
    assert.equal(cancellation.cancellation, 'requested_not_rollback');
    assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.ok(h.state.aiTask[0].cancelRequestedAt);
    assert.deepEqual(await orderTask.readResult({ selection }), originalResult);
    const retained = await human.readSelectedDecisionReceipt({ selection,
      proposal: { ...waiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
    assert.equal(retained.record.approvalId, decision.approval.approvalId);
    const center = require('../apps/api/src/modules/ai-native/task-center-scene.composition').composeAiTaskCenterScene({
      list: { readPage: async () => { throw Error('not used'); } }, scenes: h.model.scenes, selections: repository, orders: orderTask });
    const displayed = await center.readOrderResult({ original: h.reference, reference: { selection } });
    assert.deepEqual(displayed.result, originalResult); assert.equal(displayed.runId, selection.runId);
    assert.equal(displayed.execution, 'read_only_no_start_no_reconnect_side_effect');
    assert.deepEqual(await orderTask.readResult({ selection }), originalResult);
    assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1); assert.equal(h.state.rentalQuote[0].consumedOrderId, originalResult.order.id);
    assert.equal(h.state.rentalOrderIdempotencyRecord[0].orderId, originalResult.order.id);
    assert.deepEqual(h.state.rentalOrder[0].lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
      quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })));
    assert.deepEqual({ orders: h.state.rentalOrder, quotes: h.state.rentalQuote, approvals: h.state.aiApproval,
      consumptions: h.state.aiApprovalConsumption, idempotency: h.state.rentalOrderIdempotencyRecord }, before);
    assert.deepEqual(h.state.aiTaskExecutionBudget, budgets); assert.deepEqual(h.state.aiRun.map(row => row.id), runs);
    assert.equal(h.execution.sent.length, modelCalls); assert.equal(quotes.length, 1); assert.deepEqual(quote, originalQuote);
    assert.equal(repeatedExecutions, 0); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
    h.b.h.identity.user.permissions = [];
    await assert.rejects(orderTask.readResult({ selection }), error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code));
    await assert.rejects(center.readOrderResult({ original: h.reference, reference: { selection } }),
      error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code));
    assert.deepEqual({ orders: h.state.rentalOrder, quotes: h.state.rentalQuote, approvals: h.state.aiApproval,
      consumptions: h.state.aiApprovalConsumption, idempotency: h.state.rentalOrderIdempotencyRecord }, before);
    assert.deepEqual(h.state.aiTaskExecutionBudget, budgets); assert.equal(h.execution.sent.length, modelCalls);
    assert.equal(repeatedExecutions, 0);
    return;
  }
  assert.equal((await orderTask.reconcile({ selection })).outcome.status, 'succeeded');
  assert.deepEqual(await orderTask.readResult({ selection }), originalResult);
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1); assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1);
  assert.equal(h.state.rentalQuote[0].consumedOrderId, originalResult.order.id);
  assert.equal(h.state.rentalOrderIdempotencyRecord[0].orderId, originalResult.order.id);
  assert.deepEqual(h.state.rentalOrder[0].lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
    quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })));
  assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, taskCalls);
  assert.equal(h.execution.sent.length, modelCalls); assert.equal(quotes.length, 1);
  const center = require('../apps/api/src/modules/ai-native/task-center-scene.composition').composeAiTaskCenterScene({
    list: { readPage: async () => { throw Error('not used'); } }, scenes: h.model.scenes, selections: repository, orders: orderTask });
  const displayed = await center.readOrderResult({ original: h.reference, reference: { selection } });
  assert.equal(displayed.result.order.id, originalResult.order.id); assert.equal(displayed.runId, selection.runId);
  if (enterprise) {
    const storedOrder = h.state.rentalOrder[0], historical = structuredClone(storedOrder.membershipSnapshot), quoteBefore = structuredClone(quotes[0].quote);
    assert.equal(storedOrder.customerId, 'customer-a');
    assert.equal(historical.bookingIdentity, 'enterprise_employee'); assert.equal(historical.personalCustomerId, 'customer-a');
    assert.equal(historical.corporateCustomerId, 'company-a'); assert.equal(historical.corporateMembershipId, 'relationship-a');
    assert.equal(historical.enterpriseContractAndPayer, false);
    // End only this fresh synthetic relationship. Original quote/order member
    // snapshots must not be rebuilt from current qualification or grant a payer.
    h.b.membershipRows.bookingOptions[0].effectiveTo = new Date(h.dependencies.clock().getTime() - 1);
    assert.deepEqual(await orderTask.readResult({ selection }), originalResult);
    assert.deepEqual(h.state.rentalOrder[0].membershipSnapshot, historical);
    assert.deepEqual(quotes[0].quote, quoteBefore);
    assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    assert.equal(h.execution.sent.length, modelCalls);
  }
  h.b.h.identity.user.permissions = [];
  await assert.rejects(orderTask.readResult({ selection }), error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code));
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.execution.sent.length, modelCalls);
}

// Actual Core requote after a proved rejected original; only storage/identity/transport facts are doubles.
const coreRequoteClone = require('./fixtures/ai-native/task-input-store.cjs').clone;
// Same fixed receipt-table leaf as approved-order-controlled.cjs, attached only
// to this new fixture. No generic SQL execution or synthetic business result.
function coreRequoteReceiptPorts(client) {
  const { reprepareRowSchema } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-reprepare.repository');
  const columns = Object.keys(reprepareRowSchema.shape), select = Object.fromEntries(columns.map(name => [name, true]));
  const queryRaw = client.$queryRaw.bind(client), executeRaw = client.$executeRaw.bind(client);
  return {
    $queryRaw: async query => {
      if (!query.sql.includes('FROM ai_approval_reprepares')) return queryRaw(query);
      assert.equal(query.sql, 'SELECT * FROM ai_approval_reprepares WHERE scopeId = ? AND operationKey = ? LIMIT 1');
      assert.equal(query.values.length, 2);
      const [scopeId, operationKey] = query.values;
      return client.aiApprovalReprepare.findMany({ where: { scopeId, operationKey }, select, take: 1 });
    },
    $executeRaw: async query => {
      if (!query.sql.startsWith('INSERT INTO ai_approval_reprepares')) return executeRaw(query);
      const names = query.sql.match(/\((.*?)\) VALUES/s)[1].split(',').map(name => name.trim().replaceAll('`', ''));
      assert.deepEqual(names, columns); assert.equal(query.values.length, columns.length);
      const row = reprepareRowSchema.parse(Object.fromEntries(columns.map((name, i) => [name, coreRequoteClone(query.values[i])])));
      const duplicate = await client.aiApprovalReprepare.findFirst({ where: { OR: [{ id: row.id },
        { scopeId: row.scopeId, operationKey: row.operationKey },
        { scopeId: row.scopeId, originalTaskId: row.originalTaskId, originalProposalId: row.originalProposalId, originalRevision: row.originalRevision },
        { scopeId: row.scopeId, replacementTaskId: row.replacementTaskId, replacementActionId: row.replacementActionId }] } });
      if (duplicate) throw Object.assign(Error('synthetic duplicate key'), { code: 'P2002' });
      await client.aiApprovalReprepare.create({ data: row }); return 1;
    }
  };
}
async function actualCoreRequoteSetup(stockReselection = false) {
  const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true);
  const { h } = f, shared = require('@rental-os/shared');
  const originalTransaction = h.db.$transaction;
  Object.assign(h.db, coreRequoteReceiptPorts(h.db));
  h.db.$transaction = (work, ...options) => originalTransaction.call(h.db,
    tx => work({ ...tx, ...coreRequoteReceiptPorts(tx) }), ...options);
  // Begin opt-in current-stock reselection.
  let stockReview;
  if (stockReselection) {
    const unavailableItem = f.quote.request.lines[0].itemGroupId;
    const assets = h.b.facts.listAssets, balances = h.b.facts.listStockBalances;
    h.b.facts.listAssets = async (...args) => (await assets(...args)).filter(row => row.itemGroupId !== unavailableItem);
    h.b.facts.listStockBalances = async (...args) => (await balances(...args)).map(row => row.itemGroupId === unavailableItem
      ? { ...row, onHandQuantity: 0, maintenanceQuantity: 0 } : row);
    const { credentials, originals, ...readDependencies } = f.dependencies;
    const reads = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
      readDependencies, { enabled: true, audience: 'operator' });
    const before = coreRequoteClone(h.state), modelCalls = h.execution.sent.length;
    stockReview = await reads.readSelectedAvailability(f.request, { selection: f.selection });
    assert.equal(stockReview.availability.available, false); assert.equal(stockReview.inventory, 'observed_not_reserved');
    assert.equal(stockReview.reselection, 'explicit_user_required'); assert.equal(stockReview.approval, 'not_granted');
    assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, modelCalls);
  }
  // End opt-in current-stock reselection.
  await f.human.decideSelectedProposal({ selection: f.selection,
    proposal: { ...f.waiting.proposal, decision: 'reject', reviewVersion: f.review.draftVersion } });
  const rejected = await f.orderTask.continueConfirmation({ selection: f.selection, checkpointRef: f.waiting.checkpointRef });
  assert.equal(rejected.outcome.status, 'partially_succeeded'); // Completed clarification/model prefix remains successful.
  const rejectedOrderStep = h.state.aiStep.find(row => row.taskId === f.selection.taskId && row.toolCode === 'rental.order.commit');
  assert.equal(rejectedOrderStep.status, 'FAILED'); assert.equal(rejectedOrderStep.effect, 'NONE');
  assert.equal(h.state.rentalOrder.length, 0);
  const eligibility = await f.human.readSelectedReprepareEligibility({ selection: f.selection,
    request: { draftVersion: shared.AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: f.waiting.proposal, intent: 'inspect' } });
  if (eligibility.state !== 'rejected') console.error('REQUOTE_REJECTED_WITNESS', JSON.stringify({
    original: f.waiting.proposal, step: rejectedOrderStep,
    phases: h.state.aiTaskExecutionPhaseReceipt.filter(row => row.taskId === f.selection.taskId && row.stepId === rejectedOrderStep.id)
      .map(row => ({ id: row.id, kind: row.kind, errorCode: row.errorCode, decisionRef: row.decisionRef,
        businessResultRef: row.businessResultRef, proposalId: row.proposalId, proposalRevision: row.proposalRevision,
        reviewedPayloadHash: row.reviewedPayloadHash, payload: row.payload })),
    approvals: h.state.aiApproval.filter(row => row.taskId === f.selection.taskId),
    consumptions: h.state.aiApprovalConsumption.filter(row => row.taskId === f.selection.taskId),
    taskStatus: h.state.aiTask.find(row => row.id === f.selection.taskId).status,
    quote: (() => { const row = h.state.rentalQuote.find(row => row.id === f.quote.id);
      return { id: row.id, consumedAt: row.consumedAt, consumedOrderId: row.consumedOrderId }; })()
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.equal(eligibility.state, 'rejected'); assert.equal(eligibility.canRequestReprepare, true);
  const changed = h.state.aiTaskEvent.find(row => row.taskId === f.selection.taskId && row.type === 'step.changed'
    && row.payload.data.stepId === rejectedOrderStep.id && row.payload.data.status === 'failed');
  const originalEvent = coreRequoteClone(changed.payload);
  changed.payload.evidence.id = '00000000-0000-4000-8000-000000000001';
  const unavailable = await f.human.readSelectedReprepareEligibility({ selection: f.selection,
    request: { draftVersion: shared.AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: f.waiting.proposal, intent: 'inspect' } });
  assert.equal(unavailable.state, 'unknown'); assert.equal(unavailable.canRequestReprepare, false);
  // Fixture commits replace row objects, including authorization transactions.
  // Reacquire the exact event instead of mutating a detached pre-read reference.
  assert.equal(typeof changed.cursor, 'bigint');
  const restoredEvents = h.state.aiTaskEvent.filter(row => row.scopeId === changed.scopeId
    && row.taskId === changed.taskId && row.cursor === changed.cursor);
  assert.equal(restoredEvents.length, 1); restoredEvents[0].payload = originalEvent;
  assert.deepEqual(restoredEvents[0].payload, originalEvent);
  const restored = await f.human.readSelectedReprepareEligibility({ selection: f.selection,
    request: { draftVersion: shared.AI_APPROVAL_APPLICATION_DRAFT_VERSION, original: f.waiting.proposal, intent: 'inspect' } });
  assert.equal(restored.state, 'rejected'); assert.equal(restored.canRequestReprepare, true);
  // Only the deliberate synthetic corruption was restored, never a real unknown action.
  h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: f.selection.taskId, operation: 'reprepare_approval', revision: 1,
    requiredPermissions: ['rental-os:order:create'], expiresAt: new Date('2027-01-01') });
  const oldRows = () => coreRequoteClone(Object.fromEntries(['aiTask','aiRun','aiStep','aiTaskRunPlan','aiTaskActionInput',
    'aiTaskExecutionBudget','aiTaskExecutionCharge','aiTaskRunPreparation','aiTaskEvent'].map(name => [name,
      h.state[name].filter(row => row.taskId === f.selection.taskId || row.id === f.selection.taskId)])));
  const frozen = oldRows(), candidate = structuredClone(f.candidate);
  assert.equal(candidate.items[0].quantity, 1); candidate.items[0].quantity = 2; // Explicit new user choice, not a model substitution.
  // Begin opt-in new product choice.
  if (stockReselection) {
    candidate.items = [structuredClone(f.candidate.items[1])]; // Explicit user chooses the other original product only.
    assert.equal(candidate.items[0].quantity, 2);
    assert.notEqual(candidate.items[0].itemGroupId, f.quote.request.lines[0].itemGroupId);
  }
  // End opt-in new product choice.
  const choices = await h.model.scenes.tools.quote.candidates.prepare(candidate);
  assert.equal(choices.status, 'missing_input'); assert.ok(choices.missingFields.includes('selectionRevision'));
  assert.notEqual(choices.selectionRevision, candidate.selectionRevision);
  // The synthetic user rechecks the displayed current choices after editing
  // quantity. This is new parameter confirmation, never the old order approval.
  candidate.selectionRevision = choices.selectionRevision;
  assert.equal((await h.model.scenes.tools.quote.candidates.prepare(candidate)).status, 'needs_confirmation');
  const created = await h.model.scenes.reissue({ draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION,
    requestKey: 'core-requote-user-quantity', previousInputRef: h.reference.inputRef,
    sceneCode: 'quote_clarification', input: { candidate } });
  assert.equal(created.stage, 'task_metadata_created'); assert.equal(created.model, 'not_called');
  const reference = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: created.receipt.inputRef };
  const templates = coreRequoteClone(h.state.aiTaskActionPolicy.filter(row => row.taskId === f.selection.taskId));
  h.state.aiTaskActionPolicy.push(...templates.map(row => ({ ...row, taskId: created.task.taskId })));
  const reviewed = await h.model.scenes.reviewQuote(reference);
  assert.equal(reviewed.facts.status, 'ready'); assert.equal(reviewed.quotePersistence, 'not_attempted');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const quoted = await h.model.scenes.confirmQuote({ ...reference, selectionRevision: reviewed.facts.selectionRevision,
    inputFingerprint: requestFingerprint(reviewed.facts.request), confirmQuote: true });
  assert.equal(quoted.result.status, 'quoted'); assert.equal(f.quotes.length, 2);
  const quote = f.quotes.find(row => row.quote.id === quoted.result.quote.id).quote;
  assert.notEqual(quote.id, f.quote.id); assert.equal(quote.request.lines[0].quantity, 2);
  assert.equal(f.quote.request.lines[0].quantity, 1); assert.equal(h.state.rentalOrder.length, 0);
  // Exact persisted Core quote is exposed through the fixture's existing quote repository adapter.
  await h.db.rentalQuote.create({ data: { id: quote.id, tenantId: quote.tenantId, snapshot: structuredClone(quote), consumedAt: null, consumedOrderId: null } });
  const q = quote.request;
  const order = { quoteId: quote.id, customerType: 'personal', customerId: 'customer-a', customerName: h.b.membershipRows.customer.name,
    fulfillmentMode: q.fulfillmentMode, fulfillmentLocationId: q.fulfillmentLocationId,
    ...(q.returnLocationId ? { returnLocationId: q.returnLocationId } : {}), startAt: q.startAt, endAt: q.endAt,
    lines: q.lines.map(({ itemGroupId, pricingGroupId, quantity, note }) => ({ itemGroupId, quantity,
      ...(pricingGroupId ? { pricingGroupId } : {}), ...(note ? { note } : {}) })) };
  const selected = await f.repository.select({ draftVersion: shared.AI_QUOTE_SELECTION_DRAFT_VERSION,
    originalInputRef: reference.inputRef, taskId: created.task.taskId, runId: created.task.runId,
    selectionKey: 'core-requote-human-new-choice', expectedSelectionRevision: 0, order });
  const selection = { draftVersion: selected.receipt.draftVersion, originalInputRef: selected.receipt.originalInputRef,
    taskId: selected.receipt.taskId, runId: selected.receipt.runId, selectionId: selected.receipt.selectionId, inputHash: selected.receipt.inputHash };
  assert.notEqual(selection.taskId, f.selection.taskId); assert.notEqual(selection.inputHash, f.selection.inputHash);
  assert.equal((await f.orderTask.start({ selection })).outcome.status, 'paused');
  const step = h.state.aiStep.find(row => row.taskId === selection.taskId && row.toolCode === 'rental.order.commit');
  const wait = await f.orderTask.readConfirmation({ selection, stepId: step.id });
  const plan = h.state.aiTaskRunPlan.find(row => row.taskId === selection.taskId && row.runId === selection.runId);
  const configuration = { holderId: 'same-clarified-order', creationRules: f.dependencies.creationRules.filter(row => row.sceneCode === 'quote_clarification'),
    memberships: f.dependencies.memberships };
  const { credentials, originals, ...dependencies } = f.dependencies;
  const requests = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' }, configuration);
  const command = { draftVersion: shared.AI_APPROVAL_APPLICATION_DRAFT_VERSION, operationKey: 'core-requote-original-reprepare',
    originalTaskId: f.selection.taskId, original: f.waiting.proposal, reason: 'rejected', replacement: {
      taskId: selection.taskId, runId: selection.runId, stepId: step.id, actionId: step.actionId, inputRef: step.inputRef,
      fingerprint: selection.inputHash, originalInputRef: selection.originalInputRef, quoteSelectionRef: selection.selectionId, planHash: plan.planHash } };
  const prepared = await requests.reprepareSelectedProposal(f.request, { selection: f.selection, command });
  assert.equal(h.state.aiApprovalReprepare.length, 1);
  assert.equal(prepared.receipt.state, 'prepared'); assert.equal(prepared.order, 'not_created_by_reprepare');
  assert.equal(prepared.receipt.proposal.proposalId, wait.proposal.proposalId, 'reuse the actual new normal-run wait, not another proposal');
  assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.deepEqual(oldRows(), frozen); assert.equal(h.execution.sent.length, f.modelCalls);
  return { ...f, created, reference, requests, command, newSelection: selection, newWaiting: wait, newQuote: quote, oldRows, frozen,
    ...(stockReselection ? { stockReview } : {}) };
}

test('AIN15 actual Core requote new quantity reuses normal-run proposal then new approval and one order through lost reply', { timeout: 120000 }, async () => {
  const f = await actualCoreRequoteSetup(), { h } = f;
  await assert.rejects(f.orderTask.continueConfirmation({ selection: f.newSelection, checkpointRef: f.newWaiting.checkpointRef }));
  assert.equal(h.state.rentalOrder.length, 0);
  const review = await f.requests.readSelectedProposal(f.request, { selection: f.newSelection, proposal: f.newWaiting.proposal });
  const approved = await f.requests.decideSelectedProposal(f.request, { selection: f.newSelection,
    proposal: { ...f.newWaiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
  assert.equal(approved.approval.decision, 'approved'); assert.equal(h.state.rentalOrder.length, 0);
  let lost = false;
  h.control.beforeCommit = async draft => { if (!lost && draft.rentalOrder.length === 1 && h.state.rentalOrder.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  const uncertain = await f.orderTask.continueConfirmation({ selection: f.newSelection, checkpointRef: f.newWaiting.checkpointRef });
  assert.equal(lost, true); assert.equal(uncertain.outcome.status, 'unknown');
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  const observed = await f.orderTask.readResult({ selection: f.newSelection });
  assert.equal(observed.status, 'committed'); assert.equal(observed.order.quoteId, f.newQuote.id);
  assert.equal((await f.orderTask.reconcile({ selection: f.newSelection })).outcome.status, 'succeeded');
  assert.deepEqual(await f.orderTask.readResult({ selection: f.newSelection }), observed);
  assert.deepEqual(h.state.rentalOrder[0].lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
    f.newQuote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })));
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1); assert.equal(f.quotes.length, 2);
  assert.deepEqual(f.oldRows(), f.frozen); assert.equal(h.execution.sent.length, f.modelCalls);
});

test('AIN15 actual Core requote new approval still rejects inventory lost at Core lock without old quote reuse', { timeout: 120000 }, async () => {
  const f = await actualCoreRequoteSetup(), { h } = f;
  const review = await f.requests.readSelectedProposal(f.request, { selection: f.newSelection, proposal: f.newWaiting.proposal });
  await f.requests.decideSelectedProposal(f.request, { selection: f.newSelection,
    proposal: { ...f.newWaiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
  const originalLock = h.b.facts.lockInventoryTargets, originalStock = h.b.facts.listStockBalances;
  const quoteRows = coreRequoteClone(h.state.rentalQuote); let locks = 0;
  h.b.facts.lockInventoryTargets = async function(...args) {
    await originalLock.apply(this, args); locks++;
    const balances = await originalStock.call(this);
    h.b.facts.listAssets = async () => [];
    h.b.facts.listStockBalances = async () => balances.map(row => ({ ...row, onHandQuantity: 0, maintenanceQuantity: 0 }));
  };
  let blocked;
  try { blocked = await f.orderTask.continueConfirmation({ selection: f.newSelection, checkpointRef: f.newWaiting.checkpointRef }); }
  catch (error) { blocked = { errorCode: error.code }; }
  assert.ok(locks > 0); assert.notEqual(blocked.outcome?.status, 'succeeded');
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(h.state.rentalOrderIdempotencyRecord.length, 0); assert.deepEqual(h.state.rentalQuote, quoteRows);
  assert.equal(h.state.aiApproval.length, 2); assert.equal(f.quotes.length, 2);
  assert.deepEqual(f.oldRows(), f.frozen); assert.equal(h.execution.sent.length, f.modelCalls);
});

// Begin selected stock R0 owned cases.
async function selectedStockR0Fixture() {
  const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true);
  const { credentials, originals, ...dependencies } = f.dependencies;
  const reads = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' });
  return { ...f, reads };
}
test('AIN15 selected stock R0 uses original guarded read without initialization or business effects', { timeout: 120000 }, async () => {
  const f = await selectedStockR0Fixture(), { h } = f, core = h.b.core;
  const before = coreRequoteClone(h.state), models = h.execution.sent.length;
  const original = core.readAvailability.bind(core); let reads = 0, legacy = 0;
  core.readAvailability = async (...args) => { reads++; return original(...args); };
  core.availability = async () => { legacy++; throw Error('legacy availability must not be used'); };
  const result = await f.reads.readSelectedAvailability(f.request, { selection: f.selection });
  assert.equal(reads, 1); assert.equal(legacy, 0); assert.equal(result.inventory, 'observed_not_reserved');
  assert.equal(result.reselection, 'explicit_user_required'); assert.equal(result.approval, 'not_granted');
  assert.equal(result.execution, 'not_attempted'); assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, models);
});
test('AIN15 selected stock R0 missing port fails closed without legacy fallback', { timeout: 120000 }, async () => {
  const f = await selectedStockR0Fixture(), { h } = f, core = h.b.core;
  const before = coreRequoteClone(h.state), models = h.execution.sent.length; let legacy = 0;
  core.readAvailability = undefined; core.availability = async () => { legacy++; throw Error('unexpected legacy fallback'); };
  await assert.rejects(f.reads.readSelectedAvailability(f.request, { selection: f.selection }), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(legacy, 0); assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, models);
});
test('AIN15 selected stock R0 accepts refreshed authorization time with unchanged binding', { timeout: 120000 }, async () => {
  const f = await selectedStockR0Fixture(), { h } = f, core = h.b.core;
  const before = coreRequoteClone(h.state), models = h.execution.sent.length; let calls = 0;
  const startedAt = f.dependencies.clock().getTime(); assert.ok(Number.isFinite(startedAt));
  for (const name of ['availability', 'readAvailability']) {
    const original = core[name].bind(core);
    core[name] = async (...args) => { const result = await original(...args); calls++;
      h.b.h.control.now = new Date(startedAt + 1);
      assert.equal(f.dependencies.clock().getTime(), startedAt + 1); return result; };
  }
  const result = await f.reads.readSelectedAvailability(f.request, { selection: f.selection });
  assert.equal(calls, 1); assert.equal(result.observedAt, new Date(startedAt + 1).toISOString());
  assert.equal(result.inventory, 'observed_not_reserved');
  assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, models);
});
test('AIN15 selected stock R0 rejects contradictory and malformed Core results without reserving or reselecting', { timeout: 120000 }, async () => {
  const f = await selectedStockR0Fixture(), { h } = f, core = h.b.core;
  const before = coreRequoteClone(h.state), models = h.execution.sent.length, read = core.readAvailability.bind(core);
  let corruption, calls = 0;
  core.readAvailability = async (...args) => {
    calls++; const result = coreRequoteClone(await read(...args));
    assert.equal(result.available, true); assert.ok(result.lines.every(line => line.available === true));
    if (corruption === 'aggregate') result.available = false;
    else if (corruption === 'line') result.lines[0].available = false;
    else if (corruption === 'quantity') result.lines[0].availableQuantity = 0;
    else if (corruption === 'fraction') result.lines[0].availableQuantity = 1.5;
    else result.lines[0].inventoryMode = 'unregistered_inventory';
    return result;
  };
  for (corruption of ['aggregate', 'line', 'quantity', 'fraction', 'inventory_mode']) {
    await assert.rejects(f.reads.readSelectedAvailability(f.request, { selection: f.selection }), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  }
  assert.equal(calls, 5); assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, models);
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
});
// End selected stock R0 owned cases.

// Begin current-stock reselection owned cases.
test('AIN15 current stock user reselects another product then new Core quote approval and one original order', { timeout: 120000 }, async () => {
  const f = await actualCoreRequoteSetup(true), { h } = f;
  assert.equal(f.newQuote.request.lines.length, 1);
  assert.equal(f.newQuote.request.lines[0].itemGroupId, f.quote.request.lines[1].itemGroupId);
  assert.equal(f.quote.request.lines.length, 2); assert.equal(h.state.rentalOrder.length, 0);
  const review = await f.requests.readSelectedProposal(f.request, { selection: f.newSelection, proposal: f.newWaiting.proposal });
  await f.requests.decideSelectedProposal(f.request, { selection: f.newSelection,
    proposal: { ...f.newWaiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
  assert.equal((await f.orderTask.continueConfirmation({ selection: f.newSelection, checkpointRef: f.newWaiting.checkpointRef })).outcome.status, 'succeeded');
  const result = await f.orderTask.readResult({ selection: f.newSelection });
  assert.equal(result.status, 'committed'); assert.equal(result.order.quoteId, f.newQuote.id);
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1); assert.equal(f.quotes.length, 2);
  assert.deepEqual(h.state.rentalOrder[0].lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })),
    f.newQuote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity })));
  assert.deepEqual(f.oldRows(), f.frozen); assert.equal(h.execution.sent.length, f.modelCalls);
});
test('AIN15 current stock original selection and current Guard cannot be replaced by caller scope or late withdrawn permission', { timeout: 120000 }, async () => {
  const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true), { h } = f;
  const { credentials, originals, ...dependencies } = f.dependencies;
  const reads = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' });
  let calls = 0; const originalRead = h.b.core.readAvailability.bind(h.b.core);
  h.b.core.readAvailability = async (...args) => { calls++; return originalRead(...args); };
  const before = coreRequoteClone(h.state), models = h.execution.sent.length;
  await assert.rejects(reads.readSelectedAvailability(f.request, { selection: f.selection, locationId: 'caller-selected-location' }),
    error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(reads.readSelectedAvailability(f.request, { selection: { ...f.selection, runId: require('node:crypto').randomUUID() } }),
    error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code));
  assert.equal(calls, 0);
  h.b.core.readAvailability = async (...args) => { calls++; const result = await originalRead(...args);
    h.b.h.identity.user.permissions = []; return result; };
  await assert.rejects(reads.readSelectedAvailability(f.request, { selection: f.selection }),
    error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code) || error.getStatus?.() === 403);
  assert.equal(calls, 1); assert.deepEqual(h.state, before); assert.equal(h.execution.sent.length, models);
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
});
// End current-stock reselection owned cases.
// Begin original order-receipt explanation owned cases.
async function receiptExplanationHarness(discovery = false) {
  let detailReadable = true;
  const f = await actualCoreRequoteSetup(), parent = f.h;
  const review = await f.requests.readSelectedProposal(f.request, { selection: f.newSelection, proposal: f.newWaiting.proposal });
  await f.requests.decideSelectedProposal(f.request, { selection: f.newSelection,
    proposal: { ...f.newWaiting.proposal, decision: 'approve', reviewVersion: review.draftVersion } });
  assert.equal((await f.orderTask.continueConfirmation({ selection: f.newSelection, checkpointRef: f.newWaiting.checkpointRef })).outcome.status, 'succeeded');
  const receipt = await f.orderTask.readResult({ selection: f.newSelection });
  assert.equal(receipt.status, 'committed'); const orderId = parent.state.rentalOrder[0].id;
  assert.equal(receipt.order.id, orderId);
  const shared = require('@rental-os/shared'), { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const tool = { code: 'rental.order.explain', version: shared.AI_TOOL_DRAFT_VERSION };
  const h = await originalModelApplicationHarness('order_explanation', undefined, undefined, [tool], async b => {
    const previous = b.facts.findOrder;
    b.facts.findOrder = async (tenant, id) => id === orderId && tenant === parent.state.rentalOrder[0].tenantId
      ? structuredClone(parent.state.rentalOrder[0]) : previous(tenant, id);
    b.facts.readOrderFacts = async (tenant, workspaceId, id) => {
      const row = await b.facts.findOrder(tenant, id); return row ? { ...row, workspaceId } : undefined;
    };
  }, { maxSteps: 3, maxCalls: 2 });
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const guard = new ApiAuthGuard(h.b.h.authorization.auth, undefined, undefined, undefined, {
    rentalOrder: { findFirst: async ({ where }) => {
      if (discovery && !detailReadable) return null;
      const row = parent.state.rentalOrder.find(row => require('./fixtures/ai-native/task-input-store.cjs').matches(row, where));
      return row ? { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId } : null;
    } }
  });
  h.dependencies.guard = guard;
  const { composeAiOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/original-scene-model.composition');
  const dependencies = { ...h.modelDependencies, guard, gatewayScene: { ...h.modelDependencies.gatewayScene, orderExplainTool: true } };
  let activeTaskId;
  dependencies.runtime.ports.routing.resolve = async (_caller, required) => ({
    context: await h.model.runtime.authorization.execution.authorize(activeTaskId),
    consumerScope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
    route: { profile: coreRequoteClone(h.state.aiProviderProfile[0]), scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant_001' },
      role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } }, selection: { mode: 'tenant_managed', revision: 1 },
    scene: 'chat', requiredCapabilities: required }); // Declared existing routing leaf, bound to the new canonical Task.
  const model = composeAiOriginalSceneModel(dependencies);
  const chain = model.createModelOrderApplication({ holderId: 'receipt-explanation-reader', leaseMs: 100000 },
    { financialEvidence: h.financial }, { answerRoundTrip: true });
  h.execution.beforeTransport = async () => { h.execution.result = h.execution.sent.length === 1
    ? { text: 'Candidate only', usage: { inputTokens: 1, outputTokens: 2 }, toolRequests: [{
      contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, toolCode: tool.code, toolVersion: tool.version, input: { orderId } }] }
    : { text: 'MODEL_FALSE: Paid in full; all refunds succeeded.', usage: { inputTokens: 3, outputTokens: 4 } }; };
  const { credentials, ...requestDependencies } = h.dependencies;
  const originals = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundOriginalScenes(
    requestDependencies, { enabled: true, audience: 'operator' });
  let creations = 0, starts = 0;
  const flow = require('../apps/api/src/modules/ai-native/scenes/selected-order-explanation-flow').composeSelectedOrderExplanationFlow({
    orders: { readResult: (_request, command) => f.orderTask.readResult(command) },
    originals: { ...originals, create: async (...args) => {
      creations++; const result = await originals.create(...args);
      if (result.stage === 'task_metadata_created') {
        activeTaskId = result.task.taskId;
        const templates = h.state.aiTaskActionPolicy.filter(row => row.taskId === h.created.task.taskId);
        h.state.aiTaskActionPolicy.push(...templates.map(row => ({ ...coreRequoteClone(row), taskId: activeTaskId })));
      }
      return result;
    } },
    runtime: { start: (_request, original) => { starts++; return chain.start(original); },
      readOrderResult: (_request, original) => chain.readOrderResult(original), readAnswer: (_request, original) => chain.readAnswer(original) }
  });
  // Begin default-false discovered-order explanation fixture ports.
  let discoveryFlow, pageReads = 0;
  if (discovery) {
    h.b.facts.queryOrders = async (tenantId, query) => {
      pageReads++;
      assert.deepEqual(Object.keys(query).sort(), ['page', 'pageSize', 'skip', 'take']);
      assert.equal(query.page, 1); assert.equal(query.pageSize, 10); assert.equal(query.skip, 0); assert.equal(query.take, 10);
      const identity = require('../apps/api/src/common/request-identity').getRequestIdentity();
      assert.equal(identity.tenantId, tenantId);
      const where = { tenantId, workspaceId: identity.workspaceId,
        ...require('../apps/api/src/modules/rental-core/rental-core-fact.repository').requestRentalOrderVisibilityWhere() };
      return { items: await parent.db.rentalOrder.findMany({ where, take: query.take }), total: await parent.db.rentalOrder.count({ where }) };
    }; // Declared first-page storage leaf over the SAME actual Core-created order.
    discoveryFlow = require('../apps/api/src/modules/ai-native/scenes/discovered-order-explanation-flow').composeDiscoveredOrderExplanationFlow({
      core: h.b.core, guard, credentials, clock: h.dependencies.clock,
      originals: { ...originals, create: async (...args) => {
        creations++; const result = await originals.create(...args);
        if (result.stage === 'task_metadata_created') {
          activeTaskId = result.task.taskId;
          const templates = h.state.aiTaskActionPolicy.filter(row => row.taskId === h.created.task.taskId);
          h.state.aiTaskActionPolicy.push(...templates.map(row => ({ ...coreRequoteClone(row), taskId: activeTaskId })));
        }
        return result;
      } },
      runtime: { start: (_request, original) => { starts++; return chain.start(original); },
        readOrderResult: (_request, original) => chain.readOrderResult(original), readAnswer: (_request, original) => chain.readAnswer(original) }
    });
  }
  // End default-false discovered-order explanation fixture ports.
  return { f, parent, h, flow, orderId, request: { headers: { authorization: (await credentials.current()).authorization } },
    ...(discovery ? { discoveryFlow, pages: () => pageReads, denyDetail: () => { detailReadable = false; }, allowDetail: () => { detailReadable = true; },
      bindRecoveredTask: taskId => {
        const task = h.state.aiTask.find(row => row.id === taskId); assert.equal(task?.sceneCode, 'order_explanation');
        activeTaskId = taskId; // Only this fixture's routed-model leaf binds the actual original receipt.
        if (!h.state.aiTaskActionPolicy.some(row => row.taskId === taskId)) {
          const templates = h.state.aiTaskActionPolicy.filter(row => row.taskId === h.created.task.taskId);
          h.state.aiTaskActionPolicy.push(...templates.map(row => ({ ...coreRequoteClone(row), taskId })));
        }
      } } : {}),
    command: { selection: f.newSelection, requestKey: 'explain-original-receipt', question: 'next_steps' },
    counts: () => ({ creations, starts, models: h.execution.sent.length }) };
}
test('AIN13 original created-order receipt starts one original explanation chain and reads Core-bound answer without payment invention', { timeout: 180000 }, async () => {
  const h = await receiptExplanationHarness(), before = coreRequoteClone(h.parent.state);
  const started = await h.flow.begin(h.request, h.command);
  assert.equal(started.execution.outcome.outcome.status, 'succeeded'); assert.equal(h.counts().models, 2);
  const original = started.original, read = await h.flow.read(h.request, { ...h.command, original });
  assert.equal(read.order.result.status, 'available'); assert.equal(read.answer.result.status, 'available');
  assert.equal(read.order.result.facts.order.id, h.orderId);
  assert.equal(read.answer.result.originalReadResultId, read.order.result.resultId);
  assert.equal(read.answer.result.text.includes('MODEL_FALSE'), false);
  assert.equal(read.order.result.facts.paymentEvidence, 'not_loaded');
  await assert.rejects(h.flow.read(h.request, { ...h.command, original: h.h.reference }),
    error => ['AI_ACCESS_DENIED', 'FORBIDDEN'].includes(error.code) || error.getStatus?.() === 403);
  assert.equal(h.counts().models, 2);
  const repeated = await h.flow.begin(h.request, h.command);
  assert.equal(repeated.model, 'not_called'); assert.equal(repeated.nextAction, 'read_original_explanation');
  assert.deepEqual(h.counts(), { creations: 2, starts: 1, models: 2 });
  assert.deepEqual(await h.flow.read(h.request, { ...h.command, original }), read);
  assert.deepEqual(h.parent.state, before); assert.equal(h.parent.state.rentalOrder.length, 1);
});
test('AIN13 original order receipt bridge rejects caller target and foreign original and retains unknown after new-task late authorization failure', { timeout: 180000 }, async () => {
  const h = await receiptExplanationHarness();
  await assert.rejects(h.flow.begin(h.request, { ...h.command, orderId: 'caller-order' }), error => error.code === 'AI_INVALID_INPUT');
  assert.deepEqual(h.counts(), { creations: 0, starts: 0, models: 0 });
  const prior = h.h.control.beforeCommit; let withdrew = false;
  h.h.control.beforeCommit = async draft => {
    await prior?.(draft);
    if (!withdrew && draft.aiTask.length > h.h.state.aiTask.length) { withdrew = true;
      h.parent.b.h.identity.user.permissions = []; }
  };
  await assert.rejects(h.flow.begin(h.request, h.command), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(withdrew, true); assert.equal(h.counts().starts, 0); assert.equal(h.counts().models, 0);
  assert.equal(h.h.state.aiTask.length, 2); assert.equal(h.parent.state.rentalOrder.length, 1);
});
test('AIN13 selected order explanation reads one lost creation and explicitly starts only its unstarted original', { timeout: 180000 }, async () => {
  const f = await receiptExplanationHarness(true), beforeTasks = f.h.state.aiTask.length;
  const parent = coreRequoteClone(f.parent.state); let lost = false, result, failure;
  f.h.control.beforeCommit = draft => { if (!lost && draft.aiTask.length > beforeTasks) {
    lost = true; f.h.control.loseReply = true; f.h.control.beforeCommit = null;
  } };
  try { result = await f.flow.begin(f.request, f.command); } catch (error) { failure = error; }
  assert.equal(lost, true); assert.equal(f.h.state.aiTask.length, beforeTasks + 1);
  if (failure) assert.ok(['AI_RESULT_UNKNOWN', 'AI_STORAGE_UNAVAILABLE'].includes(failure.code));
  else { assert.equal(result.creation.stage, 'request_stored'); assert.equal(result.creation.creation.state, 'requires_reconciliation'); }
  assert.deepEqual(f.counts(), { creations: 1, starts: 0, models: 0 });
  const beforeRead = coreRequoteClone(f.h.state), observed = await f.flow.readCreation(f.request, f.command);
  assert.equal(observed.record.state, 'observed'); assert.equal(observed.record.task.state, 'observed');
  assert.equal(observed.record.task.status, 'queued'); assert.equal(observed.record.task.plan, 'not_observed');
  assert.equal(observed.execution, 'read_only_no_create_start_or_model'); assert.deepEqual(f.h.state, beforeRead);
  assert.deepEqual(f.counts(), { creations: 1, starts: 0, models: 0 });
  const original = coreRequoteClone(f.h.state.aiTaskOriginalRequest.find(row => row.id === observed.original.inputRef));
  f.bindRecoveredTask(observed.record.task.taskId);
  await assert.rejects(f.flow.startUnstartedOriginal(f.request, f.command), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(f.flow.startUnstartedOriginal(f.request, { ...f.command, decision: 'start_unstarted_original', taskId: observed.record.task.taskId }),
    error => error.code === 'AI_INVALID_INPUT');
  const intent = { ...f.command, decision: 'start_unstarted_original' };
  const started = await f.flow.startUnstartedOriginal(f.request, intent);
  assert.equal(started.execution.outcome.outcome.status, 'succeeded'); assert.equal(started.creation, 'original_not_recreated');
  assert.equal(started.task.taskId, observed.record.task.taskId); assert.equal(started.task.runId, observed.record.task.runId);
  assert.deepEqual(f.counts(), { creations: 1, starts: 1, models: 2 }); assert.equal(f.h.state.aiTask.length, beforeTasks + 1);
  const read = await f.flow.read(f.request, { ...f.command, original: observed.original });
  assert.equal(read.order.result.status, 'available'); assert.equal(read.answer.result.status, 'available');
  assert.equal(read.answer.result.originalReadResultId, read.order.result.resultId); assert.equal(read.answer.result.text.includes('MODEL_FALSE'), false);
  await assert.rejects(f.flow.startUnstartedOriginal(f.request, intent), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(f.h.state.aiTaskOriginalRequest.find(row => row.id === original.id), original);
  assert.deepEqual(f.parent.state, parent); assert.deepEqual(f.counts(), { creations: 1, starts: 1, models: 2 });
  f.parent.b.h.identity.user.permissions = [];
  await assert.rejects(f.flow.readCreation(f.request, f.command));
  assert.deepEqual(f.counts(), { creations: 1, starts: 1, models: 2 });
});
// End original order-receipt explanation owned cases.
// Begin discovered-order explanation owned cases.
test('AIN13 discovered order explicit choice enters original Core explanation and reads same original answer without rediscovery or repeated model', { timeout: 180000 }, async () => {
  const f = await receiptExplanationHarness(true), before = coreRequoteClone(f.parent.state), query = { page: 1, pageSize: 10 };
  const listed = await f.discoveryFlow.discover(f.request, query);
  assert.equal(listed.page.items.length, 1); assert.equal(listed.page.items[0].id, f.orderId);
  assert.equal(listed.page.items[0].customerId, undefined); assert.equal(listed.page.items[0].rentalAmount, undefined);
  assert.deepEqual(f.counts(), { creations: 0, starts: 0, models: 0 }); assert.equal(listed.task, 'not_created');
  const row = listed.page.items[0], command = { query, choice: { orderId: row.id, orderVersion: row.updatedAt },
    selectionHash: listed.selectionHash, requestKey: 'explicit-discovered-core-order', question: 'next_steps' };
  const begun = await f.discoveryFlow.begin(f.request, command);
  assert.equal(begun.execution.outcome.outcome.status, 'succeeded'); assert.equal(f.counts().models, 2);
  const pages = f.pages(), read = await f.discoveryFlow.read(f.request, { ...command, original: begun.original });
  assert.equal(f.pages(), pages); assert.equal(read.discovery, 'not_repeated');
  assert.equal(read.order.result.status, 'available'); assert.equal(read.order.result.facts.order.id, f.orderId);
  assert.equal(read.answer.result.status, 'available'); assert.equal(read.answer.result.originalReadResultId, read.order.result.resultId);
  assert.equal(read.answer.result.text.includes('MODEL_FALSE'), false); assert.equal(read.order.result.facts.paymentEvidence, 'not_loaded');
  const repeated = await f.discoveryFlow.begin(f.request, command); assert.equal(repeated.model, 'not_called');
  assert.deepEqual(f.counts(), { creations: 2, starts: 1, models: 2 });
  assert.deepEqual(await f.discoveryFlow.read(f.request, { ...command, original: begun.original }), read);
  assert.deepEqual(f.parent.state, before); assert.equal(f.parent.state.rentalOrder.length, 1);
});

test('AIN13 discovered order selection cannot grant detail authority forge caller scope or dispatch after source changes at canonical creation', { timeout: 180000 }, async () => {
  const f = await receiptExplanationHarness(true), query = { page: 1, pageSize: 10 };
  f.h.b.h.identity.user.dataScope = 'own'; // Restrict only this new fixture, never broaden a manager or original ACK.
  const listed = await f.discoveryFlow.discover(f.request, query);
  assert.equal(listed.page.items.length, 1); // The actual Core order is owned by this current actor.
  const row = listed.page.items[0], command = { query, choice: { orderId: row.id, orderVersion: row.updatedAt },
    selectionHash: listed.selectionHash, requestKey: 'original-discovered-order-guarded', question: 'status' };
  await assert.rejects(f.discoveryFlow.begin(f.request, { ...command, scope: { kind: 'platform' } }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(f.discoveryFlow.begin(f.request, { ...command, choice: { ...command.choice, orderId: 'foreign-order' } }));
  await assert.rejects(f.discoveryFlow.begin(f.request, { ...command, selectionHash: 'f'.repeat(64) }), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(f.counts().creations, 0); f.denyDetail();
  assert.equal((await f.discoveryFlow.discover(f.request, query)).page.items.length, 1);
  await assert.rejects(f.discoveryFlow.begin(f.request, command));
  assert.equal(f.counts().starts, 0); assert.equal(f.counts().models, 0); assert.equal(f.h.state.aiTask.length, 1); f.allowDetail();
  const beforeTasks = f.h.state.aiTask.length; let changed = false;
  f.h.control.beforeCommit = draft => { if (!changed && draft.aiTask.length > beforeTasks) {
    changed = true; const order = f.parent.state.rentalOrder[0]; order.updatedAt = new Date(Date.parse(order.updatedAt) + 1000).toISOString();
  } };
  await assert.rejects(f.discoveryFlow.begin(f.request, command), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(changed, true); assert.equal(f.h.state.aiTask.length, beforeTasks + 1);
  assert.equal(f.counts().starts, 0); assert.equal(f.counts().models, 0); assert.equal(f.parent.state.rentalOrder.length, 1);
});
// End discovered-order explanation owned cases.
// Begin original discovered-order creation recovery owned cases.
async function originalCreationRecoverySetup() {
  const f = await receiptExplanationHarness(true), query = { page: 1, pageSize: 10 }, listed = await f.discoveryFlow.discover(f.request, query);
  const row = listed.page.items[0], command = { query, choice: { orderId: row.id, orderVersion: row.updatedAt },
    selectionHash: listed.selectionHash, requestKey: 'lost-original-discovered-creation', question: 'next_steps' };
  const beforeTasks = f.h.state.aiTask.length; let lost = false, first, failure;
  f.h.control.beforeCommit = draft => { if (!lost && draft.aiTask.length > beforeTasks) {
    lost = true; f.h.control.loseReply = true; f.h.control.beforeCommit = null;
  } };
  try { first = await f.discoveryFlow.begin(f.request, command); } catch (error) { failure = error; }
  assert.equal(lost, true); assert.equal(f.h.state.aiTask.length, beforeTasks + 1);
  if (failure) assert.ok(['AI_RESULT_UNKNOWN', 'AI_STORAGE_UNAVAILABLE'].includes(failure.code), failure.code);
  else { assert.equal(first.creation.stage, 'request_stored'); assert.equal(first.creation.creation.state, 'requires_reconciliation'); }
  assert.equal(f.counts().starts, 0); assert.equal(f.counts().models, 0);
  const beforeRead = coreRequoteClone(f.h.state), pages = f.pages(), original = await f.discoveryFlow.readCreation(f.request, command);
  assert.equal(original.record.state, 'observed'); assert.equal(original.record.task.state, 'observed');
  assert.equal(original.record.task.status, 'queued'); assert.equal(original.record.task.plan, 'not_observed');
  assert.equal(f.pages(), pages); assert.deepEqual(f.h.state, beforeRead);
  f.bindRecoveredTask(original.record.task.taskId);
  return { f, command, original, beforeTasks };
}

test('AIN13 original creation recovery reads same lost metadata key and explicitly starts one original Task Core Gateway answer chain', { timeout: 180000 }, async () => {
  const { f, command, original, beforeTasks } = await originalCreationRecoverySetup(), beforeParent = coreRequoteClone(f.parent.state);
  const beforeOriginal = coreRequoteClone(f.h.state.aiTaskOriginalRequest.find(row => row.id === original.original.inputRef));
  const fresh = await f.discoveryFlow.discover(f.request, command.query), row = fresh.page.items.find(row => row.id === command.choice.orderId);
  const intent = { ...command, currentChoice: { orderId: row.id, orderVersion: row.updatedAt }, currentSelectionHash: fresh.selectionHash,
    decision: 'start_unstarted_original' };
  const started = await f.discoveryFlow.startUnstartedOriginal(f.request, intent);
  assert.equal(started.execution.outcome.outcome.status, 'succeeded'); assert.equal(started.creation, 'original_not_recreated');
  assert.equal(started.task.taskId, original.record.task.taskId); assert.equal(started.task.runId, original.record.task.runId);
  assert.equal(f.h.state.aiTask.length, beforeTasks + 1); assert.equal(f.counts().creations, 1);
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().models, 2);
  const read = await f.discoveryFlow.read(f.request, { ...command, original: original.original });
  assert.equal(read.order.result.status, 'available'); assert.equal(read.answer.result.status, 'available');
  assert.equal(read.answer.result.originalReadResultId, read.order.result.resultId); assert.equal(read.answer.result.text.includes('MODEL_FALSE'), false);
  assert.deepEqual(f.h.state.aiTaskOriginalRequest.find(row => row.id === original.original.inputRef), beforeOriginal);
  assert.deepEqual(f.parent.state, beforeParent);
  await assert.rejects(f.discoveryFlow.startUnstartedOriginal(f.request, intent), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().models, 2);
});

test('AIN13 original creation recovery requires fresh same-order human confirmation and never recreates metadata or restarts an executed original', { timeout: 180000 }, async () => {
  const { f, command, original, beforeTasks } = await originalCreationRecoverySetup();
  const row = f.parent.state.rentalOrder[0]; row.updatedAt = new Date(Date.parse(row.updatedAt) + 1000).toISOString();
  const base = { ...command, currentChoice: command.choice, currentSelectionHash: command.selectionHash, decision: 'start_unstarted_original' };
  await assert.rejects(f.discoveryFlow.startUnstartedOriginal(f.request, base), error => error.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(f.discoveryFlow.startUnstartedOriginal(f.request, { ...base, currentChoice: { ...command.choice, orderId: 'foreign-order' } }),
    error => error.code === 'AI_INVALID_INPUT');
  assert.equal(f.counts().starts, 0); assert.equal(f.counts().models, 0);
  const beforeRead = coreRequoteClone(f.h.state), pages = f.pages(), observed = await f.discoveryFlow.readCreation(f.request, command);
  assert.deepEqual(f.h.state, beforeRead); assert.equal(f.pages(), pages); assert.equal(observed.record.task.taskId, original.record.task.taskId);
  const fresh = await f.discoveryFlow.discover(f.request, command.query), current = fresh.page.items.find(value => value.id === command.choice.orderId);
  const intent = { ...base, currentChoice: { orderId: current.id, orderVersion: current.updatedAt }, currentSelectionHash: fresh.selectionHash };
  const { decision, ...missingDecision } = intent;
  await assert.rejects(f.discoveryFlow.startUnstartedOriginal(f.request, missingDecision), error => error.code === 'AI_INVALID_INPUT');
  const beforeInput = coreRequoteClone(f.h.state.aiTaskOriginalRequest.find(value => value.id === original.original.inputRef));
  const started = await f.discoveryFlow.startUnstartedOriginal(f.request, intent);
  assert.equal(started.execution.outcome.outcome.status, 'succeeded'); assert.equal(started.task.taskId, original.record.task.taskId);
  assert.deepEqual(f.h.state.aiTaskOriginalRequest.find(value => value.id === original.original.inputRef), beforeInput);
  assert.equal(f.h.state.aiTask.length, beforeTasks + 1); assert.equal(f.counts().creations, 1);
  await assert.rejects(f.discoveryFlow.startUnstartedOriginal(f.request, intent), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(f.counts().starts, 1); assert.equal(f.counts().models, 2); assert.equal(f.parent.state.rentalOrder.length, 1);
});
// End original discovered-order creation recovery owned cases.
// End actual Core requote owned cases.
test('AIN15 exact multiline clarified Core quote reaches original approval and one order through lost reply recovery', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(false);
});

// Each category uses its own seeded Core definition through the same original
// request/model/approval/receipt chain; no post-admission profile substitution.
for (const categoryCode of [require('@rental-os/shared').RentalCategoryCode.Camping,
  require('@rental-os/shared').RentalCategoryCode.Vehicle, require('@rental-os/shared').RentalCategoryCode.Construction]) {
  const withReviewedQualificationFixture = categoryCode !== require('@rental-os/shared').RentalCategoryCode.Camping;
  test(`AIN15 four-category ${categoryCode}: clarified quote reaches one approved Core order and original receipt after reply loss`, { timeout: 60000 }, async () => {
    await exerciseMultilineApprovedConsumer(false, false, false, false, false, categoryCode, withReviewedQualificationFixture);
  });
  test(`AIN15 four-category ${categoryCode}: inventory loss at original commit preserves approval without consuming quote`, { timeout: 60000 }, async () => {
    await exerciseMultilineApprovedConsumer(false, false, true, false, false, categoryCode, withReviewedQualificationFixture);
  });
}

// Begin original delivery quote-to-order owned cases.
async function originalDeliveryQuoteOrderSetup(t) {
  // Existing offline Core prices/configuration are memory fixtures. Adding the
  // explicit address delegate must not accidentally request MySQL price tables.
  const previous = process.env.PLATFORM_DATA_SOURCE;
  process.env.PLATFORM_DATA_SOURCE = 'memory';
  t.after(() => { if (previous === undefined) delete process.env.PLATFORM_DATA_SOURCE; else process.env.PLATFORM_DATA_SOURCE = previous; });
  return exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true, true);
}

test('AIN15 original delivery quote handoff reaches human approval and one Core order through lost reply', { timeout: 120000 }, async t => {
  const f = await originalDeliveryQuoteOrderSetup(t), { h } = f;
  assert.equal(f.candidate.fulfillmentMode, 'delivery'); assert.equal(f.candidate.deliveryAddressId, f.deliveryFixture.id);
  assert.ok(h.state.aiTaskInputReceipt.some(row => row.answers.some(answer => answer.fieldId === 'delivery_address_selection'
    && answer.value === f.deliveryFixture.id)));
  const quote = structuredClone(f.quote), address = structuredClone(f.quote.deliveryAddressSnapshot);
  assert.equal(address.addressId, f.deliveryFixture.id); assert.equal(f.quotes.length, 1);
  assert.equal(f.review.deterministic.order.fulfillment.deliveryAddress.detail, address.detail);
  assert.equal(f.review.deterministic.order.fulfillment.deliveryAddress.phone, undefined);
  await f.human.decideSelectedProposal({ selection: f.selection, proposal: { ...f.waiting.proposal,
    decision: 'approve', reviewVersion: f.review.draftVersion } });
  let lost = false;
  h.control.beforeCommit = async draft => { if (!lost && draft.rentalOrder.length === 1 && h.state.rentalOrder.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  const outcome = await f.orderTask.continueConfirmation({ selection: f.selection, checkpointRef: f.waiting.checkpointRef });
  assert.equal(lost, true); assert.equal(outcome.outcome.status, 'unknown');
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.deepEqual(h.state.rentalOrder[0].deliveryAddressSnapshot, address);
  const read = await f.orderTask.readResult({ selection: f.selection }); assert.equal(read.status, 'committed');
  assert.equal(read.order.quoteId, quote.id);
  assert.equal((await f.orderTask.reconcile({ selection: f.selection })).outcome.status, 'succeeded');
  // Address-book changes do not rewrite the delivery address of an already
  // committed order. Reopen the SAME original result; no current address re-quote.
  f.deliveryFixture.revision++; f.deliveryFixture.detail = 'Later changed address'; f.deliveryFixture.status = 'inactive';
  const before = coreRequoteClone(h.state);
  assert.deepEqual(await f.orderTask.readResult({ selection: f.selection }), read);
  assert.deepEqual(h.state.rentalOrder[0].deliveryAddressSnapshot, address);
  assert.deepEqual(f.quote, quote); assert.deepEqual(coreRequoteClone(h.state), before);
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1); assert.equal(f.quotes.length, 1);
  assert.equal(h.execution.sent.length, f.modelCalls); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, f.taskCalls);
});

test('AIN15 original delivery selection preparation rejects caller replacement and late original read revocation', { timeout: 120000 }, async t => {
  const f = await originalDeliveryQuoteOrderSetup(t), { h } = f;
  const { composeClarifiedQuoteSelectionPreparation } = require('../apps/api/src/modules/ai-native/scenes/clarified-quote-selection-preparation');
  const model = h.model.createApplication({ holderId: 'same-quote-clarification', leaseMs: 100000 }, { ...h.run, inputSource: 'original_scene' });
  let reads = 0;
  const preparation = composeClarifiedQuoteSelectionPreparation({ readClarifiedQuoteReceipt: async (_request, value) => {
    reads++;
    if (reads === 2) h.b.h.identity.user.permissions = [];
    return model.readClarifiedQuoteReceipt(value);
  } }, f.dependencies);
  const command = { clarification: f.finalQuery, selectionKey: 'original-delivery-explicit-choice', expectedSelectionRevision: 0 };
  const before = coreRequoteClone(h.state), quotes = structuredClone(f.quotes);
  await assert.rejects(preparation.prepareSelection(f.request, { ...command, deliveryAddressId: 'foreign-address' }), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(reads, 0);
  await assert.rejects(preparation.prepareSelection(f.request, command)); assert.equal(reads, 2);
  assert.deepEqual(coreRequoteClone(h.state), before); assert.deepEqual(f.quotes, quotes);
  assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0);
  assert.equal(h.state.aiTaskQuoteSelection.length, 1); assert.equal(h.execution.sent.length, f.modelCalls);
});
// End original delivery quote-to-order owned cases.

// Begin category delivery Core flow owned cases.
for (const categoryCode of ['camping', 'construction', 'vehicle']) {
  test(`AIN15 category delivery ${categoryCode}: explicit destination reaches one Core order and original receipt after reply loss`, { timeout: 120000 }, async t => {
    const previous = process.env.PLATFORM_DATA_SOURCE; process.env.PLATFORM_DATA_SOURCE = 'memory';
    t.after(() => { if (previous === undefined) delete process.env.PLATFORM_DATA_SOURCE; else process.env.PLATFORM_DATA_SOURCE = previous; });
    const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, categoryCode,
      categoryCode !== 'camping', true, 'category_delivery'), { h } = f;
    const definition = h.b.core.listCategories().find(row => row.code === categoryCode);
    const quote = structuredClone(f.quote), address = structuredClone(f.quote.deliveryAddressSnapshot);
    assert.equal(f.candidate.fulfillmentMode, 'delivery'); assert.equal(quote.categoryCode, categoryCode);
    assert.equal(quote.request.fulfillmentLocationId, f.review.deterministic.order.fulfillment.pickupLocationId);
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0);
    if (categoryCode === 'vehicle') {
      assert.equal(definition.businessModel.deliveryDestination, 'tenant_location');
      assert.equal(f.candidate.deliveryAddressId, undefined); assert.equal(address, undefined);
      assert.equal(f.review.deterministic.order.fulfillment.deliveryAddress, undefined); assert.equal(f.tenantAddressReads(), 0);
      assert.equal(h.state.aiTaskInputReceipt.some(row => row.answers.some(answer => answer.fieldId === 'delivery_address_selection')), false);
    } else {
      assert.equal(definition.businessModel.deliveryDestination, 'customer_address');
      assert.equal(f.candidate.deliveryAddressId, f.deliveryFixture.id); assert.equal(address.addressId, f.deliveryFixture.id);
      assert.equal(f.review.deterministic.order.fulfillment.deliveryAddress.detail, address.detail);
      assert.equal(f.review.deterministic.order.fulfillment.deliveryAddress.phone, undefined);
      assert.ok(h.state.aiTaskInputReceipt.some(row => row.answers.some(answer => answer.fieldId === 'delivery_address_selection'
        && answer.value === f.deliveryFixture.id)));
    }
    const preparation = require('../apps/api/src/modules/ai-native/scenes/clarified-quote-selection-preparation')
      .composeClarifiedQuoteSelectionPreparation({ readClarifiedQuoteReceipt: (_request, value) =>
        h.model.createApplication({ holderId: 'same-quote-clarification', leaseMs: 100000 }, { ...h.run, inputSource: 'original_scene' }).readClarifiedQuoteReceipt(value) }, f.dependencies);
    await assert.rejects(preparation.prepareSelection(f.request, { clarification: f.finalQuery, selectionKey: 'caller-address-override',
      expectedSelectionRevision: 0, deliveryAddressId: 'caller-another-destination' }), error => error.code === 'AI_INVALID_INPUT');
    assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiTaskQuoteSelection.length, 1);
    const approved = await f.human.decideSelectedProposal({ selection: f.selection, proposal: { ...f.waiting.proposal,
      decision: 'approve', reviewVersion: f.review.draftVersion } });
    assert.equal(approved.approval.decision, 'approved'); assert.equal(h.state.rentalOrder.length, 0);
    let lost = false;
    h.control.beforeCommit = draft => { if (!lost && draft.rentalOrder.length === 1 && h.state.rentalOrder.length === 0) {
      lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
    } };
    const outcome = await f.orderTask.continueConfirmation({ selection: f.selection, checkpointRef: f.waiting.checkpointRef });
    assert.equal(lost, true); assert.equal(outcome.outcome.status, 'unknown');
    assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1);
    assert.equal(h.state.rentalOrder[0].fulfillmentMode, 'delivery');
    assert.equal(h.state.rentalOrder[0].fulfillmentLocationId, quote.request.fulfillmentLocationId);
    assert.deepEqual(h.state.rentalOrder[0].deliveryAddressSnapshot, address);
    const observed = await f.orderTask.readResult({ selection: f.selection }); assert.equal(observed.status, 'committed');
    assert.equal(observed.order.quoteId, quote.id);
    assert.equal((await f.orderTask.reconcile({ selection: f.selection })).outcome.status, 'succeeded');
    const order = structuredClone(h.state.rentalOrder[0]);
    if (categoryCode !== 'vehicle') { f.deliveryFixture.detail = 'Later address-book edit'; f.deliveryFixture.revision++; }
    assert.equal((await f.orderTask.readResult({ selection: f.selection })).order.id, order.id);
    assert.deepEqual(h.state.rentalOrder[0], order); assert.deepEqual(h.state.rentalQuote[0].snapshot, quote);
    assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length, 1); assert.equal(f.quotes.length, 1);
    assert.equal(h.execution.sent.length, f.modelCalls); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, f.taskCalls);
    if (categoryCode === 'vehicle') assert.equal(f.tenantAddressReads(), 0);
  });
}
// End category delivery Core flow owned cases.

// Begin original committed-order extension-preview owned cases.
async function originalCommittedExtensionSetup(applicationFixture = false) {
  const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true, false, applicationFixture ? 'application' : true), { h } = f;
  await f.human.decideSelectedProposal({ selection: f.selection, proposal: { ...f.waiting.proposal,
    decision: 'approve', reviewVersion: f.review.draftVersion } });
  assert.equal((await f.orderTask.continueConfirmation({ selection: f.selection, checkpointRef: f.waiting.checkpointRef })).outcome.status, 'succeeded');
  assert.equal(h.state.rentalOrder.length, 1);
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
  const { composeSelectedOrderExtensionPreviewFlow } = require('../apps/api/src/modules/ai-native/scenes/selected-order-extension-preview-flow');
  const orderId = h.state.rentalOrder[0].id, assets = await h.b.facts.listAssets('tenant_001');
  for (const asset of assets) await h.db.rentalAsset.create({ data: structuredClone(asset) });
  // New explicit storage leaves over the SAME actual committed order/assets.
  // Core computes allocation and extension; no manually forged ready/renting
  // status, paid receipt, availability or pricing result is installed.
  h.b.facts.listAssets = async (tenant, tx) => (tx ?? h.db).rentalAsset.findMany({ where: { tenantId: tenant, workspaceId: 'workspace-a' } });
  h.b.facts.allocatedAssetIds = async (tenant, tx) => new Set((await (tx ?? h.db).rentalOrder.findMany({ where: { tenantId: tenant, workspaceId: 'workspace-a' } }))
    .flatMap(row => row.allocations ?? []).filter(row => row.assetId).map(row => row.assetId));
  h.b.facts.activeReservations = async (tenant, tx) => (await (tx ?? h.db).rentalOrder.findMany({ where: { tenantId: tenant, workspaceId: 'workspace-a' } }))
    .flatMap(row => row.reservations).filter(row => row.status === 'confirmed' || row.status === 'soft');
  h.b.facts.readOrderFacts = (tenant, workspace, id) => h.db.rentalOrder.findFirst({ where: { tenantId: tenant, workspaceId: workspace, id } });
  h.b.facts.saveOrderAggregate = async (order, changes, tx) => {
    assert.ok(tx, 'allocation must use this explicit transaction');
    assert.equal((await tx.rentalOrder.updateMany({ where: { id: order.id, tenantId: order.tenantId, workspaceId: 'workspace-a' },
      data: { ...structuredClone(order), workspaceId: 'workspace-a' } })).count, 1);
    for (const change of changes) assert.equal((await tx.rentalAsset.updateMany({ where: { id: change.assetId,
      tenantId: order.tenantId, workspaceId: 'workspace-a' }, data: { status: change.status } })).count, 1);
  };
  h.b.businessFacts.findQuote = async (tenant, id) => {
    const row = await h.db.rentalQuote.findFirst({ where: { tenantId: tenant, id } }); return row && structuredClone(row.snapshot);
  };
  const guard = new ApiAuthGuard(f.dependencies.auth, undefined, undefined, undefined, {
    rentalOrder: { findFirst: args => h.db.rentalOrder.findFirst(args) }
  });
  const controller = new RentalCoreController(h.b.core, undefined, h.b.business), calls = { previews: 0, afterPreview: null, raw: null };
  const preview = { previewExtension: async (...args) => {
    calls.previews++; calls.raw = await controller.previewExtension(...args); await calls.afterPreview?.(); return calls.raw;
  } };
  const flow = composeSelectedOrderExtensionPreviewFlow({ ...f.dependencies, guard, preview,
    orders: { readResult: (_request, value) => f.orderTask.readResult(value) } });
  const extension = { newEndAt: new Date(Date.parse(f.quote.request.endAt) + 86400000).toISOString(), memo: 'Synthetic explicit next-step preview' };
  const command = () => ({ selection: f.selection, expectedOrderVersion: h.state.rentalOrder.find(row => row.id === orderId).updatedAt, extension });
  // This is a human-fixture prerequisite, NOT part of the AI preview flow. Use
  // the original allocate Guard and actual Core transaction to reach readiness.
  const allocate = () => runWithRequestIdentity({}, async () => {
    for (const operation of ['confirm', 'allocate']) {
      const request = { headers: { authorization: f.request.headers.authorization }, method: 'POST',
        url: `/api/rental/v1/orders/${orderId}/${operation}`, originalUrl: `/api/rental/v1/orders/${orderId}/${operation}`, body: {}, query: {} };
      assert.equal(await guard.canActivate(new ExecutionContextHost([request])), true);
      await h.db.$transaction(tx => operation === 'confirm'
        ? h.b.core.confirmOrder('tenant_001', orderId, tx, request.user.displayName)
        : h.b.core.allocateOrder('tenant_001', orderId, tx, request.user.displayName));
    }
    return h.db.rentalOrder.findFirst({ where: { id: orderId, tenantId: 'tenant_001', workspaceId: 'workspace-a' } });
  });
  return { ...f, flow, allocate, calls, command, orderId, guard, ...(applicationFixture ? { controller } : {}) };
}

test('AIN13 original committed order enters actual Core extension preview only after original allocation readiness', { timeout: 120000 }, async () => {
  const f = await originalCommittedExtensionSetup(), { h } = f;
  const blocked = await f.flow.preview(f.request, f.command());
  assert.equal(blocked.result.status, 'blocked'); assert.equal(blocked.result.coreStatus, 409);
  assert.equal(blocked.businessExecution, 'not_attempted'); assert.equal(h.state.rentalOrder[0].status, 'draft');
  const ready = await f.allocate(); assert.equal(ready.status, 'ready_for_pickup');
  assert.ok(ready.allocations.length > 0); assert.equal(h.state.rentalOrder.length, 1);
  assert.equal(h.state.rentalOrder[0].status, 'ready_for_pickup');
  assert.ok(h.state.rentalAsset.some(row => row.status === 'reserved'));
  const before = coreRequoteClone(h.state), quote = structuredClone(f.quote), previews = f.calls.previews;
  const result = await f.flow.preview(f.request, f.command());
  assert.equal(result.result.status, 'previewed'); assert.equal(result.result.orderId, f.orderId);
  assert.equal(result.result.preview.newEndAt, f.command().extension.newEndAt);
  assert.equal(result.result.preview.originalEndAt, f.quote.request.endAt);
  const { validateAiCoreExtensionPreview } = require('../apps/api/src/modules/ai-native/scenes/extension-preview-http.contract');
  assert.deepEqual(result.result.preview, validateAiCoreExtensionPreview(f.calls.raw, f.orderId, f.command().extension.newEndAt));
  assert.equal(result.result.persistence, 'not_persisted'); assert.equal(result.result.inventory, 'not_reserved');
  assert.equal(result.result.approval, 'not_granted'); assert.equal(result.result.execution, 'not_attempted');
  assert.equal(result.model, 'not_called'); assert.equal(result.nextAction, 'use_original_extension_application');
  assert.equal(f.calls.previews, previews + 1); assert.deepEqual(coreRequoteClone(h.state), before);
  assert.deepEqual(f.quote, quote); assert.equal(f.quotes.length, 1); assert.equal(h.state.rentalOrder.length, 1);
  assert.equal(h.execution.sent.length, f.modelCalls);
});

test('AIN13 original order extension preview refuses caller targets stale versions and late original changes', { timeout: 120000 }, async () => {
  const f = await originalCommittedExtensionSetup(), { h } = f;
  await f.allocate();
  const before = coreRequoteClone(h.state), permissions = [...h.b.h.identity.user.permissions], command = f.command();
  await assert.rejects(f.flow.preview(f.request, { ...command, orderId: 'foreign-order' }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(f.flow.preview(f.request, { ...command, expectedOrderVersion: '2020-01-01T00:00:00.000Z' }));
  assert.equal(f.calls.previews, 0); assert.deepEqual(coreRequoteClone(h.state), before);
  h.b.h.identity.user.permissions = permissions.filter(code => !['rental-os:order:extend', 'rental-os:order:operate'].includes(code));
  await assert.rejects(f.flow.preview(f.request, command)); assert.equal(f.calls.previews, 0);
  h.b.h.identity.user.permissions = permissions;
  f.calls.afterPreview = () => { h.state.rentalOrder.find(row => row.id === f.orderId).updatedAt =
    new Date(Date.parse(command.expectedOrderVersion) + 1000).toISOString(); };
  await assert.rejects(f.flow.preview(f.request, command), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(f.calls.previews, 1); assert.equal(h.state.rentalOrder.length, 1);
  assert.equal(h.state.aiApprovalConsumption.length, 1); assert.equal(f.quotes.length, 1);
  assert.equal(h.execution.sent.length, f.modelCalls);
});
// End original committed-order extension-preview owned cases.

// Begin original extension application consumption owned cases.
async function originalExtensionApplicationSetup() {
  const f = await originalCommittedExtensionSetup(true), { h } = f;
  await f.allocate();
  const { RentalIdempotencyRepository } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { RentalIdempotentActionService } = require('../apps/api/src/modules/rental-core/rental-idempotent-action.service');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const { RentalOrderExtensionDto } = require('../apps/api/src/modules/rental-core/rental-order-request.dto');
  const { plainToInstance } = require('class-transformer');
  h.b.facts.listExtensions = (tenantId, orderId, tx) => (tx ?? h.db).rentalOrderExtension.findMany({ where: { tenantId, workspaceId: 'workspace-a', orderId } });
  h.b.facts.insertExtension = (extension, tx) => { assert.ok(tx); return tx.rentalOrderExtension.create({ data: structuredClone(extension) }); };
  h.b.facts.cancelExtensions = async () => { throw Error('No old extension may be cancelled by the new fixture'); };
  const idempotent = new RentalIdempotentActionService(h.db, new RentalIdempotencyRepository(h.db));
  // New application fixture only: the original Core fixture was constructed
  // without its optional MembershipService. Use the SAME real service/rows that
  // produced this order's original snapshot, never a constant qualification pass.
  h.b.core.memberships = h.b.memberships;
  f.controller.idempotent = idempotent; f.controller.prisma = h.db;
  const { composeSelectedOrderExtensionApplicationFlow } = require('../apps/api/src/modules/ai-native/scenes/selected-order-extension-application-flow');
  const flow = composeSelectedOrderExtensionApplicationFlow({ ...f.dependencies, core: h.b.core, guard: f.guard, preview: f.controller, receipts: idempotent,
    orders: { readResult: (_request, value) => f.orderTask.readResult(value) } });
  let submissions = 0;
  // This is the existing HUMAN endpoint/DTO/Core transaction, outside the new
  // read/preparation consumer. It is never called by inspect/prepare/read.
  const applyOriginalOnce = prepared => runWithRequestIdentity({}, async () => {
    submissions++; assert.equal(submissions, 1);
    const req = { method: 'POST', url: `/api/rental/v1/orders/${f.orderId}/extensions`, originalUrl: `/api/rental/v1/orders/${f.orderId}/extensions`,
      headers: { authorization: f.request.headers.authorization, 'idempotency-key': prepared.operationKey }, body: prepared.request, query: {} };
    assert.equal(await f.guard.canActivate(new ExecutionContextHost([req])), true);
    let lost = false;
    h.control.beforeCommit = candidate => { if (!lost && candidate.rentalOrderExtension.length === 1 && h.state.rentalOrderExtension.length === 0) {
      lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
    } };
    let failure;
    await assert.rejects(f.controller.applyExtension(req, f.orderId, plainToInstance(RentalOrderExtensionDto, prepared.request)), error => { failure = error; return true; });
    if (!lost) throw new Error(`Original extension did not reach COMMIT; code=${failure?.code ?? failure?.name}; ${String(failure?.message).slice(0, 240)}`);
    assert.equal(lost, true);
  });
  return { ...f, application: flow, idempotent, applyOriginalOnce, submissions: () => submissions };
}

test('AIN13 original extension application prepares an explicit human request and reads the same lost pending-payment Core receipt', { timeout: 180000 }, async () => {
  const f = await originalExtensionApplicationSetup(), { h } = f, command = f.command();
  const before = coreRequoteClone(h.state), modelCalls = h.execution.sent.length;
  const inspected = await f.application.inspect(f.request, command); assert.equal(inspected.state, 'prepared');
  const prepared = await f.application.prepare(f.request, { ...command, decision: 'prepare_original_extension_request', reviewHash: inspected.reviewHash });
  assert.equal(prepared.orderId, f.orderId); assert.deepEqual(prepared.request, command.extension);
  assert.equal(prepared.execution, 'not_submitted'); assert.equal(prepared.inventory, 'not_reserved'); assert.equal(prepared.approval, 'not_granted');
  assert.deepEqual(coreRequoteClone(h.state), before); assert.equal(f.submissions(), 0); assert.equal(h.execution.sent.length, modelCalls);
  const absent = await f.application.readApplication(f.request, command);
  assert.equal(absent.state, 'unknown'); assert.equal(absent.operationKey, prepared.operationKey); assert.equal(absent.retryable, false);
  assert.deepEqual(coreRequoteClone(h.state), before); assert.equal(f.submissions(), 0);
  await f.applyOriginalOnce(prepared);
  assert.equal(h.state.rentalOrderExtension.length, 1); assert.equal(h.state.rentalOrderIdempotencyRecord.length, before.rentalOrderIdempotencyRecord.length + 1);
  const extension = h.state.rentalOrderExtension[0];
  assert.equal(extension.status, 'pending_payment'); assert.equal(extension.idempotencyKey, prepared.operationKey);
  assert.equal(h.state.rentalOrder[0].effectiveEndAt ?? h.state.rentalOrder[0].endAt, before.rentalOrder[0].effectiveEndAt ?? before.rentalOrder[0].endAt);
  assert.deepEqual(h.state.rentalOrder[0].reservations, before.rentalOrder[0].reservations);
  const committed = coreRequoteClone(h.state);
  const receipt = await f.application.readApplication(f.request, command);
  assert.equal(receipt.state, 'observed'); assert.equal(receipt.receipt.extensionId, extension.id); assert.equal(receipt.receipt.statusAtAcceptance, 'pending_payment');
  assert.equal(receipt.receipt.payableAmount, extension.payableAmount); assert.equal(receipt.receipt.currency, extension.currency);
  assert.equal(receipt.current.status, 'pending_payment'); assert.equal(receipt.payment, 'not_inferred'); assert.equal(receipt.fulfillment, 'not_inferred');
  assert.equal((await f.application.readApplication(f.request, command)).receipt.extensionId, extension.id);
  assert.deepEqual(coreRequoteClone(h.state), committed); assert.equal(f.submissions(), 1); assert.equal(h.execution.sent.length, modelCalls);
  const permissions = [...h.b.h.identity.user.permissions];
  h.b.h.identity.user.permissions = permissions.filter(code => !['rental-os:order:extend', 'rental-os:order:operate'].includes(code));
  assert.equal((await f.application.readApplication(f.request, command)).receipt.extensionId, extension.id);
  await assert.rejects(f.application.inspect(f.request, command));
  h.b.h.identity.user.permissions = permissions;
  assert.deepEqual(coreRequoteClone(h.state), committed); assert.equal(f.submissions(), 1);
});

test('AIN13 original extension application refuses caller keys stale confirmations and corrupt original receipts without resubmitting', { timeout: 180000 }, async () => {
  const f = await originalExtensionApplicationSetup(), { h } = f, command = f.command();
  const inspected = await f.application.inspect(f.request, command), before = coreRequoteClone(h.state);
  await assert.rejects(f.application.prepare(f.request, { ...command, decision: 'prepare_original_extension_request', reviewHash: 'a'.repeat(64) }), error => error.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(f.application.readApplication(f.request, { ...command, operationKey: 'caller-key' }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(f.application.inspect(f.request, { ...command, expectedOrderVersion: '2020-01-01T00:00:00.000Z' }));
  assert.deepEqual(coreRequoteClone(h.state), before); assert.equal(f.submissions(), 0);
  const prepared = await f.application.prepare(f.request, { ...command, decision: 'prepare_original_extension_request', reviewHash: inspected.reviewHash });
  await f.applyOriginalOnce(prepared);
  // Existing serialized metadata transactions publish cloned arrays, including
  // read-only value-equivalent rows. Re-locate the SAME original record rather
  // than mutate a detached reference when restoring/altering this new fixture.
  const record = () => h.state.rentalOrderIdempotencyRecord.find(row => row.action === 'order.extend');
  const saved = coreRequoteClone(record().response);
  record().response.extension.orderId = 'foreign-order';
  const corrupted = coreRequoteClone(h.state);
  await assert.rejects(f.application.readApplication(f.request, command)); assert.deepEqual(coreRequoteClone(h.state), corrupted);
  record().response = saved;
  assert.deepEqual(record().response, saved);
  const read = f.idempotent.readReceipt.bind(f.idempotent); let changed = false;
  f.idempotent.readReceipt = async (...args) => { const value = await read(...args); if (!changed && value) { changed = true; record().response.extension.payableAmount += 1; } return value; };
  await assert.rejects(f.application.readApplication(f.request, command), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(changed, true); assert.equal(f.submissions(), 1); assert.equal(h.state.rentalOrderExtension.length, 1);
  assert.equal(h.execution.sent.length, f.modelCalls);
});
// End original extension application consumption owned cases.

// Begin original order-to-member name owned cases.
async function originalOrderMemberNameSetup() {
  const f = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, true, false, false, true), { h } = f;
  await f.human.decideSelectedProposal({ selection: f.selection, proposal: { ...f.waiting.proposal,
    decision: 'approve', reviewVersion: f.review.draftVersion } });
  assert.equal((await f.orderTask.continueConfirmation({ selection: f.selection, checkpointRef: f.waiting.checkpointRef })).outcome.status, 'succeeded');
  assert.equal(h.state.rentalOrder.length, 1);
  h.b.memberships.prisma.customerProfile = h.db.customerProfile;
  h.b.memberships.prisma.customerMembership = h.db.customerMembership;
  // New explicit fixture-only profile scene/policies. No manager or production
  // policy writer is invoked; original quote scene/policies/resources remain.
  const scene = { code: 'original_order_member_name', version: '1' };
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: scene.code, sceneVersion: scene.version, revision: 1,
    enabled: true, allowedTools: [{ code: 'membership.profile.commit', version: require('@rental-os/shared').AI_TOOL_DRAFT_VERSION }],
    limits: structuredClone(f.limits), expiresAt: new Date('2027-01-01T00:00:00Z') });
  h.state.aiBudgetPolicy.push(...coreRequoteClone(h.state.aiBudgetPolicy).map(row => ({ ...row, id: `${row.id}-member`, sceneCode: scene.code,
    allowedScenes: [scene.code], settingsJson: { ...row.settingsJson, sceneCode: scene.code, allowedScenes: [scene.code] } })));
  const { composeRequestBoundProfileWorkflow } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { composeSelectedOrderProfileChangeFlow } = require('../apps/api/src/modules/ai-native/scenes/selected-order-profile-change-flow');
  const { credentials, originals, ...baseDependencies } = f.dependencies;
  // The request binder accepts neither retained originals nor ambient credentials.
  // Only this new setup binds the real detail Guard to its persisted Core order;
  // the older original-request fixture has only the unrelated order-a sample.
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const guard = new ApiAuthGuard(f.dependencies.auth, undefined, undefined, undefined, {
    rentalOrder: { findFirst: args => h.db.rentalOrder.findFirst(args) }
  });
  const dependencies = { ...baseDependencies, guard };
  const profiles = composeRequestBoundProfileWorkflow({ ...dependencies, holderId: 'order-member-worker', scene },
    { enabled: true, audience: 'operator', host: { holderId: 'order-member-worker', leaseMs: 100000 } });
  const flow = composeSelectedOrderProfileChangeFlow({ ...dependencies, credentials, profiles,
    orders: { readResult: (_request, value) => f.orderTask.readResult(value) } });
  const command = { selection: f.selection, requestKey: 'explicit-original-order-member-name', name: 'Updated member ordinary name',
    expiresAt: '2027-01-01T00:00:00.000Z' };
  const grantMember = () => h.b.h.identity.user.permissions.push('rental-os:member:view', 'rental-os:member:manage');
  return { ...f, flow, profiles, command, grantMember };
}

test('AIN16 original order member name requires independent approval and Core CAS while keeping old order and quote snapshots', { timeout: 120000 }, async () => {
  const f = await originalOrderMemberNameSetup(), { h } = f;
  f.grantMember();
  const orders = coreRequoteClone(h.state.rentalOrder), quote = structuredClone(f.quote);
  const oldRows = () => Object.fromEntries(['aiTask', 'aiRun', 'aiStep', 'aiTaskRunPlan', 'aiTaskActionInput', 'aiTaskExecutionBudget',
    'aiTaskExecutionCharge', 'aiApproval', 'aiProposal', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt'].map(table =>
    [table, coreRequoteClone(h.state[table].filter(row => row.id === f.selection.taskId || row.taskId === f.selection.taskId))]));
  const original = oldRows(), review = await f.flow.inspect(f.request, f.command);
  assert.equal(review.customerId, 'customer-a'); assert.equal(review.fields[0].before, orders[0].customerName);
  const prepared = await f.flow.prepare(f.request, { ...f.command, reviewHash: review.reviewHash });
  assert.equal(prepared.task, 'not_created'); assert.equal(prepared.change.customerId, orders[0].customerId);
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  const created = await f.profiles.createTask(f.request, prepared.reference), taskId = created.receipt.taskId;
  // The older model fixture expands requested runs into full rows containing
  // Prisma Decimal. Honor this NEW task's exact id-only creation projection;
  // production readCreation correctly rejects an uncloneable full-row reply.
  const readTask = h.db.aiTask.findFirst.bind(h.db.aiTask);
  h.db.aiTask.findFirst = async args => {
    const row = await readTask(args);
    if (!row || row.id !== taskId || !args.select?.runs || Object.keys(args.select.runs.select ?? {}).join(',') !== 'id') return row;
    assert.deepEqual(args.select.runs, { where: { sequence: 1 }, select: { id: true }, take: 1 });
    return Object.fromEntries(Object.entries(args.select).filter(([, selected]) => selected).map(([field]) =>
      [field, field === 'runs' ? row.runs.filter(run => run.sequence === 1).slice(0, 1).map(run => ({ id: run.id })) : coreRequoteClone(row[field])]));
  };
  assert.equal((await f.profiles.readCreation(f.request, prepared.reference)).receipt.state, 'observed');
  h.state.aiTaskActionPolicy.push(...coreRequoteClone(h.state.aiTaskActionPolicy.filter(row => row.taskId === f.selection.taskId)).map(row => ({ ...row,
    taskId, requiredPermissions: ['transition_task', 'decide_approval'].includes(row.operation) ? ['rental-os:member:manage'] : row.requiredPermissions })));
  assert.equal((await f.profiles.start(f.request, prepared.reference)).outcome.status, 'paused');
  await assert.rejects(f.profiles.continueConfirmation(f.request, prepared.reference));
  await f.profiles.decide(f.request, { ...prepared.reference, decision: 'approve' });
  let lost = false;
  h.control.beforeCommit = draft => { if (!lost && draft.customerApprovedProfileOperation.length === 1 && h.state.customerApprovedProfileOperation.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  assert.notEqual((await f.profiles.continueConfirmation(f.request, prepared.reference)).outcome.status, 'succeeded');
  assert.equal(lost, true); assert.equal(h.state.customerProfile[0].name, f.command.name); assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1);
  const result = await f.profiles.read(f.request, prepared.reference); assert.equal(result.businessOutcome, 'committed');
  assert.equal(result.operation.receipt.resultRevision, 2);
  const current = await f.profiles.readCurrent(f.request, { customerId: 'customer-a' }); assert.equal(current.name, f.command.name);
  const observed = await f.flow.readPrepared(f.request, { selection: f.selection, requestKey: f.command.requestKey });
  assert.equal(observed.result.state, 'prepared'); assert.equal(observed.result.reference.changeId, prepared.reference.changeId);
  assert.deepEqual(coreRequoteClone(h.state.rentalOrder), orders); assert.deepEqual(f.quote, quote); assert.deepEqual(oldRows(), original);
  assert.equal(h.state.customerProfile[0].email, 'retained@example.test'); assert.equal(h.state.customerProfile[0].phone, 'synthetic-phone');
  assert.equal(h.state.customerProfile[0].identityVerified, false); assert.equal(h.execution.sent.length, f.modelCalls);
});

test('AIN16 original order member preparation denies order-only authority caller targets and reads one lost original preparation', { timeout: 120000 }, async () => {
  const f = await originalOrderMemberNameSetup(), { h } = f;
  await assert.rejects(f.flow.inspect(f.request, { ...f.command, customerId: 'foreign-customer' }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(f.flow.inspect(f.request, f.command));
  assert.equal(h.state.customerApprovedProfileChange.length, 0);
  h.b.h.identity.user.permissions.push('rental-os:member:view');
  const review = await f.flow.inspect(f.request, f.command);
  await assert.rejects(f.flow.prepare(f.request, { ...f.command, reviewHash: review.reviewHash }));
  assert.equal(h.state.customerApprovedProfileChange.length, 0); assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  h.b.h.identity.user.permissions.push('rental-os:member:manage');
  const latest = await f.flow.inspect(f.request, f.command), taskCount = h.state.aiTask.length;
  let lost = false;
  h.control.beforeCommit = draft => { if (!lost && draft.customerApprovedProfileChange.length === 1 && h.state.customerApprovedProfileChange.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  await assert.rejects(f.flow.prepare(f.request, { ...f.command, reviewHash: latest.reviewHash }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(lost, true); assert.equal(h.state.customerApprovedProfileChange.length, 1);
  const before = coreRequoteClone(h.state), found = await f.flow.readPrepared(f.request, { selection: f.selection, requestKey: f.command.requestKey });
  assert.equal(found.result.state, 'prepared'); assert.equal(found.result.change.fields[0].after, f.command.name);
  assert.deepEqual(coreRequoteClone(h.state), before); assert.equal(h.state.aiTask.length, taskCount);
  assert.equal(h.state.customerApprovedProfileOperation.length, 0); assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  assert.equal(h.state.rentalOrder.length, 1); assert.equal(h.execution.sent.length, f.modelCalls);
});
// End original order-to-member name owned cases.

test('AIN15 enterprise self-paid multiline choices retain the original member snapshot after relation expiry', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(true);
});

test('AIN15 expired employee relation after approval cannot execute the original multiline order', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(true, true);
});

test('AIN15 inventory lost at the original locked commit cannot consume approved multiline quote', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, true);
});

test('AIN15 cancellation after original multiline approval fences execution without undoing its receipt', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, true);
});

test('AIN15 cancellation after lost multiline commit retains the one original order without restart', { timeout: 60000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, false, true);
});

test('human enterprise quote selection persists the exact identity without approval and rejects another enterprise', async () => {
  const h=await harness(false,true,true);
  const selected=await h.repository.select(h.command);
  assert.equal(selected.receipt.state,'selected_not_approved');assert.equal(selected.receipt.approval,'not_granted');
  const row=h.state.aiTaskQuoteSelection[0];
  assert.deepEqual(row.payload.bookingIdentity,h.command.order.bookingIdentity);
  const count=h.state.aiTaskQuoteSelection.length;
  await assert.rejects(h.repository.select({...h.command,selectionKey:'another-enterprise',
    expectedSelectionRevision:1,order:{...h.command.order,bookingIdentity:{...h.command.order.bookingIdentity,corporateCustomerId:'company-b'}}}));
  assert.equal(h.state.aiTaskQuoteSelection.length,count);
  assert.equal(h.state.aiApproval.length,0);
});
// Receipt role transitions use fresh original tasks and current read policies;
// they do not restore create permission, rewrite old approvals or retry Core.
async function selectedReceiptReadSetup() {
  const setup = await selectedUnstartedCancellationSetup();
  const { h, direct, command } = setup;
  // Declare only this new fixture's original read policies before execution.
  for (const row of h.state.records.aiTaskActionPolicy) if (row.taskId === h.selection.taskId
    && ['read_metadata', 'read_step_terminal', 'read_events'].includes(row.operation)) row.requiredPermissions = ['rental-os:order:view'];
  const started = await direct.start(command);
  assert.equal(started.outcome.status, 'paused');
  const waiting = await direct.readConfirmation({ ...command, stepId: h.state.records.aiStep[0].id });
  return { ...setup, waiting, original: { draftVersion: require('../packages/shared/src/ai-scene-request-draft').AI_SCENE_REQUEST_DRAFT_VERSION,
    inputRef: h.selection.originalInputRef } };
}

test('AIN15 original receipt consume retains committed Core and task observations after create permission is withdrawn', { timeout: 60000 }, async () => {
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  for (const mode of ['committed', 'core_reply_lost']) {
    const { h, direct, requests, request, command, waiting, original, configurationReads } = await selectedReceiptReadSetup();
    await h.app.decideSelectedProposal({ ...command, proposal: { ...waiting.proposal,
      decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } });
    h.state.ackLost = mode === 'core_reply_lost';
    const result = await direct.continueConfirmation({ ...command, checkpointRef: waiting.checkpointRef });
    assert.equal(h.state.records.rentalOrder.length, 1);
    assert.equal(h.state.records.aiApprovalConsumption.length, 1);
    if (mode === 'committed') assert.equal(result.outcome.status, 'succeeded');
    else assert.notEqual(result.outcome.status, 'succeeded');
    h.state.user.permissions = h.state.user.permissions.filter(value => value !== 'rental-os:order:create');
    assert.ok(h.state.user.permissions.includes('rental-os:order:view'));
    h.state.records.aiTaskPlanPolicy = [];
    h.state.clock = new Date(Date.now() + 2 * 3600000);
    const before = clone(h.state.records);
    const observed = await requests.readResult(request, command);
    assert.equal(observed.status, 'committed');
    assert.equal(observed.order.id, h.state.records.rentalOrder[0].id);
    assert.equal(observed.payment, 'not_inferred'); assert.equal(observed.fulfillment, 'not_inferred');
    const snapshot = await requests.readTaskSnapshot(request, original);
    assert.equal(snapshot.taskId, h.selection.taskId);
    if (mode === 'core_reply_lost') assert.notEqual(snapshot.status, 'succeeded');
    const scene = await requests.readScene(request, { kind: 'original', original, taskId: h.selection.taskId,
      runId: h.selection.runId, review: { selection: h.selection, proposal: waiting.proposal }, order: command });
    assert.equal(scene.business.result.status, 'committed');
    assert.equal(scene.business.result.order.id, observed.order.id);
    assert.equal(configurationReads(), 0, 'original receipt reads cannot consume a new quote/readiness source');
    assert.deepEqual(h.state.records, before, 'read-only Core and Task observations cannot settle unknown charges or claim a lease');
    assert.equal(h.state.records.rentalOrder.length, 1);
    assert.equal(h.state.records.aiGatewayInvocation.length, 0);
  }
});

test('AIN15 original receipt consume requires current view rights and cannot use read results to approve or continue', { timeout: 60000 }, async () => {
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const { h, direct, requests, request, command, waiting, original, configurationReads } = await selectedReceiptReadSetup();
  const fullPermissions = [...h.state.user.permissions];
  h.state.user.permissions = fullPermissions.filter(value => value !== 'rental-os:order:create');
  const before = clone(h.state.records);
  assert.equal((await requests.readResult(request, command)).status, 'not_observed');
  assert.equal((await requests.readTaskSnapshot(request, original)).status, 'waiting_confirmation');
  assert.equal(configurationReads(), 0);
  await assert.rejects(h.app.decideSelectedProposal({ ...command, proposal: { ...waiting.proposal,
    decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } }));
  await assert.rejects(direct.continueConfirmation({ ...command, checkpointRef: waiting.checkpointRef }));
  assert.deepEqual(h.state.records, before);
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  await assert.rejects(requests.readResult(request, { selection: { ...h.selection, runId: require('node:crypto').randomUUID() } }));
  await assert.rejects(requests.readTaskSnapshot(request, { ...original, lease: {} }), error => error.code === 'AI_INVALID_INPUT');
  h.state.user.permissions = fullPermissions.filter(value => value !== 'rental-os:order:view');
  await assert.rejects(requests.readResult(request, command));
  await assert.rejects(requests.readTaskSnapshot(request, original));
  assert.deepEqual(h.state.records, before);
  h.state.user.permissions = fullPermissions.filter(value => value !== 'rental-os:order:create');
  const findQuote = h.sceneDependencies.quoteFacts.findQuote;
  let buffered = false;
  h.sceneDependencies.quoteFacts.findQuote = async (...args) => {
    const result = await findQuote(...args);
    if (!buffered) { buffered = true; h.state.user.permissions = h.state.user.permissions.filter(value => value !== 'rental-os:order:view'); }
    return result;
  };
  try { await assert.rejects(requests.readResult(request, command)); }
  finally { h.sceneDependencies.quoteFacts.findQuote = findQuote; h.state.user.permissions = fullPermissions; }
  assert.equal(buffered, true);
  assert.deepEqual(h.state.records, before);
});

// Begin standard clarified selection entry owned cases.
test('AIN15 standard clarified selection entry prepares original receipt command then explicit selection approval Core and original lost-reply receipt', { timeout: 180000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, true);
});
test('AIN15 public clarified preparation uses the original answer reference then one selected approved Core order and lost-reply receipt', { timeout: 180000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'http_reference');
});
// End standard clarified selection entry owned cases.

// Begin standard preparation category owned cases.
for (const categoryCode of ['camping', 'vehicle', 'construction']) {
  test(`AIN15 standard preparation category ${categoryCode}: explicit selection reaches approved Core order and original receipt`, { timeout: 180000 }, async () => {
    await exerciseMultilineApprovedConsumer(false, false, false, false, false, categoryCode, categoryCode !== 'camping', false, false, false, false, true);
  });
}
// End standard preparation category owned cases.

// Begin current stock original selection owned cases.
test('AIN15 current stock original selection refuses prepared command when original Core stock changed before selection', { timeout: 180000 }, async () => {
  const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'stock_withdrawn');
  assert.equal(result.originalSelectionRefusedBeforePersistence, true);
});
test('AIN15 current stock original selection prepares unchanged quote only after same original Core stock read', { timeout: 180000 }, async () => {
  const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'stock_unchanged');
  assert.equal(result.originalSelectionPreparedReadOnly, true); assert.equal(result.stockReads, 2);
});
test('AIN15 clarified selection rejects insufficient or malformed stock evidence before offering a selectable command', { timeout: 180000 }, async () => {
  const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'stock_inconsistent');
  assert.equal(result.inconsistentStockRejected, true); assert.equal(result.stockReads, 3);
});
// End current stock original selection owned cases.

// Begin quote lifecycle selection owned cases.
for (const mode of ['expired_before', 'expired_during_stock', 'consumed_during_receipt', 'expired_during_receipt', 'unchanged_to_core']) {
  test(`AIN15 original quote lifecycle ${mode}`, { timeout: 180000 }, async () => {
    const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, `lifecycle:${mode}`);
    if (mode === 'unchanged_to_core') return; // Existing complete standard selection/approval/Core/receipt assertions ran.
    assert.equal(result.rejectedPreparation, true); assert.equal(result.historicalReceiptObserved, true);
  });
}
// End quote lifecycle selection owned cases.

// Begin same name customer owned cases.
test('AIN15 same name customer explicit_second_choice_core', { timeout: 180000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'same_name');
});
test('AIN15 same name customer chosen_membership_withdrawn', { timeout: 180000 }, async () => {
  const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'same_name_revoked');
  assert.equal(result.chosenMemberRefused, true);
});
// End same name customer owned cases.

// Begin closing stock owned cases.
for (const mode of ['withdrawn_during_receipt', 'consumed_during_closing_stock', 'available_to_original_core']) {
  test(`AIN15 closing stock ${mode}`, { timeout: 180000 }, async () => {
    const result = await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, `stock_wait:${mode}`);
    if (mode === 'available_to_original_core') return; // Original selection, independent approval, Core and lost-reply receipt assertions all ran.
    assert.equal(result.rejectedClosingStock, true); assert.equal(result.historicalReceiptObserved, true);
  });
}
// End closing stock owned cases.

// Unstarted cancellation uses only the original metadata witness, not a
// newly executable quote, a fabricated empty result or a fresh lease.
async function selectedUnstartedCancellationSetup() {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const { composeRequestBoundSelectedQuoteTask } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const h = await selectedOrderHarness({ initializeOnly: true, runPreparationEvidence: true });
  const { credentials, originals, ...dependencies } = h.sceneDependencies;
  // Metadata cleanup must never consume a new financial/configuration source.
  // This declared fixture port throws on use; it supplies no available facts.
  let configurationReads = 0;
  dependencies.core = Object.create(dependencies.core);
  dependencies.core.readQuoteConfiguration = async () => { configurationReads++; throw Error('fresh_quote_configuration_unavailable_in_cleanup_fixture'); };
  dependencies.core.readOpeningConfiguration = async () => { configurationReads++; throw Error('fresh_opening_configuration_unavailable_in_cleanup_fixture'); };
  dependencies.business = Object.create(dependencies.business);
  dependencies.business.readTenantReadiness = async () => { configurationReads++; throw Error('opening_readiness_unavailable_in_cleanup_fixture'); };
  dependencies.creationRules = [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
    audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }];
  dependencies.memberships = { listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) };
  let ticks = 0;
  const requests = composeRequestBoundSelectedQuoteTask(dependencies, { enabled: true, audience: 'operator' }, {
    host: { holderId: 'selected-cancel-host', leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks
  });
  const request = new (require('node:events').EventEmitter)();
  request.headers = { authorization: (await credentials.current()).authorization };
  // Start the fresh trace through the existing fixture's original order host;
  // production request-bound execution still uses the full scene authority.
  const { composeSelectedQuoteTaskApplication } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
  const direct = composeSelectedQuoteTaskApplication(h.sceneDependencies, {
    host: { holderId: 'selected-cancel-host', leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks
  });
  return { h, requests, request, direct, configurationReads: () => configurationReads, command: { selection: h.selection } };
}

test('AIN15 selected unstarted cancellation closes its original queued Run without plan policy and reads a lost settlement ACK', { timeout: 60000 }, async () => {
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  for (const mode of ['normal', 'metadata_reply_lost']) {
    const { h, requests, request, direct, configurationReads, command } = await selectedUnstartedCancellationSetup();
    h.state.records.aiTaskPlanPolicy = [];
    // Advance only this fresh fixture's clock; retained expiry/hash are not rewritten.
    h.state.clock = new Date(Date.now() + 2 * 3600000);
    const frozenQuote = clone(h.state.records.quote), frozenSelection = clone(h.state.records.aiTaskQuoteSelection);
    const initialRevision = h.state.records.aiTask[0].revision;
    const before = clone(h.state.records);
    const absent = await requests.readCancellationSettlement(request, { ...command, expectedRevision: initialRevision });
    assert.equal(absent.receipt.status, 'not_observed');
    assert.equal(absent.receipt.absenceSemantics, 'not_observed_is_not_proof_of_uncommitted');
    assert.deepEqual(h.state.records, before);
    await assert.rejects(requests.settleUnstartedCancellation(request, { ...command, expectedRevision: initialRevision, lease: {} }),
      error => error.code === 'AI_INVALID_INPUT');
    const requested = await requests.requestCancel(request, { ...command, expectedRevision: initialRevision });
    assert.equal(requested.cancellation, 'requested_not_rollback');
    const expectedRevision = requested.receipt.event.taskRevision;
    assert.equal((await requests.readCancellation(request, { ...command, expectedRevision: initialRevision })).receipt.status, 'observed');
    const afterRequest = clone(h.state.records);
    await assert.rejects(requests.settleUnstartedCancellation(request, { ...command, expectedRevision: initialRevision }),
      error => error.code === 'AI_REVISION_CONFLICT');
    assert.deepEqual(h.state.records, afterRequest);
    const transaction = h.sceneDependencies.db.$transaction;
    let lost = false;
    if (mode === 'metadata_reply_lost') h.sceneDependencies.db.$transaction = async (...args) => {
      const result = await transaction(...args);
      if (!lost && h.state.records.aiTask[0].status === 'CANCELLED') {
        lost = true;
        throw Error('synthetic selected-task settlement COMMIT reply lost');
      }
      return result;
    };
    try {
      if (mode === 'metadata_reply_lost') await assert.rejects(
        requests.settleUnstartedCancellation(request, { ...command, expectedRevision }), error => error.code === 'AI_RESULT_UNKNOWN');
      else {
        const settled = await requests.settleUnstartedCancellation(request, { ...command, expectedRevision });
        assert.equal(settled.cancellation, 'not_business_rollback');
        assert.equal(settled.execution, 'no_lease_claim_or_business_dispatch');
      }
    } finally { h.sceneDependencies.db.$transaction = transaction; }
    assert.equal(lost, mode === 'metadata_reply_lost');
    const r = h.state.records;
    assert.equal(r.aiTask.length, 1); assert.equal(r.aiRun.length, 1);
    assert.equal(r.aiTask[0].status, 'CANCELLED'); assert.equal(r.aiRun[0].status, 'CANCELLED');
    assert.equal(r.aiRun[0].id, h.selection.runId);
    assert.equal(r.aiRun[0].leaseOwnerId, null); assert.equal(r.aiRun[0].leaseExpiresAt, null);
    for (const table of ['aiStep', 'aiTaskRunPlan', 'aiTaskActionInput', 'aiTaskRunPreparation', 'aiTaskExecutionBudget',
      'aiTaskExecutionCharge', 'aiGatewayInvocation', 'aiApproval', 'aiApprovalConsumption', 'rentalOrder']) assert.equal(r[table].length, 0, table);
    assert.deepEqual(r.quote, frozenQuote); assert.deepEqual(r.aiTaskQuoteSelection, frozenSelection);
    const closed = clone(r), observed = await requests.readCancellationSettlement(request, { ...command, expectedRevision });
    assert.equal(observed.receipt.status, 'observed');
    assert.equal(observed.receipt.event.data.reason, 'cancel_settled');
    assert.equal(observed.receipt.automaticRetry, false);
    assert.equal(observed.receipt.admission, 'not_granted');
    assert.deepEqual(h.state.records, closed);
    await assert.rejects(direct.start(command));
    assert.deepEqual(h.state.records, closed);
    assert.equal(configurationReads(), 0, 'cleanup must not prepare a new quote or borrow unavailable facts');
  }
});

test('AIN15 selected unstarted cancellation rejects started traces foreign selection and revoked buffered receipts', { timeout: 60000 }, async () => {
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const { h, requests, request, direct, configurationReads, command } = await selectedUnstartedCancellationSetup();
  const started = await direct.start(command);
  assert.equal(started.outcome.status, 'paused');
  const current = h.state.records.aiTask[0].revision;
  const requested = await requests.requestCancel(request, { ...command, expectedRevision: current });
  const expectedRevision = requested.receipt.event.taskRevision, afterRequest = clone(h.state.records);
  await assert.rejects(requests.settleUnstartedCancellation(request, { ...command, expectedRevision }),
    error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.state.records, afterRequest, 'started work cannot be settled using an absence witness');
  assert.equal(h.state.records.aiStep.length, 1);
  assert.equal(h.state.records.aiTaskRunPreparation.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
  await assert.rejects(requests.readCancellation(request, { selection: { ...h.selection,
    taskId: require('node:crypto').randomUUID() }, expectedRevision: current }));
  await assert.rejects(requests.readCancellationSettlement(request, { ...command, expectedRevision, runId: h.selection.runId }),
    error => error.code === 'AI_INVALID_INPUT');
  const transaction = h.sceneDependencies.db.$transaction;
  let revoked = false;
  h.sceneDependencies.db.$transaction = (...args) => transaction(async tx => {
    const read = tx.aiTaskEvent.findMany;
    tx.aiTaskEvent.findMany = async query => {
      const result = await read(query);
      if (!revoked && query.where?.type === 'task.transition') { revoked = true; h.state.member = false; }
      return result;
    };
    return args[0](tx);
  }, ...args.slice(1));
  try { await assert.rejects(requests.readCancellation(request, { ...command, expectedRevision: current })); }
  finally { h.sceneDependencies.db.$transaction = transaction; h.state.member = true; }
  assert.equal(revoked, true);
  assert.equal(configurationReads(), 0);
  assert.deepEqual(h.state.records, afterRequest);
});

// ACK fault windows use fresh synthetic selections and the existing real
// Auth/Guard/runner/approval/confirmation source. Core/Business facts,
// the seeded quote and transaction storage are explicit substitutes.
// They never retry the older human requests or fabricate lease acknowledgements.
async function selectedRecoveryAckSetup() {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const { composeSelectedQuoteTaskApplication } = require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
  const h = await selectedOrderHarness({ initializeOnly: true, runPreparationEvidence: true });
  let ticks = 0;
  const task = composeSelectedQuoteTaskApplication(h.sceneDependencies, {
    host: { holderId: 'selected-ack-host', leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks
  });
  const command = { selection: h.selection };
  const started = await task.start(command).catch(error => {
    console.error('ACK preparation fixture failures', h.state.failures);
    throw error;
  });
  assert.equal(started.outcome.status, 'paused', JSON.stringify({ started, failures: h.state.failures }));
  const waiting = await task.readConfirmation({ ...command, stepId: h.state.records.aiStep[0].id });
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApproval.length, 0);
  return { h, task, command, waiting, continuation: { ...command, checkpointRef: waiting.checkpointRef } };
}

test('AIN15 selected recovery ACK keeps positive confirmation and cancellation on their original Core and resource lineage', { timeout: 60000 }, async () => {
  const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  for (const mode of ['approve', 'cancel']) {
    const { h, task, command, waiting, continuation } = await selectedRecoveryAckSetup();
    const frozenPlan = clone(h.state.records.aiTaskRunPlan), frozenInput = clone(h.state.records.aiTaskActionInput);
    if (mode === 'approve') await h.app.decideSelectedProposal({ ...command, proposal: {
      ...waiting.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2'
    } });
    else await task.requestCancel({ ...command, expectedRevision: waiting.taskRevision });
    const original = AiTaskRepository.prototype.claimRecoveryRun, seen = [];
    AiTaskRepository.prototype.claimRecoveryRun = async function(input) {
      const received = await original.call(this, input);
      seen.push({ input: clone(input), received: clone(received) });
      return received;
    };
    let result;
    try { result = mode === 'approve' ? await task.continueConfirmation(continuation) : await task.reconcile(command); }
    finally { AiTaskRepository.prototype.claimRecoveryRun = original; }
    assert.equal(seen.length, 1);
    const { input, received } = seen[0];
    assert.equal(received.purpose, 'recovery_only');
    assert.equal(received.taskId, h.selection.taskId);
    assert.equal(received.runId, h.selection.runId);
    assert.equal(received.holderId, input.holderId);
    assert.equal(received.revision, input.expectedRunRevision + 1);
    assert.equal(BigInt(received.fencingToken), BigInt(input.expectedFencingToken) + 1n);
    assert.deepEqual(h.state.records.aiTaskRunPlan, frozenPlan);
    assert.deepEqual(h.state.records.aiTaskActionInput, frozenInput);
    assert.equal(h.state.records.aiTask.length, 1);
    assert.equal(h.state.records.aiRun.length, 1);
    assert.equal(h.state.records.aiRun[0].leaseOwnerId, null);
    assert.equal(h.state.records.aiGatewayInvocation.length, 0);
    assert.equal(h.state.records.rentalOrder.length, mode === 'approve' ? 1 : 0);
    assert.equal(h.state.records.aiApprovalConsumption.length, mode === 'approve' ? 1 : 0);
    if (mode === 'approve') {
      assert.equal(result.outcome.status, 'succeeded');
      const before = clone(h.state.records), observed = await task.reconcile(command);
      assert.equal(observed.status, 'committed');
      assert.equal(observed.order.id, h.state.records.rentalOrder[0].id);
      assert.equal(observed.payment, 'not_inferred');
      assert.deepEqual(h.state.records, before);
    } else assert.notEqual(result.outcome.status, 'succeeded');
  }
});

test('AIN15 selected recovery ACK rejects another purpose or fencing tuple before continuation recovery or cleanup', { timeout: 60000 }, async () => {
  const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  for (const operation of ['continueConfirmation', 'reconcile']) for (const fault of ['purpose', 'fencing']) {
    const { h, task, command, continuation, waiting } = await selectedRecoveryAckSetup();
    await h.app.decideSelectedProposal({ ...command, proposal: {
      ...waiting.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2'
    } });
    const original = AiTaskRepository.prototype.claimRecoveryRun, read = h.sceneDependencies.db.aiRun.findFirst;
    let afterClaim = false, readsAfterClaim = 0, claims = 0, postClaim;
    h.sceneDependencies.db.aiRun.findFirst = async args => {
      if (afterClaim) readsAfterClaim++;
      return read(args);
    };
    AiTaskRepository.prototype.claimRecoveryRun = async function(input) {
      claims++;
      const received = await original.call(this, input);
      postClaim = clone(h.state.records); afterClaim = true;
      // Change only the delivered copy after the real original CAS has committed.
      return fault === 'purpose' ? { ...received, purpose: 'execution' }
        : { ...received, fencingToken: input.expectedFencingToken };
    };
    try {
      await assert.rejects(task[operation](operation === 'reconcile' ? command : continuation), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(claims, 1);
      assert.equal(readsAfterClaim, 0, 'bad ACK cannot query a held lease to replace the received tuple');
      assert.deepEqual(h.state.records, postClaim, 'bad ACK cannot execute, release, or change the original resource ledger');
    } finally {
      AiTaskRepository.prototype.claimRecoveryRun = original;
      h.sceneDependencies.db.aiRun.findFirst = read;
    }
    assert.equal(h.state.records.aiRun[0].leaseOwnerId, 'selected-ack-host');
    assert.equal(h.state.records.rentalOrder.length, 0);
    assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    assert.equal(h.state.records.aiApproval.length, 1);
    const observed = await task.readResult(command);
    assert.equal(observed.status, 'not_observed');
    assert.equal(observed.retryable, false);
    assert.deepEqual(h.state.records, postClaim);
  }
});

test('AIN15 selected recovery ACK loss or post-CAS interruption preserves the same held Run and never guesses release or retries', { timeout: 60000 }, async () => {
  const { AiTaskRepository, AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  for (const operation of ['continueConfirmation', 'reconcile']) for (const fault of ['storage_reply_lost', 'interrupted_reply']) {
    const { h, task, command, continuation, waiting } = await selectedRecoveryAckSetup();
    await h.app.decideSelectedProposal({ ...command, proposal: {
      ...waiting.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2'
    } });
    const original = AiTaskRepository.prototype.claimRecoveryRun, read = h.sceneDependencies.db.aiRun.findFirst;
    const controller = new AbortController();
    let claims = 0, postClaim, afterClaim = false, readsAfterClaim = 0;
    h.sceneDependencies.db.aiRun.findFirst = async args => {
      if (afterClaim) readsAfterClaim++;
      return read(args);
    };
    AiTaskRepository.prototype.claimRecoveryRun = async function(input) {
      claims++;
      const received = await original.call(this, input);
      postClaim = clone(h.state.records); afterClaim = true;
      if (fault === 'storage_reply_lost') throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
      controller.abort();
      return received;
    };
    try {
      await assert.rejects(task[operation](operation === 'reconcile' ? command : continuation, controller.signal), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(claims, 1);
      assert.equal(readsAfterClaim, 0);
      assert.deepEqual(h.state.records, postClaim);
    } finally {
      AiTaskRepository.prototype.claimRecoveryRun = original;
      h.sceneDependencies.db.aiRun.findFirst = read;
    }
    assert.equal(h.state.records.aiRun[0].leaseOwnerId, 'selected-ack-host');
    assert.equal(h.state.records.rentalOrder.length, 0);
    assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    assert.equal(h.state.records.aiGatewayInvocation.length, 0);
  }
});

test('selected quote task HTTP uses normal runner and current human decision without caller execution authority', { timeout: 60000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const controllers = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const { AiHumanQuoteSelectionModule } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  for (const mode of ['approve', 'reject', 'cancel', 'unknown']) {
    const h = await selectedOrderHarness({ initializeOnly: true });
    const configuration = { holderId: 'selected-host', creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
      audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }], memberships: { listPersonalOptions: async () => [],
      listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } };
    const { credentials, originals, ...dependencies } = h.sceneDependencies;
    Object.assign(dependencies, { creationRules: configuration.creationRules, memberships: configuration.memberships });
    let ticks = 0;
    const options = { enabled: true, audience: 'operator' }, taskOptions = {
      host: { holderId: configuration.holderId, leaseMs: 100000 }, limits: h.limits, monotonic: () => ++ticks };
    const module = AiHumanQuoteSelectionModule.registerHttpTask(dependencies, options, taskOptions, configuration);
    assert.ok(module.controllers.includes(controllers.AiSelectedQuoteTaskController));
    assert.equal(Reflect.getMetadata('controllers', AiHumanQuoteSelectionModule)?.length ?? 0, 0);
    const requests = module.providers.find(p => p.provide === controllers.AI_SELECTED_QUOTE_TASK_REQUESTS).useFactory();
    const task = new controllers.AiSelectedQuoteTaskController(requests);
    const human = new controllers.AiHumanQuoteOrderController(module.providers.find(p => p.provide === controllers.AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
    const request = new (require('node:events').EventEmitter)();
    request.headers = { authorization: (await credentials.current()).authorization };
    const command = { selection: h.selection };
    const schemas = require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS;
    const Ajv = require('ajv'), ajv = new Ajv({ strict: true }); require('ajv-formats')(ajv);
    const valid = ajv.compile(schemas.AiSelectedQuoteTaskRequestDraft);
    assert.equal(valid(command), true); assert.equal(valid({ ...command, order: h.body }), false);
    assert.equal(valid({ ...command, lease: {} }), false);
    assert.equal(h.state.records.aiTask[0].status, 'QUEUED'); assert.equal(h.state.records.aiRun[0].leaseOwnerId, null);
    assert.equal(h.state.records.aiStep.length, 0);
    await assert.rejects(requests.start(request, { ...command, lease: {} }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.start({ headers: {} }, command), e => e.code === 'AI_ACCESS_DENIED');
    await assert.rejects(requests.start(request, { selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
    request.aborted = true;
    assert.equal((await task.start(request, command)).reason, 'host_aborted');
    assert.equal(h.state.records.aiStep.length, 0); request.aborted = false;
    const started = await task.start(request, command);
    assert.equal(started.outcome.status, 'paused', JSON.stringify({ started, failures: h.state.failures }));
    assert.equal(request.listenerCount('aborted'), 0);
    const r = h.state.records, wait = await task.readConfirmation(request, { ...command, stepId: r.aiStep[0].id });
    assert.equal(wait.execution, 'not_attested'); assert.equal(wait.lease, undefined);
    assert.equal(r.aiTask[0].status, 'WAITING_CONFIRMATION'); assert.equal(r.aiApproval.length, 0); assert.equal(r.rentalOrder.length, 0);
    assert.equal(r.aiTaskActionInput[0].registrationRef, `quote-selection:${h.selection.selectionId}`);
    const page = await task.readTaskPage(request, { limit: 5 });
    assert.ok(page.items.some(row => row.taskId === h.selection.taskId));
    await assert.rejects(requests.readTaskPage(request, { limit: 51 }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.readResult(request, { ...command, lease: {} }), e => e.code === 'AI_INVALID_INPUT');
    await assert.rejects(requests.readResult(request, { selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
    const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
    const beforeRead = clone(h.state.records), observed = await task.readResult(request, command);
    assert.equal(observed.status, 'not_observed'); assert.equal(observed.retryable, false); assert.equal(observed.sideEffect, 'not_attested');
    assert.deepEqual(h.state.records, beforeRead);
    const original = { draftVersion: require('../packages/shared/src/ai-scene-request-draft').AI_SCENE_REQUEST_DRAFT_VERSION,
      inputRef: h.selection.originalInputRef };
    const events = await task.readTaskEvents(request, { original, after: '0', limit: 20 });
    assert.equal(events.taskId, h.selection.taskId);
    const snapshot = await requests.readTaskSnapshot(request, original);
    assert.equal(snapshot.taskId, h.selection.taskId); assert.equal(snapshot.status, 'waiting_confirmation');
    if (mode === 'approve') {
      const { composeTaskCenterApproval } = require('../apps/api/src/modules/ai-native/task-center-approval.composition');
      const tasks = require('../apps/api/src/modules/ai-native/task-authorization.composition').composePersistedTaskAuthorization(h.sceneDependencies).tasks;
      const center = composeTaskCenterApproval({ order: dependencies, settings: { db: dependencies.db }, decisions: { order: true, settings: false } }, credentials, tasks);
      const query = { taskId: h.selection.taskId, runId: h.selection.runId, stepId: r.aiStep[0].id };
      const material = await center.review(query);
      assert.equal(material.review.draftVersion, 'ain-approval-order-review-draft-2');
      assert.equal(material.review.deterministic.order.customer.id, 'customer-a');
      assert.equal(material.review.deterministic.order.lines[0].quantity, 1);
      assert.equal(material.review.deterministic.order.fulfillment.returnLocationId, 'location-a');
      await assert.rejects(center.decision({ ...query, proposal: { ...wait.proposal, decision: 'approve' } }), error => error.code === 'AI_INVALID_INPUT');
      assert.equal(h.state.records.aiApproval.length, 0);
    }
    assert.equal(typeof snapshot.cursor, 'string');
    await assert.rejects(requests.readTaskSnapshot(request, { ...original, runId: h.selection.runId }), e => e.code === 'AI_INVALID_INPUT');
    const sceneRequest = { kind: 'original', original, taskId: h.selection.taskId,
      runId: h.selection.runId, review: { selection: h.selection, proposal: wait.proposal }, order: command };
    const sceneValid = ajv.compile(require('../packages/shared/src/ai-scene-request-draft-schemas').AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneModelTaskSceneDraft);
    assert.equal(sceneValid(sceneRequest), true);
    assert.equal(sceneValid({ ...sceneRequest, order: { ...command, command: {} } }), false);
    const scene = await task.readScene(request, sceneRequest);
    assert.equal(scene.business.result.status, 'not_observed');
    assert.equal(scene.execution, 'read_only_no_start_no_reconnect_side_effect');
    assert.deepEqual(h.state.records, beforeRead);
    if (mode === 'approve') {
      const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
      const modelHost = await requestBoundOriginalModelHarness('quote_clarification');
      dependencies.core.readAvailability = modelHost.requestDependencies.core.readAvailability.bind(modelHost.requestDependencies.core);
      dependencies.core.resolvePricingGroupQuoteRequest = modelHost.requestDependencies.core.resolvePricingGroupQuoteRequest.bind(modelHost.requestDependencies.core);
      dependencies.business = modelHost.requestDependencies.business;
      const modelDependencies = { ...modelHost.requestDependencies, ...dependencies };
      const modelOptions = { ...modelHost.options, quoteTask: { dependencies, configuration: taskOptions } };
      const { AiOriginalScenesModule, AI_ORIGINAL_SCENE_MODEL_REQUESTS } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
      const modelModule = AiOriginalScenesModule.registerHttpModel(modelDependencies, modelOptions);
      const modelRequests = modelModule.providers.find(p => p.provide === AI_ORIGINAL_SCENE_MODEL_REQUESTS).useFactory();
      const unified = await modelRequests.readTaskScene(request, { kind: 'original', original, taskId: h.selection.taskId,
        runId: h.selection.runId, review: { selection: h.selection, proposal: wait.proposal }, order: command });
      assert.equal(unified.business.result.status, 'not_observed');
      assert.equal(unified.pendingInput.availability, 'not_requested');
      assert.equal(modelHost.execution.sent.length, 0);
      assert.equal(modelHost.factoryCalls.length, 0, 'business reads do not construct the model execution host');
      assert.deepEqual(h.state.records, beforeRead);
      const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
      assert.throws(() => composeRequestBoundOriginalSceneModel(modelDependencies, { ...modelOptions,
        quoteTask: { ...modelOptions.quoteTask, dependencies: { ...dependencies, db: modelHost.requestDependencies.db } } }),
        e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    }
    const transaction = dependencies.db.$transaction;
    dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
      const read = tx.aiApprovalConsumption.findFirst;
      tx.aiApprovalConsumption.findFirst = async args => {
        const row = await read(args); h.state.session = false; return row;
      };
      return work(tx);
    }, ...options);
    try { await assert.rejects(requests.readResult(request, command), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code)); }
    finally { h.state.session = true; dependencies.db.$transaction = transaction; }
    const frozen = JSON.stringify(r.aiTaskRunPlan[0].payload), actionId = r.aiStep[0].actionId;
    const charges = r.aiTaskExecutionCharge.map(row => row.chargeId);
    const continuation = { ...command, checkpointRef: wait.checkpointRef };
    await assert.rejects(requests.continueConfirmation(request, continuation));
    assert.equal(h.state.records.aiRun[0].leaseOwnerId, null);
    await assert.rejects(requests.continueConfirmation(request, { ...continuation, checkpointRef: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
    if (mode === 'cancel') {
      const cancelled = await task.requestCancel(request, { ...command, expectedRevision: wait.taskRevision });
      assert.equal(cancelled.cancellation, 'requested_not_rollback');
      await assert.rejects(requests.continueConfirmation(request, continuation));
      const result = await task.reconcile(request, command);
      assert.notEqual(result.outcome.status, 'succeeded'); assert.equal(h.state.records.rentalOrder.length, 0);
      assert.equal((await task.readResult(request, command)).status, 'not_observed');
    } else if (mode === 'reject') {
      await human.decideSelectedProposal(request, { ...command, proposal: { ...wait.proposal, decision: 'reject' } });
      const { continueTaskCenterOriginal } = require('../apps/api/src/modules/ai-native/task-center-continuation.composition');
      const tasks = require('../apps/api/src/modules/ai-native/task-authorization.composition').composePersistedTaskAuthorization(h.sceneDependencies).tasks;
      const result = await continueTaskCenterOriginal({ db: dependencies.db, order: requests },
        { order: dependencies, settings: { db: dependencies.db }, decisions: { order: true, settings: false } }, credentials, tasks,
        request, { taskId: h.selection.taskId, runId: h.selection.runId, stepId: r.aiStep[0].id,
          checkpointRef: wait.checkpointRef, expectedTaskRevision: wait.taskRevision, proposal: wait.proposal });
      assert.equal(result.status, 'failed'); assert.equal(h.state.records.rentalOrder.length, 0);
      const controlled = require('../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition').composeControlledApprovedOrder({ ...dependencies, credentials });
      const eligibility = await controlled.application.readReprepareEligibility(h.selection.taskId,
        { draftVersion: 'ain-approval-application-draft-1', original: wait.proposal, intent: 'inspect' });
      assert.equal(eligibility.state, 'rejected'); assert.equal(eligibility.canRequestReprepare, true);
      assert.equal((await task.readResult(request, command)).status, 'not_observed');
    } else {
      const decision = await human.decideSelectedProposal(request, { ...command, proposal: { ...wait.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } });
      assert.equal(decision.order, 'not_created_by_decision'); assert.equal(h.state.records.rentalOrder.length, 0);
      h.state.ackLost = mode === 'unknown';
      const continued = await task.continueConfirmation(request, continuation);
      assert.equal(continued.outcome.status, mode === 'unknown' ? 'unknown' : 'succeeded', JSON.stringify({ continued, failures: h.state.failures }));
      assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.commits, 1);
      if (mode === 'unknown') {
        const unresolved = clone(h.state.records);
        assert.equal((await task.readResult(request, command)).status, 'committed');
        assert.deepEqual(h.state.records, unresolved);
        dependencies.db.$transaction = (work, ...options) => transaction(async tx => {
          tx.aiApprovalConsumption.findFirst = async () => null;
          return work(tx);
        }, ...options);
        try {
          const missing = await task.readResult(request, command);
          assert.equal(missing.status, 'unknown'); assert.equal(missing.retryable, false);
          assert.equal(missing.order, undefined); assert.equal(missing.sideEffect, 'may_have_committed');
          assert.deepEqual(h.state.records, unresolved);
        } finally { dependencies.db.$transaction = transaction; }
        h.state.ackLost = false;
        const recovered = await task.reconcile(request, command);
        assert.equal(recovered.outcome.status, 'succeeded', JSON.stringify({ recovered, failures: h.state.failures }));
        assert.equal(h.state.commits, 1);
      }
      const beforeCommittedRead = clone(h.state.records);
      const { PrismaApprovedOrderSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order.source');
      const sourceRead = PrismaApprovedOrderSource.prototype.read, presented = [];
      PrismaApprovedOrderSource.prototype.read = function(command, ...args) {
        presented.push(clone(command.lease)); return sourceRead.call(this, command, ...args);
      };
      let committed;
      try { committed = await task.readResult(request, command); }
      finally { PrismaApprovedOrderSource.prototype.read = sourceRead; }
      assert.deepEqual(h.state.records, beforeCommittedRead);
      const executed = h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2);
      assert.ok(executed); assert.ok(presented.length > 0);
      for (const lease of presented) assert.deepEqual(lease, { runId: h.selection.runId, holderId: executed.leaseOwnerId,
        revision: executed.runRevision, fencingToken: executed.fencingToken.toFixed(0) });
      assert.equal(committed.status, 'committed', JSON.stringify({ committed, failures: h.state.failures }));
      assert.equal(committed.order.id, h.state.records.rentalOrder[0].id);
      assert.equal(committed.order.quoteId, h.body.quoteId);
      assert.equal(committed.replayed, true);
      const terminalState = clone(h.state.records);
      const terminalResult = await task.reconcile(request, command);
      assert.deepEqual(terminalResult, committed, 'terminal recovery returns only the original authorized order result');
      assert.deepEqual(h.state.records, terminalState, 'terminal recovery must not reclaim execution or write');
      assert.equal(h.state.commits, 1);
      assert.equal(committed.payment, 'not_inferred'); assert.equal(committed.fulfillment, 'not_inferred');
      assert.equal(committed.taskOutcome, 'owned_by_runner'); assert.equal(committed.source.resourceId, committed.order.id);
      const sceneState = clone(h.state.records), completedScene = await task.readScene(request, sceneRequest);
      assert.equal(completedScene.business.result.order.id, committed.order.id);
      assert.equal(completedScene.submission, 'not_attested_by_approval');
      assert.deepEqual(h.state.records, sceneState);
      assert.deepEqual(Object.keys(committed).sort(), ['status', 'replayed', 'order', 'source', 'payment', 'fulfillment', 'taskOutcome'].sort());
      for (const [field, forged] of [['planHash', 'f'.repeat(64)], ['decisionRef', 'foreign-approval']]) {
        const phase = h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2), saved = phase[field];
        phase[field] = forged;
        try { await assert.rejects(requests.readResult(request, command), e => e.code === 'AI_ACCESS_DENIED'); }
        finally { h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2)[field] = saved; }
      }
      h.state.resourceAccess = false;
      assert.equal((await task.readResult(request, command)).status, 'unknown');
      h.state.resourceAccess = true;
      await assert.rejects(requests.continueConfirmation(request, continuation));
      assert.equal(h.state.records.rentalOrder.length, 1);
      assert.ok(h.state.records.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
      assert.equal(h.state.records.aiTaskExecutionBudget[0].consumedSteps, 1n);
      h.state.clock = new Date(Date.now() + 7200000); h.state.records.aiTaskPlanPolicy[0].enabled = false;
      const historical = clone(h.state.records);
      assert.equal((await task.readResult(request, command)).status, 'committed');
      assert.deepEqual(h.state.records, historical);
    }
    assert.equal(h.state.records.aiStep[0].actionId, actionId);
    assert.equal(JSON.stringify(h.state.records.aiTaskRunPlan[0].payload), frozen);
    assert.deepEqual(h.state.records.aiTaskExecutionCharge.map(row => row.chargeId), charges);
    assert.equal(h.state.records.aiTaskExecutionBudget.length, 1);
    h.state.session = false;
    await assert.rejects(requests.readResult(request, command));
    await assert.rejects(requests.reconcile(request, command));
  }
});

test('current human selection is persisted and replayed, but never creates approval/order', { timeout: 30000 }, async () => {
  const h = await harness(), transactionalReads = new Set();
  for (const name of ['readHistorical', 'readTaskLocator', 'readTaskReceipt', 'resolve']) {
    const read = h.orderDependencies.originals[name].bind(h.orderDependencies.originals);
    h.orderDependencies.originals[name] = async (...args) => {
      if (args.at(-1)?.aiTaskQuoteSelection) transactionalReads.add(name);
      return read(...args);
    };
  }
  const first = await h.selections.select(h.command);
  for (const name of ['readHistorical', 'readTaskReceipt', 'resolve']) assert.ok(transactionalReads.has(name), name + ' must share selection transaction');
  assert.equal(first.receipt.state, 'selected_not_approved');
  assert.equal(first.receipt.approval, 'not_granted');
  assert.equal((await h.selections.select(h.command)).replayed, true);
  assert.equal(h.state.aiTaskQuoteSelection.length, 1);
  const read = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: h.command.originalInputRef, selectionId: first.receipt.selectionId };
  assert.equal((await h.selections.read(read)).inputHash, first.receipt.inputHash);
  const proof = { ...read, taskId: h.command.taskId, runId: h.command.runId, inputHash: first.receipt.inputHash };
  assert.equal((await h.repository.readAuthorized(proof)).quoteId, h.quote.id);
  const selectedOrder = h.selections.selectedOrderSource(proof);
  assert.deepEqual(await selectedOrder.read(), h.command.order);
  assert.equal(selectedOrder.taskId, proof.taskId); assert.equal(selectedOrder.runId, proof.runId);
  await assert.rejects(h.selections.publishSelectedInput({ selection: proof, input: h.command.order }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.selections.select({ ...h.command, order: { ...h.command.order, customerName: 'Another choice' } }));
  h.b.h.identity.session = false;
  await assert.rejects(h.selections.read(read));
});

test('selected order goes through human review and decision before Core commit and historical recovery', { timeout: 30000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const h = await selectedOrderHarness(), review = { selection: h.selection, proposal: h.proposal };
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  const displayed = await h.app.readSelectedProposal(review);
  assert.equal(displayed.deterministic.quoteAmounts.payableAmount, 123); assert.equal(displayed.generatedText, null);
  assert.equal(displayed.draftVersion, 'ain-approval-order-review-draft-2'); assert.equal(displayed.facts, undefined);
  assert.equal(displayed.deterministic.order.customer.id, 'customer-a');
  const shared = require('./fixtures/ai-native/local-shared.cjs');
  assert.equal(shared.AI_QUOTE_SELECTION_DRAFT_VERSION, AI_QUOTE_SELECTION_DRAFT_VERSION);
  const components = require('../apps/api/src/contracts/ai-leaf-components').AI_LEAF_COMPONENT_SCHEMAS;
  assert.deepEqual(components.AiApprovalApplicationReviewDraft.properties.generatedText, { type: 'string', nullable: true, enum: [null] });
  const eligibility = { selection: h.selection, request: { draftVersion: 'ain-approval-application-draft-1', original: h.proposal, intent: 'inspect' } };
  assert.equal((await h.app.readSelectedReprepareEligibility(eligibility)).state, 'pending');
  await assert.rejects(h.app.readSelectedProposal({ ...review, selection: { ...h.selection, inputHash: 'f'.repeat(64) } }), e => e.code === 'AI_ACCESS_DENIED');
  const decision = { ...review, proposal: { ...h.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } };
  await assert.rejects(h.app.decideSelectedProposal({ ...decision, actorId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
  assert.deepEqual(await h.app.readSelectedDecisionReceipt(decision), { kind: 'absent', retryable: false });
  h.state.decisionAckLost = true;
  await assert.rejects(h.app.decideSelectedProposal(decision), e => e.code === 'AI_RESULT_UNKNOWN');
  h.state.decisionAckLost = false;
  const approved = await h.compose().readSelectedDecisionReceipt(decision);
  assert.equal(approved.kind, 'recorded'); assert.equal(approved.record.decision, 'approved');
  assert.equal(h.state.records.aiApproval.length, 1); assert.equal(h.state.records.rentalOrder.length, 0);
  const { expiresAt, ...base } = h.prepareCommand;
  const command = { ...base, approvalId: approved.record.approvalId, reviewedPayloadHash: h.proposal.reviewedPayloadHash };
  await assert.rejects(h.app.readSelectedOrderResult({ selection: h.selection, command }));
  assert.equal(h.state.records.rentalOrder.length, 0);
  h.state.ackLost = true;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command }), e => e.code === 'AI_RESULT_UNKNOWN');
  h.state.ackLost = false;
  assert.equal(h.state.records.rentalOrder.length, 1, JSON.stringify(h.state.failures)); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  h.state.clock = new Date(Date.now() + 7200000); h.state.records.aiTaskPlanPolicy[0].enabled = false;
  const result = await h.compose().reconcileSelectedOrder({ selection: h.selection, command });
  assert.equal(result.replayed, true); assert.equal(result.order.id, h.state.records.aiApprovalConsumption[0].resultRef);
  assert.equal(h.state.commits, 1); assert.equal(h.state.records.rentalOrder.length, 1);
  const { credentials, originals, ...dependencies } = h.sceneDependencies;
  // The scene assembly requires the declared creation rules and bounded
  // member-candidate port even when the reprepare configuration is separate.
  Object.assign(dependencies, { creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
    audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }],
    memberships: { listPersonalOptions: async () => [],
      listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } });
  const requests = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' }, { holderId: 'worker-a',
      creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1, audiences: ['operator'],
        requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }],
      memberships: { listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } });
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  assert.equal(requests.submitSelectedOrder, undefined);
  const humanController = new (require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller').AiHumanQuoteOrderController)(requests);
  const execution = { selection: h.selection, command }, outcome = await humanController.readSelectedOrderResult(request, execution);
  assert.equal(outcome.status, 'committed'); assert.equal(outcome.order.id, result.order.id);
  assert.equal(outcome.payment, 'not_inferred'); assert.equal(outcome.taskOutcome, 'owned_by_runner');
  assert.deepEqual(Object.keys(outcome.order).sort(), ['id', 'quoteId', 'status']);
  assert.equal(h.state.commits, 1);
  const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
  const centerDependencies = { list: { readPage: async () => { throw Error('not used'); } },
    scenes: { requests: h.originals, readTaskReceipt: h.originals.readTaskReceipt.bind(h.originals),
      readRecovery: async () => { throw Error('not used'); } } };
  const center = composeAiTaskCenterScene({ ...centerDependencies,
    orders: { readResult: ({ selection }) => h.app.readSelectedOrderResult({ selection, command }) } });
  const centerRead = { original: { draftVersion: 'ain-scene-request-draft-1', inputRef: h.selection.originalInputRef }, reference: { selection: h.selection } };
  assert.equal((await center.readOrderResult(centerRead)).result.order.id, outcome.order.id);
  await assert.rejects(center.readOrderResult({ ...centerRead, reference: execution }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(composeAiTaskCenterScene(centerDependencies).readOrderResult(centerRead), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(center.readOrderResult({ ...centerRead, reference: { selection: { ...h.selection,
    taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } } }), e => e.code === 'AI_ACCESS_DENIED');
  h.state.resourceAccess = false;
  const uncertain = await humanController.readSelectedOrderResult(request, execution);
  assert.equal(uncertain.status, 'unknown'); assert.equal(uncertain.retryable, false); assert.equal(uncertain.order, undefined);
  h.state.resourceAccess = true;
  await assert.rejects(requests.readSelectedOrderResult(request, { ...execution, selection: { ...h.selection, taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' } }));
  await assert.rejects(requests.readSelectedOrderResult({ headers: {} }, execution), e => e.code === 'AI_ACCESS_DENIED');
  const closed = await h.app.readSelectedReprepareEligibility(eligibility);
  assert.equal(closed.state, 'committed'); assert.equal(closed.canRequestReprepare, false);
  h.state.session = false;
  await assert.rejects(requests.readSelectedOrderResult(request, execution), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  await assert.rejects(h.app.readSelectedDecisionReceipt(decision), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('selected order rejects a human rejection as execution approval', { timeout: 30000 }, async () => {
  const { selectedOrderHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const h = await selectedOrderHarness();
  const rejected = await h.app.decideSelectedProposal({ selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  assert.equal(rejected.approval.decision, 'rejected'); assert.equal(rejected.order, 'not_created_by_decision');
  const eligibility = await h.app.readSelectedReprepareEligibility({ selection: h.selection,
    request: { draftVersion: 'ain-approval-application-draft-1', original: h.proposal, intent: 'change_plan' } });
  assert.equal(eligibility.state, 'rejected'); assert.equal(eligibility.canRequestReprepare, true);
  assert.equal(eligibility.nextAction, 'provide_new_materials');
  const { expiresAt, ...base } = h.prepareCommand;
  await assert.rejects(h.app.submitSelectedOrder({ selection: h.selection, command: { ...base,
    approvalId: rejected.approval.approvalId, reviewedPayloadHash: h.proposal.reviewedPayloadHash } }));
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

test('request-bound quote selection and human decision share only the current request identity', { timeout: 30000 }, async () => {
  const h = await harness(true), { credentials, originals, ...dependencies } = h.orderDependencies;
  const { AiHumanQuoteSelectionModule, AI_HUMAN_QUOTE_ORDER_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  const { AiHumanQuoteSelectionController, AI_HUMAN_QUOTE_SELECTION_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const options = { enabled: true, audience: 'operator' }, request = { headers: { authorization: (await credentials.current()).authorization } };
  const module = AiHumanQuoteSelectionModule.registerHttp(dependencies, options);
  assert.deepEqual(module.exports, [AI_HUMAN_QUOTE_SELECTION_REQUESTS]);
  const controller = new AiHumanQuoteSelectionController(module.providers[0].useFactory());
  assert.throws(() => AiHumanQuoteSelectionModule.registerHttp(h.orderDependencies, options).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(controller.select({ headers: {} }, h.command), e => e.getStatus() === 403);
  const notObserved = await controller.reconcile(request, h.command);
  assert.deepEqual(notObserved, { state: 'not_observed', retryable: false });
  const first = await controller.select(request, h.command);
  assert.equal(first.receipt.approval, 'not_granted'); assert.equal(h.state.aiApproval.length, 0);
  const shared = require('@rental-os/shared'), schemas = shared.AI_QUOTE_SELECTION_DRAFT_SCHEMAS;
  const selectionAjv = new (require('ajv'))({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
  require('ajv-formats')(selectionAjv);
  const names = ['AiQuoteSelectionSelectResponseDraft', 'AiQuoteSelectionReconcileResponseDraft', 'AiQuoteSelectionReceiptDraft'];
  const definitions = JSON.parse(JSON.stringify(Object.fromEntries(names.map(name => [name, schemas[name]]))).replaceAll('#/components/schemas/', '#/$defs/'));
  const validSelect = selectionAjv.compile({ $ref: '#/$defs/AiQuoteSelectionSelectResponseDraft', $defs: definitions });
  const validObserve = selectionAjv.compile({ $ref: '#/$defs/AiQuoteSelectionReconcileResponseDraft', $defs: definitions });
  assert.equal(validSelect(first), true); assert.equal(validObserve(notObserved), true);
  assert.equal(validSelect({ ...first, receipt: { ...first.receipt, approval: 'granted' } }), false);
  assert.equal(validSelect({ ...first, internalContext: {} }), false);
  assert.equal(validObserve({ ...notObserved, retryable: true }), false);
  const assertClosed = schema => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object') assert.equal(schema.additionalProperties, false);
    if (schema.$ref) assert.ok(definitions[schema.$ref.split('/').at(-1)]);
    for (const value of Object.values(schema)) if (value && typeof value === 'object')
      Array.isArray(value) ? value.forEach(assertClosed) : assertClosed(value);
  };
  for (const schema of Object.values(definitions)) assertClosed(schema);
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  for (const name of names) assert.deepEqual(OPENAPI_DOCUMENT.components.schemas[name], aiLeafToOpenApi30(schemas[name], name));
  for (const [routes, contracts] of [[shared.AI_QUOTE_SELECTION_HTTP_DRAFT, shared.AI_QUOTE_SELECTION_HTTP_CONTRACTS],
    [shared.AI_CLARIFIED_QUOTE_SELECTION_HTTP_DRAFT, shared.AI_CLARIFIED_QUOTE_SELECTION_HTTP_CONTRACTS]])
    for (const [name, contract] of Object.entries(contracts)) {
      const route = OPENAPI_DOCUMENT.paths[`/api/${routes.basePath}${routes[name] ? `/${routes[name]}` : ''}`].post;
      assert.equal(route.requestBody.content['application/json'].schema.$ref, `#/components/schemas/${contract.request}`);
      assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
    }
  const observed = await controller.reconcile(request, h.command);
  assert.equal(validObserve(observed), true); assert.equal(observed.receipt.selectionId, first.receipt.selectionId);
  const replay = await controller.select(request, h.command);
  assert.equal(replay.replayed, true); assert.equal(replay.receipt.selectionId, first.receipt.selectionId);
  const readReference = { draftVersion: first.receipt.draftVersion, originalInputRef: first.receipt.originalInputRef, selectionId: first.receipt.selectionId };
  const wireControllers = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const wrapped = new wireControllers.AiHumanQuoteSelectionController({
    select: async () => ({ ...first, secretBody: 'must-not-leak' }),
    read: async () => ({ ...first.receipt, revision: NaN }), reconcile: async () => ({ ...notObserved, receipt: first.receipt }) });
  await assert.rejects(wrapped.select(request, h.command), error => error.getStatus() === 409
    && error.getResponse().code === 'AI_RESULT_UNKNOWN' && error.getResponse().nextAction === 'reconcile'
    && !JSON.stringify(error.getResponse()).includes('must-not-leak'));
  await assert.rejects(wrapped.read(request, readReference), error => error.getStatus() === 503 && error.getResponse().code === 'AI_STORAGE_UNAVAILABLE');
  await assert.rejects(wrapped.reconcile(request, h.command), error => error.getStatus() === 503);
  const clarification = { original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: h.command.originalInputRef },
    submission: { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, taskId: h.command.taskId, requestId: require('node:crypto').randomUUID(),
      expectedRevision: 1, submissionKey: 'selection-contract-only', answers: [{ fieldId: 'clarification_text', value: 'Explicit reference' }] } };
  const clarifiedController = new wireControllers.AiClarifiedQuoteSelectionController({ select: async () => first,
    readOperation: async () => observed });
  assert.deepEqual(await clarifiedController.select(request, { selection: h.command, clarification }), first);
  assert.deepEqual(await clarifiedController.readOperation(request, { selection: h.command, clarification }), observed);
  const badClarified = new wireControllers.AiClarifiedQuoteSelectionController({ select: async () => ({ ...first, receipt: { ...first.receipt, order: 'created' } }) });
  await assert.rejects(badClarified.select(request, { selection: h.command, clarification }), error => error.getStatus() === 409
    && error.getResponse().nextAction === 'read_clarified_selection_operation');
  assert.equal(h.state.aiTaskQuoteSelection.length, 1); assert.equal(h.state.aiApproval.length, 0);
  const selection = { draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: h.command.originalInputRef,
    taskId: h.command.taskId, runId: h.command.runId, selectionId: first.receipt.selectionId, inputHash: first.receipt.inputHash };
  assert.equal((await controller.read(request, { draftVersion: selection.draftVersion, originalInputRef: selection.originalInputRef,
    selectionId: selection.selectionId })).selectionId, selection.selectionId);
  for (const operation of ['read_metadata', 'transition_task', 'decide_approval']) h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: selection.taskId,
    operation, revision: 1, requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'], expiresAt: new Date('2027-01-01') });
  // Runner lease and step start are explicit preconditions, not HTTP operations.
  Object.assign(h.state.aiTask[0], { status: 'RUNNING', cancelRequestedAt: null });
  Object.assign(h.state.aiRun[0], { status: 'RUNNING', leaseOwnerId: 'worker-a', fencingToken: new (require('../apps/api/node_modules/@prisma/client').Prisma.Decimal)('1'),
    leaseExpiresAt: new Date(h.dependencies.clock().getTime() + 120000) });
  const lease = () => ({ taskId: selection.taskId, runId: selection.runId, holderId: 'worker-a', fencingToken: '1',
    revision: h.state.aiRun[0].revision, expiresAt: h.state.aiRun[0].leaseExpiresAt.toISOString() });
  const published = await h.selections.publishSelectedInput({ selection, expectedTaskRevision: h.state.aiTask[0].revision, lease: lease() });
  const formal = require('../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition').composeControlledApprovedOrder(h.orderDependencies);
  await formal.plans.savePlan({ taskId: selection.taskId, runId: selection.runId, taskRevision: h.state.aiTask[0].revision,
    limits: h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'quote_clarification').limits,
    steps: [{ registrationRef: published.registrationRef, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...held } = lease();
  const registered = await formal.registrations.register({ taskId, registrationRef: published.registrationRef, expectedTaskRevision: h.state.aiTask[0].revision, lease: held });
  const step = h.state.aiStep.find(row => row.id === registered.stepId); step.status = 'RUNNING';
  const pending = await h.selections.prepareSelectedProposal({ selection, command: { taskId, proposalId: 'request-bound-proposal', proposalRevision: 1,
    actionId: step.actionId, expiresAt: new Date(h.dependencies.clock().getTime() + 60000).toISOString(), lease: { ...held, revision: h.state.aiRun[0].revision } } });
  const humanModule = AiHumanQuoteSelectionModule.registerRequestBoundApplication(dependencies, options);
  assert.deepEqual(humanModule.exports, [AI_HUMAN_QUOTE_ORDER_REQUESTS]); assert.equal(humanModule.controllers, undefined);
  const app = humanModule.providers[0].useFactory();
  assert.equal(app.submitSelectedOrder, undefined); assert.equal(app.publishSelectedInput, undefined);
  const http = AiHumanQuoteSelectionModule.registerHttpApplication(dependencies, options);
  const { AiHumanQuoteOrderController } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const human = new AiHumanQuoteOrderController(http.providers.find(p => p.provide === AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
  assert.deepEqual(http.controllers, [AiHumanQuoteSelectionController, AiHumanQuoteOrderController]);
  const paths = require('../packages/shared/src/ai-quote-selection-draft').AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT;
  for (const method of ['readSelectedProposal', 'decideSelectedProposal', 'readSelectedDecisionReceipt', 'readSelectedOrderResult',
    'readSelectedReprepareEligibility', 'reprepareSelectedProposal', 'readSelectedReprepareReceipt'])
    assert.equal(Reflect.getMetadata('path', AiHumanQuoteOrderController.prototype[method]), paths[method]);
  assert.equal(human.submitSelectedOrder, undefined); assert.equal(human.publishSelectedInput, undefined);
  const proposal = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: 'request-bound-proposal', proposalRevision: 1,
    reviewedPayloadHash: pending.proposal.reviewedPayloadHash };
  const view = await human.readSelectedProposal(request, { selection, proposal });
  assert.equal(view.facts, undefined); assert.equal(view.generatedText, null);
  const decision = { selection, proposal: { ...proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } };
  const Ajv = require('ajv'), schemaAjv = new Ajv({ strict: false }); require('ajv-formats')(schemaAjv);
  const validDecision = schemaAjv.compile(require('../packages/shared/src/ai-quote-selection-draft-schemas').AI_QUOTE_SELECTION_DRAFT_SCHEMAS.AiHumanQuoteOrderDecisionRequestDraft);
  assert.equal(validDecision(decision), true); assert.equal(validDecision({ ...decision, lease: held }), false);
  await assert.rejects(human.decideSelectedProposal({ headers: {} }, decision), e => e.getStatus() === 403);
  await assert.rejects(human.decideSelectedProposal(request, { ...decision, lease: held }), e => e.getStatus() === 400);
  const approved = await human.decideSelectedProposal(request, decision);
  assert.equal(approved.approval.decision, 'approved'); assert.equal(approved.order, 'not_created_by_decision');
  assert.equal((await human.readSelectedDecisionReceipt(request, decision)).record.approvalId, approved.approval.approvalId);
  assert.equal(h.state.aiApproval.length, 1);
  assert.equal(h.state.rentalOrder?.length ?? 0, 0);
  h.b.h.identity.session = false;
  await assert.rejects(human.readSelectedDecisionReceipt(request, decision), e => e.getStatus() === 403);
});

// Human reprepare consumes original quote evidence, never a fresh diagnostic run.
async function retainedHumanReprepareSetup() {
  const h = await require('./fixtures/ai-native/lane-a-selected-order.cjs').selectedReprepareHarness({ exposeAcknowledgedLease: true });
  const { credentials, originals, reprepareServices, ...dependencies } = h.dependencies;
  // The reused confirmation fixture originally prepares only its first quote.
  // This NEW fixture's business-write port accepts exactly the supplied persisted
  // replacement quote/body, never an arbitrary request or a production adapter.
  const syntheticCore = Object.getPrototypeOf(h.dependencies.core);
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  syntheticCore.prepareOrder = async (tenant, order, name, quote) => {
    const identity = require('../apps/api/src/common/request-identity').getRequestIdentity();
    assert.equal(tenant, 'tenant-a'); assert.equal(identity.userId, 'operator-a'); assert.equal(identity.workspaceId, 'workspace-a');
    assert.equal(name, 'Synthetic operator'); assert.equal(order.quoteId, quote.id);
    assert.equal(requestFingerprint(order), requestFingerprint(quote.request));
    assert.equal(h.state.records.quote.some(row => row.id === quote.id), true);
    h.state.prepares++;
    return { id: `order-${h.state.prepares}`, tenantId: tenant, workspaceId: identity.workspaceId,
      status: 'draft', payableAmount: quote.payableAmount, quoteId: quote.id, lines: order.lines };
  };
  let diagnostics = 0;
  dependencies.core = Object.create(h.dependencies.core);
  for (const method of ['readQuoteConfiguration', 'readOpeningConfiguration', 'readTenantReadiness'])
    dependencies.core[method] = async () => { diagnostics++; throw new Error('synthetic_current_diagnostic_source_unavailable'); };
  Object.assign(dependencies, { creationRules: h.configuration.creationRules, memberships: h.configuration.memberships });
  const requests = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application').composeRequestBoundHumanQuoteOrder(
    dependencies, { enabled: true, audience: 'operator' }, h.configuration);
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  await h.app.decideSelectedProposal({ selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  return { ...h, requests, request, diagnostics: () => diagnostics };
}

test('AIN15 original human reprepare retains rejected material then requires a new decision before one original order', { timeout: 60000 }, async () => {
  const h = await retainedHumanReprepareSetup(), clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
  const originalInput = clone(h.state.records.aiTaskOriginalRequest.find(row => row.id === h.selection.originalInputRef));
  const originalSelection = clone(h.state.records.aiTaskQuoteSelection.find(row => row.id === h.selection.selectionId));
  const eligibility = await h.requests.readSelectedReprepareEligibility(h.request, { selection: h.selection,
    request: { draftVersion: 'ain-approval-application-draft-1', original: h.proposal, intent: 'inspect' } });
  assert.equal(eligibility.state, 'rejected'); assert.equal(eligibility.canRequestReprepare, true);
  const input = { selection: h.selection, command: h.command };
  h.state.reprepareAckLost = true;
  await assert.rejects(h.requests.reprepareSelectedProposal(h.request, input), error => error.code === 'AI_RESULT_UNKNOWN');
  h.state.reprepareAckLost = false;
  const prepared = await h.requests.readSelectedReprepareReceipt(h.request, input);
  assert.equal(prepared.receipt.state, 'prepared'); assert.equal(prepared.order, 'not_created_by_reprepare');
  assert.deepEqual(prepared.replacement.selection, h.replacementSelection);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiProposal.find(row => row.id === h.proposal.proposalId).status, 'SUPERSEDED');
  assert.equal(h.state.records.aiApproval.length, 1); assert.equal(h.state.records.aiApproval[0].decision, 'REJECTED');
  assert.equal(h.requests.submitSelectedOrder, undefined);
  await assert.rejects(h.requests.decideSelectedProposal(h.request, { selection: h.selection,
    proposal: { ...h.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } }));
  const approved = await h.requests.decideSelectedProposal(h.request, { selection: prepared.replacement.selection,
    proposal: { ...prepared.receipt.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } });
  assert.equal(approved.approval.decision, 'approved'); assert.equal(h.state.records.rentalOrder.length, 0);
  const { taskId: _task, expiresAt: _expiry, ...lease } = h.replacementLease;
  assert.equal(lease.runId, h.command.replacement.runId);
  const command = { taskId: h.command.replacement.taskId, proposalId: prepared.receipt.proposal.proposalId,
    proposalRevision: prepared.receipt.proposal.proposalRevision, reviewedPayloadHash: prepared.receipt.proposal.reviewedPayloadHash,
    actionId: h.command.replacement.actionId, approvalId: approved.approval.approvalId, lease };
  const result = await h.app.submitSelectedOrder({ selection: prepared.replacement.selection, command });
  assert.equal(result.order.quoteId, h.state.records.quote.find(row => row.id === 'quote-new-material').id);
  assert.equal(h.state.commits, 1); assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  h.state.clock = new Date(Date.now() + 7200000);
  const observed = await h.requests.readSelectedOrderResult(h.request, { selection: prepared.replacement.selection, command });
  assert.equal(observed.status, 'committed'); assert.equal(observed.order.id, result.order.id);
  assert.equal(observed.payment, 'not_inferred'); assert.equal(h.state.commits, 1);
  assert.deepEqual(h.state.records.aiTaskOriginalRequest.find(row => row.id === h.selection.originalInputRef), originalInput);
  assert.deepEqual(h.state.records.aiTaskQuoteSelection.find(row => row.id === h.selection.selectionId), originalSelection);
  assert.equal(h.diagnostics(), 0);
});

test('AIN15 original human reprepare denies forged bindings and revoked rights without another proposal or order', { timeout: 60000 }, async () => {
  const h = await retainedHumanReprepareSetup(), clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
  const input = { selection: h.selection, command: h.command }, before = clone(h.state.records);
  await assert.rejects(h.requests.reprepareSelectedProposal(h.request, { ...input, lease: {} }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.requests.reprepareSelectedProposal(h.request, { ...input, selection: { ...h.selection,
    runId: '00000000-0000-4000-8000-000000000001' } }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(h.requests.reprepareSelectedProposal(h.request, { ...input,
    command: { ...h.command, replacement: { ...h.command.replacement, fingerprint: '0'.repeat(64) } } }),
    error => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(error.code));
  assert.deepEqual(h.state.records, before);
  h.state.user.permissions = h.state.user.permissions.filter(permission => permission !== 'rental-os:order:create');
  const denied = clone(h.state.records);
  await assert.rejects(h.requests.reprepareSelectedProposal(h.request, input), error => error.code === 'AI_ACCESS_DENIED' || error.getStatus?.() === 403);
  assert.deepEqual(h.state.records, denied); assert.equal(h.state.records.aiApprovalReprepare.length, 0);
  h.state.session = false;
  await assert.rejects(h.requests.readSelectedReprepareEligibility(h.request, { selection: h.selection,
    request: { draftVersion: 'ain-approval-application-draft-1', original: h.proposal, intent: 'inspect' } }),
    error => error.code === 'AI_ACCESS_DENIED' || error.getStatus?.() === 403);
  assert.deepEqual(h.state.records, denied); assert.equal(h.state.records.rentalOrder.length, 0);
});

// End original-human-reprepare owned cases.
test('selected new human materials reprepare through the formal factory and retain the receipt before a new decision', { timeout: 30000 }, async () => {
  const { selectedReprepareHarness } = require('./fixtures/ai-native/lane-a-selected-order.cjs');
  const { AiHumanQuoteSelectionModule } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.module');
  const h = await selectedReprepareHarness();
  const { credentials, originals, reprepareServices, ...dependencies } = h.dependencies;
  Object.assign(dependencies, { creationRules: h.configuration.creationRules,
    memberships: { listPersonalOptions: async () => [],
      listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } });
  const options = { enabled: true, audience: 'operator' };
  const module = AiHumanQuoteSelectionModule.registerHttpApplication(dependencies, options, h.configuration);
  const { AiHumanQuoteOrderController, AI_HUMAN_QUOTE_ORDER_REQUESTS } = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller');
  const app = new AiHumanQuoteOrderController(module.providers.find(p => p.provide === AI_HUMAN_QUOTE_ORDER_REQUESTS).useFactory());
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  assert.equal(app.submitSelectedOrder, undefined);
  assert.throws(() => AiHumanQuoteSelectionModule.registerRequestBoundApplication({ ...dependencies, reprepareServices }, options, h.configuration)
    .providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await app.decideSelectedProposal(request, { selection: h.selection, proposal: { ...h.proposal, decision: 'reject' } });
  const input = { selection: h.selection, command: h.command };
  await assert.rejects(h.compose().reprepareSelectedProposal(input), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(app.reprepareSelectedProposal(request, { ...input, lease: {} }), e => e.getStatus() === 400);
  await assert.rejects(app.reprepareSelectedProposal({ headers: {} }, input), e => e.getStatus() === 403);
  h.state.reprepareAckLost = true;
  await assert.rejects(app.reprepareSelectedProposal(request, input), e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN'
    && e.getResponse().retryable === false && e.getResponse().nextAction === 'read_reprepare_receipt');
  h.state.reprepareAckLost = false;
  const result = await app.readSelectedReprepareReceipt(request, input);
  assert.equal(result.receipt.state, 'prepared', JSON.stringify(h.state.failures));
  assert.equal(result.order, 'not_created_by_reprepare');
  assert.deepEqual(result.replacement.selection, h.replacementSelection);
  assert.equal(result.replacement.review.generatedText, null); assert.equal(result.replacement.review.facts, undefined);
  assert.equal(result.replacement.review.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(h.state.records.aiProposal.find(row => row.id === h.proposal.proposalId).status, 'SUPERSEDED');
  assert.equal(h.state.records.aiApprovalReprepare.length, 1); assert.equal(h.state.records.aiTaskOriginalRequest.length, 2);
  assert.equal(h.state.records.aiTaskQuoteSelection.length, 2); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.deepEqual(await app.reprepareSelectedProposal(request, input), result);
  const approved = await app.decideSelectedProposal(request, { selection: result.replacement.selection,
    proposal: { ...result.receipt.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' } });
  assert.equal(approved.approval.decision, 'approved'); assert.equal(approved.order, 'not_created_by_decision');
  assert.equal(h.state.records.aiApproval.length, 2); assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApprovalReprepare.length, 1);
  h.state.session = false;
  await assert.rejects(app.readSelectedReprepareReceipt(request, input), e => [403, 404].includes(e.getStatus()));
});

test('lost selection acknowledgement reconciles exact key and mutated quote cannot prove old input', { timeout: 30000 }, async () => {
  const h = await harness();
  h.control.beforeCommit = async draft => { if (draft.aiTaskQuoteSelection.length && !h.state.aiTaskQuoteSelection.length) h.control.loseReply = true; };
  await assert.rejects(h.selections.select(h.command), e => {
    assert.equal(e.code, 'AI_RESULT_UNKNOWN');
    assert.equal(e.retryable, false);
    assert.equal(e.cause.operation, 'quote_selection');
    assert.equal(e.cause.phase, 'callback_ready');
    assert.equal(e.cause.errorName, 'Error');
    assert.ok(e.cause.elapsedMs >= 0);
    assert.equal(Object.getOwnPropertyDescriptor(e, 'cause').enumerable, false);
    assert.equal(JSON.stringify(e).includes('cause'), false);
    assert.equal(JSON.stringify(e.cause).includes('COMMIT reply'), false);
    return true;
  });
  assert.equal((await h.selections.reconcile(h.command)).state, 'observed');
  h.quote.ruleVersion = 'changed';
  await assert.rejects(h.selections.reconcile(h.command), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.aiTaskQuoteSelection.length, 1);
});

test('selection callback readiness is not COMMIT and receipt construction failures roll back', { timeout: 30000 }, async () => {
  const h = await harness();
  const { Prisma } = require('@prisma/client');
  const raw = new Prisma.PrismaClientKnownRequestError('Synthetic sensitive SQL and input must not escape', {
    code: 'P2028', clientVersion: '5.22.0', meta: { query: 'sensitive query', input: 'sensitive input' }
  });
  h.control.beforeCommit = async draft => { if (draft.aiTaskQuoteSelection.length) throw raw; };
  let observedError;
  await assert.rejects(h.repository.select(h.command), error => {
    observedError = error;
    assert.equal(error.code, 'AI_RESULT_UNKNOWN');
    assert.equal(error.retryable, false);
    assert.equal(error.cause.phase, 'callback_ready');
    assert.equal(error.cause.errorCode, 'P2028');
    assert.equal(error.cause.errorName, 'PrismaClientKnownRequestError');
    assert.equal(JSON.stringify(error.cause).includes('sensitive'), false);
    assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
    return true;
  });
  assert.equal(h.state.aiTaskQuoteSelection.length, 0);
  h.control.beforeCommit = null;
  assert.deepEqual(await h.repository.reconcile(h.command), { state: 'not_observed', retryable: false });
  const Controller = require('../apps/api/src/modules/ai-native/task-request/human-quote-selection.controller').AiHumanQuoteSelectionController;
  await assert.rejects(new Controller({ select: async () => { throw observedError; } }).select({}, h.command), error => {
    assert.deepEqual(error.getResponse(), { code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: 'reconcile' });
    return true;
  });
  const failedReceipt = await harness();
  failedReceipt.repository.receipt = () => { throw new RangeError('Synthetic sensitive receipt body'); };
  await assert.rejects(failedReceipt.repository.select(failedReceipt.command), error => {
    assert.equal(error.code, 'AI_STORAGE_UNAVAILABLE');
    assert.equal(error.cause.phase, 'building_receipt');
    assert.equal(error.cause.errorName, 'RangeError');
    assert.equal(JSON.stringify(error.cause).includes('sensitive'), false);
    return true;
  });
  assert.equal(failedReceipt.state.aiTaskQuoteSelection.length, 0);
});

test('human quote selection binds consumed model answers and prevents a competing model plan', { timeout: 60000 }, async () => {
  for (const mode of ['reject', 'approve', 'lost_commit', 'cancel', 'enterprise_approve']) {
  const decision=mode==='reject'?'reject':'approve';
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h=await originalModelApplicationHarness('quote_clarification',undefined,{customerType:'personal'},
    [{code:'rental.order.commit',version:require('./fixtures/ai-native/local-shared.cjs').AI_TOOL_DRAFT_VERSION}]);
  const policy=h.state.aiTaskPlanPolicy.find(row=>row.sceneCode==='quote_clarification');
  const app=h.model.createApplication({holderId:'clarified-choice',leaseMs:100000},{...h.run,inputSource:'original_scene'});
  assert.equal((await app.start(h.reference)).execution.outcome.status,'paused');
  const pending=await app.readInput(h.reference);
  const submission={draftVersion:require('./fixtures/ai-native/local-shared.cjs').AI_TASK_INPUT_DRAFT_VERSION,
    taskId:h.created.task.taskId,requestId:pending.requestId,expectedRevision:pending.revision,submissionKey:'choose-successor',
    answers:pending.contract.fields.map(field=>({fieldId:field.fieldId,value:field.kind==='choice'?field.options[0].value:
      field.kind==='integer'?1:field.fieldId==='starts_at'?'2027-02-01T00:00:00.000Z':
      field.fieldId==='ends_at'?'2027-02-02T00:00:00.000Z':'Explicit human answer'}))};
  await app.resume({original:h.reference,submission},AbortSignal.abort());
  const received={receipt:await app.readAnswer({original:h.reference,submission})};
  const quoted=await harness(false,true,mode==='enterprise_approve');
  Object.assign(h.state, {
    customerProfile: structuredClone([quoted.b.membershipRows.customer, ...quoted.b.membershipRows.corporateCustomers]),
    customerMembership: structuredClone([quoted.b.membershipRows.link, ...quoted.b.membershipRows.corporateLinks]),
    customerQualificationRef: [], customerMembershipQualificationType: [], customerMembershipPlanAssignment: [],
    customerCorporateMembership: structuredClone(quoted.b.membershipRows.bookingOptions)
  });
  // The transaction client exposes only explicitly declared tables; rebuild its
  // delegates over these original membership facts, preserving the same store.
  const membershipDb = quoted.b.memberships.prisma;
  const decorateMembership = tx => Object.assign(tx, ...['customerProfile', 'customerMembership', 'customerQualificationRef',
    'customerMembershipQualificationType', 'customerMembershipPlanAssignment', 'customerCorporateMembership'].map(name => ({ [name]: membershipDb[name] })));
  const transactionWithMembership = h.db.$transaction.bind(h.db);
  h.db.$transaction = (work, ...options) => transactionWithMembership(tx => work(decorateMembership(tx)), ...options);
  quoted.b.facts.listAssets = async () => [1,2].map(index => ({id:`asset-${index}`,tenantId:'tenant_001',workspaceId:'workspace-a',
    itemGroupId:quoted.b.group.id,locationId:quoted.b.location.id,status:'available'}));
  // Only persistence is simulated: preparation and inventory decisions use Rental Core.
  const coreFacts=Object.assign(quoted.b.facts,{
    findOrder:async (tenant,id,tx)=> (tx??h.db).rentalOrder.findFirst({where:{tenantId:tenant,id}}),
    countOrders:async (tenant)=>(await h.db.rentalOrder.findMany({where:{tenantId:tenant}})).length,
    allocateOrderNumber:async () => `RC260101${String((await h.db.rentalOrder.findMany({})).length + 1).padStart(4, '0')}`,
    saveOrderAggregate:async (order,_lines,tx)=>tx.rentalOrder.create({data:{...structuredClone(order),
      workspaceId:require('../apps/api/src/common/request-identity').getRequestWorkspaceId()}})});
  await h.db.rentalQuote.create({data:{id:quoted.quote.id,tenantId:quoted.quote.tenantId,
    snapshot:structuredClone(quoted.quote),consumedAt:null,consumedOrderId:null}});
  const quoteFacts={
    findQuote:async (tenant,id,tx)=>{const row=await (tx??h.db).rentalQuote.findFirst({where:{tenantId:tenant,id}});
      return row?{...row.snapshot,...(row.consumedAt?{consumedAt:row.consumedAt,consumedOrderId:row.consumedOrderId}:{})}:null;},
    consumeQuoteIfAvailable:async (tenant,id,orderId,at,tx)=>(await tx.rentalQuote.updateMany({
      where:{tenantId:tenant,id,consumedAt:null},data:{consumedAt:at,consumedOrderId:orderId}})).count===1};
  const {RentalIdempotencyRepository}=require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const confirmation=new RentalOrderConfirmationService(h.db,quoted.b.core,quoted.b.business,coreFacts,quoteFacts,
    new RentalIdempotencyRepository(h.db),undefined,undefined,undefined,undefined,quoted.b.memberships);
  const coreErrors=[],createApprovedOrder=confirmation.createApprovedOrder.bind(confirmation);
  confirmation.createApprovedOrder=async (...args)=>{try{return await createApprovedOrder(...args);}
    catch(error){coreErrors.push(error.stack);throw error;}};
  const dependencies={...h.dependencies,originals:h.model.scenes.requests,
    scene:{code:'quote_clarification',version:'1'},
    core:quoted.b.core,business:quoted.b.business,memberships:quoted.b.memberships,confirmation, quoteFacts};
  // The quoted fact is an actual Core quote; only its repository read is a DB substitute.
  const repository=new PrismaQuoteSelectionRepository(dependencies);
  const command={...quoted.command,originalInputRef:h.reference.inputRef,taskId:h.created.task.taskId,
    runId:received.receipt.runId,selectionKey:'clarified-choice'};
  await assert.rejects(repository.select({...command,runId:require('node:crypto').randomUUID()}),e=>e.code==='AI_ACCESS_DENIED');
  const selected=await repository.select(command);
  assert.equal(selected.receipt.runId,received.receipt.runId);assert.equal(selected.receipt.approval,'not_granted');
  assert.equal(h.state.aiTaskQuoteSelection.length,1);
  assert.equal((await repository.reconcile(command)).receipt.selectionId,selected.receipt.selectionId);
  await assert.rejects(app.continueAnswer({original:h.reference,submission}),e=>e.code==='AI_REVISION_CONFLICT');
  assert.equal(h.state.aiTaskRunPlan.some(row=>row.runId===received.receipt.runId),false);
  assert.equal(h.execution.sent.length,1);
  const {composeSelectedQuoteTaskApplication}=require('../apps/api/src/modules/ai-native/scenes/human-quote-order.composition');
  const selection={draftVersion:selected.receipt.draftVersion,originalInputRef:selected.receipt.originalInputRef,
    selectionId:selected.receipt.selectionId,taskId:selected.receipt.taskId,runId:selected.receipt.runId,inputHash:selected.receipt.inputHash};
  const limits=structuredClone(policy.limits);let ticks=0;
  const orderTask=composeSelectedQuoteTaskApplication(dependencies,{host:{holderId:'clarified-order',leaseMs:100000},limits,monotonic:()=>++ticks});
  const started=await orderTask.start({selection});
  assert.equal(started.outcome.status,'paused',JSON.stringify(started));
  assert.equal(h.state.aiTaskExecutionBudget.length,1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
  const step=h.state.aiStep.find(row=>row.runId===selection.runId);
  const waiting=await orderTask.readConfirmation({selection,stepId:step.id});
  assert.equal(waiting.execution,'not_attested');
  assert.equal(h.state.aiApproval.length,0);
  h.state.aiTaskActionPolicy.push({scopeId:'scope-a',taskId:selection.taskId,operation:'decide_approval',revision:1,
    requiredPermissions:['rental-os:order:create'],expiresAt:new Date('2027-01-01')});
  const human=composeHumanQuoteOrder(dependencies);
  if(mode==='cancel') {
    const cancelled=await orderTask.requestCancel({selection,expectedRevision:h.state.aiTask[0].revision});
    assert.equal(cancelled.cancellation,'requested_not_rollback');
    await assert.rejects(human.decideSelectedProposal({selection,proposal:{...waiting.proposal,decision:'approve'}}));
    const phases=structuredClone(h.state.aiTaskExecutionPhaseReceipt);
    h.state.aiTaskExecutionPhaseReceipt=h.state.aiTaskExecutionPhaseReceipt.filter(row=>row.stepId!==step.id);
    try {
      const withoutEvidence=await orderTask.reconcile({selection});
      assert.notEqual(withoutEvidence.outcome?.status,'cancelled');
      assert.equal(h.state.aiTask[0].status,'CANCEL_REQUESTED');
      assert.equal(h.state.rentalOrder.length,0);
    } finally {h.state.aiTaskExecutionPhaseReceipt=phases;}
    const stopped=await orderTask.reconcile({selection});
    assert.equal(stopped.outcome?.status,'cancelled',JSON.stringify(stopped));
    assert.equal(h.state.aiTask[0].status,'CANCELLED');
    assert.equal(h.state.rentalOrder.length,0);
    assert.equal(h.state.aiApprovalConsumption.length,0);
    assert.equal(h.state.aiTaskExecutionBudget.length,1);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
    assert.equal(h.execution.sent.length,1);
    continue;
  }
  const reviewed=await human.readSelectedProposal({selection,proposal:waiting.proposal});
  assert.equal(reviewed.deterministic.order.customer.id,'customer-a');
  const declined=await human.decideSelectedProposal({selection,proposal:{...waiting.proposal,decision,
    ...(decision==='approve'?{reviewVersion:reviewed.draftVersion}:{})}});
  assert.equal(declined.approval.decision,decision==='approve'?'approved':'rejected');
  if(mode==='lost_commit') h.control.beforeCommit=async draft=>{
    if(draft.rentalOrder.length===1 && h.state.rentalOrder.length===0) {
      h.control.loseReply=true; h.control.beforeCommit=null;
    }
  };
  let finished=await orderTask.continueConfirmation({selection,checkpointRef:waiting.checkpointRef});
  if(mode==='lost_commit') {
    assert.equal(finished.outcome?.status,'unknown',JSON.stringify({finished,coreErrors}));
    assert.equal(h.state.rentalOrder.length,1);
    assert.equal((await orderTask.readResult({selection})).status,'committed');
    finished=await orderTask.reconcile({selection});
  }
  assert.equal(finished.outcome?.status,decision==='approve'?'succeeded':'partially_succeeded',JSON.stringify({finished,coreErrors}));
  assert.equal(h.state.aiStep.find(row=>row.runId===selection.runId).status,decision==='approve'?'SUCCEEDED':'FAILED');
  assert.equal(h.state.aiStep.find(row=>row.runId===selection.runId).effect,decision==='approve'?'COMMITTED':'NONE');
  assert.equal(h.state.aiTaskExecutionBudget.length,1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
  assert.equal(h.state.aiApprovalConsumption.length,decision==='approve'?1:0);
  assert.equal(h.state.rentalOrder.length,decision==='approve'?1:0);
  if(decision==='approve') {
    if(mode==='enterprise_approve') {
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.bookingIdentity,'enterprise_employee');
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.corporateCustomerId,'company-a');
      assert.equal(h.state.rentalOrder[0].membershipSnapshot.personalCustomerId,'customer-a');
    }
    const originalResult=await orderTask.readResult({selection});
    assert.equal(originalResult.status,'committed');
    assert.deepEqual(await orderTask.readResult({selection}),originalResult);
    assert.equal(h.state.rentalOrder.length,1);
    assert.equal(h.state.rentalOrderIdempotencyRecord.length,1);
    assert.equal(h.state.aiApprovalConsumption.length,1);
    assert.equal(h.state.rentalOrderIdempotencyRecord[0].orderId,h.state.rentalOrder[0].id);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
    const {composeAiTaskCenterScene}=require('../apps/api/src/modules/ai-native/task-center-scene.composition');
    const center=composeAiTaskCenterScene({list:{readPage:async()=>{throw Error('not used');}},
      scenes:h.model.scenes,selections:repository,orders:orderTask});
    const displayed=await center.readOrderResult({original:h.reference,reference:{selection}});
    assert.equal(displayed.result.order.id,h.state.rentalOrder[0].id);
    assert.equal(displayed.runId,selection.runId);
    assert.equal(h.state.rentalOrder.length,1);
    if(mode==='approve') {
      const aggregate=await center.readScene({kind:'original',taskId:selection.taskId,runId:selection.runId,
        original:h.reference,order:{selection}});
      assert.equal(aggregate.business.result.order.id,h.state.rentalOrder[0].id);
      assert.equal(aggregate.originRunId,h.created.task.runId);
      assert.equal(aggregate.pendingInput.availability,'not_requested');
      const { validateAiTaskSceneObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
      assert.deepEqual(validateAiTaskSceneObservation(aggregate), aggregate);
      await assert.rejects(center.readScene({kind:'original',taskId:selection.taskId,runId:h.created.task.runId,
        original:h.reference,order:{selection}}),error=>error.code==='AI_ACCESS_DENIED');
      await assert.rejects(center.readOrderResult({original:h.reference,reference:{selection:{...selection,
        runId:require('node:crypto').randomUUID()}}}),error=>error.code==='AI_ACCESS_DENIED');
      const noSelectionReader=composeAiTaskCenterScene({list:{readPage:async()=>{throw Error('not used');}},
        scenes:h.model.scenes,orders:orderTask});
      await assert.rejects(noSelectionReader.readOrderResult({original:h.reference,reference:{selection}}),
        error=>error.code==='AI_RESOURCE_UNAVAILABLE');
      assert.equal(h.state.rentalOrder.length,1);
      // Actual retention transaction: ordinary dialogue/answers/history copies
      // expire while the original selected approval and Core receipt stay readable.
      const { AiRetentionService } = require('../apps/api/src/modules/ai-native/privacy/retention.service');
      h.b.h.identity.user.permissions.push('system:params:manage');
      h.b.h.control.now = Math.max(h.b.h.control.now, h.state.aiTask[0].updatedAt.getTime()) + 31 * 86400000;
      const privacy = new AiRetentionService(h.db, h.dependencies.auth, h.dependencies.credentials, undefined, h.dependencies.clock);
      const bodyCount = h.state.aiTaskResultArtifact.length, originalHash = h.state.aiTaskOriginalRequest[0].contentHash;
      // Persisted history fixture deliberately crosses five 200-row pages;
      // sensitive refresh copies must not survive at the old 1,000-row boundary.
      const retainedTask = h.state.aiTask.find(row => row.id === selection.taskId);
      for (let index = 0; index < 1001; index++) h.state.aiTaskEvent.push({ scopeId: retainedTask.scopeId,
        taskId: retainedTask.id, cursor: ++retainedTask.eventCursor, taskRevision: retainedTask.revision,
        type: 'task.input_refreshed', occurredAt: h.dependencies.clock(), payload: {
          data: { requestId: pending.requestId, previousRevision: 1, revision: 2 },
          previousRequest: { sensitive: 'Synthetic previous customer/address text' } } });
      const erased = await privacy.erase('task', selection.taskId);
      assert.equal(erased.state, 'erased');
      const erasedRevision = h.state.aiTask[0].revision;
      assert.equal((await privacy.erase('task', selection.taskId)).state, 'erased');
      assert.equal(h.state.aiTask[0].revision, erasedRevision);
      assert.equal(h.state.aiTask[0].archivedAt, null);
      assert.equal(h.state.aiTaskOriginalRequest[0].payload.retention, 'erased');
      assert.equal(h.state.aiTaskOriginalRequest[0].contentHash, originalHash);
      assert.equal(h.state.aiTaskResultArtifact.length, bodyCount);
      assert.ok(h.state.aiTaskResultArtifact.filter(row => row.runId === h.created.task.runId).every(row => row.payload.retention === 'erased'));
      assert.ok(h.state.aiTaskInputReceipt.every(row => row.answers.length === 0));
      assert.ok(h.state.aiTaskInputRequest.every(row => row.allowedFields.length === 0));
      assert.ok(h.state.aiTaskEvent.every(row => row.payload.previousRequest === undefined));
      const terminal = await orderTask.readConfirmation({ selection, stepId: step.id });
      assert.equal(terminal.state, 'not_waiting'); assert.equal(terminal.history.transitions.length, 2);
      assert.equal((await orderTask.readResult({ selection })).order.id, h.state.rentalOrder[0].id);
      assert.equal((await center.readOrderResult({ original: h.reference, reference: { selection } })).result.order.id, h.state.rentalOrder[0].id);
      const retainedScene = await center.readScene({ kind: 'original', taskId: selection.taskId, runId: selection.runId,
        original: h.reference, order: { selection } });
      assert.deepEqual(validateAiTaskSceneObservation(retainedScene), retainedScene);
      assert.equal(retainedScene.business.result.order.id, h.state.rentalOrder[0].id);
      await assert.rejects(h.model.scenes.requests.readHistorical(h.reference));
      await assert.rejects(repository.readAuthorized(selection));
      const erasedState = require('./fixtures/ai-native/task-input-store.cjs').clone(h.state);
      await assert.rejects(orderTask.start({ selection }));
      assert.deepEqual(h.state, erasedState); assert.equal(h.state.rentalOrder.length, 1);
    }
  }
  assert.equal(h.execution.sent.length,1);
  }
});

// Same original Core scenario, now consumed through canonical frontend transport/session.
test('AIN15 conversation selected quote uses explicit original references and resumes lost selection and host replies before one Core order', { timeout: 180000 }, async () => {
  await exerciseMultilineApprovedConsumer(false, false, false, false, false, 'camera', false, false, false, false, false, 'conversation_consumer');
});
