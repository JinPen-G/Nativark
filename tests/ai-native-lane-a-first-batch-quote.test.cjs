'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');

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
    assert.equal(snapshot.enterpriseContractAndPayer,false);return snapshot;};
  const preview=await h.tools.quote.previewSelection({...selected,selectionRevision:reconfirmed.selectionRevision});
  assert.equal(preview.status,'quoted');assert.equal(preview.quote.reservation,'not_reserved');assert.equal(resolved,1);
  // Core persistence is allowed for quotes, never inventory ownership or approval.
  assert.equal(h.businessFacts.writes.some(row=>/order|reservation/i.test(row.kind)),false);
  const corporatePayer={...selected,bookingIdentity:{...selectedIdentity,enterpriseContractAndPayer:true}};
  const unsupported=await h.tools.quote.candidates.prepare(corporatePayer);
  assert.equal(unsupported.status,'unavailable');assert.equal(unsupported.reason,'enterprise_payer_authority_unavailable');
  await assert.rejects(h.tools.quote.preview.preview({...reconfirmed.request,bookingIdentity:corporatePayer.bookingIdentity}),e=>e.code==='CAPABILITY_UNSUPPORTED');
  assert.equal(resolved,1,'unsupported payer never reaches Core or silently becomes personal payer');
  const unknown=await h.tools.quote.candidates.prepare({...selected,bookingIdentity:{...candidate.bookingIdentity,corporateCustomerId:'other'}});
  assert.equal(unknown.status,'missing_input');assert.ok(unknown.missingFields.includes('bookingIdentity.corporateCustomerId'));
  h.membershipRows.bookingOptions=[];
  const withdrawn=await h.tools.quote.candidates.prepare(selected);
  assert.equal(withdrawn.status,'missing_input');assert.ok(withdrawn.missingFields.includes('selectionRevision'));
  assert.equal(resolved,1);
  h.h.identity.user.permissions=[];await assert.rejects(h.tools.quote.candidates.prepare(selected));
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

test('risk recheck does not infer resolution from an aggregate report', async () => {
  const h = await setup();
  const result = await h.tools.riskRecheck({ riskId: 'risk-1', from: '2026-11-01T00:00:00+08:00', to: '2026-11-02T00:00:00+08:00' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.aggregateReadCannotProveResolution, true);
  assert.equal(result.sideEffects, 'not_attempted');
});
