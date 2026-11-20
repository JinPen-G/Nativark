/** 认证私有存储端口，仅包含真实公共身份操作；ORM及业务模型不穿过此边界。 */
import type { NewPlatformAuthenticationSession, PlatformAuthenticationSession } from "../auth/auth-session.service";

export type StoredPlatformRoleScope = "OPERATOR" | "CAR_SHOP" | "STORE" | "STATION";
export type StoredPlatformDataScope = "ALL" | "ORGANIZATION" | "STORE" | "OWN";
export type StoredTenantStatus = "ACTIVE" | "FROZEN" | "DISABLED";
export type PlatformJsonValue = null | boolean | number | string | PlatformJsonValue[] | {
  [key: string]: PlatformJsonValue | undefined;
};
export interface StoredPlatformTenant {
  id: string; code: string; name: string; operatorShortName: string | null; status: StoredTenantStatus;
}
export interface StoredPlatformRole {
  id: string; name: string; isActive: boolean; fixedAllPermissions: boolean;
  scope: StoredPlatformRoleScope; dataScope: StoredPlatformDataScope;
  buttonPermissions: unknown; permissions: Array<{ permission: { code: string } }>;
}
export interface StoredPlatformUser {
  id: string; tenantId: string; account: string; displayName: string; phone: string | null;
  organizationId: string | null; organization: { name: string; type: StoredPlatformRoleScope } | null;
  isPlatformAdmin: boolean; isSaasAdmin: boolean; isActive: boolean; mustChangePassword: boolean;
  needsTenantOnboarding: boolean; passwordHash: string;
  role: StoredPlatformRole | null; roleAssignments: Array<{ role: StoredPlatformRole }>;
}
type UserRolesInclude = {
  organization: true;
  role: { include: { permissions: { include: { permission: true } } } };
  roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } };
};
type StoredUserWrite = { lastLoginAt?: Date; passwordHash?: string; mustChangePassword?: boolean;
  needsTenantOnboarding?: boolean; passwordChangedAt?: Date; tokenVersion?: { increment: number } };
export interface PlatformUserStore {
  findFirst(query: { where: { id?: string; tenantId?: string; account?: string; isActive?: boolean;
    tenant?: { status: StoredTenantStatus } }; include: UserRolesInclude }): PromiseLike<StoredPlatformUser | null>;
  findUnique(query: { where: { id: string } }): PromiseLike<{ passwordHash: string; tokenVersion: number } | null>;
  findUniqueOrThrow(query: { where: { id: string }; include: UserRolesInclude }): PromiseLike<StoredPlatformUser>;
  update(query: { where: { id: string }; data: StoredUserWrite }): PromiseLike<unknown>;
  updateMany(query: { where: { id: string; passwordHash: string; tokenVersion: number };
    data: StoredUserWrite }): PromiseLike<{ count: number }>;
}
export interface PlatformSessionStore {
  create(query: { data: NewPlatformAuthenticationSession }): PromiseLike<PlatformAuthenticationSession>;
  findFirst(query: { where: { id?: string; userId?: string; audience?: string; refreshTokenHash?: string; revokedAt: null; expiresAt: { gt: Date } };
    include?: { user: { include: { tenant: true } } } }): PromiseLike<PlatformAuthenticationSession | null>;
  updateMany(query: { where: { id?: string; userId?: string; revokedAt: null; expiresAt?: { gt: Date } };
    data: { revokedAt: Date } }): PromiseLike<{ count: number }>;
}
interface LoginFailureRecord {
  loginKeyHash: string; failureCount: number; firstFailedAt: Date; lockedUntil: Date | null; expiresAt: Date; revision: number;
}
export interface PlatformLoginFailureStore {
  findUnique(query: { where: { loginKeyHash: string } }): PromiseLike<LoginFailureRecord | null>;
  create(query: { data: LoginFailureRecord }): PromiseLike<unknown>;
  updateMany(query: { where: { loginKeyHash: string; revision: number }; data: {
    failureCount: number; firstFailedAt: Date; lockedUntil: Date | null; expiresAt: Date; revision: { increment: number }
  } }): PromiseLike<{ count: number }>;
  deleteMany(query: { where: { loginKeyHash?: string | { in: string[] }; revision?: number; expiresAt?: { lt: Date } } }): PromiseLike<{ count: number }>;
}
export interface PlatformAuthTransaction {
  user: PlatformUserStore;
  authSession: PlatformSessionStore;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
}
export interface PlatformAuthDataStore extends PlatformAuthTransaction {
  tenant: { findUnique(query: { where: { id?: string; code?: string } }): PromiseLike<StoredPlatformTenant | null> };
  authLoginFailure: PlatformLoginFailureStore;
  systemParameterSet: { findFirst(query: { where: { tenantId: string; module: string; status: "EFFECTIVE" };
    orderBy: { versionNo: "desc" } }): PromiseLike<{ content: PlatformJsonValue } | null> };
  operationLog: { create(query: { data: { tenantId: string; action: string; detail: { [key: string]: PlatformJsonValue | undefined } } }): PromiseLike<unknown> };
  $transaction<T>(work: (transaction: PlatformAuthTransaction) => Promise<T>): Promise<T>;
}

export const PLATFORM_AUTH_DATA_STORE = Symbol("platform.auth.data-store");
