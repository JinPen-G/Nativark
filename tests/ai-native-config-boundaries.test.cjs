'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { TenantModelConfigService } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const f = require('./fixtures/ai-native/model-config-compatibility.cjs');
function setup() {
  const rows = new Map(), events = [], secrets = new SecretBox({ get: () => 'synthetic-encryption-only' });
  const ports = { authorize: async ctx => { events.push(['authorize', ctx.tenantId]); if (ctx.tenantId !== f.context.tenantId) throw new Error('denied'); }, repository: { read: async id => { events.push(['read', id]); return rows.get(id) ?? null; }, compareAndSwap: async (id, revision, row) => { events.push(['write', id]); if ((rows.get(id)?.revision ?? 0) !== revision) return false; rows.set(id, structuredClone(row)); return true; } } };
  return { rows, events, ports, secrets, service: new TenantModelConfigService(ports, secrets) };
}
test('caller mutation during authorization cannot switch the tenant subsequently read or written', async () => {
  const h = setup(), ctx = { ...f.context }; let finish, entered = false;
  h.ports.authorize = async scope => { h.events.push(['authorize', scope.tenantId]); if (scope.tenantId !== f.context.tenantId) throw new Error(); if (!entered) { entered = true; await new Promise(resolve => { finish = resolve; }); } };
  const promise = h.service.save(ctx, f.settings); ctx.tenantId = 'unauthorized-tenant'; finish(); await promise;
  assert.equal(h.rows.has('unauthorized-tenant'), false); assert.equal(h.rows.has(f.context.tenantId), true);
  assert.ok(h.events.every(([, id]) => id === f.context.tenantId));
});
test('manage revoked while repository read waits prevents configuration CAS', async () => {
  const h = setup(); let allowed = true;
  h.ports.authorize = async () => { if (!allowed) throw new Error(); };
  h.ports.repository.read = async () => { allowed = false; return null; };
  await assert.rejects(h.service.save(f.context, f.settings), e => e.code === 'FORBIDDEN'); assert.equal(h.rows.size, 0);
});
test('invoke revoked during repository read prevents credential return', async () => {
  const h = setup(); await h.service.save(f.context, f.settings); const profile = await h.service.profile(f.context); let allowed = true;
  h.ports.authorize = async () => { if (!allowed) throw new Error(); };
  h.ports.repository.read = async id => { allowed = false; return h.rows.get(id); };
  await assert.rejects(h.service.credential(profile.credentialRef, f.context), e => e.code === 'FORBIDDEN');
});
test('revision overflow cannot persist an unreadable next revision', async () => {
  const h = setup(); await h.service.save(f.context, f.settings); h.rows.get(f.context.tenantId).revision = Number.MAX_SAFE_INTEGER - 1;
  const before = structuredClone(h.rows.get(f.context.tenantId));
  await assert.rejects(h.service.save(f.context, { ...f.settings, expectedRevision: Number.MAX_SAFE_INTEGER - 1 }), e => e.code === 'CONFIG_INVALID');
  assert.deepEqual(h.rows.get(f.context.tenantId), before);
});
test('explicit BYOK mode cannot activate corrupt ciphertext as a configured service', async () => {
  const h = setup(); await h.service.save(f.context, f.settings); await h.service.changeMode(f.context, { mode: 'platform_managed', expectedRevision: 1 }); h.rows.get(f.context.tenantId).credentialsEncrypted = 'corrupt';
  await assert.rejects(h.service.changeMode(f.context, { mode: 'tenant_managed', expectedRevision: 2 }), e => e.code === 'CREDENTIAL_UNAVAILABLE'); assert.equal(h.rows.get(f.context.tenantId).mode, 'platform_managed');
});
test('new whitespace/control/non-ASCII keys are rejected before encrypt/CAS, not stored unusably', async () => {
  for (const apiKey of ['synthetic key', 'synthetic\tkey', 'synthetic\u0000key', 'synthetic密钥']) {
    const h = setup(); await assert.rejects(h.service.save(f.context, { ...f.settings, apiKey }), e => e.code === 'CREDENTIAL_UNAVAILABLE'); assert.equal(h.rows.size, 0);
  }
});
