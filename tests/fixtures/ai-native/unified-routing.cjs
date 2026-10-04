'use strict';
const { contexts } = require('./contract-consumer.cjs');
module.exports = function syntheticRouting(resolveRoute, consumerScope) {
  return {
    resolve: async (context, requiredCapabilities) => {
      const scope = consumerScope ?? { id: 'scope-synthetic-workspace', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
      const route = await resolveRoute({ requiredCapabilities });
      return {
        context: { ...structuredClone(contexts[0]), audience: 'operator', actor: { kind: 'user', userId: context.actorId },
          scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId } },
        consumerScope: structuredClone(scope), route: { ...route, profile: { model: 'synthetic', ...route.profile } },
        selection: { mode: 'tenant_managed', revision: 1 }, scene: 'chat', requiredCapabilities: [...requiredCapabilities]
      };
    },
    assertCurrent: async () => {}
  };
};
