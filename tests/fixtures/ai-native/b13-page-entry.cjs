'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPage(app) {
  const file = path.resolve(__dirname, '..', '..', '..', 'apps', app, 'src', 'pages', 'order', 'index.ts');
  const source = fs.readFileSync(file, 'utf8').replace(/^import[^\n]*\n/gm, '');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    fileName: file,
  }).outputText;
  let definition;
  const context = {
    Page(value) { definition = value; },
    loadingState: () => ({ status: 'loading', title: '', message: '' }),
    themeBehavior: {},
    console,
  };
  vm.runInNewContext(output, context, { filename: file });
  if (!definition) throw new Error(`${app} order page did not register a Page definition`);
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
    selectComponent(id) { assertKnownId(id); return workbench; },
    setData() {},
  };
  function assertKnownId(id) {
    if (id !== '#ai-native-workbench') throw new Error(`unexpected component lookup: ${id}`);
  }
  definition.onHide?.call(instance);
  definition.onUnload?.call(instance);
  return { calls, data: definition.data };
}

module.exports = { loadPage, lifecycleProbe };
