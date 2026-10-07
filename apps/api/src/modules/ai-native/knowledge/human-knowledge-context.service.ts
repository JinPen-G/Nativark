import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { AiKnowledgeSourceDraft } from '@rental-os/shared';
import { HumanKnowledgeService, type HumanKnowledgeDependencies } from './human-knowledge.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSourceService } from './knowledge-source.service';
import { PrismaKnowledgeReadAdapter } from './prisma-knowledge-read.adapter';
import { PrismaKnowledgeSelectionAdapter } from './prisma-knowledge-selection.adapter';
import { KnowledgeError, unavailable } from './knowledge-errors';
import { documentSourceSchema, fingerprint, id, parse } from './knowledge-validation';
import { KnowledgeCitationSession } from './knowledge-citation-session';

type Source = Extract<AiKnowledgeSourceDraft, { kind: 'document' }>;
export const knowledgeContextInputSchema = z.object({ requestId: id, query: z.string().trim().min(1).max(1000),
  maxSources: z.number().int().min(1).max(10), maxSnippetChars: z.number().int().min(1).max(2000),
  maxTotalBytes: z.number().int().min(1024).max(65536) }).strict();
const sectionSemantics = { knowledge: 'authorized_sources' as const,
  preferences: 'optional_confirmed_preferences' as const, businessFacts: 'core_authoritative_only' as const };
const clip = (text: string, limit: number) => {
  let out = text.slice(0, limit);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out;
};
type Entry = { sourceId: string; source: Source; snippet: string; contentFingerprint: string;
  snippetFingerprint: string; truncated: boolean; trust: 'untrusted_data' };

/** Input preparation only: no model call, invocation registration, step hash,
 * URL fetch or authorization encoded in the model-visible content.
 */
export class HumanKnowledgeContextService {
  private readonly human: HumanKnowledgeService;
  private readonly sources: KnowledgeSourceService;
  private readonly retrieval: KnowledgeRetrievalService;
  constructor(ports: HumanKnowledgeDependencies) {
    this.human = new HumanKnowledgeService(ports);
    const reads = new PrismaKnowledgeReadAdapter(ports.db, this.human.repository, this.human.authorization, ports.clock);
    this.sources = new KnowledgeSourceService(this.human.documents, reads);
    const selection = new PrismaKnowledgeSelectionAdapter(ports.db, this.human.repository, this.human.authorization);
    this.retrieval = new KnowledgeRetrievalService(this.human.documents, this.sources, selection, reads);
  }

  collect(value: unknown) {
    const input = parse(knowledgeContextInputSchema, value);
    return this.human.session.run(async context => {
      const now = this.human.ports.clock.now();
      if (!Number.isFinite(now)) return unavailable();
      const base = { requestId: input.requestId, observationId: randomUUID(), queryFingerprint: fingerprint(input.query), observedAt: new Date(now).toISOString(),
        trust: 'untrusted_data' as const, purpose: 'context_only' as const, sections: sectionSemantics };
      const recall = await this.retrieval.recall(context, { requestId: input.requestId, query: input.query, limit: input.maxSources });
      if (recall.status !== 'ready') return { ...base, status: recall.status, ...('reason' in recall ? { reason: recall.reason } : {}),
        ...('nextAction' in recall ? { nextAction: recall.nextAction } : {}), sources: [] as Entry[] };
      const entries: Entry[] = [];
      let limited = false;
      for (const match of recall.matches) {
        const source = parse(documentSourceSchema, match.source);
        // Existing recall and source ports read bounded chunks (<=2000 chars),
        // never accept an arbitrary URL or allocate an unbounded whole file.
        const chunk = await this.sources.readChunk(context, source);
        if (chunk.text !== match.excerpt) return unavailable();
        const snippet = clip(chunk.text, input.maxSnippetChars);
        if (!snippet) { limited = true; continue; }
        const entry: Entry = { sourceId: fingerprint(source), source, snippet, contentFingerprint: fingerprint(chunk.text),
          snippetFingerprint: fingerprint(snippet), truncated: snippet !== chunk.text, trust: 'untrusted_data' };
        const candidate = { ...base, status: 'partial', sources: [...entries, entry] };
        if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > input.maxTotalBytes) { limited = true; continue; }
        limited ||= entry.truncated;
        entries.push(entry);
      }
      // Resolve every included reference again after collection. A revision or
      // withdrawal cannot turn an earlier body into evidence for a newer source.
      for (const entry of entries) {
        const fresh = await this.sources.readChunk(context, entry.source, 'resolve_source');
        if (fingerprint(fresh.text) !== entry.contentFingerprint) return unavailable();
      }
      const result = { ...base, status: limited ? 'partial' as const : 'ready' as const, sources: entries };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > input.maxTotalBytes) throw new KnowledgeError('limit_exceeded');
      return result;
    });
  }

  open(source: unknown) {
    const input = parse(documentSourceSchema, source);
    return this.human.session.run(context => this.sources.readChunk(context, input, 'resolve_source'));
  }

  /** Server-only bound consumer. Do not deserialize a model-supplied package
   * into this handle: its immutable source set comes from actual collect.
   */
  async beginCitations(value: unknown): Promise<KnowledgeCitationSession> {
    const context = await this.human.session.current();
    const collected = await this.collect(value);
    await this.human.session.check(context);
    if (collected.status !== 'ready' && collected.status !== 'partial') throw new KnowledgeError('not_ready');
    return new KnowledgeCitationSession(collected, {
      check: () => this.human.session.check(context),
      verify: snapshot => this.revalidate(snapshot),
      read: source => this.open(source),
      recollect: input => this.beginCitations(input),
    });
  }

  /** A resource reference, never a bearer URL or a grant to the file service. */
  downloadReference(source: unknown) {
    const input = parse(documentSourceSchema, source);
    return this.human.session.run(context => this.sources.download(context, input));
  }

  /** Call immediately before freezing model input. This checks current sources,
   * not the truth of a caller's query or a permanent permission. Dispatch still
   * needs its own current authorization and configuration checks.
   */
  revalidate(value: unknown) {
    const entrySchema = z.object({ sourceId: z.string().regex(/^[a-f0-9]{64}$/), source: documentSourceSchema,
      snippet: z.string().min(1).max(2000), contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      snippetFingerprint: z.string().regex(/^[a-f0-9]{64}$/), truncated: z.boolean(), trust: z.literal('untrusted_data') }).strict();
    const input = parse(z.object({ requestId: id, observationId: id.optional(), queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      observedAt: z.string().datetime(), trust: z.literal('untrusted_data'), purpose: z.literal('context_only'),
      status: z.enum(['ready', 'partial']), sources: z.array(entrySchema).max(10),
      sections: z.object({ knowledge: z.literal('authorized_sources'), preferences: z.literal('optional_confirmed_preferences'), businessFacts: z.literal('core_authoritative_only') }).strict().optional() }).strict(), value);
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 65536) throw new KnowledgeError('limit_exceeded');
    return this.human.session.run(async context => {
      const seen = new Set<string>();
      for (const entry of input.sources) {
        if (seen.has(entry.sourceId) || entry.sourceId !== fingerprint(entry.source)) return unavailable();
        seen.add(entry.sourceId);
        const fresh = await this.sources.readChunk(context, entry.source, 'resolve_source');
        if (fingerprint(fresh.text) !== entry.contentFingerprint || fingerprint(entry.snippet) !== entry.snippetFingerprint
          || clip(fresh.text, entry.snippet.length) !== entry.snippet
          || entry.truncated !== (fresh.text !== entry.snippet)) return unavailable();
      }
      return { ...input, sections: input.sections ?? sectionSemantics };
    });
  }
}
