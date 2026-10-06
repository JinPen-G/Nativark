import type { AiExecutionContext, AiKnowledgeSourceDraft, AiKnowledgeChunkDraft } from '@rental-os/shared';
import type { KnowledgeContentPort } from './knowledge.ports';
import { KnowledgeCache } from './knowledge-cache';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { requiredPort, unavailable } from './knowledge-errors';
import { authorize, sameScope, validateChunks, visible, fingerprint, parse, documentSourceSchema, factSchema } from './knowledge-validation';

export class KnowledgeSourceService {
  constructor(private readonly documents: KnowledgeDocumentService, private readonly content: KnowledgeContentPort, private readonly cache?: KnowledgeCache) {
    requiredPort(content, ['chunk', 'downloadReference', 'factReference']);
  }

  async readChunk(context: AiExecutionContext, source: Extract<AiKnowledgeSourceDraft, { kind: 'document' }>, action: 'snippet' | 'resolve_source' = 'snippet'): Promise<AiKnowledgeChunkDraft> {
    try {
      source = parse(documentSourceSchema, source);
      if (!sameScope(context.scope, source.scope)) unavailable();
      const before = await this.documents.load(context, source.documentId, action);
      const d = before.document;
      if (!visible(d, this.documents.ports.clock.now()) || d.documentVersion !== source.documentVersion || d.aclRevision !== source.aclRevision) unavailable();
      const grant = await authorize(this.documents.ports.authorization, context, { action: 'read_body', scope: context.scope, document: d });
      const cacheKey = this.cache?.key(grant, source, before.revision);
      const cached = cacheKey ? this.cache?.get(cacheKey) : undefined;
      const chunk = cached ?? await this.content.chunk(context, source, 2000);
      if (!chunk || chunk.chunkId !== source.chunkId) unavailable();
      validateChunks(d, [chunk]);
      if (fingerprint(chunk.locator) !== fingerprint(source.locator)) unavailable();
      const after = await this.documents.load(context, source.documentId, action);
      if (before.revision !== after.revision || !visible(after.document, this.documents.ports.clock.now())) unavailable();
      const currentGrant = await authorize(this.documents.ports.authorization, context, { action: 'read_body', scope: context.scope, document: after.document });
      if (fingerprint(grant) !== fingerprint(currentGrant)) unavailable();
      if (cacheKey && !cached) this.cache?.put(cacheKey, chunk);
      return chunk;
    } catch { return unavailable(); }
  }

  async resolve(context: AiExecutionContext, source: AiKnowledgeSourceDraft): Promise<AiKnowledgeSourceDraft> {
    try {
      if (source.kind === 'business_fact') {
        source = { kind: 'business_fact', fact: parse(factSchema, source.fact) };
        await authorize(this.documents.ports.authorization, context, { action: 'resolve_source', scope: source.fact.scope, fact: source.fact });
        const fact = await this.content.factReference(context, source.fact);
        if (!fact || fingerprint(fact) !== fingerprint(source.fact)) unavailable();
        await authorize(this.documents.ports.authorization, context, { action: 'resolve_source', scope: fact.scope, fact });
        return { kind: 'business_fact', fact };
      }
      const chunk = await this.readChunk(context, source, 'resolve_source');
      return { kind: 'document', documentId: chunk.documentId, documentVersion: chunk.documentVersion, chunkId: chunk.chunkId, scope: chunk.scope, aclRevision: chunk.aclRevision, locator: chunk.locator };
    } catch { return unavailable(); }
  }

  async download(context: AiExecutionContext, source: Extract<AiKnowledgeSourceDraft, { kind: 'document' }>): Promise<{ attachmentId: string; documentVersion: string }> {
    try {
      await this.readChunk(context, source, 'resolve_source');
      const before = await this.documents.load(context, source.documentId, 'download');
      if (!visible(before.document, this.documents.ports.clock.now()) || before.document.documentVersion !== source.documentVersion || before.document.aclRevision !== source.aclRevision) unavailable();
      const grant = await authorize(this.documents.ports.authorization, context, { action: 'download', scope: context.scope, document: before.document });
      const reference = await this.content.downloadReference(context, before.document);
      if (!reference || reference.attachmentId !== before.document.attachmentId || reference.documentVersion !== source.documentVersion) unavailable();
      const after = await this.documents.load(context, source.documentId, 'download');
      if (before.revision !== after.revision || !visible(after.document, this.documents.ports.clock.now())) unavailable();
      const currentGrant = await authorize(this.documents.ports.authorization, context, { action: 'download', scope: context.scope, document: after.document });
      if (fingerprint(grant) !== fingerprint(currentGrant)) unavailable();
      return { attachmentId: reference.attachmentId, documentVersion: reference.documentVersion };
    } catch { return unavailable(); }
  }
}
