/** Rental选装MCP的原工厂绑定：同一Auth、Guard、Native数据库、Core观察和原读计量。
 * AS就绪、MCP wire发布/字段释放及流量政策由真实owner供给；缺失拒绝，不从配置推断批准。
 * 构造不连接/监听，不调用模型，不创建第二份身份或资金账。 */
import {
  assertOriginalMcpWorkspaceIntegrationManagement, createOriginalMcpWorkspaceManagementAuthority,
  OriginalMcpOperationLogService, createOriginalMcpCoreAccess, createOriginalMcpCatalogReadTools,
  createOriginalMcpHost, type OriginalMcpHostConfig, type OriginalMcpHostExports,
  type OriginalMcpCatalogReadToolsExports, type OriginalMcpCatalogReadPolicy
} from "@rental-os/rental-mcp-host";
import type { McpRoutedHost } from "@rental-os/mcp-server/host-router" with { "resolution-mode": "import" };
import type { RentalAiHostAssembly } from "./ai-assembly";
import type { RentalAiMcpHostDependencies } from "./mcp-bootstrap";

type OriginalSources = Parameters<typeof createOriginalMcpHost>[5];
export interface RentalOriginalMcpHostSources {
  config: OriginalMcpHostConfig;
  metadata: OriginalSources["metadata"];
  catalog: OriginalMcpCatalogReadPolicy;
  verification?: OriginalSources["verification"];
  reviewVerification?: OriginalSources["reviewVerification"];
  protocolTraffic?: OriginalSources["protocolTraffic"];
  receiptTraffic?: OriginalSources["receiptTraffic"];
  catalogGoalVerification?: NonNullable<OriginalSources["catalogGoal"]>["verification"];
}

/** 正式ESM子出口组成同一原工厂；根包只提供受保护端点，不能充当OAuth工厂集合。 */
async function runtime(): Promise<OriginalMcpHostExports & OriginalMcpCatalogReadToolsExports> {
  const [service, router, consent, review, grant, admission, governance, subject, store, clients,
    admissions, authority, use, grantAdmission, consentReview, webConsent, consentAuthority, policies,
    traffic, protocolTraffic, accounting, input, goals, bindings, goalIntents, goalAdoptions, goalControl,
    clientReview, noticeReview, grantManagement, subjectStore, tokens] = await Promise.all([
    import("@rental-os/mcp-server/service"), import("@rental-os/mcp-server/host-router"),
    import("@rental-os/mcp-server/consent-control-plane"), import("@rental-os/mcp-server/review-control-plane"),
    import("@rental-os/mcp-server/grant-control-plane"), import("@rental-os/mcp-server/admission-control-plane"),
    import("@rental-os/mcp-server/reviewed-governance-control-plane"), import("@rental-os/mcp-server/subject-control-plane"),
    import("@rental-os/mcp-server/prisma-oauth-store"), import("@rental-os/mcp-server/prisma-public-client-registry"),
    import("@rental-os/mcp-server/prisma-oauth-admission-store"), import("@rental-os/mcp-server/prisma-oauth-grant-authority"),
    import("@rental-os/mcp-server/prisma-oauth-grant-use"), import("@rental-os/mcp-server/prisma-oauth-grant-admission"),
    import("@rental-os/mcp-server/prisma-oauth-consent-review"), import("@rental-os/mcp-server/prisma-oauth-web-consent"),
    import("@rental-os/mcp-server/prisma-oauth-consent-authority"), import("@rental-os/mcp-server/prisma-oauth-consent-policy-store"),
    import("@rental-os/mcp-server/original-traffic-meter"), import("@rental-os/mcp-server/protocol-traffic"),
    import("@rental-os/mcp-server/prisma-mcp-read-accounting"), import("@rental-os/mcp-server/persistent-read-accounting"),
    import("@rental-os/mcp-server/prisma-mcp-catalog-goals"), import("@rental-os/mcp-server/prisma-mcp-read-bindings"),
    import("@rental-os/mcp-server/prisma-mcp-catalog-goal-intents"), import("@rental-os/mcp-server/prisma-mcp-catalog-goal-adoptions"),
    import("@rental-os/mcp-server/catalog-goal-control-plane"), import("@rental-os/mcp-server/prisma-public-client-review"),
    import("@rental-os/mcp-server/prisma-oauth-notice-review"), import("@rental-os/mcp-server/prisma-oauth-grant-management"),
    import("@rental-os/mcp-server/prisma-oauth-subject-store"), import("@rental-os/mcp-server/persistent-oauth-tokens")
  ]);
  return { ...service, ...router, ...consent, ...review, ...grant, ...admission, ...governance, ...subject,
    ...store, ...clients, ...admissions, ...authority, ...use, ...grantAdmission, ...consentReview, ...webConsent,
    ...consentAuthority, ...policies, ...traffic, ...protocolTraffic, ...accounting, ...input, ...goals,
    ...bindings, ...goalIntents, ...goalAdoptions, ...goalControl, ...clientReview, ...noticeReview,
    ...grantManagement, ...subjectStore, ...tokens,
    ...(await import("@rental-os/rental-mcp-host/capability-mapping")) };
}

export async function createRentalOriginalMcpHost<Additional = unknown>(host: RentalAiHostAssembly<Additional>,
  dependencies: RentalAiMcpHostDependencies, sources: RentalOriginalMcpHostSources): Promise<McpRoutedHost> {
  if (!host.ai || !host.aiAccess || !Object.is(dependencies.database, host.rental.database)
    || !Object.is(dependencies.configuration, host.rental.configuration)
    || typeof host.coreReadSources?.catalogueForTransaction !== "function"
    || typeof sources?.metadata?.read !== "function" || typeof sources.catalog?.publication?.allows !== "function"
    || typeof sources.catalog?.release?.project !== "function" || typeof sources.catalog?.traffic?.current !== "function")
    throw new Error("MCP选装缺少原AI/Core、AS就绪或已批准目录发布来源");
  const mcp = await runtime(), auth = host.rental.auth, users = host.rental.authSource;
  const platform = createOriginalMcpWorkspaceManagementAuthority({
    useMysqlDataSource: () => (dependencies.configuration.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql",
    repository: {
      findUserById: (id, transaction) => users.findUserById(id, transaction),
      assertTrustedWorkspaceIntegrationManagement: (binding, transaction) =>
        assertOriginalMcpWorkspaceIntegrationManagement({
          assertTenantPermissionInTransaction: (native, tenantId, userId, permission) =>
            users.assertTenantManagementPermission(tenantId, userId, permission, native),
          resolveTrustedWorkspacePrincipal: (who, native) => users.resolveTrustedWorkspacePrincipal(who, native)
        }, binding, transaction)
    }
  });
  const logs = new OriginalMcpOperationLogService(dependencies.database);
  const coreAccess = createOriginalMcpCoreAccess({ users, term: host.coreReadSources.term,
    deploymentForTransaction: native => {
      const catalogue = host.coreReadSources.catalogueForTransaction(native), available = catalogue.availability;
      return {
        requireRegistered: coreId => available.requireRegistered(coreId),
        requireAvailable: async (coreId, tenantId) => {
          await catalogue.requireDataCapabilityAvailable("ai-native");
          await available.requireAvailable(coreId, tenantId);
        }
      };
    }
  });
  return createOriginalMcpHost(mcp, sources.config, auth, platform, logs, {
    database: dependencies.database, metadata: sources.metadata, coreAccess,
    ...(sources.verification ? { verification: sources.verification } : {}),
    ...(sources.reviewVerification ? { reviewVerification: sources.reviewVerification } : {}),
    ...(sources.protocolTraffic ? { protocolTraffic: sources.protocolTraffic } : {}),
    ...(sources.receiptTraffic ? { receiptTraffic: sources.receiptTraffic } : {}),
    ...(sources.catalogGoalVerification ? { catalogGoal: { guard: host.guard, verification: sources.catalogGoalVerification } } : {}),
    createReadTools: current => createOriginalMcpCatalogReadTools(mcp, {
      enabled: sources.config.core.service.enabled, resourceUrl: sources.config.core.service.resource.resourceUrl,
      allowedScopes: sources.config.core.service.tokens.allowedScopes
    }, current, auth, host.guard, host.rental.primary.core, logs, sources.catalog)
  });
}
