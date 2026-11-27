/** 公开GitHub只读传输；地址由适配器生成，正文有界，异常不输出响应体或签名URL。 */
export class GitHubCoreReadError extends Error {
  constructor(readonly code: "network" | "rate_limited" | "http" | "response_invalid" | "release_changed", message: string,
    readonly retryAfterSeconds?: number, readonly status?: number) { super(message); this.name = "GitHubCoreReadError"; }
}

export type GitHubFetcher = typeof fetch;
export const GITHUB_API = "https://api.github.com";
const headers = { "User-Agent": "Zelo-Core", "X-GitHub-Api-Version": "2026-03-10" };
const downloadHosts = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const officialRental = {
  id: 1470386426,
  stable: "https://github.com/JinPen-G/nativark-rental-core",
  canonical: "https://github.com/JinPen-G/Zelo-rental-core",
} as const;

/** Only the documented top-level rename can retain the old release identity.
 * A redirect, ordinary repository metadata, or an arbitrary alias cannot grant it. */
export function officialRentalReleaseSource(repository: string): string | undefined {
  return [officialRental.stable, officialRental.canonical].some(name => name.toLowerCase() === repository.toLowerCase())
    ? officialRental.stable : undefined;
}
const githubPath = (repository: string) => `/repos/${repository.slice("https://github.com/".length)}`;

/** 连接已坏时取消失败不覆盖原网络/HTTP诊断。 */
async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel(); } catch { /* 响应已中断，无剩余内容需要读取。 */ }
}

async function readResponse(url: string, binary: boolean, limit: number, fetcher: GitHubFetcher,
  verifiedMetadataRedirect?: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(binary ? 120_000 : 30_000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { ...headers, Accept: binary ? "application/octet-stream" : "application/vnd.github+json" },
        redirect: "manual", signal
      });
    } catch { throw new GitHubCoreReadError("network", "GitHub读取未完成；已安装组合不受影响，请稍后重新获取"); }
    if (binary && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await discard(response.body);
      const target = location && URL.canParse(location, url) ? new URL(location, url) : undefined;
      if (!target || target.protocol !== "https:" || target.username || target.password || target.port || target.hash || !downloadHosts.has(target.hostname))
        throw new GitHubCoreReadError("response_invalid", "Release下载跳转不属于支持的GitHub地址");
      url = target.href;
      continue;
    }
    if (verifiedMetadataRedirect && redirects === 0 && [301, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await discard(response.body);
      if (location !== verifiedMetadataRedirect)
        throw new GitHubCoreReadError("response_invalid", "官方 Rental 旧地址未指向原 GitHub 仓库 ID");
      url = verifiedMetadataRedirect;
      continue;
    }
    if (response.status !== 200) {
      await discard(response.body);
      if (response.status === 429 || response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))) {
        const retry = response.headers.get("retry-after");
        throw new GitHubCoreReadError("rate_limited", "GitHub请求已限流；保留当前组合，稍后手动重试",
          retry && /^\d+$/.test(retry) ? Number(retry) : undefined);
      }
      throw new GitHubCoreReadError("http", `GitHub返回HTTP ${response.status}；请核对公开仓库、Tag和Release资产`, undefined, response.status);
    }
    if (!response.body) throw new GitHubCoreReadError("response_invalid", "GitHub响应缺少内容");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0, complete = false;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) { complete = true; break; }
        size += part.value.byteLength;
        if (size > limit) throw new GitHubCoreReadError("response_invalid", "GitHub响应超过允许大小");
        chunks.push(part.value);
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof GitHubCoreReadError) throw error;
      throw new GitHubCoreReadError("network", "GitHub响应在读取中断开；没有生成待部署候选");
    } finally {
      reader.releaseLock();
      if (!complete) await discard(response.body);
    }
  }
  throw new GitHubCoreReadError("response_invalid", "Release下载跳转次数超过上限");
}

export function readGitHubResponse(url: string, binary: boolean, limit: number, fetcher: GitHubFetcher): Promise<Uint8Array> {
  return readResponse(url, binary, limit, fetcher);
}

async function readJson(path: string, fetcher: GitHubFetcher, verifiedMetadataRedirect?: string): Promise<unknown> {
  const bytes = await readResponse(GITHUB_API + path, false, 4 * 1024 * 1024, fetcher, verifiedMetadataRedirect);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new GitHubCoreReadError("response_invalid", "GitHub返回的资料不是有效JSON"); }
}

export async function readGitHubJson(path: string, fetcher: GitHubFetcher): Promise<unknown> {
  return readJson(path, fetcher);
}

/** Verify both public name lookups. Only the exact original numeric redirect
 * may be followed. Release and Contents requests stay on that verified ID. */
export async function resolveGitHubRepository(repository: string, fetcher: GitHubFetcher) {
  const path = githubPath(repository);
  if (!officialRentalReleaseSource(repository)) return { path, sourceRepository: repository };
  const originalPath = githubPath(officialRental.stable), canonicalPath = githubPath(officialRental.canonical);
  const idPath = `/repositories/${officialRental.id}`;
  const [original, canonical] = await Promise.all([
    readJson(originalPath, fetcher, GITHUB_API + idPath), readGitHubJson(canonicalPath, fetcher),
  ]);
  function metadata(value: unknown) {
    if (!value || typeof value !== "object" || !("id" in value) || value.id !== officialRental.id
      || !("html_url" in value) || value.html_url !== officialRental.canonical
      || !("full_name" in value) || value.full_name !== officialRental.canonical.slice("https://github.com/".length)
      || !("private" in value) || value.private !== false || !("archived" in value) || value.archived !== false
      || !("default_branch" in value) || typeof value.default_branch !== "string" || !value.default_branch || value.default_branch.length > 240)
      throw new GitHubCoreReadError("response_invalid", "官方 Rental 新旧地址未核到同一公开 GitHub 仓库");
    return { default_branch: value.default_branch, private: false as const, archived: false as const };
  }
  const originalMetadata = metadata(original), canonicalMetadata = metadata(canonical);
  if (originalMetadata.default_branch !== canonicalMetadata.default_branch)
    throw new GitHubCoreReadError("response_invalid", "官方 Rental 新旧地址的默认分支观察不一致");
  return { path: idPath, sourceRepository: officialRental.stable, metadata: canonicalMetadata };
}
