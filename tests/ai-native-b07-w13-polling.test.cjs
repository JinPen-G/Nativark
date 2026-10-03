"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const file = fs.readFileSync("apps/admin/src/features/ai-native/polling-consumer.ts", "utf8");
test("polling adapter is a pure wrapper around the existing reducer", () => { assert.match(file, /reduceEvent\(next, event\)/); assert.match(file, /resyncRequired: next\.resetRequired/); assert.match(file, /DisplayEventInput/); assert.doesNotMatch(file, /fetch\s*\(|axios|localStorage|setInterval|setTimeout/); });
test("polling adapter exposes bounded batch accounting and no automatic side effects", () => { assert.match(file, /accepted\+\+|accepted \+= 1/); assert.match(file, /rejected\+\+|rejected \+= 1/); assert.match(file, /if \(next\.resetRequired\) break/); });
