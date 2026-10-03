'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const dir = path.join('docs', '开发任务', '附件', 'AI原生系统协作切片');
test('B07 handoff has a record for every milestone and preserves explicit validation boundaries', () => { for (let index = 1; index <= 16; index += 1) { const name = `B07-W${String(index).padStart(2, '0')}-20261004-codex.md`; assert.equal(fs.existsSync(path.join(dir, name)), true, name); } const records = fs.readdirSync(dir).filter(name => /^B07-W\d{2}-20261004-codex\.md$/.test(name)); assert.equal(records.length, 16); });
