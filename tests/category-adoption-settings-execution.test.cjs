"use strict";
require("reflect-metadata");
const assert = require("node:assert/strict");
const { categoryAdoptionSettingsExecutionErrors: check } = require("../apps/api/dist/modules/rental-core/category-adoption-settings-execution.js");
const calendar = { weekendDays: [0, 6], holidayPricingEnabled: false, officialCalendarRegion: "CN" };
const hours = { windows: [{ start: "08:00", end: "18:00" }], pickup: [{ start: "09:00", end: "10:00" }] };
const allocation = { autoPreassign: false, preassignDays: 0, autoLock: false, lockMinutes: 0, protectManual: true };
assert.deepEqual(check(null), []);
for (const value of [{ calendar }, { calendar: { ...calendar, timeZone: "Asia/Shanghai", weeklyHours: Array.from({ length: 7 }, () => structuredClone(hours)) }, allocation }, { calendar: { ...calendar, weeklyHours: [] } }]) {
  const before = structuredClone(value); assert.deepEqual(check(value), []); assert.deepEqual(value, before);
}
for (const value of [{}, { calendar: [] }, { calendar: { ...calendar, weekendDays: [7] } },
  { calendar: { ...calendar, holidayPricingEnabled: "false" } }, { calendar: { ...calendar, timeZone: "Invalid/Zone" } },
  { calendar: { ...calendar, weeklyHours: [hours] } },
  { calendar: { ...calendar, weeklyHours: Array.from({ length: 7 }, () => ({ windows: [{ start: "10:00", end: "09:00" }] })) } },
  { calendar: { ...calendar, weeklyHours: Array.from({ length: 7 }, () => ({ ...hours, pickup: [{ start: "07:00", end: "09:00" }] })) } },
  { calendar: { ...calendar, weeklyHours: Array.from({ length: 7 }, () => ({ windows: [...hours.windows, { start: "17:00", end: "19:00" }] })) } },
  { calendar, allocation: { ...allocation, preassignDays: 366 } }, { calendar, allocation: { ...allocation, lockMinutes: "0" } },
  { calendar, allocation: { ...allocation, extraExecutor: true } }]) {
  const before = structuredClone(value); assert.ok(check(value).length); assert.deepEqual(value, before);
}
const unsafe = structuredClone(calendar); Object.defineProperty(unsafe, "__proto__", { value: {}, enumerable: true });
assert.ok(check({ calendar: unsafe }).length); assert.ok(Object.hasOwn(unsafe, "__proto__"));
const circular = {}; circular.self = circular; assert.ok(check({ calendar: circular }).length);
console.log("category-adoption-settings-execution: real contracts, timezone, seven-day hours, fulfillment windows and allocation passed");
