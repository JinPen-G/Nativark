"use strict";
/** Preserve the original mixed test helper in its selected Rental combination. */
const assert = require("node:assert/strict"), fs = require("node:fs");
const { root } = require("./original-identity.cjs");
const { checkedPath } = require("../../../scripts/controller-sources.cjs");
const selected = checkedPath(root, "tests/fixtures/mcp/public-client-management.cjs");
assert.notEqual(fs.realpathSync(selected), fs.realpathSync(__filename), "Select the independent Rental helper");
module.exports = require(selected);
