/** 原第三方设置页与路径。宿主提供请求、可信会话和原查询缓存。 */
export { TenantIntegrationsPage } from "./TenantIntegrationsPage";
export { createTenantIntegrationsApi } from "./client";
export { hasTenantIntegrationPermission, TENANT_INTEGRATIONS_ROUTE } from "./integrationAccess";
