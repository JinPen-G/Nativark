/** 固定候选一次发布到独占根，Core 包写入复用原 prepareCoreInstall。
 * 同摘要已有目录逐字节核验，原回读核文件清单。暂存保留创建进程与原 SHA，
 * 退出只清理本次且身份/字节未变的文件和空目录，强制退出残留须另核归属。 */
import {
  closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmdirSync, unlinkSync, writeFileSync, type Stats
} from "node:fs";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep, toNamespacedPath } from "node:path";
import { CoreArtifactHashSchema, CoreDeploymentLockSchema, coreDeploymentHostVersions } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { prepareCoreInstall } from "@rental-os/core-contracts/install";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import { CoreAccessError } from "@rental-os/core-host";
import type { CorePackageLegacyApiRoutes } from "../core-package-ports";
import { CorePackageDeploymentOperationSchema, type CorePackageDeploymentOperation, type CorePackageDeploymentOperationStore } from "./deployment-ports";
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
const sameIdentity = (left: Stats, right: Stats) =>
  left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
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

/** 描述符绑定本次已核定的文件，阻止 stat 后路径替换将读取带到另一目录。 */
function readOrdinaryFile(file: string, maxBytes: number): Buffer {
  ordinaryDirectory(dirname(file));
  const identity = lstatSync(file);
  if (!identity.isFile() || identity.isSymbolicLink() || identity.size > maxBytes) throw new Error("原候选文件不可读或过大");
  const descriptor = openSync(file, "r");
  try {
    const opened = fstatSync(descriptor);
    ordinaryDirectory(dirname(file));
    const current = lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)
      || !sameIdentity(identity, opened) || current.size !== identity.size || current.mtimeMs !== identity.mtimeMs
      || opened.size !== identity.size || opened.mtimeMs !== identity.mtimeMs)
      throw new Error("原候选文件或父目录在读取前已变化");
    const bytes = readFileSync(descriptor), after = fstatSync(descriptor);
    ordinaryDirectory(dirname(file));
    const final = lstatSync(file);
    if (!final.isFile() || final.isSymbolicLink() || !sameIdentity(identity, final) || bytes.length !== opened.size
      || final.size !== opened.size || final.mtimeMs !== opened.mtimeMs
      || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs)
      throw new Error("原候选文件或父目录在读取中已变化");
    return bytes;
  } finally { closeSync(descriptor); }
}

function readRecord(directory: string, sha256: string): CorePackagePreparationRecord {
  ordinaryDirectory(directory);
  const bytes = readOrdinaryFile(join(directory, recordFile), 8 * 1024 * 1024);
  const record = CorePackagePreparationRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (record.sha256 !== sha256 || requestFingerprint(record.plan) !== sha256) throw new Error("原候选指纹与记录不同");
  const expected = new Map(record.plan.files.map(file => [file.file, file])), found = new Set<string>();
  let deploymentLock: Buffer | undefined;
  const visit = (current: string) => {
    // 目录枚举后可能被替换，每层读取前继续核普通父路径。
    ordinaryDirectory(current);
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = join(current, entry.name), name = relative(directory, file).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error("原候选路径出现链接");
      if (entry.isDirectory()) {
        if (![...expected.keys()].some(path => path.startsWith(name + "/"))) throw new Error("原候选出现额外目录");
        visit(file);
      } else if (entry.isFile()) {
        if (name === recordFile) continue;
        const metadata = expected.get(name);
        if (!metadata || metadata.sizeBytes > CORE_ARCHIVE_LIMITS.fileBytes)
          throw new Error("原候选出现额外或过大的文件");
        const content = readOrdinaryFile(file, metadata.sizeBytes);
        if (content.length !== metadata.sizeBytes || createHash("sha256").update(content).digest("hex") !== metadata.sha256)
          throw new Error("原候选字节已变化");
        found.add(name);
        if (name === "deployment/core.deployment.lock.json") deploymentLock = content;
      } else throw new Error("原候选包含非普通文件");
    }
  };
  visit(directory);
  if (found.size !== expected.size) throw new Error("原候选文件不完整");
  if (!deploymentLock) throw new Error("原候选缺少部署锁");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(deploymentLock.toString("utf8")));
  if (requestFingerprint(lock) !== requestFingerprint(record.plan.candidate)) throw new Error("原候选锁与准备记录不同");
  return record;
}

export function createCorePackagePreparationFileStore(input: {
  directory: string;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  now?: () => number;
}): CorePackagePreparationStore & CorePackageDeploymentOperationStore {
  const root = resolve(input.directory), now = input.now ?? Date.now;
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const target = (sha256: string) => join(root, CoreArtifactHashSchema.parse(sha256));
  const deploymentFile = (sha256: string) => join(root, `.deployment-${CoreArtifactHashSchema.parse(sha256)}.json`);
  function readDeployment(sha256: string): CorePackageDeploymentOperation | undefined {
    ordinaryDirectory(root);
    const file = deploymentFile(sha256);
    if (!entryExists(file)) return undefined;
    try {
      const operation = CorePackageDeploymentOperationSchema.parse(JSON.parse(readOrdinaryFile(file, 16 * 1024).toString("utf8")));
      if (operation.sha256 !== sha256) throw new Error("派发摘要不符");
      return operation;
    } catch { throw new CoreAccessError("operation_conflict", "原部署意图不可核定，保留原 ID 和文件处理，不可再次派发"); }
  }
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
    readDeployment,
    claimDeployment(value) {
      const operation = CorePackageDeploymentOperationSchema.parse(value), file = deploymentFile(operation.sha256);
      readRecord(target(operation.sha256), operation.sha256);
      const prior = readDeployment(operation.sha256);
      if (prior) return { claimed: false, operation: prior };
      const rootIdentity = lstatSync(ordinaryDirectory(root));
      let descriptor: number;
      try { descriptor = openSync(file, "wx", 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        return { claimed: false, operation: readDeployment(operation.sha256)! };
      }
      try {
        const opened = fstatSync(descriptor);
        if (!sameIdentity(rootIdentity, lstatSync(ordinaryDirectory(root)))
          || !sameIdentity(opened, lstatSync(file)) || lstatSync(file).isSymbolicLink() || opened.size !== 0)
          throw new Error("部署意图路径在提交前变化");
        writeFileSync(descriptor, JSON.stringify(operation) + "\n");
        fsyncSync(descriptor);
        if (process.platform !== "win32") {
          const parent = openSync(root, "r");
          try { fsyncSync(parent); } finally { closeSync(parent); }
        }
      } finally { closeSync(descriptor); }
      const saved = readDeployment(operation.sha256);
      if (!saved || requestFingerprint(saved) !== requestFingerprint(operation)) throw new Error("部署意图落盘不可核定");
      return { claimed: true, operation: saved };
    },
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
      // 归属文件留在发布目录之外，强制退出后仍可沿原 SHA 和进程核查暂存。
      const staging = join(root, basename(mkdtempSync(toNamespacedPath(join(root, `.core-candidate-${process.pid}-`)))));
      const temporary = join(staging, "candidate"), ownerFile = join(staging, "owner.json");
      const directories = new Map<string, Stats>([[staging, lstatSync(staging)]]);
      const written = new Map<string, { bytes: Uint8Array; identity: Stats }>();
      let moved = false, preparationFailure: unknown;
      function verifyDirectory(directory: string): void {
        ordinaryDirectory(directory);
        const identity = directories.get(directory);
        if (identity && !sameIdentity(lstatSync(directory), identity)) throw new Error("本次暂存目录身份已变化");
        if (directory !== staging && inside(staging, directory)) verifyDirectory(dirname(directory));
      }
      function ensureDirectory(directory: string): void {
        if (directories.has(directory)) { verifyDirectory(directory); return; }
        if (!inside(staging, directory) || directory === staging) throw new Error("暂存目录越出本次根");
        ensureDirectory(dirname(directory));
        mkdirSync(directory);
        directories.set(directory, lstatSync(directory));
        verifyDirectory(directory);
      }
      function write(file: string, bytes: Uint8Array): void {
        ensureDirectory(dirname(file));
        const descriptor = openSync(file, "wx");
        try {
          const identity = fstatSync(descriptor);
          verifyDirectory(dirname(file));
          const current = lstatSync(file);
          if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity, current)
            || identity.size !== 0 || current.size !== 0 || current.mtimeMs !== identity.mtimeMs)
            throw new Error("暂存文件或父目录在写入前已变化");
          written.set(file, { bytes, identity });
          writeFileSync(descriptor, bytes);
        } finally { closeSync(descriptor); }
      }
      try {
        write(ownerFile, Buffer.from(JSON.stringify({
          format: "core-preparation-staging-1", sha256: bundle.sha256, host: hostname(), pid: process.pid,
          processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
          directory: staging, candidateDirectory: temporary
        }, null, 2) + "\n"));
        ensureDirectory(temporary);
        if (bundle.artifact.kind === "core") {
          const packages = join(temporary, "package");
          ensureDirectory(packages);
          const allowedRoutes = Object.hasOwn(legacyApiRoutes, bundle.artifact.pin.manifest.id)
            ? legacyApiRoutes[bundle.artifact.pin.manifest.id] : [];
          prepareCoreInstall(bundle.artifact.bytes, bundle.artifact.pin.sha256, packages, coreDeploymentHostVersions(bundle.plan.candidate),
            bundle.artifact.pin.manifest, allowedRoutes);
          for (const [file, bytes] of bundle.files) {
            if (!file.startsWith("package/")) continue;
            const path = resolve(temporary, file);
            if (!inside(packages, path) || path === packages) throw new Error("原 Core 包文件越出暂存目录");
            let directory = dirname(path);
            while (directory !== packages) {
              directories.set(directory, lstatSync(directory));
              directory = dirname(directory);
            }
            verifyDirectory(dirname(path));
            written.set(path, { bytes, identity: lstatSync(path) });
          }
        }
        for (const [file, bytes] of bundle.files) {
          if (bundle.artifact.kind === "core" && file.startsWith("package/")) continue;
          const path = resolve(temporary, file);
          if (!inside(temporary, path)) throw new Error("候选文件越出暂存目录");
          write(path, bytes);
        }
        const record = CorePackagePreparationRecordSchema.parse({ sha256: bundle.sha256, preparedAt: new Date(now()).toISOString(), plan: bundle.plan });
        write(join(temporary, recordFile), Buffer.from(JSON.stringify(record, null, 2) + "\n"));
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
      } catch (error) {
        preparationFailure = error;
        throw error;
      } finally {
        // rename 可能已移走 candidate。保留被接手的文件及未知残留，逐项清本次输出。
        const cleanupErrors: unknown[] = [];
        const attempt = (action: () => void) => {
          try { action(); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupErrors.push(error); }
        };
        const removeFile = (file: string) => {
          verifyDirectory(dirname(file));
          const { bytes, identity } = written.get(file)!;
          const current = lstatSync(file);
          if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity)
            || current.size > bytes.length || !readOrdinaryFile(file, bytes.length).equals(bytes.subarray(0, current.size)))
            throw new Error("暂存文件身份或字节已变化，保留该文件");
          // 字节核对后仍可能发生同文件改写，删除前继续核定该版本。
          const final = lstatSync(file);
          if (!sameIdentity(current, final) || final.size !== current.size || final.mtimeMs !== current.mtimeMs)
            throw new Error("暂存文件在删除前已变化，保留该文件");
          verifyDirectory(dirname(file));
          unlinkSync(file);
        };
        for (const file of [...written.keys()].reverse()) {
          if (file === ownerFile || moved && inside(temporary, file)) continue;
          attempt(() => removeFile(file));
        }
        for (const directory of [...directories.keys()].sort((left, right) => right.length - left.length)) {
          if (directory === staging || moved && inside(temporary, directory)) continue;
          attempt(() => { verifyDirectory(directory); rmdirSync(directory); });
        }
        // 有未知内容时保留归属记录，供创建者继续处理原暂存。
        if (!cleanupErrors.length) {
          attempt(() => {
            verifyDirectory(staging);
            if (readdirSync(staging).some(file => file !== "owner.json")) throw new Error("暂存根出现其他内容，保留归属记录");
          });
          if (!cleanupErrors.length && written.has(ownerFile)) attempt(() => removeFile(ownerFile));
          if (!cleanupErrors.length) attempt(() => { verifyDirectory(staging); rmdirSync(staging); });
        }
        if (cleanupErrors.length) throw new AggregateError(
          preparationFailure === undefined ? cleanupErrors : [preparationFailure, ...cleanupErrors],
          "本次候选暂存含无法确认的内容，保留原路径核查");
      }
    }
  };
}
