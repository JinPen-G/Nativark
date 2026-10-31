/** Minimum human review of the frozen input/quote, never current master data,
 * pricing or an approval grant. Missing operational facts block new approval;
 * original decision receipts remain independently readable. */
import { z } from 'zod';
import { RENTAL_CATEGORY_DEFINITIONS, RENTAL_FULFILLMENT_MODES, RENTAL_PRICING_UNIT_CODES, type AiApprovalOrderMaterialDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const name = z.string().trim().min(1).max(191);
const time = z.string().datetime({ offset: true });
const quantity = z.number().finite().min(1);
const booking = z.object({ bookingIdentity: z.enum(['personal', 'enterprise_employee']).optional(),
  corporateCustomerId: id.optional(), enterpriseContractAndPayer: z.boolean().optional() }).passthrough();
const request = z.object({ customerId: id, customerType: z.enum(['personal', 'corporate']),
  customerName: name.optional(), bookingIdentity: booking.optional(), fulfillmentMode: z.enum(RENTAL_FULFILLMENT_MODES),
  fulfillmentLocationId: id, returnLocationId: id.optional(), startAt: time, endAt: time,
  lines: z.array(z.object({ itemGroupId: id, pricingGroupId: id.optional(), quantity,
    pricingUnit: z.enum(RENTAL_PRICING_UNIT_CODES).optional() }).passthrough()).min(1).max(100),
  services: z.array(z.object({ serviceId: id, quantity }).passthrough()).max(100).optional(),
  deliveryAddressId: id.optional(), deliveryAddressDraft: z.unknown().optional()
}).passthrough();
const address = z.object({ recipient: z.string().trim().min(1).max(128), countryCode: z.string().min(1).max(16),
  province: z.string().min(1).max(128), city: z.string().min(1).max(128), district: z.string().min(1).max(128).optional(),
  detail: z.string().min(1).max(500), postalCode: z.string().min(1).max(32).optional() });
const service = z.object({ serviceId: id, serviceName: name, quantity, scheduledStartAt: time, scheduledEndAt: time,
  serviceLocationId: id, requiredByRule: z.boolean() }).passthrough();
const periodValid = (startAt: string, endAt: string) => Date.parse(startAt) < Date.parse(endAt);

export function approvedOrderReviewMaterial(inputValue: unknown, quoteValue: unknown): AiApprovalOrderMaterialDraft {
  try {
    const input = request.parse(inputValue);
    const quote = z.object({ categoryCode: z.string(), request, serviceSnapshots: z.array(service).max(100), serviceAmount: z.number().finite().nonnegative(),
      pricingContext: z.object({ timeZone: z.string().min(1).max(128) }).passthrough().optional(),
      rateSnapshot: z.array(z.object({ itemGroupId: id, pricingGroupId: id.optional(), itemGroupName: name.optional(),
        pricingGroupName: name.optional() }).passthrough()),
      membershipSnapshot: z.object({ personalCustomerId: id, personalCustomerName: name, bookingIdentity: z.enum(['personal', 'enterprise_employee']),
        corporateCustomerId: id.optional(), corporateCustomerName: name.optional(), enterpriseContractAndPayer: z.boolean() }).passthrough().optional(),
      deliveryAddressSnapshot: address.optional()
    }).passthrough().parse(quoteValue);
    const frozen = quote.request;
    const keys = (lines: typeof input.lines) => lines.map(line => JSON.stringify([line.pricingGroupId, line.itemGroupId, line.quantity])).sort();
    if (!periodValid(frozen.startAt, frozen.endAt) || input.customerId !== frozen.customerId || input.customerType !== frozen.customerType
      || input.startAt !== frozen.startAt || input.endAt !== frozen.endAt || input.fulfillmentMode !== frozen.fulfillmentMode
      || input.fulfillmentLocationId !== frozen.fulfillmentLocationId || input.returnLocationId !== frozen.returnLocationId
      || JSON.stringify(keys(input.lines)) !== JSON.stringify(keys(frozen.lines))
      || JSON.stringify(input.bookingIdentity ?? {}) !== JSON.stringify(frozen.bookingIdentity ?? {})) throw Error('material mismatch');
    const membership = quote.membershipSnapshot;
    const identity = frozen.bookingIdentity?.bookingIdentity ?? 'personal';
    const enterpriseContractAndPayer = frozen.bookingIdentity?.enterpriseContractAndPayer ?? false;
    const corporateCustomerId = frozen.bookingIdentity?.corporateCustomerId;
    if (membership && (membership.personalCustomerId !== frozen.customerId || membership.bookingIdentity !== identity
      || membership.enterpriseContractAndPayer !== enterpriseContractAndPayer || membership.corporateCustomerId !== corporateCustomerId)
      || identity === 'enterprise_employee' && (!membership || !corporateCustomerId)
      || enterpriseContractAndPayer && !membership) throw Error('membership evidence missing');
    const category = RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === quote.categoryCode);
    const addressRequired = ['delivery', 'onsite_delivery', 'carrier_shipping'].includes(frozen.fulfillmentMode)
      && category?.businessModel.deliveryDestination === 'customer_address';
    if (!category || (addressRequired || frozen.deliveryAddressId || frozen.deliveryAddressDraft) && !quote.deliveryAddressSnapshot
      || quote.serviceAmount > 0 && quote.serviceSnapshots.length === 0
      || quote.serviceSnapshots.some(row => !periodValid(row.scheduledStartAt, row.scheduledEndAt))
      || (frozen.services ?? []).some(row => !quote.serviceSnapshots.some(snapshot => snapshot.serviceId === row.serviceId && snapshot.quantity === row.quantity)))
      throw Error('fulfillment evidence missing');
    const customerName = membership?.personalCustomerName ?? input.customerName;
    return {
      customer: { id: frozen.customerId, type: frozen.customerType, ...(customerName ? { name: customerName } : {}) },
      booking: { identity, enterpriseContractAndPayer, ...(corporateCustomerId ? { corporateCustomerId } : {}),
        ...(membership?.corporateCustomerName ? { corporateCustomerName: membership.corporateCustomerName } : {}) },
      lines: frozen.lines.map(line => {
        const names = quote.rateSnapshot.filter(rate => line.pricingGroupId ? rate.pricingGroupId === line.pricingGroupId : rate.itemGroupId === line.itemGroupId)
          .map(rate => line.pricingGroupId ? rate.pricingGroupName : rate.itemGroupName).filter((value): value is string => !!value);
        const displayName = names.length && new Set(names).size === 1 ? names[0] : undefined;
        return { itemGroupId: line.itemGroupId, quantity: line.quantity,
          ...(line.pricingGroupId ? { pricingGroupId: line.pricingGroupId } : {}), ...(displayName ? { name: displayName } : {}),
          ...(line.pricingUnit ? { pricingUnit: line.pricingUnit } : {}) };
      }),
      period: { startAt: frozen.startAt, endAt: frozen.endAt, ...(quote.pricingContext ? { timeZone: quote.pricingContext.timeZone } : {}) },
      fulfillment: { mode: frozen.fulfillmentMode, pickupLocationId: frozen.fulfillmentLocationId,
        returnLocationId: frozen.returnLocationId ?? frozen.fulfillmentLocationId,
        ...(quote.deliveryAddressSnapshot ? { deliveryAddress: quote.deliveryAddressSnapshot } : {}) },
      services: quote.serviceSnapshots.map(row => ({ serviceId: row.serviceId, name: row.serviceName, quantity: row.quantity,
        startAt: row.scheduledStartAt, endAt: row.scheduledEndAt, locationId: row.serviceLocationId, requiredByRule: row.requiredByRule }))
    };
  } catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
}
