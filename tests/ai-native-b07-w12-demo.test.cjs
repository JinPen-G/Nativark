"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const file = fs.readFileSync("apps/admin/src/features/ai-native/B07OfflineDemo.tsx", "utf8");
test("B07 demo is feature-local, read-only and has no transport or route side effects", () => { assert.match(file, /ReadOnlyBoard/); assert.doesNotMatch(file, /fetch\s*\(|axios|useEffect|localStorage|window\.location/); assert.doesNotMatch(file, /(?:useNavigate|createBrowserRouter|<Route\b|navigate\s*\()/); assert.match(file, /synthetic-b07-task/); });
