'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,target}=require('./fixtures/ai-native/inspection-persistent.cjs');
const {composeInspectionAssist}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
const {readInspectionMedia}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-media.reader');
const {FileStorageRuntimeService}=require('../apps/api/src/modules/integrations/file-storage.runtime.service');
const {TenantInspectionObjectReader,s3ObjectReadRequest}=require('../apps/api/src/modules/integrations/inspection-object-reader');
const {RentalIdempotencyRepository,requestFingerprint}=require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlHAAAAAASUVORK5CYII=','base64');
function stream(bytes){return new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}});}
test('formal S3 object producer reads bound bytes via header auth, denies cross-space and bounds aborted transport',async()=>{
  const f=fixture(), asset=f.state.assets.get('file-a');
  const {InspectionObjectReaderModule}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-object-reader.provider');
  const {INSPECTION_OBJECT_READER}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-media.reader');
  const {NestFactory}=require('@nestjs/core');
  let configReads=0;
  f.db.rentalOrder={findFirst:async()=>null};
  assert.throws(()=>InspectionObjectReaderModule.register(f.db,{}),{code:'STORAGE_UNAVAILABLE'});
  const host=await NestFactory.createApplicationContext(InspectionObjectReaderModule.register(f.db,{runtimeConfig:async()=>{configReads++;return null;}}),{logger:false});
  try {
    assert.ok(host.get(INSPECTION_OBJECT_READER) instanceof TenantInspectionObjectReader);
    assert.equal(configReads,0); // Explicit registration does not open objects or read configuration.
  } finally { await host.close(); }
  Object.assign(asset,{storageProvider:'s3_compatible',sizeBytes:png.length});
  Object.assign(asset.uploadSession,{provider:'s3_compatible',fileAssetId:asset.id});
  f.db.rentalOrder={findFirst:async({where})=>where.id==='order-a'&&where.tenantId==='tenant-a'&&where.workspaceId==='workspace-a'?{id:'order-a'}:null};
  const config={id:'config-a',capability:'file',provider:'s3_compatible',settings:{endpoint:'https://objects.example.test',bucket:'synthetic-bucket',region:'us-east-1',forcePathStyle:true},credentials:{accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret'}};
  const at=new Date('2026-10-08T00:00:00Z'), request=s3ObjectReadRequest(config,'object-a',at);
  assert.equal(new URL(request.url).search,''); assert.match(request.headers.Authorization,/^AWS4-HMAC-SHA256 /);
  assert.equal(request.headers['x-amz-date'],'20261008T000000Z');
  assert.throws(()=>s3ObjectReadRequest(config,'../escape',at));
  let calls=0,startedResolve;const started=new Promise(resolve=>{startedResolve=resolve;});let hang=false;
  const producer=new TenantInspectionObjectReader(f.db,{runtimeConfig:async()=>structuredClone(config)},async(url,init)=>{
    calls++;assert.equal(url,request.url);assert.equal(init.redirect,'error');assert.equal(new URL(url).search,'');
    if(hang){startedResolve();return new Promise(()=>{});}
    return new Response(png,{headers:{'content-type':'image/png','content-length':String(png.length)}});
  },async url=>url,()=>at); // Explicit transport/egress mocks: no DNS or connection.
  const storage=new FileStorageRuntimeService(f.db,{runtimeConfig:async()=>structuredClone(config)},undefined,producer);
  const actual=await storage.readInspectionBytes('tenant-a','file-a',{businessType:'rental_order',businessId:'order-a',workspaceId:'workspace-a',actorUserId:f.state.user.id,uploadScene:'return-evidence'},png.length,new AbortController().signal);
  assert.deepEqual(actual.bytes,png);
  const ref={tenantId:'tenant-a',workspaceId:'workspace-other',fileAssetId:'file-a',provider:'s3_compatible',storageKey:'object-a'};
  await assert.rejects(producer.open(ref,new AbortController().signal));assert.equal(calls,1);
  hang=true;const control=new AbortController(), pending=producer.open({...ref,workspaceId:'workspace-a'},control.signal);
  await started;control.abort();await assert.rejects(pending);assert.equal(calls,2);
});
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
  const stop=new AbortController();let cancelCalls=0;
  const uncooperative=new ReadableStream({cancel(){cancelCalls++;return new Promise(()=>{});}});
  const stopped=assert.rejects(readInspectionMedia(uncooperative,100,stop.signal),{code:'RECONCILIATION_REQUIRED'});
  stop.abort();
  // An event-loop boundary, not a timed sleep: an uncooperative provider must
  // not keep this request waiting for its cleanup acknowledgement.
  await Promise.race([stopped,new Promise((_,reject)=>setImmediate(()=>reject(Error('cleanup blocked request'))))]);
  assert.equal(cancelCalls,1);assert.equal(uncooperative.locked,false);
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
