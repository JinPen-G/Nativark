const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

const source = fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/tenant-access/permission-matrix-model.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('exports', 'module', compiled)(loaded.exports, loaded);
const model = loaded.exports;
const role = (id, permissions = [], buttonPermissions = []) => ({ id, tenantId: 'tenant', code: id, name: id,
  fixedAllPermissions: false, scope: 'store', enabledBusinessScopes: ['rental'], isActive: true, dataScope: 'store', permissions, buttonPermissions });
const modules = [
  { code: 'catalog', name: '商品目录', children: [{ code: 'catalog:view', name: '查看商品' }, { code: 'catalog:edit', name: '编辑商品', description: '维护型号规格' }] },
  { code: 'work', name: '养护工单', children: [{ code: 'work:start', name: '开始处理' }] },
];

test('group draft preserves hidden permissions and button grants, and reverting the last change clears it', () => {
  const original = role('operator', ['catalog:view', 'unlisted:permission'], ['work:start']);
  const before = structuredClone(original);
  let draft = model.changePermissionDraft(original, null, ['catalog:edit'], true);
  assert.deepEqual(new Set(draft.permissions), new Set(['catalog:view', 'catalog:edit', 'unlisted:permission', 'work:start']));
  assert.deepEqual(model.permissionDraftChanges(original, draft), { added: ['catalog:edit'], removed: [] });
  draft = model.changePermissionDraft(original, draft, ['catalog:edit'], false);
  assert.equal(draft, null);
  assert.deepEqual(original, before);
});

test('fixed roles and a second role cannot overwrite a pending role draft', () => {
  const owner = { ...role('owner', ['*']), fixedAllPermissions: true };
  assert.equal(model.changePermissionDraft(owner, null, ['catalog:view'], false), null);
  assert.equal(model.roleHasPermission(owner, 'catalog:edit'), true);
  const original = role('operator', ['catalog:view']);
  const draft = model.changePermissionDraft(original, null, ['catalog:edit'], true);
  assert.equal(model.changePermissionDraft(role('other'), draft, ['work:start'], true), draft);
});

test('a refreshed role or changed scope invalidates the original draft baseline', () => {
  const original = role('operator', ['catalog:view']);
  const draft = model.changePermissionDraft(original, null, ['catalog:edit'], true);
  for (const current of [{ ...original, permissions: ['work:start'] }, { ...original, tenantId: 'other' }, { ...original, dataScope: 'own' }]) {
    assert.notEqual(model.rolePermissionBaseline(current), draft.baseline);
    assert.equal(model.changePermissionDraft(current, draft, ['work:start'], true), draft);
  }
});

test('comparison filters real permission differences and searches codes and descriptions', () => {
  const first = role('viewer', ['catalog:view']);
  const second = role('editor', ['catalog:view', 'catalog:edit']);
  const translate = text => text;
  assert.deepEqual(model.projectPermissionModules(modules, [first, second], '', undefined, true, translate).flatMap(group => group.children.map(permission => permission.code)), ['catalog:edit']);
  assert.deepEqual(model.projectPermissionModules(modules, [first], '', undefined, true, translate).map(group => group.children.length), [2, 1]);
  assert.equal(model.projectPermissionModules(modules, [first, second], '规格', undefined, false, translate)[0].children[0].code, 'catalog:edit');
  assert.equal(model.projectPermissionModules(modules, [first, second], 'work:start', 'catalog', false, translate).length, 0);
});

test('keyboard navigation follows visible rows and nearest columns without changing grants', () => {
  const cells = [{ key: 'head:a', row: 0, column: 1 }, { key: 'head:b', row: 0, column: 2 },
    { key: 'group', row: 1, column: 0 }, { key: 'group:a', row: 1, column: 1 }, { key: 'group:b', row: 1, column: 2 },
    { key: 'leaf:a', row: 2, column: 1 }, { key: 'leaf:b', row: 2, column: 2 }];
  const before = structuredClone(cells);
  assert.equal(model.nextPermissionCell(cells, cells[2], 'ArrowDown').key, 'leaf:a');
  assert.equal(model.nextPermissionCell(cells, cells[4], 'ArrowUp').key, 'head:b');
  assert.equal(model.nextPermissionCell(cells, cells[4], 'Home').key, 'group');
  assert.equal(model.nextPermissionCell(cells, cells[2], 'End', true).key, 'leaf:b');
  assert.equal(model.nextPermissionCell(cells, cells[0], 'Space'), undefined);
  assert.deepEqual(cells, before);
});

function matrixHarness() {
  const values = [];
  let cursor = 0;
  const dependencies = {
    react: { ...React, useId: () => 'matrix-test', useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({ current: null }),
      useState: initial => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
        return [values[index], update => { values[index] = typeof update === 'function' ? update(values[index]) : update; }]; } },
    '@/components/ui': Object.fromEntries(['ActionButton', 'Alert', 'Button', 'SearchField', 'AnimatedNumber', 'EmptyScene', 'ListFilterBar', 'ListFilterItem', 'Select', 'Tooltip'].map(name => [name, name])),
    '@/registry/components/checkbox/checkbox': { Checkbox: 'Checkbox' },
    '@/registry/components/popover/popover': { Popover: 'Popover', PopoverContent: 'PopoverContent', PopoverTrigger: 'PopoverTrigger' },
    'motion/react': { AnimatePresence: 'AnimatePresence', motion: { span: 'motion-span', div: 'motion-div' } },
    '@/lib/motion-tokens': { motionTokens: { stagger: { line: .08 }, spring: { smooth: {}, snappy: {} }, duration: { fast: .16 }, ease: { standard: [0, 0, 1, 1] } } },
    '@/lib/usePrefersReducedMotion': { usePrefersReducedMotion: () => true },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    '@/app/designTokens': { ADMIN_PERMISSION_MATRIX_METRICS: { labelWidth: 288, roleWidth: 184, compactLabelWidth: 164, compactRoleWidth: 172 } },
    './PermissionMatrixControls': { PermissionToggle: 'PermissionToggle', PermissionGroupRows: 'PermissionGroupRows' },
    './permission-matrix-model': model,
    './roles-source/classes.json': {}, './roles-source/original.css': {}, './TenantAccess.module.css': {},
  };
  const filename = path.join(__dirname, '../apps/admin/src/features/tenant-access/PermissionMatrix.tsx');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exported, exported.exports);
  return props => { cursor = 0; return exported.exports.PermissionMatrix(props); };
}

function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); return; }
  if (!React.isValidElement(node)) return;
  yield node;
  yield* elements(node.props.children);
}

test('matrix clicks prepare one role draft and hand it to the existing editor only after explicit review', () => {
  const render = matrixHarness();
  const editor = role('editor', ['catalog:view'], ['unlisted:button']);
  const reviewer = role('reviewer', ['catalog:view']);
  let draft = null;
  const opened = [];
  const props = () => ({ roles: [editor, reviewer], modules, draft, onDraftChange: next => { draft = next; },
    onEdit: (...args) => opened.push(args), onRefresh: async () => { throw Error('Unexpected read'); } });
  const toggle = (tree, label) => [...elements(tree)].find(element => element.type === 'PermissionToggle' && element.props.label === label);
  toggle(render(props()), 'editor · 编辑商品').props.onToggle();
  assert.equal(opened.length, 0);
  assert.deepEqual(new Set(draft.permissions), new Set(['catalog:view', 'catalog:edit', 'unlisted:button']));
  const tree = render(props());
  assert.equal(toggle(tree, 'reviewer · 编辑商品').props.disabled, true);
  const before = draft;
  toggle(tree, 'reviewer · 编辑商品').props.onToggle();
  assert.equal(draft, before);
  const review = [...elements(tree)].find(element => element.type === 'Button' && element.props.children === '核对并保存');
  review.props.onClick();
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], editor);
  assert.equal(opened[0][1].section, 'permissions');
  assert.deepEqual(opened[0][1].draft, draft);
  assert.deepEqual(editor.permissions, ['catalog:view']);
});

test('matrix fixed-role controls never create a draft and stale drafts cannot be reviewed', () => {
  const render = matrixHarness();
  const owner = { ...role('owner', ['*']), fixedAllPermissions: true };
  let draft = null;
  const props = { roles: [owner], modules, draft, onDraftChange: next => { draft = next; }, onEdit: () => {}, onRefresh: async () => {} };
  const first = [...elements(render(props))].find(element => element.type === 'PermissionToggle');
  assert.equal(first.props.locked, true);
  first.props.onToggle();
  assert.equal(draft, null);
  const original = role('editor', ['catalog:view']);
  draft = model.changePermissionDraft(original, null, ['catalog:edit'], true);
  const staleTree = render({ ...props, roles: [{ ...original, dataScope: 'own' }], draft });
  const review = [...elements(staleTree)].find(element => element.type === 'Button' && element.props.children === '核对并保存');
  assert.equal(review.props.disabled, true);
});
