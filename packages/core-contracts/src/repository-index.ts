/**
 * 将正式包出口、API/页面声明和组件来源组合成开发索引，提供单一可发现入口。
 * 每次读取当前检出源码，保存固定Git来源和未解析项；运行可用性由真实宿主另行提供。
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import ts from "typescript";
import { DevelopmentCapabilityIndexSchema, type DevelopmentCapability, type DevelopmentCapabilityIndex,
  type DevelopmentSourceReference } from "./development";
import { CorePageDescriptorSchema, CorePageTextSchema, corePageText } from "./admin";
import { CoreManifestSchema } from "./manifest";
import { describeRepositorySchema, repositoryApiDocumentation } from "./repository-openapi";
import { RepositorySource, UNRESOLVED, isRepositorySourcePath, nodeDocumentation, readRepositoryJson, readRepositoryText,
  repositoryFiles, repositoryPath, sourceReference } from "./repository-source";

interface PublicEntry { owner: string; version: string; module: string; file: string; visibility: "public" | "host"; ui?: boolean }
interface PackageInfo { directory: string; name: string; version: string; entries: PublicEntry[]; dependencies: Record<string, string> }

function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value && typeof value === "object") {
    const conditions = value as Record<string, unknown>;
    return ["source", "types", "import", "require", "default"].flatMap(key => exportTargets(conditions[key]));
  }
  return [];
}

function packageCompilerOptions(root: string, file: string): ts.CompilerOptions | undefined {
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: path => isRepositorySourcePath(root, path) && ts.sys.fileExists(path),
    readFile: path => isRepositorySourcePath(root, path) ? ts.sys.readFile(path) : undefined,
    readDirectory: () => []
  };
  try {
    const config = ts.readConfigFile(file, host.readFile);
    if (config.error) return;
    const parsed = ts.parseJsonConfigFileContent(config.config, host, dirname(file), undefined, file);
    // 这里只读取输出路径，不枚举编译输入；无输入诊断不影响配置继承的解析。
    if (parsed.errors.some(diagnostic => ![18002, 18003].includes(diagnostic.code))) return;
    return parsed.options;
  } catch {
    return;
  }
}

function packageSource(root: string, directory: string, target: string): string | undefined {
  const absolute = resolve(root, directory, target);
  if (!isRepositorySourcePath(root, absolute)) return undefined;
  if (/\.(?:tsx?|mts|cts)$/u.test(target) && !/\.d\.[mc]?ts$/u.test(target)
    && lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) return absolute;
  let generated = false, configurationUnavailable = false;
  const configFiles = readdirSync(resolve(root, directory)).filter(file => /^tsconfig(?:\.[^.]+)*\.json$/u.test(file));
  for (const configFile of configFiles) {
    const options = packageCompilerOptions(root, resolve(root, directory, configFile));
    if (!options) {
      configurationUnavailable = true;
      continue;
    }
    if (typeof options.outDir !== "string" || typeof options.rootDir !== "string") continue;
    const output = resolve(root, directory, options.outDir);
    const suffix = repositoryPath(output, absolute);
    if (suffix.startsWith("..")) continue;
    generated = true;
    const stem = suffix.replace(/(?:\.d)?\.(?:js|ts|mjs|mts|cjs|cts)$/u, "");
    for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
      const source = resolve(root, directory, options.rootDir, stem + extension);
      if (isRepositorySourcePath(root, source) && lstatSync(source, { throwIfNoEntry: false })?.isFile()) return source;
    }
  }
  // 缺配置时无法排除历史生成物，保留未解析出口而不将其当作源码。
  if (!generated && !configurationUnavailable && /\.[mc]?jsx?$/u.test(target)
    && lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) return absolute;
}

function sourceDocuments(root: string, directory: string): DevelopmentSourceReference[] {
  let current = directory;
  while (current !== ".") {
    const documents = ["README.md", "AGENTS.md"]
      .filter(file => lstatSync(resolve(root, current, file), { throwIfNoEntry: false })?.isFile())
      .map(file => ({ path: `${current}/${file}` }));
    if (documents.length) return documents;
    current = dirname(current);
  }
  return [];
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
  return node;
}

function objectProperty(node: ts.Expression, name: string): ts.Expression | undefined {
  const object = unwrap(node);
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const property = object.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText().replace(/^["']|["']$/g, "") === name);
  return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
}

function headerDescription(root: string, file: string): string | undefined {
  const text = readRepositoryText(root, file);
  const comment = /^\s*\/\*\*([\s\S]*?)\*\//u.exec(text);
  return comment?.[1].split("\n").map(line => line.replace(/^\s*\*\s?/u, "").trim()).filter(Boolean).join("\n");
}

/** 只记录可定位到具体导出的静态导入，namespace 不按整个模块展开使用量。 */
function importConsumers(source: RepositorySource, paths: Record<string, string[]>) {
  const consumers = new Map<ts.Symbol, Map<ts.Node, DevelopmentSourceReference>>();
  const namespaces = new Map<ts.Symbol, { exports: Map<string, ts.Symbol>; reference: ts.Node }>();
  const members: Array<ts.PropertyAccessExpression | ts.ElementAccessExpression> = [];
  const add = (symbol: ts.Symbol | undefined, reference: ts.Node) => {
    if (!symbol) return;
    const target = source.target(symbol);
    if (!target.declarations?.length) return;
    const references = consumers.get(target) ?? new Map<ts.Node, DevelopmentSourceReference>();
    references.set(reference, sourceReference(reference, source.root));
    consumers.set(target, references);
  };
  const moduleExports = (literal: ts.StringLiteralLike) => {
    let symbol = source.checker.getSymbolAtLocation(literal);
    if (!symbol) {
      // TS 源码中的无类型 require 仍可沿正式路径定位，不能因此执行模块。
      const candidates = paths[literal.text] ?? (literal.text.startsWith(".")
        ? [resolve(dirname(literal.getSourceFile().fileName), literal.text)] : []);
      for (const candidate of candidates) {
        const file = [candidate, candidate + ".ts", candidate + ".tsx", candidate + ".js", join(candidate, "index.ts")]
          .map(path => source.program.getSourceFile(path)).find(Boolean);
        if (file) { symbol = source.checker.getSymbolAtLocation(file); break; }
      }
    }
    return new Map(symbol ? source.checker.getExportsOfModule(source.target(symbol)).map(item => [item.name, item]) : []);
  };
  const importedModule = (expression: ts.Expression): ts.CallExpression | undefined => {
    const value = unwrap(ts.isAwaitExpression(unwrap(expression)) ? (unwrap(expression) as ts.AwaitExpression).expression : expression);
    if (!ts.isCallExpression(value) || value.arguments.length !== 1 || !ts.isStringLiteralLike(value.arguments[0])) return;
    if (value.expression.kind === ts.SyntaxKind.ImportKeyword) return value;
    if (ts.isIdentifier(value.expression) && value.expression.text === "require"
      && !source.checker.getSymbolAtLocation(value.expression)?.declarations?.length) return value;
  };
  const bind = (name: ts.BindingName, exports: Map<string, ts.Symbol>, reference: ts.Node) => {
    if (ts.isIdentifier(name)) {
      const symbol = source.checker.getSymbolAtLocation(name);
      if (symbol) namespaces.set(symbol, { exports, reference });
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const property = element.propertyName ?? element.name;
        if (!element.dotDotDotToken && (ts.isIdentifier(property) || ts.isStringLiteralLike(property)))
          add(exports.get(property.text), element);
      }
    }
  };
  for (const file of source.program.getSourceFiles()) {
    if (file.isDeclarationFile || repositoryPath(source.root, file.fileName).includes("/vendor/")) continue;
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const clause = node.importClause;
        if (clause.name) add(source.checker.getSymbolAtLocation(clause.name), clause.name);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          bindings.elements.forEach(binding => add(source.checker.getSymbolAtLocation(binding.name), binding));
        else if (bindings) bind(bindings.name, moduleExports(node.moduleSpecifier), bindings);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
        bind(node.name, moduleExports(node.moduleReference.expression), node);
      } else if (ts.isVariableDeclaration(node) && node.initializer) {
        const imported = importedModule(node.initializer);
        if (imported) bind(node.name, moduleExports(imported.arguments[0] as ts.StringLiteralLike), imported);
      } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "then") {
        const imported = importedModule(node.expression.expression), callback = node.arguments[0];
        if (imported && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0])
          bind(callback.parameters[0].name, moduleExports(imported.arguments[0] as ts.StringLiteralLike), imported);
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) members.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  // 导入可出现在使用点后面。收齐绑定再读取成员，每个绑定/导出只计一次。
  for (const member of members) {
    const receiver = unwrap(member.expression), symbol = source.checker.getSymbolAtLocation(receiver);
    const imported = importedModule(receiver);
    const namespace = symbol && namespaces.get(symbol) || (imported
      ? { exports: moduleExports(imported.arguments[0] as ts.StringLiteralLike), reference: imported } : undefined);
    const name = ts.isPropertyAccessExpression(member) ? member.name.text
      : ts.isStringLiteralLike(member.argumentExpression) ? member.argumentExpression.text : undefined;
    if (namespace && name) add(namespace.exports.get(name), namespace.reference);
  }
  return new Map([...consumers].map(([symbol, references]) => [symbol, [...references.values()]]));
}

export function buildRepositoryCapabilityIndex(directory: string): DevelopmentCapabilityIndex {
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink()) throw new Error("源码根目录须为真实检出目录");
  const rootPackage = readRepositoryJson(root, "package.json");
  const capabilities: DevelopmentCapability[] = [], issues: DevelopmentCapabilityIndex["issues"] = [], coverage: DevelopmentCapabilityIndex["coverage"] = [];
  const packages: PackageInfo[] = [];
  const paths: Record<string, string[]> = {};
  const hasGit = Boolean(lstatSync(join(root, ".git"), { throwIfNoEntry: false }));
  const addIssue = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  const workspacePattern = /^[^*\\]+(?:\/\*)?$/u;
  for (const workspace of workspaces) {
    if (typeof workspace !== "string" || !workspacePattern.test(workspace)) {
      addIssue("workspace_pattern", "package.json", "当前源码索引支持一层 workspace 通配或显式目录");
      continue;
    }
    const parent = dirname(workspace), selected = basename(workspace);
    const directory = selected === "*" ? parent : workspace;
    if (!isRepositorySourcePath(root, resolve(root, parent)) || !isRepositorySourcePath(root, resolve(root, directory))
      || !lstatSync(resolve(root, directory), { throwIfNoEntry: false })?.isDirectory()) {
      coverage.push({ source: directory, count: 0, state: "not_present" });
      continue;
    }
    for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || selected !== "*" && entry.name !== selected) continue;
      const packageDirectory = repositoryPath(root, resolve(root, parent, entry.name));
      if (packages.some(info => info.directory === packageDirectory)) continue;
      if (!lstatSync(resolve(root, packageDirectory, "package.json"), { throwIfNoEntry: false })?.isFile()) continue;
      const manifest = readRepositoryJson(root, `${packageDirectory}/package.json`);
      if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
        addIssue("package_metadata", `${packageDirectory}/package.json`, "包缺少名称或版本");
        continue;
      }
      const dependencyList = manifest.dependencies && typeof manifest.dependencies === "object"
        ? manifest.dependencies as Record<string, string> : {};
      const peerDependencies = manifest.peerDependencies && typeof manifest.peerDependencies === "object"
        ? manifest.peerDependencies as Record<string, string> : {};
      const optionalDependencies = manifest.optionalDependencies && typeof manifest.optionalDependencies === "object"
        ? manifest.optionalDependencies as Record<string, string> : {};
      const info: PackageInfo = { directory: packageDirectory, name: manifest.name, version: manifest.version, entries: [],
        dependencies: { ...peerDependencies, ...dependencyList, ...optionalDependencies } };
      const exports = typeof manifest.exports === "string" || Array.isArray(manifest.exports) ? { ".": manifest.exports }
        : manifest.exports && typeof manifest.exports === "object"
          ? Object.keys(manifest.exports).some(key => key.startsWith(".")) ? manifest.exports as Record<string, unknown> : { ".": manifest.exports }
        : manifest.main || manifest.types ? { ".": { types: manifest.types, default: manifest.main } } : {};
      for (const [subpath, conditions] of Object.entries(exports)) {
        const targets = exportTargets(conditions);
        const module = info.name + (subpath === "." ? "" : subpath.slice(1));
        const file = targets.map(target => packageSource(root, packageDirectory, target)).find(Boolean);
        if (file) paths[module] = [file];
        // 样式和兼容源码通配出口不作为单个 TypeScript 模块解析。
        // 原源码转接由同一正式UI出口覆盖，不将兼容别名登记为另一项能力。
        if (subpath.startsWith("./source/") || subpath.includes("*") || targets.length && targets.every(target => target.endsWith(".css"))) continue;
        if (!file) {
          addIssue("export_source", `${packageDirectory}/package.json`, `未找到 ${subpath} 对应的当前源码入口`);
          continue;
        }
        info.entries.push({ owner: packageDirectory, version: info.version,
          module, file, visibility: "public",
          ui: info.name === "@rental-os/platform-admin" && subpath === "./ui" });
      }
      packages.push(info);
      capabilities.push({ id: `module:${packageDirectory}`, name: info.name, kind: "module", owner: packageDirectory,
        version: info.version, description: typeof manifest.description === "string" && manifest.description ? manifest.description : undefined,
        sources: [{ path: `${packageDirectory}/package.json` }, ...info.entries.map(item => ({ path: repositoryPath(root, item.file) }))],
        documentation: sourceDocuments(root, packageDirectory),
        details: { publicImports: info.entries.map(item => item.module), dependencies: dependencyList } });
    }
  }
  if (hasGit) {
    // 独立客户端不一定属于npm workspace，稀疏检出时也须明确它们的未读范围。
    const packagePatterns = new Set(["clients/*", ...workspaces.filter((workspace): workspace is string =>
      typeof workspace === "string" && workspacePattern.test(workspace))]);
    const patterns = [...packagePatterns].map(workspace => `:(glob)${workspace}/package.json`);
    if (patterns.length) {
      const trackedPackages = execFileSync("git", ["ls-files", "-z", "--cached", "--", ...patterns],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
      for (const file of trackedPackages) {
        if (!isRepositorySourcePath(root, resolve(root, file)) || !lstatSync(resolve(root, file), { throwIfNoEntry: false })?.isFile())
          coverage.push({ source: file, count: 0, state: "not_present" });
        else if (!packages.some(info => info.directory === dirname(file))) {
          coverage.push({ source: file, count: 0, state: "partial" });
          addIssue("package_scope", file, "该独立包未进入当前workspace源码扫描范围");
        }
      }
    }
  }
  const entries = packages.flatMap(info => info.entries);
  const uiFile = resolve(root, "apps/admin/src/components/ui/index.ts");
  const adminPackage = packages.find(info => info.directory === "apps/admin");
  if (adminPackage && lstatSync(uiFile, { throwIfNoEntry: false })?.isFile()) entries.push({ owner: "apps/admin", version: adminPackage.version,
    module: "@/components/ui", file: uiFile, visibility: "host", ui: true });
  const controllers = packages.flatMap(info =>
    repositoryFiles(root, `${info.directory}/src`, file => file.endsWith(".controller.ts")
      || /[/\\](?:nest|http)\.ts$/u.test(file) || file.endsWith("-http.ts")));
  const apiModules = resolve(root, "apps/api/src/modules");
  const moduleDirectories = packages.some(info => info.directory === "apps/api") && isRepositorySourcePath(root, apiModules) && lstatSync(apiModules, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(apiModules, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => `apps/api/src/modules/${entry.name}`) : [];
  const navigation = resolve(root, "apps/admin/src/app/navigation.tsx");
  const openapi = resolve(root, "apps/api/src/contracts/openapi-document.ts");
  const assembly = resolve(root, "apps/api/src/app.module.ts");
  const extraSources = [ ...(adminPackage ? [navigation] : []),
    ...(packages.some(info => info.directory === "apps/api") ? [openapi, assembly] : []) ].filter(file => isRepositorySourcePath(root, file)
    && lstatSync(file, { throwIfNoEntry: false })?.isFile());
  for (const entry of entries) paths[entry.module] = [entry.file];
  paths["@/registry/*"] = [resolve(root, "packages/ui-arc/vendor/registry/*")];
  paths["@/lib/motion-tokens"] = [resolve(root, "packages/ui-arc/vendor/lib/motion-tokens.ts")];
  const consumers = packages.flatMap(info =>
    repositoryFiles(root, `${info.directory}/src`, file => /\.tsx?$/u.test(file) && !file.endsWith(".d.ts")));
  const source = new RepositorySource(root, [...new Set([...entries.map(entry => entry.file), ...controllers, ...extraSources, ...consumers])], paths);
  for (const diagnostic of source.program.getSyntacticDiagnostics()) {
    if (diagnostic.file) addIssue("source_syntax", repositoryPath(root, diagnostic.file.fileName), ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  }
  const corePackages = new Map<string, { id: string; version: string; directory: string; reference: DevelopmentSourceReference }>();
  for (const file of source.program.getSourceFiles()) {
    const packageInfo = packages.find(info => repositoryPath(root, file.fileName).startsWith(info.directory + "/"));
    if (!packageInfo || file.isDeclarationFile) continue;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "parse"
        && node.arguments.length === 1) {
        const symbol = source.checker.getSymbolAtLocation(node.expression.expression);
        const schema = symbol && source.target(symbol);
        if (schema?.name === "CoreManifestSchema" && schema.declarations?.some(declaration =>
          repositoryPath(root, declaration.getSourceFile().fileName) === "packages/core-contracts/src/manifest.ts")
          && ts.isObjectLiteralExpression(unwrap(node.arguments[0])) && objectProperty(node.arguments[0], "manifestVersion")) {
          const definition = node.arguments[0], id = source.value(objectProperty(definition, "id")), version = source.value(objectProperty(definition, "version"));
          if (typeof id !== "string" || typeof version !== "string") {
            addIssue("core_metadata", repositoryPath(root, file.fileName), "Core 清单标识或版本无法静态解析");
          } else if (corePackages.has(packageInfo.directory)) {
            addIssue("core_metadata", repositoryPath(root, file.fileName), "同一包有多个 Core 清单声明，需要核对归属");
          } else {
            const reference = sourceReference(definition, root), fields = source.value(definition);
            let unresolved = source.unresolvedProperties(definition);
            const assetsExpression = objectProperty(definition, "assets"), manifestObject = unwrap(definition);
            const directAssets = ts.isObjectLiteralExpression(manifestObject)
              && manifestObject.properties.every(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
                && !ts.isComputedPropertyName(property.name))
              && manifestObject.properties.filter(property => property.name?.getText().replace(/^["']|["']$/g, "") === "assets").length === 1;
            const assetsSource = assetsExpression ? describeRepositorySchema(source, assetsExpression) : undefined;
            const assets = directAssets && assetsSource?.status === "indexed"
              && Array.isArray(assetsSource.issues) && assetsSource.issues.length === 0
              ? CoreManifestSchema.innerType().shape.assets.unwrap().safeParse(assetsSource.schema) : undefined;
            const manifestFields = fields !== UNRESOLVED && fields && typeof fields === "object" && !Array.isArray(fields) ? { ...fields } : undefined;
            // 原始部分清单不能绕过资产校验；未知覆盖和构建输入仍保留各自缺口。
            const hadAssets = manifestFields && Object.hasOwn(manifestFields, "assets");
            if (manifestFields) {
              delete manifestFields.assets;
              if (assets?.success) manifestFields.assets = assets.data;
            }
            if (assets?.success) unresolved = unresolved.filter(field => field !== "assets");
            else if ((assetsExpression || hadAssets) && !unresolved.includes("assets")) unresolved.push("assets");
            corePackages.set(packageInfo.directory, { id, version, directory: packageInfo.directory, reference });
            if (version !== packageInfo.version) addIssue("core_version", reference.path, "Core 清单与包版本不一致");
            if (unresolved.length) addIssue("core_metadata", reference.path, `Core 清单仍需构建输入或动态解析 ${unresolved.join(", ")}`);
            coverage.push({ source: reference.path, count: 1, state: unresolved.length || version !== packageInfo.version ? "partial" : "indexed" });
            const name = source.value(objectProperty(definition, "name")), description = source.value(objectProperty(definition, "description"));
            capabilities.push({ id: `core:${id}`, name: typeof name === "string" ? name : id, kind: "module", owner: id, version,
              description: typeof description === "string" ? description : undefined, sources: [reference], documentation: sourceDocuments(root, packageInfo.directory),
              details: { registration: "source", package: packageInfo.directory, packageVersion: packageInfo.version,
                ...(manifestFields ? { manifest: manifestFields } : {}),
                ...(assetsSource ? { assetsSource } : {}),
                unresolvedMetadata: unresolved } });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const consumersBySymbol = importConsumers(source, paths);

  for (const entry of entries) {
    const before = capabilities.length;
    for (const symbol of source.exports(entry.file)) {
      const target = source.target(symbol);
      const resolvedDeclaration = target.valueDeclaration ?? target.declarations?.[0];
      const reexport = symbol.declarations?.find(ts.isExportSpecifier);
      const origin = reexport && ts.isExportDeclaration(reexport.parent.parent) ? reexport.parent.parent.moduleSpecifier : undefined;
      const declaration = resolvedDeclaration ?? reexport;
      const moduleName = origin && ts.isStringLiteralLike(origin) ? origin.text : undefined;
      const candidates = moduleName?.endsWith(".css") ? moduleName.startsWith(".")
        ? [resolve(dirname(origin!.getSourceFile().fileName), moduleName)]
        : Object.entries(paths).flatMap(([pattern, targets]) => {
          const [prefix, suffix] = pattern.split("*");
          if (suffix === undefined) return pattern === moduleName ? targets : [];
          if (!moduleName.startsWith(prefix) || !moduleName.endsWith(suffix)) return [];
          const matched = moduleName.slice(prefix.length, moduleName.length - suffix.length);
          return targets.map(target => target.replace("*", matched));
        }) : [];
      const asset = candidates.find(file => isRepositorySourcePath(root, file) && lstatSync(file, { throwIfNoEntry: false })?.isFile());
      const declaringPackage = declaration && packages.find(info => repositoryPath(root, declaration.getSourceFile().fileName).startsWith(info.directory + "/"));
      const dependencyName = moduleName?.startsWith("@") ? moduleName.split("/").slice(0, 2).join("/") : moduleName?.split("/")[0];
      const externalDependency = dependencyName && declaringPackage?.dependencies[dependencyName]
        && !packages.some(info => info.name === dependencyName) ? {
          name: dependencyName, versionRange: declaringPackage.dependencies[dependencyName],
          source: { path: `${declaringPackage.directory}/package.json` }
        } : undefined;
      if (!resolvedDeclaration && !asset && !externalDependency)
        addIssue("export_symbol", repositoryPath(root, entry.file), `未解析导出 ${symbol.name} 的本仓声明`);
      if (!declaration || !isRepositorySourcePath(root, declaration.getSourceFile().fileName)) {
        continue;
      }
      const documentation = ts.displayPartsToString(target.getDocumentationComment(source.checker)).trim();
      const callers = consumersBySymbol.get(target) ?? [];
      const sourceDoc = sourceDocuments(root, repositoryPath(root, dirname(asset ?? declaration.getSourceFile().fileName)));
      const documents = sourceDocuments(root, entry.owner);
      if (entry.owner === "apps/admin") {
        if (entry.visibility === "public") documents.push({ path: "packages/platform-admin/src/core/README.md" });
        else documents.push({ path: "packages/ui-arc/README.md" });
      }
      capabilities.push({ id: `export:${entry.module}:${symbol.name}`, name: symbol.name, kind: entry.ui ? "ui" : "export",
        owner: entry.owner, version: entry.version, description: documentation || undefined,
        sources: [...(asset ? [{ path: repositoryPath(root, asset) }] : []),
          { ...sourceReference(declaration, root), symbol: resolvedDeclaration ? target.name : symbol.name },
          ...(externalDependency && !resolvedDeclaration ? [externalDependency.source] : [])],
        documentation: [...documents, ...sourceDoc.filter(doc => !documents.some(item => item.path === doc.path))],
        entry: { kind: "import", module: entry.module, symbol: symbol.name,
          typeOnly: reexport?.isTypeOnly || Boolean(reexport && ts.isExportDeclaration(reexport.parent.parent) && reexport.parent.parent.isTypeOnly)
            || Boolean(resolvedDeclaration && !(target.flags & ts.SymbolFlags.Value)), visibility: entry.visibility },
        details: { directImportCount: resolvedDeclaration ? callers.length : 0, directImports: resolvedDeclaration ? callers.slice(0, 5) : [],
          directImportsStatus: resolvedDeclaration ? "resolved-source" : "not-indexed",
          declarationStatus: resolvedDeclaration ? "resolved-source" : asset ? "source-asset" : externalDependency ? "external-dependency" : "unresolved",
          ...(moduleName ? { reexport: { module: moduleName, symbol: reexport?.propertyName?.text ?? reexport?.name.text ?? symbol.name,
            ...(externalDependency && !resolvedDeclaration ? { dependency: externalDependency } : {}) } } : {}) } });
    }
    const file = repositoryPath(root, entry.file);
    coverage.push({ source: file, count: capabilities.length - before, state: issues.some(issue => issue.path === file) ? "partial" : "indexed" });
  }

  for (const entry of entries.filter(entry => entry.module.endsWith("/admin"))) {
    const before = capabilities.length;
    const issue = (node: ts.Node, message: string) => {
      const location = sourceReference(node, root);
      addIssue("page_metadata", repositoryPath(root, entry.file), `${message} (${location.path}:${location.line}: ${node.getText()})`);
    };
    const structuralBody = (body: ts.Block) => body.statements.every(statement => ts.isReturnStatement(statement)
      || ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const
      && statement.declarationList.declarations.every(declaration => {
        const initial = declaration.initializer && unwrap(declaration.initializer);
        if (initial && ts.isArrowFunction(initial)) return true;
        if (!initial || !ts.isCallExpression(initial) || initial.arguments.some(ts.isSpreadElement)) return false;
        const symbol = source.checker.getSymbolAtLocation(initial.expression), factory = symbol && source.target(symbol).valueDeclaration;
        const type = factory && ts.isFunctionDeclaration(factory) && factory.type;
        const contract = type && ts.isTypeReferenceNode(type) && source.checker.getSymbolAtLocation(type.typeName);
        return Boolean(contract && source.target(contract).declarations?.some(node =>
          repositoryPath(root, node.getSourceFile().fileName) === "packages/core-contracts/src/admin.ts" && ts.isInterfaceDeclaration(node)
          && node.name.text === "CoreAdminContribution"));
      }));
    // 这里只追正式出口实际引用的贡献结构。字段值仍由同源读取器解释，不调用工厂。
    const locate = (expression: ts.Expression, key?: string, seen = new Set<ts.Node>()): { expression: ts.Expression; via: ts.Node[] } | undefined => {
      const node = unwrap(expression);
      if (seen.has(node) || seen.size > 80) return;
      const chain = new Set(seen).add(node);
      if (ts.isIdentifier(node)) {
        const symbol = source.checker.getSymbolAtLocation(node), declaration = symbol && source.target(symbol).valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
          && ts.isVariableDeclarationList(declaration.parent) && declaration.parent.flags & ts.NodeFlags.Const
          && repositoryPath(root, declaration.getSourceFile().fileName).startsWith(entry.owner + "/")) {
          if (source.unresolvedProperties(node).some(message => message.startsWith("post-write:")))
            return key ? undefined : { expression: node, via: [declaration] };
          const found = locate(declaration.initializer, key, chain);
          return found && { expression: found.expression, via: [declaration, ...found.via] };
        }
      }
      if (ts.isPropertyAccessExpression(node)) {
        const selected = locate(node.expression, node.name.text, chain);
        const found = selected && locate(selected.expression, key, chain);
        return found && { expression: found.expression, via: [node, ...selected!.via, ...found.via] };
      }
      if (ts.isCallExpression(node)) {
        const unresolved = key ? undefined : { expression: node, via: [] };
        const symbol = source.checker.getSymbolAtLocation(node.expression), declaration = symbol && source.target(symbol).valueDeclaration;
        const callable = declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? unwrap(declaration.initializer) : declaration;
        if (!callable || !(ts.isFunctionDeclaration(callable) || ts.isArrowFunction(callable)) || !callable.body
          || !repositoryPath(root, callable.getSourceFile().fileName).startsWith(entry.owner + "/")
          || callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
          || ts.isFunctionDeclaration(callable) && callable.asteriskToken || node.arguments.some(ts.isSpreadElement)) return unresolved;
        const body = callable.body;
        const returns = ts.isBlock(body) ? body.statements.filter(ts.isReturnStatement) : [];
        // 顶层只有 const 与唯一直接返回；控制流、写入及未知语句不靠源码行号解释。
        if (ts.isBlock(body) && (returns.length !== 1 || !structuralBody(body))) return unresolved;
        const returned = ts.isBlock(body) ? returns[0].expression : body;
        const found = returned && locate(returned, key, chain);
        return found ? { expression: found.expression, via: [node, callable, ...(returns.length ? [returns[0]] : []), ...found.via] } : unresolved;
      }
      if (key) {
        if (!ts.isObjectLiteralExpression(node) || node.properties.some(property => !(ts.isPropertyAssignment(property)
          || ts.isShorthandPropertyAssignment(property)) || ts.isComputedPropertyName(property.name))) return;
        const properties = node.properties.filter((property): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText().replace(/^["']|["']$/g, "") === key);
        const property = properties.length === 1 ? properties[0] : undefined;
        const child = property && (ts.isPropertyAssignment(property) ? property.initializer : property.name);
        return child ? { expression: child, via: [node, property!] } : undefined;
      }
      return { expression: node, via: [] };
    };
    const roots = new Set<ts.Node>();
    for (const symbol of source.exports(entry.file)) {
      const declaration = source.target(symbol).valueDeclaration;
      const callable = declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? unwrap(declaration.initializer) : declaration;
      if (!callable || roots.has(callable) || !(ts.isFunctionDeclaration(callable) || ts.isArrowFunction(callable))
        || !callable.body || !ts.isBlock(callable.body)) continue;
      roots.add(callable);
      const returns = callable.body.statements.filter(ts.isReturnStatement);
      if (returns.length !== 1 || !returns[0].expression) {
        if (returns.some(statement => statement.expression && objectProperty(statement.expression, "pages"))) issue(callable, "Core 页面需要唯一直接返回");
        continue;
      }
      const node = returns[0], definition = node.expression!;
      const pages = locate(definition, "pages"), coreIdExpression = locate(definition, "coreId");
      if (pages && (callable.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
        || ts.isFunctionDeclaration(callable) && callable.asteriskToken)) { issue(callable, "Core 页面异步或延迟工厂仍需来源核对"); continue; }
      if (pages && (ts.isArrayLiteralExpression(unwrap(pages.expression)) && (unwrap(pages.expression) as ts.ArrayLiteralExpression).elements.some(ts.isSpreadElement)
        || ts.isCallExpression(pages.expression) && ts.isPropertyAccessExpression(pages.expression.expression) && pages.expression.expression.name.text === "map")
        && !structuralBody(callable.body)) { issue(node, "Core 页面聚合包含未支持的控制流或语句"); continue; }
      const coreIdValue = coreIdExpression && locate(coreIdExpression.expression);
      const coreId = source.value(coreIdValue?.expression);
      if (pages && typeof coreId === "string") {
          const contributionVersion = source.value(objectProperty(definition, "implementationVersion"));
          const describePages = (expression: ts.Expression, via: ts.Node[], seen = new Set<ts.Node>()) => {
            if (seen.has(expression) || seen.size > 80) { issue(expression, "Core 页面聚合存在递归引用"); return; }
            const chain = new Set(seen).add(expression), selected = locate(expression);
            if (!selected) { issue(expression, "Core 页面列表仍需来源核对"); return; }
            const mapped = ts.isCallExpression(selected.expression) && ts.isPropertyAccessExpression(selected.expression.expression)
              && selected.expression.expression.name.text === "map" ? describeRepositorySchema(source, selected.expression) : undefined;
            const elements = ts.isArrayLiteralExpression(selected.expression) ? selected.expression.elements
              : Array.isArray(mapped?.schema) ? mapped.schema.map(() => selected.expression) : undefined;
            if (!elements) { issue(selected.expression, "Core 页面列表仍需来源核对"); return; }
            const locations = [...via, ...selected.via];
            for (const [index, page] of elements.entries()) {
              if (ts.isSpreadElement(page)) { describePages(page.expression, [...locations, page], chain); continue; }
              const pageObject = unwrap(page), traced = Boolean(mapped) || locations.some(ts.isCallExpression)
                || ts.isObjectLiteralExpression(pageObject) && pageObject.properties.some(ts.isSpreadAssignment);
              let descriptorSource = mapped ?? describeRepositorySchema(source, page);
              if (mapped && Array.isArray(mapped.schema)) {
                // 数组映射只保留本页的值、指针与缺口，不把其他表项放进页面查询资料。
                const prefix = `/${index}`;
                const cropFieldSources = (fields: NonNullable<DevelopmentCapability["details"]>[string]) => Array.isArray(fields) ? fields.flatMap(field =>
                  field && typeof field === "object" && !Array.isArray(field) && typeof field.pointer === "string"
                    && (field.pointer === prefix || field.pointer.startsWith(prefix + "/"))
                    ? [{ ...field, pointer: field.pointer.slice(prefix.length) }] : []) : [];
                const fieldIssues = Array.isArray(mapped.issues) ? mapped.issues.filter((item): item is string => typeof item === "string"
                  && (item.startsWith(prefix + ":") || item.startsWith(prefix + "/") || item.startsWith("/:")))
                  .map(item => item.startsWith(prefix) ? item.slice(prefix.length) : item) : [];
                descriptorSource = { expression: mapped.expression, source: mapped.source, arrayIndex: index,
                  schema: mapped.schema[index], fieldSources: cropFieldSources(mapped.fieldSources),
                  unresolvedFieldSources: cropFieldSources(mapped.unresolvedFieldSources), issues: fieldIssues,
                  status: fieldIssues.length ? "source-reference" : "indexed" };
              }
              // sourceFields 枚举原整张 AST 表；页面查询仅保留实际所选字段，避免未引用项进入搜索。
              delete descriptorSource.sourceFields;
              const fields = descriptorSource.schema && typeof descriptorSource.schema === "object" && !Array.isArray(descriptorSource.schema)
                ? descriptorSource.schema : {};
              const fieldIssues = Array.isArray(descriptorSource.issues) ? descriptorSource.issues.filter((item): item is string => typeof item === "string") : [];
              const complete = (name: string) => !fieldIssues.some(message => message.startsWith(`/${name}:`) || message.startsWith(`/${name}/`));
              const id = fields.id, path = fields.path, title = fields.title;
              const label = CorePageTextSchema.safeParse(title);
              if (!CorePageDescriptorSchema.shape.id.safeParse(id).success || !CorePageDescriptorSchema.shape.path.safeParse(path).success
                || typeof id !== "string" || typeof path !== "string" || !label.success || !complete("id") || !complete("path") || !complete("title")) {
                issue(page, "Core 页面需要未被未知覆盖且通过正式schema的标识、路径和名称");
                continue;
              }
              if (capabilities.some(capability => capability.id === `page:${coreId}:${id}`)) { issue(page, `Core 页面 ${id} 被重复引用`); continue; }
              const core = corePackages.get(entry.owner);
              let unresolved = traced ? [...new Set(fieldIssues.filter(message => message !== "schema-expansion:source-reference")
                .map(message => /^\/([^/:]+)/.exec(message)?.[1] ?? message))] : source.unresolvedProperties(page, ["component"]);
              const permissionsExpression = objectProperty(page, "permissions");
              // 这里只展开唯一的直接属性；页面对象的未知覆盖仍交回原源码缺口。
              const directPermissions = ts.isObjectLiteralExpression(pageObject)
                && pageObject.properties.every(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
                  && !ts.isComputedPropertyName(property.name))
                && pageObject.properties.filter(property => property.name?.getText().replace(/^["']|["']$/g, "") === "permissions").length === 1;
              const permissionsSource = permissionsExpression ? describeRepositorySchema(source, permissionsExpression) : undefined;
              const permissions = directPermissions && permissionsSource?.status === "indexed"
                && Array.isArray(permissionsSource.issues) && permissionsSource.issues.length === 0
                ? CorePageDescriptorSchema.shape.permissions.safeParse(permissionsSource.schema)
                : traced && complete("permissions") ? CorePageDescriptorSchema.shape.permissions.safeParse(fields.permissions) : undefined;
              if (permissions?.success) unresolved = unresolved.filter(field => field !== "permissions");
              else if (!unresolved.includes("permissions")) unresolved.push("permissions");
              const component = objectProperty(page, "component"), componentSymbol = component && source.checker.getSymbolAtLocation(unwrap(component));
              const componentDeclaration = componentSymbol && source.target(componentSymbol).valueDeclaration;
              if (traced && !unresolved.includes("component")) unresolved.push("component");
              if (core && (core.id !== coreId || core.version !== entry.version)) addIssue("core_version", repositoryPath(root, entry.file), "页面贡献与 Core 清单或包版本不一致");
              if (contributionVersion !== entry.version) {
                unresolved.push("implementationVersion");
                addIssue("core_version", repositoryPath(root, entry.file), "页面实现版本无法解析或与包版本不一致");
              }
              const known: Record<string, NonNullable<DevelopmentCapability["details"]>[string]> = {};
              for (const name of ["parent", "menu", "purpose"] as const) {
                if (Object.hasOwn(fields, name)) {
                  const parsed = complete(name) ? CorePageDescriptorSchema.shape[name].safeParse(fields[name]) : undefined;
                  if (parsed?.success && parsed.data !== undefined) known[name] = parsed.data;
                  else if (!unresolved.includes(name)) unresolved.push(name);
                }
              }
              if (!Object.hasOwn(fields, "purpose") && complete("purpose") && !fieldIssues.some(message => message.startsWith("/:"))) known.purpose = "business";
              unresolved = [...new Set(unresolved)];
              if (unresolved.length) issue(page, `页面 ${id} 尚有来源字段 ${unresolved.join(", ")}`);
              capabilities.push({ id: `page:${coreId}:${id}`, name: corePageText(label.data, "zh-CN"), kind: "page", owner: coreId, version: entry.version,
                sources: [{ ...sourceReference(page, root), symbol: id },
                  ...locations.map(location => sourceReference(location, root)),
                  ...(traced ? [...(Array.isArray(descriptorSource.fieldSources) ? descriptorSource.fieldSources : []),
                    ...(Array.isArray(descriptorSource.unresolvedFieldSources) ? descriptorSource.unresolvedFieldSources : [])].flatMap(field => field && typeof field === "object"
                    && !Array.isArray(field) && field.source && typeof field.source === "object" && !Array.isArray(field.source)
                    ? [field.source as DevelopmentSourceReference] : []) : []),
                  ...(componentDeclaration && isRepositorySourcePath(root, componentDeclaration.getSourceFile().fileName)
                    ? [{ ...sourceReference(componentDeclaration, root), symbol: componentSymbol?.name }] : []),
                  ...(core ? [core.reference] : [])], documentation: sourceDocuments(root, entry.owner),
                entry: { kind: "page", path: `/cores/${coreId}${path === "/" ? "" : path}` },
                details: { registration: "source", title: label.data, ...known,
                  ...(typeof contributionVersion === "string" ? { implementationVersion: contributionVersion } : {}),
                  ...(permissions?.success ? { permissions: permissions.data } : {}),
                  ...(permissionsSource ? { permissionsSource } : {}),
                  ...(traced ? { descriptorSource } : {}),
                  package: entry.owner, unresolvedMetadata: unresolved } });
            }
          };
          describePages(pages.expression, [node, ...pages.via]);
      } else if (pages || objectProperty(definition, "pages")) issue(node, "Core 页面列表或归属无法静态解析");
    }
    const file = repositoryPath(root, entry.file);
    coverage.push({ source: file, count: capabilities.length - before, state: issues.some(issue => issue.path === file) ? "partial" : "indexed" });
  }

  for (const moduleDirectory of moduleDirectories) {
    const files = repositoryFiles(root, moduleDirectory, file => dirname(file) === resolve(root, moduleDirectory)
      && /(?:\.controller|\.service|\.repository|\.providers|\.ports|original-core-[a-z-]+)\.ts$/u.test(file));
    const references = files.map(file => ({ path: repositoryPath(root, file) }));
    if (!references.length) continue;
    const moduleName = moduleDirectory.split("/").at(-1)!;
    const primary = references.filter(file => ["controller", "service", "repository", "providers"].some(kind =>
      file.path.endsWith(`/${moduleName}.${kind}.ts`) || file.path.endsWith(`/${moduleName}-application.${kind}.ts`)));
    const entrances = primary.length ? primary : references.slice(0, 6);
    const documented = entrances.find(file => headerDescription(root, file.path));
    capabilities.push({ id: `module:${moduleDirectory}`, name: moduleDirectory.split("/").at(-1)!, kind: "module", owner: moduleDirectory,
      description: documented ? headerDescription(root, documented.path) : undefined,
      sources: entrances, documentation: sourceDocuments(root, moduleDirectory), details: { directory: moduleDirectory } });
  }

  const apiDocumentation = repositoryApiDocumentation(source);
  const registeredControllers = new Map<string, DevelopmentSourceReference>();
  if (extraSources.includes(assembly)) {
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText() === "controllers" && ts.isArrayLiteralExpression(node.initializer)) {
        for (const element of node.initializer.elements) {
          const symbol = source.checker.getSymbolAtLocation(element);
          const declaration = symbol && source.target(symbol).valueDeclaration;
          if (declaration) registeredControllers.set(declaration.getSourceFile().fileName + ":" + declaration.getStart(), sourceReference(element, root));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source.source(assembly));
  }
  const apiCapabilities = new Map<string, DevelopmentCapability>();
  for (const file of controllers) {
    const before = capabilities.length;
    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const decorators = ts.getDecorators(node) ?? [];
        const controller = decorators.find(item => ts.isCallExpression(item.expression) && item.expression.expression.getText() === "Controller");
        if (controller && ts.isCallExpression(controller.expression)) {
          const prefix = controller.expression.arguments.length ? source.value(controller.expression.arguments[0]) : "";
          const prefixes = typeof prefix === "string" ? [prefix] : Array.isArray(prefix) && prefix.every(item => typeof item === "string") ? prefix as string[] : [];
          if (!prefixes.length) addIssue("controller_path", repositoryPath(root, file), `无法静态解析 ${node.name?.text ?? "Controller"} 路径`);
          for (const member of node.members) {
            for (const decorator of ts.canHaveDecorators(member) ? ts.getDecorators(member) ?? [] : []) {
              if (!ts.isCallExpression(decorator.expression)) continue;
              const method = decorator.expression.expression.getText().toUpperCase();
              if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ALL"].includes(method)) continue;
              const suffix = decorator.expression.arguments.length ? source.value(decorator.expression.arguments[0]) : "";
              const pathArgument = decorator.expression.arguments[0];
              const httpMetadata = pathArgument && ts.isPropertyAccessExpression(pathArgument) ? source.value(pathArgument.expression) : UNRESOLVED;
              const httpSymbol = pathArgument && ts.isPropertyAccessExpression(pathArgument)
                ? source.checker.getSymbolAtLocation(pathArgument.expression) : undefined;
              const httpDeclaration = httpSymbol && source.target(httpSymbol).valueDeclaration;
              const httpDefinition = httpDeclaration && ts.isPropertyAssignment(httpDeclaration) ? httpDeclaration.initializer : undefined;
              const unresolved = httpDefinition ? source.unresolvedProperties(httpDefinition) : [];
              const schemas = Object.fromEntries(["params", "query", "body", "request", "response"].flatMap(name => {
                const expression = httpDefinition && objectProperty(httpDefinition, name);
                if (!expression) return [];
                return [[name, describeRepositorySchema(source, expression)]];
              }));
              const httpDetails: DevelopmentCapability["details"] = httpDefinition
                ? { apiFieldsStatus: "source-reference", httpContract: { source: sourceReference(httpDefinition, root), schemas,
                  ...(httpMetadata !== UNRESOLVED && httpMetadata && typeof httpMetadata === "object" && !Array.isArray(httpMetadata) ? { metadata: httpMetadata } : {}) },
                  unresolvedMetadata: unresolved }
                : { apiFieldsStatus: "not-indexed" };
              const httpSummary = httpMetadata !== UNRESOLVED && httpMetadata && typeof httpMetadata === "object"
                && !Array.isArray(httpMetadata) && typeof httpMetadata.summary === "string" ? httpMetadata.summary : undefined;
              const suffixes = typeof suffix === "string" ? [suffix] : Array.isArray(suffix) && suffix.every(item => typeof item === "string") ? suffix as string[] : [];
              if (!suffixes.length) addIssue("route_path", repositoryPath(root, file), `无法静态解析 ${decorator.expression.getText()}`);
              for (const prefix of prefixes) for (const suffix of suffixes) {
                const path = "/" + ["api", prefix, suffix].filter(Boolean).join("/").replace(/\/+/gu, "/").replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
                const api = apiDocumentation.get(`${method} ${path}`);
                const packageInfo = packages.find(info => repositoryPath(root, file).startsWith(info.directory + "/"));
                const core = packageInfo && corePackages.get(packageInfo.directory);
                const owner = core?.id ?? packageInfo?.directory ?? repositoryPath(root, dirname(file));
                const id = `api:${method}:${path}`;
                const declaration = { ...sourceReference(member, root), symbol: member.name?.getText() };
                const existing = apiCapabilities.get(id);
                const assemblyReference = registeredControllers.get(node.getSourceFile().fileName + ":" + node.getStart());
                const references = [declaration, ...(assemblyReference ? [assemblyReference] : []), ...(api ? [api.reference] : []),
                  ...(httpDefinition ? [sourceReference(httpDefinition, root)] : []), ...(core ? [core.reference] : [])];
                if (unresolved.length) addIssue("api_metadata", repositoryPath(root, file), `接口 ${method} ${path} 尚有动态合同字段 ${unresolved.join(", ")}`);
                const apiIssues = api?.details.openapiSource;
                if (apiIssues && typeof apiIssues === "object" && !Array.isArray(apiIssues) && Array.isArray(apiIssues.issues))
                  for (const issue of apiIssues.issues) addIssue("api_schema", api!.reference.path, `接口 ${method} ${path} 的字段资料缺口 ${issue}`);
                if (existing) {
                  existing.sources.push(...references);
                  existing.details = { ...existing.details, multipleDeclarations: true,
                    declarationOwners: [...(Array.isArray(existing.details?.declarationOwners) ? existing.details.declarationOwners : []),
                      { owner, ...(packageInfo ? { package: packageInfo.directory, version: packageInfo.version } : {}) }] };
                  if (core) {
                    if (existing.details.coreId && existing.details.coreId !== core.id) addIssue("api_owner", repositoryPath(root, file), `接口 ${method} ${path} 有不同 Core 声明`);
                    else {
                      existing.owner = core.id;
                      existing.version = core.version;
                      existing.details.coreId = core.id;
                      if (httpDefinition) Object.assign(existing.details, httpDetails);
                      if (api) Object.assign(existing.details, api.details);
                      for (const document of sourceDocuments(root, core.directory)) {
                        if (!existing.documentation.some(item => item.path === document.path)) existing.documentation.push(document);
                      }
                    }
                  }
                  if (assemblyReference) {
                    existing.details.registration = "declared-in-host";
                  }
                  continue;
                }
                const capability: DevelopmentCapability = { id, name: api?.summary || httpSummary || `${method} ${path}`, kind: "api", owner,
                  version: core?.version ?? packageInfo?.version,
                  description: nodeDocumentation(member), sources: references,
                  documentation: packageInfo ? sourceDocuments(root, packageInfo.directory)
                    : [...sourceDocuments(root, owner), { path: "apps/api/src/contracts/openapi-document.ts", ...(api?.reference ?? {}) }],
                  entry: { kind: "http", method: method as "GET", path },
                  details: { controller: node.name?.text ?? "Controller", controllerMethod: member.name?.getText() ?? "",
                    registration: assemblyReference ? "declared-in-host" : "source",
                    ...(core ? { coreId: core.id } : {}),
                    declarationOwners: [{ owner, ...(packageInfo ? { package: packageInfo.directory, version: packageInfo.version } : {}) }],
                    ...httpDetails,
                    ...(api ? api.details : {}),
                    ...(api?.operationId ? { operationId: api.operationId } : {}) } };
                capabilities.push(capability);
                apiCapabilities.set(id, capability);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source.source(file));
    const relative = repositoryPath(root, file);
    coverage.push({ source: relative, count: capabilities.length - before, state: issues.some(issue => issue.path === relative) ? "partial" : "indexed" });
  }

  if (extraSources.includes(navigation)) {
    const routes = source.exports(navigation).find(symbol => symbol.name === "APP_ROUTES");
    const declaration = routes && source.target(routes).valueDeclaration;
    const values = declaration && ts.isVariableDeclaration(declaration) ? source.value(declaration.initializer) : UNRESOLVED;
    if (values !== UNRESOLVED && values && typeof values === "object" && !Array.isArray(values)) {
      const routeObject = declaration && ts.isVariableDeclaration(declaration) && declaration.initializer ? unwrap(declaration.initializer) : undefined;
      const routeSources = routeObject && ts.isObjectLiteralExpression(routeObject) ? new Map(routeObject.properties.filter(ts.isPropertyAssignment)
        .map(property => [property.name.getText(), property])) : new Map<string, ts.PropertyAssignment>();
      const before = capabilities.length;
      for (const [id, value] of Object.entries(values)) {
        if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.path !== "string" || typeof value.label !== "string") {
          addIssue("page_metadata", repositoryPath(root, navigation), `页面 ${id} 缺少可解析的路径或名称`);
          continue;
        }
        const routeSource = routeSources.get(id);
        const unresolved = routeSource ? source.unresolvedProperties(routeSource.initializer, ["icon"]) : [];
        capabilities.push({ id: `page:admin:${id}`, name: value.label, kind: "page", owner: "apps/admin",
          sources: [{ ...sourceReference(routeSource ?? declaration!, root), symbol: `APP_ROUTES.${id}` }],
          documentation: sourceDocuments(root, "apps/admin"), entry: { kind: "page", path: value.path },
          details: { ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "icon")),
            ...(unresolved.length ? { unresolvedMetadata: unresolved } : {}) } });
      }
      coverage.push({ source: repositoryPath(root, navigation), count: capabilities.length - before, state: "indexed" });
    } else addIssue("page_registry", repositoryPath(root, navigation), "无法静态解析 APP_ROUTES 声明");
  }

  const uiManifestPath = "packages/ui-arc/manifest.json";
  if (lstatSync(resolve(root, uiManifestPath), { throwIfNoEntry: false })?.isFile()) {
    const manifest = readRepositoryJson(root, uiManifestPath);
    const entries = manifest.entries as { name: string; dependencies: string[]; files: { path: string }[] }[];
    for (const entry of entries) capabilities.push({ id: `extension:uiarc:${entry.name}`, name: entry.name, kind: "extension", owner: "packages/ui-arc",
      sources: [{ path: uiManifestPath }, ...entry.files.map(file => ({ path: `packages/ui-arc/vendor/${file.path}` }))],
      documentation: [{ path: "packages/ui-arc/README.md" }, { path: "packages/ui-arc/COMPONENTS.md" }],
      details: { dependencies: entry.dependencies, availability: "reserved-source" } });
    coverage.push({ source: uiManifestPath, count: entries.length, state: "indexed" });
  }

  let revision: string | undefined;
  let workingTreeChanged: boolean | undefined;
  if (hasGit) {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    workingTreeChanged = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=normal"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).length > 0;
  }
  return DevelopmentCapabilityIndexSchema.parse({ schemaVersion: 1, audience: "development",
    source: { snapshot: "working-tree", revision, workingTreeChanged, version: rootPackage.version },
    coverage, issues, capabilities: capabilities.sort((a, b) => a.id.localeCompare(b.id, "en")) });
}
