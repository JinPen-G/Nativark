'use strict';
/** Assemble the public MCP package from a fixed source and a clean public emit.
 * No mixed dist, installation, release identity or migration is produced here. */
const { isBuiltin } = require('node:module');
const { posix } = require('node:path');

const compatibility = ['quote-selection-read', 'selected-proposal-read', 'selected-order-result-read'];
const synchronousEsm = new Set(['./original-read-tool', './original-task-recovery-read']);
const assets = ['data-contribution.json', 'prisma/schema.prisma', 'mysql-oauth-schema.sql', 'mysql-read-budget-schema.sql',
  'mysql-catalog-goal-schema.sql', 'mysql-catalog-goal-intent-schema.sql', 'mysql-catalog-goal-adoption-schema.sql'];
const publicPackages = new Set(['@modelcontextprotocol/server', '@rental-os/platform-contracts',
  '@rental-os/core-contracts', '@rental-os/core-host', '@rental-os/platform-core-host']);
const built = /^dist\/[a-z0-9-]+\.(?:js|d\.ts)$/u;
const packageName = specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
function bytes(value, file) {
  if (!(value instanceof Uint8Array) || !value.byteLength) throw Error(`公共 MCP 包缺少材料：${file}`);
  return Buffer.from(value);
}

/** sources is package-relative (including its source license). emitted is
 * relative to the successful public compiler's outDir. */
function assemblePublicMcpPackage(sources, emitted, ts) {
  const metadata = JSON.parse(bytes(sources.get('package.json'), 'package.json').toString('utf8'));
  if (metadata.name !== '@rental-os/mcp-server' || metadata.type !== 'module' || metadata.private !== true || metadata.license !== 'MIT'
    || !metadata.exports || !metadata.typesVersions?.['*'] || !metadata.dependencies?.['@rental-os/platform-contracts']
    || metadata.bin || metadata.optionalDependencies || metadata.bundledDependencies || metadata.bundleDependencies)
    throw Error('公共 MCP 包身份或安装入口无效');
  delete metadata.scripts;
  delete metadata.devDependencies;
  for (const key of compatibility) {
    delete metadata.exports['./' + key];
    delete metadata.typesVersions['*'][key];
  }
  metadata.files = ['dist', ...assets];
  const declared = new Set([...Object.keys(metadata.dependencies), ...Object.keys(metadata.peerDependencies)]);
  if ([...declared].some(name => !publicPackages.has(name))) throw Error('公共 MCP 包含非公共依赖');

  const files = new Map([['package.json', Buffer.from(JSON.stringify(metadata, null, 2) + '\n')],
    ['README.md', bytes(sources.get('README.public.md'), 'README.public.md')], ['LICENSE', bytes(sources.get('LICENSE'), 'LICENSE')]]);
  for (const file of assets) files.set(file, bytes(sources.get(file), file));
  const roots = [];
  for (const [name, entry] of Object.entries(metadata.exports)) {
    if (name === './data-contribution.json' && entry === './data-contribution.json') continue;
    const expectedKeys = synchronousEsm.has(name) ? 3 : 2;
    if (name.includes('*') || !/^\.\/dist\/[a-z0-9-]+\.js$/u.test(entry?.import)
      || !/^\.\/dist\/[a-z0-9-]+\.d\.ts$/u.test(entry?.types)
      || Object.keys(entry).length !== expectedKeys || (expectedKeys === 3 && entry.require !== entry.import)
      || (name === '.' ? metadata.types !== entry.types : metadata.typesVersions['*'][name.slice(2)]?.[0] !== entry.types.slice(2)))
      throw Error(`公共 MCP 运行与类型出口不一致：${name}`);
    roots.push(entry.import.slice(2), entry.types.slice(2));
  }
  if (!roots.length) throw Error('公共 MCP 包缺少运行入口');
  // Follow runtime and declaration imports. An excluded compatibility file
  // cannot slip back in through an exported helper or a stale build directory.
  for (let i = 0; i < roots.length; i++) {
    const file = roots[i];
    if (!built.test(file)) throw Error(`公共 MCP 构建路径越界：${file}`);
    if (files.has(file)) continue;
    const content = bytes(emitted.get(file.slice('dist/'.length)), file);
    files.set(file, content);
    const imports = ts.preProcessFile(content.toString('utf8'), true, true);
    for (const { fileName } of [...imports.importedFiles, ...imports.referencedFiles]) {
      if (fileName.startsWith('.')) {
        const target = posix.join(posix.dirname(file), fileName);
        roots.push(file.endsWith('.d.ts') ? target.replace(/\.js$/u, '.d.ts') : target);
      } else if (!isBuiltin(fileName) && !declared.has(packageName(fileName))) {
        throw Error(`公共 MCP 包缺少正式依赖：${file} -> ${fileName}`);
      }
    }
  }
  return files;
}

module.exports = { assemblePublicMcpPackage };
