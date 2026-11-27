/** Original Rental order participant; generic C05 rows and fencing stay public. */
import { ApprovalConsumptionPersistenceRepository, AiApprovalConsumptionRepositoryError } from './approval-consumption-persistence.repository';
import type { ApprovedOrderBinding, ApprovedOrderTransaction } from './rental-adapters/approved-order-transaction.ports';
import type { AiApprovedOrderInput, AiApprovedOrderAuthority } from './approval-execution/approved-order.ports';
export { AiApprovalConsumptionRepositoryError } from './approval-consumption-persistence.repository';

export class PrismaAiApprovalConsumptionRepository extends ApprovalConsumptionPersistenceRepository {
  createOrderTransaction(value: AiApprovedOrderInput, authority: AiApprovedOrderAuthority): ApprovedOrderTransaction {
    if (!authority || typeof authority.resolve !== 'function') throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
    return this.effectTransaction<ApprovedOrderBinding>(value, 'rental.order.commit', {
      resolve: (input, binding, action, tx) => {
        if (input.context.actor.kind !== 'user' || input.context.scope.kind !== 'workspace'
          || binding.tenantId !== input.context.scope.tenantId || binding.workspaceId !== input.context.scope.workspaceId
          || binding.idempotencyKey !== input.businessIdempotencyKey || binding.requestFingerprint !== input.actionFingerprint)
          throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
        return authority.resolve(input, binding, action, tx);
      },
      async assertCommitted(tx, binding, orderId) {
        const order = await tx.rentalOrder.findFirst({ where: { tenantId: binding.tenantId, workspaceId: binding.workspaceId,
          id: orderId }, select: { id: true } });
        const receipt = await tx.rentalOrderIdempotencyRecord.findFirst({ where: { tenantId: binding.tenantId,
          workspaceId: binding.workspaceId, action: 'rental.order.create', idempotencyKey: binding.idempotencyKey,
          requestHash: binding.requestFingerprint, orderId, status: 'succeeded' }, select: { id: true } });
        if (!order || !receipt) throw new AiApprovalConsumptionRepositoryError('INVALID_BINDING');
      }
    });
  }
}
