/** Bind the original uploaded evidence under Auth/Core/order/file locks. Media is
 * opened once outside transactions; only its original metadata CAS is persisted. */
import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiInspectionSourceDraft } from '@rental-os/shared';
import type { AiInspectionActorScope, AiInspectionEvidenceRef, AiInspectionTarget } from '@rental-os/shared';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import type { InspectionEvidenceAuthority } from './inspection-candidate.service';
import type { InspectionDraftEvidence } from './inspection-draft.service';
import type { FileStorageRuntimeService } from '../rental-adapters/file-storage.runtime.service';
import type { inspectionRecognitionInputSchema } from './inspection-draft.service';
import type { RentalAuthService } from '@rental-os/rental-core/auth-service';
import type { RentalCoreFactStore } from '@rental-os/rental-core/mysql-core-facts';
import { assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';

const bindSchema = inspectionTargetSchema.extend({ templateId: inspectionId, attachmentId: inspectionId }).strict();
type Binding = Awaited<ReturnType<InspectionTemplateService['read']>>;
type Database = Pick<PrismaClient, 'aiInspectionEvidenceBinding' | 'fileAsset' | '$transaction'>;
type EvidenceReader = Pick<Prisma.TransactionClient, 'aiInspectionEvidenceBinding' | 'fileAsset'>;
export interface InspectionEvidenceTransactionPorts {
  auth: Pick<RentalAuthService, 'lockRequestWorkspaceAccess'>;
  orders: Pick<RentalCoreFactStore, 'findOrder' | 'lockOrder'>;
}
const scopeOf = (binding: Binding): AiInspectionActorScope => {
  if (binding.audience !== 'staff' && binding.audience !== 'operator') throw new InspectionAssistError('ACCESS_DENIED');
  return { tenantId: binding.scope.tenantId, workspaceId: binding.scope.workspaceId, ownerId: binding.owner.actorId, audience: binding.audience };
};
const targetOf = (binding: Binding): AiInspectionTarget => ({ orderId: binding.orderId, allocationId: binding.allocationId, stage: binding.stage, templateId: binding.template.id });

export class PrismaInspectionEvidenceAuthority implements InspectionEvidenceAuthority, InspectionDraftEvidence {
  constructor(private readonly db: Database, private readonly authority: InspectionActionAuthority, private readonly templates: InspectionTemplateService,
    private readonly storage?: Pick<FileStorageRuntimeService, 'readInspectionBytes'>,
    private readonly transactions?: InspectionEvidenceTransactionPorts) {}

  async readMedia(value: unknown, signal: AbortSignal, maxBytes = 20 * 1024 * 1024) {
    const input = parseInspectionInput(bindSchema.extend({ attachmentRevision: z.number().int().positive() }).strict(), value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
    if (!this.storage) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const storage = this.storage;
    return this.authority.withAction(target, 'bind', async scope => {
      const { binding, row } = await this.transaction(target, scope, input.attachmentId, async (tx, binding) => {
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        return { binding, row: await this.current(binding, input, tx) };
      });
      // No database lock spans the original object transport. Revocation after
      // dispatch cannot undo this read, and never authorizes a second transport.
      const result = await storage.readInspectionBytes(scope.tenantId, row.attachmentId, { workspaceId: scope.workspaceId,
        actorUserId: scope.ownerId, businessType: 'rental_order', businessId: target.orderId, uploadScene: `${target.stage}-evidence` }, maxBytes, signal);
      await this.transaction(target, scope, input.attachmentId, async (tx, after) => {
        const current = await this.current(after, input, tx);
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        if (after.bindingFingerprint !== binding.bindingFingerprint || current.id !== row.id
          || current.storageFingerprint !== row.storageFingerprint || row.contentHash && row.contentHash !== result.contentHash
          || current.contentHash && current.contentHash !== result.contentHash) throw new InspectionAssistError('BINDING_CHANGED');
        const changed = await tx.aiInspectionEvidenceBinding.updateMany({ where: { id: row.id, ...scope,
          storageFingerprint: row.storageFingerprint, contentHash: row.contentHash }, data: { contentHash: result.contentHash,
          mediaType: result.mediaType, sizeBytes: result.sizeBytes, width: result.width, height: result.height, durationMs: result.durationMs } });
        if (changed.count !== 1) {
          const recovered = await this.current(after, input, tx);
          if (recovered.contentHash !== result.contentHash) throw new InspectionAssistError('BINDING_CHANGED');
        }
      });
      return result;
    });
  }

  async bind(value: unknown) {
    const input = parseInspectionInput(bindSchema, value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, stage: input.stage, templateId: input.templateId };
    return this.authority.withAction(target, 'bind', async scope => {
      let attempted: { attachmentId: string; attachmentRevision: number; storageFingerprint: string; bindingFingerprint: string } | undefined;
      let createFailed = false, readyToCommit = false;
      try {
        return await this.transaction(target, scope, input.attachmentId, async (tx, binding) => {
          const asset = await this.asset(scope, target, input.attachmentId, tx), storageFingerprint = this.storageHash(asset);
          const prior = await tx.aiInspectionEvidenceBinding.findFirst({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId, attachmentId: asset.id },
            orderBy: { attachmentRevision: 'desc' } });
          if (prior && (prior.bindingFingerprint !== binding.bindingFingerprint || prior.ownerId !== scope.ownerId || prior.audience !== scope.audience)) {
            throw new InspectionAssistError('BINDING_CHANGED');
          }
          if (prior?.storageFingerprint === storageFingerprint) return { attachmentId: prior.attachmentId, attachmentRevision: prior.attachmentRevision };
          const revision = (prior?.attachmentRevision ?? 0) + 1;
          if (revision > 1000) throw new InspectionAssistError('INVALID_INPUT');
          attempted = { attachmentId: asset.id, attachmentRevision: revision, storageFingerprint, bindingFingerprint: binding.bindingFingerprint };
          try {
            await tx.aiInspectionEvidenceBinding.create({ data: { id: randomUUID(), ...scope, ...target,
              assetId: binding.assetId, templateVersion: binding.template.version, bindingFingerprint: binding.bindingFingerprint,
              attachmentId: asset.id, attachmentRevision: revision, uploadSessionId: asset.uploadSession!.id, storageFingerprint } });
          } catch (error) { createFailed = true; throw error; }
          return { attachmentId: asset.id, attachmentRevision: revision };
        }, () => { readyToCommit = true; });
      } catch (error) {
        // A write/commit uncertainty is reconciled only against this exact original
        // tuple. Permission/lease failures roll back and never enter recovery.
        if (!attempted || !createFailed && !readyToCommit) throw error;
        const candidate = attempted;
        try {
          const recovered = await this.db.aiInspectionEvidenceBinding.findUnique({ where: { tenantId_workspaceId_attachmentId_attachmentRevision: {
            tenantId: scope.tenantId, workspaceId: scope.workspaceId, attachmentId: candidate.attachmentId, attachmentRevision: candidate.attachmentRevision } } });
          if (!recovered || recovered.storageFingerprint !== candidate.storageFingerprint || recovered.bindingFingerprint !== candidate.bindingFingerprint
            || recovered.ownerId !== scope.ownerId || recovered.audience !== scope.audience) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
          return { attachmentId: candidate.attachmentId, attachmentRevision: candidate.attachmentRevision };
        } catch { throw new InspectionAssistError('RECONCILIATION_REQUIRED'); }
      }
    });
  }

  private async transaction<T>(target: AiInspectionTarget, scope: AiInspectionActorScope, attachmentId: string,
    consume: (tx: Prisma.TransactionClient, binding: Binding) => Promise<T>, readyToCommit?: () => void): Promise<T> {
    const ports = this.transactions;
    if (typeof ports?.auth?.lockRequestWorkspaceAccess !== 'function' || typeof ports.orders?.lockOrder !== 'function'
      || typeof ports.orders.findOrder !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    return this.db.$transaction(async tx => {
      // The original Auth lease owns Tenant X before user/session/role locks.
      // Core revalidation must use this transaction before any order or file lock.
      const lease = await ports.auth.lockRequestWorkspaceAccess(tx);
      await assertRentalBusinessTenantAccessAfterLock(tx, scope.tenantId);
      await this.authority.assertTransactionScope(target, scope, lease.user, tx);
      await ports.orders.lockOrder(scope.tenantId, target.orderId, tx);
      const files = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM FileAsset
        WHERE id=${attachmentId} AND tenantId=${scope.tenantId} AND businessModule='rental-core'
        AND businessType='rental_order' AND businessId=${target.orderId} AND uploadedBy=${scope.ownerId} FOR UPDATE`);
      if (files.length !== 1) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const sessions = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM file_upload_sessions
        WHERE fileAssetId=${attachmentId} AND tenantId=${scope.tenantId} FOR UPDATE`);
      if (sessions.length !== 1) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const binding = await this.templates.readInTransaction(target, tx);
      this.assertScope(binding, scope);
      const result = await consume(tx, binding);
      await this.authority.assertTransactionScope(target, scope, await lease.revalidate(), tx);
      // The parent rows remain locked, but a detached/closed request must still
      // fail before commit; this is the same fence, never a new request selection.
      await assertRentalBusinessTenantAccessAfterLock(tx, scope.tenantId);
      readyToCommit?.();
      return result;
    }, { isolationLevel: 'ReadCommitted' });
  }

  async fingerprint(target: AiInspectionTarget, refs: AiInspectionEvidenceRef[]) {
    const snapshot = structuredClone(refs);
    if (snapshot.length > 100 || new Set(snapshot.map(row => row.attachmentId)).size !== snapshot.length) throw new InspectionAssistError('INVALID_INPUT');
    return this.authority.withAction(target, 'write', async scope => {
      const binding = await this.templates.read(target);
      this.assertScope(binding, scope);
      const evidence = [];
      for (const ref of snapshot) evidence.push(await this.current(binding, ref));
      for (const ref of snapshot) await this.current(binding, ref);
      const after = await this.templates.read(target);
      if (after.bindingFingerprint !== binding.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      return requestFingerprint(evidence.sort((a, b) => a.attachmentId.localeCompare(b.attachmentId)).map(row => ({
        attachmentId: row.attachmentId, attachmentRevision: row.attachmentRevision, storageFingerprint: row.storageFingerprint, contentHash: row.contentHash })));
    });
  }

  async verify(binding: Binding, source: AiInspectionSourceDraft): Promise<boolean> {
    const row = await this.current(binding, source);
    if (!row.contentHash || !row.mediaType) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    if (source.kind === 'image') return row.mediaType.startsWith('image/') && !!row.width && !!row.height;
    return row.mediaType.startsWith('audio/') && row.durationMs !== null && source.span.endMs <= row.durationMs;
  }

  /** Read the original bound file metadata without opening bytes, rebinding a
   * file or requiring inspection-write permission. Current original file ACL
   * and both metadata snapshots still have to match the frozen input. */
  async readOriginalMetadata(value: { target: AiInspectionTarget; assetId: string; templateVersion: string;
    bindingFingerprint: string; media: z.infer<typeof inspectionRecognitionInputSchema>['media'] }) {
    const snapshot = structuredClone(value);
    if (!snapshot.media.length || snapshot.media.length > 8) throw new InspectionAssistError('INVALID_INPUT');
    return this.authority.withAction(snapshot.target, 'read', async scope => {
      const read = async () => {
        const rows = [];
        for (const ref of snapshot.media) {
          const row = await this.db.aiInspectionEvidenceBinding.findFirst({ where: { ...scope, ...snapshot.target,
            assetId: snapshot.assetId, templateVersion: snapshot.templateVersion, bindingFingerprint: snapshot.bindingFingerprint,
            attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision } });
          if (!row) throw new InspectionAssistError('BINDING_CHANGED');
          const asset = await this.asset(scope, snapshot.target, ref.attachmentId);
          if (row.uploadSessionId !== asset.uploadSession!.id || row.storageFingerprint !== this.storageHash(asset)
            || row.contentHash !== ref.contentHash || row.mediaType !== ref.mediaType || row.sizeBytes !== ref.sizeBytes
            || row.width !== ref.width || row.height !== ref.height || row.durationMs !== ref.durationMs)
            throw new InspectionAssistError('BINDING_CHANGED');
          rows.push(row);
        }
        return rows;
      };
      const before = await read(), after = await read();
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new InspectionAssistError('BINDING_CHANGED');
      return requestFingerprint(before);
    });
  }

  async verifyPhoto(binding: Binding, attachmentId: string): Promise<boolean> {
    const scope = scopeOf(binding);
    const row = await this.db.aiInspectionEvidenceBinding.findFirst({ where: { ...scope, attachmentId }, orderBy: { attachmentRevision: 'desc' } });
    if (!row) return false;
    await this.current(binding, { attachmentId, attachmentRevision: row.attachmentRevision });
    const asset = await this.asset(scope, targetOf(binding), attachmentId);
    return asset.mimeType.startsWith('image/');
  }

  async current(binding: Binding, ref: AiInspectionEvidenceRef, database: EvidenceReader = this.db) {
    const scope = scopeOf(binding), target = targetOf(binding);
    const row = await database.aiInspectionEvidenceBinding.findFirst({ where: { ...scope, ...target, attachmentId: ref.attachmentId,
      attachmentRevision: ref.attachmentRevision, assetId: binding.assetId, templateVersion: binding.template.version, bindingFingerprint: binding.bindingFingerprint } });
    if (!row) throw new InspectionAssistError('BINDING_CHANGED');
    const asset = await this.asset(scope, target, ref.attachmentId, database);
    if (row.uploadSessionId !== asset.uploadSession!.id || row.storageFingerprint !== this.storageHash(asset)) throw new InspectionAssistError('BINDING_CHANGED');
    return row;
  }

  private async asset(scope: AiInspectionActorScope, target: AiInspectionTarget, id: string, database: EvidenceReader = this.db) {
    const asset = await database.fileAsset.findFirst({ where: { id, tenantId: scope.tenantId, uploadedBy: scope.ownerId,
      businessModule: 'rental-core', businessType: 'rental_order', businessId: target.orderId, uploadScene: `${target.stage}-evidence`, status: 'active' }, include: { uploadSession: true } });
    if (!asset?.uploadSession || asset.uploadSession.status !== 'completed' || !asset.uploadSession.completedAt
      || asset.uploadSession.tenantId !== scope.tenantId || asset.uploadSession.storageKey !== asset.storageKey
      || asset.storageProvider === 'local_mock') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    return asset;
  }

  private storageHash(asset: NonNullable<Awaited<ReturnType<PrismaInspectionEvidenceAuthority['asset']>>>) {
    return requestFingerprint({ id: asset.id, tenantId: asset.tenantId, provider: asset.storageProvider, key: asset.storageKey,
      mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, updatedAt: asset.updatedAt.toISOString(),
      session: asset.uploadSession!.id, completedAt: asset.uploadSession!.completedAt!.toISOString() });
  }

  private assertScope(binding: Binding, scope: AiInspectionActorScope) {
    if (requestFingerprint(scopeOf(binding)) !== requestFingerprint(scope)) throw new InspectionAssistError('ACCESS_DENIED');
  }
}
