/** 原身份/审计/存储与单一部署目录的公共Core应用组合；行业HTTP、AI及作业由选中Core另行装配。 */
import type { CoreDeployedCatalogue } from "@rental-os/core-host";
import type { CoreHostHttpApplication } from "./core-host.module";
import { composeOriginalCoreManagement } from "./original-core-management";
import { composeOriginalCoreBindings } from "./original-core-bindings";
import { composeOriginalCoreManagementReads } from "./original-core-management-reads";
import { createOriginalCoreCatalogueReader } from "./original-core-catalogue";
import { composeOriginalCoreSessionReader } from "./original-core-session";
import { composeOriginalCoreScopeReader } from "./original-core-scope";

type BindingsInput = Parameters<typeof composeOriginalCoreBindings>[0];
export type OriginalCoreApplicationInput = Pick<BindingsInput, "database" | "users" | "subscription" | "authorizeContainer"> & {
  audit: BindingsInput["audit"] & Parameters<typeof composeOriginalCoreManagement>[0]["audit"];
  catalogue: CoreDeployedCatalogue;
};

/** 组合期间只创建适配实例，不读环境、连接数据库、启动作业或初始化租户/Core。 */
export function composeOriginalCoreApplication(input: OriginalCoreApplicationInput): CoreHostHttpApplication {
  const shared = { database: input.database, users: input.users, audit: input.audit,
    subscription: input.subscription, deployment: input.catalogue.availability };
  return {
    management: {
      management: composeOriginalCoreManagement(shared),
      bindings: composeOriginalCoreBindings({ ...shared, registrations: input.catalogue.registrations,
        ...(input.authorizeContainer ? { authorizeContainer: input.authorizeContainer } : {}) }),
      registered: createOriginalCoreCatalogueReader(input),
      reads: composeOriginalCoreManagementReads(shared)
    },
    session: composeOriginalCoreSessionReader(input),
    scope: composeOriginalCoreScopeReader({ ...shared, catalogue: input.catalogue })
  };
}
