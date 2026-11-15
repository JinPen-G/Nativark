/** 原Guard接入已登记Core HTTP的粗准入；对象/容器、提交点和本人原收据仍由所属Core复核。 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers, PlatformCoreTermPolicy } from "./ports";
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import { CoreAccessError } from "@rental-os/core-host";
import type { CoreHttpPolicy } from "@rental-os/core-contracts";
import { normalizeRequestPath } from "@rental-os/platform-server/request-path";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";
import { PlatformCoreAccess } from "./platform-core-access";

export function composePlatformCoreHttpAccess<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  term: PlatformCoreTermPolicy<Tx>;
  catalogue: CoreDeployedCatalogue;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const access = new PlatformCoreAccess<Tx>(input.term, input.catalogue.availability);
  return async (method: string, url: string): Promise<CoreHttpPolicy> => {
    const actor = principals.current();
    const policy = input.catalogue.http.resolve(method, normalizeRequestPath(url), actor.audience);
    if (!policy) throw new CoreAccessError("denied", "该Core HTTP操作尚未登记或不向当前分面开放");
    return input.database.$transaction(async (transaction: Tx) => {
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
