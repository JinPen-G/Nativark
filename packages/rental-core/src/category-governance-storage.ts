/** Rental品类治理的私有存储和身份接点。宿主供给原认证、当前账号与同一事务；
 * 此处只描述本链使用的方法，清单和领域合同不加载生成模型或取得平台授权。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SystemUserRow } from "@rental-os/platform-contracts";
import type { CapabilityHookRuntime } from "./capability-runtime";

export type RentalCategoryGovernanceStorage = Pick<PrismaClient,
  "$transaction" | "rentalCategoryDefinition" | "rentalCategoryVersion" |
  "rentalCategoryVersionPolicy" | "rentalCategoryGovernanceAudit" | "businessWorkspace" | "tenant">;

export type RentalCategoryGovernanceHooks = Pick<CapabilityHookRuntime,
  "assertCategoryComposition" | "registeredVersions" | "registeredCodes" | "compositionFor">;

export interface RentalCategoryGovernanceSessionReader {
  resolveTrustedPlatformBrowserPrincipal(
    authorization: string | undefined,
    transaction: Prisma.TransactionClient,
    signal: AbortSignal
  ): Promise<{
    readonly userId: string;
    readonly tenantId: string;
    readonly audience: "operator";
    readonly sessionId: string;
    readonly expiresAt: number;
  } | undefined>;
}

export interface RentalCategoryGovernancePrincipalReader {
  findUserById(id: string, transaction?: Prisma.TransactionClient): Promise<SystemUserRow | undefined>;
}
