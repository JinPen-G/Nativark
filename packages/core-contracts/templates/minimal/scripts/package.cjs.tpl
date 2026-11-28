/** 从本 Core 的固定源码生成标准归档；复用原合同检查/归档，不执行安装或迁移。 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { CoreSourceSchema, renderCoreGuide } = require('@rental-os/core-contracts');
const { corePackageFiles, inspectCorePackageFiles } = require('@rental-os/core-contracts/package');
const { createCoreArchive, CORE_ARCHIVE_LIMITS } = require('@rental-os/core-contracts/archive');
const root = path.resolve(__dirname, '..');
function ordinaryDirectory(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('打包目录不能经过链接');
    if (path.dirname(current) === current) break;
  }
}
function read(file) {
  ordinaryDirectory(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CORE_ARCHIVE_LIMITS.fileBytes) throw new Error('声明文件不可读或超过上限');
  return fs.readFileSync(file);
}
try {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error('用法：package.cjs <Core仓库HTTPS地址> <固定Core提交> <同源底座公开README> <新包.tgz>');
  const source = CoreSourceSchema.parse({ repository: args[0], commit: args[1] });
  ordinaryDirectory(root);
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '--no-lazy-fetch', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const repository = git('rev-parse', '--show-toplevel').trim();
  const prefix = path.relative(repository, root).split(path.sep).join('/') || '.';
  if (git('rev-parse', 'HEAD').trim() !== source.commit) throw new Error('Core 源码须位于所选固定提交');
  git('diff', '--quiet', source.commit, '--', prefix === '.' ? '.' : ':(top)' + prefix);
  if (git('ls-files', '--others', '--exclude-standard').trim()) throw new Error('Core 含未提交文件，请先固定源码再打包');
  const scaffold = JSON.parse(read(path.join(root, 'core.scaffold.json')));
  const platformSource = CoreSourceSchema.parse(scaffold.platform.source);
  const guide = Buffer.from(read(path.resolve(args[2])).toString('utf8').replace(/\r\n/g, '\n'));
  if (createHash('sha256').update(guide).digest('hex') !== scaffold.platform.guideSha256) throw new Error('公开手册不是生成时固定的同版材料');
  const { createManifest } = require('../dist/manifest');
  const { createOpenApi } = require('../dist/openapi');
  const manifest = createManifest(source), metadata = JSON.parse(read(path.join(root, 'package.json')));
  if (manifest.id !== scaffold.id || metadata.name !== scaffold.packageName || manifest.version !== metadata.version)
    throw new Error('Core ID、npm 包名或版本与当前源码不一致');
  const files = new Map([
    ['core.manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
    ['openapi.json', Buffer.from(JSON.stringify(createOpenApi(), null, 2) + '\n')],
    ['CORE_GUIDE.md', Buffer.from(renderCoreGuide(manifest, guide.toString('utf8'), platformSource))]
  ]);
  for (const file of corePackageFiles(manifest)) if (!files.has(file)) files.set(file, read(path.join(root, file)));
  const checked = inspectCorePackageFiles(files);
  if (!checked.ok) throw new Error(checked.issues.map(issue => `${issue.file}:${issue.field || ''} ${issue.message}`).join('\n'));
  const pack = createCoreArchive(files), output = path.resolve(args[3]);
  if (!output.endsWith('.tgz')) throw new Error('输出使用新的 .tgz 文件');
  ordinaryDirectory(path.dirname(output));
  let created = false;
  try {
    const fd = fs.openSync(output, 'wx'); created = true;
    try { fs.writeFileSync(fd, pack.bytes); } finally { fs.closeSync(fd); }
  } catch (error) { if (created) fs.unlinkSync(output); throw error; }
  process.stdout.write(JSON.stringify({ status: 'packed', coreId: manifest.id, version: manifest.version, file: output,
    sha256: pack.sha256, files: files.size, scope: 'package-static' }) + '\n');
} catch (error) { console.error(error instanceof Error ? error.message : 'Core 打包失败'); process.exitCode = 1; }
