"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const index = require("./fixtures/ai-native/supplement-handoff.cjs");
const root = path.resolve(__dirname, "..");
test("supplement handoff resolves historical commits and source/record paths without running business suites", () => {
  assert.equal(index.suites.length, 12); assert.equal(new Set(index.suites.map(row => row.name)).size, 12);
  for (const suite of index.suites) {
    assert.match(suite.commit, /^[a-f0-9]{40}$/u);
    for (const reference of [suite.test, suite.record]) {
      assert.equal(path.isAbsolute(reference), false); assert.equal(reference.split(/[\\/]/u).includes(".."), false);
      assert.ok(fs.statSync(path.join(root, reference)).isFile());
      // Read-only Git object existence, NOT replaying the referenced implementation or verification.
      execFileSync("git", ["cat-file", "-e", `${suite.commit}:${reference}`], { cwd: root, stdio: "pipe" });
    }
  }
});
test("supplement evidence counts remain distinct from acceptance and known-gap closure", () => {
  assert.equal(index.suites.reduce((sum, row) => sum + row.authorTestCount, 0), 207);
  assert.equal(index.suites.filter(row => row.evidence === "method_characterization").reduce((sum, row) => sum + row.authorTestCount, 0), 192);
  assert.equal(index.knownGaps, "remain_open"); assert.equal(index.metrics, "not_collected");
  for (const suite of index.suites) {
    assert.equal(suite.independentReview, "pending"); assert.equal(suite.acceptance, "not_claimed");
    assert.ok(["static_inventory", "method_characterization", "metadata_structure", "offline_descriptor"].includes(suite.evidence));
  }
});
test("supplement handoff does not claim external acceptance, enable handlers or freeze absent contracts", () => {
  assert.equal(index.purpose, "reference_metadata_only"); assert.equal(index.centralRecordModified, false);
  assert.equal(index.aiHandlerEnabled, false); assert.equal(index.contractConsumer, "waiting_explicit_coordinator_commit");
  assert.deepEqual(index.unrunEvidence, ["contract", "real_database", "browser", "wechat_host", "real_device", "real_model", "external_payment", "production_canary"]);
});
