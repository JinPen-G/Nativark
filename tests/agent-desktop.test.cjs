"use strict";
/** Source-level desktop regressions. Browser/Electron/provider infrastructure is substituted; these are not native acceptance or type checks. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, "..");
const desktop = "clients/agent-desktop/harness/apps/desktop/src/";

function load(relative, bindings = {}, replacements = []) {
  let source = fs.readFileSync(path.join(root, relative), "utf8");
  source = source.replace(/^export \* from ['"]([^'"]+)['"];?$/gm, (_, name) =>
    `Object.assign(module.exports, loadDependency(${JSON.stringify(name)}));`);
  for (const [pattern, replacement] of replacements) source = source.replace(pattern, replacement);
  const exported = [];
  source = source.replace(/export (const|function|class) (\w+)/g, (_, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });
  source = relative.endsWith(".tsx")
    ? require(path.join(root, "clients/agent-desktop/harness/node_modules/typescript")).transpileModule(source, {
      compilerOptions: { target: "ES2022", module: "CommonJS", jsx: "React" }
    }).outputText
    : stripTypeScriptTypes(source, { mode: "transform" });
  const scope = { module: { exports: {} }, exports: {}, require, URL, TextEncoder, Event, console, process,
    loadDependency: name => load(path.join(path.dirname(relative), `${name}.ts`)), ...bindings };
  vm.runInNewContext(`${source}\nmodule.exports = {...module.exports, ${exported.join(",")}};`, scope, { filename: relative });
  return scope.module.exports;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}
function sample() {
  return { status: "ready", actorId: "a", tenantId: "t", tenantName: "Tenant", displayName: "Staff", audience: "tenant",
    currentWorkspaceId: "w1", workspaces: [{ id: "w1", name: "Camera", categoryCode: "camera" }, { id: "w2", name: "Vehicle", categoryCode: "vehicle" }],
    sections: [{ id: "orders", label: "Orders", items: [{ id: "orders", path: "/orders", label: "Orders" }] }],
    defaultPath: "/orders", pathname: "/orders" };
}
const shared = load("packages/shared/src/agent-desktop.ts");

test("public projection rejects secrets, foreign workspace, unsafe routes and complete oversized UTF-8 payload", () => {
  assert.equal(shared.parseRentalDesktopSession(sample()).actorId, "a");
  assert.throws(() => shared.parseRentalDesktopSession({ ...sample(), token: "secret" }));
  assert.throws(() => shared.parseRentalDesktopSession({ ...sample(), currentWorkspaceId: "foreign" }));
  for (const value of ["https://foreign.invalid", "//foreign.invalid", "/a/../b", "/a?token=x", "/a%2fb", "/a\\b"]) {
    assert.throws(() => shared.rentalDesktopPath(value));
  }
  assert.throws(() => shared.parseRentalDesktopCommand({ kind: "execute", revision: 1 }));
  assert.throws(() => shared.parseRentalDesktopCommand({ kind: "navigate", revision: 1, routeId: "orders", url: "https://foreign.invalid" }));
  assert.throws(() => shared.parseRentalDesktopBounds({ x: 0, y: 0, width: NaN, height: 1 }));
  const large = { ...sample(), defaultPath: null, sections: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, label: "名称".repeat(100),
    items: Array.from({ length: 10 }, (_, j) => ({ id: `${i}-${j}`, path: `/${i}/${j}`, label: "名称".repeat(100) })) })) };
  assert.throws(() => shared.parseRentalDesktopSession(large));
  const config = load(`${desktop}rental-desktop-config.ts`);
  assert.equal(config.rentalDesktopConfig({}, true), undefined);
  assert.equal(config.rentalDesktopConfig({}, true, "http://127.0.0.1:5175").adminUrl, "http://127.0.0.1:5175/");
  assert.throws(() => config.rentalDesktopConfig({ rentalDesktop: { adminUrl: "http://public.invalid" } }, false));
  assert.throws(() => config.rentalDesktopConfig({ rentalDesktop: { adminUrl: "https://admin.invalid", downloadOrigins: ["https://files.invalid/path"] } }, false));
});

function authFixture() {
  const storage = new Map(), listeners = new Map();
  const window = { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    addEventListener: (name, fn) => listeners.set(name, fn), dispatchEvent: event => { listeners.get(event.type)?.(event); return true; } };
  let epoch = 0, next, reads = 0, refreshed;
  const api = { sessionContext: () => { reads++; return next.promise; }, login: () => next.promise, switchWorkspace: () => next.promise,
    changePassword: () => next.promise, logout: async () => {} };
  const create = factory => {
    let current;
    const subscriptions = new Set();
    const store = { getState: () => current, setState: update => { const previous = current; current = { ...current, ...update }; for (const fn of subscriptions) fn(current, previous); },
      subscribe: fn => { subscriptions.add(fn); return () => subscriptions.delete(fn); } };
    current = factory(store.setState, store.getState);
    return store;
  };
  const store = load("apps/admin/src/features/auth/authStore.ts", { window, api, create,
    CustomEvent: class extends Event { constructor(type) { super(type); } }, clearSessionQueryCache: () => epoch++, currentSessionEpoch: () => epoch,
    onSessionRefreshed: fn => { refreshed = fn; return () => {}; } }, [
    [/^import \{[^\n]*\} from [^\n]+;$/gm, ""], [/import.meta.hot/g, "false"]
  ]).useAuthStore;
  const context = () => ({ user: { id: "a", displayName: "Staff", permissions: ["rental-os:order:view"] },
    tenant: { tenantId: "t", tenantName: "Tenant", capabilities: [] }, workspaces: sample().workspaces, currentWorkspaceId: "w1" });
  const login = () => ({ ...context(), accessToken: "access", refreshToken: "refresh" });
  return { store, storage, window, context, login, next: value => { next = value; }, reads: () => reads, refreshed: value => refreshed(value) };
}
test("cached login waits for server, deduplicates verification and refuses late account/space responses", async () => {
  const f = authFixture();
  f.storage.set("rental_access_token", "cached");
  const check = deferred(); f.next(check);
  const first = f.store.getState().bootstrap();
  assert.equal(f.store.getState().bootstrap(), first);
  assert.equal(f.reads(), 1);
  assert.equal(f.store.getState().sessionVerified, false);
  check.resolve(f.context()); await first;
  assert.equal(f.store.getState().sessionVerified, true);
  const oldFailure = deferred(); f.next(oldFailure);
  const oldVerification = f.store.getState().bootstrap();
  f.storage.set("rental_access_token", "fresh-receipt"); f.refreshed({ ...f.login(), accessToken: "fresh-receipt" });
  oldFailure.reject(new Error("old verification failed")); await oldVerification;
  assert.equal(f.store.getState().token, "fresh-receipt"); assert.equal(f.store.getState().sessionVerified, true);
  const stale = deferred(); f.next(stale);
  const restoring = f.store.getState().bootstrap();
  f.store.getState().logout(); stale.resolve(f.context()); await restoring;
  assert.equal(f.store.getState().token, undefined);
  const late = deferred(); f.next(late);
  const login = f.store.getState().login("t", "staff", "synthetic");
  f.store.getState().logout(); late.resolve(f.login()); await assert.rejects(login);
  const valid = deferred(); f.next(valid);
  const signedIn = f.store.getState().login("t", "staff", "synthetic"); valid.resolve(f.login()); await signedIn;
  f.store.getState().setAccountThemeColor("synthetic"); assert.equal(f.store.getState().sessionVerified, true);
  f.storage.set("rental_access_token", "rotated");
  f.refreshed({ ...f.login(), accessToken: "rotated" });
  f.window.dispatchEvent(new Event("rental-session-updated"));
  assert.equal(f.store.getState().sessionVerified, true);
  const oldRead = deferred(); f.next(oldRead); const boot = f.store.getState().bootstrap();
  const space = deferred(); f.next(space); const switching = f.store.getState().switchWorkspace("w2");
  space.resolve({ ...f.login(), currentWorkspaceId: "w2", refreshToken: "" }); await switching;
  oldRead.resolve(f.context()); await boot;
  assert.equal(f.store.getState().currentWorkspaceId, "w2");
  assert.equal(f.storage.get("rental_refresh_token"), "refresh");
});

test("desktop menu is derived from real Web navigation, permissions, audience and terminology", () => {
  const labels = load("apps/admin/src/app/navigation-terminology.ts");
  const navigation = load("apps/admin/src/app/navigation.tsx", { ...labels, CATEGORY_GOVERNANCE_PREVIEW_ENABLED: false,
    RentalCategoryCode: { Camera: "camera", Camping: "camping", Vehicle: "vehicle", Construction: "construction" } }, [
    [/^import \{[\s\S]*?\} from "@ant-design\/icons";/m, ""],
    [/^import \{[^\n]*\} from [^\n]+;$/gm, ""], [/<[A-Za-z]+Outlined \/>/g, "null"]
  ]);
  const { desktopSessionProjection } = load("apps/admin/src/features/agent-desktop/desktop-session-projection.ts");
  const source = { ready: true, sessionVerified: true, token: "not-projected", user: { id: "a", displayName: "Staff" }, tenant: { tenantId: "t", tenantName: "Tenant", categoryCode: "camera" },
    currentWorkspaceId: "w1", workspaces: sample().workspaces, hasPermission: permission => !permission || permission === "rental-os:order:view",
    hasCapability: capability => !capability, hasTenantMembershipPermission: () => false };
  const registry = { routes: navigation.APP_ROUTES, sections: navigation.buildNavigationSections,
    allowed: (route, state) => navigation.canAccessRoute(route, state.hasPermission, state.hasCapability, state.tenant?.categoryCode, Boolean(state.user?.isSaasAdmin), state.hasTenantMembershipPermission) };
  const projected = desktopSessionProjection(source, registry, "/rental/orders/id", value => value);
  shared.parseRentalDesktopSession(projected);
  const ids = projected.sections.flatMap(section => section.items.map(item => item.id));
  assert.ok(ids.includes("orders")); assert.ok(!ids.includes("platformTenants"));
  assert.equal(JSON.stringify(projected).includes("not-projected"), false);
  assert.equal(desktopSessionProjection({ ...source, sessionVerified: false }, registry, "/", x => x).status, "unavailable");
  assert.equal(desktopSessionProjection({ ...source, user: { ...source.user, mustChangePassword: true } }, registry, "/", x => x).status, "password-change");
  const saas = desktopSessionProjection({ ...source, user: { ...source.user, isSaasAdmin: true }, currentWorkspaceId: undefined, workspaces: [], hasPermission: () => true }, registry, "/platform/tenants", x => x);
  assert.ok(!saas.sections.flatMap(section => section.items).some(item => ["orders", "platformCategories"].includes(item.id)));
  const terms = desktopSessionProjection({ ...source, hasPermission: () => true }, registry, "/", x => x,
    { itemGroupLabel: "车型", itemLabel: "车辆", assetLabel: "车辆", assetCollectionLabel: "车队", fulfillmentLabel: "门店" });
  assert.equal(terms.sections.flatMap(section => section.items).find(item => item.id === "assets").label, "车辆与车队");
});

function nativeFixture() {
  const handlers = new Map(), views = [], timers = [];
  class Contents extends EventEmitter {
    constructor(url) { super(); this.mainFrame = { url }; this.sent = []; this.dead = false; }
    isDestroyed() { return this.dead; }
    setWindowOpenHandler(fn) { this.openWindow = fn; }
    async loadURL(url) { this.emit("did-start-navigation", {}, url, false, true); this.mainFrame.url = url; }
    send(channel, payload) { this.sent.push({ channel, payload }); }
    close() { this.dead = true; this.emit("destroyed"); }
  }
  class View {
    constructor(options) { this.options = options; this.webContents = new Contents("https://admin.invalid/"); views.push(this); }
    setBounds(value) { this.bounds = value; }
    setVisible(value) { this.visible = value; }
  }
  const browser = new EventEmitter(); browser.setPermissionRequestHandler = () => {}; browser.setPermissionCheckHandler = () => {};
  const fake = { WebContentsView: View, session: { fromPartition: () => browser }, dialog: { showMessageBox: async () => ({ response: 1 }) },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), removeHandler: channel => handlers.delete(channel) } };
  const ipcs = load(`${desktop}rental-desktop-protocol.ts`).RENTAL_IPC;
  const { RentalBusinessView } = load(`${desktop}rental-business-view.ts`, { shared, fake, ipcs,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; }, clearTimeout: timer => { if (timer) timer.cleared = true; } }, [
    [/^import \{[^}]*\} from 'node:crypto'$/m, "const { createHash, randomUUID } = require('node:crypto')"],
    [/^import \{ basename \} from 'node:path'$/m, "const { basename } = require('node:path')"],
    [/^import \{[^}]*\} from 'electron'$/m, "const { WebContentsView, session, ipcMain, dialog } = fake"],
    [/^import \{[^}]*\} from '@rental-os\/shared\/agent-desktop'$/m, "const { RENTAL_DESKTOP_PROTOCOL_VERSION, parseRentalDesktopSession, parseRentalDesktopCommand, parseRentalDesktopBounds, parseRentalDesktopCatalogQuery, parseRentalDesktopCatalogResult } = shared"],
    ["import { RENTAL_IPC } from './rental-desktop-protocol.ts'", "const RENTAL_IPC = ipcs"],
    ["import { WINDOWS_TITLEBAR_HEIGHT } from './windows-layout.ts'", "const WINDOWS_TITLEBAR_HEIGHT = 40"]
  ]);
  const owner = new EventEmitter(); owner.webContents = new Contents("dsh-app://app/"); owner.isDestroyed = () => false;
  owner.getContentBounds = () => ({ x: 0, y: 0, width: 1200, height: 800 }); owner.contentView = { addChildView() {}, removeChildView() {} };
  const admissions = [];
  const controller = new RentalBusinessView({ adminUrl: "https://admin.invalid/", downloadOrigins: ["https://files.invalid"] }, "preload.cjs",
    ready => admissions.push(ready), () => ({ unavailable: "Unavailable", reconnect: "Reconnect", cancel: "Cancel", draft: "Save first", download: "Download incomplete" }));
  return { controller, owner, browser, admissions, handlers, views, timers, ipcs };
}
test("native owner rejects stale documents, locks unknown commands, hides expired content and disposes", async () => {
  const f = nativeFixture(); f.controller.install();
  try {
    await f.controller.attach(f.owner);
    const view = f.views[0], shield = f.views[1];
    const app = { sender: f.owner.webContents, senderFrame: f.owner.webContents.mainFrame };
    const admin = { sender: view.webContents, senderFrame: view.webContents.mainFrame };
    assert.equal(view.visible, false); assert.equal(shield.visible, true);
    assert.equal(view.options.webPreferences.sandbox, true); assert.equal(view.options.webPreferences.nodeIntegration, false);
    let document = f.handlers.get(f.ipcs.connect)(admin, 1);
    const report = value => f.handlers.get(f.ipcs.report)(admin, { document, value });
    assert.throws(() => f.handlers.get(f.ipcs.report)(app, { document, value: sample() }));
    report(sample()); assert.equal(f.controller.ready, true);
    const snapshot = f.handlers.get(f.ipcs.read)(app);
    await assert.rejects(f.handlers.get(f.ipcs.request)(app, { kind: "navigate", revision: snapshot.revision, routeId: "foreign" }));
    const switching = f.handlers.get(f.ipcs.request)(app, { kind: "switch-workspace", revision: snapshot.revision, workspaceId: "w2" });
    const command = view.webContents.sent.at(-1).payload.value;
    assert.equal(command.session.workspaceId, "w1");
    report({ ...sample(), currentWorkspaceId: "w2" });
    f.handlers.get(f.ipcs.complete)(admin, { document, value: { id: command.id, ok: true } }); await switching;
    const current = f.handlers.get(f.ipcs.read)(app);
    const unknown = f.handlers.get(f.ipcs.request)(app, { kind: "navigate", revision: current.revision, routeId: "orders" });
    f.timers.findLast(timer => timer.ms === 20000 && !timer.cleared).fn(); await assert.rejects(unknown);
    await assert.rejects(f.handlers.get(f.ipcs.request)(app, { kind: "navigate", revision: current.revision, routeId: "orders" }));
    const old = document; await f.controller.retry();
    assert.throws(() => f.handlers.get(f.ipcs.report)(admin, { document: old, value: sample() }));
    document = f.handlers.get(f.ipcs.connect)(admin, 1); report(sample());
    f.timers.findLast(timer => timer.ms === 60000 && !timer.cleared).fn();
    assert.equal(f.controller.ready, false); assert.equal(view.visible, false); assert.equal(shield.visible, true);
    const waiting = f.controller.waitUntilReady(); f.controller.dispose(); await assert.rejects(waiting);
    assert.equal(f.handlers.size, 0); assert.equal(view.webContents.dead, true); assert.equal(f.browser.listenerCount("will-download"), 0);
  } finally { f.controller.dispose(); }
});

const harness = path.join(root, "clients/agent-desktop/harness");
const workbench = "clients/agent-desktop/harness/packages/client/ui-rental-workbench/src/client/";
const harnessRequire = require("node:module").createRequire(path.join(harness, "node_modules/.pnpm/node_modules/react/package.json"));
const { createHash } = require("node:crypto");
function workbenchFixture() {
  const { JSDOM } = require(path.join(harness, "node_modules/jsdom"));
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const { window } = dom, { document } = window;
  let focused = true, hidden = false, now = Date.parse("2026-10-27T10:00:00Z"), timerId = 0;
  Object.defineProperty(document, "hidden", { get: () => hidden });
  document.hasFocus = () => focused;
  class Clock extends Date { static now() { return now; } }
  const timers = new Map(), effects = [], registrations = new Map(), modeListeners = new Set();
  const store = load("clients/agent-desktop/harness/packages/client/store/src/index.ts", {
    createStore: harnessRequire("zustand/vanilla").createStore,
    subscribeWithSelector: harnessRequire("zustand/middleware").subscribeWithSelector,
    shallow: harnessRequire("zustand/shallow").shallow, ...harnessRequire("immer"), queueMicrotask
  }, [[/^import \{[\s\S]*?\} from '[^']+'$/gm, ""]]);
  let currentPanel = null, accept, props, catalogHandler, checkHandler, sourcesHandler;
  const calls = { catalog: 0, checks: 0, sources: 0 };
  const selection = { provider: "local", model: "model" }, binding = { actorId: "a", tenantId: "t", workspaceId: "w1" };
  const destination = { provider: selection.provider, baseUrl: "https://model.invalid/v1/" };
  const modelRoute = { ...destination, model: selection.model, protocol: "openai-completions" };
  const hash = "a".repeat(64), iso = time => new Date(time).toISOString();
  const observation = now;
  const result = () => {
    const catalog = { version: 1, requestId: "preview-1", binding, policyRevision: 1, policyHash: hash,
      observedAt: iso(observation), expiresAt: iso(observation + 30000), configurationVersion: hash,
      source: "persisted_workspace_configuration", destination, modelRoute,
      items: [{ reference: "catalog-ref-1", categoryCode: "camera", status: "enabled" }], truncated: false,
      omittedFields: ["name", "code", "unit", "availability", "price"], execution: "read_only" };
    const content = shared.projectRentalDesktopCatalogMaterial(catalog);
    return { catalog, inspection: { selection, destination, protocol: modelRoute.protocol, preparationVersion: hash,
      observedAt: iso(observation), expiresAt: iso(observation + 30000), source: "prepared_initial_route", execution: "not_dispatched" },
      material: { content, contentHash: createHash("sha256").update(content).digest("hex"), purpose: "human_preview", modelRequest: "not_sent" } };
  };
  const check = () => ({ version: 1, requestId: "check-1", binding, previewRequestId: "preview-1", sourceObservedAt: iso(observation),
    observedAt: iso(now), expiresAt: iso(Math.min(now + 5000, observation + 30000)), configurationVersion: hash,
    policyRevision: 1, policyHash: hash, modelRoute, execution: "display_check_only" });
  const sourceResult = () => ({ version: 1, requestId: "sources-1", binding, observedAt: iso(now), expiresAt: iso(now + 60000),
    items: [{ state: "reference", auditId: "audit-1", requestId: "preview-1", observedAt: iso(observation), sourceExpiresAt: iso(observation + 86400000),
      query: { limit: 10, destination, modelRoute }, configurationVersion: hash, policyRevision: 1, policyHash: hash }], truncated: false, execution: "references_only" });
  const bridge = { protocolVersion: 1, read: async () => ({ protocolVersion: 1, revision: 1, session: sample() }),
    subscribe: fn => { accept = fn; return () => { accept = undefined; }; }, present: async () => {}, request: async () => {}, retry: async () => {},
    catalogForModel: query => {
      calls.catalog++;
      if (catalogHandler) return catalogHandler(query);
      const response = result();
      if (query.sourceRef) response.catalog.reopenedFrom = { ...query.sourceRef, observedAt: iso(observation), configurationVersion: hash };
      return Promise.resolve(response);
    },
    checkCatalogForModel: query => { calls.checks++; return checkHandler ? checkHandler(query) : Promise.resolve(check()); },
    catalogSources: () => { calls.sources++; return sourcesHandler ? sourcesHandler() : Promise.resolve(sourceResult()); } };
  const ctx = { layout: { panelInfo: { getSnapshot: () => ({ activePanelId: currentPanel }),
    subscribe: fn => { modeListeners.add(fn); return () => modeListeners.delete(fn); } },
    selectPanel: value => { currentPanel = value; for (const fn of modeListeners) fn(); } },
    locale: { register: () => () => {} }, effect: fn => { effects.push(fn()); },
    slots: { inject: (_name, fn) => { effects.push(fn()); }, register: (options, component) => {
      props = options.inject(); registrations.set(options.name, component); return () => registrations.delete(options.name);
    } } };
  const locale = load(`${workbench}locales.ts`);
  const plugin = load(`${workbench}index.ts`, { ...shared, ...store, ...locale, document, window, MutationObserver: window.MutationObserver, rentalDesktop: bridge, Date: Clock,
    crypto: { subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer } },
    WorkbenchContext: {}, WorkbenchNavigation: {}, WorkbenchMain: {}, WorkbenchToast: {},
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout: id => timers.delete(id)
  }, [[/^import \{[^}]*\} from '[^']+'$/gm, ""]]);
  plugin.apply(ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const mount = () => {
    const catalog = document.createElement("details"), sources = document.createElement("details");
    catalog.open = sources.open = true; catalog.append(sources); document.body.append(catalog);
    const releaseCatalog = props.observePreview(catalog, "catalog"), releaseSources = props.observePreview(sources, "sources");
    return { catalog, sources, close: element => { element.open = false; element.dispatchEvent(new window.Event("toggle")); },
      dispose: () => { releaseSources(); releaseCatalog(); catalog.remove(); } };
  };
  return { dom, window, document, props, locale, calls, selection, result, check, sourceResult, mount, flush,
    state: () => props.hooks.business.getSnapshot(), timers,
    setCatalog: fn => { catalogHandler = fn; }, setCheck: fn => { checkHandler = fn; }, setSources: fn => { sourcesHandler = fn; },
    accept: session => accept({ protocolVersion: 1, revision: 2, session }), mode: ctx.layout.selectPanel,
    blur: () => { focused = false; window.dispatchEvent(new window.Event("blur")); },
    hide: () => { hidden = true; document.dispatchEvent(new window.Event("visibilitychange")); },
    advance: async ms => {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
      }
      now = end; await flush();
    },
    dispose: () => { for (const cleanup of effects.reverse()) cleanup?.(); dom.window.close(); }
  };
}

test("workbench withdraws closed, collapsed, inactive and changed previews without reviving late reads", async () => {
  for (const action of ["close", "rapid-reopen", "collapse", "sources", "clear", "blur", "hidden", "mode", "scope", "dispose"]) {
    const f = workbenchFixture();
    try {
      await f.flush(); const view = f.mount();
      f.props.readSources(); f.props.readCatalog({ selection: f.selection, limit: 10 }); await f.flush();
      assert.equal(f.state().catalog.status, "ready", action); assert.equal(f.state().sources.status, "ready", action);
      const pending = deferred(); f.setCheck(() => pending.promise);
      await f.advance(3000); assert.equal(f.calls.checks, 2);
      if (action === "close") view.close(view.catalog);
      else if (action === "rapid-reopen") { view.catalog.open = false; view.catalog.open = true; await f.flush(); }
      else if (action === "collapse") view.dispose();
      else if (action === "sources") view.close(view.sources);
      else if (action === "clear") f.props.clearMaterials();
      else if (action === "blur") f.blur();
      else if (action === "hidden") f.hide();
      else if (action === "mode") f.mode("rental-business");
      else if (action === "scope") f.accept({ ...sample(), currentWorkspaceId: "w2" });
      else f.dispose();
      const status = f.state().catalog.status;
      assert.ok(["inactive", "cleared", "changed"].includes(status), action);
      assert.equal(f.state().catalog.result, null); assert.equal(f.state().catalog.material, null);
      assert.equal(f.state().sources.result, null); assert.equal(f.timers.size, 0);
      pending.resolve(f.check()); await f.flush(); await f.advance(10000);
      assert.equal(f.state().catalog.status, status); assert.equal(f.timers.size, 0);
      const count = f.calls.catalog;
      f.props.readCatalog({ selection: f.selection, limit: 10, sourceRef: { auditId: "audit-1", requestId: "preview-1" } });
      await f.flush(); assert.equal(f.calls.catalog, count, "discarded references cannot restart a read");
      view.dispose();
    } finally { if (action !== "dispose") f.dispose(); }
  }
  for (const kind of ["catalog", "sources"]) {
    const f = workbenchFixture();
    try {
      await f.flush(); const view = f.mount(), pending = deferred();
      if (kind === "catalog") { f.setCatalog(() => pending.promise); f.props.readCatalog({ selection: f.selection, limit: 10 }); }
      else { f.setSources(() => pending.promise); f.props.readSources(); }
      await f.flush(); view.dispose();
      const reopened = f.mount(); pending.resolve(kind === "catalog" ? f.result() : f.sourceResult()); await f.flush();
      assert.equal(f.state()[kind].result, null); assert.equal(f.state()[kind].status, "inactive");
      assert.equal(f.calls[kind], 1); assert.equal(f.calls.checks, 0); reopened.dispose();
    } finally { f.dispose(); }
  }
});

test("workbench expiry and failed checks keep explicit states and never extend original display deadlines", async () => {
  const f = workbenchFixture();
  try {
    await f.flush(); f.mount(); f.props.readSources(); f.props.readCatalog({ selection: f.selection, limit: 10 }); await f.flush();
    const sourceDeadline = f.state().sources.result.expiresAt;
    await f.advance(30000);
    assert.equal(f.state().catalog.status, "expired"); assert.equal(f.state().catalog.material, null);
    assert.equal(f.state().sources.result.expiresAt, sourceDeadline);
    await f.advance(30000); assert.equal(f.state().sources.status, "expired"); assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
  for (const failure of ["stuck", "denied"]) {
    const f = workbenchFixture();
    try {
      await f.flush(); f.mount(); f.props.readSources(); f.props.readCatalog({ selection: f.selection, limit: 10 }); await f.flush();
      f.setCheck(() => failure === "denied" ? Promise.reject(new Error("denied")) : deferred().promise);
      await f.advance(5000);
      assert.equal(f.state().catalog.status, failure === "denied" ? "failed" : "expired");
      assert.equal(f.state().catalog.material, null);
      if (failure === "denied") { assert.equal(f.state().sources.status, "failed"); assert.equal(f.timers.size, 0); }
    } finally { f.dispose(); }
  }
});

test("workbench presentation clears on real component unmount and offers localized manual clearing", async () => {
  const f = workbenchFixture(), React = harnessRequire("react"), { createRoot } = harnessRequire("react-dom/client");
  const { act } = React;
  const previous = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: f.window, document: f.document, IS_REACT_ACT_ENVIRONMENT: true }))
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  const container = f.document.createElement("div"); f.document.body.append(container); const renderer = createRoot(container);
  const primitive = (tag, omit = []) => ({ children, ...props }) => {
    for (const key of omit) delete props[key];
    return React.createElement(tag, props, children);
  };
  const { WorkbenchContext } = load(`${workbench}Workbench.tsx`, { React, ...React, ...shared,
    Button: primitive("button", ["variant"]), Input: primitive("input"), Menu: () => null, SegmentedControl: () => null,
    Tooltip: ({ children }) => children, Toast: () => null, IconWarningOutlineRegular: () => null, IconChevronDownOutlineRegular: () => null,
    css: {} }, [[/^import \{[^}]*\} from '[^']+'$/gm, ""], [/^import css from '[^']+'$/gm, ""]]);
  const render = async wide => { await act(async () => {
    renderer.render(React.createElement(WorkbenchContext, { ...f.props, wide,
      useBusiness: select => select(f.state()), useWorkMode: select => select("ai"), t: key => f.locale.zh[key] })); await f.flush();
  }); };
  try {
    await f.flush(); await render(true);
    const open = () => { for (const element of container.querySelectorAll("details")) {
      element.open = true; element.dispatchEvent(new f.window.Event("toggle"));
    } };
    open(); f.props.readCatalog({ selection: f.selection, limit: 10 }); await f.flush(); await render(true);
    assert.match(container.textContent, /catalog-ref-1/);
    await render(false); assert.equal(f.state().catalog.status, "inactive"); assert.equal(f.timers.size, 0);
    await render(true); assert.doesNotMatch(container.textContent, /catalog-ref-1/); assert.match(container.textContent, /预览已撤回/);
    assert.ok([...container.querySelectorAll("input")].every(input => input.value === "")); assert.equal(f.calls.catalog, 1);
    open(); f.props.readSources(); await f.flush(); await render(true);
    const reopen = [...container.querySelectorAll("button")].find(button => button.textContent === f.locale.zh.catalogReopenSource);
    assert.ok(reopen); await act(async () => { reopen.click(); await f.flush(); }); await render(true);
    assert.equal(f.state().catalog.result.reopenedFrom.auditId, "audit-1");
    assert.equal(container.querySelector("input").value, "show first 10 products");
    const clear = [...container.querySelectorAll("button")].find(button => button.textContent === f.locale.zh.catalogClear);
    assert.ok(clear); await act(async () => clear.click()); await render(true);
    assert.equal(f.state().catalog.material, null); assert.equal(f.state().sources.result, null); assert.equal(f.timers.size, 0);
    assert.match(container.textContent, /当前预览已清除/); assert.match(container.textContent, /不删除正式业务记录/);
    assert.equal(f.state().catalog.status, "cleared");
    assert.ok([...container.querySelectorAll("input")].every(input => input.value === ""));
  } finally {
    await act(async () => renderer.unmount()); f.dispose();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
