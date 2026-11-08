const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const form = read('apps/admin/src/components/ui/Form.tsx');
const input = read('apps/admin/src/components/ui/Input.tsx');
const search = read('apps/admin/src/components/ui/SearchField.tsx');
const select = read('apps/admin/src/components/ui/Select.tsx');
const css = read('apps/admin/src/components/ui/arc-bridge.css');
const designTokens = read('apps/admin/src/app/designTokens.ts');
const theme = read('apps/admin/src/app/theme.tsx');
const foundation = read('packages/ui-arc/vendor/registry/foundation.css');
const orders = read('apps/admin/src/features/rental-core/RentalOrdersPage.tsx');

assert.match(form, /export const Form = Object\.assign/);
assert.match(form, /List: AntForm\.List/);
assert.match(form, /ErrorList: AntForm\.ErrorList/);
assert.match(form, /useForm: AntForm\.useForm/);
assert.match(form, /NativeFieldFeedbackContext/);
assert.match(form, /export function FormSection/);
assert.match(form, /useContext\(FormItemInputContext\)/);
assert.match(form, /errors = \[\], warnings = \[\]/);
assert.match(input, /useFormFeedback\(\)/);
assert.match(select, /useFormFeedback\(\)/);
assert.match(input, /arc-native-feedback/);
assert.match(search, /registry\/components\/search-field\/search-field/);
assert.match(search, /onSearch\?\.\(currentValue\)/);
assert.match(select, /registry\/components\/select\/select/);
assert.match(select, /if \(unsupported\) return <AntSelect/);
assert.match(select, /sourceOptions\.length === 0/);
// All field families share one token boundary, including portaled panels.
const radiusCss = read('apps/admin/src/components/ui/input-radius.css');
const postcss = require('postcss');
const rules = postcss.parse(radiusCss);
const family = rules.nodes.find(node => node.type === 'rule' && node.selector.includes('.arc-search-field') && node.selector.includes('.arc-form-field'));
for (const name of ['arc-form-field', 'arc-search-field', 'arc-select-field', 'arc-date-field', 'arc-date-range', 'arc-time-fields', 'arc-color-field', 'arc-rich-field', 'arc-otp-field']) assert.ok(family.selector.includes('.' + name), name);
for (const property of ['--radius-control', '--radius-panel']) assert.equal(family.nodes.find(node => node.prop === property).value, 'var(--radius-field)');
assert.match(radiusCss, /--radius-field: var\(--rental-ui-radius-input, 18px\)/);
assert.match(radiusCss, /data-radix-select-viewport/);
assert.match(radiusCss, /\.arc-phone-field \[data-open\] \[class\*="shape"\]/);
assert.match(radiusCss, /\.arc-date-range \[class\*="surface"\]/);
assert.match(radiusCss, /\[data-rental-arc-button\] \{ --radius-control: var\(--rental-ui-radius-button\); \}/);
assert.match(radiusCss, /\.ant-select-selection-item \{ border-radius: var\(--rental-ui-radius-input-sm\)/);
rules.walkDecls(decl => {
  assert.ok(!/^(?:min-|max-)?height$|^animation|^transition/.test(decl.prop), 'radius boundary cannot change sizing/motion');
  if (/^border.*radius$/.test(decl.prop)) assert.ok(decl.value === '0' || /^var\(--(?:radius-field|rental-ui-radius-input-sm)\)$/.test(decl.value), 'no per-field hardcoded radius: ' + decl.toString());
});
assert.doesNotMatch(css, /--radius-control: var\(--rental-ui-radius-input|\.arc-form-field input[^}]*border-radius|\.arc-password-field \[class\*="shell"\]/, 'field radius rules must not remain scattered in the old bridge');
assert.match(read('apps/admin/src/main.tsx'), /import "\.\/components\/ui\/input-radius\.css"/);
// Idle borders share the date/select edge without changing upstream state rules.
const inputColorsCss = read('apps/admin/src/components/ui/input-colors.css');
const inputColorRules = postcss.parse(inputColorsCss);
const idleBorderRule = inputColorRules.nodes.find(node => node.type === 'rule');
assert.ok(idleBorderRule.selector.includes('.arc-search-field'));
assert.ok(idleBorderRule.selector.includes('.arc-form-field'));
assert.ok(idleBorderRule.selector.includes('input.arc-input-control'));
assert.ok(idleBorderRule.selector.includes(':is(input, textarea)'));
assert.ok(idleBorderRule.selector.includes(':where(:not(:focus-within))'));
assert.ok(idleBorderRule.selector.includes(':where(:not(:focus, :disabled, [aria-invalid="true"]))'));
assert.ok(idleBorderRule.selector.includes(':has(input:disabled, input[aria-invalid="true"])'));
assert.ok(idleBorderRule.selector.includes(':not(.arc-password-field, .arc-password-strength, .arc-phone-field)'));
inputColorRules.walkDecls(decl => {
  assert.equal(decl.prop, 'border-color', 'do not change radii, dimensions, motion, background or the global border-strong role');
  assert.equal(decl.value, 'var(--rental-color-input-border-default)');
  assert.equal(Boolean(decl.important), false, 'original interaction states must retain cascade precedence');
});
for (const component of ['input', 'textarea', 'search-field']) {
  const sourceCss = read(`packages/ui-arc/vendor/registry/components/${component}/${component}.module.css`);
  assert.match(sourceCss, /:(?:focus-visible|focus-within) \{ border-color: var\(--foreground\)/);
  assert.match(sourceCss, /:hover:not\([^}]+border-color: var\(--foreground\)/, 'source hover has higher specificity than the idle-only host rule');
}
assert.match(read('apps/admin/src/main.tsx'), /input-radius\.css";\s*import "\.\/components\/ui\/input-colors\.css"/);
const authPreview = read('apps/admin/src/features/auth/AuthCodePreview.tsx');
assert.match(authPreview, /<OtpInput className="arc-otp-field"/);
assert.equal((authPreview.match(/<ArcInput className="arc-input-control"/g) ?? []).length, (authPreview.match(/<ArcInput\b/g) ?? []).length, 'all direct labeled Arc inputs register at the shared boundary');

const ts = require('typescript');
function load(relative, overrides = {}) {
  const code = ts.transpileModule(read(relative), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => Object.hasOwn(overrides, id) ? overrides[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const tokens = load('apps/admin/src/app/designTokens.ts');
const inputColorTokens = new Map();
tokens.applyAdminTypographyTokens({ style: { setProperty: (key, value) => inputColorTokens.set(key, value) } });
assert.equal(tokens.ADMIN_INPUT_COLORS.borderDefault, 'var(--border)');
assert.equal(inputColorTokens.get('--rental-color-input-border-default'), 'var(--border)', 'both themes reuse their real border token; no fixed light-mode hex');
const palette = load('apps/admin/src/app/arcTokens.ts', { './designTokens': tokens });
const { createThemeConfig } = load('apps/admin/src/app/theme.tsx', {
  '@/app/designTokens': tokens, './arcTokens': palette,
  './motionPreferences': load('apps/admin/src/app/motionPreferences.ts'),
  antd: { theme: { defaultAlgorithm: 'default', darkAlgorithm: 'dark', compactAlgorithm: 'compact' } },
});
for (const inputRadius of [8, 18, 40]) for (const button of [18, 999]) for (const mode of ['default', 'dark', 'compact']) {
  const groups = { input: inputRadius, button, container: 26 };
  const vars = new Map();
  tokens.applyAdminRadiusTokens({ style: { setProperty: (key, value) => vars.set(key, value) } }, groups);
  assert.equal(vars.get('--rental-ui-radius-input'), inputRadius + 'px');
  assert.equal(vars.get('--rental-ui-radius-input-sm'), tokens.resolveAdminInputRadii(inputRadius).borderRadiusSM + 'px');
  const config = createThemeConfig(mode, undefined, groups);
  const expected = tokens.resolveAdminInputRadii(inputRadius);
  for (const name of ['Input', 'InputNumber', 'Select', 'DatePicker', 'Cascader', 'TreeSelect', 'Mentions']) assert.deepEqual(config.components[name], expected, name);
  assert.equal(config.components.Button.borderRadius, button);
  assert.equal(config.token.borderRadiusLG, 26);
}
const { inputRadiusClip, useInputRadiusClip } = load('apps/admin/src/components/ui/useInputRadiusClip.ts');
for (const clip of ['inset(0px 140px 376px 0px round 22px)', 'inset(0px 0px 0px 0px round 26px)']) {
  const result = inputRadiusClip(clip);
  assert.equal(result.split(' round ')[0], clip.split(' round ')[0], 'retain animated crop geometry');
  assert.ok(result.endsWith('round var(--radius-field))'));
  assert.equal(inputRadiusClip(result), result, 'idempotence prevents observer feedback loops');
}
assert.equal(inputRadiusClip('circle(40%)'), 'circle(40%)');
assert.match(read('apps/admin/src/components/ui/ColorPicker.tsx'), /useInputRadiusClip\(root\)/);
assert.match(read('apps/admin/src/components/ui/useInputRadiusClip.ts'), /return \(\) => observer.disconnect\(\)/);
// Exercise the clip adapter's live mutation boundary and cleanup without a browser.
const originalHTMLElement = global.HTMLElement, originalObserver = global.MutationObserver;
let observed, disconnected = false, cleanup;
try {
  class Element { constructor(clipPath) { this.style = { clipPath }; } querySelectorAll() { return []; } }
  global.HTMLElement = Element;
  global.MutationObserver = class {
    constructor(callback) { this.callback = callback; observed = this; }
    observe(node, options) { assert.equal(options.subtree, true); assert.equal(options.childList, true); assert.deepEqual(options.attributeFilter, ['style']); }
    disconnect() { disconnected = true; }
  };
  const initial = new Element('inset(0px 100px 200px 0px round 22px)');
  const module = load('apps/admin/src/components/ui/useInputRadiusClip.ts', { react: { useEffect: effect => { cleanup = effect(); } } });
  module.useInputRadiusClip({ current: { querySelectorAll: () => [initial] } });
  assert.equal(initial.style.clipPath, 'inset(0px 100px 200px 0px round var(--radius-field))');
  initial.style.clipPath = 'inset(0px 50px 90px 0px round 25px)';
  observed.callback([{ target: initial }]);
  assert.equal(initial.style.clipPath, 'inset(0px 50px 90px 0px round var(--radius-field))');
  const inserted = new Element('inset(0px 0px 0px 0px round 26px)');
  observed.callback([{ type: 'childList', addedNodes: [inserted] }]);
  assert.equal(inserted.style.clipPath, 'inset(0px 0px 0px 0px round var(--radius-field))', 'new reduced-motion panel uses tokens immediately');
  observed.callback([{ target: initial }]);
  assert.equal(initial.style.clipPath, 'inset(0px 50px 90px 0px round var(--radius-field))');
  cleanup(); assert.ok(disconnected);
} finally { global.HTMLElement = originalHTMLElement; global.MutationObserver = originalObserver; }
const rangeSource = read('packages/ui-arc/vendor/registry/components/date-range-picker/date-range-picker.tsx');
assert.match(rangeSource, /className=\{styles.surface\} style=\{\{ width, height, borderRadius: radius, x \}\}/, 'guard the original inline geometry targeted by the host radius override');
// popLayout cannot pop this upstream function component: its DOM ref is not
// forwarded. The host must remove only inert/leaving panes from normal flow.
const rangeRules = require('postcss').parse(css).nodes.filter(node => node.type === 'rule');
const leavingMonths = rangeRules.find(rule => rule.selector === '.arc-date-range [class*="viewport"] > [class*="months"][inert]');
assert.ok(leavingMonths, 'shared range-picker exit layout fix');
assert.deepEqual(Object.fromEntries(leavingMonths.nodes.map(node => [node.prop, node.value])), {
  position: 'absolute', top: '0', left: '0', width: 'max-content'
}, 'do not override transform, opacity, blur, transition, height, or active month layout');
const rangeCss = read('packages/ui-arc/vendor/registry/components/date-range-picker/date-range-picker.module.css');
assert.match(rangeCss, /\.viewport \{ position: relative;/, 'leaving pane is anchored to the calendar viewport, not the page');
assert.match(rangeSource, /data-current=\{present \|\| undefined\} inert=\{!present \|\| undefined\}/);
assert.match(rangeSource, /mode="popLayout" custom=\{direction\}/);
assert.match(rangeSource, /x: direction \* 48/);
assert.match(rangeSource, /x: direction \* -36/);
const arcSelectSource = read('packages/ui-arc/vendor/registry/components/select/select.tsx');
assert.match(arcSelectSource, /<SelectPrimitive\.Portal>/);
assert.match(arcSelectSource, /<SelectPrimitive\.Content className=\{styles.content\}/);
assert.match(arcSelectSource, /<SelectPrimitive\.Viewport/);
assert.match(css, /\.arc-orders-table \.ant-table-container \{[^}]*border-radius: var\(--rental-ui-radius-container, 26px\)/);
assert.match(css, /--rental-form-field-gap/);
assert.doesNotMatch(css, /--control-height-(?:sm|md|lg):/);
assert.match(css, /\.arc-form-item\.ant-form-item/);
assert.match(css, /\.arc-native-feedback \[class\*="messageSlot"\]/);
assert.match(orders, /SearchField/);
assert.match(orders, /DatePicker\.RangePicker/);
assert.match(orders, /<Select allowClear placeholder=\{t\("全部状态"\)\}/);
assert.doesNotMatch(orders, /Input\.Search/);
assert.doesNotMatch(orders, /\{ Card, Checkbox, Row, Col, Select,/);
assert.match(foundation, /--control-height-sm: 2\.25rem; --control-height-md: 2\.75rem; --control-height-lg: 3\.125rem;/);
assert.doesNotMatch(designTokens, /ADMIN_CONTROL_HEIGHTS|applyAdminControlHeightTokens/);
assert.doesNotMatch(theme, /ADMIN_CONTROL_HEIGHTS/);

// Owner-authorized global density replaces the old page-local 40/44/50 split.
assert.deepEqual(tokens.ADMIN_CONTROL_HEIGHT, { small: 32, default: 36, large: 40, toolbar: 32, filter: 36 });
for (const mode of ['default', 'dark', 'compact']) {
  const config = createThemeConfig(mode);
  assert.equal(config.token.controlHeight, tokens.ADMIN_CONTROL_HEIGHT.default);
  assert.equal(config.token.controlHeightSM, tokens.ADMIN_CONTROL_HEIGHT.small);
  assert.equal(config.token.controlHeightLG, tokens.ADMIN_CONTROL_HEIGHT.large);
  assert.equal(config.components.Button.paddingInline, tokens.ADMIN_CONTROL_PADDING.default);
}
for (const [cssName, role] of [['--control-height-sm', 'small'], ['--control-height-md', 'default'], ['--control-height-lg', 'large']]) {
  assert.equal(inputColorTokens.get(cssName), `var(--rental-control-height-${role})`);
  assert.equal(inputColorTokens.get(`--rental-control-height-${role}`), tokens.ADMIN_CONTROL_HEIGHT[role] + 'px');
}
for (const [role, value] of Object.entries(tokens.ADMIN_CONTROL_WIDTH)) {
  const cssRole = role.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
  assert.equal(inputColorTokens.get('--rental-control-width-' + cssRole), value + 'px');
}
assert.equal(tokens.ADMIN_LIST_METRICS.searchWidth, tokens.ADMIN_LIST_CONTROL_WIDTH.search);
assert.equal(tokens.ADMIN_LIST_METRICS.statusWidth, tokens.ADMIN_LIST_CONTROL_WIDTH.select);
for (const [role, value] of Object.entries(tokens.ADMIN_LIST_CONTROL_WIDTH)) {
  const cssRole = role.replace(/[A-Z]/g, part => '-' + part.toLowerCase());
  assert.equal(inputColorTokens.get('--rental-list-control-width-' + cssRole), value + 'px');
}
const metrics = read('apps/admin/src/components/ui/control-metrics.css');
const metricsRules = postcss.parse(metrics);
metricsRules.walkDecls(decl => {
  assert.doesNotMatch(decl.prop, /animation|transition|transform|radius|color|shadow|font|line-height/, 'geometry changes cannot replace original component effects');
  if (/height|padding/.test(decl.prop) || decl.prop === 'width') {
    // The inner segmented control derives its height from the shared field role
    // after subtracting the original frame, rather than another raw dimension.
    if (decl.parent.selector === '.arc-segmented' && decl.prop === '--control-height-sm') {
      assert.equal(decl.value, 'calc(var(--control-height-md) - var(--rental-segmented-frame-inset))');
      assert.equal(tokens.ADMIN_SEGMENTED_METRICS.frameInset, 8);
      return;
    }
    // Parent-relative layout (full-width forms / shrinkable wrappers) is not a pixel size.
    if (!['0', '100%'].includes(decl.value)) assert.match(decl.value, /var\(--rental-control-/, 'control dimensions come from the central tokens');
  }
});
assert.match(metrics, /\.arc-form-field, \.arc-search-field, \.arc-date-field, \.arc-date-range/);
assert.match(metrics, /\.ant-form-item[^}]*width: 100%/);
assert.doesNotMatch(metrics, /\[class\*="(?:surface|panel|viewport)"\][^}]*height/, 'calendar animation dimensions must remain vendor-owned');
assert.match(read('apps/admin/src/main.tsx'), /input-colors\.css";\s*import "\.\/components\/ui\/control-metrics\.css"/);
assert.doesNotMatch(css, /data-size="(?:small|large)"[^}]*min-height: \d+px/);

function visit(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file, files);
    else if (file.endsWith('.tsx')) files.push(file);
  }
  return files;
}
const directForms = visit(path.join(root, 'apps/admin/src'))
  .filter(file => !file.includes(`${path.sep}components${path.sep}ui${path.sep}`))
  .filter(file => /import\s*\{[^}]*\bForm\b[^}]*\}\s*from\s*["']antd["']/.test(fs.readFileSync(file, 'utf8')));
assert.deepEqual(directForms, []);

const directSelects = visit(path.join(root, 'apps/admin/src'))
  .filter(file => !file.includes(`${path.sep}components${path.sep}ui${path.sep}`))
  .filter(file => /import .*\bSelect\b.* from ["']antd["']/.test(fs.readFileSync(file, 'utf8')));
assert.deepEqual(directSelects, []);

const directSearches = visit(path.join(root, 'apps/admin/src'))
  .filter(file => !file.includes(`${path.sep}components${path.sep}ui${path.sep}`))
  .filter(file => /Input\.Search/.test(fs.readFileSync(file, 'utf8')));
assert.deepEqual(directSearches, []);
console.log('admin-form-adapter: form semantics and unified adapter imports passed');
