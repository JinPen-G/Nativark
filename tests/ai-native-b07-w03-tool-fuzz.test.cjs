"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./fixtures/ai-native/rental-compatibility-source.cjs");
const { ChatProtocolPolicy } = load("@rental-os/ai-native-server/runtime/chat-completions.adapter");
const fuzz = require("./fixtures/ai-native/b07-tool-fuzz.cjs");

test("tool fuzz corpus uses the existing strict protocol validator", () => {
  const policy = new ChatProtocolPolicy({ orderExplainTool: { name: "order_explain", version: "draft-1" } });
  for (const row of fuzz) {
    if (row.accepted) assert.equal(policy.parse("", [row.call]).toolRequests[0].input.orderId, "synthetic-order");
    else assert.throws(() => policy.parse("", [row.call]), error => error.code === "INVALID_RESPONSE");
  }
});
