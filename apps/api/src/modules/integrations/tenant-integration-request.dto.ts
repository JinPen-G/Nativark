import type { SaveTenantIntegrationRequest, TenantIntegrationCapability, TenantIntegrationProvider, TenantIntegrationRouteParams } from "@rental-os/shared";
import { IsBoolean, IsIn, IsObject, IsOptional } from "class-validator";

const CAPABILITIES: TenantIntegrationCapability[] = ["sms", "payment", "file"];
const PROVIDERS: TenantIntegrationProvider[] = ["aliyun_sms", "tencent_sms", "alipay", "wechat_pay", "aliyun_oss", "tencent_cos", "s3_compatible"];

export class TenantIntegrationRouteDto implements TenantIntegrationRouteParams {
  @IsIn(CAPABILITIES)
  capability!: TenantIntegrationCapability;

  @IsIn(PROVIDERS)
  provider!: TenantIntegrationProvider;
}

export class SaveTenantIntegrationDto implements SaveTenantIntegrationRequest {
  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  isDefault!: boolean;

  @IsObject()
  settings!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}
