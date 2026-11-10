"use strict";
/** Original identity/Guard regression; shared fixture keeps real source methods. */
const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path");
const { fixture, source, shared, identity, signal, AiCatalogReadFactsService, catalogConsumerUrl, output, cache, root } = require("./fixtures/mcp/original-identity.cjs");

test("current original principal and Guard establish exact catalog ALS without a Web token or copied role rules", async () => {
  const f = fixture();
  const result = await f.auth.withTrustedWorkspacePrincipal(f.tx, f.current, signal(), async resolve => {
    const authority = { withRead: (kind, input, read) => {
      assert.equal(kind, "catalog");
      return f.guard.withTrustedCatalogRead(input.limit, resolve, current => read({ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION,
        requestId: "original-request", authorizedAt: new Date().toISOString(), audience: current.audience,
        actor: { kind: "user", userId: current.userId }, scope: { kind: "workspace", tenantId: current.tenantId, workspaceId: current.workspaceId },
        access: { permissions: current.permissions, dataScope: current.dataScope, locationScope: current.locationScope, organizationId: current.organizationId } }), signal());
    } };
    const reader = new AiCatalogReadFactsService({ async listItemGroupsPage(tenantId, input) {
      f.coreReads++; assert.equal(tenantId, "tenant-a"); assert.equal(identity.requireRequestWorkspaceId(), "workspace-a");
      assert.equal(identity.requireRequestUserId(), "user-a"); assert.equal(input.limit, 2);
      return { rows: [{ id: "item-a", tenantId, code: "item-a", name: "Private original name", categoryCode: "camera", status: "enabled", unit: "day" }],
        truncated: false, nextCursor: null, source: "persisted_workspace_configuration", configurationVersion: "a".repeat(64) };
    } }, authority);
    return reader.read({ limit: 2 });
  });
  assert.equal(result.items.length, 1); assert.equal(f.coreReads, 1); assert.equal(f.configReads, 0, "new path does not sign/parse a Web token");
  assert.equal(f.currentReads, 4, "current binding read before/after both Guard authorizations");
  assert.equal(identity.getRequestIdentity(), undefined, "Guard-owned ALS does not leak outside its callback");
  assert.ok(f.calls.filter(([kind]) => kind === "tx-workspace").every(([, query]) => query.where.tenantId === "tenant-a"));
  await f.run(async current => { assert.deepEqual(current.permissions, ["rental-core:catalog:view"]); assert.equal(current.dataScope, "organization");
    assert.deepEqual(current.locationScope, { mode: "selected", locationIds: ["loc-a"] }); return "private-read"; });
});

test("trusted principal rejects forged, expired callback and reused tickets without widening Web authentication", async () => {
  const f = fixture(); let escapedResolve, escapedTicket;
  await f.auth.withTrustedWorkspacePrincipal(f.tx, f.current, signal(), async resolve => {
    escapedResolve = resolve; escapedTicket = await resolve();
    assert.throws(() => fixture().auth.consumeTrustedWorkspaceAccess(escapedTicket));
    const liveSpoof = { method: 'GET', url: '/api/rental/v1/item-groups', headers: {}, user: f.user, trustedWorkspaceAccess: escapedTicket };
    await assert.rejects(() => identity.runWithRequestIdentity({}, () => f.guard.canActivate({ switchToHttp: () => ({ getRequest: () => liveSpoof }) })), error => error.getStatus() === 401);
    f.auth.consumeTrustedWorkspaceAccess(escapedTicket); assert.throws(() => f.auth.consumeTrustedWorkspaceAccess(escapedTicket));
  });
  await assert.rejects(() => escapedResolve()); assert.throws(() => f.auth.consumeTrustedWorkspaceAccess({}));
  let pending, release;
  const wait = new Promise(resolve => { release = resolve; });
  await f.auth.withTrustedWorkspacePrincipal(f.tx, async () => { await wait; return f.binding; }, signal(), async resolve => {
    pending = resolve();
  });
  const rejected = assert.rejects(pending); release(); await rejected;
  const request = { method: "GET", url: "/api/rental/v1/item-groups", headers: { "x-trusted-principal": "user-a" }, user: f.user, query: { workspaceId: "workspace-a" } };
  await assert.rejects(() => identity.runWithRequestIdentity({}, () => f.guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) })), error => error.getStatus() === 401);
  const time = Math.floor(Date.now() / 1000), token = f.auth.signAccessToken({ sid: "original-web-session", sub: "user-a", tid: "tenant-a", wid: "workspace-a", aud: "operator", iat: time, exp: time + 60 });
  const context = await f.auth.resolveAccessContext("Bearer " + token); assert.equal(context.workspaceId, "workspace-a");
  await assert.rejects(() => f.auth.resolveAccessContext("Bearer " + token + "tampered").then(value => { if (!value) throw new Error("denied"); }));
  assert.equal(await f.auth.resolveAccessContext("Bearer opaque-mcp-token"), undefined);
});

test("cross-scope, loss of original rights, cancellation and failed-read revalidation all fail closed", async t => {
  for (const kind of ["cross-tenant", "cross-workspace", "inactive-member", "inactive-role", "saas", "password-change", "memory"]) {
    await t.test(kind, async () => {
      const f = fixture();
      if (kind === "cross-tenant") f.binding.tenantId = "tenant-b";
      if (kind === "cross-workspace") f.binding.workspaceId = "workspace-b";
      if (kind === "inactive-member") f.member.isActive = false;
      if (kind === "inactive-role") f.member.role.isActive = false;
      if (kind === "saas") f.user.isSaasAdmin = true;
      if (kind === "password-change") f.user.mustChangePassword = true;
      if (kind === "memory") f.mysql = false;
      await assert.rejects(() => f.run(async () => { f.coreReads++; })); assert.equal(f.coreReads, 0);
    });
  }
  for (const kind of ["revoked", "scope-changed", "permission-changed", "cancelled", "read-failed-and-revoked"]) {
    await t.test(kind, async () => {
      const f = fixture(), controller = new AbortController();
      await assert.rejects(() => f.run(async () => {
        f.coreReads++;
        if (kind.includes("revoked")) f.binding = undefined;
        if (kind === "scope-changed") f.binding.workspaceId = "workspace-b";
        if (kind === "permission-changed") f.member.role.permissions = [];
        if (kind === "cancelled") controller.abort();
        if (kind === "read-failed-and-revoked") throw new Error("private-reader-error");
        return "private-result";
      }, controller.signal), error => !error.message.includes("private-reader-error"));
      assert.equal(f.coreReads, 1); assert.equal(identity.getRequestIdentity(), undefined);
    });
  }
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.run(async () => { f.coreReads++; }, controller.signal)); assert.equal(f.currentReads, 0);
  let getters = 0; f.current = async () => ({ ...f.binding, get permissions() { getters++; return ["*"]; } });
  await assert.rejects(() => f.run(async () => {})); assert.equal(getters, 0);
  await assert.rejects(() => f.guard.withTrustedCatalogRead(51, async () => {}, async () => {}, signal()));
});

test("public catalog runtime export retains original validation and the same Guard/Core projection", async () => {
  const consumer = await import(catalogConsumerUrl);
  const original = source('apps/api/src/modules/ai-native/catalog-read-facts.service.ts');
  assert.equal(original.aiCatalogReadInputSchema, shared.aiCatalogReadInputSchema, 'API reexport uses the exact public runtime, not a same-named copy');
  assert.equal(original.aiCatalogReadProjectionSchema, shared.aiCatalogReadProjectionSchema, 'output reexport shares the producer runtime');
  const valid = { limit: 100, cursor: 'group-0', itemGroupId: 'group-1', name: '  Camera  ' };
  assert.deepEqual(consumer.parseOriginalCatalog(valid), { ...valid, name: 'Camera' });
  assert.equal(valid.name, '  Camera  ', 'normalization does not rewrite caller input');
  assert.equal(consumer.parseOriginalCatalog({ limit: 51 }).limit, 51, 'original API cap remains 100, MCP authority independently caps 50');
  for (const invalid of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: 1, cursor: 'group/1' },
    { limit: 1, itemGroupId: '' }, { limit: 1, name: '  ' }, { limit: 1, name: 'x'.repeat(192) },
    { limit: 1, goalId: 'claimed-goal', human: true }]) assert.throws(() => consumer.parseOriginalCatalog(invalid));
  const f = fixture();
  const result = await f.run(async current => {
    const authority = { withRead: (kind, input, read) => {
      assert.equal(kind, 'catalog'); assert.deepEqual(input, { limit: 2, name: 'Camera' });
      return read({ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'original-catalog-request',
        authorizedAt: new Date().toISOString(), audience: current.audience, actor: { kind: 'user', userId: current.userId },
        scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId },
        access: { permissions: current.permissions, dataScope: current.dataScope, locationScope: current.locationScope, organizationId: current.organizationId } });
    } };
    const core = { async listItemGroupsPage(tenantId, input) {
      f.coreReads++; assert.equal(tenantId, 'tenant-a'); assert.equal(identity.requireRequestWorkspaceId(), 'workspace-a');
      assert.deepEqual(input, { limit: 2, name: 'Camera' });
      return { rows: [{ id: 'group-1', tenantId, code: 'camera-1', name: 'Camera', categoryCode: 'camera', status: 'enabled', unit: 'day', attributes: { privateCost: 99 } }],
        truncated: false, nextCursor: null, configurationVersion: 'a'.repeat(64), source: 'persisted_workspace_configuration' };
    } };
    return new AiCatalogReadFactsService(core, authority, () => new Date('2026-11-06T00:00:00Z')).read({ limit: 2, name: '  Camera  ' });
  });
  assert.equal(consumer.retainOriginalProjection(result), result);
  assert.deepEqual(result, { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'original-catalog-request',
    audience: 'operator', scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, observedAt: '2026-11-06T00:00:00.000Z',
    items: [{ id: 'group-1', code: 'camera-1', name: 'Camera', categoryCode: 'camera', status: 'enabled', unit: 'day' }],
    truncated: false, nextCursor: null, configurationVersion: 'a'.repeat(64), source: 'persisted_workspace_configuration' });
  assert.deepEqual(consumer.parseOriginalProjection(result), result);
  assert.equal(consumer.parseOriginalProjection({ ...result, requestId: 'original-correlation-'.repeat(20) }).requestId.length, 420,
    'requestId keeps the original string contract; transport/release bounds are not added to the internal projection');
  assert.deepEqual(consumer.parseOriginalProjection({ ...result, observedAt: new Date(8640000000000000).toISOString() }).items, result.items,
    'canonical extended ISO dates supported by the original finite clock stay valid');
  const hundred = Array.from({ length: 100 }, (_, i) => ({ ...result.items[0], id: 'group-' + String(i).padStart(3, '0'), code: 'code-' + i }));
  assert.equal(consumer.parseOriginalProjection({ ...result, items: hundred }).items.length, 100, 'original output bound is not the MCP 50-row authority');
  assert.deepEqual(consumer.parseOriginalProjection({ ...result, truncated: true, nextCursor: 'group-1' }), { ...result, truncated: true, nextCursor: 'group-1' });
  for (const invalid of [
    { ...result, access: { permissions: ['*'] } }, { ...result, scope: { ...result.scope, actor: 'claimed-owner' } },
    { ...result, items: [{ ...result.items[0], tenantId: 'tenant-a' }] }, { ...result, items: [...hundred, { ...hundred[0], id: 'group-z', code: 'code-z' }] },
    { ...result, items: [result.items[0], result.items[0]] },
    { ...result, items: [result.items[0], { ...result.items[0], id: 'group-2' }] },
    { ...result, items: [{ ...result.items[0], id: 'group-2', code: 'camera-2' }, result.items[0]] },
    { ...result, truncated: true, nextCursor: null }, { ...result, truncated: true, nextCursor: 'different-last-row' },
    { ...result, truncated: true, items: [], nextCursor: 'group-1' }, { ...result, nextCursor: 'group-1' },
    { ...result, source: 'current_configuration_fallback' }, { ...result, configurationVersion: 'unknown' },
    { ...result, observedAt: 'not-an-observation' }, { ...result, audience: 'customer' },
  ]) assert.throws(() => consumer.parseOriginalProjection(invalid));
  assert.equal(f.coreReads, 1); assert.equal(identity.getRequestIdentity(), undefined);
  await assert.rejects(() => f.guard.withTrustedCatalogRead(51, async () => {}, async () => {}, signal()));
  const invalidScope = fixture();
  await assert.rejects(() => invalidScope.run(current => new AiCatalogReadFactsService({ async listItemGroupsPage() {
    invalidScope.coreReads++; return { rows: [], truncated: false, nextCursor: null, configurationVersion: 'a'.repeat(64), source: 'persisted_workspace_configuration' };
  } }, { withRead: (_kind, _input, read) => read({ contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'invalid-output-scope',
    authorizedAt: new Date().toISOString(), audience: current.audience, actor: { kind: 'user', userId: current.userId },
    scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId, unprojectedMetadata: 'private-marker' },
    access: { permissions: current.permissions, dataScope: current.dataScope, locationScope: current.locationScope, organizationId: current.organizationId } })
  }).read({ limit: 1 })), error => error.code === 'INVALID_RESPONSE' && !error.message.includes('private-marker'));
  assert.equal(invalidScope.coreReads, 1, 'the actual API producer validates its final projection before returning');
});

test("native original request participant preserves owner, policy, row fence and outer commit", async () => {
  const { PrismaOriginalRequestRepository } = source('apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts');
  const { originalIdentityHash } = source('apps/api/src/modules/ai-native/task-request/original-request.authority.ts');
  const { requestFingerprint } = source('apps/api/src/modules/rental-core/rental-idempotency.repository.ts');
  const f = fixture(), now = new Date();
  await f.run(async current => {
    const context = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'original-native-request', authorizedAt: now.toISOString(),
      audience: current.audience, actor: { kind: 'user', userId: current.userId }, scope: { kind: 'workspace', tenantId: current.tenantId, workspaceId: current.workspaceId },
      access: { permissions: current.permissions, dataScope: current.dataScope, locationScope: current.locationScope, organizationId: current.organizationId } };
    const row = { id: '00000000-0000-4000-8000-000000000001', scopeId: 'scope-a', audience: 'OPERATOR', ownerKind: 'USER', ownerId: 'user-a',
      contractVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
      requestKey: 'original-native-key', previousRequestId: null, payload: { candidate: { customerType: 'personal' } },
      policyRevision: 1, policyHash: 'c'.repeat(64), authorizationBindingHash: originalIdentityHash(context),
      expiresAt: new Date(now.getTime() + 60000), createdAt: now, status: 'STORED', erasedAt: null, creationClosedAt: null, creationCloseKey: null };
    row.contentHash = requestFingerprint({ version: row.contractVersion, scopeId: row.scopeId, audience: row.audience, ownerKind: row.ownerKind,
      ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, revision: row.revision, previousInputRef: null, input: row.payload });
    const ref = { draftVersion: row.contractVersion, inputRef: row.id }, trace = [], control = { revoked: false, policy: row.policyHash,
      expired: false, cancelAtLock: undefined, loseReply: false, currentCalls: 0, callbacks: 0 };
    let persisted = structuredClone(row), metadata = [], lastNative, transactions = 0;
    const authority = {
      async current() { control.currentCalls++; if (control.revoked) throw Error('original authority unavailable'); return { scopeId: 'scope-a', context: structuredClone(context) }; },
      async create(body) { assert.equal(body.sceneCode, 'quote_clarification'); return { ...await this.current(), sceneVersion: '1', policyRevision: 1, policyHash: control.policy, expiresAt: row.expiresAt.toISOString() }; },
      async read() { throw Error('creation observer must use original current creation-policy checks'); },
    }; // explicit original policy/resource facade; not production goal authorization
    const forbidden = () => { throw Error('global/task access escaped native participant'); };
    const database = { aiScope: { findFirst: forbidden }, aiTask: { findFirst: forbidden }, aiTaskOriginalRequest: { findFirst: forbidden },
      async $transaction(callback) {
        transactions++; let active = true, working = structuredClone(persisted), added = [];
        const live = () => { if (!active) throw Error('closed native transaction'); };
        const native = lastNative = { aiTaskOriginalRequest: { async findFirst(args) {
          live(); trace.push('native-row'); assert.deepEqual(args.where, { scopeId: 'scope-a', audience: 'OPERATOR', ownerKind: 'USER', ownerId: 'user-a', id: row.id });
          return working && structuredClone(working);
        } }, async $queryRaw(query) {
          live(); trace.push('native-lock'); assert.match(query.strings.join('?'), /FROM ai_task_original_requests WHERE scopeId = \? AND id = \? FOR UPDATE$/);
          assert.deepEqual(query.values, ['scope-a', row.id]); control.cancelAtLock?.abort(); return [{ id: row.id }];
        }, writeMetadata(value) { live(); added.push(structuredClone(value)); }, changeRow(value) { live(); Object.assign(working, value); } };
        try {
          const result = await callback(native); persisted = working; metadata.push(...added);
          if (control.loseReply) throw Error('explicit outer unknown commit'); return result;
        } finally { active = false; }
      } };
    const repository = new PrismaOriginalRequestRepository(database, authority, () => control.expired ? new Date(row.expiresAt.getTime() + 1) : now);
    const run = (consume, sig = signal()) => database.$transaction(native => repository.withCurrentInputIn(native, ref, consume, sig));
    const result = await run(async original => {
      control.callbacks++; assert.deepEqual(trace, ['native-lock', 'native-row']); assert.ok(Object.isFrozen(original) && Object.isFrozen(original.request.input.candidate));
      assert.equal(original.receipt.contentHash, row.contentHash); assert.equal(original.policyHash, row.policyHash); assert.equal(original.scopeId, 'scope-a');
      assert.equal(Object.hasOwn(original, 'creationAllowed'), false); assert.equal(Object.hasOwn(original, 'native'), false);
      assert.throws(() => { original.request.input.candidate.customerType = 'corporate'; });
      lastNative.writeMetadata({ inputRef: original.receipt.inputRef }); return 'participant-returned';
    });
    assert.equal(result, 'participant-returned'); assert.equal(transactions, 1, 'no nested transaction'); assert.equal(metadata.length, 1);
    assert.deepEqual(trace, ['native-lock', 'native-row', 'native-row']); assert.deepEqual(persisted, row);
    await assert.rejects(() => repository.withCurrentInputIn(lastNative, ref, async () => { control.callbacks++; }, signal()));
    assert.equal(control.callbacks, 1, 'escaped native client cannot publish');
    const count = metadata.length;
    await assert.rejects(() => run(async () => { lastNative.writeMetadata({ failed: true }); throw Error('participant failed'); })); assert.equal(metadata.length, count);
    await assert.rejects(() => run(async () => { lastNative.writeMetadata({ changed: true }); lastNative.changeRow({ policyHash: 'd'.repeat(64) }); }));
    assert.equal(metadata.length, count); assert.deepEqual(persisted, row);
    await assert.rejects(() => run(async () => { lastNative.writeMetadata({ revoked: true }); control.revoked = true; }));
    assert.equal(metadata.length, count); control.revoked = false;
    control.policy = 'd'.repeat(64); await assert.rejects(() => run(async () => { control.callbacks++; })); control.policy = row.policyHash;
    control.expired = true; await assert.rejects(() => run(async () => { control.callbacks++; })); control.expired = false;
    const beforeCallbacks = control.callbacks;
    for (const patch of [{ ownerId: 'other-user' }, { workspaceId: 'invalid-extra' }, { authorizationBindingHash: 'd'.repeat(64) },
      { creationClosedAt: now, creationCloseKey: 'closed-original-key' }, { erasedAt: now }, { status: 'REVOKED' }]) {
      // workspaceId is not an original-request column; test a changed canonical scope instead.
      const actual = patch.workspaceId ? { scopeId: 'other-scope' } : patch;
      persisted = { ...structuredClone(row), ...actual }; await assert.rejects(() => run(async () => { control.callbacks++; }));
    }
    persisted = structuredClone(row); assert.equal(control.callbacks, beforeCallbacks);
    const cancelled = new AbortController(); cancelled.abort(); const beforeCurrent = control.currentCalls;
    await assert.rejects(() => run(async () => { control.callbacks++; }, cancelled.signal)); assert.equal(control.currentCalls, beforeCurrent);
    const during = new AbortController(); control.cancelAtLock = during;
    await assert.rejects(() => run(async () => { control.callbacks++; }, during.signal)); control.cancelAtLock = undefined;
    assert.equal(control.callbacks, beforeCallbacks);
    control.loseReply = true; await assert.rejects(() => run(async original => { control.callbacks++; lastNative.writeMetadata({ inputRef: original.receipt.inputRef, unknown: true }); }));
    assert.equal(control.callbacks, beforeCallbacks + 1); assert.equal(metadata.length, count + 1, 'lost outer acknowledgement preserves committed metadata, never retries');
  });
});

test("same-native subscription entitlement uses original rules without a nested transaction or financial writes", async () => {
  const types = require('./fixtures/mcp/original-identity.cjs'); types.checkNativeEntitlementTypes();
  const { SubscriptionService } = source('apps/api/src/modules/subscription/subscription.service.ts');
  const { PrismaSubscriptionBudgetReader } = source('apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader.ts');
  const code = 'ai.native.use', now = new Date('2026-11-06T00:00:00Z');
  const make = () => {
    const state = { time: new Date(now), active: true, reads: [], transactions: [], afterTenant: undefined, afterCommit: undefined,
      subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), billingAnniversary: new Date('2026-01-01') },
      segments: [], grants: [], features: [{ code, name: 'AI', module: 'ai-native', categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED', externalFeeNote: 'private-price-note' }] };
    const entered = (kind, args) => { if (!state.active) throw Error('closed native fixture'); state.reads.push([kind, structuredClone(args)]); };
    const native = {
      tenant: { async findUnique(args) { entered('tenant', args); if (args.where.id !== 'tenant-a') return null;
        const row = { subscription: structuredClone(state.subscription), subscriptionSegments: structuredClone(state.segments.filter(term => term.status === 'SCHEDULED')) };
        state.afterTenant?.(); return row; } },
      subscriptionFeatureCatalog: { async findMany(args) { entered('catalog', args); return structuredClone(state.features.filter(feature => args.where.code.in.includes(feature.code))); } },
      tenantFeatureGrant: { async findMany(args) { entered('grants', args); return structuredClone(state.grants.filter(grant => grant.tenantId === args.where.tenantId && grant.revokedAt === null && grant.effectiveAt <= args.where.effectiveAt.lte)); } },
    }; // ORM/Date facade only; actual SubscriptionService computes the result.
    const outside = () => { throw Error('read escaped native or attempted a financial mutation'); };
    const db = { tenant: { findUnique: outside }, $transaction: async (consume, options) => {
      state.transactions.push(options); const value = await consume(native); state.afterCommit?.(); return value;
    } };
    const subscriptions = new SubscriptionService(db), reader = new PrismaSubscriptionBudgetReader(db, subscriptions, () => new Date(state.time));
    return { state, native, db, reader };
  };
  const h = make(), before = structuredClone(h.state.subscription);
  h.state.features.push({ ...h.state.features[0], code: 'unrelated-feature' });
  const expected = { revision: 4, entitlements: [{ code, available: true }] };
  assert.deepEqual(await h.reader.readIn('tenant-a', code, h.native, signal()), expected);
  assert.equal(h.state.transactions.length, 0); assert.deepEqual(h.state.subscription, before);
  assert.deepEqual(h.state.reads.find(([name]) => name === 'catalog')[1].where, { code: { in: [code] } });
  assert.ok(h.state.reads.every(([name]) => ['tenant', 'catalog', 'grants'].includes(name)));
  assert.equal(JSON.stringify(expected).includes('private-price-note'), false);
  assert.deepEqual(await h.reader.read('tenant-a', code), expected);
  assert.deepEqual(h.state.transactions, [{ isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 }], 'preserve frozen legacy transaction behavior');
  h.state.subscription.revision++; assert.equal((await h.reader.readIn('tenant-a', code, h.native, signal())).revision, 5, 'no cached entitlement');
  const pilot = make(); pilot.state.features[0].releaseStatus = 'PILOT';
  assert.equal((await pilot.reader.readIn('tenant-a', code, pilot.native, signal())).entitlements[0].available, false);
  pilot.state.grants.push({ tenantId: 'tenant-b', featureCode: code, effectiveAt: now, revokedAt: null });
  assert.equal((await pilot.reader.readIn('tenant-a', code, pilot.native, signal())).entitlements[0].available, false);
  pilot.state.grants.push({ tenantId: 'tenant-a', featureCode: code, effectiveAt: now, revokedAt: null });
  assert.equal((await pilot.reader.readIn('tenant-a', code, pilot.native, signal())).entitlements[0].available, true);
  pilot.state.grants[1].revokedAt = now;
  assert.equal((await pilot.reader.readIn('tenant-a', code, pilot.native, signal())).entitlements[0].available, false);
  for (const kind of ['missing', 'planned', 'expired', 'pending', 'category', 'closed']) {
    const value = make();
    if (kind === 'missing') value.state.features = [];
    if (kind === 'planned') value.state.features[0].releaseStatus = 'PLANNED';
    if (kind === 'expired') value.state.subscription.endAt = now;
    if (kind === 'pending') value.state.subscription.startAt = new Date(now.getTime() + 1000);
    if (kind === 'category') value.state.features[0].categories = ['camera'];
    if (kind === 'closed') value.state.active = false;
    if (['planned', 'expired', 'pending'].includes(kind)) assert.equal((await value.reader.readIn('tenant-a', code, value.native, signal())).entitlements[0].available, false);
    else await assert.rejects(() => value.reader.readIn('tenant-a', code, value.native, signal()));
    assert.equal(value.state.transactions.length, 0);
  }
  const cancelled = make(), start = new AbortController(); start.abort();
  await assert.rejects(() => cancelled.reader.readIn('tenant-a', code, cancelled.native, start.signal)); assert.equal(cancelled.state.reads.length, 0);
  await assert.rejects(() => cancelled.reader.readIn('tenant-a', code, cancelled.db, signal())); assert.equal(cancelled.state.reads.length, 0, 'global client rejected');
  await assert.rejects(() => cancelled.reader.readIn('tenant/a', code, cancelled.native, signal()), error => error.code === 'INVALID');
  const during = new AbortController(); cancelled.state.afterTenant = () => during.abort();
  await assert.rejects(() => cancelled.reader.readIn('tenant-a', code, cancelled.native, during.signal));
  assert.equal(cancelled.state.reads.filter(([name]) => name === 'tenant').length, 1, 'cancelled supplier snapshot cannot reach the second tenant observation');
  const boundary = make(); boundary.state.subscription.endAt = new Date(now.getTime() + 1000);
  boundary.state.afterCommit = () => { boundary.state.time = new Date(now.getTime() + 1000); };
  await assert.rejects(() => boundary.reader.read('tenant-a', code), error => error.code === 'UNAVAILABLE', 'legacy still checks after transaction completion');
  const nativeBoundary = make(); nativeBoundary.state.segments.push({ status: 'SCHEDULED', startAt: new Date(now.getTime() + 1000), endAt: new Date('2028-01-01') });
  nativeBoundary.state.afterTenant = () => { nativeBoundary.state.time = new Date(now.getTime() + 1000); };
  await assert.rejects(() => nativeBoundary.reader.readIn('tenant-a', code, nativeBoundary.native, signal()), error => error.code === 'UNAVAILABLE');
});

test("same-native original request scope uses actual Guard context and canonical scope without Web credentials", async () => {
  const types = require('./fixtures/mcp/original-identity.cjs'); types.checkNativeRequestScopeTypes();
  const { createOriginalMcpRequestScopeSource } = source('apps/api/src/modules/auth/original-mcp-request-scope.ts');
  const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
  const { aiPersistenceScopeColumns } = source('apps/api/src/modules/ai-native/persistence-scope.ts');
  const authorization = { subject: 'issuer-subject-not-user-id', token: 'private-scope-test-token', clientId: 'client-a', scopes: ['catalog:read'], resource: 'https://mcp.example.invalid/mcp' };
  const newCall = () => ({ callId: 'scope-original-call', authorization: structuredClone(authorization), toolName: 'catalog', inputHash: 'b'.repeat(64) });
  const make = () => {
    const f = fixture(), context = createOriginalMcpCatalogReadContext(), clock = () => new Date('2026-11-06T00:00:00Z');
    const control = { reads: [], afterRow: undefined, alterSubject: false, row: { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) } };
    const wrapper = { ...context, current(call) { const subject = context.current(call); return control.alterSubject ? { ...subject, grantRevision: subject.grantRevision + 1 } : subject; } };
    const reader = createOriginalMcpRequestScopeSource(wrapper, clock);
    wrapper.current = () => { throw Error('late method replacement must not run'); };
    const native = { aiScope: { async findFirst(query) { control.reads.push(structuredClone(query)); await control.afterRow?.(); return structuredClone(control.row); } } };
    const run = (consume, call = newCall(), abort = signal()) => f.run(current => context.bind(call.authorization, call.toolName, call.inputHash)(
      { grantId: 'grant-a', grantRevision: 1 }, current, abort, () => consume(call, native, abort)), abort);
    return { f, context, control, reader, native, run };
  };
  const h = make();
  const result = await h.run((call, native, abort) => h.reader.currentIn(call, native, abort));
  assert.equal(result.scopeId, 'scope-a'); assert.deepEqual(result.context.actor, { kind: 'user', userId: 'user-a' });
  assert.deepEqual(result.context.scope, { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' });
  assert.deepEqual(result.context.access, { permissions: ['rental-core:catalog:view'], dataScope: 'organization', locationScope: { mode: 'selected', locationIds: ['loc-a'] }, organizationId: 'org-a' });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.context) && Object.isFrozen(result.context.access.permissions));
  assert.doesNotMatch(JSON.stringify(result), /private-scope-test-token|issuer-subject-not-user-id|grantId|native|creationAllowed/);
  assert.equal(h.f.configReads, 0); assert.equal(h.f.currentReads, 4, 'scope source does not acquire/re-resolve original identity or grant');
  assert.equal(h.control.reads.length, 1);
  assert.deepEqual(h.control.reads[0], { where: aiPersistenceScopeColumns(result.context.scope), select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
  await assert.rejects(() => h.reader.currentIn(newCall(), h.native, signal())); assert.equal(h.control.reads.length, 1, 'settled callback cannot read canonical storage');
  const mutated = make(), call = newCall();
  mutated.control.afterRow = () => { call.authorization.token = 'replaced-token'; call.inputHash = 'c'.repeat(64); };
  assert.equal((await mutated.run((_call, native, abort) => mutated.reader.currentIn(call, native, abort), call)).scopeId, 'scope-a', 'call snapshot survives caller mutation, without widening authorization');
  for (const kind of ['missing', 'tenant', 'workspace', 'key', 'row-id', 'grant-change', 'cancel', 'revoked']) {
    const value = make(), abort = new AbortController();
    if (kind === 'missing') value.control.row = null;
    if (kind === 'tenant') value.control.row.tenantId = 'tenant-b';
    if (kind === 'workspace') value.control.row.workspaceId = 'workspace-b';
    if (kind === 'key') value.control.row.scopeKey = 'another-key';
    if (kind === 'row-id') value.control.row.id = 'invalid/scope';
    if (kind === 'grant-change') value.control.afterRow = () => { value.control.alterSubject = true; };
    if (kind === 'cancel') value.control.afterRow = () => abort.abort();
    if (kind === 'revoked') value.control.afterRow = () => { value.f.binding = undefined; };
    await assert.rejects(() => value.run((original, native, stop) => value.reader.currentIn(original, native, stop), newCall(), abort.signal));
    assert.equal(value.control.reads.length, 1);
  }
  const malformed = make(); let getters = 0;
  await malformed.run(async (original, native, abort) => {
    for (const bad of [{ ...original, actor: 'claimed-user' }, { ...original, authorization: { ...original.authorization, workspaceId: 'workspace-b' } },
      { ...original, get inputHash() { getters++; return original.inputHash; } }]) await assert.rejects(() => malformed.reader.currentIn(bad, native, abort));
    const scopes = [...original.authorization.scopes]; Object.defineProperty(scopes, '0', { enumerable: true, get() { getters++; return 'catalog:read'; } });
    await assert.rejects(() => malformed.reader.currentIn({ ...original, authorization: { ...original.authorization, scopes } }, native, abort));
    await assert.rejects(() => malformed.reader.currentIn({ ...original, inputHash: 'd'.repeat(64) }, native, abort));
    await assert.rejects(() => malformed.reader.currentIn(original, { ...native, $transaction() { throw Error('global client'); } }, abort));
    const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(() => malformed.reader.currentIn(original, native, cancelled.signal));
  });
  assert.equal(getters, 0); assert.equal(malformed.control.reads.length, 0);
  const beforeDispatch = make(); let rejectedBeforeDispatch;
  await beforeDispatch.run((original, native, abort) => { rejectedBeforeDispatch = assert.rejects(beforeDispatch.reader.currentIn(original, native, abort)); });
  await rejectedBeforeDispatch;
  assert.equal(beforeDispatch.control.reads.length, 0, 'callback expiry between current-context awaits cannot dispatch canonical SQL');
  const late = make(); let pending, release, entered;
  const rowEntered = new Promise(resolve => { entered = resolve; });
  late.control.afterRow = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  await late.run(async (original, native, abort) => { pending = late.reader.currentIn(original, native, abort); await rowEntered; });
  const rejected = assert.rejects(pending); release(); await rejected;
  assert.equal(late.control.reads.length, 1, 'inherited/late work loses the original callback before it returns scope metadata');
});

test("native original request policy consumes real scope and subscription algorithms without Web fallback", async () => {
  require('./fixtures/mcp/original-identity.cjs').checkNativeRequestPolicyTypes();
  const { createOriginalMcpRequestAuthority } = source('apps/api/src/modules/auth/original-mcp-request-authority.ts');
  const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
  const { AiCurrentOriginalRequestAuthority, originalIdentityHash } = source('apps/api/src/modules/ai-native/task-request/original-request.authority.ts');
  const { PrismaOriginalRequestRepository } = source('apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts');
  const { PrismaSubscriptionBudgetReader } = source('apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader.ts');
  const { SubscriptionService } = source('apps/api/src/modules/subscription/subscription.service.ts');
  const { aiPersistenceScopeColumns } = source('apps/api/src/modules/ai-native/persistence-scope.ts');
  const { requestFingerprint } = source('apps/api/src/modules/rental-core/rental-idempotency.repository.ts');
  const now = new Date('2026-11-06T00:00:00Z'), body = { sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal' } } };
  const rule = { sceneCode: body.sceneCode, sceneVersion: '1', revision: 3, audiences: ['operator'], requiredPermissions: ['rental-core:catalog:view'], maxInputAgeMs: 60000 };
  const make = () => {
    const f = fixture(), context = createOriginalMcpCatalogReadContext(), clock = () => new Date(state.time);
    const call = { callId: 'original-policy-call', toolName: 'catalog', inputHash: 'b'.repeat(64), authorization: { subject: 'issuer-not-user', token: 'private-native-policy-token', clientId: 'client-a', scopes: ['catalog:read'], resource: 'https://mcp.example.invalid/mcp' } };
    const state = { time: now, active: true, reads: [], resources: 0, afterPlan: undefined, afterResource: undefined, mismatch: false,
      scope: { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) },
      plan: { scopeId: 'scope-a', sceneCode: body.sceneCode, sceneVersion: '1', revision: 7, enabled: true, expiresAt: new Date(now.getTime() + 120000), allowedTools: ['rental.catalog.search'], limits: { active_ms: 1000 } },
      subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), billingAnniversary: new Date('2026-01-01') },
      features: [{ code: 'ai.native.use', name: 'AI', module: 'ai-native', categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED' }] };
    const enter = (kind, args) => { if (!state.active) throw Error('closed Native fixture'); state.reads.push([kind, structuredClone(args)]); };
    const native = {
      aiScope: { async findFirst(args) { enter('scope', args); return structuredClone(state.scope); } },
      aiTaskPlanPolicy: { async findFirst(args) { enter('plan', args); assert.deepEqual(args.where, { scopeId: 'scope-a', sceneCode: body.sceneCode, sceneVersion: '1' }); const row = structuredClone(state.plan); state.afterPlan?.(); return row; } },
      tenant: { async findUnique(args) { enter('tenant', args); return args.where.id === 'tenant-a' ? { subscription: structuredClone(state.subscription), subscriptionSegments: [] } : null; } },
      subscriptionFeatureCatalog: { async findMany(args) { enter('features', args); return structuredClone(state.features.filter(row => args.where.code.in.includes(row.code))); } },
      tenantFeatureGrant: { async findMany(args) { enter('grants', args); return []; } },
    }; // Real services run above these ORM/transaction facades. Resources below
    // are explicitly NOT a production scene/Core authorizer or original locator.
    const outside = () => { throw Error('Web/global/nested-transaction fallback attempted'); };
    const db = { $transaction: outside, aiScope: { findFirst: outside }, aiTask: { findFirst: outside }, aiTaskOriginalRequest: { findFirst: outside } };
    const entitlements = new PrismaSubscriptionBudgetReader(db, new SubscriptionService(db), clock);
    const input = { creationRules: [structuredClone(rule)], entitlements, async authorizeResourcesIn(value, tx, abort) {
      assert.equal(tx, native); assert.ok(!abort.aborted && Object.isFrozen(value.input.candidate)); assert.deepEqual(value, body);
      state.resources++; const valueContext = await createOriginalMcpRequestScopeSource(context, clock).currentIn(call, tx, abort);
      await state.afterResource?.(); return state.mismatch ? { ...valueContext.context, actor: { kind: 'user', userId: 'other-user' } } : valueContext.context;
    } };
    const run = (consume, stop = signal()) => f.run(identity => context.bind(call.authorization, call.toolName, call.inputHash)(
      { grantId: 'grant-a', grantRevision: 1 }, identity, stop, () => consume(createOriginalMcpRequestAuthority(context, call, input, clock), stop)), stop);
    return { f, context, state, native, db, call, input, run, clock, outside };
  };
  // Source import kept within this group: only the actual canonical implementation.
  const { createOriginalMcpRequestScopeSource } = source('apps/api/src/modules/auth/original-mcp-request-scope.ts');
  const h = make(); let bound, expected;
  await h.run(async (authority, stop) => {
    bound = authority.bindIn(h.native, stop);
    expected = await bound.create(body);
    assert.equal(expected.policyHash, requestFingerprint({ rule, plan: { revision: 7, expiresAt: h.state.plan.expiresAt.toISOString(), allowedTools: h.state.plan.allowedTools, limits: h.state.plan.limits }, entitlement: { revision: 4, entitlements: [{ code: 'ai.native.use', available: true }] } }));
    assert.equal(expected.expiresAt, new Date(now.getTime() + rule.maxInputAgeMs).toISOString());
    assert.deepEqual(expected.context.actor, { kind: 'user', userId: 'user-a' }); assert.ok(Object.isFrozen(expected.context.access.permissions));
    assert.doesNotMatch(JSON.stringify(expected), /private-native-policy-token|issuer-not-user|grantId|native/);
    assert.equal(h.state.resources, 2); assert.equal(h.state.reads.filter(([name]) => name === 'plan').length, 2);
    // The legacy public class uses exactly the same rule/hash/resource algorithm.
    // Current identity is explicitly overridden here, not a real Web token proof.
    const legacyDb = { ...h.db, aiTaskPlanPolicy: h.native.aiTaskPlanPolicy, $transaction: async (consume, options) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 }); return consume(h.native);
    } };
    const legacy = new AiCurrentOriginalRequestAuthority(legacyDb, { auth: { resolveAccessContext: h.outside }, credentials: { current: h.outside }, subscriptions: new SubscriptionService(h.db), creationRules: [rule], authorizeResources: async () => (await bound.current()).context }, h.clock);
    legacy.current = () => bound.current();
    assert.deepEqual(await legacy.create(body), expected);
    const before = h.state.reads.length;
    assert.throws(() => authority.bindIn({ ...h.native, $transaction: h.outside }, stop));
    assert.throws(() => createOriginalMcpRequestAuthority(h.context, h.call, { ...h.input, authorizeResourcesIn: undefined }, h.clock));
    assert.equal(h.state.reads.length, before, 'missing Native resource producer cannot query or fall back');
  });
  assert.equal(h.f.configReads, 0); assert.equal(h.f.currentReads, 4, 'no re-lock or second current-grant resolver');
  const stoppedReads = h.state.reads.length;
  await assert.rejects(() => bound.create(body)); assert.equal(h.state.reads.length, stoppedReads, 'callback expiry prevents policy SQL');
  for (const kind of ['disabled', 'wrong-plan', 'expired-plan', 'no-feature', 'forbidden-resource', 'mismatch', 'plan-change', 'entitlement-change', 'resource-deadline', 'cancel']) {
    const value = make(), abort = new AbortController();
    if (kind === 'disabled') value.state.plan.enabled = false;
    if (kind === 'wrong-plan') value.state.plan.scopeId = 'other-scope';
    if (kind === 'expired-plan') value.state.plan.expiresAt = now;
    if (kind === 'no-feature') value.state.features = [];
    if (kind === 'forbidden-resource') value.input.authorizeResourcesIn = async () => { value.state.resources++; const error = Error('private original resource detail'); error.code = 'FORBIDDEN'; throw error; };
    if (kind === 'mismatch') value.state.mismatch = true;
    if (kind === 'plan-change') value.state.afterResource = () => { if (value.state.resources === 1) value.state.plan.revision++; };
    if (kind === 'entitlement-change') value.state.afterResource = () => { if (value.state.resources === 1) value.state.subscription.revision++; };
    if (kind === 'resource-deadline') value.state.afterResource = () => { if (value.state.resources === 2) value.state.time = new Date(now.getTime() + 120000); };
    if (kind === 'cancel') value.state.afterPlan = () => abort.abort();
    await assert.rejects(() => value.run((source, stop) => source.bindIn(value.native, stop).create(body), abort.signal));
    if (['disabled', 'wrong-plan', 'expired-plan', 'no-feature', 'cancel'].includes(kind)) assert.equal(value.state.resources, 0, 'entry denial precedes resource collection');
    if (kind === 'cancel') assert.equal(value.state.reads.filter(([name]) => name === 'tenant').length, 0);
  }
  const participant = make(), metadata = []; let row, authorityForRow;
  await participant.run(async (authority, stop) => {
    authorityForRow = authority;
    const access = await authority.bindIn(participant.native, stop).create(body);
    row = { id: '00000000-0000-4000-8000-000000000001', scopeId: access.scopeId, audience: 'OPERATOR', ownerKind: 'USER', ownerId: 'user-a', contractVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION,
      sceneCode: body.sceneCode, sceneVersion: access.sceneVersion, revision: 1, requestKey: 'original-policy-key', previousRequestId: null, payload: body.input,
      policyRevision: access.policyRevision, policyHash: access.policyHash, authorizationBindingHash: originalIdentityHash(access.context), expiresAt: new Date(access.expiresAt), createdAt: now, status: 'STORED', erasedAt: null, creationClosedAt: null, creationCloseKey: null };
    row.contentHash = requestFingerprint({ version: row.contractVersion, scopeId: row.scopeId, audience: row.audience, ownerKind: row.ownerKind, ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, revision: row.revision, previousInputRef: null, input: row.payload });
    const ref = { draftVersion: row.contractVersion, inputRef: row.id }, trace = [];
    participant.native.$queryRaw = async query => { trace.push('lock'); assert.deepEqual(query.values, ['scope-a', row.id]); return [{ id: row.id }]; };
    participant.native.aiTaskOriginalRequest = { async findFirst() { trace.push('row'); return structuredClone(row); } };
    const repository = new PrismaOriginalRequestRepository(participant.db, { current: participant.outside, read: participant.outside, create: participant.outside }, participant.clock);
    const transact = async consume => { const draft = []; const value = await repository.withCurrentInputIn(participant.native, ref, async original => consume(original, draft), stop, authority); metadata.push(...draft); return value; };
    assert.equal(await transact(async (original, draft) => { draft.push(original.receipt.inputRef); return 'observed'; }), 'observed');
    assert.deepEqual(trace, ['lock', 'row', 'row']); assert.deepEqual(metadata, [row.id]);
    const savedPlan = participant.state.plan.revision;
    await assert.rejects(() => transact(async (_original, draft) => { draft.push('must-roll-back'); participant.state.plan.revision++; }));
    assert.deepEqual(metadata, [row.id]); participant.state.plan.revision = savedPlan;
    const before = trace.length;
    await assert.rejects(() => repository.withCurrentInputIn(participant.native, ref, async () => {}, stop, { bindIn: () => undefined }));
    assert.equal(trace.length, before, 'invalid Native producer cannot fall back to legacy authority');
    participant.state.refs = { repository, ref, trace, stop };
  });
  const { repository, ref, trace, stop } = participant.state.refs, traceCount = trace.length;
  await assert.rejects(() => repository.withCurrentInputIn(participant.native, ref, async () => {}, stop, authorityForRow)); assert.equal(trace.length, traceCount);
  const late = make(); let pending, enter, release;
  const resourceEntered = new Promise(resolve => { enter = resolve; });
  late.state.afterResource = () => { enter(); return new Promise(resolve => { release = resolve; }); };
  await late.run(async (authority, stop) => { pending = authority.bindIn(late.native, stop).create(body); await resourceEntered; });
  const rejected = assert.rejects(pending), beforeLate = late.state.reads.length; release(); await rejected;
  assert.equal(late.state.reads.length, beforeLate, 'settled callback cannot continue to a second plan observation');
});

function nativeAvailabilityFixture(mode = 'quantity', lines) {
  const f = fixture(), now = new Date('2026-11-06T00:00:00Z');
  f.member.role.permissions = [{ permission:{ code:'rental-os:order:create' } }];
  const input = { locationId:'loc-a',startAt:'2026-11-07T00:00:00+08:00',endAt:'2026-11-08T00:00:00+08:00',lines:lines ?? [{ itemGroupId:'group-a',quantity:1 }] };
  const mcp = { ...source('packages/mcp-server/src/capability-mapping.ts'), ...source('packages/mcp-server/src/persistent-read-accounting.ts') };
  const name = mcp.MCP_BUSINESS_CAPABILITIES.find(row=>row.code==='rental.availability.check').name;
  const authorization = { subject:'issuer-not-user',token:'private-native-availability-token',clientId:'client-a',scopes:['availability:read'],resource:'https://mcp.example.invalid/mcp' };
  const call = { callId:'original-availability-call',authorization,toolName:name,inputHash:mcp.captureMcpReadInput(input).inputHash };
  const context = source('apps/api/src/modules/auth/original-mcp-read-context.ts').createOriginalMcpCatalogReadContext();
  const group = (id,inventoryMode) => ({ id,tenantId:'tenant-a',workspaceId:'workspace-a',categoryCode:'CAMERA',code:id,name:'Original '+id,
    inventoryMode:inventoryMode.toUpperCase(),unit:'day',status:'enabled',description:'private original description',attributes:{ privateCost:99 },bundleComponents:[],createdAt:now,updatedAt:now });
  const scope = { tenantId:'tenant-a',workspaceId:'workspace-a',locationId:'loc-a',itemGroupId:'group-a' };
  const control = { trace:[],afterScope:undefined,afterSql:undefined,afterInventory:undefined,groups:[group('group-a',mode)],
    location:{ id:'loc-a',tenantId:'tenant-a',workspaceId:'workspace-a',code:'LOC',name:'Original Location',status:'enabled',operatorId:'op-a',capabilities:['storage','pickup'],latitude:null,longitude:null },
    operator:{ id:'op-a',tenantId:'tenant-a',workspaceId:'workspace-a',code:'OP',name:'Original Operator',status:'enabled',type:'self_operated',createdAt:now,updatedAt:now },
    reservations:[{ ...scope,quantity:2,releasedQuantity:1,status:'CONFIRMED',expiresAt:null,startAt:new Date(input.startAt),endAt:new Date(input.endAt),order:{ tenantId:'tenant-a',workspaceId:'workspace-a',ruleSnapshot:{ fulfillment:{ pickupBufferMinutes:30,returnBufferMinutes:60 } } } }],
    assets:['a','b','c'].map(id=>({ ...scope,id:'asset-'+id,status:'AVAILABLE',privateAttributes:'not projected' })),
    stocks:[{ ...scope,onHandQuantity:7,maintenanceQuantity:2 }],workOrders:[{ ...scope,assetId:'asset-a',locationId:'old-location' }] };
  const workspace = f.tx.businessWorkspace.findFirst.bind(f.tx.businessWorkspace);
  f.tx.businessWorkspace.findFirst = async args => { const row=await workspace(args); if(Object.keys(args.select ?? {}).join()==='id') { control.trace.push('scope');await control.afterScope?.(); } return row; };
  f.tx.aiScope = { findFirst:async()=>({ id:'scope-a',...source('apps/api/src/modules/ai-native/persistence-scope.ts').aiPersistenceScopeColumns({ kind:'workspace',tenantId:'tenant-a',workspaceId:'workspace-a' }) }) };
  f.tx.$queryRaw = async query => {
    const sql=query.strings.join('?'),kind=sql.includes('business_workspaces')?'workspace':sql.includes('rental_fulfillment_locations')?'location':'operator';
    assert.match(sql,/FOR UPDATE/);assert.deepEqual(query.values.slice(0,2),['tenant-a','workspace-a']);control.trace.push('sql-'+kind);await control.afterSql?.(kind);
    return structuredClone(kind==='workspace'?[{ status:f.workspace.status }]:kind==='location'?[control.location]:[control.operator]);
  };
  f.tx.rentalItemGroup = { findMany:async args=>{ control.trace.push('config');assert.equal(args.take,2);assert.equal(args.where.tenantId,'tenant-a');assert.equal(args.where.workspaceId,'workspace-a');return structuredClone(control.groups.filter(row=>row.id===args.where.id)); } };
  for(const [delegate,kind] of [['rentalReservation','reservations'],['rentalAsset','assets'],['rentalStockBalance','stocks'],['rentalWorkOrder','workOrders']]) f.tx[delegate] = { findMany:async args=>{
    control.trace.push(kind);assert.equal(args.take,10001);assert.equal(args.where.tenantId,'tenant-a');assert.equal(args.where.workspaceId,'workspace-a');
    if(kind!=='workOrders') { assert.equal(args.where.locationId,'loc-a');assert.ok(args.where.itemGroupId.in.includes('group-a')); }
    else { assert.equal(args.where.locationId,undefined);assert.equal(args.where.itemGroupId,undefined);assert.deepEqual(args.where.assetId.in,control.assets.map(row=>row.id)); }
    const rows=structuredClone(control[kind]);await control.afterInventory?.(kind);return rows;
  } };
  const forbidden=()=>{ throw Error('availability escaped into global SQL, initialization or legacy computation'); };
  const core=Object.create(source('apps/api/src/modules/rental-core/rental-core.service.ts').RentalCoreService.prototype);
  core.configStore=new (source('apps/api/src/modules/rental-core/rental-core-config.repository.ts').RentalCoreConfigRepository)({ businessWorkspace:{ findFirst:forbidden },$transaction:forbidden,rentalItemGroup:{ findMany:forbidden } });
  core.factStore=new (source('apps/api/src/modules/rental-core/rental-core-fact.repository.ts').RentalCoreFactRepository)({ businessWorkspace:{ findFirst:forbidden },rentalReservation:{ findMany:forbidden },rentalAsset:{ findMany:forbidden },rentalStockBalance:{ findMany:forbidden },rentalWorkOrder:{ findMany:forbidden } });
  core.state=forbidden;core.factContext=forbidden;core.availability=forbidden;
  const factory=source('apps/api/src/modules/auth/original-mcp-availability-resources.ts').createOriginalMcpAvailabilityResources;
  const run=(consume,stop=signal(),withOwner=true)=>f.auth.withTrustedWorkspacePrincipal(f.tx,f.current,stop,resolve=>f.guard.withTrustedAvailabilityRead(input.locationId,input.lines.length,resolve,
    current=>context.bind(authorization,name,call.inputHash)({ grantId:'grant-a',grantRevision:1 },current,stop,()=>consume(factory(mcp,context,call,f.auth,f.guard,core,()=>now),stop),withOwner?f.tx:undefined),stop));
  const read=()=>run((resource,stop)=>resource.read(input,stop));
  return { f,control,input,core,run,read,call,context,factory,mcp };
}

test('native availability resources retain original POST rights and same Native Core inventory facts', async()=>{
  for(const mode of ['serialized','quantity','consumable']) {
    const h=nativeAvailabilityFixture(mode),before=structuredClone(h.control),result=await h.read();
    assert.equal(result.audience,'operator');assert.equal(result.requestId,h.call.callId);assert.equal(result.observedAt,'2026-11-06T00:00:00.000Z');
    assert.equal(result.result.lines[0].availableQuantity,mode==='serialized'?2:4);assert.equal(result.result.startAt,h.input.startAt);assert.equal(result.result.endAt,h.input.endAt);
    assert.doesNotMatch(JSON.stringify(result),/privateCost|private original description|private-native-availability-token|asset-a/);
    assert.ok(h.control.trace.includes('sql-workspace'));assert.ok(h.control.trace.includes('sql-location'));assert.ok(h.control.trace.includes('sql-operator'));
    for(const key of ['groups','location','operator','reservations','assets','stocks','workOrders'])assert.deepEqual(h.control[key],before[key]);
    await h.run(async(resource,stop)=>assert.deepEqual((await resource.readIn(h.f.tx,h.input,stop)).result,result.result));
    await h.run(async()=>{
      const legacy=Object.create(Object.getPrototypeOf(h.core));
      legacy.configStore=new (source('apps/api/src/modules/rental-core/rental-core-config.repository.ts').RentalCoreConfigRepository)({ ...h.f.tx,$transaction:async read=>read(h.f.tx) });
      legacy.factStore=new (source('apps/api/src/modules/rental-core/rental-core-fact.repository.ts').RentalCoreFactRepository)(h.f.tx);legacy.state=h.core.state;legacy.factContext=h.core.factContext;
      assert.deepEqual(await legacy.readAvailability('tenant-a',h.input),result.result,'legacy read retains original optional/global client behavior without initialization');
    });
  }
  const bundle=nativeAvailabilityFixture('quantity',[{ itemGroupId:'bundle-a',quantity:2 },{ itemGroupId:'group-a',quantity:1 }]);
  const base=bundle.control.groups[0],kit={ ...structuredClone(base),id:'bundle-a',code:'bundle-a',name:'Original bundle',inventoryMode:'BUNDLE',bundleComponents:[{ componentItemGroupId:'group-a',quantity:2,optional:false,componentItemGroup:{ code:base.code,name:base.name,tenantId:'tenant-a',workspaceId:'workspace-a' } }] };
  bundle.control.groups.push(kit);const combined=(await bundle.read()).result;assert.equal(combined.available,false);assert.ok(combined.lines.every(row=>row.available===false));assert.ok(combined.lines.every(row=>row.reasons.some(reason=>reason.includes('合并需求'))));
  const denied=nativeAvailabilityFixture();denied.f.member.role.permissions=[{ permission:{ code:'rental-core:catalog:view' } }];
  await assert.rejects(denied.read());assert.equal(denied.control.trace.filter(kind=>kind!=='scope').length,0,'catalog rights cannot enter availability');
  denied.f.member.role.permissions=[{ permission:{ code:'rental-os:order:view' } }];await assert.rejects(denied.read());assert.equal(denied.control.trace.filter(kind=>kind!=='scope').length,0);
  const wrongLocation=nativeAvailabilityFixture();wrongLocation.input.locationId='loc-b';await assert.rejects(wrongLocation.read());assert.equal(wrongLocation.control.trace.filter(kind=>kind!=='scope').length,0);
  const missingOwner=nativeAvailabilityFixture();await assert.rejects(missingOwner.run((resource,stop)=>resource.read(missingOwner.input,stop),signal(),false));assert.equal(missingOwner.control.trace.filter(kind=>kind!=='scope').length,0);
  const broad=nativeAvailabilityFixture();broad.input.lines=Array.from({ length:51 },()=>({ itemGroupId:'group-a',quantity:1 }));await assert.rejects(broad.read());assert.equal(broad.control.trace.filter(kind=>kind!=='scope').length,0);
});

test('native availability fences late SQL snapshot overflow own assets and original expiry/buffers',async()=>{
  const abort=new AbortController(),between=nativeAvailabilityFixture();between.control.afterSql=kind=>{ if(kind==='workspace')abort.abort(); };
  await assert.rejects(between.run((resource,stop)=>resource.read(between.input,stop),abort.signal));assert.deepEqual(between.control.trace.filter(row=>row.startsWith('sql-')),['sql-workspace']);
  const atScope=new AbortController(),scope=nativeAvailabilityFixture();scope.control.afterScope=()=>atScope.abort();
  await assert.rejects(scope.run((resource,stop)=>resource.read(scope.input,stop),atScope.signal));assert.equal(scope.control.trace.includes('config'),false);assert.equal(scope.control.trace.some(row=>row.startsWith('sql-')),false);
  const stockFailure=nativeAvailabilityFixture();stockFailure.control.afterInventory=kind=>{ if(kind==='reservations')stockFailure.f.member.isActive=false; };await assert.rejects(stockFailure.read());
  const overflow=nativeAvailabilityFixture();overflow.control.stocks=Array.from({ length:10001 },()=>structuredClone(overflow.control.stocks[0]));await assert.rejects(overflow.read(),/部分事实/);
  const alien=nativeAvailabilityFixture();alien.control.reservations[0].order.workspaceId='other-space';await assert.rejects(alien.read(),/来源变化/);
  const own=nativeAvailabilityFixture('serialized');own.f.member.dataScope='OWN';own.f.member.role.dataScope='OWN';const ownResult=(await own.read()).result;assert.equal(ownResult.lines[0].availableQuantity,0);assert.ok(own.control.trace.includes('workOrders'));
  const overdue=nativeAvailabilityFixture();overdue.control.reservations[0].status='FULFILLED';overdue.control.reservations[0].startAt=new Date('2026-11-04T00:00:00Z');overdue.control.reservations[0].endAt=new Date('2026-11-05T00:00:00Z');
  assert.equal((await overdue.read()).result.lines[0].availableQuantity,4,'overdue original occupied quantity remains counted');
  const readonly=nativeAvailabilityFixture(),late=Promise.withResolvers();let pending;
  await readonly.run(async resource=>{ pending=late.promise.then(()=>resource.read(readonly.input,signal())); });const rejected=assert.rejects(pending);late.resolve();await rejected;assert.equal(readonly.control.trace.filter(kind=>kind!=='scope').length,0);
  const malformed=nativeAvailabilityFixture();await malformed.run(async(resource,stop)=>{
    await assert.rejects(resource.read({ ...malformed.input,actor:'self-authorized' },stop));await assert.rejects(resource.readIn({ ...malformed.f.tx,$transaction:async()=>{} },malformed.input,stop));
    assert.equal(malformed.control.trace.filter(kind=>kind!=='scope').length,0);
  });
});

test("native catalog resources execute original Guard Core configuration and projection without global reads", async () => {
  require('./fixtures/mcp/original-identity.cjs').checkNativeCatalogTypes();
  const { RentalCoreService } = source('apps/api/src/modules/rental-core/rental-core.service.ts');
  const { RentalCoreConfigRepository } = source('apps/api/src/modules/rental-core/rental-core-config.repository.ts');
  const { createOriginalMcpCatalogResources } = source('apps/api/src/modules/auth/original-mcp-catalog-resources.ts');
  const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
  const { aiPersistenceScopeColumns } = source('apps/api/src/modules/ai-native/persistence-scope.ts');
  const { captureMcpReadInput } = source('packages/mcp-server/src/persistent-read-accounting.ts');
  const mcp = source('packages/mcp-server/src/capability-mapping.ts'), name = mcp.MCP_BUSINESS_CAPABILITIES.find(row => row.code === 'rental.catalog.search').name;
  const now = new Date('2026-11-06T00:00:00Z'), authorization = { subject: 'issuer-not-user', token: 'private-native-catalog-token', clientId: 'client-a', scopes: ['catalog:read'], resource: 'https://mcp.example.invalid/mcp' };
  const make = (input = { limit: 2 }) => {
    const f = fixture(), control = { queries: [], bundleQueries: [], afterScope: undefined, afterPage: undefined, rows: [] };
    const raw = id => ({ id, tenantId: 'tenant-a', workspaceId: 'workspace-a', categoryCode: 'CAMERA', code: id, name: 'Camera ' + id,
      inventoryMode: 'SERIALIZED', unit: 'day', status: 'enabled', description: 'private description', attributes: { privateCost: 99 }, bundleComponents: [], createdAt: now, updatedAt: now });
    control.rows = ['group-a','group-b','group-c'].map(raw);
    const workspaceRead = f.tx.businessWorkspace.findFirst.bind(f.tx.businessWorkspace);
    f.tx.businessWorkspace.findFirst = async args => { const row = await workspaceRead(args); if (Object.keys(args.select ?? {}).join() === 'id') await control.afterScope?.(); return row; };
    f.tx.aiScope = { async findFirst() { return { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }; } };
    f.tx.rentalItemGroup = { async findMany(args) { control.queries.push(structuredClone(args)); assert.deepEqual(args.where.tenantId, 'tenant-a'); assert.equal(args.where.workspaceId, 'workspace-a'); assert.equal(args.take, input.limit + 1);
      let rows = control.rows.filter(row => (!args.where.id || row.id === args.where.id) && (!args.where.name || row.name === args.where.name)
        && (!args.where.AND || row.id > args.where.AND[0].id.gt)).slice(0, args.take); rows = structuredClone(rows); await control.afterPage?.(); return rows; } };
    f.tx.$queryRaw = async query => {
      const values = [], flatten = part => part.strings.map((text, i) => {
        if (!i) return text; const value = part.values[i - 1];
        return (value?.strings ? flatten(value) : (values.push(value), '?')) + text;
      }).join('');
      const sql = flatten(query).replace(/\s+/g, ' ').trim();
      if (sql.startsWith('SELECT id FROM business_workspaces')) {
        assert.deepEqual(values, ['tenant-a', 'workspace-a']); assert.match(sql, /FOR UPDATE$/); return [{ id: 'workspace-a' }];
      }
      if (sql.startsWith('SELECT * FROM rental_item_groups')) {
        assert.match(sql, /WHERE tenantId = \? AND workspaceId = \?/); assert.match(sql, /ORDER BY id LIMIT \? LOCK IN SHARE MODE$/);
        assert.deepEqual(values, ['tenant-a', 'workspace-a', ...(input.itemGroupId ? [input.itemGroupId] : []), ...(input.name ? [input.name] : []), ...(input.cursor ? [input.cursor] : []), input.limit + 1]);
        control.queries.push({ sql, values });
        const rows = structuredClone(control.rows.filter(row => (!input.itemGroupId || row.id === input.itemGroupId) && (!input.name || row.name === input.name) && (!input.cursor || row.id > input.cursor)).slice(0, input.limit + 1));
        await control.afterPage?.(); return rows;
      }
      assert.match(sql, /FROM rental_bundle_components b JOIN rental_item_groups g/); assert.match(sql, /LIMIT 257 LOCK IN SHARE MODE$/); assert.equal(values.length, 1);
      control.bundleQueries.push({ sql, values });
      return (control.rows.find(row => row.id === values[0])?.bundleComponents ?? []).map(part => ({ ...part, ...part.componentItemGroup }));
    };
    const forbidden = () => { throw Error('Native catalog escaped into global configuration or state initialization'); };
    const config = new RentalCoreConfigRepository({ rentalItemGroup: { findMany: forbidden }, businessWorkspace: { findFirst: forbidden } });
    const core = Object.create(RentalCoreService.prototype); core.configStore = config; core.state = forbidden;
    const context = createOriginalMcpCatalogReadContext(), call = { callId: 'catalog-native-original-call', authorization, toolName: name, inputHash: captureMcpReadInput(input).inputHash };
    const run = (consume, stop = signal(), withOwner = true) => f.run(current => context.bind(authorization, name, call.inputHash)({ grantId: 'grant-a', grantRevision: 1 }, current, stop,
      () => consume(createOriginalMcpCatalogResources({ ...mcp, captureMcpReadInput }, context, call, f.auth, f.guard, core, () => now), stop), withOwner ? f.tx : undefined), stop);
    return { f, control, core, config, context, call, input, run };
  };
  const h = make(); let escaped;
  const before = structuredClone(h.control.rows);
  const page = await h.run((read, stop) => { escaped = read; return read.read(h.input, stop); });
  assert.deepEqual(page.items.map(row => row.id), ['group-a','group-b']); assert.equal(page.truncated, true); assert.equal(page.nextCursor, 'group-b');
  assert.equal(page.source, 'persisted_workspace_configuration'); assert.match(page.configurationVersion, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(page), /private|description|attributes|images|token|grantId/);
  for (const item of page.items) assert.deepEqual(Object.keys(item).sort(), ['categoryCode','code','id','name','status','unit'], 'original item projection is closed; tenant/space remain only in its original scope');
  assert.deepEqual(h.control.rows, before); assert.equal(h.control.queries.length, 1); assert.equal(h.control.bundleQueries.length, 2);
  assert.ok(h.control.bundleQueries.every(query => /LIMIT 257 LOCK IN SHARE MODE$/.test(query.sql)), 'original bundle reads stay bounded in the current native SQL path');
  assert.equal(h.f.configReads, 0); assert.equal(identity.getRequestIdentity(), undefined);
  await assert.rejects(() => escaped.readIn(h.f.tx, h.input, signal()));
  await assert.rejects(() => escaped.read(h.input, signal())); assert.equal(h.control.queries.length, 1);
  const legacy = make();
  await assert.rejects(() => legacy.run((read, stop) => read.read(legacy.input, stop), signal(), false)); assert.equal(legacy.control.queries.length, 0);
  const legacyPage = await legacy.run((read, stop) => read.readIn(legacy.f.tx, legacy.input, stop), signal(), false);
  assert.deepEqual(legacyPage.items, page.items, 'legacy explicit Native works but metadata alone cannot borrow owner SQL');
  const owner = make(), gate = Promise.withResolvers(); let inherited, inheritedSignal, ownerCalls = 0;
  await owner.run(async (read, stop) => {
    inherited = owner.context.withReadNative(owner.call, stop, async (native, live) => {
      assert.equal(native, owner.f.tx); ownerCalls++; inheritedSignal = live; await gate.promise; return 'not-commit-evidence';
    });
    assert.ok(!Object.hasOwn(owner.context.current(owner.call), 'native'));
  });
  assert.equal(inheritedSignal.aborted, true, 'owner callback settlement cancels unawaited Native readers, not the transaction or budget');
  const inheritedRejected = assert.rejects(inherited); gate.resolve(); await inheritedRejected; assert.equal(ownerCalls, 1);
  await owner.run(async (_read, stop) => {
    for (const call of [{ ...owner.call, inputHash: 'f'.repeat(64) }, { ...owner.call, toolName: 'wrong-tool' }, { ...owner.call, authorization: { ...owner.call.authorization, token: 'foreign-token' } }])
      await assert.rejects(() => owner.context.withReadNative(call, stop, async () => { ownerCalls++; }));
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(() => owner.context.withReadNative(owner.call, cancelled.signal, async () => { ownerCalls++; }));
  });
  assert.equal(ownerCalls, 1, 'bad bindings and cancelled readers dispatch no Native callbacks');
  const next = make({ limit: 2, cursor: 'group-b' }); const tail = await next.run((read, stop) => read.readIn(next.f.tx, next.input, stop));
  assert.deepEqual(tail.items.map(row => row.id), ['group-c']); assert.equal(tail.truncated, false); assert.equal(tail.nextCursor, null);
  const empty = make(); empty.control.rows = []; const none = await empty.run((read, stop) => read.readIn(empty.f.tx, empty.input, stop));
  assert.deepEqual(none.items, []); assert.equal(none.truncated, false);
  for (const kind of ['scope-cancel','page-cancel','foreign-row','foreign-bundle','no-permission','late-revoke','hash-mismatch','global','limit']) {
    const value = make(kind === 'limit' ? { limit: 51 } : { limit: 2 }), abort = new AbortController();
    if (kind === 'scope-cancel') value.control.afterScope = () => abort.abort();
    if (kind === 'page-cancel') value.control.afterPage = () => abort.abort();
    if (kind === 'foreign-row') value.control.rows[2].workspaceId = 'foreign-space';
    if (kind === 'foreign-bundle') value.control.rows[0].bundleComponents = [{ componentItemGroup: { tenantId: 'tenant-a', workspaceId: 'foreign-space' } }];
    if (kind === 'no-permission') value.f.member.role.permissions = [];
    if (kind === 'late-revoke') value.control.afterPage = () => { value.f.member.role.permissions = []; };
    await assert.rejects(() => value.run((read, stop) => read.readIn(kind === 'global' ? { ...value.f.tx, $transaction() {} } : value.f.tx,
      kind === 'hash-mismatch' ? { limit: 1 } : value.input, stop), abort.signal));
    assert.equal(value.control.queries.length, ['scope-cancel','no-permission','hash-mismatch','global','limit'].includes(kind) ? 0 : 1);
  }
});

test("native order status resources execute original Guard Core repository and preparation without Web reads", async () => {
  require('./fixtures/mcp/original-identity.cjs').checkNativeRequestParticipantTypes();
  const { createOriginalMcpOrderStatusResources, createOriginalMcpOrderResources } = source('apps/api/src/modules/auth/original-mcp-order-status-resources.ts');
  const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
  const { RentalCoreService } = source('apps/api/src/modules/rental-core/rental-core.service.ts');
  const { RentalCoreFactRepository } = source('apps/api/src/modules/rental-core/rental-core-fact.repository.ts');
  const { MCP_BUSINESS_CAPABILITIES } = source('packages/mcp-server/src/capability-mapping.ts');
  const { aiPersistenceScopeColumns } = source('apps/api/src/modules/ai-native/persistence-scope.ts');
  const mcp = { MCP_BUSINESS_CAPABILITIES }, mapping = MCP_BUSINESS_CAPABILITIES.find(value => value.code === 'rental.order.explain');
  const now = new Date('2026-11-06T00:00:00Z'), body = { sceneCode: 'order_explanation', input: { orderId: 'order-a', question: 'status' } };
  const make = () => {
    const f = fixture(), context = createOriginalMcpCatalogReadContext();
    f.member.role.permissions.push({ permission: { code: '*' } });
    const call = { callId: 'native-order-status-call', toolName: mapping.name, inputHash: 'b'.repeat(64), authorization: { subject: 'issuer-not-user', token: 'private-order-token', clientId: 'client-a', scopes: ['order:read'], resource: 'https://mcp.example.invalid/mcp' } };
    const state = { reads: [], active: true, denyGuard: false, absent: false, afterWorkspace: undefined, afterOrder: undefined,
      row: { id: 'order-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', orderNo: 'RO-A', status: 'RENTING', categoryCode: 'EQUIPMENT', currency: 'CNY',
        startAt: now, endAt: new Date(now.getTime()+86400000), createdAt: now, updatedAt: now, createdBy: 'user-a', customerType: 'personal', customerName: 'private customer', contactPhone: 'private-contact',
        fulfillmentLocationId: 'loc-a', fulfillmentLocationName: 'A', lines: [], reservations: [], allocations: [], assignment: { operationLock: { token: 'private-business-lock' } } } };
    for (const field of ['rentalAmount','discountAmount','couponAmount','serviceAmount','fulfillmentAmount','depositAmount','preAuthAmount','payableAmount','adjustmentAmount','finalPayableAmount','taxRate','taxAmount','totalAmount']) state.row[field] = 10;
    const native = f.tx, outside = () => { throw Error('Web/global/state-init/lock/write attempted'); };
    native.aiScope = { async findFirst() { return { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }; } };
    const originalWorkspace = native.businessWorkspace.findFirst.bind(native.businessWorkspace);
    native.businessWorkspace.findFirst = async args => { if (!state.active) throw Error('closed Native'); const value = await originalWorkspace(args); await state.afterWorkspace?.(args); return value; };
    native.rentalOrder = { async findFirst(args) {
      if (!state.active) throw Error('closed Native'); state.reads.push(structuredClone(args));
      assert.equal(args.where.tenantId, 'tenant-a'); assert.equal(args.where.workspaceId, 'workspace-a'); assert.equal(args.where.id, 'order-a');
      if (args.select) return state.denyGuard ? null : { id: 'order-a' };
      assert.deepEqual(args.where.AND, [{ OR: [{ fulfillmentLocationId: { in: ['loc-a'] } }, { returnLocationId: { in: ['loc-a'] } }] }]);
      const row = state.absent ? null : structuredClone(state.row); await state.afterOrder?.(); return row;
    } };
    const repository = new RentalCoreFactRepository({ businessWorkspace: { findFirst: outside }, rentalOrder: { findFirst: outside } });
    const core = Object.create(RentalCoreService.prototype); core.factStore = repository; core.state = outside;
    const run = (consume, abort = signal()) => f.run(identity => context.bind(call.authorization, call.toolName, call.inputHash)(
      { grantId: 'grant-a', grantRevision: 1 }, identity, abort, () => consume(createOriginalMcpOrderStatusResources(mcp, context, call, ['order:read'], f.auth, f.guard, core, () => now), abort)), abort);
    return { f, state, call, context, native, core, run, outside };
  };
  const h = make(); let escaped, escapedRepository, escapedSaveAuthority, escapedParticipant;
  const result = await h.run(async (resources, stop) => {
    escaped = resources;
    const direct = await resources.authorizeResourcesIn(body, h.native, stop);
    const { createOriginalMcpRequestAuthority } = source('apps/api/src/modules/auth/original-mcp-request-authority.ts');
    const { PrismaSubscriptionBudgetReader } = source('apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader.ts');
    const { SubscriptionService } = source('apps/api/src/modules/subscription/subscription.service.ts');
    h.native.aiTaskPlanPolicy = { async findFirst(args) { assert.deepEqual(args.where, { scopeId: 'scope-a', sceneCode: body.sceneCode, sceneVersion: '1' });
      return { ...args.where, enabled: true, revision: 1, expiresAt: new Date(now.getTime()+60000), allowedTools: ['rental.order.explain'], limits: {} }; } };
    h.native.tenant = { async findUnique(args) { assert.equal(args.where.id, 'tenant-a'); return { subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 1, plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), billingAnniversary: new Date('2026-01-01') }, subscriptionSegments: [] }; } };
    h.native.subscriptionFeatureCatalog = { async findMany() { return [{ code: 'ai.native.use', name: 'AI', module: 'ai-native', categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED' }]; } };
    h.native.tenantFeatureGrant = { async findMany() { return []; } };
    const db = { $transaction: h.outside }, entitlements = new PrismaSubscriptionBudgetReader(db, new SubscriptionService(db), () => now);
    const authority = createOriginalMcpRequestAuthority(h.context, h.call, { creationRules: [{ sceneCode: body.sceneCode, sceneVersion: '1', revision: 1, audiences: ['operator'], requiredPermissions: ['*'], maxInputAgeMs: 30000 }], entitlements,
      authorizeResourcesIn: resources.authorizeResourcesIn }, () => now);
    const observed = await authority.bindIn(h.native, stop).create(body);
    assert.equal(observed.scopeId, 'scope-a'); assert.deepEqual(observed.context, direct, 'Native policy consumes the real status resource, not an empty callback');
    const { PrismaOriginalRequestRepository, AiOriginalRequestResultUnknownError } = source('apps/api/src/modules/ai-native/task-request/prisma-original-request.repository.ts');
    const broad = createOriginalMcpOrderResources(mcp, h.context, h.call, ['order:read'], h.f.auth, h.f.guard, h.core, () => now);
    const saveAuthority = createOriginalMcpRequestAuthority(h.context, h.call, { creationRules: [{ sceneCode: body.sceneCode, sceneVersion: '1', revision: 1, audiences: ['operator'], requiredPermissions: ['*'], maxInputAgeMs: 30000 }], entitlements,
      authorizeResourcesIn: broad.authorizeResourcesIn }, () => now);
    let rows = new Map(), metadata = [], afterWrite, planRevision = 1, loseCommit = false;
    let auditRows = new Map(), failAudit = false, badAuditResponse = false, afterAuditWrite;
    const auditQueries = []; let auditInserts = 0;
    h.native.$queryRaw = async statement => { assert.match(statement.strings.join('?'), /FROM ai_task_original_requests.*FOR UPDATE/u);
      assert.equal(statement.values[0], 'scope-a'); return rows.has(statement.values[1]) ? [{ id: statement.values[1] }] : []; };
    h.native.operationLog = {
      async findUnique(args) { auditQueries.push(structuredClone(args)); assert.deepEqual(Object.keys(args.where), ['id']); return structuredClone(auditRows.get(args.where.id) ?? null); },
      async create({ data, select }) { if (failAudit) throw Error('private audit provider failure'); assert.ok(select.detail && select.tenantId && select.userId);
        if (auditRows.has(data.id)) throw Error('duplicate audit ID'); auditInserts++; const row = { ...structuredClone(data), createdAt: now };
        auditRows.set(row.id, row); await afterAuditWrite?.(row); return badAuditResponse ? { ...structuredClone(row), id: 'wrong-audit-id' } : structuredClone(row); }
    };
    const originalPlan = h.native.aiTaskPlanPolicy.findFirst.bind(h.native.aiTaskPlanPolicy);
    h.native.aiTaskPlanPolicy.findFirst = async args => ({ ...await originalPlan(args), revision: planRevision });
    const requestQueries = []; let inserts = 0, afterRequestRead;
    h.native.aiTaskOriginalRequest = {
      async findFirst(args) { requestQueries.push(structuredClone(args)); assert.equal(args.where.scopeId, 'scope-a'); assert.equal(args.where.ownerId, 'user-a');
        const result = structuredClone([...rows.values()].find(row => Object.entries(args.where).every(([key, value]) => row[key] === value)) ?? null);
        await afterRequestRead?.(); return result; },
      async create({ data }) { inserts++; const row = { ...structuredClone(data), erasedAt: null, creationClosedAt: null, creationCloseKey: null };
        rows.set(row.id, row); await afterWrite?.(row); return structuredClone(row); }
    };
    const global = { $transaction: h.outside, aiScope: { findFirst: h.outside }, aiTask: { findFirst: h.outside }, aiTaskOriginalRequest: { findFirst: h.outside, create: h.outside } };
    const repository = new PrismaOriginalRequestRepository(global, { current: h.outside, read: h.outside, create: h.outside }, () => now);
    escapedRepository = repository; escapedSaveAuthority = saveAuthority;
    const { createOriginalMcpRequestSaveAudit } = source('apps/api/src/modules/auth/original-mcp-request-save-audit.ts');
    const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
    const { captureMcpReadInput } = source('packages/mcp-server/src/persistent-read-accounting.ts');
    const logs = new OperationLogService({ operationLog: { create: h.outside, findUnique: h.outside } });
    const audit = createOriginalMcpRequestSaveAudit({ captureMcpReadInput }, h.context, h.call, repository, saveAuthority, logs, () => now);
    const command = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'native-save-original-key', ...body };
    const associate = async (native, receipt) => { assert.equal(native, h.native); assert.ok(Object.isFrozen(receipt));
      await audit.associateIn(native, receipt, stop);
      if (!metadata.some(item => item.inputRef === receipt.inputRef)) metadata.push({ inputRef: receipt.inputRef, requestKey: receipt.requestKey }); };
    // External transaction/commit substitute only. The real repository owns no
    // transaction here; rollback and commit-unknown are controlled by its caller.
    const save = async (input, participant = associate, sig = stop, reissue = false) => {
      const beforeRows = structuredClone(rows), beforeMetadata = structuredClone(metadata), beforeAudits = structuredClone(auditRows); let committed = false;
      try {
        const result = await repository.saveIn(h.native, input, saveAuthority, sig, reissue, participant);
        if (loseCommit) { loseCommit = false; committed = true; throw new AiOriginalRequestResultUnknownError(); }
        return result;
      } catch (error) { if (!committed) { rows = beforeRows; metadata = beforeMetadata; auditRows = beforeAudits; } throw error; }
    };
    const first = await save(command);
    assert.equal(first.state, 'prepared'); assert.equal(first.commit, 'not_observed'); assert.equal(first.receipt.replayed, false);
    assert.equal(first.receipt.requestKey, command.requestKey); assert.equal(first.receipt.revision, 1); assert.equal(rows.size, 1); assert.equal(metadata.length, 1);
    assert.doesNotMatch(JSON.stringify(first), /private|user-a|tenant-a|scope-a|grantId|payload/);
    const replay = await save(command); assert.equal(replay.receipt.inputRef, first.receipt.inputRef); assert.equal(replay.receipt.replayed, true);
    assert.equal(inserts, 1); assert.equal(metadata.length, 1, 'the same original key does not create another request or metadata');
    assert.equal(auditInserts, 1); assert.equal(auditRows.size, 1, 'original save replay checks the same audit, not a new success event');
    const firstAudit = structuredClone(auditRows.get(first.receipt.inputRef));
    assert.equal(firstAudit.id, first.receipt.inputRef); assert.equal(firstAudit.action, 'mcp.original-request.saved');
    assert.equal(firstAudit.tenantId, 'tenant-a'); assert.equal(firstAudit.workspaceId, 'workspace-a'); assert.equal(firstAudit.userId, 'user-a');
    assert.equal(firstAudit.detail.metadata.contentHash, first.receipt.contentHash); assert.equal(firstAudit.detail.metadata.grantId, 'grant-a');
    assert.doesNotMatch(JSON.stringify(firstAudit), /native-save-original-key|private|payload|authorization|token|order-a/);
    auditRows.get(first.receipt.inputRef).action = 'wrong-existing-event';
    await assert.rejects(() => save(command)); assert.equal(auditInserts, 1, 'an existing different event is never overwritten');
    auditRows.set(first.receipt.inputRef, firstAudit);
    const { replayed: _replayed, ...originalReceipt } = first.receipt; let getters = 0;
    const unsafeReceipt = { ...originalReceipt }; Object.defineProperty(unsafeReceipt, 'inputRef', { enumerable: true, get() { getters++; return originalReceipt.inputRef; } });
    const auditReadsBefore = auditQueries.length;
    await assert.rejects(() => audit.associateIn(h.native, unsafeReceipt, stop)); assert.equal(getters, 0); assert.equal(auditQueries.length, auditReadsBefore);
    await assert.rejects(() => audit.associateIn(h.native, { ...originalReceipt, token: 'private-forged-token' }, stop));
    assert.equal(auditQueries.length, auditReadsBefore, 'private additions cannot enter log reads/writes');
    await assert.rejects(() => save({ ...command, input: { ...body.input, question: 'fees' } }), error => error.code === 'AI_REVISION_CONFLICT');
    const renewed = await save({ ...command, requestKey: 'native-save-reissue-key', previousInputRef: first.receipt.inputRef }, associate, stop, true);
    assert.equal(renewed.receipt.revision, 2); assert.equal(renewed.receipt.previousInputRef, first.receipt.inputRef);
    assert.ok(requestQueries.some(query => query.where.id === first.receipt.inputRef), 'predecessor is read through the same Native, never the global DB');
    const stableRows = structuredClone(rows), stableMetadata = structuredClone(metadata), stableAudits = structuredClone(auditRows);
    assert.equal(auditRows.size, 2, 'reissue has its own original reference and exactly one new event');
    failAudit = true; await assert.rejects(() => save({ ...command, requestKey: 'native-save-audit-failure' })); failAudit = false;
    assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata); assert.deepEqual(auditRows, stableAudits);
    badAuditResponse = true; await assert.rejects(() => save({ ...command, requestKey: 'native-save-audit-bad-response' })); badAuditResponse = false;
    assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata); assert.deepEqual(auditRows, stableAudits);
    const auditAbort = new AbortController(); afterAuditWrite = () => auditAbort.abort();
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-audit-cancel' }, (native, receipt) => audit.associateIn(native, receipt, auditAbort.signal), auditAbort.signal));
    afterAuditWrite = undefined; assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata); assert.deepEqual(auditRows, stableAudits);
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-association-failure' }, async (native, receipt) => { await associate(native, receipt); throw Error('private association failure'); }), error => error.code === 'AI_STORAGE_UNAVAILABLE');
    assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata);
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-policy-after-associate' }, async (native, receipt) => { await associate(native, receipt); planRevision = 2; }), error => error.code === 'AI_REVISION_CONFLICT');
    planRevision = 1; assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata);
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-lifetime-mutation' }, async (native, receipt) => { await associate(native, receipt); rows.get(receipt.inputRef).expiresAt = new Date(now.getTime()+40000); }), error => error.code === 'AI_REVISION_CONFLICT');
    assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata);
    const cancelled = new AbortController(); afterWrite = () => cancelled.abort();
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-cancelled-write' }, associate, cancelled.signal));
    afterWrite = undefined; assert.deepEqual(rows, stableRows); assert.deepEqual(metadata, stableMetadata);
    const beforeQueries = requestQueries.length, beforeInserts = inserts;
    await assert.rejects(() => repository.saveIn({ ...h.native, $transaction: h.outside }, command, saveAuthority, stop));
    await assert.rejects(() => repository.saveIn(h.native, command, { bindIn: () => undefined }, stop));
    await assert.rejects(() => repository.saveIn(h.native, command, saveAuthority, cancelled.signal));
    assert.equal(requestQueries.length, beforeQueries); assert.equal(inserts, beforeInserts);
    loseCommit = true;
    await assert.rejects(() => save({ ...command, requestKey: 'native-save-commit-unknown' }), error => error.code === 'AI_RESULT_UNKNOWN' && error.retryable === false);
    assert.equal(rows.size, stableRows.size + 1); assert.equal(metadata.length, stableMetadata.length + 1, 'lost commit reply does not delete saved original/association or retry');
    assert.ok([...rows.values()].some(row => row.requestKey === 'native-save-commit-unknown'));
    assert.equal(auditRows.size, stableAudits.size + 1, 'a lost outer commit reply retains the original audit, without new IDs or retries');
    const event = { tenantId: firstAudit.tenantId, workspaceId: firstAudit.workspaceId, userId: firstAudit.userId,
      scopeId: firstAudit.detail.metadata.scopeId, inputRef: first.receipt.inputRef, revision: first.receipt.revision,
      contentHash: first.receipt.contentHash, sceneCode: first.receipt.sceneCode, sceneVersion: first.receipt.sceneVersion,
      policyRevision: firstAudit.detail.metadata.policyRevision, policyHash: firstAudit.detail.metadata.policyHash,
      grantId: firstAudit.detail.metadata.grantId, grantRevision: firstAudit.detail.metadata.grantRevision };
    const beforeWrong = auditInserts;
    await assert.rejects(() => logs.recordOriginalMcpRequestSaveAudit(h.native, { ...event, workspaceId: 'foreign-space' }, stop));
    await assert.rejects(() => logs.recordOriginalMcpRequestSaveAudit(h.native, { ...event, grantRevision: 2 }, stop));
    await assert.rejects(() => logs.recordOriginalMcpRequestSaveAudit(h.native, { ...event, action: 'caller-action' }, stop));
    assert.equal(auditInserts, beforeWrong); assert.deepEqual(auditRows.get(first.receipt.inputRef), firstAudit);
    const readBaseline = { rows: structuredClone(rows), audits: structuredClone(auditRows), inserts, auditInserts };
    const unknownCommand = { ...command, requestKey: 'native-save-commit-unknown' };
    const restored = await repository.reconcileIn(h.native, unknownCommand, saveAuthority, stop);
    assert.equal(restored.state, 'observed'); assert.equal(restored.retryable, false); assert.equal(restored.task, 'not_loaded');
    assert.equal(restored.observation, 'native_row_not_commit_or_execution_evidence');
    assert.equal(restored.receipt.inputRef, [...rows.values()].find(row => row.requestKey === unknownCommand.requestKey).id);
    assert.doesNotMatch(JSON.stringify(restored), /private|payload|grantId|user-a|tenant-a/);
    const absent = await repository.reconcileIn(h.native, { ...command, requestKey: 'native-not-observed-original-key' }, saveAuthority, stop);
    assert.equal(absent.state, 'not_observed'); assert.equal(absent.retryable, false); assert.equal(absent.task, 'not_loaded');
    const reissued = await repository.reconcileIn(h.native, { ...command, requestKey: 'native-save-reissue-key', previousInputRef: first.receipt.inputRef }, saveAuthority, stop, true);
    assert.equal(reissued.receipt.inputRef, renewed.receipt.inputRef); assert.equal(reissued.receipt.previousInputRef, first.receipt.inputRef);
    await assert.rejects(() => repository.reconcileIn(h.native, { ...command, input: { ...body.input, question: 'fees' } }, saveAuthority, stop), error => error.code === 'AI_REVISION_CONFLICT');
    const storedOriginal = structuredClone(rows.get(first.receipt.inputRef));
    rows.get(first.receipt.inputRef).expiresAt = new Date(now.getTime()-1000); rows.get(first.receipt.inputRef).creationClosedAt = now; rows.get(first.receipt.inputRef).creationCloseKey = 'permanently-closed';
    const planReader = h.native.aiTaskPlanPolicy.findFirst; h.native.aiTaskPlanPolicy.findFirst = h.outside;
    const historical = await repository.reconcileIn(h.native, command, saveAuthority, stop);
    assert.equal(historical.state, 'observed'); assert.equal(historical.receipt.state, 'expired'); assert.equal(historical.task, 'not_loaded');
    assert.equal(rows.get(first.receipt.inputRef).creationCloseKey, 'permanently-closed', 'read never reopens creation or renews input');
    rows.get(first.receipt.inputRef).erasedAt = now; await assert.rejects(() => repository.reconcileIn(h.native, command, saveAuthority, stop));
    h.native.aiTaskPlanPolicy.findFirst = planReader; rows.set(first.receipt.inputRef, storedOriginal);
    const readAbort = new AbortController(); afterRequestRead = () => readAbort.abort(); const orderReads = h.state.reads.length;
    await assert.rejects(() => repository.reconcileIn(h.native, command, saveAuthority, readAbort.signal));
    assert.equal(h.state.reads.length, orderReads, 'row-await cancellation cannot start resource reads'); afterRequestRead = undefined;
    const beforeInvalid = requestQueries.length;
    await assert.rejects(() => repository.reconcileIn({ ...h.native, $transaction: h.outside }, command, saveAuthority, stop));
    await assert.rejects(() => repository.reconcileIn(h.native, command, { bindIn: () => undefined }, stop));
    await assert.rejects(() => repository.reconcileIn(h.native, command, saveAuthority, readAbort.signal));
    assert.equal(requestQueries.length, beforeInvalid);
    h.f.user.isActive = false; await assert.rejects(() => repository.reconcileIn(h.native, command, saveAuthority, stop)); h.f.user.isActive = true;
    assert.equal(inserts, readBaseline.inserts); assert.equal(auditInserts, readBaseline.auditInserts);
    assert.deepEqual(rows, readBaseline.rows); assert.deepEqual(auditRows, readBaseline.audits, 'reconciliation is read-only, never re-records an event');
    const { createOriginalMcpRequestParticipant } = source('apps/api/src/modules/auth/original-mcp-request-participant.ts');
    const participant = createOriginalMcpRequestParticipant({ captureMcpReadInput }, h.context, h.call, repository, saveAuthority, logs, () => now);
    escapedParticipant = participant;
    // This is the original external owner's rollback/commit substitute, not a
    // transaction opened by the participant or proof of database atomicity.
    const own = async (run, commitUnknown = false) => {
      const oldRows = structuredClone(rows), oldAudits = structuredClone(auditRows); let committed = false;
      try { const prepared = await run(); if (commitUnknown) { committed = true; throw new AiOriginalRequestResultUnknownError(); } return prepared; }
      catch (error) { if (!committed) { rows = oldRows; auditRows = oldAudits; } throw error; }
    };
    const participantCommand = { ...command, requestKey: 'native-participant-original-key' }, eventCount = auditInserts;
    const combined = await own(() => participant.saveIn(h.native, participantCommand, stop));
    assert.equal(combined.state, 'prepared'); assert.equal(combined.commit, 'not_observed'); assert.equal(auditInserts, eventCount + 1);
    assert.equal(auditRows.get(combined.receipt.inputRef).action, 'mcp.original-request.saved');
    const combinedReplay = await own(() => participant.saveIn(h.native, participantCommand, stop));
    assert.equal(combinedReplay.receipt.inputRef, combined.receipt.inputRef); assert.equal(combinedReplay.receipt.replayed, true); assert.equal(auditInserts, eventCount + 1);
    const combinedRows = structuredClone(rows), combinedAudits = structuredClone(auditRows);
    failAudit = true; await assert.rejects(() => own(() => participant.saveIn(h.native, { ...command, requestKey: 'native-participant-audit-fail' }, stop))); failAudit = false;
    assert.deepEqual(rows, combinedRows); assert.deepEqual(auditRows, combinedAudits, 'save cannot return preparation without the mandatory original audit');
    const combinedAbort = new AbortController(); afterAuditWrite = () => combinedAbort.abort();
    await assert.rejects(() => own(() => participant.saveIn(h.native, { ...command, requestKey: 'native-participant-audit-abort' }, combinedAbort.signal)));
    afterAuditWrite = undefined; assert.deepEqual(rows, combinedRows); assert.deepEqual(auditRows, combinedAudits);
    const unsafeCommand = { ...participantCommand }; let commandGetters = 0;
    Object.defineProperty(unsafeCommand, 'requestKey', { enumerable: true, get() { commandGetters++; return participantCommand.requestKey; } });
    const beforeUnsafe = requestQueries.length;
    await assert.rejects(() => participant.saveIn(h.native, unsafeCommand, stop));
    await assert.rejects(() => participant.reconcileIn(h.native, unsafeCommand, stop));
    assert.equal(commandGetters, 0); assert.equal(requestQueries.length, beforeUnsafe, 'ordinary-JSON capture precedes authority/SQL');
    const mutableCommand = { ...command, input: { ...body.input }, requestKey: 'native-participant-snapshot' };
    afterRequestRead = () => { mutableCommand.requestKey = 'private-late-mutated-key'; mutableCommand.input.question = 'fees'; };
    const fixed = await own(() => participant.saveIn(h.native, mutableCommand, stop)); afterRequestRead = undefined;
    assert.equal(fixed.receipt.requestKey, 'native-participant-snapshot'); assert.equal(rows.get(fixed.receipt.inputRef).payload.question, 'status');
    const combinedUnknownCommand = { ...command, requestKey: 'native-participant-unknown' };
    await assert.rejects(() => own(() => participant.saveIn(h.native, combinedUnknownCommand, stop), true), error => error.code === 'AI_RESULT_UNKNOWN' && !error.retryable);
    const combinedReadBaseline = { rows: structuredClone(rows), audits: structuredClone(auditRows), inserts, auditInserts };
    const combinedObserved = await participant.reconcileIn(h.native, combinedUnknownCommand, stop);
    assert.equal(combinedObserved.receipt.inputRef, [...rows.values()].find(row => row.requestKey === combinedUnknownCommand.requestKey).id);
    assert.equal(combinedObserved.observation, 'native_row_not_commit_or_execution_evidence'); assert.equal(combinedObserved.task, 'not_loaded');
    const combinedAbsent = await participant.reconcileIn(h.native, { ...command, requestKey: 'native-participant-absent' }, stop);
    assert.equal(combinedAbsent.state, 'not_observed'); assert.equal(combinedAbsent.retryable, false);
    assert.equal(inserts, combinedReadBaseline.inserts); assert.equal(auditInserts, combinedReadBaseline.auditInserts);
    assert.deepEqual(rows, combinedReadBaseline.rows); assert.deepEqual(auditRows, combinedReadBaseline.audits);
    const ignoredAudit = createOriginalMcpRequestParticipant({ captureMcpReadInput }, h.context, h.call,
      { saveIn: async () => combined, reconcileIn: h.outside, withCurrentInputIn: h.outside }, saveAuthority, logs, () => now);
    await assert.rejects(() => ignoredAudit.saveIn(h.native, participantCommand, stop), /participant unavailable/u);
    const combinedBeforeInvalid = requestQueries.length;
    await assert.rejects(() => participant.saveIn({ ...h.native, $transaction: h.outside }, participantCommand, stop));
    await assert.rejects(() => participant.reconcileIn(h.native, participantCommand, combinedAbort.signal));
    await assert.rejects(() => participant.saveIn(h.native, participantCommand, stop, 'true'));
    assert.equal(requestQueries.length, combinedBeforeInvalid);
    assert.throws(() => createOriginalMcpRequestParticipant({ captureMcpReadInput }, h.context, h.call, repository, saveAuthority, {}, () => now));
    assert.equal(metadata.length, stableMetadata.length + 1, 'the participant never creates goal/call metadata or a Task');
    return direct;
  });
  assert.deepEqual(result.actor, { kind: 'user', userId: 'user-a' }); assert.deepEqual(result.scope, { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' });
  assert.doesNotMatch(JSON.stringify(result), /private customer|private-contact|private-business-lock|private-order-token|issuer-not-user|orderNo|amounts/);
  assert.ok(h.state.reads.some(args => args.select) && h.state.reads.some(args => args.include), 'real Guard and original aggregate repository both executed');
  assert.equal(h.f.configReads, 0); const before = h.state.reads.length;
  await assert.rejects(() => escaped.authorizeResourcesIn(body, h.native, signal())); assert.equal(h.state.reads.length, before);
  await assert.rejects(() => escapedRepository.saveIn(h.native, { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'native-save-after-callback', ...body }, escapedSaveAuthority, signal()));
  await assert.rejects(() => escapedParticipant.saveIn(h.native, { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'native-participant-after-callback', ...body }, signal()));
  await assert.rejects(() => escapedParticipant.reconcileIn(h.native, { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: 'native-participant-after-callback', ...body }, signal()));
  assert.equal(h.state.reads.length, before, 'an escaped Native writer or participant cannot query resources after its original callback ends');
  const kinds = ['no-permission','guard-denied','missing-order','wrong-order','unsupported-question','unsupported-scene','cancel','closed','global'];
  for (const kind of kinds) {
    const value = make(), abort = new AbortController(); let request = structuredClone(body);
    if (kind === 'no-permission') value.f.member.role.permissions = [{ permission: { code: 'rental-core:catalog:view' } }];
    if (kind === 'guard-denied') value.state.denyGuard = true;
    if (kind === 'missing-order') value.state.absent = true;
    if (kind === 'wrong-order') value.state.row.id = 'other-order';
    if (kind === 'unsupported-question') request.input.question = 'payments';
    if (kind === 'unsupported-scene') request = { sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal' } } };
    if (kind === 'closed') value.state.active = false;
    await assert.rejects(() => value.run((resources, stop) => {
      if (kind === 'cancel') abort.abort();
      return resources.authorizeResourcesIn(request, kind === 'global' ? { ...value.native, $transaction: value.outside } : value.native, stop);
    }, abort.signal));
    if (['unsupported-question','unsupported-scene','cancel','global'].includes(kind)) assert.equal(value.state.reads.length, 0);
  }
  const questions = make(), packets = [];
  const { AiOrderExplanationPreparationService } = source('apps/api/src/modules/ai-native/tools/order-explanation-preparation.service.ts');
  const originalPrepare = AiOrderExplanationPreparationService.prototype.prepare;
  // Observation-only spy: execute the exact original method and preserve its
  // return/error. No fake prepared packet, finance source or successful guard.
  AiOrderExplanationPreparationService.prototype.prepare = async function(value) {
    const result = await originalPrepare.call(this, value); packets.push(structuredClone(result)); return result;
  };
  try {
    questions.state.row.quoteId = 'saved-quote-a'; questions.state.row.ruleVersion = 'original-rule-v1';
    questions.state.row.ruleSnapshot = { fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: false } };
    questions.state.row.pricingPlanVersion = 'original-plan-v1'; questions.state.row.priceVersionId = 'original-price-id'; questions.state.row.priceVersion = 'original-price-v1';
    await questions.run(async (_status, stop) => {
      const resource = createOriginalMcpOrderResources(mcp, questions.context, questions.call, ['order:read'], questions.f.auth, questions.f.guard, questions.core, () => now);
      for (const question of ['status', 'fees', 'payments', 'next_steps']) {
        const observed = await resource.authorizeResourcesIn({ ...body, input: { ...body.input, question } }, questions.native, stop);
        assert.deepEqual(observed.actor, { kind: 'user', userId: 'user-a' });
        assert.doesNotMatch(JSON.stringify(observed), /private-contact|amounts|original-rule|price-v1|saved-quote/);
      }
      const before = questions.state.reads.length;
      await assert.rejects(() => resource.authorizeResourcesIn({ ...body, input: { ...body.input, question: 'refund' } }, questions.native, stop));
      await assert.rejects(() => resource.authorizeResourcesIn({ sceneCode: 'opening_diagnosis', input: { sections: ['item_groups'] } }, questions.native, stop));
      assert.equal(questions.state.reads.length, before);
    });
    assert.deepEqual(packets.map(value => value.payload.question), ['status','fees','payments','next_steps']);
    const fees = packets[1].payload, payments = packets[2].payload, next = packets[3].payload;
    assert.equal(fees.facts.history.coverage, 'partial'); assert.equal(fees.facts.history.value.basis, 'order_snapshot');
    assert.equal(fees.facts.history.value.complete, false); assert.equal(fees.facts.history.value.rule.version, 'original-rule-v1');
    assert.equal(fees.facts.history.value.price.priceVersion, 'original-price-v1'); assert.equal(fees.facts.history.value.savedQuote.status, 'not_loaded');
    assert.equal(fees.facts.fulfillment.value.originalEndAt, questions.state.row.endAt.toISOString());
    assert.equal(fees.facts.inspections.coverage, 'unavailable', 'fees requested inspection evidence; a missing dedicated source is unavailable, not unrequested');
    assert.equal(payments.facts.payments.coverage, 'unavailable'); assert.equal(Object.hasOwn(payments.facts.payments, 'value'), false);
    assert.equal(payments.facts.actualReceivedTotal.coverage, 'not_loaded'); assert.equal(payments.facts.fundingLedger.coverage, 'unavailable', 'requested ledger evidence has no native source; no empty ledger is inferred');
    assert.equal(next.handoff.allowedActions, 'unavailable'); assert.ok(next.handoff.candidates.every(value => value.executable === false));
    assert.ok(packets.every(value => value.payload.model.answer === 'not_generated' && value.payload.handoff.execution === 'not_attempted'));
    assert.equal(questions.f.configReads, 0);
    const missing = make();
    await missing.run((_status, stop) => createOriginalMcpOrderResources(mcp, missing.context, missing.call, ['order:read'], missing.f.auth, missing.f.guard, missing.core, () => now)
      .authorizeResourcesIn({ ...body, input: { ...body.input, question: 'fees' } }, missing.native, stop));
    const absentHistory = packets.at(-1).payload.facts.history.value;
    assert.equal(absentHistory.rule.status, 'missing'); assert.equal(absentHistory.price.status, 'missing'); assert.equal(absentHistory.savedQuote.status, 'missing_link');
    const changed = make(); changed.state.afterOrder = () => { changed.state.row.updatedAt = new Date(now.getTime()+1000); };
    await assert.rejects(() => changed.run((_status, stop) => createOriginalMcpOrderResources(mcp, changed.context, changed.call, ['order:read'], changed.f.auth, changed.f.guard, changed.core, () => now)
      .authorizeResourcesIn({ ...body, input: { ...body.input, question: 'fees' } }, changed.native, stop)));
    const { RentalBusinessService } = source('apps/api/src/modules/rental-core/rental-business.service.ts');
    const { RentalBusinessFactRepository } = source('apps/api/src/modules/rental-core/rental-business-fact.repository.ts');
    const saved = make(); saved.state.row.quoteId = 'saved-quote-a'; saved.state.row.ruleVersion = 'original-rule-v1';
    saved.state.row.pricingPlanVersion = 'original-plan-v1'; saved.state.row.priceVersionId = 'original-price-id'; saved.state.row.priceVersion = 'original-price-v1';
    saved.state.quoteReads = [];
    const quoteRow = { id: 'saved-quote-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', quoteNo: 'Q-A', categoryCode: 'EQUIPMENT', currency: 'CNY',
      ruleVersion: 'original-rule-v1', pricingPlanVersion: 'original-plan-v1', priceVersionId: 'original-price-id', priceVersion: 'original-price-v1',
      createdAt: new Date('2025-01-01'), expiresAt: new Date('2025-01-02'), consumedAt: new Date('2025-01-01T01:00:00Z'), consumedOrderId: 'order-a',
      request: { customerName: 'private saved customer' }, rateSnapshot: [{ id: 'rate-a', itemGroupId: 'item-a', unit: shared.RENTAL_PRICING_UNIT_CODES[0], baseAmount: 12 }], pricingContext: { timeZone: 'Asia/Shanghai' } };
    for (const field of ['rentalAmount','discountAmount','couponAmount','serviceAmount','fulfillmentAmount','preAuthAmount','receivableAmount','taxRate','taxAmount','depositAmount','payableAmount']) quoteRow[field] = 12;
    let missingQuote = false;
    saved.native.rentalQuote = { async findFirst(args) { saved.state.quoteReads.push(structuredClone(args)); assert.deepEqual(args.where, { id: 'saved-quote-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' }); return missingQuote ? null : structuredClone(quoteRow); } };
    const quoteRepository = new RentalBusinessFactRepository({ businessWorkspace: { findFirst: saved.outside }, rentalQuote: { findFirst: saved.outside } });
    const business = Object.create(RentalBusinessService.prototype); business.factStore = quoteRepository; business.state = saved.outside;
    await saved.run(async (_status, stop) => {
      const resources = createOriginalMcpOrderResources(mcp, saved.context, saved.call, ['order:read'], saved.f.auth, saved.f.guard, saved.core, () => now, business);
      const feesBody = { ...body, input: { ...body.input, question: 'fees' } };
      const observed = await resources.authorizeResourcesIn(feesBody, saved.native, stop);
      const quoted = packets.at(-1).payload.facts.history.value.savedQuote;
      assert.equal(quoted.status, 'available'); assert.equal(quoted.quoteId, 'saved-quote-a'); assert.equal(quoted.basis, 'order_linked_quote');
      assert.equal(quoted.priceVersion, 'original-price-v1'); assert.equal(quoted.rates[0].baseAmount, 12); assert.equal(quoted.timeZone, 'Asia/Shanghai');
      assert.doesNotMatch(JSON.stringify(observed), /private saved customer|baseAmount|saved-quote-a|original-price-v1/);
      const direct = await business.readQuoteInTransaction('tenant-a', 'saved-quote-a', saved.native, stop);
      assert.equal(direct.consumedOrderId, 'order-a'); assert.equal(direct.expiresAt, quoteRow.expiresAt.toISOString(), 'expired consumed quote is still original historical evidence');
      assert.deepEqual(await business.loadQuote('tenant-a', {}, 'saved-quote-a', saved.native), direct, 'legacy Native branch keeps the same original fact/clone behavior without cache state');
      missingQuote = true; await resources.authorizeResourcesIn(feesBody, saved.native, stop);
      assert.equal(packets.at(-1).payload.facts.history.value.savedQuote.status, 'missing');
      missingQuote = false; quoteRow.priceVersion = 'wrong-current-version'; await resources.authorizeResourcesIn(feesBody, saved.native, stop);
      assert.equal(packets.at(-1).payload.facts.history.coverage, 'unavailable', 'version mismatch must not supply historical facts');
      quoteRow.priceVersion = 'original-price-v1';
      const before = saved.state.quoteReads.length;
      await assert.rejects(() => business.readQuoteInTransaction('tenant-a', 'saved-quote-a', { ...saved.native, $transaction: saved.outside }, stop));
      const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(() => business.readQuoteInTransaction('tenant-a', 'saved-quote-a', saved.native, cancelled.signal));
      assert.equal(saved.state.quoteReads.length, before);
    });
    const inspected = make(), pageQueries = [], cursorQueries = [];
    let recorded = Array.from({ length: 51 }, (_, index) => ({ id: `inspection-${String(index).padStart(3, '0')}`,
      tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', stage: 'pickup',
      templateId: 'original-template-a', templateCode: 'historical-pickup', templateVersion: 'original-2025-v1',
      createdAt: new Date('2025-01-01'), results: { privateResult: 'private-inspection-result', __r1InspectionMeta: { exchangeId: 'exchange-a' } },
      exceptions: [{ code: 'recorded-condition', description: 'Recorded condition only', reviewStatus: 'pending', customerResponseStatus: 'disputed' }],
      attachments: ['https://private.example.invalid/inspection'], operator: 'private-inspector' }));
    let afterCursor, afterPage;
    inspected.native.rentalInspectionRecord = {
      async findFirst(args) { cursorQueries.push(structuredClone(args)); assert.deepEqual(args.select, { id: true });
        const row = recorded.find(value => value.id === args.where.id && value.tenantId === args.where.tenantId && value.workspaceId === args.where.workspaceId && value.orderId === args.where.orderId);
        await afterCursor?.(); return row ? { id: row.id } : null; },
      async findMany(args) { pageQueries.push(structuredClone(args));
        assert.deepEqual({ tenantId: args.where.tenantId, workspaceId: args.where.workspaceId, orderId: args.where.orderId }, { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a' });
        assert.deepEqual(args.orderBy, { id: 'asc' }); assert.ok(args.take >= 2 && args.take <= 51);
        const rows = recorded.filter(row => !args.where.id || row.id > args.where.id.gt).slice(0, args.take);
        await afterPage?.(); return structuredClone(rows); }
    };
    let inspectionResource;
    await inspected.run(async (_status, stop) => {
      inspectionResource = createOriginalMcpOrderResources(mcp, inspected.context, inspected.call, ['order:read'], inspected.f.auth, inspected.f.guard, inspected.core, () => now, undefined, inspected.core);
      // Explicitly supplying the page source never expands the status-only route.
      const status = createOriginalMcpOrderStatusResources(mcp, inspected.context, inspected.call, ['order:read'], inspected.f.auth, inspected.f.guard, inspected.core, () => now, undefined, inspected.core);
      await status.authorizeResourcesIn(body, inspected.native, stop); assert.equal(pageQueries.length, 0);
      const fee = { ...body, input: { ...body.input, question: 'fees' } };
      const observed = await inspectionResource.authorizeResourcesIn(fee, inspected.native, stop);
      const evidence = packets.at(-1).payload.facts.inspections;
      assert.equal(evidence.coverage, 'partial'); assert.equal(evidence.value.records.length, 50);
      assert.equal(evidence.value.records[0].templateVersion, 'original-2025-v1'); assert.equal(evidence.value.records[0].exchangeId, 'exchange-a');
      assert.equal(evidence.value.records[0].exceptions[0].customerResponseStatus, 'disputed');
      assert.equal(evidence.value.truncated, true); assert.equal(evidence.value.nextCursor, 'inspection-049');
      assert.equal(evidence.value.queryLimit, 50); assert.equal(evidence.value.queryPages, 1);
      assert.equal(evidence.value.semantics, 'recorded_inspection_and_review_only_not_liability_or_settlement');
      assert.equal(evidence.value.attachments, 'not_loaded'); assert.equal(evidence.value.execution, 'not_attempted');
      assert.doesNotMatch(JSON.stringify(evidence), /private-inspection-result|private-inspector|private\.example|privateResult/);
      assert.doesNotMatch(JSON.stringify(observed), /historical-pickup|recorded-condition|inspection-0|private/);
      assert.equal(pageQueries.length, 2); assert.equal(pageQueries[0].take, 51); assert.equal(cursorQueries.length, 0);
      assert.deepEqual(pageQueries[1], pageQueries[0], 'current facts re-open the same bounded inspection page before release');
      const tail = await inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', { limit: 50, cursor: 'inspection-049' }, inspected.native, stop);
      assert.deepEqual(tail.items.map(row => row.id), ['inspection-050']); assert.equal(tail.nextCursor, null);
      assert.deepEqual(cursorQueries.at(-1).where, { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', id: 'inspection-049' });
      const count = pageQueries.length;
      for (const query of [{ limit: 51 }, { limit: 0 }, { limit: 50, cursor: 'bad/path' }])
        await assert.rejects(() => inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', query, inspected.native, stop));
      await assert.rejects(() => inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', { limit: 50, cursor: 'other-order-cursor' }, inspected.native, stop));
      await assert.rejects(() => inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', { limit: 50 }, { ...inspected.native, $transaction: inspected.outside }, stop));
      const cancelled = new AbortController(); cancelled.abort();
      await assert.rejects(() => inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', { limit: 50 }, inspected.native, cancelled.signal));
      assert.equal(pageQueries.length, count);
      // Cursor-await cancellation cannot dispatch the subsequent page query.
      const cursorAbort = new AbortController(); afterCursor = () => cursorAbort.abort();
      await assert.rejects(() => inspected.core.listInspectionsPageInTransaction('tenant-a', 'order-a', { limit: 50, cursor: 'inspection-049' }, inspected.native, cursorAbort.signal));
      afterCursor = undefined; assert.equal(pageQueries.length, count);
      const originalRows = recorded; recorded = [];
      await inspectionResource.authorizeResourcesIn(fee, inspected.native, stop);
      const empty = packets.at(-1).payload.facts.inspections.value;
      assert.deepEqual(empty.records, []); assert.equal(empty.coverage, 'partial'); assert.equal(empty.truncated, false);
      // Wrong scope/order evidence fails closed; no current template substitute.
      recorded = [{ ...originalRows[0], orderId: 'foreign-order' }];
      await assert.rejects(() => inspectionResource.authorizeResourcesIn(fee, inspected.native, stop));
      recorded = originalRows; afterPage = () => { inspected.state.row.updatedAt = new Date(now.getTime()+1000); };
      await assert.rejects(() => inspectionResource.authorizeResourcesIn(fee, inspected.native, stop));
      afterPage = undefined; inspected.state.row.updatedAt = now;
      inspected.f.member.role.permissions = [{ permission: { code: 'rental-core:catalog:view' } }];
      const deniedCount = pageQueries.length; await assert.rejects(() => inspectionResource.authorizeResourcesIn(fee, inspected.native, stop));
      assert.equal(pageQueries.length, deniedCount); inspected.f.member.role.permissions.push({ permission: { code: '*' } });
    });
    const beforeEscaped = pageQueries.length;
    await assert.rejects(() => inspectionResource.authorizeResourcesIn({ ...body, input: { ...body.input, question: 'fees' } }, inspected.native, signal()));
    assert.equal(pageQueries.length, beforeEscaped); assert.equal(inspected.f.configReads, 0);
    const { PaymentRuntimeService } = source('apps/api/src/modules/integrations/payment.runtime.service.ts');
    const paid = make(), financeQueries = [];
    const intent = (id, status, amount) => ({ id, tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', instrument: 'rental',
      provider: 'alipay', method: 'alipay', amount, currency: 'CNY', merchantOrderNo: 'private-merchant-order', status,
      checkoutUrl: 'https://private.example.invalid/pay', externalTransactionId: 'private-provider-transaction', failureReason: null,
      expiresAt: new Date('2025-01-02'), paidAt: status === 'paid' ? new Date('2025-01-01') : null });
    let intents = [intent('intent-paid', 'paid', 12.34), intent('intent-verified', 'verified_pending_funding', 56.78), intent('intent-funding-failed', 'funding_failed', 9.87)];
    let refunds = ['accepted','funding_pending','succeeded'].map((status, index) => ({ id: `refund-${index}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', paymentIntentId: 'intent-paid',
      provider: 'alipay', method: 'alipay', amount: [1.11,2.22,3.33][index], currency: 'CNY', merchantRefundNo: 'private-merchant-refund', status,
      externalRefundId: 'private-refund-id', externalStatus: 'private-status', reason: 'private-refund-reason', failureReason: null,
      acceptedAt: now, succeededAt: status === 'succeeded' ? now : null, fundedAt: status === 'succeeded' ? now : null, createdAt: now, updatedAt: now }));
    let afterIntentPage;
    paid.native.rentalPaymentIntent = {
      async findFirst(args) { financeQueries.push(['intent-one', structuredClone(args)]); return structuredClone(intents.find(row => Object.entries(args.where).every(([key, value]) => row[key] === value)) ?? null); },
      async findMany(args) { financeQueries.push(['intent-page', structuredClone(args)]); assert.deepEqual(args.where, { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a' });
        assert.ok(args.take >= 2 && args.take <= 21); assert.deepEqual(args.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
        const page = structuredClone(intents.slice(0, args.take)); await afterIntentPage?.(); return page; }
    };
    paid.native.rentalPaymentRefund = {
      async findFirst(args) { financeQueries.push(['refund-one', structuredClone(args)]); return structuredClone(refunds.find(row => Object.entries(args.where).every(([key, value]) => row[key] === value)) ?? null); },
      async findMany(args) { financeQueries.push(['refund-page', structuredClone(args)]); assert.deepEqual({ ...args.where, paymentIntentId: 'intent-paid' }, { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', paymentIntentId: 'intent-paid' });
        assert.ok(args.take >= 2 && args.take <= 51); return structuredClone(refunds.filter(row => row.paymentIntentId === args.where.paymentIntentId).slice(0, args.take)); }
    };
    const runtime = Object.create(PaymentRuntimeService.prototype); runtime.prisma = { rentalPaymentIntent: { findFirst: paid.outside, findMany: paid.outside }, rentalPaymentRefund: { findFirst: paid.outside, findMany: paid.outside } };
    runtime.integrations = { runtimeConfig: paid.outside }; runtime.funding = { applyPayment: paid.outside };
    let paymentResource;
    const configured = owner => createOriginalMcpOrderResources(mcp, owner.context, owner.call, ['order:read'], owner.f.auth, owner.f.guard, owner.core, () => now, undefined, undefined, { source: runtime, guard: owner.f.guard });
    await paid.run(async (_status, stop) => {
      paymentResource = configured(paid);
      await paymentResource.authorizeResourcesIn(body, paid.native, stop); assert.equal(financeQueries.length, 0, 'status does not query finance');
      const question = { ...body, input: { ...body.input, question: 'payments' } };
      const observed = await paymentResource.authorizeResourcesIn(question, paid.native, stop);
      const evidence = packets.at(-1).payload.facts.payments;
      assert.equal(evidence.coverage, 'partial'); assert.deepEqual(evidence.value.intents.map(row => [row.status,row.amount]), [['paid',12.34],['pending',56.78],['funding_failed',9.87]]);
      assert.deepEqual(evidence.value.refunds.map(row => row.status), ['accepted','funding_pending','succeeded']);
      assert.equal(evidence.value.refunds[0].succeededAt, undefined); assert.equal(evidence.value.refunds[2].fundedAt, now.toISOString());
      assert.equal(evidence.value.totals, 'not_computed'); assert.equal(evidence.value.fundingLedger, 'not_loaded');
      assert.equal(evidence.value.freshness, 'local_records_not_provider_refresh'); assert.equal(packets.at(-1).payload.facts.actualReceivedTotal.coverage, 'not_loaded');
      assert.doesNotMatch(JSON.stringify(evidence), /private-|private\.example|checkoutUrl|merchantRefundNo|externalRefundId|"reason"/);
      assert.doesNotMatch(JSON.stringify(observed), /intent-paid|refund-0|12\.34|private-/);
      const recorded = intents; intents = Array.from({ length: 21 }, (_, index) => intent(`bounded-${index}`, 'pending', 2));
      const page = await runtime.listPaymentIntentsPageInTransaction('tenant-a', 'workspace-a', 'order-a', { limit: 20 }, paid.native, stop, () => paid.context.current(paid.call));
      assert.equal(page.rows.length, 20); assert.equal(page.truncated, true); assert.equal(page.nextCursor, 'bounded-19'); intents = recorded;
      const ownerLive = () => { paid.context.current(paid.call); };
      const count = financeQueries.length;
      const intentPagesBeforeInvalidInput = financeQueries.filter(([kind]) => kind === 'intent-page').length;
      await assert.rejects(() => runtime.listPaymentIntentsPageInTransaction('tenant-a', 'workspace-a', 'order-a', { limit: 21 }, paid.native, stop, ownerLive));
      await assert.rejects(() => runtime.listPaymentIntentsPageInTransaction('tenant-a', 'foreign-space', 'order-a', { limit: 20 }, paid.native, stop, ownerLive));
      await assert.rejects(() => runtime.listPaymentIntentsPageInTransaction('tenant-a', 'workspace-a', 'order-a', { limit: 20 }, { ...paid.native, $transaction: paid.outside }, stop, ownerLive));
      const aborted = new AbortController(); aborted.abort(); await assert.rejects(() => runtime.listPaymentIntentsPageInTransaction('tenant-a', 'workspace-a', 'order-a', { limit: 20 }, paid.native, aborted.signal, ownerLive));
      assert.equal(financeQueries.length, count);
      await assert.rejects(() => runtime.listPaymentIntentsPageInTransaction('tenant-a', 'workspace-a', 'order-a', { limit: 20, cursor: 'foreign-cursor' }, paid.native, stop, ownerLive));
      assert.equal(financeQueries.filter(([kind]) => kind === 'intent-page').length, intentPagesBeforeInvalidInput, 'foreign cursor cannot start a page');
      const emptyIntents = intents; intents = [];
      await paymentResource.authorizeResourcesIn(question, paid.native, stop); const empty = packets.at(-1).payload.facts.payments.value;
      assert.deepEqual(empty.intents, []); assert.deepEqual(empty.refunds, []); assert.equal(empty.totals, 'not_computed');
      intents = [{ ...emptyIntents[0], currency: 'USD' }]; await paymentResource.authorizeResourcesIn(question, paid.native, stop);
      assert.equal(packets.at(-1).payload.facts.payments.coverage, 'unavailable', 'currency mismatch cannot supply facts');
      intents = [{ ...emptyIntents[0], workspaceId: 'foreign-space' }]; await paymentResource.authorizeResourcesIn(question, paid.native, stop);
      assert.equal(packets.at(-1).payload.facts.payments.coverage, 'unavailable'); intents = emptyIntents;
      afterIntentPage = () => { paid.f.user.isActive = false; };
      await assert.rejects(() => paymentResource.authorizeResourcesIn(question, paid.native, stop));
      afterIntentPage = undefined; paid.f.user.isActive = true;
    });
    const escapedCount = financeQueries.length; await assert.rejects(() => paymentResource.authorizeResourcesIn({ ...body, input: { ...body.input, question: 'payments' } }, paid.native, signal()));
    assert.equal(financeQueries.length, escapedCount); assert.equal(paid.f.configReads, 0);
    const orderOnly = make(); orderOnly.f.member.role.permissions = ['rental-core:catalog:view','rental-os:order:view'].map(code => ({ permission: { code } }));
    orderOnly.native.rentalPaymentIntent = paid.native.rentalPaymentIntent; orderOnly.native.rentalPaymentRefund = paid.native.rentalPaymentRefund;
    const beforeDenied = financeQueries.length;
    await orderOnly.run(async (_status, stop) => configured(orderOnly).authorizeResourcesIn({ ...body, input: { ...body.input, question: 'payments' } }, orderOnly.native, stop));
    assert.equal(packets.at(-1).payload.facts.payments.coverage, 'unavailable'); assert.equal(financeQueries.length, beforeDenied, 'order permission never grants finance');
    let invalidRead = 0;
    for (const [kind, input] of [['payment_intents', { orderId: 'order-a', actor: 'user-a' }], ['payment_refunds', { orderId: 'order-a', intentId: 'bad/path' }], ['payment_refresh', { orderId: 'order-a' }]]) {
      await assert.rejects(() => paid.f.guard.withTrustedOrderPaymentRead(kind, input, async () => { invalidRead++; return undefined; }, async () => { invalidRead++; }, signal()));
    }
    assert.equal(invalidRead, 0);
  } finally { AiOrderExplanationPreparationService.prototype.prepare = originalPrepare; }
  const bad = make();
  await bad.run(async () => {
    assert.throws(() => createOriginalMcpOrderStatusResources(mcp, bad.context, { ...bad.call, toolName: 'rental_catalog_search' }, ['order:read'], bad.f.auth, bad.f.guard, bad.core));
    assert.throws(() => createOriginalMcpOrderStatusResources(mcp, bad.context, bad.call, ['ungranted:scope'], bad.f.auth, bad.f.guard, bad.core));
    assert.throws(() => createOriginalMcpOrderStatusResources(mcp, bad.context, bad.call, [], bad.f.auth, bad.f.guard, bad.core));
  }); assert.equal(bad.state.reads.length, 0);
  const cancel = make(), abort = new AbortController();
  cancel.state.afterWorkspace = args => { if (args.select && Object.keys(args.select).length === 1) abort.abort(); };
  await assert.rejects(() => cancel.run((resources, stop) => resources.authorizeResourcesIn(body, cancel.native, stop), abort.signal));
  assert.equal(cancel.state.reads.filter(args => args.include).length, 0, 'cancelled original scope await cannot dispatch aggregate SQL');
  const late = make(); let pending, entered, release;
  const orderEntered = new Promise(resolve => { entered = resolve; });
  late.state.afterOrder = () => { entered(); return new Promise(resolve => { release = resolve; }); };
  await late.run(async (resources, stop) => { pending = resources.authorizeResourcesIn(body, late.native, stop); await orderEntered; });
  const rejected = assert.rejects(pending), lateCount = late.state.reads.length; release(); await rejected;
  assert.equal(late.state.reads.length, lateCount, 'late original Core aggregate cannot continue after its MCP callback ends');
});

test("verification records its real type and external-facade scope", () => {
  fs.writeFileSync(path.join(output, "scope.json"), JSON.stringify({
    strict: "original shared to isolated output and new internal principal contract", apiExecution: "original source transpilation; Nest plumbing and Prisma/current authority external facades",
    nativeEntitlementTypes: require('./fixtures/mcp/original-identity.cjs').nativeEntitlementTypesChecked(),
    nativeEntitlementTypeScope: 'actual reader strict/signature/declaration with named Prisma/service/budget-port type facades; NOT generated Prisma or whole API strict',
    nativeRequestReconcileTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestReconcileTypesChecked(),
    nativeRequestReconcileTypeScope: 'exact shared original-key/body helper plus Native reconcile and legacy wrapper strict/declarations with named external ORM/task-receipt facade; original complete repository runtime transpiled, no DB/commit proof',
    nativeCatalogTypes: require('./fixtures/mcp/original-identity.cjs').nativeCatalogTypesChecked(),
    nativeCatalogTypeScope: 'complete original catalog resources/facts source plus exact config page and Native Core method strict/declarations; named ORM/conversion/workspace-scope/framework facades, complete original runtime sources transpiled, not DB/commit/production proof',
    nativeRequestParticipantTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestParticipantTypesChecked(),
    nativeRequestParticipantTypeScope: 'actual complete participant source plus exact original save/audit/reconcile methods strict/declarations with named external ORM/framework facades; original complete sources runtime transpiled, transaction/commit substitute not DB proof',
    nativeRequestAuditTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestAuditTypesChecked(),
    nativeRequestAuditTypeScope: 'actual save audit source and exact original Native row-observer/OperationLog method strict and declarations with named external ORM/framework/task/candidate facades; complete original sources runtime transpiled, no DB/commit proof',
    nativeRequestSaveTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestSaveTypesChecked(),
    nativeRequestSaveTypeScope: 'exact common load/save methods and Native participant/legacy wrapper plus actual original validator strict/declaration under named ORM/task-access/candidate type facades; complete original class runtime transpiled, not whole API/generated Prisma',
    nativeOrderStatusTypes: require('./fixtures/mcp/original-identity.cjs').nativeOrderStatusTypesChecked(),
    nativeOrderStatusTypeScope: 'actual resource adapter, order/inspection/payment facts and saved-quote source plus exact Core/Business/payment-read/finance-Guard method fragments and query-parser strict with named external row/type declarations; complete original classes runtime transpiled',
    nativeRequestPolicyTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestPolicyTypesChecked(),
    nativeRequestPolicyTypeScope: 'exact original authority/MCP adapter/scope/context strict with named external declarations; actual repository behavior transpiled, not full API/Prisma strict',
    nativeRequestScopeTypes: require('./fixtures/mcp/original-identity.cjs').nativeRequestScopeTypesChecked(),
    nativeRequestScopeTypeScope: 'actual scope source/context/RequestIdentity strict with named ORM/repository/validator/MCP type facades; runtime uses original ScopeRepository and Guard',
    apiStrict: "not verified: original Nest/Prisma dependency and generated-client combination not installed in this tree",
    database: "no real DB, migration, API boot or MCP business publication", sources: [...cache.keys()].map(file => path.relative(root, file))
  }, null, 2));
});
