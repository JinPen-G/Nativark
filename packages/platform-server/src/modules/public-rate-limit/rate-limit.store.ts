/** 持久限流只使用宿主同一真实数据库事务及官方参数化 SQL，业务父锁由调用方在该事务供给。 */
import type { Sql } from "@prisma/client/runtime/library";

export const CLIENT_API_RATE_LIMIT_TABLE = "client_api_rate_buckets";
export const PLATFORM_API_RATE_LIMIT_TABLE = "platform_api_rate_buckets";
export type SqlRateLimitTable = typeof CLIENT_API_RATE_LIMIT_TABLE | typeof PLATFORM_API_RATE_LIMIT_TABLE;

export interface SqlRateLimitTransaction {
  $executeRaw(query: Sql): PromiseLike<number>;
  $queryRaw<T = unknown>(query: Sql): PromiseLike<T>;
}

export interface SqlRateLimitStore<Tx extends SqlRateLimitTransaction = SqlRateLimitTransaction> {
  $transaction<T>(work: (transaction: Tx) => Promise<T>): Promise<T>;
}

export interface RateLimitWindow {
  code: string;
  windowSeconds: number;
}
