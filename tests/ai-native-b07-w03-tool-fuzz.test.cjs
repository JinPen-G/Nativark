"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { ChatProtocolPolicy } = require("../apps/api/src/modules/ai-native/chat-completions.adapter");
const fuzz = require("./fixtures/ai-native/b07-tool-fuzz.cjs");

test("tool fuzz corpus uses the existing strict protocol validator", () => {
  const policy = new ChatProtocolPolicy({ orderExplainTool: { name: "order_explain", version: "draft-1" } });
  for (const row of fuzz) {
    if (row.accepted) assert.equal(policy.parse("", [row.call]).toolRequests[0].input.orderId, "synthetic-order");
    else assert.throws(() => policy.parse("", [row.call]), error => error.code === "INVALID_RESPONSE");
  }
});
