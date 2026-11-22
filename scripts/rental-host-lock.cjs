'use strict';
/** 独立宿主的 npm v3 锁投影。只取明确工作区及依赖闭包，保留原版本、下载地址和完整性摘要。
 * 可选 peer 不主动拉入后台或其他宿主；不解析版本、不联网、不安装依赖。 */
const { posix } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta'];

function lockedDependency(lock, owner, name) {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(name)) throw Error('依赖名称无效：' + name);
  let directory = owner;
  while (true) {
    if (posix.basename(directory) !== 'node_modules') {
      const file = posix.join(directory, 'node_modules', name);
      if (Object.hasOwn(lock.packages, file)) return file;
    }
    if (!directory) return undefined;
    directory = posix.dirname(directory);
    if (directory === '.') directory = '';
  }
}

function hostDirectory(host = 'rental') {
  if (host === 'platform') return 'apps/platform-api';
  if (host === 'example-tickets') return 'apps/example-tickets-api';
  if (host === 'rental') return 'apps/rental-api';
  if (host === 'example-multi-core') return 'apps/example-multi-core-api';
  throw Error('未登记的静态宿主组合：' + host);
}

function selectWorkspaces(lock, readMetadata, aiMode, host = 'rental') {
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw Error('独立宿主要求原 npm v3 锁文件');
  if (['platform', 'example-tickets'].includes(host) && aiMode !== 'disabled') throw Error('公共及工单独立宿主不能选装 AI');
  const selected = new Map(), queue = [hostDirectory(host)];
  if (aiMode === 'enabled') queue.push('packages/ai-native-server');
  while (queue.length) {
    const directory = queue.shift();
    if (selected.has(directory)) continue;
    if (!/^(?:apps|packages)\/[a-z0-9-]+$/u.test(directory)) throw Error('非正式工作区路径：' + directory);
    const metadata = readMetadata(directory), entry = lock.packages[directory];
    if (!entry || entry.version !== metadata.version || !metadata.name?.startsWith('@rental-os/'))
      throw Error('工作区身份与原锁不一致：' + directory);
    for (const field of dependencyFields) if (!isDeepStrictEqual(entry[field] || {}, metadata[field] || {}))
      throw Error('工作区依赖与原锁不一致：' + directory + ' ' + field);
    selected.set(directory, metadata);
    const required = { ...metadata.dependencies, ...metadata.optionalDependencies };
    for (const [name, version] of Object.entries(metadata.peerDependencies || {}))
      if (!metadata.peerDependenciesMeta?.[name]?.optional) required[name] = version;
    for (const name of Object.keys(required)) if (name.startsWith('@rental-os/')) {
      const location = lockedDependency(lock, directory, name), link = lock.packages[location];
      if (!link?.link || !link.resolved) throw Error('缺少原工作区链接：' + name);
      queue.push(link.resolved);
    }
  }
  return selected;
}

function projectHostLock(lock, workspaces, aiMode, runtimePeers = [], host = 'rental') {
  if (['platform', 'example-tickets'].includes(host) && aiMode !== 'disabled') throw Error('公共及工单独立宿主不能选装 AI');
  const generator = lock.packages['node_modules/prisma'], client = lock.packages['node_modules/@prisma/client'];
  if (generator?.version !== '5.22.0' || client?.version !== generator.version)
    throw Error('生成器与运行库须使用原锁同一 Prisma 5.22.0');
  const selectedHost = workspaces.get(hostDirectory(host));
  if (!selectedHost) throw Error('实际入口宿主未在所选锁闭包');
  const root = { name: host === 'platform' ? 'platform-host-runtime'
    : host === 'example-tickets' ? 'example-tickets-host-runtime'
    : host === 'rental' ? 'rental-host-runtime' : 'example-multi-core-host-runtime', version: '0.1.0', private: true, license: 'MIT',
    workspaces: [...workspaces.keys()].sort(),
    dependencies: { [selectedHost.name]: selectedHost.version,
      ...(aiMode === 'enabled' ? { '@rental-os/ai-native-server': workspaces.get('packages/ai-native-server').version } : {}) },
    devDependencies: { prisma: generator.version } };
  for (const { owner, name } of runtimePeers) {
    const metadata = workspaces.get(owner), location = lockedDependency(lock, owner, name), entry = lock.packages[location];
    if (!metadata?.peerDependenciesMeta?.[name]?.optional || name.startsWith('@rental-os/') || !entry?.version
      || location !== lockedDependency(lock, '', name)) throw Error('实际运行可选peer不能从原根锁唯一定位：' + name);
    if (root.dependencies[name] && root.dependencies[name] !== entry.version) throw Error('实际运行peer版本冲突：' + name);
    root.dependencies[name] = entry.version;
  }
  return projectWorkspaceLock(lock, workspaces, root);
}

/** 源码开发组合复用同一依赖闭包算法；root 明确列出所选工作区及构建工具。 */
function projectWorkspaceLock(lock, workspaces, root) {
  const entries = { '': root }, reach = new Map(), queue = [['', false, false]];
  // Track production/development and required/optional independently. Old flags
  // describe the entire monorepo; retaining them can silently omit runtime code.
  const enqueue = (file, dev, optional) => queue.push([file, dev, optional]);
  while (queue.length) {
    const [file, dev, optional] = queue.shift(), state = `${Number(dev)}${Number(optional)}`;
    if (reach.get(file)?.has(state)) continue;
    if (!reach.has(file)) reach.set(file, new Set());
    reach.get(file).add(state);
    const entry = file === '' ? root : workspaces.get(file) || lock.packages[file];
    if (!entry) throw Error('原锁缺少依赖：' + file);
    entries[file] = { ...entry };
    if (entry.link) {
      if (!workspaces.has(entry.resolved)) throw Error('依赖越出所选工作区：' + file);
      enqueue(entry.resolved, dev, optional); continue;
    }
    const dependencies = { ...entry.dependencies, ...entry.optionalDependencies };
    const development = file === '' || workspaces.has(file) ? entry.devDependencies || {} : {};
    for (const [name, version] of Object.entries(development)) if (!(name in dependencies)) dependencies[name] = version;
    for (const [name, version] of Object.entries(entry.peerDependencies || {}))
      if (!entry.peerDependenciesMeta?.[name]?.optional && !(name in dependencies)) dependencies[name] = version;
    const bundled = entry.bundleDependencies ?? entry.bundledDependencies;
    for (const name of Object.keys(dependencies)) {
      if (bundled === true || Array.isArray(bundled) && bundled.includes(name)) continue;
      const target = lockedDependency(lock, file, name), isOptional = Object.hasOwn(entry.optionalDependencies || {}, name);
      if (!target) {
        if (isOptional) continue;
        throw Error('原锁缺少依赖：' + file + ' -> ' + name);
      }
      const isDev = Object.hasOwn(development, name) && !Object.hasOwn(entry.dependencies || {}, name)
        && !Object.hasOwn(entry.optionalDependencies || {}, name);
      enqueue(target, dev || isDev, optional || isOptional);
    }
  }
  // npm creates a link for every selected workspace, including a transitively
  // used one. Never invent a link to an unselected author directory.
  for (const [directory, metadata] of workspaces) {
    const location = lockedDependency(lock, '', metadata.name), original = lock.packages[location];
    if (!original?.link || original.resolved !== directory || !entries[directory])
      throw Error('工作区链接与依赖闭包不一致：' + metadata.name);
    entries[location] = { ...original };
  }
  for (const [file, states] of reach) {
    const entry = entries[file];
    if (!file || workspaces.has(file) || entry.link) continue;
    if (!entry.version || !/^https:\/\//u.test(entry.resolved || '') || !/^sha(?:256|384|512)-/u.test(entry.integrity || ''))
      throw Error('外部依赖缺少原锁定版本/HTTPS来源/摘要：' + file);
    const url = new URL(entry.resolved);
    if (url.username || url.password || url.search || url.hash) throw Error('依赖来源不能携带凭据或动态查询');
    delete entry.dev; delete entry.optional; delete entry.devOptional; delete entry.peer;
    if (![...states].some(state => state[0] === '0')) entry.dev = true;
    if (![...states].some(state => state[1] === '0')) entry.optional = true;
    if (!states.has('00') && !entry.dev && !entry.optional) entry.devOptional = true;
  }
  const projected = { name: root.name, version: root.version, lockfileVersion: 3, requires: true,
    packages: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
  return { root, lock: projected };
}

module.exports = { selectWorkspaces, projectHostLock, projectWorkspaceLock, lockedDependency, hostDirectory };
