'use strict';
const { RentalCoreConfigRepository } = require('../../apps/api/src/modules/rental-core/rental-core-config.repository');

/** Explicit configuration facts for offline tests, not a MySQL emulator. The
 * actual repository/gate read the supplied rows; SQL locking is only recorded. */
function fulfillmentAdmissionFixture(tenantId, workspaceId, source, beforeQuery) {
  const trace = [];
  const tx = {
    businessWorkspace: { findFirst: async () => ({ id: workspaceId, tenantId }) },
    $queryRaw: async query => {
      trace.push(query.sql);
      if (beforeQuery) await beforeQuery(query);
      if (query.sql.includes('rental_fulfillment_locations')) {
        return structuredClone(source.locations).filter(row => query.values.includes(row.id)).map(row => ({ ...row,
          tenantId: row.tenantId ?? tenantId, workspaceId: row.workspaceId ?? workspaceId,
          organizationId: row.organizationId ?? null, latitude: row.latitude ?? null, longitude: row.longitude ?? null }));
      }
      if (query.sql.includes('rental_fulfillment_operators')) {
        return structuredClone(source.operators).filter(row => query.values.includes(row.id)).map(row => ({ ...row,
          tenantId: row.tenantId ?? tenantId, workspaceId: row.workspaceId ?? workspaceId,
          createdAt: new Date(row.createdAt ?? '2026-10-31'), updatedAt: new Date(row.updatedAt ?? '2026-10-31') }));
      }
      if (query.sql.includes('business_workspaces')) return [{ id: workspaceId, status: source.workspaceStatus ?? 'ACTIVE' }];
      throw Error('Unexpected configuration query');
    }
  };
  const repository = new RentalCoreConfigRepository({ ...tx, $transaction: async work => work(tx) });
  return { tx, trace, read: repository.readFulfillmentAdmission.bind(repository) };
}
function bindFulfillmentAdmission(services, tenantId, workspaceId, source) {
  const fixture = fulfillmentAdmissionFixture(tenantId, workspaceId, source);
  for (const service of services) {
    const store = service.coreConfigStore ?? service.configStore;
    // Existing pure suites pass partial transaction-shaped objects; add this
    // fixture's explicit configuration delegates without claiming DB atomicity.
    store.readFulfillmentAdmission = (tenant, workspace, requirements, transaction) => fixture.read(
      tenant, workspace, requirements, transaction ? { ...transaction, ...fixture.tx } : undefined);
  }
  return fixture;
}
module.exports = { fulfillmentAdmissionFixture, bindFulfillmentAdmission };
