/** Current original inspection permission -> Core's single allocation reader.
 * No direct database access, asset scan, manufactured page or new authorization.
 * Each request supplies its own credential lifetime; complete facts stay here. */
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { InspectionRecognitionBasisPorts } from './inspection-recognition-basis.service';
import { InspectionAssistError } from './inspection-assist.validation';

export function createInspectionRecognitionCoreSource(dependencies: {
  guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource;
  core: Partial<Pick<RentalCoreService, 'readOrderAllocationPickupBasis'>>;
}): InspectionRecognitionBasisPorts {
  const read = dependencies.core.readOrderAllocationPickupBasis;
  if (typeof read !== 'function') return {};
  return { original: { read: async (scope, target, signal) => {
    const owner = structuredClone(scope), bound = structuredClone(target);
    const authority = new AiOrderRouteContextAuthority(dependencies.guard, dependencies.credentials,
      bound.orderId, undefined, 'inspections');
    return authority.withOrderRead(async context => {
      if (signal.aborted || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
        || context.actor.userId !== owner.ownerId || context.audience !== owner.audience
        || context.scope.tenantId !== owner.tenantId || context.scope.workspaceId !== owner.workspaceId) {
        throw new InspectionAssistError('ACCESS_DENIED');
      }
      const original = await read.call(dependencies.core, owner.tenantId, bound.orderId, bound.allocationId);
      if (signal.aborted || original.tenantId !== owner.tenantId || original.workspaceId !== owner.workspaceId
        || original.orderId !== bound.orderId || original.allocation.id !== bound.allocationId
        || original.allocation.assetId !== bound.assetId) throw new InspectionAssistError('BINDING_CHANGED');
      return structuredClone(original);
    });
  } } };
}
