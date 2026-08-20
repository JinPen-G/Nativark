import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import {
  RentalIdempotencyRepository,
  assertSameRequest,
  requestFingerprint,
  type RentalIdempotencyStore,
  type RentalIdempotencyTx
} from "./rental-idempotency.repository";

/** 事务内发现同键已提交时抛出，用于回滚本次并在外层返回既有结果。 */
class IdempotentReplay extends Error {
  constructor(readonly response: unknown) {
    super("idempotent replay");
  }
}

export interface IdempotentActionInput<T> {
  tenantId: string;
  action: string;
  /** 调用方传入的键；为空时由 fallbackKey 兜底。 */
  key?: string;
  fallbackKey: string;
  /** 参与指纹的请求内容。同键不同内容将被判为冲突。 */
  request: unknown;
  orderId: string;
  /** 在事务内执行业务变更，返回要登记并回放的结果。 */
  run: (tx: RentalIdempotencyTx) => Promise<T>;
  /**
   * 从登记的响应快照还原结果，用于重放。
   * 返回 undefined 表示"不可重放"——调用方据此让业务逻辑重新执行，
   * 由状态机给出正确的拒绝，而不是回放一个陈旧的成功结果。
   */
  replay: (response: unknown) => Promise<T | undefined>;
}

/**
 * RC-04：订单动作的统一幂等执行器。
 *
 * 把「事务外预检 → 事务内重查 → 业务写入 → 幂等登记」收成一处。
 * 分散到每个动作各写一遍时，很容易漏掉事务内那次重查——只有事务外检查的话，
 * 并发同键会双双通过，两边都推进状态。
 *
 * 关于回放与状态机的先后：幂等只覆盖「同一次意图的重试」，不得把非法状态转移
 * 伪装成重放。因此调用方的 fallbackKey 必须纳入订单当前状态，且 replay 只在
 * 状态仍然合法时才返回结果——否则「已完成订单再次确认」会命中当初那次成功的
 * 记录并回放 201，把本该 409 的非法动作放行。
 */
@Injectable()
export class RentalIdempotentActionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RentalIdempotencyRepository) private readonly idempotency: RentalIdempotencyStore
  ) {}

  /**
   * 返回值带 `replayed` 标记：调用方据此跳过通知等**外部副作用**。
   *
   * 通知刻意不放进事务：它是对外部系统的副作用（当前是 mock adapter，将来是真 provider），
   * 事务回滚撤不回已发出的短信。正确边界是"只在首次真正执行时发"，
   * 因此由执行器告知本次是否为回放，而不是把副作用拖进事务。
   */
  async executeWithReplayFlag<T>(input: IdempotentActionInput<T>): Promise<{ result: T; replayed: boolean }> {
    let replayed = false;
    const result = await this.execute({
      ...input,
      // 以"是否走了回放"判定，而不是以"run 有没有被调用"判定：
      // run 被调用不代表提交成功——事务内若发现同键已提交会回滚并转入回放，
      // 那种情况下 run 跑过但结果被丢弃，通知不该再发一次。
      replay: async (response) => {
        const value = await input.replay(response);
        if (value !== undefined) replayed = true;
        return value;
      }
    });
    return { result, replayed };
  }

  async execute<T>(input: IdempotentActionInput<T>): Promise<T> {
    const key = input.key?.trim() || input.fallbackKey;
    const fingerprint = requestFingerprint(input.request);

    // 事务外先命中，避免重复请求白跑一遍状态检查与库存读取。
    const early = await this.idempotency.find(input.tenantId, input.action, key);
    if (early) {
      assertSameRequest(early, fingerprint);
      const replayed = await input.replay(early.response);
      if (replayed !== undefined) return replayed;
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const result = await input.run(tx);

          // 事务内必须再查一次：与事务外那次之间存在窗口，
          // 并发同键会双双通过外层检查。这里连同唯一约束一起兜住。
          const inTx = await this.idempotency.find(input.tenantId, input.action, key, tx);
          if (inTx) {
            assertSameRequest(inTx, fingerprint);
            throw new IdempotentReplay(inTx.response);
          }
          await this.idempotency.record(
            {
              tenantId: input.tenantId,
              action: input.action,
              key,
              requestHash: fingerprint,
              orderId: input.orderId,
              response: result
            },
            tx
          );
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );
    } catch (error) {
      if (error instanceof IdempotentReplay) {
        const replayed = await input.replay(error.response);
        if (replayed !== undefined) return replayed;
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      // 并发同键撞唯一约束：先到者已提交，回放它的结果而不是报错。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.idempotency.find(input.tenantId, input.action, key);
        const replayed = winner ? await input.replay(winner.response) : undefined;
        if (replayed !== undefined) return replayed;
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("订单正在被其他请求处理，请稍后重试");
      }
      throw error;
    }
  }
}
