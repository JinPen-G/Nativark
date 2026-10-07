import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { RENTAL_CATEGORY_DEFINITIONS, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from '@rental-os/shared';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import { aiQuotePreviewInputSchema, type AiQuoteCoreContextSource } from '../quote-preview.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const name = z.string().trim().min(1).max(191);
const id = name.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const aiQuoteCandidateInputSchema = z.object({
  customerType: z.enum(['personal', 'corporate']), customerId: name.optional(), customerName: name.optional(),
  items: z.array(z.object({ productName: name.optional(), itemGroupId: id.optional(), quantity: z.number().int().min(1).max(10000),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional() }).strict()).min(1).max(50).optional(),
  start: z.string().min(1).max(80).optional(), end: z.string().min(1).max(80).optional(),
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES).optional(), locationName: name.optional(), returnLocationName: name.optional(),
  locationId: id.optional(), returnLocationId: id.optional(), selectionRevision: z.string().regex(/^[a-f0-9]{64}$/u).optional()
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
    if (!parsed.success) {
      const missingFields = [...new Set(parsed.error.issues.map(row => row.path.join('.') || 'request'))];
      return { status: 'missing_input' as const, missingFields, clarifications: missingFields.map(field => ({ field,
        reason: 'invalid_or_missing_input', action: 'supply_valid_value', candidates: [] })) };
    }
    const input = parsed.data;
    if (input.customerType === 'corporate') return { status: 'qualification_required' as const, reason: 'enterprise_identity_reader_unavailable' as const,
      clarifications: [{ field: 'customerId', reason: 'trusted_enterprise_qualification_required', action: 'use_original_qualification_flow', candidates: [] }] };
    const catalog = await this.readers.catalog.read({ limit: 100 }), members = await this.readers.members.read({ limit: 50 });
    if (catalog.scope.kind !== 'workspace' || JSON.stringify(catalog.scope) !== JSON.stringify(members.scope)
      || catalog.audience !== members.audience) throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(catalog.scope), context = structuredClone(await this.contexts.current(scope));
    if (context.profile.tenantId !== scope.tenantId || context.settings.tenantId !== scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
    if (!RENTAL_CATEGORY_DEFINITIONS.some(row => row.code === context.profile.categoryCode)
      || context.category.code !== context.profile.categoryCode) return { status: 'unavailable' as const, reason: 'category_unavailable' as const };
    const missingFields: string[] = [], ambiguous: string[] = [];
    const clarifications: Array<{ field: string; reason: string; action: string;
      candidates: Array<{ id: string; label: string; phoneMasked?: string }>; truncated?: boolean }> = [];
    const choose = (field: string, reason: string, rows: Array<{ id: string; label: string; phoneMasked?: string }>) => {
      clarifications.push({ field, reason, action: 'select_authorized_id', candidates: rows.slice(0, 10), truncated: rows.length > 10 });
    };
    if (!input.items) { missingFields.push('items'); choose('items', 'product_and_quantity_required', catalog.items.filter(row => row.status === 'enabled').map(row => ({ id: row.id, label: row.name }))); }
    const lines = (input.items ?? []).map((item, index) => {
      const matches = catalog.items.filter(row => row.status === 'enabled' && (item.itemGroupId ? row.id === item.itemGroupId : row.name === item.productName));
      if (matches.length !== 1) (matches.length ? ambiguous : missingFields).push(`items.${index}`);
      if (matches.length !== 1) choose(`items.${index}`, matches.length ? 'ambiguous_product' : 'product_not_resolved',
        (matches.length ? matches : catalog.items.filter(row => row.status === 'enabled')).map(row => ({ id: row.id, label: row.name })));
      if (item.pricingUnit && !context.settings.pricing.enabledUnits.includes(item.pricingUnit)) missingFields.push(`items.${index}.pricingUnit`);
      return { itemGroupId: matches.length === 1 ? matches[0].id : undefined, quantity: item.quantity,
        ...(item.pricingUnit ? { pricingUnit: item.pricingUnit } : {}) };
    });
    const customerCandidates = members.candidates.filter(row => input.customerId ? row.customerId === input.customerId : !input.customerName || row.name === input.customerName);
    // A name, even a currently unique one, does not constitute a user selection.
    if (!input.customerId || customerCandidates.length !== 1) (customerCandidates.length > 1 ? ambiguous : missingFields).push('customerId');
    if (!input.customerId || customerCandidates.length !== 1) choose('customerId', 'explicit_customer_selection_required',
      customerCandidates.map(row => ({ id: row.customerId, label: row.name, phoneMasked: row.phoneMasked })));
    const location = (text: string | undefined, selectedId: string | undefined, field: string) => {
      const rows = context.locations.filter(row => row.status === 'enabled' && (selectedId ? row.id === selectedId : row.name === text));
      if (rows.length !== 1) (rows.length ? ambiguous : missingFields).push(field);
      if (rows.length !== 1) choose(field, 'location_selection_required',
        (rows.length ? rows : context.locations.filter(row => row.status === 'enabled')).map(row => ({ id: row.id, label: row.name })));
      return rows.length === 1 ? rows[0].id : undefined;
    };
    const fulfillmentLocationId = location(input.locationName, input.locationId, 'location'),
      returnLocationId = input.returnLocationName || input.returnLocationId ? location(input.returnLocationName, input.returnLocationId, 'returnLocation') : undefined;
    if (!input.fulfillmentMode || !context.settings.fulfillment.enabledModes.includes(input.fulfillmentMode)) {
      missingFields.push('fulfillmentMode'); choose('fulfillmentMode', 'server_supported_mode_required', context.settings.fulfillment.enabledModes.map(mode => ({ id: mode, label: mode })));
    }
    const now = this.clock(), timeZone = context.settings.calendar.timeZone;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !timeZone) throw new ModelGatewayError('CONFIG_INVALID');
    let startAt: string | undefined, endAt: string | undefined;
    try { startAt = resolveInstant(input.start ?? '', timeZone, now); endAt = resolveInstant(input.end ?? '', timeZone, now); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    if (!startAt) missingFields.push('start');
    if (!endAt || (startAt && Date.parse(endAt) <= Date.parse(startAt))) missingFields.push('end');
    for (const field of ['start', 'end']) if (missingFields.includes(field)) clarifications.push({ field,
      reason: 'explicit_time_with_offset_required', action: 'supply_absolute_time', candidates: [] });
    // Re-read existing protected projections after config awaits. This is a
    // sequential read consistency check, NOT atomic authorization or dispatch.
    const currentCatalog = await this.readers.catalog.read({ limit: 100 }), currentMembers = await this.readers.members.read({ limit: 50 });
    if (JSON.stringify(currentCatalog.scope) !== JSON.stringify(scope) || JSON.stringify(currentMembers.scope) !== JSON.stringify(scope)
      || currentCatalog.audience !== catalog.audience || currentMembers.audience !== members.audience
      || JSON.stringify(currentCatalog.items) !== JSON.stringify(catalog.items)
      || JSON.stringify(currentMembers.candidates) !== JSON.stringify(members.candidates)) throw new ModelGatewayError('FORBIDDEN');
    const currentContext = structuredClone(await this.contexts.current(scope));
    if (!isDeepStrictEqual(currentContext, context)) throw new ModelGatewayError('CONFIG_INVALID');
    const selectionRevision = requestFingerprint({ scope, context, items: catalog.items, members: members.candidates });
    const hasExplicitResourceSelection = Boolean(input.locationId || input.returnLocationId || input.items?.some(item => item.itemGroupId));
    if ((hasExplicitResourceSelection && !input.selectionRevision) || (input.selectionRevision && input.selectionRevision !== selectionRevision)) return { status: 'missing_input' as const,
      missingFields: ['selectionRevision'], selectionRevision, clarifications: [{ field: 'selectionRevision',
        reason: 'configuration_or_candidates_changed', action: 'reread_and_reconfirm', candidates: [] }] };
    if (ambiguous.length) return { status: 'ambiguous' as const, ambiguousFields: ambiguous, missingFields, customerCandidates, clarifications, selectionRevision };
    if (missingFields.length) return { status: 'missing_input' as const, missingFields, clarifications, selectionRevision };
    const request = aiQuotePreviewInputSchema.safeParse({ customerType: input.customerType, customerId: input.customerId,
      lines, startAt, endAt, fulfillmentMode: input.fulfillmentMode, fulfillmentLocationId, ...(returnLocationId ? { returnLocationId } : {}) });
    if (!request.success) return { status: 'missing_input' as const, missingFields: ['request'] };
    return { status: 'needs_confirmation' as const, request: request.data, timeZone, observedAt: now.toISOString(), selectionRevision,
      configurationFingerprint: requestFingerprint(context),
      configVersion: context.settings.configVersion, reservation: 'not_reserved' as const };
  }
}
