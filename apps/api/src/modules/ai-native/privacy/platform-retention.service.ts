/** 平台普通AI正文的显式有界维护。当前SaaS身份和原平台管理权限，
 * 原PLATFORM锁、关联hold及正文CAS必须同时成立。沿现有平台审计日志
 * 保存删除标记，日志FK来自真实SaaS账户，业务归属仍为null；不伪造
 * 工作空间、不删除Core/财务/批准、不自动运行或重派unknown操作。 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/shared';
import { hasEffectivePermission } from '../../../common/permission-match';
import { PLATFORM_AI_PROVIDER_PERMISSIONS } from '../../../common/platform-ai-access-policy';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { fingerprint } from '../knowledge/knowledge-validation';
import { AI_RETENTION_POLICY } from './retention-policy';
import { AiRetentionUnknown, aiRetentionReceiptSchema, aiRetentionReceiptsSchema } from './retention.service';
import { erasePlatformTaskBodies } from './retention-task-bodies';
import { AI_BODY_STORAGE_KINDS, protectAiBodyStorageRows, type AiBodyStorageCursor } from './prisma-ai-body-storage';
import { retentionPublicKeyHash } from './retention-restore';
import { platformRetentionKinds, requirePlatformRestorePermit, signPlatformRetentionManifest,
  type AiPlatformRetentionRestorePermit } from './platform-retention-restore';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const kindSchema = z.enum(platformRetentionKinds);
type Kind = z.infer<typeof kindSchema>;
type Session = { context: AiExecutionContext; hash: string; actorId: string; journalTenantId: string; scopeId: string };
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const journalAction = 'ai.platform.retention.erase', version = 'ai-platform-retention-1';
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const receiptId = (scopeId: string, kind: Kind, resourceId: string) =>
  fingerprint([AI_RETENTION_POLICY.version, 'PLATFORM', scopeId, kind, resourceId]);
const logId = (digest: string) => `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
const detailSchema = z.object({ version: z.literal(version), attribution: z.object({ scopeKind: z.literal('PLATFORM'),
  tenantId: z.null(), workspaceId: z.null() }).strict(), scopeId: id.max(36), actorId: id,
  journalTenantId: id, receiptId: hash, kind: kindSchema, resourceId: id, targetHash: hash,
  policyVersion: z.literal(AI_RETENTION_POLICY.version), state: z.literal('erased'), erasedAt: z.string().datetime() }).strict();

export const platformRetentionCleanupSchema = z.object({ kind: kindSchema,
  limit: z.number().int().min(1).max(10).default(5), after: id.optional() }).strict();

export class AiPlatformRetentionService {
  constructor(private readonly db: PrismaClient, private readonly identity: { resolve(): Promise<AiExecutionContext> },
    private readonly clock: () => Date = () => new Date(), private readonly restoreKeyHash?: string) {}

  private now() { const value = this.clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; }
  private async current(writing: boolean): Promise<Session> {
    const context = structuredClone(await this.identity.resolve());
    if (!isAiStepExecutionContext(context) || context.actor.kind !== 'saas_admin' || context.scope.kind !== 'platform'
      || context.audience !== 'operator' || !('permissions' in context) || !Array.isArray(context.permissions)
      || !hasEffectivePermission(context.permissions, PLATFORM_AI_PROVIDER_PERMISSIONS[writing ? 'manage' : 'view'])
      || Date.parse(context.authorizedAt) > this.now().getTime()) throw denied();
    const user = await this.db.user.findUnique({ where: { id: context.actor.userId },
      select: { id: true, tenantId: true, isActive: true, isSaasAdmin: true } });
    const scope = await this.db.aiScope.findFirst({ where: { kind: 'PLATFORM', scopeKey: 'platform', tenantId: null, workspaceId: null } });
    if (!user || user.id !== context.actor.userId || !user.isActive || !user.isSaasAdmin
      || !id.safeParse(user.tenantId).success || !scope || scope.kind !== 'PLATFORM'
      || scope.scopeKey !== 'platform' || scope.tenantId !== null || scope.workspaceId !== null) throw denied();
    const { requestId: _request, authorizedAt: _at, ...stable } = context;
    return { context, actorId: user.id, journalTenantId: user.tenantId, scopeId: scope.id,
      hash: fingerprint({ stable, scopeId: scope.id, journalTenantId: user.tenantId }) };
  }
  private async check(before: Session, writing: boolean) { if ((await this.current(writing)).hash !== before.hash) throw denied(); }
  private async locked(tx: Prisma.TransactionClient, before: Session) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ai_scopes
      WHERE id = ${before.scopeId} AND kind = 'platform' AND scopeKey = 'platform'
        AND tenantId IS NULL AND workspaceId IS NULL FOR UPDATE`);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== before.scopeId) throw unavailable();
    await this.check(before, true);
  }
  private checked(row: Prisma.OperationLogGetPayload<{}>, scopeId: string) {
    const detail = detailSchema.parse(row.detail);
    if (row.action !== journalAction || row.workspaceId !== null || row.userId !== detail.actorId
      || row.tenantId !== detail.journalTenantId || detail.scopeId !== scopeId
      || detail.receiptId !== receiptId(scopeId, detail.kind, detail.resourceId) || row.id !== logId(detail.receiptId)
      || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) throw denied();
    return { id: detail.receiptId, scopeKind: 'PLATFORM' as const, scopeId, tenantId: null, workspaceId: null,
      kind: detail.kind, resourceId: detail.resourceId, targetHash: detail.targetHash, policyVersion: detail.policyVersion,
      state: 'erased' as const, revision: 1, createdAt: row.createdAt, erasedAt: new Date(detail.erasedAt) };
  }
  private async previous(tx: Pick<PrismaClient, 'operationLog'>, before: Session, kind: Kind, resourceId: string) {
    const digest = receiptId(before.scopeId, kind, resourceId);
    const row = await tx.operationLog.findUnique({ where: { id: logId(digest) } });
    if (!row) return null;
    const result = this.checked(row, before.scopeId);
    if (result.id !== digest || result.kind !== kind || result.resourceId !== resourceId) throw denied();
    return result;
  }
  private async record(tx: Prisma.TransactionClient, before: Session, kind: Kind, resourceId: string, targetHash: string) {
    const old = await this.previous(tx, before, kind, resourceId);
    if (old) { if (old.targetHash !== targetHash) throw denied(); return; }
    const digest = receiptId(before.scopeId, kind, resourceId);
    await this.check(before, true);
    const saved = await tx.operationLog.create({ data: { id: logId(digest), tenantId: before.journalTenantId,
      workspaceId: null, userId: before.actorId, action: journalAction, detail: { version,
        attribution: { scopeKind: 'PLATFORM', tenantId: null, workspaceId: null }, scopeId: before.scopeId,
        actorId: before.actorId, journalTenantId: before.journalTenantId, receiptId: digest, kind, resourceId,
        targetHash, policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt: this.now().toISOString() } } });
    if (this.checked(saved, before.scopeId).targetHash !== targetHash) throw unavailable();
  }
  async receipt(value: unknown) {
    const command = aiRetentionReceiptSchema.parse(value), before = await this.current(false);
    const row = await this.db.operationLog.findUnique({ where: { id: logId(command.id) } });
    await this.check(before, false);
    if (!row) throw unavailable();
    const result = this.checked(row, before.scopeId); if (result.id !== command.id) throw denied(); return result;
  }
  private async journal(before: Session, limit: number, beforeTime?: string) {
    const rows = await this.db.operationLog.findMany({ where: { action: journalAction, workspaceId: null,
      detail: { path: '$.scopeId', equals: before.scopeId }, ...(beforeTime ? { createdAt: { lt: new Date(beforeTime) } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    if (rows.length > limit) throw unavailable();
    return rows.map(row => this.checked(row, before.scopeId));
  }
  async receipts(value: unknown) {
    const command = aiRetentionReceiptsSchema.parse(value), before = await this.current(false);
    const rows = await this.journal(before, command.limit, command.before); await this.check(before, false);
    return { rows, coverage: 'bounded_page' as const, retryable: false as const };
  }
  private taskReceipt(tx: Prisma.TransactionClient, before: Session, taskId: string) {
    return { id: receiptId(before.scopeId, 'task', taskId),
      read: async () => { const row = await this.previous(tx, before, 'task', taskId);
        return row ? { ...row, kind: 'task' as const } : null; },
      record: (targetHash: string) => this.record(tx, before, 'task', taskId, targetHash) };
  }
  private async eraseRequest(tx: Prisma.TransactionClient, before: Session, resourceId: string, expectedHash?: string) {
    const row = await tx.aiTaskOriginalRequest.findFirst({ where: { id: resourceId, scopeId: before.scopeId,
      audience: 'OPERATOR', ownerKind: 'SAAS_ADMIN' } });
    if (!row || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())
      || !expectedHash && row.createdAt > new Date(this.now().getTime() - AI_RETENTION_POLICY.conversationDays * 86400000)) throw unavailable();
    const targetHash = fingerprint(['request', row.id, row.contentHash, row.createdAt.toISOString()]);
    const old = await this.previous(tx, before, 'request', resourceId);
    if (expectedHash && expectedHash !== targetHash || old && old.targetHash !== targetHash) throw denied();
    const tasks = await tx.aiTask.findMany({ where: { scopeId: before.scopeId, inputRef: row.id }, orderBy: { id: 'asc' }, take: 101 });
    if (tasks.length > 100) return { id: receiptId(before.scopeId, 'request', row.id), state: 'held' as const, reason: 'association_limit' as const };
    for (const task of tasks) {
      if (task.scopeKind !== 'PLATFORM' || task.ownerKind !== 'SAAS_ADMIN' || task.ownerId !== row.ownerId
        || task.audience !== row.audience || task.inputHash !== row.contentHash || task.inputRevision !== row.revision)
        return { id: receiptId(before.scopeId, 'request', row.id), state: 'unavailable' as const, reason: 'source_task_binding_unavailable' as const };
      if (await aiTaskHasUnresolvedEffects(tx, before.scopeId, task.id, { tenantId: null, workspaceId: null }))
        return { id: receiptId(before.scopeId, 'request', row.id), state: 'held' as const, reason: 'unresolved_effects' as const };
    }
    const mark = { retention: 'erased', receiptId: receiptId(before.scopeId, 'request', row.id), policyVersion: AI_RETENTION_POLICY.version };
    for (const task of tasks) await erasePlatformTaskBodies(tx, { scopeId: before.scopeId, owner: { tenantId: null, workspaceId: null },
      taskId: task.id, now: this.now(), check: () => this.check(before, true), platformReceipt: this.taskReceipt(tx, before, task.id) }, undefined, true);
    await this.check(before, true);
    const changed = await tx.aiTaskOriginalRequest.updateMany({ where: { id: row.id, scopeId: before.scopeId,
      audience: row.audience, ownerKind: row.ownerKind, ownerId: row.ownerId, revision: row.revision,
      contentHash: row.contentHash, erasedAt: row.erasedAt }, data: { payload: mark, erasedAt: row.erasedAt ?? this.now() } });
    if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await this.record(tx, before, 'request', row.id, targetHash);
    return { id: mark.receiptId, state: 'erased' as const, replayed: Boolean(old) };
  }
  async erase(kind: Kind, resourceId: string, restore?: AiPlatformRetentionRestorePermit) {
    kindSchema.parse(kind); id.parse(resourceId);
    const before = await this.current(true), expected = restore && requirePlatformRestorePermit(restore, this.restoreKeyHash,
      before.scopeId, this.now()).tombstones.find(item => item.kind === kind && item.resourceId === resourceId)?.targetHash;
    if (restore && !expected) throw denied();
    let attempted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        await this.locked(tx, before);
        const exists = kind === 'task' ? await tx.aiTask.findFirst({ where: { id: resourceId, scopeId: before.scopeId } })
          : await tx.aiTaskOriginalRequest.findFirst({ where: { id: resourceId, scopeId: before.scopeId } });
        if (!exists) {
          if (!expected) throw unavailable();
          attempted = true; await this.record(tx, before, kind, resourceId, expected);
          return { id: receiptId(before.scopeId, kind, resourceId), state: 'erased' as const, absentInSnapshot: true as const };
        }
        if (exists.ownerKind !== 'SAAS_ADMIN' || exists.audience !== 'OPERATOR'
          || 'scopeKind' in exists && exists.scopeKind !== 'PLATFORM') throw denied();
        if (kind === 'task' && await aiTaskHasUnresolvedEffects(tx, before.scopeId, resourceId, { tenantId: null, workspaceId: null }))
          return { id: receiptId(before.scopeId, kind, resourceId), state: 'held' as const, reason: 'unresolved_effects' as const };
        // A lost transaction response never proves no write. The page can only
        // be resolved from this exact resource's durable deletion journal.
        attempted = true;
        const result = kind === 'request' ? await this.eraseRequest(tx, before, resourceId, expected || undefined)
          : await erasePlatformTaskBodies(tx, { scopeId: before.scopeId, owner: { tenantId: null, workspaceId: null },
            taskId: resourceId, now: this.now(), check: () => this.check(before, true),
            platformReceipt: this.taskReceipt(tx, before, resourceId) }, expected || undefined);
        await this.check(before, true); return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.check(before, true); return result;
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (attempted) throw new AiRetentionUnknown();
      throw unavailable();
    }
  }
  async cleanup(value: unknown) {
    const command = platformRetentionCleanupSchema.parse(structuredClone(value)), before = await this.current(true);
    const page = command.after ? { id: { gt: command.after } } : {}, cutoff = new Date(this.now().getTime() - AI_RETENTION_POLICY.conversationDays * 86400000);
    const rows = command.kind === 'task' ? await this.db.aiTask.findMany({ where: { scopeId: before.scopeId, scopeKind: 'PLATFORM',
      ownerKind: 'SAAS_ADMIN', audience: 'OPERATOR', status: { in: [...terminal] }, updatedAt: { lte: cutoff },
      archivedAt: null, ...page }, select: { id: true }, orderBy: { id: 'asc' }, take: command.limit })
      : await this.db.aiTaskOriginalRequest.findMany({ where: { scopeId: before.scopeId, ownerKind: 'SAAS_ADMIN',
        audience: 'OPERATOR', createdAt: { lte: cutoff }, erasedAt: null, ...page }, select: { id: true },
        orderBy: { id: 'asc' }, take: command.limit });
    await this.check(before, true); if (rows.length > command.limit) throw unavailable();
    const results = [];
    for (const row of rows) {
      try { results.push(await this.erase(command.kind, row.id)); }
      catch (error) { if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
        results.push({ state: error instanceof AiRetentionUnknown ? 'unknown' as const : 'unavailable' as const,
          retryable: false as const, nextAction: 'list_retention_receipts' as const }); }
    }
    await this.check(before, true);
    return { policyVersion: AI_RETENTION_POLICY.version, scanned: rows.length, limit: command.limit, results,
      nextAfter: rows.length === command.limit ? rows[rows.length - 1].id : null,
      coverage: 'bounded_candidate_page' as const, businessRecords: 'preserved' as const, backupErasure: 'not_attested' as const };
  }
  async protectStoredBodies(value: unknown) {
    const command = z.object({ model: z.string().refine(value => AI_BODY_STORAGE_KINDS.includes(value)),
      limit: z.number().int().min(1).max(10).default(5), after: z.union([
        z.object({ id: id }).strict(), z.object({ taskId: id.max(36), cursor: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict(),
        z.object({ recordId: id, revision: z.number().int().min(1).max(4294967294) }).strict()
      ]).optional() }).strict().parse(structuredClone(value));
    const before = await this.current(true);
    return protectAiBodyStorageRows(this.db, { ...command, after: command.after as AiBodyStorageCursor | undefined,
      scopeId: before.scopeId, tenantId: null, workspaceId: null, check: () => this.check(before, true) });
  }
  async exportRestoreManifest(snapshot: { id: string; sha256: string; createdAt: string }, privateKey: KeyObject) {
    const before = await this.current(true);
    if (!this.restoreKeyHash || retentionPublicKeyHash(privateKey) !== this.restoreKeyHash) throw unavailable();
    const rows = await this.journal(before, 501); if (rows.length > 500) throw unavailable();
    await this.check(before, true);
    return signPlatformRetentionManifest({ version: 'ai-platform-restore-tombstones-1', policyVersion: AI_RETENTION_POLICY.version,
      scopeKind: 'PLATFORM', scopeId: before.scopeId, tenantId: null, workspaceId: null,
      snapshotId: snapshot.id, snapshotSha256: snapshot.sha256, snapshotCreatedAt: snapshot.createdAt,
      issuedAt: this.now().toISOString(), complete: true,
      tombstones: rows.map(row => ({ kind: row.kind, resourceId: row.resourceId, targetHash: row.targetHash })) }, privateKey);
  }
  async reapplyRestore(permit: AiPlatformRetentionRestorePermit, attestation?: { database: string; privateKey: KeyObject }) {
    const before = await this.current(true), manifest = requirePlatformRestorePermit(permit, this.restoreKeyHash, before.scopeId, this.now());
    const results = [];
    for (const item of manifest.tombstones) { const result = await this.erase(item.kind, item.resourceId, permit);
      if (result.state !== 'erased') throw unavailable(); results.push(result); }
    await this.check(before, true);
    const observation = { state: 'scope_tombstones_reapplied', snapshotId: manifest.snapshotId,
      scope: { kind: 'platform' }, scopeId: before.scopeId, count: results.length,
      globalAccess: 'not_authorized', manifestHash: fingerprint(manifest) };
    if (!attestation) return observation;
    if (!/^[A-Za-z0-9_]{1,64}$/u.test(attestation.database) || retentionPublicKeyHash(attestation.privateKey) !== this.restoreKeyHash) throw unavailable();
    const payload = JSON.stringify({ version: 'ai-restored-platform-scope-1', database: attestation.database,
      scopeKind: 'PLATFORM', scopeId: before.scopeId, tenantId: null, workspaceId: null,
      snapshotSha256: manifest.snapshotSha256, verifiedAt: this.now().toISOString(), manifestHash: observation.manifestHash,
      policyVersion: AI_RETENTION_POLICY.version });
    return { ...observation, certificate: { payload, signature: sign(null, Buffer.from(payload), attestation.privateKey).toString('base64') } };
  }
}
