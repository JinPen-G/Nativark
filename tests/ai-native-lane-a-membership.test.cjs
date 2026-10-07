'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({transpileOnly:false,compilerOptions:{module:'commonjs',moduleResolution:'node',experimentalDecorators:true,emitDecoratorMetadata:true}});
const { authorizedRunnerHarness }=require('./fixtures/ai-native/task-authorized-runner.cjs');
const { ApiAuthGuard }=require('../apps/api/src/common/api-auth.guard');
const { AiBusinessReadRouteAuthority }=require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiMembershipCandidateReadFactsService }=require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
const { MembershipService }=require('../apps/api/src/modules/platform/membership.service');
// Prisma execution only: evaluate the predicates emitted by the real service.
function matches(row,where) {
  return Object.entries(where).every(([key,v])=>key==='AND'?v.every(x=>matches(row,x)):key==='OR'?v.some(x=>matches(row,x)):
    v && typeof v==='object' ? 'in' in v?v.in.includes(row[key]):'not' in v?row[key]!==v.not:'is' in v?matches(row[key],v.is):false:row[key]===v);
}
async function setup() {
  const h=await authorizedRunnerHarness(); h.identity.user.permissions.push('rental-os:order:create');
  const profiles=[['customer-a','workspace-a','user-a'],['customer-b','workspace-b','other'],['customer-c','workspace-a','other']].map(([id,w,u])=>({id,tenantId:'tenant-a',name:'Synthetic same name',phoneMasked:'138****0000',customerType:'personal',mergedIntoCustomerId:null,membership:{status:'active'},createdInWorkspaceId:w,createdByUserId:u}));
  profiles.push({...profiles[0],id:'foreign-customer',tenantId:'tenant-b'});
  const queries=[]; const control={afterRead:null};
  const db={customerProfile:{findMany:async q=>{queries.push(structuredClone(q));const out=profiles.filter(r=>matches(r,q.where)).map(r=>({id:r.id,name:r.name,phoneMasked:r.phoneMasked,membership:r.membership}));if(control.afterRead) await control.afterRead();return structuredClone(out);}},
    rentalOrder:{findMany:async q=>{queries.push(structuredClone(q));return [];}}};
  const memberships=new MembershipService(db,{});
  const guard=new ApiAuthGuard(h.authorization.auth,undefined,undefined,undefined,{});
  const authority=new AiBusinessReadRouteAuthority(guard,h.authorization.credentials,()=>new Date(h.control.now));
  const service=new AiMembershipCandidateReadFactsService(memberships,authority,()=>new Date(h.control.now));
  return {...h,profiles,queries,control,service};
}
test('actual Guard/ALS and membership service preserve same-name candidates and tenant isolation',async()=>{
  const h=await setup(),r=await h.service.read({limit:10});
  assert.equal(r.candidates.length,3);assert.equal(r.scope.workspaceId,'workspace-a');assert.ok(r.observedAt);
  assert.equal(Object.hasOwn(r,'selectedCustomerId'),false);assert.ok(r.candidates.every(c=>c.customerId!=='foreign-customer'));
  assert.equal(Object.hasOwn(r.candidates[0],'createdByUserId'),false);
});
test('own scope uses original membership query and never follows other workspace orders',async()=>{
  const h=await setup();h.identity.user.dataScope='own';
  const r=await h.service.read({limit:10});assert.deepEqual(r.candidates.map(x=>x.customerId),['customer-a']);
  assert.equal(h.queries[0].where.workspaceId,'workspace-a');assert.equal(h.queries[0].where.tenantId,'tenant-a');
});
test('selected empty locations are rejected by the original Guard before member storage',async()=>{
  const h=await setup();h.identity.user.locationScope={mode:'selected',locationIds:[]};
  await assert.rejects(h.service.read({limit:10}),e=>e.code==='FORBIDDEN');
  assert.equal(h.queries.length,0);
});
test('no results are a bounded empty candidate list, not an automatically selected customer',async()=>{
  const h=await setup();h.profiles.length=0;assert.deepEqual((await h.service.read({limit:10})).candidates,[]);
});
test('permission denied and revoked membership do not reach member storage',async()=>{
  for(const change of [h=>{h.identity.user.permissions=[];},h=>{h.identity.membership=false;}]) {
    const h=await setup();change(h);await assert.rejects(h.service.read({limit:10}));assert.equal(h.queries.length,0);
  }
});
test('scope or location narrowing while reading suppresses late candidates',async()=>{
  for(const change of [h=>{h.identity.workspace='workspace-b';},h=>{h.identity.user.locationScope={mode:'selected',locationIds:[]};}]) {
    const h=await setup();h.control.afterRead=async()=>change(h);await assert.rejects(h.service.read({limit:10}));
  }
});
for(const phoneMasked of ['13800000000*','*13800000000','138*00000000','138****0000 secret','138****0000\n'])
  test(`mask marker cannot conceal clear or appended contact data ${JSON.stringify(phoneMasked)}`,async()=>{
    const h=await setup();h.profiles[0].phoneMasked=phoneMasked;
    await assert.rejects(h.service.read({limit:10}),e=>e.code==='INVALID_RESPONSE');
  });
test('caller tenant/workspace/selection and excessive limits are rejected before storage',async()=>{
  const h=await setup();for(const input of [{limit:10,tenantId:'tenant-b'},{limit:10,workspaceId:'workspace-b'},{limit:10,selectedCustomerId:'customer-a'},{limit:51}])await assert.rejects(h.service.read(input));
  assert.equal(h.queries.length,0);
});
