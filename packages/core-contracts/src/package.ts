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

export function inspectCorePackage(directory: string, hostInput?: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []): CorePackageInspection {
  const root = resolve(directory);
  const issues: CorePackageIssue[] = [];
  const result: CorePackageInspection = {
    ok: false, scope: "package-static", compatibilityChecked: false, issues
  };
  const add = (code: string, file: string, message: string, field?: string) => issues.push({ code, file, field, message });
  const checkedFile = (file: string, maxBytes?: number): string | undefined => {
    const target = resolve(root, file);
    const rel = relative(root, target);
    if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
      add("path_outside", file, "文件必须位于包目录内"); return;
    }
    try {
      let current = root;
      let stat = lstatSync(current);
      if (stat.isSymbolicLink()) { add("linked_path", file, "包目录不能是符号链接或 junction"); return; }
      // 检查每一层而不只检查最终文件，阻止目录链接/junction 绕过包边界。
      for (const part of relative(root, target).split(/[\\/]/)) {
        if (!stat.isDirectory()) { add("not_directory", file, "入口的父路径不是目录"); return; }
        current = join(current, part);
        stat = lstatSync(current);
        if (stat.isSymbolicLink()) { add("linked_path", file, "包内路径不能经过符号链接或 junction"); return; }
      }
      if (!stat.isFile()) { add("not_file", file, "声明的入口必须是普通文件"); return; }
      if (maxBytes !== undefined && stat.size > maxBytes) { add("file_too_large", file, `文件超过本次检查的 ${maxBytes} 字节上限`); return; }
      return target;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR" && code !== "EACCES" && code !== "EPERM") throw error;
      add("file_unavailable", file, `文件不存在或不可读（${code}）`);
    }
  };
  const manifestFile = checkedFile(CORE_MANIFEST_FILE, 256 * 1024);
  if (!manifestFile) return result;
  let input: unknown;
  try { input = JSON.parse(readFileSync(manifestFile, "utf8")); }
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
  const files = new Set([CORE_MANIFEST_FILE, "README.md", "LICENSE", "CORE_GUIDE.md",
    ...Object.values(manifest.entries), ...(manifest.assets ?? []), ...manifest.data.migrations.map(m => m.file)]);
  const names = new Map<string, string>();
  const migrations = new Map(manifest.data.migrations.map(migration => [migration.file, migration]));
  for (const file of files) {
    const normalized = file.toLowerCase();
    const previous = names.get(normalized);
    if (previous && previous !== file) { add("path_collision", file, `路径与 ${previous} 仅大小写不同，不能跨平台安装`); continue; }
    names.set(normalized, file);
    const migration = migrations.get(file);
    const target = checkedFile(file, migration || file === manifest.entries.openapi ? 32 * 1024 * 1024 : undefined);
    if (target && migration && createHash("sha256").update(readFileSync(target)).digest("hex") !== migration.sha256)
      add("checksum_mismatch", file, "迁移文件 SHA-256 与清单不同，请重新核对不可变迁移及发布包");
    if (target && file === manifest.entries.openapi) {
      try {
        const parsedApi = CoreOpenApiContributionSchema.safeParse(JSON.parse(readFileSync(target, "utf8")));
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
