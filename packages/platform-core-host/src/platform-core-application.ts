/** 公共身份、有限事务、订阅和审计组成单一Core应用。行业HTTP/数据实现由宿主显式选择。 */
import type { CoreDeployedCatalogue, CorePlatformRemovalSource } from "@rental-os/core-host";
import type { CoreScopeReference } from "@rental-os/core-contracts";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { PlatformCoreHostDependencies, PlatformCoreTransaction } from "./ports";
import type { CoreHostHttpApplication } from "./core-host.module";
import { composePlatformCoreManagement } from "./platform-core-management";
import { composePlatformCoreBindings } from "./platform-core-bindings";
import { composePlatformCoreManagementReads } from "./platform-core-management-reads";
import { createPlatformCoreCatalogueReader } from "./platform-core-catalogue";
import { composePlatformCoreSessionReader } from "./platform-core-session";
import { composePlatformCoreScopeReader } from "./platform-core-scope";
import { composePlatformCoreHttpAccess } from "./platform-core-http-access";
import { composePlatformCoreRemovalReader } from "./platform-core-removal";

export type PlatformCoreApplicationInput<Tx extends PlatformCoreTransaction> = PlatformCoreHostDependencies<Tx> & {
  catalogue: CoreDeployedCatalogue;
  platformRemoval?: CorePlatformRemovalSource;
  authorizeContainer?(transaction: Tx, user: SystemUserRow, scope: CoreScopeReference): Promise<void>;
};

export function composePlatformCoreApplication<Tx extends PlatformCoreTransaction>(input: PlatformCoreApplicationInput<Tx>): CoreHostHttpApplication {
  const shared = { database: input.database, users: input.users, audit: input.audit,
    term: input.term, deployment: input.catalogue.availability };
  return {
    management: {
      management: composePlatformCoreManagement(shared),
      bindings: composePlatformCoreBindings({ ...shared, registrations: input.catalogue.registrations,
        ...(input.authorizeContainer ? { authorizeContainer: input.authorizeContainer } : {}) }),
      registered: createPlatformCoreCatalogueReader(input),
      ...(input.platformRemoval ? { removal: composePlatformCoreRemovalReader({ ...input, platform: input.platformRemoval }) } : {}),
      reads: composePlatformCoreManagementReads(shared)
    },
    session: composePlatformCoreSessionReader(input),
    scope: composePlatformCoreScopeReader({ ...shared, catalogue: input.catalogue }),
    http: input.catalogue.http,
    authorizeHttp: composePlatformCoreHttpAccess(input)
  };
}
