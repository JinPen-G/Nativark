"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
const sequences = require("./fixtures/ai-native/threat-sequences.cjs");
const prior = require("./fixtures/ai-native/threat-matrix.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("Offline descriptor only"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("Offline descriptor only"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });

// Descriptor formatting only, not an approval/state machine, authorization or retry implementation.
function errors(row) {
  const result = [];
  if (row.executionStatus !== "not_executed" || row.evidenceLevel !== "offline_descriptor") result.push("false-evidence");
  if (!Array.isArray(row.steps) || row.steps.length < 2) return [...result, "missing-sequence"];
  row.steps.forEach((step, i) => {
    if (step.ordinal !== i + 1) result.push("bad-ordinal");
    if (step.observedOutcome !== "not_executed") result.push("false-observation");
    if (!sequences.allowedOutcomes.includes(step.requiredOutcome)) result.push("bad-outcome");
    if (!Array.isArray(step.requirements) || !step.requirements.length) result.push("missing-invariant");
    if (!step.input || typeof step.input !== "object") result.push("missing-input");
  });
  return result;
}

test("multi-step descriptors reference existing threats and explicitly lack runtime evidence", () => {
  assert.equal(sequences.purpose, "planned_multistep_invariants_only");
  assert.equal(sequences.contractStatus, "awaiting_explicit_SHA");
  assert.equal(new Set(sequences.cases.map(row => row.id)).size, sequences.cases.length);
  const known = new Set(prior.cases.map(row => row.id));
  for (const row of sequences.cases) {
    assert.deepEqual(errors(row), [], row.id);
    assert.equal(row.review, "pending");
    assert.ok(row.owners.includes("AIN-24"));
    assert.ok(row.remainingGap.length > 0);
    assert.match(row.baseline, /^[a-f0-9]{40}$/u);
    assert.ok(row.references.length > 0);
    for (const ref of row.references) assert.ok(known.has(ref), ref);
  }
});

test("format validator rejects missing stages and fabricated observation, not business attacks", () => {
  const sample = structuredClone(sequences.cases[0]);
  sample.steps[2].ordinal = 5;
  assert.ok(errors(sample).includes("bad-ordinal"));
  sample.steps[2].observedOutcome = "blocked_by_real_guard";
  assert.ok(errors(sample).includes("false-observation"));
  sample.executionStatus = "passed";
  assert.ok(errors(sample).includes("false-evidence"));
  sample.steps = [];
  assert.ok(errors(sample).includes("missing-sequence"));
});

test("unknown-result descriptions contain reconcile and no duplicate-action requirements", () => {
  for (const id of ["unknown-refund-and-new-key", "external-success-internal-funding-failed"]) {
    const row = sequences.cases.find(item => item.id === id);
    assert.ok(row.owners.includes("AIN-15"));
    assert.equal(row.steps.at(-1).requiredOutcome, "reconcile");
    assert.ok(row.steps.at(-1).requirements.includes("no_duplicate_external_action"));
    assert.ok(row.steps.at(-1).requirements.includes("human_exit"));
  }
});

test("untrusted chained sources remain inert data, not model replies or executable actions", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(sequences)), sequences);
  function inspect(value) {
    assert.notEqual(typeof value, "function");
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      assert.ok(!["handler", "modelOutput", "successRate", "correctionRate", "humanDuration"].includes(key));
      inspect(child);
    }
  }
  inspect(sequences);
});
