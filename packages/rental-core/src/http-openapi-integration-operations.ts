/** 原运营集成、作业与通知的同源 HTTP 描述。
 * 所选 Rental 宿主挂载原台账参加者；文档不授予权限，也不证明外部执行成功。
 * 公共作业和通知字段继续从正式公共声明生成，旧组合复用相同操作标识。 */
import { JOBS_HTTP_OPERATIONS } from "@rental-os/platform-server/jobs";
import { NOTIFICATIONS_HTTP_OPERATIONS } from "@rental-os/platform-server/notifications";
import { backlogOperation, type ContractOperation, type HttpMethod } from "./http-openapi-contract";

export const RENTAL_INTEGRATION_LEDGER_HTTP_OPERATIONS: ContractOperation[] = [
  backlogOperation("get", "/api/integrations/adapter-logs", "Integrations", "listAdapterLogs", "List adapter logs", ["system:integration:manage"]),
  backlogOperation("post", "/api/integrations/adapters/mock-call", "Integrations", "invokeMockAdapter", "Invoke mock adapter", ["system:integration:manage"]),
  backlogOperation("get", "/api/integrations/data-exchange/templates", "Integrations", "listDataExchangeTemplates", "List data exchange templates", ["system:integration:manage"]),
  backlogOperation("post", "/api/integrations/data-exchange/jobs", "Integrations", "createDataExchangeJob", "Create data exchange job", ["system:integration:manage"]),
  backlogOperation("get", "/api/integrations/dashboard", "Integrations", "getInfraDashboard", "Get integrations dashboard with files filtered by their original business ACL", ["system:integration:manage"]),
  backlogOperation("get", "/api/integrations/tbox-devices", "Integrations", "listIntegrationTboxDevices", "List integration TBox devices", ["system:integration:manage"]),
  backlogOperation("post", "/api/integrations/tbox-devices", "Integrations", "saveIntegrationTboxDevice", "Save integration TBox device", ["system:integration:manage"]),
  backlogOperation("put", "/api/integrations/tbox-devices/{id}", "Integrations", "updateIntegrationTboxDevice", "Update integration TBox device", ["system:integration:manage"]),
  backlogOperation("post", "/api/integrations/tbox-devices/{id}/bind", "Integrations", "bindIntegrationTboxDevice", "Bind integration TBox device", ["system:integration:manage"]),
  // 作业/通知字段与路由沿公共声明，权限使用原Guard的system:integration:manage。
  ...JOBS_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "Jobs", operationId: item.id, summary: item.summary,
    permissions: [item.permission], responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {}),
    ...("parameters" in item ? { parameters: [...item.parameters] } : {})
  })),
  ...NOTIFICATIONS_HTTP_OPERATIONS.map((item): ContractOperation => ({
    method: item.method.toLowerCase() as HttpMethod,
    path: `/api${item.path.replace(/:([a-zA-Z]+)/g, "{$1}")}`,
    tag: "Notifications", operationId: item.id, summary: item.summary,
    permissions: [item.permission], responseSchema: item.response,
    ...("request" in item ? { requestSchema: item.request } : {})
  })),
];
