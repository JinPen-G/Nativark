const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const dayjs = require('dayjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'apps/admin/src/components/ui/DatePicker.tsx'), 'utf8');
// Exercise the adapter without a browser, login or separate preview page.
const integratedRange = () => {};
const arcRange = () => {};
const arcDate = () => {};
const jsx = (type, props) => ({ type, props });
const modules = {
  react: { useState: value => [value, () => {}], useEffect: () => {}, useLayoutEffect: () => {}, useRef: value => ({ current: value }) },
  'react/jsx-runtime': { jsx, jsxs: jsx },
  'lucide-react': { CalendarDays: () => {}, ChevronDown: () => {}, X: () => {} },
  dayjs,
  'dayjs/locale/zh-cn': require('dayjs/locale/zh-cn'),
  antd: { ConfigProvider: { useConfig: () => ({}) }, DatePicker: Object.assign(() => {}, { RangePicker: integratedRange }) },
  './SourceDatePicker': { DatePicker: arcDate },
  '@/registry/components/time-picker/time-picker': { TimePicker: () => {} },
  '@/registry/components/date-range-picker/date-range-picker': { DateRangePicker: arcRange },
  '@/registry/components/popover/popover': { Popover: () => {}, PopoverContent: () => {}, PopoverTrigger: () => {} },
  '@/app/locale': { useLocale: () => ({ locale: 'zh-CN', t: value => value }) },
  './Button': { Button: () => {} },
  './ArcLocale': { ArcLocale: () => {} },
};
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled)(name => {
  assert.ok(name in modules, `Unexpected dependency: ${name}`);
  return modules[name];
}, loaded, loaded.exports);
const RangePicker = loaded.exports.DatePicker.RangePicker;
let selectedDate;
const emptyBounded = loaded.exports.DatePicker({ value: null, defaultPickerValue: dayjs('2027-05-01'),
  minDate: dayjs('2027-01-01'), maxDate: dayjs('2027-12-31'), onChange: date => { selectedDate = date; } }).props.children.props.children[0];
assert.equal(emptyBounded.type, arcDate);
assert.equal(emptyBounded.props.value, undefined, 'Opening at a preferred month must not fabricate a date value');
assert.equal(dayjs(emptyBounded.props.defaultMonth).format('YYYY-MM-DD'), '2027-05-01');
assert.equal(selectedDate, undefined, 'Choosing a viewport does not emit a form change');
emptyBounded.props.onChange(new Date(2027, 4, 3));
assert.equal(selectedDate.format('YYYY-MM-DD HH:mm:ss'), '2027-05-03 00:00:00');
const selectionBeforeClear = selectedDate;
const lockedClear = loaded.exports.DatePicker({ value: selectedDate, allowClear: false, onChange: date => { selectedDate = date; } }).props.children.props.children[0];
assert.equal(lockedClear.props.allowClear, false, 'Clear policy reaches the source calendar, including its footer');
lockedClear.props.onChange(undefined);
assert.equal(selectedDate, selectionBeforeClear, 'A disallowed clear must not reach the form');
const disabledField = loaded.exports.DatePicker({ value: selectedDate, disabled: true, onChange: date => { selectedDate = date; } }).props.children.props.children[0];
disabledField.props.onChange(new Date(2027, 4, 4));
assert.equal(selectedDate, selectionBeforeClear, 'Disabled controls do not emit date edits');
for (const showTime of [true, { format: 'HH:mm:ss', minuteStep: 5 }]) {
  const value = [dayjs('2026-10-06T09:00:13'), dayjs('2026-10-07T18:00:13')];
  let received;
  const props = { showTime, value, allowClear: true, disabled: [false, true], style: { width: '100%' }, onChange: (...args) => { received = args; } };
  const element = RangePicker(props);
  assert.equal(element.type, integratedRange, 'Datetime range must be one integrated picker, not a split-controls wrapper');
  for (const key of Object.keys(props)) assert.equal(element.props[key], props[key], `Preserve ${key}`);
  assert.equal(element.props.value[0].second(), 13, 'Do not truncate business time precision');
  element.props.onChange(null, ['', '']);
  assert.deepEqual(received, [null, ['', '']], 'Keep the native clear contract');
}
const dateOnly = RangePicker({});
assert.equal(dateOnly.props.children.props.children[0].type, arcRange, 'Pure date ranges still use upstream Arc');
const bounded = RangePicker({ minDate: dayjs('2026-01-01'), maxDate: dayjs('2026-12-31') }).props.children.props.children[0];
assert.equal(bounded.type, arcRange, 'Year-bounded whole-day selection uses the original range picker');
assert.equal(dayjs(bounded.props.minDate).format('YYYY-MM-DD'), '2026-01-01');
assert.equal(dayjs(bounded.props.maxDate).format('YYYY-MM-DD'), '2026-12-31');

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  return element?.props ? [element, ...nodes(element.props.children)] : [];
}
const originalPair = [dayjs('2027-01-01'), dayjs('2027-01-10')];
let pairChange, changedEnd;
const endpoints = nodes(RangePicker({ value: originalPair, allowEmpty: [true, true], disabled: [false, true],
  onChange: value => { pairChange = value; }, onCalendarChange: (_value, _text, info) => { changedEnd = info.range; } }))
  .filter(node => node.type === loaded.exports.DatePicker);
assert.equal(endpoints.length, 2);
assert.equal(endpoints[0].props.disabledDate(dayjs('2027-01-11')), true, 'A locked end date bounds the editable start');
endpoints[0].props.onChange(dayjs('2027-01-11'));
assert.equal(pairChange, undefined, 'Moving the start cannot clear a locked end date');
endpoints[1].props.onChange(dayjs('2027-01-15'));
assert.equal(pairChange, undefined, 'Locked endpoint callbacks cannot emit edits');
endpoints[0].props.onChange(dayjs('2027-01-02'));
assert.equal(pairChange[1], originalPair[1]);
assert.equal(changedEnd, 'start', 'Changing a start date is not an end-date edit merely because both are filled');
assert.deepEqual(originalPair.map(date => date.format('YYYY-MM-DD')), ['2027-01-01', '2027-01-10']);
const order = fs.readFileSync(path.join(root, 'apps/admin/src/features/rental-core/RentalOrderCreatePage.tsx'), 'utf8');
assert.match(order, /<DatePicker\.RangePicker showTime/);
console.log('admin-datetime-range: integrated datetime, opening month, clear/disabled guards, pinned endpoints and change ownership passed (no browser verification)');
