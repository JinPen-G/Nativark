/** Read-only inventory of explicitly selected public or Rental sources.
 * Missing/empty roots and links fail closed; source hashes/imports are not runtime acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
function checkedPath(root, target, kind = "file") {
  const file = path.resolve(root, target), relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Selected source escapes its root: " + file);
  if (!fs.existsSync(file)) throw new Error("Selected source is missing: " + file);
  for (let current = file; current !== root; current = path.dirname(current))
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Selected source cannot follow links: " + current);
  const stat = fs.statSync(file);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) throw new Error("Selected source has the wrong type: " + file);
  return file;
}

let root = path.resolve(__dirname, '..'), uiRoot, exportsFile, toolchainRoot, rentalRoot;
const scanRoots = [], rentalScanRoots = [], args = process.argv.slice(2);
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') { json = true; continue; }
  const option = args[i], value = args[++i];
  if (!value || value.startsWith('--')) throw new Error('Component audit option requires a value: ' + option);
  if (option === '--source-root') root = path.resolve(value);
  else if (option === '--scan-root') scanRoots.push(value);
  else if (option === '--ui-root') uiRoot = value;
  else if (option === '--exports') exportsFile = value;
  else if (option === '--rental-root') rentalRoot = path.resolve(value);
  else if (option === '--rental-scan-root') rentalScanRoots.push(value);
  else if (option === '--toolchain-root') toolchainRoot = path.resolve(value);
  else throw new Error('Unknown component audit option: ' + option);
}
if (!scanRoots.length || !uiRoot || !exportsFile) throw new Error('Component audit requires --scan-root, --ui-root and --exports within --source-root');
if (Boolean(rentalRoot) !== Boolean(rentalScanRoots.length)) throw new Error('Rental audit requires both --rental-root and --rental-scan-root');
root = fs.realpathSync(root);
if (rentalRoot) rentalRoot = fs.realpathSync(rentalRoot);
const rentalRoots = rentalScanRoots.map(directory => checkedPath(rentalRoot, directory, 'directory'));
const roots = scanRoots.map(directory => checkedPath(root, directory, 'directory'));
const uiDirectory = checkedPath(root, uiRoot, 'directory'), exportPath = checkedPath(root, exportsFile);
if (!roots.some(directory => exportPath.startsWith(directory + path.sep))) throw new Error('UI exports must be within the selected scan roots');
const ts = createRequire(path.join(toolchainRoot || root, 'package.json'))('typescript');
const manifest = JSON.parse(fs.readFileSync(checkedPath(root, path.join(uiDirectory, 'manifest.json')), 'utf8'));
if (!Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.some(entry => !Array.isArray(entry.files) || !entry.files.length))
  throw new Error('Component audit manifest contains no source entries');
const imports = new Map();
const antImports = new Map();
const uiExports = [];
const scanned = new Set();
function walk(dir, sourceRoot = root, prefix = "") {
  checkedPath(sourceRoot, dir, 'directory');
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Component audit cannot follow links: ' + file);
    if (entry.isDirectory()) count += walk(file, sourceRoot, prefix);
    else if (entry.isFile() && /\.tsx?$/.test(file)) {
      count++; if (scanned.has(file)) continue; scanned.add(file);
      checkedPath(sourceRoot, file);
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const relative = prefix + path.relative(sourceRoot, file).replaceAll(path.sep, '/');
      for (const node of source.statements) {
        if (ts.isExportDeclaration(node) && path.resolve(file) === exportPath && node.exportClause && ts.isNamedExports(node.exportClause)) {
          uiExports.push(...node.exportClause.elements.map(item => item.name.text));
        }
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const module = node.moduleSpecifier.text;
        if (module.startsWith('@/registry/')) {
          const key = module.slice('@/'.length).replace(/\.(tsx?|css)$/, '');
          imports.set(key, [...(imports.get(key) ?? []), relative]);
        }
        if (module === 'antd' && !file.startsWith(path.dirname(exportPath) + path.sep)) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
            if (item.isTypeOnly || node.importClause.isTypeOnly) continue;
            const name = (item.propertyName ?? item.name).text;
            antImports.set(name, [...new Set([...(antImports.get(name) ?? []), relative])]);
          }
        }
      }
    }
  }
  return count;
}
for (const directory of roots) if (!walk(directory)) throw new Error('Component audit selected an empty source root: ' + directory);
for (const directory of rentalRoots) if (!walk(directory, rentalRoot, 'rental/')) throw new Error('Component audit selected an empty Rental root: ' + directory);
if (!uiExports.length) throw new Error('Selected UI entry has no named exports: ' + exportPath);
const badHashes = [];
const entries = manifest.entries.map(entry => {
  const consumers = new Set();
  for (const file of entry.files) {
    const full = path.resolve(uiDirectory, 'vendor', file.path);
    if (!full.startsWith(path.join(uiDirectory, 'vendor') + path.sep)) throw new Error('Vendor entry escaped its declared directory');
    if (!fs.existsSync(full)) { badHashes.push(file.path + ': missing'); continue; }
    checkedPath(root, full);
    const normalized = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    if (crypto.createHash('sha256').update(normalized).digest('hex') !== file.normalizedSha256) badHashes.push(file.path);
    for (const consumer of imports.get(file.path.replace(/\.(tsx?|css)$/, '')) ?? []) consumers.add(consumer);
  }
  return { name: entry.name, status: consumers.size ? '已引用（可能含兼容分支）' : entry.name === 'arc-foundation' ? '全局基础' : '已下载备用', consumers: [...consumers], dependencies: entry.dependencies };
});
const report = { entries, scannedFiles: scanned.size, scanRoots: [...roots.map(directory => path.relative(root, directory).split(path.sep).join('/')), ...rentalRoots.map(directory => 'rental/' + path.relative(rentalRoot, directory).split(path.sep).join('/'))], sourceFiles: new Set(manifest.entries.flatMap(entry => entry.files.map(file => file.path))).size,
  proCount: Array.isArray(manifest.pro) ? manifest.pro.length : Object.keys(manifest.pro ?? {}).length, badHashes,
  uiExports, antImports: Object.fromEntries([...antImports].sort(([a], [b]) => a.localeCompare(b))) };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  const lines = ['# 后台组件源码与接入清单', '', '> 由 `node scripts/audit-admin-components.cjs --source-root <root> --scan-root <source> --ui-root <ui-arc> --exports <ui-entry>` 只读扫描生成。引用不等于运行验收，也不等于所有兼容分支均已替换。', '',
    `本地 ${entries.length} 个公开源码条目 / ${report.sourceFiles} 个唯一文件；Pro ${report.proCount} 个仅有目录元数据；源码校验异常 ${badHashes.length} 个。`, '',
    '## 使用入口', '', '`@rental-os/platform-admin/ui` 是公共页面入口；原后台 `@/components/ui` 保留兼容转接。原始源码在 `packages/ui-arc/vendor`，下载记录及哈希在 `manifest.json`。', '',
    '新增页面先查本清单和适配器 API；备用组件按需单独接入并安装其依赖，不要打包整个目录。不要修改 vendor，尺寸与动效保留原设计；颜色、圆角、语言和声音由平台适配层负责。', '',
    '已导出的平台 API：' + uiExports.map(name => '`' + name + '`').join('、') + '。', '',
    '## 全量公开源码清单', '', '| 名称 | 接入状态 | 当前引用位置 |', '| --- | --- | --- |'];
  for (const entry of entries) lines.push(`| ${entry.name} | ${entry.status} | ${entry.consumers.map(file => '`' + file + '`').join('<br>') || '—'} |`);
  lines.push('', '## 仍直接依赖 Ant 的范围', '', '以下包含布局、表单状态、数据展示、消息服务及未替换控件，不应一律作为视觉替换遗漏。适配器内部的 Ant 分支不在此表内，应同时查看对应源码。', '', '| Ant API | 引用文件数 | 文件 |', '| --- | --- | --- |');
  for (const [name, files] of Object.entries(report.antImports)) lines.push(`| ${name} | ${files.length} | ${files.map(file => '`' + file + '`').join('<br>')} |`);
  lines.push('', '## 明确保留的兼容边界', '',
    '- InputNumber：原生 NumberField 不支持空值，不能把未填写金额变成 0；金额 stringMode、格式器、精度和清空语义保留 Ant。新非空计数器可按需接入 number-field。',
    '- Select：基础单选/显式关闭搜索的 multiple/按名称搜索的单选使用原组件；多选默认搜索、自定义筛选、异步加载、树/分组、tags、复杂事件和弹层控制仍保留兼容实现。',
    '- Checkbox：普通文本选项使用原勾选动效；Group、复杂内容/事件仍保留 Ant。',
    '- Input：普通密码与固定行数 TextArea 使用原组件并保留表单 ref；自定义密码显隐/图标、自动高度、计数、清空及复杂样式仍保留 Ant。',
    '- Radio：普通选项接原 radio-group，紧凑按钮组接共享 Segmented；自定义 children、复杂事件和特殊选项保留 Ant。',
    '- Table：普通业务列通过共享桥接使用订单同一 Tablecn/TanStack 渲染、工具与分页；未适配的选择/筛选/树/自定义渲染契约显式回退 Ant，不用展示示例替代业务功能。Form 保留原验证与权限状态。',
    '- Modal/App.message/notification：普通对话框与消息由共享适配器接入原版 Dialog/ToastStack；静态确认、复杂节点、Promise 上下文和嵌套关闭等特殊契约显式保留 Ant，不等于普通弹窗未迁移。',
    '- 日期/上传/提示/步骤等适配器的特殊模式有显式 fallback，详见适配器源码和 README。',
    '- Pro：只有元数据，未经许可不下载、不模仿受限源码。', '',
    '## 更新流程', '', '改动接入后运行只读扫描更新本清单；上游新增组件再核对官方 registry/catalog，审核许可与依赖后补源码和 manifest。日常开发无需每次去官网找组件。');
  console.log(lines.join('\n'));
}
if (badHashes.length) process.exitCode = 1;
