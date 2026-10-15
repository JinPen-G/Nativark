import { z } from 'zod';
import type { AiGatewayConfigReferenceDraft, AiUsageQuantityDraft } from '@rental-os/shared';
import { isGatewayConfig } from '../gateway-contract-validation';
import { BudgetError } from './budget.ports';
import { quantityAtoms } from './budget-quantity';

const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.string().datetime({ offset: true });
const provenance = z.object({ reference: key, revision: key, documentHash: hash }).strict();
const money = z.string().regex(/^(0|[1-9][0-9]{0,17})\.[0-9]{6}$/u);
const billing = z.discriminatedUnion('unit', [
  z.object({ unit: z.literal('tokens'), metric: z.literal('input_plus_output'), scale: z.literal(0), rounding: z.literal('exact') }).strict(),
  z.object({ unit: z.literal('money'), currency: z.string().regex(/^[A-Z]{3}$/u), scale: z.literal(6),
    inputPerMillion: money, outputPerMillion: money, rounding: z.literal('ceil_total_micro_units') }).strict()
]);
export const gatewayPriceEvidenceSchema = z.object({
  kind: z.literal('gateway-price-1'), priceVersion: key.max(64),
  configuration: z.custom<AiGatewayConfigReferenceDraft>(isGatewayConfig),
  usageClass: z.literal('plain_text_input_output_tokens'), additionalBillingDimensions: z.literal('none'),
  validFrom: timestamp, expiresAt: timestamp, billing, provenance
}).strict().refine(value => Date.parse(value.validFrom) < Date.parse(value.expiresAt));
export const gatewayInputBoundEvidenceSchema = z.object({
  kind: z.literal('gateway-input-bound-1'), invocationId: key.max(36), scopeId: key.max(36),
  registrationHash: hash, intentHash: hash, configurationHash: hash, priceVersion: key.max(64), priceHash: hash,
  maxInputTokens: count, maxOutputTokens: count.min(1).max(32768),
  modality: z.literal('text'), additionalBillingDimensions: z.literal('none'),
  method: z.enum(['provider_count_tokens_receipt', 'certified_tokenizer_bound']),
  validFrom: timestamp, expiresAt: timestamp, provenance
}).strict().refine(value => Date.parse(value.validFrom) < Date.parse(value.expiresAt)
  && BigInt(value.maxInputTokens) + BigInt(value.maxOutputTokens) <= BigInt(Number.MAX_SAFE_INTEGER));
export type GatewayPriceEvidence = z.infer<typeof gatewayPriceEvidenceSchema>;
export type GatewayInputBoundEvidence = z.infer<typeof gatewayInputBoundEvidenceSchema>;

export function priceGatewayTokens(price: GatewayPriceEvidence, inputTokens: number, outputTokens: number): AiUsageQuantityDraft {
  if (!count.safeParse(inputTokens).success || !count.safeParse(outputTokens).success) throw new BudgetError('UNAVAILABLE');
  const billing = price.billing;
  if (billing.unit === 'tokens') {
    const total = BigInt(inputTokens) + BigInt(outputTokens);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new BudgetError('UNAVAILABLE');
    return { unit: 'tokens', value: Number(total) };
  }
  const numerator = BigInt(billing.inputPerMillion.replace('.', '')) * BigInt(inputTokens)
    + BigInt(billing.outputPerMillion.replace('.', '')) * BigInt(outputTokens);
  const atoms = (numerator + 999999n) / 1000000n;
  const raw = atoms.toString().padStart(7, '0');
  const quantity = { unit: 'money' as const, currency: billing.currency, scale: 6 as const,
    amount: `${raw.slice(0, -6)}.${raw.slice(-6)}` };
  quantityAtoms(quantity);
  return quantity;
}
