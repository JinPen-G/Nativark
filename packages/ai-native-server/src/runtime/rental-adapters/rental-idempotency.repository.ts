/** 原 Nest 幂等存储适配，原收据表与当前Auth/ALS空间解析保持同一事务来源。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  RentalIdempotencyRepository as RentalMysqlIdempotencyRepository,
  type RentalIdempotencyStore as CoreIdempotencyStore
} from "@rental-os/rental-core/mysql-idempotency";
import { PrismaService } from "./prisma.service";
import { resolveScopeWorkspaceId } from "@rental-os/rental-core/mysql-workspace-scope";

export { requestFingerprint, assertSameRequest, type IdempotencyHit } from "@rental-os/rental-core/mysql-idempotency";
export type RentalIdempotencyTx = Prisma.TransactionClient;
export type RentalIdempotencyStore = CoreIdempotencyStore<Prisma.TransactionClient>;

@Injectable()
export class RentalIdempotencyRepository extends RentalMysqlIdempotencyRepository<Prisma.TransactionClient> {
  constructor(prisma: PrismaService) {
    super({
      rentalOrderIdempotencyRecord: {
        findFirst: (input) => prisma.rentalOrderIdempotencyRecord.findFirst(input),
        create: (input) => prisma.rentalOrderIdempotencyRecord.create(input)
      }
    }, { workspaceId: (tenantId, transaction) => resolveScopeWorkspaceId(transaction ?? prisma, tenantId) });
  }
}
