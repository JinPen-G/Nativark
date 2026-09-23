/**
 * 员工小程序公开配置。与客户小程序不同：**一套小程序服务所有租户**，租户编码由员工在登录页输入，
 * 因此这里没有 tenantCode，只有 API 根地址与 AppID。
 *
 *   apiOrigin   API 服务根地址，不含 /api 前缀。本机联调用 http://localhost:3000；正式发布必须填 https 地址，
 *               并用 `npm run build:staff-miniprogram:release` 构建（发布模式拒绝任何 http 地址）。
 *   appId       员工小程序 AppID（公开信息）；没有正式 AppID 时留空。
 *
 * 构建时环境变量 STAFF_MINIPROGRAM_API_ORIGIN / STAFF_MINIPROGRAM_APP_ID 只在显式设置且非空时覆盖这里的值。
 * `allowLocalApi` 与 `builtAt` 由构建脚本写入，不要手改。
 *
 * 绝不能出现在这里的东西：AppSecret、任何账号口令、任何租户密钥。
 */
export interface PublicConfig {
  apiOrigin: string;
  appId: string;
  /** 只在本机联调构建时由脚本写为 true；发布构建恒为 false。 */
  allowLocalApi: boolean;
  /** 构建时间戳，用于排查“跑的是哪次构建”。 */
  builtAt: string;
}

export const PUBLIC_CONFIG: PublicConfig = {
  apiOrigin: "http://localhost:3000",
  appId: "",
  allowLocalApi: false,
  builtAt: ""
};

export function isConfigured(config: PublicConfig = PUBLIC_CONFIG): boolean {
  return Boolean(config.apiOrigin);
}

/** 运行时再次校验地址安全性：发布包只接受 https；回环 http 只有构建写入联调开关时才允许。 */
export function configProblem(config: PublicConfig = PUBLIC_CONFIG): string | undefined {
  if (!config.apiOrigin) return "小程序尚未配置服务地址";
  const origin = config.apiOrigin.trim();
  if (/^https:\/\/[^/\s]+$/i.test(origin)) return undefined;
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  if (loopback && config.allowLocalApi) return undefined;
  return "服务地址不安全（发布包必须使用 HTTPS）";
}
