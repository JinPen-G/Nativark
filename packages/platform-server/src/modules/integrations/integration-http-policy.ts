/** 原租户第三方设置HTTP单源声明，公共宿主和Rental组合保留相同权限与operationId。 */
export const INTEGRATION_HTTP_OPERATIONS = [
  { method: "GET", path: "/platform/integrations", id: "listTenantIntegrationConfigs", summary: "读取本租户第三方目录与配置摘要",
    access: "tenant", permission: "system:integration:manage", response: "Integration.Catalog" },
  { method: "PUT", path: "/platform/integrations/:capability/:provider", id: "saveTenantIntegrationConfig", summary: "保存本租户第三方配置与加密凭据",
    access: "tenant", permission: "system:integration:manage", request: "Integration.SaveConfig", response: "Integration.Configuration" },
  { method: "POST", path: "/platform/integrations/:capability/:provider/test", id: "testTenantIntegrationConfig", summary: "占用原配置测试窗口并执行供应商只读探针",
    access: "tenant", permission: "system:integration:manage", response: "Integration.TestResult" }
] as const;
