"use strict";
// Synthetic inputs only. No pricing, calendar selection or state algorithms.
const TENANT = "tenant_001";
const START = "2027-01-01T20:00:00.000Z";
const END = "2027-01-02T20:00:00.000Z";
const EXTENDED = "2027-01-03T20:00:00.000Z";
function calendar(version, dayType = "tenant_special", reference) {
  return { tenantId: TENANT, year: 2027, region: "CN", version, status: "published",
    days: [1, 2, 3, 4, 5].map(day => ({ date: `2027-01-0${day}`, dayType, source: "tenant_override",
      closed: false, pricingMultiplier: 1, pricingOverrideRef: reference })) };
}
function rate(group, unit = "calendar_day", amount = 100) {
  return { itemGroupId: group.id, itemGroupCode: group.code, unit, baseAmount: amount,
    minimumUnits: 1, weekendMultiplier: 1.5, holidayMultiplier: 2, depositAmount: 100, preAuthAmount: 100,
    tiers: [], hourGranularityMinutes: 60 };
}
function plan(rates, version = "1.0") {
  return { id: `synthetic-plan-${version}`, tenantId: TENANT, code: `S04-${version}`, name: "Synthetic pricing",
    status: "enabled", version, effectiveFrom: "2026-01-01T00:00:00.000Z", rates };
}
function extension(quote, group) {
  return { order: { id: "synthetic-order", quoteId: quote.id, startAt: START, endAt: END,
    depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount },
    lines: [{ id: "synthetic-line", itemGroupId: group.id, quantity: 1, inventoryMode: group.inventoryMode }],
    newEndAt: EXTENDED, appliedAt: "2027-01-01T21:00:00.000Z", settlementMode: "immediate",
    fulfillmentMode: quote.request.fulfillmentMode, locationIds: [quote.request.fulfillmentLocationId], customerType: "personal" };
}
module.exports = { TENANT, START, END, EXTENDED, calendar, rate, plan, extension };
