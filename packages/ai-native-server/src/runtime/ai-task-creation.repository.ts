/** Original Rental creation/receipt entry using the same persistence implementation. */
import { randomUUID } from 'node:crypto';
import { withAiTaskTransaction } from './task-transaction-authority';
import { TaskCreationPersistenceRepository, type AiTaskCreationReceiptAuthority } from './task-creation-persistence.repository';
export type { AiTaskCreationAuthority, AiTaskCreationReceiptAuthority } from './task-creation-persistence.repository';

const transactions = { withAiTaskTransaction };
export class AiTaskCreationRepository extends TaskCreationPersistenceRepository {
  constructor(db: ConstructorParameters<typeof TaskCreationPersistenceRepository>[0],
    authority: ConstructorParameters<typeof TaskCreationPersistenceRepository>[1],
    clock: () => Date = () => new Date(), newId: () => string = randomUUID, receiptAuthority?: AiTaskCreationReceiptAuthority) {
    super(db, authority, clock, newId, transactions, receiptAuthority);
  }

  static receiptReader(db: ConstructorParameters<typeof TaskCreationPersistenceRepository>[0],
    authority: AiTaskCreationReceiptAuthority, clock: () => Date = () => new Date()) {
    return super.originalReceiptReader(db, authority, transactions, clock);
  }
}
