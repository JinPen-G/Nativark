/** 发行引用仅追加到宿主独占目录，完整记录经同卷硬链接原子发布，已有文件不可覆盖。
 * 读取失败保留 unavailable，发布失应答保留原引用，finally 清理本次独占暂存目录。 */
import { lstatSync, realpathSync, readFileSync, writeFileSync, mkdtempSync, linkSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GitHubCoreReleasePinSchema } from "@rental-os/core-contracts/github";
import {
  CorePackageReleaseReferenceSchema, CorePackageReleaseReferenceRecordSchema, corePackageReleaseReference,
  type CorePackageReleaseReferenceStore
} from "./ports";
import type { CorePackageReleaseReferenceRead, CorePackageReleaseReferenceRecord } from "./protocol";

const maxRecordBytes = 64 * 1024;
function ordinaryDirectory(directory: string): string {
  const absolute = resolve(directory);
  for (let current = absolute; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("发行引用目录及父目录须为普通目录");
    if (dirname(current) === current) return realpathSync(absolute);
  }
}
function readRecord(file: string, reference: string): CorePackageReleaseReferenceRecord {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxRecordBytes) throw new Error("原发行记录不可核定");
  const bytes = readFileSync(file);
  if (bytes.length > maxRecordBytes) throw new Error("原发行记录超过读取上限");
  const record = CorePackageReleaseReferenceRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (record.reference !== reference) throw new Error("原发行记录与请求引用不同");
  return record;
}

export function createCorePackageReleaseReferenceFileStore(input: {
  directory: string;
  now?: () => number;
}): CorePackageReleaseReferenceStore {
  const root = resolve(input.directory), now = input.now ?? Date.now;
  const target = (reference: string) => join(root, `${CorePackageReleaseReferenceSchema.parse(reference)}.json`);

  function read(reference: string): CorePackageReleaseReferenceRead {
    const file = target(reference);
    try {
      ordinaryDirectory(root);
      try { lstatSync(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent", reference };
        throw error;
      }
      return { status: "recorded", record: readRecord(file, reference) };
    } catch {
      return { status: "unavailable", error: {
        code: "release_reference_read_failed", message: "原发行引用记录、路径或指纹不可核定，请核对同一引用"
      } };
    }
  }

  return {
    read,
    select(value) {
      const release = GitHubCoreReleasePinSchema.parse(value), reference = corePackageReleaseReference(release);
      const existing = read(reference);
      if (existing.status === "unavailable") return existing;
      if (existing.status === "recorded") return { status: "already_selected", record: existing.record };
      const record = CorePackageReleaseReferenceRecordSchema.parse({
        format: "core-release-reference-1", reference, selectedAt: new Date(now()).toISOString(),
        release, review: "unreviewed", package: "unchecked"
      });
      const bytes = Buffer.from(JSON.stringify(record, null, 2) + "\n");
      if (bytes.length > maxRecordBytes) return { status: "unavailable", error: {
        code: "release_reference_too_large", message: "固定发行记录超过存储上限"
      } };
      let temporary: string | undefined, rootDirectory: string | undefined, publishing = false;
      try {
        rootDirectory = ordinaryDirectory(root);
        temporary = mkdtempSync(join(rootDirectory, ".release-reference-"));
        const staged = join(temporary, "reference.json");
        writeFileSync(staged, bytes, { flag: "wx", mode: 0o600 });
        readRecord(staged, reference);
        ordinaryDirectory(root);
        // 首次发布须原子创建唯一目标，使并发保存收敛到同一原记录。
        publishing = true;
        try { linkSync(staged, target(reference)); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const current = read(reference);
          if (current.status === "recorded") return { status: "already_selected", record: current.record };
          throw new Error("并发发布的原记录不可核定");
        }
        const current = read(reference);
        if (current.status !== "recorded") throw new Error("发布后原记录不可核定");
        return { status: "selected", record: current.record };
      } catch {
        return publishing ? { status: "unknown", reference, error: {
          code: "release_reference_unknown", message: "发行引用发布尚无确定结果，请读取同一引用"
        } } : { status: "unavailable", error: {
          code: "release_reference_write_failed", message: "发行引用未完成发布，请核对独占存储目录"
        } };
      } finally {
        if (temporary) {
          const current = ordinaryDirectory(temporary);
          if (dirname(current) !== rootDirectory) throw new Error("发行暂存清理路径与本次独占目录不同");
          rmSync(current, { recursive: true });
        }
      }
    }
  };
}
