import { z } from 'zod';
import type { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { KnowledgeError, unavailable } from './knowledge-errors';
import { fingerprint, parse } from './knowledge-validation';

type Collected = Extract<Awaited<ReturnType<HumanKnowledgeContextService['collect']>>, { status: 'ready' | 'partial' }>;
type Source = Collected['sources'][number]['source'];
const sourceIds = z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(10);

/** Bounded ephemeral SERVER handle, not a public DTO, durable consent, cache or
 * permission token. Recreate by collecting after process restart. No global map.
 * Membership in this set says nothing about the truth of the model's answer.
 */
export class KnowledgeCitationSession {
  private readonly snapshot: Collected;
  constructor(snapshot: Collected, private readonly ports: {
    check(): Promise<void>;
    verify(value: unknown): Promise<unknown>;
    read(source: Source): ReturnType<HumanKnowledgeContextService['open']>;
    recollect(input: unknown): Promise<KnowledgeCitationSession>;
  }) { this.snapshot = structuredClone(snapshot); }

  private async verify() {
    await this.ports.check();
    await this.ports.verify(structuredClone(this.snapshot));
    await this.ports.check();
  }
  private selected(value: unknown) {
    const ids = parse(sourceIds, value);
    if (new Set(ids).size !== ids.length) throw new KnowledgeError('invalid_input');
    return ids.map(id => {
      const entry = this.snapshot.sources.find(source => source.sourceId === id);
      if (!entry) return unavailable();
      return entry;
    });
  }
  private manifestEntry(entry: Collected['sources'][number]) {
    return { sourceId: entry.sourceId, documentId: entry.source.documentId,
      documentVersion: entry.source.documentVersion, chunkId: entry.source.chunkId,
      locator: structuredClone(entry.source.locator), truncated: entry.truncated,
      contentFingerprint: entry.contentFingerprint };
  }
  async manifest() {
    await this.verify();
    return { observationId: this.snapshot.observationId, packageFingerprint: fingerprint(this.snapshot),
      sources: this.snapshot.sources.map(entry => this.manifestEntry(entry)),
      semantics: 'source_membership_not_answer_verification' as const };
  }
  async resolve(value: unknown) {
    const entries = this.selected(value);
    await this.verify();
    return entries.map(entry => this.manifestEntry(entry));
  }
  async openMany(value: unknown) {
    const input = parse(z.object({ sourceIds, maxSnippetChars: z.number().int().min(1).max(2000),
      maxTotalBytes: z.number().int().min(1024).max(65536) }).strict(), value);
    const entries = this.selected(input.sourceIds);
    await this.verify();
    const items = [];
    for (const entry of entries) {
      const chunk = await this.ports.read(structuredClone(entry.source));
      await this.ports.check();
      if (fingerprint(chunk.text) !== entry.contentFingerprint) return unavailable();
      let snippet = chunk.text.slice(0, input.maxSnippetChars);
      if (/[\uD800-\uDBFF]$/.test(snippet)) snippet = snippet.slice(0, -1);
      const item = { ...this.manifestEntry(entry), snippet, snippetFingerprint: fingerprint(snippet),
        truncated: snippet !== chunk.text, trust: 'untrusted_data' as const };
      const candidate = { items: [...items, item], trust: 'untrusted_data' as const };
      if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > input.maxTotalBytes) throw new KnowledgeError('limit_exceeded');
      items.push(item);
    }
    await this.verify();
    return { items, trust: 'untrusted_data' as const };
  }
  async recollect(input: unknown) {
    // Old sources may be invalid: check the current principal, not the old
    // content, before collecting a new independent observation.
    await this.ports.check();
    const fresh = await this.ports.recollect(input);
    await this.ports.check();
    return fresh;
  }
}
