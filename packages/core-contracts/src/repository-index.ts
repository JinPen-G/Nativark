/**
 * 将正式包出口、API/页面声明和组件来源组合成开发索引，提供单一可发现入口。
 * 每次读取当前检出源码，保存固定Git来源和未解析项；运行可用性由真实宿主另行提供。
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { DevelopmentCapabilityIndexSchema, type DevelopmentCapability, type DevelopmentCapabilityIndex,
  type DevelopmentSourceReference } from "./development";
import { RepositorySource, UNRESOLVED, isRepositorySourcePath, nodeDocumentation, readRepositoryJson, readRepositoryText,
  repositoryFiles, repositoryPath, sourceReference } from "./repository-source";

interface PublicEntry { owner: string; version: string; module: string; file: string; visibility: "public" | "host"; ui?: boolean }
interface PackageInfo { directory: string; name: string; version: string; entries: PublicEntry[] }

function exportTarget(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const conditions = value as Record<string, unknown>;
    for (const key of ["source", "types", "import", "require", "default"]) {
      const target = exportTarget(conditions[key]);
      if (target) return target;
    }
  }
}

function packageSource(root: string, directory: string, target: string): string | undefined {
  const absolute = resolve(root, directory, target);
  if (!isRepositorySourcePath(root, absolute)) return undefined;
  if (/\.(?:tsx?|mts|cts)$/u.test(target) && !/\.d\.ts$/u.test(target) && lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) return absolute;
  const configFiles = readdirSync(resolve(root, directory)).filter(file => /^tsconfig(?:\.[^.]+)*\.json$/u.test(file));
  for (const configFile of configFiles) {
    const config = readRepositoryJson(root, `${directory}/${configFile}`);
    const options = config.compilerOptions as Record<string, unknown> | undefined;
    if (!options || typeof options.outDir !== "string" || typeof options.rootDir !== "string") continue;
    const output = resolve(root, directory, options.outDir);
    const suffix = repositoryPath(output, absolute);
    if (suffix.startsWith("..")) continue;
    const stem = suffix.replace(/(?:\.d)?\.(?:js|ts|mjs|mts|cjs|cts)$/u, "");
    for (const extension of [".ts", ".tsx", ".mts", ".cts"]) {
      const source = resolve(root, directory, options.rootDir, stem + extension);
      if (isRepositorySourcePath(root, source) && lstatSync(source, { throwIfNoEntry: false })?.isFile()) return source;
    }
  }
}

function sourceDocuments(root: string, directory: string): DevelopmentSourceReference[] {
  return ["README.md", "AGENTS.md"].filter(file => lstatSync(resolve(root, directory, file), { throwIfNoEntry: false })?.isFile())
    .map(file => ({ path: `${directory}/${file}` }));
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

export function buildRepositoryCapabilityIndex(directory: string): DevelopmentCapabilityIndex {
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink()) throw new Error("源码根目录须为真实检出目录");
  const rootPackage = readRepositoryJson(root, "package.json");
  const capabilities: DevelopmentCapability[] = [], issues: DevelopmentCapabilityIndex["issues"] = [], coverage: DevelopmentCapabilityIndex["coverage"] = [];
  const packages: PackageInfo[] = [];
  const addIssue = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  for (const workspace of workspaces) {
    if (typeof workspace !== "string" || !workspace.endsWith("/*")) {
      addIssue("workspace_pattern", "package.json", "当前源码索引支持一层 workspace 通配目录");
      continue;
    }
    const parent = workspace.slice(0, -2);
    if (!lstatSync(resolve(root, parent), { throwIfNoEntry: false })?.isDirectory()) {
      coverage.push({ source: parent, count: 0, state: "not_present" });
      continue;
    }
    for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const packageDirectory = `${parent}/${entry.name}`;
      if (!lstatSync(resolve(root, packageDirectory, "package.json"), { throwIfNoEntry: false })?.isFile()) continue;
      const manifest = readRepositoryJson(root, `${packageDirectory}/package.json`);
      if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
        addIssue("package_metadata", `${packageDirectory}/package.json`, "包缺少名称或版本");
        continue;
      }
      const info: PackageInfo = { directory: packageDirectory, name: manifest.name, version: manifest.version, entries: [] };
      const exports = typeof manifest.exports === "string" ? { ".": manifest.exports }
        : manifest.exports && typeof manifest.exports === "object" ? manifest.exports as Record<string, unknown>
        : manifest.main || manifest.types ? { ".": { types: manifest.types, default: manifest.main } } : {};
      for (const [subpath, conditions] of Object.entries(exports)) {
        const target = exportTarget(conditions);
        const file = target && packageSource(root, packageDirectory, target);
        if (!file) {
          addIssue("export_source", `${packageDirectory}/package.json`, `未找到 ${subpath} 对应的当前源码入口`);
          continue;
        }
        info.entries.push({ owner: packageDirectory, version: info.version,
          module: info.name + (subpath === "." ? "" : subpath.slice(1)), file, visibility: "public" });
      }
      packages.push(info);
      const dependencyList = manifest.dependencies && typeof manifest.dependencies === "object"
        ? manifest.dependencies as Record<string, string> : {};
      capabilities.push({ id: `module:${packageDirectory}`, name: info.name, kind: "module", owner: packageDirectory,
        version: info.version, description: typeof manifest.description === "string" && manifest.description ? manifest.description : undefined,
        sources: [{ path: `${packageDirectory}/package.json` }, ...info.entries.map(item => ({ path: repositoryPath(root, item.file) }))],
        documentation: sourceDocuments(root, packageDirectory),
        details: { publicImports: info.entries.map(item => item.module), dependencies: dependencyList } });
    }
  }
  const entries = packages.flatMap(info => info.entries);
  const uiFile = resolve(root, "apps/admin/src/components/ui/index.ts");
  const adminPackage = packages.find(info => info.directory === "apps/admin");
  if (adminPackage && lstatSync(uiFile, { throwIfNoEntry: false })?.isFile()) entries.push({ owner: "apps/admin", version: adminPackage.version,
    module: "@/components/ui", file: uiFile, visibility: "host", ui: true });
  const controllers = repositoryFiles(root, "apps/api/src", file => file.endsWith(".controller.ts"));
  const packageControllers = packages.filter(info => info.directory.startsWith("packages/")).flatMap(info =>
    repositoryFiles(root, `${info.directory}/src`, file => file.endsWith(".controller.ts") || /[/\\]nest\.ts$/u.test(file)));
  controllers.push(...packageControllers);
  const apiModules = resolve(root, "apps/api/src/modules");
  const moduleDirectories = isRepositorySourcePath(root, apiModules) && lstatSync(apiModules, { throwIfNoEntry: false })?.isDirectory()
    ? readdirSync(apiModules, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => `apps/api/src/modules/${entry.name}`) : [];
  const navigation = resolve(root, "apps/admin/src/app/navigation.tsx");
  const openapi = resolve(root, "apps/api/src/contracts/openapi-document.ts");
  const assembly = resolve(root, "apps/api/src/app.module.ts");
  const extraSources = [navigation, openapi, assembly].filter(file => isRepositorySourcePath(root, file)
    && lstatSync(file, { throwIfNoEntry: false })?.isFile());
  const paths = Object.fromEntries(entries.map(entry => [entry.module, [entry.file]]));
  paths["@/*"] = [resolve(root, "apps/admin/src/*")];
  paths["@/registry/*"] = [resolve(root, "packages/ui-arc/vendor/registry/*")];
  const source = new RepositorySource(root, [...new Set([...entries.map(entry => entry.file), ...controllers, ...extraSources])], paths);

  for (const entry of entries) {
    const before = capabilities.length;
    for (const symbol of source.exports(entry.file)) {
      const target = source.target(symbol);
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      if (!declaration || repositoryPath(root, declaration.getSourceFile().fileName).startsWith("..")) {
        addIssue("export_symbol", repositoryPath(root, entry.file), `未解析导出 ${symbol.name} 的本仓声明`);
        continue;
      }
      const documentation = ts.displayPartsToString(target.getDocumentationComment(source.checker)).trim();
      const documents = sourceDocuments(root, entry.owner);
      if (entry.owner === "apps/admin") {
        if (entry.visibility === "public") documents.push({ path: "apps/admin/src/core/README.md" });
        else documents.push({ path: "packages/ui-arc/README.md" });
      }
      capabilities.push({ id: `export:${entry.module}:${symbol.name}`, name: symbol.name, kind: entry.ui ? "ui" : "export",
        owner: entry.owner, version: entry.version, description: documentation || undefined,
        sources: [{ ...sourceReference(declaration, root), symbol: target.name }], documentation: documents,
        entry: { kind: "import", module: entry.module, symbol: symbol.name, typeOnly: !(target.flags & ts.SymbolFlags.Value), visibility: entry.visibility } });
    }
    const file = repositoryPath(root, entry.file);
    coverage.push({ source: file, count: capabilities.length - before, state: issues.some(issue => issue.path === file) ? "partial" : "indexed" });
  }

  for (const entry of entries.filter(entry => entry.module.endsWith("/admin"))) {
    const before = capabilities.length;
    const describe = (node: ts.Node) => {
      if (ts.isReturnStatement(node) && node.expression) {
        const pages = objectProperty(node.expression, "pages");
        const coreId = source.value(objectProperty(node.expression, "coreId"));
        if (pages && ts.isArrayLiteralExpression(unwrap(pages)) && typeof coreId === "string") {
          const pageNodes = unwrap(pages) as ts.ArrayLiteralExpression;
          for (const page of pageNodes.elements) {
            const id = source.value(objectProperty(page, "id"));
            const path = source.value(objectProperty(page, "path"));
            const title = source.value(objectProperty(page, "title"));
            if (typeof id !== "string" || typeof path !== "string" || typeof title !== "string") {
              addIssue("page_metadata", repositoryPath(root, entry.file), "Core 页面需要可解析的标识、路径和名称");
              continue;
            }
            capabilities.push({ id: `page:${coreId}:${id}`, name: title, kind: "page", owner: coreId, version: entry.version,
              sources: [{ ...sourceReference(page, root), symbol: id }], documentation: sourceDocuments(root, entry.owner),
              entry: { kind: "page", path: `/cores/${coreId}${path === "/" ? "" : path}` },
              details: { registration: "source", unresolvedMetadata: source.unresolvedProperties(page, ["component"]) } });
          }
        }
      }
      ts.forEachChild(node, describe);
    };
    describe(source.source(entry.file));
    const file = repositoryPath(root, entry.file);
    coverage.push({ source: file, count: capabilities.length - before, state: issues.some(issue => issue.path === file) ? "partial" : "indexed" });
  }

  for (const moduleDirectory of moduleDirectories) {
    const files = repositoryFiles(root, moduleDirectory, file => dirname(file) === resolve(root, moduleDirectory)
      && /(?:\.controller|\.service|\.repository|\.providers|\.ports)\.ts$/u.test(file));
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

  const apiDocumentation = new Map<string, { reference: DevelopmentSourceReference; summary?: string; operationId?: string }>();
  if (extraSources.includes(openapi)) {
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const properties = new Map(node.properties.filter(ts.isPropertyAssignment).map(property => [property.name.getText().replace(/^["']|["']$/g, ""), property.initializer]));
        if (properties.has("method") && properties.has("path")) {
          const method = source.value(properties.get("method")), path = source.value(properties.get("path"));
          if (typeof method === "string" && typeof path === "string") {
            const summary = source.value(properties.get("summary")), operationId = source.value(properties.get("operationId"));
            apiDocumentation.set(`${method.toUpperCase()} ${path}`, { reference: sourceReference(node, root),
              summary: typeof summary === "string" ? summary : undefined, operationId: typeof operationId === "string" ? operationId : undefined });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source.source(openapi));
  }
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
              const httpSummary = httpMetadata !== UNRESOLVED && httpMetadata && typeof httpMetadata === "object"
                && !Array.isArray(httpMetadata) && typeof httpMetadata.summary === "string" ? httpMetadata.summary : undefined;
              const suffixes = typeof suffix === "string" ? [suffix] : Array.isArray(suffix) && suffix.every(item => typeof item === "string") ? suffix as string[] : [];
              if (!suffixes.length) addIssue("route_path", repositoryPath(root, file), `无法静态解析 ${decorator.expression.getText()}`);
              for (const prefix of prefixes) for (const suffix of suffixes) {
                const path = "/" + ["api", prefix, suffix].filter(Boolean).join("/").replace(/\/+/gu, "/").replace(/:([A-Za-z0-9_]+)/gu, "{$1}");
                const api = apiDocumentation.get(`${method} ${path}`);
                const packageInfo = packages.find(info => repositoryPath(root, file).startsWith(info.directory + "/") && info.directory.startsWith("packages/"));
                const owner = packageInfo?.directory ?? repositoryPath(root, dirname(file));
                const id = `api:${method}:${path}`;
                const declaration = { ...sourceReference(member, root), symbol: member.name?.getText() };
                const existing = apiCapabilities.get(id);
                const assemblyReference = registeredControllers.get(node.getSourceFile().fileName + ":" + node.getStart());
                if (existing) {
                  existing.sources.push(declaration);
                  existing.details = { ...existing.details, multipleDeclarations: true };
                  if (assemblyReference) {
                    existing.sources.push(assemblyReference);
                    existing.details.registration = "declared-in-host";
                  }
                  continue;
                }
                const capability: DevelopmentCapability = { id, name: api?.summary || httpSummary || `${method} ${path}`, kind: "api", owner,
                  description: nodeDocumentation(member), sources: [declaration, ...(assemblyReference ? [assemblyReference] : [])],
                  documentation: packageInfo ? sourceDocuments(root, packageInfo.directory) : [{ path: "apps/api/src/contracts/openapi-document.ts", ...(api?.reference ?? {}) }],
                  entry: { kind: "http", method: method as "GET", path },
                  details: { controller: node.name?.text ?? "Controller", controllerMethod: member.name?.getText() ?? "",
                    registration: assemblyReference ? "declared-in-host" : "source",
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
  if (lstatSync(join(root, ".git"), { throwIfNoEntry: false })) {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  return DevelopmentCapabilityIndexSchema.parse({ schemaVersion: 1, audience: "development",
    source: { snapshot: "working-tree", revision, version: rootPackage.version },
    coverage, issues, capabilities: capabilities.sort((a, b) => a.id.localeCompare(b.id, "en")) });
}
