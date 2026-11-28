/**
 * Node 开发工具：在固定公开底座的 packages 下生成 Core 与包内宿主材料，不安装依赖或改公共宿主。
 * 复用正式清单、HTTP、页面及打包合同；生成和静态检查均不授予业务使用权。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { CoreIdSchema, CorePackagePathSchema, CoreSourceSchema } from "./manifest";
import { ordinaryPackageDirectory } from "./package-directory";
import { buildRepositoryCapabilityIndex } from "./repository-index";
import { CORE_GUIDE_SOURCE_FILE } from "./guide";
import { CoreReleaseVersionSchema, isCoreVersionSupported } from "./version";

const packageNameSchema = z.string().max(214).regex(/^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*$(?![\s\S])/)
  .refine(value => !["node_modules", "favicon.ico"].includes(value));
export const CoreScaffoldOptionsSchema = z.object({
  workspace: z.string().min(1),
  target: CorePackagePathSchema.refine(value => /^packages\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value), "目标使用 packages/<小写字母数字连字符新目录>"),
  coreId: CoreIdSchema,
  packageName: packageNameSchema,
  platformSource: CoreSourceSchema.refine(value => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository), "底座来源使用固定公开 GitHub 仓库地址")
}).strict();
export type CoreScaffoldOptions = z.infer<typeof CoreScaffoldOptionsSchema>;

export class CoreScaffoldError extends Error {
  constructor(readonly code: string, readonly file: string, readonly field: string, message: string) {
    super(`${file}:${field} [${code}] ${message}`);
    this.name = "CoreScaffoldError";
  }
}
const fail = (code: string, file: string, field: string, message: string): never => {
  throw new CoreScaffoldError(code, file, field, message);
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const git = (workspace: string, args: string[]) => execFileSync("git", ["--no-replace-objects", "--no-lazy-fetch", ...args],
  { cwd: workspace, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** 只读普通、限定大小的产品资料；不扫描环境文件、依赖目录或私有资料。 */
function readFile(file: string): Buffer {
  ordinaryPackageDirectory(dirname(file));
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024)
    return fail("file_invalid", file, "", "需要不经过链接、至多 4 MiB 的普通文件");
  return readFileSync(file);
}
function readJson(file: string): unknown {
  try { return JSON.parse(readFile(file).toString("utf8")); }
  catch (error) {
    if (error instanceof CoreScaffoldError) throw error;
    return fail("json_invalid", file, "", "资料不存在或不是可读 JSON，请核对原文件");
  }
}

function platformMaterials(workspace: string, source: CoreScaffoldOptions["platformSource"]) {
  const receiptFile = join(workspace, "platform.source.json");
  let readPinned: (file: string) => Buffer;
  if (lstatSync(receiptFile, { throwIfNoEntry: false })) {
    const receipt = z.object({ format: z.literal("nativark-platform-source-1"), source: CoreSourceSchema,
      files: z.array(z.object({ path: CorePackagePathSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
    }).passthrough().parse(readJson(receiptFile));
    if (receipt.source.repository !== source.repository || receipt.source.commit !== source.commit)
      return fail("source_mismatch", receiptFile, "source", "所选底座来源与公开归档回执不一致");
    const hashes = new Map(receipt.files.map(file => [file.path, file.sha256]));
    if (hashes.size !== receipt.files.length) return fail("source_invalid", receiptFile, "files", "来源回执含重复路径");
    readPinned = file => {
      const bytes = readFile(join(workspace, file));
      if (!hashes.has(file) || hash(bytes) !== hashes.get(file))
        return fail("source_changed", file, "sha256", "资料与固定公开归档不同，请使用同一固定底座");
      return bytes;
    };
    // 开发工具也属于固定合同来源；不把改过的源码目录当作原发行。
    for (const file of hashes.keys()) if (file.startsWith("packages/core-contracts/")) readPinned(file);
  } else {
    try {
      if (ordinaryPackageDirectory(git(workspace, ["rev-parse", "--show-toplevel"]).trim()) !== workspace
        || git(workspace, ["rev-parse", "HEAD"]).trim() !== source.commit)
        return fail("source_mismatch", workspace, "platformSource.commit", "工作区须位于所选完整 Git 提交；先准备固定底座");
      git(workspace, ["diff", "--quiet", source.commit, "--", "packages/core-contracts", "package-lock.json", "tsconfig.base.json"]);
      if (git(workspace, ["ls-files", "--others", "--exclude-standard", "--", "packages/core-contracts"]).trim())
        return fail("source_changed", "packages/core-contracts", "", "接入合同有未提交文件，请先固定源码版本");
      readPinned = file => Buffer.from(git(workspace, ["show", `${source.commit}:${file}`]));
    } catch (error) {
      if (error instanceof CoreScaffoldError) throw error;
      return fail("source_changed", workspace, "platformSource", "无法核定固定 Git 底座或合同/锁文件有改动；请先固定源码版本");
    }
  }
  const platform = z.object({ version: CoreReleaseVersionSchema }).passthrough().parse(JSON.parse(readPinned("package.json").toString("utf8")));
  if (!isCoreVersionSupported(platform.version, { minInclusive: "0.2.2", maxExclusive: "0.3.0" }))
    return fail("platform_version", "package.json", "version", "当前模板支持底座 >=0.2.2 <0.3.0，请选择兼容的固定来源");
  const lock = z.object({ lockfileVersion: z.literal(3), packages: z.record(z.object({ version: z.string().optional() }).passthrough()) })
    .passthrough().parse(JSON.parse(readPinned("package-lock.json").toString("utf8")));
  const dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {};
  for (const name of ["core-contracts", "core-host", "platform-contracts", "platform-core-host", "platform-server", "platform-admin", "platform-api"]) {
    const directory = `${name === "platform-api" ? "apps" : "packages"}/${name}`;
    const metadata = z.object({ name: z.literal(`@rental-os/${name}`), version: CoreReleaseVersionSchema }).passthrough()
      .parse(JSON.parse(readPinned(`${directory}/package.json`).toString("utf8")));
    if (lock.packages[directory]?.version !== metadata.version)
      return fail("dependency_mismatch", "package-lock.json", directory, "公共包与固定根锁不同，请使用同一底座材料");
    dependencies[metadata.name] = metadata.version;
  }
  // 直接依赖全部取同一根锁的实际解析版本，不把上游范围写成浮动模板依赖。
  const pin = (names: readonly string[]) => Object.fromEntries(names.map(name => {
    const version = lock.packages[`node_modules/${name}`]?.version;
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return fail("dependency_unpinned", "package-lock.json", name, "缺少可复用的固定直接依赖版本");
    return [name, version];
  }));
  Object.assign(dependencies, pin(["zod", "@prisma/client", "@nestjs/common", "@nestjs/core", "@nestjs/config", "@nestjs/platform-express",
    "class-validator", "class-transformer", "reflect-metadata", "rxjs", "react", "react-dom", "react-router-dom", "@tanstack/react-query", "motion"]));
  Object.assign(devDependencies, pin(["@types/node", "@types/react", "@types/react-dom", "typescript", "vite", "@vitejs/plugin-react", "tailwindcss", "@tailwindcss/vite"]));
  const guide = readPinned(CORE_GUIDE_SOURCE_FILE);
  // 公开 Markdown 的检出换行可随系统变化；迁移/源码回执仍核原字节。
  return { dependencies, devDependencies, guideSha256: hash(Buffer.from(guide.toString("utf8").replace(/\r\n/g, "\n"))) };
}

function checkConflicts(workspace: string, target: string, coreId: string, packageName: string, inspectSource = false) {
  const directory = join(workspace, target), stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(directory).length))
    return fail("target_not_empty", target, "", "目标须不存在或为空的普通目录；请选择新目录，不覆盖已有文件");
  const rootPackage = z.object({ name: z.string() }).passthrough().parse(readJson(join(workspace, "package.json")));
  if (rootPackage.name.toLowerCase() === packageName)
    return fail("package_conflict", "package.json", "name", "npm 包名与工作区根包冲突，请选择独立包名");
  // 尚未加入根 workspaces 的上一次生成也占用身份；不依赖作者先修改共享根文件。
  for (const top of ["packages", "apps"]) {
    const parent = join(workspace, top);
    if (!lstatSync(parent, { throwIfNoEntry: false })) continue;
    ordinaryPackageDirectory(parent);
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) return fail("linked_path", `${top}/${entry.name}`, "", "开发目录包含链接，先核定真实路径");
      if (!entry.isDirectory()) continue;
      const prefix = `${top}/${entry.name}`, packageFile = join(workspace, prefix, "package.json");
      if (prefix.toLowerCase() === target && prefix !== target)
        return fail("target_collision", prefix, "", "已有目录与目标仅大小写不同，请选择跨平台唯一目录");
      if (lstatSync(packageFile, { throwIfNoEntry: false })) {
        const pkg = z.object({ name: z.string() }).passthrough().parse(readJson(packageFile));
        if (pkg.name.toLowerCase() === packageName) return fail("package_conflict", `${prefix}/package.json`, "name", "npm 包名已存在，请选择独立包名");
      }
      for (const name of ["core.scaffold.json", "core.manifest.json"]) {
        const file = join(workspace, prefix, name);
        if (!lstatSync(file, { throwIfNoEntry: false })) continue;
        const identity = z.object({ id: CoreIdSchema }).passthrough().parse(readJson(file));
        if (identity.id === coreId) return fail("core_conflict", `${prefix}/${name}`, "id", "Core ID 及其接口、权限、迁移命名空间已占用");
      }
    }
  }
  if (!inspectSource) return;
  const index = buildRepositoryCapabilityIndex(workspace);
  const workspaceIssue = index.issues.find(issue => issue.code === "workspace_pattern");
  if (workspaceIssue) return fail("workspace_unsupported", workspaceIssue.path, "workspaces", "能力目录不能读取当前 workspace 模式，请使用显式目录或一层通配");
  const unresolved = index.issues.find(issue => issue.code === "core_metadata"
    && !index.capabilities.some(entry => entry.id.startsWith("core:") && entry.sources.some(source => source.path === issue.path)));
  if (unresolved) return fail("identity_unresolved", unresolved.path, "id", "已有 Core 身份无法静态核定，请先明确其稳定 ID 再生成");
  if (index.capabilities.some(entry => entry.id === `core:${coreId}`))
    return fail("core_conflict", "package.json", "workspaces", "正式源码能力目录已登记该 Core ID，请选择新标识");
  if (index.capabilities.some(entry => entry.kind === "module" && entry.name.toLowerCase() === packageName))
    return fail("package_conflict", "package.json", "workspaces", "正式 workspace 中已有同名 npm 包");
}

/** 模板资源来自本工具包，替换值只允许已经校验的标识及固定来源；不执行模板代码。 */
function templateFiles(values: Readonly<Record<string, string>>): Map<string, Buffer> {
  const root = ordinaryPackageDirectory(resolve(__dirname, "../templates/minimal"));
  const files = new Map<string, Buffer>();
  const visit = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Core 模板资源不能经过链接");
      const path = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else {
        if (!entry.isFile() || !path.endsWith(".tpl")) throw new Error("Core 模板只接受普通 .tpl 文件");
        const output = CorePackagePathSchema.parse(path.slice(0, -4));
        const text = readFile(join(directory, entry.name)).toString("utf8").replace(/\{\{([A-Z_]+)\}\}/g, (_match, key: string) => {
          if (!Object.hasOwn(values, key)) throw new Error(`Core 模板缺少变量 ${key}`);
          return values[key];
        }).replace(/\r\n/g, "\n");
        files.set(output, Buffer.from(text));
      }
    }
  };
  visit(root, "");
  return files;
}

export function createCoreProject(input: CoreScaffoldOptions) {
  const parsed = CoreScaffoldOptionsSchema.safeParse(input);
  if (!parsed.success) return fail("input_invalid", "create", parsed.error.issues[0].path.join("."), parsed.error.issues[0].message);
  const { coreId, packageName, target, platformSource } = parsed.data;
  const workspace = ordinaryPackageDirectory(parsed.data.workspace);
  const parent = ordinaryPackageDirectory(join(workspace, "packages"));
  const tablePrefix = `core_${coreId.replace(/-/g, "_")}`;
  const namespaces = { api: `/api/cores/${coreId}`, permission: `${coreId}:item:read`,
    schema: `${coreId}.`, migration: `core.${coreId}.items.initial`, table: `${tablePrefix}_items` };
  if (`${tablePrefix}_operation_item`.length > 64)
    return fail("namespace_invalid", "create", "coreId", "派生 MySQL 表/约束名超过 64 字符，请缩短 Core ID（最多 44 字符）");
  checkConflicts(workspace, target, coreId, packageName);
  const materials = platformMaterials(workspace, platformSource);
  const files = templateFiles({ CORE_ID: coreId, PACKAGE_NAME: packageName, TABLE: namespaces.table, TABLE_PREFIX: tablePrefix,
    PLATFORM_URL: `${platformSource.repository.replace(/\.git$/, "")}/blob/${platformSource.commit}`,
    PLATFORM_SHA: platformSource.commit, TARGET: target,
    DEPENDENCIES: json(materials.dependencies).trim(), DEV_DEPENDENCIES: json(materials.devDependencies).trim() });
  const migration = files.get("migrations/001-items.sql");
  if (!migration) throw new Error("Core 模板缺少原迁移");
  const manifestFile = files.get("src/manifest.ts");
  if (!manifestFile) throw new Error("Core 模板缺少清单工厂");
  files.set("src/manifest.ts", Buffer.from(manifestFile.toString("utf8").replace("MIGRATION_SHA256", hash(migration))));
  files.set("core.scaffold.json", Buffer.from(json({ format: "zelo-core-scaffold-1", id: coreId, packageName,
    platform: { source: platformSource, ...materials }, namespaces })));

  // 跨目标目录的同名生成共用一次独占锁；崩溃残锁须作者核对，不能自动抢占。
  const lock = join(parent, ".core-scaffold.lock"), directory = join(workspace, target);
  let lockFd: number;
  try { lockFd = openSync(lock, "wx"); }
  catch { return fail("workspace_busy", "packages/.core-scaffold.lock", "", "已有生成操作或不可写；等待原操作结束，残锁须核明后处理"); }
  const written: string[] = [], directories: string[] = [];
  try {
    checkConflicts(workspace, target, coreId, packageName, true);
    if (!lstatSync(directory, { throwIfNoEntry: false })) { mkdirSync(directory); directories.push(directory); }
    for (const [name, bytes] of files) {
      const output = join(directory, name), ancestors: string[] = [];
      for (let path = dirname(output); path !== directory; path = dirname(path)) ancestors.unshift(path);
      for (const path of ancestors) if (!lstatSync(path, { throwIfNoEntry: false })) { mkdirSync(path); directories.push(path); }
      ordinaryPackageDirectory(dirname(output));
      const fd = openSync(output, "wx"); written.push(output);
      try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    }
    return { status: "created" as const, directory, coreId, packageName, platformSource, namespaces,
      files: [...files.keys()], next: "按生成 README 显式装配 workspace 与固定锁；构建和静态检查后再准备宿主授权与数据" };
  } catch (error) {
    // 只撤销本次独占创建的文件及空目录，不递归清理，更不删除调用方原有的空目标。
    for (const file of written.reverse()) {
      ordinaryPackageDirectory(dirname(file));
      if (relative(directory, file).startsWith("..") || lstatSync(file).isSymbolicLink()) throw new Error("生成回退路径已改变，请核对本次残留");
      unlinkSync(file);
    }
    for (const path of directories.reverse()) { ordinaryPackageDirectory(path); rmdirSync(path); }
    throw error;
  } finally { closeSync(lockFd); unlinkSync(lock); }
}
