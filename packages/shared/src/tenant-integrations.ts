/**
 * 租户第三方服务配置契约。
 *
 * 这里描述的是“租户可以启用哪些平台”，不是具体 SDK 的实现细节。
 * API 返回的 secretFields 只有 configured 标记，绝不返回密钥明文。
 */
import type { RentalCurrency } from "./core";

export type TenantIntegrationCapability = "sms" | "payment" | "file";

export type TenantIntegrationProvider =
  | "aliyun_sms"
  | "tencent_sms"
  | "alipay"
  | "wechat_pay"
  | "stripe"
  | "aliyun_oss"
  | "tencent_cos"
  | "s3_compatible";

export type TenantIntegrationTestStatus = "not_tested" | "passed" | "failed";
export type TenantIntegrationTestMode = "none" | "configuration" | "live";

export interface TenantIntegrationProviderField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  inputType: "text" | "password" | "number" | "url" | "boolean";
  placeholder?: string;
  description?: string;
}

export interface TenantIntegrationProviderDefinition {
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
  name: string;
  description: string;
  fields: TenantIntegrationProviderField[];
  supportedMethods?: string[];
  /**
   * 仅支付能力使用:该收单平台可结算的币种。目录展示、启用校验与运行时选路都按
   * 经营空间结算币种(`pricing.currency`)据此过滤——境内 CNY-only 的平台绝不出现在
   * 境外租户的可选列表里,反之亦然。
   */
  settlementCurrencies?: RentalCurrency[];
  /** 仅支付能力使用:境内收单还是跨境收单。用于分组/展示,真正的门禁是 settlementCurrencies。 */
  audience?: "domestic" | "cross_border";
}

export interface TenantIntegrationSecretState {
  configured: boolean;
  fields: string[];
}

export interface TenantIntegrationConfigSummary {
  id: string;
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
  enabled: boolean;
  isDefault: boolean;
  settings: Record<string, unknown>;
  secrets: TenantIntegrationSecretState;
  lastTestStatus: TenantIntegrationTestStatus;
  lastTestMode: TenantIntegrationTestMode;
  lastTestAt?: string;
  lastTestError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantIntegrationCatalogResponse {
  providers: TenantIntegrationProviderDefinition[];
  configs: TenantIntegrationConfigSummary[];
}

export interface SaveTenantIntegrationRequest {
  enabled: boolean;
  isDefault: boolean;
  settings: Record<string, unknown>;
  /** 只接收目录中声明的 secret 字段；未填写时保留已保存的密钥。 */
  credentials?: Record<string, string>;
}

/** EXT-01D：真实支付退款申请。只允许引用订单资金事实形成的待退余额。 */
export interface CreatePaymentRefundRequest {
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export interface TenantIntegrationRouteParams {
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
}

export interface TenantIntegrationTestResult {
  capability: TenantIntegrationCapability;
  provider: TenantIntegrationProvider;
  ok: boolean;
  mode: Exclude<TenantIntegrationTestMode, "none">;
  message: string;
  checkedAt: string;
  missingFields: string[];
}

export const TENANT_INTEGRATION_PROVIDERS: TenantIntegrationProviderDefinition[] = [
  {
    capability: "sms",
    provider: "aliyun_sms",
    name: "阿里云短信",
    description: "验证码和业务通知短信。需要阿里云 AccessKey、签名和模板编码。",
    fields: [
      { key: "region", label: "地域", secret: false, required: true, inputType: "text", placeholder: "cn-hangzhou" },
      { key: "signName", label: "短信签名", secret: false, required: true, inputType: "text" },
      { key: "verificationTemplateCode", label: "验证码模板编码", secret: false, required: true, inputType: "text", description: "短信服务商的验证码模板编码；不是密钥，可安全回显。" },
      { key: "accessKeyId", label: "AccessKey ID", secret: true, required: true, inputType: "text" },
      { key: "accessKeySecret", label: "AccessKey Secret", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["verification", "notification"]
  },
  {
    capability: "sms",
    provider: "tencent_sms",
    name: "腾讯云短信",
    description: "验证码和业务通知短信。需要 SecretId、SecretKey、短信应用和模板。",
    fields: [
      { key: "region", label: "地域", secret: false, required: true, inputType: "text", placeholder: "ap-guangzhou" },
      { key: "smsSdkAppId", label: "短信应用 ID", secret: false, required: true, inputType: "text" },
      { key: "signName", label: "短信签名", secret: false, required: true, inputType: "text" },
      { key: "verificationTemplateId", label: "验证码模板 ID", secret: false, required: true, inputType: "text", description: "短信服务商的验证码模板 ID；不是密钥，可安全回显。" },
      { key: "secretId", label: "SecretId", secret: true, required: true, inputType: "text" },
      { key: "secretKey", label: "SecretKey", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["verification", "notification"]
  },
  {
    capability: "payment",
    provider: "alipay",
    name: "支付宝",
    description: "支付宝网页、手机网页或二维码收款。私钥只在服务端加密保存。",
    audience: "domestic",
    settlementCurrencies: ["CNY"],
    fields: [
      { key: "appId", label: "应用 ID", secret: false, required: true, inputType: "text" },
      { key: "gatewayUrl", label: "网关地址", secret: false, required: true, inputType: "url", placeholder: "https://openapi.alipay.com/gateway.do" },
      { key: "notifyUrl", label: "异步通知地址", secret: false, required: true, inputType: "url" },
      { key: "appPrivateKey", label: "应用私钥", secret: true, required: true, inputType: "password" },
      { key: "alipayPublicKey", label: "支付宝公钥", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["web", "wap", "qr"]
  },
  {
    capability: "payment",
    provider: "wechat_pay",
    name: "微信支付",
    description: "微信 JSAPI、APP、Native 或 H5 收款。回调必须经过 API v3 验签。",
    audience: "domestic",
    settlementCurrencies: ["CNY"],
    fields: [
      { key: "mchid", label: "商户号", secret: false, required: true, inputType: "text" },
      { key: "appId", label: "应用 ID", secret: false, required: true, inputType: "text" },
      { key: "gatewayUrl", label: "网关地址", secret: false, required: false, inputType: "url", placeholder: "https://api.mch.weixin.qq.com", description: "开发或沙箱联调时可填写兼容网关；生产默认使用微信支付官方网关。" },
      { key: "notifyUrl", label: "支付通知地址", secret: false, required: true, inputType: "url" },
      { key: "refundNotifyUrl", label: "退款通知地址", secret: false, required: false, inputType: "url", description: "可选；微信退款结果通知地址。未配置时继续通过退款查询恢复，不把受理当成成功。" },
      { key: "platformCertificateSerial", label: "平台证书序列号", secret: false, required: false, inputType: "text", description: "旧平台证书验签模式；与微信支付公钥二选一，序列号须匹配回调头 Wechatpay-Serial。" },
      { key: "platformPublicKeyId", label: "微信支付公钥 ID", secret: false, required: false, inputType: "text", placeholder: "PUB_KEY_ID_...", description: "公钥验签模式；与公钥文件成对填写，按回调头 Wechatpay-Serial 精确匹配。" },
      { key: "merchantPrivateKey", label: "商户私钥", secret: true, required: true, inputType: "password" },
      { key: "merchantSerialNo", label: "商户证书序列号", secret: true, required: true, inputType: "text" },
      { key: "wechatPlatformCertificate", label: "微信支付平台证书", secret: true, required: false, inputType: "password", description: "平台证书验签模式；须与平台证书序列号成对填写。" },
      { key: "wechatPlatformPublicKey", label: "微信支付公钥", secret: true, required: false, inputType: "password", description: "公钥验签模式；须与公钥 ID 成对填写。" },
      { key: "apiV3Key", label: "API v3 密钥", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["jsapi", "app", "native", "h5"]
  },
  {
    capability: "payment",
    provider: "stripe",
    name: "Stripe",
    description: "境外收单:卡支付,并可在 Stripe 后台开启支付宝/微信作为付款方式。按外币结算到境外主体账户。",
    audience: "cross_border",
    // Stripe 以标准两位小数处理这些币种;MOP 不支持、TWD 有 100 整数倍特殊规则(见 stripe-payment.ts 的 fail-closed),故暂不列入。启用前以实际账户签约区域为准。
    settlementCurrencies: ["HKD", "SGD", "USD", "EUR"],
    fields: [
      { key: "successUrl", label: "支付成功回跳地址", secret: false, required: true, inputType: "url", description: "客户在 Stripe 收银台完成支付后跳回的地址(通常是租户站点订单页)。" },
      { key: "cancelUrl", label: "支付取消回跳地址", secret: false, required: true, inputType: "url", description: "客户在 Stripe 收银台取消支付后跳回的地址。" },
      { key: "statementDescriptor", label: "对账单显示名", secret: false, required: false, inputType: "text", description: "可选;显示在持卡人对账单上的商户名。" },
      { key: "secretKey", label: "Secret Key", secret: true, required: true, inputType: "password", description: "Stripe 密钥(sk_...),只在服务端加密保存,绝不下发前端。" },
      { key: "webhookSecret", label: "Webhook 签名密钥", secret: true, required: true, inputType: "password", description: "Stripe Webhook 端点签名密钥(whsec_...),用于校验回调。" }
    ],
    supportedMethods: ["card", "alipay", "wechat_pay"]
  },
  {
    capability: "file",
    provider: "aliyun_oss",
    name: "阿里云 OSS",
    description: "对象存储直传。客户端只拿短时上传授权，不暴露长期 AccessKey。",
    fields: [
      { key: "region", label: "地域", secret: false, required: true, inputType: "text", placeholder: "cn-hangzhou" },
      { key: "endpoint", label: "Endpoint", secret: false, required: true, inputType: "url" },
      { key: "bucket", label: "Bucket", secret: false, required: true, inputType: "text" },
      { key: "objectPrefix", label: "对象前缀", secret: false, required: false, inputType: "text", placeholder: "tenant-files/" },
      { key: "accessKeyId", label: "AccessKey ID", secret: true, required: true, inputType: "text" },
      { key: "accessKeySecret", label: "AccessKey Secret", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["presigned_upload", "presigned_download"]
  },
  {
    capability: "file",
    provider: "tencent_cos",
    name: "腾讯云 COS",
    description: "对象存储直传。客户端只拿短时上传授权，不暴露长期 SecretKey。",
    fields: [
      { key: "region", label: "地域", secret: false, required: true, inputType: "text", placeholder: "ap-guangzhou" },
      { key: "bucket", label: "Bucket", secret: false, required: true, inputType: "text" },
      { key: "objectPrefix", label: "对象前缀", secret: false, required: false, inputType: "text", placeholder: "tenant-files/" },
      { key: "secretId", label: "SecretId", secret: true, required: true, inputType: "text" },
      { key: "secretKey", label: "SecretKey", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["presigned_upload", "presigned_download"]
  },
  {
    capability: "file",
    provider: "s3_compatible",
    name: "S3 兼容对象存储",
    description: "兼容 S3 签名的对象存储服务。适合已有私有云或其他云厂商。",
    fields: [
      { key: "endpoint", label: "Endpoint", secret: false, required: true, inputType: "url" },
      { key: "region", label: "Region", secret: false, required: true, inputType: "text", placeholder: "us-east-1" },
      { key: "bucket", label: "Bucket", secret: false, required: true, inputType: "text" },
      { key: "objectPrefix", label: "对象前缀", secret: false, required: false, inputType: "text", placeholder: "tenant-files/" },
      { key: "forcePathStyle", label: "使用 Path Style", secret: false, required: false, inputType: "boolean", description: "部分兼容 S3 的私有对象存储需要使用路径式地址；云厂商默认不需要。" },
      { key: "accessKeyId", label: "Access Key ID", secret: true, required: true, inputType: "text" },
      { key: "secretAccessKey", label: "Secret Access Key", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["presigned_upload", "presigned_download"]
  }
];

/**
 * 按经营空间结算币种筛出可用收单平台。
 *
 * 这是"境内支付宝绝不给境外租户"的唯一事实源:目录展示、启用校验、运行时选路
 * 都必须走这里,不能只在前端隐藏(前端菜单隐藏不能替代后端数据权限)。
 * 只作用于 payment 能力;非支付平台没有结算币种,不参与筛选。
 */
export function paymentProviderSupportsCurrency(
  definition: TenantIntegrationProviderDefinition,
  currency: RentalCurrency
): boolean {
  if (definition.capability !== "payment") return false;
  return Array.isArray(definition.settlementCurrencies) && definition.settlementCurrencies.includes(currency);
}

export function paymentProvidersForCurrency(currency: RentalCurrency): TenantIntegrationProviderDefinition[] {
  return TENANT_INTEGRATION_PROVIDERS.filter((definition) => paymentProviderSupportsCurrency(definition, currency));
}

export function findTenantIntegrationProvider(
  capability: TenantIntegrationCapability,
  provider: TenantIntegrationProvider
) {
  return TENANT_INTEGRATION_PROVIDERS.find((item) => item.capability === capability && item.provider === provider);
}
