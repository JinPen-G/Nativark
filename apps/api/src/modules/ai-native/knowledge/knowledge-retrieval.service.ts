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
      const selected = await this.selection.select(context);
      if (!selected || fingerprint(selected.grant) !== fingerprint(grant)) unavailable();
      const constraints = parse(constraintsSchema, selected.documents);
      const ready: KnowledgeDocumentConstraint[] = [];
      let blocked: 'parsing' | 'not_indexed' | 'parse_failed' | 'index_failed' | undefined;
      for (const ref of constraints) {
        const { document: d } = await this.documents.load(context, ref.documentId, 'search');
        if (d.documentVersion !== ref.documentVersion || d.aclRevision !== ref.aclRevision) unavailable();
        if (d.publication === 'withdrawn' || d.publication === 'deleted' || Date.parse(d.validFrom) > this.documents.ports.clock.now() || (d.validUntil && Date.parse(d.validUntil) <= this.documents.ports.clock.now())) continue;
        if (visible(d, this.documents.ports.clock.now())) ready.push(ref);
        else if (d.parsing === 'failed' || d.parsing === 'rejected') blocked = 'parse_failed';
        else if (d.indexing === 'failed') blocked = 'index_failed';
        else if (d.parsing === 'pending') blocked ??= 'parsing';
        else blocked ??= 'not_indexed';
      }
      if (!ready.length) {
        const current = await authorize(this.documents.ports.authorization, context, { action: 'search', scope: context.scope });
        if (fingerprint(current) !== fingerprint(grant)) unavailable();
        if (blocked === 'parse_failed' || blocked === 'index_failed') return { ...base, status: 'failed', reason: blocked };
        if (blocked) return { ...base, status: 'not_ready', reason: blocked };
        return { ...base, status: 'no_results' };
      }
      const candidates = await this.search.search({ grant, documents: ready, query: input.query, limit: input.limit });
      if (!Array.isArray(candidates) || candidates.length > input.limit) unavailable();
      const matches: Array<{ source: AiKnowledgeSourceDraft; excerpt: string; trust: 'untrusted_data' }> = [];
      let chars = 0; const seen = new Set<string>();
      for (const source of candidates) {
        if (source.kind !== 'document' || !sameScope(source.scope, context.scope) || !ready.some(ref => ref.documentId === source.documentId && ref.documentVersion === source.documentVersion && ref.aclRevision === source.aclRevision)) unavailable();
        const chunk = await this.sources.readChunk(context, source);
        const marker = fingerprint([chunk.documentId, chunk.documentVersion, chunk.chunkId]);
        if (seen.has(marker)) continue;
        seen.add(marker); chars += chunk.text.length;
        if (chars > 12000) unavailable();
        matches.push({ source: { kind: 'document', scope: chunk.scope, documentId: chunk.documentId, documentVersion: chunk.documentVersion, chunkId: chunk.chunkId, aclRevision: chunk.aclRevision, locator: chunk.locator }, excerpt: chunk.text, trust: 'untrusted_data' });
      }
      const currentGrant = await authorize(this.documents.ports.authorization, context, { action: 'search', scope: context.scope });
      if (fingerprint(currentGrant) !== fingerprint(grant)) unavailable();
      for (const match of matches) await this.sources.resolve(context, match.source);
      return matches.length ? { ...base, status: 'ready', matches } : { ...base, status: 'no_results' };
    } catch { return { ...base, status: 'unavailable', nextAction: 'reauthorize_or_manual' }; }
  }
}
