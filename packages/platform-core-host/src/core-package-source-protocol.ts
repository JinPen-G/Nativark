/** 私有来源浏览器协议只含路径与脱敏投影；凭据不属于任何响应或缓存。 */
export type { CorePackageSourceSettings, CorePackageSourceSettingsRequest } from "./core-package-source-settings";
export const CORE_PACKAGE_SOURCE_HTTP = {
  read: { method: "GET", path: "private-source" }, save: { method: "POST", path: "private-source" }
} as const;
