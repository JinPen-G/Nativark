/**
 * 将已校验Core包准备到独占部署目录；不修改活动组合，不加载代码或迁移数据库。
 * 以摘要定目录并用原文件字节核对重复请求；失败只清理本次创建的暂存目录。
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CORE_ARCHIVE_LIMITS, createCoreArchive, readCoreArchive } from "./archive";
import type { CoreHostVersions } from "./compatibility";
import type { CoreManifest } from "./manifest";
import { corePackageFiles, inspectCorePackageFiles, readCorePackageFiles } from "./package";

const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const inside = (root: string, target: string) => {
  const part = relative(root, target);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

/** 独占根不能经过链接；调用方选择的位置不由清单或远端包决定。 */
function ordinaryDirectory(directory: string): string {
  const absolute = resolve(directory);
  let current = absolute;
  while (true) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("部署目录须为不经过链接的普通目录");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return realpathSync(absolute);
}

/** 返回完整标准包字节；调用方可写入一个明确的新文件，失败不留下半包。 */
export function packCoreDirectory(directory: string, host?: CoreHostVersions) {
  ordinaryDirectory(directory);
  const files = readCorePackageFiles(directory, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const inspected = inspectCorePackageFiles(files, host);
  if (!inspected.ok) throw new Error(inspected.issues.map(issue => `${issue.file}:${issue.field ?? ""} [${issue.code}] ${issue.message}`).join("\n"));
  return { ...createCoreArchive(files), manifest: inspected.manifest! };
}

function assertExisting(directory: string, files: ReadonlyMap<string, Uint8Array>) {
  ordinaryDirectory(directory);
  const found = new Set<string>();
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("待部署目录已出现链接，停止覆盖");
      if (entry.isDirectory()) {
        const prefix = relative(directory, target).split(/[\\/]/).join("/") + "/";
        if (![...files.keys()].some(file => file.startsWith(prefix))) throw new Error("待部署目录存在额外目录，停止覆盖");
        visit(target);
      }
      else if (entry.isFile()) {
        const name = relative(directory, target).split(/[\\/]/).join("/");
        const expected = files.get(name);
        if (!expected || lstatSync(target).size !== expected.length || digest(readFileSync(target)) !== digest(expected))
          throw new Error("同一摘要待部署目录存在用户改动，停止覆盖");
        found.add(name);
      } else throw new Error("待部署目录含非普通文件");
    }
  };
  visit(directory);
  if (found.size !== files.size) throw new Error("待部署目录不完整，停止覆盖");
}

export function prepareCoreInstall(bytes: Uint8Array, sha256: string, directory: string, host: CoreHostVersions,
  expected?: Pick<CoreManifest, "id" | "version" | "source">): {
  status: "prepared" | "already_prepared";
  deployment: "pending";
  coreId: string;
  version: string;
  sha256: string;
  directory: string;
} {
  const archive = readCoreArchive(bytes, sha256);
  const inspected = inspectCorePackageFiles(archive.files, host);
  if (!inspected.ok) throw new Error(inspected.issues.map(issue => `${issue.file}:${issue.field ?? ""} [${issue.code}] ${issue.message}`).join("\n"));
  const manifest = inspected.manifest!;
  if (expected && (manifest.id !== expected.id || manifest.version !== expected.version
    || manifest.source.repository !== expected.source.repository || manifest.source.commit !== expected.source.commit))
    throw new Error("Core包ID、版本或来源与选定发行不一致");
  const declared = new Set(corePackageFiles(manifest));
  if ([...archive.files.keys()].some(file => !declared.has(file))) throw new Error("Core包含清单未声明的额外文件");
  const root = ordinaryDirectory(directory);
  const target = join(root, `${manifest.id}-${manifest.version}-${sha256}`);
  if (dirname(target) !== root) throw new Error("待部署目标不属于指定根目录");
  const result = { deployment: "pending" as const, coreId: manifest.id, version: manifest.version, sha256, directory: target };
  if (existsSync(target)) { assertExisting(target, archive.files); return { ...result, status: "already_prepared" }; }

  const temporary = mkdtempSync(join(root, ".core-prepare-"));
  let moved = false;
  try {
    for (const [file, content] of archive.files) {
      const output = resolve(temporary, file);
      if (!inside(temporary, output)) throw new Error("包文件越出待部署目录");
      mkdirSync(dirname(output), { recursive: true });
      ordinaryDirectory(dirname(output));
      writeFileSync(output, content, { flag: "wx" });
    }
    // 仅在完整包已写成后发布候选；并发同包的另一准备者可由字节核对复用。
    try { renameSync(temporary, target); moved = true; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(code ?? "") || !existsSync(target)) throw error;
      assertExisting(target, archive.files);
      return { ...result, status: "already_prepared" };
    }
    return { ...result, status: "prepared" };
  } finally {
    if (!moved) {
      const current = ordinaryDirectory(temporary);
      if (!inside(root, current) || current === root) throw new Error("暂存清理路径不属于本次部署准备");
      rmSync(current, { recursive: true });
    }
  }
}
