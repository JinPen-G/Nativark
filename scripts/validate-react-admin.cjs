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
const api = read("apps/admin/src/api/platform.ts");
const httpSource = read("apps/admin/src/api/http.ts");
const operations = read("apps/admin/src/api/platformOps.ts");
const shell = read("apps/admin/src/components/AppShell.tsx");
const appearanceSwitcher = read("apps/admin/src/components/AppearanceSwitcher.tsx");
const pageHeader = read("apps/admin/src/components/PageHeader.tsx");
const loginPage = read("apps/admin/src/features/auth/LoginPage.tsx");
const styles = read("apps/admin/src/styles.css");
const commercialPage = read("apps/admin/src/features/commercial/RentalCommercialPage.tsx");
const pricingGroupPage = read("apps/admin/src/features/commercial/PricingGroupPage.tsx");
const governancePage = read("apps/admin/src/features/settings/RentalGovernancePage.tsx");
const governanceRulesTab = read("apps/admin/src/features/settings/governance/RulesTab.tsx");
const governanceRuleSections = read("apps/admin/src/features/settings/governance/ruleSections.tsx");
const governanceNotificationsTab = read("apps/admin/src/features/settings/governance/NotificationsTab.tsx");
const locationPage = read("apps/admin/src/features/fulfillment/LocationPage.tsx");
const platformPage = read("apps/admin/src/features/platform/PlatformPage.tsx");
const tenantManagementPage = read("apps/admin/src/features/platform/TenantManagementPage.tsx");
const platformOperationsPage = read("apps/admin/src/features/platform/PlatformOperationsPage.tsx");
const rentalOrderDetailPage = read("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");
const catalogPage = read("apps/admin/src/features/catalog/CatalogPage.tsx");
const assetWorkspacePage = read("apps/admin/src/features/catalog/AssetWorkspacePage.tsx");
const rentalCoreApi = read("apps/admin/src/api/rentalCore.ts");
const capabilityPage = read("apps/admin/src/features/rental-core/CapabilityGovernancePage.tsx");
const appRoot = read("apps/admin/src/app/App.tsx");
const queryClientSource = read("apps/admin/src/app/queryClient.ts");
const authStoreSource = read("apps/admin/src/features/auth/authStore.ts");
const themeSource = read("apps/admin/src/app/theme.tsx");

[
  "/workbench", "/rental/orders", "/rental/item-groups", "/rental/assets",
  "/rental/locations", "/rental/pricing", "/rental/discounts", "/rental/coupons", "/rental/services", "/rental/settings", "/rental/capabilities", "/membership/reviews", "/membership/personal", "/membership/corporate", "/membership/plans", "/membership/rewards",
  "/platform/tenants", "/platform/users", "/platform/system", "/platform/operations", "/platform/tools"
].forEach((route) => requireText(navigation, `path: "${route}"`, "route registry coverage"));

// `api/platform.ts` 收敛成只剩跨域的平台与会话接口：历史门市域的 67 个成员随退役页面
// 一起删除。这里只钉住仍在用的写接口——把已删的名字继续列在这里，就是让门禁替死代码站岗。
[
  "saveOrganization", "saveUser", "saveRole", "saveSystemRuleSection"
].forEach((method) => requireText(api, `${method}:`, "API write coverage"));

// 反向断言：历史门市端点不得再出现在任何管理端 API 客户端里。
// 这是整条退役工作的落锁点——只要有人把 `/rental-os/` 写回客户端，这里就失败。
forbidText(api, "/rental-os/", "retired legacy endpoints must not return to the platform API client");
forbidText(operations, "/rental-os/", "retired legacy endpoints must not return to the operations API client");

[
  "categories", "profile", "businessSettings", "saveBusinessSettings", "couponTemplates", "saveCouponTemplate", "operators", "saveOperator", "locations", "saveLocation", "itemGroups", "assets", "stockBalances", "orders",
  "createOrder", "confirmOrder", "allocateOrder", "substituteBundleComponent", "partialReturnOrder", "cancelOrder", "inspectionTemplates", "createInspection", "pricingPlans", "discountPlans", "valueAddedServices", "calendar", "ruleVersions", "rewards", "notificationTemplates", "createQuote",
  // CORE-EXT-02C：能力治理的读写入口必须存在，否则页面只能变成静态展示。
  "capabilities", "saveCapability", "upgradeCapability", "capabilityAudits"
].forEach((method) => requireText(rentalCoreApi, `${method}:`, "Rental Core API coverage"));
// 早期的合并调试台 RentalCorePage 已删除：建单、预占、配货、取消都由「新建订单」与订单详情页承载。
// 断言文件不存在，防止一个无菜单入口、只靠 order:view 把关的调试页被悄悄加回来。
if (fs.existsSync(path.join(reactRoot, "features/rental-core/RentalCorePage.tsx"))) {
  failures.push("retired debug console must stay deleted: features/rental-core/RentalCorePage.tsx");
}
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
  "只需选择计价单位并填写对应价格"
].forEach((label) => requireText(pricingGroupPage, label, "pricing group must create simple base rates"));
[
  "初始化未定价分组",
  'name={[field.name, "preAuthAmount"]}',
  'name={[field.name, "preAuthMultiple"]}',
  "每件固定押金",
  "每件预授权额度"
].forEach((label) => forbidText(commercialPage, label, "base pricing page must not expose initialization or advanced pricing fields"));
[
  "新增统一调价计划",
  "一次计划统一调整当前整体价格",
  "currentByKey",
  "价格没有变化，请先填写至少一个新的价格",
  'queryKey: ["rental-core", "price-adjustments"]'
].forEach((label) => requireText(commercialPage, label, "workspace-wide price adjustment UI"));
[
  "currentPriceVersionDetail.data?.rates",
  "当前整体价格版本",
  "包含当前经营空间全部有效定价分组价格",
  "空间价格版本"
].forEach((label) => requireText(commercialPage, label, "space-wide immutable price version UI"));
forbidText(commercialPage, "commercial-switcher", "commercial pages must rely on independent sidebar routes instead of duplicate tabs");

// 平台 API 统一为 `request<T>()` 风格：会话/组织/账号/租户在 `platform.ts`（`api`），
// 字典/编号/预设/任务/文件/通知/适配器在 `platformOps.ts`（`platformOpsApi`）。每个端点只包一次。
["saveDictionary", "saveNumberRule", "createFileAsset", "createPrintJob", "createAsyncJob", "invokeMockAdapter"]
  .forEach((method) => requireText(operations, `${method}:`, "advanced operation coverage"));
["bootstrapTenant", "checkSecondConfirmation", "setOrganizationStatus"]
  .forEach((method) => requireText(api, `${method}:`, "advanced operation coverage"));

requireText(api, "tenants:", "tenant list API coverage");
requireText(api, "updateTenantStatus:", "tenant lifecycle API coverage");
for (const [label, source] of [["platform", api], ["platformOps", operations]]) {
  requireText(source, 'import { request } from "./http";', `shared authenticated HTTP client (${label})`);
  if (source.includes("axios.create") || source.includes("rental_os_access_token")) {
    failures.push(`authentication contract: ${label} API recreated the HTTP client or uses retired auth storage keys`);
  }
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
  [governanceRulesTab, "rentalCoreApi.ruleVersions", "generic rule version UI"],
  [governanceNotificationsTab, "rentalCoreApi.notificationTemplates", "tenant notification template UI"],
  // 治理页拆成外壳 + 每页签一个文件后，页签清单与权限判定必须只来自同一份 TABS 配置，
  // 否则「可进入的页签」和「实际渲染的页签」会再次各自漂移。
  [governancePage, "const TABS", "governance tabs single source"],
  [governancePage, "TABS.filter((definition) => definition.permitted(permissions))", "governance tabs derive permitted list from TABS"],
  [locationPage, "rentalCoreApi.saveLocation", "generic fulfillment location UI"],
  [tenantManagementPage, "api.tenants", "tenant list UI"],
  [tenantManagementPage, "bootstrapTenant", "tenant bootstrap UI"],
  [tenantManagementPage, "updateTenantStatus", "tenant lifecycle UI"],
  [platformPage, "setOrganizationStatus", "organization status UI"],
  [platformOperationsPage, "checkSecondConfirmation", "second confirmation UI"],
  [platformOperationsPage, "invokeMockAdapter", "mock adapter UI"]
].forEach(([source, expected, label]) => requireText(source, expected, label));

[
  "价格版本与调价", "优惠方案", "优惠券", "增值服务", "品类与业务规则", "会员审核", "个人会员", "企业会员", "会员方案", "组织与权限", "平台工具与治理"
].forEach((label) => requireText(navigation, label, "navigation registry coverage"));
requireText(navigation, "categories?: RentalCategoryCode[]", "category-specific route metadata");
requireText(navigation, "route.categories.includes(categoryCode)", "category-specific route guard");
requireText(navigation, 'audience: "tenant" | "saas"', "SaaS and tenant route audience metadata");
requireText(navigation, '(route.audience === "saas") !== isSaasAdmin', "SaaS and tenant route audience guard");
requireText(shell, "Boolean(user?.isSaasAdmin)", "navigation filters by authenticated audience");
for (const legacyLabel of ["车辆合同与单据", "车辆财务结算", "车辆履约调度", "车辆调拨与 TBox", "车辆生命周期", "车辆运营控制台", "车辆兼容报表"]) {
  forbidText(navigation, legacyLabel, "legacy rental-os route must not be registered");
}
// 历史门市页面已**删除**，不是"留着但不路由"。
//
// 之前这里只断言它们没有出现在 router 里，于是七个页面连同它们独占的 16 个 API 客户端
// 函数一直留在仓库里，还被门禁要求"必须存在"——门禁在强制一批死代码。
// 改成断言文件不存在：退役的判据是删掉，任何人重新加回来都会在这里失败。
for (const retiredPage of [
  "features/contracts/ContractsPage.tsx",
  "features/finance/FinancePage.tsx",
  "features/operations/OperationsPage.tsx",
  "features/operations/AssetOperationsPage.tsx",
  "features/catalog/AssetLifecyclePage.tsx",
  "features/advanced/BusinessToolsPage.tsx",
  "features/reports/ReportsPage.tsx",
  "features/customers/CustomerPage.tsx"
]) {
  if (fs.existsSync(path.join(reactRoot, retiredPage))) {
    failures.push(`legacy rental-os page must stay deleted: ${retiredPage}`);
  }
}

// UI-NAV-01：外壳改为消费 `buildNavigationSections(terminology)`——它在 navigation.tsx 内
// 由 APP_NAVIGATION 派生，只覆盖 label。因此这里同时钉住两端：外壳必须走构建器，
// 构建器必须派生自注册表。少了后一条，外壳可以拿一份自造菜单照样通过。
requireText(shell, "buildNavigationSections", "shell consumes unified navigation registry");
requireText(navigation, "applyTenantNavigationLabels(APP_NAVIGATION", "navigation builder derives from unified registry");
requireText(router, "APP_ROUTES", "router consumes unified route registry");
requireText(router, "workspaceScopeKey", "workspace switch remount boundary");
requireText(router, '<AppShell key={workspaceScopeKey}>', "workspace switch remounts active data pages");
requireText(router, "categoryCode, isSaasAdmin", "direct route access enforces authenticated audience");
requireText(tenantManagementPage, "api.tenantWorkspaces", "SaaS target tenant workspace list UI");
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
if (packageFiles.some((source) => source.includes("@rental-os/admin-next") || source.includes('"apps/admin-next"'))) {
  failures.push("package metadata still contains the temporary React workspace");
}
if (fs.existsSync(path.join(root, "apps", "admin-next"))) failures.push("temporary apps/admin-next directory still exists");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("React admin static contract passed: routes, navigation, Ant Design design.md language, full write APIs, and dependency isolation verified.");
