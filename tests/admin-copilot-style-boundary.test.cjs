const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, name) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `missing adapter: ${name}`);
  const source = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require, URL, __filename: path.join(root, file) });
  return exports;
}

(async () => {
  const file = 'packages/rental-core/admin/assistant/copilot/archive/ai-side-panel/side-panel.css';
  // The archive manifest records LF source bytes; Windows checkouts may use CRLF.
  const source = read(file).replaceAll('\r\n', '\n');
  const manifest = JSON.parse(read('packages/rental-core/admin/assistant/copilot/archive/source-manifest.json'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
    manifest.find(entry => entry.path === 'ai-side-panel/side-panel.css').sha256);
  const { copilotArchiveStyles } = load('packages/platform-admin/config/copilotArchiveStyles.ts', 'copilotArchiveStyles');
  const { motionPreferenceStyles } = load('packages/platform-admin/config/motionPreferenceAdapter.ts', 'motionPreferenceStyles');
  const result = await postcss([motionPreferenceStyles(), copilotArchiveStyles()])
    .process(source, { from: path.join(root, file) });
  const boundary = ':not(:where([data-admin-content], [data-admin-content] *))';
  let guarded = 0;
  result.root.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) {
      assert.ok(!rule.selector.includes(boundary), 'keyframe offsets stay unchanged');
      return;
    }
    for (const selector of rule.selectors) {
      assert.ok(selector.includes(boundary), `unprotected selector: ${selector}`);
      assert.ok(!/::[\w-]+:not/.test(selector), 'exclude on the originating element, not its pseudo-element');
      guarded++;
    }
  });
  assert.ok(guarded > 100);
  assert.ok(result.css.includes(`.ai-side-panel button${boundary}`));
  assert.ok(result.css.includes(`${boundary}::before`));
  assert.ok(result.css.includes(':where(html[data-reduced-motion="true"])'));
  const declarations = tree => {
    const values = [];
    tree.walkDecls(decl => values.push([decl.prop, decl.value, decl.important]));
    return values;
  };
  assert.deepEqual(declarations(result.root), declarations(postcss.parse(source)),
    'all original declarations, geometry, motion and important flags are retained');
  const legacyFile = 'apps/admin/src/features/copilot/archive/ai-side-panel/side-panel.css';
  const legacySource = read(legacyFile).replaceAll('\r\n', '\n');
  assert.equal(legacySource, source, 'the selected Core keeps the exact original archive content');
  const legacy = await postcss([motionPreferenceStyles(), copilotArchiveStyles()])
    .process(legacySource, { from: path.join(root, legacyFile) });
  assert.equal(legacy.css, result.css, 'old and selected hosts preserve the same guarded selectors');
  const duplicate = await postcss([motionPreferenceStyles(), copilotArchiveStyles(), copilotArchiveStyles()])
    .process(source, { from: path.join(root, file) });
  assert.equal(duplicate.css, result.css, 'the legacy explicit plugin does not apply the boundary twice');
  const unrelated = await postcss([copilotArchiveStyles()])
    .process(source, { from: path.join(root, 'unrelated/side-panel.css') });
  assert.equal(unrelated.css, source, 'the adapter only changes the imported Copilot archive');
  assert.match(read('packages/platform-admin/config/vite.ts'), /postcss: \[motionPreferenceStyles\(\), nativeSidebarStyles\(\), copilotArchiveStyles\(\)\]/);
  assert.match(read('apps/admin/config/copilotArchiveStyles.ts'), /export \{ copilotArchiveStyles \} from "\.\.\/\.\.\/\.\.\/packages\/platform-admin\/config\/copilotArchiveStyles"/);
  for (const host of ['apps/admin', 'apps/rental-admin', 'apps/example-multi-core-admin']) {
    assert.match(read(`${host}/vite.config.ts`), /postcss: \{ plugins: (?:platform\.postcss|\[\.\.\.platform\.postcss, copilotArchiveStyles\(\)\])/);
  }
  assert.match(read('packages/platform-admin/src/components/BusinessShell.tsx'), /className=\{`app-content[^\n]+data-admin-content/);
  assert.match(read('apps/admin/src/components/AppShell.tsx'), /wrapContent=\{column => <CopilotLayout[^>]*>\{column\}<\/CopilotLayout>\}/);
  assert.match(read('packages/rental-core/admin/assistant-shell.tsx'), /wrapContent: column => <CopilotLayout[^>]*>\{column\}<\/CopilotLayout>/);
  console.log(`admin-copilot-style-boundary: ${guarded} selectors isolated; source hash and declarations unchanged (offline CSS contract only)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
