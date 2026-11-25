/** Rental订阅兼容入口。原数据库和动态品类参加者供给同一公共实现，保留原Core调用与员工投影。 */
import { Injectable } from "@nestjs/common";
import { SubscriptionService as PlatformSubscriptionService } from "@rental-os/platform-server/subscription";
import { PrismaService } from "../database/prisma.service";
import { assertPublishedRentalCategoryIdentities, rentalCategoryIdentityOptions, type RentalCategoryIdentityReader } from "../rental-core/category-identity";

@Injectable()
export class SubscriptionService extends PlatformSubscriptionService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      // 此参加者只由Rental宿主构造，transaction来自上面的同一Prisma实例和原办理事务。
      assertPublished: (transaction, codes) => assertPublishedRentalCategoryIdentities(transaction as unknown as RentalCategoryIdentityReader, codes),
      labels: tenantId => rentalCategoryIdentityOptions(prisma, tenantId)
    });
  }

  rentalCategoryLabels(tenantId?: string) { return this.categoryLabels(tenantId); }
}
