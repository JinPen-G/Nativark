/** 原Guard接入已登记Core HTTP的粗准入；对象/容器、提交点和本人原收据仍由所属Core复核。 */
import type { Prisma } from "@prisma/client";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import { CoreAccessError } from "@rental-os/core-host";
import type { CoreHttpPolicy } from "@rental-os/core-contracts";
import { normalizeRequestPath } from "../../common/request-path";
import type { PlatformRepository } from "../platform/platform.repository";
import type { PrismaService } from "../database/prisma.service";
import type { SubscriptionService } from "../subscription/subscription.service";
import { OriginalCorePrincipalAuthority } from "./original-core-principal";
import { OriginalCoreAccess } from "./original-core-access";

export function composeOriginalCoreHttpAccess(input: {
  database: PrismaService;
  users: Pick<PlatformRepository, "findUserById">;
  subscription: Pick<SubscriptionService, "readCategoryCommercialContext">;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new OriginalCorePrincipalAuthority(input.users);
  const access = new OriginalCoreAccess(input.subscription, input.catalogue.availability);
  return async (method: string, url: string): Promise<CoreHttpPolicy> => {
    const actor = principals.current();
    const policy = input.catalogue.http.resolve(method, normalizeRequestPath(url), actor.audience);
    if (!policy) throw new CoreAccessError("denied", "该Core HTTP操作尚未登记或不向当前分面开放");
    return input.database.$transaction(async (transaction: Prisma.TransactionClient) => {
      const lease = await principals.lock(transaction, actor, actor.tenantId);
      const user = lease.user;
      if (user.isSaasAdmin || policy.permissionCodes.some(code => !user.permissions.includes("*") && !user.permissions.includes(code)))
        throw new CoreAccessError("denied", "当前成员缺少所登记Core操作的权限");
      if (policy.purpose === "business") {
        await access.requireMember(transaction, user, policy.coreId);
        if (policy.startsNewBusiness) await access.requireNewBusiness(transaction, actor.tenantId);
      }
      // 原收据不重新开放普通业务；本人对象可见性由Core收据服务核，不借粗准入读取他人结果。
      const current = await lease.revalidate();
      if (current.isSaasAdmin || policy.permissionCodes.some(code => !current.permissions.includes("*") && !current.permissions.includes(code)))
        throw new CoreAccessError("denied", "Core请求返回前当前角色权限已变化");
      return policy;
    }, { isolationLevel: "ReadCommitted" });
  };
}
