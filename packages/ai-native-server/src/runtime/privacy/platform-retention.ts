/** 平台普通AI正文的显式有界维护。当前SaaS身份和原平台管理权限，
 * 原PLATFORM锁、关联hold及正文CAS必须同时成立。沿现有平台审计日志
 * 保存删除标记，日志FK来自真实SaaS账户，业务归属仍为null；不伪造
 * 工作空间、不删除Core/财务/批准、不自动运行或重派unknown操作。 */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { PLATFORM_AI_MODEL_VIEW, PLATFORM_AI_MODEL_MANAGE } from '../../configuration/platform-model-settings-policy';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { AiTaskRepositoryError } from '../../task-errors';
import { isAiStepExecutionContext } from '../../execution-context-validation';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { fingerprint } from '../knowledge/knowledge-validation';
import { AI_RETENTION_POLICY } from './retention-policy';
import { logRetentionPage, retentionCandidate } from './retention-page-observation';
import { AiRetentionUnknown, aiRetentionReceiptSchema, aiRetentionReceiptsSchema } from './retention-receipt';
import type { createAiTaskBodyErasure } from './task-body-erasure';
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

export interface PlatformRetentionIdentity {
  resolve(): Promise<AiExecutionContext>;
}
export interface PlatformRetentionHost {
  assertSelectedIdentity(context: AiExecutionContext, writing: boolean): void;
  begin(tx: Prisma.TransactionClient, actorId: string): Promise<{ revalidate(): Promise<void>; close(): void;
    currentUser?(): Promise<SystemUserRow> } | undefined>;
  eraseTaskBodies: ReturnType<typeof createAiTaskBodyErasure>['erasePlatformTaskBodies'];
}
export class PlatformRetentionOperations {
  constructor(private readonly db: PrismaClient, private readonly identity: PlatformRetentionIdentity,
    private readonly host: PlatformRetentionHost, private readonly clock: () => Date = () => new Date(), private readonly restoreKeyHash?: string) {}

  private now() { const value = this.clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; }
  private async current(writing: boolean): Promise<Session> {
    const context = structuredClone(await this.identity.resolve());
    if (!isAiStepExecutionContext(context) || context.actor.kind !== 'saas_admin' || context.scope.kind !== 'platform'
      || context.audience !== 'operator' || !('permissions' in context) || !Array.isArray(context.permissions)
      || !hasEffectivePermission(context.permissions, writing ? PLATFORM_AI_MODEL_MANAGE : PLATFORM_AI_MODEL_VIEW)
      || Date.parse(context.authorizedAt) > this.now().getTime()) throw denied();
    this.host.assertSelectedIdentity(context, writing);
    const session = await this.observe(this.db, context);
    this.host.assertSelectedIdentity(context, writing);
    return session;
  }
  private async observe(db: Pick<Prisma.TransactionClient, 'user' | 'aiScope'>,
    context: Extract<AiExecutionContext, { permissions: string[] }>, currentUser?: () => Promise<SystemUserRow>): Promise<Session> {
    const user = currentUser ? await currentUser().catch(() => { throw denied(); }) : await db.user.findUnique({ where: { id: context.actor.userId },
      select: { id: true, tenantId: true, isActive: true, isSaasAdmin: true } });
    if (currentUser && (!user || !('permissions' in user)
      || fingerprint([...user.permissions].sort()) !== fingerprint([...context.permissions].sort()))) throw denied();
    const scope = await db.aiScope.findFirst({ where: { kind: 'PLATFORM', scopeKey: 'platform', tenantId: null, workspaceId: null } });
    if (!user || user.id !== context.actor.userId || !user.isActive || !user.isSaasAdmin
      || !id.safeParse(user.tenantId).success || !scope || scope.kind !== 'PLATFORM'
      || scope.scopeKey !== 'platform' || scope.tenantId !== null || scope.workspaceId !== null) throw denied();
    const { requestId: _request, authorizedAt: _at, ...stable } = context;
    return { context, actorId: user.id, journalTenantId: user.tenantId, scopeId: scope.id,
      hash: fingerprint({ stable, scopeId: scope.id, journalTenantId: user.tenantId }) };
  }
  private async check(before: Session, writing: boolean) { if ((await this.current(writing)).hash !== before.hash) throw denied(); }
  private async inTransaction<T>(tx: Prisma.TransactionClient, before: Session, work: (check: () => Promise<void>) => Promise<T>): Promise<T> {
    const participant = await this.host.begin(tx, before.actorId).catch(() => { throw denied(); });
    const currentUser = participant?.currentUser?.bind(participant);
    const check = async () => {
      if (!currentUser) return this.check(before, true);
      if (!('permissions' in before.context) || (await this.observe(tx, before.context, currentUser)).hash !== before.hash) throw denied();
      this.host.assertSelectedIdentity(before.context, true);
    };
    try {
      await check();
      const result = await work(check);
      await check();
      await participant?.revalidate().catch(() => { throw denied(); });
      return result;
    } finally { participant?.close(); }
  }
  private async locked(tx: Prisma.TransactionClient, before: Session, check: () => Promise<void>) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM ai_scopes
      WHERE id = ${before.scopeId} AND kind = 'platform' AND scopeKey = 'platform'
        AND tenantId IS NULL AND workspaceId IS NULL FOR UPDATE`);
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== before.scopeId) throw unavailable();
    await check();
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
  private async record(tx: Prisma.TransactionClient, before: Session, kind: Kind, resourceId: string, targetHash: string, check: () => Promise<void>) {
    const old = await this.previous(tx, before, kind, resourceId);
    if (old) { if (old.targetHash !== targetHash) throw denied(); return; }
    const digest = receiptId(before.scopeId, kind, resourceId);
    await check();
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
  private taskReceipt(tx: Prisma.TransactionClient, before: Session, taskId: string, check: () => Promise<void>) {
    return { id: receiptId(before.scopeId, 'task', taskId),
      read: async () => { const row = await this.previous(tx, before, 'task', taskId);
        return row ? { ...row, kind: 'task' as const } : null; },
      record: (targetHash: string) => this.record(tx, before, 'task', taskId, targetHash, check) };
  }
  private async eraseRequest(tx: Prisma.TransactionClient, before: Session, resourceId: string, check: () => Promise<void>, expectedHash?: string) {
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
    for (const task of tasks) await this.host.eraseTaskBodies(tx, { scopeId: before.scopeId, owner: { tenantId: null, workspaceId: null },
      taskId: task.id, now: this.now(), check, platformReceipt: this.taskReceipt(tx, before, task.id, check) }, undefined, true);
    await check();
    const changed = await tx.aiTaskOriginalRequest.updateMany({ where: { id: row.id, scopeId: before.scopeId,
      audience: row.audience, ownerKind: row.ownerKind, ownerId: row.ownerId, revision: row.revision,
      contentHash: row.contentHash, erasedAt: row.erasedAt }, data: { payload: mark, erasedAt: row.erasedAt ?? this.now() } });
    if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    await this.record(tx, before, 'request', row.id, targetHash, check);
    return { id: mark.receiptId, state: 'erased' as const, replayed: Boolean(old) };
  }
  async erase(kind: Kind, resourceId: string, restore?: AiPlatformRetentionRestorePermit) {
    kindSchema.parse(kind); id.parse(resourceId);
    const before = await this.current(true), expected = restore && requirePlatformRestorePermit(restore, this.restoreKeyHash,
      before.scopeId, this.now()).tombstones.find(item => item.kind === kind && item.resourceId === resourceId)?.targetHash;
    if (restore && !expected) throw denied();
    let attempted = false, committed = false;
    try {
      const result = await this.db.$transaction(tx => this.inTransaction(tx, before, async check => {
        await this.locked(tx, before, check);
        const exists = kind === 'task' ? await tx.aiTask.findFirst({ where: { id: resourceId, scopeId: before.scopeId } })
          : await tx.aiTaskOriginalRequest.findFirst({ where: { id: resourceId, scopeId: before.scopeId } });
        if (!exists) {
          if (!expected) throw unavailable();
          attempted = true; await this.record(tx, before, kind, resourceId, expected, check);
          return { id: receiptId(before.scopeId, kind, resourceId), state: 'erased' as const, absentInSnapshot: true as const };
        }
        if (exists.ownerKind !== 'SAAS_ADMIN' || exists.audience !== 'OPERATOR'
          || 'scopeKind' in exists && exists.scopeKind !== 'PLATFORM') throw denied();
        if (kind === 'task' && await aiTaskHasUnresolvedEffects(tx, before.scopeId, resourceId, { tenantId: null, workspaceId: null }))
          return { id: receiptId(before.scopeId, kind, resourceId), state: 'held' as const, reason: 'unresolved_effects' as const };
        // A lost transaction response never proves no write. The page can only
        // be resolved from this exact resource's durable deletion journal.
        attempted = true;
        const result = kind === 'request' ? await this.eraseRequest(tx, before, resourceId, check, expected || undefined)
          : await this.host.eraseTaskBodies(tx, { scopeId: before.scopeId, owner: { tenantId: null, workspaceId: null },
            taskId: resourceId, now: this.now(), check,
            platformReceipt: this.taskReceipt(tx, before, resourceId, check) }, expected || undefined);
        await check(); return result;
      }), { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      committed = true;
      await this.check(before, true); return result;
    } catch (error) {
      if (committed && attempted) throw new AiRetentionUnknown();
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
      archivedAt: null, ...page }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' }, take: command.limit })
      : await this.db.aiTaskOriginalRequest.findMany({ where: { scopeId: before.scopeId, ownerKind: 'SAAS_ADMIN',
        audience: 'OPERATOR', createdAt: { lte: cutoff }, erasedAt: null, ...page }, select: { id: true, createdAt: true },
        orderBy: { id: 'asc' }, take: command.limit });
    await this.check(before, true); if (rows.length > command.limit) throw unavailable();
    const results = [];
    for (const row of rows) {
      try { results.push(await this.erase(command.kind, row.id)); }
      catch (error) { if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') {
          if (results.some(row => ['erased', 'withdrawn', 'prepared', 'unknown'].includes(row.state))) throw new AiRetentionUnknown();
          throw error;
        }
        results.push({ state: error instanceof AiRetentionUnknown ? 'unknown' as const : 'unavailable' as const,
          retryable: false as const, nextAction: 'list_retention_receipts' as const }); }
    }
    try { await this.check(before, true); }
    catch (error) {
      // Earlier items may already have committed; loss of authority cannot
      // turn their outcome into a confirmed no-write result.
      if (results.some(row => ['erased', 'withdrawn', 'prepared', 'unknown'].includes(row.state))) throw new AiRetentionUnknown();
      throw error;
    }
    const nextAfter = rows.length === command.limit ? rows[rows.length - 1].id : null;
    const candidates = rows.map(row => retentionCandidate(row.id, 'updatedAt' in row ? row.updatedAt : row.createdAt));
    logRetentionPage({ scopeKind: 'platform', scopeId: before.scopeId, kind: command.kind, after: command.after }, this.now(), candidates, results, nextAfter);
    return { policyVersion: AI_RETENTION_POLICY.version, scanned: rows.length, limit: command.limit, results,
      nextAfter,
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
      scopeId: before.scopeId, tenantId: null, workspaceId: null, check: () => this.check(before, true),
      withAuthority: (tx, protect) => this.inTransaction(tx, before, protect) });
  }
  async exportRestoreManifest(snapshot: { id: string; sha256: string; createdAt: string }, privateKey: KeyObject) {
    const before = await this.current(true);
    if (!this.restoreKeyHash || retentionPublicKeyHash(privateKey) !== this.restoreKeyHash) throw unavailable();
    const rows = await this.db.$transaction(async tx => {
      const result = [];
      let after: string | undefined;
      do {
        const page = await tx.operationLog.findMany({ where: { action: journalAction, workspaceId: null,
          detail: { path: '$.scopeId', equals: before.scopeId }, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 250 });
        result.push(...page.map(row => this.checked(row, before.scopeId)));
        after = page.length === 250 ? page[249].id : undefined;
      } while (after);
      return result;
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.RepeatableRead });
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
