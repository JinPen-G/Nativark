import { hasEffectivePermission } from '../../../common/permission-match';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import type { AuthService } from '../../auth/auth.service';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { fingerprint } from '../knowledge/knowledge-validation';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { AI_RETENTION_POLICY } from './retention-policy';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { aiRetentionObjectHash } from './retention-binding';
import { z } from 'zod';
import { retentionKinds, requireRestorePermit, signRetentionManifest, retentionPublicKeyHash, type AiRestorePermit } from './retention-restore';
import { sign, type KeyObject } from 'node:crypto';
import { knowledgeRecordSchema, parsePersisted, queueIndex } from '../knowledge/knowledge-validation';
import { inspectRetentionSource } from './retention-model-sources';
import { eraseExpiredTaskBodies, eraseRetainedSourceTaskBodies } from './retention-task-bodies';

export const aiRetentionCleanupSchema = z.object({ kind: z.enum(retentionKinds),
  limit: z.number().int().min(1).max(10).default(5),
  after: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional() }).strict();
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const aiRetentionReceiptSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const aiRetentionReceiptsSchema = z.object({ limit: z.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional() }).strict();
export type RetentionKind = z.infer<typeof aiRetentionCleanupSchema>['kind'];
type Session = { context: AiExecutionContext; hash: string; tenantId: string; workspaceId: string };
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const refused = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export class AiRetentionUnknown extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/** Explicit bounded maintenance, not Cron/startup work. Current full-workspace
 * operator + the existing AI/settings management permission are mandatory.
 * Receipt IDs never authorize deletion; every attempt rechecks source facts.
 */
export class AiRetentionService {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  constructor(readonly db: PrismaClient, auth: Pick<AuthService, 'resolveAccessContext'>,
    credentials: AiTaskCredentialSource, private readonly files?: Pick<FileStorageRuntimeService, 'eraseAiRetentionObject'>,
    private readonly clock: () => Date = () => new Date(), private readonly restoreKeyHash?: string) {
    this.identities = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
  }
  async current(): Promise<Session> {
    const context = await this.identities.resolve();
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !('access' in context) || !hasEffectivePermission(context.access.permissions, 'system:params:manage')
      || context.access.dataScope !== 'all' || context.access.locationScope.mode !== 'all') throw refused();
    const { requestId: _request, authorizedAt: _at, ...stable } = context;
    return { context, hash: fingerprint(stable), tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
  }
  async check(before: Session) { if ((await this.current()).hash !== before.hash) throw refused(); }
  private now() { const value = this.clock(); if (!Number.isFinite(value.getTime())) throw unavailable(); return value; }
  private cutoff(days: number) { return new Date(this.now().getTime() - days * 86400000); }
  private readonly unresolvedTask = aiTaskHasUnresolvedEffects;
  async receipt(value: unknown) {
    const command = aiRetentionReceiptSchema.parse(value), current = await this.current();
    const row = await this.db.aiDataErasure.findFirst({ where: { id: command.id,
      tenantId: current.tenantId, workspaceId: current.workspaceId } });
    await this.check(current);
    if (!row) throw unavailable();
    return row;
  }
  async receipts(value: unknown) {
    const command = aiRetentionReceiptsSchema.parse(value), current = await this.current();
    const rows = await this.db.aiDataErasure.findMany({ where: { tenantId: current.tenantId, workspaceId: current.workspaceId,
      ...(command.before ? { createdAt: { lt: new Date(command.before) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: command.limit });
    await this.check(current);
    return { rows, coverage: 'bounded_page', retryable: false };
  }
  /** Host-only export. The private key and snapshot identity come from the
   * backup operator, not an HTTP request. Reject an incomplete page outright.
   */
  async exportRestoreManifest(snapshot: { id: string; sha256: string; createdAt: string }, privateKey: KeyObject) {
    const current = await this.current();
    if (!this.restoreKeyHash || retentionPublicKeyHash(privateKey) !== this.restoreKeyHash) throw unavailable();
    const rows = await this.db.aiDataErasure.findMany({ where: { tenantId: current.tenantId,
      workspaceId: current.workspaceId, state: { not: 'superseded' } }, orderBy: { id: 'asc' }, take: 501 });
    if (rows.length > 500) throw unavailable();
    await this.check(current);
    return signRetentionManifest({ version: 'ai-restore-tombstones-1', policyVersion: AI_RETENTION_POLICY.version,
      tenantId: current.tenantId, workspaceId: current.workspaceId, snapshotId: snapshot.id, snapshotSha256: snapshot.sha256, snapshotCreatedAt: snapshot.createdAt,
      issuedAt: this.now().toISOString(), complete: true, tombstones: rows.map(row => ({ kind: row.kind,
        resourceId: row.resourceId, targetHash: row.targetHash, mode: row.state === 'withdrawn' ? 'withdraw' : 'erase' })) }, privateKey);
  }
  async reapplyRestore(permit: AiRestorePermit, attestation?: { database: string; privateKey: KeyObject }) {
    const current = await this.current(), manifest = requireRestorePermit(permit, this.restoreKeyHash, current, this.now());
    const results = [];
    for (const item of manifest.tombstones) {
      const result = await this.erase(item.kind, item.resourceId, permit);
      if (!['erased', 'withdrawn'].includes(result.state)) throw unavailable();
      results.push(result);
    }
    await this.check(current);
    // This permits only this scope's AI data. It is NOT permission to expose a
    // restored database, bypass other scopes or start a worker/application.
    const observation = { state: 'scope_tombstones_reapplied', snapshotId: manifest.snapshotId,
      scope: current.context.scope, count: results.length, globalAccess: 'not_authorized',
      manifestHash: fingerprint(manifest) };
    if (!attestation) return observation;
    if (!/^[A-Za-z0-9_]{1,64}$/u.test(attestation.database)
      || retentionPublicKeyHash(attestation.privateKey) !== this.restoreKeyHash) throw unavailable();
    const payload = JSON.stringify({ version: 'ai-restored-scope-1', database: attestation.database,
      tenantId: current.tenantId, workspaceId: current.workspaceId, snapshotSha256: manifest.snapshotSha256,
      verifiedAt: this.now().toISOString(), manifestHash: observation.manifestHash, policyVersion: AI_RETENTION_POLICY.version });
    return { ...observation, certificate: { payload, signature: sign(null, Buffer.from(payload), attestation.privateKey).toString('base64') } };
  }
  async cleanup(value: unknown) {
    const command = aiRetentionCleanupSchema.parse(structuredClone(value)), current = await this.current();
    const scope = await this.db.aiScope.findFirst({ where: aiPersistenceScopeColumns(current.context.scope) });
    if (!scope) throw unavailable();
    const page = command.after ? { id: { gt: command.after } } : {};
    const where = { tenantId: current.tenantId, workspaceId: current.workspaceId, ...page };
    let ids: string[];
    if (command.kind === 'task') ids = (await this.db.aiTask.findMany({ where: { scopeId: scope.id, ...page,
      status: { in: [...terminal] }, updatedAt: { lte: this.cutoff(30) }, archivedAt: null }, orderBy: { id: 'asc' },
      take: command.limit, select: { id: true } })).map(row => row.id);
    else if (command.kind === 'request') ids = (await this.db.aiTaskOriginalRequest.findMany({ where: { scopeId: scope.id, ...page,
      erasedAt: null, createdAt: { lte: this.cutoff(30) } }, orderBy: { id: 'asc' },
      take: command.limit, select: { id: true } })).map(row => row.id);
    else if (command.kind === 'memory') ids = (await this.db.aiStructuredMemory.findMany({ where: { ...where,
      status: 'deleted' }, orderBy: { id: 'asc' }, take: command.limit, select: { id: true } })).map(row => row.id);
    else if (command.kind === 'knowledge') ids = (await this.db.aiKnowledgeDocument.findMany({ where: { ...where,
      status: 'deleted' }, orderBy: { id: 'asc' }, take: command.limit, select: { id: true } })).map(row => row.id);
    else if (command.kind === 'material') ids = (await this.db.aiClientSceneMaterial.findMany({ where: { ...where,
      erasedAt: null, createdAt: { lte: this.cutoff(30) } }, orderBy: { id: 'asc' },
      take: command.limit, select: { id: true } })).map(row => row.id);
    else ids = (await this.db.fileAsset.findMany({ where: { tenantId: current.tenantId, ...page, businessModule: 'ai-native',
      businessType: 'ai_knowledge_document', metadata: { path: '$.workspaceId', equals: current.workspaceId },
      status: { in: ['active', 'failed', 'ai_erasure_pending'] }, createdAt: { lte: this.cutoff(7) } },
      orderBy: { id: 'asc' }, take: command.limit, select: { id: true } })).map(row => row.id);
    await this.check(current);
    const results = [];
    for (const resourceId of ids) {
      try { results.push(await this.erase(command.kind, resourceId)); }
      catch (error) {
        if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
        results.push({ state: error instanceof AiRetentionUnknown ? 'unknown' : 'unavailable', retryable: false,
          nextAction: 'list_retention_receipts' });
      }
    }
    await this.check(current);
    return { policyVersion: AI_RETENTION_POLICY.version, scanned: ids.length, limit: command.limit, results,
      nextAfter: ids.length === command.limit ? ids[ids.length - 1] : null, coverage: 'bounded_candidate_page',
      businessRecords: 'preserved', backupErasure: 'not_attested' };
  }
  /** Also used ONLY after a trusted restore manifest has been verified. */
  async erase(kind: RetentionKind, resourceId: string, restore?: AiRestorePermit) {
    id.parse(resourceId);
    if (!(retentionKinds as readonly string[]).includes(kind)) throw unavailable();
    const current = await this.current(), now = this.now();
    const expectedHash = restore ? requireRestorePermit(restore, this.restoreKeyHash, current, now).tombstones
      .find(row => row.kind === kind && row.resourceId === resourceId)?.targetHash : undefined;
    const withdrawing = restore?.manifest.tombstones.some(row => row.kind === kind && row.resourceId === resourceId && row.mode === 'withdraw') === true;
    if (restore && !expectedHash) throw refused();
    const key = fingerprint([AI_RETENTION_POLICY.version, current.tenantId, current.workspaceId, kind, resourceId]);
    const owner = { tenantId: current.tenantId, workspaceId: current.workspaceId };
    let attempted = false;
    let result;
    try {
      result = await this.db.$transaction(async tx => {
        const scope = await tx.aiScope.findFirst({ where: aiPersistenceScopeColumns(current.context.scope) });
        if (!scope || scope.kind !== 'WORKSPACE' || scope.tenantId !== owner.tenantId || scope.workspaceId !== owner.workspaceId) throw refused();
        const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_scopes
          WHERE id = ${scope.id} AND kind = 'workspace' AND tenantId = ${owner.tenantId}
          AND workspaceId = ${owner.workspaceId} FOR UPDATE`);
        if (locked.length !== 1 || locked[0].id !== scope.id) throw unavailable();
        const receipt = await tx.aiDataErasure.findUnique({ where: { id: key } });
        if (receipt && (receipt.tenantId !== owner.tenantId || receipt.workspaceId !== owner.workspaceId
          || receipt.kind !== kind || receipt.resourceId !== resourceId || receipt.policyVersion !== AI_RETENTION_POLICY.version
          || expectedHash && receipt.targetHash !== expectedHash)) throw refused();
        if (receipt?.state === 'erased' && !expectedHash && kind !== 'task') return { id: key, state: 'erased', replayed: true };
        if (['knowledge', 'memory', 'attachment'].includes(kind)) {
          const source = await inspectRetentionSource(tx, scope.id, kind as 'knowledge' | 'memory' | 'attachment', resourceId, owner);
          if (source !== 'clear') return { id: key, state: source,
            reason: source === 'held' ? 'referenced_by_unresolved_task' : 'source_task_binding_unavailable' };
        }
        if (kind === 'task' && await this.unresolvedTask(tx, scope.id, resourceId, owner)) return { id: key, state: 'held', reason: 'unresolved_effects' };
        const mark = { retention: 'erased', receiptId: key, policyVersion: AI_RETENTION_POLICY.version };
        if (expectedHash) {
          const exists = kind === 'task' ? await tx.aiTask.findFirst({ where: { id: resourceId, scopeId: scope.id }, select: { id: true } })
            : kind === 'request' ? await tx.aiTaskOriginalRequest.findFirst({ where: { id: resourceId, scopeId: scope.id }, select: { id: true } })
            : kind === 'knowledge' ? await tx.aiKnowledgeDocument.findFirst({ where: { id: resourceId, ...owner }, select: { id: true } })
            : kind === 'memory' ? await tx.aiStructuredMemory.findFirst({ where: { id: resourceId, ...owner }, select: { id: true } })
            : kind === 'material' ? await tx.aiClientSceneMaterial.findFirst({ where: { id: resourceId, ...owner }, select: { id: true } })
            : await tx.fileAsset.findFirst({ where: { id: resourceId, tenantId: owner.tenantId,
              metadata: { path: '$.workspaceId', equals: owner.workspaceId } }, select: { id: true } });
          if (!exists) {
            await this.check(current); attempted = true;
            await tx.aiDataErasure.upsert({ where: { id: key }, create: { id: key, ...owner, kind, resourceId,
              targetHash: expectedHash, policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt: now },
              update: { state: 'erased', erasedAt: now, revision: { increment: 1 } } });
            return { id: key, state: 'erased', absentInSnapshot: true };
          }
        }
        let targetHash: string;
        if (kind === 'task') {
          await this.check(current); attempted = true;
          return eraseExpiredTaskBodies(tx, { scopeId: scope.id, owner, taskId: resourceId, now,
            check: () => this.check(current) }, expectedHash);
        } else if (kind === 'request') {
          const row = await tx.aiTaskOriginalRequest.findFirst({ where: { id: resourceId, scopeId: scope.id } });
          if (!row || row.createdAt > this.cutoff(30) && !expectedHash) throw unavailable();
          const related = await tx.aiTask.findMany({ where: { scopeId: scope.id, inputRef: row.id },
            select: { id: true }, orderBy: { id: 'asc' }, take: 101 });
          if (related.length > 100) return { id: key, state: 'held', reason: 'association_limit' };
          for (const task of related) if (await this.unresolvedTask(tx, scope.id, task.id, owner)) return { id: key, state: 'held', reason: 'unresolved_effects' };
          // Terminal business readers reopen the retained locator under current
          // task policy. A selection does not retain the scene candidate forever.
          targetHash = fingerprint([kind, row.id, row.contentHash, row.createdAt.toISOString()]);
          if (expectedHash && targetHash !== expectedHash) throw refused();
          await this.check(current); attempted = true;
          const changed = await tx.aiTaskOriginalRequest.updateMany({ where: { id: row.id, scopeId: scope.id,
            revision: row.revision }, data: { payload: mark, erasedAt: now } });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        } else if (kind === 'memory') {
          const row = await tx.aiStructuredMemory.findFirst({ where: { id: resourceId, ...owner } });
          if (!row || !expectedHash && row.status !== 'deleted') throw unavailable();
          targetHash = fingerprint([kind, row.id, row.ownerKind, row.ownerId, row.createdAt.toISOString()]);
          if (expectedHash && targetHash !== expectedHash) throw refused();
          const state = row.state;
          if (!state || typeof state !== 'object' || Array.isArray(state)) throw unavailable();
          const { preference: _body, confirmationRecordId: _confirmation, ...safe } = state;
          await this.check(current); attempted = true;
          await eraseRetainedSourceTaskBodies(tx, { scopeId: scope.id, owner, kind: 'memory', resourceId: row.id,
            now, check: () => this.check(current) });
          const changed = await tx.aiStructuredMemory.updateMany({ where: { id: row.id, ...owner,
            revision: row.revision, ownerKind: row.ownerKind, ownerId: row.ownerId }, data: { content: {},
              contentHash: fingerprint({}), status: 'deleted', confirmationRecordId: null, deletedAt: now,
              state: { ...safe, status: 'deleted', deletedAt: now.toISOString() } } });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          await tx.aiHumanConfirmation.updateMany({ where: { ...owner, subjectId: row.id, confirmedBy: row.ownerId,
            AND: [{ state: { path: '$.memoryId', equals: row.id } }, { state: { path: '$.owner.actorId', equals: row.ownerId } },
              { state: { path: '$.owner.actorKind', equals: row.ownerKind } }] }, data: { status: 'revoked', state: Prisma.DbNull } });
        } else if (kind === 'knowledge') {
          const doc = await tx.aiKnowledgeDocument.findFirst({ where: { id: resourceId, ...owner } });
          if (!doc || !doc.state || typeof doc.state !== 'object' || Array.isArray(doc.state)) throw unavailable();
          const state = doc.state as Record<string, Prisma.JsonValue>, document = state.document;
          if (!document || typeof document !== 'object' || Array.isArray(document) || !expectedHash && (doc.status !== 'deleted' || document.publication !== 'deleted')
            || document.documentId !== doc.id || (document.scope as Record<string, unknown> | null)?.workspaceId !== owner.workspaceId) throw unavailable();
          targetHash = fingerprint([kind, doc.id, doc.createdAt.toISOString()]);
          if (expectedHash && targetHash !== expectedHash) throw refused();
          await this.check(current); attempted = true;
          if (!withdrawing) await eraseRetainedSourceTaskBodies(tx, { scopeId: scope.id, owner,
            kind: 'knowledge', resourceId: doc.id, now, check: () => this.check(current) });
          const parsed = parsePersisted(knowledgeRecordSchema, doc.state);
          const next = queueIndex({ ...parsed, document: { ...parsed.document,
            title: withdrawing ? parsed.document.title : '[已删除]', publication: withdrawing ? 'withdrawn' : 'deleted',
            indexing: 'not_indexed' } }, 'remove', `privacy-${key.slice(0, 64)}`);
          const changed = await tx.aiKnowledgeDocument.updateMany({ where: { id: doc.id, ...owner, revision: doc.revision },
            data: { status: withdrawing ? 'withdrawn' : 'deleted', withdrawnAt: withdrawing ? now : null,
              title: next.document.title, state: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue } });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          if (!withdrawing) await tx.aiKnowledgeChunk.deleteMany({ where: { version: { documentId: doc.id, document: owner } } });
        } else if (kind === 'material') {
          const row = await tx.aiClientSceneMaterial.findFirst({ where: { id: resourceId, ...owner } });
          if (!row || row.createdAt > this.cutoff(30) && !expectedHash) throw unavailable();
          if (await tx.aiClientBookingDraft.findFirst({ where: { materialRef: row.id, ...owner }, select: { id: true } })) return { id: key, state: 'held', reason: 'original_operation_retention' };
          const inputs = await tx.aiClientTaskInput.findMany({ where: { materialRef: row.id, ...owner }, take: 51 });
          if (inputs.length > 50) return { id: key, state: 'held', reason: 'original_operation_retention' };
          for (const input of inputs) {
            // A published input is not proof of dispatch/completion. Only a
            // bound, already-erased terminal task permits clearing its source.
            const tasks = await tx.aiTask.findMany({ where: { scopeId: scope.id, inputRef: input.id }, take: 2 });
            const task = tasks[0];
            if (tasks.length !== 1 || task.inputHash !== input.inputHash || !task.archivedAt
              || !terminal.includes(task.status as typeof terminal[number])) return { id: key, state: 'held', reason: 'original_operation_retention' };
            const erased = await tx.aiDataErasure.findFirst({ where: { id: fingerprint([AI_RETENTION_POLICY.version,
              owner.tenantId, owner.workspaceId, 'task', task.id]), ...owner, kind: 'task', resourceId: task.id,
              policyVersion: AI_RETENTION_POLICY.version, state: 'erased' } });
            if (!erased) return { id: key, state: 'held', reason: 'original_operation_retention' };
          }
          targetHash = fingerprint([kind, row.id, row.materialHash, row.inputHash, row.createdAt.toISOString()]);
          if (expectedHash && targetHash !== expectedHash) throw refused();
          await this.check(current); attempted = true;
          const changed = await tx.aiClientSceneMaterial.updateMany({ where: { id: row.id, ...owner, revision: row.revision },
            data: { command: mark, material: mark, publication: mark, erasedAt: now } });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        } else {
          const asset = await tx.fileAsset.findFirst({ where: { id: resourceId, tenantId: owner.tenantId,
            businessModule: 'ai-native', businessType: 'ai_knowledge_document',
            metadata: { path: '$.workspaceId', equals: owner.workspaceId } } });
          if (!asset || !asset.businessId || asset.createdAt > this.cutoff(7) && !expectedHash
            || !['active', 'failed', 'ai_erasure_pending', 'deleted'].includes(asset.status)) throw unavailable();
          const doc = await tx.aiKnowledgeDocument.findFirst({ where: { id: asset.businessId, ...owner } });
          if (doc && doc.status !== 'deleted' || await tx.aiInspectionEvidenceBinding.findFirst({ where: { attachmentId: asset.id }, select: { id: true } })
            || await tx.fileAsset.findFirst({ where: { tenantId: owner.tenantId, storageProvider: asset.storageProvider,
              storageKey: asset.storageKey, id: { not: asset.id }, status: { not: 'deleted' } }, select: { id: true } })
            || await tx.aiKnowledgeDocument.findFirst({ where: { ...owner, id: { not: asset.businessId },
              state: { path: '$.document.attachmentId', equals: asset.id } }, select: { id: true } })) return { id: key, state: 'held', reason: 'shared_or_business_attachment' };
          targetHash = aiRetentionObjectHash(asset);
          if (expectedHash && targetHash !== expectedHash || receipt && receipt.targetHash !== targetHash) throw refused();
          await this.check(current); attempted = true;
          if (asset.status !== 'deleted') {
            const changed = await tx.fileAsset.updateMany({ where: { id: asset.id, tenantId: owner.tenantId,
              storageKey: asset.storageKey, updatedAt: asset.updatedAt }, data: { status: 'ai_erasure_pending', publicUrl: null } });
            if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          }
        }
        if (receipt && receipt.targetHash !== targetHash) throw refused();
        const state = withdrawing ? 'withdrawn' : kind === 'attachment' ? 'prepared' : 'erased';
        attempted = true;
        if (!receipt) await tx.aiDataErasure.create({ data: { id: key, ...owner, kind, resourceId,
          targetHash, policyVersion: AI_RETENTION_POLICY.version, state, erasedAt: state === 'erased' ? now : null } });
        else {
          const changed = await tx.aiDataErasure.updateMany({ where: { id: key, revision: receipt.revision, ...owner },
          data: { state: ['unknown', 'deleting'].includes(receipt.state) ? receipt.state : state, revision: { increment: 1 },
            erasedAt: state === 'erased' ? now : null } });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        return { id: key, state, replayed: Boolean(receipt) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.check(current);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (attempted) throw new AiRetentionUnknown();
      throw unavailable();
    }
    if (kind === 'attachment' && result.state === 'prepared') {
      if (!this.files) return { ...result, state: 'unavailable', reason: 'storage_erasure_not_assembled' };
      return this.files.eraseAiRetentionObject(owner.tenantId, owner.workspaceId, key, () => this.check(current));
    }
    return result;
  }
}
