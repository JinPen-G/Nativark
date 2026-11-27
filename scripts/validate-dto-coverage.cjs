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
 * Y 的每个成员都必须在 X 或其父类上声明且带至少一个校验装饰器。
 * 少一个就让门禁失败，把「静默丢字段」变成构建期错误。
 */

const ts = require("typescript");

const { checkedPath, createControllerSourceLoader } = require("./controller-sources.cjs");
let repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2), selectedRoots = [], contracts = [], bodyControllers = [];
for (let i = 0; i < args.length; i++) {
  if (!args[i + 1]) throw new Error("DTO 源码选择参数缺少值");
  if (args[i] === "--source-root") repoRoot = path.resolve(args[++i]);
  else if (args[i] === "--dto-root") selectedRoots.push(args[++i]);
  else if (args[i] === "--contracts") contracts.push(args[++i]);
  else if (args[i] === "--body-controller") bodyControllers.push(args[++i]);
  else throw new Error("只接受 --source-root / --dto-root / --contracts / --body-controller");
}
if (!selectedRoots.length || !contracts.length || !bodyControllers.length)
  throw new Error("DTO 检查必须显式选择 --dto-root、--contracts 和 --body-controller");
// 扫描所选 DTO 所有者；不让迁出的类从字段门禁消失。
const dtoRoots = selectedRoots.map(directory => checkedPath(repoRoot, directory, "directory"));
const contractEntries = contracts.map(file => checkedPath(repoRoot, file));

function collectFiles(dir, suffix, acc = []) {
  checkedPath(repoRoot, dir, "directory");
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`DTO 扫描不接受链接：${full}`);
    if (entry.isDirectory()) collectFiles(full, suffix, acc);
    else if (entry.isFile() && entry.name.endsWith(suffix)) acc.push(full);
  }
  return acc;
}

const dtoFiles = dtoRoots.flatMap((root) => collectFiles(root, ".dto.ts"));
if (!dtoFiles.length) {
  throw new Error("所选源码没有 DTO，不能以空集合通过字段检查");
}

const options = {
  target: ts.ScriptTarget.ES2021,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  strict: true,
  skipLibCheck: true,
  noEmit: true
};
const loader = createControllerSourceLoader(repoRoot);
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, from) => names.map(name => {
  if (name.startsWith("@rental-os/")) {
    const resolvedFileName = loader.resolveSource(from, name);
    return { resolvedFileName, extension: resolvedFileName.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts };
  }
  return ts.resolveModuleName(name, from, options, host).resolvedModule;
});
const program = ts.createProgram([...contractEntries, ...dtoFiles], options, host);
const checker = program.getTypeChecker();

/** 取接口（含继承链）上的全部属性名。 */
function interfaceMembers(type) {
  return checker.getPropertiesOfType(type).map((symbol) => symbol.getName());
}

/** 只计入class-validator装饰器；Type/Swagger元数据不能使whitelist保留字段。 */
function hasValidationDecorator(member) {
  return (ts.getDecorators(member) ?? []).some((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression : decorator.expression;
    const symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(expression) ? expression.expression : expression
    );
    return (symbol?.declarations ?? []).some((declaration) => {
      let parent = declaration;
      while (parent && !ts.isImportDeclaration(parent)) parent = parent.parent;
      return parent && ts.isStringLiteral(parent.moduleSpecifier)
        && parent.moduleSpecifier.text === "class-validator";
    });
  });
}

/** class-validator继承父类的字段元数据；子类无装饰器的重声明不会删除它。 */
function decoratedClassMembers(node) {
  const named = new Map();
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const expression of clause.types) {
      const declarations = checker.getTypeAtLocation(expression).getSymbol()?.declarations ?? [];
      for (const parent of declarations.filter(ts.isClassDeclaration)) {
        for (const [name, validated] of decoratedClassMembers(parent)) named.set(name, validated);
      }
    }
  }
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || !member.name) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)
      ? member.name.text : member.name.getText();
    named.set(name, Boolean(named.get(name)) || hasValidationDecorator(member));
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

// 只校验 DTO 自身会产生“假绿”：控制器若继续写 interface、Omit<> 或匿名对象，
// 这些类型运行时全部被擦除，ValidationPipe 根本不会执行字段校验。
// Platform/Auth 是本轮会话与空间权限边界，所有 @Body 参数必须显式使用 DTO 类。
for (const relative of bodyControllers) {
  const file = checkedPath(repoRoot, relative);
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  ts.forEachChild(source, function visit(node) {
    if (ts.isParameter(node)) {
      const decorators = ts.getDecorators ? ts.getDecorators(node) ?? [] : [];
      const isBody = decorators.some((decorator) => {
        const expression = decorator.expression;
        return ts.isCallExpression(expression) && expression.expression.getText(source) === "Body";
      });
      if (isBody) {
        const typeName = node.type?.getText(source) ?? "<missing>";
        if (!/Dto$/u.test(typeName)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          failures.push(`${relative}:${line}: @Body 参数必须使用运行时 DTO 类，当前为 ${typeName}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  });
}

if (!checkedClasses || !checkedMembers) failures.push("所选 DTO 未取得可核对的合同字段，不能以空集合通过");
if (failures.length) {
  console.error("DTO coverage check failed:\n");
  for (const line of failures) console.error(`  - ${line}`);
  console.error(`\n共 ${failures.length} 处问题。`);
  process.exit(1);
}

console.log(
  `DTO coverage check passed: ${checkedClasses} 个 DTO 类、${checkedMembers} 个字段与共享契约逐一对齐。`
);
