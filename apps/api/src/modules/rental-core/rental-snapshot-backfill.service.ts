/** 原启动恢复接线，Rental包维护历史回填；只在原宿主顺序注册一次。 */
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { RentalSnapshotBackfillService as CoreRentalSnapshotBackfillService } from "@rental-os/rental-core/mysql-snapshot-backfill";
import { PrismaService } from "../database/prisma.service";
export type { BackfillTenantResult } from "@rental-os/rental-core/mysql-snapshot-backfill";

@Injectable()
export class RentalSnapshotBackfillService extends CoreRentalSnapshotBackfillService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, config: ConfigService) { super(prisma, config); }
}
