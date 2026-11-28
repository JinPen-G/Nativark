/**
 * 从GitHub Release锁定提交/资产摘要，复用本地标准包安装准备。
 * 只读远端数据，不使用本机凭据、执行包内代码、切换部署或授予租户权限。
 */
import { z } from "zod";
import { CORE_ARCHIVE_LIMITS } from "./archive";
import { CoreArtifactHashSchema, CoreIdSchema, CoreSourceSchema } from "./manifest";
import { CoreReleaseVersionSchema } from "./version";
import type { CoreHostVersions } from "./compatibility";
import { prepareCoreInstall } from "./install";
import { GITHUB_API, GITHUB_PRIVATE_TOKEN_PATTERN, GitHubCoreReadError, officialRentalReleaseSource, readGitHubJson, readGitHubResponse,
  resolveGitHubRepository, type GitHubFetcher, type GitHubPrivateCredential } from "./github-http";
export { GitHubCoreReadError } from "./github-http";
export type { GitHubPrivateCredential } from "./github-http";
export { GitHubCoreDiscoveryQuerySchema, createGitHubCoreDiscovery } from "./github-discovery";
export type { GitHubCoreDiscoveryPage, GitHubCoreDiscoveryResult } from "./github-discovery";

/** 服务端凭据输入与传输使用同一有界字符合同；真实类型、到期与权限由 GitHub 核定。 */
export const GitHubPrivateTokenSchema = z.string().min(20).max(4096).regex(GITHUB_PRIVATE_TOKEN_PATTERN, "GitHub token 格式无效");

export const GitHubCoreRepositorySchema = z.string().regex(/^https:\/\/github\.com\/[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$(?![\s\S])/)
  .refine(value => !value.endsWith(".git") && ![".", ".."].includes(value.split("/").at(-1)!), "使用https://github.com/owner/repo仓库地址，不带.git后缀");
const selectionFields = {
  repository: GitHubCoreRepositorySchema, coreId: CoreIdSchema, version: CoreReleaseVersionSchema, tag: z.string().min(1).max(160),
  visibility: z.literal("private").optional()
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
  repositoryId: remoteId.optional(),
  sha256: CoreArtifactHashSchema,
  size: z.number().int().positive().max(CORE_ARCHIVE_LIMITS.totalBytes)
}).strict().refine(value => validTag(value) && (value.visibility === "private") === (value.repositoryId !== undefined),
  `${tagMessage}；私有发行必须绑定实际仓库 ID，公开发行不带私有字段`);
export type GitHubCoreReleasePin = z.infer<typeof GitHubCoreReleasePinSchema>;

/** Check a reader's result at the application boundary. The reader itself must
 * have verified the public numeric repository ID before issuing an alias pin.
 * Private selections always retain the exact verified repository identity. */
export function gitHubCoreReleaseMatchesSelection(selection: GitHubCoreReleaseSelection, pin: GitHubCoreReleasePin): boolean {
  return pin.coreId === selection.coreId && pin.version === selection.version && pin.tag === selection.tag
    && pin.visibility === selection.visibility
    && (pin.repository === selection.repository || selection.visibility !== "private" && selection.coreId === "rental"
      && officialRentalReleaseSource(selection.repository) === pin.repository);
}

const assetName = (selection: GitHubCoreReleaseSelection) => `${selection.coreId}-${selection.version}.tgz`;

const gitObject = z.object({ type: z.enum(["commit", "tag"]), sha: CoreSourceSchema.shape.commit });
async function resolveTag(path: string, selection: GitHubCoreReleaseSelection, fetcher: GitHubFetcher,
  credential?: GitHubPrivateCredential): Promise<string> {
  const reference = z.object({ ref: z.literal(`refs/tags/${selection.tag}`), object: gitObject })
    .parse(await readGitHubJson(`${path}/git/ref/tags/${encodeURIComponent(selection.tag)}`, fetcher, credential));
  let object = reference.object;
  const seen = new Set<string>();
  // 轻量Tag直接指向commit；附注Tag按对象读取，不能拿target_commitish的活动分支冒充提交。
  while (object.type === "tag") {
    if (seen.has(object.sha) || seen.size >= 16) throw new GitHubCoreReadError("response_invalid", "Tag对象存在循环或嵌套过深");
    seen.add(object.sha);
    object = z.object({ sha: z.literal(object.sha), object: gitObject })
      .parse(await readGitHubJson(`${path}/git/tags/${object.sha}`, fetcher, credential)).object;
  }
  return object.sha;
}

async function readPin(path: string, selection: GitHubCoreReleaseSelection, fetcher: GitHubFetcher,
  credential?: GitHubPrivateCredential, repositoryId?: number): Promise<GitHubCoreReleasePin> {
  const release = z.object({
    id: remoteId, tag_name: z.literal(selection.tag), draft: z.literal(false), prerelease: z.literal(false),
    published_at: z.string().min(1),
    assets: z.array(z.object({ id: remoteId, name: z.string(), state: z.string(), size: z.number().int(), digest: z.string().nullable() }))
  }).parse(await readGitHubJson(`${path}/releases/tags/${encodeURIComponent(selection.tag)}`, fetcher, credential));
  const assets = release.assets.filter(asset => asset.name === assetName(selection));
  if (assets.length !== 1 || assets[0].state !== "uploaded")
    throw new GitHubCoreReadError("response_invalid", `Release须包含唯一已上传的${assetName(selection)}`);
  const asset = assets[0];
  if (!asset.digest?.startsWith("sha256:"))
    throw new GitHubCoreReadError("response_invalid", "Release资产缺少GitHub提供的SHA-256摘要；重新发布新版本，或使用已核定摘要的本地包入口");
  return GitHubCoreReleasePinSchema.parse({ ...selection, commit: await resolveTag(path, selection, fetcher, credential),
    ...(repositoryId === undefined ? {} : { repositoryId }),
    releaseId: release.id, assetId: asset.id, sha256: asset.digest.slice(7), size: asset.size });
}

async function privateRepository(repository: string, fetcher: GitHubFetcher, credential?: GitHubPrivateCredential) {
  if (!credential || credential.repository !== repository)
    throw new GitHubCoreReadError("source_denied", "私有发行缺少当前仓库的服务端获取权限");
  const path = `/repos/${repository.slice("https://github.com/".length)}`;
  const metadata = z.object({ id: remoteId, private: z.literal(true), archived: z.literal(false),
    html_url: z.literal(repository), full_name: z.literal(repository.slice("https://github.com/".length)) })
    .safeParse(await readGitHubJson(path, fetcher, credential));
  if (!metadata.success) throw new GitHubCoreReadError("source_denied", "私有仓库身份、可见性或归档状态不可核定");
  return { path, repositoryId: metadata.data.id };
}

/** 只读固定发行资料；私有访问须由宿主先核当前管理权和凭据范围，再显式传入凭据。
 * 返回值只有来源身份，不含凭据；公共默认路径始终匿名，不读取本机 Key。 */
export async function inspectGitHubCoreRelease(selection: GitHubCoreReleaseSelection, fetcher: GitHubFetcher = fetch,
  credential?: GitHubPrivateCredential): Promise<GitHubCoreReleasePin> {
  const chosen = GitHubCoreReleaseSelectionSchema.parse(selection);
  if (chosen.visibility === "private") {
    const resolved = await privateRepository(chosen.repository, fetcher, credential);
    const pin = await readPin(resolved.path, chosen, fetcher, credential, resolved.repositoryId);
    if ((await privateRepository(chosen.repository, fetcher, credential)).repositoryId !== resolved.repositoryId)
      throw new GitHubCoreReadError("release_changed", "私有仓库身份在读取期间变化");
    return pin;
  }
  const resolved = await resolveGitHubRepository(chosen.repository, fetcher);
  if (resolved.metadata && chosen.coreId !== "rental")
    throw new GitHubCoreReadError("response_invalid", "官方 Rental 仓库只提供原 Rental 发行身份");
  return readPin(resolved.path, { ...chosen, repository: resolved.sourceRepository }, fetcher);
}

/** Download once under the same verified repo and re-read before and after.
 * Callers still inspect the standard package and its strictly pinned source. */
export async function downloadGitHubCoreRelease(input: GitHubCoreReleasePin, fetcher: GitHubFetcher = fetch,
  credential?: GitHubPrivateCredential) {
  const pin = GitHubCoreReleasePinSchema.parse(input);
  const { repository, coreId, version, tag } = pin;
  if (!pin.visibility && officialRentalReleaseSource(repository) && (coreId !== "rental" || officialRentalReleaseSource(repository) !== repository))
    throw new GitHubCoreReadError("release_changed", "官方 Rental 须使用核定的原稳定发行 pin，请重新查看该版本");
  const selection = { repository, coreId, version, tag, ...(pin.visibility ? { visibility: pin.visibility } : {}) };
  const unchanged = async () => {
    if (pin.visibility === "private") {
      const current = await inspectGitHubCoreRelease(selection, fetcher, credential);
      if ((Object.keys(pin) as Array<keyof GitHubCoreReleasePin>).some(key => pin[key] !== current[key]))
        throw new GitHubCoreReadError("release_changed", "私有仓库、Release、Tag提交或资产已变化");
      return `/repos/${repository.slice("https://github.com/".length)}`;
    }
    const resolved = await resolveGitHubRepository(repository, fetcher);
    const current = await readPin(resolved.path, { ...selection, repository: resolved.sourceRepository }, fetcher);
    if ((Object.keys(pin) as Array<keyof GitHubCoreReleasePin>).some(key => pin[key] !== current[key]))
      throw new GitHubCoreReadError("release_changed", "选定Release、Tag提交或资产已变化；停止准备，请核对来源并选择新版本");
    return resolved.path;
  };
  const path = await unchanged();
  const bytes = await readGitHubResponse(`${GITHUB_API}${path}/releases/assets/${pin.assetId}`, true, pin.size, fetcher,
    pin.visibility === "private" ? credential : undefined);
  if (bytes.length !== pin.size) throw new GitHubCoreReadError("response_invalid", "Release资产下载长度与锁定资料不一致");
  await unchanged();
  return { pin, bytes };
}

/** 缓存命中、候选和部署边界仍须读取远端当前权限及完整固定身份，不能由缓存自授权。 */
export async function verifyGitHubCoreRelease(input: GitHubCoreReleasePin, fetcher: GitHubFetcher = fetch,
  credential?: GitHubPrivateCredential): Promise<void> {
  const pin = GitHubCoreReleasePinSchema.parse(input);
  const current = await inspectGitHubCoreRelease({ repository: pin.repository, coreId: pin.coreId, version: pin.version,
    tag: pin.tag, ...(pin.visibility ? { visibility: pin.visibility } : {}) }, fetcher, credential);
  if ((Object.keys(pin) as Array<keyof GitHubCoreReleasePin>).some(key => pin[key] !== current[key]))
    throw new GitHubCoreReadError("release_changed", "固定发行身份与原记录不一致，请核对原来源");
}

/** 旧路径许可由真实宿主供给，固定发行检查和本地准备共用同一精确集合。 */
export async function prepareGitHubCoreRelease(input: GitHubCoreReleasePin, directory: string, host: CoreHostVersions,
  fetcher: GitHubFetcher = fetch, legacyApiRoutes: readonly string[] = [], credential?: GitHubPrivateCredential) {
  const allowedRoutes = [...legacyApiRoutes];
  const { pin, bytes } = await downloadGitHubCoreRelease(input, fetcher, credential);
  // 所有远端/来源检查完成后才写候选，沿用本地安装的摘要、兼容、重复核对与失败清理。
  return { ...prepareCoreInstall(bytes, pin.sha256, directory, host, {
    id: pin.coreId, version: pin.version, source: { repository: pin.repository, commit: pin.commit }
  }, allowedRoutes), release: pin };
}
