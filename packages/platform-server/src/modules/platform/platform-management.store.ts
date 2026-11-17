/** 公共管理私有存储端口。只暴露实际使用的公共表操作，ORM与行业模型留在宿主。 */
import type { PlatformAuthDataStore, PlatformAuthTransaction, PlatformUserStore, StoredPlatformRole,
  StoredPlatformRoleScope, StoredPlatformDataScope, StoredPlatformTenant, StoredPlatformUser, PlatformJsonValue } from "./platform-auth-data-store";

export type PublicUserInclude = Parameters<PlatformUserStore["findFirst"]>[0]["include"];
type UserWrite = {
  tenantId?: string; account?: string; displayName?: string; phone?: string | null; organizationId?: string | null;
  roleId?: string | null; isPlatformAdmin?: boolean; isSaasAdmin?: boolean; isActive?: boolean; passwordHash?: string;
  mustChangePassword?: boolean; needsTenantOnboarding?: boolean; passwordChangedAt?: Date; tokenVersion?: { increment: number };
};
type PublicRole = StoredPlatformRole & { id: string; tenantId: string; code: string; description: string | null; enabledBusinessScopes: unknown };
type RoleWrite = { code: string; name: string; description?: string | null; scope: StoredPlatformRoleScope; fixedAllPermissions: boolean;
  enabledBusinessScopes: string[]; buttonPermissions: string[]; dataScope: StoredPlatformDataScope; isActive: boolean };
type StoredOrganization = { id: string; tenantId: string; parentId: string | null; type: StoredPlatformRoleScope;
  code: string; name: string; status: string };
type OrganizationWrite = { parentId?: string; type: StoredPlatformRoleScope; code: string; name: string; status?: string };
type ParameterContent = { [key: string]: PlatformJsonValue | undefined };
export interface PlatformManagementTransaction extends PlatformAuthTransaction {
  user: PlatformUserStore & {
    findMany(query: { where: { tenantId: string; isSaasAdmin?: boolean }; include: PublicUserInclude;
      orderBy: { account: "asc" } }): PromiseLike<StoredPlatformUser[]>;
    create(query: { data: Omit<UserWrite, "tokenVersion"> & { id: string; tenantId: string; account: string; displayName: string; passwordHash: string } }): PromiseLike<{ id: string }>;
    update(query: { where: { id: string }; data: UserWrite }): PromiseLike<unknown>;
  };
  tenant: {
    findUnique: PlatformAuthDataStore["tenant"]["findUnique"];
    findMany(query: { where: { id?: string; code?: { not: string } }; orderBy: { code: "asc" };
      include: { _count: { select: { users: true; organizations: true } } } }): PromiseLike<Array<StoredPlatformTenant & {
        statusReason: string | null; createdAt: Date; updatedAt: Date; _count: { users: number; organizations: number }
      }>>;
    create(query: { data: { id: string; code: string; name: string; operatorShortName?: string | null; status: "ACTIVE" } }): PromiseLike<StoredPlatformTenant>;
    update(query: { where: { id: string }; data: { name?: string; operatorShortName?: string | null;
      status?: StoredPlatformTenant["status"]; statusReason?: string; statusChangedAt?: Date; statusChangedBy?: string } }): PromiseLike<unknown>;
  };
  organizationUnit: {
    findFirst(query: { where: { id?: string | { not: string | undefined }; tenantId: string; code?: string } }): PromiseLike<StoredOrganization | null>;
    findUnique(query: { where: { id: string } }): PromiseLike<StoredOrganization | null>;
    findMany(query: { where: { tenantId?: string; id?: string }; orderBy: Array<{ tenantId?: "asc"; code?: "asc" }> }): PromiseLike<StoredOrganization[]>;
    create(query: { data: OrganizationWrite & { id: string; tenantId: string } }): PromiseLike<StoredOrganization>;
    update(query: { where: { id: string }; data: OrganizationWrite | { status: string } }): PromiseLike<StoredOrganization>;
  };
  systemParameterSet: {
    findFirst(query: { where: { tenantId: string; module: string; status: "EFFECTIVE" }; orderBy: { versionNo: "desc" } }): PromiseLike<{
      id: string; versionNo: number; content: PlatformJsonValue
    } | null>;
    create(query: { data: { tenantId: string; module: string; versionNo: number; status: "EFFECTIVE";
      content: ParameterContent; operator: string } }): PromiseLike<unknown>;
    updateMany(query: { where: { id: string; tenantId: string; module: string; versionNo: number; status: "EFFECTIVE" };
      data: { content: ParameterContent; operator: string } }): PromiseLike<{ count: number }>;
  };
  role: {
    findMany(query: { where: { tenantId: string; id?: { in: string[] }; isActive?: boolean; code?: string };
      include: { permissions: { include: { permission: true } } };
      orderBy?: Array<{ fixedAllPermissions?: "desc"; code?: "asc" }> }): PromiseLike<PublicRole[]>;
    create(query: { data: RoleWrite & { id: string; tenantId: string } }): PromiseLike<{ id: string }>;
    update(query: { where: { id: string }; data: RoleWrite }): PromiseLike<unknown>;
    delete(query: { where: { id: string } }): PromiseLike<unknown>;
    findUnique(query: { where: { id: string }; include: { _count: { select: { users: true; userAssignments: true } } } }): PromiseLike<{
      tenantId: string; fixedAllPermissions: boolean; _count: { users: number; userAssignments: number }
    } | null>;
  };
  permission: {
    findMany(query: { where?: { code: { in: string[] } }; orderBy?: { code: "asc" } }): PromiseLike<Array<{
      id: string; code: string; name: string; description: string | null; module: string; kind: "MENU" | "ACTION" | "BUTTON"
    }>>;
    upsert(query: { where: { code: string }; create: { id: string; code: string; name: string; module: string; kind: "ACTION" };
      update: { name: string; module: string } }): PromiseLike<unknown>;
  };
  userRole: {
    deleteMany(query: { where: { userId: string } }): PromiseLike<{ count: number }>;
    createMany(query: { data: Array<{ userId: string; roleId: string }> }): PromiseLike<{ count: number }>;
  };
  rolePermission: {
    deleteMany(query: { where: { roleId: string } }): PromiseLike<{ count: number }>;
    createMany(query: { data: Array<{ roleId: string; permissionId: string }> }): PromiseLike<{ count: number }>;
  };
  operationLog: { create(query: { data: { tenantId: string; userId?: string; action: string;
    detail: { [key: string]: PlatformJsonValue | undefined } } }): PromiseLike<unknown> };
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
}

export type PlatformManagementDatabase = Omit<PlatformAuthDataStore, "$transaction"> & {
  $transaction<T>(work: (transaction: PlatformManagementTransaction) => Promise<T>,
    options?: { isolationLevel: "ReadCommitted" | "Serializable" }): Promise<T>;
  /** 仅部署初始化入口读取，不由HTTP请求决定是否创建SaaS账号。 */
  tenant: PlatformManagementTransaction["tenant"];
};
