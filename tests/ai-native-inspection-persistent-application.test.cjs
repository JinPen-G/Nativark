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
