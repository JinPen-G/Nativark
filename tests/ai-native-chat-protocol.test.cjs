"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("./fixtures/ai-native/contract-consumer.cjs"); net.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { ChatCompletionsStream: Stream } = require("../apps/api/src/modules/ai-native/chat-completions-stream"), f = require("./fixtures/ai-native/chat-protocol.cjs");
test("S05 byte by byte UTF8 and CRLF boundary decoding, complete stop+DONE and usage", () => {
  const stream = new Stream("synthetic-secret"), deltas = [];
  for (const byte of Buffer.from(f.delta("你好") + f.delta("", "stop") + f.usage + f.done)) deltas.push(...stream.push(Buffer.from([byte])));
  assert.equal(deltas.join(""), "你好"); assert.deepEqual(stream.finish(), { text: "你好", usage: { inputTokens: 1, outputTokens: 2 } });
});
test("S05 no usage stays absent, partial delta is not complete result", () => {
  const stream = new Stream("secret"); stream.push(Buffer.from(f.delta("partial"))); assert.throws(() => stream.finish(), e => e.code === "INVALID_RESPONSE");
  const full = new Stream("secret"); full.push(Buffer.from(f.delta("full", "stop") + f.done)); assert.equal(full.finish().usage, undefined);
});
for (const body of [f.done, f.delta("partial"), f.delta("text", "length") + f.done, f.delta("text", "stop") + f.delta("late") + f.done, f.delta("text", "stop") + f.done + f.done, 'data: not-json\n\n', 'id: arbitrary-sequence\n\ndata: [DONE]\n\n', f.delta("text", "stop") + f.usage + f.usage + f.done]) test("S05 incomplete/duplicate/late/unknown framing never becomes success", () => {
  const stream = new Stream("secret"); assert.throws(() => { stream.push(Buffer.from(body)); stream.finish(); }, e => e.code === "INVALID_RESPONSE");
});
test("S05 tools rejected until frozen input validation/adapter integration available", () => {
  const stream = new Stream("secret"); const body = 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ id: "call-test", function: { name: "rental.order.explain", arguments: "{}" } }] } }] }) + '\n\n';
  assert.throws(() => stream.push(Buffer.from(body)), e => e.code === "CAPABILITY_UNSUPPORTED");
});
test("S05 per-frame/total byte and UTF8/secret echo bounds", () => {
  for (const [body, limit] of [[Buffer.from('data: ' + 'x'.repeat(65537)), 1048576], [Buffer.from(f.delta("x".repeat(65537))), 1048576], [Buffer.from(f.delta("abcd")), 8], [Buffer.from([0xff]), 100], [Buffer.from(f.delta("syn") + f.delta("thetic-secret")), 1048576]]) {
    const stream = new Stream("synthetic-secret", limit); assert.throws(() => stream.push(body), e => e.code === "INVALID_RESPONSE");
  }
});
