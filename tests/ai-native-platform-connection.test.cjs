'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaPlatformModelConnection } = require('../apps/api/src/modules/ai-native/platform-model-connection');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { RoutedModelTransport } = require('../apps/api/src/modules/ai-native/routed-model-transport');
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
const clone = value => structuredClone(value);
const context = { tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space', actorId: 'synthetic-user' };
const profile = { id: 'synthetic-profile', scopeId: 'synthetic-platform', scopeKind: 'PLATFORM', profileKey: 'default', role: 'DEFAULT',
  serviceMode: 'platform_managed', protocol: 'openai_chat_completions', provider: 'synthetic-provider', model: 'synthetic/model',
  credentialRef: 'unconfigured', configRevision: 1, enabled: false, disabledAt: null, allowedCapabilities: ['text'] };
const input = { profileId: profile.id, expectedRevision: 1, protocol: profile.protocol, model: profile.model,
  baseUrl: 'https://synthetic-model.example.test/v1', enabled: true, maxOutputTokens: 100,
  secretChange: { operation: 'replace', apiKey: 'synthetic-platform-key-only' } };
const rejects = code => error => error.code === code;

function harness() {
  const state = { profile: clone(profile), row: null, management: true, invocation: true, mode: 'manage', fail: null, managementCalls: 0, invokeCalls: 0, beforeInvoke: null };
  const matches = (row, where) => row && Object.entries(where).every(([k, v]) => row[k] === v);
  const delegates = target => ({
    aiProviderProfile: {
      findFirst: async args => matches(target.profile, args.where) ? { ...clone(target.profile), ...(args.include ? { platformConnection: clone(target.row) } : {}) } : null,
      updateMany: async args => { if (!matches(target.profile, args.where)) return { count: 0 }; Object.assign(target.profile, clone(args.data)); return { count: 1 }; }
    },
    aiPlatformModelConnection: {
      findUnique: async args => target.row?.profileId === args.where.profileId ? clone(target.row) : null,
      create: async args => { if (state.fail === 'vault') throw Error('synthetic vault write failure'); target.row = clone(args.data); return clone(target.row); },
      update: async args => { if (state.fail === 'vault') throw Error('synthetic vault write failure'); Object.assign(target.row, clone(args.data)); if (state.revokeAfterVault) state.management = false; return clone(target.row); }
    }
  });
  // Serialized transaction substitute checks real Prisma predicates and rollback.
  // It does not demonstrate MySQL locks/isolation or real authentication.
  let tail = Promise.resolve();
  const db = { ...delegates(state), $transaction: operation => {
    const result = tail.then(async () => {
      const draft = { profile: clone(state.profile), row: clone(state.row) };
      const returned = await operation(delegates(draft));
      if (state.fail === 'commit') throw Error('synthetic transaction rollback');
      state.profile = draft.profile; state.row = draft.row;
      if (state.fail === 'ack') throw Error('synthetic committed response lost');
      return returned;
    });
    tail = result.catch(() => {}); return result;
  } };
  const scopes = { resolveRoutingScopes: async () => ({ context: { actor: state.mode === 'manage' ? { kind: 'saas_admin', userId: 'synthetic-admin' } : { kind: 'user', userId: context.actorId },
    scope: state.mode === 'manage' ? { kind: 'platform' } : { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId },
    audience: 'operator', permissions: ['synthetic-explicit-test-authority'], requestId: 'synthetic-request', authorizedAt: '2026-10-05T00:00:00.000Z' },
    configurationScope: { id: profile.scopeId, kind: 'PLATFORM' } }) };
  const authority = { manage: async () => { state.managementCalls++; if (!state.management) throw Error(); },
    invoke: async received => { state.invokeCalls++; if (state.beforeInvoke) state.beforeInvoke(state.invokeCalls); if (!state.invocation || JSON.stringify(received) !== JSON.stringify(context)) throw Error(); } };
  const secrets = new SecretBox({ get: name => name === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-key-only' : 'production' });
  const service = () => new PrismaPlatformModelConnection(db, scopes, authority, secrets);
  return { state, service, db, scopes, authority, secrets };
}

test('platform policy is saved with vault/Profile revision and retain keeps the same usable secret', async () => {
  const h = await configured(), old = clone(h.state.profile); h.state.mode = 'manage';
  await h.service().save({ ...input, expectedRevision: 2, allowedCapabilities: ['text', 'streaming'], secretChange: { operation: 'retain' } });
  assert.equal(h.state.profile.configRevision, 3); assert.equal(h.state.row.configRevision, 3);
  assert.deepEqual(h.state.profile.allowedCapabilities, ['text', 'streaming']);
  h.state.mode = 'invoke';
  await assert.rejects(h.service().resolve(context, old), rejects('CONFIG_INVALID'));
  assert.equal((await h.service().resolve(context, clone(h.state.profile))).credential, input.secretChange.apiKey);
  const check = new ProviderCapabilityService({ list: async () => [], upsert: async () => { throw Error('not a probe'); } });
  assert.equal((await check.preflight(clone(h.state.profile), ['text'])).allowed, false);
});

test('omitted platform policy preserves, explicit empty clears; invalid entries cannot change vault', async () => {
  const h = await configured(); h.state.mode = 'manage';
  const retained = { ...input, expectedRevision: 2, secretChange: { operation: 'retain' } };
  const before = clone(h.state.row);
  for (const allowedCapabilities of [['text', 'text'], ['invented']]) {
    await assert.rejects(h.service().save({ ...retained, allowedCapabilities }), rejects('CONFIG_INVALID'));
    assert.deepEqual(h.state.row, before);
  }
  await h.service().save(retained); assert.deepEqual(h.state.profile.allowedCapabilities, ['text']);
  await h.service().save({ ...retained, expectedRevision: 3, allowedCapabilities: [] });
  assert.deepEqual(h.state.profile.allowedCapabilities, []); assert.equal(h.state.row.configRevision, 4);
});

test('platform policy failure cannot leave new allowlist with old vault revision', async () => {
  for (const failure of ['vault', 'commit']) {
    const h = await configured(); h.state.mode = 'manage'; h.state.fail = failure;
    const before = { profile: clone(h.state.profile), row: clone(h.state.row) };
    await assert.rejects(h.service().save({ ...input, expectedRevision: 2, allowedCapabilities: ['streaming'], secretChange: { operation: 'retain' } }));
    assert.deepEqual(h.state.profile, before.profile); assert.deepEqual(h.state.row, before.row);
  }
});

test('management revoked during vault write aborts policy and configuration transaction', async () => {
  const h = await configured(); h.state.mode = 'manage'; h.state.revokeAfterVault = true;
  const before = { profile: clone(h.state.profile), row: clone(h.state.row) };
  await assert.rejects(h.service().save({ ...input, expectedRevision: 2, allowedCapabilities: ['streaming'], secretChange: { operation: 'retain' } }), rejects('FORBIDDEN'));
  assert.deepEqual(h.state.profile, before.profile); assert.deepEqual(h.state.row, before.row);
});
async function configured() { const h = harness(); await h.service().save(input); h.state.mode = 'invoke'; return h; }

test('platform vault persists ciphertext and reconstructs actual resolver without exposing secrets in save result', async () => {
  const h = await configured();
  assert.equal(h.state.profile.configRevision, h.state.row.configRevision);
  assert.match(h.state.row.credentialsEncrypted, /^v1:/);
  assert.equal(JSON.stringify(h.state.row).includes(input.secretChange.apiKey), false);
  const connection = await h.service().resolve(context, clone(h.state.profile));
  assert.equal(connection.credential, input.secretChange.apiKey);
  assert.equal(connection.maxOutputTokens, 100);
});

test('missing vault, wrong owner, tenant mode and disabled profile fail closed', async () => {
  const h = await configured(), selected = clone(h.state.profile);
  h.state.row = null;
  await assert.rejects(h.service().resolve(context, selected), rejects('CREDENTIAL_UNAVAILABLE'));
  await assert.rejects(h.service().resolve(context, { ...selected, scopeId: 'synthetic-other' }), rejects('FORBIDDEN'));
  await assert.rejects(h.service().resolve(context, { ...selected, serviceMode: 'tenant_managed' }), rejects('CONFIG_INVALID'));
  await assert.rejects(h.service().resolve(context, { ...selected, enabled: false }), rejects('CONFIG_INVALID'));
});

test('configuration and Profile share CAS revision; only one concurrent replacement commits', async () => {
  const h = harness();
  const outcomes = await Promise.allSettled([h.service().save(input), h.service().save({ ...input, model: 'synthetic/other' })]);
  assert.equal(outcomes.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(h.state.profile.configRevision, 2); assert.equal(h.state.row.configRevision, 2);
});

test('vault write failure and commit failure roll back Profile increment and enablement', async () => {
  for (const failure of ['vault', 'commit']) {
    const h = harness(); h.state.fail = failure;
    await assert.rejects(h.service().save(input));
    assert.deepEqual(h.state.profile, profile); assert.equal(h.state.row, null);
  }
});

test('commit acknowledgement loss is not retried; old revision refuses replay', async () => {
  const h = harness(); h.state.fail = 'ack';
  await assert.rejects(h.service().save(input));
  assert.equal(h.state.profile.configRevision, 2); assert.equal(h.state.row.configRevision, 2);
  h.state.fail = null;
  await assert.rejects(h.service().save(input), rejects('CONFIG_INVALID'));
  assert.equal(h.state.profile.configRevision, 2);
});

test('retain cannot forward credential to another endpoint; clear disables and invalidates old route', async () => {
  const h = await configured(), old = clone(h.state.profile); h.state.mode = 'manage';
  await assert.rejects(h.service().save({ ...input, expectedRevision: 2, baseUrl: 'https://synthetic-other.example.test/v1', secretChange: { operation: 'retain' } }), rejects('CREDENTIAL_UNAVAILABLE'));
  const retained = await h.service().save({ ...input, expectedRevision: 2, model: 'synthetic/new-model', secretChange: { operation: 'retain' } });
  assert.equal(retained.revision, 3); assert.equal(JSON.stringify(retained).includes(input.secretChange.apiKey), false);
  await h.service().save({ ...input, expectedRevision: 3, secretChange: { operation: 'clear' } });
  assert.equal(h.state.profile.enabled, false); assert.equal(h.state.row.credentialsEncrypted, '');
  h.state.mode = 'invoke';
  await assert.rejects(h.service().resolve(context, old), rejects('CONFIG_INVALID'));
});

test('copied/tampered ciphertext and mismatched vault revision cannot supply a credential', async () => {
  for (const corrupt of [h => { h.state.row.configRevision++; }, h => { h.state.row.credentialsEncrypted = h.secrets.encrypt({ apiKey: input.secretChange.apiKey, profileId: 'synthetic-other' }); }, h => { h.state.row.baseUrl = 'https://synthetic-other.example.test'; }]) {
    const h = await configured(); corrupt(h);
    await assert.rejects(h.service().resolve(context, clone(h.state.profile)), rejects('CREDENTIAL_UNAVAILABLE'));
  }
});

test('fresh authorization rejects management by workspace actor and invocation revoked during await', async () => {
  const h = await configured();
  await assert.rejects(h.service().save({ ...input, expectedRevision: 2 }), rejects('FORBIDDEN'));
  h.state.beforeInvoke = count => { if (count === 2) h.state.invocation = false; };
  await assert.rejects(h.service().resolve(context, clone(h.state.profile)), rejects('FORBIDDEN'));
});

test('capability changes cannot bypass stored Profile comparison', async () => {
  const h = await configured();
  const selected = clone(h.state.profile);
  h.state.profile.allowedCapabilities = ['text', 'tools'];
  await assert.rejects(h.service().resolve(context, selected), rejects('CONFIG_INVALID'));
});

test('configuration disabled during final authorization cannot return previously decrypted secret', async () => {
  const h = await configured();
  h.state.beforeInvoke = count => { if (count === 2) { h.state.profile.enabled = false; h.state.profile.configRevision++; } };
  await assert.rejects(h.service().resolve(context, clone(h.state.profile)), rejects('CONFIG_INVALID'));
});

test('unsupported protocols, unsafe endpoints, revision overflow and missing dependencies reject before write', async () => {
  const h = harness();
  for (const changed of [{ protocol: 'unknown' }, { baseUrl: 'https://127.0.0.1/v1' }, { expectedRevision: 4294967295 }]) {
    await assert.rejects(h.service().save({ ...input, ...changed }), rejects('CONFIG_INVALID'));
  }
  assert.deepEqual(h.state.profile, profile);
  assert.throws(() => new PrismaPlatformModelConnection(h.db, h.scopes, {}, h.secrets), rejects('CONFIG_INVALID'));
});

test('stored platform connection feeds existing transport and real protocol adapter without tenant fallback', async () => {
  const h = await configured(), selected = clone(h.state.profile), sent = [];
  const adapter = new ChatCompletionsAdapter({ post: async value => {
    sent.push(value); return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'synthetic answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }) };
  } });
  const transport = new RoutedModelTransport({ platform: h.service(), tenant: { resolve: async () => { throw Error('tenant fallback forbidden'); } } }, [adapter]);
  const result = await transport.invoke(context, { callId: 'synthetic-call', model: selected.model, messages: [{ role: 'user', content: 'synthetic question' }], maxOutputTokens: 20 },
    { profile: selected, scope: { id: selected.scopeId, kind: 'PLATFORM' }, role: 'DEFAULT', preflight: { allowed: true, required: ['text'], missing: [], stale: [] } }, new AbortController().signal);
  assert.equal(result.text, 'synthetic answer'); assert.equal(sent.length, 1);
  assert.equal(sent[0].url, input.baseUrl + '/chat/completions');
  assert.equal(sent[0].headers.Authorization, 'Bearer ' + input.secretChange.apiKey);
  assert.equal(JSON.stringify(result).includes(input.secretChange.apiKey), false);
});
