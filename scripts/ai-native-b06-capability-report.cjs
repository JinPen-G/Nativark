'use strict';
function buildCapabilityReport(rows) {
  const matrix = { supported: { mock: [], live: [], expired: [], revision_mismatch: [] }, unsupported: { mock: [], live: [], expired: [], revision_mismatch: [] }, unverified: { mock: [], live: [], expired: [], revision_mismatch: [] } };
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = row && (row.status === 'supported' || row.status === 'unsupported' || row.status === 'unverified') ? row.status : 'unverified';
    const evidence = row && row.evidence === 'live' ? 'live' : 'mock';
    const bucket = row && row.revisionMismatch ? 'revision_mismatch' : row && row.expired ? 'expired' : evidence;
    matrix[status][bucket].push(typeof row.feature === 'string' ? row.feature : 'unknown');
  }
  const json = { tool: 'ai-native-b06-capability-report', matrix };
  const lines = ['# AI 能力证据矩阵', '', '| 状态 | 模拟 | 实时 | 过期 | 修订不匹配 |', '| --- | --- | --- | --- | --- |'];
  for (const status of ['supported', 'unsupported', 'unverified']) lines.push(`| ${status} | ${matrix[status].mock.join(', ') || '—'} | ${matrix[status].live.join(', ') || '—'} | ${matrix[status].expired.join(', ') || '—'} | ${matrix[status].revision_mismatch.join(', ') || '—'} |`);
  return { json, markdown: lines.join('\n') + '\n' };
}
module.exports = { buildCapabilityReport };
