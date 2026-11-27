'use strict';

/** The workspace publication belongs to the explicitly selected Rental host.
 * Resolve its declared export before reading input; missing source is unavailable. */
async function checkPublication(input, options = {}) {
  if (!options.sourceRoot) throw new Error('Select the prepared Rental source with --source-root');
  const path = require('node:path');
  const { createControllerSourceLoader } = require('../controller-sources.cjs');
  const sourceRoot = path.resolve(options.sourceRoot);
  const loader = createControllerSourceLoader(sourceRoot, options.dependencyRoot);
  const { parseRuntimePublication } = loader.load(loader.resolveSource(path.join(sourceRoot, 'package.json'),
    '@rental-os/ai-native-server/runtime/runtime-publication.schema', true));
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
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = { '--source-root': 'sourceRoot', '--dependency-root': 'dependencyRoot' }[args[index]];
    if (!name || !args[index + 1] || options[name]) throw new Error('Expected --source-root <prepared-root> [--dependency-root <node_modules>]');
    options[name] = args[index + 1];
  }
  checkPublication(process.stdin, options).then(state => {
    console.log(`AI_RUNTIME_PUBLICATION ${state}`);
    process.exitCode = state === 'configured' ? 0 : state === 'unconfigured' ? 2 : 1;
  }).catch(() => { console.error('AI_RUNTIME_PUBLICATION unavailable'); process.exitCode = 1; });
}
module.exports = { checkPublication };
