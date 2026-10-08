'use strict';
// Compatibility fixture for existing lifecycle tests only. Real CAS behavior is tested separately.
module.exports = function withSyntheticDispatch(ports) {
  const tokens = new Map();
  ports.dispatch = {
    claim: async binding => {
      const key = `${binding.scope.tenantId}/${binding.callId}`;
      if (tokens.has(key)) throw new Error('already claimed');
      tokens.set(key, structuredClone(binding));
    },
    finish: async (binding, outcome) => {
      const key = `${binding.scope.tenantId}/${binding.callId}`;
      if (JSON.stringify(tokens.get(key)) !== JSON.stringify(binding)) throw new Error('not owner');
      return ports.admission.transition(binding.scope, binding.callId, 'admitted', outcome);
    }
  };
  return require('./unified-budget.cjs')(ports);
};
