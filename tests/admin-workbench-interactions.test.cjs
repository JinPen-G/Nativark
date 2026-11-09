const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const Module = require("node:module");

// Load the real, type-only presentation module without API, environment, database or app startup.
const source = path.resolve(__dirname, "../apps/admin/src/features/workbench/workbenchPresentation.ts");
const loaded = new Module(source, module);
loaded._compile(ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, source);
const { overviewTodoTarget, overviewActiveTodo, overviewPeriodStart } = loaded.exports;
const todo = (id, overrides = {}) => ({ id, type: "refund", priority: "high", title: id, description: "Pending", href: "https://untrusted.invalid/action", createdAt: "2026-11-09T02:00:00Z", orderId: "order-a", ...overrides });

test("overview links require the matching domain permission and stable object identity", () => {
  const order = todo("refund-a");
  const work = todo("work-a", { type: "work_order", workOrderId: "work-a" });
  assert.equal(overviewTodoTarget(order, { orders: false, workOrders: true }), undefined);
  assert.equal(overviewTodoTarget(work, { orders: true, workOrders: false }), undefined);
  assert.deepEqual(overviewTodoTarget(order, { orders: true, workOrders: false }), { route: "orderDetail", id: "order-a" });
  assert.deepEqual(overviewTodoTarget(work, { orders: false, workOrders: true }), { route: "workOrderDetail", id: "work-a" });
  assert.equal(overviewTodoTarget(todo("missing", { orderId: undefined }), { orders: true, workOrders: true }), undefined);
  assert.equal(overviewTodoTarget(todo("missing-work", { type: "work_order" }), { orders: true, workOrders: true }), undefined);
});

test("removed, filtered or previous-scope pinned records cannot remain in the preview", () => {
  const a = todo("a"), b = todo("b"), nextScope = todo("next-scope");
  assert.equal(overviewActiveTodo([a, b], "a", "b"), a);
  assert.equal(overviewActiveTodo([b], "a", "a"), b);
  assert.equal(overviewActiveTodo([nextScope], "a", "b"), nextScope);
  assert.equal(overviewActiveTodo([], "a", "b"), undefined);
});

test("seven-day and month filters preserve the original local-midnight boundaries without mutating the clock", () => {
  const at = new Date(2026, 10, 9, 17, 35, 20);
  const original = at.getTime();
  assert.equal(overviewPeriodStart("today", at), new Date(2026, 10, 9).toISOString());
  assert.equal(overviewPeriodStart("week", at), new Date(2026, 10, 3).toISOString());
  assert.equal(overviewPeriodStart("month", at), new Date(2026, 10, 1).toISOString());
  assert.equal(at.getTime(), original);
});

/** Exercise the component's real handlers with deterministic hook state. UI primitives are
 * boundaries here; visual, focus-engine and browser acceptance remain separate checks. */
function todoQueueHarness(initialItems) {
  const React = require("react");
  const slots = [], pendingEffects = [];
  let cursor = 0, changed = false;
  const hooks = {
    useId: () => "todo-preview",
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], next => {
        const value = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(value, slots[index])) { slots[index] = value; changed = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous[at]))) pendingEffects.push(fn);
      slots[index] = deps;
    },
  };
  const translate = (text, values) => (text === "已启用" ? "Enabled" : text).replace(/\{(\w+)\}/g, (match, key) => values?.[key] ?? match);
  const dependency = {
    react: hooks, "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": Object.fromEntries(["ArrowRight", "CircleAlert", "Clock3", "Pin", "PinOff", "Wrench"].map(name => [name, name])),
    "@/components/ui": Object.fromEntries(["AnimatedNumber", "Button", "Empty", "Segmented", "Table"].map(name => [name, name])),
    "@/components/insights/OperationalCharts": { InsightPanel: "InsightPanel", ViewChoice: "ViewChoice" },
    "@/components/workspace/ContentTransition": { ContentTransition: "ContentTransition" },
    "@/app/locale": { useLocale: () => ({ locale: "zh-CN", t: translate }) },
    "./workbenchPresentation": loaded.exports,
    "./WorkbenchOverview.module.css": { default: new Proxy({}, { get: (_, name) => String(name) }) },
  };
  const file = path.resolve(__dirname, "../apps/admin/src/features/workbench/WorkbenchTodoQueue.tsx");
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const actual = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => { assert.ok(name in dependency, name); return dependency[name]; }, actual, actual.exports);
  const props = { items: initialItems, busy: false, formatAmount: value => String(value), canOpen: () => true, onOpen() {}, onRefresh() {} };
  const walk = (node, ancestors = [], place = "root") => !React.isValidElement(node) ? [] : [
    { node, ancestors, place }, ...React.Children.toArray(node.props.children).flatMap((child, index) => walk(child, [...ancestors, node], `${place}/${index}`)),
  ];
  const render = () => {
    let tree, attempts = 0;
    do {
      assert.ok(attempts++ < 10, "Hook updates should settle");
      cursor = 0; changed = false;
      tree = actual.exports.WorkbenchTodoQueue(props);
      while (pendingEffects.length) pendingEffects.shift()();
    } while (changed);
    return walk(tree);
  };
  return { props, render, find: predicate => render().find(entry => predicate(entry.node))?.node,
    view: value => render()[0].node.props.actions.props.onChange(value) };
}

test("pointer exit preserves a keyboard preview, while removed pins do not reappear after refresh", () => {
  const a = todo("first"), b = todo("second", { type: "work_order", workOrderId: "second", description: "已启用" });
  const queue = todoQueueHarness([a, b]);
  const button = name => queue.find(node => node.type === "Button" && node.props["aria-label"] === `预览事项：${name}`);
  const selectedTitle = () => queue.find(node => node.type === "h3").props.children;
  button("second").props.onFocus({ currentTarget: { matches: () => true } });
  queue.find(node => typeof node.props.onPointerLeave === "function").props.onPointerLeave();
  assert.equal(selectedTitle(), "second", "Moving the pointer out must not cancel the keyboard user's current preview");
  assert.equal(queue.find(node => node.type === "p" && node.props.className === "previewDescription").props.children, "已启用", "A work-order reason remains the recorded business text even if it matches a translated label");
  button("second").props.onClick();
  queue.props.items = [a]; queue.render();
  queue.props.items = [a, b]; queue.render();
  assert.equal(button("second").props["aria-pressed"], false, "A removed pin must not resurrect when the same ID appears later");
});

test("the todo details table survives focus-view round trips and filters return to the first page", () => {
  const queue = todoQueueHarness(Array.from({ length: 20 }, (_, i) => todo(`task-${i}`, { priority: i === 19 ? "high" : "normal" })));
  queue.view("table");
  const opened = queue.render().find(entry => entry.node.type === "Table");
  opened.node.props.pagination.onChange(2, 8);
  queue.view("focus");
  const concealed = queue.render().find(entry => entry.node.type === "Table");
  assert.ok(concealed, "Hide the loaded table so sorting, columns and paging stay mounted");
  assert.equal(concealed.place, opened.place, "The same table occupies the same reconciliation position");
  assert.ok(concealed.ancestors.some(node => node.props.hidden), "Inactive table controls must be hidden");
  queue.view("table");
  assert.equal(queue.find(node => node.type === "Table").props.pagination.current, 2);
  queue.find(node => node.type === "Segmented").props.onChange("priority");
  const filtered = queue.find(node => node.type === "Table");
  assert.equal(filtered.props.pagination.current, 1);
  assert.deepEqual(filtered.props.dataSource.map(row => row.id), ["task-19"]);
});
