import { z } from 'zod';
import type { AiExecutionContext, RentalFulfillmentLocation, RentalPricingRate } from '@rental-os/shared';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from './read-context-binding';
import { isDeepStrictEqual } from 'node:util';
import { RENTAL_CATEGORY_DEFINITIONS, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES } from '@rental-os/shared';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import { aiQuotePreviewInputSchema, aiQuotePersonalBookingIdentitySchema, type AiQuoteCoreContextSource } from '../quote-preview.service';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { quoteAddressFingerprint, quoteAddressIdentity, type AiQuoteAddressSource } from '../scenes/original-quote-address';

const name = z.string().trim().min(1).max(191);
const id = name.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const AI_QUOTE_CANDIDATE_LIMITS = Object.freeze({ lines: 50, quantity: 10000, usageQuantity: 1000000 });
/** Preparation-only binding of an enclosing server principal. Reuse the
 * original Core context return contract; legacy R1 source callers remain intact. */
export interface AiQuotePreparationContextSource extends AiQuoteCoreContextSource {
  current(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>,
    expectedContext?: AiExecutionContext): ReturnType<AiQuoteCoreContextSource['current']>;
}
export const aiQuoteCandidateInputSchema = z.object({
  customerType: z.enum(['personal', 'corporate']), customerId: name.optional(), customerName: name.optional(),
  // Candidate intent may be incomplete. Only the formal preview schema accepts
  // a complete identity; absence never implies personal booking or payer choice.
  bookingIdentity: z.discriminatedUnion('bookingIdentity', [aiQuotePersonalBookingIdentitySchema,
    z.object({ bookingIdentity: z.literal('enterprise_employee'), corporateCustomerId: id.optional(),
      enterpriseContractAndPayer: z.boolean().optional() }).strict()]).optional(),
  items: z.array(z.object({ productName: name.optional(), itemGroupId: id.optional(), quantity: z.number().int().min(1).max(AI_QUOTE_CANDIDATE_LIMITS.quantity),
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional(),
    usageQuantity: z.number().finite().nonnegative().max(AI_QUOTE_CANDIDATE_LIMITS.usageQuantity).optional()
  }).strict()).min(1).max(AI_QUOTE_CANDIDATE_LIMITS.lines).optional(),
  start: z.string().min(1).max(80).optional(), end: z.string().min(1).max(80).optional(),
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES).optional(), locationName: name.optional(), returnLocationName: name.optional(),
  locationId: id.optional(), returnLocationId: id.optional(), deliveryAddressId: id.optional(), selectionRevision: z.string().regex(/^[a-f0-9]{64}$/u).optional()
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
    members: Pick<AiMembershipCandidateReadFactsService, 'read'> & Partial<Pick<AiMembershipCandidateReadFactsService, 'readBookingOptions'>>;
    addresses?: AiQuoteAddressSource;
    rates?: { read(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>,
      context: Awaited<ReturnType<AiQuoteCoreContextSource['current']>>, at: string,
      expectedContext?: AiExecutionContext): Promise<readonly Pick<RentalPricingRate, 'itemGroupId' | 'pricingGroupId' | 'unit'>[]> };
  }, private readonly contexts: AiQuotePreparationContextSource, private readonly clock: () => Date = () => new Date(),
    private readonly aggregateAuthority?: AiBusinessReadAuthority) {
    if (typeof readers?.catalog?.read !== 'function' || typeof readers?.members?.read !== 'function'
      || typeof contexts?.current !== 'function'
      || (aggregateAuthority !== undefined && typeof aggregateAuthority?.withRead !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async prepare(value: unknown, expectedContext?: AiExecutionContext) {
    // Standard composition resolves one original principal before any source.
    // Leaf Guards still authorize each read and the enclosing Guard rechecks at
    // completion. Legacy constructors retain their original protected sources;
    // a supplied server context is a binding assertion, never a grant.
    if (!this.aggregateAuthority) return this.prepareBound(value, expectedContext);
    const snapshot = structuredClone(value), expected = expectedContext && structuredClone(expectedContext);
    return this.aggregateAuthority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, expected);
      return this.prepareBound(snapshot, context);
    });
  }
  private async prepareBound(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = aiQuoteCandidateInputSchema.safeParse(value);
    if (!parsed.success) {
      const missingFields = [...new Set(parsed.error.issues.map(row => row.path.join('.') || 'request'))];
      return { status: 'missing_input' as const, missingFields, clarifications: missingFields.map(field => ({ field,
        reason: 'invalid_or_missing_input', action: 'supply_valid_value', candidates: [] })) };
    }
    const input = parsed.data;
    // The original member quote requires a personal user, with an optional
    // current enterprise-employee identity. Do not invent a direct corporate
    // user path or silently rewrite the requested customer type.
    if (input.customerType === 'corporate') return { status: 'unavailable' as const, reason: 'direct_corporate_booking_not_supported' as const,
      clarifications: [{ field: 'customerId', reason: 'personal_user_with_optional_enterprise_identity_required',
        action: 'select_personal_user_in_original_booking_flow', candidates: [] }] };
    const memberQuery = { limit: 50, ...(input.customerId ? { customerId: input.customerId } : input.customerName ? { name: input.customerName } : {}) };
    // Exact persisted lookups for the supplied lines; never scan additional
    // pages until a name appears unique. One page per distinct query, <=50
    // queries and <=100 distinct returned items, followed by one revalidation.
    const queries = [...new Map((input.items?.length ? input.items : [{}]).map(row => {
      const query = 'itemGroupId' in row && row.itemGroupId ? { itemGroupId: row.itemGroupId }
        : 'productName' in row && row.productName ? { name: row.productName } : {};
      return [JSON.stringify(query), query];
    })).values()];
    const readCatalog = async () => {
      const pages = [];
      const items = new Map<string, Awaited<ReturnType<AiCatalogReadFactsService['read']>>['items'][number]>();
      for (const query of queries) {
        const result = await this.readers.catalog.read({ limit: 100, ...query }, expectedContext);
        if (pages.length && (!isDeepStrictEqual(result.scope, pages[0].result.scope)
          || result.audience !== pages[0].result.audience)) throw new ModelGatewayError('FORBIDDEN');
        for (const item of result.items) {
          const previous = items.get(item.id);
          if (previous && !isDeepStrictEqual(previous, item)) throw new ModelGatewayError('CONFIG_INVALID');
          items.set(item.id, item);
        }
        if (items.size > 100) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        pages.push({ query, result });
      }
      const basis = pages.map(({ query, result }) => ({ query, version: result.configurationVersion,
        truncated: result.truncated, nextCursor: result.nextCursor }));
      return { ...pages[0].result, items: [...items.values()], truncated: pages.some(page => page.result.truncated),
        configurationVersion: requestFingerprint(basis), queryBasis: basis };
    };
    const catalog = await readCatalog(), members = await this.readers.members.read(memberQuery, expectedContext);
    const enterprise = input.bookingIdentity?.bookingIdentity === 'enterprise_employee' ? input.bookingIdentity : undefined;
    if (enterprise && typeof this.readers.members.readBookingOptions !== 'function') {
      return { status: 'qualification_required' as const, reason: 'enterprise_identity_reader_unavailable' as const,
        clarifications: [{ field: 'bookingIdentity', reason: 'current_enterprise_relationship_required',
          action: 'use_original_qualification_flow', candidates: [] }] };
    }
    // Select the personal user first. Do not query an arbitrary enterprise or
    // manufacture qualification while the personal user is still unresolved.
    const bookingOptions = enterprise && input.customerId ? await this.readers.members.readBookingOptions!({ customerId: input.customerId, limit: 50 }, expectedContext) : undefined;
    if (bookingOptions && (JSON.stringify(bookingOptions.scope) !== JSON.stringify(members.scope)
      || bookingOptions.audience !== members.audience)) throw new ModelGatewayError('FORBIDDEN');
    if (catalog.scope.kind !== 'workspace' || JSON.stringify(catalog.scope) !== JSON.stringify(members.scope)
      || catalog.audience !== members.audience) throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(catalog.scope), context = structuredClone(await this.contexts.current(scope, expectedContext));
    if (context.profile.tenantId !== scope.tenantId || context.settings.tenantId !== scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
    if (!RENTAL_CATEGORY_DEFINITIONS.some(row => row.code === context.profile.categoryCode)
      || context.category.code !== context.profile.categoryCode) return { status: 'unavailable' as const, reason: 'category_unavailable' as const };
    const missingFields: string[] = [], ambiguous: string[] = [];
    const now = this.clock(), timeZone = context.settings.calendar.timeZone;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !timeZone) throw new ModelGatewayError('CONFIG_INVALID');
    let startAt: string | undefined, endAt: string | undefined;
    try { startAt = resolveInstant(input.start ?? '', timeZone, now); endAt = resolveInstant(input.end ?? '', timeZone, now); }
    catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    const rates = startAt && this.readers.rates ? structuredClone(await this.readers.rates.read(scope, context, startAt, expectedContext)) : undefined;
    if (rates && !Array.isArray(rates)) throw new ModelGatewayError('INVALID_RESPONSE');
    const clarifications: Array<{ field: string; reason: string; action: string;
      candidates: Array<{ id: string; label: string; phoneMasked?: string }>; truncated?: boolean }> = [];
    const choose = (field: string, reason: string, rows: Array<{ id: string; label: string; phoneMasked?: string }>, sourceTruncated = false) => {
      clarifications.push({ field, reason, action: 'select_authorized_id', candidates: rows.slice(0, 10), truncated: sourceTruncated || rows.length > 10 });
    };
    if (enterprise && bookingOptions && !bookingOptions.options.some(row => row.corporateCustomerId === enterprise.corporateCustomerId)) {
      missingFields.push('bookingIdentity.corporateCustomerId');
      if (enterprise.corporateCustomerId && bookingOptions.truncated) {
        // A selected enterprise absent from an incomplete page is not proven
        // ineligible. Preserve that intent; neither chase pages nor suggest a
        // different payer merely because it appeared in the bounded prefix.
        clarifications.push({ field: 'bookingIdentity.corporateCustomerId',
          reason: 'selected_enterprise_not_observed_in_bounded_page', action: 'use_original_qualification_flow',
          candidates: [], truncated: true });
      } else choose('bookingIdentity.corporateCustomerId', 'current_authorized_enterprise_choice_required',
        bookingOptions.options.map(row => ({ id: row.corporateCustomerId, label: row.corporateCustomerName })));
    }
    if (enterprise && enterprise.enterpriseContractAndPayer === undefined) {
      missingFields.push('bookingIdentity.enterpriseContractAndPayer');
      choose('bookingIdentity.enterpriseContractAndPayer', 'explicit_contract_and_payer_choice_required', [
        { id: 'personal_payer', label: '个人签约与付款，使用当前企业员工权益' },
        { id: 'enterprise_payer', label: '申请由所选企业签约与付款（仍须原资格与审批）' }
      ]);
    }
    if (!input.items) { missingFields.push('items'); choose('items', 'product_and_quantity_required', catalog.items.filter(row => row.status === 'enabled').map(row => ({ id: row.id, label: row.name })), catalog.truncated); }
    // Core owns effective-date/version resolution. Offer only units with an
    // actual rate for this exact product; never fall back to a configuration default.
    const pricingUnits = context.category.businessModel.pricingUnits.filter(unit => context.settings.pricing.enabledUnits.includes(unit));
    const unitsFor = (itemGroupId?: string) => pricingUnits.filter(unit => rates?.some(rate =>
      (rate.pricingGroupId ?? rate.itemGroupId) === itemGroupId && rate.unit === unit));
    const unavailableRates: string[] = [], originalGroupBookingFields: string[] = [];
    const lines = (input.items ?? []).map((item, index) => {
      const partialName = !item.itemGroupId && catalog.queryBasis.some(page => 'name' in page.query
        && page.query.name === item.productName && page.truncated);
      const availableMatches = catalog.items.filter(row => row.status === 'enabled' && (item.itemGroupId ? row.id === item.itemGroupId : row.name === item.productName));
      const matches = partialName ? [] : availableMatches;
      if (matches.length !== 1) (matches.length ? ambiguous : missingFields).push(`items.${index}`);
      if (matches.length !== 1) choose(`items.${index}`, partialName ? 'partial_name_candidates_require_explicit_id' : matches.length ? 'ambiguous_product' : 'product_not_resolved',
        (availableMatches.length ? availableMatches : catalog.items.filter(row => row.status === 'enabled')).map(row => ({ id: row.id, label: row.name })), partialName);
      const units = matches.length === 1 ? unitsFor(matches[0].id) : [];
      if (matches.length === 1 && startAt && !units.length) {
        // A versioned group rate is not a product-ID rate. The current original
        // candidate/material contracts cannot select pricingGroupId; identify
        // the real configured dependency without inventing an alias or price.
        const configuredGroupRate = context.pricingGroups?.some(group => group.status === 'enabled'
          && group.memberItemGroupIds.includes(matches[0].id)
          && rates?.some(rate => rate.pricingGroupId === group.id && pricingUnits.includes(rate.unit)));
        (configuredGroupRate ? originalGroupBookingFields : unavailableRates).push(`items.${index}.pricingUnit`);
      }
      if (!item.pricingUnit || !units.includes(item.pricingUnit)) {
        missingFields.push(`items.${index}.pricingUnit`);
        choose(`items.${index}.pricingUnit`, 'explicit_supported_pricing_unit_required', units.map(unit => ({ id: unit, label: unit })));
      }
      if (item.pricingUnit === 'usage' && units.includes('usage') && item.usageQuantity === undefined) {
        missingFields.push(`items.${index}.usageQuantity`);
        clarifications.push({ field: `items.${index}.usageQuantity`, reason: 'usage_quantity_required', action: 'supply_explicit_usage_quantity', candidates: [] });
      }
      return { itemGroupId: matches.length === 1 ? matches[0].id : undefined, quantity: item.quantity,
        ...(item.pricingUnit ? { pricingUnit: item.pricingUnit } : {}),
        ...(item.usageQuantity !== undefined ? { usageQuantity: item.usageQuantity } : {}) };
    });
    const customerCandidates = members.candidates.filter(row => input.customerId ? row.customerId === input.customerId : !input.customerName || row.name === input.customerName);
    // A name, even a currently unique one, does not constitute a user selection.
    if (!input.customerId || customerCandidates.length !== 1) (customerCandidates.length > 1 ? ambiguous : missingFields).push('customerId');
    if (!input.customerId || customerCandidates.length !== 1) choose('customerId', 'explicit_customer_selection_required',
      customerCandidates.map(row => ({ id: row.customerId, label: row.name, phoneMasked: row.phoneMasked })));
    const fulfillmentModes = context.settings.fulfillment.enabledModes.filter(mode => context.category.businessModel.fulfillmentModes.includes(mode));
    const selectedMode = input.fulfillmentMode && fulfillmentModes.includes(input.fulfillmentMode) ? input.fulfillmentMode : undefined;
    if (!selectedMode) {
      missingFields.push('fulfillmentMode'); choose('fulfillmentMode', 'server_supported_mode_required', fulfillmentModes.map(mode => ({ id: mode, label: mode })));
    }
    // Mirror only Core's current location-capability requirements for clarification.
    // This read neither grants admission nor replaces Core's operator/rule/lock checks.
    const eligibleLocations = (capability?: RentalFulfillmentLocation['capabilities'][number]) => context.locations.filter(row =>
      row.status === 'enabled' && (!capability || Array.isArray(row.capabilities) && row.capabilities.includes(capability)));
    const location = (text: string | undefined, selectedId: string | undefined, field: string,
      capability?: RentalFulfillmentLocation['capabilities'][number]) => {
      const eligible = eligibleLocations(capability), rows = eligible.filter(row => selectedId ? row.id === selectedId : row.name === text);
      if (rows.length !== 1) (rows.length ? ambiguous : missingFields).push(field);
      if (rows.length !== 1) choose(field, capability ? 'location_capability_selection_required' : 'location_selection_required',
        (rows.length ? rows : eligible).map(row => ({ id: row.id, label: row.name })));
      return rows.length === 1 ? rows[0].id : undefined;
    };
    const pickupCapability = selectedMode ? ['delivery', 'onsite_delivery'].includes(selectedMode) ? 'delivery' : 'pickup' : undefined;
    const fulfillmentLocationId = location(input.locationName, input.locationId, 'location', pickupCapability);
    const explicitReturn = Boolean(input.returnLocationName || input.returnLocationId);
    const returnLocationId = explicitReturn ? location(input.returnLocationName, input.returnLocationId, 'returnLocation', 'return') : undefined;
    // Core falls back to the pickup/delivery source when return is omitted. Ask
    // for an explicit current choice if that source cannot return; never switch it.
    if (!explicitReturn && fulfillmentLocationId && !eligibleLocations('return').some(row => row.id === fulfillmentLocationId)) {
      missingFields.push('returnLocation');
      choose('returnLocation', 'return_location_capability_required', eligibleLocations('return').map(row => ({ id: row.id, label: row.name })));
    }
    const needsAddress = Boolean(input.fulfillmentMode && fulfillmentModes.includes(input.fulfillmentMode)
      && ['delivery', 'onsite_delivery'].includes(input.fulfillmentMode) && context.category.businessModel.deliveryDestination === 'customer_address');
    const addresses = needsAddress && input.customerId && customerCandidates.length === 1 && this.readers.addresses
      ? structuredClone(await this.readers.addresses.list(scope, input.customerId)) : undefined;
    if (addresses && expectedContext && addresses.identityHash !== quoteAddressIdentity(expectedContext)) throw new ModelGatewayError('FORBIDDEN');
    const selectedAddress = addresses?.rows.find(row => row.id === input.deliveryAddressId);
    const addressChoices = () => (addresses?.rows ?? []).map(row => ({ id: row.id,
      label: `${row.recipient} ${row.phoneMasked} ${row.province}${row.city}${row.district ?? ''} ${row.detail}`.slice(0, 160) }));
    if (needsAddress && !selectedAddress) {
      missingFields.push('deliveryAddressId'); choose('deliveryAddressId', 'explicit_current_customer_address_required', addressChoices());
    } else if (!needsAddress && input.deliveryAddressId) {
      missingFields.push('deliveryAddressId');
      choose('fulfillmentMode', 'reselect_fulfillment_to_clear_inapplicable_address', fulfillmentModes.map(mode => ({ id: mode, label: mode })));
    }
    if (!startAt) missingFields.push('start');
    if (!endAt || (startAt && Date.parse(endAt) <= Date.parse(startAt))) missingFields.push('end');
    for (const field of ['start', 'end']) if (missingFields.includes(field)) clarifications.push({ field,
      reason: 'explicit_time_with_offset_required', action: 'supply_absolute_time', candidates: [] });
    // Re-read existing protected projections after config awaits. This is a
    // sequential read consistency check, NOT atomic authorization or dispatch.
    const currentCatalog = await readCatalog(), currentMembers = await this.readers.members.read(memberQuery, expectedContext);
    if (JSON.stringify(currentCatalog.scope) !== JSON.stringify(scope) || JSON.stringify(currentMembers.scope) !== JSON.stringify(scope)
      || currentCatalog.audience !== catalog.audience || currentMembers.audience !== members.audience
      || JSON.stringify(currentCatalog.items) !== JSON.stringify(catalog.items)
      || JSON.stringify(currentMembers.candidates) !== JSON.stringify(members.candidates)) throw new ModelGatewayError('FORBIDDEN');
    if (currentCatalog.configurationVersion !== catalog.configurationVersion) throw new ModelGatewayError('CONFIG_INVALID');
    const currentContext = structuredClone(await this.contexts.current(scope, expectedContext));
    if (!isDeepStrictEqual(currentContext, context)) throw new ModelGatewayError('CONFIG_INVALID');
    if (rates && startAt && !isDeepStrictEqual(rates, await this.readers.rates!.read(scope, context, startAt, expectedContext))) throw new ModelGatewayError('CONFIG_INVALID');
    if (addresses && !isDeepStrictEqual(addresses, await this.readers.addresses!.list(scope, input.customerId!))) throw new ModelGatewayError('CONFIG_INVALID');
    if (bookingOptions) {
      const current = await this.readers.members.readBookingOptions!({ customerId: input.customerId!, limit: 50 }, expectedContext);
      if (JSON.stringify(current.scope) !== JSON.stringify(scope) || current.audience !== members.audience
        || !isDeepStrictEqual(current.options, bookingOptions.options) || current.truncated !== bookingOptions.truncated
        || current.nextCursor !== bookingOptions.nextCursor) throw new ModelGatewayError('FORBIDDEN');
    }
    // Resolve relative words once against the initial observation. Waiting for
    // protected projections must not make an elapsed period confirmable, nor
    // silently move "today/tomorrow" to another day. Ask for new explicit times;
    // the original candidate, quote and approval are not changed or replayed.
    const completedAt = this.clock();
    if (!(completedAt instanceof Date) || !Number.isFinite(completedAt.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    for (const [field, instant] of [['start', startAt], ['end', endAt]] as const) {
      if (instant && Date.parse(instant) <= completedAt.getTime()) {
        if (!missingFields.includes(field)) missingFields.push(field);
        const clarification = { field, reason: 'rental_time_elapsed', action: 'supply_absolute_time', candidates: [] };
        const index = clarifications.findIndex(row => row.field === field);
        if (index < 0) clarifications.push(clarification); else clarifications[index] = clarification;
      }
    }
    // The supplied revision is an assertion, not part of its own identity.
    // Bind the full candidate so a quantity, period, payer, location or mode
    // edit cannot silently reuse an earlier resource-choice confirmation.
    const { selectionRevision: _assertedRevision, ...candidateInput } = input;
    // The same relative end words may resolve to a different day on a later
    // review. Bind both resolved instants, not only raw words/the pricing start.
    const selectionRevision = requestFingerprint({ scope, context, candidateInput, resolvedPeriod: { startAt, endAt }, items: catalog.items,
      catalogBasis: catalog.queryBasis, members: members.candidates,
      pricing: rates ? { at: startAt, ratesHash: requestFingerprint(rates) } : null,
      ...(addresses ? { addresses } : {}),
      ...(bookingOptions ? { bookingOptions: bookingOptions.options, truncated: bookingOptions.truncated, nextCursor: bookingOptions.nextCursor } : {}) });
    // Both payer selections are candidate intent supported by the original
    // quote flow. Current relationship/benefit and quote-credit checks happen
    // in Core after explicit confirmation; neither option grants order-side
    // signing/payment authority or reserves credit.
    if (originalGroupBookingFields.length) return { status: 'unavailable' as const,
      reason: 'pricing_group_booking_requires_original_flow' as const, selectionRevision,
      missingFields: [...originalGroupBookingFields, ...unavailableRates],
      clarifications: [...originalGroupBookingFields.map(field => ({ field,
        reason: 'configured_group_rate_not_product_only_quote', action: 'use_original_pricing_group_booking_flow', candidates: [] })),
      ...unavailableRates.map(field => ({ field, reason: 'effective_product_rates_required', action: 'use_original_pricing_flow', candidates: [] }))] };
    if (startAt && (!this.readers.rates || unavailableRates.length)) return { status: 'unavailable' as const,
      reason: 'current_product_rates_unavailable' as const, selectionRevision,
      missingFields: unavailableRates.length ? unavailableRates : ['pricingRates'],
      clarifications: [{ field: 'pricingRates', reason: 'effective_product_rates_required', action: 'use_original_pricing_flow', candidates: [] }] };
    if (!pricingUnits.length || !fulfillmentModes.length) return { status: 'unavailable' as const,
      reason: 'category_configuration_unavailable' as const, selectionRevision,
      missingFields: [...(!pricingUnits.length ? ['pricingUnits'] : []), ...(!fulfillmentModes.length ? ['fulfillmentMode'] : [])] };
    if (needsAddress && (!this.readers.addresses || addresses?.rows.length === 0)) {
      return { status: 'unavailable' as const, reason: 'current_customer_addresses_unavailable' as const, selectionRevision,
        missingFields: ['deliveryAddressId'], clarifications: [{ field: 'deliveryAddressId', reason: 'current_customer_address_ownership_required',
          action: 'use_original_delivery_address_flow', candidates: [] }] };
    }
    // Core forbids repeated quote lines for the same product/pricing group.
    // Detect only exact products already resolved by the protected catalog here:
    // do not infer grouping, add quantities, remove a row or choose a substitute.
    const selectedProducts = new Set<string>(), duplicateFields: string[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.itemGroupId) continue;
      if (selectedProducts.has(line.itemGroupId)) duplicateFields.push(`items.${index}`);
      selectedProducts.add(line.itemGroupId);
    }
    if (duplicateFields.length) return { status: 'unavailable' as const,
      reason: 'duplicate_product_lines_require_original_form' as const, selectionRevision,
      missingFields: duplicateFields, clarifications: duplicateFields.map(field => ({ field,
        reason: 'explicit_product_and_quantity_correction_required', action: 'use_original_booking_flow', candidates: [] })) };
    const hasExplicitResourceSelection = Boolean(enterprise || input.locationId || input.returnLocationId || input.deliveryAddressId || input.items?.some(item => item.itemGroupId));
    if ((hasExplicitResourceSelection && !input.selectionRevision) || (input.selectionRevision && input.selectionRevision !== selectionRevision)) {
      // Offer current authorized choices again, rather than advancing the old
      // revision or leaving the persisted clarification with only free text.
      const reconfirm = (field: string, rows: Array<{ id: string; label: string }>) => {
        if (rows.length && !clarifications.some(row => row.field === field)) choose(field, 'current_selection_requires_reconfirmation', rows);
      };
      for (const [index, line] of lines.entries()) {
        const item = catalog.items.find(row => row.status === 'enabled' && row.id === line.itemGroupId);
        if (item) reconfirm(`items.${index}`, [{ id: item.id, label: item.name }]);
        reconfirm(`items.${index}.pricingUnit`, unitsFor(line.itemGroupId).map(unit => ({ id: unit, label: unit })));
      }
      reconfirm('customerId', customerCandidates.map(row => ({ id: row.customerId, label: row.name })));
      if (addresses) reconfirm('deliveryAddressId', addressChoices());
      if (input.deliveryAddressId) reconfirm('fulfillmentMode', fulfillmentModes.map(mode => ({ id: mode, label: mode })));
      if (bookingOptions) reconfirm('bookingIdentity.corporateCustomerId', bookingOptions.options.map(row => ({ id: row.corporateCustomerId, label: row.corporateCustomerName })));
      if (enterprise) reconfirm('bookingIdentity.enterpriseContractAndPayer', [
        { id: 'personal_payer', label: '个人签约与付款，使用当前企业员工权益' },
        { id: 'enterprise_payer', label: '申请由所选企业签约与付款（仍须原资格与审批）' }
      ]);
      for (const [field, selectedId] of [['location', fulfillmentLocationId], ['returnLocation', returnLocationId]] as const) {
        const row = context.locations.find(location => location.status === 'enabled' && location.id === selectedId);
        if (row) reconfirm(field, [{ id: row.id, label: row.name }]);
      }
      return { status: 'missing_input' as const, missingFields: ['selectionRevision', ...missingFields],
        ...(ambiguous.length ? { ambiguousFields: ambiguous } : {}), selectionRevision,
        clarifications: [{ field: 'selectionRevision', reason: 'configuration_or_candidates_changed',
          action: 'reread_and_reconfirm', candidates: [] }, ...clarifications] };
    }
    if (ambiguous.length) return { status: 'ambiguous' as const, ambiguousFields: ambiguous, missingFields, customerCandidates, clarifications, selectionRevision };
    if (missingFields.length) return { status: 'missing_input' as const, missingFields, clarifications, selectionRevision };
    const request = aiQuotePreviewInputSchema.safeParse({ customerType: input.customerType, customerId: input.customerId,
      ...(input.bookingIdentity ? { bookingIdentity: input.bookingIdentity } : {}),
      ...(selectedAddress ? { deliveryAddressId: selectedAddress.id } : {}),
      lines, startAt, endAt, fulfillmentMode: input.fulfillmentMode, fulfillmentLocationId, ...(returnLocationId ? { returnLocationId } : {}) });
    if (!request.success) return { status: 'missing_input' as const, missingFields: ['request'] };
    return { status: 'needs_confirmation' as const, request: request.data, timeZone, observedAt: now.toISOString(), selectionRevision,
      ...(selectedAddress && addresses ? { addressFingerprint: quoteAddressFingerprint(scope, input.customerId!, selectedAddress, addresses.identityHash) } : {}),
      configurationFingerprint: requestFingerprint(context),
      configVersion: context.settings.configVersion, reservation: 'not_reserved' as const };
  }
}
