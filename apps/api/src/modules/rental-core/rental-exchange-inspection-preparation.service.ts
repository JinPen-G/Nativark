/** Original business-domain inspection preparation. Records and original keys
 * commit together; no fulfillment, customer consent, expense or resource mutation. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { rentalExchangeExecutionBasisComparable, type PrepareRentalExchangeInspectionRequest, type RentalExchangeInspectionRequirementsRequest, type RentalExchangeInspectionRequirements,
  type RentalExchangeInspectionPreparation, type RentalExchangeInspectionPreparationOriginal, type RentalExchangeInspectionIntent, type RentalOrder, type SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity, requireRequestTenantId, requireRequestUserId, requireRequestWorkspaceId } from "../../common/request-identity";
import { enabledOrganizationSubtreeIds, organizationLocationScope } from "../../common/organization-location-scope";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalExchangePreviewService } from "./rental-exchange-preview.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import { lockRentalBusinessTenant } from "./rental-business-fence";
import { acceptPreparedExchangeInspectionMedia, readPreparedExchangeInspection, recordPreparedExchangeInspectionMedia,
  verifyPreparedExchangeInspectionMedia, type ExchangeInspectionPreparationRow } from "./rental-exchange-inspection-preparation.read";

type OriginalRow = ExchangeInspectionPreparationRow;
@Injectable()
export class RentalExchangeInspectionPreparationService {
  constructor(private readonly prisma: PrismaService, private readonly core: RentalCoreService, private readonly prices: RentalExchangePreviewService,
    private readonly idempotent: RentalIdempotentActionService, private readonly auth: AuthService) {}

  private async authority(authorization: string | undefined, actor: SystemUserRow) {
    const identity = getRequestIdentity(), tenantId = requireRequestTenantId(), workspaceId = requireRequestWorkspaceId(), userId = requireRequestUserId();
    if (!actor || actor.id !== userId || actor.tenantId !== tenantId || identity?.staffApi || identity?.isSaasAdmin) throw new ForbiddenException("仅原商户经营会话可准备换货检查");
    const context = await this.auth.resolveAccessContext(authorization, { audience: "operator" }), user = context?.user;
    if (!context?.workspaceValid || context.workspaceId !== workspaceId || !user?.isActive || user.isSaasAdmin || user.id !== userId || user.tenantId !== tenantId
      || !(user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:order:operate"))) throw new ForbiddenException("当前换货检查权限已失效");
    let scope = user.locationScope ?? { mode: "all" as const, locationIds: [] };
    if (user.dataScope === "organization") {
      if (!user.organizationId) throw new ForbiddenException("检查组织范围不可核验");
      const organizations = await this.prisma.organizationUnit.findMany({ where: { tenantId }, select: { id: true, parentId: true, status: true } });
      const ids = enabledOrganizationSubtreeIds(organizations, user.organizationId);
      if (!ids.length) throw new ForbiddenException("检查组织范围已失效");
      const locations = await this.prisma.rentalFulfillmentLocation.findMany({ where: { tenantId, workspaceId, organizationId: { in: ids } }, select: { id: true } });
      scope = organizationLocationScope(locations.map(row => row.id), scope);
    }
    const normalizedScope = (value: typeof scope | undefined) => value && ({ mode: value.mode, locationIds: [...value.locationIds].sort() });
    if (!identity?.dataScope || identity.dataScope !== user.dataScope || identity.organizationId !== user.organizationId
      || requestFingerprint(normalizedScope(identity.locationScope)) !== requestFingerprint(normalizedScope(scope))) throw new ForbiddenException("检查数据范围已变化，请重新读取");
    return { tenantId, workspaceId, userId };
  }
  private intent(value: RentalExchangeInspectionIntent): RentalExchangeInspectionIntent {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["orderLineId", "allocationId", "replacementItemGroupId", "replacementAssetId", "replacementPricingGroupId", "priceBasis", "originalDisposition"].includes(key))
      || [value.orderLineId, value.allocationId, value.replacementItemGroupId].some(id => typeof id !== "string" || !id.trim() || id.length > 191)
      || [value.replacementAssetId, value.replacementPricingGroupId].some(id => id !== undefined && (typeof id !== "string" || !id.trim() || id.length > 191))
      || !["original_order_price", "replacement_current_price"].includes(value.priceBasis) || !["return_to_warehouse", "off_shelf"].includes(value.originalDisposition)) throw new BadRequestException("原换货检查意图无效");
    return { orderLineId: value.orderLineId.trim(), allocationId: value.allocationId.trim(), replacementItemGroupId: value.replacementItemGroupId.trim(),
      priceBasis: value.priceBasis, originalDisposition: value.originalDisposition,
      ...(value.replacementAssetId ? { replacementAssetId: value.replacementAssetId.trim() } : {}), ...(value.replacementPricingGroupId ? { replacementPricingGroupId: value.replacementPricingGroupId.trim() } : {}) };
  }
  private async order(tenantId: string, orderId: string, tx: Prisma.TransactionClient): Promise<RentalOrder> {
    const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' LOCK IN SHARE MODE`;
    if (!active.length) throw new ForbiddenException("商户当前不可办理或读取换货检查");
    const order = await this.core.lockOrderForUpdate(tenantId, orderId, tx);
    // The original fact repository binds tenant/workspace and current order visibility;
    // its public RentalOrder intentionally carries no client-supplied workspace field.
    if (order.id !== orderId || order.tenantId !== tenantId) throw new NotFoundException("当前受权订单不存在");
    return order;
  }
  private async sourceRequirements(order: RentalOrder, input: RentalExchangeInspectionRequirementsRequest, tx: Prisma.TransactionClient) {
    if (order.fulfillmentMode === "carrier_shipping") throw new ConflictException("承运换货检查来源未接通，不能借用现场检查");
    if (!Number.isFinite(Date.parse(input.expectedOrderUpdatedAt)) || order.updatedAt !== input.expectedOrderUpdatedAt) throw new ConflictException("原订单修订已变化，请重新读取检查要求");
    const exchange = this.intent(input.exchange);
    const { preview } = await this.prices.preview(order.tenantId, order.id, exchange, tx), basis = preview.exchange?.executionBasis;
    if (!basis || !Array.isArray(basis.inspectionTemplateSnapshots)) throw new ConflictException("原替换商品检查依据缺失");
    const effectiveExchange = { ...exchange, ...(preview.exchange?.replacementPricingGroupId ? { replacementPricingGroupId: preview.exchange.replacementPricingGroupId } : {}) };
    const original = (await this.core.listInspectionTemplates(order.tenantId, "return", order, tx)).filter(template => template.enabled
      && (!template.allocationIds || template.allocationIds.includes(exchange.allocationId)));
    const replacement = basis.inspectionTemplateSnapshots.filter(template => template.enabled && template.stage === "pickup");
    const templates = [...original.map(template => ({ side: "original_return" as const, template })), ...replacement.map(template => ({ side: "replacement_pickup" as const, template }))];
    // An empty source is not evidence of completed inspection. No fallback to today's template.
    if (!original.length || !replacement.length || templates.length > 40 || templates.some(row => row.template.tenantId !== order.tenantId
      || row.template.categoryCode !== order.categoryCode)) throw new ConflictException("原商品或替换商品检查模板缺失或超界");
    const requirementKeys = templates.map(row => `${row.side}:${row.template.id}`);
    if (new Set(requirementKeys).size !== requirementKeys.length) throw new ConflictException("原检查模板关联重复");
    const requirementsHash = requestFingerprint({ orderId: order.id, expectedOrderUpdatedAt: order.updatedAt, exchange: effectiveExchange, templates,
      basis: rentalExchangeExecutionBasisComparable(basis) });
    return { orderId: order.id, workspaceId: requireRequestWorkspaceId(), expectedOrderUpdatedAt: order.updatedAt, exchange: effectiveExchange, templates, executionBasis: basis, requirementsHash,
      media: "dedicated_source_only" as const, reservation: "not_reserved" as const };
  }
  private async requirementsInTransaction(order: RentalOrder, input: RentalExchangeInspectionRequirementsRequest, tx: Prisma.TransactionClient) {
    return this.sourceRequirements(order, input, tx);
  }
  /** Internal source authority uses the same original order lock and templates,
   * without relaxing the preparation's required-evidence gate. */
  mediaScope(authorization: string | undefined, actor: SystemUserRow) { return this.authority(authorization, actor); }
  async mediaOrder(authorization: string | undefined, actor: SystemUserRow, orderId: string, tx: Prisma.TransactionClient) {
    const scope = await this.authority(authorization, actor);
    await lockRentalBusinessTenant(tx, scope.tenantId);
    const order = await this.order(scope.tenantId, orderId, tx);
    await this.authority(authorization, actor); return { scope, order };
  }
  async mediaRequirementsInTransaction(authorization: string | undefined, actor: SystemUserRow, orderId: string,
    input: RentalExchangeInspectionRequirementsRequest, tx: Prisma.TransactionClient) {
    const { order } = await this.mediaOrder(authorization, actor, orderId, tx);
    const requirements = await this.sourceRequirements(order, input, tx);
    await this.authority(authorization, actor); return { ...requirements, media: "dedicated_source_only" as const };
  }
  private rows(tx: Prisma.TransactionClient, tenantId: string, workspaceId: string, actorUserId: string, key: string) {
    return tx.$queryRaw<OriginalRow[]>`SELECT * FROM rental_exchange_inspection_preparations WHERE tenantId=${tenantId} AND workspaceId=${workspaceId} AND actorUserId=${actorUserId} AND operationKey=${key}`;
  }
  private view(row: OriginalRow, orderId: string): RentalExchangeInspectionPreparation {
    return readPreparedExchangeInspection(row, { tenantId: requireRequestTenantId(), workspaceId: requireRequestWorkspaceId(), orderId });
  }
  async requirements(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: RentalExchangeInspectionRequirementsRequest): Promise<RentalExchangeInspectionRequirements> {
    if (!input || Object.keys(input).some(key => !["expectedOrderUpdatedAt", "exchange"].includes(key))) throw new BadRequestException("检查要求请求包含未知字段");
    const scope = await this.authority(authorization, actor);
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, scope.tenantId); const order = await this.order(scope.tenantId, orderId, tx);
      await this.authority(authorization, actor); const result = await this.requirementsInTransaction(order, input, tx);
      await this.authority(authorization, actor); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async prepare(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: PrepareRentalExchangeInspectionRequest): Promise<RentalExchangeInspectionPreparation> {
    if (!input || Object.keys(input).some(key => !["operationKey", "expectedRevision", "reason", "expectedOrderUpdatedAt", "exchange", "requirementsHash", "inspections", "exceptions"].includes(key))
      || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.operationKey) || input.expectedRevision !== 0 || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500
      || !/^[a-f0-9]{64}$/u.test(input.requirementsHash) || !Array.isArray(input.inspections) || input.inspections.length > 40) throw new BadRequestException("检查准备操作键、修订或事实无效");
    const scope = await this.authority(authorization, actor), body = structuredClone({ ...input, exchange: this.intent(input.exchange) }), hash = requestFingerprint({ orderId, actorUserId: scope.userId, input: body });
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, scope.tenantId); const order = await this.order(scope.tenantId, orderId, tx);
      await this.authority(authorization, actor);
      const original = (await this.rows(tx, scope.tenantId, scope.workspaceId, scope.userId, body.operationKey))[0];
      if (original) {
        if (original.requestHash !== hash) throw new ConflictException("原检查键已用于不同请求，不能重发");
        const result = this.view(original, orderId);
        await this.authority(authorization, actor); return result;
      }
      const requirements = await this.requirementsInTransaction(order, body, tx);
      if (requirements.requirementsHash !== body.requirementsHash) throw new ConflictException("检查要求已变化，请重新审阅");
      if (body.inspections.length !== requirements.templates.length) throw new BadRequestException("须逐份完成原检查模板，不能漏项");
      const { inspections, acceptedMedia } = await acceptPreparedExchangeInspectionMedia(tx,
        { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorUserId: scope.userId }, requirements, body.inspections);
      if (order.ruleSnapshot?.fulfillment?.evidenceRequired && !acceptedMedia.some(row => row.side === "original_return")
        || requirements.executionBasis.ruleSnapshot?.fulfillment?.evidenceRequired && !acceptedMedia.some(row => row.side === "replacement_pickup")) {
        throw new ConflictException("原商品或替换商品缺少本侧已核验的必需检查影像");
      }
      const exceptions = body.exceptions ?? [];
      if (!Array.isArray(exceptions) || exceptions.length > 20 || exceptions.some(row => !row || Object.keys(row).some(key => !["code", "description", "allocationId"].includes(key))
        || typeof row.code !== "string" || !row.code.trim() || row.code.length > 128 || typeof row.description !== "string" || !row.description.trim() || row.description.length > 500
        || row.allocationId !== body.exchange.allocationId)) throw new BadRequestException("异常只能关联原分配项事实，不能提交费用或附件");
      const value: RentalExchangeInspectionPreparation = { ...requirements, id: randomUUID(), actorUserId: scope.userId, operationKey: body.operationKey, requestHash: hash,
        revision: 1, state: "prepared", reason: body.reason.trim(), createdAt: new Date().toISOString(), inspections, exceptions,
        media: acceptedMedia.length ? "dedicated_source_verified" : "unavailable", acceptedMedia, customerConsent: "not_connected", execution: "not_connected" };
      const rentalKey = requestFingerprint({ actorUserId: scope.userId, operationKey: body.operationKey });
      const result = await this.idempotent.executeInTransaction({ tenantId: scope.tenantId, orderId, action: "order.exchange.inspection.prepare", key: rentalKey,
        fallbackKey: rentalKey, request: { orderId, actorUserId: scope.userId, input: body }, run: async () => {
          await tx.$executeRaw`INSERT INTO rental_exchange_inspection_preparations (tenantId,workspaceId,id,orderId,actorUserId,operationKey,requestHash,payloadHash,payload) VALUES (${scope.tenantId},${scope.workspaceId},${value.id},${orderId},${scope.userId},${body.operationKey},${hash},${requestFingerprint(value)},${JSON.stringify(value)})`;
          await recordPreparedExchangeInspectionMedia(tx, scope.tenantId, value);
          return value;
        }, replay: async () => {
          const recorded = (await this.rows(tx, scope.tenantId, scope.workspaceId, scope.userId, body.operationKey))[0];
          return recorded && recorded.requestHash === hash ? this.view(recorded, orderId) : undefined;
        } }, tx);
      await this.authority(authorization, actor); return result.result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async original(authorization: string | undefined, actor: SystemUserRow, orderId: string, key: string): Promise<RentalExchangeInspectionPreparationOriginal> {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原检查准备键无效");
    const scope = await this.authority(authorization, actor);
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, scope.tenantId); await this.order(scope.tenantId, orderId, tx); await this.authority(authorization, actor);
      const row = (await this.rows(tx, scope.tenantId, scope.workspaceId, scope.userId, key))[0];
      const result: RentalExchangeInspectionPreparationOriginal = row ? { state: "observed", preparation: this.view(row, orderId), retryable: false } : { state: "not_recorded", retryable: false };
      await this.authority(authorization, actor); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async read(authorization: string | undefined, actor: SystemUserRow, orderId: string, id: string): Promise<RentalExchangeInspectionPreparation> {
    const scope = await this.authority(authorization, actor);
    return this.prisma.$transaction(async tx => {
      await lockRentalBusinessTenant(tx, scope.tenantId); await this.order(scope.tenantId, orderId, tx); await this.authority(authorization, actor);
      const rows = await tx.$queryRaw<OriginalRow[]>`SELECT * FROM rental_exchange_inspection_preparations WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId} AND orderId=${orderId} AND id=${id}`;
      if (!rows[0]) throw new NotFoundException("本人受权原检查准备不存在");
      const result = this.view(rows[0], orderId); await this.authority(authorization, actor); return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  /** Only the original merchant actor can consume its prepared inspection. The
   * caller keeps this same transaction through approval, stock and receipts. */
  async readForExecution(authorization: string | undefined, actor: SystemUserRow, orderId: string, preparationId: string,
    preparationHash: string, expectedOrderUpdatedAt: string, tx: Prisma.TransactionClient) {
    const { scope, order } = await this.mediaOrder(authorization, actor, orderId, tx);
    const rows = await tx.$queryRaw<OriginalRow[]>`SELECT * FROM rental_exchange_inspection_preparations
      WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId}
        AND orderId=${orderId} AND id=${preparationId} FOR UPDATE`;
    if (rows.length !== 1 || rows[0].id !== preparationId || rows[0].payloadHash !== preparationHash) throw new ConflictException("原检查准备或操作人不一致");
    const preparation = this.view(rows[0], orderId);
    if (preparation.expectedOrderUpdatedAt !== expectedOrderUpdatedAt || order.updatedAt !== expectedOrderUpdatedAt) throw new ConflictException("原订单修订已变化，不能执行旧检查准备");
    const current = await this.sourceRequirements(order, { exchange: preparation.exchange, expectedOrderUpdatedAt }, tx);
    if (current.requirementsHash !== preparation.requirementsHash) throw new ConflictException("原检查、替换商品或执行价格依据已变化");
    await verifyPreparedExchangeInspectionMedia(tx, scope.tenantId, preparation);
    await this.authority(authorization, actor); return { scope, order, preparation };
  }
}
