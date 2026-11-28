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
  const response = await fetcher(connection.origin + '/api/platform/core-packages/' + route, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: { Authorization: 'Bearer ' + connection.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { await response.body?.cancel(); throw Error('host_refused'); }
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
  if (value?.versions?.status !== 'observed') return { state: 'unavailable', repair: '核原宿主 deployment、固定锁、实际包与物理观察供给。' };
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
      repair: '核所选固定包引用、当前组合的实际部署/数据观察及当前 SaaS 权限。' };
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
async function readPreparationReceipt(sha256, environment = process.env) {
  if (!files.HASH.test(sha256 ?? '')) return { exitCode: 2, status: 'unknown' };
  try { return await run({ command: 'receipt', sha256 }, contracts(), environment); }
  catch { return { exitCode: 2, status: 'unknown', sha256 }; }
}
if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { argumentsFor, connection, requestHost, versions, preparation, run, readRunningVersions, readPreparationReceipt, main };
