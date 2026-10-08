"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-inspection-draft", "apps/miniprogram/src/components/ai-native/ai-inspection-draft"];
test("inspection drafts render supplied candidate/human/source values without capture or submit APIs", () => { for (const root of roots) { const source = fs.readFileSync(`${root}/index.wxml`, "utf8"); assert.match(source, /候选/); assert.match(source, /人工值/); assert.match(source, /来源/); assert.match(source, /待核实/); assert.doesNotMatch(source, /wx\.choose|upload|request|camera|audio/i); } });
