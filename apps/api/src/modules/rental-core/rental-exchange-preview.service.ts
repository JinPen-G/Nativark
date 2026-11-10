/** Original post-pickup exchange preview shared by authorized application adapters.
 * Locks and reprices original facts; does not authorize, apply, collect money or
 * replace the caller's Guard, customer ownership or enterprise approval checks. */
import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RentalCoreOrderStatus, type EnterpriseExchangeChoicesQuery, type EnterpriseExchangeChoices, type ApplyRentalOrderChangeRequest, type RentalOrder, type RentalOrderChangePreview, type RentalOrderExchangePriceBasis, type RentalOrderExchangeDisposition, type RentalOrderExchangeInspectionSnapshot } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import { RentalAllocationService } from "./rental-allocation.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { exchangePickupInspectionRequirements } from "./rental-exchange-inspection";
import { exchangeServiceConfirmationHash } from "./rental-service-catalog";
import { serviceCancellationAmounts } from "./rental-service-cancellation";

type ExchangeIntent = Pick<ApplyRentalOrderChangeRequest, "orderLineId" | "allocationId" | "replacementItemGroupId" | "replacementAssetId" | "replacementPricingGroupId" | "priceBasis" | "originalDisposition" | "exchangeLocationId" | "inspectionSnapshot" | "cancelServiceOccurrenceIds" | "services">;
const roundMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

@Injectable()
export class RentalExchangePreviewService {
  constructor(private readonly core: RentalCoreService, private readonly business: RentalBusinessService,
    private readonly allocation: RentalAllocationService, private readonly prisma: PrismaService,
    @Optional() private readonly serviceCapacities?: RentalServiceCapacityService) {}

  private async context(tenantId: string): Promise<BusinessContext> {
    const profile = this.core.getProfile(tenantId), category = await this.core.getWorkspaceCategory(tenantId);
    return { profile, category, settings: this.core.getBusinessSettings(tenantId), groups: this.core.listItemGroups(tenantId), pricingGroups: this.core.listPricingGroups(tenantId),
      couponTemplates: this.core.listCouponTemplates(tenantId), locations: this.core.listLocations(tenantId), operators: this.core.listOperators(tenantId) };
  }

  private exchangeable(order: RentalOrder, allocationId: string) {
    const allocation = order.allocations.find(row => row.id === allocationId), line = order.lines.find(row => row.id === allocation?.orderLineId);
    if (order.status !== RentalCoreOrderStatus.Renting || !line || !allocation || allocation.status !== "picked_up"
      || !["serialized", "quantity"].includes(line.inventoryMode) || allocation.quantity !== line.quantity - (line.cancelledQuantity ?? 0)) return undefined;
    return { line, allocation };
  }

  /** Candidate projection uses the same whole-line and original allocation gates.
   * Only available assets are exposed; occupancy conflicts and other customers stay private. */
  async choices(tenantId: string, order: RentalOrder, query: EnterpriseExchangeChoicesQuery, allowedItemIds: ReadonlySet<string>, tx: Prisma.TransactionClient): Promise<Pick<EnterpriseExchangeChoices, "lines" | "replacements" | "assets">> {
    if (order.status !== RentalCoreOrderStatus.Renting) throw new ConflictException("只有租赁中的订单可以申请换货");
    const eligible = order.allocations.flatMap(row => { const value = this.exchangeable(order, row.id); return value ? [value] : []; });
    const selected = query.allocationId ? eligible.find(row => row.allocation.id === query.allocationId) : undefined;
    if (query.allocationId && !selected || query.replacementItemGroupId && !selected) throw new ConflictException("须选择当前订单可整行换货的已领取商品");
    const groups = selected ? this.core.listItemGroups(tenantId).filter(group => allowedItemIds.has(group.id) && group.status === "enabled"
      && group.inventoryMode === selected.line.inventoryMode && group.id !== selected.line.itemGroupId) : [];
    if (query.replacementItemGroupId && !groups.some(group => group.id === query.replacementItemGroupId)) throw new ConflictException("替换商品不在当前可选范围");
    const pricing = this.core.listPricingGroups(tenantId).filter(group => group.status === "enabled");
    const candidates = selected?.line.inventoryMode === "serialized" && query.replacementItemGroupId
      ? await this.allocation.exchangeAssetCandidates(tenantId, order, query.replacementItemGroupId, order.fulfillmentLocationId, tx) : [];
    const assets = candidates.filter(row => row.available).map(row => ({ assetId: row.assetId, assetNo: row.assetNo }));
    if ([eligible.length, groups.length, assets.length, pricing.length].some(count => count > 200)) throw new ConflictException("换货候选超出当前有界读取范围");
    return { lines: eligible.map(({ line, allocation }) => ({ orderLineId: line.id, allocationId: allocation.id, itemGroupId: line.itemGroupId, itemGroupName: line.itemGroupName, quantity: allocation.quantity,
      ...(allocation.assetNo ? { assetNo: allocation.assetNo } : {}) })),
      replacements: groups.map(group => ({ itemGroupId: group.id, name: group.name, inventoryMode: group.inventoryMode as "serialized" | "quantity",
        pricingGroups: pricing.filter(price => price.memberItemGroupIds.includes(group.id)).map(price => ({ id: price.id, name: price.name })) })), assets };
  }

  async preview(tenantId: string, orderId: string, body: ExchangeIntent, tx?: Prisma.TransactionClient): Promise<{ order: RentalOrder; preview: RentalOrderChangePreview }> {
    if (!tx) return this.prisma.$transaction((transaction) => this.preview(tenantId, orderId, body, transaction));
    const order = await this.core.lockOrderForUpdate(tenantId, orderId, tx);
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
    const previousExtensions = await this.core.listOrderExtensions(tenantId, orderId, tx);
    const previousChanges = await this.core.listOrderChanges(tenantId, orderId, tx);
    const appliedAt = new Date().toISOString();
    const quoted = await this.business.quotePostPickupExchange(tenantId, context, {
      order,
      previousExtensions,
      previousChanges,
      tx,
      orderLineId,
      replacementItemGroupId,
      replacementPricingGroupId: body.replacementPricingGroupId?.trim() || undefined,
      priceBasis,
      exchangeCancelledServiceOccurrenceIds: cancelledServiceOccurrenceIds,
      services: body.services,
      appliedAt,
      fulfillmentMode: order.fulfillmentMode,
      locationIds: [order.fulfillmentLocationId, order.returnLocationId].filter((value): value is string => Boolean(value)),
      customerType: order.customerType
    });
    const newServices = quoted.priced.serviceSnapshots ?? [];
    if (newServices.some(row => row.requiresCapacity)) {
      if (!this.serviceCapacities) throw new ConflictException("换货服务容量组件未就绪，不能只报价收费");
      await this.serviceCapacities.assertAvailableForExchange(tenantId, orderId, newServices,
        (order.serviceSnapshots ?? []).filter(row => cancelledServiceOccurrenceIds.includes(row.occurrenceId ?? "")), tx);
    }
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
    const executionBasis = await this.business.captureExchangeExecutionBasis(tenantId, context, priceBasis, appliedAt, quoted.priced,
      { itemGroupId: replacementGroup.id, fulfillmentMode: order.fulfillmentMode });
    const pickupInspection = exchangePickupInspectionRequirements({ orderId, expectedUpdatedAt: order.updatedAt,
      orderLineId, allocationId, replacementItemGroupId, replacementAssetId, locationId: exchangeLocationId, basis: executionBasis });
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
        originalPriceVersion: quoted.priced.linePricing.previousSegments.at(-1)?.source.priceVersion ?? quoted.priced.priceVersion,
        replacementPriceVersion: currentVersion ?? quoted.priced.priceVersion,
        replacementAssetId,
        replacementAssetNo: selectedCandidate?.assetNo,
        cancelledServiceOccurrenceIds,
        serviceSnapshots: newServices,
        serviceConfirmationHash: exchangeServiceConfirmationHash({ orderId, expectedUpdatedAt: order.updatedAt, orderLineId,
          replacementItemGroupId, cancelledIds: cancelledServiceOccurrenceIds }, newServices),
        inspectionSnapshot,
        pickupInspection,
        executionBasis
      },
      warnings: [
        "换货差额不在确认时立即收款，统一在归还结算时处理",
        ...(differenceAmount < 0 ? ["本次形成负差额，归还结算前需完成退款审核"] : []),
        ...(originalDisposition === "off_shelf" ? ["原商品下架，不释放数量库存或序列化资产"] : ["原商品返回仓库并释放原占用"])
      ]
    };
    return { order, preview };
  }
}
