"use strict";
/**
 * 微信小程序静态与宿主替身测试（MP-13）。
 *
 * 不起服务、不连数据库、不开浏览器：用 vm 隔离加载 TS 源码，注入一个最小 `wx` 替身，
 * 逐条验证需求 §2.3/§4.3/§6.4/§7.3/§8/§12.3 里必须由客户端保证的行为。
 * 每个用例标注对应的验收场景（AC-xx）。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const ts = require("typescript");

const root = path.resolve(__dirname, "../apps/miniprogram");
const src = path.join(root, "src");
const read = (file) => fs.readFileSync(path.join(src, file), "utf8");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
const app = JSON.parse(read("app.json"));
/** vm 沙箱里的对象与测试进程不同源，原型不同；深比较前先做一次 JSON 归一化。 */
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepStrictEqual(plain(actual), plain(expected), message);

/** 宿主替身：记录每次 wx.request / 支付 / 跳转，网络响应由 handler 决定。 */
function runtime(handler) {
  const modules = new Map();
  const storage = new Map();
  const calls = [];
  const navigations = [];
  const payments = [];
  const modals = [];
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
      options.success?.({ confirm: modalAnswer, cancel: !modalAnswer });
    },
    showToast() {},
    navigateTo: (options) => navigations.push(options.url),
    redirectTo: (options) => navigations.push(options.url),
    switchTab: (options) => navigations.push(options.url),
    navigateBack() {},
    requestPayment(options) {
      payments.push(options);
      options.success?.();
    },
    downloadFile: (options) => options.success?.({ statusCode: 200, tempFilePath: "wxfile://tmp/image" }),
    login: (options) => options.success?.({ code: "wx-login-code" }),
    makePhoneCall() {},
    setClipboardData() {},
    setNavigationBarTitle() {},
    stopPullDownRefresh() {}
  };
  const context = vm.createContext({
    wx, Promise, Date, Math, Map, Set, Number, String, Object, Array, Error, JSON, Intl, Symbol, Reflect, Boolean, RegExp,
    Uint8Array, ArrayBuffer, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    getCurrentPages: () => [], Page: () => {}, Component: () => {}, App: () => {}, console
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
  // 配置：所有网络用例都需要“已配置”的公开配置。
  const config = load("config/public");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "https://merchant.example.invalid", tenantCode: "merchant", appId: "wx0000000000000000", allowLocalApi: false });
  return { load, wx, storage, calls, navigations, payments, modals, setModalAnswer: (value) => { modalAnswer = value; } };
}

const sessionResponse = (accessToken = "access-one", refreshToken = "refresh-one") => ({
  apiVersion: "v1", accessToken, refreshToken, expiresIn: 3600,
  customer: { customerId: "customer-one", customerType: "personal", displayName: "本人", loginIdentifierMasked: "138****0000" },
  workspaces: [
    { workspaceCode: "camera", workspaceName: "摄影器材", categoryCode: "camera", membershipStatus: "active", isDefault: true },
    { workspaceCode: "camping", workspaceName: "露营装备", categoryCode: "camping", membershipStatus: "active" }
  ]
});
const ok = (req, data, header = {}) => req.success({ statusCode: 200, data: { data, requestId: "request-one" }, header });
const status = (req, statusCode, message = "error") => req.success({ statusCode, data: { statusCode, message }, header: {} });

/* ---------------- 工程结构（AC-18） ---------------- */

test("app.json 声明 20 个页面、4 个 Tab（带图标），每个页面与组件四件套齐全；组件按页面注册以保留按需注入", () => {
  assert.equal(app.pages.length, 20);
  assert.equal(new Set(app.pages).size, app.pages.length);
  same(app.tabBar.list.map((row) => row.text), ["首页", "分类", "订单", "我的"]);
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
  assert.equal(app.window.navigationStyle, "custom", "全部页面使用自定义导航栏（品牌 Logo 行）");
  // requiredPrivateInfos 只能取微信接口白名单：openLocation 用内置地图、不属于此表，写进去开发者工具会拒绝编译。
  const PRIVATE_INFO_WHITELIST = ["chooseAddress", "chooseLocation", "choosePoi", "getFuzzyLocation", "getLocation", "onLocationChange", "startLocationUpdate", "startLocationUpdateBackground"];
  for (const info of app.requiredPrivateInfos ?? []) {
    assert.ok(PRIVATE_INFO_WHITELIST.includes(info), `requiredPrivateInfos 含非法项 ${info}（openLocation 等不属于此表）`);
  }
  if ((app.requiredPrivateInfos ?? []).includes("getLocation")) {
    assert.ok(app.permission && app.permission["scope.userLocation"] && app.permission["scope.userLocation"].desc, "声明 getLocation 必须同时配 permission.scope.userLocation.desc");
  }
  const componentTags = ["nav-bar", "ui-icon", "state-view", "money-text", "status-tag", "sheet"];
  const registeredComponents = new Set();
  for (const route of app.pages) {
    for (const ext of ["ts", "json", "wxml", "wxss"]) assert.ok(read(`${route}.${ext}`).trim(), `${route}.${ext} 缺失或为空`);
    assert.match(read(`${route}.ts`), /\bPage\(\{/);
    const pageJson = JSON.parse(read(`${route}.json`));
    const wxml = read(`${route}.wxml`);
    assert.match(wxml, /<nav-bar\b/, `${route} 必须以 <nav-bar> 开头（自定义导航栏下否则内容顶到状态栏）`);
    const used = componentTags.filter((tag) => new RegExp(`<${tag}\\b`).test(wxml));
    const declared = Object.keys(pageJson.usingComponents ?? {});
    same([...used].sort(), [...declared].sort(), `${route} 使用的组件与 usingComponents 声明不一致`);
    for (const [tag, componentPath] of Object.entries(pageJson.usingComponents ?? {})) {
      assert.equal(componentPath, `/components/${tag}/index`);
      registeredComponents.add(componentPath);
    }
  }
  for (const componentPath of registeredComponents) {
    const relative = componentPath.slice(1);
    for (const ext of ["ts", "json", "wxml", "wxss"]) assert.ok(read(`${relative}.${ext}`).trim());
    assert.equal(JSON.parse(read(`${relative}.json`)).component, true);
    assert.match(read(`${relative}.ts`), /\bComponent\(\{/);
  }
  assert.equal(registeredComponents.size, componentTags.length, "每个公共组件都应至少被一个页面使用");
  const sitemap = JSON.parse(read("sitemap.json"));
  assert.ok(sitemap.rules.some((rule) => rule.action === "disallow" && rule.page === "*"), "非公开页面不得被索引");
});

test("WXSS/WXML 只使用小程序编译器支持的语法（开发者工具实测拒绝的写法在此拦截）", () => {
  for (const file of walk(src).filter((f) => f.endsWith(".wxss"))) {
    const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const label = path.relative(root, file);
    assert.doesNotMatch(css, /(^|[\s>+~,])\*(?=\s*[{+>~,.:#\[]|\s*$)/m, `${label}：WXSS 不支持通配符选择器 *`);
    assert.doesNotMatch(css, /:empty\b/, `${label}：不依赖 :empty`);
    assert.doesNotMatch(css, /(^|[\s;{])inset\s*:/m, `${label}：inset 简写在旧 WebView 不可用，写 top/right/bottom/left`);
  }
  for (const file of walk(src).filter((f) => f.endsWith(".wxml"))) {
    const label = path.relative(root, file);
    const wxml = fs.readFileSync(file, "utf8");
    for (const match of wxml.matchAll(/\{\{([^}]*)\}\}/g)) {
      const expression = match[1].replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
      assert.doesNotMatch(expression, /[()]/, `${label}：WXML 表达式不支持括号分组/对括号结果取属性，请在 TS 中预先计算：${match[1].trim()}`);
      assert.doesNotMatch(expression, /!!/, `${label}：WXML 表达式避免 !!，在 TS 中预先算成布尔值：${match[1].trim()}`);
      assert.doesNotMatch(expression, /[A-Za-z_]\w*\[\s*0\s*\]\s*:/, `${label}：不要在 WXML 里对字符串取首字符：${match[1].trim()}`);
    }
    for (const match of wxml.matchAll(/wx:for="[^"]*"[^>]*wx:key="([^"]+)"/g)) {
      assert.notEqual(match[1], "index", `${label}：wx:key="index" 不是有效的 key，请给数据项提供稳定的 key 字段`);
    }
  }
});

test("页面 WXML 里的每个数据绑定都对应页面 data 的已声明字段，组件属性都已声明（AST 交叉核对）", () => {
  const componentProps = {
    "nav-bar": ["title", "back", "transparent"],
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

test("源码不含密钥、模拟资金入口、内部 ID 输入、演示数据与调试输出（AC-18）", () => {
  const source = walk(src).filter((file) => /\.(ts|wxml|json)$/.test(file)).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /(?:appSecret|session_key|apiV3Key|privateKey|merchantSecret|mchKey)\s*[:=]\s*["'][^"']+/i);
  assert.doesNotMatch(source, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(source, /\/funding\/simulate|simulatePayment|mockPayment|development-login/);
  assert.doesNotMatch(source, /(?:name|data-field|placeholder)\s*=\s*["'][^"']*(?:tenantId|workspaceId)[^"']*["']/i);
  assert.doesNotMatch(source, /\b(?:tenantId|workspaceId)\s*:/);
  assert.doesNotMatch(source, /(?:demoProducts|mockProducts|sampleProducts|测试商品|演示商品|模拟支付成功)/);
  assert.doesNotMatch(source, /(?:console\.(?:log|debug|info))\s*\(/);
  assert.doesNotMatch(source, /import\s+\{[^}]*\}\s+from\s+["']@rental-os\/shared["']/, "只能 import type，不能引入运行时值");
  // 分享参数只允许公开标识。
  for (const file of walk(src).filter((f) => f.endsWith(".ts"))) {
    const text = fs.readFileSync(file, "utf8");
    const share = text.match(/onShareAppMessage\(\)\s*\{[\s\S]*?\n  \}/);
    if (share) assert.doesNotMatch(share[0], /token|phone|refresh|customerId/i, `${path.relative(root, file)} 分享参数含私有信息`);
  }
});

/* ---------------- 构建（AC-18） ---------------- */

const build = (env, args = []) => spawnSync(process.execPath, [path.join(root, "scripts/build.cjs"), ...args], { encoding: "utf8", env: { ...process.env, MINIPROGRAM_API_ORIGIN: "", MINIPROGRAM_TENANT_CODE: "", MINIPROGRAM_APP_ID: "", MINIPROGRAM_ALLOW_LOCAL_API: "", ...env } });
const distConfig = () => JSON.parse(fs.readFileSync(path.join(root, "dist/config/public.json"), "utf8"));

test("默认构建取代码里的租户与 API 常量（换租户只改 src/config/public.ts），产出全部页面且运行时不依赖 @rental-os/shared", () => {
  const source = read("config/public.ts");
  const tenantCode = /tenantCode:\s*"([^"]+)"/.exec(source)?.[1];
  const apiOrigin = /apiOrigin:\s*"([^"]+)"/.exec(source)?.[1];
  assert.equal(tenantCode, "demo", "第一版绑定演示租户 demo");
  assert.ok(apiOrigin, "代码里必须有 API 地址默认值");
  const result = build({});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const route of app.pages) for (const ext of ["js", "json", "wxml", "wxss"]) assert.ok(fs.existsSync(path.join(root, "dist", `${route}.${ext}`)));
  for (const file of ["app.js", "app.json", "app.wxss", "sitemap.json", "project.config.json", "config/public.js", "config/public.json", "assets/logo.png", "assets/tab/home.png"]) assert.ok(fs.existsSync(path.join(root, "dist", file)), `缺少产物 ${file}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "dist/project.config.json"), "utf8")).miniprogramRoot, "./");
  for (const file of walk(path.join(root, "dist")).filter((f) => f.endsWith(".js"))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /require\(["']@rental-os\/shared["']\)/, path.relative(root, file));
  }
  const config = distConfig();
  assert.equal(config.tenantCode, "demo");
  assert.equal(config.apiOrigin, apiOrigin);
  assert.equal(config.allowLocalApi, /^http:\/\/(localhost|127\.0\.0\.1)/.test(apiOrigin), "回环地址的联调构建写入 allowLocalApi");
  // 环境变量只在非空时覆盖代码常量。
  const overridden = build({ MINIPROGRAM_TENANT_CODE: "another" });
  assert.equal(overridden.status, 0, overridden.stdout + overridden.stderr);
  assert.equal(distConfig().tenantCode, "another");
  assert.equal(distConfig().apiOrigin, apiOrigin, "未设置的环境变量不清空代码常量");
});

test("发布构建拒绝任何 http 地址；联调构建只放行回环地址；地址带路径或 AppID 格式错误一律拒绝", () => {
  const local = { MINIPROGRAM_API_ORIGIN: "http://localhost:3000", MINIPROGRAM_TENANT_CODE: "demo" };
  const refused = build(local, ["--release"]);
  assert.notEqual(refused.status, 0, "发布模式必须拒绝回环 http");
  assert.match(refused.stderr, /HTTPS/);
  assert.notEqual(build({ ...local, MINIPROGRAM_ALLOW_LOCAL_API: "1" }, ["--release"]).status, 0, "旧联调开关不能在发布模式放行 http");
  const allowed = build(local);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
  assert.equal(distConfig().allowLocalApi, true);
  assert.match(allowed.stdout, /不可上传/);
  assert.notEqual(build({ MINIPROGRAM_API_ORIGIN: "http://merchant.example.com", MINIPROGRAM_TENANT_CODE: "demo" }).status, 0, "非回环 http 在联调模式也不放行");
  assert.notEqual(build({ MINIPROGRAM_API_ORIGIN: "https://merchant.example.invalid/api", MINIPROGRAM_TENANT_CODE: "demo" }).status, 0, "带路径的地址不放行");
  assert.notEqual(build({ MINIPROGRAM_API_ORIGIN: "https://merchant.example.invalid", MINIPROGRAM_TENANT_CODE: "demo", MINIPROGRAM_APP_ID: "not-an-appid" }).status, 0, "AppID 格式校验");
  assert.notEqual(build({ MINIPROGRAM_API_ORIGIN: "https://merchant.example.invalid", MINIPROGRAM_TENANT_CODE: "bad code!" }).status, 0, "租户编码格式校验");
  const release = build({ MINIPROGRAM_API_ORIGIN: "https://merchant.example.invalid", MINIPROGRAM_TENANT_CODE: "demo", MINIPROGRAM_APP_ID: "wx1234567890abcdef" }, ["--release"]);
  assert.equal(release.status, 0, release.stdout + release.stderr);
  assert.equal(distConfig().allowLocalApi, false);
  assert.equal(distConfig().appId, "wx1234567890abcdef");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "dist/project.config.json"), "utf8")).appid, "wx1234567890abcdef", "发布构建把 AppID 写进开发者工具项目配置");
  // 恢复为默认（代码常量）产物，避免后续用例受影响。
  assert.equal(build({}).status, 0);
});

/* ---------------- 请求层（AC-17） ---------------- */

test("配置校验：地址为空或非回环 http 时任何请求都以 NOT_CONFIGURED 失败，不回落演示商户", async () => {
  const r = runtime();
  const config = r.load("config/public");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "", tenantCode: "" });
  await assert.rejects(r.load("core/http").request("/catalog", { auth: "none" }), (error) => error.code === "NOT_CONFIGURED");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "http://evil.example.com", tenantCode: "merchant", allowLocalApi: true });
  await assert.rejects(r.load("core/http").request("/catalog", { auth: "none" }), (error) => error.code === "NOT_CONFIGURED");
  Object.assign(config.PUBLIC_CONFIG, { apiOrigin: "http://localhost:3000", tenantCode: "merchant", allowLocalApi: false });
  await assert.rejects(r.load("core/http").request("/catalog", { auth: "none" }), (error) => error.code === "NOT_CONFIGURED", "没有构建写入的联调开关时回环 http 也不放行");
  assert.equal(r.calls.length, 0);
});

test("响应信封解包不把 0/false 误判为空", () => {
  const { unwrap } = runtime().load("core/http");
  assert.equal(unwrap({ data: 0, requestId: "x" }), 0);
  assert.equal(unwrap({ data: false, requestId: "x" }), false);
  assert.equal(unwrap("plain"), "plain");
  same(unwrap({ data: { a: 1 }, other: true }), { data: { a: 1 }, other: true }, "多字段对象不是信封");
});

test("并发 401 只执行一次刷新，并用轮换后的令牌重放", async () => {
  let refreshes = 0;
  const r = runtime((req) => {
    if (req.url.endsWith("/auth/refresh")) { refreshes += 1; ok(req, sessionResponse("access-two", "refresh-two")); }
    else if (req.header.Authorization === "Bearer access-one") status(req, 401, "expired");
    else ok(req, { marker: req.url });
  });
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  const { request } = r.load("core/http");
  const values = await Promise.all([request("/profile"), request("/membership/status"), request("/config")]);
  assert.equal(refreshes, 1);
  assert.equal(values.length, 3);
  assert.equal(session.accessToken(), "access-two");
  assert.equal(session.refreshToken(), "refresh-two");
  assert.equal(r.calls.filter((req) => req.header.Authorization === "Bearer access-two").length, 3);
});

test("刷新被拒绝时清空身份与私有缓存，且不重放受保护的写请求", async () => {
  const r = runtime((req) => status(req, 401, "expired"));
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  r.storage.set("rental-os:cart", { serviceCode: "camera", lines: [{ key: "a" }] });
  await assert.rejects(r.load("core/http").request("/orders", { method: "POST", data: { quoteId: "quote-one" }, idempotencyKey: "stable" }), (error) => error.code === "AUTH_EXPIRED");
  assert.equal(session.accessToken(), "");
  assert.equal(r.calls.filter((req) => req.url.endsWith("/orders")).length, 1);
  assert.equal(r.storage.has("rental-os:cart"), false, "退出后本人草稿必须清理");
  assert.equal(r.storage.has("rental-os:session"), false);
});

test("刷新网络失败时保留身份（可稍后重试），不误判为登录失效", async () => {
  const r = runtime((req) => {
    if (req.url.endsWith("/auth/refresh")) req.fail({ errMsg: "request:fail" });
    else status(req, 401);
  });
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  await assert.rejects(r.load("core/http").request("/profile"), (error) => error.code === "SERVER");
  assert.equal(session.accessToken(), "access-one");
});

test("切换服务后迟到的空间范围响应被整体丢弃；租户范围请求不受影响（AC-04）", async () => {
  let captured;
  const r = runtime((req) => { if (req.url.endsWith("/catalog")) captured = req; else ok(req, { fine: true }); });
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  const { request } = r.load("core/http");
  const pending = request("/catalog");
  await Promise.resolve();
  session.bumpContext("switch-start");
  ok(captured, { workspace: { workspaceCode: "camera" } });
  await assert.rejects(pending, (error) => error.code === "STALE_CONTEXT");
  same(await request("/my/orders", { scope: "tenant" }), { fine: true });
});

test("HTTP 状态码映射稳定：429 带 retryAfter、409 不可自动重试、503 表示未开通", async () => {
  const r = runtime((req) => {
    if (req.url.endsWith("/a")) req.success({ statusCode: 429, data: { message: "slow down" }, header: { "Retry-After": "30" } });
    else if (req.url.endsWith("/b")) status(req, 409, "报价已过期");
    else if (req.url.endsWith("/c")) status(req, 503, "未开通");
    else if (req.url.endsWith("/d")) req.fail({ errMsg: "request:fail timeout" });
  });
  const { request } = r.load("core/http");
  const { describeError } = r.load("core/errors");
  const rateLimited = await request("/a", { auth: "none" }).catch((error) => error);
  assert.equal(rateLimited.code, "RATE_LIMITED");
  assert.equal(rateLimited.retryAfterSeconds, 30);
  assert.equal(describeError(rateLimited).next, "wait");
  const conflict = await request("/b", { auth: "none" }).catch((error) => error);
  assert.equal(conflict.code, "CONFLICT");
  assert.equal(describeError(conflict).retryable, false);
  assert.equal((await request("/c", { auth: "none" }).catch((error) => error)).code, "UNAVAILABLE");
  const timeout = await request("/d", { auth: "none" }).catch((error) => error);
  assert.equal(timeout.code, "TIMEOUT");
  assert.match(describeError(timeout).message, /不要重复提交/);
});

/* ---------------- 会话与商户 ---------------- */

test("会话保存服务端事实：当前服务优先取响应绑定的 workspace，切换服务只改上下文不重新登录", () => {
  const r = runtime();
  const session = r.load("core/session");
  const events = [];
  session.sessionEvents.on((event) => events.push(event.type));
  session.saveSession(sessionResponse(), "unknown-service", "login");
  assert.equal(session.currentServiceCode(), "camera", "未知服务回落到服务端列表第一项");
  const version = session.contextVersion();
  session.saveSession(sessionResponse("a2", "r2"), "camping", "switch");
  assert.equal(session.currentServiceCode(), "camping");
  assert.equal(session.membershipStatus(), "active");
  assert.ok(session.contextVersion() > version);
  same(events, ["signed-in", "service-changed"]);
  assert.equal(r.storage.get("rental-os:last-service"), "camping");
  assert.match(JSON.stringify([...r.storage.values()]), /a2/);
  // 服务端返回了会话绑定的 workspace：以它为准，不信请求方“想切到”的编码。
  const bound = { ...sessionResponse("a3", "r3"), workspace: { workspaceCode: "camera", workspaceName: "摄影器材", categoryCode: "camera", membershipStatus: "active" } };
  session.saveSession(bound, "camping", "refresh");
  assert.equal(session.currentServiceCode(), "camera");
});

test("刷新期间发生登录/切换时，旧会话刷出的令牌不覆盖新会话", async () => {
  let captured;
  const r = runtime((req) => {
    if (req.url.endsWith("/auth/refresh")) captured = req;
    else if (req.header.Authorization === "Bearer access-one") status(req, 401, "expired");
    else ok(req, { fine: true });
  });
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  const { request } = r.load("core/http");
  const pending = request("/my/orders", { scope: "tenant" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  // 刷新还没返回时，切换服务换发了新会话。
  session.saveSession(sessionResponse("switched", "switched-refresh"), "camping", "switch");
  ok(captured, sessionResponse("stale-access", "stale-refresh"));
  same(await pending, { fine: true });
  assert.equal(session.accessToken(), "switched", "刷新结果不能覆盖切换后的会话");
  assert.equal(session.refreshToken(), "switched-refresh");
});

test("退出登录后内存中的清单同步失效，不会泄漏给下一个登录者", () => {
  const r = runtime();
  const session = r.load("core/session");
  const cart = r.load("core/cart");
  session.saveSession(sessionResponse(), "camera", "login");
  cart.addLine("camera", "摄影器材", { itemGroupId: "item-one", itemName: "相机" }, 2);
  assert.equal(cart.cartLineCount(), 2);
  session.clearSession("logout");
  assert.equal(cart.getCart(), undefined);
  assert.equal(cart.cartLineCount(), 0);
  assert.equal(r.storage.has("rental-os:cart"), false);
});

test("待付金额 = 未付余额 + 待生效续租补款，与服务端支付单口径一致", () => {
  const { rentalDue } = runtime().load("core/payment");
  assert.equal(rentalDue({ rental: { payable: 100, collected: 100, refunded: 0, balance: 0, pendingExtensionAmount: 40 } }), 40);
  assert.equal(rentalDue({ rental: { payable: 100, collected: 30, refunded: 0, balance: 70, pendingExtensionAmount: 0 } }), 70);
  assert.equal(rentalDue({ rental: { payable: 100, collected: 120, refunded: 0, balance: -20, pendingExtensionAmount: 0 } }), 0, "待退款不显示为待付");
  assert.equal(rentalDue(undefined), 0);
});

test("登录/注册只带商户当前已发布的初始服务，不把已下架的上次选择发给服务端", () => {
  const r = runtime();
  r.storage.set("rental-os:last-service", "retired");
  r.storage.set("rental-os:bootstrap", { name: "商户", loginMethods: ["password"], capabilities: {}, services: [{ code: "camera", name: "摄影", categoryCode: "camera", status: "open" }], fromBootstrap: false, fetchedAt: Date.now() });
  const merchant = r.load("core/merchant");
  assert.equal(merchant.preferredServiceCode(), undefined);
  r.storage.set("rental-os:last-service", "camera");
  assert.equal(merchant.preferredServiceCode(), "camera");
});

test("商户启动信息：拟新增启动接口缺席时退回公开服务列表，并标注来源（AC-01）", async () => {
  const r = runtime((req) => {
    if (req.url.includes("/public/bootstrap")) status(req, 404, "Cannot GET");
    else if (req.url.includes("/tenants/merchant/workspaces")) ok(req, { apiVersion: "v1", tenantCode: "merchant", tenantName: "示例器材租赁", workspaces: [{ code: "camera", name: "摄影器材", categoryCode: "camera", isDefault: true }] });
  });
  const merchant = r.load("core/merchant");
  const info = await merchant.loadMerchant(true);
  assert.equal(info.name, "示例器材租赁");
  assert.equal(info.fromBootstrap, false);
  same(info.loginMethods, ["password"]);
  assert.equal(merchant.resolveServiceCode(info), "camera");
  assert.ok(r.calls.every((req) => !req.header.Authorization), "游客启动不带令牌");
  assert.equal(merchant.resolveServiceCode({ ...info, services: [] }), undefined, "零个服务不回落其他商户");
});

/* ---------------- 清单与提交（AC-06/09） ---------------- */

test("清单只属于一个服务；修改使旧报价作废；提交键在结果未知时复用并锁定清单", () => {
  const r = runtime();
  const cart = r.load("core/cart");
  cart.addLine("camera", "摄影器材", { itemGroupId: "item-one", itemName: "相机", pricingGroupId: "pg-one", pricingGroupName: "标准" }, 1);
  cart.addLine("camera", "摄影器材", { itemGroupId: "item-one", itemName: "相机", pricingGroupId: "pg-one", pricingGroupName: "标准" }, 2);
  assert.equal(cart.getCart().lines.length, 1, "同商品同选项合并");
  assert.equal(cart.getCart().lines[0].quantity, 3);
  assert.throws(() => cart.addLine("camping", "露营装备", { itemGroupId: "tent", itemName: "帐篷" }, 1), cart.CartServiceMismatch);
  cart.updateCart("camera", "摄影器材", (draft) => { draft.startAt = "2026-10-01T02:00:00.000Z"; draft.endAt = "2026-10-03T02:00:00.000Z"; draft.locationId = "loc-one"; draft.locationName = "门店"; });
  same(cart.cartMissing(cart.getCart()), []);
  cart.bindQuote("quote-one", new Date(Date.now() + 600000).toISOString());
  assert.equal(cart.quoteIsCurrent(cart.getCart()), true);
  cart.setLineQuantity("camera", "摄影器材", cart.getCart().lines[0].key, 1);
  assert.equal(cart.quoteIsCurrent(cart.getCart()), false, "修改后旧报价作废");
  assert.throws(() => cart.beginSubmission(), /报价已失效/);
  cart.bindQuote("quote-two", new Date(Date.now() + 600000).toISOString());
  const first = cart.beginSubmission();
  cart.markSubmissionUnknown();
  const replay = cart.beginSubmission();
  assert.equal(replay.key, first.key, "结果未知时同键重放");
  assert.equal(replay.quoteId, "quote-two");
  assert.throws(() => cart.updateCart("camera", "摄影器材", (draft) => { draft.lines = []; }), cart.CartLocked);
  cart.abandonSubmission();
  assert.notEqual(cart.beginSubmission().key, first.key, "服务端明确未创建后允许换键");
  cart.completeSubmission();
  assert.equal(cart.getCart(), undefined);
});

test("有未提交清单时切换服务必须经用户确认；取消则保留清单且不发请求（AC-04）", async () => {
  const r = runtime();
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  const cart = r.load("core/cart");
  cart.addLine("camera", "摄影器材", { itemGroupId: "item-one", itemName: "相机" }, 1);
  const flow = r.load("core/flow");
  r.setModalAnswer(false);
  assert.equal(await flow.switchService("camping", "露营装备"), false);
  assert.equal(cart.getCart().lines.length, 1);
  assert.equal(session.currentServiceCode(), "camera");
  assert.equal(r.calls.length, 0);
  assert.equal(r.modals.length, 1);
  assert.match(r.modals[0].content, /重新选择/);
  // 结果未知的提交锁定期间禁止切换。
  cart.updateCart("camera", "摄影器材", (draft) => { draft.startAt = "2026-10-01T02:00:00.000Z"; draft.endAt = "2026-10-03T02:00:00.000Z"; draft.locationId = "loc-one"; });
  cart.bindQuote("quote-one", new Date(Date.now() + 600000).toISOString());
  cart.beginSubmission();
  r.setModalAnswer(true);
  assert.equal(await flow.switchService("camping", "露营装备"), false);
  assert.equal(r.calls.length, 0);
});

test("确认切换后先经服务端换发会话再清空清单；切换失败保留清单；游客切换只改本地选择", async () => {
  let fail = false;
  const r = runtime((req) => { if (req.url.endsWith("/auth/switch-workspace")) { if (fail) status(req, 503, "down"); else ok(req, sessionResponse("a2", "r2")); } });
  const session = r.load("core/session");
  session.saveSession(sessionResponse(), "camera", "login");
  const cart = r.load("core/cart");
  cart.addLine("camera", "摄影器材", { itemGroupId: "item-one", itemName: "相机" }, 1);
  const flow = r.load("core/flow");
  r.setModalAnswer(true);
  fail = true;
  await assert.rejects(flow.switchService("camping", "露营装备"));
  assert.equal(cart.getCart().lines.length, 1, "切换失败时清单不能先没了");
  assert.equal(session.currentServiceCode(), "camera");
  fail = false;
  assert.equal(await flow.switchService("camping", "露营装备"), true);
  assert.equal(cart.getCart(), undefined);
  assert.equal(session.currentServiceCode(), "camping");
  same(r.calls.map((req) => req.url.split("/").pop()), ["switch-workspace", "switch-workspace"]);
  same(r.calls[1].data, { workspaceCode: "camping" });
  session.clearSession("test");
  assert.equal(await flow.switchService("camera", "摄影器材"), true);
  assert.equal(r.calls.length, 2, "游客切换不请求服务端");
  assert.equal(session.lastServiceCode(), "camera");
});

test("动作幂等键按动作+对象+内容指纹复用，内容变化才换键，明确结果后释放", () => {
  const keys = runtime().load("core/keys");
  const first = keys.actionKey("order.cancel", "order-one", "行程变更");
  assert.equal(keys.actionKey("order.cancel", "order-one", "行程变更"), first);
  assert.notEqual(keys.actionKey("order.cancel", "order-one", "选错了"), first);
  assert.notEqual(keys.actionKey("order.cancel", "order-two", "行程变更"), first);
  keys.releaseActionKey("order.cancel", "order-one");
  assert.notEqual(keys.actionKey("order.cancel", "order-one", "行程变更"), first);
});

/* ---------------- 支付（AC-10/11） ---------------- */

test("支付拒绝 Native 参数、缺项与过期的 JSAPI 参数；SDK 成功回调不把支付单标成已付", async () => {
  const r = runtime();
  const pay = r.load("core/payment");
  const intent = { intentId: "intent-one", provider: "wechat_pay", method: "wechat_pay", instrument: "rental", amount: 100, currency: "CNY", status: "pending", expiresAt: new Date(Date.now() + 60000).toISOString(), jsapi: { timeStamp: "1", nonceStr: "server-nonce", package: "prepay_id=server-prepay", signType: "RSA", paySign: "server-signature" } };
  assert.ok(pay.validJsapi(intent));
  assert.equal(pay.validJsapi({ ...intent, jsapi: undefined, checkoutUrl: "weixin://wxpay/bizpayurl" }), undefined);
  assert.equal(pay.validJsapi({ ...intent, jsapi: { ...intent.jsapi, package: "weixin://native" } }), undefined);
  assert.equal(pay.validJsapi({ ...intent, jsapi: { ...intent.jsapi, signType: "MD5" } }), undefined);
  assert.equal(pay.validJsapi({ ...intent, expiresAt: new Date(Date.now() - 1000).toISOString() }), undefined);
  assert.equal(pay.validJsapi({ ...intent, provider: "alipay", method: "alipay" }), undefined);
  assert.equal(pay.validJsapi({ ...intent, status: "paid" }), undefined);
  assert.equal(pay.jsapiEnabled({ mode: "provider", realPaymentEnabled: true, methods: ["wechat_pay"], instruments: ["rental"] }), true);
  assert.equal(pay.jsapiEnabled({ mode: "provider_pending", realPaymentEnabled: false, methods: ["wechat_pay"], instruments: ["rental"] }), false);
  assert.equal(pay.jsapiEnabled({ mode: "simulation_only", realPaymentEnabled: false, methods: ["simulation"], instruments: ["rental"] }), false);
  assert.equal(await pay.launchPayment(intent), "finished");
  assert.equal(intent.status, "pending");
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].package, "prepay_id=server-prepay");
  assert.equal(r.calls.length, 0);
  assert.equal(await pay.launchPayment({ ...intent, jsapi: undefined }), "failed");
  assert.equal(r.payments.length, 1);
  assert.equal(JSON.stringify([...r.storage.values()]).includes("server-signature"), false, "签名不落本机存储");
});

test("付款确认必须先让服务端查单再读资金事实；支付单 paid 但未入账不算已付", async () => {
  const seen = [];
  let funding = { events: [], rental: { payable: 100, collected: 0, refunded: 0, balance: 100 } };
  const r = runtime((req) => {
    seen.push(req.url.replace(/^.*\/orders\//, ""));
    if (req.url.endsWith("/refresh")) ok(req, { intentId: "intent-one", status: "paid", amount: 100 });
    else if (req.url.endsWith("/funding")) ok(req, funding);
  });
  r.load("core/session").saveSession(sessionResponse(), "camera", "login");
  const pay = r.load("core/payment");
  let result = await pay.verifyPayment("order-one", "intent-one");
  assert.equal(result.confirmed, false);
  same(seen, ["order-one/payment-intents/intent-one/refresh", "order-one/funding"]);
  funding = { events: [], rental: { payable: 100, collected: 100, refunded: 0, balance: 0 } };
  result = await pay.verifyPayment("order-one", "intent-one");
  assert.equal(result.confirmed, true);
});

test("支付单复用：待支付但参数不可用的旧单先关闭再新建；旧单已支付直接返回", async () => {
  const seen = [];
  let existing = { intentId: "intent-old", provider: "wechat_pay", method: "wechat_pay", instrument: "rental", amount: 100, currency: "CNY", status: "pending", expiresAt: new Date(Date.now() - 1000).toISOString() };
  const r = runtime((req) => {
    const tail = req.url.replace(/^.*\/orders\//, "");
    seen.push(`${req.method} ${tail}`);
    if (tail === "order-one/payment-intents/intent-old") ok(req, existing);
    else if (tail === "order-one/payment-intents/intent-old/close") ok(req, { ...existing, status: "closed" });
    else if (tail === "order-one/mini-program-payment-intents") ok(req, { ...existing, intentId: "intent-new", status: "pending", expiresAt: new Date(Date.now() + 60000).toISOString(), jsapi: { timeStamp: "1", nonceStr: "n", package: "prepay_id=p", signType: "RSA", paySign: "s" } });
  });
  r.load("core/session").saveSession(sessionResponse(), "camera", "login");
  r.storage.set("rental-os:payment-intents", { "order-one": { intentId: "intent-old", createdAt: Date.now() } });
  const pay = r.load("core/payment");
  const intent = await pay.obtainIntent("order-one");
  assert.equal(intent.intentId, "intent-new");
  same(seen, ["GET order-one/payment-intents/intent-old", "POST order-one/payment-intents/intent-old/close", "POST order-one/mini-program-payment-intents"]);
  assert.equal(pay.rememberedIntent("order-one"), "intent-new");
  existing = { ...existing, intentId: "intent-old", status: "paid" };
  r.storage.set("rental-os:payment-intents", { "order-one": { intentId: "intent-old", createdAt: Date.now() } });
  seen.length = 0;
  assert.equal((await pay.obtainIntent("order-one")).status, "paid");
  same(seen, ["GET order-one/payment-intents/intent-old"]);
  same(pay.VERIFY_SCHEDULE_MS, [2000, 5000, 10000, 10000]);
});

/* ---------------- 路由与展示（AC-17/18） ---------------- */

test("登录返回目标只接受白名单页面并剥离私有参数", () => {
  const { safeRoute, buildUrl, ROUTES } = runtime().load("core/ui");
  assert.equal(safeRoute("https://evil.invalid"), ROUTES.home);
  assert.equal(safeRoute("/pages/unknown/index"), ROUTES.home);
  assert.equal(safeRoute("/pages/pay/index?id=order-one&token=secret&phone=138"), "/pages/pay/index?id=order-one");
  assert.equal(safeRoute(encodeURIComponent("/pages/order/index?id=o1&service=camera")), "/pages/order/index?id=o1&service=camera");
  assert.equal(safeRoute("%E0%A4%A"), ROUTES.home, "非法编码不崩溃");
  assert.equal(buildUrl(ROUTES.item, { id: "a b", service: undefined }), "/pages/item/index?id=a%20b");
});

test("金额永远带币种，缺币种明确标注；差额区分补款/待退", () => {
  const money = runtime().load("core/money");
  assert.equal(money.formatMoney(1234.5, "CNY"), "¥1,234.50");
  assert.equal(money.formatMoney(-30, "CNY"), "-¥30.00");
  assert.equal(money.formatMoney(30, "CNY", { signed: true }), "+¥30.00");
  assert.equal(money.formatMoney(undefined, "CNY"), "金额待提供");
  assert.match(money.formatMoney(12.34), /币种待确认/);
  assert.equal(money.describeDelta(50, "CNY"), "需补款 ¥50.00");
  assert.equal(money.describeDelta(-50, "CNY"), "预计待退 ¥50.00");
  assert.equal(money.describeDelta(0, "CNY"), "无差额");
});

test("营业时区换算：正确转换、拒绝夏令时空洞与重叠、不计算租金", () => {
  const time = runtime().load("core/time");
  assert.equal(time.zonedToInstant("2026-10-01", "10:00", "Asia/Shanghai"), "2026-10-01T02:00:00.000Z");
  assert.equal(time.zonedToInstant("2026-01-15", "09:30", "Europe/Berlin"), "2026-01-15T08:30:00.000Z");
  assert.equal(time.zonedToInstant("2026-07-15", "09:30", "Europe/Berlin"), "2026-07-15T07:30:00.000Z");
  // ICU 别名（Asia/Kolkata → Asia/Calcutta）与半小时时区必须按该时区换算，不能静默退回设备时区。
  assert.equal(time.zoneSupported("Asia/Kolkata"), true);
  assert.equal(time.zonedToInstant("2026-06-15", "09:30", "Asia/Kolkata"), "2026-06-15T04:00:00.000Z");
  assert.equal(time.zonedToInstant("2026-01-15", "09:30", "Australia/Lord_Howe"), "2026-01-14T22:30:00.000Z");
  assert.equal(time.zoneSupported("Not/AZone"), false);
  assert.throws(() => time.zonedToInstant("2026-03-08", "02:30", "America/New_York"), /不存在/);
  assert.throws(() => time.zonedToInstant("2026-11-01", "01:30", "America/New_York"), /出现两次/);
  assert.throws(() => time.zonedToInstant("2026-13-01", "10:00", "Asia/Shanghai"), /超出范围|无效/);
  assert.equal(time.formatBusinessDateTime("2026-09-20T02:00:00.000Z", "Asia/Shanghai", new Date("2026-09-18T00:00:00Z")), "09-20 周日 10:00");
  assert.equal(time.formatBusinessDateTime("2027-01-01T02:00:00.000Z", "Asia/Shanghai", new Date("2026-09-18T00:00:00Z")), "2027-01-01 周五 10:00");
  assert.match(time.zoneLabel("Asia/Shanghai"), /UTC\+08:00/);
  assert.match(time.zoneLabel("Not/AZone"), /无法按营业时区/);
  assert.equal(Object.keys(time).some((name) => /rent|price|fee|night|charge/i.test(name)), false, "时间模块不得含计价函数");
});

test("客户可理解的订单状态由订单+资金+续租事实组合，终态不抹掉未结资金；Tab 分组与设计稿一致", () => {
  const { presentOrder, matchesFilter, ORDER_FILTERS } = runtime().load("core/status");
  same(ORDER_FILTERS.map((row) => row.label), ["全部", "待支付", "待取货", "租赁中", "已完成"]);
  const now = Date.parse("2026-09-18T00:00:00Z");
  const owed = { rental: { payable: 100, collected: 0, refunded: 0, balance: 100 } };
  const settled = { rental: { payable: 100, collected: 100, refunded: 0, balance: 0 } };
  const draft = presentOrder({ status: "draft", funding: owed, now });
  assert.equal(draft.label, "待支付");
  assert.equal(draft.primary.code, "pay");
  assert.ok(draft.actions.some((action) => action.code === "cancel"));
  assert.equal(matchesFilter(draft, "unpaid"), true);
  const cancelledOwing = presentOrder({ status: "cancelled", funding: owed, now });
  assert.equal(cancelledOwing.isFinal, true);
  assert.ok(cancelledOwing.actions.some((action) => action.code === "pay"), "已取消但有取消费待付仍保留付款出口");
  assert.equal(cancelledOwing.actions.some((action) => action.code === "cancel"), false);
  assert.equal(matchesFilter(cancelledOwing, "finished"), true);
  const renting = presentOrder({ status: "renting", effectiveEndAt: "2026-09-17T00:00:00Z", funding: settled, now });
  assert.equal(renting.tone, "danger");
  assert.match(renting.hint, /逾期|超过/);
  assert.equal(renting.primary.code, "extend");
  const completedRefund = presentOrder({ status: "completed", funding: { rental: { payable: 100, collected: 120, refunded: 0, balance: -20 } }, now });
  assert.ok(completedRefund.sub.includes("待退款"));
  assert.equal(matchesFilter(completedRefund, "unpaid"), false, "待退款不是待支付");
  assert.equal(matchesFilter(completedRefund, "finished"), true);
  assert.equal(matchesFilter(renting, "renting"), true);
  assert.equal(matchesFilter(presentOrder({ status: "return_inspection", now }), "renting"), true, "归还检查仍归在租赁中分组");
  assert.equal(matchesFilter(presentOrder({ status: "reserved", now }), "pickup"), true, "待商户确认归在待取货分组");
  assert.equal(presentOrder({ status: "reserved", pendingExtension: true, funding: settled, now }).sub.includes("续租处理中"), true);
  assert.equal(presentOrder({ status: "ready_for_pickup", now }).actions.some((action) => action.code === "guide"), true);
  assert.equal(presentOrder({ status: "ready_for_pickup", now }).actions.some((action) => action.code === "pay"), false, "资金未知时不显示付款按钮");
});

test("面向客户的用词不暴露内部枚举，未知取值原样返回而不是空白", () => {
  const labels = runtime().load("core/labels");
  assert.equal(labels.categoryLabel("camera"), "摄影器材");
  assert.equal(labels.fulfillmentLabel("store_pickup_return"), "门店自取");
  assert.equal(labels.inventoryLabel("consumable"), "一次性耗材（不需归还）");
  assert.equal(labels.membershipLabel("pending_activation"), "会员待审核");
  assert.equal(labels.chargeLabel("early_return_refund"), "提前归还退款");
  assert.equal(labels.categoryLabel("unknown_code"), "unknown_code");
  assert.equal(labels.categoryLabel(undefined), "");
});

test("门店距离：Haversine 估算与降级；无坐标/无位置不显示距离，最近门店只选可领取且有坐标者", () => {
  const r = runtime();
  const geo = r.load("core/geo");
  const here = { latitude: 31.2304, longitude: 121.4737 };
  // 约 1.6km 外的一点，估算应在 1~3km 之间。
  const near = geo.distanceMeters(here, { latitude: 31.2450, longitude: 121.4737 });
  assert.ok(near > 1000 && near < 3000, `距离估算异常: ${near}`);
  assert.equal(geo.distanceMeters(here, undefined), undefined, "缺一端坐标返回 undefined");
  assert.equal(geo.distanceMeters(undefined, here), undefined);
  assert.equal(geo.formatDistance(undefined), "", "无距离不显示");
  assert.match(geo.formatDistance(320), /m$/);
  assert.match(geo.formatDistance(3200), /km$/);

  const catalogStore = r.load("core/catalogStore");
  const locations = [
    { id: "far", status: "enabled", capabilities: ["pickup"], latitude: 31.30, longitude: 121.50 },
    { id: "near", status: "enabled", capabilities: ["pickup", "return"], latitude: 31.2310, longitude: 121.4740 },
    { id: "returnOnly", status: "enabled", capabilities: ["return"], latitude: 31.2305, longitude: 121.4738 },
    { id: "noCoord", status: "enabled", capabilities: ["pickup"] },
    { id: "disabled", status: "disabled", capabilities: ["pickup"], latitude: 31.2306, longitude: 121.4739 }
  ];
  assert.equal(catalogStore.nearestLocation(locations, here).id, "near", "只在可领取且有坐标的门店里选最近的一家");
  assert.equal(catalogStore.nearestLocation(locations, undefined), undefined, "无用户位置时不臆测最近门店");
  assert.equal(catalogStore.nearestLocation([{ id: "x", status: "enabled", capabilities: ["pickup"] }], here), undefined, "门店无坐标时返回空，调用方退回默认门店");
});

/* ---------------- 拟新增契约对账 ---------------- */

test("契约对账：无拟新增遗留项，已交付契约的路径确实出现在服务端 OpenAPI 文档中", () => {
  const openapi = fs.readFileSync(path.resolve(__dirname, "../apps/api/src/contracts/openapi-document.ts"), "utf8");
  const r = runtime();
  const { PLANNED_CONTRACTS, DELIVERED_CONTRACTS, contractMissing, featureUnavailable } = r.load("contracts/planned");
  const { ApiError } = r.load("core/http");

  // 未接通契约的登记表必须为空：新增拟接契约先登记，接通后从此表移除。
  assert.equal(Object.keys(PLANNED_CONTRACTS).length, 0, "PLANNED_CONTRACTS 应为空——仍有待接契约请补充对应静态断言");

  // 每个已交付契约都要真的能在 OpenAPI 文档里找到对应路径，避免前端调用未存在的接口。
  assert.ok(DELIVERED_CONTRACTS.length >= 8, "已交付契约数量异常偏少，可能被误删");
  for (const contract of DELIVERED_CONTRACTS) {
    const literal = `/api/client/v1${contract.path}`;
    assert.equal(openapi.includes(`"${literal}"`), true, `${contract.task}（${contract.method} ${contract.path}）未出现在 OpenAPI 文档中：契约与实现不一致`);
    assert.match(contract.task, /^MP-\d{2}[AB]?$/);
  }

  // 功能级关闭（未开通/未启用）统一识别为 404/501/503 或 NOT_FOUND/UNAVAILABLE；业务冲突不算“未开通”。
  assert.equal(contractMissing(new ApiError("NOT_FOUND", "x", { status: 404 })), true);
  assert.equal(contractMissing(new ApiError("UNAVAILABLE", "x", { status: 503 })), true);
  assert.equal(contractMissing(new ApiError("NOT_IMPLEMENTED", "x", { status: 501 })), true);
  assert.equal(contractMissing(new ApiError("CONFLICT", "x", { status: 409 })), false);

  const unavailable = featureUnavailable("商户尚未开通该能力");
  assert.equal(unavailable.code, "UNAVAILABLE");
  assert.equal(unavailable.status, 501);
  assert.ok(unavailable.message.length > 4);
});

test("受保护图片经 downloadFile 携带令牌加载，同地址只下载一次，失败返回空占位", async () => {
  const r = runtime();
  r.load("core/session").saveSession(sessionResponse(), "camera", "login");
  const images = r.load("core/images");
  let downloads = 0;
  r.wx.downloadFile = (options) => { downloads += 1; assert.match(options.header.Authorization, /^Bearer /); assert.match(options.url, /^https:\/\/merchant\.example\.invalid\/api\/client\/v1\/catalog/); options.success({ statusCode: downloads === 1 ? 200 : 404, tempFilePath: "wxfile://tmp/a" }); };
  const first = await images.resolveImage("/api/client/v1/catalog/items/i/images/a");
  const again = await images.resolveImage("/api/client/v1/catalog/items/i/images/a");
  assert.equal(first, "wxfile://tmp/a");
  assert.equal(again, first);
  assert.equal(downloads, 1);
  assert.equal(await images.resolveImage("/api/client/v1/catalog/items/i/images/b"), "");
  assert.equal(await images.resolveImage("https://cdn.example.invalid/x.png"), "https://cdn.example.invalid/x.png");
});
