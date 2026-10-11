import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateRentalOrderRequest,
  RentalQuoteSnapshotV1
} from "@rental-os/shared";
import { PrismaService } from "../database/prisma.service";
import { CapabilityHookRuntime } from "./capability-hook.runtime";
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
import { CustomerCorporateService } from "../platform/customer-corporate.service";
import { CustomerOperationsService } from "../platform/customer-operations.service";
import { RentalServiceCapacityService } from "./rental-service-capacity.service";
import { stampOccurrences } from "./rental-service-occurrence";
import { MembershipService } from "../platform/membership.service";
import type { ApprovedOrderBinding, ApprovedOrderTransaction } from "./approved-order-transaction.ports";

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
    membershipSnapshot: quote.membershipSnapshot,
    membershipBenefitEvaluations: quote.membershipBenefitEvaluations,
    chargeLines: quote.chargeLines,
    rentalAmount: quote.rentalAmount,
    discountAmount: quote.discountAmount,
    couponAmount: quote.couponAmount,
    serviceAmount: quote.serviceAmount,
    fulfillmentAmount: quote.fulfillmentAmount,
    depositAmount: quote.depositAmount,
    preAuthAmount: quote.preAuthAmount,
    payableAmount: quote.payableAmount,
    receivableAmount: quote.receivableAmount,
    pricingPlanVersion: quote.pricingPlanVersion,
    // PRICE-03：订单继承报价命中的价格版本，后续调价不改写这张订单的计价依据。
    priceVersionId: quote.priceVersionId,
    priceVersion: quote.priceVersion,
    rateSnapshot: quote.rateSnapshot,
    ruleVersion: quote.ruleVersion,
    ruleSnapshot: quote.ruleSnapshot,
    calendarVersion: quote.calendarVersion,
    calendarSnapshot: quote.calendarSnapshot,
    calendarWarnings: quote.calendarWarnings,
    appliedDiscountPlanIds: quote.appliedDiscountPlanIds,
    customerCouponId: quote.customerCouponId,
    couponEvaluation: quote.couponEvaluation,
    serviceSnapshots: quote.serviceSnapshots,
    capabilitySnapshot: quote.capabilitySnapshot,
    capabilityDecisions: quote.capabilityDecisions,
    expiresAt: quote.expiresAt
  }));
}

/**
 * 幂等键比较只看客户端业务请求。确认人、权限与时间是控制器按当前鉴权上下文补入的
 * 服务端事实，同一次客户端重试会得到不同的 confirmedAt，不能把它纳入请求指纹。
 */
function orderRequestFingerprint(input: CreateRentalOrderRequest) {
  return requestFingerprint({
    ...input,
    capabilityExceptions: input.capabilityExceptions?.map(
      ({ confirmedBy: _confirmedBy, confirmedWithPermission: _permission, confirmedAt: _confirmedAt, ...confirmation }) =>
        confirmation
    )
  });
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
    @Inject(RentalIdempotencyRepository) private readonly idempotency: RentalIdempotencyStore,
    @Optional() private readonly hooks?: CapabilityHookRuntime,
    /**
     * CUSTOMER-01C：订单主体的解析与校验。
     *
     * 可选注入：不涉及客户主体的既有单测用位置参数构造本服务；缺失时不解析主体，
     * 订单按原语义只存 `customerId`（读取侧回落为三个主体都是该客户）。
     * 这不是 fail-open——主体是**附加**的责任归属信息，缺失不会放宽任何既有校验。
     */
    @Optional() private readonly subjects?: CustomerCorporateService,
    /**
     * CUSTOMER-01：真实订单创建必须消费客户可交易门禁。
     * 保留可选注入仅兼容直接 new 本服务的既有单测；生产 Nest 容器始终注册该服务。
     */
    @Optional() private readonly customerOperations?: CustomerOperationsService,
    @Optional() private readonly serviceCapacities?: RentalServiceCapacityService,
    @Optional() private readonly memberships?: MembershipService
  ) {}

  /**
   * 返回值带 `replayed` 标记：调用方据此跳过下单通知等**外部副作用**。
   * 通知不在事务内，事务回滚撤不回已发出的短信，正确边界是「只在首次真正建单时发」。
   */
  createOrder(tenantId: string, input: CreateRentalOrderRequest, userName: string, context: BusinessContext, idempotencyKey?: string) {
    return this.create(tenantId, input, userName, context, idempotencyKey);
  }

  normalizeOrderInput(input: CreateRentalOrderRequest): CreateRentalOrderRequest {
    return this.memberships && !input.bookingIdentity ? { ...input, bookingIdentity: { bookingIdentity: "personal" } } : input;
  }

  /** Server-only exact original request fingerprint. Shares the same normalization
   * as create(), so adapters must not copy price/order canonicalization rules. */
  fingerprintOrderRequest(input: CreateRentalOrderRequest) {
    return orderRequestFingerprint(this.normalizeOrderInput(structuredClone(input)));
  }

  /** Read the SAME original business key, never consume a quote or retry a write.
   * Caller must bind current identity/scope and supply the persisted accepted
   * request, not a caller-provided hash or a guessed/latest order. */
  async readOrderCreation(tenantId: string, input: CreateRentalOrderRequest, idempotencyKey: string) {
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 191) {
      throw new BadRequestException("缺少原下单操作键");
    }
    const request = this.normalizeOrderInput(structuredClone(input));
    const fingerprint = orderRequestFingerprint(request);
    const hit = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, idempotencyKey.trim());
    if (!hit) return { state: 'not_observed' as const, retryable: false as const, orderId: null };
    if (hit.requestHash !== fingerprint) throw new ConflictException("原下单操作载荷不一致");
    const order = hit.orderId ? await this.coreFacts.findOrder(tenantId, hit.orderId) : undefined;
    if (!order) return { state: 'unknown' as const, retryable: false as const, orderId: null };
    // Both original repositories resolve current ALS workspace in their queries.
    // RentalOrder's domain projection deliberately has no workspaceId field.
    if (order.id !== hit.orderId || order.tenantId !== tenantId
      || order.quoteId !== request.quoteId || order.customerId !== request.customerId) {
      throw new ConflictException("原下单结果绑定不一致");
    }
    return { state: 'observed' as const, retryable: false as const, orderId: order.id };
  }

  createApprovedOrder(tenantId: string, input: CreateRentalOrderRequest, userName: string, context: BusinessContext,
    idempotencyKey: string, approval: ApprovedOrderTransaction) {
    if (!idempotencyKey || !approval || [approval.authorize, approval.recover, approval.prepare, approval.commit, approval.replay]
      .some(method => typeof method !== "function")) throw new BadRequestException("审批执行依赖未就绪");
    const participant: ApprovedOrderTransaction = { authorize: approval.authorize.bind(approval), recover: approval.recover.bind(approval),
      prepare: approval.prepare.bind(approval), commit: approval.commit.bind(approval), replay: approval.replay.bind(approval) };
    return this.create(tenantId, structuredClone(input), userName, structuredClone(context), idempotencyKey, participant);
  }

  private async create(
    tenantId: string,
    input: CreateRentalOrderRequest,
    userName: string,
    context: BusinessContext,
    idempotencyKey?: string,
    approval?: ApprovedOrderTransaction
  ) {
    // 未显式传键时退回 quoteId：报价一次性使用，天然是这次下单的唯一标识。
    input = this.normalizeOrderInput(input);
    const key = idempotencyKey?.trim() || `quote:${input.quoteId}`;
    const fingerprint = orderRequestFingerprint(input);
    const approvalBinding: ApprovedOrderBinding | undefined = approval ? {
      tenantId, workspaceId: this.core.resolveWorkspaceId(tenantId), idempotencyKey: key,
      requestFingerprint: fingerprint, request: structuredClone(input)
    } : undefined;
    const verifyReplay = async (order: { id: string; tenantId: string; workspaceId?: string }) => {
      if (!approval || !approvalBinding) return;
      if (order.tenantId !== tenantId || order.workspaceId !== approvalBinding.workspaceId) throw new ConflictException("审批结果范围不匹配");
      await approval.replay(structuredClone(approvalBinding), order.id);
      await approval.authorize(structuredClone(approvalBinding));
    };
    if (approval && approvalBinding) {
      await approval.authorize(structuredClone(approvalBinding));
      const committedId = await approval.recover(structuredClone(approvalBinding));
      if (committedId !== null) {
        const committed = await this.coreFacts.findOrder(tenantId, committedId);
        if (!committed) throw new ConflictException("审批业务结果待核对");
        await verifyReplay(committed);
        return { order: committed, replayed: true };
      }
    }

    // 事务外先快速命中，避免重复请求白跑一遍报价校验与库存锁。
    const early = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key);
    if (early) {
      assertSameRequest(early, fingerprint);
      const replayed = early.orderId ? await this.coreFacts.findOrder(tenantId, early.orderId) : undefined;
      if (replayed) { await verifyReplay(replayed); return { order: replayed, replayed: true }; }
    }

    const workspaceId = this.core.resolveWorkspaceId(tenantId);
    if (this.customerOperations && input.customerId) {
      const customerGate = await this.customerOperations.assertTransactable(tenantId, workspaceId, input.customerId);
      if (!customerGate.allowed) throw new ConflictException(customerGate.message);
    }

    const quote = this.business.consumeQuote(tenantId, context, input.quoteId);
    this.assertOrderMatchesQuote(input, quote);
    // 报价可锁定权益版本，但提交订单仍须确认“当前员工关系仍有效”。企业主体和
    // 客户姓名都由这里的服务端解析结果覆盖，客户端不能伪造企业付款或历史身份。
    const membershipAtCommit = quote.membershipSnapshot
      ? await this.resolveMembershipAtCommit(tenantId, workspaceId, quote)
      : undefined;
    const orderInput: CreateRentalOrderRequest = membershipAtCommit
      ? {
          ...input,
          customerType: "personal",
          customerId: membershipAtCommit.personalCustomerId,
          customerName: membershipAtCommit.personalCustomerName,
          bookingIdentity: quote.request.bookingIdentity
        }
      : input;
    // 需求 4.5.4：订单确认按租期端点复查营业状态——报价之后运营可能把领取/归还日
    // 覆盖成停业日，确认不能只信报价时的旧判断。
    this.business.assertOrderDaysOpenForConfirmation(tenantId, context, {
      fulfillmentLocationId: input.fulfillmentLocationId,
      returnLocationId: input.returnLocationId,
      startAt: input.startAt,
      endAt: input.endAt,
      fulfillmentMode: input.fulfillmentMode
    });

    const committedAt = new Date().toISOString();
    /**
     * CUSTOMER-01C：解析并校验四类主体。
     *
     * 放在事务**之前**：主体校验是纯读判定（客户归属、合同有效期、经办人授权），
     * 被拒时不该已经锁过库存。校验失败直接抛，绝不降级为「按下单客户本人处理」——
     * 那会把一次显式的企业主体声明静默改成个人订单。
     *
     * 用 `committedAt` 作为判定时点，与报价消费、券锁定同一时刻：
     * 各步取各自的 now() 会让「授权刚好在这一秒过期」产生自相矛盾的结论。
     */
    const membershipSubjects = membershipAtCommit
      ? {
          ...(input.subjects ?? {}),
          contractSubjectCustomerId: membershipAtCommit.enterpriseContractAndPayer
            ? membershipAtCommit.corporateCustomerId
            : membershipAtCommit.personalCustomerId,
          payerSubjectCustomerId: membershipAtCommit.enterpriseContractAndPayer
            ? membershipAtCommit.corporateCustomerId
            : membershipAtCommit.personalCustomerId,
          userSubjectCustomerId: membershipAtCommit.personalCustomerId
        }
      : input.subjects;
    const resolvedSubjects =
      this.subjects && orderInput.customerId
        ? await this.subjects.resolveOrderSubjects(tenantId, orderInput.customerId, committedAt, membershipSubjects)
        : undefined;
    const coupon = this.business.validateCouponForOrder(
      tenantId,
      context,
      quote.customerCouponId,
      quote.request.customerId,
      committedAt,
      quote.request.startAt
    );
    const order = await this.core.prepareOrder(tenantId, orderInput, userName, membershipAtCommit ? { ...quote, membershipSnapshot: membershipAtCommit } : quote, resolvedSubjects);

    try {
      await this.prisma.$transaction(async (tx) => {
        if (approval && approvalBinding) {
          await approval.authorize(structuredClone(approvalBinding));
          await approval.prepare(tx, structuredClone(approvalBinding));
        }
        // 快速预检只改善反馈；这里才是权威判定。它与客户暂停、注销、合并共用
        // customer_profiles 行锁，消除“检查通过后状态才变化”的竞态窗口。
        if (this.customerOperations && input.customerId) {
          const customerGate = await this.customerOperations.assertTransactableForNewBusiness(
            tenantId,
            workspaceId,
            input.customerId,
            tx
          );
          if (!customerGate.allowed) throw new ConflictException(customerGate.message);
        }
        const securityMembershipReduction = (quote.membershipBenefitEvaluations ?? []).some((evaluation) =>
          (evaluation.appliesTo === "deposit" || evaluation.appliesTo === "preauthorization") && evaluation.appliedAmount > 0
        );
        if (securityMembershipReduction) {
          if (!membershipAtCommit || !this.memberships?.hasOpenRiskForBooking) {
            throw new ConflictException("无法复核会员风控状态，已拒绝使用该报价下单");
          }
          let hasOpenRisk: boolean;
          try {
            hasOpenRisk = await this.memberships.hasOpenRiskForBooking(tenantId, workspaceId, membershipAtCommit, tx);
          } catch {
            throw new ConflictException("无法复核会员风控状态，请重新报价后再试");
          }
          if (hasOpenRisk) throw new ConflictException("会员风控状态已变化，请重新报价后再试");
        }
        // 先锁定序列化资产或数量余额，再在同一事务内按最新预占重新计算。
        // 并发请求会在这里串行，后到者不能继续使用事务外看到的陈旧可用量。
        await this.core.assertAvailabilityWithLocks(tenantId, {
          locationId: input.fulfillmentLocationId,
          startAt: input.startAt,
          endAt: input.endAt,
          lines: input.lines.map((line) => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }))
        }, tx, quote.ruleSnapshot);

        // 故意先写订单聚合，再校验并消费报价、锁券；后续任一步失败都必须证明
        // 前面的订单、订单行和库存预占会随同一事务整体回滚。
        //
        // 订单确认 Hook 放在写聚合**之前**、且在事务内：阻止时整个事务回滚，
        // 订单、预占与 Hook 审计一起消失，不留半成品；放事务外则拿不到 tx，
        // 审计就无法与业务变更同生共死。
        await this.hooks?.evaluate({
          point: "order_confirmation",
          tenantId,
          workspaceId,
          categoryCode: context.category.code,
          subjectRef: { type: "order", id: order.id },
          // 富化：随订单一并传入已解析器材行与本次的例外确认，能力据此判定兼容性。
          // 器材属性与确认都是数据，Core 不读它们、不做品类判断。
          subject: {
            ...order,
            equipment: await this.core.buildOrderCapabilityEquipment(tenantId, order, tx),
            // 只把 prepareOrder 已严格校验、且与报价判断绑定的不可变快照交给 Hook。
            // 绝不能再消费原始请求，否则无效 decisionId 会绕过快照校验。
            capabilityExceptions: (order.capabilityExceptions ?? []).map((row) => ({
              capability: row.capability,
              code: row.riskCode,
              reason: row.reason
            }))
          },
          operator: input.operator || userName,
          tx,
          // 旧报价没有能力快照时按「当时没有能力参与」处理，绝不能退回当前实例；
          // 否则订单创建后新启用的规则会反向卡住一张仍在有效期内的旧报价。
          instances: order.capabilitySnapshot?.length
            ? this.core.capabilityInstancesFromSnapshot(tenantId, order.capabilitySnapshot)
            : []
        });
        // MKT-02C：下单时约定的服务也标成发生项（origin=order），并挂上与下面 reserveForOrder
        // 同源的容量依据。没有它，归还结算只能按 serviceId 配对，续租再买同一服务就会串。
        if (order.serviceSnapshots?.length) {
          order.serviceSnapshots = stampOccurrences(order.serviceSnapshots, {
            origin: "order",
            ownerId: order.id,
            requestKey: key
          });
        }
        await this.coreFacts.saveOrderAggregate(order, [], tx);

        // 服务容量与订单聚合、库存预占、报价消费、券锁定同一事务。
        // 任一步失败时容量增量和预留流水必须一起回滚，不能留下“没订单但占容量”。
        await this.serviceCapacities?.reserveForOrder(tenantId, order, key, tx);

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
            quote.request.startAt,
            quote.couponAmount,
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
        if (approval && approvalBinding) {
          await approval.authorize(structuredClone(approvalBinding));
          await approval.commit(tx, structuredClone(approvalBinding), order.id);
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (error) {
      // 并发同键：先到者已提交，本次回滚后返回它的结果，而不是报错或重复建单。
      if (error instanceof IdempotentReplay) {
        const replayed = error.orderId ? await this.coreFacts.findOrder(tenantId, error.orderId) : undefined;
        if (replayed) { await verifyReplay(replayed); return { order: replayed, replayed: true }; }
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key);
        if (!winner) throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
        // 回放前必须比对指纹：两个**不同**请求并发复用同一幂等键时，
        // 后到者会撞唯一约束落到这里，不比对就会把先到者的订单当成自己的结果返回。
        // 顺序请求走事务外预检时已有这道校验，并发路径此前漏了。
        assertSameRequest(winner, fingerprint);
        const replayed = winner.orderId ? await this.coreFacts.findOrder(tenantId, winner.orderId) : undefined;
        if (replayed) { await verifyReplay(replayed); return { order: replayed, replayed: true }; }
        throw new ConflictException("相同幂等键的请求正在处理，请稍后重试");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw new ConflictException("库存正在被其他订单占用，请稍后重试");
      }
      // 业务冲突后再探一次幂等记录。
      //
      // 可复现的交错（Codex 2026-08-20 指出，此前我误以为该分支走不到）：
      //   1. 两个同键请求都在首单提交前完成事务外预检，双双查不到记录；
      //   2. 后到者在事务内等待库存锁；
      //   3. 首单提交，消费报价并占用库存；
      //   4. 后到者拿到锁，因报价已被消费而在**事务中段**抛 409；
      //   5. 那一步位于事务末尾的幂等重查之前，因此它永远走不到回放。
      //
      // 「E2E 当前能过」只说明没有稳定制造出这个交错，不能证明分支不可达。
      // 实测：6 路同键并发连跑 3 次，后到者总是在事务外预检就命中先到者已提交的
      // 记录并回放，走不到这里。**因此本分支目前无测试覆盖**——不要因为"删掉它
      // 测试仍全绿"就删掉它（我犯过这个错）。多实例部署或不同时序下窗口是真实的。
      //
      // 判据必须是同键 + 同指纹 + 订单确实存在，三者缺一即保留原始错误，
      // 真正的报价失效、过期、变更仍如实报 409。
      if (error instanceof ConflictException) {
        const winner = await this.idempotency.find(tenantId, ORDER_CREATE_ACTION, key);
        if (!winner) throw error;
        assertSameRequest(winner, fingerprint);
        const replayed = winner.orderId ? await this.coreFacts.findOrder(tenantId, winner.orderId) : undefined;
        if (replayed) { await verifyReplay(replayed); return { order: replayed, replayed: true }; }
        throw error;
      }
      throw error;
    }

    this.business.applyOrderConfirmationToCache(quote, coupon, order.id, committedAt, context);
    if (approval && approvalBinding) await approval.authorize(structuredClone(approvalBinding));
    return { order, replayed: false };
  }

  assertOrderMatchesQuote(input: CreateRentalOrderRequest, quote: RentalQuoteSnapshotV1) {
    // 定价分组也是报价事实，不能在确认时换成另一个包含相同型号、但价格或
    // 允许替换范围不同的分组。预约精度仅由服务端报价快照决定，不信任客户端自报。
    const quotedLines = quote.request.lines.map((line) => `${line.pricingGroupId ?? ""}:${line.itemGroupId}:${line.quantity}`).sort();
    const orderLines = input.lines.map((line) => `${line.pricingGroupId ?? ""}:${line.itemGroupId}:${line.quantity}`).sort();
    if (
      quote.request.fulfillmentMode !== input.fulfillmentMode ||
      quote.request.fulfillmentLocationId !== input.fulfillmentLocationId ||
      quote.request.returnLocationId !== input.returnLocationId ||
      quote.request.startAt !== input.startAt ||
      quote.request.endAt !== input.endAt ||
      quote.request.customerType !== input.customerType ||
      quote.request.customerId !== input.customerId ||
      JSON.stringify(quote.request.bookingIdentity ?? {}) !== JSON.stringify(input.bookingIdentity ?? {}) ||
      JSON.stringify(quotedLines) !== JSON.stringify(orderLines)
    ) {
      throw new BadRequestException("订单内容与服务端报价快照不一致");
    }
  }

  private async resolveMembershipAtCommit(tenantId: string, workspaceId: string, quote: RentalQuoteSnapshotV1) {
    if (!this.memberships) throw new ConflictException("会员预约服务未就绪");
    const snapshot = quote.membershipSnapshot!;
    const current = await this.memberships.resolveBookingIdentity(
      tenantId,
      workspaceId,
      snapshot.personalCustomerId,
      quote.request.bookingIdentity
    );
    if (
      current.bookingIdentity !== snapshot.bookingIdentity ||
      current.corporateCustomerId !== snapshot.corporateCustomerId ||
      current.corporateMembershipId !== snapshot.corporateMembershipId ||
      current.enterpriseContractAndPayer !== snapshot.enterpriseContractAndPayer
    ) {
      throw new ConflictException("会员预约身份或企业员工关系已变化，请重新报价");
    }
    // 价格权益保持报价快照，资格读取当前事实，不能使用已被撤销的旧审核结果。
    return { ...snapshot, qualifications: current.qualifications };
  }
}
