'use strict';
/** 从固定底座和独立 Rental Git 提交准备开发源码工作区。
 * 保留原源码、所选构建脚本和 npm 锁；不读取环境、安装依赖、生成 Client 或执行部署。
 * 输出与零 Core 底座发行分开，Core 可在自己的仓库单独提交、打标签和重新准备。
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readBuildSnapshot, snapshotFromFiles, assertSourcePath, selections } = require('./rental-build-snapshot.cjs');
const { projectWorkspaceLock, mergeSourceLocks } = require('./rental-host-lock.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const coreDirectory = 'packages/rental-core';
const supportWorkspaces = ['packages/shared', 'packages/web-client', 'packages/ai-native-admin'];
const rentalApps = ['apps/rental-api', 'apps/rental-admin', 'apps/tenant-website', 'apps/enterprise-portal',
  'apps/miniprogram', 'apps/staff-miniprogram', 'apps/example-multi-core-api', 'apps/example-multi-core-admin'];
const layoutFile = 'rental.source.json';
const historicalRepository = 'https://github.com/JinPen-G/nativark-rental-core';
const renamedRepository = 'https://github.com/JinPen-G/Zelo-rental-core';
const rootLayout = { format: 'rental-source-layout-1', paths: [{ source: '.', target: coreDirectory,
  roles: ['domain'],
  required: ['package.json', 'LICENSE', 'tsconfig.json', 'tsconfig.contracts.json', 'src/index.ts', 'src/server.ts', 'prisma/schema.prisma'] }] };
const rentalOwned = file => /^packages\/rental-[^/]+(?:\/|$)/u.test(file)
  || rentalApps.some(directory => file === directory || file.startsWith(directory + '/'));
const supportScripts = [
  'scripts/prepare-selected-prisma-schema.cjs', 'scripts/miniprogram-shared-types.cjs',
  'scripts/miniprogram-ai-runtime.cjs', 'scripts/rental-client-vite.ts',
  'scripts/check-rental-package-build.cjs', 'scripts/rental-build-memory.cjs',
  'scripts/rental-build-snapshot.cjs', 'scripts/verify-rental-distribution.cjs',
  'scripts/prepare-rental-workspace.cjs',
];

function git(directory, args) {
  return execFileSync('git', ['--no-replace-objects', ...args],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }).trim();
}

function repositoryUrl(value) {
  if (typeof value !== 'string') throw Error('源码来源须为 GitHub HTTPS 仓库地址');
  const canonical = value.replace(/\.git\/?$/u, '').replace(/\/$/u, '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(canonical))
    throw Error('源码来源须为无凭据的 GitHub HTTPS 仓库地址');
  return canonical;
}

/** 声明决定源码归属，不执行其中代码；每个目标只允许来自独立仓一次。 */
function mapRentalSource(raw, layout, source) {
  if (layout?.format !== 'rental-source-layout-1' || !Array.isArray(layout.paths) || !layout.paths.length)
    throw Error('Rental 源码清单格式无效');
  const files = new Map(), origins = new Map(), targets = new Set(), sourceRoots = new Set();
  for (const entry of layout.paths) {
    if (!entry || typeof entry.source !== 'string' || typeof entry.target !== 'string') throw Error('源码映射无效');
    if (entry.source !== '.') assertSourcePath(entry.source);
    assertSourcePath(entry.target);
    if (!/^(?:packages|apps)\/[a-z0-9-]+$/u.test(entry.target) || !rentalOwned(entry.target)
      || targets.has(entry.target) || sourceRoots.has(entry.source)) throw Error('Rental 源码映射越权或重复：' + entry.target);
    if (!Array.isArray(entry.required) || !entry.required.includes('package.json') || !entry.required.length)
      throw Error('每个源码工作区须声明必需文件');
    if (!Array.isArray(entry.roles) || !entry.roles.length || entry.roles.some(role => !['domain', 'ai', 'mcp', 'host', 'client'].includes(role)))
      throw Error('源码清单须声明实际领域/适配/宿主角色');
    targets.add(entry.target); sourceRoots.add(entry.source);
    const prefix = entry.source === '.' ? '' : entry.source + '/';
    for (const required of entry.required) {
      assertSourcePath(required);
      if (!isSource(required) || !raw.has(prefix + required)) throw Error('Rental 源码缺少必需文件：' + prefix + required);
    }
    const metadata = JSON.parse(raw.get(prefix + 'package.json').toString('utf8'));
    const expectedName = entry.target === coreDirectory ? '@rental-os/rental-core'
      : '@rental-os/' + entry.target.split('/')[1];
    if (metadata.name !== expectedName) throw Error('Rental 源码工作区名称不匹配：' + entry.target);
    for (const [name, bytes] of raw) {
      assertSourcePath(name);
      if (!name.startsWith(prefix) || name === layoutFile || name === 'tools/prepare-workspace.cjs') continue;
      // 根布局仅装领域包；多路径布局的其他工作区不能又嵌套进领域包。
      if (layout.paths.some(other => other !== entry && other.source !== '.'
        && other.source.startsWith(prefix) && name.startsWith(other.source + '/'))) continue;
      const relative = name.slice(prefix.length);
      assertSourcePath(relative);
      if (!isSource(relative) && !/^(?:test|tests)\//u.test(relative)) continue;
      const target = slash(path.join(root, entry.target, relative));
      if (files.has(target)) throw Error('Rental 源码目标重复：' + target);
      files.set(target, bytes);
      origins.set(target, { ...source, path: name, sha256: sha256(bytes) });
    }
  }
  if (!targets.has(coreDirectory)) throw Error('Rental 源码清单缺少领域包');
  return { snapshot: snapshotFromFiles(source.commit, files), origins, workspaces: [...targets], layout };
}

/** 开发只核固定提交；正式发行仍强制版本Tag。旧根布局由显式兼容清单映射。 */
function readIndependentRentalSource(directory, commit, options = {}) {
  const mode = options.mode ?? 'release';
  if (!['development', 'release'].includes(mode)) throw Error('源码模式须为 development 或 release');
  directory = path.resolve(directory);
  if (slash(git(directory, ['rev-parse', '--show-toplevel'])) !== slash(directory))
    throw Error('Rental 来源须为独立 Git 仓库根目录');
  const original = readBuildSnapshot(commit, directory, ['.']);
  const raw = new Map([...original.files].map(([file, bytes]) => [path.relative(root, file).split(path.sep).join('/'), bytes]));
  const declared = raw.get(layoutFile);
  const layout = declared ? JSON.parse(declared.toString('utf8')) : rootLayout;
  const core = layout.paths?.find(entry => entry.target === coreDirectory);
  if (!core) throw Error('Rental 源码清单缺少领域包');
  const corePrefix = core.source === '.' ? '' : core.source + '/';
  const published = JSON.parse(raw.get(corePrefix + 'core.manifest.json')?.toString('utf8') ?? 'null');
  const source = { repository: repositoryUrl(published?.source?.repository ?? ''), commit };
  const mapped = mapRentalSource(raw, layout, source);
  let dependencyLock, dependencyLockSource;
  if (layout.lockfile !== undefined) {
    assertSourcePath(layout.lockfile);
    const bytes = raw.get(layout.lockfile);
    if (!bytes) throw Error('独立源码缺少声明的依赖锁');
    dependencyLock = JSON.parse(bytes.toString('utf8'));
    dependencyLockSource = { path: layout.lockfile, bytes: bytes.length, sha256: sha256(bytes) };
  }
  const { snapshot } = mapped;
  const packageFile = slash(path.join(root, coreDirectory, 'package.json'));
  const metadata = JSON.parse(snapshot.files.get(packageFile)?.toString('utf8') ?? 'null');
  if (metadata?.name !== '@rental-os/rental-core' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(metadata.version))
    throw Error('独立源码不是有效的 Rental Core 包');
  const tag = mode === 'release' ? `v${metadata.version}` : undefined;
  // 根发现清单可能在发行完成后才更新；正式包由本次源码另行生成并严格核摘要，
  // 不能要求历史源码Tag中的发现快照已指向尚未生成的同版归档。
  if (published?.id !== 'rental' || tag && git(directory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]) !== commit)
    throw Error('Rental 版本标签与指定源码提交不一致');
  const origin = git(directory, ['config', '--get', 'remote.origin.url']);
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(origin);
  const checkoutRepository = repositoryUrl(ssh ? 'https://github.com/' + ssh[1] : origin);
  if (checkoutRepository.toLowerCase() !== source.repository.toLowerCase()
    && !(source.repository === historicalRepository && checkoutRepository.toLowerCase() === renamedRepository.toLowerCase()))
    throw Error('独立 Git 来源与固定发行仓库身份不一致');
  return { ...mapped, metadata, mode, tag, source, dependencyLock, layoutKind: declared ? 'declared' : 'legacy-root',
    checkoutRepository, dependencyLockSource };
}

function composeRentalBuildSnapshot(support, rental, options = {}) {
  if (options.legacySupport && (rental.mode !== 'release' || rental.layoutKind !== 'legacy-root'))
    throw Error('旧底座业务支持只适用于已核标签的历史根布局');
  const files = new Map([...support.files].filter(([file]) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    return !rentalOwned(relative) || options.legacySupport && !relative.startsWith(coreDirectory + '/');
  }));
  for (const [file, bytes] of rental.snapshot.files) files.set(file, bytes);
  const result = snapshotFromFiles(support.commit, files);
  result.sources = { platform: { commit: support.commit }, rental: rental.source, mode: rental.mode,
    layout: rental.layoutKind, legacySupport: Boolean(options.legacySupport) };
  result.dependencyLock = rental.dependencyLock;
  result.origins = new Map([...files].map(([file, bytes]) => [file, rental.origins.get(file)
    ?? { commit: support.commit, path: path.relative(root, file).split(path.sep).join('/'), sha256: sha256(bytes) }]));
  return result;
}

/** 新组合读取公共支持时不读取底座旧业务副本；历史发行另走显式legacySupport。 */
function readRentalBuildSupport(commit, directory = root) {
  return readBuildSnapshot(commit, directory, selections.filter(file => !rentalOwned(file)
    && !['apps/admin', 'apps/example-tickets-api', 'apps/example-tickets-admin', 'packages/example-tickets-core'].includes(file)));
}

function isSource(file) {
  return !file.split('/').some(part => /^(?:output|node_modules|\.git|dist(?:-[^/]+)?|generated|test|tests)$/iu.test(part))
    && !/\.tsbuildinfo$/u.test(file);
}

function projectRentalDevelopmentWorkspace(options, platform, rental, api) {
  if (rental.source.repository.toLowerCase() === platform.source.repository.toLowerCase())
    throw Error('Rental 开发来源须是独立仓库');
  const profile = options.profile ?? 'domain';
  if (!['domain', 'host', 'full'].includes(profile)) throw Error('开发范围须为 domain、host 或 full');
  const required = profile === 'domain' ? [coreDirectory] : ['apps/rental-api', 'apps/rental-admin',
    ...(profile === 'full' ? ['apps/tenant-website', 'apps/enterprise-portal', 'apps/miniprogram', 'apps/staff-miniprogram'] : [])];
  if (options.mcp && !options.ai) throw Error('MCP 开发组合须同时选用 AI');
  const selectedRoles = ['domain', ...(profile === 'domain' ? [] : ['host']), ...(profile === 'full' ? ['client'] : []),
    ...(options.ai ? ['ai'] : []), ...(options.mcp ? ['mcp'] : [])];
  const selected = rental.layout.paths.filter(entry => entry.roles.some(role => selectedRoles.includes(role))
    && (!entry.roles.includes('ai') || options.ai) && (!entry.roles.includes('mcp') || options.mcp));
  for (const role of selectedRoles.filter(role => role === 'ai' || role === 'mcp')) {
    if (!selected.some(entry => entry.roles.includes(role)))
      throw Error('独立源码尚未交付 ' + role + ' 业务适配角色；公共引擎不能代替业务适配');
  }
  for (const directory of required) if (!selected.some(entry => entry.target === directory))
    throw Error('独立源码尚未交付所选范围：' + directory + '；禁止从底座旧业务目录补齐');
  const needsAiData = selected.some(({ target }) => {
    const metadata = JSON.parse(rental.snapshot.files.get(slash(path.join(root, target, 'package.json'))));
    return Object.hasOwn(metadata.dependencies ?? {}, '@rental-os/ai-native-data');
  });
  const extras = [...supportWorkspaces, ...(options.ai || needsAiData ? ['packages/ai-native-data'] : []),
    ...(options.ai ? ['packages/ai-native-server'] : []),
    ...(options.mcp ? ['packages/mcp-server'] : [])];
  const support = readBuildSnapshot(options.commit, options.repo, [...extras, ...supportScripts]);
  const files = new Map(platform.files);
  for (const [absolute, bytes] of support.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isSource(relative)) files.set(relative, bytes);
  }
  for (const [absolute, bytes] of rental.snapshot.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isSource(relative) && selected.some(entry => relative.startsWith(entry.target + '/'))) files.set(relative, bytes);
  }
  const workspaces = new Map();
  for (const directory of [...api.PLATFORM_SOURCE_WORKSPACES, ...extras, ...selected.map(entry => entry.target)]) {
    const packageFile = directory + '/package.json';
    if (!files.has(packageFile)) throw Error('开发组合缺少源码工作区：' + directory);
    const metadata = JSON.parse(Buffer.from(files.get(packageFile)).toString('utf8'));
    // 仅组合元数据跟随独立 Core 版本；原业务源码、权限和算法字节保持。
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (metadata[field]?.['@rental-os/rental-core']) metadata[field]['@rental-os/rental-core'] = rental.metadata.version;
    }
    if (metadata.scripts) metadata.scripts = Object.fromEntries(Object.entries(metadata.scripts).filter(([name]) => name !== 'test'));
    files.set(packageFile, json(metadata));
    workspaces.set(directory, metadata);
  }
  const originalRoot = JSON.parse(Buffer.from(platform.files.get('package.json')).toString('utf8'));
  const developmentRoot = { ...originalRoot, name: 'nativark-rental-development', private: true,
    workspaces: [...workspaces.keys()],
    dependencies: { ...originalRoot.dependencies,
      ...Object.fromEntries([...workspaces.values()].map(metadata => [metadata.name, metadata.version])) },
    scripts: {
      build: 'npm run build -w ' + (profile === 'domain' ? '@rental-os/rental-core' : '@rental-os/rental-api'),
      'build:core': 'npm run build -w @rental-os/rental-core',
      ...(profile !== 'domain' ? {
        'build:admin': 'npm run build -w @rental-os/rental-admin',
        'dev:admin': 'npm run dev -w @rental-os/rental-admin',
      } : {}),
      ...(profile === 'full' ? {
        'build:tenant-website': 'npm run build -w @rental-os/tenant-website',
        'dev:tenant-website': 'npm run dev -w @rental-os/tenant-website',
        'build:enterprise-portal': 'npm run build -w @rental-os/enterprise-portal',
        'dev:enterprise-portal': 'npm run dev -w @rental-os/enterprise-portal',
        'build:miniprogram': 'npm run build -w @rental-os/miniprogram',
        'build:staff-miniprogram': 'npm run build -w @rental-os/staff-miniprogram',
      } : {}),
      'check:types': 'node scripts/check-selected-prisma-types.cjs --mode rental --config '
        + (profile === 'domain' ? coreDirectory : 'apps/rental-api') + '/tsconfig.json',
      'check:core': 'node scripts/check-selected-prisma-types.cjs --mode rental --config packages/rental-core/tsconfig.json',
      capabilities: 'npm run capabilities -w @rental-os/core-contracts --',
      ...(options.ai && profile !== 'domain' ? {
        'build:ai': 'npm run build:ai -w @rental-os/rental-api',
        'check:ai': 'node scripts/check-selected-prisma-types.cjs --mode rental-ai --config apps/rental-api/tsconfig.ai.json',
      } : {}),
    } };
  const originalLockBytes = readBuildSnapshot(options.commit, options.repo, ['package-lock.json'])
    .files.get(slash(path.join(root, 'package-lock.json')));
  const originalLock = JSON.parse(originalLockBytes.toString('utf8'));
  const projected = projectWorkspaceLock(mergeSourceLocks(originalLock, rental.dependencyLock), workspaces, developmentRoot,
    { verifySpecifications: true });
  // 开发工作区继承固定底座的完整工具链，包括已锁定的可选开发 peer。
  // 运行包仍另做生产闭包投影，不能借该投影裁掉开发源码需要的依赖记录。
  const platformLock = JSON.parse(Buffer.from(platform.files.get('package-lock.json')).toString('utf8'));
  for (const [file, entry] of Object.entries(platformLock.packages)) {
    if (file.startsWith('node_modules/') && !entry.link && !projected.lock.packages[file])
      projected.lock.packages[file] = { ...entry };
  }
  files.set('package.json', json(projected.root));
  files.set('package-lock.json', json(projected.lock));
  files.set('README.md', Buffer.from(`# Rental Core 开发工作区\n\n` +
    `底座 ${platform.version} 和 [固定支持源码](${platform.source.repository}/tree/${platform.source.commit})，` +
    `Rental ${rental.metadata.version} 的 [独立源码](${rental.source.repository}/tree/${rental.source.commit})。` +
    `这份组合范围为 ${profile}，源码模式为 ${rental.mode}。只包含独立清单实际提供的业务目录，零 Core 底座仍单独发行。\n\n` +
    `使用支持版本的 Node/npm，先执行 \`npm ci\` 和 \`npm run check:types\`。` +
    `Core 位于 packages/rental-core，修改后用 \`npm run check:core\` 检查；` +
    `不需要维护者私有 docs、已有 dist、数据库或聊天记忆才能进行类型核查。\n\n` +
    (profile === 'domain' ? `当前仅领域源码，尚不包含独立宿主，不能据此启动完整服务。` : `实际生成所选 Client、构建、迁移准备和启动按 [Rental 宿主](apps/rental-api/README.md)执行。`) +
    (profile === 'full' ? `四端构建分别使用 \`npm run build:tenant-website\`、\`npm run build:enterprise-portal\`、\`npm run build:miniprogram\` 和 \`npm run build:staff-miniprogram\`；原宿主构建前置和标准包锁仍须满足。` : '') +
    `发布前将 Core 自己的改动提交并打版本标签，再按 [Core 构建与发行](packages/rental-core/README.md#使用与构建)` +
    `核固定底座/独立 Core 来源和归档。部署锁、租户授权与成员分配独立办理。\n\n` +
    `开发新 Core 从 [五步手册](packages/core-contracts/README.md#五步快速接入)开始；` +
    `源码来源和每个文件摘要见 development.workspace.json。自有源码使用 [MIT](LICENSE)。\n`));
  const directories = new Set();
  for (const file of files.keys()) for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory))
    directories.add(directory);
  for (const [file, bytes] of files) if (file.endsWith('.md')) {
    const text = Buffer.from(bytes).toString('utf8').replace(/\[([^\]]+)\]\(([^\s)]+)\)/gu, (original, label, target) => {
      if (/^(?:[a-z]+:|#)/iu.test(target)) return original;
      const [name, anchor] = target.split('#');
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
      if (files.has(destination) || directories.has(destination)) return original;
      if (destination === 'docs' || destination.startsWith('docs/')) return label;
      // 未随开发归档提供的业务资料仍来自独立 Core 提交，公共资料取底座支持提交。
      const contribution = rental.layout.paths.find(entry => destination.startsWith(entry.target + '/'));
      const source = contribution ? rental.source : platform.source;
      const sourcePath = contribution ? (contribution.source === '.' ? '' : contribution.source + '/')
        + destination.slice(contribution.target.length + 1) : destination;
      return `[${label}](${source.repository}/${path.posix.extname(sourcePath) ? 'blob' : 'tree'}/` +
        `${source.commit}/${sourcePath}${anchor ? '#' + anchor : ''})`;
    });
    files.set(file, Buffer.from(text));
  }
  const generated = new Set(['README.md', 'package.json', 'package-lock.json', 'platform.source.json']);
  const describe = (file, bytes) => ({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  const declaration = file => describe(file, files.get(file));
  files.set('development.workspace.json', json({
    format: 'nativark-core-development-source-2', profile, mode: rental.mode,
    host: profile === 'domain' ? null : 'rental', coreIds: ['rental'], ai: Boolean(options.ai), mcp: Boolean(options.mcp),
    platform: { version: platform.version, source: platform.source, layout: 'platform-source', packageRoot: '.' },
    core: { version: rental.metadata.version, source: rental.source, tag: rental.tag,
      checkoutRepository: rental.checkoutRepository, layout: rental.layoutKind,
      packageRoot: selected.find(entry => entry.target === coreDirectory).source, paths: selected },
    npmLocks: { platform: describe('package-lock.json', originalLockBytes),
      rental: rental.dependencyLockSource ?? null, projected: declaration('package-lock.json'), rootManifest: declaration('package.json') },
    deployment: { state: 'not-prepared', lock: null, schema: null, migrations: null },
    workspaces: [...workspaces].map(([directory, metadata]) => ({ path: directory, name: metadata.name, version: metadata.version })),
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => ({ ...describe(file, bytes),
      ...(generated.has(file) ? { generated: true } : {
        origin: rental.origins.get(slash(path.join(root, file))) ?? { ...platform.source, path: file },
        transformed: file.endsWith('.md') || file.endsWith('/package.json'),
      }) })),
  }));
  return { files, platform, rental };
}

async function createRentalDevelopmentWorkspace(options, api) {
  const platform = await api.readPlatformSourceFromGit(options.repo,
    { repository: repositoryUrl(options.repository), commit: options.commit });
  const rental = readIndependentRentalSource(options.coreRepo, options.coreCommit, { mode: options.mode ?? 'development' });
  return projectRentalDevelopmentWorkspace(options, platform, rental, api);
}

function argumentsOf(args) {
  const result = {};
  const names = { '--repo': 'repo', '--repository': 'repository', '--commit': 'commit',
    '--core-repo': 'coreRepo', '--core-commit': 'coreCommit', '--out': 'out', '--mode': 'mode', '--profile': 'profile' };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--ai' && result.ai === undefined) { result.ai = true; continue; }
    if (name === '--mcp' && result.mcp === undefined) { result.mcp = true; continue; }
    const field = names[name], value = args[++index];
    if (!field || !value || value.startsWith('--') || result[field] !== undefined) throw Error('未知、重复或缺少值的源码准备参数');
    result[field] = value;
  }
  if (['repo', 'repository', 'commit', 'coreRepo', 'coreCommit', 'out'].some(name => !result[name]))
    throw Error('用法：prepare-rental-workspace --repo <底座Git目录> --repository <GitHub地址> --commit <完整SHA> --core-repo <独立CoreGit目录> --core-commit <完整SHA> --out <新.tgz文件> [--mode development|release] [--profile domain|host|full] [--ai] [--mcp]');
  return result;
}

function compileFixedPlatformContracts(repo, commit, deps, quiet = false) {
  const { createBuild } = require('./check-rental-package-build.cjs');
  const snapshot = readBuildSnapshot(commit, repo, ['package.json', 'package-lock.json', 'tsconfig.base.json',
    'packages/platform-contracts', 'packages/core-contracts']);
  const build = createBuild(deps, { snapshot, quiet });
  build.compile('packages/platform-contracts/tsconfig.json');
  build.compile('packages/core-contracts/tsconfig.json');
  return build;
}

async function main(args) {
  const options = argumentsOf(args);
  const build = compileFixedPlatformContracts(options.repo, options.commit, path.join(options.repo, 'node_modules'));
  const platformApi = build.load(build.exported('@rental-os/core-contracts/platform-source', true));
  const { PLATFORM_SOURCE_WORKSPACES } = platformApi;
  const { files } = await createRentalDevelopmentWorkspace(options, { ...platformApi, PLATFORM_SOURCE_WORKSPACES });
  const provenanceFile = 'development.workspace.json';
  const provenance = JSON.parse(files.get(provenanceFile).toString('utf8'));
  const archive = build.load(build.exported('@rental-os/core-contracts/archive', true)).createCoreArchive(files);
  require('./package-rental-host.cjs').writeArchive(options.out, archive.bytes);
  console.log(JSON.stringify({ output: path.resolve(options.out), format: provenance.format,
    profile: provenance.profile, mode: provenance.mode, host: provenance.host, ai: provenance.ai, mcp: provenance.mcp,
    platform: provenance.platform, core: provenance.core, npmLocks: provenance.npmLocks,
    provenance: { file: provenanceFile, sha256: sha256(files.get(provenanceFile)) },
    files: files.size, bytes: archive.bytes.length, sha256: archive.sha256,
    installed: false, clientGenerated: false, deployment: provenance.deployment }));
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readIndependentRentalSource, mapRentalSource, readRentalBuildSupport, composeRentalBuildSnapshot,
  createRentalDevelopmentWorkspace, projectRentalDevelopmentWorkspace, compileFixedPlatformContracts, argumentsOf, main };
