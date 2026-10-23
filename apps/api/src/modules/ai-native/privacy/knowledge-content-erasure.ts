import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { HumanKnowledgeService } from '../knowledge/human-knowledge.service';
import { KnowledgeCommitUnknownError, KnowledgeError } from '../knowledge/knowledge-errors';
import { authorize, fingerprint, mutationInput, operationFingerprint, parse } from '../knowledge/knowledge-validation';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { AI_RETENTION_POLICY, retentionDeadline } from './retention-policy';
import { inspectRetentionSource } from './retention-model-sources';

type Db = Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiTask' | 'aiStep' | 'aiBudgetReservation'
  | 'aiTaskExecutionCharge' | 'aiInvocationAdmission' | 'aiUsageReservation' | 'aiRun' | 'aiGatewayInvocation' | 'aiTaskActionInput'
  | 'aiKnowledgeDocument' | 'aiKnowledgeVersion' | 'aiKnowledgeChunk' | 'aiKnowledgeOperation'>;

/** Physical relational-body erasure of an ALREADY authorized explicit delete.
 * The original delete command/receipt is mandatory; IDs, scope and a deadline
 * alone grant nothing. No scheduler, arbitrary table selector or storage call.
 * Only actual unresolved source references hold the document. Legacy/unknown
 * bindings refuse erasure rather than inventing an unrelated workspace hold.
 */
export class HumanKnowledgeContentErasure {
  constructor(private readonly human: HumanKnowledgeService, private readonly db: Db) {}

  eraseDeleted(value: unknown) {
    const input = parse(mutationInput, value);
    return this.human.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw new KnowledgeError('unavailable');
      const scope = context.scope;
      const binding = { lifecycle: { action: 'delete' as const, command: input } };
      const head = await this.human.documents.load(context, input.documentId, 'delete', binding);
      const originalHash = operationFingerprint(context, ['delete', input]);
      if (head.document.publication !== 'deleted' || head.revision < input.expectedRevision + 1) throw new KnowledgeError('conflict');
      const original = await this.human.repository.operation(scope, input.documentId, input.operationId);
      if (!original || original.fingerprint !== originalHash) throw new KnowledgeError('conflict');
      const jobId = `privacy-erase-${fingerprint([AI_RETENTION_POLICY.version, scope, input])}`;
      const jobHash = fingerprint({ policy: AI_RETENTION_POLICY.version, scope, input, originalHash });
      const request = { action: 'delete' as const, scope, document: head.document, ...binding };
      const before = await authorize(this.human.authorization, context, request);
      let wrote = false;
      try {
        const result = await this.db.$transaction(async tx => {
          const owner = await tx.aiScope.findFirst({ where: aiPersistenceScopeColumns(scope) });
          if (!owner || owner.kind !== 'WORKSPACE' || owner.tenantId !== scope.tenantId
            || owner.workspaceId !== scope.workspaceId) throw new KnowledgeError('unavailable');
          // Same canonical scope lock for every purge; no reverse resource lock
          // order and no unbounded transaction retry on deadlock/COMMIT loss.
          const locks = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_scopes
            WHERE id = ${owner.id} AND kind = 'workspace' AND tenantId = ${scope.tenantId}
            AND workspaceId = ${scope.workspaceId} FOR UPDATE`);
          if (!Array.isArray(locks) || locks.length !== 1 || locks[0].id !== owner.id) throw new KnowledgeError('unavailable');
          const operationWhere = { tenantId: scope.tenantId, workspaceId: scope.workspaceId,
            documentId: input.documentId, operationId: jobId };
          const receipt = await tx.aiKnowledgeOperation.findFirst({ where: operationWhere });
          if (receipt) {
            if (receipt.fingerprint !== jobHash) throw new KnowledgeError('conflict');
            return { state: 'erased' as const, originalOperation: input.operationId, operationId: jobId, replayed: true };
          }
          const source = await inspectRetentionSource(tx, owner.id, 'knowledge', input.documentId,
            { tenantId: scope.tenantId, workspaceId: scope.workspaceId });
          if (source === 'unavailable') throw new KnowledgeError('unavailable');
          if (source === 'held') return { state: 'held' as const,
            reason: 'referenced_by_unresolved_task' as const, operationId: jobId, retryable: false as const };
          const row = await tx.aiKnowledgeDocument.findFirst({ where: { id: input.documentId,
            tenantId: scope.tenantId, workspaceId: scope.workspaceId } });
          const deletion = await tx.aiKnowledgeOperation.findFirst({ where: { ...operationWhere, operationId: input.operationId } });
          if (!row || row.status !== 'deleted' || row.revision !== head.revision || fingerprint(row.state) !== fingerprint(head)
            || !deletion || deletion.fingerprint !== originalHash) throw new KnowledgeError('conflict');
          const grant = await authorize(this.human.authorization, context, request);
          if (fingerprint(grant) !== fingerprint(before)) throw new KnowledgeError('unavailable');
          await this.human.session.check(context);
          // Preserve the tombstone, immutable original deletion receipt, version
          // hashes and ACL ownership. Only body-bearing relational chunks go.
          const sanitized = { ...head, document: { ...head.document, title: '[已删除]' } };
          wrote = true;
          const changed = await tx.aiKnowledgeDocument.updateMany({ where: { id: input.documentId,
            tenantId: scope.tenantId, workspaceId: scope.workspaceId, status: 'deleted', revision: head.revision },
          data: { title: '[已删除]', state: JSON.parse(JSON.stringify(sanitized)) as Prisma.InputJsonValue } });
          if (changed.count !== 1) throw new KnowledgeError('conflict');
          await tx.aiKnowledgeChunk.deleteMany({ where: { version: { documentId: input.documentId,
            document: { tenantId: scope.tenantId, workspaceId: scope.workspaceId } } } });
          await tx.aiKnowledgeOperation.create({ data: { id: randomUUID(), ...operationWhere, fingerprint: jobHash } });
          return { state: 'erased' as const, originalOperation: input.operationId, operationId: jobId, replayed: false,
            deadline: retentionDeadline(deletion.createdAt, AI_RETENTION_POLICY.deletedKnowledgeAndMemoryDays).toISOString() };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        await this.human.session.check(context);
        return { ...result, policyVersion: AI_RETENTION_POLICY.version,
          attachments: 'not_deleted' as const, backupErasure: 'not_attested' as const,
          businessRecords: 'preserved' as const };
      } catch (error) {
        if (error instanceof KnowledgeError) throw error;
        if (wrote) throw new KnowledgeCommitUnknownError();
        throw new KnowledgeError('unavailable');
      }
    });
  }
}
