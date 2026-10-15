import type { AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeRecord, KnowledgeAuthorizationRequest } from './knowledge.ports';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgeError } from './knowledge-errors';
import { mutationInput, operationFingerprint, parse, queueIndex } from './knowledge-validation';

export class KnowledgePublicationService {
  constructor(private readonly documents: KnowledgeDocumentService) {}
  publish(context: AiExecutionContext, input: unknown) { return this.change(context, input, 'publish'); }
  withdraw(context: AiExecutionContext, input: unknown) { return this.change(context, input, 'withdraw'); }
  delete(context: AiExecutionContext, input: unknown) { return this.change(context, input, 'delete'); }

  private async change(context: AiExecutionContext, value: unknown, action: 'publish' | 'withdraw' | 'delete'): Promise<KnowledgeRecord> {
    const input = parse(mutationInput, value);
    const binding: Pick<KnowledgeAuthorizationRequest, 'lifecycle'> = action === 'delete' ? { lifecycle: { action: 'delete', command: input } } : {};
    const before = await this.documents.load(context, input.documentId, action, binding), hash = operationFingerprint(context, [action, input]);
    if (await this.documents.replay(context, before, input.operationId, hash)) return before;
    if (before.revision !== input.expectedRevision || before.document.publication === 'deleted') throw new KnowledgeError('conflict');
    const d = before.document, now = this.documents.ports.clock.now();
    if (action === 'publish' && (d.parsing !== 'parsed' || d.indexing !== 'indexed' || (d.publication !== 'draft' && d.publication !== 'withdrawn') || (d.validUntil && Date.parse(d.validUntil) <= now))) throw new KnowledgeError('not_ready');
    if (action === 'withdraw' && d.publication !== 'published') throw new KnowledgeError('conflict');
    const next: KnowledgeRecord = { ...before, revision: before.revision + 1, document: { ...d,
      // Keep the scoped/versioned tombstone and original operation receipt, not
      // potentially sensitive document text in a deleted management title.
      title: action === 'delete' ? '[已删除]' : d.title,
      indexing: action === 'publish' ? d.indexing : 'not_indexed', publication: action === 'publish' ? 'published' : action === 'withdraw' ? 'withdrawn' : 'deleted' } };
    return this.documents.save(context, action, before, queueIndex(next, action === 'publish' ? 'upsert' : 'remove', `${input.operationId}:index`), input.operationId, hash, false, binding);
  }
}
