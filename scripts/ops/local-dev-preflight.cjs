'use strict';
/** 本机启动预检及零 Core 根命令。依赖和 Client 按宿主分开；旧组合显式选择。
 * 公共库先核原账与结构。启动不迁移或初始化；公共生成只创建本树的新 Client。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const normalize = file => process.platform === 'win32' ? path.resolve(file).replaceAll('\\', '/').toLowerCase() : path.resolve(file);
const inside = (base, file) => normalize(file).startsWith(normalize(base) + '/');
const profiles = {
  platform: { api: 'apps/platform-api', client: 'apps/platform-api/generated/client',
    seeds: ['@rental-os/platform-api', '@rental-os/platform-admin-app'] },
  legacy: { api: 'apps/api', client: 'node_modules/.prisma/client',
    seeds: ['@rental-os/api', '@rental-os/admin', '@rental-os/shared', '@rental-os/mcp-server'] },
};
const publicApi = path.join(root, profiles.platform.api);
const publicClient = path.join(root, profiles.platform.client);
const publicSchema = path.join(publicApi, 'prisma/schema.prisma');
const requirePublic = createRequire(path.join(publicApi, 'package.json'));

function localPath(file) {
  const actual = fs.realpathSync(file);
  if (!inside(root, actual)) throw Error('依赖或源码指向另一工作区，不能用于本树启动：' + file);
  // 同磁盘嵌套 worktree 仍是另一棵树，不能因目录前缀相同而接受它的依赖。
  for (let directory = fs.statSync(actual).isDirectory() ? actual : path.dirname(actual); normalize(directory) !== normalize(root); directory = path.dirname(directory))
    if (fs.existsSync(path.join(directory, '.git'))) throw Error('依赖或源码进入嵌套 Git 工作区：' + file);
  return actual;
}

function dependencyCheck(profile = 'platform', repair = false) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 12) throw Error('本地启动要求 Node.js 22.12+');
  const lock = json(path.join(root, 'package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages) throw Error('启动要求现有 npm v3 锁文件');
  const modules = path.join(root, 'node_modules');
  if (!fs.existsSync(modules)) throw Error('缺少本树依赖；请先按 README 安装锁定依赖。启动脚本不会下载或清空 node_modules。');
  localPath(modules);
  const workspaces = new Map();
  for (const [key, value] of Object.entries(lock.packages)) {
    if (!value.link || !key.startsWith('node_modules/')) continue;
    if (!/^(?:apps|packages)\/[^/]+$/u.test(value.resolved ?? '')) throw Error('锁文件 workspace 路径不属于本树：' + key);
    const name = key.slice('node_modules/'.length);
    workspaces.set(name, { relative: value.resolved, target: path.join(root, key) });
  }
  const needed = new Set();
  function visit(name) {
    if (needed.has(name)) return;
    const workspace = workspaces.get(name);
    if (!workspace) throw Error('锁文件缺少正式 workspace：' + name);
    const source = localPath(path.join(root, workspace.relative));
    const manifest = json(path.join(source, 'package.json'));
    if (manifest.name !== name || manifest.version !== lock.packages[workspace.relative]?.version)
      throw Error('workspace 清单与锁文件不一致：' + name);
    Object.assign(workspace, { source, manifest });
    needed.add(name);
    const dependencies = { ...workspace.manifest.dependencies, ...workspace.manifest.devDependencies };
    for (const dependency of Object.keys(dependencies)) if (workspaces.has(dependency)) visit(dependency);
    // npm 前置构建还会依赖未列入 runtime dependencies 的工作区。
    for (const script of Object.values(workspace.manifest.scripts ?? {}))
      for (const match of script.matchAll(/(?:-w|--workspace)\s+(@rental-os\/[\w-]+)/gu)) visit(match[1]);
  }
  for (const seed of profiles[profile].seeds) visit(seed);
  const missing = [], links = [];
  const checkExternal = (name, directory) => {
    const requireFrom = createRequire(path.join(directory, 'package.json'));
    const candidate = requireFrom.resolve.paths(name)?.map(base => path.join(base, name, 'package.json')).find(file => fs.existsSync(file));
    if (!candidate) { missing.push(name); return; }
    localPath(candidate);
    const relative = path.relative(root, candidate).replaceAll('\\', '/').replace(/\/package\.json$/u, '');
    const installed = json(candidate);
    if (!lock.packages[relative] || lock.packages[relative].version !== installed.version)
      missing.push(name + '（本地版本与锁文件不一致）');
  };
  for (const name of needed) {
    const { source, manifest, target } = workspaces.get(name);
    let existing;
    try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (normalize(fs.realpathSync(target)) !== normalize(source)) throw Error('workspace 链接不是当前树的源码，拒绝覆盖：' + name);
    } else links.push({ name, source, target });
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }))
      if (!workspaces.has(dependency)) checkExternal(dependency, source);
  }
  for (const name of ['concurrently', 'typescript']) checkExternal(name, root);
  if (missing.length) throw Error('缺少或不匹配的外部依赖：' + [...new Set(missing)].join('、') + '。请按锁文件准备本树依赖；启动脚本不会联网安装。');
  // 所有校验通过后才补缺失链接；既有目录和错误链接绝不删除或改向。
  if (repair) for (const link of links) {
    fs.mkdirSync(path.dirname(link.target), { recursive: true });
    localPath(path.dirname(link.target));
    fs.symlinkSync(link.source, link.target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { workspaces: needed.size, missingLinks: links.map(link => link.name), repaired: repair ? links.length : 0 };
}

function clientStatus(profile = 'platform') {
  const selected = profiles[profile];
  const client = path.join(root, selected.client, 'index.d.ts');
  const generatedSchema = path.join(path.dirname(client), 'schema.prisma');
  const sourceSchema = path.join(root, selected.api, 'prisma/schema.prisma');
  const files = [client, generatedSchema, path.join(path.dirname(client), 'index.js')];
  if (profile === 'platform' && fs.existsSync(`${publicClient}.generating`)) return { client, ready: false, reason: 'generating' };
  if (files.some(file => !fs.existsSync(file))) return { client, ready: false, reason: 'missing' };
  files.forEach(localPath);
  const { samePrismaSchema } = require('../build-selected-prisma.cjs');
  const ready = samePrismaSchema(fs.readFileSync(generatedSchema, 'utf8'), fs.readFileSync(sourceSchema, 'utf8'));
  return { client, ready, reason: ready ? 'current' : 'schema-changed' };
}

function port(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw Error('本地启动端口必须为 1–65535');
  return number;
}

async function legacySettings() {
  const { loadProjectEnvironment, loadViteEnvironment } = require('../../config/environment.cjs');
  const { loadEnv } = await import('vite');
  const api = loadProjectEnvironment({ appDirectory: path.join(root, 'apps/api'), mode: process.env.NODE_ENV });
  const admin = loadViteEnvironment('development', path.join(root, 'apps/admin'), loadEnv);
  let mysqlPort = 3306;
  if (api.DATABASE_URL) {
    let database;
    try { database = new URL(api.DATABASE_URL); } catch { throw Error('DATABASE_URL 配置无效'); }
    if (database.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname))
      throw Error('本地启动脚本仅接受回环地址的 MySQL，不能启动连接远端业务库。');
    mysqlPort = port(database.port || undefined, 3306);
  }
  return { apiPort: port(api.API_PORT, 3000), adminPort: port(process.env.PORT ?? admin.REACT_ADMIN_PORT, 5175), mysqlPort };
}

function runNode(args, { cwd = root, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', () => reject(Error('本机 Node 子命令启动失败')));
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`本机子命令失败（退出码 ${code ?? '未知'}）`)));
  });
}

function npmRun(args, env = process.env) {
  const npmCli = process.env.NATIVARK_NPM_CLI || process.env.npm_execpath;
  if (!npmCli || !fs.existsSync(npmCli)) throw Error('无法定位 npm CLI');
  return runNode([npmCli, 'run', ...args], { env });
}

function publicDatabaseUrl() {
  let url;
  try { url = new URL(process.env.ZELO_PLATFORM_DATABASE_URL ?? ''); } catch { /* 只报告配置名。 */ }
  if (!url || url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !url.username || url.hash
      || !/^\/zelo_platform_[a-z0-9_]{1,50}$/u.test(url.pathname)) {
    throw Error('ZELO_PLATFORM_DATABASE_URL 必须显式指向 127.0.0.1 上独立的 zelo_platform_* MySQL 库。');
  }
  // Prisma 的 socket 等选项可能改变实际连接端点，因此此入口只允许明确的池大小。
  if ([...url.searchParams].some(([key, value]) => key !== 'connection_limit' || !/^[1-9]\d*$/u.test(value))
      || url.searchParams.getAll('connection_limit').length > 1) throw Error('公共本地库连接串只接受单一 connection_limit 选项。');
  port(url.port || undefined, 3306);
  return url;
}

function publicSettings() {
  const apiPort = port(process.env.ZELO_PLATFORM_API_PORT, 3091);
  const adminPort = port(process.env.ZELO_PLATFORM_WEB_PORT, 5176);
  if (apiPort === adminPort) throw Error('公共 API 与管理端须使用不同端口。');
  return { apiPort, adminPort };
}

function publicEnvironment(database, development = false) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(?:PRISMA_|RENTAL_PRISMA_)/iu.test(name)) delete env[name];
  }
  const { apiPort, adminPort } = publicSettings();
  Object.assign(env, {
    DATABASE_URL: database?.href ?? 'mysql://offline:offline@127.0.0.1:1/zelo_platform_offline',
    ZELO_PLATFORM_PROCESS_ENV: '1', API_PORT: String(apiPort), PORT: String(adminPort),
    API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`, PLATFORM_DATA_SOURCE: 'mysql',
    VITE_API_BASE_URL: development ? '/api' : env.VITE_API_BASE_URL ?? '/api',
    PRISMA_GENERATE_SKIP_AUTOINSTALL: '1', PRISMA_DISABLE_TELEMETRY: '1', CHECKPOINT_DISABLE: '1',
  });
  if (development) env.NODE_ENV = 'development';
  return env;
}

function assertExplicitPublicEnvironment() {
  // Prisma 5 CLI 会从执行目录的 package.json 旁及 schema 旁查找 .env。
  localPath(path.join(publicApi, 'package.json'));
  for (const file of ['.env', 'prisma/.env']) {
    if (fs.existsSync(path.join(publicApi, file))) throw Error('公共根命令使用显式进程配置，请将公共宿主目录中的 .env 移出该入口。');
  }
}

async function publicPrisma(args, env) {
  assertExplicitPublicEnvironment();
  const cli = localPath(requirePublic.resolve('prisma/build/index.js'));
  const fromCli = createRequire(cli);
  const engines = fromCli(localPath(fromCli.resolve('@prisma/engines')));
  const platform = fromCli(localPath(fromCli.resolve('@prisma/get-platform')));
  const target = await platform.getBinaryTargetForCurrentPlatform();
  const directory = engines.getEnginesPath();
  const schemaEngine = path.join(directory, `schema-engine-${target}${target === 'windows' ? '.exe' : ''}`);
  const queryEngine = path.join(directory, platform.getNodeAPIName(target, 'fs'));
  if (![schemaEngine, queryEngine].every(file => fs.existsSync(file))) throw Error('本树锁定的 Prisma 引擎尚未准备好。');
  await runNode([cli, ...args, '--schema', localPath(publicSchema)], { cwd: publicApi, env: {
    ...env, PRISMA_SCHEMA_ENGINE_BINARY: localPath(schemaEngine), PRISMA_QUERY_ENGINE_LIBRARY: localPath(queryEngine),
  } });
}

async function generatePublicClient(env) {
  if (clientStatus().ready) { console.log('复用与公共 schema 一致的 Client。'); return; }
  localPath(publicApi);
  const directory = path.dirname(publicClient);
  fs.mkdirSync(directory, { recursive: true });
  if (normalize(localPath(directory)) !== normalize(directory)) throw Error('公共 Client 目录不能重定向。');
  const lock = `${publicClient}.generating`;
  const marker = fs.openSync(lock, 'wx');
  let created = false;
  try {
    // 独占创建目录。旧版本、半成品和共享链接都留给持有者核定，生成器从不替换。
    fs.mkdirSync(publicClient);
    created = true;
    await publicPrisma(['generate'], env);
  } catch (error) {
    if (created && normalize(localPath(publicClient)) === normalize(publicClient)) fs.rmSync(publicClient, { recursive: true });
    if (error.code === 'EEXIST') throw Error('公共 Client 目录已存在，请先关闭使用方并核定旧产物。');
    throw error;
  } finally {
    fs.closeSync(marker);
    fs.unlinkSync(lock);
  }
}

async function publicDatabaseState(url) {
  assertExplicitPublicEnvironment();
  if (!clientStatus().ready) throw Error('请先执行 npm run db:generate 准备公共 Client。');
  const dataPlan = path.join(publicApi, 'dist/platform-data.js');
  if (!fs.existsSync(dataPlan)) throw Error('请先构建公共 API，以核对原迁移及数据结构。');
  const { createPublicPlatformDataPlan } = require(localPath(dataPlan));
  const plan = createPublicPlatformDataPlan();
  const migrationDirectory = path.join(publicApi, 'prisma/migrations');
  const migrations = fs.readdirSync(migrationDirectory, { withFileTypes: true });
  if (migrations.some(entry => !plan.migrationNames.includes(entry.name) && !(entry.name === 'migration_lock.toml' && entry.isFile()))
      || plan.migrationNames.some(name => !migrations.some(entry => entry.name === name && entry.isDirectory()))) {
    throw Error('公共迁移目录与已构建的数据计划不一致。');
  }
  const { mysqlStructureFromMigrations, readMysqlPhysicalData } = requirePublic('@rental-os/platform-core-host');
  const { PrismaClient } = require(publicClient);
  const client = new PrismaClient({ datasourceUrl: url.href });
  const mismatch = Error('目标库不是空库或账与结构一致的公共开发库，请核对专用数据库。');
  try {
    const objects = await client.$queryRaw`
      SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
      UNION ALL SELECT ROUTINE_NAME, 'ROUTINE' FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()
      UNION ALL SELECT EVENT_NAME, 'EVENT' FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()
      UNION ALL SELECT TRIGGER_NAME, 'TRIGGER' FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`;
    if (!objects.length) return { applied: 0, pending: plan.migrationNames.length };
    if (!objects.some(row => row.name === '_prisma_migrations' && row.kind === 'BASE TABLE')) throw mismatch;
    const receipts = await client.$queryRaw`
      SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS rolledBack,
        (logs IS NOT NULL AND logs <> '') AS failed FROM _prisma_migrations ORDER BY started_at, id
        LIMIT ${plan.migrationNames.length + 1}`;
    if (!receipts.length || receipts.some((row, index) => row.name !== plan.migrationNames[index]
        || row.checksum !== plan.data.migrations[index]?.sha256 || !row.finished || row.rolledBack || Number(row.failed))) throw mismatch;
    const expected = mysqlStructureFromMigrations(plan.data.migrations.slice(0, receipts.length).map(migration =>
      fs.readFileSync(path.join(publicApi, migration.file), 'utf8')));
    const tables = new Set(expected.map(table => table.name).concat('_prisma_migrations'));
    if (objects.length !== tables.size || objects.some(row => row.kind !== 'BASE TABLE' || !tables.has(row.name))
        || !await readMysqlPhysicalData(client, expected, plan.data.version)) throw mismatch;
    return { applied: receipts.length, pending: plan.migrationNames.length - receipts.length };
  } catch (error) {
    if (error === mismatch) throw error;
    throw Error('无法读取公共开发库的原迁移账和结构，请检查本地数据库与账号权限。');
  } finally { await client.$disconnect(); }
}

async function runProfile(profile, script) {
  if (!['dev', 'dev:api', 'dev:admin'].includes(script)) throw Error('不支持的启动脚本');
  if (profile === 'legacy') return npmRun([script.replace(/^dev/u, 'dev:legacy')], { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' });
  const database = script === 'dev:admin' ? undefined : publicDatabaseUrl();
  const env = publicEnvironment(database, true);
  if (!database) return npmRun(['dev', '-w', '@rental-os/platform-admin-app'], env);
  if (!env.AUTH_TOKEN_SECRET?.trim()) throw Error('启动公共 API 前须显式设置 AUTH_TOKEN_SECRET。');
  if (!clientStatus().ready) throw Error('请先执行 npm run db:generate 准备公共 Client。');
  await npmRun(['build:platform-api'], env);
  if ((await publicDatabaseState(database)).pending) throw Error('公共开发库迁移尚未完成，请显式执行 npm run db:migrate:deploy。');
  if (script === 'dev:api') return npmRun(['start', '-w', '@rental-os/platform-api'], env);
  const manifest = localPath(require.resolve('concurrently/package.json'));
  return runNode([path.resolve(path.dirname(manifest), json(manifest).bin.concurrently), '-k', '-n', 'api,admin',
    'npm run start -w @rental-os/platform-api', 'npm run dev --ignore-scripts -w @rental-os/platform-admin-app'], { env });
}

async function platformCommand(command) {
  if (command === 'build-admin') return npmRun(['build', '-w', '@rental-os/platform-admin-app'], publicEnvironment());
  if (command === 'generate') return generatePublicClient(publicEnvironment());
  if (command === 'validate') return publicPrisma(['validate'], publicEnvironment());
  if (!['migration-status', 'migrate', 'initialize'].includes(command)) throw Error('未知公共启动检查指令');
  const database = publicDatabaseUrl();
  const state = await publicDatabaseState(database);
  if (command === 'migration-status') { console.log(JSON.stringify(state)); return; }
  const env = publicEnvironment(database);
  if (command === 'migrate') return publicPrisma(['migrate', 'deploy'], env);
  if (state.pending) throw Error('公共开发库迁移尚未完成。');
  return npmRun(['initialize', '-w', '@rental-os/platform-api'], env);
}

if (require.main === module) (async () => {
  const args = process.argv.slice(2);
  const profile = ['platform', 'legacy'].includes(args[0]) ? args.shift() : 'platform';
  const [command = 'check', script] = args;
  if (command === 'check' || command === 'repair-links') console.log(JSON.stringify(dependencyCheck(profile, command === 'repair-links')));
  else if (command === 'client') console.log(JSON.stringify(clientStatus(profile)));
  else if (command === 'settings') console.log(JSON.stringify(profile === 'legacy' ? await legacySettings() : {
    ...publicSettings(), mysqlPort: port(publicDatabaseUrl().port || undefined, 3306),
  }));
  else if (command === 'run') await runProfile(profile, script);
  else if (profile === 'platform') await platformCommand(command);
  else throw Error('未知原组合启动检查指令');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { dependencyCheck, clientStatus };
