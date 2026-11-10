import { performance } from 'node:perf_hooks';
import type { AiExecutionScope, AiKnowledgeChunkDraft } from '@rental-os/shared';
import type { KnowledgeClock, KnowledgeGrant } from './knowledge.ports';
import { KnowledgeError, requiredPort } from './knowledge-errors';
import { fingerprint, scopeKey } from './knowledge-validation';

/**
 * Process-local bounded chunk cache, not distributed invalidation. Consumers
 * still recheck persisted publication/version/ACL and current grants on every
 * read; a retained chunk never grants access after withdrawal or revocation.
 * One unreferenced expiry timer releases idle bodies too. Monotonic retention
 * bounds prevent a frozen/backward business clock from retaining them forever.
 */
export class KnowledgeCache {
  private readonly entries = new Map<string, { chunk: AiKnowledgeChunkDraft; expires: number; evictAt: number; bytes: number; documentKey: string }>();
  private bytes = 0;
  private expiryTimer?: ReturnType<typeof setTimeout>;
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
    if (entry.expires <= this.clock.now() || entry.evictAt <= performance.now()) {
      this.remove(key); this.scheduleExpiry(); return undefined;
    }
    this.entries.delete(key); this.entries.set(key, entry);
    return structuredClone(entry.chunk);
  }
  put(key: string, chunk: AiKnowledgeChunkDraft): void {
    this.remove(key);
    const now = this.clock.now(), monotonicNow = performance.now();
    for (const [k, v] of this.entries) if (v.expires <= now || v.evictAt <= monotonicNow) this.remove(k);
    const copy = structuredClone(chunk), documentKey = JSON.stringify([scopeKey(chunk.scope), chunk.documentId]);
    const bytes = Buffer.byteLength(JSON.stringify(copy), 'utf8') + Buffer.byteLength(key + documentKey, 'utf8');
    if (bytes > this.limits.maxBytes) { this.scheduleExpiry(); return; }
    while (this.entries.size >= this.limits.maxEntries || this.bytes + bytes > this.limits.maxBytes) this.remove(this.entries.keys().next().value!);
    this.entries.set(key, { chunk: copy, documentKey, bytes, expires: now + this.limits.ttlMs,
      evictAt: performance.now() + this.limits.ttlMs }); this.bytes += bytes;
    this.scheduleExpiry();
  }
  invalidate(scope: AiExecutionScope, documentId: string): void {
    const documentKey = JSON.stringify([scopeKey(scope), documentId]);
    for (const [key, value] of this.entries) if (value.documentKey === documentKey) this.remove(key);
    this.scheduleExpiry();
  }
  stats() { return { entries: this.entries.size, bytes: this.bytes }; }
  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (!this.entries.size) return;
    let next = Infinity;
    for (const value of this.entries.values()) next = Math.min(next, value.evictAt);
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      const now = performance.now();
      for (const [key, value] of this.entries) if (value.evictAt <= now) this.remove(key);
      this.scheduleExpiry();
    }, Math.max(1, Math.ceil(next - performance.now())));
    // Cache retention must not keep a request-only process or shutdown alive.
    this.expiryTimer.unref();
  }
  private remove(key: string) { const e = this.entries.get(key); if (e) { this.bytes -= e.bytes; this.entries.delete(key); } }
}
