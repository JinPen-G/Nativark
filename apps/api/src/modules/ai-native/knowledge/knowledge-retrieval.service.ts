import { z } from 'zod';
import { AI_KNOWLEDGE_DRAFT_VERSION, type AiExecutionContext, type AiKnowledgeRecallDraft, type AiKnowledgeSourceDraft } from '@rental-os/shared';
import type { KnowledgeSearchAuthorizationPort, KnowledgeSearchPort, KnowledgeDocumentConstraint } from './knowledge.ports';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgeSourceService } from './knowledge-source.service';
import { requiredPort, unavailable } from './knowledge-errors';
import { authorize, fingerprint, id, parse, sameScope, visible } from './knowledge-validation';

const inputSchema = z.object({ requestId: id, query: z.string().trim().min(1).max(1000), limit: z.number().int().min(1).max(20) }).strict();
const constraintsSchema = z.array(z.object({ documentId: id, documentVersion: id, aclRevision: z.number().int().positive() }).strict()).max(100);
export class KnowledgeRetrievalService {
  constructor(private readonly documents: KnowledgeDocumentService, private readonly sources: KnowledgeSourceService, private readonly selection: KnowledgeSearchAuthorizationPort, private readonly search: KnowledgeSearchPort) {
    requiredPort(selection, ['select']); requiredPort(search, ['search']);
  }
  async recall(context: AiExecutionContext, value: unknown): Promise<AiKnowledgeRecallDraft> {
    const input = parse(inputSchema, value), base = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, requestId: input.requestId };
    try {
      const grant = await authorize(this.documents.ports.authorization, context, { action: 'search', scope: context.scope });
      const matches: Array<{ source: AiKnowledgeSourceDraft; excerpt: string; trust: 'untrusted_data' }> = [];
      const seen = new Set<string>(), cursors = new Set<string>();
      let chars = 0, anyReady = false, after: string | undefined;
      let blocked: 'parsing' | 'not_indexed' | 'parse_failed' | 'index_failed' | undefined;
      do {
        const selected = await this.selection.select(context, after);
        if (!selected || fingerprint(selected.grant) !== fingerprint(grant)) unavailable();
        after = selected.nextAfter;
        if (after !== undefined) {
          if (!id.safeParse(after).success || cursors.has(after)) unavailable();
          cursors.add(after);
        }
        const constraints = parse(constraintsSchema, selected.documents);
        const ready: KnowledgeDocumentConstraint[] = [];
        for (const ref of constraints) {
          const { document } = await this.documents.load(context, ref.documentId, 'search');
          if (document.documentVersion !== ref.documentVersion || document.aclRevision !== ref.aclRevision) unavailable();
          const now = this.documents.ports.clock.now();
          if (document.publication === 'withdrawn' || document.publication === 'deleted' || Date.parse(document.validFrom) > now || (document.validUntil && Date.parse(document.validUntil) <= now)) continue;
          if (visible(document, now)) ready.push(ref);
          else if (document.parsing === 'failed' || document.parsing === 'rejected') blocked = 'parse_failed';
          else if (document.indexing === 'failed') blocked = 'index_failed';
          else blocked ??= document.parsing === 'pending' ? 'parsing' : 'not_indexed';
        }
        if (!ready.length) continue;
        anyReady = true;
        const remaining = input.limit - matches.length;
        const candidates = await this.search.search({ grant, documents: ready, query: input.query, limit: remaining });
        if (!Array.isArray(candidates) || candidates.length > remaining) unavailable();
        for (const source of candidates) {
          if (source.kind !== 'document' || !sameScope(source.scope, context.scope) || !ready.some(ref => ref.documentId === source.documentId && ref.documentVersion === source.documentVersion && ref.aclRevision === source.aclRevision)) unavailable();
          const chunk = await this.sources.readChunk(context, source);
          const marker = fingerprint([chunk.documentId, chunk.documentVersion, chunk.chunkId]);
          if (seen.has(marker)) continue;
          seen.add(marker); chars += chunk.text.length;
          if (chars > 12000) unavailable();
          matches.push({ source: { kind: 'document', scope: chunk.scope, documentId: chunk.documentId, documentVersion: chunk.documentVersion, chunkId: chunk.chunkId, aclRevision: chunk.aclRevision, locator: chunk.locator }, excerpt: chunk.text, trust: 'untrusted_data' });
        }
      } while (after && matches.length < input.limit);
      const currentGrant = await authorize(this.documents.ports.authorization, context, { action: 'search', scope: context.scope });
      if (fingerprint(currentGrant) !== fingerprint(grant)) unavailable();
      if (!anyReady && blocked) {
        if (blocked === 'parse_failed' || blocked === 'index_failed') return { ...base, status: 'failed', reason: blocked };
        return { ...base, status: 'not_ready', reason: blocked };
      }
      for (const match of matches) await this.sources.resolve(context, match.source);
      return matches.length ? { ...base, status: 'ready', matches } : { ...base, status: 'no_results' };
    } catch { return { ...base, status: 'unavailable', nextAction: 'reauthorize_or_manual' }; }
  }
}
