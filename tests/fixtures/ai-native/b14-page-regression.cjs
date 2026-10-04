'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPage(app) {
  const file = path.resolve(__dirname, '..', '..', '..', 'apps', app, 'src', 'pages', 'order', 'index.ts');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[^\n]*\n/gm, '');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None }, fileName: file }).outputText;
  let definition;
  const context = {
    Page(value) { definition = value; },
    loadingState: () => ({ status: 'loading', title: '', message: '' }),
    themeBehavior: {},
    console,
  };
  vm.runInNewContext(output, context, { filename: file });
  if (!definition) throw new Error(`${app} order page did not register`);
  return definition;
}

function lifecycleProbe(definition) {
  const calls = [];
  const workbench = {
    hostHide() { calls.push('hide'); },
    hostLogout() { calls.push('logout'); },
  };
  const instance = {
    data: definition.data,
    selectComponent(id) { if (id !== '#ai-native-workbench') throw new Error(`unexpected lookup ${id}`); return workbench; },
    setData() {},
  };
  definition.onHide?.call(instance);
  definition.onUnload?.call(instance);
  return { calls, data: definition.data };
}

function defaultOffProbe(definition) {
  const calls = [];
  // The real page's onShow owns ordinary order loading. We intentionally do
  // not call it here: this probe is limited to the AI entry and must not turn
  // a page unit test into an order HTTP test.
  return { calls, enabled: definition.data.aiNativeEntryVisible === true };
}

module.exports = { loadPage, lifecycleProbe, defaultOffProbe };
