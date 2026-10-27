import type { CreateFileUploadSessionRequest, AiExecutionContext } from '@rental-os/shared';
import type { PrismaClient } from '@prisma/client';
import type { FileBusinessOwner } from '../../integrations/file-storage.runtime.service';
import type { TenantKnowledgeObjectReader } from '../../integrations/knowledge-object-reader';
import type { KnowledgeFileAccess } from './knowledge-file-access';
import type { KnowledgeAuthorizationPort } from './knowledge.ports';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { PrismaKnowledgeRepository, type KnowledgePrismaClient } from './prisma-knowledge.repository';
import { knowledgeUploadRequest, knowledgeUploadKey, knowledgeUploadRevisionSchema } from './human-knowledge-upload.service';
import { authorize, fingerprint, parse } from './knowledge-validation';
import type { KnowledgeUploadRevision } from './knowledge.ports';
import { unavailable } from './knowledge-errors';

export class PrismaKnowledgeFileAccess implements KnowledgeFileAccess {
  readonly repository: PrismaKnowledgeRepository;
  constructor(private readonly db: KnowledgePrismaClient & Pick<PrismaClient, 'fileAsset'>,
    readonly session: KnowledgeCurrentSession, private readonly authorization: KnowledgeAuthorizationPort,
    private readonly objects: Pick<TenantKnowledgeObjectReader, 'read'> & Partial<Pick<TenantKnowledgeObjectReader, 'readUpload'>>) {
    this.repository = new PrismaKnowledgeRepository(db);
  }

  private owner(context: AiExecutionContext, tenantId: string, owner?: FileBusinessOwner) {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !['staff', 'operator'].includes(context.audience)
      || context.scope.tenantId !== tenantId || !owner || owner.workspaceId !== context.scope.workspaceId
      || owner.actorUserId !== context.actor.userId || owner.businessType !== 'ai_knowledge_document'
      || !owner.businessId || owner.uploadScene !== 'ai-knowledge') return unavailable();
    return { tenantId, workspaceId: context.scope.workspaceId, documentId: owner.businessId, actorUserId: context.actor.userId };
  }

  private async currentRevision(context: AiExecutionContext, documentId: string, revision: KnowledgeUploadRevision) {
    const current = await this.repository.read(context.scope, documentId);
    if (!current || current.revision !== revision.expectedRevision || current.document.documentVersion !== revision.documentVersion
      || current.document.aclRevision !== revision.aclRevision || current.document.publication === 'deleted' || current.parseOperationId
      || revision.targetVersion === revision.documentVersion) return unavailable();
    const existing = await this.db.aiKnowledgeVersion.findFirst({ where: { documentId, contentHash: revision.targetVersion } });
    if (existing) return unavailable();
    if (fingerprint(current) !== fingerprint(await this.repository.read(context.scope, documentId))) return unavailable();
  }

  async authorizeUpload(tenantId: string, value: CreateFileUploadSessionRequest, owner?: FileBusinessOwner) {
    const input = structuredClone(value), boundOwner = structuredClone(owner);
    const revision = boundOwner?.knowledgeRevision === undefined ? undefined : parse(knowledgeUploadRevisionSchema, boundOwner.knowledgeRevision);
    const expected = knowledgeUploadRequest({ documentId: input.businessId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, revision);
    if (fingerprint(input) !== fingerprint(expected)) return unavailable();
    return this.session.run(async context => {
      const target = this.owner(context, tenantId, boundOwner);
      if (input.businessId !== target.documentId) return unavailable();
      const request = { action: 'upload' as const, scope: context.scope, upload: { documentId: target.documentId,
        idempotencyKey: input.idempotencyKey, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, ...(revision ? { revision } : {}) } };
      const grant = await authorize(this.authorization, context, request);
      if (revision) await this.currentRevision(context, target.documentId, revision);
      else if (await this.db.aiKnowledgeDocument.findUnique({ where: { id: target.documentId }, select: { id: true } })) return unavailable();
      if (fingerprint(grant) !== fingerprint(await authorize(this.authorization, context, request))) return unavailable();
    });
  }

  async authorizeUploadObservation(tenantId: string, value: FileBusinessOwner) {
    const boundOwner = structuredClone(value);
    return this.session.run(async context => {
      const target = this.owner(context, tenantId, boundOwner);
      const before = await this.repository.read(context.scope, target.documentId);
      // Before first creation there is no document/ACL to invent. The persisted
      // actor-bound metadata policy is still mandatory; the runtime additionally
      // verifies the exact upload's stored actor and workspace before returning.
      const request = { action: 'read_metadata' as const, scope: context.scope,
        ...(before ? { document: before.document } : {}) };
      const grant = await authorize(this.authorization, context, request);
      if (fingerprint(before) !== fingerprint(await this.repository.read(context.scope, target.documentId))
        || fingerprint(grant) !== fingerprint(await authorize(this.authorization, context, request))) return unavailable();
    });
  }

  async readUploadContentHash(tenantId: string, fileAssetId: string, owner: FileBusinessOwner) {
    const boundOwner = structuredClone(owner);
    return this.session.run(async context => {
      const target = this.owner(context, tenantId, boundOwner);
      const load = () => this.db.fileAsset.findFirst({ where: { id: fileAssetId, tenantId,
        status: 'pending_upload', uploadedBy: target.actorUserId, businessModule: 'ai-native',
        businessType: 'ai_knowledge_document', businessId: target.documentId, uploadScene: 'ai-knowledge' }, include: { uploadSession: true } });
      const asset = structuredClone(await load());
      if (!asset || !asset.uploadSession?.idempotencyKey || !this.objects.readUpload) return unavailable();
      const input = { businessModule: asset.businessModule, businessType: asset.businessType,
        businessId: target.documentId, uploadScene: asset.uploadScene, fileName: asset.fileName,
        mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, idempotencyKey: asset.uploadSession.idempotencyKey };
      await this.authorizeUpload(tenantId, input, boundOwner);
      const result = await this.objects.readUpload({ tenantId, workspaceId: target.workspaceId,
        documentId: target.documentId, fileAssetId }, 262144);
      if (!/^[a-f0-9]{64}$/u.test(result.contentHash) || fingerprint(asset) !== fingerprint(await load())) return unavailable();
      await this.authorizeUpload(tenantId, input, boundOwner);
      return result.contentHash;
    });
  }

  async assertBound(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, selection?: { documentVersion: string; expectedRevision: number }) {
    const boundOwner = structuredClone(owner), selected = structuredClone(selection);
    return this.session.run(async context => {
      const target = this.owner(context, tenantId, boundOwner);
      const load = () => this.db.fileAsset.findFirst({ where: { id: fileAssetId, tenantId, status: 'active',
        businessModule: 'ai-native', businessType: 'ai_knowledge_document', businessId: target.documentId,
        uploadScene: 'ai-knowledge', uploadedBy: target.actorUserId }, include: { uploadSession: true } });
      const asset = structuredClone(await load()), metadata = asset?.metadata, session = asset?.uploadSession;
      if (!asset || asset.id !== fileAssetId || asset.tenantId !== tenantId || asset.businessId !== target.documentId
        || asset.status !== 'active' || asset.uploadedBy !== target.actorUserId || asset.storageProvider === 'local_mock'
        || !metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.workspaceId !== target.workspaceId
        || metadata.knowledgeUploadVersion !== 1 || typeof metadata.knowledgeContentHash !== 'string'
        || !/^[a-f0-9]{64}$/u.test(metadata.knowledgeContentHash) || session?.status !== 'completed' || !session.completedAt
        || session.fileAssetId !== asset.id || session.tenantId !== tenantId || session.provider !== asset.storageProvider
        || session.storageKey !== asset.storageKey) return unavailable();
      const revision = metadata.knowledgeRevision === undefined ? undefined : parse(knowledgeUploadRevisionSchema, metadata.knowledgeRevision);
      if (session.idempotencyKey !== knowledgeUploadKey(target.documentId, revision?.targetVersion)) return unavailable();
      if (revision) {
        if (!selected || selected.documentVersion !== revision.targetVersion || selected.expectedRevision !== revision.expectedRevision) return unavailable();
        await this.currentRevision(context, target.documentId, revision);
      } else if (selected && selected.expectedRevision !== 0) return unavailable();
      if (fingerprint(asset) !== fingerprint(await load())) return unavailable();
    });
  }

  async read(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, maxBytes: number, signal?: AbortSignal) {
    const boundOwner = structuredClone(owner);
    return this.session.run(async context => {
      const target = this.owner(context, tenantId, boundOwner);
      const load = () => this.repository.read(context.scope, target.documentId);
      const before = await load();
      if (!before || before.document.attachmentId !== fileAssetId || !['draft', 'published'].includes(before.document.publication)) return unavailable();
      const request = { action: 'read_body' as const, scope: context.scope, document: before.document, attachmentId: fileAssetId };
      const grant = await authorize(this.authorization, context, request);
      let result;
      try { result = await this.objects.read({ tenantId, workspaceId: target.workspaceId, documentId: target.documentId, fileAssetId }, maxBytes, signal); }
      catch { return unavailable(); }
      const after = await load();
      if (fingerprint(before) !== fingerprint(after) || signal?.aborted
        || fingerprint(grant) !== fingerprint(await authorize(this.authorization, context, request))) return unavailable();
      if (!/^[a-f0-9]{64}$/u.test(result.contentHash)
        || before.contentHash !== undefined && before.contentHash !== result.contentHash) return unavailable();
      return { mediaType: result.mediaType, bytes: result.bytes, contentHash: result.contentHash };
    });
  }
}
