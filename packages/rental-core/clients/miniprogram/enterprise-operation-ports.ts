/** 企业原操作的宿主端口。宿主持有微信 I/O 和原会话，Core 编排只保留不透明引用，
 * 身份或服务变化后拒绝迟到结果，unknown 只能核对原操作与可信收据。 */
import type { createRentalMiniProgramEnterpriseApi } from "./enterprise";
import type { RentalMiniProgramEntryActionSession } from "./ai-entry-actions";
import type { RentalMiniProgramPublicConfig } from "./ports";

export type RentalMiniProgramEnterpriseApi = ReturnType<typeof createRentalMiniProgramEnterpriseApi>;

export interface RentalMiniProgramEnterpriseOperationPorts {
  /** 返回宿主原会话，不重新投影或复制。 */
  currentSession(): Pick<RentalMiniProgramEntryActionSession, "customer"> | undefined;
  currentServiceCode(): string | undefined;
  contextVersion(): number;
  publicConfig: Pick<RentalMiniProgramPublicConfig, "tenantCode">;
  enterpriseOperationsKey: string;
  newKey(prefix: string): string;
  storage: {
    read(key: string): unknown;
    writeRequired(key: string, value: unknown): void;
    remove(key: string): void;
  };
}
