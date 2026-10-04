'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { createPersistedTenantModelConfiguration, createScopeBoundTenantModelConnection } = require('../apps/api/src/modules/ai-native/tenant-model-config.composition');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const { PrismaTenantModelProfileRepository } = require('../apps/api/src/modules/ai-native/tenant-model-profile.repository');
const { PrismaProviderProfileRepository } = require('../apps/api/src/modules/ai-native/provider-profile.repository');
const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
const clone = value => structuredClone(value);
const context = { tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space', actorId: 'synthetic-user' };
const settings = { protocol: 'openai_chat_completions', baseUrl: 'https://synthetic-model.example.test/v1', model: 'synthetic/model', enabled: true, expectedRevision: 0, apiKey: 'synthetic-secret-only' };
const code = name => error => error.code === name;
const matches = (row, where) => row && Object.entries(where).every(([key, val]) => row[key] === val);
const unique = () => new Prisma.PrismaClientKnownRequestError('synthetic uniqueness', { code: 'P2002', clientVersion: 'test' });

function harness() {
  const state = { configurations: [], profiles: [], calls: [], fail: null, legacy: null, authorized: true, revokeAfterProfile: false,
    scope: { id: 'synthetic-tenant-owner', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: context.tenantId }) } };
  const write = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : clone(value)]));
  const delegates = target => ({
    systemParameterSet: { findFirst: async () => clone(state.legacy) },
    aiScope: { findFirst: async args => matches(state.scope, args.where) ? clone(state.scope) : null },
    aiTenantModelConfiguration: {
      findUnique: async args => clone(target.configurations.find(row => matches(row, args.where)) ?? null),
      create: async args => { if (target.configurations.some(row => row.tenantId === args.data.tenantId)) throw unique(); const row = write(args.data); target.configurations.push(row); return clone(row); },
      updateMany: async args => { const row = target.configurations.find(row => matches(row, args.where)); if (!row) return { count: 0 }; Object.assign(row, write(args.data)); return { count: 1 }; }
    },
    aiProviderProfile: {
      findFirst: async args => clone(target.profiles.find(row => matches(row, args.where)) ?? null),
      create: async args => {
        if (state.fail === 'profile') throw Error('synthetic profile failure');
        if (target.profiles.some(row => row.scopeId === args.data.scopeId && row.scopeKind === args.data.scopeKind && (row.role === args.data.role || row.profileKey === args.data.profileKey))) throw unique();
        const row = { id: 'synthetic-default-profile', disabledAt: null, ...write(args.data) }; target.profiles.push(row);
        if (state.revokeAfterProfile) state.authorized = false;
        return clone(row);
      },
      updateMany: async args => {
        if (state.fail === 'profile') throw Error('synthetic profile failure');
        const row = target.profiles.find(row => matches(row, args.where)); if (!row) return { count: 0 };
        Object.assign(row, write(args.data)); if (state.revokeAfterProfile) state.authorized = false;
        return { count: 1 };
      }
    }
  });
  let tail = Promise.resolve();
  const db = { ...delegates(state), $transaction: operation => {
    state.calls.push('transaction');
    const result = tail.then(async () => {
      const draft = { configurations: clone(state.configurations), profiles: clone(state.profiles) };
      const returned = await operation(delegates(draft));
      if (state.fail === 'commit') throw Error('synthetic commit rollback');
      state.configurations = draft.configurations; state.profiles = draft.profiles;
      if (state.fail === 'ack') throw Error('synthetic commit acknowledgement lost');
      return returned;
    }); tail = result.catch(() => {}); return result;
  } };
  const authorize = async requested => {
    if (!state.authorized || !matches(requested, context) || Object.keys(requested).length !== 3) throw Error('synthetic authority denied');
  };
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-only' : 'production' });
  const service = () => createPersistedTenantModelConfiguration({ db, authorize, secrets });
  return { state, db, service, authorize, secrets };
}

test('capability policy CAS advances config and Profile together, preserves BYOK and does not prove capability', async () => {
  const h = harness(); await h.service().save(context, settings);
  const cipher = h.state.configurations[0].credentialsEncrypted;
  const result = await h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: ['text', 'streaming'] });
  assert.deepEqual(result, { revision: 2, allowedCapabilities: ['text', 'streaming'] });
  assert.equal(h.state.configurations[0].credentialsEncrypted, cipher);
  assert.equal(h.state.configurations[0].revision, 2); assert.equal(h.state.profiles[0].configRevision, 2);
  assert.deepEqual(h.state.profiles[0].allowedCapabilities, result.allowedCapabilities);
  assert.equal(h.state.profiles[0].model, settings.model);
  const preflight = new ProviderCapabilityService({ list: async () => [], upsert: async () => { throw Error('not a probe'); } });
  const row = clone(h.state.profiles[0]);
  const checked = await preflight.preflight(row, ['text']);
  assert.equal(checked.allowed, false); assert.deepEqual(checked.missing, ['text']);
  assert.equal(await h.service().credential(h.state.profiles[0].credentialRef, context), settings.apiKey);
  assert.equal(JSON.stringify(result).includes(settings.apiKey), false);
});

test('policy write failure, commit rollback and revoked authority preserve both old revisions and policy', async () => {
  for (const failure of ['profile', 'commit', 'revoked']) {
    const h = harness(); await h.service().save(context, settings);
    const before = { configurations: clone(h.state.configurations), profiles: clone(h.state.profiles) };
    if (failure === 'revoked') h.state.revokeAfterProfile = true; else h.state.fail = failure;
    await assert.rejects(h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: ['text'] }));
    assert.deepEqual(h.state.configurations, before.configurations); assert.deepEqual(h.state.profiles, before.profiles);
  }
});

test('policy and configuration competing for one revision have one winner; no silent merge', async () => {
  const h = harness(); await h.service().save(context, settings);
  const results = await Promise.allSettled([
    h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: ['text'] }),
    h.service().save(context, { ...settings, expectedRevision: 1, model: 'synthetic/changed' })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.state.configurations[0].revision, 2); assert.equal(h.state.profiles[0].configRevision, 2);
  const policyWon = results[0].status === 'fulfilled';
  assert.deepEqual(h.state.profiles[0].allowedCapabilities, policyWon ? ['text'] : []);
  assert.equal(h.state.profiles[0].model, policyWon ? settings.model : 'synthetic/changed');
});

test('policy commit response loss is not retried; rebuilt service reads committed revision', async () => {
  const h = harness(); await h.service().save(context, settings); h.state.fail = 'ack';
  await assert.rejects(h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: ['text'] }), /acknowledgement/);
  assert.equal(h.state.calls.length, 2); h.state.fail = null;
  assert.equal((await h.service().get(context)).revision, 2);
  await assert.rejects(h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: [] }), code('CONFIG_INVALID'));
  assert.deepEqual(h.state.profiles[0].allowedCapabilities, ['text']);
});

test('policy input whitelist, revision, tenant and absence are rejected without a transaction', async () => {
  const h = harness();
  for (const value of [
    { expectedRevision: 1, allowedCapabilities: ['text', 'text'] },
    { expectedRevision: 1, allowedCapabilities: ['invented'] },
    { expectedRevision: 4294967295, allowedCapabilities: [] },
    { expectedRevision: 1, allowedCapabilities: [], enabled: true }
  ]) await assert.rejects(h.service().setAllowedCapabilities(context, value), code('CONFIG_INVALID'));
  await assert.rejects(h.service().setAllowedCapabilities(context, { expectedRevision: 1, allowedCapabilities: ['text'] }), code('CONFIG_INVALID'));
  await assert.rejects(h.service().setAllowedCapabilities({ ...context, tenantId: 'other' }, { expectedRevision: 1, allowedCapabilities: [] }), code('FORBIDDEN'));
  assert.equal(h.state.calls.length, 0);
});

test('policy never enables retained BYOK while platform mode is selected; explicit empty clears allowlist', async () => {
  const h = harness(); await h.service().save(context, settings);
  await h.service().changeMode(context, { expectedRevision: 1, mode: 'platform_managed' });
  await h.service().setAllowedCapabilities(context, { expectedRevision: 2, allowedCapabilities: ['text'] });
  assert.equal(h.state.profiles[0].enabled, false); assert.equal(h.state.configurations[0].mode, 'platform_managed');
  await h.service().setAllowedCapabilities(context, { expectedRevision: 3, allowedCapabilities: [] });
  assert.deepEqual(h.state.profiles[0].allowedCapabilities, []); assert.equal(h.state.configurations[0].revision, 4);
});

test('configuration save materializes canonical tenant DEFAULT Profile with the same revision and vault reference', async () => {
  const h = harness(); await h.service().save(context, settings);
  assert.equal(h.state.profiles.length, 1);
  const p = h.state.profiles[0], cfg = h.state.configurations[0], selected = await h.service().profile(context);
  assert.equal(p.configRevision, cfg.revision); assert.equal(p.scopeId, h.state.scope.id);
  assert.equal(p.scopeKind, 'TENANT'); assert.equal(p.serviceMode, 'tenant_managed');
  assert.equal(p.credentialRef, selected.credentialRef); assert.equal(p.model, cfg.settings.model);
  assert.deepEqual(p.allowedCapabilities, [], 'saving config must not invent verified capabilities');
});

test('platform switch retains exact ciphertext, disables BYOK and moves both revisions; switching back invalidates old route', async () => {
  const h = harness(); await h.service().save(context, settings);
  const cipher = h.state.configurations[0].credentialsEncrypted, old = clone(h.state.profiles[0]);
  await h.service().changeMode(context, { mode: 'platform_managed', expectedRevision: 1 });
  assert.equal(h.state.configurations[0].credentialsEncrypted, cipher);
  assert.equal(h.state.profiles[0].enabled, false); assert.equal(h.state.profiles[0].configRevision, 2);
  await h.service().changeMode(context, { mode: 'tenant_managed', expectedRevision: 2 });
  assert.equal(h.state.profiles[0].enabled, true); assert.equal(h.state.profiles[0].configRevision, 3);
  assert.equal(h.state.configurations[0].revision, 3);
  const scopes = { resolveRoutingScopes: async () => ({ context: { actor: { kind: 'user', userId: context.actorId }, scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId } },
    configurationScope: { id: h.state.scope.id, kind: 'TENANT', tenantId: context.tenantId } }) };
  const resolver = createScopeBoundTenantModelConnection(h.service(), scopes);
  await assert.rejects(resolver.resolve(context, old), code('CONFIG_INVALID'));
  assert.equal((await resolver.resolve(context, clone(h.state.profiles[0]))).credential, settings.apiKey);
});

test('clear and disabled configuration stop DEFAULT Profile without granting any capabilities', async () => {
  const h = harness(); await h.service().save(context, settings);
  await h.service().save(context, { ...settings, apiKey: undefined, expectedRevision: 1, secretChange: { operation: 'clear' } });
  assert.equal(h.state.profiles[0].enabled, false);
  assert.equal(h.state.configurations[0].credentialsEncrypted, '');
  assert.equal(h.state.profiles[0].configRevision, h.state.configurations[0].revision);
  await assert.rejects(h.service().credential(h.state.profiles[0].credentialRef, context), code('CREDENTIAL_UNAVAILABLE'));
});

test('Profile write and transaction commit failures roll back configuration and Profile together', async () => {
  for (const failure of ['profile', 'commit']) {
    const h = harness(); h.state.fail = failure;
    await assert.rejects(h.service().save(context, settings), /synthetic/);
    assert.equal(h.state.configurations.length, 0); assert.equal(h.state.profiles.length, 0);
  }
});

test('losing update and independent Profile revision drift never leave a half configuration', async () => {
  const h = harness(); await h.service().save(context, settings);
  const results = await Promise.allSettled([h.service().save(context, { ...settings, expectedRevision: 1, model: 'synthetic/new' }), h.service().save(context, { ...settings, expectedRevision: 1, model: 'synthetic/other' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(h.state.configurations[0].revision, 2); assert.equal(h.state.profiles[0].configRevision, 2);
  h.state.profiles[0].configRevision = 4;
  const before = clone(h.state.configurations);
  await assert.rejects(h.service().save(context, { ...settings, expectedRevision: 2 }), code('CONFIG_INVALID'));
  assert.deepEqual(h.state.configurations, before);
});

test('colliding Profile key or incorrect mode rolls back the new configuration', async () => {
  for (const existing of [{ role: 'REASONING', profileKey: 'default', configRevision: 1, serviceMode: 'tenant_managed' },
    { role: 'DEFAULT', profileKey: 'default', configRevision: 0, serviceMode: 'platform_managed' }]) {
    const h = harness(); h.state.profiles.push({ id: 'synthetic-existing', scopeId: h.state.scope.id, scopeKind: 'TENANT', ...existing });
    const before = clone(h.state.profiles);
    await assert.rejects(h.service().save(context, settings), code('CONFIG_INVALID'));
    assert.equal(h.state.configurations.length, 0); assert.deepEqual(h.state.profiles, before);
  }
});

test('caller mutation during first authorization cannot change the intended destination or identity', async () => {
  const h = harness(), requested = clone(context), payload = clone(settings);
  let release, reached;
  const arrived = new Promise(resolve => { reached = resolve; });
  let calls = 0;
  const authorize = async value => { if (++calls === 1) { reached(); await new Promise(resolve => { release = resolve; }); } await h.authorize(value); };
  const service = createPersistedTenantModelConfiguration({ db: h.db, authorize, secrets: h.secrets });
  const saving = service.save(requested, payload); await arrived;
  requested.tenantId = 'other'; payload.baseUrl = 'https://synthetic-other.example.test/v1'; payload.model = 'synthetic/changed';
  release(); await saving;
  assert.equal(h.state.configurations[0].tenantId, context.tenantId);
  assert.equal(h.state.configurations[0].settings.baseUrl, settings.baseUrl);
  assert.equal(h.state.profiles[0].model, settings.model);
});

test('commit success/acknowledgement loss reconstructs matching state without retrying the write', async () => {
  const h = harness(); h.state.fail = 'ack';
  await assert.rejects(h.service().save(context, settings), /acknowledgement/);
  assert.equal(h.state.calls.length, 1); assert.equal(h.state.configurations[0].revision, 1); assert.equal(h.state.profiles[0].configRevision, 1);
  h.state.fail = null;
  assert.equal((await h.service().profile(context)).credentialRef, h.state.profiles[0].credentialRef);
  await assert.rejects(h.service().save(context, settings), code('CONFIG_INVALID'));
  assert.equal(h.state.calls.length, 1, 'service refuses stale revision before another transaction');
});

test('revocation during Profile write rolls back all changes rather than committing a revoked save', async () => {
  const h = harness(); h.state.revokeAfterProfile = true;
  await assert.rejects(h.service().save(context, settings), code('FORBIDDEN'));
  assert.equal(h.state.configurations.length, 0); assert.equal(h.state.profiles.length, 0);
});

test('missing or cross-tenant canonical owner refuses config commit; no fabricated scope ID', async () => {
  for (const corrupt of [null, { id: 'synthetic-other', kind: 'TENANT', tenantId: 'other', workspaceId: null, scopeKey: 'tenant:5:other' }]) {
    const h = harness(); h.state.scope = corrupt;
    await assert.rejects(h.service().save(context, settings), code('FORBIDDEN'));
    assert.equal(h.state.configurations.length, 0); assert.equal(h.state.profiles.length, 0);
  }
});

test('direct storage adapter cannot omit server context or use another tenant/actor', async () => {
  const h = harness(), repository = new PrismaTenantModelProfileRepository(h.db, h.authorize);
  const record = { tenantId: context.tenantId, revision: 1, mode: 'platform_managed' };
  await assert.rejects(repository.compareAndSwap(context.tenantId, 0, record), code('CONFIG_INVALID'));
  await assert.rejects(repository.compareAndSwap(context.tenantId, 0, record, { ...context, tenantId: 'other' }), code('CONFIG_INVALID'));
  await assert.rejects(repository.compareAndSwap(context.tenantId, 0, record, { ...context, actorId: 'other' }), code('FORBIDDEN'));
  assert.equal(h.state.calls.length, 0);
});

test('fresh platform mode is not a BYOK Profile, unconverted legacy remains untouched', async () => {
  const h = harness();
  await h.service().changeMode(context, { mode: 'platform_managed', expectedRevision: 0 });
  assert.equal(h.state.configurations[0].mode, 'platform_managed'); assert.equal(h.state.profiles.length, 0);
  const legacy = harness(); legacy.state.legacy = { content: { aiModel: { apiKeyMasked: 'synthetic-masked' } } };
  await assert.rejects(legacy.service().save(context, settings), code('CREDENTIAL_UNAVAILABLE'));
  assert.equal(legacy.state.configurations.length, 0); assert.equal(legacy.state.profiles.length, 0);
});

test('mode/configuration changed during the final canonical scope recheck rejects the old BYOK credential', async () => {
  const h = harness(); await h.service().save(context, settings);
  const selected = clone(h.state.profiles[0]); let reads = 0;
  const scopes = { resolveRoutingScopes: async () => {
    if (++reads === 2) { await h.service().changeMode(context, { mode: 'platform_managed', expectedRevision: 1 }); }
    return { context: { actor: { kind: 'user', userId: context.actorId }, scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId } },
      configurationScope: { id: h.state.scope.id, kind: 'TENANT', tenantId: context.tenantId } };
  } };
  await assert.rejects(createScopeBoundTenantModelConnection(h.service(), scopes).resolve(context, selected), code('CONFIG_INVALID'));
});

test('generic Profile CAS cannot independently change a configuration-owned tenant or platform revision', async () => {
  for (const credentialRef of ['tenant-model:synthetic:1', 'platform-model:synthetic:1']) {
    const row = { id: 'synthetic-owned-profile', scopeId: 'synthetic-scope', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
      serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: settings.model,
      credentialRef, configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: [] };
    const repository = new PrismaProviderProfileRepository({ aiProviderProfile: {
      findMany: async () => [clone(row)], update: async args => {
        // Execute the actual generated-Prisma negative predicates, not a copied
        // authorization algorithm. Without these predicates this regression fails.
        if (args.where.NOT?.some(condition => row.credentialRef.startsWith(condition.credentialRef.startsWith))) {
          throw new Prisma.PrismaClientKnownRequestError('synthetic CAS rejection', { code: 'P2025', clientVersion: 'test' });
        }
        row.configRevision++; row.model = args.data.model; return clone(row);
      }
    } });
    assert.equal(await repository.update({ id: row.scopeId, kind: row.scopeKind }, row.profileKey, { expectedRevision: 1, model: 'synthetic/changed' }), null);
    assert.equal(row.configRevision, 1); assert.equal(row.model, settings.model);
  }
});
