/** 外壳文案；Core 的事实和业务文案由贡献提供，不在客户端翻译业务数据。 */
import type { ClientError, ClientLocale } from "./contracts";
export const CLIENT_ENGLISH = {
  "客户服务": "Customer services", "门店工作台": "Store workspace", "登录": "Sign in", "退出登录": "Sign out",
  "正在核对会话…": "Checking your session…", "使用你的客户账号登录。": "Sign in with your customer account.",
  "使用你的员工账号登录。": "Sign in with your staff account.", "当前登录服务不可用。": "Sign-in is currently unavailable.",
  "重新连接": "Reconnect", "导航": "Navigation", "切换工作范围": "Switch work scope", "选择已授权范围": "Select an authorized scope",
  "语言": "Language", "深色外观": "Dark appearance", "浅色外观": "Light appearance", "搜索": "Search",
  "搜索当前页面": "Search this page", "扫码或输入编号": "Scan or enter a code", "打开": "Open", "扫描二维码": "Scan QR code",
  "刷新页面": "Refresh page", "正在加载…": "Loading…", "操作": "Actions", "确认执行": "Confirm action",
  "待核对的操作": "Operations to check", "读取原结果": "Read original result",
  "结果尚未确认，请核对原结果。": "The result is not confirmed. Check the original result.",
  "原结果暂时无法核对，请稍后重试读取。": "Original results are unavailable. Try reading them again later.",
  "暂时没有可用服务。": "No services are available yet.", "返回首页": "Return home", "取消": "Cancel",
  "此操作将提交到当前页面所示的业务对象。": "This action applies to the business object shown on this page.",
  "当前设备无法保留操作定位，暂不能提交。": "This device cannot retain operation references. Actions are unavailable.",
  "会话已变化，请重新打开页面。": "Your session changed. Open the page again.",
  "请先登录。": "Please sign in.", "你没有此页面或操作的权限。": "You do not have access to this page or action.",
  "这项服务已停用。": "This service is disabled.", "服务暂不可用，请稍后重试。": "This service is unavailable. Try again later.",
  "找不到此页面，请从导航重新进入。": "Page not found. Choose a page from the navigation.",
  "此操作仍待核对，请先读取原结果。": "This action still needs checking. Read its original result first.",
  "请补全必填信息并核对输入长度。": "Complete required fields and check input length.",
} as const;
export type ClientMessage = keyof typeof CLIENT_ENGLISH;
export function clientText(message: ClientMessage, locale: ClientLocale): string {
  return locale === "en-US" ? CLIENT_ENGLISH[message] : message;
}
export function clientErrorText(error: ClientError["code"], locale: ClientLocale): string {
  const messages: Record<ClientError["code"], ClientMessage> = {
    stale: "会话已变化，请重新打开页面。", anonymous: "请先登录。", denied: "你没有此页面或操作的权限。",
    disabled: "这项服务已停用。", unavailable: "服务暂不可用，请稍后重试。", route_missing: "找不到此页面，请从导航重新进入。",
    operation_pending: "此操作仍待核对，请先读取原结果。",
  };
  return clientText(messages[error], locale);
}
