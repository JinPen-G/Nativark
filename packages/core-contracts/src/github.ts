/**
 * 从公开GitHub Release锁定提交/资产摘要，复用本地标准包安装准备。
 * 只读远端数据，不使用本机凭据、执行包内代码、切换部署或授予租户权限。
 */
import { z } from "zod";
import { CORE_ARCHIVE_LIMITS } from "./archive";
import { CoreArtifactHashSchema, CoreIdSchema, CoreSourceSchema } from "./manifest";
import { CoreReleaseVersionSchema } from "./version";
import type { CoreHostVersions } from "./compatibility";
import { prepareCoreInstall } from "./install";

const repository = z.string().regex(/^https:\/\/github\.com\/[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$(?![\s\S])/)
  .refine(value => !value.endsWith(".git") && ![".", ".."].includes(value.split("/").at(-1)!), "使用https://github.com/owner/repo仓库地址，不带.git后缀");
const selectionFields = {
  repository, coreId: CoreIdSchema, version: CoreReleaseVersionSchema, tag: z.string().min(1).max(160)
};
const validTag = (value: { coreId: string; version: string; tag: string }) =>
  value.tag === `v${value.version}` || value.tag === `${value.coreId}/v${value.version}`;
const tagMessage = "Tag使用v<版本>；同仓多个Core使用<Core ID>/v<版本>";
export const GitHubCoreReleaseSelectionSchema = z.object(selectionFields).strict().refine(validTag, tagMessage);
export type GitHubCoreReleaseSelection = z.infer<typeof GitHubCoreReleaseSelectionSchema>;
const remoteId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const GitHubCoreReleasePinSchema = z.object({
  ...selectionFields,
  commit: CoreSourceSchema.shape.commit,
  releaseId: remoteId,
  assetId: remoteId,
  sha256: CoreArtifactHashSchema,
  size: z.number().int().positive().max(CORE_ARCHIVE_LIMITS.totalBytes)
}).strict().refine(validTag, tagMessage);
export type GitHubCoreReleasePin = z.infer<typeof GitHubCoreReleasePinSchema>;

/** 供发现/安装界面分别表达限流和不可达；错误不携带响应正文、签名下载URL或凭据。 */
export class GitHubCoreReadError extends Error {
  constructor(readonly code: "network" | "rate_limited" | "http" | "response_invalid" | "release_changed", message: string,
    readonly retryAfterSeconds?: number) { super(message); this.name = "GitHubCoreReadError"; }
}

type Fetcher = typeof fetch;
const api = "https://api.github.com";
const headers = { "User-Agent": "Nativark-Core", "X-GitHub-Api-Version": "2026-03-10" };
const downloadHosts = new Set(["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
const repoPath = (selection: GitHubCoreReleaseSelection) => `/repos/${selection.repository.slice("https://github.com/".length)}`;
const assetName = (selection: GitHubCoreReleaseSelection) => `${selection.coreId}-${selection.version}.tgz`;

/** 丢弃未消费的响应体；连接已坏时取消失败不覆盖原网络/HTTP诊断。 */
async function discard(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try { await body?.cancel(); } catch { /* 响应已中断，无剩余内容需要读取。 */ }
}

async function readResponse(url: string, binary: boolean, limit: number, fetcher: Fetcher): Promise<Uint8Array> {
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
      throw new GitHubCoreReadError("http", `GitHub返回HTTP ${response.status}；请核对公开仓库、Tag和Release资产`);
    }
    if (!response.body) throw new GitHubCoreReadError("response_invalid", "GitHub响应缺少内容");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    let complete = false;
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

async function readJson(path: string, fetcher: Fetcher): Promise<unknown> {
  const bytes = await readResponse(api + path, false, 4 * 1024 * 1024, fetcher);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new GitHubCoreReadError("response_invalid", "GitHub返回的资料不是有效JSON"); }
}

const gitObject = z.object({ type: z.enum(["commit", "tag"]), sha: CoreSourceSchema.shape.commit });
async function resolveTag(selection: GitHubCoreReleaseSelection, fetcher: Fetcher): Promise<string> {
  const path = repoPath(selection);
  const reference = z.object({ ref: z.literal(`refs/tags/${selection.tag}`), object: gitObject })
    .parse(await readJson(`${path}/git/ref/tags/${encodeURIComponent(selection.tag)}`, fetcher));
  let object = reference.object;
  const seen = new Set<string>();
  // 轻量Tag直接指向commit；附注Tag按对象读取，不能拿target_commitish的活动分支冒充提交。
  while (object.type === "tag") {
    if (seen.has(object.sha) || seen.size >= 16) throw new GitHubCoreReadError("response_invalid", "Tag对象存在循环或嵌套过深");
    seen.add(object.sha);
    object = z.object({ sha: z.literal(object.sha), object: gitObject })
      .parse(await readJson(`${path}/git/tags/${object.sha}`, fetcher)).object;
  }
  return object.sha;
}

async function readPin(selection: GitHubCoreReleaseSelection, fetcher: Fetcher): Promise<GitHubCoreReleasePin> {
  const release = z.object({
    id: remoteId, tag_name: z.literal(selection.tag), draft: z.literal(false), prerelease: z.literal(false),
    published_at: z.string().min(1),
    assets: z.array(z.object({ id: remoteId, name: z.string(), state: z.string(), size: z.number().int(), digest: z.string().nullable() }))
  }).parse(await readJson(`${repoPath(selection)}/releases/tags/${encodeURIComponent(selection.tag)}`, fetcher));
  const assets = release.assets.filter(asset => asset.name === assetName(selection));
  if (assets.length !== 1 || assets[0].state !== "uploaded")
    throw new GitHubCoreReadError("response_invalid", `Release须包含唯一已上传的${assetName(selection)}`);
  const asset = assets[0];
  if (!asset.digest?.startsWith("sha256:"))
    throw new GitHubCoreReadError("response_invalid", "Release资产缺少GitHub提供的SHA-256摘要；重新发布新版本，或使用已核定摘要的本地包入口");
  return GitHubCoreReleasePinSchema.parse({ ...selection, commit: await resolveTag(selection, fetcher),
    releaseId: release.id, assetId: asset.id, sha256: asset.digest.slice(7), size: asset.size });
}

/** 只读固定发行资料；调用方保存并展示返回的pin，准备阶段仍须验证原固定内容。 */
export async function inspectGitHubCoreRelease(selection: GitHubCoreReleaseSelection, fetcher: Fetcher = fetch): Promise<GitHubCoreReleasePin> {
  return readPin(GitHubCoreReleaseSelectionSchema.parse(selection), fetcher);
}

export async function prepareGitHubCoreRelease(input: GitHubCoreReleasePin, directory: string, host: CoreHostVersions, fetcher: Fetcher = fetch) {
  const pin = GitHubCoreReleasePinSchema.parse(input);
  const { repository, coreId, version, tag } = pin;
  const selection = { repository, coreId, version, tag };
  const unchanged = async () => {
    const current = await readPin(selection, fetcher);
    if ((Object.keys(pin) as Array<keyof GitHubCoreReleasePin>).some(key => pin[key] !== current[key]))
      throw new GitHubCoreReadError("release_changed", "选定Release、Tag提交或资产已变化；停止准备，请核对来源并选择新版本");
  };
  await unchanged();
  const bytes = await readResponse(`${api}${repoPath(selection)}/releases/assets/${pin.assetId}`, true, pin.size, fetcher);
  if (bytes.length !== pin.size) throw new GitHubCoreReadError("response_invalid", "Release资产下载长度与锁定资料不一致");
  await unchanged();
  // 所有远端/来源检查完成后才写候选，沿用本地安装的摘要、兼容、重复核对与失败清理。
  return { ...prepareCoreInstall(bytes, pin.sha256, directory, host, {
    id: coreId, version, source: { repository, commit: pin.commit }
  }), release: pin };
}
