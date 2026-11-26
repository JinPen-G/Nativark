'use strict';
/** 从固定 Git 对象读取验证源码，批读只驻内存，避免并行作者改动混入本次产物。
 * 归档保持 Git 原字节，不采用本机检出换行；不读取私有 docs 或接受链接、包外路径。 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const slash = file => path.resolve(file).split(path.sep).join('/');
const selections = ['LICENSE', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'config',
  'packages/core-contracts', 'packages/platform-contracts', 'packages/platform-server', 'packages/core-host',
  'packages/platform-core-host', 'packages/rental-core', 'packages/example-tickets-core', 'packages/shared', 'packages/web-client',
  'packages/platform-admin', 'packages/ui-arc', 'packages/ui-motiq', 'packages/ai-native-data',
  'packages/ai-native-server', 'packages/ai-native-admin', 'packages/mcp-server', 'packages/rental-mcp-host',
  'apps/platform-api', 'apps/example-tickets-api', 'apps/example-tickets-admin', 'apps/example-multi-core-api', 'apps/example-multi-core-admin',
  'apps/rental-api', 'apps/rental-admin', 'apps/tenant-website', 'apps/enterprise-portal',
  'apps/admin', 'apps/miniprogram', 'apps/staff-miniprogram',
  'scripts/miniprogram-shared-types.cjs', 'scripts/rental-client-vite.ts', 'scripts/prepare-rental-workspace.cjs'];

function readBuildSnapshot(commit, directory = root, paths = selections, targetRoot = root) {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw Error('构建快照须使用完整固定提交 SHA');
  if (!paths.length || paths.some(file => file !== '.' && (file.startsWith('/') || /[\\:]/u.test(file)
    || file.split('/').some(part => !part || part === '.' || part === '..'))))
    throw Error('构建快照只接受仓库相对文件范围');
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', ...args],
    { cwd: directory, input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (git(['rev-parse', '--verify', commit + '^{commit}']).toString().trim() !== commit)
    throw Error('构建快照不是固定提交对象');
  // 原始对象不受 autocrlf、export-ignore 或工作区属性影响；声明路径丢失不能被静默裁掉。
  const tree = git(['--literal-pathspecs', 'ls-tree', '-r', '-z', commit, '--', ...paths]).toString('utf8');
  const entries = tree.split('\0').filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
    if (!match) throw Error('构建源码只接受普通文件，不接受链接或子模块');
    assertSourcePath(match[3]);
    return { blob: match[2], file: match[3] };
  });
  for (const selected of paths) if (!entries.some(entry => selected === '.' || entry.file === selected || entry.file.startsWith(selected + '/')))
    throw Error('固定源码缺少声明路径：' + selected);
  const objects = git(['cat-file', '--batch'], entries.map(entry => entry.blob).join('\n') + '\n');
  const files = new Map();
  let offset = 0;
  for (const entry of entries) {
    const end = objects.indexOf(10, offset);
    const header = end < 0 ? null : /^([a-f0-9]{40}) blob (\d+)$/u.exec(objects.toString('ascii', offset, end));
    const length = header && Number(header[2]), start = end + 1;
    if (!header || header[1] !== entry.blob || !Number.isSafeInteger(length) || start + length >= objects.length || objects[start + length] !== 10)
      throw Error('Git 源码对象不完整或身份不一致');
    files.set(slash(path.join(targetRoot, entry.file)), Buffer.from(objects.subarray(start, start + length)));
    offset = start + length + 1;
  }
  if (offset !== objects.length) throw Error('Git 源码含未声明对象');
  return snapshotFromFiles(commit, files, targetRoot);
}

function assertSourcePath(name) {
  if (typeof name !== 'string' || name.startsWith('/') || /[\\:\x00-\x1f]/u.test(name)
    || /^(?:docs|output)(?:\/|$)/iu.test(name)
    || name.split('/').some(part => !part || part === '.' || part === '..'
      || /^(?:output|node_modules|\.git|\.env(?:\..*)?)$/iu.test(part)))
    throw Error('Git 快照文件路径不受支持：' + name);
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
module.exports = { readBuildSnapshot, snapshotFromFiles, assertSourcePath, selections };
