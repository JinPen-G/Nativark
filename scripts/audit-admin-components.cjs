/** Read-only inventory: stdout only. Source hashes and imports are not runtime acceptance. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/ui-arc/manifest.json'), 'utf8'));
const imports = new Map();
const antImports = new Map();
const uiExports = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file)) {
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const relative = path.relative(root, file).replaceAll(path.sep, '/');
      for (const node of source.statements) {
        if (ts.isExportDeclaration(node) && relative === 'apps/admin/src/components/ui/index.ts' && node.exportClause && ts.isNamedExports(node.exportClause)) {
          uiExports.push(...node.exportClause.elements.map(item => item.name.text));
        }
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
        const module = node.moduleSpecifier.text;
        if (module.startsWith('@/registry/')) {
          const key = module.slice('@/'.length).replace(/\.(tsx?|css)$/, '');
          imports.set(key, [...(imports.get(key) ?? []), relative]);
        }
        if (module === 'antd' && !relative.startsWith('apps/admin/src/components/ui/')) {
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
}
walk(path.join(root, 'apps/admin/src'));
const badHashes = [];
const entries = manifest.entries.map(entry => {
  const consumers = new Set();
  for (const file of entry.files) {
    const full = path.join(root, 'packages/ui-arc/vendor', file.path);
    if (!fs.existsSync(full)) { badHashes.push(file.path + ': missing'); continue; }
    const normalized = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').trimEnd();
    if (crypto.createHash('sha256').update(normalized).digest('hex') !== file.normalizedSha256) badHashes.push(file.path);
    for (const consumer of imports.get(file.path.replace(/\.(tsx?|css)$/, '')) ?? []) consumers.add(consumer);
  }
  return { name: entry.name, status: consumers.size ? '已引用（可能含兼容分支）' : entry.name === 'arc-foundation' ? '全局基础' : '已下载备用', consumers: [...consumers], dependencies: entry.dependencies };
});
const report = { entries, sourceFiles: new Set(manifest.entries.flatMap(entry => entry.files.map(file => file.path))).size,
  proCount: Array.isArray(manifest.pro) ? manifest.pro.length : Object.keys(manifest.pro ?? {}).length, badHashes,
  uiExports, antImports: Object.fromEntries([...antImports].sort(([a], [b]) => a.localeCompare(b))) };
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else {
  const lines = ['# 后台组件源码与接入清单', '', '> 由 `node scripts/audit-admin-components.cjs` 只读扫描生成。引用不等于运行验收，也不等于所有兼容分支均已替换。', '',
    `本地 ${entries.length} 个公开源码条目 / ${report.sourceFiles} 个唯一文件；Pro ${report.proCount} 个仅有目录元数据；源码校验异常 ${badHashes.length} 个。`, '',
    '## 使用入口', '', '`@/components/ui` 是业务页统一入口；原始源码在 `packages/ui-arc/vendor`，下载记录及哈希在 `manifest.json`。', '',
    '新增页面先查本清单和适配器 API；备用组件按需单独接入并安装其依赖，不要打包整个目录。不要修改 vendor，尺寸与动效保留原设计；颜色、圆角、语言和声音由平台适配层负责。', '',
    '已导出的平台 API：' + uiExports.map(name => '`' + name + '`').join('、') + '。', '',
    '## 全量公开源码清单', '', '| 名称 | 接入状态 | 当前引用位置 |', '| --- | --- | --- |'];
  for (const entry of entries) lines.push(`| ${entry.name} | ${entry.status} | ${entry.consumers.map(file => '`' + file.replace('apps/admin/src/', '') + '`').join('<br>') || '—'} |`);
  lines.push('', '## 仍直接依赖 Ant 的范围', '', '以下包含布局、表单状态、数据展示、消息服务及未替换控件，不应一律作为视觉替换遗漏。适配器内部的 Ant 分支不在此表内，应同时查看对应源码。', '', '| Ant API | 引用文件数 | 文件 |', '| --- | --- | --- |');
  for (const [name, files] of Object.entries(report.antImports)) lines.push(`| ${name} | ${files.length} | ${files.map(file => '`' + file.replace('apps/admin/src/', '') + '`').join('<br>')} |`);
  lines.push('', '## 明确保留的兼容边界', '',
    '- InputNumber：原生 NumberField 不支持空值，不能把未填写金额变成 0；金额 stringMode、格式器、精度和清空语义保留 Ant。新非空计数器可按需接入 number-field。',
    '- Select：基础单选/显式关闭搜索的 multiple/按名称搜索的单选使用原组件；多选默认搜索、自定义筛选、异步加载、树/分组、tags、复杂事件和弹层控制仍保留兼容实现。',
    '- Checkbox：普通文本选项使用原勾选动效；Group、复杂内容/事件仍保留 Ant。',
    '- Input：普通密码与固定行数 TextArea 使用原组件并保留表单 ref；自定义密码显隐/图标、自动高度、计数、清空及复杂样式仍保留 Ant。',
    '- Radio：原 radio-group 是纵向选项卡，不直接替换现有紧凑横排及含禁用规则的单选组。',
    '- Table/Form：保留业务数据引擎和验证状态；不能用展示示例替代排序、选择、分页、校验和权限。',
    '- Modal/App.message/notification：仍有直接使用，尚未完成原生替换；需要适配静态调用、Promise、上下文和嵌套关闭行为。',
    '- 日期/上传/提示/步骤等适配器的特殊模式有显式 fallback，详见适配器源码和 README。',
    '- Pro：只有元数据，未经许可不下载、不模仿受限源码。', '',
    '## 更新流程', '', '改动接入后运行只读扫描更新本清单；上游新增组件再核对官方 registry/catalog，审核许可与依赖后补源码和 manifest。日常开发无需每次去官网找组件。');
  console.log(lines.join('\n'));
}
if (badHashes.length) process.exitCode = 1;
