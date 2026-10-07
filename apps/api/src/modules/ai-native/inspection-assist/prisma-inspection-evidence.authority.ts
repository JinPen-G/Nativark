import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiInspectionSourceDraft } from '@rental-os/shared';
import type { AiInspectionActorScope, AiInspectionEvidenceRef, AiInspectionTarget } from '../../../../../../packages/shared/src/ai-inspection-persistence';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import type { InspectionEvidenceAuthority } from './inspection-candidate.service';
import type { InspectionDraftEvidence } from './inspection-draft.service';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';

const bindSchema = inspectionTargetSchema.extend({ templateId: inspectionId, attachmentId: inspectionId }).strict();
type Binding = Awaited<ReturnType<InspectionTemplateService['read']>>;
type Database = Pick<PrismaClient, 'aiInspectionEvidenceBinding' | 'fileAsset' | '$transaction'>;
const scopeOf = (binding: Binding): AiInspectionActorScope => {
  if (binding.audience !== 'staff' && binding.audience !== 'operator') throw new InspectionAssistError('ACCESS_DENIED');
  return { tenantId: binding.scope.tenantId, workspaceId: binding.scope.workspaceId, ownerId: binding.owner.actorId, audience: binding.audience };
};
const targetOf = (binding: Binding): AiInspectionTarget => ({ orderId: binding.orderId, allocationId: binding.allocationId, stage: binding.stage, templateId: binding.template.id });

export class PrismaInspectionEvidenceAuthority implements InspectionEvidenceAuthority, InspectionDraftEvidence {
  constructor(private readonly db: Database, private readonly authority: InspectionActionAuthority, private readonly templates: InspectionTemplateService,
    private readonly storage?: Pick<FileStorageRuntimeService, 'readInspectionBytes'>) {}

  async readMedia(value: unknown, signal: AbortSignal, maxBytes = 20 * 1024 * 1024) {
    const input = parseInspectionInput(bindSchema.extend({ attachmentRevision: z.number().int().positive() }).strict(), value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
    if (!this.storage) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const storage = this.storage;
    return this.authority.withAction(target, 'bind', async scope => {
      const binding = await this.templates.read(target);
      this.assertScope(binding, scope);
      const row = await this.current(binding, input);
      const result = await storage.readInspectionBytes(scope.tenantId, row.attachmentId, { workspaceId: scope.workspaceId,
        actorUserId: scope.ownerId, businessType: 'rental_order', businessId: target.orderId, uploadScene: `${target.stage}-evidence` }, maxBytes, signal);
      await this.current(binding, input);
      const after = await this.templates.read(target);
      if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (after.bindingFingerprint !== binding.bindingFingerprint || row.contentHash && row.contentHash !== result.contentHash) throw new InspectionAssistError('BINDING_CHANGED');
      const changed = await this.db.aiInspectionEvidenceBinding.updateMany({ where: { id: row.id, ...scope,
        storageFingerprint: row.storageFingerprint, contentHash: row.contentHash }, data: { contentHash: result.contentHash,
        mediaType: result.mediaType, sizeBytes: result.sizeBytes, width: result.width, height: result.height, durationMs: result.durationMs } });
      if (changed.count !== 1) {
        const current = await this.current(after, input);
        if (current.contentHash !== result.contentHash) throw new InspectionAssistError('BINDING_CHANGED');
      }
      return result;
    });
  }

  async bind(value: unknown) {
    const input = parseInspectionInput(bindSchema, value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, stage: input.stage, templateId: input.templateId };
    return this.authority.withAction(target, 'bind', async scope => {
      const binding = await this.templates.read(target);
      this.assertScope(binding, scope);
      const asset = await this.asset(scope, target, input.attachmentId);
      const storageFingerprint = this.storageHash(asset);
      const prior = await this.db.aiInspectionEvidenceBinding.findFirst({ where: { tenantId: scope.tenantId, workspaceId: scope.workspaceId, attachmentId: asset.id },
        orderBy: { attachmentRevision: 'desc' } });
      if (prior && (prior.bindingFingerprint !== binding.bindingFingerprint || prior.ownerId !== scope.ownerId || prior.audience !== scope.audience)) {
        throw new InspectionAssistError('BINDING_CHANGED');
      }
      if (prior?.storageFingerprint === storageFingerprint) return { attachmentId: prior.attachmentId, attachmentRevision: prior.attachmentRevision };
      const revision = (prior?.attachmentRevision ?? 0) + 1;
      if (revision > 1000) throw new InspectionAssistError('INVALID_INPUT');
      const after = await this.templates.read(target);
      if (after.bindingFingerprint !== binding.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      return this.authority.withAction(target, 'bind', async current => {
        this.assertScope(binding, current);
        const fresh = await this.asset(current, target, asset.id);
        if (this.storageHash(fresh) !== storageFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
        try {
          await this.db.aiInspectionEvidenceBinding.create({ data: { id: randomUUID(), ...scope, ...target,
            assetId: binding.assetId, templateVersion: binding.template.version, bindingFingerprint: binding.bindingFingerprint,
            attachmentId: asset.id, attachmentRevision: revision, uploadSessionId: fresh.uploadSession!.id, storageFingerprint } });
        } catch {
          const recovered = await this.db.aiInspectionEvidenceBinding.findUnique({ where: { tenantId_workspaceId_attachmentId_attachmentRevision: {
            tenantId: scope.tenantId, workspaceId: scope.workspaceId, attachmentId: asset.id, attachmentRevision: revision } } });
          if (!recovered || recovered.storageFingerprint !== storageFingerprint || recovered.bindingFingerprint !== binding.bindingFingerprint
            || recovered.ownerId !== scope.ownerId || recovered.audience !== scope.audience) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        }
        return { attachmentId: asset.id, attachmentRevision: revision };
      });
    });
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

  async verifyPhoto(binding: Binding, attachmentId: string): Promise<boolean> {
    const scope = scopeOf(binding);
    const row = await this.db.aiInspectionEvidenceBinding.findFirst({ where: { ...scope, attachmentId }, orderBy: { attachmentRevision: 'desc' } });
    if (!row) return false;
    await this.current(binding, { attachmentId, attachmentRevision: row.attachmentRevision });
    const asset = await this.asset(scope, targetOf(binding), attachmentId);
    return asset.mimeType.startsWith('image/');
  }

  async current(binding: Binding, ref: AiInspectionEvidenceRef) {
    const scope = scopeOf(binding), target = targetOf(binding);
    const row = await this.db.aiInspectionEvidenceBinding.findFirst({ where: { ...scope, ...target, attachmentId: ref.attachmentId,
      attachmentRevision: ref.attachmentRevision, assetId: binding.assetId, templateVersion: binding.template.version, bindingFingerprint: binding.bindingFingerprint } });
    if (!row) throw new InspectionAssistError('BINDING_CHANGED');
    const asset = await this.asset(scope, target, ref.attachmentId);
    if (row.uploadSessionId !== asset.uploadSession!.id || row.storageFingerprint !== this.storageHash(asset)) throw new InspectionAssistError('BINDING_CHANGED');
    return row;
  }

  private async asset(scope: AiInspectionActorScope, target: AiInspectionTarget, id: string) {
    const asset = await this.db.fileAsset.findFirst({ where: { id, tenantId: scope.tenantId, uploadedBy: scope.ownerId,
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
