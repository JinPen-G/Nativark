"use strict";
/** Actual original OperationLog service + OAuth audit callbacks. Native Prisma
 * create/query and DB commit are explicit fixtures, not production durability,
 * full API/Prisma type proof or authorization granted by the act of logging. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const { source, identity: als } = require('./fixtures/mcp/original-identity.cjs');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const { createOriginalMcpOAuthAudit } = source('apps/api/src/modules/auth/original-mcp-oauth-audit.ts');
const signal = () => new AbortController().signal;
function fixture() {
  const f = { rows: [], globalCalls: 0, queries: [], resultHook: undefined, fail: false };
  f.logs = new OperationLogService({ operationLog: { create() { f.globalCalls++; throw new Error('Unexpected global audit'); } } });
  f.tx = { operationLog: { async create(input) { assert.deepEqual(input.select, { id: true }); if (f.fail) throw new Error('private DB failure'); f.rows.push(structuredClone(input.data));
    const row = { id: 'original-audit-' + f.rows.length }; return f.resultHook ? f.resultHook(row) : row; } },
    async $queryRaw(parts, ...values) { const sql = parts.join('?').replace(/\s+/g, ' ').trim(); assert.equal(sql, 'SELECT id, userId, tenantId, workspaceId, recordJson FROM mcp_oauth_grants WHERE id = ? FOR UPDATE');
      assert.deepEqual(values, ['grant-a']); f.queries.push({ sql, values }); return f.grantRows; } };
  f.grant = { id: 'grant-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', consentRef: 'original-consent', consentRevision: 2 };
  f.grantRows = [{ id: 'grant-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', recordJson: JSON.stringify(f.grant) }];
  f.audit = createOriginalMcpOAuthAudit(f.logs);
  f.event = { tenantId: 'tenant-a', userId: 'user-a', workspaceId: 'workspace-a', action: 'mcp.oauth.consent.prepared', targetType: 'mcp-oauth-consent', targetId: 'original-consent', operationKey: 'original-consent', revision: 1, grantId: null };
  return f;
}

test('original native log records exact OAuth scope independent of mutable Web ALS and keeps only approved event references', async () => {
  const f = fixture();
  await als.runWithRequestIdentity({ userId: 'other-user', tenantId: 'other-tenant', workspaceId: 'other-space', dataScope: 'ALL', audience: 'operator' }, () => f.logs.recordOriginalOAuthAudit(f.tx, f.event, signal()));
  assert.equal(f.globalCalls, 0); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].workspaceId, 'workspace-a'); assert.equal(f.rows[0].tenantId, 'tenant-a'); assert.equal(f.rows[0].userId, 'user-a');
  assert.deepEqual(f.rows[0].detail.metadata, { operationKey: 'original-consent', revision: 1 }); assert.equal(als.getRequestIdentity(), undefined);
  await f.audit.consent(f.tx, { authorizationId: 'original-consent', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 2, stage: 'approved' }, signal());
  await f.audit.grant(f.tx, { authorizationId: 'original-consent', authorizationRevision: 2, grantId: 'grant-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, signal());
  await f.audit.code(f.tx, { authorizationId: 'original-consent', authorizationRevision: 2, grantId: 'grant-a' }, signal());
  assert.deepEqual(f.rows.map(row => row.action), ['mcp.oauth.consent.prepared', 'mcp.oauth.consent.approved', 'mcp.oauth.grant.created', 'mcp.oauth.code.issued']);
  assert.equal(f.rows[3].detail.targetId, 'original-consent', 'code digest/plaintext is never supplied'); assert.equal(f.rows[3].detail.metadata.grantId, 'grant-a');
  assert.ok(!JSON.stringify(f.rows).includes('Bearer')); assert.ok(!JSON.stringify(f.rows).includes('nonce'));
});

test('unknown fields/getters, invalid event binding, failed native write and missing receipt never become empty audit success', async () => {
  for (const kind of ['extra-token', 'wrong-space', 'wrong-target', 'wrong-revision', 'getter', 'native-failure', 'missing-id', 'id-getter']) {
    const f = fixture(); let event = f.event, getters = 0;
    if (kind === 'extra-token') event = { ...event, token: 'must-not-log' }; if (kind === 'wrong-space') event.workspaceId = '';
    if (kind === 'wrong-target') event.targetType = 'arbitrary-operation'; if (kind === 'wrong-revision') event.revision = 2;
    if (kind === 'getter') Object.defineProperty(event, 'userId', { enumerable: true, get() { getters++; return 'user-a'; } });
    if (kind === 'native-failure') f.fail = true; if (kind === 'missing-id') f.resultHook = () => ({});
    if (kind === 'id-getter') f.resultHook = row => { Object.defineProperty(row, 'id', { enumerable: true, get() { getters++; return 'audit'; } }); return row; };
    await assert.rejects(() => f.logs.recordOriginalOAuthAudit(f.tx, event, signal())); assert.equal(getters, 0); assert.equal(f.globalCalls, 0);
    assert.ok(!JSON.stringify(f.rows).includes('must-not-log'));
  }
  const f = fixture(), controller = new AbortController(); controller.abort(); await assert.rejects(() => f.logs.recordOriginalOAuthAudit(f.tx, f.event, controller.signal)); assert.equal(f.rows.length, 0);
  await assert.rejects(() => f.logs.recordOriginalOAuthAudit({}, f.event, signal())); assert.equal(f.globalCalls, 0);
  assert.throws(() => createOriginalMcpOAuthAudit({}), /unavailable/i);
});

test('code audit resolves exact persisted original grant association and rejects mismatched or accessor evidence without writing', async () => {
  for (const kind of ['missing', 'wrong-consent', 'wrong-revision', 'index-mismatch', 'getter', 'caller-token']) {
    const f = fixture(); let input = { authorizationId: 'original-consent', authorizationRevision: 2, grantId: 'grant-a' }, getters = 0;
    if (kind === 'missing') f.grantRows = [];
    if (kind === 'wrong-consent') f.grantRows[0].recordJson = JSON.stringify({ ...f.grant, consentRef: 'another-consent' });
    if (kind === 'wrong-revision') f.grantRows[0].recordJson = JSON.stringify({ ...f.grant, consentRevision: 1 });
    if (kind === 'index-mismatch') f.grantRows[0].tenantId = 'other-tenant';
    if (kind === 'getter') Object.defineProperty(f.grantRows[0], 'recordJson', { enumerable: true, get() { getters++; return '{}'; } });
    if (kind === 'caller-token') input = { ...input, token: 'must-not-log' };
    await assert.rejects(() => f.audit.code(f.tx, input, signal()), /unavailable/i); assert.equal(f.rows.length, 0); assert.equal(getters, 0);
  }
});
