/** Product policy approved by the owner on 2026-10-15. Durations are deletion
 * deadlines, not authorization, proof of no consumption or business retention.
 * No timer, storage read or production collection is enabled by importing it.
 */
export const AI_RETENTION_POLICY = Object.freeze({
  version: 'ai-retention-20261015-1',
  conversationDays: 30,
  unboundAiAttachmentDays: 7,
  deletedKnowledgeAndMemoryDays: 7,
  backupMaximumDays: 30,
  preserveOriginalBusinessRecords: true,
  unresolvedEffectsBlockExpiryErasure: true,
  restoreMustReplayDeletionTombstones: true,
  unconfiguredCollection: 'denied',
} as const);

export function retentionDeadline(createdAt: Date, days: 7 | 30): Date {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime()) || ![7, 30].includes(days)) {
    throw new TypeError('Invalid retention basis');
  }
  const deadline = new Date(createdAt.getTime() + days * 86400000);
  if (!Number.isFinite(deadline.getTime())) throw new TypeError('Invalid retention deadline');
  return deadline;
}
