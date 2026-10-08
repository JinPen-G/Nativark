'use strict';
// Explicit hook/lifecycle substitute, NOT a React DOM renderer or browser.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react');
const {root} = require('./b09-host.cjs');
exports.mountFeature = function(name, props) {
 const slots = [], cleanups = [], effects = []; let index = 0;
 const hooks = {...React,
  useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
  useRef(initial) { const i = index++; if (!(i in slots)) slots[i] = {current:initial}; return slots[i]; },
  useEffect(effect) { const i = index++; if (!(i in slots)) { slots[i] = true; effects.push(effect); } }
 };
 const ui = require('./b05-ui-stub.cjs');
 function load(file) {
  const resolved = path.resolve(root, 'apps/admin/src/features/ai-native', file);
  if (!resolved.startsWith(path.join(root,'apps/admin/src/features/ai-native')+path.sep)) throw new Error('outside feature');
  const output = ts.transpileModule(fs.readFileSync(resolved,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(output, {exports, require(request) {
   if (request === 'react') return hooks;
   if (request === 'react/jsx-runtime') return require(request);
   if (request === '@/components/ui') return ui;
   if (request.startsWith('./')) return load(request.slice(2)+'.ts');
   throw new Error('unexpected dependency '+request);
  }});
  return exports;
 }
 const component = load(name+'.tsx')[name]; let current = props;
 function render(next = current) { current = next; index = 0; const tree = component(current); for (const effect of effects.splice(0)) cleanups.push(effect()); return tree; }
 function actions(tree, result = []) {
  if (Array.isArray(tree)) { for (const child of tree) actions(child,result); return result; }
  if (!React.isValidElement(tree)) return result;
  if (tree.type === ui.Button || tree.type === ui.ActionButton) result.push(tree.props);
  actions(tree.props.children,result); return result;
 }
 return {render, actions, unmount() { for(const cleanup of cleanups.splice(0)) if(typeof cleanup === 'function')cleanup(); }};
};
