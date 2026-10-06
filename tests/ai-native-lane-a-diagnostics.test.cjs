'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({transpileOnly:false,compilerOptions:{module:'commonjs',moduleResolution:'node',experimentalDecorators:true,emitDecoratorMetadata:true}});
const {AiOpeningReadFactsService,AiRiskReadFactsService}=require('../apps/api/src/modules/ai-native/tools/diagnostic-read-facts.service');
const {RentalCoreService}=require('../apps/api/src/modules/rental-core/rental-core.service');
const {RentalBusinessService}=require('../apps/api/src/modules/rental-core/rental-business.service');
const {RentalWorkspaceReportRepository}=require('../apps/api/src/modules/rental-core/rental-workspace-report.repository');
const {ApiAuthGuard}=require('../apps/api/src/common/api-auth.guard');
const {ExecutionContextHost}=require('@nestjs/core/helpers/execution-context-host');
const {runWithRequestIdentity,getRequestIdentity}=require('../apps/api/src/common/request-identity');
const {authorizedRunnerHarness}=require('./fixtures/ai-native/task-authorized-runner.cjs');
const stores=require('./helpers/absorbing-config-store.cjs');
const {RENTAL_CATEGORY_DEFINITIONS,AI_CONTRACT_DRAFT_VERSION}=require('./fixtures/ai-native/local-shared.cjs');
async function setup(){
 const h=await authorizedRunnerHarness();h.identity.user.permissions.push('rental-os:report:view');
 const guard=new ApiAuthGuard(h.authorization.auth,undefined,undefined,undefined,{});
 // Explicit OFFLINE composition of the original Guard, not a production adapter.
 // This executes the real permission route and ALS; only its persistent reads are mocked.
 const authority={withRead:async(kind,input,consume)=>{
   const authorize=async work=>runWithRequestIdentity({},async()=>{
    const c=await h.authorization.credentials.current();const path=kind==='opening'?'/api/rental/v1/tenant-readiness':'/api/rental/v1/reports/operations';
    const req={url:path,originalUrl:path,method:'GET',headers:{authorization:c.authorization},query:structuredClone(input),staffApiRequest:false};
    assert.equal(await guard.canActivate(new ExecutionContextHost([req])),true);
    const i=getRequestIdentity();return work({contractVersion:AI_CONTRACT_DRAFT_VERSION,requestId:c.requestId,authorizedAt:new Date(h.control.now).toISOString(),audience:'operator',actor:{kind:'user',userId:req.user.id},scope:{kind:'workspace',tenantId:i.tenantId,workspaceId:i.workspaceId},access:{permissions:req.user.permissions,dataScope:i.dataScope,locationScope:i.locationScope}});
   });
   return authorize(async context=>{const before=JSON.stringify(context);const out=await consume(context);await authorize(async current=>{assert.equal(JSON.stringify(current),before);});return out;});
 }};
 const config=stores.createAbsorbingConfigStore();config.listWorkspaces=async()=>[{id:'workspace-a',tenantId:'tenant-a',categoryCode:'camera',isDefault:true}];
 const core=new RentalCoreService(config,stores.createAbsorbingFactStore());await core.onApplicationBootstrap();
 const bc=stores.createAbsorbingBusinessConfigStore();bc.loadAll=async()=>[{tenantId:'tenant-a',workspaceId:'workspace-a',categoryCode:'camera',hasPersistedConfig:true,pricingPlans:[],discountPlans:[],services:[],calendars:[],ruleVersions:[],notificationTemplates:[]}];
 const business=new RentalBusinessService(bc,stores.createAbsorbingBusinessFactStore(),config);await business.onApplicationBootstrap();
 const context={profile:core.getProfile('tenant-a'),category:RENTAL_CATEGORY_DEFINITIONS.find(x=>x.code==='camera'),settings:core.getBusinessSettings('tenant-a'),groups:[],pricingGroups:[],locations:[],operators:[],couponTemplates:[]};
 const queryLog=[];const db={rentalOrder:{groupBy:async q=>{queryLog.push(q);return [];},aggregate:async q=>{queryLog.push(q);return {_sum:{}};},findMany:async q=>{queryLog.push(q);return [];}},rentalAsset:{groupBy:async q=>{queryLog.push(q);return []; }},rentalStockBalance:{aggregate:async q=>{queryLog.push(q);return {_sum:{}};}}};
 const reports=new RentalWorkspaceReportRepository(db);
 return {...h,authority,business,context,reports,queryLog,opening:new AiOpeningReadFactsService(business,{current:async()=>context},authority),risk:new AiRiskReadFactsService(reports,{currency:async()=> 'CNY',category:async()=> 'camera'},authority)};
}
test('opening projection calls real readiness and distinguishes missing from dependency unavailable',async()=>{const h=await setup();const out=await h.opening.read({limit:50});assert.equal(out.ready,false);assert.equal(out.items.find(x=>x.key==='business_rule').status,'missing');assert.equal(out.items.find(x=>x.key==='membership_base').status,'unavailable');assert.equal(out.items.some(x=>'nextHref'in x),false);});
test('risk calls original report repository and does not invent profit or historical utilization',async()=>{const h=await setup();const out=await h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'});assert.equal(out.orderCount,0);assert.equal(out.profit.status,'unavailable');assert.equal(out.historicalUtilization.status,'unavailable');assert.equal(out.inventoryBasis,'current_snapshot');assert.ok(h.queryLog.length>0);for(const q of h.queryLog){assert.equal(q.where.tenantId,'tenant-a');assert.equal(q.where.workspaceId,'workspace-a');}});
for(const kind of ['opening','risk'])test(`${kind} denied routes never read business data`,async()=>{const h=await setup();h.identity.user.permissions=[];await assert.rejects(kind==='opening'?h.opening.read({limit:50}):h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'}));assert.equal(h.queryLog.length,0);});
test('own report scope remains refused by original report implementation',async()=>{const h=await setup();h.identity.user.dataScope='own';await assert.rejects(h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'}));assert.equal(h.queryLog.length,0);});
test('unknown scope fields, unbounded dates and invalid locations do not reach queries',async()=>{const h=await setup();for(const input of [{tenantId:'foreign',limit:50},{limit:51}])await assert.rejects(h.opening.read(input));for(const input of [{from:'2026-01-01T00:00:00Z',to:'2027-01-01T00:00:00Z'},{from:'2026-01-02T00:00:00Z',to:'2026-01-01T00:00:00Z'}])await assert.rejects(h.risk.read(input));assert.equal(h.queryLog.length,0);});
test('late opening from another space is suppressed by current Guard revalidation',async()=>{const h=await setup();const real=h.business.tenantReadiness.bind(h.business);h.business.tenantReadiness=async(...args)=>{const result=await real(...args);h.identity.workspace='workspace-b';return result;};await assert.rejects(h.opening.read({limit:50}));});
test('missing original route authority cannot construct an enabled reader',async()=>{const h=await setup();assert.throws(()=>new AiOpeningReadFactsService(h.business,{current:async()=>h.context},{}));assert.throws(()=>new AiRiskReadFactsService(h.reports,{},{}));});
for(const kind of ['opening','risk'])test(`${kind} selected empty locations are denied by the original Guard`,async()=>{const h=await setup();h.identity.user.locationScope={mode:'selected',locationIds:[]};await assert.rejects(kind==='opening'?h.opening.read({limit:50}):h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'}));assert.equal(h.queryLog.length,0);});
for(const field of ['tenantId','workspaceId'])test(`opening rejects returned ${field} from another resource`,async()=>{const h=await setup(),real=h.business.tenantReadiness.bind(h.business);h.business.tenantReadiness=async(...args)=>({...await real(...args),[field]:'foreign'});await assert.rejects(h.opening.read({limit:50}),e=>e.code==='INVALID_RESPONSE');});
for(const field of ['tenantId','workspaceId'])test(`risk rejects returned ${field} from another resource`,async()=>{const h=await setup(),real=h.reports.getOperationReport.bind(h.reports);h.reports.getOperationReport=async(...args)=>({...await real(...args),[field]:'foreign'});await assert.rejects(h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'}),e=>e.code==='INVALID_RESPONSE');});
test('selected report locations retain the original database restrictions',async()=>{const h=await setup();h.identity.user.locationScope={mode:'selected',locationIds:['location-a']};await h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'});const inventory=h.queryLog.filter(q=>q.where.locationId);assert.ok(inventory.length>=2);for(const q of inventory)assert.deepEqual(q.where.locationId.in,['location-a']);});
test('risk late response after selected-location narrowing cannot be returned',async()=>{const h=await setup(),real=h.reports.getOperationReport.bind(h.reports);h.identity.user.locationScope={mode:'selected',locationIds:['location-a','location-b']};h.reports.getOperationReport=async(...args)=>{const r=await real(...args);h.identity.user.locationScope={mode:'selected',locationIds:['location-a']};return r;};await assert.rejects(h.risk.read({from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z'}));});
