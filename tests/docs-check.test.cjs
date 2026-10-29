"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { FILES, TASKS, links, checkLinks, checkTasks, check } = require("../scripts/validate-docs.cjs");
const root = path.resolve(__dirname, "..");
// Synthetic current tables, not a frozen assertion about the project's progress.
const taskText = [
  '| ID | 原始任务 | 状态 | 主线研发进度 | 前置任务 | 主需求 | 主验收 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...Array.from({ length: 28 }, (_, i) => `| AIN-${String(i + 1).padStart(2, '0')} | Task | ${i === 0 ? 'Completed' : 'In Progress'} | ${i === 0 ? '100%' : '50%'} | 无 | R01 | A01 |`),
  '', '| 任务 | 研发进度 |', '| --- | --- |',
  ...Array.from({ length: 18 }, (_, i) => `| AIN-ENTRY-${String(i + 1).padStart(2, '0')} | 50% |`),
  '', '| 指标 | 已确认门槛覆盖率 |', '| --- | --- |',
  '| 原28项研发里程碑覆盖率 | 51.8% |',
  '| ENTRY增量研发里程碑覆盖率（单独分母） | 50.0% |',
  '| 原28项正式验收 | 3.6%（1/28） |',
].join('\n');

test("explicit Markdown links preserve Chinese/spaces, references and diagnostic lines", () => {
  const parsed = links('<!-- [ignored](missing.md) -->\n```text\n[ignored](missing.md)\n```\n`[ignored](missing.md)`\n[中文](<目录/文件 名.md#章节>)\n[other][ref]\n[ref]: nested/file(test).md\n');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.found, [
    { target: "目录/文件 名.md#章节", line: 6 },
    { target: "nested/file(test).md", line: 8 },
  ]);
  assert.equal(links('[x](path with spaces.md)').errors[0].rule, "link-syntax");
  assert.equal(links('[x][unknown]').errors[0].rule, "link-reference");
});

test("file links reject missing paths, traversal and realpath escapes without external reads", () => {
  const calls = [];
  const io = { realpathSync(target) {
    calls.push(target);
    if (target.endsWith("missing.md")) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    if (target.endsWith("escape.md")) return path.resolve(root, "..", "outside.md");
    return target;
  } };
  assert.deepEqual(checkLinks("README.md", '[good](<docs/中文 文件.md>) [web](https://example.invalid) [anchor](#ok)', root, io), []);
  assert.equal(calls.length, 1);
  const result = checkLinks("README.md", '[bad](missing.md) [bad](../outside.md) [bad](escape.md) [bad](file:///outside.md)', root, io);
  assert.deepEqual(result.map(row => row.rule), ["link-missing", "link-outside", "link-outside", "link-path"]);
  assert.equal(calls.length, 3, "lexically outside and non-relative URLs never reach the filesystem");
  assert.equal(checkLinks("README.md", '[bad](%ZZ)', root, io)[0].rule, "link-path");
});

test("current task tables calculate the two separate denominators without scanning history", () => {
  assert.deepEqual(checkTasks(taskText), []);
  assert.deepEqual(checkTasks(taskText.replace('Completed | 100%', 'In Progress | 100%')), [], 'legacy task statuses do not authorize or block percentage maintenance');
  assert.deepEqual(checkTasks(`${taskText}\n\n\`\`\`text\n| 任务 | 研发进度 |\n| --- | --- |\n| AIN-ENTRY-01 | 99% |\n\`\`\`\n`), []);
  const badSummary = taskText.replace('| 原28项研发里程碑覆盖率 | 51.8% |', '| 原28项研发里程碑覆盖率 | 99.9% |');
  assert.notEqual(badSummary, taskText);
  assert.ok(checkTasks(badSummary).some(error => /Summary mismatch/.test(error.message)));
});

test("missing/duplicate IDs, invalid milestones and zero parsing fail closed", () => {
  for (const change of [
    value => value.replace('| AIN-ENTRY-02 | 50% |', '| AIN-ENTRY-01 | 50% |'),
    value => value.replace('| AIN-ENTRY-02 | 50% |', ''),
    value => value.replace('| AIN-ENTRY-02 | 50% |', '| AIN-ENTRY-02 | 51% |'),
    value => value.replace('Completed | 100%', 'Unknown | 100%'),
  ]) {
    const bad = change(taskText);
    assert.notEqual(bad, taskText);
    assert.ok(checkTasks(bad).length > 0);
  }
  assert.equal(checkTasks('').length, 3);
  assert.ok(checkTasks(taskText.replace('主线研发进度', 'wrong header')).length > 0);
});

test("document reader stays on its explicit list and refuses missing entry documents", () => {
  const reads = [], texts = new Map(FILES.map(file => [path.join(root, file), '# Minimal document\n']));
  texts.set(path.join(root, "CLAUDE.md"), '@AGENTS.md\n');
  texts.set(path.join(root, TASKS), taskText);
  const io = {
    realpathSync: target => target,
    readFileSync(target) {
      reads.push(target);
      if (!texts.has(target)) throw Object.assign(new Error("not in fixture"), { code: "ENOENT" });
      return texts.get(target);
    },
  };
  assert.deepEqual(check(root, io).errors, []);
  assert.deepEqual(reads, FILES.map(file => path.join(root, file)));
  texts.delete(path.join(root, "README.md"));
  texts.set(path.join(root, "CLAUDE.md"), '# No shared entry\n');
  const result = check(root, io);
  assert.equal(result.checked, FILES.length - 1);
  assert.ok(result.errors.some(row => row.rule === "document-read"));
  assert.ok(result.errors.some(row => row.rule === "shared-entry"));
  texts.set(path.join(root, "CLAUDE.md"), '```text\n@AGENTS.md\n```\n');
  assert.ok(check(root, io).errors.some(row => row.rule === "shared-entry"), "an example is not a live entry");
  assert.ok(check(root, { ...io, realpathSync: target => target.endsWith('README.md') ? path.resolve(root, '..', 'outside.md') : target })
    .errors.some(row => row.rule === 'document-read' && row.file === 'README.md'));
});
