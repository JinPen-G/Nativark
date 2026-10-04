"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-task-card", "apps/miniprogram/src/components/ai-native/ai-task-card"];
test("both task cards are real native components with host-only open events", () => { for (const root of roots) { const ts = fs.readFileSync(`${root}/index.ts`, "utf8"); const wxml = fs.readFileSync(`${root}/index.wxml`, "utf8"); assert.match(ts, /Component\(/); assert.match(ts, /triggerEvent\("open"/); assert.doesNotMatch(ts, /wx\.request|fetch\s*\(|setInterval/); assert.match(wxml, /registered|任务不可用|查看任务|部分完成/); } });
