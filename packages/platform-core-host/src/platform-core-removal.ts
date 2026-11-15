/** 原SaaS管理主体前后复核，移除预检不跨Core检查持人员锁，也不执行停用/删除。 */
import type { CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { PlatformCoreTransaction, PlatformCoreUsers } from "./ports";
import { CoreRemovalQuerySchema } from "@rental-os/core-contracts";
import { CoreAccessError, CoreRemovalService, type CoreDeployedCatalogue, type CorePlatformRemovalSource } from "@rental-os/core-host";
import { PlatformPrincipalAuthority } from "@rental-os/platform-server/principal";

export function composePlatformCoreRemovalReader<Tx extends PlatformCoreTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  catalogue: CoreDeployedCatalogue;
  platform: CorePlatformRemovalSource;
}) {
  const principals = new PlatformPrincipalAuthority<Tx>(input.users);
  const removal = new CoreRemovalService(input.catalogue, input.platform);
  return async (value: unknown) => {
    const query = CoreRemovalQuerySchema.parse(value), actor = principals.current();
    const authorize = () => input.database.$transaction(async (transaction: Tx) => {
      const lease = await principals.lock(transaction, actor, actor.tenantId);
      const user = await lease.revalidate();
      if (!user.isSaasAdmin || !user.permissions.includes("*") && !user.permissions.includes("system:tenant:manage"))
        throw new CoreAccessError("denied", "Core移除预检需要当前SaaS管理员与租户管理权限");
    }, { isolationLevel: "ReadCommitted" });
    await authorize();
    const result = await removal.inspect(query);
    await authorize();
    return result;
  };
}
