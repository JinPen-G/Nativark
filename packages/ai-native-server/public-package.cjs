'use strict';
/** Assemble the installed package from public build outputs, not a mixed dist.
 * This is a pure packaging step. The host chooses the fixed source, dependency
 * builds and selected Prisma Client before compiling tsconfig.public.json. */
const { basename, dirname, isAbsolute, join, posix } = require('node:path');
const { isBuiltin } = require('node:module');

const publicDependencies = new Set(['platform-contracts', 'platform-server', 'platform-core-host',
  'platform-admin', 'core-contracts', 'core-host'].map(name => `@rental-os/${name}`));
const dataAssets = ['schema.prisma', '20261126000000-initial.sql', 'provenance.json'].map(file => `prisma-public/${file}`);
const valid = file => typeof file === 'string' && !/[\\:*\u0000-\u001f]/u.test(file)
  && file.split('/').every(part => part && !['.', '..', 'node_modules'].includes(part));
const bytes = (value, file) => {
  if (!(value instanceof Uint8Array) || !value.byteLength || value.byteLength > 32 * 1024 * 1024)
    throw Error(`缺少公共 AI 包材料：${file}`);
  return Buffer.from(value);
};
const dependencyName = name => name.split('/').slice(0, name.startsWith('@') ? 2 : 1).join('/');

/** Select the host's already generated public AI Client. The expected schema
 * comes from the fixed data contribution combined with that host's base. */
function publicAiClientPaths(ts, client, expectedSchema, readFile) {
  if (!isAbsolute(client) || basename(client) !== 'index.d.ts' || /[\\/]node_modules[\\/]/u.test(client))
    throw Error('公共 AI 须使用明确的宿主专属 Client');
  const schema = readFile(join(dirname(client), 'schema.prisma')), declarations = readFile(client);
  const normalized = value => value.replace(/\r\n/g, '\n').trim();
  if (typeof schema !== 'string' || typeof declarations !== 'string' || normalized(schema) !== normalized(expectedSchema))
    throw Error('公共 AI Client 与已核组合 schema 不一致');
  const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(row => row[1]).sort();
  if (models.some(model => /^(?:Rental|BusinessWorkspace|WorkspaceMember)/.test(model))
    || ['Tenant', 'User', 'AuthSession', 'AiScope', 'AiTask', 'AiConversation', 'AiGatewayInvocation'].some(name => !models.includes(name)))
    throw Error('公共 AI Client 模型不在已选择的公共边界');
  const tree = ts.createSourceFile(client, declarations, ts.ScriptTarget.Latest, true);
  const scope = tree.statements.find(node => ts.isModuleDeclaration(node) && node.name.text === 'Prisma');
  const modelName = scope?.body && ts.isModuleBlock(scope.body) && scope.body.statements
    .filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]).find(node => node.name.getText(tree) === 'ModelName');
  if (tree.parseDiagnostics.length || !modelName?.type || !ts.isTypeLiteralNode(modelName.type)
    || !tree.statements.some(node => ts.isClassDeclaration(node) && node.name?.text === 'PrismaClient'))
    throw Error('公共 AI Client 声明不是已生成的原类型');
  const declared = modelName.type.members.map(node =>
    ts.isPropertySignature(node) && node.type && ts.isLiteralTypeNode(node.type) && ts.isStringLiteral(node.type.literal)
      && node.name.getText(tree) === node.type.literal.text ? node.type.literal.text : '').sort();
  if (JSON.stringify(declared) !== JSON.stringify(models)) throw Error('公共 AI Client 声明与所选模型不一致');
  return { '@prisma/client': [client] };
}

/** sources uses package-relative paths; emitted uses paths relative to the
 * successful public compiler's outDir. An asset never comes from legacy dist. */
function assemblePublicAiPackage(kind, sources, emitted, ts) {
  if (!['server', 'data', 'admin'].includes(kind) || typeof ts?.preProcessFile !== 'function')
    throw Error('须选择公共 AI 包和实际 TypeScript 构建器');
  const manifest = bytes(sources.get('package.public.json'), 'package.public.json');
  const metadata = JSON.parse(manifest.toString('utf8'));
  if (metadata.name !== `@rental-os/ai-native-${kind}` || metadata.license !== 'MIT' || !metadata.private
    || metadata.scripts || metadata.optionalDependencies || metadata.bundledDependencies || metadata.bin || !Array.isArray(metadata.files))
    throw Error('公共 AI 包身份或安装行为不符');
  const declared = new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.peerDependencies ?? {})]);
  if ([...declared].some(name => name.startsWith('@rental-os/') && !publicDependencies.has(name)))
    throw Error('公共 AI 包声明了非公共工作区依赖');
  const sourcePackage = kind === 'admin', files = new Map([['package.json', manifest]]);
  files.set('README.md', bytes(sources.get('README.public.md'), 'README.public.md'));
  files.set('LICENSE', bytes(sources.get('LICENSE'), 'LICENSE'));
  if (kind === 'data') for (const file of dataAssets) files.set(file, bytes(sources.get(file), file));

  const roots = [];
  for (const [name, entry] of Object.entries(metadata.exports ?? {})) {
    if (name.includes('*')) throw Error('公共 AI 包出口必须逐项声明');
    if (sourcePackage) roots.push(entry);
    else {
      if (typeof entry?.types !== 'string' || typeof entry.default !== 'string'
        || name !== '.' && metadata.typesVersions?.['*']?.[name.slice(2)]?.[0] !== entry.types.slice(2))
        throw Error(`公共 AI 包运行／类型出口不一致：${name}`);
      roots.push(entry.default, entry.types);
    }
  }
  if (!roots.length || roots.some(file => typeof file !== 'string' || !file.startsWith(sourcePackage ? './src/' : './dist/')))
    throw Error('公共 AI 包出口越界');
  const get = sourcePackage ? file => metadata.files.includes(file) ? sources.get(file) : undefined
    : file => file.startsWith('dist/') ? emitted.get(file.slice('dist/'.length)) : undefined;
  const queue = roots.map(file => file.slice(2));
  const resolve = (parent, specifier) => {
    const target = posix.normalize(posix.join(posix.dirname(parent), specifier));
    if (!valid(target) || !target.startsWith(sourcePackage ? 'src/' : 'dist/')) throw Error(`公共 AI 相对依赖越界：${parent}`);
    const suffixes = sourcePackage ? ['.ts', '.tsx', '/index.ts', '/index.tsx']
      : parent.endsWith('.d.ts') ? ['.d.ts', '/index.d.ts'] : ['.js', '/index.js'];
    const file = [target, ...suffixes.map(ext => target + ext)].find(item => get(item));
    if (!file) throw Error(`公共 AI 包缺少闭包依赖：${parent} -> ${specifier}`);
    return file;
  };
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    if (!valid(file) || !(sourcePackage ? /^src\/.+\.(?:ts|tsx|css)$/ : /^dist\/.+\.(?:js|d\.ts)$/).test(file))
      throw Error(`公共 AI 包文件不受支持：${file}`);
    if (files.has(file)) continue;
    const content = bytes(get(file), file);
    files.set(file, content);
    if (file.endsWith('.css')) continue;
    const imports = ts.preProcessFile(content.toString('utf8'), true, true);
    for (const { fileName } of [...imports.importedFiles, ...imports.referencedFiles]) {
      if (fileName.startsWith('.')) queue.push(resolve(file, fileName));
      else if (!isBuiltin(fileName) && !declared.has(dependencyName(fileName)))
        throw Error(`公共 AI 包缺少正式依赖：${file} -> ${fileName}`);
    }
  }
  return files;
}

module.exports = { assemblePublicAiPackage, publicAiClientPaths };
