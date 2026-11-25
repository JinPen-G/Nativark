/** 原客户限流的唯一Nest实例，Guard、Auth及生命周期共用Rental原实现。 */
import { Injectable } from "@nestjs/common";
import { ClientApiRateLimitService as RentalClientRateLimitService } from "@rental-os/rental-core/mysql-client-rate-limit";
import { PrismaService } from "../database/prisma.service";
export * from "@rental-os/rental-core/mysql-client-rate-limit";

@Injectable()
export class ClientApiRateLimitService extends RentalClientRateLimitService {
  constructor(prisma: PrismaService) { super(prisma); }
}
