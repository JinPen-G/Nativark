"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { validateScenario } = require("./fixtures/ai-native/scenarios/loader.cjs"); const fixture = require("./fixtures/ai-native/b07-construction.cjs");
test("construction fixture preserves machine, meter and qualification fields", () => { assert.equal(validateScenario(fixture.scenario).expected, "missing_evidence"); assert.match(fixture.machine.serial, /^synthetic-/); assert.equal(typeof fixture.machine.hourMeter, "number"); assert.equal(fixture.machine.delivery, "field_site"); assert.ok(fixture.branches.includes("forbidden")); });
