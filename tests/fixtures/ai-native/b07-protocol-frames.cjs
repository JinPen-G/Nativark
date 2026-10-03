"use strict";
const frame = value => `data: ${JSON.stringify(value)}\r\n\r\n`;
module.exports = Object.freeze({
  text: frame({ choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }] }),
  stop: frame({ choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }] }),
  done: "data: [DONE]\r\n\r\n",
  toolParts: [frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "synthetic-call", type: "function", function: { name: "order_explain", arguments: "{\\\"orderId\\\":\\\"synthetic-" } }] }, finish_reason: null }] }), frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "order\\\"}" } }] }, finish_reason: "tool_calls" }] })],
  missingDone: frame({ choices: [{ index: 0, delta: { content: "partial" }, finish_reason: "stop" }] }),
  duplicateId: [frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "synthetic-call", type: "function" }] }, finish_reason: null }] }), frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "synthetic-call" }] }, finish_reason: "tool_calls" }] })]
});
