"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/polling-controller.ts", "apps/miniprogram/src/components/ai-native/polling-controller.ts"];
test("polling controllers gate one request, cancel lifecycle and stale responses", () => { for (const file of roots) { const source = fs.readFileSync(file, "utf8"); assert.match(source, /inFlight/); assert.match(source, /new AiCancelController/); assert.match(source, /generation !== this\.generation/); assert.match(source, /destroy\(\)/); assert.match(source, /readPage: AiReadPage/); assert.doesNotMatch(source, /wx\.getStorage|wx\.request|setInterval|setTimeout/); } });
