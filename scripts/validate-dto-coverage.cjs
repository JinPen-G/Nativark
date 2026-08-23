const fs = require("node:fs");
const path = require("node:path");

/**
 * DTO 字段覆盖检查。
 *
 * 为什么需要它：`main.ts` 的全局 `ValidationPipe` 开了 `whitelist: true`，
 * 该选项会**剥离所有没有校验装饰器的属性**。当 `@Body()` 标注的是 TypeScript
 * interface 时，类型在运行时被擦除、管道拿不到 metatype，于是整个请求体原样通过——
 * 既没有校验，也没有剥离。一旦改用 DTO 类，剥离就生效了：
 * DTO 里漏声明的字段会被**静默丢弃**，请求成功、数据不全，比 500 更难发现。
 *
 * `implements` 挡不住这件事：TypeScript 只要求实现**必填**成员，
 * 可选成员（`note?: string`）漏了照样编译通过。
 *
 * 所以这里用编译器 API 静态比对：凡 `class X implements Y`，
 * Y 的每个成员都必须在 X 上声明且带至少一个校验装饰器。
 * 少一个就让门禁失败，把「静默丢字段」变成构建期错误。
 */

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const dtoRoot = path.join(repoRoot, "apps", "api", "src");
const sharedEntry = path.join(repoRoot, "packages", "shared", "src", "index.ts");

function collectFiles(dir, suffix, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, suffix, acc);
    else if (entry.isFile() && entry.name.endsWith(suffix)) acc.push(full);
  }
  return acc;
}

const dtoFiles = collectFiles(dtoRoot, ".dto.ts");
if (!dtoFiles.length) {
  console.log("DTO coverage check skipped: no *.dto.ts files found.");
  process.exit(0);
}

const program = ts.createProgram([sharedEntry, ...dtoFiles], {
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  strict: true,
  skipLibCheck: true,
  noEmit: true
});
const checker = program.getTypeChecker();

/** 取接口（含继承链）上的全部属性名。 */
function interfaceMembers(type) {
  return checker.getPropertiesOfType(type).map((symbol) => symbol.getName());
}

/** 类上带校验装饰器的属性名。只认真正声明的属性，不认继承的方法。 */
function decoratedClassMembers(node) {
  const named = new Map();
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue;
    const name = member.name.getText();
    const decorators = ts.getDecorators ? ts.getDecorators(member) ?? [] : [];
    named.set(name, decorators.length > 0);
  }
  return named;
}

const failures = [];
let checkedClasses = 0;
let checkedMembers = 0;

for (const file of dtoFiles) {
  const source = program.getSourceFile(file);
  if (!source) continue;

  ts.forEachChild(source, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const implementsClause = (node.heritageClauses ?? []).find(
      (clause) => clause.token === ts.SyntaxKind.ImplementsKeyword
    );
    if (!implementsClause) {
      // 嵌套值对象（如套装组成项）没有对应的顶层请求类型，不该被这条规则捕获。
      // 判据用命名约定：顶层请求 DTO 一律以 `...RequestDto` 或 `Save...Dto` 收尾，
      // 嵌套对象命名为 `...InputDto`。约定放在这里而不是靠人记，漏了会被门禁挡下。
      if (node.name.getText().endsWith("InputDto")) return;
      failures.push(
        `${path.relative(repoRoot, file)}: class ${node.name.getText()} 未使用 implements 关联共享请求类型；` +
          `没有这层关联，共享契约新增必填字段时不会有任何编译错误。` +
          `（嵌套值对象请以 InputDto 结尾命名。）`
      );
      return;
    }

    for (const expr of implementsClause.types) {
      const type = checker.getTypeAtLocation(expr);
      const expected = interfaceMembers(type);
      if (!expected.length) {
        failures.push(
          `${path.relative(repoRoot, file)}: class ${node.name.getText()} implements ${expr.getText()}，` +
            `但解析不到任何成员（类型未导出或路径不对？）`
        );
        continue;
      }
      const actual = decoratedClassMembers(node);
      checkedClasses += 1;

      for (const name of expected) {
        checkedMembers += 1;
        if (!actual.has(name)) {
          failures.push(
            `${path.relative(repoRoot, file)}: ${node.name.getText()} 缺少字段 \`${name}\`` +
              `（${expr.getText()} 声明了它）。whitelist:true 会把该字段从请求里静默剥离。`
          );
        } else if (!actual.get(name)) {
          failures.push(
            `${path.relative(repoRoot, file)}: ${node.name.getText()}.${name} 没有任何校验装饰器。` +
              `whitelist:true 只保留带装饰器的属性，该字段同样会被剥离。`
          );
        }
      }
    }
  });
}

if (failures.length) {
  console.error("DTO coverage check failed:\n");
  for (const line of failures) console.error(`  - ${line}`);
  console.error(`\n共 ${failures.length} 处问题。`);
  process.exit(1);
}

console.log(
  `DTO coverage check passed: ${checkedClasses} 个 DTO 类、${checkedMembers} 个字段与共享契约逐一对齐。`
);
