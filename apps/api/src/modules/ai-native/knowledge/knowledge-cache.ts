import type { AiExecutionScope, AiKnowledgeChunkDraft } from '@rental-os/shared';
import type { KnowledgeClock, KnowledgeGrant } from './knowledge.ports';
import { KnowledgeError, requiredPort } from './knowledge-errors';
import { fingerprint, scopeKey } from './knowledge-validation';

/**
 * Process-local bounded chunk cache. Invalidation is per instance: there is
 * NO distributed propagation, so another instance may briefly serve a cached
 * chunk after a withdrawal. That is an explicit gap, not a completed
 * broadcast: every consumer must still re-verify the persisted document
 * state (publication, validity window, version/aclRevision) and the current
 * grant on each read — the retrieval and preparation paths already do — so a
 * stale entry never bypasses those checks.
 */
export class KnowledgeCache {
  private readonly entries = new Map<string, { chunk: AiKnowledgeChunkDraft; expires: number; bytes: number; documentKey: string }>();
  private bytes = 0;
  constructor(private readonly clock: KnowledgeClock, private readonly limits: { maxEntries: number; maxBytes: number; ttlMs: number }) {
    requiredPort(clock, ['now']);
    if (!limits || !Number.isSafeInteger(limits.maxEntries) || limits.maxEntries <= 0 || limits.maxEntries > 1000 || !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0 || limits.maxBytes > 16 * 1024 * 1024 || !Number.isSafeInteger(limits.ttlMs) || limits.ttlMs <= 0 || limits.ttlMs > 300000) throw new KnowledgeError('invalid_input');
    this.limits = { ...limits };
  }
  key(grant: KnowledgeGrant, source: { documentId: string; documentVersion: string; aclRevision: number; chunkId: string }, revision: number): string {
    return fingerprint([scopeKey(grant.scope), grant.actor, grant.audience, grant.accessKey, source.documentId, source.documentVersion, source.aclRevision, source.chunkId, revision]);
  }
  get(key: string): AiKnowledgeChunkDraft | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.clock.now()) { this.remove(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return structuredClone(entry.chunk);
  }
  put(key: string, chunk: AiKnowledgeChunkDraft): void {
    this.remove(key);
    for (const [k, v] of this.entries) if (v.expires <= this.clock.now()) this.remove(k);
    const copy = structuredClone(chunk), documentKey = JSON.stringify([scopeKey(chunk.scope), chunk.documentId]);
    const bytes = Buffer.byteLength(JSON.stringify(copy), 'utf8') + Buffer.byteLength(key + documentKey, 'utf8');
    if (bytes > this.limits.maxBytes) return;
    while (this.entries.size >= this.limits.maxEntries || this.bytes + bytes > this.limits.maxBytes) this.remove(this.entries.keys().next().value!);
    this.entries.set(key, { chunk: copy, documentKey, bytes, expires: this.clock.now() + this.limits.ttlMs }); this.bytes += bytes;
  }
  invalidate(scope: AiExecutionScope, documentId: string): void {
    const documentKey = JSON.stringify([scopeKey(scope), documentId]);
    for (const [key, value] of this.entries) if (value.documentKey === documentKey) this.remove(key);
  }
  stats() { return { entries: this.entries.size, bytes: this.bytes }; }
  private remove(key: string) { const e = this.entries.get(key); if (e) { this.bytes -= e.bytes; this.entries.delete(key); } }
}
