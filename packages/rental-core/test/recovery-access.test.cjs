"use strict";
/** Actual Guard, Auth/current principal, handler policy, application fence and
 * original idempotent executor. Row delegates are offline fixtures, never a DB. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRentalApplicationAccess, createRentalRecoveryAuthority } = require("../dist/application-access.js");
const { RentalAuthService } = require("../dist/auth-service.js");
const { ClientAuthService } = require("../dist/mysql-client-auth.js");
const { createHmac } = require("node:crypto");
const { RentalWorkspacePrincipalRepository } = require("../dist/mysql-workspace-principal.js");
const { RentalCoreFactRepository } = require("../dist/mysql-core-facts.js");
const { RentalIdempotentActionService } = require("../dist/mysql-idempotent-actions.js");
const { RentalBusinessService } = require("../dist/mysql-business-runtime.js");
const { RentalCoreController } = require("../dist/http-core.controller.js");
const { ClientApiController } = require("../dist/http-client.controller.js");
const { PaymentOperationsController } = require("../dist/http-payment-operations.controller.js");
const { createRentalAuthorization } = require("../dist/http-auth.js");
const { compileRentalHttpAccessPolicy } = require("../dist/http-access-policy.js");
const { bindRentalRecovery } = require("../dist/application-recovery-policy.js");
const { lockRentalBusinessTenant, assertRentalBusinessOperationAccessAfterLock } = require("../dist/mysql-business-fence.js");
const { requestFingerprint } = require("../dist/mysql-idempotency.js");
const { runWithRequestIdentity, getRequestWorkspaceId } = require("@rental-os/platform-server/request-identity");
const shared = require("@rental-os/shared");
const authorization = createRentalAuthorization(shared);
const policy = compileRentalHttpAccessPolicy({ controllers: [RentalCoreController, ClientApiController, PaymentOperationsController], authorization });
const copy = value => structuredClone(value);

function fixture(audience = "operator") {
  const user = { id: "user", tenantId: "tenant", isActive: true, isSaasAdmin: false, isPlatformAdmin: false,
    mustChangePassword: false, displayName: "member", account: "member", permissions: ["rental-os:order:view", "rental-os:order:operate",
      "rental-os:order:settle", "rental-os:order:cancel", "rental-os:finance:view", "rental-os:finance:reconcile"],
    roleIds: [], roleNames: [], dataScope: "all", locationScope: { mode: "all", locationIds: [] } };
  const state = { user, tenantStatus: "ACTIVE", workspaceStatus: "ACTIVE", assigned: true, grant: "disabled", binding: true,
    available: true, member: true, session: { audience: "operator", currentWorkspaceId: "workspace", revokedAt: null,
      expiresAt: new Date(Date.now() + 600000) },
    order: { id: "OrderA", tenantId: "tenant", workspaceId: "workspace", status: "RENTING", customerId: "customer",
      membershipSnapshot: null, createdBy: "user", fulfillmentLocationId: "location", returnLocationId: "location" },
    intent: { id: "IntentA", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA" },
    refund: { id: "RefundA", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA", paymentIntentId: "IntentA" },
    clientSession: { id: "client-session", tenantId: "tenant", customerId: "customer", workspaceId: "workspace", revokedAt: null,
      expiresAt: new Date(Date.now() + 600000), createdAt: new Date(Date.now() - 1000), wechatIdentityId: null },
    account: { id: "account", status: "active", passwordUpdatedAt: null, mustChangePassword: false },
    membership: { id: "membership", status: "active" } };
  const trace = [], receipts = new Map();
  const f = { state, trace, writes: 0, dispatches: 0, reads: 0, onQuery: undefined };
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every(item => matches(row, item));
    if (key === "OR") return value.some(item => matches(row, item));
    if (key === "workOrders") return false;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const readOrder = async ({ where }) => { f.reads++; return matches(state.order, where) ? copy(state.order) : null; };
  const noWrite = async () => { throw Error("unexpected identity write"); };
  const delegates = {
    user: { findFirst: async () => copy(state.user), findUnique: async () => copy(state.user),
      findUniqueOrThrow: async () => copy(state.user), update: noWrite },
    authSession: { findFirst: async ({ where }) => state.session.revokedAt === null && state.session.expiresAt > where.expiresAt.gt
      ? copy(state.session) : null, create: noWrite, updateMany: noWrite },
    workspaceMember: { findFirst: async () => state.member && state.workspaceStatus === "ACTIVE"
      ? { role: null, dataScope: null, locationScope: copy(state.user.locationScope) } : null },
    businessWorkspace: { findFirst: async () => state.workspaceStatus === "ACTIVE" ? { id: "workspace" } : null },
    organizationUnit: { findMany: async () => [{ id: "org", parentId: null, status: "enabled" }] },
    rentalFulfillmentLocation: { findMany: async () => [{ id: "location" }] },
    rentalOrder: { findFirst: readOrder },
    clientAuthSession: { findFirst: async ({ where }) => matches(state.clientSession, where) ? copy({ ...state.clientSession,
      customer: { id: "customer", status: "active", name: "customer", phone: "synthetic", customerType: "personal" },
      workspace: { id: "workspace", tenantId: "tenant", status: state.workspaceStatus, code: "main", name: "space", categoryCode: "camping" },
      tenant: { code: "merchant", status: state.tenantStatus } }) : null, updateMany: async () => ({ count: 1 }) },
    customerAccount: { findFirst: async () => copy({ ...state.account, customer: { status: "active" } }) },
    customerMembership: { findFirst: async () => ["exited", "closed"].includes(state.membership.status) ? null : copy(state.membership) }
  };
  let sequence = 0;
  const db = { ...delegates, async $transaction(consume, options) {
    assert.equal(options?.isolationLevel, "ReadCommitted");
    const number = ++sequence, initialWrites = f.writes;
    const tx = { ...delegates, async $queryRaw(query) {
      const text = query.sql.replace(/\s+/gu, " ").trim();
      trace.push({ tx: number, text });
      await f.onQuery?.(text, number);
      if (/FROM Tenant /u.test(text)) return [{ id: "tenant", status: state.tenantStatus }];
      if (text.includes("FROM `User`")) return [{ id: "user", roleId: null }];
      if (text.includes("FROM auth_sessions")) return [{ id: "session" }];
      if (text.includes("FROM workspace_members")) return state.member ? [{ roleId: null }] : [];
      if (text.includes("FROM `UserRole`")) return [];
      if (text.includes("customer_profiles")) return [{ id: "customer" }];
      if (text.includes("customer_accounts")) return [{ id: "account" }];
      if (text.includes("client_auth_sessions")) return [{ id: "client-session" }];
      if (text.includes("customer_memberships")) return [{ id: "membership" }];
      if (text.includes("platform_core_access_locks")) return [{ tenantId: "tenant", coreId: "rental" }];
      if (text.includes("platform_tenant_core_grants")) return state.grant ? [{ state: state.grant, revision: 1, operationId: "grant" }] : [];
      if (text.includes("platform_member_core_assignments")) return [{ state: state.assigned ? "assigned" : "unassigned", revision: 1, operationId: "assignment" }];
      if (text.includes("platform_core_bindings")) return state.binding ? [{ bindingId: "binding", revision: 1,
        dataVersion: "0.1.0", containerType: "rental-workspace", containerId: "workspace" }] : [];
      if (text.includes("business_workspaces")) return [{ id: "workspace", status: state.workspaceStatus }];
      if (/FROM `?rental_orders`?/u.test(text)) {
        return query.values.includes(state.order.id) && query.values.includes(state.order.workspaceId)
          ? [{ id: state.order.id, workspaceId: state.order.workspaceId }] : [];
      }
      if (text.includes("rental_allocations")) return [];
      if (text.includes("rental_payment_intents")) return query.values.includes(state.intent.id)
        && query.values.includes(state.intent.orderId) ? [{ id: state.intent.id }] : [];
      if (text.includes("rental_payment_refunds")) return query.values.includes(state.refund.id)
        && query.values.includes(state.refund.orderId) && query.values.includes(state.refund.paymentIntentId) ? [{ id: state.refund.id }] : [];
      throw Error(`unexpected SQL ${text}`);
    } };
    try { return await consume(tx); } catch (error) { f.writes = initialWrites; throw error; }
  } };
  const principal = new RentalWorkspacePrincipalRepository(db, { findUserById: async () => copy(state.user),
    projectWorkspace: row => row, projectRoleScope: scope => scope.toLowerCase(), projectDataScope: scope => scope.toLowerCase() });
  const auth = new RentalAuthService({ lockWorkspaceSessionUser: principal.lockWorkspaceSessionUser.bind(principal),
    readWorkspaceSessionUser: principal.readWorkspaceSessionUser.bind(principal) }, { get: () => undefined });
  // Only initial signed transport is a fixture. Current request leases below run
  // the real Auth and original principal/role/session implementation.
  auth.resolveAccessContext = async (_token, { audience }) => ({ user: copy(state.user), tenantUser: copy(state.user),
    workspaceId: "workspace", hasWorkspaces: true, workspaceValid: true,
    accessSession: { sessionId: "session", expiresAt: Math.floor(Date.now() / 1000) + 60 } });
  const clientAuth = new ClientAuthService(db, {}, {}, {});
  clientAuth.secret = () => "synthetic-client-test-secret";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ typ: "client", tid: "tenant", sub: "customer", sid: "client-session", wid: "workspace",
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", "synthetic-client-test-secret:client").update(`${header}.${payload}`).digest("base64url");
  const guard = new authorization.Guard(auth, undefined, clientAuth, { assertAllowed: async () => {} }, db);
  const access = createRentalApplicationAccess({ database: db, authorization,
    recoveryAuthority: createRentalRecoveryAuthority({ auth, clientAuth }),
    deploymentForTransaction: () => ({ requireAvailable: async () => { if (!state.available) throw Error("unavailable deployment"); } }),
    term: { requireNewBusiness: async () => {} } });
  const idempotent = new RentalIdempotentActionService(db, { find: async (_tenant, _action, key) => receipts.get(key),
    record: async value => receipts.set(value.key, copy(value)) });
  const facts = Object.create(RentalCoreFactRepository.prototype);
  facts.contacts = { getRequestWorkspaceId };
  f.run = (handler, method, url, consume, controller = RentalCoreController, mutateBeforeAdmission) => runWithRequestIdentity({}, () => access.run(async () => {
    const request = { method, url, headers: { authorization: audience === "client" ? `Bearer ${header}.${payload}.${signature}` : "fixture-original-token" } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
    const route = policy.requireHandler(controller, controller.prototype[handler], request);
    mutateBeforeAdmission?.(request, route);
    return access.withRequest(request, () => consume(request, route), route.review.kind === "buffered-read" ? { bufferedRead: true }
      : route.review.kind === "maintained-read" ? { maintainedRead: true } : route.review.kind === "audited-read" ? { auditedRead: true } : undefined, route.recovery);
  }));
  f.action = overrides => idempotent.executeWithReplayFlag({ tenantId: "tenant", action: "order.settle", key: "original-key",
    fallbackKey: "original-key", orderId: "OrderA", request: { orderId: "OrderA" },
    run: async tx => { await facts.lockOrder("tenant", "OrderA", tx); f.writes++; return { original: "receipt" }; },
    replay: async response => response, ...overrides });
  return Object.assign(f, { db, access, idempotent, facts, receipts });
}

test("disabled history uses actual original handler and current principal, with Tenant→Core→Order→Workspace", async () => {
  const f = fixture();
  assert.deepEqual(await f.run("order", "GET", "/api/rental/v1/orders/OrderA", async () => ({ id: "OrderA" })), { id: "OrderA" });
  for (const tx of new Set(f.trace.map(row => row.tx))) {
    const rows = f.trace.filter(row => row.tx === tx).map(row => row.text);
    assert.match(rows[0], /FROM Tenant .* FOR UPDATE$/u);
    assert.ok(rows.findIndex(row => row.includes("auth_sessions")) < rows.findIndex(row => row.includes("platform_core_access_locks")));
    assert.ok(rows.findIndex(row => row.includes("platform_core_access_locks")) < rows.findIndex(row => row.includes("rental_orders")));
    assert.ok(rows.findIndex(row => row.includes("rental_orders")) < rows.findIndex(row => row.includes("business_workspaces")));
  }
  assert.equal(f.writes, 0);
});

test("disabled settlement keeps original idempotent execution and exactly one original receipt", async () => {
  const f = fixture();
  assert.deepEqual(await f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.action()), { result: { original: "receipt" }, replayed: false });
  assert.deepEqual(await f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.action()), { result: { original: "receipt" }, replayed: true });
  assert.equal(f.writes, 1);
});

test("original expiry returns its committed receipt when later full cache refresh is unavailable", async () => {
  const f = fixture(), failedRead = async () => { throw Error("later cache read is unavailable"); };
  const business = new RentalBusinessService({ loadWorkspaceSnapshot: failedRead, loadAll: failedRead }, { loadAll: failedRead },
    { loadWorkspaceSnapshot: failedRead, loadAll: failedRead });
  const controller = Object.create(RentalCoreController.prototype);
  controller.business = business;
  controller.idempotent = f.idempotent;
  controller.service = { expirePendingOrder: async (tenantId, orderId, tx) => {
    await f.facts.lockOrder(tenantId, orderId, tx);
    f.writes++;
    f.state.session.revokedAt = new Date();
    return { id: orderId, status: "cancelled" };
  }, persist: async () => {} };
  controller.releaseCancelledOrderResources = async () => {};
  controller.emitOrderEvent = async () => [];
  controller.context = failedRead;
  assert.deepEqual(await f.run("expirePendingOrder", "POST", "/rental/v1/orders/OrderA/expire-pending",
    request => controller.expirePendingOrder(request, "OrderA")), { id: "OrderA", status: "cancelled" });
  assert.equal(f.writes, 1);
  // Explicit full refresh remains real, and the legacy non-normalized host still
  // uses its original refresh path. Only acknowledged order cache publication skips.
  await assert.rejects(business.refreshFromDatabase(), /later cache read/);
  const legacy = new RentalBusinessService({ loadAll: failedRead }, { loadAll: failedRead }, { loadAll: failedRead });
  await assert.rejects(legacy.refreshFromDatabase("committed_order"), /later cache read/);
});

test("new commitments have no recovery declaration and cannot execute while disabled", async () => {
  const f = fixture();
  for (const [handler, path] of [["confirm", "/rental/v1/orders/OrderA/confirm"], ["applyExtension", "/rental/v1/orders/OrderA/extensions"],
    ["applyPostPickupExchange", "/rental/v1/orders/OrderA/changes/post-pickup-exchange"]]) {
    await assert.rejects(f.run(handler, "POST", path, async () => { f.writes++; }));
    assert.equal(policy.requireHandler(RentalCoreController, RentalCoreController.prototype[handler], { method: "POST", url: path }).recovery, undefined);
  }
  assert.equal(f.writes, 0);
});

test("revoked member, session, permissions or Core assignment fail before the original action", async () => {
  for (const change of [f => { f.state.member = false; }, f => { f.state.session.revokedAt = new Date(); },
    f => { f.state.session.currentWorkspaceId = "other"; }, f => { f.state.user.permissions = []; },
    f => { f.state.assigned = false; }, f => { f.state.user.mustChangePassword = true; }]) {
    const f = fixture();
    await assert.rejects(f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.action(), RentalCoreController, () => change(f)));
    assert.equal(f.writes, 0);
  }
});

test("frozen tenant/workspace, missing grant/binding and unavailable deployment stay closed", async () => {
  for (const [key, value] of [["tenantStatus", "FROZEN"], ["workspaceStatus", "DISABLED"], ["grant", null], ["binding", false], ["available", false]]) {
    const f = fixture(); f.state[key] = value;
    await assert.rejects(f.run("order", "GET", "/rental/v1/orders/OrderA", async () => { f.reads++; }));
    assert.equal(f.writes, 0);
  }
});

test("revocation while awaiting the original parent is visible before writes", async () => {
  const f = fixture(); let parents = 0;
  f.onQuery = async text => { if (/FROM Tenant .* FOR UPDATE$/u.test(text) && ++parents === 2) f.state.session.revokedAt = new Date(); };
  await assert.rejects(f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.action()));
  assert.equal(f.writes, 0);
});

test("a buffered history read is denied if the member loses access before return", async () => {
  const f = fixture();
  await assert.rejects(f.run("order", "GET", "/rental/v1/orders/OrderA", async () => { f.state.member = false; return { private: true }; }));
});

test("an acknowledged business commit returns its original receipt without a post-commit admission", async () => {
  const f = fixture();
  const result = await f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", async () => {
    const original = await f.action(); f.state.member = false; return original;
  });
  assert.equal(result.replayed, false); assert.equal(f.writes, 1);
});

test("read-only replay rechecks revocation and cannot run the command again", async () => {
  const f = fixture(); f.receipts.set("original-key", { requestHash: requestFingerprint({ orderId: "OrderA" }), orderId: "OrderA", response: { original: "receipt" } });
  await assert.rejects(f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.action({ replay: async value => { f.state.member = false; return value; } })));
  assert.equal(f.writes, 0);
});

test("the original fact lock cannot switch to another order inside an admitted recovery", async () => {
  const f = fixture();
  await assert.rejects(f.run("settle", "POST", "/rental/v1/orders/OrderA/settle", () => f.db.$transaction(async tx => {
    await lockRentalBusinessTenant(tx, "tenant");
    await assertRentalBusinessOperationAccessAfterLock(tx, "tenant", "workspace", "other-order"); f.writes++;
  }, { isolationLevel: "ReadCommitted" })));
  assert.equal(f.writes, 0);
});

test("original current location and own predicates still constrain historical objects", async () => {
  const f = fixture(); f.state.user.dataScope = "own"; f.state.order.createdBy = "other";
  await assert.rejects(f.run("order", "GET", "/rental/v1/orders/OrderA", async () => ({ private: true })));
  assert.equal(f.writes, 0);
});

test("draft history remains readable but cannot become fulfillment", async () => {
  const f = fixture(); f.state.order.status = "DRAFT";
  await f.run("order", "GET", "/rental/v1/orders/OrderA", async () => ({ draft: true }));
  await assert.rejects(f.run("allocate", "POST", "/rental/v1/orders/OrderA/allocate", async () => { f.writes++; }));
  assert.equal(f.writes, 0);
});

test("payment recovery binds the exact original intent and refund before dispatch", async () => {
  const f = fixture();
  const run = () => f.run("refreshPaymentRefund", "POST", "/rental/v1/orders/OrderA/payment-intents/IntentA/refunds/RefundA/refresh",
    async () => { f.dispatches++; return { original: "provider-result" }; }, PaymentOperationsController);
  await run(); assert.equal(f.dispatches, 1);
  f.state.refund.paymentIntentId = "other";
  await assert.rejects(run()); assert.equal(f.dispatches, 1);
});

test("route tickets preserve identifier case and reject clones, paths, encoded separators and unknown stages", () => {
  const route = policy.requireHandler(RentalCoreController, RentalCoreController.prototype.handover,
    { method: "POST", url: "/rental/v1/orders/OrderA/handover/pickup" });
  assert.equal(bindRentalRecovery(route.recovery, { method: "POST", url: "/API/RENTAL/v1/orders/OrderA/handover/pickup/" }).orderId, "OrderA");
  for (const [ticket, url] of [[{ ...route.recovery }, "/rental/v1/orders/OrderA/handover/pickup"],
    [route.recovery, "/rental/v1/orders/OrderA/confirm"], [route.recovery, "/rental/v1/orders/Order%2fA/handover/pickup"],
    [route.recovery, "/rental/v1/orders/OrderA/handover/unknown"]]) assert.throws(() => bindRentalRecovery(ticket, { method: "POST", url }));
});

test("actual ClientAuth and Guard preserve only the original customer's order under disabled Core", async () => {
  const f = fixture("client");
  await f.run("orderDetail", "GET", "/client/v1/orders/OrderA", async () => ({ id: "OrderA" }), ClientApiController);
  f.state.order.customerId = "corporate"; f.state.order.membershipSnapshot = { personalCustomerId: "customer" };
  await f.run("orderDetail", "GET", "/client/v1/orders/OrderA", async () => ({ id: "OrderA" }), ClientApiController);
  f.state.order.membershipSnapshot.personalCustomerId = "colleague";
  await assert.rejects(f.run("orderDetail", "GET", "/client/v1/orders/OrderA", async () => ({ private: true }), ClientApiController));
  assert.ok(!f.trace.some(row => row.text.includes("platform_member_core_assignments")));
});

test("client withdrawal/password change during wait denies recovery and a cloned context is not a lease", async () => {
  for (const change of [f => { f.state.membership.status = "exited"; }, f => { f.state.account.passwordUpdatedAt = new Date(); },
    f => { f.state.clientSession.revokedAt = new Date(); }]) {
    const f = fixture("client");
    await assert.rejects(f.run("cancelOrder", "POST", "/client/v1/orders/OrderA/cancel", () => f.action(), ClientApiController, () => change(f)));
    assert.equal(f.writes, 0);
  }
  const f = fixture("client");
  await assert.rejects(f.run("orderDetail", "GET", "/client/v1/orders/OrderA", async () => null,
    ClientApiController, request => { request.client = { ...request.client }; }));
});
