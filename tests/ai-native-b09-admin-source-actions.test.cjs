'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {deferred} = require('./fixtures/ai-native/b09-host.cjs');
const {mountFeature} = require('./fixtures/ai-native/b09-react-hooks.cjs');
const source = {id:'synthetic-source',version:'1',status:'available',title:'Synthetic'};
const run = action => (action.onAction ?? action.onClick)();
test('actual source handler synchronously locks duplicate actions and surfaces safe current failure', async () => {
 const pending = deferred(); let calls = 0;
 const props = {sources:[source],onOpen:()=>{calls++;return pending.promise;}};
 const host = mountFeature('KnowledgeSources',props); const action = host.actions(host.render())[0];
 const first = run(action), second = run(action);
 await Promise.resolve(); assert.equal(calls,1);
 pending.reject(new Error('private credential detail'));
 await Promise.allSettled([first,second]);
 const tree = host.render();
 assert.match(JSON.stringify(tree),/来源打开失败/);
 assert.doesNotMatch(JSON.stringify(tree),/private credential/); host.unmount();
});
test('actual source handler drops revoked A-B-A and replaced callback feedback', async () => {
 const pending = deferred(); const callback = ()=>pending.promise;
 const host = mountFeature('KnowledgeSources',{sources:[source],onOpen:callback});
 const old = host.actions(host.render())[0]; const request = run(old); await Promise.resolve();
 host.render({sources:[{...source,status:'withdrawn'}],onOpen:callback});
 host.render({sources:[source],onOpen:()=>Promise.resolve()});
 pending.reject(new Error('old failure')); await Promise.allSettled([request]);
 assert.doesNotMatch(JSON.stringify(host.render()),/来源打开失败/);
 await assert.rejects(run(old),/不可用|已变化/); host.unmount();
});
test('actual source handler cannot restart from stale closures after unmount', async () => {
 const pending = deferred(); let calls = 0;
 const host = mountFeature('KnowledgeSources',{sources:[source],onOpen:()=>{calls++;return pending.promise;}});
 const action = host.actions(host.render())[0]; const first = run(action); await Promise.resolve();
 host.unmount(); pending.resolve(); await Promise.allSettled([first]);
 await assert.rejects(run(action),/不可用|已变化/); assert.equal(calls,1);
});
test('different resource cannot borrow an in-flight open result from the same render', async () => {
 const pending = deferred(), calls = [];
 const host = mountFeature('KnowledgeSources', {sources:[source,{...source,id:'other-source'}],onOpen:input=>{calls.push(input.id);return pending.promise;}});
 const actions = host.actions(host.render());
 const first = run(actions[0]); const second = run(actions[1]);
 const rejected = assert.rejects(second,/处理中|不可用|已变化/);
 pending.resolve(); await first; await rejected;
 assert.deepEqual(calls,['synthetic-source']); host.unmount();
});
test('new resource revision cannot coalesce into an older revision dispatch', async () => {
 const pending = deferred(); let calls = 0; const callback = ()=>{calls++;return pending.promise;};
 const host = mountFeature('KnowledgeSources',{sources:[source],onOpen:callback});
 const first = run(host.actions(host.render())[0]); await Promise.resolve();
 const actions = host.actions(host.render({sources:[{...source,version:'2'}],onOpen:callback}));
 const second = run(actions[0]); const rejected = assert.rejects(second,/处理中|不可用|已变化/);
 await rejected; // Must reject before the older dispatch settles, not borrow its later stale rejection.
 pending.resolve(); await Promise.allSettled([first]);
 assert.equal(calls,1); assert.doesNotMatch(JSON.stringify(host.render()),/来源打开失败/);host.unmount();
});
