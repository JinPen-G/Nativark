'use strict';
const { validateScenario } = require('./loader.cjs');
const records = Object.freeze(['proposed', 'confirmed', 'expired', 'revoked'].map((status, index) => ({ memoryId: `synthetic_memory_${index + 1}`, status, revision: index + 1, contentHash: `synthetic_hash_${index + 1}`, actorKind: index === 3 ? 'automation' : 'human', expiresAt: '2026-12-31T00:00:00Z' })));
const scenarios = Object.freeze(records.map(record => validateScenario({ code: `memory.${record.status}`, synthetic: true, actor: { kind: record.actorKind === 'automation' ? 'automation' : 'client', id: `synthetic_${record.actorKind}_1` }, scope: { kind: 'tenant', id: 'synthetic_tenant_1' }, inputRefs: [record.memoryId], expected: record.status === 'revoked' && record.actorKind === 'automation' ? 'automation_impersonation' : record.status })));
const revisionChange = Object.freeze({ memoryId: 'synthetic_memory_2', oldRevision: 2, newRevision: 3, oldContentHash: 'synthetic_hash_2', newContentHash: 'synthetic_hash_3' });
module.exports = Object.freeze({ records, revisionChange, scenarios });
