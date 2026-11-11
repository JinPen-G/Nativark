/** New enterprise rental authority is the intersection of explicit merchant/company/member policy.
 * Historical fulfillment is separate. A policy supplies no prices, credit or deposit receipt. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isRentalCategoryCode } from "@rental-os/shared";
import type { EnterpriseBookingBasis, EnterpriseScopePolicy, EnterpriseScopePolicySaved, EnterpriseScopePolicyView, RentalBookingIdentityInput, RentalQuoteSnapshotV1, RentalOrder, EnterpriseOwnRentalPolicy, EnterpriseOperationResult, SaveEnterpriseScopePolicyRequest, SystemUserRow } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import type { ClientRequestContext } from "../client/client-auth.service";
import type { ApprovedOrderBinding } from "../rental-core/approved-order-transaction.ports";
import type { ApprovedExtensionBinding, EnterpriseExtensionPrice } from "../rental-core/approved-extension.ports";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import type { ClientOrderExtensionRequest, RentalOrderExtension } from "@rental-os/shared";
import { EnterpriseCommandService, enterpriseJson } from "./enterprise-command.service";
import { assertPublishedRentalCategoryIdentities, rentalCategoryIdentityOptions, readRentalCategoryCode } from "../rental-core/category-identity";

type PolicyRow = { scopeKey: string; revision: number; policy: string | EnterpriseScopePolicy; membershipUpdatedAt?: Date | null };
type PolicyDb = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw" | "businessWorkspace" | "customerProfile" | "customerCorporateMembership" | "rentalCategoryDefinition">;
const moneyPattern = /^\d{1,12}(?:\.\d{1,2})?$/;
@Injectable()
export class EnterprisePolicyService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly access: EnterpriseAccessService) {}

  private validate(p: EnterpriseScopePolicy) {
    const ids = (values: unknown, max: number): values is string[] => Array.isArray(values) && values.length <= max
      && new Set(values).size === values.length && values.every(id => typeof id === "string" && !!id.trim() && id.length <= 191);
    if (!p || !ids(p.workspaceIds, 200) || !ids(p.categoryCodes, 200) || p.categoryCodes.some(code => !isRentalCategoryCode(code))
      || typeof p.personalPaymentAllowed !== "boolean" || typeof p.enterprisePaymentAllowed !== "boolean"
      || !["per_order", "without_per_order", "unconfigured"].includes(p.approvalMode)
      || typeof p.noticeVersion !== "string" || !p.noticeVersion.trim() || p.noticeVersion.length > 191
      || typeof p.noticeText !== "string" || !p.noticeText.trim() || p.noticeText.length > 4000
      || (p.currency !== undefined && !/^[A-Z]{3}$/.test(p.currency))
      || (p.maxRequestAmount !== undefined && (!moneyPattern.test(p.maxRequestAmount) || !p.currency))
      || (p.approvalLifetimeMinutes !== undefined && (!Number.isInteger(p.approvalLifetimeMinutes) || p.approvalLifetimeMinutes < 1 || p.approvalLifetimeMinutes > 10080))
      || (p.approvalMode === "per_order" && p.approvalLifetimeMinutes === undefined)) {
      throw new BadRequestException("企业政策必须明确品类、空间、告知和有界审批窗口；金额须带币种及精度");
    }
  }
  private rows(tenantId: string, corporateId: string, db: PolicyDb) {
    return db.$queryRaw<PolicyRow[]>(Prisma.sql`SELECT scopeKey,revision,policy,membershipUpdatedAt FROM enterprise_scope_policies WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateId} ${db === this.prisma ? Prisma.empty : Prisma.sql`LOCK IN SHARE MODE`}`);
  }
  private decoded(row: PolicyRow) { const policy = enterpriseJson(row.policy); this.validate(policy); return policy; }
  private async company(tenantId: string, corporateId: string, db: PolicyDb) {
    const company = await db.customerProfile.findFirst({ where: { tenantId, id: corporateId, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }, select: { id: true } });
    if (!company) throw new ForbiddenException("当前企业会员不可用");
  }
  private async persist(tenantId: string, corporateId: string, scopeKey: string, input: SaveEnterpriseScopePolicyRequest, tx: Prisma.TransactionClient): Promise<EnterpriseScopePolicySaved> {
    const employeeScope = scopeKey.startsWith("member:");
    if (!employeeScope && input.expectedMembershipUpdatedAt !== undefined) throw new BadRequestException("企业或商户政策不接收员工关系修订");
    this.validate(input.policy);
    const rows = await this.rows(tenantId, corporateId, tx), prior = rows.find(r => r.scopeKey === scopeKey);
    if ((prior?.revision ?? 0) !== input.expectedRevision) throw this.commands.conflict();
    if (scopeKey === "merchant" && prior) {
      const previous = this.decoded(prior);
      if (previous.noticeText !== input.policy.noticeText && previous.noticeVersion === input.policy.noticeVersion) throw new ConflictException("企业告知正文变化须使用新的告知版本，不能复用原同意依据");
    }
    const scopes = await tx.businessWorkspace.findMany({ where: { tenantId, id: { in: input.policy.workspaceIds }, status: "ACTIVE" }, select: { id: true, categoryCode: true } });
    if (scopes.length !== input.policy.workspaceIds.length || scopes.some(scope => !input.policy.categoryCodes.includes(readRentalCategoryCode(scope.categoryCode)))) throw new ForbiddenException("政策含未开放空间或未授权品类");
    // A new policy may name published dynamic codes. The Core directory proves
    // identity existence; actual workspace adoption and rental eligibility remain separate.
    await assertPublishedRentalCategoryIdentities(tx, input.policy.categoryCodes);
    if (scopeKey !== "merchant") {
      const merchant = rows.find(r => r.scopeKey === "merchant"), company = rows.find(r => r.scopeKey === "company");
      const upperRow = scopeKey.startsWith("member:") ? company : merchant;
      if (!merchant || !upperRow) throw new ConflictException("商户和企业上限须先明确配置");
      const upper = this.decoded(upperRow), disclosure = this.decoded(merchant), p = input.policy;
      if (p.workspaceIds.some(id => !upper.workspaceIds.includes(id)) || p.categoryCodes.some(code => !upper.categoryCodes.includes(code))
        || p.enterprisePaymentAllowed && !upper.enterprisePaymentAllowed || p.personalPaymentAllowed && !upper.personalPaymentAllowed
        || p.enterprisePaymentAllowed && upper.approvalMode === "unconfigured"
        || upper.approvalMode === "per_order" && p.enterprisePaymentAllowed && p.approvalMode !== "per_order"
        || scopeKey.startsWith("member:") && p.approvalMode !== upper.approvalMode
        || p.noticeVersion !== disclosure.noticeVersion || p.noticeText !== disclosure.noticeText
        || p.maxRequestAmount !== undefined && upper.maxRequestAmount !== undefined && (p.currency !== upper.currency || new Prisma.Decimal(p.maxRequestAmount).gt(upper.maxRequestAmount))
        || p.approvalLifetimeMinutes !== undefined && upper.approvalLifetimeMinutes !== undefined && p.approvalLifetimeMinutes > upper.approvalLifetimeMinutes) {
        throw new ForbiddenException("企业/员工政策只能收窄商户上限，不能改写商户告知或放松审批");
      }
    }
    const member = employeeScope ? await tx.customerCorporateMembership.findFirst({ where: { tenantId, corporateCustomerId: corporateId, id: scopeKey.slice(7), status: "active",
      // Reuse member/admin target identity conditions, not rental qualifications.
      // A restored relation cannot bind new policy to a frozen or merged person.
      personalCustomer: { is: { tenantId, customerType: "personal", status: "active", mergedIntoCustomerId: null,
        account: { is: { status: "active" } }, membership: { is: { status: "active" } } } }
    }, select: { updatedAt: true } }) : null;
    let membershipUpdatedAt: Date | null = null;
    if (employeeScope) {
      const expected = input.expectedMembershipUpdatedAt;
      // This runs only after execute has checked the original receipt, under its
      // existing exclusive Tenant fence. A replay cannot report a new pre-write CAS refusal.
      if (typeof expected !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(expected)
        || !Number.isFinite(Date.parse(expected)) || new Date(expected).toISOString() !== expected || !member
        || !(member.updatedAt instanceof Date) || !Number.isFinite(member.updatedAt.getTime()) || member.updatedAt.toISOString() !== expected) throw this.commands.conflict();
      membershipUpdatedAt = new Date(expected);
    }
    await tx.$executeRaw`INSERT INTO enterprise_scope_policies (tenantId,corporateCustomerId,scopeKey,revision,policy,membershipUpdatedAt) VALUES (${tenantId},${corporateId},${scopeKey},${input.expectedRevision + 1},${JSON.stringify(input.policy)},${membershipUpdatedAt}) ON DUPLICATE KEY UPDATE revision=VALUES(revision),policy=VALUES(policy),membershipUpdatedAt=VALUES(membershipUpdatedAt)`;
    return { scopeKey, revision: input.expectedRevision + 1, policy: input.policy, ...(membershipUpdatedAt ? { membershipUpdatedAt: membershipUpdatedAt.toISOString() } : {}) };
  }
  async merchantSave(user: SystemUserRow, corporateId: string, input: SaveEnterpriseScopePolicyRequest) {
    const { tenantId, actor } = this.commands.operator(user, "rental-os:corporate:manage");
    return this.commands.execute(tenantId, actor, "policy.merchant", corporateId, input, async tx => {
      await this.company(tenantId, corporateId, tx);
      return this.persist(tenantId, corporateId, "merchant", input, tx);
    });
  }
  async companySave(context: ClientRequestContext, corporateId: string, input: SaveEnterpriseScopePolicyRequest, membershipId?: string) {
    if (membershipId !== undefined && (typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191)) throw new BadRequestException("员工关系引用无效");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "policy.company", `${corporateId}:${membershipId ?? "company"}`, input, async tx => {
      if (membershipId !== undefined && !await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: membershipId, corporateCustomerId: corporateId, status: "active" }, select: { id: true } })) throw this.commands.conflict();
      return this.persist(context.tenantId, corporateId, membershipId !== undefined ? `member:${membershipId}` : "company", input, tx);
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "policy:manage", tx); });
  }
  /** Receipt-first own recovery does not require today's management grant and never
   * projects current limits, member payment authority or the historical policy body. */
  async readCompanySave(context: ClientRequestContext, corporateId: string, key: string, membershipId?: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191 || typeof key !== "string" || !key.trim() || key.length > 128
      || membershipId !== undefined && (typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191)) throw new BadRequestException("原政策企业、员工或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient, scopeKey = membershipId === undefined ? "company" : `member:${membershipId}`;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | { scopeKey: string; revision: number; policy: EnterpriseScopePolicy }; scopeKey: string | null }>>`
      SELECT o.operationKey,o.result,p.scopeKey FROM enterprise_portal_operations o
      LEFT JOIN enterprise_scope_policies p ON p.tenantId=o.tenantId AND p.corporateCustomerId=${corporateId} AND p.scopeKey=${scopeKey}
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key} AND o.actorUserId=${`customer:${context.customerId}`}
        AND o.target=${`policy.company:${corporateId}:${membershipId ?? "company"}`}`;
    if (!receipts[0]) { await this.commands.customer(context, tx, false); return { state: "not_recorded" }; }
    const unavailable = () => new ConflictException("原政策保存收据或对象关联无法精确核对，保留原引用");
    let revision: number;
    try {
      const result = enterpriseJson(receipts[0].result);
      if (receipts[0].operationKey !== key || receipts[0].scopeKey !== scopeKey || !result || typeof result !== "object" || Array.isArray(result)
        || result.scopeKey !== scopeKey || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1) throw unavailable();
      this.validate(result.policy); revision = result.revision;
    } catch { throw unavailable(); }
    await this.commands.customer(context, tx, false);
    return { state: "committed", result: { corporateCustomerId: corporateId, scopeKey, revision } };
  }
  /** Operator-owned original save evidence only. Current merchant management
   * permission remains required; today's policy/body/enterprise status is not replay evidence. */
  async readMerchantSave(user: SystemUserRow, corporateId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原商户政策企业或操作键无效");
    const { tenantId, actor } = this.commands.operator(user, "rental-os:corporate:manage");
    const receipts = await this.prisma.$queryRaw<Array<{ operationKey: string; result: string | { scopeKey: string; revision: number; policy: EnterpriseScopePolicy }; scopeKey: string | null }>>`
      SELECT o.operationKey,o.result,p.scopeKey FROM enterprise_portal_operations o
      LEFT JOIN enterprise_scope_policies p ON p.tenantId=o.tenantId AND p.corporateCustomerId=${corporateId} AND p.scopeKey='merchant'
      WHERE o.tenantId=${tenantId} AND o.operationKey=${key} AND o.actorUserId=${actor} AND o.target=${`policy.merchant:${corporateId}`}`;
    if (!receipts[0]) { this.commands.operator(user, "rental-os:corporate:manage"); return { state: "not_recorded" }; }
    const unavailable = () => new ConflictException("原商户政策保存收据或对象关联无法精确核对，保留原引用");
    let revision: number;
    try {
      const result = enterpriseJson(receipts[0].result);
      if (receipts[0].operationKey !== key || receipts[0].scopeKey !== "merchant" || !result || typeof result !== "object" || Array.isArray(result)
        || result.scopeKey !== "merchant" || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1) throw unavailable();
      this.validate(result.policy); revision = result.revision;
    } catch { throw unavailable(); }
    this.commands.operator(user, "rental-os:corporate:manage");
    return { state: "committed", result: { corporateCustomerId: corporateId, scopeKey: "merchant", revision } };
  }
  private async view(tenantId: string, corporateId: string, membershipId: string | undefined, db: PolicyDb, merchantView = false): Promise<EnterpriseScopePolicyView> {
    const rows = await this.rows(tenantId, corporateId, db);
    const m = rows.find(r => r.scopeKey === "merchant"), c = rows.find(r => r.scopeKey === "company"), e = rows.find(r => r.scopeKey === `member:${membershipId}`);
    const merchant = m && this.decoded(m), company = c && this.decoded(c), employee = e && this.decoded(e);
    const effectiveCategoryCodes = merchant && company ? merchant.categoryCodes.filter(code => company.categoryCodes.includes(code) && (!employee || employee.categoryCodes.includes(code))) : [];
    const effectiveWorkspaceIds = merchant && company ? merchant.workspaceIds.filter(id => company.workspaceIds.includes(id) && (!employee || employee.workspaceIds.includes(id))) : [];
    const workspaces = await db.businessWorkspace.findMany({ where: { tenantId, status: "ACTIVE", ...(merchantView ? {} : { id: { in: merchant?.workspaceIds ?? [] } }) }, select: { id: true, name: true, categoryCode: true }, orderBy: { id: "asc" }, take: 201 });
    if (workspaces.length > 200) throw new ConflictException("空间超过当前政策编辑范围");
    const published = await rentalCategoryIdentityOptions(db, tenantId);
    const categories = merchantView ? published : published.filter(row => merchant?.categoryCodes.includes(row.code));
    if (categories.length > 200) throw new ConflictException("品类超过当前政策编辑范围");
    return { revision: merchantView ? m?.revision ?? 0 : membershipId ? e?.revision ?? 0 : c?.revision ?? 0,
      merchantRevision: m?.revision ?? 0, companyRevision: c?.revision ?? 0, employeeRevision: e?.revision ?? 0,
      merchant, company, employee, effectiveWorkspaceIds, effectiveCategoryCodes, categories, workspaces: workspaces.map(row => ({ ...row, categoryCode: readRentalCategoryCode(row.categoryCode) })) };
  }
  async merchantView(user: SystemUserRow, corporateId: string) {
    const { tenantId } = this.commands.operator(user, "rental-os:corporate:manage");
    await this.company(tenantId, corporateId, this.prisma);
    const result = await this.view(tenantId, corporateId, undefined, this.prisma, true);
    this.commands.operator(user, "rental-os:corporate:manage");
    return result;
  }
  async companyView(context: ClientRequestContext, corporateId: string, membershipId?: string) {
    const before = await this.access.requireAction(context, corporateId, "policy:manage");
    if (membershipId && !await this.prisma.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: corporateId, id: membershipId }, select: { id: true } })) throw new ForbiddenException("成员不属于当前企业");
    const result = await this.view(context.tenantId, corporateId, membershipId, this.prisma);
    const after = await this.access.requireAction(context, corporateId, "policy:manage");
    if (before.permissionRevision !== after.permissionRevision) throw new ForbiddenException("企业权限已变化");
    return result;
  }

  async ownRentalPolicies(context: ClientRequestContext): Promise<EnterpriseOwnRentalPolicy[]> {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient);
    const now = new Date();
    const relations = await this.prisma.customerCorporateMembership.findMany({ where: { tenantId: context.tenantId, personalCustomerId: context.customerId, status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], corporateCustomer: { is: { status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } } } }, include: { corporateCustomer: { select: { name: true } } }, take: 201 });
    if (relations.length > 200) throw new ConflictException("本人企业关系超过当前读取范围");
    const results: EnterpriseOwnRentalPolicy[] = [];
    for (const relation of relations) {
      const rows = await this.rows(context.tenantId, relation.corporateCustomerId, this.prisma), merchantRow = rows.find(r => r.scopeKey === "merchant");
      const policy = merchantRow && this.decoded(merchantRow);
      let personalPaymentAllowed = false, enterprisePaymentAllowed = false, approvalMode: EnterpriseScopePolicy["approvalMode"] = "unconfigured";
      let unavailableReason = "当前企业尚未配置新业务政策，请联系商户；不自动迁入旧关系";
      if (policy) {
        const base: RentalBookingIdentityInput = { bookingIdentity: "enterprise_employee", corporateCustomerId: relation.corporateCustomerId, enterpriseDisclosure: { noticeVersion: policy.noticeVersion, acknowledged: true } };
        // This read describes current eligibility only, not a user's acknowledgement.
        // Actual quotes require their own explicit disclosure from the consumer.
        try { const basis = await this.authorize(context.tenantId, context.workspaceId, context.customerId, base); personalPaymentAllowed = Boolean(basis); if (basis) approvalMode = basis.approvalMode; } catch (error) { if (error instanceof ForbiddenException || error instanceof ConflictException) unavailableReason = error.message; else throw error; }
        try { const basis = await this.authorize(context.tenantId, context.workspaceId, context.customerId, { ...base, enterpriseContractAndPayer: true }); enterprisePaymentAllowed = Boolean(basis); if (basis) approvalMode = basis.approvalMode; } catch (error) { if (!(error instanceof ForbiddenException || error instanceof ConflictException)) throw error; }
      }
      results.push({ corporateCustomerId: relation.corporateCustomerId, corporateName: relation.corporateCustomer.name, membershipId: relation.id, workspaceId: context.workspaceId,
        available: personalPaymentAllowed || enterprisePaymentAllowed, personalPaymentAllowed, enterprisePaymentAllowed, approvalMode,
        noticeVersion: policy?.noticeVersion, noticeText: policy?.noticeText, unavailableReason: personalPaymentAllowed || enterprisePaymentAllowed ? undefined : unavailableReason });
    }
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient);
    return results;
  }

  async authorize(tenantId: string, workspaceId: string, personalId: string, input: RentalBookingIdentityInput, tx?: Prisma.TransactionClient): Promise<EnterpriseBookingBasis | undefined> {
    if (input.bookingIdentity === "enterprise_employee") {
      const caller = getRequestIdentity();
      if (!caller || caller.tenantId !== tenantId || caller.isSaasAdmin || caller.staffApi || caller.userId !== personalId || caller.dataScope !== undefined) throw new ForbiddenException("商户代客企业委托接点尚未核验，不能代使用人声明告知或企业付费授权");
    }
    return this.evaluate(tenantId, workspaceId, personalId, input, tx);
  }
  /** Internal recheck consumes the persisted originating quote, never a new
   * reviewer/operator acknowledgement on behalf of its applicant. */
  async revalidateQuote(tenantId: string, workspaceId: string, quote: RentalQuoteSnapshotV1, tx: Prisma.TransactionClient) {
    if (quote.tenantId !== tenantId || !quote.membershipSnapshot?.enterpriseBasis || !quote.request.bookingIdentity) throw new ForbiddenException("原报价企业告知依据缺失");
    return this.evaluate(tenantId, workspaceId, quote.membershipSnapshot.personalCustomerId, quote.request.bookingIdentity, tx);
  }
  private async evaluate(tenantId: string, workspaceId: string, personalId: string, input: RentalBookingIdentityInput, tx?: Prisma.TransactionClient): Promise<EnterpriseBookingBasis | undefined> {
    if (input.bookingIdentity !== "enterprise_employee" || !input.corporateCustomerId) return undefined;
    const db: PolicyDb = tx ?? this.prisma;
    const portals = await db.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`SELECT enabled FROM enterprise_corporate_portals WHERE tenantId=${tenantId} AND corporateCustomerId=${input.corporateCustomerId} ${tx ? Prisma.sql`LOCK IN SHARE MODE` : Prisma.empty}`);
    const rows = await this.rows(tenantId, input.corporateCustomerId, db);
    // Presence is the durable migration marker. Disabling a previously configured
    // portal must never restore legacy, less restrictive business behavior.
    if (!portals.length && !rows.length) return undefined;
    if (!portals[0]?.enabled) throw new ForbiddenException("企业新业务入口已关闭");
    const tenants = await db.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`SELECT enabled FROM enterprise_portal_tenant_settings WHERE tenantId=${tenantId} ${tx ? Prisma.sql`LOCK IN SHARE MODE` : Prisma.empty}`);
    if (!tenants[0]?.enabled) throw new ForbiddenException("企业新业务入口已关闭");
    const now = new Date();
    const relations = await db.$queryRaw<Array<{ id: string; updatedAt: Date }>>(Prisma.sql`SELECT r.id,r.updatedAt FROM customer_corporate_memberships r JOIN customer_profiles p ON p.tenantId=r.tenantId AND p.id=r.personalCustomerId AND p.customerType='personal' AND p.status='active' AND p.mergedIntoCustomerId IS NULL JOIN customer_accounts a ON a.tenantId=p.tenantId AND a.customerId=p.id AND a.status='active' JOIN customer_memberships pm ON pm.tenantId=p.tenantId AND pm.customerId=p.id AND pm.status='active' JOIN customer_profiles c ON c.tenantId=r.tenantId AND c.id=r.corporateCustomerId AND c.customerType='corporate' AND c.status='active' AND c.mergedIntoCustomerId IS NULL JOIN customer_memberships cm ON cm.tenantId=c.tenantId AND cm.customerId=c.id AND cm.status='active' WHERE r.tenantId=${tenantId} AND r.corporateCustomerId=${input.corporateCustomerId} AND r.personalCustomerId=${personalId} AND r.status='active' AND r.effectiveFrom<=${now} AND (r.effectiveTo IS NULL OR r.effectiveTo>${now}) ${tx ? Prisma.sql`LOCK IN SHARE MODE` : Prisma.empty}`);
    const relation = relations[0];
    if (!relation) throw new ForbiddenException("当前个人会员、企业会员或关系不可用");
    const m = rows.find(r => r.scopeKey === "merchant"), c = rows.find(r => r.scopeKey === "company"), e = rows.find(r => r.scopeKey === `member:${relation.id}`);
    if (!m || !c) throw new ForbiddenException("商户和企业使用政策尚未明确");
    const merchant = this.decoded(m), company = this.decoded(c), employee = e && this.decoded(e);
    const workspaces = await db.$queryRaw<Array<{ categoryCode: string }>>(Prisma.sql`SELECT categoryCode FROM business_workspaces WHERE tenantId=${tenantId} AND id=${workspaceId} AND status='ACTIVE' ${tx ? Prisma.sql`LOCK IN SHARE MODE` : Prisma.empty}`);
    const workspace = workspaces[0];
    const policies = [merchant, company, ...(employee ? [employee] : [])];
    if (!workspace || policies.some(p => !p.workspaceIds.includes(workspaceId) || !p.categoryCodes.includes(readRentalCategoryCode(workspace.categoryCode)))) throw new ForbiddenException("不在当前企业品类和空间交集内");
    if (e && (!e.membershipUpdatedAt || e.membershipUpdatedAt.getTime() !== relation.updatedAt.getTime())) throw new ForbiddenException("员工关系已变化，须重新显式核验并授权员工政策");
    const paying = Boolean(input.enterpriseContractAndPayer);
    if (paying && (!employee || policies.some(p => !p.enterprisePaymentAllowed || p.approvalMode === "unconfigured"))) throw new ForbiddenException("员工未获明确企业付费权");
    if (!paying && policies.some(p => !p.personalPaymentAllowed)) throw new ForbiddenException("企业优惠个人付款不可用");
    if (company.noticeVersion !== merchant.noticeVersion || company.noticeText !== merchant.noticeText
      || employee && (employee.noticeVersion !== merchant.noticeVersion || employee.noticeText !== merchant.noticeText)
      || !input.enterpriseDisclosure?.acknowledged || input.enterpriseDisclosure.noticeVersion !== merchant.noticeVersion) throw new ForbiddenException("须本人确认当前商户批准的企业订单可见性告知");
    const approvalMode = paying && policies.some(p => p.approvalMode === "per_order") ? "per_order" : company.approvalMode;
    return { merchantRevision: m.revision, companyRevision: c.revision, employeeRevision: e?.revision ?? 0,
      membershipUpdatedAt: relation.updatedAt.toISOString(), noticeVersion: merchant.noticeVersion, acknowledgedAt: now.toISOString(), guaranteePayer: "enterprise", approvalMode };
  }
  async assertOrderCreation(tenantId: string, workspaceId: string, quote: RentalQuoteSnapshotV1, tx: Prisma.TransactionClient, binding?: Readonly<ApprovedOrderBinding>) {
    const snapshot = quote.membershipSnapshot;
    if (snapshot?.bookingIdentity !== "enterprise_employee") return;
    // All ECP policy/member writes take this same tenant lock. The authoritative
    // read belongs before stock locking and persists until the order commits.
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' FOR UPDATE`;
    const current = snapshot.enterpriseBasis ? await this.revalidateQuote(tenantId, workspaceId, quote, tx) : await this.evaluate(tenantId, workspaceId, snapshot.personalCustomerId, quote.request.bookingIdentity!, tx);
    this.assertSameBasis(snapshot.enterpriseBasis, current);
    if (!current) return;
    await this.assertQuoteAmount(tenantId, snapshot.corporateCustomerId!, snapshot.corporateMembershipId!, quote, tx);
    if (snapshot.enterpriseContractAndPayer && current.approvalMode === "per_order") {
      if (!binding) throw new ConflictException("逐单企业付费必须从原批准提交，不能以普通建单绕过批准");
      const approvals = await tx.$queryRaw<Array<{ approvedBy: string; reviewerMembershipId: string; reviewerMembershipUpdatedAt: Date }>>`SELECT approvedBy,reviewerMembershipId,reviewerMembershipUpdatedAt FROM enterprise_booking_approvals WHERE tenantId=${tenantId} AND workspaceId=${workspaceId} AND quoteId=${quote.id} AND corporateCustomerId=${snapshot.corporateCustomerId} AND applicantCustomerId=${snapshot.personalCustomerId} AND state='executing' AND executionKey=${binding.idempotencyKey} AND requestFingerprint=${binding.requestFingerprint} AND expiresAt>NOW(3)`;
      const approval = approvals[0];
      if (!approval) throw new ForbiddenException("原企业批准与提交指纹不匹配或已失效");
      await this.assertReviewer(tenantId, snapshot.corporateCustomerId!, snapshot.personalCustomerId, approval.approvedBy, approval.reviewerMembershipId, approval.reviewerMembershipUpdatedAt, tx);
    }
  }
  async assertOrderAction(tenantId: string, workspaceId: string, order: RentalOrder, tx: Prisma.TransactionClient | undefined, additionalAmount?: number) {
    const snapshot = order.membershipSnapshot;
    if (snapshot?.bookingIdentity !== "enterprise_employee") return;
    if (!tx) throw new ConflictException("企业新支出需要原业务事务，不能以非事务入口执行");
    // Ordinary expense transactions share the parent fence; never upgrade a
    // shared lock acquired by their transaction entry into an exclusive lock.
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' LOCK IN SHARE MODE`;
    const current = await this.evaluate(tenantId, workspaceId, snapshot.personalCustomerId, {
      bookingIdentity: snapshot.bookingIdentity, corporateCustomerId: snapshot.corporateCustomerId,
      enterpriseContractAndPayer: snapshot.enterpriseContractAndPayer,
      enterpriseDisclosure: snapshot.enterpriseBasis ? { noticeVersion: snapshot.enterpriseBasis.noticeVersion, acknowledged: true } : undefined
    }, tx);
    if (!current) return;
    if (additionalAmount === undefined) this.assertSameBasis(snapshot.enterpriseBasis, current);
    if (snapshot.enterpriseContractAndPayer && current.approvalMode === "per_order") {
      if (additionalAmount !== undefined) throw new ConflictException("新增企业支出的变更批准尚未接通，原订单批准不能重复使用");
      const approvals = await tx.$queryRaw<Array<{ approvedBy: string; reviewerMembershipId: string; reviewerMembershipUpdatedAt: Date }>>`SELECT approvedBy,reviewerMembershipId,reviewerMembershipUpdatedAt FROM enterprise_booking_approvals WHERE tenantId=${tenantId} AND workspaceId=${workspaceId} AND corporateCustomerId=${snapshot.corporateCustomerId} AND applicantCustomerId=${snapshot.personalCustomerId} AND orderId=${order.id} AND state='consumed' AND expiresAt>NOW(3)`;
      const approval = approvals[0];
      if (!approval) throw new ConflictException("订单缺少原子消费的企业批准");
      await this.assertReviewer(tenantId, snapshot.corporateCustomerId!, snapshot.personalCustomerId, approval.approvedBy, approval.reviewerMembershipId, approval.reviewerMembershipUpdatedAt, tx);
    }
    await this.assertQuoteAmount(tenantId, snapshot.corporateCustomerId!, snapshot.corporateMembershipId!, { currency: order.currency, payableAmount: additionalAmount ?? order.payableAmount } as RentalQuoteSnapshotV1, tx);
  }
  /** Exact single-use expense authorization. Neither HTTP fields nor an original
   * booking approval satisfy this gate. The caller holds the original order lock. */
  async assertExtensionAction(tenantId: string, workspaceId: string, order: RentalOrder, priced: EnterpriseExtensionPrice | RentalOrderExtension,
    tx: Prisma.TransactionClient, binding?: ApprovedExtensionBinding) {
    const snapshot = order.membershipSnapshot;
    if (snapshot?.bookingIdentity !== "enterprise_employee") return;
    await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' LOCK IN SHARE MODE`;
    if (!snapshot.enterpriseContractAndPayer) { await this.assertOrderAction(tenantId, workspaceId, order, tx, priced.payableAmount); return; }
    const current = await this.revalidateOrderExpense(tenantId, workspaceId, order, tx);
    if (!current) return;
    await this.assertQuoteAmount(tenantId, snapshot.corporateCustomerId!, snapshot.corporateMembershipId!, priced, tx);
    const rows = await tx.$queryRaw<Array<{ id: string; state: string; basis: EnterpriseBookingBasis | string; expiresAt: Date; expectedOrderUpdatedAt: string;
      requestFingerprint: string; previewFingerprint: string; request: ClientOrderExtensionRequest | string; preview: EnterpriseExtensionPrice | string;
      extensionId: string | null; executionKey: string | null; approvedBy: string | null; reviewerMembershipId: string | null; reviewerMembershipUpdatedAt: Date | null }>>(Prisma.sql`
      SELECT * FROM enterprise_extension_approvals WHERE tenantId=${tenantId} AND workspaceId=${workspaceId} AND orderId=${order.id}
        AND corporateCustomerId=${snapshot.corporateCustomerId} AND applicantCustomerId=${snapshot.personalCustomerId}
        ${binding ? Prisma.sql`AND id=${binding.approvalId}` : Prisma.sql`AND extensionId=${"id" in priced ? priced.id : null}`} FOR UPDATE`);
    const row = rows[0];
    // An existing expense authorization never disappears after a policy switch.
    // Unbound legacy/waived extensions need no invented approval record.
    if (!row && !binding && current.approvalMode !== "per_order") return;
    if (!row || row.expiresAt <= new Date()) throw new ConflictException("续租缺少有效的原变更批准");
    this.assertSameBasis(enterpriseJson(row.basis), current);
    const original = enterpriseJson(row.preview), request = enterpriseJson(row.request);
    if (row.requestFingerprint !== requestFingerprint({ orderId: order.id, extension: request, expectedOrderUpdatedAt: row.expectedOrderUpdatedAt })
      || row.previewFingerprint !== requestFingerprint(original)) throw new ConflictException("原续租批准快照指纹不一致");
    if (binding) {
      if (row.state !== "approved" || row.extensionId || row.executionKey || order.updatedAt !== row.expectedOrderUpdatedAt
        || binding.expectedOrderUpdatedAt !== row.expectedOrderUpdatedAt || binding.requestFingerprint !== row.requestFingerprint
        || binding.previewFingerprint !== row.previewFingerprint || requestFingerprint(priced) !== row.previewFingerprint) throw new ForbiddenException("续租批准与原业务提交不匹配");
    } else {
      if (!("id" in priced) || row.state !== "consumed" || row.extensionId !== priced.id || row.executionKey !== priced.idempotencyKey
        || original.originalEndAt !== priced.originalEndAt || original.newEndAt !== priced.newEndAt || original.payableAmount !== priced.payableAmount
        || original.depositDelta !== priced.depositDelta || original.preAuthDelta !== priced.preAuthDelta || original.currency !== priced.currency
        || requestFingerprint({ billableUnits: original.billableUnits, rentalAmount: original.rentalAmount, serviceAmount: original.serviceAmount, rateSnapshot: original.rateSnapshot,
          ruleSnapshot: original.ruleSnapshot, ruleVersion: original.ruleVersion, priceVersion: original.priceVersion, priceVersionId: original.priceVersionId,
          calendarSnapshot: original.calendarSnapshot, serviceSnapshots: original.serviceSnapshots, pricingSnapshot: original.pricingSnapshot, executionBasis: original.executionBasis })
          !== requestFingerprint({ billableUnits: priced.billableUnits, rentalAmount: priced.rentalAmount, serviceAmount: priced.serviceAmount, rateSnapshot: priced.rateSnapshot,
            ruleSnapshot: priced.ruleSnapshot, ruleVersion: priced.ruleVersion, priceVersion: priced.priceVersion, priceVersionId: priced.priceVersionId,
            calendarSnapshot: priced.calendarSnapshot, serviceSnapshots: priced.serviceSnapshots, pricingSnapshot: priced.pricingSnapshot, executionBasis: priced.executionBasis })) throw new ForbiddenException("原续租补款与批准消费关联不一致");
    }
    await this.assertReviewer(tenantId, snapshot.corporateCustomerId!, snapshot.personalCustomerId, row.approvedBy, row.reviewerMembershipId, row.reviewerMembershipUpdatedAt, tx);
    return { request, preview: original };
  }
  async assertReviewer(tenantId: string, corporateId: string, applicantId: string, reviewerId: string | null, membershipId: string | null, updatedAt: Date | null, tx: Prisma.TransactionClient) {
    if (!reviewerId || reviewerId === applicantId || !membershipId || !updatedAt) throw new ForbiddenException("审批人依据缺失或存在自审");
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m.id FROM customer_corporate_memberships m JOIN customer_profiles p ON p.tenantId=m.tenantId AND p.id=m.personalCustomerId AND p.status='active' AND p.mergedIntoCustomerId IS NULL JOIN customer_accounts a ON a.tenantId=p.tenantId AND a.customerId=p.id AND a.status='active' JOIN customer_memberships c ON c.tenantId=p.tenantId AND c.customerId=p.id AND c.status='active' JOIN enterprise_portal_grants g ON g.tenantId=m.tenantId AND g.corporateCustomerId=m.corporateCustomerId AND g.membershipId=m.id AND g.membershipUpdatedAt=m.updatedAt AND g.action='approvals:review' JOIN enterprise_portal_grants entry ON entry.tenantId=m.tenantId AND entry.corporateCustomerId=m.corporateCustomerId AND entry.membershipId=m.id AND entry.membershipUpdatedAt=m.updatedAt AND entry.action='portal:enter' WHERE m.tenantId=${tenantId} AND m.corporateCustomerId=${corporateId} AND m.personalCustomerId=${reviewerId} AND m.id=${membershipId} AND m.updatedAt=${updatedAt} AND m.role='admin' AND m.status='active' AND m.effectiveFrom<=NOW(3) AND (m.effectiveTo IS NULL OR m.effectiveTo>NOW(3)) LOCK IN SHARE MODE`;
    if (!rows.length) throw new ForbiddenException("原审批人资格或审批动作已撤销，须重新批准");
  }
  assertSameBasis(before: EnterpriseBookingBasis | undefined, after: EnterpriseBookingBasis | undefined) {
    const comparable = (basis?: EnterpriseBookingBasis) => basis ? { ...basis, acknowledgedAt: undefined } : undefined;
    if (JSON.stringify(comparable(before)) !== JSON.stringify(comparable(after))) throw new ConflictException("企业关系、政策或告知已变化，请重新报价并取得批准");
  }
  /** Review window is explicitly configured by the same intersected policies. */
  async approvalLifetime(tenantId: string, corporateId: string, membershipId: string, tx: Prisma.TransactionClient) {
    const rows = await this.rows(tenantId, corporateId, tx);
    const lifetimes = rows.filter(row => ["merchant", "company", `member:${membershipId}`].includes(row.scopeKey))
      .map(row => this.decoded(row).approvalLifetimeMinutes).filter((value): value is number => Number.isInteger(value) && Number(value) > 0);
    if (!lifetimes.length) throw new ConflictException("审批窗口尚未配置");
    return Math.min(...lifetimes);
  }
  /** Rechecks the original order's subjects/disclosure against current new-spend
   * authority. This does not rewrite historical order authorization. */
  async revalidateOrderExpense(tenantId: string, workspaceId: string, order: RentalOrder, tx: Prisma.TransactionClient) {
    const snapshot = order.membershipSnapshot;
    if (order.tenantId !== tenantId || snapshot?.bookingIdentity !== "enterprise_employee"
      || !snapshot.enterpriseContractAndPayer || !snapshot.corporateCustomerId || !snapshot.corporateMembershipId) throw new ForbiddenException("原企业订单付款或告知依据缺失");
    return this.evaluate(tenantId, workspaceId, snapshot.personalCustomerId, { bookingIdentity: "enterprise_employee", corporateCustomerId: snapshot.corporateCustomerId,
      enterpriseContractAndPayer: true, enterpriseDisclosure: snapshot.enterpriseBasis ? { noticeVersion: snapshot.enterpriseBasis.noticeVersion, acknowledged: true } : undefined }, tx);
  }
  async assertQuoteAmount(tenantId: string, corporateId: string, membershipId: string, quote: { currency?: string; payableAmount: number }, db: PolicyDb) {
    if (!quote.currency || !Number.isFinite(quote.payableAmount) || quote.payableAmount < 0) throw new ConflictException("原报价金额或币种不可核对");
    const rows = await this.rows(tenantId, corporateId, db);
    for (const row of rows.filter(r => ["merchant", "company", `member:${membershipId}`].includes(r.scopeKey))) {
      const policy = this.decoded(row);
      if (policy.maxRequestAmount !== undefined && (policy.currency !== quote.currency || new Prisma.Decimal(quote.payableAmount).gt(policy.maxRequestAmount))) throw new ForbiddenException("报价租赁应付超过当前企业单笔金额上限或币种不匹配；押金和预授权另列");
    }
  }
}
