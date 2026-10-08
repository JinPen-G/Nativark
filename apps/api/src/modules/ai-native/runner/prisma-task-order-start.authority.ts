import type { AiStep } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiStepTransitionCommand } from '../ai-step-transition.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { PrismaTaskStepEvidenceAuthority } from './prisma-task-step-evidence.authority';

export class PrismaTaskOrderStartAuthority extends PrismaTaskStepEvidenceAuthority {
  protected override get startEffect(): 'possible' { return 'possible'; }
  protected override accepts(step: AiStep, operation: string) {
    return step.toolCode === 'rental.order.commit' && step.toolVersion === AI_TOOL_DRAFT_VERSION && operation === 'idempotent';
  }
  override resolve(command: Readonly<AiStepTransitionCommand>) {
    if (command.reason !== 'start') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return super.resolve(command);
  }
}
