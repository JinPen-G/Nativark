'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,target}=require('./fixtures/ai-native/inspection-persistent.cjs');
const {composeInspectionAssist}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
const {readInspectionMedia}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-media.reader');
const {FileStorageRuntimeService}=require('../apps/api/src/modules/integrations/file-storage.runtime.service');
const {RentalIdempotencyRepository,requestFingerprint}=require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlHAAAAAASUVORK5CYII=','base64');
function stream(bytes){return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}
function mediaFixture(){
  const f=fixture();
  f.db.rentalOrder={findFirst:async({where})=>where.id==='order-a'&&where.tenantId==='tenant-a'&&where.workspaceId==='workspace-a'?{id:'order-a'}:null};
  const calls=[];
  const storage=new FileStorageRuntimeService(f.db,{runtimeConfig:async()=>({provider:'synthetic-controlled-provider'})},undefined,
    {open:async(ref,signal)=>{assert.equal(signal.aborted,false);calls.push(structuredClone(ref));return stream(png);}});
  f.services=composeInspectionAssist({...f.ports,storage});return {...f,calls};
}
async function draft(f,evidence=[]){
  const binding=await f.services.templates.read(target);
  const request={...target,operationId:'create-a',bindingFingerprint:binding.bindingFingerprint,results:{mileage:42},evidence};
  const result=await f.services.drafts.create(request);return {request,result};
}
function submissionFixture(mode='committed'){
  const f=fixture(),receipts=new Map();let calls=0,lookups=0;
  f.db.businessWorkspace={findFirst:async({where})=>where.tenantId==='tenant-a'&&where.id==='workspace-a'?{id:'workspace-a'}:null};
  f.db.rentalOrderIdempotencyRecord={findFirst:async({where})=>{lookups++;assert.equal(where.workspaceId,'workspace-a');return receipts.get(where.idempotencyKey)??null;}};
  const controller={createInspection:async(req,orderId,body)=>{
    calls++;assert.equal(req.user.id,f.state.user.id);assert.equal(orderId,target.orderId);
    if(mode==='absent')throw Error('reply unknown');
    const response={inspection:{id:'inspection-original',tenantId:'tenant-a',orderId,stage:'return',templateId:'template-a',templateVersion:'v1'},order:{id:orderId}};
    receipts.set(req.headers['idempotency-key'],{requestHash:requestFingerprint({orderId,...body,returnItems:[],exceptions:[]}),orderId,response});
    if(mode==='lost')throw Error('reply lost after original commit');return response;
  }};
  f.services=composeInspectionAssist({...f.ports,originalInspection:{controller,receipts:new RentalIdempotencyRepository(f.db)}});
  return {...f,receipts,calls:()=>calls,lookups:()=>lookups};
}
async function prepared(f){
  const d=await draft(f);
  const result=await f.services.submission.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'prepare-a',actionId:'handover-original',handoverSignatureFileAssetId:'signature-a'});
  return {...target,draftId:result.draftId,expectedRevision:result.revision,operationId:'submit-a'};
}

test('bounded actual stream reader hashes bytes, rejects overflow and cancels pending reads',async()=>{
  const result=await readInspectionMedia(stream(png),1000,new AbortController().signal);
  assert.equal(result.mediaType,'image/png');assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.contentHash.length,64);
  let pulled=0,cancelled=false;
  const source=new ReadableStream({pull(c){pulled++;c.enqueue(Buffer.alloc(64));},cancel(){cancelled=true;}},{highWaterMark:0});
  await assert.rejects(readInspectionMedia(source,32,new AbortController().signal),{code:'INVALID_INPUT'});
  assert.equal(pulled,1);assert.equal(cancelled,true);assert.equal(source.locked,false);
  const ac=new AbortController(),pending=new ReadableStream({cancel(){cancelled=true;}});
  const reading=readInspectionMedia(pending,100,ac.signal);ac.abort();
  await assert.rejects(reading,{code:'RECONCILIATION_REQUIRED'});assert.equal(pending.locked,false);
});
test('storage opening cancellation closes a late stream without exposing bytes',async()=>{
  const f=mediaFixture(),ac=new AbortController();let resolveOpen,startedResolve,cancelled=false;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const storage=new FileStorageRuntimeService(f.db,{runtimeConfig:async()=>({provider:'synthetic-controlled-provider'})},undefined,
    {open:()=>{startedResolve();return new Promise(resolve=>{resolveOpen=resolve;});}});
  const reading=storage.readInspectionBytes('tenant-a','file-a',{workspaceId:'workspace-a',actorUserId:f.state.user.id,
    businessType:'rental_order',businessId:'order-a',uploadScene:'return-evidence'},1000,ac.signal);
  await started;ac.abort();await assert.rejects(reading,/检查读取已取消/);
  resolveOpen(new ReadableStream({cancel(){cancelled=true;}}));await Promise.resolve();assert.equal(cancelled,true);
});

test('actual file runtime and evidence adapter produce bounded immutable recognition input, no SDK dispatch',async()=>{
  const f=mediaFixture(),ref=await f.services.evidence.bind({...target,attachmentId:'file-a'}),d=await draft(f,[ref]);
  const input={...target,draftId:d.result.draftId,expectedRevision:1,operationId:'input-a',question:'Read mileage only'};
  const result=await f.services.recognition.prepare(input,new AbortController().signal);
  assert.equal(result.code,'CAPABILITY_UNSUPPORTED');assert.equal(result.dispatch,'unavailable');assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{tenantId:'tenant-a',workspaceId:'workspace-a',fileAssetId:'file-a',provider:'synthetic-controlled-provider',storageKey:'object-a'});
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  const frozen=detail.state.recognitionInputs[0];assert.equal(frozen.question,input.question);assert.equal(frozen.media[0].width,1);
  assert.equal(frozen.inputFingerprint.length,64);assert.ok(!JSON.stringify(frozen).includes('object-a'));assert.ok(!JSON.stringify(frozen).includes(png.toString('base64')));
  assert.deepEqual(await f.services.recognition.prepare(input,new AbortController().signal),result);assert.equal(f.calls.length,1);
});
test('candidate accept, reject and late append preserve human values and original candidate history',async()=>{
  const f=mediaFixture(),ref=await f.services.evidence.bind({...target,attachmentId:'file-a'});
  await f.services.evidence.readMedia({...target,...ref},new AbortController().signal);
  const d=await draft(f,[ref]);
  const c={candidateId:'candidate-a',fieldCode:'mileage',status:'candidate',value:{kind:'number',value:43},confidence:0.8,sources:[{...ref,kind:'image',region:{x:0,y:0,width:1,height:1}}]};
  const common={...target,draftId:d.result.draftId,bindingFingerprint:d.request.bindingFingerprint};
  await f.services.drafts.saveCandidates({...common,operationId:'candidate-op',expectedRevision:1,candidates:[c]});
  await f.services.drafts.edit({...common,operationId:'accept',expectedRevision:2,edits:[{fieldCode:'mileage',decision:'accepted',candidateId:c.candidateId}]});
  assert.equal((await f.services.drafts.read({...target,draftId:d.result.draftId})).state.fields.mileage.value,43);
  await f.services.drafts.edit({...common,operationId:'reject',expectedRevision:3,edits:[{fieldCode:'mileage',decision:'rejected',candidateId:c.candidateId}]});
  await f.services.drafts.saveCandidates({...common,operationId:'late',expectedRevision:4,candidates:[{...c,candidateId:'candidate-late',value:{kind:'number',value:99}}]});
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(detail.state.fields.mileage.value,null);assert.equal(detail.state.fields.mileage.decision,'rejected');assert.equal(detail.state.candidates.length,2);
  assert.equal((await f.services.drafts.reconcileOperation({kind:'create',request:d.request})).result.revision,1);
});
test('concurrent same submit only dispatches once, lost reply uses original receipt',async()=>{
  const f=submissionFixture('lost'),input=await prepared(f);
  const results=await Promise.allSettled([f.services.submission.submit(input),f.services.submission.submit(input)]);
  assert.equal(f.calls(),1);assert.ok(results.some(r=>r.status==='fulfilled'&&r.value.status==='submitted'));
  const recovered=await f.services.submission.reconcile({...target,draftId:input.draftId});
  assert.equal(recovered.inspectionId,'inspection-original');assert.equal(recovered.draftLinked,true);
});

test('multi-allocation review preserves per-item materials and cannot dispatch an order-wide inspection',async()=>{
  const f=submissionFixture();
  f.order.allocations.push({...f.order.allocations[0],id:'allocation-b',assetId:'asset-b'});
  const d=await draft(f);
  const input={...target,draftId:d.result.draftId,expectedRevision:1,operationId:'review-a',actionId:'review-action'};
  const review=await f.services.submission.prepareReview(input);
  assert.equal(review.mode,'manual_review_only');
  assert.deepEqual(await f.services.submission.prepareReview(input),review);
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(detail.state.submission.mode,'manual_review_only');
  assert.equal(detail.state.fields.mileage.value,42);
  await assert.rejects(f.services.submission.submit({...target,draftId:d.result.draftId,expectedRevision:review.revision,operationId:'submit-review'}),{code:'CAPABILITY_UNSUPPORTED'});
  assert.equal(f.calls(),0);
  assert.equal(f.state.drafts.get(d.result.draftId).status,'prepared');
  await assert.rejects(f.services.submission.prepare({...input,operationId:'prepare-order',expectedRevision:review.revision}),{code:'CAPABILITY_UNSUPPORTED'});
});
test('failed draft back-write preserves original submission and recovery never re-submits',async()=>{
  const f=submissionFixture(),input=await prepared(f);f.state.failLink=true;
  const result=await f.services.submission.submit(input);
  assert.equal(result.status,'submitted');assert.equal(result.inspectionId,'inspection-original');assert.equal(result.draftLinked,false);
  assert.equal(f.state.drafts.get(input.draftId).status,'submission_unknown');
  f.order.allocations[0].status='returned';
  const repaired=await f.services.submission.reconcile({...target,draftId:input.draftId});
  assert.equal(repaired.draftLinked,true);assert.equal(f.calls(),1);
});
test('absent original receipt stays unknown with exact action material and never retries automatically',async()=>{
  const f=submissionFixture('absent'),input=await prepared(f);
  const first=await f.services.submission.submit(input);assert.equal(first.status,'submission_unknown');assert.equal(first.receiptLookup,'absent');
  await f.services.submission.submit(input);const result=await f.services.submission.reconcile({...target,draftId:input.draftId});
  assert.equal(result.status,'submission_unknown');assert.equal(result.actionId,'handover-original');assert.equal(result.requestHash.length,64);assert.equal(f.calls(),1);
});
