/** 原作业 HTTP 的路由与真实 Guard 权限同源声明，运行和打印沿实际宿主参加者处理。 */
export const JOBS_HTTP_OPERATIONS = [
  {
    method: "GET", path: "/jobs", id: "listAsyncJobs", summary: "读取当前租户的原作业台账",
    access: "tenant", permission: "system:integration:manage", response: "Jobs.List"
  },
  {
    method: "POST", path: "/jobs", id: "createAsyncJob", summary: "按原校验登记任务和入队日志",
    access: "tenant", permission: "system:integration:manage", request: "Jobs.CreateRequest", response: "Jobs.Summary"
  },
  {
    method: "POST", path: "/jobs/run-due", id: "runDueJobs", summary: "手动调用原到期任务执行入口",
    access: "tenant", permission: "system:integration:manage", response: "Jobs.DueResult"
  },
  {
    method: "POST", path: "/jobs/:id/run", id: "runAsyncJob", summary: "按原任务标识调用宿主执行者",
    access: "tenant", permission: "system:integration:manage", response: "Jobs.Summary",
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }]
  },
  {
    method: "GET", path: "/jobs/print", id: "listPrintJobs", summary: "读取宿主提供的原打印台账",
    access: "tenant", permission: "system:integration:manage", response: "Jobs.PrintList"
  },
  {
    method: "POST", path: "/jobs/print", id: "createPrintJob", summary: "调用宿主的原打印生成入口",
    access: "tenant", permission: "system:integration:manage", request: "Jobs.CreatePrintRequest", response: "Jobs.PrintSummary"
  }
] as const;
