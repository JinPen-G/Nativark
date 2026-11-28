'use strict';
/** 独立 Rental 宿主的离线打包入口。双仓发行从固定 Git 源码在内存重建，
 * 旧单仓路径仍消费已编译产物并逐字节复算公共六包。两者均核对固定包及 prepared 部署材料。
 * 正式新装先 prepareRentalReleaseWorkspace 固定最终锁与 vendor，再 packageRentalReleaseWorkspace 同源编译。
 * --development 从双仓固定开发提交准备普通宿主，不要求 Tag，不可进入服务器更新。
 * 输出确定性 Linux Docker 上下文；镜像构建才安装原锁依赖并生成目标平台 Client。
 * 本命令不读 .env、不安装、不生成 Client、不启动进程/服务、不连接库或办理迁移。 */
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire, isBuiltin } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const { selectedCompilerOptions, samePrismaSchema, prismaSchemaTokens } = require('./build-selected-prisma.cjs');
const { compileRentalPlatformSource, requireMatchingPublicRuntime, publicDirectories } = require('./rental-platform-build.cjs');
const { selectWorkspaces, projectHostLock, lockedDependency, hostDirectory,
  retentionSdk, retentionSdkLock, isRetentionSdkDependency, publicDataSdk, publicDataSdkFor, isPublicDataSdkDependency } = require('./rental-host-lock.cjs');
const root = path.resolve(__dirname, '..');
const targetNodeVersion = '24.13.0';
const sourceProvenanceFile = 'development.workspace.json';
const hostBuildFile = 'rental-host.build-provenance.json';
const publicRetentionEntry = 'apps/rental-api/dist-ai-public-retention/ai-public-retention-main.js';
const freshAiLegacyTypeNames = [
  ['provider-capability.ports', 'AiProviderCapabilityEvidenceRecord'], ['model-gateway.ports', 'WorkspaceGatewayContext']
];
const trustedBuilds = new WeakMap();
const collectedReleaseContexts = new WeakSet();
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (files, file) => {
  const bytes = files.get(file);
  if (!bytes?.byteLength) throw Error('打包缺少实际文件：' + file);
  return Buffer.from(bytes).toString('utf8');
};
const within = (directory, file) => { const rel = path.relative(directory, file); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };
const rentalHostDirectory = host => {
  if (!['rental', 'example-multi-core'].includes(host)) throw Error('未登记的 Rental 宿主组合：' + host);
  return hostDirectory(host);
};

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index], value = args[index + 1];
    if (['--fresh-ai', '--public-retention'].includes(option)) {
      if (values[option]) throw Error('重复的显式新装选项：' + option);
      values[option] = true; index -= 1; continue;
    }
    if (!['--ai', '--host', '--deployment', '--platform-package', '--rental-package', '--tickets-package', '--ai-data-package', '--client', '--platform-client', '--output', '--deps', '--mcp-entry', '--source-provenance', '--platform-repo', '--core-repo', '--rental-archive', '--ai-data-sha256', '--mcp-data-package'].includes(option)
      || Object.hasOwn(values, option) || !value || value.startsWith('--')) throw Error('未知、重复或缺值的打包选项：' + option);
    values[option] = value;
  }
  if (!['enabled', 'disabled'].includes(values['--ai'])) throw Error('须显式选择 --ai enabled|disabled');
  const host = values['--host'] ?? 'rental'; rentalHostDirectory(host);
  if (values['--mcp-entry']) {
    if (values['--ai'] !== 'enabled' || !path.isAbsolute(values['--mcp-entry'])) throw Error('--mcp-entry只接受显式AI组合的绝对编译入口');
    requireMcpEntry(path.relative(root, values['--mcp-entry']).split(path.sep).join('/'), host);
  }
  if ((host === 'example-multi-core') !== Boolean(values['--tickets-package']))
    throw Error('只有双 Core 示范须显式提供 --tickets-package');
  for (const key of ['--deployment', '--platform-package', '--rental-package', '--output'])
    if (!values[key] || !path.isAbsolute(values[key])) throw Error(key + ' 须为显式绝对路径');
  if ((values['--ai'] === 'enabled') !== Boolean(values['--ai-data-package'])) throw Error('只有 AI enabled 必须提供 --ai-data-package');
  for (const key of ['--ai-data-package', '--tickets-package', '--rental-archive', '--mcp-data-package', '--deps', '--source-provenance', '--platform-repo', '--core-repo', '--client', '--platform-client'])
    if (values[key] && !path.isAbsolute(values[key])) throw Error(key + ' 须为绝对路径');
  const fixed = ['--source-provenance', '--platform-repo', '--core-repo'].some(key => values[key]);
  if (fixed && (!values['--source-provenance'] || !values['--platform-repo'] || !values['--core-repo']))
    throw Error('双仓打包须同时提供 --source-provenance、--platform-repo 和 --core-repo');
  if (fixed ? values['--client'] || values['--platform-client'] : !values['--client'] || !values['--platform-client'])
    throw Error('双仓从锁定 schema 生成编译声明；旧单仓须显式提供 --client 和 --platform-client 绝对路径');
  if (values['--fresh-ai']) {
    if (!fixed || values['--ai'] !== 'enabled' || !values['--rental-archive']
      || !/^[a-f0-9]{64}$/u.test(values['--ai-data-sha256'] ?? '')
      || Boolean(values['--mcp-entry']) !== Boolean(values['--mcp-data-package']))
      throw Error('正式新装须双仓来源、原 Rental 归档、AI 数据摘要及一致的 MCP 材料');
  } else if (values['--public-retention'] || values['--rental-archive'] || values['--ai-data-sha256'] || values['--mcp-data-package'])
    throw Error('新装选项不能进入原 v1 发行入口');
  if (values['--public-retention'] && values['--mcp-entry']) throw Error('公共保留与 MCP 尚无同一正式宿主及双能力 Web');
  if (!values['--output'].endsWith('.tgz')) throw Error('--output 须为尚不存在的 .tgz 文件');
  if (!values['--platform-package'].endsWith('.tgz')) throw Error('--platform-package 须为锁定的完整底座源码 .tgz');
  return { aiMode: values['--ai'], host, freshAi: Boolean(values['--fresh-ai']), publicRetention: Boolean(values['--public-retention']),
    rentalArchive: values['--rental-archive'], aiDataSha256: values['--ai-data-sha256'], mcpDataPackage: values['--mcp-data-package'], ...(values['--mcp-entry'] ? { mcpEntry: values['--mcp-entry'] } : {}),
    ticketsPackage: values['--tickets-package'], deployment: values['--deployment'], rentalPackage: values['--rental-package'],
    platformPackage: values['--platform-package'],
    aiDataPackage: values['--ai-data-package'], sourceProvenance: values['--source-provenance'], client: values['--client'], platformClient: values['--platform-client'],
    platformRepo: values['--platform-repo'], coreRepo: values['--core-repo'],
    output: values['--output'], deps: values['--deps'] || path.join(root, 'node_modules') };
}

function ordinaryDirectories(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('打包路径不能经过链接或非普通目录');
    if (path.dirname(current) === current) break;
  }
}
function readOrdinary(file, maxBytes = 32 * 1024 * 1024) {
  ordinaryDirectories(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw Error('打包输入须为有界普通文件');
  const bytes = fs.readFileSync(file);
  if (bytes.length > maxBytes) throw Error('输入在读取期间超过大小上限');
  return bytes;
}
function readTree(directory, allowed) {
  ordinaryDirectories(directory);
  const files = new Map(); let bytes = 0;
  const visit = (current, prefix = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const relative = prefix + entry.name, file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw Error('打包目录中存在链接：' + relative);
      if (entry.isDirectory()) visit(file, relative + '/');
      else {
        if (!allowed(relative)) throw Error('打包目录中存在未声明材料：' + relative);
        const content = readOrdinary(file); bytes += content.length;
        if (files.size >= 20000 || bytes > 128 * 1024 * 1024) throw Error('打包目录超过资源上限');
        files.set(relative, content);
      }
    }
  };
  visit(directory); return files;
}

function publicApi(read = require) {
  return {
    ...read('@rental-os/core-contracts'),
    ...read('@rental-os/core-contracts/archive'),
    ...read('@rental-os/core-contracts/deployment'),
    ...read('@rental-os/core-contracts/package'),
    ...read('@rental-os/core-contracts/platform-data-package'),
    ...read('@rental-os/core-contracts/platform-source'),
    ...read('@rental-os/platform-core-host/core-package-preflight'),
    ...read('@rental-os/platform-api/data-plan'),
    ...read(path.join(root, 'apps/rental-api/dist/prepare-deployment.js')),
  };
}

function requireMcpEntry(entry, host) {
  const prefix = rentalHostDirectory(host) + '/dist-mcp/';
  if (typeof entry !== 'string' || !entry.startsWith(prefix) || !/^[a-z0-9][a-z0-9-]*\.js$/u.test(entry.slice(prefix.length)))
    throw Error('MCP入口须为当前所选宿主dist-mcp中的第一方编译叶文件');
  return entry;
}

/** 只接受源入口真正调用原bootstrap；单独导出函数不会在Node启动时执行。 */
function requireMcpStartup(files, entry, ts, fresh = false) {
  const tree = ts.createSourceFile(entry, text(files, entry), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = new Set(), spaces = new Set();
  const bootstraps = new Set(fresh ? ['bootstrapFreshRentalMcp'] : ['bootstrapRentalAiMcp', 'bootstrapRentalOriginalAiMcp']);
  const isBootstrap = value => value === '@rental-os/rental-api/mcp-bootstrap' || /^\.\/mcp-bootstrap(?:\.js)?$/u.test(value);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && isBootstrap(statement.moduleSpecifier.text)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) spaces.add(bindings.name.text);
      else if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements)
        if (bootstraps.has((item.propertyName ?? item.name).text)) names.add(item.name.text);
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const value = declaration.initializer;
      if (!value || !ts.isCallExpression(value) || !ts.isIdentifier(value.expression) || value.expression.text !== 'require'
        || value.arguments.length !== 1 || !ts.isStringLiteralLike(value.arguments[0]) || !isBootstrap(value.arguments[0].text)) continue;
      if (ts.isIdentifier(declaration.name)) spaces.add(declaration.name.text);
      else if (ts.isObjectBindingPattern(declaration.name)) for (const item of declaration.name.elements)
        if (ts.isIdentifier(item.name) && bootstraps.has((item.propertyName ?? item.name).text)) names.add(item.name.text);
    }
  }
  const unwrap = expression => ts.isParenthesizedExpression(expression) ? unwrap(expression.expression)
    : ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken ? unwrap(expression.right) : expression;
  let called = false;
  function inspect(node) {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isCallExpression(node)) {
      const value = unwrap(node.expression);
      if (ts.isIdentifier(value) && names.has(value.text) || ts.isPropertyAccessExpression(value)
        && ts.isIdentifier(value.expression) && spaces.has(value.expression.text) && bootstraps.has(value.name.text)) called = true;
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  if (!called) throw Error('MCP编译入口没有在顶层实际调用同一MCP bootstrap');
}

function workspaceExport(metadata, specifier, mode = 'require') {
  const name = metadata.name, key = specifier === name ? '.' : '.' + specifier.slice(name.length);
  let entry = metadata.exports?.[key], replacement;
  if (entry === undefined) {
    const patterns = Object.keys(metadata.exports || {}).filter(value => value.split('*').length === 2)
      .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
    for (const pattern of patterns) {
      const [prefix, suffix] = pattern.split('*');
      if (key.startsWith(prefix) && key.endsWith(suffix) && key.length > prefix.length + suffix.length) {
        entry = metadata.exports[pattern]; replacement = key.slice(prefix.length, suffix.length ? -suffix.length : undefined); break;
      }
    }
  }
  const pick = value => typeof value === 'string' ? value : value && pick(value.node ?? value[mode] ?? value.default);
  let target = pick(entry);
  if (!metadata.exports && key === '.') target = metadata.main;
  if (replacement !== undefined) target = target?.replace('*', replacement);
  if (!target || /[\\%:*]/u.test(target) || target.split('/').some(part => part === '..' || part === 'node_modules'))
    throw Error('运行依赖缺少正式 CommonJS 出口：' + specifier);
  return target.replace(/^\.\//u, '');
}

/** A runtime image does not compile clients against the AI server SDK. Strip
 * declaration-only conditions from its runtime manifest with those declarations.
 * Keep the fixed Core/data packages and public platform build byte-for-byte. */
function runtimeOnlyMetadata(metadata) {
  const result = { ...metadata };
  delete result.types; delete result.typings; delete result.typesVersions;
  const conditions = value => typeof value === 'string' || value === null ? value : Array.isArray(value)
    ? value.map(conditions) : Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'types')
      .map(([name, entry]) => [name, conditions(entry)]));
  if (result.exports) result.exports = conditions(result.exports);
  return result;
}

/** 只沿真实启动模块的静态 require/import 检查闭包；不 require 应用、运行 Client 或猜动态入口。
 * 最终 Node exports/外部包的实际解析留给生成的镜像预检，在镜像内安装完成后执行。 */
function runtimeOwner(file, workspaces, publicRetention, publicAiDataSdk) {
  if (publicAiDataSdk && file.startsWith(publicDataSdk.install + '/')) return publicDataSdk.install;
  return publicRetention && file.startsWith(retentionSdk.install + '/') ? retentionSdk.install
    : [...workspaces.keys()].find(directory => file.startsWith(directory + '/'));
}

function checkRuntimeClosure(inputFiles, workspaces, lock, entry, ts, options = {}) {
  const packages = new Map([...workspaces].map(([directory, metadata]) => [metadata.name, { directory, metadata }]));
  const sdk = options.publicRetention;
  const dataSdk = options.publicAiDataSdk;
  const files = new Map(inputFiles);
  for (const [definition, selected] of [[retentionSdk, sdk], [publicDataSdk, dataSdk]])
    if (selected) for (const [file, bytes] of selected.files) files.set(definition.install + '/' + file, bytes);
  const queue = [entry], seen = new Set(), resolutions = [], clients = new Set(), runtimePeers = new Map();
  const locate = target => [target, target + '.js', target + '.json', target + '/index.js'].find(file => files.has(file));
  while (queue.length) {
    const file = queue.shift(); if (seen.has(file)) continue;
    const source = text(files, file); seen.add(file);
    if (file.endsWith('.json')) { JSON.parse(source); continue; }
    const owner = runtimeOwner(file, workspaces, sdk, dataSdk);
    if (!owner) throw Error('运行代码越出所选工作区：' + file);
    const metadata = owner === retentionSdk.install ? sdk.metadata
      : owner === publicDataSdk.install ? dataSdk.metadata : workspaces.get(owner);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (tree.parseDiagnostics.length) throw Error('运行产物语法无效：' + file);
    const imports = new Map();
    const add = (specifier, mode) => {
      if (!imports.has(specifier)) imports.set(specifier, new Set());
      imports.get(specifier).add(options.moduleImports && mode === 'import' ? 'import' : 'require');
    };
    function inspect(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        add(node.moduleSpecifier.text, 'import');
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require'
        || ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'require' && node.expression.name.text === 'resolve')) {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0]))
          throw Error('运行产物含未核定的动态模块路径：' + file);
        add(node.arguments[0].text, node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : 'require');
      }
      ts.forEachChild(node, inspect);
    }
    inspect(tree);
    for (const [specifier, modes] of imports) for (const mode of modes) {
      if (isBuiltin(specifier)) continue;
      if (specifier === '@prisma/client' || specifier.includes('.prisma/client')) throw Error('运行代码仍引用默认 Client：' + file);
      const resolution = { from: file, specifier, ...(mode === 'import' ? { mode } : {}) };
      resolutions.push(resolution);
      if (specifier.startsWith('.')) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (['apps/platform-api/generated/client', 'apps/rental-api/generated/client'].includes(target)) {
          clients.add(target); continue;
        }
        if (!target.startsWith(owner + '/')) throw Error('运行代码跨工作区深层导入：' + file);
        const resolved = mode === 'import' ? files.has(target) && target : locate(target);
        if (!resolved) throw Error('运行产物缺少内部依赖：' + file + ' -> ' + specifier);
        queue.push(resolved); continue;
      }
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      const declared = { ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies };
      if (name !== metadata.name && !Object.hasOwn(declared, name)) throw Error('运行代码使用未声明的依赖：' + file + ' -> ' + name);
      if (name.startsWith('@rental-os/')) {
        const usePublic = sdk && name === retentionSdk.name && (owner === retentionSdk.install
          || isRetentionSdkDependency(lock, owner, name, declared[name], sdk));
        const useData = dataSdk && isPublicDataSdkDependency(lock, owner, name, declared[name], dataSdk);
        const pkg = useData ? { directory: publicDataSdk.install, metadata: dataSdk.metadata }
          : usePublic ? { directory: retentionSdk.install, metadata: sdk.metadata } : packages.get(name);
        if (!pkg) throw Error('运行代码引用未选工作区：' + name);
        const target = pkg.directory + '/' + workspaceExport(pkg.metadata, specifier, mode);
        if (!files.has(target)) throw Error('正式运行出口未实际构建：' + specifier + ' -> ' + target);
        if (useData || sdk && name === retentionSdk.name) resolution.expected = target;
        queue.push(target);
      } else {
        const dependency = lockedDependency(lock, owner, name), locked = lock.packages[dependency];
        if (!locked) throw Error('运行依赖不在原锁闭包：' + name);
        if (!metadata.dependencies?.[name] && metadata.peerDependenciesMeta?.[name]?.optional)
          runtimePeers.set(owner + ':' + name, { owner, name });
      }
    }
  }
  if (options.expectedClients === undefined) {
    if (!clients.has('apps/rental-api/generated/client')) throw Error('宿主没有引用所选专属 Client');
  } else {
    const expected = options.expectedClients;
    if (!Array.isArray(expected) || !expected.length || new Set(expected).size !== expected.length
      || expected.some(directory => !['apps/platform-api/generated/client', 'apps/rental-api/generated/client'].includes(directory))
      || clients.size !== expected.length || expected.some(directory => !clients.has(directory)))
      throw Error('实际运行 Client 集合与所选宿主不一致');
  }
  return { files: seen.size, resolutions, clients: [...clients].sort(), runtimePeers: [...runtimePeers.values()] };
}

function dockerfile(mode, entry, freshAi = false, freshMcp = false) {
  return `# 从本打包上下文构建；不复制作者 node_modules、Windows 引擎或环境文件。\n` +
    `FROM node:${targetNodeVersion}-bookworm-slim AS base\n` +
    `RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*\n` +
    `WORKDIR /app\nFROM base AS clients\nCOPY . .\n` +
    `RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund\n` +
    `RUN DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline node node_modules/prisma/build/index.js generate --schema apps/platform-api/prisma/schema.prisma && \\\n` +
    `    DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline node node_modules/prisma/build/index.js generate --schema apps/rental-api/prisma-deployment/schema.prisma\n` +
    `FROM base AS runtime\nENV NODE_ENV=production RENTAL_AI_MODE=${mode} RENTAL_DEPLOYMENT_LOCK=/app/apps/rental-api/prisma-deployment/core.deployment.lock.json\n` +
    (freshAi ? `ENV RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR=/app/public-ai-data\n` : '') +
    (freshMcp ? `ENV RENTAL_MCP_DATA_PACKAGE_DIR=/app/packages/mcp-server\n` : '') +
    `COPY . .\nRUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund\n` +
    `COPY --from=clients /app/apps/platform-api/generated/client ./apps/platform-api/generated/client\n` +
    `COPY --from=clients /app/apps/rental-api/generated/client ./apps/rental-api/generated/client\n` +
    `RUN node verify-runtime.cjs\nUSER node\nEXPOSE 3000\nCMD ["node", "${entry}"]\n`;
}

function createRuntimeVerifier(receiptFile = 'rental-host.context.json', moduleImports = false, publicRetention = false, publicAiData = false) {
  if (!/^[a-z][a-z0-9-]*\.context\.json$/u.test(receiptFile)) throw Error('运行收据须为宿主根内的固定 JSON 文件名');
  return `'use strict';
// 镜像构建中的字节与解析预检；不导入应用、不实例化Client、不连接或迁移数据库。
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto'), { createRequire${moduleImports ? ', registerHooks' : ''} } = require('node:module');
const root = __dirname, receipt = JSON.parse(fs.readFileSync(path.join(root, '${receiptFile}'), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const schemaTokens = ${prismaSchemaTokens.toString()};
for (const item of receipt.files) if (digest(fs.readFileSync(path.join(root, item.file))) !== item.sha256)
  throw Error('镜像输入摘要变化：' + item.file);
for (const item of receipt.clients) {
  const schemaFile = item.directory === 'apps/platform-api/generated/client'
    ? (item.mode === 'platform-capabilities' ? 'apps/platform-api/prisma-deployment/schema.prisma' : 'apps/platform-api/prisma/schema.prisma')
    : item.directory === 'apps/rental-api/generated/client' ? 'apps/rental-api/prisma-deployment/schema.prisma' : undefined;
  if (!schemaFile) throw Error('镜像 Client 目录未登记');
  const source = fs.readFileSync(path.join(root, schemaFile), 'utf8');
  if (digest(Buffer.from(source)) !== item.schemaSha256
    || schemaTokens(fs.readFileSync(path.join(root, item.directory, 'schema.prisma'), 'utf8')) !== schemaTokens(source))
    throw Error('镜像生成 Client 与核定 schema 不一致');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, item.directory, 'package.json'), 'utf8'));
  if (metadata.version !== receipt.prismaVersion) throw Error('镜像 Client 版本不一致');
}
if (fs.existsSync(path.join(root, 'node_modules/.prisma/client'))) throw Error('镜像不接受默认 Client');
${publicAiData ? `for (const item of receipt.publicAiDataSdk.installedFiles)
  if (digest(fs.readFileSync(path.join(root, receipt.publicAiDataSdk.install, item.file))) !== item.sha256)
    throw Error('公共数据 SDK 安装字节变化：' + item.file);
` : ''}${publicRetention ? `// npm 按原锁安装后复核所选 SDK 的实际字节和两个版本的调用方解析。
const sdk = receipt.publicRetention;
for (const item of sdk.installedFiles) if (digest(fs.readFileSync(path.join(root, sdk.install, item.file))) !== item.sha256)
  throw Error('公共保留 SDK 安装字节变化：' + item.file);
const oldSdk = JSON.parse(fs.readFileSync(path.join(root, '${retentionSdk.legacyDirectory}/package.json'), 'utf8'));
if (oldSdk.name !== sdk.name || oldSdk.version !== sdk.legacyVersion) throw Error('原混合 SDK 版本变化');
` : ''}${moduleImports ? `// Node原解析钩子只核import条件；在load前抛出已解析URL，不执行目标模块。
function resolveImported(from, specifier) {
  const captured = {}, probe = 'nativark-runtime-import-probe';
  const hook = registerHooks({ resolve(name, context, next) {
    if (name !== probe) return next(name, context);
    captured.url = next(specifier, { ...context, conditions: ['node', 'import'] }).url;
    throw captured;
  } });
  try { createRequire(from)(probe); throw Error('MCP解析未在模块加载前停止'); }
  catch (error) {
    if (error !== captured || !captured.url?.startsWith('file:')
      || !fs.existsSync(require('node:url').fileURLToPath(captured.url))) throw error;
  } finally { hook.deregister(); }
}
for (const item of receipt.runtime.resolutions) {
  const from = path.join(root, item.from);
  if (item.mode === 'import') resolveImported(from, item.specifier);
  else { const actual = createRequire(from).resolve(item.specifier);
    if (item.expected && actual !== path.join(root, item.expected)) throw Error('局部 SDK 解析路径变化'); }
}` : publicRetention || publicAiData ? `for (const item of receipt.runtime.resolutions) {
  const actual = createRequire(path.join(root, item.from)).resolve(item.specifier);
  if (item.expected && actual !== path.join(root, item.expected))
    throw Error('公共保留选择的 Node 路径变化：' + item.from + ' -> ' + item.specifier);
}` : `for (const item of receipt.runtime.resolutions) createRequire(path.join(root, item.from)).resolve(item.specifier);`}
console.log(JSON.stringify({ status: 'image-preflight-passed', aiMode: receipt.aiMode, applicationStarted: false, deployment: 'pending' }));
`;
}

/** 仅整理公共包与宿主 README 副本的资料链接；不改完整 Core/AI 包或扩大运行文件集合。
 * 两宿主原 rootDir=src，普通/AI outDir=dist/dist-ai；只有实际入包输出才能替代源码链接。 */
function runtimePackageReadme(source, file, files, aiMode, platformFiles, platformSource, pinLinks) {
  const missing = new Set(), directory = path.posix.dirname(file);
  let fence, compiled = 0, pinned = 0;
  // 沿公开指南的链接语法保留围栏、行内代码、外链和本页锚点。
  const readme = source.split('\n').map(line => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    return line.replace(/(`+).*?\1|\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s)]+))\)/gu, (link, code, label, angled, plain) => {
      if (code) return link;
      const target = angled ?? plain;
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu.test(target)) return link;
      const [name, fragment] = target.split('#'), resolved = path.posix.normalize(path.posix.join(directory, name));
      if (files.has(resolved) || [...files.keys()].some(file => file.startsWith(resolved + '/'))) return link;
      const hostSource = /^(apps\/(?:rental-api|example-multi-core-api))\/src\/(.+)\.ts$/u.exec(resolved);
      if (hostSource && !resolved.endsWith('.d.ts') && !fragment) {
        const outputs = aiMode === 'enabled' ? ['dist-ai', 'dist'] : ['dist'];
        const module = outputs.flatMap(output => ['.js', '.d.ts'].map(extension =>
          hostSource[1] + '/' + output + '/' + hostSource[2] + extension)).find(file => files.has(file));
        if (module) { compiled++; return `[${label}](${path.posix.relative(directory, module)})`; }
      }
      // 固定归档内的源码与公共包嵌套 README 才可外指；生成根 README/platform.source.json 不在此集合。
      const nestedReadme = resolved.endsWith('/README.md') && publicDirectories.some(directory =>
        resolved.startsWith(directory + '/') && resolved !== directory + '/README.md');
      if (!hostSource && (/\.(?:[cm]?js|tsx?)$/u.test(resolved) || nestedReadme) && platformFiles.has(resolved)) {
        pinned++; return pinLinks(link, file, platformSource, true);
      }
      missing.add(target); return label;
    });
  }).join('\n');
  if (!compiled && !pinned && !missing.size) return readme;
  return readme.trimEnd() + '\n\n## 运行包内的资料定位\n\n' +
    '本 README 的包内链接定位实际入包文件；替换后的宿主源码链接定位编译模块（JS 或声明），不代表原 TypeScript 源码。源码包另取原发行；底座源码外链仅使用已核固定归档内的文件及该发行来源，不为宿主源码猜提交。\n' +
    (missing.size ? '\n以下原相对路径未入包且没有已核对应输出或固定源码链接，保留为接手缺口；须从原发行另取并核对来源：\n\n' +
      [...missing].map(target => '- `' + target.replace(/`/gu, '\\`') + '`').join('\n') + '\n' : '');
}

/** 消费已用正式组合器逐字节核过的材料，复用其数据库迁移名称与次序。 */
function describeRentalDeployment(api, lock, deploymentFiles, platform, postCapability = []) {
  const describe = file => {
    const bytes = deploymentFiles.get(file);
    if (!bytes) throw Error('部署记录缺少实际材料：' + file);
    return { path: file, bytes: bytes.byteLength, sha256: hash(bytes) };
  };
  const byDirectory = new Map();
  const add = (owner, source, assetSha256, migration, directory) => {
    const file = describe(`migrations/${directory}/migration.sql`);
    if (byDirectory.has(directory) || file.sha256 !== migration.sha256)
      throw Error('部署迁移归属或原 SQL 不一致：' + directory);
    byDirectory.set(directory, { owner, source, assetSha256, id: migration.id,
      originalPath: migration.file, originalDirectory: path.posix.dirname(migration.file),
      directory, ledger: { table: '_prisma_migrations', migrationName: directory, checksum: file.sha256 }, file });
  };
  lock.platform.data.migrations.forEach((migration, index) =>
    add('platform', lock.platform.source, lock.platform.sha256, migration, platform.migrationNames[index]));
  for (const { manifest, sha256 } of lock.cores) for (const migration of manifest.data.migrations)
    add(manifest.id, manifest.source, sha256, migration, api.corePrismaMigrationName(manifest.id, migration.id));
  for (const capability of lock.dataCapabilities ?? []) for (const migration of capability.data.migrations)
    add(capability.id, capability.source, capability.sha256, migration,
      api.platformCapabilityPrismaMigrationName(capability.id, migration.id));
  for (const { coreId, migration } of postCapability) add(coreId, migration.source, migration.sha256, migration,
    api.corePostCapabilityPrismaMigrationName(coreId, migration.id));
  const migrations = [...byDirectory.keys()].sort().map((directory, order) => ({ order, ...byDirectory.get(directory) }));
  return { format: 'rental-host-deployment-provenance-1', state: 'prepared', deployment: 'pending',
    ...(postCapability.length ? { installation: 'fresh-ai', postCapability } : {}),
    lock: describe('core.deployment.lock.json'), schema: describe('schema.prisma'),
    migrationLock: describe('migrations/migration_lock.toml'),
    data: { platform: lock.platform, cores: lock.cores, capabilities: lock.dataCapabilities ?? [] },
    migrations, files: [...deploymentFiles.keys()].sort().map(describe) };
}

/** 双仓运行归档须和已准备的版本、选择及 npm 源锁投影在同一次组合中。 */
function requireSourceProvenance(bytes, npmLock, lock, host, aiMode, mcpEntry, mode, freshAi = false, publicRetention, publicAiDataSdk) {
  const source = JSON.parse(Buffer.from(bytes).toString('utf8'));
  const rental = lock.cores.find(pin => pin.manifest.id === 'rental')?.manifest;
  if (source.format !== 'nativark-core-development-source-2' || source.mode !== mode
    || source.host !== host || !['host', 'full'].includes(source.profile)
    || source.ai !== (aiMode === 'enabled') || source.mcp !== Boolean(mcpEntry)
    || source.installation !== (freshAi ? 'fresh-ai' : undefined)
    || !isDeepStrictEqual(source.publicRetention, publicRetention?.receipt)
    || !isDeepStrictEqual(source.publicAiDataSdk, publicAiDataSdk?.receipt)
    || !rental || !isDeepStrictEqual(source.core?.source, rental.source)
    || source.core.version !== rental.version || source.core.tag !== (mode === 'release' ? 'v' + rental.version : undefined)
    || !isDeepStrictEqual(source.platform?.source, lock.platform.source)
    || source.platform.version !== lock.platform.versions.platform
    || source.npmLocks?.projected?.sha256 !== hash(npmLock))
    throw Error('双仓发行源码、宿主选择或原 npm 投影锁与准备材料不一致');
  // New-install MCP keeps its complete v2 ledger; this does not authorize an existing database update.
  if (mcpEntry && (!freshAi || !lock.dataCapabilities?.some(item => item.id === 'mcp')))
    throw Error('双仓 MCP 仅接受具备锁定原账的新装组合');
  return source;
}

function requireHostSourceProvenance(bytes, npmLock, lock, host, aiMode, mcpEntry) {
  return requireSourceProvenance(bytes, npmLock, lock, host, aiMode, mcpEntry, 'release');
}

/** 收据由同一进程的固定源编译产生；调用方提供的产物摘要不能代替实际 emit。 */
function requireFixedRuntime(sourceFiles, sourceBytes) {
  const build = trustedBuilds.get(sourceFiles);
  if (!build || !sourceBytes || build.sourceSha256 !== hash(sourceBytes)
    || build.npmLockSha256 !== hash(sourceFiles.get('package-lock.json')))
    throw Error('双仓打包缺少同一固定源码和投影锁的实际构建');
  const sources = JSON.parse(Buffer.from(sourceBytes)).files;
  if (sourceFiles.size !== 1 + sources.length + build.evidence.files.length)
    throw Error('双仓运行产物或源码文件集合与实际构建不同');
  for (const { path: file, sha256 } of sources)
    if (!sourceFiles.has(file) || hash(sourceFiles.get(file)) !== sha256)
      throw Error('双仓源码输入与实际构建不同：' + file);
  for (const { file, sha256 } of build.evidence.files)
    if (!sourceFiles.has(file) || hash(sourceFiles.get(file)) !== sha256)
      throw Error('双仓运行产物与固定源码编译不同：' + file);
  return build;
}

function compileFixedRuntime({ workspace, sourceBytes, deploymentFiles, deps, aiMode, release, platformApi }) {
  const { createBuild, verifyContracts } = require('./check-rental-package-build.cjs');
  const { snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const { generatePrismaDeclarations } = require('./verify-rental-distribution.cjs');
  const snapshot = snapshotFromFiles(workspace.platform.source.commit, new Map([...workspace.files]
    .map(([file, bytes]) => [path.resolve(root, file).split(path.sep).join('/'), bytes])));
  const build = createBuild(deps, { snapshot, quiet: true });
  const dependencies = JSON.parse(text(workspace.files, 'package-lock.json')).packages;
  if (dependencies['node_modules/typescript']?.version !== build.ts.version
    || ['prisma', '@prisma/client'].some(name => dependencies['node_modules/' + name]?.version !== '5.22.0'))
    throw Error('双仓编译器或 Prisma 声明生成器与投影锁不同');
  const schemas = { platform: text(workspace.platform.files, 'apps/platform-api/prisma/schema.prisma'),
    rental: text(deploymentFiles, 'schema.prisma') };
  generatePrismaDeclarations(build, [['public', schemas.platform], ['rental', schemas.rental]]);
  const selection = (host, mode) => {
    const client = path.join(root, `apps/${host}-api/generated/client/index.d.ts`);
    return Object.freeze({ client, mode, schema: schemas[host], declarations: build.virtual.get(client.split(path.sep).join('/')) });
  };
  const selections = Object.freeze({ platform: selection('platform', 'platform'),
    rental: selection('rental', aiMode === 'enabled' ? 'rental-ai' : 'rental') });
  for (const directory of ['apps/platform-api', 'apps/rental-api', 'packages/rental-core', 'packages/ai-native-server'])
    build.selectedClients.set(path.resolve(root, directory).split(path.sep).join('/'), directory === 'apps/platform-api' ? selections.platform : selections.rental);
  verifyContracts(build);
  const platformBuild = compileRentalPlatformSource({ platformFiles: workspace.platform.files, release,
    selection: selections.platform, dependencyDirectory: deps, ts: build.ts, api: platformApi });
  for (const [file, bytes] of platformBuild.generated) if (!file.endsWith('/package.json'))
    build.outputs.set(path.resolve(root, file).split(path.sep).join('/'), bytes.toString('utf8'));
  build.compile('packages/rental-core/tsconfig.json');
  if (workspace.files.has('packages/ai-native-data/package.json')) build.compile('packages/ai-native-data/tsconfig.json');
  build.compile('apps/rental-api/tsconfig.json');
  if (aiMode === 'enabled') {
    build.compile('packages/ai-native-server/tsconfig.json');
    build.compile('apps/rental-api/tsconfig.ai.json');
  }
  return bindFixedRuntime(build, workspace, sourceBytes, deploymentFiles, selections, platformBuild, 'release');
}

function bindFixedRuntime(build, workspace, sourceBytes, deploymentFiles, selections, platformBuild, mode) {
  const { createMemoryBuild } = require('./rental-build-memory.cjs');
  const sourceFiles = new Map(workspace.files);
  const outputs = [...build.outputs].map(([file, content]) => [path.relative(root, file).split(path.sep).join('/'), Buffer.from(content)])
    .filter(([file]) => /^(?:apps|packages)\/[^/]+\/dist(?:-[^/]+)?\/.*\.(?:js|cjs|json|d\.ts)$/u.test(file))
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  for (const [file, bytes] of outputs) sourceFiles.set(file, bytes);
  const memory = createMemoryBuild(build);
  const api = publicApi(name => memory.load(path.isAbsolute(name) ? name : build.exported(name, true)));
  const sourceSha256 = hash(sourceBytes), npmLockSha256 = hash(sourceFiles.get('package-lock.json'));
  const evidence = { format: 'rental-host-fixed-build-1', sourceSha256, npmLockSha256,
    platform: workspace.platform.source, rental: workspace.rental.source,
    deploymentLockSha256: hash(deploymentFiles.get('core.deployment.lock.json')),
    compiler: { version: build.ts.version, sha256: hash(readOrdinary(build.requireDeps.resolve('typescript'))) },
    clients: Object.entries(selections).map(([host, selected]) => ({ host, mode: selected.mode,
      schemaSha256: hash(selected.schema), declarationsSha256: hash(selected.declarations) })),
    projects: build.stages, files: outputs.map(([file, bytes]) => ({ file, sha256: hash(bytes) })) };
  trustedBuilds.set(sourceFiles, { api, sourceSha256, npmLockSha256, evidence, selections, ts: build.ts, platformBuild, mode });
  return { sourceFiles, selections, ts: build.ts };
}

function publicizeFreshAiDeclarations(build) {
  // The fixed legacy AI compiler infers two exported public types via their
  // private paths. Rebind only those emitted type references to the public
  // barrel; do not add deep exports or change the original runtime.
  const entry = build.exported('@rental-os/platform-server/ai-gateway');
  const barrel = build.outputs.get(entry);
  for (const [file, type] of freshAiLegacyTypeNames) {
    const owner = build.outputs.get(path.posix.join(path.posix.dirname(entry), `${file}.d.ts`));
    if (!barrel?.includes(`export * from './${file}'`) || !owner || !new RegExp(`\\bexport (?:interface|type) ${type}\\b`, 'u').test(owner))
      throw Error('旧 AI 声明目标缺少公共同一类型出口：' + type);
  }
  for (const [file, text] of build.outputs) {
    if (!/\/packages\/ai-native-server\/dist\/.*\.d\.ts$/u.test(file)) continue;
    const next = freshAiLegacyTypeNames.reduce((value, [leaf, type]) => value.replaceAll(
      `import("@rental-os/platform-server/dist/ai-gateway/${leaf}").${type}`, `import("@rental-os/platform-server/ai-gateway").${type}`), text);
    if (next !== text) build.outputs.set(file, next);
  }
}

/** Read metadata from the actual ESM emit; the data verifier itself is the only
 * MCP module evaluated at packaging time. The distributed bytes stay ESM. */
function prepareFreshMcpData(build, workspace, absolute) {
  const directory = 'packages/mcp-server';
  const manifest = JSON.parse(text(workspace.files, directory + '/package.json'));
  const originals = new Map(['package.json', 'README.md', 'LICENSE', ...manifest.files.filter(file => file !== 'dist')]
    .map(file => [file, workspace.files.get(directory + '/' + file) ?? (file === 'LICENSE' ? workspace.files.get('LICENSE') : undefined)]));
  for (const [file, content] of build.outputs) if (file.startsWith(absolute(directory + '/dist') + '/'))
    originals.set(file.slice(absolute(directory).length + 1), Buffer.from(content));
  const output = build.exported('@rental-os/mcp-server/data-capability', true);
  const module = { exports: {} };
  const read = name => {
    if (name === 'node:crypto' || name === 'node:util') return require(name);
    if (['@rental-os/core-contracts', '@rental-os/core-contracts/archive', '@rental-os/core-contracts/platform-data-package'].includes(name))
      return build.load(build.exported(name, true));
    throw Error('MCP 数据材料不应加载运行模块：' + name);
  };
  const verified = build.ts.transpileModule(build.outputs.get(output), { compilerOptions: { target: build.ts.ScriptTarget.ES2022,
    module: build.ts.ModuleKind.CommonJS } }).outputText;
  require('node:vm').compileFunction(verified, ['require', 'module', 'exports'], { filename: output })(read, module, module.exports);
  const release = module.exports.createMcpDataRelease({ files: originals, source: workspace.platform.source });
  module.exports.readMcpDataPackage(originals, release);
  return { files: originals, release };
}

/** Fresh public data follows the platform pin. The independent legacy data
 * snapshot supplies old readers only; it cannot issue a new platform release. */
function compilePublicAiData(build, workspace, repo) {
  const { createBuild } = require('./check-rental-package-build.cjs');
  const { readBuildSnapshot, snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const absolute = file => path.resolve(root, file).split(path.sep).join('/');
  const directory = 'packages/ai-native-data';
  const fixed = readBuildSnapshot(workspace.platform.source.commit, repo, [directory]);
  const seed = new Map([...workspace.platform.files].map(([file, bytes]) => [absolute(file), bytes]));
  for (const [file, bytes] of fixed.files) seed.set(file, bytes);
  seed.set(absolute('package-lock.json'), workspace.files.get('package-lock.json'));
  const selected = createBuild(build.deps, { snapshot: snapshotFromFiles(workspace.platform.source.commit, seed), quiet: true });
  for (const [file, bytes] of build.outputs) if (publicDirectories.some(item => file.startsWith(absolute(item) + '/')))
    selected.outputs.set(file, bytes);
  selected.compile(directory + '/tsconfig.public.json');
  const output = name => absolute(directory + '/dist-public/' + name + '.js');
  const data = selected.load(output('public-data'));
  const files = new Map([...data.PUBLIC_AI_DATA_FILES.map(({ file }) => file), 'LICENSE', 'README.public.md']
    .map(file => [file, fixed.files.get(absolute(directory + '/' + file))]));
  for (const name of ['public-data', 'public-data-package', 'public-mysql-data']) for (const suffix of ['js', 'd.ts'])
    files.set(`dist/${name}.${suffix}`, Buffer.from(selected.outputs.get(absolute(`${directory}/dist-public/${name}.${suffix}`))));
  const release = selected.load(output('public-data-package')).createPublicAiDataRelease({ files, source: workspace.platform.source });
  build.stages.push(...selected.stages);
  return { ...release, data };
}

/** The public SDK uses the fixed Zelo source/data pin, never Rental's legacy snapshot. */
function compilePublicRetentionSdk(build, workspace, publicAi, archiveApi, repo) {
  const { createBuild } = require('./check-rental-package-build.cjs');
  const { readBuildSnapshot, snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const { generatePrismaDeclarations } = require('./verify-rental-distribution.cjs');
  const absolute = file => path.resolve(root, file).split(path.sep).join('/');
  const prefix = retentionSdk.legacyDirectory + '/';
  const fixed = readBuildSnapshot(workspace.platform.source.commit, repo, [retentionSdk.legacyDirectory]);
  const sources = new Map([...fixed.files].map(([file, bytes]) => [file.slice(absolute(prefix).length + 1), bytes]));
  const factory = { exports: {} }, sourceFile = absolute(prefix + 'public-package.cjs');
  require('node:vm').compileFunction(text(sources, 'public-package.cjs'), ['module', 'require'], { filename: sourceFile })
    (factory, createRequire(sourceFile));
  const { projectPublicAiServerSources, publicAiClientPaths, assemblePublicAiPackage } = factory.exports;
  const project = projectPublicAiServerSources(sources, build.ts);
  const seed = new Map([...workspace.platform.files].map(([file, bytes]) => [absolute(file), bytes]));
  seed.set(absolute('package-lock.json'), workspace.files.get('package-lock.json'));
  for (const [file, bytes] of project) seed.set(absolute(prefix + file), bytes);
  const publicBuild = createBuild(build.deps, { snapshot: snapshotFromFiles(workspace.platform.source.commit, seed), quiet: true });
  const sharedDirectories = publicDirectories.map(directory => absolute(directory) + '/');
  for (const [file, bytes] of build.outputs) if (sharedDirectories.some(directory => file.startsWith(directory)))
    publicBuild.outputs.set(file, bytes);
  const data = publicAi.data;
  const schema = data.composePublicAiPrismaSchema(text(workspace.platform.files, 'apps/platform-api/prisma/schema.prisma'),
    data.createPublicAiDataContribution(publicAi.files));
  generatePrismaDeclarations(publicBuild, [['public', schema]]);
  const client = absolute('apps/platform-api/generated/client/index.d.ts');
  const paths = publicAiClientPaths(publicBuild.ts, client, schema, file => publicBuild.virtual.get(absolute(file)));
  const out = absolute(prefix + 'dist-public') + '/';
  const { emitted } = publicBuild.compile(prefix + 'tsconfig.public.json', { paths });
  const files = assemblePublicAiPackage('server', project, new Map([...emitted]
    .filter(([file]) => file.startsWith(out)).map(([file, bytes]) => [file.slice(out.length), Buffer.from(bytes)])), publicBuild.ts);
  const metadata = JSON.parse(text(files, 'package.json'));
  if (!metadata.exports['./runtime/platform-retention-http'] || !metadata.exports['./runtime/public-rental-adapter-ports'])
    throw Error('固定公共 SDK 缺少保留请求及受控 Rental 适配出口');
  // npm installs one immutable tarball at the adapter's locked path. The host
  // archive carries the asset, never node_modules or an author's installed SDK.
  const { bytes, sha256 } = archiveApi.createCoreArchive(new Map([...files].map(([file, body]) => ['package/' + file, body])));
  const archive = archiveApi.readCoreArchive(bytes, sha256).files;
  if (archive.size !== files.size || [...files].some(([file, body]) => !Buffer.from(archive.get('package/' + file) ?? []).equals(body)))
    throw Error('公共保留 SDK 归档不能按实际编译字节回读');
  const lock = retentionSdkLock(metadata, bytes), source = workspace.platform.source;
  return { files, metadata, bytes, sha256, lock, source, projects: publicBuild.stages,
    receipt: { name: metadata.name, version: metadata.version, legacyVersion: retentionSdk.legacyVersion, source,
      archive: retentionSdk.archive, install: retentionSdk.install, sha256, integrity: lock.integrity, schemaSha256: hash(schema) } };
}

function createRentalHostContext(input) {
  const { aiMode, sourceFiles, platformFiles, rentalFiles, ticketsFiles, aiFiles, mcpFiles, deploymentFiles, ts, selections, freshAi } = input;
  const sourceProvenanceBytes = sourceFiles.get(sourceProvenanceFile);
  const fixed = (sourceFiles.has(sourceProvenanceFile) || trustedBuilds.has(sourceFiles)) && requireFixedRuntime(sourceFiles, sourceProvenanceBytes);
  const development = fixed?.mode === 'development';
  const publicRetention = fixed?.publicRetention;
  const publicAiDataSdk = fixed?.publicAiDataSdk;
  if (fixed && (selections !== fixed.selections || ts !== fixed.ts
    || hash(deploymentFiles.get('core.deployment.lock.json')) !== fixed.evidence.deploymentLockSha256
    || hash(deploymentFiles.get('schema.prisma')) !== fixed.evidence.clients.find(client => client.host === 'rental').schemaSha256))
    throw Error('双仓打包与实际构建的 Client 或部署材料不同');
  const api = fixed ? fixed.api : publicApi();
  const host = input.host ?? 'rental', directory = rentalHostDirectory(host), multi = host === 'example-multi-core';
  if (!['enabled', 'disabled'].includes(aiMode)) throw Error('须明确选择宿主 AI 模式');
  const mcpEntry = input.mcpEntry === undefined ? undefined : requireMcpEntry(input.mcpEntry, host);
  const freshMcp = Boolean(freshAi && mcpEntry);
  if (publicRetention && (!freshAi || !fixed || mcpEntry)) throw Error('公共保留只用于同次固定构建的 18 条新装运行包');
  if (mcpEntry && aiMode !== 'enabled') throw Error('MCP入口须选择同一AI数据与Runtime');
  if (freshAi && (!fixed || !development && !fixed.releaseArtifacts || host !== 'rental' || aiMode !== 'enabled' || !aiFiles)
    || freshMcp !== Boolean(mcpFiles))
    throw Error('v2 只接受同次固定双仓编译的单 Rental 新装组合');
  const lockValue = JSON.parse(text(deploymentFiles, 'core.deployment.lock.json'));
  const phased = freshAi ? api.CorePhasedMigrationLockSchema.parse(lockValue) : undefined;
  const lock = phased?.base ?? api.CoreDeploymentLockSchema.parse(lockValue);
  if (lock.platform.versions.node !== targetNodeVersion || lock.platform.versions.contract !== api.CORE_CONTRACT_VERSION)
    throw Error(`Rental 宿主锁须与实际合同和目标 Node ${targetNodeVersion} 一致`);
  const rentalPin = lock.cores.find(pin => pin.manifest.id === 'rental');
  const ticketsPin = lock.cores.find(pin => pin.manifest.id === 'example-tickets');
  const aiRelease = lock.dataCapabilities?.find(item => item.id === 'ai-native');
  const mcpRelease = lock.dataCapabilities?.find(item => item.id === 'mcp');
  if (!rentalPin || lock.cores.length !== (multi ? 2 : 1) || multi !== Boolean(ticketsFiles)
    || multi && !ticketsPin
    || (lock.dataCapabilities?.length || 0) !== (aiMode === 'enabled' ? freshMcp ? 2 : 1 : 0)
    || (aiMode === 'enabled') !== Boolean(aiRelease) || freshMcp !== Boolean(mcpRelease)
    || (aiMode === 'enabled') !== Boolean(aiFiles)) throw Error('部署锁、固定包与显式 AI 选择不一致');
  if (development && (host !== 'rental' || !freshAi && aiMode !== 'disabled' || mcpEntry && !freshMcp))
    throw Error('开发运行包只支持单 Rental 普通或明确的新装 AI 宿主');
  if (sourceProvenanceBytes) requireSourceProvenance(sourceProvenanceBytes, sourceFiles.get('package-lock.json'), lock, host, aiMode, mcpEntry,
    development ? 'development' : 'release', Boolean(phased), publicRetention, publicAiDataSdk);
  const publicSchema = text(sourceFiles, 'apps/platform-api/prisma/schema.prisma');
  if (publicSchema !== text(platformFiles, 'apps/platform-api/prisma/schema.prisma'))
    throw Error('实际公共 schema 与固定底座源码不同');
  const platform = api.createPublicPlatformDataPlan();
  const baseInput = { release: lock.platform, pin: rentalPin, coreFiles: rentalFiles,
    publicSchema, publicMigrations: platform.migrationNames.map((name, index) => ({ name,
      sql: sourceFiles.get('apps/platform-api/' + platform.data.migrations[index].file) })),
    ...(multi ? { additionalCores: [{ pin: ticketsPin, files: ticketsFiles }] } : {}) };
  const expected = phased ? fixed.createFreshDeployment({ ...baseInput,
    publicAi: { release: aiRelease, files: aiFiles }, extension: freshAi,
    ...(freshMcp ? { mcp: { release: mcpRelease, files: mcpFiles } } : {}) })
    : api.createRentalDeploymentFiles({ ...baseInput, ...(aiFiles ? { ai: { release: aiRelease, files: aiFiles } } : {}) });
  if (!isDeepStrictEqual(expected.lock, phased ?? lock) || expected.files.size !== deploymentFiles.size)
    throw Error('部署材料与原准备结果不一致');
  for (const [file, bytes] of expected.files) if (!deploymentFiles.has(file) || !Buffer.from(bytes).equals(deploymentFiles.get(file)))
    throw Error('部署材料缺失或摘要不一致：' + file);
  const clients = [];
  for (const [host, mode, schema] of [['platform', 'platform', publicSchema], ['rental', aiMode === 'enabled' ? 'rental-ai' : 'rental', text(deploymentFiles, 'schema.prisma')]]) {
    const directory = `apps/${host}-api/generated/client`, selected = selections[host];
    if (!selected || path.resolve(selected.client) !== path.join(root, directory, 'index.d.ts'))
      throw Error('须选用本宿主实际 generated/client 声明：' + host);
    const read = file => path.resolve(file) === path.resolve(selected.client) ? selected.declarations
      : path.resolve(file) === path.join(root, directory, 'schema.prisma') ? selected.schema : undefined;
    const checked = selectedCompilerOptions(ts, path.join(root, `apps/${host}-api/tsconfig.json`), {}, { client: selected.client, mode }, read);
    if (!samePrismaSchema(selected.schema, schema)) throw Error('构建所选 Client 与部署 schema 不一致：' + host);
    clients.push({ directory, mode, models: checked.models, schemaSha256: hash(Buffer.from(schema)) });
  }
  const originalLock = JSON.parse(text(sourceFiles, 'package-lock.json'));
  const platformLock = JSON.parse(text(platformFiles, 'package-lock.json'));
  // 源码发行与宿主锁的 dev/optional 可因闭包投影变化，实际版本、来源、摘要和依赖边仍须一致。
  const dependencyIdentity = value => {
    const { dev, optional, devOptional, peer, ...identity } = value || {};
    return identity;
  };
  for (const [file, entry] of Object.entries(platformLock.packages)) if (file.includes('node_modules/') && !entry.link
    && !isDeepStrictEqual(dependencyIdentity(entry), dependencyIdentity(originalLock.packages[file])))
    throw Error('宿主与固定底座的原依赖锁不一致：' + file);
  const fixedPackages = new Map([['packages/rental-core', rentalFiles],
    ...(ticketsFiles ? [['packages/example-tickets-core', ticketsFiles]] : []),
    ...(mcpFiles ? [['packages/mcp-server', mcpFiles]] : []),
    ...(aiFiles && !phased ? [['packages/ai-native-data', aiFiles]] : [])]);
  const workspaces = selectWorkspaces(originalLock, directory => JSON.parse(text(
    fixedPackages.get(directory) ?? (publicDirectories.includes(directory) ? platformFiles : sourceFiles),
    fixedPackages.has(directory) ? 'package.json' : directory + '/package.json')), aiMode, host, { mcp: Boolean(mcpEntry), publicRetention, publicAiDataSdk });
  for (const directory of fixedPackages.keys()) if (!workspaces.has(directory))
    throw Error('固定 Core 包不在实际宿主依赖闭包：' + directory);
  const aiServerRuntimeOnly = Boolean(phased || mcpEntry);
  const files = new Map();
  for (const [directory] of workspaces) {
    const fixed = fixedPackages.get(directory);
    if (fixed) for (const [file, bytes] of fixed) files.set(directory + '/' + file, bytes);
    else for (const [file, bytes] of sourceFiles) if (file.startsWith(directory + '/')) {
      const relative = file.slice(directory.length + 1);
      if ((relative.startsWith('dist-mcp/') && !mcpEntry)
        || (freshMcp && directory === 'apps/rental-api' && relative.startsWith('dist-ai/'))) continue;
      if (aiServerRuntimeOnly && directory === 'packages/ai-native-server' && relative.endsWith('.d.ts')) continue;
      if (['apps/rental-api', 'apps/example-multi-core-api'].includes(directory)
        && aiMode === 'disabled' && relative.startsWith('dist-ai/')) continue;
      if (['package.json', 'README.md', 'LICENSE'].includes(relative) || /^dist(?:-[a-z0-9-]+)?\/.*\.(?:js|cjs|json|d\.ts)$/u.test(relative)
        || directory === 'apps/platform-api' && relative.startsWith('prisma/')) files.set(file, bytes);
    }
    if (publicDirectories.includes(directory))
      files.set(directory + '/package.json', Buffer.from(text(platformFiles, directory + '/package.json')));
    // 公共导读与已核底座发行同源，仅替换原本入包的 README，不新增文件。
    if (publicDirectories.includes(directory) && files.has(directory + '/README.md'))
      files.set(directory + '/README.md', Buffer.from(text(platformFiles, directory + '/README.md')));
    if (!files.has(directory + '/LICENSE')) files.set(directory + '/LICENSE', Buffer.from(text(sourceFiles, 'LICENSE')));
    if (aiServerRuntimeOnly && directory === 'packages/ai-native-server')
      files.set(directory + '/package.json', json(runtimeOnlyMetadata(workspaces.get(directory))));
  }
  const runtimePackageFiles = files.size;
  for (const [file, bytes] of deploymentFiles) files.set('apps/rental-api/prisma-deployment/' + file, bytes);
  if (phased) {
    for (const [file, bytes] of freshAi.files) {
      if (!Buffer.from(sourceFiles.get('apps/rental-api/' + file) ?? []).equals(bytes)) throw Error('Rental 扩展不是固定宿主原文：' + file);
      files.set('apps/rental-api/' + file, bytes);
    }
    files.set('apps/rental-api/prisma/ai-extension/runtime-source.json', json(expected.runtimeSource));
    for (const [file, bytes] of aiFiles) files.set('public-ai-data/' + file, bytes);
  }
  if (publicRetention) files.set(retentionSdk.archive, sourceFiles.get(retentionSdk.archive));
  if (publicAiDataSdk) {
    const archive = publicDataSdkFor(publicAiDataSdk.metadata).archive;
    files.set(archive, sourceFiles.get(archive));
  }
  files.set('rental-host.deployment-provenance.json', json(describeRentalDeployment(api, lock, deploymentFiles, platform, phased?.postCapability)));
  if (sourceProvenanceBytes) files.set(sourceProvenanceFile, sourceProvenanceBytes);
  let buildProvenance;
  if (fixed) {
    const bytes = json({ ...fixed.evidence, files: fixed.evidence.files.filter(({ file }) => files.has(file)
      && ![...fixedPackages.keys()].some(directory => file.startsWith(directory + '/')
        && (!freshMcp || directory !== 'packages/mcp-server'))) });
    files.set(hostBuildFile, bytes);
    buildProvenance = { file: hostBuildFile, sha256: hash(bytes) };
  }
  files.set('LICENSE', Buffer.from(text(sourceFiles, 'LICENSE')));
  const entry = publicRetention ? publicRetentionEntry
    : mcpEntry ?? directory + (phased ? '/dist-ai/ai-fresh-main.js' : aiMode === 'enabled' ? '/dist-ai/ai-main.js' : '/dist/main.js');
  if (mcpEntry) requireMcpStartup(files, entry, ts, freshMcp);
  const runtime = checkRuntimeClosure(files, workspaces, originalLock, entry, ts, { moduleImports: Boolean(mcpEntry), publicRetention, publicAiDataSdk });
  if (phased) {
    const initializationEntry = directory + (freshMcp ? '/dist-mcp/mcp-fresh-initialize.js' : '/dist-ai/ai-fresh-initialize.js');
    const initialization = checkRuntimeClosure(files, workspaces, originalLock, initializationEntry, ts, { moduleImports: freshMcp, publicAiDataSdk });
    runtime.initialization = { entry: initializationEntry, files: initialization.files };
    runtime.resolutions = [...runtime.resolutions, ...initialization.resolutions];
    runtime.runtimePeers = [...new Map([...runtime.runtimePeers, ...initialization.runtimePeers]
      .map(peer => [peer.owner + ':' + peer.name, peer])).values()];
  }
  const projected = projectHostLock(originalLock, workspaces, aiMode, runtime.runtimePeers, host, { mcp: Boolean(mcpEntry), publicRetention, publicAiDataSdk });
  for (const item of runtime.resolutions) if (!item.specifier.startsWith('.') && !item.specifier.startsWith('@rental-os/')) {
    const name = item.specifier.startsWith('@') ? item.specifier.split('/').slice(0, 2).join('/') : item.specifier.split('/')[0];
    const owner = runtimeOwner(item.from, workspaces, publicRetention, publicAiDataSdk);
    const locked = projected.lock.packages[lockedDependency(projected.lock, owner, name)];
    if (!locked || locked.dev) throw Error('运行依赖不在生产锁闭包：' + name);
  }
  // 双仓公共产物已在同一构建中复算；旧路径仍在打包前与原底座归档逐字节比较。
  const platformBuild = fixed?.platformBuild ?? compileRentalPlatformSource({ platformFiles, release: lock.platform,
    selection: selections.platform, dependencyDirectory: input.dependencyDirectory, ts, api });
  if (fixed) {
    const archiveMatches = development ? api.createCoreArchive(platformFiles).sha256 === lock.platform.sha256
      : api.matchesInstalledCoreArchive(platformFiles, lock.platform.sha256);
    if (!archiveMatches || !isDeepStrictEqual(platformBuild.evidence.release, lock.platform))
      throw Error('双仓打包底座与实际编译材料不同');
  }
  requireMatchingPublicRuntime(sourceFiles, platformFiles, platformBuild);
  for (const [file, bytes] of platformBuild.generated) files.set(file, bytes);
  files.set('package.json', json(projected.root)); files.set('package-lock.json', json(projected.lock));
  files.set('Dockerfile', Buffer.from(dockerfile(aiMode, entry, Boolean(phased), freshMcp)));
  files.set('.dockerignore', Buffer.from('**/node_modules\n**/generated\n**/.git\n**/.env\n**/.env.*\ndocs\noutput\n'));
  files.set('verify-runtime.cjs', Buffer.from(createRuntimeVerifier('rental-host.context.json', Boolean(mcpEntry), Boolean(publicRetention), Boolean(publicAiDataSdk))));
  files.set('README.md', Buffer.from('# 独立 Rental 宿主镜像上下文\n\n' +
    (development ? '这是固定双仓开发组合，只用于独立新建的开发/冒烟库。不要用它更新已有安装、覆盖同版本发行或选作服务器候选。\n\n' +
      '使用 Node 24.13.0。在解包根按运行锁执行 `npm ci --include=dev --ignore-scripts`，按 Dockerfile 的两条生成命令生成专属 Client，再运行 `node verify-runtime.cjs`。' +
      '部署方配置专用 MySQL 的 `DATABASE_URL` 和 `AUTH_TOKEN_SECRET`，以 `apps/rental-api/prisma-deployment/schema.prisma` 执行 Prisma 5.22 迁移；' +
      '设置初始口令后执行 `node apps/platform-api/dist/initialize.js`。' +
      `设置 \`RENTAL_AI_MODE=${aiMode}\` 和指向随包 \`apps/rental-api/prisma-deployment/core.deployment.lock.json\` 的绝对 \`RENTAL_DEPLOYMENT_LOCK\`，` +
      (phased ? '设置指向随包 `public-ai-data` 的绝对 `RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR`。' +
        (freshMcp ? '设置指向同一安装中 `packages/mcp-server` 的绝对 `RENTAL_MCP_DATA_PACKAGE_DIR`。' : '') +
        `执行 \`node ${runtime.initialization.entry}\` 登记内置品类。` : '') +
      `运行 \`node ${entry}\`。` +
      '登录后依次登记部署准入、授权测试租户、分配成员和绑定 Core。\n\n' : '') +
    '本目录消费固定 Rental 包、所选 AI 数据包及原 prepared 锁/迁移。rental-host.context.json 记录实际字节摘要；不将作者工作区或包版本名当作已部署来源。\n\n' +
    '在目标 Linux 平台执行 `docker build --target runtime -t rental-host .`。构建按原 npm 锁安装依赖，并在镜像内用 Prisma 5.22.0 分别生成公共和所选宿主 Client；不会复制 Windows 引擎或默认 Client。外部镜像、apt/npm/引擎下载与实际构建须在部署环境核验。\n\n' +
    `镜像启动入口固定为 ${entry}，AI=${aiMode}。运行前由部署负责人配置 DATABASE_URL、AUTH_TOKEN_SECRET 及必要的原集成配置，沿原迁移账/物理观察办理数据库准备。候选材料位于 apps/rental-api/prisma-deployment；不得用它替代迁移收据。\n\n` +
    (freshMcp ? '此入口在专用空库核 23 条原迁移和实际结构后启动 Rental/AI，未提供首方授权来源时不挂 MCP HTTP。业务接入由第一方代码显式调用 `bootstrapFreshRentalMcp(sources)`，复用原 Auth/Core/Native；AS、当前发布、字段和计量均须原权威。\n\n'
      : mcpEntry ? 'MCP由该第一方源码入口显式调用bootstrapRentalAiMcp或bootstrapRentalOriginalAiMcp；原Auth/Core/Native、AS就绪、工具发布及字段释放须由真实owner供给。缺依赖拒绝启动或读取，包不自动制造批准。Node预检按实际import条件解析ESM，不执行目标模块。\n\n' : '') +
    '版本与候选材料读取另须配置 CORE_PACKAGE_STORAGE_ROOT 为受管绝对目录，在其 archives/index.json 登记同一固定底座完整源码 .tgz 及发行资料；CORE_PLATFORM_PACKAGE_REFERENCE 选取其中与当前启动锁 platform 完全一致的引用。缺配置或原材料保持不可用，已有归档或发行不匹配时拒绝读取。[宿主配置](apps/rental-api/README.md)\n\n' +
    '兼容程序恢复须使用上次已验证的完整运行包及原锁，同时保留并选取该锁对应的完整底座归档和原登记，先核当前数据与原迁移链仍符合该锁。索引成功读取后固定于本进程，变更登记或配置选择须重新启动装配后采用；实际归档每次读取仍核原路径和字节。运行包和原锁不代替数据兼容、当前授权与原操作收据的实际验证。\n\n' +
    '打包和镜像预检均不启动应用、连接数据库、执行迁移或供应商动作。当前 imageBuild=not-run、deployment=pending；真实安装、镜像、数据库及业务验收分别办理。\n'));
  for (const directory of [...publicDirectories, 'apps/rental-api', 'apps/example-multi-core-api']) {
    const file = directory + '/README.md';
    if (files.has(file)) files.set(file, Buffer.from(runtimePackageReadme(text(files, file), file, files, aiMode,
      platformFiles, lock.platform.source, api.pinCoreDocumentationLinks)));
  }
  const receipt = { format: 'rental-host-context-1', host, aiMode, imageBuild: 'not-run', deployment: 'pending',
    ...(development ? { sourceMode: 'development', releaseApproved: false, serverUpdateEligible: false } :
      fixed?.releaseArtifacts ? { sourceMode: 'release', sourceArtifacts: fixed.releaseArtifacts, releaseApproved: false, serverUpdateEligible: false } : {}),
    ...(fixed?.portableCoreBuild ? { portableCoreBuild: fixed.portableCoreBuild } : {}),
    ...(phased ? { installation: 'fresh-ai', ledgerVersion: 2 } : {}),
    ...(publicRetention ? { publicRetention: { ...publicRetention.receipt,
      installedFiles: [...publicRetention.files].map(([file, bytes]) => ({ file, sha256: hash(bytes) })) } } : {}),
    ...(publicAiDataSdk ? { publicAiDataSdk: { ...publicAiDataSdk.receipt,
      installedFiles: [...publicAiDataSdk.files].map(([file, bytes]) => ({ file, sha256: hash(bytes) })) } } : {}),
    mcpMode: freshMcp ? 'data-only' : mcpEntry ? 'enabled' : 'disabled', ...(mcpEntry ? { mcpEntry } : {}),
    deploymentProvenance: 'rental-host.deployment-provenance.json',
    ...(sourceProvenanceBytes ? { sourceProvenance: { file: sourceProvenanceFile, sha256: hash(sourceProvenanceBytes) } } : {}),
    ...(buildProvenance ? { buildProvenance } : {}),
    target: 'linux-bookworm', prismaVersion: '5.22.0', entry, clients,
    deploymentLockSha256: hash(deploymentFiles.get('core.deployment.lock.json')), coreSha256: rentalPin.sha256,
    ...(multi ? { additionalCorePackages: [{ id: ticketsPin.manifest.id, sha256: ticketsPin.sha256 }] } : {}),
    ...(aiFiles ? { aiDataSha256: aiRelease.sha256 } : {}),
    ...(mcpFiles ? { mcpDataSha256: mcpRelease.sha256, mcpDataDirectory: 'packages/mcp-server' } : {}),
    ...(phased ? { omittedAiServerDeclarations: fixed.evidence.files.filter(({ file }) =>
      file.startsWith('packages/ai-native-server/') && file.endsWith('.d.ts')).length } : {}),
    originalNpmLockSha256: hash(sourceFiles.get('package-lock.json')), platformBuild: platformBuild.evidence, runtime,
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => ({ file, sha256: hash(bytes) })) };
  files.set('rental-host.context.json', json(receipt));
  if (files.size > api.CORE_ARCHIVE_LIMITS.files)
    throw Error(`Rental 宿主归档 ${files.size} 文件超过上限 ${api.CORE_ARCHIVE_LIMITS.files}（工作区运行文件 ${runtimePackageFiles}）`);
  return { files, receipt, ...api.createCoreArchive(files) };
}


const releasePreparations = new WeakMap();
const materialIdentity = files => hash(json([...files].map(([file, bytes]) => [file, hash(bytes)]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
const sdkIdentity = sdk => sdk ? hash(json({ files: materialIdentity(sdk.files), archive: hash(sdk.bytes),
  metadata: sdk.metadata, lock: sdk.lock, receipt: sdk.receipt, source: sdk.source, projects: sdk.projects })) : null;
const workspaceIdentity = workspace => hash(json({ platform: workspace.platform.source, version: workspace.platform.version,
  rental: workspace.rental.source, coreVersion: workspace.rental.metadata.version, tag: workspace.rental.tag }));
function requireReleasePreparation(prepared) {
  const original = releasePreparations.get(prepared);
  if (!original || materialIdentity(prepared.workspace.files) !== original.workspace
    || workspaceIdentity(prepared.workspace) !== original.source
    || materialIdentity(prepared.workspace.platform.files) !== original.platformSource
    || materialIdentity(prepared.platformFiles) !== original.platform
    || materialIdentity(prepared.rentalFiles) !== original.rental
    || !isDeepStrictEqual(prepared.portableCoreSource, original.portableCoreSource)
    || (prepared.publicAi ? materialIdentity(prepared.publicAi.files) : null) !== original.publicAi
    || (prepared.publicAi ? hash(json(prepared.publicAi.release)) : null) !== original.publicAiRelease
    || sdkIdentity(prepared.workspace.publicAiDataSdk) !== original.reader
    || sdkIdentity(prepared.publicRetention) !== original.retention)
    throw Error('正式两阶段材料缺失、不是本次准备或字节变化');
  return original;
}

/** Stage one resolves the final workspace before dependency installation.
 * portableCoreSource identifies the original Core build inputs to acquire in
 * the caller's online preparation; stage two never fetches Git objects or tags.
 * Real version tags and both original archives are mandatory; no development receipt is promoted. */
async function prepareRentalReleaseWorkspace(input) {
  const { repo, repository, commit, coreRepo, coreCommit, deps } = input;
  for (const name of ['freshAi', 'publicRetention', 'mcp'])
    if (input[name] !== undefined && typeof input[name] !== 'boolean') throw Error('显式选装须为布尔选择：' + name);
  const freshAi = input.freshAi === true, publicRetention = input.publicRetention === true, mcp = input.mcp === true;
  if (input.mode !== 'release' || input.profile !== 'host' || !['enabled', 'disabled'].includes(input.aiMode)
    || (input.aiMode === 'enabled') !== freshAi || publicRetention && !freshAi || mcp && !freshAi)
    throw Error('正式入口须显式 release/host 与普通或新装 AI 选择');
  if (publicRetention && mcp) throw Error('公共保留与 MCP 尚无同一正式宿主和双能力 Web 接点');
  if (freshAi ? !/^[a-f0-9]{64}$/u.test(input.aiDataSha256 ?? '') : input.aiDataSha256 !== undefined)
    throw Error('只有显式新装 AI 须提供实际数据发行 SHA-256');
  for (const name of ['platform', 'rental']) if (!(input[name + 'Archive'] instanceof Uint8Array)
    || !/^[a-f0-9]{64}$/u.test(input[name + 'Sha256'] ?? '') || hash(input[name + 'Archive']) !== input[name + 'Sha256'])
    throw Error('正式两阶段输入须包含原归档及独立核定摘要：' + name);
  const prepare = require('./prepare-rental-workspace.cjs');
  const { createBuild } = require('./check-rental-package-build.cjs');
  const { snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const contracts = prepare.compileFixedPlatformContracts(repo, commit, deps, true);
  const load = name => contracts.load(contracts.exported('@rental-os/core-contracts' + name, true));
  const api = { ...load(''), ...load('/archive'), ...load('/platform-source') };
  const platform = await api.readPlatformSourceFromGit(repo, { repository, commit });
  const { execFileSync } = require('node:child_process');
  const tagged = execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', 'rev-parse', '--verify',
    'refs/tags/v' + platform.version + '^{commit}'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  if (tagged !== commit) throw Error('正式底座版本 Tag 与固定提交不同');
  const rental = prepare.readIndependentRentalSource(coreRepo, coreCommit, { mode: 'release' });
  const platformFiles = api.readCoreArchive(input.platformArchive, input.platformSha256).files;
  const rentalFiles = api.readCoreArchive(input.rentalArchive, input.rentalSha256).files;
  if (!api.matchesInstalledCoreArchive(platform.files, input.platformSha256)) throw Error('正式底座归档与固定 Git 不同');
  const manifest = api.CoreManifestSchema.parse(JSON.parse(text(rentalFiles, 'core.manifest.json')));
  if (manifest.id !== 'rental' || manifest.version !== rental.metadata.version || !isDeepStrictEqual(manifest.source, rental.source))
    throw Error('正式 Rental 包与固定 Tag 源码身份不同');
  const options = { repo, repository, commit, coreRepo, coreCommit, deps, mode: 'release', profile: 'host',
    ai: freshAi, freshAi, mcp };
  let workspace = prepare.projectRentalDevelopmentWorkspace(options, platform, rental, api);
  let publicAi, selectedRetention;
  if (freshAi) {
    const absolute = file => path.resolve(root, file).split(path.sep).join('/');
    const build = createBuild(deps, { snapshot: snapshotFromFiles(commit,
      new Map([...workspace.files].map(([file, bytes]) => [absolute(file), bytes]))), publicAiDataSdk: workspace.publicAiDataSdk, quiet: true });
    for (const name of ['platform-contracts', 'core-contracts', 'platform-server', 'core-host', 'platform-core-host'])
      build.compile('packages/' + name + '/tsconfig.json');
    publicAi = compilePublicAiData(build, workspace, repo);
    if (publicAi.archive.sha256 !== input.aiDataSha256) throw Error('实际公共 AI 数据发行摘要与正式选择不同');
    if (publicRetention) {
      selectedRetention = compilePublicRetentionSdk(build, workspace, publicAi, api, repo);
      workspace = prepare.projectRentalDevelopmentWorkspace({ ...options, publicRetention: selectedRetention,
        publicAiDataSdk: workspace.publicAiDataSdk }, platform, rental, api);
    }
  }
  const prepared = { workspace, platformFiles, rentalFiles, publicAi, publicRetention: selectedRetention,
    portableCoreSource: readPortableSourceIdentity(repo, readPortableRentalSource(workspace, rentalFiles)),
    artifacts: { platformSha256: input.platformSha256, rentalSha256: input.rentalSha256,
      ...(freshAi ? { aiDataSha256: input.aiDataSha256 } : {}) } };
  releasePreparations.set(prepared, { workspace: materialIdentity(workspace.files), source: workspaceIdentity(workspace),
    platformSource: materialIdentity(workspace.platform.files), platform: materialIdentity(platformFiles),
    rental: materialIdentity(rentalFiles), portableCoreSource: structuredClone(prepared.portableCoreSource),
    publicAi: publicAi ? materialIdentity(publicAi.files) : null,
    publicAiRelease: publicAi ? hash(json(publicAi.release)) : null,
    reader: sdkIdentity(workspace.publicAiDataSdk), retention: sdkIdentity(selectedRetention),
    artifacts: structuredClone(prepared.artifacts), options: { repo, repository, commit, coreRepo, coreCommit, freshAi, mcp, publicRetention } });
  return prepared;
}

/** The archive is already pinned; its guide nominates an official build source,
 * which is still unproven until the full portable rebuild matches the pin. */
function readPortableRentalSource(workspace, rentalFiles) {
  const guide = text(rentalFiles, 'CORE_GUIDE.md');
  const origins = [...guide.matchAll(/^本指南来自\[固定底座接入手册\]\((https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/blob\/([a-f0-9]{40})\/packages\/core-contracts\/README\.md\)和同版本正式契约。Core来源为\[固定提交\]\((https:\/\/github\.com\/[^/\s]+\/[^/\s]+)\/commit\/([a-f0-9]{40})\)。$/gmu)];
  if (origins.length !== 1 || origins[0][1] !== workspace.platform.source.repository
    || origins[0][3] !== workspace.rental.source.repository || origins[0][4] !== workspace.rental.source.commit)
    throw Error('正式 Rental 包缺少可核定的原 portable 构建/文档来源');
  return { repository: origins[0][1], commit: origins[0][2] };
}

/** Resolve the original portable build tag while the preparation checkout is
 * online/complete. Stage two receives this identity from the prepared record;
 * it never fetches Git objects or follows a moving tag. */
function readPortableSourceIdentity(repo, source) {
  const { execFileSync } = require('node:child_process');
  try {
    const read = file => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', 'show', source.commit + ':' + file],
      { cwd: repo, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    const version = JSON.parse(read('package.json')).version;
    const tag = execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', 'rev-parse', '--verify',
      'refs/tags/v' + version + '^{commit}'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
    if (tag !== source.commit) throw Error('tag mismatch');
    return { ...source, tag: 'v' + version, version, acquisition: 'online-preparation', offlineAfterPreparation: true };
  } catch {
    throw Error('正式 portable 原来源未在准备 checkout 中取得固定提交和对应版本 Tag；请先在联网准备阶段获取，第二阶段保持离线');
  }
}

/** A published portable Core keeps its own build/documentation basis when only
 * the host advances. Its original Git objects and version tag must already be
 * present; missing offline inputs are not replaced with the current host. */
async function rebuildPortableRentalRelease({ repo, deps, workspace, rentalFiles, expectedSha256, expectedSource, api }) {
  const sourceInfo = readPortableSourceIdentity(repo, readPortableRentalSource(workspace, rentalFiles));
  if (expectedSource && !isDeepStrictEqual(sourceInfo, expectedSource))
    throw Error('正式两阶段的原 portable 来源身份与准备阶段不同');
  const source = { repository: sourceInfo.repository, commit: sourceInfo.commit };
  const { execFileSync } = require('node:child_process');
  const read = file => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', 'show', source.commit + ':' + file],
    { cwd: repo, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const version = sourceInfo.version;
  const { createBuild, verifyContracts } = require('./check-rental-package-build.cjs');
  const { readDistributionWorkspace, verifyServer, verifyNative, rentalPackageInputs } = require('./verify-rental-distribution.cjs');
  const { snapshot } = await readDistributionWorkspace(source, repo, deps, workspace.rental, 'host', { preserveCore: true });
  const portable = createBuild(deps, { snapshot, quiet: true });
  const absolute = file => path.resolve(root, file).split(path.sep).join('/');
  const originalLock = JSON.parse(portable.sourceRead(absolute('package-lock.json')));
  if (originalLock.packages['node_modules/typescript']?.version !== portable.ts.version)
    throw Error('Rental 原 portable 构建需要其锁定的 TypeScript');
  verifyContracts(portable);
  const schemas = verifyServer(portable);
  verifyNative(portable);
  for (const directory of ['apps/platform-api', 'packages/ai-native-data', 'apps/rental-api']) portable.compile(directory + '/tsconfig.json');
  const contract = portable.load(portable.exported('@rental-os/core-contracts', true));
  const packed = portable.load(portable.exported('@rental-os/rental-api/package', true)).createRentalHostPackage({
    files: rentalPackageInputs(portable), source: workspace.rental.source, sourceDirectory: 'packages/rental-core',
    documentationSource: source, platformSource: source, platformGuide: read('packages/core-contracts/README.md').toString('utf8'),
    host: { platform: version, contract: contract.CORE_CONTRACT_VERSION, node: targetNodeVersion, capabilities: {} } }, 'portable');
  const files = api.readCoreArchive(packed.bytes, packed.sha256).files;
  if (!api.matchesInstalledCoreArchive(files, expectedSha256))
    throw Error('正式 Rental 归档与原 portable 来源实际重编译不同');
  return { packed, evidence: { format: 'rental-portable-rebuild-1', source: workspace.rental.source,
    buildSource: sourceInfo, documentationSource: sourceInfo, platformSource: sourceInfo, sha256: expectedSha256,
    rebuiltSha256: packed.sha256, files: files.size, schemaSha256: hash(Buffer.from(schemas.schema)), stages: portable.stages } };
}

/** Stage two compiles with dependencies installed from stage one's exact lock.
 * The same returned workspace is the only source for the paired Web build. */
async function packageRentalReleaseWorkspace(prepared, { deps }) {
  const original = requireReleasePreparation(prepared);
  return buildRentalHostCandidate({ ...original.options, deps }, prepared);
}

async function prepareRentalDevelopmentHost(options) { return buildRentalHostCandidate(options); }

/** Build selected fixed sources; only stage one can supply a release preparation. */
async function buildRentalHostCandidate({ repo, repository, commit, coreRepo, coreCommit, deps, freshAi = false, mcp = false, publicRetention = false }, releasePreparation) {
  const releaseInput = releasePreparation && requireReleasePreparation(releasePreparation);
  if (mcp && !freshAi) throw Error('新装 MCP 必须显式选择 --fresh-ai');
  if (publicRetention && (!freshAi || mcp)) throw Error('--public-retention 只接受 --fresh-ai 的 18 条新装组合');
  const { compileFixedPlatformContracts, createRentalDevelopmentWorkspace, projectRentalDevelopmentWorkspace } = require('./prepare-rental-workspace.cjs');
  const { createBuild, verifyContracts } = require('./check-rental-package-build.cjs');
  const { snapshotFromFiles } = require('./rental-build-snapshot.cjs');
  const { selectedPrisma, generatePrismaDeclarations, verifyServer, verifyNative, rentalPackageInputs } = require('./verify-rental-distribution.cjs');
  const { createMemoryBuild } = require('./rental-build-memory.cjs');
  const contracts = compileFixedPlatformContracts(repo, commit, deps, true);
  const loadContract = name => contracts.load(contracts.exported('@rental-os/core-contracts' + name, true));
  const platformApi = { ...loadContract(''), ...loadContract('/platform-source'), ...loadContract('/archive') };
  const options = { repo, repository, commit, coreRepo, coreCommit, deps, mode: releaseInput ? 'release' : 'development', profile: 'host',
    ...(freshAi ? { ai: true, freshAi: true, mcp } : {}) };
  let workspace = releasePreparation?.workspace ?? await createRentalDevelopmentWorkspace(options, platformApi);
  const absolute = file => path.resolve(root, file).split(path.sep).join('/');
  let build = createBuild(deps, { publicAiDataSdk: workspace.publicAiDataSdk, snapshot: snapshotFromFiles(commit,
    new Map([...workspace.files].map(([file, bytes]) => [absolute(file), bytes]))), publicRetention: releasePreparation?.publicRetention, quiet: true });
  if (JSON.parse(text(workspace.files, 'package-lock.json')).packages['node_modules/typescript']?.version !== build.ts.version)
    throw Error('开发宿主编译器与双仓投影锁不一致');
  verifyContracts(build);
  if (freshAi) build.compile('packages/core-contracts/tsconfig.json');
  const schemas = freshAi ? selectedPrisma(build) : verifyServer(build);
  let publicAi, extension, mcpData;
  if (freshAi) {
    for (const name of ['platform-server', 'core-host', 'platform-core-host', 'ai-native-data']) build.compile(`packages/${name}/tsconfig.json`);
    publicAi = compilePublicAiData(build, workspace, repo);
    if (releaseInput && publicAi.archive.sha256 !== releaseInput.artifacts.aiDataSha256) throw Error('正式数据包在编译阶段发生变化');
    const data = publicAi.data;
    const runtime = build.ts.transpileModule(build.sourceRead(absolute('apps/rental-api/src/ai-data-extension.ts')),
      { compilerOptions: { target: build.ts.ScriptTarget.ES2022, module: build.ts.ModuleKind.CommonJS } }).outputText;
    // The extension also imports the Rental relation contribution. Emit its
    // actual producer first, then select the full new schema for the real emit.
    build.compile('packages/rental-core/tsconfig.json');
    const extensionRuntime = absolute('apps/rental-api/dist-ai/ai-data-extension.js');
    build.outputs.set(extensionRuntime, runtime);
    const adapter = build.load(extensionRuntime);
    build.outputs.delete(extensionRuntime);
    const bytes = file => workspace.files.get(file);
    extension = { source: workspace.rental.source, files: new Map(adapter.RENTAL_AI_EXTENSION_FILES.map(({ file }) =>
      [file, bytes('apps/rental-api/' + file)])) };
    schemas.schema = adapter.composeRentalPublicAiPrismaSchema(schemas.publicSchema, data.createPublicAiDataContribution(publicAi.files),
      text(workspace.files, 'packages/rental-core/prisma/schema.prisma'), adapter.readRentalAiDataExtension(extension.files));
    generatePrismaDeclarations(build, [['rental', schemas.schema]]);
    for (const directory of ['packages/rental-core','packages/ai-native-server','apps/rental-api','apps/rental-admin',
      ...(mcp ? ['packages/rental-mcp-host'] : [])])
      build.selectedClients.set(absolute(directory), { client: absolute('apps/rental-api/generated/client/index.d.ts'), mode: 'rental-ai' });
    build.compile('packages/rental-core/tsconfig.json');
    build.compile('packages/ai-native-server/tsconfig.json');
    publicizeFreshAiDeclarations(build);
  }
  for (const directory of ['apps/platform-api', 'packages/ai-native-data', 'apps/rental-api']) build.compile(directory + '/tsconfig.json');
  if (freshAi) {
    build.compile('apps/rental-api/tsconfig.ai.json');
    build.compile('apps/rental-admin/tsconfig.json');
  }
  if (mcp) {
    build.compileMcp();
    mcpData = prepareFreshMcpData(build, workspace, absolute);
    build.compile('packages/rental-mcp-host/tsconfig.json');
    build.compile('apps/rental-api/tsconfig.mcp.json');
  }
  verifyNative(build);
  const memory = createMemoryBuild(build);
  const load = name => memory.load(build.exported('@rental-os/' + name, true));
  const platform = load('platform-api/data-plan').createPublicPlatformDataPlan();
  const release = { versions: { platform: workspace.platform.version, contract: platformApi.CORE_CONTRACT_VERSION,
    node: targetNodeVersion, capabilities: {} }, source: workspace.platform.source,
  sha256: releaseInput?.artifacts.platformSha256 ?? platformApi.createCoreArchive(workspace.platform.files).sha256, data: platform.data };
  const sourceDirectory = 'packages/rental-core';
  const portable = releaseInput ? await rebuildPortableRentalRelease({ repo, deps, workspace,
    rentalFiles: releasePreparation.rentalFiles, expectedSha256: releaseInput.artifacts.rentalSha256,
    expectedSource: releasePreparation.portableCoreSource, api: platformApi }) : undefined;
  const packed = portable?.packed ?? load('rental-api/package').createRentalHostPackage({ files: rentalPackageInputs(build),
    source: workspace.rental.source, sourceDirectory, platformSource: workspace.platform.source, host: release.versions,
    platformGuide: text(workspace.platform.files, 'packages/core-contracts/README.md') });
  const rebuiltRental = platformApi.readCoreArchive(packed.bytes, packed.sha256).files;
  const rentalFiles = releasePreparation?.rentalFiles ?? rebuiltRental;
  const deploymentInput = {
    release, pin: { manifest: packed.manifest, sha256: releaseInput?.artifacts.rentalSha256 ?? packed.sha256 }, coreFiles: rentalFiles,
    publicSchema: schemas.publicSchema, publicMigrations: platform.migrationNames.map((name, index) => ({ name,
      sql: workspace.platform.files.get('apps/platform-api/' + platform.data.migrations[index].file) })) };
  const createFreshDeployment = freshAi && memory.load(absolute('apps/rental-api/dist-ai/ai-fresh-deployment.js')).createFreshRentalAiDeployment;
  const deployment = createFreshDeployment ? createFreshDeployment({ ...deploymentInput, publicAi, extension, mcp: mcpData })
    : memory.load(absolute('apps/rental-api/dist/prepare-deployment.js')).createRentalDeploymentFiles(deploymentInput);
  if (!Buffer.from(deployment.files.get('schema.prisma')).equals(Buffer.from(schemas.schema)))
    throw Error('实际部署 schema 和所选编译 Client 的 schema 不一致');
  const pathFor = name => path.join(root, 'apps', name + '-api/generated/client/index.d.ts');
  const selections = { platform: { mode: 'platform', client: pathFor('platform'), schema: schemas.publicSchema,
    declarations: build.virtual.get(absolute(pathFor('platform'))) }, rental: { mode: freshAi ? 'rental-ai' : 'rental', client: pathFor('rental'),
    schema: schemas.schema, declarations: build.virtual.get(absolute(pathFor('rental'))) } };
  // Same independent public replay used by release packing. In the development
  // projection it also gives the ordinary API the exact public runtime bytes.
  const platformBuild = compileRentalPlatformSource({ platformFiles: workspace.platform.files, release,
    selection: selections.platform, dependencyDirectory: deps, ts: build.ts, api: platformApi });
  for (const [file, bytes] of platformBuild.generated) if (!file.endsWith('/package.json'))
    build.outputs.set(absolute(file), Buffer.from(bytes).toString('utf8'));
  let selectedRetention;
  if (publicRetention) {
    selectedRetention = releasePreparation?.publicRetention ?? compilePublicRetentionSdk(build, workspace, publicAi, platformApi, repo);
    if (!releaseInput) workspace = projectRentalDevelopmentWorkspace({ ...options, publicRetention: selectedRetention, publicAiDataSdk: workspace.publicAiDataSdk },
      workspace.platform, workspace.rental, platformApi);
    const selected = createBuild(deps, { publicAiDataSdk: workspace.publicAiDataSdk, publicRetention: selectedRetention, quiet: true, snapshot: snapshotFromFiles(commit,
      new Map([...workspace.files].map(([file, bytes]) => [absolute(file), bytes]))) });
    for (const name of ['outputs', 'virtual', 'selectedClients']) for (const [file, value] of build[name]) selected[name].set(file, value);
    selected.stages.push(...build.stages, ...selectedRetention.projects);
    selected.selectedClients.set(absolute(retentionSdk.owner), selections.rental);
    selected.compile(retentionSdk.owner + '/tsconfig.json');
    selected.compile('apps/rental-api/tsconfig.public-retention.json');
    build = selected;
  }
  const sourceBytes = workspace.files.get(sourceProvenanceFile);
  const compiled = bindFixedRuntime(build, workspace, sourceBytes, deployment.files, selections, platformBuild, releaseInput ? 'release' : 'development');
  const fixedBuild = trustedBuilds.get(compiled.sourceFiles);
  if (freshAi) fixedBuild.createFreshDeployment = createFreshDeployment;
  if (releaseInput) { fixedBuild.releaseArtifacts = releaseInput.artifacts; fixedBuild.portableCoreBuild = portable.evidence; }
  if (selectedRetention) fixedBuild.publicRetention = selectedRetention;
  if (workspace.publicAiDataSdk) fixedBuild.publicAiDataSdk = workspace.publicAiDataSdk;
  const context = createRentalHostContext({ ...compiled, aiMode: freshAi ? 'enabled' : 'disabled', platformFiles: workspace.platform.files,
    rentalFiles, deploymentFiles: deployment.files, dependencyDirectory: deps,
    ...(freshAi ? { freshAi: extension, aiFiles: publicAi.files } : {}),
    ...(mcpData ? { mcpEntry: 'apps/rental-api/dist-mcp/mcp-fresh-main.js', mcpFiles: mcpData.files } : {}) });
  return releaseInput ? { ...context, workspace, deployment, publicAi, publicRetention: selectedRetention } : context;
}

function collectInputs(options) {
  const defaultProvenance = path.join(root, sourceProvenanceFile);
  if (options.sourceProvenance) return collectFixedInputs(options);
  if (options.platformRepo || options.coreRepo || fs.existsSync(defaultProvenance))
    throw Error('双仓源码不能使用旧单仓打包入口；须提供来源回执和两个固定 Git 仓库');
  const api = publicApi(), sourceFiles = new Map([['package-lock.json', readOrdinary(path.join(root, 'package-lock.json'))],
    ['LICENSE', readOrdinary(path.join(root, 'LICENSE'))]]);
  const deploymentFiles = readTree(options.deployment, file => file === 'schema.prisma' || file === 'core.deployment.lock.json'
    || file === 'migrations/migration_lock.toml' || /^migrations\/[^/]+\/migration\.sql$/u.test(file));
  const lock = api.CoreDeploymentLockSchema.parse(JSON.parse(text(deploymentFiles, 'core.deployment.lock.json')));
  const platformFiles = api.readCoreArchive(readOrdinary(options.platformPackage, api.CORE_ARCHIVE_LIMITS.totalBytes), lock.platform.sha256).files;
  ordinaryDirectories(options.rentalPackage);
  const rentalFiles = api.readCorePackageFiles(options.rentalPackage, api.CORE_ARCHIVE_LIMITS.fileBytes, api.CORE_ARCHIVE_LIMITS.totalBytes);
  const ticketsFiles = options.ticketsPackage && api.readCorePackageFiles(options.ticketsPackage, api.CORE_ARCHIVE_LIMITS.fileBytes, api.CORE_ARCHIVE_LIMITS.totalBytes);
  const aiFiles = options.aiDataPackage && api.readPlatformDataCapabilityPackage(options.aiDataPackage, lock.dataCapabilities?.[0]).files;
  const workspaces = selectWorkspaces(JSON.parse(text(sourceFiles, 'package-lock.json')), directory => {
    const bytes = directory === 'packages/rental-core' ? rentalFiles.get('package.json')
      : directory === 'packages/example-tickets-core' && ticketsFiles ? ticketsFiles.get('package.json')
      : directory === 'packages/ai-native-data' && aiFiles ? aiFiles.get('package.json') : readOrdinary(path.join(root, directory, 'package.json'));
    if (!bytes) throw Error('固定包缺少正式 package.json');
    sourceFiles.set(directory + '/package.json', bytes); return JSON.parse(bytes.toString('utf8'));
  }, options.aiMode, options.host, { mcp: Boolean(options.mcpEntry) });
  for (const directory of workspaces.keys()) {
    if (directory === 'packages/rental-core' || directory === 'packages/example-tickets-core' && ticketsFiles
      || directory === 'packages/ai-native-data' && aiFiles) continue;
    const absolute = path.join(root, directory); ordinaryDirectories(absolute);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === 'dist-mcp' && !options.mcpEntry) continue;
      if (/^dist(?:-[a-z0-9-]+)?$/u.test(entry.name)) {
        if (entry.isSymbolicLink() || !entry.isDirectory()) throw Error('编译产物须为普通目录');
        for (const [file, bytes] of readTree(path.join(absolute, entry.name), file => /\.(?:js|cjs|json|d\.ts)$/u.test(file)))
          sourceFiles.set(directory + '/' + entry.name + '/' + file, bytes);
      } else if (['LICENSE', 'README.md'].includes(entry.name)) sourceFiles.set(directory + '/' + entry.name, readOrdinary(path.join(absolute, entry.name)));
    }
  }
  for (const file of ['prisma/schema.prisma', ...api.createPublicPlatformDataPlan().data.migrations.map(item => item.file)])
    sourceFiles.set('apps/platform-api/' + file, readOrdinary(path.join(root, 'apps/platform-api', file)));
  const selections = {};
  for (const [host, client] of [['rental', options.client], ['platform', options.platformClient]]) selections[host] = {
    client: path.resolve(client), declarations: readOrdinary(client).toString('utf8'), schema: readOrdinary(path.join(path.dirname(client), 'schema.prisma')).toString('utf8') };
  const requireDeps = createRequire(path.join(options.deps, 'typescript/package.json'));
  const ts = requireDeps('typescript');
  if (ts.version !== JSON.parse(text(sourceFiles, 'package-lock.json')).packages['node_modules/typescript']?.version)
    throw Error('静态解析器与本树原锁不一致');
  return { aiMode: options.aiMode, host: options.host,
    ...(options.mcpEntry ? { mcpEntry: path.relative(root, options.mcpEntry).split(path.sep).join('/') } : {}),
    sourceFiles, platformFiles, rentalFiles, ticketsFiles, aiFiles, deploymentFiles, selections, ts,
    dependencyDirectory: options.deps };
}

async function collectFixedInputs(options) {
  if (!options.platformRepo || !options.coreRepo) throw Error('双仓打包缺少固定底座或 Rental Git 仓库');
  if (options.host !== 'rental') throw Error('双仓打包暂只接受来源清单中的单 Rental 宿主');
  const sourceBytes = readOrdinary(options.sourceProvenance);
  const declared = JSON.parse(sourceBytes.toString('utf8'));
  const deploymentFiles = readTree(options.deployment, file => file === 'schema.prisma' || file === 'core.deployment.lock.json'
    || file === 'migrations/migration_lock.toml' || /^migrations\/[^/]+\/migration\.sql$/u.test(file));
  const proposedLock = JSON.parse(text(deploymentFiles, 'core.deployment.lock.json'));
  const declaredBase = proposedLock.lockVersion === 2 ? proposedLock.base : proposedLock;
  const platformSource = declaredBase.platform?.source;
  const rentalSource = declaredBase.cores?.find(pin => pin.manifest.id === 'rental')?.manifest.source;
  if (!platformSource || !rentalSource) throw Error('双仓打包缺少锁定的底座和 Rental 源码身份');
  const { compileFixedPlatformContracts, createRentalDevelopmentWorkspace } = require('./prepare-rental-workspace.cjs');
  const contracts = compileFixedPlatformContracts(options.platformRepo, platformSource.commit, options.deps, true);
  const load = name => contracts.load(contracts.exported(name, true));
  const api = { ...load('@rental-os/core-contracts'), ...load('@rental-os/core-contracts/archive'),
    ...load('@rental-os/core-contracts/package'), ...load('@rental-os/core-contracts/platform-data-package'),
    ...load('@rental-os/core-contracts/platform-source') };
  if (Boolean(options.freshAi) !== (proposedLock.lockVersion === 2)) throw Error('正式显式新装选择与部署锁版本不同');
  if (options.freshAi) {
    const phased = load('@rental-os/core-contracts/deployment').CorePhasedMigrationLockSchema.parse(proposedLock);
    const base = phased.base, rentalPin = base.cores.find(pin => pin.manifest.id === 'rental');
    const ai = base.dataCapabilities?.find(item => item.id === 'ai-native'), mcp = base.dataCapabilities?.find(item => item.id === 'mcp');
    if (!rentalPin || !ai || ai.sha256 !== options.aiDataSha256 || Boolean(mcp) !== Boolean(options.mcpEntry))
      throw Error('正式新装的 Core、AI 数据摘要或 MCP 选择不一致');
    const prepared = await prepareRentalReleaseWorkspace({ repo: options.platformRepo, repository: platformSource.repository,
      commit: platformSource.commit, coreRepo: options.coreRepo, coreCommit: rentalSource.commit, deps: options.deps,
      mode: 'release', profile: declared.profile, aiMode: options.aiMode, freshAi: true,
      publicRetention: options.publicRetention, mcp: Boolean(mcp), aiDataSha256: options.aiDataSha256,
      platformArchive: readOrdinary(options.platformPackage, api.CORE_ARCHIVE_LIMITS.totalBytes), platformSha256: base.platform.sha256,
      rentalArchive: readOrdinary(options.rentalArchive, api.CORE_ARCHIVE_LIMITS.totalBytes), rentalSha256: rentalPin.sha256 });
    if (!Buffer.from(prepared.workspace.files.get(sourceProvenanceFile)).equals(sourceBytes))
      throw Error('正式来源回执不是最终同版新装 workspace');
    const selectedCore = api.readCorePackageFiles(options.rentalPackage, api.CORE_ARCHIVE_LIMITS.fileBytes, api.CORE_ARCHIVE_LIMITS.totalBytes);
    if (materialIdentity(selectedCore) !== materialIdentity(prepared.rentalFiles)) throw Error('原 Rental 解包与正式归档不同');
    const selectedAi = api.readPlatformDataCapabilityPackage(options.aiDataPackage, ai);
    if (materialIdentity(selectedAi.files) !== materialIdentity(prepared.publicAi.files)) throw Error('原 AI 解包与正式数据发行不同');
    if (mcp) api.readPlatformDataCapabilityPackage(options.mcpDataPackage, mcp);
    const result = await packageRentalReleaseWorkspace(prepared, { deps: options.deps });
    if (materialIdentity(deploymentFiles) !== materialIdentity(result.deployment.files)
      || options.mcpEntry && path.relative(root, options.mcpEntry).split(path.sep).join('/') !== result.receipt.mcpEntry)
      throw Error('正式新装部署材料或入口不是实际同版构建结果');
    collectedReleaseContexts.add(result);
    return result;
  }
  if (options.mcpEntry) throw Error('原 v1 双仓发行不接受新装 MCP');
  const lock = api.CoreDeploymentLockSchema.parse(proposedLock);
  const workspace = await createRentalDevelopmentWorkspace({ repo: options.platformRepo, repository: platformSource.repository,
    commit: platformSource.commit, coreRepo: options.coreRepo, coreCommit: rentalSource.commit, deps: options.deps,
    mode: 'release', profile: declared.profile, ai: options.aiMode === 'enabled' }, api);
  requireHostSourceProvenance(sourceBytes, workspace.files.get('package-lock.json'), lock, options.host, options.aiMode);
  if (!Buffer.from(workspace.files.get(sourceProvenanceFile)).equals(sourceBytes))
    throw Error('双仓来源回执与固定 Git 源码组合不同');
  const platformArchive = readOrdinary(options.platformPackage, api.CORE_ARCHIVE_LIMITS.totalBytes);
  const platformFiles = api.readCoreArchive(platformArchive, lock.platform.sha256).files;
  if (!api.matchesInstalledCoreArchive(workspace.platform.files, lock.platform.sha256))
    throw Error('锁定底座源码归档与固定 Git 源码不同');
  const rentalFiles = api.readCorePackageFiles(options.rentalPackage, api.CORE_ARCHIVE_LIMITS.fileBytes, api.CORE_ARCHIVE_LIMITS.totalBytes);
  const aiFiles = options.aiDataPackage && api.readPlatformDataCapabilityPackage(options.aiDataPackage, lock.dataCapabilities?.[0]).files;
  const compiled = compileFixedRuntime({ workspace, sourceBytes, deploymentFiles, deps: options.deps, aiMode: options.aiMode,
    release: lock.platform, platformApi: api });
  return { ...compiled, aiMode: options.aiMode, host: options.host, dependencyDirectory: options.deps,
    platformFiles, rentalFiles, aiFiles, deploymentFiles };
}

function writeArchive(output, bytes) {
  const file = path.resolve(output); ordinaryDirectories(path.dirname(file));
  if (!file.endsWith('.tgz')) throw Error('输出须为新的 .tgz 文件');
  let descriptor, identity, offset = 0, completed = false;
  try {
    descriptor = fs.openSync(file, 'wx'); identity = fs.fstatSync(descriptor);
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (!written) throw Error('归档写入未前进');
      offset += written;
    }
    fs.closeSync(descriptor); descriptor = undefined;
    ordinaryDirectories(path.dirname(file));
    const current = fs.lstatSync(file);
    if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
      || current.birthtimeMs !== identity.birthtimeMs || hash(readOrdinary(file, 128 * 1024 * 1024)) !== hash(bytes)) throw Error('输出身份或内容变化');
    completed = true;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (identity && !completed) {
      ordinaryDirectories(path.dirname(file)); const current = fs.lstatSync(file);
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.birthtimeMs !== identity.birthtimeMs)
        throw Error('输出身份变化，停止清理');
      // A different writer can change bytes without replacing the file.
      if (current.size !== offset || !readOrdinary(file, offset).equals(bytes.subarray(0, offset)))
        throw Error('输出内容变化，停止清理');
      fs.unlinkSync(file);
    }
  }
}

function main(args) {
  if (args[0] === '--development') return packageDevelopment(args.slice(1));
  const options = parseArguments(args);
  ordinaryDirectories(path.dirname(options.output));
  if (fs.existsSync(options.output)) throw Error('目标归档已存在，不覆盖用户产物');
  if (within(path.join(root, 'docs'), options.output)) throw Error('发行产物不能写入私有资料目录');
  const pack = input => {
    const result = collectedReleaseContexts.has(input) ? input : createRentalHostContext(input); writeArchive(options.output, result.bytes);
    return { status: 'packaged', aiMode: options.aiMode, ...(result.receipt.mcpEntry ? { mcpEntry: result.receipt.mcpEntry } : {}),
      output: options.output, sha256: result.sha256,
      deploymentProvenance: { file: result.receipt.deploymentProvenance,
        sha256: hash(result.files.get(result.receipt.deploymentProvenance)) },
      ...(result.receipt.sourceProvenance ? { sourceProvenance: result.receipt.sourceProvenance, buildProvenance: result.receipt.buildProvenance } : {}),
      files: result.files.size, bytes: result.bytes.length, imageBuild: 'not-run', deployment: 'pending' };
  };
  const input = collectInputs(options);
  return options.sourceProvenance ? input.then(pack) : pack(input);
}

async function packageDevelopment(args) {
  const options = {}, names = { '--repo': 'repo', '--repository': 'repository', '--commit': 'commit',
    '--core-repo': 'coreRepo', '--core-commit': 'coreCommit', '--deps': 'deps', '--output': 'output' };
  if (args[0] === '--fresh-ai') { options.freshAi = true; args = args.slice(1); }
  if (args[0] === '--mcp') { options.mcp = true; args = args.slice(1); }
  if (args[0] === '--public-retention') { options.publicRetention = true; args = args.slice(1); }
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], name = names[flag], value = args[index + 1];
    if (!Object.hasOwn(names, flag) || !value || value.startsWith('--') || Object.hasOwn(options, name))
      throw Error('未知、重复或缺少值的开发宿主选项');
    options[name] = value;
  }
  if (!options.repo || !options.repository || !options.coreRepo || !/^[a-f0-9]{40}$/u.test(options.commit ?? '')
    || !/^[a-f0-9]{40}$/u.test(options.coreCommit ?? '') || !path.isAbsolute(options.output ?? '')
    || options.deps && !path.isAbsolute(options.deps)) throw Error('开发宿主须指定双仓目录、底座仓库地址、两个完整提交和新归档绝对路径');
  if (!options.output.endsWith('.tgz') || within(path.join(root, 'docs'), options.output) || fs.existsSync(options.output))
    throw Error('输出须为私有资料目录之外、尚不存在的 .tgz 文件');
  ordinaryDirectories(path.dirname(options.output));
  const result = await prepareRentalDevelopmentHost({ ...options, deps: options.deps ?? path.resolve(options.repo, 'node_modules') });
  writeArchive(options.output, result.bytes);
  return { status: 'packaged', sourceMode: 'development', releaseApproved: false, serverUpdateEligible: false,
    output: options.output, files: result.files.size, bytes: result.bytes.length, sha256: result.sha256, deployment: 'pending' };
}
if (require.main === module) {
  Promise.resolve().then(() => main(process.argv.slice(2)))
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
    .catch(error => { process.stderr.write((error instanceof Error ? error.message : '独立宿主打包失败') + '\n'); process.exitCode = 1; });
}
module.exports = { parseArguments, createRentalHostContext, collectInputs, checkRuntimeClosure,
  readOrdinary, readTree, createRuntimeVerifier, describeRentalDeployment, requireHostSourceProvenance, writeArchive, prepareRentalDevelopmentHost, prepareRentalReleaseWorkspace, packageRentalReleaseWorkspace, main };
