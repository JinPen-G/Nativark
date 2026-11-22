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
  // 空值保持 schema 无关；所选宿主在唯一 Client 的请求入口映射同义品牌。
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

/** 将公共运行库的三个官方空值映射为所选 Client 的同义单例。
 * 独立生成目录含自己的 runtime，空值品牌不能跨目录直接序列化。
 * 只识别官方单例；普通空对象、Date、Decimal、SQL 和二进制值保持原义。 */
export function mapPrismaNullInputs(value: unknown, selected: Readonly<{
  DbNull: object;
  JsonNull: object;
  AnyNull: object;
}>): unknown {
  if (value === objectEnumValues.instances.DbNull) return selected.DbNull;
  if (value === objectEnumValues.instances.JsonNull) return selected.JsonNull;
  if (value === objectEnumValues.instances.AnyNull) return selected.AnyNull;

  if (Array.isArray(value)) {
    let changed: unknown[] | undefined;
    for (let index = 0; index < value.length; index++) {
      const mapped = mapPrismaNullInputs(value[index], selected);
      if (mapped !== value[index]) {
        changed ??= value.slice();
        changed[index] = mapped;
      }
    }
    return changed ?? value;
  }

  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  let changed: Record<string, unknown> | undefined;
  for (const [key, current] of Object.entries(value)) {
    const mapped = mapPrismaNullInputs(current, selected);
    if (mapped !== current) {
      changed ??= { ...value };
      changed[key] = mapped;
    }
  }
  return changed ?? value;
}
