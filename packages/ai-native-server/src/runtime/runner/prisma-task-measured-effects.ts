/** Original Rental effect and human-confirmation catalogues. */
import type { AiTaskInputAnswerDraft } from '@rental-os/shared';
import type { PrismaClient } from '@prisma/client';
import type { AiTaskInputReader } from '../task-input/task-input.ports';
import type { TaskPersistenceRepository } from '../task-persistence.repository';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { TaskMeasuredEffects, type AiTaskExecutionAuthorization, type TaskRegisteredExecutor } from './task-measured-effects';
export type { AiTaskExecutionAuthorization } from './task-measured-effects';
export type AiTaskRegisteredExecutor = TaskRegisteredExecutor<AiTaskInputAnswerDraft>;

export class PrismaTaskMeasuredEffects extends TaskMeasuredEffects<AiTaskInputAnswerDraft> {
  constructor(db: Pick<PrismaClient, 'aiTask' | 'aiStep'>, tasks: Pick<TaskPersistenceRepository, 'resolveAccess'>,
    evidence: Pick<PrismaTaskRunEvidenceRepository, 'capture' | 'recoverResult' | 'assertExecutable'>,
    tools: AiTaskRegisteredExecutor, executionAuthorization: AiTaskExecutionAuthorization,
    inputs?: AiTaskInputReader, wall: () => Date = () => new Date()) {
    super(db, tasks, evidence, tools, executionAuthorization, inputs, wall,
      toolCode => ['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'].includes(toolCode));
  }
}
