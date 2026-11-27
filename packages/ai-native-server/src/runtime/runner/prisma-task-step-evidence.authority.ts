/** Original Rental step catalogue over the same persistent evidence reader. */
import type { AiStep } from '@prisma/client';
import type { AiStepStateDraft } from '@rental-os/shared';
import { TaskStepEvidenceAuthority } from './task-step-evidence.authority';

const readonlyTools = new Set(['rental.order.explain', 'rental.catalog.search',
  'rental.availability.check', 'membership.customer.resolve', 'tenant.opening.diagnose', 'operations.risks.list']);

export class PrismaTaskStepEvidenceAuthority extends TaskStepEvidenceAuthority<AiStepStateDraft['toolCode']> {
  protected accepts(step: AiStep, operation: string) {
    return readonlyTools.has(step.toolCode) && operation === 'readonly';
  }
}
