/** 商业配置沿原 Rental HTTP，价格、版本、券预算和容量由服务端裁定。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  CancelRentalPriceAdjustmentRequest,
  CreateRentalPriceAdjustmentRequest,
  RentalCouponTemplate,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalPriceAdjustmentPlan,
  RentalPriceAdjustmentPreviewRow,
  RentalPriceVersion,
  RentalPricingGroup,
  RentalRuleVersion,
  RentalServiceCapacity,
  RentalValueAddedService,
  RestoreRentalPriceVersionRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalDiscountPlanRequest,
  SaveRentalPricingGroupRequest,
  SaveRentalServiceCapacityRequest,
  SaveRentalValueAddedServiceRequest,
  UpdateRentalPricingGroupSecurityRatesRequest,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
import { createRentalCatalogApi, type RentalCatalogImageRequest } from "../catalog/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;
const readOptions = (options?: ReadOptions) => (options?.signal ? { signal: options.signal } : undefined);

export function createRentalCommercialApi(
  request: AdminRuntime["request"],
  requestImage: RentalCatalogImageRequest,
) {
  const orders = createRentalOrderApi(request);
  const catalog = createRentalCatalogApi(request, requestImage);
  return {
    profile: orders.profile,
    businessSettings: orders.businessSettings,
    itemGroups: orders.itemGroups,
    pricingGroups: orders.pricingGroups,
    locations: orders.locations,
    pricingPlans: orders.pricingPlans,
    discountPlans: orders.discountPlans,
    valueAddedServices: orders.valueAddedServices,
    customerCoupons: orders.customerCoupons,
    itemGroupImageBlob: catalog.itemGroupImageBlob,
    ruleVersions: (options?: ReadOptions) =>
      request<RentalRuleVersion[]>("/rental/v1/rule-versions", readOptions(options)),
    couponTemplates: (options?: ReadOptions) =>
      request<RentalCouponTemplate[]>("/rental/v1/coupon-templates", readOptions(options)),
    priceAdjustments: (options?: ReadOptions) =>
      request<RentalPriceAdjustmentPlan[]>("/rental/v1/pricing-adjustments", readOptions(options)),
    priceVersions: (page?: number, pageSize?: number, options?: ReadOptions) =>
      request<{ total: number; rows: Array<RentalPriceVersion & { rateCount: number }> }>(
        "/rental/v1/pricing-versions",
        {
          params: { page, pageSize },
          ...readOptions(options),
        },
      ),
    priceVersion: (sequence: number, options?: ReadOptions) =>
      request<RentalPriceVersion>(`/rental/v1/pricing-versions/${sequence}`, readOptions(options)),
    serviceCapacities: (serviceId?: string, options?: ReadOptions) =>
      request<RentalServiceCapacity[]>(
        `/rental/v1/service-capacities${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ""}`,
        readOptions(options),
      ),
    savePricingGroup: (data: SaveRentalPricingGroupRequest) =>
      request<RentalPricingGroup>(
        data.id ? `/rental/v1/pricing-groups/${data.id}` : "/rental/v1/pricing-groups",
        { method: data.id ? "put" : "post", data },
      ),
    updatePricingGroupSecurityRates: (id: string, data: UpdateRentalPricingGroupSecurityRatesRequest) =>
      request<{
        id: string;
        sequence: number;
        version: string;
        effectiveFrom: string;
        changeReason?: string;
      }>(`/rental/v1/pricing-groups/${id}/security-rates`, { method: "patch", data }),
    createPriceAdjustment: (data: CreateRentalPriceAdjustmentRequest) =>
      request<{
        id: string;
        code: string;
        name: string;
        status: string;
        preview: RentalPriceAdjustmentPreviewRow[];
      }>("/rental/v1/pricing-adjustments", { method: "post", data }),
    confirmPriceAdjustment: (adjustmentId: string) =>
      request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/confirm`, { method: "post" }),
    cancelPriceAdjustment: (adjustmentId: string, data: CancelRentalPriceAdjustmentRequest) =>
      request<unknown>(`/rental/v1/pricing-adjustments/${adjustmentId}/cancel`, { method: "post", data }),
    restorePriceVersion: (sequence: number, data: RestoreRentalPriceVersionRequest) =>
      request<{ id: string; sequence: number; version: string; restoredFromVersion: string }>(
        `/rental/v1/pricing-versions/${sequence}/restore`,
        { method: "post", data },
      ),
    saveDiscountPlan: (data: SaveRentalDiscountPlanRequest) =>
      request<RentalDiscountPlan>(
        data.id ? `/rental/v1/discount-plans/${data.id}` : "/rental/v1/discount-plans",
        { method: data.id ? "put" : "post", data },
      ),
    saveValueAddedService: (data: SaveRentalValueAddedServiceRequest) =>
      request<RentalValueAddedService>(
        data.id ? `/rental/v1/value-added-services/${data.id}` : "/rental/v1/value-added-services",
        { method: data.id ? "put" : "post", data },
      ),
    saveServiceCapacity: (data: SaveRentalServiceCapacityRequest) =>
      request<RentalServiceCapacity>(
        data.id ? `/rental/v1/service-capacities/${data.id}` : "/rental/v1/service-capacities",
        { method: data.id ? "put" : "post", data },
      ),
    saveCouponTemplate: (data: SaveRentalCouponTemplateRequest) =>
      request<RentalCouponTemplate>(
        data.id ? `/rental/v1/coupon-templates/${data.id}` : "/rental/v1/coupon-templates",
        { method: data.id ? "put" : "post", data },
      ),
    claimCoupon: (templateId: string, customerId: string) =>
      request<RentalCustomerCoupon>("/rental/v1/customer-coupons/claim", {
        method: "post",
        data: { templateId, customerId },
      }),
    voidCustomerCoupon: (id: string, reason: string) =>
      request<RentalCustomerCoupon>(`/rental/v1/customer-coupons/${id}/void`, {
        method: "post",
        data: { reason },
      }),
  };
}

export type RentalCommercialApi = ReturnType<typeof createRentalCommercialApi>;
