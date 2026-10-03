import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeIndexJob, KnowledgeIndexPort, KnowledgeRecord } from './knowledge.ports';
import { KnowledgeDocumentService } from './knowledge-document.service';
import { KnowledgeError, requiredPort } from './knowledge-errors';
import { authorize, fingerprint, mutationInput, parse, queueIndex } from './knowledge-validation';

export class KnowledgeIndexCoordinator {
  constructor(private readonly documents: KnowledgeDocumentService, private readonly index: KnowledgeIndexPort) { requiredPort(index, ['apply']); }
  async request(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(mutationInput.extend({ kind: z.enum(['upsert', 'remove']) }).strict(), value);
    const before = await this.documents.load(context, input.documentId, 'index'), hash = fingerprint(['index', input]);
    if (await this.documents.replay(context, before, input.operationId, hash)) return before;
    if (before.revision !== input.expectedRevision) throw new KnowledgeError('conflict');
    if (input.kind === 'upsert' && (before.document.publication === 'deleted' || before.document.parsing !== 'parsed')) throw new KnowledgeError('not_ready');
    const next = queueIndex({ ...before, revision: before.revision + 1, document: { ...before.document, indexing: input.kind === 'upsert' ? 'indexing' : 'not_indexed' } }, input.kind, input.operationId);
    return this.documents.save(context, 'index', before, next, input.operationId, hash);
  }
  async runPending(context: AiExecutionContext, documentId: string): Promise<KnowledgeRecord> {
    const before = await this.documents.load(context, documentId, 'index'), job = before.indexJob;
    if (!job) throw new KnowledgeError('not_ready');
    if (job.status !== 'pending') return before;
    if (job.kind === 'upsert' && (before.document.publication === 'deleted' || before.document.parsing !== 'parsed' || before.document.documentVersion !== job.documentVersion || before.document.aclRevision !== job.aclRevision)) throw new KnowledgeError('conflict');
    let status: 'completed' | 'failed' = 'completed';
    try { await this.index.apply(context, { scope: context.scope, documentId, job: structuredClone(job) }); } catch { status = 'failed'; }
    return this.complete(context, documentId, job, status);
  }
  async complete(context: AiExecutionContext, documentId: string, job: KnowledgeIndexJob, status: 'completed' | 'failed'): Promise<KnowledgeRecord> {
    const before = await this.documents.load(context, documentId, 'index'), active = before.indexJob;
    if (!active || fingerprint({ ...active, status: 'pending' }) !== fingerprint({ ...job, status: 'pending' }) || before.document.documentVersion !== job.documentVersion || before.document.aclRevision !== job.aclRevision || (job.kind === 'upsert' && before.document.publication === 'deleted')) throw new KnowledgeError('conflict');
    if (active.status !== 'pending') {
      if (active.status !== status) throw new KnowledgeError('conflict');
      return before;
    }
    const { failure, ...clean } = before;
    const next: KnowledgeRecord = { ...clean, revision: before.revision + 1, indexJob: { ...active, status }, document: { ...before.document, indexing: status === 'failed' ? 'failed' : job.kind === 'upsert' ? 'indexed' : 'not_indexed' }, ...(status === 'failed' ? { failure: 'index_failed' as const } : {}) };
    return this.documents.save(context, 'index', before, next, `${job.operationId}:index-result`, fingerprint(['index-result', job, status]));
  }
  async changeAcl(context: AiExecutionContext, value: unknown): Promise<KnowledgeRecord> {
    const input = parse(mutationInput.extend({ aclRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict(), value);
    const before = await this.documents.load(context, input.documentId, 'change_acl'), hash = fingerprint(['acl', input]);
    if (await this.documents.replay(context, before, input.operationId, hash)) return before;
    if (before.revision !== input.expectedRevision || input.aclRevision <= before.document.aclRevision || before.document.publication === 'deleted') throw new KnowledgeError('conflict');
    await authorize(this.documents.ports.authorization, context, { action: 'change_acl', scope: context.scope, document: before.document, aclRevision: input.aclRevision });
    const next = queueIndex({ ...before, revision: before.revision + 1, document: { ...before.document, aclRevision: input.aclRevision, indexing: 'not_indexed' } }, 'remove', `${input.operationId}:index`);
    return this.documents.save(context, 'change_acl', before, next, input.operationId, hash);
  }
}
