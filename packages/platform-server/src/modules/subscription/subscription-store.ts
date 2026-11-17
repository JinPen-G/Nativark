/** 订阅私有存储与宿主参加者。只访问公共订阅表和租户父锁，行业目录由宿主在原事务中校验。 */
import type { FeatureOwnership, FeatureReleaseStatus, SubscriptionPlan, SubscriptionRequestStatus,
  SubscriptionRequestType, SubscriptionSource, SubscriptionCategoryLabel } from "@rental-os/platform-contracts/subscription";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";

export type StoredSubscriptionPlan = Uppercase<SubscriptionPlan>;
export type StoredSubscriptionSource = Uppercase<SubscriptionSource>;
export type StoredFeatureOwnership = Uppercase<FeatureOwnership>;
export type StoredFeatureRelease = Uppercase<FeatureReleaseStatus>;
export type StoredSubscriptionRequestType = Uppercase<SubscriptionRequestType>;
type StoredRequestStatus = Uppercase<SubscriptionRequestStatus>;
type StoredSegmentStatus = "CURRENT" | "SCHEDULED" | "HISTORICAL";
export type StoredSubscriptionEventType = "PROVISION" | "UPGRADE" | "RENEW" | "DOWNGRADE" | "TEMP_EXTENSION"
  | "TERM_CORRECTION" | "PUBLIC_GRANT" | "PUBLIC_REVOKE" | "TENANT_GRANT" | "TENANT_REVOKE" | "CATALOG_UPDATE" | "PRICE_UPDATE";
export type SubscriptionInputJson = Exclude<PlatformJsonValue, null>;
type StoredAmount = number | string | { d: number[]; e: number; s: number; toFixed(): string };
type Direction = "asc" | "desc";

export interface StoredTenantSubscription {
  id: string; tenantId: string; revision: number; plan: StoredSubscriptionPlan; source: StoredSubscriptionSource;
  startAt: Date | null; endAt: Date | null; serviceTimeZone: string | null; billingAnniversary: Date | null;
  currentAmount: StoredAmount | null; currentCurrency: string | null; currentTaxInclusive: boolean | null;
  sourceReason: string | null; handledAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface StoredSubscriptionSegment {
  id: string; tenantId: string; status: StoredSegmentStatus; plan: StoredSubscriptionPlan; source: StoredSubscriptionSource;
  startAt: Date | null; endAt: Date | null; amount: StoredAmount | null; currency: string | null;
  taxInclusive: boolean | null; billingAnniversary: Date | null; reason: string | null; createdAt: Date;
}
export interface StoredSubscriptionRequest {
  id: string; tenantId: string; type: StoredSubscriptionRequestType; targetPlan: StoredSubscriptionPlan | null;
  status: StoredRequestStatus; contactName: string | null; contactPhone: string | null; moduleIntent: PlatformJsonValue;
  note: string | null; timeline: PlatformJsonValue; publicReason: string | null; dedupeKey: string;
  handledAmount: StoredAmount | null; handledCurrency: string | null; handledTaxInclusive: boolean | null;
  linkedEventId: string | null; periodText: string | null; createdAt: Date; updatedAt: Date;
}
export interface StoredSubscriptionEvent {
  id: string; tenantId: string | null; type: StoredSubscriptionEventType; beforeJson: PlatformJsonValue;
  afterJson: PlatformJsonValue; amount: StoredAmount | null; currency: string | null; handlingNote: string | null;
  reason: string | null; operator: string | null; effectiveAt: Date | null; createdAt: Date;
}
export interface StoredSubscriptionFeature {
  code: string; name: string; module: string; categories: PlatformJsonValue; defaultOwnership: StoredFeatureOwnership;
  currentOwnership: StoredFeatureOwnership; releaseStatus: StoredFeatureRelease; valueText: string | null;
  prerequisiteText: string | null; externalFeeNote: string | null; contentVersion: string | null;
  effectiveAt: Date | null; createdAt: Date; updatedAt: Date;
}
export interface StoredSubscriptionPrice {
  id: string; plan: StoredSubscriptionPlan; annualFee: StoredAmount | null; currency: string | null;
  taxInclusive: boolean | null; published: boolean; priceVersion: string | null; note: string | null; updatedAt: Date;
}
interface StoredFeatureGrant {
  id: string; tenantId: string; featureCode: string; effectiveAt: Date; operator: string | null;
  reason: string | null; revokedAt: Date | null; revokedReason: string | null; createdAt: Date;
}
type TermWrite = Partial<Omit<StoredTenantSubscription, "id" | "tenantId" | "createdAt" | "updatedAt">>;
export type SubscriptionTermMutation = Omit<TermWrite, "revision"> & { revision?: number | { increment: number } };
type SegmentWrite = Partial<Omit<StoredSubscriptionSegment, "id" | "tenantId" | "createdAt">>;
type RequestUnique = { id: string } | { tenantId_dedupeKey: { tenantId: string; dedupeKey: string } };
type RequestWrite = {
  status?: StoredRequestStatus; dedupeKey?: string; linkedEventId?: string; handledAmount?: number | null;
  handledCurrency?: string | null; handledTaxInclusive?: boolean; periodText?: string; publicReason?: string;
  timeline?: SubscriptionInputJson;
};
type FeatureWrite = Omit<StoredSubscriptionFeature, "code" | "createdAt" | "updatedAt" | "categories"> & { categories: string[] };
type PriceWrite = Omit<StoredSubscriptionPrice, "id" | "plan" | "updatedAt" | "annualFee"> & { annualFee: number | null };
type GrantUnique = { tenantId_featureCode: { tenantId: string; featureCode: string } };
type TenantIdentity = { id: string; name: string; code: string };
type TenantState = { subscription: StoredTenantSubscription | null; subscriptionSegments: StoredSubscriptionSegment[] };

/** 与原参数化SQL运行时结构兼容，字段不携带生成模型或全库写入能力。 */
export interface SubscriptionSqlQuery {
  readonly values: unknown[]; readonly strings: string[];
  readonly sql: string; readonly statement: string; readonly text: string;
  inspect(): { sql: string; statement: string; text: string; values: unknown[] };
}
export interface SubscriptionTransaction {
  tenant: {
    findUnique(query: { where: { id: string }; select: {
      id: true; name: true; code: true;
      subscription: true; subscriptionSegments: { where: { status: "SCHEDULED" } }
    } }): PromiseLike<(TenantIdentity & TenantState) | null>;
    findMany(query: { where: { id: { in: string[] } }; include: {
      subscription: true; subscriptionSegments: { where: { status: "SCHEDULED" } }
    }; orderBy: { id: "asc" } }): PromiseLike<Array<TenantIdentity & TenantState>>;
  };
  tenantSubscription: {
    create(query: { data: TermWrite & { tenantId: string; plan: StoredSubscriptionPlan; source: StoredSubscriptionSource } }): PromiseLike<StoredTenantSubscription>;
    findUniqueOrThrow(query: { where: { tenantId: string } }): PromiseLike<StoredTenantSubscription>;
    update(query: { where: { tenantId: string }; data: TermWrite }): PromiseLike<StoredTenantSubscription>;
    updateMany(query: { where: { tenantId: string; revision: number }; data: SubscriptionTermMutation }): PromiseLike<{ count: number }>;
  };
  tenantSubscriptionSegment: {
    create(query: { data: SegmentWrite & { tenantId: string; status: StoredSegmentStatus;
      plan: StoredSubscriptionPlan; source: StoredSubscriptionSource } }): PromiseLike<StoredSubscriptionSegment>;
    update(query: { where: { id: string }; data: SegmentWrite }): PromiseLike<StoredSubscriptionSegment>;
    updateMany(query: { where: { tenantId: string; status?: StoredSegmentStatus;
      OR?: Array<{ status?: StoredSegmentStatus; id?: { in: string[] } }> }; data: SegmentWrite }): PromiseLike<{ count: number }>;
  };
  subscriptionRequest: {
    findUnique(query: { where: RequestUnique }): PromiseLike<StoredSubscriptionRequest | null>;
    findUniqueOrThrow(query: { where: { id: string } }): PromiseLike<StoredSubscriptionRequest>;
    findFirst(query: { where: { tenantId: string; type: StoredSubscriptionRequestType; status: "PENDING" } }): PromiseLike<StoredSubscriptionRequest | null>;
    findMany(query: { where: { tenantId: string; status?: "PENDING" }; orderBy?: { createdAt: Direction } }): PromiseLike<StoredSubscriptionRequest[]>;
    create(query: { data: { tenantId: string; type: StoredSubscriptionRequestType; targetPlan: StoredSubscriptionPlan | null;
      status: "PENDING"; contactName?: string; contactPhone?: string; moduleIntent?: string[]; note?: string;
      dedupeKey: string; timeline: SubscriptionInputJson } }): PromiseLike<StoredSubscriptionRequest>;
    update(query: { where: { id: string }; data: RequestWrite }): PromiseLike<StoredSubscriptionRequest>;
  };
  subscriptionEvent: {
    findMany(query: { where: { tenantId: string }; orderBy: { createdAt: "desc" }; take: number }): PromiseLike<StoredSubscriptionEvent[]>;
    create(query: { data: { tenantId: string | null; type: StoredSubscriptionEventType;
      beforeJson?: SubscriptionInputJson; afterJson?: SubscriptionInputJson; amount: number | null; currency: string | null;
      handlingNote?: string; reason?: string; operator?: string; effectiveAt?: Date } }): PromiseLike<{ id: string }>;
  };
  subscriptionFeatureCatalog: {
    findUnique(query: { where: { code: string } }): PromiseLike<StoredSubscriptionFeature | null>;
    findMany(query: { where?: { code: { in: string[] } }; orderBy: Array<{ module?: "asc"; name?: "asc" }> }): PromiseLike<StoredSubscriptionFeature[]>;
    upsert(query: { where: { code: string }; create: FeatureWrite & { code: string }; update: FeatureWrite }): PromiseLike<StoredSubscriptionFeature>;
  };
  tenantFeatureGrant: {
    findMany(query: { where: { tenantId: string; revokedAt: null; effectiveAt: { lte: Date } } }): PromiseLike<StoredFeatureGrant[]>;
    findUnique(query: { where: GrantUnique }): PromiseLike<StoredFeatureGrant | null>;
    upsert(query: { where: GrantUnique; create: { tenantId: string; featureCode: string; reason?: string; operator?: string };
      update: { revokedAt: null; revokedReason: null; effectiveAt: Date; reason?: string; operator?: string } }): PromiseLike<StoredFeatureGrant>;
    update(query: { where: { id: string }; data: { revokedAt: Date; revokedReason: string } }): PromiseLike<StoredFeatureGrant>;
  };
  subscriptionStandardPrice: {
    findMany(): PromiseLike<StoredSubscriptionPrice[]>;
    findUnique(query: { where: { plan: StoredSubscriptionPlan } }): PromiseLike<StoredSubscriptionPrice | null>;
    findUniqueOrThrow(query: { where: { plan: StoredSubscriptionPlan } }): PromiseLike<StoredSubscriptionPrice>;
    create(query: { data: PriceWrite & { plan: StoredSubscriptionPlan } }): PromiseLike<StoredSubscriptionPrice>;
    updateMany(query: { where: { id: string; updatedAt: Date }; data: PriceWrite }): PromiseLike<{ count: number }>;
  };
  $queryRaw<T = unknown>(query: TemplateStringsArray | SubscriptionSqlQuery, ...values: unknown[]): PromiseLike<T>;
}

export interface SubscriptionDataStore extends SubscriptionTransaction {
  $transaction<T>(work: (transaction: SubscriptionTransaction) => Promise<T>): Promise<T>;
}
export interface SubscriptionCategoryParticipant {
  assertPublished(transaction: SubscriptionTransaction, codes: readonly string[]): Promise<void>;
  labels(tenantId?: string): Promise<SubscriptionCategoryLabel[]>;
}
export const PLATFORM_SUBSCRIPTION_DATA_STORE = Symbol("platform.subscription.data-store");
export const SUBSCRIPTION_CATEGORY_PARTICIPANT = Symbol("platform.subscription.category-participant");
export const SUBSCRIPTION_APPLICATION = Symbol("platform.subscription.application");
