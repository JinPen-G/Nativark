/** 固定可选平台数据包的字节核验。复用确定性归档，不加载包代码或执行迁移。 */
import { createHash } from "node:crypto";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "./archive";
import { CorePlatformDataCapabilityReleaseSchema, type CorePlatformDataCapabilityRelease } from "./data-capability";
import { readPackageArtifacts } from "./package";

export function requirePlatformDataCapabilityFiles(files: ReadonlyMap<string, Uint8Array>, input: CorePlatformDataCapabilityRelease) {
  const release = CorePlatformDataCapabilityReleaseSchema.parse(input);
  if (files.size !== release.files.length) throw new Error("能力包文件集合与固定发行不一致");
  for (const artifact of release.files) {
    const bytes = files.get(artifact.file);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
      throw new Error(`能力包文件缺失或摘要变化：${artifact.file}`);
  }
  if (createCoreArchive(files).sha256 !== release.sha256) throw new Error("能力包归档摘要与部署锁不一致");
  return release;
}

export function readPlatformDataCapabilityPackage(directory: string, input: CorePlatformDataCapabilityRelease) {
  const release = CorePlatformDataCapabilityReleaseSchema.parse(input);
  const result = readPackageArtifacts(directory, release.files, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  return { ...result, release: requirePlatformDataCapabilityFiles(result.files, release) };
}
