/** Original owner-scoped task list. Filters and cursors grant no access. */
import type { AiTaskStatusDraft } from './ai-task';
/** Filters narrow the current authorized owner scope; they never grant sharing.
 * Creation times are explicit instants in [createdFrom, createdBefore). */
export interface AiTaskMetadataQueryDraft {
  limit?: number; cursor?: string; status?: AiTaskStatusDraft; sceneCode?: string;
  initiatorId?: string; createdFrom?: string; createdBefore?: string;
}
export interface AiTaskMetadataPageDraft {
  items: Array<{ taskId: string; status: AiTaskStatusDraft; revision: number; sceneCode: string; sceneVersion: string;
    createdAt: string; updatedAt: string; cancelRequestedAt: string | null }>;
  nextCursor: string | null;
}

