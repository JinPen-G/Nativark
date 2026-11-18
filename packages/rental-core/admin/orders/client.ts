/** Rental 订单及直接配货、资金、检查和单据请求复用宿主唯一 HTTP，业务裁定与原键沿服务端契约。 */
import type {
  AdjustRentalInspectionExceptionRequest,
  BookingMemberOption,
  CustomerMembershipBookingOption,
  CustomerProfileAddress,
  CreateRentalOrderRequest,
  ApplyRentalOrderChangeRequest,
  CorrectRentalInspectionUsageRequest,
  CreateRentalCarrierShipmentEventRequest,
  CreateRentalInspectionRequest,
  InitiateRentalFundingRequest,
  ManageRentalAllocationRequest,
  PartialReturnRentalOrderRequest,
  PreviewRentalOrderChangeRequest,
  RecordRentalInspectionExceptionCustomerResponseRequest,
  RefundRentalServiceRequest,
  RentalAllocationCandidates,
  RentalCarrierShipmentEvent,
  RentalDeliveryAddressSnapshot,
  RentalDocumentRenderResult,
  RentalDocumentSnapshotSummary,
  RentalDocumentType,
  RentalCustomerCoupon,
  RentalDiscountPlan,
  RentalFulfillmentLocation,
  RentalFundingAmountRequest,
  RentalFundingBalance,
  RentalFundingEvent,
  RentalFundingFailureRequest,
  RentalFundingReleaseRequest,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalItemGroup,
  RentalOrder,
  RentalOrderChange,
  RentalOrderChangePreview,
  RentalOrderExtension,
  RentalOrderExtensionPreview,
  RentalOrderExtensionRequest,
  RentalOrderListQuery,
  RentalOrderPage,
  RentalOrderServiceOccurrence,
  RentalPricingGroup,
  RentalPricingPlanV1,
  RentalQuoteRequest,
  RentalQuoteSnapshotV1,
  RentalServiceExecutionReceipt,
  RentalValueAddedService,
  ReviewRentalInspectionExceptionRequest,
  ReviewRentalOrderFeeReviewRequest,
  SubstituteRentalBundleComponentRequest,
  TenantRentalBusinessSettings,
  TenantRentalProfile,
  UpdateRentalServiceOccurrenceRequest
} from "@rental-os/rental-core";
import type { FileDownloadUrlSummary, FileUploadSessionSummary } from "@rental-os/platform-contracts";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createRentalWorkOrderApi } from "../work-orders/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;

/** QueryFunction 的上下文也可直接传入，HTTP 仅接收支持的取消信号。 */
function readOptions(options?: ReadOptions): ReadOptions | undefined {
  return options?.signal ? { signal: options.signal } : undefined;
}

export function createRentalOrderApi(request: AdminRuntime["request"]) {
  const { workOrders, stockDispositions } = createRentalWorkOrderApi(request);
  return {
    workOrders,
    stockDispositions,
    profile: (options?: ReadOptions) => request<TenantRentalProfile>("/rental/v1/tenant-profile", readOptions(options)),
    businessSettings: (options?: ReadOptions) => request<TenantRentalBusinessSettings>("/rental/v1/business-settings", readOptions(options)),
    bookingMembers: (options?: ReadOptions) => request<BookingMemberOption[]>("/rental/v1/booking-members", readOptions(options)),
    bookingOptions: (customerId: string, options?: ReadOptions) => request<CustomerMembershipBookingOption[]>(
      `/rental/v1/booking-members/${encodeURIComponent(customerId)}/booking-options`, readOptions(options)),
    bookingDeliveryAddresses: (customerId: string, options?: ReadOptions) => request<CustomerProfileAddress[]>(
      `/rental/v1/booking-members/${encodeURIComponent(customerId)}/delivery-addresses`, readOptions(options)),
    locations: (options?: ReadOptions) => request<RentalFulfillmentLocation[]>("/rental/v1/locations", readOptions(options)),
    pricingPlans: (options?: ReadOptions) => request<RentalPricingPlanV1[]>("/rental/v1/pricing-plans", readOptions(options)),
    discountPlans: (options?: ReadOptions) => request<RentalDiscountPlan[]>("/rental/v1/discount-plans", readOptions(options)),
    valueAddedServices: (options?: ReadOptions) => request<RentalValueAddedService[]>("/rental/v1/value-added-services", readOptions(options)),
    customerCoupons: (customerId?: string, options?: ReadOptions) => request<RentalCustomerCoupon[]>("/rental/v1/customer-coupons", {
      ...readOptions(options), params: { customerId }
    }),
    createQuote: (data: RentalQuoteRequest) => request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "post", data }),
    createOrder: (data: CreateRentalOrderRequest) => request<RentalOrder>("/rental/v1/orders", { method: "post", data }),
    itemGroups: (options?: ReadOptions) => request<RentalItemGroup[]>("/rental/v1/item-groups", readOptions(options)),
    pricingGroups: (options?: ReadOptions) => request<RentalPricingGroup[]>("/rental/v1/pricing-groups", readOptions(options)),
    /** Same server filters/sort and session scope, without pagination; never reuse the visible page as an export. */
orderExportRows: ({ status, keyword, from, to, assignment, pendingFeeOnly, sort }: Omit<RentalOrderListQuery, "page" | "pageSize">, options?: ReadOptions) => request<RentalOrder[]>("/rental/v1/orders", {
    ...readOptions(options),
    params: { status, keyword, from, to, assignment, pendingFeeOnly, sort }
}),
    /**
 * ORDER-LIST-01：服务端筛选 + 分页。始终带 `page`，服务端据此返回分页信封
 * 而不是兼容用的纯数组；空间不传，取会话。
 */
orderPage: (params: RentalOrderListQuery = {}, options?: ReadOptions) => request<RentalOrderPage>("/rental/v1/orders", {
    ...readOptions(options),
    params: { ...params, page: params.page ?? 1 }
}),
    order: (id: string, options?: ReadOptions) => request<RentalOrder>(`/rental/v1/orders/${id}`, readOptions(options)),
    carrierShipmentEvents: (id: string, options?: ReadOptions) => request<RentalCarrierShipmentEvent[]>(`/rental/v1/orders/${id}/carrier-shipment/events`, readOptions(options)),
    createCarrierShipmentEvent: (id: string, data: CreateRentalCarrierShipmentEventRequest, idempotencyKey: string) => request<RentalCarrierShipmentEvent>(
    `/rental/v1/orders/${id}/carrier-shipment/events`, { method: "post", data, headers: { "Idempotency-Key": idempotencyKey } }
  ),
    createCarrierEvidenceUploadSession: (id: string, data: { fileName: string; mimeType: string; sizeBytes: number; idempotencyKey: string }) =>
    request<FileUploadSessionSummary>(`/files/rental-orders/${id}/carrier-evidence/upload-sessions`, { method: "post", data }),
    completeCarrierEvidenceUpload: (id: string, sessionId: string) =>
    request<{ id: string; mimeType: string }>(`/files/rental-orders/${id}/carrier-evidence/upload-sessions/${sessionId}/complete`, { method: "post", data: {} }),
    carrierEvidenceDownloadUrl: (id: string, fileAssetId: string, options?: ReadOptions) => request<FileDownloadUrlSummary>(`/files/rental-orders/${id}/carrier-evidence/${fileAssetId}/download-url`, readOptions(options)),
    revealOrderDeliveryAddress: (id: string, options?: ReadOptions) => request<RentalDeliveryAddressSnapshot>(`/rental/v1/orders/${id}/delivery-address/reveal`, readOptions(options)),
    fundingEvents: (id: string, options?: ReadOptions) => request<RentalFundingBalance>(`/rental/v1/orders/${id}/funding-events`, readOptions(options)),
    initiateFunding: (id: string, data: InitiateRentalFundingRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/initiate`, { method: "post", data }),
    appendFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/append`, { method: "post", data }),
    captureFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/capture`, { method: "post", data }),
    refundFunding: (id: string, data: RentalFundingAmountRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/refund`, { method: "post", data }),
    releaseFunding: (id: string, data: RentalFundingReleaseRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/release`, { method: "post", data }),
    failFunding: (id: string, data: RentalFundingFailureRequest) => request<RentalFundingEvent>(`/rental/v1/orders/${id}/funding-events/fail`, { method: "post", data }),
    expirePendingOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/expire-pending`, { method: "post" }),
    markPickupOverdue: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/mark-pickup-overdue`, { method: "post" }),
    sendNoShowNotice: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/no-show-notice`, { method: "post" }),
    confirmNoShow: (id: string, data: { reason: string }) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm-no-show`, { method: "post", data }),
    resumePickup: (id: string, data: { reason: string }) => request<RentalOrder>(`/rental/v1/orders/${id}/resume-pickup`, { method: "post", data }),
    confirmOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm`, { method: "post" }),
    allocateOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/allocate`, { method: "post" }),
    allocationCandidates: (id: string, exchange?: {
    exchangeOrderLineId: string;
    replacementItemGroupId: string;
}, options?: ReadOptions) => request<RentalAllocationCandidates>(`/rental/v1/orders/${id}/allocation-candidates${exchange ? `?exchangeOrderLineId=${encodeURIComponent(exchange.exchangeOrderLineId)}&replacementItemGroupId=${encodeURIComponent(exchange.replacementItemGroupId)}` : ""}`, readOptions(options)),
    manageAllocations: (id: string, data: ManageRentalAllocationRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/assignments`, { method: "post", data }),
    operationLock: (id: string, action: "acquire" | "release", token?: string) => request<{ token?: string; expiresAt?: string }>(`/rental/v1/orders/${id}/operation-lock`, { method: "post", data: { action, token } }),
    substituteBundleComponent: (id: string, data: SubstituteRentalBundleComponentRequest) => request<RentalOrder>(`/rental/v1/orders/${id}/substitute-bundle-component`, { method: "post", data }),
    orderDocument: (id: string, type: RentalDocumentType, options?: ReadOptions) => request<RentalDocumentRenderResult>(`/rental/v1/orders/${id}/documents/${type}`, readOptions(options)),
    orderDocumentVersions: (id: string, type: RentalDocumentType, options?: ReadOptions) => request<RentalDocumentSnapshotSummary[]>(`/rental/v1/orders/${id}/documents/${type}/versions`, readOptions(options)),
    orderDocumentVersion: (id: string, type: RentalDocumentType, snapshotId: string, options?: ReadOptions) => request<RentalDocumentRenderResult>(`/rental/v1/orders/${id}/documents/${type}/versions/${encodeURIComponent(snapshotId)}`, readOptions(options)),
    partialReturnOrder: (id: string, data: PartialReturnRentalOrderRequest, token?: string) => request<RentalOrder>(`/rental/v1/orders/${id}/partial-return`, { method: "post", data, headers: token ? { "X-Operation-Token": token } : undefined }),
    cancelOrder: (id: string, data: { reason: string; weatherException?: boolean }) => request<RentalOrder>(`/rental/v1/orders/${id}/cancel`, { method: "post", data }),
    handoverOrder: (id: string, stage: "pickup" | "return", token?: string) => request<RentalOrder>(`/rental/v1/orders/${id}/handover/${stage}`, { method: "post", headers: token ? { "X-Operation-Token": token } : undefined }),
    settleOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/settle`, { method: "post" }),
    // 续租 / 延期（需求 4.6.9）。试算与申请分两步：金额要先给客户/运营确认，
// 确认后才落记录；企业月结的申请直接生效，个人还要再走一次补款。
orderExtensions: (id: string, options?: ReadOptions) => request<RentalOrderExtension[]>(`/rental/v1/orders/${id}/extensions`, readOptions(options)),
    orderChanges: (id: string, options?: ReadOptions) => request<RentalOrderChange[]>(`/rental/v1/orders/${id}/changes`, readOptions(options)),
    previewPartialLineCancellation: (id: string, data: PreviewRentalOrderChangeRequest) =>
    request<RentalOrderChangePreview>(`/rental/v1/orders/${id}/changes/partial-cancel/preview`, { method: "post", data }),
    applyPartialLineCancellation: (id: string, data: ApplyRentalOrderChangeRequest) =>
    request<{ order: RentalOrder; change: RentalOrderChange }>(`/rental/v1/orders/${id}/changes/partial-cancel`, { method: "post", data }),
    exchangeServiceOptions: (id: string, options?: ReadOptions) => request<RentalValueAddedService[]>(`/rental/v1/orders/${id}/changes/post-pickup-exchange/services`, readOptions(options)),
    previewPostPickupExchange: (id: string, data: PreviewRentalOrderChangeRequest) =>
    request<RentalOrderChangePreview>(`/rental/v1/orders/${id}/changes/post-pickup-exchange/preview`, { method: "post", data }),
    applyPostPickupExchange: (id: string, data: ApplyRentalOrderChangeRequest) =>
    request<{ order: RentalOrder; change: RentalOrderChange }>(`/rental/v1/orders/${id}/changes/post-pickup-exchange`, { method: "post", data }),
    previewOrderExtension: (id: string, data: RentalOrderExtensionRequest) =>
    request<RentalOrderExtensionPreview>(`/rental/v1/orders/${id}/extensions/preview`, { method: "post", data }),
    requestOrderExtension: (id: string, data: RentalOrderExtensionRequest) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions`, { method: "post", data }),
    payOrderExtension: (id: string, extensionId: string) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions/${extensionId}/pay`, { method: "post" }),
    reviewExtensionRefund: (id: string, extensionId: string, data: { decision: "approved" | "rejected"; reason: string }) =>
    request<{ order: RentalOrder; extension: RentalOrderExtension }>(`/rental/v1/orders/${id}/extensions/${extensionId}/refund-review`, { method: "post", data }),
    reviewOrderFeeReview: (id: string, reviewId: string, data: ReviewRentalOrderFeeReviewRequest) =>
    request<RentalOrder>(`/rental/v1/orders/${id}/fee-reviews/${reviewId}/review`, { method: "post", data }),
    updateServiceOccurrence: (id: string, occurrenceId: string, data: UpdateRentalServiceOccurrenceRequest, idempotencyKey?: string) =>
    request<{ order: RentalOrder; occurrence: RentalOrderServiceOccurrence }>(`/rental/v1/orders/${id}/services/${encodeURIComponent(occurrenceId)}/execution`, { method: "post", data,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }),
    serviceExecutionReceipt: (id: string, occurrenceId: string, idempotencyKey: string, options?: ReadOptions) => request<RentalServiceExecutionReceipt>(`/rental/v1/orders/${id}/services/${encodeURIComponent(occurrenceId)}/execution-receipt`, {
    ...readOptions(options),
    headers: { "Idempotency-Key": idempotencyKey }
}),
    refundServiceOccurrence: (id: string, occurrenceId: string, data: RefundRentalServiceRequest) =>
    request<{ order: RentalOrder; occurrence: RentalOrderServiceOccurrence }>(`/rental/v1/orders/${id}/services/${encodeURIComponent(occurrenceId)}/refund`, { method: "post", data }),
    inspectionTemplates: (stage?: "pickup" | "return", orderId?: string, options?: ReadOptions) => request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", {
    ...readOptions(options),
    params: { stage, orderId }
}),
    inspections: (id: string, options?: ReadOptions) => request<RentalInspectionRecord[]>(`/rental/v1/orders/${id}/inspections`, readOptions(options)),
    createInspection: (id: string, data: CreateRentalInspectionRequest, token?: string) => request<{ inspection: RentalInspectionRecord; order: RentalOrder }>(`/rental/v1/orders/${id}/inspections`, { method: "post", data, headers: token ? { "X-Operation-Token": token } : undefined }),
    correctInspectionUsage: (id: string, inspectionId: string, data: CorrectRentalInspectionUsageRequest) => request<{ inspection: RentalInspectionRecord }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/usage-correction`, { method: "post", data }),
    reviewInspectionException: (id: string, inspectionId: string, exceptionIndex: number, data: ReviewRentalInspectionExceptionRequest) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/review`, { method: "post", data }),
    reReviewInspectionException: (id: string, inspectionId: string, exceptionIndex: number, data: AdjustRentalInspectionExceptionRequest, idempotencyKey?: string) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/re-review`, { method: "post", data, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined }),
    recordInspectionExceptionCustomerResponse: (id: string, inspectionId: string, exceptionIndex: number, data: RecordRentalInspectionExceptionCustomerResponseRequest, idempotencyKey?: string) => request<{ order: RentalOrder }>(`/rental/v1/orders/${id}/inspections/${inspectionId}/exceptions/${exceptionIndex}/customer-response`, { method: "post", data, headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined })
  };
}

export type RentalOrderApi = ReturnType<typeof createRentalOrderApi>;
