import { describeError } from "./errors";
import { cachedMerchant } from "./merchant";
import { ROUTES, buildUrl, callPhone, navigate } from "./ui";

/**
 * 页面视图状态：与 state-view 组件一一对应。错误态总是带一个可执行的下一步。
 */
export type ViewStatus = "idle" | "loading" | "ready" | "empty" | "error" | "blocked";

export interface ViewState {
  status: ViewStatus;
  title: string;
  message: string;
  actionText: string;
  secondaryText: string;
  /** 主动作语义：retry / login / refresh / wait / contact / configure / none。 */
  next: string;
  requestId: string;
}

const base: ViewState = { status: "idle", title: "", message: "", actionText: "", secondaryText: "", next: "none", requestId: "" };

export const idleState = (): ViewState => ({ ...base });
export const loadingState = (): ViewState => ({ ...base, status: "loading" });
export const readyState = (): ViewState => ({ ...base, status: "ready" });

export function emptyState(title: string, message = "", actionText = "", secondaryText = "", next = "none"): ViewState {
  return { ...base, status: "empty", title, message, actionText, secondaryText, next };
}

export function blockedState(title: string, message = "", actionText = "", next = "contact", secondaryText = ""): ViewState {
  return { ...base, status: "blocked", title, message, actionText, secondaryText, next };
}

const ACTION_TEXT: Record<string, string> = {
  retry: "重试",
  login: "去登录",
  refresh: "刷新",
  wait: "稍后重试",
  contact: "联系商户",
  configure: "",
  none: ""
};

export function errorState(error: unknown, secondaryText = ""): ViewState {
  const presented = describeError(error);
  return {
    status: presented.code === "UNAVAILABLE" || presented.code === "NOT_CONFIGURED" ? "blocked" : "error",
    title: presented.title,
    message: presented.requestId ? `${presented.message}（请求号 ${presented.requestId.slice(0, 8)}）` : presented.message,
    actionText: ACTION_TEXT[presented.next] ?? "",
    secondaryText,
    next: presented.next,
    requestId: presented.requestId ?? ""
  };
}

/** 表单字段错误：贴字段展示（需求 §4.3）。 */
export type FieldErrors = Record<string, string>;

export function firstFieldError(errors: FieldErrors): string {
  for (const value of Object.values(errors)) if (value) return value;
  return "";
}

/**
 * 页面 onViewAction 的公共分支：登录跳转与联系商户在所有页面语义一致，
 * 返回 true 表示已处理；页面只需处理 retry/refresh 与自定义按钮。
 */
export function handleCommonViewAction(view: ViewState, options: { redirect: string; servicePhone?: string }): boolean {
  if (view.next === "login") {
    navigate(buildUrl(ROUTES.login, { redirect: options.redirect }));
    return true;
  }
  if (view.next === "contact") {
    callPhone(options.servicePhone ?? cachedMerchant()?.servicePhone);
    return true;
  }
  return false;
}
