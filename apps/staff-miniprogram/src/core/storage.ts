/**
 * 本机私有缓存的唯一出入口。所有键都带统一前缀，退出登录时按前缀整体清理，
 * 避免“换了账号还能看到上一个人的扫码记录/草稿”。
 */
const PREFIX = "rental-os-staff:";

export const STORAGE_KEYS = {
  session: `${PREFIX}session`,
  /** 上次登录的租户编码：只是输入便利，不含任何凭据。 */
  lastTenantCode: `${PREFIX}last-tenant-code`,
  /** 每个经营空间上次选中的履约地点（"" 表示全部）。 */
  locationByWorkspace: `${PREFIX}location-by-workspace`,
  /** 本机扫码记录（最近 50 条），按账号隔离。 */
  scanHistory: `${PREFIX}scan-history`,
  /** 未提交的检查草稿（断网时保留，不改变业务状态）。 */
  drafts: `${PREFIX}drafts`,
  /** 关键动作（取消/交接/收款）的幂等键：结果未知时同键重放，绝不新键重试。 */
  actionKeys: `${PREFIX}action-keys`,
  themeMode: `${PREFIX}theme-mode`
} as const;

/** 退出登录后仍可保留的键：租户编码只是输入便利，深浅色是本机偏好，均不含私密数据。 */
const KEEP_ON_SIGN_OUT = new Set<string>([STORAGE_KEYS.lastTenantCode, STORAGE_KEYS.themeMode]);

export function readStorage<T>(key: string): T | undefined {
  try {
    const value = wx.getStorageSync(key) as T | "" | null | undefined;
    return value === "" || value === undefined || value === null ? undefined : value;
  } catch {
    return undefined;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 存储满或被禁用时不能让业务流程崩溃；内存态仍然有效。
  }
}

export function removeStorage(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    // 忽略
  }
}

/** 清理本人私有数据（会话、扫码记录、草稿、地点选择）。 */
export function clearPrivateStorage(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    if (!KEEP_ON_SIGN_OUT.has(key)) removeStorage(key);
  }
}
