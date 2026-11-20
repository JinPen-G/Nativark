import type { AiDispatchBinding } from './invocation-dispatch.service';
import type { GatewayContext, ModelUsage } from './model-gateway.ports';
import type { GatewayBudgetReserveRequest } from './budget/budget-gateway-adapter';

export interface GatewayAccountingCall {
  context: GatewayContext;
  binding: AiDispatchBinding;
  request: GatewayBudgetReserveRequest;
  expiresAt: Date;
}

export interface UnifiedGatewayBudget {
  reserve(call: GatewayAccountingCall): Promise<{ id: string }>;
  dispatch(call: GatewayAccountingCall, reservationId: string): Promise<void>;
  /** Server transport only: retain original dispatched counters, not text,
   * settlement authority, result access or permission to dispatch again. */
  recordUsage(call: GatewayAccountingCall, reservationId: string, usage: ModelUsage): Promise<void>;
  settle(call: GatewayAccountingCall, reservationId: string, eventKey: string, usage: ModelUsage): Promise<void>;
  abandon(call: GatewayAccountingCall, reservationId: string, reason: string): Promise<void>;
}
