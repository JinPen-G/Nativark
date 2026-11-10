/** Invitation admission, member lifecycle and accepted admin transfer.
 * Original relationships are retained; no personal accounts, orders or funds are changed. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes, randomUUID } from "node:crypto";
import { ENTERPRISE_PORTAL_ACTIONS, type ChangeEnterpriseAdministratorRequest } from "@rental-os/shared";
import type { ChangeEnterpriseMemberRequest, CreateEnterpriseInviteRequest, DecideEnterpriseTransferRequest, EnterpriseChangeRequest, EnterpriseInviteCreated, EnterpriseInvitePolicy, EnterpriseInviteView, JoinEnterpriseRequest, ReviewEnterpriseJoinRequest, SaveEnterpriseInvitePolicyRequest, SystemUserRow, TransferEnterpriseAdministratorRequest } from "@rental-os/shared";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { EnterpriseCommandService, enterpriseHash, enterpriseJson } from "./enterprise-command.service";
import { assertOtherEnterpriseAdministrator } from "./enterprise-administrator-continuity";
type Invite = { id: string; corporateCustomerId: string; status: "active" | "revoked"; revision: number; expiresAt: Date; maxUses: number; used: number; createdAt: Date };
type Workflow = { id: string; applicantCustomerId: string; corporateCustomerId: string; kind: string; state: string; revision: number; payload: string | Record<string, unknown>; createdAt: Date; updatedAt: Date; decisionReason?: string };
@Injectable()
export class EnterpriseMembersService {
  constructor(private readonly prisma: PrismaService, private readonly commands: EnterpriseCommandService, private readonly access: EnterpriseAccessService, private readonly customers: SharedCustomerRepository) {}
  private inviteView(row: Invite): EnterpriseInviteView { return { ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString() }; }
  private async policy(tenantId: string, tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<Array<{ revision: number; policy: string | EnterpriseInvitePolicy }>>`SELECT revision,policy FROM enterprise_invite_policies WHERE tenantId=${tenantId}`;
    if (!rows[0]) throw new ConflictException({ code: "enterprise_invite_policy_unconfigured", message: "商户尚未配置邀请期限、限额和告知条款" });
    return { revision: rows[0].revision, policy: enterpriseJson(rows[0].policy) };
  }
  async savePolicy(user: SystemUserRow, input: SaveEnterpriseInvitePolicyRequest) {
    const { tenantId, actor } = this.commands.operator(user, "rental-os:corporate:manage"), p = input.policy;
    if (!p || !p.agreementVersion?.trim() || !p.noticeText?.trim() || p.noticeText.length > 4000 || !Number.isInteger(p.maxLifetimeHours) || p.maxLifetimeHours < 1 || p.maxLifetimeHours > 8760 || !Number.isInteger(p.maxUses) || p.maxUses < 1 || p.maxUses > 1000 || !Number.isInteger(p.guessesPerWindow) || p.guessesPerWindow < 1 || p.guessesPerWindow > 100 || !Number.isInteger(p.windowSeconds) || p.windowSeconds < 60 || p.windowSeconds > 86400) throw new BadRequestException("邀请配置必须有界且明确");
    return this.commands.execute(tenantId, actor, "invite-policy.save", "tenant", input, async tx => {
      const rows = await tx.$queryRaw<Array<{ revision: number; policy: string | EnterpriseInvitePolicy }>>`SELECT revision,policy FROM enterprise_invite_policies WHERE tenantId=${tenantId}`;
      if ((rows[0]?.revision ?? 0) !== input.expectedRevision) throw this.commands.conflict();
      const previous = rows[0] && enterpriseJson(rows[0].policy);
      if (previous && previous.noticeText !== p.noticeText && previous.agreementVersion === p.agreementVersion) throw new ConflictException("告知正文变化须使用新的协议版本，不能复用原同意依据");
      await tx.$executeRaw`INSERT INTO enterprise_invite_policies (tenantId,revision,policy) VALUES (${tenantId},${input.expectedRevision + 1},${JSON.stringify(p)}) ON DUPLICATE KEY UPDATE revision=VALUES(revision),policy=VALUES(policy)`;
      return { revision: input.expectedRevision + 1, policy: p };
    });
  }
  async merchantPolicy(user: SystemUserRow) { const { tenantId } = this.commands.operator(user, "rental-os:corporate:manage"); return this.policy(tenantId, this.prisma as unknown as Prisma.TransactionClient); }
  async invites(context: ClientRequestContext, corporateId: string) {
    await this.access.requireAction(context, corporateId, "invites:manage");
    const rows = await this.prisma.$queryRaw<Invite[]>`SELECT id,corporateCustomerId,status,revision,expiresAt,maxUses,used,createdAt FROM enterprise_invites WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} ORDER BY createdAt DESC LIMIT 201`;
    await this.access.requireAction(context, corporateId, "invites:manage");
    if (rows.length > 200) throw new ConflictException("邀请记录超出当前有界读取范围");
    return rows.map(r => this.inviteView(r));
  }
  async createInvite(context: ClientRequestContext, corporateId: string, input: CreateEnterpriseInviteRequest): Promise<EnterpriseInviteCreated> {
    let code: string | undefined;
    const result = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "invite.create", corporateId, input, async tx => {
      const { policy } = await this.policy(context.tenantId, tx);
      if (!policy.noticeText?.trim()) throw new ConflictException("商户加入告知尚未配置，不能生成新的邀请");
      if (input.expectedRevision !== 0 || !Number.isInteger(input.lifetimeHours) || input.lifetimeHours < 1 || input.lifetimeHours > policy.maxLifetimeHours || !Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > policy.maxUses) throw new BadRequestException("邀请期限或次数超出商户配置");
      code = randomBytes(32).toString("base64url"); const id = randomUUID(), expires = new Date(Date.now() + input.lifetimeHours * 3600000);
      await tx.$executeRaw`INSERT INTO enterprise_invites (tenantId,id,corporateCustomerId,tokenHash,expiresAt,maxUses) VALUES (${context.tenantId},${id},${corporateId},${enterpriseHash(code)},${expires},${input.maxUses})`;
      const invite: EnterpriseInviteView = { id, corporateCustomerId: corporateId, status: "active", revision: 1, expiresAt: expires.toISOString(), maxUses: input.maxUses, used: 0, createdAt: new Date().toISOString() };
      // Raw code is returned once, never stored in the replay receipt or audit.
      return { invite, codeRetrievableAgain: false as const };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "invites:manage", tx); });
    return { ...result, code };
  }
  private async finishJoin(tx: Prisma.TransactionClient, tenantId: string, row: Workflow, state: "rejected" | "withdrawn", reason: string, source: string) {
    const payload = enterpriseJson(row.payload);
    const history = Array.isArray(payload.decisionHistory) ? payload.decisionHistory : [];
    const updatedAt = new Date();
    const nextPayload = { ...payload, decisionHistory: [...history, { revision: row.revision, state, reason, source, at: updatedAt.toISOString() }] };
    // Release only after the pending row actually becomes terminal in this same transaction.
    // This is a local admission fact, never an inference about an external operation's TTL.
    const changed = await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},revision=revision+1,decisionReason=${reason},payload=${JSON.stringify(nextPayload)},updatedAt=NOW(3) WHERE tenantId=${tenantId} AND id=${row.id} AND state='pending' AND revision=${row.revision}`;
    if (changed !== 1) throw this.commands.conflict();
    await tx.$executeRaw`UPDATE enterprise_invites SET used=GREATEST(0,used-1) WHERE tenantId=${tenantId} AND id=${String(payload.inviteId)} AND corporateCustomerId=${row.corporateCustomerId}`;
    return { ...row, state, revision: row.revision + 1, decisionReason: reason, payload: nextPayload, updatedAt };
  }
  private async invalidateInvite(tx: Prisma.TransactionClient, tenantId: string, invite: Invite, reason: string, source: string) {
    const pending = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${tenantId} AND corporateCustomerId=${invite.corporateCustomerId} AND kind='join_request' AND state='pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.inviteId'))=${invite.id}`;
    for (const row of pending) await this.finishJoin(tx, tenantId, row, "rejected", reason, source);
  }
  private async currentJoin(tx: Prisma.TransactionClient, tenantId: string, row: Workflow) {
    if (row.kind !== "join_request" || row.state !== "pending") return row;
    const payload = enterpriseJson(row.payload);
    const invites = await tx.$queryRaw<Invite[]>`SELECT * FROM enterprise_invites WHERE tenantId=${tenantId} AND id=${String(payload.inviteId)} AND corporateCustomerId=${row.corporateCustomerId}`;
    const invite = invites[0];
    if (!invite || invite.status !== "active" || invite.expiresAt <= new Date()) return this.finishJoin(tx, tenantId, row, "rejected", invite?.status === "revoked" ? "邀请已撤销，加入申请失效" : "邀请已到期或不存在，加入申请失效", "invite.invalidate");
    return row;
  }
  async revokeInvite(context: ClientRequestContext, corporateId: string, id: string, input: EnterpriseChangeRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "invite.revoke", id, input, async tx => {
      const rows = await tx.$queryRaw<Invite[]>`SELECT * FROM enterprise_invites WHERE tenantId=${context.tenantId} AND id=${id} AND corporateCustomerId=${corporateId}`;
      if (!rows[0]) throw new NotFoundException("邀请不存在");
      if (rows[0].revision !== input.expectedRevision) throw this.commands.conflict();
      await tx.$executeRaw`UPDATE enterprise_invites SET status='revoked',revision=revision+1 WHERE tenantId=${context.tenantId} AND id=${id}`;
      await this.invalidateInvite(tx, context.tenantId, rows[0], input.reason.trim(), "invite.revoke");
      return { id, status: "revoked", revision: input.expectedRevision + 1 };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "invites:manage", tx); });
  }
  async previewInvite(context: ClientRequestContext, inviteCode: string) {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(inviteCode)) throw new BadRequestException("邀请格式无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const { policy } = await this.policy(context.tenantId, this.prisma as unknown as Prisma.TransactionClient);
    if (!policy.noticeText?.trim()) throw new ConflictException("商户尚未配置加入邀请告知正文，不能以默认文案代替");
    const bucket = new Date(Math.floor(Date.now() / (policy.windowSeconds * 1000)) * policy.windowSeconds * 1000);
    const scope = enterpriseHash(["enterprise-invite-guess", context.tenantId, context.customerId]);
    await this.prisma.$executeRaw`INSERT INTO client_api_rate_buckets (id,scopeKey,bucketStart,count,createdAt,updatedAt) VALUES (${randomUUID()},${scope},${bucket},1,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE count=count+1,updatedAt=NOW(3)`;
    const counts = await this.prisma.$queryRaw<Array<{ count: number }>>`SELECT count FROM client_api_rate_buckets WHERE scopeKey=${scope} AND bucketStart=${bucket}`;
    if (Number(counts[0]?.count ?? 0) > policy.guessesPerWindow) throw new ForbiddenException("邀请尝试超出商户限额");
    const rows = await this.prisma.$queryRaw<Array<{ corporateName: string; expiresAt: Date }>>`
      SELECT c.corporateName,i.expiresAt FROM enterprise_invites i
      JOIN customer_profiles c ON c.tenantId=i.tenantId AND c.id=i.corporateCustomerId AND c.customerType='corporate' AND c.status='active' AND c.mergedIntoCustomerId IS NULL
      JOIN customer_memberships m ON m.tenantId=c.tenantId AND m.customerId=c.id AND m.status='active'
      JOIN enterprise_corporate_portals p ON p.tenantId=i.tenantId AND p.corporateCustomerId=i.corporateCustomerId AND p.enabled=true
      JOIN enterprise_portal_tenant_settings t ON t.tenantId=i.tenantId AND t.enabled=true
      WHERE i.tenantId=${context.tenantId} AND i.tokenHash=${enterpriseHash(inviteCode)} AND i.status='active' AND i.expiresAt>NOW(3)`;
    if (!rows[0]?.corporateName) throw new ForbiddenException("邀请不可用");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return { corporateName: rows[0].corporateName, expiresAt: rows[0].expiresAt.toISOString(), agreementVersion: policy.agreementVersion,
      noticeText: policy.noticeText, noticeHash: enterpriseHash({ agreementVersion: policy.agreementVersion, noticeText: policy.noticeText }), semantics: "join_request_only" as const };
  }
  async join(context: ClientRequestContext, input: JoinEnterpriseRequest) {
    if (!input.acknowledged || !/^[A-Za-z0-9_-]{43}$/u.test(input.inviteCode) || !/^[a-f0-9]{64}$/u.test(input.noticeHash) || input.expectedRevision !== 0) throw new BadRequestException("须本人确认邀请和企业身份告知");
    // Hash the secret before dispatch fingerprinting so the original code never enters storage.
    const safe = { ...input, inviteCode: enterpriseHash(input.inviteCode) };
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const configured = await this.policy(context.tenantId, this.prisma as unknown as Prisma.TransactionClient);
    const bucket = new Date(Math.floor(Date.now() / (configured.policy.windowSeconds * 1000)) * configured.policy.windowSeconds * 1000);
    const scope = enterpriseHash(["enterprise-invite-guess", context.tenantId, context.customerId]);
    // Charge guesses independently: a refused/invalid invite must not roll the rate counter back.
    await this.prisma.$executeRaw`INSERT INTO client_api_rate_buckets (id,scopeKey,bucketStart,count,createdAt,updatedAt) VALUES (${randomUUID()},${scope},${bucket},1,NOW(3),NOW(3)) ON DUPLICATE KEY UPDATE count=count+1,updatedAt=NOW(3)`;
    const counts = await this.prisma.$queryRaw<Array<{ count: number }>>`SELECT count FROM client_api_rate_buckets WHERE scopeKey=${scope} AND bucketStart=${bucket}`;
    if (Number(counts[0]?.count ?? 0) > configured.policy.guessesPerWindow) throw new ForbiddenException("邀请尝试超出商户限额");
    const result = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "join.submit", "self", safe, async tx => {
      const rows = await tx.$queryRaw<Invite[]>`SELECT * FROM enterprise_invites WHERE tenantId=${context.tenantId} AND tokenHash=${safe.inviteCode}`;
      const invite = rows[0];
      if (!invite) throw new ForbiddenException("邀请不可用");
      if (invite.status !== "active" || invite.expiresAt <= new Date()) {
        await this.invalidateInvite(tx, context.tenantId, invite, invite.status === "revoked" ? "邀请已撤销，加入申请失效" : "邀请已到期，加入申请失效", "invite.invalidate");
        return { state: "invite_unavailable" };
      }
      const portals = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.corporateCustomerId AS id FROM enterprise_corporate_portals p JOIN enterprise_portal_tenant_settings t ON t.tenantId=p.tenantId AND t.enabled=true JOIN customer_profiles c ON c.tenantId=p.tenantId AND c.id=p.corporateCustomerId AND c.customerType='corporate' AND c.status='active' AND c.mergedIntoCustomerId IS NULL JOIN customer_memberships m ON m.tenantId=c.tenantId AND m.customerId=c.id AND m.status='active' WHERE p.tenantId=${context.tenantId} AND p.corporateCustomerId=${invite.corporateCustomerId} AND p.enabled=true`;
      if (!portals.length) throw new ForbiddenException("企业入口已停用");
      const relation = await tx.customerCorporateMembership.findUnique({ where: { tenantId_corporateCustomerId_personalCustomerId: { tenantId: context.tenantId, corporateCustomerId: invite.corporateCustomerId, personalCustomerId: context.customerId } } });
      const now = new Date();
      if (relation?.status === "active" && relation.effectiveFrom <= now && (!relation.effectiveTo || relation.effectiveTo > now)) return { membershipId: relation.id, state: "already_member" };
      const existing = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND corporateCustomerId=${invite.corporateCustomerId} AND kind='join_request' AND state='pending' ORDER BY createdAt,id`;
      for (const row of existing) {
        const current = await this.currentJoin(tx, context.tenantId, row);
        if (current.state === "pending") return { id: current.id, revision: current.revision, state: "pending" };
      }
      const { policy } = await this.policy(context.tenantId, tx);
      if (!policy.noticeText?.trim() || input.agreementVersion !== policy.agreementVersion
        || input.noticeHash !== enterpriseHash({ agreementVersion: policy.agreementVersion, noticeText: policy.noticeText })) return { state: "agreement_unavailable" };
      // Full invites may still read the caller's original relation/request; only new admission consumes a use.
      if (invite.used >= invite.maxUses) return { state: "invite_unavailable" };
      const id = randomUUID();
      await tx.$executeRaw`UPDATE enterprise_invites SET used=used+1 WHERE tenantId=${context.tenantId} AND id=${invite.id}`;
      const payload = JSON.stringify({ inviteId: invite.id, agreementVersion: input.agreementVersion, noticeHash: input.noticeHash, noticeText: policy.noticeText, acknowledgedAt: new Date().toISOString(), department: input.department?.trim(), employeeNo: input.employeeNo?.trim() });
      await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,payload) VALUES (${context.tenantId},${id},'join_request',${context.customerId},${invite.corporateCustomerId},'pending',${payload})`;
      return { id, revision: 1, state: "pending" };
    }, tx => this.commands.customer(context, tx, false));
    // Reject after commit: throwing inside apply would undo the persisted expiry decisions.
    if (result.state === "invite_unavailable") throw new ForbiddenException("邀请不可用");
    if (result.state === "agreement_unavailable") throw new ConflictException("告知版本已更新");
    return result;
  }
  async joinRequests(context: ClientRequestContext, corporateId?: string) {
    const rows = await this.prisma.$transaction(async tx => {
      const tenant = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${context.tenantId} AND status='ACTIVE' FOR UPDATE`;
      if (!tenant.length) throw new ForbiddenException("商户不可用");
      await this.commands.customer(context, tx, false);
      if (corporateId) await this.access.requireAction(context, corporateId, "members:manage", tx);
      const requests = corporateId
        ? await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND kind='join_request' ORDER BY createdAt DESC LIMIT 201`
        : await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND applicantCustomerId=${context.customerId} AND kind IN ('join_request','administrator_transfer') ORDER BY createdAt DESC LIMIT 201`;
      if (requests.length > 200) throw new ConflictException("申请记录超出当前有界读取范围");
      const current: Workflow[] = [];
      for (const row of requests) current.push(await this.currentJoin(tx, context.tenantId, row));
      await this.commands.customer(context, tx, false);
      if (corporateId) await this.access.requireAction(context, corporateId, "members:manage", tx);
      return current;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return rows.map(row => ({ id: row.id, kind: row.kind, state: row.state, revision: row.revision, applicantCustomerId: row.applicantCustomerId, corporateCustomerId: row.corporateCustomerId ?? undefined,
      payload: enterpriseJson(row.payload), decisionReason: row.decisionReason ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }
  async ownRelations(context: ClientRequestContext) {
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.customerCorporateMembership.findMany({ where: { tenantId: context.tenantId, personalCustomerId: context.customerId }, take: 201,
      select: { id: true, corporateCustomerId: true, role: true, status: true, department: true, employeeNo: true, updatedAt: true, effectiveFrom: true, effectiveTo: true,
        corporateCustomer: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    if (rows.length > 200) throw new ConflictException("本人企业关系超出有界读取范围");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    return rows.map(row => ({ membershipId: row.id, corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateCustomer.name,
      displayName: context.displayName, role: row.role, status: row.status, department: row.department ?? undefined, employeeNo: row.employeeNo ?? undefined,
      updatedAt: row.updatedAt.toISOString(), effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() }));
  }
  async withdrawJoin(context: ClientRequestContext, id: string, input: EnterpriseChangeRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "join.withdraw", id, input, async tx => {
      const rows = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='join_request'`;
      const row = rows[0]; if (!row) throw new NotFoundException("本人加入申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("加入申请已处理");
      await this.finishJoin(tx, context.tenantId, row, "withdrawn", input.reason.trim(), "join.withdraw");
      return { id, state: "withdrawn", revision: input.expectedRevision + 1 };
    }, tx => this.commands.customer(context, tx, false));
  }
  async decideJoin(context: ClientRequestContext, corporateId: string, id: string, input: ReviewEnterpriseJoinRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "join.review", id, input, async tx => {
      const rows = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND corporateCustomerId=${corporateId} AND kind='join_request'`;
      const row = rows[0]; if (!row) throw new NotFoundException("加入申请不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("加入申请已处理");
      const current = await this.currentJoin(tx, context.tenantId, row);
      if (current.state !== "pending") return { id, state: current.state, revision: current.revision };
      const payload = enterpriseJson(row.payload);
      if (input.decision === "approve") {
        const personal = await tx.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: row.applicantCustomerId, customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } }, select: { id: true } });
        if (!personal) throw new ConflictException("个人会员尚未激活");
        const currentPolicy = await this.policy(context.tenantId, tx);
        if (!currentPolicy.policy.noticeText?.trim() || payload.agreementVersion !== currentPolicy.policy.agreementVersion
          || payload.noticeHash !== enterpriseHash({ agreementVersion: currentPolicy.policy.agreementVersion, noticeText: currentPolicy.policy.noticeText })) throw new ConflictException("原加入告知已失效，须本人重新申请");
        const existing = await tx.customerCorporateMembership.findUnique({ where: { tenantId_corporateCustomerId_personalCustomerId: { tenantId: context.tenantId, corporateCustomerId: corporateId, personalCustomerId: personal.id } } });
        if (existing?.status === "active" && (!existing.effectiveTo || existing.effectiveTo > new Date())) throw new ConflictException("成员关系已由其他操作激活，请先核对原关系；不能降级或覆盖");
        await this.customers.saveEnterpriseRelation(context.tenantId, corporateId, personal.id, { role: "employee", status: "active", department: String(payload.department ?? "") || null, employeeNo: String(payload.employeeNo ?? "") || null, effectiveFrom: new Date(), effectiveTo: null, reason: input.reason, createdBy: context.customerId }, tx);
      } else {
        await this.finishJoin(tx, context.tenantId, row, "rejected", input.reason.trim(), "join.review");
        return { id, state: "rejected", revision: row.revision + 1 };
      }
      const state = "approved";
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},revision=revision+1,decisionReason=${input.reason},updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state, revision: input.expectedRevision + 1 };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "members:manage", tx); });
  }
  async changeMember(context: ClientRequestContext, corporateId: string, membershipId: string, input: ChangeEnterpriseMemberRequest, self = false) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, self ? "member.exit" : "member.change", membershipId, input, async tx => {
      const row = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: membershipId, corporateCustomerId: corporateId } });
      if (!row || (self && row.personalCustomerId !== context.customerId)) throw new NotFoundException("关系不存在");
      if (!self && row.role === "admin") await this.access.requireAction(context, corporateId, "administrators:manage", tx);
      if (row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw this.commands.conflict();
      if (self && input.status !== "exited") throw new ForbiddenException("本人只能申请退出自己的关系");
      const effectiveTo = input.status === "exited" ? new Date() : input.effectiveTo ? new Date(input.effectiveTo) : null;
      if (effectiveTo && !Number.isFinite(effectiveTo.getTime())) throw new BadRequestException("关系有效期无效");
      // Every relationship update invalidates its old grants, even a department edit.
      // This entry never regrants authority, so another currently authorized admin must remain.
      if (row.role === "admin") await assertOtherEnterpriseAdministrator(tx, context.tenantId, corporateId, membershipId);
      if (input.status === "active") {
        const personal = await tx.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: row.personalCustomerId, status: "active", membership: { is: { status: "active" } }, account: { is: { status: "active" } } }, select: { id: true } });
        if (!personal) throw new ConflictException("个人会员不可恢复");
      }
      const result = await this.customers.saveEnterpriseRelation(context.tenantId, corporateId, row.personalCustomerId, { role: row.role, status: input.status, department: self ? row.department : input.department?.trim() ?? row.department, employeeNo: self ? row.employeeNo : input.employeeNo?.trim() ?? row.employeeNo, effectiveFrom: row.effectiveFrom, effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
      return { membershipId, status: result.status, updatedAt: result.updatedAt.toISOString() };
    }, async tx => { await this.commands.customer(context, tx, !self); if (!self) await this.access.requireAction(context, corporateId, "members:manage", tx); });
  }
  async administrator(context: ClientRequestContext, corporateId: string, membershipId: string) {
    const before = await this.access.requireAction(context, corporateId, "administrators:manage");
    await this.access.requireAction(context, corporateId, "members:manage");
    const row = await this.prisma.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: corporateId, id: membershipId }, select: { id: true, role: true, updatedAt: true } });
    if (!row) throw new NotFoundException("企业成员不存在");
    const grants = await this.prisma.$queryRaw<Array<{ action: string }>>`SELECT action FROM enterprise_portal_grants WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND membershipId=${membershipId} AND membershipUpdatedAt=${row.updatedAt}`;
    const portal = await this.prisma.$queryRaw<Array<{ revision: number }>>`SELECT revision FROM enterprise_corporate_portals WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId}`;
    const after = await this.access.requireAction(context, corporateId, "administrators:manage");
    await this.access.requireAction(context, corporateId, "members:manage");
    if (before.permissionRevision !== after.permissionRevision || !portal[0]) throw new ConflictException("企业管理授权已变化");
    return { membershipId, role: row.role, updatedAt: row.updatedAt.toISOString(), revision: portal[0].revision,
      actions: row.role === "admin" ? ENTERPRISE_PORTAL_ACTIONS.filter(action => grants.some(grant => grant.action === action)) : [] };
  }
  async changeAdministrator(context: ClientRequestContext, corporateId: string, membershipId: string, input: ChangeEnterpriseAdministratorRequest) {
    if (!["admin", "employee"].includes(input.role) || !Array.isArray(input.actions) || new Set(input.actions).size !== input.actions.length
      || input.actions.some(action => !ENTERPRISE_PORTAL_ACTIONS.includes(action)) || (input.role === "employee" && input.actions.length > 0)
      || (input.actions.length > 0 && !input.actions.includes("portal:enter"))) throw new BadRequestException("管理员角色及动作授权必须有效，员工不能持有管理授权");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.change", membershipId, input, async tx => {
      const actor = await this.access.requireAction(context, corporateId, "administrators:manage", tx);
      if (input.actions.some(action => !actor.actions.includes(action))) throw new ForbiddenException("不能授予自己不具有的管理动作");
      const portals = await tx.$queryRaw<Array<{ revision: number }>>`SELECT revision FROM enterprise_corporate_portals WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId}`;
      if (portals[0]?.revision !== input.expectedRevision) throw this.commands.conflict();
      const row = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: corporateId, id: membershipId,
        status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        personalCustomer: { is: { tenantId: context.tenantId, customerType: "personal", status: "active", mergedIntoCustomerId: null,
          account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
      if (!row || row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw this.commands.conflict();
      if (row.role === "admin" && (input.role !== "admin" || !input.actions.includes("administrators:manage"))) {
        await assertOtherEnterpriseAdministrator(tx, context.tenantId, corporateId, membershipId);
      }
      // Relationship revision invalidates older rental policies and grants; only
      // these explicitly reviewed management actions are rebound to the new revision.
      const updated = await this.customers.saveEnterpriseRelation(context.tenantId, corporateId, row.personalCustomerId,
        { role: input.role, status: row.status, department: row.department, employeeNo: row.employeeNo, effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
      await tx.$executeRaw`DELETE FROM enterprise_portal_grants WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId} AND membershipId=${membershipId}`;
      for (const action of input.actions) await tx.$executeRaw`INSERT INTO enterprise_portal_grants (tenantId,corporateCustomerId,membershipId,action,membershipUpdatedAt) VALUES (${context.tenantId},${corporateId},${membershipId},${action},${updated.updatedAt})`;
      await tx.$executeRaw`UPDATE enterprise_corporate_portals SET revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND corporateCustomerId=${corporateId}`;
      return { membershipId, role: updated.role, actions: input.actions, updatedAt: updated.updatedAt.toISOString(), revision: input.expectedRevision + 1 };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "members:manage", tx); await this.access.requireAction(context, corporateId, "administrators:manage", tx); });
  }
  async transfer(context: ClientRequestContext, corporateId: string, input: TransferEnterpriseAdministratorRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.transfer", corporateId, input, async tx => {
      const target = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: input.targetMembershipId, corporateCustomerId: corporateId, status: "active", personalCustomerId: { not: context.customerId }, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
      if (!target || input.expectedRevision !== 0) throw new ConflictException("交接目标必须为本企业另一有效成员");
      const id = randomUUID(), payload = JSON.stringify({ fromCustomerId: context.customerId, targetMembershipId: target.id });
      await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,payload) VALUES (${context.tenantId},${id},'administrator_transfer',${target.personalCustomerId},${corporateId},'pending',${payload})`;
      return { id, state: "pending", revision: 1 };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "administrators:manage", tx); });
  }
  async acceptTransfer(context: ClientRequestContext, id: string, input: DecideEnterpriseTransferRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.accept", id, input, async tx => {
      const rows = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='administrator_transfer'`;
      const row = rows[0]; if (!row) throw new NotFoundException("本人交接请求不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("交接已处理");
      const payload = enterpriseJson(row.payload);
      if (input.accept) {
        const from = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: row.corporateCustomerId, personalCustomerId: String(payload.fromCustomerId), role: "admin", status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
        const target = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: row.corporateCustomerId, id: String(payload.targetMembershipId), personalCustomerId: context.customerId, status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
        if (!from || !target) throw new ConflictException("交接双方关系已变化");
        const tenant = await tx.$queryRaw<Array<{ enabled: boolean }>>`SELECT enabled FROM enterprise_portal_tenant_settings WHERE tenantId=${context.tenantId}`;
        const company = await tx.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: row.corporateCustomerId, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }, select: { id: true } });
        if (!tenant[0]?.enabled || !company) throw new ForbiddenException("企业入口或企业会员已停用");
        const grants = await tx.$queryRaw<Array<{ action: string }>>`SELECT g.action FROM enterprise_portal_grants g JOIN enterprise_corporate_portals p ON p.tenantId=g.tenantId AND p.corporateCustomerId=g.corporateCustomerId AND p.enabled=true WHERE g.tenantId=${context.tenantId} AND g.corporateCustomerId=${row.corporateCustomerId} AND g.membershipId=${from.id} AND g.membershipUpdatedAt=${from.updatedAt}`;
        if (!grants.some(g => g.action === "portal:enter") || !grants.some(g => g.action === "administrators:manage")) throw new ForbiddenException("交出方管理员授权已撤销");
        const promoted = await this.customers.saveEnterpriseRelation(context.tenantId, row.corporateCustomerId, context.customerId, { role: "admin", status: "active", department: target.department, employeeNo: target.employeeNo, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
        await tx.$executeRaw`DELETE FROM enterprise_portal_grants WHERE tenantId=${context.tenantId} AND corporateCustomerId=${row.corporateCustomerId} AND membershipId=${promoted.id}`;
        for (const grant of grants) await tx.$executeRaw`INSERT INTO enterprise_portal_grants (tenantId,corporateCustomerId,membershipId,action,membershipUpdatedAt) VALUES (${context.tenantId},${row.corporateCustomerId},${promoted.id},${grant.action},${promoted.updatedAt}) ON DUPLICATE KEY UPDATE membershipUpdatedAt=VALUES(membershipUpdatedAt)`;
        // Prove the target can currently manage (including expiry/account/member/grant
        // revision) before removing the outgoing admin. A failed check rolls all changes back.
        await this.access.requireAction(context, row.corporateCustomerId, "administrators:manage", tx);
        await this.customers.saveEnterpriseRelation(context.tenantId, row.corporateCustomerId, from.personalCustomerId, { role: "employee", status: "active", department: from.department, employeeNo: from.employeeNo, effectiveFrom: from.effectiveFrom, effectiveTo: from.effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
        await tx.$executeRaw`UPDATE enterprise_corporate_portals SET revision=revision+1,updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND corporateCustomerId=${row.corporateCustomerId}`;
      }
      const state = input.accept ? "approved" : "rejected";
      await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state=${state},revision=revision+1,decisionReason=${input.reason},updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id}`;
      return { id, state, revision: input.expectedRevision + 1 };
    }, tx => this.commands.customer(context, tx));
  }
}
