"use strict";
/**
 * 租户员工微信小程序静态与宿主替身测试（STAFF-MP）。
 *
 * 不起服务、不连数据库、不开浏览器：用 vm 隔离加载 TS 源码，注入一个最小 `wx` 替身，
 * 验证工程结构、WXML/WXSS 语法、数据绑定与事件绑定、安全底线、多品类术语纪律，以及
 * 会话/权限/刷新/上下文/扫码等必须由客户端保证的行为。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");
const { RENTAL_CATEGORY_DEFINITIONS } = require("../packages/shared/dist");

const root = path.resolve(__dirname, "../apps/staff-miniprogram");
const src = path.join(root, "src");
const apiSrc = path.resolve(__dirname, "../apps/api/src");
const read = (file) => fs.readFileSync(path.join(src, file), "utf8");
const readApi = (file) => fs.readFileSync(path.join(apiSrc, file), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const app = JSON.parse(read("app.json"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);

/** 宿主替身：记录每次 wx.request / 跳转 / 弹窗，网络响应由 handler 决定。 */
function runtime(handler) {
  const modules = new Map();
  const storage = new Map();
  const calls = [];
  const navigations = [];
  const modals = [];
  const tabBarStyles = [];
  let themeListener;
  let modalAnswer = false;
  const wx = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      calls.push(options);
      queueMicrotask(() => handler?.(options));
      return { abort() {} };
    },
    showModal(options) {
      modals.push(options);
      options.success?.({ confirm: modalAnswer, cancel: !modalAnswer, content: "reason" });
    },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    navigateTo: (options) => navigations.push(options.url),
    redirectTo: (options) => navigations.push(options.url),
    switchTab: (options) => navigations.push(options.url),
    reLaunch: (options) => navigations.push(options.url),
    navigateBack() {},
    downloadFile: (options) => options.success?.({ statusCode: 200, tempFilePath: "wxfile://tmp/image" }),
    makePhoneCall() {},
    setClipboardData() {},
    setNavigationBarTitle() {},
    stopPullDownRefresh() {},
    scanCode() {},
    getAppBaseInfo: () => ({ theme: "light" }),
    onThemeChange: (listener) => { themeListener = listener; },
    setTabBarStyle: (options) => tabBarStyles.push(options),
    getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, left: 290, height: 32, width: 87 })
  };
  const context = vm.createContext({
    wx, Promise, Date, Math, Map, Set, Number, String, Object, Array, Error, JSON, Intl, Symbol, Reflect, Boolean, RegExp,
    Uint8Array, ArrayBuffer, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    getCurrentPages: () => [], Page: () => {}, Component: () => {}, Behavior: (def) => def, App: () => {}, console
  });
  function load(relative) {
    let absolute = path.resolve(src, relative);
    if (!path.extname(absolute)) absolute += ".ts";
    if (modules.has(absolute)) return modules.get(absolute).exports;
    assert.ok(absolute.startsWith(src + path.sep), `模块不能逃出 src：${relative}`);
    const module = { exports: {} };
    modules.set(absolute, module);
    const output = ts.transpileModule(fs.readFileSync(absolute, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const fn = vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename: absolute });
    fn((specifier) => {
      assert.ok(specifier.startsWith("."), `小程序运行时不得依赖包 ${specifier}（只允许 import type）`);
      return load(path.relative(src, path.resolve(path.dirname(absolute), specifier)));
    }, module, module.exports);
    return module.exports;
  }
  const config = load("config/public");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "https://api.example.invalid", appId: "wx0000000000000000", allowLocalApi: false });
  return { load, wx, storage, calls, navigations, modals, tabBarStyles, fireTheme: (theme) => themeListener?.({ theme }), setModalAnswer: (value) => { modalAnswer = value; } };
}

const loginResponse = (overrides = {}) => ({
  accessToken: "access-one",
  refreshToken: "refresh-one",
  expiresIn: 3600,
  tenant: { tenantId: "tenant-one", tenantCode: "demo", tenantName: "演示租户", tenantStatus: "active" },
  user: {
    id: "user-one", tenantId: "tenant-one", account: "staff01", displayName: "张三", roleNames: ["门店员工"], scope: "store",
    dataScope: "store", permissions: ["rental-os:order:view", "rental-os:order:operate", "rental-os:order:pickup"],
    tenantMembership: { permissions: ["rental-os:order:view"], dataScope: "store", isTenantAdmin: false }
  },
  workspaces: [
    { id: "ws-camera", tenantId: "tenant-one", code: "camera", name: "摄影器材", categoryCode: "camera", status: "enabled", isDefault: true, runMode: "production", createdAt: "", updatedAt: "" },
    { id: "ws-camping", tenantId: "tenant-one", code: "camping", name: "露营装备", categoryCode: "camping", status: "enabled", isDefault: false, runMode: "production", createdAt: "", updatedAt: "" }
  ],
  currentWorkspaceId: "ws-camera",
  ...overrides
});
const ok = (req, data, header = {}) => req.success({ statusCode: 200, data: { data, requestId: "request-one" }, header });
const status = (req, statusCode, message = "error") => req.success({ statusCode, data: { statusCode, message }, header: {} });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function subscriptionFixture(serviceStatus = "active") {
  return {
    overview: { tenantId: "tenant-one", tenantName: "租户", tenantCode: "demo", plan: "standard", serviceStatus, revision: 4, startAt: "2026-01-01T00:00:00Z", endAt: "2028-01-01T00:00:00Z", timeZone: "Asia/Shanghai" },
    entitlements: [],
    reminder: { plan: "standard", serviceStatus, stage: serviceStatus === "expired" ? "expired" : "normal", revision: 4, endAt: "2028-01-01T00:00:00Z", timeZone: "Asia/Shanghai", hasOpenRequest: false }
  };
}

test("同身份令牌刷新不作废正在重放的订阅请求", async () => {
  const waiting = [];
  const rt = runtime((req) => waiting.push(req));
  const session = rt.load("core/session");
  session.saveSession(loginResponse(), "test");
  const sub = rt.load("core/subscription");
  const request = sub.loadSubscription(true);
  await tick();
  session.saveSession(loginResponse({ accessToken: "rotated-token" }), "refresh");
  await tick();
  assert.equal(waiting.length, 1);
  assert.equal(sub.loadSubscription(), request);
  ok(waiting[0], subscriptionFixture());
  await request;
  assert.equal(sub.subscriptionLoadStatus(), "ready");
});

test("订阅缓存：同上下文迟到请求不覆盖新请求，也不清除新 inflight", async () => {
  const waiting = [];
  const rt = runtime((req) => waiting.push(req));
  rt.load("core/session").saveSession(loginResponse(), "test");
  const sub = rt.load("core/subscription");
  const old = sub.loadSubscription(true);
  const rejected = assert.rejects(old, /已刷新/);
  await tick();
  const next = sub.loadSubscription(true);
  await tick();
  ok(waiting[0], subscriptionFixture());
  await rejected;
  assert.equal(sub.cachedSubscription(), undefined);
  assert.equal(sub.loadSubscription(), next);
  const fresh = subscriptionFixture(); fresh.overview.revision = 5;
  ok(waiting[1], fresh);
  await next;
  assert.equal(sub.cachedSubscription().overview.revision, 5);
});

test("订阅缓存：跨租户迟到响应被拒，网络失败不伪造版本且可重试", async () => {
  const waiting = [];
  const rt = runtime((req) => waiting.push(req));
  const session = rt.load("core/session");
  session.saveSession(loginResponse(), "test");
  const sub = rt.load("core/subscription");
  const old = sub.loadSubscription();
  const rejected = assert.rejects(old, /已刷新/);
  await tick();
  session.saveSession(loginResponse({ tenant: { tenantId: "tenant-two", tenantCode: "two", tenantName: "另一个租户" } }), "switch");
  await tick();
  ok(waiting[0], subscriptionFixture());
  await rejected;
  const pending = sub.loadSubscription();
  const fails = assert.rejects(pending);
  status(waiting[1], 500, "暂不可用");
  await fails;
  assert.equal(sub.cachedSubscription(), undefined);
  assert.equal(sub.subscriptionSummary().ready, false);
  assert.equal(sub.subscriptionLoadStatus(), "error");
  const retry = sub.loadSubscription(); await tick();
  const fresh = subscriptionFixture(); fresh.overview.tenantId = "tenant-two";
  ok(waiting[2], fresh); await retry;
  assert.equal(sub.cachedSubscription().overview.tenantId, "tenant-two");
});

test("订阅提醒关闭：账号、租户、修订、阶段和服务时区自然日隔离", async () => {
  let facts = subscriptionFixture();
  const rt = runtime((req) => ok(req, facts));
  const session = rt.load("core/session");
  session.saveSession(loginResponse(), "test");
  const sub = rt.load("core/subscription");
  await sub.loadSubscription();
  const key = sub.subscriptionReminder().key;
  assert.ok(key);
  sub.dismissSubscriptionReminder(key);
  assert.equal(sub.subscriptionReminder().visible, false);
  facts = subscriptionFixture(); facts.overview.revision = 5; facts.reminder.revision = 5;
  await sub.loadSubscription(true);
  assert.equal(sub.subscriptionReminder().visible, true);
  const date = new Date("2026-09-29T15:59:59Z");
  const before = sub.reminderDismissalKey(facts, date);
  const after = sub.reminderDismissalKey(facts, new Date("2026-09-29T16:00:00Z"));
  assert.notEqual(before, after);
  const urgent = structuredClone(facts); urgent.reminder.stage = "urgent";
  assert.notEqual(before, sub.reminderDismissalKey(urgent, date));
  session.saveSession(loginResponse({ user: { ...loginResponse().user, id: "other-user" } }), "switch");
  assert.notEqual(before, sub.reminderDismissalKey(facts, date));
  session.clearSession("logout");
  assert.equal(sub.cachedSubscription(), undefined);
  assert.equal(rt.storage.has(rt.load("core/storage").STORAGE_KEYS.subscriptionDismissals), false);
});

test("订阅动作守卫：到期新业务拒绝，履约善后仍按原权限，不用缓存授予写权限", async () => {
  const login = loginResponse(); login.user.permissions = ["*"];
  let facts = subscriptionFixture("expired");
  const rt = runtime((req) => {
    if (req.url.endsWith("/auth/session-context")) return ok(req, login);
    if (req.url.endsWith("/subscription/context")) return ok(req, facts);
    if (req.url.endsWith("/categories")) return ok(req, structuredClone(RENTAL_CATEGORY_DEFINITIONS.filter(row => row.code === "camera")));
    if (req.url.endsWith("/locations")) return ok(req, []);
    ok(req, { id: "done" });
  });
  rt.load("core/session").saveSession(login, "test");
  const sub = rt.load("core/subscription");
  const access = rt.load("core/subscription-access");
  await sub.loadSubscription();
  for (const action of ["order.create", "order.quote", "order.extend"]) assert.equal(access.staffActionAccess(action).allowed, false);
  for (const action of ["order.return", "order.pickup", "order.cancel", "order.settle", "maintenance.manage"]) assert.equal(access.staffActionAccess(action).allowed, true);
  let wrote = false;
  await assert.rejects(access.withStaffAction("order.create", async () => { wrote = true; }), /到期/);
  assert.equal(wrote, false);
  facts = subscriptionFixture("unconfigured");
  await access.withStaffAction("order.create", async () => { wrote = true; });
  assert.equal(wrote, true);
  sub.invalidateSubscription();
  assert.equal(access.staffActionAccess("order.create").allowed, false);
  assert.equal(access.staffActionAccess("order.return").allowed, true);
});

/* ---------------- 工程结构 ---------------- */

test("app.json 声明 28 个页面、4 个 Tab（工作台/订单/扫码/我的），每个页面与组件四件套齐全；组件按页面注册", () => {
  assert.equal(app.pages.length, 28);
  assert.ok(app.pages.includes("pages/subscription/index"));
  assert.equal(app.pages[0], "pages/login/index", "登录页必须是默认入口 pages[0]");
  assert.equal(new Set(app.pages).size, app.pages.length);
  same(app.tabBar.list.map((row) => row.text), ["工作台", "订单", "扫码", "我的"]);
  for (const row of app.tabBar.list) {
    assert.ok(app.pages.includes(row.pagePath));
    for (const icon of [row.iconPath, row.selectedIconPath]) {
      assert.match(icon, /^assets\/tab\/[a-z-]+\.png$/, `Tab 图标必须是包内 PNG：${icon}`);
      assert.ok(fs.existsSync(path.join(src, icon)), `Tab 图标缺失：${icon}`);
    }
  }
  for (const asset of ["assets/logo.png", "assets/logo-mark.png"]) assert.ok(fs.existsSync(path.join(src, asset)), `品牌资源缺失：${asset}`);
  assert.equal(app.usingComponents, undefined, "全局注册自定义组件会削弱 lazyCodeLoading 的按需注入");
  assert.equal(app.lazyCodeLoading, "requiredComponents");
  assert.equal(app.darkmode, true);
  assert.equal(app.themeLocation, "theme.json");
  const theme = JSON.parse(read("theme.json"));
  for (const variant of ["light", "dark"]) {
    for (const key of ["navBg", "navText", "pageBg", "bgText", "tabColor", "tabSelectedColor", "tabBg", "tabBorder"]) assert.ok(theme[variant][key], `theme.json ${variant} 缺变量 ${key}`);
  }
  for (const value of [app.tabBar.color, app.tabBar.selectedColor, app.tabBar.backgroundColor, app.tabBar.borderStyle, app.window.navigationBarBackgroundColor, app.window.backgroundColor]) {
    assert.match(value, /^@[a-zA-Z]+$/, `原生颜色应引用 theme.json 变量而非写死：${value}`);
  }
  assert.equal(app.window.navigationStyle, "custom");
  assert.ok(app.permission && app.permission["scope.camera"] && app.permission["scope.camera"].desc, "扫码需要声明 scope.camera 用途");
  assert.equal(app.requiredPrivateInfos, undefined, "员工端首期不申请位置等隐私接口");
  const componentTags = ["nav-bar", "ui-icon", "state-view", "money-text", "status-tag", "sheet", "subscription-card", "ai-task-workbench"];
  const registeredComponents = new Set();
  for (const route of app.pages) {
    for (const ext of ["ts", "json", "wxml", "wxss"]) assert.ok(read(`${route}.${ext}`).trim(), `${route}.${ext} 缺失或为空`);
    const tsText = read(`${route}.ts`);
    assert.match(tsText, /\bPage\(\{/);
    assert.match(tsText, /behaviors:\s*\[themeBehavior\]/, `${route} 必须接入 themeBehavior（深浅色）`);
    const pageJson = JSON.parse(read(`${route}.json`));
    const wxml = read(`${route}.wxml`);
    assert.match(wxml, /^<page-meta page-style="\{\{themeStyle\}\}" root-class="\{\{themeClass\}\}">/, `${route}.wxml 首行必须是 page-meta 主题绑定`);
    if (route === "pages/scanner/index") {
      assert.match(wxml, /padding-top:\s*\{\{statusBarHeight\}\}px/, "全屏取景页必须避让状态栏");
    } else {
      assert.match(wxml, /<nav-bar\b/, `${route} 必须使用 <nav-bar>（自定义导航栏下否则内容顶到状态栏）`);
    }
    const used = componentTags.filter((tag) => new RegExp(`<${tag}\\b`).test(wxml));
    const declared = Object.keys(pageJson.usingComponents ?? {});
    same([...used].sort(), [...declared].sort(), `${route} 使用的组件与 usingComponents 声明不一致`);
    for (const [tag, componentPath] of Object.entries(pageJson.usingComponents ?? {})) {
      const expectedPath = tag === "ai-task-workbench" ? "/components/ai-native/ai-task-workbench/index" : `/components/${tag}/index`;
      assert.equal(componentPath, expectedPath);
      registeredComponents.add(componentPath);
    }
  }
  const scanEntry = read("pages/scan/index.wxml");
  assert.doesNotMatch(scanEntry, /<camera\b/, "扫码 Tab 一级页是操作入口，不应直接启动摄像头");
  assert.match(scanEntry, /bindtap="onStartScan"/, "扫码入口页应提供开始扫码按钮");
  assert.match(read("pages/scan/index.ts"), /onStartScan\(\)[\s\S]*?navigate\(ROUTES\.scanner\)/, "开始扫码按钮应打开独立取景页");
  assert.match(read("pages/scanner/index.wxml"), /<camera\b/, "独立取景页应由相机组件识码");
  const scanStyles = read("pages/scan/index.wxss");
  assert.match(scanStyles, /\.scan-cta\s*\{[^}]*width:\s*100%[^}]*height:\s*148rpx/s, "扫码主按钮必须保持整栏宽和设计稿高度");
  const appStyles = read("app.wxss");
  assert.match(appStyles, /\.btn\s*\{[^}]*height:\s*88rpx/s, "通用按钮保持原始 88rpx 点击高度");
  assert.match(appStyles, /\.btn--cta\s*\{\s*height:\s*96rpx/s, "主操作按钮保持原始 96rpx 点击高度");
  assert.match(appStyles, /\.cell\s*\{[^}]*min-height:\s*104rpx/s, "个人页菜单行保持原始 104rpx 点击高度");
  assert.match(read("staff.wxss"), /\.todo\s*\{[^}]*min-height:\s*88rpx/s, "工作台待办行保持原始 88rpx 点击高度");
  assert.doesNotMatch(read("pages/me/index.wxss"), /\.menu\s+\.cell\s*\{[^}]*min-height\s*:/s, "个人页不得再次缩小共享菜单行高度");
  assert.doesNotMatch(read("pages/workbench/index.wxss"), /\.todo\s*\{[^}]*min-height\s*:/s, "工作台不得再次缩小共享待办行高度");
  for (const componentPath of registeredComponents) {
    const relative = componentPath.slice(1);
    for (const ext of ["ts", "json", "wxml", "wxss"]) assert.ok(read(`${relative}.${ext}`).trim());
    assert.equal(JSON.parse(read(`${relative}.json`)).component, true);
    assert.match(read(`${relative}.ts`), /\bComponent\(\{/);
  }
  const sitemap = JSON.parse(read("sitemap.json"));
  assert.ok(sitemap.rules.some((rule) => rule.action === "disallow" && rule.page === "*"), "内部工具页面不得被索引");
});

test("WXSS/WXML 只使用小程序编译器支持的语法", () => {
  for (const file of walk(src).filter((f) => f.endsWith(".wxss"))) {
    const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const label = path.relative(root, file);
    assert.doesNotMatch(css, /(^|[\s>+~,])\*(?=\s*[{+>~,.:#\[]|\s*$)/m, `${label}：WXSS 不支持通配符选择器 *`);
    assert.doesNotMatch(css, /:empty\b/, `${label}：不依赖 :empty`);
    assert.doesNotMatch(css, /(^|[\s;{])inset\s*:/m, `${label}：inset 简写在旧 WebView 不可用`);
  }
  for (const file of walk(src).filter((f) => f.endsWith(".wxml"))) {
    const label = path.relative(root, file);
    const wxml = fs.readFileSync(file, "utf8");
    for (const match of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
      const expression = match[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      assert.doesNotMatch(expression, /[()]/, `${label}：WXML 表达式不支持括号，请在 TS 中预先计算：${match[1].trim()}`);
      assert.doesNotMatch(expression, /!!/, `${label}：WXML 表达式避免 !!：${match[1].trim()}`);
    }
    for (const match of wxml.matchAll(/wx:for="[^"]*"[^>]*wx:key="([^"]+)"/g)) {
      assert.notEqual(match[1], "index", `${label}：wx:key="index" 不是有效的 key`);
    }
  }
});

test("页面 WXML 里的每个数据绑定都对应页面 data 的已声明字段，组件属性都已声明（AST 交叉核对）", () => {
  const componentProps = {
    "nav-bar": ["title", "back", "transparent", "location", "minimal"],
    "ui-icon": ["name", "color", "size", "filled", "stroke"],
    "state-view": ["state", "title", "message", "actionText", "secondaryText", "compact"],
    "money-text": ["amount", "currency", "size", "signed", "prefix", "tone"],
    "status-tag": ["label", "tone", "small"],
    sheet: ["visible", "title", "closable", "footer"]
  };
  for (const route of app.pages) {
    const tsText = read(`${route}.ts`);
    const sf = ts.createSourceFile(`${route}.ts`, tsText, ts.ScriptTarget.Latest, true);
    const dataKeys = new Set();
    (function visit(node) {
      const literal = ts.isPropertyAssignment(node) && node.name.getText(sf) === "data"
        ? ts.isObjectLiteralExpression(node.initializer) ? node.initializer : ts.isAsExpression(node.initializer) && ts.isObjectLiteralExpression(node.initializer.expression) ? node.initializer.expression : undefined
        : undefined;
      if (literal) for (const property of literal.properties) if (property.name) dataKeys.add(property.name.getText(sf).replace(/['"]/g, ""));
      if (ts.isInterfaceDeclaration(node) && /Data$/.test(node.name.text)) for (const member of node.members) if (member.name) dataKeys.add(member.name.getText(sf));
      if (ts.isCallExpression(node) && node.expression.getText(sf).endsWith("setData") && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const property of node.arguments[0].properties) if (property.name) dataKeys.add(property.name.getText(sf).replace(/['"]/g, "").split(/[.[]/)[0]);
      }
      ts.forEachChild(node, visit);
    })(sf);
    dataKeys.add("themeStyle");
    dataKeys.add("themeClass");
    const wxml = read(`${route}.wxml`);
    const loopVars = new Set(["item", "index"]);
    for (const match of wxml.matchAll(/wx:for-item="([^"]+)"/g)) loopVars.add(match[1]);
    for (const match of wxml.matchAll(/wx:for-index="([^"]+)"/g)) loopVars.add(match[1]);
    for (const match of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
      const expression = match[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      for (const identifier of expression.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)) {
        const name = identifier[1];
        if (["true", "false", "null", "undefined"].includes(name) || loopVars.has(name)) continue;
        assert.ok(dataKeys.has(name), `${route}.wxml 绑定了未声明的数据字段 ${name}（表达式：${match[1].trim()}）`);
      }
    }
    for (const match of wxml.matchAll(/<(nav-bar|ui-icon|state-view|money-text|status-tag|sheet)\b([^>]*)>/g)) {
      for (const attribute of match[2].matchAll(/\s([a-zA-Z:-]+)=/g)) {
        const name = attribute[1];
        if (/^(wx:|bind|catch|class$|style$|slot$|hover-class$|data-)/.test(name)) continue;
        assert.ok(componentProps[match[1]].includes(name), `${route}.wxml 向 <${match[1]}> 传了未声明的属性 ${name}`);
      }
    }
  }
});

test("每个 WXML 事件都绑定到已实现的 Page/Component 方法，且不含 web-view/script", () => {
  for (const wxmlFile of walk(src).filter((file) => file.endsWith(".wxml"))) {
    const tsFile = wxmlFile.replace(/\.wxml$/, ".ts");
    const sourceFile = ts.createSourceFile(tsFile, fs.readFileSync(tsFile, "utf8"), ts.ScriptTarget.Latest, true);
    const methods = new Set();
    (function visit(node) {
      if ((ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) && node.name) methods.add(node.name.getText(sourceFile).replace(/['"]/g, ""));
      ts.forEachChild(node, visit);
    })(sourceFile);
    const wxml = fs.readFileSync(wxmlFile, "utf8");
    for (const match of wxml.matchAll(/\b(?:bind|catch|capture-bind|capture-catch):?[\w-]+\s*=\s*"([^"]+)"/g)) {
      assert.ok(methods.has(match[1]), `${path.relative(root, wxmlFile)} 绑定了未实现的方法 ${match[1]}`);
    }
    assert.doesNotMatch(wxml, /<(?:script|web-view)\b/i);
  }
});

/* ---------------- 多品类纪律 ---------------- */

test("领取/归还检查按服务端模板校验必填和数值；照片字段只提交已上传文件资产 ID", () => {
  const { inspectionRows, inspectionResults } = runtime().load("core/inspection-form");
  const template = {
    fields: [
      { code: "condition", label: "外观", type: "text", required: true },
      { code: "usage", label: "读数", type: "number", required: true },
      { code: "ok", label: "确认", type: "boolean", required: true }
    ]
  };
  const rows = inspectionRows(template);
  assert.match(inspectionResults(rows).error, /外观/);
  rows[0].value = "完好";
  rows[1].value = "not-a-number";
  assert.match(inspectionResults(rows).error, /读数/);
  rows[1].value = "12.5";
  same(inspectionResults(rows).results, { condition: "完好", usage: 12.5, ok: false });
  const photo = inspectionRows({ fields: [{ code: "evidence", label: "交接照片", type: "photo", required: true }] });
  assert.match(inspectionResults(photo).error, /上传照片凭证/);
  photo[0].photos.push({ id: "file-evidence-1", path: "wxfile://evidence" });
  same(inspectionResults(photo).results, { evidence: ["file-evidence-1"] });
});

test("员工交接照片、现场签字与线下收款均有服务端闭环和权限校验", () => {
  const uploads = readApi("modules/files/staff-uploads.controller.ts");
  const fileStorage = readApi("modules/integrations/file-storage.runtime.service.ts");
  const orderController = readApi("modules/rental-core/rental-core.controller.ts");
  const offlinePayments = readApi("modules/rental-core/staff-offline-payment.service.ts");
  assert.match(fileStorage, /uploadedByUserId/);
  assert.match(uploads, /handoverBatchId/);
  assert.match(uploads, /handoverLocationId/);
  assert.match(uploads, /returnLocationId: \{ in: locationIds \}/);
  assert.match(orderController, /员工端交接必须先完成客户现场签字/);
  assert.match(orderController, /businessId: order\.id, status: "active"/);
  assert.match(orderController, /metadata\.handoverBatchId !== batchId/);
  assert.match(orderController, /metadata\.uploadedByUserId !== req\.user\.id/);
  assert.match(offlinePayments, /this\.prisma\.\$transaction\(async \(tx\)/);
  assert.match(offlinePayments, /allowPartialInitiate: !originated/);
  for (const route of ["pickup", "return"]) {
    const page = read(`pages/${route}/index.ts`);
    const wxml = read(`pages/${route}/index.wxml`);
    assert.match(page, /uploadStaffImage/);
    assert.match(page, /handover-signature/);
    assert.match(wxml, /canvas-id=/);
    assert.match(wxml, /onChooseEvidencePhoto/);
  }
});

test("现场新增与编辑动作调用现有业务契约，创建订单携带持久幂等键", async () => {
  const login = loginResponse();
  login.user.permissions.push("rental-os:order:create");
  const rt = runtime((req) => {
    if (req.url.endsWith("/auth/session-context")) return ok(req, login);
    if (req.url.endsWith("/subscription/context")) return ok(req, subscriptionFixture());
    if (req.url.endsWith("/categories")) return ok(req, structuredClone(RENTAL_CATEGORY_DEFINITIONS.filter(row => row.code === "camera")));
    if (req.url.endsWith("/locations")) return ok(req, []);
    ok(req, { id: "result-one" });
  });
  rt.load("core/session").saveSession(login, "test");
  const orders = rt.load("api/orders");
  const customers = rt.load("api/customers");
  await orders.quoteOrder({ customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: "loc-one", startAt: "2026-09-24T01:00:00.000Z", endAt: "2026-09-25T01:00:00.000Z", lines: [{ itemGroupId: "group-one", quantity: 1 }] });
  await orders.createOrder({ quoteId: "quote-one", customerType: "personal", customerName: "测试", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: "loc-one", startAt: "2026-09-24T01:00:00.000Z", endAt: "2026-09-25T01:00:00.000Z", lines: [{ itemGroupId: "group-one", quantity: 1 }] }, "stable-key");
  await customers.createCustomer({ customerType: "personal", name: "测试", phone: "13800000000" });
  await customers.updatePersonalCustomer("customer-one", { name: "更新" });
  const writes = rt.calls.filter((call) => ["POST", "PATCH", "PUT"].includes(call.method));
  same(writes.map((call) => new URL(call.url).pathname), ["/api/staff/v1/rental/v1/quotes", "/api/staff/v1/rental/v1/orders", "/api/staff/v1/platform/customers", "/api/staff/v1/membership/personal/customer-one"]);
  assert.equal(writes[1].header["Idempotency-Key"], "stable-key");
  assert.ok(rt.calls.filter((call) => call.url.endsWith("/subscription/context")).length >= 2);
});

test("订单内部备注与主管人工解除交接锁受权限保护、幂等并写入服务端审计", async () => {
  const rt = runtime((req) => ok(req, req.url.endsWith("internal-notes") ? { id: "note-one", content: "现场情况", operatorName: "员工甲", createdAt: "2026-09-24T01:00:00.000Z" } : { released: true, releasedOwnerName: "员工乙" }));
  rt.load("core/session").saveSession(loginResponse(), "test");
  const orders = rt.load("api/orders");
  await orders.listInternalOrderNotes("order-one");
  await orders.createInternalOrderNote("order-one", { content: "现场情况" }, "note-key");
  await orders.operationLock("order-one", { action: "force-release", reason: "员工乙离岗" }, "unlock-key");
  same(rt.calls.map((call) => [new URL(call.url).pathname, call.method]), [
    ["/api/staff/v1/rental/v1/orders/order-one/internal-notes", "GET"],
    ["/api/staff/v1/rental/v1/orders/order-one/internal-notes", "POST"],
    ["/api/staff/v1/rental/v1/orders/order-one/operation-lock", "POST"]
  ]);
  assert.equal(rt.calls[1].header["Idempotency-Key"], "note-key");
  assert.deepEqual(plain(rt.calls[2].data), { action: "force-release", reason: "员工乙离岗" });
  assert.equal(rt.calls[2].header["Idempotency-Key"], "unlock-key");

  const controller = readApi("modules/rental-core/rental-core.controller.ts");
  const allocation = readApi("modules/rental-core/rental-allocation.service.ts");
  const policy = readApi("common/staff-api-policy.ts");
  assert.match(controller, /@Get\("orders\/:id\/internal-notes"\)/);
  assert.match(controller, /@Post\("orders\/:id\/internal-notes"\)/);
  assert.match(controller, /action: "rental\.order\.internal_note"/);
  assert.match(controller, /replay: async \(response\) => response[\s\S]*?idempotent\.execute/);
  assert.match(controller, /人工解除交接锁需要资源改配权限/);
  assert.match(allocation, /previous\.ownerId === userId/);
  assert.match(read("pages/order/index.ts"), /activeOperationLock\.ownerId !== currentSession\(\)\?\.user\.id/);
  assert.match(allocation, /人工解除交接锁必须填写原因/);
  assert.match(allocation, /rental\.order\.operation_lock\.force_release/);
  assert.match(policy, /action === "force-release" \? \["rental-os:order:reassign"\]/);
  assert.match(readApi("contracts/openapi-document.ts"), /CreateRentalOrderInternalNoteRequest/);
});

test("页面不写死品类名词：行业词只能来自服务端术语 terms()，新增品类不改页面", () => {
  // 摄影/露营/车辆/工程四个品类各自的行业词。它们出现在页面里就意味着换一个品类会显示错词。
  const FORBIDDEN = /(相机|镜头|器材|露营|帐篷|车牌|\bVIN\b|快门|油量|电量|里程数|工时读数|摄影灯|稳定器)/;
  for (const route of app.pages) {
    for (const ext of ["wxml", "ts"]) {
      const text = read(`${route}.${ext}`).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      const hit = FORBIDDEN.exec(text);
      assert.equal(hit, null, `${route}.${ext} 写死了品类名词“${hit && hit[1]}”，请改用 terms()`);
    }
    // “设备”是摄影/工程的行业口径；页面可见文案里出现即说明没用术语（注释与代码标识符不算）。
    const wxml = read(`${route}.wxml`).replace(/<!--[\s\S]*?-->/g, "");
    const visibleText = wxml.replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visibleText, /设备/, `${route}.wxml 可见文案含“设备”，请改用 {{context.terminology.assetLabel}} 或 terms().assetLabel`);
  }
  // 术语解析只允许集中在 core/context.ts，且唯一的品类码分支是图标映射。
  const outsideContext = walk(src).filter((f) => f.endsWith(".ts") && !f.endsWith(path.join("core", "context.ts")));
  for (const file of outsideContext) {
    const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
    assert.doesNotMatch(text, /["'](camera|camping|vehicle|construction)["']\s*:/, `${path.relative(root, file)} 按品类码分支，请改由品类定义/术语驱动`);
  }
  assert.doesNotMatch(walk(src).filter((f) => /\.(ts|wxml|wxss|json)$/.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n"), /�/, "源码含替换字符（乱码）");
});

/* ---------------- 安全底线 ---------------- */

test("源码不含密钥、调试输出、运行时 shared 依赖与自引用；页面不接受租户/空间 ID 输入", () => {
  const source = walk(src).filter((file) => /\.(ts|wxml|json)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /(?:appSecret|session_key|apiV3Key|privateKey|merchantSecret|mchKey)\s*[:=]\s*["'][^"']+/i);
  assert.doesNotMatch(source, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(source, /(?:console\.(?:log|debug|info))\s*\(/);
  assert.doesNotMatch(source, /import\s+\{[^}]*\}\s+from\s+["']@rental-os\/shared["']/, "只能 import type，不能引入运行时值");
  for (const file of walk(path.join(src, "pages")).filter((f) => /\.(ts|wxml)$/.test(f))) {
    const text = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /(?:name|data-field|placeholder)\s*=\s*["'][^"']*(?:tenantId|workspaceId)[^"']*["']/i, `${path.relative(root, file)} 让用户输入租户/空间 ID`);
    assert.doesNotMatch(text, /tenantId\s*:/, `${path.relative(root, file)} 页面不得自行构造 tenantId`);
  }
  for (const file of walk(src).filter((f) => f.endsWith(".ts"))) {
    const self = file.replace(/\.ts$/, "");
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:import|export)[^;]*?from\s+["'](\.[^"']+)["']/g)) {
      const resolved = path.resolve(path.dirname(file), match[1]).replace(/\.(ts|js)$/, "");
      assert.notEqual(resolved, self, `${path.relative(root, file)} 从自身导入`);
    }
  }
  assert.doesNotMatch(read("config/public.ts"), /\btenantCode\s*:/, "员工端一套包服务所有租户，公开配置不得绑定租户编码");
});

/* ---------------- 会话与权限 ---------------- */

test("登录响应落成员工会话：权限码 can()、租户级 canTenant() 需全量范围；平台管理员按 * 放行；退出清理私有键", () => {
  const rt = runtime();
  const session = rt.load("core/session");
  assert.equal(session.isSignedIn(), false);
  session.saveSession(loginResponse(), "login");
  assert.equal(session.isSignedIn(), true);
  assert.equal(session.currentWorkspaceId(), "ws-camera");
  assert.equal(session.currentWorkspace().categoryCode, "camera");
  assert.equal(session.can("rental-os:order:pickup"), true);
  assert.equal(session.can("rental-os:order:settle"), false);
  assert.equal(session.can("rental-os:order:settle", "rental-os:order:view"), true, "任一命中即可");
  assert.equal(session.canTenant("rental-os:order:view"), false, "租户级动作需要 dataScope=all");
  session.saveSession(loginResponse({ user: { ...loginResponse().user, tenantMembership: { permissions: ["rental-os:member:review"], dataScope: "all", isTenantAdmin: false } } }), "login");
  assert.equal(session.canTenant("rental-os:member:review"), true);
  assert.equal(session.canTenant("rental-os:member:manage"), false);
  session.saveSession(loginResponse({ user: { ...loginResponse().user, isPlatformAdmin: true, permissions: [] } }), "login");
  assert.equal(session.can("rental-os:order:settle"), true, "平台管理员按 * 放行");
  assert.equal(session.lastTenantCode(), "demo");
  const storage = rt.load("core/storage");
  rt.wx.setStorageSync(storage.STORAGE_KEYS.drafts, { a: 1 });
  session.clearSession("logout");
  assert.equal(session.isSignedIn(), false);
  assert.equal(rt.wx.getStorageSync(storage.STORAGE_KEYS.drafts), undefined, "退出必须清理草稿");
  assert.equal(rt.wx.getStorageSync(storage.STORAGE_KEYS.lastTenantCode), "demo", "租户编码只是输入便利，退出后保留");
});

test("切换空间的响应 refreshToken 为空时沿用旧值，并触发 workspace-changed 与上下文版本递增", () => {
  const rt = runtime();
  const session = rt.load("core/session");
  const events = [];
  session.sessionEvents.on((event) => events.push(event.type));
  session.saveSession(loginResponse(), "login");
  const before = session.contextVersion();
  session.saveSession(loginResponse({ accessToken: "access-two", refreshToken: "", currentWorkspaceId: "ws-camping" }), "switch-workspace");
  assert.equal(session.refreshToken(), "refresh-one");
  assert.equal(session.accessToken(), "access-two");
  assert.equal(session.currentWorkspaceId(), "ws-camping");
  assert.ok(session.contextVersion() > before);
  same(events, ["signed-in", "workspace-changed"]);
});

/* ---------------- HTTP ---------------- */

test("并发 401 只执行一次刷新，并用轮换后的令牌重放；刷新被拒绝则清空身份", async () => {
  let refreshCount = 0;
  const rt = runtime((req) => {
    if (req.url.endsWith("/api/staff/v1/auth/refresh")) {
      refreshCount += 1;
      return ok(req, loginResponse({ accessToken: "access-two", refreshToken: "refresh-two" }));
    }
    if (req.header.Authorization === "Bearer access-one") return status(req, 401, "expired");
    return ok(req, { echo: req.url });
  });
  const session = rt.load("core/session");
  const http = rt.load("core/http");
  session.saveSession(loginResponse(), "login");
  const [a, b] = await Promise.all([http.request("/rental/v1/orders"), http.request("/rental/v1/assets")]);
  assert.equal(refreshCount, 1, "刷新必须单飞");
  assert.match(a.echo, /\/api\/staff\/v1\/rental\/v1\/orders$/);
  assert.match(b.echo, /\/api\/staff\/v1\/rental\/v1\/assets$/);
  assert.equal(session.accessToken(), "access-two");
  assert.equal(session.refreshToken(), "refresh-two");

  const rejected = runtime((req) => {
    if (req.url.endsWith("/api/staff/v1/auth/refresh")) return status(req, 401, "revoked");
    return status(req, 401, "expired");
  });
  const session2 = rejected.load("core/session");
  const http2 = rejected.load("core/http");
  session2.saveSession(loginResponse(), "login");
  await assert.rejects(http2.request("/rental/v1/orders"), (error) => error.code === "AUTH_EXPIRED");
  assert.equal(session2.isSignedIn(), false, "刷新被拒绝必须清空身份");
});

test("切换空间后迟到的空间范围响应被整体丢弃；租户范围请求不受影响；错误码映射稳定", async () => {
  let pending;
  const rt = runtime((req) => {
    if (req.url.includes("/rental/v1/orders")) { pending = req; return; }
    if (req.url.includes("/status-")) return status(req, Number(req.url.split("/status-")[1]), "boom");
    return ok(req, { ok: true });
  });
  const session = rt.load("core/session");
  const http = rt.load("core/http");
  session.saveSession(loginResponse(), "login");
  const late = http.request("/rental/v1/orders");
  await tick();
  session.saveSession(loginResponse({ accessToken: "access-two", refreshToken: "", currentWorkspaceId: "ws-camping" }), "switch-workspace");
  ok(pending, [{ id: "stale" }]);
  await assert.rejects(late, (error) => error.code === "STALE_CONTEXT");
  const tenantScoped = await http.request("/auth/session-context", { scope: "tenant" });
  assert.equal(tenantScoped.ok, true);
  for (const [code, expected] of [[400, "BAD_REQUEST"], [403, "FORBIDDEN"], [404, "NOT_FOUND"], [409, "CONFLICT"], [429, "RATE_LIMITED"], [503, "UNAVAILABLE"], [500, "SERVER"]]) {
    await assert.rejects(http.request(`/x/status-${code}`, { scope: "tenant" }), (error) => error.code === expected && error.status === code);
  }
  assert.equal(http.unwrap({ data: 0, requestId: "r" }), 0, "0 不能被误判为空");
  assert.equal(http.unwrap({ data: false }), false);
});

test("未配置或不安全地址时任何请求都以 NOT_CONFIGURED 失败；发布包拒绝 http", async () => {
  const rt = runtime();
  const config = rt.load("config/public");
  const http = rt.load("core/http");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "http://api.example.invalid", allowLocalApi: true });
  await assert.rejects(http.request("/auth/login", { auth: "none" }), (error) => error.code === "NOT_CONFIGURED");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "http://localhost:3000", allowLocalApi: false });
  assert.match(config.configProblem(), /HTTPS/);
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "http://localhost:3000", allowLocalApi: true });
  assert.equal(config.configProblem(), undefined, "本机联调构建允许回环 http");
});

/* ---------------- 工作上下文与术语 ---------------- */

test("上下文按当前空间品类解析术语；未知品类回退通用词；地点选择只做本机筛选并按空间记忆", async () => {
  const rt = runtime((req) => {
    if (req.url.endsWith("/api/staff/v1/auth/session-context")) return ok(req, { ...loginResponse(), tenant: { ...loginResponse().tenant, categoryCode: "camping", categoryName: "露营装备", capabilities: ["return"] }, currentWorkspaceId: "ws-camping" });
    if (req.url.endsWith("/api/staff/v1/rental/v1/categories")) return ok(req, [
      { code: "camera", name: "摄影器材", terminology: { itemLabel: "器材", itemGroupLabel: "器材型号", assetLabel: "器材资产", fulfillmentLabel: "器材门店", pickupLabel: "取机", returnLabel: "还机", identifierLabel: "资产编号" }, businessModel: { assetFields: [], defaults: { inspectionFields: [] } } },
      { code: "camping", name: "露营装备", terminology: { itemLabel: "装备", itemGroupLabel: "装备型号", assetLabel: "装备资产", fulfillmentLabel: "装备仓", pickupLabel: "领用", returnLabel: "归还", identifierLabel: "装备编号" }, businessModel: { assetFields: [{ code: "batchNo", label: "批次号", scope: "asset", type: "string" }], defaults: { inspectionFields: [{ code: "count_ok", label: "数量齐全", type: "boolean", required: true }] } } }
    ]);
    if (req.url.endsWith("/api/staff/v1/rental/v1/locations")) return ok(req, [
      { id: "loc-a", code: "A", name: "中心装备仓", type: "warehouse", capabilities: ["pickup", "return"], status: "enabled" },
      { id: "loc-b", code: "B", name: "已停用仓", type: "warehouse", capabilities: ["pickup"], status: "disabled" }
    ]);
    return ok(req, {});
  });
  const session = rt.load("core/session");
  const context = rt.load("core/context");
  session.saveSession(loginResponse({ currentWorkspaceId: "ws-camping" }), "login");
  assert.equal(context.terms().assetLabel, "物品", "未加载前用通用兜底，不猜品类");
  const loaded = await context.loadContext();
  assert.equal(loaded.categoryCode, "camping");
  assert.equal(context.terms().assetLabel, "装备资产");
  assert.equal(context.terms().fulfillmentLabel, "装备仓");
  assert.equal(context.terms().collectionLabel, "库存", "未声明集合名词时按“库存”");
  same(loaded.assetFields.map((row) => row.code), ["batchNo"]);
  same(loaded.inspectionFields.map((row) => row.code), ["count_ok"]);
  same(loaded.locations.map((row) => row.id), ["loc-a"], "停用地点不进入可选范围");
  assert.equal(context.currentLocationLabel(), "全部装备仓");
  assert.equal(context.inCurrentLocation("loc-a"), true);
  context.setCurrentLocation("loc-a");
  assert.equal(context.currentLocationLabel(), "中心装备仓");
  assert.equal(context.inCurrentLocation("loc-a"), true);
  assert.equal(context.inCurrentLocation("loc-x"), false);
  assert.equal(context.inCurrentLocation(undefined, "loc-a"), true, "任一命中即可（取货或归还地点）");
  assert.equal(context.categoryIcon("camping"), "tent");
  assert.equal(context.categoryIcon("unknown-future-category"), "box", "未知品类用通用图标");
  // 切换空间后上下文失效，重新加载。
  session.saveSession(loginResponse({ accessToken: "a2", refreshToken: "", currentWorkspaceId: "ws-camera" }), "switch-workspace");
  assert.equal(context.cachedContext(), undefined);
});

/* ---------------- 路由、标签、扫码、主题 ---------------- */

test("登录返回目标只接受白名单页面并剥离私有参数；订单页签判定；状态文案未知取值原样返回", () => {
  const rt = runtime();
  const ui = rt.load("core/ui");
  assert.equal(ui.safeRoute("/pages/order/index?id=o1&token=abc"), "/pages/order/index?id=o1");
  assert.equal(ui.safeRoute("https://evil.example/pages/order/index"), ui.ROUTES.workbench);
  assert.equal(ui.safeRoute("/pages/not-exist/index"), ui.ROUTES.workbench);
  assert.equal(ui.buildUrl(ui.ROUTES.order, { id: "o 1", empty: "" }), "/pages/order/index?id=o%201");
  const labels = rt.load("core/labels");
  const now = Date.parse("2026-09-23T10:00:00Z");
  assert.equal(labels.orderTabMatches("pending_pickup", { status: "ready_for_pickup", endAt: "2026-09-25T00:00:00Z" }, now), true);
  assert.equal(labels.orderTabMatches("pending_return", { status: "renting", endAt: "2026-09-25T00:00:00Z" }, now), false, "未到归还时间不算待归还");
  assert.equal(labels.orderTabMatches("pending_return", { status: "renting", endAt: "2026-09-22T00:00:00Z" }, now), true);
  assert.equal(labels.orderTabMatches("pending_return", { status: "renting", endAt: "2026-09-22T00:00:00Z", effectiveEndAt: "2026-09-30T00:00:00Z" }, now), false, "续租后按有效归还时间");
  assert.equal(labels.orderTabMatches("done", { status: "cancelled", endAt: "" }, now), true);
  assert.equal(labels.orderStatusLabel("renting"), "使用中");
  assert.equal(labels.orderStatusLabel("some_new_status"), "some_new_status");
  assert.equal(labels.workOrderTypeLabel("repair"), "维修");
  assert.equal(labels.assetStatusTone("available"), "success");
});

test("扫码：深链解析、历史按账号隔离、去重并限 50 条、退出登录后清空", () => {
  const rt = runtime();
  const session = rt.load("core/session");
  const scan = rt.load("core/scan");
  same(scan.parseDeepLink("rental-os://asset/asset-1"), { kind: "asset", id: "asset-1" });
  same(scan.parseDeepLink("rental-os://work-order/wo-1"), { kind: "workOrder", id: "wo-1" });
  assert.equal(scan.parseDeepLink("RS4-00123"), undefined);
  session.saveSession(loginResponse(), "login");
  for (let index = 0; index < 60; index += 1) scan.rememberScan({ code: `A-${index}`, kind: "asset", id: `asset-${index}`, title: `资产 ${index}`, subtitle: "", action: "查看" });
  assert.equal(scan.scanHistory().length, 50);
  assert.equal(scan.scanHistory()[0].id, "asset-59", "最新在前");
  scan.rememberScan({ code: "A-59", kind: "asset", id: "asset-59", title: "资产 59", subtitle: "", action: "出库" });
  assert.equal(scan.scanHistory().filter((row) => row.id === "asset-59").length, 1, "同一对象去重");
  assert.equal(scan.scanHistory()[0].action, "出库");
  session.saveSession(loginResponse({ user: { ...loginResponse().user, id: "user-two" } }), "login");
  assert.equal(scan.scanHistory().length, 0, "换账号看不到上一个人的记录");
  session.saveSession(loginResponse(), "login");
  assert.equal(scan.scanHistory().length, 50, "同账号记录仍在");
  session.clearSession("logout");
  session.saveSession(loginResponse(), "login");
  assert.equal(scan.scanHistory().length, 0, "退出登录清空本机扫码记录");
});

test("主题：语义色随深浅解析；用户强制深色时才用 JS 覆盖原生底栏；跟随系统时交给 theme.json", () => {
  const rt = runtime();
  const theme = rt.load("core/theme");
  theme.startThemeWatch();
  assert.equal(theme.semanticColor("text"), "#1F2329");
  assert.equal(theme.semanticColor("text", "dark"), "#E6E8EB");
  assert.equal(theme.semanticColor("#123456"), "#123456", "直接 hex 原样返回");
  assert.equal(rt.tabBarStyles.length, 0, "跟随系统时不调用 setTabBarStyle");
  const modes = [];
  theme.themeEvents.on((mode) => modes.push(mode));
  rt.fireTheme("dark");
  same(modes, ["dark"]);
  theme.setThemePreference("light");
  assert.equal(theme.currentTheme(), "light");
  assert.equal(theme.themeRootClass(), "theme-light");
  assert.ok(rt.tabBarStyles.length > 0, "强制浅/深色时用 JS 覆盖底栏");
  rt.fireTheme("light");
  assert.equal(modes.length, 2, "强制模式下系统切换不再触发事件（有效主题未变除外）");
});

/* ---------------- 构建 ---------------- */

const build = (env, args = []) => spawnSync(process.execPath, [path.join(root, "scripts/build.cjs"), ...args], { encoding: "utf8", env: { ...process.env, STAFF_MINIPROGRAM_API_ORIGIN: "", STAFF_MINIPROGRAM_APP_ID: "", ...env } });
const distConfig = () => JSON.parse(fs.readFileSync(path.join(root, "dist/config/public.json"), "utf8"));

test("默认构建产出全部页面、不绑定租户、运行时不依赖 @rental-os/shared；发布构建拒绝 http 地址", () => {
  const result = build({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const route of app.pages) for (const ext of ["js", "json", "wxml", "wxss"]) assert.ok(fs.existsSync(path.join(root, "dist", `${route}.${ext}`)), `缺少产物 ${route}.${ext}`);
  for (const file of ["app.js", "app.json", "app.wxss", "staff.wxss", "theme.json", "sitemap.json", "project.config.json", "config/public.js", "config/public.json", "assets/logo.png", "assets/tab/scan.png"]) assert.ok(fs.existsSync(path.join(root, "dist", file)), `缺少产物 ${file}`);
  const config = distConfig();
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "dist/project.config.json"), "utf8")).setting.urlCheck, false, "本机联调需关闭合法域名校验");
  assert.equal(config.tenantCode, undefined, "员工端产物不含租户编码");
  assert.equal(config.allowLocalApi, /^http:\/\/(localhost|127\.0\.0\.1)/.test(config.apiOrigin));
  for (const file of walk(path.join(root, "dist")).filter((f) => f.endsWith(".js"))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /require\(["']@rental-os\/shared["']\)/, `${path.relative(root, file)} 运行时依赖 shared`);
  }
  const release = build({ STAFF_MINIPROGRAM_API_ORIGIN: "http://localhost:3000" }, ["--release"]);
  assert.notEqual(release.status, 0, "发布构建必须拒绝 http");
  assert.match(release.stderr, /拒绝 http/);
  const httpsRelease = build({ STAFF_MINIPROGRAM_API_ORIGIN: "https://api.example.invalid" }, ["--release"]);
  assert.equal(httpsRelease.status, 0, httpsRelease.stdout + httpsRelease.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "dist/project.config.json"), "utf8")).setting.urlCheck, true, "发布构建必须开启合法域名校验");
  const bad = build({ STAFF_MINIPROGRAM_API_ORIGIN: "https://api.example.invalid/v1" });
  assert.notEqual(bad.status, 0, "带路径的地址必须拒绝");
  // 恢复本机联调产物，避免后续手工调试拿到被测试改坏的 dist。
  assert.equal(build({}).status, 0);
});
