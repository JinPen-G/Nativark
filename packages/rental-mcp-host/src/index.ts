/** 原 Rental MCP 的显式主入口。代码导入不创建宿主、登记工具或启动监听。 */
export * from "./original-mcp-host";
export * from "./original-mcp-oauth-core";
export * from "./original-mcp-catalog-read-tools";
export { createOriginalMcpCoreAccess } from "./original-mcp-core-access";
export * from "./workspace-management";
export { OperationLogService as OriginalMcpOperationLogService } from "./operation-log.service";
export type { OriginalOAuthAuditRecord, OriginalMcpReadGoalAuditRecord, OriginalMcpRequestSaveAuditRecord, OriginalMcpCatalogGoalAdoptionAuditRecord } from "./operation-log.service";
