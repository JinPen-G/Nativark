/** Rental 能力实例与生命周期审计的存储视图，范围解析和品类锁由原宿主接点提供。 */
import type { RentalCategoryDefinition } from "./contracts";
import type { ResolvedRentalCategory } from "./category-runtime";
import type { WorkspaceCapabilityBinding } from "./workspace-capability-port";

export type CapabilityJsonInput = string | number | boolean |
  { readonly [key: string]: CapabilityJsonInput | null | undefined } |
  ReadonlyArray<CapabilityJsonInput | null>;

interface CapabilityInstanceData {
  status: string;
  implementationVersion: string;
  configVersion: string;
  config: CapabilityJsonInput;
  revision: number;
  enabledAt: Date | null;
  pausedAt?: Date | null;
  disabledAt?: Date | null;
  updatedBy: string | null;
}

interface CapabilityInstanceRow {
  tenantId: string;
  workspaceId: string;
  code: string;
  status: string;
  implementationVersion: string;
  configVersion: string;
  config: unknown;
  revision: number;
  enabledAt: Date | null;
  pausedAt: Date | null;
  disabledAt: Date | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CapabilityAuditData {
  tenantId: string;
  workspaceId: string;
  code: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  implementationVersion: string | null;
  configVersion: string | null;
  configSnapshot?: CapabilityJsonInput;
  reason: string;
  operator: string | null;
  at: Date;
}

interface CapabilityAuditRow {
  code: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  implementationVersion: string | null;
  configVersion: string | null;
  configSnapshot: unknown;
  reason: string;
  operator: string | null;
  at: Date;
}

/** 业务调用方事务只需提供所属两张能力表的操作。 */
export interface WorkspaceCapabilityTransaction {
  workspaceCapabilityInstance: {
    findMany(input: { where: { tenantId: string; workspaceId: string }; orderBy?: { code: "asc" } }): PromiseLike<CapabilityInstanceRow[]>;
    findFirst(input: { where: { tenantId: string; workspaceId: string; code: string } }): PromiseLike<CapabilityInstanceRow | null>;
    createMany(input: {
      data: Array<CapabilityInstanceData & { tenantId: string; workspaceId: string; code: string }>;
      skipDuplicates: true;
    }): PromiseLike<{ count: number }>;
    create(input: { data: CapabilityInstanceData & { tenantId: string; workspaceId: string; code: string } }): PromiseLike<unknown>;
    updateMany(input: { where: { tenantId: string; workspaceId: string; code: string; revision: number }; data: CapabilityInstanceData }): PromiseLike<{ count: number }>;
  };
  workspaceCapabilityAuditEntry: {
    createMany(input: { data: CapabilityAuditData[] }): PromiseLike<{ count: number }>;
    create(input: { data: CapabilityAuditData }): PromiseLike<unknown>;
    findMany(input: {
      where: { tenantId: string; workspaceId: string; code?: string };
      orderBy: Array<{ at: "asc" } | { createdAt: "asc" }>;
    }): PromiseLike<CapabilityAuditRow[]>;
  };
}

export interface WorkspaceCapabilityStore<TTransaction extends WorkspaceCapabilityTransaction> extends WorkspaceCapabilityTransaction {
  $transaction<T>(run: (transaction: TTransaction) => Promise<T>): PromiseLike<T>;
}

export interface WorkspaceCapabilityContacts<TTransaction> {
  currentWorkspaceId(tenantId: string): PromiseLike<string>;
  readWorkspaceScope(tenantId: string, workspaceId: string, transaction?: TTransaction): PromiseLike<{
    categoryCode: string;
    category: { defaultCapabilities: unknown } | null;
  } | null>;
  readWorkspaceRunMode(tenantId: string, workspaceId: string): PromiseLike<{ runMode: string | null } | null>;
  resolveCategory?(tenantId: string, workspaceId: string): PromiseLike<ResolvedRentalCategory>;
  lockCategoryBinding(
    transaction: TTransaction,
    tenantId: string,
    workspaceId: string,
    expected?: WorkspaceCapabilityBinding
  ): PromiseLike<{ definition: RentalCategoryDefinition; binding: WorkspaceCapabilityBinding }>;
}
