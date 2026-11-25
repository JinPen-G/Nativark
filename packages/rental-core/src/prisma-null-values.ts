/** Rental 所选 Client 的 JSON 空值输入。仅连接生成器的私有类型品牌，
 * 三个值仍为官方 runtime 的原单例；不加载默认 Client，不新建空值对象。 */
import { prismaRuntime } from "@rental-os/platform-server/prisma-runtime";
import type { Prisma } from "@prisma/client";

export const rentalPrismaNulls = Object.freeze({
  DbNull: prismaRuntime.DbNull as unknown as Prisma.NullTypes.DbNull,
  JsonNull: prismaRuntime.JsonNull as unknown as Prisma.NullTypes.JsonNull,
  AnyNull: prismaRuntime.AnyNull as unknown as Prisma.NullTypes.AnyNull,
});
