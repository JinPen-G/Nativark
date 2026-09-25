import { isSignedIn } from "./session";

/**
 * 页面路由白名单与安全跳转。登录后的“返回目标”只能是白名单页面，
 * 且会剥掉任何形似令牌/手机号/验证码的参数（需求 §5.1 返回目标、§12.3）。
 */
export const ROUTES = {
  home: "/pages/home/index",
  catalog: "/pages/catalog/index",
  orders: "/pages/orders/index",
  me: "/pages/me/index",
  item: "/pages/item/index",
  checkout: "/pages/checkout/index",
  cart: "/pages/cart/index",
  pay: "/pages/pay/index",
  order: "/pages/order/index",
  extend: "/pages/extend/index",
  login: "/pages/login/index",
  register: "/pages/register/index",
  closure: "/pages/closure/index",
  profile: "/pages/profile/index",
  qualifications: "/pages/qualifications/index",
  benefits: "/pages/benefits/index",
  favorites: "/pages/favorites/index",
  coupons: "/pages/coupons/index",
  locations: "/pages/locations/index",
  addresses: "/pages/addresses/index",
  legal: "/pages/legal/index"
} as const;

export const TAB_ROUTES = new Set<string>([ROUTES.home, ROUTES.catalog, ROUTES.orders, ROUTES.me]);

const KNOWN_ROUTES = new Set<string>(Object.values(ROUTES));
const PRIVATE_PARAMS = new Set([
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "phone",
  "code",
  "password",
  "openid",
  "unionid",
  "session_key",
  "verificationtoken",
  "paysign",
  "prepay_id"
]);

export function splitUrl(url: string): { path: string; params: Array<[string, string]> } {
  const [path, queryText = ""] = url.split("?");
  const params: Array<[string, string]> = [];
  for (const pair of queryText.split("&")) {
    if (!pair) continue;
    const [key, ...rest] = pair.split("=");
    params.push([key, rest.join("=")]);
  }
  return { path, params };
}

export function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

/** 仅接受本小程序白名单页面；未知页面、外部地址一律回落到首页；私有参数被剥离。 */
export function safeRoute(target: string | undefined | null, fallback: string = ROUTES.home): string {
  if (!target) return fallback;
  let decoded = target;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/pages/")) return fallback;
  const { path, params } = splitUrl(decoded);
  if (!KNOWN_ROUTES.has(path)) return fallback;
  const kept = params.filter(([key]) => !PRIVATE_PARAMS.has(key.toLowerCase()));
  return kept.length ? `${path}?${kept.map(([key, value]) => `${key}=${value}`).join("&")}` : path;
}

export function navigate(url: string): void {
  const { path } = splitUrl(url);
  if (TAB_ROUTES.has(path)) {
    wx.switchTab({ url: path });
    return;
  }
  wx.navigateTo({
    url,
    fail: () => {
      // 页面栈满（10 层）时退化为替换当前页，避免按钮点了没反应。
      wx.redirectTo({ url });
    }
  });
}

export function redirect(url: string): void {
  const { path } = splitUrl(url);
  if (TAB_ROUTES.has(path)) wx.switchTab({ url: path });
  else wx.redirectTo({ url });
}

export function back(fallback: string = ROUTES.home): void {
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack({ delta: 1 });
  else navigate(fallback);
}

export function currentRoute(): string {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page) return ROUTES.home;
  const options = (page as unknown as { options?: Record<string, string> }).options ?? {};
  return buildUrl(`/${page.route}`, options);
}

/** 需要登录的动作：未登录时跳到登录页并记录返回目标，返回 false。 */
export function requireSignIn(returnTo?: string): boolean {
  if (isSignedIn()) return true;
  const target = safeRoute(returnTo ?? currentRoute());
  navigate(buildUrl(ROUTES.login, { redirect: target }));
  return false;
}

export function toast(message: string, options: { icon?: "none" | "success" | "error"; duration?: number } = {}): void {
  wx.showToast({ title: message, icon: options.icon ?? "none", duration: options.duration ?? 2500 });
}

export function confirmDialog(options: { title: string; content: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      confirmText: options.confirmText ?? "确定",
      cancelText: options.cancelText ?? "取消",
      confirmColor: options.danger ? "#E5484D" : "#1677FF",
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false)
    });
  });
}

export function alertDialog(title: string, content: string): Promise<void> {
  return new Promise((resolve) => {
    wx.showModal({ title, content, showCancel: false, confirmText: "知道了", success: () => resolve(), fail: () => resolve() });
  });
}

export function callPhone(phone: string | undefined): void {
  if (!phone) {
    toast("商户暂未提供客服电话");
    return;
  }
  wx.makePhoneCall({ phoneNumber: phone, fail: () => toast("未能拨打电话") });
}
