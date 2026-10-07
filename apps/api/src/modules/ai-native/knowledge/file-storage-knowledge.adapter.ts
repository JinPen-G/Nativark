import type { AiExecutionContext, AiKnowledgeDocumentDraft } from '@rental-os/shared';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { KnowledgeFilePort } from './knowledge.ports';
import { unavailable } from './knowledge-errors';

/** Binds knowledge attachments to the existing file asset business reference.
 * It never accepts URL/path input and never exposes the storage provider URL. */
export class FileStorageKnowledgeFileAdapter implements KnowledgeFilePort {
  constructor(private readonly runtime: Pick<FileStorageRuntimeService, 'readKnowledgeBytes'>) {}
  async read(context: AiExecutionContext, document: AiKnowledgeDocumentDraft, maxBytes: number) {
    if (context.scope.kind !== 'workspace') return unavailable();
    if (!document.attachmentId || document.documentId.length > 128) return unavailable();
    return this.runtime.readKnowledgeBytes(context.scope.tenantId, document.attachmentId, {
      businessType: 'ai_knowledge_document', businessId: document.documentId,
      uploadScene: 'ai-knowledge', workspaceId: context.scope.workspaceId,
      actorUserId: context.actor.kind === 'user' ? context.actor.userId : undefined,
    }, maxBytes);
  }
}
