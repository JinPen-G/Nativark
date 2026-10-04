"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const files = ["apps/staff-miniprogram/src/components/ai-native/draft-controller.ts", "apps/miniprogram/src/components/ai-native/draft-controller.ts"];
test("draft controllers are memory-only, explicitly unsynced and clearable", () => { for (const file of files) { const source = fs.readFileSync(file, "utf8"); assert.match(source, /sync: "unsynced"/); assert.match(source, /destroy\(\)/); assert.match(source, /this\.state = null/); assert.doesNotMatch(source, /wx\.setStorage|wx\.getStorage|localStorage|token|apiKey|modelText|customer/i); } });
