#!/usr/bin/env node
'use strict';
/** 安装组合的只读诊断。聚合本地来源、前置与正式合同检查，不启动宿主或读取数据库。
 * 包、候选、部署、授权与业务状态分开；缺少权威始终未检查，不执行修复命令。
 */
const path = require('node:path');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const files = require('./platform-doctor-files.cjs');
const { samePrismaSchema } = require('../build-selected-prisma.cjs');
const toolRoot = path.resolve(__dirname, '../..');
const API_GUIDE = 'apps/platform-api/README.md#安装组合只读诊断';
const CONTRACT_GUIDE = 'packages/core-contracts/README.md#分别更新底座或一个-core';
const HOST_GUIDE = 'packages/platform-core-host/README.md#部署准入与存量切换';
const HELP = `Zelo 安装组合只读诊断
node scripts/ops/platform-doctor.cjs [--root <源码或解包目录>] [--profile platform|public-ai|selected-core]
  [--host <目标根下的宿主目录>] [--lock <绝对JSON路径>]
  [--core <Core-ID=绝对包目录>] [--capability <能力-ID=绝对包目录>]
  [--platform-package <绝对tgz路径>] [--json]

默认 platform：零 Core。public-ai：零 Core + 公共 AI。selected-core：由锁选择 Core 及可选能力，须提供 --host。
仅检查本地材料和当前进程配置的存在/格式；不读 .env，不联网、安装、迁移、初始化、授权或启服务。
退出 0：所检查的本地前置无缺项；1：缺项/冲突；2：用法错误或本地检查不完整。
数据库、运行版本、初始化及业务状态始终单独显示未检查，退出 0 不表示运行可用。`;

function parseArguments(args) {
  const options = { root: toolRoot, profile: 'platform', cores: new Map(), capabilities: new Map() };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (['--json', '--help'].includes(flag)) {
      if (seen.has(flag)) throw Error('usage');
      options[flag.slice(2)] = true; seen.add(flag); continue;
    }
    if (!['--root', '--profile', '--host', '--lock', '--core', '--capability', '--platform-package'].includes(flag)
        || !args[index + 1] || args[index + 1].startsWith('--')) throw Error('usage');
    const value = args[++index];
    if (flag === '--core' || flag === '--capability') {
      const split = value.indexOf('='), id = value.slice(0, split), directory = value.slice(split + 1);
      const collection = flag === '--core' ? options.cores : options.capabilities;
      if (split < 1 || !files.ID.test(id) || id.length > 64 || !path.isAbsolute(directory) || collection.has(id)) throw Error('usage');
      collection.set(id, directory);
    } else {
      if (seen.has(flag)) throw Error('usage');
      seen.add(flag); options[flag.slice(2)] = value;
    }
  }
  options.root = path.resolve(options.root);
  if (!['platform', 'public-ai', 'selected-core'].includes(options.profile)) throw Error('usage');
  if (options.profile === 'selected-core' ? !options.host : options.host) throw Error('usage');
  if (options.host) files.relativeFile(options.root, options.host);
  for (const key of ['lock', 'platform-package']) if (options[key] && !path.isAbsolute(options[key])) throw Error('usage');
  return options;
}

function diagnose(options, environment = process.env) {
  const report = { format: 'zelo-platform-doctor-1', profile: options.profile, scope: 'local-read-only',
    checks: [], sources: {}, selection: null, localStatus: 'incomplete',
    database: { state: 'unknown', checked: false, reason: '未读取原迁移账、物理结构及账号，不能判断空库、已初始化或兼容。' },
    runtime: { checked: false, version: 'unknown', candidatePreparation: 'not_checked', deployment: 'not_checked',
      initialization: 'not_checked', deploymentAdmission: 'not_checked',
      tenantGrant: 'not_checked', memberAssignment: 'not_checked', binding: 'not_checked', businessReadiness: 'not_checked' } };
  const add = (id, state, message, repair, evidence, required = true) => {
    report.checks.push({ id, state, message, ...(repair ? { repair } : {}), ...(evidence ? { evidence } : {}), required });
  };
  const at = relative => path.join(options.root, relative);
  const check = (id, operation, message, repair, { project = value => value } = {}) => {
    try { const value = operation(); add(id, 'pass', message, undefined, project(value)); return value; }
    catch (error) {
      const missing = ['ENOENT', 'ENOTDIR'].includes(error.code);
      add(id, missing ? 'missing' : 'invalid', missing ? '缺少本项本地材料。' : '本地材料不可读、路径不安全或内容不匹配。', repair);
      return null;
    }
  };
  const needFile = (id, relative, repair) => check(id, () => {
    files.read(at(relative)); return { file: relative, meaning: 'file-present-only' };
  }, '文件存在；未执行，未据此判断运行状态。', repair);

  const [major, minor] = process.versions.node.split('.').map(Number);
  add('node', (major > 22 || major === 22 && minor >= 12) && process.release.lts ? 'pass' : 'invalid',
    '当前诊断进程的 Node 版本；固定运行包仍须与部署锁逐字相同。', '按公共 API 指南使用受支持的 Node 22.12+ LTS。',
    { version: process.versions.node, platform: process.platform, architecture: process.arch });
  check('root', () => { files.ordinary(options.root, true); }, '本地普通目录。', '选择本次源码或解包根目录。');
  if (report.checks.at(-1).state !== 'pass') return finish(report);
  // Package metadata can contain arbitrary scripts or credentials. Only the
  // explicitly projected fields below are retained in the report.
  const privateValue = { project: () => undefined };
  const manifest = check('manifest', () => files.json(at('package.json')), '根清单可读取。', '取得同一固定来源的 package.json。', privateValue);
  const lock = check('npm-lock', () => {
    const value = files.json(at('package-lock.json'));
    if (value.lockfileVersion !== 3 || !value.packages?.[''] || !manifest
        || value.version !== manifest.version || value.name !== manifest.name
        || value.packages[''].version !== manifest.version || value.packages[''].name !== manifest.name
        || !isDeepStrictEqual(value.packages[''].workspaces, manifest.workspaces)) throw Error('npm_lock');
    return value;
  }, 'npm v3 根锁与根清单身份及 workspace 选择一致。', '取得同一组合的原 npm v3 锁，不手工补版本。', privateValue);
  if (manifest) report.sources.workspaceVersion = files.version(manifest.version);

  let sourceReceipt;
  const receipts = [['platform.source.json', 'nativark-platform-source-1'], ['public-ai.workspace.json', 'zelo-platform-public-ai-1'],
    ['development.workspace.json', 'nativark-core-development-source-2']];
  for (const [name, format] of receipts) {
    if (!files.exists(at(name))) continue;
    const receipt = check('source:' + name, () => {
      const value = files.json(at(name));
      if (value.format !== format) throw Error('receipt_format');
      return { value, verification: files.verifyReceipt(options.root, value) };
    }, '来源回执声明的文件字节核同；不表示远端发行或部署已核收。', '重新取得原固定归档，保留原来源与摘要，不修改回执迁就当前文件。', privateValue);
    if (receipt) {
      report.sources[name] = { ...files.source(receipt.value.source ?? receipt.value.platform?.source), ...receipt.verification,
        ...(receipt.value.core ? { core: files.source(receipt.value.core.source) } : {}), authenticityChecked: false };
      sourceReceipt = receipt.value;
    }
  }
  if (!sourceReceipt) {
    try {
      const identity = files.gitIdentity(options.root);
      if (identity) { report.sources.git = identity; add('source:git', 'pass', '已读取本地提交及跟踪文件状态；未核远端或发行归档。'); }
      else add('source', 'not_checked', '缺少可核来源回执和本地 Git 身份。', '取得带固定来源回执的归档。');
    } catch { add('source:git', 'not_checked', '本地 Git 身份未能读取。', '核对本次检出及 Git 工具；无需联网。'); }
  }
  if (sourceReceipt?.format === 'zelo-platform-public-ai-1') add('profile:source', options.profile === 'public-ai' ? 'pass' : 'invalid',
    '来源回执明确选择零 Core 公共 AI 组合。', '使用 --profile public-ai；选定 Core 必须取得所属宿主的固定组合。');

  const host = options.host ?? 'apps/platform-api';
  const hostManifest = check('host:manifest', () => files.json(at(host + '/package.json')), '所选宿主清单存在。', API_GUIDE, privateValue);
  if (lock && hostManifest) inspectDependencies(options.root, lock, host, add);
  if (options.profile === 'public-ai') add('host:ai-selection',
    hostManifest?.dependencies?.['@rental-os/ai-native-server'] && hostManifest?.dependencies?.['@rental-os/ai-native-data'] ? 'pass' : 'missing',
    '公共 AI 宿主须显式选择公共服务 SDK 和数据 SDK；源码目录存在不代表选装完成。',
    '按 scripts/prepare-platform-public-ai.cjs 的正式固定源码准备入口取得组合，再用 --root 诊断。');
  if (options.profile === 'selected-core') {
    add('host:assembly', 'not_checked', 'Core 与公共 AI 的实际装配须由所选宿主核验，包清单不证明已接线。', host + '/README.md');
    add('client', 'not_checked', '所选 Core 的 Client 与组合 schema 由其宿主决定。', host + '/README.md');
  } else {
    const schema = options.profile === 'public-ai' ? 'apps/platform-api/prisma-deployment/schema.prisma' : 'apps/platform-api/prisma/schema.prisma';
    check('client', () => {
      const base = 'apps/platform-api/generated/client/';
      if (files.exists(at('apps/platform-api/generated/client.generating'))) throw Error('generating');
      for (const name of ['index.d.ts', 'index.js']) files.read(at(base + name));
      if (!samePrismaSchema(files.read(at(base + 'schema.prisma')).toString('utf8'), files.read(at(schema)).toString('utf8'))) throw Error('schema_changed');
      return { schema, meaning: 'schema-tokens-match-only' };
    }, '复用原 schema token 核验通过；未加载 Client 或连接数据库。', '按所选宿主生成唯一 Client；公共 AI 先准备组合 schema。见 ' + API_GUIDE);
  }
  const start = hostManifest?.scripts?.[options.profile === 'public-ai' ? 'start:ai' : 'start'];
  const entry = typeof start === 'string' ? /^node (dist(?:-[a-z-]+)?\/[a-zA-Z0-9_/-]+\.js)$/u.exec(start)?.[1] : null;
  if (entry) needFile('host:build', host + '/' + entry, '按所选宿主 README 构建，再复核原产物及运行包收据。');
  else add('host:build', 'not_checked', '宿主没有可静态定位的单一 Node 启动产物。', host + '/README.md');

  inspectEnvironment(options, manifest, environment, add);
  inspectSelection(options, environment, sourceReceipt, report, add);
  add('database', 'not_checked', report.database.reason,
    '先取得目标环境只读许可，沿原宿主迁移账与物理结构读取器核定；未知旧库停止初始化和迁移。', undefined, false);
  add('runtime', 'not_checked', '未观察服务、账号、当前执行权、Core 准入、租户/成员授权或业务状态。', HOST_GUIDE, undefined, false);
  return finish(report);
}

function inspectDependencies(root, lock, host, add) {
  const queue = [host], seen = new Set(), missing = new Set();
  const resolve = (directory, name) => {
    for (;;) {
      const candidate = path.posix.join(directory, 'node_modules', name);
      if (lock.packages[candidate]) return candidate;
      if (!directory) return null;
      directory = path.posix.dirname(directory);
      if (directory === '.') directory = '';
    }
  };
  try {
    while (queue.length) {
      const directory = queue.shift();
      if (seen.has(directory)) continue;
      seen.add(directory);
      if (seen.size > 5000) throw Error('dependency_limit');
      const item = lock.packages[directory];
      if (!item) throw Error('dependency_lock');
      const packageFile = path.resolve(root, directory, 'package.json');
      if (!files.inside(root, packageFile)) throw Error('dependency_path');
      if (item.link) {
        if (typeof item.resolved !== 'string' || !/^(?:apps|packages)\/[a-z0-9][a-z0-9-]*$/u.test(item.resolved)) throw Error('workspace_path');
        queue.push(item.resolved);
        if (!files.exists(packageFile)) missing.add(directory);
        else if (path.relative(path.resolve(root, item.resolved), path.dirname(files.localDependency(root, packageFile))) !== '') throw Error('workspace_link');
        continue;
      }
      if (!files.exists(packageFile)) missing.add(directory);
      else {
        const installed = files.json(files.localDependency(root, packageFile));
        if (installed.version !== item.version) throw Error('dependency_version');
        if (!directory.split('/').includes('node_modules')) {
          for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
            if (!isDeepStrictEqual(installed[key] ?? {}, item[key] ?? {})) throw Error('workspace_dependency_drift');
        }
      }
      for (const name of Object.keys({ ...item.dependencies, ...item.devDependencies })) {
        if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/iu.test(name)) throw Error('dependency_name');
        if ((item.bundleDependencies ?? item.bundledDependencies)?.includes?.(name)) continue;
        const selected = resolve(directory, name);
        if (!selected) throw Error('dependency_missing_in_lock');
        queue.push(selected);
      }
    }
    add('dependencies', missing.size ? 'missing' : 'pass', missing.size ? '所选宿主的锁定依赖尚未完整安装。' : '所选宿主直接及传递依赖的安装版本与锁一致。',
      '获得安装许可后在本树按原锁准备依赖；不复用父目录或另一工作树的 node_modules。',
      { packagesChecked: seen.size, missingCount: missing.size,
        missing: [...missing].filter(name => /^(?:[a-z0-9_@.-]+\/)*[a-z0-9_.-]+$/iu.test(name)).slice(0, 12),
        scope: 'dependencies-and-devDependencies; optional/peer not checked' });
  } catch { add('dependencies', 'invalid', '依赖锁、安装版本或本树路径不一致。', '按原锁核对本树依赖与 workspace 链接，诊断不修复链接或安装包。'); }
}

function inspectEnvironment(options, manifest, environment, add) {
  const rootCommand = options.profile === 'platform' && /local-dev-preflight\.cjs/u.test(manifest?.scripts?.dev ?? '');
  const databaseKey = rootCommand ? 'ZELO_PLATFORM_DATABASE_URL' : 'DATABASE_URL';
  const value = environment[databaseKey];
  let valid = false;
  try {
    const url = new URL(value);
    valid = url.protocol === 'mysql:' && Boolean(url.username) && url.pathname.length > 1 && !url.hash;
    if (rootCommand) valid = valid && url.hostname === '127.0.0.1' && /^\/zelo_platform_[a-z0-9_]{1,50}$/u.test(url.pathname)
      && [...url.searchParams].every(([key, entry]) => key === 'connection_limit' && /^[1-9]\d*$/u.test(entry))
      && url.searchParams.getAll('connection_limit').length <= 1;
    if (url.port) valid = valid && Number(url.port) > 0 && Number(url.port) <= 65535;
  } catch { /* Never print the URL or parser error. */ }
  add('configuration:database', !value ? 'missing' : valid ? 'pass' : 'invalid',
    databaseKey + '：' + (!value ? '未配置。' : valid ? '基本格式符合所选入口；未连接。' : '格式不符合所选入口。'), API_GUIDE);
  add('configuration:auth', environment.AUTH_TOKEN_SECRET?.trim() ? 'pass' : 'missing',
    'AUTH_TOKEN_SECRET 仅检查是否提供；密钥强度及生产策略由原宿主校验。', API_GUIDE);
  add('configuration:initialize', 'not_checked', 'SEED_PLATFORM_PASSWORD 只供显式首次初始化；诊断不读取或要求已有账号密码。',
    '沿原 initialize 命令办理；重复执行不重置账号，未知数据库先核原账。', undefined, false);
  if (options.profile === 'public-ai') {
    add('configuration:ai-profile', /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(environment.PLATFORM_AI_PROFILE_ID ?? '') ? 'pass' : 'missing',
      'PLATFORM_AI_PROFILE_ID 只检查标识格式，不代表模型、政策或授权可用。', 'apps/platform-api/README.md#选装公共-ai-管理');
  }
}

function loadContracts() {
  const requireTool = createRequire(path.join(toolRoot, 'package.json'));
  // Resolve all library prerequisites before loading any module: Node must not
  // silently pick the main checkout's dependencies when this is a worktree.
  const entry = files.localDependency(toolRoot, requireTool.resolve('@rental-os/core-contracts'));
  const requireContract = createRequire(entry);
  files.localDependency(toolRoot, requireContract.resolve('zod'));
  return suffix => {
    const name = '@rental-os/core-contracts' + (suffix ? '/' + suffix : '');
    files.localDependency(toolRoot, requireTool.resolve(name));
    return requireTool(name);
  };
}

function inspectSelection(options, environment, receipt, report, add) {
  const inheritedLock = options.profile === 'selected-core' ? undefined : environment.CORE_DEPLOYMENT_LOCK_FILE;
  const lockFile = options.lock ?? inheritedLock;
  if (!lockFile) {
    add('deployment-lock', options.profile === 'platform' ? 'not_checked' : 'missing',
      '未提供固定部署锁；源码检出或文件存在不能证明已安装组合。',
      '用 --lock 指定已核定的绝对锁路径。零 Core 开发启动可不配置发行锁；版本及升级仍需固定发行材料。', undefined, options.profile !== 'platform');
    if (options.cores.size || options.capabilities.size || options['platform-package'])
      add('package-selection', 'invalid', '包材料没有对应的固定部署锁。', CONTRACT_GUIDE);
    return;
  }
  let input, lock, lockSha256;
  try {
    if (!path.isAbsolute(lockFile)) throw Error('absolute_lock');
    const bytes = files.read(lockFile);
    lockSha256 = files.hash(bytes);
    input = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, ''));
    lock = input.lockVersion === 2 ? input.base : input;
    if (![1, 2].includes(input.lockVersion) || lock?.lockVersion !== 1 || !lock.platform
        || !Array.isArray(lock.cores) || lock.cores.length > 100 || lock.cores.some(pin => !pin?.manifest)
        || !Array.isArray(lock.dataCapabilities ?? []) || (lock.dataCapabilities?.length ?? 0) > 100
        || (lock.dataCapabilities ?? []).some(release => !release || typeof release !== 'object')) throw Error('lock_shape');
  } catch { add('deployment-lock', 'invalid', '部署锁不可读、结构未知或路径不安全。', CONTRACT_GUIDE); return; }
  const projection = (item, id) => ({ id, version: files.version(item?.version ?? item?.versions?.platform),
    source: files.source(item?.source), sha256: typeof item?.sha256 === 'string' && files.HASH.test(item.sha256) ? item.sha256 : null });
  report.selection = { evidence: 'lock-declarations-only', lockVersion: input.lockVersion,
    platform: projection(lock.platform, 'platform'),
    cores: lock.cores.map((pin, index) => ({ ...projection({ ...pin.manifest, sha256: pin.sha256 },
      files.ID.test(pin.manifest?.id ?? '') && pin.manifest.id.length <= 64 ? pin.manifest.id : 'invalid-' + index) })),
    capabilities: (lock.dataCapabilities ?? []).map((release, index) => projection(release,
      files.ID.test(release.id ?? '') && release.id.length <= 64 ? release.id : 'invalid-' + index)) };
  const capabilities = lock.dataCapabilities ?? [];
  const selectionMatches = options.profile === 'platform' ? lock.cores.length === 0 && capabilities.length === 0
    : options.profile === 'public-ai' ? lock.cores.length === 0 && capabilities.length === 1 && capabilities[0].id === 'ai-native'
    : lock.cores.length > 0;
  add('profile:selection', selectionMatches ? 'pass' : 'invalid', selectionMatches ? '所选检查模式与锁声明集合一致。'
    : '锁的 Core/能力集合不符合所选模式；公共 AI 默认宿主只接受零 Core。', API_GUIDE);
  if (input.lockVersion === 2) add('lock:phased', 'not_checked', 'v2 锁属于分阶段新装材料，不能作为旧运行/升级入口的放行依据。', CONTRACT_GUIDE);
  const node = files.version(lock.platform?.versions?.node);
  add('lock:node', node === process.versions.node ? 'pass' : 'invalid', '锁声明的 Node 必须与所选诊断/运行工具链版本一致。',
    '使用固定发行要求的 Node 版本再检查。', { declared: node, actual: process.versions.node });
  if (receipt?.platform?.versions) add('lock:receipt', isDeepStrictEqual(receipt.platform, lock.platform) ? 'pass' : 'invalid',
    '组合来源回执的底座发行与部署锁比较。', CONTRACT_GUIDE);
  if (receipt?.format === 'nativark-core-development-source-2') add('lock:source',
    isDeepStrictEqual(receipt.platform.source, lock.platform.source) && receipt.platform.version === lock.platform.versions?.platform ? 'pass' : 'invalid',
    '开发组合回执与锁声明的底座来源、版本比较；运行和部署另行核验。', CONTRACT_GUIDE);
  if (receipt?.format === 'zelo-platform-public-ai-1') add('lock:receipt-digest', receipt.deploymentLockSha256 === lockSha256 ? 'pass' : 'invalid',
    '公共 AI 来源回执与所选完整部署锁的原字节摘要比较。', '使用同一公共 AI 组合的原部署锁，不替换或手改材料。');

  // Presence is useful even before the formal validator has been built. It is
  // deliberately a separate status from package validation below.
  const presence = (id, file, directory, repair) => {
    if (!file) { add(id, 'missing', '未提供所选固定包材料。', repair); return; }
    try {
      if (!path.isAbsolute(file)) throw Error('absolute_path');
      files.ordinary(file, directory);
      add(id, 'pass', '所选路径为本地普通文件或目录；包字节另行核验。', undefined, { meaning: 'path-present-only' });
    } catch { add(id, 'invalid', '所选固定包路径缺失、不可读或不安全。', repair); }
  };
  presence('material:platform', options['platform-package'], false, '使用 --platform-package <绝对tgz路径>。');
  for (const pin of lock.cores) if (files.ID.test(pin.manifest.id ?? '') && pin.manifest.id.length <= 64)
    presence('material:core:' + pin.manifest.id, options.cores.get(pin.manifest.id), true, '使用 --core ' + pin.manifest.id + '=<绝对包目录>。');
  for (const capability of capabilities) if (files.ID.test(capability.id ?? '') && capability.id.length <= 64)
    presence('material:capability:' + capability.id, options.capabilities.get(capability.id)
      ?? (options.profile === 'public-ai' && capability.id === 'ai-native' ? environment.PLATFORM_AI_DATA_PACKAGE_DIR : undefined), true,
    '使用 --capability ' + capability.id + '=<绝对包目录>。');

  let load, api;
  try {
    load = loadContracts(); api = load('');
  } catch {
    add('deployment-lock', 'not_checked', '本工具同树正式合同产物或依赖缺失；未执行替代兼容算法。',
      '按本工具原锁准备依赖并运行 npm run build -w @rental-os/core-contracts，再重跑诊断。');
    return;
  }
  try {
    input = (input.lockVersion === 2 ? load('deployment').CorePhasedMigrationLockSchema : api.CoreDeploymentLockSchema).parse(input);
    lock = input.lockVersion === 2 ? input.base : input;
    add('deployment-lock', 'pass', '通过本工具同树 @rental-os/core-contracts 正式 schema；仅检查材料。');
  } catch {
    add('deployment-lock', 'invalid', '固定部署锁未通过正式合同，或该版合同未提供所需锁解析器。', CONTRACT_GUIDE);
    return;
  }
  const issues = [...api.checkPlatformDataCapabilities(lock), ...api.checkCoreCombination(lock.cores.map(pin => pin.manifest), api.coreDeploymentHostVersions(lock)).issues];
  add('compatibility', issues.length ? 'invalid' : 'pass', issues.length ? '组合声明存在兼容或数据前置冲突。' : '正式合同的组合兼容与数据前置声明检查通过。', CONTRACT_GUIDE,
    { issues: issues.map(issue => ({ code: /^[a-z_]+$/u.test(issue.code) ? issue.code : 'invalid',
      field: /^[a-zA-Z0-9_.]+$/u.test(issue.field) ? issue.field : 'declaration' })) });
  add('lock:contract', lock.platform.versions.contract === api.CORE_CONTRACT_VERSION ? 'pass' : 'invalid',
    '本工具加载的合同版本与锁版本比较。', '使用与所选发行一致的诊断工具及正式合同产物。',
    { declared: lock.platform.versions.contract, loaded: api.CORE_CONTRACT_VERSION });
  try { inspectPackages(options, environment, lock, load, add); }
  catch { add('package-checker', 'not_checked', '正式包检查器不可加载，本地材料校验未完成。',
    '核对本工具同树 core-contracts 的构建产物及锁定依赖。'); }
}

function inspectPackages(options, environment, lock, load, add) {
  const api = load(''), archive = load('archive'), packages = load('package');
  const verify = (id, run, repair) => {
    try { run(); add(id, 'pass', '原正式包检查与完整摘要核同；未加载包代码或执行迁移。'); }
    catch { add(id, 'invalid', '原包、清单、入口、迁移或摘要校验失败；未采用该材料。', repair); }
  };
  for (const id of options.cores.keys()) if (!lock.cores.some(pin => pin.manifest.id === id))
    add('core:' + id, 'invalid', '传入了部署锁未选择的 Core。', CONTRACT_GUIDE);
  for (const id of options.capabilities.keys()) if (!(lock.dataCapabilities ?? []).some(item => item.id === id))
    add('capability:' + id, 'invalid', '传入了部署锁未选择的数据能力。', CONTRACT_GUIDE);
  for (const pin of lock.cores) {
    const directory = options.cores.get(pin.manifest.id), id = 'core:' + pin.manifest.id;
    if (!directory) { add(id, 'missing', '缺少所选 Core 的固定包目录。', '使用 --core ' + pin.manifest.id + '=<绝对包目录>。'); continue; }
    verify(id, () => {
      files.ordinary(directory, true);
      const actualManifest = api.CoreManifestSchema.parse(files.json(path.join(directory, 'core.manifest.json')));
      if (!isDeepStrictEqual(actualManifest, pin.manifest)) throw Error('manifest_changed');
      const declared = packages.corePackageFiles(pin.manifest);
      declared.forEach(name => files.ordinary(files.relativeFile(directory, name)));
      const content = packages.readCorePackageFiles(directory, archive.CORE_ARCHIVE_LIMITS.fileBytes, archive.CORE_ARCHIVE_LIMITS.totalBytes);
      const result = packages.inspectCorePackageFiles(content, api.coreDeploymentHostVersions(lock));
      if (!result.ok || !isDeepStrictEqual(result.manifest, pin.manifest) || !archive.matchesInstalledCoreArchive(content, pin.sha256)) throw Error('core_package');
    }, '取得同一固定标准包并沿所属宿主核验；旧 API 许可只由可信宿主策略提供。');
  }
  for (const release of lock.dataCapabilities ?? []) {
    const directory = options.capabilities.get(release.id)
      ?? (options.profile === 'public-ai' && release.id === 'ai-native' ? environment.PLATFORM_AI_DATA_PACKAGE_DIR : undefined);
    if (!directory || !path.isAbsolute(directory)) {
      add('capability:' + release.id, 'missing', '缺少所选数据能力的绝对包目录。', '使用 --capability ' + release.id + '=<绝对包目录>。'); continue;
    }
    verify('capability:' + release.id, () => {
      files.ordinary(directory, true);
      release.files.forEach(item => files.ordinary(files.relativeFile(directory, item.file)));
      load('platform-data-package').readPlatformDataCapabilityPackage(directory, release);
    }, '取得锁中固定数据发行；AI 数据发行与 SDK 版本分别核定。');
  }
  if (!options['platform-package']) add('platform-package', 'missing', '缺少底座原归档，锁中的摘要尚未与实际包核对。', '使用 --platform-package <绝对tgz路径>。');
  else verify('platform-package', () => {
    const content = archive.readCoreArchive(files.read(options['platform-package'], archive.CORE_ARCHIVE_LIMITS.totalBytes), lock.platform.sha256).files;
    const source = load('platform-source').createPlatformSource(content, lock.platform.source);
    if (source.version !== lock.platform.versions.platform || source.files.size !== content.size
        || [...source.files].some(([name, bytes]) => !content.has(name) || !Buffer.from(bytes).equals(content.get(name)))) throw Error('platform_package');
    for (const migration of lock.platform.data.migrations) {
      const bytes = content.get('apps/platform-api/' + migration.file);
      if (!bytes || files.hash(bytes) !== migration.sha256) throw Error('platform_migration');
    }
  }, '取得原底座发行归档与回执；稳定来源和旧锁不因品牌更名改写。');
  add('installed-version', 'not_checked', '包字节核验不证明该包正在运行；当前版本须由原宿主读取器核对模块、原账和物理结构。',
    'apps/platform-api/README.md#固定发行与部署锁', undefined, false);
}

function finish(report) {
  const required = report.checks.filter(item => item.required);
  report.localStatus = required.some(item => ['invalid', 'missing'].includes(item.state)) ? 'blocked'
    : required.some(item => item.state === 'not_checked') ? 'incomplete' : 'checked';
  report.exitCode = report.localStatus === 'blocked' ? 1 : report.localStatus === 'incomplete' ? 2 : 0;
  return report;
}
function formatReport(report) {
  const lines = [`Zelo 只读组合诊断：${report.profile} / ${report.localStatus}`];
  for (const item of report.checks) {
    lines.push(`[${item.state}] ${item.id}：${item.message}`);
    if (item.evidence) lines.push('  依据：' + JSON.stringify(item.evidence));
    if (item.repair && item.state !== 'pass') lines.push('  入口：' + item.repair);
  }
  lines.push('来源：' + JSON.stringify(report.sources));
  if (report.selection) lines.push('锁声明（非运行版本）：' + JSON.stringify(report.selection));
  lines.push('数据库：unknown / 未检查；初始化、运行版本、授权与业务就绪：未检查。');
  return lines.join('\n');
}
function main(args = process.argv.slice(2)) {
  let options;
  try { options = parseArguments(args); }
  catch { console.error('诊断参数无效、重复或缺值。运行 --help 查看用法。'); return 2; }
  if (options.help) { console.log(HELP); return 0; }
  try {
    const report = diagnose(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.exitCode;
  } catch {
    // Raw filesystem/schema errors may include paths, values or credentials.
    console.error('本地诊断未完成：材料读取或正式检查器失败；未执行任何修复。'); return 2;
  }
}
if (require.main === module) process.exitCode = main();
module.exports = { parseArguments, diagnose, formatReport, main };
