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
  source = stripTypeScriptTypes(source, { mode: "transform" });
  const scope = { module: { exports: {} }, require, URL, TextEncoder, Event, console, process,
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
