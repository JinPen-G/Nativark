/** Rental数据贡献沿公共组合规则供宿主生成自己的客户端。
 * 这里只返回源码；固定来源、迁移执行和原库恢复由部署宿主负责。 */
import { composeCorePrismaSchema, type CorePrismaContribution, type CorePrismaPublicRelations } from "@rental-os/core-contracts/prisma";
import { RENTAL_PRISMA_PUBLIC_RELATIONS } from "./prisma-public-relations";

export { RENTAL_PRISMA_PUBLIC_RELATIONS } from "./prisma-public-relations";

export type RentalPublicRelationExtensions = CorePrismaPublicRelations;

export function createRentalPrismaContribution(schema: string): CorePrismaContribution {
  return { id: "rental", schema, publicRelations: RENTAL_PRISMA_PUBLIC_RELATIONS };
}

export function composeRentalPrismaSchema(platform: string, rental: string,
  publicRelations: RentalPublicRelationExtensions = RENTAL_PRISMA_PUBLIC_RELATIONS): string {
  return composeCorePrismaSchema(platform, [{ id: "rental", schema: rental, publicRelations }]);
}
