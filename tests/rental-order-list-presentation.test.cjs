// Offline behavior checks only: no browser, database, HTTP, fixtures page or login.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createTable, getCoreRowModel } = require("@tanstack/table-core");

function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, "..", relative);
  const source = fs.readFileSync(filename, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(id => Object.hasOwn(overrides, id) ? overrides[id] : require(id), mod, mod.exports);
  return mod.exports;
}

const { orderTimingNotice, plannedReturnAt, timeSpanParts } = load("apps/admin/src/features/rental-core/orderListPresentation.ts");
const detailPresentation = load("apps/admin/src/features/rental-core/orderDetailPresentation.ts");
const eventsForDisplay = [
  { id: "old", at: "2026-10-01T10:00:00Z" }, { id: "unknown", at: "invalid" },
  { id: "new-a", at: "2026-10-02T10:00:00Z" }, { id: "new-b", at: "2026-10-02T10:00:00Z" },
];
assert.deepEqual(detailPresentation.newestFundingEvents(eventsForDisplay).map(row => row.id), ["new-a", "new-b", "old", "unknown"]);
assert.deepEqual(eventsForDisplay.map(row => row.id), ["old", "unknown", "new-a", "new-b"], "ledger display sorting must not mutate cached events");
assert.equal(detailPresentation.knownMoney(undefined), false);
assert.equal(detailPresentation.knownMoney(NaN), false);
assert.equal(detailPresentation.knownMoney(0), true, "an actual zero remains distinct from missing data");
const { OrderMoney } = load("apps/admin/src/features/rental-core/OrderDetailSummary.tsx", {
  "@/app/locale": {}, "@/components/ui": {}, "./orderListPresentation": {},
  "./orderDetailPresentation": detailPresentation,
  "./OrderDetail.module.css": { __esModule: true, default: {} },
});
const missingLedgerMoney = renderToStaticMarkup(React.createElement(OrderMoney, {}));
assert.match(missingLedgerMoney, /—/);
assert.doesNotMatch(missingLedgerMoney, /0\.00/, "missing financial reads cannot look like settled zero balances");
assert.match(renderToStaticMarkup(React.createElement(OrderMoney, { value: 0, currency: "HKD" })), /HK\$0\.00/);
const base = { status: "reserved", fulfillmentMode: "store_pickup_return", startAt: "2026-10-16T01:00:00Z", endAt: "2026-10-17T01:00:00Z", allocations: [] };
const clock = Date.parse("2026-10-16T01:30:00Z");
assert.equal(orderTimingNotice(base, Date.parse(base.startAt) - 1), undefined);
assert.equal(orderTimingNotice(base, Date.parse(base.startAt)).label, "到时未取");
assert.equal(orderTimingNotice(base, clock).minutes, 30);
for (const status of ["reserved", "ready_for_pickup", "pickup_overdue"]) assert.equal(orderTimingNotice({ ...base, status }, clock).kind, "pickup");
for (const status of ["draft", "cancelled", "completed", "no_show", "return_inspection", "settling"]) assert.equal(orderTimingNotice({ ...base, status }, clock + 3 * 86400000), undefined);
const renting = { ...base, status: "renting", allocations: [{ status: "picked_up", quantity: 1 }] };
const late = Date.parse(base.endAt) + 45 * 60000;
assert.equal(orderTimingNotice(renting, late).label, "逾期未还");
assert.equal(orderTimingNotice(renting, Date.parse(base.endAt)), undefined);
assert.equal(orderTimingNotice({ ...renting, allocations: [{ status: "returned", quantity: 1 }] }, late), undefined);
assert.equal(orderTimingNotice({ ...renting, allocations: [{ status: "returned", quantity: 2 }, { status: "picked_up", quantity: 1 }] }, late).kind, "return");
assert.equal(orderTimingNotice({ ...renting, effectiveEndAt: "2026-10-18T01:00:00Z" }, late), undefined);
assert.equal(plannedReturnAt({ ...renting, effectiveEndAt: "2026-10-18T01:00:00Z" }), "2026-10-18T01:00:00Z");
assert.equal(plannedReturnAt({ ...base, fulfillmentMode: "carrier_shipping", carrierRentalDueAt: "2026-10-19T01:00:00Z" }), "2026-10-19T01:00:00Z");
assert.equal(orderTimingNotice({ ...base, fulfillmentMode: "carrier_shipping" }, late), undefined, "in-transit parcels must not be labelled customer no-shows");
assert.equal(orderTimingNotice({ ...base, startAt: "invalid" }, clock), undefined);
assert.equal(orderTimingNotice({ ...base, endAt: base.startAt }, clock), undefined);
assert.deepEqual(timeSpanParts(1505), [{ value: 1, unit: "天" }, { value: 1, unit: "小时" }, { value: 5, unit: "分钟" }]);
assert.deepEqual(timeSpanParts(-1), []);

const { rentalOrderListSort } = load("apps/api/src/modules/rental-core/rental-order-list-sort.ts");
assert.equal(rentalOrderListSort({}).sql, "o.`createdAt` DESC, o.`id` DESC");
assert.equal(rentalOrderListSort({ sort: "startAt.asc,payableAmount.desc" }).sql, "o.`startAt` ASC, o.`payableAmount` DESC, o.`id` DESC");
const dueSort = rentalOrderListSort({ sort: "endAt.asc" });
assert.match(dueSort.sql, /carrierRentalDueAt/);
assert.match(dueSort.sql, /effectiveEndAt/);
assert.equal(dueSort.values.length, 0, "SQL fragments are allowlisted constants, not interpolated client identifiers");
for (const sort of ["orderNo.asc; DROP TABLE rental_orders", "__proto__.asc", "constructor.asc", "id.asc", "startAt.ASC", "startAt.asc,startAt.desc", "startAt", "startAt.asc,", "x".repeat(257), {}, ["startAt.asc"]]) assert.throws(() => rentalOrderListSort({ sort }));
for (const key of ["createdAt", "orderNo", "customerName", "startAt", "endAt", "payableAmount", "quoteNo", "status"]) for (const direction of ["asc", "desc"]) assert.match(rentalOrderListSort({ sort: `${key}.${direction}` }).sql, /o\.`id` DESC$/);

let table;
const options = {
  data: [{ id: "b", amount: 2 }, { id: "a", amount: 1 }],
  columns: [{ id: "id", accessorKey: "id", enableHiding: false }, { id: "amount", accessorKey: "amount" }],
  getRowId: row => row.id, getCoreRowModel: getCoreRowModel(), manualSorting: true, manualPagination: true,
  state: { sorting: [], rowSelection: {}, columnVisibility: {}, columnSizing: {}, columnPinning: { left: [], right: [] } },
  onStateChange: updater => table.setOptions(previous => ({ ...previous, state: typeof updater === "function" ? updater(previous.state) : updater })),
};
table = createTable(options);
table.getColumn("amount").toggleSorting(false, true);
table.getColumn("id").toggleSorting(true, true);
assert.deepEqual(table.getState().sorting, [{ id: "amount", desc: false }, { id: "id", desc: true }]);
assert.deepEqual(table.getRowModel().rows.map(row => row.id), ["b", "a"], "do not sort only the loaded server page");
table.getColumn("amount").toggleVisibility(false);
assert.deepEqual(table.getVisibleLeafColumns().map(column => column.id), ["id"]);
table.getColumn("amount").toggleVisibility(true);
assert.equal(table.getVisibleLeafColumns().length, 2);

const classes = new Proxy({}, { get: (_, property) => String(property) });
const loadingTokens = load("apps/admin/src/app/designTokens.ts");
const sourceSkeleton = load("packages/ui-arc/vendor/registry/components/skeleton/skeleton.tsx", {
  "@/lib/motion-tokens": { motionTokens: {} },
  "./skeleton.module.css": { __esModule: true, default: classes },
});
const loadingShapes = load("apps/admin/src/components/loading/LoadingSkeleton.tsx", {
  "@/app/designTokens": loadingTokens,
  "../ui/Skeleton": sourceSkeleton,
  "./LoadingSkeleton.module.css": { __esModule: true, default: classes },
});
const numericHook = load("packages/ui-motiq/runtime/use-animated-number.ts");
const motionIntegration = load("apps/admin/src/components/ui/data-table/DataTableMotion.tsx", {
  "../../../../../../packages/ui-motiq/runtime/use-animated-number": numericHook,
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
  "./DataTable.module.css": { __esModule: true, default: classes },
});
const { DataTable, DataTableLeading } = load("apps/admin/src/components/ui/data-table/DataTable.tsx", {
  "@/app/designTokens": loadingTokens,
  "../../loading/LoadingSkeleton": loadingShapes,
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
  "../Button": { Button: "button" },
  "./DataTable.module.css": { __esModule: true, default: classes },
  "./DataTableMotion": motionIntegration,
});
// Exercise the real shared pagination's size selector and the actual order
// footer handler without a browser or business request.
{
const paginationStateWrites = [], paginationChanges = [];
const paginationDependencies = {
  react: { ...React, useState: initial => [initial, value => paginationStateWrites.push(value)], useRef: () => ({ current: null }), useLayoutEffect: () => {} },
  antd: { Pagination: 'fallback-pagination' },
  '@/registry/components/pagination/pagination': { Pagination: 'arc-pages' },
  '@/registry/components/select/select': { Select: 'arc-size-select' },
  '@/app/locale': { useLocale: () => ({ t: text => text }) },
  './ArcLocale': { ArcLocale: 'arc-locale' }, './Input': { Input: 'input' }, './Button': { Button: 'button' },
};
const { Pagination } = load('apps/admin/src/components/ui/Pagination.tsx', paginationDependencies);
function elements(element, type) {
  if (!React.isValidElement(element)) return [];
  return [...(element.type === type ? [element] : []), ...React.Children.toArray(element.props.children).flatMap(child => elements(child, type))];
}
for (const total of [0, 1, 22, 51]) {
  const footer = Pagination({ current: 2, pageSize: 20, total, showSizeChanger: true,
    onChange: (...args) => paginationChanges.push(args) });
  const control = elements(footer, 'arc-size-select')[0];
  assert.ok(control, `size selector stays available with ${total} orders`);
  assert.deepEqual(control.props.options.map(option => option.value), ['10', '20', '50', '100']);
  for (const option of control.props.options) {
    assert.equal(option.label, `${option.value}\u00a0/\u00a0页`, 'portal option is one unbreakable label');
    assert.doesNotMatch(option.label, /[ \t\r\n]/, 'no ordinary spaces that permit wrapping before the unit');
  }
  assert.equal(control.props.value, '20');
  control.props.onValueChange('50');
  assert.deepEqual(paginationChanges.at(-1), [Math.min(2, Math.max(1, Math.ceil(total / 50))), 50]);
  assert.equal(elements(footer, 'arc-pages').length, 1, 'keep the existing Arc pager');
}
assert.equal(elements(Pagination({ total: 22, pageSize: 20, showSizeChanger: false }), 'arc-size-select').length, 0);
assert.equal(elements(Pagination({ total: 22, pageSize: 20, showSizeChanger: true, disabled: true }), 'arc-size-select')[0].props.disabled, true);
const orderPageSource = fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/features/rental-core/RentalOrdersPage.tsx'), 'utf8');
const orderPageAst = ts.createSourceFile('orders.tsx', orderPageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pagerNode;
function findPager(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(orderPageAst) === 'Pagination') pagerNode = node;
  ts.forEachChild(node, findPager);
}
findPager(orderPageAst);
assert.ok(pagerNode);
const sizeChanger = pagerNode.attributes.properties.find(prop => prop.name?.text === 'showSizeChanger');
assert.ok(sizeChanger && !sizeChanger.initializer, 'orders must explicitly enable size changer even below the default 50-row threshold');
const onChangeExpression = pagerNode.attributes.properties.find(prop => prop.name?.text === 'onChange').initializer.expression.getText(orderPageAst);
const orderPageWrites = [];
const footerHandler = new Function('pageSize', 'setPageSize', 'setPage', `return (${onChangeExpression});`)(20,
  size => orderPageWrites.push(['pageSize', size]), page => orderPageWrites.push(['page', page]));
footerHandler(2, 50);
assert.deepEqual(orderPageWrites.splice(0), [['pageSize', 50], ['page', 1]], 'changing size restarts the server query at page one');
footerHandler(2, 20);
assert.deepEqual(orderPageWrites, [['page', 2]], 'normal page navigation stays unchanged');
assert.match(orderPageSource, /const query: RentalOrderListQuery = \{\s*page,\s*pageSize,/);
assert.match(orderPageSource, /queryKey: \["rental-core", "orders", query\], queryFn: \(\) => rentalCoreApi\.orderPage\(query\)/);
assert.match(fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/components/ui/Pagination.tsx'), 'utf8'), /arc-select-field arc-pagination-size/);
const pageSizeRule = require('postcss').parse(fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/components/ui/arc-bridge.css'), 'utf8'))
  .nodes.find(node => node.type === 'rule' && node.selector === '.arc-pagination-size');
assert.deepEqual(Object.fromEntries(pageSizeRule.nodes.map(node => [node.prop, node.value])), {
  width: 'max-content', 'min-width': '0', flex: 'none', 'white-space': 'nowrap'
}, 'only size selector width/wrapping changes; typography, radius and animation stay upstream');
const bridgeRules = require('postcss').parse(fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/components/ui/arc-bridge.css'), 'utf8')).nodes;
const noCheckRule = bridgeRules.find(rule => rule.selector === '[data-rental-page-size-menu] [role="option"] > [class*="indicator"]');
assert.deepEqual(Object.fromEntries(noCheckRule.nodes.map(node => [node.prop, node.value])), { display: 'none' });
const optionRule = bridgeRules.find(rule => rule.selector === '[data-rental-page-size-menu] [role="option"]');
assert.deepEqual(Object.fromEntries(optionRule.nodes.map(node => [node.prop, node.value])), { 'padding-inline': 'var(--space-3)', 'white-space': 'nowrap' }, 'remove the old checkmark gutter without changing height or motion');
// Execute the actual layout effect with an asynchronously mounted Portal: only
// the panel referenced by this trigger receives the no-check styling marker.
const originalDocument = global.document, originalObserver = global.MutationObserver;
try {
  let panel = null, observeCallback, disconnected = 0, observed = 0;
  const effects = [];
  const trigger = { current: { getAttribute: name => name === 'aria-controls' ? 'page-size-panel' : null } };
  const unrelatedPanel = { dataset: {}, getAttribute: () => 'listbox' };
  global.document = { body: {}, getElementById: id => id === 'page-size-panel' ? panel : unrelatedPanel };
  global.MutationObserver = class { constructor(callback) { observeCallback = callback; } observe() { observed++; } disconnect() { disconnected++; } };
  const { Pagination: scopedPagination } = load('apps/admin/src/components/ui/Pagination.tsx', {
    ...paginationDependencies, react: { ...paginationDependencies.react, useRef: () => trigger,
      useState: initial => [typeof initial === 'boolean' ? true : initial, () => {}],
      useLayoutEffect: effect => effects.push(effect) },
  });
  scopedPagination({ total: 22, pageSize: 20, showSizeChanger: true });
  const cleanup = effects[0]();
  assert.equal(observed, 1);
  panel = { dataset: {}, getAttribute: () => 'listbox' };
  observeCallback();
  assert.deepEqual(panel.dataset, { rentalPageSizeMenu: '' });
  assert.deepEqual(unrelatedPanel.dataset, {}, 'other fields retain their checkmarks and padding');
  assert.equal(disconnected, 1);
  cleanup();
  assert.equal(disconnected, 2);
  assert.deepEqual(panel.dataset, { rentalPageSizeMenu: '' }, 'exit animation retains the scoped no-check appearance');
} finally { global.document = originalDocument; global.MutationObserver = originalObserver; }
}
const html = renderToStaticMarkup(React.createElement(DataTable, { table, caption: "订单", empty: "无记录" }));
assert.match(html, /<caption class="srOnly">订单<\/caption>/);
assert.match(html, /aria-sort="ascending"/);
assert.match(html, /role="region"/);
assert.match(html, /class="scroll"/);

// Real TanStack controlled ID state survives paging/filter data replacement.
table.setOptions(previous => ({ ...previous, enableRowSelection: true, state: { ...previous.state, rowSelection: {} } }));
table.getRow("a").toggleSelected(true);
assert.equal(table.getIsSomePageRowsSelected(), true);
table.setOptions(previous => ({ ...previous, data: [{ id: "c", amount: 3 }, { id: "d", amount: 4 }] }));
assert.deepEqual(table.getState().rowSelection, { a: true });
assert.equal(table.getSelectedRowModel().rows.length, 0, "current-page row model cannot count off-page selections");
table.toggleAllPageRowsSelected(true);
assert.deepEqual(table.getState().rowSelection, { a: true, c: true, d: true });
table.toggleAllPageRowsSelected(false);
assert.deepEqual(table.getState().rowSelection, { a: true }, "deselect this page must not drop off-page IDs");
table.setOptions(previous => ({ ...previous, data: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }] }));
assert.equal(table.getRow("a").getIsSelected(), true, "returning to page restores the checkmark");

const arcCheckbox = load("packages/ui-arc/vendor/registry/components/checkbox/checkbox.tsx", {
  "@/lib/motion-tokens": load("packages/ui-arc/vendor/registry/motion-tokens.ts"),
  "./checkbox.module.css": { __esModule: true, default: classes },
});
const selection = load("apps/admin/src/components/ui/data-table/DataTableSelection.tsx", {
  "@/registry/components/checkbox/checkbox": arcCheckbox,
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
  "../Button": { Button: "button" },
  "./DataTable.module.css": { __esModule: true, default: classes },
});
const checkboxColumn = selection.dataTableSelectionColumn({ label: row => `选择订单 ${row.id}` });
assert.equal(checkboxColumn.enableHiding, false);
assert.equal(checkboxColumn.enableSorting, false);
const summary = renderToStaticMarkup(React.createElement(selection.DataTableSelectionSummary, { table }));
assert.match(summary, /已选择.*1.*当前页已选.*1/);
table.setOptions(previous => ({ ...previous, data: [{ id: "c", amount: 3 }] }));
const offPageSummary = renderToStaticMarkup(React.createElement(selection.DataTableSelectionSummary, { table }));
assert.match(offPageSummary, /已选择.*1.*当前页已选.*0.*包含其他页或筛选外的选择/);
const headerCheckbox = renderToStaticMarkup(checkboxColumn.header({ table }));
assert.match(headerCheckbox, /aria-label="选择当前页"/);
const rowCheckbox = renderToStaticMarkup(checkboxColumn.cell({ row: table.getRow("c") }));
assert.match(rowCheckbox, /aria-label="选择订单 c"/);
table.resetRowSelection(true);
assert.deepEqual(table.getState().rowSelection, {});

// Original motion parameters and the extracted numeric hook must not silently drift.
const originalMotion = fs.readFileSync(path.resolve(__dirname, "../packages/ui-motiq/vendor/streaming-data-rows.tsx"), "utf8");
const originalPrimitives = fs.readFileSync(path.resolve(__dirname, "../packages/ui-motiq/vendor/motion.ts"), "utf8");
const crypto = require("node:crypto");
for (const [file, hash] of Object.entries({
  "streaming-data-rows.tsx": "a9f93db655f00d19857ec40dcd8c6e3a251e8ca285c5f184ca0f521534eb7ee0",
  "motion.ts": "b26e675fd9515670d431609ad426150f83085cb83f81f4c32a3654090c03221c",
  "utils.ts": "7d5fc9c5737217953b38831c9a237e7d1cb6df536e405dbf686dcd9a7d1f9c3b",
})) {
  const content = fs.readFileSync(path.resolve(__dirname, "../packages/ui-motiq/vendor", file), "utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
  assert.equal(crypto.createHash("sha256").update(content).digest("hex"), hash, "reserved original source must not drift");
}
const hookSource = fs.readFileSync(path.resolve(__dirname, "../packages/ui-motiq/runtime/use-animated-number.ts"), "utf8");
const hookStart = originalPrimitives.indexOf("export function useAnimatedNumber(");
const hookEnd = originalPrimitives.indexOf("\n/* -------------------------------------------------------------------------- */", hookStart);
assert.ok(hookSource.endsWith(originalPrimitives.slice(hookStart, hookEnd).trimEnd() + "\n"));
assert.match(originalMotion, /layout: \{ duration: 0\.32, ease: \[0\.2, 0, 0, 1\] \}/);
assert.equal(motionIntegration.MOTIQ_TABLE_MOTION.transition.layout.duration, 0.32);
assert.equal(motionIntegration.MOTIQ_TABLE_MOTION.transition.duration, 0.24);
assert.deepEqual(motionIntegration.MOTIQ_TABLE_MOTION.transition.ease, [0.2, 0, 0, 1]);
assert.equal(motionIntegration.MOTIQ_TABLE_MOTION.highlightDuration, 1400);
assert.equal(motionIntegration.cellChangeDirection(10, 10), undefined);
assert.equal(motionIntegration.cellChangeDirection(10, 11), 1);
assert.equal(motionIntegration.cellChangeDirection(11, 10), -1);
assert.equal(motionIntegration.cellChangeDirection("reserved", "renting"), 0);
const snapshot = entries => new Map(entries.map(([id, value]) => [id, new Map([["status", value]])]));
assert.deepEqual(motionIntegration.compareTableSnapshots(snapshot([["a", "reserved"], ["b", "renting"]]), snapshot([["a", "renting"], ["c", "completed"]])), { added: 1, updated: 1, removed: 1 });
assert.deepEqual(motionIntegration.compareTableSnapshots(snapshot([["a", "reserved"]]), snapshot([["a", "reserved"]])), { added: 0, updated: 0, removed: 0 });
const skeleton = renderToStaticMarkup(React.createElement(DataTable, { table, caption: "订单", empty: "无记录", animated: true, loading: true, busy: true }));
assert.equal((skeleton.match(/class="skeletonRow"/g) ?? []).length, loadingTokens.ADMIN_LOADING_METRICS.rows);
assert.match(skeleton, /aria-busy="true"/);
assert.doesNotMatch(skeleton, /无记录/);
assert.doesNotMatch(skeleton, /refreshOverlay/, "initial loading keeps the existing cell skeletons only");
const refreshing = renderToStaticMarkup(React.createElement(DataTable, { table, caption: "订单", empty: "无记录", busy: true }));
assert.match(refreshing, /class="refreshOverlay" role="status" aria-label="加载中"/);
assert.doesNotMatch(refreshing, /refreshSpinner/);
assert.match(refreshing, /class="refreshingBody"/);
assert.equal((refreshing.match(/class="skeletonRow"/g) ?? []).length, table.getRowModel().rows.length);
assert.match(refreshing, /<tbody inert=""/);
assert.match(refreshing, new RegExp(`data-row-id="${table.getRowModel().rows[0].id}"`), "refresh must preserve old rows and table height");
assert.doesNotMatch(refreshing, /data-refreshing|progressbar|正在读取订单/);
const tableStyles = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/components/ui/data-table/DataTable.module.css"), "utf8");
// Regression: the approved 999 button preset must never turn the table frame/popovers into ovals.
const { applyAdminRadiusTokens } = load("apps/admin/src/app/designTokens.ts");
function radiusVariables(groups) {
  const values = new Map();
  applyAdminRadiusTokens({ style: { setProperty: (name, value) => values.set(name, value) } }, groups);
  return values;
}
const normalRadii = radiusVariables({ container: 24, button: 18, input: 12 });
const fullButtonRadii = radiusVariables({ container: 24, button: 999, input: 12 });
const metricValues = new Map();
load("apps/admin/src/app/designTokens.ts").applyAdminTypographyTokens({ style: { setProperty: (name, value) => metricValues.set(name, value) } });
assert.equal(metricValues.get('--rental-table-compact-header-height'), '36px');
assert.equal(metricValues.get('--rental-table-status-height'), '24px');
assert.equal(metricValues.get('--rental-layout-page-top-gap'), 'var(--space-1)', 'shared shell top gap is injected at startup from the foundation scale');
assert.equal(metricValues.get('--rental-table-status-radius-max'), '6px');
assert.equal(fullButtonRadii.get("--rental-ui-radius-button"), "999px");
assert.equal(fullButtonRadii.get("--rental-ui-radius-container"), "24px");
assert.equal(fullButtonRadii.get("--rental-ui-radius-input"), "12px");
for (const [group, selectors] of Object.entries({
  container: ["scroll", "rowMenu", "refreshOverlay", "menu", "columnViewMenu", "columnCommand", "sortOverlay"],
  button: ["rowMenuTrigger", "rowMenuItem", "headerTrigger", "menuItem", "commandItem", "columnItem", "dragHandle"],
  input: ["columnSearch", "directionTrigger"],
})) for (const selector of selectors) {
  const declaration = tableStyles.match(new RegExp(`^\\.${selector} \\{([^}]+)\\}`, "m"))?.[1];
  assert.ok(declaration, `Missing style ${selector}`);
  assert.ok(declaration.includes(`var(--rental-ui-radius-${group})`), `${selector} must use its own ${group} radius`);
  if (group !== "button") assert.equal(fullButtonRadii.get(`--rental-ui-radius-${group}`), normalRadii.get(`--rental-ui-radius-${group}`));
}
assert.doesNotMatch(tableStyles, /var\(--rental-ui-radius-sm\)/, "legacy small radius inherits button=999 and is unsafe for mixed-role table UI");
assert.doesNotMatch(tableStyles, /\.scroll\[data-refreshing\]::after/);
assert.match(tableStyles, /\.columnViewMenu \{[^}]*width: 11rem;/);
assert.match(tableStyles, /\.columnViewMenu\[data-state="open"\] \{ animation: rowMenuIn 100ms ease;/);
assert.match(tableStyles, /\.columnSearchWrapper \{ padding: var\(--space-1\); padding-bottom: 0;/);
assert.match(tableStyles, /\.columnViewCheck \{[^}]*width: 1rem;/);
assert.match(fs.readFileSync(path.resolve(__dirname, "../packages/ui-arc/vendor/registry/components/skeleton/skeleton.module.css"), "utf8"), /prefers-reduced-motion: reduce/);
const { LoadingState } = load("apps/admin/src/components/LoadingState.tsx", {
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
});
const pageLoading = renderToStaticMarkup(React.createElement(LoadingState));
assert.equal((pageLoading.match(/class="rental-loading-cell"/g) ?? []).length, 9);
assert.deepEqual([...pageLoading.matchAll(/animation-delay:(\d+)ms/g)].map(match => Number(match[1])), [90, 180, 270, 0, 90, 180, 90, 180, 270]);
assert.match(pageLoading, /role="status" aria-live="polite" aria-busy="true"/);
assert.match(pageLoading, /class="rental-loading-label">加载中<\/span>/);
assert.doesNotMatch(pageLoading, /<table|<aside|data-loading-skeleton|<button|<input|href=/, "generic loading must not guess a business page's structure");
assert.match(renderToStaticMarkup(React.createElement(LoadingState, { label: "Loading…" })), /class="rental-loading-label">Loading…<\/span>/);
assert.equal(loadingShapes.PageSkeleton, undefined);
assert.equal(loadingShapes.ShellSkeleton, undefined);
const orderPageSource = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/features/rental-core/RentalOrdersPage.tsx"), "utf8");
assert.doesNotMatch(orderPageSource, /正在读取订单|筛选结果更新中，当前显示上次结果。/);
// Inspect the actual View element tree, keeping real TanStack visibility callbacks.
const viewIntegration = load("apps/admin/src/components/ui/data-table/DataTable.tsx", {
  "@/app/designTokens": loadingTokens,
  "../../loading/LoadingSkeleton": loadingShapes,
  react: { ...React, useState: () => [false, () => {}] },
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
  "../Button": { Button: "button" },
  "./DataTable.module.css": { __esModule: true, default: classes },
  "./DataTableMotion": motionIntegration,
});
const viewTree = viewIntegration.DataTableViewOptions({ table, label: id => `Label ${id}` });
const viewElements = [];
function visitView(element) {
  if (!React.isValidElement(element)) return;
  viewElements.push(element);
  React.Children.forEach(element.props.children, visitView);
}
visitView(viewTree);
const viewItems = viewElements.filter(element => element.props["data-slot"] === "command-item");
assert.deepEqual(viewItems.map(element => element.props.value), ["amount"], "fixed identity and non-data columns stay out of View");
assert.equal(viewItems[0].props["data-checked"], true);
viewItems[0].props.onSelect();
assert.equal(table.getColumn("amount").getIsVisible(), false);
viewItems[0].props.onSelect();
assert.equal(table.getColumn("amount").getIsVisible(), true, "keep the menu open for multiple column changes");
assert.equal(viewElements.find(element => element.props["data-slot"] === "popover-content").props.align, "center");
assert.ok(viewElements.some(element => element.props["data-slot"] === "input-group"));
const motionCell = renderToStaticMarkup(React.createElement(motionIntegration.DataTableCellMotion, { value: 12.3, format: n => `¥${n.toFixed(2)}` }, "¥12.30"));
assert.match(motionCell, /aria-hidden="true">¥12.30/);
assert.match(motionCell, /class="srOnly">¥12.30/);
const statusIntegration = load("apps/admin/src/components/ui/data-table/DataTableStatus.tsx", { "./DataTable.module.css": { __esModule: true, default: classes } });
const statusMarkup = renderToStaticMarkup(React.createElement(statusIntegration.DataTableStatus, { tone: "success" }, "已关闭"));
assert.match(statusMarkup, /data-tone="success"/);
assert.match(statusMarkup, /data-variant="outline"/);
assert.match(statusMarkup, /lucide-circle-check/);
assert.match(statusMarkup, /<svg.*aria-hidden="true"/);
assert.match(statusMarkup, /已关闭/);
const quickActions = load("apps/admin/src/features/rental-core/orderQuickActions.ts");
const allOrderPermissions = { operate: true, pickup: true, return: true, extend: true, cancel: true, settle: true };
const noOrderPermissions = Object.fromEntries(Object.keys(allOrderPermissions).map(key => [key, false]));
const rowActionIntegration = load("apps/admin/src/components/ui/data-table/DataTableRowActions.tsx", {
  "../Button": { Button: "button" }, "../Dropdown": { Dropdown: ({ children }) => children },
  "./DataTable.module.css": { __esModule: true, default: classes },
});
const orderRowActions = load("apps/admin/src/features/rental-core/RentalOrderRowActions.tsx", {
  "@/components/ui": rowActionIntegration, "./orderQuickActions": quickActions,
});
const { DataTableMoney } = load("apps/admin/src/components/ui/data-table/DataTableMoney.tsx", {
  "./DataTable.module.css": { __esModule: true, default: classes },
});
const orderColumns = load("apps/admin/src/features/rental-core/rentalOrderColumns.tsx", {
  "@/components/ui": { Button: "button", Tooltip: ({ title, children }) => React.createElement('span', { 'data-tooltip': title }, children), DataTableColumnHeader: () => null, DataTableLeading, DataTableMoney, DataTableStatus: statusIntegration.DataTableStatus, DataTableNote: statusIntegration.DataTableNote },
  "@/app/designTokens": load("apps/admin/src/app/designTokens.ts"),
  "./orderFeeReview": load("apps/admin/src/features/rental-core/orderFeeReview.ts"),
  "./orderListPresentation": { orderTimingNotice, plannedReturnAt, timeSpanParts },
  "./RentalOrdersPage.module.css": { __esModule: true, default: classes },
  "./RentalOrderRowActions": orderRowActions,
});
const data = { ...base, id: "order", orderNo: "R1", customerName: "Customer", reservations: [], lines: [], payableAmount: 12.3, currency: "CNY" };
for (const [status, primary] of [["draft", "confirm"], ["reserved", "allocation"], ["ready_for_pickup", "pickup"], ["renting", "return"], ["settling", "settle"]]) {
  const order = { ...data, status };
  assert.equal(quickActions.orderQuickActions(order, allOrderPermissions).primary, primary);
  assert.deepEqual(quickActions.orderQuickActions(order, noOrderPermissions).actions, []);
}
for (const status of ["return_inspection", "completed", "cancelled", "no_show", "pickup_overdue"]) assert.deepEqual(quickActions.orderQuickActions({ ...data, status }, allOrderPermissions), { actions: [], primary: undefined });
assert.deepEqual(quickActions.orderQuickActions({ ...data, status: "ready_for_pickup" }, { ...noOrderPermissions, pickup: true }).actions, ["pickup"]);
assert.deepEqual(quickActions.orderQuickActions({ ...data, status: "renting" }, { ...noOrderPermissions, return: true }).actions, ["return"]);
assert.deepEqual(quickActions.orderQuickActions({ ...data, status: "settling" }, { ...noOrderPermissions, operate: true }).actions, [], "operate must not imply financial settlement permission");
assert.equal(quickActions.orderQuickActions(data, { ...noOrderPermissions, cancel: true }).primary, undefined, "never promote cancellation");
assert.equal(quickActions.orderQuickActions({ ...data, status: "renting", fulfillmentMode: "carrier_shipping" }, allOrderPermissions).actions.includes("extend"), false, "carrier eligibility needs shipment facts absent from the list");
for (const value of [null, "__proto__", "constructor", "toString", "delete", "pickup;settle"]) assert.equal(quickActions.parseOrderQuickAction(value), undefined);
assert.equal(quickActions.parseOrderQuickAction("pickup"), "pickup");
assert.equal(quickActions.orderQuickActionPath("order/a?x", "return"), "/rental/orders/order%2Fa%3Fx?action=return");
const navigations = [];
const actionProps = orderRowActions.RentalOrderRowActions({ order: { ...data, status: "ready_for_pickup" }, permissions: allOrderPermissions, navigate: target => navigations.push(target), t: text => text }).props;
assert.deepEqual(navigations, [], "rendering never executes or navigates");
actionProps.primary.onSelect();
actionProps.actions.find(action => action.id === "cancel").onSelect();
assert.deepEqual(navigations, ["/rental/orders/order?action=pickup", "/rental/orders/order?action=cancel"], "quick actions only navigate to an existing operation");
const actionHtml = renderToStaticMarkup(React.createElement(rowActionIntegration.DataTableRowActions, actionProps));
assert.match(actionHtml, /lucide-ellipsis/);
assert.match(actionHtml, /data-slot="dropdown-menu-trigger"/);
assert.match(actionHtml, /class="rowMenuTrigger"/);
assert.doesNotMatch(actionHtml, /rowActionPeek|lucide-arrow-up-right/, "a primary action and ellipsis only; no hover-revealed shortcuts");
assert.match(actionHtml, /aria-label="订单快捷操作 · R1"/);
const readOnlyActionHtml = renderToStaticMarkup(React.createElement(orderRowActions.RentalOrderRowActions, { order: data, permissions: noOrderPermissions, navigate() {}, t: text => text }));
assert.doesNotMatch(readOnlyActionHtml, /分配 \/ 锁定|办理领取|取消并按规则计费/);
assert.match(readOnlyActionHtml, /aria-label="查看详情 · R1"/);
assert.match(readOnlyActionHtml, /lucide-file-text/);
assert.match(readOnlyActionHtml, />查看详情<\/button>/, "details must keep a visible label, not an icon alone");
assert.match(readOnlyActionHtml, /<button(?=[^>]*class="rowMenuTrigger")(?=[^>]*disabled="")[^>]*>/);
const cancelledActionHtml = renderToStaticMarkup(React.createElement(orderRowActions.RentalOrderRowActions, { order: { ...data, status: "cancelled" }, permissions: allOrderPermissions, navigate() {}, t: text => text }));
assert.match(cancelledActionHtml, /<button(?=[^>]*class="rowMenuTrigger")(?=[^>]*disabled="")[^>]*>/, "cancelled orders have no duplicate details menu");
assert.equal((cancelledActionHtml.match(/>查看详情<\/button>/g) || []).length, 1);
assert.equal(actionProps.menuIcons, true, 'orders explicitly opt into semantic menu icons');
const menuForInspection = rowActionIntegration.DataTableRowActions({ ...actionProps, menuIcons: false }).props.children[1];
const menuContent = menuForInspection.props.children[1].props.children;
const menuEntries = menuContent.props.children.map(fragment => fragment.props.children[1]);
assert.equal(menuContent.props.className, "rowMenu");
assert.equal(menuContent.props.sideOffset, 4);
assert.deepEqual(menuEntries.map(item => React.Children.toArray(item.props.children)), actionProps.actions.filter(item => item.id !== actionProps.primary.id).map(item => [item.label]), "default menus remain text-only without repeated primary or details");
const iconMenu = rowActionIntegration.DataTableRowActions({ ...actionProps, menuIcons: true }).props.children[1].props.children[1].props.children;
const iconEntries = iconMenu.props.children.map(fragment => fragment.props.children[1]);
for (let index = 0; index < iconEntries.length; index++) {
  const children = React.Children.toArray(iconEntries[index].props.children);
  const expected = actionProps.actions.filter(action => action.id !== actionProps.primary.id)[index];
  assert.equal(children[0].type, expected.icon, 'menu glyph uses the operation semantic icon');
  assert.equal(children[0].props['aria-hidden'], 'true');
  assert.equal(children[1], expected.label);
  assert.equal(iconEntries[index].props.onSelect, expected.onSelect, 'adding an icon must preserve the real navigation callback');
}
assert.match(fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/features/rental-core/RentalOrderRowActions.tsx'), 'utf8'), /<DataTableRowActions menuIcons/);
const noticeSource = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/features/rental-core/OrderQuickActionNotice.tsx"), "utf8");
assert.doesNotMatch(noticeSource, /\.click\(|mutate|rentalCoreApi|fetch\(/, "locating an operation must not execute it");
assert.match(noticeSource, /button\?\.disabled \? container/);
assert.match(noticeSource, /prefers-reduced-motion/);
const pageCss = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/features/rental-core/RentalOrdersPage.module.css"), "utf8");
const { translateAdminText } = load("apps/admin/src/app/locale.tsx");
const zhCopy = (text, values) => translateAdminText(text, "zh-CN", values);
const enCopy = (text, values) => translateAdminText(text, "en-US", values);
// A page needs a name, not a mandatory explanatory sentence or duplicate list title.
const { PageHeader } = load("apps/admin/src/components/PageHeader.tsx", {
  "@ant-design/icons": { InfoCircleOutlined: () => null },
  "antd": { Space: ({ children }) => React.createElement("div", null, children), Popover: ({ children }) => children },
  "@/components/ui": { Button: ({ children, ...props }) => React.createElement("button", props, children) },
  "react-router-dom": { useLocation: () => ({ pathname: "/rental/services" }) },
  "@/app/navigation": { findRouteByPath: () => ({}) },
  "@/app/branding": { resolveAdminBrandName: () => "Rental OS" },
  "@/features/auth/authStore": { useAuthStore: selector => selector({}) },
  "@/app/locale": { useLocale: () => ({ t: enCopy, locale: "en-US" }) },
});
const minimalHeader = renderToStaticMarkup(React.createElement(PageHeader, { title: "增值服务" }));
assert.match(minimalHeader, /<h1 class="page-title">Add-ons<\/h1>/);
assert.doesNotMatch(minimalHeader, /page-subtitle|undefined|null|data-description/);
const scopedHeader = renderToStaticMarkup(React.createElement(PageHeader, { title: "个人会员管理", description: "会员资料在租户内共享；状态变更影响全部空间。" }));
assert.match(scopedHeader, /Member records and status changes apply across all workspaces/);
assert.match(scopedHeader, /class="page-context" role="note"/);
assert.doesNotMatch(scopedHeader, /page-subtitle/, "business scope stays visible without a second title row");
const commercialSource = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/features/commercial/RentalCommercialPage.tsx"), "utf8");
assert.doesNotMatch(commercialSource, /className="context-note"|t\("增值服务及保障"\)|t\("自动优惠方案"\)/);
assert.match(commercialSource, /已有价格须通过调价计划变更/);
assert.equal(enCopy("新增服务"), "Add service");
const definitions = orderColumns.rentalOrderColumns({ t: zhCopy, now: clock, labels: {}, navigate() {}, permissions: allOrderPermissions });
// The approved layout changes presentation only: the same server fields,
// selection, original source motion and real actions remain connected.
assert.match(orderPageSource, /createdAt: false/);
const defaultVisibility = { createdAt: false, quoteNo: false, security: false, allocations: false, fulfillment: false };
const layoutTable = createTable({ ...options, data: [data], columns: definitions,
  state: { ...options.state, columnVisibility: defaultVisibility, columnPinning: { left: [], right: ['actions'] } } });
assert.deepEqual(layoutTable.getVisibleLeafColumns().map(column => column.id), ['orderNo', 'customerName', 'items', 'startAt', 'endAt', 'payableAmount', 'status', 'actions']);
assert.equal(layoutTable.getTotalSize(), 1375, 'reallocate the action-column space without widening the default business columns');
assert.equal(layoutTable.getColumn('actions').getSize(), 168);
assert.equal(layoutTable.getColumn('createdAt').getCanSort(), true);
assert.equal(layoutTable.getColumn('createdAt').getCanHide(), true);
layoutTable.setOptions(previous => ({ ...previous, state: { ...previous.state, columnVisibility: { ...defaultVisibility, createdAt: true } } }));
assert.ok(layoutTable.getVisibleLeafColumns().some(column => column.id === 'createdAt'));
const originalCreatedAt = '2026-10-15T10:23:00Z';
const orderIdHtml = renderToStaticMarkup(definitions.find(column => column.id === 'orderNo').cell({ row: { original: { ...data, createdAt: originalCreatedAt } } }));
assert.doesNotMatch(orderIdHtml, /创建|10-15/);
const createdAtHtml = renderToStaticMarkup(definitions.find(column => column.id === 'createdAt').cell({ row: { original: { ...data, createdAt: originalCreatedAt } } }));
assert.match(createdAtHtml, /dateTime="2026-10-15T10:23:00Z"/);
for (const createdAt of [undefined, null, '', 'bad-time']) {
  assert.match(renderToStaticMarkup(definitions.find(column => column.id === 'createdAt').cell({ row: { original: { ...data, createdAt } } })), /—/);
}
assert.equal(metricValues.get('--rental-control-height-filter'), '36px');
assert.match(orderPageSource, /<DataTableToolbar[\s\S]*?controls=\{<>/, "orders use the same single-row filter bar as other lists");
assert.ok(orderPageSource.indexOf('<Segmented aria-label={t("分配进度")}') < orderPageSource.indexOf('<SearchField label={t("搜索订单")}'), "category tabs precede the keyword field");
assert.doesNotMatch(pageCss, /\.(queryControls|tableOptions|viewRow)\s*\{/, "page-local filter rails no longer duplicate the shared toolbar");
const filterBarSource = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/components/ui/ListFilterBar.tsx"), "utf8");
const ViewTabs = () => null, Criterion = () => null;
const { splitListControls } = load("apps/admin/src/components/ui/ListFilterBar.tsx", {
  "lucide-react": {}, "@/registry/components/popover/popover": {}, "@/app/designTokens": {}, "@/app/locale": {},
  "./Button": {}, "./SearchField": {}, "./Segmented": {}, "./Tabs": { Tabs: ViewTabs },
  "./ListFilters": {}, "./listFilterLayout": {}, "./data-table/DataTable.module.css": {},
});
const mixedControls = splitListControls(React.createElement(React.Fragment, null,
  React.createElement(ViewTabs, { activeKey: "stock" }),
  React.createElement(React.Fragment, null, React.createElement(Criterion, { value: "camera" }))));
assert.equal(mixedControls.navigation.length, 1, "view navigation remains outside responsive More filters");
assert.equal(mixedControls.navigation[0].props.activeKey, "stock", "separating navigation preserves the selected view");
assert.equal(mixedControls.filters.length, 1);
assert.equal(mixedControls.filters[0].type, Criterion);
assert.equal(mixedControls.filters[0].props.value, "camera", "separating navigation preserves existing query values");
assert.match(filterBarSource, /PopoverContent[^>]*side="bottom"[^>]*align="start"/, "extra criteria use an anchored panel, not a modal");
assert.match(filterBarSource, /ownsPopupTarget/, "nested field popups stay associated with their owning filter panel");
assert.match(filterBarSource, /activeCount = collapsed.filter/, "the trigger reflects active hidden criteria");
const { planListFilters } = load("apps/admin/src/components/ui/listFilterLayout.ts");
const filterGeometry = { available: 2000, category: 468, categoryMin: 160, search: 320, searchMin: 240,
  fieldWidths: [288, 192, 320], preferFirst: true, actions: [], resets: [84], gap: 8, moreWidth: 106, collapsedCategory: false };
assert.deepEqual(planListFilters(filterGeometry), { count: 3, category: 468, search: 320, more: false }, "a roomy row exposes all criteria instead of hiding them by default");
assert.equal(planListFilters({ ...filterGeometry, available: 1350 }).count, 2);
assert.equal(planListFilters({ ...filterGeometry, available: 960 }).count, 1, "date remains the first visible criterion at intermediate widths");
assert.equal(planListFilters({ ...filterGeometry, available: 700 }).count, 0);
assert.equal(planListFilters({ ...filterGeometry, available: 600, category: 0, categoryMin: 0, fieldWidths: [192, 192], preferFirst: false, resets: [] }).count, 1, "criteria collapse from the end one at a time");
assert.equal(planListFilters({ ...filterGeometry, available: 450, category: 240, categoryMin: 160, searchMin: 96, fieldWidths: [], resets: [] }).more, false, "category plus keyword must not create an empty More panel");
assert.match(orderPageSource, /className=\{styles.feeToggle\}/);
assert.match(fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx'), 'utf8'), /key: "createdAt", label: t\("创建时间"\)/);
for (const id of ["status", "payableAmount", "actions"]) {
  const primaryCell = definitions.find(column => column.id === id);
  const markup = renderToStaticMarkup(primaryCell.cell({ row: { original: data } }));
  assert.match(markup, /^<span class="leading">|^<div class="cellStack"><span class="leading">/, `${id} keeps its internal leading slot independently of whole-cell alignment`);
}
const tableCss = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/components/ui/data-table/DataTable.module.css"), "utf8");
// Alignment is explicit column metadata, not a global middle rule or a stretched
// motion wrapper. Real rendered td attributes must track the record's content.
assert.match(tableCss, /\.table tbody td\[data-cell-align="middle"\] \{ vertical-align: middle; \}/);
assert.match(tableCss, /\.table th, \.table td \{[^}]*vertical-align: top/);
assert.match(tableCss, /\.toolbar \{[^}]*--rental-control-height-toolbar: var\(--rental-control-height-filter\)/, "shared toolbar, not an order-only copy, owns filter height");
assert.match(tableCss, /\.toolbar \{[^}]*align-items: flex-start/, "filters stay aligned with the table tools");
assert.match(tableCss, /\.toolbarFilters \{[^}]*flex: 1 1 0;[^}]*min-width: 0/, "filters use the room left by the tools instead of reserving a second row");
assert.match(tableCss, /\.filterBar \{[^}]*height: var\(--rental-control-height-filter\)/, "the query bar remains a single shared-height row");
assert.match(tableCss, /\.listSection \{[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none/, "list grouping has no duplicate card shell");
assert.doesNotMatch(pageCss, /\.refreshControl\s*\{/);
assert.match(tableCss, /\.viewTrigger \{[^}]*height: var\(--rental-control-height-toolbar\);[^}]*min-height: var\(--rental-control-height-toolbar\)/);
assert.doesNotMatch(pageCss, /\.tableOptions[^}]*height: \d+px/, 'tools inherit the existing filter token rather than adding another magic number');
function renderAlignedOrder(order, animated = false) {
  const alignmentTable = createTable({ ...options, data: [order], columns: definitions,
    state: { ...options.state, columnVisibility: defaultVisibility, columnPinning: { left: [], right: ['actions'] } } });
  return renderToStaticMarkup(React.createElement(DataTable, { table: alignmentTable, caption: '订单', empty: '无记录', animated }));
}
function renderedCell(markup, id) {
  const cell = markup.match(new RegExp(`<td(?=[^>]*data-column-id="${id}")[^>]*>[\\s\\S]*?<\\/td>`));
  assert.ok(cell, `real td for ${id} is rendered`);
  return cell[0];
}
const ordinaryAlignedOrder = { ...data, status: 'cancelled', membershipSnapshot: { personalCustomerName: '李宁', personalCustomerId: 'member-1' }, lines: [{ id: 'i1', itemGroupName: '相机', quantity: 1 }] };
for (const animated of [false, true]) {
  const markup = renderAlignedOrder(ordinaryAlignedOrder, animated);
  for (const id of ['orderNo', 'customerName', 'startAt', 'payableAmount', 'status', 'actions']) {
    assert.match(renderedCell(markup, id), /data-cell-align="middle"/, `${id} centers in the complete row even through the unchanged motion renderer`);
  }
  assert.match(renderedCell(markup, 'items'), /data-cell-align="top"/, 'name plus quantity remains a top-aligned multi-line group');
  assert.doesNotMatch(renderedCell(markup, 'endAt'), /data-cell-align="middle"/, 'return time plus duration keeps its internal top alignment');
  assert.match(renderedCell(markup, 'actions'), /position:sticky/, 'vertical alignment must not remove the pinned action column');
}
const detailedAlignedOrder = { ...ordinaryAlignedOrder, status: 'ready_for_pickup', membershipSnapshot: { ...ordinaryAlignedOrder.membershipSnapshot, corporateCustomerName: '山海影业' }, assignment: { issue: 'allocation_conflict' }, feeReviews: [{ status: 'pending' }] };
const detailedAlignedMarkup = renderAlignedOrder(detailedAlignedOrder, true);
for (const id of ['customerName', 'startAt', 'status']) assert.match(renderedCell(detailedAlignedMarkup, id), /data-cell-align="top"/, `${id} with real secondary information remains top-aligned`);
assert.match(renderedCell(detailedAlignedMarkup, 'status'), /待人工处理/);
assert.match(renderedCell(detailedAlignedMarkup, 'status'), /待裁定费用/);
assert.match(renderedCell(detailedAlignedMarkup, 'startAt'), /到时未取/);
assert.match(renderedCell(renderAlignedOrder({ ...ordinaryAlignedOrder, membershipSnapshot: undefined }), 'customerName'), /data-cell-align="top"/, 'legacy customer notes are not mistaken for single-name cells');
const defaultAlignmentTable = createTable({ ...options, columns: [{ id: 'id', accessorKey: 'id' }] });
const defaultAlignmentMarkup = renderToStaticMarkup(React.createElement(DataTable, { table: defaultAlignmentTable, caption: '其他页面', empty: '无记录' }));
assert.doesNotMatch(defaultAlignmentMarkup, /data-cell-align=/, 'other consumers retain the default until they explicitly opt in');
assert.match(tableCss, /\.leading \{[^}]*align-items: center;[^}]*min-height: var\(--rental-table-leading-height\)/);
assert.match(tableCss, /\.rowPrimary \{[^}]*min-height: var\(--rental-table-leading-height\) !important;[^}]*padding: 0 !important/);
assert.doesNotMatch(tableCss, /rowActionPeek|\.rowActions\[data-menu-open\]/, "do not keep abandoned hover expansion styles");
assert.match(tableCss, /\.rowActions \{[^}]*justify-content: flex-start;[^}]*gap: var\(--space-2\);[^}]*width: fit-content/);
assert.doesNotMatch(tableCss.match(/\.rowPrimary \{[^}]*\}/)[0], /margin[^;]*auto|flex-grow/, "same-column actions must not be pushed apart");
assert.match(tableCss, /\.rowMenuTrigger \{[^}]*width: var\(--rental-control-height-toolbar\);[^}]*padding: 0;[^}]*background: transparent/);
assert.match(tableCss, /\.rowMenuTrigger\[data-state="open"\] \{ background: var\(--surface-muted\)/);
assert.match(tableCss, /\.rowMenuTrigger:disabled \{[^}]*opacity: \.5;[^}]*cursor: not-allowed/);
assert.match(tableCss, /\.rowMenu\[data-state="open"\] \{ animation: rowMenuIn 100ms ease/);
assert.match(tableCss, /\.rowMenu\[data-state="closed"\] \{[^}]*rowMenuOut 100ms ease/);
assert.match(tableCss, /\.rowMenu\[data-side="bottom"\] \{ --row-menu-y: -\.5rem/);
assert.match(tableCss, /@keyframes rowMenuIn[^\n]*scale\(\.95\)/);
assert.match(tableCss, /\.statusPill\[data-tinted\] \{[^}]*12%[^}]*border-color:[^}]*38%/);
assert.match(tableCss, /\.statusPill\[data-variant="soft"\] \{[^}]*height: var\(--rental-table-status-height\);[^}]*border: 0;[^}]*border-radius: min\(var\(--rental-ui-radius-container\), var\(--rental-table-status-radius-max\)\);[^}]*color: var\(--table-status-color\);[^}]*8%/);
assert.match(tableCss, /\.root\[data-compact-header\] \{ --table-header-height: var\(--rental-table-compact-header-height\); \}/);
assert.match(tableCss, /\.root\[data-compact-header\] \.table thead th \{[^}]*padding-block: 0;[^}]*background: var\(--surface-muted\)/);
assert.match(tableCss, /\.rowMenuIcon \{[^}]*flex-shrink: 0;[^}]*color: var\(--text-muted\)/);
assert.match(orderPageSource, /<DataTable compactHeader/);
const compactMarkup = renderToStaticMarkup(React.createElement(DataTable, { table, caption: '订单', empty: '无记录', compactHeader: true }));
assert.match(compactMarkup, /data-compact-header="true"/);
assert.doesNotMatch(refreshing, /data-compact-header/, 'new header appearance is opt-in, not a migration of other tables');
const itemsColumn = definitions.find(column => column.id === "items");
const multiItemOrder = { ...data, lines: [
  { id: "i1", itemGroupName: "全画幅相机机身", quantity: 2 },
  { id: "i2", itemGroupName: "长名称镜头与附件套装", quantity: 1 },
  { id: "i3", itemGroupName: "三脚架", quantity: 3 },
  { id: "i4", itemGroupName: "<镜头袋>", quantity: 0 },
] };
let itemTable;
itemTable = createTable({
  data: [multiItemOrder], columns: definitions, getRowId: row => row.id, getCoreRowModel: getCoreRowModel(),
  getRowCanExpand: row => row.original.lines.length > 1, autoResetExpanded: false,
  state: { ...options.state, expanded: {} },
  onExpandedChange: updater => itemTable.setOptions(previous => ({ ...previous, state: { ...previous.state,
    expanded: typeof updater === "function" ? updater(previous.state.expanded) : updater } })),
});
const itemElement = () => itemsColumn.cell({ row: itemTable.getRowModel().rows[0] });
const itemsHtml = renderToStaticMarkup(itemElement());
assert.equal((itemsHtml.match(/class="itemLine"/g) ?? []).length, 3, "only the remaining items belong to the expandable list");
assert.match(itemsHtml, /^<div class="cellStack"><span class="leading"><span class="itemName">全画幅相机机身<\/span>/);
assert.match(itemsHtml, /class="itemMeta"><span class="itemQuantity">数量 × 2<\/span><button[^>]*aria-expanded="false"/);
assert.match(itemsHtml, />另 3 项<svg/);
assert.match(itemsHtml, /class="itemList" hidden=""/);
assert.match(itemsHtml, /class="itemName">三脚架<\/span><span class="itemQuantity">数量 × 3<\/span>/);
assert.match(itemsHtml, /&lt;镜头袋&gt;/);
assert.match(itemsHtml, /数量 × 0/);
const disclosedId = itemsHtml.match(/aria-controls="([^"]+)"/)[1];
assert.ok(itemsHtml.includes(`id="${disclosedId}"`));
const itemMotionFingerprint = itemsColumn.meta.motion.value(multiItemOrder);
itemElement().props.onToggle();
assert.equal(itemTable.getRowModel().rows[0].getIsExpanded(), true);
const expandedItemsHtml = renderToStaticMarkup(itemElement());
assert.match(expandedItemsHtml, /aria-expanded="true"/);
assert.match(expandedItemsHtml, />收起<svg/);
assert.doesNotMatch(expandedItemsHtml, /hidden=""/);
assert.equal(itemsColumn.meta.motion.value(multiItemOrder), itemMotionFingerprint, "disclosure is not a business-data change");
itemTable.setOptions(previous => ({ ...previous, columns: [...definitions] }));
assert.equal(itemTable.getRowModel().rows[0].getIsExpanded(), true, "column recomposition must not reset item disclosure");
itemElement().props.onToggle();
assert.equal(itemTable.getRowModel().rows[0].getIsExpanded(), false);
itemElement().props.onToggle();
itemTable.resetExpanded(true);
assert.equal(itemTable.getRowModel().rows[0].getIsExpanded(), false, "identity scope reset clears the item expansion map");
const itemRow = order => ({ original: order, getIsExpanded: () => false, toggleExpanded() {} });
const noItemsHtml = renderToStaticMarkup(itemsColumn.cell({ row: itemRow(data) }));
assert.match(noItemsHtml, /—/);
assert.doesNotMatch(noItemsHtml, /数量 ×/);
// Identity summaries use only order snapshots, without repeated ordinary labels
// or fake product images; they must not acquire catalogue/customer access.
const customerColumn = definitions.find(column => column.id === "customerName");
const customerHtml = order => renderToStaticMarkup(customerColumn.cell({ row: { original: order } }));
const personal = { ...data, customerId: "member-1", customerType: "personal", customerName: "李宁", membershipSnapshot: { personalCustomerId: "member-1", personalCustomerName: "李宁" } };
const personalHtml = customerHtml(personal);
assert.match(personalHtml, /class="customerMark" data-tone="[1-4]" aria-hidden="true">李宁/);
assert.match(personalHtml, /class="customerName">李宁/);
assert.doesNotMatch(personalHtml, /lucide-user-round|个人会员|旧客户记录|<img/);
assert.equal(customerHtml(personal), personalHtml, "identity color must not be random on each render");
assert.match(customerHtml({ ...personal, membershipSnapshot: { ...personal.membershipSnapshot, personalCustomerName: "Emma Collins" } }), /aria-hidden="true">EC/);
assert.match(customerHtml({ ...data, customerName: "😀张三" }), /aria-hidden="true">张三/);
const enterpriseHtml = customerHtml({ ...personal, customerName: "当前主档名不应覆盖快照", membershipSnapshot: { ...personal.membershipSnapshot, corporateCustomerName: "山海影业", enterpriseContractAndPayer: true } });
assert.match(enterpriseHtml, /lucide-building-2/);
assert.match(enterpriseHtml, /山海影业/);
assert.match(enterpriseHtml, /企业签约付款/);
assert.doesNotMatch(enterpriseHtml, /当前主档名不应覆盖快照|data-corporate="true"/, "enterprise employees retain their personal identity alongside the company relation");
assert.match(customerHtml({ ...personal, membershipSnapshot: { ...personal.membershipSnapshot, corporateCustomerName: "山海影业", enterpriseContractAndPayer: false } }), /企业权益/);
const legacyCorporate = customerHtml({ ...data, customerType: "corporate", customerName: "山海影业" });
assert.match(legacyCorporate, /data-corporate="true"/);
assert.match(legacyCorporate, /lucide-building-2/);
assert.match(legacyCorporate, /旧客户记录/);
assert.doesNotMatch(legacyCorporate, /企业签约付款|企业权益/, "legacy company records cannot invent membership or payer facts");
assert.match(customerHtml({ ...data, customerName: " " }), /class="customerName">—/);
assert.match(customerHtml({ ...data, customerName: "<客户>" }), /&lt;客户&gt;/);
for (const categoryCode of ["camera", "camping", "vehicle", "construction", "__proto__"]) {
  const html = renderToStaticMarkup(itemsColumn.cell({ row: itemRow({ ...data, categoryCode, lines: [{ id: "line", itemGroupName: "历史商品名称", quantity: 1 }] }) }));
  assert.match(html, /历史商品名称/);
  assert.match(html, /数量 × 1/);
  assert.doesNotMatch(html, /itemMark|品类图标|<svg|aria-expanded/, "single-item summaries have no repeated category tile or needless disclosure");
  assert.doesNotMatch(html, /<img|(?:src|href)="https?:/, "fallback marks are not invented product photos or external images");
}
const columnsSource = fs.readFileSync(path.resolve(__dirname, "../apps/admin/src/features/rental-core/rentalOrderColumns.tsx"), "utf8");
assert.doesNotMatch(columnsSource, /useQuery|rentalCoreApi|customerApi|fetch\(|Math\.random\(/);
for (const id of ["orderNo", "startAt", "endAt"]) {
  const html = renderToStaticMarkup(definitions.find(column => column.id === id).cell({ row: { original: data } }));
  assert.match(html, /^<div class="cellStack"><span class="leading">/, `${id} aligns with the existing primary status/amount/actions slot`);
}
const pickupHtml = renderToStaticMarkup(definitions.find(column => column.id === "startAt").cell({ row: { original: data } }));
assert.match(pickupHtml, /<time dateTime="2026-10-16T01:00:00Z" class="plannedDate"><span>2026-10-16<\/span><span class="plannedClock">\d{2}:00<\/span>/);
assert.match(pickupHtml, /class="timingNotice" data-tone="warning".*lucide-clock-alert.*到时未取/s);
const longPickupHtml = renderToStaticMarkup(orderColumns.rentalOrderColumns({ t: text => text, now: Date.parse(base.startAt) + (3 * 1440 + 8 * 60 + 54) * 60000, labels: {}, navigate() {}, permissions: allOrderPermissions }).find(column => column.id === "startAt").cell({ row: { original: data } }));
assert.match(longPickupHtml, /class="duration" title="3 天 8 小时 54 分钟" aria-label="3 天 8 小时 54 分钟">3天8时<\/span>/);
// Native, compact copy uses the actual shared dictionary. Unknown business
// names stay unchanged; counts are complete messages, not Chinese fragments.
assert.equal(enCopy("租赁交易"), "Rentals");
assert.equal(enCopy("器材资产与库存"), "Assets & stock");
assert.equal(enCopy("只看有待审费用的订单"), "Fee review only");
assert.equal(enCopy("{count} 张待裁定", { count: 0 }), "0 to review");
assert.equal(enCopy("共 1 单", { count: 1 }), "1 order");
assert.equal(enCopy("共 {count} 单", { count: 22 }), "22 orders");
assert.equal(enCopy("未知客户名称"), "未知客户名称");
for (const key of ["constructor", "__proto__", "toString"]) assert.equal(enCopy(key), key);
assert.equal(zhCopy("另 {count} 项", { count: 3 }), "另 3 项");
assert.equal(enCopy("另 {count} 项", { count: "$&{other}" }), "+$&{other} more", "values are substituted once, never executed or recursively translated");
const englishDefinitions = orderColumns.rentalOrderColumns({ t: enCopy, locale: "en-US", now: Date.parse(base.startAt) + (3 * 1440 + 8 * 60 + 54) * 60000, labels: {}, navigate() {}, permissions: allOrderPermissions });
const englishPickup = renderToStaticMarkup(englishDefinitions.find(column => column.id === "startAt").cell({ row: { original: data } }));
assert.match(englishPickup, /title="3 days 8 hours 54 minutes" aria-label="3 days 8 hours 54 minutes">3d 8h<\/span>/);
const englishSingular = orderColumns.rentalOrderColumns({ t: enCopy, locale: "en-US", now: Date.parse(base.startAt) + 1501 * 60000, labels: {}, navigate() {}, permissions: allOrderPermissions });
assert.match(renderToStaticMarkup(englishSingular.find(column => column.id === "startAt").cell({ row: { original: data } })), /title="1 day 1 hour 1 minute"/);
assert.match(renderToStaticMarkup(englishDefinitions.find(column => column.id === "items").cell({ row: itemRow(multiItemOrder) })), />\+3 more<svg/);
const englishAction = orderRowActions.RentalOrderRowActions({ order: { ...data, status: "ready_for_pickup" }, permissions: allOrderPermissions, pickupLabel: "取机", t: enCopy, navigate() {} });
assert.equal(englishAction.props.primary.label, "Check out");
assert.match(pageCss, /\.duration \{[^}]*white-space: nowrap/);
assert.match(pageCss, /\.timingNotice > span \{ white-space: nowrap/);
assert.match(pageCss, /\.itemList\[hidden\] \{ display: none/);
assert.doesNotMatch(pageCss, /\.itemMark|\.moreItems \{|height: [\d.]+px/);
assert.match(orderPageSource, /getRowCanExpand: row => row.original.lines.length > 1, autoResetExpanded: false/);
assert.match(orderPageSource, /table.resetExpanded\(true\).*selectionScope, table/);
assert.equal(metricValues.get("--rental-table-identity-size"), "32px");
assert.equal(metricValues.get("--rental-table-identity-icon-size"), "16px");
assert.equal(metricValues.get("--rental-table-identity-radius-max"), "8px");
for (let tone = 1; tone <= 4; tone++) assert.match(metricValues.get(`--rental-table-identity-${tone}`), new RegExp(`var\\(--series-${tone}\\).*var\\(--foreground\\)`));
assert.match(pageCss, /\.customerMark\[data-corporate\] \{ border-radius: min\(var\(--rental-ui-radius-container\), var\(--rental-table-identity-radius-max\)\)/);
assert.match(pageCss, /\.customerMark \{[^}]*border-radius: var\(--rental-ui-radius-pill\)/);
assert.match(pageCss, /\.orderLink \{[^}]*font-weight: var\(--rental-typography-body-weight\)/);
const laterDefinitions = orderColumns.rentalOrderColumns({ t: text => `EN ${text}`, now: clock + 60000, labels: {}, navigate() {}, permissions: allOrderPermissions });
for (const definition of definitions.filter(column => column.meta?.motion)) {
  assert.equal(definition.meta.motion.value(data), laterDefinitions.find(column => column.id === definition.id).meta.motion.value(data), "locale and reminder clock must not pulse unchanged facts");
}
assert.equal(orderColumns.orderStatusTone("completed"), "success");
assert.equal(orderColumns.orderStatusTone("cancelled"), "neutral");
assert.equal(orderColumns.orderStatusTone("pickup_overdue"), "warning");
assert.equal(orderColumns.orderStatusTone("renting"), "active");
assert.notEqual(orderColumns.orderStatusIcon("completed"), orderColumns.orderStatusIcon("cancelled"));
assert.notEqual(orderColumns.orderStatusIcon("reserved"), orderColumns.orderStatusIcon("renting"));
assert.notEqual(orderColumns.orderStatusIcon("pickup_overdue"), orderColumns.orderStatusIcon("return_inspection"));
for (const [status, iconClass] of [["completed", "circle-check"], ["cancelled", "circle-x"], ["reserved", "calendar-check"], ["renting", "timer"], ["return_inspection", "clipboard-check"], ["settling", "wallet"], ["no_show", "user"]]) {
  const markup = renderToStaticMarkup(definitions.find(column => column.id === "status").cell({ row: { original: { ...data, status } } }));
  assert.match(markup, new RegExp("lucide-" + iconClass));
  assert.match(markup, /data-variant="soft"/);
  assert.match(markup, /data-tinted="true"/, "all order status badges retain semantic backgrounds, including neutral cancelled");
}
const allocationMarkup = renderToStaticMarkup(definitions.find(column => column.id === "status").cell({ row: { original: data } }));
assert.match(allocationMarkup, /lucide-layers/);
assert.match(allocationMarkup, /待分配/);
assert.match(allocationMarkup, /class="statusNote" data-slot="table-note" data-tone="neutral"/);
assert.equal((allocationMarkup.match(/data-slot="badge"/g) ?? []).length, 1, 'only the primary order lifecycle is a badge');
const statusCellMarkup = order => renderToStaticMarkup(definitions.find(column => column.id === 'status').cell({ row: { original: order } }));
const pendingFeeMarkup = statusCellMarkup({ ...data, status: 'no_show', feeReviews: [{ status: 'pending' }] });
assert.match(pendingFeeMarkup, /data-slot="table-note" data-tone="warning".*待裁定费用/);
assert.equal((pendingFeeMarkup.match(/data-slot="badge"/g) ?? []).length, 1);
const issueMarkup = statusCellMarkup({ ...data, assignment: { issue: 'allocation_conflict' } });
assert.match(issueMarkup, /data-slot="table-note" data-tone="warning".*待人工处理/);
for (const status of ['renting', 'pickup_overdue', 'no_show']) {
  assert.match(statusCellMarkup({ ...data, status, assignment: { issue: 'allocation_conflict' } }), /data-tone="warning".*待人工处理/s, 'an existing allocation exception is never hidden behind the lifecycle status');
}
const lockedMarkup = statusCellMarkup({ ...data, status: 'ready_for_pickup', reservations: [{ quantity: 1, releasedQuantity: 0, status: 'active' }], allocations: [{ status: 'locked', quantity: 1 }] });
assert.match(lockedMarkup, /class="secondary">已锁定/);
assert.doesNotMatch(lockedMarkup, /lucide-lock-keyhole/, 'ordinary successful locking is quiet text, not another icon competing with the main state');
const renewedOrder = { ...data, status: 'renting', effectiveEndAt: '2026-10-19T05:20:00Z', allocations: [{ status: 'picked_up', quantity: 1 }] };
const renewedHtml = renderToStaticMarkup(definitions.find(column => column.id === 'endAt').cell({ row: { original: renewedOrder } }));
assert.match(renewedHtml, /dateTime="2026-10-19T05:20:00Z"/);
assert.match(renewedHtml, /data-tooltip="已续租，原 2026-10-17/);
assert.match(renewedHtml, /tabindex="0" aria-label="已续租，原 [^"]+">已续租/);
assert.doesNotMatch(renewedHtml, /class="secondary">已续租，原 /, 'the old timestamp remains accessible on demand, not a repeated third line');
const overdueRenewal = orderColumns.rentalOrderColumns({ t: text => text, now: Date.parse(renewedOrder.effectiveEndAt) + 60000, labels: {}, navigate() {}, permissions: allOrderPermissions }).find(column => column.id === 'endAt');
const overdueRenewalHtml = renderToStaticMarkup(overdueRenewal.cell({ row: { original: renewedOrder } }));
assert.match(overdueRenewalHtml, /class="timingNotice" data-tone="danger".*逾期未还/s);
assert.match(overdueRenewalHtml, /tabindex="0"[^>]*>已续租/);
for (const status of ['approved', 'rejected']) assert.doesNotMatch(statusCellMarkup({ ...data, feeReviews: [{ status }] }), /待裁定费用/);
const noteStyle = tableCss.match(/\.statusNote \{([^}]+)\}/)[1];
assert.doesNotMatch(noteStyle, /background|border|padding|font-weight/, 'annotations must not recreate the primary badge appearance');
assert.match(noteStyle, /color: var\(--text-muted\)/);
assert.match(tableCss, /\.statusNote\[data-tone="warning"\] \{ color: var\(--warning\); \}/);
assert.equal(orderColumns.orderStatusIcon("unknown"), orderColumns.orderStatusIcon("__proto__"));
const amountMotion = definitions.find(column => column.id === "payableAmount").meta.motion;
assert.equal(amountMotion.value({ ...data, payableAmount: undefined }), null);
assert.equal(amountMotion.value({ ...data, payableAmount: Number.NaN }), null);
assert.notEqual(amountMotion.context(data), amountMotion.context({ ...data, currency: "USD" }));
// The visible morph path must use the same currency/amount hierarchy as a static
// cell; styling only children would affect the screen-reader copy, not the UI.
const amountColumn = definitions.find(column => column.id === "payableAmount");
const amountCell = order => amountColumn.cell({ row: { original: order } });
const moneyOrder = { ...data, payableAmount: 1288.77 };
const staticMoney = renderToStaticMarkup(amountCell(moneyOrder));
assert.match(staticMoney, /class="moneyCurrency">¥<\/span><span class="moneyValue">1,288\.77<\/span>/);
assert.match(staticMoney, /^<span class="leading">/);
for (const currency of ["CNY", "HKD", "MOP", "TWD", "SGD", "USD", "EUR", "XYZ"]) {
  for (const payableAmount of [0, 12.3, -12.3, 9999999.99]) {
    const order = { ...data, currency, payableAmount };
    const formatted = amountMotion.format(payableAmount, order);
    const markup = renderToStaticMarkup(amountCell(order));
    assert.equal(markup.replace(/<[^>]*>/g, ""), formatted, "currency, sign order, grouping and exact cents remain canonical");
    assert.equal(renderToStaticMarkup(amountMotion.renderNumber(formatted, order)), renderToStaticMarkup(React.createElement(DataTableMoney, { formatted })));
    assert.match(markup, /class="moneyCurrency"/);
    assert.match(markup, /class="moneyValue"/);
  }
}
for (const payableAmount of [undefined, null, NaN, Infinity, "12.30"]) {
  const markup = renderToStaticMarkup(amountCell({ ...data, payableAmount }));
  assert.match(markup, /class="moneyMissing">—<\/span>/);
  assert.doesNotMatch(markup, /0\.00|moneyValue|moneyCurrency/);
}
assert.match(renderToStaticMarkup(React.createElement(DataTableMoney, { formatted: "<coin> 12.30" })), /&lt;coin&gt;/);
const moneyTable = createTable({ data: [moneyOrder], columns: [amountColumn], getCoreRowModel: getCoreRowModel(), state: options.state });
const animatedMoney = renderToStaticMarkup(React.createElement(DataTable, { table: moneyTable, caption: "金额", empty: "无记录", animated: true }));
assert.match(animatedMoney, /class="leading" aria-hidden="true"><span class="money" data-slot="table-money"><span class="moneyCurrency">¥<\/span><span class="moneyValue">1,288\.77<\/span>/);
assert.match(animatedMoney, /class="srOnly"><span class="leading"><span class="money"/, "exact amount remains available separately to assistive technology");
for (const [paused, reduced] of [[false, false], [true, false], [false, true]]) {
  const midMotion = load("apps/admin/src/components/ui/data-table/DataTableMotion.tsx", {
    "motion/react": { ...require("motion/react"), useReducedMotion: () => reduced },
    "../../../../../../packages/ui-motiq/runtime/use-animated-number": { useAnimatedNumber: () => 321.09 },
    "@/app/locale": { useLocale: () => ({ t: text => text }) },
    "./DataTable.module.css": { __esModule: true, default: classes },
  });
  const html = renderToStaticMarkup(React.createElement(midMotion.DataTableCellMotion, {
    value: moneyOrder.payableAmount, format: value => amountMotion.format(value, moneyOrder),
    renderNumber: formatted => amountMotion.renderNumber(formatted, moneyOrder), paused,
  }, amountCell(moneyOrder)));
  const visible = html.match(/aria-hidden="true">([\s\S]*?)<span class="srOnly">/)[1];
  assert.match(visible, /moneyCurrency">¥/);
  assert.ok(visible.includes(`moneyValue">${paused || reduced ? "1,288.77" : "321.09"}`), "normal, paused and reduced-motion paths all retain the same amount hierarchy");
  assert.match(html, /class="srOnly">[\s\S]*moneyValue">1,288\.77/);
}
assert.match(tableCss, /\.moneyValue \{[^}]*color: var\(--foreground\);[^}]*font-size: var\(--rental-typography-table-money-size\);[^}]*font-weight: var\(--rental-typography-table-money-weight\)/);
assert.match(tableCss, /\.moneyCurrency \{[^}]*color: var\(--text-secondary\);[^}]*font-size: var\(--rental-typography-meta-size\);[^}]*font-weight: var\(--rental-typography-meta-weight\)/);
assert.equal(metricValues.get("--rental-typography-table-money-size"), "16px");
assert.equal(metricValues.get("--rental-typography-table-money-weight"), "600");
assert.doesNotMatch(pageCss, /\.money \{/);
// Shared legacy-column bridge: real TanStack models, no API/network/browser.
let businessView, businessTools, businessPager;
const listSections = load("apps/admin/src/components/ui/ListSection.tsx", {
  "./data-table/DataTable.module.css": { __esModule: true, default: classes },
});
const business = load("apps/admin/src/components/ui/Table.tsx", {
  "antd": { Table: () => React.createElement("div", { "data-compatibility": true }) },
  "@/app/locale": { useLocale: () => ({ t: text => text }) },
  "@/app/designTokens": loadingTokens,
  "./data-table/TableRefreshContext": { useTableRefresh: () => ({}) },
  "./ListSection": listSections,
  "./data-table/DataTable": {
    DataTable: props => { businessView = props; return React.createElement(DataTable, props); },
    DataTableColumnHeader: ({ label }) => React.createElement("span", null, label),
  },
  "./data-table/DataTableToolbar": { DataTableToolbar: props => { businessTools = props; return React.createElement("div", { "data-shared-tools": true },
    props.heading && React.createElement(listSections.ListSectionTitle, props.heading), props.heading?.extra); } },
  "./Pagination": { Pagination: props => { businessPager = props; return React.createElement("div", { "data-shared-pagination": true }); } },
  "./data-table/DataTable.module.css": { __esModule: true, default: classes },
});
assert.equal(business.readTableValue({ a: [{ b: 0 }] }, ["a", 0, "b"]), 0);
assert.equal(business.readTableValue({ a: null }, ["a", "b"]), undefined);
assert.equal(business.readTableValue(undefined, ["missing"]), undefined);
const wholeRecord = { name: "unchanged" };
assert.equal(business.readTableValue(wholeRecord, undefined), wholeRecord, "render-only columns receive the original record, as before");
assert.equal(business.isRemoteTablePage({ total: 0 }), true);
assert.equal(business.isRemoteTablePage({ pageSize: 20 }), false);
assert.equal(business.isRemoteTablePage(false), false);
const businessRows = [{ id: "b", amount: 2 }, { id: "a", amount: 1 }, { id: "c", amount: 3 }];
const renderedIndices = [];
const businessColumns = [
  { title: "ID", dataIndex: "id", fixed: "left" },
  { title: "金额", dataIndex: "amount", align: "right", render: (value, row, index) => { renderedIndices.push([row.id, index]); return value; } },
  { title: "操作", key: "actions", fixed: "right", render: (_, row) => React.createElement("button", null, row.id) },
];
const businessMarkup = renderToStaticMarkup(React.createElement(business.Table, { rowKey: "id", dataSource: businessRows, columns: businessColumns, pagination: { pageSize: 2 }, onRefresh: () => "reader" }));
assert.match(businessMarkup, /data-shared-tools/);
assert.match(businessMarkup, /data-shared-pagination/);
assert.match(businessMarkup, /data-compact-header="true"/);
assert.equal(businessTools.onRefresh(), "reader");
const filters = React.createElement("input", { "aria-label": "search-data" });
const sectionMarkup = renderToStaticMarkup(React.createElement(listSections.ListSection, { title: "List title", extra: React.createElement("button", null, "Create"), controls: filters },
  React.createElement(business.Table, { rowKey: "id", dataSource: businessRows, columns: businessColumns, pagination: false })));
assert.equal(businessTools.controls, filters, "filters flow into the same shared toolbar as table tools");
assert.match(sectionMarkup, /data-list-section/);
assert.match(sectionMarkup, /role="heading" aria-level="2">List title/);
assert.match(sectionMarkup, />Create<\/button>/);
assert.doesNotMatch(sectionMarkup, /ant-card|data-panel|workspace-panel/, "list grouping is not a second card frame");
assert.equal(businessTools.heading.title, "List title", "pure list headings automatically join their own tools");
assert.equal((sectionMarkup.match(/>List title</g) ?? []).length, 1, "automatic mode never duplicates the section heading");
const tableChild = React.createElement(business.Table, { rowKey: "id", columns: businessColumns, dataSource: businessRows });
const readyWrapper = Object.assign(({ children }) => children, { listSectionPassthrough: true });
assert.equal(listSections.startsWithListTable(React.createElement(readyWrapper, { loading: false }, tableChild)), true);
assert.equal(listSections.startsWithListTable(React.createElement(readyWrapper, { loading: true }, tableChild)), false, "loading branches retain the standalone heading");
assert.equal(listSections.startsWithListTable(React.createElement(readyWrapper, { error: new Error("unavailable") }, tableChild)), false, "failed queries must not lose their section label");
assert.equal(listSections.startsWithListTable([React.createElement("div", { key: "summary" }, "summary"), tableChild]), false, "composite sections keep their title before their summary");
assert.equal(listSections.startsWithListTable([tableChild, tableChild]), false, "one heading is not copied into multiple table toolbars");
// Restore the initial paged fixture for the paging assertions below.
renderedIndices.length = 0;
renderToStaticMarkup(React.createElement(business.Table, { rowKey: "id", dataSource: businessRows, columns: businessColumns, pagination: { pageSize: 2 } }));
assert.equal(businessPager.showSizeChanger, true);
assert.equal(businessPager.hideOnSinglePage, false);
assert.equal(businessPager.total, 3);
assert.deepEqual(businessView.table.getRowModel().rows.map(row => row.id), ["b", "a"]);
assert.deepEqual(renderedIndices, [["b", 0], ["a", 1]], "render callbacks keep source indices");
assert.equal(businessView.cellProps(businessView.table.getRowModel().rows[0].getVisibleCells()[1]).style.textAlign, "right");
assert.equal(businessView.table.getColumn("id").getIsPinned(), "left");
assert.equal(businessView.table.getColumn("actions").getIsPinned(), "right");
assert.equal(businessView.table.getColumn("actions").getCanSort(), false);
assert.equal(businessView.table.getColumn("id").getCanHide(), false, "at least one data column remains visible");
const sharedCellType = businessView.table.getColumn("amount").columnDef.cell;
businessView.table.setOptions(previous => ({ ...previous, state: { ...previous.state, sorting: [{ id: "amount", desc: true }] } }));
assert.deepEqual(businessView.table.getRowModel().rows.map(row => row.id), ["c", "b"], "complete data sorts before local pagination");
const businessCallbacks = [];
renderToStaticMarkup(React.createElement(business.Table, { rowKey: "id", dataSource: businessRows, columns: businessColumns,
  pagination: { current: 2, pageSize: 2, total: 8, onChange: (...args) => businessCallbacks.push(args) } }));
assert.deepEqual(businessView.table.getRowModel().rows.map(row => row.id), ["b", "a", "c"], "remote data must not be sliced again");
assert.equal(businessView.table.getColumn("amount").getCanSort(), false, "unsupported remote sorting is not faked on one page");
assert.equal(businessTools.sortDisabled, true);
businessPager.onChange(2, 50);
assert.deepEqual(businessCallbacks, [[1, 50]], "page-size change returns to page one exactly once");
assert.equal(businessView.table.getColumn("amount").columnDef.cell, sharedCellType, "page rerender does not replace editable cell component types");
let rowClick;
const expandedMarkup = renderToStaticMarkup(React.createElement(business.Table, { rowKey: "id", dataSource: businessRows, columns: businessColumns,
  pagination: false, expandable: { expandedRowKeys: ["b"], expandedRowRender: row => `details:${row.id}` },
  onRow: row => ({ onClick: () => { rowClick = row.id; } }), rowClassName: () => "existing-row-class" }));
assert.match(expandedMarkup, /details:b/);
assert.match(expandedMarkup, /existing-row-class/);
businessView.rowProps(businessView.table.getCoreRowModel().rows[0]).onClick({});
assert.equal(rowClick, "b");
assert.equal(businessView.footer, undefined, "explicitly unpaged detail tables stay unpaged");
assert.equal(businessView.table.getColumn("expand").getCanHide(), false);
assert.match(renderToStaticMarkup(React.createElement(business.Table, { rowKey: "id", dataSource: [], columns: businessColumns, loading: true, pagination: false })), /skeletonRow/);
assert.match(renderToStaticMarkup(React.createElement(business.Table, { dataSource: businessRows, columns: businessColumns, rowSelection: {} })), /data-compatibility/, "unbridged selection contracts retain the original renderer");

async function repositoryCheck() {
  const queries = [];
  const { RentalCoreFactRepository } = load("apps/api/src/modules/rental-core/rental-core-fact.repository.ts", {
    "./rental-usage-reading": {}, "../database/prisma.service": { PrismaService: class {} },
    "../ai-native/business-events/prisma-business-failure-outbox": {},
    "./workspace-scope": { resolveScopeWorkspaceId: async () => "workspace" },
    "./category-active-write": {}, "./rental-occupancy": {}, "./rental-carrier-shipment": {},
    "./rental-order-list-sort": { rentalOrderListSort }, "./rental-rule-defaults": {},
    "./rental-order-number": { allocateRentalOrderNumber: () => { throw new Error('list tests must not allocate order numbers'); } },
    "../../common/organization-location-scope": {}, "./work-order-assignee-scope": {},
    "../../common/request-identity": { getRequestLocationIds: () => ["location"], getRequestDataScope: () => "own", getRequestUserId: () => "operator" },
  });
  const repository = new RentalCoreFactRepository({
    $queryRaw: async query => { queries.push(query); return query.sql.includes("COUNT(*)") ? [{ total: 2n }] : [{ id: "b" }, { id: "a" }]; },
    rentalOrder: { findMany: async () => [{ id: "a" }, { id: "b" }] },
  });
  repository.toDomainOrder = row => row;
  const result = await repository.queryOrders("tenant", { sort: "startAt.asc,endAt.desc", keyword: "a%_", pendingFeeOnly: true, skip: 20, take: 20 });
  assert.deepEqual(result.items.map(row => row.id), ["b", "a"]);
  const ids = queries.find(query => query.sql.includes("ORDER BY"));
  assert.match(ids.sql, /ORDER BY o\.`startAt` ASC, CASE.*DESC, o\.`id` DESC LIMIT \? OFFSET \?/s);
  assert.match(ids.sql, /o\.`tenantId` = \?/);
  assert.match(ids.sql, /o\.`workspaceId` = \?/);
  assert.match(ids.sql, /o\.`createdBy` = \?/);
  assert.match(ids.sql, /o\.`fulfillmentLocationId` IN/);
  assert.match(ids.sql, /JSON_CONTAINS/);
  assert.ok(ids.values.includes("tenant") && ids.values.includes("workspace") && ids.values.includes("operator") && ids.values.includes("location"));
  assert.deepEqual(ids.values.slice(-2), [20, 20]);
  assert.ok(ids.values.includes("%a\\%\\_%"), "keyword remains a bound escaped value");
}
repositoryCheck().then(() => console.log("PASS order timing, SQL sorting/scope/paging, visibility, cross-page selection, Motiq source parameters/change detection, skeleton/status/number semantic SSR")).catch(error => { console.error(error); process.exitCode = 1; });
