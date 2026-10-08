'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { PrismaProviderProfileRepository } = require('../apps/api/src/modules/ai-native/provider-profile.repository');
const scope = { id: 'scope-1', kind: 'TENANT', tenantId: 'tenant-1' };
const row = { id: 'profile-1', scopeId: scope.id, scopeKind: scope.kind, profileKey: 'default', role: 'DEFAULT',
  serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'compatible', model: 'model-1',
  credentialRef: 'vault-1', configRevision: 1, enabled: true, allowedCapabilities: ['text'], disabledAt: null };

test('CAS returns its own atomic write projection rather than another writer revision', async () => {
  const writes = [];
  const repository = new PrismaProviderProfileRepository({ aiProviderProfile: {
    findMany: async () => [],
    updateMany: async args => { writes.push(args); return { count: 1 }; },
    // A different writer committed before a separate read. This must not be this CAS result.
    findFirst: async () => ({ ...row, configRevision: 3, model: 'other-writer' }),
    update: async args => { writes.push(args); assert.equal(args.where.configRevision, 1);
      assert.deepEqual(args.where.scopeId_scopeKind_profileKey, { scopeId: scope.id, scopeKind: scope.kind, profileKey: 'default' });
      return { ...row, configRevision: 2, model: 'this-writer' }; }
  } });
  const result = await repository.update(scope, 'default', { expectedRevision: 1, model: 'this-writer' });
  assert.equal(result.configRevision, 2);
  assert.equal(result.model, 'this-writer');
  assert.equal(writes.length, 1);
});

test('unsigned revision overflow is rejected before a persistence call', async () => {
  let writes = 0;
  const repository = new PrismaProviderProfileRepository({ aiProviderProfile: { findMany: async () => [],
    updateMany: async () => { writes++; return { count: 0 }; }, update: async () => { writes++; return row; } } });
  await assert.rejects(repository.update(scope, 'default', { expectedRevision: 4294967295 }), /AI_PROFILE_INVALID_REVISION/);
  assert.equal(writes, 0);
});

test('corrupt persisted capability and service mode never become a routed profile', async () => {
  for (const corrupt of [{ allowedCapabilities: ['arbitrary_execution'] }, { serviceMode: 'unknown-mode' }, { configRevision: 0 }]) {
    const repository = new PrismaProviderProfileRepository({ aiProviderProfile: { findMany: async () => [],
      findFirst: async () => ({ ...row, ...corrupt }), update: async () => row } });
    await assert.rejects(repository.get(scope, 'default'), /AI_PROFILE_INVALID_ROW/);
  }
});

test('commit acknowledgement loss is not rewritten to a harmless CAS conflict or retried', async () => {
  let writes = 0;
  const uncertain = Error('synthetic commit acknowledgement loss');
  const repository = new PrismaProviderProfileRepository({ aiProviderProfile: { findMany: async () => [],
    update: async () => { writes++; throw uncertain; } } });
  await assert.rejects(repository.update(scope, 'default', { expectedRevision: 1, enabled: false }), error => error === uncertain);
  assert.equal(writes, 1);
});

test('read projection strips unknown storage fields without leaking raw credential material', async () => {
  const repository = new PrismaProviderProfileRepository({ aiProviderProfile: { findMany: async () => [],
    findFirst: async () => ({ ...row, unexpectedSecret: 'synthetic-sensitive-value' }), update: async () => row } });
  const result = await repository.get(scope, 'default');
  assert.equal(Object.hasOwn(result, 'unexpectedSecret'), false);
  assert.deepEqual(result.allowedCapabilities, ['text']);
});
