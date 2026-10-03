"use strict";
const test = require("node:test"); const assert = require("node:assert/strict");
const { validateScenario } = require("./fixtures/ai-native/scenarios/loader.cjs"); const fixture = require("./fixtures/ai-native/b07-camera.cjs");
test("camera fixture uses the shared scenario envelope and synthetic equipment fields", () => { const scenario = validateScenario(fixture.scenario); assert.equal(scenario.expected, "missing_evidence"); assert.equal(fixture.equipmentGroup.sensor, "full_frame"); assert.ok(fixture.equipmentGroup.lensMount.startsWith("synthetic-")); assert.deepEqual(fixture.branches, ["success", "missing_evidence", "cross_scope"]); });
