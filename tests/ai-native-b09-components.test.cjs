'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,load,mount}=require('./fixtures/ai-native/b09-host.cjs');
const {checkComponent}=require('./fixtures/ai-native/b09-component-check.cjs');
test('checker rejects missing files, methods and declarations',()=>{
 assert.deepEqual(checkComponent({definition:{},json:{},wxml:'<button bindtap="absent"/>',files:[]}),['not component','missing js','missing json','missing wxml','missing wxss','missing method absent']);
});
for(const app of ['miniprogram','staff-miniprogram']) test(app+' generated components load, pair methods and detach',()=>{
 const dir=path.join(root,'apps',app,'dist/components/ai-native');
 for(const name of fs.readdirSync(dir).filter(name=>fs.statSync(path.join(dir,name)).isDirectory())){
  const rel='apps/'+app+'/dist/components/ai-native/'+name+'/index.js';
  const definition=load(rel);
  const json=JSON.parse(fs.readFileSync(path.join(dir,name,'index.json'),'utf8'));
  const wxml=fs.readFileSync(path.join(dir,name,'index.wxml'),'utf8');
  assert.deepEqual(checkComponent({definition,json,wxml,files:['js','json','wxml','wxss']}),[],name);
  const instance=mount(definition); instance.detach(); assert.equal(instance.events.length,0,name+' automatic effects');
 }
});
