/** Portal activation and action grants only; never rental/payment authority.
 * Durable results are audit receipts: replay does not restore revoked grants. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ENTERPRISE_PORTAL_ACTIONS, type EnterprisePortalConfiguration, type SaveEnterprisePortalConfigurationRequest, type SaveEnterpriseTenantSettingsRequest, type SystemUserRow } from "@rental-os/shared";
import { requireRequestTenantId, requireRequestUserId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";

type SettingsRow = { enabled: boolean | number; revision: number };
type GrantRow = { membershipId: string; action: string };
type ReceiptRow = { actorUserId: string; requestHash: string; result: Prisma.JsonValue | string };
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class EnterprisePortalService {
  constructor(private readonly prisma: PrismaService) {}

  private actor(user: SystemUserRow, write: boolean, grants = false) {
    const tenantId = requireRequestTenantId(), actorId = requireRequestUserId();
    if (!user || user.id !== actorId || user.tenantId !== tenantId || user.isSaasAdmin || !user.isActive
      || (!user.isPlatformAdmin && user.dataScope !== "all")) throw new ForbiddenException("需要当前商户的企业管理授权");
    const all = user.isPlatformAdmin || user.permissions.includes("*");
    const permission = grants ? "rental-os:corporate:employee-manage" : "rental-os:corporate:manage";
    const read = ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:corporate:employee-manage"];
    if (!all && (write ? !user.permissions.includes(permission) : !read.some(p => user.permissions.includes(p)))) {
      throw new ForbiddenException("当前账号无权配置企业门户");
    }
    return { tenantId, actorId };
  }

  private validate(input: SaveEnterpriseTenantSettingsRequest) {
    if (typeof input.enabled !== "boolean" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || !input.operationKey?.trim() || input.operationKey.length > 128 || !input.reason?.trim() || input.reason.length > 500) {
      throw new BadRequestException("开通配置、修订、操作键和原因必须有效");
    }
  }

  private async change<T>(user: SystemUserRow, target: string, input: SaveEnterpriseTenantSettingsRequest, apply: (tx: Prisma.TransactionClient) => Promise<T>) {
    const { tenantId, actorId } = this.actor(user, true);
    this.validate(input);
    const requestHash = fingerprint({ target, input });
    return this.prisma.$transaction(async tx => {
      // One tenant lock orders activation, grants and original receipts across instances.
      const tenants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' FOR UPDATE`;
      if (!tenants.length) throw new ForbiddenException("商户未启用");
      const receipts = await tx.$queryRaw<ReceiptRow[]>`SELECT actorUserId, requestHash, result FROM enterprise_portal_operations WHERE tenantId=${tenantId} AND operationKey=${input.operationKey}`;
      if (receipts.length) {
        if (receipts[0].actorUserId !== actorId || receipts[0].requestHash !== requestHash) throw new ConflictException("操作键已用于其他请求");
        return (typeof receipts[0].result === "string" ? JSON.parse(receipts[0].result) : receipts[0].result) as T;
      }
      const result = await apply(tx);
      const body = JSON.stringify(result);
      await tx.$executeRaw`INSERT INTO enterprise_portal_operations (tenantId, operationKey, actorUserId, requestHash, target, reason, result) VALUES (${tenantId}, ${input.operationKey}, ${actorId}, ${requestHash}, ${target}, ${input.reason.trim()}, ${body})`;
      return result;
    });
  }

  async saveTenantSettings(user: SystemUserRow, input: SaveEnterpriseTenantSettingsRequest) {
    return this.change(user, "tenant", input, async tx => {
      const tenantId = requireRequestTenantId();
      const rows = await tx.$queryRaw<SettingsRow[]>`SELECT revision, enabled FROM enterprise_portal_tenant_settings WHERE tenantId=${tenantId}`;
      if ((rows[0]?.revision ?? 0) !== input.expectedRevision) throw new ConflictException({ message: "商户开通配置已变化，请重新读取", code: "enterprise_revision_conflict" });
      const revision = input.expectedRevision + 1;
      await tx.$executeRaw`INSERT INTO enterprise_portal_tenant_settings (tenantId, enabled, revision, updatedAt) VALUES (${tenantId}, ${input.enabled}, ${revision}, NOW(3)) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), revision=VALUES(revision), updatedAt=NOW(3)`;
      return { enabled: input.enabled, revision };
    });
  }

  async saveConfiguration(user: SystemUserRow, corporateCustomerId: string, input: SaveEnterprisePortalConfigurationRequest) {
    this.actor(user, true, true);
    if (!Array.isArray(input.grants) || input.grants.length > 200 || new Set(input.grants.map(g => g.membershipId)).size !== input.grants.length
      || input.grants.some(g => !g.membershipId || !Array.isArray(g.actions) || new Set(g.actions).size !== g.actions.length
        || g.actions.some(a => !ENTERPRISE_PORTAL_ACTIONS.includes(a)) || (g.actions.length > 0 && !g.actions.includes("portal:enter")))) {
      throw new BadRequestException("成员授权必须为已登记动作，管理动作均需企业入口授权");
    }
    return this.change(user, corporateCustomerId, input, async tx => {
      const tenantId = requireRequestTenantId();
      const corporate = await tx.customerProfile.findFirst({ where: { tenantId, id: corporateCustomerId, customerType: "corporate" }, select: { id: true, status: true, membership: { select: { status: true } } } });
      if (!corporate) throw new NotFoundException("企业不存在");
      if (input.enabled && (corporate.status !== "active" || corporate.membership?.status !== "active")) throw new ConflictException("企业会员未生效");
      const rows = await tx.$queryRaw<SettingsRow[]>`SELECT revision, enabled FROM enterprise_corporate_portals WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateCustomerId}`;
      if ((rows[0]?.revision ?? 0) !== input.expectedRevision) throw new ConflictException({ message: "企业开通配置已变化，请重新读取", code: "enterprise_revision_conflict" });
      const now = new Date();
      const memberships = await tx.customerCorporateMembership.findMany({ where: { tenantId, corporateCustomerId, id: { in: input.grants.filter(g => g.actions.length).map(g => g.membershipId) }, role: "admin", status: "active", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], personalCustomer: { is: { tenantId, customerType: "personal", status: "active", membership: { is: { status: "active" } }, account: { is: { status: "active" } } } } }, select: { id: true, updatedAt: true } });
      const revisions = new Map(memberships.map(m => [m.id, m.updatedAt]));
      if (input.grants.some(g => g.actions.length && !revisions.has(g.membershipId))) throw new ConflictException("授权对象必须为本企业当前有效管理员");
      const revision = input.expectedRevision + 1;
      await tx.$executeRaw`INSERT INTO enterprise_corporate_portals (tenantId, corporateCustomerId, enabled, revision, updatedAt) VALUES (${tenantId}, ${corporateCustomerId}, ${input.enabled}, ${revision}, NOW(3)) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), revision=VALUES(revision), updatedAt=NOW(3)`;
      await tx.$executeRaw`DELETE FROM enterprise_portal_grants WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateCustomerId}`;
      for (const grant of input.grants) for (const action of grant.actions) {
        const membershipUpdatedAt = revisions.get(grant.membershipId)!;
        await tx.$executeRaw`INSERT INTO enterprise_portal_grants (tenantId, corporateCustomerId, membershipId, action, membershipUpdatedAt) VALUES (${tenantId}, ${corporateCustomerId}, ${grant.membershipId}, ${action}, ${membershipUpdatedAt})`;
      }
      return { corporateCustomerId, enabled: input.enabled, revision, grants: input.grants };
    });
  }

  async operation(user: SystemUserRow, operationKey: string) {
    const { tenantId, actorId } = this.actor(user, true);
    if (!operationKey || operationKey.length > 128) throw new BadRequestException("原操作键无效");
    const rows = await this.prisma.$queryRaw<ReceiptRow[]>`SELECT actorUserId, requestHash, result FROM enterprise_portal_operations WHERE tenantId=${tenantId} AND operationKey=${operationKey}`;
    if (!rows.length) return { state: "not_recorded" as const };
    if (rows[0].actorUserId !== actorId && rows[0].actorUserId !== `operator:${actorId}`) throw new ForbiddenException("不可读取其他账号的操作结果");
    return { state: "committed" as const, result: typeof rows[0].result === "string" ? JSON.parse(rows[0].result) : rows[0].result };
  }

  async tenantSettings(user: SystemUserRow) {
    const { tenantId } = this.actor(user, false);
    const rows = await this.prisma.$queryRaw<SettingsRow[]>`SELECT enabled, revision FROM enterprise_portal_tenant_settings WHERE tenantId=${tenantId}`;
    return { enabled: Boolean(rows[0]?.enabled), revision: rows[0]?.revision ?? 0 };
  }

  async configuration(user: SystemUserRow, corporateCustomerId: string): Promise<EnterprisePortalConfiguration> {
    const { tenantId } = this.actor(user, false);
    const corporate = await this.prisma.customerProfile.findFirst({ where: { tenantId, id: corporateCustomerId, customerType: "corporate" }, select: { id: true } });
    if (!corporate) throw new NotFoundException("企业不存在");
    const tenant = await this.tenantSettings(user);
    const rows = await this.prisma.$queryRaw<SettingsRow[]>`SELECT enabled, revision FROM enterprise_corporate_portals WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateCustomerId}`;
    const grants = await this.prisma.$queryRaw<GrantRow[]>`SELECT membershipId, action FROM enterprise_portal_grants WHERE tenantId=${tenantId} AND corporateCustomerId=${corporateCustomerId} ORDER BY membershipId, action`;
    return { tenantEnabled: tenant.enabled, tenantRevision: tenant.revision, corporateCustomerId, enabled: Boolean(rows[0]?.enabled), revision: rows[0]?.revision ?? 0,
      grants: [...new Set(grants.map(g => g.membershipId))].map(membershipId => ({ membershipId, actions: grants.filter(g => g.membershipId === membershipId).map(g => g.action).filter((action): action is typeof ENTERPRISE_PORTAL_ACTIONS[number] => ENTERPRISE_PORTAL_ACTIONS.some(a => a === action)) })) };
  }
}
