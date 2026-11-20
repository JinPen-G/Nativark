/** 网站与企业门户的构建期固定包接点，沿正式安装校验与客户端出口读取贡献。 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { normalizePath, transformWithOxc, type Plugin } from "vite";
import type { Plugin as PostcssPlugin } from "postcss";

export function rentalClientVite(projectRoot: string, release: boolean) {
  projectRoot = resolve(projectRoot);
  const packageDirectory = process.env.RENTAL_CORE_PACKAGE;
  const lockPath = process.env.CORE_DEPLOYMENT_LOCK;
  const alias: Record<string, string> = {};
  const plugins: Plugin[] = [];
  const postcss: PostcssPlugin[] = [];
  const dedupe: string[] = [];
  let commonjsOptions: { include: Array<string | RegExp> } | undefined;
  if (!packageDirectory && !lockPath && !release) return { alias, plugins, postcss, dedupe, commonjsOptions };
  if (!packageDirectory || !lockPath)
    throw new Error("Rental 客户端发布须同时提供 RENTAL_CORE_PACKAGE 和 CORE_DEPLOYMENT_LOCK");
  const require = createRequire(import.meta.url);
  const { CoreDeploymentLockSchema, coreDeploymentHostVersions }: typeof import("@rental-os/core-contracts") = require("@rental-os/core-contracts");
  const { requireCorePackagePin }: typeof import("@rental-os/core-contracts/install") = require("@rental-os/core-contracts/install");
  const { corePackageFiles }: typeof import("@rental-os/core-contracts/package") = require("@rental-os/core-contracts/package");
  const { rentalHostLegacyApiRoutes }: typeof import("@rental-os/rental-api/openapi") = require("@rental-os/rental-api/openapi");

  const inside = (root: string, file: string) => {
    const target = relative(root, file);
    return target !== ".." && !target.startsWith("../") && !target.startsWith("..\\") && !isAbsolute(target);
  };
  const ordinaryPath = (file: string) => {
    if (!inside(projectRoot, file) || relative(file, realpathSync(file)) !== "" || lstatSync(file).isSymbolicLink())
      throw new Error("Rental 客户端构建路径须为本工作树内的普通路径");
  };
  const packageRoot = resolve(projectRoot, packageDirectory);
  const lockFile = resolve(projectRoot, lockPath);
  ordinaryPath(packageRoot);
  ordinaryPath(lockFile);
  const authorRoot = resolve(projectRoot, "packages/rental-core");
  if (inside(authorRoot, packageRoot)) throw new Error("Rental 发布须选择已安装标准包");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(lockFile, "utf8")));
  const pin = lock.cores.find(core => core.manifest.id === "rental");
  if (!pin) throw new Error("客户端部署锁未选择 Rental Core");
  const host = { ...coreDeploymentHostVersions(lock), node: process.versions.node };
  const legacyApiRoutes = rentalHostLegacyApiRoutes();
  const selected = requireCorePackagePin(packageRoot, pin, host, legacyApiRoutes);
  const files = new Set(corePackageFiles(selected.manifest));
  const member = (file: string) => {
    ordinaryPath(file);
    if (!files.has(normalizePath(relative(selected.root, file))) || !lstatSync(file).isFile())
      throw new Error("Rental 客户端读取的文件未在锁定清单中");
  };
  const metadataFile = resolve(selected.root, "package.json");
  member(metadataFile);
  const metadata = JSON.parse(readFileSync(metadataFile, "utf8"));
  if (metadata.name !== "@rental-os/rental-core" || metadata.version !== selected.manifest.version)
    throw new Error("Rental 安装包标识或版本与部署锁不符");
  dedupe.push(...Object.keys(metadata.peerDependencies ?? {}));
  const declared = (source: string) => {
    const key = source === "@rental-os/rental-core" ? "." : "./" + source.slice("@rental-os/rental-core/".length);
    const entry = metadata.exports?.[key];
    const target = typeof entry === "string" ? entry : entry?.import ?? entry?.require ?? entry?.default;
    if (typeof target !== "string" || !target.startsWith("./"))
      throw new Error("Rental 客户端请求了未声明的正式出口");
    const file = resolve(selected.root, target);
    member(file);
    return normalizePath(file);
  };
  // CSS @import uses Vite's stylesheet resolver, so its package exports also
  // need explicit aliases to the same checked files.
  for (const name of ["website-ui", "enterprise-portal"])
    alias["@rental-os/rental-core/clients/" + name + "/styles"] = declared("@rental-os/rental-core/clients/" + name + "/styles");
  // CommonJS named imports can survive bundling even when the requested value
  // is absent. Check the actual public client symbols before producing output.
  const ts: typeof import("typescript") = require("typescript");
  const requiredExports = new Map([
    ["@rental-os/rental-core/clients/website-ui", ["RentalWebsite", "configureRentalWebsiteHost"]],
    ["@rental-os/rental-core/clients/website-ui/host", ["configureRentalWebsiteHost"]],
    ["@rental-os/rental-core/clients/website", ["createRentalWebsitePublicClient"]],
    ["@rental-os/rental-core/clients/enterprise-portal", ["RentalEnterprisePortal"]],
    ["@rental-os/rental-core/clients/enterprise", ["EnterpriseSessionProvider", "useEnterprise"]],
  ]);
  const clientEntries = [...requiredExports].map(([source, names]) => ({ file: declared(source), names }));
  const options = { allowJs: true, noEmit: true, noLib: true, types: [],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX };
  const sourceHost = ts.createCompilerHost(options);
  sourceHost.fileExists = file => inside(selected.root, resolve(file)) && ts.sys.fileExists(file);
  sourceHost.readFile = file => {
    if (!inside(selected.root, resolve(file))) return;
    member(resolve(file));
    return readFileSync(file, "utf8");
  };
  sourceHost.resolveModuleNames = (names, importer) => names.map(name => name.startsWith(".")
    ? ts.resolveModuleName(name, importer, options, sourceHost).resolvedModule : undefined);
  const program = ts.createProgram(clientEntries.map(entry => entry.file), options, sourceHost);
  const checker = program.getTypeChecker();
  for (const { file, names } of clientEntries) {
    const source = program.getSourceFile(file);
    const symbol = source && checker.getSymbolAtLocation(source);
    const exports = symbol ? checker.getExportsOfModule(symbol) : [];
    for (const name of names) {
      const value = exports.find(candidate => candidate.name === name);
      const typeOnly = value?.declarations?.some(declaration => ts.isExportSpecifier(declaration)
        && (declaration.isTypeOnly || (ts.isExportDeclaration(declaration.parent.parent) && declaration.parent.parent.isTypeOnly)));
      const target = value && (value.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(value) : value);
      if (!target?.declarations?.length || typeOnly || !(target.flags & ts.SymbolFlags.Value)
        || target.declarations.every(declaration => declaration.getSourceFile().isDeclarationFile))
        throw new Error("Rental 客户端缺少正式运行值出口 " + name);
    }
  }
  for (const name of ["shared", "web-client"]) {
    const root = resolve(projectRoot, "packages", name);
    const definition = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const entry = definition.exports?.["."];
    const target = typeof entry === "string" ? entry : entry?.import ?? entry?.require ?? entry?.default;
    if (definition.name !== "@rental-os/" + name || typeof target !== "string" || !target.startsWith("./"))
      throw new Error("公共客户端缺少正式运行出口");
    alias[definition.name] = normalizePath(resolve(root, target));
  }
  commonjsOptions = { include: [/node_modules/, normalizePath(resolve(selected.root, "dist")) + "/**",
    normalizePath(dirname(alias["@rental-os/shared"])) + "/**"] };
  const clientRoots = [resolve(selected.root, "clients"), resolve(selected.root, "admin")];
  const contractRoot = resolve(selected.root, "src");
  let compiler: Parameters<typeof transformWithOxc>[2];
  const virtual = "\0rental-client-contribution:";
  const sourceFiles = new Map<string, string>();
  const contribution = (file: string) => {
    if (!/\.tsx?$/.test(file)) return file;
    if (inside(contractRoot, file)) {
      // Field contributions and Shared use the same compiled contract module,
      // including its error classes and original pure-function identities.
      member(file);
      const compiled = resolve(selected.root, "dist", relative(contractRoot, file)).replace(/\.tsx?$/, ".js");
      member(compiled);
      return normalizePath(compiled);
    }
    if (!clientRoots.some(root => inside(root, file))) return file;
    member(file);
    const id = virtual + normalizePath(relative(selected.root, file)) + ".js";
    sourceFiles.set(id, file);
    return id;
  };
  postcss.push({
    postcssPlugin: "selected-rental-stylesheet-members",
    OnceExit(_root, { result }) {
      for (const message of result.messages) {
        if (message.type === "dependency" && typeof message.file === "string") {
          const file = resolve(message.file);
          if (inside(selected.root, file)) member(file);
        }
      }
    },
  });
  plugins.push({
    name: "selected-rental-client-package",
    enforce: "pre",
    configResolved(config) {
      const { compilerOptions } = JSON.parse(readFileSync(resolve(config.root, "tsconfig.json"), "utf8"));
      compiler = { tsconfig: { compilerOptions }, sourcemap: Boolean(config.build.sourcemap),
        target: compilerOptions.target.toLowerCase(),
        jsx: { runtime: "automatic", importSource: compilerOptions.jsxImportSource ?? "react",
          development: !config.isProduction } };
    },
    resolveId(source, importer) {
      if (source === "@rental-os/rental-core" || source.startsWith("@rental-os/rental-core/")) return contribution(declared(source));
      const file = importer && (sourceFiles.get(importer)
        ?? (!importer.startsWith("\0") && inside(selected.root, resolve(importer.split("?")[0])) ? importer : undefined));
      if (file) return this.resolve(source, file, { skipSelf: true }).then(resolved => {
        if (!resolved) return;
        if (source.startsWith(".")) member(resolve(resolved.id.split("?")[0]));
        return { ...resolved, id: contribution(resolved.id) };
      });
    },
    load(id) {
      const source = sourceFiles.get(id);
      if (source) {
        member(source);
        this.addWatchFile(source);
        // A JS virtual module keeps Vite's later transformer from rediscovering
        // the publisher's workspace-only tsconfig outside the installed package.
        return transformWithOxc(readFileSync(source, "utf8"), source, compiler);
      }
      if (id.startsWith("\0")) return;
      const file = resolve(id.split("?")[0]);
      if (inside(authorRoot, file)) throw new Error("Rental 发布读取了作者 Core 源码");
      if (inside(selected.root, file)) member(file);
    },
    generateBundle() {
      requireCorePackagePin(selected.root, pin, host, legacyApiRoutes);
    },
  });
  return { alias, plugins, postcss, dedupe, commonjsOptions };
}
