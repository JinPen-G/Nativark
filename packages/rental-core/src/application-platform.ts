/** 完整 Rental 宿主复用已构造的公共服务。公共管理与原各端 Guard 分别消费各自政策。
 * 此处仅选择同一实例；legacyGuard 须由宿主接好当前 Core 门禁及原业务提交点，不在此补造授权。 */
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { PlatformAuthGuard, platformHttpPolicy, type PlatformApplicationBindings, type RegisteredCoreHttpAccess } from "@rental-os/platform-server";
import { matchableRequestPath } from "@rental-os/platform-server/request-path";
import { createPlatformCoreHttpAccess, type CoreHostHttpApplication } from "@rental-os/platform-core-host";
import type { RentalApplication } from "./application";

export interface RentalPlatformRequest {
  method: string;
  url: string;
  staffApiRequest?: boolean;
}

export function createRentalPlatformApplications(application: RentalApplication, input: {
  core: CoreHostHttpApplication;
  legacyGuard: CanActivate;
  /** 宿主将实际挂载的公共 Core 管理/包管理政策组成同一准入；不能来自请求或 Core 清单。 */
  coreHttp?: RegisteredCoreHttpAccess;
  /** 精确原SaaS创建入口，由同一初始化应用在原事务复验；不作为普通业务准入豁免。 */
  tenantBootstrapHttp?: RegisteredCoreHttpAccess;
}): PlatformApplicationBindings & { routesToPlatform(request: RentalPlatformRequest): boolean } {
  const managedCoreAccess = input.coreHttp ?? createPlatformCoreHttpAccess(input.core);
  const bootstrap = input.tenantBootstrapHttp;
  const coreAccess: RegisteredCoreHttpAccess = bootstrap ? {
    registered: (method, path, audience) => bootstrap.registered(method, path, audience)
      || managedCoreAccess.registered(method, path, audience),
    authorize: (method, path) => bootstrap.registered(method, path, "operator")
      ? bootstrap.authorize(method, path) : managedCoreAccess.authorize(method, path)
  } : managedCoreAccess;
  const publicGuard = new PlatformAuthGuard({
    async resolveAccessContext(authorization, options) {
      const current = await application.auth.resolveAccessContext(authorization, {
        ...options, allowInvalidWorkspace: true
      });
      if (!current) return;
      // 公共 ALS 不设置业务 workspace；保留已验签 wid 供同一个 Core 会话读取器复核原会话。
      return { ...current, accessSession: { ...current.accessSession, workspaceId: current.workspaceId ?? null } };
    }
  }, coreAccess);
  // middleware 与唯一 Guard 必须消费同一闭包，避免另一份路由表把公共操作误包进 Rental 权限范围。
  const routesToPlatform = (request: RentalPlatformRequest): boolean => {
    const path = matchableRequestPath(request.url);
    const staff = request.staffApiRequest === true || path === "/staff/v1" || path.startsWith("/staff/v1/");
    return !staff && Boolean(platformHttpPolicy(request.method, path) || coreAccess.registered(request.method, path, "operator"));
  };
  const guard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const request = context.switchToHttp().getRequest<RentalPlatformRequest>();
      if (routesToPlatform(request)) return publicGuard.canActivate(context);
      return input.legacyGuard.canActivate(context);
    }
  };
  const { integrations } = application;
  return {
    auth: application.auth, authentication: application.authSource, guard, routesToPlatform,
    tenantAppearance: application.tenantAppearance, accountAppearance: application.accountAppearance,
    secrets: application.secrets, operationLog: application.operationLog, subscriptions: application.subscriptions,
    integrationStore: integrations.integrationStore, integrationBusiness: integrations.integrationBusiness,
    integrationRuntimeProviders: integrations.integrationRuntimeProviders, integrations: integrations.integrations,
    notifications: integrations.notifications, email: integrations.email, connectivity: integrations.connectivity,
    files: integrations.files, payments: integrations.payments, officialCalendarSources: application.officialCalendarSources
  };
}
