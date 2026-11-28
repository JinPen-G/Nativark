/** 私有来源的服务端瞬时权限接点。原身份与加密集成行由实际适配器复验，不能由 pin 或缓存授予。
 * 租户/成员运行权和生命周期不消费此凭据，失权仅阻止新的受限材料操作。 */
import type { GitHubPrivateCredential } from "@rental-os/core-contracts/github";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";

export interface CorePackageSourceLease {
  /** 隔离当前主体和配置修订的非秘密标识，仅用于本进程缓存。 */
  scope: string;
  credential: GitHubPrivateCredential;
  /** 发布时传原事务并锁原配置行；事务外读取仍重新核原身份与修订。 */
  revalidate(transaction?: CoreHostSqlTransaction): Promise<void>;
}
export interface CorePackagePrivateSourceAccess {
  acquire(repository: string): Promise<CorePackageSourceLease>;
}
