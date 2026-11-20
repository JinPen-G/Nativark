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
const { EnterpriseReadController } = require("../dist/http-enterprise-read.controller.js");
const { EnterpriseAccessService } = require("../dist/mysql-enterprise-access.js");
const { EnterpriseOrderReaderService } = require("../dist/mysql-enterprise-orders.js");
const { RentalFundingService } = require("../dist/mysql-funding.js");
const { RentalOrderReceivableRepository } = require("../dist/mysql-order-receivables.js");
const { CustomerCorporateSettlementService } = require("../dist/mysql-customer-corporate-settlement.js");
const { RentalExchangeInspectionPreparationService } = require("../dist/mysql-exchange-inspection-preparation.js");
const { RentalExchangeInspectionMediaService } = require("../dist/mysql-exchange-inspection-media.js");
const { RentalExchangeInspectionConsentService } = require("../dist/mysql-exchange-inspection-consent.js");
const { EnterpriseExchangeApprovalService } = require("../dist/mysql-enterprise-exchange-approval.js");
const { EnterpriseApprovalService } = require("../dist/mysql-enterprise-approval.js");
const { EnterpriseExtensionApprovalService } = require("../dist/mysql-enterprise-extension-approval.js");
const { EnterpriseManagementRequestService } = require("../dist/mysql-enterprise-management-request.js");
const { RentalFileBusinessAccessService } = require("../dist/file-business-access.js");
const { RentalFileStorageApplication } = require("../dist/file-application-runtime.js");
const { RentalFileBusinessReferences } = require("../dist/file-access.js");
const { FilesController } = require("../dist/http-files.controller.js");
const { StaffOfflinePaymentController } = require("../dist/http-staff-payments.controller.js");
const { StaffOfflinePaymentService } = require("../dist/mysql-staff-payments.js");
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
  EnterpriseWorkflowsController, EnterpriseReadController, PaymentReconciliationController, FilesController, StaffOfflinePaymentController], authorization });
const copy = value => structuredClone(value);

function fixture(audience = "operator", corporateParticipants = false, originalParticipants = false) {
  const user = { id: "user", tenantId: "tenant", isActive: true, isSaasAdmin: false, isPlatformAdmin: false,
    mustChangePassword: false, displayName: "member", account: "member", permissions: ["rental-os:order:view", "rental-os:order:operate",
      "rental-os:order:settle", "rental-os:order:cancel", "rental-os:finance:view", "rental-os:finance:reconcile", "rental-os:report:view", "rental-os:order:offline-payment", "system:integration:manage"],
    roleIds: [], roleNames: [], dataScope: "all", locationScope: { mode: "all", locationIds: [] } };
  const state = { user, tenantStatus: "ACTIVE", workspaceStatus: "ACTIVE", assigned: true, grant: "disabled", binding: true,
    available: true, member: true, session: { audience: "operator", currentWorkspaceId: "workspace", revokedAt: null,
      expiresAt: new Date(Date.now() + 600000) },
    order: { id: "OrderA", tenantId: "tenant", workspaceId: "workspace", status: "RENTING", fulfillmentMode: "pickup", customerId: "customer",
      membershipSnapshot: null, createdBy: "user", fulfillmentLocationId: "location", returnLocationId: "location" },
    intent: { id: "IntentA", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA" },
    refund: { id: "RefundA", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA", paymentIntentId: "IntentA" },
    clientSession: { id: "client-session", tenantId: "tenant", customerId: "customer", workspaceId: "workspace", revokedAt: null,
      expiresAt: new Date(Date.now() + 600000), createdAt: new Date(Date.now() - 1000), wechatIdentityId: null },
    account: { id: "account", status: "active", passwordUpdatedAt: null, mustChangePassword: false },
    membership: { id: "membership", status: "active" } };
  const trace = [], receipts = new Map();
  const f = { state, trace, writes: 0, dispatches: 0, reads: 0, audits: [], onQuery: undefined, originalQuery: undefined, onCommit: undefined };
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every(item => matches(row, item));
    if (key === "OR") return value.some(item => matches(row, item));
    if (key === "workOrders") return false;
    if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
    if (value && typeof value === "object" && "gt" in value) return row[key] > value.gt;
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
    assert.ok(options?.isolationLevel === "ReadCommitted" || corporateParticipants && options?.isolationLevel === "RepeatableRead");
    const number = ++sequence, initialWrites = f.writes, initialAudits = f.audits.length;
    const tx = { ...delegates, operationLog: { create: async ({ data }) => {
      if (f.auditFailure) throw Error("original audit unavailable");
      trace.push({ tx: number, text: "OperationLog.create" }); f.audits.push(copy(data));
    } }, async $queryRaw(query, ...values) {
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
    let result;
    try { result = await consume(tx); } catch (error) { f.writes = initialWrites; f.audits.length = initialAudits; throw error; }
    await f.onCommit?.(number, result);
    return result;
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
  const enterpriseAccess = new EnterpriseAccessService(db), enterpriseOrders = new EnterpriseOrderReaderService(db, enterpriseAccess);
  const commands = new EnterpriseCommandService(db);
  const fileFacts = Object.create(RentalCoreFactRepository.prototype);
  fileFacts.store = db;
  fileFacts.contacts = { resolveWorkspaceId: async () => getRequestWorkspaceId(), getRequestWorkspaceId,
    getRequestLocationIds: () => getRequestIdentity().locationScope?.mode === "selected" ? getRequestIdentity().locationScope.locationIds : undefined,
    getRequestDataScope: () => getRequestIdentity().dataScope, getRequestUserId: () => getRequestIdentity().userId };
  const fileAccess = new RentalFileBusinessAccessService(db, fileFacts, {}, {});
  const originals = { files: fileAccess, approvals: new EnterpriseApprovalService(db, commands, {}, enterpriseAccess, {}, {}, {}),
    extensions: new EnterpriseExtensionApprovalService(db, commands, {}, enterpriseAccess, {}, {}, {}),
    exchanges: new EnterpriseExchangeApprovalService(db, commands, {}, enterpriseAccess, {}, {}, {}, {}),
    management: new EnterpriseManagementRequestService(db, commands, enterpriseAccess) };
  const access = createRentalApplicationAccess({ database: db, authorization,
    recoveryAuthority: createRentalRecoveryAuthority({ auth, clientAuth,
      ...(originalParticipants ? { originalHistory: originals } : {}),
      ...(corporateParticipants ? { corporateHistory: { access: enterpriseAccess, orders: enterpriseOrders } } : {}) }),
    deploymentForTransaction: () => ({ requireAvailable: async () => { if (!state.available) throw Error("unavailable deployment"); } }),
    term: { requireNewBusiness: async () => {} } });
  const idempotent = new RentalIdempotentActionService(db, { find: async (_tenant, _action, key) => receipts.get(key),
    record: async value => receipts.set(value.key, copy(value)) });
  const facts = Object.create(RentalCoreFactRepository.prototype);
  facts.contacts = { getRequestWorkspaceId };
  f.run = (handler, method, url, consume, controller = RentalCoreController, mutateBeforeAdmission) => runWithRequestIdentity({}, () => access.run(async () => {
    const request = { method, url, originalUrl: url, staffApiRequest: audience === "staff", query: Object.fromEntries(new URLSearchParams(url.split("?", 2)[1] ?? "")), headers: { authorization: audience === "client" ? `Bearer ${header}.${payload}.${signature}` : "fixture-original-token" } };
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
  return Object.assign(f, { db, delegates, access, idempotent, facts, receipts, auth, clientAuth, enterpriseAccess, enterpriseOrders, originals, fileAccess, commands });
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
  assert.equal(policy.routes.filter(route => route.recovery).length, 89);
  for (const [controller, handler] of [[RentalCoreController, "prepareExchangeInspection"], [RentalCoreController, "completeExchangeInspectionMedia"],
    [EnterpriseWorkflowsController, "confirmExchangeInspection"], [EnterpriseWorkflowsController, "exchangeInspectionMaterial"],
    [PaymentReconciliationController, "importStatement"], [PaymentReconciliationController, "reviewStatementLine"], [PaymentReconciliationController, "reconcile"]]) {
    assert.equal(policy.routes.find(route => route.controller === controller && route.handlerName === handler).recovery, undefined);
  }
  for (const path of ["/client/v1/enterprise/orders/:orderid/exchange-approvals/execute",
    "/client/v1/enterprise/corporates/:corporateid/orders/:orderid/finance/actions", "/rental/v1/reports/other"]) {
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

const corporateRoutes = [
  ["historyWorkspaces", "history-workspaces", ["orders:read"]],
  ["listOrders", "orders", ["orders:read"]],
  ["orderDetail", "orders/OrderA", ["orders:read"]],
  ["exportOrders", "orders/export-rows", ["orders:read", "export:create"]],
  ["corporateFinance", "finance", ["finance:read"]],
  ["exportCorporateFinance", "finance/export-rows", ["finance:read", "export:create"]],
  ["orderFinance", "orders/OrderA/finance", ["orders:read", "finance:read"]],
  ["exportOrderFinance", "orders/OrderA/finance/export-rows", ["orders:read", "finance:read", "export:create"]]
];

function corporateFixture(originalParticipants = false) {
  const f = fixture("client", true, originalParticipants), { state } = f;
  state.corporate = { id: "CorpA", membershipId: "administrator-relation", role: "admin", active: true,
    tenantEnabled: true, corporateEnabled: true, revision: 1, actions: ["portal:enter", "orders:read", "finance:read", "export:create"] };
  const at = new Date("2020-01-01T00:00:00.000Z");
  Object.assign(state.order, { orderNo: "Original-001", group: "enterprise_paid", customerId: "colleague", customerType: "personal",
    customerName: "Original employee", employeeName: "Original employee", contractSubjectCustomerId: "CorpA",
    payerSubjectCustomerId: "CorpA", userSubjectCustomerId: "colleague", categoryCode: "camping", fulfillmentMode: "pickup",
    startAt: at, endAt: new Date("2020-01-02T00:00:00.000Z"), actualRentalStartAt: null, carrierRentalDueAt: null,
    createdAt: at, updatedAt: at, effectiveEndAt: null, currency: "CNY", payableAmount: 100, finalPayableAmount: 100,
    discountAmount: 0, rentalAmount: 100, serviceAmount: 0, fulfillmentAmount: 0, couponAmount: 0, adjustmentAmount: 0,
    taxAmount: 0, depositAmount: 20, preAuthAmount: 0, legacyDepositUnverified: false, chargeLines: [], lines: [],
    membershipBenefitEvaluations: null, ruleSnapshot: {}, membershipSnapshot: { bookingIdentity: "enterprise_employee",
      corporateCustomerId: "CorpA", enterpriseContractAndPayer: true, personalCustomerId: "colleague",
      corporateMembershipId: "historical-employee", corporateCustomerName: "Original corporate",
      enterpriseBasis: { noticeVersion: "original-v1", acknowledgedAt: "2019-12-31T00:00:00.000Z" } } });
  state.credit = { id: "credit", tenantId: "tenant", customerId: "CorpA", creditLimit: 500,
    status: "active", billingCycle: "monthly", settlementTermDays: 10 };
  state.ledger = [];
  state.events = [{ id: "original-cash", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA",
    instrument: "rental", action: "initiate", amount: 70, balanceAfter: 70, provider: "stripe",
    paymentMethod: null, idempotencyKey: "original-payment", reason: "original receipt", operator: null,
    at, createdAt: at }];
  const subjectMatches = (text, values) => {
    const row = state.order, membership = row.membershipSnapshot;
    if (row.tenantId !== "tenant" || row.workspaceId !== "workspace" || !values.includes(state.corporate.id)) return false;
    const paid = row.contractSubjectCustomerId === state.corporate.id && row.payerSubjectCustomerId === state.corporate.id
      || row.contractSubjectCustomerId === null && row.payerSubjectCustomerId === null && row.userSubjectCustomerId === null
        && row.customerType === "corporate" && row.customerId === state.corporate.id;
    const basis = membership?.enterpriseBasis;
    const benefit = text.includes("'$.enterpriseBasis.noticeVersion'") && membership?.bookingIdentity === "enterprise_employee"
      && membership.corporateCustomerId === state.corporate.id && membership.enterpriseContractAndPayer === false
      && membership.personalCustomerId === row.customerId && row.contractSubjectCustomerId === row.customerId
      && row.payerSubjectCustomerId === row.customerId && typeof basis?.noticeVersion === "string" && basis.noticeVersion.trim()
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(basis?.acknowledgedAt) && new Date(basis.acknowledgedAt) <= row.createdAt;
    return Boolean(paid || benefit);
  };
  f.originalQuery = async (text, values) => {
    if (text.includes("FROM customer_corporate_memberships m")) {
      const grant = state.corporate;
      for (const clause of ["g.membershipUpdatedAt=m.updatedAt", "personalMember.status='active'", "corporateMember.status='active'",
        "s.revokedAt IS NULL", "s.expiresAt>NOW(3)", "m.effectiveTo>NOW(3)"]) assert.ok(text.includes(clause), clause);
      if (text.includes("AND s.workspaceId=")) {
        assert.ok(values.includes("workspace") && values.includes("main"));
        assert.ok(text.includes("workspace.status='ACTIVE'"));
      }
      assert.ok(values.includes("tenant") && values.includes("customer") && values.includes("client-session"));
      return grant.active && state.account.status === "active" && state.membership.status === "active" && !state.clientSession.revokedAt
        && state.clientSession.workspaceId === "workspace" && state.workspaceStatus === "ACTIVE" && state.tenantStatus === "ACTIVE"
        ? grant.actions.map(action => ({ corporateCustomerId: grant.id, corporateName: "Corporate", membershipId: grant.membershipId,
          role: grant.role, action, tenantEnabled: grant.tenantEnabled, corporateEnabled: grant.corporateEnabled,
          tenantRevision: 1, corporateRevision: grant.revision })) : [];
    }
    if (text.includes("FROM rental_orders o")) {
      assert.ok(values.includes("tenant") && values.includes("workspace"));
      assert.ok(text.includes("o.contractSubjectCustomerId") && text.includes("o.payerSubjectCustomerId"));
      const visible = subjectMatches(text, values);
      if (text.includes("COUNT(*)")) return [{ total: visible ? 1n : 0n }];
      if (text.includes("SELECT DISTINCT")) return visible ? [{ workspaceId: "workspace", workspaceCode: "main", workspaceName: "space" }] : [];
      if (!visible) return [];
      const snapshot = state.order.membershipSnapshot;
      return [{ ...copy(state.order), membership: { ...copy(snapshot), noticeVersion: snapshot.enterpriseBasis?.noticeVersion,
        acknowledgedAt: snapshot.enterpriseBasis?.acknowledgedAt } }];
    }
    if (text.includes("FROM rental_funding_events")) return copy(state.events);
    if (text.includes("FROM customer_corporate_credits")) return state.credit ? [{ id: state.credit.id }] : [];
    if (text.includes("FROM customer_corporate_credit_ledger")) return copy(state.ledger);
  };
  f.delegates.rentalOrder.findFirstOrThrow = async ({ where }) => {
    assert.equal(where.id, state.order.id); assert.equal(where.workspaceId, state.order.workspaceId); return copy(state.order);
  };
  const more = { rentalOrderExtension: { findMany: async () => [] },
    rentalFundingEvent: { findMany: async () => copy(state.events) }, rentalOfflinePaymentRegistration: { findMany: async () => [] },
    customerCorporateCredit: { findFirst: async () => copy(state.credit) },
    customerCorporateCreditLedger: { aggregate: async () => ({ _sum: { reservedDelta: 0, receivableDelta: 0 } }),
      findMany: async ({ where }) => copy(state.ledger.filter(row => row.currency !== where.currency.not)) } };
  Object.assign(f.db, more); Object.assign(f.delegates, more);
  const funding = new RentalFundingService(f.db, { getRequestWorkspaceId }, new RentalOrderReceivableRepository(f.db));
  const credit = new CustomerCorporateSettlementService(f.db);
  f.controller = new EnterpriseReadController(f.enterpriseOrders, f.db, funding, credit);
  f.read = (handler, after) => {
    const route = corporateRoutes.find(row => row[0] === handler), suffix = route[1];
    return f.run(handler, "GET", `/client/v1/enterprise/corporates/CorpA/${suffix}`, async request => {
      const result = await f.controller[handler](request, "CorpA", suffix.includes("OrderA") ? "OrderA" : {});
      await after?.(result); return result;
    }, EnterpriseReadController);
  };
  return f;
}

test("eight original enterprise handlers bind exact corporate/action/order subjects only", () => {
  for (const [handler, suffix, actions] of corporateRoutes) {
    const request = { method: "GET", url: `/client/v1/enterprise/corporates/CorpA/${suffix}` };
    const route = policy.requireHandler(EnterpriseReadController, EnterpriseReadController.prototype[handler], request);
    const subject = bindRentalRecovery(route.recovery, request);
    assert.equal(subject.declaration.scope, "corporate-history"); assert.equal(subject.corporateId, "CorpA");
    assert.equal(subject.orderId, suffix.includes("OrderA") ? "OrderA" : undefined);
    assert.deepEqual(subject.declaration.corporateActions, actions);
    assert.equal(route.review.kind, handler === "historyWorkspaces" ? "buffered-read" : "audited-read");
    assert.throws(() => bindRentalRecovery(route.recovery, { ...request, method: "POST" }));
    assert.throws(() => bindRentalRecovery(route.recovery, { ...request, url: request.url.replace("CorpA", "Corp%2fA") }));
  }
  for (const suffix of ["members", "policy", "requests", "orders/new", "finance/payments"]) {
    assert.throws(() => declareRentalRecovery("GET", `/client/v1/enterprise/corporates/:corporateid/${suffix}`, "history"));
  }
});

test("disabled Core serves all eight original enterprise projections and durable audits, including colleague-owned corporate orders", async () => {
  const f = corporateFixture();
  for (const [handler, suffix] of corporateRoutes) {
    f.trace.length = 0;
    const result = await f.read(handler);
    assert.equal(result.corporateCustomerId, "CorpA"); assert.equal(result.permissionRevision, "1:1");
    if (handler === "historyWorkspaces") {
      assert.equal(result.crossWorkspaceRead.state, "unavailable"); assert.equal(result.workspaces[0].workspaceId, "workspace");
    } else if (handler === "orderDetail") assert.equal(result.order.employeeCustomerId, "colleague");
    else if (["corporateFinance", "exportCorporateFinance"].includes(handler)) {
      assert.equal(result.credit.account.creditLimit, 500); assert.equal(result.maturities.state, "unavailable");
    } else if (["orderFinance", "exportOrderFinance"].includes(handler)) {
      assert.equal(result.rentalCash.collected, 70); assert.equal(result.guarantee.state, "unavailable"); assert.equal(result.statements.state, "unavailable");
    }
    for (const tx of new Set(f.trace.filter(row => row.text.includes("platform_core_access_locks")).map(row => row.tx))) {
      const statements = f.trace.filter(row => row.tx === tx).map(row => row.text);
      assert.match(statements[0], /FROM Tenant .*FOR UPDATE$/u);
      const core = statements.findIndex(row => row.includes("platform_core_access_locks"));
      const workspace = statements.findIndex(row => row.startsWith("SELECT id, status FROM business_workspaces"));
      const order = statements.findIndex(row => row.startsWith("SELECT id FROM rental_orders"));
      const enterprise = statements.findIndex(row => row.includes("FROM customer_corporate_memberships m"));
      assert.ok(core < workspace && workspace < enterprise);
      if (suffix.includes("OrderA")) assert.ok(core < order && order < workspace);
      else assert.equal(order, -1);
      assert.ok(!statements.some(row => row.includes("platform_member_core_assignments")));
    }
  }
  assert.equal(f.audits.length, 7); assert.ok(f.audits.every(row => row.workspaceId === "workspace" && row.userId === undefined));
  assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
});

test("enterprise history retains original paid versus disclosed-benefit object rules and finance never reads personal benefit", async () => {
  const f = corporateFixture(), row = f.state.order;
  row.group = "personal_benefit"; row.contractSubjectCustomerId = row.payerSubjectCustomerId = "colleague";
  row.membershipSnapshot.enterpriseContractAndPayer = false;
  const detail = await f.read("orderDetail");
  assert.equal(detail.order.disclosure.noticeVersion, "original-v1"); assert.equal(detail.order.depositAmount, null);
  await assert.rejects(f.read("orderFinance")); await assert.rejects(f.read("exportOrderFinance"));
  row.membershipSnapshot.enterpriseBasis = undefined;
  await assert.rejects(f.read("orderDetail"));
  row.membershipSnapshot = null;
  await assert.rejects(f.read("orderDetail"));
  row.workspaceId = "other"; await assert.rejects(f.read("orderDetail"));
  assert.equal(f.audits.length, 1);
});

test("missing original enterprise participants fails closed even when Core is enabled; collections cannot authorize an order", async () => {
  for (const grant of ["enabled", "disabled"]) {
    const f = fixture("client"); f.state.grant = grant;
    await assert.rejects(f.run("listOrders", "GET", "/client/v1/enterprise/corporates/CorpA/orders",
      async () => { throw Error("must not reach reader"); }, EnterpriseReadController), /缺少同实例企业/u);
  }
  const f = corporateFixture();
  await assert.rejects(f.run("listOrders", "GET", "/client/v1/enterprise/corporates/CorpA/orders", () => f.db.$transaction(async tx => {
    await lockRentalBusinessTenant(tx, "tenant");
    await assertRentalBusinessOperationAccessAfterLock(tx, "tenant", "workspace", "OrderA");
  }, { isolationLevel: "ReadCommitted" }), EnterpriseReadController), /不能切换原绑定订单/u);
  await assert.rejects(f.run("orderFinance", "GET", "/client/v1/enterprise/corporates/CorpA/orders/OrderA/finance", () => f.db.$transaction(async tx => {
    await lockRentalBusinessTenant(tx, "tenant");
    await assertRentalBusinessOperationAccessAfterLock(tx, "tenant", "workspace", "OtherOrder");
  }, { isolationLevel: "ReadCommitted" }), EnterpriseReadController), /不能切换原绑定订单/u);
  assert.equal(f.audits.length, 0);
});

test("current enterprise grants, relationship, exports and tenant/session boundaries remain required before reader IO", async () => {
  for (const revoke of [f => { f.state.corporate.role = "employee"; }, f => { f.state.corporate.active = false; },
    f => { f.state.corporate.actions = ["portal:enter"]; }, f => { f.state.corporate.tenantEnabled = false; },
    f => { f.state.corporate.corporateEnabled = false; }, f => { f.state.corporate.id = "OtherCorp"; },
    f => { f.state.clientSession.workspaceId = "other"; }, f => { f.state.clientSession.tenantId = "other"; },
    f => { f.state.grant = null; }, f => { f.state.binding = false; }, f => { f.state.available = false; }]) {
    const f = corporateFixture(); revoke(f); await assert.rejects(f.read("listOrders")); assert.equal(f.audits.length, 0);
  }
  const f = corporateFixture(); f.state.corporate.actions = ["portal:enter", "orders:read", "finance:read"];
  await f.read("listOrders");
  for (const handler of ["exportOrders", "exportCorporateFinance", "exportOrderFinance"]) await assert.rejects(f.read(handler));
  assert.equal(f.audits.length, 1);
});

test("enterprise audit rejects a grant revision changed after reading and preserves committed audit on failed delivery", async () => {
  const beforeAudit = corporateFixture();
  beforeAudit.onCommit = async (_tx, result) => { if (Array.isArray(result?.items)) beforeAudit.state.corporate.revision++; };
  await assert.rejects(beforeAudit.read("listOrders")); assert.equal(beforeAudit.audits.length, 0);
  const failure = corporateFixture(); failure.auditFailure = true;
  await assert.rejects(failure.read("listOrders"), /审计失败/u); assert.equal(failure.audits.length, 0);
  for (const revoke of [f => { f.state.corporate.actions = []; }, f => { f.state.corporate.revision++; },
    f => { f.state.corporate.membershipId = "new-relation"; }, f => { f.state.clientSession.revokedAt = new Date(); },
    f => { f.state.binding = false; }, f => { f.state.order.payerSubjectCustomerId = "OtherCorp"; }]) {
    const f = corporateFixture();
    await assert.rejects(f.read("orderDetail", () => revoke(f)));
    assert.equal(f.audits.length, 1); assert.equal(f.writes, 0);
  }
  const afterCommit = corporateFixture();
  afterCommit.onCommit = async () => { if (afterCommit.audits.length) afterCommit.state.corporate.active = false; };
  await assert.rejects(afterCommit.read("listOrders")); assert.equal(afterCommit.audits.length, 1);
});

test("enterprise revocation while awaiting Tenant is current, and the pure history reader rechecks before delivery", async () => {
  const waiting = corporateFixture();
  waiting.onQuery = async text => { if (/FROM Tenant .*FOR UPDATE$/u.test(text)) waiting.state.corporate.active = false; };
  await assert.rejects(waiting.read("listOrders")); assert.equal(waiting.audits.length, 0);
  assert.ok(!waiting.trace.some(row => row.text.includes("SELECT COUNT(*)")));
  const pure = corporateFixture();
  await assert.rejects(pure.read("historyWorkspaces", () => { pure.state.corporate.revision++; }));
  assert.equal(pure.audits.length, 0);
});

test("enterprise financial histories keep unknown cash and incomplete workspace account coverage unavailable", async () => {
  const cash = corporateFixture(); cash.state.events[0].provider = "mock";
  const financial = await cash.read("orderFinance");
  assert.deepEqual(financial.rentalCash, { state: "unavailable", reason: "unverified_original_cash_receipt" });
  const account = corporateFixture();
  account.state.ledger = [{ id: "original-other-space-debt", tenantId: "tenant", customerId: "CorpA",
    workspaceId: "other-space", orderId: "OtherOrder", entryType: "reserve", currency: "CNY" }];
  assert.deepEqual((await account.read("corporateFinance")).credit,
    { state: "unavailable", reason: "authoritative_account_history_space_scope_not_connected" });
  account.state.credit = null;
  assert.deepEqual((await account.read("corporateFinance")).credit,
    { state: "unavailable", reason: "original_account_configuration_missing_with_ledger" });
});


const evidenceRoutes = [
  [FilesController, "carrierEvidenceDownloadUrl", "/files/rental-orders/OrderA/carrier-evidence/FileA/download-url", "file-history"],
  [FilesController, "downloadUrl", "/files/FileA/download-url", "file-history"],
  [StaffOfflinePaymentController, "list", "/staff/v1/offline-payments?orderId=OrderA", "order"],
  [EnterpriseWorkflowsController, "paymentProofFile", "/client/v1/enterprise/management-requests/RequestA/files/FileA", "payment-proof-history"],
  [EnterpriseWorkflowsController, "exchangeOriginal", "/client/v1/enterprise/exchange-approvals/ApprovalA", "approval-history"],
  [EnterpriseWorkflowsController, "exchangeConfirmationOriginal", "/client/v1/enterprise/exchange-approvals/ApprovalA/expense-confirmation", "approval-history"],
  [EnterpriseWorkflowsController, "extensionOriginal", "/client/v1/enterprise/extension-approvals/ApprovalA/result", "approval-history"],
  [EnterpriseWorkflowsController, "approvalResult", "/client/v1/enterprise/approvals/ApprovalA/result", "approval-history"],
  [EnterpriseWorkflowsController, "extensionRequestOriginal", "/client/v1/enterprise/orders/OrderA/extension-request-operations/KeyA", "order"],
  [EnterpriseWorkflowsController, "exchangeRequestOriginal", "/client/v1/enterprise/orders/OrderA/exchange-request-operations/KeyA", "order"],
  [EnterpriseWorkflowsController, "orderOriginal", "/client/v1/enterprise/quotes/QuoteA/order-operations/KeyA", "approval-history"]
];

test("eleven evidence and original-receipt handlers have exact closed subjects; new operations stay unregistered", () => {
  for (const [controller, handler, url, scope] of evidenceRoutes) {
    const request = { method: "GET", url, query: Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? "")) };
    const route = policy.requireHandler(controller, controller.prototype[handler], request);
    const subject = bindRentalRecovery(route.recovery, request);
    assert.equal(subject.declaration.scope, scope); assert.equal(subject.declaration.kind, "history");
    assert.throws(() => bindRentalRecovery(route.recovery, { ...request, method: "POST" }));
  }
  for (const [controller, handler, url] of [
    [StaffOfflinePaymentController, "confirm", "/staff/v1/offline-payments/PayA/confirm"],
    [EnterpriseWorkflowsController, "confirmExchangeExpense", "/client/v1/enterprise/exchange-approvals/ApprovalA/expense-confirmation"],
    [EnterpriseWorkflowsController, "submitApproval", "/client/v1/enterprise/approvals/submit"],
    [EnterpriseWorkflowsController, "submitExtensionApproval", "/client/v1/enterprise/extension-approvals/submit"],
    [FilesController, "createUploadSession", "/files/upload-sessions"]
  ]) assert.equal(policy.requireHandler(controller, controller.prototype[handler], { method: "POST", url }).recovery, undefined);
});

function originalEvidenceFixture(audience = "operator") {
  const f = fixture(audience, false, true), at = new Date("2020-01-01T00:00:00.000Z");
  f.state.session.audience = audience;
  f.state.file = { id: "FileA", tenantId: "tenant", businessModule: "rental-core", businessType: "rental_order", businessId: "OrderA",
    uploadScene: "pickup-evidence", status: "active", uploadedBy: "user", storageProvider: "local_mock", storageKey: "original",
    mimeType: "image/png", sizeBytes: 8, updatedAt: at, metadata: { workspaceId: "workspace" } };
  const fileAsset = { findFirst: async ({ where }) => Object.entries(where).every(([key, value]) => f.state.file[key] === value) ? copy(f.state.file) : null };
  const asyncJob = { findFirst: async () => copy(f.state.job) }, documentPrintJob = { findFirst: async () => copy(f.state.job) };
  const rentalItemGroup = { findFirst: async () => ({ id: "GroupA" }) };
  Object.assign(f.db, { fileAsset, asyncJob, documentPrintJob, rentalItemGroup });
  Object.assign(f.delegates, { fileAsset, asyncJob, documentPrintJob, rentalItemGroup });
  f.originalQuery = async (text, values) => {
    if (text.includes("FROM FileAsset")) return values.includes(f.state.file.id) && values.includes(f.state.file.tenantId) ? [copy(f.state.file)] : [];
    if (/FROM (AsyncJob|DocumentPrintJob)/u.test(text)) return f.state.job ? [copy(f.state.job)] : [];
  };
  const storage = Object.create(RentalFileStorageApplication.prototype);
  Object.assign(storage, { prisma: f.db, fileAccess: f.fileAccess, operationLog: {}, fileReferences: new RentalFileBusinessReferences(f.db) });
  const controller = new FilesController({}, storage, f.db, {});
  f.download = (carrier = false, after) => f.run(carrier ? "carrierEvidenceDownloadUrl" : "downloadUrl", "GET",
    carrier ? "/files/rental-orders/OrderA/carrier-evidence/FileA/download-url" : "/files/FileA/download-url", async request => {
      const result = carrier ? await controller.carrierEvidenceDownloadUrl(request, "OrderA", "FileA") : await controller.downloadUrl(request, "FileA");
      await after?.(result); return result;
    }, FilesController);
  return f;
}

test("original FileAsset and carrier downloads retain actual ACL/audit and Order before Workspace", async () => {
  for (const carrier of [false, true]) {
    const f = originalEvidenceFixture();
    if (carrier) { f.state.order.fulfillmentMode = "carrier_shipping"; f.state.file.uploadScene = "carrier-shipment-evidence"; }
    assert.equal((await f.download(carrier)).fileAssetId, "FileA"); assert.equal(f.audits.length, 1);
    for (const tx of new Set(f.trace.map(row => row.tx))) {
      const rows = f.trace.filter(row => row.tx === tx).map(row => row.text);
      const order = rows.findIndex(text => /FROM rental_orders .*FOR UPDATE$/u.test(text));
      const space = rows.findIndex(text => /SELECT id, status FROM business_workspaces/u.test(text));
      assert.ok(order >= 0 && order < space);
    }
  }
  const task = originalEvidenceFixture(); task.state.file.businessType = "document_print_job"; task.state.file.businessId = "JobA";
  task.state.job = { tenantId: "tenant", id: "JobA", businessType: "rental_order", businessId: "OrderA" };
  assert.equal((await task.download()).fileAssetId, "FileA"); assert.equal(task.audits.length, 1);
});

test("file history rejects relinking, revoked access, foreign/cyclic jobs and stage mismatch; enabled non-order ACL remains usable", async () => {
  const deniedCases = [f => { f.state.file.businessId = "OtherOrder"; }, f => { f.state.file.tenantId = "other"; },
    f => { f.state.user.permissions = ["system:integration:manage"]; },
    f => { f.state.user.locationScope = { mode: "selected", locationIds: ["location"] }; f.state.order.fulfillmentLocationId = "other"; },
    f => { f.state.file.businessType = "async_job"; f.state.file.businessId = "JobA";
      f.state.job = { id: "JobA", tenantId: "tenant", businessType: "async_job", businessId: "JobA" }; }];
  for (const change of deniedCases) { const f = originalEvidenceFixture(); change(f); await assert.rejects(f.download()); assert.equal(f.audits.length, 0); }
  const nonOrder = originalEvidenceFixture(); nonOrder.state.file.businessType = "rental_item_group"; nonOrder.state.file.businessId = "GroupA";
  nonOrder.state.file.uploadScene = "item-group-image";
  await assert.rejects(nonOrder.download()); nonOrder.state.grant = "enabled"; assert.equal((await nonOrder.download()).fileAssetId, "FileA");
  const changed = originalEvidenceFixture();
  await assert.rejects(changed.download(false, () => { changed.state.file.storageKey = "replaced"; })); assert.equal(changed.audits.length, 1);
  const stageChanged = originalEvidenceFixture(); stageChanged.state.user.locationScope = { mode: "selected", locationIds: ["location"] };
  await assert.rejects(stageChanged.download(false, () => { stageChanged.state.order.fulfillmentLocationId = "other"; }));
  assert.equal(stageChanged.audits.length, 1);
  const revoked = originalEvidenceFixture();
  await assert.rejects(revoked.download(false, () => { revoked.state.assigned = false; })); assert.equal(revoked.audits.length, 1);
});

test("staff original payments list binds one exact query order and never confirms or changes the receipt", async () => {
  const f = fixture("staff"); f.state.session.audience = "staff";
  const row = { id: "PayA", tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA", instrument: "rental", amount: 30,
    paymentMethod: "offline_cash", reason: "original", evidenceFileAssetId: null, status: "pending", idempotencyKey: "old-key",
    registeredBy: "user", registeredAt: new Date("2020-01-01T00:00:00.000Z"), confirmedBy: null, confirmedAt: null, fundingEventId: null };
  f.db.rentalOfflinePaymentRegistration = { findMany: async ({ where }) => { assert.deepEqual(where, { tenantId: "tenant", workspaceId: "workspace", orderId: "OrderA" }); return [copy(row)]; } };
  const controller = new StaffOfflinePaymentController(new StaffOfflinePaymentService(f.db, {}, {}));
  const run = (url, after, mutate) => f.run("list", "GET", url, async request => {
    const result = await controller.list(request, request.query.orderId); await after?.(request); return result;
  }, StaffOfflinePaymentController, mutate);
  assert.equal((await run("/staff/v1/offline-payments?orderId=OrderA"))[0].status, "pending");
  for (const url of ["/staff/v1/offline-payments", "/staff/v1/offline-payments?orderId=OrderA&orderId=Other",
    "/staff/v1/offline-payments?orderId[]=OrderA", "/staff/v1/offline-payments?orderId=Other",
    "/staff/v1/offline-payments?order%49d=OrderA"]) await assert.rejects(run(url));
  await assert.rejects(run("/staff/v1/offline-payments?orderId=OrderA", request => { request.query.orderId = "Other"; }));
  await assert.rejects(run("/staff/v1/offline-payments?orderId=OrderA", undefined, request => { request.query.orderId = ["OrderA"]; }));
  assert.equal(f.writes, 0); assert.equal(row.status, "pending");
});

function approvalHistoryFixture() {
  const f = fixture("client", false, true), at = new Date("2020-01-01T00:00:00.000Z");
  const preview = { originalEndAt: at.toISOString(), newEndAt: at.toISOString(), rentalAmount: 10, serviceAmount: 0, depositDelta: 0,
    preAuthDelta: 0, payableAmount: 10, currency: "CNY", settlementMode: "pay_now", paymentRequired: true, chargeLines: [], serviceSnapshots: [],
    additionalAmount: 10, refundAmount: 0, exchange: { originalItemGroupName: "Original", replacementItemGroupName: "Replacement" } };
  f.state.approval = { id: "ApprovalA", corporateCustomerId: "CorpA", applicantCustomerId: "customer", workspaceId: "workspace", orderId: "OrderA",
    quoteId: "QuoteA", state: "pending", revision: 1, expiresAt: at, purpose: "old", reason: "old", amount: 10, currency: "CNY",
    executionKey: null, extensionId: null, closedOperationKey: null, requestFingerprint: "original-request", previewFingerprint: "original-preview",
    expectedOrderUpdatedAt: at.toISOString(), request: {}, preview, basis: {},
    quote: { quoteNo: "old", request: { lines: [] }, chargeLines: [], membershipSnapshot: {} } };
  f.originalQuery = async (text, values) => {
    if (/FROM enterprise_(?:booking|extension|exchange)_approvals/u.test(text)) return values.includes(f.state.approval.id) ? [copy(f.state.approval)] : [];
    if (text.includes("FROM customer_profiles p JOIN customer_accounts")) return f.state.account.status === "active" && !f.state.clientSession.revokedAt ? [{ id: "customer" }] : [];
    if (text.includes("FROM enterprise_portal_operations")) return [];
    if (text.includes("FROM rental_order_idempotency_records")) return f.state.creationReceipt ? [copy(f.state.creationReceipt)] : [];
  };
  const controller = Object.create(EnterpriseWorkflowsController.prototype);
  Object.assign(controller, { approvals: f.originals.approvals, extensions: f.originals.extensions, exchanges: f.originals.exchanges });
  f.read = (handler, after) => {
    const route = evidenceRoutes.find(row => row[1] === handler), url = route[2];
    return f.run(handler, "GET", url, async request => {
      const result = await controller[handler](request, handler.endsWith("RequestOriginal") ? "OrderA" : "ApprovalA", "KeyA");
      await after?.(result); return result;
    }, EnterpriseWorkflowsController);
  };
  return f;
}

test("original approval IDs and request keys read the original applicant records without renewing or executing approvals", async () => {
  for (const handler of ["exchangeOriginal", "exchangeConfirmationOriginal", "extensionOriginal", "approvalResult", "extensionRequestOriginal", "exchangeRequestOriginal"]) {
    const f = approvalHistoryFixture();
    const result = await f.read(handler);
    assert.ok(result); assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
    if (handler.endsWith("RequestOriginal")) assert.deepEqual(result, { state: "not_recorded", retryable: false });
    else assert.equal((result.approval ?? result).id, "ApprovalA");
  }
  const noOrder = approvalHistoryFixture(); noOrder.state.approval.orderId = null;
  assert.equal((await noOrder.read("approvalResult")).original.state, "not_submitted");
  assert.equal(noOrder.trace.some(row => /FROM rental_orders .*FOR UPDATE$/u.test(row.text)), false);
});

test("original approval material is immutable across the buffered read and cannot authorize a different applicant or order", async () => {
  for (const change of [f => { f.state.approval.applicantCustomerId = "colleague"; }, f => { f.state.approval.workspaceId = "other"; },
    f => { f.state.approval.orderId = "OtherOrder"; }, f => { f.state.order.customerId = "colleague"; }]) {
    const f = approvalHistoryFixture(); change(f); await assert.rejects(f.read("exchangeOriginal"));
  }
  const changed = approvalHistoryFixture(); await assert.rejects(changed.read("exchangeOriginal", () => { changed.state.approval.revision++; }));
  const revoked = approvalHistoryFixture(); await assert.rejects(revoked.read("extensionOriginal", () => { revoked.state.clientSession.revokedAt = new Date(); }));
  const missing = fixture("client"); missing.state.grant = "enabled";
  await assert.rejects(missing.run("exchangeOriginal", "GET", "/client/v1/enterprise/exchange-approvals/ApprovalA", async () => {}, EnterpriseWorkflowsController), error => error.code === "core_unavailable");
});


test("original quote/key read preserves not_observed, unknown and observed without giving an order to absent receipts", async () => {
  for (const status of ["absent", "unknown", "observed"]) {
    const f = approvalHistoryFixture(), clientApi = Object.create(ClientApiService.prototype);
    Object.assign(f.state.order, { quoteId: "QuoteA", membershipSnapshot: { bookingIdentity: "enterprise_employee", personalCustomerId: "customer" } });
    if (status !== "absent") f.state.creationReceipt = { orderId: status === "observed" ? "OrderA" : null, requestHash: "original", status: "succeeded" };
    f.db.rentalOrderIdempotencyRecord = { findFirst: async ({ where }) => {
      assert.deepEqual(where, { tenantId: "tenant", workspaceId: "workspace", action: "rental.order.create", idempotencyKey: "KeyA" });
      return copy(f.state.creationReceipt ?? null);
    } };
    const beforeQuery = f.originalQuery;
    f.originalQuery = async (text, values) => text.includes("SELECT id,quoteId,membershipSnapshot FROM rental_orders")
      ? [copy(f.state.order)] : beforeQuery(text, values);
    clientApi.prisma = f.db; clientApi.core = { getOrder: async () => copy(f.state.order) };
    f.originals.approvals.clientApi = clientApi;
    const read = after => f.run("orderOriginal", "GET", "/client/v1/enterprise/quotes/QuoteA/order-operations/KeyA", async request => {
      const result = await f.originals.approvals.orderOriginal(request.client, "QuoteA", "KeyA"); await after?.(); return result;
    }, EnterpriseWorkflowsController);
    assert.deepEqual(await read(), { state: status === "absent" ? "not_observed" : status, orderId: status === "observed" ? "OrderA" : null, retryable: false });
    assert.equal(f.writes, 0); assert.equal(f.dispatches, 0);
    if (status !== "observed") assert.equal(f.trace.some(row => /FROM rental_orders .*FOR UPDATE$/u.test(row.text)), false);
    if (status === "observed") {
      await assert.rejects(read(() => { f.state.creationReceipt.requestHash = "changed"; }));
      f.state.order.membershipSnapshot.personalCustomerId = "colleague";
      await assert.rejects(read());
    }
  }
});

async function paymentProofHistoryFixture() {
  const f = corporateFixture(true), state = f.state, at = new Date("2020-01-01T00:00:00.000Z");
  state.corporate.actions.push("requests:manage");
  state.proofFile = { id: "FileA", tenantId: "tenant", businessModule: "enterprise", businessType: "rental_order", businessId: "OrderA",
    uploadedBy: "customer", uploadScene: "enterprise-payment-proof", status: "active", storageProvider: "s3", storageKey: "frozen-object",
    checksum: "a".repeat(64), mimeType: "application/pdf", sizeBytes: 8, updatedAt: at,
    metadata: { workspaceId: "workspace", fileUploadVersion: 2, fileContentVersion: 1, contentHash: "a".repeat(64),
      enterprisePaymentProof: { corporateCustomerId: "CorpA", orderId: "OrderA", objectRevision: at.toISOString(), purpose: "rental_fee" } },
    uploadSession: { id: "UploadA", status: "completed", completedAt: at, provider: "s3", storageKey: "frozen-object" } };
  const fileAsset = { findMany: async ({ where }) => {
    assert.equal(where.tenantId, "tenant"); assert.equal(where.businessId, "OrderA"); assert.equal(where.uploadedBy, "customer");
    return state.proofFile.status === "active" ? [copy(state.proofFile)] : [];
  } };
  Object.assign(f.db, { fileAsset }); Object.assign(f.delegates, { fileAsset });
  const proof = { corporateCustomerId: "CorpA", orderId: "OrderA", workspaceId: "workspace", currency: "CNY",
    objectRevision: at.toISOString(), evidenceFileIds: ["FileA"], purpose: "rental_fee" };
  proof.evidenceHash = (await f.originals.management.proofs.files("tenant", "customer", proof, ["FileA"], f.db)).evidenceHash;
  state.proofRequest = { tenantId: "tenant", id: "RequestA", corporateCustomerId: "CorpA", applicantCustomerId: "customer", state: "pending",
    revision: 1, createdAt: at, updatedAt: at, decisionReason: null,
    payload: { requestType: "payment_proof", objectRevision: at.toISOString(), reason: "original", evidenceFileIds: ["FileA"], paymentProof: proof,
      proposal: { orderId: "OrderA", workspaceId: "workspace", currency: "CNY", reportedAmount: "70.00", paymentPurpose: "rental_fee" } } };
  const beforeQuery = f.originalQuery;
  f.originalQuery = async (text, values) => {
    if (text.includes("FROM enterprise_workflow_requests")) return values.includes(state.proofRequest.id) ? [copy(state.proofRequest)] : [];
    if (text.includes("FROM customer_profiles p JOIN customer_accounts")) return state.account.status === "active" && !state.clientSession.revokedAt ? [{ id: "customer" }] : [];
    if (text.includes("FROM client_auth_sessions s JOIN business_workspaces")) return !state.clientSession.revokedAt ? [{ id: "client-session" }] : [];
    if (text.includes("FROM FileAsset f LEFT JOIN file_upload_sessions")) {
      const { uploadSession: session, ...asset } = copy(state.proofFile);
      return [{ ...asset, historySessionId: session.id, historySessionStatus: session.status, historySessionCompletedAt: session.completedAt,
        historySessionProvider: session.provider, historySessionStorageKey: session.storageKey }];
    }
    if (text.includes("FROM FileAsset f JOIN file_upload_sessions")) return [{ id: "FileA" }];
    return beforeQuery(text, values);
  };
  const controller = Object.create(EnterpriseWorkflowsController.prototype);
  controller.management = f.originals.management;
  // Provider bytes are the transport fixture; all request/grant/order/frozen-file
  // predicates below execute the original services, with no network request.
  controller.files = { readPaymentProofBytes: async (...args) => {
    assert.deepEqual(args, ["tenant", "FileA", "customer", "OrderA", "workspace", "a".repeat(64)]);
    await f.duringBytes?.(); return { mimeType: "application/pdf", content: Buffer.from("%PDF-old") };
  } };
  f.readProof = async after => {
    const sent = [], target = { setHeader: (...args) => sent.push(args), send: bytes => sent.push(bytes.toString()) };
    f.sent = sent; const buffer = createRentalNativeResponseBuffer(target);
    await buffer.run(() => f.run("paymentProofFile", "GET", "/client/v1/enterprise/management-requests/RequestA/files/FileA", async request => {
      const result = await controller.paymentProofFile(request, "RequestA", "FileA", target); await after?.(); return result;
    }, EnterpriseWorkflowsController));
    assert.deepEqual(sent, []); buffer.flush(); return sent;
  };
  return f;
}

test("payment proof history reuses original applicant, current corporate finance and immutable file receipt even for another employee order", async () => {
  const f = await paymentProofHistoryFixture();
  assert.equal(f.state.order.membershipSnapshot.personalCustomerId, "colleague");
  assert.equal((await f.readProof()).at(-1), "%PDF-old"); assert.equal(f.writes, 0); assert.equal(f.audits.length, 0);
  for (const tx of new Set(f.trace.map(row => row.tx))) {
    const rows = f.trace.filter(row => row.tx === tx).map(row => row.text);
    assert.ok(rows[0].includes("FROM Tenant") && rows[0].endsWith("FOR UPDATE"));
    const core = rows.findIndex(text => text.includes("platform_core_access_locks"));
    const order = rows.findIndex(text => /SELECT id FROM rental_orders/u.test(text));
    const workspace = rows.findIndex(text => /SELECT id, status FROM business_workspaces/u.test(text));
    assert.ok(core >= 0 && order > core && workspace > order);
  }
});

test("payment proof history rejects source/file/grant changes before any buffered bytes escape", async () => {
  const changes = [f => { f.state.proofRequest.applicantCustomerId = "colleague"; },
    f => { f.state.proofRequest.payload.paymentProof.workspaceId = "other"; },
    f => { f.state.corporate.actions = f.state.corporate.actions.filter(action => action !== "finance:read"); },
    f => { f.state.order.contractSubjectCustomerId = "OtherCorp"; },
    f => { f.state.proofFile.metadata.contentHash = "b".repeat(64); }];
  for (const change of changes) { const f = await paymentProofHistoryFixture(); change(f); await assert.rejects(f.readProof()); assert.deepEqual(f.sent, []); }
  const revoke = await paymentProofHistoryFixture(); revoke.duringBytes = () => { revoke.state.corporate.revision++; };
  await assert.rejects(revoke.readProof()); assert.deepEqual(revoke.sent, []);
  const returned = await paymentProofHistoryFixture();
  await assert.rejects(returned.readProof(() => { returned.state.corporate.revision++; })); assert.deepEqual(returned.sent, []);
  const lateFile = await paymentProofHistoryFixture();
  await assert.rejects(lateFile.readProof(() => { lateFile.state.proofFile.uploadSession.status = "revoked"; })); assert.deepEqual(lateFile.sent, []);
  const lost = await paymentProofHistoryFixture(); lost.duringBytes = () => { lost.state.proofFile.status = "deleted"; };
  await assert.rejects(lost.readProof()); assert.deepEqual(lost.sent, []);
});
