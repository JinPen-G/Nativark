"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  addCalendarYears,
  anniversaryFromAnchor,
  endFromServiceYears,
  exclusiveEndFromDate,
  calendarYear,
  timeZoneOffsetMinutes,
  isValidTimeZone
} = require("../apps/api/src/modules/subscription/subscription-term");

test("UTC remains the default; calendar arithmetic preserves milliseconds without mutating the anchor", () => {
  const anchor = new Date("2024-02-29T08:30:45.678Z");
  assert.equal(addCalendarYears(anchor, 1).toISOString(), "2025-02-28T08:30:45.678Z");
  assert.equal(anniversaryFromAnchor(anchor.toISOString(), 1), "2025-02-28T08:30:45.678Z");
  assert.equal(endFromServiceYears(anchor.toISOString(), 4), "2028-02-29T08:30:45.678Z");
  assert.equal(addCalendarYears(anchor, 0).toISOString(), anchor.toISOString());
  assert.equal(addCalendarYears(anchor, -1).toISOString(), "2023-02-28T08:30:45.678Z");
  assert.equal(anchor.toISOString(), "2024-02-29T08:30:45.678Z");
});

test("leap-day clamping follows the local date, even when UTC is still February 28", () => {
  const anchor = "2024-02-28T16:30:15.123Z"; // Shanghai: February 29, 00:30:15.123.
  const expected = [
    "2025-02-27T16:30:15.123Z",
    "2026-02-27T16:30:15.123Z",
    "2027-02-27T16:30:15.123Z",
    "2028-02-28T16:30:15.123Z"
  ];
  for (let years = 1; years <= 4; years++) {
    assert.equal(anniversaryFromAnchor(anchor, years, "Asia/Shanghai"), expected[years - 1]);
    assert.equal(endFromServiceYears(anchor, years, "Asia/Shanghai"), expected[years - 1]);
    assert.equal(addCalendarYears(new Date(anchor), years, "Asia/Shanghai").toISOString(), expected[years - 1]);
  }
});

test("a UTC leap day that is locally February 28 must not lose the local February 28 anniversary", () => {
  // New York: February 28, 22:15; the local date is not a leap day.
  assert.equal(
    endFromServiceYears("2024-02-29T03:15:20.456Z", 1, "America/New_York"),
    "2025-03-01T03:15:20.456Z"
  );
  // Los Angeles: February 29, 23:30; UTC has already reached March 1.
  assert.equal(
    anniversaryFromAnchor("2024-03-01T07:30:00.789Z", 4, "America/Los_Angeles"),
    "2028-03-01T07:30:00.789Z"
  );
});

test("anniversaries retain the local clock across changes in DST offset", () => {
  // March 10 is standard time in 2023 and daylight time in 2024.
  assert.equal(
    endFromServiceYears("2023-03-10T17:15:30.987Z", 1, "America/New_York"),
    "2024-03-10T16:15:30.987Z"
  );
});

test("New York date-only ends use the exact next midnight before and after both DST changes", () => {
  for (const [date, expected] of [
    ["2026-03-07", "2026-03-08T05:00:00.000Z"],
    ["2026-03-08", "2026-03-09T04:00:00.000Z"],
    ["2026-10-31", "2026-11-01T04:00:00.000Z"],
    ["2026-11-01", "2026-11-02T05:00:00.000Z"]
  ]) {
    assert.equal(exclusiveEndFromDate(date, "America/New_York"), expected, date);
  }
});

test("fractional-hour zones and half-hour DST changes resolve their actual midnight", () => {
  for (const [date, zone, expected] of [
    ["2026-12-31", "Asia/Kathmandu", "2026-12-31T18:15:00.000Z"],
    ["2026-12-31", "Asia/Kolkata", "2026-12-31T18:30:00.000Z"],
    ["2026-03-07", "America/St_Johns", "2026-03-08T03:30:00.000Z"],
    ["2026-04-04", "Pacific/Chatham", "2026-04-04T10:15:00.000Z"],
    ["2026-10-03", "Australia/Lord_Howe", "2026-10-03T13:30:00.000Z"],
    ["2026-10-04", "Australia/Lord_Howe", "2026-10-04T13:00:00.000Z"]
  ]) {
    assert.equal(exclusiveEndFromDate(date, zone), expected, `${date} ${zone}`);
  }
  assert.equal(
    endFromServiceYears("2024-02-28T18:45:12.345Z", 1, "Asia/Kathmandu"),
    "2025-02-27T18:45:12.345Z"
  );
});

test("repeated wall times deterministically choose the earlier instant, including half-hour repeats", () => {
  assert.equal(
    endFromServiceYears("2024-11-02T05:30:00.123Z", 1, "America/New_York"),
    "2025-11-02T05:30:00.123Z" // 01:30 EDT, not the later 01:30 EST.
  );
  assert.equal(
    endFromServiceYears("2023-04-06T15:15:00.456Z", 1, "Australia/Lord_Howe"),
    "2024-04-06T14:45:00.456Z" // 01:45 +11, not the later 01:45 +10:30.
  );
  assert.equal(
    exclusiveEndFromDate("2020-10-31", "America/Havana"),
    "2020-11-01T04:00:00.000Z" // Midnight itself repeats in this zone.
  );
});

test("a nonexistent anniversary fails clearly instead of silently moving the wall clock", () => {
  const anchor = "2025-03-08T07:30:00.123Z"; // 02:30; March 8, 2026 skips 02:00-02:59.
  for (const calculate of [
    () => addCalendarYears(new Date(anchor), 1, "America/New_York"),
    () => anniversaryFromAnchor(anchor, 1, "America/New_York"),
    () => endFromServiceYears(anchor, 1, "America/New_York")
  ]) {
    assert.throws(calculate, /nonexistent local time: 2026-03-08T02:30:00\.123 in America\/New_York/);
  }
  assert.throws(
    () => endFromServiceYears("2023-10-05T15:15:00.123Z", 1, "Australia/Lord_Howe"),
    /nonexistent local time.*Australia\/Lord_Howe/
  );
});

test("nonexistent next midnights, including an entire skipped day, are rejected", () => {
  assert.throws(() => exclusiveEndFromDate("2018-11-03", "America/Sao_Paulo"), /nonexistent local time/);
  assert.throws(() => exclusiveEndFromDate("2011-12-29", "Pacific/Apia"), /nonexistent local time/);
  assert.throws(
    () => anniversaryFromAnchor("2010-12-30T22:00:00.123Z", 1, "Pacific/Apia"),
    /nonexistent local time/
  );
});

test("date-only ends validate real Gregorian dates and handle year rollover without the Date.UTC 1900 bias", () => {
  for (const date of ["bad", "2026-2-01", "2026-01-01T00:00:00Z", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "2026-02-30", "2025-02-29", "1900-02-29"]) {
    assert.throws(() => exclusiveEndFromDate(date, "UTC"), /date/, date);
  }
  assert.equal(exclusiveEndFromDate("2000-02-29", "UTC"), "2000-03-01T00:00:00.000Z");
  assert.equal(exclusiveEndFromDate("0000-02-29", "UTC"), "0000-03-01T00:00:00.000Z");
  assert.equal(exclusiveEndFromDate("0099-12-31", "UTC"), "0100-01-01T00:00:00.000Z");
  assert.equal(exclusiveEndFromDate("2026-12-31", "Asia/Shanghai"), "2026-12-31T16:00:00.000Z");
  assert.equal(endFromServiceYears("0096-02-29T12:30:00.123Z", 4), "0100-02-28T12:30:00.123Z");
});

test("calendarYear reads the service-zone year, not the UTC year", () => {
  assert.equal(calendarYear(new Date("2026-12-31T12:00:00.000Z"), "Pacific/Kiritimati"), 2027);
  assert.equal(calendarYear(new Date("2026-01-01T02:00:00.000Z"), "America/New_York"), 2025);
  assert.equal(calendarYear(new Date("2026-01-01T02:00:00.000Z"), "UTC"), 2026);
});

test("offset minutes retain fractional-hour and historical second offsets, unaffected by milliseconds", () => {
  assert.equal(timeZoneOffsetMinutes(new Date("2026-01-01T00:00:00.999Z"), "Asia/Kathmandu"), 345);
  assert.equal(timeZoneOffsetMinutes(new Date("2026-01-01T00:00:00.999Z"), "America/St_Johns"), -210);
  for (const milliseconds of ["000", "987"]) {
    assert.equal(timeZoneOffsetMinutes(new Date(`1900-01-01T00:00:00.${milliseconds}Z`), "Asia/Kathmandu"), 341 + 16 / 60);
  }
  assert.equal(exclusiveEndFromDate("1900-01-01", "Asia/Kathmandu"), "1900-01-01T18:18:44.000Z");
});

test("all timezone-aware APIs reject invalid zones and invalid date instants", () => {
  const anchor = "2026-01-01T00:00:00.000Z";
  for (const zone of ["Not/AZone", ""]) {
    assert.equal(isValidTimeZone(zone), false);
    for (const calculate of [
      () => addCalendarYears(new Date(anchor), 1, zone),
      () => anniversaryFromAnchor(anchor, 1, zone),
      () => endFromServiceYears(anchor, 1, zone),
      () => exclusiveEndFromDate("2026-01-01", zone),
      () => calendarYear(new Date(anchor), zone),
      () => timeZoneOffsetMinutes(new Date(anchor), zone)
    ]) assert.throws(calculate, /invalid time zone/);
  }
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.throws(() => addCalendarYears(new Date(NaN), 1), /invalid date/);
  assert.throws(() => anniversaryFromAnchor("bad", 1), /invalid anchor date/);
  assert.throws(() => endFromServiceYears("bad", 1), /invalid start date/);
  assert.throws(() => calendarYear(new Date(NaN), "UTC"), /invalid date/);
  assert.throws(() => timeZoneOffsetMinutes(new Date(NaN), "UTC"), /invalid date/);
});

test("calendar-year counts cannot silently normalize fractional or nonfinite values", () => {
  const anchor = "2026-01-01T00:00:00.000Z";
  for (const years of [0.5, NaN, Infinity]) {
    assert.throws(() => addCalendarYears(new Date(anchor), years), /years must be an integer/);
  }
  for (const years of [-1, 0, 1.5, NaN, Infinity]) {
    assert.throws(() => anniversaryFromAnchor(anchor, years), /positive integer/);
    assert.throws(() => endFromServiceYears(anchor, years), /positive integer/);
  }
});
