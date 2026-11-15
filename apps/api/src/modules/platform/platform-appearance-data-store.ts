/** 外观设置的私有持久化边界；旧客户端品牌仅由组合宿主显式提供兼容读取。 */
import type { PrismaClient } from "@prisma/client";
import type { TenantAppearanceProfile } from "@rental-os/shared/platform";

export type PlatformAppearanceDataStore = Pick<
  PrismaClient,
  "tenantAppearanceProfile" | "userAppearancePreference"
>;
type AppearanceField =
  | "brandName"
  | "brandLogoUrl"
  | "faviconUrl"
  | "themeColor"
  | "adminCornerRadius"
  | "adminContainerRadius"
  | "adminButtonRadius"
  | "adminInputRadius";
export type LegacyTenantAppearanceReader = (tenantId: string) => Promise<
  | {
      [Field in AppearanceField]?: TenantAppearanceProfile[Field] | null;
    }
  | null
>;

export const PLATFORM_APPEARANCE_DATA_STORE = Symbol("platform.appearance.data-store");
export const LEGACY_TENANT_APPEARANCE_READER = Symbol("platform.appearance.legacy-reader");
