/** Existing Rental source visibility and propagation on the original transaction. */
import type { KnowledgePrismaClient } from './prisma-knowledge.repository';
import { bindPrismaKnowledgeRetention } from './knowledge-retention-participant';
import { lockRetentionSourceScope, inspectRetentionSource } from '../privacy/retention-model-sources';
import { eraseRetainedSourceTaskBodies } from '../privacy/retention-task-bodies';

export function createPrismaKnowledgeRetention(db: KnowledgePrismaClient, clock: () => Date) {
  return bindPrismaKnowledgeRetention(db, clock, {
    lockSource: lockRetentionSourceScope, inspectSource: inspectRetentionSource, eraseCopies: eraseRetainedSourceTaskBodies
  });
}
