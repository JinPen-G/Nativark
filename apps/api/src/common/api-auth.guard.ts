import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import type { SystemUserRow } from "@rimo/shared";
import { PlatformService } from "../modules/platform/platform.service";

interface RequestLike {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  user?: SystemUserRow;
}

function normalizePath(url: string) {
  return url.split("?")[0]?.replace(/^\/api/, "") || "/";
}

function requiredPermissions(method: string, path: string) {
  if (
    path === "/health" ||
    path === "/openapi.json" ||
    path === "/auth/login" ||
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
  if (path === "/platform/tenants") {
    return ["system:tenant:manage", "system:user:manage", "system:role:manage"];
  }
  if (path.startsWith("/reports")) {
    return ["store-rental:report:view"];
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
  if (user.isPlatformAdmin || user.permissions.includes("*")) {
    return true;
  }
  return permissions.some((permission) => user.permissions.includes(permission));
}

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly platformService: PlatformService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const path = normalizePath(request.url);
    const permissions = requiredPermissions(request.method, path);

    if (
      path === "/health" ||
      path === "/openapi.json" ||
      path === "/auth/login" ||
      request.method === "OPTIONS"
    ) {
      return true;
    }

    const authorization = request.headers.authorization;
    const token = Array.isArray(authorization) ? authorization[0] : authorization;
    const user = await this.platformService.resolveUserByToken(token);

    if (!user) {
      throw new UnauthorizedException("请先登录");
    }
    if (!hasAnyPermission(user, permissions)) {
      throw new ForbiddenException("当前账号无权访问该功能");
    }

    request.user = user;
    return true;
  }
}
