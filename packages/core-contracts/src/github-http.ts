/** 公开GitHub只读传输；地址由适配器生成，正文有界，异常不输出响应体或签名URL。 */
export class GitHubCoreReadError extends Error {
  constructor(readonly code: "network" | "rate_limited" | "http" | "response_invalid" | "release_changed", message: string,
    readonly retryAfterSeconds?: number, readonly status?: number) { super(message); this.name = "GitHubCoreReadError"; }
}

export type GitHubFetcher = typeof fetch;
export const GITHUB_API = "https://api.github.com";
const headers = { "User-Agent": "Nativark-Core", "X-GitHub-Api-Version": "2026-03-10" };
const downloadHosts = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);

/** 连接已坏时取消失败不覆盖原网络/HTTP诊断。 */
async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel(); } catch { /* 响应已中断，无剩余内容需要读取。 */ }
}

export async function readGitHubResponse(url: string, binary: boolean, limit: number, fetcher: GitHubFetcher): Promise<Uint8Array> {
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
      if (!target || target.protocol !== "https:" || target.username || target.password || target.port || !downloadHosts.has(target.hostname))
        throw new GitHubCoreReadError("response_invalid", "Release下载跳转不属于支持的GitHub地址");
      url = target.href;
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

export async function readGitHubJson(path: string, fetcher: GitHubFetcher): Promise<unknown> {
  const bytes = await readGitHubResponse(GITHUB_API + path, false, 4 * 1024 * 1024, fetcher);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new GitHubCoreReadError("response_invalid", "GitHub返回的资料不是有效JSON"); }
}
