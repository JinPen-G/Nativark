/** 原报表Nest接线；同一数据库交给Rental只读适配，查询和原错误由包内单源维护。 */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { RentalWorkspaceReportRepository as RentalWorkspaceReportImplementation } from "@rental-os/rental-core/mysql-reports";
export { RentalReportReadLimitError } from "@rental-os/rental-core/mysql-reports";

@Injectable()
export class RentalWorkspaceReportRepository extends RentalWorkspaceReportImplementation {
  constructor(prisma: PrismaService) { super(prisma); }
}
