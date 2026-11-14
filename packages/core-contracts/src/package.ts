/**
 * Node 专用的解包目录检查：只读取清单、文件元信息及迁移摘要，不 import/require Core。
 * 解压、下载、装配、迁移和租户授权是后续动作；通过检查不表示包内代码可信。
 */
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CORE_MANIFEST_FILE, CoreManifestSchema, type CoreManifest } from "./manifest";
import { checkCoreCombination, CoreHostVersionsSchema, type CoreHostVersions } from "./compatibility";
import { CoreOpenApiContributionSchema, checkCoreOpenApi } from "./openapi";

export interface CorePackageIssue {
  code: string;
  file: string;
  field?: string;
  message: string;
}
export interface CorePackageInspection {
  ok: boolean;
  scope: "package-static";
  compatibilityChecked: boolean;
  manifest?: CoreManifest;
  issues: CorePackageIssue[];
}

interface PackageReader {
  check(file: string, maxBytes?: number): boolean;
  read(file: string): Uint8Array;
}

/** 只打包清单明确声明的文件；不扫描整个目录、依赖或私有环境。 */
export function corePackageFiles(manifest: CoreManifest): string[] {
  return [...new Set([CORE_MANIFEST_FILE, "README.md", "LICENSE", "CORE_GUIDE.md",
    ...Object.values(manifest.entries), ...(manifest.assets ?? []), ...manifest.data.migrations.map(m => m.file)])];
}

function directoryReader(directory: string, issues: CorePackageIssue[]): PackageReader {
  const root = resolve(directory);
  const add = (code: string, file: string, message: string) => { issues.push({ code, file, message }); return false; };
  const check = (file: string, maxBytes?: number): boolean => {
    const target = resolve(root, file);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel))
      return add("path_outside", file, "文件必须位于包目录内");
    try {
      let current = root;
      let stat = lstatSync(current);
      if (stat.isSymbolicLink()) return add("linked_path", file, "包目录不能是符号链接或 junction");
      // 检查每一层而不只检查最终文件，阻止目录链接/junction 绕过包边界。
      for (const part of relative(root, target).split(/[\\/]/)) {
        if (!stat.isDirectory()) return add("not_directory", file, "入口的父路径不是目录");
        current = join(current, part);
        stat = lstatSync(current);
        if (stat.isSymbolicLink()) return add("linked_path", file, "包内路径不能经过符号链接或 junction");
      }
      if (!stat.isFile()) return add("not_file", file, "声明的入口必须是普通文件");
      if (maxBytes !== undefined && stat.size > maxBytes) return add("file_too_large", file, `文件超过本次检查的 ${maxBytes} 字节上限`);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EACCES" && code !== "EPERM") throw error;
      return add("file_unavailable", file, `文件不存在或不可读（${code}）`);
    }
  };
  return { check, read: file => readFileSync(resolve(root, file)) };
}

export function inspectCorePackage(directory: string, hostInput?: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []): CorePackageInspection {
  const issues: CorePackageIssue[] = [];
  return inspectPackage(directoryReader(directory, issues), issues, hostInput, legacyApiRoutes);
}

/** 压缩包解析后复用同一清单/入口/API校验；本函数不解包或写入文件。 */
export function inspectCorePackageFiles(files: ReadonlyMap<string, Uint8Array>, hostInput?: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []): CorePackageInspection {
  const issues: CorePackageIssue[] = [];
  return inspectPackage({
    check(file, maxBytes) {
      const bytes = files.get(file);
      if (bytes === undefined) { issues.push({ code: "file_unavailable", file, message: "包内缺少声明文件" }); return false; }
      if (maxBytes !== undefined && bytes.length > maxBytes) {
        issues.push({ code: "file_too_large", file, message: `文件超过本次检查的 ${maxBytes} 字节上限` }); return false;
      }
      return true;
    },
    read: file => files.get(file)!
  }, issues, hostInput, legacyApiRoutes);
}

/** 来源目录须由调用者固定；每份声明文件读取前检查路径和上限，返回本次字节快照。 */
export function readCorePackageFiles(directory: string, maxFileBytes: number, maxTotalBytes: number): ReadonlyMap<string, Uint8Array> {
  const issues: CorePackageIssue[] = [], reader = directoryReader(directory, issues);
  const read = (file: string, maxBytes: number) => {
    if (!reader.check(file, maxBytes)) throw new Error(`${file}: ${issues.at(-1)!.message}`);
    const bytes = reader.read(file);
    if (bytes.length > maxBytes) throw new Error(`${file}: 文件读取过程中超过大小上限`);
    return bytes;
  };
  const bytes = read(CORE_MANIFEST_FILE, 256 * 1024);
  const manifest = CoreManifestSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  const files = new Map<string, Uint8Array>([[CORE_MANIFEST_FILE, bytes]]);
  let total = bytes.length;
  for (const file of corePackageFiles(manifest)) {
    if (file === CORE_MANIFEST_FILE) continue;
    if (file.split("/").some(part => /^(?:\.git|node_modules)$/i.test(part) || /^\.env(?:\.|$)/i.test(part) && part !== ".env.example"))
      throw new Error("Core包不能读取仓库元数据、依赖目录或实际环境配置");
    const content = read(file, Math.min(maxFileBytes, maxTotalBytes - total));
    total += content.length; files.set(file, content);
  }
  return files;
}

function inspectPackage(reader: PackageReader, issues: CorePackageIssue[], hostInput?: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []): CorePackageInspection {
  const result: CorePackageInspection = { ok: false, scope: "package-static", compatibilityChecked: false, issues };
  const add = (code: string, file: string, message: string, field?: string) => issues.push({ code, file, field, message });
  if (!reader.check(CORE_MANIFEST_FILE, 256 * 1024)) return result;
  let input: unknown;
  try { input = JSON.parse(Buffer.from(reader.read(CORE_MANIFEST_FILE)).toString("utf8")); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    add("invalid_json", CORE_MANIFEST_FILE, "清单不是合法 JSON"); return result;
  }
  const parsed = CoreManifestSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) add("manifest_invalid", CORE_MANIFEST_FILE, issue.message, issue.path.join("."));
    return result;
  }
  const manifest = parsed.data;
  result.manifest = manifest;
  const names = new Map<string, string>();
  const migrations = new Map(manifest.data.migrations.map(migration => [migration.file, migration]));
  for (const file of corePackageFiles(manifest)) {
    const normalized = file.toLowerCase();
    const previous = names.get(normalized);
    if (previous && previous !== file) { add("path_collision", file, `路径与 ${previous} 仅大小写不同，不能跨平台安装`); continue; }
    names.set(normalized, file);
    const migration = migrations.get(file);
    const available = reader.check(file, migration || file === manifest.entries.openapi ? 32 * 1024 * 1024 : undefined);
    if (available && migration && createHash("sha256").update(reader.read(file)).digest("hex") !== migration.sha256)
      add("checksum_mismatch", file, "迁移文件 SHA-256 与清单不同，请重新核对不可变迁移及发布包");
    if (available && file === manifest.entries.openapi) {
      try {
        const parsedApi = CoreOpenApiContributionSchema.safeParse(JSON.parse(Buffer.from(reader.read(file)).toString("utf8")));
        if (!parsedApi.success) for (const issue of parsedApi.error.issues) add("openapi_invalid", file, issue.message, issue.path.join("."));
        else for (const issue of checkCoreOpenApi(manifest, parsedApi.data, legacyApiRoutes)) add(issue.code, file, issue.message, issue.field);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        add("invalid_json", file, "OpenAPI 贡献须为 JSON 文件，不加载代码生成文档");
      }
    }
  }
  if (hostInput !== undefined) {
    const host = CoreHostVersionsSchema.safeParse(hostInput);
    if (!host.success) {
      for (const issue of host.error.issues) add("host_invalid", "host", issue.message, issue.path.join("."));
    } else {
      result.compatibilityChecked = true;
      for (const issue of checkCoreCombination([manifest], host.data).issues)
        add(issue.code, CORE_MANIFEST_FILE, issue.message, issue.field);
    }
  }
  result.ok = issues.length === 0;
  return result;
}
