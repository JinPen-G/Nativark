'use strict';
/** 从固定 Zelo Git 对象准备零 Core、公共 AI 管理组合。只在内存编译和打包，
 * 输出原锁投影、正式 SDK、原 SQL 及待部署 schema；不运行安装、服务或迁移。 */
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { compileFixedPlatformContracts } = require('./prepare-rental-workspace.cjs');
const { readBuildSnapshot, snapshotFromFiles } = require('./rental-build-snapshot.cjs');
const { createBuild } = require('./check-rental-package-build.cjs');
const { generatePrismaDeclarations } = require('./verify-rental-distribution.cjs');
const { createMemoryBuild } = require('./rental-build-memory.cjs');
const { projectWorkspaceLock } = require('./rental-host-lock.cjs');
const { writeArchive } = require('./package-rental-host.cjs');

const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(root, file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJson = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const kinds = ['data', 'server', 'admin'];
const sdk = kind => 'packages/ai-native-' + kind;
const publicProjects = ['platform-contracts', 'core-contracts', 'core-host', 'platform-server', 'platform-core-host'];

async function preparePlatformPublicAi({ repo, repository, commit, deps }) {
  const seed = compileFixedPlatformContracts(repo, commit, deps, true);
  const bootstrap = name => seed.load(seed.exported('@rental-os/core-contracts/' + name, true));
  const archive = bootstrap('archive'), platform = await bootstrap('platform-source').readPlatformSourceFromGit(repo, { repository, commit });
  if (['apps/platform-api/src/ai-main.ts', 'apps/platform-api/src/ai-access.ts', 'apps/platform-admin/src/start-ai.tsx']
    .some(file => !platform.files.has(file))) throw Error('固定底座尚未包含公共 AI API、授权和 Web 选装入口');
  const snapshot = readBuildSnapshot(commit, repo, ['package-lock.json', ...kinds.map(sdk)]);
  const originalLockBytes = snapshot.files.get(slash('package-lock.json')), originalLock = readJson(originalLockBytes);
  const raw = new Map([...platform.files].map(([file, bytes]) => [slash(file), bytes]));
  for (const [file, bytes] of snapshot.files) raw.set(file, bytes);
  const build = createBuild(deps, { snapshot: snapshotFromFiles(commit, raw), quiet: true });
  const factoryFile = slash(sdk('server') + '/public-package.cjs');
  const factory = { exports: {} };
  new Function('module', 'require', Buffer.from(raw.get(factoryFile)).toString('utf8'))(factory, createRequire(factoryFile));
  const { assemblePublicAiPackage, publicAiClientPaths } = factory.exports;
  for (const name of publicProjects) build.compile('packages/' + name + '/tsconfig.json');
  const load = name => build.load(build.exported('@rental-os/' + name, true));
  const source = platform.source, schema = Buffer.from(platform.files.get('apps/platform-api/prisma/schema.prisma')).toString('utf8');
  const sources = directory => new Map([...raw].filter(([file]) => file.startsWith(slash(directory) + '/'))
    .map(([file, bytes]) => [file.slice(slash(directory).length + 1), bytes]));
  const compileSdk = (kind, options = {}) => {
    const directory = sdk(kind), prefix = slash(directory + '/dist-public') + '/';
    const emitted = kind === 'admin' ? new Map() : new Map([...build.compile(directory + '/tsconfig.public.json', options).emitted]
      .filter(([file]) => file.startsWith(prefix)).map(([file, text]) => [file.slice(prefix.length), Buffer.from(text)]));
    const files = assemblePublicAiPackage(kind, sources(directory), emitted, build.ts);
    return { files, archive: archive.createCoreArchive(files), metadata: readJson(files.get('package.json')) };
  };
  const data = compileSdk('data');
  const dataRoot = slash(sdk('data'));
  for (const [file, bytes] of data.files) if (file.startsWith('dist/')) build.outputs.set(dataRoot + '/' + file, bytes.toString('utf8'));
  build.packages.set(data.metadata.name, { directory: dataRoot, metadata: data.metadata });
  const publicData = load('ai-native-data/public-data-package').createPublicAiDataRelease({ files: new Map([...data.files,
    ['README.public.md', sources(sdk('data')).get('README.public.md')]]), source });
  const dataApi = load('ai-native-data/public-data');
  const selectedSchema = dataApi.composePublicAiPrismaSchema(schema, dataApi.createPublicAiDataContribution(publicData.files));
  generatePrismaDeclarations(build, [['public', selectedSchema]]);
  const client = slash('apps/platform-api/generated/client/index.d.ts');
  const server = compileSdk('server', { paths: publicAiClientPaths(build.ts, client, selectedSchema,
    file => build.virtual.get(slash(file))) });
  const admin = compileSdk('admin');
  const files = new Map(platform.files), metadata = new Map(platform.workspaces.map(({ path: directory }) =>
    [directory, readJson(files.get(directory + '/package.json'))]));
  // This is no longer the default platform export; its receipt belongs to the
  // unmodified base archive pinned below, not to the selected workspace.
  files.delete('platform.source.json');
  const packages = [[sdk('data'), data], [sdk('server'), server], [sdk('admin'), admin]];
  for (const [directory, entry] of packages) {
    metadata.set(directory, entry.metadata);
    for (const [file, bytes] of entry.files) files.set(directory + '/' + file, bytes);
  }
  const api = metadata.get('apps/platform-api'), web = metadata.get('apps/platform-admin');
  api.dependencies = { ...api.dependencies, [data.metadata.name]: data.metadata.version, [server.metadata.name]: server.metadata.version };
  web.dependencies = { ...web.dependencies, [admin.metadata.name]: admin.metadata.version };
  for (const directory of ['apps/platform-api', 'apps/platform-admin']) files.set(directory + '/package.json', json(metadata.get(directory)));
  const baseRoot = readJson(platform.files.get('package.json'));
  const projected = projectWorkspaceLock(originalLock, metadata, { ...baseRoot, name: 'zelo-public-ai', private: true,
    workspaces: [...metadata.keys()], dependencies: { ...baseRoot.dependencies,
      ...Object.fromEntries([...metadata.values()].map(pkg => [pkg.name, pkg.version])) },
    scripts: { ...baseRoot.scripts,
      'db:generate': 'prisma generate --schema apps/platform-api/prisma-deployment/schema.prisma',
      'build:api': 'npm run build -w @rental-os/platform-api && npm run build:ai -w @rental-os/platform-api',
      'build:admin': 'npm run build -w @rental-os/platform-core-host && npm run build:ai -w @rental-os/platform-admin-app',
      lint: 'tsc -p apps/platform-api/tsconfig.ai.json --noEmit && tsc -p apps/platform-admin/tsconfig.ai.json',
      'check:types': 'npm run lint',
      'start': 'npm run start:ai -w @rental-os/platform-api',
      'dev': 'vite apps/platform-admin --config apps/platform-admin/vite.config.ts --mode public-ai --host 127.0.0.1 --strictPort',
      'db:migrate:deploy': 'prisma migrate deploy --schema apps/platform-api/prisma-deployment/schema.prisma',
      'db:initialize': 'npm run initialize -w @rental-os/platform-api',
      'grant:ai': 'npm run grant:ai -w @rental-os/platform-api --' } }, { verifySpecifications: true });
  files.set('package.json', json(projected.root));
  files.set('package-lock.json', json(projected.lock));
  // Check the exact SDK files and dependencies the consumer will install. Do
  // not resolve the Web or API host against the author SDKs before packaging.
  const selectedFiles = new Map([...files].map(([file, bytes]) => [slash(file), bytes]));
  const host = createBuild(deps, { snapshot: snapshotFromFiles(commit, selectedFiles), quiet: true });
  for (const [file, text] of build.virtual) host.virtual.set(file, text);
  for (const [file, text] of build.outputs) if (publicProjects.some(name => file.startsWith(slash('packages/' + name + '/dist') + '/')))
    host.outputs.set(file, text);
  for (const [directory, pkg] of packages) for (const [file, bytes] of pkg.files) if (file.startsWith('dist/'))
    host.outputs.set(slash(directory + '/' + file), bytes.toString('utf8'));
  const paths = publicAiClientPaths(host.ts, client, selectedSchema, file => host.virtual.get(slash(file)));
  host.compile('apps/platform-api/tsconfig.json', { paths });
  host.compile('apps/platform-api/tsconfig.ai.json', { paths });
  host.compile('apps/platform-admin/tsconfig.ai.json');
  const platformBuild = createMemoryBuild(host);
  const plan = platformBuild.load(slash('apps/platform-api/dist/platform-data.js')).createPublicPlatformDataPlan();
  const platformPin = { versions: { platform: platform.version, contract: seed.load(seed.exported('@rental-os/core-contracts', true)).CORE_CONTRACT_VERSION,
    node: '24.13.0', capabilities: {} }, source, sha256: archive.createCoreArchive(platform.files).sha256, data: plan.data };
  const lock = { lockVersion: 1, platform: platformPin, cores: [], dataCapabilities: [publicData.release] };
  const migrationApi = load('core-contracts/deployment');
  const deployment = new Map(migrationApi.createCoreMigrationDeployment({ lock, cores: new Map(),
    platform: plan.migrationNames.map((name, index) => ({ name, sql: platform.files.get('apps/platform-api/' + plan.data.migrations[index].file) })),
    dataCapabilities: new Map([['ai-native', publicData.files]]) }));
  deployment.set('schema.prisma', Buffer.from(selectedSchema));
  for (const [file, bytes] of deployment) files.set('apps/platform-api/prisma-deployment/' + file, bytes);
  for (const [file, bytes] of publicData.files) files.set('public-ai-data/' + file, bytes);
  files.set('README.md', Buffer.from('# Zelo 公共 AI 管理组合\n\n' +
    '这是零 Core 的新装组合，使用 Node 24.13.0。运行 `npm ci`、`npm run db:generate` 和 `npm run build`。\n\n' +
    '`apps/platform-api/prisma-deployment` 是待部署材料，`public-ai-data` 是固定数据包。' +
    '在专用新库按 [选装 API](apps/platform-api/README.md#选装公共-ai-管理) 设置部署锁、初始化并显式授予选定 SaaS 角色；' +
    '配套 Web 见 [后台说明](apps/platform-admin/README.md#选装公共-ai-管理)。\n\n' +
    '组合来源、选装 SDK、迁移锁与文件摘要见 `public-ai.workspace.json`。旧混合库沿用原发行与原账。\n'));
  const evidence = { format: 'zelo-platform-public-ai-1', source, platform: platformPin, deployment: 'pending',
    npmLocks: { original: hash(originalLockBytes), projected: hash(files.get('package-lock.json')) },
    sdk: packages.map(([, pkg]) => ({ name: pkg.metadata.name, version: pkg.metadata.version, sha256: pkg.archive.sha256 })),
    data: publicData.release, schemaSha256: hash(selectedSchema), deploymentLockSha256: hash(deployment.get('core.deployment.lock.json')),
    projects: [...build.stages, ...host.stages], files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([file, bytes]) => ({ file, bytes: bytes.byteLength, sha256: hash(bytes) })) };
  files.set('public-ai.workspace.json', json(evidence));
  return { files, archive: archive.createCoreArchive(files), evidence };
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = args.slice(index, index + 2), name = flag.slice(2);
    if (!['--repo', '--repository', '--commit', '--deps', '--out'].includes(flag)
      || !value || value.startsWith('--') || Object.hasOwn(options, name)) throw Error('未知、重复或缺值的公共 AI 准备参数');
    options[name] = value;
  }
  if (!options.repo || !options.repository || !options.commit || !path.isAbsolute(options.out ?? ''))
    throw Error('须提供 --repo、--repository、--commit 和 --out <新归档绝对路径>');
  const result = await preparePlatformPublicAi({ ...options, deps: options.deps ?? path.join(options.repo, 'node_modules') });
  const relative = path.relative(root, options.out);
  if (relative.split(path.sep)[0]?.toLowerCase() === 'docs') throw Error('发行归档不能写入私有资料目录');
  writeArchive(options.out, result.archive.bytes);
  return { source: result.evidence.source, output: options.out, files: result.files.size,
    sha256: result.archive.sha256, deployment: 'pending' };
}

if (require.main === module) main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { preparePlatformPublicAi };
