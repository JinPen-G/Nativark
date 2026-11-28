/** 原固定发行读取和已保存引用复用同一 GitHub 校验下载器。
 * 保留一个已下载包并合并同发行在途读取，宿主原本地引用继续由原来源供给。 */
import { isDeepStrictEqual } from "node:util";
import { CoreAccessError } from "@rental-os/core-host";
import { GitHubCoreReadError, inspectGitHubCoreRelease, verifyGitHubCoreRelease } from "@rental-os/core-contracts/github";
import type { CorePackageLegacyApiRoutes } from "../core-package-ports";
import type { CorePackagePrivateSourceAccess } from "../core-package-source-access";
import {
  CorePackageArtifactReferenceSchema, type CorePackageArtifactSource
} from "../core-package-preflight/ports";
import { createPlatformCorePackageGitHubSource } from "../core-package-preparation/github-source";
import {
  CorePackageReleaseReferenceSchema, CorePackageReleaseReferenceRecordSchema,
  type CorePackageReleaseReferenceStore, type CorePackageReleaseSource
} from "./ports";

/** 宿主显式提供公开网络适配，构造时只准备依赖，读取有完整请求期限。 */
export function createPlatformCorePackageReleaseSource(fetcher: typeof fetch = fetch,
  privateAccess?: CorePackagePrivateSourceAccess): CorePackageReleaseSource {
  async function access(repository: string) {
    if (!privateAccess) throw new GitHubCoreReadError("source_denied", "宿主尚未提供私有来源当前权限");
    return privateAccess.acquire(repository);
  }
  return {
    async inspect(selection) {
      const deadline = AbortSignal.timeout(90_000);
      const lease = selection.visibility === "private" ? await access(selection.repository) : undefined;
      try { return await inspectGitHubCoreRelease(selection, (url, options) => fetcher(url, {
        ...options, signal: options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline
      }), lease?.credential); }
      finally { await lease?.revalidate(); }
    },
    async authorize(release) {
      if (release.visibility !== "private") return undefined;
      const lease = await access(release.repository);
      try { await verifyGitHubCoreRelease(release, fetcher, lease.credential); }
      finally { await lease.revalidate(); }
      return { privateRelease: structuredClone(release), revalidate: transaction => lease.revalidate(transaction) };
    }
  };
}

export function createPlatformCorePackageSelectedArtifactSource(input: {
  store: CorePackageReleaseReferenceStore;
  local?: CorePackageArtifactSource;
  legacyApiRoutes?: CorePackageLegacyApiRoutes;
  fetcher?: typeof fetch;
  privateAccess?: CorePackagePrivateSourceAccess;
}): CorePackageArtifactSource {
  const legacyApiRoutes = structuredClone(input.legacyApiRoutes ?? {});
  const pending = new Map<string, CorePackageArtifactSource>();
  let downloaded: { reference: string; source: CorePackageArtifactSource } | undefined;

  function record(reference: string) {
    const result = input.store.read(reference);
    if (result.status === "unavailable") throw new CoreAccessError("core_unavailable", result.error.message);
    if (result.status === "absent") {
      if (result.reference !== reference) throw new CoreAccessError("operation_conflict", "原发行缺失证据与请求不同");
      return undefined;
    }
    const parsed = CorePackageReleaseReferenceRecordSchema.safeParse(result.record);
    if (!parsed.success || parsed.data.reference !== reference)
      throw new CoreAccessError("operation_conflict", "原发行引用与完整 pin 不一致");
    return parsed.data;
  }

  const releases = createPlatformCorePackageReleaseSource(input.fetcher, input.privateAccess);
  return {
    async authorize(reference) {
      if (!CorePackageReleaseReferenceSchema.safeParse(reference).success) return input.local?.authorize?.(reference);
      const original = record(reference);
      if (!original) return input.local?.authorize?.(reference);
      const lease = await releases.authorize!(original.release);
      if (!isDeepStrictEqual(record(reference), original)) throw new CoreAccessError("operation_conflict", "私有来源复权期间发行引用变化");
      return lease;
    },
    async read(value) {
      const reference = CorePackageArtifactReferenceSchema.parse(value);
      if (!CorePackageReleaseReferenceSchema.safeParse(reference).success) return input.local?.read(reference);
      const original = record(reference);
      if (!original) return input.local?.read(reference);
      let source = downloaded?.reference === reference ? downloaded.source : pending.get(reference);
      if (!source) {
        source = createPlatformCorePackageGitHubSource({ releases: new Map([[reference, original.release]]),
          legacyApiRoutes, fetcher: input.fetcher, privateAccess: input.privateAccess });
        pending.set(reference, source);
      }
      try {
        const artifact = await source.read(reference);
        const current = record(reference);
        if (!current || !isDeepStrictEqual(current, original))
          throw new CoreAccessError("operation_conflict", "下载期间原发行引用已不可核定，请读取同一引用");
        downloaded = { reference, source };
        return artifact;
      } finally {
        if (pending.get(reference) === source) pending.delete(reference);
      }
    }
  };
}
