/** Exact approved merchant exchange. Core owns pricing, prepared evidence,
 * stock/change/credit and original receipts; the enterprise owner participates
 * in this same transaction. No retries, provider calls or invented approvals. */
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ExecuteApprovedRentalExchangeRequest, RentalApprovedExchangeOriginal, RentalApprovedExchangeReceipt, SystemUserRow } from "@rental-os/shared";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalExchangePreviewService } from "./rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "./rental-exchange-inspection-preparation.service";
import { readExchangeInspectionConsent, verifyExchangeInspectionConsentReceipt, type ExchangeInspectionConsentRow } from "./rental-exchange-inspection-consent.service";
import { approvedExchangeOriginalFacts, recheckApprovedExchange, verifyApprovedExchange, verifyConsumedExchangeApproval } from "./rental-approved-exchange-authorization";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
import { requestFingerprint } from "./rental-idempotency.repository";
import type { ApprovedExchangeBinding, ApprovedExchangeTransaction } from "./approved-exchange-transaction.ports";

const action = "order.change.post-pickup-exchange";
const validId = (value: unknown): value is string => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const validKey = (value: unknown): value is string => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
interface ExecutionRow {
  tenantId: string; workspaceId: string; approvalId: string; orderId: string; changeId: string; actorUserId: string;
  operationKey: string; preparationId: string; consentId: string; requestHash: string; approvalHash: string;
  request: string | ExecuteApprovedRentalExchangeRequest;
  payloadHash: string; payload: string | RentalApprovedExchangeReceipt;
}
@Injectable()
export class RentalApprovedExchangeService {
  constructor(private readonly prisma: PrismaService, private readonly core: RentalCoreService,
    private readonly prices: RentalExchangePreviewService, private readonly business: RentalBusinessService,
    private readonly inspections: RentalExchangeInspectionPreparationService, private readonly idempotent: RentalIdempotentActionService,
    private readonly policies: EnterprisePolicyService, private readonly corporateSettlement: CustomerCorporateSettlementService) {}

  private input(orderId: string, input: ExecuteApprovedRentalExchangeRequest) {
    if (!validId(orderId) || !input || Object.keys(input).some(key => !["operationKey", "approvalId", "expectedApprovalRevision", "expectedOrderUpdatedAt",
      "preparationId", "preparationHash", "consentId", "consentOperationKey", "reason", "confirm"].includes(key))
      || !validKey(input.operationKey) || !validKey(input.consentOperationKey) || input.operationKey === input.consentOperationKey
      || ![input.approvalId, input.preparationId, input.consentId].every(validId) || !Number.isSafeInteger(input.expectedApprovalRevision) || input.expectedApprovalRevision < 3
      || typeof input.preparationHash !== "string" || input.preparationHash.length !== 64 || !/^[a-f0-9]{64}$/u.test(input.preparationHash)
      || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt)) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 500
      || input.confirm !== true) throw new BadRequestException("须明确原换货批准、检查同意、修订及独立执行键");
    return structuredClone(input);
  }
  private participant(value: ApprovedExchangeTransaction): ApprovedExchangeTransaction {
    if (!value || [value.prepare, value.commit, value.replay].some(method => typeof method !== "function")) throw new BadRequestException("原企业批准事务参与者未装配");
    return { prepare: value.prepare.bind(value), commit: value.commit.bind(value), replay: value.replay.bind(value) };
  }
  private rows(tx: Prisma.TransactionClient, scope: { tenantId: string; workspaceId: string; userId: string }, orderId: string, key: string) {
    return tx.$queryRaw<ExecutionRow[]>`SELECT * FROM rental_approved_exchange_executions WHERE tenantId=${scope.tenantId}
      AND workspaceId=${scope.workspaceId} AND actorUserId=${scope.userId} AND orderId=${orderId} AND operationKey=${key}`;
  }
  private receipt(row: ExecutionRow, binding: ApprovedExchangeBinding) {
    let value: RentalApprovedExchangeReceipt;
    try { value = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; }
    catch { throw new ConflictException("原换货执行收据不可读取"); }
    if (!value || row.tenantId !== binding.tenantId || row.workspaceId !== binding.workspaceId || row.orderId !== binding.orderId
      || row.actorUserId !== binding.actorUserId || row.operationKey !== binding.request.operationKey || row.requestHash !== binding.requestHash
      || value.orderId !== row.orderId || value.workspaceId !== row.workspaceId || value.actorUserId !== row.actorUserId || value.operationKey !== row.operationKey
      || value.approvalId !== row.approvalId || value.changeId !== row.changeId || value.preparationId !== row.preparationId || value.consentId !== row.consentId
      || value.approvalId !== binding.request.approvalId || value.preparationId !== binding.request.preparationId || value.preparationHash !== binding.request.preparationHash
      || value.consentId !== binding.request.consentId || value.consentOperationKey !== binding.request.consentOperationKey
      || typeof value.consentHash !== "string" || value.consentHash.length !== 64 || !/^[a-f0-9]{64}$/u.test(value.consentHash)
      || value.coreIdempotencyKey !== binding.coreIdempotencyKey || value.requestHash !== binding.requestHash || value.state !== "applied" || value.retryable !== false
      || !Number.isFinite(Date.parse(value.appliedAt)) || typeof value.changeHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.changeHash)
      || requestFingerprint(value) !== row.payloadHash) throw new ConflictException("原换货执行收据与原K/C和业务对象不一致");
    return structuredClone(value);
  }
  private async replay(tx: Prisma.TransactionClient, binding: ApprovedExchangeBinding, row: ExecutionRow, participant: ApprovedExchangeTransaction) {
    const receipt = this.receipt(row, binding);
    const approval = await verifyConsumedExchangeApproval(tx, binding, row.approvalHash);
    const consents = await tx.$queryRaw<ExchangeInspectionConsentRow[]>`SELECT * FROM rental_exchange_inspection_consents
      WHERE tenantId=${binding.tenantId} AND workspaceId=${binding.workspaceId} AND orderId=${binding.orderId} AND customerId=${approval.applicantCustomerId}
        AND id=${receipt.consentId} AND operationKey=${receipt.consentOperationKey} LOCK IN SHARE MODE`;
    if (consents.length !== 1) throw new ConflictException("原换货具体检查同意关联缺失");
    const consent = readExchangeInspectionConsent(consents[0], { ...binding, customerId: approval.applicantCustomerId });
    if (consent.preparationId !== receipt.preparationId || consent.preparationHash !== receipt.preparationHash || requestFingerprint(consent) !== receipt.consentHash) {
      throw new ConflictException("原换货检查同意被替换或与持久K收据不同");
    }
    await verifyExchangeInspectionConsentReceipt(this.idempotent, tx, binding.tenantId, consent);
    const change = (await this.core.listOrderChanges(binding.tenantId, binding.orderId, tx)).find(change => change.id === receipt.changeId);
    if (!change || change.tenantId !== binding.tenantId || change.workspaceId !== binding.workspaceId || change.orderId !== binding.orderId
      || change.type !== "post_pickup_exchange" || change.status !== "applied" || change.idempotencyKey !== binding.coreIdempotencyKey
      || requestFingerprint(change) !== receipt.changeHash) throw new ConflictException("原换货正式变更缺失或与持久收据不同，不能重发");
    await participant.replay(tx, structuredClone(binding), structuredClone(receipt)); return receipt;
  }
  private binding(scope: { tenantId: string; workspaceId: string; userId: string }, orderId: string, input: ExecuteApprovedRentalExchangeRequest): ApprovedExchangeBinding {
    return { tenantId: scope.tenantId, workspaceId: scope.workspaceId, orderId, actorUserId: scope.userId,
      coreIdempotencyKey: `approved-exchange:${requestFingerprint({ actorUserId: scope.userId, operationKey: input.operationKey })}`,
      requestHash: requestFingerprint({ orderId, actorUserId: scope.userId, input }), request: structuredClone(input) };
  }

  async execute(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: ExecuteApprovedRentalExchangeRequest,
    participant: ApprovedExchangeTransaction): Promise<RentalApprovedExchangeReceipt> {
    const body = this.input(orderId, input), owner = this.participant(participant), operator = structuredClone(actor);
    const result = await this.prisma.$transaction(tx => this.executeInTransaction(authorization, operator, orderId, body, owner, tx),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
    // Publication follows acknowledged commit. A failed refresh leaves the
    // already committed key readable; it never authorizes another execution.
    await this.business.refreshFromDatabase();
    await this.inspections.mediaScope(authorization, operator); return result;
  }

  /** The enterprise application may own the outer transaction instead. It must
   * publish its response/cache only after that transaction acknowledges COMMIT. */
  async executeInTransaction(authorization: string | undefined, actor: SystemUserRow, orderId: string, input: ExecuteApprovedRentalExchangeRequest,
    participant: ApprovedExchangeTransaction, tx: Prisma.TransactionClient): Promise<RentalApprovedExchangeReceipt> {
    const body = this.input(orderId, input), owner = this.participant(participant), operator = structuredClone(actor);
    const { scope } = await this.inspections.mediaOrder(authorization, operator, orderId, tx), binding = this.binding(scope, orderId, body);
    const run = await this.idempotent.executeInTransaction({ tenantId: scope.tenantId, orderId, action,
      key: binding.coreIdempotencyKey, fallbackKey: binding.coreIdempotencyKey, request: { orderId, actorUserId: scope.userId, input: body },
      run: async () => {
        const existing = (await this.rows(tx, scope, orderId, body.operationKey))[0];
        // One evidence source without the original Core key is a damaged commit,
        // not an invitation to repair it by applying the exchange again.
        if (existing) throw new ConflictException("原换货执行已有持久证据但原幂等收据缺失，须核对");
        await owner.prepare(tx, structuredClone(binding));
        const { order, preparation } = await this.inspections.readForExecution(authorization, operator, orderId, body.preparationId,
          body.preparationHash, body.expectedOrderUpdatedAt, tx);
        // Original approval pricing never contained inspection confirmations.
        // Reprice that exact intent first, then separately attach verified facts.
        const intent = { orderLineId: preparation.exchange.orderLineId, allocationId: preparation.exchange.allocationId,
          replacementItemGroupId: preparation.exchange.replacementItemGroupId, replacementAssetId: preparation.exchange.replacementAssetId,
          replacementPricingGroupId: preparation.exchange.replacementPricingGroupId,
          priceBasis: preparation.exchange.priceBasis };
        const { preview } = await this.prices.preview(scope.tenantId, orderId, intent, tx);
        const verified = await verifyApprovedExchange(tx, this.policies, binding, order, preview, preparation);
        const originals = approvedExchangeOriginalFacts(verified.authority, tx);
        await verifyExchangeInspectionConsentReceipt(this.idempotent, tx, scope.tenantId, originals.consent);
        if (preview.differenceAmount >= 0 && preview.exchange?.executionBasis?.linePricing?.couponPricing) {
          await this.business.repriceCouponForOrder(scope.tenantId, orderId, preview.exchange.executionBasis.linePricing.couponPricing.replacementReduction, tx);
        }
        const applied = await this.core.applyPostPickupExchange(scope.tenantId, orderId, preview, verified.input, binding.coreIdempotencyKey,
          operator.displayName, tx, verified.authority);
        if (applied.change.additionalAmount > 0 && await this.corporateSettlement.requiresCreditSettlement(scope.tenantId, orderId, tx)) {
          await this.corporateSettlement.reserveOrderChangeCredit(scope.tenantId, orderId, applied.change.id, applied.change.additionalAmount, tx, operator.displayName);
        }
        await recheckApprovedExchange(verified.authority, tx, this.policies, "approved");
        const receipt: RentalApprovedExchangeReceipt = { orderId, workspaceId: scope.workspaceId, changeId: applied.change.id, approvalId: body.approvalId,
          preparationId: body.preparationId, preparationHash: body.preparationHash, consentId: body.consentId, consentOperationKey: body.consentOperationKey,
          consentHash: requestFingerprint(originals.consent),
          actorUserId: scope.userId, operationKey: body.operationKey, coreIdempotencyKey: binding.coreIdempotencyKey, requestHash: binding.requestHash,
          changeHash: requestFingerprint(applied.change), appliedAt: applied.change.appliedAt!, state: "applied", retryable: false };
        await owner.commit(tx, structuredClone(binding), structuredClone(receipt));
        await recheckApprovedExchange(verified.authority, tx, this.policies, "consumed");
        await tx.$executeRaw`INSERT INTO rental_approved_exchange_executions (tenantId,workspaceId,approvalId,orderId,changeId,actorUserId,operationKey,preparationId,consentId,requestHash,approvalHash,request,payloadHash,payload)
          VALUES (${scope.tenantId},${scope.workspaceId},${body.approvalId},${orderId},${receipt.changeId},${scope.userId},${body.operationKey},${body.preparationId},${body.consentId},${binding.requestHash},${originals.approvalHash},${JSON.stringify(body)},${requestFingerprint(receipt)},${JSON.stringify(receipt)})`;
        await this.inspections.mediaScope(authorization, operator); return receipt;
      }, replay: async response => {
        const rows = await this.rows(tx, scope, orderId, body.operationKey);
        if (rows.length !== 1 || requestFingerprint(response) !== rows[0].payloadHash) return undefined;
        return this.replay(tx, binding, rows[0], owner);
      } }, tx);
    await this.inspections.mediaScope(authorization, operator); return run.result;
  }

  /** Exact original K only; private input is reconstructed from its stored
   * request. Absence stays unknown and does not call
   * participant.prepare, pricing, stock, credit or any execution method. */
  async original(authorization: string | undefined, actor: SystemUserRow, orderId: string, key: string,
    participant: ApprovedExchangeTransaction): Promise<RentalApprovedExchangeOriginal> {
    if (!validId(orderId) || !validKey(key)) throw new BadRequestException("原换货执行键无效");
    const owner = this.participant(participant), operator = structuredClone(actor);
    const result = await this.prisma.$transaction(async tx => {
      const { scope } = await this.inspections.mediaOrder(authorization, operator, orderId, tx);
      const rows = await this.rows(tx, scope, orderId, key);
      const coreKey = `approved-exchange:${requestFingerprint({ actorUserId: scope.userId, operationKey: key })}`;
      const receipt = await this.idempotent.readReceipt({ tenantId: scope.tenantId, action, key: coreKey, orderId,
        replay: async response => {
          if (rows.length !== 1 || requestFingerprint(response) !== rows[0].payloadHash) return undefined;
          let original: ExecuteApprovedRentalExchangeRequest;
          try { original = typeof rows[0].request === "string" ? JSON.parse(rows[0].request) : rows[0].request; }
          catch { throw new ConflictException("原换货执行请求不可读取，不能重发"); }
          if (original?.operationKey !== key) throw new ConflictException("原换货执行请求键不一致");
          return this.replay(tx, this.binding(scope, orderId, this.input(orderId, original)), rows[0], owner);
        } }, tx);
      if (!receipt && rows.length) throw new ConflictException("原换货收据未齐，不能将缺失解释为未执行");
      await this.inspections.mediaScope(authorization, operator);
      return receipt ? { state: "observed" as const, receipt, retryable: false as const } : { state: "not_recorded" as const, retryable: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await this.inspections.mediaScope(authorization, operator); return result;
  }
}
