import { composePersistedApprovedOrder } from '../approval-execution/persisted-approved-order.composition';
import type { PersistedApprovedOrderDependencies } from '../approval-execution/approved-order-composition.ports';
import { AiApprovedOrderResultUnknownError } from '../approval-execution/approved-order.errors';
import { AiTaskRepositoryError } from '../ai-task.repository';

/** Opt-in consumer of the EXISTING AIN-07 transaction composition.
 * Commands must reference a persisted task/action/original input/proposal and
 * human approval. No quote-to-order inference or approval is performed here.
 * The host supplies the mainline's original-input source; absence is closed.
 */
export function composeAiBusinessOrderApplication(dependencies?: PersistedApprovedOrderDependencies) {
  const orders = dependencies ? composePersistedApprovedOrder(dependencies) : undefined;
  const requireOrders = () => {
    if (!orders) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return orders;
  };
  const result = async (value: unknown, mode: 'submit' | 'reconcile') => {
    const current = requireOrders();
    const command = structuredClone(value);
    try {
      // AIN-07 reads the original operation and reauthorizes the committed
      // order before returning. This layer never searches for a latest order,
      // retries submit, changes operation keys or exposes its raw aggregate.
      const outcome = await current[mode](command);
      return Object.freeze({ status: 'committed' as const, replayed: outcome.replayed,
        order: Object.freeze({ id: outcome.order.id, status: outcome.order.status, quoteId: outcome.order.quoteId }),
        source: Object.freeze({ resourceType: 'order' as const, resourceId: outcome.order.id }),
        payment: 'not_inferred' as const, fulfillment: 'not_inferred' as const,
        taskOutcome: 'owned_by_runner' as const });
    } catch (error) {
      if (!(error instanceof AiApprovedOrderResultUnknownError)) throw error;
      return Object.freeze({ status: 'unknown' as const, errorCode: 'AI_RESULT_UNKNOWN' as const,
        nextAction: 'reconcile' as const, retryable: false as const,
        order: undefined, sideEffect: 'may_have_committed' as const });
    }
  };
  return Object.freeze({
    availability: orders ? 'available_for_persisted_approved_action' as const : 'unavailable' as const,
    originalRequestCreation: 'not_provided_by_this_adapter' as const,
    prepare: (value: unknown) => requireOrders().prepare(structuredClone(value)),
    submit: (value: unknown) => result(value, 'submit'),
    reconcile: (value: unknown) => result(value, 'reconcile')
  });
}
