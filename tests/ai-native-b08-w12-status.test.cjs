"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-status-panel", "apps/miniprogram/src/components/ai-native/ai-status-panel"];
test("status panels distinguish unknown, budget, capability and read failures with host exits", () => { for (const root of roots) { const source = fs.readFileSync(`${root}/index.wxml`, "utf8"); const ts = fs.readFileSync(`${root}/index.ts`, "utf8"); for (const label of ["unknown", "budget_exhausted", "capability_unavailable", "read_failed"]) assert.match(source, new RegExp(label)); assert.match(ts, /triggerEvent\("manual"/); assert.doesNotMatch(ts, /setTimeout|setInterval|wx\.request/); } });
