'use strict';
/** 诊断的本地读取边界：只读普通文件与本地 Git 身份，不读环境文件或执行包入口。
 * 报告只投影固定字段；底层异常、配置值及未审 URL 不传给终端。
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const FILE_LIMIT = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$(?![\s\S])/u;
const COMMIT = /^[a-f0-9]{40}$(?![\s\S])/u;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$(?![\s\S])/u;
const version = value => typeof value === 'string' && value.length <= 64 && /^\d+\.\d+\.\d+$(?![\s\S])/u.test(value) ? value : null;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function ordinary(file, directory = false) {
  const absolute = path.resolve(file);
  if (/^(?:\\\\|\/\/)/u.test(absolute)) throw Error('non_local_path');
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    if (/^\.env(?:\.|$)/iu.test(part) && part !== '.env.example') throw Error('environment_file');
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('linked_path');
  }
  const stat = fs.lstatSync(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw Error('not_ordinary');
  return { absolute, stat };
}

function read(file, limit = FILE_LIMIT) {
  const { absolute, stat } = ordinary(file);
  if (stat.size > limit) throw Error('file_limit');
  const bytes = fs.readFileSync(absolute);
  if (bytes.length > limit) throw Error('file_limit');
  return bytes;
}
const json = file => JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/u, ''));
const exists = file => {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
};
function relativeFile(root, name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\\<>:"|?*#%\x00-\x1f\x7f]/u.test(name)
      // 根 docs 不属于公开发行；包内原清单的公开说明仍按原文件摘要读取。
      || name.split('/')[0].toLowerCase() === 'docs'
      || name.split('/').some(part => !part || part === '.' || part === '..'
        || part.trim() !== part || part.endsWith('.') || ['.git', 'node_modules'].includes(part.toLowerCase())
        || /^\.env(?:\.|$)/iu.test(part) && part !== '.env.example')) throw Error('unsafe_relative_path');
  const target = path.resolve(root, name);
  if (!inside(root, target)) throw Error('outside_root');
  return target;
}

function source(value) {
  // Only a syntactically restricted GitHub repository identity is printable.
  // This does not establish whether the repository is public or trusted.
  const repository = typeof value?.repository === 'string' && value.repository.length <= 500
    && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$(?![\s\S])/u.test(value.repository)
    ? value.repository : null;
  return { repository, repositoryHidden: Boolean(value?.repository) && !repository,
    commit: typeof value?.commit === 'string' && COMMIT.test(value.commit) ? value.commit : null };
}

function gitIdentity(root) {
  if (!exists(path.join(root, '.git'))) return null;
  const git = args => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', '-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const commit = git(['rev-parse', '--verify', 'HEAD']);
  if (!COMMIT.test(commit) || path.relative(root, git(['rev-parse', '--show-toplevel'])) !== '') throw Error('git_identity');
  let repository;
  try { repository = git(['remote', 'get-url', 'origin']); } catch { /* A checkout may have no remote. */ }
  return { ...source({ repository, commit }), trackedChanges: Boolean(git(['status', '--porcelain=v1', '--untracked-files=no'])),
    untrackedFilesChecked: false, remoteChecked: false };
}

function verifyReceipt(root, receipt) {
  const identity = receipt.source ?? receipt.platform?.source;
  if (!COMMIT.test(identity?.commit ?? '') || !version(receipt.version ?? receipt.platform?.versions?.platform ?? receipt.platform?.version)) throw Error('receipt_identity');
  const repository = new URL(identity?.repository);
  if (repository.protocol !== 'https:' || repository.username || repository.password || repository.search || repository.hash) throw Error('receipt_source');
  if (!Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > 5000) throw Error('receipt_files');
  const seen = new Set();
  let total = 0;
  for (const entry of receipt.files) {
    const name = entry.path ?? entry.file;
    const file = relativeFile(root, name), key = name.toLowerCase();
    if (seen.has(key) || !HASH.test(entry.sha256 ?? '')) throw Error('receipt_entry');
    seen.add(key);
    const bytes = read(file, Math.min(FILE_LIMIT, 128 * 1024 * 1024 - total));
    total += bytes.length;
    if (hash(bytes) !== entry.sha256) throw Error('receipt_digest');
  }
  if (!seen.has('package.json') || !seen.has('package-lock.json')) throw Error('receipt_lock');
  return { files: seen.size, bytes: total };
}

/** Resolve a dependency only inside this checkout. npm workspace links may point
 * to this tree, but parent node_modules and nested worktrees are never reused. */
function localDependency(root, file) {
  const actual = fs.realpathSync(file);
  if (!inside(root, actual)) throw Error('foreign_dependency');
  for (let directory = path.dirname(actual); path.relative(root, directory) !== ''; directory = path.dirname(directory)) {
    if (exists(path.join(directory, '.git'))) throw Error('nested_worktree');
  }
  return actual;
}

module.exports = { FILE_LIMIT, HASH, ID, version, hash, inside, ordinary, read, json, exists, relativeFile,
  source, gitIdentity, verifyReceipt, localDependency };
