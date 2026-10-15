import { z } from 'zod';
import { RENTAL_FULFILLMENT_MODES } from '@rental-os/shared';
import type { AiBookingMaterial, AiBookingSelection } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { composeAiClientScenes } from '../client-scene.composition';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiClientEntryError, entryDate, entryId, parseEntry } from './client-entry-action';
import { freezeOriginalInput } from '../task-request/original-request.validation';

const serviceSchema = z.object({ serviceId: entryId, quantity: z.number().int().min(1).max(999),
  scheduledStartAt: entryDate.optional(), scheduledEndAt: entryDate.optional(), serviceLocationId: entryId.optional() }).strict();
export const bookingSelectionSchema: z.ZodType<AiBookingSelection> = z.object({
  quoteId: entryId, timeZone: z.string().min(1).max(100), startAt: entryDate, endAt: entryDate,
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: entryId, returnLocationId: entryId.optional(),
  deliveryAddressId: entryId.optional(),
  bookingIdentity: z.object({ bookingIdentity: z.enum(['personal', 'enterprise_employee']), corporateCustomerId: entryId.optional(),
    enterpriseContractAndPayer: z.boolean() }).strict(),
  lines: z.array(z.object({ itemGroupId: entryId, quantity: z.number().int().min(1).max(999) }).strict()).min(1).max(20),
  services: z.array(serviceSchema).max(20).optional()
}).strict().superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt) || new Set(value.lines.map(line => line.itemGroupId)).size !== value.lines.length
    || (value.bookingIdentity.bookingIdentity === 'enterprise_employee') !== Boolean(value.bookingIdentity.corporateCustomerId)
    || (value.bookingIdentity.bookingIdentity === 'personal' && value.bookingIdentity.enterpriseContractAndPayer)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Explicit booking conditions required' });
  }
});
const hashJson = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const stale = (reason: string): never => { throw new AiClientEntryError('AI_PROPOSAL_STALE', reason, 'reprepare'); };
const unavailable = (reason: string): never => { throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', reason); };
const amount = z.number().finite().nonnegative();

export async function readClientBookingMaterial(scenes: ReturnType<typeof composeAiClientScenes>, identity: ClientRequestContext,
  input: AiBookingSelection, now: Date): Promise<AiBookingMaterial> {
  identity = freezeOriginalInput(structuredClone(identity));
  const selection = parseEntry(bookingSelectionSchema, input);
  const catalog = freezeOriginalInput(structuredClone(await scenes.member.catalog()));
  if (catalog.tenantCode !== identity.tenantCode || catalog.workspace.workspaceCode !== identity.workspaceCode
    || catalog.categoryCode !== identity.categoryCode) return stale('catalog_scope_changed');
  if (!catalog.timeZone || selection.timeZone !== catalog.timeZone) {
    throw new AiClientEntryError('AI_INVALID_INPUT', 'confirm_space_time_zone', 'clarify');
  }
  if (Date.parse(selection.startAt) <= now.getTime()) return stale('rental_start_elapsed');
  const quote = freezeOriginalInput(structuredClone(await scenes.member.quote(selection.quoteId)));
  if (quote.id !== selection.quoteId || quote.tenantId !== identity.tenantId || quote.categoryCode !== identity.categoryCode
    || identity.customerType !== 'personal' || quote.request.customerType !== 'personal' || quote.request.customerId !== identity.customerId) {
    throw new AiClientEntryError('AI_ACCESS_DENIED', 'quote_owner_or_scope');
  }
  if (!entryDate.safeParse(quote.expiresAt).success || Date.parse(quote.expiresAt) <= now.getTime()
    || quote.consumedAt || quote.consumedOrderId) return stale('quote_expired_or_consumed');
  if (!entryDate.safeParse(quote.createdAt).success || !entryId.safeParse(quote.pricingPlanVersion).success
    || !entryId.safeParse(quote.ruleVersion).success || !/^[A-Z]{3}$/u.test(quote.currency ?? '')) return unavailable('quote_basis_missing');
  if (quote.pricingContext?.timeZone && quote.pricingContext.timeZone !== catalog.timeZone) return stale('quote_time_zone_changed');
  if (quote.request.deliveryAddressDraft) return unavailable('one_time_delivery_address_recheck_missing');
  if (quote.request.services?.length || selection.services?.length) return unavailable('current_service_capacity_recheck_missing');
  const needsAddress = ['delivery', 'onsite_delivery'].includes(quote.request.fulfillmentMode)
    && catalog.fulfillment.deliveryDestination === 'customer_address';
  let deliveryAddress: AiBookingMaterial['deliveryAddress'];
  if (needsAddress) {
    const addressId = quote.request.deliveryAddressId, snapshot = quote.deliveryAddressSnapshot;
    if (!addressId || !snapshot || snapshot.addressId !== addressId || selection.deliveryAddressId !== addressId) return stale('quote_address_selection_mismatch');
    deliveryAddress = await scenes.member.savedDeliveryAddress(addressId, snapshot);
  } else if (quote.request.deliveryAddressId || quote.deliveryAddressSnapshot || selection.deliveryAddressId) {
    return stale('address_not_applicable_to_fulfillment');
  }
  const membership = quote.membershipSnapshot;
  if (!membership || membership.personalCustomerId !== identity.customerId) return unavailable('quote_membership_basis_missing');
  const actualIdentity = { bookingIdentity: membership.bookingIdentity,
    ...(membership.corporateCustomerId ? { corporateCustomerId: membership.corporateCustomerId } : {}),
    enterpriseContractAndPayer: membership.enterpriseContractAndPayer };
  if (hashJson(actualIdentity) !== hashJson(selection.bookingIdentity)) return stale('booking_identity_changed');
  const options = freezeOriginalInput(structuredClone(await scenes.member.bookingOptions()));
  const matchingIdentity = (values: typeof options) => values.filter(option => option.eligible && option.bookingIdentity === actualIdentity.bookingIdentity
    && (actualIdentity.bookingIdentity === 'personal' || ('corporateCustomerId' in option
      && option.corporateCustomerId === actualIdentity.corporateCustomerId && 'membershipId' in option
      && option.membershipId === membership.corporateMembershipId)));
  const matching = matchingIdentity(options);
  if (matching.length !== 1) throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_membership_revoked');
  const lines = quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }));
  const normalized = { ...selection, startAt: quote.request.startAt, endAt: quote.request.endAt,
    fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId,
    returnLocationId: quote.request.returnLocationId ?? quote.request.fulfillmentLocationId, lines, bookingIdentity: actualIdentity };
  const expected = { ...selection, returnLocationId: selection.returnLocationId ?? quote.request.returnLocationId ?? quote.request.fulfillmentLocationId };
  if (hashJson(normalized) !== hashJson(expected)) return stale('quote_does_not_match_explicit_selection');
  if (!catalog.fulfillment.enabledModes.includes(selection.fulfillmentMode)) return stale('fulfillment_mode_unavailable');
  const outbound = ['delivery', 'onsite_delivery'].includes(selection.fulfillmentMode) ? 'delivery' : 'pickup';
  const locations = [
    { id: normalized.fulfillmentLocationId, capability: outbound }, { id: normalized.returnLocationId, capability: 'return' }
  ].map(target => {
    const found = catalog.locations.filter(location => location.id === target.id && location.status === 'enabled'
      && location.capabilities?.some(capability => capability === target.capability));
    if (found.length !== 1) return stale('location_unavailable');
    return found[0];
  });
  if (normalized.returnLocationId !== normalized.fulfillmentLocationId && !catalog.fulfillment.allowDifferentReturnLocation) return stale('return_location_unavailable');
  const items = lines.map(line => {
    const found = catalog.items.filter(item => item.id === line.itemGroupId);
    if (found.length !== 1) return stale('product_unavailable');
    return found[0];
  });
  const confirmed = parseEntry(bookingSelectionSchema, normalized);
  const availability = freezeOriginalInput(structuredClone(await scenes.member.availability({ locationId: confirmed.fulfillmentLocationId,
    startAt: confirmed.startAt, endAt: confirmed.endAt, lines: confirmed.lines })));
  if (availability.locationId !== confirmed.fulfillmentLocationId || availability.startAt !== confirmed.startAt
    || availability.endAt !== confirmed.endAt || availability.lines.length !== confirmed.lines.length
    || availability.available !== true || confirmed.lines.some(line => {
      const matches = availability.lines.filter(value => value.itemGroupId === line.itemGroupId && value.requestedQuantity === line.quantity);
      return matches.length !== 1 || matches[0].available !== true;
    })) return stale('availability_changed');
  // These reads are separate authorized observations, not a Core transaction.
  // A slow stock read must not return material based on withdrawn configuration,
  // a consumed quote or membership that has since been revoked. Compare only
  // this selection's catalog facts; unrelated products do not invalidate it.
  const catalogBasis = (current: typeof catalog) => ({ tenantCode: current.tenantCode,
    workspace: current.workspace.workspaceCode, categoryCode: current.categoryCode,
    timeZone: current.timeZone, fulfillment: current.fulfillment,
    items: lines.map(line => current.items.filter(item => item.id === line.itemGroupId)),
    locations: [normalized.fulfillmentLocationId, normalized.returnLocationId]
      .map(id => current.locations.filter(location => location.id === id)) });
  const latestCatalog = structuredClone(await scenes.member.catalog());
  if (hashJson(catalogBasis(latestCatalog)) !== hashJson(catalogBasis(catalog))) return stale('catalog_changed_during_preparation');
  const latestQuote = structuredClone(await scenes.member.quote(selection.quoteId));
  if (hashJson(latestQuote) !== hashJson(quote)) return stale('quote_changed_during_preparation');
  const latestOptions = structuredClone(await scenes.member.bookingOptions());
  if (hashJson(matchingIdentity(latestOptions)) !== hashJson(matching)) {
    throw new AiClientEntryError('AI_ACCESS_DENIED', 'booking_membership_changed_during_preparation');
  }
  const quoteFacts = { quoteId: quote.id, quoteVersion: hashJson(quote), pricingPlanVersion: quote.pricingPlanVersion,
    ruleVersion: quote.ruleVersion, priceVersionId: quote.priceVersionId ?? null, calendarVersion: quote.calendarVersion ?? null,
    categoryVersionId: quote.categoryVersionId ?? null, currency: quote.currency!, payableAmount: amount.parse(quote.payableAmount),
    depositAmount: amount.parse(quote.depositAmount), preAuthAmount: amount.parse(quote.preAuthAmount),
    chargeLines: z.array(z.object({ type: entryId, amount: z.number().finite(), sourceId: entryId.nullable(), sourceVersion: entryId.nullable() }).strict()).max(100)
      .parse(quote.chargeLines.map(line => ({ type: line.type, amount: line.amount, sourceId: line.sourceId ?? null, sourceVersion: line.sourceVersion ?? null }))),
    expiresAt: quote.expiresAt, createdAt: quote.createdAt };
  const result: AiBookingMaterial = { selection: confirmed, sources: {
    quoteId: 'user_explicit', timeZone: 'user_explicit', startAt: 'user_explicit', endAt: 'user_explicit',
    fulfillmentMode: 'user_explicit', fulfillmentLocationId: 'user_explicit', lines: 'user_explicit', bookingIdentity: 'user_explicit',
    returnLocationId: selection.returnLocationId ? 'user_explicit' : 'core_normalized', services: selection.services ? 'user_explicit' : 'core_normalized',
    ...(selection.deliveryAddressId ? { deliveryAddressId: 'user_explicit' as const } : {})
  }, ...(deliveryAddress ? { deliveryAddress } : {}), quote: quoteFacts, catalogVersion: hashJson({ items, locations, timeZone: catalog.timeZone, fulfillment: catalog.fulfillment }),
    availabilityVersion: hashJson(availability), identityVersion: hashJson(matching[0]), availability: 'available_at_observation_not_reserved' };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 32768) return unavailable('booking_material_too_large');
  return freezeOriginalInput(result);
}
