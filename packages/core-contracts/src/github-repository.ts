/**
 * 在固定Git提交读取公开Core仓库的单清单或多Core索引，按需核固定Release元数据。
 * Contents仅解析有界JSON，模块加载和包下载继续使用原受控装配/发行入口。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { CORE_MANIFEST_FILE, CoreIdSchema, CoreManifestSchema, CorePackagePathSchema, CoreSourceSchema, type CoreManifest } from "./manifest";
import { GitHubCoreRepositorySchema, inspectGitHubCoreRelease, type GitHubCoreReleasePin, type GitHubCoreReleaseSelection } from "./github";
import { GitHubCoreReadError, readGitHubJson, type GitHubFetcher } from "./github-http";

export const CORE_REPOSITORY_INDEX_FILE = "core.index.json";
export const CoreRepositoryIndexSchema = z.object({
  indexVersion: z.literal(1),
  cores: z.array(z.object({ id: CoreIdSchema, manifest: CorePackagePathSchema }).strict()).min(1).max(20)
}).strict().superRefine((index, context) => {
  const ids = new Set<string>(), files = new Set<string>();
  index.cores.forEach((core, position) => {
    if (ids.has(core.id) || files.has(core.manifest)) context.addIssue({ code: "custom", path: ["cores", position], message: "Core标识或清单路径重复" });
    ids.add(core.id);
    files.add(core.manifest);
  });
});
export type CoreRepositoryIndex = z.infer<typeof CoreRepositoryIndexSchema>;

export interface GitHubRepositoryCore {
  manifestFile: string;
  manifest?: CoreManifest;
  releaseSelection?: GitHubCoreReleaseSelection;
  release?: GitHubCoreReleasePin;
  state: "metadata_only" | "release_available" | "source_only" | "invalid" | "unavailable";
  review: "unreviewed";
  package: "unchecked";
  issues: Array<{ code: string; field?: string; message: string; retryAfterSeconds?: number }>;
}
export interface GitHubCoreRepositoryInspection {
  repository: string;
  commit: string;
  checkedAt: string;
  state: "identified" | "no_manifest" | "invalid" | "partial";
  cores: GitHubRepositoryCore[];
}

const fileLimit = 256 * 1024;
const contentSchema = z.object({
  type: z.literal("file"), path: z.string(), encoding: z.literal("base64"),
  size: z.number().int().nonnegative().max(fileLimit), sha: CoreSourceSchema.shape.commit, content: z.string().max(2 * fileLimit)
});

async function readRepositoryFile(repoPath: string, file: string, commit: string, fetcher: GitHubFetcher): Promise<unknown | undefined> {
  const safeFile = CorePackagePathSchema.parse(file);
  const path = `${repoPath}/contents/${safeFile.split("/").map(encodeURIComponent).join("/")}?ref=${commit}`;
  let response: unknown;
  try {
    response = await readGitHubJson(path, fetcher);
  } catch (error) {
    if (error instanceof GitHubCoreReadError && error.status === 404) return undefined;
    throw error;
  }
  const content = contentSchema.parse(response);
  if (content.path !== safeFile) throw new GitHubCoreReadError("response_invalid", "GitHub文件路径与选定清单不同");
  const encoded = content.content.replace(/[\r\n]/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded))
    throw new GitHubCoreReadError("response_invalid", "GitHub清单编码不符合Contents合同");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== content.size || bytes.toString("base64") !== encoded)
    throw new GitHubCoreReadError("response_invalid", "GitHub清单长度或编码与固定资料不同");
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== content.sha) throw new GitHubCoreReadError("response_invalid", "GitHub清单与固定blob摘要不同");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new GitHubCoreReadError("response_invalid", "Core仓库清单必须为UTF-8 JSON");
  }
}

/** includeReleases由管理者按需选择，默认仅取得固定仓库清单，减小发现请求量。 */
export async function inspectGitHubCoreRepository(repositoryInput: string, options: { includeReleases?: boolean } = {},
  fetcher: GitHubFetcher = fetch): Promise<GitHubCoreRepositoryInspection> {
  const repository = GitHubCoreRepositorySchema.parse(repositoryInput);
  const repoPath = `/repos/${repository.slice("https://github.com/".length)}`;
  const metadata = z.object({ private: z.literal(false), archived: z.literal(false), default_branch: z.string().min(1).max(240) })
    .parse(await readGitHubJson(repoPath, fetcher));
  const commit = z.object({ sha: CoreSourceSchema.shape.commit })
    .parse(await readGitHubJson(`${repoPath}/commits/${encodeURIComponent(metadata.default_branch)}`, fetcher)).sha;
  const result: GitHubCoreRepositoryInspection = { repository, commit, checkedAt: new Date().toISOString(), state: "identified", cores: [] };
  const indexValue = await readRepositoryFile(repoPath, CORE_REPOSITORY_INDEX_FILE, commit, fetcher);
  const parsedIndex = indexValue === undefined ? undefined : CoreRepositoryIndexSchema.safeParse(indexValue);
  if (parsedIndex && !parsedIndex.success) {
    result.state = "invalid";
    result.cores.push({ manifestFile: CORE_REPOSITORY_INDEX_FILE, state: "invalid", review: "unreviewed", package: "unchecked",
      issues: parsedIndex.error.issues.map(issue => ({ code: "index_invalid", field: issue.path.join("."), message: issue.message })) });
    return result;
  }
  const declarations = parsedIndex?.success ? parsedIndex.data.cores : [{ id: undefined, manifest: CORE_MANIFEST_FILE }];
  for (const declaration of declarations) {
    const core: GitHubRepositoryCore = { manifestFile: declaration.manifest, state: "metadata_only", review: "unreviewed", package: "unchecked", issues: [] };
    result.cores.push(core);
    let value: unknown;
    try {
      value = await readRepositoryFile(repoPath, declaration.manifest, commit, fetcher);
    } catch (error) {
      if (!(error instanceof GitHubCoreReadError)) throw error;
      core.state = "unavailable";
      core.issues.push({ code: error.code, message: error.message,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
      continue;
    }
    if (value === undefined) {
      if (!parsedIndex) result.state = "no_manifest";
      core.state = "invalid";
      core.issues.push({ code: "manifest_missing", message: "固定提交缺少声明的Core清单" });
      continue;
    }
    const parsed = CoreManifestSchema.safeParse(value);
    if (!parsed.success) {
      core.state = "invalid";
      core.issues = parsed.error.issues.map(issue => ({ code: "manifest_invalid", field: issue.path.join("."), message: issue.message }));
      continue;
    }
    const manifest = parsed.data;
    if (declaration.id && manifest.id !== declaration.id || manifest.source.repository.replace(/\.git$/u, "") !== repository) {
      core.state = "invalid";
      core.issues.push({ code: "manifest_identity", message: "清单Core身份或来源与选定仓库索引不一致" });
      continue;
    }
    core.manifest = manifest;
    core.releaseSelection = { repository, coreId: manifest.id, version: manifest.version,
      tag: parsedIndex ? `${manifest.id}/v${manifest.version}` : `v${manifest.version}` };
    if (!options.includeReleases) continue;
    try {
      const release = await inspectGitHubCoreRelease(core.releaseSelection, fetcher);
      if (release.commit !== manifest.source.commit) throw new GitHubCoreReadError("release_changed", "Core清单来源提交与选定Release不同");
      core.release = release;
      core.state = "release_available";
    } catch (error) {
      if (error instanceof GitHubCoreReadError && error.status === 404) {
        core.state = "source_only";
      } else if (error instanceof GitHubCoreReadError) {
        core.state = "unavailable";
        core.issues.push({ code: error.code, message: error.message,
          ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}) });
      } else {
        throw error;
      }
    }
  }
  if (result.state === "identified") {
    const valid = result.cores.filter(core => core.manifest !== undefined).length;
    result.state = valid === result.cores.length ? "identified" : valid ? "partial" : "invalid";
  }
  return result;
}
