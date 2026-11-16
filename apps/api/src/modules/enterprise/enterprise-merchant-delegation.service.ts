/** Owns one customer's immutable merchant submission source and original receipts.
 * Core owns order execution and the transaction that consumes this participant. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION } from "@rental-os/shared";
import type { EnterpriseOrderDelegationOriginal, EnterpriseOrderDelegationReceipt, EnterpriseOrderDelegationReference,
  EnterpriseOrderDelegationRequestReference, EnterpriseOrderDelegationSource, EnterpriseOrderDelegationView,
  IssueEnterpriseOrderDelegation, RevokeEnterpriseOrderDelegation, SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity, requireRequestTenantId, requireRequestUserId, requireRequestWorkspaceId } from "../../common/request-identity";
import { enabledOrganizationSubtreeIds, organizationLocationScope } from "../../common/organization-location-scope";
import { AuthService } from "../auth/auth.service";
import type { ClientRequestContext } from "../client/client-auth.service";
import { PrismaService } from "../database/prisma.service";
import type { ApprovedOrderBinding, ApprovedOrderTransaction } from "../rental-core/approved-order-transaction.ports";
import { RentalBusinessFactRepository } from "../rental-core/rental-business-fact.repository";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { assertQuoteReadAccess } from "../rental-core/rental-quote-access";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseCommandService, enterpriseHash } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { enterpriseDelegationTarget, readEnterpriseDelegationSource, type EnterpriseDelegationRow, type EnterpriseDelegationStored } from "./enterprise-order-delegation-source";

export interface EnterpriseMerchantDelegationActorAuth { authorization?: string; user: SystemUserRow }
type Stored = EnterpriseDelegationStored;
type Row = EnterpriseDelegationRow;
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
const validKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const action = "order.delegation.issue";
const target = enterpriseDelegationTarget;

@Injectable()
export class EnterpriseMerchantDelegationService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService,
    private readonly approvals: EnterpriseApprovalService, private readonly policies: EnterprisePolicyService,
    private readonly facts: RentalBusinessFactRepository, private readonly orders: RentalOrderConfirmationService,
    private readonly auth: AuthService) {}

  private reference(value: EnterpriseOrderDelegationRequestReference) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["approvalId", "quoteId"].includes(key))) throw new BadRequestException("须引用本人的原批准或持久报价");
    const approvalId = "approvalId" in value ? value.approvalId : undefined, quoteId = "quoteId" in value ? value.quoteId : undefined;
    if (validId(approvalId) && quoteId === undefined) return { approvalId };
    if (validId(quoteId) && approvalId === undefined) return { quoteId };
    throw new BadRequestException("须引用本人的原批准或持久报价");
  }
  private rows(tenantId: string, key: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).$queryRaw<Row[]>(Prisma.sql`SELECT operationKey,actorUserId,requestHash,target,result
      FROM enterprise_portal_operations WHERE tenantId=${tenantId} AND operationKey=${key} ${tx ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  }
  private stored(row: Row, tenantId: string, key: string): Stored {
    const record = readEnterpriseDelegationSource(row, tenantId, key);
    if (this.orders.fingerprintOrderRequest(record.source.request) !== record.source.requestHash) throw new ConflictException("原委托请求指纹不可核对");
    return record;
  }
  private view(record: Stored): EnterpriseOrderDelegationView {
    return { delegationKey: record.source.delegationKey, requestReference: structuredClone(record.source.requestReference),
      personalCustomerId: record.source.personalCustomerId, corporateCustomerId: record.source.corporateCustomerId,
      quoteId: record.source.quoteId, workspaceId: record.source.workspaceId,
      state: record.state === "issued" && Date.parse(record.source.expiresAt) <= Date.now() ? "expired" : record.state,
      revision: record.revision, expiresAt: record.source.expiresAt, confirmedAt: record.source.confirmation.confirmedAt,
      purpose: "merchant_operator", original: record.receipt ? structuredClone(record.receipt)
        : { state: record.state === "revoked" ? "revoked" : "not_submitted", retryable: false }, retryable: false };
  }
  private owns(context: ClientRequestContext, source: EnterpriseOrderDelegationSource) {
    if (source.tenantId !== context.tenantId || source.workspaceId !== context.workspaceId || source.personalCustomerId !== context.customerId
      || requireRequestWorkspaceId() !== context.workspaceId) throw new NotFoundException("本人当前空间原委托不存在");
  }
  async issue(context: ClientRequestContext, input: IssueEnterpriseOrderDelegation) {
    if (input.confirm !== true || !validKey(input.operationKey)) throw new BadRequestException("须本人明确确认原商户委托");
    const reference = this.reference(input.requestReference), body = { ...input, requestReference: reference };
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient);
    const original = (await this.rows(context.tenantId, input.operationKey))[0];
    if (original) {
      const record = this.stored(original, context.tenantId, input.operationKey); this.owns(context, record.source);
      if (original.requestHash !== enterpriseHash({ action, target: requestFingerprint({ quoteId: record.source.quoteId }), input: body })) throw new ConflictException("原委托键已用于不同请求");
      return this.readCustomer(context, input.operationKey);
    }
    const quoteId = await this.approvals.delegationQuoteId(context, reference);
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, action, requestFingerprint({ quoteId }), body, async tx => {
      const previous = await tx.$queryRaw<Row[]>`SELECT operationKey,actorUserId,requestHash,target,result FROM enterprise_portal_operations
        WHERE tenantId=${context.tenantId} AND target=${target(quoteId)} LIMIT 1 FOR UPDATE`;
      if (previous.length) throw new ConflictException("原报价已绑定委托键，请核对原源；新委托须重新报价");
      const material = await this.approvals.delegationMaterial(context, reference, input.expectedRevision, tx), snapshot = material.quote.membershipSnapshot!;
      const value: Omit<EnterpriseOrderDelegationSource, "integrityHash"> = { version: ENTERPRISE_ORDER_DELEGATION_SOURCE_VERSION, purpose: "merchant_operator",
        delegationKey: input.operationKey, tenantId: context.tenantId, workspaceId: context.workspaceId!, personalCustomerId: context.customerId,
        corporateCustomerId: snapshot.corporateCustomerId!, corporateMembershipId: snapshot.corporateMembershipId!, requestReference: reference,
        quoteId: material.quote.id, request: material.request, requestHash: this.orders.fingerprintOrderRequest(material.request), requestContentHash: requestFingerprint(material.request), quoteHash: requestFingerprint(material.quote),
        basis: material.basis, basisHash: requestFingerprint(material.basis), approval: material.approval,
        confirmation: { operationKey: input.operationKey, customerId: context.customerId, confirmedAt: new Date().toISOString(),
          noticeVersion: material.basis.noticeVersion, acknowledgedAt: material.basis.acknowledgedAt }, expiresAt: material.expiresAt };
      const source = { ...value, integrityHash: requestFingerprint(value) };
      await this.approvals.bindDelegationApproval(source, tx);
      return { source, state: "issued", revision: 1 } satisfies Stored;
    }, tx => this.commands.customer(context, tx));
    return this.readCustomer(context, input.operationKey);
  }
  async readCustomer(context: ClientRequestContext, key: string): Promise<EnterpriseOrderDelegationOriginal> {
    if (!validKey(key)) throw new BadRequestException("原委托键无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = (await this.rows(context.tenantId, key))[0], record = row && this.stored(row, context.tenantId, key);
    if (record) this.owns(context, record.source);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const latest = (await this.rows(context.tenantId, key))[0];
    if (requestFingerprint(latest) !== requestFingerprint(row)) throw new ConflictException("原委托在授权读取期间已变化，请按原键核对");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return record ? this.view(record) : { state: "not_recorded", delegationKey: key, retryable: false };
  }
  async revoke(context: ClientRequestContext, input: RevokeEnterpriseOrderDelegation) {
    if (input.confirm !== true || !validKey(input.delegationKey) || input.delegationKey === input.operationKey) throw new BadRequestException("须本人使用独立撤销键确认原委托");
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "order.delegation.revoke", input.delegationKey, input, async tx => {
      const row = (await this.rows(context.tenantId, input.delegationKey, tx))[0];
      if (!row) throw new NotFoundException("本人原委托不存在");
      const record = this.stored(row, context.tenantId, input.delegationKey); this.owns(context, record.source);
      if (record.state === "consumed" || record.state === "revoked") return this.view(record);
      if (record.revision !== input.expectedRevision) throw this.commands.conflict();
      await this.orders.assertApprovedExecutionCanClose(context.tenantId, record.source.request, input.delegationKey, tx);
      await this.approvals.revokeDelegatedApproval(record.source, tx);
      const value: Stored = { ...record, state: "revoked", revision: record.revision + 1 };
      await this.save(row, value, tx); return this.view(value);
    }, tx => this.commands.customer(context, tx, false));
    return this.readCustomer(context, input.delegationKey);
  }
  private async save(row: Row, value: Stored, tx: Prisma.TransactionClient) {
    const count = await tx.$executeRaw`UPDATE enterprise_portal_operations SET result=${JSON.stringify(value)}
      WHERE tenantId=${value.source.tenantId} AND operationKey=${row.operationKey} AND actorUserId=${row.actorUserId}
        AND target=${row.target} AND requestHash=${row.requestHash}`;
    if (count !== 1) throw new ConflictException("原委托源收据写入竞争，请核对原键");
  }
  private async actorScope(actorAuth: EnterpriseMerchantDelegationActorAuth) {
    const identity = getRequestIdentity(), tenantId = requireRequestTenantId(), workspaceId = requireRequestWorkspaceId(), userId = requireRequestUserId();
    if (!actorAuth.user || actorAuth.user.id !== userId || actorAuth.user.tenantId !== tenantId || identity?.audience !== "operator"
      || identity.isSaasAdmin || identity.staffApi) throw new ForbiddenException("仅当前原商户经营会话可读委托源");
    const resolved = await this.auth.resolveAccessContext(actorAuth.authorization, { audience: "operator" }), user = resolved?.user;
    if (!resolved?.workspaceValid || resolved.workspaceId !== workspaceId || !user?.isActive || user.isSaasAdmin || user.id !== userId || user.tenantId !== tenantId
      || !(user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:order:operate"))
      || !(user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:corporate:manage"))) throw new ForbiddenException("当前商户委托权限不可用");
    let scope = user.locationScope ?? { mode: "all" as const, locationIds: [] };
    if (user.dataScope === "organization") {
      if (!user.organizationId) throw new ForbiddenException("当前商户组织范围缺失");
      const organizations = await this.prisma.organizationUnit.findMany({ where: { tenantId }, select: { id: true, parentId: true, status: true } });
      const ids = enabledOrganizationSubtreeIds(organizations, user.organizationId);
      if (!ids.length) throw new ForbiddenException("当前商户组织范围失效");
      const locations = await this.prisma.rentalFulfillmentLocation.findMany({ where: { tenantId, workspaceId, organizationId: { in: ids } }, select: { id: true } });
      scope = organizationLocationScope(locations.map(location => location.id), scope);
    }
    const normalized = (value: typeof scope | undefined) => value && { mode: value.mode, locationIds: [...value.locationIds].sort() };
    if (identity.dataScope !== user.dataScope || identity.organizationId !== user.organizationId
      || requestFingerprint(normalized(identity.locationScope)) !== requestFingerprint(normalized(scope))) throw new ForbiddenException("当前商户数据范围已变化");
    if (requireRequestTenantId() !== tenantId || requireRequestWorkspaceId() !== workspaceId || requireRequestUserId() !== userId) throw new ForbiddenException("当前商户委托身份已变化");
    return { tenantId, workspaceId, userId };
  }
  private async merchantSource(actorAuth: EnterpriseMerchantDelegationActorAuth, reference: Omit<EnterpriseOrderDelegationReference, "expectedRevision"> & { expectedRevision?: number }, tx?: Prisma.TransactionClient) {
    if (!validKey(reference.delegationKey) || reference.expectedRevision !== undefined && (!Number.isSafeInteger(reference.expectedRevision) || reference.expectedRevision !== 1)) throw new BadRequestException("原委托引用或修订无效");
    const scope = await this.actorScope(actorAuth), row = (await this.rows(scope.tenantId, reference.delegationKey, tx))[0];
    if (!row) throw new NotFoundException("当前商户原委托源不存在");
    const record = this.stored(row, scope.tenantId, reference.delegationKey);
    if (record.source.workspaceId !== scope.workspaceId || reference.approvalId !== undefined && reference.approvalId !== record.source.approval?.id) throw new NotFoundException("当前空间原委托源不存在");
    const quote = await this.facts.findQuote(scope.tenantId, record.source.quoteId, tx);
    if (!quote || quote.request.customerId !== record.source.personalCustomerId) throw new ConflictException("原委托报价关联缺失");
    assertQuoteReadAccess(quote);
    await this.actorScope(actorAuth);
    return { scope, row, record, quote };
  }
  private async stableMerchantSource(actorAuth: EnterpriseMerchantDelegationActorAuth,
    reference: Omit<EnterpriseOrderDelegationReference, "expectedRevision"> & { expectedRevision?: number }) {
    const original = await this.merchantSource(actorAuth, reference);
    const latest = (await this.rows(original.scope.tenantId, reference.delegationKey))[0];
    if (requestFingerprint(latest) !== requestFingerprint(original.row)) throw new ConflictException("原委托在商户授权读取期间已变化");
    await this.actorScope(actorAuth);
    const closing = (await this.rows(original.scope.tenantId, reference.delegationKey))[0];
    if (requestFingerprint(closing) !== requestFingerprint(original.row)) throw new ConflictException("原委托在商户最终授权核对期间已变化");
    return original;
  }
  async readMerchant(actorAuth: EnterpriseMerchantDelegationActorAuth, key: string) {
    const value = await this.stableMerchantSource(actorAuth, { delegationKey: key });
    return this.view(value.record);
  }
  private async newSubmission(value: Awaited<ReturnType<EnterpriseMerchantDelegationService["merchantSource"]>>, tx: Prisma.TransactionClient) {
    const { source } = value.record;
    if (value.record.state !== "issued" || Date.parse(source.expiresAt) <= Date.now() || value.quote.consumedAt || value.quote.consumedOrderId
      || Date.parse(value.quote.expiresAt) <= Date.now() || requestFingerprint(value.quote) !== source.quoteHash) throw new ConflictException("原委托或报价已消费、撤销或到期");
    const basis = await this.policies.revalidateQuote(source.tenantId, source.workspaceId, value.quote, tx);
    this.policies.assertSameBasis(source.basis, basis);
    await this.policies.assertQuoteAmount(source.tenantId, source.corporateCustomerId, source.corporateMembershipId, value.quote, tx);
    await this.approvals.checkDelegatedApproval(source, tx);
  }
  /** Server-only original material for Core receipt checks. The issuing revision
   * stays fixed while consumption or revocation advances the current revision. */
  async readMerchantDelegatedSubmission(actorAuth: EnterpriseMerchantDelegationActorAuth,
    reference: EnterpriseOrderDelegationReference) {
    if (!Number.isSafeInteger(reference.expectedRevision) || reference.expectedRevision !== 1) throw new BadRequestException("原委托引用或签发修订无效");
    const value = await this.stableMerchantSource(actorAuth, reference);
    return { tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId, personalCustomerId: value.record.source.personalCustomerId,
      corporateCustomerId: value.record.source.corporateCustomerId, delegationKey: reference.delegationKey, coreIdempotencyKey: reference.delegationKey,
      version: value.record.source.version, purpose: value.record.source.purpose, quoteId: value.record.source.quoteId,
      approvalId: value.record.source.approval?.id, issuedRevision: 1 as const, state: value.record.state,
      revision: value.record.revision, expiresAt: value.record.source.expiresAt,
      sourceHash: value.record.source.integrityHash, basisHash: value.record.source.basisHash,
      requestHash: value.record.source.requestHash, request: structuredClone(value.record.source.request) };
  }
  async prepareMerchantDelegatedSubmission(actorAuth: EnterpriseMerchantDelegationActorAuth, reference: EnterpriseOrderDelegationReference) {
    const { state, issuedRevision, ...value } = await this.readMerchantDelegatedSubmission(actorAuth, reference);
    if (state !== "issued" || issuedRevision !== reference.expectedRevision || value.revision !== issuedRevision || Date.parse(value.expiresAt) <= Date.now()) throw new ConflictException("原委托不能新提交，请读取原收据");
    return value;
  }
  merchantDelegationParticipant(actorAuth: EnterpriseMerchantDelegationActorAuth, reference: EnterpriseOrderDelegationReference): ApprovedOrderTransaction {
    const actor = structuredClone(actorAuth), original = structuredClone(reference);
    const prepared = new WeakMap<Prisma.TransactionClient, { bindingHash: string; sourceHash: string }>();
    const bindingMatches = (source: EnterpriseOrderDelegationSource, binding: Readonly<ApprovedOrderBinding>) => {
      if (binding.tenantId !== source.tenantId || binding.workspaceId !== source.workspaceId || binding.idempotencyKey !== source.delegationKey
        || binding.requestFingerprint !== source.requestHash || this.orders.fingerprintOrderRequest(binding.request) !== source.requestHash) throw new ConflictException("Core 原请求/K 与委托源不一致");
    };
    return {
      authorize: async binding => { const value = await this.merchantSource(actor, original); bindingMatches(value.record.source, binding);
        if (value.record.state === "revoked" || value.record.state === "issued" && (value.record.revision !== original.expectedRevision || Date.parse(value.record.source.expiresAt) <= Date.now())) throw new ConflictException("原委托不能新提交"); },
      recover: async binding => { const value = await this.merchantSource(actor, original); bindingMatches(value.record.source, binding);
        if (value.record.receipt && value.record.receipt.actorUserId !== value.scope.userId) throw new ConflictException("原消费操作者与本次执行不一致");
        if (value.record.receipt) await this.approvals.checkDelegatedApproval(value.record.source, undefined, value.record.receipt.orderId);
        return value.record.receipt?.orderId ?? null; },
      prepare: async (tx, binding) => { await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${binding.tenantId} AND status='ACTIVE' FOR UPDATE`;
        const value = await this.merchantSource(actor, original, tx); bindingMatches(value.record.source, binding);
        if (value.record.revision !== original.expectedRevision) throw this.commands.conflict(); await this.newSubmission(value, tx);
        prepared.set(tx, { bindingHash: requestFingerprint(binding), sourceHash: value.record.source.integrityHash }); },
      commit: async (tx, binding, orderId) => { const preparation = prepared.get(tx);
        if (!preparation || preparation.bindingHash !== requestFingerprint(binding)) throw new ConflictException("委托消费须使用已复验的同一Core事务与原绑定");
        const value = await this.merchantSource(actor, original, tx); bindingMatches(value.record.source, binding);
        if (preparation.sourceHash !== value.record.source.integrityHash) throw new ConflictException("原委托源在Core事务中已变化");
        if (value.record.state !== "issued" || Date.parse(value.record.source.expiresAt) <= Date.now() || value.record.revision !== original.expectedRevision || !validId(orderId)) throw this.commands.conflict();
        const source = value.record.source;
        const order = await tx.rentalOrder.findFirst({ where: { tenantId: source.tenantId, workspaceId: source.workspaceId, id: orderId },
          select: { quoteId: true, customerId: true } });
        if (!order || order.quoteId !== source.quoteId || order.customerId !== source.personalCustomerId) throw new ConflictException("Core 原订单与委托源不一致");
        await this.approvals.consumeDelegatedApproval(source, tx, orderId);
        const receipt: EnterpriseOrderDelegationReceipt = { state: "consumed", delegationKey: source.delegationKey, sourceHash: source.integrityHash,
          tenantId: source.tenantId, workspaceId: source.workspaceId, personalCustomerId: source.personalCustomerId, corporateCustomerId: source.corporateCustomerId,
          quoteId: source.quoteId, requestHash: source.requestHash, coreIdempotencyKey: binding.idempotencyKey, actorUserId: value.scope.userId,
          orderId, consumedAt: new Date().toISOString(), retryable: false };
        await this.save(value.row, { ...value.record, state: "consumed", revision: value.record.revision + 1, receipt, receiptHash: requestFingerprint(receipt) }, tx); },
      replay: async (binding, orderId) => { const value = await this.merchantSource(actor, original); bindingMatches(value.record.source, binding);
        if (value.record.state !== "consumed" || value.record.receipt?.orderId !== orderId || value.record.receipt.actorUserId !== value.scope.userId) throw new ConflictException("原委托消费收据不一致");
        await this.approvals.checkDelegatedApproval(value.record.source, undefined, orderId); }
    };
  }
}
