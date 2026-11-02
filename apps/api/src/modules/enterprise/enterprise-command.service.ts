/** Enterprise commands serialize on the tenant lock and commit original receipts.
 * Customer identity is re-read; this service never grants operator or rental authority. */
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { EnterpriseChangeRequest, SystemUserRow } from "@rental-os/shared";
import { requireRequestTenantId, requireRequestUserId } from "../../common/request-identity";
import { PrismaService } from "../database/prisma.service";
import type { ClientRequestContext } from "../client/client-auth.service";

export const enterpriseHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const enterpriseJson = <T>(value: T | string): T => typeof value === "string" ? JSON.parse(value) : value;
@Injectable()
export class EnterpriseCommandService {
  constructor(private readonly prisma: PrismaService) {}
  operator(user: SystemUserRow, permission: string) {
    const tenantId = requireRequestTenantId(), id = requireRequestUserId();
    if (!user || user.id !== id || user.tenantId !== tenantId || user.isSaasAdmin || !user.isActive
      || (!user.isPlatformAdmin && user.dataScope !== "all")
      || (!user.isPlatformAdmin && !user.permissions.includes("*") && !user.permissions.includes(permission))) throw new ForbiddenException("需要当前商户授权");
    return { tenantId, actor: `operator:${id}` };
  }
  async customer(context: ClientRequestContext, tx: Prisma.TransactionClient, active = true) {
    if (context.customerType !== "personal" || context.tenantId !== requireRequestTenantId() || context.customerId !== requireRequestUserId()) throw new ForbiddenException("客户身份不一致");
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT p.id FROM customer_profiles p JOIN customer_accounts a ON a.tenantId=p.tenantId AND a.customerId=p.id AND a.status='active'
      JOIN customer_memberships m ON m.tenantId=p.tenantId AND m.customerId=p.id
      JOIN client_auth_sessions s ON s.tenantId=p.tenantId AND s.customerId=p.id AND s.id=${context.sessionId} AND s.revokedAt IS NULL AND s.expiresAt>NOW(3)
      WHERE p.tenantId=${context.tenantId} AND p.id=${context.customerId} AND p.customerType='personal' AND p.status='active' AND p.mergedIntoCustomerId IS NULL
        AND m.status NOT IN ('exited','closed') AND (${!active} OR m.status='active')`;
    if (!rows.length) throw new ForbiddenException("当前个人会员不可执行此操作");
  }
  async execute<T extends object>(tenantId: string, actor: string, action: string, target: string, input: EnterpriseChangeRequest,
    apply: (tx: Prisma.TransactionClient) => Promise<T>, verify?: (tx: Prisma.TransactionClient) => Promise<void>, tenantFence: "exclusive" | "shared" = "exclusive",
    serialize?: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    if (!action || !target || `${action}:${target}`.length > 191 || !input.operationKey?.trim() || input.operationKey.length > 128 || !input.reason?.trim() || input.reason.length > 500
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new BadRequestException("操作键、修订及原因无效");
    const hash = enterpriseHash({ action, target, input });
    return this.prisma.$transaction(async tx => {
      // Expense-only commands hold a shared parent fence before the order lock.
      // They never mutate grants/policy or upgrade it; policy writes remain exclusive.
      const tenant = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM Tenant WHERE id=${tenantId} AND status='ACTIVE' ${tenantFence === "shared" ? Prisma.sql`LOCK IN SHARE MODE` : Prisma.sql`FOR UPDATE`}`);
      if (!tenant.length) throw new ForbiddenException("商户不可用");
      if (verify) await verify(tx);
      if (serialize) await serialize(tx);
      const receipts = await tx.$queryRaw<Array<{ actorUserId: string; requestHash: string; result: T | string }>>`SELECT actorUserId, requestHash, result FROM enterprise_portal_operations WHERE tenantId=${tenantId} AND operationKey=${input.operationKey}`;
      if (receipts.length) {
        if (receipts[0].actorUserId !== actor || receipts[0].requestHash !== hash) throw new ConflictException("操作键已用于其他请求");
        return enterpriseJson(receipts[0].result);
      }
      const result = await apply(tx);
      await tx.$executeRaw`INSERT INTO enterprise_portal_operations (tenantId,operationKey,actorUserId,requestHash,target,reason,result) VALUES (${tenantId},${input.operationKey},${actor},${hash},${`${action}:${target}`},${input.reason.trim()},${JSON.stringify(result)})`;
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  conflict() { return new ConflictException({ message: "企业对象修订已变化，请重新读取", code: "enterprise_revision_conflict" }); }
}
