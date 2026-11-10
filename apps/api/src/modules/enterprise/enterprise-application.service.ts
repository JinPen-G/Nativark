/** Applicant drafts are private; merchant review atomically binds a verified first admin.
 * Does not grant credit, category access, payment authority or automatic claim rights. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { EnterpriseApplicationInput, EnterpriseChangeRequest, EnterpriseWorkflowView, ReviewEnterpriseApplicationRequest, SaveEnterpriseApplicationRequest, SystemUserRow, EnterpriseOperationResult, EnterpriseApplicationClaimView } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { hasCurrentEnterpriseAdministrator } from "./enterprise-administrator-continuity";
import { enterpriseApplicationRegionHasIdentityMapping } from "@rental-os/shared";
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
    if (!enterpriseApplicationRegionHasIdentityMapping(input.region) && !input.existingCorporateCustomerId) throw new BadRequestException("该地区主档映射尚未配置，当前不能在线提交或借存量引用绕过，请联系商户核对；原记录保留");
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
    if (input.submit && input.application.agreementAcknowledged !== true) throw new BadRequestException("提交前须本人明确确认商户协议");
    // A caller's timestamp is not evidence of consent; only this service stamps acceptance.
    const { agreementAcknowledgedAt: _untrustedTime, ...application } = input.application as StoredApplication;
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "application.save", "self", input, async tx => {
      // A recorded original key precedes today's mapping gate. This callback is
      // invoked only for a new command, never to reinterpret an old save receipt.
      this.validate(input.application);
      if (input.submit) this.requireRegionMapping(input.application);
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
      else await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,state,revision,payload,updatedAt) VALUES (${context.tenantId},${id},'corporate_application',${context.customerId},${state},${revision},${payload},NOW(3))`;
      return { id, revision, state };
    }, tx => this.commands.customer(context, tx, false));
  }
  /** Read the original save result, never today's material, approval or a newly guessed draft. */
  async readSave(context: ClientRequestContext, key: string): Promise<EnterpriseOperationResult> {
    if (typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原企业申请保存操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ saveKey: string; saveResult: string | Record<string, unknown> }>>`SELECT operationKey AS saveKey,result AS saveResult
      FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key}
        AND actorUserId=${`customer:${context.customerId}`} AND target=${"application.save:self"}`;
    await this.commands.customer(context, tx, false);
    const receipt = receipts[0]; if (!receipt) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原企业申请保存收据缺少精确本人、申请或修订，保留原引用");
    if (receipt.saveKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(receipt.saveResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(result.id)
      || typeof result.state !== "string" || !["draft", "pending", "supplement_required"].includes(result.state)
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1) throw unavailable();
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId}
      AND id=${result.id} AND applicantCustomerId=${context.customerId} AND kind='corporate_application'`;
    await this.commands.customer(context, tx, false);
    if (rows[0]?.id !== result.id) throw unavailable();
    return { state: "committed", result: { id: result.id, state: result.state, revision: result.revision } };
  }
  async mine(context: ClientRequestContext) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind='corporate_application' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人企业申请超出当前有界读取范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => this.view(row));
  }
  /** Applicant-only exact feedback: original request material, never today's profile/policy or operator receipt. */
  async detail(context: ClientRequestContext, id: string): Promise<EnterpriseWorkflowView> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new BadRequestException("原企业申请引用无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId}
      AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='corporate_application'`;
    await this.commands.customer(context, tx, false);
    const row = rows[0]; if (!row) throw new NotFoundException("本人原企业申请不可读取");
    return this.applicationMaterial(row, id, context.customerId);
  }
  /** Registered material only. Authentication stays at each customer/operator reader. */
  private applicationMaterial(row: RequestRow, id: string, applicantCustomerId?: string): EnterpriseWorkflowView {
    const unavailable = () => new ConflictException("原企业申请材料或处理反馈不可读取，保留原引用");
    try {
      const original = this.view(row), data = original.payload;
      if (original.id !== id || applicantCustomerId !== undefined && original.applicantCustomerId !== applicantCustomerId || original.kind !== "corporate_application"
        || !["draft", "pending", "supplement_required", "approved", "rejected", "withdrawn"].includes(original.state)
        || !Number.isSafeInteger(original.revision) || original.revision < 1 || !data || typeof data !== "object" || Array.isArray(data)
        || original.corporateCustomerId !== undefined && (typeof original.corporateCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(original.corporateCustomerId))
        || original.decisionReason !== undefined && (typeof original.decisionReason !== "string" || original.decisionReason.length > 500)) throw unavailable();
      const payload: Record<string, unknown> = {};
      for (const [field, max] of [["legalName", 191], ["region", 80], ["legalIdentifier", 191], ["contactName", 120], ["contactPhone", 32], ["email", 191], ["authorityStatement", 2000], ["agreementVersion", 191], ["existingCorporateCustomerId", 191], ["agreementAcknowledgedAt", 64]] as const) {
        const value = data[field]; if (value === undefined) continue;
        if (typeof value !== "string" || value.length > max) throw unavailable(); payload[field] = value;
      }
      if (payload.agreementAcknowledgedAt !== undefined && (typeof payload.agreementAcknowledgedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(payload.agreementAcknowledgedAt)
        || !Number.isFinite(Date.parse(payload.agreementAcknowledgedAt)) || new Date(payload.agreementAcknowledgedAt).toISOString() !== payload.agreementAcknowledgedAt)) throw unavailable();
      if (data.agreementAcknowledged !== undefined) { if (typeof data.agreementAcknowledged !== "boolean") throw unavailable(); payload.agreementAcknowledged = data.agreementAcknowledged; }
      if (data.evidenceFileIds !== undefined) {
        if (!Array.isArray(data.evidenceFileIds) || data.evidenceFileIds.length > 10 || data.evidenceFileIds.some(id => typeof id !== "string")) throw unavailable();
        payload.evidenceFileIds = [...data.evidenceFileIds];
      }
      return { ...original, payload };
    } catch { throw unavailable(); }
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
  /** Own receipt first: today's application, enterprise or member state cannot substitute for the original withdrawal. */
  async readWithdrawal(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !id.trim() || id.length > 191 || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原企业申请或撤回操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ requestId: string | null; applicationWithdrawalKey: string; withdrawalResult: string | Record<string, unknown> }>>`
      SELECT w.id AS requestId,o.operationKey AS applicationWithdrawalKey,o.result AS withdrawalResult
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id}
        AND w.applicantCustomerId=${context.customerId} AND w.kind='corporate_application'
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`application.withdraw:${id}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0]; if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原企业申请撤回收据缺少精确本人、对象或修订，保留原引用");
    if (row.requestId !== id || row.applicationWithdrawalKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.withdrawalResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || result.state !== "withdrawn" || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2) throw unavailable();
    return { state: "committed", result: { id, state: "withdrawn", revision: result.revision } };
  }
  async merchantList(user: SystemUserRow) {
    const { tenantId } = this.commands.operator(user, "rental-os:corporate:manage");
    const rows = await this.prisma.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='corporate_application' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("商户企业申请超出当前有界读取范围");
    this.commands.operator(user, "rental-os:corporate:manage");
    return rows.map(row => this.view(row));
  }
  /** Exact operator material for a registered application, independent of list bounds.
   * Current dual authority is checked before and after reading; this is not a command receipt. */
  async merchantDetail(user: SystemUserRow, id: string): Promise<EnterpriseWorkflowView> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new BadRequestException("原企业申请引用无效");
    const before = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    const rows = await this.prisma.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests
      WHERE tenantId=${before.tenantId} AND id=${id} AND kind='corporate_application'`;
    const current = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    if (current.tenantId !== before.tenantId || current.actor !== before.actor) throw new ForbiddenException("原申请材料读取身份已变化");
    if (!rows.length) throw new NotFoundException("原企业申请不可读取");
    if (rows.length !== 1) throw new ConflictException("原企业申请关联无法核对");
    return this.applicationMaterial(rows[0], id);
  }
  /** Internal file-reader binding, not a public grant or reusable download ticket. */
  async merchantEvidenceOwner(user: SystemUserRow, id: string, fileId: string) {
    if (typeof fileId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(fileId)) throw new BadRequestException("原授权材料引用无效");
    const before = this.commands.operator(user, "rental-os:corporate:manage");
    const material = await this.merchantDetail(user, id);
    if (!/^[a-zA-Z0-9_-]{1,191}$/u.test(material.applicantCustomerId) || !Array.isArray(material.payload.evidenceFileIds)
      || !material.payload.evidenceFileIds.includes(fileId)) throw new ForbiddenException("材料不属于此商户申请");
    const current = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    if (current.tenantId !== before.tenantId || current.actor !== before.actor) throw new ForbiddenException("材料读取身份已变化");
    return { ...current, applicantCustomerId: material.applicantCustomerId, materialKey: JSON.stringify(material) };
  }
  /** Receipt-first operator recovery: only the original decision, never today's
   * application material, corporate profile or administrator grant. */
  async readReview(user: SystemUserRow, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原企业审核申请或操作键无效");
    const before = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    const { tenantId, actor } = before;
    const rows = await this.prisma.$queryRaw<Array<{ applicationReviewKey: string; reviewResult: string | Record<string, unknown>; requestId: string | null }>>`
      SELECT o.operationKey AS applicationReviewKey,o.result AS reviewResult,w.id AS requestId
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id} AND w.kind='corporate_application'
      WHERE o.tenantId=${tenantId} AND o.operationKey=${key} AND o.actorUserId=${actor} AND o.target=${`application.review:${id}`}`;
    const current = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    if (current.tenantId !== before.tenantId || current.actor !== before.actor) throw new ForbiddenException("原审核读取身份已变化");
    const row = rows[0]; if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原企业审核收据、申请或结果无法精确核对，保留原引用");
    if (rows.length !== 1 || row.applicationReviewKey !== key || row.requestId !== id) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.reviewResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || typeof result.state !== "string" || !["approved", "rejected", "supplement_required"].includes(result.state)
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2
      || !(result.corporateCustomerId === null || typeof result.corporateCustomerId === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(result.corporateCustomerId))
      || result.state === "approved" && result.corporateCustomerId === null) throw unavailable();
    return { state: "committed", result: { id, state: result.state, revision: result.revision, corporateCustomerId: result.corporateCustomerId } };
  }
  private requireRegionMapping(data: EnterpriseApplicationInput) {
    if (!enterpriseApplicationRegionHasIdentityMapping(data.region)) throw new BadRequestException({ code: "enterprise_application_region_unavailable", message: "该地区尚无受控企业主体映射，当前不能在线提交或批准认领；原申请和收据保留" });
  }
  private async existingCorporateTarget(tx: Prisma.TransactionClient, tenantId: string, data: StoredApplication) {
    // CustomerProfile.region is a display-only city. The current identity port is
    // CN USCC; no registered foreign mapping may be inferred from that city field.
    this.requireRegionMapping(data);
    if (!data.existingCorporateCustomerId || !/^[a-zA-Z0-9_-]{1,191}$/u.test(data.existingCorporateCustomerId)) throw new BadRequestException("原认领企业引用无效");
    const existing = await tx.customerProfile.findFirst({ where: { tenantId, id: data.existingCorporateCustomerId, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }, include: { corporateProfile: true } });
    if (!existing || existing.corporateName !== data.legalName || existing.corporateProfile?.unifiedSocialCreditCode !== data.legalIdentifier.trim().toUpperCase()
      || existing.corporateProfile.status !== "active") throw new ConflictException("存量主体资料不匹配或身份不可用，须商户单独核对");
    return existing;
  }
  /** Current administrator facts are observed only under the original Tenant fence. */
  private async claimAdministratorFacts(tx: Prisma.TransactionClient, tenantId: string, corporateId: string) {
    const markers = await tx.$queryRaw<Array<{ migrated: boolean | number | bigint }>>`
      SELECT (EXISTS (SELECT 1 FROM enterprise_corporate_portals portal WHERE portal.tenantId=${tenantId} AND portal.corporateCustomerId=${corporateId})
        OR EXISTS (SELECT 1 FROM enterprise_scope_policies policy WHERE policy.tenantId=${tenantId} AND policy.corporateCustomerId=${corporateId})) AS migrated`;
    if (markers.length !== 1 || ![true, false, 0, 1, 0n, 1n].includes(markers[0].migrated)) throw new ConflictException("企业迁入依据无法核对，不能恢复管理员");
    const migrated = Boolean(markers[0].migrated);
    const hasCurrentAdministrator = migrated ? await hasCurrentEnterpriseAdministrator(tx, tenantId, corporateId)
      : (await tx.customerCorporateMembership.count({ where: { tenantId, corporateCustomerId: corporateId, role: "admin", status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } })) > 0;
    return { migrated, hasCurrentAdministrator };
  }
  /** Request-bound current claim facts; never a historical receipt or administrator grant. */
  async merchantClaimMaterial(user: SystemUserRow, id: string): Promise<EnterpriseApplicationClaimView> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new BadRequestException("原企业申请引用无效");
    const before = this.commands.operator(user, "rental-os:corporate:manage");
    this.commands.operator(user, "rental-os:corporate:employee-manage");
    return this.prisma.$transaction(async tx => {
      const tenants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${before.tenantId} AND status='ACTIVE' LOCK IN SHARE MODE`;
      if (!tenants.length) throw new ForbiddenException("商户不可用");
      const rows = await tx.$queryRaw<RequestRow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${before.tenantId} AND id=${id} AND kind='corporate_application'`;
      if (rows.length !== 1) throw new NotFoundException("原企业申请不可读取");
      const row = rows[0]; this.applicationMaterial(row, id);
      if (row.state !== "pending") throw new ConflictException("此申请已不在审核中");
      const data = enterpriseJson(row.payload); this.validate(data);
      const existing = await this.existingCorporateTarget(tx, before.tenantId, data);
      const facts = await this.claimAdministratorFacts(tx, before.tenantId, existing.id);
      const masked = existing.corporateProfile!.unifiedSocialCreditCodeMasked;
      if (typeof masked !== "string" || !masked.trim() || masked.length > 191) throw new ConflictException("存量主体脱敏依据缺失");
      const current = this.commands.operator(user, "rental-os:corporate:manage");
      this.commands.operator(user, "rental-os:corporate:employee-manage");
      if (current.tenantId !== before.tenantId || current.actor !== before.actor) throw new ForbiddenException("主体核验读取身份已变化");
      return { applicationId: id, applicationRevision: row.revision, corporateCustomerId: existing.id, corporateName: existing.corporateName!, legalIdentifierMasked: masked, ...facts, readOnly: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
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
      let corporateCustomerId = row.corporateCustomerId;
      const state = input.decision === "approve" ? "approved" : input.decision === "supplement" ? "supplement_required" : "rejected";
      if (input.decision === "approve") {
        // Unmapped or incomplete historical material may still be rejected or
        // requested for supplement; only approval requires a usable identity port.
        const data = enterpriseJson(row.payload); this.validate(data); this.requireRegionMapping(data);
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
          const existing = await this.existingCorporateTarget(tx, tenantId, data);
          // The preview never authorizes the write. Recheck the same current identity
          // and administrator facts inside the original exclusive Tenant transaction.
          const facts = await this.claimAdministratorFacts(tx, tenantId, existing.id);
          if (facts.hasCurrentAdministrator) throw new ConflictException("企业已有管理员，须走邀请或独立核验恢复流程");
          corporateCustomerId = existing.id;
        } else {
          const code = data.legalIdentifier.trim().toUpperCase();
          if (await tx.customerCorporateProfile.findFirst({ where: { tenantId, unifiedSocialCreditCode: code }, select: { id: true } })) throw new ConflictException("主体已登记，请商户核对认领申请");
          const phoneOwner = await tx.customerProfile.findFirst({ where: { tenantId, phone: data.contactPhone.trim() }, select: { id: true } });
          if (phoneOwner) throw new ConflictException("现行客户主档要求租户内手机号唯一；企业联系电话已占用，须商户核验独立企业联系方式或现有企业认领，不修改个人主档");
          const legacy = await tx.customerProfile.findFirst({ where: { tenantId, corporateTaxNo: code }, select: { id: true } });
          if (legacy) throw new ConflictException("主体已在原客户主档登记，须商户核对现有企业认领");
          // The application retains its legal jurisdiction. Do not write it into
          // the customer's optional display-only city/region field.
          const customer = await this.customers.createProfile({ tenantId, customerType: "corporate", name: data.contactName, phone: data.contactPhone, email: data.email, corporateName: data.legalName }, tx);
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
