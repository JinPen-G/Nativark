import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CreateFileUploadSessionRequest } from '@rental-os/shared';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { id, parse } from './knowledge-validation';
import { unavailable } from './knowledge-errors';

export const knowledgeUploadInput = z.object({ documentId: id, fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(['text/plain', 'text/markdown']), sizeBytes: z.number().int().min(1).max(262144) }).strict();
export const knowledgeUploadKey = (documentId: string) => `knowledge.${createHash('sha256').update(documentId).digest('hex')}`;
export function knowledgeUploadRequest(value: unknown): CreateFileUploadSessionRequest {
  const input = parse(knowledgeUploadInput, value);
  return { businessModule: 'ai-native', businessType: 'ai_knowledge_document', businessId: input.documentId,
    uploadScene: 'ai-knowledge', fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes,
    idempotencyKey: knowledgeUploadKey(input.documentId) };
}

export class HumanKnowledgeUploadService {
  constructor(private readonly session: KnowledgeCurrentSession,
    private readonly runtime: Pick<FileStorageRuntimeService, 'createUploadSession' | 'completeUpload'>) {}

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
