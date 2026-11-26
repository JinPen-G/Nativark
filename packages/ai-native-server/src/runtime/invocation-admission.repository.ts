/** Rental compatibility entry. Same admission rows, dispatch token and transaction boundary. */
import { hasAiTaskTransactionAuthority, withAiTaskTransaction } from './task-transaction-authority';
import { PrismaAdmissionPersistenceRepository } from './invocation-admission-persistence.repository';

export class PrismaAdmissionRepository extends PrismaAdmissionPersistenceRepository {
  constructor(db: ConstructorParameters<typeof PrismaAdmissionPersistenceRepository>[0]) {
    super(db, { hasAiTaskTransactionAuthority, withAiTaskTransaction }, 'legacy');
  }
}
