const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProductionDataSource } = require("../apps/api/dist/common/production-data-source.guard.js");

test("production defaults to MySQL and normalizes the datasource before runtime checks", () => {
  assert.equal(assertProductionDataSource("production", undefined), "mysql");
  assert.equal(assertProductionDataSource("production", " MySQL "), "mysql");
});

test("production rejects in-memory adapters while development may use them", () => {
  assert.throws(() => assertProductionDataSource("production", " memory "), /requires PLATFORM_DATA_SOURCE=mysql/u);
  assert.equal(assertProductionDataSource("development", " memory "), "memory");
});
