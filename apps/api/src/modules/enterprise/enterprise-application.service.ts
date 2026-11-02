/** Applicant drafts are private; merchant review atomically binds a verified first admin.
 * Does not grant credit, category access, payment authority or automatic claim rights. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { EnterpriseApplicationInput, EnterpriseChangeRequest, EnterpriseWorkflowView, ReviewEnterpriseApplicationRequest, SaveEnterpriseApplicationRequest, SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
type StoredApplication = EnterpriseApplicationInput & { agreementAcknowledgedAt?: string };
type RequestRow = { id: string; kind: EnterpriseWorkflowView["kind"]; state: EnterpriseWorkflowView["state"]; revision: number; applicantCustomerId: string; corporateCustomerId: string | null; payload: StoredApplication | string; decisionReason: string | null; createdAt: Date; updatedAt: Date };
@Injectable()
export class EnterpriseApplicationService {
  constructor(private readonly prisma: PrismaService, private readonly customers: SharedCustomerRepository, private readonly commands: EnterpriseCommandService) {}
  private view(row: RequestRow): EnterpriseWorkflowView {
    return { id: row.id, kind: row.kind, state: row.state, revision: row.revision, applicantCustomerId: row.applicantCustomerId,
      corporateCustomerId: row.corporateCustomerId ?? undefined, payload: enterpriseJson(row.payload) as unknown as Record<string, unknown>, decisionReason: row.decisionReason ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  private validate(input: EnterpriseApplicationInput) {
    if (!input || [input.legalName,input.region,input.legalIdentifier,input.contactName,input.contactPhone,input.authorityStatement,input.agreementVersion].some(v => typeof v !== "string" || !v.trim())
      || input.legalName.length > 191 || input.region.length > 80 || input.legalIdentifier.length > 191 || input.authorityStatement.length > 2000
      || input.contactPhone.length > 32 || input.contactName.length > 120 || !Array.isArray(input.evidenceFileIds) || input.evidenceFileIds.length > 10) throw new BadRequestException("企业资料及授权证明无效");
    // Existing corporate identity stores a transcribed CN identifier; do not guess foreign mappings.
    if (input.region !== "CN" && !input.existingCorporateCustomerId) throw new BadRequestException("该地区主档映射尚未配置，请联系商户核验建档后申请认领");
    if (input.region === "CN" && !/^[0-9A-HJ-NPQRTUWXY]{18}$/u.test(input.legalIdentifier.trim().toUpperCase())) throw new BadRequestException("主体标识与所选地区不匹配");
  }
  private async evidence(tx: Prisma.TransactionClient, tenantId: string, applicant: string, ids: string[]) {
    if (!ids.length || new Set(ids).size !== ids.length) throw new BadRequestException("提交前须提供受控授权证明附件");
    const files = await tx.fileAsset.findMany({ where: { tenantId, id: { in: ids }, businessType: "customer", businessId: applicant, uploadScene: "enterprise-authority", uploadedBy: applicant, status: "active", storageProvider: { not: "local_mock" } }, select: { id: true } });
    if (files.length !== ids.length) throw new ForbiddenException("授权材料尚未归档或不属于申请人");
  }
  private subject(data: EnterpriseApplicationInput) {
    return `${data.region.trim().toUpperCase()}:${data.legalIdentifier.trim().toUpperCase()}`;
  }
  private sameApplication(left: EnterpriseApplicationInput, right: EnterpriseApplicationInput) {
    return ["legalName","region","legalIdentifier","contactName","contactPhone","email","authorityStatement","agreementVersion","agreementAcknowledged","existingCorporateCustomerId"].every(key => left[key as keyof EnterpriseApplicationInput] === right[key as keyof EnterpriseApplicationInput])
      && JSON.stringify(left.evidenceFileIds) === JSON.stringify(right.evidenceFileIds);
  }
  async save(context: ClientRequestContext, input: SaveEnterpriseApplicationRequest) {
    this.validate(input.application);
    if (input.submit && input.application.agreementAcknowledged !== true) throw new BadRequestException("提交前须本人明确确认商户协议");
    // A caller's timestamp is not evidence of consent; only this service stamps acceptance.
    const { agreementAcknowledgedAt: _untrustedTime, ...application } = input.application as StoredApplication;
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "application.save", "self", input, async tx => {
      let row: RequestRow | undefined;
      if (input.requestId) {
        const rows = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${input.requestId} AND applicantCustomerId=${context.customerId} AND kind='corporate_application'`;
        row = rows[0]; if (!row) throw new NotFoundException("本人申请不存在");
        if (row.revision !== input.expectedRevision) throw this.commands.conflict();
        if (!["draft","supplement_required"].includes(row.state)) throw new ConflictException("此申请不可编辑，请读取原结果");
      } else if (input.expectedRevision !== 0) throw this.commands.conflict();
      // The tenant command lock serializes subject deduplication. Different applicants
      // keep independent private applications for merchant verification, never claim each other.
      const unresolved = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind='corporate_application' AND state IN ('draft','pending','supplement_required') ORDER BY createdAt,id LIMIT 201`;
      if (unresolved.length > 200) throw new ConflictException("未决企业申请超出当前有界读取范围");
      const duplicates = unresolved.filter(candidate => candidate.id !== row?.id && this.subject(enterpriseJson(candidate.payload)) === this.subject(input.application));
      if (duplicates.length) {
        const original = duplicates[0], originalData = enterpriseJson(original.payload);
        if (!row && duplicates.length === 1 && this.sameApplication(originalData, input.application) && (!input.submit || original.state === "pending")) return { id: original.id, revision: original.revision, state: original.state };
        throw new ConflictException("该主体已有本人未决申请，请读取原申请并按修订编辑或撤回重复草稿");
      }
      if (input.submit) {
        const profile = await tx.clientChannelProfile.findUnique({ where: { tenantId: context.tenantId }, select: { userAgreementVersion: true, userAgreementBody: true, userAgreementUrl: true } });
        if (!profile?.userAgreementVersion || (!profile.userAgreementBody && !profile.userAgreementUrl) || input.application.agreementVersion !== profile.userAgreementVersion) throw new ConflictException("商户协议缺失或版本已更新，请重新核对");
        await this.evidence(tx, context.tenantId, context.customerId, input.application.evidenceFileIds);
      }
      const id = row?.id ?? randomUUID(), revision = (row?.revision ?? 0) + 1, state = input.submit ? "pending" : "draft";
      const payload = JSON.stringify({ ...application, ...(input.submit ? { agreementAcknowledgedAt: new Date().toISOString() } : {}) });
      if (row) await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state}, revision=${revision}, payload=${payload}, updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      else await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,state,revision,payload) VALUES (${context.tenantId},${id},'corporate_application',${context.customerId},${state},${revision},${payload})`;
      return { id, revision, state };
    }, tx => this.commands.customer(context, tx, false));
  }
  async mine(context: ClientRequestContext) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind='corporate_application' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人企业申请超出当前有界读取范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => this.view(row));
  }
  async withdraw(context: ClientRequestContext, id: string, input: EnterpriseChangeRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "application.withdraw", id, input, async tx => {
      const rows = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='corporate_application'`;
      const row = rows[0]; if (!row) throw new NotFoundException("本人申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["draft","pending","supplement_required"].includes(row.state)) throw new ConflictException("申请不可撤回");
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state='withdrawn', revision=revision+1, updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state: "withdrawn", revision: row.revision + 1 };
    }, tx => this.commands.customer(context, tx, false));
  }
  async merchantList(user: SystemUserRow) {
    const { tenantId } = this.commands.operator(user, "rental-os:corporate:manage");
    const rows = await this.prisma.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='corporate_application' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("商户企业申请超出当前有界读取范围");
    this.commands.operator(user, "rental-os:corporate:manage");
    return rows.map(row => this.view(row));
  }
  async review(user: SystemUserRow, id: string, input: ReviewEnterpriseApplicationRequest) {
    const { tenantId, actor } = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    try {
      return await this.commands.execute(tenantId, actor, "application.review", id, input, async tx => {
      const rows = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='corporate_application'`;
      const row = rows[0]; if (!row) throw new NotFoundException("申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("申请不在审核中");
      const data = enterpriseJson(row.payload); this.validate(data);
      let corporateCustomerId = row.corporateCustomerId;
      const state = input.decision === "approve" ? "approved" : input.decision === "supplement" ? "supplement_required" : "rejected";
      if (input.decision === "approve") {
        if (!input.verifiedRepresentative) throw new ForbiddenException("必须核验申请人的企业代表资格");
        const acceptedAt = data.agreementAcknowledgedAt ? new Date(data.agreementAcknowledgedAt) : undefined;
        if (data.agreementAcknowledged !== true || !acceptedAt || !Number.isFinite(acceptedAt.getTime()) || acceptedAt > row.updatedAt) throw new ConflictException("原申请缺少本人协议确认依据，请要求补件");
        const settings = await tx.$queryRaw<Array<{ enabled: boolean }>>`SELECT enabled FROM enterprise_portal_tenant_settings WHERE tenantId=${tenantId}`;
        if (!settings[0]?.enabled) throw new ConflictException("商户尚未显式开启企业门户");
        const profile = await tx.clientChannelProfile.findUnique({ where: { tenantId }, select: { userAgreementVersion: true } });
        if (!profile?.userAgreementVersion || profile.userAgreementVersion !== data.agreementVersion) throw new ConflictException("申请协议版本已失效，请要求补件");
        await this.evidence(tx, tenantId, row.applicantCustomerId, data.evidenceFileIds);
        const personal = await tx.customerProfile.findFirst({ where: { tenantId, id: row.applicantCustomerId, customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } }, select: { id: true } });
        if (!personal) throw new ConflictException("个人会员尚未生效，不能开通管理员");
        if (data.existingCorporateCustomerId) {
          const existing = await tx.customerProfile.findFirst({ where: { tenantId, id: data.existingCorporateCustomerId, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }, include: { corporateProfile: true } });
          if (!existing || existing.corporateName !== data.legalName || existing.corporateProfile?.unifiedSocialCreditCode !== data.legalIdentifier.trim().toUpperCase()) throw new ConflictException("存量主体资料不匹配，须商户单独核对");
          const count = await tx.customerCorporateMembership.count({ where: { tenantId, corporateCustomerId: existing.id, role: "admin", status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
          if (count) throw new ConflictException("企业已有管理员，须走邀请或独立核验恢复流程");
          corporateCustomerId = existing.id;
        } else {
          const code = data.legalIdentifier.trim().toUpperCase();
          if (await tx.customerCorporateProfile.findFirst({ where: { tenantId, unifiedSocialCreditCode: code }, select: { id: true } })) throw new ConflictException("主体已登记，请商户核对认领申请");
          const phoneOwner = await tx.customerProfile.findFirst({ where: { tenantId, phone: data.contactPhone.trim() }, select: { id: true } });
          if (phoneOwner) throw new ConflictException("现行客户主档要求租户内手机号唯一；企业联系电话已占用，须商户核验独立企业联系方式或现有企业认领，不修改个人主档");
          const legacy = await tx.customerProfile.findFirst({ where: { tenantId, corporateTaxNo: code }, select: { id: true } });
          if (legacy) throw new ConflictException("主体已在原客户主档登记，须商户核对现有企业认领");
          const customer = await this.customers.createProfile({ tenantId, customerType: "corporate", name: data.contactName, phone: data.contactPhone, email: data.email, corporateName: data.legalName, region: data.region }, tx);
          corporateCustomerId = customer.id;
          await this.customers.upsertCorporateProfile({ tenantId, customerId: customer.id, legalName: data.legalName, unifiedSocialCreditCode: code, unifiedSocialCreditCodeMasked: `${code.slice(0,3)}****${code.slice(-4)}`, status: "active" }, tx);
          await this.customers.createMembership({ tenantId, customerId: customer.id, levelName: "企业会员", status: "active" }, tx);
          const review = await this.customers.createReview({ tenantId, customerId: customer.id, reviewType: "corporate_registration", channel: "app", requestKey: `enterprise:${row.id}`, payload: { applicationId: row.id, applicantCustomerId: row.applicantCustomerId, agreementVersion: data.agreementVersion, evidenceFileIds: data.evidenceFileIds } }, tx);
          await this.customers.updateReview(tenantId, review.id, { status: "approved", reason: input.reason.trim(), reviewedBy: user.id, reviewedAt: new Date() }, tx);
        }
        const relation = await this.customers.saveEnterpriseRelation(tenantId, corporateCustomerId!, row.applicantCustomerId, { role: "admin", status: "active", effectiveFrom: new Date(), reason: input.reason, createdBy: actor }, tx);
        await tx.$executeRaw`INSERT INTO enterprise_corporate_portals (tenantId,corporateCustomerId,enabled,revision,updatedAt) VALUES (${tenantId},${corporateCustomerId},true,1,NOW(3)) ON DUPLICATE KEY UPDATE enabled=true,revision=revision+1,updatedAt=NOW(3)`;
        for (const action of ["portal:enter","members:read","members:manage","administrators:manage","invites:manage","policy:manage","approvals:review","orders:read","finance:read","requests:manage","audit:read","export:create"]) await tx.$executeRaw`INSERT INTO enterprise_portal_grants (tenantId,corporateCustomerId,membershipId,action,membershipUpdatedAt) VALUES (${tenantId},${corporateCustomerId},${relation.id},${action},${relation.updatedAt}) ON DUPLICATE KEY UPDATE membershipUpdatedAt=VALUES(membershipUpdatedAt)`;
      }
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},corporateCustomerId=${corporateCustomerId},decisionReason=${input.reason.trim()},revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${tenantId} AND id=${id}`;
      return { id, state, revision: row.revision + 1, corporateCustomerId };
      });
    } catch (error) {
      // Non-enterprise customer writers may race the tenant lock. Roll back the
      // whole approval, then expose no conflicting person's phone/identity or DB metadata.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("企业主档唯一资料发生冲突，须商户核对独立企业联系方式或现有主体认领");
      throw error;
    }
  }
}
