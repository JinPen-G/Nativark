'use strict';
/** 从固定底座和独立 Rental Git 提交准备开发源码工作区。
 * 保留原源码、所选构建脚本和 npm 锁；不读取环境、安装依赖、生成 Client 或执行部署。
 * 输出与零 Core 底座发行分开，Core 可在自己的仓库单独提交、打标签和重新准备。
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readBuildSnapshot, snapshotFromFiles } = require('./rental-build-snapshot.cjs');
const { projectWorkspaceLock } = require('./rental-host-lock.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const coreDirectory = 'packages/rental-core';
const supportWorkspaces = [
  'packages/shared', 'packages/web-client', 'packages/ai-native-data', 'apps/rental-api',
  'apps/rental-admin', 'apps/tenant-website', 'apps/enterprise-portal', 'apps/miniprogram', 'apps/staff-miniprogram',
];
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
  const canonical = value.replace(/\.git\/?$/u, '').replace(/\/$/u, '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(canonical))
    throw Error('源码来源须为无凭据的 GitHub HTTPS 仓库地址');
  return canonical;
}

/** 标签与实际 Core 根字节一起读取，不要求 Core 与底座仓库里的旧业务源码相同。 */
function readIndependentRentalSource(directory, commit) {
  directory = path.resolve(directory);
  if (slash(git(directory, ['rev-parse', '--show-toplevel'])) !== slash(directory))
    throw Error('Rental 来源须为独立 Git 仓库根目录');
  const snapshot = readBuildSnapshot(commit, directory, ['.'], path.join(root, coreDirectory));
  const packageFile = slash(path.join(root, coreDirectory, 'package.json'));
  const metadata = JSON.parse(snapshot.files.get(packageFile)?.toString('utf8') ?? 'null');
  if (metadata?.name !== '@rental-os/rental-core' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(metadata.version))
    throw Error('独立源码不是有效的 Rental Core 包');
  const tag = `v${metadata.version}`;
  if (git(directory, ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]) !== commit)
    throw Error('Rental 版本标签与指定源码提交不一致');
  const origin = git(directory, ['config', '--get', 'remote.origin.url']);
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(origin);
  return { snapshot, metadata, tag,
    source: { repository: repositoryUrl(ssh ? 'https://github.com/' + ssh[1] : origin), commit } };
}

function composeRentalBuildSnapshot(support, rental) {
  const prefix = slash(path.join(root, coreDirectory)) + '/';
  const files = new Map([...support.files].filter(([file]) => !file.startsWith(prefix)));
  for (const [file, bytes] of rental.snapshot.files) files.set(file, bytes);
  return snapshotFromFiles(support.commit, files);
}

function isSource(file) {
  return !file.split('/').some(part => /^(?:docs|output|node_modules|\.git|dist(?:-[^/]+)?|generated|test|tests)$/u.test(part))
    && !/\.tsbuildinfo$/u.test(file);
}

async function createRentalDevelopmentWorkspace(options, api) {
  const platform = await api.readPlatformSourceFromGit(options.repo,
    { repository: repositoryUrl(options.repository), commit: options.commit });
  const rental = readIndependentRentalSource(options.coreRepo, options.coreCommit);
  if (rental.source.repository.toLowerCase() === platform.source.repository.toLowerCase())
    throw Error('Rental 开发来源须是独立仓库');
  const extras = [...supportWorkspaces, ...(options.ai ? ['packages/ai-native-server', 'packages/mcp-server', 'packages/rental-mcp-host'] : [])];
  const support = readBuildSnapshot(options.commit, options.repo, [...extras, ...supportScripts]);
  const files = new Map(platform.files);
  for (const [absolute, bytes] of support.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isSource(relative)) files.set(relative, bytes);
  }
  for (const [absolute, bytes] of rental.snapshot.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isSource(relative)) files.set(relative, bytes);
  }
  const workspaces = new Map();
  for (const directory of [...api.PLATFORM_SOURCE_WORKSPACES, ...extras, coreDirectory]) {
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
      build: 'npm run build -w @rental-os/rental-api',
      'build:core': 'npm run build -w @rental-os/rental-core',
      'build:admin': 'npm run build -w @rental-os/rental-admin',
      'check:types': 'node scripts/check-selected-prisma-types.cjs --mode rental --config apps/rental-api/tsconfig.json',
      'check:core': 'node scripts/check-selected-prisma-types.cjs --mode rental --config packages/rental-core/tsconfig.json',
      capabilities: 'npm run capabilities -w @rental-os/core-contracts --',
      ...(options.ai ? {
        'build:ai': 'npm run build:ai -w @rental-os/rental-api',
        'check:ai': 'node scripts/check-selected-prisma-types.cjs --mode rental-ai --config apps/rental-api/tsconfig.ai.json',
      } : {}),
    } };
  const originalLock = JSON.parse((readBuildSnapshot(options.commit, options.repo, ['package-lock.json']))
    .files.get(slash(path.join(root, 'package-lock.json'))).toString('utf8'));
  const projected = projectWorkspaceLock(originalLock, workspaces, developmentRoot);
  files.set('package.json', json(projected.root));
  files.set('package-lock.json', json(projected.lock));
  files.set('README.md', Buffer.from(`# Rental Core 开发工作区\n\n` +
    `底座 ${platform.version} 和 [固定支持源码](${platform.source.repository}/tree/${platform.source.commit})，` +
    `Rental ${rental.metadata.version} 的 [独立源码](${rental.source.repository}/tree/${rental.source.commit})。` +
    `这份组合为开发提供原脚本和各端薄宿主，零 Core 底座仍单独发行。\n\n` +
    `使用支持版本的 Node/npm，先执行 \`npm ci\` 和 \`npm run check:types\`。` +
    `Core 位于 packages/rental-core，修改后用 \`npm run check:core\` 检查；` +
    `不需要维护者私有 docs、已有 dist、数据库或聊天记忆才能进行类型核查。\n\n` +
    `实际生成所选 Client、构建、迁移准备和启动按 [Rental 宿主](apps/rental-api/README.md)执行。` +
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
      const belongsToCore = destination.startsWith(coreDirectory + '/');
      const source = belongsToCore ? rental.source : platform.source;
      const sourcePath = belongsToCore ? destination.slice(coreDirectory.length + 1) : destination;
      return `[${label}](${source.repository}/${path.posix.extname(sourcePath) ? 'blob' : 'tree'}/` +
        `${source.commit}/${sourcePath}${anchor ? '#' + anchor : ''})`;
    });
    files.set(file, Buffer.from(text));
  }
  files.set('development.workspace.json', json({
    format: 'nativark-core-development-source-1', profile: 'rental-development', ai: Boolean(options.ai),
    platform: { version: platform.version, source: platform.source },
    core: { version: rental.metadata.version, source: rental.source, tag: rental.tag },
    workspaces: [...workspaces].map(([directory, metadata]) => ({ path: directory, name: metadata.name, version: metadata.version })),
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => ({ path: file, sha256: sha256(bytes) })),
  }));
  return { files, platform, rental };
}

function argumentsOf(args) {
  const result = {};
  const names = { '--repo': 'repo', '--repository': 'repository', '--commit': 'commit',
    '--core-repo': 'coreRepo', '--core-commit': 'coreCommit', '--out': 'out' };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--ai' && result.ai === undefined) { result.ai = true; continue; }
    const field = names[name], value = args[++index];
    if (!field || !value || value.startsWith('--') || result[field] !== undefined) throw Error('未知、重复或缺少值的源码准备参数');
    result[field] = value;
  }
  if (Object.values(names).some(name => !result[name]))
    throw Error('用法：prepare-rental-workspace --repo <固定底座Git目录> --repository <GitHub地址> --commit <SHA> --core-repo <独立CoreGit目录> --core-commit <标签SHA> --out <新.tgz文件> [--ai]');
  return result;
}

async function main(args) {
  const options = argumentsOf(args);
  const platformApi = require('@rental-os/core-contracts/platform-source');
  const { PLATFORM_SOURCE_WORKSPACES } = platformApi;
  const { files, platform, rental } = await createRentalDevelopmentWorkspace(options, { ...platformApi, PLATFORM_SOURCE_WORKSPACES });
  const archive = require('@rental-os/core-contracts/archive').createCoreArchive(files);
  require('./package-rental-host.cjs').writeArchive(options.out, archive.bytes);
  console.log(JSON.stringify({ output: path.resolve(options.out), profile: 'rental-development',
    platform: platform.version, core: rental.metadata.version, sources: [platform.source, rental.source],
    files: files.size, bytes: archive.bytes.length, sha256: archive.sha256,
    installed: false, clientGenerated: false, deployment: 'not-started' }));
}

if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { readIndependentRentalSource, composeRentalBuildSnapshot, createRentalDevelopmentWorkspace, argumentsOf };
