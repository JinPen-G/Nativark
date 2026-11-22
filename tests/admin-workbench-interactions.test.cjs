const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const Module = require("node:module");

// Load the real, type-only presentation module without API, environment, database or app startup.
const source = path.resolve(__dirname, "../packages/rental-core/admin/operations/workbenchPresentation.ts");
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
    "@rental-os/platform-admin/ui": Object.fromEntries(["AnimatedNumber", "Button", "Empty", "Segmented", "Table", "ContentTransition"].map(name => [name, name])),
    "./insights/OperationalCharts": { InsightPanel: "InsightPanel", ViewChoice: "ViewChoice" },
    "@rental-os/platform-admin/locale": { useLocale: () => ({ locale: "zh-CN", t: translate }) },
    "./workbenchPresentation": loaded.exports,
    "./WorkbenchOverview.module.css": { default: new Proxy({}, { get: (_, name) => String(name) }) },
  };
  const file = path.resolve(__dirname, "../packages/rental-core/admin/operations/WorkbenchTodoQueue.tsx");
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

function loadOperationsSource(relative, dependencies = {}) {
  const file = path.resolve(__dirname, "../packages/rental-core/admin/operations", relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const actual = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, actual, actual.exports);
  return actual.exports;
}

test("operations requests retain the original filters, reconciliation limit and raw CSV transport", async () => {
  const requests = [], texts = [];
  const result = { pending: 1, failed: 0 };
  const csv = '"customer","amount"\r\n"Recorded name","10.00"\r\n';
  const orderMethods = { profile() {}, locations() {} };
  const { createRentalOperationsApi } = loadOperationsSource("client.ts", {
    "../orders/client": { createRentalOrderApi: () => orderMethods },
  });
  const api = createRentalOperationsApi(async (path, options) => {
    requests.push({ path, options });
    return result;
  }, async (path, params) => {
    texts.push({ path, params });
    return csv;
  });
  const filter = { from: "2026-11-01T00:00:00Z", to: "2026-11-19T23:59:59Z",
    locationId: "location-a", customerId: "customer-a", customerType: "corporate" };
  assert.equal(api.profile, orderMethods.profile);
  assert.equal(api.locations, orderMethods.locations);
  assert.equal(await api.operationReport(filter), result);
  assert.equal(await api.workbenchTodos(), result);
  assert.equal(await api.reconcilePayments(), result);
  assert.equal(await api.reconcilePayments(12), result);
  assert.equal(await api.exportOperationReport(filter), csv);
  assert.deepEqual(requests, [
    { path: "/rental/v1/reports/operations", options: { params: filter } },
    { path: "/rental/v1/workbench/todos", options: undefined },
    { path: "/rental/v1/payment-reconciliation?limit=50", options: { method: "post" } },
    { path: "/rental/v1/payment-reconciliation?limit=12", options: { method: "post" } },
  ]);
  assert.deepEqual(texts, [{ path: "/rental/v1/reports/operations/export", params: filter }]);
});

test("operations preserve the original overview OR permission gate and report-only entry", () => {
  const { rentalOperationsLegacyPageAllowed } = loadOperationsSource("pages.ts");
  const session = permission => ({ sessionVerified: true, authenticated: true,
    tenant: { tenantId: "tenant-a" }, user: { id: "user-a" }, currentWorkspaceId: "workspace-a",
    hasPermission: candidate => candidate === permission });
  for (const permission of ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"])
    assert.equal(rentalOperationsLegacyPageAllowed("workbench", session(permission)), true);
  assert.equal(rentalOperationsLegacyPageAllowed("workbench", session("rental-core:asset:view")), false);
  assert.equal(rentalOperationsLegacyPageAllowed("operation-report", session("rental-os:report:view")), true);
  assert.equal(rentalOperationsLegacyPageAllowed("operation-report", session("rental-os:order:view")), false);
  assert.equal(rentalOperationsLegacyPageAllowed("unknown", session("rental-os:report:view")), false);
  assert.equal(rentalOperationsLegacyPageAllowed("workbench", { ...session("rental-os:report:view"), sessionVerified: false }), false);
  assert.equal(rentalOperationsLegacyPageAllowed("workbench", { ...session("rental-os:report:view"), user: { id: "user-a", isSaasAdmin: true } }), false);
});

test("operations reject previous-scope JSON and CSV results before exposing them to the page", async () => {
  const react = require("react");
  const orderClient = { createRentalOrderApi: () => ({ profile() {}, locations() {} }) };
  const orders = loadOperationsSource("../orders/page-context.tsx", {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "./client": orderClient,
  });
  const client = loadOperationsSource("client.ts", { "../orders/client": orderClient });
  const { createRentalOperationsPageContext } = loadOperationsSource("page-context.tsx", {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "../orders/page-context": orders, "./client": client,
  });
  let epoch = 1, jsonCalls = 0, textCalls = 0, completeJson, completeText;
  let current = { sessionVerified: true, authenticated: true, tenant: { tenantId: "tenant-a" },
    user: { id: "user-a", permissions: ["rental-os:report:view"] }, currentWorkspaceId: "workspace-a", hasPermission: () => true };
  const runtime = { currentSessionEpoch: () => epoch, request: () => {
    jsonCalls += 1;
    return new Promise(resolve => { completeJson = resolve; });
  } };
  const requestText = () => {
    textCalls += 1;
    return new Promise(resolve => { completeText = resolve; });
  };
  const bind = () => createRentalOperationsPageContext({ runtime, requestText, session: current,
    getSession: () => current, queryScope: current.currentWorkspaceId, components: { CustomerPreview() {} } });
  const first = bind();
  const pendingJson = first.api.operationReport();
  current = { ...current, currentWorkspaceId: "workspace-b" };
  completeJson({ generatedAt: "2026-11-19T00:00:00Z" });
  await assert.rejects(pendingJson, { name: "AbortError" });
  await assert.rejects(first.api.operationReport(), { name: "AbortError" });
  assert.equal(jsonCalls, 1, "An obsolete callback must fail before issuing another request");
  const second = bind();
  const pendingText = second.api.exportOperationReport();
  epoch += 1;
  completeText('"customer","amount"\r\n"Old scope","10.00"\r\n');
  await assert.rejects(pendingText, { name: "AbortError" });
  await assert.rejects(second.api.exportOperationReport(), { name: "AbortError" });
  assert.equal(textCalls, 1, "Old CSV bytes must never become a download or trigger a replacement request");
  const third = bind();
  current = { ...current, user: { ...current.user, permissions: [] } };
  await assert.rejects(third.api.workbenchTodos(), { name: "AbortError" });
  assert.equal(jsonCalls, 1, "A permission change invalidates the previous context before transport");
});

test("operations keep text refresh and secondary reconciliation in the original content locations", () => {
  const filename = path.resolve(__dirname, "../packages/rental-core/admin/operations/WorkbenchPage.tsx");
  const text = fs.readFileSync(filename, "utf8");
  const tree = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let header, todoSection;
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === "CorePage") header = node;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === "section"
      && node.openingElement.attributes.properties.some(item => ts.isJsxAttribute(item)
        && item.name.text === "className" && item.initializer?.expression?.getText(tree) === "styles.todoSection")) todoSection = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(header, "The workbench must use the original public page header");
  const attributes = new Map(header.attributes.properties.filter(ts.isJsxAttribute).map(item => [item.name.text, item.initializer]));
  assert.equal(attributes.get("toolsPlacement").text, "view");
  assert.match(attributes.get("tools").expression.getText(tree), /CorePageActions slot="content:view-tools"/);
  assert.equal(attributes.get("actions").expression.getText(tree), "pageActions");
  let declaredActions, paymentGate;
  function findActions(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "pageActions") declaredActions = node.initializer;
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "canReconcilePayments") paymentGate = node;
    ts.forEachChild(node, findActions);
  }
  findActions(tree);
  const refresh = new Map(declaredActions.elements[0].properties.map(item => [item.name.text, item.initializer]));
  assert.equal(refresh.get("id").text, "refresh");
  assert.equal(refresh.get("slot").text, "content:view-tools");
  const presentation = new Map(refresh.get("presentation").properties.map(item => [item.name.text, item.initializer]));
  assert.equal(presentation.get("control").text, "button");
  assert.equal(presentation.get("type").text, "text");
  assert.equal(presentation.get("iconOnly").kind, ts.SyntaxKind.TrueKeyword);
  assert.equal(presentation.has("shape"), false);
  assert.equal(refresh.get("execute").getText(tree), "refresh");
  assert.ok(paymentGate, "Payment reconciliation is declared only for authorized users");
  const action = paymentGate.thenStatement.expression.arguments[0];
  const properties = new Map(action.properties.map(item => [item.name.text, item.initializer]));
  assert.equal(properties.get("id").text, "reconcile-payments");
  assert.equal(properties.get("kind").text, "command");
  assert.equal(properties.get("slot").text, "content:maintenance-tools");
  assert.equal(properties.get("emphasis").text, "secondary");
  assert.equal(properties.get("pending").getText(tree), "reconcilePayments.isPending");
  assert.match(properties.get("permissions").getText(tree), /resource: "finance", action: "reconcile"/);
  assert.match(properties.get("execute").getText(tree), /await reconcilePayments\.mutateAsync\(\)/);
  assert.ok(todoSection, "Payment reconciliation stays in the original todo section");
  const todoContent = todoSection.getText(tree);
  const queueEnd = todoContent.indexOf("</QueryState>");
  const paymentToolbar = todoContent.indexOf("className={styles.maintenanceTools}");
  assert.ok(queueEnd > todoContent.indexOf("WorkbenchTodoQueue"));
  assert.ok(paymentToolbar > queueEnd, "The maintenance toolbar follows the original todo query");
  assert.match(todoContent.slice(paymentToolbar), /CorePageActions slot="content:maintenance-tools"/);
  const css = fs.readFileSync(path.resolve(__dirname, "../packages/rental-core/admin/operations/WorkbenchOverview.module.css"), "utf8");
  assert.match(css, /\.todoSection\s*\{\s*display:\s*grid;\s*min-width:\s*0;\s*gap:\s*var\(--space-2\);\s*\}/);
  assert.match(css, /\.maintenanceTools\s*\{\s*display:\s*flex;\s*justify-content:\s*flex-end;\s*\}/);
  const report = fs.readFileSync(path.resolve(__dirname, "../packages/rental-core/admin/operations/WorkspaceOperationReportPage.tsx"), "utf8");
  assert.match(report, /toolsPlacement="view" tools=\{<Space><CorePageActions slot="content:view-tools" \/><\/Space>\}/);
  assert.match(report, /id: "export-csv", kind: "command", label: t\("导出 CSV"\), slot: "content:view-tools"/);
  assert.match(report, /id: "refresh", kind: "command", label: t\("刷新经营报表"\), slot: "content:view-tools"/);
});

test("declared order actions retain their original quote, result and workflow locations", () => {
  const read = name => fs.readFileSync(path.resolve(__dirname, "../packages/rental-core/admin/orders", name), "utf8");
  const create = read("RentalOrderCreatePage.tsx");
  const detail = read("RentalOrderDetailPage.tsx");
  assert.match(create, /id: "quote", kind: "save", slot: "content:quote"/);
  assert.match(create, /id: "create", kind: "command", slot: "content:quote"/);
  assert.match(create, /block: true, size: "large", style: \{ marginTop: quote \? "var\(--space-4\)" : 0 \}/);
  assert.match(create, /extra=\{<CorePageActions slot="content:result" \/>\}/);
  const quoteSlot = create.indexOf('<CorePageActions slot="content:quote" />');
  assert.ok(quoteSlot > create.indexOf('className="order-quote-total"'));
  assert.ok(quoteSlot < create.indexOf("</Card>", quoteSlot), "Quote actions stay inside the original amount card");
  const operations = detail.indexOf('id="rental-order-operations"');
  const confirmation = detail.indexOf('<CorePageActions slot="content:confirm" />');
  const handover = detail.indexOf('<CorePageActions slot="content:handover" />');
  const settlement = detail.indexOf('<CorePageActions slot="content:settle" />');
  assert.ok(operations < confirmation && confirmation < handover && handover < settlement);
  assert.ok(settlement < detail.indexOf('data-order-action="extend"'));
  assert.equal((create.match(/id: "back", kind: "navigate", slot: "navigation"/g) ?? []).length, 2, "Both create states retain the original text navigation slot");
  assert.match(detail, /id: "back", kind: "navigate", slot: "navigation"/, "Order details retain the original text navigation slot");
});

test("native declared buttons retain single execution, validation and stale-action rejection", async () => {
  const vm = require("node:vm");
  const filename = path.resolve(__dirname, "../packages/platform-admin/src/core/CorePage.tsx");
  const tree = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const actionDriver = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PageAction");
  const access = tree.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === "access"));
  const compiled = ts.transpileModule(`${access.getText(tree)}\n${actionDriver.getText(tree)}\nglobalThis.render = PageAction;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  function driver(initialAction) {
    const refs = [], errors = [];
    let cursor = 0, cleanup, currentAction = initialAction, allowed = true;
    const host = { page: { key: "rental:test", coreId: "rental", definition: { permissions: [] } }, canAccess: () => allowed };
    const context = {
      exports: {}, Button: "button", Tooltip: "tooltip", corePageText: value => value,
      useLocale: () => ({ locale: "zh-CN", t: value => value }),
      useFeedback: () => ({ toast: value => errors.push(value) }),
      useRef: initial => { const index = cursor++; return refs[index] ?? (refs[index] = { current: initial }); },
      useLayoutEffect: effect => { if (!cleanup) cleanup = effect(); },
      require: name => { assert.equal(name, "react/jsx-runtime"); return require(name); },
    };
    vm.runInNewContext(compiled, context);
    return {
      errors, revoke: () => { allowed = false; }, unmount: () => cleanup(),
      button(action = currentAction, visible = true) {
        currentAction = action;
        cursor = 0;
        return context.render({ host, action, visible }).props.children;
      },
    };
  }
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  for (const kind of ["open", "navigate"]) {
    const iconButton = driver({ id: kind, kind, label: "Open details", icon: "details",
      presentation: { control: "button", iconOnly: true } }).button();
    assert.equal(iconButton.props["aria-label"], "Open details");
    assert.equal(iconButton.props.children, null);
    assert.equal(iconButton.props.icon, "details");
  }
  let resolveCommand, calls = 0;
  const pending = new Promise(resolve => { resolveCommand = resolve; });
  const action = { id: "refresh", kind: "command", label: "Refresh", presentation: { control: "button", shape: "circle", iconOnly: true }, execute: () => { calls++; return pending; } };
  const active = driver(action), button = active.button();
  assert.equal(button.props.shape, "circle");
  assert.equal(button.props["aria-label"], "Refresh");
  assert.equal(button.props.children, null);
  button.props.onClick(); button.props.onClick();
  await flush();
  assert.equal(calls, 1);
  resolveCommand(); await flush();
  assert.deepEqual(active.errors, []);
  active.revoke(); active.button().props.onClick(); await flush();
  assert.equal(calls, 1);
  assert.equal(active.errors.length, 1);

  let completedSaves = 0;
  const completed = driver({ id: "save", kind: "save", label: "Save", presentation: { control: "button" },
    form: { validateFields: async () => ({ subject: "current" }) },
    onSave: async values => { assert.equal(values.subject, "current"); completedSaves++; } });
  const completedButton = completed.button();
  completedButton.props.onClick({ preventDefault() {} }); completedButton.props.onClick({ preventDefault() {} });
  await flush();
  assert.equal(completedSaves, 1, "Normal validated saves still dispatch exactly once");
  assert.deepEqual(completed.errors, []);

  let resolveValidation, saves = 0;
  const validation = new Promise(resolve => { resolveValidation = resolve; });
  const save = { id: "quote", kind: "save", label: "Quote", presentation: { control: "button", block: true, size: "large" }, form: { validateFields: () => validation }, onSave: async () => { saves++; } };
  const stale = driver(save);
  const saveButton = stale.button();
  assert.equal(saveButton.props.htmlType, "submit", "Enter retains the actual form submit target");
  let prevented = false;
  saveButton.props.onClick({ preventDefault: () => { prevented = true; } }); await flush();
  assert.equal(prevented, true, "A click cannot also dispatch the native form submission");
  stale.button(save, false);
  resolveValidation({ customerId: "member" }); await flush();
  assert.equal(saves, 0, "A hidden page cannot dispatch after delayed validation");
  assert.deepEqual(stale.errors, [], "A hidden page cannot emit an old error toast");
  const departed = driver(action);
  const oldButton = departed.button(); departed.unmount(); oldButton.props.onClick(); await flush();
  assert.equal(calls, 1, "Unmounted callbacks cannot execute");
});
