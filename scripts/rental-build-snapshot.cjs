'use strict';
/** 从固定 Git 树读取发行验证源码，tar 只在内存解析，避免并行作者改动混入本次产物。
 * 归档保持 Git 原字节，不采用本机检出换行；不读取私有 docs 或接受链接、包外路径。 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const selections = ['LICENSE', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'config',
  'packages/core-contracts', 'packages/platform-contracts', 'packages/platform-server', 'packages/core-host',
  'packages/platform-core-host', 'packages/rental-core', 'packages/example-tickets-core', 'packages/shared', 'packages/web-client',
  'packages/platform-admin', 'packages/ui-arc', 'packages/ui-motiq', 'packages/ai-native-data',
  'packages/ai-native-server', 'packages/mcp-server', 'packages/rental-mcp-host',
  'apps/platform-api', 'apps/example-tickets-api', 'apps/example-tickets-admin', 'apps/example-multi-core-api', 'apps/example-multi-core-admin',
  'apps/rental-api', 'apps/rental-admin', 'apps/tenant-website', 'apps/enterprise-portal',
  'apps/admin', 'apps/miniprogram', 'apps/staff-miniprogram',
  'scripts/miniprogram-shared-types.cjs', 'scripts/rental-client-vite.ts', 'scripts/prepare-rental-workspace.cjs'];

function readBuildSnapshot(commit, directory = root, paths = selections, targetRoot = root) {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw Error('构建快照须使用完整固定提交 SHA');
  if (!paths.length || paths.some(file => file !== '.' && (file.startsWith('/') || /[\\:]/u.test(file)
    || file.split('/').some(part => !part || part === '.' || part === '..'))))
    throw Error('构建快照只接受仓库相对文件范围');
  // git archive 也会应用 core.autocrlf；发行摘要与迁移必须比较原提交，不能归一已发布字节。
  const tar = execFileSync('git', ['--no-replace-objects', '-c', 'core.autocrlf=false', 'archive', '--format=tar', commit, '--', ...paths],
    { cwd: directory, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const files = new Map();
  let extra = {};
  const field = (header, at, length) => header.subarray(at, at + length).toString('utf8').replace(/\0.*$/su, '');
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) break;
    const size = parseInt(field(header, 124, 12).trim() || '0', 8), type = field(header, 156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length) throw Error('Git 归档长度无效');
    const bytes = tar.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    if (type === 'g') continue;
    if (type === 'x') {
      extra = {};
      for (let cursor = 0; cursor < bytes.length;) {
        const space = bytes.indexOf(32, cursor), length = Number(bytes.subarray(cursor, space).toString());
        if (space < cursor || !Number.isSafeInteger(length) || length <= 0 || cursor + length > bytes.length)
          throw Error('Git PAX 头无效');
        const entry = bytes.subarray(space + 1, cursor + length - 1).toString('utf8'), split = entry.indexOf('=');
        extra[entry.slice(0, split)] = entry.slice(split + 1); cursor += length;
      }
      continue;
    }
    if (type === '5') { extra = {}; continue; }
    if (type !== '0' && type !== '') throw Error('发行源码归档包含链接或未知条目');
    const prefix = field(header, 345, 155);
    const name = extra.path || (prefix ? prefix + '/' : '') + field(header, 0, 100); extra = {};
    if (name.startsWith('/') || /[\\:]/u.test(name) || name.split('/').some(part => !part || part === '.' || part === '..')
      || /^(?:docs|output)\//u.test(name)
      || /(?:^|\/)(?:node_modules|\.git|\.env(?:\..*)?)(?:\/|$)/u.test(name)) throw Error('Git 快照文件路径不受支持：' + name);
    files.set(slash(path.join(targetRoot, name)), Buffer.from(bytes));
  }
  return snapshotFromFiles(commit, files, targetRoot);
}

/** 固定来源组合后重建目录视图；调用方须先核定每份源码的 Git 身份。 */
function snapshotFromFiles(commit, files, targetRoot = root) {
  const directories = new Map();
  for (const file of files.keys()) {
    if (!file.startsWith(slash(targetRoot) + '/')) throw Error('构建源码越出目标工作区：' + file);
    for (let current = file; current !== slash(targetRoot); current = slash(path.dirname(current))) {
      const parent = slash(path.dirname(current));
      if (!directories.has(parent)) directories.set(parent, new Map());
      directories.get(parent).set(path.basename(current), !files.has(current));
    }
  }
  const entries = directory => directories.get(slash(directory));
  return { commit, files, directories, entries };
}
module.exports = { readBuildSnapshot, snapshotFromFiles };
