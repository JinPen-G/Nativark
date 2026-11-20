/** Prisma 的 schema 无关运行值，直接复用官方运行库及其空值单例。
 * 宿主独占所选 schema 的生成 Client 和类型；公共服务不加载默认生成 Client。
 * 隔离级别沿用 Prisma MySQL 的原字符串协议，不持有连接或替换调用方事务。 */
import { Decimal, PrismaClientKnownRequestError, empty, join, objectEnumValues, raw, sqltag } from "@prisma/client/runtime/library";

export const prismaRuntime = Object.freeze({
  Decimal,
  PrismaClientKnownRequestError,
  sql: sqltag,
  join,
  raw,
  empty,
  // 公共层只暴露官方运行库类型；所选 Client 的输入空值品牌由业务包连接。
  DbNull: objectEnumValues.instances.DbNull,
  JsonNull: objectEnumValues.instances.JsonNull,
  AnyNull: objectEnumValues.instances.AnyNull,
  TransactionIsolationLevel: Object.freeze({
    ReadUncommitted: "ReadUncommitted",
    ReadCommitted: "ReadCommitted",
    RepeatableRead: "RepeatableRead",
    Serializable: "Serializable",
  } as const),
});
