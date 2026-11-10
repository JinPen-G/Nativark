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
  const digest=require('node:crypto').createHash('sha256').update(png).digest('hex');
  const staging=`tenant-files/tenant-a/${asset.id}/blob`,storageKey=`${staging}.committed/12345678-1234-4123-8123-123456789abc/${digest}`;
  Object.assign(asset,{storageProvider:'s3_compatible',sizeBytes:png.length,storageKey,checksum:digest});
  Object.assign(asset.uploadSession,{provider:'s3_compatible',fileAssetId:asset.id,storageKey});
  f.db.rentalOrder={findFirst:async({where})=>where.id==='order-a'&&where.tenantId==='tenant-a'&&where.workspaceId==='workspace-a'?{id:'order-a'}:null};
  const config={id:'config-a',capability:'file',provider:'s3_compatible',settings:{endpoint:'https://objects.example.test',bucket:'synthetic-bucket',region:'us-east-1',forcePathStyle:true},credentials:{accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret'}};
  const {fileStorageLocationHash}=require('../apps/api/src/modules/integrations/file-content-binding');
  asset.metadata={fileUploadVersion:2,fileContentVersion:1,contentHash:digest,stagingStorageKey:staging,storageLocationHash:fileStorageLocationHash(config)};
  const at=new Date('2026-10-08T00:00:00Z'), request=s3ObjectReadRequest(config,storageKey,at);
  assert.equal(new URL(request.url).search,''); assert.match(request.headers.Authorization,/^AWS4-HMAC-SHA256 /);
  assert.equal(request.headers['x-amz-date'],'20261008T000000Z');
  assert.throws(()=>s3ObjectReadRequest(config,'../escape',at));
  let calls=0,startedResolve;const started=new Promise(resolve=>{startedResolve=resolve;});let hang=false,body=png;
  const producer=new TenantInspectionObjectReader(f.db,{runtimeConfig:async()=>structuredClone(config)},async(url,init)=>{
    calls++;assert.equal(url,request.url);assert.equal(init.redirect,'error');assert.equal(new URL(url).search,'');
    if(hang){startedResolve();return new Promise(()=>{});}
    return new Response(body,{headers:{'content-type':'image/png','content-length':String(png.length)}});
  },async url=>url,()=>at); // Explicit transport/egress mocks: no DNS or connection.
  const storage=new FileStorageRuntimeService(f.db,{runtimeConfig:async()=>structuredClone(config)},undefined,producer);
  const actual=await storage.readInspectionBytes('tenant-a','file-a',{businessType:'rental_order',businessId:'order-a',workspaceId:'workspace-a',actorUserId:f.state.user.id,uploadScene:'return-evidence'},png.length,new AbortController().signal);
  assert.deepEqual(actual.bytes,png);
  const ref={tenantId:'tenant-a',workspaceId:'workspace-other',fileAssetId:'file-a',provider:'s3_compatible',storageKey};
  await assert.rejects(producer.open(ref,new AbortController().signal));assert.equal(calls,1);
  const originalMetadata=structuredClone(asset.metadata);
  for(const changed of [{fileContentVersion:undefined},{contentHash:'0'.repeat(64)},{storageLocationHash:'changed'}]){
    asset.metadata={...originalMetadata,...changed};
    await assert.rejects(producer.open({...ref,workspaceId:'workspace-a'},new AbortController().signal));
  }
  asset.metadata=originalMetadata;assert.equal(calls,1,'missing freeze evidence fails before transport');
  body=Buffer.from(png);body[body.length-1]^=1;
  await assert.rejects(async()=>readInspectionMedia(await producer.open({...ref,workspaceId:'workspace-a'},new AbortController().signal),png.length,new AbortController().signal));
  body=png;assert.equal(calls,2,'same-length changed content cannot become a new evidence digest');
  hang=true;const control=new AbortController(), pending=producer.open({...ref,workspaceId:'workspace-a'},control.signal);
  await started;control.abort();await assert.rejects(pending);assert.equal(calls,3);
});
function mediaFixture(bytes=png){
  const f=fixture();
  f.db.rentalOrder={findFirst:async({where})=>where.id==='order-a'&&where.tenantId==='tenant-a'&&where.workspaceId==='workspace-a'?{id:'order-a'}:null};
  const calls=[];
  const storage=new FileStorageRuntimeService(f.db,{runtimeConfig:async()=>({provider:'synthetic-controlled-provider'})},undefined,
    {open:async(ref,signal)=>{assert.equal(signal.aborted,false);calls.push(structuredClone(ref));return stream(bytes);}});
  f.services=composeInspectionAssist({...f.ports,storage});return {...f,calls,storage};
}
function wavFixtureBytes(){
  const bytes=Buffer.alloc(1644);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(8000,24);
  bytes.writeUInt32LE(16000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(1600,40);
  return bytes;
}
test('PCM WAV framing is checked by both the original object reader and Gateway protocol input', async()=>{
  const {modelProtocolRequestSchema}=require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const {createHash}=require('node:crypto');
  const request=bytes=>({callId:'wav-framing',model:'synthetic/model',maxOutputTokens:32,features:['audio'],messages:[{role:'user',content:[{
    kind:'audio',mediaType:'audio/wav',attachmentId:'file-a',attachmentRevision:1,
    contentHash:createHash('sha256').update(bytes).digest('hex'),data:bytes.toString('base64')}]}]});
  const valid=wavFixtureBytes();assert.equal((await readInspectionMedia(stream(valid),valid.length,new AbortController().signal)).durationMs,100);
  assert.equal(modelProtocolRequestSchema.safeParse(request(valid)).success,true);
  const badBlock=Buffer.from(valid);badBlock.writeUInt16LE(1,32);
  const incompleteFrame=Buffer.from(valid.subarray(0,valid.length-1));incompleteFrame.writeUInt32LE(incompleteFrame.length-8,4);incompleteFrame.writeUInt32LE(1599,40);
  const duplicateFormat=Buffer.concat([valid.subarray(0,36),valid.subarray(12,36),valid.subarray(36)]);duplicateFormat.writeUInt32LE(duplicateFormat.length-8,4);
  for(const bytes of [badBlock,incompleteFrame,duplicateFormat]){
    await assert.rejects(readInspectionMedia(stream(bytes),bytes.length,new AbortController().signal));
    assert.equal(modelProtocolRequestSchema.safeParse(request(bytes)).success,false);
  }
});
test('frozen WAV inspection uses original audio runner and persisted measured result', {timeout:30000}, async()=>{
  const bytes=wavFixtureBytes();
  const f=mediaFixture(bytes),{modelHostHarness}=require('./fixtures/ai-native/task-model-host.cjs');
  const h=await modelHostHarness('audio');h.identity.user.permissions.push('rental-os:order:return');
  // Same active-snapshot support as the original image composition below:
  // nested evidence reads must not wait behind their own serialized DB double.
  const transactionContext=new (require('node:async_hooks').AsyncLocalStorage)(),transaction=h.db.$transaction.bind(h.db);
  h.db.$transaction=callback=>transactionContext.getStore()?callback(transactionContext.getStore())
    :transaction(tx=>transactionContext.run(tx,()=>callback(tx)));
  f.state.user.id='user-a';Object.assign(f.state.assets.get('file-a'),{uploadedBy:'user-a',mimeType:'audio/wav',sizeBytes:bytes.length});
  const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
  f.services=composeInspectionAssist({...f.ports,storage:f.storage,credentials:h.config.credentials,
    guard:new ApiAuthGuard(h.config.auth,undefined,undefined,undefined,{rentalOrder:f.db.rentalOrder}),
    recognitionResults:{db:h.db,auth:h.config.auth,subscriptions:h.config.subscriptions,clock:h.config.clock,
      financialEvidence:h.financial,policy:{kind:'audio',sceneCode:h.config.gatewayScene.sceneCode,maxOutputTokens:64}}});
  const ref=await f.services.evidence.bind({...target,attachmentId:'file-a'}),d=await draft(f,[ref]);
  const frozen=await f.services.recognition.prepare({...target,draftId:d.result.draftId,expectedRevision:1,
    operationId:'original-audio',question:'List candidate spoken readings only.'},new AbortController().signal);
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(detail.state.recognitionInputs[0].media[0].durationMs,100);
  const candidate={candidateId:'audio-original',fieldCode:'mileage',status:'candidate',value:{kind:'number',value:43},
    confidence:0.8,sources:[{...ref,kind:'audio',span:{startMs:0,endMs:100}}]};
  const unclear={candidateId:'audio-unclear',fieldCode:'mileage',status:'blurred',reason:'Original spoken reading unclear',sources:candidate.sources};
  h.modelControl.result.text=JSON.stringify([unclear]);h.state.aiTask[0].inputRef=frozen.inputId;
  const {task:originalTask,...dependencies}=h.config,{material:ignored,...task}=originalTask;
  const reference={...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision};
  const {composeInspectionRecognitionTaskHost}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const root=await composeInspectionRecognitionTaskHost(f.services.recognition,reference,{...dependencies,task,
    inputSource:f.services.recognitionResults.inputSource(reference)});
  assert.equal((await root.application.start(h.query)).outcome.status,'paused');
  assert.equal(h.modelControl.sent.length,1);assert.equal(h.modelControl.sent[0].messages[0].content[1].data,bytes.toString('base64'));
  assert.equal(h.state.aiStep[0].toolCode,'ai.model.audio');assert.equal(h.state.aiGatewayAccountingReceipt.length,1);
  const resultRef={...reference,taskId:h.query.taskId,resultId:h.state.aiTaskResultArtifact[0].id};
  const result=await f.services.recognitionResults.read(resultRef);assert.equal(result.status,'available');
  assert.equal(result.recognitionEvidence,'persisted_audio_step');assert.deepEqual(result.candidates,[unclear]);
  const pending=await root.application.readInput({taskId:h.query.taskId});
  h.modelControl.result.text=JSON.stringify([candidate]);
  const submission={draftVersion:h.contract.draftVersion,taskId:h.query.taskId,requestId:pending.requestId,
    expectedRevision:pending.revision,submissionKey:'audio-answer-original',
    answers:[{fieldId:'clarification_text',value:'Please recheck the original spoken reading.'}]};
  assert.equal((await root.application.resume(submission)).continuation.outcome.status,'succeeded');
  assert.equal(h.modelControl.sent.length,2);assert.equal(h.state.aiTaskExecutionBudget.length,1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,2n);
  assert.equal((await f.services.recognitionResults.read({...resultRef,resultId:h.state.aiTaskResultArtifact.at(-1).id})).status,'available');
  assert.deepEqual((await f.services.drafts.read({...target,draftId:d.result.draftId})).state,detail.state);
  const {parseTaskModelInput}=require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const mismatched=structuredClone(h.state.aiTaskActionInput[0].payload);
  mismatched.media[0].kind='image';mismatched.media[0].mediaType='image/png';
  assert.throws(()=>parseTaskModelInput(mismatched,{kind:'audio',sceneCode:h.config.gatewayScene.sceneCode,maxOutputTokens:64}),
    {code:'INVALID_REQUEST'});
  h.identity.session=false;await assert.rejects(f.services.recognitionResults.read(resultRef));
});
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
  const originalInspection={controller,receipts:new RentalIdempotencyRepository(f.db)};
  f.services=composeInspectionAssist({...f.ports,originalInspection});
  return {...f,originalInspection,receipts,calls:()=>calls,lookups:()=>lookups};
}
async function prepared(f){
  const d=await draft(f);
  const result=await f.services.submission.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'prepare-a',actionId:'handover-original',handoverSignatureFileAssetId:'signature-a'});
  return {...target,draftId:result.draftId,expectedRevision:result.revision,operationId:'submit-a'};
}

test('submission HTTP contracts preserve preparation, original business receipts and unknown recovery',async t=>{
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const {StaffInspectionAssistController}=require('../apps/api/src/modules/ai-native/inspection-assist/staff-inspection-assist.controller');
  const {inspectionLifecycleResponse}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-lifecycle-http.contract');
  const shared=require('@rental-os/shared'),{OPENAPI_DOCUMENT}=require('../apps/api/src/contracts/openapi-document');
  const f=submissionFixture('lost'),factory=new StaffInspectionRequestFactory({...f.ports,originalInspection:f.originalInspection});
  const http=new StaffInspectionAssistController(factory,true),request={headers:{authorization:(await f.ports.credentials.current()).authorization}};
  const call=(op,body)=>http.consume(request,op,body);
  const errors=(status,code,next)=>e=>e.getStatus()===status&&e.getResponse().code===code&&(!next||e.getResponse().nextAction===next);
  const d=await draft(f),selection={...target,draftId:d.result.draftId};
  assert.equal((await call('submission-read',selection)).status,'not_prepared');
  // Begin at the last preparable revision: prepare 997->998, claim ->999,
  // link ->1000. The public submit boundary must not strand the prepared row.
  f.state.drafts.get(d.result.draftId).revision=997;
  const command={...selection,operationId:'http-prepare',expectedRevision:997,actionId:'http-original',handoverSignatureFileAssetId:'signature-a'};
  const prepared=await call('submission-prepare',command);
  assert.equal(prepared.status,'prepared');assert.equal(prepared.mode,'original_single');assert.equal(f.calls(),0);
  assert.equal((await call('submission-read',selection)).status,'submission_unknown');
  const preparation=await call('submission-preparation',{kind:'prepare',request:command});
  assert.equal(preparation.result.revision,998);assert.equal(preparation.execution,'not_attested');
  assert.equal((await call('submission-preparation',{kind:'prepare',request:{...command,operationId:'absent'}})).status,'absent');
  const submit={...selection,operationId:'http-submit',expectedRevision:998};
  await assert.rejects(call('submission-submit',{...submit,expectedRevision:999}),errors(400,'AI_INVALID_INPUT'));
  await assert.rejects(call('submission-submit',{...submit,approved:true}),errors(400,'AI_INVALID_INPUT'));
  assert.equal(f.calls(),0);
  const original=factory.withRequest.bind(factory);
  const corrupt=t.mock.method(factory,'withRequest',async(...args)=>({...await original(...args),internalAudit:'private'}));
  await assert.rejects(call('submission-submit',submit),errors(409,'AI_RESULT_UNKNOWN','submission-read'));
  corrupt.mock.restore();
  assert.equal(f.calls(),1);
  const observation=await call('submission-read',selection);
  assert.equal(observation.status,'submitted');assert.equal(observation.inspectionId,'inspection-original');assert.equal(observation.draftLinked,true);
  assert.equal(observation.revision,1000);
  assert.equal((await call('submission-submit',submit)).status,'submission_unknown','replayed claim is not another submission');
  assert.equal(f.calls(),1);
  const before=f.state.operations.size;
  assert.equal((await call('submission-preparation',{kind:'prepare',request:command})).result.revision,998);
  assert.equal(f.state.operations.size,before);
  assert.throws(()=>inspectionLifecycleResponse('submission-prepare',{...prepared,mode:'manual_review_only'},command),{code:'RECONCILIATION_REQUIRED'});
  assert.throws(()=>inspectionLifecycleResponse('submission-read',{...observation,draftId:'foreign'},selection),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionLifecycleResponse('submission-read',{...observation,status:'submission_unknown',draftLinked:true},selection),{code:'STORAGE_UNAVAILABLE'});
  const badRead=t.mock.method(factory,'withRequest',async(...args)=>({...await original(...args),internalAudit:'private'}));
  await assert.rejects(call('submission-read',selection),errors(503,'AI_STORAGE_UNAVAILABLE'));badRead.mock.restore();
  for(const [op,contract]of Object.entries(shared.AI_INSPECTION_LIFECYCLE_HTTP_CONTRACTS)){
    const route=OPENAPI_DOCUMENT.paths[`/api/${shared.AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}/${op}`].post;
    assert.equal(route.requestBody.content['application/json'].schema.$ref,`#/components/schemas/${contract.request}`);
    assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref,`#/components/schemas/${contract.response}`);
  }
  f.state.user.permissions=['rental-os:order:view'];
  await assert.rejects(call('submission-read',selection),errors(403,'AI_ACCESS_DENIED'));
  assert.equal(f.calls(),1);
  const multiple=submissionFixture();multiple.order.allocations.push({...multiple.order.allocations[0],id:'allocation-b',assetId:'asset-b'});
  const md=await draft(multiple),mhttp=new StaffInspectionAssistController(new StaffInspectionRequestFactory({...multiple.ports,originalInspection:multiple.originalInspection}),true);
  const mr={headers:{authorization:(await multiple.ports.credentials.current()).authorization}},mselection={...target,draftId:md.result.draftId};
  const reviewCommand={...mselection,operationId:'review-http',expectedRevision:1,actionId:'review-only'};
  const reviewed=await mhttp.consume(mr,'submission-review',reviewCommand);
  assert.equal(reviewed.mode,'manual_review_only');assert.equal(multiple.calls(),0);
  const unknown=await mhttp.consume(mr,'submission-read',mselection);
  assert.equal(unknown.status,'submission_unknown');assert.equal(unknown.draftLinked,false);
  assert.equal((await mhttp.consume(mr,'submission-preparation',{kind:'prepareReview',request:reviewCommand})).mode,'manual_review_only');
  await assert.rejects(mhttp.consume(mr,'submission-submit',{...mselection,expectedRevision:2,operationId:'no-aggregate'}),errors(503,'AI_RESOURCE_UNAVAILABLE'));
  assert.equal(multiple.calls(),0);
});

test('employee review consumes original receipt without submitting or back-writing the draft',async()=>{
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const f=submissionFixture('lost'),input=await prepared(f);
  const submitted=await f.services.submission.submit(input);
  assert.equal(submitted.status,'submitted');
  const credential=await f.ports.credentials.current();
  const controller={createInspection:async()=>assert.fail('read must not dispatch')};
  const host=new StaffInspectionRequestFactory({...f.ports,originalInspection:{controller,receipts:new RentalIdempotencyRepository(f.db)}})
    .open({headers:{authorization:credential.authorization},requestId:'employee-receipt'});
  const query={...target,draftId:input.draftId},before=structuredClone(f.state.drafts.get(input.draftId)),operationCount=f.state.operations.size;
  const observed=await host.readCurrentReview(query,true);
  assert.equal(observed.receipt.status,'submitted');assert.equal(observed.receipt.inspectionId,'inspection-original');
  assert.equal(observed.review.next,'read_original_inspection');assert.equal(observed.businessActionRequested,false);
  assert.deepEqual(f.state.drafts.get(input.draftId),before);assert.equal(f.state.operations.size,operationCount);assert.equal(f.calls(),1);
  f.state.user.permissions=['rental-os:order:view'];
  assert.equal((await host.readCurrentReview(query)).receipt.status,'not_requested');
  await assert.rejects(host.readCurrentReview(query,true),{code:'ACCESS_DENIED'});
  host.close();await assert.rejects(host.readCurrentReview(query),{code:'ACCESS_DENIED'});
  const missing=submissionFixture('absent'),unknown=await prepared(missing);
  assert.equal((await missing.services.submission.submit(unknown)).status,'submission_unknown');
  const snapshot=structuredClone(missing.state.drafts.get(unknown.draftId));
  assert.equal((await missing.services.submission.readReceipt({...target,draftId:unknown.draftId})).status,'not_observed');
  assert.deepEqual(missing.state.drafts.get(unknown.draftId),snapshot);assert.equal(missing.calls(),1);
});

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
  const mediaInput={...target,draftId:d.result.draftId,inputId:result.inputId,expectedRevision:detail.revision};
  const bound=await f.services.recognition.gatewayMedia(mediaInput);
  assert.equal(bound.input.inputFingerprint,frozen.inputFingerprint);
  const {prepareGatewayIntent}=require('../apps/api/src/modules/ai-native/gateway-intent');
  const context={tenantId:'tenant-a',workspaceId:'workspace-a',actorId:f.state.user.id};
  const intent={draftVersion:'ain-c03-draft-2',requestId:'media-original',sceneCode:'inspection.recognize',
    messages:[{role:'user',content:[{kind:'text',text:frozen.question},{kind:'image',...ref}]}],
    requiredFeatures:['text','image'],optionalFeatures:[],maxOutputTokens:100};
  const prepared=await prepareGatewayIntent(intent,{sceneCode:intent.sceneCode,maxOutputTokens:100},'invoke',context,bound.media);
  assert.equal(prepared.request.messages[0].content[1].contentHash,frozen.media[0].contentHash);
  assert.notEqual(prepared.intentHash,requestFingerprint({intent,mode:'invoke'})); // Evidence digest is part of the invocation identity.
  assert.equal(prepared.request.messages[0].content[1].data,png.toString('base64'));assert.equal(f.calls.length,2);
  await assert.rejects(bound.media.resolve({...context,workspaceId:'other'}, {kind:'image',...ref},new AbortController().signal));
  assert.equal(f.calls.length,2);
  f.state.active=false;
  await assert.rejects(bound.media.resolve(context,{kind:'image',...ref},new AbortController().signal));
  assert.equal(f.calls.length,2);
  f.state.active=true;f.state.drafts.get(d.result.draftId).revision++;
  await assert.rejects(bound.media.resolve(context,{kind:'image',...ref},new AbortController().signal));
  assert.equal(f.calls.length,2);
});
for(const mediaKind of ['image','audio']) test(`original inspection frozen ${mediaKind} creates a real model runner host without changing inspection fields`,{timeout:30000},async t=>{
  const bytes=mediaKind==='audio'?wavFixtureBytes():png;
  const f=mediaFixture(bytes);f.state.user.id='user-a';Object.assign(f.state.assets.get('file-a'),{
    uploadedBy:'user-a',mimeType:mediaKind==='audio'?'audio/wav':'image/png',sizeBytes:bytes.length});
  await assert.rejects(f.services.recognitionResults.read({...target,draftId:'not-read',inputId:'not-read',expectedRevision:1,
    taskId:'task-a',resultId:'result-a'}),{code:'STORAGE_UNAVAILABLE'});
  const {modelHostHarness}=require('./fixtures/ai-native/task-model-host.cjs');
  const h=await modelHostHarness(mediaKind);h.identity.user.permissions.push('rental-os:order:return');
  const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
  f.services=composeInspectionAssist({...f.ports,storage:f.storage,credentials:h.config.credentials,
    guard:new ApiAuthGuard(h.config.auth,undefined,undefined,undefined,{rentalOrder:f.db.rentalOrder}),
    recognitionResults:{db:h.db,auth:h.config.auth,subscriptions:h.config.subscriptions,clock:h.config.clock,
      financialEvidence:h.financial,policy:{kind:'image',sceneCode:mediaKind==='audio'?'image-only':h.config.gatewayScene.sceneCode,
        maxOutputTokens:h.config.gatewayScene.maxOutputTokens}},
    ...(mediaKind==='audio'?{audioRecognitionResults:{db:h.db,auth:h.config.auth,subscriptions:h.config.subscriptions,clock:h.config.clock,
      financialEvidence:h.financial,policy:{kind:'audio',sceneCode:h.config.gatewayScene.sceneCode,maxOutputTokens:h.config.gatewayScene.maxOutputTokens}}}:{})});
  const ref=await f.services.evidence.bind({...target,attachmentId:'file-a'});
  const candidate={candidateId:'vision-original',fieldCode:'mileage',status:'candidate',value:{kind:'number',value:43},confidence:0.8,
    sources:[mediaKind==='audio'?{...ref,kind:'audio',span:{startMs:0,endMs:100}}:{...ref,kind:'image',region:{x:0,y:0,width:1,height:1}}]};
  h.modelControl.result.text=JSON.stringify([candidate]);
  const d=await draft(f,[ref]);
  const frozen=await f.services.recognition.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'original-vision',question:'List candidate readings only.'},new AbortController().signal);
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  const {composeInspectionRecognitionTaskHost}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  // Actual task creation repository + original staff Auth/Guard and frozen input.
  // Only database/storage/transport are doubles; creating metadata must not send a model call.
  const {InspectionRecognitionTaskApplication}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-recognition-task.application');
  const {AuthService}=require('../apps/api/src/modules/auth/auth.service');
  const staffAuth=new AuthService({getAuthSession:async()=>f.state.active?{id:'staff-session',userId:f.state.user.id,audience:'staff',currentWorkspaceId:f.state.workspace}:undefined,
    findUserById:async()=>f.state.user,findWorkspaceScopedUser:async()=>f.state.user,listUserWorkspaces:async()=>[]},
    {get:key=>key==='AUTH_TOKEN_SECRET'?'synthetic-staff-task-secret':undefined});
  const staffGuard=new ApiAuthGuard(staffAuth,undefined,undefined,undefined,{rentalOrder:f.db.rentalOrder});
  // The serialized DB double must allow read-only entitlement revalidation
  // from inside task creation, rather than queue it behind its own transaction.
  const transactionContext=new (require('node:async_hooks').AsyncLocalStorage)();
  const withTaskRuns=db=>({...db.aiTask,findFirst:async args=>{
    if(!args.select?.runs)return db.aiTask.findFirst(args);
    const {runs,...select}=args.select, row=await db.aiTask.findFirst({...args,select:{...select,id:true}});
    return row?{...row,runs:await db.aiRun.findMany({where:{taskId:row.id,...runs.where},select:runs.select,take:runs.take})}:null;
  }});
  const combinedDb={...f.db,...h.db,$transaction:callback=>transactionContext.getStore()
    ? callback(transactionContext.getStore()) : h.db.$transaction(tx=>{const current={...f.db,...tx,
    aiScope:{...tx.aiScope,upsert:async args=>{const row=await tx.aiScope.findFirst({where:args.where,select:args.select});assert.ok(row);return row;}},
    aiTask:{...withTaskRuns(tx),create:async args=>tx.aiTask.create({...args,data:{...args.data,archivedAt:null,
      scope:await tx.aiScope.findFirst({where:{id:args.data.scopeId}})}})}};
      return transactionContext.run(current,()=>callback(current));})};
  combinedDb.aiTask=withTaskRuns(h.db);
  // Real nested evidence readers need the active transaction snapshot in this
  // serialized offline DB, not a second queue entry waiting behind itself.
  const modelTransaction=h.db.$transaction.bind(h.db);
  h.db.$transaction=callback=>transactionContext.getStore()
    ? callback(transactionContext.getStore())
    : modelTransaction(tx=>transactionContext.run(tx,()=>callback(tx)));
  const {credentials:_modelCredentials,task:_modelTask,kind:_modelKind,...staffModel}=h.config;
  const taskDependencies={enabled:true,inspection:{...f.ports,credentials:undefined,db:combinedDb,guard:staffGuard,storage:f.storage},
    model:{...staffModel,db:combinedDb,auth:staffAuth,guard:staffGuard},limits:h.config.task.limits};
  if(mediaKind==='audio') {
    taskDependencies.audioModel=taskDependencies.model;
    taskDependencies.model={...taskDependencies.model,scene:{...staffModel.scene,code:'image-only'},
      gatewayScene:{...staffModel.gatewayScene,sceneCode:'image-only'}};
  }
  delete taskDependencies.inspection.credentials;
  const staffTasks=new InspectionRecognitionTaskApplication(taskDependencies);
  const staffRequest={headers:{authorization:`Bearer ${staffAuth.signAccessToken({sub:'user-a',tid:'tenant-a',sid:'staff-session',wid:f.state.workspace,aud:'staff',exp:Math.floor(Date.now()/1000)+600})}`}};
  await assert.rejects(staffTasks.create(staffRequest,{...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision}));
  const staffServices=composeInspectionAssist({...f.ports,guard:staffGuard,storage:f.storage,
    credentials:{current:async()=>({authorization:staffRequest.headers.authorization,requestId:'staff-request',audience:'staff'})}});
  const {StaffInspectionRequestFactory,InspectionAssistModule}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const {StaffInspectionAssistController}=require('../apps/api/src/modules/ai-native/inspection-assist/staff-inspection-assist.controller');
  const {credentials:discardCredentials,...originalPorts}=f.ports;
  const staffDependencies={...originalPorts,guard:staffGuard,storage:f.storage};
  const requests=new StaffInspectionRequestFactory(staffDependencies), assist=new StaffInspectionAssistController(requests,true);
  assert.equal(InspectionAssistModule.registerStaffHttp(staffDependencies,{enabled:true}).controllers[0],StaffInspectionAssistController);
  assert.throws(()=>InspectionAssistModule.registerStaffHttp(staffDependencies,{enabled:false}),{code:'STORAGE_UNAVAILABLE'});
  await assert.rejects(assist.consume(staffRequest,'gateway-media',target),error=>error.getStatus()===400);
  await assert.rejects(assist.consume({headers:{}},'template-read',target),error=>error.getStatus()===403);
  await assert.rejects(new StaffInspectionAssistController(requests,false).consume(staffRequest,'template-read',target),error=>error.getStatus()===503);
  f.state.assets.set('staff-file',{...structuredClone(f.state.assets.get('file-a')),id:'staff-file'});
  const staffRef=await assist.consume(staffRequest,'evidence-bind',{...target,attachmentId:'staff-file'});
  const staffBinding=await assist.consume(staffRequest,'template-read',target);
  const staffDraft=await assist.consume(staffRequest,'draft-create',{...target,operationId:'staff-create',bindingFingerprint:staffBinding.bindingFingerprint,
    results:{mileage:42},evidence:[staffRef]});
  const staffFrozen=await assist.consume(staffRequest,'input-prepare',{...target,draftId:staffDraft.draftId,expectedRevision:1,
    operationId:'staff-vision',question:'List candidate readings only.'});
  const originalPreparation={...target,draftId:staffDraft.draftId,expectedRevision:1,operationId:'staff-vision',question:'List candidate readings only.'};
  const preparationReceipt=await assist.consume(staffRequest,'input-receipt',originalPreparation);
  assert.equal(preparationReceipt.status,'found');assert.equal(preparationReceipt.inputId,staffFrozen.inputId);
  assert.equal(preparationReceipt.retryable,false);assert.equal(h.modelControl.sent.length,0);
  const absentPreparation=await assist.consume(staffRequest,'input-receipt',{...originalPreparation,operationId:'never-prepared'});
  assert.equal(absentPreparation.status,'absent');assert.equal(absentPreparation.retryable,false);
  const staffDetail=await assist.consume(staffRequest,'draft-read',{...target,draftId:staffDraft.draftId});
  let closed;await requests.withRequest(staffRequest,async services=>{closed=services;});
  await assert.rejects(closed.templates.read(target)); // Credentials are revoked on request completion.
  const originalReference={...target,draftId:staffDraft.draftId,inputId:staffFrozen.inputId,expectedRevision:staffDetail.revision};
  const taskReceipt=await staffTasks.create(staffRequest,originalReference);
  assert.equal(taskReceipt.task.status,'queued');assert.equal(taskReceipt.execution,'not_attested');
  assert.notEqual(taskReceipt.task.taskId,'task-a');assert.equal(h.modelControl.sent.length,0);
  const replay=await staffTasks.create(staffRequest,originalReference);
  assert.equal(replay.task.taskId,taskReceipt.task.taskId);
  assert.equal((await staffTasks.readCreation(staffRequest,originalReference)).state,'observed');
  const {InspectionRecognitionTaskController}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-recognition-task.controller');
  const {InspectionRecognitionTaskModule}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-recognition-task.application');
  const {ExecutionContextHost}=require('@nestjs/core/helpers/execution-context-host');
  const {runWithRequestIdentity}=require('../apps/api/src/common/request-identity');
  const http=new InspectionRecognitionTaskController(staffTasks);
  const outer={...staffRequest,path:'/staff/v1/ai-native/inspection-tasks/creation/read',
    url:'/api/staff/v1/ai-native/inspection-tasks/creation/read',
    originalUrl:'/api/staff/v1/ai-native/inspection-tasks/creation/read',method:'POST',body:originalReference,query:{}};
  require('../apps/api/src/common/staff-api-routing').staffApiRoutingMiddleware(outer,{},()=>{});
  assert.equal(outer.url,outer.originalUrl);assert.equal(outer.staffApiRequest,true);
  await runWithRequestIdentity({},async()=>{assert.equal(await staffGuard.canActivate(new ExecutionContextHost([outer])),true);
    assert.equal((await http.readCreation(outer,originalReference)).state,'observed');});
  assert.equal((await http.create(staffRequest,originalReference)).task.taskId,taskReceipt.task.taskId);
  const validCreate=staffTasks.create.bind(staffTasks), taskCountBeforeCorruption=h.state.aiTask.length;
  const corruptCreate=t.mock.method(staffTasks,'create',async(...args)=>({...await validCreate(...args),internal:'never public'}));
  await assert.rejects(http.create(staffRequest,originalReference),error=>error.getStatus()===409&&error.getResponse().nextAction==='read_creation');
  corruptCreate.mock.restore();
  assert.equal((await http.readCreation(staffRequest,originalReference)).task.taskId,taskReceipt.task.taskId);
  assert.equal(h.state.aiTask.length,taskCountBeforeCorruption);
  await assert.rejects(http.create({headers:{}},originalReference),error=>error.getStatus()===403&&error.getResponse().retryable===false);
  await assert.rejects(http.requestCancel(staffRequest,{reference:originalReference,expectedRevision:1,actor:'forged'}),error=>error.getStatus()===400);
  assert.equal(InspectionRecognitionTaskModule.registerHttp(taskDependencies).controllers[0],InspectionRecognitionTaskController);
  assert.throws(()=>InspectionRecognitionTaskModule.registerHttp({...taskDependencies,enabled:false}),{code:'AI_RESOURCE_UNAVAILABLE'});
  const {isStaffBusinessRouteAllowed}=require('../apps/api/src/common/staff-api-policy');
  const assistOuter={...outer,url:'/api/staff/v1/ai-native/inspection-assist/draft-read',
    originalUrl:'/api/staff/v1/ai-native/inspection-assist/draft-read',body:{...target,draftId:staffDraft.draftId}};
  require('../apps/api/src/common/staff-api-routing').staffApiRoutingMiddleware(assistOuter,{},()=>{});
  assert.equal(assistOuter.url,assistOuter.originalUrl);
  await runWithRequestIdentity({},async()=>{assert.equal(await staffGuard.canActivate(new ExecutionContextHost([assistOuter])),true);
    assert.equal((await assist.consume(assistOuter,'draft-read',assistOuter.body)).draftId,staffDraft.draftId);});
  assert.equal(isStaffBusinessRouteAllowed('POST','/staff/v1/ai-native/inspection-assist/gateway-media'),false);
  assert.equal(isStaffBusinessRouteAllowed('POST','/staff/v1/ai-native/inspection-tasks/submit-inspection'),false);
  assert.equal(isStaffBusinessRouteAllowed('GET',outer.path),false);
  // No fabricated action policy for the new task: metadata creation grants no execution permission.
  await assert.rejects(staffTasks.start(staffRequest,originalReference));assert.equal(h.modelControl.sent.length,0);
  if(mediaKind==='image') {
    const {composeStandardStaffRecognition,STAFF_RECOGNITION_SCENES}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-standard.application');
    const {AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS,AI_INSPECTION_TASK_HTTP_CONTRACTS,AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT:routes}=require('@rental-os/shared');
    const contracts={...AI_INSPECTION_CANCELLATION_HTTP_CONTRACTS,...AI_INSPECTION_TASK_HTTP_CONTRACTS};
    const {OPENAPI_DOCUMENT}=require('../apps/api/src/contracts/openapi-document');
    for(const [action,contract] of Object.entries(contracts)) {
      const operation=OPENAPI_DOCUMENT.paths[`/api/${routes.basePath}/${routes[action]}`].post;
      assert.equal(operation.requestBody.content['application/json'].schema.$ref,`#/components/schemas/${contract.request}`);
      assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref,`#/components/schemas/${contract.response}`);
    }
    // This separate never-started task has no model/step/budget evidence. Its
    // original association is a declared database fixture for the standard host.
    const owned=h.state.aiTask.find(row=>row.id===taskReceipt.task.taskId);
    const {composeStaffInspectionTaskPolicies}=require('../apps/api/src/modules/ai-native/staff-inspection-task-policy.composition');
    const {StaffInspectionTaskPolicyController}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-task-policy.controller');
    const policies=composeStaffInspectionTaskPolicies(taskDependencies,{enabled:true,ttlMs:120000,
      operations:['read_metadata','read_events','transition_task','read_step_terminal']});
    const policyHttp=new StaffInspectionTaskPolicyController(policies);
    const {PrismaTaskActionPolicyRepository}=require('../apps/api/src/modules/ai-native/prisma-task-action-policy.repository');
    const {AiScopeRepository}=require('../apps/api/src/modules/ai-native/ai-scope.repository');
    const {AiTaskCurrentIdentityAuthority}=require('../apps/api/src/modules/ai-native/task-current-identity.authority');
    const {InspectionActionAuthority}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-action.authority');
    const receiptCredentials={current:async()=>({authorization:staffRequest.headers.authorization,
      audience:'staff',requestId:'staff-policy-receipt-read'})};
    const receiptScopes=new AiScopeRepository(combinedDb,
      new AiTaskCurrentIdentityAuthority(staffAuth,receiptCredentials,h.config.clock),h.config.clock);
    const receiptAuthority=new InspectionActionAuthority(staffGuard,receiptCredentials);
    // Repository-level evidence check, not a new HTTP recovery route. It retains
    // real current Auth/Guard; an old receipt is never a new execution grant.
    const receiptRepository=new PrismaTaskActionPolicyRepository(combinedDb,receiptScopes,{resolve:async taskId=>{
      assert.equal(taskId,owned.id);
      await receiptAuthority.withAction(originalReference,'bind',async()=>{});
      return (await receiptScopes.resolveCurrent()).context;
    }},h.config.clock);
    const originalPolicy=(operation,expectedRevision,mutation='configure')=>runWithRequestIdentity({},
      ()=>receiptRepository.readMutation(owned.id,operation,expectedRevision,mutation));
    const policyReceipts=()=>h.state.operationLog.filter(row=>row.action==='ai_native_task_policy_saved');
    const policyBeforeBytes=f.calls.length;
    for(const operation of ['read_metadata','read_events','transition_task']) {
      const command={reference:originalReference,operation};
      assert.equal((await policyHttp.read(staffRequest,command)).result.state,'not_observed');
      const saved=await policyHttp.configure(staffRequest,{...command,expectedRevision:null});
      assert.equal(saved.result.taskId,owned.id);assert.equal(saved.result.revision,1);
      assert.deepEqual(saved.result.requiredPermissions,['rental-os:order:view','rental-os:order:return']);
      const original=await originalPolicy(operation,null);
      assert.equal(original.state,'recorded');assert.deepEqual(original.policy,saved.result);assert.equal(original.retryable,false);
      assert.equal((await originalPolicy(operation,1,'clear')).state,'not_observed');
      assert.equal((await policyHttp.read(staffRequest,command)).result.policy.revision,1);
      const receiptCount=policyReceipts().length;
      await assert.rejects(policyHttp.configure(staffRequest,{...command,expectedRevision:null}),error=>error.getStatus()===409);
      assert.equal(policyReceipts().length,receiptCount,'CAS conflict cannot append a second mutation receipt');
    }
    const toClear={reference:originalReference,operation:'read_step_terminal',expectedRevision:null};
    await assert.rejects(policyHttp.configure(staffRequest,{...toClear,requiredPermissions:['root']}),error=>error.getStatus()===400);
    const originalConfigured=await policyHttp.configure(staffRequest,toClear);
    const clearResponse=await policyHttp.clear(staffRequest,{...toClear,expectedRevision:1});
    assert.equal(clearResponse.result.revision,2);assert.equal(clearResponse.result.expiresAt,h.config.clock().toISOString());
    assert.deepEqual((await originalPolicy(toClear.operation,null)).policy,originalConfigured.result,
      'later clear cannot substitute the original configure evidence');
    assert.deepEqual((await originalPolicy(toClear.operation,1,'clear')).policy,clearResponse.result);
    assert.equal((await originalPolicy(toClear.operation,1)).state,'not_observed','clear is not configure evidence');
    const policyTransaction=combinedDb.$transaction;
    try {
      combinedDb.$transaction=async callback=>{await policyTransaction(callback);throw Error('policy commit reply lost');};
      await assert.rejects(policyHttp.configure(staffRequest,{...toClear,expectedRevision:2}),
        error=>error.getStatus()===409&&error.getResponse().code==='AI_RESULT_UNKNOWN'&&error.getResponse().retryable===false);
    } finally {combinedDb.$transaction=policyTransaction;}
    const lostConfigure=await originalPolicy(toClear.operation,2);
    assert.equal(lostConfigure.state,'recorded');assert.equal(lostConfigure.policy.revision,3);
    try {
      combinedDb.$transaction=async callback=>{await policyTransaction(callback);f.state.active=false;throw Error('policy clear reply lost');};
      await assert.rejects(policyHttp.clear(staffRequest,{...toClear,expectedRevision:3}),
        error=>error.getStatus()===409&&error.getResponse().code==='AI_RESULT_UNKNOWN'&&error.getResponse().retryable===false);
      await assert.rejects(originalPolicy(toClear.operation,3,'clear'),{code:'AI_ACCESS_DENIED'});
    } finally {combinedDb.$transaction=policyTransaction;f.state.active=true;}
    const lostClear=await originalPolicy(toClear.operation,3,'clear');
    assert.equal(lostClear.state,'recorded');assert.equal(lostClear.policy.revision,4);
    assert.equal(lostClear.policy.expiresAt,h.config.clock().toISOString());
    assert.deepEqual((await originalPolicy(toClear.operation,2)).policy,lostConfigure.policy);
    const beforeUnavailable=structuredClone({policies:h.state.aiTaskActionPolicy,receipts:policyReceipts()});
    const operationLog=combinedDb.operationLog;
    try {
      combinedDb.operationLog=undefined;
      await assert.rejects(policyHttp.configure(staffRequest,{...toClear,expectedRevision:4}),
        error=>error.getStatus()===503&&error.getResponse().code==='AI_RESOURCE_UNAVAILABLE');
      await assert.rejects(policyHttp.clear(staffRequest,{...toClear,expectedRevision:4}),
        error=>error.getStatus()===503&&error.getResponse().code==='AI_RESOURCE_UNAVAILABLE');
    } finally {combinedDb.operationLog=operationLog;}
    // A receipt failure inside the transaction must also roll back the policy.
    try {
      combinedDb.$transaction=callback=>policyTransaction(tx=>callback({...tx,operationLog:{...tx.operationLog,create:undefined}}));
      await assert.rejects(policyHttp.configure(staffRequest,{...toClear,expectedRevision:4}),
        error=>error.getStatus()===503&&error.getResponse().code==='AI_RESOURCE_UNAVAILABLE');
      await assert.rejects(policyHttp.clear(staffRequest,{...toClear,expectedRevision:4}),
        error=>error.getStatus()===503&&error.getResponse().code==='AI_RESOURCE_UNAVAILABLE');
    } finally {combinedDb.$transaction=policyTransaction;}
    assert.deepEqual({policies:h.state.aiTaskActionPolicy,receipts:policyReceipts()},beforeUnavailable);
    for(const row of policyReceipts()) {
      assert.equal(row.tenantId,'tenant-a');assert.equal(row.workspaceId,'workspace-a');assert.equal(row.userId,'user-a');
      assert.equal(row.detail.payloadHash,requestFingerprint(row.detail.payload));
      assert.equal(row.detail.payload.taskId,owned.id);
    }
    assert.equal(f.calls.length,policyBeforeBytes);assert.equal(h.modelControl.sent.length,0);
    const {AI_INSPECTION_TASK_POLICY_HTTP_CONTRACTS:policyContracts,AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT:policyRoutes}=require('@rental-os/shared');
    for(const [action,contract] of Object.entries(policyContracts)) {
      const operation=OPENAPI_DOCUMENT.paths[`/api/${policyRoutes.basePath}/${policyRoutes[action]}`].post;
      assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref,`#/components/schemas/${contract.response}`);
    }
    const {inspectionPolicyResponse}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-task-http.contract');
    assert.throws(()=>inspectionPolicyResponse('clear',{...clearResponse,result:{...clearResponse.result,revision:3}},
      {...toClear,expectedRevision:1}),{code:'RECONCILIATION_REQUIRED'});
    h.state.aiTask.find(row=>row.id===owned.id).sceneCode=STAFF_RECOGNITION_SCENES.image;
    const standard=composeStandardStaffRecognition({db:combinedDb,auth:staffAuth,guard:staffGuard,core:f.ports.core,
      subscriptions:h.config.subscriptions,clock:h.config.clock,files:f.storage,
      secrets:{decrypt:()=>assert.fail('history must not read model credentials')},
      moduleRef:{get:()=>assert.fail('cancellation must not construct Core submission')}},{enabled:false});
    const cancellationHttp=new InspectionRecognitionTaskController(standard.application);
    const selection={reference:originalReference,expectedRevision:1}, beforeBytes=f.calls.length;
    assert.equal((await cancellationHttp.readCreation(staffRequest,originalReference)).task.taskId,owned.id);
    const notCreated=await cancellationHttp.readCreation(staffRequest,{...originalReference,inputId:'never-created-input'});
    assert.equal(notCreated.state,'not_observed');assert.equal(notCreated.task,null);
    const absentAnswer={draftVersion:h.contract.draftVersion,taskId:owned.id,requestId:'no-question',expectedRevision:1,
      submissionKey:'no-answer',answers:[{fieldId:'clarification_text',value:'An original answer only'}]};
    await assert.rejects(cancellationHttp.readAnswer(staffRequest,{reference:originalReference,submission:absentAnswer}),
      error=>error.getResponse().code==='AI_RESOURCE_UNAVAILABLE'); // No original question is not an absent answer receipt.
    const absent=await cancellationHttp.readCancelReceipt(staffRequest,selection);
    assert.equal(absent.status,'not_observed');assert.equal(absent.event,null);
    await assert.rejects(cancellationHttp.requestCancel(staffRequest,{...selection,reference:{...originalReference,taskId:owned.id}}),error=>error.getStatus()===400);
    const originalRequestCancel=standard.application.requestCancel;
    const lost=t.mock.method(standard.application,'requestCancel',async(...args)=>{
      const response=await originalRequestCancel(...args);return {...response,internalPayload:'must-not-leak'};
    });
    await assert.rejects(cancellationHttp.requestCancel(staffRequest,selection),error=>error.getStatus()===409&&error.getResponse().nextAction==='read_cancel_receipt');
    lost.mock.restore();
    const requested=await cancellationHttp.readCancelReceipt(staffRequest,selection);
    assert.equal(requested.status,'observed');assert.equal(requested.event.taskId,owned.id);assert.equal(requested.event.taskRevision,2);
    const eventCount=h.state.aiTaskEvent.length;
    assert.equal((await cancellationHttp.requestCancel(staffRequest,selection)).receipt.event.cursor,requested.event.cursor);
    assert.equal(h.state.aiTaskEvent.length,eventCount);
    const settlement={...selection,expectedRevision:2};
    const settled=await cancellationHttp.settleUnstartedCancellation(staffRequest,settlement);
    assert.equal(settled.receipt.event.data.to,'cancelled');assert.equal(settled.remoteCancellation,'not_attested');
    const observed=await cancellationHttp.readCancellationSettlementReceipt(staffRequest,settlement);
    assert.equal(observed.status,'observed');assert.equal(observed.snapshot.status,'cancelled');
    assert.equal((await cancellationHttp.settleReleasedInputCancellation(staffRequest,settlement)).receipt.event.cursor,observed.event.cursor);
    const eventCountAfterSettlement=h.state.aiTaskEvent.length;
    const {inspectionCancellationResponse}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-task-http.contract');
    for(const corrupt of [value=>{value.expectedRevision++;},value=>{value.event.taskId='foreign-task';},
      value=>{value.snapshot.status='running';},value=>{value.event.data.to='cancel_requested';},value=>{value.snapshot.lease='internal';}]) {
      const invalid=structuredClone(observed);corrupt(invalid);
      assert.throws(()=>inspectionCancellationResponse('readCancellationSettlementReceipt',invalid,2),{code:'AI_STORAGE_UNAVAILABLE'});
    }
    const currentRead=standard.application.readCancelReceipt;
    const altered=t.mock.method(standard.application,'readCancelReceipt',async(...args)=>{
      const response=structuredClone(await currentRead(...args));response.event.taskRevision++;
      return response;
    });
    await assert.rejects(cancellationHttp.readCancelReceipt(staffRequest,selection),error=>error.getStatus()===503);
    altered.mock.restore();
    assert.equal(h.modelControl.sent.length,0);assert.equal(f.calls.length,beforeBytes);
    assert.equal(h.state.aiTaskEvent.length,eventCountAfterSettlement);
    f.state.active=false;
    await assert.rejects(cancellationHttp.readCancelReceipt(staffRequest,selection),error=>error.getStatus()===403);
    f.state.active=true;
  }
  await assert.rejects(staffTasks.create({headers:{}},originalReference));
  await assert.rejects(staffTasks.create(staffRequest,{...originalReference,taskId:'caller-task'}),{code:'AI_INVALID_INPUT'});
  await assert.rejects(new InspectionRecognitionTaskApplication({...taskDependencies,enabled:false}).create(staffRequest,originalReference),{code:'AI_RESOURCE_UNAVAILABLE'});
  const {task:originalTask,...dependencies}=h.config;
  const {material:ignored,...task}=originalTask;
  const unclearCandidate={candidateId:'vision-unclear',fieldCode:'mileage',status:'blurred',reason:'Original meter digits unclear',sources:candidate.sources};
  h.modelControl.result.text=JSON.stringify([unclearCandidate]);
  h.state.aiTask[0].inputRef=frozen.inputId;
  const clarificationSource=f.services.recognitionResults.inputSource({...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision});
  const root=await composeInspectionRecognitionTaskHost(f.services.recognition,{...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision},{...dependencies,inputSource:clarificationSource,task});
  const result=await root.application.start(h.query);
  const {inspectionTaskResponse}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-task-http.contract');
  assert.deepEqual(inspectionTaskResponse('start',result,originalReference),result);
  assert.throws(()=>inspectionTaskResponse('reconcile',{...result,lease:{holderId:'internal'}},originalReference),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(result.outcome.status,'paused');assert.equal(h.modelControl.sent.length,1);
  assert.equal(h.state.aiTaskActionInput[0].payload.media[0].contentHash,detail.state.recognitionInputs[0].media[0].contentHash);
  assert.equal(h.modelControl.sent[0].messages[0].content[1].data,bytes.toString('base64'));
  assert.equal(h.state.aiGatewayAccountingReceipt.length,1);assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,1n);
  assert.deepEqual((await f.services.drafts.read({...target,draftId:d.result.draftId})).state,detail.state);
  const reference={...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision,
    taskId:h.query.taskId,resultId:h.state.aiTaskResultArtifact[0].id};
  const storedInput=h.state.aiTaskActionInput[0].payload, originalInvocation=h.state.aiGatewayInvocation[0];
  for(const [key,expected] of Object.entries({taskId:h.query.taskId,runId:h.query.runId,stepId:h.state.aiStep[0].id,
    actionId:h.state.aiStep[0].actionId,actorId:'user-a',callId:storedInput.intent.requestId,stepFingerprint:h.state.aiStep[0].requestFingerprint,
    intentHash:h.state.aiStep[0].requestFingerprint,mode:storedInput.mode,sceneCode:storedInput.intent.sceneCode,
    priceVersion:storedInput.priceVersion,configurationHash:requestFingerprint(storedInput.configuration)})){
    assert.equal(originalInvocation[key],expected,key);
  }
  assert.equal((await f.services.recognitionResults.read(reference)).status,'available');
  assert.deepEqual((await f.services.recognitionResults.read(reference)).candidates,[unclearCandidate]);
  const reviewObservation=await f.services.readRecognitionReview(reference);
  assert.equal(reviewObservation.recognition.status,'available');
  assert.equal(reviewObservation.review.fields.find(field=>field.fieldCode==='mileage').human.value,42);
  assert.equal(reviewObservation.adoption,'not_attempted');
  assert.deepEqual((await f.services.drafts.read({...target,draftId:d.result.draftId})).state,detail.state);
  await assert.rejects(f.services.recognitionResults.read({...reference,payload:[candidate]}),{code:'INVALID_INPUT'});
  const originalStep=h.state.aiGatewayInvocation[0].stepId;
  h.state.aiGatewayInvocation[0].stepId='another-step';await assert.rejects(f.services.recognitionResults.read(reference));
  h.state.aiGatewayInvocation[0].stepId=originalStep;
  h.state.aiTaskResultArtifact[0].completeMeasurement=false;
  const unknown=await f.services.recognitionResults.read(reference);
  assert.equal(unknown.status,'unknown');assert.deepEqual(unknown.candidates,[]);
  const {inspectionLifecycleResponse}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-lifecycle-http.contract');
  assert.deepEqual(inspectionLifecycleResponse('result-read',reviewObservation.recognition,reference),reviewObservation.recognition);
  assert.deepEqual(inspectionLifecycleResponse('result-read',unknown,reference),unknown);
  assert.throws(()=>inspectionLifecycleResponse('result-read',{...unknown,candidates:[candidate]},reference),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionLifecycleResponse('result-read',{...reviewObservation.recognition,taskId:'foreign'},reference),{code:'STORAGE_UNAVAILABLE'});
  const incomplete=await f.services.readRecognitionReview(reference);
  assert.equal(incomplete.recognition.status,'unknown');assert.deepEqual(incomplete.recognition.candidates,[]);
  assert.equal(incomplete.automaticRetry,false);assert.equal(incomplete.review.fields.find(field=>field.fieldCode==='mileage').human.value,42);
  await assert.rejects(f.services.recognitionResults.save({...reference,operationId:'save-unknown'}));
  h.state.aiTaskResultArtifact[0].completeMeasurement=true;
  h.state.aiTaskResultArtifact[0].outcome='FAILED';h.state.aiStep.find(s=>s.id===reference.stepId||s.resultRef===reference.resultId).status='FAILED';
  const failed=await f.services.recognitionResults.read(reference);
  assert.equal(failed.status,'failed');assert.deepEqual(failed.candidates,[]);
  assert.deepEqual(inspectionLifecycleResponse('result-read',failed,reference),failed);
  h.state.aiTaskResultArtifact[0].outcome='SUCCEEDED';h.state.aiStep.find(s=>s.resultRef===reference.resultId).status='SUCCEEDED';
  const pending=await root.application.readInput({taskId:h.query.taskId});
  assert.deepEqual(inspectionTaskResponse('readInput',pending,originalReference),pending);
  assert.equal(pending.contract.code,'inspection_context');
  h.modelControl.result.text=JSON.stringify([candidate]);
  const submission={draftVersion:h.contract.draftVersion,taskId:h.query.taskId,requestId:pending.requestId,
    expectedRevision:pending.revision,submissionKey:'inspection-answer-original',answers:[{fieldId:'clarification_text',value:'Please recheck the original mileage image.'}]};
  assert.deepEqual(await root.inputs.readSubmission(submission),{state:'not_observed',retryable:false});
  assert.equal(h.modelControl.sent.length,1);
  const continued=await root.application.resume(submission);
  assert.equal(continued.continuation.outcome.status,'succeeded',JSON.stringify(continued));
  const answerCommand={reference:originalReference,submission};
  assert.deepEqual(inspectionTaskResponse('resume',continued,answerCommand),continued);
  assert.throws(()=>inspectionTaskResponse('resume',{...continued,receipt:{...continued.receipt,taskId:'foreign-task'}},answerCommand),{code:'RECONCILIATION_REQUIRED'});
  const answerReceipt=await root.inputs.readSubmission(submission);
  assert.deepEqual(inspectionTaskResponse('readAnswer',answerReceipt,answerCommand),answerReceipt);
  assert.throws(()=>inspectionTaskResponse('readAnswer',{...answerReceipt,requestId:'foreign-question'},answerCommand),{code:'AI_STORAGE_UNAVAILABLE'});
  assert.deepEqual(inspectionTaskResponse('continueAnswer',{receipt:answerReceipt,result:continued.continuation},answerCommand),{receipt:answerReceipt,result:continued.continuation});
  assert.throws(()=>inspectionTaskResponse('continueAnswer',{receipt:{state:'not_observed',retryable:false},result:continued.continuation},answerCommand),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(answerReceipt.state,'observed');
  assert.equal(answerReceipt.execution,'not_inferred_from_receipt');
  assert.equal(answerReceipt.runId,h.state.aiRun.find(r=>r.inputReceiptId===answerReceipt.receiptId).id);
  assert.deepEqual(await root.inputs.readSubmission(submission),answerReceipt);
  await assert.rejects(root.inputs.readSubmission({...submission,answers:[{fieldId:'clarification_text',value:'different original answer'}]}));
  assert.deepEqual(await root.inputs.readSubmission({...submission,submissionKey:'not-observed-answer'}),{state:'not_observed',retryable:false});
  await assert.rejects(root.application.start({taskId:h.query.taskId,runId:answerReceipt.runId}),{code:'AI_ACCESS_DENIED'});
  assert.equal(h.modelControl.sent.length,2);
  const successorReference={...reference,resultId:h.state.aiTaskResultArtifact.at(-1).id};
  const successor=await f.services.recognitionResults.read(successorReference);
  assert.equal(successor.status,'available');assert.deepEqual(successor.candidates,[candidate]);
  assert.equal(h.state.aiTaskExecutionBudget.length,1);assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls,2n);
  const originalAnswers=structuredClone(h.state.aiTaskInputReceipt[0].answers);
  h.state.aiTaskInputReceipt[0].answers[0].value='forged answer';
  await assert.rejects(f.services.recognitionResults.read(successorReference));
  h.state.aiTaskInputReceipt[0].answers=originalAnswers;
  const save={...successorReference,operationId:'save-original-vision'};
  const savedReview=await f.services.saveRecognitionReview(save),saved=savedReview.receipt;
  assert.equal(saved.result.revision,3);
  assert.deepEqual(inspectionLifecycleResponse('result-save',saved,save),saved);
  assert.throws(()=>inspectionLifecycleResponse('result-save',{...saved,result:{...saved.result,revision:4}},save),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(savedReview.savedRevisionMatchesCurrent,true);assert.equal(savedReview.adoption,'not_attempted');
  assert.equal(savedReview.review.fields.find(field=>field.fieldCode==='mileage').human.value,42);
  assert.deepEqual(await f.services.recognitionResults.save(save),saved);
  assert.equal((await f.services.recognitionResults.reconcileSave(save)).status,'found');
  const after=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(after.state.fields.mileage.value,42);assert.deepEqual(after.state.candidates,[candidate]);
  await f.services.drafts.edit({...target,draftId:d.result.draftId,operationId:'human-adopt-original',expectedRevision:after.revision,
    bindingFingerprint:after.bindingFingerprint,edits:[{fieldCode:'mileage',candidateId:candidate.candidateId,decision:'accepted'}]});
  const adopted=await f.services.readRecognitionSaveReview(save);
  assert.equal(adopted.receipt.status,'found');assert.equal(adopted.savedRevisionMatchesCurrent,false);
  assert.equal(adopted.businessActionRequested,false);
  assert.equal(adopted.review.fields.find(field=>field.fieldCode==='mileage').human.value,43);
  assert.equal(adopted.review.fields.find(field=>field.fieldCode==='mileage').human.decision,'accepted');
  await assert.rejects(f.services.readRecognitionReview(successorReference),{code:'REVISION_CONFLICT'});
  assert.equal(h.modelControl.sent.length,2);
  await assert.rejects(f.services.recognitionResults.save({...save,operationId:'new-key-old-revision'}));
  h.identity.membership=false;
  await assert.rejects(f.services.readRecognitionReview({...successorReference,expectedRevision:after.revision}));
  await assert.rejects(composeInspectionRecognitionTaskHost(f.services.recognition,{...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision},{...dependencies,task}));
});

test('staff recognition host forwards only its request-bound credentials and closes the source',async()=>{
  const f=mediaFixture(),credential=await f.ports.credentials.current();
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const host=new StaffInspectionRequestFactory({...f.ports,storage:f.storage})
    .open({headers:{authorization:credential.authorization},requestId:'bound-media-request'});
  f.services=host;
  const ref=await host.evidence.bind({...target,attachmentId:'file-a'}),d=await draft(f,[ref]);
  const frozen=await host.recognition.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'bound-recognition',question:'Read candidate mileage.'},new AbortController().signal);
  const reference={...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:2};
  const bridge=require('../apps/api/src/modules/ai-native/runner/model-task-host.composition');
  const original=bridge.composeTaskModelHost;let captured;
  // Observe only the runner composition boundary, not a fake recognition result.
  // Actual Guard, template, bytes, frozen input and gatewayMedia execute above.
  bridge.composeTaskModelHost=value=>{captured=value;return {compositionObserved:true};};
  try {
    const result=await host.recognitionTaskHost(reference,{credentials:{current:async()=>{throw Error('foreign session');}},
      gatewayScene:{maxOutputTokens:32},runtime:{ports:{}},task:{taskId:'task-a'}});
    assert.equal(result.compositionObserved,true);
    const current=await captured.credentials.current();
    assert.equal(current.authorization,credential.authorization);assert.equal(current.audience,'staff');assert.equal(current.requestId,'bound-media-request');
    host.close();await assert.rejects(captured.credentials.current(),{code:'ACCESS_DENIED'});
    assert.throws(()=>host.recognitionTaskHost(reference,{}),{code:'STORAGE_UNAVAILABLE'});
  } finally {bridge.composeTaskModelHost=original;host.close();}
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
  const acceptedReview=await f.services.drafts.readReview({...target,draftId:d.result.draftId});
  assert.equal(acceptedReview.fields.find(field=>field.fieldCode==='mileage').human.decision,'accepted');
  assert.deepEqual(acceptedReview.fields.find(field=>field.fieldCode==='mileage').selectedSource,c.sources);
  await f.services.drafts.edit({...common,operationId:'reject',expectedRevision:3,edits:[{fieldCode:'mileage',decision:'rejected',candidateId:c.candidateId}]});
  await f.services.drafts.saveCandidates({...common,operationId:'late',expectedRevision:4,candidates:[{...c,candidateId:'candidate-late',value:{kind:'number',value:99}}]});
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(detail.state.fields.mileage.value,null);assert.equal(detail.state.fields.mileage.decision,'rejected');assert.equal(detail.state.candidates.length,2);
  const rejectedReview=await f.services.drafts.readReview({...target,draftId:d.result.draftId});
  assert.equal(rejectedReview.fields.find(field=>field.fieldCode==='mileage').human.value,null);
  assert.equal(rejectedReview.fields.find(field=>field.fieldCode==='mileage').candidates.length,2);
  assert.equal(rejectedReview.fields.find(field=>field.fieldCode==='mileage').reviewRequired,true);
  assert.equal((await f.services.drafts.reconcileOperation({kind:'create',request:d.request})).result.revision,1);
});

test('human attachment replacement invalidates frozen input and submission without erasing human corrections',async()=>{
  const f=mediaFixture(),ref=await f.services.evidence.bind({...target,attachmentId:'file-a'});
  const d=await draft(f,[ref]);
  const common={...target,draftId:d.result.draftId,bindingFingerprint:d.request.bindingFingerprint};
  await f.services.recognition.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'input-old',question:'Read mileage'},new AbortController().signal);
  const c={candidateId:'candidate-old',fieldCode:'mileage',status:'candidate',value:{kind:'number',value:43},confidence:0.8,
    sources:[{...ref,kind:'image',region:{x:0,y:0,width:1,height:1}}]};
  await f.services.drafts.saveCandidates({...common,expectedRevision:2,operationId:'save-old',candidates:[c]});
  await f.services.drafts.edit({...common,expectedRevision:3,operationId:'accept-old',edits:[{fieldCode:'mileage',decision:'accepted',candidateId:c.candidateId}]});
  await assert.rejects(f.services.drafts.replaceEvidence({...common,expectedRevision:4,operationId:'remove-blocked',evidence:[]}),{code:'BINDING_CHANGED'});
  await f.services.drafts.edit({...common,expectedRevision:4,operationId:'human-correct',edits:[{fieldCode:'mileage',decision:'manual',value:44}]});
  await f.services.submission.prepareReview({...target,draftId:d.result.draftId,expectedRevision:5,operationId:'prepare-old',actionId:'old-action'});
  const request={...common,expectedRevision:6,operationId:'remove-evidence',evidence:[]};
  const transaction=f.db.$transaction;let lostReply=true;
  f.db.$transaction=async callback=>{const result=await transaction(callback);if(lostReply){lostReply=false;throw Error('synthetic commit reply lost');}return result;};
  const removed=await f.services.drafts.replaceEvidence(request);
  assert.equal(removed.revision,7);
  assert.deepEqual(await f.services.drafts.replaceEvidence(request),removed);
  assert.equal((await f.services.drafts.reconcileOperation({kind:'evidence',request})).result.revision,7);
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(detail.status,'draft_saved');assert.equal(detail.state.fields.mileage.value,44);
  assert.equal(detail.state.candidates.length,1);assert.deepEqual(detail.state.evidence,[]);
  assert.equal(detail.state.submission,undefined);assert.equal(detail.state.recognitionInputs,undefined);
  const removedReview=await f.services.drafts.readReview({...target,draftId:d.result.draftId});
  assert.equal(removedReview.fields.find(field=>field.fieldCode==='mileage').candidateEvidence[0].sourcesMatchDraftEvidence,false);
  assert.equal(f.state.drafts.get(d.result.draftId).inputFingerprint,null);
  assert.equal(f.state.drafts.get(d.result.draftId).submissionActionId,null);
  await assert.rejects(f.services.drafts.replaceEvidence({...request,evidence:[ref]}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.services.drafts.edit({...common,expectedRevision:7,operationId:'reuse-old-candidate',edits:[{fieldCode:'mileage',decision:'accepted',candidateId:c.candidateId}]}),{code:'BINDING_CHANGED'});
  await assert.rejects(f.services.drafts.edit({...common,expectedRevision:7,operationId:'modify-old-candidate',edits:[{fieldCode:'mileage',decision:'modified',candidateId:c.candidateId,value:45}]}),{code:'BINDING_CHANGED'});
  await assert.rejects(f.services.drafts.saveCandidates({...common,expectedRevision:6,operationId:'late-candidate',candidates:[{...c,candidateId:'late'}]}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.services.drafts.replaceEvidence({...request,expectedRevision:7,operationId:'foreign',evidence:[{attachmentId:'foreign',attachmentRevision:1}]}),{code:'BINDING_CHANGED'});
  const added=await f.services.drafts.replaceEvidence({...request,expectedRevision:7,operationId:'reattach',evidence:[ref]});
  assert.equal(added.revision,8);
  f.state.active=false;
  await assert.rejects(f.services.drafts.replaceEvidence({...request,expectedRevision:8,operationId:'revoked'}),{code:'ACCESS_DENIED'});
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
  const snapshot=structuredClone(f.state.drafts.get(d.result.draftId));
  const receipt=await f.services.submission.reconcilePreparation({kind:'prepareReview',request:input});
  assert.equal(receipt.status,'found');assert.equal(receipt.result.revision,review.revision);
  assert.equal(receipt.execution,'not_attested');assert.equal(receipt.mode,'manual_review_only');
  assert.deepEqual(f.state.drafts.get(d.result.draftId),snapshot);
  assert.equal((await f.services.submission.reconcilePreparation({kind:'prepareReview',request:{...input,operationId:'missing-command'}})).status,'absent');
  await assert.rejects(f.services.submission.reconcilePreparation({kind:'prepare',request:input}),{code:'REVISION_CONFLICT'});
  await assert.rejects(f.services.submission.reconcilePreparation({kind:'prepareReview',request:{...input,actionId:'another-action'}}),{code:'REVISION_CONFLICT'});
  f.state.active=false;
  await assert.rejects(f.services.submission.reconcilePreparation({kind:'prepareReview',request:input}));
  f.state.active=true;
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
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const {StaffInspectionAssistController}=require('../apps/api/src/modules/ai-native/inspection-assist/staff-inspection-assist.controller');
  const credential=await f.ports.credentials.current();
  const controller=new StaffInspectionAssistController(new StaffInspectionRequestFactory({...f.ports,originalInspection:f.originalInspection}),true);
  const request={headers:{authorization:credential.authorization}};
  const result=await controller.consume(request,'submission-submit',input);
  assert.equal(result.status,'submitted');assert.equal(result.inspectionId,'inspection-original');assert.equal(result.draftLinked,false);
  assert.equal(f.state.drafts.get(input.draftId).status,'submission_unknown');
  f.order.allocations[0].status='returned';
  const snapshot=structuredClone(f.state.drafts.get(input.draftId)),operations=f.state.operations.size;
  const observed=await controller.consume(request,'submission-read',{...target,draftId:input.draftId});
  assert.equal(observed.status,'submitted');assert.equal(observed.inspectionId,'inspection-original');assert.equal(observed.draftLinked,false);
  assert.deepEqual(f.state.drafts.get(input.draftId),snapshot);assert.equal(f.state.operations.size,operations);assert.equal(f.calls(),1);
  const repaired=await f.services.submission.reconcile({...target,draftId:input.draftId});
  assert.equal(repaired.draftLinked,true);assert.equal(f.calls(),1);
});

test('staff submission refuses a template-resource change during pre-submit waits',async()=>{
  const f=submissionFixture(),input=await prepared(f);
  const original=f.services.templates.read.bind(f.services.templates);let reads=0;
  f.services.templates.read=async target=>{const result=await original(target);if(++reads===2)f.order.allocations[0].assetId='reassigned-asset';return result;};
  await assert.rejects(f.services.submission.submit(input),{code:'BINDING_CHANGED'});
  assert.equal(f.calls(),0);assert.equal(f.state.drafts.get(input.draftId).status,'prepared');
});
test('absent original receipt stays unknown with exact action material and never retries automatically',async()=>{
  const f=submissionFixture('absent'),input=await prepared(f);
  const first=await f.services.submission.submit(input);assert.equal(first.status,'submission_unknown');assert.equal(first.receiptLookup,'absent');
  await f.services.submission.submit(input);const result=await f.services.submission.reconcile({...target,draftId:input.draftId});
  assert.equal(result.status,'submission_unknown');assert.equal(result.actionId,'handover-original');assert.equal(result.requestHash.length,64);assert.equal(f.calls(),1);
});
