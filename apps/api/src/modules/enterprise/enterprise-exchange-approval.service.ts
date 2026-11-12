/** Enterprise exchange expense requests and approvals use original order locks.
 * Core owns execution with this service participating in its bound transaction. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { rentalExchangePreviewComparable } from "@rental-os/shared";
import type { EnterpriseExchangeConfirmationResult, ConfirmEnterpriseExchangeExpense, CloseEnterpriseExchangeRequest, EnterpriseExchangeRequestOriginalResult, EnterpriseExchangeRequestClosureReceipt, EnterpriseExchangeApprovalView, EnterpriseExchangeChoices, EnterpriseExchangeChoicesQuery, EnterpriseExchangeIntent, RequestEnterpriseExchangeApproval, DecideEnterpriseExchangeApproval, RentalOrderChangePreview, EnterpriseBookingBasis, SystemUserRow, RentalApprovedExchangeReceipt, EnterpriseMerchantExchangeChoices, EnterpriseMerchantExchangePreparation } from "@rental-os/shared";
import { getRequestIdentity, requireRequestWorkspaceId } from "../../common/request-identity";
import type { ClientRequestContext } from "../client/client-auth.service";
import { ClientApiService } from "../client/client-api.service";
import { AuthService } from "../auth/auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalExchangePreviewService } from "../rental-core/rental-exchange-preview.service";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { hasOriginalRentalCurrency } from "../rental-core/rental-money";
import type { ApprovedExchangeBinding, ApprovedExchangeTransaction } from "../rental-core/approved-exchange-transaction.ports";
import { RentalExchangeInspectionPreparationService } from "../rental-core/rental-exchange-inspection-preparation.service";
import { RentalIdempotentActionService } from "../rental-core/rental-idempotent-action.service";
import { exchangeInspectionCustomerMaterial, readExchangeInspectionConsent, verifyExchangeInspectionConsentReceipt, type ExchangeInspectionConsentRow } from "../rental-core/rental-exchange-inspection-consent.service";
import { readPreparedExchangeInspection, type ExchangeInspectionPreparationRow } from "../rental-core/rental-exchange-inspection-preparation.read";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";

type Approval = {
  id: string; corporateCustomerId: string; applicantCustomerId: string; workspaceId: string; orderId: string; expectedOrderUpdatedAt: string;
  revision: number; state: "pending" | "approved" | "rejected" | "withdrawn" | "consumed"; reason: string; expiresAt: Date;
  request: EnterpriseExchangeIntent | string; preview: RentalOrderChangePreview | string; basis: EnterpriseBookingBasis | string;
  requestFingerprint: string; previewFingerprint: string;
  approvedBy?: string | null; reviewerMembershipId?: string | null; reviewerMembershipUpdatedAt?: Date | null;
  employeeConfirmationOperationKey?: string | null; employeeConfirmedAt?: Date | null; employeeConfirmationFingerprint?: string | null;
};
@Injectable()
export class EnterpriseExchangeApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly policies: EnterprisePolicyService,
    private readonly access: EnterpriseAccessService, private readonly core: RentalCoreService, private readonly prices: RentalExchangePreviewService, private readonly clientApi: ClientApiService,
    private readonly auth: AuthService, private readonly inspections?: RentalExchangeInspectionPreparationService,
    private readonly inspectionReceipts?: RentalIdempotentActionService) {}

  private rows(context: Pick<ClientRequestContext, "tenantId" | "workspaceId">, id: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).$queryRaw<Approval[]>(Prisma.sql`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} ${tx ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  }
  private owns(context: ClientRequestContext, row?: Approval) {
    if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId || requireRequestWorkspaceId() !== context.workspaceId) throw new NotFoundException("本人当前空间换货申请不存在");
  }
  private confirmationFingerprint(row: Approval) {
    return requestFingerprint({ approvalId: row.id, orderId: row.orderId, workspaceId: row.workspaceId, applicantCustomerId: row.applicantCustomerId,
      requestFingerprint: row.requestFingerprint, previewFingerprint: row.previewFingerprint, basis: enterpriseJson(row.basis),
      approvedBy: row.approvedBy, reviewerMembershipId: row.reviewerMembershipId, reviewerMembershipUpdatedAt: row.reviewerMembershipUpdatedAt?.toISOString() });
  }
  private view(row: Approval): EnterpriseExchangeApprovalView {
    const preview = enterpriseJson(row.preview), exchange = preview.exchange;
    if (!exchange) throw new ConflictException("原换货试算关联缺失");
    if ((row.employeeConfirmationOperationKey || row.employeeConfirmedAt || row.employeeConfirmationFingerprint)
      && (!row.employeeConfirmationOperationKey || !row.employeeConfirmedAt || row.employeeConfirmationFingerprint !== this.confirmationFingerprint(row))) throw new ConflictException("原员工费用确认依据不一致");
    if (row.employeeConfirmationOperationKey && (row.requestFingerprint !== requestFingerprint({ orderId: row.orderId, expected: row.expectedOrderUpdatedAt, exchange: enterpriseJson(row.request) })
      || row.previewFingerprint !== requestFingerprint(preview))) throw new ConflictException("原员工费用确认快照指纹不一致");
    return { id: row.id, orderId: row.orderId, workspaceId: row.workspaceId, corporateCustomerId: row.corporateCustomerId, applicantCustomerId: row.applicantCustomerId,
      expectedOrderUpdatedAt: row.expectedOrderUpdatedAt, revision: row.revision, state: ["pending", "approved"].includes(row.state) && row.expiresAt <= new Date() ? "expired" : row.state,
      reason: row.reason, expiresAt: row.expiresAt.toISOString(), exchange: enterpriseJson(row.request),
      preview: { originalItemGroupName: exchange.originalItemGroupName, replacementItemGroupName: exchange.replacementItemGroupName,
        originalAmount: exchange.originalAmount, replacementAmount: exchange.replacementAmount, additionalAmount: preview.additionalAmount, refundAmount: preview.refundAmount,
        depositDelta: preview.depositDelta, preAuthDelta: preview.preAuthDelta, currency: preview.currency,
        originalPriceVersion: exchange.originalPriceVersion, replacementPriceVersion: exchange.replacementPriceVersion },
      ...(row.employeeConfirmationOperationKey && row.employeeConfirmedAt ? { employeeConfirmation: { operationKey: row.employeeConfirmationOperationKey,
        confirmedAt: row.employeeConfirmedAt.toISOString(), scope: "expense_only_not_inspection_or_execution" as const } } : {}),
      execution: row.state === "consumed" ? "original_merchant_receipt_required" : "original_merchant_execution_required" };
  }
  private canonical(input: EnterpriseExchangeIntent): EnterpriseExchangeIntent {
    if (!input || [input.orderLineId, input.allocationId, input.replacementItemGroupId].some(id => typeof id !== "string" || !id.trim() || id.length > 191)
      || !["original_order_price", "replacement_current_price"].includes(input.priceBasis)
      || [input.replacementAssetId, input.replacementPricingGroupId].some(id => id !== undefined && (typeof id !== "string" || !id.trim() || id.length > 191))) throw new BadRequestException("须选择原订单行、分配项、新商品及价格依据");
    return { orderLineId: input.orderLineId.trim(), allocationId: input.allocationId.trim(), replacementItemGroupId: input.replacementItemGroupId.trim(), priceBasis: input.priceBasis,
      ...(input.replacementAssetId ? { replacementAssetId: input.replacementAssetId.trim() } : {}), ...(input.replacementPricingGroupId ? { replacementPricingGroupId: input.replacementPricingGroupId.trim() } : {}) };
  }
  // Core's comparison preserves the original fees and versioned sources while
  // separating the current query instant and generated pricing descriptions.
  private priceBasis(preview: RentalOrderChangePreview) {
    return rentalExchangePreviewComparable(preview);
  }

  async merchantExchangeAccess(authorization: string | undefined, actor: SystemUserRow) {
    if (!this.auth) throw new ServiceUnavailableException("原商户换货认证尚未装配");
    const identity = getRequestIdentity(), current = await this.auth.resolveAccessContext(authorization, { audience: "operator" }), user = current?.user;
    if (!identity || identity.audience !== "operator" || identity.staffApi || identity.isSaasAdmin || !actor
      || !current?.workspaceValid || current.workspaceId !== identity.workspaceId || !user?.isActive || user.isSaasAdmin
      || user.id !== actor.id || user.id !== identity.userId || user.tenantId !== actor.tenantId || user.tenantId !== identity.tenantId
      || !(user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:corporate:manage"))) throw new ForbiddenException("当前商户企业换货权限或经营空间已变化");
    return { tenantId: user.tenantId, workspaceId: current.workspaceId!, userId: user.id };
  }

  async merchantExchangeReference(authorization: string | undefined, actor: SystemUserRow, orderId: string, approvalId: string) {
    const before = await this.merchantExchangeAccess(authorization, actor);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; orderId: string }>>`SELECT id,orderId FROM enterprise_exchange_approvals
      WHERE tenantId=${before.tenantId} AND workspaceId=${before.workspaceId} AND id=${approvalId}`;
    if (rows.length !== 1 || rows[0].id !== approvalId || rows[0].orderId !== orderId) throw new NotFoundException("当前空间原订单换货批准关联不存在");
    const after = await this.merchantExchangeAccess(authorization, actor);
    if (after.workspaceId !== before.workspaceId) throw new ForbiddenException("原换货读取空间已变化");
  }

  async merchantExecutionChoices(authorization: string | undefined, inputActor: SystemUserRow, orderId: string): Promise<EnterpriseMerchantExchangeChoices> {
    if (!this.inspections || !this.inspectionReceipts) throw new ServiceUnavailableException("原换货材料读取依赖尚未装配");
    if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(orderId)) throw new BadRequestException("原订单引用无效");
    const actor = Object.freeze(structuredClone(inputActor)), before = await this.merchantExchangeAccess(authorization, actor);
    const capture = async (tx: Prisma.TransactionClient) => {
      const access = await this.merchantExchangeAccess(authorization, actor);
      const { scope, order } = await this.inspections!.mediaOrder(authorization, actor, orderId, tx), member = order.membershipSnapshot;
      if (access.workspaceId !== before.workspaceId || scope.workspaceId !== before.workspaceId || order.status !== "renting"
        || !member?.enterpriseContractAndPayer || !member.corporateCustomerId || !member.personalCustomerId) throw new ForbiddenException("仅当前空间原企业承担订单可读取换货执行材料");
      const approvals = await tx.$queryRaw<Approval[]>`SELECT * FROM enterprise_exchange_approvals
        WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND orderId=${orderId}
          AND corporateCustomerId=${member.corporateCustomerId} AND applicantCustomerId=${member.personalCustomerId}
        ORDER BY createdAt DESC,id ASC LIMIT 20`;
      const preparations = await tx.$queryRaw<ExchangeInspectionPreparationRow[]>`SELECT * FROM rental_exchange_inspection_preparations
        WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND orderId=${orderId} AND actorUserId=${scope.userId}
        ORDER BY createdAt DESC,id ASC LIMIT 20`;
      const consents = await tx.$queryRaw<ExchangeInspectionConsentRow[]>`SELECT * FROM rental_exchange_inspection_consents
        WHERE tenantId=${scope.tenantId} AND workspaceId=${scope.workspaceId} AND orderId=${orderId} AND customerId=${member.personalCustomerId}
        ORDER BY createdAt DESC,id ASC LIMIT 20`;
      const after = await this.merchantExchangeAccess(authorization, actor), coreScope = await this.inspections!.mediaScope(authorization, actor);
      if (after.workspaceId !== before.workspaceId || coreScope.workspaceId !== before.workspaceId) throw new ForbiddenException("原换货读取空间已变化");
      return structuredClone({ order, approvals, preparations, consents, scope });
    };
    const snapshot = await this.prisma.$transaction(capture, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    // Serialize persisted dates before fingerprinting so changes to expiry or
    // confirmation times remain visible alongside the immutable payloads.
    const snapshotHash = requestFingerprint(JSON.parse(JSON.stringify(snapshot)));
    const orderHash = requestFingerprint(snapshot.order), choices: EnterpriseMerchantExchangeChoices["approvals"] = [];
    const checkedPreparations = new Map<string, EnterpriseMerchantExchangePreparation>();
    for (const row of snapshot.approvals) {
      if (row.orderId !== orderId || row.workspaceId !== before.workspaceId || row.corporateCustomerId !== snapshot.order.membershipSnapshot!.corporateCustomerId
        || row.applicantCustomerId !== snapshot.order.membershipSnapshot!.personalCustomerId
        || row.requestFingerprint !== requestFingerprint({ orderId, expected: row.expectedOrderUpdatedAt, exchange: enterpriseJson(row.request) })
        || row.previewFingerprint !== requestFingerprint(enterpriseJson(row.preview))) throw new ConflictException("原换货批准材料或对象关联不可核对");
      const approval = this.view(row);
      if (!hasOriginalRentalCurrency(snapshot.order.currency, approval.preview.currency)
        || ![approval.preview.originalAmount, approval.preview.replacementAmount, approval.preview.additionalAmount,
          approval.preview.refundAmount, approval.preview.depositDelta, approval.preview.preAuthDelta].every(Number.isFinite)
        || typeof approval.preview.originalItemGroupName !== "string" || typeof approval.preview.replacementItemGroupName !== "string") {
        throw new ConflictException("原换货费用、币种或商品快照缺失，须核对原材料");
      }
      const state = approval.state === "approved" ? row.employeeConfirmationOperationKey ? "waiting_inspection" : "waiting_expense" : approval.state;
      const entry: EnterpriseMerchantExchangeChoices["approvals"][number] = { approval, state, preparations: [] };
      if (approval.state === "approved" && row.employeeConfirmationOperationKey) {
        if (row.expectedOrderUpdatedAt !== snapshot.order.updatedAt) throw new ConflictException("原批准订单修订已变化");
        const intent = enterpriseJson(row.request), preview = enterpriseJson(row.preview);
        const pricingGroupId = preview.exchange?.replacementPricingGroupId ?? intent.replacementPricingGroupId;
        for (const original of snapshot.preparations) {
          const material = readPreparedExchangeInspection(original, { tenantId: before.tenantId, workspaceId: before.workspaceId, orderId });
          if (material.actorUserId !== actor.id || material.expectedOrderUpdatedAt !== snapshot.order.updatedAt
            || material.exchange.replacementPricingGroupId !== pricingGroupId
            || (["orderLineId", "allocationId", "replacementItemGroupId", "replacementAssetId", "priceBasis"] as const)
              .some(key => material.exchange[key] !== intent[key])) continue;
          let checked = checkedPreparations.get(material.id);
          if (!checked) {
            checked = await this.prisma.$transaction(async tx => {
              await this.merchantExchangeAccess(authorization, actor);
              const current = await this.inspections!.readForExecution(authorization, actor, orderId, material.id, original.payloadHash, snapshot.order.updatedAt, tx);
              if (requestFingerprint(current.order) !== orderHash) throw new ConflictException("原订单在材料读取期间发生变化");
              const inspection = exchangeInspectionCustomerMaterial(current.preparation, row.applicantCustomerId, original.payloadHash);
              const rows = await tx.$queryRaw<ExchangeInspectionConsentRow[]>`SELECT * FROM rental_exchange_inspection_consents
                WHERE tenantId=${before.tenantId} AND workspaceId=${before.workspaceId} AND orderId=${orderId}
                  AND preparationId=${material.id} AND customerId=${row.applicantCustomerId}
                ORDER BY createdAt DESC,id ASC LIMIT 20`;
              if (rows.length > 1) throw new ConflictException("本次检查同意关联重复");
              const consent = rows[0] && readExchangeInspectionConsent(rows[0], { tenantId: before.tenantId, workspaceId: before.workspaceId, orderId, customerId: row.applicantCustomerId });
              const captured = consent && snapshot.consents.find(record => record.id === consent.id);
              if (consent && captured) {
                if (requestFingerprint(JSON.parse(JSON.stringify(captured))) !== requestFingerprint(JSON.parse(JSON.stringify(rows[0])))
                  || consent.preparationHash !== original.payloadHash
                  || consent.materialHash !== inspection.materialHash || consent.expectedOrderUpdatedAt !== snapshot.order.updatedAt) throw new ConflictException("本人具体检查同意在读取期间发生变化或未完整捕获");
                await verifyExchangeInspectionConsentReceipt(this.inspectionReceipts!, tx, before.tenantId, consent);
              }
              if (consent && !captured && snapshot.consents.length < 20) throw new ConflictException("本人具体检查同意在读取期间发生变化");
              const consentUnavailable = snapshot.consents.length === 20 && !captured;
              await this.merchantExchangeAccess(authorization, actor);
              await this.inspections!.mediaScope(authorization, actor);
              return { preparationId: material.id, createdAt: material.createdAt, inspection,
                state: consentUnavailable ? "consent_unavailable" as const : consent ? "ready" as const : "waiting_consent" as const,
                ...(consent && captured ? { consentConfirmedAt: consent.confirmedAt, binding: { approvalId: row.id, expectedApprovalRevision: row.revision,
                  expectedOrderUpdatedAt: row.expectedOrderUpdatedAt, preparationId: material.id, preparationHash: original.payloadHash,
                  consentId: consent.id, consentOperationKey: consent.operationKey } } : {}) };
            }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
            checkedPreparations.set(material.id, checked);
          }
          entry.preparations.push({ ...checked, ...(checked.binding ? { binding: { ...checked.binding, approvalId: row.id, expectedApprovalRevision: row.revision } } : {}) });
        }
        if (entry.preparations.some(preparation => preparation.state === "ready")) entry.state = "ready";
      }
      choices.push(entry);
    }
    const after = await this.prisma.$transaction(capture, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (requestFingerprint(JSON.parse(JSON.stringify(after))) !== snapshotHash) throw new ConflictException("原订单、批准、检查准备或本人同意在读取期间发生变化");
    if (choices.some(entry => entry.approval.state !== this.view(snapshot.approvals.find(row => row.id === entry.approval.id)!).state)) {
      throw new ConflictException("原换货批准在读取期间已到期，请重新读取");
    }
    return { orderId, orderNo: snapshot.order.orderNo, workspaceId: before.workspaceId,
      corporateCustomerId: snapshot.order.membershipSnapshot!.corporateCustomerId!, applicantCustomerId: snapshot.order.membershipSnapshot!.personalCustomerId!,
      expectedOrderUpdatedAt: snapshot.order.updatedAt, approvals: choices,
      coverage: { state: [snapshot.approvals.length, snapshot.preparations.length, snapshot.consents.length].includes(20) ? "limited" : "captured",
        limit: 20, approvals: snapshot.approvals.length, preparations: snapshot.preparations.length, consents: snapshot.consents.length } };
  }

  /** The merchant's authenticated Core transaction owns the change. These
   * callbacks bind and consume this enterprise approval in that same transaction. */
  approvedExchangeParticipant(inputActor: SystemUserRow, orderId: string, approvalId: string, authorization?: string): ApprovedExchangeTransaction {
    if (!inputActor?.isActive || inputActor.isSaasAdmin || !orderId || !approvalId) throw new ForbiddenException("需要当前商户换货执行身份及原批准引用");
    const actor = Object.freeze(structuredClone(inputActor));
    const assertBinding = async (binding: Readonly<ApprovedExchangeBinding>) => {
      const current = await this.merchantExchangeAccess(authorization, actor);
      const identity = getRequestIdentity();
      if (!identity || identity.audience !== "operator" || identity.staffApi || identity.isSaasAdmin
        || identity.userId !== actor.id || identity.tenantId !== actor.tenantId || identity.workspaceId !== binding.workspaceId
        || current.workspaceId !== binding.workspaceId || binding.actorUserId !== actor.id || binding.tenantId !== actor.tenantId || binding.orderId !== orderId
        || binding.request.approvalId !== approvalId
        || binding.coreIdempotencyKey !== `approved-exchange:${requestFingerprint({ actorUserId: actor.id, operationKey: binding.request.operationKey })}`
        || binding.requestHash !== requestFingerprint({ orderId, actorUserId: actor.id, input: binding.request })) {
        throw new ForbiddenException("原商户、订单、批准或执行键关联不一致");
      }
    };
    const originalApproval = async (tx: Prisma.TransactionClient, binding: Readonly<ApprovedExchangeBinding>, state: "approved" | "consumed") => {
      await assertBinding(binding);
      const rows = await this.rows(binding, approvalId, tx), row = rows[0];
      if (rows.length !== 1 || row.id !== approvalId || row.workspaceId !== binding.workspaceId || row.orderId !== orderId
        || row.state !== state || row.revision !== binding.request.expectedApprovalRevision + (state === "consumed" ? 1 : 0)
        || row.expectedOrderUpdatedAt !== binding.request.expectedOrderUpdatedAt || !row.employeeConfirmationOperationKey
        || !row.employeeConfirmedAt || row.employeeConfirmationFingerprint !== this.confirmationFingerprint(row)
        || state === "approved" && row.expiresAt <= new Date()) throw new ConflictException("本次原换货批准、费用确认或消费关联已变化");
      const intent = enterpriseJson(row.request), preview = enterpriseJson(row.preview);
      if (row.requestFingerprint !== requestFingerprint({ orderId, expected: row.expectedOrderUpdatedAt, exchange: intent })
        || row.previewFingerprint !== requestFingerprint(preview)) throw new ConflictException("原换货批准快照指纹不一致");
      await assertBinding(binding);
      return row;
    };
    const originalChange = async (tx: Prisma.TransactionClient, binding: Readonly<ApprovedExchangeBinding>, receipt: Readonly<RentalApprovedExchangeReceipt>) => {
      await assertBinding(binding);
      if (receipt.approvalId !== approvalId || receipt.orderId !== orderId || receipt.workspaceId !== binding.workspaceId
        || receipt.actorUserId !== actor.id || receipt.operationKey !== binding.request.operationKey
        || receipt.coreIdempotencyKey !== binding.coreIdempotencyKey || receipt.requestHash !== binding.requestHash
        || receipt.preparationId !== binding.request.preparationId || receipt.preparationHash !== binding.request.preparationHash
        || receipt.consentId !== binding.request.consentId || receipt.consentOperationKey !== binding.request.consentOperationKey
        || receipt.state !== "applied" || receipt.retryable !== false) throw new ConflictException("原换货收据与批准及两个确认引用不一致");
      const change = (await this.core.listOrderChanges(binding.tenantId, orderId, tx)).find(row => row.id === receipt.changeId);
      if (!change || change.tenantId !== binding.tenantId || change.workspaceId !== binding.workspaceId || change.orderId !== orderId
        || change.type !== "post_pickup_exchange" || change.status !== "applied" || change.idempotencyKey !== binding.coreIdempotencyKey
        || requestFingerprint(change) !== receipt.changeHash) throw new ConflictException("原换货变更与消费收据不一致");
      await assertBinding(binding);
    };
    return {
      prepare: async (tx, binding) => {
        const row = await originalApproval(tx, binding, "approved");
        const order = await this.core.lockOrderForUpdate(binding.tenantId, orderId, tx), snapshot = order.membershipSnapshot;
        if (!snapshot?.enterpriseContractAndPayer || snapshot.corporateCustomerId !== row.corporateCustomerId
          || snapshot.personalCustomerId !== row.applicantCustomerId || !snapshot.corporateMembershipId) throw new ConflictException("原订单企业与费用申请人不一致");
        const current = await this.policies.revalidateOrderExpense(binding.tenantId, binding.workspaceId, order, tx);
        if (!current) throw new ForbiddenException("当前企业新支出政策不可用");
        this.policies.assertSameBasis(enterpriseJson(row.basis), current);
        await this.policies.assertReviewer(binding.tenantId, row.corporateCustomerId, row.applicantCustomerId, row.approvedBy ?? null,
          row.reviewerMembershipId ?? null, row.reviewerMembershipUpdatedAt ?? null, tx);
        await assertBinding(binding);
      },
      commit: async (tx, binding, receipt) => {
        const row = await originalApproval(tx, binding, "approved");
        await originalChange(tx, binding, receipt);
        const changed = await tx.$executeRaw`UPDATE enterprise_exchange_approvals SET state='consumed',revision=revision+1
          WHERE tenantId=${binding.tenantId} AND workspaceId=${binding.workspaceId} AND id=${approvalId} AND orderId=${orderId}
            AND state='approved' AND revision=${binding.request.expectedApprovalRevision} AND employeeConfirmationOperationKey=${row.employeeConfirmationOperationKey}`;
        if (changed !== 1) throw this.commands.conflict();
        await assertBinding(binding);
      },
      replay: async (tx, binding, receipt) => {
        await originalApproval(tx, binding, "consumed");
        await originalChange(tx, binding, receipt);
      }
    };
  }
  private async ownOrder(context: ClientRequestContext, orderId: string, tx: Prisma.TransactionClient) {
    const order = await this.core.lockOrderForUpdate(context.tenantId, orderId, tx);
    if (requireRequestWorkspaceId() !== context.workspaceId || order.tenantId !== context.tenantId || order.id !== orderId
      || order.membershipSnapshot?.personalCustomerId !== context.customerId || !order.membershipSnapshot.enterpriseContractAndPayer) throw new NotFoundException("本人当前空间企业订单不存在");
    const basis = await this.policies.revalidateOrderExpense(context.tenantId, context.workspaceId, order, tx);
    if (!basis || basis.approvalMode !== "per_order") throw new ForbiddenException("仅本人逐单企业付费订单可申请换货批准");
    return { order, basis };
  }
  async choices(context: ClientRequestContext, orderId: string, query: EnterpriseExchangeChoicesQuery): Promise<EnterpriseExchangeChoices> {
    if ([query.allocationId, query.replacementItemGroupId].some(id => id !== undefined && (typeof id !== "string" || !id.trim() || id.length > 191))) throw new BadRequestException("换货候选引用无效");
    return this.prisma.$transaction(async tx => {
      const tenants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${context.tenantId} AND status='ACTIVE' LOCK IN SHARE MODE`;
      if (!tenants.length) throw new ForbiddenException("商户不可用");
      await this.commands.customer(context, tx);
      const { order } = await this.ownOrder(context, orderId, tx);
      await this.commands.customer(context, tx);
      const catalog = await this.clientApi.catalog(context);
      const result = await this.prices.choices(context.tenantId, order, query, new Set(catalog.items.map(item => item.id)), tx);
      await this.commands.customer(context, tx);
      return { orderId: order.id, orderNo: order.orderNo, expectedOrderUpdatedAt: order.updatedAt, workspaceId: context.workspaceId, applicantCustomerId: context.customerId,
        ...result, selectedAllocationId: query.allocationId, selectedReplacementItemGroupId: query.replacementItemGroupId, reservation: "not_reserved" };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  private async prepared(context: ClientRequestContext, orderId: string, expected: string, intent: EnterpriseExchangeIntent, tx: Prisma.TransactionClient) {
    const { order, basis } = await this.ownOrder(context, orderId, tx);
    if (order.updatedAt !== expected) throw new ConflictException("原订单已变化，须重新试算并申请换货批准");
    const catalog = await this.clientApi.catalog(context);
    if (!catalog.items.some(item => item.id === intent.replacementItemGroupId)) throw new ForbiddenException("替换商品未向当前客户空间开放");
    const { preview } = await this.prices.preview(context.tenantId, orderId, intent, tx);
    if (!hasOriginalRentalCurrency(order.currency, preview.currency)) throw new ConflictException("换货币种与原订单不一致或缺失，须核对原币种后重新试算与审批");
    // 押金或预授权增加同样需要本次批准，金额上限继续沿新增租赁费用核对。
    const obligations = [preview.additionalAmount, preview.depositDelta, preview.preAuthDelta];
    if (!obligations.every(Number.isFinite) || !obligations.some(amount => amount > 0) || !preview.exchange?.executionBasis) throw new ConflictException("此接点仅申请真实新增换货支出，缺原试算依据不放行");
    const snapshot = order.membershipSnapshot!;
    await this.policies.assertQuoteAmount(context.tenantId, snapshot.corporateCustomerId!, snapshot.corporateMembershipId!, { payableAmount: preview.additionalAmount, currency: preview.currency }, tx);
    return { order, basis, preview };
  }
  async request(context: ClientRequestContext, input: RequestEnterpriseExchangeApproval) {
    if (input.expectedRevision !== 0 || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt))) throw new BadRequestException("原订单修订或初始修订无效");
    input = { ...input, exchange: this.canonical(input.exchange) };
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "exchange.request", input.orderId, input, async tx => {
      const prepared = await this.prepared(context, input.orderId, input.expectedOrderUpdatedAt, input.exchange, tx), snapshot = prepared.order.membershipSnapshot!;
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_exchange_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND orderId=${input.orderId} AND state IN ('pending','approved') AND expiresAt>NOW(3) FOR UPDATE`;
      if (active.length) throw new ConflictException("原订单已有待处理换货申请，请核对原申请");
      const minutes = await this.policies.approvalLifetime(context.tenantId, snapshot.corporateCustomerId!, snapshot.corporateMembershipId!, tx);
      const id = randomUUID(), expiresAt = new Date(Date.now() + minutes * 60000);
      await tx.$executeRaw`INSERT INTO enterprise_exchange_approvals (tenantId,id,corporateCustomerId,applicantCustomerId,workspaceId,orderId,expectedOrderUpdatedAt,requestFingerprint,previewFingerprint,request,preview,basis,reason,expiresAt) VALUES (${context.tenantId},${id},${snapshot.corporateCustomerId},${context.customerId},${context.workspaceId},${input.orderId},${input.expectedOrderUpdatedAt},${requestFingerprint({ orderId: input.orderId, expected: input.expectedOrderUpdatedAt, exchange: input.exchange })},${requestFingerprint(prepared.preview)},${JSON.stringify(input.exchange)},${JSON.stringify(prepared.preview)},${JSON.stringify(prepared.basis)},${input.reason.trim()},${expiresAt})`;
      return { id, state: "pending", revision: 1, expiresAt: expiresAt.toISOString() };
    }, tx => this.commands.customer(context, tx), "shared", async tx => {
      await this.core.lockOrderForUpdate(context.tenantId, input.orderId, tx);
      await this.commands.customer(context, tx);
    });
  }
  private requestSeal(context: ClientRequestContext, orderId: string, key: string) {
    return { state: "closed" as const, orderId, workspaceId: context.workspaceId, workspaceCode: context.workspaceCode, applicantCustomerId: context.customerId, closedOperationKey: key, retryable: false as const };
  }
  private async readRequestOriginal(context: ClientRequestContext, orderId: string, key: string, tx?: Prisma.TransactionClient): Promise<EnterpriseExchangeRequestOriginalResult> {
    if (requireRequestWorkspaceId() !== context.workspaceId) throw new NotFoundException("本人当前空间原申请不存在");
    const receipt = (await (tx ?? this.prisma).$queryRaw<Array<{ actorUserId: string; target: string; requestHash: string; result: object | string }>>`SELECT actorUserId,target,requestHash,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key}`)[0];
    if (!receipt) return { state: "not_recorded", retryable: false };
    if (receipt.actorUserId !== `customer:${context.customerId}`) throw new NotFoundException("本人原换货申请不存在");
    if (receipt.target === `exchange.request.sealed:${orderId}`) {
      const sealed = this.requestSeal(context, orderId, key), payload = enterpriseJson(receipt.result) as Partial<typeof sealed>;
      if (!payload || requestFingerprint(payload) !== requestFingerprint(sealed) || receipt.requestHash !== requestFingerprint({ action: "exchange.request.sealed", ...sealed })) throw new ConflictException("原换货申请封闭证据不一致");
      return sealed;
    }
    if (receipt.target !== `exchange.request:${orderId}`) throw new NotFoundException("本人原换货申请不存在");
    const payload = enterpriseJson(receipt.result) as { id?: unknown };
    if (typeof payload.id !== "string" || !payload.id) throw new ConflictException("原申请收据关联缺失");
    const row = (await this.rows(context, payload.id, tx))[0]; this.owns(context, row);
    if (row.orderId !== orderId) throw new ConflictException("原换货申请订单关联不一致");
    return { state: "observed", approval: this.view(row), retryable: false };
  }
  async requestOriginal(context: ClientRequestContext, orderId: string, key: string): Promise<EnterpriseExchangeRequestOriginalResult> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原申请键无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const result = await this.readRequestOriginal(context, orderId, key);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return result;
  }
  async closeRequest(context: ClientRequestContext, orderId: string, key: string, input: CloseEnterpriseExchangeRequest): Promise<EnterpriseExchangeRequestOriginalResult> {
    if (input.confirm !== true || input.expectedRevision !== 0 || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key) || key === input.operationKey) throw new BadRequestException("须本人明确原申请键与独立结束请求");
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "exchange.request.close", requestFingerprint({ orderId, workspaceId: context.workspaceId, originalOperationKey: key }), input, async tx => {
      const original = await this.readRequestOriginal(context, orderId, key, tx);
      if (original.state === "not_recorded") {
        // The original request takes this same order fence before its receipt read.
        // The permanent incompatible key and closure receipt commit or roll back together.
        const seal = this.requestSeal(context, orderId, key);
        await tx.$executeRaw`INSERT INTO enterprise_portal_operations (tenantId,operationKey,actorUserId,requestHash,target,reason,result) VALUES (${context.tenantId},${key},${`customer:${context.customerId}`},${requestFingerprint({ action: "exchange.request.sealed", ...seal })},${`exchange.request.sealed:${orderId}`},${input.reason.trim()},${JSON.stringify(seal)})`;
      }
      const receipt: EnterpriseExchangeRequestClosureReceipt = { orderId, workspaceId: context.workspaceId, workspaceCode: context.workspaceCode, applicantCustomerId: context.customerId,
        originalOperationKey: key, closureOperationKey: input.operationKey, retryable: false,
        ...(original.state === "observed" ? { state: "observed", approvalId: original.approval.id } : { state: "closed" }) };
      return receipt;
    }, tx => this.commands.customer(context, tx, false), "shared", async tx => {
      const order = await this.core.lockOrderForUpdate(context.tenantId, orderId, tx);
      // Historical ownership only: closure cannot require a new quote or today's
      // corporate spending grant. Core's own workspace/operation locks still apply.
      if (requireRequestWorkspaceId() !== context.workspaceId || order.tenantId !== context.tenantId || order.id !== orderId || order.membershipSnapshot?.personalCustomerId !== context.customerId) throw new NotFoundException("本人当前空间原订单不存在");
      await this.commands.customer(context, tx, false);
    });
    return this.requestOriginal(context, orderId, key);
  }
  async original(context: ClientRequestContext, id: string) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = (await this.rows(context, id))[0]; this.owns(context, row);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return this.view(row);
  }
  /** Original-order history is independent of today's new-spending eligibility.
   * The ordinary client reader proves ownership; SQL also binds every row to it. */
  async orderApprovals(context: ClientRequestContext, orderId: string): Promise<EnterpriseExchangeApprovalView[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    if (requireRequestWorkspaceId() !== context.workspaceId) throw new NotFoundException("本人当前空间原订单不存在");
    const order = await this.clientApi.getOrder(context, orderId);
    if (order.id !== orderId) throw new ConflictException("原订单读取关联不一致");
    const rows = await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND orderId=${orderId} AND applicantCustomerId=${context.customerId} ORDER BY expiresAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本单换货申请超过当前有界读取范围");
    if (rows.some(row => row.orderId !== orderId || row.workspaceId !== context.workspaceId || row.applicantCustomerId !== context.customerId)) throw new ConflictException("本单换货申请关联不一致");
    const result = rows.map(row => this.view(row));
    await this.clientApi.getOrder(context, orderId);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return result;
  }
  async list(context: ClientRequestContext, corporateId?: string) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    const before = corporateId ? await this.access.requireAction(context, corporateId, "approvals:review") : undefined;
    const rows = corporateId ? await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND corporateCustomerId=${corporateId} ORDER BY expiresAt DESC LIMIT 201`
      : await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_exchange_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND applicantCustomerId=${context.customerId} ORDER BY expiresAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("换货申请超过当前有界读取范围");
    if (corporateId) { const after = await this.access.requireAction(context, corporateId, "approvals:review"); if (before!.permissionRevision !== after.permissionRevision) throw new ForbiddenException("企业审批权限已变化"); }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    return rows.map(row => this.view(row));
  }
  private async lockedRow(context: ClientRequestContext, id: string, tx: Prisma.TransactionClient) {
    const original = (await this.rows(context, id))[0];
    if (!original) throw new NotFoundException("当前空间换货申请不存在");
    await this.core.lockOrderForUpdate(context.tenantId, original.orderId, tx);
    const latest = (await this.rows(context, id, tx))[0];
    if (!latest || latest.orderId !== original.orderId) throw new ConflictException("原换货关联已变化");
    await this.commands.customer(context, tx);
    return latest;
  }
  private async current(row: Approval, context: ClientRequestContext, tx: Prisma.TransactionClient) {
    if (row.expiresAt <= new Date()) throw new ConflictException("换货申请已失效，须重新试算与申请");
    const intent = enterpriseJson(row.request), preview = enterpriseJson(row.preview);
    if (row.requestFingerprint !== requestFingerprint({ orderId: row.orderId, expected: row.expectedOrderUpdatedAt, exchange: intent }) || row.previewFingerprint !== requestFingerprint(preview)) throw new ConflictException("原换货申请或试算指纹不一致");
    // Internal revalidation reads the persisted applicant, never reviewer input.
    const prepared = await this.prepared({ ...context, customerId: row.applicantCustomerId }, row.orderId, row.expectedOrderUpdatedAt, intent, tx);
    if (prepared.order.membershipSnapshot?.corporateCustomerId !== row.corporateCustomerId) throw new ConflictException("原换货付款企业关联已变化");
    const before = enterpriseJson(row.basis);
    if (requestFingerprint({ ...before, acknowledgedAt: undefined }) !== requestFingerprint({ ...prepared.basis, acknowledgedAt: undefined })) throw new ConflictException("企业关系、政策或告知已变化，须重新申请");
    if (requestFingerprint(this.priceBasis(preview)) !== requestFingerprint(this.priceBasis(prepared.preview))) throw new ConflictException("换货价格、资源或执行依据变化，须重新申请");
  }
  async confirmExpense(context: ClientRequestContext, id: string, input: ConfirmEnterpriseExchangeExpense) {
    if (input.confirm !== true) throw new ForbiddenException("须本人核对本次费用后独立确认，不是确认商户检查");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "exchange.expense.confirm", id, input, async tx => {
      const row = await this.lockedRow(context, id, tx); this.owns(context, row);
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "approved" || row.employeeConfirmationOperationKey) throw new ConflictException("原费用批准不可重复确认，请读取原结果");
      await this.current(row, context, tx);
      await this.policies.assertReviewer(context.tenantId, row.corporateCustomerId, row.applicantCustomerId, row.approvedBy ?? null, row.reviewerMembershipId ?? null, row.reviewerMembershipUpdatedAt ?? null, tx);
      const confirmedAt = new Date();
      const changed = await tx.$executeRaw`UPDATE enterprise_exchange_approvals SET employeeConfirmationOperationKey=${input.operationKey},employeeConfirmedAt=${confirmedAt},employeeConfirmationFingerprint=${this.confirmationFingerprint(row)},revision=revision+1 WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id} AND state='approved' AND employeeConfirmationOperationKey IS NULL`;
      if (changed !== 1) throw this.commands.conflict();
      return { id, orderId: row.orderId, workspaceId: row.workspaceId, applicantCustomerId: row.applicantCustomerId, operationKey: input.operationKey,
        confirmedAt: confirmedAt.toISOString(), revision: row.revision + 1, scope: "expense_only_not_inspection_or_execution" as const };
    }, tx => this.commands.customer(context, tx), "shared", tx => this.lockedRow(context, id, tx));
  }
  async confirmationOriginal(context: ClientRequestContext, id: string): Promise<EnterpriseExchangeConfirmationResult> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = (await this.rows(context, id))[0]; this.owns(context, row);
    const approval = this.view(row);
    if (!approval.employeeConfirmation) {
      await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
      return { approval, original: { state: "not_confirmed", retryable: false } };
    }
    const reference = approval.employeeConfirmation;
    const receipt = (await this.prisma.$queryRaw<Array<{ actorUserId: string; target: string; result: object | string }>>`SELECT actorUserId,target,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${reference.operationKey}`)[0];
    const value = receipt && enterpriseJson(receipt.result) as Record<string, unknown> | undefined;
    if (!receipt || receipt.actorUserId !== `customer:${context.customerId}` || receipt.target !== `exchange.expense.confirm:${id}`
      || value?.id !== id || value.orderId !== row.orderId || value.workspaceId !== row.workspaceId || value.applicantCustomerId !== context.customerId
      || value.operationKey !== reference.operationKey || value.confirmedAt !== reference.confirmedAt || value.scope !== reference.scope) throw new ConflictException("原员工费用确认收据不一致，不能重新确认");
    const latest = (await this.rows(context, id))[0]; this.owns(context, latest);
    if (latest.revision !== row.revision || latest.employeeConfirmationOperationKey !== row.employeeConfirmationOperationKey
      || latest.employeeConfirmationFingerprint !== row.employeeConfirmationFingerprint) throw new ConflictException("原员工费用确认关联已变化，请重新核对");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return { approval: this.view(latest), original: { state: "observed" as const, operationKey: reference.operationKey, retryable: false as const } };
  }
  async decide(context: ClientRequestContext, id: string, input: DecideEnterpriseExchangeApproval) {
    if (!["approve", "reject", "withdraw"].includes(input.decision)) throw new BadRequestException("换货决定无效");
    const lock = (tx: Prisma.TransactionClient) => this.lockedRow(context, id, tx);
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "exchange.decision", id, input, async tx => {
      const row = await lock(tx);
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["pending", "approved"].includes(row.state)) throw new ConflictException("原换货申请已处理");
      if (input.decision === "withdraw") this.owns(context, row);
      else {
        if (row.applicantCustomerId === context.customerId) throw new ForbiddenException("申请人和使用人不得自审");
        const reviewer = await this.access.requireAction(context, row.corporateCustomerId, "approvals:review", tx);
        if (row.state !== "pending") throw new ConflictException("原换货批准已作出");
        if (input.decision === "approve") {
          await this.current(row, context, tx);
          const membership = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: reviewer.membershipId }, select: { updatedAt: true } });
          if (!membership) throw new ForbiddenException("当前审批人关系不可用");
          await tx.$executeRaw`UPDATE enterprise_exchange_approvals SET approvedBy=${context.customerId},reviewerMembershipId=${reviewer.membershipId},reviewerMembershipUpdatedAt=${membership.updatedAt} WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id}`;
        }
      }
      const state = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "withdrawn";
      await tx.$executeRaw`UPDATE enterprise_exchange_approvals SET state=${state},decisionReason=${input.reason.trim()},revision=revision+1 WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND id=${id}`;
      return { id, state, revision: row.revision + 1 };
    }, tx => this.commands.customer(context, tx), "shared", lock);
  }
}
