/** 客户认证动作沿 Rental Core 正式入口，宿主供给原渠道、请求与会话操作。 */
import { createRentalMiniProgramAuthApi } from "@rental-os/rental-core/clients/miniprogram";
import { PUBLIC_CONFIG } from "../config/public";
import { contractMissing, featureUnavailable } from "../contracts/planned";
import { request } from "../core/http";
import { clearSession, currentServiceCode, refreshToken, saveSession } from "../core/session";

export const {
  loginWithPassword,
  loginWithWechatPhone,
  bindWechat,
  createChallenge,
  createRegistrationChallenge,
  verifyRegistrationChallenge,
  loginWithSms,
  registerPersonal,
  logout,
  switchService,
  membershipStatus,
  changePassword,
  closurePreview,
  closureChallenge,
  closeAccount,
  adoptSession,
} = createRentalMiniProgramAuthApi({
  request, publicConfig: PUBLIC_CONFIG, contractMissing, featureUnavailable,
  currentServiceCode, refreshToken, saveSession, clearSession,
});
