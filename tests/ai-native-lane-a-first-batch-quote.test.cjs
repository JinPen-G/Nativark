'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

test('AIN15 resolved end date changes invalidate the original candidate revision before a new Core quote', async () => {
  const h = await setup('camera', true);
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  let now = '2026-11-06T15:59:59.000Z'; // Asia/Shanghai: just before the trusted local-day boundary.
  const tools = composeAiAuthorizedBusinessTools({ core: h.core, business: h.business, memberships: h.memberships,
    reports: h.reports, guard: new ApiAuthGuard(h.h.authorization.auth, undefined, undefined, undefined, {}),
    credentials: h.h.authorization.credentials, clock: () => new Date(now) });
  h.facts.listAssets = async () => [{ id: 'period-binding-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a',
    itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const candidate = { ...h.candidate, bookingIdentity: { bookingIdentity: 'personal' },
    start: '2026-11-08T00:00:00.000Z', end: '后天 09:00' }, original = structuredClone(candidate);
  const first = await tools.quote.candidates.prepare(candidate);
  assert.equal(first.status, 'needs_confirmation');
  assert.equal(first.request.startAt, '2026-11-08T00:00:00.000Z');
  assert.equal(first.request.endAt, '2026-11-08T01:00:00.000Z');
  const absolute = { ...candidate, end: first.request.endAt };
  const absoluteBefore = await tools.quote.candidates.prepare(absolute);
  assert.equal(absoluteBefore.status, 'needs_confirmation');
  const oldSelection = { ...candidate, selectionRevision: first.selectionRevision }, oldImage = structuredClone(oldSelection);
  now = '2026-11-06T16:00:01.000Z';
  const next = await tools.quote.candidates.prepare(oldSelection);
  assert.notEqual(next.selectionRevision, first.selectionRevision,
    'the resolved end changes across a trusted local-day boundary even when the start, words, rates and resources stay identical');
  assert.equal(next.status, 'missing_input'); assert.ok(next.missingFields.includes('selectionRevision'));
  const absoluteAfter = await tools.quote.candidates.prepare({ ...absolute, selectionRevision: absoluteBefore.selectionRevision });
  assert.equal(absoluteAfter.status, 'needs_confirmation');
  assert.equal(absoluteAfter.selectionRevision, absoluteBefore.selectionRevision, 'clock metadata alone is not a revision');
  assert.deepEqual(absoluteAfter.request, absoluteBefore.request);
  assert.equal(absoluteAfter.request.endAt, absoluteBefore.request.endAt);
  const create = h.business.createQuote, beforeWrites = h.businessFacts.writes.length;
  let attempts = 0;
  h.business.createQuote = async function(...args) { attempts++; return create.apply(this, args); };
  try {
    const blocked = await tools.quote.previewSelection(oldSelection);
    assert.equal(blocked.status, 'missing_input'); assert.ok(blocked.missingFields.includes('selectionRevision'));
    assert.equal(attempts, 0); assert.equal(h.businessFacts.writes.length, beforeWrites);
    const selected = { ...candidate, selectionRevision: next.selectionRevision };
    const review = await tools.quote.candidates.prepare(selected);
    assert.equal(review.status, 'needs_confirmation');
    assert.equal(review.request.startAt, first.request.startAt); assert.equal(review.request.endAt, '2026-11-09T01:00:00.000Z');
    // Use the real fixture execution day for Core persistence; the relative
    // end still resolves to the explicitly reviewed November 9 period.
    now = new Date().toISOString();
    const quoted = await tools.quote.previewSelection(selected);
    assert.equal(quoted.status, 'quoted'); assert.equal(quoted.quotePersistence, 'saved');
    assert.equal(attempts, 1); assert.equal(quoted.quote.reservation, 'not_reserved');
    assert.deepEqual(quoted.quote.period, { startAt: review.request.startAt, endAt: review.request.endAt });
    assert.equal(h.businessFacts.writes.some(row => /order|reservation/iu.test(row.kind)), false);
    assert.deepEqual(candidate, original); assert.deepEqual(oldSelection, oldImage);
    h.h.identity.user.permissions = [];
    await assert.rejects(tools.quote.candidates.prepare(selected));
    assert.equal(attempts, 1);
  } finally { h.business.createQuote = create; }
});

test('AIN15 explicit enterprise absent from a partial page remains unconfirmed without replacement or eligibility inference', async () => {
  const h = await setup('camera', true), at = new Date('2020-01-01T00:00:00Z');
  const options = Array.from({ length: 51 }, (_, index) => ({ id: `page-relation-${String(index).padStart(3, '0')}`,
    tenantId: 'tenant_001', personalCustomerId: 'customer-a', corporateCustomerId: `page-company-${index}`,
    corporateCustomer: { name: `Declared page company ${index}` }, role: 'employee', status: 'active',
    effectiveFrom: at, effectiveTo: null }));
  // Explicit relationship projection leaves, not SQL filtering or a claim that
  // the absent selected company has passed Core qualification/credit checks.
  h.membershipRows.bookingOptions = options;
  const selected = { ...h.candidate, bookingIdentity: { bookingIdentity: 'enterprise_employee',
    corporateCustomerId: 'page-company-0', enterpriseContractAndPayer: true } }, original = structuredClone(selected);
  const create = h.business.createQuote, writes = h.businessFacts.writes.length;
  let attempts = 0;
  h.business.createQuote = async function(...args) { attempts++; return create.apply(this, args); };
  try {
    const result = await h.tools.quote.businessPreparation.prepareUnified(selected);
    assert.equal(result.status, 'missing_input');
    const clarification = result.clarifications.find(row => row.field === 'bookingIdentity.corporateCustomerId');
    assert.equal(clarification.reason, 'selected_enterprise_not_observed_in_bounded_page');
    assert.equal(clarification.action, 'use_original_qualification_flow');
    assert.deepEqual(clarification.candidates, [], 'a partial prefix must not propose a different selected enterprise');
    assert.equal(clarification.truncated, true);
    assert.equal((await h.tools.quote.previewSelection(selected)).status, 'missing_input');
    assert.equal(attempts, 0); assert.equal(h.businessFacts.writes.length, writes); assert.deepEqual(selected, original);
    assert.ok(h.membershipRows.bookingQueries.every(query => query.take === 51 && !query.where.id),
      'the consumer does not chase another cursor to find/approve the selected company');
    const shared = require('@rental-os/shared');
    const definitions = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS') || name.endsWith('_SCHEMAS_V2')).map(([, value]) => value));
    const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(shared.AI_SCENE_QUOTE_HTTP_SCHEMAS, definitions);
    assert.equal(validators.AiSceneQuotePreparationDraft(result), true, JSON.stringify(validators.AiSceneQuotePreparationDraft.errors));
    const unspecified = structuredClone(selected); delete unspecified.bookingIdentity.corporateCustomerId;
    const choices = await h.tools.quote.businessPreparation.prepareUnified(unspecified);
    const missing = choices.clarifications.find(row => row.field === 'bookingIdentity.corporateCustomerId');
    assert.equal(missing.reason, 'current_authorized_enterprise_choice_required'); assert.ok(missing.candidates.length > 0);
    h.membershipRows.bookingOptions = [options[50]];
    const complete = await h.tools.quote.businessPreparation.prepareUnified(selected);
    const absent = complete.clarifications.find(row => row.field === 'bookingIdentity.corporateCustomerId');
    assert.equal(absent.reason, 'current_authorized_enterprise_choice_required'); assert.equal(absent.truncated, false);
    assert.equal(attempts, 0); assert.deepEqual(selected, original);
    h.h.identity.user.permissions = [];
    await assert.rejects(h.tools.quote.businessPreparation.prepareUnified(selected));
    assert.equal(attempts, 0);
  } finally { h.business.createQuote = create; }
});

test('enterprise booking options use the original guarded member and bounded relationship query without selecting', async () => {
  const h = await setup();
  h.membershipRows.bookingOptions = ['relation-c','relation-b','relation-a'].map(id=>({
    id, corporateCustomerId:`company-${id}`, corporateCustomer:{name:`Company ${id}`}, role:'employee', effectiveTo:null,
    privateData:'must-not-project'
  }));
  const first = await h.tools.quote.bookingIdentityOptions({customerId:'customer-a',limit:2});
  assert.equal(first.options.length,2);assert.equal(first.truncated,true);assert.equal(first.nextCursor,'relation-b');
  assert.equal(first.qualification,'not_evaluated');assert.equal(first.execution,'not_attempted');
  assert.equal(first.options[0].privateData,undefined);
  assert.deepEqual(h.membershipRows.bookingQueries[0].where.tenantId,'tenant_001');
  assert.equal(h.membershipRows.bookingQueries[0].where.personalCustomerId,'customer-a');
  assert.equal(h.membershipRows.bookingQueries[0].where.status,'active');
  assert.equal(h.membershipRows.bookingQueries[0].take,3);
  assert.deepEqual(h.membershipRows.bookingQueries[0].orderBy,[{id:'desc'}]);
  const next = await h.tools.quote.bookingIdentityOptions({customerId:'customer-a',limit:2,cursor:first.nextCursor});
  assert.deepEqual(next.options.map(row=>row.corporateMembershipId),['relation-a']);
  assert.equal(next.truncated,false);assert.equal(next.nextCursor,undefined);
  assert.equal(h.businessFacts.writes.length,0);
  await assert.rejects(h.tools.quote.bookingIdentityOptions({customerId:'customer-a',limit:2,workspaceId:'other'}));
  const count = h.membershipRows.bookingQueries.length;
  h.h.identity.user.permissions=[];
  await assert.rejects(h.tools.quote.bookingIdentityOptions({customerId:'customer-a',limit:2}));
  assert.equal(h.membershipRows.bookingQueries.length,count);
});
test('enterprise identity uses current authorized options and real Core membership resolution without granting approval', async () => {
  const h=await setup('camera',true), corporateId='company-a';
  h.membershipRows.corporateCustomers=[{id:corporateId,tenantId:'tenant_001',customerType:'corporate',name:'Synthetic enterprise'}];
  h.membershipRows.corporateLinks=[{tenantId:'tenant_001',customerId:corporateId,status:'active'}];
  h.membershipRows.bookingOptions=[{id:'relationship-a',tenantId:'tenant_001',personalCustomerId:'customer-a',
    corporateCustomerId:corporateId,corporateCustomer:{name:'Synthetic enterprise'},role:'employee',status:'active',
    effectiveFrom:new Date('2020-01-01T00:00:00Z'),effectiveTo:null}];
  // Enterprise intent is not a selected company or a payer decision.
  const candidate={...h.candidate,bookingIdentity:{bookingIdentity:'enterprise_employee'}};
  const withoutCustomer={...candidate};delete withoutCustomer.customerId;
  const customerFirst=await h.tools.quote.candidates.prepare(withoutCustomer);
  assert.equal(customerFirst.status,'missing_input');
  assert.ok(customerFirst.clarifications.some(row=>row.field==='customerId'&&row.candidates.some(option=>option.id==='customer-a')));
  const first=await h.tools.quote.candidates.prepare(candidate);
  assert.equal(first.status,'missing_input');assert.ok(first.missingFields.includes('selectionRevision'));
  const {originalQuoteAnswerContract,applyOriginalQuoteAnswers}=require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const contract=originalQuoteAnswerContract(candidate,first,'补充预约资料');
  assert.ok(contract.fields.some(row=>row.fieldId==='enterprise_selection'));
  assert.ok(contract.fields.some(row=>row.fieldId==='enterprise_payer_selection'));
  const answers=contract.fields.filter(row=>row.kind==='choice').map(row=>({fieldId:row.fieldId,value:row.options[0].value}));
  const selected=applyOriginalQuoteAnswers(candidate,[{contract,answers}]);
  const selectedIdentity={bookingIdentity:'enterprise_employee',corporateCustomerId:corporateId,enterpriseContractAndPayer:false};
  assert.deepEqual(selected.bookingIdentity,selectedIdentity);
  await assert.rejects(async()=>applyOriginalQuoteAnswers(candidate,[{contract,answers:answers.map(row=>row.fieldId==='enterprise_selection'?{...row,value:'unoffered-company'}:row)}]));
  const prepared=await h.tools.quote.candidates.prepare(selected);
  // Answers change the candidate fingerprint: the old revision cannot confirm
  // the final request. Re-read the new revision and explicitly reconfirm it.
  assert.equal(prepared.status,'missing_input');assert.ok(prepared.missingFields.includes('selectionRevision'));
  const reconfirmed=await h.tools.quote.candidates.prepare({...selected,selectionRevision:prepared.selectionRevision});
  assert.equal(reconfirmed.status,'needs_confirmation');assert.deepEqual(reconfirmed.request.bookingIdentity,selectedIdentity);
  let resolved=0;const original=h.memberships.resolveBookingIdentity.bind(h.memberships);
  h.memberships.resolveBookingIdentity=async(...args)=>{const snapshot=await original(...args);resolved++;
    assert.equal(snapshot.corporateMembershipId,'relationship-a');assert.equal(snapshot.personalCustomerId,'customer-a');
    assert.equal(snapshot.enterpriseContractAndPayer,args[3].enterpriseContractAndPayer);return snapshot;};
  const preview=await h.tools.quote.previewSelection({...selected,selectionRevision:reconfirmed.selectionRevision});
  assert.equal(preview.status,'quoted');assert.equal(preview.quote.reservation,'not_reserved');assert.equal(resolved,1);
  // Core persistence is allowed for quotes, never inventory ownership or approval.
  assert.equal(h.businessFacts.writes.some(row=>/order|reservation/i.test(row.kind)),false);
  // Existing settlement implementation over a declared empty-credit fixture:
  // per-order enterprise quotes need no invented credit grant. Native MySQL
  // validation separately exercises the same service and actual table reads.
  const {CustomerCorporateSettlementService}=require('../apps/api/src/modules/platform/customer-corporate-settlement.service');
  let creditReads=0;
  h.business.corporateSettlement=new CustomerCorporateSettlementService({customerCorporateCredit:{findFirst:async({where})=>{
    assert.deepEqual(where,{tenantId:'tenant_001',customerId:corporateId});creditReads++;return null;
  }}});
  const corporatePayer={...selected,bookingIdentity:{...selectedIdentity,enterpriseContractAndPayer:true}};
  const changedPayer=await h.tools.quote.candidates.prepare(corporatePayer);
  assert.equal(changedPayer.status,'missing_input');assert.ok(changedPayer.missingFields.includes('selectionRevision'));
  assert.notEqual(changedPayer.selectionRevision,reconfirmed.selectionRevision);
  const confirmedPayer={...corporatePayer,selectionRevision:changedPayer.selectionRevision};
  const payerPreview=await h.tools.quote.previewSelection(confirmedPayer);
  assert.equal(payerPreview.status,'quoted');assert.equal(payerPreview.quote.reservation,'not_reserved');
  assert.equal(resolved,2);assert.equal(creditReads,1);
  assert.equal(h.businessFacts.writes.some(row=>/order|reservation|credit/i.test(row.kind)),false);
  const unknown=await h.tools.quote.candidates.prepare({...selected,bookingIdentity:{...candidate.bookingIdentity,corporateCustomerId:'other'}});
  assert.equal(unknown.status,'missing_input');assert.ok(unknown.missingFields.includes('bookingIdentity.corporateCustomerId'));
  h.membershipRows.bookingOptions=[];
  const withdrawn=await h.tools.quote.candidates.prepare(selected);
  assert.equal(withdrawn.status,'missing_input');assert.ok(withdrawn.missingFields.includes('selectionRevision'));
  assert.equal(resolved,2);
  h.h.identity.user.permissions=[];await assert.rejects(h.tools.quote.candidates.prepare(selected));
});
test('AIN15 preparation retains the original parent binding before Guard waits', async () => {
  for (const operation of ['prepare', 'prepareUnified', 'prepareInput']) {
    const h = await setup(), preparation = h.tools.quote.businessPreparation, authority = preparation.authority;
    const invoke = parent => operation === 'prepareInput' ? preparation.prepareInput(h.candidate, 'not_requested', parent)
      : preparation[operation](h.candidate, parent);
    const parent = await authority.withRead('quote_context', {}, async context => structuredClone(context));
    const originalParent = structuredClone(parent), originalCandidate = structuredClone(h.candidate);
    const actorId = h.h.identity.user.id, writes = h.businessFacts.writes.length;
    const metadataOnly = { ...structuredClone(parent), requestId: 'another-original-read', authorizedAt: '2026-01-01T00:00:00Z' };
    const check = result => {
      const material = operation === 'prepareInput' ? result.payload.facts : result;
      assert.ok(['ready', 'unavailable'].includes(material.status), operation);
      assert.equal(material.quotePersistence, 'not_attempted');
      assert.equal(material.confirmation, 'host_must_verify_explicit_human_selection');
      if (material.sideEffects) assert.deepEqual(material.sideEffects,
        { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
    };
    check(await invoke(metadataOnly));
    let candidateReads = 0, intercepted = false;
    const candidateRead = preparation.candidates.prepare.bind(preparation.candidates), withRead = authority.withRead.bind(authority);
    preparation.candidates.prepare = (...args) => { candidateReads++; return candidateRead(...args); };
    authority.withRead = (kind, query, consume) => {
      if (!intercepted) {
        intercepted = true;
        // Change only the caller-owned server assertion and synthetic current
        // actor at the real Guard's waiting boundary. Do not replace the Guard,
        // produce a fake grant, change workspace/permissions or mutate the task.
        parent.actor.userId = 'different-current-actor'; h.h.identity.user.id = parent.actor.userId;
      }
      return withRead(kind, query, consume);
    };
    try {
      await assert.rejects(invoke(parent), error => error.code === 'FORBIDDEN',
        `${operation}: a mutated parent object is not a new original-request binding`);
      assert.equal(intercepted, true); assert.equal(parent.actor.userId, 'different-current-actor');
      assert.equal(candidateReads, 0, 'reject the changed parent before any candidate/stock observation');
      authority.withRead = withRead;
      // That current actor still has a genuine independent Guard grant. A new
      // request with its own freshly obtained binding works; freezing the old
      // parent is not an extra permission-array gate or a ban on other actors.
      const fresh = await withRead('quote_context', {}, async context => structuredClone(context));
      assert.equal(fresh.actor.userId, 'different-current-actor'); check(await invoke(fresh));
      assert.ok(candidateReads > 0);
      h.h.identity.user.id = actorId; preparation.candidates.prepare = candidateRead;
      check(await invoke(originalParent));
      h.h.identity.user.permissions = [];
      await assert.rejects(invoke(originalParent), error => error.code === 'FORBIDDEN', 'snapshot cannot survive live withdrawal');
      assert.deepEqual(h.candidate, originalCandidate); assert.equal(h.businessFacts.writes.length, writes);
    } finally {
      authority.withRead = withRead; preparation.candidates.prepare = candidateRead; h.h.identity.user.id = actorId;
    }
  }
});

test('unified quote preparation returns the next host step without side effects', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const prepared = await h.tools.quote.businessPreparation.prepareUnified(h.candidate);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.next, 'preview_quote');
  assert.equal(prepared.sideEffects.inventoryReserved, false);
  assert.equal(prepared.sideEffects.orderCreated, false);
});

test('AIN15 answered review and scene preparation cannot switch the original principal', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const preparation = h.tools.quote.businessPreparation;
  const normal = await preparation.reviewAnsweredParameters(h.candidate);
  assert.equal(normal.preparation.status, 'ready');
  assert.equal(normal.sources.status, 'prepared_input_sources');
  assert.equal(normal.humanConfirmation, 'required_before_preview');
  assert.ok(normal.sources.fields.every(field => field.confirmed === false));
  const writes = h.businessFacts.writes.length;
  const unified = preparation.prepareUnified.bind(preparation);
  preparation.prepareUnified = async (...args) => {
    h.h.identity.user.id = 'another-current-reader';
    return unified(...args);
  };
  await assert.rejects(preparation.reviewAnsweredParameters(h.candidate), error => error.code === 'FORBIDDEN');
  h.h.identity.user.id = 'user-a';
  const prepareInput = preparation.prepareInput.bind(preparation);
  preparation.prepareInput = async (...args) => {
    h.h.identity.user.id = 'another-current-reader';
    return prepareInput(...args);
  };
  await assert.rejects(h.tools.scenes.prepareQuoteClarification({ requestKey: 'principal-bound-quote', candidate: h.candidate }), error => error.code === 'FORBIDDEN');
  assert.equal(h.businessFacts.writes.length, writes);
});

test('formal input provenance distinguishes explicit fields and blocks order handoff', async () => {
  const h = await setup();
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const sources = await h.tools.quote.businessPreparation.inputSources({ ...h.candidate, selectionRevision: first.selectionRevision });
  assert.equal(sources.status, 'prepared_input_sources');
  assert.equal(sources.humanConfirmation, 'required_before_preview');
  assert.equal(sources.coreNormalization, 'not_yet_called');
  assert.ok(sources.fields.every(field => field.confirmed === false));
  assert.ok(sources.fields.every(field => !field.kind.startsWith('explicit_user')));
  assert.equal(sources.fields.some(field => field.field === 'bookingIdentity'), false);
  // Supplying the pre-identity revision would mismatch; the fresh candidate is
  // prepared without a stale assertion so provenance reflects the new input.
  const identified = await h.tools.quote.businessPreparation.inputSources({ ...h.candidate,
    bookingIdentity: { bookingIdentity: 'personal' } });
  const identitySource = identified.fields.find(field => field.field === 'bookingIdentity');
  assert.deepEqual(identitySource.value, { bookingIdentity: 'personal' });
  assert.equal(identitySource.kind, 'supplied_candidate');
  assert.equal(identitySource.confirmed, false);
  assert.notEqual(identified.inputFingerprint, sources.inputFingerprint);
  const handoff = await h.tools.quote.commitHandoff({ reference: 'legacy-handoff-reference' });
  assert.equal(handoff.status, 'prepared_not_submitted');
  assert.equal(handoff.stages.quoteSaved, 'unknown');
  assert.equal(handoff.stages.resultUnknown.state, 'unknown');
  assert.equal(handoff.stages.userConfirmedQuote, 'not_attested_by_this_lane_host_selection_evidence_required');
  assert.equal(handoff.stages.humanApproval, 'owned_by_persisted_approval_flow');
  assert.equal(handoff.orderApproval, 'not_granted');
  assert.equal(handoff.execution, 'not_attempted');
});

test('quote comparison reports Core changes without recomputing money or reusing approval', async () => {
  const h = await setup('camera', true);
  h.candidate.bookingIdentity = { bookingIdentity: 'personal' };
  const resolveIdentity = h.memberships.resolveBookingIdentity.bind(h.memberships);
  let resolvedIdentities = 0;
  h.memberships.resolveBookingIdentity = async (...args) => {
    assert.deepEqual(args.slice(0, 3), ['tenant_001', 'workspace-a', 'customer-a']);
    assert.deepEqual(args[3], { bookingIdentity: 'personal' });
    const result = await resolveIdentity(...args);
    assert.equal(result.bookingIdentity, 'personal');
    assert.equal(result.personalCustomerId, 'customer-a');
    resolvedIdentities++;
    return result;
  };
  h.facts.listAssets = async () => [{ id: 'synthetic-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  const first = await h.tools.quote.candidates.prepare(h.candidate);
  const input = { ...h.candidate, selectionRevision: first.selectionRevision };
  const a = await h.tools.quote.previewSelection(input);
  assert.equal(a.status, 'quoted');
  const changed = { ...input, end: '2026-11-12T09:00:00+08:00' };
  const second = await h.tools.quote.candidates.prepare({ ...changed });
  // The new period rebinds the candidate fingerprint: confirm the fresh
  // revision before the second preview.
  assert.equal(second.status, 'missing_input');
  const reconfirmedPeriod = await h.tools.quote.candidates.prepare({ ...changed, selectionRevision: second.selectionRevision });
  assert.equal(reconfirmedPeriod.status, 'needs_confirmation');
  const b = await h.tools.quote.previewSelection({ ...changed, selectionRevision: reconfirmedPeriod.selectionRevision });
  assert.equal(b.status, 'quoted');
  assert.equal(resolvedIdentities, 2);
  const comparison = h.tools.quote.businessPreparation.compareQuotes(a.quote, b.quote);
  assert.equal(comparison.inputChanges.period, true);
  assert.equal(comparison.approvalReuse, 'forbidden_new_quote_requires_new_confirmation');
  assert.equal(comparison.coreAmounts.arithmetic, 'not_recomputed_by_ai_layer');
});

test('AIN15 saved usage changes remain visible in quote comparison without amount arithmetic', async () => {
  const h = await setup(), compare = h.tools.quote.businessPreparation.compareQuotes.bind(h.tools.quote.businessPreparation);
  // Declared saved DISPLAY projections only, not invented Core pricing or a
  // database receipt. The existing real-Core comparison test stays separate.
  const a = { id: 'saved-usage-a', period: { startAt: '2026-11-10T01:00:00Z', endAt: '2026-11-11T01:00:00Z' },
    lineUnits: [{ itemGroupId: 'saved-item-a', quantity: 2, pricingUnit: 'day' },
      { itemGroupId: 'saved-item-b', quantity: 1, pricingUnit: 'usage', usageQuantity: 1.5 }],
    payableAmount: 120, receivableAmount: 220, currency: 'CNY', expiresAt: '2026-11-10T00:00:00Z' };
  const b = structuredClone(a); b.id = 'saved-usage-b'; b.lineUnits[1].usageQuantity = 2.5;
  const fixedBefore = structuredClone(a), fixedAfter = structuredClone(b), result = compare(a, b);
  assert.equal(result.inputChanges.items, true);
  assert.equal(result.inputChanges.quantity, false);
  assert.equal(result.inputChanges.period, false);
  assert.equal(result.inputChanges.location, 'not_projected_in_quote_display');
  assert.equal(result.coreAmounts.payableChanged, false);
  assert.equal(result.coreAmounts.receivableChanged, false);
  assert.equal(result.coreAmounts.arithmetic, 'not_recomputed_by_ai_layer');
  assert.equal(result.approvalReuse, 'forbidden_new_quote_requires_new_confirmation');
  assert.deepEqual(a, fixedBefore); assert.deepEqual(b, fixedAfter);
  assert.equal(compare(a, structuredClone(a)).inputChanges.items, false);
  const missing = structuredClone(a); delete missing.lineUnits[1].usageQuantity;
  const zero = structuredClone(missing); zero.lineUnits[1].usageQuantity = 0;
  assert.equal(compare(missing, zero).inputChanges.items, true, 'missing saved usage is not zero usage');
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1000001]) {
    const malformed = structuredClone(a); malformed.lineUnits[1].usageQuantity = value;
    assert.throws(() => compare(a, malformed), error => error.code === 'INVALID_REQUEST');
  }
  assert.deepEqual(Object.keys(result.inputChanges).sort(), ['items', 'location', 'period', 'quantity']);
});

test('risk recheck does not infer resolution from an aggregate report', async () => {
  const h = await setup();
  const result = await h.tools.riskRecheck({ riskId: 'risk-1', from: '2026-11-01T00:00:00+08:00', to: '2026-11-02T00:00:00+08:00' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.aggregateReadCannotProveResolution, true);
  assert.equal(result.sideEffects, 'not_attempted');
});
