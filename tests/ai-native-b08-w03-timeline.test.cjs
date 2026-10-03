"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-step-timeline", "apps/miniprogram/src/components/ai-native/ai-step-timeline"];
test("timeline components bound the list and label registration separately from execution", () => { for (const root of roots) { const ts = fs.readFileSync(`${root}/index.ts`, "utf8"); const wxml = fs.readFileSync(`${root}/index.wxml`, "utf8"); assert.match(ts, /slice\(0, 50\)/); assert.match(wxml, /无法识别／待刷新/); assert.match(wxml, /步骤不可用/); assert.doesNotMatch(ts, /wx\.request|fetch\s*\(|setInterval/); } });
