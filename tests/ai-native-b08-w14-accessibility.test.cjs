"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native", "apps/miniprogram/src/components/ai-native"];
test("both feature-local style/tooling files cover long labels, wrap and instance IDs", () => { for (const root of roots) { const css = fs.readFileSync(`${root}/responsive.css`, "utf8"); const id = fs.readFileSync(`${root}/accessibility.ts`, "utf8"); assert.match(css, /overflow-wrap/); assert.match(css, /white-space: normal/); assert.match(css, /aria|live|clip/); assert.match(id, /makeAiInstanceId/); assert.match(id, /nextInstance/); } });
