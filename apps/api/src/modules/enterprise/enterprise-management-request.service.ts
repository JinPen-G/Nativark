/** Proposals and review facts only. Original customer, policy and funding services
 * own actual changes; approving here neither applies a proposal nor confirms payment. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { isRentalCategoryCode, type EnterpriseChangeRequest, type EnterpriseManagementProposal, type EnterpriseManagementRequestType, type EnterpriseManagementRequestView, type EnterpriseOperationResult, type EnterpriseProfileView, type EnterpriseRequestState, type ReviewEnterpriseManagementRequest, type SaveEnterpriseManagementRequest, type SystemUserRow } from "@rental-os/shared";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { assertPublishedRentalCategoryIdentities } from "../rental-core/category-identity";

type Stored = { requestType: EnterpriseManagementRequestType; objectRevision: string; proposal: EnterpriseManagementProposal; evidenceFileIds: string[]; reason: string };
type Row = { id: string; corporateCustomerId: string; applicantCustomerId: string; state: EnterpriseRequestState; revision: number; payload: Stored | string; decisionReason: string | null; createdAt: Date; updatedAt: Date };
const requestTypes: EnterpriseManagementRequestType[] = ["profile_change", "credit_change", "scope_change"];
const fields: Record<EnterpriseManagementRequestType, string[]> = { profile_change: ["legalName", "registeredAddress", "email"], credit_change: ["requestedCreditLimit", "currency"], scope_change: ["workspaceIds", "categoryCodes"] };
@Injectable()
export class EnterpriseManagementRequestService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly access: EnterpriseAccessService) {}
  private view(row: Row): EnterpriseManagementRequestView {
    const data = enterpriseJson(row.payload);
    if (!requestTypes.includes(data.requestType)) throw new ConflictException("原企业申请类别不可核对");
    return { id: row.id, corporateCustomerId: row.corporateCustomerId, applicantCustomerId: row.applicantCustomerId, state: row.state, revision: row.revision,
      requestType: data.requestType, objectRevision: data.objectRevision, proposal: data.proposal, evidenceFileIds: data.evidenceFileIds, reason: data.reason,
      decisionReason: row.decisionReason, effect: "review_only_no_business_change", createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  private async company(tenantId: string, id: string, tx: Prisma.TransactionClient) {
    const company = await tx.customerProfile.findFirst({ where: { tenantId, id, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } },
      select: { id: true, corporateName: true, updatedAt: true, membership: { select: { status: true } }, corporateProfile: { select: { legalName: true, unifiedSocialCreditCodeMasked: true, registeredAddress: true, updatedAt: true } } } });
    if (!company) throw new NotFoundException("当前企业会员不可用");
    return company;
  }
  private async revision(tenantId: string, corporateId: string, type: EnterpriseManagementRequestType, tx: Prisma.TransactionClient) {
    if (tx !== this.prisma as unknown as Prisma.TransactionClient) {
      // Original master/credit writers need not take the portal's tenant lock.
      // Lock the actual revision source before publishing a review decision.
      await tx.$queryRaw`SELECT id FROM customer_profiles WHERE tenantId=${tenantId} AND id=${corporateId} FOR UPDATE`;
      if (type === "profile_change") await tx.$queryRaw`SELECT id FROM customer_corporate_profiles WHERE tenantId=${tenantId} AND customerId=${corporateId} FOR UPDATE`;
      if (type === "credit_change") await tx.$queryRaw`SELECT id FROM customer_corporate_credits WHERE tenantId=${tenantId} AND customerId=${corporateId} FOR UPDATE`;
    }
    const company = await this.company(tenantId, corporateId, tx);
    if (type === "profile_change") return JSON.stringify([company.updatedAt.toISOString(), company.corporateProfile?.updatedAt.toISOString() ?? null]);
    if (type === "credit_change") {
      const credit = await tx.customerCorporateCredit.findFirst({ where: { tenantId, customerId: corporateId }, select: { revision: true } });
      return String(credit?.revision ?? 0);
    }
    const policies = await tx.$queryRaw<Array<{ revision: number }>>`SELECT revision FROM enterprise_scope_policies WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateId} AND scopeKey='merchant'`;
    return String(policies[0]?.revision ?? 0);
  }
  async profile(context: ClientRequestContext, corporateId: string): Promise<EnterpriseProfileView> {
    const before = await this.access.requireAction(context, corporateId, "portal:enter");
    const db = this.prisma as unknown as Prisma.TransactionClient, company = await this.company(context.tenantId, corporateId, db);
    const permitted = before.actions.includes("requests:manage");
    const creditRevision = permitted ? Number(await this.revision(context.tenantId, corporateId, "credit_change", db)) : null;
    const merchantPolicyRevision = permitted ? Number(await this.revision(context.tenantId, corporateId, "scope_change", db)) : 0;
    const after = await this.access.requireAction(context, corporateId, "portal:enter");
    if (before.permissionRevision !== after.permissionRevision || permitted !== after.actions.includes("requests:manage")) throw new ForbiddenException("企业资料权限已变化");
    return { corporateCustomerId: corporateId, corporateName: company.corporateName ?? company.corporateProfile?.legalName ?? "", legalName: company.corporateProfile?.legalName ?? null,
      legalIdentifierMasked: company.corporateProfile?.unifiedSocialCreditCodeMasked ?? null, registeredAddress: company.corporateProfile?.registeredAddress ?? null,
      membershipStatus: company.membership!.status, profileRevision: JSON.stringify([company.updatedAt.toISOString(), company.corporateProfile?.updatedAt.toISOString() ?? null]), creditRevision, merchantPolicyRevision,
      requestTypes: permitted ? [...requestTypes] : [], unavailable: ["formal_bills", "payment_proof", "bill_dispute", "contract_files"] };
  }
  private validate(input: Pick<SaveEnterpriseManagementRequest, "requestType" | "objectRevision" | "proposal" | "evidenceFileIds" | "submit">) {
    if (!requestTypes.includes(input.requestType) || !input.objectRevision?.trim() || input.objectRevision.length > 191 || typeof input.submit !== "boolean"
      || !input.proposal || Array.isArray(input.proposal) || !Array.isArray(input.evidenceFileIds) || input.evidenceFileIds.length > 10
      || new Set(input.evidenceFileIds).size !== input.evidenceFileIds.length || input.evidenceFileIds.some(id => typeof id !== "string" || !id || id.length > 191)) throw new BadRequestException("申请对象、修订与材料无效");
    // Nest constructs optional DTO properties as undefined. Omit only absent
    // values; null and actual cross-type business fields must still be rejected.
    const proposal = Object.fromEntries(Object.entries(input.proposal).filter(([, value]) => value !== undefined)) as EnterpriseManagementProposal;
    const keys = Object.keys(proposal);
    if (!keys.length || keys.some(key => !fields[input.requestType].includes(key))) throw new BadRequestException("申请不能包含其他业务字段");
    if (input.requestType === "profile_change") {
      if (keys.some(key => typeof proposal[key as keyof EnterpriseManagementProposal] !== "string")) throw new BadRequestException("资料申请只接收文本");
      if (proposal.legalName !== undefined && (!proposal.legalName.trim() || proposal.legalName.length > 191)
        || proposal.registeredAddress !== undefined && proposal.registeredAddress.length > 1000
        || proposal.email !== undefined && (proposal.email.length > 191 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(proposal.email))) throw new BadRequestException("资料申请字段无效");
    } else if (input.requestType === "credit_change") {
      // The original corporate credit contract is CNY-only; no foreign limit is inferred.
      if (proposal.currency !== "CNY" || typeof proposal.requestedCreditLimit !== "string" || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(proposal.requestedCreditLimit)) throw new BadRequestException("原企业授信仅支持人民币及两位小数；此申请不改额度");
    } else if (!Array.isArray(proposal.workspaceIds) || !Array.isArray(proposal.categoryCodes) || proposal.workspaceIds.length > 200 || proposal.categoryCodes.length > 200
      || new Set(proposal.workspaceIds).size !== proposal.workspaceIds.length || new Set(proposal.categoryCodes).size !== proposal.categoryCodes.length
      || proposal.workspaceIds.some(id => typeof id !== "string" || !id || id.length > 191) || proposal.categoryCodes.some(code => !isRentalCategoryCode(code))) throw new BadRequestException("范围申请须使用登记的品类和有界空间引用");
    return proposal;
  }
  private async evidence(tenantId: string, applicant: string, ids: string[], tx: Prisma.TransactionClient) {
    if (!ids.length) return;
    const rows = await tx.fileAsset.findMany({ where: { tenantId, id: { in: ids }, businessType: "customer", businessId: applicant, uploadedBy: applicant, uploadScene: "enterprise-authority", status: "active", storageProvider: { not: "local_mock" } }, select: { id: true } });
    if (rows.length !== ids.length) throw new ForbiddenException("申请材料未归档或不属于原申请人");
  }
  async save(context: ClientRequestContext, corporateId: string, input: SaveEnterpriseManagementRequest) {
    input = { ...input, proposal: this.validate(input) };
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "management-request.save", corporateId, input, async tx => {
      let previous: Row | undefined;
      if (input.requestId) {
        previous = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${input.requestId} AND corporateCustomerId=${corporateId} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`)[0];
        if (!previous) throw new NotFoundException("本人企业申请不存在");
        if (previous.revision !== input.expectedRevision) throw this.commands.conflict();
        if (!["draft", "supplement_required"].includes(previous.state)) throw new ConflictException("原申请不可编辑");
        if (enterpriseJson(previous.payload).requestType !== input.requestType) throw new ConflictException("不能改变原申请类别");
      } else if (input.expectedRevision !== 0) throw this.commands.conflict();
      if (await this.revision(context.tenantId, corporateId, input.requestType, tx) !== input.objectRevision) throw this.commands.conflict();
      if (input.requestType === "scope_change") await assertPublishedRentalCategoryIdentities(tx, input.proposal.categoryCodes!);
      await this.evidence(context.tenantId, context.customerId, input.evidenceFileIds, tx);
      const duplicates = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND applicantCustomerId=${context.customerId} AND kind='finance_request' AND state IN ('draft','pending','supplement_required') LIMIT 201`;
      if (duplicates.length > 200) throw new ConflictException("本人未决申请超出有界范围");
      if (duplicates.some(row => row.id !== previous?.id && enterpriseJson(row.payload).requestType === input.requestType)) throw new ConflictException("同类已有本人未决申请，请编辑或撤回原申请");
      const id = previous?.id ?? randomUUID(), revision = (previous?.revision ?? 0) + 1, state = input.submit ? "pending" : "draft";
      const payload = JSON.stringify({ requestType: input.requestType, objectRevision: input.objectRevision, proposal: input.proposal, evidenceFileIds: input.evidenceFileIds, reason: input.reason.trim() });
      if (previous) await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},revision=${revision},payload=${payload},updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      else await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,revision,payload,updatedAt) VALUES (${context.tenantId},${id},'finance_request',${context.customerId},${corporateId},${state},${revision},${payload},NOW(3))`;
      return { id, state, revision, effect: "review_only_no_business_change" as const };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "requests:manage", tx); });
  }
  /** Own receipt recovery does not need today's management grant or enterprise state.
   * Only the linked original save result is projected, never current material or a later decision. */
  async readSave(context: ClientRequestContext, corporateId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原管理申请企业或保存操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ managementSaveKey: string; managementSaveResult: string | Record<string, unknown>; requestId: string | null; corporateCustomerId: string | null }>>`
      SELECT o.operationKey AS managementSaveKey,o.result AS managementSaveResult,w.id AS requestId,w.corporateCustomerId
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId
        AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'))
        AND w.corporateCustomerId=${corporateId} AND w.applicantCustomerId=${context.customerId} AND w.kind='finance_request'
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key} AND o.actorUserId=${`customer:${context.customerId}`}
        AND o.target=${`management-request.save:${corporateId}`}`;
    await this.commands.customer(context, tx, false);
    const receipt = receipts[0]; if (!receipt) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原管理申请保存收据或对象关联无法精确核对，保留原引用");
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(receipt.managementSaveResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (receipts.length !== 1 || receipt.managementSaveKey !== key || receipt.corporateCustomerId !== corporateId
      || typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(result.id) || receipt.requestId !== result.id
      || typeof result.state !== "string" || !["draft", "pending"].includes(result.state)
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1
      || result.effect !== "review_only_no_business_change") throw unavailable();
    return { state: "committed", result: { corporateCustomerId: corporateId, id: result.id, state: result.state, revision: result.revision, effect: "review_only_no_business_change" } };
  }
  /** Exact own feedback is independent of the bounded list and today's enterprise grant.
   * Current request material is not a command receipt and never unlocks an unknown K. */
  async detail(context: ClientRequestContext, id: string): Promise<EnterpriseManagementRequestView> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id)) throw new BadRequestException("原本人管理申请引用无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`;
    await this.commands.customer(context, tx, false);
    if (!rows.length) throw new NotFoundException("本人原管理申请不存在");
    const unavailable = () => new ConflictException("原本人管理申请反馈或材料无法核对");
    try {
      const row = rows[0], view = this.view(row);
      if (rows.length !== 1 || view.id !== id || view.applicantCustomerId !== context.customerId || typeof view.corporateCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(view.corporateCustomerId)
        || !["draft", "pending", "supplement_required", "approved", "rejected", "withdrawn"].includes(view.state) || !Number.isSafeInteger(view.revision) || view.revision < 1
        || typeof view.reason !== "string" || !view.reason.trim() || view.reason.length > 500 || view.decisionReason !== null && (typeof view.decisionReason !== "string" || view.decisionReason.length > 500)) throw unavailable();
      // Validation-only projection: this shape is never sent to execute/submit, and
      // carries no operation key or claim about original submission/payment history.
      const proposal = this.validate({ requestType: view.requestType, objectRevision: view.objectRevision, proposal: view.proposal, evidenceFileIds: view.evidenceFileIds, submit: false });
      return { ...view, proposal: Object.fromEntries(Object.entries(proposal).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])), evidenceFileIds: [...view.evidenceFileIds] };
    } catch { throw unavailable(); }
  }
  async mine(context: ClientRequestContext): Promise<EnterpriseManagementRequestView[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind='finance_request' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人申请超出有界范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => this.view(row));
  }
  async withdraw(context: ClientRequestContext, id: string, input: EnterpriseChangeRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "management-request.withdraw", id, input, async tx => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`)[0];
      if (!row) throw new NotFoundException("本人申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["draft", "pending", "supplement_required"].includes(row.state)) throw new ConflictException("原申请不可撤回");
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state='withdrawn',revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state: "withdrawn", revision: row.revision + 1 };
    }, tx => this.commands.customer(context, tx, false));
  }
  /** Withdrawal recovery follows the original owner/request/K, never today's state or grants. */
  async readWithdrawal(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原管理申请或撤回操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ requestId: string | null; managementWithdrawalKey: string; withdrawalResult: string | Record<string, unknown> }>>`
      SELECT w.id AS requestId,o.operationKey AS managementWithdrawalKey,o.result AS withdrawalResult
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id}
        AND w.applicantCustomerId=${context.customerId} AND w.kind='finance_request'
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`management-request.withdraw:${id}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0]; if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原管理申请撤回收据缺少精确本人、对象或修订，保留原引用");
    if (rows.length !== 1 || row.requestId !== id || row.managementWithdrawalKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.withdrawalResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || result.state !== "withdrawn" || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2) throw unavailable();
    return { state: "committed", result: { id, state: "withdrawn", revision: result.revision } };
  }
  async evidenceOwner(user: SystemUserRow, id: string, fileId: string) {
    const { tenantId } = this.merchant(user);
    const row = (await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
    if (!row) throw new NotFoundException("企业申请不存在");
    const data = enterpriseJson(row.payload);
    if (!requestTypes.includes(data.requestType)) throw new ConflictException("原申请类别不可核对");
    this.merchant(user, data.requestType);
    if (!data.evidenceFileIds.includes(fileId)) throw new ForbiddenException("附件不属于此申请");
    return { tenantId, applicantCustomerId: row.applicantCustomerId, revision: row.revision };
  }
  private merchant(user: SystemUserRow, type?: EnterpriseManagementRequestType) {
    const actor = this.commands.operator(user, "rental-os:corporate:manage");
    if (type === "credit_change") this.commands.operator(user, "rental-os:finance:manage");
    return actor;
  }
  async merchantList(user: SystemUserRow): Promise<EnterpriseManagementRequestView[]> {
    const { tenantId } = this.merchant(user);
    const finance = user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:finance:manage");
    const rows = finance
      ? await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='finance_request' ORDER BY createdAt DESC LIMIT 201`
      : await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='finance_request' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.requestType')) IN ('profile_change','scope_change') ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("商户企业申请超出有界范围");
    this.merchant(user);
    for (const row of rows) this.merchant(user, enterpriseJson(row.payload).requestType);
    return rows.map(row => this.view(row));
  }
  /** Read this operator's original review only. The immutable stored request type
   * selects today's finance guard; missing type evidence fails closed, never rebases a result. */
  async readReview(user: SystemUserRow, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原商户审核申请或操作键无效");
    const before = this.merchant(user), { tenantId, actor } = before;
    const rows = await this.prisma.$queryRaw<Array<{ managementReviewKey: string; reviewResult: string | Record<string, unknown>; requestId: string | null; corporateCustomerId: string | null; requestType: EnterpriseManagementRequestType | null }>>`
      SELECT o.operationKey AS managementReviewKey,o.result AS reviewResult,w.id AS requestId,w.corporateCustomerId,
        JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.requestType')) AS requestType
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id} AND w.kind='finance_request'
      WHERE o.tenantId=${tenantId} AND o.operationKey=${key} AND o.actorUserId=${actor} AND o.target=${`management-request.review:${id}`}`;
    const current = this.merchant(user);
    if (current.tenantId !== before.tenantId || current.actor !== before.actor) throw new ForbiddenException("原审核读取身份已变化");
    const row = rows[0]; if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原商户审核收据、申请或类别无法精确核对，保留原引用");
    if (rows.length !== 1 || row.managementReviewKey !== key || row.requestId !== id || typeof row.corporateCustomerId !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(row.corporateCustomerId)
      || !row.requestType || !requestTypes.includes(row.requestType)) throw unavailable();
    this.merchant(user, row.requestType);
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.reviewResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || typeof result.state !== "string" || !["approved", "rejected", "supplement_required"].includes(result.state)
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2 || result.effect !== "review_only_no_business_change") throw unavailable();
    return { state: "committed", result: { corporateCustomerId: row.corporateCustomerId, requestType: row.requestType, id, state: result.state, revision: result.revision, effect: "review_only_no_business_change" } };
  }
  async review(user: SystemUserRow, id: string, input: ReviewEnterpriseManagementRequest) {
    if (!["approve", "reject", "supplement"].includes(input.decision)) throw new BadRequestException("处理决定无效");
    const { tenantId, actor } = this.merchant(user);
    const verify = async (tx: Prisma.TransactionClient) => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
      if (!row) throw new NotFoundException("企业申请不存在");
      this.merchant(user, enterpriseJson(row.payload).requestType);
    };
    return this.commands.execute(tenantId, actor, "management-request.review", id, input, async tx => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("申请不在审核中");
      const data = enterpriseJson(row.payload);
      if (input.decision === "approve") {
        if (await this.revision(tenantId, row.corporateCustomerId, data.requestType, tx) !== data.objectRevision) throw this.commands.conflict();
        if (data.requestType === "scope_change") await assertPublishedRentalCategoryIdentities(tx, this.validate({ ...data, submit: true }).categoryCodes!);
        await this.evidence(tenantId, row.applicantCustomerId, data.evidenceFileIds, tx);
      }
      const state = input.decision === "approve" ? "approved" : input.decision === "supplement" ? "supplement_required" : "rejected";
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},decisionReason=${input.reason.trim()},revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${tenantId} AND id=${id}`;
      return { id, state, revision: row.revision + 1, effect: "review_only_no_business_change" as const };
    }, verify);
  }
}
