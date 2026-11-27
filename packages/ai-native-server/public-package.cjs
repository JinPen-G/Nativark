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
const publicSourceEntries = 'public-source-entries.json';

function readPublicAiServerProject(sources) {
  const manifest = bytes(sources.get('package.public.json'), 'package.public.json');
  const metadata = JSON.parse(manifest.toString('utf8'));
  const config = JSON.parse(bytes(sources.get('tsconfig.public.json'), 'tsconfig.public.json').toString('utf8'));
  if (!sources.has(publicSourceEntries)) return { metadata, config, manifest };
  const additions = JSON.parse(bytes(sources.get(publicSourceEntries), publicSourceEntries).toString('utf8'));
  if (!additions || Object.keys(additions).length !== 2 || additions.format !== 'zelo-public-ai-source-entries-1'
    || !Array.isArray(additions.entries) || !additions.entries.length || additions.entries.length > 32
    || new Set(additions.entries).size !== additions.entries.length || additions.entries.some(name => typeof name !== 'string'
      || !/^(?:runtime\/)?[a-z][a-z0-9-]*$/u.test(name)) || !Array.isArray(config.files))
    throw Error('公共 AI 后继入口清单无效');
  const versions = metadata.typesVersions?.['*'];
  for (const name of additions.entries) {
    const path = `src/${name}.ts`;
    if (Object.hasOwn(metadata.exports ?? {}, `./${name}`) || !versions || Object.hasOwn(versions, name)
      || config.files.includes(path) || !sources.has(path)) throw Error(`公共 AI 后继入口冲突或不存在：${name}`);
    metadata.exports[`./${name}`] = { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` };
    versions[name] = [`dist/${name}.d.ts`];
    config.files.push(path);
  }
  return { metadata, config, manifest: Buffer.from(JSON.stringify(metadata, null, 2) + '\n') };
}

/** Source-only projection for the independently built public service. The
 * archived mixed checkout is a compatibility input, never a source fallback. */
function projectPublicAiServerSources(sources, ts) {
  if (typeof ts?.createSourceFile !== 'function') throw Error('公共 AI 源码选择需要实际 TypeScript 构建器');
  const { metadata, config, manifest } = readPublicAiServerProject(sources);
  const declared = new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.peerDependencies ?? {})]);
  if (metadata.name !== '@rental-os/ai-native-server' || metadata.license !== 'MIT' || !metadata.private
    || metadata.scripts || metadata.bin || metadata.optionalDependencies || metadata.bundledDependencies
    || [...declared].some(name => name.startsWith('@rental-os/') && !publicDependencies.has(name)))
    throw Error('公共 AI 源码包存在非公共声明');

  const configPath = 'tsconfig.public.json';
  const roots = Object.entries(metadata.exports ?? {}).map(([name, entry]) => {
    if (!/^\.\/[a-z][a-z0-9/-]*$/u.test(name) || typeof entry?.types !== 'string'
      || !/^\.\/dist\/[a-zA-Z0-9/.-]+\.d\.ts$/u.test(entry.types) || !valid(entry.types.slice(2))
      || entry.default !== entry.types.replace(/\.d\.ts$/u, '.js')
      || metadata.typesVersions?.['*']?.[name.slice(2)]?.[0] !== entry.types.slice(2))
      throw Error(`公共 AI 源码出口无效：${name}`);
    return entry.types.replace('./dist/', 'src/').replace(/\.d\.ts$/u, '.ts');
  });
  if (!roots.length || !Array.isArray(config.files) || config.files.length !== roots.length
    || new Set(roots).size !== roots.length || roots.some(file => !config.files.includes(file)))
    throw Error('公共 AI 源码与正式出口不一致');
  const result = new Map([['package.json', manifest], ['package.public.json', manifest],
    ['README.md', bytes(sources.get('README.public.md'), 'README.public.md')],
    ['README.public.md', bytes(sources.get('README.public.md'), 'README.public.md')], ['LICENSE', bytes(sources.get('LICENSE'), 'LICENSE')]]);

  // No paths inherited from the mixed package. Keep the build settings used by
  // the published server and leave the actual Client mapping to the host.
  const project = { extends: '../../tsconfig.base.json', compilerOptions: { rootDir: 'src', outDir: 'dist-public',
    declaration: true, types: ['node'], experimentalDecorators: true, emitDecoratorMetadata: true,
    strictPropertyInitialization: false, newLine: 'lf', noEmitOnError: true }, files: [...roots] };
  const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  result.set(configPath, json(project));
  result.set('tsconfig.json', json({ extends: './tsconfig.public.json', compilerOptions: { outDir: 'dist' } }));

  const pending = [...roots];
  for (let i = 0; i < pending.length; i++) {
    const file = pending[i];
    if (result.has(file)) continue;
    const content = bytes(sources.get(file), file), text = content.toString('utf8');
    result.set(file, content);
    const add = name => {
      if (name.startsWith('.')) {
        const candidate = posix.normalize(posix.join(posix.dirname(file), name));
        if (!valid(candidate) || !candidate.startsWith('src/')) throw Error(`公共 AI 源码依赖越界：${file}`);
        const target = [candidate, candidate.replace(/\.js$/u, '.ts'), candidate + '.ts', candidate + '/index.ts']
          .find(item => item.endsWith('.ts') && sources.has(item));
        if (!target) throw Error(`公共 AI 源码缺少正式依赖：${file} -> ${name}`);
        pending.push(target);
      } else if (!isBuiltin(name) && !declared.has(dependencyName(name))) {
        throw Error(`公共 AI 源码引用非公开依赖：${file} -> ${name}`);
      }
    };
    const parse = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (parse.parseDiagnostics.length || parse.referencedFiles.length || parse.typeReferenceDirectives.length)
      throw Error(`公共 AI 源码包含无法固定的引用：${file}`);
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal.text);
      if (ts.isExternalModuleReference(node) || ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const argument = ts.isExternalModuleReference(node) ? node.expression : node.arguments[0];
        if (!argument || !ts.isStringLiteralLike(argument)) throw Error(`公共 AI 源码不能动态选择依赖：${file}`);
        add(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse);
  }
  return result;
}

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
  // The split host passes the projected sources it actually compiled. A caller
  // still building the original public project packages its original exports.
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

module.exports = { assemblePublicAiPackage, publicAiClientPaths, projectPublicAiServerSources };
