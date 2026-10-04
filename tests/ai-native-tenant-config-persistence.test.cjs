'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaTenantModelConfigRepository } = require('../apps/api/src/modules/ai-native/tenant-model-config.repository');
const { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } = require('../apps/api/src/modules/ai-native/tenant-model-config.composition');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { PlatformModelConfigService } = require('../apps/api/src/modules/ai-native/platform-model-config.service');
const { AI_CONTRACT_DRAFT_VERSION } = require('../packages/shared/src/ai-native');
const context = { tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space', actorId: 'synthetic-user' };
const settings = { protocol: 'openai_chat_completions', baseUrl: 'https://synthetic-model.example.test/v1', model: 'synthetic/model', enabled: true };
const secret = 'synthetic-secret-test-only';
const rejected = code => error => error.code === code;
const clone = value => value == null ? value : structuredClone(value);

// Storage substitute executes the actual adapter's generated-Prisma predicates.
// It is NOT MySQL locking, a transaction engine, or server authentication.
function setup() {
  const state = { rows: [], legacy: null, calls: [], authority: true, fail: null, beforeLegacy: null };
  const write = (row, data) => Object.assign(row, Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : clone(value)])));
  const db = {
    systemParameterSet: { findFirst: async args => { state.calls.push(['legacy', clone(args)]); if (state.beforeLegacy) await state.beforeLegacy(); return clone(state.legacy); } },
    aiTenantModelConfiguration: {
      findUnique: async args => { state.calls.push(['read', clone(args)]); return clone(state.rows.find(row => row.tenantId === args.where.tenantId) ?? null); },
      create: async args => {
        state.calls.push(['create', args]);
        if (state.fail === 'write') throw Error('synthetic write failure');
        if (state.rows.some(row => row.tenantId === args.data.tenantId)) throw new Prisma.PrismaClientKnownRequestError('synthetic uniqueness', { code: 'P2002', clientVersion: 'test' });
        const row = {}; write(row, args.data); state.rows.push(row);
        if (state.fail === 'ack') throw Error('synthetic commit acknowledgement lost');
        return clone(row);
      },
      updateMany: async args => {
        state.calls.push(['update', args]);
        if (state.fail === 'write') throw Error('synthetic write failure');
        const row = state.rows.find(row => row.tenantId === args.where.tenantId && row.revision === args.where.revision);
        if (!row) return { count: 0 };
        write(row, args.data);
        if (state.fail === 'ack') throw Error('synthetic commit acknowledgement lost');
        return { count: 1 };
      }
    }
  };
  const secrets = new SecretBox({ get: name => name === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-key-only' : 'production' });
  const authorize = async requested => {
    if (!state.authority || requested.actorId !== context.actorId || requested.tenantId !== context.tenantId || requested.workspaceId !== context.workspaceId) throw Error('synthetic revoked authority');
  };
  const service = () => createPersistedTenantModelConfiguration({ db, authorize, secrets });
  return { state, db, service, authorize, secrets, repository: new PrismaTenantModelConfigRepository(db) };
}

test('new tenant remains platform/not_verified without implicit activation or persistence', async () => {
  const h = setup();
  assert.deepEqual(await h.service().get(context), { mode: 'platform_managed', serviceName: 'Rental OS AI', revision: 0, availability: 'not_verified' });
  assert.equal(h.state.rows.length, 0);
  await assert.rejects(h.service().profile(context), rejected('PROVIDER_UNAVAILABLE'));
});

test('actual config service and repository retain ciphertext and recover configuration after reconstruction', async () => {
  const h = setup();
  const saved = await h.service().save(context, { ...settings, expectedRevision: 0, apiKey: secret });
  assert.equal(saved.keyConfigured, true);
  const cipher = h.state.rows[0].credentialsEncrypted;
  assert.match(cipher, /^v1:/);
  assert.equal(JSON.stringify(h.state.rows).includes(secret), false);
  await h.service().changeMode(context, { mode: 'platform_managed', expectedRevision: 1 });
  assert.equal(h.state.rows[0].credentialsEncrypted, cipher, 'mode switch retains exact ciphertext');
  assert.equal((await h.service().get(context)).serviceName, 'Rental OS AI');
  await assert.rejects(h.service().profile(context), rejected('PROVIDER_UNAVAILABLE'));
  await h.service().changeMode(context, { mode: 'tenant_managed', expectedRevision: 2 });
  const restored = h.service();
  const profile = await restored.profile(context);
  assert.equal(await restored.credential(profile.credentialRef, context), secret);
});

test('saving a retained BYOK draft while platform mode is selected does not commit and then report failure', async () => {
  const h = setup();
  const facade = new PlatformModelConfigService({ authorize: h.authorize, repository: h.repository }, h.secrets);
  await facade.switchMode(context, 'platform_managed', 0);
  const saved = await facade.saveTenantService(context, { ...settings, expectedRevision: 1, apiKey: secret });
  assert.equal(saved.mode, 'platform_managed', 'saving BYOK draft does not implicitly switch active mode');
  assert.equal(saved.revision, 2);
  assert.equal(h.state.rows[0].mode, 'platform_managed');
  assert.match(h.state.rows[0].credentialsEncrypted, /^v1:/);
  await facade.switchMode(context, 'tenant_managed', 2);
  assert.equal(await facade.tenantCredential((await facade.tenantProfile(context)).credentialRef, context), secret);
});

test('retain replace clear and stale configuration references use persistent revisions', async () => {
  const h = setup();
  await h.service().save(context, { ...settings, expectedRevision: 0, apiKey: secret });
  const old = await h.service().profile(context);
  await h.service().save(context, { ...settings, expectedRevision: 1, secretChange: { operation: 'retain' } });
  await assert.rejects(h.service().credential(old.credentialRef, context), rejected('CREDENTIAL_UNAVAILABLE'));
  await h.service().save(context, { ...settings, expectedRevision: 2, secretChange: { operation: 'replace', apiKey: 'synthetic-rotated-secret' } });
  assert.equal(await h.service().credential((await h.service().profile(context)).credentialRef, context), 'synthetic-rotated-secret');
  await h.service().save(context, { ...settings, expectedRevision: 3, secretChange: { operation: 'clear' } });
  assert.equal(h.state.rows[0].credentialsEncrypted, '');
  assert.equal((await h.service().get(context)).enabled, false);
});

test('last revision competition and create competition have exactly one CAS winner', async () => {
  const h = setup();
  const next = { tenantId: context.tenantId, revision: 1, mode: 'platform_managed' };
  assert.deepEqual((await Promise.all([h.repository.compareAndSwap(context.tenantId, 0, next), h.repository.compareAndSwap(context.tenantId, 0, next)])).sort(), [false, true]);
  assert.deepEqual((await Promise.all([h.repository.compareAndSwap(context.tenantId, 1, { ...next, revision: 2 }), h.repository.compareAndSwap(context.tenantId, 1, { ...next, revision: 2 })])).sort(), [false, true]);
  assert.equal(h.state.rows[0].revision, 2);
});

test('unconverted masked legacy AI configuration is not silently treated as new platform tenant', async () => {
  const h = setup();
  h.state.legacy = { content: { aiModel: { apiKeyMasked: 'synthetic-masked', baseUrl: settings.baseUrl, lastTestStatus: '成功' } } };
  const original = clone(h.state.legacy);
  await assert.rejects(h.service().get(context), rejected('CREDENTIAL_UNAVAILABLE'));
  await assert.rejects(h.service().save(context, { ...settings, expectedRevision: 0, apiKey: secret }), rejected('CREDENTIAL_UNAVAILABLE'));
  assert.deepEqual(h.state.legacy, original);
  assert.equal(h.state.rows.length, 0);
});

test('malformed legacy content fails closed and non-AI system rules allow a new tenant', async () => {
  const h = setup();
  h.state.legacy = { content: 'invalid' };
  await assert.rejects(h.repository.read(context.tenantId), rejected('CONFIG_INVALID'));
  h.state.legacy = { content: { timezone: 'UTC' } };
  assert.equal(await h.repository.read(context.tenantId), null);
});

test('cross-tenant writes, bad revision and raw secrets are rejected before any storage write', async () => {
  const h = setup();
  for (const next of [{ tenantId: 'other-tenant', revision: 1, mode: 'platform_managed' },
    { tenantId: context.tenantId, revision: 2, mode: 'platform_managed' },
    { tenantId: context.tenantId, revision: 1, mode: 'platform_managed', apiKey: secret },
    { tenantId: context.tenantId, revision: 1, mode: 'tenant_managed', credentialsEncrypted: secret }]) {
    await assert.rejects(h.repository.compareAndSwap(context.tenantId, 0, next), rejected('CONFIG_INVALID'));
  }
  assert.equal(h.state.calls.length, 0);
});

test('await mutation cannot change the detached CAS payload or tenant', async () => {
  const h = setup();
  let resume;
  h.state.beforeLegacy = () => new Promise(resolve => { resume = resolve; });
  const next = { tenantId: context.tenantId, revision: 1, mode: 'platform_managed' };
  const pending = h.repository.compareAndSwap(context.tenantId, 0, next);
  next.tenantId = 'forged'; next.revision = 55; next.mode = 'tenant_managed';
  resume(); await pending;
  assert.equal(h.state.rows[0].tenantId, context.tenantId);
  assert.equal(h.state.rows[0].mode, 'platform_managed');
  assert.equal(h.state.rows[0].revision, 1);
});

test('write failure and committed-ack-loss remain distinct, neither is automatically retried', async () => {
  for (const failure of ['write', 'ack']) {
    const h = setup(); h.state.fail = failure;
    await assert.rejects(h.repository.compareAndSwap(context.tenantId, 0, { tenantId: context.tenantId, revision: 1, mode: 'platform_managed' }), /synthetic/);
    assert.equal(h.state.calls.filter(([kind]) => kind === 'create').length, 1);
    assert.equal(h.state.rows.length, failure === 'ack' ? 1 : 0);
    h.state.fail = null;
    assert.equal((await h.repository.read(context.tenantId))?.revision ?? 0, failure === 'ack' ? 1 : 0);
  }
});

test('explicit composition requires action authority and secrets, no allow-all fallback', () => {
  assert.throws(() => createPersistedTenantModelConfiguration({}), rejected('CONFIG_INVALID'));
  assert.throws(() => createScopeBoundTenantModelConnection({}, {}), rejected('CONFIG_INVALID'));
});

test('existing connection resolver consumes saved configuration and canonical owner checks', async () => {
  const h = setup(), service = h.service();
  await service.save(context, { ...settings, expectedRevision: 0, apiKey: secret });
  const configured = await service.profile(context);
  const resolved = { context: { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'synthetic-request', authorizedAt: '2026-10-05T00:00:00Z',
    actor: { kind: 'user', userId: context.actorId }, audience: 'operator', scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId },
    access: { permissions: [], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } },
    consumerScope: { id: 'scope-space', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId },
    configurationScope: { id: 'scope-tenant', kind: 'TENANT', tenantId: context.tenantId } };
  const scopes = { resolveRoutingScopes: async () => clone(resolved) };
  const resolver = createScopeBoundTenantModelConnection(service, scopes);
  const profile = { id: 'synthetic-profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: 'compatible', model: settings.model,
    credentialRef: configured.credentialRef, configRevision: 1, enabled: true, allowedCapabilities: ['text'], disabledAt: null };
  const connection = await resolver.resolve(context, profile);
  assert.equal(connection.credential, secret);
  assert.equal(connection.baseUrl, settings.baseUrl);
  await assert.rejects(resolver.resolve(context, { ...profile, scopeId: 'other-owner' }), rejected('FORBIDDEN'));
  await assert.rejects(resolver.resolve(context, { ...profile, configRevision: 2 }), rejected('CONFIG_INVALID'));
  h.state.authority = false;
  await assert.rejects(resolver.resolve(context, profile), rejected('FORBIDDEN'));
});
