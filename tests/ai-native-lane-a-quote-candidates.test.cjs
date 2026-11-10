'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({transpileOnly:false,compilerOptions:{module:'commonjs',moduleResolution:'node',experimentalDecorators:true,emitDecoratorMetadata:true}});
const {AiQuoteCandidatePreparationService}=require('../apps/api/src/modules/ai-native/tools/quote-candidate-preparation.service');
const {AiCatalogReadFactsService}=require('../apps/api/src/modules/ai-native/catalog-read-facts.service');
const {AiMembershipCandidateReadFactsService}=require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
const {AiBusinessReadRouteAuthority}=require('../apps/api/src/modules/ai-native/business-read-route.authority');
const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
const {RentalCoreService}=require('../apps/api/src/modules/rental-core/rental-core.service');
const {MembershipService}=require('../apps/api/src/modules/platform/membership.service');
const {authorizedRunnerHarness}=require('./fixtures/ai-native/task-authorized-runner.cjs');
const {RENTAL_CATEGORY_DEFINITIONS}=require('./fixtures/ai-native/local-shared.cjs');
const stores=require('./helpers/absorbing-config-store.cjs');
async function setup(categoryCode='camera'){
 const h=await authorizedRunnerHarness();h.identity.user.tenantId='tenant_001';h.identity.user.permissions.push('rental-core:catalog:view','rental-os:order:create');
 const config=stores.createAbsorbingConfigStore();config.listWorkspaces=async()=>[{id:'workspace-a',tenantId:'tenant_001',categoryCode,isDefault:true}];
 const core=new RentalCoreService(config,stores.createAbsorbingFactStore());await core.onApplicationBootstrap();
 // Declared synthetic pagination endpoint over the SAME seeded synthetic
 // catalog: deterministic id-ordered pages with the formal cursor/truncated
 // contract for the persisted port (AI reads are bounded-only).
 const {requestFingerprint}=require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
 config.listItemGroupsPage=async(tenantId,workspaceId,query)=>{
  const seeded=core.listItemGroups(tenantId);
  const all=seeded.filter(row=>(!query.itemGroupId||row.id===query.itemGroupId)
    &&(!query.name||row.name===query.name)&&(!query.cursor||row.id>query.cursor))
   .sort((left,right)=>(left.id<right.id?-1:left.id>right.id?1:0));
  const rows=all.slice(0,query.limit),truncated=all.length>query.limit;
  return {rows,truncated,nextCursor:truncated?rows[rows.length-1].id:null,
   source:'persisted_workspace_configuration',
   configurationVersion:requestFingerprint(seeded.map(row=>[row.id,row.name,row.status,row.unit]))};
 };
 const bc={profile:core.getProfile('tenant_001'),category:RENTAL_CATEGORY_DEFINITIONS.find(x=>x.code===categoryCode),settings:core.getBusinessSettings('tenant_001'),groups:core.listItemGroups('tenant_001'),locations:core.listLocations('tenant_001'),operators:core.listOperators('tenant_001'),couponTemplates:[]};
 const customers=[{id:'customer-a',name:'Synthetic same name',phoneMasked:'138****0000',membership:{status:'active'}},{id:'customer-b',name:'Synthetic same name',phoneMasked:'139****0000',membership:{status:'active'}}];
 const memberships=new MembershipService({customerProfile:{findMany:async q=>structuredClone(customers.filter(row =>
   (!q.where.id || row.id === q.where.id) && (!q.where.name || row.name.includes(q.where.name.contains))).slice(0,q.take))}},{});
 const authority=new AiBusinessReadRouteAuthority(new ApiAuthGuard(h.authorization.auth,undefined,undefined,undefined,{}),h.authorization.credentials,()=>new Date('2026-10-07T16:30:00Z'));
 // Effective-rate projection double only; integration smokes use the real Core price reader.
 const rateRows=bc.groups.flatMap(group=>bc.settings.pricing.enabledUnits.map(unit=>({id:`rate-${group.id}-${unit}`,itemGroupId:group.id,unit,baseAmount:100})));
 const readers={catalog:new AiCatalogReadFactsService(core,authority),members:new AiMembershipCandidateReadFactsService(memberships,authority),rates:{read:async()=>structuredClone(rateRows)}};
 const contexts={current:async()=>bc},clock=()=>new Date('2026-10-07T16:30:00Z');
 const service=new AiQuoteCandidatePreparationService(readers,contexts,clock);
 const candidate={customerType:'personal',customerId:'customer-a',items:[{productName:bc.groups[0].name,quantity:1,pricingUnit:bc.settings.pricing.enabledUnits[0]}],start:'明天 09:00',end:'后天 09:00',fulfillmentMode:bc.settings.fulfillment.enabledModes[0],locationName:bc.locations[0].name};
 return {...h,bc,readers,contexts,clock,service,candidate,customers,authority};
}
test('server resolves finite extracted candidates through real Guard/catalog/member readers without quoting',async()=>{
 const h=await setup(),out=await h.service.prepare(h.candidate);
 assert.equal(out.status,'needs_confirmation');assert.equal(out.request.lines[0].itemGroupId,h.bc.groups[0].id);
 assert.equal(out.request.startAt,'2026-10-09T01:00:00.000Z');assert.equal(out.request.endAt,'2026-10-10T01:00:00.000Z');
 assert.equal(out.request.customerId,'customer-a');assert.equal(out.timeZone,'Asia/Shanghai');assert.equal(out.reservation,'not_reserved');
 const {AiQuoteBusinessPreparationService}=require('../apps/api/src/modules/ai-native/tools/quote-business-preparation.service');
 for(const [boundary,completedAt,missing] of [
  ['already_started','2026-10-07T16:30:00Z',['start']],
  ['start_reached_during_read','2026-10-09T01:00:00Z',['start']],
  ['end_reached_during_read','2026-10-10T01:00:00Z',['start','end']]
 ]){
  const current=await setup();let observedAt='2026-10-07T16:30:00Z',reads=0,availabilityReads=0;
  const originalRates=current.readers.rates.read;
  current.readers.rates.read=async(...args)=>{const rows=await originalRates(...args);if(++reads===2)observedAt=completedAt;return rows;};
  const candidate={...current.candidate,start:boundary==='already_started'?'2026-10-07T16:30:00Z':out.request.startAt,end:out.request.endAt};
  const unchanged=structuredClone(candidate);
  const service=new AiQuoteCandidatePreparationService(current.readers,current.contexts,()=>new Date(observedAt));
  const result=await service.prepare(candidate);
  assert.equal(result.status,'missing_input',boundary);assert.equal(result.request,undefined);
  for(const field of missing){
   assert.ok(result.missingFields.includes(field),`${boundary}: ${field}`);
   assert.ok(result.clarifications.some(row=>row.field===field&&row.action==='supply_absolute_time'&&row.reason==='rental_time_elapsed'));
  }
  assert.deepEqual(candidate,unchanged,'do not shift dates or rewrite the original candidate to obtain confirmation');
  const {originalQuoteAnswerContract}=require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const contract=originalQuoteAnswerContract(candidate,result,'Choose a new explicit period');
  for(const field of missing)assert.ok(contract.fields.some(row=>row.fieldId===(field==='start'?'starts_at':'ends_at')&&row.kind==='text'&&row.required));
  const business=new AiQuoteBusinessPreparationService(service,{read:async()=>{availabilityReads++;throw Error('elapsed candidate must not reach stock');}},
   current.authority,{contexts:current.contexts,catalog:current.readers.catalog});
  const unified=await business.prepareUnified(candidate);
  assert.equal(unified.status,'missing_input');assert.equal(unified.next,'clarify_input');assert.equal(unified.request,undefined);
  assert.deepEqual(unified.sideEffects,{quoteSaved:false,inventoryReserved:false,orderCreated:false,approvalGranted:false});
  assert.equal(availabilityReads,0);
 }
 const invalid=await setup();let observedAt='2026-10-07T16:30:00Z',reads=0;
 const originalRates=invalid.readers.rates.read;
 invalid.readers.rates.read=async(...args)=>{const rows=await originalRates(...args);if(++reads===2)observedAt='invalid-clock';return rows;};
 const service=new AiQuoteCandidatePreparationService(invalid.readers,invalid.contexts,()=>new Date(observedAt));
 await assert.rejects(service.prepare({...invalid.candidate,start:out.request.startAt,end:out.request.endAt}),error=>error.code==='CONFIG_INVALID');
 const delayed=await setup();let at='2026-10-07T16:30:00Z',stockReads=0,configurationDrift=false;
 const period={...delayed.candidate,start:out.request.startAt,end:out.request.endAt};
 const delayedService=new AiQuoteCandidatePreparationService(delayed.readers,delayed.contexts,()=>new Date(at));
 // Declared availability leaf only: the original business service and enclosing
 // Guard run normally; a completed stock observation is not a quote or lock.
 const delayedBusiness=new AiQuoteBusinessPreparationService(delayedService,{read:async(query,context)=>{
  stockReads++;assert.equal(query.startAt,period.start);assert.equal(context.scope.kind,'workspace');
  at=period.start;if(configurationDrift)delayed.bc.settings.configVersion='changed-during-stock';
  return {scope:context.scope,audience:context.audience,observedAt:at,
   result:{...query,available:true,lines:query.lines.map(row=>({...row,requestedQuantity:row.quantity,available:true}))}};
 }},delayed.authority,{contexts:delayed.contexts,catalog:delayed.readers.catalog});
 const reopened=await delayedBusiness.prepareUnified(period);
 assert.equal(reopened.status,'missing_input');assert.equal(reopened.next,'clarify_input');assert.equal(reopened.request,undefined);
 assert.ok(reopened.missingFields.includes('start'));assert.equal(reopened.availability,undefined,'old stock observation is not a current ready material');
 assert.equal(stockReads,1,'no stock retry or automatic new quotation after the time elapsed');
 assert.deepEqual(period,{...delayed.candidate,start:out.request.startAt,end:out.request.endAt});
 at='2026-10-07T16:30:00Z';configurationDrift=true;
 await assert.rejects(delayedBusiness.prepareUnified(period),error=>error.code==='CONFIG_INVALID',
  'elapsed time cannot downgrade a simultaneous configuration/selection change');
 assert.equal(stockReads,2);
});
test('explicit personal booking identity survives authorized candidate preparation without a default',async()=>{
 const h=await setup();
 const ordinary=await h.service.prepare(h.candidate);
 assert.equal(ordinary.status,'needs_confirmation');assert.equal(ordinary.request.bookingIdentity,undefined);
 const explicit=await h.service.prepare({...h.candidate,bookingIdentity:{bookingIdentity:'personal'}});
 assert.equal(explicit.status,'needs_confirmation');assert.deepEqual(explicit.request.bookingIdentity,{bookingIdentity:'personal'});
 // This fixture has no formal relationship/qualification source; fail closed,
 // not a successful empty candidate list that could authorize an enterprise.
 await assert.rejects(h.service.prepare({...h.candidate,bookingIdentity:{bookingIdentity:'enterprise_employee',corporateCustomerId:'enterprise-a'}}));
 h.identity.user.permissions=['rental-core:catalog:view'];
 await assert.rejects(h.service.prepare({...h.candidate,bookingIdentity:{bookingIdentity:'personal'}}));
});
test('same-name customers stay ambiguous without an explicit selection',async()=>{const h=await setup();delete h.candidate.customerId;h.candidate.customerName='Synthetic same name';const out=await h.service.prepare(h.candidate);assert.equal(out.status,'ambiguous');assert.equal(out.request,undefined);assert.equal(out.customerCandidates.length,2);});
test('unknown products and locations remain missing, never auto-selected',async()=>{const h=await setup();h.candidate.items[0].productName='not a product';h.candidate.locationName='unknown location';const out=await h.service.prepare(h.candidate);assert.equal(out.status,'missing_input');assert.ok(out.missingFields.includes('items.0'));assert.ok(out.missingFields.includes('location'));});
test('candidate cannot override prices, identity, or server time zone',async()=>{const h=await setup();for(const patch of [{amount:0},{tenantId:'tenant-b'},{timeZone:'Pacific/Honolulu'},{actor:{kind:'saas_admin'}}])assert.equal((await h.service.prepare({...h.candidate,...patch})).status,'missing_input');});
test('quantity, unsupported free dates and no-offset timestamps require clarification',async()=>{const h=await setup();for(const patch of [{items:[{productName:h.bc.groups[0].name,quantity:0}]},{items:[{productName:h.bc.groups[0].name,quantity:10001}]},{start:'下周找一天'},{start:'2026-10-09T09:00:00'}])assert.equal((await h.service.prepare({...h.candidate,...patch})).status,'missing_input');});
test('direct corporate user is unsupported, never silently converted to personal booking',async()=>{const h=await setup();const out=await h.service.prepare({...h.candidate,customerType:'corporate'});assert.equal(out.status,'unavailable');assert.equal(out.reason,'direct_corporate_booking_not_supported');assert.equal(out.request,undefined);});
test('original member permission withdrawal prevents candidate preparation',async()=>{const h=await setup();h.identity.user.permissions=['rental-core:catalog:view'];await assert.rejects(h.service.prepare(h.candidate));});
test('current server zone, not machine zone, resolves relative dates deterministically',async()=>{const h=await setup();h.bc.settings.calendar.timeZone='UTC';const out=await h.service.prepare(h.candidate);assert.equal(out.request.startAt,'2026-10-08T09:00:00.000Z');});
test('DST ambiguous and skipped local times are not silently chosen',async()=>{const h=await setup();h.bc.settings.calendar.timeZone='America/New_York';for(const [now,start,end]of [['2026-11-01T02:00:00Z','明天 01:30','明天 03:30'],['2026-03-08T01:00:00Z','明天 02:30','明天 04:00']]){const svc=new AiQuoteCandidatePreparationService(h.readers,h.contexts,()=>new Date(now));assert.equal((await svc.prepare({...h.candidate,start,end})).status,'missing_input');}});
test('context change while fetching server settings cannot reuse earlier customer candidates',async()=>{const h=await setup();h.contexts.current=async()=>{h.identity.workspace='workspace-b';return h.bc;};await assert.rejects(h.service.prepare(h.candidate));});
test('a lone name still requires an explicit human selection',async()=>{const h=await setup();h.customers.pop();delete h.candidate.customerId;h.candidate.customerName='Synthetic same name';const out=await h.service.prepare(h.candidate);assert.equal(out.status,'missing_input');assert.ok(out.missingFields.includes('customerId'));});
test('configuration revision changed during protected rereads invalidates prepared parameters',async()=>{const h=await setup();const read=h.readers.members.read.bind(h.readers.members);let calls=0;h.readers.members.read=async value=>{const out=await read(value);if(++calls===2)h.bc.settings.configVersion='changed-revision';return out;};await assert.rejects(h.service.prepare(h.candidate));});
test('location removed during protected rereads invalidates prepared parameters even without a revision bump',async()=>{const h=await setup();const read=h.readers.members.read.bind(h.readers.members);let calls=0;h.readers.members.read=async value=>{const out=await read(value);if(++calls===2)h.bc.locations=[];return out;};await assert.rejects(h.service.prepare(h.candidate));});

test('actionable clarification to explicit resource IDs rereads original readers and rejects stale configuration',async()=>{
 const h=await setup();
 const allowedMode=h.bc.settings.fulfillment.enabledModes[0];
 assert.ok(h.bc.settings.fulfillment.enabledModes.length>1);
 h.bc.category={...h.bc.category,businessModel:{...h.bc.category.businessModel,fulfillmentModes:[allowedMode]}};
 const partial=await h.service.prepare({customerType:'personal',customerName:'Synthetic same name'});
 assert.deepEqual(partial.clarifications.find(row=>row.field==='fulfillmentMode').candidates.map(row=>row.id),[allowedMode]);
 assert.ok(partial.clarifications.some(row=>row.field==='customerId'&&row.candidates.length===2));
 assert.ok(partial.clarifications.some(row=>row.field==='start'&&row.action==='supply_absolute_time'));
 const selected={...h.candidate,items:[{...h.candidate.items[0],itemGroupId:h.bc.groups[0].id,quantity:1,productName:'untrusted ignored name'}],locationId:h.bc.locations[0].id,locationName:'untrusted ignored location',selectionRevision:partial.selectionRevision};
 const narrowed=await h.service.prepare(selected);assert.equal(narrowed.status,'missing_input');
 assert.equal(narrowed.clarifications[0].action,'reread_and_reconfirm');
 selected.selectionRevision=narrowed.selectionRevision;
 const out=await h.service.prepare(selected);assert.equal(out.status,'needs_confirmation');assert.equal(out.request.lines[0].itemGroupId,h.bc.groups[0].id);
 h.bc.settings.configVersion='new-server-config';
 const stale=await h.service.prepare(selected);assert.equal(stale.status,'missing_input');assert.equal(stale.request,undefined);assert.equal(stale.clarifications[0].action,'reread_and_reconfirm');
 const {originalQuoteAnswerContract,applyOriginalQuoteAnswers}=require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
 const contract=originalQuoteAnswerContract(selected,stale,'Review the changed server configuration');
 assert.equal(contract.code,'original_quote_parameters');
 assert.ok(contract.fields.some(field=>field.fieldId==='item_selection'&&field.kind==='choice'));
 const answers=contract.fields.filter(field=>field.required).map(field=>({fieldId:field.fieldId,value:field.options[0].value}));
 const confirmed=applyOriginalQuoteAnswers(selected,[{contract,answers}]);
 assert.notEqual(confirmed.selectionRevision,selected.selectionRevision);
 assert.equal(selected.selectionRevision,narrowed.selectionRevision);
 // Answering the stale contract normalizes the candidate (the untrusted name
 // is dropped) and the configuration has changed, so the server demands one
 // more reread of the current readers before the candidate can confirm.
 const afterStale=await h.service.prepare(confirmed);
 assert.equal(afterStale.status,'missing_input');
 assert.equal(afterStale.clarifications[0].action,'reread_and_reconfirm');
 const settledContract=originalQuoteAnswerContract(confirmed,afterStale,'Reconfirm under the current configuration');
 const settled=applyOriginalQuoteAnswers(confirmed,[{contract:settledContract,
   answers:settledContract.fields.filter(field=>field.required).map(field=>({fieldId:field.fieldId,value:field.options[0].value}))}]);
 assert.equal((await h.service.prepare(settled)).status,'needs_confirmation');
 const usage=await setup('construction');
 const invalidUnit={...usage.candidate,items:[{...usage.candidate.items[0],pricingUnit:'night'}]};
 const unitChoice=await usage.service.prepare(invalidUnit);
 const unitContract=originalQuoteAnswerContract(invalidUnit,unitChoice,'Select an applicable unit, not a price');
 assert.ok(unitContract.fields.find(field=>field.fieldId==='pricing_unit_selection').options.some(row=>row.value==='usage'));
 assert.throws(()=>applyOriginalQuoteAnswers(invalidUnit,[{contract:unitContract,answers:[{fieldId:'pricing_unit_selection',value:'night'}]}]));
 const input=applyOriginalQuoteAnswers(invalidUnit,[{contract:unitContract,answers:[{fieldId:'pricing_unit_selection',value:'usage'}]}]);
 const needsUsage=await usage.service.prepare(input);
 assert.ok(needsUsage.missingFields.includes('items.0.usageQuantity'));
 // Re-answering a round shifts the candidate fingerprint (the untrusted name
 // is normalized away) and the unit must be re-bound before the usage
 // quantity is asked, so the contract re-offers current choices until the
 // exact candidate settles. Every round is answered with the candidate's own
 // current values and each round must re-offer them.
 const answerCurrent=(candidateValue,field)=>{
  const current=field.fieldId==='usage_quantity'?'1.5':field.fieldId==='pricing_unit_selection'?candidateValue.items[0].pricingUnit
   :field.fieldId==='item_selection'?candidateValue.items[0].itemGroupId:field.fieldId==='customer_selection'?candidateValue.customerId
   :field.fieldId==='pickup_location'?candidateValue.locationId:field.fieldId==='fulfillment_selection'?candidateValue.fulfillmentMode
   :field.fieldId==='delivery_address_selection'?candidateValue.deliveryAddressId:undefined;
  if(!field.options) return current;
  return field.options.some(option=>option.value===current)?current:field.options[0].value;
 };
 let usageCandidate=input,usagePreparation=await usage.service.prepare(usageCandidate),usageAsked=false;
 for(let round=0;round<6&&usagePreparation.status==='missing_input';round++){
  const roundContract=originalQuoteAnswerContract(usageCandidate,usagePreparation,'Reconfirm the usage candidate');
  if(roundContract.fields.some(field=>field.fieldId==='usage_quantity')) usageAsked=true;
  usageCandidate=applyOriginalQuoteAnswers(usageCandidate,[{contract:roundContract,
   answers:roundContract.fields.filter(field=>field.required).map(field=>({fieldId:field.fieldId,value:answerCurrent(usageCandidate,field)}))}]);
  usagePreparation=await usage.service.prepare(usageCandidate);
 }
 assert.equal(usageAsked,true);
 assert.equal(usagePreparation.request.lines[0].usageQuantity,1.5);
 assert.equal(input.items[0].usageQuantity,undefined);
 const supplied=usageCandidate;
 const previousRates=usage.readers.rates.read;
 usage.readers.rates.read=async()=> (await previousRates()).map(row=>({...row,baseAmount:101}));
 const rateChanged=await usage.service.prepare(supplied);
 assert.equal(rateChanged.status,'missing_input');assert.notEqual(rateChanged.selectionRevision,supplied.selectionRevision);
 const reselect=originalQuoteAnswerContract(input,await usage.service.prepare(input),'Re-select the changed pricing basis');
 assert.equal(reselect.fields.some(field=>field.fieldId==='usage_quantity'),false);
 const timeBased=applyOriginalQuoteAnswers(input,[{contract:reselect,answers:reselect.fields.filter(field=>field.required)
   .map(field=>({fieldId:field.fieldId,value:field.options[0].value}))}]);
 assert.notEqual(timeBased.items[0].pricingUnit,'usage');assert.equal(timeBased.items[0].usageQuantity,undefined);
 // The switched unit joins the candidate fingerprint: one reconfirmation with
 // the candidate's own current values re-binds it before the request derives.
 const unitRound=originalQuoteAnswerContract(timeBased,await usage.service.prepare(timeBased),'Reconfirm the switched unit');
 const unitSettled=applyOriginalQuoteAnswers(timeBased,[{contract:unitRound,answers:unitRound.fields.filter(field=>field.required)
   .map(field=>({fieldId:field.fieldId,value:answerCurrent(timeBased,field)}))}]);
 assert.equal((await usage.service.prepare(unitSettled)).status,'needs_confirmation');
 usage.readers.rates.read=async()=>[];
 assert.equal((await usage.service.prepare(supplied)).reason,'current_product_rates_unavailable');
 for(const value of ['-1','NaN','1e3','1000001','0.10000000000000000001'])assert.throws(()=>applyOriginalQuoteAnswers(input,[{contract:usageContract,answers:usageAnswers.map(answer=>answer.fieldId==='usage_quantity'?{...answer,value}:answer)}]));
});
test('forged selected ID cannot be rescued by a valid returned name',async()=>{
 const h=await setup(),before=await h.service.prepare(h.candidate);
 const out=await h.service.prepare({...h.candidate,selectionRevision:before.selectionRevision,items:[{itemGroupId:'foreign-product',productName:h.bc.groups[0].name,quantity:1}]});
 assert.equal(out.status,'missing_input');assert.equal(out.request,undefined);assert.ok(out.missingFields.includes('items.0'));
});

// Begin pickup address reconfirm owned cases.
test('AIN15 pickup address reconfirm clears an inapplicable old address only after explicit same-mode choice',async()=>{
 const h=await setup(),candidate={...h.candidate,fulfillmentMode:'store_pickup_return',deliveryAddressId:'old-address'};
 const before=structuredClone(candidate),prepared=await h.service.prepare(candidate);
 assert.ok(prepared.clarifications.some(row=>row.field==='fulfillmentMode'&&row.reason==='reselect_fulfillment_to_clear_inapplicable_address'));
 const {originalQuoteAnswerContract,applyOriginalQuoteAnswers}=require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
 const contract=originalQuoteAnswerContract(candidate,prepared,'Reconfirm the original pickup');
 const mode=contract.fields.find(row=>row.fieldId==='fulfillment_selection');
 assert.ok(mode.options.some(row=>row.value==='store_pickup_return'));
 const answers=contract.fields.filter(row=>row.required).map(row=>({fieldId:row.fieldId,
  value:row.fieldId==='fulfillment_selection'?'store_pickup_return':row.options?.[0]?.value}));
 const selected=applyOriginalQuoteAnswers(candidate,[{contract,answers}]);
 assert.deepEqual(candidate,before);assert.equal(selected.fulfillmentMode,'store_pickup_return');assert.equal(selected.deliveryAddressId,undefined);
 const next=await h.service.prepare(selected);
 assert.ok(!next.clarifications?.some(row=>row.reason==='reselect_fulfillment_to_clear_inapplicable_address'));
});
// End pickup address reconfirm owned cases.

test('delivery address selection flows through original answers and must be reselected after address or customer changes',async()=>{
 const h=await setup();
 const row={id:'address-a',revision:1,recipient:'Synthetic recipient',phoneMasked:'138****0000',countryCode:'CN',
   province:'Synthetic province',city:'Synthetic city',detail:'Synthetic detail',isDefault:true,updatedAt:'2026-10-07T00:00:00Z'};
 const rows=[row];
 h.bc.category={...h.bc.category,businessModel:{...h.bc.category.businessModel,deliveryDestination:'customer_address'}};
 h.bc.settings.fulfillment.enabledModes=[...new Set([...h.bc.settings.fulfillment.enabledModes,'delivery'])];
 h.bc.category.businessModel.fulfillmentModes=[...new Set([...h.bc.category.businessModel.fulfillmentModes,'delivery'])];
 h.readers.addresses={list:async()=>({identityHash:'a'.repeat(64),rows:structuredClone(rows)})};
 const input={...h.candidate,fulfillmentMode:'delivery'};
 const pending=await h.service.prepare(input);
 const {originalQuoteAnswerContract,applyOriginalQuoteAnswers}=require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
 const contract=originalQuoteAnswerContract(input,pending,'Choose an authorized address');
 assert.deepEqual(contract.fields.find(f=>f.fieldId==='delivery_address_selection').options.map(o=>o.value),['address-a']);
 const selected=applyOriginalQuoteAnswers(input,[{contract,answers:[{fieldId:'delivery_address_selection',value:'address-a'}]}]);
 assert.equal(input.deliveryAddressId,undefined);
 // The selected address joins the candidate fingerprint and the untrusted name
 // normalization shifts it once more: the contract re-offers the candidate's
 // own current values until the exact candidate is reconfirmed, keeping the
 // confirmed address bound throughout.
 const answerCurrent17=(candidateValue,field)=>{
  const current=field.fieldId==='delivery_address_selection'?'address-a':field.fieldId==='fulfillment_selection'?candidateValue.fulfillmentMode
   :field.fieldId==='pricing_unit_selection'?candidateValue.items[0].pricingUnit:field.fieldId==='item_selection'?candidateValue.items[0].itemGroupId
   :field.fieldId==='customer_selection'?candidateValue.customerId:field.fieldId==='pickup_location'?candidateValue.locationId:undefined;
  if(!field.options) return current;
  return field.options.some(option=>option.value===current)?current:field.options[0].value;
 };
 let addressCandidate=selected,ready=await h.service.prepare(addressCandidate);
 for(let round=0;round<6&&ready.status==='missing_input';round++){
  const roundContract=originalQuoteAnswerContract(addressCandidate,ready,'Reconfirm the chosen address');
  addressCandidate=applyOriginalQuoteAnswers(addressCandidate,[{contract:roundContract,
   answers:roundContract.fields.filter(field=>field.required).map(field=>({fieldId:field.fieldId,value:answerCurrent17(addressCandidate,field)}))}]);
  ready=await h.service.prepare(addressCandidate);
 }
 assert.equal(ready.status,'needs_confirmation');assert.equal(ready.request.deliveryAddressId,'address-a');
 assert.match(ready.addressFingerprint,/^[a-f0-9]{64}$/);assert.equal(ready.reservation,'not_reserved');
 row.revision++;
 const changed=await h.service.prepare(selected);assert.equal(changed.status,'missing_input');assert.equal(changed.request,undefined);
 assert.notEqual(changed.selectionRevision,selected.selectionRevision);
 const customerContract={...contract,fields:[{fieldId:'customer_selection',kind:'choice',required:true,label:'Choose customer',options:[{value:'customer-b',label:'Second customer'}]}]};
 const other=applyOriginalQuoteAnswers(selected,[{contract:customerContract,answers:[{fieldId:'customer_selection',value:'customer-b'}]}]);
 assert.equal(other.deliveryAddressId,undefined);
 rows.length=0;
 assert.equal((await h.service.prepare(selected)).reason,'current_customer_addresses_unavailable');
});
