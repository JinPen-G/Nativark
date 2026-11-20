/** Prisma 的 schema 无关运行值，直接复用官方运行库及其空值单例。
 * 宿主独占所选 schema 的生成 Client 和类型；公共服务不加载默认生成 Client。
 * 隔离级别沿用 Prisma MySQL 的原字符串协议，不持有连接或替换调用方事务。 */
import { Decimal, PrismaClientKnownRequestError, empty, join, objectEnumValues, raw, sqltag } from "@prisma/client/runtime/library";
import type { Prisma } from "@prisma/client";

export const prismaRuntime = Object.freeze({
  Decimal,
  PrismaClientKnownRequestError,
  sql: sqltag,
  join,
  raw,
  empty,
  // 生成器为这些同一官方单例声明私有类型品牌；只在此连接其生成类型，
  // 不创建、复制或替换空值对象，消费者继续受原 Json 输入类型约束。
  DbNull: objectEnumValues.instances.DbNull as unknown as Prisma.NullTypes.DbNull,
  JsonNull: objectEnumValues.instances.JsonNull as unknown as Prisma.NullTypes.JsonNull,
  AnyNull: objectEnumValues.instances.AnyNull as unknown as Prisma.NullTypes.AnyNull,
  TransactionIsolationLevel: Object.freeze({
    ReadUncommitted: "ReadUncommitted",
    ReadCommitted: "ReadCommitted",
    RepeatableRead: "RepeatableRead",
    Serializable: "Serializable",
  } as const),
});
