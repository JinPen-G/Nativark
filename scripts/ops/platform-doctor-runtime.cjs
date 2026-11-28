'use strict';
/** 显式安装命令的本树适配。只在调用时加载 Client；目标配置、生成物、原迁移均先核同。
 * 默认 doctor 不引用数据库。此模块不读取 .env、不下载引擎、不借用其他工作树。 */
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const files = require('./platform-doctor-files.cjs');
const root = path.resolve(__dirname, '../..');
const host = path.join(root, 'apps/platform-api');
const requireHost = createRequire(path.join(host, 'package.json'));

function local(name) { return files.localDependency(root, requireHost.resolve(name)); }
function load(name) { return requireHost(local(name)); }
function assertNoEnvironmentFiles(schema) {
  for (const directory of [root, path.join(root, 'apps'), host, path.join(host, 'prisma'), path.dirname(schema)])
    if (files.exists(path.join(directory, '.env'))) throw Error('environment_file');
}

function databaseTarget(environment) {
  const manifest = files.json(path.join(root, 'package.json'));
  const development = /local-dev-preflight\.cjs/u.test(manifest.scripts?.dev ?? '');
  const key = development ? 'ZELO_PLATFORM_DATABASE_URL' : 'DATABASE_URL';
  const value = environment[key];
  let target;
  try { target = new URL(value); } catch { throw Error('database_configuration'); }
  if (target.protocol !== 'mysql:' || !target.username || target.pathname.length < 2 || target.hash
    || target.port && (Number(target.port) < 1 || Number(target.port) > 65535)) throw Error('database_configuration');
  if (development && (target.hostname !== '127.0.0.1' || !/^\/zelo_platform_[a-z0-9_]{1,50}$/u.test(target.pathname)
    || [...target.searchParams].some(([key, value]) => key !== 'connection_limit' || !/^[1-9]\d*$/u.test(value))
    || target.searchParams.getAll('connection_limit').length > 1)) throw Error('database_configuration');
  return { key, value, identity: files.hash(JSON.stringify({ host: target.hostname, port: target.port || '3306',
    database: target.pathname, user: target.username, options: [...target.searchParams] })) };
}

async function openInstallation(options, environment = process.env) {
  if (options.root !== root || !['platform', 'public-ai'].includes(options.profile)) throw Error('host_observer_unavailable');
  const schema = path.join(host, options.profile === 'platform' ? 'prisma/schema.prisma' : 'prisma-deployment/schema.prisma');
  assertNoEnvironmentFiles(schema);
  // Every migration path is read as data, never through a symlink to another tree or a private environment file.
  for (const folder of new Set([path.join(host, 'prisma'), path.dirname(schema)])) {
    files.ordinary(path.join(folder, 'schema.prisma'));
    const directory = path.join(folder, 'migrations');
    files.ordinary(directory, true);
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.name === 'migration_lock.toml') { files.ordinary(path.join(directory, item.name)); continue; }
      if (!/^[a-zA-Z0-9_.-]+$/u.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) throw Error('migration_inventory');
      files.ordinary(path.join(directory, item.name, 'migration.sql'));
    }
  }
  // Existing diagnosis checks the actual dependency closure and selected Client without importing them.
  const { diagnose } = require('./platform-doctor.cjs');
  const report = diagnose({ ...options, steps: false, database: false }, environment);
  const required = ['node', 'root', 'manifest', 'npm-lock', 'dependencies', 'client'];
  const localIssues = report.checks.filter(check => required.includes(check.id) && check.state !== 'pass'
    || check.id.startsWith('source:') && check.state !== 'pass'
    || ['profile:source', 'profile:selection', 'lock:node', 'lock:receipt', 'lock:receipt-digest',
      'lock:source', 'lock:contract', 'compatibility', 'deployment-lock'].includes(check.id)
      && ['invalid', 'missing'].includes(check.state)).map(({ id, state }) => ({ id, state }));
  for (const id of required) if (!report.checks.some(check => check.id === id)) localIssues.push({ id, state: 'not_checked' });
  if (localIssues.length) throw Object.assign(Error('local_prerequisites'), { localIssues });
  const target = databaseTarget(environment);
  const entry = files.localDependency(root, path.join(host, 'dist/installation.js'));
  files.ordinary(entry);
  const api = require(entry);
  const lockFile = options.lock ?? environment.CORE_DEPLOYMENT_LOCK_FILE;
  if (lockFile && !path.isAbsolute(lockFile)) throw Error('absolute_lock');
  const lock = lockFile ? load('@rental-os/core-contracts').CoreDeploymentLockSchema.parse(files.json(lockFile)) : undefined;
  let capability;
  if (options.profile === 'public-ai') {
    const directory = options.capabilities.get('ai-native') ?? environment.PLATFORM_AI_DATA_PACKAGE_DIR;
    if (!lock || !directory || !path.isAbsolute(directory)) throw Error('ai_selection');
    const release = lock.dataCapabilities?.[0];
    if (lock.cores.length || lock.dataCapabilities?.length !== 1 || release?.id !== 'ai-native') throw Error('ai_selection');
    files.ordinary(directory, true);
    for (const item of release.files) files.ordinary(files.relativeFile(directory, item.file));
    const { files: content } = load('@rental-os/core-contracts/platform-data-package').readPlatformDataCapabilityPackage(directory, release);
    const { contribution } = load('@rental-os/ai-native-data/public-data-package').readPublicAiDataPackage(content, release);
    capability = load('@rental-os/ai-native-data/public-mysql-data').createPublicAiMysqlDataPlan(contribution);
  }
  const selection = api.selectInstallation({ profile: options.profile, lock, capability });
  if (options.cores.size || [...options.capabilities.keys()].some(id => options.profile !== 'public-ai' || id !== 'ai-native'))
    throw Error('unexpected_selection');
  // No environment discovery in Prisma: explicit datasource plus refusal of .env above.
  const { PrismaClient } = require(files.localDependency(root, path.join(host, 'generated/client/index.js')));
  const database = new PrismaClient({ datasourceUrl: target.value });
  const approval = files.hash(JSON.stringify({ selection: selection.sha256, target: target.identity }));
  return { api, database, selection, approval, target,
    read: () => api.observeInstallation(database, selection), close: () => database.$disconnect() };
}

async function readInstallation(options, environment = process.env) {
  let context;
  try {
    context = await openInstallation(options, environment);
    return { ...await context.read(), migrationApproval: context.approval, authorization: 'database-account-only',
      login: 'not_checked', service: 'not_checked', business: 'not_checked' };
  } catch (error) {
    const reasons = {
      host_observer_unavailable: '在工具同树办理；selected-core 须由所属固定宿主提供数据观察。',
      environment_file: '此入口只用进程配置；将会被 Prisma 发现的 .env 移出后重跑，不由工具读取或改动它。',
      local_prerequisites: '先运行默认 doctor 定位依赖、所选 Client 和来源缺项，再按原入口构建。',
      database_configuration: '核对本组合的进程数据库配置；完整仓库使用 ZELO_PLATFORM_DATABASE_URL，发行使用 DATABASE_URL。',
      migration_inventory: '重新核同版本 schema、原迁移目录和文件类型；不覆盖历史 SQL。',
      ai_selection: '提供零 Core 公共 AI 的固定锁与数据包，使用对应组合生成的 Client。',
      installation_selection: '固定锁须与本树 Node、正式合同和公共数据计划一致。',
      installation_profile: '明确选择与原固定锁一致的组合；不能把公共 AI 或 Core 库当零能力库。'
    };
    const reason = Object.hasOwn(reasons, error?.message) ? error.message : 'local_selection_or_database_unavailable';
    return { state: 'unknown', checked: false, reason,
      initialization: { state: 'not_checked' },
      ...(reason === 'local_prerequisites' ? { localIssues: error.localIssues } : {}),
      repair: reasons[reason] ?? '核对本树正式依赖/构建、唯一 Client 和固定锁；数据库错误原文不进入输出。' };
  } finally { if (context) await context.close().catch(() => {}); }
}

/** 旧归档白名单的人工维护窗口桥接。只读两版固定材料、原宿主和目标库，不生成收据或切换进程。 */
async function inspectBridge(options, previous, environment = process.env) {
  let context;
  try {
    if (options.profile !== 'platform' || !options.lock || !options['platform-package']) throw Error('bridge_selection');
    const api = load('@rental-os/core-contracts');
    const baseline = api.CoreDeploymentLockSchema.parse(files.json(previous.lock));
    const candidate = api.CoreDeploymentLockSchema.parse(files.json(options.lock));
    if (baseline.cores.length || candidate.cores.length || baseline.dataCapabilities?.length || candidate.dataCapabilities?.length
      || !['0.2.1', '0.2.2'].includes(baseline.platform.versions.platform)
      || baseline.platform.versions.contract !== candidate.platform.versions.contract
      || baseline.platform.versions.node !== candidate.platform.versions.node
      || !isDeepStrictEqual(baseline.platform.versions.capabilities, candidate.platform.versions.capabilities)
      || !isDeepStrictEqual(baseline.platform.data, candidate.platform.data)) throw Error('bridge_not_supported');
    const { inspectCorePackageArtifact } = load('@rental-os/platform-core-host/core-package-preflight');
    const { readCoreArchive, CORE_ARCHIVE_LIMITS } = load('@rental-os/core-contracts/archive');
    let source;
    for (const [file, release] of [[previous.package, baseline.platform], [options['platform-package'], candidate.platform]]) {
      const bytes = files.read(file, CORE_ARCHIVE_LIMITS.totalBytes);
      if (!inspectCorePackageArtifact({ kind: 'platform', release, bytes }, undefined, {}).ok) throw Error('bridge_archive');
      if (file === options['platform-package']) source = readCoreArchive(bytes, release.sha256).files;
    }
    // 候选的每份公开源码须为即将使用的同树字节；不接受只改根版本或只替换诊断脚本的目录。
    for (const [name, bytes] of source) if (!files.read(files.relativeFile(root, name)).equals(Buffer.from(bytes)))
      throw Error('bridge_candidate_changed');
    const running = require('./platform-doctor-upgrade.cjs').readRunningLock;
    const before = await running(environment);
    if (!isDeepStrictEqual(before, baseline)) throw Error('bridge_running_changed');
    context = await openInstallation(options, environment);
    const observation = await context.read();
    if (observation.state !== 'ready' || observation.initialization.state !== 'initialized' || !observation.data)
      throw Error('bridge_database_unverified');
    const plan = api.planCoreUpdate(baseline, { kind: 'platform', release: candidate.platform }, observation.data);
    if (!plan.ok || plan.status !== 'candidate' || plan.migrations.length || !isDeepStrictEqual(plan.candidate, candidate))
      throw Error('bridge_version_or_data_conflict');
    if (!isDeepStrictEqual(await running(environment), before)) throw Error('bridge_running_changed');
    return { exitCode: 0, status: 'maintenance_bridge_checked', scope: 'zero-core-unchanged-data',
      previous: { version: baseline.platform.versions.platform, source: files.source(baseline.platform.source), sha256: baseline.platform.sha256 },
      candidate: { version: candidate.platform.versions.platform, source: files.source(candidate.platform.source), sha256: candidate.platform.sha256 },
      database: { state: observation.state, initialization: observation.initialization.state, applied: observation.applied, pending: observation.pending },
      migration: 'not_required', deployment: 'pending', authorization: 'operator-maintenance-window-required',
      recovery: '保留旧目录/锁/配置，停旧后在新目录重新 status；启动失败先停止新进程，沿同库原账复核旧版可读条件再恢复旧目录。不得并行启动或改迁移账。' };
  } catch (error) {
    const known = ['bridge_selection', 'bridge_not_supported', 'bridge_archive', 'bridge_candidate_changed',
      'bridge_running_changed', 'bridge_database_unverified', 'bridge_version_or_data_conflict'];
    return { exitCode: 1, status: 'refused', reason: known.includes(error.message) ? error.message : 'bridge_evidence_unavailable',
      deployment: 'not_checked', repair: '只支持旧 0.2.1/0.2.2 零 Core 同数据链的严格前进版本。核正式归档、两锁、新目录原字节、旧宿主 SaaS 会话和同一原库；其他组合交所属维护者处理。' };
  } finally { if (context) await context.close().catch(() => {}); }
}

/** Prisma 原 migrate deploy 负责原账及排他锁。捕获但不转印含目标信息的子进程输出。 */
async function migrate(context, environment = process.env) {
  assertNoEnvironmentFiles(context.selection.schema);
  const cli = local('prisma/build/index.js');
  const engines = load('@prisma/engines'), platform = load('@prisma/get-platform');
  const target = await platform.getBinaryTargetForCurrentPlatform();
  const directory = engines.getEnginesPath();
  const schemaEngine = files.localDependency(root, path.join(directory, `schema-engine-${target}${target === 'windows' ? '.exe' : ''}`));
  const queryEngine = files.localDependency(root, path.join(directory, platform.getNodeAPIName(target, 'fs')));
  const env = { ...environment };
  for (const key of Object.keys(env)) if (/^(?:PRISMA_|RENTAL_PRISMA_)/iu.test(key)) delete env[key];
  Object.assign(env, { DATABASE_URL: context.target.value, PRISMA_SCHEMA_ENGINE_BINARY: schemaEngine,
    PRISMA_QUERY_ENGINE_LIBRARY: queryEngine, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1',
    PRISMA_DISABLE_TELEMETRY: '1', CHECKPOINT_DISABLE: '1' });
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, 'migrate', 'deploy', '--schema', context.selection.schema],
      { cwd: host, env, windowsHide: true, stdio: 'ignore' });
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const done = code => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); resolve(code);
    };
    child.once('error', () => done(null)); child.once('exit', code => done(code));
  });
}
module.exports = { openInstallation, readInstallation, inspectBridge, migrate };
