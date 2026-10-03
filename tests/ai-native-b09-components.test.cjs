'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root,load,mount}=require('./fixtures/ai-native/b09-host.cjs');
const {checkComponent}=require('./fixtures/ai-native/b09-component-check.cjs');
test('checker rejects missing files, methods and declarations',()=>{
 assert.deepEqual(checkComponent({definition:{},json:{},wxml:'<button bindtap="absent"/>',files:[]}),['not component','missing js','missing json','missing wxml','missing wxss','missing method absent']);
});
test('checker rejects missing binding roots, out-of-loop aliases, invalid syntax and missing local references',()=>{
 const base={definition:{properties:{rows:{}}},json:{component:true},files:['js','json','wxml','wxss']};
 assert.deepEqual(checkComponent({...base,wxml:'<view>{{absent}}</view>'}),['missing binding absent']);
 assert.deepEqual(checkComponent({...base,wxml:'<view wx:for="{{rows}}">{{item.title}}</view><text>{{item.title}}</text>'}),['missing binding item']);
 assert.ok(checkComponent({...base,wxml:'<view>{{rows(}}</view>'}).includes('invalid binding syntax'));
 assert.ok(checkComponent({...base,wxml:'<view>{{rows()}}</view>'}).includes('executable binding forbidden'));
 assert.deepEqual(checkComponent({...base,wxml:'<view/>',json:{component:true,usingComponents:{child:'./absent'}}}),['missing component reference child']);
 assert.deepEqual(checkComponent({...base,wxml:'<view wx:for="{{rows}}" wx:for-item="row">{{row.title}}</view>'}),[]);
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
