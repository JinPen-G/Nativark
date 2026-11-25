/** 原 FilterPreset 的公共存储端口。身份、预设和审计由宿主同一数据库及事务提供。 */
import type { PlatformAuthDataStore, PlatformAuthTransaction, PlatformJsonValue } from "../platform/platform-auth-data-store";

export interface StoredPlatformFilterPreset {
  id: string;
  tenantId: string;
  scopeKey: string;
  name: string;
  description: string | null;
  filters: PlatformJsonValue;
  isDefault: boolean;
  isSystem: boolean;
  operator: string | null;
  updatedAt: Date;
}

interface PlatformFilterPresetWrite {
  tenantId: string;
  scopeKey: string;
  name: string;
  description?: string;
  filters: { [key: string]: PlatformJsonValue | undefined };
  isDefault: boolean;
  isSystem: boolean;
  operator: string;
}

export interface PlatformFilterPresetTransaction extends PlatformAuthTransaction {
  filterPreset: {
    findMany(query: { where: { tenantId: string; scopeKey?: string };
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }): PromiseLike<StoredPlatformFilterPreset[]>;
    findFirst(query: { where: { id: string; tenantId: string } }): PromiseLike<StoredPlatformFilterPreset | null>;
    findUnique(query: { where: { tenantId_scopeKey_name: { tenantId: string; scopeKey: string; name: string } } }):
      PromiseLike<StoredPlatformFilterPreset | null>;
    create(query: { data: PlatformFilterPresetWrite }): PromiseLike<StoredPlatformFilterPreset>;
    update(query: { where: { id: string; tenantId: string };
      data: PlatformFilterPresetWrite | { isDefault: true; operator: string } }): PromiseLike<StoredPlatformFilterPreset>;
    updateMany(query: { where: { tenantId: string; scopeKey: string };
      data: { isDefault: false } }): PromiseLike<{ count: number }>;
    delete(query: { where: { id: string; tenantId: string } }): PromiseLike<unknown>;
  };
  operationLog: { create(query: { data: { tenantId: string; userId: string; action: string;
    detail: { operator: string; targetType: string; targetId: string; detail: string } } }): PromiseLike<unknown> };
}

export type PlatformFilterPresetDatabase = Omit<PlatformAuthDataStore, "$transaction"> & {
  $transaction<T>(work: (transaction: PlatformFilterPresetTransaction) => Promise<T>,
    options?: { isolationLevel: "Serializable" }): Promise<T>;
};
