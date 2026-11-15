/** Rental 原操作幂等记录，收据写入沿调用方事务，空间解析经原服务端接点提供。 */
import { ConflictException } from "@nestjs/common";
import type { InputJsonValue } from "@prisma/client/runtime/library";
import type { RentalIdempotencyTransaction, RentalIdempotencyScope } from "./idempotency-storage";

// 旧消费者保留此出口；公共指纹已独立，避免平台工具为了计算摘要加载租赁仓储。
export { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";

export type { RentalIdempotencyTransaction, RentalIdempotencyScope } from "./idempotency-storage";

/** 首次成功时登记的结果，重复请求据此原样返回。 */
export interface IdempotencyHit {
  orderId: string | null;
  response: unknown;
}

export interface RentalIdempotencyStore<TTransaction = RentalIdempotencyTransaction> {
  find(tenantId: string, action: string, key: string, tx?: TTransaction): Promise<
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
    tx: TTransaction
  ): Promise<void>;
  /** 兼容旧维护端口；没有永久操作墓碑及获批保留依据时拒绝按时间批量删除。 */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

/**
 * RC-04：通用租赁订单动作的业务幂等。
 *
 * 记录写入必须由调用方传入**业务动作所在的那个事务**。若另起事务，
 * 业务提交而幂等记录回滚会让重复请求再次推进状态；反之则会让首次请求
 * 被自己的幂等记录挡住。两种都发生过在别处的等价错误，这里不留这个口子。
 */
export class RentalIdempotencyRepository<TTransaction extends RentalIdempotencyTransaction = RentalIdempotencyTransaction> implements RentalIdempotencyStore<TTransaction> {
  constructor(
    private readonly store: RentalIdempotencyTransaction,
    private readonly scope: RentalIdempotencyScope<TTransaction>
  ) {}

  async find(tenantId: string, action: string, key: string, tx?: TTransaction) {
    const client = tx ?? this.store;
    // SPACE-03：必须按经营空间查。唯一键已是 (workspaceId, action, idempotencyKey)，
    // 只按 tenantId 查会命中同租户**另一个空间**的记录，把别人的结果回放出去。
    const workspaceId = await this.scope.workspaceId(tenantId, tx);
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
    tx: TTransaction
  ) {
    // SPACE-03：幂等键按经营空间隔离——同一个键在两个空间必须各自独立生效，
    // 否则一个空间的重试会回放另一个空间的结果。
    const workspaceId = await this.scope.workspaceId(input.tenantId, tx);
    await tx.rentalOrderIdempotencyRecord.create({
      data: {
        tenantId: input.tenantId,
        workspaceId,
        action: input.action,
        idempotencyKey: input.key,
        requestHash: input.requestHash,
        orderId: input.orderId,
        response: (input.response ?? null) as InputJsonValue
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
