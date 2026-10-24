'use strict';
const { AuthService } = require('../../../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../../../apps/api/src/modules/rental-core/rental-core.service');
const { AiOrderRouteContextAuthority } = require('../../../apps/api/src/modules/ai-native/order-route-context.authority');
const { AiOrderReadFactsService } = require('../../../apps/api/src/modules/ai-native/order-read-facts.service');
const { getRequestIdentity } = require('../../../apps/api/src/common/request-identity');
const stores = require('../../helpers/absorbing-config-store.cjs');
const samples = require('./authorization-baseline.cjs');
async function setup(audience = 'operator', tenantId = 'tenant-a') {
  const state = { user: samples.user({ tenantId }), workspace: 'workspace-a', session: true, member: true, order: samples.order({ tenantId }), reads: [], afterRead: null };
  const auth = new AuthService({
    getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => []
  }, { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-order-facts-test-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'facts-request', audience, authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: audience, exp: Math.floor(Date.now()/1000)+600 })}` }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => state.order ? { id: state.order.id } : null } });
  const authority = new AiOrderRouteContextAuthority(guard, credentials, 'order-a');
  const config = stores.createAbsorbingConfigStore(); config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId, categoryCode: 'camera', isDefault: true }];
  const facts = stores.createAbsorbingFactStore();
  // Declared synthetic pagination port for the formal listInspectionsPage
  // contract, backed by the same per-test listInspections stub the cases
  // patch (deterministic single page <=50, page_not_total). Not a Prisma
  // integrity simulation.
  facts.listInspectionsPage = async (tenant, orderId, query) => {
    // No tenant/orderId filtering here: foreign or malformed rows flow through
    // so the Core's own page validation rejects them, exactly as production.
    const all = (await facts.listInspections(tenant, orderId, query))
      .filter(row => !query.cursor || row.id > query.cursor)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const items = all.slice(0, query.limit);
    return { items, nextCursor: all.length > query.limit ? items[items.length - 1].id : null,
      coverage: 'page_not_total' };
  };
  facts.findOrder = async (tenant, orderId) => {
    const identity = structuredClone(getRequestIdentity()); state.reads.push({ tenant, orderId, identity });
    if (identity?.tenantId !== tenant || identity?.workspaceId !== 'workspace-a') return null;
    const row = structuredClone(state.order); if (state.afterRead) await state.afterRead(); return row;
  };
  const core = new RentalCoreService(config, facts); await core.onApplicationBootstrap();
  return { state, core, facts, authority, guard, credentials, reader: new AiOrderReadFactsService(core, authority) };
}
module.exports = { setup };
