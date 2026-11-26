/** Original immutable rate and input-bound records. There is no new pricing ledger. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import { BudgetError } from './budget.ports';
import { gatewayPriceEvidenceSchema, gatewayInputBoundEvidenceSchema } from './gateway-pricing-evidence';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
export type GatewayPricingRecordDb = Pick<PrismaClient,
  'aiGatewayInvocation' | 'aiProviderProfile' | 'aiScope' | 'aiGatewayPriceRecord' | 'aiGatewayInputBoundRecord'>;
/** Pricing consumes a cloneable projection, not the full invocation row (its
 * Prisma Decimal fencing token is validated by the original binding source). */
export const gatewayPricingInvocationSelect = Object.freeze({ id: true, scopeId: true, callId: true, actorId: true,
  sceneCode: true, configuration: true, configurationHash: true, registrationHash: true,
  intentHash: true, priceVersion: true, maxOutputTokens: true } satisfies Prisma.AiGatewayInvocationSelect);
/** Platform review and its price share one immutable row. Old bare evidence
 * stays readable; a wrapper never changes the hash bound by input receipts. */
export const platformReviewedPricePayloadSchema = z.object({ kind: z.literal('platform-reviewed-price-record-1'),
  evidence: gatewayPriceEvidenceSchema, review: z.object({ actorId: key, operationKey: key.max(128), sceneCode: key.max(128),
    profileId: key.max(36), expectedConfigRevision: z.number().int().min(1).max(4294967295),
    commandHash: z.string().regex(/^[a-f0-9]{64}$/u),
    authority: z.literal('platform_reviewed_budget_rate_not_provider_invoice') }).strict() }).strict();
export function platformReviewedPriceReference(profileId: string, actorId: string, operationKey: string) {
  return `platform-reviewed:${hash({ profileId, actorId, operationKey })}`;
}
export interface GatewayPricingEvidenceSource {
  readPrice(reference: string, context: Readonly<AiExecutionContext>): Promise<unknown>;
  readInputBound(reference: string, context: Readonly<AiExecutionContext>, binding: Readonly<{
    invocationId: string; scopeId: string; registrationHash: string; intentHash: string;
    configurationHash: string; priceVersion: string; priceHash: string; maxOutputTokens: number;
  }>): Promise<unknown>;
}
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw new BudgetError('INVALID');
  return parsed.data;
};

export class GatewayInputBoundNotFoundError extends BudgetError {
  constructor() { super('UNAVAILABLE'); }
}
export class PrismaGatewayPricingRecords {
  constructor(private readonly db: GatewayPricingRecordDb) {
    if (typeof db?.aiGatewayPriceRecord?.findUnique !== 'function' || typeof db.aiGatewayPriceRecord.create !== 'function'
      || typeof db.aiGatewayPriceRecord.findFirst !== 'function'
      || typeof db.aiGatewayInputBoundRecord?.findUnique !== 'function' || typeof db.aiGatewayInputBoundRecord.create !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  priceId(scopeId: string, configurationHash: string, priceVersion: string) {
    return hash({ kind: 'gateway-price-key-1', scopeId, configurationHash, priceVersion });
  }
  boundId(scopeId: string, invocationId: string) { return hash({ kind: 'gateway-bound-key-1', scopeId, invocationId }); }
  async price(scopeId: string, configurationHash: string, priceVersion: string) {
    const id = this.priceId(scopeId, configurationHash, priceVersion);
    const row = structuredClone(await this.db.aiGatewayPriceRecord.findUnique({ where: { id } }));
    if (!row || row.id !== id || row.scopeId !== scopeId || row.configurationHash !== configurationHash
      || row.priceVersion !== priceVersion || hash(row.payload) !== row.payloadHash) throw new BudgetError('UNAVAILABLE');
    const wrapped = platformReviewedPricePayloadSchema.safeParse(row.payload);
    const evidence = wrapped.success ? wrapped.data.evidence : parse(gatewayPriceEvidenceSchema, row.payload);
    if (wrapped.success && (wrapped.data.review.profileId !== evidence.configuration.configId
      || wrapped.data.review.expectedConfigRevision !== evidence.configuration.configRevision
      || wrapped.data.review.commandHash !== evidence.provenance.documentHash
      || evidence.provenance.reference !== platformReviewedPriceReference(wrapped.data.review.profileId,
        wrapped.data.review.actorId, wrapped.data.review.operationKey))) throw new BudgetError('FORBIDDEN');
    if (hash(evidence.configuration) !== configurationHash || evidence.priceVersion !== priceVersion
      || row.sourceReference !== evidence.provenance.reference) throw new BudgetError('FORBIDDEN');
    return { id, hash: row.payloadHash, evidence };
  }
  async bound(scopeId: string, invocationId: string) {
    const id = this.boundId(scopeId, invocationId);
    const row = structuredClone(await this.db.aiGatewayInputBoundRecord.findUnique({ where: { id } }));
    if (!row) throw new GatewayInputBoundNotFoundError();
    if (row.id !== id || row.scopeId !== scopeId || row.invocationId !== invocationId
      || hash(row.payload) !== row.payloadHash) throw new BudgetError('PENDING_RECONCILIATION');
    const evidence = parse(gatewayInputBoundEvidenceSchema, row.payload);
    const price = await this.price(scopeId, evidence.configurationHash, evidence.priceVersion);
    if (evidence.scopeId !== scopeId || evidence.invocationId !== invocationId || evidence.priceHash !== price.hash
      || row.priceRecordId !== price.id) throw new BudgetError('FORBIDDEN');
    return { id, hash: row.payloadHash, evidence, price };
  }
}
