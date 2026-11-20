'use strict';
/** 公共 API 与显式工单示范的离线运行包。复用原源码编译、npm 锁投影、迁移生成及归档写入，
 * 默认仅六公共后端包，工单模式追加原完整标准包和静态宿主；只使用唯一公共 Client。
 * 不读取环境文件、不安装/启动/联网、不执行迁移，配置和数据库准备始终另行办理。 */
const fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const { selectedCompilerOptions } = require('./build-selected-prisma.cjs');
const { compileRentalPlatformSource, requireMatchingPublicRuntime, publicDirectories } = require('./rental-platform-build.cjs');
const { selectWorkspaces, projectHostLock, lockedDependency, hostDirectory } = require('./rental-host-lock.cjs');
const { readOrdinary, readTree, checkRuntimeClosure, createRuntimeVerifier, writeArchive } = require('./package-rental-host.cjs');
const root = path.resolve(__dirname, '..'), host = 'apps/platform-api';
const clientDirectory = host + '/generated/client', receiptFile = 'platform-host.context.json';
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');
const required = (files, file) => {
  const bytes = files.get(file);
  if (!bytes?.byteLength) throw Error('公共宿主缺少实际材料：' + file);
  return Buffer.from(bytes);
};
const text = (files, file) => required(files, file).toString('utf8');
function hostProfile(name = 'platform') {
  if (!['platform', 'example-tickets'].includes(name)) throw Error('未登记的公共宿主组合：' + name);
  const directory = hostDirectory(name), tickets = name === 'example-tickets';
  return { name, directory, tickets, entry: directory + '/dist/main.js',
    deploymentDirectory: directory + (tickets ? '/prisma-deployment' : '/prisma'),
    lockVariable: tickets ? 'CORE_DEPLOYMENT_LOCK' : 'CORE_DEPLOYMENT_LOCK_FILE',
    workspaces: [...publicDirectories, ...(tickets ? [directory, 'packages/example-tickets-core'] : [])] };
}
function requireSelection(lock, profile, ticketsFiles) {
  if (profile.tickets) {
    if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== 'example-tickets'
      || lock.dataCapabilities?.length || !ticketsFiles) throw Error('工单宿主须只选择一个完整工单包且无选装数据能力');
  } else if (lock.cores.length || lock.dataCapabilities?.length || ticketsFiles)
    throw Error('公共宿主部署锁须为零 Core 且无选装数据能力');
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--host', '--lock', '--platform-package', '--platform-client', '--tickets-package', '--output', '--deps'].includes(key)
      || Object.hasOwn(values, key) || !value || value.startsWith('--')) throw Error('未知、重复或缺值的公共宿主选项：' + key);
    if (key !== '--host' && !path.isAbsolute(value)) throw Error(key + ' 须为显式绝对路径');
    values[key] = value;
  }
  const profile = hostProfile(values['--host']);
  if (profile.tickets !== Boolean(values['--tickets-package'])) throw Error('只有工单宿主须显式提供 --tickets-package');
  for (const key of ['--lock', '--platform-package', '--platform-client', '--output'])
    if (!values[key]) throw Error('公共宿主须提供 ' + key + ' 的显式绝对路径');
  if (!values['--lock'].endsWith('.json')) throw Error('--lock 须为所选宿主完整部署锁 JSON');
  if (!values['--platform-package'].endsWith('.tgz') || !values['--output'].endsWith('.tgz'))
    throw Error('底座标准包和新输出须为 .tgz 文件');
  return { host: profile.name, ticketsPackage: values['--tickets-package'],
    lock: values['--lock'], platformPackage: values['--platform-package'], platformClient: values['--platform-client'],
    output: values['--output'], deps: values['--deps'] || path.join(root, 'node_modules') };
}

function publicApi() {
  // 只加载本树已构建的公共正式模块，不运行调用方归档内的代码或业务宿主。
  return { ...require('@rental-os/core-contracts'), ...require('@rental-os/core-contracts/archive'),
    ...require('@rental-os/core-contracts/platform-source'), ...require('@rental-os/core-contracts/deployment'),
    ...require('@rental-os/core-contracts/package'),
    ...require('@rental-os/platform-core-host/core-package-preflight'), ...require('@rental-os/platform-api/data-plan') };
}

function requirePublicWorkspaces(lock, readMetadata, profile) {
  const workspaces = selectWorkspaces(lock, directory => {
    if (!profile.workspaces.includes(directory)) throw Error('公共宿主不能带入未选工作区：' + directory);
    return readMetadata(directory);
  }, 'disabled', profile.name);
  if (workspaces.size !== profile.workspaces.length || profile.workspaces.some(directory => !workspaces.has(directory)))
    throw Error('公共宿主工作区与显式组合不一致');
  return workspaces;
}

const dockerfile = profile => `# 目标 Linux 构建才安装原锁依赖并生成公共 Client；打包器不执行这些命令。
FROM node:24.13.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
FROM base AS clients
COPY . .
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund
RUN DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline node node_modules/prisma/build/index.js generate --schema apps/platform-api/prisma/schema.prisma
FROM base AS runtime
ENV NODE_ENV=production ${profile.lockVariable}=/app/${profile.deploymentDirectory}/core.deployment.lock.json
COPY . .
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=clients /app/apps/platform-api/generated/client ./apps/platform-api/generated/client
RUN node verify-runtime.cjs
USER node
EXPOSE 3000
CMD ["node", "${profile.entry}"]
`;

function createPlatformHostContext(input) {
  const api = publicApi(), { sourceFiles, platformFiles, selection, ts } = input;
  const profile = hostProfile(input.host), { entry } = profile;
  const deploymentLockFile = profile.deploymentDirectory + '/core.deployment.lock.json';
  const lock = api.CoreDeploymentLockSchema.parse(input.lock);
  requireSelection(lock, profile, input.ticketsFiles);
  if (lock.platform.versions.node !== '24.13.0' || lock.platform.versions.contract !== api.CORE_CONTRACT_VERSION)
    throw Error('公共宿主锁须与实际合同和目标 Node 24.13.0 一致');
  const schema = text(platformFiles, host + '/prisma/schema.prisma');
  if (schema !== text(sourceFiles, host + '/prisma/schema.prisma')) throw Error('实际公共 schema 与固定底座不同');
  if (!selection || path.resolve(selection.client) !== path.join(root, clientDirectory, 'index.d.ts'))
    throw Error('公共宿主须选择本树唯一 generated/client/index.d.ts');
  const read = file => path.resolve(file) === path.resolve(selection.client) ? selection.declarations
    : path.resolve(file) === path.join(root, clientDirectory, 'schema.prisma') ? selection.schema : undefined;
  const checked = selectedCompilerOptions(ts, path.join(root, host, 'tsconfig.json'), {},
    { client: selection.client, mode: 'platform' }, read);
  if (selection.schema !== schema) throw Error('公共 Client 与固定公共 schema 不一致');
  const plan = api.createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(plan.data, lock.platform.data)) throw Error('公共数据计划与完整发行锁不一致');
  const migrations = plan.migrationNames.map((name, index) => {
    const file = host + '/' + plan.data.migrations[index].file, sql = required(platformFiles, file);
    if (!sql.equals(required(sourceFiles, file))) throw Error('实际公共迁移与固定底座不同：' + file);
    return { name, sql };
  });
  const deploymentFiles = new Map(api.createCoreMigrationDeployment({ lock, platform: migrations,
    cores: new Map(profile.tickets ? [['example-tickets', input.ticketsFiles]] : []),
    ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: new Map() }) }));
  deploymentFiles.set('schema.prisma', Buffer.from(schema));
  const originalLock = JSON.parse(text(sourceFiles, 'package-lock.json'));
  const sourceLock = JSON.parse(text(platformFiles, 'package-lock.json'));
  const identity = value => { const { dev, optional, devOptional, peer, ...result } = value || {}; return result; };
  for (const [file, value] of Object.entries(sourceLock.packages)) if (file.includes('node_modules/') && !value.link
    && !isDeepStrictEqual(identity(value), identity(originalLock.packages[file])))
    throw Error('公共宿主原依赖锁与固定底座不同：' + file);
  const workspaces = requirePublicWorkspaces(originalLock, directory => JSON.parse(text(
    publicDirectories.includes(directory) ? platformFiles : directory === 'packages/example-tickets-core'
      ? new Map([[directory + '/package.json', input.ticketsFiles.get('package.json')]]) : sourceFiles,
    directory + '/package.json')), profile);
  const files = new Map();
  for (const directory of publicDirectories) {
    for (const [file, bytes] of sourceFiles) if (file.startsWith(directory + '/dist/')) {
      if (!/^dist\/.*\.(?:js|cjs|json|d\.ts)$/u.test(file.slice(directory.length + 1)))
        throw Error('公共运行目录包含未声明格式：' + file);
      files.set(file, Buffer.from(bytes));
    }
    files.set(directory + '/package.json', required(platformFiles, directory + '/package.json'));
    files.set(directory + '/LICENSE', platformFiles.has(directory + '/LICENSE')
      ? required(platformFiles, directory + '/LICENSE') : required(platformFiles, 'LICENSE'));
  }
  if (profile.tickets) {
    for (const [file, bytes] of input.ticketsFiles) files.set('packages/example-tickets-core/' + file, Buffer.from(bytes));
    files.set(profile.directory + '/package.json', required(sourceFiles, profile.directory + '/package.json'));
    files.set(profile.directory + '/LICENSE', required(platformFiles, 'LICENSE'));
    for (const [file, bytes] of sourceFiles) if (file.startsWith(profile.directory + '/dist/')) {
      if (!/^dist\/.*\.(?:js|cjs|json|d\.ts)$/u.test(file.slice(profile.directory.length + 1)))
        throw Error('工单宿主运行产物包含未声明格式：' + file);
      files.set(file, Buffer.from(bytes));
    }
    // 公共数据观察从公共模块的原目录读取；组合部署目录另保留完整、有序迁移材料。
    files.set(host + '/prisma/schema.prisma', Buffer.from(schema));
    for (const migration of lock.platform.data.migrations) files.set(host + '/' + migration.file, required(platformFiles, host + '/' + migration.file));
  }
  for (const [file, bytes] of deploymentFiles) files.set(profile.deploymentDirectory + '/' + file, Buffer.from(bytes));
  files.set('LICENSE', required(platformFiles, 'LICENSE'));
  const runtime = checkRuntimeClosure(files, workspaces, originalLock, entry, ts, { expectedClients: [clientDirectory] });
  const projected = projectHostLock(originalLock, workspaces, 'disabled', runtime.runtimePeers, profile.name);
  for (const item of runtime.resolutions) if (!item.specifier.startsWith('.') && !item.specifier.startsWith('@rental-os/')) {
    const name = item.specifier.startsWith('@') ? item.specifier.split('/').slice(0, 2).join('/') : item.specifier.split('/')[0];
    const owner = [...workspaces.keys()].find(directory => item.from.startsWith(directory + '/'));
    const dependency = projected.lock.packages[lockedDependency(projected.lock, owner, name)];
    if (!dependency || dependency.dev) throw Error('公共运行依赖不在生产锁闭包：' + name);
  }
  const build = compileRentalPlatformSource({ platformFiles, release: lock.platform, selection,
    dependencyDirectory: input.dependencyDirectory, ts, api });
  requireMatchingPublicRuntime(sourceFiles, platformFiles, build);
  for (const [file, bytes] of build.generated) files.set(file, bytes);
  files.set('package.json', json(projected.root)); files.set('package-lock.json', json(projected.lock));
  files.set('Dockerfile', Buffer.from(dockerfile(profile)));
  files.set('.dockerignore', Buffer.from('**/node_modules\n**/generated\n**/.git\n**/.env\n**/.env.*\ndocs\noutput\n'));
  files.set('verify-runtime.cjs', Buffer.from(createRuntimeVerifier(receiptFile)));
  files.set('README.md', Buffer.from('# ' + (profile.tickets ? '公共底座与工单 Core' : '零 Core 公共 API') + ' 运行上下文\n\n' +
    '六个公共后端包从固定底座源码按原配置重新编译并逐字节核同；platform-host.context.json 记录发行、原锁、编译输入和产物摘要。' +
    (profile.tickets ? '工单完整标准包与部署锁逐字节核同，raw SQL 沿原工单迁移；只有公共40模型 Client，无 Rental 或 AI。\n\n'
      : '只含公共 schema 与原迁移链，未选装 Core 或 AI。\n\n') +
    '目标 Linux 环境执行 `docker build --target runtime -t platform-host .`，构建按原 npm 锁安装依赖并使用 Prisma 5.22.0 生成唯一公共 Client。当前未执行镜像构建、安装或下载；外部来源与实际镜像构建由部署环境验证。\n\n' +
    '启动固定为 `node ' + entry + '`。部署方提供 DATABASE_URL、AUTH_TOKEN_SECRET 及所需原集成配置，按原迁移账办理新库准备；已有 Rental 组合库不能直接应用公共基线。候选目录为 ' + profile.deploymentDirectory + '，锁和 SQL 不是已执行迁移收据。\n\n' +
    '版本与候选材料读取另由部署方配置 CORE_PACKAGE_STORAGE_ROOT、CORE_PLATFORM_PACKAGE_REFERENCE，并在该存储的 archives/index.json 登记同一固定底座完整源码归档。' + profile.lockVariable + ' 已指向包内固定锁；配置、实际迁移及物理结构仍须核定。\n\n' +
    '本包不含公共 Web。打包/镜像预检不启动应用或办理数据库、邮件、模型等业务动作；imageBuild=not-run、configuration=pending、deployment=pending。\n'));
  const receipt = { format: 'platform-host-context-1', host: profile.name, imageBuild: 'not-run', configuration: 'pending', deployment: 'pending',
    ...(profile.tickets ? { corePackages: [{ id: 'example-tickets', sha256: lock.cores[0].sha256 }] } : {}),
    target: 'linux-bookworm', prismaVersion: '5.22.0', entry,
    clients: [{ directory: clientDirectory, mode: 'platform', models: checked.models, schemaSha256: hash(Buffer.from(schema)) }],
    deploymentLockSha256: hash(files.get(deploymentLockFile)), originalNpmLockSha256: hash(sourceFiles.get('package-lock.json')),
    platformBuild: build.evidence, runtime,
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => ({ file, sha256: hash(bytes) })) };
  files.set(receiptFile, json(receipt));
  return { files, receipt, ...api.createCoreArchive(files) };
}

function collectInputs(options) {
  const api = publicApi(), lock = api.CoreDeploymentLockSchema.parse(JSON.parse(readOrdinary(options.lock).toString('utf8')));
  const profile = hostProfile(options.host);
  const ticketsFiles = options.ticketsPackage ? api.readCorePackageFiles(options.ticketsPackage,
    api.CORE_ARCHIVE_LIMITS.fileBytes, api.CORE_ARCHIVE_LIMITS.totalBytes) : undefined;
  requireSelection(lock, profile, ticketsFiles);
  const platformFiles = api.readCoreArchive(readOrdinary(options.platformPackage, api.CORE_ARCHIVE_LIMITS.totalBytes), lock.platform.sha256).files;
  const sourceFiles = new Map([['package-lock.json', readOrdinary(path.join(root, 'package-lock.json'))]]);
  requirePublicWorkspaces(JSON.parse(text(sourceFiles, 'package-lock.json')), directory => {
    const bytes = directory === 'packages/example-tickets-core' ? required(ticketsFiles, 'package.json')
      : readOrdinary(path.join(root, directory, 'package.json'));
    sourceFiles.set(directory + '/package.json', bytes); return JSON.parse(bytes.toString('utf8'));
  }, profile);
  for (const directory of profile.workspaces.filter(directory => directory !== 'packages/example-tickets-core')) {
    for (const folder of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) if (/^dist(?:-[a-z0-9-]+)?$/u.test(folder.name)) {
      if (folder.isSymbolicLink() || !folder.isDirectory()) throw Error('公共编译产物须为普通目录');
      for (const [file, bytes] of readTree(path.join(root, directory, folder.name), file => /\.(?:js|cjs|json|d\.ts)$/u.test(file)))
        sourceFiles.set(directory + '/' + folder.name + '/' + file, bytes);
    }
  }
  for (const file of ['prisma/schema.prisma', ...api.createPublicPlatformDataPlan().data.migrations.map(item => item.file)])
    sourceFiles.set(host + '/' + file, readOrdinary(path.join(root, host, file)));
  const selection = { client: options.platformClient, declarations: readOrdinary(options.platformClient).toString('utf8'),
    schema: readOrdinary(path.join(path.dirname(options.platformClient), 'schema.prisma')).toString('utf8') };
  const ts = createRequire(path.join(options.deps, 'typescript/package.json'))('typescript');
  return { host: profile.name, ticketsFiles, lock, sourceFiles, platformFiles, selection, ts, dependencyDirectory: options.deps };
}

function main(args) {
  const options = parseArguments(args);
  const relative = path.relative(path.join(root, 'docs'), options.output);
  if (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
    throw Error('公共运行包不能写入私有资料目录');
  if (fs.existsSync(options.output)) throw Error('目标归档已存在，不覆盖用户产物');
  const result = createPlatformHostContext(collectInputs(options)); writeArchive(options.output, result.bytes);
  return { status: 'packaged', host: options.host, output: options.output, sha256: result.sha256,
    files: result.files.size, bytes: result.bytes.length, imageBuild: 'not-run', configuration: 'pending', deployment: 'pending' };
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n'); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : '公共宿主打包失败') + '\n'); process.exitCode = 1; }
}
module.exports = { parseArguments, createPlatformHostContext, collectInputs, main };
