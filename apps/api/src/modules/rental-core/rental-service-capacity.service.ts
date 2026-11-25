/** 原Nest容量接线；供给同一事务和Auth/ALS空间，全部占用/收据算法由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalServiceCapacityService as CoreRentalServiceCapacityService } from "@rental-os/rental-core/mysql-service-capacity";
import { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";
import { resolveScopeWorkspaceId } from "./workspace-scope";

@Injectable()
export class RentalServiceCapacityService extends CoreRentalServiceCapacityService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService) {
    super(prisma, { getRequestIdentity, resolveWorkspaceId: resolveScopeWorkspaceId });
  }
}
