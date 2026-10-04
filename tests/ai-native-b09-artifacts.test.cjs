'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {root}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' full artifact owns all pages and AI components',()=>{
 const dist=path.join(root,'apps',app,'dist');
 const config=JSON.parse(fs.readFileSync(path.join(dist,'app.json'),'utf8'));
 for(const page of config.pages) for(const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.join(dist,page+'.'+ext)),page+'.'+ext);
 const dir=path.join(dist,'components/ai-native');
 for(const name of fs.readdirSync(dir).filter(name=>fs.statSync(path.join(dir,name)).isDirectory())){
  for(const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.join(dir,name,'index.'+ext)),name+ext);
  assert.doesNotMatch(fs.readFileSync(path.join(dir,name,'index.js'),'utf8'),/@rental-os\/shared|[A-Z]:\\/);
 }
});
