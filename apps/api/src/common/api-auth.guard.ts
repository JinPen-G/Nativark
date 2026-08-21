import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { RentalCategoryCode, type RentalCapability, type SystemUserRow } from "@store-rental/shared";
import { AuthService } from "../modules/auth/auth.service";
import { enterRequestIdentity } from "./request-identity";

interface RequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  user?: SystemUserRow;
}

function normalizePath(url: string) {
  return url.split("?")[0]?.replace(/^\/api/, "") || "/";
}

function requiredCapability(path: string): RentalCapability | undefined {
  if (path.startsWith("/store-rental/dispatch") || path.startsWith("/store-rental/vehicles/transfer-tasks")) return "dispatch";
  if (path.startsWith("/store-rental/tbox-devices")) return "iot";
  return undefined;
}

function requiresVehicleCategory(path: string) {
  return [
    "/reports",
    "/store-rental/availability",
    "/store-rental/contracts",
    "/store-rental/dispatch",
    "/store-rental/finance",
    "/store-rental/orders",
    "/store-rental/pricing",
    "/store-rental/stations",
    "/store-rental/tbox-devices",
    "/store-rental/value-added-services",
    "/store-rental/vehicle-groups",
    "/store-rental/vehicles",
    "/store-rental/workflow"
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function requiredPermissions(method: string, path: string) {
  if (
    path === "/health" ||
    path === "/openapi.json" ||
    path === "/auth/login" ||
    path === "/auth/refresh" ||
    method === "OPTIONS"
  ) {
    return [];
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
  if (path.startsWith("/platform/tenants")) {
    return ["system:tenant:manage"];
  }
  if (path.startsWith("/reports")) {
    return ["store-rental:report:view"];
  }

  if (path === "/rental/v1/categories") {
    return ["system:tenant:manage", "store-rental:order:view", "store-rental:vehicle:view"];
  }
  if (path === "/rental/v1/tenant-profile") {
    return method === "GET" ? ["store-rental:order:view", "store-rental:vehicle:view"] : ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path === "/rental/v1/business-settings") {
    return method === "GET" ? ["store-rental:rules:manage", "store-rental:price:manage", "store-rental:order:view", "store-rental:order:create"] : ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/rule-versions") || path.startsWith("/rental/v1/calendars") || path.startsWith("/rental/v1/rewards") || path.startsWith("/rental/v1/benefit-accounts") || path.startsWith("/rental/v1/notification-templates") || path.startsWith("/rental/v1/notification-logs") || path === "/rental/v1/notifications/send") {
    return ["store-rental:rules:manage", "store-rental:price:manage"];
  }
  if (path === "/rental/v1/coupon-templates" || path.startsWith("/rental/v1/coupon-templates/")) {
    return ["store-rental:marketing:manage", "store-rental:price:manage"];
  }
  if (path.startsWith("/rental/v1/discount-plans") || path.startsWith("/rental/v1/customer-coupons")) {
    return method === "GET" ? ["store-rental:marketing:manage", "store-rental:price:manage", "store-rental:order:view"] : ["store-rental:marketing:manage", "store-rental:price:manage", "store-rental:order:operate"];
  }
  if (path.startsWith("/rental/v1/pricing-plans") || path.startsWith("/rental/v1/value-added-services")) {
    return method === "GET" ? ["store-rental:price:manage", "store-rental:order:view", "store-rental:order:create"] : ["store-rental:price:manage"];
  }
  if (path === "/rental/v1/locations" || path.startsWith("/rental/v1/locations/") || path.startsWith("/rental/v1/fulfillment-operators")) {
    return method === "GET" ? ["store-rental:station:view"] : ["store-rental:station:manage"];
  }
  if (path === "/rental/v1/item-groups" || path.startsWith("/rental/v1/item-groups/")) {
    return method === "GET" ? ["store-rental:vehicle-group:manage", "store-rental:vehicle:view", "store-rental:order:view", "store-rental:order:create"] : ["store-rental:vehicle-group:manage"];
  }
  if (path === "/rental/v1/assets" || path.startsWith("/rental/v1/assets/") || path === "/rental/v1/stock-balances") {
    return method === "GET" ? ["store-rental:vehicle:view"] : ["store-rental:vehicle:manage"];
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
  if (path.startsWith("/rental/v1/inspection-templates") || path.match(/^\/rental\/v1\/orders\/[^/]+\/inspections$/)) {
    return method === "GET" ? ["store-rental:order:view"] : ["store-rental:order:operate", "store-rental:order:pickup", "store-rental:order:return"];
  }
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/cancel$/)) return ["store-rental:order:cancel", "store-rental:order:operate"];
  if (path.match(/^\/rental\/v1\/orders\/[^/]+\/(confirm|allocate|handover\/[^/]+)$/)) return ["store-rental:order:operate"];
  if (path.startsWith("/rental/v1")) {
    return method === "GET"
      ? ["store-rental:order:view", "store-rental:vehicle:view"]
      : ["store-rental:order:operate", "store-rental:vehicle:manage"];
  }

  if (path.startsWith("/store-rental/data-dictionary")) {
    return ["store-rental:order:view", "store-rental:vehicle:view", "store-rental:member:view"];
  }

  if (path.startsWith("/store-rental/rules")) {
    return ["store-rental:rules:manage"];
  }
  if (path.startsWith("/store-rental/pricing")) {
    return ["store-rental:price:manage"];
  }
  if (path.startsWith("/store-rental/availability")) {
    return ["store-rental:order:operate", "store-rental:vehicle:view"];
  }
  if (path === "/store-rental/orders") {
    return method === "GET"
      ? ["store-rental:order:view"]
      : ["store-rental:order:operate", "store-rental:order:create"];
  }
  if (path.startsWith("/store-rental/contracts")) {
    return method === "GET"
      ? ["store-rental:order:view"]
      : ["store-rental:order:operate"];
  }
  const orderActionMatch = path.match(/^\/store-rental\/orders\/[^/]+\/actions\/([^/]+)$/);
  if (orderActionMatch) {
    const action = orderActionMatch[1];
    const actionPermissions: Record<string, string[]> = {
      "payment-success": ["store-rental:order:operate", "store-rental:order:pickup"],
      "start-pickup": ["store-rental:order:operate", "store-rental:order:pickup"],
      "pickup-inspection": ["store-rental:order:operate", "store-rental:order:pickup"],
      "return-inspection": ["store-rental:order:operate", "store-rental:order:return"],
      "extend-rental": ["store-rental:order:operate", "store-rental:order:extend"],
      "redirect-order": ["store-rental:order:operate", "store-rental:dispatch:manage"],
      "change-return-store": ["store-rental:order:operate", "store-rental:dispatch:manage"],
      "change-return-station": ["store-rental:order:operate", "store-rental:dispatch:manage"],
      "confirm-settlement": ["store-rental:order:settle"],
      "register-accident": [
        "store-rental:order:operate",
        "store-rental:vehicle:status-action"
      ],
      "mark-no-show": ["store-rental:order:operate", "store-rental:order:cancel"],
      cancel: ["store-rental:order:operate", "store-rental:order:cancel"],
      "reject-order": ["store-rental:order:operate", "store-rental:order:close"],
      "close-order": ["store-rental:order:operate", "store-rental:order:close"]
    };
    return actionPermissions[action] ?? ["store-rental:order:operate"];
  }
  if (
    path.match(/^\/store-rental\/orders\/[^/]+\/fees/) ||
    path.match(/^\/store-rental\/orders\/[^/]+\/transactions/)
  ) {
    return method === "GET"
      ? ["store-rental:order:view"]
      : ["store-rental:order:settle", "store-rental:order:fee-manage"];
  }
  if (path.startsWith("/store-rental/orders/")) {
    return method === "GET"
      ? ["store-rental:order:view"]
      : ["store-rental:order:operate", "store-rental:order:settle"];
  }
  if (path.startsWith("/store-rental/workflow")) {
    return ["store-rental:order:view", "store-rental:order:operate"];
  }
  if (path.startsWith("/store-rental/dispatch")) {
    return method === "GET"
      ? ["store-rental:dispatch:manage", "store-rental:order:view"]
      : ["store-rental:dispatch:manage"];
  }
  if (path.startsWith("/store-rental/stations")) {
    return method === "GET"
      ? ["store-rental:station:view"]
      : ["store-rental:station:manage"];
  }
  if (path.startsWith("/store-rental/vehicle-groups")) {
    return ["store-rental:vehicle-group:manage"];
  }
  if (
    path.match(
      /^\/store-rental\/vehicles\/[^/]+\/(status|location-events|maintenance-records|accident-records)/
    )
  ) {
    return [
      "store-rental:vehicle:manage",
      "store-rental:vehicle:status-action"
    ];
  }
  if (path.startsWith("/store-rental/vehicles")) {
    return method === "GET"
      ? ["store-rental:vehicle:view"]
      : ["store-rental:vehicle:manage"];
  }
  if (path.match(/^\/store-rental\/members\/[^/]+\/risk-actions$/)) {
    return ["store-rental:member:manage", "store-rental:member:risk-action"];
  }
  if (path.startsWith("/store-rental/members")) {
    return method === "GET"
      ? ["store-rental:member:view"]
      : ["store-rental:member:manage"];
  }
  if (path.startsWith("/store-rental/member-reviews")) {
    return method === "GET"
      ? ["store-rental:member:view"]
      : ["store-rental:member:manage"];
  }
  if (path.startsWith("/store-rental/membership-plans")) {
    return ["store-rental:member:manage"];
  }
  if (path.match(/^\/store-rental\/corporates\/[^/]+\/monthly-bills\/[^/]+\/settle$/)) {
    return [
      "store-rental:corporate:manage",
      "store-rental:corporate:monthly-settle",
      "store-rental:order:fee-manage"
    ];
  }
  if (path.startsWith("/store-rental/finance/manual-adjustments")) {
    return method === "GET"
      ? ["store-rental:finance:view", "store-rental:order:fee-manage"]
      : ["store-rental:finance:adjust", "store-rental:order:fee-manage"];
  }
  if (path.startsWith("/store-rental/finance/documents")) {
    return method === "GET"
      ? ["store-rental:finance:view", "store-rental:finance:invoice"]
      : ["store-rental:finance:invoice", "store-rental:finance:manage"];
  }
  if (path.startsWith("/store-rental/finance/reconciliation")) {
    return ["store-rental:finance:reconcile", "store-rental:finance:view"];
  }
  if (path.startsWith("/store-rental/finance")) {
    return method === "GET"
      ? ["store-rental:finance:view"]
      : ["store-rental:finance:manage"];
  }
  if (path.startsWith("/store-rental/corporates")) {
    return method === "GET"
      ? ["store-rental:corporate:view"]
      : ["store-rental:corporate:manage"];
  }
  if (path.startsWith("/store-rental/value-added-services")) {
    return ["store-rental:service:manage"];
  }

  return [];
}

function hasAnyPermission(user: SystemUserRow, permissions: string[]) {
  if (permissions.length === 0) {
    return true;
  }
  if (user.isSaasAdmin) {
    return permissions.some((permission) => permission.startsWith("system:tenant:"));
  }
  if (user.isPlatformAdmin || user.permissions.includes("*")) {
    return true;
  }
  return permissions.some((permission) => user.permissions.includes(permission));
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = normalizePath(request.url);
    const permissions = requiredPermissions(request.method, path);

    if (
      path === "/health" ||
      path === "/openapi.json" ||
      path === "/auth/login" ||
      path === "/auth/refresh" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const authorization = request.headers.authorization;
    const token = Array.isArray(authorization) ? authorization[0] : authorization;
    const accessContext = await this.authService.resolveAccessContext(token);
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
      !path.startsWith("/platform/tenant-bootstrap")
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
    if (!hasAnyPermission(user, permissions)) {
      throw new ForbiddenException("当前账号无权访问该功能");
    }
    const capability = requiredCapability(path);
    const vehicleCategoryRequired = requiresVehicleCategory(path);
    if ((capability || vehicleCategoryRequired) && !user.isSaasAdmin) {
      // SPACE-03：品类与能力按**当前经营空间**判定，不能用租户级档案——
      // 同租户多个空间品类不同时，那会让 camping 空间按 camera 的能力集放行。
      const scope = await this.authService.getCategoryContext(user.tenantId, workspaceId);
      if (vehicleCategoryRequired && scope.categoryCode !== RentalCategoryCode.Vehicle) {
        throw new ForbiddenException("该接口属于旧车辆兼容域，当前经营空间品类不可用");
      }
      if (capability && !scope.capabilities?.includes(capability)) {
        throw new ForbiddenException("当前经营空间品类未启用该业务能力");
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
    if (
      !workspaceId &&
      accessContext.hasWorkspaces &&
      !workspaceExemptPath &&
      (path.startsWith("/rental/") || path.startsWith("/store-rental/"))
    ) {
      throw new ForbiddenException("当前会话没有经营空间，请先选择经营空间");
    }

    enterRequestIdentity({
      tenantId: user.tenantId,
      userId: user.id,
      isSaasAdmin: Boolean(user.isSaasAdmin),
      // 只从会话写入，绝不读取请求体或查询参数里的 workspaceId。
      workspaceId
    });
    request.user = user;
    return true;
  }
}
