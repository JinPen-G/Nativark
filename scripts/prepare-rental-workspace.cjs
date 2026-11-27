'use strict';
/** 从固定底座和独立 Rental Git 提交准备开发源码工作区。
 * 保留原源码、所选构建脚本和 npm 锁；不读取环境、安装依赖、生成 Client 或执行部署。
 * 输出与零 Core 底座发行分开，Core 可在自己的仓库单独提交、打标签和重新准备。
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { readBuildSnapshot, snapshotFromFiles, assertSourcePath } = require('./rental-build-snapshot.cjs');
const { projectWorkspaceLock, mergeSourceLocks, lockedDependency, retentionSdk, retentionSdkLock,
  isRetentionSdkDependency } = require('./rental-host-lock.cjs');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const coreDirectory = 'packages/rental-core';
const multiCoreApps = ['apps/example-multi-core-api', 'apps/example-multi-core-admin'];
const rentalApps = ['apps/rental-api', 'apps/rental-admin', 'apps/tenant-website', 'apps/enterprise-portal',
  'apps/miniprogram', 'apps/staff-miniprogram', ...multiCoreApps];
const layoutFile = 'rental.source.json';
const publicAiAdapters = 'packages/rental-ai-adapters';
const publicAiRuntime = 'public-ai-sdk';
// These are the complete legacy Rental dependencies, not the public AI SDKs.
// A declared snapshot belongs to Rental; it must never be filled from Zelo.
const compatibilityPackages = ['packages/shared', 'packages/ai-native-server',
  'packages/ai-native-admin', 'packages/ai-native-data'];
const historicalRepository = 'https://github.com/JinPen-G/nativark-rental-core';
const renamedRepository = 'https://github.com/JinPen-G/Zelo-rental-core';
const rootLayout = { format: 'rental-source-layout-1', paths: [{ source: '.', target: coreDirectory,
  roles: ['domain'],
  required: ['package.json', 'LICENSE', 'tsconfig.json', 'tsconfig.contracts.json', 'src/index.ts', 'src/server.ts', 'prisma/schema.prisma'] }] };
const rentalOwned = file => /^packages\/(?:rental-[^/]+|web-client)(?:\/|$)/u.test(file)
  || compatibilityPackages.some(directory => file === directory || file.startsWith(directory + '/'))
  || rentalApps.some(directory => file === directory || file.startsWith(directory + '/'));
const supportScripts = [
  'scripts/prepare-selected-prisma-schema.cjs', 'scripts/miniprogram-shared-types.cjs',
  'scripts/miniprogram-ai-runtime.cjs', 'scripts/rental-client-vite.ts',
  'scripts/check-rental-package-build.cjs', 'scripts/rental-build-memory.cjs',
  'scripts/rental-build-snapshot.cjs', 'scripts/rental-host-lock.cjs', 'scripts/verify-rental-distribution.cjs',
  'scripts/prepare-rental-workspace.cjs',
];
// Original regression material is opt-in and needs the real portal consumer.
// Keep this list explicit: release and ordinary development filters stay unchanged.
const verificationTests = [
  'http-native-response.test.cjs', 'package-exports.test.cjs',
  'payment-callback-access.test.cjs', 'recovery-access.test.cjs',
  'legacy-access-preparation.test.cjs', 'legacy-access-adoption.test.cjs', 'core-session-cases.cjs',
].map(file => coreDirectory + '/test/' + file);
const verificationGuard = 'tests/fixtures/ai-native/prisma-offline-preload.cjs';
const verificationScripts = {
  'test:rental:dist': 'node --test ' + verificationTests.slice(0, 4).join(' '),
  // Both original legacy entries own the same temporary directory and clean it on exit.
  'test:rental:legacy': verificationTests.slice(4, 6).map(file => 'node ' + file).join(' && '),
  'test:rental': 'npm run test:rental:dist && npm run test:rental:legacy',
};

/** 测试材料由独立仓登记；不成为 npm 工作区，也不进入默认或发行源码。 */
function mapVerificationSource(raw, declaration, source) {
  const files = new Map(), origins = new Map();
  if (declaration === undefined) return { files, origins, roots: [] };
  if (declaration?.format !== 'rental-development-verification-1' || !Array.isArray(declaration.paths)
    || !declaration.paths.length) throw Error('开发验证材料清单无效');
  const roots = [];
  for (const entry of declaration.paths) {
    if (!['tests', 'scripts'].includes(entry?.target) || entry.source !== 'workspace/' + entry.target
      || roots.includes(entry.source)) throw Error('开发验证材料只能登记独立 tests/scripts 原目录');
    roots.push(entry.source);
    const prefix = entry.source + '/';
    let count = 0;
    for (const [name, bytes] of raw) {
      if (!name.startsWith(prefix)) continue;
      const relative = name.slice(prefix.length);
      assertSourcePath(relative);
      if (!/\.(?:[cm]?[jt]sx?|json|md|sql|prisma|html|css)$/u.test(relative)
        || /(?:^|\/)(?:dist|generated|coverage)(?:\/|$)/u.test(relative))
        throw Error('开发验证材料含非源码文件：' + name);
      const target = entry.target + '/' + relative;
      if (target === verificationGuard) throw Error('原离线守卫必须来自固定底座，不能被业务材料覆盖');
      files.set(target, bytes);
      origins.set(slash(path.join(root, target)), { ...source, path: name, sha256: sha256(bytes) });
      count++;
    }
    if (!count) throw Error('独立源码缺少声明的验证目录：' + entry.source);
  }
  return { files, origins, roots };
}

const freshAiHostExport = name => ['ai-app-module', 'ai-data-extension'].includes(name.replace(/^\.\//u, ''));
const needsHistoricalWeb = rental => !rental.layout.paths.some(entry => entry.target === 'packages/web-client')
  && (rental.layoutKind === 'legacy-root' || /^0\.1\.(?:[0-9]|1[0-4])$/u.test(rental.metadata.version));
const freshMcpHostFiles = ['src/mcp-bootstrap.ts', 'src/mcp-composition.ts', 'src/mcp-fresh-initialize.ts',
  'src/mcp-fresh-main.ts', 'src/mcp-host.ts', 'tsconfig.mcp.json'];
const publicRetentionHostFiles = ['src/ai-public-retention-main.ts', 'tsconfig.public-retention.json'];

function git(directory, args) {
  return execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', ...args],
    { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }).trim();
}

function repositoryUrl(value) {
  if (typeof value !== 'string') throw Error('源码来源须为 GitHub HTTPS 仓库地址');
  const canonical = value.replace(/\.git\/?$/u, '').replace(/\/$/u, '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(canonical))
    throw Error('源码来源须为无凭据的 GitHub HTTPS 仓库地址');
  return canonical;
}

function compatibilitySnapshot(raw, entry) {
  const declared = entry.compatibility;
  if (!compatibilityPackages.includes(entry.target)) {
    if (declared !== undefined || entry.roles.includes('compatibility')) throw Error('兼容快照只能承接已登记的旧包');
    return undefined;
  }
  if (entry.source !== 'workspace/' + entry.target || entry.roles.length !== 1 || entry.roles[0] !== 'compatibility'
    || declared?.format !== 'rental-legacy-source-1' || declared.path !== entry.target
    || !['https://github.com/JinPen-G/Zelo', 'https://github.com/JinPen-G/Nativark'].includes(declared.repository)
    || !/^[a-f0-9]{40}$/u.test(declared.commit ?? '') || !/^[a-f0-9]{64}$/u.test(declared.sha256 ?? '')
    || !Number.isSafeInteger(declared.files) || declared.files < 1)
    throw Error('旧兼容包须声明完整固定来源：' + entry.target);
  const prefix = entry.source + '/';
  const records = [...raw].filter(([file]) => file.startsWith(prefix)).map(([file, bytes]) => {
    const relative = file.slice(prefix.length);
    if (!isSource(relative) && !/^(?:test|tests)\//u.test(relative)) throw Error('兼容快照含生成目录：' + file);
    return [relative, sha256(bytes)];
  }).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (records.length !== declared.files || sha256(JSON.stringify(records)) !== declared.sha256)
    throw Error('旧兼容包文件集与固定快照不一致：' + entry.target);
  return declared;
}

/** 声明决定源码归属，不执行其中代码；每个目标只允许来自独立仓一次。 */
function mapRentalSource(raw, layout, source) {
  if (layout?.format !== 'rental-source-layout-1' || !Array.isArray(layout.paths) || !layout.paths.length)
    throw Error('Rental 源码清单格式无效');
  const verification = mapVerificationSource(raw, layout.verification, source);
  const files = new Map(), origins = new Map(), targets = new Set(), sourceRoots = new Set();
  for (const entry of layout.paths) {
    if (!entry || typeof entry.source !== 'string' || typeof entry.target !== 'string') throw Error('源码映射无效');
    if (entry.source !== '.') assertSourcePath(entry.source);
    assertSourcePath(entry.target);
    if (!/^(?:packages|apps)\/[a-z0-9-]+$/u.test(entry.target) || !rentalOwned(entry.target)
      || targets.has(entry.target) || sourceRoots.has(entry.source)) throw Error('Rental 源码映射越权或重复：' + entry.target);
    if (!Array.isArray(entry.required) || !entry.required.includes('package.json') || !entry.required.length)
      throw Error('每个源码工作区须声明必需文件');
    if (!Array.isArray(entry.roles) || !entry.roles.length || entry.roles.some(role => !['domain', 'ai', 'mcp', 'host', 'client', 'multi-core', 'compatibility'].includes(role)))
      throw Error('源码清单须声明实际领域/适配/宿主角色');
    const compatibility = compatibilitySnapshot(raw, entry);
    if (multiCoreApps.includes(entry.target) !== entry.roles.includes('multi-core')
      || (entry.roles.includes('multi-core') && entry.roles.length !== 1))
      throw Error('Rental 与工单示例宿主仅属于显式 multi-core 组合');
    targets.add(entry.target); sourceRoots.add(entry.source);
    const prefix = entry.source === '.' ? '' : entry.source + '/';
    for (const required of entry.required) {
      assertSourcePath(required);
      if (!isSource(required) || !raw.has(prefix + required)) throw Error('Rental 源码缺少必需文件：' + prefix + required);
    }
    if (entry.target === 'packages/rental-mcp-host' && (entry.roles.length !== 1 || entry.roles[0] !== 'mcp'))
      throw Error('Rental MCP 参加者只允许显式 mcp 角色');
    if (entry.target === publicAiAdapters) {
      if (entry.roles.length !== 1 || entry.roles[0] !== 'ai' || entry.runtime !== publicAiRuntime)
        throw Error('Rental 公共 AI 适配须明确依赖所选公共 SDK，且只登记 ai 角色');
    } else if (entry.runtime !== undefined) throw Error('未知的 Rental 源码运行要求：' + entry.target);
    if (entry.aiFiles !== undefined) {
      const files = entry.aiFiles;
      if (entry.target !== 'apps/rental-api' || !entry.roles.includes('host') || entry.roles.includes('ai')
        || !Array.isArray(files) || new Set(files).size !== files.length || !files.length)
        throw Error('新装 AI 源码须由 Rental API 宿主逐文件声明');
      for (const file of files) {
        assertSourcePath(file);
        if (!/^(?:src\/ai-[a-z.-]+\.ts|tsconfig\.ai\.json|prisma\/ai-extension\/[^/]+)$/u.test(file)
          || !isSource(file) || !raw.has(prefix + file) || entry.required.includes(file))
          throw Error('新装 AI 文件不存在、越出宿主范围或与普通必需文件重叠：' + file);
      }
      if (raw.has(prefix + 'prisma/ai-extension/.gitattributes') && !files.includes('prisma/ai-extension/.gitattributes'))
        throw Error('新装 AI 扩展须随原始字节属性选装');
    }
    if (entry.target === 'apps/rental-api' && entry.mcpFiles !== undefined) {
      const files = entry.mcpFiles;
      if (!entry.roles.includes('host') || !entry.aiFiles || !Array.isArray(files) || files.length !== freshMcpHostFiles.length
        || !freshMcpHostFiles.every(file => files.includes(file) && raw.has(prefix + file)
          && !entry.required.includes(file) && !entry.aiFiles.includes(file)))
        throw Error('新装 MCP 须逐文件声明固定的独立宿主入口');
    } else if (entry.mcpFiles !== undefined) throw Error('只有新装 Rental API 可声明 MCP 宿主叶');
    if (entry.publicRetentionFiles !== undefined && (entry.target !== 'apps/rental-api' || !entry.aiFiles
      || !Array.isArray(entry.publicRetentionFiles) || entry.publicRetentionFiles.length !== publicRetentionHostFiles.length
      || !publicRetentionHostFiles.every(file => entry.publicRetentionFiles.includes(file) && raw.has(prefix + file)
        && !entry.required.includes(file) && !entry.aiFiles.includes(file) && !entry.mcpFiles?.includes(file))))
      throw Error('公共保留须单独登记两个固定新装宿主文件');
    if (entry.target === 'apps/rental-api' && publicRetentionHostFiles.some(file => raw.has(prefix + file)
      && !entry.publicRetentionFiles?.includes(file))) throw Error('独立宿主含未声明的公共保留文件');
    if (entry.target === 'apps/rental-api' && [...raw.keys()].some(name => name.startsWith(prefix)
      && /^(?:src\/mcp-[a-z.-]+\.ts|tsconfig\.mcp\.json)$/u.test(name.slice(prefix.length))
      && !entry.mcpFiles?.includes(name.slice(prefix.length))))
      throw Error('独立宿主含未声明的 MCP 文件');
    const metadata = JSON.parse(raw.get(prefix + 'package.json').toString('utf8'));
    const expectedName = entry.target === coreDirectory ? '@rental-os/rental-core'
      : '@rental-os/' + entry.target.split('/')[1];
    if (metadata.name !== expectedName) throw Error('Rental 源码工作区名称不匹配：' + entry.target);
    for (const [name, bytes] of raw) {
      assertSourcePath(name);
      if (verification.roots.some(directory => name.startsWith(directory + '/'))) continue;
      if (!name.startsWith(prefix) || name === layoutFile || name === 'tools/prepare-workspace.cjs') continue;
      if (entry.source === '.' && name.startsWith('workspace/')
        && !layout.paths.some(other => other !== entry && name.startsWith(other.source + '/')))
        throw Error('独立源码存在未登记的工作区路径：' + name);
      // 根布局仅装领域包；多路径布局的其他工作区不能又嵌套进领域包。
      if (layout.paths.some(other => other !== entry && other.source !== '.'
        && other.source.startsWith(prefix) && name.startsWith(other.source + '/'))) continue;
      const relative = name.slice(prefix.length);
      assertSourcePath(relative);
      if (!isSource(relative) && !/^(?:test|tests)\//u.test(relative)) continue;
      const target = slash(path.join(root, entry.target, relative));
      if (files.has(target)) throw Error('Rental 源码目标重复：' + target);
      files.set(target, bytes);
      origins.set(target, { ...source, path: name, sha256: sha256(bytes),
        ...(compatibility ? { compatibility } : {}) });
    }
  }
  if (!targets.has(coreDirectory)) throw Error('Rental 源码清单缺少领域包');
  return { snapshot: snapshotFromFiles(source.commit, files), origins, workspaces: [...targets], layout, verification };
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
    if (dependencyLock?.lockfileVersion !== 3 || !dependencyLock.packages?.['']) throw Error('独立源码须提供 npm v3 锁');
    // Scoped lock entries are addressed by their projected workspace path,
    // so npm does not accidentally resolve the Web compilers to the root one.
    for (const [file, entry] of Object.entries(dependencyLock.packages)) {
      if (!file) continue;
      if (!/^(?:(?:apps|packages)\/[a-z0-9-]+\/)?(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(file)
        || ((file.startsWith('apps/') || file.startsWith('packages/'))
          && !layout.paths.some(({ target }) => file.startsWith(target + '/node_modules/')))
        || file.split('/').some(part => part === '.' || part === '..') || entry?.link)
        throw Error('独立依赖锁含非依赖路径或本地链接：' + file);
    }
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
  const independentWeb = rental.layout.paths.some(entry => entry.target === 'packages/web-client');
  const files = new Map([...support.files].filter(([file]) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (compatibilityPackages.some(directory => relative.startsWith(directory + '/')
      && !rental.layout.paths.some(entry => entry.target === directory))) return true;
    return !rentalOwned(relative) || (!independentWeb && relative.startsWith('packages/web-client/'))
      || options.legacySupport && !relative.startsWith(coreDirectory + '/');
  }));
  // Distribution and contract builds use the business package and its ordinary
  // hosts. The MCP participant is projected only by the explicit workspace selector.
  for (const [file, bytes] of rental.snapshot.files) if (!file.startsWith(slash('packages/rental-mcp-host') + '/')) files.set(file, bytes);
  const result = snapshotFromFiles(support.commit, files);
  result.sources = { platform: { commit: support.commit }, rental: rental.source, mode: rental.mode,
    layout: rental.layoutKind, legacySupport: Boolean(options.legacySupport) };
  result.dependencyLock = rental.dependencyLock;
  result.origins = new Map([...files].map(([file, bytes]) => [file, rental.origins.get(file)
    ?? { commit: support.commit, path: path.relative(root, file).split(path.sep).join('/'), sha256: sha256(bytes) }]));
  return result;
}

function isSource(file) {
  return !file.split('/').some(part => /^(?:output|node_modules|\.git|dist(?:-[^/]+)?|generated|test|tests)$/iu.test(part))
    && !/\.tsbuildinfo$/u.test(file);
}

/** These sources need the separately compiled public SDK, not the internal
 * mixed AI workspace. Register now; only SDK-aware build consumers select it. */
function selectRentalPublicAiAdapterSource(rental, runtime) {
  if (runtime !== publicAiRuntime) throw Error('Rental 公共 AI 适配须显式选择固定公共 SDK');
  const entry = rental.layout.paths.find(path => path.target === publicAiAdapters && path.runtime === runtime);
  if (!entry) throw Error('固定独立仓未登记 Rental 公共 AI 适配');
  const tools = new Map(), origins = new Map();
  const prefix = slash(path.join(root, entry.target)) + '/';
  for (const file of entry.required) {
    const projected = prefix + file, bytes = rental.snapshot.files.get(projected), origin = rental.origins.get(projected);
    if (!bytes || !origin || origin.commit !== rental.source.commit || sha256(bytes) !== origin.sha256)
      throw Error('Rental 公共 AI 适配缺少固定来源：' + file);
    tools.set(file, bytes);
    origins.set(file, origin);
  }
  return { directory: entry.target, files: tools, origins };
}

/** The fixed independent manifest is authoritative for local workspace identity.
 * Registry pins still come from the fixed locks; no installation, resolution or
 * read from a workspace's installed node_modules can construct that identity. */
function bindIndependentWorkspaceLinks(lock, selected, workspaces, semver, publicRetention) {
  const packages = { ...lock.packages };
  for (const { target } of selected) {
    const metadata = workspaces.get(target);
    const key = 'node_modules/' + metadata.name;
    const entry = packages[key];
    if (entry && (entry.link !== true || entry.resolved !== target))
      throw Error('独立工作区与锁定位置冲突：' + metadata.name);
    if (!entry) packages[key] = { resolved: target, link: true };
  }
  for (const { target } of selected) {
    const metadata = workspaces.get(target);
    const dependencies = { ...Object.fromEntries(Object.entries(metadata.peerDependencies ?? {})
      .filter(([name]) => !metadata.peerDependenciesMeta?.[name]?.optional)),
      ...metadata.devDependencies, ...metadata.dependencies, ...metadata.optionalDependencies };
    for (const [name, version] of Object.entries(dependencies)) {
      if (isRetentionSdkDependency({ packages }, target, name, version, publicRetention)) continue;
      const pinned = packages[lockedDependency({ packages }, target, name)];
      if (pinned?.link ? workspaces.get(pinned.resolved)?.version === version
        : pinned?.version && semver.satisfies(pinned.version, version)) continue;
      if (!pinned && Object.hasOwn(metadata.optionalDependencies ?? {}, name)) continue;
      throw Error('独立工作区依赖缺少兼容的固定来源：' + target + ' -> ' + name);
    }
    // The base can now own a public 0.2.x SDK at the same path where this
    // composition explicitly selects Rental's fixed 0.1.x compatibility copy.
    // Bind that selected manifest after checking every required dependency;
    // retaining the public manifest would compare two different products.
    // External pins and the nested public-retention SDK stay unchanged.
    packages[target] = metadata;
  }
  return { ...lock, packages };
}

function projectRentalDevelopmentWorkspace(options, platform, rental, api) {
  if (rental.source.repository.toLowerCase() === platform.source.repository.toLowerCase())
    throw Error('Rental 开发来源须是独立仓库');
  const profile = options.profile ?? 'domain';
  if (!['domain', 'host', 'full', 'multi-core'].includes(profile)) throw Error('开发范围须为 domain、host、full 或 multi-core');
  const withTests = options.withTests === true;
  if (withTests && (rental.mode !== 'development' || profile !== 'full'))
    throw Error('原回归材料只接受 --mode development --profile full --with-tests；发行不包含测试');
  const multi = profile === 'multi-core';
  // The legacy dual-Core AI host uses a different data contract from the fresh single-Rental chain.
  if (multi && (rental.mode !== 'development' || options.ai || options.freshAi || options.mcp))
    throw Error('multi-core 仅支持普通开发；原双 Core AI 请使用其固定历史组合');
  const required = profile === 'domain' ? [coreDirectory] : ['apps/rental-api', 'apps/rental-admin',
    ...(multi ? multiCoreApps : []),
    ...(profile === 'full' ? ['apps/tenant-website', 'apps/enterprise-portal', 'apps/miniprogram', 'apps/staff-miniprogram'] : [])];
  // Older locked layouts predate independent web-client. Keep their original
  // projection only for the existing tags; new layouts must own this source.
  const historicalWeb = needsHistoricalWeb(rental);
  if (profile !== 'domain' && !historicalWeb) required.push('packages/web-client');
  if (options.mcp && !options.ai) throw Error('MCP 开发组合须同时选用 AI');
  if (options.freshAi && (!options.ai || profile === 'domain'))
    throw Error('新装 AI 只接受带宿主的显式组合');
  const freshHost = rental.layout.paths.find(entry => entry.target === 'apps/rental-api' && entry.aiFiles);
  if (options.freshAi && (!['src/ai-fresh-main.ts', 'src/ai-fresh-deployment.ts', 'tsconfig.ai.json']
    .every(file => freshHost?.aiFiles.includes(file)) || !freshHost.aiFiles.some(file => /^prisma\/ai-extension\/\d{14}-initial\.sql$/u.test(file))))
    throw Error('固定独立仓缺少新装 AI 宿主或原扩展 SQL，不能从底座补齐');
  const freshMcp = Boolean(options.freshAi && options.mcp);
  if (freshMcp && (!freshHost?.mcpFiles || rental.mode !== 'development'))
    throw Error('新装 MCP 只接受实际提供选装宿主叶的固定双仓开发组合');
  const publicRetention = options.publicRetention;
  const adapterSources = publicRetention && selectRentalPublicAiAdapterSource(rental, publicAiRuntime);
  if (publicRetention && (!options.freshAi || freshMcp || rental.mode !== 'development' || !freshHost?.publicRetentionFiles
    || publicRetention.source.commit !== platform.source.commit || publicRetention.source.repository !== platform.source.repository
    || publicRetention.sha256 !== sha256(publicRetention.bytes)))
    throw Error('公共保留只接受同次固定 SDK 的 18 条新装开发组合');
  const selectedRoles = ['domain', ...(profile === 'domain' ? [] : ['host']), ...(profile === 'full' ? ['client'] : []),
    ...(multi ? ['multi-core'] : []),
    ...(options.ai ? ['ai'] : []), ...(options.mcp ? ['mcp'] : [])];
  const selected = rental.layout.paths.filter(entry => entry.roles.some(role => selectedRoles.includes(role))
    && entry.runtime === undefined && (!entry.roles.includes('ai') || options.ai) && (!entry.roles.includes('mcp') || options.mcp));
  for (const role of selectedRoles.filter(role => role === 'ai' || role === 'mcp')) {
    if (role === 'ai' && options.freshAi) continue;
    if (!selected.some(entry => entry.roles.includes(role))) {
      if (role === 'ai' && rental.layout.paths.some(entry => entry.runtime === publicAiRuntime))
        throw Error('Rental 公共 AI 适配已登记；--ai 尚未装配固定公共 SDK，请沿显式公共 SDK 构建入口');
      throw Error('独立源码尚未交付 ' + role + ' 业务适配角色；公共引擎不能代替业务适配');
    }
  }
  for (const directory of required) if (!selected.some(entry => entry.target === directory))
    throw Error('独立源码尚未交付所选范围：' + directory + '；禁止从底座旧业务目录补齐');
  if (adapterSources) selected.push(rental.layout.paths.find(entry => entry.target === adapterSources.directory));
  const needsAiData = selected.some(({ target }) => {
    const metadata = JSON.parse(rental.snapshot.files.get(slash(path.join(root, target, 'package.json'))));
    return Object.hasOwn(metadata.dependencies ?? {}, '@rental-os/ai-native-data');
  });
  // Shared still forwards Rental contracts; it is compatibility support for
  // this composition, never part of the zero-Core platform profile.
  const compatibility = ['packages/shared', 'packages/ai-native-admin',
    ...(options.ai || needsAiData ? ['packages/ai-native-data'] : []),
    ...(options.ai ? ['packages/ai-native-server'] : [])];
  for (const directory of compatibility) {
    const entry = rental.layout.paths.find(item => item.target === directory);
    if (entry) selected.push(entry);
  }
  const supportWorkspaces = ['packages/shared', ...(historicalWeb ? ['packages/web-client'] : []), 'packages/ai-native-admin',
    ...(multi || withTests ? ['packages/example-tickets-core'] : []),
    ...(options.ai || needsAiData ? ['packages/ai-native-data'] : []),
    ...(options.ai ? ['packages/ai-native-server'] : []),
    ...(options.mcp ? ['packages/mcp-server'] : [])];
  const extras = supportWorkspaces.filter(directory => !selected.some(entry => entry.target === directory));
  const support = readBuildSnapshot(options.commit, options.repo,
    [...extras, ...supportScripts, ...(withTests ? [verificationGuard] : [])]);
  const files = new Map(platform.files);
  for (const [absolute, bytes] of support.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (isSource(relative) || withTests && relative === verificationGuard) files.set(relative, bytes);
  }
  for (const [absolute, bytes] of rental.snapshot.files) {
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (relative.startsWith(publicAiAdapters + '/')) continue;
    if (!options.freshAi && freshHost?.aiFiles.some(file => freshHost.target + '/' + file === relative)) continue;
    if (!freshMcp && freshHost?.mcpFiles?.some(file => freshHost.target + '/' + file === relative)) continue;
    if (!publicRetention && freshHost?.publicRetentionFiles?.some(file => freshHost.target + '/' + file === relative)) continue;
    if ((isSource(relative) || withTests && verificationTests.includes(relative))
      && selected.some(entry => relative.startsWith(entry.target + '/'))) files.set(relative, bytes);
  }
  if (withTests) for (const file of [...verificationTests, verificationGuard])
    if (!files.has(file)) throw Error('固定开发验证材料缺失：' + file);
  if (withTests) for (const [file, bytes] of rental.verification?.files ?? []) {
    if (files.has(file)) throw Error('独立验证材料与底座/构建来源冲突：' + file);
    files.set(file, bytes);
  }
  if (adapterSources) for (const [file, bytes] of adapterSources.files)
    files.set(adapterSources.directory + '/' + file, bytes);
  const workspaces = new Map();
  for (const directory of new Set([...api.PLATFORM_SOURCE_WORKSPACES, ...supportWorkspaces, ...selected.map(entry => entry.target)])) {
    const packageFile = directory + '/package.json';
    if (!files.has(packageFile)) throw Error('开发组合缺少源码工作区：' + directory);
    const metadata = JSON.parse(Buffer.from(files.get(packageFile)).toString('utf8'));
    // 仅组合元数据跟随独立 Core 版本；原业务源码、权限和算法字节保持。
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (metadata[field]?.['@rental-os/rental-core']) metadata[field]['@rental-os/rental-core'] = rental.metadata.version;
    }
    if (metadata.scripts) metadata.scripts = Object.fromEntries(Object.entries(metadata.scripts).filter(([name]) => name !== 'test'));
    if (publicRetention && directory === retentionSdk.owner) {
      if (metadata.dependencies?.[retentionSdk.name] !== retentionSdk.version)
        throw Error('Rental 适配声明没有选择固定的公共 SDK 版本');
      metadata.dependencies[retentionSdk.name] = retentionSdk.spec;
    }
    if (publicRetention && directory === freshHost.target) metadata.dependencies = { ...metadata.dependencies,
      '@rental-os/rental-ai-adapters': '0.1.0' };
    if (freshHost?.target === directory && !options.freshAi) {
      for (const name of Object.keys(metadata.scripts ?? {})) if (/:ai(?::|$)/u.test(name)) delete metadata.scripts[name];
      for (const name of Object.keys(metadata.exports ?? {})) if (freshAiHostExport(name)) delete metadata.exports[name];
      for (const name of Object.keys(metadata.typesVersions?.['*'] ?? {})) if (freshAiHostExport(name)) delete metadata.typesVersions['*'][name];
      delete metadata.peerDependencies?.['@rental-os/ai-native-server'];
      delete metadata.peerDependenciesMeta?.['@rental-os/ai-native-server'];
    }
    if (freshHost?.target === directory && !freshMcp) {
      for (const name of Object.keys(metadata.scripts ?? {})) if (/:mcp(?::|$)/u.test(name)) delete metadata.scripts[name];
      delete metadata.exports?.['./mcp-bootstrap'];
      delete metadata.typesVersions?.['*']?.['mcp-bootstrap'];
      for (const name of ['@rental-os/mcp-server', '@rental-os/rental-mcp-host']) {
        delete metadata.peerDependencies?.[name];
        delete metadata.peerDependenciesMeta?.[name];
      }
    }
    if (freshMcp && directory === 'apps/rental-api') {
      // AI declarations and MCP ingress share the selected runtime assembly.
      for (const name of Object.keys(metadata.exports ?? {})) if (freshAiHostExport(name)) {
        for (const key of Object.keys(metadata.exports[name]))
          metadata.exports[name][key] = metadata.exports[name][key].replace('./dist-ai/', './dist-mcp/');
      }
      for (const name of Object.keys(metadata.typesVersions?.['*'] ?? {})) if (freshAiHostExport(name))
        metadata.typesVersions['*'][name] = metadata.typesVersions['*'][name].map(file => file.replace('dist-ai/', 'dist-mcp/'));
      for (const name of Object.keys(metadata.scripts ?? {})) if (/:ai:fresh$/u.test(name)) delete metadata.scripts[name];
    }
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
      ...(multi ? {
        'build:example-multi-core-api': 'npm run build -w @rental-os/example-multi-core-api',
        'build:example-multi-core-admin': 'npm run build -w @rental-os/example-multi-core-admin',
      } : {}),
      'check:types': 'node scripts/check-selected-prisma-types.cjs --mode rental --config '
        + (profile === 'domain' ? coreDirectory : 'apps/rental-api') + '/tsconfig.json',
      'check:core': 'node scripts/check-selected-prisma-types.cjs --mode rental --config packages/rental-core/tsconfig.json',
      capabilities: 'npm run capabilities -w @rental-os/core-contracts --',
      ...(withTests ? verificationScripts : {}),
      ...(options.ai && profile !== 'domain' ? {
        'build:ai': 'npm run build:ai -w @rental-os/rental-api',
        'check:ai': 'node scripts/check-selected-prisma-types.cjs --mode rental-ai --config apps/rental-api/tsconfig.ai.json',
      } : {}),
      ...(options.freshAi ? { 'build:admin:fresh': 'npm run build:fresh -w @rental-os/rental-admin' } : {}),
      ...(freshMcp ? { 'build:mcp': 'npm run build:mcp -w @rental-os/rental-api',
        'check:mcp': 'node scripts/check-selected-prisma-types.cjs --mode rental-ai --config apps/rental-api/tsconfig.mcp.json' } : {}),
    } };
  const originalLockBytes = readBuildSnapshot(options.commit, options.repo, ['package-lock.json'])
    .files.get(slash(path.join(root, 'package-lock.json')));
  const originalLock = JSON.parse(originalLockBytes.toString('utf8'));
  let mergedLock = mergeSourceLocks(originalLock, rental.dependencyLock);
  if (publicRetention) {
    if (workspaces.get(retentionSdk.legacyDirectory)?.version !== retentionSdk.legacyVersion || mergedLock.packages[retentionSdk.install])
      throw Error('公共保留必须保留独立的旧 SDK，且隔离安装路径不能有既有占用');
    const lock = retentionSdkLock(publicRetention.metadata, publicRetention.bytes);
    if (JSON.stringify(lock) !== JSON.stringify(publicRetention.lock)) throw Error('公共保留 SDK 字节与锁不一致');
    mergedLock = { ...mergedLock, packages: { ...mergedLock.packages, [retentionSdk.install]: lock } };
    files.set(retentionSdk.archive, publicRetention.bytes);
  }
  const semverPin = mergedLock.packages['node_modules/semver'];
  const deps = path.resolve(options.deps ?? path.join(options.repo, 'node_modules'));
  const fromDeps = createRequire(path.join(deps, 'semver/package.json'));
  const semverManifest = fromDeps.resolve('semver/package.json');
  if (!semverPin?.version || fromDeps(semverManifest).version !== semverPin.version
    || slash(semverManifest) !== slash(path.join(deps, 'semver/package.json')))
    throw Error('依赖范围核对须使用底座原锁中的 semver');
  const compositionLock = bindIndependentWorkspaceLinks(mergedLock, selected, workspaces, fromDeps('semver'), publicRetention);
  const projected = projectWorkspaceLock(compositionLock, workspaces, developmentRoot,
    { verifySpecifications: true, publicRetention });
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
    (multi ? `Rental 与工单的普通开发按[双 Core API](apps/example-multi-core-api/README.md)及[双 Core 后台](apps/example-multi-core-admin/README.md)准备同一部署锁。` : '') +
    (withTests ? `\n\n本组合显式包含七份原测试材料、工单示例及原离线守卫。按宿主说明生成同版所选 Client 并执行 \`npm run build\` 后，运行 \`npm run test:rental\`。` +
      `该命令先跑四份 dist 用例，再串行执行两份 legacy 用例；后者自行建立并清理 \`output/.tmp/rental-lead-participants\`，已有目录会拒绝覆盖。` +
      `这六份用例不启动服务或连接数据库；行存储和部署观察仍是用例内的明确 fixture。` +
      `独立清单若另行登记 \`workspace/tests\`、\`workspace/scripts\`，原字节随组合保留，但不会自动执行或追加到上述命令。` +
      `其他用例的实际宿主/辅助文件与数据库前提须按其源码核对，历史脚本不可当作当前环境操作授权。` +
      `发行和未选择 \`--with-tests\` 的组合不携带这些材料。\n\n` : '') +
    `发布前将 Core 自己的改动提交并打版本标签，再按 [Core 构建与发行](packages/rental-core/README.md#使用与构建)` +
    `核固定底座/独立 Core 来源和归档。部署锁、租户授权与成员分配独立办理。\n\n` +
    `开发新 Core 从 [五步手册](packages/core-contracts/README.md#五步快速接入)开始；` +
    `源码来源和每个文件摘要见 development.workspace.json。自有源码使用 [MIT](LICENSE)。\n`));
  const directories = new Set();
  for (const file of files.keys()) for (let directory = path.posix.dirname(file); directory !== '.'; directory = path.posix.dirname(directory))
    directories.add(directory);
  for (const [file, bytes] of files) if (file.endsWith('.md') && !rental.verification?.files.has(file)) {
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
  if (publicRetention) generated.add(retentionSdk.archive);
  const describe = (file, bytes) => ({ path: file, bytes: bytes.length, sha256: sha256(bytes) });
  const declaration = file => describe(file, files.get(file));
  files.set('development.workspace.json', json({
    format: 'nativark-core-development-source-2', profile, mode: rental.mode,
    host: profile === 'domain' ? null : multi ? 'example-multi-core' : 'rental',
    coreIds: multi ? ['rental', 'example-tickets'] : ['rental'], ai: Boolean(options.ai), mcp: Boolean(options.mcp),
    ...(withTests ? { verification: { suite: 'rental-original',
      files: [...verificationTests, verificationGuard, ...(rental.verification?.files.keys() ?? [])],
      sourceLayout: rental.layout.verification ?? null,
      supportWorkspaces: ['packages/example-tickets-core'], scripts: verificationScripts } } : {}),
    platform: { version: platform.version, source: platform.source, layout: 'platform-source', packageRoot: '.' },
    ...(options.freshAi ? { installation: 'fresh-ai' } : {}),
    ...(publicRetention ? { publicRetention: publicRetention.receipt } : {}),
    core: { version: rental.metadata.version, source: rental.source, tag: rental.tag,
      checkoutRepository: rental.checkoutRepository, layout: rental.layoutKind,
      packageRoot: selected.find(entry => entry.target === coreDirectory).source, paths: selected },
    npmLocks: { platform: describe('package-lock.json', originalLockBytes),
      rental: rental.dependencyLockSource ?? null, projected: declaration('package-lock.json'), rootManifest: declaration('package.json') },
    deployment: { state: 'not-prepared', lock: null, schema: null, migrations: null },
    workspaces: [...workspaces].map(([directory, metadata]) => ({ path: directory, name: metadata.name, version: metadata.version })),
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, bytes]) => ({ ...describe(file, bytes),
      ...(generated.has(file) ? { generated: true } : {
        origin: rental.origins.get(slash(path.join(root, file)))
          ?? (withTests ? rental.verification?.origins.get(slash(path.join(root, file))) : undefined)
          ?? { ...platform.source, path: file },
        transformed: !rental.verification?.files.has(file)
          && (file.endsWith('.md') || file.endsWith('/package.json')),
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
    if (name === '--fresh-ai' && result.ai === undefined) { result.ai = true; result.freshAi = true; continue; }
    if (name === '--mcp' && result.mcp === undefined) { result.mcp = true; continue; }
    if (name === '--with-tests' && result.withTests === undefined) { result.withTests = true; continue; }
    const field = names[name], value = args[++index];
    if (!field || !value || value.startsWith('--') || result[field] !== undefined) throw Error('未知、重复或缺少值的源码准备参数');
    result[field] = value;
  }
  if (['repo', 'repository', 'commit', 'coreRepo', 'coreCommit', 'out'].some(name => !result[name]))
    throw Error('用法：prepare-rental-workspace --repo <底座Git目录> --repository <GitHub地址> --commit <完整SHA> --core-repo <独立CoreGit目录> --core-commit <完整SHA> --out <新.tgz文件> [--mode development|release] [--profile domain|host|full|multi-core] [--ai|--fresh-ai] [--mcp] [--with-tests]');
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
module.exports = { readIndependentRentalSource, mapRentalSource, composeRentalBuildSnapshot,
  selectRentalPublicAiAdapterSource, createRentalDevelopmentWorkspace, projectRentalDevelopmentWorkspace,
  compileFixedPlatformContracts, argumentsOf, main };
