/** 原单项配货/资产依据兼容入口，保留当前身份与可见性，唯一读取/投影由Rental包维护。 */
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { readAllocationPickupInput as readRentalPickup } from "@rental-os/rental-core/mysql-order-allocation-pickup";
export * from "@rental-os/rental-core/mysql-order-allocation-pickup";

export function readAllocationPickupInput(prisma: PrismaService, tenantId: string, workspaceId: string,
  orderId: string, allocationId: string, orderVisibility: () => Prisma.RentalOrderWhereInput,
  assetVisibility: (assetId: string) => Promise<Prisma.RentalAssetWhereInput>) {
  return readRentalPickup(prisma, tenantId, workspaceId, orderId, allocationId, orderVisibility, assetVisibility, {
    getRequestIdentity, resolveWorkspaceId: resolveScopeWorkspaceId
  });
}
