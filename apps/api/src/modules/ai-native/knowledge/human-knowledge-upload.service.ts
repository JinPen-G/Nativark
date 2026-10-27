import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CreateFileUploadSessionRequest, AiExecutionContext } from '@rental-os/shared';
import type { KnowledgeUploadRevision } from './knowledge.ports';
import type { PrismaKnowledgeRepository } from './prisma-knowledge.repository';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { id, parse } from './knowledge-validation';
import { unavailable } from './knowledge-errors';

export const knowledgeUploadInput = z.object({ documentId: id, fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(['text/plain', 'text/markdown']), sizeBytes: z.number().int().min(1).max(262144) }).strict();
const revisionSelection = z.object({ documentId: id, expectedRevision: z.number().int().positive(), targetVersion: id }).strict();
export const knowledgeUploadRevisionSchema = z.object({ documentVersion: id, expectedRevision: z.number().int().positive(),
  aclRevision: z.number().int().positive(), targetVersion: id }).strict();
export const knowledgeUploadKey = (documentId: string, targetVersion?: string) => `knowledge.${createHash('sha256').update(targetVersion === undefined ? documentId : `${documentId}\0${targetVersion}`).digest('hex')}`;
export function knowledgeUploadRequest(value: unknown, revision?: Pick<KnowledgeUploadRevision, 'targetVersion'>): CreateFileUploadSessionRequest {
  const input = parse(knowledgeUploadInput, value);
  return { businessModule: 'ai-native', businessType: 'ai_knowledge_document', businessId: input.documentId,
    uploadScene: 'ai-knowledge', fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    idempotencyKey: knowledgeUploadKey(input.documentId, revision?.targetVersion) };
}

export class HumanKnowledgeUploadService {
  constructor(private readonly session: KnowledgeCurrentSession,
    private readonly runtime: Pick<FileStorageRuntimeService, 'createUploadSession' | 'completeUpload'> & Partial<Pick<FileStorageRuntimeService, 'readKnowledgeUpload' | 'findKnowledgeUpload'>>,
    private readonly repository: Pick<PrismaKnowledgeRepository, 'read'>) {}

  begin(value: unknown) {
    const input = knowledgeUploadRequest(value);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') return unavailable();
      const result = await this.runtime.createUploadSession(context.scope.tenantId, input, {
        businessType: input.businessType, businessId: input.businessId, uploadScene: input.uploadScene,
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId });
      return { ...result, documentId: input.businessId, semantics: 'upload_intent_not_document' as const };
    });
  }

  private async revision(context: AiExecutionContext, input: z.infer<typeof revisionSelection>): Promise<KnowledgeUploadRevision> {
    const current = await this.repository.read(context.scope, input.documentId);
    if (!current || current.revision !== input.expectedRevision || current.parseOperationId || current.document.publication === 'deleted'
      || current.document.documentVersion === input.targetVersion) return unavailable();
    return { documentVersion: current.document.documentVersion, aclRevision: current.document.aclRevision,
      expectedRevision: current.revision, targetVersion: input.targetVersion };
  }

  beginRevision(value: unknown) {
    const input = parse(knowledgeUploadInput.extend({ expectedRevision: z.number().int().positive(), targetVersion: id }).strict(), value);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') return unavailable();
      const revision = await this.revision(context, input);
      const request = knowledgeUploadRequest({ documentId: input.documentId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, revision);
      const result = await this.runtime.createUploadSession(context.scope.tenantId, request, {
        businessType: request.businessType, businessId: request.businessId, uploadScene: request.uploadScene,
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId, knowledgeRevision: revision });
      return { ...result, documentId: input.documentId, targetVersion: input.targetVersion, expectedRevision: input.expectedRevision,
        semantics: 'upload_intent_not_revision_commit' as const };
    });
  }

  completeRevision(value: unknown) {
    const input = parse(revisionSelection.extend({ sessionId: id }).strict(), value);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') return unavailable();
      const revision = await this.revision(context, input);
      const asset = await this.runtime.completeUpload(context.scope.tenantId, input.sessionId, {}, {
        businessType: 'ai_knowledge_document', businessId: input.documentId, uploadScene: 'ai-knowledge',
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId, knowledgeRevision: revision });
      return { attachmentId: asset.id, documentId: input.documentId, documentVersion: input.targetVersion, expectedRevision: input.expectedRevision,
        status: 'attachment_bound' as const, semantics: 'uploaded_not_revised_or_published' as const };
    });
  }

  observe(value: unknown) {
    const input = parse(z.object({ documentId: id, sessionId: id }).strict(), value);
    return this.observeOriginal(input);
  }

  findOriginal(value: unknown, revision = false) {
    const revised = revision ? parse(knowledgeUploadInput.extend({ expectedRevision: revisionSelection.shape.expectedRevision,
      targetVersion: id }).strict(), value) : undefined;
    const input = revised ?? parse(knowledgeUploadInput, value);
    const selected = revised ? { expectedRevision: revised.expectedRevision, targetVersion: revised.targetVersion } : undefined;
    const original = knowledgeUploadRequest({ documentId: input.documentId, fileName: input.fileName,
      mimeType: input.mimeType, sizeBytes: input.sizeBytes }, selected);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !this.runtime.findKnowledgeUpload) return unavailable();
      const result = await this.runtime.findKnowledgeUpload(context.scope.tenantId, original, {
        businessType: 'ai_knowledge_document', businessId: input.documentId, uploadScene: 'ai-knowledge',
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId }, selected);
      // Observations never deliver a signed upload capability, including when
      // the original intent still happens to be within its expiry period.
      const upload = result ? { sessionId: result.sessionId, fileAssetId: result.fileAssetId, provider: result.provider,
        mode: result.mode, status: result.status, expiresAt: result.expiresAt } : null;
      const observation = { documentId: input.documentId, automaticRetry: false as const, execution: 'not_attested' as const,
        semantics: 'original_upload_intent_not_document_commit' as const };
      return upload ? { ...observation, state: 'observed' as const, upload } : { ...observation, state: 'unknown' as const, upload: null };
    });
  }

  observeRevision(value: unknown) {
    const input = parse(revisionSelection.extend({ sessionId: id }).strict(), value);
    return this.observeOriginal(input);
  }

  private observeOriginal(input: { documentId: string; sessionId: string; expectedRevision?: number; targetVersion?: string }) {
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !this.runtime.readKnowledgeUpload) return unavailable();
      const revision = input.expectedRevision === undefined || input.targetVersion === undefined ? undefined
        : await this.revision(context, { documentId: input.documentId, expectedRevision: input.expectedRevision, targetVersion: input.targetVersion });
      const result = await this.runtime.readKnowledgeUpload(context.scope.tenantId, input.sessionId, {
        businessType: 'ai_knowledge_document', businessId: input.documentId, uploadScene: 'ai-knowledge',
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId, ...(revision ? { knowledgeRevision: revision } : {}) });
      return { ...result, documentId: input.documentId, ...(revision ? { targetVersion: revision.targetVersion, expectedRevision: revision.expectedRevision } : {}),
        semantics: 'observed_upload_not_document_commit' as const };
    });
  }

  complete(value: unknown) {
    const input = parse(z.object({ documentId: id, sessionId: id }).strict(), value);
    return this.session.run(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') return unavailable();
      const asset = await this.runtime.completeUpload(context.scope.tenantId, input.sessionId, {}, {
        businessType: 'ai_knowledge_document', businessId: input.documentId, uploadScene: 'ai-knowledge',
        workspaceId: context.scope.workspaceId, actorUserId: context.actor.userId });
      return { attachmentId: asset.id, documentId: input.documentId, status: 'attachment_bound' as const,
        semantics: 'uploaded_not_created_or_published' as const };
    });
  }
}
