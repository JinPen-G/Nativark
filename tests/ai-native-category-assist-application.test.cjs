'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./fixtures/ai-native/lane-b-functional.cjs');
const {AuthService}=require('../apps/api/src/modules/auth/auth.service');
const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
const {user}=require('./fixtures/ai-native/authorization-baseline.cjs');
const {RENTAL_CATEGORY_DEFINITIONS,CATEGORY_GOVERNANCE_PERMISSIONS:P}=require('@rental-os/shared');
const {CategoryGovernanceService}=require('../apps/api/src/modules/rental-core/category-governance.service');
const {CategoryGovernanceController}=require('../apps/api/src/modules/rental-core/category-governance.controller');
const {CategoryDraftApplication,CategoryAssistModule}=require('../apps/api/src/modules/ai-native/category-assist/category-draft.application');

function fixture(){
  const definition=structuredClone(RENTAL_CATEGORY_DEFINITIONS[0]);
  const state={user:user({isSaasAdmin:true,permissions:[P.view,P.edit]}),active:true,writes:0};
  const rows=new Map([['source-a',{id:'source-a',categoryCode:definition.code.toUpperCase(),status:'published',definition,structureVersion:1,revision:1,versionLabel:'v1'}]]);
  const auth=new AuthService({getAuthSession:async()=>state.active?{id:'session-a',userId:state.user.id,audience:'operator',currentWorkspaceId:'workspace-a'}:undefined,
    findUserById:async()=>state.user,findWorkspaceScopedUser:async()=>state.user,listUserWorkspaces:async()=>[]},{get:key=>key==='AUTH_TOKEN_SECRET'?'synthetic-test-secret':undefined});
  const credentials={current:async()=>({audience:'operator',requestId:'request-a',authorization:`Bearer ${auth.signAccessToken({sub:state.user.id,tid:state.user.tenantId,sid:'session-a',aud:'operator',exp:Math.floor(Date.now()/1000)+600})}`})};
  const match=(row,where)=>Object.entries(where).every(([k,v])=>row[k]===v);
  const db={
    rentalCategoryDefinition:{findUnique:async()=>({code:definition.code.toUpperCase()})},
    rentalCategoryVersion:{findFirst:async({where})=>structuredClone([...rows.values()].find(row=>match(row,where))??null),
      findMany:async()=>[...rows.values()].map(row=>structuredClone(row)),
      create:async({data})=>{state.writes++;const row={revision:0,...structuredClone(data)};rows.set(row.id,row);if(state.afterCreate)state.afterCreate();return structuredClone(row);},
      updateMany:async({where,data})=>{const row=[...rows.values()].find(row=>match(row,where));if(!row)return {count:0};
        const revision=row.revision;Object.assign(row,structuredClone(data));if(data.revision?.increment)row.revision=revision+data.revision.increment;state.writes++;return {count:1};}},
    rentalCategoryGovernanceAudit:{create:async()=>({})},businessWorkspace:{count:async()=>2},$queryRaw:async()=>[],
    $transaction:async callback=>{const before=structuredClone(rows);try{return await callback(db);}catch(e){rows.clear();for(const[k,v]of before)rows.set(k,v);throw e;}}
  };
  const controller=new CategoryGovernanceController(new CategoryGovernanceService(db,{registeredVersions:()=>[],registeredCodes:()=>[]}));
  const dependencies={guard:new ApiAuthGuard(auth),credentials,controller};
  return {state,rows,definition,dependencies,app:new CategoryDraftApplication(dependencies)};
}

test('actual platform Guard and CAT-GOV draft/CAS/review chain stays gated and never publishes',async()=>{
  const previous=process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW;
  try{
    delete process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW;
    const f=fixture();
    const input={code:f.definition.code,body:{sourceVersionId:'source-a',versionLabel:'synthetic-v2',reason:'Synthetic human draft'}};
    await assert.rejects(f.app.create(input),{code:'ACCESS_DENIED'});assert.equal(f.state.writes,0);
    process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW='true';
    const created=await f.app.create(input);assert.equal(created.status,'draft');assert.equal(created.sourceVersionId,'source-a');
    const patch={code:f.definition.code,versionId:created.id,section:'basic',body:{expectedRevision:0,values:{name:'Synthetic revised category'},reason:'Synthetic change'}};
    const changed=await f.app.patch(patch);assert.equal(changed.revision,1);
    await assert.rejects(f.app.patch(patch),/草稿已变更/);
    const review=await f.app.review({code:f.definition.code,versionId:created.id});
    assert.equal(review.review.revision,1);assert.equal(review.publication,'unavailable');assert.equal(review.adoption,'unavailable');
    assert.equal(f.rows.get(created.id).status,'draft');
    assert.equal(f.app.publish,undefined);
    const module=CategoryAssistModule.register(f.dependencies);assert.ok(module.exports.includes(CategoryDraftApplication));
    f.state.afterCreate=()=>{f.state.active=false;};
    await assert.rejects(f.app.create({...input,body:{...input.body,versionLabel:'synthetic-v3'}}),{code:'ACCESS_DENIED',writeMayHaveCommitted:true});
    assert.equal([...f.rows.values()].filter(row=>row.versionLabel==='synthetic-v3').length,1);
    f.state.active=true;
    f.state.user.isSaasAdmin=false;
    await assert.rejects(f.app.review({code:f.definition.code,versionId:created.id}),{code:'ACCESS_DENIED'});
  }finally{if(previous===undefined)delete process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW;else process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW=previous;}
});

test('strict original DTO, tenant scope injection and revoked session reject without draft writes',async()=>{
  const f=fixture();
  await assert.rejects(f.app.create({code:f.definition.code,body:{sourceVersionId:'source-a',versionLabel:'v2',reason:'x',approved:true}}),{code:'INVALID_INPUT'});
  await assert.rejects(f.app.detail({code:f.definition.code,scope:{kind:'platform'}}),{code:'INVALID_INPUT'});
  f.state.active=false;
  await assert.rejects(f.app.detail({code:f.definition.code}),{code:'ACCESS_DENIED'});
  assert.equal(f.state.writes,0);
});
