import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeAuthorizationPort, KnowledgeIndexPort } from './knowledge.ports';
import { KnowledgeCommitUnknownError, KnowledgeError, requiredPort, unavailable } from './knowledge-errors';
import { authorize, fingerprint, knowledgeRecordSchema, parsePersisted, sameScope, scopeSchema } from './knowledge-validation';

/** Durable generation receipt for relational lexical retrieval. There is no
 * external/vector index: the head's indexed/version/ACL state gates SQL recall.
 * apply records readiness for the exact queued job; the existing coordinator
 * commits completion separately and must still win its own revision CAS.
 */
export class PrismaKnowledgeIndexAdapter implements KnowledgeIndexPort {
  constructor(private readonly db: Pick<PrismaClient, '$transaction' | 'aiKnowledgeDocument' | 'aiKnowledgeOperation' | 'aiKnowledgeVersion' | 'aiKnowledgeChunk'>,
    private readonly authorization: KnowledgeAuthorizationPort) {
    requiredPort(db, ['$transaction']); requiredPort(authorization, ['authorize']);
    requiredPort(db?.aiKnowledgeDocument, ['findFirst']); requiredPort(db?.aiKnowledgeOperation, ['findFirst', 'create']);
    requiredPort(db?.aiKnowledgeVersion, ['findFirst']); requiredPort(db?.aiKnowledgeChunk, ['findFirst']);
  }

  async apply(context: AiExecutionContext, value: Parameters<KnowledgeIndexPort['apply']>[1]): Promise<void> {
    context = structuredClone(context); value = structuredClone(value);
    const scope = scopeSchema.safeParse(value.scope);
    if (!scope.success || scope.data.kind !== 'workspace' || !sameScope(context.scope, scope.data)) return unavailable();
    const selected = scope.data, jobHash = fingerprint(['relational-lexical-v1', value]);
    const operationId = `lexical-index-${fingerprint(value.job.operationId)}`;
    const receiptWhere = { tenantId: selected.tenantId, workspaceId: selected.workspaceId, documentId: value.documentId, operationId };
    await authorize(this.authorization, context, { action: 'index', scope: value.scope });
    let writeAttempted = false, callbackCompleted = false;
    try {
      await this.db.$transaction(async tx => {
        const row = await tx.aiKnowledgeDocument.findFirst({ where: { id: value.documentId, tenantId: selected.tenantId, workspaceId: selected.workspaceId } });
        if (!row) return unavailable();
        const head = parsePersisted(knowledgeRecordSchema, row.state);
        if (row.id !== value.documentId || row.tenantId !== selected.tenantId || row.workspaceId !== selected.workspaceId
          || row.revision !== head.revision || row.status !== head.document.publication || !sameScope(head.document.scope, value.scope)
          || head.document.documentId !== value.documentId || !head.indexJob
          || fingerprint(head.indexJob) !== fingerprint(value.job) || value.job.status !== 'pending'
          || head.document.documentVersion !== value.job.documentVersion || head.document.aclRevision !== value.job.aclRevision) throw new KnowledgeError('conflict');
        if (value.job.kind === 'upsert') {
          if (head.document.parsing !== 'parsed' || head.document.publication === 'deleted' || head.document.publication === 'withdrawn') throw new KnowledgeError('conflict');
          const version = await tx.aiKnowledgeVersion.findFirst({ where: { documentId: value.documentId, contentHash: value.job.documentVersion } });
          if (!version || !await tx.aiKnowledgeChunk.findFirst({ where: { versionId: version.id } })) return unavailable();
        }
        const grant = await authorize(this.authorization, context, { action: 'index', scope: value.scope, document: head.document });
        const receipt = await tx.aiKnowledgeOperation.findFirst({ where: receiptWhere });
        if (receipt) {
          if (receipt.fingerprint !== jobHash || receipt.tenantId !== selected.tenantId || receipt.workspaceId !== selected.workspaceId
            || receipt.documentId !== value.documentId || receipt.operationId !== operationId) throw new KnowledgeError('conflict');
          callbackCompleted = true;
          return;
        }
        const current = await authorize(this.authorization, context, { action: 'index', scope: value.scope, document: head.document });
        if (fingerprint(grant) !== fingerprint(current)) return unavailable();
        writeAttempted = true;
        await tx.aiKnowledgeOperation.create({ data: { id: randomUUID(), ...receiptWhere, fingerprint: jobHash } });
        callbackCompleted = true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof KnowledgeError) throw error;
      if (writeAttempted || callbackCompleted) throw new KnowledgeCommitUnknownError();
      return unavailable();
    }
  }
}
