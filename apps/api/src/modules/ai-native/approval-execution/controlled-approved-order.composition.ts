import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { RentalOrderConfirmationService } from '../../rental-core/rental-order-confirmation.service';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedOrderTaskInput } from '../order-task-input.composition';
import type { PersistedApprovedOrderDependencies } from './approved-order-composition.ports';
import { composePersistedApprovedOrder } from './persisted-approved-order.composition';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { PrismaApprovedOrderOriginalInputSource } from './prisma-approved-order-original-input.source';
import { PrismaAuthorizedApprovedOrderInputSource } from './prisma-authorized-approved-order-input.source';
import { composeApprovedOrderHumanApproval } from './approved-order-human.composition';

export type ControlledApprovedOrderDependencies = Omit<PersistedApprovedOrderDependencies, 'inputSource' | 'executionInput' | 'toolVersion'> & {
  confirmation: PersistedApprovedOrderDependencies['confirmation'] & Pick<RentalOrderConfirmationService, 'normalizeOrderInput'>;
  scene: { code: string; version: string };
};

/** Explicit assembly only: no policy seeds, automatic approval, runner hosting
 * or AppModule registration. Runtime/Provider do not own authorization or Core.
 */
export function composeControlledApprovedOrder(dependencies: ControlledApprovedOrderDependencies) {
  try {
    if (typeof dependencies?.confirmation?.normalizeOrderInput !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const formal = composePersistedOrderTaskInput(dependencies);
    const d = { ...dependencies, toolVersion: AI_TOOL_DRAFT_VERSION };
    const policy = new PersistedApprovedOrderPolicyAuthority(d);
    const reader = new PrismaApprovedOrderOriginalInputSource(policy, d.toolVersion, d.clock);
    const inputSource = new PrismaAuthorizedApprovedOrderInputSource(formal.inputAuthority, reader, d.toolVersion, d.clock);
    const orders = composePersistedApprovedOrder({ ...d, inputSource, executionInput: inputSource });
    return Object.freeze({ tasks: formal.tasks, source: formal.source, policy: formal.policy, plans: formal.plans,
      registrations: formal.registrations, inputAuthority: formal.inputAuthority,
      approvals: composeApprovedOrderHumanApproval(dependencies),
      prepare: orders.prepare, submit: orders.submit, reconcile: orders.reconcile });
  } catch (error) {
    if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
}
