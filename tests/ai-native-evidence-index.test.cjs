"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), test = require("node:test");
const index = require("./fixtures/ai-native/evidence-index.cjs");
const root = path.resolve(__dirname, "..");

test("metadata index has distinct evidence levels and unique tool/fact rows without execution claims", () => {
  assert.equal(index.purpose, "metadata_index_only");
  assert.equal(index.review, "pending_independent_review");
  assert.equal(index.measuredBusinessMetrics, "not_collected");
  assert.equal(new Set(index.levels).size, 11);
  assert.equal(new Set(index.rows.map(row => row.id)).size, index.rows.length);
  assert.equal(index.rows.filter(row => row.id.startsWith("tool-")).length, 14);
  for (const row of index.rows) {
    for (const key of ["entry", "limitations", "family"]) assert.equal(typeof row[key], "string");
    for (const key of ["identities", "scopes", "permissionLayers"]) assert.ok(row[key].length > 0);
    assert.equal(row.aiAvailability, "unavailable");
    assert.equal(row.currentRun, "index_structure_and_paths_only");
    assert.equal(row.independentReview, "pending");
    assert.deepEqual(row.evidence.map(e => e.level), index.levels);
    for (const evidence of row.evidence) {
      assert.ok(["prior_recorded", "prior_known_gap", "not_run"].includes(evidence.status));
      if (!["static", "unit"].includes(evidence.level)) assert.equal(evidence.status, "not_run");
      if (evidence.status !== "not_run") assert.ok(evidence.sources.length);
    }
  }
});

test("committed source references are local existing paths with resolvable text anchors", () => {
  const byId = new Map(index.sources.map(source => [source.id, source]));
  assert.equal(byId.size, index.sources.length);
  for (const source of index.sources) {
    assert.match(source.commit, /^[a-f0-9]{40}$/u);
    assert.equal(source.commit, index.commits[source.slice]);
    assert.equal(path.isAbsolute(source.path), false);
    const absolute = path.resolve(root, source.path);
    assert.ok(absolute.startsWith(root + path.sep));
    assert.ok(fs.statSync(absolute).isFile());
    if (source.anchor) assert.ok(fs.readFileSync(absolute, "utf8").includes(source.anchor));
  }
  for (const row of index.rows) {
    for (const evidence of row.evidence) for (const id of evidence.sources) assert.ok(byId.has(id));
    for (const ref of row.evidenceRefs) {
      assert.ok(byId.has(ref.sourceId));
      assert.ok(fs.readFileSync(path.join(root, byId.get(ref.sourceId).path), "utf8").includes(ref.anchor), ref.anchor);
    }
  }
  // Paths and anchors do not establish commit object contents, historical execution, or business safety.
});

test("index contains no handlers/functions, metrics or runnable command payloads", () => {
  function inspect(value) {
    assert.notEqual(typeof value, "function");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["handler", "dispatch", "successRate", "correctionRate", "humanDuration", "execute"].includes(key));
      inspect(child);
    }
  }
  inspect(index);
});
