import { z } from 'zod';
import { RENTAL_CATEGORY_DEFINITIONS, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from '@rental-os/shared';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import { aiQuotePreviewInputSchema, type AiQuoteCoreContextSource } from '../quote-preview.service';
import { ModelGatewayError } from '../model-gateway.ports';

const name = z.string().trim().min(1).max(191);
export const aiQuoteCandidateInputSchema = z.object({
  customerType: z.enum(['personal', 'corporate']), customerId: name.optional(), customerName: name.optional(),
  items: z.array(z.object({ productName: name, quantity: z.number().int().min(1).max(10000),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional() }).strict()).min(1).max(50),
  start: z.string().min(1).max(80), end: z.string().min(1).max(80),
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES), locationName: name, returnLocationName: name.optional()
}).strict();

/** Finite supported date grammar only. Unrecognized phrases, DST gaps and DST
 * overlaps require clarification; never choose an offset by machine timezone. */
function resolveInstant(text: string, timeZone: string, now: Date): string | undefined {
  const absolute = z.string().datetime({ offset: true }).safeParse(text);
  if (absolute.success) return new Date(absolute.data).toISOString();
  const match = /^(今天|明天|后天) ([0-2][0-9]):([0-5][0-9])$/u.exec(text);
  if (!match || Number(match[2]) > 23) return undefined;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(row => [row.type, row.value]));
  const today = parts(now), day = new Date(Date.UTC(Number(today.year), Number(today.month) - 1,
    Number(today.day) + ['今天', '明天', '后天'].indexOf(match[1])));
  const year = day.getUTCFullYear(), month = day.getUTCMonth() + 1, date = day.getUTCDate(), hour = Number(match[2]), minute = Number(match[3]);
  const wall = Date.UTC(year, month - 1, date, hour, minute), matches: string[] = [];
  // Modern supported offsets are quarter-hour multiples, bounded +/-14h.
  // An unsupported offset yields no candidate, not an invented time.
  for (let offset = -840; offset <= 840; offset += 15) {
    const candidate = new Date(wall - offset * 60000), p = parts(candidate);
    if (Number(p.year) === year && Number(p.month) === month && Number(p.day) === date
      && Number(p.hour) === hour && Number(p.minute) === minute) matches.push(candidate.toISOString());
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Extracted words are untrusted candidates, NOT a new server DTO or an action.
 * Uses the existing guarded readers; no Core quote, reservation or approval is
 * performed. Host must obtain a confirmed formal request and current quote
 * authority separately before calling the existing quote service. */
export class AiQuoteCandidatePreparationService {
  constructor(private readonly readers: {
    catalog: Pick<AiCatalogReadFactsService, 'read'>;
    members: Pick<AiMembershipCandidateReadFactsService, 'read'>;
  }, private readonly contexts: AiQuoteCoreContextSource, private readonly clock: () => Date = () => new Date()) {
    if (typeof readers?.catalog?.read !== 'function' || typeof readers?.members?.read !== 'function'
      || typeof contexts?.current !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async prepare(value: unknown) {
    const parsed = aiQuoteCandidateInputSchema.safeParse(value);
    if (!parsed.success) return { status: 'missing_input' as const, missingFields: [...new Set(parsed.error.issues.map(row => row.path.join('.') || 'request'))] };
    const input = parsed.data;
    if (input.customerType === 'corporate') return { status: 'qualification_required' as const, reason: 'enterprise_identity_reader_unavailable' as const };
    const catalog = await this.readers.catalog.read({ limit: 100 }), members = await this.readers.members.read({ limit: 50 });
    if (catalog.scope.kind !== 'workspace' || JSON.stringify(catalog.scope) !== JSON.stringify(members.scope)
      || catalog.audience !== members.audience) throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(catalog.scope), context = structuredClone(await this.contexts.current(scope));
    if (context.profile.tenantId !== scope.tenantId || context.settings.tenantId !== scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
    if (!RENTAL_CATEGORY_DEFINITIONS.some(row => row.code === context.profile.categoryCode)
      || context.category.code !== context.profile.categoryCode) return { status: 'unavailable' as const, reason: 'category_unavailable' as const };
    const missingFields: string[] = [], ambiguous: string[] = [];
    const lines = input.items.map((item, index) => {
      const matches = catalog.items.filter(row => row.status === 'enabled' && row.name === item.productName);
      if (matches.length !== 1) (matches.length ? ambiguous : missingFields).push(`items.${index}`);
      if (item.pricingUnit && !context.settings.pricing.enabledUnits.includes(item.pricingUnit)) missingFields.push(`items.${index}.pricingUnit`);
      return { itemGroupId: matches.length === 1 ? matches[0].id : undefined, quantity: item.quantity,
        ...(item.pricingUnit ? { pricingUnit: item.pricingUnit } : {}) };
    });
    const customerCandidates = members.candidates.filter(row => input.customerId ? row.customerId === input.customerId : row.name === input.customerName);
    // A name, even a currently unique one, does not constitute a user selection.
    if (!input.customerId || customerCandidates.length !== 1) (customerCandidates.length > 1 ? ambiguous : missingFields).push('customerId');
    const location = (text: string, field: string) => {
      const rows = context.locations.filter(row => row.status === 'enabled' && row.name === text);
      if (rows.length !== 1) (rows.length ? ambiguous : missingFields).push(field);
      return rows.length === 1 ? rows[0].id : undefined;
    };
    const fulfillmentLocationId = location(input.locationName, 'location'),
      returnLocationId = input.returnLocationName ? location(input.returnLocationName, 'returnLocation') : undefined;
    if (!context.settings.fulfillment.enabledModes.includes(input.fulfillmentMode)) missingFields.push('fulfillmentMode');
    const now = this.clock(), timeZone = context.settings.calendar.timeZone;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !timeZone) throw new ModelGatewayError('CONFIG_INVALID');
    let startAt: string | undefined, endAt: string | undefined;
    try { startAt = resolveInstant(input.start, timeZone, now); endAt = resolveInstant(input.end, timeZone, now); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (!startAt) missingFields.push('start');
    if (!endAt || (startAt && Date.parse(endAt) <= Date.parse(startAt))) missingFields.push('end');
    // Re-read existing protected projections after config awaits. This is a
    // sequential read consistency check, NOT atomic authorization or dispatch.
    const currentCatalog = await this.readers.catalog.read({ limit: 100 }), currentMembers = await this.readers.members.read({ limit: 50 });
    if (JSON.stringify(currentCatalog.scope) !== JSON.stringify(scope) || JSON.stringify(currentMembers.scope) !== JSON.stringify(scope)
      || currentCatalog.audience !== catalog.audience || currentMembers.audience !== members.audience
      || JSON.stringify(currentCatalog.items) !== JSON.stringify(catalog.items)
      || JSON.stringify(currentMembers.candidates) !== JSON.stringify(members.candidates)) throw new ModelGatewayError('FORBIDDEN');
    if (ambiguous.length) return { status: 'ambiguous' as const, ambiguousFields: ambiguous, missingFields, customerCandidates };
    if (missingFields.length) return { status: 'missing_input' as const, missingFields };
    const request = aiQuotePreviewInputSchema.safeParse({ customerType: input.customerType, customerId: input.customerId,
      lines, startAt, endAt, fulfillmentMode: input.fulfillmentMode, fulfillmentLocationId, ...(returnLocationId ? { returnLocationId } : {}) });
    if (!request.success) return { status: 'missing_input' as const, missingFields: ['request'] };
    return { status: 'needs_confirmation' as const, request: request.data, timeZone, observedAt: now.toISOString(),
      configVersion: context.settings.configVersion, reservation: 'not_reserved' as const };
  }
}
