/** Original closed Rental step validation and transaction selection. */
import type { PrismaClient } from '@prisma/client';
import type { AiStepStateDraft } from '@rental-os/shared';
import { withAiTaskTransaction } from './task-transaction-authority';
import { isAiStepState } from './task-contract-validation';
import { TaskStepTransitionRepository, type AiStepTransitionAuthority as TaskStepAuthority, type AiStepTransitionGrant as TaskStepGrant } from './task-step-transition.repository';
export { AiStepTransitionResultUnknownError, type AiStepTransitionCommand } from './task-step-transition.repository';
export type AiStepTransitionAuthority = TaskStepAuthority<AiStepStateDraft>;
export type AiStepTransitionGrant = TaskStepGrant<AiStepStateDraft>;

export class AiStepTransitionRepository extends TaskStepTransitionRepository {
  constructor(db: Pick<PrismaClient, '$transaction'>, authority: AiStepTransitionAuthority, clock: () => Date = () => new Date()) {
    super(db, authority, clock, { withAiTaskTransaction }, isAiStepState);
  }
}
