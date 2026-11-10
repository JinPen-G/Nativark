import { ConflictException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { resolveScopeWorkspaceId } from "./workspace-scope";

export type RentalIdempotencyTx = Prisma.TransactionClient;

/** 首次成功时登记的结果，重复请求据此原样返回。 */
export interface IdempotencyHit {
  orderId: string | null;
  response: unknown;
}

export interface RentalIdempotencyStore {
  find(tenantId: string, action: string, key: string, tx?: RentalIdempotencyTx): Promise<
    { requestHash: string; orderId: string | null; response: unknown; status?: string } | undefined
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
  /** 兼容旧维护端口；没有永久操作墓碑及获批保留依据时拒绝按时间批量删除。 */
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
    // SPACE-03：必须按经营空间查。唯一键已是 (workspaceId, action, idempotencyKey)，
    // 只按 tenantId 查会命中同租户**另一个空间**的记录，把别人的结果回放出去。
    const workspaceId = await resolveScopeWorkspaceId(client, tenantId);
    const row = await client.rentalOrderIdempotencyRecord.findFirst({
      where: { tenantId, workspaceId, action, idempotencyKey: key }
    });
    return row
      ? { requestHash: row.requestHash, orderId: row.orderId, response: row.response as unknown, status: row.status }
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
    // SPACE-03：幂等键按经营空间隔离——同一个键在两个空间必须各自独立生效，
    // 否则一个空间的重试会回放另一个空间的结果。
    const workspaceId = await resolveScopeWorkspaceId(tx, input.tenantId);
    await tx.rentalOrderIdempotencyRecord.create({
      data: {
        tenantId: input.tenantId,
        workspaceId,
        action: input.action,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        orderId: input.orderId,
        response: (input.response ?? null) as Prisma.InputJsonValue
      }
    });
  }

  async deleteOlderThan(_cutoff: Date): Promise<number> {
    throw new ConflictException("原操作身份尚无安全清理依据，禁止仅按年龄删除幂等记录");
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
