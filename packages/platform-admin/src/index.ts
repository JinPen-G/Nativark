/** 公共后台的正式装配入口；领域页面与运行中的业务 Agent 由所选 Core 贡献。 */
export { AdminUiProvider } from "./AdminUiProvider";
export { AdminRuntimeProvider, useAdminRuntime, useAdminSession, createAdminSessionQueries } from "./runtime";
export type { AdminRuntime, AdminSessionSnapshot, AdminRequestOptions } from "./runtime";
export { PlatformShell } from "./PlatformShell";
export type { PlatformShellProps, PlatformShellLayout } from "./PlatformShell";
