/** 从实际原包材料生成固定候选文件，迁移组合委托原 Core deployment。
 * 指纹复用原请求排序与 SHA-256，选中包、基础组合及全部文件绑定同一准备引用。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readCoreArchive } from "@rental-os/core-contracts/archive";
import { createCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import type { GitHubCoreReleasePin } from "@rental-os/core-contracts/github";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { CorePackageArtifact } from "../core-package-preflight/ports";
import type { CorePackageLegacyApiRoutes } from "../core-package-ports";
import {
  CorePackagePreparationPlanSchema, type CorePackagePreparationBundle,
  type CorePackagePreparationMaterialsSource, type CorePackagePreparationRequest
} from "./ports";

export async function createCorePackagePreparationBundle(input: {
  request: CorePackagePreparationRequest;
  artifact: CorePackageArtifact;
  base: CoreDeploymentLock;
  candidate: CoreDeploymentLock;
  materials: CorePackagePreparationMaterialsSource;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  privateRelease?: GitHubCoreReleasePin;
}): Promise<CorePackagePreparationBundle> {
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const source = await input.materials.read();
  if (!source || !isDeepStrictEqual(CoreDeploymentLockSchema.parse(source.base), input.base))
    throw new Error("当前包材料与原部署组合不一致");
  // 替换前核对完整原组合，及时发现目标包或迁移源码已修改的冲突。
  createCoreMigrationDeployment({ lock: input.base, platform: source.platform, cores: source.cores,
    dataCapabilities: source.dataCapabilities, legacyApiRoutes });
  const { artifact } = input, sha256 = artifact.kind === "core" ? artifact.pin.sha256 : artifact.release.sha256;
  const archive = readCoreArchive(artifact.bytes, sha256), cores = new Map(source.cores);
  const dataCapabilities = new Map(source.dataCapabilities);
  let platform = source.platform;
  if (artifact.kind === "core") cores.set(artifact.pin.manifest.id, archive.files);
  else if (artifact.kind === "platform") platform = artifact.release.data.migrations.map(migration => {
    const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(migration.file);
    const sql = archive.files.get(`apps/platform-api/${migration.file}`);
    if (!match || !sql) throw new Error("底座候选缺少正式 Prisma 迁移目录映射");
    return { name: match[1], sql };
  });
  else dataCapabilities.set(artifact.release.id, archive.files);
  const deployment = createCoreMigrationDeployment({ lock: input.candidate, platform, cores,
    dataCapabilities, legacyApiRoutes });
  const files = new Map<string, Uint8Array>();
  for (const [file, bytes] of deployment) files.set(`deployment/${file}`, Buffer.from(bytes));
  for (const release of input.candidate.dataCapabilities ?? []) {
    const prefix = `platform-capabilities/${release.id}-${release.version}-${release.sha256}/`;
    for (const [file, bytes] of dataCapabilities.get(release.id)!) files.set(prefix + file, Buffer.from(bytes));
  }
  if (artifact.kind !== "platform-capability") {
    const prefix = artifact.kind === "core"
      ? `package/${artifact.pin.manifest.id}-${artifact.pin.manifest.version}-${artifact.pin.sha256}/` : "platform/";
    for (const [file, bytes] of archive.files) files.set(prefix + file, Buffer.from(bytes));
  }
  const { bytes: _bytes, ...summary } = artifact;
  const plan = CorePackagePreparationPlanSchema.parse({
    format: "core-preparation-1", deployment: "pending", request: input.request, artifact: summary,
    ...(input.privateRelease ? { privateRelease: input.privateRelease } : {}),
    base: input.base, candidate: input.candidate,
    files: [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([file, bytes]) => ({ file, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }))
  });
  return { plan, sha256: requestFingerprint(plan), artifact, files };
}
