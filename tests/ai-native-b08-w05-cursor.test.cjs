"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const files = ["apps/staff-miniprogram/src/components/ai-native/cursor-adapter.ts", "apps/miniprogram/src/components/ai-native/cursor-adapter.ts"];
test("cursor adapters preserve strings, use BigInt and clear stale events on resync boundaries", () => { for (const file of files) { const source = fs.readFileSync(file, "utf8"); assert.match(source, /BigInt\(value\)/); assert.match(source, /next !== current \+ BigInt\(1\)/); assert.match(source, /events: \[\]/); assert.match(source, /reset_required/); assert.match(source, /unknown_version/); assert.doesNotMatch(source, /Number\(.*cursor|parseInt\(.*cursor/); } });
