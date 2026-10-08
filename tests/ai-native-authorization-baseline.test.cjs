"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { AuthService } = require("../apps/api/src/modules/auth/auth.service");
const { ClientAuthService } = require("../apps/api/src/modules/client/client-auth.service");
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");
const { runWithRequestIdentity, getRequestIdentity } = require("../apps/api/src/common/request-identity");
const { resolveScopeWorkspaceId } = require("../apps/api/src/modules/rental-core/workspace-scope");
const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalDocumentService } = require("../apps/api/src/modules/rental-core/rental-document.service");
const { RentalOrderConfirmationService } = require("../apps/api/src/modules/rental-core/rental-order-confirmation.service");
const { requestFingerprint } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository");
const { RentalWorkspaceReportRepository } = require("../apps/api/src/modules/rental-core/rental-workspace-report.repository");
const f = require("./fixtures/ai-native/authorization-baseline.cjs");
const attempts = [], originalConnect = net.Socket.prototype.connect, originalFetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("S03 forbids external sockets"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("S03 forbids external fetch"); };
});
test.after(() => {
  net.Socket.prototype.connect = originalConnect; global.fetch = originalFetch;
  assert.deepEqual(attempts, []);
});

function authHarness(overrides = {}) {
  const state = { user: f.user(), workspaceId: "workspace-a", authorized: true, sessionActive: true,
    audience: "operator", ...overrides };
  const reads = [];
  // Session/user/member lookup substitutes. AuthService JWT/audience/scope selection itself is real.
  const platform = {
    getAuthSession: async () => state.sessionActive ? { id: "session-a", userId: state.user.id,
      audience: state.audience, currentWorkspaceId: state.workspaceId } : undefined,
    findUserById: async () => state.user,
    findWorkspaceScopedUser: async (...args) => { reads.push(args); return state.authorized ? state.user : undefined; },
    listUserWorkspaces: async () => []
  };
  const auth = new AuthService(platform, { get: key => key === "AUTH_TOKEN_SECRET" ? "S03-synthetic-test-only" : undefined });
  const token = (changes = {}) => auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId,
    sid: "session-a", aud: state.audience, wid: "untrusted-token-workspace", exp: Math.floor(Date.now() / 1000) + 600, ...changes });
  return { state, auth, token, reads };
}
async function activate(h, req, prisma) {
  req.headers = { authorization: `Bearer ${h.token()}`, ...req.headers };
  const guard = new ApiAuthGuard(h.auth, undefined, undefined, undefined, prisma);
  return runWithRequestIdentity(f.identity(), async () => {
    const allowed = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
    return { allowed, identity: structuredClone(getRequestIdentity()) };
  });
}

for (const [sessionAudience, routeAudience] of [["operator", "staff"], ["staff", "operator"]]) {
  test(`real AuthService + Guard reject ${sessionAudience} session at ${routeAudience} entry despite identical permissions`, async () => {
    const h = authHarness({ audience: sessionAudience });
    const req = f.request(undefined, routeAudience === "staff" ? { originalUrl: "/api/staff/v1/orders/order-a", staffApiRequest: true } : {});
    await assert.rejects(() => activate(h, req), /请先登录/u);
    assert.equal(req.user, undefined);
  });
}
test("operator session is not a client audience token, and client audience cannot enter operator API", async () => {
  const h = authHarness();
  assert.equal(await h.auth.resolveAccessContext(`Bearer ${h.token()}`, { audience: "client" }), undefined);
  const req = f.request(undefined, { headers: { authorization: `Bearer ${h.token({ aud: "client" })}` } });
  await assert.rejects(() => activate(h, req), /请先登录/u);
  // This is NOT ClientAuthService.authenticate or a client-resource ownership acceptance test.
});

test("valid staff audience positive control reaches the actual scoped order Guard", async () => {
  const h = authHarness({ audience: "staff", user: f.user({ locationScope: { mode: "selected", locationIds: ["location-a"] } }) });
  const queries = [];
  const req = f.request(undefined, { originalUrl: "/api/staff/v1/orders/order-a", staffApiRequest: true });
  const prisma = { rentalOrder: { findFirst: async ({ where }) => { queries.push(where); return { id: "order-a" }; } } };
  assert.equal((await activate(h, req, prisma)).allowed, true);
  assert.equal(queries[0].tenantId, "tenant-a");
  assert.equal(queries[0].workspaceId, "workspace-a");
});

test("real client authentication binds resource session and rejects operator token, revoked or foreign workspace", async () => {
  const queries = [];
  const state = { available: true, workspaceTenant: "tenant-a" };
  const prisma = {
    clientAuthSession: {
      findFirst: async ({ where }) => {
        queries.push(where);
        return state.available ? { id: "client-session-a", expiresAt: new Date(Date.now() + 60_000),
          tenant: { code: "synthetic", status: "ACTIVE" }, customer: { customerType: "personal", name: "Synthetic", phone: "" },
          workspace: { tenantId: state.workspaceTenant, status: "ACTIVE", code: "synthetic", name: "Synthetic", categoryCode: "CAMERA" } } : null;
      },
      updateMany: async () => ({ count: 1 })
    },
    customerAccount: { findFirst: async () => ({ status: "active", customer: { status: "active" } }) },
    customerMembership: { findFirst: async () => ({ status: "active" }) }
  };
  const clientAuth = new ClientAuthService(prisma, {}, {}, {});
  // Replace only secret retrieval: no process.env/.env read; actual signer/parser/authenticate remain intact.
  clientAuth.secret = () => "S03-synthetic-test-only";
  const token = clientAuth.sign({ typ: "client", sub: "customer-a", tid: "tenant-a", sid: "client-session-a",
    wid: "workspace-a", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
  const rateCalls = [];
  const guard = new ApiAuthGuard(authHarness().auth, undefined, clientAuth,
    { assertAllowed: async input => { rateCalls.push(input); } });
  const req = f.request("/client/v1/orders/order-a", { headers: { authorization: `Bearer ${token}` } });
  const identity = await runWithRequestIdentity(f.identity(), async () => {
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
    return structuredClone(getRequestIdentity());
  });
  assert.equal(identity.userId, "customer-a");
  assert.equal(identity.workspaceId, "workspace-a");
  assert.equal(req.user, undefined);
  assert.equal(rateCalls.length, 2); // Real rate policy itself is not under test.
  assert.deepEqual(queries[0], { id: "client-session-a", tenantId: "tenant-a", customerId: "customer-a", workspaceId: "workspace-a", revokedAt: null });
  await assert.rejects(() => clientAuth.authenticate(authHarness().token()), /客户端令牌无效/u);
  state.workspaceTenant = "tenant-b";
  await assert.rejects(() => clientAuth.authenticate(token), /客户端会话已失效/u);
  state.available = false;
  await assert.rejects(() => clientAuth.authenticate(token), /客户端会话已失效/u);
  // Client resource ownership AFTER authentication is not covered by this session boundary.
});
test("SaaS role cannot read tenant orders even with matching route permissions", async () => {
  const h = authHarness({ user: f.user({ isSaasAdmin: true }) });
  await assert.rejects(() => activate(h, f.request()), /SaaS 平台管理员只能/u);
});
test("token tenant mismatch and disabled account fail actual AuthService resolution", async () => {
  const h = authHarness();
  assert.equal(await h.auth.resolveAccessContext(`Bearer ${h.token({ tid: "tenant-b" })}`), undefined);
  h.state.user.isActive = false;
  await assert.rejects(() => activate(h, f.request()), /请先登录/u);
});
test("session workspace overrides forged token/body/query workspace and tenant", async () => {
  const h = authHarness();
  const req = f.request(undefined, { body: { tenantId: "tenant-b", workspaceId: "workspace-b" }, query: { workspaceId: "workspace-b" } });
  const result = await activate(h, req);
  assert.equal(result.allowed, true);
  assert.equal(result.identity.tenantId, "tenant-a");
  assert.equal(result.identity.workspaceId, "workspace-a");
  assert.equal(h.reads[0][1], "workspace-a");
});
test("missing workspace and revoked membership cannot access operational resources", async () => {
  const missing = authHarness({ workspaceId: undefined });
  await assert.rejects(() => activate(missing, f.request()), /没有经营空间/u);
  const revoked = authHarness({ authorized: false });
  await assert.rejects(() => activate(revoked, f.request()), /请先登录/u);
  // platform route allows invalid-workspace lookup, but the guard must reject operational fallback.
  await assert.rejects(() => activate(revoked, f.request("/platform/workspace-customers/customer-a")), /访问权已被撤销/u);
});
test("revocation and permission changes are reread rather than inherited from a still-valid token", async () => {
  const h = authHarness();
  const req = f.request();
  assert.equal((await activate(h, req)).allowed, true);
  h.state.user.permissions = [];
  await assert.rejects(() => activate(h, f.request()), /无权访问/u);
  h.state.user.permissions = ["rental-os:order:view"];
  h.state.sessionActive = false;
  await assert.rejects(() => activate(h, f.request()), /请先登录/u);
});
test("actual workspace resolver rejects cross-tenant space even with the same route permission", async () => {
  const queries = [];
  const prisma = { businessWorkspace: { findFirst: async ({ where }) => {
    queries.push(where); return where.id === "workspace-a" && where.tenantId === "tenant-a" ? { id: "workspace-a" } : null;
  } } };
  assert.equal(await runWithRequestIdentity(f.identity(), () => resolveScopeWorkspaceId(prisma, "tenant-a")), "workspace-a");
  await assert.rejects(() => runWithRequestIdentity(f.identity({ workspaceId: "workspace-b" }),
    () => resolveScopeWorkspaceId(prisma, "tenant-a")), /不属于目标租户/u);
  assert.deepEqual(queries[1], { id: "workspace-b", tenantId: "tenant-a" });
});
test("own and location scopes reach real Guard resource checks, not merely route permissions", async () => {
  const h = authHarness({ user: f.user({ dataScope: "own", locationScope: { mode: "selected", locationIds: ["location-a"] } }) });
  const queries = [];
  let visible = true;
  const prisma = { rentalOrder: { findFirst: async ({ where }) => { queries.push(where); return visible ? { id: "order-a" } : null; } } };
  assert.equal((await activate(h, f.request(), prisma)).allowed, true);
  assert.deepEqual(queries[0], { id: "order-a", tenantId: "tenant-a", workspaceId: "workspace-a", AND: [
    { OR: [{ fulfillmentLocationId: { in: ["location-a"] } }, { returnLocationId: { in: ["location-a"] } }] },
    { OR: [{ createdBy: "operator-a" }, { workOrders: { some: { OR: [{ createdBy: "operator-a" }, { assigneeId: "operator-a" }] } } }] }
  ] });
  visible = false;
  await assert.rejects(() => activate(h, f.request(), prisma), /订单不存在或不在当前账号/u);
});
test("selected empty scope denies before resource reads; narrowing denies former location", async () => {
  const h = authHarness({ user: f.user({ locationScope: { mode: "selected", locationIds: [] } }) });
  let reads = 0;
  const prisma = { rentalOrder: { findFirst: async () => { reads++; return { id: "order-a" }; } } };
  await assert.rejects(() => activate(h, f.request(), prisma), /履约地点范围未就绪/u);
  assert.equal(reads, 0);
  const makeRequest = () => f.request("/rental/v1/orders", { method: "POST", body: { fulfillmentLocationId: "location-a" } });
  h.state.user.locationScope.locationIds = ["location-a"];
  assert.equal((await activate(h, makeRequest(), prisma)).allowed, true);
  h.state.user.locationScope.locationIds = ["location-b"];
  await assert.rejects(() => activate(h, makeRequest(), prisma), /不在当前账号授权范围内/u);
});
test("own scope cannot use space-wide inventory report even when route permissions exist", async () => {
  const reports = new RentalWorkspaceReportRepository({});
  await assert.rejects(() => runWithRequestIdentity(f.identity({ dataScope: "own" }),
    () => reports.getOperationReport("tenant-a", "workspace-a", "camera")), /仅本人数据范围无法查看/u);
});

test("tenant-wide member management can omit workspace; qualification options still require valid workspace", async () => {
  const h = authHarness({ workspaceId: undefined, user: f.user({ permissions: ["*"] }) });
  assert.equal((await activate(h, f.request("/membership/personal"))).allowed, true);
  await assert.rejects(() => activate(h, f.request("/membership/qualification-options")), /已授权且启用的经营空间/u);
});
test("tenant member candidate does not imply current workspace booking qualification", async () => {
  const queries = [];
  const prisma = {
    businessWorkspace: { findFirst: async ({ where }) => { queries.push(where); return { id: where.id, categoryCode: "VEHICLE" }; } },
    customerProfile: { findMany: async ({ where }) => { queries.push(where); return [{ id: "customer-a", name: "Synthetic", phoneMasked: "***", membership: { status: "active" } }]; },
      findFirst: async () => ({ id: "customer-a", customerType: "personal", name: "Synthetic" }) },
    customerMembership: { findUnique: async () => ({ status: "active" }) },
    customerQualificationRef: { findMany: async () => [] }, customerMembershipQualificationType: { findMany: async ({ where }) => { queries.push(where); return []; } },
    customerMembershipPlanAssignment: { findFirst: async () => null }
  };
  const members = new MembershipService(prisma, {});
  const candidates = await runWithRequestIdentity(f.identity({ workspaceId: undefined }), () => members.listPersonalOptions("tenant-a"));
  assert.equal(candidates[0].customerId, "customer-a");
  await assert.rejects(() => runWithRequestIdentity(f.identity(), () => members.assertBookingQualificationForAction(
    "tenant-a", "workspace-a", { personalCustomerId: "customer-a", bookingIdentity: "personal" },
    { required: true, documentTypes: ["driving_license"], minimumValidityDays: 0 }, "submit",
    { validThroughAt: "2026-01-02T00:00:00Z", minimumValidityFromAt: "2026-01-01T00:00:00Z" })), /资格校验未通过/u);
  assert.ok(queries.some(row => row.workspaceId === "workspace-a" && row.status === "enabled"));
});
test("restricted membership options query visible orders; direct outside-customer booking is rejected", async () => {
  const queries = [];
  const members = new MembershipService({
    businessWorkspace: { findFirst: async () => ({ id: "workspace-a" }) },
    rentalOrder: { findMany: async ({ where }) => { queries.push(where); return []; }, findFirst: async ({ where }) => { queries.push(where); return null; } },
    customerProfile: { findMany: async ({ where }) => { queries.push(where); return []; }, findFirst: async () => null }
  }, {});
  const identity = f.identity({ dataScope: "own", locationScope: { mode: "selected", locationIds: [] } });
  assert.deepEqual(await runWithRequestIdentity(identity, () => members.listPersonalOptions("tenant-a")), []);
  assert.equal(queries[0].tenantId, "tenant-a");
  assert.deepEqual(queries[0].AND[0].OR[0].fulfillmentLocationId.in, ["__no_authorized_location__"]);
  await assert.rejects(() => runWithRequestIdentity(identity, () => members.listBookingOptions("tenant-a", "workspace-a", "outside")), /不在当前账号的数据范围内/u);
});

function documentHarness() {
  const core = { getOrder: async () => f.order(), listInspections: async () => [], listInspectionTemplates: async () => [],
    resolveWorkspaceId: () => "workspace-a", getBusinessSettings: () => ({ calendar: { timeZone: "Asia/Shanghai" } }) };
  const fundingCalls = [];
  const funding = { listEvents: async (...args) => { fundingCalls.push(args); return undefined; } };
  return { core, funding, fundingCalls };
}
test("same order permission yields financial document read only with extra finance permission", async () => {
  const h = documentHarness();
  const controller = new RentalCoreController(h.core, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, new RentalDocumentService(h.core, h.funding));
  const req = { user: f.user() };
  const clipped = await controller.orderDocument(req, "order-a", "settlement");
  assert.equal(clipped.snapshot.financial.visible, false);
  assert.equal(h.fundingCalls.length, 0);
  req.user.permissions.push("rental-os:finance:view");
  await controller.orderDocument(req, "order-a", "settlement");
  assert.equal(h.fundingCalls.length, 1);
  assert.deepEqual(h.fundingCalls[0], ["tenant-a", "workspace-a", "order-a"]);
});
test("historical financial document remains forbidden without finance permission; queries bind full resource scope", async () => {
  const h = documentHarness(), queries = [];
  let available = true;
  const documents = new RentalDocumentService(h.core, h.funding, { rentalOrderDocumentSnapshot: {
    findFirst: async ({ where }) => { queries.push(where); return available ? f.historicalDocument() : null; }
  } });
  const controller = new RentalCoreController(h.core, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, documents);
  const req = { user: f.user() };
  await assert.rejects(() => controller.orderDocumentVersion(req, "order-a", "settlement", "snapshot-a"), /无权读取含资金明细/u);
  req.user.permissions.push("rental-os:finance:reconcile");
  assert.equal((await controller.orderDocumentVersion(req, "order-a", "settlement", "snapshot-a")).snapshotId, "snapshot-a");
  available = false;
  await assert.rejects(() => controller.orderDocumentVersion(req, "order-a", "settlement", "other-space-snapshot"), /历史凭证不存在/u);
  assert.deepEqual(queries[0], { id: "snapshot-a", tenantId: "tenant-a", workspaceId: "workspace-a", orderId: "order-a", documentType: "settlement" });
});
test("KNOWN BOUNDARY: normal order detail is not the document financial clipping path", async () => {
  const stores = require("./helpers/absorbing-config-store.cjs");
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: "workspace-a", tenantId: "tenant-a", categoryCode: "camera", isDefault: true }];
  const facts = stores.createAbsorbingFactStore();
  facts.findOrder = async () => f.order();
  const core = new RentalCoreService(config, facts);
  await core.onApplicationBootstrap();
  const controller = new RentalCoreController(core);
  const detail = await runWithRequestIdentity(f.identity(), () => controller.order({ user: f.user() }, "order-a"));
  assert.equal(detail.depositAmount, 20);
  assert.equal(detail.finalPayableAmount, 100);
  // Characterizes normal detail; does not assert that the current product promises to hide these amounts.
});

function creationHarness() {
  const calls = [], events = [];
  const core = { getProfile: () => ({}), getWorkspaceCategory: async () => ({}), getBusinessSettings: () => ({}),
    listItemGroups: () => [], listPricingGroups: () => [], listCouponTemplates: () => [], listLocations: () => [], listOperators: () => [], persist: async () => undefined };
  const business = { persist: async () => undefined, emitNotificationEvent: async (...args) => { events.push(args); return []; } };
  const confirmation = { createOrder: async (...args) => { calls.push(args); return { order: f.order(), replayed: false }; } };
  return { controller: new RentalCoreController(core, undefined, business, confirmation), core, business, calls, events };
}
test("order route permission alone cannot authorize capability exception; controller stamps actor fields", async () => {
  const h = creationHarness(), req = { user: f.user(), headers: { "idempotency-key": "S03-create" } };
  await assert.rejects(() => h.controller.createOrder(req, f.createOrderInput()), /能力风险例外确认/u);
  assert.equal(h.calls.length, 0); assert.equal(h.events.length, 0);
  req.user.permissions.push("rental-core:capability:override");
  await h.controller.createOrder(req, f.createOrderInput());
  const exception = h.calls[0][1].capabilityExceptions[0];
  assert.equal(exception.confirmedBy, req.user.displayName);
  assert.equal(exception.confirmedWithPermission, "rental-core:capability:override");
  assert.notEqual(exception.confirmedAt, "2000-01-01T00:00:00Z");
  assert.ok(Number.isFinite(Date.parse(exception.confirmedAt)));
  assert.equal(h.calls[0][0], "tenant-a");
});
test("actual application early replay reaches controller without duplicate creation notification", async () => {
  const h = creationHarness(), body = { quoteId: "quote-a", customerName: "Synthetic customer", customerType: "personal" };
  const requestHash = requestFingerprint({ ...body, capabilityExceptions: [] });
  const app = new RentalOrderConfirmationService({}, h.core, h.business,
    { findOrder: async () => f.order() }, {}, { find: async () => ({ requestHash, orderId: "order-a" }) });
  const controller = new RentalCoreController(h.core, undefined, h.business, app);
  const req = { user: f.user(), headers: { "idempotency-key": "S03-create" } };
  await controller.createOrder(req, body);
  await controller.createOrder(req, body);
  assert.equal(h.events.length, 0, "already committed order replay never emits new creation notification");
  await assert.rejects(() => controller.createOrder(req, { ...body, customerName: "changed" }), /相同幂等键.*不同/u);
});
