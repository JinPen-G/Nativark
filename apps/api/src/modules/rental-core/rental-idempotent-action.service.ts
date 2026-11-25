/** 原Nest业务动作适配，只供给原事务和幂等仓储；业务授权及提交语义由原链保持。 */
import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  RentalIdempotentActionService as RentalMysqlIdempotentActionService,
  type IdempotentActionInput as CoreIdempotentActionInput
} from "@rental-os/rental-core/mysql-idempotent-actions";
import { PrismaService } from "../database/prisma.service";
import { RentalIdempotencyRepository, type RentalIdempotencyStore } from "./rental-idempotency.repository";

export type IdempotentActionInput<T> = CoreIdempotentActionInput<T, Prisma.TransactionClient>;

@Injectable()
export class RentalIdempotentActionService extends RentalMysqlIdempotentActionService<Prisma.TransactionClient> {
  constructor(
    prisma: PrismaService,
    @Inject(RentalIdempotencyRepository) idempotency: RentalIdempotencyStore
  ) {
    super({ $transaction: (run, options) => prisma.$transaction(run, options) }, idempotency);
  }
}
