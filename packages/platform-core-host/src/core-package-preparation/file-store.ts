/** 固定候选一次发布到独占根，Core 包写入复用原 prepareCoreInstall。
 * 同摘要已有目录逐字节核验，原回读核文件清单，失败仅清理本次尚未发布的暂存目录。 */
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { CoreArtifactHashSchema, CoreDeploymentLockSchema, coreDeploymentHostVersions } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { prepareCoreInstall } from "@rental-os/core-contracts/install";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { CoreAccessError } from "@rental-os/core-host";
import type { CorePackageLegacyApiRoutes } from "../core-package-ports";
import {
  CorePackagePreparationRecordSchema, type CorePackagePreparationBundle,
  type CorePackagePreparationRecord, type CorePackagePreparationStore
} from "./ports";

const recordFile = "preparation.json";
function entryExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
const inside = (root: string, target: string) => {
  const part = relative(root, target);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};
function ordinaryDirectory(directory: string): string {
  const absolute = resolve(directory);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("候选根与父目录须为普通目录");
    current = join(current, part);
  }
  const stat = lstatSync(current);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("候选目录须为普通目录");
  return realpathSync(absolute);
}

function readRecord(directory: string, sha256: string): CorePackagePreparationRecord {
  ordinaryDirectory(directory);
  const path = join(directory, recordFile), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error("原准备记录不可读");
  const bytes = readFileSync(path);
  if (bytes.length > 8 * 1024 * 1024) throw new Error("原准备记录超过读取上限");
  const record = CorePackagePreparationRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (record.sha256 !== sha256 || requestFingerprint(record.plan) !== sha256) throw new Error("原候选指纹与记录不同");
  const expected = new Map(record.plan.files.map(file => [file.file, file])), found = new Set<string>();
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name), name = relative(directory, file).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error("原候选路径出现链接");
      if (entry.isDirectory()) {
        if (![...expected.keys()].some(path => path.startsWith(name + "/"))) throw new Error("原候选出现额外目录");
        visit(file);
      } else if (entry.isFile()) {
        if (name === recordFile) continue;
        const metadata = expected.get(name), info = lstatSync(file);
        if (!metadata || !info.isFile() || info.isSymbolicLink() || info.size !== metadata.sizeBytes || info.size > CORE_ARCHIVE_LIMITS.fileBytes)
          throw new Error("原候选出现额外、变更或过大的文件");
        const content = readFileSync(file);
        if (content.length !== metadata.sizeBytes || createHash("sha256").update(content).digest("hex") !== metadata.sha256)
          throw new Error("原候选字节已变化");
        found.add(name);
      } else throw new Error("原候选包含非普通文件");
    }
  };
  visit(directory);
  if (found.size !== expected.size) throw new Error("原候选文件不完整");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(join(directory, "deployment/core.deployment.lock.json"), "utf8")));
  if (requestFingerprint(lock) !== requestFingerprint(record.plan.candidate)) throw new Error("原候选锁与准备记录不同");
  return record;
}

export function createCorePackagePreparationFileStore(input: {
  directory: string;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  now?: () => number;
}): CorePackagePreparationStore {
  const root = resolve(input.directory), now = input.now ?? Date.now;
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const target = (sha256: string) => join(root, CoreArtifactHashSchema.parse(sha256));
  function lookup(directory: string, sha256: string) {
    try {
      ordinaryDirectory(root);
      if (!entryExists(directory)) return { status: "absent" as const };
    } catch {
      return { status: "unavailable" as const, error: {
        code: "preparation_read_failed", message: "原候选目录不可核定，请读取同一摘要"
      } };
    }
    try { return { status: "recorded" as const, record: readRecord(directory, sha256) }; }
    catch { throw new CoreAccessError("operation_conflict", "原固定候选的记录或字节存在缺口，请核对原结果"); }
  }

  return {
    read(sha256) {
      const current = lookup(target(sha256), sha256);
      if (current.status !== "absent") return current;
      return { status: "unavailable", error: {
        code: "preparation_unavailable", message: "原固定候选目录缺失，尚无可核定的发布结果" } };
    },
    prepare(bundle: CorePackagePreparationBundle) {
      if (requestFingerprint(bundle.plan) !== bundle.sha256) throw new CoreAccessError("operation_conflict", "候选准备指纹不一致");
      const directory = target(bundle.sha256);
      const existing = lookup(directory, bundle.sha256);
      if (existing.status === "unavailable") return existing;
      if (existing.status === "recorded") return { status: "already_prepared", record: existing.record };
      const temporary = mkdtempSync(join(root, ".core-candidate-"));
      let moved = false;
      try {
        if (bundle.artifact.kind === "core") {
          const packages = join(temporary, "package");
          mkdirSync(packages);
          const allowedRoutes = Object.hasOwn(legacyApiRoutes, bundle.artifact.pin.manifest.id)
            ? legacyApiRoutes[bundle.artifact.pin.manifest.id] : [];
          prepareCoreInstall(bundle.artifact.bytes, bundle.artifact.pin.sha256, packages, coreDeploymentHostVersions(bundle.plan.candidate),
            bundle.artifact.pin.manifest, allowedRoutes);
        }
        for (const [file, bytes] of bundle.files) {
          if (bundle.artifact.kind === "core" && file.startsWith("package/")) continue;
          const path = resolve(temporary, file);
          if (!inside(temporary, path)) throw new Error("候选文件越出暂存目录");
          mkdirSync(dirname(path), { recursive: true });
          ordinaryDirectory(dirname(path));
          writeFileSync(path, bytes, { flag: "wx" });
        }
        const record = CorePackagePreparationRecordSchema.parse({ sha256: bundle.sha256, preparedAt: new Date(now()).toISOString(), plan: bundle.plan });
        writeFileSync(join(temporary, recordFile), JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
        // 发布前复核同一最终文件集，原已准备目录只可回读，不能被当前预检覆盖。
        readRecord(temporary, bundle.sha256);
        try { renameSync(temporary, directory); moved = true; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (["EEXIST", "ENOTEMPTY", "EPERM"].includes(code ?? "")) {
            const current = lookup(directory, bundle.sha256);
            if (current.status === "recorded") return { status: "already_prepared", record: current.record };
          }
          return { status: "unknown", sha256: bundle.sha256, error: {
            code: "preparation_unknown", message: "候选发布尚无确定结果，请读取同一摘要"
          } };
        }
        return { status: "prepared", record };
      } finally {
        // rename 可能已经移走暂存目录，只是调用方没有收到成功结果。
        if (!moved && entryExists(temporary)) {
          const current = ordinaryDirectory(temporary);
          if (!inside(root, current) || current === root) throw new Error("暂存清理路径与本次候选不同");
          rmSync(current, { recursive: true });
        }
      }
    }
  };
}
