"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const files = ["apps/staff-miniprogram/src/components/ai-native/context-isolation.ts", "apps/miniprogram/src/components/ai-native/context-isolation.ts"];
test("context isolation keys all host scope fields and rejects stale generations", () => { for (const file of files) { const source = fs.readFileSync(file, "utf8"); assert.match(source, /context\.audience/); assert.match(source, /context\.tenantId/); assert.match(source, /context\.workspaceId/); assert.match(source, /context\.taskId/); assert.match(source, /generation === generation/); assert.match(source, /visible: false/); assert.doesNotMatch(source, /wx\.getStorage|wx\.request|permission|token/i); } });
