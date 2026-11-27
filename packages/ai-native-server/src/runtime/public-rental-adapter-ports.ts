/** Common participants used by the independent Rental adapter. This entry
 * contains only public implementations and never imports a Core. */
export { createAiTaskTransactionBoundary, type AiTaskTransactionAuthority, type AiTaskTransactionReference } from '../task-transactions';
export { beginPlatformAiManagementTransaction } from '../platform-transactions';
export { AiTaskRepositoryError } from '../task-errors';
export { aiTaskAccessFromContext } from './task-owner-access';
export type { AiTaskRepositoryAuthority } from './task-persistence.repository';
export { TaskEventReader, type TaskEventDatabase } from './task-event-reader';
export { PlatformRetentionOperations, platformRetentionCleanupSchema, type PlatformRetentionIdentity } from './privacy/platform-retention';
export { createAiTaskBodyErasure } from './privacy/task-body-erasure';
export { createAiBodyStorageDatabase } from './privacy/prisma-ai-body-storage';

/** The opted-in host binds this token to the same selected Client's AI view. */
export const AI_NATIVE_BODY_DATABASE = Symbol('AI_NATIVE_BODY_DATABASE');
