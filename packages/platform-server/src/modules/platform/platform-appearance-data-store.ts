/** 外观设置的私有持久化边界；旧客户端品牌仅由组合宿主显式提供兼容读取。 */
import type { TenantAppearanceProfile } from "@rental-os/platform-contracts";

export interface StoredTenantAppearance {
  revision: number; brandName: string | null; brandLogoUrl: string | null; faviconUrl: string | null;
  themeColor: string | null; adminCornerRadius: number | null; adminContainerRadius: number | null;
  adminButtonRadius: number | null; adminInputRadius: number | null; updatedAt: Date;
}
type AppearanceWrite = Partial<Omit<StoredTenantAppearance, "revision" | "updatedAt">>;
export interface PlatformAppearanceDataStore {
  tenantAppearanceProfile: {
    findUnique(query: { where: { tenantId: string } }): PromiseLike<StoredTenantAppearance | null>;
    update(query: { where: { tenantId: string; revision: number }; data: AppearanceWrite & { revision: { increment: number } } }): PromiseLike<StoredTenantAppearance>;
    create(query: { data: AppearanceWrite & { tenantId: string } }): PromiseLike<StoredTenantAppearance>;
  };
  userAppearancePreference: {
    findUnique(query: { where: { userId: string }; select?: { themeColor: true } }): PromiseLike<{ themeColor: string | null; updatedAt?: Date } | null>;
    upsert(query: { where: { userId: string }; update: { themeColor: string | null };
      create: { userId: string; themeColor: string | null } }): PromiseLike<{ themeColor: string | null; updatedAt: Date }>;
  };
}
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
