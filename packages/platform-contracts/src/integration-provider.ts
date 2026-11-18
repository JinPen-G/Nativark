/** 公共第三方服务标识。仅描述原服务目录，不授予凭据、调用或业务权限。 */
export type TenantIntegrationProvider =
  | "aliyun_sms"
  | "tencent_sms"
  | "smtp"
  | "alipay"
  | "wechat_pay"
  | "stripe"
  | "aliyun_oss"
  | "tencent_cos"
  | "s3_compatible";
