/** Customer-only enterprise reads. Personal authentication is necessary, not sufficient:
 * current activation, relationship revision and exact action grants are checked again. */
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ENTERPRISE_PORTAL_ACTIONS } from "@rental-os/shared";
import { type EnterpriseEntryResponse, type EnterpriseManagedCorporate, type EnterpriseMembersResponse, type EnterprisePortalAction } from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import type { ClientRequestContext } from "./client-auth.service";

type AccessRow = { corporateCustomerId: string; corporateName: string; membershipId: string; role: string; action: string | null; tenantRevision: number; corporateRevision: number; tenantEnabled: boolean | number; corporateEnabled: boolean | number };

@Injectable()
export class EnterpriseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private async access(context: ClientRequestContext, tenantCode: string, tx?: Prisma.TransactionClient): Promise<AccessRow[]> {
    if (context.customerType !== "personal" || !tenantCode || context.tenantCode !== tenantCode) throw new ForbiddenException("企业入口与当前客户商户不一致");
    // One fresh database statement gates the session, both memberships, relation and
    // grants. Neither cached role nor a later restore revives an earlier grant.
    return (tx ?? this.prisma).$queryRaw<AccessRow[]>`
      SELECT m.corporateCustomerId, c.name AS corporateName, m.id AS membershipId, m.role,
        g.action, COALESCE(t.revision,0) AS tenantRevision, COALESCE(p.revision,0) AS corporateRevision,
        COALESCE(t.enabled,false) AS tenantEnabled, COALESCE(p.enabled,false) AS corporateEnabled
      FROM customer_corporate_memberships m
      JOIN Tenant tenant ON tenant.id=m.tenantId AND tenant.status='ACTIVE' AND tenant.code=${tenantCode}
      JOIN customer_profiles person ON person.tenantId=m.tenantId AND person.id=m.personalCustomerId AND person.customerType='personal' AND person.status='active' AND person.mergedIntoCustomerId IS NULL
      JOIN customer_accounts account ON account.tenantId=m.tenantId AND account.customerId=person.id AND account.status='active'
      JOIN customer_memberships personalMember ON personalMember.tenantId=m.tenantId AND personalMember.customerId=person.id AND personalMember.status='active'
      JOIN client_auth_sessions s ON s.tenantId=m.tenantId AND s.customerId=person.id AND s.id=${context.sessionId} AND s.revokedAt IS NULL AND s.expiresAt>NOW(3)
      JOIN customer_profiles c ON c.tenantId=m.tenantId AND c.id=m.corporateCustomerId AND c.customerType='corporate' AND c.status='active' AND c.mergedIntoCustomerId IS NULL
      JOIN customer_memberships corporateMember ON corporateMember.tenantId=m.tenantId AND corporateMember.customerId=c.id AND corporateMember.status='active'
      LEFT JOIN enterprise_portal_tenant_settings t ON t.tenantId=m.tenantId
      LEFT JOIN enterprise_corporate_portals p ON p.tenantId=m.tenantId AND p.corporateCustomerId=c.id
      LEFT JOIN enterprise_portal_grants g ON g.tenantId=m.tenantId AND g.corporateCustomerId=c.id AND g.membershipId=m.id AND g.membershipUpdatedAt=m.updatedAt
      WHERE m.tenantId=${context.tenantId} AND m.personalCustomerId=${context.customerId}
        AND m.status='active' AND m.effectiveFrom<=NOW(3) AND (m.effectiveTo IS NULL OR m.effectiveTo>NOW(3))
      ORDER BY c.name, m.id, g.action`;
  }

  private corporates(rows: AccessRow[]): EnterpriseManagedCorporate[] {
    return [...new Set(rows.map(r => r.membershipId))].flatMap(membershipId => {
      const matches = rows.filter(r => r.membershipId === membershipId), row = matches[0];
      if (row.role !== "admin" || !row.tenantEnabled || !row.corporateEnabled || !matches.some(r => r.action === "portal:enter")) return [];
      const actions: EnterprisePortalAction[] = ENTERPRISE_PORTAL_ACTIONS.filter(action => matches.some(r => r.action === action));
      return [{ corporateCustomerId: row.corporateCustomerId, corporateName: row.corporateName, membershipId, actions, permissionRevision: `${row.tenantRevision}:${row.corporateRevision}` }];
    });
  }

  async requireAction(context: ClientRequestContext, corporateCustomerId: string, action: EnterprisePortalAction, tx?: Prisma.TransactionClient) {
    const corporate = this.corporates(await this.access(context, context.tenantCode, tx)).find(c => c.corporateCustomerId === corporateCustomerId && c.actions.includes(action));
    if (!corporate) throw new ForbiddenException("当前客户无此企业动作授权");
    return corporate;
  }

  async members(context: ClientRequestContext, tenantCode: string, corporateCustomerId: string, page = 1, pageSize = 20): Promise<EnterpriseMembersResponse> {
    const allowed = this.corporates(await this.access(context, tenantCode)).find(c => c.corporateCustomerId === corporateCustomerId && c.actions.includes("members:read"));
    if (!allowed) throw new ForbiddenException("当前客户无权读取企业成员");
    const rows = await this.prisma.customerCorporateMembership.findMany({
      where: { tenantId: context.tenantId, corporateCustomerId }, take: 1001,
      select: { id: true, updatedAt: true, role: true, department: true, employeeNo: true, status: true, effectiveFrom: true, effectiveTo: true, personalCustomer: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { createdAt: "desc" }, { id: "asc" }]
    });
    // Recheck after the reader: a revocation during IO must discard the result.
    const current = this.corporates(await this.access(context, tenantCode)).find(c => c.corporateCustomerId === corporateCustomerId && c.actions.includes("members:read"));
    if (!current || current.permissionRevision !== allowed.permissionRevision) throw new ForbiddenException("企业授权已变化，请重新读取");
    if (rows.length > 1000) throw new ForbiddenException("企业成员超出当前读取范围，请联系商户");
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(100, pageSize) : 20;
    return { apiVersion: "v1", corporateCustomerId, permissionRevision: current.permissionRevision, page: safePage, pageSize: size, total: rows.length,
      items: rows.slice((safePage - 1) * size, safePage * size).map(row => ({ membershipId: row.id, displayName: row.personalCustomer.name, updatedAt: row.updatedAt.toISOString(), role: row.role,
        department: row.department ?? undefined, employeeNo: row.employeeNo ?? undefined, status: row.status,
        effectiveFrom: row.effectiveFrom.toISOString(), effectiveTo: row.effectiveTo?.toISOString() })) };
  }

  async entry(context: ClientRequestContext, tenantCode: string): Promise<EnterpriseEntryResponse> {
    const rows = await this.access(context, tenantCode);
    const corporates = this.corporates(rows);
    const tenant = await this.prisma.tenant.findFirst({ where: { id: context.tenantId, code: tenantCode, status: "ACTIVE" }, select: { name: true } });
    if (!tenant) throw new ForbiddenException("商户不可用");
    return { apiVersion: "v1", tenantCode, tenantName: tenant.name, customerId: context.customerId, displayName: context.displayName,
      state: context.membershipStatus !== "active" ? "membership_restricted" : corporates.length ? "ready" : rows.some(r => r.tenantEnabled) ? "no_management_access" : "not_enabled",
      corporates, ownRelations: [...new Map(rows.map(r => [r.membershipId, { corporateCustomerId: r.corporateCustomerId, corporateName: r.corporateName, role: r.role }])).values()] };
  }
}
