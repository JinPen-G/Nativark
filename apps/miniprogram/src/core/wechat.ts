import { bindWechat } from "../api/auth";
import { contractMissing, featureUnavailable } from "../contracts/planned";
import { ApiError } from "./http";
import { markWechatBound } from "./session";

/** 与 shared 的 CLIENT_WECHAT_IDENTITY_REQUIRED 一致（本包只能 import type，故这里内联字面量）。 */
const WECHAT_IDENTITY_REQUIRED = "wechat_identity_required";

/** 付款时服务端返回 409 wechat_identity_required：需要先绑定微信身份。 */
export function isWechatIdentityRequired(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) return false;
  const body = error.body as { code?: string; data?: { code?: string } } | undefined;
  return body?.code === WECHAT_IDENTITY_REQUIRED || body?.data?.code === WECHAT_IDENTITY_REQUIRED;
}

/**
 * MP-02A 绑定：已登录（短信/密码）用户把当前微信身份绑定到本人，用于小程序内微信支付。
 * openid 由服务端持商户 AppSecret 用 wx.login 的一次性 code 换取，客户端从不自报。
 * 支持在“我的”里提前绑定，也可在付款遇到 wechat_identity_required(409) 时按需绑定。
 */
function freshLoginCode(): Promise<string> {
  return new Promise((resolve) => {
    wx.login({ success: (res) => resolve(res.code ?? ""), fail: () => resolve("") });
  });
}

export async function bindWechatIdentity(): Promise<void> {
  const code = await freshLoginCode();
  if (!code) throw new Error("未能获取微信登录凭证，请重试");
  try {
    const result = await bindWechat(code);
    if (!result.bound) throw new Error("绑定未成功，请重试");
    markWechatBound();
  } catch (error) {
    if (contractMissing(error)) throw featureUnavailable("商户尚未开通微信支付，暂不需要绑定微信");
    throw error;
  }
}
