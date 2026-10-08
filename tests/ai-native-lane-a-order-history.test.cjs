'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({transpileOnly:false,compilerOptions:{module:'commonjs',moduleResolution:'node',experimentalDecorators:true,emitDecoratorMetadata:true}});
const {setup}=require('./fixtures/ai-native/order-facts.cjs');
function saved(s){Object.assign(s.order,{ruleVersion:'old-rule-2',ruleSnapshot:{fulfillment:{pickupInspectionRequired:true,returnInspectionRequired:false},internal:'DO_NOT_LEAK'},pricingPlanVersion:'old-plan-3',priceVersionId:'old-price',priceVersion:'3',calendarVersion:'2025:v2',inspectionTemplateSnapshots:[{id:'template-old',tenantId:'tenant-a',categoryCode:'camera',code:'pickup',name:'Historical check',stage:'pickup',version:'old-1',enabled:true,fields:[],secret:'DO_NOT_LEAK'}]});}
test('history comes from the actual guarded Core order, never current configuration',async()=>{
 const f=await setup();saved(f.state);const out=await f.reader.readHistoricalBasis();
 assert.equal(out.rule.version,'old-rule-2');assert.equal(out.rule.pickupInspectionRequired,true);
 assert.equal(out.price.priceVersionId,'old-price');assert.equal(out.price.rateEvidence,'not_loaded');
 assert.deepEqual(out.inspection.templates,[{id:'template-old',code:'pickup',stage:'pickup',version:'old-1'}]);
 assert.equal(out.basis,'order_snapshot');assert.equal(JSON.stringify(out).includes('DO_NOT_LEAK'),false);assert.equal(f.state.reads.length,1);
});
test('missing snapshots never fall back to current rules or check templates',async()=>{
 const f=await setup();const out=await f.reader.readHistoricalBasis();
 assert.equal(out.rule.status,'missing');assert.equal(out.inspection.status,'missing');assert.equal(out.price.status,'missing');assert.equal(out.complete,false);
});
test('explicit empty saved templates differ from missing historical templates',async()=>{
 const f=await setup();saved(f.state);f.state.order.inspectionTemplateSnapshots=[];const out=await f.reader.readHistoricalBasis();
 assert.equal(out.inspection.status,'available');assert.deepEqual(out.inspection.templates,[]);assert.equal(out.complete,false);
});
for(const patch of [{ruleSnapshot:{fulfillment:{pickupInspectionRequired:'yes',returnInspectionRequired:false}}},{inspectionTemplateSnapshots:[{id:'template-a',tenantId:'tenant-b',code:'x',stage:'pickup',version:'1'}]},{inspectionTemplateSnapshots:Array.from({length:51},()=>({}))},{ruleVersion:''},{priceVersionId:'price-a',priceVersion:undefined}])
test('malformed or cross-tenant historical evidence cannot become available',async()=>{const f=await setup();saved(f.state);Object.assign(f.state.order,patch);await assert.rejects(f.reader.readHistoricalBasis());});
for(const mutate of [s=>s.workspace='workspace-b',s=>s.user.permissions=[],s=>s.member=false,s=>s.user.locationScope={mode:'selected',locationIds:[]}])
test('late history after scope narrowing or revocation is not returned',async()=>{const f=await setup();saved(f.state);f.state.afterRead=()=>mutate(f.state);await assert.rejects(f.reader.readHistoricalBasis());});
test('missing order remains unavailable and no historical values are fabricated',async()=>{const f=await setup();f.state.order=null;await assert.rejects(f.reader.readHistoricalBasis());});
