/** 公共字典和编号只使用平台身份、SystemParameterSet 与同事务审计。宿主供给原同一数据库。 */
import type { PlatformAuthDataStore, PlatformAuthTransaction, PlatformJsonValue } from "../platform/platform-auth-data-store";

export type PlatformToolsContent = { [key: string]: PlatformJsonValue | undefined };
export interface PlatformToolsParameterRow {
  id: string;
  versionNo: number;
  content: PlatformJsonValue;
}
export interface PlatformToolsTransaction extends PlatformAuthTransaction {
  systemParameterSet: {
    findFirst(query: { where: { tenantId: string; module: string; status?: "EFFECTIVE" };
      orderBy: { versionNo: "desc" } }): PromiseLike<PlatformToolsParameterRow | null>;
    create(query: { data: { tenantId: string; module: string; versionNo: number; status: "EFFECTIVE";
      content: PlatformToolsContent; operator: string } }): PromiseLike<unknown>;
    updateMany(query: { where: { id: string; tenantId: string; module: string; versionNo: number; status: "EFFECTIVE" };
      data: { content: PlatformToolsContent; operator: string } }): PromiseLike<{ count: number }>;
  };
  operationLog: { create(query: { data: { tenantId: string; userId: string; action: string;
    detail: PlatformToolsContent } }): PromiseLike<unknown> };
}
export type PlatformToolsDatabase = Omit<PlatformAuthDataStore, "$transaction"> & {
  $transaction<T>(work: (transaction: PlatformToolsTransaction) => Promise<T>, options?: { isolationLevel: "Serializable" }): Promise<T>;
};
