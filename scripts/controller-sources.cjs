/** 现有API检查的源码发现接点。沿正式再导出和继承读取实际实现，不执行宿主或Core代码。 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function controllerSources(repoRoot) {
  const workspacePackages = new Map();
  const workspaces = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).workspaces;
  for (const pattern of workspaces) {
    const directories = pattern.endsWith("/*")
      ? fs.readdirSync(path.join(repoRoot, pattern.slice(0, -2)), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => path.join(repoRoot, pattern.slice(0, -2), entry.name))
      : [path.join(repoRoot, pattern)];
    for (const directory of directories) {
      const manifestFile = path.join(directory, "package.json");
      if (fs.existsSync(manifestFile)) {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        workspacePackages.set(manifest.name, { directory, manifest });
      }
    }
  }

  function sourceFile(target) {
    const file = [target, `${target}.ts`, path.join(target, "index.ts")].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
    if (!file) throw new Error(`控制器转接未找到实际源码：${path.relative(repoRoot, target)}`);
    return file;
  }

  function resolveSource(from, specifier) {
    if (specifier.startsWith(".")) return sourceFile(path.resolve(path.dirname(from), specifier));
    const parts = specifier.split("/");
    const packageName = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
    const workspace = workspacePackages.get(packageName);
    // 第三方父类不属于本仓库的源码闭包。
    if (!workspace) return null;
    const subpath = `.${specifier.slice(packageName.length)}`;
    const entry = workspace.manifest.exports[subpath];
    const exported = typeof entry === "string" ? entry : entry?.types ?? entry?.default;
    if (!exported) throw new Error(`控制器转接使用了未声明的正式出口：${specifier}`);
    if (exported.endsWith(".ts") && !exported.endsWith(".d.ts")) {
      return sourceFile(path.resolve(workspace.directory, exported));
    }
    const { compilerOptions } = JSON.parse(fs.readFileSync(path.join(workspace.directory, "tsconfig.json"), "utf8"));
    const relative = path.relative(path.resolve(workspace.directory, compilerOptions.outDir), path.resolve(workspace.directory, exported));
    return sourceFile(path.resolve(workspace.directory, compilerOptions.rootDir, relative.replace(/\.(?:d\.ts|js)$/, ".ts")));
  }

  const sources = new Map();
  function visit(file) {
    if (sources.has(file)) return;
    const source = fs.readFileSync(file, "utf8");
    sources.set(file, source);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = new Map();
    for (const statement of tree.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) imports.set(binding.name.text, statement.moduleSpecifier.text);
        }
      }
    }
    for (const statement of tree.statements) {
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveSource(file, statement.moduleSpecifier.text);
        if (target) visit(target);
      }
      if (ts.isClassDeclaration(statement)) {
        for (const clause of statement.heritageClauses ?? []) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const type of clause.types) {
            if (!ts.isIdentifier(type.expression)) continue;
            const specifier = imports.get(type.expression.text);
            if (specifier) {
              const target = resolveSource(file, specifier);
              if (target) visit(target);
            }
          }
        }
      }
    }
  }

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".controller.ts")) visit(file);
    }
  }
  walk(path.join(repoRoot, "apps/api/src/modules"));
  return sources;
}

module.exports = { controllerSources };
