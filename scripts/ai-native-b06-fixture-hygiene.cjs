'use strict';
const fs = require('node:fs'); const path = require('node:path');
const EXCEPTIONS = [
  { file: 'model-config-compatibility.cjs', pattern: 'synthetic-key-not-real', reason: '历史兼容夹具明确标注为非真实 key' },
  { file: 'model-config-compatibility.cjs', pattern: 'synthetic-secret-box-test-only', reason: '历史 SecretBox 替身，仅用于离线测试' },
  { file: 'model-egress.cjs', pattern: 'Bearer synthetic', reason: '历史出网夹具的合成 Authorization 值' },
  { file: 'fact-baseline.cjs', pattern: 'Date.now()', reason: '历史基线夹具动态生成相对时间，本工具不把它作为 B06 确定性输入' },
];
const rules = [
  ['credential', /(?:api[_-]?key|password|secret|authorization)\s*[:=]\s*['"`]?\s*(?!synthetic|test|false|true|undefined|null)/i],
  ['bearer', /\bBearer\s+(?!synthetic\b|test\b)[A-Za-z0-9._-]{8,}/i],
  ['pii_phone', /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ['pii_id', /(?<!\d)\d{15}(?:\d{3})?(?!\d)/],
  ['nondeterministic_time', /\b(?:Date\.now\(\)|Math\.random\(\)|crypto\.randomUUID\(\))\b/],
];
function isExcepted(file, pattern, line) { return EXCEPTIONS.some(item => path.basename(file) === item.file && line.includes(item.pattern) && item.pattern === pattern); }
function scanText(text, file = 'inline') {
  const violations = []; text.split(/\r?\n/).forEach((line, index) => { for (const [code, regex] of rules) if (regex.test(line)) { const matched = line.trim(); const exception = EXCEPTIONS.find(item => path.basename(file) === item.file && matched.includes(item.pattern)); if (!exception) violations.push({ file, line: index + 1, code, sample: matched.slice(0, 160) }); } });
  return violations;
}
function scanDirectory(root) { const files = []; const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const filename = path.join(dir, entry.name); if (entry.isDirectory()) visit(filename); else if (/\.(cjs|js|json|ts|tsx)$/.test(entry.name)) files.push(...scanText(fs.readFileSync(filename, 'utf8'), path.relative(root, filename))); } }; visit(root); return files; }
if (require.main === module) { const root = path.resolve(process.cwd(), 'tests/fixtures/ai-native'); const result = { tool: 'ai-native-b06-fixture-hygiene', exceptions: EXCEPTIONS, violations: scanDirectory(root) }; process.stdout.write(JSON.stringify(result, null, 2) + '\n'); process.exitCode = result.violations.length ? 1 : 0; }
module.exports = { EXCEPTIONS, rules, scanText, scanDirectory };
