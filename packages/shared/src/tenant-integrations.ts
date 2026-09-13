/**
 * 租户第三方服务配置契约。
 *
 * 这里描述的是“租户可以启用哪些平台”，不是具体 SDK 的实现细节。
 * API 返回的 secretFields 只有 configured 标记，绝不返回密钥明文。
 */
export type TenantIntegrationCapability = "sms" | "payment" | "file";

export type TenantIntegrationProvider =
  | "aliyun_sms"
  | "tencent_sms"
  | "alipay"
  | "wechat_pay"
  | "aliyun_oss"
  | "tencent_cos"
  | "s3_compatible";

export type TenantIntegrationTestStatus = "not_tested" | "passed" | "failed";

export interface TenantIntegrationProviderField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  inputType: "text" | "password" | "number" | "url";
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
  mode: "configuration" | "live";
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
    fields: [
      { key: "mchid", label: "商户号", secret: false, required: true, inputType: "text" },
      { key: "appId", label: "应用 ID", secret: false, required: true, inputType: "text" },
      { key: "gatewayUrl", label: "网关地址", secret: false, required: false, inputType: "url", placeholder: "https://api.mch.weixin.qq.com", description: "开发或沙箱联调时可填写兼容网关；生产默认使用微信支付官方网关。" },
      { key: "notifyUrl", label: "支付通知地址", secret: false, required: true, inputType: "url" },
      { key: "refundNotifyUrl", label: "退款通知地址", secret: false, required: false, inputType: "url", description: "可选；微信退款结果通知地址。未配置时继续通过退款查询恢复，不把受理当成成功。" },
      { key: "platformCertificateSerial", label: "平台证书序列号", secret: false, required: true, inputType: "text", description: "用于匹配微信回调请求头中的 Wechatpay-Serial，不是商户证书序列号。" },
      { key: "merchantPrivateKey", label: "商户私钥", secret: true, required: true, inputType: "password" },
      { key: "merchantSerialNo", label: "商户证书序列号", secret: true, required: true, inputType: "text" },
      { key: "wechatPlatformCertificate", label: "微信支付平台证书", secret: true, required: true, inputType: "password" },
      { key: "apiV3Key", label: "API v3 密钥", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["jsapi", "app", "native", "h5"]
  },
  {
    capability: "file",
    provider: "aliyun_oss",
    name: "阿里云 OSS",
    description: "对象存储直传。客户端只拿短时上传授权，不暴露长期 AccessKey。",
    fields: [
      { key: "region", label: "地域", secret: false, required: true, inputType: "text", placeholder: "oss-cn-hangzhou" },
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
      { key: "forcePathStyle", label: "使用 Path Style", secret: false, required: false, inputType: "text" },
      { key: "accessKeyId", label: "Access Key ID", secret: true, required: true, inputType: "text" },
      { key: "secretAccessKey", label: "Secret Access Key", secret: true, required: true, inputType: "password" }
    ],
    supportedMethods: ["presigned_upload", "presigned_download"]
  }
];

export function findTenantIntegrationProvider(
  capability: TenantIntegrationCapability,
  provider: TenantIntegrationProvider
) {
  return TENANT_INTEGRATION_PROVIDERS.find((item) => item.capability === capability && item.provider === provider);
}
