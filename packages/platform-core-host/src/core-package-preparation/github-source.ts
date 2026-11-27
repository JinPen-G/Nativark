/** 从宿主登记的固定 Release 读取原资产，复用 GitHub 有界传输和前后 pin 核验。
 * 缓存只保留一个已下载固定包，同一固定发行合并读取，当前管理权限仍由消费应用复验。 */
import {
  GitHubCoreReleasePinSchema, GitHubCoreReadError, downloadGitHubCoreRelease, type GitHubCoreReleasePin
} from "@rental-os/core-contracts/github";
import { readCoreArchive } from "@rental-os/core-contracts/archive";
import { inspectCorePackageFiles } from "@rental-os/core-contracts/package";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";
import type { CorePackageLegacyApiRoutes } from "../core-package-ports";
import { CorePackageArtifactReferenceSchema, type CorePackageArtifact, type CorePackageArtifactSource } from "../core-package-preflight/ports";

type GitHubPackageArtifact = Extract<CorePackageArtifact, { kind: "core" }>;
export function createPlatformCorePackageGitHubSource(input: {
  releases: ReadonlyMap<string, GitHubCoreReleasePin>;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  fetcher?: typeof fetch;
}): CorePackageArtifactSource {
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const releases = new Map<string, GitHubCoreReleasePin>();
  for (const [reference, pin] of input.releases)
    releases.set(CorePackageArtifactReferenceSchema.parse(reference), GitHubCoreReleasePinSchema.parse(pin));
  const pending = new Map<string, Promise<GitHubPackageArtifact>>();
  let downloaded: { fingerprint: string; artifact: GitHubPackageArtifact } | undefined;

  async function download(pin: GitHubCoreReleasePin): Promise<GitHubPackageArtifact> {
    const deadline = AbortSignal.timeout(180_000), transport = input.fetcher ?? fetch;
    const fetcher: typeof fetch = (url, options) => transport(url, { ...options,
      signal: options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline });
    const { bytes } = await downloadGitHubCoreRelease(pin, fetcher);
    const allowedRoutes = Object.hasOwn(legacyApiRoutes, pin.coreId) ? legacyApiRoutes[pin.coreId] : [];
    const inspected = inspectCorePackageFiles(readCoreArchive(bytes, pin.sha256).files, undefined, allowedRoutes);
    const manifest = inspected.manifest;
    if (!inspected.ok || !manifest) throw new GitHubCoreReadError("response_invalid", "Release 资产未通过原标准包检查");
    if (manifest.id !== pin.coreId || manifest.version !== pin.version || manifest.source.repository !== pin.repository
      || manifest.source.commit !== pin.commit)
      throw new GitHubCoreReadError("release_changed", "资产清单与原发行的 ID、版本或来源不一致");
    return { kind: "core", pin: { manifest, sha256: pin.sha256 }, bytes: Buffer.from(bytes) };
  }

  return {
    async read(reference) {
      const pin = releases.get(reference);
      if (!pin) return undefined;
      const fingerprint = requestFingerprint(pin);
      if (downloaded?.fingerprint === fingerprint) return { kind: "core", pin: structuredClone(downloaded.artifact.pin),
        bytes: Buffer.from(downloaded.artifact.bytes) };
      let work = pending.get(fingerprint);
      if (!work) {
        work = download(pin);
        pending.set(fingerprint, work);
      }
      try {
        const artifact = await work;
        downloaded = { fingerprint, artifact };
        return { kind: "core", pin: structuredClone(artifact.pin), bytes: Buffer.from(artifact.bytes) };
      } finally {
        if (pending.get(fingerprint) === work) pending.delete(fingerprint);
      }
    }
  };
}
