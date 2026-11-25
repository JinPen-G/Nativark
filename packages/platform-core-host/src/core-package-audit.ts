/**
 * 发行选择和候选准备的原提交意图审计，沿调用方已锁定的当前主体与事务写入。
 * 原引用和摘要用于核对文件结果，记录的 requested 状态表示本次提交意图。
 */
import { CoreAccessError } from "@rental-os/core-host";
import type { PlatformManagementTransaction } from "@rental-os/platform-server/management-store";
import { getRequestIdentity } from "@rental-os/platform-server/request-identity";
import type { PlatformCoreTransaction } from "./ports";

export type CorePackagePublicationAttempt =
  | { kind: "release"; reference: string }
  | { kind: "preparation"; sha256: string };

export interface CorePackagePublicationAudit<Tx> {
  recordPublicationAttempt(transaction: Tx, attempt: CorePackagePublicationAttempt): Promise<void>;
}

export function createPlatformCorePackageAudit<
  Tx extends PlatformCoreTransaction & Pick<PlatformManagementTransaction, "operationLog">
>(): CorePackagePublicationAudit<Tx> {
  return {
    async recordPublicationAttempt(transaction, attempt) {
      const identity = getRequestIdentity();
      if (!identity?.tenantId || !identity.userId || identity.audience !== "operator")
        throw new CoreAccessError("denied", "Core 包审计缺少原管理主体");
      const reference = attempt.kind === "release" ? attempt.reference : attempt.sha256;
      const fingerprint = attempt.kind === "release" ? attempt.reference.slice("github-".length) : attempt.sha256;
      await transaction.operationLog.create({ data: {
        tenantId: identity.tenantId,
        userId: identity.userId,
        action: `core.package.${attempt.kind}.requested`,
        detail: {
          operator: identity.userId,
          targetType: `core-package-${attempt.kind}`,
          targetId: reference,
          metadata: { fingerprint, state: "requested" }
        }
      } });
    }
  };
}
