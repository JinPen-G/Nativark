"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), test = require("node:test"), net = require("node:net");
const matrix = require("./fixtures/ai-native/threat-matrix.cjs");
const root = path.resolve(__dirname, ".."), attempts = [], originalConnect = net.Socket.prototype.connect, originalFetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("S01 offline-only"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("S01 offline-only"); };
});
test.after(() => { net.Socket.prototype.connect = originalConnect; global.fetch = originalFetch; assert.deepEqual(attempts, []); });

// Validate metadata ONLY. This deliberately neither reads attack meaning nor makes an authorization decision.
function descriptorErrors(row) {
  const schema = matrix.descriptorSchema, errors = [];
  for (const key of schema.required) if (!(key in row)) errors.push(`missing:${key}`);
  for (const key of Object.keys(row)) if (!schema.required.includes(key)) errors.push(`unknown:${key}`);
  if (!schema.requiredOutcomes.includes(row.requiredOutcome)) errors.push("invalid:requiredOutcome");
  if (!schema.observedOutcomes.includes(row.observedOutcome)) errors.push("invalid:observedOutcome");
  if (row.runtimeCoverage !== "missing" || row.evidenceLevel !== "offline_descriptor") errors.push("invalid:evidence");
  if (!Array.isArray(row.responsibleTasks) || !row.responsibleTasks.length || row.responsibleTasks.some(x => !schema.owners.includes(x))) errors.push("invalid:owners");
  if (typeof row.invariant !== "string" || !row.invariant.length) errors.push("invalid:invariant");
  if (!row.input || typeof row.input !== "object" || Array.isArray(row.input)) errors.push("invalid:input");
  return errors;
}

test("offline descriptors can express required reject/reconcile/human exit without runtime pass claims", () => {
  assert.equal(matrix.purpose, "offline_requirements_only");
  assert.equal(matrix.contractBaseline, "awaiting_explicit_Claude_SHA_not_consumed");
  assert.equal(new Set(matrix.cases.map(row => row.id)).size, matrix.cases.length);
  for (const row of matrix.cases) {
    assert.deepEqual(descriptorErrors(row), [], row.id);
    assert.equal(row.independentReview, "pending");
    assert.ok(row.responsibleTasks.includes("AIN-24"));
  }
  assert.deepEqual(new Set(matrix.cases.map(row => row.requiredOutcome)), new Set(["reject", "reconcile", "human_review"]));
});

test("descriptor schema rejects false completion metadata and unknown properties, NOT business attack inputs", () => {
  const original = matrix.cases[0];
  assert.ok(descriptorErrors({ ...original, observedOutcome: "passed" }).includes("invalid:observedOutcome"));
  assert.ok(descriptorErrors({ ...original, handler: "fake" }).includes("unknown:handler"));
  assert.ok(descriptorErrors({ ...original, requiredOutcome: "execute" }).includes("invalid:requiredOutcome"));
  assert.ok(descriptorErrors({ ...original, runtimeCoverage: "complete" }).includes("invalid:evidence"));
  const missing = { ...original }; delete missing.invariant;
  assert.ok(descriptorErrors(missing).includes("missing:invariant"));
});

test("required threat families and downstream ownership are explicitly indexed", () => {
  const categories = new Set(matrix.cases.map(row => row.category));
  for (const category of ["identity", "tenant_scope", "workspace_scope", "data_scope", "field_scope", "fact_source", "prompt_injection", "external_unknown", "approval", "arbitrary_execution"]) assert.ok(categories.has(category));
  const injections = matrix.cases.filter(row => row.category === "prompt_injection");
  assert.deepEqual(injections.map(row => row.ingress), ["customer_note", "knowledge_fragment", "attachment_text"]);
  for (const row of injections) assert.ok(row.responsibleTasks.includes("AIN-10"));
  for (const row of matrix.cases.filter(row => ["approval", "external_unknown"].includes(row.category))) assert.ok(row.responsibleTasks.includes("AIN-07"));
});

test("references resolve to existing static source/test anchors, without calling those entry points", () => {
  for (const row of matrix.cases) {
    const reference = matrix.sources[row.reference]; assert.ok(reference);
    assert.match(reference.commit, /^[a-f0-9]{40}$/u);
    const file = path.resolve(root, reference.path); assert.ok(file.startsWith(root + path.sep));
    assert.ok(fs.statSync(file).isFile());
    assert.ok(fs.readFileSync(file, "utf8").includes(row.anchor), row.anchor);
  }
  const inventory = fs.readFileSync(path.join(root, matrix.sources.S01.path), "utf8");
  assert.ok(inventory.includes('aiMaturity: "unavailable" as const'));
  assert.ok(inventory.includes("NO dispatch handlers"));
});

test("SQL/URL/code/terminal and role-injection inputs remain inert round-trippable JSON", () => {
  const serialized = JSON.stringify(matrix.cases);
  assert.deepEqual(JSON.parse(serialized), matrix.cases);
  function inspect(value) {
    assert.notEqual(typeof value, "function");
    if (value && typeof value === "object") for (const child of Object.values(value)) inspect(child);
  }
  inspect(matrix);
  // No model, Guard, database, authorization algorithm, eval, fetch or executable handler is invoked.
});
