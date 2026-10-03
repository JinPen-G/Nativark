'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
test('B06 handoff has one recorded slice note for every milestone', () => { const docs = path.resolve(__dirname, '../docs/开发任务/附件/AI原生系统协作切片'); const expected = Array.from({ length: 16 }, (_, index) => `B06-W${String(index + 1).padStart(2, '0')}-20261003-codex.md`); for (const name of expected) assert.ok(fs.existsSync(path.join(docs, name)), name); });
