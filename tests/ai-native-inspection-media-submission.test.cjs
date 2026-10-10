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
  f.services=composeInspectionAssist({...f.ports,storage});return {...f,calls,storage};
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
test('original inspection frozen media creates a real model runner host without changing inspection fields',async()=>{
  const f=mediaFixture();f.state.user.id='user-a';f.state.assets.get('file-a').uploadedBy='user-a';
  await assert.rejects(f.services.recognitionResults.read({...target,draftId:'not-read',inputId:'not-read',expectedRevision:1,
    taskId:'task-a',resultId:'result-a'}),{code:'STORAGE_UNAVAILABLE'});
  const {modelHostHarness}=require('./fixtures/ai-native/task-model-host.cjs');
  const h=await modelHostHarness('image');h.identity.user.permissions.push('rental-os:order:return');
  const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
  f.services=composeInspectionAssist({...f.ports,storage:f.storage,credentials:h.config.credentials,
    guard:new ApiAuthGuard(h.config.auth,undefined,undefined,undefined,{rentalOrder:f.db.rentalOrder}),
    recognitionResults:{db:h.db,auth:h.config.auth,subscriptions:h.config.subscriptions,clock:h.config.clock,
      financialEvidence:h.financial,policy:{kind:'image',sceneCode:h.config.gatewayScene.sceneCode,maxOutputTokens:h.config.gatewayScene.maxOutputTokens}}});
  const ref=await f.services.evidence.bind({...target,attachmentId:'file-a'});
  const candidate={candidateId:'vision-original',fieldCode:'mileage',status:'candidate',value:{kind:'number',value:43},confidence:0.8,
    sources:[{...ref,kind:'image',region:{x:0,y:0,width:1,height:1}}]};
  h.modelControl.result.text=JSON.stringify([candidate]);
  const d=await draft(f,[ref]);
  const frozen=await f.services.recognition.prepare({...target,draftId:d.result.draftId,expectedRevision:1,operationId:'original-vision',question:'List candidate readings only.'},new AbortController().signal);
  const detail=await f.services.drafts.read({...target,draftId:d.result.draftId});
  const {composeInspectionRecognitionTaskHost}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const {task:originalTask,...dependencies}=h.config;
  const {material:ignored,...task}=originalTask;
  const root=await composeInspectionRecognitionTaskHost(f.services.recognition,{...target,draftId:d.result.draftId,inputId:frozen.inputId,expectedRevision:detail.revision},{...dependencies,task});
  const result=await root.application.start(h.query);
  assert.equal(result.outcome.status,'succeeded');assert.equal(h.modelControl.sent.length,1);
  assert.equal(h.state.aiTaskActionInput[0].payload.media[0].contentHash,detail.state.recognitionInputs[0].media[0].contentHash);
  assert.equal(h.modelControl.sent[0].messages[0].content[1].data,png.toString('base64'));
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
  assert.deepEqual((await f.services.recognitionResults.read(reference)).candidates,[candidate]);
  await assert.rejects(f.services.recognitionResults.read({...reference,payload:[candidate]}),{code:'INVALID_INPUT'});
  const originalStep=h.state.aiGatewayInvocation[0].stepId;
  h.state.aiGatewayInvocation[0].stepId='another-step';await assert.rejects(f.services.recognitionResults.read(reference));
  h.state.aiGatewayInvocation[0].stepId=originalStep;
  h.state.aiTaskResultArtifact[0].completeMeasurement=false;
  const unknown=await f.services.recognitionResults.read(reference);
  assert.equal(unknown.status,'unknown');assert.deepEqual(unknown.candidates,[]);
  await assert.rejects(f.services.recognitionResults.save({...reference,operationId:'save-unknown'}));
  h.state.aiTaskResultArtifact[0].completeMeasurement=true;
  h.state.aiTaskResultArtifact[0].outcome='FAILED';h.state.aiStep.find(s=>s.id===reference.stepId||s.resultRef===reference.resultId).status='FAILED';
  const failed=await f.services.recognitionResults.read(reference);
  assert.equal(failed.status,'failed');assert.deepEqual(failed.candidates,[]);
  h.state.aiTaskResultArtifact[0].outcome='SUCCEEDED';h.state.aiStep.find(s=>s.resultRef===reference.resultId).status='SUCCEEDED';
  const save={...reference,operationId:'save-original-vision'};
  const saved=await f.services.recognitionResults.save(save);
  assert.equal(saved.result.revision,3);
  assert.deepEqual(await f.services.recognitionResults.save(save),saved);
  assert.equal((await f.services.recognitionResults.reconcileSave(save)).status,'found');
  const after=await f.services.drafts.read({...target,draftId:d.result.draftId});
  assert.equal(after.state.fields.mileage.value,42);assert.deepEqual(after.state.candidates,[candidate]);
  assert.equal(h.modelControl.sent.length,1);
  await assert.rejects(f.services.recognitionResults.save({...save,operationId:'new-key-old-revision'}));
  h.identity.membership=false;
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
