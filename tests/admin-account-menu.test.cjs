const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const jsx = (type, props) => ({ type, props });
function load(file, dependencies) {
  const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const calls = [];
let allowed = false;
const route = path => ({ path });
const state = { user: { displayName: 'Operator', account: 'operator' }, tenant: {}, logout: () => calls.push('logout') };
const { AccountMenu } = load('apps/admin/src/components/AccountMenu.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'lucide-react': new Proxy({}, { get: (_, name) => name }),
  'react-router-dom': { useNavigate: () => path => calls.push(path) },
  '@/app/locale': { useLocale: () => ({ locale: 'zh-CN', t: value => value, setLocale: value => calls.push(value) }) },
  '@/app/theme': { useAppearance: () => ({ preference: 'system', setMode: value => calls.push(value) }) },
  '@/app/navigation': { APP_ROUTES: { appearance: route('/settings/appearance'), subscription: route('/settings/subscription') }, canAccessRoute: () => allowed },
  '@/features/auth/authStore': { useAuthStore: selector => selector(state) },
  '@/components/ui': { UserMenu: 'UserMenu', useFeedback: () => ({ toast: value => calls.push(value.title) }) },
});
const menu = AccountMenu({ collapsed: true }).props;
assert.equal(menu.showName, false);
assert.equal(menu.showTheme, false, 'Preferences are native custom groups, not duplicate theme controls');
assert.deepEqual(menu.items.map(item => item.label), ['个人资料', '设置', '账单']);
assert.deepEqual(menu.preferenceGroups.map(group => group.label), ['主题', '语言']);
assert.deepEqual(menu.preferenceGroups[0].options.map(option => option.value), ['light', 'dark', 'system']);
menu.preferenceGroups[0].onChange('system');
menu.preferenceGroups[1].onChange('en-US');
assert.deepEqual(calls.splice(0), ['system', 'en-US']);
menu.items[0].onSelect();
menu.items[1].onSelect();
menu.items[2].onSelect();
assert.deepEqual(calls.splice(0), ['个人资料尚未接入', '此账号暂不可访问设置', '此账号暂不可访问账单']);
allowed = true;
menu.items[1].onSelect();
menu.items[2].onSelect();
menu.onSignOut();
assert.deepEqual(calls.splice(0), ['/settings/appearance', '/settings/subscription', 'logout', '/login']);
const upstream = read('packages/ui-arc/vendor/registry/components/user-menu/user-menu.tsx');
const adapter = read('apps/admin/src/components/ui/UserMenu.tsx');
for (const [start, end] of [
  ['const panelMotion:', '/** A presence mark'],
  ['function Segmented<', 'const getStops'],
  ['  function onKeyDown(', '  function onTriggerClick('],
]) {
  const section = text => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
  assert.equal(section(adapter), section(upstream), 'Keep upstream springs, thumb and keyboard interactions');
}
assert.match(adapter, /@\/registry\/components\/user-menu\/user-menu\.module\.css/);
const bridge = read('apps/admin/src/components/ui/arc-bridge.css');
assert.match(bridge, /\.sider-account > span \{[^}]*justify-content: flex-start;/);
assert.match(bridge, /\.sider-account \.rental-account-trigger \{[^}]*width: 100%;[^}]*justify-content: flex-start;/);
assert.match(bridge, /\.sider-account \[data-rental-user-name\] \{[^}]*flex: 1;[^}]*text-align: start;/);
assert.match(bridge, /\.is-collapsed \.sider-account \.rental-account-trigger \{ justify-content: center;/);
assert.match(adapter, /className=\{styles.triggerName\} data-rental-user-name=""/);
const shell = read('apps/admin/src/components/AppShell.tsx');
assert.match(shell, /<AccountMenu collapsed=/);
assert.doesNotMatch(shell, /<AppearanceSwitcher|<LanguageSwitcher/);
console.log('admin-account-menu: native motion/segment contracts, preference order, visible entries, permission guards and real logout passed (no browser verification)');
