"use strict";
/** Shared actual original SaaS/registry/audit fixture; native SQL/commit remain substitutes. */
const assert = require("node:assert/strict");
const { fixture: originalFixture, source } = require("./original-identity.cjs");
const { PlatformService } = source("apps/api/src/modules/platform/platform.service.ts");
const { OperationLogService } = source("apps/api/src/common/operation-log.service.ts");
const { createOriginalMcpPublicClientManagement } = source("apps/api/src/modules/auth/original-mcp-public-client-management.ts");
const options = { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 };
function fixture(api) {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000); f.user.isSaasAdmin = true; f.state = { clients: {}, operations: {} }; f.audits = []; f.calls = []; f.tail = Promise.resolve(); f.reviewReads = 0;
  Object.setPrototypeOf(f.platform, PlatformService.prototype); f.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.platform, ...args);
  f.repository.prisma = { user: { findFirst() { throw new Error('Global identity fallback forbidden'); } }, authSession: { findFirst() { throw new Error('Global session fallback forbidden'); } } };
  f.session = { id: 'client-management-session', userId: f.user.id, audience: 'operator', currentWorkspaceId: null, expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  f.payload = { sub: f.user.id, tid: f.user.tenantId, sid: f.session.id, aud: 'operator', iat: now, exp: now + 900 };
  f.tx.authSession = { findFirst: async query => { assert.equal(query.where.id, f.session.id); return f.session.revokedAt === null && f.session.expiresAt > new Date() ? structuredClone(f.session) : null; } };
  f.browser = () => new Request('https://admin.example.invalid/mcp/clients', { headers: { authorization: 'Bearer ' + f.auth.signAccessToken(f.payload) } });
  f.database = { async $transaction(callback, selected) {
    assert.deepEqual(selected, options); const before = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await before;
    const working = structuredClone(f.state), audits = [];
    const tx = { ...f.tx, operationLog: { async create({ data, select }) { assert.deepEqual(select, { id: true }); if (f.failAudit) throw new Error('private original audit failure'); audits.push(structuredClone(data)); f.afterAudit?.(); const row = { id: 'original-client-audit-' + (f.audits.length + audits.length) }; return f.auditResultHook ? f.auditResultHook(row) : row; } },
      async $queryRaw(parts, ...values) {
        const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.calls.push({ sql, values }); assert.match(sql, /FOR UPDATE$/);
        if (sql.includes('FROM auth_sessions')) { assert.deepEqual(values, [f.session.id]); return [{ id: f.session.id }]; }
        const extra = f.queryExtra?.(working, sql, values); if (extra !== undefined) return extra;
        const table = sql.includes('FROM mcp_oauth_public_client_operations') ? 'operations' : sql.includes('FROM mcp_oauth_public_clients') ? 'clients' : undefined; assert.ok(table);
        const row = working[table][values[0]] ? structuredClone(working[table][values[0]]) : undefined; return row ? [f.rowHook ? f.rowHook(row, sql) : row] : [];
      }, async $executeRaw(parts, ...values) {
        const sql = parts.join('?').replace(/\s+/g, ' ').trim();
        const extra = f.executeExtra?.(working, sql, values); if (extra !== undefined) return extra;
        if (sql.startsWith('UPDATE')) { const row = working.clients[values[2]]; if (!row || row.revision !== values[3]) return 0; row.revision = values[0]; row.recordJson = values[1]; return 1; }
        if (sql.includes('INTO mcp_oauth_public_client_operations')) { assert.ok(!working.operations[values[0]]); working.operations[values[0]] = { actorId: values[1], clientId: values[2], payloadHash: values[3], resultJson: values[4] }; return 1; }
        assert.ok(sql.includes('INTO mcp_oauth_public_clients')); assert.ok(!working.clients[values[0]]); working.clients[values[0]] = { clientId: values[0], revision: values[1], recordJson: values[2] }; return 1;
      },
    }; f.native = tx;
    try { const result = await callback(tx); f.state = working; f.audits.push(...audits); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('private commit-response-loss'); return result; } catch (error) { f.transactionFailure = error; throw error; } finally { release(); }
  } };
  f.command = { operationKey: 'client-original-save', expectedRevision: 0, registration: { clientId: 'client-a', enabled: true, expiresAt: now + 500, redirectUris: ['http://127.0.0.1:49152/rental/callback'], scopes: ['rental.catalog.read'] } };
  // Original approved review is explicit external data, not reflected from a save.
  f.review = { reference: 'original-review-a', revision: 1, expiresAt: now + 900, registration: api.captureRegisteredPublicClient({ ...f.command.registration, revision: 1 }) };
  f.reviews = { async current(tx, clientId, sig) { assert.equal(tx, f.native); assert.equal(sig.aborted, false); f.reviewReads++; const row = f.review && f.review.registration.clientId === clientId ? structuredClone(f.review) : undefined; return f.reviewHook ? f.reviewHook(row, f.reviewReads) : row; } };
  f.readonly = api.createPrismaPublicClientRegistry(f.database);
  f.logs = new OperationLogService({ operationLog: { create() { throw new Error('Global original audit fallback forbidden'); } } });
  f.management = createOriginalMcpPublicClientManagement({ registration: api.captureRegisteredPublicClient, receipt: api.capturePublicClientRegistrationReceipt }, f.auth, f.browser(), f.readonly, f.logs, f.reviews);
  f.registry = api.createPrismaPublicClientRegistry(f.database, f.management);
  return f;
}
module.exports = { fixture };
