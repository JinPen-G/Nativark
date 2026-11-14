/** 原会话和Core使用权包围真实范围/就绪读取；Core自持事务，宿主不在外层持锁调用它。 */
import type { Prisma } from "@prisma/client";
import { CORE_SCOPE_HTTP, CoreScopeResolutionSchema, CoreReadinessSchema, isCoreVersionSupported,
  type CoreScopeObservation, type CoreScopeReference } from "@rental-os/core-contracts";
import { CoreAccessError, coreBindingScopeKey, type CoreDeployedCatalogue } from "@rental-os/core-host";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";
import { OriginalCoreAccess } from "./original-core-access";

export function composeOriginalCoreScopeReader(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const access = new OriginalCoreAccess(input.subscription, input.catalogue.availability);
  return async (value: unknown): Promise<CoreScopeObservation> => {
    const parsed = CORE_SCOPE_HTTP.request.parse(value), actor = principals.current();
    const scope: CoreScopeReference = { ...parsed, tenantId: actor.tenantId };
    const registration = input.catalogue.registrations.get(scope.coreId);
    if (!registration) throw new CoreAccessError("core_unavailable", "所选Core未在当前部署登记");
    const domain = registration.manifest.scope;
    if (domain.kind === "tenant" && scope.container || domain.kind === "container" && scope.container?.type !== domain.containerType)
      throw new CoreAccessError("denied", "范围与当前Core声明不一致");
    const currentBinding = () => input.database.$transaction(async (transaction: Prisma.TransactionClient) => {
      const lease = await principals.lock(transaction, actor, actor.tenantId);
      await access.requireMember(transaction, lease.user, scope.coreId);
      const binding = await access.binding(transaction, scope);
      await lease.revalidate();
      return binding;
    }, { isolationLevel: "ReadCommitted" });
    await currentBinding();
    // Core的范围服务可能开启自己的授权事务；不跨该调用持有人员/授权锁，避免嵌套死锁。
    const response = CoreScopeResolutionSchema.safeParse(await registration.server.resolveScope({ principal: actor, scope }));
    if (!response.success) throw new CoreAccessError("core_unavailable", "Core范围返回不符合正式合同");
    const resolution = response.data;
    if (resolution.status === "denied") throw new CoreAccessError("denied", "当前成员不能访问所选Core业务范围");
    const resolved = resolution.status === "resolved" ? resolution.binding : undefined;
    if (resolved && coreBindingScopeKey(resolved) !== coreBindingScopeKey(scope))
      throw new CoreAccessError("denied", "Core返回的绑定不属于当前主体范围");
    if (resolved && !isCoreVersionSupported(resolved.dataVersion, registration.manifest.data.readable))
      throw new CoreAccessError("core_unavailable", "原绑定数据版本不在当前Core可读范围");
    const ready = resolved ? CoreReadinessSchema.safeParse(await registration.server.readReadiness(resolved)) : undefined;
    if (ready && !ready.success) throw new CoreAccessError("core_unavailable", "Core就绪读取不符合正式合同");
    const readiness = ready?.success ? ready.data : undefined;
    const current = await currentBinding();
    if (current?.bindingId !== resolved?.bindingId || current?.revision !== resolved?.revision || current?.dataVersion !== resolved?.dataVersion)
      throw new CoreAccessError("revision_conflict", "Core绑定在读取期间已变化，请重新读取");
    return CORE_SCOPE_HTTP.response.parse(resolved ? { status: "bound", binding: resolved, readiness } : { status: "unbound" });
  };
}
