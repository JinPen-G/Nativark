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
const { RentalBusinessController } = require("../dist/http-business.controller.js");
const { ClientApiController } = require("../dist/http-client.controller.js");
const { PaymentOperationsController } = require("../dist/http-payment-operations.controller.js");
const { PaymentReconciliationController } = require("../dist/http-payment-reconciliation.controller.js");
const { EnterpriseWorkflowsController } = require("../dist/http-enterprise-workflows.controller.js");
const { RentalExchangeInspectionPreparationService } = require("../dist/mysql-exchange-inspection-preparation.js");
const { RentalExchangeInspectionMediaService } = require("../dist/mysql-exchange-inspection-media.js");
const { RentalExchangeInspectionConsentService } = require("../dist/mysql-exchange-inspection-consent.js");
const { EnterpriseExchangeApprovalService } = require("../dist/mysql-enterprise-exchange-approval.js");
const { EnterpriseCommandService } = require("../dist/mysql-enterprise-command.js");
const { ClientApiService } = require("../dist/mysql-client-application.js");
const { RentalWorkspaceReportRepository } = require("../dist/mysql-reports.js");
const { PaymentReconciliationFileService } = require("../dist/mysql-payment-reconciliation-file.js");
const { createRentalNativeResponseBuffer } = require("../dist/http-native-response.js");
const { sqltag: sql } = require("@prisma/client/runtime/library");
const { createRentalAuthorization } = require("../dist/http-auth.js");
const { compileRentalHttpAccessPolicy } = require("../dist/http-access-policy.js");
const { bindRentalRecovery, declareRentalRecovery } = require("../dist/application-recovery-policy.js");
const { lockRentalBusinessTenant, assertRentalBusinessOperationAccessAfterLock } = require("../dist/mysql-business-fence.js");
const { requestFingerprint } = require("../dist/mysql-idempotency.js");
const { runWithRequestIdentity, getRequestWorkspaceId, getRequestIdentity } = require("@rental-os/platform-server/request-identity");
const shared = require("@rental-os/shared");
const authorization = createRentalAuthorization(shared);
const policy = compileRentalHttpAccessPolicy({ controllers: [RentalCoreController, RentalBusinessController, ClientApiController, PaymentOperationsController,
  EnterpriseWorkflowsController, PaymentReconciliationController], authorization });
const copy = value => structuredClone(value);

function fixture(audience = "operator") {
  const user = { id: "user", tenantId: "tenant", isActive: true, isSaasAdmin: false, isPlatformAdmin: false,
    mustChangePassword: false, displayName: "member", account: "member", permissions: ["rental-os:order:view", "rental-os:order:operate",
      "rental-os:order:settle", "rental-os:order:cancel", "rental-os:finance:view", "rental-os:finance:reconcile", "rental-os:report:view"],
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
  const f = { state, trace, writes: 0, dispatches: 0, reads: 0, onQuery: undefined, originalQuery: undefined };
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
  const db = { ...delegates, async $queryRaw(query, ...values) {
    const statement = Array.isArray(query) ? sql(query, ...values) : query;
    const result = await f.originalQuery?.(statement.sql.replace(/\s+/gu, " ").trim(), statement.values);
    if (result === undefined) throw Error(`unexpected original read ${statement.sql}`);
    return result;
  }, async $transaction(consume, options) {
    assert.equal(options?.isolationLevel, "ReadCommitted");
    const number = ++sequence, initialWrites = f.writes;
    const tx = { ...delegates, async $queryRaw(query, ...values) {
      if (Array.isArray(query)) query = sql(query, ...values);
      const text = query.sql.replace(/\s+/gu, " ").trim();
      trace.push({ tx: number, text });
      await f.onQuery?.(text, number);
      const original = await f.originalQuery?.(text, query.values);
      if (original !== undefined) return original;
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
          ? [copy(state.order)] : [];
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
  return Object.assign(f, { db, access, idempotent, facts, receipts, auth, clientAuth });
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

test("the nine history handlers bind exact own-order or workspace subjects; adjacent commands remain closed", () => {
  const routes = [
    [RentalCoreController, "originalExchangeInspectionMedia", "/rental/v1/orders/OrderA/exchange-inspection/media/operations/original-key", "order"],
    [RentalCoreController, "readExchangeInspection", "/rental/v1/orders/OrderA/exchange-inspection/preparations/preparation", "order"],
    [RentalCoreController, "originalExchangeInspection", "/rental/v1/orders/OrderA/exchange-inspection/operations/original-key", "order"],
    [EnterpriseWorkflowsController, "exchangeInspectionConsentOriginal", "/client/v1/enterprise/orders/OrderA/exchange-inspection-consents/operations/original-key", "order"],
    [EnterpriseWorkflowsController, "orderExchangeApprovals", "/client/v1/enterprise/orders/OrderA/exchange-approvals", "order"],
    [RentalCoreController, "operationReport", "/rental/v1/reports/operations", "workspace-history"],
    [RentalCoreController, "exportOperationReport", "/rental/v1/reports/operations/export", "workspace-history"],
    [PaymentReconciliationController, "listStatements", "/rental/v1/payment-reconciliation/statements", "workspace-history"],
    [PaymentReconciliationController, "getStatement", "/rental/v1/payment-reconciliation/statements/BatchA", "workspace-history"]
  ];
  for (const [controller, handler, url, scope] of routes) {
    const route = policy.requireHandler(controller, controller.prototype[handler], { method: "GET", url });
    const subject = bindRentalRecovery(route.recovery, { method: "GET", url });
    assert.equal(subject.declaration.scope, scope);
    assert.equal(subject.declaration.kind, "history");
    assert.equal(subject.orderId, scope === "order" ? "OrderA" : undefined);
    assert.throws(() => bindRentalRecovery(route.recovery, { method: "POST", url }));
    assert.throws(() => bindRentalRecovery({ ...route.recovery }, { method: "GET", url }));
    if (scope === "order") assert.throws(() => bindRentalRecovery(route.recovery, { method: "GET", url: url.replace("OrderA", "Order%2fA") }));
  }
  assert.equal(policy.routes.filter(route => route.recovery).length, 70);
  for (const [controller, handler] of [[RentalCoreController, "prepareExchangeInspection"], [RentalCoreController, "completeExchangeInspectionMedia"],
    [EnterpriseWorkflowsController, "confirmExchangeInspection"], [EnterpriseWorkflowsController, "exchangeInspectionMaterial"],
    [PaymentReconciliationController, "importStatement"], [PaymentReconciliationController, "reviewStatementLine"], [PaymentReconciliationController, "reconcile"]]) {
    assert.equal(policy.routes.find(route => route.controller === controller && route.handlerName === handler).recovery, undefined);
  }
  for (const path of ["/client/v1/enterprise/orders/:orderid/exchange-approvals/execute",
    "/client/v1/enterprise/corporates/:corporateid/orders", "/rental/v1/reports/other"]) {
    assert.throws(() => declareRentalRecovery("GET", path, "history"));
  }
  assert.throws(() => declareRentalRecovery("POST", "/rental/v1/payment-reconciliation/statements", "history"));
  assert.throws(() => declareRentalRecovery("GET", "/rental/v1/reports/operations", "settlement"));
});

test("actual original inspection readers preserve the stored preparation and never create missing evidence", async () => {
  const f = fixture(), controller = Object.create(RentalCoreController.prototype);
  const core = { lockOrderForUpdate: async (tenantId, orderId, tx) => { await f.facts.lockOrder(tenantId, orderId, tx); return copy(f.state.order); } };
  const inspections = new RentalExchangeInspectionPreparationService(f.db, core, {}, f.idempotent, f.auth);
  controller.exchangeInspections = inspections;
  controller.exchangeInspectionMedia = new RentalExchangeInspectionMediaService(f.db, inspections, {});
  const preparation = { id: "preparation", orderId: "OrderA", workspaceId: "workspace", actorUserId: "user", operationKey: "original-key",
    requestHash: "original-request", state: "prepared", revision: 1, customerConsent: "not_connected", execution: "not_connected",
    templates: [{ side: "original_return", template: { id: "original-template", version: "old" } }], inspections: [{ results: { accepted: true } }], exceptions: [] };
  f.originalQuery = async (text, values) => {
    if (text.includes("FROM rental_exchange_inspection_media")) return [];
    if (text.includes("FROM rental_exchange_inspection_preparations")) {
      assert.ok(values.includes("user") && values.includes("tenant") && values.includes("workspace"));
      return [{ ...preparation, tenantId: "tenant", payload: copy(preparation), payloadHash: requestFingerprint(preparation) }];
    }
  };
  assert.deepEqual(await f.run("originalExchangeInspectionMedia", "GET", "/rental/v1/orders/OrderA/exchange-inspection/media/operations/missing",
    request => controller.originalExchangeInspectionMedia(request, "OrderA", "missing")), { state: "not_recorded", retryable: false });
  assert.deepEqual(await f.run("originalExchangeInspection", "GET", "/rental/v1/orders/OrderA/exchange-inspection/operations/original-key",
    request => controller.originalExchangeInspection(request, "OrderA", "original-key")), { state: "observed", preparation, retryable: false });
  assert.deepEqual(await f.run("readExchangeInspection", "GET", "/rental/v1/orders/OrderA/exchange-inspection/preparations/preparation",
    request => controller.readExchangeInspection(request, "OrderA", "preparation")), preparation);
  f.state.order.workspaceId = "other-workspace";
  await assert.rejects(f.run("readExchangeInspection", "GET", "/rental/v1/orders/OrderA/exchange-inspection/preparations/preparation",
    request => controller.readExchangeInspection(request, "OrderA", "preparation")));
  assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
});

test("enterprise history executes the original consent and own-order readers, never an administrator projection", async () => {
  const f = fixture("client"), controller = Object.create(EnterpriseWorkflowsController.prototype);
  controller.exchangeInspections = new RentalExchangeInspectionConsentService(f.db, f.idempotent, f.clientAuth);
  const client = Object.create(ClientApiService.prototype);
  client.core = { getOrder: async (tenantId, orderId) => {
    assert.equal(tenantId, "tenant"); assert.equal(orderId, "OrderA");
    return { ...copy(f.state.order), lines: [], chargeLines: [] };
  } };
  controller.exchanges = new EnterpriseExchangeApprovalService(f.db, new EnterpriseCommandService(f.db), {}, {}, {}, {}, client, f.auth);
  f.originalQuery = async (text, values) => {
    if (text.includes("FROM customer_profiles p")) return f.state.account.status === "active" && !f.state.clientSession.revokedAt
      && !["exited", "closed"].includes(f.state.membership.status) ? [{ id: "customer" }] : [];
    if (text.includes("FROM rental_exchange_inspection_consents") || text.includes("FROM enterprise_exchange_approvals")) {
      assert.ok(values.includes("tenant") && values.includes("workspace") && values.includes("customer")); return [];
    }
  };
  f.state.order.customerId = "corporate"; f.state.order.membershipSnapshot = { personalCustomerId: "customer" };
  const consent = () => f.run("exchangeInspectionConsentOriginal", "GET", "/client/v1/enterprise/orders/OrderA/exchange-inspection-consents/operations/missing",
    request => controller.exchangeInspectionConsentOriginal(request, "OrderA", "missing"), EnterpriseWorkflowsController);
  const approvals = () => f.run("orderExchangeApprovals", "GET", "/client/v1/enterprise/orders/OrderA/exchange-approvals",
    request => controller.orderExchangeApprovals(request, "OrderA"), EnterpriseWorkflowsController);
  assert.deepEqual(await consent(), { state: "not_recorded", retryable: false });
  assert.deepEqual(await approvals(), []);
  f.state.order.membershipSnapshot.personalCustomerId = "colleague";
  await assert.rejects(consent()); await assert.rejects(approvals());
  f.state.order.membershipSnapshot.personalCustomerId = "customer";
  await assert.rejects(f.run("orderExchangeApprovals", "GET", "/client/v1/enterprise/orders/OrderA/exchange-approvals", async request => {
    const result = await controller.orderExchangeApprovals(request, "OrderA"); f.state.clientSession.revokedAt = new Date(); return result;
  }, EnterpriseWorkflowsController));
  assert.ok(!f.trace.some(row => row.text.includes("platform_member_core_assignments")));
  assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
});

function reportsFixture(f) {
  const rows = [
    { id: "history", tenantId: "tenant", workspaceId: "workspace", status: "COMPLETED", fulfillmentLocationId: "location", rentalAmount: 120, finalPayableAmount: 100 },
    { id: "other-location", tenantId: "tenant", workspaceId: "workspace", status: "COMPLETED", fulfillmentLocationId: "other", rentalAmount: 800, finalPayableAmount: 800 },
    { id: "other-space", tenantId: "tenant", workspaceId: "other", status: "COMPLETED", rentalAmount: 900, finalPayableAmount: 900 },
    { id: "other-tenant", tenantId: "other", workspaceId: "workspace", status: "COMPLETED", rentalAmount: 900, finalPayableAmount: 900 },
    { id: "draft", tenantId: "tenant", workspaceId: "workspace", status: "DRAFT", rentalAmount: 900, finalPayableAmount: 900 }
  ].map(row => ({ customerId: "customer", customerName: "historical customer", customerType: "personal", fulfillmentLocationName: "original location",
    discountAmount: 20, couponAmount: 0, taxAmount: 0, startAt: new Date("2020-01-01"), endAt: new Date("2020-01-02"), chargeLines: [], ...row }));
  const queries = [], matches = (row, where) => Object.entries(where).every(([key, value]) => key === "AND" ? value.every(part => matches(row, part))
    : value && typeof value === "object" ? "not" in value ? row[key] !== value.not : value.in.includes(row[key]) : row[key] === value);
  const select = where => { queries.push(copy(where)); return rows.filter(row => matches(row, where)); };
  const sums = rows => Object.fromEntries(["rentalAmount", "discountAmount", "couponAmount", "finalPayableAmount", "taxAmount"].map(key => [key, rows.reduce((total, row) => total + row[key], 0)]));
  const store = { rentalOrder: {
    findMany: async ({ where }) => select(where),
    aggregate: async ({ where }) => ({ _sum: sums(select(where)) }),
    groupBy: async ({ where, by }) => {
      const groups = new Map();
      for (const row of select(where)) { const key = JSON.stringify(by.map(key => row[key])); groups.set(key, [...(groups.get(key) ?? []), row]); }
      return [...groups.values()].map(group => ({ ...Object.fromEntries(by.map(key => [key, group[0][key]])), _count: { _all: group.length }, _sum: sums(group) }));
    }
  }, rentalAsset: { groupBy: async ({ where }) => { queries.push(copy(where)); return []; } },
  rentalStockBalance: { aggregate: async ({ where }) => { queries.push(copy(where)); return { _sum: {} }; } } };
  const controller = Object.create(RentalCoreController.prototype);
  controller.prisma = f.db;
  controller.service = { getProfile: async () => ({ categoryCode: "camping" }), getBusinessSettings: async () => ({ pricing: { currency: "CNY" } }) };
  controller.workspaceReports = new RentalWorkspaceReportRepository(store);
  return { controller, queries };
}

test("disabled workspace report and CSV consume the original repository and preserve location and tenant filters", async () => {
  const f = fixture(); f.state.user.locationScope = { mode: "selected", locationIds: ["location"] };
  const { controller, queries } = reportsFixture(f);
  const report = await f.run("operationReport", "GET", "/rental/v1/reports/operations?workspaceId=other",
    request => controller.operationReport(request));
  assert.equal(report.workspaceId, "workspace"); assert.equal(report.orderCount, 1);
  assert.equal(report.rentalRevenue, 120); assert.equal(report.receivableTotal, 100);
  assert.equal(report.historicalCaliberGaps.length, 3);
  const headers = [], response = { setHeader: (...args) => headers.push(args) }, buffer = createRentalNativeResponseBuffer(response);
  const csv = await buffer.run(() => f.run("exportOperationReport", "GET", "/rental/v1/reports/operations/export",
    request => controller.exportOperationReport(request, response)));
  assert.equal(headers.length, 0); buffer.flush(); assert.equal(headers.length, 2);
  assert.equal(typeof csv, "string"); assert.ok(csv.includes("120") && !csv.includes("800") && !csv.includes("900"));
  assert.ok(queries.length > 0 && queries.every(where => where.tenantId === "tenant" && where.workspaceId === "workspace"));
  assert.ok(!f.trace.some(row => /FROM `?rental_orders`?/u.test(row.text)));
  for (const tx of new Set(f.trace.map(row => row.tx))) {
    const rows = f.trace.filter(row => row.tx === tx).map(row => row.text);
    assert.match(rows[0], /FROM Tenant .* FOR UPDATE$/u);
    assert.ok(rows.findIndex(row => row.includes("platform_core_access_locks")) < rows.findIndex(row => row.includes("business_workspaces")));
  }
  f.state.user.dataScope = "own";
  await assert.rejects(f.run("operationReport", "GET", "/rental/v1/reports/operations", request => controller.operationReport(request)), /仅本人/u);
});

function statementsFixture(f) {
  const batch = { id: "BatchA", tenantId: "tenant", workspaceId: "workspace", provider: "alipay", fileName: "original.csv",
    status: "needs_review", totalRows: 1, matchedRows: 0, differenceRows: 1, acknowledgedRows: 0, importedAt: new Date("2020-01-01"),
    lines: [{ id: "line", batchId: "BatchA", rowNumber: 1, kind: "payment", merchantOrderNo: "unmatched-original", statementStatus: "PAID",
      normalizedStatus: "paid", amount: 37, currency: "CNY", localRecordId: null, localStatus: null, differenceCodes: ["local_record_missing"], reviewStatus: "open" }] };
  const store = { paymentReconciliationBatch: {
    findMany: async ({ where }) => [batch].filter(row => row.tenantId === where.tenantId && row.workspaceId === where.workspaceId).map(copy),
    findFirst: async ({ where }) => Object.entries(where).every(([key, value]) => batch[key] === value) ? copy(batch) : null
  } };
  const service = new PaymentReconciliationFileService(store, { getRequestIdentity });
  const controller = new PaymentReconciliationController({}, { resolveWorkspaceId: getRequestWorkspaceId }, service);
  return { controller, batch };
}

test("disabled statement history keeps unmatched lines and original full-workspace finance authority", async () => {
  const f = fixture(), { controller, batch } = statementsFixture(f);
  const list = () => f.run("listStatements", "GET", "/rental/v1/payment-reconciliation/statements", request => controller.listStatements(request), PaymentReconciliationController);
  const detail = () => f.run("getStatement", "GET", "/rental/v1/payment-reconciliation/statements/BatchA", request => controller.getStatement(request, "BatchA"), PaymentReconciliationController);
  assert.equal((await list())[0].id, "BatchA");
  const result = await detail(); assert.equal(result.lines[0].amount, 37); assert.equal(result.lines[0].localRecordId, undefined);
  assert.ok(!f.trace.some(row => /FROM `?rental_orders`?/u.test(row.text)));
  batch.workspaceId = "other"; await assert.rejects(detail(), /当前经营空间/u); assert.deepEqual(await list(), []); batch.workspaceId = "workspace";
  f.state.user.locationScope = { mode: "selected", locationIds: ["location"] };
  await assert.rejects(list(), /完整经营空间/u); await assert.rejects(detail(), /完整经营空间/u);
  f.state.user.locationScope = { mode: "all", locationIds: [] }; f.state.user.dataScope = "own";
  await assert.rejects(detail(), /完整经营空间/u);
  f.state.user.dataScope = "all"; f.state.user.permissions = ["rental-os:order:view"];
  await assert.rejects(detail());
  assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
});

test("workspace history rechecks current access before returning or flushing native headers", async () => {
  for (const revoke of [f => { f.state.assigned = false; }, f => { f.state.user.permissions = []; },
    f => { f.state.session.currentWorkspaceId = "other"; }, f => { f.state.binding = false; }, f => { f.state.grant = null; }]) {
    const f = fixture(), { controller } = reportsFixture(f);
    const headers = [], response = { setHeader: (...args) => headers.push(args) }, buffer = createRentalNativeResponseBuffer(response);
    await assert.rejects(buffer.run(() => f.run("exportOperationReport", "GET", "/rental/v1/reports/operations/export", async request => {
      const result = await controller.exportOperationReport(request, response); revoke(f); return result;
    })));
    assert.deepEqual(headers, []); assert.throws(() => buffer.flush());
  }
  const f = fixture(), { controller } = statementsFixture(f);
  await assert.rejects(f.run("getStatement", "GET", "/rental/v1/payment-reconciliation/statements/BatchA", async request => {
    const result = await controller.getStatement(request, "BatchA"); f.state.session.revokedAt = new Date(); return result;
  }, PaymentReconciliationController));
});

test("workspace-history tickets cannot authorize an order action, serve a client, or establish new business", async () => {
  const f = fixture();
  await assert.rejects(f.run("operationReport", "GET", "/rental/v1/reports/operations", () => f.db.$transaction(async tx => {
    await lockRentalBusinessTenant(tx, "tenant");
    await assertRentalBusinessOperationAccessAfterLock(tx, "tenant", "workspace", "OrderA"); f.writes++;
  }, { isolationLevel: "ReadCommitted" })), /不能切换原绑定订单/u);
  const client = fixture("client");
  const report = policy.requireHandler(RentalCoreController, RentalCoreController.prototype.operationReport,
    { method: "GET", url: "/rental/v1/reports/operations" });
  // Use the actual client Guard path to establish a customer identity. The
  // operator fixture's signed-transport stub is deliberately not a token parser.
  await assert.rejects(client.run("orderDetail", "GET", "/client/v1/orders/OrderA", request => client.db.$transaction(tx =>
    createRentalRecoveryAuthority({ auth: client.auth, clientAuth: client.clientAuth }).lock(tx,
      { tenantId: "tenant", workspaceId: "workspace", audience: "client", client: request.client,
        subject: bindRentalRecovery(report.recovery, { method: "GET", url: "/rental/v1/reports/operations" }) }),
    { isolationLevel: "ReadCommitted" }), ClientApiController), /不能借客户身份/u);
  for (const [controller, handler, url] of [[RentalCoreController, "prepareExchangeInspection", "/rental/v1/orders/OrderA/exchange-inspection/preparations"],
    [PaymentReconciliationController, "importStatement", "/rental/v1/payment-reconciliation/statements"]]) {
    await assert.rejects(f.run(handler, "POST", url, async () => { f.writes++; }, controller));
  }
  assert.equal(f.writes, 0);
});
