"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const paths = ["apps/staff-miniprogram/src/components/ai-native/types.ts", "apps/miniprogram/src/components/ai-native/types.ts"];
test("both mini-programs expose the same feature-local AI component vocabulary", () => { const sources = paths.map(file => fs.readFileSync(file, "utf8")); const tokens = sources.map(source => source.match(/\"ai-[a-z-]+\"/g)); assert.deepEqual(tokens[0], tokens[1]); for (const source of sources) { assert.match(source, /export interface AiReadContext/); assert.doesNotMatch(source, /fetch\s*\(|wx\.request|token|apiKey/i); } });
