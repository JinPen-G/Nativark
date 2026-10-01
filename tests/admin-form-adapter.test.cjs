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
assert.match(input, /AntForm\.Item\.useStatus\(\)/);
assert.match(input, /arc-native-feedback/);
assert.match(search, /registry\/components\/search-field\/search-field/);
assert.match(search, /onSearch\?\.\(currentValue\)/);
assert.match(select, /registry\/components\/select\/select/);
assert.match(select, /if \(unsupported\) return <AntSelect/);
assert.match(select, /sourceOptions\.length === 0/);
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
