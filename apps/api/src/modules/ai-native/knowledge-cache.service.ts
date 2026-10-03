import { ModelGatewayError } from './model-gateway.ports';
import type { AiProfileScope } from './provider-profile.ports';
import type { KnowledgeChunk } from './knowledge.ports';
export interface AuthorizedKnowledgeSearch { authorize(scope: AiProfileScope, actorId: string): Promise<{ aclRevision: string }>; search(scope: AiProfileScope, actorId: string, query: string, limit: number): Promise<readonly KnowledgeChunk[]>; }
interface Entry { key: string; scopeKey: string; documentIds: readonly string[]; aclRevision: string; expiresAt: number; results: readonly KnowledgeChunk[]; }
/** Bounded lexical-result cache. Authorization and ACL revision are checked on every hit. */
export class KnowledgeCacheService {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly source: AuthorizedKnowledgeSearch, private readonly ttlMs = 30_000, private readonly maxEntries = 256) { if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new ModelGatewayError('CONFIG_INVALID'); }
  private key(scope: AiProfileScope, actorId: string, query: string, limit: number) { return JSON.stringify([scope.tenantId, scope.workspaceId, scope.kind, actorId, query, limit]); }
  async search(scope: AiProfileScope, actorId: string, query: string, limit: number) {
    if (!scope.tenantId || !scope.workspaceId || !actorId || !query || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new ModelGatewayError('INVALID_REQUEST');
    const key = this.key(scope, actorId, query, limit); const auth = await this.source.authorize(scope, actorId); const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now() && cached.aclRevision === auth.aclRevision) return { results: cached.results, source: 'cache' as const, lexical: true as const };
    if (cached) this.entries.delete(key);
    const results = await this.source.search(scope, actorId, query, limit); const documentIds = [...new Set(results.map(result => result.documentId))];
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { key, scopeKey: `${scope.tenantId}:${scope.workspaceId}`, documentIds, aclRevision: auth.aclRevision, expiresAt: Date.now() + this.ttlMs, results: results.slice(0, limit) });
    return { results: results.slice(0, limit), source: 'store' as const, lexical: true as const };
  }
  invalidateDocument(scope: AiProfileScope, documentId: string) { for (const [key, entry] of this.entries) if (entry.scopeKey === `${scope.tenantId}:${scope.workspaceId}` && entry.documentIds.includes(documentId)) this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
