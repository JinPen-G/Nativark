'use strict';

async function checkPublication(input) {
  require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
  const { parseRuntimePublication } = require('../../apps/api/src/modules/ai-native/runtime-publication.schema.ts');
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of input) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 65536) return 'invalid';
      chunks.push(buffer);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return parseRuntimePublication(text).state;
  } catch { return 'invalid'; }
}

if (require.main === module) {
  checkPublication(process.stdin).then(state => {
    console.log(`AI_RUNTIME_PUBLICATION ${state}`);
    process.exitCode = state === 'configured' ? 0 : state === 'unconfigured' ? 2 : 1;
  }).catch(() => { console.error('AI_RUNTIME_PUBLICATION unavailable'); process.exitCode = 1; });
}
module.exports = { checkPublication };
