import type { AiDispatchBinding } from './invocation-dispatch.service';
import type { GatewayContext, ModelUsage } from './model-gateway.ports';
/** 原单账预留输入，由真实预算参加者关联 Task/Run/Step 和价格依据。 */
export interface GatewayBudgetReserveRequest {
  callId: string; model: string; maxOutputTokens: number; intentHash: string;
  countRequestHash?: string;
}

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
