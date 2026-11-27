/** Static contracts for the explicitly selected public admin or Rental contribution.
 * Reads source/manifests only; missing, empty or escaping inputs fail. This is not browser acceptance. */
const fs = require("node:fs");
const path = require("node:path");
function checkedPath(root, target, kind = "file") {
  const file = path.resolve(root, target), relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Selected source escapes its root: " + file);
  if (!fs.existsSync(file)) throw new Error("Selected source is missing: " + file);
  for (let current = file; current !== root; current = path.dirname(current))
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Selected source cannot follow links: " + current);
  const stat = fs.statSync(file);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) throw new Error("Selected source has the wrong type: " + file);
  return file;
}

let root = path.resolve(__dirname, ".."), mode, adminDirectory, hostDirectory, serverDirectory;
const manifests = [], args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const option = args[i], value = args[++i];
  if (!value || value.startsWith("--")) throw new Error("Admin check option requires a value: " + option);
  if (option === "--source-root") root = path.resolve(value);
  else if (option === "--mode") mode = value;
  else if (option === "--admin-root") adminDirectory = value;
  else if (option === "--host-root") hostDirectory = value;
  else if (option === "--server-root") serverDirectory = value;
  else if (option === "--manifest") manifests.push(value);
  else throw new Error("Unknown admin check option: " + option);
}
if (!["public", "rental"].includes(mode) || !adminDirectory || !hostDirectory || !serverDirectory || !manifests.length)
  throw new Error("Admin check requires --mode public|rental, --admin-root, --host-root, --server-root and --manifest within --source-root");
root = fs.realpathSync(root);
const adminRoot = checkedPath(root, adminDirectory, "directory"), hostRoot = checkedPath(root, hostDirectory, "directory");
const serverRoot = checkedPath(root, serverDirectory, "directory");
const readAt = (directory, file) => fs.readFileSync(checkedPath(root, path.join(directory, file)), "utf8");
const read = file => readAt(adminRoot, file), host = file => readAt(hostRoot, file), server = file => readAt(serverRoot, file);
function walk(directory, out = []) {
  checkedPath(root, directory, "directory");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Admin check cannot follow links: " + file);
    if (entry.isDirectory()) walk(file, out);
    else if (entry.isFile() && /\.(?:ts|tsx|css|vue)$/.test(file)) out.push(checkedPath(root, file));
  }
  return out;
}
const adminFiles = walk(adminRoot), hostFiles = walk(checkedPath(root, path.join(hostRoot, "src"), "directory"));
if (!adminFiles.length || !hostFiles.length) throw new Error("Admin check cannot accept an empty source selection");
const failures = [];
function requireText(source, expected, label) {
  if (!source.includes(expected)) failures.push(`${label}: missing ${expected}`);
}
function forbidText(source, unexpected, label) {
  if (source.includes(unexpected)) failures.push(`${label}: unexpected ${unexpected}`);
}
if (mode === "public") {
const router = read("application.tsx"), navigation = read("application-navigation.tsx"), access = read("application-access.ts");
const settings = read("features/platform-settings/client.ts"), management = read("features/access/management-client.ts");
const api = settings + "\n" + management;
const operations = read("features/platform-tools/client.ts");
const shell = read("PlatformShell.tsx") + "\n" + read("components/BusinessShell.tsx");
const appearanceSwitcher = read("components/AppearanceSwitcher.tsx"), pageHeader = read("components/PageHeading.tsx");
const loginPage = read("features/auth/LoginPage.tsx"), styles = read("styles.css") + "\n" + read("base.css");
const appRoot = read("AdminUiProvider.tsx"), themeSource = read("app/theme.tsx");
const queryClientSource = read("runtime/session-queries.ts"), authStoreSource = read("runtime/browser-session.ts");
const httpSource = read("runtime/browser-http.ts"), tenantManagementPage = read("features/access/PublicTenantManagementPage.tsx");
const platformPage = read("features/platform-settings/PlatformPage.tsx");
const platformOperationsPage = read("features/platform-settings/PlatformSecuritySettings.tsx");
const hostApp = host("src/App.tsx");
requireText(hostApp, 'from "@rental-os/platform-admin/application"', "host uses formal public application");
requireText(hostApp, "createPlatformAdminApplication", "public host composition");
["/platform/tenants", "/platform/users", "/platform/system", "/platform/operations", "/platform/tools"]
  .forEach(route => requireText(navigation, route, "public route registry coverage"));
// The historical seven-section writer is a separate compatibility contract;
// preserving its stored fields here does not establish migration of that writer.
["saveOrganization", "saveUser", "saveRole", "saveSecurityBaseline", "createTenant"]
  .forEach(method => requireText(api, method + ":", "public API write coverage"));
forbidText(api, "/rental-os/", "retired legacy endpoints must not return to the platform API client");
forbidText(operations, "/rental-os/", "retired legacy endpoints must not return to the operations API client");
["saveDictionary", "saveNumberRule", "createFileAsset", "createPrintJob", "createAsyncJob"]
  .forEach(method => requireText(operations, method + ":", "advanced operation coverage"));
["checkSecondConfirmation", "setOrganizationStatus"].forEach(method => requireText(api, method + ":", "advanced operation coverage"));
requireText(api, "tenants:", "tenant list API coverage");
requireText(api, "updateTenantStatus:", "tenant lifecycle API coverage");
for (const [label, source] of [["settings", settings], ["management", management], ["tools", operations]]) {
  requireText(source, 'request: AdminRuntime["request"]', "shared authenticated HTTP client (" + label + ")");
  requireText(source, "runtime.request", "host request injection (" + label + ")");
  forbidText(source, "axios.create", "domain client cannot recreate transport");
  forbidText(source, "rental_os_access_token", "retired auth storage key");
}
requireText(httpSource, "const token = session.accessToken()", "canonical transport reads selected session");
requireText(httpSource, 'config.headers.Authorization = \x60Bearer \x24{token}\x60', "original bearer transport");
requireText(router, "queryClient={session.queryClient}", "shared query client");

requireText(queryClientSource, "queryClient.cancelQueries()", "cancel previous tenant queries");

requireText(queryClientSource, "queryClient.clear()", "clear previous tenant cache");

const sessionCacheClearCount = (authStoreSource.match(/clearSessionQueryCache\(\)/g) ?? []).length;

if (sessionCacheClearCount < 4) {
  failures.push("tenant cache isolation: login, logout, password rotation and changed bootstrap context must clear query state");
}
for (const [source, expected, label] of [
  [tenantManagementPage, "api.tenants", "tenant list UI"], [tenantManagementPage, "api.createTenant", "public tenant create UI"],
  [tenantManagementPage, "updateTenantStatus", "tenant lifecycle UI"], [platformPage, "setOrganizationStatus", "organization status UI"],
  [platformOperationsPage, 'key: "second-confirmation"', "second confirmation UI"]
]) requireText(source, expected, label);
requireText(platformOperationsPage, "校验能力尚未开放", "unavailable second confirmation is not advertised as ready");
const settingsAccess = read("features/platform-settings/platformSettingsAccess.ts");
const settingsController = server("modules/platform/platform-management.controller.ts");
const settingsPolicy = server("modules/platform/platform-settings-http-policy.ts");
const settingsService = server("modules/platform/platform-management.service.ts");
const settingsRepository = server("modules/platform/platform-management.repository.ts");
for (const [source, expected, label] of [
  [settings, 'request<SystemSecurityBaselineConfig>("/platform/security-baseline", { method: "put", data: { config, operator }, retryAuthentication: false })', "security baseline HTTP client"],
  [platformOperationsPage, "const current = runtime.getSession()", "security baseline current session"],
  [platformOperationsPage, "runtime.currentSessionEpoch() !== epoch || !current.sessionVerified || !canWriteSecurityBaseline(current.user)", "security baseline save authority"],
  [platformOperationsPage, "if (!isCurrent()) throw", "security baseline stale form refusal"],
  [platformOperationsPage, "return api.saveSecurityBaseline(config)", "security baseline page mutation"],
  [settingsAccess, 'security: { path: "/platform/system", permission: "system:params:manage" }', "security baseline page permission"],
  [settingsAccess, "return user?.isSaasAdmin === true && canReadSecurityBaseline(user)", "security baseline SaaS write gate"],
  [settingsController, '@Put("security-baseline")', "security baseline HTTP route"],
  [settingsController, "return this.service.saveSecurityBaseline(body.config)", "security baseline controller consumer"],
  [settingsPolicy, 'method: "PUT", path: "/platform/security-baseline", id: "saveSecurityBaseline"', "security baseline HTTP policy"],
  [settingsPolicy, 'access: "saas", permission: "system:params:manage", request: "PlatformSettings.SaveSecurityBaseline"', "security baseline server permission"],
  [settingsService, 'this.run("system:params:manage", true, PLATFORM_SECURITY_TENANT_ID', "security baseline current SaaS authority"],
  [settingsService, "validateSecurityBaseline(security)", "security baseline validation"],
  [settingsService, "await this.repository.saveSecurityBaseline(tx, security, user.displayName)", "security baseline original transaction and actor"],
  [settingsService, 'await this.audit(tx, user, PLATFORM_SECURITY_TENANT_ID, "security-baseline.update"', "security baseline same transaction audit"],
  [settingsRepository, "const previous = current?.content ?? {}", "security baseline original content"],
  [settingsRepository, 'typeof previous !== "object" || Array.isArray(previous)', "security baseline invalid history refusal"],
  [settingsRepository, "{ ...previous, security: { ...security }, updatedAt: new Date().toISOString(), updatedBy: operator }", "security baseline preserves other historical fields"],
  [settingsRepository, "where: { id: current.id, versionNo: current.versionNo, ...where }", "security baseline original row and version"],
  [settingsRepository, "if (updated.count !== 1) throw", "security baseline concurrent change refusal"]
]) requireText(source, expected, label);
for (const legacyLabel of ["车辆合同与单据", "车辆财务结算", "车辆履约调度", "车辆调拨与 TBox", "车辆生命周期", "车辆运营控制台", "车辆兼容报表"]) {
  forbidText(navigation, legacyLabel, "legacy rental-os route must not be registered");
}
requireText(navigation, 'canManagePublicResource(user, "saas"', "SaaS route audience guard");
requireText(navigation, 'canManagePublicResource(user, "tenant"', "tenant route audience guard");
requireText(access, "if (!user.isSaasAdmin) return false", "SaaS identity is not caller metadata");
requireText(access, "user.tenantMembership", "tenant authority comes from original membership");
requireText(router, "publicAdminNavigation", "application consumes common public menu registry");
requireText(shell, "coreNavigationEntries(pages, cores.data, locale)", "shell consumes authorized Core registry");
requireText(router, "createCoreRouteElements", "router consumes same Core registry");
requireText(router, "<Outlet key={session.currentSessionEpoch()}", "workspace switch remounts active data pages");
requireText(router, "sessionVerified && canManagePublicResource", "direct route access enforces authenticated audience");
forbidText(tenantManagementPage, "经营品类创建后固定；租户", "retired tenant-level single-category copy");
[
  [appRoot, 'variant="outlined"', "Ant Design v6 outlined control archetype"],
  [themeSource, 'cssVar:', "Ant Design CSS variable theme"],
  [themeSource, 'theme.darkAlgorithm', "official dark algorithm"],
  [themeSource, '"default" | "dark" | "compact"', "official appearance presets"],
  [themeSource, 'theme.compactAlgorithm', "official compact algorithm"],
  [themeSource, 'bodyBg: palette.background', "shared UIArc dashboard layout background"],
  [themeSource, 'activeBarBorderWidth: 0', "official dashboard menu treatment"],
  [appearanceSwitcher, '切换外观主题', "theme switcher"],
  [loginPage, 'login-frame', "compact framed login composition"],
  [pageHeader, 'page-toolbar', "optional business-owned view and action toolbar"],
  [shell, '<SidebarProvider', "native Animate UI sidebar shell"],
  [styles, 'padding: 6px', "narrow browser-edge breathing room"],
  [styles, 'border-radius: 14px', "rounded application frame"],
  [shell, '<Breadcrumb aria-label={t("面包屑")}', "plain contextual breadcrumb"],
  [themeSource, 'cellPaddingBlock: ADMIN_TABLE_METRICS.cellPaddingBlock', "official dashboard table density"],
  [styles, '.ant-segmented', "official pill segmented styling"],
  [styles, '.ant-tabs .ant-tabs-nav-list', "pill section tabs"],
  [styles, '.standalone-tabs > .ant-tabs-content-holder', "tabs separated from content panel"],
  [styles, '.tabbed-workspace.ant-card', "legacy tab card wrapper removed visually"],
  [styles, '--rental-ui-radius-control', "shared configurable control radius token"],
  [styles, '.ant-table-wrapper .ant-table-thead', "official table header styling"],
  [styles, 'transform: scale(.97)', "direct press feedback"]
].forEach(([source, expected, label]) => requireText(source, expected, label));


if (/<Typography\.(Title|Paragraph)\b/u.test(pageHeader)) {
  failures.push("Ant Design dashboard layout contract: legacy title-and-subtitle PageHeader returned");
}

if (pageHeader.includes("Segmented")) {
  failures.push("Ant Design dashboard layout contract: shell forced a demo-specific segmented control into every page");
}


const visualSource = `${shell}\n${loginPage}\n${styles}`;

[
  ['stage-orb', "decorative website-stage orb"],
  ['type="card"', "filled card tabs"],
  ['linear-gradient', "decorative gradient"],
  ['radial-gradient', "decorative gradient"]
].forEach(([text, label]) => {
  if (visualSource.includes(text)) failures.push(`Ant Design design.md visual contract: forbidden ${label}`);
});

if (themeSource.includes('"glass"')) failures.push("Ant Design design.md visual contract: custom glass algorithm returned");

if (/\.(?:app-frame-stage|login-stage)\s*\{[^}]*padding:\s*12px/s.test(styles)) {
  failures.push("Ant Design dashboard layout contract: application frame gutter is wider than the approved compact gutter");
}
}
if (mode === "rental") {
const commercialPage = read("commercial/RentalCommercialPage.tsx"), pricingGroupPage = read("commercial/PricingGroupPage.tsx");
const governancePage = read("governance/RentalGovernancePage.tsx"), governanceRulesTab = read("governance/RulesTab.tsx");
const governanceRuleSections = read("governance/ruleSections.tsx"), governanceNotificationsTab = read("governance/NotificationsTab.tsx");
const locationPage = read("locations/LocationPage.tsx"), rentalOrderDetailPage = read("orders/RentalOrderDetailPage.tsx");
const rentalOrderDetailSummary = read("orders/OrderDetailSummary.tsx"), catalogPage = read("catalog/CatalogPage.tsx");
const assetWorkspacePage = read("catalog/AssetWorkspacePage.tsx"), capabilityPage = read("capabilities/CapabilityGovernancePage.tsx");
const groups = ["orders", "catalog", "commercial", "governance", "locations", "operations", "membership", "capabilities"];
const navigation = groups.map(group => read(group + "/pages.ts")).join("\n");
const rentalCoreApi = [...groups.map(group => read(group + "/client.ts")), read("membership/rewards-client.ts")].join("\n");
const browserNavigation = read("browser-navigation.ts"), presentation = read("browser-navigation-presentation.tsx");
const tenantManagementPage = read("access/TenantManagementPage.tsx"), httpSource = read("browser-http.ts");
const authStoreSource = read("browser-auth-store.ts");
const hostSource = host("src/main.tsx");
// Mock integration is a Rental operation. Its production refusal and simulated
// receipt remain checked here; the public tools client must not acquire it.
const integrationController = server("http-integrations.controller.ts"), integrationRuntime = server("integration-runtime.ts");
const integrationAccess = server("http-integration-access.ts"), integrationAuth = server("http-auth.ts");
const integrationRepository = server("mysql-integrations.ts");
for (const field of ["provider", "capability", "operation"])
  requireText(integrationRuntime, "validateRequired(input." + field + ",", "Rental mock required input");
for (const [source, expected, label] of [
  [integrationController, '@Post("adapters/mock-call")', "Rental mock route"],
  [integrationController, "return this.integrationsService.invokeMockAdapter(body)", "Rental mock consumer"],
  [integrationRuntime, 'process.env.NODE_ENV === "production" && ["payment", "pre_auth", "sms", "file"].includes(input.capability)', "Rental mock production restriction"],
  [integrationRuntime, 'throw new ServiceUnavailableException("生产环境禁止调用支付、短信或文件模拟适配器")', "Rental mock production refusal"],
  [integrationRuntime, 'status: "mock_success"', "Rental mock receipt status"],
  [integrationRuntime, "externalCallSkipped: true", "Rental mock external call marker"],
  [integrationAccess, 'handler: integrations.mockCall, kind: "transactional-write"', "Rental mock current Core admission"],
  [integrationRepository, "lockRentalBusinessTenant(transaction, tenantId)", "Rental mock tenant transaction"],
  [integrationRepository, "recordAdapterLog(input, tenantId)", "Rental mock original tenant ledger"]
]) requireText(source, expected, label);
if (!/path\.startsWith\("\/integrations"\)\s*\|\|\s*path\.startsWith\("\/notifications"\)\s*\|\|\s*path\.startsWith\("\/jobs"\)\s*\)\s*\{\s*return \["system:integration:manage"\];/u.test(integrationAuth))
  failures.push("Rental mock permission: original integration management permission is missing");
requireText(hostSource, 'from "@rental-os/platform-admin/application"', "Rental host uses formal public application");
requireText(hostSource, "registerCoreAdminPages", "Rental host registers real contribution");
["/workbench", "/orders", "/item-groups", "/assets", "/locations", "/pricing", "/discounts", "/coupons", "/services", "/settings", "/capabilities", "/membership/reviews", "/membership/personal", "/membership/corporate", "/membership/plans", "/membership/rewards"]
  .forEach(route => requireText(navigation, 'path: "' + route + '"', "Rental route registry coverage"));
[
  "categories", "profile", "businessSettings", "saveBusinessSettings", "couponTemplates", "saveCouponTemplate", "operators", "saveOperator", "locations", "saveLocation", "itemGroups", "assets", "stockBalances", "orderPage", "orderExportRows",
  "createOrder", "confirmOrder", "allocateOrder", "substituteBundleComponent", "partialReturnOrder", "cancelOrder", "inspectionTemplates", "createInspection", "pricingPlans", "discountPlans", "valueAddedServices", "calendar", "ruleVersions", "rewards", "notificationTemplates", "createQuote",
  // CORE-EXT-02C：能力治理的读写入口必须存在，否则页面只能变成静态展示。
  "capabilities", "saveCapability", "upgradeCapability", "capabilityAudits"
].forEach((method) => requireText(rentalCoreApi, `${method}:`, "Rental Core API coverage"));
for (const file of ["RentalCorePage.tsx", "features/rental-core/RentalCorePage.tsx"]) {
  if (fs.existsSync(path.join(adminRoot, file)) || fs.existsSync(path.join(hostRoot, "src", file)))
    failures.push("retired debug console must stay deleted: " + file);
}

// CORE-EXT-02C：能力页必须同时表达五种状态、三种种类、依赖、配置、版本与升级，
// 并把「可访问」与「已达生产经营条件」分开显示。少任何一项，页面就退化成开关列表。
[
  "已声明但未实现", "已暂停", "已启用", "未启用",
  "品类必选", "可选增强", "跨品类共享",
  "依赖 / 互斥", "configSchema", "upgradeAvailable",
  // P2-2：本页不得再使用 Ant Design 6 的弃用 API（`message` / `direction` / Drawer `width`）。
  // 用「新 API 必须出现」来表达，因为弃用 API 的字符串在别处也可能合法出现。
  "orientation=\"vertical\"", "size={560}",
  "missingRequired", "expectedRevision", "变更能力状态必须填写原因"
].forEach((label) => requireText(capabilityPage, label, "capability governance UI coverage"));

if (
  !capabilityPage.includes('title="该经营空间尚未达到生产经营条件"') &&
  !capabilityPage.includes('title={t("该经营空间尚未达到生产经营条件")}')
) {
  failures.push("capability governance UI coverage: missing production-readiness warning title");
}

if (
  !capabilityPage.includes('title="该经营空间已达到生产经营条件"') &&
  !capabilityPage.includes('title={t("该经营空间已达到生产经营条件")}')
) {
  failures.push("capability governance UI coverage: missing production-readiness success title");
}

[
  "替换套装组成", "部分归还", "allocation.itemGroupId", "allocation.quantity > 1"
].forEach((label) => requireText(rentalOrderDetailPage, label, "inventory fulfillment UI coverage"));

if (!/<OrderDetailSummary\b[^>]*\border=\{detail\}/s.test(rentalOrderDetailPage)) failures.push("detail renders snapshot summary: missing original order prop");

[
  "order.fulfillmentLocationSnapshot.name", "order.fulfillmentLocationSnapshot.operator.name",
  "order.returnLocationSnapshot.name", "order.returnLocationSnapshot.operator.name"
].forEach((label) => requireText(rentalOrderDetailSummary, label, "inventory fulfillment snapshot summary"));

[
  "substitutionGroup", "默认组成", "替代候选"
].forEach((label) => requireText(catalogPage, label, "bundle component UI coverage"));

// 品类动态属性控件必须把 Form.Item 注入的受控属性透传给内部控件。不透传时控件退化为非受控：
// 输入只改 DOM、不进表单值，而四个品类的 item_group / asset 必填属性（厂商、品牌、型号、
// 序列号等）全部走这个组件，表现为「框里明明有值，保存仍报请输入厂商」且不发出任何请求——
// 新增型号与登记资产在管理端被彻底卡死（浏览器实测复现）。
[catalogPage, assetWorkspacePage].forEach((source, index) => {
  const label = index === 0 ? "catalog attribute control wiring" : "asset attribute control wiring";
  requireText(source, "value?: unknown", label);
  requireText(source, "checked?: boolean", `${label}: boolean prop`);
  requireText(source, "onChange?: (...args: never[]) => void", label);
  requireText(source, "value={value as string}", `${label}: string/date input`);
  requireText(source, "value={value as number}", `${label}: number input`);
  requireText(source, "checked={checked ?? Boolean(value)}", `${label}: boolean switch`);
});

// 押金/预授权两组独立字段的编辑 UI 抽到 governance/ruleSections.tsx 的 RULE_SECTIONS，
// 供「业务规则」页签与后续「新建规则向导」共用；押金/预授权的展示派生仍在 RulesTab。
[
  'name={["deposit", "mode"]}',
  'name={["deposit", "maxAmount"]}',
  'name={["preauthorization", "mode"]}',
  'name={["preauthorization", "maxAmount"]}',
  '[["none", securityRuleLabels.none]]'
].forEach((label) => requireText(governanceRuleSections, label, "independent deposit and preauthorization rule UI"));

requireText(governanceRulesTab, "ruleSecurityGroups", "independent deposit and preauthorization rule UI");

// 分区清单必须导出以供向导复用，且 RulesTab 通过映射它来渲染各分区。
requireText(governanceRuleSections, "export const RULE_SECTIONS", "rule sections exported for wizard reuse");

requireText(governanceRulesTab, "RULE_SECTIONS.map", "rules tab renders sections from RULE_SECTIONS");

[
  'name="initialRates"',
  'name={[field.name, "baseAmount"]}',
  "第一行是默认计价单位"
].forEach((label) => requireText(pricingGroupPage, label, "pricing group must create simple base rates"));

[
  "初始化未定价分组",
  'name={[field.name, "preAuthAmount"]}',
  'name={[field.name, "preAuthMultiple"]}',
  "每件固定押金",
  "每件预授权额度"
].forEach((label) => forbidText(commercialPage, label, "base pricing page must not expose initialization or advanced pricing fields"));

[
  "新增调价计划",
  "只调整需要变更的价格；确认后才会生效或进入待生效。",
  "currentByKey",
  "价格没有变化，请先填写至少一个新的价格",
  'queryKey: ["rental-core", "price-adjustments"]'
].forEach((label) => requireText(commercialPage, label, "workspace-wide price adjustment UI"));

[
  "currentPriceVersionDetail.data?.rates",
  "当前整体价格版本",
  "currentPriceVersion.effectiveFrom",
  "空间价格版本"
].forEach((label) => requireText(commercialPage, label, "space-wide immutable price version UI"));

forbidText(commercialPage, "commercial-switcher", "commercial pages must rely on independent sidebar routes instead of duplicate tabs");
if (!httpSource.includes('window.localStorage.getItem("rental_access_token")')) {
  failures.push("authentication contract: canonical HTTP client does not read the current React auth token");
}

const sessionCacheClearCount = (authStoreSource.match(/clearSessionQueryCache\(\)/g) ?? []).length;

if (sessionCacheClearCount < 4) {
  failures.push("tenant cache isolation: login, logout, password rotation and changed bootstrap context must clear query state");
}
[
  [commercialPage, "rentalCoreApi.pricingPlans", "generic pricing UI"],
  [commercialPage, "rentalCoreApi.discountPlans", "generic discount UI"],
  [governanceRulesTab, "rentalCoreApi.ruleVersions", "generic rule version UI"],
  [governanceNotificationsTab, "rentalCoreApi.notificationTemplates", "tenant notification template UI"],
  // 治理页拆成外壳 + 每页签一个文件后，页签清单与权限判定必须只来自同一份 TABS 配置，
  // 否则「可进入的页签」和「实际渲染的页签」会再次各自漂移。
  [governancePage, "const TABS", "governance tabs single source"],
  [governancePage, "TABS.filter((definition) => definition.permitted(permissions))", "governance tabs derive permitted list from TABS"],
  [locationPage, "rentalCoreApi.saveLocation", "generic fulfillment location UI"]
].forEach(([source, expected, label]) => requireText(source, expected, label));
["价格版本与调价", "优惠方案", "优惠券", "增值服务", "品类与业务规则", "会员审核", "个人会员", "企业会员", "会员方案"]
  .forEach(label => requireText(navigation, label, "Rental navigation registry coverage"));
requireText(browserNavigation, "pages.values()", "Rental navigation derives from registered pages");
requireText(browserNavigation, "canUseCorePage(context, page.coreId, page.definition.permissions)", "current Core and permission guard");
requireText(browserNavigation, "!auth.sessionVerified", "navigation requires verified session");
requireText(browserNavigation, "auth.user.isSaasAdmin", "Rental navigation refuses SaaS business access");
requireText(presentation, "createRentalNavigationPresentation", "terminology presentation uses same registered pages");
for (const legacyLabel of ["车辆合同与单据", "车辆财务结算", "车辆履约调度", "车辆调拨与 TBox", "车辆生命周期", "车辆运营控制台", "车辆兼容报表"]) {
  forbidText(navigation, legacyLabel, "legacy rental-os route must not be registered");
}
requireText(tenantManagementPage, '"/platform/tenant-bootstrap"', "original Rental tenant bootstrap");
requireText(tenantManagementPage, '"/workspaces"', "SaaS target tenant workspace list/create UI");
requireText(tenantManagementPage, "createWorkspace", "SaaS target tenant workspace create UI");
requireText(tenantManagementPage, "saveWorkspace", "SaaS target tenant workspace update UI");
forbidText(tenantManagementPage, "经营品类创建后固定；租户", "retired tenant-level single-category copy");
}
// Scan only the selected source closures; another host is never an implicit prerequisite.
const forbidden = [], embeddedPrimaryTabs = [], retiredVueFiles = [];
for (const file of new Set([...adminFiles, ...hostFiles])) {
  if (file.endsWith(".vue")) { retiredVueFiles.push(path.relative(root, file)); continue; }
  const source = fs.readFileSync(file, "utf8");
  if (/from\s+["']vue["']|element-plus|\.vue["']/.test(source)) forbidden.push(path.relative(root, file));
  if (/<Card[^>]*className=["'][^"']*data-panel[^"']*["'][^>]*>\s*<Tabs/s.test(source)) embeddedPrimaryTabs.push(path.relative(root, file));
}
if (forbidden.length) failures.push("React app imports removed frontend dependencies: " + forbidden.join(", "));
if (embeddedPrimaryTabs.length) failures.push("primary tabs remain embedded in content cards: " + embeddedPrimaryTabs.join(", "));
if (retiredVueFiles.length) failures.push("retired Vue source files still exist: " + retiredVueFiles.join(", "));
const retiredPages = ["contracts/ContractsPage.tsx","finance/FinancePage.tsx","operations/OperationsPage.tsx","operations/AssetOperationsPage.tsx","catalog/AssetLifecyclePage.tsx","advanced/BusinessToolsPage.tsx","reports/ReportsPage.tsx","customers/CustomerPage.tsx"];
for (const retiredPage of retiredPages) for (const directory of [adminRoot, path.join(adminRoot, "features"), path.join(hostRoot, "src/features")])
  if (fs.existsSync(path.join(directory, retiredPage))) failures.push("legacy rental-os page must stay deleted: " + retiredPage);
const manifestPaths = manifests.map(file => checkedPath(root, file));
if (!manifestPaths.includes(checkedPath(root, "package.json")) || !manifestPaths.includes(checkedPath(root, path.join(hostRoot, "package.json")))
  || !manifestPaths.some(file => ["package-lock.json", "workspace.build-lock.json"].includes(path.basename(file))))
  throw new Error("Admin check requires the selected root manifest, host manifest and dependency lock");
const packageFiles = manifestPaths.map(file => fs.readFileSync(file, "utf8"));
if (packageFiles.some((source) => /"(?:vue|vue-router|pinia|element-plus|vue-tsc|@vitejs\/plugin-vue)"/.test(source))) {
  failures.push("package manifests or lockfile still contain removed frontend dependencies");
}
if (packageFiles.some((source) => source.includes("@rental-os/admin-next") || source.includes('"apps/admin-next"'))) {
  failures.push("package metadata still contains the temporary React workspace");
}
if (fs.existsSync(path.join(path.dirname(hostRoot), "admin-next"))) failures.push("temporary apps/admin-next directory still exists");
if (failures.length) {
  console.error(failures.map(failure => "- " + failure).join("\n"));
  process.exitCode = 1;
} else console.log("React admin static contract passed (" + mode + "): " + adminFiles.length + " contribution and " + hostFiles.length + " host source files; no retired host fallback.");
