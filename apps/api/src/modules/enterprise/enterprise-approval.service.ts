/** Quote approval is authorization only. A separate, explicit applicant command
 * binds the original Core transaction; unknown execution never dispatches again. */
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CloseEnterpriseApprovalExecution, CreateRentalOrderRequest, DecideEnterpriseBookingApproval, EnterpriseApprovalOriginalResult, EnterpriseBookingApprovalView, EnterpriseBookingBasis, EnterpriseBookingReview, EnterpriseOrderDelegationRequestReference, EnterpriseOrderDelegationSource, RentalQuoteSnapshotV1, RequestEnterpriseBookingApproval, SubmitEnterpriseApprovedBooking } from "@rental-os/shared";
import { requireRequestWorkspaceId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";
import { ClientApiService } from "../client/client-api.service";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { RentalBusinessFactRepository } from "../rental-core/rental-business-fact.repository";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import type { ApprovedOrderBinding, ApprovedOrderTransaction } from "../rental-core/approved-order-transaction.ports";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { readQuoteEnterpriseDelegation } from "./enterprise-order-delegation-source";

type Approval = { id: string; corporateCustomerId: string; applicantCustomerId: string; workspaceId: string; quoteId: string;
  state: EnterpriseBookingApprovalView["state"]; revision: number; expiresAt: Date; purpose: string; orderId: string | null;
  amount: Prisma.Decimal; currency: string; quote: string | RentalQuoteSnapshotV1; request: string | CreateRentalOrderRequest;
  basis: string | EnterpriseBookingBasis; requestFingerprint: string; executionKey: string | null; approvedBy: string | null;
  reviewerMembershipId: string | null; reviewerMembershipUpdatedAt: Date | null };
@Injectable()
export class EnterpriseApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly policies: EnterprisePolicyService,
    private readonly access: EnterpriseAccessService, private readonly facts: RentalBusinessFactRepository, private readonly orders: RentalOrderConfirmationService, private readonly clientApi: ClientApiService) {}
  private row(tenantId: string, id: string, tx: Prisma.TransactionClient = this.prisma as unknown as Prisma.TransactionClient) {
    return tx.$queryRaw<Approval[]>(Prisma.sql`SELECT * FROM enterprise_booking_approvals WHERE tenantId=${tenantId} AND id=${id} ${tx === this.prisma as unknown as Prisma.TransactionClient ? Prisma.empty : Prisma.sql`FOR UPDATE`}`);
  }
  private view(row: Approval): EnterpriseBookingApprovalView {
    const quote = enterpriseJson(row.quote);
    // Private addresses, credentials and qualification documents are never in the review projection.
    const amount = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) ? value : null;
    const review: EnterpriseBookingReview = { quoteNo: quote.quoteNo ?? null, categoryCode: quote.categoryCode, expiresAt: quote.expiresAt,
      startAt: quote.request.startAt ?? null, endAt: quote.request.endAt ?? null, fulfillmentMode: quote.request.fulfillmentMode ?? null,
      applicantName: quote.membershipSnapshot?.personalCustomerName ?? null, corporateName: quote.membershipSnapshot?.corporateCustomerName ?? null,
      lines: quote.request.lines.map(line => {
        const rate = quote.rateSnapshot?.find(rate => line.itemGroupId ? rate.itemGroupId === line.itemGroupId : Boolean(line.pricingGroupId && rate.pricingGroupId === line.pricingGroupId));
        return { itemGroupId: line.itemGroupId, pricingGroupId: line.pricingGroupId, itemGroupName: line.itemGroupId ? rate?.itemGroupName ?? null : null,
          pricingGroupName: line.pricingGroupName ?? rate?.pricingGroupName ?? null, quantity: line.quantity };
      }),
      chargeLines: quote.chargeLines.map(line => ({ code: line.code, name: line.name, type: line.type, amount: amount(line.amount) })),
      rentalAmount: amount(quote.rentalAmount), discountAmount: amount(quote.discountAmount), couponAmount: amount(quote.couponAmount), serviceAmount: amount(quote.serviceAmount),
      fulfillmentAmount: amount(quote.fulfillmentAmount), taxAmount: amount(quote.taxAmount), payableAmount: amount(quote.payableAmount),
      depositAmount: amount(quote.depositAmount), preAuthAmount: amount(quote.preAuthAmount), currency: quote.currency ?? null,
      guaranteePayer: quote.membershipSnapshot?.enterpriseBasis?.guaranteePayer ?? null, guaranteeSource: "not_recorded",
      paymentResponsibility: "enterprise", settlementMode: quote.membershipSnapshot?.settlement?.mode ?? null };
    return { id: row.id, corporateCustomerId: row.corporateCustomerId, applicantCustomerId: row.applicantCustomerId, workspaceId: row.workspaceId,
      quoteId: row.quoteId, state: ["pending", "approved"].includes(row.state) && row.expiresAt <= new Date() ? "expired" : row.state,
      revision: row.revision, expiresAt: row.expiresAt.toISOString(), purpose: row.purpose, orderId: row.orderId ?? undefined,
      amount: String(row.amount), currency: row.currency, quote: review };
  }
  private async current(row: Approval, tenantId: string, tx: Prisma.TransactionClient) {
    const quote = enterpriseJson(row.quote), before = enterpriseJson(row.basis);
    if (row.expiresAt <= new Date()) throw new ConflictException("批准或原报价已到期，须重新报价与审批");
    const after = await this.policies.revalidateQuote(tenantId, row.workspaceId, quote, tx);
    this.policies.assertSameBasis(before, after);
    await this.policies.assertQuoteAmount(tenantId, row.corporateCustomerId, quote.membershipSnapshot!.corporateMembershipId!, quote, tx);
    if (row.approvedBy) await this.policies.assertReviewer(tenantId, row.corporateCustomerId, row.applicantCustomerId, row.approvedBy, row.reviewerMembershipId, row.reviewerMembershipUpdatedAt, tx);
  }
  /** Resolve only the authenticated applicant's original reference. Receipt readers
   * can locate an expired reference; new delegation material is checked separately. */
  async delegationQuoteId(context: ClientRequestContext, reference: EnterpriseOrderDelegationRequestReference) {
    if ("quoteId" in reference) return reference.quoteId;
    const row = (await this.row(context.tenantId, reference.approvalId))[0];
    if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId) throw new NotFoundException("本人原批准不存在");
    return row.quoteId;
  }
  async delegationMaterial(context: ClientRequestContext, reference: EnterpriseOrderDelegationRequestReference, expectedRevision: number,
    tx: Prisma.TransactionClient): Promise<{ quote: RentalQuoteSnapshotV1; request: CreateRentalOrderRequest; basis: EnterpriseBookingBasis; approval?: EnterpriseOrderDelegationSource["approval"]; expiresAt: string }> {
    let approval: Approval | undefined;
    if ("approvalId" in reference) {
      approval = (await this.row(context.tenantId, reference.approvalId, tx))[0];
      if (!approval || approval.applicantCustomerId !== context.customerId || approval.workspaceId !== context.workspaceId) throw new NotFoundException("本人原批准不存在");
      if (approval.revision !== expectedRevision) throw this.commands.conflict();
      if (approval.state !== "approved" || approval.executionKey || approval.orderId) throw new ConflictException("原批准已提交或不可委托");
      await this.current(approval, context.tenantId, tx);
    } else if (expectedRevision !== 0) throw this.commands.conflict();
    const quoteId = approval?.quoteId ?? ("quoteId" in reference ? reference.quoteId : "");
    const quote = await this.facts.findQuote(context.tenantId, quoteId, tx);
    const snapshot = quote?.membershipSnapshot;
    if (!quote || quote.tenantId !== context.tenantId || quote.request.customerId !== context.customerId || quote.consumedAt || quote.consumedOrderId
      || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now() || requireRequestWorkspaceId() !== context.workspaceId
      || snapshot?.bookingIdentity !== "enterprise_employee" || !snapshot.enterpriseContractAndPayer || !snapshot.enterpriseBasis
      || snapshot.personalCustomerId !== context.customerId || !snapshot.corporateCustomerId || !snapshot.corporateMembershipId
      || snapshot.enterpriseBasis.guaranteePayer !== "enterprise") throw new ForbiddenException("本人原企业报价、告知或企业保证金依据不可核对");
    if (snapshot.enterpriseBasis.approvalMode === "per_order" && !approval) throw new ForbiddenException("本次逐单企业付费须先取得原企业批准");
    if (!approval && snapshot.enterpriseBasis.approvalMode !== "without_per_order") throw new ForbiddenException("当前报价没有可用的企业付费授权");
    const basis = await this.policies.revalidateQuote(context.tenantId, context.workspaceId, quote, tx);
    if (!basis) throw new ForbiddenException("当前企业授权不可用");
    this.policies.assertSameBasis(snapshot.enterpriseBasis, basis);
    await this.policies.assertQuoteAmount(context.tenantId, snapshot.corporateCustomerId, snapshot.corporateMembershipId, quote, tx);
    const request = approval ? enterpriseJson(approval.request) : (await this.clientApi.prepareOrderSubmission(context, { quoteId })).request;
    this.orders.assertOrderMatchesQuote(request, quote);
    if (approval && (approval.corporateCustomerId !== snapshot.corporateCustomerId || requestFingerprint(enterpriseJson(approval.quote)) !== requestFingerprint(quote)
      || approval.requestFingerprint !== this.orders.fingerprintOrderRequest(request))) throw new ConflictException("原批准与持久报价或请求不一致");
    return { quote, request: structuredClone(request), basis: structuredClone(snapshot.enterpriseBasis),
      approval: approval ? { id: approval.id, revision: approval.revision, requestHash: approval.requestFingerprint, quoteHash: requestFingerprint(quote) } : undefined,
      expiresAt: new Date(Math.min(Date.parse(quote.expiresAt), approval?.expiresAt.getTime() ?? Infinity)).toISOString() };
  }
  async bindDelegationApproval(source: EnterpriseOrderDelegationSource, tx: Prisma.TransactionClient) {
    if (!source.approval) return;
    const count = await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='executing',executionKey=${source.delegationKey},revision=revision+1
      WHERE tenantId=${source.tenantId} AND id=${source.approval.id} AND workspaceId=${source.workspaceId} AND applicantCustomerId=${source.personalCustomerId}
        AND state='approved' AND revision=${source.approval.revision} AND executionKey IS NULL AND orderId IS NULL`;
    if (count !== 1) throw this.commands.conflict();
  }
  async checkDelegatedApproval(source: EnterpriseOrderDelegationSource, tx: Prisma.TransactionClient | undefined, consumedOrderId?: string) {
    if (!source.approval) return;
    const row = (await this.row(source.tenantId, source.approval.id, tx))[0];
    if (!row || row.workspaceId !== source.workspaceId || row.applicantCustomerId !== source.personalCustomerId || row.corporateCustomerId !== source.corporateCustomerId
      || row.quoteId !== source.quoteId || row.requestFingerprint !== source.requestHash || row.executionKey !== source.delegationKey
      || requestFingerprint(enterpriseJson(row.quote)) !== source.quoteHash || row.state !== (consumedOrderId ? "consumed" : "executing")
      || (consumedOrderId ? row.orderId !== consumedOrderId : Boolean(row.orderId))) throw new ConflictException("原委托与企业批准消费关联不一致");
    if (!consumedOrderId) {
      if (!tx) throw new ConflictException("新委托提交须持有原业务事务");
      await this.current(row, source.tenantId, tx);
    }
  }
  async consumeDelegatedApproval(source: EnterpriseOrderDelegationSource, tx: Prisma.TransactionClient, orderId: string) {
    if (!source.approval) return;
    await this.checkDelegatedApproval(source, tx);
    const count = await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='consumed',orderId=${orderId},revision=revision+1
      WHERE tenantId=${source.tenantId} AND id=${source.approval.id} AND state='executing' AND executionKey=${source.delegationKey}`;
    if (count !== 1) throw this.commands.conflict();
  }
  async revokeDelegatedApproval(source: EnterpriseOrderDelegationSource, tx: Prisma.TransactionClient) {
    if (!source.approval) return;
    const count = await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='closed',revision=revision+1
      WHERE tenantId=${source.tenantId} AND id=${source.approval.id} AND workspaceId=${source.workspaceId} AND applicantCustomerId=${source.personalCustomerId}
        AND state='executing' AND executionKey=${source.delegationKey} AND orderId IS NULL`;
    if (count !== 1) throw this.commands.conflict();
  }
  async request(context: ClientRequestContext, input: RequestEnterpriseBookingApproval) {
    if (!input.purpose?.trim() || input.purpose.length > 500 || input.expectedRevision !== 0) throw new ConflictException("审批申请用途或初始修订无效");
    const quote = await this.facts.findQuote(context.tenantId, input.quoteId);
    if (!quote || quote.request.customerId !== context.customerId || !quote.membershipSnapshot?.enterpriseBasis || !quote.membershipSnapshot.enterpriseContractAndPayer || quote.membershipSnapshot.enterpriseBasis.approvalMode !== "per_order") throw new ForbiddenException("只能申请本人真实企业付费逐单报价");
    const prepared = await this.clientApi.prepareOrderSubmission(context, { quoteId: input.quoteId });
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "approval.request", input.quoteId, input, async tx => {
      const current = await this.facts.findQuote(context.tenantId, input.quoteId, tx);
      if (!current || current.consumedAt || current.consumedOrderId || new Date(current.expiresAt) <= new Date()) throw new ConflictException("原报价不可用");
      this.orders.assertOrderMatchesQuote(prepared.request, current);
      const basis = await this.policies.authorize(context.tenantId, context.workspaceId, context.customerId, current.request.bookingIdentity!, tx);
      this.policies.assertSameBasis(quote.membershipSnapshot!.enterpriseBasis, basis);
      await this.policies.assertQuoteAmount(context.tenantId, current.membershipSnapshot!.corporateCustomerId!, current.membershipSnapshot!.corporateMembershipId!, current, tx);
      const rows = await tx.$queryRaw<Array<{ policy: string | { approvalLifetimeMinutes?: number } }>>`SELECT policy FROM enterprise_scope_policies WHERE tenantId=${context.tenantId} AND corporateCustomerId=${current.membershipSnapshot!.corporateCustomerId} AND scopeKey IN ('merchant','company',${`member:${current.membershipSnapshot!.corporateMembershipId}`})`;
      const lifetimes = rows.map(row => enterpriseJson(row.policy).approvalLifetimeMinutes).filter((value): value is number => Number.isInteger(value) && Number(value) > 0);
      if (!lifetimes.length) throw new ConflictException("审批窗口尚未配置");
      const expiresAt = new Date(Math.min(new Date(current.expiresAt).getTime(), Date.now() + Math.min(...lifetimes) * 60000));
      const unresolved = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_booking_approvals WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND workspaceId=${context.workspaceId} AND state='executing' LIMIT 1 FOR UPDATE`;
      if (unresolved.length) throw new ConflictException("当前空间存在本人未决企业执行，先按原引用核对或受控结束，不能换报价或企业重做");
      const existing = await tx.$queryRaw<Approval[]>`SELECT * FROM enterprise_booking_approvals WHERE tenantId=${context.tenantId} AND quoteId=${input.quoteId}`;
      if (existing.length) throw new ConflictException("该报价已有申请，请读取原申请；不能用新键替换");
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO enterprise_booking_approvals (tenantId,id,corporateCustomerId,applicantCustomerId,workspaceId,quoteId,requestFingerprint,request,quote,basis,amount,currency,purpose,expiresAt) VALUES (${context.tenantId},${id},${current.membershipSnapshot!.corporateCustomerId},${context.customerId},${context.workspaceId},${input.quoteId},${prepared.requestHash},${JSON.stringify(prepared.request)},${JSON.stringify(current)},${JSON.stringify(basis)},${current.payableAmount},${current.currency},${input.purpose.trim()},${expiresAt})`;
      return { id, state: "pending", revision: 1, expiresAt: expiresAt.toISOString(), execution: "not_submitted", inventory: "not_reserved" };
    }, tx => this.commands.customer(context, tx));
  }
  async list(context: ClientRequestContext, corporateId?: string) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    const before = corporateId ? await this.access.requireAction(context, corporateId, "approvals:review") : undefined;
    // Current workspace is a trusted session scope, never a caller-provided URL override.
    const rows = corporateId
      ? await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_booking_approvals WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND workspaceId=${context.workspaceId} ORDER BY expiresAt DESC LIMIT 201`
      : await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_booking_approvals WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND workspaceId=${context.workspaceId} ORDER BY expiresAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("审批记录超出当前有界读取范围");
    if (corporateId) { const after = await this.access.requireAction(context, corporateId, "approvals:review"); if (before!.permissionRevision !== after.permissionRevision) throw new ForbiddenException("审批权限已变化"); }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    return rows.map(row => this.view(row));
  }
  async decide(context: ClientRequestContext, id: string, input: DecideEnterpriseBookingApproval) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "approval.decision", id, input, async tx => {
      const row = (await this.row(context.tenantId, id, tx))[0];
      if (!row || row.workspaceId !== context.workspaceId) throw new NotFoundException("当前空间审批不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["pending", "approved"].includes(row.state)) throw new ConflictException("审批已处理或执行中");
      if (input.decision === "withdraw") {
        if (row.applicantCustomerId !== context.customerId) throw new ForbiddenException("只能撤回本人申请");
      } else {
        const reviewer = await this.access.requireAction(context, row.corporateCustomerId, "approvals:review", tx);
        if (row.applicantCustomerId === context.customerId) throw new ForbiddenException("申请人和实际使用人不得自审");
        if (row.state !== "pending") throw new ConflictException("批准已作出，请核对原结果");
        if (input.decision === "approve") {
          await this.current(row, context.tenantId, tx);
          const member = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: reviewer.membershipId }, select: { updatedAt: true } });
          if (!member) throw new ForbiddenException("审批人关系不可用");
          await tx.$executeRaw`UPDATE enterprise_booking_approvals SET approvedBy=${context.customerId},reviewerMembershipId=${reviewer.membershipId},reviewerMembershipUpdatedAt=${member.updatedAt} WHERE tenantId=${context.tenantId} AND id=${id}`;
        }
      }
      const state = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "withdrawn";
      await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state=${state},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state, revision: row.revision + 1, execution: "not_submitted" };
    }, tx => this.commands.customer(context, tx));
  }
  async orderOriginal(context: ClientRequestContext, quoteId: string, key: string) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const result = await this.clientApi.readEnterpriseOrderOriginal(context, quoteId, key);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return result;
  }
  async result(context: ClientRequestContext, id: string): Promise<EnterpriseApprovalOriginalResult> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = (await this.row(context.tenantId, id))[0];
    if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId) throw new NotFoundException("本人审批原结果不存在");
    const original = row.executionKey && row.state !== "closed"
      ? await this.clientApi.readOrderSubmission(context, { tenantId: context.tenantId, workspaceId: row.workspaceId, customerId: row.applicantCustomerId, request: enterpriseJson(row.request) }, row.executionKey, row.state === "consumed" ? row.orderId ?? undefined : undefined)
      : undefined;
    const latest = (await this.row(context.tenantId, id))[0];
    // A slow original-order read must not publish revoked identity or stale execution linkage.
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    if (!latest || latest.applicantCustomerId !== context.customerId || latest.workspaceId !== context.workspaceId
      || latest.executionKey !== row.executionKey || latest.quoteId !== row.quoteId || latest.requestFingerprint !== row.requestFingerprint) throw new NotFoundException("本人审批原结果关联已变化");
    if (original?.state === "observed" && (latest.state !== "consumed" || latest.orderId !== original.orderId)) throw new ConflictException("原订单与批准关联待核对");
    return { approval: this.view(latest), original: original ? { state: original.state, orderId: original.orderId, retryable: false } : { state: latest.state === "closed" ? "closed" : "not_submitted", retryable: false }, retryable: false };
  }
  async closeExecution(context: ClientRequestContext, id: string, input: CloseEnterpriseApprovalExecution) {
    if (input.confirm !== true) throw new ForbiddenException("须本人明确结束原执行；不是取消已成立订单");
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "approval.close", id, input, async tx => {
      // All enterprise Core creation transactions take Tenant before approval.prepare
      // and hold this approval row until commit. Closing is a fence, not a timeout inference.
      const row = (await this.row(context.tenantId, id, tx))[0];
      if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId) throw new NotFoundException("本人原批准执行不存在");
      if (row.state === "consumed") return { id, state: "consumed", orderId: row.orderId, retryable: false };
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "executing" || !row.executionKey || row.orderId) throw new ConflictException("原执行不可结束，请读取原结果");
      await this.orders.assertApprovedExecutionCanClose(context.tenantId, enterpriseJson(row.request), row.executionKey, tx);
      const changed = await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='closed',revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${id} AND state='executing' AND executionKey=${row.executionKey}`;
      if (changed !== 1) throw this.commands.conflict();
      const receiptChanged = await tx.$executeRaw`UPDATE enterprise_portal_operations SET result=${JSON.stringify({ approvalId: row.id, state: "closed", retryable: false })} WHERE tenantId=${context.tenantId} AND operationKey=${row.executionKey} AND actorUserId=${`customer:${context.customerId}`} AND target=${`approval.submit:${row.id}`}`;
      if (receiptChanged !== 1) throw new ConflictException("原执行收据关联缺失，不能发布结束结果");
      return { id, state: "closed", revision: row.revision + 1, retryable: false };
    }, tx => this.commands.customer(context, tx, false));
    // A racing committed Core result is never converted into cancellation.
    return this.result(context, id);
  }
  async submit(context: ClientRequestContext, input: SubmitEnterpriseApprovedBooking) {
    if (input.confirm !== true) throw new ForbiddenException("须申请员工核对原请求后明确提交");
    let first = false;
    const started = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "approval.submit", input.approvalId, input, async tx => {
      const row = (await this.row(context.tenantId, input.approvalId, tx))[0];
      if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId) throw new NotFoundException("本人审批不存在");
      if (await readQuoteEnterpriseDelegation(tx, context.tenantId, row.quoteId)) throw new ConflictException("原批准已绑定商户委托源，请按原D/K核对或撤销");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "approved" || row.executionKey) throw new ConflictException("批准不可消费，请核对原结果");
      await this.current(row, context.tenantId, tx);
      await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='executing',executionKey=${input.operationKey},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${row.id}`;
      first = true;
      return { approvalId: row.id, state: "executing", executionKey: input.operationKey, retryable: false };
    }, tx => this.commands.customer(context, tx));
    if (!first) return this.result(context, input.approvalId);
    const row = (await this.row(context.tenantId, started.approvalId))[0];
    const request = enterpriseJson(row.request), key = started.executionKey;
    const participant: ApprovedOrderTransaction = {
      authorize: async binding => {
        await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient);
        if (binding.tenantId !== context.tenantId || binding.workspaceId !== context.workspaceId || requireRequestWorkspaceId() !== context.workspaceId || binding.idempotencyKey !== key || binding.requestFingerprint !== row.requestFingerprint || binding.request.customerId !== context.customerId) throw new ForbiddenException("原批准执行绑定不一致");
        const latest = (await this.row(context.tenantId, row.id))[0];
        if (!latest || !["executing", "consumed"].includes(latest.state) || latest.executionKey !== key) throw new ConflictException("原批准执行不可用");
      },
      recover: async () => {
        const latest = (await this.row(context.tenantId, row.id))[0];
        return latest.state === "consumed" ? latest.orderId : null;
      },
      prepare: async (tx, binding) => {
        const latest = (await this.row(context.tenantId, row.id, tx))[0];
        this.binding(latest, binding, key);
        if (latest.state !== "executing") throw new ConflictException("原批准已执行");
        await this.commands.customer(context, tx); await this.current(latest, context.tenantId, tx);
      },
      commit: async (tx, binding, orderId) => {
        const latest = (await this.row(context.tenantId, row.id, tx))[0]; this.binding(latest, binding, key);
        const count = await tx.$executeRaw`UPDATE enterprise_booking_approvals SET state='consumed',orderId=${orderId},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${row.id} AND state='executing' AND executionKey=${key}`;
        if (count !== 1) throw new ConflictException("批准消费竞争，请核对原结果");
        const receiptCount = await tx.$executeRaw`UPDATE enterprise_portal_operations SET result=${JSON.stringify({ approvalId: row.id, state: "consumed", orderId, retryable: false })} WHERE tenantId=${context.tenantId} AND operationKey=${key} AND actorUserId=${`customer:${context.customerId}`} AND target=${`approval.submit:${row.id}`}`;
        // The Core transaction must also commit the original applicant receipt.
        // A missing or replaced receipt rolls the order and approval back together.
        if (receiptCount !== 1) throw new ConflictException("原提交收据关联缺失，批准与订单不可提交");
      },
      replay: async (binding, orderId) => { const latest = (await this.row(context.tenantId, row.id))[0]; this.binding(latest, binding, key); if (latest.state !== "consumed" || latest.orderId !== orderId) throw new ConflictException("原订单与批准关联待核对"); }
    };
    // Failure after durable execution binding stays executing. Neither timeout nor
    // lack of an observed order is proof that another dispatch would be safe.
    return this.clientApi.executeApprovedSubmission(context, { tenantId: context.tenantId, workspaceId: row.workspaceId, customerId: row.applicantCustomerId, request }, key, participant);
  }
  private binding(row: Approval, binding: Readonly<ApprovedOrderBinding>, key: string) {
    if (!row || row.workspaceId !== binding.workspaceId || row.executionKey !== key || row.requestFingerprint !== binding.requestFingerprint || row.quoteId !== binding.request.quoteId || row.applicantCustomerId !== binding.request.customerId) throw new ForbiddenException("批准与原业务指纹不匹配");
  }
}
