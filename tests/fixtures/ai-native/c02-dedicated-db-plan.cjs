'use strict';

/** Planning descriptor only. It is intentionally not a database runner. */
module.exports = Object.freeze({
  defaultAction: 'refuse_without_explicit_authorization',
  requiredDatabasePrefix: 'rental_os_e2e_',
  requiredInputs: ['explicit-user-authorization', 'dedicated-database-name', 'validated-database-credentials'],
  scenarios: ['last-unit-contention', 'cross-tenant-isolation', 'unknown-retention', 'transaction-rollback', 'restart-recovery'],
  forbidden: ['.env', 'shared-database', 'production-database', 'model-provider', 'payment-provider']
});
