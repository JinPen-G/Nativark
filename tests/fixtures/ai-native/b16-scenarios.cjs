'use strict';
module.exports = {
  contexts: [
    { audience: 'operator', tenantId: 'tenant-a', workspaceId: 'space-a', taskId: 'task-a' },
    { audience: 'staff', tenantId: 'tenant-b', workspaceId: 'space-b', taskId: 'task-a' },
  ],
  orderFacts: {
    draftVersion: 'ain-order-facts-draft-1', paymentEvidence: 'not_loaded', historicalFeeEvidence: 'not_loaded', observedAt: '2026-10-04T10:00:00Z',
    scope: { id: 'space-a' }, sources: [{ scope: { id: 'space-a' }, basis: { kind: 'current' } }],
    order: { id: 'order-a', orderNo: 'RO-A', status: 'settling', currency: 'CNY', amounts: { rental: 0, service: null, discount: 0, coupon: null, deposit: 500, preAuthorization: null, finalPayable: 0 } },
  },
  inspection: [{ key: 'vin', label: 'VIN', candidate: 'candidate-vin', sourceLabel: '照片引用' }, { key: 'mileage', label: '里程', humanValue: '100', sourceLabel: '人工输入' }],
  proposal: { expiresAt: '2026-10-04T10:00:00Z', nowIso: '2026-10-04T10:01:00Z', stale: false },
};
