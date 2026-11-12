/** Proposals and review facts only. Original customer, policy and funding services
 * own actual changes; approving here neither applies a proposal nor confirms payment. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ENTERPRISE_REVIEW_REQUEST_TYPES, isRentalCategoryCode, type EnterpriseChangeRequest, type EnterpriseManagementProposal, type EnterpriseManagementRequestType, type EnterpriseManagementRequestView, type EnterpriseOperationResult, type EnterpriseProfileView, type EnterpriseRequestState, type ReviewEnterpriseManagementRequest, type SaveEnterpriseManagementRequest, type SystemUserRow } from "@rental-os/shared";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { assertPublishedRentalCategoryIdentities } from "../rental-core/category-identity";
import { AuthService } from "../auth/auth.service";
import { getRequestIdentity } from "../../common/request-identity";
import { ENTERPRISE_PAYMENT_PROOF_SCENE, EnterprisePaymentProofSource, type PaymentProofReceipt } from "./enterprise-payment-proof-source";

type Stored = { requestType: EnterpriseManagementRequestType; objectRevision: string; proposal: EnterpriseManagementProposal; evidenceFileIds: string[]; reason: string; paymentProof?: PaymentProofReceipt };
type Row = { tenantId: string; id: string; corporateCustomerId: string; applicantCustomerId: string; state: EnterpriseRequestState; revision: number; payload: Stored | string; decisionReason: string | null; createdAt: Date; updatedAt: Date };
const requestTypes: readonly EnterpriseManagementRequestType[] = ENTERPRISE_REVIEW_REQUEST_TYPES;
const fields: Record<EnterpriseManagementRequestType, string[]> = {
  profile_change: ["legalName", "registeredAddress", "email"],
  credit_change: ["requestedCreditLimit", "currency"],
  scope_change: ["workspaceIds", "categoryCodes"],
  payment_proof: ["orderId", "workspaceId", "reportedAmount", "currency", "paymentPurpose"]
};
@Injectable()
export class EnterpriseManagementRequestService {
  private readonly proofs: EnterprisePaymentProofSource;
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly access: EnterpriseAccessService, @Optional() auth?: AuthService) {
    this.proofs = new EnterprisePaymentProofSource(prisma, access, commands, auth);
  }
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
    const paymentProof = permitted && before.actions.includes("orders:read") && before.actions.includes("finance:read") && Boolean(context.workspaceId && context.workspaceCode);
    if (paymentProof) await this.proofs.customer(context, corporateId, db);
    const after = await this.access.requireAction(context, corporateId, "portal:enter");
    if (before.permissionRevision !== after.permissionRevision || permitted !== after.actions.includes("requests:manage")
      || paymentProof && (!after.actions.includes("orders:read") || !after.actions.includes("finance:read"))) throw new ForbiddenException("企业资料权限已变化");
    return { corporateCustomerId: corporateId, corporateName: company.corporateName ?? company.corporateProfile?.legalName ?? "", legalName: company.corporateProfile?.legalName ?? null,
      legalIdentifierMasked: company.corporateProfile?.unifiedSocialCreditCodeMasked ?? null, registeredAddress: company.corporateProfile?.registeredAddress ?? null,
      membershipStatus: company.membership!.status, profileRevision: JSON.stringify([company.updatedAt.toISOString(), company.corporateProfile?.updatedAt.toISOString() ?? null]), creditRevision, merchantPolicyRevision,
      requestTypes: permitted ? requestTypes.filter(type => type !== "payment_proof" || paymentProof) : [], unavailable: ["formal_bills", ...(!paymentProof ? ["payment_proof" as const] : []), "bill_dispute", "contract_files"] };
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
    } else if (input.requestType === "payment_proof") {
      if (![proposal.orderId, proposal.workspaceId].every(value => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,191}$/u.test(value))
        || typeof proposal.currency !== "string" || !/^[A-Z]{3}$/u.test(proposal.currency) || typeof proposal.reportedAmount !== "string"
        || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(proposal.reportedAmount) || !new Prisma.Decimal(proposal.reportedAmount).gt(0)
        || proposal.paymentPurpose !== "rental_fee" || input.submit && !input.evidenceFileIds.length) throw new BadRequestException("逐单费用回款申请须原订单、空间、币种、正金额及归档凭证");
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
    context = Object.freeze({ ...context });
    input = { ...input, proposal: this.validate(input), evidenceFileIds: [...input.evidenceFileIds] };
    let paymentProof: PaymentProofReceipt | undefined;
    const target = input.requestType === "payment_proof" ? `payment_proof:${corporateId}` : corporateId;
    const result = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "management-request.save", target, input, async tx => {
      let previous: Row | undefined;
      if (input.requestId) {
        previous = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${input.requestId} AND corporateCustomerId=${corporateId} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`)[0];
        if (!previous) throw new NotFoundException("本人企业申请不存在");
        if (previous.revision !== input.expectedRevision) throw this.commands.conflict();
        if (!["draft", "supplement_required"].includes(previous.state)) throw new ConflictException("原申请不可编辑");
        if (enterpriseJson(previous.payload).requestType !== input.requestType) throw new ConflictException("不能改变原申请类别");
        if (input.requestType === "payment_proof" && ["orderId", "workspaceId", "currency"].some(key => enterpriseJson(previous!.payload).proposal[key as keyof EnterpriseManagementProposal] !== input.proposal[key as keyof EnterpriseManagementProposal])) {
          throw new ConflictException("回款申请须保留原订单、空间及币种");
        }
      } else if (input.expectedRevision !== 0) throw this.commands.conflict();
      if (input.requestType !== "payment_proof" && await this.revision(context.tenantId, corporateId, input.requestType, tx) !== input.objectRevision) throw this.commands.conflict();
      if (input.requestType === "scope_change") await assertPublishedRentalCategoryIdentities(tx, input.proposal.categoryCodes!);
      if (input.requestType !== "payment_proof") await this.evidence(context.tenantId, context.customerId, input.evidenceFileIds, tx);
      const duplicates = await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND applicantCustomerId=${context.customerId} AND kind='finance_request' AND state IN ('draft','pending','supplement_required') LIMIT 201`;
      if (duplicates.length > 200) throw new ConflictException("本人未决申请超出有界范围");
      if (duplicates.some(row => row.id !== previous?.id && enterpriseJson(row.payload).requestType === input.requestType
        && (input.requestType !== "payment_proof" || enterpriseJson(row.payload).proposal.orderId === input.proposal.orderId))) throw new ConflictException("同类原对象已有本人未决申请，请编辑或撤回原申请");
      const id = previous?.id ?? randomUUID(), revision = (previous?.revision ?? 0) + 1, state = input.submit ? "pending" : "draft";
      const payload = JSON.stringify({ requestType: input.requestType, objectRevision: input.objectRevision, proposal: input.proposal, evidenceFileIds: input.evidenceFileIds, reason: input.reason.trim(), ...(paymentProof ? { paymentProof } : {}) });
      if (paymentProof) await this.proofs.customer(context, corporateId, tx);
      if (previous) await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},revision=${revision},payload=${payload},updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      else await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,revision,payload,updatedAt) VALUES (${context.tenantId},${id},'finance_request',${context.customerId},${corporateId},${state},${revision},${payload},NOW(3))`;
      return { id, state, revision, effect: "review_only_no_business_change" as const, ...(paymentProof ? { paymentProof } : {}) };
    }, async tx => {
      await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "requests:manage", tx);
      if (input.requestType === "payment_proof") {
        await this.proofs.customer(context, corporateId, tx);
        if (input.proposal.workspaceId !== context.workspaceId) throw new ForbiddenException("回款申请空间与原客户会话不一致");
        paymentProof = await this.proofs.prepare(context.tenantId, context.customerId, { corporateCustomerId: corporateId, orderId: input.proposal.orderId!, workspaceId: input.proposal.workspaceId!,
          currency: input.proposal.currency!, objectRevision: input.objectRevision, evidenceFileIds: input.evidenceFileIds, purpose: "rental_fee" }, tx);
      }
    });
    const { paymentProof: _internalProof, ...response } = result;
    return response;
  }

  paymentProofBasis(context: ClientRequestContext, corporateId: string, orderId: string) { return this.proofs.basis(context, corporateId, orderId); }

  private async customerProof(context: ClientRequestContext, corporateId: string, receipt: PaymentProofReceipt) {
    context = Object.freeze({ ...context });
    if (receipt?.corporateCustomerId !== corporateId || receipt.workspaceId !== context.workspaceId) throw new ForbiddenException("原回款申请企业或空间不一致");
    const db = this.prisma as unknown as Prisma.TransactionClient, before = await this.proofs.customer(context, corporateId, db);
    const evidence = await this.prisma.$transaction(tx => this.proofs.readOriginal(context.tenantId, context.customerId, receipt, tx), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (await this.proofs.customer(context, corporateId, db) !== before) throw new ForbiddenException("原回款申请读取期间权限已变化");
    return evidence;
  }

  private async merchantProof(user: SystemUserRow, applicant: string, receipt: PaymentProofReceipt, authorization?: string, tx?: Prisma.TransactionClient, mode: "current_version" | "original_receipt" = "current_version") {
    if (!receipt) throw new ConflictException("原回款申请缺少订单与凭证绑定");
    const before = await this.proofs.merchant(authorization, user, receipt.workspaceId);
    const verify = (db: Prisma.TransactionClient) => mode === "original_receipt" ? this.proofs.readOriginal(user.tenantId, applicant, receipt, db) : this.proofs.verify(user.tenantId, applicant, receipt, db);
    const evidence = tx ? await verify(tx) : await this.prisma.$transaction(verify, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (await this.proofs.merchant(authorization, user, receipt.workspaceId) !== before) throw new ForbiddenException("原回款申请核对期间商户权限已变化");
    return evidence;
  }

  private storedProof(row: Row): PaymentProofReceipt {
    const data = enterpriseJson(row.payload), source = data.paymentProof;
    this.validate({ ...data, submit: row.state === "pending" });
    if (data.requestType !== "payment_proof" || !source || source.corporateCustomerId !== row.corporateCustomerId || source.orderId !== data.proposal.orderId
      || source.workspaceId !== data.proposal.workspaceId || source.currency !== data.proposal.currency || source.objectRevision !== data.objectRevision
      || source.purpose !== data.proposal.paymentPurpose || JSON.stringify(source.evidenceFileIds) !== JSON.stringify(data.evidenceFileIds)) throw new ConflictException("原回款申请材料与持久绑定不一致");
    return source;
  }
  /** Legacy proposals recover the exact own receipt. Rental-fee evidence retains
   * the saved version and rechecks current subjects, financial access and frozen files. */
  async readSave(context: ClientRequestContext, corporateId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原管理申请企业或保存操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    type Receipt = { managementSaveKey: string; managementSaveResult: string | Record<string, unknown>; requestId: string | null; corporateCustomerId: string | null };
    let receipts = await tx.$queryRaw<Receipt[]>`
      SELECT o.operationKey AS managementSaveKey,o.result AS managementSaveResult,w.id AS requestId,w.corporateCustomerId
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId
        AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'))
        AND w.corporateCustomerId=${corporateId} AND w.applicantCustomerId=${context.customerId} AND w.kind='finance_request'
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key} AND o.actorUserId=${`customer:${context.customerId}`}
        AND o.target=${`management-request.save:${corporateId}`}`;
    let paymentProof = false;
    if (!receipts.length) {
      const proofReceipts = await tx.$queryRaw<Array<{ paymentProofSaveKey: string; paymentProofSaveResult: string | Record<string, unknown>; requestId: string | null; corporateCustomerId: string | null }>>`
        SELECT o.operationKey AS paymentProofSaveKey,o.result AS paymentProofSaveResult,w.id AS requestId,w.corporateCustomerId
        FROM enterprise_portal_operations o
        LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId
          AND w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'))
          AND w.corporateCustomerId=${corporateId} AND w.applicantCustomerId=${context.customerId} AND w.kind='finance_request'
        WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key} AND o.actorUserId=${`customer:${context.customerId}`}
          AND o.target=${`management-request.save:payment_proof:${corporateId}`}`;
      paymentProof = true;
      receipts = proofReceipts.map(row => ({ managementSaveKey: row.paymentProofSaveKey, managementSaveResult: row.paymentProofSaveResult, requestId: row.requestId, corporateCustomerId: row.corporateCustomerId }));
    }
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
    if (paymentProof) {
      if (!result.paymentProof) throw unavailable();
      await this.customerProof(context, corporateId, result.paymentProof as PaymentProofReceipt);
    } else if (result.paymentProof !== undefined) throw unavailable();
    return { state: "committed", result: { corporateCustomerId: corporateId, id: result.id, state: result.state, revision: result.revision, effect: "review_only_no_business_change" } };
  }
  /** Exact own feedback stays independent of the bounded list. Payment evidence
   * retains current financial admission. Original command recovery uses its own K. */
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
      if (view.requestType === "payment_proof") await this.customerProof(context, view.corporateCustomerId, this.storedProof(row));
      return { ...view, proposal: Object.fromEntries(Object.entries(proposal).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])), evidenceFileIds: [...view.evidenceFileIds] };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw unavailable();
    }
  }
  async mine(context: ClientRequestContext): Promise<EnterpriseManagementRequestView[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind='finance_request' ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("本人申请超出有界范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    let result: EnterpriseManagementRequestView[] = [];
    for (const row of rows) {
      const view = this.view(row);
      if (view.requestType === "payment_proof") {
        if (view.proposal.workspaceId !== context.workspaceId) continue;
        try { await this.customerProof(context, view.corporateCustomerId, this.storedProof(row)); }
        catch (error) {
          if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException) continue;
          throw error;
        }
      }
      result.push(view);
    }
    // A later row can observe revoked corporate authority. Remove that
    // company's earlier proof rows before publishing the combined list.
    const corporates = new Set(result.filter(row => row.requestType === "payment_proof").map(row => row.corporateCustomerId));
    for (const corporateId of corporates) {
      try { await this.proofs.customer(context, corporateId, this.prisma as unknown as Prisma.TransactionClient); }
      catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
        result = result.filter(row => row.requestType !== "payment_proof" || row.corporateCustomerId !== corporateId);
      }
    }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return result;
  }
  async withdraw(context: ClientRequestContext, id: string, input: EnterpriseChangeRequest) {
    const result = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "management-request.withdraw", id, input, async tx => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`)[0];
      if (!row) throw new NotFoundException("本人申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (!["draft", "pending", "supplement_required"].includes(row.state)) throw new ConflictException("原申请不可撤回");
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state='withdrawn',revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state: "withdrawn", revision: row.revision + 1, ...(enterpriseJson(row.payload).requestType === "payment_proof" ? { paymentProof: this.storedProof(row) } : {}) };
    }, tx => this.commands.customer(context, tx, false));
    const { paymentProof: _internalProof, ...response } = result;
    return response;
  }
  /** Original owner/request/K recovery retains legacy withdrawal access. Payment
   * evidence also verifies its saved order and frozen-file admission. */
  async readWithdrawal(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原管理申请或撤回操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ requestId: string | null; managementWithdrawalKey: string; withdrawalResult: string | Record<string, unknown>; corporateCustomerId?: string; requestType?: EnterpriseManagementRequestType }>>`
      SELECT w.id AS requestId,o.operationKey AS managementWithdrawalKey,o.result AS withdrawalResult,w.corporateCustomerId,
        JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.requestType')) AS requestType
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
    if (row.requestType === "payment_proof" || result.paymentProof !== undefined) {
      if (row.requestType !== "payment_proof" || !row.corporateCustomerId || !result.paymentProof) throw unavailable();
      await this.customerProof(context, row.corporateCustomerId, result.paymentProof as PaymentProofReceipt);
    }
    return { state: "committed", result: { id, state: "withdrawn", revision: result.revision } };
  }
  async evidenceOwner(user: SystemUserRow, id: string, fileId: string, authorization?: string) {
    if (![id, fileId].every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value))) throw new BadRequestException("原申请或附件引用无效");
    const before = this.merchant(user), { tenantId } = before;
    const row = (await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
    if (!row) throw new NotFoundException("企业申请不存在");
    let view: EnterpriseManagementRequestView;
    try {
      view = this.view(row);
      this.validate({ ...view, submit: false });
      if (row.tenantId !== tenantId || row.id !== id || ![row.corporateCustomerId, row.applicantCustomerId].every(value => /^[a-zA-Z0-9_-]{1,191}$/u.test(value))
        || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("request binding");
    } catch { throw new ConflictException("原申请类别或附件材料不可核对"); }
    const after = this.merchant(user, view.requestType);
    if (after.tenantId !== before.tenantId || after.actor !== before.actor) throw new ForbiddenException("申请附件读取身份已变化");
    if (!view.evidenceFileIds.includes(fileId)) throw new ForbiddenException("附件不属于此申请");
    let proofFile: { orderId: string; workspaceId: string; contentHash: string } | undefined;
    if (view.requestType === "payment_proof") {
      const proof = this.storedProof(row), evidence = await this.merchantProof(user, row.applicantCustomerId, proof, authorization, undefined, "original_receipt");
      const file = evidence.files.find(file => file.id === fileId);
      if (!file) throw new ForbiddenException("原回款凭证不属于此申请");
      proofFile = { orderId: proof.orderId, workspaceId: proof.workspaceId, contentHash: file.contentHash };
    }
    return { tenantId, actor: after.actor, applicantCustomerId: row.applicantCustomerId, revision: row.revision, materialKey: JSON.stringify(view), ...(proofFile ? { proofFile, uploadScene: ENTERPRISE_PAYMENT_PROOF_SCENE } : {}) };
  }

  async customerEvidenceOwner(context: ClientRequestContext, id: string, fileId: string) {
    if (![id, fileId].every(value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value))) throw new BadRequestException("原申请或凭证引用无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='finance_request'`;
    const row = rows[0];
    if (rows.length !== 1 || enterpriseJson(row.payload).requestType !== "payment_proof") throw new NotFoundException("本人原费用回款申请不存在");
    const proof = this.storedProof(row), evidence = await this.customerProof(context, row.corporateCustomerId, proof);
    const file = evidence.files.find(file => file.id === fileId);
    if (!file) throw new ForbiddenException("原凭证不属于此申请");
    return { tenantId: context.tenantId, applicantCustomerId: context.customerId, materialKey: JSON.stringify(this.view(row)),
      orderId: proof.orderId, workspaceId: proof.workspaceId, contentHash: file.contentHash };
  }
  private merchant(user: SystemUserRow, type?: EnterpriseManagementRequestType) {
    const actor = this.commands.operator(user, "rental-os:corporate:manage");
    if (type === "credit_change" || type === "payment_proof") this.commands.operator(user, "rental-os:finance:manage");
    return actor;
  }
  async merchantList(user: SystemUserRow, authorization?: string): Promise<EnterpriseManagementRequestView[]> {
    const { tenantId } = this.merchant(user);
    const finance = user.isPlatformAdmin || user.permissions.includes("*") || user.permissions.includes("rental-os:finance:manage");
    const rows = finance
      ? await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='finance_request' ORDER BY createdAt DESC LIMIT 201`
      : await this.prisma.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND kind='finance_request' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.requestType')) IN ('profile_change','scope_change') ORDER BY createdAt DESC LIMIT 201`;
    if (rows.length > 200) throw new ConflictException("商户企业申请超出有界范围");
    this.merchant(user);
    const result: EnterpriseManagementRequestView[] = [];
    for (const row of rows) {
      const type = enterpriseJson(row.payload).requestType;
      this.merchant(user, type);
      if (type === "payment_proof") {
        if (enterpriseJson(row.payload).proposal.workspaceId !== getRequestIdentity()?.workspaceId) continue;
        try { await this.merchantProof(user, row.applicantCustomerId, this.storedProof(row), authorization, undefined, "original_receipt"); }
        catch (error) {
          if (error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException) continue;
          throw error;
        }
      }
      result.push(this.view(row));
    }
    if (result.some(row => row.requestType === "payment_proof")) await this.proofs.merchant(authorization, user, getRequestIdentity()?.workspaceId ?? "");
    this.merchant(user);
    return result;
  }
  /** Read this operator's original review only. The immutable stored request type
   * selects today's finance guard; missing type evidence fails closed, never rebases a result. */
  async readReview(user: SystemUserRow, id: string, key: string, authorization?: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,191}$/u.test(id) || typeof key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(key)) throw new BadRequestException("原商户审核申请或操作键无效");
    const before = this.merchant(user), { tenantId, actor } = before;
    const rows = await this.prisma.$queryRaw<Array<{ managementReviewKey: string; reviewResult: string | Record<string, unknown>; requestId: string | null; corporateCustomerId: string | null; applicantCustomerId?: string; requestType: EnterpriseManagementRequestType | null }>>`
      SELECT o.operationKey AS managementReviewKey,o.result AS reviewResult,w.id AS requestId,w.corporateCustomerId,w.applicantCustomerId,
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
    if (row.requestType === "payment_proof" || result.paymentProof !== undefined) {
      const proof = result.paymentProof as PaymentProofReceipt | undefined;
      if (row.requestType !== "payment_proof" || !proof || proof.corporateCustomerId !== row.corporateCustomerId || !row.applicantCustomerId) throw unavailable();
      await this.merchantProof(user, row.applicantCustomerId, proof, authorization, undefined, "original_receipt");
    }
    return { state: "committed", result: { corporateCustomerId: row.corporateCustomerId, requestType: row.requestType, id, state: result.state, revision: result.revision, effect: "review_only_no_business_change" } };
  }
  async review(user: SystemUserRow, id: string, input: ReviewEnterpriseManagementRequest, authorization?: string) {
    if (!["approve", "reject", "supplement"].includes(input.decision)) throw new BadRequestException("处理决定无效");
    const { tenantId, actor } = this.merchant(user);
    const verify = async (tx: Prisma.TransactionClient) => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
      if (!row) throw new NotFoundException("企业申请不存在");
      const type = enterpriseJson(row.payload).requestType;
      this.merchant(user, type);
      if (type === "payment_proof") await this.merchantProof(user, row.applicantCustomerId, this.storedProof(row), authorization, tx);
    };
    const result = await this.commands.execute(tenantId, actor, "management-request.review", id, input, async tx => {
      const row = (await tx.$queryRaw<Row[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND id=${id} AND kind='finance_request'`)[0];
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("申请不在审核中");
      const data = enterpriseJson(row.payload);
      if (input.decision === "approve") {
        if (data.requestType !== "payment_proof" && await this.revision(tenantId, row.corporateCustomerId, data.requestType, tx) !== data.objectRevision) throw this.commands.conflict();
        if (data.requestType === "scope_change") await assertPublishedRentalCategoryIdentities(tx, this.validate({ ...data, submit: true }).categoryCodes!);
        if (data.requestType !== "payment_proof") await this.evidence(tenantId, row.applicantCustomerId, data.evidenceFileIds, tx);
      }
      const state = input.decision === "approve" ? "approved" : input.decision === "supplement" ? "supplement_required" : "rejected";
      if (data.requestType === "payment_proof") await this.merchantProof(user, row.applicantCustomerId, this.storedProof(row), authorization, tx);
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},decisionReason=${input.reason.trim()},revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${tenantId} AND id=${id}`;
      return { id, state, revision: row.revision + 1, effect: "review_only_no_business_change" as const, ...(data.requestType === "payment_proof" ? { paymentProof: this.storedProof(row) } : {}) };
    }, verify);
    const { paymentProof: _internalProof, ...response } = result;
    return response;
  }
}
