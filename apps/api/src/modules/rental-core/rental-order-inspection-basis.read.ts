/** 原冻结检查读取兼容入口，提供同一身份/空间接点，业务依据由Rental包读取。 */
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { resolveScopeWorkspaceId } from "./workspace-scope";
import { readOrderInspectionBasisInput as readRentalBasis } from "@rental-os/rental-core/mysql-order-inspection-basis";
export * from "@rental-os/rental-core/mysql-order-inspection-basis";

export function readOrderInspectionBasisInput(prisma: PrismaService, tenantId: string, workspaceId: string,
  orderId: string, visibility: () => Prisma.RentalOrderWhereInput) {
  return readRentalBasis(prisma, tenantId, workspaceId, orderId, visibility, {
    getRequestIdentity, resolveWorkspaceId: resolveScopeWorkspaceId
  });
}
