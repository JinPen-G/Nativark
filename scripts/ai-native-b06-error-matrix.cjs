'use strict';
const fs = require('node:fs'); const path = require('node:path');
function readSharedCodes(file) {
  if (file) {
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/AI_ERROR_CODES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*as\s+const/);
    const codes = match?.[1]?.match(/"([^"]+)"/g)?.map(item => item.slice(1, -1));
    if (!codes?.length) throw new Error('The selected source does not declare AI_ERROR_CODES');
    return codes;
  }
  const { createControllerSourceLoader } = require('./controller-sources.cjs');
  const loader = createControllerSourceLoader(path.resolve(__dirname, '..'));
  const { AI_ERROR_CODES } = loader.load(loader.resolveSource(__filename, '@rental-os/platform-contracts/ai-task', true));
  if (!Array.isArray(AI_ERROR_CODES) || !AI_ERROR_CODES.length) throw new Error('The public AI error contract is unavailable');
  return [...AI_ERROR_CODES];
}
function buildErrorMatrix(codes) { const actions = ['none', 'clarify', 'reconfirm', 'reauthorize', 'reconcile', 'retry_later', 'manual']; const rows = []; for (const code of codes) rows.push(code === 'AI_RESULT_UNKNOWN' ? { code, retryable: false, nextAction: 'reconcile' } : { code, allowedNextActions: actions, retryable: 'source-defined' }); return { tool: 'ai-native-b06-error-matrix', actions, rows, unknownInvariant: { code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: 'reconcile' } }; }
if (require.main === module) process.stdout.write(JSON.stringify(buildErrorMatrix(readSharedCodes()), null, 2) + '\n');
module.exports = { readSharedCodes, buildErrorMatrix };
