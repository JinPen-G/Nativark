/** Core授权/绑定的公共审计。只写已受权原收据引用，同一调用方事务失败即回滚，不记录配置正文。 */
import type { PlatformCoreAudit, PlatformCoreTransaction } from "./ports";
import type { PlatformManagementTransaction } from "@rental-os/platform-server";

export function createPlatformCoreAudit<Tx extends PlatformCoreTransaction & Pick<PlatformManagementTransaction, "operationLog">>(): PlatformCoreAudit<Tx> {
  return {
    async recordCoreAccessReceipt(transaction, receipt) {
      await transaction.operationLog.create({ data: { tenantId: receipt.result.tenantId, userId: receipt.actor.subjectId,
        action: `core.${receipt.kind}.changed`, detail: {
          operator: receipt.actor.subjectId, targetType: receipt.kind === "tenant_grant" ? "tenant-core-grant" : "member-core-assignment",
          targetId: receipt.result.coreId, metadata: { operationId: receipt.result.operationId, revision: receipt.result.revision,
            fingerprint: receipt.fingerprint, actorTenantId: receipt.actor.tenantId, state: receipt.result.state,
            ...(receipt.kind === "member_assignment" ? { memberId: receipt.result.userId } : {}) }
        } } });
    },
    async recordCoreBindingReceipt(transaction, receipt) {
      await transaction.operationLog.create({ data: { tenantId: receipt.binding.tenantId, userId: receipt.actor.subjectId,
        action: "core.binding.initialized", detail: { operator: receipt.actor.subjectId, targetType: "core-binding",
          targetId: receipt.binding.bindingId, metadata: { coreId: receipt.binding.coreId, operationId: receipt.operation.operationId,
            revision: receipt.binding.revision, dataVersion: receipt.binding.dataVersion, fingerprint: receipt.fingerprint }
        } } });
    }
  };
}
