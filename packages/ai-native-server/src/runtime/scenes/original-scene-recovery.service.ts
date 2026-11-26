/** Original workspace adapter for the public read-only Task recovery engine. */
import type { PrismaClient } from '@prisma/client';
import type { AiTaskRepository } from '../ai-task.repository';
import type { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';
import { createOriginalTaskRecoveryRead } from '../original-task-recovery-read';
import { AiTaskRepositoryError } from '../../task-errors';
import { freezeOriginalInput } from '../task-request/original-request.validation';

export class AiOriginalSceneRecoveryService {
  constructor(private readonly db: Pick<PrismaClient, 'aiStep'>,
    private readonly requests: PrismaOriginalRequestRepository, private readonly tasks: AiTaskRepository,
    private readonly clock: () => Date = () => new Date()) {}
  async read(value: unknown, signal = new AbortController().signal) {
    // The original Web readers resolve their own fresh request/resource policies.
    // A selected Native caller instead supplies its active owner lease.
    const read = createOriginalTaskRecoveryRead(this.db, {
      assertCurrent() { if (signal.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); },
      readTaskReceipt: inputRef => this.requests.readTaskReceipt(inputRef),
      readTaskLocator: reference => this.requests.readTaskLocator(reference),
      resolveMetadataAccess: taskId => this.tasks.resolveAccess(taskId, 'read_metadata')
    }, this.clock);
    return freezeOriginalInput(await read(value, signal));
  }
}
