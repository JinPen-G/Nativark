import { TENANT_INTEGRATION_PROVIDERS, type SaveTenantIntegrationRequest, type TenantIntegrationCapability, type TenantIntegrationProvider, type TenantIntegrationRouteParams } from "@rental-os/shared";
import { IsBoolean, IsIn, IsObject, IsOptional } from "class-validator";

const CAPABILITIES: TenantIntegrationCapability[] = ["sms", "payment", "file"];
// Keep route validation derived from the same provider registry used by the
// settings page and runtime adapters (including cross-border Stripe).
const PROVIDERS: TenantIntegrationProvider[] = [...new Set(TENANT_INTEGRATION_PROVIDERS.map((item) => item.provider))];

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
