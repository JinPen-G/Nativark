import { AiTaskRepositoryError } from '../ai-task.repository';
import type { PersistedApprovedOrderDependencies } from './approved-order-composition.ports';
import { composeAiApprovedOrder } from './approved-order.composition';
import { ApprovedOrderPreparationService } from './approved-order-preparation.service';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { PrismaApprovedOrderSnapshotSource } from './prisma-approved-order-snapshot.source';

export function composePersistedApprovedOrder(dependencies: PersistedApprovedOrderDependencies) {
  try {
    if (typeof dependencies?.inputSource?.read !== 'function' || typeof dependencies.confirmation?.assertOrderMatchesQuote !== 'function'
      || typeof dependencies.db?.aiApprovedOrderSnapshot?.create !== 'function' || typeof dependencies.db.aiRun?.updateMany !== 'function'
      || typeof dependencies.db.aiStep?.findFirst !== 'function' || typeof dependencies.db.aiStep?.updateMany !== 'function'
      || typeof dependencies.db.aiTask?.updateMany !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const d = { ...dependencies, inputSource: { read: dependencies.inputSource.read.bind(dependencies.inputSource) },
      confirmation: { createApprovedOrder: dependencies.confirmation.createApprovedOrder.bind(dependencies.confirmation),
        assertOrderMatchesQuote: dependencies.confirmation.assertOrderMatchesQuote.bind(dependencies.confirmation) },
      quoteFacts: { findQuote: dependencies.quoteFacts.findQuote.bind(dependencies.quoteFacts) },
      credentials: { current: dependencies.credentials.current.bind(dependencies.credentials) },
      guard: { canActivate: dependencies.guard.canActivate.bind(dependencies.guard) } };
    const policy = new PersistedApprovedOrderPolicyAuthority(d);
    const snapshots = new PrismaApprovedOrderSnapshotSource(d.db, policy);
    const orders = composeAiApprovedOrder({ ...d, policy, snapshots });
    const preparation = new ApprovedOrderPreparationService(d, policy, snapshots);
    return Object.freeze({ prepare: (value: unknown) => preparation.prepare(value), submit: orders.submit, reconcile: orders.reconcile });
  } catch (error) {
    if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
}
