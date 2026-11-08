const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');

function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const result = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), result, result.exports);
  return result.exports;
}

const model = load('apps/admin/src/features/settings/calendar-year-model.ts');
const labels = load('apps/admin/src/features/settings/governance/ruleOptionLabels.ts');
const officialDates = load('apps/admin/src/features/platform/official-calendar-dates.ts');
const datePanel = load('apps/admin/src/components/ui/date-picker-month.ts');

test('an empty date field opens inside its allowed year without inventing a selected date', () => {
  const today = new Date(2026, 10, 8);
  const min = new Date(2027, 0, 1), max = new Date(2027, 11, 31);
  const values = [undefined, new Date(2026, 5, 4), new Date(2028, 0, 5), new Date(2027, 6, 3)];
  const expected = [[2027, 0], [2027, 0], [2027, 11], [2027, 6]];
  for (const [index, value] of values.entries()) {
    const before = value?.getTime();
    const month = datePanel.openingCalendarMonth(value, undefined, min, max, today);
    assert.deepEqual([month.getFullYear(), month.getMonth()], expected[index]);
    assert.equal(value?.getTime(), before, 'Viewport clamping must never alter the stored date.');
  }
  const preferred = datePanel.openingCalendarMonth(undefined, new Date(2027, 4, 12), min, max, today);
  assert.equal(preferred.getMonth(), 4);
  const normal = datePanel.openingCalendarMonth(undefined, undefined, undefined, undefined, today);
  assert.deepEqual([normal.getFullYear(), normal.getMonth()], [2026, 10]);
});

test('official date field edits round-trip the original payload without losing optional source values', () => {
  const rows = [
    { date: '2028-02-29', dayType: 'statutory_holiday', name: 'Original announcement', pricingMultiplier: 0, closed: false },
    { date: '2028-03-01', dayType: 'makeup_workday', name: 'Make-up day' },
  ];
  const before = structuredClone(rows);
  const decoded = officialDates.decodeOfficialCalendarDates(JSON.stringify(rows));
  const changed = officialDates.updateOfficialCalendarDate(decoded, 0, 'name', 'Reviewed announcement');
  const submitted = officialDates.readOfficialCalendarDates(JSON.stringify(changed), 2028, text => text);
  assert.deepEqual(submitted, [{ ...before[0], name: 'Reviewed announcement' }, before[1]]);
  assert.deepEqual(rows, before);
  assert.deepEqual(decoded, before, 'Editing must not mutate another mode\'s existing row objects.');
  assert.equal(submitted[0].pricingMultiplier, 0);
  assert.equal(submitted[0].closed, false);
});

test('official source input rejects wrong years, duplicate or impossible dates and preserves malformed input for correction', () => {
  const translate = (text, values) => text.replace('{row}', values?.row);
  const day = date => ({ date, dayType: 'statutory_holiday', name: 'Announcement' });
  const read = (rows, year = 2026) => officialDates.readOfficialCalendarDates(JSON.stringify(rows), year, translate);
  for (const raw of ['{', 'null', '[null]', '[[]]', '[3]']) assert.equal(officialDates.decodeOfficialCalendarDates(raw), null);
  assert.throws(() => read([]), /至少填写/);
  for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-01-01T00:00:00Z', '2026-1-01']) assert.throws(() => read([day(date)]), /第 1 条.*有效日期/);
  assert.throws(() => read([day('2100-02-29')], 2100), /有效日期/);
  assert.equal(read([day('2000-02-29')], 2000)[0].date, '2000-02-29');
  assert.throws(() => read([day('2027-01-01')]), /所选年度/);
  assert.throws(() => read([day('2026-01-01'), day('2026-01-01')]), /第 2 条.*重复/);
  assert.throws(() => read([{ ...day('2026-01-01'), dayType: 'weekend' }]), /法定节假日或调休/);
  assert.throws(() => read([{ ...day('2026-01-01'), name: '  ' }]), /填写.*名称/);
  assert.throws(() => read([day('2026-01-01')], 1999), /2000—2999/);
});

function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); return; }
  if (!React.isValidElement(node)) return;
  yield node;
  yield* elements(node.props.children);
}

test('year calendars contain each civil date once, including Gregorian leap-year boundaries', () => {
  for (const [year, expectedDays] of [[2026, 365], [2028, 366], [2100, 365], [2000, 366]]) {
    const months = model.calendarYearMonths(year);
    assert.equal(months.length, 12);
    const dates = months.flatMap(month => month.cells.filter(Boolean));
    assert.equal(dates.length, expectedDays);
    assert.equal(new Set(dates.map(cell => cell.date)).size, expectedDays);
    assert.equal(dates[0].date, `${year}-01-01`);
    assert.equal(dates.at(-1).date, `${year}-12-31`);
    assert.equal(dates.some(cell => cell.date === `${year}-02-29`), expectedDays === 366);
    for (const month of months) {
      assert.equal(month.cells.length, 42);
      for (const cell of month.cells.filter(Boolean)) {
        const date = new Date(`${cell.date}T00:00:00Z`);
        assert.equal((date.getUTCDay() + 6) % 7, cell.weekday);
      }
    }
  }
});

test('keyboard navigation crosses months, clamps short months, and stays inside the selected year', () => {
  assert.equal(model.moveCalendarDate('2028-01-31', 'PageDown', 2028), '2028-02-29');
  assert.equal(model.moveCalendarDate('2026-03-31', 'PageUp', 2026), '2026-02-28');
  assert.equal(model.moveCalendarDate('2026-01-31', 'ArrowRight', 2026), '2026-02-01');
  assert.equal(model.moveCalendarDate('2026-03-01', 'ArrowLeft', 2026), '2026-02-28');
  assert.equal(model.moveCalendarDate('2026-11-04', 'Home', 2026), '2026-11-02');
  assert.equal(model.moveCalendarDate('2026-11-04', 'End', 2026), '2026-11-08');
  assert.equal(model.moveCalendarDate('2026-01-01', 'ArrowLeft', 2026), undefined);
  assert.equal(model.moveCalendarDate('2026-12-31', 'PageDown', 2026), undefined);
  assert.equal(model.moveCalendarDate('2026-01-01', 'Enter', 2026), undefined);
});

test('year cells preserve real opening states, distinguish missing data, and open the original record', () => {
  const useState = initial => [initial, () => {}];
  const { CalendarYearGrid } = load('apps/admin/src/features/settings/CalendarYearGrid.tsx', {
    react: { ...React, useMemo: callback => callback(), useRef: () => ({ current: null }), useState },
    '@/app/locale': { useLocale: () => ({ locale: 'zh-CN', t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, name) => values[name]) }) },
    '@/components/ui': { Button: 'Button' },
    './calendar-year-model': model,
    './governance/ruleOptionLabels': labels,
    './CalendarYearGrid.module.css': {},
  });
  const days = [
    { date: '2026-01-03', dayType: 'weekend', name: '周末正常服务', businessStatus: 'open', closed: false, source: 'week_rule', pricingMultiplier: 1 },
    { date: '2026-01-04', dayType: 'weekend', name: '临时停业', businessStatus: 'closed', closed: true, source: 'tenant_override', pricingMultiplier: 1 },
  ];
  const before = structuredClone(days);
  const openedDays = [];
  const openedMonths = [];
  const nodes = [...elements(CalendarYearGrid({ year: 2026, days, onDayClick: day => openedDays.push(day), onMonthClick: month => openedMonths.push(month) }))];
  const buttons = nodes.filter(node => node.type === 'button' && node.props['data-calendar-date']);
  assert.equal(buttons.length, 365);
  assert.equal(buttons.filter(node => node.props.tabIndex === 0).length, 1);
  const openWeekend = buttons.find(node => node.props['data-calendar-date'] === '2026-01-03');
  const closed = buttons.find(node => node.props['data-calendar-date'] === '2026-01-04');
  const missing = buttons.find(node => node.props['data-calendar-date'] === '2026-01-05');
  assert.equal(openWeekend.props['data-status'], 'open');
  assert.equal(closed.props['data-status'], 'closed');
  assert.equal(closed.props['data-override'], true);
  assert.equal(missing.props.disabled, true);
  assert.equal(missing.props['data-status'], undefined);
  assert.match(missing.props['aria-label'], /无数据/);
  assert.deepEqual(openedDays, []);
  openWeekend.props.onClick();
  assert.equal(openedDays[0], days[0]);
  nodes.find(node => node.type === 'Button' && node.props['aria-label'].includes('三月')).props.onClick();
  assert.deepEqual(openedMonths, [3]);
  assert.deepEqual(days, before);
});

function rangeHarness() {
  const dayjs = require('dayjs');
  const state = [];
  const mutations = [];
  const requests = [];
  let cursor = 0;
  let mutationCursor = 0;
  const values = { range: [dayjs('2026-11-15'), dayjs('2026-11-16')], dateTimeRange: [dayjs('2026-11-15T09:00:13'), dayjs('2026-11-16T17:00:29')], dayType: 'tenant_special', name: 'Hidden unused name', overrideReason: 'Layout test' };
  const form = { getFieldsValue: () => values, validateFields: async () => values, resetFields: () => {} };
  const Form = Object.assign(() => {}, { useForm: () => [form], Item: 'FormItem' });
  const dependencies = {
    react: { ...React, useMemo: callback => callback(), useState: initial => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], update => { state[index] = typeof update === 'function' ? update(state[index]) : update; }];
    } },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {} }), useMutation: config => {
      const index = mutationCursor++;
      mutations[index] = config;
      return { isPending: false, reset: () => {}, mutateAsync: async input => {
        const result = await mutations[index].mutationFn(input);
        await mutations[index].onSuccess?.(result);
        return result;
      } };
    } },
    antd: { Space: 'Space', Tag: 'Tag', Typography: { Text: 'Text' } },
    '@/components/ui': { ...Object.fromEntries(['ActionButton', 'FormSection', 'Modal', 'Checkbox', 'Alert', 'Input', 'Select', 'Button', 'Table', 'TimeInput'].map(name => [name, name])),
      Form, DatePicker: { RangePicker: 'RangePicker' }, App: { useApp: () => ({ message: { success: () => {} } }) } },
    '@/app/locale': { useLocale: () => ({ t: text => text }) },
    '@/api/rentalCore': { rentalCoreApi: {
      calendarRangePreview: async (year, payload) => { requests.push({ kind: 'preview', year, payload }); return { year, totalDays: 2, conflictCount: 0, days: [] }; },
      calendarRangeApply: async (year, payload) => { requests.push({ kind: 'apply', year, payload }); return { appliedCount: 2, batchId: 'test-only' }; },
    } },
    './governance/shared': { errorText: (_, fallback) => fallback },
    './governance/GovernanceForms.module.css': {},
    '@rental-os/shared': {},
  };
  const { CalendarRangeModal } = load('apps/admin/src/features/settings/CalendarRangeModal.tsx', dependencies);
  const render = revision => { cursor = 0; mutationCursor = 0; return CalendarRangeModal({ mode: 'override', year: 2026, currentRevision: revision, open: true, onClose: () => {}, onApplied: () => {} }); };
  const action = node => [...elements(node.props.footer)].find(element => element.type === 'ActionButton');
  return { render, action, requests, values };
}

test('range preview keeps writes separate, preserves datetime seconds, and submits only selected fields', async () => {
  const harness = rangeHarness();
  let node = harness.render(7);
  [...elements(node)].find(element => element.type === 'Checkbox' && element.props.children === '指定开始与结束时点').props.onChange({ target: { checked: true } });
  node = harness.render(7);
  const previewAction = harness.action(node);
  assert.deepEqual(harness.requests, []);
  await previewAction.props.onAction();
  assert.deepEqual(harness.requests.map(request => request.kind), ['preview']);
  node = harness.render(7);
  assert.equal([...elements(node)].find(element => element.props.form).props.disabled, true, 'Preview locks the reviewed fields');
  const applyAction = harness.action(node);
  assert.notEqual(applyAction.key, previewAction.key, 'Preview success cannot become application success');
  await applyAction.props.onAction();
  const applied = harness.requests[1].payload;
  assert.equal(applied.startDateTime, harness.values.dateTimeRange[0].toISOString());
  assert.equal(applied.endDateTime, harness.values.dateTimeRange[1].toISOString());
  assert.deepEqual(applied.fields, { dayType: 'tenant_special' });
  assert.equal(applied.expectedRevision, 7);
});

test('a newer calendar revision invalidates an old preview before any application call', async () => {
  const harness = rangeHarness();
  await harness.action(harness.render(7)).props.onAction();
  await assert.rejects(harness.action(harness.render(8)).props.onAction(), /重新预览/);
  assert.deepEqual(harness.requests.map(request => request.kind), ['preview']);
});
