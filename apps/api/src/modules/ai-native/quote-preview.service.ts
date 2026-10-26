import { z } from "zod";
import { HttpException } from '@nestjs/common';
import { RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, type AiExecutionContext, type RentalQuoteRequest, type RentalQuoteSnapshotV1,
  type AiCoreQuotePreviewResultDraft, type AiCoreQuotePreviewFailureDraft } from "@rental-os/shared";
import type { RentalBusinessService, BusinessContext } from "../rental-core/rental-business.service";
import { ModelGatewayError } from "./model-gateway.ports";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { assertCurrentQuoteAddress, type AiQuoteAddressSource } from './scenes/original-quote-address';

const id = z.string().trim().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const timestamp = z.string().datetime({ offset: true });
const quoteIdentityHash = (value: AiExecutionContext) => {
  const { authorizedAt: _time, requestId: _request, ...identity } = value;
  return requestFingerprint(identity);
};
const originalQuoteKey = (context: AiExecutionContext, reference: string) => requestFingerprint({
  contract: 'original-scene-quote-1', reference, scope: context.scope, actor: context.actor, audience: context.audience
});
const line = z.object({
  pricingGroupId: id.optional(), itemGroupId: id.optional(), quantity: z.number().int().positive().max(10000),
  pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional(),
  usageQuantity: z.number().finite().nonnegative().max(1_000_000).optional(), note: z.string().trim().max(500).optional()
}).strict().refine(value => Boolean(value.pricingGroupId || value.itemGroupId), { message: "商品或定价分组必填", path: ["itemGroupId"] });
const service = z.object({ serviceId: id, quantity: z.number().int().positive().max(10000), scheduledStartAt: timestamp.optional(), scheduledEndAt: timestamp.optional(), serviceLocationId: id.optional() }).strict();
/** Identity is a candidate, never evidence of membership, qualification or
 * human approval. Core resolves the selected current relationship. */
export const aiQuotePersonalBookingIdentitySchema = z.object({ bookingIdentity: z.literal('personal') }).strict();
export const aiQuoteBookingIdentitySchema = z.discriminatedUnion('bookingIdentity', [
  aiQuotePersonalBookingIdentitySchema,
  z.object({ bookingIdentity: z.literal('enterprise_employee'), corporateCustomerId: id,
    enterpriseContractAndPayer: z.boolean() }).strict()
]);
export const aiQuotePreviewInputSchema = z.object({
  customerType: z.enum(["personal", "corporate"]), customerId: id.optional(),
  bookingIdentity: aiQuoteBookingIdentitySchema.optional(),
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: id, returnLocationId: id.optional(),
  deliveryAddressId: id.optional(), startAt: timestamp, endAt: timestamp, pricingPlanId: id.optional(), discountPlanId: id.optional(),
  customerCouponId: id.optional(), lines: z.array(line).min(1).max(100), services: z.array(service).max(100).optional()
}).strict().superRefine((value, context) => {
  if (value.bookingIdentity && value.customerType !== 'personal') context.addIssue({ code: 'custom',
    message: '预约身份必须绑定实际个人使用人', path: ['customerType'] });
  if (new Date(value.startAt).getTime() >= new Date(value.endAt).getTime()) context.addIssue({ code: "custom", message: "结束时间必须晚于开始时间", path: ["endAt"] });
  if (value.customerType === "personal" && !value.customerId) context.addIssue({ code: "custom", message: "个人客户必须提供客户标识", path: ["customerId"] });
  if (value.customerType === "corporate" && !value.customerId) context.addIssue({ code: "custom", message: "企业客户必须提供客户标识", path: ["customerId"] });
});

export type AiQuotePreviewInput = z.input<typeof aiQuotePreviewInputSchema>;
const savedQuoteBasisSchema = z.object({
  id, quoteNo: z.string().trim().min(1).max(191),
  currency: z.string().regex(/^[A-Z]{3}$/u).optional(),
  pricingPlanVersion: z.string().trim().min(1).max(191), ruleVersion: z.string().trim().min(1).max(191),
  priceVersionId: id.optional(), priceVersion: z.string().trim().min(1).max(191).optional(),
  calendarVersion: z.string().max(4096).optional(), createdAt: timestamp, expiresAt: timestamp,
  pricingContext: z.object({ timeZone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; }
  }).optional() }).optional()
}).refine(value => Boolean(value.priceVersionId) === Boolean(value.priceVersion));
const chargeLineSchema = z.object({
  code: z.string().min(1).max(191), name: z.string().min(1).max(500),
  type: z.enum(['rental', 'calendar_adjustment', 'fulfillment', 'preauthorization', 'discount', 'coupon', 'service', 'deposit', 'cancellation', 'overdue', 'damage', 'extension', 'early_return_refund', 'order_change']),
  amount: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  sourceId: z.string().max(191).optional(), sourceVersion: z.string().max(191).optional(), detail: z.string().max(2000).optional()
});
// Retain the original service import names; the wire projection has one public
// contract, shared with its HTTP/OpenAPI consumers rather than a private DTO.
export type AiQuotePreviewFailure = AiCoreQuotePreviewFailureDraft;
export type AiQuotePreviewResult = AiCoreQuotePreviewResultDraft;

export interface AiQuotePreviewAuthority {
  withQuote<T>(input: RentalQuoteRequest, consume: (context: AiExecutionContext) => Promise<T>): Promise<T>;
}

export interface AiQuoteCoreContextSource {
  current(context: Extract<AiExecutionContext["scope"], { kind: "workspace" }>): Promise<BusinessContext>;
}

/**
 * AIN-09 bridge: the model supplies only a candidate request. Core remains the
 * sole pricing authority. This service persists a quote through Core but never
 * reserves inventory or creates an order.
 */
export class AiQuotePreviewService {
  constructor(
    private readonly core: Pick<RentalBusinessService, "createQuote"> & Partial<Pick<RentalBusinessService, 'normalizeQuoteInput' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation' | 'readQuoteForOriginalReference'>>,
    private readonly contexts: AiQuoteCoreContextSource,
    private readonly authority: AiQuotePreviewAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly resolver?: Pick<import('../rental-core/rental-core.service').RentalCoreService, 'resolvePricingGroupQuoteRequest'>,
    private readonly addresses?: AiQuoteAddressSource
  ) {
    if (typeof core?.createQuote !== "function" || typeof contexts?.current !== "function" || typeof authority?.withQuote !== "function") throw new ModelGatewayError("CONFIG_INVALID");
  }

  async preview(value: unknown, expectedConfigurationFingerprint?: string, expectedAddressFingerprint?: string): Promise<AiQuotePreviewResult> {
    return this.execute(value, expectedConfigurationFingerprint, undefined, expectedAddressFingerprint);
  }

  /** Internal original-request consumer only. The reference and identity come
   * from the authorized immutable repository, never model parameters. Read-only
   * recovery cannot fall through to quote creation when no row is observed. */
  async previewOriginal(value: unknown, original: Readonly<{ reference: string; expectedIdentityHash: string }>,
    expectedConfigurationFingerprint?: string, readOnly = false, expectedAddressFingerprint?: string): Promise<AiQuotePreviewResult> {
    const binding = structuredClone(original);
    if (!binding.reference || binding.reference.length > 512 || !/^[a-f0-9]{64}$/.test(binding.expectedIdentityHash)
      || typeof this.core.createQuoteForOriginalOperation !== 'function'
      || typeof this.core.readQuoteForOriginalOperation !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    return this.execute(value, expectedConfigurationFingerprint, { ...binding, readOnly }, expectedAddressFingerprint);
  }

  /** Called inside the guarded read composition with a currently authorized
   * original owner. No current pricing/candidate resolution is a historical
   * basis; the stored parameters themselves undergo the original quote Guard. */
  async recoverOriginal(reference: string, suppliedContext: AiExecutionContext): Promise<AiQuotePreviewResult> {
    const context = structuredClone(suppliedContext);
    if (!reference || reference.length > 512 || context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
      || !['operator', 'staff'].includes(context.audience)) throw new ModelGatewayError('FORBIDDEN');
    if (typeof this.core.readQuoteForOriginalReference !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    const tenantId = context.scope.tenantId, key = originalQuoteKey(context, reference);
    // Sanitize the fact-store read exactly like execute(): an infrastructure
    // failure is a structured unknown for the original operation, never a raw
    // business exception crossing the authentication boundary.
    let stored: RentalQuoteSnapshotV1 | undefined;
    try {
      stored = await this.core.readQuoteForOriginalReference(tenantId, key);
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      return { ...this.failure(context, 'unavailable', '原报价读取暂不可用；请稍后按原操作核对'),
        quotePersistence: 'unknown', nextAction: 'reconcile', retryable: false };
    }
    if (!stored) return { ...this.failure(context, 'unavailable', '原报价尚未观察到；不得据此重报'),
      quotePersistence: 'unknown', nextAction: 'reconcile', retryable: false };
    const guardInput = structuredClone(stored.request);
    guardInput.lines = guardInput.lines.map(row => {
      const { reservationPrecision: _precision, pricingGroupMemberItemGroupIds: _members,
        pricingGroupCode: _code, pricingGroupName: _name, ...input } = row;
      return input;
    });
    return this.authority.withQuote(guardInput, async current => {
      if (quoteIdentityHash(current) !== quoteIdentityHash(context)) throw new ModelGatewayError('FORBIDDEN');
      let again: RentalQuoteSnapshotV1 | undefined;
      try { again = await this.core.readQuoteForOriginalReference!(tenantId, key); }
      catch (error) {
        if (error instanceof ModelGatewayError) throw error;
        return { ...this.failure(context, 'unavailable', '原报价复验暂不可用；请稍后按原操作核对'),
          quotePersistence: 'unknown', nextAction: 'reconcile', retryable: false };
      }
      const immutable = (quote: RentalQuoteSnapshotV1) => {
        const { consumedAt: _at, consumedOrderId: _order, ...basis } = quote;
        return requestFingerprint(basis);
      };
      if (!again || immutable(again) !== immutable(stored)) throw new ModelGatewayError('INVALID_RESPONSE');
      return this.project(context, again, requestFingerprint(stored.request), stored.request.lines.length, true);
    });
  }

  private async execute(value: unknown, expectedConfigurationFingerprint?: string,
    original?: Readonly<{ reference: string; expectedIdentityHash: string; readOnly: boolean }>,
    expectedAddressFingerprint?: string): Promise<AiQuotePreviewResult> {
    const parsed = aiQuotePreviewInputSchema.safeParse(value);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join(".")).filter(Boolean))];
      return { contractVersion: "ain-09-quote-preview-draft-1", requestId: "unavailable", observedAt: this.now(), scope: { kind: "workspace", tenantId: "unavailable", workspaceId: "unavailable" }, status: "missing_input", missingFields: fields.length ? fields : ["request"], message: "报价输入不完整或格式不受支持" };
    }
    return this.authority.withQuote(structuredClone(parsed.data) as RentalQuoteRequest, async suppliedContext => {
      const context = structuredClone(suppliedContext);
      if (context.scope.kind !== "workspace" || context.actor.kind !== "user" || (context.audience !== "operator" && context.audience !== "staff")) throw new ModelGatewayError("FORBIDDEN");
      const scope = context.scope;
      try {
        const binding = (value: AiExecutionContext) => {
          const { authorizedAt: _time, requestId: _request, ...identity } = value;
          return requestFingerprint(identity);
        };
        if (original && binding(context) !== original.expectedIdentityHash) throw new ModelGatewayError('FORBIDDEN');
        const business = structuredClone(await this.contexts.current(structuredClone(scope)));
        if (expectedConfigurationFingerprint !== undefined && requestFingerprint(business) !== expectedConfigurationFingerprint) throw new ModelGatewayError('CONFIG_INVALID');
        let formalRequest = this.resolver
          ? structuredClone(await this.resolver.resolvePricingGroupQuoteRequest(scope.tenantId, structuredClone(parsed.data) as RentalQuoteRequest))
          : structuredClone(parsed.data) as RentalQuoteRequest;
        // Only the existing Core resolver may add selection metadata. It must
        // not change quantities, dates, customer, discounts, or selected IDs.
        if (!Array.isArray(formalRequest?.lines) || formalRequest.lines.length !== parsed.data.lines.length) throw new ModelGatewayError('INVALID_RESPONSE');
        const comparable = { ...formalRequest, lines: formalRequest.lines.map((resolved, index) => {
          const { reservationPrecision: _precision, pricingGroupMemberItemGroupIds: _members,
            pricingGroupCode: _code, pricingGroupName: _name, ...candidate } = resolved;
          if (!id.safeParse(resolved.itemGroupId).success) throw new ModelGatewayError('INVALID_RESPONSE');
          if (!parsed.data.lines[index].itemGroupId) delete candidate.itemGroupId;
          return candidate;
        }) };
        if (requestFingerprint(comparable) !== requestFingerprint(parsed.data)) throw new ModelGatewayError('INVALID_RESPONSE');
        // Fingerprint the request that the original Core producer will persist,
        // including its own defaults; never synthesize identity in the AI layer.
        if (this.core.normalizeQuoteInput) formalRequest = structuredClone(this.core.normalizeQuoteInput(formalRequest));
        const expectedRequest = requestFingerprint(formalRequest);
        const outcome = await this.authority.withQuote(structuredClone(parsed.data) as RentalQuoteRequest, async current => {
          if (binding(current) !== binding(context)) throw new ModelGatewayError('FORBIDDEN');
          const latest = structuredClone(await this.contexts.current(structuredClone(scope)));
          if (requestFingerprint(business) !== requestFingerprint(latest)) throw new ModelGatewayError('CONFIG_INVALID');
          if (!original?.readOnly) await assertCurrentQuoteAddress(this.addresses, current, formalRequest, expectedAddressFingerprint);
          // The last awaited source may itself wait for category/config data.
          // Recheck the original quote permission immediately before R1 work.
          return this.authority.withQuote(structuredClone(parsed.data) as RentalQuoteRequest, async final => {
            if (binding(final) !== binding(context)) throw new ModelGatewayError('FORBIDDEN');
            try {
              const operation = original ? {
                key: originalQuoteKey(context, original.reference), inputHash: expectedRequest
              } : undefined;
              const quote = operation
                ? original!.readOnly
                  ? await this.core.readQuoteForOriginalOperation!(scope.tenantId, operation)
                  : await this.core.createQuoteForOriginalOperation!(scope.tenantId, latest, structuredClone(formalRequest), operation)
                : await this.core.createQuote(scope.tenantId, latest, structuredClone(formalRequest));
              if (!quote) return { kind: 'failure' as const, status: 'unavailable' as const };
              return { kind: 'quote' as const, quote };
            } catch (error) {
              if (error instanceof ModelGatewayError) throw error;
              if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw new ModelGatewayError('FORBIDDEN');
              // Keep a sanitized Core outcome inside the authorized callback;
              // the bridge still rechecks identity after failure. Never carry
              // a raw business exception through its authentication boundary.
              return { kind: 'failure' as const, status: this.classify(error) };
            }
          });
        });
        if (outcome.kind === 'failure') return { ...this.failure(context, outcome.status, 'Core 未能生成报价；请核对输入或转人工处理'), quotePersistence: 'unknown', nextAction: 'reconcile', retryable: false };
        if (!original?.readOnly) await assertCurrentQuoteAddress(this.addresses, context, formalRequest, expectedAddressFingerprint, outcome.quote);
        return this.project(context, outcome.quote, expectedRequest, parsed.data.lines.length);
      } catch (error) {
        if (error instanceof ModelGatewayError) throw error;
        return this.failure(context, this.classify(error), "Core 未能生成报价；请核对输入或转人工处理");
      }
    });
  }

  private project(context: AiExecutionContext, quote: RentalQuoteSnapshotV1, expectedRequest: string,
    expectedLines: number, historical = false): AiQuotePreviewResult {
    if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError("CONFIG_INVALID");
    const chargeLines = z.array(chargeLineSchema).max(100).safeParse(quote?.chargeLines);
    const savedBasis = savedQuoteBasisSchema.safeParse(quote);
    if (quote?.tenantId !== context.scope.tenantId || !Array.isArray(quote?.request?.lines) || quote.request.lines.length !== expectedLines
      || requestFingerprint(quote.request) !== expectedRequest
      || !this.hasSafeAmounts(quote)
      || !chargeLines.success || !savedBasis.success) throw new ModelGatewayError("INVALID_RESPONSE");
    const expiresAt = new Date(quote.expiresAt); if (!Number.isFinite(expiresAt.getTime())) throw new ModelGatewayError("INVALID_RESPONSE");
    if (!historical && expiresAt.getTime() <= observed.getTime()) return { ...this.failure(context, "expired", "报价生成后已失效"), quotePersistence: 'saved' };
    return { contractVersion: "ain-09-quote-preview-draft-1", requestId: context.requestId, observedAt: observed.toISOString(), scope: context.scope, status: expiresAt.getTime() <= observed.getTime() ? "expired" : "quoted", quotePersistence: 'saved', quote: {
      id: quote.id, quoteNo: quote.quoteNo, currency: quote.currency, chargeLines: chargeLines.data,
      rentalAmount: quote.rentalAmount, discountAmount: quote.discountAmount, couponAmount: quote.couponAmount, serviceAmount: quote.serviceAmount,
      fulfillmentAmount: quote.fulfillmentAmount, depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount, payableAmount: quote.payableAmount, receivableAmount: quote.receivableAmount,
      pricingPlanVersion: quote.pricingPlanVersion, priceVersionId: quote.priceVersionId, priceVersion: quote.priceVersion, ruleVersion: quote.ruleVersion, calendarVersion: quote.calendarVersion,
      expiresAt: quote.expiresAt, createdAt: quote.createdAt, timeZone: quote.pricingContext?.timeZone, reservation: "not_reserved",
      period: { startAt: quote.request.startAt, endAt: quote.request.endAt },
      lineUnits: quote.request.lines.map(row => ({ itemGroupId: row.itemGroupId, pricingUnit: row.pricingUnit,
        quantity: row.quantity, usageQuantity: row.usageQuantity })),
      promotionEvidence: chargeLines.data.filter(row => row.type === 'discount' || row.type === 'coupon')
        .map(row => ({ code: row.code, sourceId: row.sourceId, sourceVersion: row.sourceVersion })),
      promotionVersionCoverage: 'charge_line_references_only', roundingEvidence: 'not_projected'
    } };
  }

  private failure(context: AiExecutionContext, status: AiQuotePreviewFailure, message: string): Extract<AiQuotePreviewResult, { quote?: never }> {
    return { contractVersion: "ain-09-quote-preview-draft-1", requestId: context.requestId, observedAt: this.now(), scope: context.scope as Extract<AiExecutionContext["scope"], { kind: "workspace" }>, status, message };
  }
  private classify(error: unknown): AiQuotePreviewFailure {
    const message = error instanceof Error ? error.message : "";
    if ((error instanceof HttpException && error.getStatus() >= 500) || /不可用|数据库|连接|超时/u.test(message)) return 'unavailable';
    if (/库存|没有启用的承接|缺货/u.test(message)) return "out_of_stock";
    if (/资格|会员|客户/u.test(message)) return "qualification_required";
    if (/过期|有效期|失效/u.test(message)) return "expired";
    if (/选择|歧义|多个|必须/u.test(message)) return "ambiguous";
    return "unavailable";
  }
  private hasSafeAmounts(quote: RentalQuoteSnapshotV1): boolean {
    return [quote.rentalAmount, quote.discountAmount, quote.couponAmount, quote.serviceAmount,
      quote.fulfillmentAmount, quote.depositAmount, quote.preAuthAmount, quote.payableAmount, quote.receivableAmount]
      .every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
  }
  private now() { const value = this.clock(); return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : new Date(0).toISOString(); }
}
