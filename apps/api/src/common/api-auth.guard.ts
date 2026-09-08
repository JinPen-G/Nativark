import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException
} from "@nestjs/common";
import { RentalCategoryCode, type RentalCapability, type SystemUserRow } from "@store-rental/shared";
import { AuthService } from "../modules/auth/auth.service";
import { WorkspaceCapabilityService } from "../modules/rental-core/workspace-capability.service";
import { enterRequestIdentity } from "./request-identity";
import { matchableRequestPath } from "./request-path";

interface RequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  user?: SystemUserRow;
}

function requiredCapability(path: string): RentalCapability | undefined {
  if (path.startsWith("/store-rental/dispatch") || path.startsWith("/store-rental/vehicles/transfer-tasks")) return "dispatch";
  if (path.startsWith("/store-rental/tbox-devices")) return "iot";
  return undefined;
}


/**
 * 未匹配任何规则时要求的"权限"。它**不存在于权限目录**，因此任何角色都不可能持有，
 * 等价于默认拒绝。
 *
 * 早前这里是 `return []`，而 `hasAnyPermission` 对空数组直接放行——于是每一个
 * 没被上面任何分支覆盖的路由都是**完全无鉴权**的写接口。这不是理论风险：
 * `/store-rental/marketing/plans` 的增改就落在这里，任何能登录的账号都能改本租户营销方案。
 * 而且这个坑会随每次新增路由复发，靠人记得补分支是不可靠的，
 * 因此改为默认拒绝 + `scripts/validate-route-permissions.cjs` 在标准验收命令里逐路由核对。
 */
export const UNMATCHED_ROUTE_PERMISSION = "__unmatched_route__";

/**
 * 显式公共路由：不需要登录，或登录后不需要任何业务权限的自助端点。
 *
 * 只有这份名单里的路由才允许"零权限放行"。放行范围要能一眼看完——
 * 会话自助操作（我是谁、登出、改密、切空间）本身不授予任何业务数据访问，
 * 它们的隔离由各自的处理器按当前会话完成。
 */
export const PUBLIC_ROUTES = new Set([
  "/health",
  "/openapi.json",
  "/auth/login",
  "/auth/development/reset-demo-password",
  "/auth/refresh",
  "/auth/logout",
  "/auth/me",
  "/auth/change-password",
  "/auth/switch-workspace",
  "/auth/session-context"
]);

/**
 * 公共前缀：带路径参数、无法用精确匹配表达的自助路由。
 *
 * 目前只有筛选预设——它是**租户级列表筛选偏好**，不承载任何业务数据，
 * 且服务层对非 SaaS 管理员一律用会话的 `user.tenantId`（忽略请求里的 tenantId），
 * 因此不存在跨租户读写。给它挂一个具体业务权限反而会让普通运营存不了自己的筛选条件。
 */
export const PUBLIC_ROUTE_PREFIXES = ["/platform/filter-presets"];

function isPublicRoute(path: string) {
  return PUBLIC_ROUTES.has(path) || PUBLIC_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function requiredPermissions(method: string, path: string) {
  if (isPublicRoute(path) || method === "OPTIONS") {
    return [];
  }

  if (path.startsWith("/platform/official-calendars")) {
    // 公共官方日历来源注册表（需求 4.5.2/4.5.8）。仅 SaaS 平台管理员；
    // canActivate 里另有一道 fail-closed 检查，不依赖本权限码单点把关。
    return ["system:calendar-source:manage"];
  }
  if (path === "/platform/permission-tree") {
    return ["system:role:manage"];
  }
  if (path.startsWith("/platform/audit-logs")) {
    return ["system:audit:view"];
  }
  if (path.startsWith("/platform/dictionaries")) {
    return ["system:dictionary:manage"];
  }
  if (path.startsWith("/platform/number-rules")) {
    return ["system:number-rule:manage"];
  }
  if (path.startsWith("/platform/tenant-bootstrap")) {
    return ["system:tenant:bootstrap", "system:tenant:manage"];
  }
  if (path.startsWith("/platform/system-rules")) {
    return ["system:params:manage"];
  }
  if (path.startsWith("/platform/security-baseline")) {
    return ["system:params:manage"];
  }
  if (path.startsWith("/platform/data-permission-preview")) {
    return ["system:user:manage", "system:role:manage"];
  }
  if (
    path.startsWith("/integrations") ||
    path.startsWith("/files") ||
    path.startsWith("/notifications") ||
    path.startsWith("/jobs")
  ) {
    return ["system:integration:manage", "system:params:manage"];
  }
  if (path === "/platform/roles") {
    return ["system:user:manage", "system:role:manage"];
  }
  if (path.startsWith("/platform/roles/")) {
    return ["system:role:manage"];
  }
  if (path.startsWith("/platform/organizations") || path.startsWith("/platform/users")) {
    return ["system:user:manage"];
  }
  if (path.startsWith("/platform/workspace-customers")) {
    // SPACE-04：共享客户主档按会员权限判定，与旧车辆域会员页面一致。
    // 读写分开：查看不应要求管理权限，否则运营查客户就得给写权限。
    if (/\/closability$/u.test(path)) {
      return ["store-rental:customer:close"];
    }
    if (/\/status$/u.test(path)) {
      // 目标状态在请求体中；具体动作由 PlatformService 按权限二次校验。
      return [
        "store-rental:member:manage",
        "store-rental:member:risk-action",
        "store-rental:customer:close"
      ];
    }
    return method === "GET"
      ? ["store-rental:member:view", "store-rental:member:manage"]
      : ["store-rental:member:manage"];
  }  // SPACE-01/02：经营空间主档与成员关系属于租户管理能力。
  //
  // 必须显式列出：本函数末尾兜底 `return []`，而 hasAnyPermission 对空数组
  // 直接放行。漏列等于把「新建空间、改空间状态、增删空间成员」开放给任何
  // 能登录的账号——普通运营账号可以把自己加进任一空间并附带租户管理员角色，
  // 既跨空间读数据又提权。注意不能靠 `/platform/workspace-customers` 覆盖：
  // 两者互不为前缀，必须分开判定，且这条要放在它之后避免被前缀吃掉。
  if (path.startsWith("/platform/workspaces")) {
    // 成员关系直接决定谁能进入哪个空间、以何角色进入，等价于授权操作，
    // 因此读也要求管理权限；空间列表本身按用户管理权限放行读。
    if (path.includes("/members")) {
      return ["system:user:manage"];
    }
    return method === "GET"
      ? ["system:user:manage", "system:tenant:manage"]
      : ["system:tenant:manage"];
  }
  if (path.startsWith("/platform/customers")) {
    // CUSTOMER-01B：敏感资料访问审计本身就是一份访问画像（谁在什么时候查过谁），
    // 因此它需要**解密权限**，不能只凭「会员查看」。必须放在下面的通用分支之前，
    // 否则会被 `/platform/customers` 前缀吃掉，退化成只要会员查看权限即可读取。
    if (/\/sensitive-access$/u.test(path)) {
      return ["store-rental:customer:reveal-sensitive"];
    }
    // CUSTOMER-01C：企业开票、合同、授信账期属**企业客户**权限，与个人会员权限分开。
    // 同样必须放在通用分支之前，否则「会员管理」就能改企业授信与账期。
    if (/\/(invoice-profiles|contracts|credit)$/u.test(path)) {
      return method === "GET"
        ? ["store-rental:corporate:view", "store-rental:corporate:manage"]
        : ["store-rental:corporate:manage"];
    }
    // CUSTOMER-01D：需求 4.8.14 要求合并与注销**分别授权**。两者都不可逆，
    // 且影响面不同（合并改身份归属、注销终止业务资格），因此不能共用「会员管理」
    // 一个权限——否则任何能改会员等级的人都能合并或注销客户。同样置于通用分支之前。
    if (path === "/platform/customers/merge") {
      return ["store-rental:customer:merge"];
    }
    // 预览与候选是只读的，但它们暴露「哪些主档可能是同一人」，属合并决策信息，
    // 因此同样按合并权限判定，而不是按「会员查看」放行。
    if (/\/(merge-preview|duplicates)$/u.test(path)) {
      return ["store-rental:customer:merge"];
    }
    if (/\/closability$/u.test(path)) {
      return ["store-rental:customer:close"];
    }
    // 账号注销走 account-status，其请求体里 status=closed 才是注销；Guard 按路径判权限、
    // 看不到请求体，因此这条路由「会员管理」或「客户注销」之一即可进入，
    // 真正的动作级权限与注销前置检查在服务层完成。
    if (/\/account-status$/u.test(path)) {
      return ["store-rental:member:manage", "store-rental:customer:close"];
    }
    return method === "GET"
      ? ["store-rental:member:view", "store-rental:member:manage"]
      : ["store-rental:member:manage"];
  }
  if (path.startsWith("/platform/tenants")) {
    return ["system:tenant:manage"];
  }
  if (path.startsWith("/reports")) {
    return ["store-rental:report:view"];
  }
  if (path.startsWith("/membership")) {
    if (path === "/membership/registration-settings") {
      return method === "GET"
        ? ["store-rental:member:view", "store-rental:member:manage"]
        : ["store-rental:member:manage"];
    }
    if (path.startsWith("/membership/reviews")) {
      return method === "GET"
        ? ["store-rental:member:view", "store-rental:member:review", "store-rental:member:qualification-review"]
        : ["store-rental:member:review", "store-rental:member:qualification-review"];
    }
    if (path.startsWith("/membership/qualification-types")) {
      return method === "GET" ? ["store-rental:member:view", "store-rental:member:manage"] : ["store-rental:member:manage"];
    }
    if (/^\/membership\/personal\/[^/]+\/temporary-password$/u.test(path)) {
      return ["store-rental:member:account-manage"];
    }
    if (path.startsWith("/membership/personal")) {
      return method === "GET"
        ? ["store-rental:member:view", "store-rental:member:manage"]
        : ["store-rental:member:manage"];
    }
    if (/^\/membership\/corporate\/[^/]+\/employees$/u.test(path)) {
      return method === "GET"
        ? ["store-rental:corporate:view", "store-rental:corporate:manage", "store-rental:corporate:employee-manage"]
        : ["store-rental:corporate:employee-manage"];
    }
    if (path.startsWith("/membership/corporate")) {
      return method === "GET"
        ? ["store-rental:corporate:view", "store-rental:corporate:manage", "store-rental:corporate:employee-manage"]
        : ["store-rental:corporate:manage"];
    }
    if (/^\/membership\/plans\/[^/]+\/versions\/[^/]+\/publish$/u.test(path)) {
      return ["store-rental:member:plan:publish"];
    }
    if (path === "/membership/plans/assignments") {
      return ["store-rental:member:plan:manage"];
    }
    if (path.startsWith("/membership/plans")) {
      return method === "GET"
        ? ["store-rental:member:view", "store-rental:member:plan:manage", "store-rental:member:plan:publish"]
        : ["store-rental:member:plan:manage"];
    }
    return ["store-rental:member:view"];
  }

  if (path === "/rental/v1/categories") {
    return ["system:tenant:manage", "store-rental:order:view", "store-rental:vehicle:view"];
  }
  // REPORT-01A：当前经营空间的经营报表。与旧 `/reports` 同一权限口径
  // （报表查看），但数据只来自 Rental Core 规范化事实且严格按会话空间隔离。
  // 必须放在通用 `/rental/v1` 分支之前，否则会落到经营写权限上。
  if (path.startsWith("/rental/v1/reports")) {
    return ["store-rental:report:view"];
  }
  if (path === "/rental/v1/tenant-profile") {
    return method === "GET" ? ["store-rental:order:view", "store-rental:vehicle:view"] : ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path === "/rental/v1/business-settings") {
    return method === "GET" ? ["store-rental:rules:manage", "store-rental:price:manage", "store-rental:order:view", "store-rental:order:create"] : ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/official-calendar-sources")) {
    // 空间侧只读引用公共来源版本，用于挑选要应用哪一版（需求 4.5.2）。
    // 只给日历相关角色：它不含业务数据，但也没有理由开放给全部经营角色。
    return [
      "store-rental:calendar:view-history",
      "store-rental:calendar:edit",
      "store-rental:calendar:publish",
      "store-rental:price:manage",
      "store-rental:rules:manage"
    ];
  }
  if (path.startsWith("/rental/v1/calendars")) {
    // 需求 4.5.8：营业日历「编辑」与「发布」使用独立权限，权限模型必须允许
    // 「日历编辑人员只能改草稿、不得发布」。price:manage 作为既有超集保留，
    // 避免存量部署（其价格管理员只有 price:manage）在本次拆分后失去日历能力。
    if (method === "GET") {
      // 发布前影响预览属**发布决策**动作，只给能编辑或发布的人；客服/财务的历史只读
      // 权限不覆盖它——预览的内容是「即将发布的草稿会改什么」，不是历史追溯。
      if (/\/publish-preview$/.test(path)) {
        return ["store-rental:calendar:edit", "store-rental:calendar:publish", "store-rental:price:manage", "store-rental:rules:manage"];
      }
      // 历史版本/差异/覆盖审计属**追溯视图**：需求 4.5.8 要求客服或财务「查看历史版本
      // 及报价命中的日历依据，不得修改」，因此额外接受独立的历史只读权限。
      // 仍不放给纯 order:view 的只读运营——版本详情含未发布草稿内容，与
      // 「普通运营只见已发布」相悖；要开放就必须显式配 view-history。
      if (/\/versions(\/|$)/.test(path) || /\/override-audits$/.test(path)) {
        return [
          "store-rental:calendar:view-history",
          "store-rental:calendar:edit",
          "store-rental:calendar:publish",
          "store-rental:price:manage",
          "store-rental:rules:manage"
        ];
      }
      return [
        "store-rental:calendar:view-history",
        "store-rental:calendar:edit",
        "store-rental:calendar:publish",
        "store-rental:price:manage",
        "store-rental:rules:manage",
        "store-rental:order:view"
      ];
    }
    // 发布与编辑相互独立：发布端点只认发布权限，编辑端点只认编辑权限，
    // 因此「只有发布权限」的账号在编辑端点会被拒、「只有编辑权限」的账号在发布端点会被拒。
    // price:manage 作为既有超集对两类都放行，避免存量部署失去日历能力。
    if (/\/publish$/.test(path)) {
      return ["store-rental:calendar:publish", "store-rental:price:manage"];
    }
    // 其余写操作（导入官方来源、保存日期、移除覆盖、作废草稿）属编辑，只认编辑权限。
    return ["store-rental:calendar:edit", "store-rental:price:manage"];
  }
  // RULE-01A：规则读取（列表、详情、发布预览、历史）manage 或 publish 任一即可；
  // 发布级动作（publish / void）只认 rules:publish，编辑级动作（存草稿、恢复为新草稿）
  // 只认 rules:manage。必须放在下面的合并分支之前，否则会被前缀吃掉退化成共用一个码。
  if (path.startsWith("/rental/v1/rule-versions")) {
    if (method === "GET") {
      return ["store-rental:rules:manage", "store-rental:rules:publish", "store-rental:price:manage"];
    }
    if (/\/(publish|void)$/u.test(path)) {
      return ["store-rental:rules:publish"];
    }
    return ["store-rental:rules:manage"];
  }
  if (path.startsWith("/rental/v1/rewards") || path.startsWith("/rental/v1/benefit-accounts") || path.startsWith("/rental/v1/notification-templates") || path.startsWith("/rental/v1/notification-logs") || path === "/rental/v1/notifications/send") {
    return ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path === "/rental/v1/coupon-templates" || path.startsWith("/rental/v1/coupon-templates/")) {
    return ["store-rental:marketing:manage", "store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/discount-plans") || path.startsWith("/rental/v1/customer-coupons")) {
    return method === "GET" ? ["store-rental:marketing:manage", "store-rental:price:manage", "store-rental:order:view"] : ["store-rental:marketing:manage", "store-rental:price:manage", "store-rental:order:operate"];
  }
  if (path.startsWith("/rental/v1/pricing-versions")) {
    return method === "GET"
      ? ["store-rental:price:manage", "store-rental:order:view", "store-rental:order:create"]
      : ["store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/pricing-plans")) {
    return method === "GET" ? ["store-rental:price:manage", "store-rental:order:view", "store-rental:order:create"] : ["store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/value-added-services") || path.startsWith("/rental/v1/service-capacities")) {
    return ["store-rental:service:manage"];
  }
  if (path === "/rental/v1/locations" || path.startsWith("/rental/v1/locations/") || path.startsWith("/rental/v1/fulfillment-operators")) {
    return method === "GET" ? ["store-rental:station:view"] : ["store-rental:station:manage"];
  }
  if (path === "/rental/v1/item-groups" || path.startsWith("/rental/v1/item-groups/")) {
    return method === "GET" ? ["rental-core:catalog:view", "rental-core:catalog:manage", "store-rental:vehicle-group:manage", "store-rental:vehicle:view", "store-rental:order:view", "store-rental:order:create"] : ["rental-core:catalog:manage", "store-rental:vehicle-group:manage"];
  }
  if (path === "/rental/v1/stock-dispositions" || path.startsWith("/rental/v1/stock-dispositions/")) {
    return method === "GET" ? ["rental-core:asset:view", "rental-core:asset:manage", "store-rental:vehicle:view"] : ["rental-core:asset:manage", "store-rental:vehicle:manage"];
  }
  if (path === "/rental/v1/assets" || path.startsWith("/rental/v1/assets/") || path === "/rental/v1/stock-balances" || path === "/rental/v1/stock-dispositions") {
    return method === "GET" ? ["rental-core:asset:view", "rental-core:asset:manage", "store-rental:vehicle:view"] : ["rental-core:asset:manage", "store-rental:vehicle:manage"];
  }
  if (path === "/rental/v1/availability") {
    return ["store-rental:order:operate", "store-rental:order:create", "store-rental:vehicle:view"];
  }
  if (path.startsWith("/rental/v1/quotes")) {
    return method === "GET" ? ["store-rental:order:view"] : ["store-rental:order:operate", "store-rental:order:create"];
  }
  if (path === "/rental/v1/orders") {
    return method === "GET" ? ["store-rental:order:view"] : ["store-rental:order:operate", "store-rental:order:create"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+$/)) {
    return ["store-rental:order:view"];
  }
  // 三条费用裁定入口统一收到 order:fee-review：裁定「该收/该退多少」与实际动钱是两件事。
  // 此前它们都认 order:settle，而资金事件也认 order:settle，等于一个权限同时授予
  // 「决定金额」与「收退款」。拆开后只有裁定权的人能定金额但动不了资金台账，
  // 只有资金权的人能收退款但改不了裁定结论。资金事件那条规则保持 order:settle 不变。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions\/[^/]+\/refund-review$/)) return ["store-rental:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/fee-reviews\/[^/]+\/review$/)) return ["store-rental:order:fee-review"];
  // 试算不落库但会暴露价格，因此和申请同权限，不给只读账号看到续租报价。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions$/)) {
    return method === "GET" ? ["store-rental:order:view"] : ["store-rental:order:extend", "store-rental:order:operate"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/extensions\/(preview|[^/]+\/pay)$/)) {
    return ["store-rental:order:extend", "store-rental:order:operate"];
  }
  if (path.startsWith("/rental/v1/inspection-templates") || path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections$/)) {
    return method === "GET" ? ["store-rental:order:view"] : ["store-rental:order:operate", "store-rental:order:pickup", "store-rental:order:return"];
  }
  // 检查异常的建议损失额同样是费用裁定，与上面两条同权限。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections\/[^/]+\/exceptions\/[^/]+\/review$/)) return ["store-rental:order:fee-review"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/cancel$/)) return ["store-rental:order:cancel", "store-rental:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/operation-lock$/)) return ["store-rental:order:operate", "store-rental:order:pickup", "store-rental:order:return"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/handover\/pickup$/)) return ["store-rental:order:operate", "store-rental:order:pickup"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(handover\/return|partial-return)$/)) return ["store-rental:order:operate", "store-rental:order:return"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(assignments|allocation-candidates)$/)) return ["store-rental:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(confirm|allocate|substitute-bundle-component|partial-return|handover\/[^/]+)$/)) return ["store-rental:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/settle$/)) return ["store-rental:order:settle"];
  // RULE-01B：押金/预授权模拟资金事件。读用 order:view 或 order:settle；
  // 发起/追加/抵扣/退款/释放/失败是资金动作，只认 order:settle（订单结算权限）。
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/funding-events(\/[^/]+)?$/)) {
    return method === "GET"
      ? ["store-rental:order:view", "store-rental:order:settle"]
      : ["store-rental:order:settle"];
  }
  if (
    path === "/rental/v1/capabilities" ||
    path.startsWith("/rental/v1/capabilities/") ||
    path === "/rental/v1/capability-audits"
  ) {
    // CORE-EXT-02A：能力治理是**经营空间级配置**，不是订单动作。
    //
    // 必须显式声明，否则会落进下面的 `/rental/v1` 兜底，拿到
    // `order:view` / `order:operate`——那等于任何能操作订单的门店人员都可以
    // 启用、暂停或停用整个空间的业务能力。菜单与 API 门禁（CORE-EXT-02C）
    // 将以这些实例为准，因此这里放宽一格就是放宽整个门禁。
    return method === "GET"
      ? ["rental-core:capability:view", "rental-core:capability:manage"]
      : ["rental-core:capability:manage"];
  }
  if (path.startsWith("/rental/v1")) {
    return method === "GET"
      ? ["store-rental:order:view", "store-rental:vehicle:view"]
      : ["store-rental:order:operate", "store-rental:vehicle:manage"];
  }

  return [UNMATCHED_ROUTE_PERMISSION];
}

function hasAnyPermission(user: SystemUserRow, permissions: string[]) {
  if (permissions.length === 0) {
    return true;
  }
  if (user.isSaasAdmin) {
    // SaaS 平台管理员只拿到跨租户的平台能力：租户管理，以及公共官方日历来源注册表
    // （需求 4.5.8：「导入和维护公共官方日历来源」）。后者是跨租户的公共基础数据、
    // 不含任何空间业务数据，因此不违反同款「不得借此查看空间业务数据」。
    return permissions.some(
      (permission) => permission.startsWith("system:tenant:") || permission.startsWith("system:calendar-source:")
    );
  }
  if (user.isPlatformAdmin || user.permissions.includes("*")) {
    return true;
  }
  return permissions.some((permission) => user.permissions.includes(permission));
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    // CORE-EXT-02C：能力门禁的判定依据。可选是为了让既有单测继续用一个假 AuthService
    // 直接构造守卫；缺失时能力门禁**拒绝**而不是放行（见 canActivate 内注释）。
    @Optional() private readonly capabilities?: WorkspaceCapabilityService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestLike>();
    // 判定一律用归一化 + 小写化后的路径：Express 的路由匹配对大小写与尾斜杠都不敏感，
    // 而本文件全是字符串前缀与正则判定。两者语义不一致时，变体路径会落到
    // requiredPermissions 末尾的 `return []` 并被当作"无需权限"放行。详见 request-path.ts。
    const path = matchableRequestPath(request.url);
    const permissions = requiredPermissions(request.method, path);

    if (
      path === "/health" ||
      path === "/openapi.json" ||
      path === "/auth/login" ||
      path === "/auth/development/reset-demo-password" ||
      path === "/auth/refresh" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const authorization = request.headers.authorization;
    const token = Array.isArray(authorization) ? authorization[0] : authorization;
    const accessContext = await this.authService.resolveAccessContext(token, {
      // 当前空间刚被停用/撤销时，仍需允许用户进入切换入口；目标空间
      // 会在 AuthService.switchWorkspace 内再次按成员关系校验。
      allowInvalidWorkspace: path.startsWith("/auth/") || path.startsWith("/platform/")
    });
    const user = accessContext?.user;
    const workspaceId = accessContext?.workspaceId;

    if (!user) {
      throw new UnauthorizedException("请先登录");
    }
    if (
      user.isSaasAdmin &&
      ![
        "/auth/me",
        "/auth/session-context",
        "/auth/change-password",
        "/auth/logout",
        "/rental/v1/categories"
      ].includes(path) &&
      !path.startsWith("/platform/tenants") &&
      !path.startsWith("/platform/tenant-bootstrap") &&
      !path.startsWith("/platform/official-calendars")
    ) {
      throw new ForbiddenException("SaaS 平台管理员只能访问租户管理能力");
    }
    if (
      user.mustChangePassword &&
      !["/auth/me", "/auth/session-context", "/auth/change-password", "/auth/logout"].includes(path)
    ) {
      throw new ForbiddenException("首次登录或密码重置后必须先修改密码");
    }
    if (
      (path.startsWith("/platform/tenants") || path.startsWith("/platform/tenant-bootstrap")) &&
      !user.isSaasAdmin
    ) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户");
    }
    // 公共官方日历来源是跨租户的公共基础数据（需求 4.5.8）。必须显式 fail-closed：
    // 租户内的 isPlatformAdmin 在 hasAnyPermission 里对任何权限都放行，
    // 不加这一道的话任一租户管理员都能改所有租户共用的官方节假日数据。
    if (path.startsWith("/platform/official-calendars") && !user.isSaasAdmin) {
      throw new ForbiddenException("仅 SaaS 平台管理员可以维护公共官方日历来源");
    }
    if (!hasAnyPermission(user, permissions)) {
      throw new ForbiddenException("当前账号无权访问该功能");
    }
    const capability = requiredCapability(path);
    if (capability && !user.isSaasAdmin) {
      // SPACE-03：品类与能力按**当前经营空间**判定，不能用租户级档案——
      // 同租户多个空间品类不同时，那会让 camping 空间按 camera 的能力集放行。
      const scope = await this.authService.getCategoryContext(user.tenantId, workspaceId);
      if (capability) {
        // CORE-EXT-02C：能力门禁只认**实例**。
        //
        // 早前判据是 `scope.capabilities?.includes(capability)`，即品类定义的
        // `defaultCapabilities` 数组——那等于「品类声明了这个 code」== 「该空间启用了它」，
        // 是 fail-open：只有 code、没有可执行模块的能力照样放行，而暂停与停用
        // 根本无法表达（数组里永远有它）。现在改为查该空间的能力实例，
        // 只有 `status === "enabled"` 才放行，因此暂停即刻生效。
        //
        // 三处 fail-closed，缺一不可：
        //   1. 没有会话空间 → 拒绝。绝不回退到租户默认空间：那会让一个本该被拒的
        //      无空间会话拿到某个空间的能力集（与 P0-01 的默认租户回退同型）。
        //   2. 没有注入能力服务 → 拒绝。装配被改坏时应当失败，而不是静默放行。
        //   3. 实例不是 enabled → 拒绝。包含「从未启用」「已暂停」「已停用」三种。
        if (!workspaceId) {
          throw new ForbiddenException("当前会话没有经营空间，请先选择经营空间");
        }
        if (!this.capabilities) {
          throw new ForbiddenException("能力门禁未就绪，已拒绝该请求");
        }
        if (!(await this.capabilities.isEnabled(user.tenantId, capability, workspaceId))) {
          throw new ForbiddenException("当前经营空间未启用该业务能力");
        }
      }
    }

    // SPACE-02 fail-closed：经营域接口必须有已验证的当前经营空间。
    //
    // 只拦经营域（/rental/v1 与 /store-rental），不拦 /auth 与 /platform：
    // 登录、切换空间、以及租户管理员维护空间本身，都发生在"还没有空间"的时刻。
    //
    // 这里刻意不回退到默认空间：默认空间只是升级兼容层，回退会让一个本该被拒绝的
    // 无空间会话静默拿到某个空间的数据——与 P0-01 的默认租户回退同型。
    // 例外：品类定义是全局参考数据（且 SaaS 平台管理员被显式允许访问），
    // 它不属于某个经营空间，要求空间会让平台管理员无法读取品类目录。
    const workspaceExemptPath = path === "/rental/v1/categories";
    // 刻意**不**附加 `accessContext.hasWorkspaces` 条件。
    //
    // 曾经加过，理由是「一个空间都没有的账号不该被空间检查拦住」——那是错的：
    // 无空间会话继续往下走时，仓储层的 resolveScopeWorkspaceId 会回退到租户
    // 默认空间，于是**成员关系为零的账号拿到了默认空间的完整读写权**，
    // 「账号通过成员关系进入空间」被整条绕过。saveUser 不建成员关系，
    // 所以新建账号天然处于这个状态，不需要任何数据库直改就能复现。
    //
    // 正确语义是一致的 403：没有可进入的空间，就不能访问经营域。
    // 该账号需要管理员先把它加入某个空间，这正是成员关系存在的意义。
    if (
      !workspaceId &&
      !workspaceExemptPath &&
      (path.startsWith("/rental/") ||
        // SPACE-04：这两条按当前空间读写业务关系，缺空间同样必须 fail-closed。
        // 不加进来的话，服务层的 requireRequestWorkspaceId() 会抛成 500，
        // 而正确语义是「请先选择经营空间」的 403。
        path === "/platform/workspace-customers" ||
        path.startsWith("/platform/workspace-customers/") ||
        path === "/platform/customers" ||
        path.startsWith("/platform/customers/") ||
        path === "/membership" ||
        path.startsWith("/membership/"))
    ) {
      throw new ForbiddenException("当前会话没有经营空间，请先选择经营空间");
    }

    enterRequestIdentity({
      tenantId: user.tenantId,
      userId: user.id,
      operationToken: typeof request.headers["x-operation-token"] === "string" ? request.headers["x-operation-token"] : undefined,
      isSaasAdmin: Boolean(user.isSaasAdmin),
      // 只从会话写入，绝不读取请求体或查询参数里的 workspaceId。
      workspaceId
    });
    request.user = user;
    return true;
  }
}
