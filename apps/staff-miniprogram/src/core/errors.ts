import { ApiError, type ApiErrorCode } from "./http";

/**
 * 把请求错误翻译成“哪里有问题、如何继续”（需求 §4.3）。
 * 400/401/403/404/409/429/503 分别处理，409 不自动重试，429 只能等待。
 */
export interface ErrorPresentation {
  code: ApiErrorCode | "UNKNOWN";
  title: string;
  message: string;
  /** 用户能否通过重试解决。 */
  retryable: boolean;
  /** 建议的下一步。 */
  next: "retry" | "login" | "wait" | "refresh" | "contact" | "configure" | "none";
  requestId?: string;
}

const TITLES: Record<ApiErrorCode, string> = {
  NOT_CONFIGURED: "尚未配置",
  NETWORK: "网络不可用",
  TIMEOUT: "请求超时",
  BAD_REQUEST: "信息不符合要求",
  UNAUTHENTICATED: "身份验证未通过",
  AUTH_REQUIRED: "需要登录",
  AUTH_EXPIRED: "登录已失效",
  FORBIDDEN: "暂不能办理",
  NOT_FOUND: "找不到对应内容",
  CONFLICT: "信息已变化",
  RATE_LIMITED: "操作过于频繁",
  UNAVAILABLE: "服务暂未开通",
  SERVER: "服务暂时出错",
  STALE_CONTEXT: "服务已切换",
  INVALID_RESPONSE: "返回内容异常"
};

export function describeError(error: unknown): ErrorPresentation {
  if (error instanceof ApiError) {
    const base = { code: error.code, title: TITLES[error.code], requestId: error.requestId };
    switch (error.code) {
      case "NOT_CONFIGURED":
        return { ...base, message: error.message, retryable: false, next: "configure" };
      case "NETWORK":
        return { ...base, message: "请检查网络后重试；已加载的内容仍可查看。", retryable: true, next: "retry" };
      case "TIMEOUT":
        return { ...base, message: "服务器响应超时。若刚才是提交或付款，请先查看结果，不要重复提交。", retryable: true, next: "refresh" };
      case "BAD_REQUEST":
        return { ...base, message: error.message || "请检查填写内容。", retryable: false, next: "none" };
      case "UNAUTHENTICATED":
        return { ...base, message: error.message || "账号或密码不正确。", retryable: false, next: "none" };
      case "AUTH_REQUIRED":
        return { ...base, message: "请先登录后继续。", retryable: false, next: "login" };
      case "AUTH_EXPIRED":
        return { ...base, message: "登录已过期，请重新登录后继续；出于安全考虑，本机未提交的租赁清单已清除。", retryable: false, next: "login" };
      case "FORBIDDEN":
        return { ...base, message: error.message || "当前会员状态或资质不允许此操作。", retryable: false, next: "contact" };
      case "NOT_FOUND":
        return { ...base, message: error.message || "内容不存在或不属于你。", retryable: false, next: "none" };
      case "CONFLICT":
        return { ...base, message: error.message || "价格、库存或状态已变化，请刷新后再确认。", retryable: false, next: "refresh" };
      case "RATE_LIMITED":
        return { ...base, message: `请求过于频繁，请${error.retryAfterSeconds ? `等待 ${error.retryAfterSeconds} 秒` : "稍后"}再试。`, retryable: true, next: "wait" };
      case "UNAVAILABLE":
        return { ...base, message: error.message || "商户尚未开通该服务，请联系商户。", retryable: false, next: "contact" };
      case "STALE_CONTEXT":
        return { ...base, message: "当前服务已切换，页面内容已刷新。", retryable: true, next: "refresh" };
      case "INVALID_RESPONSE":
        return { ...base, message: "服务返回了无法识别的内容，请稍后重试。", retryable: true, next: "retry" };
      case "SERVER":
      default:
        return { ...base, message: error.message || "请稍后重试。", retryable: true, next: "retry" };
    }
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "发生未知错误";
  return { code: "UNKNOWN", title: "操作未完成", message, retryable: false, next: "none" };
}

/** 一句话文案，供 toast 使用。 */
export function errorText(error: unknown): string {
  const presented = describeError(error);
  return presented.message ? `${presented.title}：${presented.message}` : presented.title;
}
