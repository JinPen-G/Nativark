import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateRentalOrderRequest,
  RentalQuoteSnapshotV1
} from "@store-rental/shared";
import { PrismaService } from "../database/prisma.service";
import {
  RentalIdempotencyRepository,
  assertSameRequest,
  requestFingerprint,
  type RentalIdempotencyStore
} from "./rental-idempotency.repository";
import {
  RentalBusinessFactRepository,
  type RentalBusinessFactStore
} from "./rental-business-fact.repository";
import { RentalBusinessService, type BusinessContext } from "./rental-business.service";
import {
  RentalCoreFactRepository,
  type RentalCoreFactStore
} from "./rental-core-fact.repository";
import { RentalCoreService } from "./rental-core.service";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function quoteSnapshotFingerprint(quote: RentalQuoteSnapshotV1) {
  return JSON.stringify(canonicalize({
    categoryCode: quote.categoryCode,
    request: quote.request,
    chargeLines: quote.chargeLines,
    rentalAmount: quote.rentalAmount,
    discountAmount: quote.discountAmount,
    couponAmount: quote.couponAmount,
    serviceAmount: quote.serviceAmount,
    depositAmount: quote.depositAmount,
    payableAmount: quote.payableAmount,
    pricingPlanVersion: quote.pricingPlanVersion,
    ruleVersion: quote.ruleVersion,
    ruleSnapshot: quote.ruleSnapshot,
    calendarVersion: quote.calendarVersion,
    appliedDiscountPlanIds: quote.appliedDiscountPlanIds,
    customerCouponId: quote.customerCouponId,
    expiresAt: quote.expiresAt
  }));
}

const ORDER_CREATE_ACTION = "rental.order.create";

/** 事务内发现同键已提交时抛出，用于回滚本次并在外层返回既有订单。 */
class IdempotentReplay extends Error {
  constructor(readonly orderId: string | null) {
    super("idempotent replay");
  }
}

@Injectable()
export class RentalOrderConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: RentalCoreService,
    private readonly business: RentalBusinessService,
    @Inject(RentalCoreFactRepository) private readonly coreFacts: RentalCoreFactStore,
    @Inject(RentalBusinessFactRepository) private readonly businessFacts: RentalBusinessFactStore,
    @Inject(RentalIdempotencyRepository) private readonly idempotency: RentalIdempotencyStore
  ) {}

  async createOrder(
    tenantId: string,
    input: CreateRentalOrderRequest,
    userName: string,
    context: BusinessContext,
    idempotencyKey?: string
  ) {
    // 未显式传键时退回 quoteId：报价一次性使用，天然是这次下单的唯一标识。
    const key = idempotencyKey?.trim() || `quote:${input.quoteId}`;
    const fingerprint = requestFingerprint(input);

    // 事务外先快速命中，避免重复请求白跑一遍报价校验与库存锁。
    const early = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key);
    if (early) {
      assertSameRequest(early, fingerprint);
      const replayed = early.orderId ? await this.coreFacts.findOrder(tenantId, early.orderId) : undefined;
      if (replayed) return replayed;
    }

    const quote = this.business.consumeQuote(tenantId, context, input.quoteId);
    this.assertOrderMatchesQuote(input, quote);

    const committedAt = new Date().toISOString();
    const coupon = this.business.validateCouponForOrder(
      tenantId,
      context,
      quote.customerCouponId,
      quote.request.customerId,
      committedAt
    );
    const order = await this.core.prepareOrder(tenantId, input, userName, quote);

    try {
      await this.prisma.$transaction(async (tx) => {
        // 先锁定序列化资产或数量余额，再在同一事务内按最新预占重新计算。
        // 并发请求会在这里串行，后到者不能继续使用事务外看到的陈旧可用量。
        await this.core.assertAvailabilityWithLocks(tenantId, {
          locationId: input.fulfillmentLocationId,
          startAt: input.startAt,
          endAt: input.endAt,
          lines: input.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))
        }, tx);

        // 故意先写订单聚合，再校验并消费报价、锁券；后续任一步失败都必须证明
        // 前面的订单、订单行和库存预占会随同一事务整体回滚。
        await this.coreFacts.saveOrderAggregate(order, [], tx);

        const storedQuote = await this.businessFacts.findQuote(tenantId, quote.id, tx);
        if (!storedQuote) throw new ConflictException("报价事实不存在，请重新报价");
        if (storedQuote.consumedAt) throw new ConflictException("报价已被使用，请重新报价");
        if (new Date(storedQuote.expiresAt).getTime() < new Date(committedAt).getTime()) {
          throw new ConflictException("报价已过期，请重新报价");
        }
        if (quoteSnapshotFingerprint(storedQuote) !== quoteSnapshotFingerprint(quote)) {
          throw new ConflictException("报价事实已变化，请重新报价");
        }

        const quoteConsumed = await this.businessFacts.consumeQuoteIfAvailable(
          tenantId,
          quote.id,
          order.id,
          committedAt,
          tx
        );
        if (!quoteConsumed) throw new ConflictException("报价已失效或被使用，请重新报价");

        if (coupon) {
          const couponLocked = await this.businessFacts.lockCouponIfAvailable(
            tenantId,
            coupon.id,
            quote.request.customerId,
            order.id,
            committedAt,
            tx
          );
          if (!couponLocked) throw new ConflictException("优惠券已失效或被占用，请重新报价");
        }

        // 事务内必须再查一次：事务外那次检查与此处之间存在窗口，
        // 并发同键会双双通过外层检查。这里连同唯一约束一起兜住。
        const inTx = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key, tx);
        if (inTx) {
          assertSameRequest(inTx, fingerprint);
          throw new IdempotentReplay(inTx.orderId);
        }
        // 与订单聚合、报价消费、券锁定同一事务提交：任一步失败则幂等记录一并回滚，
        // 不会出现"已记幂等但业务未生效"或反之。
        await this.idempotency.record(
          { tenantId, action: ORDER_CREATE_ACTION, key, requestHash: fingerprint, orderId: order.id, response: { orderId: order.id } },
          tx
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      // 并发同键：先到者已提交，本次回滚后返回它的结果，而不是报错或重复建单。
      if (error instanceof IdempotentReplay) {
        const replayed = error.orderId ? await this.coreFacts.findOrder(tenantId, error.orderId) : undefined;
        if (replayed) return replayed;
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key);
        const replayed = winner?.orderId ? await this.coreFacts.findOrder(tenantId, winner.orderId) : undefined;
        if (replayed) return replayed;
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("库存正在被其他订单占用，请稍后重试");
      }
      throw error;
    }

    this.business.applyOrderConfirmationToCache(quote, coupon, order.id, committedAt);
    return order;
  }

  private assertOrderMatchesQuote(input: CreateRentalOrderRequest, quote: RentalQuoteSnapshotV1) {
    const quotedLines = quote.request.lines.map((line) => `${line.itemGroupId}:${line.quantity}`).sort();
    const orderLines = input.lines.map((line) => `${line.itemGroupId}:${line.quantity}`).sort();
    if (
      quote.request.fulfillmentMode !== input.fulfillmentMode ||
      quote.request.fulfillmentLocationId !== input.fulfillmentLocationId ||
      quote.request.returnLocationId !== input.returnLocationId ||
      quote.request.startAt !== input.startAt ||
      quote.request.endAt !== input.endAt ||
      quote.request.customerType !== input.customerType ||
      quote.request.customerId !== input.customerId ||
      JSON.stringify(quotedLines) !== JSON.stringify(orderLines)
    ) {
      throw new BadRequestException("订单内容与服务端报价快照不一致");
    }
  }
}
