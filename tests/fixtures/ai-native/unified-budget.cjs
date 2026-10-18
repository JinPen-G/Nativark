'use strict';
// Adapts existing lifecycle spies only; production has no legacy-accounting fallback.
module.exports = function withSyntheticBudget(ports) {
  if (!ports.usage) throw Error('lifecycle spies must be explicitly supplied');
  ports.budget = {
    reserve: call => ports.usage.reserve({ scope: call.binding.scope, callId: call.request.callId,
      idempotencyKey: call.request.callId, reservedUnits: call.request.maxOutputTokens, expiresAt: call.expiresAt }),
    dispatch: async () => {},
    // Legacy lifecycle spies have no receipt table. Real receipt persistence
    // is exercised with PersistentGatewayBudget/PrismaGatewayAccountingFacts.
    recordUsage: async () => {},
    settle: (call, id, key, usage) => ports.usage.settle(call.binding.scope, id, key, usage.inputTokens, usage.outputTokens),
    abandon: (call, id, reason) => ports.usage.markUnknown(call.binding.scope, id, reason)
  };
  return ports;
};
