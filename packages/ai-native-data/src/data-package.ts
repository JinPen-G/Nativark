/** 本版 AI 数据包的正式读取与固定发行。完整包摘要和原材料来源分别核定。
 * 必须包含真实构建入口；作者源码目录、仅 SQL 指纹或迁移准备结果不能冒充已安装包。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformDataCapabilityReleaseSchema, CoreSourceSchema,
  type CorePlatformDataCapabilityRelease } from "@rental-os/core-contracts";
import { createCoreArchive } from "@rental-os/core-contracts/archive";
import { readPlatformDataCapabilityPackage, requirePlatformDataCapabilityFiles } from "@rental-os/core-contracts/platform-data-package";
import { createAiNativeDataContribution, AI_NATIVE_PRISMA_SCHEMA, type AiNativeDataContribution } from "./data";
import { AI_NATIVE_DATA_PREREQUISITES } from "./preparation";

export const AI_NATIVE_DATA_PACKAGE_VERSION = "0.1.1";
const packageName = "@rental-os/ai-native-data";

function packageEntries(files: ReadonlyMap<string, Uint8Array>): void {
  const bytes = files.get("package.json");
  if (!bytes) throw new Error("AI 数据固定包缺少 package.json");
  const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (metadata.name !== packageName || metadata.version !== AI_NATIVE_DATA_PACKAGE_VERSION || metadata.license !== "MIT")
    throw new Error("AI 数据包身份、实现版本或许可不一致");
  for (const entry of ["data", "prisma-schema", "preparation", "data-package", "mysql-data"]) {
    const declared = metadata.exports?.[`./${entry}`];
    for (const [kind, suffix] of [["default", "js"], ["types", "d.ts"]] as const) {
      const target = `dist/${entry}.${suffix}`;
      if (declared?.[kind] !== `./${target}` || !files.get(target)?.byteLength)
        throw new Error(`AI 数据固定包缺少实际构建入口：${target}`);
    }
  }
  if (!files.get("README.md")?.byteLength || !files.get("LICENSE")?.byteLength)
    throw new Error("AI 数据固定包缺少接入说明或许可");
}

function releaseMetadata(contribution: AiNativeDataContribution) {
  const prerequisites = AI_NATIVE_DATA_PREREQUISITES;
  return {
    id: "ai-native", version: AI_NATIVE_DATA_PACKAGE_VERSION,
    compatibility: { platform: { minInclusive: "0.1.0", maxExclusive: "0.2.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" } },
    runtime: { node: { minInclusive: "22.0.0", maxExclusive: "25.0.0" } },
    schema: AI_NATIVE_PRISMA_SCHEMA, data: contribution.data,
    // Rental 0.1.1 仅追加六张换货 raw SQL 表；原 schema、initial 及 AI 外键目标保持。
    // 只接受已核定的 0.1.0/0.1.1，未来数据版本须重新验证，不以 readable 范围代替。
    prerequisites: { platform: { minInclusive: prerequisites.platform.dataVersion, maxExclusive: "0.1.10" },
      cores: [{ coreId: "rental", version: { minInclusive: prerequisites.rental.dataVersion, maxExclusive: "0.1.2" },
        migrations: [{ id: prerequisites.rental.migrationId, sha256: prerequisites.rental.migrationSha256 }] }] }
  };
}

/** 来源是本次固定包的发行来源，原 SQL/schema 的来源继续保留在 contribution.source。 */
export function createAiNativeDataRelease(input: {
  files: ReadonlyMap<string, Uint8Array>;
  source: CorePlatformDataCapabilityRelease["source"];
}): CorePlatformDataCapabilityRelease {
  packageEntries(input.files);
  const contribution = createAiNativeDataContribution(input.files);
  return CorePlatformDataCapabilityReleaseSchema.parse({ ...releaseMetadata(contribution),
    source: CoreSourceSchema.parse(input.source), sha256: createCoreArchive(input.files).sha256,
    files: [...input.files].sort(([a], [b]) => a.localeCompare(b)).map(([file, bytes]) => ({
      file, sha256: createHash("sha256").update(bytes).digest("hex")
    })) });
}

function readVerifiedPackage(files: ReadonlyMap<string, Uint8Array>, release: CorePlatformDataCapabilityRelease) {
  packageEntries(files);
  const contribution = createAiNativeDataContribution(files);
  const { source: _source, sha256: _sha256, files: _files, ...metadata } = release;
  if (!isDeepStrictEqual(metadata, releaseMetadata(contribution)))
    throw new Error("AI 数据包的固定版本、schema、迁移或前置与本实现不一致");
  return { release, contribution, schema: contribution.schema };
}

export function readAiNativeDataPackage(files: ReadonlyMap<string, Uint8Array>, input: CorePlatformDataCapabilityRelease) {
  return readVerifiedPackage(files, requirePlatformDataCapabilityFiles(files, input));
}

export function requireAiNativeDataPackage(directory: string, input: CorePlatformDataCapabilityRelease) {
  const installed = readPlatformDataCapabilityPackage(directory, input);
  return { root: installed.root, ...readVerifiedPackage(installed.files, installed.release) };
}
