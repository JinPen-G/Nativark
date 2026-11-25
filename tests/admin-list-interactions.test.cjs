const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

function sourceFile(relative) {
  relative = relative.replaceAll("\\", "/");
  const root = path.resolve(__dirname, '..');
  if (relative === 'apps/admin/src/app/locale.tsx' || relative === 'apps/admin/src/components/ui/LiveRefresh.tsx') return path.resolve(root, relative);
  const candidates = [
    relative.replace(/^apps\/admin\/src\/registry\//u, "packages/ui-arc/vendor/registry/"),
    relative.replace(/^apps\/admin\/src\/features\/membership\//u, 'packages/rental-core/admin/membership/'),
    relative.replace(/^apps\/admin\/src\/features\/catalog\//u, 'packages/rental-core/admin/catalog/'),
    relative.replace(/^apps\/admin\/src\/features\/fulfillment\//u, 'packages/rental-core/admin/locations/'),
    relative.replace(/^apps\/admin\/src\//u, 'packages/platform-admin/src/'),
  ].filter(candidate => candidate !== relative);
  candidates.push(relative);
  for (const candidate of candidates) {
    for (const suffix of ['', '.ts', '.tsx', '/index.ts']) {
      const filename = path.resolve(root, candidate + suffix);
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) return filename;
    }
  }
  return path.resolve(root, relative);
}

function dependencyFile(name, filename) {
  if (name === "@/app/locale") return sourceFile("packages/platform-admin/src/app/locale.tsx");
  const root = path.resolve(__dirname, '..');
  if (name.startsWith('@/') && filename.replaceAll('\\', '/').includes('/packages/ui-arc/vendor/')) return sourceFile('packages/ui-arc/vendor/' + name.slice(2));
  if (name.startsWith('@/')) return sourceFile('apps/admin/src/' + name.slice(2));
  if (name.startsWith('.')) return sourceFile(path.relative(root, path.resolve(path.dirname(filename), name)));
  const packageName = /^@rental-os\/([^/]+)(.*)$/u.exec(name);
  if (!packageName) return undefined;
  const packageRoot = path.join(root, 'packages', packageName[1]);
  const metadata = path.join(packageRoot, 'package.json');
  if (!fs.existsSync(metadata)) return undefined;
  const entry = JSON.parse(fs.readFileSync(metadata, 'utf8')).exports?.[packageName[2] ? '.' + packageName[2] : '.'];
  const target = typeof entry === 'string' ? entry : entry?.require ?? entry?.default ?? entry?.import ?? entry?.types;
  if (typeof target !== 'string') return undefined;
  const source = target.replace(/^\.\/dist\//u, 'src/').replace(/\.d\.ts$|\.js$/u, '.ts');
  return sourceFile(path.relative(root, path.join(packageRoot, source)));
}

function load(file, dependencies = {}) {
  const root = path.resolve(__dirname, '..');
  const original = path.resolve(root, file);
  const filename = sourceFile(file);
  if (filename.endsWith('.css')) return { __esModule: true, default: {} };
  const source = fs.readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exported = { exports: {} };
  const aliases = { '@rental-os/platform-admin/ui': '@/components/ui', '@rental-os/platform-admin/locale': '@/app/locale' };
  // 复用订单列表用例的同源解析，迁移后的导入继续消费原 fixture。
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (Object.hasOwn(dependencies, aliases[name])) return dependencies[aliases[name]];
    const target = dependencyFile(name, filename);
    if (target) {
      const equivalent = Object.keys(dependencies).find(key => dependencyFile(key, original) === target);
      if (equivalent) return dependencies[equivalent];
      return load(path.relative(root, target), dependencies);
    }
    return require(name);
  }, exported, exported.exports);
  return exported.exports;
}

const workspaceHeaderContext = load('apps/admin/src/components/workspace/WorkspaceHeaderContext.ts', {});
const workspaceHeader = load('apps/admin/src/components/workspace/WorkspaceHeader.tsx', { './WorkspaceHeaderContext': workspaceHeaderContext });

test('refreshed header consumers share the retained provider and inactive parent scopes suppress nested actions', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const refreshed = load('apps/admin/src/components/workspace/WorkspaceHeader.tsx', { './WorkspaceHeaderContext': workspaceHeaderContext });
  const Consumer = () => React.createElement('span', null, refreshed.useWorkspaceHeader() ? 'connected' : 'missing');
  assert.equal(renderToStaticMarkup(React.createElement(workspaceHeader.WorkspaceHeaderProvider, null, React.createElement(Consumer))), '<span>connected</span>');
  for (const parentActive of [true, false]) {
    const markup = renderToStaticMarkup(React.createElement(workspaceHeader.WorkspaceHeaderScope, { active: parentActive },
      React.createElement(refreshed.WorkspaceHeaderScope, { active: true },
        React.createElement(refreshed.WorkspacePageActions, { label: 'current form' }, React.createElement('button', null, 'Save')))));
    assert.equal(markup.includes('hidden=""'), !parentActive);
    assert.equal(markup.includes('inert=""'), !parentActive, 'A hidden retained parent must not expose a nested active tab in the header.');
    assert.match(markup, /<button>Save<\/button>/u, 'Inactive actions keep their original React subtree.');
  }
  assert.equal(renderToStaticMarkup(React.createElement(workspaceHeader.WorkspacePageActions, null, false)), '');
});

test('page tools remain beside their content while only the primary action enters the shell', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const dependencies = {
    '@/components/ui/icons': { InfoCircleOutlined: () => null },
    './ui/Button': { Button: 'button' }, './ui/InfoPopover': { InfoPopover: 'span' },
    antd: { Space: 'div' }, '@/components/ui': { Button: 'button', InfoPopover: 'span' },
    'react-router-dom': { useLocation: () => ({ pathname: '/settings/example' }) },
    '@/app/navigation': { findRouteByPath: () => undefined },
    '@/app/branding': { resolveAdminBrandName: () => 'Example' },
    '@/app/locale': { useLocale: () => ({ t: text => text, locale: 'zh-CN' }) },
    '@/features/auth/authStore': { useAuthStore: selector => selector({}) },
    './ui/AnimatedIcon': { AnimatedIcon: () => null },
    '@/app/navigation-icons': { routeIconName: () => 'settings' },
    './workspace/WorkspaceHeader': { useWorkspaceHeader: () => ({}), WorkspacePageTitle: 'header-title', WorkspacePageActions: 'header-actions' },
  };
  const { PageHeading } = load('packages/platform-admin/src/components/PageHeading.tsx', dependencies);
  const { PageHeader } = load('apps/admin/src/components/PageHeader.tsx', { ...dependencies, '@rental-os/platform-admin/shell': { PageHeading } });
  const props = { title: '设置', extra: React.createElement('button', null, '保存'), navigation: React.createElement('button', null, '返回'), tools: React.createElement('button', null, '刷新') };
  const form = React.createElement('form', { id: 'current-draft' }, React.createElement('input', { name: 'draft', defaultValue: 'retain me' }));
  const markup = renderToStaticMarkup(React.createElement(PageHeader, { ...props, view: form }));
  assert.match(markup, /<header-actions[^>]*><button>保存<\/button><\/header-actions>/u);
  assert.doesNotMatch(markup.match(/<header-actions.*?<\/header-actions>/u)[0], /刷新/u);
  assert.match(markup, /page-context-tools[^]*<button>刷新<\/button>/u);
  assert.ok(markup.indexOf('page-context-navigation') < markup.indexOf('page-context-tools'), 'Return navigation precedes secondary tools in reading and keyboard order.');
  assert.match(markup, /<div class="page-toolbar-view"><form id="current-draft">/u,
    'A complete form keeps its own full-width row instead of sharing a flex row with refresh tools.');
  assert.equal(markup.match(/retain me/gu).length, 1, 'The draft is rendered once.');
  const query = renderToStaticMarkup(React.createElement(PageHeader, { ...props, toolsPlacement: 'view', view: React.createElement('input', { name: 'query' }) }));
  assert.match(query, /page-content-toolbar[^]*page-content-controls[^]*name="query"[^]*page-context-tools/u,
    'Only an explicitly declared query/view row shares horizontal space with page tools.');
  const empty = renderToStaticMarkup(React.createElement(PageHeader, { title: '只读页面' }));
  assert.doesNotMatch(empty, /page-header-compact|page-context-tools/u, 'A page without tools or context does not reserve an empty second row.');
});

test('sidebar rail changes retain inline submenu nodes, group choices and guarded navigation', () => {
  const sidebar = { state: 'expanded', isMobile: false };
  const state = [], navigated = [];
  let hook = 0;
  const names = ['SidebarGroup','SidebarGroupLabel','SidebarMenu','SidebarMenuItem','SidebarMenuButton','SidebarMenuSub','SidebarMenuSubItem','SidebarMenuSubButton'];
  const dropdownNames = ['DropdownMenu','DropdownMenuTrigger','DropdownMenuContent','DropdownMenuGroup','DropdownMenuLabel','DropdownMenuItem'];
  const { NativeNavigation } = load('apps/admin/src/components/animate-sidebar/NativeNavigation.tsx', {
    react: { ...React, useId: () => 'navigation', useEffect: () => {}, useState: initial => {
      const slot = hook++; if (!(slot in state)) state[slot] = initial;
      return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    } },
    '@/app/navigation-display': { MENU_GROUP_LABELS: {}, menuRouteLabel: (_, label) => label },
    '@/app/designTokens': load('apps/admin/src/app/designTokens.ts', { '@rental-os/shared': {} }),
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    'motion/react': { motion: { div: 'motion-panel' } },
    '@animate-ui/react/utils/motion': { useShouldReduceMotion: () => false, useTempoTransition: value => value },
    '@animate-ui/react/primitives/effects/highlight': { Highlight: 'Highlight', HighlightItem: 'HighlightItem' },
    '@hugeicons/react': { HugeiconsIcon: 'Icon' }, '@hugeicons/core-free-icons': { ArrowRight01Icon: [], Tick02Icon: [] },
    './runtime/sidebar': { ...Object.fromEntries(names.map(name => [name, name])), useSidebar: () => sidebar },
    './runtime/dropdown-menu': Object.fromEntries(dropdownNames.map(name => [name, name])),
    '../ui/AnimatedIcon': { AnimatedIcon: 'AnimatedIcon' },
  });
  const sections = [{ key: 'inventory', label: '器材', routes: [
    { path: '/rental/item-groups', label: '器材型号' }, { path: '/rental/assets', label: '器材库存' },
  ] }, { key: 'commercial', label: '定价', routes: [{ path: '/rental/pricing', label: '价格调价' }] }];
  const render = () => { hook = 0; return NativeNavigation({ sections, selectedKey: '/rental/item-groups', query: '', onNavigate: path => navigated.push(path) }); };
  const nodes = tree => {
    const result = [];
    const visit = (node, ancestry = []) => { if (!React.isValidElement(node)) return;
      const address = [...ancestry, [node.type, node.key]]; result.push({ node, address });
      React.Children.forEach(node.props.children, child => visit(child, address));
    }; visit(tree); return result;
  };
  const find = (tree, predicate) => nodes(tree).find(({ node }) => predicate(node));
  const panel = tree => find(tree, node => node.props.id === 'navigation-inventory').node;
  const inventory = tree => find(tree, node => node.type === 'DropdownMenu' && node.key === 'inventory').node;
  const trigger = tree => find(tree, node => node.type === 'DropdownMenuTrigger' && node.props['aria-label'] === '器材').node;
  const route = tree => find(tree, node => node.type === 'SidebarMenuSubButton' && node.props['data-route'] === '/rental/assets');
  const wide = render();
  assert.equal(panel(wide).props.animate.height, 'auto');
  assert.equal(trigger(wide).props['aria-expanded'], true);
  sidebar.state = 'collapsed';
  const rail = render();
  assert.deepEqual(route(rail).address, route(wide).address, 'The same keyed inline rows must survive the rail change, so their exit can finish.');
  assert.equal(panel(rail).props.animate.height, 0);
  assert.equal(panel(rail).props.inert, true, 'Exiting rows cannot remain keyboard or business-action targets.');
  assert.equal(rail.props.value, 'group:inventory');
  inventory(rail).props.onOpenChange(true, { cancel: () => assert.fail('Rail menu must be available.') });
  const opened = render(); assert.equal(inventory(opened).props.open, true);
  const popupRoute = find(opened, node => node.type === 'DropdownMenuItem' && node.props['data-route'] === '/rental/assets').node;
  popupRoute.props.onClick({ button: 0, ctrlKey: true, preventDefault: () => assert.fail('Modified links keep native browser navigation.') });
  assert.deepEqual(navigated, []);
  popupRoute.props.onClick({ button: 0, preventDefault() {} });
  assert.deepEqual(navigated, ['/rental/assets']); assert.equal(inventory(render()).props.open, false);
  sidebar.state = 'expanded';
  assert.equal(panel(render()).props.animate.height, 'auto', 'Opening the rail restores the same expanded group.');
  trigger(render()).props.onClick();
  assert.equal(panel(render()).props.animate.height, 0);
  sidebar.state = 'collapsed'; render(); sidebar.state = 'expanded';
  assert.equal(panel(render()).props.animate.height, 0, 'An explicitly closed group stays closed after another rail round trip.');
  let canceled = false;
  inventory(render()).props.onOpenChange(true, { cancel: () => { canceled = true; } });
  assert.equal(canceled, true, 'Wide-mode group clicks never open a duplicate popup.');
});

test('portaled saves retain native submit association and validate before a single guarded operation', async () => {
  const refs = [];
  let cursor = 0, formOwner = 'original-form', disabled = false;
  const events = [], drafts = { value: 'first' }, saved = [];
  let valid = false, finish;
  const snapshot = load('apps/admin/src/app/serverFormSnapshot.ts', {});
  const { SaveButton } = load('apps/admin/src/components/ui/ActionButton.tsx', {
    react: { ...React, useRef: initial => { const index = cursor++; return refs[index] ??= { current: initial }; } },
    antd: { ConfigProvider: { useConfig: () => ({ componentDisabled: disabled }) } },
    '@/registry/components/action-button/action-button': { ActionButton: 'arc-action' },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    '@/app/serverFormSnapshot': snapshot,
    './ActionButtonIcon': { ActionButtonIconContext: React.createContext('none'), ActionButtonCustomIconContext: React.createContext(undefined) },
    './actionButtonIntent': load('apps/admin/src/components/ui/actionButtonIntent.ts', {}),
    '../workspace/WorkspaceHeader': { useWorkspaceActionForm: () => formOwner },
  });
  const form = { getFieldsValue: () => ({ ...drafts }), validateFields: async () => { events.push('validate'); if (!valid) throw Error('required'); return { ...drafts }; } };
  const marked = [], unsubscribe = snapshot.subscribeFormSave(form, fingerprint => marked.push(fingerprint));
  const props = { label: '保存配置', form, onClickCapture: () => events.push('capture'), onSave: values => {
    saved.push(values); return new Promise(resolve => { finish = resolve; });
  } };
  const render = () => {
    cursor = 0;
    const button = SaveButton(props);
    let action = button.type(button.props);
    while (action.type !== 'arc-action') action = action.props.children;
    return action;
  };
  let action = render();
  assert.equal(action.props.form, 'original-form');
  assert.equal(action.props.type, 'submit');
  action.props.onClickCapture({ preventDefault: () => events.push('prevent') });
  assert.deepEqual(events, ['capture', 'prevent'], 'Implicit Enter click must suppress the duplicate native onFinish request.');
  await assert.rejects(action.props.onAction(), /required/u);
  assert.equal(saved.length, 0, 'Invalid fields never reach the mutation.');
  assert.deepEqual(marked, []);
  valid = true; action = render();
  const first = action.props.onAction(), duplicate = action.props.onAction();
  assert.equal(first, duplicate, 'Pending click and implicit Enter use the same in-flight operation.');
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(saved, [{ value: 'first' }]);
  drafts.value = 'later'; finish({ ok: true }); await first;
  assert.deepEqual(marked, ['{"value":"first"}'], 'Completion only marks the submitted draft saved; edits typed during the request stay dirty.');
  disabled = true; action = render();
  assert.equal(action.props.disabled, true, 'The original form disabled context survives portaling.');
  await assert.rejects(action.props.onAction(), /disabled/iu);
  assert.equal(saved.length, 1);
  formOwner = undefined; assert.equal(render().props.form, undefined, 'Inline and modal saves keep their original native form ancestor.');
  unsubscribe();
});

test('locale consumers keep their provider when the translation module is refreshed', () => {
  const context = load('apps/admin/src/app/localeContext.ts', {});
  const previous = load('apps/admin/src/app/locale.tsx', { './localeContext': context });
  const refreshed = load('apps/admin/src/app/locale.tsx', { './localeContext': context });
  const originalWindow = global.window;
  global.window = { localStorage: { getItem: () => 'en-US' } };
  try {
    const ExistingConsumer = () => React.createElement('span', null, previous.useLocale().t('无权访问'));
    const markup = require('react-dom/server').renderToStaticMarkup(React.createElement(refreshed.LocaleProvider, null, React.createElement(ExistingConsumer)));
    assert.match(markup, /Access denied/, 'A retained page must consume the refreshed provider without becoming blank.');
  } finally { if (originalWindow === undefined) delete global.window; else global.window = originalWindow; }
});

test('modal feedback remains available between retained providers and refreshed page consumers', () => {
  const context = load('apps/admin/src/components/ui/modalFeedbackContext.ts', {});
  const dependencies = {
    './modalFeedbackContext': context,
    './Modal': { Modal: 'modal' }, './ActionButton': { ActionButton: 'action' }, './Button': { Button: 'button' },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
  };
  const previous = load('apps/admin/src/components/ui/ModalProvider.tsx', dependencies);
  const refreshed = load('apps/admin/src/components/ui/ModalProvider.tsx', dependencies);
  const { renderToStaticMarkup } = require('react-dom/server');
  for (const [provider, consumer] of [[previous, refreshed], [refreshed, previous]]) {
    const CurrentPage = () => React.createElement('span', null, typeof consumer.useModalFeedback().confirm);
    assert.equal(renderToStaticMarkup(React.createElement(provider.ModalFeedbackProvider, null, React.createElement(CurrentPage))), '<span>function</span>');
  }
});

test('record screens discard local task snapshots at identity or related grant changes', () => {
  let identity = 'tenant-a:workspace-a:operator', grants = new Set(['rental-os:member:view', 'rental-os:member:review']);
  const boundary = (file, name, child) => {
    const source = ts.createSourceFile(file, fs.readFileSync(sourceFile(file), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name);
    const code = ts.transpileModule(declaration.getText(source), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    const session = select => select({ user: { tenantMembership: { grants: [...grants] } }, hasTenantMembershipPermission: permission => grants.has(permission) });
    new Function('exports', 'require', 'useListQueryIdentity', 'useAuthStore', 'useMembershipQueryIdentity', 'useRentalMembershipSession', 'RentalCatalogPageProvider', child, code)(exports, require,
      () => identity, session, () => identity, session, 'catalog-provider', child);
    return declaration.parameters[0]?.name.getText(source) === 'context' ? () => {
      const page = exports[name]({ scopeKey: identity });
      return page.type === 'catalog-provider' ? page.props.children : page;
    } : exports[name];
  };
  const Review = boundary('apps/admin/src/features/membership/MembershipReviewPage.tsx', 'MembershipReviewPage', 'MembershipReviewWorkspace');
  const Rewards = boundary('apps/admin/src/features/membership/MembershipRewardsPage.tsx', 'MembershipRewardsPage', 'MembershipRewardsWorkspace');
  const Personal = boundary('apps/admin/src/features/membership/PersonalMembershipPage.tsx', 'PersonalMembershipPage', 'PersonalMembershipWorkspace');
  const Corporate = boundary('apps/admin/src/features/membership/CorporateMembershipPage.tsx', 'CorporateMembershipPage', 'CorporateMembershipWorkspace');
  const Catalog = boundary('apps/admin/src/features/catalog/CatalogPage.tsx', 'CatalogPage', 'CatalogWorkspace');
  const Assets = boundary('apps/admin/src/features/catalog/AssetWorkspacePage.tsx', 'AssetWorkspacePage', 'AssetWorkspace');
  const Locations = boundary('apps/admin/src/features/fulfillment/LocationPage.tsx', 'LocationPage', 'LocationWorkspace');
  for (const Screen of [Review, Rewards, Personal, Corporate, Catalog, Assets, Locations]) {
    identity = 'tenant-a:workspace-a:operator';
    const original = Screen();
    assert.equal(Screen().key, original.key, 'Ordinary rerenders retain the form.');
    identity = 'tenant-a:workspace-b:operator';
    const otherWorkspace = Screen();
    assert.notEqual(otherWorkspace.key, original.key, 'A workspace change must not retain another scope’s draft.');
    identity = 'tenant-b:workspace-b:operator';
    assert.notEqual(Screen().key, otherWorkspace.key, 'Private snapshots cannot survive a tenant change.');
  }
  const allowed = Review().key;
  const personalAllowed = Personal().key;
  const corporateAllowed = Corporate().key;
  grants = new Set(['rental-os:member:view']);
  assert.notEqual(Review().key, allowed, 'Revoking review rights closes its old task even if the list identity stays stable.');
  assert.notEqual(Personal().key, personalAllowed, 'Personal profile drafts cannot survive a changed tenant membership grant.');
  assert.notEqual(Corporate().key, corporateAllowed, 'Company and employee drafts cannot survive a changed tenant membership grant.');
});

test('compact filter rows reserve actions and keep reset access in the overflow panel', () => {
  const { planListFilters } = load('apps/admin/src/components/ui/listFilterLayout.ts', {});
  const geometry = { available: 342, category: 0, categoryMin: 0, search: 280, searchMin: 200, searchCompactMin: 96,
    fieldWidths: [170, 160], preferFirst: false, actions: [60, 36], resets: [106], gap: 8, moreWidth: 64, collapsedCategory: false };
  const plan = planListFilters(geometry);
  assert.equal(plan.more, true, 'Secondary criteria and reset remain available from More filters.');
  assert.equal(plan.count, 0);
  assert.ok(plan.search >= geometry.searchCompactMin);
  assert.ok(plan.search + 60 + 36 + geometry.moreWidth + 3 * geometry.gap <= geometry.available,
    'The search, More trigger and both actions must fit one 342px row.');
  const wide = planListFilters({ ...geometry, available: 1200 });
  assert.equal(wide.more, false);
  assert.equal(wide.count, 2, 'A wide row exposes the criteria and reset without a needless overflow panel.');
});

test('opening another catalog record clears nested draft fields through the actual form store', context => {
  // rc-form schedules watch notifications through MessageChannel. Close this test's
  // native ports afterwards so its browser-style scheduler cannot retain Node.
  const NativeMessageChannel = global.MessageChannel;
  const channels = [];
  context.mock.method(global, 'MessageChannel', function () {
    const channel = new NativeMessageChannel();
    channels.push(channel);
    return channel;
  });
  context.after(() => channels.forEach(channel => { channel.port1.close(); channel.port2.close(); }));
  const { FormStore } = require('@rc-component/form/lib/hooks/useForm');
  const editor = (file, workspace, name, dependencies) => {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
    const owner = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === workspace);
    const fn = owner?.body?.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(fn, name);
    const code = ts.transpileModule(`export ${fn.getText(source)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports = {};
    new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
    return exports[name];
  };
  for (const kind of ['model', 'asset']) {
    const form = new FormStore(() => {}).getForm();
    form.getInternalHooks('RC_FORM_INTERNAL_HOOKS');
    let selected;
    const editingDriver = { dismiss: close => close(), markClean() {} };
    const common = {
      setEditorState: value => { selected = value.record; },
      editorGeneration: { current: 0 },
      editorUnavailable: false,
      allowed: () => true,
    };
    const open = kind === 'model' ? editor('packages/rental-core/admin/catalog/CatalogPage.tsx', 'CatalogWorkspace', 'openEditor', {
      ...common, form, busy: false, setPendingFiles() {},
      drawerOpen: false, catalogDismissal: { visible: true }, editor: editingDriver, presentation: undefined,
      category: { supportedInventoryModes: ['serialized'] }, RentalInventoryMode: { Serialized: 'serialized' }
    }) : editor('packages/rental-core/admin/catalog/AssetWorkspacePage.tsx', 'AssetWorkspace', 'openAssetEditor', {
      ...common, assetForm: form, saveAsset: { isPending: false },
      assetDrawerOpen: false, assetDismissal: { visible: true }, assetEditor: editingDriver,
      referencesAvailable: () => true,
      serializedGroups: [{ id: 'model-b' }], visibleLocations: [{ id: 'location-b' }], RentalAssetStatus: { Available: 'available' }
    });
    form.setFieldsValue({ id: 'first', attributes: { retainedInFirst: 'unsaved' }, description: 'old draft' });
    const next = { id: 'second', attributes: { suppliedBySecond: 'persisted' } };
    open(next);
    assert.equal(selected, next);
    assert.deepEqual(form.getFieldValue('attributes'), next.attributes, `${kind}: nested fields from another record cannot merge into this one.`);
    assert.equal(form.getFieldValue('description'), undefined, `${kind}: omitted fields do not retain the old draft.`);
    open();
    assert.equal(form.getFieldValue('id'), undefined, `${kind}: new records cannot inherit an existing identifier.`);
    assert.deepEqual(form.getFieldValue('attributes'), {}, `${kind}: new attributes start empty.`);
  }
  const form = new FormStore(() => {}).getForm();
  form.getInternalHooks('RC_FORM_INTERNAL_HOOKS');
  const openStock = editor('packages/rental-core/admin/catalog/StockOperationsPanel.tsx', 'StockOperationsPanel', 'openEditor', {
    form, canManage: true, unavailable: false, apply: { isPending: false }, allowed: () => true, open: false,
    referencesAvailable: undefined,
    stockDismissal: { visible: true }, editor: { dismiss: close => close(), markClean() {} },
    quantityGroups: [{ id: 'quantity-model' }], storageLocations: [{ id: 'storage' }],
    setOperationKey() {}, setOperationType() {}, setOpen() {},
  });
  form.setFieldsValue({ type: 'transfer', fromLocationId: 'old-source', toLocationId: 'old-target', actualOnHandQuantity: 15, batchNo: 'old-batch', idempotencyKey: 'old-operation' });
  openStock();
  assert.equal(form.getFieldValue('type'), 'receive');
  assert.equal(form.getFieldValue('quantity'), 1);
  for (const name of ['fromLocationId', 'toLocationId', 'actualOnHandQuantity', 'batchNo']) {
    assert.equal(form.getFieldValue(name), undefined, `New stock operations cannot retain ${name} from a cancelled draft.`);
  }
  assert.notEqual(form.getFieldValue('idempotencyKey'), 'old-operation');
  const adjustmentForm = new FormStore(() => {}).getForm();
  adjustmentForm.getInternalHooks('RC_FORM_INTERNAL_HOOKS');
  const rate = { itemGroupId: 'group-a', unit: 'calendar_day', baseAmount: 100 };
  let openedSource;
  const openAdjustment = editor('packages/rental-core/admin/commercial/RentalCommercialPage.tsx', 'RentalCommercialWorkspace', 'openAdjustment', {
    adjustmentForm, enabledPlans: [{}], adjustmentBusy: false, priceMatrixReady: true,
    adjustmentPlan: undefined, isCurrentScope: () => true, adjustmentDialog: { visible: true },
    generations: { current: { adjustment: 0 } }, adjustmentSubmission: { dismiss: close => close(), markClean() {} },
    currentPriceVersionDetail: { data: { version: 'v1', rates: [rate] } },
    setAdjustmentPreview() {}, setCreatedAdjustmentId() {}, setAdjustmentPlan() {},
    setAdjustmentSource: value => { openedSource = value; }, dayjs: require('dayjs'), t: text => text,
  });
  adjustmentForm.setFieldsValue({ scheduledAtValue: require('dayjs')('2030-01-01'), changeReason: 'cancelled draft' });
  openAdjustment();
  assert.equal(adjustmentForm.getFieldValue('scheduledAtValue'), undefined, 'A new price adjustment cannot inherit a cancelled schedule.');
  rate.baseAmount = 180;
  assert.equal(openedSource.rates[0].baseAmount, 100, 'Refreshing the price cache cannot relabel or reprice an open draft.');
});

test('catalog photos suppress the prior object URL before effects run for a new query identity', context => {
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const activeUrls = new Set();
  context.mock.method(URL, 'createObjectURL', data => {
    const url = createObjectURL(data);
    activeUrls.add(url);
    return url;
  });
  context.mock.method(URL, 'revokeObjectURL', url => {
    assert.ok(activeUrls.delete(url), 'Every generated object URL is released exactly once.');
    revokeObjectURL(url);
  });
  for (const presentation of [undefined, 'card']) {
    let scope = 'scope-a', data = new Blob(['original']), cursor = 0;
    let effect, cleanup, dependencies;
    let props = { groupId: 'group-a', image: { id: 'image-a', fileName: 'original.png' }, presentation };
    const state = [];
    const { ItemGroupPhoto } = load('packages/rental-core/admin/catalog/ItemGroupPhoto.tsx', {
      react: {
        ...React,
        useState: initial => {
          const slot = cursor++;
          if (!(slot in state)) state[slot] = initial;
          return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
        },
        useEffect: (next, values) => {
          if (!dependencies || values.some((value, index) => value !== dependencies[index])) {
            dependencies = values;
            effect = next;
          }
        },
      },
      '@tanstack/react-query': { useQuery: () => ({ data, isError: false }) },
      antd: { Image: 'photo' },
      './page-context': { useRentalCatalogPageContext: () => ({ api: {}, scopeKey: scope }) },
      '@rental-os/platform-admin/locale': { useLocale: () => ({ t: text => text }) },
      './ItemGroupPhoto.module.css': { default: {} },
    });
    const renderedUrl = () => {
      cursor = 0;
      const photo = ItemGroupPhoto(props);
      return presentation === 'card' ? photo.props.children.props.src : photo.props.src;
    };
    const flush = () => {
      if (!effect) return;
      if (cleanup) cleanup();
      cleanup = effect();
      effect = undefined;
    };
    try {
      assert.equal(renderedUrl(), undefined);
      flush();
      assert.equal(typeof renderedUrl(), 'string');
      scope = 'scope-b';
      data = undefined;
      assert.equal(renderedUrl(), undefined, 'The new scope cannot render the previous object URL before effect cleanup.');
      flush();
      data = new Blob(['current']);
      renderedUrl();
      flush();
      assert.equal(typeof renderedUrl(), 'string');
      data = new Blob(['updated']);
      assert.equal(renderedUrl(), undefined, 'The object URL must belong to the current query bytes.');
      flush();
      assert.equal(typeof renderedUrl(), 'string');
      props = { ...props, image: { ...props.image, id: 'image-b' } };
      assert.equal(renderedUrl(), undefined, 'Another image cannot reuse the previous URL.');
      flush();
      props = { ...props, groupId: 'group-b' };
      assert.equal(renderedUrl(), undefined, 'Another item group cannot reuse the previous URL.');
    } finally {
      if (cleanup) cleanup();
    }
    assert.equal(activeUrls.size, 0, 'Replacing and unmounting a photo releases all generated object URLs.');
  }
});

test('price adjustment submission keeps untouched prices out of a refreshed draft and cannot create it twice', async () => {
  const file = 'packages/rental-core/admin/commercial/RentalCommercialPage.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RentalCommercialWorkspace');
  const submit = owner.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'submitAdjustment');
  const rateKey = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'pricingRateKey'));
  const code = ts.transpileModule(`${rateKey.getText(source)}\nexport ${submit.getText(source)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const base = [{ itemGroupId: 'a', unit: 'calendar_day', baseAmount: 100 }, { itemGroupId: 'b', unit: 'calendar_day', baseAmount: 200 }];
  const submitted = [];
  const createSubmit = (extra = {}) => {
    const dependencies = { adjustmentBusy: false, createdAdjustmentId: undefined, adjustmentSource: { version: 'v1', rates: base }, priceMatrixReady: true,
      currentPriceVersionDetail: { data: { rates: base.map(rate => ({ ...rate, baseAmount: rate.baseAmount + 20 })) } },
      message: { warning() {} }, t: text => text, createAdjustment: { mutateAsync: async value => { submitted.push(value); return { id: 'draft-a' }; } }, ...extra };
    const exports = {};
    new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
    return exports.submitAdjustment;
  };
  const draft = { code: 'ADJ', name: 'Adjustment', changeReason: 'New rate', changes: base.map(rate => ({ itemGroupId: rate.itemGroupId, unit: rate.unit, op: 'set_base', value: rate.baseAmount })) };
  await assert.rejects(createSubmit()(draft), /价格没有变化/);
  assert.equal(submitted.length, 0, 'A refreshed query cannot turn an unchanged form into a price rollback.');
  const changed = { ...draft, changes: [draft.changes[0], { ...draft.changes[1], value: 250 }] };
  await createSubmit()(changed);
  assert.deepEqual(submitted[0].changes, [changed.changes[1]], 'Only the price the operator changed belongs in the plan.');
  await assert.rejects(createSubmit({ createdAdjustmentId: 'draft-a' })(changed), /当前操作不可用/);
  assert.equal(submitted.length, 1, 'A created draft must move to confirmation instead of creating another draft.');
});

test('live refresh is opt-in, pauses while editing, stops on denial and resets across identities', () => {
  let identity = { tenant: { tenantId: 't' }, currentWorkspaceId: 'w', user: { id: 'u' } };
  let state;
  const { useLiveRefresh, useListQueryIdentity } = load('apps/admin/src/components/ui/LiveRefresh.tsx', {
    react: { ...React, useState: initial => { state ??= initial; return [state, next => { state = typeof next === 'function' ? next(state) : next; }]; }, useEffect: effect => effect() },
    '@/features/auth/authStore': { useAuthStore: selector => selector(identity) },
    './BusinessUiScope': { useBusinessUiScope: () => ({ identity: useListQueryIdentity() }) },
    '@/app/locale': {}, './Switch': {}
  });
  let live = useLiveRefresh('orders');
  assert.equal(live.queryOptions.refetchInterval({ state: { error: null } }), false);
  live.setEnabled(true);
  live = useLiveRefresh('orders');
  assert.equal(live.queryOptions.refetchInterval({ state: { error: null } }), 10000);
  assert.equal(live.queryOptions.refetchIntervalInBackground, false);
  assert.equal(live.queryOptions.refetchInterval({ state: { error: { response: { status: 403 } } } }), false);
  assert.equal(useLiveRefresh('orders', true).queryOptions.refetchInterval({ state: { error: null } }), false);
  identity = { ...identity, currentWorkspaceId: 'other' };
  assert.equal(useLiveRefresh('orders').enabled, false);
  identity = { ...identity, currentWorkspaceId: 'w' };
  assert.equal(useLiveRefresh('orders').enabled, false, 'returning to the prior workspace must not reactivate its old live switch');
});

test('list identity ignores permission ordering but retains access and organization boundaries', () => {
  const permissions = ['catalog:view', 'assets:view'];
  let identity = { tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'workspace', user: {
    id: 'operator', permissions, dataScope: 'self_org', organizationId: 'org-a', locationScope: { mode: 'selected', locationIds: ['one'] }
  } };
  const { useListQueryIdentity } = load('apps/admin/src/components/ui/LiveRefresh.tsx', {
    '@rental-os/platform-admin/source/components/ui/LiveRefresh': {},
    react: {}, '@/features/auth/authStore': { useAuthStore: selector => selector(identity) }, '@/app/locale': {}, './Switch': {}
  });
  const original = useListQueryIdentity();
  identity = { ...identity, user: { ...identity.user, permissions: ['assets:view', 'catalog:view', 'catalog:view'] } };
  assert.equal(useListQueryIdentity(), original, 'An equivalent permission receipt must not discard a draft.');
  assert.deepEqual(permissions, ['catalog:view', 'assets:view'], 'Key generation cannot reorder the authorization store.');
  identity = { ...identity, user: { ...identity.user, permissions: ['catalog:view'] } };
  assert.notEqual(useListQueryIdentity(), original, 'Revoking a permission still changes the scope.');
  identity = { ...identity, user: { ...identity.user, permissions, organizationId: 'org-b' } };
  assert.notEqual(useListQueryIdentity(), original, 'Moving the same operator to another organization changes their data range.');
  identity = { ...identity, user: { ...identity.user, organizationId: 'org-a', locationScope: { mode: 'selected', locationIds: ['two'] } } };
  assert.notEqual(useListQueryIdentity(), original, 'A changed location grant invalidates the prior view.');
});

test('a list keeps its ready content during loading but hides it after authorization errors or a changed scope', () => {
  const refs = [];
  let cursor = 0;
  const { QueryState } = load('apps/admin/src/components/QueryState.tsx', {
    react: { useState: () => [true, () => {}], useEffect: () => {}, useRef: value => { const index = cursor++; refs[index] ??= { current: value }; return refs[index]; } },
    '@/components/ui': { ActionButton: 'retry', Alert: 'alert', EmptyScene: 'empty' },
    '@/app/queryClient': { isTransientRefreshError: error => error?.response?.status >= 500 },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    './LoadingState': { LoadingState: 'loading' },
    './ui/data-table/TableRefreshContext': { useTableRefresh: () => ({}) },
    './workspace/ContentTransition': { ContentTransition: 'transition' }
  });
  const content = React.createElement('list', { 'data-test': 'content' });
  const render = props => { cursor = 0; return QueryState({ children: content, transitionKey: 'tenant-a', ...props }); };
  assert.equal(render({ loading: true }).props['value'], 'tenant-a:loading');
  assert.equal(render({ loading: false }).props['value'], 'tenant-a:ready');
  const update = render({ loading: true });
  assert.equal(update.props['value'], 'tenant-a:ready');
  assert.equal(update.props.children.props.children[1], content);
  const denied = render({ loading: false, error: { response: { status: 403 } } });
  assert.equal(denied.props['value'], 'tenant-a:error');
  assert.equal(denied.props.children.type, 'alert');
  assert.equal(render({ loading: true, transitionKey: 'tenant-b' }).props['value'], 'tenant-b:loading');
});

test('subscription detail retains its editor through temporary refresh failures and hides it after denial or a record change', () => {
  const refs = [];
  let cursor = 0;
  const { QueryState } = load('apps/admin/src/components/QueryState.tsx', {
    react: { useState: () => [true, () => {}], useEffect() {}, useRef: value => { const index = cursor++; refs[index] ??= { current: value }; return refs[index]; } },
    '@/components/ui': { ActionButton: 'retry', Alert: 'alert', EmptyScene: 'empty' },
    '@/app/queryClient': { isTransientRefreshError: error => error?.response?.status >= 500 },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    './LoadingState': { LoadingState: 'loading' },
    './ui/data-table/TableRefreshContext': { useTableRefresh: () => ({}) },
    './workspace/ContentTransition': { ContentTransition: 'transition' }
  });
  let recordId = 'tenant-a';
  const data = { overview: { revision: 1 }, entitlements: [], requests: [], changeLog: [] };
  let query = { isLoading: true, isFetching: true, refetch() {} };
  const { PlatformSubscriptionDetailPage } = load('apps/admin/src/features/subscription/PlatformSubscriptionDetailPage.tsx', {
    antd: { Space: 'space', Tag: 'tag' },
    '@/components/ui': new Proxy({}, { get: (_, key) => String(key) }),
    '../../components/RecordFacts': { RecordFacts: 'facts' },
    './SubscriptionPageHeader': { PageHeader: 'page' },
    './client': { useSubscriptionApi: () => ({}) },
    './subscriptionRoutes': { SUBSCRIPTION_ROUTES: { platformSubscriptions: { path: '/platform/subscriptions' } } },
    '@/components/ui/useModalDismissal': {},
    './TenantSubscription.module.css': { default: {} },
    '@tanstack/react-query': { useQuery: () => query },
    'react-router-dom': { useNavigate: () => () => {}, useParams: () => ({ id: recordId }) },
    '@rental-os/shared': { FeatureEntitlementSource: { StandardPublic: 'public', TenantGrant: 'grant', Pro: 'pro' } },
    '@/components/PageHeader': { PageHeader: 'page' }, '@/components/QueryState': { QueryState },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    '@/app/navigation': { APP_ROUTES: { platformSubscriptions: { path: '/platform/subscriptions' } } },
    '@/api/subscription': { subscriptionApi: {} }, './subscriptionLabels': {},
    './PlatformSubscriptionActionForm': {}, './TenantFeatureGrantModal': {}, './SubscriptionRequestDetails': {}, './subscriptionOperations': {}
  });
  const render = () => { cursor = 0; return QueryState(PlatformSubscriptionDetailPage().props.view.props); };
  const editor = node => {
    if (!React.isValidElement(node)) return undefined;
    if (node.props.tenantId) return node;
    return React.Children.toArray(node.props.children).map(editor).find(Boolean);
  };
  assert.equal(render().props.value, 'tenant-a:loading');
  query = { ...query, isLoading: false, isFetching: false, data };
  const ready = editor(render());
  assert.ok(ready, 'The actual page must render its editor after a successful read.');
  query = { ...query, isFetching: true, error: { response: { status: 503 } } };
  const retained = editor(render());
  assert.ok(retained, 'A temporary refresh failure must not replace the editor with an error-only subtree.');
  assert.equal(retained.type, ready.type);
  assert.equal(retained.key, ready.key, 'React retains the same record and its unsaved form state.');
  assert.equal(retained.props.data, data, 'Retained facts must be the original successful response.');
  query = { ...query, error: { response: { status: 403 } } };
  assert.equal(editor(render()), undefined, 'Denied reads cannot keep protected content visible.');
  recordId = 'tenant-b';
  query = { isLoading: true, isFetching: true, refetch() {} };
  assert.equal(render().props.value, 'tenant-b:loading');
  assert.equal(editor(render()), undefined, 'Changing the record cannot reuse another tenant editor.');
});

test('clear-all handles a separate facet even when the shared keyword and status are empty', () => {
  const { listFilterElements } = load('apps/admin/src/components/ui/ListFilters.tsx', {
    '@/app/locale': {}, './SearchField': { SearchField: 'search' }, './Select': { Select: 'select' }, './Button': { Button: 'button' }
  });
  let facet = 'frozen';
  const filter = { keyword: '', status: '', setKeyword() {}, setStatus() {}, clear() { throw new Error('The combined clear callback must own all criteria'); } };
  const controls = listFilterElements({ filter, placeholder: 'Search', hasFilters: true, onClear: () => { facet = 'all'; } }, text => text);
  controls.at(-1).props.onClick();
  assert.equal(facet, 'all');
  assert.equal(listFilterElements({ filter, placeholder: 'Search', hasFilters: false }, text => text).at(-1), null);
});

test('persistent settings tabs retain hidden form controls through the real UIArc panel contract', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const nativeTabs = load('packages/ui-arc/vendor/registry/components/tabs/tabs.tsx', {
    '@/lib/motion-tokens': load('packages/ui-arc/vendor/registry/motion-tokens.ts', {}),
    './tabs.module.css': { default: {} },
  });
  const { Tabs } = load('apps/admin/src/components/ui/Tabs.tsx', {
    antd: { Tabs: () => { throw Error('Unexpected fallback'); } },
    '@/registry/components/tabs/tabs': nativeTabs,
    '@/components/workspace/ContentTransition': { ContentTransition: ({ children }) => children },
    '@/components/workspace/WorkspaceHeader': workspaceHeader,
    '@/app/locale': { useLocale: () => ({ locale: 'en-US', t: text => text }) },
  });
  const render = (activeKey, forceRender, destroyOnHidden = false) => renderToStaticMarkup(React.createElement(Tabs, {
    activeKey, destroyOnHidden,
    items: ['connection', 'budget'].map(key => ({ key, label: key, forceRender,
      children: React.createElement('input', { name: key, defaultValue: `${key}-draft` }) })),
  }));
  for (const activeKey of ['connection', 'budget']) {
    const panels = render(activeKey, true).match(/<div\b[^>]*role="tabpanel"[^>]*>[\s\S]*?<\/div>/gu) ?? [];
    assert.equal(panels.length, 2, 'Both stateful form trees must remain mounted.');
    assert.equal(panels.filter(panel => /hidden=""/u.test(panel)).length, 1, 'The inactive form must stay hidden and out of keyboard navigation.');
    assert.ok(panels.some(panel => panel.includes(`value="${activeKey}-draft"`) && !/hidden=""/u.test(panel)));
    const inactive = activeKey === 'connection' ? 'budget' : 'connection';
    assert.ok(!render(activeKey, false).includes(`name="${inactive}"`), 'Ordinary tabs keep their original lazy presence behavior.');
    assert.ok(!render(activeKey, true, true).includes(`name="${inactive}"`), 'Explicit destruction still takes precedence.');
  }
});

test('lazy settings panels stay hidden after visiting and release their content when removed', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const nativeTabs = load('packages/ui-arc/vendor/registry/components/tabs/tabs.tsx', {
    '@/lib/motion-tokens': load('packages/ui-arc/vendor/registry/motion-tokens.ts', {}),
    './tabs.module.css': { default: {} },
  });
  const states = [];
  let cursor = 0;
  const { Tabs } = load('apps/admin/src/components/ui/Tabs.tsx', {
    react: { useEffect() {}, useLayoutEffect() {}, useId: () => 'settings-tabs', useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    } },
    antd: { Tabs: () => { throw Error('Unexpected fallback'); } },
    '@/registry/components/tabs/tabs': nativeTabs,
    '@/components/workspace/ContentTransition': { ContentTransition: ({ children }) => children },
    '@/components/workspace/WorkspaceHeader': workspaceHeader,
    '@/app/locale': { useLocale: () => ({ locale: 'en-US', t: text => text }) },
  });
  const items = ['common', 'website', 'wechat'].map(key => ({ key, label: key, children: React.createElement('input', { name: key, defaultValue: `${key}-draft` }) }));
  const render = (extra = {}) => { cursor = 0; return Tabs({ items, destroyOnHidden: false, ...extra }); };
  let tree = render();
  const initial = renderToStaticMarkup(tree);
  assert.ok(initial.includes('name="common"'));
  assert.ok(!initial.includes('name="website"') && !initial.includes('name="wechat"'), 'Unvisited forms must not mount or start their reads.');
  tree.props.onValueChange('website');
  tree = render();
  const after = renderToStaticMarkup(tree);
  assert.match(after, /data-state="inactive"[^>]*hidden=""[^>]*><input name="common"/u, 'Leaving a settings tab keeps its original form tree under a hidden native panel.');
  assert.ok(after.includes('name="website"') && !after.includes('name="wechat"'));
  tree.props.onValueChange('common');
  assert.match(renderToStaticMarkup(render()), /data-state="inactive"[^>]*hidden=""[^>]*><input name="website"/u);
  assert.ok(!renderToStaticMarkup(render({ items: items.filter(item => item.key !== 'website') })).includes('name="website"'), 'A removed or revoked view cannot retain its protected subtree.');
  assert.ok(!renderToStaticMarkup(render({ destroyOnHidden: true })).includes('name="website"'), 'Explicit destruction still takes priority.');
});

test('restored message center preserves shared inbox state, original folders, undo, filters and keyboard actions', async () => {
  const vm = require('node:vm'), root = path.resolve(__dirname, '..');
  const fixtureAst = ts.createSourceFile('fixture.cjs', fs.readFileSync(path.join(root, 'tests/enterprise-consumers.test.cjs'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fixture = fixtureAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reactHost');
  assert.ok(fixture);
  const hooks = () => new Function('assert', fixture.getText(fixtureAst) + ';return reactHost();')(assert);
  const pageHooks = hooks(), listHooks = hooks(), updates = [], restores = [];
  const stub = name => props => React.createElement(name, props);
  const icons = Object.fromEntries(['Bell', 'ClipboardCheck', 'ClipboardList', 'Sparkles', 'Wrench', 'Archive', 'Clock3', 'RotateCcw', 'Undo2'].map(name => [name, stub(name)]));
  const compile = (relative, imports, globals = {}) => {
    const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    vm.runInNewContext(code, { exports, ...globals, require(name) { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
    return exports;
  };
  const notificationLocale = { useNotificationText: () => value => value };
  const originalEntry = { read: false, folder: 'Inbox', events: ['original'], updatedAt: 1 };
  const inbox = { personal: { one: originalEntry }, storageAvailable: true, loading: false, error: false,
    messages: [
      { id: 'one', title: 'Original order', description: 'Original detail', createdAt: '2026-11-01', category: 'business', orderNo: 'ORDER-1', folder: 'Inbox', read: false, pending: true },
      { id: 'two', title: 'Read message', description: 'Second detail', createdAt: '2026-11-01', category: 'system', folder: 'Inbox', read: true, pending: false },
    ],
    update(id, patch) { updates.push({ id, patch });
      inbox.messages = inbox.messages.map(row => row.id === id ? { ...row, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) } : row); },
    restore(id, entry) { restores.push({ id, entry }); inbox.messages = inbox.messages.map(row => row.id === id ? { ...row, folder: entry?.folder ?? 'Inbox', read: entry?.read ?? false } : row); },
  };
  const NoticeActions = stub('original-business-actions'), document = { title: '' };
  const InboxTriage = compile('packages/rental-core/admin/browser-notifications/archive/inbox-triage/InboxTriage.tsx', {
    react: { ...listHooks.runtime, useId: () => 'original-inbox' }, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': icons,
    '@rental-os/platform-admin/source/lib/usePrefersReducedMotion': { usePrefersReducedMotion: () => true },
    '@rental-os/platform-admin/notifications': notificationLocale, '../shared/MeasuredHeight': { MeasuredHeight: stub('measured-height') },
    './original.css': {}, './integration.css': {},
  }, { setTimeout, clearTimeout, requestAnimationFrame: callback => { callback(); return 1; } }).InboxTriage;
  let providerReads = 0;
  const { createRentalMessageCenterPage } = compile('packages/rental-core/admin/browser-notifications/MessageCenterPage.tsx', {
    react: pageHooks.runtime, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': icons,
    '@rental-os/platform-admin/locale': { useLocale: () => ({ locale: 'en-US' }) },
    '@rental-os/platform-admin/shell': { resolveAdminBrandName: () => 'Original brand' },
    '@rental-os/platform-admin/ui': { EmptyScene: stub('empty') }, './archive/inbox-triage/InboxTriage': { InboxTriage },
    '@rental-os/platform-admin/notifications': notificationLocale,
    '@rental-os/platform-admin/source/features/notifications/HeaderNotifications': { formatNoticeTime: (at, locale) => at + ':' + locale },
    '@rental-os/platform-admin/source/features/notifications/notifications.css': {},
  }, { document });
  const Page = createRentalMessageCenterPage({ session: { useAuthStore: () => ({ tenant: {}, user: {} }) } }, () => { providerReads++; return inbox; }, NoticeActions);
  pageHooks.mount(Page); assert.equal(document.title, 'Message center · Original brand'); assert.equal(providerReads, 1);
  let props = pageHooks.value.props.children.props;
  assert.equal(props.messages[0].sender, 'ORDER-1'); assert.equal(props.messages[0].restoreData, originalEntry);
  assert.equal(props.renderDetails(props.messages[0]).type, NoticeActions); assert.equal(props.renderDetails(props.messages[0]).props.surface, 'inbox');
  listHooks.mount(() => InboxTriage(props));
  const nodes = predicate => { const found = []; const walk = tree => React.Children.forEach(tree, node => {
    if (!React.isValidElement(node)) return; if (predicate(node)) found.push(node); walk(node.props.children);
  }); walk(listHooks.value); return found; };
  const text = tree => React.Children.toArray(tree).map(node => React.isValidElement(node) ? text(node.props.children) : String(node ?? '')).join('');
  const button = label => { const found = nodes(node => node.type === 'button' && text(node.props.children).startsWith(label)); assert.ok(found.length, label); return found[0]; };
  const refresh = () => { pageHooks.rerender(); props = pageHooks.value.props.children.props; listHooks.rerender(); };
  assert.deepEqual(nodes(node => node.props.role === 'tab').map(node => text(node.props.children).replace(/\d+$/, '')), ['Inbox', 'Snoozed', 'Archive']);
  let first = nodes(node => node.props['aria-keyshortcuts'])[0]; first.props.onClick(); refresh();
  assert.equal(inbox.messages[0].read, true); assert.equal(nodes(node => node.props['aria-keyshortcuts'])[0].props['aria-expanded'], true);
  let prevented = 0;
  nodes(node => node.props['aria-keyshortcuts'])[0].props.onKeyDown({ key: 'e', preventDefault() { prevented++; } }); refresh();
  assert.equal(prevented, 1); assert.equal(inbox.messages[0].folder, 'Archive');
  button('Undo').props.onClick(); refresh(); assert.equal(restores.length, 1); assert.equal(restores[0].entry, originalEntry);
  assert.equal(inbox.messages[0].folder, 'Inbox'); assert.equal(inbox.messages[0].read, false);
  button('Pending').props.onClick(); await listHooks.settle(); assert.equal(nodes(node => node.props['aria-keyshortcuts']).length, 1);
  button('Unread only').props.onClick(); await listHooks.settle(); assert.equal(nodes(node => node.props['aria-keyshortcuts']).length, 1);
  first = nodes(node => node.props['aria-keyshortcuts'])[0]; first.props.onKeyDown({ key: 's', preventDefault() {} }); refresh();
  assert.equal(inbox.messages[0].folder, 'Snoozed');
  button('Snoozed').props.onClick(); await listHooks.settle();
  nodes(node => node.props['aria-keyshortcuts'])[0].props.onKeyDown({ key: 'u', preventDefault() {} }); refresh();
  assert.equal(inbox.messages[0].folder, 'Inbox'); assert.equal(updates.length, 4);
  pageHooks.unmount(); listHooks.unmount();
});
