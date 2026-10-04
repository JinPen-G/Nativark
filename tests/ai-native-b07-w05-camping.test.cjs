"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { validateScenario } = require("./fixtures/ai-native/scenarios/loader.cjs"); const fixture = require("./fixtures/ai-native/b07-camping.cjs");
test("camping fixture captures kit list and fulfillment branches as synthetic input", () => { assert.equal(validateScenario(fixture.scenario).expected, "no_inventory"); assert.equal(fixture.kit.persons, 4); assert.equal(fixture.kit.equipment.length, 3); assert.ok(fixture.kit.equipment.every(value => value.startsWith("synthetic-"))); assert.ok(fixture.branches.includes("conflict")); });
