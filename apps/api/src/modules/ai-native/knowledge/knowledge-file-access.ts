import type { CreateFileUploadSessionRequest } from '@rental-os/shared';
import type { FileBusinessOwner } from '../../integrations/file-storage.runtime.service';

export const KNOWLEDGE_FILE_ACCESS = Symbol('KNOWLEDGE_FILE_ACCESS');
export interface KnowledgeFileAccess {
  authorizeUpload(tenantId: string, input: CreateFileUploadSessionRequest, owner?: FileBusinessOwner): Promise<void>;
  /** Current metadata read, never a grant for a new upload or object read. */
  authorizeUploadObservation?(tenantId: string, owner: FileBusinessOwner): Promise<void>;
  assertBound(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, target?: { documentVersion: string; expectedRevision: number }): Promise<void>;
  read(tenantId: string, fileAssetId: string, owner: FileBusinessOwner, maxBytes: number, signal?: AbortSignal): Promise<{ mediaType: string; bytes: Uint8Array }>;
}
