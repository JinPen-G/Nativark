/**
 * ★ 每个租户各自打一个小程序包：换租户时只改下面的 `tenantCode`（必要时再改 `apiOrigin`/`appId`），然后重新构建。
 *
 *   tenantCode  本包对应的商户（租户）公开编码。第一版绑定演示租户 `demo`（与 scripts/seed-demo-tenant.cjs 一致）。
 *   apiOrigin   API 服务根地址，不含 /api 前缀。本机联调用 http://localhost:3000；正式发布必须填 https 地址，
 *               并用 `npm run build:miniprogram:release` 构建（发布模式拒绝任何 http 地址）。
 *   appId       本包对应的小程序 AppID（公开信息），用于与实际运行的小程序核对；没有正式 AppID 时留空。
 *
 * 构建时环境变量 MINIPROGRAM_TENANT_CODE / MINIPROGRAM_API_ORIGIN / MINIPROGRAM_APP_ID 只在**显式设置且非空**时覆盖这里的值，
 * 供 CI 一次构建多个租户；日常只改这个文件即可。`allowLocalApi` 与 `builtAt` 由构建脚本写入，不要手改。
 *
 * 绝不能出现在这里的东西：AppSecret、商户私钥、session_key、任何账号口令。
 */
export interface PublicConfig {
  apiOrigin: string;
  tenantCode: string;
  appId: string;
  /** 只在本机联调构建时由脚本写为 true；发布构建恒为 false。 */
  allowLocalApi: boolean;
  /** 构建时间戳，用于排查“跑的是哪次构建”。 */
  builtAt: string;
}

export const PUBLIC_CONFIG: PublicConfig = {
  apiOrigin: "http://localhost:3000",
  tenantCode: "demo",
  appId: "",
  allowLocalApi: false,
  builtAt: ""
};

export function isConfigured(config: PublicConfig = PUBLIC_CONFIG): boolean {
  return Boolean(config.apiOrigin && config.tenantCode);
}

/** 运行时再次校验地址安全性：发布包只接受 https；回环 http 只有构建写入联调开关时才允许。 */
export function configProblem(config: PublicConfig = PUBLIC_CONFIG): string | undefined {
  if (!config.apiOrigin || !config.tenantCode) return "小程序尚未配置商户与服务地址";
  const origin = config.apiOrigin.trim();
  if (/^https:\/\/[^/\s]+$/i.test(origin)) return undefined;
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  if (loopback && config.allowLocalApi) return undefined;
  return "服务地址不安全（发布包必须使用 HTTPS）";
}
