'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deferred}=require('./fixtures/ai-native/b09-host.cjs');
const {mountFeature}=require('./fixtures/ai-native/b09-react-hooks.cjs');
const item={id:'synthetic-memory',revision:'1',status:'proposed',actorKind:'human',label:'Preference',value:'Synthetic'};
const run=action=>(action.onAction??action.onClick)();
test('actual preference handler prevents double review and isolates changed content/revision',async()=>{
 const pending=deferred();let calls=0;const callback=()=>{calls++;return pending.promise;};
 const host=mountFeature('MemoryPreferences',{items:[item],onReview:callback});
 const action=host.actions(host.render())[0];const first=run(action),second=run(action);await Promise.resolve();assert.equal(calls,1);
 host.render({items:[{...item,value:'Changed',revision:'2'}],onReview:callback});
 pending.reject(new Error('private'));await Promise.allSettled([first,second]);
 assert.doesNotMatch(JSON.stringify(host.render()),/核对启动失败|private/);
 await assert.rejects(run(action),/不可用|已变化/);host.unmount();
});
test('actual preference handler reports synchronous failure and cannot run after unmount',async()=>{
 const host=mountFeature('MemoryPreferences',{items:[item],onReview:()=>{throw new Error('private');}});
 const action=host.actions(host.render())[0];await Promise.allSettled([run(action)]);
 assert.match(JSON.stringify(host.render()),/核对启动失败/);
 host.unmount();await assert.rejects(run(action),/不可用|已变化/);
});
for(const change of [{value:'Changed at same revision'},{status:'revoked'},{actorKind:'automation'}]) {
 test('preference old closure invalidates on '+Object.keys(change)[0]+' without revision change',async()=>{
  const pending=deferred();const callback=()=>pending.promise;
  const host=mountFeature('MemoryPreferences',{items:[item],onReview:callback});
  const action=host.actions(host.render())[0];const first=run(action);await Promise.resolve();
  host.render({items:[{...item,...change}],onReview:callback});pending.resolve();
  const outcome=await Promise.allSettled([first]);assert.equal(outcome[0].status,'rejected','late settlement is not a current success');
  await assert.rejects(run(action),/不可用|已变化/);host.unmount();
 });
}
test('real React SSR never labels automation as human-confirmed or retains withdrawn content',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {MemoryPreferences}=require('./fixtures/ai-native/b04-render.cjs').loadFeature('MemoryPreferences.tsx');
 const html=renderToStaticMarkup(React.createElement(MemoryPreferences,{items:[{...item,status:'confirmed',actorKind:'automation',value:'synthetic-private'},{...item,id:'revoked',status:'revoked',value:'synthetic-private'}]}));
 assert.doesNotMatch(html,/synthetic-private|>已确认</);assert.match(html,/确认依据待核对/);
});
