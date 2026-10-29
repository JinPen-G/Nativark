'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const { fixture,target }=require('./fixtures/ai-native/inspection-persistent.cjs');
require('../apps/api/src/modules/files/staff-uploads.controller');
async function create(f, results={mileage:0}, evidence=[]) {
  const binding=await f.services.templates.read(target);
  const input={...target,operationId:'create-a',bindingFingerprint:binding.bindingFingerprint,results,evidence};
  return {input,result:await f.services.drafts.create(input)};
}

test('staff request factory connects real draft lifecycle without shared request credentials',async()=>{
  const {StaffInspectionRequestFactory,InspectionAssistModule}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const f=fixture(),credential=await f.ports.credentials.current();
  const factory=new StaffInspectionRequestFactory(f.ports);
  const request={headers:{authorization:credential.authorization},requestId:'request-one'};
  const one=factory.open(request),two=factory.open({headers:{authorization:credential.authorization},requestId:'request-two'});
  assert.equal(f.state.reads,0);
  request.headers.authorization='invalid-after-binding';
  const binding=await one.templates.read(target);
  const saved=await one.drafts.create({...target,operationId:'request-bound-create',bindingFingerprint:binding.bindingFingerprint,results:{mileage:0},evidence:[]});
  one.close();one.close();
  await assert.rejects(one.drafts.read({...target,draftId:saved.draftId}));
  assert.equal((await two.drafts.read({...target,draftId:saved.draftId})).state.fields.mileage.value,0);
  f.state.onRead=()=>two.close();
  await assert.rejects(two.templates.read(target));
  assert.throws(()=>factory.open({headers:{},requestId:'missing'}),{code:'ACCESS_DENIED'});
  assert.ok(InspectionAssistModule.register(f.ports).exports.includes(StaffInspectionRequestFactory));
  const {credentials,...serverPorts}=f.ports;
  const registration=InspectionAssistModule.registerStaffRequests(serverPorts);
  assert.equal(registration.providers.length,1);
  assert.equal(f.state.drafts.size,1);
});
test('manual HTTP contracts preserve drafts, evidence and original receipts under the real staff authority',async t=>{
  const f=fixture();
  f.template.fields.push({code:'condition',label:'Condition',type:'select',required:false,options:['good','worn']},
    {code:'checked',label:'Checked',type:'boolean',required:false});
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const {StaffInspectionAssistController}=require('../apps/api/src/modules/ai-native/inspection-assist/staff-inspection-assist.controller');
  const {inspectionManualResponse,inspectionManualRequest}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-manual-http.contract');
  const shared=require('@rental-os/shared');
  const factory=new StaffInspectionRequestFactory(f.ports),http=new StaffInspectionAssistController(factory,true);
  const request={headers:{authorization:(await f.ports.credentials.current()).authorization}};
  const call=(operation,body)=>http.consume(request,operation,body);
  const failed=(status,code,next)=>error=>error.getStatus()===status&&error.getResponse().code===code
    &&error.getResponse().retryable===false&&(!next||error.getResponse().nextAction===next);
  const binding=await call('template-read',target);
  assert.equal(binding.template.id,target.templateId);assert.equal(binding.audience,'staff');
  const input={...target,operationId:'wire-create',bindingFingerprint:binding.bindingFingerprint,results:{mileage:0,checked:false,condition:'good'},evidence:[]};
  const created=await call('draft-create',input);
  assert.equal(created.revision,1);assert.equal(created.inspectionId,null);
  assert.deepEqual(await call('draft-create',input),created);
  const selection={...target,draftId:created.draftId};
  const detail=await call('draft-read',selection);
  assert.equal(detail.state.fields.mileage.value,0);assert.equal(detail.state.fields.checked.value,false);
  const history=await call('history-read',{orderId:target.orderId,stage:target.stage,limit:10});
  assert.equal(history.items.length,1);assert.equal(history.items[0].draftId,created.draftId);
  const receiptHost=await call('receipt-host-read',{...selection,mode:'receipt_only'});
  assert.equal(receiptHost.recognitionSave,null);assert.equal(receiptHost.capabilities.recognitionReceipt,false);
  assert.throws(()=>inspectionManualResponse('history-read',{...history,items:[{...history.items[0],target:{...target,orderId:'foreign'}}]},
    {orderId:target.orderId,stage:target.stage,limit:10}),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionManualResponse('receipt-host-read',{...receiptHost,capabilities:{...receiptHost.capabilities,recognitionReceipt:true}},
    {...selection,mode:'receipt_only'}),{code:'STORAGE_UNAVAILABLE'});
  const host=await call('host-read',selection);
  assert.equal(host.execution,'not_attested');assert.equal(host.capabilities.edit,true);assert.equal(host.capabilities.submit,false);
  const edit={...selection,operationId:'wire-edit',expectedRevision:1,bindingFingerprint:binding.bindingFingerprint,
    edits:[{fieldCode:'mileage',decision:'manual',value:12}]};
  const edited=await call('draft-edit',edit);
  assert.equal(edited.revision,2);assert.equal((await call('draft-read',selection)).state.fields.mileage.value,12);
  await assert.rejects(call('draft-edit',{...edit,operationId:'stale-edit'}),failed(409,'AI_REVISION_CONFLICT'));
  const evidence=await call('evidence-bind',{...target,attachmentId:'file-a'});
  assert.equal(evidence.attachmentId,'file-a');
  assert.match(await call('evidence-fingerprint',{target,refs:[evidence]}),/^[a-f0-9]{64}$/);
  const replace={...selection,operationId:'wire-evidence',expectedRevision:2,bindingFingerprint:binding.bindingFingerprint,evidence:[evidence]};
  assert.equal((await call('evidence-replace',replace)).revision,3);
  const beforeRead={drafts:f.state.drafts.size,operations:f.state.operations.size,bindings:f.state.bindings.size};
  const original=await call('draft-operation',{kind:'edit',request:edit});
  assert.equal(original.result.revision,2,'original receipt is not the current draft head');
  assert.equal((await call('draft-operation',{kind:'evidence',request:replace})).result.revision,3);
  assert.equal((await call('draft-operation',{kind:'create',request:{...input,operationId:'absent'}})).status,'absent');
  const savedReference={...selection,inputId:'input-a',taskId:'task-a',resultId:'result-a',operationId:'wire-edit',expectedRevision:1};
  assert.equal((await call('result-save-receipt',savedReference)).status,'unavailable','manual edit has no original recognition association');
  assert.deepEqual({drafts:f.state.drafts.size,operations:f.state.operations.size,bindings:f.state.bindings.size},beforeRead);
  assert.equal(inspectionManualRequest('draft-operation',{kind:'evidence',request:replace}).kind,'evidence');
  for(const [operation,body] of [['draft-create',{...input,ownerId:'forged'}],['draft-edit',{...edit,expectedRevision:'1'}],
    ['draft-create',{...input,results:{'bad key':1}}],['draft-operation',{kind:'invoke',request:edit}]]) {
    await assert.rejects(call(operation,body),failed(400,'AI_INVALID_INPUT'));
  }
  const realWithRequest=factory.withRequest.bind(factory);
  const badRead=t.mock.method(factory,'withRequest',async(...args)=>({...await realWithRequest(...args),storageKey:'private'}));
  await assert.rejects(call('draft-read',selection),failed(503,'AI_STORAGE_UNAVAILABLE'));
  badRead.mock.restore();
  const lateEdit={...edit,operationId:'edit-late-review-failure',expectedRevision:3,edits:[{fieldCode:'mileage',decision:'manual',value:15}]};
  const failReview=t.mock.method(factory,'withRequest',(request,consume,signal)=>realWithRequest(request,services=>{
    services.drafts.readReview=async()=>{throw Object.assign(new Error('late revision failure'),{code:'REVISION_CONFLICT'});};
    return consume(services);
  },signal));
  await assert.rejects(call('draft-edit',lateEdit),failed(409,'AI_RESULT_UNKNOWN','draft-operation'));
  failReview.mock.restore();
  assert.equal((await call('draft-operation',{kind:'edit',request:lateEdit})).result.revision,4);
  assert.equal((await call('draft-read',selection)).state.fields.mileage.value,15);
  const lostInput={...input,operationId:'damaged-created-reply'};
  const badWrite=t.mock.method(factory,'withRequest',async(...args)=>({...await realWithRequest(...args),revision:99}));
  await assert.rejects(call('draft-create',lostInput),failed(409,'AI_RESULT_UNKNOWN','draft-operation'));
  badWrite.mock.restore();
  assert.equal(f.state.drafts.size,2);
  assert.equal((await call('draft-operation',{kind:'create',request:lostInput})).result.revision,1);
  assert.equal(f.state.drafts.size,2);
  assert.throws(()=>inspectionManualResponse('draft-read',{...detail,target:{...target,orderId:'foreign'}},selection),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionManualResponse('draft-read',{...detail,state:{...detail.state,fields:{'bad key':detail.state.fields.mileage}}},selection),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionManualResponse('draft-edit',{...edited,draftId:'foreign'},edit),{code:'RECONCILIATION_REQUIRED'});
  assert.throws(()=>inspectionManualResponse('draft-operation',{...original,result:{...original.result,revision:3}},{kind:'edit',request:edit}),{code:'STORAGE_UNAVAILABLE'});
  assert.throws(()=>inspectionManualResponse('template-read',{...binding,template:{...binding.template,version:'changed'}},target),{code:'STORAGE_UNAVAILABLE'});
  // Draft state may retain submission/frozen-input history; do not strip it just
  // because this host currently exercises the manual path.
  const historical={...detail,state:{...detail.state,submission:{actionId:'action-a',requestHash:'a'.repeat(64),body:{templateId:target.templateId,
    results:{mileage:0,checked:false,photo:['file-a']},attachments:['file-a']}},recognitionInputs:[{inputId:'input-a',inputFingerprint:'b'.repeat(64),bindingFingerprint:binding.bindingFingerprint,
    question:'Read the original meter',template:{id:target.templateId,version:'v1',fields:[{code:'mileage',label:'Mileage',type:'number',required:true}]},
    media:[{...evidence,contentHash:'c'.repeat(64),mediaType:'image/png',sizeBytes:64,width:1,height:1,durationMs:null}]}]}};
  assert.deepEqual(inspectionManualResponse('draft-read',historical,selection),historical);
  const {OPENAPI_DOCUMENT}=require('../apps/api/src/contracts/openapi-document');
  for(const [operation,contract]of Object.entries(shared.AI_INSPECTION_MANUAL_HTTP_CONTRACTS)){
    const route=OPENAPI_DOCUMENT.paths[`/api/${shared.AI_STAFF_INSPECTION_HTTP_DRAFT.basePath}/${operation}`].post;
    assert.equal(route.requestBody.content['application/json'].schema.$ref,`#/components/schemas/${contract.request}`);
    assert.equal(route.responses['200'].content['application/json'].schema.properties.data.$ref,`#/components/schemas/${contract.response}`);
  }
  assert.deepEqual(require('./fixtures/ai-native/contract-consumer.cjs').compileConsumer(`import type { AiInspectionOriginalOperationRequest, AiInspectionDraftReadResponse } from '../packages/shared/src/index';
const evidence: AiInspectionOriginalOperationRequest = ${JSON.stringify({kind:'evidence',request:replace})};
const draft: AiInspectionDraftReadResponse = ${JSON.stringify(detail)};
// @ts-expect-error draft reading cannot attest recognition
const fake: AiInspectionDraftReadResponse = {...draft,recognitionEvidence:'confirmed_model'};
`),[]);
  f.order.allocations[0].assetId='changed-asset';
  assert.equal((await call('draft-read',selection)).state.reviewRequired,true,'stale original fields remain history, not current asset facts');
  assert.equal((await call('draft-operation',{kind:'edit',request:edit})).status,'found');
  f.state.user.permissions=['rental-os:order:view'];
  await assert.rejects(call('draft-edit',edit),failed(403,'AI_ACCESS_DENIED'));
  assert.equal((await call('draft-operation',{kind:'edit',request:edit})).status,'found');
  f.state.active=false;
  await assert.rejects(call('draft-read',selection),failed(403,'AI_ACCESS_DENIED'));
});

test('manual draft uses actual Auth Guard and Prisma repository, without model',async()=>{
  const f=fixture(),created=await create(f);
  assert.equal(created.result.status,'draft_saved');assert.equal(f.state.drafts.size,1);
  assert.deepEqual(await f.services.drafts.create(created.input),created.result);
  const detail=await f.services.drafts.read({...target,draftId:created.result.draftId});
  assert.equal(detail.state.fields.mileage.value,0);assert.equal(detail.inspectionId,null);
  await f.services.drafts.edit({...target,draftId:detail.draftId,expectedRevision:1,operationId:'edit-a',bindingFingerprint:detail.bindingFingerprint,
    edits:[{fieldCode:'mileage',decision:'manual',value:12}]});
  assert.equal((await f.services.drafts.read({...target,draftId:detail.draftId})).state.fields.mileage.value,12);
  await assert.rejects(f.services.drafts.edit({...target,draftId:detail.draftId,expectedRevision:1,operationId:'edit-b',bindingFingerprint:detail.bindingFingerprint,
    edits:[{fieldCode:'mileage',decision:'manual',value:13}]}),{code:'REVISION_CONFLICT'});
});
test('GET permission never authorizes writes and late logout withholds draft body',async()=>{
  const f=fixture(),created=await create(f);f.state.user.permissions=['rental-os:order:view'];
  await assert.rejects(f.services.drafts.create({...created.input,operationId:'readonly'}),{code:'ACCESS_DENIED'});
  assert.equal((await f.services.drafts.read({...target,draftId:created.result.draftId})).revision,1);
  f.state.onDbRead=name=>{if(name==='drafts')f.state.active=false;};
  await assert.rejects(f.services.drafts.read({...target,draftId:created.result.draftId}),{code:'ACCESS_DENIED'});
});
test('bound completed upload is manual evidence but is not model input proof',async()=>{
  const f=fixture();const ref=await f.services.evidence.bind({...target,attachmentId:'file-a'});
  assert.equal(ref.attachmentRevision,1);assert.deepEqual(await f.services.evidence.bind({...target,attachmentId:'file-a'}),ref);
  const created=await create(f,{mileage:42,photo:'file-a'},[ref]);
  assert.equal((await f.services.drafts.read({...target,draftId:created.result.draftId})).state.fields.photo.value,'file-a');
  const binding=await f.services.templates.read(target);
  await assert.rejects(f.services.evidence.verify(binding,{...ref,kind:'image',region:{x:0,y:0,width:1,height:1}}),{code:'STORAGE_UNAVAILABLE'});
  f.state.assets.get('file-a').updatedAt=new Date('2026-10-07T01:00:00Z');
  assert.equal((await f.services.drafts.read({...target,draftId:created.result.draftId})).state.reviewRequired,true);
});
test('legacy unbound upload, foreign asset and client scope cannot create trusted drafts',async()=>{
  const f=fixture();await assert.rejects(create(f,{mileage:42,photo:'file-a'},[{attachmentId:'file-a',attachmentRevision:1}]),{code:'INVALID_INPUT'});
  f.state.assets.get('file-a').uploadedBy='foreign';
  await assert.rejects(f.services.evidence.bind({...target,attachmentId:'file-a'}),{code:'STORAGE_UNAVAILABLE'});
  const binding=await f.services.templates.read(target);
  await assert.rejects(f.services.drafts.create({...target,operationId:'bad',bindingFingerprint:binding.bindingFingerprint,results:{},evidence:[],ownerId:'foreign'}),{code:'INVALID_INPUT'});
});
test('resource and frozen-template changes keep history marked for review',async()=>{
  const f=fixture(),created=await create(f);f.order.allocations[0].assetId='asset-new';
  assert.equal((await f.services.drafts.read({...target,draftId:created.result.draftId})).state.reviewRequired,true);
  await assert.rejects(f.services.drafts.edit({...target,draftId:created.result.draftId,expectedRevision:1,operationId:'changed',bindingFingerprint:created.input.bindingFingerprint,
    edits:[{fieldCode:'mileage',decision:'manual',value:3}]}),{code:'BINDING_CHANGED'});
  assert.equal(f.state.drafts.values().next().value.assetId,'asset-a');
});

test('draft list bounds its database query to the exact authorized inspection target',async()=>{
  const f=fixture(),created=await create(f);
  const own=f.state.drafts.get(created.result.draftId);
  f.state.drafts.set('other-allocation',{...structuredClone(own),id:'other-allocation',allocationId:'allocation-other'});
  f.state.drafts.set('other-stage',{...structuredClone(own),id:'other-stage',stage:'pickup'});
  f.state.drafts.set('other-template',{...structuredClone(own),id:'other-template',templateId:'template-other'});
  const original=f.db.aiInspectionDraft.findMany;
  let query;
  f.db.aiInspectionDraft.findMany=async args=>{query=structuredClone(args);return original(args);};
  const rows=await f.services.drafts.list({...target,limit:10});
  assert.deepEqual(rows.map(row=>row.id),[created.result.draftId]);
  for(const [key,value] of Object.entries(target))assert.equal(query.where[key],value);
  assert.equal(query.take,10);
  assert.equal(query.select.state,undefined);
});

test('human review connects current persisted corrections, revision changes and request closure',async()=>{
  const {StaffInspectionRequestFactory}=require('../apps/api/src/modules/ai-native/inspection-assist/inspection-assist.composition');
  const f=fixture(),credentials=await f.ports.credentials.current();
  const host=new StaffInspectionRequestFactory(f.ports).open({headers:{authorization:credentials.authorization},requestId:'human-review'});
  const binding=await host.templates.read(target);
  const saved=await host.drafts.create({...target,operationId:'review-create',bindingFingerprint:binding.bindingFingerprint,results:{mileage:0},evidence:[]});
  const request={...target,draftId:saved.draftId};
  const first=await host.drafts.readReview(request);
  assert.equal(first.fields.find(field=>field.fieldCode==='mileage').human.value,0);
  assert.equal(first.fields.find(field=>field.fieldCode==='mileage').label,f.template.fields.find(field=>field.code==='mileage').label);
  assert.equal(first.next,'human_review');assert.equal(first.inspectionId,null);
  const edit={...request,operationId:'review-edit',expectedRevision:1,bindingFingerprint:binding.bindingFingerprint,
    edits:[{fieldCode:'mileage',decision:'manual',value:12}]};
  const original=host.templates.read.bind(host.templates);let change=true;
  host.templates.read=async value=>{const result=await original(value);if(change){change=false;await host.drafts.edit(edit);}return result;};
  await assert.rejects(host.drafts.readReview(request),{code:'REVISION_CONFLICT'});
  host.templates.read=original;
  const changed=await host.drafts.readReview(request);
  assert.equal(changed.revision,2);assert.equal(changed.fields.find(field=>field.fieldCode==='mileage').human.value,12);
  const recovery=await host.drafts.reconcileOperation({kind:'edit',request:edit});
  assert.equal(recovery.status,'found');assert.equal(recovery.result.revision,2);
  f.order.allocations[0].assetId='different-asset';
  const stale=await host.drafts.readReview(request);
  assert.equal(stale.binding,'changed');assert.equal(stale.reviewRequired,true);assert.equal(stale.next,'review_changed_resource');
  assert.equal(stale.fields.find(field=>field.fieldCode==='mileage').label,undefined);
  assert.equal(stale.fields.find(field=>field.fieldCode==='mileage').human.value,12); // history, not current asset facts
  host.close();await assert.rejects(host.drafts.readReview(request),{code:'ACCESS_DENIED'});
});
