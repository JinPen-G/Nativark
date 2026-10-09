'use strict';
const h = require('./knowledge-service.cjs');
const { dbFactory } = require('./knowledge-persistent-content.cjs');
exports.fixture = () => {
  const f = h.harness(), db = dbFactory();
  // Explicit synthetic business-binding dependency, never a production grant.
  f.files.assertBound = async (context, input) => {
    if (context.scope.kind !== 'workspace' || context.scope.tenantId !== 'tenant-1'
      || context.scope.workspaceId !== input.workspaceId || !input.attachmentId || !input.documentId) {
      throw new (h.load('knowledge-errors').KnowledgeError)('unavailable');
    }
  };
  const flags = { active: true, workspaceId: 'space-1' };
  const user = { id: 'user-1', tenantId: 'tenant-1', isActive: true, isSaasAdmin: false,
    permissions: ['synthetic-policy'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
  const matches = (row, where) => Object.entries(where).every(([k, v]) => v && typeof v === 'object'
    ? ('gt' in v ? row[k] > v.gt : 'in' in v ? v.in.includes(row[k]) : false) : row[k] === v);
  const list = map => async ({ where, take, select }) => [...map.values()].filter(row => matches(row, where))
    .sort((a, b) => a.id < b.id ? -1 : a.id === b.id ? 0 : 1).slice(0, take)
    .map(row => structuredClone(select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, row[k]])) : row));
  db.aiKnowledgePolicyManagementOperation = { findFirst: async () => null };
  db.aiKnowledgeDocument.findMany = list(db.state.documents);
  db.aiStructuredMemory.findMany = list(db.state.memories);
  const identity = {
    auth: { resolveAccessContext: async () => ({ user: { ...user, isActive: flags.active }, tenantUser: user, workspaceValid: true, workspaceId: flags.workspaceId }) },
    credentials: { current: async () => ({ authorization: 'synthetic-session', requestId: 'request-1', audience: 'operator' }) }
  };
  return { f, db, flags, identity, ports: { db, ...identity, authorization: f.authorization, clock: f.clock, files: f.files } };
};
exports.h = h;
