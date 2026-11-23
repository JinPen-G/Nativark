/** Rental 原权限目录及标准包映射的唯一数据源。页面和清单只消费纯数据，不加载 React、数据库或 Auth。
 * 原角色码保持原值；标准码只投影当前已验证范围，不写角色、不分配 Core、不替代原 HTTP 权限。 */
import type { CoreManifest, CorePageDescriptor } from "@rental-os/core-contracts";
import type { PermissionModule, SystemUserRow } from "@rental-os/platform-contracts";
import { RENTAL_CORE_ID } from "./core-identity";

const legacyModules: PermissionModule[] = [
    {
      code: "rental-core",
      name: "Rental Core",
      children: [
        { code: "rental-core:catalog:view", name: "通用商品目录查看" },
        { code: "rental-core:catalog:manage", name: "通用商品目录管理" },
        { code: "rental-core:asset:view", name: "通用资产库存查看" },
        { code: "rental-core:asset:manage", name: "通用资产库存管理" },
        { code: "rental-core:maintenance:view", name: "养护工单查看", description: "查看归还处置和养护工单" },
        { code: "rental-core:maintenance:manage", name: "养护工单处理", description: "创建、派工、开始和提交养护工单" },
        { code: "rental-core:maintenance:review", name: "养护工单验收", description: "审核养护结果并恢复库存可用状态" },
        { code: "rental-core:capability:view", name: "经营空间能力查看" },
        { code: "rental-core:capability:manage", name: "经营空间能力治理" },
        // CAM-01A：确认能力给出的风险提示（如需转接环的器材组合）才能带风险下单。
        // 与 :manage 分开：治理能力启停是配置动作，带风险下单是一次经营决策，
        // 两者的授权对象通常不同（店长可确认风险，但不一定负责能力启停）。
        { code: "rental-core:capability:override", name: "能力风险例外确认" }
      ]
    },
    {
      code: "rental-os",
      name: "租赁业务",
      children: [
        { code: "rental-os:rules:manage", name: "业务规则配置" },
        // RULE-01A：发布与编辑分权（需求 4.6.14）。发布改变对外生效条款，
        // 与「改草稿」是两个责任；共用一个码会让任何能编辑的人直接对客户生效。
        { code: "rental-os:rules:publish", name: "业务规则发布", description: "发布或安排规则版本生效、作废已发布或待生效版本" },
        { code: "rental-os:order:view", name: "订单查看", description: "查看租赁订单列表和详情" },
        { code: "rental-os:order:operate", name: "订单操作", description: "新建租赁订单、领取检查和归还检查" },
        { code: "rental-os:order:reassign", name: "资源解锁与改配", description: "解锁、释放及更换订单锁定资源，必须填写原因" },
        { code: "rental-os:order:settle", name: "订单结算", description: "确认费用、补缴、退款或月结入账" },
        { code: "rental-os:order:offline-payment", name: "线下收款登记", description: "登记待确认的线下收款；不含确认到账、退款或资金结算" },
        // ORDER-CLOSE-02：裁定「该收/该退多少」与实际动钱拆成两个权限。此前四类审核
        // 都认 order:settle，而资金事件也认它，一个权限同时授予定金额和收退款。
        { code: "rental-os:order:fee-review", name: "费用裁定", description: "裁定逾期人工核价、提前归还退款、续租负差额与检查异常的金额；不含实际收退款" },
        { code: "rental-os:order:create", name: "按钮-新建订单", description: "显示并执行新建租赁订单入口" },
        { code: "rental-os:order:pickup", name: "按钮-领取交付", description: "执行领取交付和确认开始履约" },
        { code: "rental-os:order:return", name: "按钮-归还验收", description: "执行归还验收和提交结算" },
        { code: "rental-os:order:extend", name: "按钮-延长租期", description: "执行延长租期和逾期补办续租" },
        { code: "rental-os:order:cancel", name: "按钮-取消/爽约", description: "执行取消订单和标记爽约" },
        { code: "rental-os:order:close", name: "按钮-关闭/拒绝履约", description: "执行关闭订单和拒绝履约" },
        { code: "rental-os:order:fee-manage", name: "按钮-费用处理", description: "登记订单费用、收款、退款和减免" },
        { code: "rental-os:dispatch:manage", name: "调度管理" },
        { code: "rental-os:price:manage", name: "价格规则" },
        { code: "rental-os:calendar:edit", name: "营业日历编辑（草稿）", description: "新建和修改营业日历草稿，不含发布" },
        { code: "rental-os:calendar:publish", name: "营业日历发布", description: "发布年度营业日历版本" },
        { code: "rental-os:calendar:view-history", name: "营业日历历史只读", description: "查看历史版本、发布差异、覆盖审计与报价命中的日历依据，不得修改" },
        { code: "rental-os:marketing:manage", name: "行销方案管理" },
        { code: "rental-os:station:view", name: "履约地点查看" },
        { code: "rental-os:station:manage", name: "履约地点管理" },
        { code: "rental-os:member:view", name: "会员查看" },
        { code: "rental-os:member:manage", name: "会员管理" },
        // 证件类型是当前经营空间的业务配置，不是租户级会员资料维护：
        // 空间配置人员不必顺带拿到改会员主档的权限，反之亦然。
        { code: "rental-os:qualification-type:manage", name: "空间证件类型管理", description: "维护当前经营空间的资质证件类型" },
        { code: "rental-os:member:review", name: "会员注册审核", description: "处理个人会员注册审核，不含证件审核" },
        { code: "rental-os:member:qualification-review", name: "会员证件审核", description: "处理身份证件和品类资质审核" },
        { code: "rental-os:member:account-manage", name: "会员账号与密码管理", description: "开通账号、设置临时密码和管理账号状态" },
        { code: "rental-os:member:plan:manage", name: "会员方案编辑", description: "编辑个人和企业会员方案草稿、授予方案" },
        { code: "rental-os:member:plan:publish", name: "会员方案发布", description: "发布会员方案版本" },
        { code: "rental-os:member:risk-action", name: "会员风险管理", description: "登记与复核风险记录，并执行会员风险限制" },
        // CUSTOMER-01B：敏感资料解密查看单独授权。必须出现在权限目录里——
        // 角色管理页的可选项完全来自这棵树，漏了它就没人能被授予该权限。
        { code: "rental-os:customer:reveal-sensitive", name: "客户敏感资料解密", description: "查看客户证件号等明文，并可查阅敏感访问审计" },
        { code: "rental-os:customer:merge", name: "客户合并", description: "人工合并重复客户主档，不可逆" },
        { code: "rental-os:customer:close", name: "客户注销", description: "注销客户账号或空间会员关系，不可逆" },
        { code: "rental-os:corporate:view", name: "企业客户查看" },
        { code: "rental-os:corporate:manage", name: "企业客户管理" },
        { code: "rental-os:corporate:employee-manage", name: "企业员工管理", description: "维护企业管理员和员工关系" },
        { code: "rental-os:corporate:monthly-settle", name: "按钮-企业月结回款", description: "登记企业账单回款" },
        { code: "rental-os:finance:view", name: "财务查看", description: "查看资金流水、发票收据、调账和对账" },
        { code: "rental-os:finance:manage", name: "财务管理", description: "维护财务单据和处理资金状态" },
        { code: "rental-os:finance:adjust", name: "按钮-手工调账", description: "提交、审核和入账手工调账" },
        { code: "rental-os:finance:invoice", name: "按钮-发票/收据", description: "开具、发送和作废发票收据" },
        { code: "rental-os:finance:reconcile", name: "财务对账", description: "查看和处理资金、月结、调账异常" },
        { code: "rental-os:service:manage", name: "增值服务管理" },
        { code: "rental-os:report:view", name: "报表查看" }
      ]
    },
];

/** 原租户种子获得独立对象，不能修改固定发行清单所用的登记。 */
export function createRentalLegacyPermissionModules(): PermissionModule[] { return structuredClone(legacyModules); }

export type RentalPermissionScope = "workspace" | "tenant-membership";
type PermissionReference = CorePageDescriptor["permissions"][number];
interface PageAccess {
  scope: RentalPermissionScope;
  anyOf: readonly string[];
  permission: PermissionReference;
  name: string;
}

/** 原有同义前缀在此显式映射；四段会员方案码只在标准描述中变为 member.plan。 */
function legacyReference(code: string): PermissionReference {
  const [prefix, ...parts] = code.split(":");
  if (!["rental-core", "rental-os"].includes(prefix) || parts.length < 2) throw new Error("未登记的 Rental 原权限码");
  return { resource: parts.slice(0, -1).join("."), action: parts.at(-1)! };
}
const codeOf = ({ resource, action }: PermissionReference) => `${RENTAL_CORE_ID}:${resource}:${action}`;
const workspace = (code: string, name: string): PageAccess => ({
  scope: "workspace", anyOf: [code], permission: legacyReference(code), name
});
const page = (id: string, name: string, scope: RentalPermissionScope, anyOf: readonly string[]): PageAccess => ({
  scope, anyOf, permission: { resource: `page.${id}`, action: "view" }, name
});

/** 聚合页面的 OR 准入使用独立 page.* 声明，不能借它取得其中任一业务写权限。 */
export const RENTAL_PAGE_ACCESS = {
  orders: workspace("rental-os:order:view", "订单查看"),
  "order-detail": workspace("rental-os:order:view", "订单详情"),
  "order-create": workspace("rental-os:order:create", "新建订单"),
  "work-orders": workspace("rental-core:maintenance:view", "养护工单"),
  "work-order-detail": workspace("rental-core:maintenance:view", "养护工单详情"),
  capabilities: { ...workspace("rental-core:capability:view", "经营空间能力"),
    anyOf: ["rental-core:capability:view", "rental-core:capability:manage"] },
  locations: workspace("rental-os:station:view", "履约地点"),
  "item-groups": workspace("rental-core:catalog:view", "商品目录"),
  assets: workspace("rental-core:asset:view", "资产与库存"),
  "pricing-groups": workspace("rental-os:price:manage", "定价分组"),
  pricing: workspace("rental-os:price:manage", "价格管理"),
  "pricing-versions": workspace("rental-os:price:manage", "价格版本"),
  "pricing-version-detail": workspace("rental-os:price:manage", "价格版本详情"),
  discounts: workspace("rental-os:price:manage", "优惠方案"),
  coupons: workspace("rental-os:price:manage", "优惠券"),
  services: page("services", "增值服务页面", "workspace", ["rental-os:price:manage"]),
  governance: { ...page("governance", "品类与业务规则页面", "workspace", [
    "rental-os:price:manage", "rental-os:calendar:edit", "rental-os:calendar:publish",
    "rental-os:calendar:view-history", "rental-os:rules:manage", "rental-os:rules:publish", "system:integration:manage"
  ]), permission: { resource: "governance", action: "view" } },
  "qualification-types": page("qualification-types", "空间证件类型页面", "workspace", [
    "rental-os:qualification-type:manage", "rental-os:member:manage", "rental-os:member:view"
  ]),
  "membership-reviews": page("membership-reviews", "会员审核页面", "tenant-membership", [
    "rental-os:member:view", "rental-os:member:review", "rental-os:member:qualification-review"
  ]),
  "personal-members": page("personal-members", "个人会员页面", "tenant-membership", ["rental-os:member:view", "rental-os:member:manage"]),
  "personal-member-detail": page("personal-member-detail", "个人会员详情页面", "tenant-membership", ["rental-os:member:view", "rental-os:member:manage"]),
  "corporate-members": page("corporate-members", "企业会员页面", "tenant-membership", [
    "rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"
  ]),
  "corporate-member-detail": page("corporate-member-detail", "企业会员详情页面", "tenant-membership", [
    "rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"
  ]),
  "membership-plans": page("membership-plans", "会员方案页面", "tenant-membership", [
    "rental-os:member:view", "rental-os:member:plan:manage", "rental-os:member:plan:publish"
  ]),
  "membership-rewards": page("membership-rewards", "会员激励页面", "workspace", [
    "rental-os:price:manage", "rental-os:rules:manage", "system:params:manage"
  ]),
  workbench: page("workbench", "运营概览页面", "workspace", [
    "rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"
  ]),
  "operation-report": workspace("rental-os:report:view", "经营报表"),
  "client-channel": { ...page("client-channel", "客户端渠道页面", "workspace", ["system:integration:manage"]),
    permission: { resource: "channel", action: "manage" } },
  "tenant-readiness": { ...page("tenant-readiness", "开业配置页面", "workspace", [
    "rental-os:order:view", "rental-os:price:manage", "system:user:manage", "system:role:manage"
  ]), permission: { resource: "setup", action: "view" } },
  "payment-reconciliation": workspace("rental-os:finance:reconcile", "支付对账"),
  "payment-reconciliation-detail": workspace("rental-os:finance:reconcile", "对账批次详情"),
  // Agent 入口跨空间及租户会员范围，须在下方复用原九页的投影，不能将会员权限摊到空间。
  "ai-operator": page("ai-operator", "Agent工作台", "workspace", []),
  "ai-settings": page("ai-settings", "AI 服务设置", "workspace", ["system:params:manage"]),
  "ai-tasks": page("ai-tasks", "AI 任务中心", "workspace", [
    "rental-os:order:view", "rental-os:order:create", "rental-os:price:manage", "system:params:manage",
    "system:integration:manage", "rental-os:finance:view", "rental-os:finance:reconcile"
  ])
} satisfies Record<string, PageAccess>;
for (const entry of Object.values(RENTAL_PAGE_ACCESS)) {
  Object.freeze(entry.anyOf); Object.freeze(entry.permission); Object.freeze(entry);
}
Object.freeze(RENTAL_PAGE_ACCESS);

export type RentalPageId = keyof typeof RENTAL_PAGE_ACCESS;
export function rentalPagePermissions(id: RentalPageId): PermissionReference[] {
  return [{ ...RENTAL_PAGE_ACCESS[id].permission }];
}
export function rentalPageLegacyPermissions(id: RentalPageId): readonly string[] {
  return [...RENTAL_PAGE_ACCESS[id].anyOf];
}
export function rentalLegacyPagePolicy(id: RentalPageId): { scope: RentalPermissionScope; permissions: readonly string[] } {
  return { scope: RENTAL_PAGE_ACCESS[id].scope, permissions: rentalPageLegacyPermissions(id) };
}

const legacyPermissions = legacyModules.flatMap(module => module.children);
const declarations = new Map<string, CoreManifest["permissions"][number]>();
for (const original of legacyPermissions) {
  const reference = legacyReference(original.code);
  if (declarations.has(codeOf(reference))) throw new Error("Rental 原权限的标准映射冲突");
  declarations.set(codeOf(reference), { ...reference, name: original.name });
}
for (const entry of Object.values(RENTAL_PAGE_ACCESS)) {
  const code = codeOf(entry.permission);
  if (!declarations.has(code)) declarations.set(code, { ...entry.permission, name: entry.name });
}
export const RENTAL_PERMISSION_DECLARATIONS = Object.freeze(
  [...declarations.values()].map(declaration => Object.freeze(declaration))
);

export interface RentalCorePermissionPrincipal {
  audience: "operator" | "staff" | "client";
  tenantUser: SystemUserRow;
  workspaceUser?: SystemUserRow;
  /** 必须来自原签名会话及本次锁定的成员读取，不能用请求参数补齐。 */
  workspaceId?: string;
}

function active(user: SystemUserRow | undefined): user is SystemUserRow {
  return Boolean(user?.isActive && !user.mustChangePassword && !user.isSaasAdmin);
}
function scopedUser(input: RentalCorePermissionPrincipal, scope: RentalPermissionScope): SystemUserRow | undefined {
  if (input.audience !== "operator" || !active(input.tenantUser)) return undefined;
  if (scope === "tenant-membership") {
    const user = input.tenantUser;
    return user.isPlatformAdmin || user.dataScope === "all" ? user : undefined;
  }
  const user = input.workspaceUser;
  if (!input.workspaceId || !active(user) || user.id !== input.tenantUser.id || user.tenantId !== input.tenantUser.tenantId)
    return undefined;
  return user;
}
const hasOriginal = (user: SystemUserRow | undefined, code: string, scope: RentalPermissionScope): boolean => Boolean(user
  && (scope === "tenant-membership" && user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes(code)));

/** 一一映射原动作；Core 页面准入不能反向换成旧权限码，不能接受任意 rental:* 自授。 */
export function rentalOriginalPermissionCode(code: string): string | undefined {
  return legacyPermissions.find(permission => codeOf(legacyReference(permission.code)) === code)?.code;
}
export function rentalLegacyPermission(resource: string, action: string): string {
  const original = rentalOriginalPermissionCode(codeOf({ resource, action }));
  if (!original) throw new Error(`未登记的 Rental 原权限映射：${resource}:${action}`);
  return original;
}

/** 只供当前已验证主体的目录投影，Core grant/assignment/binding 仍由实际宿主在原事务核验。
 * 租户通配只参与原租户会员规则；空间动作始终读取 workspaceUser，缺失不回退 tenantUser。
 * staff/client 沿原专用 Guard，这个 operator 页面目录不把它们冒充后台成员。
 */
export function rentalCorePermissionCodes(input: RentalCorePermissionPrincipal): string[] {
  const result = new Set<string>();
  for (const original of legacyPermissions) {
    const scope: RentalPermissionScope = /^(?:rental-os:(?:member|corporate):|rental-os:customer:(?:merge|close)$)/u.test(original.code)
      ? "tenant-membership" : "workspace";
    if (hasOriginal(scopedUser(input, scope), original.code, scope)) result.add(codeOf(legacyReference(original.code)));
  }
  for (const entry of Object.values(RENTAL_PAGE_ACCESS)) {
    const user = scopedUser(input, entry.scope);
    if (entry.anyOf.some(code => hasOriginal(user, code, entry.scope))) result.add(codeOf(entry.permission));
  }
  // 沿原工作台九页的 OR，尤其保留仅有租户会员权限、没有当前经营空间的合法入口。
  // 只补页面准入码，不反向赋予原九页的业务动作或 Core 使用权。
  const assistantEntries = ["workbench", "orders", "locations", "assets", "personal-members", "pricing-groups",
    "payment-reconciliation", "governance", "operation-report"] as const;
  if (assistantEntries.some(id => result.has(codeOf(RENTAL_PAGE_ACCESS[id].permission))))
    result.add(codeOf(RENTAL_PAGE_ACCESS["ai-operator"].permission));
  return [...result].sort();
}
