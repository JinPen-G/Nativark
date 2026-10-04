"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { validateScenario } = require("./fixtures/ai-native/scenarios/loader.cjs"); const fixture = require("./fixtures/ai-native/b07-vehicle.cjs");
test("vehicle fixture preserves VIN, mileage and return evidence as supplied data", () => { assert.equal(validateScenario(fixture.scenario).expected, "missing_evidence"); assert.match(fixture.vehicle.vin, /^synthetic-/); assert.equal(typeof fixture.vehicle.mileageKm, "number"); assert.equal(fixture.vehicle.returnInspection, "required"); assert.ok(fixture.branches.includes("forbidden")); });
