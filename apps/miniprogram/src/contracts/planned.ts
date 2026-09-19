import { ApiError } from "../core/http";

/**
 * MP-R1 曾经的“拟新增”契约现已全部由服务端提供（渠道启动、微信手机号登录、短信登录、
 * 公开目录、地址簿、费用响应、在线注销），因此这里不再登记任何待接通接口。
 *
 * 保留这个模块只为一件事：服务端在**功能级别**关闭某能力时（商户未配置渠道、未启用配送等）
 * 仍会返回 404/501/503，页面用 contractMissing 判定并显示“商户未开通”，不伪装成功。
 * 静态测试会核对本表为空且服务端 OpenAPI 真的包含上述路径；再有新的拟新增契约时在此登记。
 */
export interface PlannedContract {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  task: string;
  userMessage: string;
}

export const PLANNED_CONTRACTS = {} as const satisfies Record<string, PlannedContract>;

export type PlannedContractKey = keyof typeof PLANNED_CONTRACTS;

/** 曾为拟新增、现已由服务端提供的契约；测试据此断言 OpenAPI 文档确实包含它们。 */
export const DELIVERED_CONTRACTS = [
  { method: "GET", path: "/public/bootstrap", task: "MP-01" },
  { method: "GET", path: "/public/catalog", task: "MP-03" },
  { method: "POST", path: "/auth/wechat/phone-login", task: "MP-02A" },
  { method: "POST", path: "/auth/wechat/bind", task: "MP-02A" },
  { method: "POST", path: "/auth/challenges", task: "MP-02B" },
  { method: "POST", path: "/auth/sms-login", task: "MP-02B" },
  { method: "GET", path: "/auth/closure/preview", task: "MP-02B" },
  { method: "POST", path: "/auth/closure/challenge", task: "MP-02B" },
  { method: "POST", path: "/auth/closure", task: "MP-02B" },
  { method: "GET", path: "/profile/addresses", task: "MP-06" },
  { method: "GET", path: "/orders/{id}/fee-items", task: "MP-11" }
] as const;

/** 服务端对某能力的响应是否表示“商户未开通/未提供”。 */
export function contractMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501 || error.status === 503 || error.code === "NOT_FOUND" || error.code === "UNAVAILABLE");
}

/** 把“未开通”统一成用户可理解的 UNAVAILABLE 错误。 */
export function featureUnavailable(userMessage: string): ApiError {
  return new ApiError("UNAVAILABLE", userMessage, { status: 501 });
}
