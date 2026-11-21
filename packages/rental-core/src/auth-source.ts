/** Rental 认证所需的原账号、会话及经营空间权威；不接受客户端自报权限。
 * 持久化宿主和原组合宿主提供同一组方法，事务和票据寿命仍由原 Auth 持有。 */
import type { Prisma } from "@prisma/client";
import type { PlatformAuthenticationSource } from "@rental-os/platform-server/auth-session";
import type { PlatformAuthDataStore } from "@rental-os/platform-server/auth-store";
import type { TenantSummary } from "./auth-contracts";
import type { RentalWorkspacePrincipalRepository, RentalWorkspaceAccessTransaction } from "./mysql-workspace-principal";
import type { resolveUserBusinessLocationScope } from "./business-location-scope";

export type RentalAuthenticationSource = Omit<PlatformAuthenticationSource, "findTenantByIdForAuth" | "getAuthSession">
  & Pick<RentalWorkspacePrincipalRepository<Prisma.TransactionClient>,
    "listUserWorkspaces" | "resolveSessionWorkspaceId" | "findWorkspaceScopedUser"
    | "resolveTrustedWorkspacePrincipal">
  & Pick<RentalWorkspacePrincipalRepository<RentalWorkspaceAccessTransaction>,
    "lockWorkspaceSessionUser" | "readWorkspaceSessionUser" | "lockMemberSessionUser" | "readMemberSessionUser">
  & {
    getAuthSession(id: string, transaction?: Prisma.TransactionClient): ReturnType<PlatformAuthenticationSource["getAuthSession"]>;
    findTenantByIdForAuth(id: string): TenantSummary | Promise<TenantSummary>;
    getWorkspaceCategoryContext(tenantId: string, workspaceId: string): Promise<{
      categoryCode?: TenantSummary["categoryCode"]; categoryName?: string; capabilities?: TenantSummary["capabilities"];
    }>;
    isLegacyVehicleDomainWorkspaceAllowed(tenantId: string, workspaceId: string): Promise<boolean>;
    setSessionWorkspace(sessionId: string, workspaceId: string | null, expectedWorkspaceId?: string | null): Promise<boolean | void>;
    setLocalDemoAccountPassword(password: string): Promise<void>;
    assertTrustedSaasManagement(binding: { userId: string; tenantId: string }, transaction: Prisma.TransactionClient):
      Promise<Readonly<{ userId: string; tenantId: string }>>;
  };

export type RentalAuthenticationDatabase = PlatformAuthDataStore
  & NonNullable<Parameters<typeof resolveUserBusinessLocationScope>[3]>;
