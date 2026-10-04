'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
const cases=[
 {name:'ai-order-explanation',field:'projection',empty:null,props:{available:true,order:{title:'Synthetic'}}},
 {name:'ai-memory-preference',field:'rows',empty:[],props:{available:true,nowIso:'2026-10-04T00:00:00Z',items:[{id:'m',revision:'1',status:'proposed',label:'Synthetic',value:'Synthetic',expiresAt:'2026-10-04T01:00:00Z'}]}},
 {name:'ai-knowledge-source',field:'visibleSources',empty:[],props:{sources:[{id:'s',version:'1',status:'published',title:'Synthetic'}]}},
 {name:'ai-inspection-draft',field:'visibleItems',empty:[],props:{readonly:false,items:[{key:'mileage',candidate:0,humanValue:0}],missing:['Synthetic']}},
 {name:'ai-step-timeline',field:'visibleSteps',empty:[],props:{available:true,taskId:'t',steps:[{id:'s',ordinal:1,label:'Synthetic'}]}},
];
for(const app of ['miniprogram','staff-miniprogram']) for(const spec of cases) {
 test(app+' '+spec.name+' cannot repopulate or setData from late props after detached',()=>{
  const instance=mount(load('apps/'+app+'/src/components/ai-native/'+spec.name+'/index.ts'),spec.props);
  assert.ok(instance.data[spec.field], 'initial projection');
  instance.detach();assert.equal(JSON.stringify(instance.data[spec.field]),JSON.stringify(spec.empty));
  let writes=0;const original=instance.setData;
  instance.setData=function(patch){writes++;original.call(this,patch);};
  instance.update(structuredClone(spec.props)); instance.project();
  assert.equal(writes,0,'no detached setData');
  assert.equal(JSON.stringify(instance.data[spec.field]),JSON.stringify(spec.empty));
  if(instance.onHumanInput)instance.onHumanInput({currentTarget:{dataset:{key:'mileage'}},detail:{value:'10'}});
  assert.equal(instance.events.length,0);
 });
}
