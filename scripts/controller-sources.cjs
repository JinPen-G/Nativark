/** 所选工作区的源码发现接点。沿正式出口读取同树实现，不借用旧 dist。
 * controllerSources 只读文本；createControllerSourceLoader 仅供离线元数据检查，
 * 执行原模块声明和装饰器，不实例化 Controller、DI、Client 或启动宿主。
 * 默认只解析源码；扫描目录与 Prisma schema 必须由消费者显式选择。
 */
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function checkedPath(root, target, kind = "file") {
  const file = path.resolve(root, target);
  const within = value => {
    const relative = path.relative(root, value);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!within(file)) throw new Error(`所选源码路径越出本工作树：${file}`);
  if (!fs.existsSync(file)) throw new Error(`所选源码材料缺失：${file}`);
  if (!within(fs.realpathSync(file))) throw new Error(`所选源码链接越出本工作树：${file}`);
  const stat = fs.statSync(file);
  if (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) throw new Error(`所选源码材料类型错误：${file}`);
  return file;
}

function createControllerSourceLoader(repoRoot, dependencyDirectory, selection = {}) {
  repoRoot = fs.realpathSync(path.resolve(repoRoot));
  if (!selection || typeof selection !== "object" || Array.isArray(selection)
    || Object.keys(selection).some(key => !["controllerRoots", "schemaPath"].includes(key)))
    throw new Error("源码加载器只接受 controllerRoots / schemaPath 显式选择");
  const controllerRoots = selection.controllerRoots ?? [];
  if (!Array.isArray(controllerRoots) || controllerRoots.some(root => typeof root !== "string" || !root))
    throw new Error("controllerRoots 必须是显式源码目录数组");
  const roots = controllerRoots.map(directory => checkedPath(repoRoot, directory, "directory"));
  const schemaPath = selection.schemaPath === undefined ? undefined : checkedPath(repoRoot, selection.schemaPath);
  const installed = createRequire(dependencyDirectory
    ? path.join(path.resolve(dependencyDirectory), "typescript/package.json") : path.join(repoRoot, "package.json"));
  const ts = installed("typescript");
  const runtimeDependencies = new Map();
  const requireDependency = specifier => runtimeDependencies.has(specifier) ? runtimeDependencies.get(specifier) : installed(specifier);
  const workspacePackages = new Map();
  const workspaces = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).workspaces;
  if (!Array.isArray(workspaces)) throw new Error("所选源码根缺少 workspaces 清单");
  const excluded = workspaces.filter(pattern => pattern.startsWith("!")).map(pattern => pattern.slice(1));
  for (const pattern of workspaces.filter(pattern => !pattern.startsWith("!"))) {
    const directories = pattern.endsWith("/*")
      ? fs.readdirSync(checkedPath(repoRoot, pattern.slice(0, -2), "directory"), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => path.join(repoRoot, pattern.slice(0, -2), entry.name))
      : [path.join(repoRoot, pattern)];
    for (const directory of directories) {
      const relative = path.relative(repoRoot, directory).split(path.sep).join("/");
      if (excluded.some(pattern => pattern.endsWith("/*") ? relative.startsWith(pattern.slice(0, -1)) : relative === pattern)) continue;
      const manifestFile = path.join(directory, "package.json");
      if (fs.existsSync(manifestFile)) {
        checkedPath(repoRoot, manifestFile);
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        if (workspacePackages.has(manifest.name)) throw new Error(`所选工作区存在重复包：${manifest.name}`);
        workspacePackages.set(manifest.name, { directory, manifest });
      }
    }
  }

  const generatedSources = new Map();
  function sourceFile(target) {
    target = path.resolve(repoRoot, target);
    const relativeTarget = path.relative(repoRoot, target);
    if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget))
      throw new Error(`控制器源码越出本工作树：${target}`);
    if (generatedSources.has(target)) return target;
    if (target.endsWith(".js")) target = target.slice(0, -3) + ".ts";
    const file = [target, `${target}.ts`, path.join(target, "index.ts")].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
    if (!file) throw new Error(`控制器转接未找到实际源码：${path.relative(repoRoot, target)}`);
    return checkedPath(repoRoot, file);
  }

  function resolveSource(from, specifier, runtime = false) {
    if (specifier.startsWith(".")) return sourceFile(path.resolve(path.dirname(from), specifier));
    const parts = specifier.split("/");
    const packageName = parts.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
    const workspace = workspacePackages.get(packageName);
    // 第三方依赖可只读复用；本项目包不能退回其他树链接或陈旧 dist。
    if (!workspace) {
      if (specifier.startsWith("@rental-os/")) throw new Error(`本工作树缺少正式包：${packageName}`);
      return null;
    }
    const subpath = `.${specifier.slice(packageName.length)}`;
    const exports = workspace.manifest.exports ?? {};
    let entry = exports[subpath], capture;
    if (entry === undefined) {
      // 遵守正式单通配出口的最长前缀优先级；不把未声明深层源码当作可用接点。
      const patterns = Object.keys(exports).filter(key => key.split("*").length === 2)
        .map(key => ({ key, prefix: key.slice(0, key.indexOf("*")), suffix: key.slice(key.indexOf("*") + 1) }))
        .filter(({ prefix, suffix }) => subpath.startsWith(prefix) && subpath.endsWith(suffix)
          && subpath.length > prefix.length + suffix.length)
        .sort((left, right) => right.prefix.length - left.prefix.length || right.key.length - left.key.length);
      if (patterns.length) {
        const { key, prefix, suffix } = patterns[0];
        capture = subpath.slice(prefix.length, suffix.length ? -suffix.length : undefined);
        if (/[\\%]/u.test(capture) || capture.split("/").some(part => !part || part === "." || part === ".." || part === "node_modules"))
          throw new Error(`控制器正式出口包含非法路径：${specifier}`);
        entry = exports[key];
      }
    }
    let exported = typeof entry === "string" ? entry : runtime
      ? entry?.require ?? entry?.default ?? entry?.import : entry?.types ?? entry?.default;
    if (!exported) throw new Error(`控制器转接使用了未声明的正式出口：${specifier}`);
    if (capture !== undefined) {
      if (exported.split("*").length !== 2) throw new Error(`控制器单通配出口目标不一致：${specifier}`);
      exported = exported.replace("*", capture);
    }
    if (!exported.startsWith("./") || /[\\%*]/u.test(exported)
      || exported.slice(2).split("/").some(part => !part || part === "." || part === ".." || part === "node_modules"))
      throw new Error(`控制器正式出口目标越界：${specifier}`);
    if (/\.tsx?$/u.test(exported) && !exported.endsWith(".d.ts")) {
      return sourceFile(checkedPath(workspace.directory, exported));
    }
    if (!workspace.options) {
      const configFile = checkedPath(workspace.directory, "tsconfig.json");
      const config = ts.readConfigFile(configFile, ts.sys.readFile);
      if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
      const { options, errors } = ts.parseJsonConfigFileContent(config.config, ts.sys, workspace.directory);
      if (errors.length || !options.rootDir || !options.outDir)
        throw new Error(`控制器正式出口缺少有效构建边界：${specifier}`);
      for (const directory of [options.rootDir, options.outDir]) {
        const relative = path.relative(workspace.directory, directory);
        if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error(`控制器构建目录越出正式包：${specifier}`);
      }
      workspace.options = options;
    }
    const { options } = workspace;
    const relative = path.relative(options.outDir, path.resolve(workspace.directory, exported));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error(`控制器正式出口不属于该包构建目录：${specifier}`);
    return sourceFile(checkedPath(workspace.directory, path.resolve(options.rootDir, relative.replace(/\.(?:d\.ts|js)$/, ".ts"))));
  }

  const files = [];
  function walk(directory) {
    checkedPath(repoRoot, directory, "directory");
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`控制器扫描不接受链接：${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith(".controller.ts")) files.push(checkedPath(repoRoot, file));
    }
  }
  for (const directory of roots) walk(directory);
  const modules = new Map(), declarations = new Map();
  function load(target) {
    const file = sourceFile(target);
    if (generatedSources.has(file)) return generatedSources.get(file);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    try {
      const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        fileName: file, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
          esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: false }
      });
      if (compiled.diagnostics?.length)
        throw new Error(ts.formatDiagnosticsWithColorAndContext(compiled.diagnostics, {
          getCurrentDirectory: () => repoRoot, getCanonicalFileName: name => name, getNewLine: () => "\n"
        }));
      const requireSource = specifier => {
        const source = resolveSource(file, specifier, true);
        return source ? load(source) : requireDependency(specifier);
      };
      // 保留原方法及动态装饰器；本检查不使用 DI design:type，也不执行 provider 工厂。
      new Function("require", "module", "exports", "__filename", "__dirname", compiled.outputText)(
        requireSource, module, module.exports, file, path.dirname(file));
      for (const value of Object.values(module.exports)) {
        if (typeof value === "function" && !declarations.has(value)) declarations.set(value, file);
      }
      return module.exports;
    } catch (error) {
      modules.delete(file);
      throw new Error(`离线控制器源码加载失败：${path.relative(repoRoot, file)}`, { cause: error });
    }
  }
  async function prepareOfflinePrisma() {
    if (!schemaPath) throw new Error("离线 Prisma 检查必须显式选择 schemaPath");
    checkedPath(repoRoot, schemaPath);
    // 复用所选类型/发行核验中的官方 5.22 WASM 与生成器入口。原宿主依赖原 schema，
    // 不借其他树的生成 Client，也不以假枚举/空 Client 令元数据检查通过。
    for (const name of ["prisma", "@prisma/client"])
      if (installed(`${name}/package.json`).version !== "5.22.0") throw new Error("离线控制器检查仅核定 Prisma 5.22.0");
    const cliFile = installed.resolve("prisma"), cli = fs.readFileSync(cliFile, "utf8");
    const start = cli.indexOf("var yI=S("), end = cli.indexOf(";var bI=S(", start);
    if (start < 0 || end < 0) throw new Error("原 Prisma 官方 WASM wrapper 不可用");
    const S = (initialize, cache) => () => {
      if (!cache) { cache = { exports: {} }; initialize(cache.exports, cache); }
      return cache.exports;
    };
    const wasm = new Function("S", "require", "__dirname", cli.slice(start, end) + ";return yI();")(
      S, createRequire(cliFile), path.dirname(cliFile));
    const generatorFile = installed.resolve("@prisma/client/generator-build/index.js"), generatedModule = { exports: {} };
    const buildClient = new Function("require", "module", "exports", "__filename", "__dirname",
      fs.readFileSync(generatorFile, "utf8") + "\nreturn buildClient;")(
      createRequire(generatorFile), generatedModule, generatedModule.exports, generatorFile, path.dirname(generatorFile));
    const schema = fs.readFileSync(schemaPath, "utf8");
    const dmmf = JSON.parse(wasm.get_dmmf(JSON.stringify({ prismaSchema: schema, noColor: true })));
    const configuration = JSON.parse(wasm.get_config(JSON.stringify({ prismaSchema: schema, ignoreEnvVarErrors: true })));
    if (configuration.errors.length) throw new Error("原宿主 Prisma schema 配置无效");
    const directory = path.join(repoRoot, "output/.tmp/api-contract-validation/client");
    const result = await buildClient({ schemaPath, runtimeBase: "@prisma/client/runtime", datamodel: schema,
      binaryPaths: {}, outputDir: directory, generator: configuration.config.generators[0],
      datasources: configuration.config.datasources, dmmf, clientVersion: "5.22.0",
      engineVersion: installed("@prisma/engines-version").enginesVersion, activeProvider: "mysql",
      copyEngine: false, postinstall: false, envPaths: { rootEnvPath: null, schemaEnvPath: undefined } });
    const clients = new Map();
    function client(file) {
      if (clients.has(file)) return clients.get(file).exports;
      if (!Object.hasOwn(result.fileMap, file)) throw new Error(`官方 Prisma 内存产物缺失：${file}`);
      const module = { exports: {} }; clients.set(file, module);
      new Function("require", "module", "exports", "__filename", "__dirname", result.fileMap[file])(
        name => name.startsWith("./") ? client(name.slice(2)) : installed(name),
        module, module.exports, path.join(directory, file), directory);
      return module.exports;
    }
    const runtime = client("index.js");
    runtimeDependencies.set("@prisma/client", runtime);
    // 自定义 output 的宿主使用相对导入；仅映射本次所选 schema 的官方内存产物。
    // 不读取已有生成目录，也不构造 Client。最近的现存祖先仍须通过同树链接校验。
    const output = configuration.config.generators[0]?.output?.value;
    if (output) {
      const target = path.resolve(path.dirname(schemaPath), output);
      const relative = path.relative(repoRoot, target);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error("所选 Prisma output 越出本工作树");
      let ancestor = target;
      while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
      checkedPath(repoRoot, ancestor, "directory");
      for (const entry of [target, path.join(target, "index"), path.join(target, "index.js"), path.join(target, "index.ts")])
        generatedSources.set(entry, runtime);
    }
    return { prisma: "5.22.0", models: dmmf.datamodel.models.length, clientInstantiated: false, diskOutputs: 0 };
  }
  return { repoRoot, files, resolveSource, load, requireDependency, declarations, prepareOfflinePrisma };
}

function controllerSources(repoRoot, dependencyDirectory, selection) {
  if (!selection?.controllerRoots?.length) throw new Error("控制器检查必须显式选择非空 controllerRoots");
  const { files, resolveSource, requireDependency } = createControllerSourceLoader(repoRoot, dependencyDirectory, selection);
  if (!files.length) throw new Error("所选源码根未发现控制器，不能以空集合通过检查");
  const ts = requireDependency("typescript");
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

  for (const file of files) visit(file);
  return sources;
}

module.exports = { controllerSources, createControllerSourceLoader, checkedPath };
