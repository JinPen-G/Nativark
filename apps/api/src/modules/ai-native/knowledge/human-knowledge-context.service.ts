import { z } from 'zod';
import type { AiKnowledgeSourceDraft } from '@rental-os/shared';
import { HumanKnowledgeService, type HumanKnowledgeDependencies } from './human-knowledge.service';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service';
import { KnowledgeSourceService } from './knowledge-source.service';
import { PrismaKnowledgeReadAdapter } from './prisma-knowledge-read.adapter';
import { PrismaKnowledgeSelectionAdapter } from './prisma-knowledge-selection.adapter';
import { KnowledgeError, unavailable } from './knowledge-errors';
import { documentSourceSchema, fingerprint, id, parse } from './knowledge-validation';

type Source = Extract<AiKnowledgeSourceDraft, { kind: 'document' }>;
const inputSchema = z.object({ requestId: id, query: z.string().trim().min(1).max(1000),
  maxSources: z.number().int().min(1).max(10), maxSnippetChars: z.number().int().min(1).max(2000),
  maxTotalBytes: z.number().int().min(1024).max(65536) }).strict();
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
    const input = parse(inputSchema, value);
    return this.human.session.run(async context => {
      const now = this.human.ports.clock.now();
      if (!Number.isFinite(now)) return unavailable();
      const base = { requestId: input.requestId, queryFingerprint: fingerprint(input.query), observedAt: new Date(now).toISOString(),
        trust: 'untrusted_data' as const, purpose: 'context_only' as const };
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
}
