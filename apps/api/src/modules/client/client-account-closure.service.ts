/** 原Nest入口只供给原客户Auth、状态门禁及审计；本人注销由Rental包保持同一提交顺序。 */
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ClientAccountClosureService as RentalClientAccountClosureService } from "@rental-os/rental-core/mysql-client-account-closure";
import { OperationLogService } from "../../common/operation-log.service";
import { PrismaService } from "../database/prisma.service";
import { CustomerMergeService } from "../platform/customer-merge.service";
import { CustomerOperationsService } from "../platform/customer-operations.service";
import { ClientAuthService } from "./client-auth.service";

@Injectable()
export class ClientAccountClosureService extends RentalClientAccountClosureService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, auth: ClientAuthService, operations: CustomerOperationsService,
    closability: CustomerMergeService, @Optional() operationLog?: OperationLogService) {
    super(prisma, auth, operations, closability, operationLog);
  }
}
