/** Current enterprise/payment-evidence admission against original order and frozen files.
 * The management workflow records review facts. Original funding services settle money. */
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ENTERPRISE_PAYMENT_PROOF_SCENE, type EnterprisePaymentProofBasis, type SystemUserRow } from "@rental-os/shared";
import { getRequestIdentity } from "../../common/request-identity";
import type { AuthService } from "../auth/auth.service";
import type { ClientRequestContext } from "../client/client-auth.service";
import type { EnterpriseAccessService } from "../client/enterprise-access.service";
import type { PrismaService } from "../database/prisma.service";
import { EnterpriseOrderReaderService } from "./enterprise-order-reader.service";
import { EnterpriseCommandService, enterpriseHash } from "./enterprise-command.service";

export { ENTERPRISE_PAYMENT_PROOF_SCENE } from "@rental-os/shared";
export interface PaymentProofReceipt {
  corporateCustomerId: string;
  orderId: string;
  workspaceId: string;
  currency: string;
  objectRevision: string;
  evidenceFileIds: string[];
  evidenceHash: string;
  purpose: "rental_fee";
}
const reference = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export class EnterprisePaymentProofSource {
  private readonly orders: EnterpriseOrderReaderService;
  constructor(private readonly prisma: PrismaService, private readonly access: EnterpriseAccessService,
    private readonly commands: EnterpriseCommandService, private readonly auth?: AuthService) {
    this.orders = new EnterpriseOrderReaderService(prisma, access);
  }

  async customer(context: ClientRequestContext, corporateId: string, tx: Prisma.TransactionClient) {
    const identity = getRequestIdentity();
    if (context.customerType !== "personal" || !identity || identity.audience !== "client" || identity.isSaasAdmin || identity.staffApi || identity.dataScope !== undefined
      || identity.tenantId !== context.tenantId || identity.userId !== context.customerId || identity.workspaceId !== context.workspaceId
      || ![context.tenantId, context.customerId, context.sessionId, context.workspaceId, context.workspaceCode, corporateId].every(reference)) {
      throw new ForbiddenException("回款核对须原客户及当前可信经营空间");
    }
    await this.commands.customer(context, tx);
    const grant = await this.access.requireAction(context, corporateId, "requests:manage", tx);
    if (!["requests:manage", "orders:read", "finance:read"].every(action => grant.actions.includes(action as typeof grant.actions[number]))) {
      throw new ForbiddenException("回款核对须当前申请、订单和财务权限");
    }
    const sessions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id FROM client_auth_sessions s JOIN business_workspaces w ON w.id=s.workspaceId AND w.tenantId=s.tenantId AND w.status='ACTIVE'
      WHERE s.tenantId=${context.tenantId} AND s.customerId=${context.customerId} AND s.id=${context.sessionId}
        AND s.workspaceId=${context.workspaceId} AND w.code=${context.workspaceCode} AND s.revokedAt IS NULL AND s.expiresAt>NOW(3)
      ${tx === this.prisma as unknown as Prisma.TransactionClient ? Prisma.empty : Prisma.sql`FOR UPDATE`}`);
    const after = getRequestIdentity();
    if (sessions.length !== 1 || sessions[0].id !== context.sessionId || !after || after.workspaceId !== context.workspaceId || after.tenantId !== context.tenantId
      || after.userId !== context.customerId || after.audience !== "client" || after.isSaasAdmin || after.staffApi || after.dataScope !== undefined) throw new ForbiddenException("回款核对原会话或经营空间已变化");
    return enterpriseHash([grant.membershipId, grant.permissionRevision, grant.actions]);
  }

  async merchant(authorization: string | undefined, actor: SystemUserRow, workspaceId: string) {
    if (!this.auth) throw new ServiceUnavailableException("回款核对原商户认证尚未装配");
    const identity = getRequestIdentity(), current = await this.auth.resolveAccessContext(authorization, { audience: "operator" }), user = current?.user;
    if (!identity || identity.audience !== "operator" || identity.staffApi || identity.isSaasAdmin || !reference(workspaceId)
      || identity.workspaceId !== workspaceId || !current?.workspaceValid || current.workspaceId !== workspaceId || !user?.isActive
      || user.id !== actor.id || user.id !== identity.userId || user.tenantId !== actor.tenantId || user.tenantId !== identity.tenantId
      || user.dataScope !== "all" || user.locationScope?.mode !== "all") throw new ForbiddenException("回款核对须原空间完整财务授权");
    this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:finance:manage");
    return enterpriseHash([user.id, user.tenantId, current.workspaceId, user.permissions, user.dataScope, user.locationScope]);
  }

  async basis(input: ClientRequestContext, corporateId: string, orderId: string): Promise<EnterprisePaymentProofBasis> {
    const context = Object.freeze({ ...input }), db = this.prisma as unknown as Prisma.TransactionClient;
    const before = await this.customer(context, corporateId, db);
    const order = await this.prisma.$transaction(tx => this.orders.financialRequestOrder(context.tenantId, corporateId, context.workspaceId!, orderId, tx),
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (await this.customer(context, corporateId, db) !== before) throw new ForbiddenException("回款核对读取期间权限已变化");
    const grant = await this.access.requireAction(context, corporateId, "requests:manage");
    if (enterpriseHash([grant.membershipId, grant.permissionRevision, grant.actions]) !== before) throw new ForbiddenException("回款核对读取期间关系已变化");
    return { ...order, corporateCustomerId: corporateId, workspaceCode: context.workspaceCode!, permissionRevision: grant.permissionRevision, source: "original_enterprise_paid_order", purpose: "rental_fee" };
  }

  private receipt(value: PaymentProofReceipt) {
    if (!value || ![value.corporateCustomerId, value.orderId, value.workspaceId].every(reference) || !timestamp(value.objectRevision)
      || typeof value.currency !== "string" || !/^[A-Z]{3}$/u.test(value.currency) || !Array.isArray(value.evidenceFileIds)
      || value.evidenceFileIds.length > 10 || new Set(value.evidenceFileIds).size !== value.evidenceFileIds.length || !value.evidenceFileIds.every(reference)
      || !/^[a-f0-9]{64}$/u.test(value.evidenceHash) || value.purpose !== "rental_fee") throw new ConflictException("原费用回款申请缺少订单与凭证绑定");
  }

  async files(tenantId: string, applicant: string, source: Pick<PaymentProofReceipt, "corporateCustomerId" | "orderId" | "workspaceId" | "objectRevision">,
    ids: string[], tx: Prisma.TransactionClient) {
    if (ids.length && tx !== this.prisma as unknown as Prisma.TransactionClient) {
      await tx.$queryRaw(Prisma.sql`SELECT f.id FROM FileAsset f JOIN file_upload_sessions s ON s.tenantId=f.tenantId AND s.fileAssetId=f.id
        WHERE f.tenantId=${tenantId} AND f.id IN (${Prisma.join(ids)}) ORDER BY f.id FOR UPDATE`);
    }
    const rows = await tx.fileAsset.findMany({ where: { tenantId, id: { in: ids }, businessModule: "enterprise", businessType: "rental_order", businessId: source.orderId,
      uploadedBy: applicant, uploadScene: ENTERPRISE_PAYMENT_PROOF_SCENE, status: "active", storageProvider: { not: "local_mock" } }, include: { uploadSession: true } });
    if (rows.length !== ids.length) throw new ForbiddenException("回款凭证未归档或不属于原订单与申请人");
    const files = ids.map(id => {
      const row = rows.find(row => row.id === id), metadata = row?.metadata as Record<string, unknown> | null;
      const basis = metadata?.enterprisePaymentProof as Record<string, unknown> | undefined;
      if (!row || row.tenantId !== tenantId || row.businessId !== source.orderId || row.uploadedBy !== applicant
        || metadata?.workspaceId !== source.workspaceId || basis?.corporateCustomerId !== source.corporateCustomerId || basis?.orderId !== source.orderId
        || basis?.objectRevision !== source.objectRevision || basis?.purpose !== "rental_fee" || metadata?.fileUploadVersion !== 2 || metadata.fileContentVersion !== 1
        || typeof row.checksum !== "string" || !/^[a-f0-9]{64}$/u.test(row.checksum) || metadata.contentHash !== row.checksum
        || !row.uploadSession || row.uploadSession.status !== "completed" || !row.uploadSession.completedAt
        || row.uploadSession.provider !== row.storageProvider || row.uploadSession.storageKey !== row.storageKey
        || !["application/pdf", "image/png", "image/jpeg"].includes(row.mimeType) || row.sizeBytes < 1 || row.sizeBytes > 20 * 1024 * 1024) {
        throw new ConflictException("原回款凭证冻结内容或字节关联不可核对");
      }
      return { id: row.id, contentHash: row.checksum, sizeBytes: row.sizeBytes, mimeType: row.mimeType,
        bindingHash: enterpriseHash([row.tenantId, row.businessId, row.uploadedBy, row.storageProvider, row.storageKey, row.updatedAt,
          row.uploadSession.id, row.uploadSession.completedAt, metadata]) };
    });
    return { files, evidenceHash: enterpriseHash(files) };
  }

  async prepare(tenantId: string, applicant: string, input: Omit<PaymentProofReceipt, "evidenceHash">, tx: Prisma.TransactionClient): Promise<PaymentProofReceipt> {
    const order = await this.orders.financialRequestOrder(tenantId, input.corporateCustomerId, input.workspaceId, input.orderId, tx);
    if (order.objectRevision !== input.objectRevision || order.currency !== input.currency) throw this.commands.conflict();
    const evidence = await this.files(tenantId, applicant, input, input.evidenceFileIds, tx);
    return { ...input, evidenceFileIds: [...input.evidenceFileIds], evidenceHash: evidence.evidenceHash };
  }

  async verify(tenantId: string, applicant: string, receipt: PaymentProofReceipt, tx: Prisma.TransactionClient) {
    this.receipt(receipt);
    const order = await this.orders.financialRequestOrder(tenantId, receipt.corporateCustomerId, receipt.workspaceId, receipt.orderId, tx);
    if (order.objectRevision !== receipt.objectRevision || order.currency !== receipt.currency) throw this.commands.conflict();
    const evidence = await this.files(tenantId, applicant, receipt, receipt.evidenceFileIds, tx);
    if (evidence.evidenceHash !== receipt.evidenceHash) throw new ConflictException("原回款申请的凭证绑定已变化");
    return evidence;
  }
}
