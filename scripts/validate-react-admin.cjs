const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const reactRoot = path.join(root, "apps", "admin", "src");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function requireText(source, expected, label) {
  if (!source.includes(expected)) failures.push(`${label}: missing ${expected}`);
}

function forbidText(source, unexpected, label) {
  if (source.includes(unexpected)) failures.push(`${label}: unexpected ${unexpected}`);
}

const router = read("apps/admin/src/app/AppRouter.tsx");
const navigation = read("apps/admin/src/app/navigation.tsx");
const api = read("apps/admin/src/api/rental.ts");
const httpSource = read("apps/admin/src/api/http.ts");
const operations = read("apps/admin/src/api/operations.ts");
const shell = read("apps/admin/src/components/AppShell.tsx");
const appearanceSwitcher = read("apps/admin/src/components/AppearanceSwitcher.tsx");
const pageHeader = read("apps/admin/src/components/PageHeader.tsx");
const loginPage = read("apps/admin/src/features/auth/LoginPage.tsx");
const styles = read("apps/admin/src/styles.css");
const commercialPage = read("apps/admin/src/features/commercial/RentalCommercialPage.tsx");
const governancePage = read("apps/admin/src/features/settings/RentalGovernancePage.tsx");
const locationPage = read("apps/admin/src/features/fulfillment/LocationPage.tsx");
const platformPage = read("apps/admin/src/features/platform/PlatformPage.tsx");
const tenantManagementPage = read("apps/admin/src/features/platform/TenantManagementPage.tsx");
const platformOperationsPage = read("apps/admin/src/features/platform/PlatformOperationsPage.tsx");
const assetLifecyclePage = read("apps/admin/src/features/catalog/AssetLifecyclePage.tsx");
const rentalCorePage = read("apps/admin/src/features/rental-core/RentalCorePage.tsx");
const rentalOrderDetailPage = read("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");
const catalogPage = read("apps/admin/src/features/catalog/CatalogPage.tsx");
const rentalCoreApi = read("apps/admin/src/api/rentalCore.ts");
const capabilityPage = read("apps/admin/src/features/rental-core/CapabilityGovernancePage.tsx");
const appRoot = read("apps/admin/src/app/App.tsx");
const queryClientSource = read("apps/admin/src/app/queryClient.ts");
const authStoreSource = read("apps/admin/src/features/auth/authStore.ts");
const themeSource = read("apps/admin/src/app/theme.tsx");

[
  "/workbench", "/rental/core", "/rental/orders", "/rental/item-groups", "/rental/assets",
  "/rental/locations", "/rental/pricing", "/rental/discounts", "/rental/coupons", "/rental/services", "/rental/settings", "/rental/capabilities", "/customers",
  "/platform/tenants", "/platform/users", "/platform/system", "/platform/operations", "/platform/tools"
].forEach((route) => requireText(navigation, `path: "${route}"`, "route registry coverage"));

[
  "savePricingPlan", "saveMarketingPlan", "saveMember", "processMemberRisk", "saveCorporate",
  "saveFinanceDocument", "saveFinancePreAuth", "createFinanceAdjustment", "processFinanceAdjustment",
  "bindTboxDevice", "runTboxCommand", "saveOrganization", "saveUser", "saveRole", "saveSystemRuleSection"
].forEach((method) => requireText(api, `${method}:`, "API write coverage"));

[
  "categories", "profile", "businessSettings", "saveBusinessSettings", "couponTemplates", "saveCouponTemplate", "operators", "saveOperator", "locations", "saveLocation", "itemGroups", "assets", "stockBalances", "availability", "orders",
  "createOrder", "confirmOrder", "allocateOrder", "substituteBundleComponent", "partialReturnOrder", "cancelOrder", "inspectionTemplates", "createInspection", "pricingPlans", "discountPlans", "valueAddedServices", "calendar", "ruleVersions", "rewards", "notificationTemplates", "createQuote",
  // CORE-EXT-02C：能力治理的读写入口必须存在，否则页面只能变成静态展示。
  "capabilities", "saveCapability", "upgradeCapability", "capabilityAudits"
].forEach((method) => requireText(rentalCoreApi, `${method}:`, "Rental Core API coverage"));
[
  "Rental Core v0.1", "序列化资产", "数量库存", "套装", "确认预占", "执行配货"
].forEach((label) => requireText(rentalCorePage, label, "Rental Core UI coverage"));
// CORE-EXT-02C：能力页必须同时表达五种状态、三种种类、依赖、配置、版本与升级，
// 并把「可访问」与「已达生产经营条件」分开显示。少任何一项，页面就退化成开关列表。
[
  "已声明但未实现", "已暂停", "已启用", "未启用",
  "品类必选", "可选增强", "跨品类共享",
  "依赖 / 互斥", "configSchema", "upgradeAvailable",
  "该经营空间尚未达到生产经营条件", "该经营空间已达到生产经营条件",
  // P2-2：本页不得再使用 Ant Design 6 的弃用 API（`message` / `direction` / Drawer `width`）。
  // 用「新 API 必须出现」来表达，因为弃用 API 的字符串在别处也可能合法出现。
  "title=\"该经营空间尚未达到生产经营条件\"", "orientation=\"vertical\"", "size={560}",
  "missingRequired", "expectedRevision", "变更能力状态必须填写原因"
].forEach((label) => requireText(capabilityPage, label, "capability governance UI coverage"));
[
  "替换套装组成", "部分归还", "allocation.itemGroupId", "allocation.quantity > 1",
  "detail.fulfillmentLocationSnapshot.name", "detail.fulfillmentLocationSnapshot.operator.name",
  "detail.returnLocationSnapshot.name", "detail.returnLocationSnapshot.operator.name"
].forEach((label) => requireText(rentalOrderDetailPage, label, "inventory fulfillment UI coverage"));
[
  "substitutionGroup", "默认组成", "替代候选"
].forEach((label) => requireText(catalogPage, label, "bundle component UI coverage"));
[
  'name={["deposit", "mode"]}',
  'name={["deposit", "maxAmount"]}',
  'name={["preauthorization", "mode"]}',
  'name={["preauthorization", "maxAmount"]}',
  "ruleSecurityGroups",
  '[["none", securityRuleLabels.none]]'
].forEach((label) => requireText(governancePage, label, "independent deposit and preauthorization rule UI"));
[
  'name={[field.name, "preAuthAmount"]}',
  'name={[field.name, "preAuthMultiple"]}',
  "每件固定押金",
  "每件预授权额度"
].forEach((label) => requireText(commercialPage, label, "independent deposit and preauthorization rate UI"));

[
  "createPriceSchedule", "previewDispatchOptimization", "applyDispatchOptimization", "manualReassignFromDispatch",
  "createStoreRentalOrderFee", "createStoreRentalOrderTransaction", "settleCorporateMonthlyBill",
  "createVehicleMaintenanceRecord", "saveVehicleCredential", "saveStationCalendarDay",
  "bootstrapTenant", "savePlatformDictionary", "savePlatformNumberRule", "createFileAsset", "createPrintJob",
  "createAsyncJob", "createStoreRentalReportExport", "downloadStoreRentalReportExport",
  "checkSecondConfirmation", "getRentalRuleVersion", "invokeMockAdapter", "listRentalRuleVersions",
  "listStationHierarchy", "setOrganizationStatus", "updateVehicleAccidentRecord",
  "updateVehicleLocationEvent", "updateVehicleMaintenanceRecord"
].forEach((method) => requireText(operations, `function ${method}`, "advanced operation coverage"));

requireText(operations, "function listTenants", "tenant list API coverage");
requireText(operations, "function updateTenantStatus", "tenant lifecycle API coverage");
requireText(operations, 'import { http } from "./http";', "shared authenticated HTTP client");
if (operations.includes("axios.create") || operations.includes("store_rental_access_token")) {
  failures.push("authentication contract: operations API recreated the HTTP client or uses retired auth storage keys");
}
if (!httpSource.includes('window.localStorage.getItem("rental_access_token")')) {
  failures.push("authentication contract: canonical HTTP client does not read the current React auth token");
}
requireText(appRoot, 'import { queryClient } from "./queryClient"', "shared query client");
requireText(queryClientSource, "queryClient.cancelQueries()", "cancel previous tenant queries");
requireText(queryClientSource, "queryClient.clear()", "clear previous tenant cache");
const sessionCacheClearCount = (authStoreSource.match(/clearSessionQueryCache\(\)/g) ?? []).length;
if (sessionCacheClearCount < 4) {
  failures.push("tenant cache isolation: login, logout, password rotation and changed bootstrap context must clear query state");
}

[
  [commercialPage, "rentalCoreApi.pricingPlans", "generic pricing UI"],
  [commercialPage, "rentalCoreApi.discountPlans", "generic discount UI"],
  [governancePage, "rentalCoreApi.ruleVersions", "generic rule version UI"],
  [governancePage, "rentalCoreApi.notificationTemplates", "tenant notification template UI"],
  [locationPage, "rentalCoreApi.saveLocation", "generic fulfillment location UI"],
  [tenantManagementPage, "listTenants", "tenant list UI"],
  [tenantManagementPage, "bootstrapTenant", "tenant bootstrap UI"],
  [tenantManagementPage, "updateTenantStatus", "tenant lifecycle UI"],
  [platformPage, "setOrganizationStatus", "organization status UI"],
  [platformOperationsPage, "checkSecondConfirmation", "second confirmation UI"],
  [platformOperationsPage, "invokeMockAdapter", "mock adapter UI"],
  [assetLifecyclePage, "updateVehicleLocationEvent", "location event edit UI"],
  [assetLifecyclePage, "updateVehicleMaintenanceRecord", "maintenance record edit UI"],
  [assetLifecyclePage, "updateVehicleAccidentRecord", "accident record edit UI"]
].forEach(([source, expected, label]) => requireText(source, expected, label));

[
  "租赁工作台", "基础定价", "优惠方案", "优惠券", "增值服务", "品类与业务规则", "客户、会员与企业", "组织与权限", "平台工具与治理"
].forEach((label) => requireText(navigation, label, "navigation registry coverage"));
requireText(navigation, "categories?: RentalCategoryCode[]", "category-specific route metadata");
requireText(navigation, "route.categories.includes(categoryCode)", "category-specific route guard");
requireText(navigation, 'audience: "tenant" | "saas"', "SaaS and tenant route audience metadata");
requireText(navigation, '(route.audience === "saas") !== isSaasAdmin', "SaaS and tenant route audience guard");
requireText(shell, "Boolean(user?.isSaasAdmin)", "navigation filters by authenticated audience");
for (const legacyLabel of ["车辆合同与单据", "车辆财务结算", "车辆履约调度", "车辆调拨与 TBox", "车辆生命周期", "车辆运营控制台", "车辆兼容报表"]) {
  forbidText(navigation, legacyLabel, "legacy store-rental route must not be registered");
}
for (const legacyPage of ["ContractsPage", "FinancePage", "OperationsPage", "AssetOperationsPage", "AssetLifecyclePage", "BusinessToolsPage", "ReportsPage"]) {
  forbidText(router, `const ${legacyPage} = lazy`, "legacy store-rental page must not be routed");
}

requireText(shell, "APP_NAVIGATION", "shell consumes unified navigation registry");
requireText(router, "APP_ROUTES", "router consumes unified route registry");
requireText(router, "workspaceScopeKey", "workspace switch remount boundary");
requireText(router, '<AppShell key={workspaceScopeKey}>', "workspace switch remounts active data pages");
requireText(router, "categoryCode, isSaasAdmin", "direct route access enforces authenticated audience");
requireText(tenantManagementPage, "listTenantWorkspaces", "SaaS target tenant workspace list UI");
requireText(tenantManagementPage, "createTenantWorkspace", "SaaS target tenant workspace create UI");
requireText(tenantManagementPage, "updateTenantWorkspace", "SaaS target tenant workspace update UI");
forbidText(tenantManagementPage, "经营品类创建后固定；租户", "retired tenant-level single-category copy");

[
  [appRoot, 'variant="outlined"', "Ant Design v6 outlined control archetype"],
  [themeSource, 'cssVar:', "Ant Design CSS variable theme"],
  [themeSource, 'theme.darkAlgorithm', "official dark algorithm"],
  [themeSource, '"default" | "dark" | "compact"', "official appearance presets"],
  [themeSource, 'theme.compactAlgorithm', "official compact algorithm"],
  [themeSource, 'bodyBg: "#f5f8ff"', "official dashboard layout background"],
  [themeSource, 'activeBarBorderWidth: 0', "official dashboard menu treatment"],
  [appearanceSwitcher, '切换外观主题', "theme switcher"],
  [loginPage, 'login-frame', "compact framed login composition"],
  [pageHeader, 'page-toolbar', "optional business-owned view and action toolbar"],
  [shell, 'app-frame-stage', "compact framed dashboard shell"],
  [styles, 'padding: 6px', "narrow browser-edge breathing room"],
  [styles, 'border-radius: 14px', "rounded application frame"],
  [shell, 'menu: { items: breadcrumbMenuItems }', "selectable breadcrumb menu"],
  [themeSource, 'cellPaddingBlock: 12', "official dashboard table density"],
  [styles, '.ant-segmented', "official pill segmented styling"],
  [styles, '.ant-tabs .ant-tabs-nav-list', "pill section tabs"],
  [styles, '.standalone-tabs > .ant-tabs-content-holder', "tabs separated from content panel"],
  [styles, '.tabbed-workspace.ant-card', "legacy tab card wrapper removed visually"],
  [styles, 'border-radius: 999px', "fully rounded selection controls"],
  [styles, '.ant-table-wrapper .ant-table-thead', "official table header styling"],
  [styles, 'transform: scale(.97)', "direct press feedback"]
].forEach(([source, expected, label]) => requireText(source, expected, label));

if (pageHeader.includes("Typography.Title") || pageHeader.includes("Typography.Paragraph")) {
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

const forbidden = [];
const embeddedPrimaryTabs = [];
for (const entry of fs.readdirSync(reactRoot, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(ts|tsx|css)$/.test(entry.name)) continue;
  const file = path.join(entry.parentPath, entry.name);
  const source = fs.readFileSync(file, "utf8");
  if (/from\s+["']vue["']|element-plus|\.vue["']/.test(source)) forbidden.push(path.relative(root, file));
  if (/<Card[^>]*className=["'][^"']*data-panel[^"']*["'][^>]*>\s*<Tabs/s.test(source)) {
    embeddedPrimaryTabs.push(path.relative(root, file));
  }
}
if (forbidden.length) failures.push(`React app imports removed frontend dependencies: ${forbidden.join(", ")}`);
if (embeddedPrimaryTabs.length) failures.push(`primary tabs remain embedded in content cards: ${embeddedPrimaryTabs.join(", ")}`);

const retiredVueFiles = [];
const appsRoot = path.join(root, "apps");
for (const entry of fs.readdirSync(appsRoot, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".vue")) {
    retiredVueFiles.push(path.relative(root, path.join(entry.parentPath, entry.name)));
  }
}
if (retiredVueFiles.length) failures.push(`retired Vue source files still exist: ${retiredVueFiles.join(", ")}`);

const packageFiles = [read("package.json"), read("package-lock.json"), read("apps/admin/package.json")];
if (packageFiles.some((source) => /"(?:vue|vue-router|pinia|element-plus|vue-tsc|@vitejs\/plugin-vue)"/.test(source))) {
  failures.push("package manifests or lockfile still contain removed frontend dependencies");
}
if (packageFiles.some((source) => source.includes("@store-rental/admin-next") || source.includes('"apps/admin-next"'))) {
  failures.push("package metadata still contains the temporary React workspace");
}
if (fs.existsSync(path.join(root, "apps", "admin-next"))) failures.push("temporary apps/admin-next directory still exists");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("React admin static contract passed: routes, navigation, Ant Design design.md language, full write APIs, and dependency isolation verified.");
