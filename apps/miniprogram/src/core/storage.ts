/**
 * 本机私有缓存的唯一出入口。所有键都带统一前缀，退出登录时按前缀整体清理，
 * 避免“换了账号还能看到上一个人的草稿/订单缓存”。
 */
const PREFIX = "rental-os:";

export const STORAGE_KEYS = {
  session: `${PREFIX}session`,
  cart: `${PREFIX}cart`,
  bootstrap: `${PREFIX}bootstrap`,
  lastService: `${PREFIX}last-service`,
  actionKeys: `${PREFIX}action-keys`,
  paymentIntents: `${PREFIX}payment-intents`,
  favorites: `${PREFIX}favorites`
} as const;

/** 退出登录后仍可保留的键：商户公开信息、上次选择的服务与本机收藏不含私密数据（收藏按客户分开保存）。 */
const KEEP_ON_SIGN_OUT = new Set<string>([STORAGE_KEYS.bootstrap, STORAGE_KEYS.lastService, STORAGE_KEYS.favorites]);

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

/** 清理本人私有数据（会话、草稿、幂等键、支付单缓存）。 */
export function clearPrivateStorage(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    if (!KEEP_ON_SIGN_OUT.has(key)) removeStorage(key);
  }
}
