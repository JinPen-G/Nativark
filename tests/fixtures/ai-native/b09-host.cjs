'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const root = path.resolve(__dirname, '../../..');
function deny() { throw new Error('B09 external network forbidden'); }
net.connect = net.createConnection = http.request = http.get = https.request = https.get = deny;
global.fetch = deny;
function load(file, transform = source => source) {
  const source = transform(fs.readFileSync(path.join(root, file), 'utf8'));
  const js = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
  const exports = {};
  let definition;
  vm.runInNewContext(js, {exports, Component(value){definition=value;}, require(module){
    if (!module.startsWith('.')) throw new Error('unexpected runtime dependency');
    const extension = file.endsWith('.js') ? '.js' : '.ts';
    const relative=path.posix.join(path.posix.dirname(file),module+extension);
    if (!relative.startsWith('apps/') || relative.includes('..')) throw new Error('out-of-scope runtime dependency');
    return load(relative);
  }, BigInt});
  return definition || exports;
}
function mount(definition, props = {}) {
  const data = Object.fromEntries(Object.entries(definition.properties || {}).map(([key, field]) => [key, structuredClone(field.value)]));
  const events = [];
  const instance = {data:{...data,...structuredClone(definition.data || {}),...props}, events,
    setData(patch){Object.assign(this.data,patch);}, triggerEvent(name,detail){events.push({name,detail});}};
  Object.assign(instance,definition.methods);
  instance.update = patch => {
    Object.assign(instance.data,patch);
    for (const [keys, fn] of Object.entries(definition.observers || {})) {
      if (keys.split(',').some(key=>Object.hasOwn(patch,key.trim()))) fn.call(instance);
    }
  };
  for (const name of ['created','attached']) definition.lifetimes?.[name]?.call(instance);
  instance.detach = () => definition.lifetimes?.detached?.call(instance);
  return instance;
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
module.exports={root,load,mount,deferred};
