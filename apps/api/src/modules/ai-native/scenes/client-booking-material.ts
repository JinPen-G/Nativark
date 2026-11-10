import { z } from 'zod';
import { RENTAL_FULFILLMENT_MODES, AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS } from '@rental-os/shared';
import type { AiBookingMaterial, AiBookingSelection, AiBookingOneTimeAddressConfirmation, RentalDeliveryAddressSnapshot } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { composeAiClientScenes } from '../client-scene.composition';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiClientEntryError, entryDate, entryId, parseEntry } from './client-entry-action';
import { freezeOriginalInput } from '../task-request/original-request.validation';

const serviceSchema = z.object({ serviceId: entryId, quantity: z.number().int().min(1).max(999),
  scheduledStartAt: entryDate.optional(), scheduledEndAt: entryDate.optional(), serviceLocationId: entryId.optional() }).strict();
const oneTimeConfirmationSchema: z.ZodType<AiBookingOneTimeAddressConfirmation> = z.object({
  source: z.literal('original_quote_one_time_address'), snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), confirmed: z.literal(true)
}).strict();
export const bookingSelectionSchema: z.ZodType<AiBookingSelection> = z.object({
  quoteId: entryId, timeZone: z.string().min(1).max(100), startAt: entryDate, endAt: entryDate,
  fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES), fulfillmentLocationId: entryId, returnLocationId: entryId.optional(),
  deliveryAddressId: entryId.optional(), deliveryAddressConfirmation: oneTimeConfirmationSchema.optional(),
  bookingIdentity: z.object({ bookingIdentity: z.enum(['personal', 'enterprise_employee']), corporateCustomerId: entryId.optional(),
    enterpriseContractAndPayer: z.boolean() }).strict(),
  lines: z.array(z.object({ itemGroupId: entryId, quantity: z.number().int().min(1).max(999) }).strict()).min(1).max(20),
  services: z.array(serviceSchema).max(20).optional()
}).strict().superRefine((value, context) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt) || new Set(value.lines.map(line => line.itemGroupId)).size !== value.lines.length
    || (value.bookingIdentity.bookingIdentity === 'enterprise_employee') !== Boolean(value.bookingIdentity.corporateCustomerId)
    || (value.bookingIdentity.bookingIdentity === 'personal' && value.bookingIdentity.enterpriseContractAndPayer)
    || Boolean(value.deliveryAddressId && value.deliveryAddressConfirmation)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Explicit booking conditions required' });
  }
});
const hashJson = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
/** Server-only fingerprint of the original Core snapshot, including its contact
 * basis. Neither raw address content nor this hash is an execution grant. */
export const oneTimeQuoteSnapshotFingerprint = (snapshot: RentalDeliveryAddressSnapshot) => hashJson(snapshot);
const stale = (reason: string): never => { throw new AiClientEntryError('AI_PROPOSAL_STALE', reason, 'reprepare'); };
const unavailable = (reason: string): never => { throw new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', reason); };
const amount = z.number().finite().nonnegative();

export async function readClientBookingMaterial(scenes: ReturnType<typeof composeAiClientScenes>, identity: ClientRequestContext,
  input: AiBookingSelection, at: Date | (() => Date)): Promise<AiBookingMaterial> {
  // Existing Date callers remain compatible; request hosts should pass their
  // server clock so elapsed time across dependency waits can be rechecked.
  const currentTime = () => {
    const value = typeof at === 'function' ? at() : at;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return unavailable('booking_clock_unavailable');
    return new Date(value.getTime());
  };
  const now = currentTime();
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
  // Quote snapshots, not model/caller service amounts, are the historical
  // service authority. Every occurrence needs explicit human selection of the
  // original service/quantity/window/location before a current Core observation.
  const serviceSnapshots = z.array(serviceSchema.extend({ scheduledStartAt: entryDate, scheduledEndAt: entryDate,
    serviceLocationId: entryId }).passthrough()).max(20).parse(quote.serviceSnapshots ?? []);
  const hasServices = Boolean(serviceSnapshots.length || quote.request.services?.length || selection.services?.length);
  const serviceSelection = serviceSnapshots.map(row => ({ serviceId: row.serviceId, quantity: row.quantity,
    scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt, serviceLocationId: row.serviceLocationId }));
  let serviceObservation: Awaited<ReturnType<typeof scenes.member.serviceAvailability>> | null = null;
  if (hasServices) {
    if (!serviceSnapshots.length) return unavailable('quote_service_snapshot_missing');
    if (!selection.services?.length) throw new AiClientEntryError('AI_INVALID_INPUT', 'confirm_original_quote_services', 'clarify');
    const selectedServices = selection.services.map(row => ({ ...row, scheduledStartAt: row.scheduledStartAt ?? quote.request.startAt,
      scheduledEndAt: row.scheduledEndAt ?? quote.request.endAt, serviceLocationId: row.serviceLocationId ?? quote.request.fulfillmentLocationId }));
    const serviceKeys = (rows: typeof serviceSelection) => rows.map(row => hashJson(row)).sort();
    if (hashJson(serviceKeys(selectedServices)) !== hashJson(serviceKeys(serviceSelection))) return stale('quote_service_selection_mismatch');
    serviceObservation = freezeOriginalInput(structuredClone(await scenes.member.serviceAvailability(quote.id)));
    if (serviceObservation.quoteId !== quote.id || serviceObservation.tenantId !== identity.tenantId || serviceObservation.workspaceId !== identity.workspaceId
      || serviceObservation.serviceSnapshotFingerprint !== hashJson(quote.serviceSnapshots) || serviceObservation.reservation !== 'not_attempted'
      || serviceObservation.maintenance !== 'not_attempted' || !/^[a-f0-9]{64}$/u.test(serviceObservation.capacityFingerprint))
      return unavailable('service_capacity_evidence_missing');
    if (serviceObservation.available !== true) return stale('service_capacity_unavailable');
  }
  const needsAddress = ['delivery', 'onsite_delivery'].includes(quote.request.fulfillmentMode)
    && catalog.fulfillment.deliveryDestination === 'customer_address';
  let deliveryAddress: AiBookingMaterial['deliveryAddress'];
  if (needsAddress) {
    const addressId = quote.request.deliveryAddressId, snapshot = quote.deliveryAddressSnapshot;
    if (quote.request.deliveryAddressDraft) {
      if (!snapshot || addressId || snapshot.addressId || selection.deliveryAddressId) return stale('one_time_quote_address_source_mismatch');
      // Missing actual observation stays unavailable even before asking for a
      // choice; clarification cannot imply an unsupported source is ready.
      deliveryAddress = await scenes.member.oneTimeQuoteDeliveryAddress(quote.id);
      const confirmation = selection.deliveryAddressConfirmation;
      if (!confirmation) throw new AiClientEntryError('AI_INVALID_INPUT', 'confirm_original_quote_delivery_address', 'clarify');
      if (confirmation.snapshotFingerprint !== oneTimeQuoteSnapshotFingerprint(snapshot)) return stale('one_time_quote_address_confirmation_changed');
      if (deliveryAddress.quoteId !== quote.id || deliveryAddress.quoteCreatedAt !== quote.createdAt || deliveryAddress.quoteExpiresAt !== quote.expiresAt
        || deliveryAddress.snapshotFingerprint !== confirmation.snapshotFingerprint) return stale('one_time_quote_address_observation_changed');
    } else {
      if (selection.deliveryAddressConfirmation || !addressId || !snapshot || snapshot.addressId !== addressId || selection.deliveryAddressId !== addressId) return stale('quote_address_selection_mismatch');
      deliveryAddress = await scenes.member.savedDeliveryAddress(addressId, snapshot);
    }
  } else if (quote.request.deliveryAddressId || quote.request.deliveryAddressDraft || quote.deliveryAddressSnapshot || selection.deliveryAddressId || selection.deliveryAddressConfirmation) {
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
  // Original identity is historical; a required certificate or enterprise
  // relationship needs the current Membership gate, not just an eligible option.
  // This observation is neither a certificate CAS nor enterprise payer consent.
  const qualificationRule = quote.ruleSnapshot?.qualification;
  if (!qualificationRule || typeof qualificationRule.required !== 'boolean') return unavailable('quote_qualification_basis_missing');
  let qualificationObservation: Awaited<ReturnType<typeof scenes.member.bookingQualification>> | null = null;
  if (qualificationRule.required || actualIdentity.bookingIdentity === 'enterprise_employee') {
    qualificationObservation = freezeOriginalInput(structuredClone(await scenes.member.bookingQualification(quote.id)));
    if (qualificationObservation.quoteId !== quote.id || qualificationObservation.tenantId !== identity.tenantId
      || qualificationObservation.workspaceId !== identity.workspaceId || qualificationObservation.qualified !== true
      || qualificationObservation.basisFingerprint !== hashJson({ membership, rule: qualificationRule, action: 'submit',
        window: { validThroughAt: quote.request.endAt, minimumValidityFromAt: quote.request.startAt } })
      || !/^[a-f0-9]{64}$/u.test(qualificationObservation.resultFingerprint)
      || qualificationObservation.source !== 'original_membership_action_check'
      || qualificationObservation.observation !== 'current_membership_qualification_not_reserved'
      || qualificationObservation.payerAuthorization !== 'not_attested' || qualificationObservation.execution !== 'not_attempted'
      || qualificationObservation.reservation !== 'not_attempted') return unavailable('current_booking_qualification_evidence_missing');
  }
  const lines = quote.request.lines.map(line => ({ itemGroupId: line.itemGroupId, quantity: line.quantity }));
  const normalized = { ...selection, startAt: quote.request.startAt, endAt: quote.request.endAt,
    fulfillmentMode: quote.request.fulfillmentMode, fulfillmentLocationId: quote.request.fulfillmentLocationId,
    returnLocationId: quote.request.returnLocationId ?? quote.request.fulfillmentLocationId, lines, bookingIdentity: actualIdentity,
    ...(hasServices ? { services: serviceSelection } : {}) };
  const expected = { ...selection, returnLocationId: selection.returnLocationId ?? quote.request.returnLocationId ?? quote.request.fulfillmentLocationId,
    ...(hasServices ? { services: serviceSelection } : {}) };
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
  if (serviceObservation) {
    const latestServices = freezeOriginalInput(structuredClone(await scenes.member.serviceAvailability(quote.id)));
    if (latestServices.available !== true || hashJson(latestServices) !== hashJson(serviceObservation)) return stale('service_capacity_changed_during_preparation');
  }
  if (qualificationObservation) {
    // Reopen after the awaited catalog/stock/address/service observations. A
    // withdrawn or expiring current credential cannot emit a new valid material.
    const latestQualification = await scenes.member.bookingQualification(quote.id);
    if (hashJson(latestQualification) !== hashJson(qualificationObservation)) return stale('booking_qualification_changed_during_preparation');
  }
  if (deliveryAddress) {
    // Reopen the same source after stock/catalog/quote/membership waits. An
    // original one-time quote never borrows address-book identity or revision.
    // No refresh/reprice, address write or atomic cross-domain snapshot is implied.
    const snapshot = quote.deliveryAddressSnapshot;
    if (!snapshot) return unavailable('quote_address_basis_missing');
    const latestAddress = deliveryAddress.source === 'original_quote_one_time_address'
      ? await scenes.member.oneTimeQuoteDeliveryAddress(quote.id)
      : await scenes.member.savedDeliveryAddress(deliveryAddress.addressId, snapshot);
    if (hashJson(latestAddress) !== hashJson(deliveryAddress)) return stale('delivery_address_changed_during_preparation');
  }
  const completedAt = currentTime();
  if (Date.parse(quote.expiresAt) <= completedAt.getTime()) return stale('quote_expired_during_preparation');
  if (Date.parse(confirmed.startAt) <= completedAt.getTime()) return stale('rental_start_elapsed_during_preparation');
  const quoteFacts = { quoteId: quote.id, quoteVersion: hashJson(quote), pricingPlanVersion: quote.pricingPlanVersion,
    ruleVersion: quote.ruleVersion, priceVersionId: quote.priceVersionId ?? null, calendarVersion: quote.calendarVersion ?? null,
    categoryVersionId: quote.categoryVersionId ?? null, currency: quote.currency!, payableAmount: amount.parse(quote.payableAmount),
    depositAmount: amount.parse(quote.depositAmount), preAuthAmount: amount.parse(quote.preAuthAmount),
    chargeLines: z.array(z.object({ type: entryId, amount: z.number().finite(), sourceId: entryId.nullable(), sourceVersion: z.string().min(1).max(191).regex(new RegExp(AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS.AiBookingSourceVersion.pattern)).nullable() }).strict()).max(100)
      .parse(quote.chargeLines.map(line => ({ type: line.type, amount: line.amount, sourceId: line.sourceId ?? null, sourceVersion: line.sourceVersion ?? null }))),
    expiresAt: quote.expiresAt, createdAt: quote.createdAt };
  const result: AiBookingMaterial = { selection: confirmed, sources: {
    quoteId: 'user_explicit', timeZone: 'user_explicit', startAt: 'user_explicit', endAt: 'user_explicit',
    fulfillmentMode: 'user_explicit', fulfillmentLocationId: 'user_explicit', lines: 'user_explicit', bookingIdentity: 'user_explicit',
    returnLocationId: selection.returnLocationId ? 'user_explicit' : 'core_normalized', services: selection.services ? 'user_explicit' : 'core_normalized',
    ...(selection.deliveryAddressId ? { deliveryAddressId: 'user_explicit' as const } : {}),
    ...(selection.deliveryAddressConfirmation ? { deliveryAddressConfirmation: 'user_explicit' as const } : {})
  }, ...(deliveryAddress ? { deliveryAddress } : {}), quote: quoteFacts, catalogVersion: hashJson({ items, locations, timeZone: catalog.timeZone, fulfillment: catalog.fulfillment }),
    availabilityVersion: serviceObservation ? hashJson({ inventory: availability, services: serviceObservation }) : hashJson(availability), identityVersion: qualificationObservation ? hashJson({ membershipOption: matching[0], qualification: qualificationObservation }) : hashJson(matching[0]), availability: 'available_at_observation_not_reserved' };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 32768) return unavailable('booking_material_too_large');
  return freezeOriginalInput(result);
}
