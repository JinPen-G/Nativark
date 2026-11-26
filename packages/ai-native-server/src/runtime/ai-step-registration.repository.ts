/** Original Rental tool catalogue and legacy transaction selection. */
import type { PrismaClient } from '@prisma/client';
import { AI_TASK_STEP_CODES } from '@rental-os/shared';
import { withAiTaskTransaction } from './task-transaction-authority';
import { TaskStepRegistrationRepository, type AiStepRegistrationAuthority, type AiStepReplayAuthority } from './task-step-registration.repository';
export { aiStepActionId, AiStepOriginalRegistrationUnavailableError, AiStepRegistrationCommitUnknownError,
  type AiStepRegistrationCommand, type AiStepReplayCommand, type AiStepReplayAuthority, type AiStepOriginalRegistrationGrant,
  type AiStepRegistrationAuthority } from './task-step-registration.repository';

export class AiStepRegistrationRepository extends TaskStepRegistrationRepository {
  constructor(db: Pick<PrismaClient, '$transaction'>, authority: AiStepRegistrationAuthority,
    clock: () => Date = () => new Date(), newId?: () => string, readAuthority?: AiStepReplayAuthority) {
    super(db, authority, clock, newId, readAuthority, { withAiTaskTransaction },
      toolCode => (AI_TASK_STEP_CODES as readonly string[]).includes(toolCode));
  }
}
