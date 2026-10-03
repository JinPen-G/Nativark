'use strict';
const ts = require('typescript');
function checkExpression(expression, names, errors) {
 const ast = ts.createSourceFile('binding.ts', 'const __binding = ('+expression+');', ts.ScriptTarget.Latest, true);
 if (ast.parseDiagnostics.length) { errors.push('invalid binding syntax'); return; }
 function visit(node) {
  if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) errors.push('executable binding forbidden');
  if (ts.isIdentifier(node) && node.text !== '__binding') {
   const propertyName = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) ||
    (ts.isPropertyAssignment(node.parent) && node.parent.name === node);
   if (!propertyName && !names.has(node.text)) errors.push('missing binding '+node.text);
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);
}
function checkComponent({definition,json,wxml,files,resolveReference}){
 const errors=[];
 if(json.component!==true) errors.push('not component');
 for(const ext of ['js','json','wxml','wxss']) if(!files.includes(ext)) errors.push('missing '+ext);
 for(const match of wxml.matchAll(/\b(?:bind|catch)(?::)?[\w-]+=["']([^"']+)["']/g)) if(typeof definition.methods?.[match[1]]!=='function') errors.push('missing method '+match[1]);
 for(const [alias,ref] of Object.entries(json.usingComponents||{})) {
  if(typeof ref!=='string'||!ref.startsWith('./')) errors.push('unchecked reference '+alias);
  else if(typeof resolveReference!=='function'||!resolveReference(ref)) errors.push('missing component reference '+alias);
 }
 const names = new Set([...Object.keys(definition.properties||{}),...Object.keys(definition.data||{}),'undefined']);
 const stack=[names];
 const tags=/<(\/?)([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
 let previous=0;
 function bindings(text,scope){for(const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) checkExpression(match[1],scope,errors);}
 for(const tag of wxml.matchAll(tags)){
  bindings(wxml.slice(previous,tag.index),stack.at(-1));previous=tag.index+tag[0].length;
  if(tag[1]){if(stack.length>1)stack.pop();continue;}
  const attrs=Object.fromEntries([...tag[3].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(match=>[match[1],match[2]??match[3]]));
  if(attrs['wx:for']) bindings(attrs['wx:for'],stack.at(-1));
  const scope=new Set(stack.at(-1));
  if(attrs['wx:for']){scope.add(attrs['wx:for-item']||'item');scope.add(attrs['wx:for-index']||'index');}
  for(const [name,value] of Object.entries(attrs)) if(name!=='wx:for') bindings(value,scope);
  if(!/\/\s*>$/.test(tag[0]))stack.push(scope);
 }
 bindings(wxml.slice(previous),stack.at(-1));
 return errors;
}
module.exports={checkComponent};
