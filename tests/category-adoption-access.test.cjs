"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHmac } = require("node:crypto");
const { Prisma } = require("@prisma/client");
const { AuthService } = require("../apps/api/dist/modules/auth/auth.service.js");
const { PlatformService } = require("../apps/api/dist/modules/platform/platform.service.js");
const { lockCategoryAdoptionAccess } = require("../apps/api/dist/modules/rental-core/category-adoption-access.js");
const { CategoryAdoptionPreparationService } = require("../apps/api/dist/modules/rental-core/category-adoption-preparation.service.js");
const { writePreparedCategoryAdoptionPhase } = require("../apps/api/dist/modules/rental-core/category-adoption-transaction-phase.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { categoryWorkspaceAuth } = require("./fixtures/category-workspace-auth.cjs");
function fixture() {
  const tx = {}, access = categoryWorkspaceAuth(tx, { tenantId: "tenant", userId: "operator", workspaceId: "space" });
  const user = { id: "operator", tenantId: "tenant", permissions: ["rental-os:category:adopt"], isSaasAdmin: false };
  const lock = (identity = access.identity, actor = user) => runWithRequestIdentity(identity, () => lockCategoryAdoptionAccess(tx, actor, access.auth));
  return { tx, access, user, lock };
}

test("signed access context contributes only the original session id and token expiry", async () => {
  const user = { id: "operator", tenantId: "tenant", isActive: true };
  const platform = { getAuthSession: async () => ({ userId: user.id, audience: "operator", currentWorkspaceId: "space" }),
    findUserById: async () => user, findWorkspaceScopedUser: async () => user };
  const secret = "offline-auth-fixture", auth = new AuthService(platform, { get: () => secret });
  const payload = { sub: user.id, tid: user.tenantId, sid: "session", wid: "space", aud: "operator", exp: Math.floor(Date.now() / 1000) + 300 };
  const token = body => {
    const raw = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify(body)).toString("base64url")}`;
    return `Bearer ${raw}.${createHmac("sha256", secret).update(raw).digest("base64url")}`;
  };
  assert.deepEqual((await auth.resolveAccessContext(token(payload))).accessSession, { sessionId: "session", expiresAt: payload.exp });
  assert.equal(await auth.resolveAccessContext(`${token(payload)}corrupt`), undefined);
  await assert.rejects(auth.resolveAccessContext(token({ ...payload, wid: "other" })), /空间已变化/);
});

test("the principal is mapped from the supplied transaction after ordered locks, including role and permissions", async () => {
  const f = fixture();
  const lease = await f.lock();
  assert.deepEqual(f.access.state.locks, ["Tenant", "User", "auth_sessions", "workspace_members", "UserRole", "Role", "RolePermission", "Permission"]);
  assert.deepEqual(lease.user.permissions, ["rental-os:category:adopt"]);
  assert.equal(lease.user.dataScope, "all");
  await runWithRequestIdentity(f.access.identity, () => lease.revalidate());
});

test("changes committed while waiting for the principal lock are read before granting Rental access", async () => {
  const f = fixture();
  f.access.state.beforeLock = table => { if (table === "Tenant") f.access.state.member.isActive = false; };
  await assert.rejects(f.lock(), /访问权已撤销/);
});

test("live role, membership and tenant restrictions override stale request wildcard permissions", async () => {
  for (const change of [
    f => { f.access.role.permissions = []; },
    f => { f.access.role.isActive = false; },
    f => { f.access.state.member.isActive = false; },
    f => { f.access.state.member.dataScope = "OWN"; },
    f => { f.access.state.member.locationScope = { mode: "selected", locationIds: ["one"] }; },
    f => { f.access.state.member.locationScope = { mode: "invalid" }; },
    f => { f.access.state.user.isSaasAdmin = true; },
    f => { f.access.state.user.mustChangePassword = true; },
    f => { f.access.state.tenantStatus = "FROZEN"; }
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.lock(f.access.identity, { ...f.user, permissions: ["*"] }));
  }
});

test("original session revocation, expiry, audience or workspace changes cannot authorize adoption", async () => {
  for (const change of [
    f => { f.access.state.session.revokedAt = new Date(); },
    f => { f.access.state.session.expiresAt = new Date(0); },
    f => { f.access.state.session.audience = "staff"; },
    f => { f.access.state.session.currentWorkspaceId = "other"; },
    f => { f.access.identity.accessSession.expiresAt = 1; }
  ]) {
    const f = fixture(); change(f); await assert.rejects(f.lock());
  }
});

test("missing original proof, foreign actors, staff requests and memory authorization fail closed", async () => {
  const f = fixture();
  await assert.rejects(f.lock({ ...f.access.identity, accessSession: undefined }), /原认证会话/);
  await assert.rejects(f.lock(f.access.identity, { ...f.user, id: "foreign" }), /操作人与经营空间/);
  await assert.rejects(f.lock({ ...f.access.identity, audience: "staff" }), /运营会话/);
  const memory = new PlatformService({ get: () => "memory" }, {});
  await assert.rejects(runWithRequestIdentity(f.access.identity, () => lockCategoryAdoptionAccess(f.tx, f.user, new AuthService(memory, {}))), /持久化身份/);
  await assert.rejects(runWithRequestIdentity(f.access.identity, () => lockCategoryAdoptionAccess(f.tx, f.user)), /未装配/);
});

test("final revalidation retains the original captured evidence and rejects session expiry", async () => {
  const f = fixture(), scope = { ...f.access.identity };
  await runWithRequestIdentity(scope, async () => {
    const lease = await lockCategoryAdoptionAccess(f.tx, f.user, f.access.auth);
    // Request fields cannot prolong the captured proof or reinterpret the user.
    scope.accessSession = { sessionId: "another", expiresAt: 9999999999 };
    f.access.state.session.expiresAt = new Date(0);
    await assert.rejects(lease.revalidate(), /到期/);
  });
});

test("token expiry during business validation cannot be extended through the request context", async t => {
  const f = fixture(), originalExpiry = f.access.identity.accessSession.expiresAt;
  await runWithRequestIdentity(f.access.identity, async () => {
    const lease = await lockCategoryAdoptionAccess(f.tx, f.user, f.access.auth);
    f.access.identity.accessSession.expiresAt = originalExpiry + 3600;
    t.mock.method(Date, "now", () => originalExpiry * 1000);
    await assert.rejects(lease.revalidate(), /原访问令牌已到期/);
  });
});

test("preparation rollback includes staged data and receipt when final authorization expires; later current access can read the original receipt", async () => {
  const f = fixture(), state = { patches: [], receipts: [], failExpiry: true };
  const db = { $transaction: async run => {
    const before = structuredClone(state);
    try { return await run(f.tx); }
    catch (error) { Object.assign(state, before); throw error; }
  } };
  const service = new CategoryAdoptionPreparationService(db, {}, {}, {}, f.access.auth);
  // Exercise the production transaction owner with real auth mapping. The
  // injected write simulates a preparation/receipt write, not MySQL rollback.
  const save = () => runWithRequestIdentity(f.access.identity, () => service.transaction(f.user, async () => {
    state.patches.push("staged"); state.receipts.push({ result: { id: "original", revision: 1 } });
    if (state.failExpiry) f.access.state.session.expiresAt = new Date(0);
    return "saved";
  }));
  await assert.rejects(save(), /到期/);
  assert.deepEqual(state.patches, []); assert.deepEqual(state.receipts, []);
  f.access.state.session.expiresAt = new Date(Date.now() + 3600000); state.failExpiry = false;
  await save();
  f.tx.rentalCategoryPreparationBatch = { findFirst: async ({ where }) => {
    assert.deepEqual(where, { tenantId: "tenant", workspaceId: "space", actorId: "operator", batchId: "batch-one", preparation: { targetVersionId: "v2" } });
    return state.receipts[0];
  } };
  const read = () => runWithRequestIdentity(f.access.identity, () => service.readBatch(f.user, "v2", "batch-one"));
  assert.deepEqual(await read(), { outcome: "saved", result: { id: "original", revision: 1 } });
  f.access.state.member.isActive = false;
  await assert.rejects(read(), /撤销/);
  assert.equal(state.receipts.length, 1);
  const otherTx = {}, other = categoryWorkspaceAuth(otherTx, { tenantId: "tenant", userId: "another", workspaceId: "space" });
  otherTx.rentalCategoryPreparationBatch = { findFirst: async ({ where }) => {
    assert.equal(where.actorId, "another");
    return null; // The original receipt belongs to operator, not this actor.
  } };
  const otherService = new CategoryAdoptionPreparationService({ $transaction: run => run(otherTx) }, {}, {}, {}, other.auth);
  assert.deepEqual(await runWithRequestIdentity(other.identity, () => otherService.readBatch({ ...f.user, id: "another" }, "v2", "batch-one")), { outcome: "unknown" });
});

test("the internal adoption phase cannot write without an original workspace principal", async () => {
  const f = fixture(); let businessReads = 0;
  f.tx.businessWorkspace = { findFirst: async () => { businessReads++; return {}; } };
  const input = { tenantId: "tenant", workspaceId: "space", actorId: "operator", targetVersionId: "v2", operation: "upgrade",
    expected: { categoryVersionId: "v1", adoptionRevision: 1 }, expectedPreparationRevision: 1 };
  await assert.rejects(runWithRequestIdentity(f.access.identity, () => writePreparedCategoryAdoptionPhase(f.tx, input)), /未装配/);
  await assert.rejects(runWithRequestIdentity(f.access.identity, () => writePreparedCategoryAdoptionPhase(f.tx, { ...input, workspaceId: "foreign" }, undefined, undefined, f.access.auth)), /原会话/);
  assert.equal(businessReads, 0);
});

test("a proven database write conflict is reported for original-key reconciliation without automatic rerun", async () => {
  const f = fixture(); let attempts = 0;
  const db = { $transaction: async () => {
    attempts++;
    throw new Prisma.PrismaClientKnownRequestError("transaction aborted", { code: "P2034", clientVersion: "offline" });
  } };
  const service = new CategoryAdoptionPreparationService(db, {}, {}, {}, f.access.auth);
  await assert.rejects(runWithRequestIdentity(f.access.identity, () => service.transaction(f.user, async () => "unused")), error => {
    assert.equal(error.getStatus(), 409); assert.match(error.message, /保留原操作键/); return true;
  });
  assert.equal(attempts, 1);
});
