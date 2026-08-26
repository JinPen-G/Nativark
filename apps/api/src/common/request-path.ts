/**
 * 请求路径归一化。鉴权与审计的字符串判定必须与**路由的匹配语义**一致，而不是与请求原文一致。
 *
 * Express 默认既不区分大小写、也不要求严格尾斜杠（本项目从未设置 `case sensitive routing`
 * 或 `strict routing`），因此 `/API/rental/v1/...`、`.../publish/`、`.../PUBLISH` 都会被
 * 路由到同一个处理器。而 `ApiAuthGuard` 是按前缀与正则判定权限的：变体路径**落不到任何分支**，
 * 最终走到 `requiredPermissions` 末尾的 `return []`，而空数组在 `hasAnyPermission` 里等于放行。
 * 也就是说，鉴权可以被一个大小写变体整体绕过——实测 `POST /api/PLATFORM/users` 与
 * `/api/PLATFORM/roles` 可以让任意已登录账号自建一个带任意权限码的角色并绑到自己名下，
 * 构成完整提权链；同一变体还会让审计拦截器的 `shouldSkip` 认为这不是业务域请求而不记账。
 *
 * 因此两处判定共用本模块：`normalizeRequestPath` 给出用于**记录**的路径（保留原始大小写，
 * 便于追溯攻击者实际请求了什么），`matchableRequestPath` 给出用于**判定**的路径（小写化）。
 */

/** 去掉查询串与全局 `/api` 前缀，折叠重复与尾部斜杠。保留原始大小写，供审计记录使用。 */
export function normalizeRequestPath(url: string): string {
  const raw = url.split("?")[0] ?? "";
  // 前缀按大小写不敏感剥离：Express 会把 /API/... 路由到同一处理器，
  // 只认小写 /api 会让前缀留在路径里，后续所有分支判定全部失配。
  const withoutPrefix = raw.replace(/^\/api(?=\/|$)/i, "");
  const collapsed = withoutPrefix.replace(/\/{2,}/g, "/").replace(/(.)\/+$/, "$1");
  return collapsed || "/";
}

/** 判定用路径：在归一化之上再小写化，使 `.../PUBLISH` 与 `.../publish` 得到同一个判定结果。 */
export function matchableRequestPath(url: string): string {
  return normalizeRequestPath(url).toLowerCase();
}
