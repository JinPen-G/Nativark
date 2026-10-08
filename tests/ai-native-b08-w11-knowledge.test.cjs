"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs");
const roots = ["apps/staff-miniprogram/src/components/ai-native/ai-knowledge-source", "apps/miniprogram/src/components/ai-native/ai-knowledge-source"];
test("knowledge sources expose references and block withdrawn or unauthorized opening", () => { for (const root of roots) { const ts = fs.readFileSync(`${root}/index.ts`, "utf8"); const wxml = fs.readFileSync(`${root}/index.wxml`, "utf8"); assert.match(ts, /withdrawn/); assert.match(ts, /no_access/); assert.match(ts, /resourceId/); assert.match(wxml, /版本/); assert.match(wxml, /定位/); assert.doesNotMatch(ts, /http|https|download|wx\.request/i); } });
