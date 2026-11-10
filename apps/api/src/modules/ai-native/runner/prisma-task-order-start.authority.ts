import type { AiStep, PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiStepTransitionCommand } from '../ai-step-transition.repository';
import { AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { PrismaTaskStepEvidenceAuthority } from './prisma-task-step-evidence.authority';
import type { AiTaskPlanEvidenceAuthority, AiConfirmationTool } from './prisma-task-run-evidence.repository';

export class PrismaTaskOrderStartAuthority extends PrismaTaskStepEvidenceAuthority {
  constructor(db: PrismaClient, authorization: AiTaskRepositoryAuthority, plans: AiTaskPlanEvidenceAuthority,
    clock: () => Date = () => new Date(), private readonly confirmationTool: AiConfirmationTool = 'rental.order.commit') {
    super(db, authorization, plans, clock);
    if (!['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'].includes(confirmationTool)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  protected override get startEffect(): 'possible' { return 'possible'; }
  protected override accepts(step: AiStep, operation: string) {
    return step.toolCode === this.confirmationTool && step.toolVersion === AI_TOOL_DRAFT_VERSION && operation === 'idempotent';
  }
  override resolve(command: Readonly<AiStepTransitionCommand>) {
    if (command.reason !== 'start') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return super.resolve(command);
  }
}
