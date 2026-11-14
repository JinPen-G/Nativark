/**
 * 原主体事务内读取Core授权、成员分配及绑定，复用原订阅对新业务的期限规则。
 * Core的动作权限与对象范围由调用方继续检查，数据查询始终带当前租户/Core。
 */
import { createHash } from "node:crypto";
import { ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { CoreBindingSchema, MemberCoreAssignmentSchema, TenantCoreGrantSchema,
  type CoreBinding, type CoreScopeReference } from "@rental-os/core-contracts";
import { coreBindingScopeKey, type CoreDeploymentAvailability } from "@rental-os/core-host";
import type { SystemUserRow } from "@rental-os/shared";
import type { SubscriptionService } from "../subscription/subscription.service";

export class OriginalCoreAccess {
  constructor(private readonly subscription: Pick<SubscriptionService, "readCategoryCommercialContext">,
    private readonly deployment: CoreDeploymentAvailability) {}

  async requireMember(transaction: Prisma.TransactionClient, user: SystemUserRow, coreId: string): Promise<void> {
    const grants = await transaction.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
      SELECT state, revision, operation_id AS operationId FROM platform_tenant_core_grants
      WHERE tenant_id = ${user.tenantId} AND core_id = ${coreId} FOR UPDATE`;
    if (!grants[0]) throw new ForbiddenException("租户尚未获得该Core使用权");
    const grant = TenantCoreGrantSchema.parse({ ...grants[0], revision: Number(grants[0].revision), tenantId: user.tenantId, coreId });
    if (grant.state !== "enabled") throw new ForbiddenException("该Core的租户授权已停用");
    const assignments = await transaction.$queryRaw<Array<{ state: string; revision: bigint | number; operationId: string }>>`
      SELECT state, revision, operation_id AS operationId FROM platform_member_core_assignments
      WHERE tenant_id = ${user.tenantId} AND core_id = ${coreId} AND user_id = ${user.id} FOR UPDATE`;
    if (!assignments[0]) throw new ForbiddenException("成员尚未分配该Core");
    const assignment = MemberCoreAssignmentSchema.parse({ ...assignments[0], revision: Number(assignments[0].revision),
      tenantId: user.tenantId, coreId, userId: user.id });
    if (assignment.state !== "assigned") throw new ForbiddenException("成员的Core使用权已撤回");
    await this.deployment.requireAvailable(coreId, user.tenantId);
  }

  /** 原订阅只对新业务裁定期限，读旧结果和原业务收尾沿各Core的正式规则办理。 */
  async requireNewBusiness(transaction: Prisma.TransactionClient, tenantId: string): Promise<void> {
    const term = await this.subscription.readCategoryCommercialContext(tenantId, transaction, new Date(), []);
    if (!term.newBusinessAllowed) throw new ForbiddenException("租户订阅已到期，暂停新增Core业务");
  }

  async binding(transaction: Prisma.TransactionClient, scope: CoreScopeReference): Promise<CoreBinding | undefined> {
    const hash = createHash("sha256").update(coreBindingScopeKey(scope)).digest("hex");
    const rows = await transaction.$queryRaw<Array<{ bindingId: string; revision: bigint | number; dataVersion: string;
      containerType: string | null; containerId: string | null }>>`
      SELECT binding_id AS bindingId, revision, data_version AS dataVersion, container_type AS containerType, container_id AS containerId
      FROM platform_core_bindings WHERE tenant_id = ${scope.tenantId} AND core_id = ${scope.coreId} AND scope_hash = ${hash}`;
    if (!rows[0]) return undefined;
    const row = rows[0];
    const binding = CoreBindingSchema.parse({ tenantId: scope.tenantId, coreId: scope.coreId, bindingId: row.bindingId,
      revision: Number(row.revision), dataVersion: row.dataVersion,
      ...(row.containerType !== null || row.containerId !== null ? { container: { type: row.containerType, id: row.containerId } } : {}) });
    if (coreBindingScopeKey(binding) !== coreBindingScopeKey(scope))
      throw new ForbiddenException("原Core绑定与当前范围不一致");
    return binding;
  }
}
