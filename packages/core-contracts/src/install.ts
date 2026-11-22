/**
 * 将已校验Core包准备到独占部署目录；不修改活动组合，不加载代码或迁移数据库。
 * 以摘要定目录并核对原字节，失败只清理身份/内容未变的本次文件及空目录。
 */
import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep, toNamespacedPath } from "node:path";
import { CORE_ARCHIVE_LIMITS, createCoreArchive, readCoreArchive } from "./archive";
import type { CoreHostVersions } from "./compatibility";
import type { CoreManifest } from "./manifest";
import { CorePackagePinSchema, type CoreDeploymentLock } from "./update";
import { corePackageFiles, inspectCorePackageFiles, readCorePackageFiles } from "./package";
import { ordinaryPackageDirectory as ordinaryDirectory } from "./package-directory";

const digest = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const inside = (root: string, target: string) => {
  const part = relative(root, target);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

const sameIdentity = (left: Stats, right: Stats) =>
  left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
function entryExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 读取绑定原描述符，在路径可变的边界继续核普通父目录和文件身份。 */
function readOrdinaryFile(file: string, maxBytes: number): Buffer {
  ordinaryDirectory(dirname(file));
  const identity = lstatSync(file);
  if (!identity.isFile() || identity.isSymbolicLink() || identity.size > maxBytes) throw new Error("待部署文件不可读或过大");
  const descriptor = openSync(file, "r");
  try {
    const opened = fstatSync(descriptor);
    ordinaryDirectory(dirname(file));
    const current = lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)
      || !sameIdentity(identity, opened) || current.size !== identity.size || current.mtimeMs !== identity.mtimeMs
      || opened.size !== identity.size || opened.mtimeMs !== identity.mtimeMs)
      throw new Error("待部署文件或父目录在读取前已变化");
    const bytes = readFileSync(descriptor), after = fstatSync(descriptor);
    ordinaryDirectory(dirname(file));
    const final = lstatSync(file);
    if (!final.isFile() || final.isSymbolicLink() || !sameIdentity(identity, final) || bytes.length !== opened.size
      || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error("待部署文件或父目录在读取中已变化");
    return bytes;
  } finally { closeSync(descriptor); }
}

/** 返回完整标准包字节；旧路径例外仅由实际宿主传入，省略时仍强制 Core 命名空间。 */
export function packCoreDirectory(directory: string, host?: CoreHostVersions, legacyApiRoutes: readonly string[] = []) {
  ordinaryDirectory(directory);
  const files = readCorePackageFiles(directory, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const inspected = inspectCorePackageFiles(files, host, legacyApiRoutes);
  if (!inspected.ok) throw new Error(inspected.issues.map(issue => `${issue.file}:${issue.field ?? ""} [${issue.code}] ${issue.message}`).join("\n"));
  return { ...createCoreArchive(files), manifest: inspected.manifest! };
}

/** 宿主在构建/运行前核定实际已安装标准包，不接受仅有同版本声明的不同字节。 */
export function requireCorePackagePin(directory: string, input: CoreDeploymentLock["cores"][number], host: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []) {
  const pin = CorePackagePinSchema.parse(input), root = ordinaryDirectory(directory);
  const packed = packCoreDirectory(root, host, legacyApiRoutes), manifest = packed.manifest;
  if (manifest.id !== pin.manifest.id || manifest.version !== pin.manifest.version
    || manifest.source.repository !== pin.manifest.source.repository || manifest.source.commit !== pin.manifest.source.commit)
    throw new Error("实际Core包的标识、版本或来源与部署锁不一致");
  if (packed.sha256 !== pin.sha256) throw new Error("实际Core包字节与锁定摘要不一致，先重新核对待部署组合");
  return { root, manifest };
}

function assertExisting(directory: string, files: ReadonlyMap<string, Uint8Array>) {
  ordinaryDirectory(directory);
  const found = new Set<string>();
  const visit = (current: string) => {
    ordinaryDirectory(current);
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
        if (!expected || digest(readOrdinaryFile(target, expected.length)) !== digest(expected))
          throw new Error("同一摘要待部署目录存在用户改动，停止覆盖");
        found.add(name);
      } else throw new Error("待部署目录含非普通文件");
    }
  };
  visit(directory);
  if (found.size !== files.size) throw new Error("待部署目录不完整，停止覆盖");
}

export function prepareCoreInstall(bytes: Uint8Array, sha256: string, directory: string, host: CoreHostVersions,
  expected?: Pick<CoreManifest, "id" | "version" | "source">, legacyApiRoutes: readonly string[] = []): {
  status: "prepared" | "already_prepared";
  deployment: "pending";
  coreId: string;
  version: string;
  sha256: string;
  directory: string;
} {
  const archive = readCoreArchive(bytes, sha256);
  const inspected = inspectCorePackageFiles(archive.files, host, legacyApiRoutes);
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
  if (entryExists(target)) { assertExisting(target, archive.files); return { ...result, status: "already_prepared" }; }

  // Windows mkdtemp 的长路径采用命名空间前缀，后续路径仍沿原普通根。
  const temporary = join(root, basename(mkdtempSync(toNamespacedPath(join(root, ".core-prepare-")))));
  const directories = new Map<string, Stats>([[temporary, lstatSync(temporary)]]);
  const written = new Map<string, { bytes: Uint8Array; identity: Stats }>();
  let moved = false, preparationFailure: unknown;
  function verifyDirectory(directory: string): void {
    ordinaryDirectory(directory);
    const identity = directories.get(directory);
    if (identity && !sameIdentity(lstatSync(directory), identity)) throw new Error("本次部署暂存目录身份已变化");
    if (directory !== temporary && inside(temporary, directory)) verifyDirectory(dirname(directory));
  }
  function ensureDirectory(directory: string): void {
    if (directories.has(directory)) { verifyDirectory(directory); return; }
    if (!inside(temporary, directory)) throw new Error("目录越出本次部署暂存");
    ensureDirectory(dirname(directory));
    mkdirSync(directory);
    directories.set(directory, lstatSync(directory));
    verifyDirectory(directory);
  }
  try {
    for (const [file, content] of archive.files) {
      const output = resolve(temporary, file);
      if (!inside(temporary, output)) throw new Error("包文件越出待部署目录");
      ensureDirectory(dirname(output));
      const descriptor = openSync(output, "wx");
      try {
        const identity = fstatSync(descriptor);
        verifyDirectory(dirname(output));
        const current = lstatSync(output);
        if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)
          || identity.size !== 0 || current.size !== 0 || current.mtimeMs !== identity.mtimeMs)
          throw new Error("本次部署文件或父目录在写入前已变化");
        written.set(output, { bytes: content, identity });
        writeFileSync(descriptor, content);
      } finally { closeSync(descriptor); }
    }
    // 仅在完整包已写成后发布候选；并发同包的另一准备者可由字节核对复用。
    try { renameSync(temporary, target); moved = true; }
    catch (error) {
      // 发布可能已完成却未收到结果。只读同一目标的完整原包，不重试 rename。
      if (!entryExists(target)) throw error;
      assertExisting(target, archive.files);
      return { ...result, status: "already_prepared" };
    }
    return { ...result, status: "prepared" };
  } catch (error) {
    preparationFailure = error;
    throw error;
  } finally {
    if (!moved) {
      const cleanupErrors: unknown[] = [];
      const attempt = (action: () => void) => {
        try { action(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error); }
      };
      for (const [file, { bytes, identity }] of [...written].reverse()) attempt(() => {
        verifyDirectory(dirname(file));
        const current = lstatSync(file);
        if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity) || current.size > bytes.length
          || !readOrdinaryFile(file, bytes.length).equals(bytes.subarray(0, current.size)))
          throw new Error("本次暂存文件已被接手，保留该文件");
        // 字节核对后仍可能发生同文件改写，删除前继续核定该版本。
        const final = lstatSync(file);
        if (!sameIdentity(current, final) || final.size !== current.size || final.mtimeMs !== current.mtimeMs)
          throw new Error("本次暂存文件在删除前已变化，保留该文件");
        verifyDirectory(dirname(file));
        unlinkSync(file);
      });
      for (const directory of [...directories.keys()].sort((left, right) => right.length - left.length))
        attempt(() => { verifyDirectory(directory); rmdirSync(directory); });
      if (cleanupErrors.length) throw new AggregateError(
        preparationFailure === undefined ? cleanupErrors : [preparationFailure, ...cleanupErrors],
        "部署准备保留无法确认的暂存内容，须沿原包与路径核对");
    }
  }
}
