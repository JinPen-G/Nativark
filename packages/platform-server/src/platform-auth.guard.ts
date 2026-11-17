/** 公共operator准入：沿原签名身份建立同一个ALS；行业HTTP由受控宿主注入，不从请求自注册。 */
import { ForbiddenException, Inject, Injectable, Optional, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import { PlatformAuthService } from "./modules/auth/platform-auth.service";
import { enterRequestIdentity } from "./common/request-identity";
import { matchableRequestPath } from "./common/request-path";
import { platformHttpPolicy } from "./platform-http-policy";

export interface RegisteredCoreHttpAccess {
  registered(method: string, path: string, audience: "operator"): boolean;
  authorize(method: string, path: string): Promise<void>;
}
export const REGISTERED_CORE_HTTP_ACCESS = Symbol("platform.registered-core-http-access");

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService,
    @Optional() @Inject(REGISTERED_CORE_HTTP_ACCESS) private readonly cores?: RegisteredCoreHttpAccess) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ method: string; url: string;
      headers: Record<string, string | string[] | undefined>; user?: SystemUserRow }>();
    const path = matchableRequestPath(request.url), method = request.method.toUpperCase();
    if (method === "OPTIONS") return true;
    const policy = platformHttpPolicy(method, path);
    if (policy?.access === "anonymous") return true;
    const header = request.headers.authorization;
    const current = await this.auth.resolveAccessContext(Array.isArray(header) ? header[0] : header);
    if (!current) throw new UnauthorizedException("请先登录");
    const user = current.tenantUser;
    if (user.mustChangePassword && !["/auth/me", "/auth/session-context", "/auth/change-password", "/auth/logout"].includes(path))
      throw new ForbiddenException("首次登录或密码重置后必须先修改密码");
    if (!policy && !this.cores?.registered(method, path, "operator"))
      throw new ForbiddenException("该接口未在当前公共宿主或Core中登记");
    if (policy?.access === "tenant_summary" && user.isSaasAdmin)
      throw new ForbiddenException("当前接口只读取调用者本租户的订阅摘要");
    if (policy?.access === "authenticated" && !user.permissions.includes("*")
      && !user.permissions.includes(policy.permission) && (user.isSaasAdmin || !user.isPlatformAdmin))
      throw new ForbiddenException("当前账号缺少安全配置读取权限");
    if (policy?.access === "tenant" && (user.isSaasAdmin || !user.isPlatformAdmin
      && !user.permissions.includes("*") && !user.permissions.includes(policy.permission)))
      throw new ForbiddenException("当前账号缺少本租户设置权限");
    if (policy?.access === "saas" && (!user.isSaasAdmin
      || !user.permissions.includes("*") && !user.permissions.includes(policy.permission)))
      throw new ForbiddenException("当前接口需要SaaS管理身份和权限");
    // 原订阅管理沿SaaS身份的system:tenant:授权，普通租户通配权限仍不能进入。
    if (policy?.access === "saas_subscription" && !user.isSaasAdmin)
      throw new ForbiddenException("仅 SaaS 平台管理员可以管理租户订阅");
    enterRequestIdentity({ tenantId: user.tenantId, userId: user.id, audience: "operator", accessSession: current.accessSession,
      permissions: [...user.permissions], isPlatformAdmin: user.isPlatformAdmin, isSaasAdmin: Boolean(user.isSaasAdmin),
      workspaceId: undefined, dataScope: user.dataScope, organizationId: user.organizationId, locationScope: undefined,
      staffApi: false, staffLocationScope: undefined });
    request.user = user;
    if (!policy) await this.cores!.authorize(method, path);
    return true;
  }
}
