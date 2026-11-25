/** 原组合继续提供唯一数据库、原订阅和审计；公共Core组合由独立包单源维护。 */
import type { CoreDeployedCatalogue, CorePlatformRemovalSource } from "@rental-os/core-host";
import type { Prisma } from "@prisma/client";
import type { CoreHostHttpApplication } from "./core-host.module";
import { composePlatformCoreApplication } from "@rental-os/platform-core-host";
import { originalCoreTermPolicy } from "./original-core-term";
import type { composeOriginalCoreBindings } from "./original-core-bindings";
import type { composeOriginalCoreManagement } from "./original-core-management";

type BindingsInput = Parameters<typeof composeOriginalCoreBindings>[0];
export type OriginalCoreApplicationInput = Pick<BindingsInput, "database" | "users" | "subscription" | "authorizeContainer"> & {
  audit: BindingsInput["audit"] & Parameters<typeof composeOriginalCoreManagement>[0]["audit"];
  catalogue: CoreDeployedCatalogue;
  platformRemoval?: CorePlatformRemovalSource;
};


/** 组合只创建适配，不读数据库、初始化Core或执行作业。 */
export function composeOriginalCoreApplication(input: OriginalCoreApplicationInput): CoreHostHttpApplication {
  return composePlatformCoreApplication<Prisma.TransactionClient>({ ...input, term: originalCoreTermPolicy(input.subscription) });
}
