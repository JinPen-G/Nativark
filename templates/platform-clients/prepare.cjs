'use strict';
/** 准备一个明确选择的客户端源码工作区；复用原 Git 快照和 npm 锁投影。
 * 不安装依赖、读取环境、生成 Prisma、启动服务或判断业务就绪；行业源码只来自固定 Core 提交。 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { readBuildSnapshot, assertSourcePath } = require('../../scripts/rental-build-snapshot.cjs');
const { projectWorkspaceLock, lockedDependency } = require('../../scripts/rental-host-lock.cjs');
const repository = path.resolve(__dirname, '../..');
const surfaces = ['customer-web', 'staff-web', 'wechat-customer', 'wechat-staff'];
const clientDirectories = ['packages/platform-client-contracts', 'packages/platform-client-web',
  ...['rental', 'wechat', ...surfaces].map(name => 'templates/platform-clients/' + name)];
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function snapshot(repo, commit, selected) {
  const root = path.resolve(repo).split(path.sep).join('/');
  return new Map([...readBuildSnapshot(commit, repo, selected, repo).files]
    .map(([file, bytes]) => [file.slice(root.length + 1), bytes]));
}
function metadata(files, file) {
  if (!files.has(file)) throw Error('固定源码缺少 ' + file);
  return JSON.parse(files.get(file).toString('utf8'));
}
function assertMetadata(value, locked, directory) {
  if (!value.name?.startsWith('@rental-os/') || value.version !== locked?.version)
    throw Error('所选包身份与原锁不符：' + directory);
  for (const field of dependencyFields) if (!isDeepStrictEqual(value[field] ?? {}, locked[field] ?? {}))
    throw Error('所选包依赖与原锁不符：' + directory + ' ' + field);
}

function prepareClientWorkspace(options) {
  if (!surfaces.includes(options.surface)) throw Error('必须明确选择 customer-web、staff-web、wechat-customer 或 wechat-staff');
  const clientRepo = options.clientRepo ?? repository;
  const platformRepo = options.platformRepo ?? clientRepo, platformCommit = options.platformCommit ?? options.clientCommit;
  if (!options.rentalRepo || !options.rentalCommit) throw Error('首个 Rental 接线须提供独立仓目录与完整固定 SHA');
  const base = snapshot(platformRepo, platformCommit, ['package.json', 'package-lock.json']);
  const client = snapshot(clientRepo, options.clientCommit, ['package-lock.json', 'templates/platform-clients/rental/config.ts',
    ...clientDirectories.map(directory => directory + '/package.json')]);
  const rental = snapshot(options.rentalRepo, options.rentalCommit, ['package.json']);
  const originalLock = metadata(base, 'package-lock.json'), candidate = metadata(client, 'package-lock.json');
  if (originalLock.lockfileVersion !== 3 || candidate.lockfileVersion !== 3) throw Error('客户端准备要求原 npm v3 锁');
  const lock = { ...originalLock, packages: { ...originalLock.packages } };
  const definitions = new Map();
  // 只叠加客户端拥有的锁条目；其他底座包仍来自所选固定底座，不采用客户端分支的活动副本。
  for (const directory of clientDirectories) {
    const value = metadata(client, directory + '/package.json');
    assertMetadata(value, candidate.packages[directory], directory);
    const link = 'node_modules/' + value.name;
    if (!candidate.packages[link]?.link || candidate.packages[link].resolved !== directory)
      throw Error('缺少原客户端工作区链接：' + value.name);
    definitions.set(directory, value);
    lock.packages[directory] = candidate.packages[directory]; lock.packages[link] = candidate.packages[link];
  }
  const wxTypes = 'node_modules/miniprogram-api-typings';
  if (lock.packages[wxTypes] && !isDeepStrictEqual(lock.packages[wxTypes], candidate.packages[wxTypes]))
    throw Error('微信类型原锁存在冲突，不能重新解析版本');
  lock.packages[wxTypes] = candidate.packages[wxTypes];
  const core = metadata(rental, 'package.json'), coreDirectory = 'packages/rental-core';
  const bridge = definitions.get('templates/platform-clients/rental');
  const config = client.get('templates/platform-clients/rental/config.ts').toString('utf8');
  if (core.name !== '@rental-os/rental-core' || bridge.peerDependencies[core.name] !== core.version
    || !config.includes(`RENTAL_CLIENT_SOURCE = "${options.rentalCommit}"`)
    || !config.includes(`RENTAL_CLIENT_VERSION = "${core.version}"`)
    || core.exports?.['./clients/contribution'] !== './clients/contribution/index.ts')
    throw Error('Rental 固定来源、版本或正式贡献出口与当前模板不符');
  if (lock.packages[coreDirectory] || lock.packages['node_modules/' + core.name])
    throw Error('底座锁已经含 Rental，不能覆盖既有业务来源');
  definitions.set(coreDirectory, core);
  lock.packages[coreDirectory] = core;
  lock.packages['node_modules/' + core.name] = { resolved: coreDirectory, link: true };

  const selected = new Map(), entry = 'templates/platform-clients/' + options.surface, queue = [entry, coreDirectory];
  while (queue.length) {
    const directory = queue.shift();
    if (selected.has(directory)) continue;
    if (!/^(?:packages\/[a-z0-9-]+|templates\/platform-clients\/[a-z0-9-]+)$/u.test(directory))
      throw Error('依赖越出客户端源码范围：' + directory);
    const value = definitions.get(directory) ?? metadata(snapshot(platformRepo, platformCommit, [directory + '/package.json']), directory + '/package.json');
    assertMetadata(value, lock.packages[directory], directory);
    selected.set(directory, value);
    const dependencies = { ...value.dependencies, ...value.devDependencies, ...value.optionalDependencies };
    for (const [name, version] of Object.entries(value.peerDependencies ?? {}))
      if (!value.peerDependenciesMeta?.[name]?.optional) dependencies[name] = version;
    for (const name of Object.keys(dependencies)) {
      const linked = lock.packages[lockedDependency(lock, directory, name)];
      if (linked?.link) queue.push(linked.resolved);
    }
  }
  if (surfaces.some(surface => surface !== options.surface && selected.has('templates/platform-clients/' + surface)))
    throw Error('单端准备不得隐式选中其他客户端入口');
  const leaf = selected.get(entry), shared = options.surface.startsWith('wechat-') ? '@rental-os/platform-client-wechat' : '@rental-os/platform-client-web';
  const buildContracts = ['core-contracts', 'platform-contracts', 'platform-client-contracts']
    .map(name => `npm run build -w @rental-os/${name}`).join(' && ');
  const root = { name: 'zelo-client-' + options.surface, version: '0.1.0', private: true, license: 'MIT',
    workspaces: [...selected.keys()].sort(), dependencies: { [leaf.name]: leaf.version, [core.name]: core.version },
    scripts: { 'build:contracts': buildContracts,
      lint: `npm run build:contracts && npm run lint -w ${shared} && npm run lint -w ${bridge.name} && npm run lint -w ${leaf.name}`,
      build: `npm run lint && npm run build -w ${leaf.name}` } };
  const projected = projectWorkspaceLock(lock, selected, root, { verifySpecifications: true });
  const files = new Map();
  const add = (source, prefix = '') => {
    for (const [name, bytes] of source) {
      const file = prefix + name; assertSourcePath(file);
      if (files.has(file)) throw Error('客户端源码来源重叠：' + file);
      files.set(file, bytes);
    }
  };
  add(snapshot(platformRepo, platformCommit, ['LICENSE', 'tsconfig.base.json', ...[...selected.keys()]
    .filter(directory => directory !== coreDirectory && !clientDirectories.includes(directory))]));
  add(snapshot(clientRepo, options.clientCommit, [...selected.keys()].filter(directory => clientDirectories.includes(directory))));
  // 原包元数据和领域类型原样保留；不调用 Core 的服务端构建、其他端入口或安装脚本。
  add(snapshot(options.rentalRepo, options.rentalCommit, ['package.json', 'LICENSE', 'src', 'clients/contribution']), coreDirectory + '/');
  files.set('package.json', json(projected.root)); files.set('package-lock.json', json(projected.lock));
  const provenance = { format: 'zelo-client-workspace-1', surface: options.surface,
    client: { repository: 'https://github.com/JinPen-G/Zelo', commit: options.clientCommit },
    platform: { repository: 'https://github.com/JinPen-G/Zelo', commit: platformCommit },
    rental: { repository: 'https://github.com/JinPen-G/Zelo-rental-core', commit: options.rentalCommit, version: core.version },
    workspaces: root.workspaces,
    sourceLocks: { platform: hash(base.get('package-lock.json')), client: hash(client.get('package-lock.json')) },
    selectedLock: hash(files.get('package-lock.json')), installed: false, built: false, hostChecked: false, a03Accepted: false };
  files.set('client.workspace.json', json(provenance));
  files.set('README.md', Buffer.from(`# ${options.surface} 客户端源码工作区\n\n`
    + '固定来源和所选 workspace 见 [client.workspace.json](client.workspace.json)。这只是单端源码准备，不表示安装、业务宿主或 A03 验收通过。\n\n'
    + '使用 Node 24.13.0，在本工作区显式执行 `npm ci --ignore-scripts --no-audit --no-fund`，再执行 `npm run build`。'
    + '不要对全部 workspace 执行构建；本入口只构建公共合同及所选客户端，不生成 Prisma 或启动 API。\n\n'
    + `将已获授权的 HTTPS 宿主设置填入 [connection.ts](${entry}/connection.ts) 后重新构建。`
    + `产物位于 ${entry}/dist。微信另需本端已授权 AppID、合法域名、开发者工具与真机证据。\n\n`
    + `接入、当前固定组合缺项及会话/原收据边界见 [同版公开说明](https://github.com/JinPen-G/Zelo/blob/${options.clientCommit}/templates/platform-clients/README.md)。`
    + '单端工作区中的 Rental 源码来自独立仓固定提交，只消费其正式贡献出口；不编辑此副本替代独立仓交付。\n'));
  return { files, provenance };
}

function writeWorkspace(output, files) {
  if (!path.isAbsolute(output)) throw Error('输出须为尚不存在的绝对目录');
  const target = path.resolve(output);
  if (target.split(path.sep).some(part => /^(?:docs|node_modules|\.git)$/iu.test(part))) throw Error('输出不能位于资料或依赖目录');
  // 目标的父目录须预先明确创建；不穿过 junction/symlink，也不在已有目录填充或覆盖。
  for (let current = path.dirname(target); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('输出父路径必须是普通目录：' + current);
    if (path.dirname(current) === current) break;
  }
  const written = [], directories = [target];
  fs.mkdirSync(target);
  try {
    for (const [name, bytes] of files) {
      assertSourcePath(name);
      const file = path.resolve(target, name);
      if (!file.startsWith(target + path.sep)) throw Error('输出文件越界');
      const parents = [target];
      for (let current = path.dirname(file); current !== target; current = path.dirname(current)) parents.splice(1, 0, current);
      for (const directory of parents) {
        if (!fs.existsSync(directory)) { fs.mkdirSync(directory); directories.push(directory); }
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('输出目录不能是链接：' + directory);
      }
      fs.writeFileSync(file, bytes, { flag: 'wx' }); written.push([file, bytes]);
    }
  } catch (error) {
    // 仅撤回本次创建且仍为原字节的文件；并发改动或清理失败留原位并明确报错。
    try {
      for (const [file, bytes] of written.reverse()) {
        if (!fs.lstatSync(file).isFile() || !fs.readFileSync(file).equals(bytes)) throw Error('输出已变化：' + file);
        fs.unlinkSync(file);
      }
      for (const directory of directories.reverse()) fs.rmdirSync(directory);
    } catch (cleanup) { throw Error(`${error.message}；部分输出仍在 ${target}，清理未完成：${cleanup.message}`); }
    throw error;
  }
}

function argumentsOf(args) {
  const options = {}, names = { '--surface': 'surface', '--client-repo': 'clientRepo', '--client-commit': 'clientCommit',
    '--platform-repo': 'platformRepo', '--platform-commit': 'platformCommit', '--rental-repo': 'rentalRepo', '--rental-commit': 'rentalCommit', '--out': 'out' };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--plan' && !options.plan) { options.plan = true; continue; }
    const key = names[flag], value = args[++index];
    if (!key || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw Error('未知、重复或缺值的客户端准备选项');
    options[key] = value;
  }
  if (!!options.platformRepo !== !!options.platformCommit || options.plan && options.out || !options.plan && !options.out)
    throw Error('独立底座须同时指定目录和固定 SHA；选择 --plan 或 --out <新绝对目录>');
  return options;
}
function main(args) {
  const options = argumentsOf(args), result = prepareClientWorkspace(options);
  if (!options.plan) writeWorkspace(options.out, result.files);
  return { ...result.provenance, state: options.plan ? 'planned' : 'source_prepared', files: result.files.size,
    ...(options.out ? { output: path.resolve(options.out) } : {}) };
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareClientWorkspace, writeWorkspace, argumentsOf, main };
