import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";

export type RentalIdempotencyTx = Prisma.TransactionClient;

/** 首次成功时登记的结果，重复请求据此原样返回。 */
export interface IdempotencyHit {
  orderId: string | null;
  response: unknown;
}

export interface RentalIdempotencyStore {
  find(tenantId: string, action: string, key: string, tx?: RentalIdempotencyTx): Promise<
    { requestHash: string; orderId: string | null; response: unknown } | undefined
  >;
  record(
    input: {
      tenantId: string;
      action: string;
      key: string;
      requestHash: string;
      orderId: string | null;
      response: unknown;
    },
    tx: RentalIdempotencyTx
  ): Promise<void>;
  /**
   * 删除保留窗口之外的幂等记录，返回删除行数。
   *
   * 必须有清理：这张表每个受保护动作写一行、只增不减，长期运行会无界增长，
   * 而记录价值随时间迅速衰减——客户端网络重试发生在秒级到分钟级，
   * 不会在两周后拿同一个键重发。
   */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

/** 请求体指纹：键名排序后再序列化，避免字段顺序不同被判成不同请求。 */
export function requestFingerprint(payload: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(normalize(payload) ?? null)).digest("hex");
}

/**
 * RC-04：通用租赁订单动作的业务幂等。
 *
 * 记录写入必须由调用方传入**业务动作所在的那个事务**。若另起事务，
 * 业务提交而幂等记录回滚会让重复请求再次推进状态；反之则会让首次请求
 * 被自己的幂等记录挡住。两种都发生过在别处的等价错误，这里不留这个口子。
 */
@Injectable()
export class RentalIdempotencyRepository implements RentalIdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async find(tenantId: string, action: string, key: string, tx?: RentalIdempotencyTx) {
    const client = tx ?? this.prisma;
    const row = await client.rentalOrderIdempotencyRecord.findFirst({
      where: { tenantId, action, idempotencyKey: key }
    });
    return row
      ? { requestHash: row.requestHash, orderId: row.orderId, response: row.response as unknown }
      : undefined;
  }

  async record(
    input: {
      tenantId: string;
      action: string;
      key: string;
      requestHash: string;
      orderId: string | null;
      response: unknown;
    },
    tx: RentalIdempotencyTx
  ) {
    await tx.rentalOrderIdempotencyRecord.create({
      data: {
        tenantId: input.tenantId,
        action: input.action,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        orderId: input.orderId,
        response: (input.response ?? null) as Prisma.InputJsonValue
      }
    });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.rentalOrderIdempotencyRecord.deleteMany({
      where: { createdAt: { lt: cutoff } }
    });
    return result.count;
  }
}

/**
 * 同键但请求体不同属调用方错误，必须报冲突。
 * 返回上一次的结果会让「改了金额后重发同一个键」静默拿到旧订单。
 */
export function assertSameRequest(stored: { requestHash: string }, incomingHash: string) {
  if (stored.requestHash !== incomingHash) {
    throw new ConflictException("相同幂等键提交了不同的请求内容，请更换幂等键");
  }
}
