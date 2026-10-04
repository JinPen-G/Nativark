'use strict';
const { buildAcceptanceReport } = require('./ai-native-b06-acceptance-report.cjs');
const categories = Object.freeze(['camera', 'camping', 'vehicle', 'construction']);
function buildB07Report(input = {}) {
  const base = buildAcceptanceReport(input);
  const corpus = input.corpus ?? [];
  const categoryMatrix = categories.map(category => ({ category, scenarios: input.categoryScenarios?.[category] ?? 0, status: input.categoryScenarios?.[category] ? 'covered' : 'not_run' }));
  const json = { ...base.json, tool: 'ai-native-b07-acceptance-report', b07: { corpus, categoryMatrix } };
  const markdown = [base.markdown.trimEnd(), '', '## B07 语料覆盖', ...corpus.map(row => `- ${row.name ?? '未命名'}：${row.status ?? '未标注'}`), '', '## B07 四品类场景矩阵', ...categoryMatrix.map(row => `- ${row.category}：${row.scenarios} 个场景（${row.status}）`), ''].join('\n');
  return { json, markdown };
}
module.exports = { buildB07Report, categories };
