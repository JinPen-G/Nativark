"use strict";
/** Read-only governance checks, limited to the entry documents below. No business
 * imports, environment loading, subprocesses, writes or network. File links and
 * table arithmetic are evidence of consistency, never of authorization or G4.
 * Markdown fragments, external URLs and historical records are not validated. */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TASKS = "docs/AI Native/AI Native-开发任务.md";
const FILES = Object.freeze([
  "AGENTS.md", "CLAUDE.md", "README.md", "docs/文档导航.md",
  "apps/admin/AGENTS.md",
  "docs/公共技术资料/开发指南/项目-开发指南.md",
  "docs/公共技术资料/开发指南/数据库-启动指南.md",
  "docs/公共技术资料/界面规范/管理后台-界面规范.md",
  "docs/公共技术资料/接口说明/客户端-API说明.md",
  "docs/AI Native/AI Native-协作接续.md", TASKS,
]);

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Preserve newlines/columns for diagnostics while ignoring examples, comments and code.
function prose(text) {
  let fence;
  return text.replace(/<!--[\s\S]*?-->/g, value => value.replace(/[^\n]/g, " "))
    .split("\n").map(line => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
          && !line.slice(marker[0].length).trim()) fence = null;
        return "";
      }
      if (marker) { fence = marker[1]; return ""; }
      return line.replace(/(`+)([^`]|(?!\1)`)*?\1/g, value => " ".repeat(value.length));
    }).join("\n");
}

function links(text) {
  const clean = prose(text), found = [], errors = [], definitions = new Map();
  const lineAt = at => clean.slice(0, at).split("\n").length;
  const normalize = value => value.trim().replace(/\s+/g, " ").toLowerCase();
  const destination = value => {
    const match = /^(?:<([^<>\n]+)>|([^\s]+?))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?$/.exec(value.trim());
    return match && (match[1] || match[2]);
  };
  // Inline destinations may contain balanced parentheses; angle form allows spaces.
  const inline = /!?\[[^\]\n]*\]\(/g;
  for (let match; (match = inline.exec(clean));) {
    const start = inline.lastIndex;
    let end = start, depth = 1, angle = false;
    for (; end < clean.length && clean[end] !== "\n"; end++) {
      const char = clean[end];
      if (char === "\\") { end++; continue; }
      if (char === "<") angle = true;
      else if (char === ">") angle = false;
      else if (!angle && char === "(") depth++;
      else if (!angle && char === ")" && --depth === 0) break;
    }
    const target = depth === 0 && destination(clean.slice(start, end));
    if (!target) errors.push({ line: lineAt(match.index), rule: "link-syntax", message: "Unsupported or malformed link destination; use <path with spaces>." });
    else found.push({ target, line: lineAt(match.index) });
    inline.lastIndex = end + 1;
  }
  for (const match of clean.matchAll(/^\s{0,3}\[([^\]\n]+)\]:\s*(.+)$/gm)) {
    const target = destination(match[2]);
    if (target) {
      definitions.set(normalize(match[1]), target);
      found.push({ target, line: lineAt(match.index) });
    } else errors.push({ line: lineAt(match.index), rule: "link-syntax", message: "Malformed reference destination." });
  }
  for (const match of clean.matchAll(/!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    if (!definitions.has(normalize(match[2] || match[1])))
      errors.push({ line: lineAt(match.index), rule: "link-reference", message: "Undefined link reference." });
  }
  return { found, errors };
}

function checkLinks(file, text, root, io = fs) {
  const { found, errors } = links(text);
  for (const { target, line } of found) {
    if (/^(?:https?:|mailto:)/i.test(target) || target.startsWith("#")) continue;
    const fail = (rule, message) => errors.push({ line, rule, message });
    // Absolute paths belong in current-site code spans, not portable navigation.
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || /^[\\/]/.test(target)) {
      fail("link-path", `Non-relative local link: ${target}`); continue;
    }
    let decoded;
    try { decoded = decodeURIComponent(target.split(/[?#]/, 1)[0]); }
    catch { fail("link-path", `Invalid URL encoding: ${target}`); continue; }
    if (!decoded || decoded.includes("\0") || /^[\\/]/.test(decoded) || /^[a-z][a-z\d+.-]*:/i.test(decoded)) {
      fail("link-path", "Empty, invalid or encoded non-relative path."); continue;
    }
    const absolute = path.resolve(root, path.dirname(file), decoded);
    if (!inside(root, absolute)) { fail("link-outside", `Path leaves this worktree: ${target}`); continue; }
    try {
      if (!inside(root, io.realpathSync(absolute))) fail("link-outside", `Link resolves outside this worktree: ${target}`);
    } catch (error) {
      fail("link-missing", `Cannot resolve ${target} (${error.code || "error"}).`);
    }
  }
  return errors.map(error => ({ file, ...error }));
}

function tables(text) {
  const lines = prose(text).split("\n"), result = [];
  const cells = line => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim());
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|.*\|\s*$/.test(lines[i]) || !/^\s*\|[\s:|\-]+\|\s*$/.test(lines[i + 1])) continue;
    const table = { header: cells(lines[i]), line: i + 1, rows: [] };
    i += 2;
    for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
      table.rows.push({ cells: cells(lines[i]), line: i + 1 });
    }
    result.push(table); i--;
  }
  return result;
}

function checkTasks(text) {
  const errors = [], all = tables(text);
  const fail = (line, message) => errors.push({ file: TASKS, line, rule: "task-table", message });
  const select = header => {
    const matches = all.filter(table => table.header.join("|") === header.join("|"));
    if (matches.length !== 1) { fail(1, `Expected one current table: ${header.join(" / ")}; found ${matches.length}.`); return null; }
    return matches[0];
  };
  const original = select(["ID", "原始任务", "状态", "主线研发进度", "前置任务", "主需求", "主验收"]);
  const entry = select(["任务", "研发进度"]);
  const summary = select(["指标", "已确认门槛覆盖率"]);
  const scores = (table, prefix, count, scoreIndex) => {
    if (!table) return null;
    const expected = new Set(Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
    const seen = new Set(), values = [];
    for (const row of table.rows) {
      const id = row.cells[0], value = row.cells[scoreIndex];
      if (row.cells.length !== table.header.length) fail(row.line, `Malformed row: ${id}`);
      if (!expected.has(id) || seen.has(id)) fail(row.line, `Unexpected or duplicate task ID: ${id}`);
      seen.add(id);
      if (!/^(?:0|25|50|75|100)%$/.test(value || "")) fail(row.line, `Invalid milestone percentage: ${id}`);
      values.push(Number.parseInt(value, 10));
      if (prefix === "AIN-") {
        if (!["Pending", "In Progress", "Blocked", "Reserved", "Completed"].includes(row.cells[2])) fail(row.line, `Unknown task status: ${id}`);
      }
    }
    for (const id of expected) if (!seen.has(id)) fail(table.line, `Missing task: ${id}`);
    return values;
  };
  const coreScores = scores(original, "AIN-", 28, 3), entryScores = scores(entry, "AIN-ENTRY-", 18, 1);
  if (summary && coreScores && entryScores) {
    const accepted = coreScores.filter(value => value === 100).length;
    const expected = new Map([
      ["原28项研发里程碑覆盖率", `${(coreScores.reduce((a, b) => a + b, 0) / 28).toFixed(1)}%`],
      ["ENTRY增量研发里程碑覆盖率（单独分母）", `${(entryScores.reduce((a, b) => a + b, 0) / 18).toFixed(1)}%`],
      ["原28项正式验收", `${(accepted / 28 * 100).toFixed(1)}%（${accepted}/28）`],
    ]);
    const seen = new Set();
    for (const row of summary.rows) {
      const [label, value] = row.cells;
      if (row.cells.length !== 2 || seen.has(label) || !expected.has(label) || expected.get(label) !== value)
        fail(row.line, `Summary mismatch: ${label}; expected ${expected.get(label) || "a known unique metric"}.`);
      seen.add(label);
    }
    for (const label of expected.keys()) if (!seen.has(label)) fail(summary.line, `Missing summary: ${label}`);
  }
  return errors;
}

function check(root = ROOT, io = fs) {
  const errors = [], documents = new Map();
  const realRoot = io.realpathSync(root);
  for (const file of FILES) {
    try {
      const absolute = path.resolve(realRoot, file);
      if (!inside(realRoot, io.realpathSync(absolute))) throw new Error("Document resolves outside this worktree");
      const text = io.readFileSync(absolute, "utf8");
      if (!text.trim()) throw new Error("Empty required document");
      documents.set(file, text);
      errors.push(...checkLinks(file, text, realRoot, io));
    } catch (error) {
      errors.push({ file, line: 1, rule: "document-read", message: error.message });
    }
  }
  const claude = prose(documents.get("CLAUDE.md") || "");
  if (!/^@AGENTS\.md\s*$/m.test(claude)) errors.push({ file: "CLAUDE.md", line: 1, rule: "shared-entry", message: "Missing explicit @AGENTS.md entry." });
  if (documents.has(TASKS)) errors.push(...checkTasks(documents.get(TASKS)));
  return { errors, checked: documents.size, expected: FILES.length };
}

if (require.main === module) {
  const result = check();
  for (const error of result.errors) console.error(`${error.file}:${error.line} [${error.rule}] ${error.message}`);
  console.log(`docs:check ${result.checked}/${result.expected} documents, ${result.errors.length} errors. File links and table arithmetic only; fragments/external URLs/history/business acceptance not checked.`);
  process.exitCode = result.errors.length ? 1 : 0;
}
module.exports = { FILES, TASKS, prose, links, checkLinks, checkTasks, check };
