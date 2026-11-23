'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function loadTs(relative) {
  const file = path.join(root, relative);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require, console });
  return exports;
}

const display = loadTs('packages/ai-native-admin/src/ai-native/safe-display.ts');

function loadSession() {
  const file = path.join(root, 'apps/admin/src/features/ai-native/settings-save-session.ts');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require, console, Promise });
  return exports.SettingsSaveSession;
}

test('safe display treats model text as text, removes controls and bounds by code points', () => {
  assert.equal(display.safeDisplayText('<script>\u202Eabc\u0000', 64), '<script>abc');
  assert.equal(display.safeDisplayText('abcdef', 3), 'abc');
  assert.equal(display.safeDisplayText(null), '内容不可用');
  assert.equal(display.safeDisplayLabel('\u0000', '不可用'), '不可用');
});

test('source adapters do not expose callback functions through native properties', () => {
  for (const app of ['apps/miniprogram', 'apps/staff-miniprogram']) {
    const source = fs.readFileSync(path.join(root, app, 'src/components/ai-native/ai-knowledge-source/index.ts'), 'utf8');
    const wxml = fs.readFileSync(path.join(root, app, 'src/components/ai-native/ai-knowledge-source/index.wxml'), 'utf8');
    assert.doesNotMatch(source, /openHandler:\s*\{/);
    assert.doesNotMatch(source, /data\.openHandler/);
    assert.doesNotMatch(wxml, /openHandler/);
    assert.match(source, /attachHost/);
    assert.match(source, /hostAction\(this\)/);
  }
});

test('native action children keep callbacks in instance host bindings', () => {
  for (const app of ['apps/miniprogram', 'apps/staff-miniprogram']) {
    for (const component of ['ai-supplement-input', 'ai-proposal-confirm']) {
      const source = fs.readFileSync(path.join(root, app, 'src/components/ai-native', component, 'index.ts'), 'utf8');
      assert.doesNotMatch(source, /submitHandler:\s*\{|confirmHandler:\s*\{/);
      assert.match(source, /attachHost/);
      assert.match(source, /hostAction\(this\)/);
    }
  }
});

test('admin and native status views expose pending/error announcements', () => {
  const workbench = fs.readFileSync(path.join(root, 'packages/ai-native-admin/src/ai-native/AiTaskWorkbench.tsx'), 'utf8');
  assert.match(workbench, /aria-busy=\{detailState === "loading"\}/);
  for (const app of ['apps/miniprogram', 'apps/staff-miniprogram']) {
    const input = fs.readFileSync(path.join(root, app, 'src/components/ai-native/ai-supplement-input/index.wxml'), 'utf8');
    assert.match(input, /role="alert"/);
    assert.match(input, /正在提交补充信息/);
  }
});

test('resync-required workbench output suppresses stale detail children', () => {
  const source = fs.readFileSync(path.join(root, 'packages/ai-native-admin/src/ai-native/AiTaskWorkbench.tsx'), 'utf8');
  assert.match(source, /detailSynchronized/);
  const ast = ts.createSourceFile('AiTaskWorkbench.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let gatedTimeline = false;
  (function visit(node) {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && ts.isIdentifier(node.left) && node.left.text === 'detailSynchronized') {
      (function descendants(child) {
        if ((ts.isJsxSelfClosingElement(child) || ts.isJsxOpeningElement(child))
          && child.tagName.getText(ast) === 'TaskTimeline') gatedTimeline = true;
        ts.forEachChild(child, descendants);
      })(node.right);
    }
    ts.forEachChild(node, visit);
  })(ast);
  assert.ok(gatedTimeline, 'the original accordion timeline must remain inside the synchronized-detail gate');
  assert.match(source, /事件未同步，请由宿主重新读取快照后再继续/);
});

test('settings save session releases its local flight when pending notification fails', async () => {
  const SettingsSaveSession = loadSession();
  const session = new SettingsSaveSession();
  session.activate();
  session.bind('context-a', async () => undefined, false);
  await assert.rejects(session.run(async () => undefined, () => { throw new Error('view replaced'); }), /AI 设置操作不可用/);
  const states = [];
  await session.run(async () => undefined, state => states.push(state));
  assert.deepEqual(states, ['pending', 'request_finished']);
});
