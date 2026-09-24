import type { LoginResponse } from "@rental-os/shared";
import { PUBLIC_CONFIG, configProblem } from "../config/public";
import { noteServerDate } from "./clock";
import { accessToken, clearSession, contextVersion, isSignedIn, refreshToken, saveSession } from "./session";

/**
 * 员工端 API 的唯一请求出口。
 *
 * 所有请求走员工专用版本门面；员工会话受众与 Web 运营会话隔离，服务端再映射到
 * 有白名单、权限、地点范围与脱敏处理的既有 Rental Core 业务处理器。
 *
 * - 统一解包 `{ data, requestId }` 信封；错误统一成 ApiError（业务码 + 用户文案 + requestId）。
 * - 401：同一时刻只做一次刷新（单飞），刷新成功后重放原请求一次；刷新被拒绝就清空身份。
 * - 空间范围的请求记录发出时的上下文版本；切换空间后回来的迟到响应整体丢弃。
 * - 每个响应头 Date 都用于校准时钟。
 */
export type ApiErrorCode =
  | "NOT_CONFIGURED"
  | "NETWORK"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "SERVER"
  | "STALE_CONTEXT"
  | "INVALID_RESPONSE";

export interface ApiErrorInit {
  status?: number;
  requestId?: string;
  retryAfterSeconds?: number;
  body?: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  readonly body?: unknown;

  constructor(code: ApiErrorCode, message: string, init: ApiErrorInit = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.body = init.body;
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** 微信 wx.request 不支持 PATCH；需要部分更新的接口在服务端以 PUT 别名提供。 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  data?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** required：必须已登录；none：公开接口（登录/刷新）。默认 required。 */
  auth?: "required" | "none";
  /** workspace：切换空间后丢弃迟到响应（默认）；tenant：租户级数据，不受切换影响。 */
  scope?: "workspace" | "tenant";
  idempotencyKey?: string;
  /** 交接操作锁令牌（x-operation-token）。 */
  operationToken?: string;
  timeoutMs?: number;
  replayAfterRefresh?: boolean;
}

interface RawResponse {
  statusCode: number;
  data: unknown;
  header: Record<string, unknown>;
}

const API_PREFIX = "/api/staff/v1";
const DEFAULT_TIMEOUT_MS = 15000;

export function apiUrl(path: string, query?: RequestOptions["query"]): string {
  const origin = PUBLIC_CONFIG.apiOrigin.replace(/\/+$/, "");
  const base = path.startsWith("/api/") ? `${origin}${path}` : `${origin}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`;
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  if (!params.length) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${params.join("&")}`;
}

/** 解包系统响应信封；非信封原样返回，0/false 等假值不能被误判成“无数据”。 */
export function unwrap(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body) && "data" in body) {
    const keys = Object.keys(body as Record<string, unknown>);
    if ("requestId" in body || keys.length === 1) return (body as { data: unknown }).data;
  }
  return body;
}

function headerValue(header: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const lower = name.toLowerCase();
  for (const key of Object.keys(header)) {
    if (key.toLowerCase() === lower) {
      const value = header[key];
      return Array.isArray(value) ? String(value[0]) : value === undefined || value === null ? undefined : String(value);
    }
  }
  return undefined;
}

function randomId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let index = 0; index < 20; index += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `smp-${Date.now().toString(36)}-${out}`;
}

function bodyMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return typeof body === "string" && body.trim() ? body.trim() : undefined;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.map(String).join("；");
  if (typeof message === "string" && message.trim()) return message.trim();
  return undefined;
}

function toApiError(raw: RawResponse): ApiError {
  const requestId = headerValue(raw.header, "x-request-id") ?? ((raw.data as { requestId?: string } | undefined)?.requestId ?? undefined);
  const message = bodyMessage(raw.data);
  const init: ApiErrorInit = { status: raw.statusCode, requestId, body: raw.data };
  switch (raw.statusCode) {
    case 400:
      return new ApiError("BAD_REQUEST", message ?? "请求内容不符合要求", init);
    case 401:
      return new ApiError("UNAUTHENTICATED", message ?? "身份验证未通过", init);
    case 403:
      return new ApiError("FORBIDDEN", message ?? "当前账号无权执行此操作", init);
    case 404:
      return new ApiError("NOT_FOUND", message ?? "内容不存在", init);
    case 409:
      return new ApiError("CONFLICT", message ?? "信息已变化，请刷新后重试", init);
    case 429: {
      const retryAfter = Number(headerValue(raw.header, "retry-after"));
      return new ApiError("RATE_LIMITED", message ?? "操作过于频繁", { ...init, retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined });
    }
    case 501:
    case 503:
      return new ApiError("UNAVAILABLE", message ?? "服务暂未开通", init);
    default:
      return new ApiError("SERVER", message ?? `服务暂时出错（${raw.statusCode}）`, init);
  }
}

function send(path: string, options: RequestOptions, token: string): Promise<RawResponse> {
  const header: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Request-Id": randomId()
  };
  if (token) header.Authorization = `Bearer ${token}`;
  if (options.idempotencyKey) header["Idempotency-Key"] = options.idempotencyKey;
  if (options.operationToken) header["x-operation-token"] = options.operationToken;
  return new Promise<RawResponse>((resolve, reject) => {
    wx.request({
      url: apiUrl(path, options.query),
      method: options.method ?? "GET",
      data: options.data as string | WechatMiniprogram.IAnyObject | ArrayBuffer | undefined,
      header,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      dataType: "json",
      responseType: "text",
      success: (res) => {
        noteServerDate(headerValue(res.header as Record<string, unknown>, "date"));
        resolve({ statusCode: res.statusCode, data: res.data, header: (res.header ?? {}) as Record<string, unknown> });
      },
      fail: (error) => {
        const text = String((error && (error as { errMsg?: string }).errMsg) ?? "");
        if (/timeout|timed out/i.test(text)) reject(new ApiError("TIMEOUT", "请求超时", { status: 0 }));
        else reject(new ApiError("NETWORK", "网络不可用", { status: 0 }));
      }
    });
  });
}

let refreshing: Promise<"ok" | "rejected" | "failed"> | undefined;

async function performRefresh(): Promise<"ok" | "rejected" | "failed"> {
  const token = refreshToken();
  if (!token) {
    clearSession("refresh-token-missing");
    return "rejected";
  }
  const startVersion = contextVersion();
  let raw: RawResponse;
  try {
    raw = await send("/auth/refresh", { method: "POST", data: { refreshToken: token } }, "");
  } catch {
    return "failed";
  }
  if (raw.statusCode >= 200 && raw.statusCode < 300) {
    const body = unwrap(raw.data) as LoginResponse | undefined;
    if (!body || typeof body.accessToken !== "string") {
      clearSession("refresh-invalid-response");
      return "rejected";
    }
    // 刷新期间发生了登录/切换空间：当前会话已被替换，旧会话刷出的令牌不能覆盖它。
    if (contextVersion() !== startVersion) return isSignedIn() ? "ok" : "rejected";
    saveSession(body, "refresh");
    return "ok";
  }
  if (raw.statusCode === 401 || raw.statusCode === 403 || raw.statusCode === 400) {
    clearSession("refresh-rejected");
    return "rejected";
  }
  return "failed";
}

/** 单飞刷新：并发的 401 共享同一次刷新，避免旧 refresh token 被多次消费导致互相踢下线。 */
export function refreshSessionOnce(): Promise<"ok" | "rejected" | "failed"> {
  if (!refreshing) {
    refreshing = performRefresh().then(
      (result) => {
        refreshing = undefined;
        return result;
      },
      () => {
        refreshing = undefined;
        return "failed" as const;
      }
    );
  }
  return refreshing;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const problem = configProblem();
  if (problem) throw new ApiError("NOT_CONFIGURED", problem);
  const auth = options.auth ?? "required";
  const scope = options.scope ?? "workspace";
  if (auth === "required" && !isSignedIn()) throw new ApiError("AUTH_REQUIRED", "请先登录", { status: 401 });

  const startVersion = contextVersion();
  const assertContext = () => {
    if (scope === "workspace" && contextVersion() !== startVersion) {
      throw new ApiError("STALE_CONTEXT", "经营空间已切换，该结果已作废");
    }
  };

  const tokenAtStart = auth === "none" ? "" : accessToken();
  let raw = await send(path, options, tokenAtStart);

  if (raw.statusCode === 401 && auth !== "none" && tokenAtStart) {
    assertContext();
    let replayToken = accessToken();
    if (!replayToken || replayToken === tokenAtStart) {
      const result = await refreshSessionOnce();
      if (result === "rejected") throw new ApiError("AUTH_EXPIRED", "登录已失效，请重新登录", { status: 401 });
      if (result === "failed") throw new ApiError("SERVER", "登录状态暂时无法刷新，请稍后重试", { status: 0 });
      replayToken = accessToken();
    }
    if (options.replayAfterRefresh === false) throw new ApiError("AUTH_EXPIRED", "登录已刷新，请重新发起本次操作", { status: 401 });
    assertContext();
    raw = await send(path, options, replayToken);
    if (raw.statusCode === 401) {
      clearSession("replay-rejected");
      throw new ApiError("AUTH_EXPIRED", "登录已失效，请重新登录", { status: 401 });
    }
  }

  assertContext();
  if (raw.statusCode >= 200 && raw.statusCode < 300) return unwrap(raw.data) as T;
  throw toApiError(raw);
}

/** 当前请求应携带的鉴权头（供 downloadFile 等不走 request() 的宿主 API 使用）。 */
export function authHeaders(): Record<string, string> {
  const token = accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
