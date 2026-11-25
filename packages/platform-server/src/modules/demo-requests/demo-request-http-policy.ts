/** 公共匿名仅允许提交。列表须原 operator 会话、SaaS 身份及指定权限，服务返前复验。 */
export const DEMO_REQUEST_HTTP_OPERATIONS = [
  { method: "POST", path: "/public/demo-requests", id: "createWebsiteDemoRequest", summary: "提交官网演示预约",
    access: "anonymous", rateLimited: true, request: "DemoRequest.Create", response: "DemoRequest.Receipt" },
  { method: "GET", path: "/platform/demo-requests", id: "listWebsiteDemoRequests", summary: "读取平台演示预约",
    access: "saas_demo_request", permission: "system:demo-request:view", query: ["keyword", "page", "pageSize"],
    response: "DemoRequest.Page" }
] as const;
