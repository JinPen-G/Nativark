/** Extension approval authorizes one original Core preview. The applicant's explicit
 * submission consumes it in the extension transaction; payment/effectiveness stay in Core. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CloseEnterpriseExtensionExecution, ClientOrderExtensionRequest, DecideEnterpriseExtensionApproval, EnterpriseBookingBasis, EnterpriseExtensionApprovalView, EnterpriseExtensionOriginalResult, RentalOrder, RequestEnterpriseExtensionApproval, SubmitEnterpriseExtensionApproval } from "@rental-os/shared";
import { requireRequestWorkspaceId } from "../../common/request-identity";
import { ClientApiService } from "../client/client-api.service";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { requestFingerprint, RentalIdempotencyRepository } from "../rental-core/rental-idempotency.repository";
import type { EnterpriseExtensionPrice } from "../rental-core/approved-extension.ports";
import { EnterpriseCommandService, enterpriseHash, enterpriseJson } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";

type Approval = {
  id: string; corporateCustomerId: string; applicantCustomerId: string; workspaceId: string; orderId: string; expectedOrderUpdatedAt: string;
  requestFingerprint: string; previewFingerprint: string; request: ClientOrderExtensionRequest | string; preview: EnterpriseExtensionPrice | string;
  basis: EnterpriseBookingBasis | string; state: EnterpriseExtensionApprovalView["state"]; revision: number; reason: string; expiresAt: Date;
  approvedBy: string | null; reviewerMembershipId: string | null; reviewerMembershipUpdatedAt: Date | null; extensionId: string | null; executionKey: string | null; closedOperationKey: string | null;
};
@Injectable()
export class EnterpriseExtensionApprovalService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly policies: EnterprisePolicyService,
    private readonly access: EnterpriseAccessService, private readonly core: RentalCoreService, private readonly clientApi: ClientApiService, private readonly idempotency: RentalIdempotencyRepository) {}
  private row(tenantId: string, id: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).$queryRaw<Approval[]>(Prisma.sql`SELECT * FROM enterprise_extension_approvals WHERE tenantId=${tenantId} AND id=${id} ${tx ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  }
  private async lockedRow(context: ClientRequestContext, id: string, tx: Prisma.TransactionClient) {
    const original = (await this.row(context.tenantId, id))[0];
    if (!original || original.workspaceId !== context.workspaceId) throw new NotFoundException("当前空间续租批准不存在");
    // Payment uses order -> approval; decisions/submission use that same order.
    await this.core.lockOrderForUpdate(context.tenantId, original.orderId, tx);
    const latest = (await this.row(context.tenantId, id, tx))[0];
    if (!latest || latest.orderId !== original.orderId || latest.workspaceId !== context.workspaceId) throw new ConflictException("原续租关联已变化");
    return latest;
  }
  private view(row: Approval): EnterpriseExtensionApprovalView {
    const p = enterpriseJson(row.preview);
    return { id: row.id, corporateCustomerId: row.corporateCustomerId, applicantCustomerId: row.applicantCustomerId, workspaceId: row.workspaceId,
      orderId: row.orderId, expectedOrderUpdatedAt: row.expectedOrderUpdatedAt, state: ["pending", "approved"].includes(row.state) && row.expiresAt <= new Date() ? "expired" : row.state,
      revision: row.revision, expiresAt: row.expiresAt.toISOString(), reason: row.reason, extensionId: row.extensionId ?? undefined, closedOperationKey: row.closedOperationKey ?? undefined,
      preview: { originalEndAt: p.originalEndAt, newEndAt: p.newEndAt, rentalAmount: p.rentalAmount, serviceAmount: p.serviceAmount, depositDelta: p.depositDelta,
        preAuthDelta: p.preAuthDelta, payableAmount: p.payableAmount, currency: p.currency, settlementMode: p.settlementMode, paymentRequired: p.paymentRequired,
        chargeLines: p.chargeLines.map(line => ({ code: line.code, name: line.name, type: line.type, amount: line.amount })) } };
  }
  private owns(context: ClientRequestContext, row: Approval) {
    if (!row || row.applicantCustomerId !== context.customerId || row.workspaceId !== context.workspaceId || requireRequestWorkspaceId() !== context.workspaceId)
      throw new NotFoundException("本人当前空间续租批准不存在");
  }
  private async current(row: Approval, tenantId: string, tx: Prisma.TransactionClient): Promise<RentalOrder> {
    if (row.expiresAt <= new Date()) throw new ConflictException("续租批准已到期，须重新试算与审批");
    const order = await this.core.lockOrderForUpdate(tenantId, row.orderId, tx);
    if (row.requestFingerprint !== requestFingerprint({ orderId: row.orderId, extension: enterpriseJson(row.request), expectedOrderUpdatedAt: row.expectedOrderUpdatedAt })
      || row.previewFingerprint !== requestFingerprint(enterpriseJson(row.preview))) throw new ConflictException("原续租请求或试算指纹不一致");
    if (order.updatedAt !== row.expectedOrderUpdatedAt || order.membershipSnapshot?.personalCustomerId !== row.applicantCustomerId
      || order.membershipSnapshot.corporateCustomerId !== row.corporateCustomerId) throw new ConflictException("原订单修订或主体已变化，须重新试算与审批");
    const basis = await this.policies.revalidateOrderExpense(tenantId, row.workspaceId, order, tx);
    this.policies.assertSameBasis(enterpriseJson(row.basis), basis);
    await this.policies.assertQuoteAmount(tenantId, row.corporateCustomerId, order.membershipSnapshot.corporateMembershipId!, enterpriseJson(row.preview), tx);
    await this.clientApi.assertEnterpriseExtensionPrice(tenantId, order, enterpriseJson(row.request), enterpriseJson(row.preview), tx);
    if (row.approvedBy) await this.policies.assertReviewer(tenantId, row.corporateCustomerId, row.applicantCustomerId, row.approvedBy, row.reviewerMembershipId, row.reviewerMembershipUpdatedAt, tx);
    return order;
  }
  async eligibility(context: ClientRequestContext, orderId: string) {
    return this.prisma.$transaction(async tx => {
      await this.commands.customer(context, tx);
      const order = await this.core.lockOrderForUpdate(context.tenantId, orderId, tx), snapshot = order.membershipSnapshot;
      if (order.tenantId !== context.tenantId || order.customerId !== context.customerId && snapshot?.personalCustomerId !== context.customerId) throw new NotFoundException("本人订单不存在");
      const basis = snapshot?.enterpriseContractAndPayer ? await this.policies.revalidateOrderExpense(context.tenantId, context.workspaceId, order, tx) : undefined;
      return { orderId: order.id, expectedOrderUpdatedAt: order.updatedAt, approvalRequired: basis?.approvalMode === "per_order", corporateCustomerId: basis ? snapshot?.corporateCustomerId : undefined };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  async request(context: ClientRequestContext, input: RequestEnterpriseExtensionApproval) {
    if (input.expectedRevision !== 0 || !Number.isFinite(Date.parse(input.expectedOrderUpdatedAt)) || !input.extension || !Number.isFinite(Date.parse(input.extension.newEndAt))) throw new BadRequestException("原订单修订、续租意图或初始修订无效");
    // Canonical original intent; undefined DTO fields and client-private extras never enter storage.
    const extension: ClientOrderExtensionRequest = { newEndAt: new Date(input.extension.newEndAt).toISOString(), ...(input.extension.services ? { services: input.extension.services.map(s => ({ serviceId: s.serviceId, quantity: s.quantity,
      ...(s.scheduledStartAt ? { scheduledStartAt: s.scheduledStartAt } : {}), ...(s.scheduledEndAt ? { scheduledEndAt: s.scheduledEndAt } : {}), ...(s.serviceLocationId ? { serviceLocationId: s.serviceLocationId } : {}) })) } : {}), ...(input.extension.memo ? { memo: input.extension.memo } : {}) };
    input = { ...input, extension };
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "extension.request", input.orderId, input, async tx => {
      const prepared = await this.clientApi.prepareEnterpriseExtension(context, input.orderId, extension, tx);
      const order = prepared.order;
      if (order.updatedAt !== input.expectedOrderUpdatedAt || order.membershipSnapshot?.personalCustomerId !== context.customerId
        || !order.membershipSnapshot.enterpriseContractAndPayer) throw new ConflictException("本人原企业订单或修订已变化，须重新核对");
      const basis = await this.policies.revalidateOrderExpense(context.tenantId, context.workspaceId, order, tx);
      if (!basis || basis.approvalMode !== "per_order") throw new ForbiddenException("仅已配置逐单企业付费的本人订单可申请变更批准");
      await this.policies.assertQuoteAmount(context.tenantId, order.membershipSnapshot.corporateCustomerId!, order.membershipSnapshot.corporateMembershipId!, prepared.priced, tx);
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_extension_approvals WHERE tenantId=${context.tenantId} AND workspaceId=${context.workspaceId} AND orderId=${order.id} AND state IN ('pending','approved') AND expiresAt>NOW(3) FOR UPDATE`;
      if (active.length) throw new ConflictException("原订单已有待处理续租批准，请读取或撤回原申请");
      const minutes = await this.policies.approvalLifetime(context.tenantId, order.membershipSnapshot.corporateCustomerId!, order.membershipSnapshot.corporateMembershipId!, tx);
      const expiresAt = new Date(Date.now() + minutes * 60000), id = randomUUID();
      const fingerprint = requestFingerprint({ orderId: order.id, extension, expectedOrderUpdatedAt: order.updatedAt });
      await tx.$executeRaw`INSERT INTO enterprise_extension_approvals (tenantId,id,corporateCustomerId,applicantCustomerId,workspaceId,orderId,expectedOrderUpdatedAt,requestFingerprint,previewFingerprint,request,preview,basis,reason,expiresAt) VALUES (${context.tenantId},${id},${order.membershipSnapshot.corporateCustomerId},${context.customerId},${context.workspaceId},${order.id},${order.updatedAt},${fingerprint},${requestFingerprint(prepared.priced)},${JSON.stringify(extension)},${JSON.stringify(prepared.priced)},${JSON.stringify(basis)},${input.reason.trim()},${expiresAt})`;
      return { id, state: "pending", revision: 1, expiresAt: expiresAt.toISOString() };
    }, tx => this.commands.customer(context, tx), "shared", tx => this.core.lockOrderForUpdate(context.tenantId, input.orderId, tx));
  }
  async list(context: ClientRequestContext, corporateId?: string) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    const before = corporateId ? await this.access.requireAction(context, corporateId, "approvals:review") : undefined;
    const rows = corporateId
      ? await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_extension_approvals WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND workspaceId=${context.workspaceId} ORDER BY expiresAt DESC LIMIT 201`
      : await this.prisma.$queryRaw<Approval[]>`SELECT * FROM enterprise_extension_approvals WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND workspaceId=${context.workspaceId} ORDER BY expiresAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("续租批准超过当前有界读取范围");
    if (corporateId) { const after = await this.access.requireAction(context, corporateId, "approvals:review"); if (before!.permissionRevision !== after.permissionRevision) throw new ForbiddenException("企业审批权限已变化"); }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, Boolean(corporateId));
    return rows.map(row => this.view(row));
  }
  async decide(context: ClientRequestContext, id: string, input: DecideEnterpriseExtensionApproval) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "extension.decision", id, input, async tx => {
      const row = await this.lockedRow(context, id, tx);
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["pending", "approved"].includes(row.state)) throw new ConflictException("续租批准已处理");
      if (input.decision === "withdraw") this.owns(context, row);
      else {
        if (row.applicantCustomerId === context.customerId) throw new ForbiddenException("申请人和使用人不得自审");
        const reviewer = await this.access.requireAction(context, row.corporateCustomerId, "approvals:review", tx);
        if (row.state !== "pending") throw new ConflictException("原批准已作出");
        if (input.decision === "approve") {
          await this.current(row, context.tenantId, tx);
          const member = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: reviewer.membershipId }, select: { updatedAt: true } });
          if (!member) throw new ForbiddenException("当前审批人关系不可用");
          await tx.$executeRaw`UPDATE enterprise_extension_approvals SET approvedBy=${context.customerId},reviewerMembershipId=${reviewer.membershipId},reviewerMembershipUpdatedAt=${member.updatedAt} WHERE tenantId=${context.tenantId} AND id=${id}`;
        }
      }
      const state = input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "withdrawn";
      await tx.$executeRaw`UPDATE enterprise_extension_approvals SET state=${state},decisionReason=${input.reason.trim()},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state, revision: row.revision + 1 };
    }, tx => this.commands.customer(context, tx), "shared", tx => this.lockedRow(context, id, tx));
  }
  async submit(context: ClientRequestContext, input: SubmitEnterpriseExtensionApproval): Promise<EnterpriseExtensionOriginalResult> {
    if (input.confirm !== true) throw new ForbiddenException("须本人核对原续租明细后明确提交");
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "extension.submit", input.approvalId, input, async tx => {
      const row = await this.lockedRow(context, input.approvalId, tx); this.owns(context, row);
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "approved" || row.extensionId || row.executionKey) throw new ConflictException("续租批准不可再次消费，请读取原结果");
      await this.commands.customer(context, tx);
      await this.current(row, context.tenantId, tx);
      const result = await this.clientApi.executeEnterpriseExtension(context, row.orderId, enterpriseJson(row.request), enterpriseJson(row.preview), {
        approvalId: row.id, expectedOrderUpdatedAt: row.expectedOrderUpdatedAt, requestFingerprint: row.requestFingerprint, previewFingerprint: row.previewFingerprint, idempotencyKey: input.operationKey,
      }, tx);
      const changed = await tx.$executeRaw`UPDATE enterprise_extension_approvals SET state='consumed',extensionId=${result.extensionId},executionKey=${input.operationKey},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${row.id} AND state='approved' AND extensionId IS NULL`;
      if (changed !== 1) throw new ConflictException("续租批准消费竞争，请核对原结果");
      return { approvalId: row.id, extensionId: result.extensionId, state: "consumed", retryable: false };
    }, tx => this.commands.customer(context, tx, false), "shared", tx => this.lockedRow(context, input.approvalId, tx));
    return this.result(context, input.approvalId);
  }
  async closeExecution(context: ClientRequestContext, id: string, input: CloseEnterpriseExtensionExecution) {
    if (input.confirm !== true || !input.originalOperationKey?.trim() || input.originalOperationKey.length > 128 || input.originalOperationKey === input.operationKey) throw new BadRequestException("须本人明确原提交键与结束请求，不是取消续租");
    await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "extension.close", id, input, async tx => {
      const row = await this.lockedRow(context, id, tx); this.owns(context, row);
      if (row.state === "consumed") {
        if (row.executionKey !== input.originalOperationKey) throw new ConflictException("原提交键与已消费续租不匹配");
        return { approvalId: id, extensionId: row.extensionId, originalOperationKey: input.originalOperationKey, state: "consumed", retryable: false };
      }
      if (row.closedOperationKey && row.closedOperationKey !== input.originalOperationKey) throw new ConflictException("原结束引用不匹配");
      if (row.state === "closed") return { approvalId: id, state: "closed", closedOperationKey: row.closedOperationKey, retryable: false };
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "approved" || row.extensionId || row.executionKey) throw new ConflictException("仅未消费的本人批准可以受控结束");
      // Submission takes order -> approval before reading its receipt, and holds
      // both until Core/receipt commit. This terminal blocks even a late POST.
      const receipt = await tx.$queryRaw<Array<{ actorUserId: string; target: string }>>`SELECT actorUserId,target FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${input.originalOperationKey}`;
      const extensions = await this.core.listOrderExtensions(context.tenantId, row.orderId, tx);
      const original = await this.idempotency.find(context.tenantId, "order.extend", input.originalOperationKey, tx);
      if (receipt.length || original || extensions.some(extension => extension.idempotencyKey === input.originalOperationKey)) throw new ConflictException("原提交存在收据或消费证据，须核对原结果，不得结束重做");
      // Persist the seal under the original business key as well. A late request
      // with that key hits the incompatible original receipt before any Core work.
      const sealed = { approvalId: id, state: "closed", closedOperationKey: input.originalOperationKey, retryable: false };
      await tx.$executeRaw`INSERT INTO enterprise_portal_operations (tenantId,operationKey,actorUserId,requestHash,target,reason,result) VALUES (${context.tenantId},${input.originalOperationKey},${`customer:${context.customerId}`},${enterpriseHash({ action: "extension.sealed", target: id, originalOperationKey: input.originalOperationKey })},${`extension.sealed:${id}`},${input.reason.trim()},${JSON.stringify(sealed)})`;
      const changed = await tx.$executeRaw`UPDATE enterprise_extension_approvals SET state='closed',closedOperationKey=${input.originalOperationKey},revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${id} AND state='approved' AND extensionId IS NULL AND executionKey IS NULL`;
      if (changed !== 1) throw this.commands.conflict();
      return { approvalId: id, state: "closed", closedOperationKey: input.originalOperationKey, retryable: false };
    }, tx => this.commands.customer(context, tx, false), "shared", tx => this.lockedRow(context, id, tx));
    return this.result(context, id);
  }
  async result(context: ClientRequestContext, id: string): Promise<EnterpriseExtensionOriginalResult> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = (await this.row(context.tenantId, id))[0]; this.owns(context, row);
    const extension = row.extensionId ? (await this.clientApi.listExtensions(context, row.orderId)).find(item => item.id === row.extensionId) : undefined;
    const latest = (await this.row(context.tenantId, id))[0]; this.owns(context, latest);
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    if (row.extensionId !== latest.extensionId || row.executionKey !== latest.executionKey || row.closedOperationKey !== latest.closedOperationKey || row.requestFingerprint !== latest.requestFingerprint || row.previewFingerprint !== latest.previewFingerprint) throw new ConflictException("原续租关联已变化，请重新核对");
    if (latest.state === "consumed") {
      if (!extension || extension.tenantId !== context.tenantId || extension.workspaceId !== context.workspaceId || extension.orderId !== row.orderId || extension.idempotencyKey !== row.executionKey) throw new ConflictException("原续租消费关联缺失或不一致，不能重发");
      return { approval: this.view(latest), original: { state: "observed", extensionId: extension.id, extensionState: extension.status, retryable: false }, retryable: false };
    }
    if (latest.state === "closed") {
      if (!latest.closedOperationKey || latest.extensionId || latest.executionKey) throw new ConflictException("原续租结束证据缺失或不一致");
      const seals = await this.prisma.$queryRaw<Array<{ actorUserId: string; target: string; result: object | string }>>`SELECT actorUserId,target,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${latest.closedOperationKey}`;
      const seal = seals[0], payload = seal && enterpriseJson(seal.result) as { approvalId?: string; state?: string; closedOperationKey?: string } | undefined;
      if (!seal || seal.actorUserId !== `customer:${context.customerId}` || seal.target !== `extension.sealed:${id}` || payload?.approvalId !== id || payload.state !== "closed" || payload.closedOperationKey !== latest.closedOperationKey) throw new ConflictException("原续租结束收据缺失或不一致");
      await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    }
    return { approval: this.view(latest), original: { state: latest.state === "closed" ? "closed" : "not_submitted", retryable: false }, retryable: false };
  }
}
