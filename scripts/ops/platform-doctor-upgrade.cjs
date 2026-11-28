#!/usr/bin/env node
'use strict';
/** 正式包管理的命令行消费者。当前版本由已运行宿主观察，候选、迁移差异和恢复沿原合同/摘要。
 * prepare 是唯一写入命令；不切换运行目录、执行迁移、改锁/配置或重发 unknown 操作。 */
const path = require('node:path');
const { createRequire } = require('node:module');
const { isDeepStrictEqual } = require('node:util');
const files = require('./platform-doctor-files.cjs');
const root = path.resolve(__dirname, '../..');
const HELP = `Zelo 升级与原候选恢复
node scripts/ops/platform-doctor-upgrade.cjs status
node scripts/ops/platform-doctor-upgrade.cjs plan --kind platform|core|platform-capability --reference <原包引用> [--id <Core或能力ID>]
node scripts/ops/platform-doctor-upgrade.cjs prepare --kind <同原选择> --reference <原包引用> [--id <原ID>] --sha256 <原预览摘要>
node scripts/ops/platform-doctor-upgrade.cjs receipt --sha256 <原预览摘要>

显式读取 PLATFORM_DOCTOR_API_URL（HTTPS origin 或回环 HTTP origin）和 PLATFORM_DOCTOR_ACCESS_TOKEN。
会话由原登录入口取得；工具不读 .env、不输出令牌、不跟随跳转、不自动登录或重试。
status/plan/receipt 只读原宿主；prepare 经原 SaaS 权限/版本围栏准备候选，仍为 deployment:pending。
失应答保留同一 sha256，先 receipt。未知原迁移或缺部署证据拒绝，迁移批准/切换/恢复仍走原部署入口。
退出 0：本次读取/准备有确定结果；1：已知拒绝或缺项；2：未知/用法错误。`;

function contracts() {
  const resolver = createRequire(path.join(root, 'package.json'));
  const load = name => resolver(files.localDependency(root, resolver.resolve(name)));
  return { core: load('@rental-os/core-contracts'),
    deployment: load('@rental-os/core-contracts/deployment'),
    phased: load('@rental-os/core-contracts/phased-installation'),
    preflight: load('@rental-os/platform-core-host/core-package-preflight'),
    preparation: load('@rental-os/platform-core-host/core-package-preparation'),
    fingerprint: load('@rental-os/platform-contracts/request-fingerprint').requestFingerprint };
}
function argumentsFor(args, api) {
  const [command, ...rest] = args, options = {};
  if (!['status', 'plan', 'prepare', 'receipt'].includes(command)) throw Error('usage');
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index], value = rest[index + 1];
    if (!['--kind', '--id', '--reference', '--sha256'].includes(flag) || !value || value.startsWith('--')
      || Object.hasOwn(options, flag)) throw Error('usage');
    options[flag] = value;
  }
  if (command === 'status' && rest.length || command === 'receipt' && Object.keys(options).some(key => key !== '--sha256')
    || command === 'plan' && options['--sha256']) throw Error('usage');
  const sha256 = options['--sha256'];
  if (['prepare', 'receipt'].includes(command) && !files.HASH.test(sha256 ?? '')) throw Error('usage');
  let request;
  if (['plan', 'prepare'].includes(command)) {
    const kind = options['--kind'], id = options['--id'];
    if (kind === 'platform' && id || kind !== 'platform' && !id) throw Error('usage');
    request = api.preflight.CorePackageUpdatePlanRequestSchema.parse({ kind, reference: options['--reference'],
      ...(kind === 'core' ? { coreId: id } : kind === 'platform-capability' ? { capabilityId: id } : {}) });
  }
  return { command, request, sha256 };
}
function connection(environment) {
  const url = new URL(environment.PLATFORM_DOCTOR_API_URL);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))
    throw Error('api_configuration');
  const token = environment.PLATFORM_DOCTOR_ACCESS_TOKEN;
  if (!token || token.length > 16384 || /[\s\x00-\x1f\x7f]/u.test(token)) throw Error('session_configuration');
  return { origin: url.origin, token };
}

async function requestHost(connection, route, body, fetcher) {
  return requestJson(connection, 'platform/core-packages/' + route, body, fetcher);
}
// route 只由上述固定包路径或下方正式 Core HTTP 常量给出，不接收用户 URL/路径。
async function requestJson(connection, route, body, fetcher) {
  const response = await fetcher(connection.origin + '/api/' + route, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: 'Bearer ' + connection.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(Error('host_refused'), { statusCode: response.status }); }
  const reader = response.body?.getReader();
  if (!reader) throw Error('empty_response');
  const parts = []; let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > 8 * 1024 * 1024) throw Error('response_limit');
      parts.push(Buffer.from(chunk.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!value || typeof value !== 'object') throw Error('invalid_response');
  return value.data ?? value;
}

function releaseSummary(release, kind) {
  const value = kind === 'core' ? release?.manifest : release;
  if (!value) return null;
  return { version: files.version(kind === 'platform' ? value.versions?.platform : value.version),
    source: files.source(value.source), sha256: files.HASH.test(release.sha256 ?? '') ? release.sha256 : null,
    dataVersion: files.version(value.data?.version) };
}
function lockSummary(lock) {
  return { platform: releaseSummary(lock.platform, 'platform'),
    cores: lock.cores.map(pin => ({ id: pin.manifest.id, ...releaseSummary(pin, 'core') })),
    capabilities: (lock.dataCapabilities ?? []).map(release => ({ id: release.id, ...releaseSummary(release, 'platform-capability') })) };
}
const issueCodes = new Set(['source_conflict', 'release_changed', 'release_rollback', 'release_metadata_changed',
  'core_not_installed', 'core_identity', 'scope_changed', 'capability_not_installed', 'capability_identity',
  'data_unavailable', 'migration_incomplete', 'data_rollback', 'migration_changed', 'migration_history',
  'other_module_not_ready', 'migration_baseline', 'data_version_unchanged', 'data_observation_conflict',
  'data_version_without_migration', 'data_version', 'contract_version', 'platform_version', 'node_version']);
function issues(values) {
  return (Array.isArray(values) ? values.slice(0, 100) : []).map(item => ({
    code: issueCodes.has(item?.code) ? item.code : 'host_prerequisite',
    owner: item?.owner === 'platform' ? 'platform' : 'selected-module' }));
}
function versions(value, api) {
  if (value?.versions?.status !== 'observed') return { state: 'unavailable',
    reason: ['deployment_read_failed', 'deployment_unavailable', 'deployment_invalid'].includes(value?.versions?.error?.code)
      ? value.versions.error.code : 'host_observation_unavailable', repair: '核原宿主 deployment、固定锁、实际包与物理观察供给。' };
  const raw = value.versions;
  const member = (entry, schema, kind) => ({
    locked: releaseSummary(schema.parse(entry.locked), kind),
    current: entry.current === null ? null : releaseSummary(schema.parse(entry.current), kind),
    availability: entry.availability?.status === 'available' ? 'available' : 'unavailable',
    issues: issues(entry.availability?.issues) });
  if (!Array.isArray(raw.cores) || raw.cores.length > 100 || (raw.dataCapabilities?.length ?? 0) > 100) throw Error('versions');
  return { state: 'observed', authority: 'running-host-package-and-database-observation',
    platform: member(raw.platform, api.core.CorePlatformReleaseSchema, 'platform'),
    cores: raw.cores.map(entry => ({ id: api.core.CorePackagePinSchema.parse(entry.locked).manifest.id,
      registered: entry.registered === true, ...member(entry, api.core.CorePackagePinSchema, 'core') })),
    capabilities: (raw.dataCapabilities ?? []).map(entry => ({ id: api.core.CorePlatformDataCapabilityReleaseSchema.parse(entry.locked).id,
      ...member(entry, api.core.CorePlatformDataCapabilityReleaseSchema, 'platform-capability') })) };
}
function preparation(value, api, expected) {
  const record = value.record ? api.preparation.CorePackagePreparationRecordSchema.parse(value.record) : undefined;
  const plan = record?.plan ?? api.preparation.CorePackagePreparationPlanSchema.parse(value.plan);
  const sha256 = record?.sha256 ?? value.sha256;
  if (!files.HASH.test(sha256 ?? '') || api.fingerprint(plan) !== sha256 || expected && expected !== sha256) throw Error('receipt_mismatch');
  return { sha256, preparation: record ? 'recorded' : 'previewed', deployment: plan.deployment,
    baseAtPreparation: lockSummary(plan.base), candidate: lockSummary(plan.candidate),
    fileCount: plan.files.length, ...(record ? { preparedAt: record.preparedAt } : {}),
    execution: 'not_checked', migrationApproval: 'not_checked',
    recovery: { command: 'node scripts/ops/platform-doctor-upgrade.cjs receipt --sha256 ' + sha256,
      entry: 'packages/platform-core-host/src/core-package-preparation/README.md',
      condition: '原摘要回执只证明候选准备；迁移看原账，运行切换和应用/数据恢复看原部署收据。' } };
}

async function run(options, api, environment = process.env, fetcher = fetch) {
  const connected = connection(environment);
  const read = (route, body) => requestHost(connected, route, body, fetcher);
  if (options.command === 'status') {
    const current = versions(await read('catalogue'), api);
    const available = current.state === 'observed' && [current.platform, ...current.cores, ...current.capabilities]
      .every(item => item.availability === 'available' && item.current) && current.cores.every(item => item.registered);
    return { exitCode: available ? 0 : 1, status: available ? 'observed' : 'unavailable', current };
  }
  if (options.command === 'plan') {
    const current = versions(await read('catalogue'), api);
    if (current.state !== 'observed' || [current.platform, ...current.cores, ...current.capabilities]
      .some(item => item.availability !== 'available' || !item.current) || current.cores.some(item => !item.registered)) return { exitCode: 1, status: 'unavailable', current,
      repair: '当前宿主缺完整运行/数据观察，停止候选办理。' };
    const value = await read('plan-update', options.request);
    if (value.status !== 'inspected' || value.plan?.status !== 'checked') return { exitCode: 1, status: 'unavailable', current,
      inspectionIssues: (value.inspection?.issues ?? []).slice(0, 50).map(item => ({ code: [
        'archive_invalid', 'release_mismatch', 'undeclared_file', 'platform_version', 'platform_source_mismatch',
        'migration_mismatch', 'platform_source_invalid', 'capability_package_invalid'].includes(item?.code) ? item.code : 'package_invalid' })),
      repair: options.request.kind === 'platform' && value.inspection?.issues?.some(item => item.code === 'platform_source_mismatch')
        ? '旧版可能不认识新源码白名单；核新旧发行和公开维护桥接条件，不删除白名单或替换历史包。'
        : '核所选固定包引用、当前组合的实际部署/数据观察及当前 SaaS 权限。' };
    const result = value.plan.result;
    if (result?.ok !== true) return { exitCode: 1, status: 'refused', current, issues: issues(result?.issues) };
    if (!['unchanged', 'candidate', 'migration_required'].includes(result.status) || !Array.isArray(result.migrations)) throw Error('plan');
    const candidate = api.core.CoreDeploymentLockSchema.parse(result.candidate);
    const preview = await read('preview-preparation', { operation: 'update', package: options.request });
    if (preview.status !== 'ready') return { exitCode: 1, status: 'unavailable', current,
      candidate: lockSummary(candidate), repair: '原候选预览未就绪；先核材料、存储、真实部署与当前授权。' };
    const plan = api.preparation.CorePackagePreparationPlanSchema.parse(preview.plan);
    if (!isDeepStrictEqual(plan.candidate, candidate) || !isDeepStrictEqual(plan.request, { operation: 'update', package: options.request }))
      throw Error('plan_changed');
    const observedBase = { platform: current.platform.current,
      cores: current.cores.map(item => ({ id: item.id, ...item.current })),
      capabilities: current.capabilities.map(item => ({ id: item.id, ...item.current })) };
    if (!isDeepStrictEqual(lockSummary(plan.base), observedBase)) throw Error('deployment_changed');
    // 来源/迁移算法由宿主原 planCoreUpdate 维护；这里只投影已解析候选的增量。
    const modules = lock => [{ owner: 'platform', data: lock.platform.data },
      ...lock.cores.map(pin => ({ owner: 'core:' + pin.manifest.id, data: pin.manifest.data })),
      ...(lock.dataCapabilities ?? []).map(release => ({ owner: 'platform-capability:' + release.id, data: release.data }))];
    const previous = new Map(modules(plan.base).map(item => [item.owner, item.data]));
    const migrations = modules(candidate).map(item => ({ owner: item.owner, fromVersion: previous.get(item.owner)?.version ?? null,
      toVersion: item.data.version, entries: item.data.migrations.slice(previous.get(item.owner)?.migrations.length ?? 0)
        .map(entry => ({ id: entry.id, sha256: entry.sha256 })) })).filter(item => item.entries.length);
    return { exitCode: 0, status: result.status, current, ...preparation(preview, api), migrations,
      restrictions: ['准备候选不改变当前运行组合、配置或授权。', '需迁移时先核停机、备份与单独批准；本入口不应用 SQL。',
        '切换后重读 status 并验证登录/原配置/原授权；旧应用不能读取新数据时不可直接回退镜像。'] };
  }
  const route = options.command === 'prepare' ? 'prepare' : 'preparation-receipt';
  const body = options.command === 'prepare'
    ? { request: { operation: 'update', package: options.request }, expectedSha256: options.sha256 } : { sha256: options.sha256 };
  let value;
  try { value = await read(route, body); }
  catch { return { exitCode: 2, status: 'unknown', sha256: options.sha256,
    recovery: '先以同一 sha256 执行 receipt；连接中断、拒绝响应或超时不证明未准备，不自动重发。' }; }
  if (['prepared', 'already_prepared', 'recorded'].includes(value.status)) return {
    exitCode: 0, status: value.status, ...preparation(value, api, options.sha256) };
  return { exitCode: value.status === 'unavailable' && options.command === 'receipt' ? 1 : 2,
    status: value.status === 'unavailable' ? 'unavailable' : 'unknown', sha256: options.sha256,
    recovery: '保持原摘要及当前运行组合；核原候选存储、提交意图审计和当前权限后再次只读 receipt。' };
}
async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  let api, options;
  try { api = contracts(); options = argumentsFor(args, api); }
  catch { console.error('升级参数或本树正式合同未就绪；运行 --help，并按原锁构建公共宿主。'); return 2; }
  try {
    const result = await run(options, api);
    console.log(JSON.stringify(result, null, 2)); return result.exitCode;
  } catch {
    console.log(JSON.stringify({ status: 'unknown', ...(options.sha256 ? { sha256: options.sha256 } : {}),
      recovery: '核进程指定的原宿主、会话和正式合同；已发 prepare 时先按同摘要读取 receipt，不重试写入。' })); return 2;
  }
}
async function readRunningVersions(environment = process.env) {
  try { return await run({ command: 'status' }, contracts(), environment); }
  catch { return { exitCode: 2, status: 'unknown', current: { state: 'unavailable' } }; }
}

/** 校验一次原宿主观察，输出白名单字段。v1 base 仅核其原数据子集，完整判定还须所有 v2 后置事实。 */
function projectPhasedInstallation(value, expected, api) {
  expected = api.deployment.CorePhasedMigrationLockSchema.parse(expected);
  const observed = api.phased.CorePhasedInstallationObservationSchema.parse(value);
  const phasedReasons = new Set(api.phased.CORE_PHASED_INSTALLATION_ISSUE_CODES);
  const result = { exitCode: 2, state: 'unknown', authority: 'original-phased-host-observation',
    observedAt: observed.observedAt, selectionMatches: false, preparation: 'not_checked',
    current: { state: 'unavailable' }, runtimeClient: 'not_checked',
    database: { state: 'unknown', checked: false, applied: null, pending: null, initialization: { state: 'not_checked' } },
    initialization: { platform: { state: 'not_checked', receipt: 'not_checked' }, cores: [] },
    postCapability: [], issues: observed.issues.map(item => ({ scope: item.scope,
      code: phasedReasons.has(item.code) ? item.code : 'host_prerequisite' })),
    upgrade: 'not_supported_by_v1', business: 'not_checked',
    repair: '核同一完整 v2 锁、原宿主包/Client、各阶段原账和物理观察；初始化、授权及业务操作仍须显式办理。' };
  if (observed.status === 'unavailable') return result;
  if (!isDeepStrictEqual(observed.lock, expected)) return { ...result, exitCode: 1, state: 'selection_conflict',
    issues: [...result.issues, { scope: 'materials', code: 'deployment_changed' }] };
  result.selectionMatches = true;
  const base = expected.base, installed = observed.installed;
  const sameSet = (left, right, key) => left.length === right.length
    && new Set(right.map(key)).size === right.length && left.every(item => right.some(other => key(item) === key(other)
      && isDeepStrictEqual(item, other)));
  const registrationMatches = sameSet(base.cores.map(pin => api.core.coreRegisteredSummary(pin.manifest)), observed.registered, item => item.id);
  const packagesMatch = installed && isDeepStrictEqual(installed.platform, base.platform)
    && sameSet(base.cores, installed.cores, pin => pin.manifest.id)
    && sameSet(base.dataCapabilities ?? [], installed.dataCapabilities, item => item.id)
    && isDeepStrictEqual(installed.postCapability, expected.postCapability);
  const member = (locked, current, kind) => ({ locked: releaseSummary(locked, kind),
    current: current ? releaseSummary(current, kind) : null, availability: 'not_checked', issues: [] });
  if (installed) result.current = { state: 'observed', authority: result.authority,
    platform: member(base.platform, installed.platform, 'platform'),
    cores: base.cores.map(pin => ({ id: pin.manifest.id,
      registered: observed.registered.some(item => isDeepStrictEqual(item, api.core.coreRegisteredSummary(pin.manifest))),
      ...member(pin, installed.cores.find(item => item.manifest.id === pin.manifest.id), 'core') })),
    capabilities: (base.dataCapabilities ?? []).map(release => ({ id: release.id,
      ...member(release, installed.dataCapabilities.find(item => item.id === release.id), 'platform-capability') })) };
  if (!packagesMatch || !registrationMatches) result.issues.push({ scope: 'materials', code: installed ? 'runtime_identity_unverified' : 'materials_unavailable' });
  result.runtimeIdentityVerified = Boolean(packagesMatch && registrationMatches && observed.runtimeClient);
  result.runtimeClient = observed.runtimeClient ? 'verified' : 'not_checked';
  if (!observed.runtimeClient) result.issues.push({ scope: 'materials', code: 'runtime_identity_unverified' });
  result.preparation = observed.preparation ? 'prepared' : 'not_checked';
  // 运行和数据观察不能补造原准备结果；缺任一必需材料仍保持未检查。
  if (!observed.preparation) result.issues.push({ scope: 'materials', code: 'materials_unavailable' });
  result.initialization = observed.initialization;
  result.database.initialization = observed.initialization.platform;

  const data = observed.database.base;
  // 原 planCoreUpdate 的 unchanged 分支只校验基础阶段原链；不生成候选、不把它作为完整 v2 升级基线。
  const basePlan = data ? api.core.planCoreUpdate(base, { kind: 'platform', release: base.platform }, data) : undefined;
  const baseStates = data ? [data.platform, ...data.cores, ...(data.dataCapabilities ?? [])] : [];
  const baseReady = basePlan?.ok && basePlan.status === 'unchanged'
    && baseStates.every(item => item.execution?.state === 'ready')
    && sameSet(base.cores.map(pin => pin.manifest.id), data.cores.map(item => item.coreId), item => item)
    && sameSet((base.dataCapabilities ?? []).map(item => item.id), (data.dataCapabilities ?? []).map(item => item.capabilityId), item => item);
  const key = item => item.coreId + ':' + (item.migrationId ?? item.migration.id);
  if (new Set(observed.database.postCapability.map(key)).size !== observed.database.postCapability.length
    || observed.database.postCapability.some(item => !expected.postCapability.some(post => key(item) === key(post))))
    throw Error('phased_observation_members');
  result.postCapability = expected.postCapability.map(post => {
    const actual = observed.database.postCapability.find(item => key(item) === key(post));
    const applied = actual?.appliedMigration && isDeepStrictEqual(actual.appliedMigration,
      { id: post.migration.id, sha256: post.migration.sha256 });
    return { coreId: post.coreId, migration: { id: post.migration.id, sha256: post.migration.sha256, source: files.source(post.migration.source) },
      ledgerName: api.deployment.corePostCapabilityPrismaMigrationName(post.coreId, post.migration.id),
      state: applied && actual.execution?.state === 'ready' && actual.physical ? 'ready' : 'not_checked',
      applied: applied ? 'observed' : actual?.appliedMigration ? 'conflict' : 'not_checked',
      execution: actual?.execution?.state ?? 'not_checked', physical: actual?.physical ?? null };
  });
  const databaseReady = Boolean(baseReady && result.postCapability.every(item => item.state === 'ready')
    && !result.issues.some(item => item.scope === 'database'));
  const interrupted = baseStates.some(item => item.execution && item.execution.state !== 'ready')
    || result.postCapability.some(item => ['failed', 'running', 'unknown'].includes(item.execution));
  const conflict = basePlan?.ok === false && basePlan.issues.some(item => ['migration_history', 'data_observation_conflict', 'data_version'].includes(item.code))
    || result.postCapability.some(item => item.applied === 'conflict');
  Object.assign(result.database, { checked: databaseReady || Boolean(interrupted || conflict),
    state: databaseReady ? 'ready' : conflict ? 'incompatible' : interrupted ? 'migration_incomplete' : 'unknown' });
  if (databaseReady) Object.assign(result.database, { applied: baseStates.reduce((total, item) => total + item.appliedMigrations.length, 0)
    + result.postCapability.length, pending: 0 });
  if (!databaseReady) result.issues.push({ scope: 'database', code: conflict ? 'ledger_mismatch' : interrupted ? 'ledger_incomplete' : 'observation_unavailable' });
  const coreInitializations = observed.initialization.cores;
  if (new Set(coreInitializations.map(item => item.coreId)).size !== coreInitializations.length
    || coreInitializations.some(item => !base.cores.some(pin => pin.manifest.id === item.coreId))) throw Error('phased_initialization_members');
  const initialized = observed.initialization.platform.state === 'initialized'
    && base.cores.every(pin => coreInitializations.some(item => item.coreId === pin.manifest.id && item.state === 'initialized'));
  const initializationStates = [observed.initialization.platform, ...coreInitializations].map(item => item.state);
  const initializationConflict = initializationStates.includes('conflict'), initializationRequired = initializationStates.includes('uninitialized');
  if (!initialized) result.issues.push({ scope: 'initialization', code: initializationConflict ? 'initialization_conflict'
    : initializationRequired ? 'initialization_required' : 'initialization_unchecked' });
  if (result.current.state === 'observed') for (const item of [result.current.platform, ...result.current.cores, ...result.current.capabilities])
    item.availability = databaseReady && result.runtimeIdentityVerified ? 'available' : 'not_checked';
  const ready = result.runtimeIdentityVerified && databaseReady && initialized && result.issues.length === 0;
  result.state = ready ? 'ready' : conflict ? 'incompatible' : 'incomplete';
  result.exitCode = ready ? 0 : conflict || interrupted || initializationConflict || initializationRequired ? 1 : 2;
  return result;
}

async function readPhasedInstallation(lockFile, lockSha256, environment = process.env) {
  try {
    const api = contracts(), bytes = files.read(lockFile);
    if (files.hash(bytes) !== lockSha256) throw Error('selection_changed');
    const expected = api.deployment.CorePhasedMigrationLockSchema.parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')));
    const value = await requestJson(connection(environment), api.phased.PHASED_INSTALLATION_HTTP.path, undefined, fetch);
    if (files.hash(files.read(lockFile)) !== lockSha256) throw Error('selection_changed');
    return projectPhasedInstallation(value, expected, api);
  } catch (error) {
    return { exitCode: [401, 403].includes(error.statusCode) ? 1 : 2, state: 'unknown',
      reason: error.statusCode === 404 ? 'phased_endpoint_unavailable' : [401, 403].includes(error.statusCode) ? 'current_access_refused'
        : 'phased_observation_unavailable', selectionMatches: false, current: { state: 'unavailable' },
      database: { checked: false, state: 'unknown', applied: null, pending: null, initialization: { state: 'not_checked' } },
      repair: '核原宿主完整 v2 只读接口、当前 SaaS 权限和本地固定锁；未取得可靠观察时不初始化、迁移或启用业务。' };
  }
}
async function readRunningLock(environment = process.env) {
  const api = contracts(), raw = await requestHost(connection(environment), 'catalogue', undefined, fetch);
  const observed = versions(raw, api);
  if (observed.state !== 'observed' || [observed.platform, ...observed.cores, ...observed.capabilities]
    .some(item => item.availability !== 'available' || !item.current) || observed.cores.some(item => !item.registered))
    throw Error('running_lock_unavailable');
  const value = raw.versions;
  for (const entry of [value.platform, ...value.cores, ...(value.dataCapabilities ?? [])])
    if (!isDeepStrictEqual(entry.current, entry.locked)) throw Error('running_lock_conflict');
  return api.core.CoreDeploymentLockSchema.parse({ lockVersion: 1, platform: value.platform.current,
    cores: value.cores.map(item => item.current),
    ...(value.dataCapabilities === undefined ? {} : { dataCapabilities: value.dataCapabilities.map(item => item.current) }) });
}
async function readPreparationReceipt(sha256, environment = process.env) {
  if (!files.HASH.test(sha256 ?? '')) return { exitCode: 2, status: 'unknown' };
  try { return await run({ command: 'receipt', sha256 }, contracts(), environment); }
  catch { return { exitCode: 2, status: 'unknown', sha256 }; }
}

/** 当前成员事实与 SaaS 包目录分读。只消费原会话及 Core 范围读口，不代办授权/绑定/初始化。 */
async function observeMemberReadiness(selection, scopes, api, environment = process.env, fetcher = fetch) {
  if (!selection?.cores?.length || [...scopes.keys()].some(id => !selection.cores.some(core => core.id === id)))
    throw Error('member_selection');
  const connected = connection({ ...environment, PLATFORM_DOCTOR_ACCESS_TOKEN: environment.PLATFORM_DOCTOR_MEMBER_ACCESS_TOKEN });
  const queries = new Map();
  for (const [id, file] of scopes) {
    const query = api.CORE_SCOPE_HTTP.request.parse(JSON.parse(files.read(file, 16384).toString('utf8')));
    if (query.coreId !== id) throw Error('member_scope');
    queries.set(id, query);
  }
  const session = async () => api.CORE_SESSION_HTTP.response.parse(await requestJson(connected, api.CORE_SESSION_HTTP.path, undefined, fetcher));
  const before = await session(), cores = [];
  for (const selected of selection.cores) {
    const entry = before.cores.find(item => item.core.id === selected.id);
    const result = { id: selected.id, access: entry ? 'assigned' : 'not_available_to_member',
      version: entry ? files.version(entry.core.version) : null, versionMatches: entry?.core.version === selected.version,
      deploymentAdmission: entry?.admission.state ?? 'not_checked', tenantGrant: entry?.grant.state ?? 'not_checked',
      memberAssignment: entry?.assignment.state ?? 'not_checked', permissionCount: entry?.permissions.length ?? null,
      binding: 'not_checked', businessReadiness: 'not_checked' };
    cores.push(result);
    if (!entry || !result.versionMatches || entry.admission.state !== 'accepting') continue;
    const query = queries.get(selected.id) ?? { coreId: selected.id };
    if (!api.matchesCoreScope(entry.core.scope, query.container)) { result.reason = 'explicit_container_required'; continue; }
    try {
      const observed = api.CORE_SCOPE_HTTP.response.parse(await requestJson(connected, api.CORE_SCOPE_HTTP.path, query, fetcher));
      if (observed.status === 'bound') {
        if (observed.binding.coreId !== selected.id || observed.binding.tenantId !== before.tenantId
          || !isDeepStrictEqual(observed.binding.container, query.container)) throw Error('scope_mismatch');
        result.businessReadiness = observed.readiness.status;
        if (observed.readiness.status === 'configuration_required') result.missingConfigurationCount = observed.readiness.missing.length;
        // 自由文本/主体/容器/原业务引用不进入公共诊断，详细缺项在当前成员原页面处理。
      }
      result.binding = observed.status;
    } catch (error) {
      result.reason = [401, 403].includes(error.statusCode) ? 'current_access_refused'
        : error.statusCode === 409 ? 'scope_changed' : 'scope_observation_unavailable';
    }
  }
  // Scope 在自己的原授权事务中读取；前后会话事实变化不能拼接成一次成功观察。
  const after = await session();
  const identity = value => ({ tenantId: value.tenantId, subjectId: value.subjectId,
    cores: selection.cores.map(selected => value.cores.find(entry => entry.core.id === selected.id) ?? null) });
  if (!isDeepStrictEqual(identity(before), identity(after))) return { exitCode: 2, state: 'unknown', reason: 'member_context_changed' };
  const ready = cores.every(item => item.versionMatches && item.deploymentAdmission === 'accepting'
    && item.binding === 'bound' && item.businessReadiness === 'ready');
  return { exitCode: ready ? 0 : 1, state: 'observed', authority: 'current-member-session-and-core-scope', cores,
    businessAction: 'not_checked', repair: '按本成员原目录/范围页核授权、角色权限、绑定和 Core 配置；诊断不授予权限或重放业务初始化。' };
}
async function readMemberReadiness(selection, scopes, environment = process.env) {
  try { return await observeMemberReadiness(selection, scopes, contracts().core, environment); }
  catch { return { exitCode: 2, state: 'unknown', reason: 'member_observation_unavailable',
    repair: '核本树正式合同、所选 Core 锁、原 API 地址、当前成员会话与显式范围 JSON；不可用目录不是未授权或空业务的证明。' }; }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { argumentsFor, connection, requestHost, versions, preparation, run, readRunningVersions, readRunningLock, readPreparationReceipt,
  projectPhasedInstallation, readPhasedInstallation,
  observeMemberReadiness, readMemberReadiness, main };
