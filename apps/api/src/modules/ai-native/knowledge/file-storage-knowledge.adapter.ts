import type { AiExecutionContext, AiKnowledgeDocumentDraft } from '@rental-os/shared';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { KnowledgeFilePort } from './knowledge.ports';
import { unavailable } from './knowledge-errors';

/** Binds knowledge attachments to the existing file asset business reference.
 * It never accepts URL/path input and never exposes the storage provider URL. */
export class FileStorageKnowledgeFileAdapter implements KnowledgeFilePort {
  constructor(private readonly runtime: Pick<FileStorageRuntimeService, 'readKnowledgeBytes' | 'assertKnowledgeBinding'>) {}
  async read(context: AiExecutionContext, document: AiKnowledgeDocumentDraft, maxBytes: number) {
    if (context.scope.kind !== 'workspace') return unavailable();
    if (!document.attachmentId || document.documentId.length > 128) return unavailable();
    return this.runtime.readKnowledgeBytes(context.scope.tenantId, document.attachmentId, {
      businessType: 'ai_knowledge_document', businessId: document.documentId,
      uploadScene: 'ai-knowledge', workspaceId: context.scope.workspaceId,
      actorUserId: context.actor.kind === 'user' ? context.actor.userId : undefined,
    }, maxBytes);
  }

  async assertBound(context: AiExecutionContext, input: { attachmentId: string; documentId: string; workspaceId: string; documentVersion?: string; expectedRevision?: number }) {
    if (context.scope.kind !== 'workspace' || context.scope.workspaceId !== input.workspaceId) return unavailable();
    await this.runtime.assertKnowledgeBinding(context.scope.tenantId, input.attachmentId, {
      businessType: 'ai_knowledge_document', businessId: input.documentId, uploadScene: 'ai-knowledge', workspaceId: input.workspaceId,
      actorUserId: context.actor.kind === 'user' ? context.actor.userId : undefined,
    }, input.documentVersion !== undefined && input.expectedRevision !== undefined
      ? { documentVersion: input.documentVersion, expectedRevision: input.expectedRevision } : undefined);
  }
}
