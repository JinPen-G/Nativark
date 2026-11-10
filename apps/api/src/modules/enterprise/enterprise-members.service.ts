/** Invitation admission, member lifecycle and accepted admin transfer.
 * Original relationships are retained; no personal accounts, orders or funds are changed. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isISO8601 } from "class-validator";
import { randomBytes, randomUUID } from "node:crypto";
import { ENTERPRISE_PORTAL_ACTIONS, enterpriseTransferDecisionResolutionMatches, type ChangeEnterpriseAdministratorRequest, type CloseEnterpriseTransferDecisionRequest, type EnterpriseTransferDecisionResolution } from "@rental-os/shared";
import type { ChangeEnterpriseMemberRequest, CreateEnterpriseInviteRequest, DecideEnterpriseTransferRequest, EnterpriseChangeRequest, EnterpriseInviteCreated, EnterpriseInvitePolicy, EnterpriseInviteView, EnterpriseOperationResult, JoinEnterpriseRequest, ReviewEnterpriseJoinRequest, SaveEnterpriseInvitePolicyRequest, SystemUserRow, TransferEnterpriseAdministratorRequest } from "@rental-os/shared";
import type { ClientRequestContext } from "../client/client-auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { SharedCustomerRepository } from "../platform/shared-customer.repository";
import { EnterpriseCommandService, enterpriseHash, enterpriseJson } from "./enterprise-command.service";
import { assertOtherEnterpriseAdministrator } from "./enterprise-administrator-continuity";
type Invite = { id: string; corporateCustomerId: string; status: "active" | "revoked"; revision: number; expiresAt: Date; maxUses: number; used: number; createdAt: Date };
type Workflow = { id: string; applicantCustomerId: string; corporateCustomerId: string; kind: string; state: string; revision: number; payload: string | Record<string, unknown>; createdAt: Date; updatedAt: Date; decisionReason?: string };
/** Persisted server-side handoff basis, not a caller-supplied grant or new login credential. */
type TransferAuthorityBasis = { version: 1; fromMembershipId: string; fromUpdatedAt: string; targetUpdatedAt: string;
  permissionRevision: string; actions: Array<typeof ENTERPRISE_PORTAL_ACTIONS[number]> };
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
  /** Only the creator's original creation facts are recoverable. The raw code was
   * returned once outside the receipt transaction and cannot be recreated here. */
  async readInviteCreation(context: ClientRequestContext, corporateId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原邀请企业或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | Record<string, unknown> }>>`SELECT operationKey,result
      FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key}
        AND actorUserId=${`customer:${context.customerId}`} AND target=${`invite.create:${corporateId}`}`;
    if (!receipts[0]) { await this.commands.customer(context, tx, false); return { state: "not_recorded" }; }
    const unavailable = () => new ConflictException("原邀请创建收据或企业关联无法精确核对，保留原引用");
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(receipts[0].result);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    const invite = result.invite as Partial<EnterpriseInviteView> | null;
    const utc = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    if (receipts[0].operationKey !== key || result.codeRetrievableAgain !== false || "code" in result
      || !invite || typeof invite !== "object" || Array.isArray(invite) || typeof invite.id !== "string" || !invite.id.trim() || invite.id.length > 191
      || invite.corporateCustomerId !== corporateId || invite.status !== "active" || invite.revision !== 1 || invite.used !== 0
      || typeof invite.maxUses !== "number" || !Number.isSafeInteger(invite.maxUses) || invite.maxUses < 1
      || !utc(invite.createdAt) || !utc(invite.expiresAt) || Date.parse(invite.expiresAt) <= Date.parse(invite.createdAt)) throw unavailable();
    // Link through this receipt's immutable invite ID. Current status/count/expiry
    // and today's policy do not substitute for creation or recover the original code.
    const rows = await tx.$queryRaw<Array<{ id: string; corporateCustomerId: string }>>`SELECT id,corporateCustomerId FROM enterprise_invites
      WHERE tenantId=${context.tenantId} AND id=${invite.id} AND corporateCustomerId=${corporateId}`;
    if (!rows[0] || rows[0].id !== invite.id || rows[0].corporateCustomerId !== corporateId) throw unavailable();
    await this.commands.customer(context, tx, false);
    return { state: "committed", result: { invite: { id: invite.id, corporateCustomerId: corporateId, status: "active", revision: 1,
      expiresAt: invite.expiresAt, maxUses: invite.maxUses, used: 0, createdAt: invite.createdAt }, codeRetrievableAgain: false } };
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
  /** Original revocation receipt only; today's revoked state/expiry is not proof
   * of this actor's K and never permits another revoke or member removal. */
  async readInviteRevocation(context: ClientRequestContext, corporateId: string, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof id !== "string" || !id.trim() || id.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原邀请停用企业、对象或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ inviteId: string | null; revokeKey: string; revokeResult: string | Record<string, unknown> }>>`
      SELECT i.id AS inviteId,o.operationKey AS revokeKey,o.result AS revokeResult
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_invites i ON i.tenantId=o.tenantId AND i.id=${id} AND i.corporateCustomerId=${corporateId}
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`invite.revoke:${id}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原邀请停用收据缺少精确企业、对象或修订，保留原引用");
    if (row.inviteId !== id || row.revokeKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.revokeResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || result.status !== "revoked" || typeof result.revision !== "number"
      || !Number.isSafeInteger(result.revision) || result.revision < 2 || "code" in result) throw unavailable();
    // Project no raw code, hash, current counters/state, requests or member PII.
    return { state: "committed", result: { id, status: "revoked", revision: result.revision } };
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
      await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,payload,updatedAt) VALUES (${context.tenantId},${id},'join_request',${context.customerId},${invite.corporateCustomerId},'pending',${payload},NOW(3))`;
      return { id, revision: 1, state: "pending" };
    }, tx => this.commands.customer(context, tx, false));
    // Reject after commit: throwing inside apply would undo the persisted expiry decisions.
    if (result.state === "invite_unavailable") throw new ForbiddenException("邀请不可用");
    if (result.state === "agreement_unavailable") throw new ConflictException("告知版本已更新");
    return result;
  }
  /** Original join.submit:self only. A retained rejection is not admission, and an old relation is not today's authority. */
  async readJoinSubmission(context: ClientRequestContext, key: string): Promise<EnterpriseOperationResult> {
    if (typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原加入提交操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ submissionKey: string; submissionResult: string | Record<string, unknown> }>>`SELECT operationKey AS submissionKey,result AS submissionResult
      FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key}
        AND actorUserId=${`customer:${context.customerId}`} AND target=${"join.submit:self"}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原加入提交收据缺少精确本人、结果或原对象，保留原引用");
    if (row.submissionKey !== key) throw unavailable();
    let value: Record<string, unknown>;
    try {
      const parsed = enterpriseJson(row.submissionResult);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "code" in parsed || "inviteCode" in parsed) throw unavailable();
      value = parsed;
    } catch { throw unavailable(); }
    const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,191}$/u.test(value);
    let result: Record<string, unknown>;
    if (value.state === "pending" && id(value.id) && typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 1) {
      const requests = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId}
        AND id=${value.id} AND applicantCustomerId=${context.customerId} AND kind='join_request'`;
      if (requests[0]?.id !== value.id) throw unavailable();
      result = { id: value.id, state: "pending", revision: value.revision };
    } else if (value.state === "already_member" && id(value.membershipId)) {
      const relation = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: value.membershipId, personalCustomerId: context.customerId }, select: { id: true } });
      if (relation?.id !== value.membershipId) throw unavailable();
      result = { membershipId: value.membershipId, state: "already_member" };
    } else if (value.state === "invite_unavailable" || value.state === "agreement_unavailable") {
      // These refusals were persisted by the original transaction before its HTTP error. Do not retry or infer membership.
      result = { state: value.state };
    } else throw unavailable();
    await this.commands.customer(context, tx, false);
    return { state: "committed", result };
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
  /** Receipt-first own withdrawal: today's request/relationship state is not evidence of the original K. */
  async readJoinWithdrawal(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !id.trim() || id.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原加入申请或撤回操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ requestId: string | null; withdrawalKey: string; withdrawalResult: string | Record<string, unknown> }>>`
      SELECT w.id AS requestId,o.operationKey AS withdrawalKey,o.result AS withdrawalResult
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id}
        AND w.kind='join_request' AND w.applicantCustomerId=${context.customerId}
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`join.withdraw:${id}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原加入申请撤回收据缺少精确本人、对象或修订，保留原引用");
    if (row.requestId !== id || row.withdrawalKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.withdrawalResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || result.state !== "withdrawn" || typeof result.revision !== "number"
      || !Number.isSafeInteger(result.revision) || result.revision < 2) throw unavailable();
    return { state: "committed", result: { id, state: "withdrawn", revision: result.revision } };
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
  /** The reviewer owns this receipt; the applicant and today's grants cannot substitute for its actor/K. */
  async readJoinReview(context: ClientRequestContext, corporateId: string, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof id !== "string" || !id.trim() || id.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原加入审核企业、申请或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ requestId: string | null; reviewKey: string; reviewResult: string | Record<string, unknown> }>>`
      SELECT w.id AS requestId,o.operationKey AS reviewKey,o.result AS reviewResult
      FROM enterprise_portal_operations o
      LEFT JOIN enterprise_workflow_requests w ON w.tenantId=o.tenantId AND w.id=${id}
        AND w.corporateCustomerId=${corporateId} AND w.kind='join_request'
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`join.review:${id}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原加入审核收据缺少精确企业、申请或修订，保留原引用");
    if (row.requestId !== id || row.reviewKey !== key) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.reviewResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (result.id !== id || typeof result.state !== "string" || !["approved", "rejected"].includes(result.state)
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2) throw unavailable();
    return { state: "committed", result: { id, state: result.state, revision: result.revision } };
  }
  async changeMember(context: ClientRequestContext, corporateId: string, membershipId: string, input: ChangeEnterpriseMemberRequest, self = false) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, self ? "member.exit" : "member.change", membershipId, input, async tx => {
      const row = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: membershipId, corporateCustomerId: corporateId } });
      if (!row || (self && row.personalCustomerId !== context.customerId)) throw new NotFoundException("关系不存在");
      if (!self && row.role === "admin") await this.access.requireAction(context, corporateId, "administrators:manage", tx);
      if (row.updatedAt.toISOString() !== input.expectedUpdatedAt) throw this.commands.conflict();
      if (self && input.status !== "exited") throw new ForbiddenException("本人只能申请退出自己的关系");
      if (!["active", "suspended", "exited"].includes(input.status)) throw new BadRequestException("关系状态无效");
      if (input.status !== "exited" && input.effectiveTo !== undefined && input.effectiveTo !== null && (typeof input.effectiveTo !== "string" || !isISO8601(input.effectiveTo, { strict: true }))) throw new BadRequestException("关系有效期无效");
      const effectiveTo = input.status === "exited" ? new Date() : input.effectiveTo ? new Date(input.effectiveTo) : null;
      if (effectiveTo && !Number.isFinite(effectiveTo.getTime())) throw new BadRequestException("关系有效期无效");
      // Match the original merchant relation rule. Explicit exit still ends a
      // future-start relationship immediately; it must not be trapped until start.
      if (input.status !== "exited" && effectiveTo && effectiveTo < row.effectiveFrom) throw new BadRequestException("关系失效时间不能早于生效时间");
      // Every relationship update invalidates its old grants, even a department edit.
      // This entry never regrants authority, so another currently authorized admin must remain.
      if (row.role === "admin") await assertOtherEnterpriseAdministrator(tx, context.tenantId, corporateId, membershipId);
      if (input.status === "active") {
        const personal = await tx.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: row.personalCustomerId, customerType: "personal", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } }, account: { is: { status: "active" } } }, select: { id: true } });
        // This eligibility refusal is proven before save/receipt mutation. The
        // original client may retire only this failed attempt, refresh and review;
        // authorization, SQL or post-write failures remain unknown and keep their key.
        if (!personal) throw new ConflictException({ message: "个人会员不可恢复", code: "enterprise_revision_conflict" });
      }
      const result = await this.customers.saveEnterpriseRelation(context.tenantId, corporateId, row.personalCustomerId, { role: row.role, status: input.status, department: self ? row.department : input.department?.trim() ?? row.department, employeeNo: self ? row.employeeNo : input.employeeNo?.trim() ?? row.employeeNo, effectiveFrom: row.effectiveFrom, effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
      return { membershipId, status: result.status, updatedAt: result.updatedAt.toISOString() };
    }, async tx => {
      await this.commands.customer(context, tx, !self);
      if (self) {
        // Receipt replay bypasses apply; recheck the route's original owner/company
        // here too. A former member needs no current portal grant to read/replay an
        // established own exit, but cannot use its key against another enterprise.
        const original = await tx.customerCorporateMembership.findFirst({ where: {
          tenantId: context.tenantId, id: membershipId, corporateCustomerId: corporateId, personalCustomerId: context.customerId
        }, select: { id: true } });
        if (!original) throw new NotFoundException("本人企业关系不存在");
      } else await this.access.requireAction(context, corporateId, "members:manage", tx);
    });
  }
  /** Read this actor's original member-change receipt, never today's relation
   * fields. Receipt-first lookup avoids exposing member existence without an owned K. */
  async readMemberChange(context: ClientRequestContext, corporateId: string, membershipId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原成员变更企业、关系或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ membershipId: string | null; changeKey: string; changeResult: string | Record<string, unknown> }>>`
      SELECT m.id AS membershipId,o.operationKey AS changeKey,o.result AS changeResult
      FROM enterprise_portal_operations o
      LEFT JOIN customer_corporate_memberships m ON m.tenantId=o.tenantId AND m.id=${membershipId} AND m.corporateCustomerId=${corporateId}
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`member.change:${membershipId}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原成员变更收据缺少精确企业、关系或修订，保留原引用");
    if (row.changeKey !== key || row.membershipId !== membershipId) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.changeResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    const updatedAt = result.updatedAt;
    if (result.membershipId !== membershipId || typeof result.status !== "string" || !["active", "suspended", "exited"].includes(result.status)
      || typeof updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)
      || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) throw unavailable();
    // Only the original command result is owned by this actor. No target PII,
    // current state, grants or policies are read or repaired by recovery.
    return { state: "committed", result: { membershipId, status: result.status, updatedAt } };
  }
  /** Exact own exit evidence survives later relationship edits/rejoining. Neither a
   * current exited state nor a missing key proves this original command committed. */
  async readMemberExit(context: ClientRequestContext, corporateId: string, membershipId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原退出企业、关系或操作键无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; exitKey: string | null; exitResult: string | Record<string, unknown> | null }>>`
      SELECT m.id,o.operationKey AS exitKey,o.result AS exitResult
      FROM customer_corporate_memberships m
      LEFT JOIN enterprise_portal_operations o ON o.tenantId=m.tenantId AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`member.exit:${membershipId}`}
      WHERE m.tenantId=${context.tenantId} AND m.corporateCustomerId=${corporateId}
        AND m.id=${membershipId} AND m.personalCustomerId=${context.customerId}`;
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = rows[0];
    if (!row) throw new NotFoundException("本人企业关系不存在");
    if (row.id !== membershipId) throw new ConflictException("原退出关系证据不一致");
    if (!row.exitKey) return { state: "not_recorded" };
    let result: Record<string, unknown>;
    try {
      const raw = enterpriseJson(row.exitResult);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid exit result");
      result = raw;
    } catch { throw new ConflictException("原退出收据不可读取，保留原引用"); }
    const updatedAt = result.updatedAt;
    if (row.exitKey !== key || result.membershipId !== membershipId || result.status !== "exited"
      || typeof updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)
      || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) {
      throw new ConflictException("原退出收据缺少精确关系、状态或修订，保留原引用");
    }
    // Project only the persisted exit, not today's relation state or private command input.
    return { state: "committed", result: { membershipId, status: "exited", updatedAt } };
  }
  /** Original administrator-change result belongs to its actor, not today's grants.
   * Receipt-first lookup does not expose member existence without an owned K. */
  async readAdministratorChange(context: ClientRequestContext, corporateId: string, membershipId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof membershipId !== "string" || !membershipId.trim() || membershipId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原管理员变更企业、关系或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const rows = await tx.$queryRaw<Array<{ membershipId: string | null; adminKey: string; adminResult: string | Record<string, unknown> }>>`
      SELECT m.id AS membershipId,o.operationKey AS adminKey,o.result AS adminResult
      FROM enterprise_portal_operations o
      LEFT JOIN customer_corporate_memberships m ON m.tenantId=o.tenantId AND m.id=${membershipId} AND m.corporateCustomerId=${corporateId}
      WHERE o.tenantId=${context.tenantId} AND o.operationKey=${key}
        AND o.actorUserId=${`customer:${context.customerId}`} AND o.target=${`administrator.change:${membershipId}`}`;
    await this.commands.customer(context, tx, false);
    const row = rows[0];
    if (!row) return { state: "not_recorded" };
    const unavailable = () => new ConflictException("原管理员变更收据缺少精确关系、动作或修订，保留原引用");
    if (row.adminKey !== key || row.membershipId !== membershipId) throw unavailable();
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(row.adminResult);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    const updatedAt = result.updatedAt, actions = result.actions;
    if (result.membershipId !== membershipId || typeof result.role !== "string" || !["admin", "employee"].includes(result.role)
      || !Array.isArray(actions) || actions.length > ENTERPRISE_PORTAL_ACTIONS.length || new Set(actions).size !== actions.length
      || actions.some(action => typeof action !== "string" || !ENTERPRISE_PORTAL_ACTIONS.some(registered => registered === action))
      || result.role === "employee" && actions.length > 0 || actions.length > 0 && !actions.includes("portal:enter")
      || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 1
      || typeof updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(updatedAt)
      || !Number.isFinite(Date.parse(updatedAt)) || new Date(updatedAt).toISOString() !== updatedAt) throw unavailable();
    // Preserve the original registered action set; never replace it with today's
    // grants, write grants, or restore rental/payment authority during recovery.
    return { state: "committed", result: { membershipId, role: result.role, actions: [...actions], updatedAt, revision: result.revision } };
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
  /** Use only before any relationship/grant mutation: the original client recognizes
   * this named refusal, releases this failed attempt and never replays it automatically. */
  private transferBasisRefusal(message: string) {
    return new ConflictException({ message, code: "enterprise_revision_conflict" });
  }
  private transferAuthorityBasis(payload: Record<string, unknown>): TransferAuthorityBasis {
    const basis = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload.authorityBasis : undefined) as Partial<TransferAuthorityBasis> | undefined;
    if (!basis || typeof basis !== "object" || Array.isArray(basis) || basis.version !== 1
      || typeof basis.fromMembershipId !== "string" || !basis.fromMembershipId
      || typeof basis.fromUpdatedAt !== "string" || !Number.isFinite(Date.parse(basis.fromUpdatedAt))
      || typeof basis.targetUpdatedAt !== "string" || !Number.isFinite(Date.parse(basis.targetUpdatedAt))
      || typeof basis.permissionRevision !== "string" || !/^\d+:\d+$/.test(basis.permissionRevision)
      || !Array.isArray(basis.actions) || basis.actions.length > ENTERPRISE_PORTAL_ACTIONS.length
      || new Set(basis.actions).size !== basis.actions.length || basis.actions.some(action => !ENTERPRISE_PORTAL_ACTIONS.includes(action))
      || !basis.actions.includes("portal:enter") || !basis.actions.includes("administrators:manage")) {
      throw this.transferBasisRefusal("原交接关系或授权修订依据缺失，不能接受旧请求");
    }
    return basis as TransferAuthorityBasis;
  }
  async transfer(context: ClientRequestContext, corporateId: string, input: TransferEnterpriseAdministratorRequest) {
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.transfer", corporateId, input, async tx => {
      const target = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, id: input.targetMembershipId, corporateCustomerId: corporateId, status: "active", personalCustomerId: { not: context.customerId }, effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
      if (!target || input.expectedRevision !== 0) throw new ConflictException("交接目标必须为本企业另一有效成员");
      const actor = await this.access.requireAction(context, corporateId, "administrators:manage", tx);
      const from = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: corporateId,
        id: actor.membershipId, personalCustomerId: context.customerId, role: "admin", status: "active" }, select: { id: true, updatedAt: true } });
      if (!from) throw this.commands.conflict();
      // Capture trusted current originals, not a caller's proposed grant. Accepting
      // later must not inherit a new relationship revision or a changed action set.
      const authorityBasis: TransferAuthorityBasis = { version: 1, fromMembershipId: from.id, fromUpdatedAt: from.updatedAt.toISOString(),
        targetUpdatedAt: target.updatedAt.toISOString(), permissionRevision: actor.permissionRevision, actions: [...actor.actions] };
      const id = randomUUID(), payload = JSON.stringify({ fromCustomerId: context.customerId, targetMembershipId: target.id, authorityBasis });
      await tx.$executeRaw`INSERT INTO enterprise_workflow_requests (tenantId,id,kind,applicantCustomerId,corporateCustomerId,state,payload,updatedAt) VALUES (${context.tenantId},${id},'administrator_transfer',${target.personalCustomerId},${corporateId},'pending',${payload},NOW(3))`;
      return { id, state: "pending", revision: 1 };
    }, async tx => { await this.commands.customer(context, tx); await this.access.requireAction(context, corporateId, "administrators:manage", tx); });
  }
  /** Recover only the initiating receipt. A later decision or current grant is
   * neither this key's result nor permission to repeat the original request. */
  async readTransferInitiation(context: ClientRequestContext, corporateId: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof corporateId !== "string" || !corporateId.trim() || corporateId.length > 191
      || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原交接企业或操作键无效");
    const tx = this.prisma as unknown as Prisma.TransactionClient;
    await this.commands.customer(context, tx, false);
    const receipts = await tx.$queryRaw<Array<{ operationKey: string; result: string | Record<string, unknown> }>>`
      SELECT operationKey,result FROM enterprise_portal_operations
      WHERE tenantId=${context.tenantId} AND operationKey=${key}
        AND actorUserId=${`customer:${context.customerId}`} AND target=${`administrator.transfer:${corporateId}`}`;
    if (!receipts[0]) {
      await this.commands.customer(context, tx, false);
      return { state: "not_recorded" };
    }
    const unavailable = () => new ConflictException("原交接发起收据与原工作流无法精确核对，保留原引用");
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(receipts[0].result);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      result = value;
    } catch { throw unavailable(); }
    if (receipts[0].operationKey !== key || typeof result.id !== "string" || !result.id.trim() || result.id.length > 191
      || result.state !== "pending" || result.revision !== 1) throw unavailable();
    // Follow this immutable receipt's ID, never today's request list. The
    // applicant is the recipient; only payload.fromCustomerId identifies the initiator.
    const rows = await tx.$queryRaw<Workflow[]>`SELECT id,kind,applicantCustomerId,corporateCustomerId,payload
      FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${result.id}
        AND corporateCustomerId=${corporateId} AND kind='administrator_transfer'`;
    const row = rows[0];
    let payload: { fromCustomerId?: unknown; targetMembershipId?: unknown };
    try {
      const value = row && enterpriseJson(row.payload);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
      payload = value;
    } catch { throw unavailable(); }
    if (!row || row.id !== result.id || row.kind !== "administrator_transfer" || row.corporateCustomerId !== corporateId
      || typeof row.applicantCustomerId !== "string" || !row.applicantCustomerId.trim() || row.applicantCustomerId.length > 191
      || row.applicantCustomerId === context.customerId || payload.fromCustomerId !== context.customerId
      || typeof payload.targetMembershipId !== "string" || !payload.targetMembershipId.trim() || payload.targetMembershipId.length > 191) throw unavailable();
    await this.commands.customer(context, tx, false);
    // No raw payload, grants or decision state are projected. Legacy authority
    // material may be read as an initiation, but is never repaired or accepted here.
    return { state: "committed", result: { id: result.id, state: "pending", revision: 1 } };
  }
  private transferDecisionValue(row: Pick<Workflow, "state" | "revision">, id: string, raw: unknown): EnterpriseTransferDecisionResolution["decision"] {
    let result: Record<string, unknown>;
    try {
      const value = enterpriseJson(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid receipt");
      result = value as Record<string, unknown>;
    } catch { throw new ConflictException("原交接收据无法读取，不能核对"); }
    if (result.id !== id || typeof result.state !== "string" || !["approved", "rejected"].includes(result.state) || result.state !== row.state
        || typeof result.revision !== "number" || !Number.isSafeInteger(result.revision) || result.revision < 2 || result.revision !== row.revision) throw new ConflictException("原交接收据与工作流不一致，不能核对");
    return { id, state: result.state as "approved" | "rejected", revision: result.revision };
  }
  private transferResolution(context: ClientRequestContext, row: { id: string; corporateCustomerId: string | null }, key: string, closureKey: string,
    decision: EnterpriseTransferDecisionResolution["decision"], outcome: EnterpriseTransferDecisionResolution["outcome"]): EnterpriseTransferDecisionResolution {
    if (!row.corporateCustomerId) throw new ConflictException("原交接企业引用缺失，不能核对");
    return { version: 1, purpose: "administrator_transfer_resolution", outcome, tenantId: context.tenantId, corporateCustomerId: row.corporateCustomerId,
      applicantCustomerId: context.customerId, transferId: row.id, originalOperationKey: key, closureOperationKey: closureKey,
      decision: { id: decision.id, state: decision.state, revision: decision.revision }, retryable: false };
  }
  private requireTransferResolutionRuntime() {
    if (typeof enterpriseTransferDecisionResolutionMatches !== "function") throw new ServiceUnavailableException({ code: "enterprise_transfer_resolution_unavailable", message: "公共交接协议运行时未齐，保留原引用；不能发起新拒绝或补造封闭结果" });
  }
  private transferSealHash(resolution: EnterpriseTransferDecisionResolution) { return enterpriseHash({ action: "administrator.decision.sealed", ...resolution }); }
  private transferSeal(context: ClientRequestContext, row: { id: string; state: string; revision: number; corporateCustomerId: string | null }, key: string, raw: unknown, hash: unknown) {
    this.requireTransferResolutionRuntime();
    let value: Record<string, unknown>;
    try { value = enterpriseJson(raw) as Record<string, unknown>; }
    catch { throw new ConflictException("原交接封闭依据无法读取"); }
    if (!value || typeof value.closureOperationKey !== "string" || !enterpriseTransferDecisionResolutionMatches(value, { tenantId: context.tenantId, applicantCustomerId: context.customerId,
        transferId: row.id, originalOperationKey: key, closureOperationKey: value.closureOperationKey }) || value.outcome !== "closed" || value.corporateCustomerId !== row.corporateCustomerId) throw new ConflictException("原交接封闭绑定不一致");
    // MySQL reorders JSON keys: reconstruct only the named original fields for hashing.
    const sealed = this.transferResolution(context, row, key, value.closureOperationKey, this.transferDecisionValue(row, row.id, value.decision), "closed");
    if (hash !== this.transferSealHash(sealed)) throw new ConflictException("原交接封闭指纹不一致");
    return sealed;
  }
  async closeTransferDecision(context: ClientRequestContext, id: string, key: string, input: CloseEnterpriseTransferDecisionRequest): Promise<EnterpriseTransferDecisionResolution> {
    if (input.confirm !== true || typeof id !== "string" || !id.trim() || id.length > 191 || typeof key !== "string" || !key.trim() || key.length > 128 || key === input.operationKey) throw new BadRequestException("须本人明确原交接与独立拒绝请求");
    this.requireTransferResolutionRuntime();
    // K is part of the command target as well as C's result: the same C cannot bind another K.
    const target = enterpriseHash({ transferId: id, originalOperationKey: key });
    const resolution = await this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.decision.close", target, input, async tx => {
      const rows = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='administrator_transfer'`;
      const row = rows[0]; if (!row) throw new NotFoundException("本人交接请求不存在");
      if (!row.corporateCustomerId) throw new ConflictException("原交接企业引用缺失");
      const originals = await tx.$queryRaw<Array<{ actorUserId: string; target: string; requestHash: string; result: unknown }>>`SELECT actorUserId,target,requestHash,result FROM enterprise_portal_operations WHERE tenantId=${context.tenantId} AND operationKey=${key}`;
      const original = originals[0];
      if (original) {
        if (original.actorUserId !== `customer:${context.customerId}`) throw new ConflictException("原交接键已用于其他请求，不能覆盖");
        if (original.target === `administrator.accept:${id}`) {
          // The original decision won the same Tenant fence. Never undo or regrant it.
          return this.transferResolution(context, row, key, input.operationKey, this.transferDecisionValue(row, id, original.result), "observed");
        }
        if (original.target === `administrator.decision.sealed:${id}`) {
          this.transferSeal(context, row, key, original.result, original.requestHash);
          throw new ConflictException("原交接已封闭；只读原 K/C，缺失的独立收据不补造");
        }
        throw new ConflictException("原交接键已用于其他动作或对象，不能覆盖");
      }
      if (row.state !== "pending") throw new ConflictException("交接已终态但原键未能精确归因，不能封成未执行");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      const resolution = this.transferResolution(context, row, key, input.operationKey, { id, state: "rejected", revision: row.revision + 1 }, "closed");
      // Explicit refusal, K seal and C receipt share the original exclusive Tenant transaction.
      // It does not decode old authority material or change any relationship/grant.
      const changed = await tx.$executeRaw`UPDATE enterprise_workflow_requests SET state='rejected',revision=revision+1,decisionReason=${input.reason},updatedAt=NOW(3) WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='administrator_transfer' AND state='pending' AND revision=${row.revision}`;
      if (changed !== 1) throw new ConflictException("原交接状态或修订已变化，不能封闭");
      await tx.$executeRaw`INSERT INTO enterprise_portal_operations (tenantId,operationKey,actorUserId,requestHash,target,reason,result) VALUES (${context.tenantId},${key},${`customer:${context.customerId}`},${this.transferSealHash(resolution)},${`administrator.decision.sealed:${id}`},${input.reason.trim()},${JSON.stringify(resolution)})`;
      return resolution;
    }, tx => this.commands.customer(context, tx));
    // A replay also validates the original C payload, rather than trusting a typed cast
    // over old/corrupt JSON. These post-commit reads never repeat the refusal or rebuild receipts.
    const binding = { tenantId: context.tenantId, applicantCustomerId: context.customerId, transferId: id, originalOperationKey: key, closureOperationKey: input.operationKey };
    if (!enterpriseTransferDecisionResolutionMatches(resolution, binding)) throw new ConflictException("原独立拒绝收据绑定缺失，保留 K/C");
    const rows = await this.prisma.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='administrator_transfer'`;
    const row = rows[0]; if (!row || row.corporateCustomerId !== resolution.corporateCustomerId) throw new ConflictException("原独立拒绝企业绑定不一致，保留 K/C");
    const decision = this.transferDecisionValue(row, id, resolution.decision);
    const original = await this.readTransferDecision(context, id, key);
    if (original.state !== "committed") throw new ConflictException("原 K 未能精确核对，保留 K/C");
    if (resolution.outcome === "closed") {
      if (!enterpriseTransferDecisionResolutionMatches(original.result, binding) || original.result.outcome !== "closed"
          || original.result.corporateCustomerId !== resolution.corporateCustomerId || original.result.decision.state !== decision.state || original.result.decision.revision !== decision.revision) throw new ConflictException("原 K/C 封闭证据不一致");
    } else if (original.result?.id !== id || original.result.state !== decision.state || original.result.revision !== decision.revision) throw new ConflictException("原 K/C 观察证据不一致");
    return this.transferResolution(context, row, key, input.operationKey, decision, resolution.outcome);
  }
  /** Read a recipient's exact original decision, not today's grants or an unbound workflow status. */
  async readTransferDecision(context: ClientRequestContext, id: string, key: string): Promise<EnterpriseOperationResult> {
    if (typeof id !== "string" || !id.trim() || id.length > 191 || typeof key !== "string" || !key.trim() || key.length > 128) throw new BadRequestException("原交接与操作键无效");
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    // One statement observes the workflow and its jointly committed receipt consistently.
    // LEFT JOIN absence is unknown, including terminal legacy rows; it never permits a retry.
    const rows = await this.prisma.$queryRaw<Array<{ id: string; corporateCustomerId: string | null; state: string; revision: number; decisionKey: string | null; decisionResult: unknown; decisionTarget: string | null; decisionHash: string | null }>>`
      SELECT w.id,w.corporateCustomerId,w.state,w.revision,o.operationKey AS decisionKey,o.result AS decisionResult,o.target AS decisionTarget,o.requestHash AS decisionHash
      FROM enterprise_workflow_requests w LEFT JOIN enterprise_portal_operations o
        ON o.tenantId=w.tenantId AND o.operationKey=${key} AND o.actorUserId=${`customer:${context.customerId}`} AND o.target IN (${`administrator.accept:${id}`},${`administrator.decision.sealed:${id}`})
      WHERE w.tenantId=${context.tenantId} AND w.id=${id} AND w.applicantCustomerId=${context.customerId} AND w.kind='administrator_transfer'`;
    await this.commands.customer(context, this.prisma as unknown as Prisma.TransactionClient, false);
    const row = rows[0];
    if (!row) throw new NotFoundException("本人交接请求不存在");
    if (!row.corporateCustomerId) throw new ConflictException("原交接企业引用缺失，不能核对");
    if (!row.decisionKey) return { state: "not_recorded" };
    if (row.decisionKey !== key || row.id !== id) throw new ConflictException("原交接收据与工作流不一致，不能核对");
    if (row.decisionTarget === `administrator.decision.sealed:${id}`) {
      const sealed = this.transferSeal(context, row, key, row.decisionResult, row.decisionHash);
      return { state: "committed", result: { ...sealed } };
    }
    if (row.decisionTarget !== `administrator.accept:${id}`) throw new ConflictException("原交接收据动作不一致");
    // Do not expose hashes, reasons, raw JSON or a current authority projection.
    return { state: "committed", result: this.transferDecisionValue(row, id, row.decisionResult) };
  }
  async acceptTransfer(context: ClientRequestContext, id: string, input: DecideEnterpriseTransferRequest) {
    if (typeof input.accept !== "boolean") throw new BadRequestException("须本人明确接受或拒绝交接");
    return this.commands.execute(context.tenantId, `customer:${context.customerId}`, "administrator.accept", id, input, async tx => {
      const rows = await tx.$queryRaw<Workflow[]>`SELECT * FROM enterprise_workflow_requests WHERE tenantId=${context.tenantId} AND id=${id} AND applicantCustomerId=${context.customerId} AND kind='administrator_transfer'`;
      const row = rows[0]; if (!row) throw new NotFoundException("本人交接请求不存在");
      if (row.revision !== input.expectedRevision) throw this.commands.conflict();
      if (row.state !== "pending") throw new ConflictException("交接已处理");
      if (input.accept) {
        let payload: Record<string, unknown>;
        try { payload = enterpriseJson(row.payload); }
        catch { throw this.transferBasisRefusal("原交接依据无法读取，不能接受旧请求"); }
        const basis = this.transferAuthorityBasis(payload);
        if (typeof payload.fromCustomerId !== "string" || !payload.fromCustomerId || typeof payload.targetMembershipId !== "string" || !payload.targetMembershipId) throw this.transferBasisRefusal("原交接对象依据缺失");
        const from = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: row.corporateCustomerId, id: basis.fromMembershipId, personalCustomerId: payload.fromCustomerId, role: "admin", status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { tenantId: context.tenantId, customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
        const target = await tx.customerCorporateMembership.findFirst({ where: { tenantId: context.tenantId, corporateCustomerId: row.corporateCustomerId, id: payload.targetMembershipId, personalCustomerId: context.customerId, status: "active", effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }], personalCustomer: { is: { customerType: "personal", status: "active", mergedIntoCustomerId: null, account: { is: { status: "active" } }, membership: { is: { status: "active" } } } } } });
        if (!from || !target || from.updatedAt.toISOString() !== basis.fromUpdatedAt || target.updatedAt.toISOString() !== basis.targetUpdatedAt) throw this.transferBasisRefusal("原交接双方关系修订已变化，须重新明确发起交接");
        const tenant = await tx.$queryRaw<Array<{ enabled: boolean; revision: number }>>`SELECT enabled,revision FROM enterprise_portal_tenant_settings WHERE tenantId=${context.tenantId}`;
        const company = await tx.customerProfile.findFirst({ where: { tenantId: context.tenantId, id: row.corporateCustomerId, customerType: "corporate", status: "active", mergedIntoCustomerId: null, membership: { is: { status: "active" } } }, select: { id: true } });
        if (!tenant[0]?.enabled || !company) throw new ForbiddenException("企业入口或企业会员已停用");
        const portals = await tx.$queryRaw<Array<{ revision: number }>>`SELECT revision FROM enterprise_corporate_portals WHERE tenantId=${context.tenantId} AND corporateCustomerId=${row.corporateCustomerId}`;
        if (!portals[0] || `${tenant[0].revision}:${portals[0].revision}` !== basis.permissionRevision) throw this.transferBasisRefusal("原交接门户授权修订已变化");
        const grants = await tx.$queryRaw<Array<{ action: string }>>`SELECT g.action FROM enterprise_portal_grants g JOIN enterprise_corporate_portals p ON p.tenantId=g.tenantId AND p.corporateCustomerId=g.corporateCustomerId AND p.enabled=true WHERE g.tenantId=${context.tenantId} AND g.corporateCustomerId=${row.corporateCustomerId} AND g.membershipId=${from.id} AND g.membershipUpdatedAt=${from.updatedAt}`;
        if (!grants.some(g => g.action === "portal:enter") || !grants.some(g => g.action === "administrators:manage")) throw new ForbiddenException("交出方管理员授权已撤销");
        const currentActions = ENTERPRISE_PORTAL_ACTIONS.filter(action => grants.some(grant => grant.action === action));
        if (currentActions.length !== grants.length || enterpriseHash(currentActions) !== enterpriseHash(basis.actions)) throw this.transferBasisRefusal("原交接动作授权已变化，不能按新授权接受旧请求");
        const promoted = await this.customers.saveEnterpriseRelation(context.tenantId, row.corporateCustomerId, context.customerId, { role: "admin", status: "active", department: target.department, employeeNo: target.employeeNo, effectiveFrom: target.effectiveFrom, effectiveTo: target.effectiveTo, reason: input.reason, createdBy: context.customerId }, tx);
        await tx.$executeRaw`DELETE FROM enterprise_portal_grants WHERE tenantId=${context.tenantId} AND corporateCustomerId=${row.corporateCustomerId} AND membershipId=${promoted.id}`;
        for (const action of basis.actions) await tx.$executeRaw`INSERT INTO enterprise_portal_grants (tenantId,corporateCustomerId,membershipId,action,membershipUpdatedAt) VALUES (${context.tenantId},${row.corporateCustomerId},${promoted.id},${action},${promoted.updatedAt}) ON DUPLICATE KEY UPDATE membershipUpdatedAt=VALUES(membershipUpdatedAt)`;
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
