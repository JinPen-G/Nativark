import type { ClientAgreementConsent } from "@rental-os/shared";
import { ApiError } from "../core/http";

/**
 * 需求 §12 中“拟新增”的服务端契约。服务端尚未提供这些接口；小程序按下面的形状调用，
 * 收到 404/501/503 时按“待接通”处理并向用户说明，绝不伪装成功。
 *
 * 这张表同时是自动化测试的对账依据：测试会核对每一项确实**不在** OpenAPI 文档里——
 * 一旦服务端补上了某个接口，测试会失败提醒把该项从这里移除并接线。
 */
export interface PlannedContract {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  /** 任务台账编号（《多品类租赁平台开发任务》§3.6）。 */
  task: string;
  /** 面向用户的说明：这项能力商户还没开通。 */
  userMessage: string;
}

export const PLANNED_CONTRACTS = {
  bootstrap: {
    method: "GET",
    path: "/public/bootstrap",
    task: "MP-01",
    userMessage: "商户尚未发布小程序渠道配置（品牌、协议与客服信息）"
  },
  wechatPhoneLogin: {
    method: "POST",
    path: "/auth/wechat/phone-login",
    task: "MP-02A",
    userMessage: "微信手机号一键登录尚未开通，请先使用手机号密码登录"
  },
  smsLogin: {
    method: "POST",
    path: "/auth/sms/login",
    task: "MP-02B",
    userMessage: "短信验证码登录尚未开通，请使用手机号密码登录"
  },
  publicCatalog: {
    method: "GET",
    path: "/public/catalog",
    task: "MP-03",
    userMessage: "商户尚未开放游客浏览，登录后即可查看设备"
  },
  deliveryAddresses: {
    method: "GET",
    path: "/profile/addresses",
    task: "MP-06",
    userMessage: "配送地址与上门配送尚未开通，请选择自取"
  },
  feeResponses: {
    method: "POST",
    path: "/orders/{id}/fee-responses",
    task: "MP-11",
    userMessage: "费用在线确认/异议尚未开通，如有异议请联系商户"
  },
  accountClosure: {
    method: "POST",
    path: "/auth/close-account",
    task: "MP-02B",
    userMessage: "在线注销尚未开通，请联系商户办理"
  }
} as const satisfies Record<string, PlannedContract>;

export type PlannedContractKey = keyof typeof PLANNED_CONTRACTS;

/** 服务端对“拟新增”接口的响应是否表示尚未提供。 */
export function contractMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 501 || error.status === 503 || error.code === "NOT_FOUND" || error.code === "UNAVAILABLE");
}

export function plannedUnavailable(key: PlannedContractKey): ApiError {
  const contract = PLANNED_CONTRACTS[key];
  return new ApiError("UNAVAILABLE", contract.userMessage, { status: 501 });
}

/* ---------- 拟新增契约的形状（与需求 §12.1 的展示对象一致） ---------- */

export interface ChannelBootstrapContract {
  merchant: { name: string; logoUrl?: string; servicePhone?: string; serviceHours?: string };
  services: Array<{ code: string; name: string; categoryCode: string; isDefault?: boolean; status?: "open" | "paused" }>;
  defaultServiceCode?: string;
  agreements?: {
    userAgreement: { name: string; version: string; url?: string };
    privacyPolicy: { name: string; version: string; url?: string };
  };
  loginMethods?: Array<"wechat_phone" | "sms" | "password">;
  capabilities?: Partial<Record<"publicCatalog" | "delivery" | "wechatPay" | "feeResponse" | "accountClosure", boolean>>;
}

export interface WechatPhoneLoginRequest {
  /** wx.login 返回的登录凭证，由服务端换取 openid；小程序不提交 openid。 */
  loginCode: string;
  /** 手机号授权组件返回的一次性凭证，由服务端解析手机号；小程序不提交手机号明文。 */
  phoneCode: string;
  consent: ClientAgreementConsent;
  /** 可选的初始服务；服务端仍会校验并写入会话。 */
  serviceCode?: string;
}
