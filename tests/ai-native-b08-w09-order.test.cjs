"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-order-explanation", "apps/miniprogram/src/components/ai-native/ai-order-explanation"];
test("order explanation components expose only customer-safe supplied money and refund states", () => { for (const root of roots) { const source = fs.readFileSync(`${root}/index.wxml`, "utf8"); assert.match(source, /应收/); assert.match(source, /实收/); assert.match(source, /押金/); assert.match(source, /预授权/); assert.match(source, /退款/); assert.match(source, /待核对/); assert.doesNotMatch(source, /内部|成本|备注|apiKey|token|模型/); } });
