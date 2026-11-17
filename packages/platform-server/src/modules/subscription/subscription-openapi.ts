/** 公共订阅完整请求/响应资料。字段按唯一合同核对，原API与无Core宿主消费同一schema。 */
import { FeatureEntitlementSource, FeatureOwnership, FeatureReleaseStatus, SubscriptionPlan, SubscriptionReminderStage,
  SubscriptionRequestStatus, SubscriptionRequestType, SubscriptionServiceStatus, SubscriptionSource,
  SUBSCRIPTION_CATEGORY_CODE_PATTERN, type ProvisionSubscriptionRequest, type RenewSubscriptionRequest,
  type UpgradeSubscriptionProRequest, type ExtendSubscriptionRequest, type ScheduleNextSubscriptionRequest,
  type SubmitSubscriptionRequestRequest, type HandleSubscriptionRequestRequest, type GrantTenantFeatureRequest,
  type RevokeTenantFeatureRequest, type UpsertFeatureCatalogRequest, type SetStandardPriceRequest,
  type TenantSubscriptionOverview, type SubscriptionRequestRecord, type SubscriptionExpiryReminder,
  type SubscriptionFeatureEntitlement, type SubscriptionFeatureCatalogEntry, type StandardPlanPricing,
  type SubscriptionChangeLogEntry, type SubscriptionMoney, type TenantSubscriptionView } from "@rental-os/platform-contracts/subscription";

type Schema = { [field: string]: unknown };
const string: Schema = { type: "string" }, boolean: Schema = { type: "boolean" };
const date: Schema = { type: "string", format: "date-time" };
const revision: Schema = { type: "integer", minimum: 0 };
const object = (properties: Record<string, Schema>, required: string[] = []): Schema =>
  ({ type: "object", properties, required, additionalProperties: false });
const enumeration = (values: Record<string, string>): Schema => ({ type: "string", enum: Object.values(values) });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/Subscription.${name}` });
const array = (name: string): Schema => ({ type: "array", items: ref(name) });
const categories: Schema = { type: "array", maxItems: 100, uniqueItems: true,
  items: { type: "string", pattern: SUBSCRIPTION_CATEGORY_CODE_PATTERN.source } };
const money: Schema = { type: "number", exclusiveMinimum: true, minimum: 0, maximum: 9999999999.99, multipleOf: 0.01 };
const currency: Schema = { type: "string", pattern: "^[A-Za-z]{3}$" };
const source = enumeration(SubscriptionSource), plan = enumeration(SubscriptionPlan);
const requiredText: Schema = { type: "string", pattern: "\\S", maxLength: 512 };
const term = { serviceYears: { type: "integer", minimum: 1, maximum: 100 }, endAt: {
  oneOf: [{ type: "string", format: "date" }, { type: "string", format: "date-time" }],
  description: "明确时点或服务时区的截止日期，日期可使用至当日结束。" } };
const billing = { amount: money, currency, taxInclusive: boolean, reason: { ...string, maxLength: 512 }, expectedRevision: revision,
  requestId: { ...string, pattern: "\\S", maxLength: 191 }, note: { ...string, maxLength: 2000 }, priceVersion: { ...string, pattern: "\\S", maxLength: 64 } };
const termChoice = { oneOf: [{ required: ["serviceYears"] }, { required: ["endAt"] }] };

export const SUBSCRIPTION_OPENAPI_QUERY_SCHEMAS: Record<string, Schema> = {
  plan, serviceStatus: enumeration(SubscriptionServiceStatus), dueWithin: { type: "integer", minimum: 0, maximum: 36500 },
  keyword: string, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 }
};

export const SUBSCRIPTION_OPENAPI_SCHEMAS = {
  "Subscription.Money": object({ amount: money, currency, taxInclusive: boolean } satisfies Record<keyof SubscriptionMoney, Schema>, ["amount", "currency"]),
  "Subscription.Overview": object({ tenantId: string, tenantName: string, tenantCode: string, plan, serviceStatus: enumeration(SubscriptionServiceStatus), source,
    startAt: date, endAt: date, timeZone: string, currentAmount: { ...ref("Money"), nullable: true }, handledAt: date, anniversaryAnchor: date, revision,
    next: object({ plan, effectiveAt: date, endAt: date }, ["plan"])
  } satisfies Record<keyof TenantSubscriptionOverview, Schema>, ["tenantId", "tenantName", "tenantCode", "plan", "serviceStatus", "revision"]),
  "Subscription.Feature": object({ code: string, name: string, module: string, categories, defaultOwnership: enumeration(FeatureOwnership),
    currentOwnership: enumeration(FeatureOwnership), releaseStatus: enumeration(FeatureReleaseStatus), valueText: string,
    prerequisiteText: string, externalFeeNote: string, contentVersion: string
  } satisfies Record<keyof SubscriptionFeatureCatalogEntry, Schema>, ["code", "name", "module", "categories", "defaultOwnership", "currentOwnership", "releaseStatus"]),
  "Subscription.Entitlement": object({ code: string, name: string, module: string, categories, defaultOwnership: enumeration(FeatureOwnership),
    currentOwnership: enumeration(FeatureOwnership), releaseStatus: enumeration(FeatureReleaseStatus), source: enumeration(FeatureEntitlementSource),
    hasTenantGrant: boolean, available: boolean, needsConfig: boolean, valueText: string, externalFeeNote: string
  } satisfies Record<keyof SubscriptionFeatureEntitlement, Schema>, ["code", "name", "module", "categories", "defaultOwnership", "currentOwnership", "releaseStatus", "source", "available"]),
  "Subscription.Price": object({ plan, annualFee: { ...ref("Money"), nullable: true }, published: boolean, priceVersion: string, note: string
  } satisfies Record<keyof StandardPlanPricing, Schema>, ["plan", "published"]),
  "Subscription.RequestRecord": object({ id: string, type: enumeration(SubscriptionRequestType), targetPlan: plan, submittedBy: string,
    submittedAt: date, status: enumeration(SubscriptionRequestStatus), handledAmount: { ...ref("Money"), nullable: true }, periodText: string,
    reason: string, contactName: string, contactPhone: string, moduleIntent: categories, note: string, linkedEventId: string,
    timeline: { type: "array", items: object({ at: date, status: enumeration(SubscriptionRequestStatus), note: string }, ["at", "status"]) }
  } satisfies Record<keyof SubscriptionRequestRecord, Schema>, ["id", "type", "status"]),
  "Subscription.Reminder": object({ revision, timeZone: string, plan, serviceStatus: enumeration(SubscriptionServiceStatus), endAt: date,
    remainingDays: { type: "integer" }, stage: enumeration(SubscriptionReminderStage), message: string, hasOpenRequest: boolean
  } satisfies Record<keyof SubscriptionExpiryReminder, Schema>, ["revision", "plan", "serviceStatus", "stage", "hasOpenRequest"]),
  "Subscription.ChangeLog": object({ internalNote: { ...string, description: "仅SaaS内部详情返回。" }, id: string, action: string, effectiveAt: date,
    beforeText: string, afterText: string, reason: string, operatedAt: date
  } satisfies Record<keyof SubscriptionChangeLogEntry, Schema>, ["id", "action"]),
  "Subscription.TenantView": object({ overview: ref("Overview"), entitlements: array("Entitlement"), standardPricing: array("Price"),
    requests: array("RequestRecord"), changeLog: array("ChangeLog"), reminder: ref("Reminder")
  } satisfies Record<keyof TenantSubscriptionView, Schema>, ["overview", "entitlements", "standardPricing", "requests", "changeLog", "reminder"]),
  "Subscription.Page": object({ items: array("Overview"), total: { type: "integer", minimum: 0 }, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1, maximum: 100 } }, ["items", "total", "page", "pageSize"]),
  "Subscription.CategoryLabels": { type: "array", items: object({ code: { ...string, pattern: SUBSCRIPTION_CATEGORY_CODE_PATTERN.source }, name: { ...string, maxLength: 100 } }, ["code", "name"]) },
  "Subscription.Catalog": array("Feature"), "Subscription.Prices": array("Price"), "Subscription.Void": { nullable: true, description: "成功无业务响应正文。" },
  "Subscription.Provision": { ...object({ plan, source, startAt: date, ...term, timeZone: string, ...billing } satisfies Record<keyof ProvisionSubscriptionRequest, Schema>, ["plan", "source", "startAt", "expectedRevision"]), ...termChoice },
  "Subscription.Renew": { ...object({ plan, source, startAt: date, ...term, ...billing } satisfies Record<keyof RenewSubscriptionRequest, Schema>, ["plan", "source", "expectedRevision"]), ...termChoice },
  "Subscription.Upgrade": object({ source, ...billing } satisfies Record<keyof UpgradeSubscriptionProRequest, Schema>, ["source", "expectedRevision"]),
  "Subscription.Extend": object({ endAt: term.endAt, reason: requiredText, expectedRevision: revision } satisfies Record<keyof ExtendSubscriptionRequest, Schema>, ["endAt", "reason", "expectedRevision"]),
  "Subscription.ScheduleNext": { ...object({ plan, source, effectiveAt: date, ...term, ...billing } satisfies Record<keyof ScheduleNextSubscriptionRequest, Schema>, ["plan", "source", "effectiveAt", "expectedRevision"]), ...termChoice },
  "Subscription.SubmitRequest": object({ type: enumeration(SubscriptionRequestType), targetPlan: plan, moduleIntent: categories,
    contactName: { ...string, maxLength: 120 }, contactPhone: { ...string, maxLength: 32 }, note: { ...string, maxLength: 2000 },
    dedupeKey: { ...string, pattern: "\\S", maxLength: 191 }
  } satisfies Record<keyof SubmitSubscriptionRequestRequest, Schema>, ["type", "dedupeKey"]),
  "Subscription.HandleRequest": object({ expectedRevision: revision,
    status: { type: "string", enum: [SubscriptionRequestStatus.Processed, SubscriptionRequestStatus.Rejected] },
    publicReason: requiredText, note: { ...string, maxLength: 2000 }
  } satisfies Record<keyof HandleSubscriptionRequestRequest, Schema>, ["expectedRevision", "status", "publicReason"]),
  "Subscription.GrantFeature": object({ expectedRevision: revision, featureCode: { ...string, minLength: 1, maxLength: 191 }, reason: requiredText
  } satisfies Record<keyof GrantTenantFeatureRequest, Schema>, ["expectedRevision", "featureCode", "reason"]),
  "Subscription.RevokeFeature": object({ expectedRevision: revision, featureCode: { ...string, minLength: 1, maxLength: 191 }, reason: requiredText
  } satisfies Record<keyof RevokeTenantFeatureRequest, Schema>, ["expectedRevision", "featureCode", "reason"]),
  "Subscription.UpsertCatalog": object({ code: { ...string, minLength: 1, maxLength: 191 }, name: { ...string, minLength: 1, maxLength: 191 }, module: { ...string, minLength: 1, maxLength: 191 }, categories,
    defaultOwnership: enumeration(FeatureOwnership), currentOwnership: enumeration(FeatureOwnership), releaseStatus: enumeration(FeatureReleaseStatus),
    valueText: string, prerequisiteText: string, externalFeeNote: string, contentVersion: { ...string, maxLength: 64 }, reason: { ...string, maxLength: 512 }
  } satisfies Record<keyof UpsertFeatureCatalogRequest, Schema>, ["code", "name", "module", "categories", "defaultOwnership", "currentOwnership", "releaseStatus"]),
  "Subscription.SetPrice": object({ expectedPriceVersion: { ...string, nullable: true, maxLength: 64 }, plan, annualFee: money, currency,
    taxInclusive: boolean, published: boolean, priceVersion: { ...string, maxLength: 64 }, note: { ...string, maxLength: 2000 }
  } satisfies Record<keyof SetStandardPriceRequest, Schema>, ["plan", "published"])
} satisfies Record<string, Schema>;
