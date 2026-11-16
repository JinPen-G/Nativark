/** 冻结检查/配货依据的私有MySQL读取视图；原完整身份、当前空间与可见条件由宿主供给。 */
import type { Prisma } from "@prisma/client";
import type { RentalFactRequestContext } from "./fact-request-context";

export interface RentalScopedFactRead {
  businessWorkspace: Pick<Prisma.TransactionClient["businessWorkspace"], "findFirst">;
}

export interface RentalInspectionBasisRead extends RentalScopedFactRead {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  rentalOrder: Pick<Prisma.TransactionClient["rentalOrder"], "findFirst">;
  rentalAllocation: Pick<Prisma.TransactionClient["rentalAllocation"], "findMany">;
}

export interface RentalAllocationPickupRead extends RentalScopedFactRead {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
  rentalOrder: Pick<Prisma.TransactionClient["rentalOrder"], "findFirst">;
  rentalAllocation: Pick<Prisma.TransactionClient["rentalAllocation"], "findFirst">;
  rentalAsset: Pick<Prisma.TransactionClient["rentalAsset"], "findFirst">;
  rentalInspectionRecord: Pick<Prisma.TransactionClient["rentalInspectionRecord"], "findFirst">;
}

export interface RentalFrozenFactContacts extends Pick<RentalFactRequestContext, "getRequestIdentity"> {
  resolveWorkspaceId(client: RentalScopedFactRead, tenantId: string): PromiseLike<string>;
}
