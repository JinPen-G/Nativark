/** Compatibility entry for Rental and the original application. The shared
 * Task repository uses this host's existing request transaction boundary. */
import { withAiTaskTransaction, hasAiTaskTransactionAuthority } from './task-transaction-authority';
import { TaskPersistenceRepository } from './task-persistence.repository';
export { AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority,
  type AiTaskRepositoryOperation } from './task-persistence.repository';

const transactions = { withAiTaskTransaction, hasAiTaskTransactionAuthority };
export class AiTaskRepository extends TaskPersistenceRepository {
  constructor(db: ConstructorParameters<typeof TaskPersistenceRepository>[0],
    authority: ConstructorParameters<typeof TaskPersistenceRepository>[1], clock: () => Date = () => new Date()) {
    super(db, authority, clock, transactions);
  }
}
