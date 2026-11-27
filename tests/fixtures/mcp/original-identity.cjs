"use strict";
/** Paired Rental identity tests use the independently owned fixture in the
 * explicitly prepared source root. Public MCP tests do not load this bridge.
 * Missing selection fails before compilation; no retired API/prototype fallback. */
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { checkedPath } = require("../../../scripts/controller-sources.cjs");
assert.ok(process.env.MCP_TEST_SOURCE_ROOT,
  "Paired MCP identity tests require MCP_TEST_SOURCE_ROOT for a prepared Rental combination containing workspace/tests and its original identity fixture");
const root = fs.realpathSync(path.resolve(process.env.MCP_TEST_SOURCE_ROOT));
const selected = checkedPath(root, "tests/fixtures/mcp/original-identity.cjs");
assert.notEqual(fs.realpathSync(selected), fs.realpathSync(__filename),
  "Select the independent Rental fixture; the public checkout cannot supply business identity");
module.exports = require(selected);
assert.equal(fs.realpathSync(module.exports.root), root, "Identity fixture must use the selected source root");
