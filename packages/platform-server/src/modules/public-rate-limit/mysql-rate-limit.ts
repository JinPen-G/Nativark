/** 原客户端持久桶的共用计数内核。哈希/窗口/原子 SQL 保持原键，读取不确定时拒绝。
 * 业务规则、租户权威与清理生命周期由原调用者持有。 */
import { ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { prismaRuntime } from "../../prisma-runtime";
import { CLIENT_API_RATE_LIMIT_TABLE, PLATFORM_API_RATE_LIMIT_TABLE,
  type RateLimitWindow, type SqlRateLimitStore, type SqlRateLimitTable, type SqlRateLimitTransaction } from "./rate-limit.store";

const sqlTables = {
  [CLIENT_API_RATE_LIMIT_TABLE]: { insert: prismaRuntime.raw("client_api_rate_buckets"),
    select: prismaRuntime.raw("`client_api_rate_buckets`") },
  [PLATFORM_API_RATE_LIMIT_TABLE]: { insert: prismaRuntime.raw("platform_api_rate_buckets"),
    select: prismaRuntime.raw("`platform_api_rate_buckets`") }
} as const;

export const WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE = { code: "website_demo_request", windowSeconds: 600, limit: 5 };

export function hashRateLimitScope(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedIp(ip?: string) {
  const value = ip?.trim();
  return value && value.length <= 128 ? value : "unknown";
}

/** 复用宿主可信代理解析后的 request.ip，缺失时沿原 socket 地址后备，保持原 unknown 桶。 */
export function clientAddress(request: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return normalizedIp(request.ip ?? request.socket?.remoteAddress);
}

export async function consumeRateLimitBucket<Tx extends SqlRateLimitTransaction>(
  store: SqlRateLimitStore<Tx>, rule: RateLimitWindow, identity: string, now: number,
  beforeIncrement?: (transaction: Tx) => Promise<void>, table: SqlRateLimitTable = CLIENT_API_RATE_LIMIT_TABLE
): Promise<number> {
  // 表名只取本模块的两个静态 SQL 片段，请求内容不参与标识符构造。
  if (typeof table !== "string" || !Object.hasOwn(sqlTables, table)) throw new ServiceUnavailableException("限流数据表配置无效");
  const sqlTable = sqlTables[table];
  const windowMs = rule.windowSeconds * 1000;
  const bucketStart = new Date(Math.floor(now / windowMs) * windowMs);
  const scopeKey = hashRateLimitScope(`client-api:${rule.code}:${identity}`);
  return store.$transaction(async tx => {
    if (beforeIncrement) await beforeIncrement(tx);
    await tx.$executeRaw(prismaRuntime.sql`
      INSERT INTO ${sqlTable.insert} (id, scopeKey, bucketStart, count, createdAt, updatedAt)
      VALUES (${randomUUID()}, ${scopeKey}, ${bucketStart}, 1, NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE count = count + 1, updatedAt = NOW(3)
    `);
    const rows = await tx.$queryRaw<Array<{ count: number | bigint | string }>>(prismaRuntime.sql`
      SELECT \`count\` FROM ${sqlTable.select}
      WHERE \`scopeKey\` = ${scopeKey} AND \`bucketStart\` = ${bucketStart}
      LIMIT 1
    `);
    const count = Number(rows[0]?.count);
    // INSERT 后应读到唯一正整数。缺行或坏结果不能降成零额度后继续业务。
    if (rows.length !== 1 || !["number", "bigint", "string"].includes(typeof rows[0]?.count)
      || !Number.isSafeInteger(count) || count < 1)
      throw new ServiceUnavailableException("限流计数读取失败");
    return count;
  });
}
