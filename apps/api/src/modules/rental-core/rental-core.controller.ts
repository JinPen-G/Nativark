import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, Optional, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Prisma } from "@prisma/client";
import {
  RentalCoreOrderStatus,
  type RentalOrderChangePreview,
  type RentalOrderExchangeInspectionSnapshot,
  type RentalOrderExchangeDisposition,
  type RentalOrderExchangePriceBasis,
  type RentalOrderExtension
} from "@rental-os/shared";
import { createHash } from "node:crypto";
import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  CancelRentalOrderRequest,
  RentalAvailabilityRequest,
  RentalMembershipSnapshot,
  RentalOrder,
  SaveRentalAssetRequest,
  SaveRentalCouponTemplateRequest,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  RentalWorkOrderStatus,
  SaveTenantRentalBusinessSettingsRequest,
  SaveTenantRentalProfileRequest,
  RentalWorkspaceReportFilter,
  SystemUserRow,
  CreateRentalCarrierShipmentEventRequest,
  RentalCarrierShipmentEventType
} from "@rental-os/shared";
import {
  SaveRentalFulfillmentLocationDto,
  SaveRentalFulfillmentOperatorDto,
  SaveRentalItemGroupDto,
  SaveRentalPricingGroupDto,
  UpdateRentalPricingGroupSecurityRatesDto,
  AssignRentalWorkOrderDto,
  CancelRentalWorkOrderDto,
  CreateRentalWorkOrderDto,
  ReviewRentalWorkOrderDto,
  SubmitRentalWorkOrderDto,
} from "./rental-core-request.dto";
import {
  CancelRentalOrderDto,
  ManageRentalAllocationDto,
  RentalOperationLockDto,
  CreateRentalOrderInternalNoteDto,
  CreateRentalInspectionDto,
  CorrectRentalInspectionUsageDto,
  CreateRentalOrderDto,
  PartialReturnRentalOrderDto,
  RentalHandoverDto,
  ReviewRentalInspectionExceptionDto,
  AdjustRentalInspectionExceptionDto,
  RecordRentalInspectionExceptionCustomerResponseDto,
  RentalAvailabilityDto,
  RentalOrderExtensionDto,
  PreviewRentalOrderChangeDto,
  ApplyRentalOrderChangeDto,
  ReviewRentalExtensionRefundDto,
  ReviewRentalOrderFeeReviewDto,
  RefundRentalServiceDto,
  UpdateRentalServiceOccurrenceDto,
  SaveRentalAssetDto,
  SaveRentalCouponTemplateDto,
  SaveRentalStockBalanceDto,
  ApplyRentalStockOperationDto,
  WriteOffRentalStockDispositionDto,
  SaveTenantRentalProfileDto,
  SubstituteRentalBundleComponentDto,
  ListRentalOrdersQueryDto,
  CreateRentalCarrierShipmentEventDto,
} from "./rental-order-request.dto";
import { effectiveExtensionRule } from "./rental-rule-defaults";
import {
  SaveTenantRentalBusinessSettingsDto,
} from "./rental-config-request.dto";
import { renderOperationReportCsv } from "./rental-workspace-report.csv";
import { RENTAL_PENDING_PAYMENT_TIMEOUT_REASON, RentalCoreService } from "./rental-core.service";
import { RentalAllocationService } from "./rental-allocation.service";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import { RentalOrderConfirmationService } from "./rental-order-confirmation.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { RentalWorkspaceReportRepository } from "./rental-workspace-report.repository";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { getRequestIdentity } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { extensionRequestKey } from "./rental-service-occurrence";
import { RentalFundingService } from "./rental-funding.service";
import { RentalDocumentService } from "./rental-document.service";
import { buildRentalWorkbenchTodos, canIncludeWorkbenchOrderTodos, canIncludeWorkbenchWorkOrders } from "./rental-workbench-todos";
import { validateInspectionCustomerResponse } from "./rental-inspection-customer-response";
import { inspectionEvidenceIds, inspectionEvidenceRequiredError } from "./rental-inspection-evidence";
import { serviceCancellationAmounts, type ServiceCancellationSelection } from "./rental-service-cancellation";
import { MembershipService } from "../platform/membership.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { OperationLogService } from "../../common/operation-log.service";
import { redactDeliveryAddressPhone } from "./rental-delivery-address-privacy";
import { canRecordCarrierShipmentEventDirectly, carrierBillableWindow, carrierShipmentEventError, rentalOrderDueAt } from "./rental-carrier-shipment";

/** 读取标准 Idempotency-Key 请求头。大小写不敏感，超长键直接拒绝。 */
/**
 * 上限必须与 `rental_order_idempotency_records.idempotencyKey` 的列宽一致。
 * Prisma 的 `String` 在 MySQL 下落成 `VARCHAR(191)`，放行更长的键会在写入时
 * 撞 MySQL 1406（Data too long）变成 500，而不是这里明确的 400。
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 191;

function idempotencyKeyOf(req: { headers?: Record<string, unknown> }): string | undefined {
  const raw = req.headers?.["idempotency-key"] ?? req.headers?.["Idempotency-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException(`Idempotency-Key 过长，最多 ${IDEMPOTENCY_KEY_MAX_LENGTH} 个字符`);
  }
  return trimmed;
}

interface AuthenticatedRequest { user: SystemUserRow; headers?: Record<string, unknown>; }
interface UploadedImageFile { originalname: string; mimetype: string; size: number; buffer: Buffer; }
interface BinaryResponse { setHeader(name: string, value: string): void; send(body: Buffer): void; redirect(status: number, url: string): void; }

function carrierEvidenceIds(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * CAM-01A：控制器内的权限判定，口径与 Guard 的 hasAnyPermission 一致。
 *
 * 租户管理员（isPlatformAdmin）与通配 `*` 视为具备；SaaS 平台管理员不参与经营域动作。
 * 必须与 Guard 同口径，否则会出现「Guard 放行、控制器拒绝」或反之的错位。
 */
function hasPermissionCode(user: SystemUserRow, code: string) {
  if (user.isSaasAdmin) return false;
  if (user.isPlatformAdmin || user.permissions?.includes("*")) return true;
  return Boolean(user.permissions?.includes(code));
}

/**
 * 订单上已生效的续租租金合计。
 *
 * 提前归还退款按"未使用单位数 / 总单位数"折算，而 `quote.rentalAmount` 只覆盖原租期——
 * 续租那段的租金以 `type === "extension"` 的费用明细进的订单调整额。不把它加进基数，
 * 续过租的订单只会退到应退的一部分。待补款的续租不在明细里，也不在 `effectiveEndAt` 里，
 * 两边天然对齐。
 */
function extensionRentalOf(order: RentalOrder): number {
  return (order.chargeLines ?? [])
    .filter((line) => line.type === "extension")
    .reduce((sum, line) => sum + Number(line.amount ?? 0), 0);
}

/**
 * 每个计价目标仍未交回的数量。
 *
 * 逾期费必须按**实际仍在占用**的部分收：两件各日租 240、一件按时还、另一件逾时一小时，
 * 按原报价的全部数量算会收 20，而实际只有一件在逾期，应收 10。
 *
 * 已 `returned` / `released` 的分配项排除在外。本批要交回的仍计入——它确实逾期了，
 * 费用是先算后落账，此时订单上还没应用本批归还。
 */
function outstandingQuantitiesOf(order: RentalOrder): Record<string, number> {
  const result: Record<string, number> = {};
  for (const allocation of order.allocations ?? []) {
    if (allocation.status === "returned" || allocation.status === "released") continue;
    const line = order.lines?.find((row) => row.id === allocation.orderLineId);
    const target = line?.pricingGroupId ?? line?.itemGroupId ?? allocation.itemGroupId;
    if (!target) continue;
    result[target] = (result[target] ?? 0) + allocation.quantity;
  }
  return result;
}

/**
 * 本批实际归还的数量。
 *
 * 归还计费在应用归还前计算，因此这里按锁内订单把请求的分配项映射回
 * 计价目标。逾时费只应落在本批刚归还的数量上，不能把仍在租的部分一起
 * 计费，也不能等最后一批才把前面各批重新算一遍。
 */
function returnedQuantitiesOf(
  order: RentalOrder,
  items: Array<{ allocationId: string; quantity: number }>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const allocation = order.allocations?.find((row) => row.id === item.allocationId);
    if (!allocation || allocation.status === "returned" || allocation.status === "released") continue;
    const line = order.lines?.find((row) => row.id === allocation.orderLineId);
    const target = line?.pricingGroupId ?? line?.itemGroupId ?? allocation.itemGroupId;
    if (!target) continue;
    result[target] = (result[target] ?? 0) + Math.max(0, Number(item.quantity) || 0);
  }
  return result;
}

@Controller("rental/v1")
export class RentalCoreController {
  constructor(
    private readonly service: RentalCoreService,
    private readonly allocation: RentalAllocationService,
    private readonly business: RentalBusinessService,
    private readonly orderConfirmation: RentalOrderConfirmationService,
    private readonly idempotent: RentalIdempotentActionService,
    private readonly workspaceReports: RentalWorkspaceReportRepository,
    private readonly prisma: PrismaService,
    private readonly serviceCapacities: RentalServiceCapacityService,
    private readonly funding: RentalFundingService,
    private readonly documents: RentalDocumentService,
    private readonly operationLogs: OperationLogService,
    @Optional() private readonly corporateSettlement?: CustomerCorporateSettlementService,
    @Optional() private readonly memberships?: MembershipService
  ) {}

  private async context(tenantId: string): Promise<BusinessContext> {
    const profile = this.service.getProfile(tenantId);
    const category = await this.service.getWorkspaceCategory(tenantId);
    return { profile, category, settings: this.service.getBusinessSettings(tenantId), groups: this.service.listItemGroups(tenantId), pricingGroups: this.service.listPricingGroups(tenantId), couponTemplates: this.service.listCouponTemplates(tenantId), locations: this.service.listLocations(tenantId), operators: this.service.listOperators(tenantId) };
  }

  /** 员工端交接证据必须是当前员工刚上传到同一订单、空间、地点和幂等批次的已完成文件。 */
  private async assertStaffHandoverEvidence(
    req: AuthenticatedRequest,
    order: RentalOrder,
    stage: "pickup" | "return",
    batchId: string,
    signatureId: string | undefined,
    attachments: string[] = [],
    template?: { fields: Array<{ code: string; label: string; type: string; required: boolean }> },
    results: Record<string, unknown> = {}
  ) {
    if (!getRequestIdentity()?.staffApi) return attachments;
    if (!signatureId) throw new BadRequestException("员工端交接必须先完成客户现场签字");
    const photoIds: string[] = [];
    for (const field of template?.fields ?? []) {
      if (field.type !== "photo") continue;
      const value = results[field.code];
      const ids = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
      if (field.required && !ids.length) throw new BadRequestException(`请为“${field.label}”上传照片凭证`);
      photoIds.push(...ids);
    }
    const ids = [...new Set([...attachments, ...photoIds, signatureId])];
    const workspaceId = getRequestIdentity()?.workspaceId;
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    const assets = await this.prisma.fileAsset.findMany({
      where: {
        id: { in: ids }, tenantId: req.user.tenantId, businessModule: "rental-core",
        businessType: "rental_order", businessId: order.id, status: "active"
      },
      select: { id: true, uploadedBy: true, uploadScene: true, metadata: true }
    });
    if (assets.length !== ids.length) throw new BadRequestException("交接照片或签字未完成上傳，或不属于当前订单");
    const locationId = stage === "pickup" ? order.fulfillmentLocationId : (order.returnLocationId ?? order.fulfillmentLocationId);
    const locationName = stage === "pickup" ? order.fulfillmentLocationName : (order.returnLocationName ?? order.fulfillmentLocationName);
    for (const asset of assets) {
      const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {};
      const isSignature = asset.id === signatureId;
      const expectedScene = isSignature ? "handover-signature" : `${stage}-evidence`;
      if (asset.uploadScene !== expectedScene || asset.uploadedBy !== req.user.id
        || metadata.uploadedByUserId !== req.user.id
        || metadata.workspaceId !== workspaceId
        || metadata.handoverStage !== stage
        || metadata.handoverBatchId !== batchId
        || metadata.handoverLocationId !== locationId
        || metadata.handoverLocationName !== locationName) {
        throw new BadRequestException("交接证据的员工、阶段、地点或批次与当前操作不一致");
      }
    }
    return ids;
  }

  private async assertCarrierProofFiles(
    req: AuthenticatedRequest,
    orderId: string,
    fileIds: string[],
    allowedScenes: string[]
  ) {
    const ids = [...new Set(fileIds.map((value) => value.trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException("承运寄送必须上传可核验的签收、揽收或实物验收凭证");
    const workspaceId = getRequestIdentity()?.workspaceId;
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    const assets = await this.prisma.fileAsset.findMany({
      where: {
        id: { in: ids }, tenantId: req.user.tenantId, businessModule: "rental-core",
        businessType: "rental_order", businessId: orderId, status: "active", uploadScene: { in: allowedScenes }
      },
      select: { id: true, mimeType: true, uploadedBy: true, metadata: true }
    });
    if (assets.length !== ids.length) throw new BadRequestException("承运凭证必须先完成上传，且文件必须属于当前租户、空间和订单");
    for (const asset of assets) {
      const metadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown> : {};
      if (metadata.workspaceId !== workspaceId) throw new BadRequestException("承运凭证不属于当前经营空间");
      if (!asset.mimeType.startsWith("image/") && asset.mimeType !== "application/pdf") {
        throw new BadRequestException("承运凭证只支持图片或 PDF 文件");
      }
      if (getRequestIdentity()?.staffApi && asset.uploadedBy !== req.user.id) {
        throw new BadRequestException("员工端只能提交当前员工上传的承运凭证");
      }
    }
    return ids;
  }

  private async carrierShipmentEvents(tenantId: string, orderId: string, tx?: Prisma.TransactionClient) {
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const rows = await (tx ?? this.prisma).rentalCarrierShipmentEvent.findMany({
      where: { tenantId, workspaceId, orderId }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }]
    });
    return rows.map((row) => ({ ...row, evidenceFileAssetIds: carrierEvidenceIds(row.evidenceFileAssetIds) }));
  }

  private async recordCarrierSignedAtPickup(
    req: AuthenticatedRequest,
    order: RentalOrder,
    actualAt: string | undefined,
    proofIds: string[],
    tx: Prisma.TransactionClient
  ) {
    if (order.fulfillmentMode !== "carrier_shipping") return undefined;
    if (!actualAt) throw new BadRequestException("承运寄送领取必须登记客户实际签收时间");
    const signatureProof = await this.assertCarrierProofFiles(req, order.id, proofIds, ["handover-signature", "pickup-evidence", "carrier-shipment-evidence"]);
    const events = await this.carrierShipmentEvents(req.user.tenantId, order.id, tx);
    const error = carrierShipmentEventError({ mode: order.fulfillmentMode, orderStatus: order.status, eventType: "customer_signed", occurredAt: actualAt, events: events.map((row) => ({ type: row.type as RentalCarrierShipmentEventType, occurredAt: row.occurredAt })) });
    if (error) throw new ConflictException(`${error}；该订单暂不自动起租，请人工核实承运轨迹和凭证`);
    const dispatched = events.find((row) => row.type === "outbound_dispatched");
    if (!dispatched || dispatched.evidenceFileAssetIds.length === 0) throw new ConflictException("缺少已核验的发出运单凭证，暂不自动起租");
    return tx.rentalCarrierShipmentEvent.create({
      data: {
        tenantId: req.user.tenantId, workspaceId: this.service.resolveWorkspaceId(req.user.tenantId), orderId: order.id,
        type: "customer_signed", occurredAt: new Date(actualAt), carrierName: dispatched.carrierName,
        trackingNumber: dispatched.trackingNumber, evidenceFileAssetIds: signatureProof, recordedBy: req.user.displayName,
        idempotencyKey: createHash("sha256").update(`${order.id}:carrier-signed`).digest("hex")
      }
    });
  }

  @Get("orders/:id/carrier-shipment/events")
  async listCarrierShipmentEvents(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const order = await this.service.getOrder(req.user.tenantId, id);
    if (order.fulfillmentMode !== "carrier_shipping") throw new ConflictException("该订单不是承运寄送订单");
    return this.carrierShipmentEvents(req.user.tenantId, id);
  }

  @Post("orders/:id/carrier-shipment/events")
  async createCarrierShipmentEvent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: CreateRentalCarrierShipmentEventDto
  ) {
    const tenantId = req.user.tenantId;
    const key = idempotencyKeyOf(req);
    if (!key) throw new BadRequestException("登记承运里程碑必须提供 Idempotency-Key");
    const current = await this.service.getOrder(tenantId, id);
    if (current.fulfillmentMode !== "carrier_shipping") throw new ConflictException("该订单不是承运寄送订单");
    if (!canRecordCarrierShipmentEventDirectly(body.type)) {
      throw new ConflictException("客户签收必须通过领取检查核验，仓库验收必须通过归还检查完成；不能单独预登记这两个里程碑");
    }
    const carrierName = body.carrierName.trim();
    const trackingNumber = body.trackingNumber.trim();
    if (!carrierName || !trackingNumber) throw new BadRequestException("承运商和运单号不能为空");
    const evidenceFileAssetIds = await this.assertCarrierProofFiles(req, id, body.evidenceFileAssetIds, ["carrier-shipment-evidence"]);
    const normalized = { ...body, carrierName, trackingNumber, evidenceFileAssetIds };
    const eventIdempotencyKey = createHash("sha256").update(`${id}:${key}`).digest("hex");
    const result = await this.idempotent.execute({
      tenantId, action: "order.carrier-shipment-event", key,
      // 幂等记录键列只有 191 字符；请求头虽有长度校验，但拼入订单 ID 后会越界。
      // 事件唯一键与幂等表使用同一个固定长度摘要，仍保留 orderId 在摘要输入中。
      fallbackKey: `carrier-shipment:${eventIdempotencyKey}`,
      request: { orderId: id, ...normalized }, orderId: id,
      run: async (tx) => {
        const locked = await this.service.lockOrderForUpdate(tenantId, id, tx);
        if (locked.fulfillmentMode !== "carrier_shipping") throw new ConflictException("该订单不是承运寄送订单");
        const events = await this.carrierShipmentEvents(tenantId, id, tx);
        const error = carrierShipmentEventError({
          mode: locked.fulfillmentMode, orderStatus: locked.status, eventType: normalized.type,
          occurredAt: normalized.occurredAt, events: events.map((row) => ({ type: row.type as RentalCarrierShipmentEventType, occurredAt: row.occurredAt }))
        });
        if (error) throw new ConflictException(`${error}；不自动改变计租或库存，请人工核对`);
        return tx.rentalCarrierShipmentEvent.create({
          data: {
            tenantId, workspaceId: this.service.resolveWorkspaceId(tenantId), orderId: id,
            type: normalized.type, occurredAt: new Date(normalized.occurredAt), carrierName, trackingNumber,
            evidenceFileAssetIds, recordedBy: req.user.displayName, idempotencyKey: eventIdempotencyKey
          }
        });
      },
      replay: async () => (await this.prisma.rentalCarrierShipmentEvent.findFirst({
        where: { tenantId, workspaceId: this.service.resolveWorkspaceId(tenantId), orderId: id, idempotencyKey: eventIdempotencyKey }
      })) ?? undefined
    });
    return result;
  }
  // 必须先 await 业务结果再写快照：配置写方法已转为异步，若直接把 Promise 传进来
  // 就会与快照写入并发，快照可能捕获到变更前的状态。
  private async committed<T>(tenantId: string, result: T | Promise<T>): Promise<T> {
    const resolved = await result;
    await Promise.all([this.service.persist(tenantId), this.business.persist(tenantId)]);
    return redactDeliveryAddressPhone(resolved);
  }
  private async releaseCancelledOrderResources(tenantId: string, orderId: string, tx: Prisma.TransactionClient, reason: string) {
    await this.business.releaseCouponInTransaction(tenantId, orderId, tx);
    await this.serviceCapacities.releaseForOrder(tenantId, orderId, reason, new Date().toISOString(), tx);
    await this.corporateSettlement?.releaseOrderCredit(tenantId, orderId, reason, tx);
  }

  private async usesCorporateCredit(tenantId: string, orderId: string, tx?: Prisma.TransactionClient) {
    return this.corporateSettlement?.requiresCreditSettlement(tenantId, orderId, tx) ?? false;
  }
  private async emitOrderEvent(tenantId: string, eventCode: string, order: { id: string; orderNo: string; customerName: string; contactPhone?: string; customerId?: string }) {
    // 业务对象随事件传入，服务端据此生成空间级幂等键——同一订单同一事件重放不再二次发信。
    return await this.business.emitNotificationEvent(
      tenantId, (await this.context(tenantId)), eventCode, order.contactPhone ?? order.customerId,
      { customerName: order.customerName, orderNo: order.orderNo },
      { type: "order", id: order.id }
    );
  }
  @Get("categories") async categories(@Req() req: AuthenticatedRequest) {
    // 租户业务元数据只展示会话空间已采用的正文；平台全品类管理另走 SaaS 接口。
    return [await this.service.getWorkspaceCategory(req.user.tenantId)];
  }

  @Get("booking-members")
  bookingMembers(@Req() req: AuthenticatedRequest) {
    if (!this.memberships) throw new ConflictException("会员服务未就绪");
    return this.memberships.listPersonalOptions(req.user.tenantId);
  }

  @Get("booking-members/:customerId/booking-options")
  bookingOptions(@Req() req: AuthenticatedRequest, @Param("customerId") customerId: string) {
    if (!this.memberships) throw new ConflictException("会员服务未就绪");
    return this.memberships.listBookingOptions(req.user.tenantId, this.service.resolveWorkspaceId(req.user.tenantId), customerId);
  }

  /** 下单选址：读取该会员在客户地址簿里的有效收货地址（配送/上门类履约用）。脱敏摘要，走下单权限。 */
  @Get("booking-members/:customerId/delivery-addresses")
  bookingDeliveryAddresses(@Req() req: AuthenticatedRequest, @Param("customerId") customerId: string) {
    return this.business.listCustomerDeliveryAddresses(req.user.tenantId, customerId);
  }
  /**
   * REPORT-01A：当前经营空间的经营报表。
   *
   * 空间**不由客户端传入**，一律从会话解析（`resolveScopeWorkspaceId`）：
   * 让页面传 workspaceId 等于允许查自己无权进入的空间的经营数据。
   * 品类只用于页面文案，指标公式与它无关。
   */
  @Get("reports/operations")
  async operationReport(
    @Req() req: AuthenticatedRequest,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
    @Query("customerId") customerId?: string,
    @Query("customerType") customerType?: string
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    return this.workspaceReports.getOperationReport(
      tenantId,
      workspaceId,
      this.service.getProfile(tenantId).categoryCode,
      this.reportFilter({ from, to, locationId, customerId, customerType }),
      // 币种从经营空间的业务设置取：报表仓储不读配置，避免同一事实两个来源。
      this.service.getBusinessSettings(tenantId).pricing.currency
    );
  }

  /**
   * REPORT-01B：报表导出（CSV）。
   *
   * 与上面的读取接口共用**同一个**仓储方法与同一组筛选解析，因此导出与页面
   * 必然是同一份数字。若导出自己再查一遍库，就会出现「页面一个数、导出另一个数」，
   * 且没人能说清哪个对。
   *
   * 权限与空间同样走会话：路由前缀命中 `reports` 分支，鉴权与页面读取一致。
   */
  @Get("reports/operations/export")
  async exportOperationReport(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: { setHeader: (name: string, value: string) => void },
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("locationId") locationId?: string,
    @Query("customerId") customerId?: string,
    @Query("customerType") customerType?: string
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = await resolveScopeWorkspaceId(this.prisma, tenantId);
    const report = await this.workspaceReports.getOperationReport(
      tenantId,
      workspaceId,
      this.service.getProfile(tenantId).categoryCode,
      this.reportFilter({ from, to, locationId, customerId, customerType }),
      // 币种从经营空间的业务设置取：报表仓储不读配置，避免同一事实两个来源。
      this.service.getBusinessSettings(tenantId).pricing.currency
    );
    const stamp = report.generatedAt.replace(/[-:T]/g, "").slice(0, 14);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    // 文件名只用空间 id 与时间戳：客户名等业务数据不进 header，避免非 ASCII 与注入。
    res.setHeader("Content-Disposition", `attachment; filename="operation-report-${workspaceId}-${stamp}.csv"`);
    return renderOperationReportCsv(report);
  }

  /** 只收白名单里的筛选项；空串按未传处理，避免 `?locationId=` 变成"查 id 为空串的地点"。 */
  private reportFilter(input: Record<string, string | undefined>): RentalWorkspaceReportFilter {
    const pick = (value: string | undefined) => (value && value.trim() ? value.trim() : undefined);
    const customerType = pick(input.customerType);
    return {
      from: pick(input.from),
      to: pick(input.to),
      locationId: pick(input.locationId),
      customerId: pick(input.customerId),
      customerType: customerType as RentalWorkspaceReportFilter["customerType"]
    };
  }
  @Get("tenant-profile") profile(@Req() req: AuthenticatedRequest) { return this.service.getProfile(req.user.tenantId); }
  /** TENANT-READY-01：当前空间开业配置状态（服务端权威判定，含缺项与下一步入口）。 */
  @Get("tenant-readiness") async tenantReadiness(@Req() req: AuthenticatedRequest) { return this.business.tenantReadiness(req.user.tenantId, (await this.context(req.user.tenantId))); }
  @Put("tenant-profile") saveProfile(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalProfileDto) { return this.committed(req.user.tenantId, this.service.saveProfile(req.user.tenantId, body)); }
  @Get("business-settings") businessSettings(@Req() req: AuthenticatedRequest) { return this.service.getBusinessSettings(req.user.tenantId); }
  @Put("business-settings") saveBusinessSettings(@Req() req: AuthenticatedRequest, @Body() body: SaveTenantRentalBusinessSettingsDto) { return this.committed(req.user.tenantId, this.service.saveBusinessSettings(req.user.tenantId, body, req.user.displayName)); }
  @Get("coupon-templates") couponTemplates(@Req() req: AuthenticatedRequest) { return this.service.listCouponTemplates(req.user.tenantId); }
  @Post("coupon-templates") saveCouponTemplate(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalCouponTemplateDto) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, body)); }
  @Put("coupon-templates/:id") updateCouponTemplate(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalCouponTemplateDto) { return this.committed(req.user.tenantId, this.service.saveCouponTemplate(req.user.tenantId, { ...body, id })); }
  @Get("locations") locations(@Req() req: AuthenticatedRequest) { return this.service.listLocations(req.user.tenantId); }
  @Get("fulfillment-operators") operators(@Req() req: AuthenticatedRequest) { return this.service.listOperators(req.user.tenantId); }
  @Post("fulfillment-operators") saveOperator(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentOperatorDto) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, body)); }
  @Put("fulfillment-operators/:id") updateOperator(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentOperatorDto) { return this.committed(req.user.tenantId, this.service.saveOperator(req.user.tenantId, { ...body, id })); }
  @Post("locations") saveLocation(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalFulfillmentLocationDto) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, body)); }
  @Put("locations/:id") updateLocation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalFulfillmentLocationDto) { return this.committed(req.user.tenantId, this.service.saveLocation(req.user.tenantId, { ...body, id })); }
  @Get("item-groups") groups(@Req() req: AuthenticatedRequest) { return this.service.listItemGroups(req.user.tenantId); }
  @Post("item-groups") saveGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalItemGroupDto) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, body)); }
  @Put("item-groups/:id") updateGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalItemGroupDto) { return this.committed(req.user.tenantId, this.service.saveItemGroup(req.user.tenantId, { ...body, id })); }
  @Post("item-groups/:id/images")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  uploadItemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @UploadedFile() file?: UploadedImageFile) {
    if (!file) throw new BadRequestException("请选择要上传的产品型号图片");
    return this.committed(req.user.tenantId, this.service.addItemGroupImage(req.user.tenantId, id, file));
  }
  @Delete("item-groups/:id/images/:imageId")
  removeItemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("imageId") imageId: string) {
    return this.committed(req.user.tenantId, this.service.removeItemGroupImage(req.user.tenantId, id, imageId));
  }
  @Get("item-groups/:id/images/:imageId")
  async itemGroupImage(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("imageId") imageId: string, @Res() res: BinaryResponse) {
    const image = await this.service.readItemGroupImage(req.user.tenantId, id, imageId);
    if ("redirectUrl" in image) {
      res.redirect(302, image.redirectUrl!);
      return;
    }
    res.setHeader("Content-Type", image.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(image.fileName)}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(image.content);
  }
  @Get("pricing-groups") pricingGroups(@Req() req: AuthenticatedRequest) { return this.service.listPricingGroups(req.user.tenantId); }
  @Post("pricing-groups") async savePricingGroup(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalPricingGroupDto) {
    const tenantId = req.user.tenantId;
    if (!body.initialRates?.length) throw new BadRequestException("新建定价分组时至少填写一条基本价");
    const uniqueUnits = new Set(body.initialRates.map((row) => row.unit));
    if (uniqueUnits.size !== body.initialRates.length) throw new BadRequestException("同一个计价单位只能填写一条基本价");

    let group!: Awaited<ReturnType<RentalCoreService["savePricingGroup"]>>;
    let plan!: Awaited<ReturnType<RentalBusinessService["savePricingPlan"]>>;
    await this.prisma.$transaction(async (tx) => {
      group = await this.service.savePricingGroup(
        tenantId,
        { ...body, defaultPricingUnit: body.defaultPricingUnit ?? body.initialRates![0].unit },
        tx,
        true
      );
      const context = (await this.context(tenantId));
      const pricingGroups = [group, ...(context.pricingGroups ?? []).filter((row) => row.id !== group.id)];
      plan = await this.business.savePricingPlan(tenantId, { ...context, pricingGroups }, {
        code: `BASE-${group.code}-${group.id.slice(-8)}`,
        name: `${group.name} 基本价`,
        status: "enabled",
        effectiveFrom: new Date().toISOString(),
        changeReason: `新建定价分组“${group.name}”并设置基本价`,
        rates: body.initialRates!.map((row) => ({
          pricingGroupId: group.id,
          itemGroupId: group.id,
          unit: row.unit,
          baseAmount: row.baseAmount,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: row.depositAmount ?? 0,
          depositMultiple: row.depositMultiple,
          minimumUnits: 1,
          includedUsage: row.includedUsage,
          excessUsageAmount: row.excessUsageAmount,
          usagePrecision: row.usagePrecision,
          tierMode: row.tierMode,
          tiers: row.tiers,
          maxAmount: row.maxAmount,
          // 预授权品类的默认规则要求预授权，额度只能在这里随基本价一并给出；
          // 留空则按 0 处理，报价会被预授权闸门如实拦截。
          preAuthAmount: row.preAuthAmount ?? 0,
          preAuthMultiple: row.preAuthMultiple
        }))
      }, req.user.displayName, tx, true);
    });
    this.service.commitPricingGroup(group);
    this.business.commitPricingPlan(tenantId, { ...(await this.context(tenantId)), pricingGroups: [group, ...this.service.listPricingGroups(tenantId).filter((row) => row.id !== group.id)] }, plan);
    return this.committed(tenantId, group);
  }
  @Put("pricing-groups/:id") updatePricingGroup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalPricingGroupDto) { return this.committed(req.user.tenantId, this.service.savePricingGroup(req.user.tenantId, { ...body, id })); }
  @Patch("pricing-groups/:id/security-rates") async updatePricingGroupSecurityRates(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: UpdateRentalPricingGroupSecurityRatesDto) {
    if (!body.rates?.length) throw new BadRequestException("至少填写一个计价单位的押金或预授权费率");
    return this.business.updatePricingGroupSecurityRates(req.user.tenantId, (await this.context(req.user.tenantId)), id, body.rates, req.user.displayName);
  }
  @Get("assets") assets(@Req() req: AuthenticatedRequest) { return this.service.listAssets(req.user.tenantId); }
  @Get("assets/:id/status-history") assetStatusHistory(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listAssetStatusHistory(req.user.tenantId, id); }
  @Post("assets") saveAsset(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalAssetDto) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, body)); }
  @Put("assets/:id") updateAsset(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SaveRentalAssetDto) { return this.committed(req.user.tenantId, this.service.saveAsset(req.user.tenantId, { ...body, id })); }
  @Get("stock-balances") stocks(@Req() req: AuthenticatedRequest) { return this.service.listStockBalances(req.user.tenantId); }
  @Get("stock-ledger") stockLedger(@Req() req: AuthenticatedRequest, @Query("itemGroupId") itemGroupId?: string, @Query("locationId") locationId?: string, @Query("batchNo") batchNo?: string, @Query("sourceDocumentNo") sourceDocumentNo?: string, @Query("limit") limit?: string) {
    const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
    if (limit !== undefined && (parsedLimit === undefined || !Number.isInteger(parsedLimit) || parsedLimit < 1)) throw new BadRequestException("流水条数必须是正整数");
    return this.service.listStockLedger(req.user.tenantId, { itemGroupId, locationId, batchNo, sourceDocumentNo, limit: parsedLimit });
  }

  /**
   * ORDER-CHANGE-01E：取货后换货试算。
   *
   * 试算和应用都在订单锁内重读商品、价格版本、缓冲冲突和服务快照；返回给前端的
   * 只有可解释的差额与候选事实，金额和资产不能由客户端回传决定。
   */
  private async pricePostPickupExchange(
    tenantId: string,
    orderId: string,
    body: PreviewRentalOrderChangeDto,
    tx?: Prisma.TransactionClient
  ): Promise<{ order: RentalOrder; preview: RentalOrderChangePreview }> {
    if (!tx) return this.prisma.$transaction((transaction) => this.pricePostPickupExchange(tenantId, orderId, body, transaction));
    const order = await this.service.lockOrderForUpdate(tenantId, orderId, tx);
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以办理取货后换货");
    const orderLineId = body.orderLineId?.trim();
    const allocationId = body.allocationId?.trim();
    const replacementItemGroupId = body.replacementItemGroupId?.trim();
    if (!orderLineId || !allocationId || !replacementItemGroupId) throw new BadRequestException("换货必须选择订单行、已领取分配项和新商品");
    const line = order.lines.find((row) => row.id === orderLineId);
    const allocation = order.allocations.find((row) => row.id === allocationId);
    if (!line || !allocation || allocation.orderLineId !== line.id || allocation.status !== "picked_up") {
      throw new ConflictException("所选商品已归还、已换过或不属于当前订单");
    }
    const activeQuantity = line.quantity - (line.cancelledQuantity ?? 0);
    if (allocation.quantity !== activeQuantity) throw new ConflictException("本轮只能整行换货，不能拆换部分数量");
    if (["consumable", "bundle"].includes(line.inventoryMode)) throw new ConflictException("一次性耗材和套装暂不支持取货后换货");

    const context = (await this.context(tenantId));
    const replacementGroup = context.groups.find((row) => row.id === replacementItemGroupId);
    if (!replacementGroup || replacementGroup.status !== "enabled") throw new ConflictException("换货目标商品不存在或已停用");
    if (replacementGroup.inventoryMode !== line.inventoryMode) throw new ConflictException("换货前后库存方式必须一致");
    const priceBasis: RentalOrderExchangePriceBasis = body.priceBasis ?? "original_order_price";
    const originalDisposition: RentalOrderExchangeDisposition = body.originalDisposition ?? "return_to_warehouse";
    const exchangeLocationId = body.exchangeLocationId?.trim() || order.fulfillmentLocationId;
    if (exchangeLocationId !== order.fulfillmentLocationId) throw new ConflictException("首期换货必须在订单领取地点办理");
    const replacementAssetId = body.replacementAssetId?.trim();
    if (replacementGroup.inventoryMode === "serialized" && !replacementAssetId) throw new BadRequestException("序列化商品换货必须选择具体资产");
    if (replacementGroup.inventoryMode !== "serialized" && replacementAssetId) throw new BadRequestException("数量库存换货不能提交序列化资产");
    const candidates = replacementGroup.inventoryMode === "serialized"
      ? await this.allocation.exchangeAssetCandidates(tenantId, order, replacementGroup.id, exchangeLocationId, tx)
      : [];
    const selectedCandidate = replacementAssetId ? candidates.find((row) => row.assetId === replacementAssetId) : undefined;
    if (replacementAssetId && (!selectedCandidate || !selectedCandidate.available)) {
      throw new ConflictException(selectedCandidate?.reason ?? "换货目标资产当前不可用或与租期缓冲冲突");
    }

    const cancelledServiceOccurrenceIds = [...new Set((body.cancelServiceOccurrenceIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const previousExtensions = await this.service.listOrderExtensions(tenantId, orderId, tx);
    const quoted = await this.business.quotePostPickupExchange(tenantId, context, {
      order,
      previousExtensions,
      orderLineId,
      replacementItemGroupId,
      replacementPricingGroupId: body.replacementPricingGroupId?.trim() || undefined,
      priceBasis,
      exchangeCancelledServiceOccurrenceIds: cancelledServiceOccurrenceIds,
      appliedAt: new Date().toISOString(),
      fulfillmentMode: order.fulfillmentMode,
      locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((value): value is string => Boolean(value)),
      customerType: order.customerType
    });
    const beforePayableAmount = order.finalPayableAmount;
    const recalculatedPayableAmount = quoted.priced.pricingSnapshot?.recalculatedPayableAmount ?? beforePayableAmount;
    const differenceAmount = roundMoney(recalculatedPayableAmount - beforePayableAmount);
    const inspectionSnapshot: RentalOrderExchangeInspectionSnapshot = body.inspectionSnapshot ?? { customerConfirmed: false };
    const cancelledServices = cancelledServiceOccurrenceIds.map((occurrenceId) => {
      const occurrence = (order.serviceSnapshots ?? []).find((row) => row.occurrenceId === occurrenceId);
      if (!occurrence) throw new ConflictException("要取消的服务发生项不属于当前订单");
      return {
        occurrenceId,
        serviceName: occurrence.serviceName,
        quantity: occurrence.quantity,
        refundAmount: serviceCancellationAmounts(occurrence, occurrence.quantity).refundAmount
      };
    });
    const pricingSnapshot = quoted.priced.pricingSnapshot
      ? { ...quoted.priced.pricingSnapshot, previousPayableAmount: beforePayableAmount, recalculatedPayableAmount, differenceAmount }
      : undefined;
    const currentVersion = quoted.currentVersion && "version" in quoted.currentVersion ? String(quoted.currentVersion.version) : undefined;
    const preview: RentalOrderChangePreview = {
      orderId: order.id,
      type: "post_pickup_exchange",
      expectedUpdatedAt: order.updatedAt,
      cancelledLineIds: [],
      cancelledItems: [],
      cancelledServices,
      remainingLineIds: [line.id],
      beforePayableAmount,
      recalculatedPayableAmount,
      differenceAmount,
      additionalAmount: Math.max(0, differenceAmount),
      refundAmount: Math.max(0, -differenceAmount),
      depositDelta: quoted.priced.depositDelta,
      preAuthDelta: quoted.priced.preAuthDelta,
      currency: quoted.priced.currency,
      pricingSnapshot,
      resourceRelease: [{ lineId: line.id, itemGroupName: line.itemGroupName, quantity: allocation.quantity }],
      serviceResourceRelease: cancelledServices.map((row) => ({ occurrenceId: row.occurrenceId, serviceName: row.serviceName, quantity: row.quantity })),
      exchange: {
        orderLineId,
        allocationId,
        originalItemGroupId: line.itemGroupId,
        originalItemGroupName: line.itemGroupName,
        replacementItemGroupId: replacementGroup.id,
        replacementItemGroupName: replacementGroup.name,
        replacementPricingGroupId: quoted.replacementPricingGroupId,
        priceBasis,
        originalDisposition,
        originalAmount: quoted.originalAmount,
        replacementAmount: quoted.replacementAmount,
        differenceAmount,
        originalPriceVersion: quoted.priced.priceVersion,
        replacementPriceVersion: currentVersion ?? quoted.priced.priceVersion,
        replacementAssetId,
        replacementAssetNo: selectedCandidate?.assetNo,
        cancelledServiceOccurrenceIds,
        inspectionSnapshot
      },
      warnings: [
        "换货差额不在确认时立即收款，统一在归还结算时处理",
        ...(differenceAmount < 0 ? ["本次形成负差额，归还结算前需完成退款审核"] : []),
        ...(originalDisposition === "off_shelf" ? ["原商品下架，不释放数量库存或序列化资产"] : ["原商品返回仓库并释放原占用"])
      ]
    };
    return { order, preview };
  }

  private async priceLineCancellation(tenantId: string, orderId: string, body: PreviewRentalOrderChangeDto, tx?: Prisma.TransactionClient) {
    const order = tx
      ? await this.service.lockOrderForUpdate(tenantId, orderId, tx)
      : await this.service.getOrder(tenantId, orderId);
    await this.service.assertCarrierOrderResourcesMutable(tenantId, order, tx);
    if (![RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)) {
      throw new ConflictException("只有取货前的待确认或待领取订单可以部分取消");
    }
    if (order.effectiveEndAt && Date.parse(order.effectiveEndAt) !== Date.parse(order.endAt)) {
      throw new ConflictException("已有生效续租的订单不能在本轮部分取消，请人工处理");
    }
    if (order.serviceSnapshots?.length || order.adjustmentAmount !== 0) {
      throw new ConflictException("已有服务或费用调整的订单暂不能自动部分取消，请人工处理");
    }
    const changes = await this.service.listOrderChanges(tenantId, orderId, tx);
    if (changes.some((row) => row.status === "applied")) {
      throw new ConflictException("本轮一个订单只允许一次整行部分取消，后续拆分变更请使用专用变更流程");
    }
    const activeLines = order.lines.filter((line) => (line.cancelledQuantity ?? 0) < line.quantity);
    const hasLineIds = Boolean(body.lineIds?.length);
    const hasItems = Boolean(body.items?.length);
    if (hasLineIds === hasItems) throw new BadRequestException("请提供订单行或数量取消项，且只能提供一种");
    const rawItems = hasItems
      ? body.items!.map((item) => ({ lineId: item.lineId.trim(), quantity: Number(item.quantity) }))
      : body.lineIds!.map((lineId) => {
        const line = order.lines.find((row) => row.id === lineId.trim());
        return { lineId: lineId.trim(), quantity: line ? line.quantity - (line.cancelledQuantity ?? 0) : 0 };
      });
    if (!rawItems.length || rawItems.some((item) => !item.lineId || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw new BadRequestException("请选择有效的订单行和取消数量");
    }
    if (new Set(rawItems.map((item) => item.lineId)).size !== rawItems.length) throw new BadRequestException("同一订单行只能出现一次");
    const cancellationItems = rawItems.map((item) => {
      const line = activeLines.find((row) => row.id === item.lineId);
      if (!line) throw new ConflictException("存在无效、已取消或不属于当前订单的订单行");
      const activeQuantity = line.quantity - (line.cancelledQuantity ?? 0);
      if (item.quantity > activeQuantity) throw new ConflictException(`${line.itemGroupName}最多可取消 ${activeQuantity} 件`);
      // 序列化资产是一条实物承诺；本轮只允许数量库存和一次性耗材按数量拆分，整行取消仍复用 01A。
      if (!["quantity", "consumable"].includes(line.inventoryMode) && item.quantity !== activeQuantity) {
        throw new ConflictException(`${line.itemGroupName}是序列化资产，本轮只能整行取消`);
      }
      const availableReservation = order.reservations
        .filter((row) => row.orderLineId === line.id && !["released", "expired", "cancelled"].includes(row.status))
        .reduce((sum, row) => sum + row.quantity - row.releasedQuantity, 0);
      if (availableReservation < item.quantity) throw new ConflictException(`${line.itemGroupName}的可释放预占数量不足`);
      return { ...item, itemGroupName: line.itemGroupName };
    });
    const activeTotal = activeLines.reduce((sum, line) => sum + line.quantity - (line.cancelledQuantity ?? 0), 0);
    const cancelledTotal = cancellationItems.reduce((sum, item) => sum + item.quantity, 0);
    if (cancelledTotal >= activeTotal) throw new ConflictException("整单取消请使用订单取消操作，部分取消必须保留至少一件有效商品");
    const lineIds = cancellationItems.map((item) => item.lineId);
    const selected = activeLines.filter((line) => lineIds.includes(line.id));
    if (order.reservations.some((row) => lineIds.includes(row.orderLineId) && row.releasedQuantity > 0)) {
      throw new ConflictException("已有部分归还或释放记录的订单行不能自动部分取消");
    }
    const cancellationByLine = new Map(cancellationItems.map((item) => [item.lineId, item.quantity]));
    const remaining = activeLines
      .map((line) => ({ ...line, quantity: line.quantity - (cancellationByLine.get(line.id) ?? 0) }))
      .filter((line) => line.quantity > 0);
    const priced = await this.business.quoteOrderLineCancellation(tenantId, (await this.context(tenantId)), {
      order,
      lines: remaining.map((line) => {
        const original = activeLines.find((row) => row.id === line.id)!;
        return {
          itemGroupId: line.itemGroupId,
          pricingGroupId: line.pricingGroupId,
          quantity: line.quantity,
          inventoryMode: line.inventoryMode,
          // 一次性耗材没有第二次计价；部分取消时按未取消数量保留原行金额，
          // 其它库存模式仍由续租/取消定价逻辑按原费率重算。
          amount: original.quantity > 0
            ? Math.round((original.amount * line.quantity / original.quantity + Number.EPSILON) * 100) / 100
            : 0
        };
      }),
      appliedAt: new Date().toISOString(),
      fulfillmentMode: order.fulfillmentMode,
      locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((value): value is string => Boolean(value)),
      customerType: order.customerType
    });
    const differenceAmount = priced.pricingSnapshot?.differenceAmount ?? priced.payableAmount;
    return {
      order,
      scope: "line" as const,
      selected,
      remaining,
      priced,
      preview: {
        orderId: order.id,
        type: "partial_line_cancel" as const,
        expectedUpdatedAt: order.updatedAt,
        cancelledLineIds: selected.map((line) => line.id),
        cancelledItems: cancellationItems.map((item) => ({ lineId: item.lineId, itemGroupName: item.itemGroupName, quantity: item.quantity })),
        remainingLineIds: remaining.map((line) => line.id),
        beforePayableAmount: order.finalPayableAmount,
        recalculatedPayableAmount: priced.pricingSnapshot?.recalculatedPayableAmount ?? order.finalPayableAmount + differenceAmount,
        differenceAmount,
        additionalAmount: Math.max(0, differenceAmount),
        refundAmount: Math.max(0, -differenceAmount),
        depositDelta: priced.depositDelta,
        preAuthDelta: priced.preAuthDelta,
        currency: priced.currency,
        pricingSnapshot: priced.pricingSnapshot,
        resourceRelease: cancellationItems.map((item) => ({ lineId: item.lineId, itemGroupName: item.itemGroupName, quantity: item.quantity })),
        serviceResourceRelease: [],
        warnings: [
          ...(differenceAmount < 0 ? ["租金差额只记入订单退款待办，实际退款仍需通过支付退款流程完成"] : []),
          ...(priced.depositDelta < 0 ? ["押金减少将按当前已收余额记录退款事件"] : []),
          ...(priced.preAuthDelta < 0 ? ["预授权减少将按当前冻结余额记录释放事件"] : [])
        ]
      },
      cancellationItems
    };
  }

  /**
   * ORDER-CHANGE-01C：只取消取货前尚未开始的增值服务。
   *
   * 服务不重新读取当前目录或优惠模板，退款依据来自订单服务发生项快照；容量释放与
   * 订单变更写入在同一事务内完成。商品行取消与服务取消在本轮保持互斥，避免一个预览
   * 同时混合两套资格/金额语义。
   */
  private async priceServiceCancellation(tenantId: string, orderId: string, body: PreviewRentalOrderChangeDto, tx?: Prisma.TransactionClient) {
    const order = tx
      ? await this.service.lockOrderForUpdate(tenantId, orderId, tx)
      : await this.service.getOrder(tenantId, orderId);
    await this.service.assertCarrierOrderResourcesMutable(tenantId, order, tx);
    if (![RentalCoreOrderStatus.Reserved, RentalCoreOrderStatus.ReadyForPickup].includes(order.status)) {
      throw new ConflictException("只有取货前的待确认或待领取订单可以取消增值服务");
    }
    const changes = await this.service.listOrderChanges(tenantId, orderId, tx);
    if (changes.some((row) => row.status === "applied")) {
      throw new ConflictException("本轮一个订单只允许一次部分变更，后续变更请使用专用变更流程");
    }
    if (body.lineIds?.length || body.items?.length) throw new BadRequestException("服务取消不能同时提交商品取消项");
    const serviceOccurrenceIds = [...new Set((body.serviceOccurrenceIds ?? []).map((value) => value.trim()).filter(Boolean))];
    const serviceItems = (body.serviceItems ?? []).map((item) => ({ occurrenceId: item.occurrenceId.trim(), quantity: Number(item.quantity) }));
    if (serviceOccurrenceIds.length && serviceItems.length) throw new BadRequestException("整项取消与按数量取消只能选择一种");
    if (!serviceOccurrenceIds.length && !serviceItems.length) throw new BadRequestException("请选择至少一项且不重复的增值服务");
    const selections: ServiceCancellationSelection[] = serviceItems.length
      ? serviceItems
      : serviceOccurrenceIds.map((occurrenceId) => ({ occurrenceId, quantity: 0 }));
    if (new Set(selections.map((item) => item.occurrenceId)).size !== selections.length || selections.some((item) => !item.occurrenceId || !Number.isInteger(item.quantity) || item.quantity < 0)) {
      throw new BadRequestException("请选择有效且不重复的增值服务取消项");
    }
    const occurrences = order.serviceSnapshots ?? [];
    const selectedServices = selections.map((selection) => {
      const occurrence = occurrences.find((row) => row.occurrenceId === selection.occurrenceId);
      if (!occurrence) throw new ConflictException("存在不存在或不属于当前订单的服务发生项");
      const status = occurrence.executionStatus ?? "not_started";
      if (status !== "not_started") throw new ConflictException(`服务「${occurrence.serviceName}」已经开始或结束，不能从取货前变更取消`);
      if (occurrence.requiredByRule) throw new ConflictException(`服务「${occurrence.serviceName}」属于业务规则要求，不能直接取消`);
      if (occurrence.refundStatus && occurrence.refundStatus !== "none") throw new ConflictException(`服务「${occurrence.serviceName}」已有退款处理记录`);
      const quantity = selection.quantity || occurrence.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > occurrence.quantity) throw new ConflictException(`服务「${occurrence.serviceName}」最多可取消 ${occurrence.quantity} 份`);
      if (occurrence.requiresCapacity && occurrence.capacityQuantity !== occurrence.quantity) throw new ConflictException(`服务「${occurrence.serviceName}」的容量快照不支持安全拆分，请人工处理`);
      return { occurrence, selection: { occurrenceId: selection.occurrenceId, quantity } };
    });
    const normalizedServiceItems = selectedServices.map((row) => row.selection);
    const priced = await this.business.quoteOrderServiceCancellation(tenantId, (await this.context(tenantId)), {
      order,
      serviceItems: normalizedServiceItems
    });
    const differenceAmount = priced.payableAmount;
    const activeLineIds = order.lines
      .filter((line) => (line.cancelledQuantity ?? 0) < line.quantity)
      .map((line) => line.id);
    return {
      order,
      scope: "service" as const,
      selectedServices,
      serviceOccurrenceIds: serviceOccurrenceIds.length ? serviceOccurrenceIds : undefined,
      serviceItems: serviceItems.length ? normalizedServiceItems : undefined,
      priced,
      preview: {
        orderId: order.id,
        type: "service_cancel" as const,
        expectedUpdatedAt: order.updatedAt,
        cancelledLineIds: [],
        cancelledItems: [],
        cancelledServices: selectedServices.map(({ occurrence, selection }) => ({
          occurrenceId: occurrence.occurrenceId!,
          serviceName: occurrence.serviceName,
          quantity: selection.quantity,
          refundAmount: serviceCancellationAmounts(occurrence, selection.quantity).refundAmount
        })),
        remainingLineIds: activeLineIds,
        beforePayableAmount: order.finalPayableAmount,
        recalculatedPayableAmount: order.finalPayableAmount + differenceAmount,
        differenceAmount,
        additionalAmount: 0,
        refundAmount: Math.max(0, -differenceAmount),
        depositDelta: 0,
        preAuthDelta: 0,
        currency: priced.currency,
        pricingSnapshot: undefined,
        resourceRelease: [],
        serviceResourceRelease: selectedServices.map(({ occurrence, selection }) => ({ occurrenceId: occurrence.occurrenceId!, serviceName: occurrence.serviceName, quantity: occurrence.requiresCapacity ? selection.quantity : 0 })),
        warnings: differenceAmount < 0
          ? ["服务退款按订单快照中的客户净支付计算，差额只记入退款待办，实际退款仍需通过支付退款流程完成"]
          : ["本次服务没有客户净支付，不产生退款，但会释放服务容量"]
      },
      cancellationItems: []
    };
  }

  private async releaseLineCancellationSecurity(
    tenantId: string,
    orderId: string,
    priced: { depositDelta: number; preAuthDelta: number },
    idempotencyKey: string,
    operator: string,
    tx: Prisma.TransactionClient
  ) {
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const funding = await this.funding.listEvents(tenantId, workspaceId, orderId, tx);
    const depositRefund = Math.max(0, -priced.depositDelta);
    const preAuthRelease = Math.max(0, -priced.preAuthDelta);
    if (depositRefund > funding.deposit.balance + 0.005) throw new ConflictException("当前已收押金不足以自动退款，请人工处理");
    if (preAuthRelease > funding.preauthorization.balance + 0.005) throw new ConflictException("当前预授权冻结余额不足以自动释放，请人工处理");
    if (depositRefund > 0) {
      await this.funding.recordEvent(tenantId, workspaceId, orderId, {
        instrument: "deposit", action: "refund", amount: depositRefund,
        idempotencyKey: `order-change:${idempotencyKey}:deposit`, reason: "订单部分取消退还押金"
      }, operator, tx);
    }
    if (preAuthRelease > 0) {
      await this.funding.recordEvent(tenantId, workspaceId, orderId, {
        instrument: "preauthorization", action: "release", amount: preAuthRelease,
        idempotencyKey: `order-change:${idempotencyKey}:preauthorization`, reason: "订单部分取消释放预授权"
      }, operator, tx);
    }
  }
  @Post("stock-operations") stockOperation(@Req() req: AuthenticatedRequest, @Body() body: ApplyRentalStockOperationDto) {
    return this.committed(req.user.tenantId, this.service.applyStockOperation(req.user.tenantId, body, req.user.displayName));
  }
  @Get("stock-dispositions") dispositions(@Req() req: AuthenticatedRequest, @Query("orderId") orderId?: string) { return this.service.listStockDispositions(req.user.tenantId, orderId); }
  @Post("stock-dispositions/:dispositionId/restore") restoreDisposition(@Req() req: AuthenticatedRequest, @Param("dispositionId") dispositionId: string) { return this.committed(req.user.tenantId, this.service.restoreStockDisposition(req.user.tenantId, dispositionId, req.user.displayName)); }
  @Post("stock-dispositions/:dispositionId/write-off") writeOffDisposition(@Req() req: AuthenticatedRequest, @Param("dispositionId") dispositionId: string, @Body() body: WriteOffRentalStockDispositionDto) { return this.committed(req.user.tenantId, this.service.writeOffStockDisposition(req.user.tenantId, dispositionId, body.reason, req.user.displayName)); }
  @Put("stock-balances") saveStock(@Req() req: AuthenticatedRequest, @Body() body: SaveRentalStockBalanceDto) { return this.committed(req.user.tenantId, this.service.saveStockBalance(req.user.tenantId, body)); }
  @Get("work-orders") workOrders(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.service.listWorkOrders(req.user.tenantId, status as RentalWorkOrderStatus | undefined);
  }
  @Get("work-order-assignees") workOrderAssignees(@Req() req: AuthenticatedRequest, @Query("locationId") locationId?: string) {
    return this.service.listWorkOrderAssignees(req.user.tenantId, locationId);
  }
  @Get("work-orders/:id/history") workOrderHistory(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.listWorkOrderHistory(req.user.tenantId, id);
  }
  @Post("work-orders") createWorkOrder(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalWorkOrderDto) {
    return this.committed(req.user.tenantId, this.service.createWorkOrder(req.user.tenantId, body, req.user.displayName));
  }
  @Put("work-orders/:id/assign") assignWorkOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: AssignRentalWorkOrderDto) {
    return this.committed(req.user.tenantId, this.service.assignWorkOrder(req.user.tenantId, id, body));
  }
  @Post("work-orders/:id/start") startWorkOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.committed(req.user.tenantId, this.service.startWorkOrder(req.user.tenantId, id, req.user.displayName));
  }
  @Post("work-orders/:id/submit") submitWorkOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: SubmitRentalWorkOrderDto) {
    return this.committed(req.user.tenantId, this.service.submitWorkOrder(req.user.tenantId, id, body, req.user.displayName));
  }
  @Post("work-orders/:id/review") reviewWorkOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: ReviewRentalWorkOrderDto) {
    return this.committed(req.user.tenantId, this.service.reviewWorkOrder(req.user.tenantId, id, body, req.user.displayName));
  }
  @Post("work-orders/:id/cancel") cancelWorkOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalWorkOrderDto) {
    return this.committed(req.user.tenantId, this.service.cancelWorkOrder(req.user.tenantId, id, body, req.user.displayName));
  }
  @Post("availability") availability(@Req() req: AuthenticatedRequest, @Body() body: RentalAvailabilityDto) { return this.service.availability(req.user.tenantId, body); }
  /**
   * R1 工作台统一待办：服务端只聚合当前会话租户/空间内真正可操作的事项。
   * 退款余额来自资金事件流，不能由前端仅凭订单应付金额推算。
   */
  @Get("workbench/todos")
  async workbenchTodos(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenantId;
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const orders = canIncludeWorkbenchOrderTodos(req.user)
      ? await this.service.listOrders(tenantId)
      : [];
    // 工作台允许 report:view 进入，但养护工单属于独立的维护数据权限；没有
    // maintenance:view 时只聚合订单/资金待办，不能借工作台旁路读到工单摘要。
    const workOrders = canIncludeWorkbenchWorkOrders(req.user)
      ? await this.service.listWorkOrders(tenantId)
      : [];
    const extensionsByOrderId: Record<string, RentalOrderExtension[]> = {};
    const fundingByOrderId: Record<string, Awaited<ReturnType<RentalFundingService["listEvents"]>>> = {};

    await Promise.all(orders.map(async (order) => {
      const extensions = await this.service.listOrderExtensions(tenantId, order.id);
      extensionsByOrderId[order.id] = extensions;
      const mayHaveRefund =
        [RentalCoreOrderStatus.Settling, RentalCoreOrderStatus.Completed].includes(order.status) ||
        (order.chargeLines ?? []).some((line) => line.type === "early_return_refund" && Number(line.amount) < 0) ||
        (order.serviceSnapshots ?? []).some((row) => row.refundStatus === "approved_pending_refund") ||
        extensions.some((row) => row.status === "effective" && row.pricingSnapshot?.refundReview?.status === "approved");
      if (mayHaveRefund) {
        fundingByOrderId[order.id] = await this.funding.listEvents(tenantId, workspaceId, order.id);
      }
    }));

    const notificationLogs = canIncludeWorkbenchOrderTodos(req.user)
      ? this.business.listNotificationLogs(tenantId, (await this.context(tenantId)))
      : [];
    const todos = buildRentalWorkbenchTodos(orders, workOrders, fundingByOrderId, extensionsByOrderId, notificationLogs);
    const identity = getRequestIdentity();
    const canConfirmOffline = hasPermissionCode(req.user, "rental-os:order:settle");
    if (identity?.staffApi && canConfirmOffline && orders.length) {
      const pending = await this.prisma.rentalOfflinePaymentRegistration.findMany({
        where: { tenantId, workspaceId, status: "pending", orderId: { in: orders.map((order) => order.id) } },
        include: { order: { select: { orderNo: true } } },
        orderBy: { registeredAt: "asc" }
      });
      const offlineItems = pending.map((row) => ({
        id: `offline_payment_pending:${row.id}`,
        type: "offline_payment_pending" as const,
        priority: "high" as const,
        title: "线下收款待确认",
        description: `${row.order.orderNo} · ${row.instrument === "deposit" ? "押金" : "租金 / 费用"} ¥${Number(row.amount).toFixed(2)}，请核实实际到账后确认。`,
        href: `/rental/orders/${row.orderId}`,
        orderId: row.orderId,
        orderNo: row.order.orderNo,
        amount: Number(row.amount),
        createdAt: row.registeredAt.toISOString()
      }));
      todos.items.push(...offlineItems);
      todos.items.sort((a, b) => (a.priority === b.priority ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : a.priority === "high" ? -1 : 1));
      todos.counts.offline_payment_pending = offlineItems.length;
    }
    return todos;
  }
  /**
   * ORDER-LIST-01：订单列表。筛选与分页在数据库里执行（见事实仓储 `queryOrders`）。
   *
   * 兼容：不带 `page`/`pageSize` 时仍返回纯数组（既有 E2E、seed 脚本与旧页面都按数组读），
   * 带了任一分页参数才返回 `{ items, page, pageSize, total }` 信封。
   * 空间不由客户端传入，与其他路由一样从会话解析。
   */
  @Get("orders") async orders(@Req() req: AuthenticatedRequest, @Query() query: ListRentalOrdersQueryDto) {
    const result = await this.service.queryOrders(req.user.tenantId, query);
    return query.page !== undefined || query.pageSize !== undefined ? result : result.items;
  }
  /**
   * DOC-PRINT-01：订单详情页与 APP 统一读取同一份服务端客户凭证快照。
   * 资金聚合只有财务查看/对账权限时才加入；没有该权限仍可得到脱敏结算凭证，
   * 但不会因为查看订单而旁路读取押金、预授权或收退款明细。
   */
  @Get("orders/:id/documents/:type")
  async orderDocument(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("type") type: string) {
    const includeFinancial = hasPermissionCode(req.user, "rental-os:finance:view") || hasPermissionCode(req.user, "rental-os:finance:reconcile");
    return this.documents.render(req.user.tenantId, id, type, { includeFinancial });
  }
  @Get("orders/:id/documents/:type/versions")
  async orderDocumentVersions(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("type") type: string) {
    return this.documents.listSnapshots(req.user.tenantId, id, type);
  }
  @Get("orders/:id/documents/:type/versions/:snapshotId")
  async orderDocumentVersion(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("type") type: string,
    @Param("snapshotId") snapshotId: string
  ) {
    const includeFinancial = hasPermissionCode(req.user, "rental-os:finance:view") || hasPermissionCode(req.user, "rental-os:finance:reconcile");
    return this.documents.readSnapshot(req.user.tenantId, id, type, snapshotId, { includeFinancial });
  }
  @Get("orders/:id/delivery-address/reveal")
  async revealOrderDeliveryAddress(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const permission = "rental-os:customer:reveal-sensitive";
    if (!hasPermissionCode(req.user, permission)) throw new ForbiddenException("查看完整收件电话需要客户敏感资料解密权限");
    const snapshot = await this.service.getDeliveryAddressForReveal(req.user.tenantId, id);
    await this.operationLogs.record({
      user: req.user,
      action: "order.delivery_address.revealed",
      targetType: "rental-order",
      targetId: id,
      rentalOrderId: id,
      detail: "查看订单完整收件信息（含联系电话）",
      metadata: { fields: ["recipient", "phone", "address"], permission },
      requireSuccess: true
    });
    return snapshot;
  }
  @Get("orders/:id") order(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.getOrder(req.user.tenantId, id); }
  @Post("orders") async createOrder(@Req() req: AuthenticatedRequest, @Body() body: CreateRentalOrderDto) {
    const context = (await this.context(req.user.tenantId));
    // CAM-01A：带风险下单必须「有权限 + 填原因」。原因由 DTO 与能力 Hook 共同保证
    // （空原因不算确认），权限只能在这里判——Hook 上下文里没有鉴权信息，
    // 而 Guard 按路径判权限、看不到请求体，因此这道检查必须落在控制器。
    const OVERRIDE_PERMISSION = "rental-core:capability:override";
    if (body.capabilityExceptions?.length && !hasPermissionCode(req.user, OVERRIDE_PERMISSION)) {
      throw new ForbiddenException("确认能力风险提示需要「能力风险例外确认」权限");
    }
    // Review P1-6：把「谁、凭什么权限、什么时候」补齐后交给下单流程固化成不可变例外快照。
    // 这三项只有控制器知道（鉴权上下文在这里），因此必须在这里补，不能让客户端自报。
    const confirmations = (body.capabilityExceptions ?? []).map((row) => ({
      ...row,
      confirmedBy: req.user.displayName,
      confirmedWithPermission: OVERRIDE_PERMISSION,
      confirmedAt: new Date().toISOString()
    }));
    // 幂等键取标准的 Idempotency-Key 请求头；未传时下单侧退回 quoteId（报价一次性使用）。
    const { order, replayed } = await this.orderConfirmation.createOrder(
      req.user.tenantId,
      { ...body, capabilityExceptions: confirmations },
      req.user.displayName,
      context,
      idempotencyKeyOf(req)
    );
    // 回放时跳过通知：同键重试不该让客户收到第二条「订单已创建」。
    if (!replayed) await this.emitOrderEvent(req.user.tenantId, "order.created", order);
    return this.committed(req.user.tenantId, order);
  }

  /**
   * RULE-CLOSE-01：批量处理已过期的待支付软预占。
   *
   * 这是给定时任务、运维脚本和运营端手动补偿调用的窄入口；候选查询与逐单锁内
   * 复查分开，已经被确认或人工取消的订单只会返回 skipped，不会阻断整批处理。
   */
  @Post("orders/expire-pending")
  async expirePendingOrders(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new BadRequestException("处理数量必须是 1 至 200 的整数");
    }
    const tenantId = req.user.tenantId;
    const candidates = await this.service.listExpiredPendingOrderIds(tenantId, new Date().toISOString(), parsedLimit);
    const processed: Array<{ orderId: string; status: "expired" | "skipped"; reason?: string; replayed?: boolean }> = [];
    for (const orderId of candidates) {
      try {
        const { replayed } = await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.expire_pending",
          key: undefined,
          fallbackKey: `order.expire_pending:${orderId}`,
          request: { orderId, reason: RENTAL_PENDING_PAYMENT_TIMEOUT_REASON },
          orderId,
          run: async (tx) => {
            const expired = await this.service.expirePendingOrder(tenantId, orderId, tx, req.user.displayName);
            await this.releaseCancelledOrderResources(tenantId, orderId, tx, "order_payment_timeout");
            return expired;
          },
          replay: async () => {
            const latest = await this.service.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.Cancelled && latest.cancellationReason === RENTAL_PENDING_PAYMENT_TIMEOUT_REASON
              ? latest
              : undefined;
          }
        });
        processed.push({ orderId, status: "expired", replayed });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        processed.push({ orderId, status: "skipped", reason: error.message });
      }
    }
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, (await this.context(tenantId)));
    await this.service.persist(tenantId);
    return {
      scanned: candidates.length,
      expired: processed.filter((row) => row.status === "expired").length,
      skipped: processed.filter((row) => row.status === "skipped").length,
      results: processed
    };
  }

  /** 订单详情页的单笔操作入口；规则仍在订单行锁内复查，不能绕过批处理语义。 */
  @Post("orders/:id/expire-pending")
  async expirePendingOrder(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.expire_pending",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.expire_pending:${id}`,
      request: { orderId: id, reason: RENTAL_PENDING_PAYMENT_TIMEOUT_REASON },
      orderId: id,
      run: async (tx) => {
        const expired = await this.service.expirePendingOrder(tenantId, id, tx, req.user.displayName);
        await this.releaseCancelledOrderResources(tenantId, id, tx, "order_payment_timeout");
        return expired;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === RentalCoreOrderStatus.Cancelled && latest.cancellationReason === RENTAL_PENDING_PAYMENT_TIMEOUT_REASON
          ? latest
          : undefined;
      }
    });
    if (!replayed) await this.emitOrderEvent(tenantId, "order.cancelled", order);
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, (await this.context(tenantId)));
    return this.committed(tenantId, order);
  }

  /** 领取宽限结束后只进入待确认爽约，不释放资源，也不直接进入终态。 */
  @Post("orders/reconcile-pickup-overdue")
  async reconcilePickupOverdue(@Req() req: AuthenticatedRequest, @Query("limit") limit?: string) {
    const parsedLimit = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new BadRequestException("处理数量必须是 1 至 200 的整数");
    }
    const tenantId = req.user.tenantId;
    const overdueCandidates = await this.service.listPickupOverdueOrderIds(tenantId, new Date().toISOString(), parsedLimit);
    const noShowCandidates = await this.service.listNoShowCandidateIds(tenantId, new Date().toISOString(), parsedLimit);
    const results: Array<{ orderId: string; status: "pickup_overdue" | "no_show" | "skipped"; notice: "recorded" | "pending" | "not_required"; reason?: string }> = [];
    for (const orderId of overdueCandidates) {
      try {
        const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.mark_pickup_overdue",
          key: undefined,
          fallbackKey: `order.mark_pickup_overdue:${orderId}`,
          request: { orderId },
          orderId,
          run: (tx) => this.service.markPickupOverdueOrder(tenantId, orderId, tx, req.user.displayName),
          replay: async () => {
            const latest = await this.service.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.PickupOverdue ? latest : undefined;
          }
        });
        let notice: "recorded" | "pending" | "not_required" = order.noShowNoticeAt ? "recorded" : "pending";
        if (!replayed && !order.noShowNoticeAt) {
          const logs = await this.emitOrderEvent(tenantId, "order.pickup_overdue", order);
          if (logs.length) {
            await this.idempotent.execute({
              tenantId,
              action: "order.no_show_notice",
              key: undefined,
              fallbackKey: `order.no_show_notice:${orderId}`,
              request: { orderId },
              orderId,
              run: (tx) => this.service.recordNoShowNotice(tenantId, orderId, new Date().toISOString(), tx),
              replay: async () => {
                const latest = await this.service.getOrder(tenantId, orderId);
                return latest.noShowNoticeAt ? latest : undefined;
              }
            });
            notice = "recorded";
          }
        }
        results.push({ orderId, status: "pickup_overdue", notice });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        results.push({ orderId, status: "skipped", notice: "not_required", reason: error.message });
      }
    }
    for (const orderId of noShowCandidates) {
      try {
        const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
          tenantId,
          action: "order.confirm_no_show",
          key: undefined,
          fallbackKey: `order.confirm_no_show:${orderId}`,
          request: { orderId, reason: "领取超时且最终时限已到" },
          orderId,
          run: async (tx) => {
            const confirmed = await this.service.confirmNoShowOrder(tenantId, orderId, "领取超时且最终时限已到", tx, req.user.displayName);
            await this.releaseCancelledOrderResources(tenantId, orderId, tx, "order_no_show");
            return confirmed;
          },
          replay: async () => {
            const latest = await this.service.getOrder(tenantId, orderId);
            return latest.status === RentalCoreOrderStatus.NoShow ? latest : undefined;
          }
        });
        if (!replayed) await this.emitOrderEvent(tenantId, "order.no_show", order);
        results.push({ orderId, status: "no_show", notice: "recorded" });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        results.push({ orderId, status: "skipped", notice: "not_required", reason: error.message });
      }
    }
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, (await this.context(tenantId)));
    await this.service.persist(tenantId);
    return {
      scanned: overdueCandidates.length + noShowCandidates.length,
      pickupOverdue: results.filter((row) => row.status === "pickup_overdue").length,
      noShow: results.filter((row) => row.status === "no_show").length,
      skipped: results.filter((row) => row.status === "skipped").length,
      noticePending: results.filter((row) => row.notice === "pending").length,
      results
    };
  }

  @Post("orders/:id/mark-pickup-overdue")
  async markPickupOverdue(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.mark_pickup_overdue",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.mark_pickup_overdue:${id}`,
      request: { orderId: id },
      orderId: id,
      run: (tx) => this.service.markPickupOverdueOrder(tenantId, id, tx, req.user.displayName),
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === RentalCoreOrderStatus.PickupOverdue ? latest : undefined;
      }
    });
    let committedOrder = order;
    if (!replayed && !order.noShowNoticeAt) {
      const logs = await this.emitOrderEvent(tenantId, "order.pickup_overdue", order);
      if (logs.length) {
        const noticed = await this.idempotent.execute({
          tenantId,
          action: "order.no_show_notice",
          key: undefined,
          fallbackKey: `order.no_show_notice:${id}`,
          request: { orderId: id },
          orderId: id,
          run: (tx) => this.service.recordNoShowNotice(tenantId, id, new Date().toISOString(), tx),
          replay: async () => {
            const latest = await this.service.getOrder(tenantId, id);
            return latest.noShowNoticeAt ? latest : undefined;
          }
        });
        committedOrder = noticed;
      }
    }
    return this.committed(tenantId, committedOrder);
  }

  @Post("orders/:id/no-show-notice")
  async sendNoShowNotice(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const current = await this.service.getOrder(tenantId, id);
    if (current.status !== RentalCoreOrderStatus.PickupOverdue) throw new ConflictException("订单不在待确认爽约状态");
    const context = (await this.context(tenantId));
    const logs = await this.business.emitNotificationEvent(
      tenantId,
      context,
      "order.pickup_overdue",
      current.contactPhone ?? current.customerId,
      { customerName: current.customerName, orderNo: current.orderNo },
      { type: "order", id: current.id }
    );
    if (!logs.length && !current.noShowNoticeAt) {
      const failed = this.business.listNotificationLogs(tenantId, context).some(
        (log) => log.eventCode === "order.pickup_overdue" &&
          log.businessObjectType === "order" &&
          log.businessObjectId === current.id &&
          (log.status === "simulation_failed" || log.status === "failed" || log.status === "delivery_failed" || log.status === "delivery_uncertain")
      );
      throw new ConflictException(
        failed
          ? "通知发送失败，客户通知尚未记录；请处理工作台待办后重试"
          : "当前空间没有启用待确认爽约通知模板"
      );
    }
    const { result: order } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.no_show_notice",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.no_show_notice:${id}`,
      request: { orderId: id },
      orderId: id,
      run: (tx) => this.service.recordNoShowNotice(tenantId, id, new Date().toISOString(), tx),
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.noShowNoticeAt ? latest : undefined;
      }
    });
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/confirm-no-show")
  async confirmNoShow(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalOrderDto) {
    const tenantId = req.user.tenantId;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.confirm_no_show",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.confirm_no_show:${id}`,
      request: { orderId: id, reason: body.reason },
      orderId: id,
      run: async (tx) => {
        const confirmed = await this.service.confirmNoShowOrder(tenantId, id, body.reason, tx, req.user.displayName, new Date().toISOString(), true);
        await this.releaseCancelledOrderResources(tenantId, id, tx, "order_no_show");
        return confirmed;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === RentalCoreOrderStatus.NoShow ? latest : undefined;
      }
    });
    if (!replayed) await this.emitOrderEvent(tenantId, "order.no_show", order);
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, (await this.context(tenantId)));
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/resume-pickup")
  async resumePickup(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalOrderDto) {
    const tenantId = req.user.tenantId;
    // 兜底键不纳入状态：恢复领取会把 PickupOverdue 改成 ReadyForPickup，
    // 纳入状态会让无键重试算出不同键而重放失败；非法转移由 replay 只在目标状态回放来兜底。
    const { result: order } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.resume_pickup",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.resume_pickup:${id}`,
      request: { orderId: id, reason: body.reason },
      orderId: id,
      run: (tx) => this.service.resumePickupOverdueOrder(tenantId, id, tx, req.user.displayName),
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === RentalCoreOrderStatus.ReadyForPickup ? latest : undefined;
      }
    });
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/confirm") async confirm(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.confirm",
      key: idempotencyKeyOf(req),
      // 兜底键**不得**纳入当前状态：状态会被本动作改掉，纳入后无键网络重试
      // 算出的键与首次登记的键不同，查不到记录就落回状态机报 409——幂等失效。
      // 非法转移由下面的 replay 拒绝：只有订单确实处于本动作的目标状态才回放，
      // 已完成订单再次确认因状态不符而返回 undefined，交由状态机给出 409。
      fallbackKey: `order.confirm:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        const usesCredit = await this.usesCorporateCredit(tenantId, id, tx);
        await this.funding.assertReadyForConfirmation(
          tenantId,
          this.service.resolveWorkspaceId(tenantId),
          id,
          tx,
          { skipRentalPayment: usesCredit }
        );
        const confirmed = await this.service.confirmOrder(tenantId, id, tx, req.user.displayName);
        if (usesCredit) await this.corporateSettlement?.reserveOrderCredit(tenantId, id, tx, req.user.displayName);
        await this.serviceCapacities.confirmForOrder(tenantId, id, new Date().toISOString(), tx);
        await this.business.redeemCouponInTransaction(tenantId, id, tx);
        return confirmed;
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        // 只有已达成目标状态才算同一次意图的重试；否则交回状态机拒绝。
        return current.status === RentalCoreOrderStatus.Reserved ? current : undefined;
      }
    });
    // 内部权益已与订单同事务提交；此处只发布已提交的数据到进程缓存。
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(tenantId, (await this.context(tenantId)));
    // 回放时跳过通知：通知是外部副作用，同键重试不该让客户收到第二条短信。
    if (!replayed) await this.emitOrderEvent(tenantId, "order.confirmed", order);
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/allocate") async allocate(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.allocate",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.allocate:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        const current = await this.service.getOrder(tenantId, id);
        const assigned = await this.allocation.manage(tenantId, id, { action: "preassign", expectedRevision: current.assignment?.revision ?? 0 }, tx, req.user.displayName);
        return this.allocation.manage(tenantId, id, { action: "lock", expectedRevision: assigned.assignment!.revision }, tx, req.user.displayName);
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.ReadyForPickup ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Get("orders/:id/allocation-candidates") async allocationCandidates(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("exchangeOrderLineId") exchangeOrderLineId?: string,
    @Query("replacementItemGroupId") replacementItemGroupId?: string
  ) {
    const tenantId = req.user.tenantId;
    if (!exchangeOrderLineId && !replacementItemGroupId) return this.allocation.candidates(tenantId, id);
    if (!exchangeOrderLineId || !replacementItemGroupId) throw new BadRequestException("换货候选查询必须同时指定订单行和替换型号");

    const order = await this.service.getOrder(tenantId, id);
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以查询换货候选");
    const line = order.lines.find((row) => row.id === exchangeOrderLineId);
    if (!line || !["serialized", "quantity"].includes(line.inventoryMode)) throw new BadRequestException("换货订单行不存在或库存方式不支持");
    const activeLineQuantity = line.quantity - (line.cancelledQuantity ?? 0);
    const pickedUpQuantity = order.allocations
      .filter((row) => row.orderLineId === line.id && row.status === "picked_up")
      .reduce((sum, row) => sum + row.quantity, 0);
    if (pickedUpQuantity !== activeLineQuantity) {
      throw new ConflictException("只有整行已领取的商品可以查询换货候选");
    }
    const replacementGroup = this.service.listItemGroups(tenantId).find((row) => row.id === replacementItemGroupId);
    if (!replacementGroup || replacementGroup.status !== "enabled" || replacementGroup.inventoryMode !== line.inventoryMode || replacementGroup.id === line.itemGroupId) {
      throw new BadRequestException("替换型号必须是不同于原商品、且启用中的同类库存型号");
    }

    const reservation = order.reservations.find((row) => row.orderLineId === line.id && row.status === "fulfilled");
    if (!reservation) throw new ConflictException("订单行没有已履约的资源预留");
    const replacementAssets = line.inventoryMode === "serialized"
      ? await this.prisma.$transaction((tx) => this.allocation.exchangeAssetCandidates(tenantId, order, replacementGroup.id, order.fulfillmentLocationId, tx))
      : [];
    return {
      revision: order.assignment?.revision ?? 0,
      reservations: [{
        reservationId: reservation.id,
        orderLineId: line.id,
        itemGroupId: replacementGroup.id,
        itemGroupName: replacementGroup.name,
        locationId: order.fulfillmentLocationId,
        inventoryMode: line.inventoryMode,
        quantity: activeLineQuantity,
        assignedQuantity: pickedUpQuantity,
        lockedQuantity: pickedUpQuantity,
        models: [{ itemGroupId: replacementGroup.id, name: replacementGroup.name, enabled: true }],
        candidates: replacementAssets
      }]
    };
  }
  @Post("orders/:id/assignments") async manageAllocations(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: ManageRentalAllocationDto) {
    if (["unlock", "release", "reassign"].includes(body.action) && !hasPermissionCode(req.user, "rental-os:order:reassign")) throw new ForbiddenException("解锁、释放及改配需要独立的资源改配权限");
    const tenantId = req.user.tenantId;
    return this.idempotent.execute({ tenantId, action: "order.assignment", key: idempotencyKeyOf(req), fallbackKey: `assignment:${id}:${body.expectedRevision}`, orderId: id, request: { id, ...body },
      run: (tx) => this.allocation.manage(tenantId, id, body, tx, req.user.displayName),
      replay: async () => this.service.getOrder(tenantId, id) });
  }
  @Get("orders/:id/internal-notes") async listInternalOrderNotes(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const workspaceId = getRequestIdentity()?.workspaceId;
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    await this.service.getOrder(tenantId, id);
    const rows = await this.prisma.operationLog.findMany({
      where: { tenantId, workspaceId, rentalOrderId: id, action: "rental.order.internal_note" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, userId: true, createdAt: true, detail: true }
    });
    return rows.map((row) => {
      const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail) ? row.detail as Record<string, unknown> : {};
      return { id: row.id, content: String(detail.content ?? ""), operatorName: String(detail.operator ?? "员工"), createdAt: row.createdAt.toISOString(), operatorId: row.userId ?? undefined };
    });
  }
  @Post("orders/:id/internal-notes") async createInternalOrderNote(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalOrderInternalNoteDto) {
    const tenantId = req.user.tenantId;
    const workspaceId = getRequestIdentity()?.workspaceId;
    const content = body.content.trim();
    const key = idempotencyKeyOf(req);
    if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
    if (!content || content.length > 1000) throw new BadRequestException("内部备注请填写 1 至 1000 个字符");
    if (!key) throw new BadRequestException("内部备注必须提供 Idempotency-Key");
    return this.idempotent.execute({
      tenantId,
      action: "order.internal_note",
      key,
      fallbackKey: `order.internal-note:${id}:${key}`,
      request: { orderId: id, content },
      orderId: id,
      run: async (tx) => {
        const order = await tx.rentalOrder.findFirst({ where: { id, tenantId, workspaceId }, select: { id: true } });
        if (!order) throw new ForbiddenException("订单不存在或不在当前经营空间");
        const row = await tx.operationLog.create({
          data: {
            tenantId, workspaceId, userId: req.user.id, rentalOrderId: id,
            action: "rental.order.internal_note",
            detail: { content, operator: req.user.displayName } as Prisma.InputJsonValue
          },
          select: { id: true, userId: true, createdAt: true, detail: true }
        });
        return { id: row.id, content, operatorName: req.user.displayName, createdAt: row.createdAt.toISOString(), operatorId: row.userId ?? undefined };
      },
      replay: async (response) => response && typeof response === "object" && typeof (response as { id?: unknown }).id === "string" ? response as { id: string; content: string; operatorName: string; createdAt: string; operatorId?: string } : undefined
    });
  }
  @Post("orders/:id/operation-lock") async operationLock(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOperationLockDto) {
    const allowed: RentalCoreOrderStatus[] = [];
    const operate = hasPermissionCode(req.user, "rental-os:order:operate");
    if (operate || hasPermissionCode(req.user, "rental-os:order:pickup")) allowed.push(RentalCoreOrderStatus.ReadyForPickup);
    if (operate || hasPermissionCode(req.user, "rental-os:order:return")) allowed.push(RentalCoreOrderStatus.Renting);
    if (body.action === "force-release") {
      if (!hasPermissionCode(req.user, "rental-os:order:reassign")) throw new ForbiddenException("人工解除交接锁需要资源改配权限");
      if (!body.reason?.trim()) throw new BadRequestException("人工解除交接锁必须填写原因");
      allowed.splice(0, allowed.length, RentalCoreOrderStatus.ReadyForPickup, RentalCoreOrderStatus.Renting);
      const key = idempotencyKeyOf(req);
      if (!key) throw new BadRequestException("人工解除交接锁必须提供 Idempotency-Key");
      return this.idempotent.execute({
        tenantId: req.user.tenantId,
        action: "order.operation_lock.force_release",
        key,
        fallbackKey: `operation-lock-force-release:${id}:${key}`,
        request: { orderId: id, action: body.action, reason: body.reason.trim() },
        orderId: id,
        run: (tx) => this.allocation.operationLock(req.user.tenantId, id, body.action, req.user.id, req.user.displayName, body.token, allowed, body.reason, tx),
        replay: async (response) => response && typeof response === "object" && (response as { released?: unknown }).released === true ? response as { released: true; releasedOwnerName: string; expiresAt: string } : undefined
      });
    }
    return this.allocation.operationLock(req.user.tenantId, id, body.action, req.user.id, req.user.displayName, body.token, allowed);
  }
  @Post("orders/:id/substitute-bundle-component") async substituteBundleComponent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: SubstituteRentalBundleComponentDto
  ) {
    const tenantId = req.user.tenantId;
    const fallbackHash = createHash("sha256")
      .update([body.orderLineId, body.fromItemGroupId, body.toItemGroupId].join(":"))
      .digest("hex")
      .slice(0, 32);
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.bundle-component.substitute",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.bundle-substitute:${id}:${fallbackHash}`,
      request: { orderId: id, ...body },
      orderId: id,
      run: (tx) => this.service.substituteBundleComponent(tenantId, id, body, tx),
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Reserved && current.reservations.some((row) =>
          row.orderLineId === body.orderLineId && row.itemGroupId === body.toItemGroupId
        ) ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/partial-return") async partialReturn(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: PartialReturnRentalOrderDto
  ) {
    const tenantId = req.user.tenantId;
    const current = await this.service.getOrder(tenantId, id);
    if (current.fulfillmentMode === "carrier_shipping") {
      throw new ConflictException("承运寄送订单不可部分归还；客户交寄后库存仍保持在途占用，须待仓库整单验收");
    }
    const idempotencyKey = idempotencyKeyOf(req);
    // 部分归还是**天然可重复**的动作：数量库存租 3 件，先还 1 件、再还 1 件是两次
    // 真实归还，而两次请求体完全相同。此前兜底键是「订单 + 分配项内容哈希」，
    // 于是第二次被判成第一次的重试直接丢弃——客户还了两件，系统只记一件。
    //
    // 也不能改用「当前已归还进度」做兜底键：那会让第一次请求的网络重试因为进度
    // 已变而被当成新归还，重复扣减库存。可重复动作的幂等只能由调用方标识，
    // 因此这里 fail-closed：两个标识都没有就拒绝，宁可让调用方补一个，
    // 也不能静默丢掉一次真实归还。
    if (!idempotencyKey && !body.batchNo) {
      throw new BadRequestException(
        "部分归还必须提供 Idempotency-Key 请求头或 batchNo，用于区分多次真实归还与同一次的网络重试"
      );
    }
    if (idempotencyKey && body.batchNo && idempotencyKey !== body.batchNo) throw new BadRequestException("部分归还批次号必须与 Idempotency-Key 一致");
    const evidenceBatchId = body.batchNo ?? idempotencyKey ?? `order.partial-return:${id}`;
    await this.assertStaffHandoverEvidence(req, current, "return", evidenceBatchId, body.handoverSignatureFileAssetId);
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.partial-return",
      key: idempotencyKey,
      fallbackKey: `order.partial-return:${id}:${body.batchNo}`,
      request: { orderId: id, items: body.items, batchNo: body.batchNo, handoverSignatureFileAssetId: body.handoverSignatureFileAssetId },
      orderId: id,
      run: async (tx) => {
        const returnedAt = new Date().toISOString();
        const charges = await this.returnCharges(
          tenantId,
          (await this.context(tenantId)),
          id,
          returnedAt,
          tx,
          body.items,
          body.batchNo ?? idempotencyKey ?? "partial-return",
          false
        );
        return this.service.partialReturnOrder(tenantId, id, body, tx, charges);
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Renting ? current : undefined;
      }
    });
    return this.committed(tenantId, order);
  }
  @Post("orders/:id/cancel") async cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CancelRentalOrderDto) {
    const context = (await this.context(req.user.tenantId));
    const { result: order, replayed: cancelReplayed } = await this.idempotent.executeWithReplayFlag({
      tenantId: req.user.tenantId,
      action: "order.cancel",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.cancel:${id}`,
      // 取消原因与天气例外参与指纹：同键换内容属调用方错误，
      // 必须报冲突而不是静默沿用第一次的原因与费用。
      request: { orderId: id, reason: body.reason, weatherException: Boolean(body.weatherException) },
      orderId: id,
      run: async (tx) => {
        const cancelled = await this.service.cancelOrder(
          req.user.tenantId,
          id,
          body.reason,
          (lockedOrder) => this.business.calculateCancellationCharge(
            req.user.tenantId,
            context,
            this.business.getQuote(req.user.tenantId, context, lockedOrder.quoteId),
            undefined,
            Boolean(body.weatherException),
            // 取消费改按订单冻结的规则快照计算（订单无冻结费率，费率仍取报价）；缺失时计算侧回落报价并告警一次。
            { ruleSnapshot: lockedOrder.ruleSnapshot }
          ),
          tx,
          req.user.displayName
        );
        await this.releaseCancelledOrderResources(req.user.tenantId, id, tx, "order_cancelled");
        return cancelled;
      },
      replay: async () => {
        const latest = await this.service.getOrder(req.user.tenantId, id);
        return latest.status === RentalCoreOrderStatus.Cancelled ? latest : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    await this.business.refreshCouponTemplateCache(req.user.tenantId, context);
    if (!cancelReplayed) await this.emitOrderEvent(req.user.tenantId, "order.cancelled", order);
    return this.committed(req.user.tenantId, order);
  }
  /**
   * 续租的结算方式：个人与企业预付都要客户补款，企业月结不需要补款动作。
   *
   * 月结资格读**客户主档的企业授信**（`customer_corporate_credits`）：它以
   * `CustomerProfile.id` 为键，与订单快照里的 `corporateCustomerId` 同一套 id。
   * 不能读旧车辆域的 `Corporate` 表——那张表有自己独立的 uuid 主键，与订单上的
   * `customerId` 没有任何关联，按它查永远查不到，月结分支会静默变成死代码。
   *
   * 两道前提都必须成立：
   *
   * 1. **企业既是签约方也是付款方**（`enterpriseContractAndPayer`）。企业员工用个人
   *    身份付款的订单虽然也带企业信息，但钱是个人出的，仍然要补款。
   * 2. **授信记录仍然有效**且账期不是按单结。`suspended` / `revoked` 的企业不允许
   *    继续挂账——续租会让欠款接着涨。
   *
   * 查不到资格时一律回落到"要补款"——宁可多问客户一次，也不要把不该挂账的单
   * 挂进月结。已经逾期时按规则可强制先付：逾期说明履约已经出问题，这时继续挂账
   * 只会让欠款接着累积。
   */
  private async resolveExtensionSettlement(
    tenantId: string,
    order: { customerType: string; membershipSnapshot?: RentalMembershipSnapshot; endAt: string; effectiveEndAt?: string },
    forceImmediateWhenOverdue: boolean
  ): Promise<"immediate" | "monthly"> {
    const overdue = new Date(order.effectiveEndAt ?? order.endAt).getTime() < Date.now();
    if (overdue && forceImmediateWhenOverdue) return "immediate";
    const corporateCustomerId = order.membershipSnapshot?.enterpriseContractAndPayer
      ? order.membershipSnapshot.corporateCustomerId
      : undefined;
    if (!corporateCustomerId) return "immediate";
    const credit = await this.prisma.customerCorporateCredit.findFirst({
      where: { tenantId, customerId: corporateCustomerId, status: "active" },
      select: { billingCycle: true }
    });
    if (!credit || credit.billingCycle === "per_order") return "immediate";
    return "monthly";
  }

  private async priceExtension(tenantId: string, orderId: string, body: RentalOrderExtensionDto, tx?: Prisma.TransactionClient) {
    const context = (await this.context(tenantId));
    // 申请路径传 tx：必须在事务内锁住订单行之后再加载订单、有效续租与可用量，
    // 否则定价和可用量判定用的是锁之前的事实。试算路径不传，只作展示。
    const order = tx
      ? await this.service.lockOrderForUpdate(tenantId, orderId, tx)
      : await this.service.getOrder(tenantId, orderId);
    if (order.fulfillmentMode === "carrier_shipping") {
      const events = await this.carrierShipmentEvents(tenantId, orderId, tx);
      if (order.status !== RentalCoreOrderStatus.Renting || !order.actualRentalStartAt || !events.some((row) => row.type === "customer_signed")) {
        throw new ConflictException("承运寄送订单须在客户签收起租后才能续租");
      }
      if (events.some((row) => row.type === "customer_handoff")) {
        throw new ConflictException("客户已交承运商，计租已停止，不能再续租；费用将于仓库验收时统一核算");
      }
    }
    await this.service.assertOrderExtensionAvailable(tenantId, order, body.newEndAt, tx);
    const previousExtensions = await this.service.listOrderExtensions(tenantId, orderId, tx);
    const rule = effectiveExtensionRule(order.ruleSnapshot);
    const settlementMode = await this.resolveExtensionSettlement(tenantId, order, rule.forceImmediateWhenOverdue);
    return {
      order,
      priced: await this.business.quoteOrderExtension(tenantId, context, {
        order,
        previousExtensions,
        lines: order.lines,
        newEndAt: body.newEndAt,
        services: body.services,
        appliedAt: new Date().toISOString(),
        settlementMode,
        fulfillmentMode: order.fulfillmentMode,
        locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((value): value is string => Boolean(value)),
        customerType: order.customerType,
        ...(order.fulfillmentMode === "carrier_shipping" ? {
          mode: "carrier_repricing" as const,
          actualStartAt: order.actualRentalStartAt
        } : {})
      })
    };
  }

  @Get("orders/:id/extensions") extensions(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.listOrderExtensions(req.user.tenantId, id);
  }

  @Get("orders/:id/changes") changes(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.listOrderChanges(req.user.tenantId, id);
  }

  @Post("orders/:id/changes/post-pickup-exchange/preview")
  async previewPostPickupExchange(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: PreviewRentalOrderChangeDto) {
    if (body.type !== "post_pickup_exchange") throw new BadRequestException("换货试算请求类型必须是 post_pickup_exchange");
    const result = await this.pricePostPickupExchange(req.user.tenantId, id, body);
    return result.preview;
  }

  @Post("orders/:id/changes/post-pickup-exchange")
  async applyPostPickupExchange(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: ApplyRentalOrderChangeDto) {
    if (body.type !== "post_pickup_exchange") throw new BadRequestException("换货应用请求类型必须是 post_pickup_exchange");
    const tenantId = req.user.tenantId;
    const normalized = {
      ...body,
      orderLineId: body.orderLineId?.trim(),
      allocationId: body.allocationId?.trim(),
      replacementItemGroupId: body.replacementItemGroupId?.trim(),
      replacementAssetId: body.replacementAssetId?.trim(),
      replacementPricingGroupId: body.replacementPricingGroupId?.trim(),
      priceBasis: body.priceBasis ?? "original_order_price",
      originalDisposition: body.originalDisposition ?? "return_to_warehouse",
      exchangeLocationId: body.exchangeLocationId?.trim() || undefined,
      cancelServiceOccurrenceIds: [...new Set((body.cancelServiceOccurrenceIds ?? []).map((value) => value.trim()).filter(Boolean))]
    };
    const exchangeInput = { ...normalized, type: "post_pickup_exchange" as const };
    const requestFingerprint = JSON.stringify(exchangeInput);
    const explicitKey = idempotencyKeyOf(req);
    const fallbackKey = `order.change.post-pickup-exchange:${id}:${createHash("sha256").update(requestFingerprint).digest("hex")}`;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.change.post-pickup-exchange",
      key: explicitKey,
      fallbackKey,
      request: { orderId: id, ...exchangeInput },
      orderId: id,
      run: async (tx) => {
        const priced = await this.pricePostPickupExchange(tenantId, id, exchangeInput, tx);
        if (body.expectedUpdatedAt !== priced.order.updatedAt) throw new ConflictException("订单已发生变化，请重新试算后再提交");
        const applied = await this.service.applyPostPickupExchange(
          tenantId,
          id,
          priced.preview,
          exchangeInput,
          explicitKey ?? fallbackKey,
          req.user.displayName,
          tx
        );
        if (applied.change.additionalAmount > 0 && await this.usesCorporateCredit(tenantId, id, tx)) {
          await this.corporateSettlement?.reserveOrderChangeCredit(
            tenantId,
            id,
            applied.change.id,
            applied.change.additionalAmount,
            tx,
            req.user.displayName
          );
        }
        return applied;
      },
      replay: async () => {
        const rows = await this.service.listOrderChanges(tenantId, id);
        const existing = rows.find((row) => row.idempotencyKey === (explicitKey ?? fallbackKey));
        return existing ? { order: await this.service.getOrder(tenantId, id), change: existing } : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    return { order: await this.committed(tenantId, result.order), change: result.change };
  }

  /** 取货前部分取消试算：不落库、不释放资源、不改变优惠券预算。数量库存可按数量拆分，序列化资产只能整行。 */
  @Post("orders/:id/changes/partial-cancel/preview")
  async previewPartialLineCancellation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: PreviewRentalOrderChangeDto) {
    const result = body.type === "service_cancel"
      ? await this.priceServiceCancellation(req.user.tenantId, id, body)
      : await this.priceLineCancellation(req.user.tenantId, id, body);
    return result.preview;
  }

  /**
   * 应用部分取消：客户确认、重新报价、优惠券预算、资金释放、资源释放与变更记录
   * 必须在同一个幂等事务内完成。租金负差额只形成待退款账，不伪造第三方退款成功。
   */
  @Post("orders/:id/changes/partial-cancel")
  async applyPartialLineCancellation(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: ApplyRentalOrderChangeDto) {
    const tenantId = req.user.tenantId;
    const lineIds = body.lineIds?.map((value) => value.trim()).filter(Boolean).sort();
    const items = body.items?.map((item) => ({ lineId: item.lineId.trim(), quantity: item.quantity })).sort((a, b) => a.lineId.localeCompare(b.lineId));
    const serviceOccurrenceIds = body.serviceOccurrenceIds?.map((value) => value.trim()).filter(Boolean).sort();
    const serviceItems = body.serviceItems?.map((item) => ({ occurrenceId: item.occurrenceId.trim(), quantity: item.quantity })).sort((a, b) => a.occurrenceId.localeCompare(b.occurrenceId));
    const requestFingerprint = JSON.stringify({ type: body.type, lineIds: lineIds ?? [], items: items ?? [], serviceOccurrenceIds: serviceOccurrenceIds ?? [], serviceItems: serviceItems ?? [] });
    const explicitKey = idempotencyKeyOf(req);
    const fallbackKey = `order.change.partial-cancel:${id}:${createHash("sha256").update(requestFingerprint).digest("hex")}`;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.change.partial-cancel",
      key: explicitKey,
      fallbackKey,
      request: { orderId: id, ...body, lineIds, items, serviceItems },
      orderId: id,
      run: async (tx) => {
        const priced = body.type === "service_cancel"
          ? await this.priceServiceCancellation(tenantId, id, { type: body.type, lineIds, items, serviceOccurrenceIds, serviceItems }, tx)
          : await this.priceLineCancellation(tenantId, id, { type: body.type, lineIds, items }, tx);
        if (body.expectedUpdatedAt !== priced.order.updatedAt) throw new ConflictException("订单已发生变化，请重新试算后再提交");
        if (!body.customerConfirmed) throw new ConflictException("必须先取得客户确认才能应用订单变更");
        await this.releaseLineCancellationSecurity(tenantId, id, priced.priced, explicitKey ?? fallbackKey, req.user.displayName, tx);
        if (priced.scope === "line" && priced.priced.pricingSnapshot?.couponEvaluation) {
          await this.business.repriceCouponForOrder(
            tenantId,
            id,
            priced.priced.pricingSnapshot.recalculatedCouponAmount,
            tx
          );
        }
        return this.service.applyPartialLineCancellation(
          tenantId,
          id,
          priced.priced,
          {
            ...body,
            type: priced.scope === "service" ? "service_cancel" : "partial_line_cancel",
            lineIds: priced.scope === "line" ? priced.cancellationItems.map((item) => item.lineId) : undefined,
            items: priced.scope === "line" ? priced.cancellationItems.map((item) => ({ lineId: item.lineId, quantity: item.quantity })) : undefined,
            serviceOccurrenceIds: priced.scope === "service" ? priced.serviceOccurrenceIds : undefined,
            serviceItems: priced.scope === "service" ? priced.serviceItems : undefined
          },
          explicitKey ?? fallbackKey,
          req.user.displayName,
          tx
        );
      },
      replay: async (response) => {
        const rows = await this.service.listOrderChanges(tenantId, id);
        const existing = rows.find((row) => row.idempotencyKey === (explicitKey ?? fallbackKey));
        return existing ? { order: await this.service.getOrder(tenantId, id), change: existing } : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    return { order: await this.committed(tenantId, result.order), change: result.change };
  }

  /** 续租试算：只算钱不落库，供客户/运营确认。APP 与后台共用。 */
  @Post("orders/:id/extensions/preview")
  async previewExtension(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOrderExtensionDto) {
    const { priced } = await this.priceExtension(req.user.tenantId, id, body);
    const { rateSnapshot, ruleSnapshot, ...preview } = priced;
    return preview;
  }

  /**
   * 续租新增服务的容量占用。续租**生效**时才占，不在申请时软预留。
   *
   * 需求 4.6.9 是「完成补款后再延长占用和租期」，待补款申请刻意不动订单占用；服务容量
   * 同口径。软预留还有一个坑：`releaseExpired` 到期只把行改成 expired 而**保留幂等键**，
   * 于是补款晚于 15 分钟时再调 `reserveForOrder` 会命中既有行直接跳过，容量被静默丢掉。
   * 生效时一次性预留 + 确认，就没有过期窗口。
   *
   * 不能直接对整单调 `reserveForOrder`：它会按新 requestKey 给 `order.serviceSnapshots`
   * 里**全部**服务再建一遍预留，等于把订单原有服务重复占用。只传本次新增的快照。
   * 紧接着的 `confirmForOrder` 只动 `reserved` 状态的行——续租只发生在租赁中/待领取的
   * 订单上，原有服务此时已是 confirmed/used，因此确认的正好只有刚建的这几条。
   */
  private async occupyExtensionServices(
    tenantId: string,
    orderId: string,
    extension: RentalOrderExtension,
    tx: Prisma.TransactionClient
  ) {
    if (!extension.serviceSnapshots?.length) return;
    await this.serviceCapacities.reserveForOrder(
      tenantId,
      { id: orderId, serviceSnapshots: extension.serviceSnapshots, reservations: [] },
      extensionRequestKey(extension.id),
      tx
    );
    await this.serviceCapacities.confirmForOrder(tenantId, orderId, extension.effectiveAt ?? new Date().toISOString(), tx);
  }

  @Post("orders/:id/extensions")
  async applyExtension(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: RentalOrderExtensionDto) {
    const tenantId = req.user.tenantId;
    const key = idempotencyKeyOf(req) ?? `order.extend:${id}:${body.newEndAt}`;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.extend",
      key: idempotencyKeyOf(req),
      // 新归还时间进兜底键：同一订单先后申请两次不同的延长，是两笔业务而不是重放。
      fallbackKey: `order.extend:${id}:${body.newEndAt}`,
      request: { orderId: id, newEndAt: body.newEndAt, services: body.services ?? [] },
      orderId: id,
      run: async (tx) => {
        const { priced } = await this.priceExtension(tenantId, id, body, tx);
        const result = await this.service.requestOrderExtension(
          tenantId,
          id,
          priced,
          { idempotencyKey: key, memo: body.memo, operator: req.user.displayName },
          tx
        );
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        // 企业月结无需补款、申请即生效，因此这里就要占住新增服务的容量。
        // 待补款的申请不占：占用与租期都等补款到账（需求 4.6.9）。
        if (result.extension.status === "effective") {
          await this.corporateSettlement?.reserveExtensionCredit(
            tenantId,
            id,
            result.extension.id,
            result.extension.payableAmount,
            tx,
            req.user.displayName
          );
          await this.occupyExtensionServices(tenantId, id, result.extension, tx);
        }
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const existing = rows.find((row) => row.idempotencyKey === key);
        return existing ? { order: await this.service.getOrder(tenantId, id), extension: existing } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  /** 续租补款到账：记录生效、延长占用与租期（需求 4.6.9「完成补款后再延长」）。 */
  @Post("orders/:id/extensions/:extensionId/pay")
  async payExtension(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("extensionId") extensionId: string
  ) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.extend.pay",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.extend.pay:${extensionId}`,
      request: { orderId: id, extensionId },
      orderId: id,
      run: async (tx) => {
        await this.funding.assertExtensionPaid(tenantId, this.service.resolveWorkspaceId(tenantId), id, extensionId, tx);
        const result = await this.service.payOrderExtension(tenantId, id, extensionId, tx);
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        // 补款到账、续租生效：这一刻才占住新增服务的容量，与延长租期同一个事务。
        await this.occupyExtensionServices(tenantId, id, result.extension, tx);
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const existing = rows.find((row) => row.id === extensionId && row.status === "effective");
        return existing ? { order: await this.service.getOrder(tenantId, id), extension: existing } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  /**
   * 裁定费用审核单（需求 4.6.10 人工催收 / 4.6.8 人工审核退款）。
   *
   * 与续租差额退款审核同一形态：批准才落账，未裁定则 `settleOrder` 拒绝关单。
   */
  @Post("orders/:id/fee-reviews/:reviewId/review")
  async reviewOrderFeeReview(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("reviewId") reviewId: string, @Body() body: ReviewRentalOrderFeeReviewDto) {
    const tenantId = req.user.tenantId;
    const order = await this.idempotent.execute({
      tenantId, action: "order.fee-review", key: idempotencyKeyOf(req),
      fallbackKey: `order.fee-review:${reviewId}`, request: { orderId: id, reviewId, ...body }, orderId: id,
      run: (tx) => this.service.reviewOrderFeeReview(tenantId, id, reviewId, body, req.user.displayName, tx),
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return (latest.feeReviews ?? []).some((row) => row.id === reviewId && row.status === body.decision) ? latest : undefined;
      }
    });
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/extensions/:extensionId/refund-review")
  async reviewExtensionRefund(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Param("extensionId") extensionId: string, @Body() body: ReviewRentalExtensionRefundDto) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId, action: "order.extend.refund-review", key: idempotencyKeyOf(req),
      fallbackKey: `order.extend.refund-review:${extensionId}`, request: { orderId: id, extensionId, ...body }, orderId: id,
      run: async (tx) => {
        const result = await this.service.reviewExtensionRefund(tenantId, id, extensionId, body, req.user.displayName, tx);
        await this.business.synchronizeExtensionCoupon(tenantId, result.extension, tx);
        return result;
      },
      replay: async () => {
        const rows = await this.service.listOrderExtensions(tenantId, id);
        const extension = rows.find((row) => row.id === extensionId && row.pricingSnapshot?.refundReview?.status === body.decision);
        return extension ? { order: await this.service.getOrder(tenantId, id), extension } : undefined;
      }
    });
    return { order: await this.committed(tenantId, result.order), extension: result.extension };
  }

  /**
   * 归还计费的基准在**锁内**重取后再算。
   *
   * 逾期费与提前归还退款都以订单"当前约定归还时间"为准，而这些值此前取自事务外读到的
   * 订单快照：`current.effectiveEndAt`、最后一笔已生效续租的报价快照、以及仍未交回的数量。
   * 订单行的锁要到 `createInspection` 内部才加上，于是快照与锁之间存在一段时间窗——
   * 期间一笔续租生效（`payOrderExtension` 同样先锁订单行，两者可被同一把锁串行化），
   * 归还就会按旧租期判逾期，把刚续上的单多收一笔；`extensionPricing` 漏掉新续租时，
   * 提前归还退款还会按错的租金基数算。先锁再算，这个窗口就不存在了。
   *
   * `quote` 是报价冻结快照、`context` 是配置内存态，两者都不是竞态输入，
   * 因此仍从内存取；重取的只有订单派生的那几个值。
   */
  private async returnCharges(
    tenantId: string,
    context: BusinessContext,
    orderId: string,
    returnedAt: string,
    tx: Prisma.TransactionClient,
    partialReturnItems?: Array<{ allocationId: string; quantity: number }>,
    batchId?: string,
    includeEarlyReturn = true
  ) {
    const locked = await this.service.lockOrderForUpdate(tenantId, orderId, tx);
    const quote = this.business.getQuote(tenantId, context, locked.quoteId);
    const dueAt = locked.fulfillmentMode === "carrier_shipping" ? rentalOrderDueAt(locked) : (locked.effectiveEndAt ?? locked.endAt);
    const extensions = (await this.service.listOrderExtensions(tenantId, orderId, tx))
      .filter((row) => row.status === "effective").at(-1)?.pricingSnapshot;
    const quantityScope = partialReturnItems
      ? returnedQuantitiesOf(locked, partialReturnItems)
      : outstandingQuantitiesOf(locked);
    if (locked.fulfillmentMode === "carrier_shipping") {
      if (partialReturnItems) throw new ConflictException("承运寄送必须在仓库实物验收时整单结算，不能部分释放在途库存");
      const events = await this.carrierShipmentEvents(tenantId, orderId, tx);
      const signed = events.find((row) => row.type === "customer_signed");
      const handoff = events.find((row) => row.type === "customer_handoff");
      if (!signed || !handoff || !signed.evidenceFileAssetIds.length || !handoff.evidenceFileAssetIds.length) {
        throw new ConflictException("缺少已核验的客户签收或交寄凭证；保持库存占用并转人工核实，不能自动归还结算");
      }
      const signedAt = signed.occurredAt.toISOString();
      const handoffAt = handoff.occurredAt.toISOString();
      if (!locked.actualRentalStartAt || new Date(locked.actualRentalStartAt).getTime() !== signed.occurredAt.getTime()) {
        throw new ConflictException("订单计租起点与客户签收证据不一致；保持库存占用并转人工核实");
      }
      const window = carrierBillableWindow({ signedAt, handoffAt });
      if (!window) throw new ConflictException("客户签收和交寄时间无有效计租区间；保持库存占用并转人工核实");
      const billableEndAt = new Date(Math.min(Date.parse(window.endAt), Date.parse(dueAt))).toISOString();
      if (Date.parse(billableEndAt) <= Date.parse(window.startAt)) throw new ConflictException("承运计租时段与原租期不匹配；保持库存占用并转人工核实");
      const priorExtensions = await this.service.listOrderExtensions(tenantId, orderId, tx);
      const repriced = await this.business.quoteOrderExtension(tenantId, context, {
        order: locked,
        previousExtensions: priorExtensions,
        lines: locked.lines,
        newEndAt: billableEndAt,
        appliedAt: returnedAt,
        settlementMode: "immediate",
        fulfillmentMode: locked.fulfillmentMode,
        locationIds: [locked.fulfillmentLocationId, locked.returnLocationId].filter((value): value is string => Boolean(value)),
        customerType: locked.customerType,
        mode: "carrier_return_repricing",
        actualStartAt: window.startAt
      });
      return {
        overdue: {
          amount: Date.parse(handoffAt) > Date.parse(dueAt)
            ? this.business.calculateOverdueCharge(tenantId, context, quote, handoffAt, dueAt, quantityScope, { ruleSnapshot: locked.ruleSnapshot })
            : 0,
          returnedAt: handoffAt,
          batchId
        },
        carrierRentalAdjustment: {
          amount: repriced.pricingSnapshot?.differenceAmount ?? 0,
          signedAt,
          handoffAt,
          priceVersion: repriced.priceVersion
        },
        earlyReturn: undefined
      };
    }
    return {
      overdue: {
        // 归还计费的规则与费率取订单冻结快照（§4.2），而非报价缓存；缺字段时计算侧回落报价并告警一次。
        amount: this.business.calculateOverdueCharge(tenantId, context, quote, returnedAt, dueAt, quantityScope, { ruleSnapshot: locked.ruleSnapshot }),
        returnedAt,
        batchId
      },
      earlyReturn: includeEarlyReturn
        ? this.business.calculateEarlyReturnRefund(tenantId, context, quote, dueAt, returnedAt, extensionRentalOf(locked), extensions, { ruleSnapshot: locked.ruleSnapshot })
        : undefined
    };
  }

  @Get("inspection-templates") templates(@Req() req: AuthenticatedRequest, @Query("stage") stage?: "pickup" | "return") { return this.service.listInspectionTemplates(req.user.tenantId, stage); }  @Get("orders/:id/inspections") inspections(@Req() req: AuthenticatedRequest, @Param("id") id: string) { return this.service.listInspections(req.user.tenantId, id); }
  @Post("orders/:id/inspections") async createInspection(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() body: CreateRentalInspectionDto) {
    const tenantId = req.user.tenantId;
    const context = (await this.context(tenantId));
    const current = await this.service.getOrder(tenantId, id);
    const template = this.service.listInspectionTemplates(tenantId).find((row) => row.id === body.templateId);
    const returnedAt = new Date().toISOString();
    const stage = template?.stage;
    const partialReturn = stage === "return" && Boolean(body.returnItems?.length);
    // 带 returnItems 的归还检查是分批归还的**第二个入口**，与 partial-return 同一个坑：
    // 分配项内容哈希分不清"第二次归还相同数量"和"第一次的网络重试"。同样 fail-closed。
    const inspectionKey = idempotencyKeyOf(req);
    if (partialReturn && !inspectionKey && !body.returnBatchNo) {
      throw new BadRequestException(
        "分批归还检查必须提供 Idempotency-Key 请求头或 returnBatchNo，用于区分多次真实归还与同一次的网络重试"
      );
    }
    if (partialReturn && inspectionKey && body.returnBatchNo && inspectionKey !== body.returnBatchNo) throw new BadRequestException("检查归还批次号必须与 Idempotency-Key 一致");
    const evidenceBatchId = inspectionKey ?? body.returnBatchNo ?? `order.inspection:${id}:${stage ?? "unknown"}:${body.returnBatchNo ?? "whole"}`;
    const attachments = await this.assertStaffHandoverEvidence(
      req, current, stage === "return" ? "return" : "pickup", evidenceBatchId,
      body.handoverSignatureFileAssetId, body.attachments ?? [], template, body.results
    );
    const evidenceIds = inspectionEvidenceIds({ attachments, results: body.results, handoverSignatureFileAssetId: body.handoverSignatureFileAssetId });
    const orderRule = current.ruleSnapshot as { fulfillment?: { evidenceRequired?: boolean } } | undefined;
    const currentRule = this.business.effectiveRuleAt(tenantId, context)?.config;
    const evidenceRequired = orderRule?.fulfillment?.evidenceRequired ?? currentRule?.fulfillment?.evidenceRequired ?? false;
    const evidenceError = inspectionEvidenceRequiredError(evidenceRequired, evidenceIds);
    if (evidenceError) throw new BadRequestException(evidenceError);
    if (evidenceIds.length) {
      const workspaceId = getRequestIdentity()?.workspaceId;
      if (!workspaceId) throw new ForbiddenException("缺少已验证的经营空间");
      const expectedScene = stage === "return" ? "return-evidence" : "pickup-evidence";
      const allowedScenes = current.fulfillmentMode === "carrier_shipping"
        ? [expectedScene, "handover-signature", "carrier-shipment-evidence"]
        : [expectedScene, "handover-signature"];
      const evidenceAssets = await this.prisma.fileAsset.findMany({
        where: {
          id: { in: evidenceIds }, tenantId, businessModule: "rental-core", businessType: "rental_order",
          businessId: id, status: "active", uploadScene: { in: allowedScenes }
        },
        select: { id: true, mimeType: true, uploadedBy: true, metadata: true, uploadScene: true }
      });
      if (evidenceAssets.length !== evidenceIds.length || evidenceAssets.some((file) => current.fulfillmentMode === "carrier_shipping"
        ? !file.mimeType.startsWith("image/") && file.mimeType !== "application/pdf"
        : !file.mimeType.startsWith("image/") && !file.mimeType.startsWith("video/"))) {
        throw new BadRequestException(current.fulfillmentMode === "carrier_shipping"
          ? "承运检查凭证必须是已完成上传、属于当前订单的图片或 PDF"
          : "检查影像必须是已完成上传、属于当前订单和检查阶段的图片或视频");
      }
      if (getRequestIdentity()?.staffApi && evidenceAssets.some((file) => file.uploadedBy !== req.user.id)) {
        throw new BadRequestException("员工端只能提交当前员工上传的检查影像");
      }
    }
    if (current.fulfillmentMode === "carrier_shipping" && stage === "return") {
      await this.assertCarrierProofFiles(req, id, evidenceIds, ["return-evidence", "carrier-shipment-evidence"]);
      if (partialReturn) throw new ConflictException("承运寄送须仓库整单验收后统一结算，不能部分归还");
    }
    const submissionBody = { ...body, attachments, ...(getRequestIdentity()?.staffApi ? { operator: req.user.displayName } : {}) };
    // 逾期费与提前归还退款都在事务内锁单之后重算（见 returnCharges）。这里只留下
    // 与订单当前事实无关的判定。
    if (stage === "pickup" && current.fulfillmentMode !== "carrier_shipping") await this.business.assertPickupOpenAt(tenantId, context, current.fulfillmentLocationId, returnedAt, current.fulfillmentMode);
    // 归还只进入待结算；资金账处理完后再独立关闭订单。
    const targetStatus = stage === "pickup" || partialReturn ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Settling;
    // 逾期通知要按真实逾期费判断是否发。它在 run 里才算出来，而只有 run 真的执行过
    // （未被幂等回放）时下面才会读它——回放路径不重复发通知。
    let overdueAmount = 0;
    const { result, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.inspection",
      key: inspectionKey,
      // 键按订单 + 阶段：同一阶段的检查只应生效一次，换阶段是另一个动作。
      // 不纳入订单当前状态（理由见执行器注释），也不纳入 returnedAt——
      // 那是服务端每次取的当前时间，纳入后每次重试都算出新键，幂等直接失效。
      // 分批归还按调用方给的批次号区分，整单归还固定用 "whole"。
      fallbackKey: `order.inspection:${id}:${stage ?? "unknown"}:${body.returnBatchNo ?? "whole"}`,
      // returnedAt 同样不能进指纹，否则重试必然被判为"同键不同内容"而 409。
      request: {
        orderId: id,
        templateId: submissionBody.templateId,
        results: submissionBody.results,
        returnItems: submissionBody.returnItems ?? [],
        returnBatchNo: submissionBody.returnBatchNo,
        exceptions: submissionBody.exceptions ?? [],
        // 检查照片/证据引用属于请求事实的一部分；必须进入幂等指纹，
        // 否则同一批次先空提交、后补证据会被错误当作同一次请求回放。
        attachments: submissionBody.attachments ?? [],
        handoverSignatureFileAssetId: submissionBody.handoverSignatureFileAssetId,
        carrierActualAt: submissionBody.carrierActualAt
      },
      orderId: id,
      run: async (tx) => {
        if (stage === "pickup") {
          if (current.fulfillmentMode === "carrier_shipping") {
            const locked = await this.service.lockOrderForUpdate(tenantId, id, tx);
            await this.recordCarrierSignedAtPickup(req, locked, body.carrierActualAt, evidenceIds, tx);
          }
          const usesCredit = await this.usesCorporateCredit(tenantId, id, tx);
          if (usesCredit) await this.corporateSettlement?.assertReadyForPickup(tenantId, id, tx);
          await this.funding.assertReadyForPickup(
            tenantId,
            this.service.resolveWorkspaceId(tenantId),
            id,
            tx,
            { skipRentalPayment: usesCredit }
          );
        }
        const charges = stage === "return"
          ? await this.returnCharges(
              tenantId,
              context,
              id,
              returnedAt,
              tx,
              partialReturn ? body.returnItems : undefined,
              partialReturn ? (body.returnBatchNo ?? inspectionKey ?? "inspection-return") : undefined,
              !partialReturn
            )
          : undefined;
        overdueAmount = charges?.overdue.amount ?? 0;
        if (stage === "return" && current.fulfillmentMode === "carrier_shipping") {
          const events = await this.carrierShipmentEvents(tenantId, id, tx);
          const error = carrierShipmentEventError({
            mode: current.fulfillmentMode, orderStatus: current.status, eventType: "warehouse_received", occurredAt: returnedAt,
            events: events.map((row) => ({ type: row.type as RentalCarrierShipmentEventType, occurredAt: row.occurredAt }))
          });
          if (error) throw new ConflictException(`${error}；保持库存占用并转人工核实`);
        }
        const created = await this.service.createInspection(tenantId, id, submissionBody, req.user.displayName, charges ?? {}, tx);
        if (stage === "return" && current.fulfillmentMode === "carrier_shipping") {
          const handoff = (await this.carrierShipmentEvents(tenantId, id, tx)).find((row) => row.type === "customer_handoff");
          if (!handoff) throw new ConflictException("缺少客户交寄运单，不能登记仓库验收");
          await tx.rentalCarrierShipmentEvent.create({
            data: {
              tenantId, workspaceId: this.service.resolveWorkspaceId(tenantId), orderId: id,
              type: "warehouse_received", occurredAt: new Date(returnedAt), carrierName: handoff.carrierName,
              trackingNumber: handoff.trackingNumber, evidenceFileAssetIds: evidenceIds,
              recordedBy: req.user.displayName,
              idempotencyKey: createHash("sha256").update(`${id}:warehouse-received:${inspectionKey ?? evidenceBatchId}`).digest("hex")
            }
          });
        }
        if (stage === "return" && !partialReturn) await this.serviceCapacities.settleReturnForOrder(tenantId, created.order, returnedAt, tx);
        return created;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        if (latest.status !== targetStatus) return undefined;
        const recorded = (await this.service.listInspections(tenantId, id)).filter((row) => row.stage === stage).at(-1);
        return recorded ? { inspection: recorded, order: latest } : undefined;
      }
    });
    if (stage === "return" && !partialReturn) await this.business.refreshFromDatabase();
    if (!replayed) {
      if (!partialReturn) await this.emitOrderEvent(tenantId, result.inspection.stage === "pickup" ? "pickup.completed" : "return.completed", result.order);
      // 归还确实逾期（费用 > 0）才发逾期通知——这是真实业务事实，不是凭空造事件。
      // 与 return.completed 各自独立幂等，因此同一次归还两条通知都只发一次。
      if (stage === "return" && overdueAmount > 0) {
        await this.emitOrderEvent(tenantId, "order.overdue", result.order);
      }
    }
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/inspections/:inspectionId/usage-correction")
  async correctInspectionUsage(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("inspectionId") inspectionId: string,
    @Body() body: CorrectRentalInspectionUsageDto
  ) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.inspection-usage-correction",
      key: idempotencyKeyOf(req),
      fallbackKey: `inspection-usage-correction:${inspectionId}:${body.fieldCode}:${body.correctedCurrent}`,
      request: { orderId: id, inspectionId, ...body },
      orderId: id,
      run: async (tx) => ({ inspection: await this.service.correctInspectionUsage(tenantId, id, inspectionId, body, req.user.displayName, tx) }),
      replay: async () => {
        const inspection = (await this.service.listInspections(tenantId, id)).find((row) => row.id === inspectionId);
        const correction = inspection?.usageCorrections?.find((row) =>
          row.fieldCode === body.fieldCode && row.to === body.correctedCurrent && row.reason === body.reason.trim()
        );
        return correction && inspection ? { inspection } : undefined;
      }
    });
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/handover/:stage") async handover(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("stage") stage: string,
    @Body() body: RentalHandoverDto = {}
  ) {
    if (stage !== "pickup" && stage !== "return") throw new BadRequestException("交接阶段无效");
    const tenantId = req.user.tenantId;
    const context = (await this.context(tenantId));
    const current = await this.service.getOrder(tenantId, id);
    const handoverBatchId = idempotencyKeyOf(req) ?? `order.handover:${id}:${stage}`;
    await this.assertStaffHandoverEvidence(req, current, stage, handoverBatchId, body.handoverSignatureFileAssetId);
    const returnedAt = new Date().toISOString();
    if (stage === "pickup") {
      // 需求 4.6.4：领取前必须重新校验……营业状态（4.5.4：报价与订单分别校验端点）。
      // 按实际领取时刻判定，早取/迟取都要看当前门店是否还办理领取。
      // 归还刻意不复查——停业不得让在租订单失去归还渠道（需求 4.5.4）。
      await this.business.assertPickupOpenAt(tenantId, context, current.fulfillmentLocationId, returnedAt, current.fulfillmentMode);
    }
    // 归还计费同样在事务内锁单后重算（见 returnCharges）；这里只保留领取侧的营业校验。
    const targetStatus = stage === "pickup" ? RentalCoreOrderStatus.Renting : RentalCoreOrderStatus.Settling;
    // 与归还检查同理：逾期费在 run 内才算出，只有 run 真的执行过时下面才会读它。
    let overdueAmount = 0;
    const { result: order, replayed } = await this.idempotent.executeWithReplayFlag({
      tenantId,
      action: "order.handover",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.handover:${id}:${stage}`,
      request: { orderId: id, stage, handoverSignatureFileAssetId: body.handoverSignatureFileAssetId },
      orderId: id,
      run: async (tx) => {
        if (stage === "pickup") {
          const usesCredit = await this.usesCorporateCredit(tenantId, id, tx);
          if (usesCredit) await this.corporateSettlement?.assertReadyForPickup(tenantId, id, tx);
          await this.funding.assertReadyForPickup(
            tenantId,
            this.service.resolveWorkspaceId(tenantId),
            id,
            tx,
            { skipRentalPayment: usesCredit }
          );
        }
        const charges = stage === "return" ? await this.returnCharges(tenantId, context, id, returnedAt, tx) : undefined;
        overdueAmount = charges?.overdue.amount ?? 0;
        const completed = await this.service.completeHandoverWithoutInspection(tenantId, id, stage, overdueAmount, tx, req.user.displayName, charges?.earlyReturn);
        if (stage === "return") await this.serviceCapacities.settleReturnForOrder(tenantId, completed, returnedAt, tx);
        return completed;
      },
      replay: async () => {
        const latest = await this.service.getOrder(tenantId, id);
        return latest.status === targetStatus ? latest : undefined;
      }
    });
    if (stage === "return") await this.business.refreshFromDatabase();
    if (!replayed) {
      await this.emitOrderEvent(tenantId, stage === "pickup" ? "pickup.completed" : "return.completed", order);
      // 无检查直接交接的归还路径同样按真实逾期费判断是否发逾期通知。
      if (stage === "return" && overdueAmount > 0) {
        await this.emitOrderEvent(tenantId, "order.overdue", order);
      }
    }
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/settle") async settle(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const context = (await this.context(tenantId));
    const order = await this.idempotent.execute({
      tenantId,
      action: "order.settle",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.settle:${id}`,
      request: { orderId: id },
      orderId: id,
      run: async (tx) => {
        // 先锁订单行，再查待审异常与资金余额。此前顺序是反的：异常查询和
        // assertReadyToClose 之间没有共同的锁，一笔并发的费用裁定或收退款可以插在
        // 中间，结算就按旧事实判定——欠款订单被关掉、刚生成的待审事项被跳过。
        // 锁与费用裁定（reviewOrderFeeReview）、资金事件（lockedOrderScope）同一行。
        const locked = await this.service.lockOrderForUpdate(tenantId, id, tx);
        if (locked.fulfillmentMode === "carrier_shipping") {
          const events = await this.carrierShipmentEvents(tenantId, id, tx);
          const warehouseReceipt = events.find((row) => row.type === "warehouse_received");
          if (!warehouseReceipt || !warehouseReceipt.evidenceFileAssetIds.length) {
            throw new ConflictException("承运寄送订单尚未完成仓库实物验收；在途库存不得释放或关闭订单");
          }
        }
        const inspectionRows = await tx.rentalInspectionRecord.findMany({
          where: { tenantId, workspaceId: this.service.resolveWorkspaceId(tenantId), orderId: id },
          select: { exceptions: true }
        });
        const hasPendingException = inspectionRows.some((row) =>
          (row.exceptions as unknown as Array<{ reviewStatus?: string }>).some((exception) => exception.reviewStatus === "pending")
        );
        if (hasPendingException) throw new ConflictException("仍有检查异常待审核，不能关闭订单");
        const hasUnconfirmedException = inspectionRows.some((row) =>
          (row.exceptions as unknown as Array<{ reviewStatus?: string; approvedChargeAmount?: number; customerResponseStatus?: string }>).some((exception) =>
            exception.reviewStatus === "approved" && Number(exception.approvedChargeAmount ?? 0) > 0
              && (exception.customerResponseStatus === "pending" || exception.customerResponseStatus === "disputed")
          )
        );
        if (hasUnconfirmedException) throw new ConflictException("还有检查异常费用待客户确认或申诉处理，不能关闭订单");
        const usesCredit = await this.usesCorporateCredit(tenantId, id, tx);
        await this.funding.assertReadyToClose(
          tenantId,
          this.service.resolveWorkspaceId(tenantId),
          id,
          tx,
          { skipRentalPayment: usesCredit }
        );
        const settled = await this.service.settleOrder(tenantId, id, tx, req.user.displayName);
        if (usesCredit) await this.corporateSettlement?.settleOrderCredit(tenantId, id, tx, req.user.displayName);
        await this.business.completeCustomerOrderEventInTransaction(tenantId, context, settled.customerId, tx);
        return settled;
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        return current.status === RentalCoreOrderStatus.Completed ? current : undefined;
      }
    });
    await this.business.refreshFromDatabase();
    return this.committed(tenantId, order);
  }

  @Post("orders/:id/services/:occurrenceId/execution")
  async updateServiceOccurrence(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("occurrenceId") occurrenceId: string,
    @Body() body: UpdateRentalServiceOccurrenceDto
  ) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.service-execution",
      key: idempotencyKeyOf(req),
      fallbackKey: `order.service-execution:${id}:${occurrenceId}:${body.action}`,
      request: { orderId: id, occurrenceId, ...body },
      orderId: id,
      run: (tx) => this.service.updateServiceOccurrence(tenantId, id, occurrenceId, body, req.user.displayName, tx),
      replay: async (response) => {
        const current = await this.service.getOrder(tenantId, id);
        const occurrence = current.serviceSnapshots?.find((row) => row.occurrenceId === occurrenceId);
        if (!occurrence) return undefined;
        const terminal = body.action === "start"
          ? occurrence.executionStatus === "in_progress"
          : ["completed", "cancelled", "failed", "no_show"].includes(occurrence.executionStatus ?? "");
        return terminal ? { order: current, occurrence } : undefined;
      }
    });
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/services/:occurrenceId/refund")
  async refundServiceOccurrence(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("occurrenceId") occurrenceId: string,
    @Body() body: RefundRentalServiceDto
  ) {
    const tenantId = req.user.tenantId;
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.service-refund",
      key: body.idempotencyKey,
      fallbackKey: `order.service-refund:${id}:${occurrenceId}`,
      request: { orderId: id, occurrenceId, ...body },
      orderId: id,
      run: async (tx) => {
        // 资金事件和服务快照必须同成同败，避免“钱已退但服务仍显示待退款”或反过来。
        // 资金事件使用服务域命名空间，避免调用方偶然复用一个通用退款幂等键，
        // 把另一笔退款事件误当成当前服务退款的资金事实。
        const fundingIdempotencyKey = `service-refund:${createHash("sha256").update(`${id}:${occurrenceId}:${body.idempotencyKey}`).digest("hex")}`;
        await this.funding.recordEvent(
          tenantId,
          this.service.resolveWorkspaceId(tenantId),
          id,
          { instrument: "rental", action: "refund", amount: body.amount, idempotencyKey: fundingIdempotencyKey, reason: body.reason, paymentMethod: this.service.resolveOfflinePaymentMethod(tenantId, body.paymentMethod) },
          req.user.displayName,
          tx
        );
        return this.service.refundServiceOccurrence(tenantId, id, occurrenceId, body.amount, req.user.displayName, tx);
      },
      replay: async () => {
        const current = await this.service.getOrder(tenantId, id);
        const occurrence = current.serviceSnapshots?.find((row) => row.occurrenceId === occurrenceId);
        return occurrence?.refundStatus === "refunded" ? { order: current, occurrence } : undefined;
      }
    });
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/inspections/:inspectionId/exceptions/:exceptionIndex/review")
  async reviewInspectionException(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("inspectionId") inspectionId: string,
    @Param("exceptionIndex") exceptionIndexText: string,
    @Body() body: ReviewRentalInspectionExceptionDto
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const exceptionIndex = Number(exceptionIndexText);
    if (!Number.isInteger(exceptionIndex) || exceptionIndex < 0) throw new BadRequestException("异常序号无效");
    if (body.decision === "approved" && body.approvedChargeAmount === undefined) throw new BadRequestException("审核通过时必须填写最终费用");
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.inspection-exception.review",
      key: idempotencyKeyOf(req),
      fallbackKey: `inspection-exception.review:${inspectionId}:${exceptionIndex}`,
      request: { orderId: id, inspectionId, exceptionIndex, ...body },
      orderId: id,
      run: async (tx) => {
        const row = await tx.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        if (!row) throw new BadRequestException("检查记录不存在");
        const exceptions = structuredClone(row.exceptions as unknown as Array<Record<string, unknown>>);
        const exception = exceptions[exceptionIndex];
        if (!exception) throw new BadRequestException("检查异常不存在");
        if (exception.reviewStatus !== "pending") throw new ConflictException("该检查异常已经审核，不能重复改写");
        const approvedAmount = body.decision === "approved" ? Number(body.approvedChargeAmount) : 0;
        const approved = await this.service.approveInspectionException(
          tenantId, id, inspectionId, exceptionIndex, approvedAmount,
          `${String(exception.description)}；审核：${body.reason}`, tx, row.createdAt.toISOString()
        );
        Object.assign(exception, {
          reviewStatus: body.decision,
          approvedChargeAmount: approved.approvedChargeAmount,
          customerResponseStatus: body.decision === "approved" && approved.approvedChargeAmount > 0 ? "pending" : "not_required",
          customerResponseHistory: [],
          reviewReason: body.reason,
          reviewedBy: req.user.displayName,
          reviewedAt: new Date().toISOString()
        });
        await tx.rentalInspectionRecord.update({ where: { id: inspectionId }, data: { exceptions: exceptions as Prisma.InputJsonValue } });
        return { order: approved.order, inspectionId, exceptionIndex, exception };
      },
      replay: async () => {
        const row = await this.prisma.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        const exception = (row?.exceptions as unknown as Array<Record<string, unknown>> | undefined)?.[exceptionIndex];
        if (!exception || exception.reviewStatus !== body.decision) return undefined;
        return { order: await this.service.getOrder(tenantId, id), inspectionId, exceptionIndex, exception };
      }
    });
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/inspections/:inspectionId/exceptions/:exceptionIndex/customer-response")
  async recordInspectionExceptionCustomerResponse(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("inspectionId") inspectionId: string,
    @Param("exceptionIndex") exceptionIndexText: string,
    @Body() body: RecordRentalInspectionExceptionCustomerResponseDto
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const exceptionIndex = Number(exceptionIndexText);
    if (!Number.isInteger(exceptionIndex) || exceptionIndex < 0) throw new BadRequestException("异常序号无效");
    const responseFallbackHash = createHash("sha256")
      .update(JSON.stringify({ inspectionId, exceptionIndex, decision: body.decision, reason: body.reason.trim() }))
      .digest("hex")
      .slice(0, 32);
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.inspection-exception.customer-response",
      key: idempotencyKeyOf(req),
      fallbackKey: `inspection-exception.customer-response:${inspectionId}:${exceptionIndex}:${responseFallbackHash}`,
      request: { orderId: id, inspectionId, exceptionIndex, ...body },
      orderId: id,
      run: async (tx) => {
        const order = await this.service.lockOrderForUpdate(tenantId, id, tx);
        const row = await tx.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        if (!row) throw new BadRequestException("检查记录不存在");
        const exceptions = structuredClone(row.exceptions as unknown as Array<Record<string, unknown>>);
        const exception = exceptions[exceptionIndex];
        if (!exception) throw new BadRequestException("检查异常不存在");
        const error = validateInspectionCustomerResponse({
          reviewStatus: exception.reviewStatus as "pending" | "approved" | "rejected",
          approvedChargeAmount: Number(exception.approvedChargeAmount ?? 0),
          currentStatus: exception.customerResponseStatus as "not_required" | "pending" | "confirmed" | "disputed" | undefined,
          decision: body.decision
        });
        if (error) throw new ConflictException(error);
        const respondedAt = new Date().toISOString();
        const history = Array.isArray(exception.customerResponseHistory)
          ? exception.customerResponseHistory as Array<Record<string, unknown>>
          : [];
        history.push({ decision: body.decision, reason: body.reason, operator: req.user.displayName, respondedAt });
        Object.assign(exception, {
          customerResponseStatus: body.decision,
          customerResponseReason: body.reason,
          customerRespondedBy: req.user.displayName,
          customerRespondedAt: respondedAt,
          customerResponseHistory: history
        });
        await tx.rentalInspectionRecord.update({ where: { id: inspectionId }, data: { exceptions: exceptions as Prisma.InputJsonValue } });
        return { order, inspectionId, exceptionIndex, exception };
      },
      replay: async () => {
        const row = await this.prisma.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        const exception = (row?.exceptions as unknown as Array<Record<string, unknown>> | undefined)?.[exceptionIndex];
        if (!exception || exception.customerResponseStatus !== body.decision) return undefined;
        return { order: await this.service.getOrder(tenantId, id), inspectionId, exceptionIndex, exception };
      }
    });
    return this.committed(tenantId, result);
  }

  @Post("orders/:id/inspections/:inspectionId/exceptions/:exceptionIndex/re-review")
  async reReviewInspectionException(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("inspectionId") inspectionId: string,
    @Param("exceptionIndex") exceptionIndexText: string,
    @Body() body: AdjustRentalInspectionExceptionDto
  ) {
    const tenantId = req.user.tenantId;
    const workspaceId = this.service.resolveWorkspaceId(tenantId);
    const exceptionIndex = Number(exceptionIndexText);
    if (!Number.isInteger(exceptionIndex) || exceptionIndex < 0) throw new BadRequestException("异常序号无效");
    const reviewFallbackHash = createHash("sha256")
      .update(JSON.stringify({ inspectionId, exceptionIndex, approvedChargeAmount: body.approvedChargeAmount, reason: body.reason.trim() }))
      .digest("hex")
      .slice(0, 32);
    const result = await this.idempotent.execute({
      tenantId,
      action: "order.inspection-exception.re-review",
      key: idempotencyKeyOf(req),
      fallbackKey: `inspection-exception.re-review:${inspectionId}:${exceptionIndex}:${reviewFallbackHash}`,
      request: { orderId: id, inspectionId, exceptionIndex, ...body },
      orderId: id,
      run: async (tx) => {
        await this.service.lockOrderForUpdate(tenantId, id, tx);
        const row = await tx.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        if (!row) throw new BadRequestException("检查记录不存在");
        const exceptions = structuredClone(row.exceptions as unknown as Array<Record<string, unknown>>);
        const exception = exceptions[exceptionIndex];
        if (!exception) throw new BadRequestException("检查异常不存在");
        if (exception.reviewStatus !== "approved" || exception.customerResponseStatus !== "disputed") {
          throw new ConflictException("只有已审核且客户已申诉的异常费用可以复核");
        }
        const previousAmount = Number(exception.approvedChargeAmount ?? 0);
        const adjustmentHistory = Array.isArray(exception.adjustmentHistory)
          ? exception.adjustmentHistory as Array<Record<string, unknown>>
          : [];
        const adjusted = await this.service.adjustInspectionExceptionCharge(
          tenantId,
          id,
          inspectionId,
          exceptionIndex,
          previousAmount,
          Number.isFinite(Number(exception.suggestedChargeAmount)) ? Number(exception.suggestedChargeAmount) : undefined,
          Number(body.approvedChargeAmount),
          body.reason,
          req.user.displayName,
          adjustmentHistory.length + 1,
          tx
        );
        const adjustedAt = new Date().toISOString();
        adjustmentHistory.push({ fromAmount: previousAmount, toAmount: adjusted.approvedChargeAmount, reason: body.reason, operator: req.user.displayName, adjustedAt });
        Object.assign(exception, {
          approvedChargeAmount: adjusted.approvedChargeAmount,
          customerResponseStatus: adjusted.approvedChargeAmount > 0 ? "pending" : "not_required",
          adjustmentHistory
        });
        delete exception.customerResponseReason;
        delete exception.customerRespondedBy;
        delete exception.customerRespondedAt;
        await tx.rentalInspectionRecord.update({ where: { id: inspectionId }, data: { exceptions: exceptions as Prisma.InputJsonValue } });
        return { order: adjusted.order, inspectionId, exceptionIndex, exception };
      },
      replay: async () => {
        const row = await this.prisma.rentalInspectionRecord.findFirst({ where: { id: inspectionId, tenantId, workspaceId, orderId: id } });
        const exception = (row?.exceptions as unknown as Array<Record<string, unknown>> | undefined)?.[exceptionIndex];
        const history = Array.isArray(exception?.adjustmentHistory) ? exception.adjustmentHistory as Array<Record<string, unknown>> : [];
        const latest = history.at(-1);
        if (!exception || Number(latest?.toAmount) !== Number(body.approvedChargeAmount) || latest?.reason !== body.reason) return undefined;
        return { order: await this.service.getOrder(tenantId, id), inspectionId, exceptionIndex, exception };
      }
    });
    return this.committed(tenantId, result);
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
