import { isSignedIn } from "./session";

/**
 * 页面路由白名单与安全跳转。登录后的“返回目标”只能是白名单页面，
 * 且会剥掉任何形似令牌/口令的参数。
 */
export const ROUTES = {
  login: "/pages/login/index",
  workspace: "/pages/workspace/index",
  workbench: "/pages/workbench/index",
  orders: "/pages/orders/index",
  scan: "/pages/scan/index",
  scanner: "/pages/scanner/index",
  me: "/pages/me/index",
  subscription: "/pages/subscription/index",
  order: "/pages/order/index",
  orderNew: "/pages/order-new/index",
  allocate: "/pages/allocate/index",
  reviews: "/pages/reviews/index",
  pickup: "/pages/pickup/index",
  return: "/pages/return/index",
  workOrders: "/pages/work-orders/index",
  workOrder: "/pages/work-order/index",
  scanResult: "/pages/scan-result/index",
  scanManual: "/pages/scan-manual/index",
  assets: "/pages/assets/index",
  asset: "/pages/asset/index",
  assetLedger: "/pages/asset-ledger/index",
  assetNew: "/pages/asset-new/index",
  customers: "/pages/customers/index",
  customer: "/pages/customer/index",
  customerEdit: "/pages/customer-edit/index",
  password: "/pages/password/index",
  history: "/pages/history/index",
  about: "/pages/about/index"
} as const;

export const TAB_ROUTES = new Set<string>([ROUTES.workbench, ROUTES.orders, ROUTES.scan, ROUTES.me]);

const KNOWN_ROUTES = new Set<string>(Object.values(ROUTES));
const PRIVATE_PARAMS = new Set(["token", "accesstoken", "access_token", "refreshtoken", "refresh_token", "password", "code", "openid", "unionid", "session_key"]);

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

/** 仅接受本小程序白名单页面；未知页面、外部地址一律回落到工作台；私有参数被剥离。 */
export function safeRoute(target: string | undefined | null, fallback: string = ROUTES.workbench): string {
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

/** 登录/选空间这类“入口页”用 reLaunch 清栈，避免返回键回到已失效的页面。 */
export function relaunch(url: string): void {
  wx.reLaunch({ url, fail: () => redirect(url) });
}

export function back(fallback: string = ROUTES.workbench): void {
  const pages = getCurrentPages();
  if (pages.length > 1) wx.navigateBack({ delta: 1 });
  else navigate(fallback);
}

export function currentRoute(): string {
  const pages = getCurrentPages();
  const page = pages[pages.length - 1];
  if (!page) return ROUTES.workbench;
  const options = (page as unknown as { options?: Record<string, string> }).options ?? {};
  return buildUrl(`/${page.route}`, options);
}

/** 需要登录的动作：未登录时跳到登录页并记录返回目标，返回 false。 */
export function requireSignIn(returnTo?: string): boolean {
  if (isSignedIn()) return true;
  const target = safeRoute(returnTo ?? currentRoute());
  relaunch(buildUrl(ROUTES.login, { redirect: target }));
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
      confirmColor: options.danger ? "#B42318" : "#165DDB",
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false)
    });
  });
}

/** 带输入框的确认（原因必填的动作用它）；取消返回 undefined。 */
export function promptDialog(options: { title: string; placeholder?: string; confirmText?: string; danger?: boolean }): Promise<string | undefined> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      editable: true,
      placeholderText: options.placeholder ?? "请输入原因",
      confirmText: options.confirmText ?? "确定",
      cancelText: "取消",
      confirmColor: options.danger ? "#B42318" : "#165DDB",
      success: (res) => resolve(res.confirm ? String((res as { content?: string }).content ?? "").trim() : undefined),
      fail: () => resolve(undefined)
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
    toast("暂无可拨打的电话");
    return;
  }
  wx.makePhoneCall({ phoneNumber: phone, fail: () => toast("未能拨打电话") });
}

export function copyText(text: string, hint = "已复制"): void {
  wx.setClipboardData({ data: text, success: () => toast(hint) });
}
