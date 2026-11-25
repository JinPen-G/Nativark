"use strict";
/** 首次源码构建的纯 schema 准备入口，不依赖业务 dist 或任何生成 Client。
 * 只在内存转译白名单中的原组合器；AI 材料仍经原固定摘要校验。
 * 不读环境文件，不调用 Prisma CLI/引擎，不生成 Client、迁移账或部署收据。
 * node scripts/prepare-selected-prisma-schema.cjs --mode platform|rental|rental-ai
 *   --output <对应宿主根下尚不存在的直接子目录绝对路径> [--deps <node_modules>]
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const sources = new Set([
  "packages/core-contracts/src/prisma.ts",
  "packages/core-contracts/src/manifest.ts",
  "packages/core-contracts/src/version.ts",
  "packages/rental-core/src/prisma-schema.ts",
  "packages/rental-core/src/prisma-public-relations.ts",
  "packages/ai-native-data/src/data.ts",
  "packages/ai-native-data/src/artifacts.ts",
  "packages/ai-native-data/src/prisma-schema.ts",
  "packages/ai-native-data/src/prisma-relations.ts",
]);
const slash = value => value.split(path.sep).join("/");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function statIfPresent(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

/** Check every existing ancestor, including a dangling link and a junction.
 * Missing directories are only permitted when checking the future Client path. */
function plainDirectories(directory, allowMissing = false) {
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = statIfPresent(current);
    if (!stat ? !allowMissing : stat.isSymbolicLink() || !stat.isDirectory())
      throw new Error("路径必须经过普通目录，禁止链接或缺失的宿主目录");
    if (path.dirname(current) === current) break;
  }
}

function readOriginal(relative) {
  const file = path.resolve(root, relative), within = path.relative(root, file);
  if (within.startsWith(".." + path.sep) || within === ".." || path.isAbsolute(within))
    throw new Error("原材料路径越出本源码树");
  plainDirectories(path.dirname(file));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
    throw new Error("原材料须为有界的普通文件");
  return fs.readFileSync(file);
}

function schemaLoader(dependencyDirectory) {
  const deps = path.resolve(dependencyDirectory);
  const lock = JSON.parse(readOriginal("package-lock.json").toString("utf8"));
  const dependencies = new Map();
  const dependency = name => {
    if (!['typescript', 'zod'].includes(name)) throw new Error("未允许的 schema 外部依赖");
    if (dependencies.has(name)) return dependencies.get(name);
    const home = path.join(deps, name);
    const installed = JSON.parse(fs.readFileSync(path.join(home, "package.json"), "utf8"));
    const expected = lock.packages?.["node_modules/" + name]?.version;
    if (!expected || installed.version !== expected)
      throw new Error(`${name} 与本树锁定版本不一致；请先按原锁准备依赖`);
    // Absolute package resolution never falls back to a parent tree or business dist.
    const loaded = require(home);
    dependencies.set(name, loaded);
    return loaded;
  };
  const ts = dependency("typescript"), modules = new Map();
  function load(relative) {
    if (!sources.has(relative)) throw new Error(`schema 源码不在白名单：${relative}`);
    if (modules.has(relative)) return modules.get(relative).exports;
    const source = readOriginal(relative).toString("utf8");
    const emitted = ts.transpileModule(source, { fileName: relative, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        esModuleInterop: true, sourceMap: false, declaration: false } });
    if (emitted.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error))
      throw new Error(`schema 纯源码转译失败：${relative}`);
    const module = { exports: {} };
    modules.set(relative, module);
    const requireSource = name => {
      if (name === "node:crypto") return { createHash };
      if (name === "zod") return dependency(name);
      if (name === "@rental-os/core-contracts/prisma") return load("packages/core-contracts/src/prisma.ts");
      if (name === "@rental-os/core-contracts") {
        // This formal named export is owned by manifest.ts. Loading the unrelated
        // root barrel would expand a first-build schema bootstrap into HTTP/build dependencies.
        return { CoreDataContractSchema: load("packages/core-contracts/src/manifest.ts").CoreDataContractSchema };
      }
      if (name.startsWith(".")) {
        const resolved = path.resolve(root, path.dirname(relative), name + ".ts");
        return load(slash(path.relative(root, resolved)));
      }
      throw new Error(`schema 引用未允许的运行依赖：${name}`);
    };
    new Function("require", "module", "exports", "__filename", "__dirname", emitted.outputText)(
      requireSource, module, module.exports, path.resolve(root, relative), path.resolve(root, path.dirname(relative)));
    return module.exports;
  }
  return load;
}

function compose(mode, dependencyDirectory) {
  const publicSchema = readOriginal("apps/platform-api/prisma/schema.prisma").toString("utf8");
  if (mode === "platform") return publicSchema;
  const load = schemaLoader(dependencyDirectory);
  const rental = readOriginal("packages/rental-core/prisma/schema.prisma").toString("utf8");
  const base = load("packages/rental-core/src/prisma-schema.ts").composeRentalPrismaSchema(publicSchema, rental);
  if (mode === "rental") return base;
  const data = load("packages/ai-native-data/src/data.ts");
  const files = new Map(data.AI_NATIVE_DATA_FILES.map(item => {
    if (!item.file.startsWith("prisma/") || item.file.split("/").some(part => !part || part === "." || part === "..")
      || /[\\:\u0000]/u.test(item.file)) throw new Error("AI 数据材料路径不合法");
    return [item.file, readOriginal("packages/ai-native-data/" + item.file)];
  }));
  const contribution = data.createAiNativeDataContribution(files);
  return load("packages/ai-native-data/src/prisma-schema.ts").composeAiNativePrismaSchema(base, contribution);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
}

function prepareSelectedPrismaSchema({ mode, output, dependencies = path.join(root, "node_modules") }) {
  if (!["platform", "rental", "rental-ai"].includes(mode)) throw new Error("须明确选择 platform、rental 或 rental-ai");
  if (typeof output !== "string" || !path.isAbsolute(output)) throw new Error("--output 须为绝对路径");
  const host = path.resolve(root, "apps", mode === "platform" ? "platform-api" : "rental-api");
  const target = path.resolve(output), name = path.basename(target);
  // Keeping the original ../generated/client bytes fixes both schema determinism
  // and the consuming host's Client location, irrespective of the chosen leaf name.
  if (path.dirname(target) !== host || /[<>:"|?*\u0000-\u001f]/u.test(name) || /[. ]$/u.test(name))
    throw new Error("--output 须为对应宿主根下的新直接子目录");
  plainDirectories(host);
  const clientOutput = path.resolve(host, "generated/client");
  plainDirectories(clientOutput, true);
  if (statIfPresent(target)) throw new Error("目标目录已存在；不覆盖当前 schema 或用户内容");
  const schema = compose(mode, dependencies);
  const generators = [...schema.matchAll(/^generator\s+\w+\s*\{([\s\S]*?)^\}/gm)];
  if (generators.length !== 1) throw new Error("所选 schema 须有唯一客户端生成器");
  const body = generators[0][1].replace(/^\s*\/\/.*$/gm, "");
  if ([...body.matchAll(/^\s*provider\s*=/gm)].length !== 1
    || !/^\s*provider\s*=\s*"prisma-client-js"\s*$/m.test(body)
    || [...body.matchAll(/^\s*output\s*=/gm)].length !== 1
    || !/^\s*output\s*=\s*"\.\.\/generated\/client"\s*$/m.test(body)
    || path.resolve(target, "../generated/client") !== clientOutput)
    throw new Error("生成器须保持原 prisma-client-js 及本宿主 ../generated/client");
  const bytes = Buffer.from(schema), destination = path.join(target, "schema.prisma");
  let directoryIdentity, fileIdentity, descriptor, completed = false;
  try {
    plainDirectories(host);
    plainDirectories(clientOutput, true);
    fs.mkdirSync(target);
    directoryIdentity = fs.lstatSync(target);
    if (directoryIdentity.isSymbolicLink() || !directoryIdentity.isDirectory())
      throw new Error("本次 schema 输出须为普通目录");
    descriptor = fs.openSync(destination, "wx");
    fileIdentity = fs.fstatSync(descriptor);
    fs.writeFileSync(descriptor, bytes);
    fs.closeSync(descriptor); descriptor = undefined;
    plainDirectories(target);
    if (!sameFile(directoryIdentity, fs.lstatSync(target)) || !sameFile(fileIdentity, fs.lstatSync(destination)))
      throw new Error("本次 schema 输出身份发生变化");
    completed = true;
    return { status: "schema-prepared", deployment: "not-evaluated", mode,
      directory: target, schema: destination, schemaSha256: sha256(bytes), clientOutput, clientGenerated: false };
  } finally {
    try { if (descriptor !== undefined) fs.closeSync(descriptor); }
    finally {
      if (directoryIdentity && !completed) {
        plainDirectories(target);
        if (!sameFile(directoryIdentity, fs.lstatSync(target))) throw new Error("候选目录身份变化，停止清理");
        const current = statIfPresent(destination);
        if (current) {
          if (!fileIdentity || current.isSymbolicLink() || !sameFile(fileIdentity, current))
            throw new Error("候选文件身份变化，停止清理");
          fs.unlinkSync(destination);
        }
        // Non-recursive: never remove another writer's newly added files.
        fs.rmdirSync(target);
      }
    }
  }
}

function main(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index], value = args[index + 1];
    if (!["--mode", "--output", "--deps"].includes(option) || values.has(option) || !value || value.startsWith("--"))
      throw new Error("用法：--mode platform|rental|rental-ai --output <新目录绝对路径> [--deps <node_modules>]");
    values.set(option, value);
  }
  return prepareSelectedPrismaSchema({ mode: values.get("--mode"), output: values.get("--output"),
    dependencies: values.get("--deps") });
}

module.exports = { prepareSelectedPrismaSchema, main };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : "schema 准备失败") + "\n"); process.exitCode = 1; }
}
