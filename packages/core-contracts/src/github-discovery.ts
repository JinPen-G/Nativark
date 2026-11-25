/**
 * GitHub Topic的有限分页发现与短期缓存；返回仓库候选，不推断Core身份、审核或可安装性。
 * 离线/限流可附带原查询快照，保留其原时间并明确过期；不触碰已安装组合。
 */
import { z } from "zod";
import { GitHubCoreReadError, readGitHubJson, type GitHubFetcher } from "./github-http";

export const GitHubCoreDiscoveryQuerySchema = z.object({
  text: z.string().trim().max(80).regex(/^[\p{L}\p{N} _.-]*$(?![\s\S])/u, "搜索只填写名称或简介关键词，不传GitHub查询表达式").default(""),
  page: z.number().int().min(1).max(50).default(1)
}).strict();
const topic = "nativark-core", pageSize = 20, ttl = 5 * 60_000, maxCachedPages = 50;
const repositoryName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$(?![\s\S])/);
const responseSchema = z.object({
  total_count: z.number().int().nonnegative(), incomplete_results: z.boolean(),
  items: z.array(z.object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), full_name: repositoryName,
    description: z.string().nullable(), private: z.literal(false), archived: z.literal(false),
    updated_at: z.string().datetime(), topics: z.array(z.string()),
    license: z.object({ spdx_id: z.string() }).nullable()
  })).max(pageSize)
});

export interface GitHubCoreDiscoveryPage {
  topic: "nativark-core";
  query: z.infer<typeof GitHubCoreDiscoveryQuerySchema>;
  pageSize: 20;
  checkedAt: string;
  total: number;
  incomplete: boolean;
  nextPage: number | null;
  repositories: Array<{
    id: number; name: string; repository: string; description: string | null;
    license: string | null; updatedAt: string; review: "unreviewed"; package: "unchecked";
  }>;
}
type DiscoveryFailure = { code: string; message: string; retryAfterSeconds?: number };
export type GitHubCoreDiscoveryResult =
  | { status: "fresh" | "cached"; page: GitHubCoreDiscoveryPage }
  | { status: "unavailable"; error: DiscoveryFailure; stale?: GitHubCoreDiscoveryPage };

/** 一个宿主发现入口复用一个实例；缓存只含公开元数据，可随进程退出丢弃。 */
export function createGitHubCoreDiscovery(fetcher: GitHubFetcher = fetch, now: () => number = Date.now) {
  const cache = new Map<string, { time: number; page: GitHubCoreDiscoveryPage }>();
  const pending = new Map<string, Promise<GitHubCoreDiscoveryResult>>();
  return async function discover(input: z.input<typeof GitHubCoreDiscoveryQuerySchema> = {}, refresh = false): Promise<GitHubCoreDiscoveryResult> {
    const query = GitHubCoreDiscoveryQuerySchema.parse(input), key = JSON.stringify(query);
    const existing = cache.get(key), clock = now();
    if (!refresh && existing && clock >= existing.time && clock - existing.time < ttl)
      return { status: "cached", page: structuredClone(existing.page) };
    const inFlight = pending.get(key);
    if (inFlight) return structuredClone(await inFlight);
    const operation = (async (): Promise<GitHubCoreDiscoveryResult> => {
      try {
        const terms = `topic:${topic} is:public archived:false${query.text ? ` ${query.text} in:name,description` : ""}`;
        const params = new URLSearchParams({ q: terms, sort: "updated", order: "desc", per_page: String(pageSize), page: String(query.page) });
        const parsed = responseSchema.safeParse(await readGitHubJson(`/search/repositories?${params}`, fetcher));
        if (!parsed.success) throw new GitHubCoreReadError("response_invalid", "GitHub发现资料格式不符，请稍后重新获取");
        const result = parsed.data;
        if (result.items.some(item => !item.topics.includes(topic)))
          throw new GitHubCoreReadError("response_invalid", "GitHub查询结果与指定Core标签不符");
        const time = now();
        const page: GitHubCoreDiscoveryPage = {
          topic, query, pageSize, checkedAt: new Date(time).toISOString(), total: result.total_count, incomplete: result.incomplete_results,
          nextPage: query.page * pageSize < Math.min(result.total_count, 1000) ? query.page + 1 : null,
          repositories: result.items.map(item => ({ id: item.id, name: item.full_name, repository: `https://github.com/${item.full_name}`,
            description: item.description, license: item.license?.spdx_id === "NOASSERTION" ? null : item.license?.spdx_id ?? null,
            updatedAt: item.updated_at, review: "unreviewed", package: "unchecked" }))
        };
        cache.delete(key);
        cache.set(key, { time, page });
        if (cache.size > maxCachedPages) cache.delete(cache.keys().next().value!);
        return { status: "fresh", page };
      } catch (error) {
        if (!(error instanceof GitHubCoreReadError)) throw error;
        return { status: "unavailable", error: { code: error.code, message: error.message, retryAfterSeconds: error.retryAfterSeconds },
          ...(existing ? { stale: existing.page } : {}) };
      }
    })();
    pending.set(key, operation);
    try { return structuredClone(await operation); }
    finally { pending.delete(key); }
  };
}
