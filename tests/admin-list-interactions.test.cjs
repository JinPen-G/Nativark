const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exported = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), exported, exported.exports);
  return exported.exports;
}

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

test('membership screens discard local task snapshots at identity or review-grant changes', () => {
  let identity = 'tenant-a:workspace-a:operator', grants = new Set(['rental-os:member:view', 'rental-os:member:review']);
  const boundary = (file, name, child) => {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, name);
    const code = ts.transpileModule(declaration.getText(source), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function('exports', 'require', 'useListQueryIdentity', 'useAuthStore', child, code)(exports, require,
      () => identity, select => select({ user: { tenantMembership: { grants: [...grants] } }, hasTenantMembershipPermission: permission => grants.has(permission) }), child);
    return exports[name];
  };
  const Review = boundary('apps/admin/src/features/membership/MembershipReviewPage.tsx', 'MembershipReviewPage', 'MembershipReviewWorkspace');
  const Rewards = boundary('apps/admin/src/features/membership/MembershipRewardsPage.tsx', 'MembershipRewardsPage', 'MembershipRewardsWorkspace');
  const Personal = boundary('apps/admin/src/features/membership/PersonalMembershipPage.tsx', 'PersonalMembershipPage', 'PersonalMembershipWorkspace');
  for (const Screen of [Review, Rewards, Personal]) {
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
  grants = new Set(['rental-os:member:view']);
  assert.notEqual(Review().key, allowed, 'Revoking review rights closes its old task even if the list identity stays stable.');
  assert.notEqual(Personal().key, personalAllowed, 'Personal profile drafts cannot survive a changed tenant membership grant.');
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

test('live refresh is opt-in, pauses while editing, stops on denial and resets across identities', () => {
  let identity = { tenant: { tenantId: 't' }, currentWorkspaceId: 'w', user: { id: 'u' } };
  let state;
  const { useLiveRefresh } = load('apps/admin/src/components/ui/LiveRefresh.tsx', {
    react: { useState: initial => { state ??= initial; return [state, next => { state = typeof next === 'function' ? next(state) : next; }]; }, useEffect: effect => effect() },
    '@/features/auth/authStore': { useAuthStore: selector => selector(identity) },
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
