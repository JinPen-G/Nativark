import { z } from 'zod';
import type { AiExecutionContext, CustomerProfileAddress, RentalQuoteRequest, RentalQuoteSnapshotV1 } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const text = z.string().min(1).max(512);
const content = z.object({ recipient: text, phoneMasked: z.string().max(80), countryCode: z.string().min(1).max(8),
  province: text, city: text, district: text.optional(), detail: text, postalCode: z.string().max(32).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional() });
const address = content.extend({ id, revision: z.number().int().min(1).max(4294967294), isDefault: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }) }).strict();

export interface AiQuoteAddressSource {
  list(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>, customerId: string): Promise<{
    identityHash: string; rows: readonly CustomerProfileAddress[];
  }>;
}

/** The existing operator Core list is not database-paged. Refuse an oversized
 * projection rather than silently hiding a previously selected address. */
export function parseQuoteAddresses(value: unknown): CustomerProfileAddress[] {
  const parsed = z.array(address).max(20).safeParse(value);
  if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length) throw new ModelGatewayError('INVALID_RESPONSE');
  return parsed.data;
}

export function quoteAddressIdentity(context: AiExecutionContext) {
  const { authorizedAt: _at, requestId: _request, ...identity } = context;
  return requestFingerprint(identity);
}

export function quoteAddressFingerprint(scope: AiExecutionContext['scope'], customerId: string, row: CustomerProfileAddress, identityHash: string) {
  return requestFingerprint({ scope, customerId, address: row, identityHash });
}

/** Current operator ownership/visibility only. This is not atomic with Core's
 * write; Core's stored snapshot remains the historical address authority. */
export async function assertCurrentQuoteAddress(source: AiQuoteAddressSource | undefined, context: AiExecutionContext,
  request: RentalQuoteRequest, expected: string | undefined, quote?: RentalQuoteSnapshotV1) {
  if (!request.deliveryAddressId) {
    if (expected) throw new ModelGatewayError('INVALID_REQUEST');
    return;
  }
  if (!source || !expected || !/^[a-f0-9]{64}$/u.test(expected)) throw new ModelGatewayError('CONFIG_INVALID');
  if (context.scope.kind !== 'workspace' || context.audience !== 'operator' || !request.customerId) throw new ModelGatewayError('FORBIDDEN');
  const current = await source.list(context.scope, request.customerId);
  if (current.identityHash !== quoteAddressIdentity(context)) throw new ModelGatewayError('FORBIDDEN');
  const row = current.rows.find(row => row.id === request.deliveryAddressId);
  if (!row || quoteAddressFingerprint(context.scope, request.customerId, row, current.identityHash) !== expected) throw new ModelGatewayError('CONFIG_INVALID');
  if (quote) {
    const snapshot = content.safeParse(quote.deliveryAddressSnapshot);
    if (!snapshot.success || quote.deliveryAddressSnapshot?.addressId !== row.id
      || requestFingerprint(snapshot.data) !== requestFingerprint(content.parse(row))) throw new ModelGatewayError('INVALID_RESPONSE');
  }
}
