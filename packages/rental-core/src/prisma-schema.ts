/** Rental数据贡献沿公共组合规则供宿主生成自己的客户端。
 * 这里只返回源码；固定来源、迁移执行和原库恢复由部署宿主负责。 */
import { composeCorePrismaSchema, type CorePrismaPublicRelations } from "@rental-os/core-contracts/prisma";

export type RentalPublicRelationExtensions = CorePrismaPublicRelations;

export function composeRentalPrismaSchema(platform: string, rental: string,
  publicRelations: RentalPublicRelationExtensions): string {
  return composeCorePrismaSchema(platform, [{ id: "rental", schema: rental, publicRelations }]);
}
