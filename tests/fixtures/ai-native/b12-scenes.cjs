'use strict';
// Shared synthetic inputs only. Behavior comes from the real three-end workbenches.
exports.context = { audience: 'staff', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space' };
exports.snapshot = () => ({
  steps: [{ id: 'step-1', taskId: 'task-1', ordinal: 1, status: 'registered', label: '登记', sourceLabel: 'synthetic' }],
  fields: [{ key: 'note', name: 'note', label: '补充', type: 'text', required: true, value: '' }],
  inputRevision: 'input-1',
  proposal: { id: 'proposal-1', revision: '1', title: '待确认', risk: 'synthetic', changes: [] },
  proposalRef: { proposalId: 'proposal-1', revision: '1' },
  proposalAvailable: true, proposalExpired: false,
  sources: [{ id: 'source-1', version: '1', title: '合成来源', status: 'published' }],
  memories: [], order: { title: '合成订单', receivable: null, paid: 0 }, actionState: 'unknown',
  cursorState: { taskId: 'task-1', version: 'v1', cursor: '9007199254740993', events: [], sync: 'synced', reason: 'none' },
});
