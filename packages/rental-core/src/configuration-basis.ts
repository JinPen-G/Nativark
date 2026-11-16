/** Rental配置读写的共同版本依据，绑定修订不代替授权或业务配置行修订。 */
import type {
  RentalCategoryDefinition, RentalCouponTemplate, RentalFulfillmentLocation, RentalFulfillmentOperator,
  RentalItemGroup, RentalPricingGroup, TenantRentalBusinessSettings, TenantRentalProfile
} from "./contracts";

export interface CategoryWriteBinding { categoryVersionId: string; adoptionRevision: number }

export const RENTAL_READINESS_FACT_LIMIT = 10000;

/** 原报价配置上下文；只描述业务事实，不携带授权、事务或价格计算结果。 */
export interface RentalBusinessContext {
  categoryVersionId?: string;
  categoryAdoptionRevision?: number;
  profile: TenantRentalProfile;
  category: RentalCategoryDefinition;
  settings: TenantRentalBusinessSettings;
  groups: RentalItemGroup[];
  pricingGroups?: RentalPricingGroup[];
  couponTemplates: RentalCouponTemplate[];
  locations: RentalFulfillmentLocation[];
  operators: RentalFulfillmentOperator[];
}

export interface RentalUniqueAttributeClaim {
  fieldCode: string;
  label: string;
  normalizedValue: string;
}

export interface VersionedBusinessSettings {
  settings: TenantRentalBusinessSettings;
  settingsRevision: number;
}
