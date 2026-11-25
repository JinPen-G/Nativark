'use strict';
/** 原完整组合的本机启动预检。只修复锁定的本树 workspace 源码链接，不安装包或改锁。
 * check/client 可离线运行；settings 才加载原环境接口；run 只调用既有 npm 启动链。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const normalize = file => path.resolve(file).replaceAll('\\', '/').toLowerCase();
const inside = (base, file) => normalize(file).startsWith(normalize(base) + '/');

function localPath(file) {
  const actual = fs.realpathSync(file);
  if (!inside(root, actual)) throw Error('依赖或源码指向另一工作区，不能用于本树启动：' + file);
  // 同磁盘嵌套 worktree 仍是另一棵树，不能因目录前缀相同而接受它的依赖。
  for (let directory = fs.statSync(actual).isDirectory() ? actual : path.dirname(actual); normalize(directory) !== normalize(root); directory = path.dirname(directory))
    if (fs.existsSync(path.join(directory, '.git'))) throw Error('依赖或源码进入嵌套 Git 工作区：' + file);
  return actual;
}

function dependencyCheck(repair = false) {
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
    const source = path.join(root, value.resolved);
    localPath(source);
    const manifest = json(path.join(source, 'package.json'));
    const name = key.slice('node_modules/'.length);
    if (manifest.name !== name || manifest.version !== lock.packages[value.resolved]?.version)
      throw Error('workspace 清单与锁文件不一致：' + name);
    workspaces.set(name, { source, manifest, target: path.join(root, key) });
  }
  const needed = new Set();
  function visit(name) {
    if (needed.has(name)) return;
    const workspace = workspaces.get(name);
    if (!workspace) throw Error('锁文件缺少正式 workspace：' + name);
    needed.add(name);
    const dependencies = { ...workspace.manifest.dependencies, ...workspace.manifest.devDependencies };
    for (const dependency of Object.keys(dependencies)) if (workspaces.has(dependency)) visit(dependency);
    // npm 前置构建还会依赖未列入 runtime dependencies 的工作区。
    for (const script of Object.values(workspace.manifest.scripts ?? {}))
      for (const match of script.matchAll(/(?:-w|--workspace)\s+(@rental-os\/[\w-]+)/gu)) visit(match[1]);
  }
  for (const seed of ['@rental-os/api', '@rental-os/admin', '@rental-os/shared', '@rental-os/mcp-server']) visit(seed);
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

function clientStatus() {
  const client = path.join(root, 'node_modules/.prisma/client/index.d.ts');
  const generatedSchema = path.join(path.dirname(client), 'schema.prisma');
  const sourceSchema = path.join(root, 'apps/api/prisma/schema.prisma');
  if (!fs.existsSync(client) || !fs.existsSync(generatedSchema)) return { client, ready: false, reason: 'missing' };
  localPath(client);
  const { samePrismaSchema } = require('../build-selected-prisma.cjs');
  const ready = samePrismaSchema(fs.readFileSync(generatedSchema, 'utf8'), fs.readFileSync(sourceSchema, 'utf8'));
  return { client, ready, reason: ready ? 'current' : 'schema-changed' };
}

async function settings() {
  const { loadProjectEnvironment, loadViteEnvironment } = require('../../config/environment.cjs');
  const { loadEnv } = await import('vite');
  const api = loadProjectEnvironment({ appDirectory: path.join(root, 'apps/api'), mode: process.env.NODE_ENV });
  const admin = loadViteEnvironment('development', path.join(root, 'apps/admin'), loadEnv);
  const port = (value, fallback) => {
    const number = Number(value ?? fallback);
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw Error('本地启动端口必须为 1–65535');
    return number;
  };
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

function run(script) {
  if (!['dev', 'dev:api', 'dev:admin'].includes(script)) throw Error('不支持的启动脚本');
  const npmCli = process.env.NATIVARK_NPM_CLI;
  if (!npmCli || !fs.existsSync(npmCli)) throw Error('无法定位 npm CLI');
  const child = spawn(process.execPath, [npmCli, 'run', script], {
    cwd: root, env: { ...process.env, PRISMA_GENERATE_SKIP_AUTOINSTALL: '1' }, stdio: 'inherit', windowsHide: true,
  });
  child.on('error', () => { console.error('npm 启动失败，请检查本机 Node/npm 安装'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}

if (require.main === module) (async () => {
  const command = process.argv[2] ?? 'check';
  if (command === 'check' || command === 'repair-links') console.log(JSON.stringify(dependencyCheck(command === 'repair-links')));
  else if (command === 'client') console.log(JSON.stringify(clientStatus()));
  else if (command === 'settings') console.log(JSON.stringify(await settings()));
  else if (command === 'run') run(process.argv[3]);
  else throw Error('未知本地启动检查指令');
})().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { dependencyCheck, clientStatus };
