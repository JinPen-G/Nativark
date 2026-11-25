/** 原 Nest 品类 provider，当前绑定和历史版本由 Rental 正式实现按同一数据源读取。 */
import { Injectable } from "@nestjs/common";
import { RentalCategoryResolver as RentalCategoryRuntime } from "@rental-os/rental-core/category-runtime";
import { PrismaService } from "../database/prisma.service";

export {
  parsePublishedRentalCategory,
  resolveRentalCategoryVersionBody,
  type ResolvedRentalCategory
} from "@rental-os/rental-core/category-runtime";

@Injectable()
export class RentalCategoryResolver extends RentalCategoryRuntime {
  constructor(prisma: PrismaService) {
    super({
      rentalCategoryDefinition: {
        findFirst: (input) => prisma.rentalCategoryDefinition.findFirst(input)
      },
      rentalCategoryVersion: {
        findUnique: (input) => prisma.rentalCategoryVersion.findUnique(input),
        findMany: (input) => prisma.rentalCategoryVersion.findMany(input)
      },
      businessWorkspace: {
        findFirst: (input) => prisma.businessWorkspace.findFirst(input)
      },
      tenant: {
        findUnique: (input) => prisma.tenant.findUnique(input)
      }
    });
  }
}
