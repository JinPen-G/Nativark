"use strict";
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("node:fs"); const path = require("node:path");
const recordDir = path.join("docs", "开发任务", "附件", "AI原生系统协作切片");
test("B08 has a handoff record for all sixteen milestones and both mini-program roots", () => { for (let index = 1; index <= 16; index += 1) { const file = `B08-W${String(index).padStart(2, "0")}-20261004-codex.md`; assert.equal(fs.existsSync(path.join(recordDir, file)), true, file); } for (const root of ["apps/staff-miniprogram/src/components/ai-native", "apps/miniprogram/src/components/ai-native"]) { assert.equal(fs.existsSync(root), true); assert.equal(fs.existsSync(path.join(root, "types.ts")), true); } });
