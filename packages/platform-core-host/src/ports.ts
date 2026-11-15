/** 标准Core宿主只消费公共身份、有限SQL事务及真实订阅/审计；不引用行业API或生成模型。 */
import type { PlatformAuthTransaction } from "@rental-os/platform-server/auth-store";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { CoreHostSqlTransaction, CoreHostSqlClient } from "@rental-os/core-host/mysql";
import type { CoreAccessReceipt, CoreBindingReceipt } from "@rental-os/core-host";

export type PlatformCoreTransaction = PlatformAuthTransaction & CoreHostSqlTransaction;
export interface PlatformCoreUsers<Tx extends PlatformCoreTransaction> {
  findUserById(id: string, transaction?: Tx): Promise<SystemUserRow | undefined>;
}
export interface PlatformCoreTermPolicy<Tx extends PlatformCoreTransaction> {
  /** 新业务的真实统一订阅规则；缺数据或查询失败抛出，不提供默认允许。 */
  requireNewBusiness(transaction: Tx, tenantId: string): Promise<void>;
}
export interface PlatformCoreAudit<Tx extends PlatformCoreTransaction> {
  recordCoreAccessReceipt(transaction: Tx, receipt: CoreAccessReceipt): Promise<void>;
  recordCoreBindingReceipt(transaction: Tx, receipt: CoreBindingReceipt): Promise<void>;
}
export interface CoreBusinessAuditInput {
  tenantId: string; userId: string; coreId: string; targetType: string; targetId: string;
  operationId: string; revision: number; fingerprint: string; state: string;
}
export interface PlatformCoreBusinessAudit<Tx extends PlatformCoreTransaction> {
  recordCoreBusinessReceipt(transaction: Tx, receipt: CoreBusinessAuditInput): Promise<void>;
}
export interface PlatformCoreHostDependencies<Tx extends PlatformCoreTransaction> {
  database: CoreHostSqlClient<Tx>;
  users: PlatformCoreUsers<Tx>;
  term: PlatformCoreTermPolicy<Tx>;
  audit: PlatformCoreAudit<Tx>;
}
