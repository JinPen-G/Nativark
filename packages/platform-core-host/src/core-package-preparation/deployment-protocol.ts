/** 浏览器仅传固定候选、原批准引用及派发 ID；没有命令、目标路径或凭据字段。 */
export type { CorePackageDeploymentRequest, CorePackageDeploymentResult } from "./deployment-ports";
export const CORE_PACKAGE_DEPLOYMENT_HTTP = {
  dispatch: { method: "POST", path: "dispatch-deployment" },
  receipt: { method: "POST", path: "deployment-receipt" }
} as const;
