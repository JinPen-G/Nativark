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
