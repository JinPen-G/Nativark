const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

// Worktrees can resolve an ancestor's workspace symlink. Always exercise this checkout's shared build.
const root = path.resolve(__dirname, "..");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return request === "@rental-os/shared"
    ? path.join(root, "packages/shared/dist/index.js")
    : resolveFilename.call(this, request, ...args);
};
require("ts-node").register({ project: path.join(root, "apps/api/tsconfig.json"), transpileOnly: true });
const { ValidationPipe, UnauthorizedException, RequestMethod } = require("@nestjs/common");
const { ClientApiService } = require("../apps/api/src/modules/client/client-api.service");
const { ClientApiController } = require("../apps/api/src/modules/client/client-api.controller");
const { ClientMyOrdersQueryDto, ClientMiniProgramPaymentIntentRequestDto } = require("../apps/api/src/modules/client/client-request.dto");
const { PaymentRuntimeService } = require("../apps/api/src/modules/integrations/payment.runtime.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { ApiAuthGuard, isClientPublicRoute, isClientRoute } = require("../apps/api/src/common/api-auth.guard");
const { runWithRequestIdentity, getRequestIdentity } = require("../apps/api/src/common/request-identity");
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");

const context = Object.freeze({
  tenantId: "tenant-a", tenantCode: "tenant-a-code", customerId: "person-a", customerType: "personal",
  workspaceId: "space-a", workspaceCode: "camera", workspaceName: "Camera", categoryCode: "camera",
  membershipStatus: "active", displayName: "Customer", phone: "13800000000", sessionId: "session-a"
});
const at = new Date("2026-09-18T00:00:00.000Z");
const fail = () => { throw new Error("Unexpected side effect or unscoped read"); };
const status = (value) => (error) => error?.getStatus?.() === value;
function api(overrides = {}) {
  return Object.assign(Object.create(ClientApiService.prototype), {
    core: { listOrders: fail, getOrder: fail, cancelOrder: fail, persist: fail },
    auth: { switchWorkspace: fail },
    idempotent: { executeWithReplayFlag: fail },
    business: { persist: fail },
    context: () => ({})
  }, overrides);
}
function indexOrder(id, overrides = {}) {
  return {
    id, tenantId: context.tenantId, workspaceId: "space-a", customerId: context.customerId,
    membershipSnapshot: null, orderNo: `ORDER-${id}`, categoryCode: "camera", status: "RESERVED",
    startAt: at, endAt: at, effectiveEndAt: null, finalPayableAmount: "100.25", currency: "CNY",
    createdAt: at, updatedAt: at,
    workspace: { id: "space-a", tenantId: context.tenantId, code: "camera", name: "Camera" },
    ...overrides
  };
}
function coreOrder(overrides = {}) {
  return { ...indexOrder("order-a"), status: "reserved", quoteId: "quote-a", lines: [], chargeLines: [], allocations: [], ...overrides };
}
const expectedWhere = {
  tenantId: "tenant-a", workspace: { tenantId: "tenant-a" },
  OR: [{ customerId: "person-a" }, { membershipSnapshot: { path: "$.personalCustomerId", equals: "person-a" } }]
};

test("my orders uses database pagination, tenant/self predicates, minimal projection and no session switching", async () => {
  const otherSpace = { id: "space-b", tenantId: context.tenantId, code: "camping", name: "Camping" };
  const allRows = [
    indexOrder("4", { workspaceId: "space-b", workspace: otherSpace, categoryCode: "camping" }),
    indexOrder("3", { customerId: "company", membershipSnapshot: { personalCustomerId: context.customerId, corporateCustomerId: "company" } }),
    indexOrder("2"),
    indexOrder("coworker", { customerId: "person-b", membershipSnapshot: { personalCustomerId: "person-b", corporateCustomerId: "company" } }),
    indexOrder("other-tenant", { tenantId: "tenant-b" })
  ];
  const matches = (row, where) => row.tenantId === where.tenantId && row.workspace.tenantId === where.workspace.tenantId
    && (row.customerId === where.OR[0].customerId || row.membershipSnapshot?.personalCustomerId === where.OR[1].membershipSnapshot.equals);
  let calls = 0;
  const lineRows = [
    { orderId: "4", itemGroupId: "tent", itemGroupName: "帐篷", quantity: 2 },
    { orderId: "4", itemGroupId: "lamp", itemGroupName: "营地灯", quantity: 1 },
    { orderId: "2", itemGroupId: "cam", itemGroupName: "相机", quantity: 1 }
  ];
  const service = api({ prisma: { $transaction: async (run, options) => {
    assert.equal(options.isolationLevel, "RepeatableRead");
    return run({ rentalOrder: {
      count: async ({ where }) => { assert.deepEqual(where, expectedWhere); return allRows.filter((row) => matches(row, where)).length; },
      findMany: async (query) => {
        calls++;
        assert.deepEqual(query.where, expectedWhere);
        assert.deepEqual(query.orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
        assert.equal(query.take, 2);
        assert.equal(query.skip, (calls - 1) * 2);
        for (const field of ["contactPhone", "subjectSnapshot", "chargeLines", "lines", "assignment"]) assert.equal(query.select[field], undefined);
        return allRows.filter((row) => matches(row, query.where)).slice(query.skip, query.skip + query.take);
      }
    }, rentalOrderLine: {
      // 商品摘要是独立的最小查询：只按本页订单 id 取型号名与数量，不带金额/资产字段。
      findMany: async (query) => {
        assert.deepEqual(Object.keys(query.select).sort(), ["itemGroupId", "itemGroupName", "orderId", "quantity"]);
        return lineRows.filter((row) => query.where.orderId.in.includes(row.orderId));
      }
    } });
  } } });
  const identity = { tenantId: context.tenantId, workspaceId: context.workspaceId, userId: context.customerId, isSaasAdmin: false };
  await runWithRequestIdentity(identity, async () => {
    const first = await service.myOrders(context, { page: 1, pageSize: 2 });
    assert.equal(first.total, 3);
    assert.deepEqual(first.items.map((row) => row.workspaceCode), ["camping", "camera"]);
    assert.equal(first.items[0].finalPayableAmount, 100.25);
    assert.equal(first.items[0].status, "reserved");
    assert.deepEqual(first.items[0].itemSummary, { firstItemGroupId: "tent", firstItemName: "帐篷", itemCount: 2, totalQuantity: 3 });
    assert.equal(first.items[1].itemSummary, undefined, "没有商品行的订单不伪造摘要");
    for (const row of first.items) {
      for (const field of ["tenantId", "workspaceId", "customerId", "membershipSnapshot", "phone", "contactPhone", "customerName", "subjectSnapshot"]) assert.equal(field in row, false);
    }
    const second = await service.myOrders(context, { page: 2, pageSize: 2 });
    assert.equal(second.total, 3);
    assert.deepEqual(second.items.map((row) => row.orderId), ["2"]);
    assert.deepEqual(second.items[0].itemSummary, { firstItemGroupId: "cam", firstItemName: "相机", itemCount: 1, totalQuantity: 1 });
    assert.deepEqual(getRequestIdentity(), identity);
    assert.equal(context.workspaceId, "space-a");
  });
});

test("my orders rechecks every returned tenant, workspace and personal owner", async () => {
  const unsafeRows = [
    indexOrder("foreign", { tenantId: "tenant-b" }),
    indexOrder("other", { customerId: "other" }),
    indexOrder("colleague", { customerId: "company", membershipSnapshot: { personalCustomerId: "other", corporateCustomerId: "company" } }),
    indexOrder("wrong-space-tenant", { workspace: { id: "space-a", tenantId: "tenant-b", code: "camera", name: "Other" } }),
    indexOrder("wrong-space-id", { workspaceId: "space-b" })
  ];
  for (const row of unsafeRows) {
    const service = api({ prisma: { $transaction: (run) => run({ rentalOrder: { count: async () => 2, findMany: async () => [indexOrder("safe"), row] }, rentalOrderLine: { findMany: fail } }) } });
    await assert.rejects(service.myOrders(context, {}), status(404));
  }
  await assert.rejects(api().myOrders({ ...context, customerType: "corporate", customerId: "company" }, {}), status(403));
});

test("query and payment DTOs validate bounds and strip untrusted scope/identity/amount fields", async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const queryMeta = { type: "query", metatype: ClientMyOrdersQueryDto };
  const query = await pipe.transform({ page: "2", pageSize: "50", tenantId: "foreign", customerId: "other", workspaceCode: "other" }, queryMeta);
  assert.deepEqual({ ...query }, { page: 2, pageSize: 50 });
  for (const input of [{ page: "abc" }, { page: "0" }, { page: "1.2" }, { page: "Infinity" }, { page: "1000001" }, { pageSize: "51" }, { pageSize: "0" }]) {
    await assert.rejects(pipe.transform(input, queryMeta), status(400));
  }
  for (const input of [{ page: NaN }, { page: Infinity }, { page: -1 }, { page: 1.1 }, { page: 1000001 }, { pageSize: 0 }, { pageSize: 51 }]) {
    await assert.rejects(api().myOrders(context, input), status(400));
  }
  const paymentMeta = { type: "body", metatype: ClientMiniProgramPaymentIntentRequestDto };
  const payment = await pipe.transform({ instrument: "rental", idempotencyKey: "retry-a", openid: "fake", amount: 1, tenantId: "foreign", method: "alipay", jsapi: {} }, paymentMeta);
  assert.deepEqual({ ...payment }, { instrument: "rental", idempotencyKey: "retry-a" });
  for (const input of [{ instrument: "deposit", idempotencyKey: "a" }, { instrument: "rental" }, { instrument: "rental", idempotencyKey: "a".repeat(192) }]) {
    await assert.rejects(pipe.transform(input, paymentMeta), status(400));
  }
});

test("cancellation preview reuses the existing charge calculation without any write/refund", async () => {
  const order = coreOrder();
  const quote = { request: { startAt: new Date(Date.now() + 3600_000).toISOString() }, ruleSnapshot: { cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 25 } }, payableAmount: 123.45 };
  const calculator = Object.create(RentalBusinessService.prototype);
  let calculations = 0;
  const service = api({
    core: { getOrder: async () => order, cancelOrder: fail, persist: fail },
    business: {
      getQuote: (tenantId, business, quoteId) => { assert.equal(tenantId, context.tenantId); assert.equal(quoteId, order.quoteId); return quote; },
      calculateCancellationCharge: (...args) => { calculations++; assert.equal(args[2], quote); return calculator.calculateCancellationCharge(...args); },
      persist: fail, releaseCouponInTransaction: fail
    }
  });
  const preview = await service.previewCancellation(context, order.id);
  assert.equal(preview.cancellationCharge, 30.86);
  assert.equal(preview.estimated, true);
  assert.equal(preview.currency, "CNY");
  assert.equal(order.status, "reserved");
  assert.equal(calculations, 1);
  for (const state of ["renting", "settling", "completed", "cancelled", "no_show"]) {
    order.status = state;
    await assert.rejects(service.previewCancellation(context, order.id), status(409));
  }
  order.status = "reserved";
  order.customerId = "other";
  await assert.rejects(service.previewCancellation(context, order.id), status(404));
  order.customerId = context.customerId;
  await assert.rejects(service.previewCancellation({ ...context, membershipStatus: "pending_activation" }, order.id), status(403));
  assert.equal(calculations, 1);
});

const replayActions = [
  (service) => service.cancelOrder(context, "order-a", { reason: "cancel" }),
  (service) => service.applyExtension(context, "order-a", { newEndAt: "2026-10-01T00:00:00.000Z" }),
  (service) => service.payExtension(context, "order-a", "extension-a")
];
test("cancellation and extension replays require ownership both before the executor and in replay", async () => {
  for (const action of replayActions) {
    const foreign = coreOrder({ customerId: "other" });
    await assert.rejects(action(api({ core: { getOrder: async () => foreign } })), status(404));
    let reads = 0;
    const service = api({
      core: { getOrder: async () => ++reads === 1 ? coreOrder() : foreign, listOrderExtensions: fail },
      idempotent: { executeWithReplayFlag: async (input) => ({ result: await input.replay({}), replayed: true }) }
    });
    await assert.rejects(action(service), status(404));
    assert.equal(reads, 2);
  }
});

test("valid self-owned replay remains available for cancelled orders and paid extensions", async () => {
  for (const [index, action] of replayActions.entries()) {
    const extension = { id: "extension-a", status: "effective", idempotencyKey: "client:order.extend:order-a:2026-10-01T00:00:00.000Z" };
    const service = api({
      core: { getOrder: async () => coreOrder({ status: index === 0 ? "cancelled" : "reserved" }), listOrderExtensions: async () => [extension], persist: async () => {} },
      business: { persist: async () => {} },
      idempotent: { executeWithReplayFlag: async (input) => ({ result: await input.replay({}), replayed: true }) }
    });
    const result = await action(service);
    assert.equal(result.replayed, true);
    assert.equal(result.order.id, "order-a");
  }
});

test("create-order replay uses assertClientOrder before returning a cached result", async () => {
  const service = api({
    core: { getOrder: async () => coreOrder({ customerId: "other" }), persist: fail },
    business: { getQuote: () => ({ request: { customerId: context.customerId, lines: [] } }), persist: fail },
    orders: { createOrder: async () => ({ order: coreOrder({ customerId: "other" }), replayed: true }) }
  });
  await assert.rejects(service.createOrder(context, { quoteId: "quote-a" }), status(404));
});

test("all payment reads/replays are protected by assertClientOrder, including tenant mismatch", async () => {
  const actions = [
    (s) => s.createPaymentIntent(context, "order-a", { instrument: "rental", method: "wechat_pay", idempotencyKey: "a" }),
    (s) => s.createMiniProgramPaymentIntent(context, "order-a", { instrument: "rental", idempotencyKey: "a" }),
    (s) => s.getPaymentIntent(context, "order-a", "intent-a"),
    (s) => s.refreshPaymentIntent(context, "order-a", "intent-a"),
    (s) => s.closePaymentIntent(context, "order-a", "intent-a")
  ];
  for (const order of [coreOrder({ customerId: "other" }), coreOrder({ tenantId: "tenant-b" })]) {
    for (const action of actions) await assert.rejects(action(api({ core: { getOrder: async () => order }, payments: new Proxy({}, { get: () => fail }) })), status(404));
  }
});

test("mini-program payment fails closed even with Native configuration and never replays a QR intent", async () => {
  const runtime = new PaymentRuntimeService(new Proxy({}, { get: () => fail }), {
    runtimeConfig: async () => ({ provider: "wechat_pay", settings: { appId: "wx-native", mchid: "merchant" } })
  }, new Proxy({}, { get: () => fail }));
  runtime.createPaymentIntent = fail;
  runtime.createWechatIntent = fail;
  const service = api({ core: { getOrder: async () => coreOrder() }, payments: runtime });
  // openid 只来自服务端可信绑定；未绑定时用稳定错误码 409 引导先绑微信，绝不退回 Native 二维码，也不重放已存在的支付单。
  for (const key of ["first", "retry", "existing-native-key"]) {
    await assert.rejects(service.createMiniProgramPaymentIntent(context, "order-a", { instrument: "rental", idempotencyKey: key }),
      (error) => status(409)(error) && error.getResponse?.().code === "wechat_identity_required");
  }
  await assert.rejects(runtime.createMiniProgramPaymentIntent("t", "w", "o", { instrument: "deposit", idempotencyKey: "a" }), status(400));
  await assert.rejects(runtime.createMiniProgramPaymentIntent("t", "w", "o", { instrument: "rental", idempotencyKey: "  " }), status(400));
  const native = runtime.toResponse({ id: "intent-a", provider: "wechat_pay", method: "wechat_pay", instrument: "rental", amount: 100, currency: "CNY", status: "pending", checkoutUrl: "weixin://wxpay/native-code", expiresAt: at, paidAt: null, responseJson: { jsapi: { paySign: "untrusted" } } });
  assert.equal(native.checkoutUrl, "weixin://wxpay/native-code");
  assert.equal("jsapi" in native, false);
});

test("new routes and catalog stay in client auth domain; operational/absent tokens do not pass", async () => {
  const routes = [["GET", "/api/client/v1/my/orders"], ["POST", "/api/client/v1/orders/order-a/cancel/preview"], ["POST", "/api/client/v1/orders/order-a/mini-program-payment-intents"], ["GET", "/api/client/v1/catalog"]];
  const guard = new ApiAuthGuard({ resolveAccessContext: fail }, undefined, {
    authenticate: async (token) => { if (token !== "client-good") throw new UnauthorizedException(); return context; }
  }, { assertAllowed: async () => {} });
  for (const [method, url] of routes) {
    assert.equal(isClientRoute(url.slice(4)), true);
    assert.equal(isClientPublicRoute(method, url.slice(4)), false);
    for (const token of [undefined, "admin-token", "client-good"]) {
      const request = { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} };
      const execution = { switchToHttp: () => ({ getRequest: () => request }) };
      await runWithRequestIdentity({}, async () => {
        if (token === "client-good") { assert.equal(await guard.canActivate(execution), true); assert.equal(request.client, context); }
        else await assert.rejects(guard.canActivate(execution), status(401));
      });
    }
  }
  assert.equal(Reflect.getMetadata("path", ClientApiController.prototype.myOrders), "my/orders");
  assert.equal(Reflect.getMetadata("path", ClientApiController.prototype.previewCancellation), "orders/:id/cancel/preview");
  assert.equal(Reflect.getMetadata("path", ClientApiController.prototype.createMiniProgramPaymentIntent), "orders/:id/mini-program-payment-intents");
  // wx.request 不支持 PATCH：PUT /profile 必须是同一处理器的别名，且与 PATCH 同样落在客户端鉴权域内。
  assert.equal(Reflect.getMetadata("path", ClientApiController.prototype.updateProfileViaPut), "profile");
  assert.equal(Reflect.getMetadata("method", ClientApiController.prototype.updateProfileViaPut), RequestMethod.PUT);
  assert.equal(Reflect.getMetadata("method", ClientApiController.prototype.updateProfile), RequestMethod.PATCH);
  assert.equal(isClientPublicRoute("PUT", "/client/v1/profile"), false);
  {
    const calls = [];
    const service = api({ updateProfile: async (ctx, body) => { calls.push([ctx, body]); return { ok: true }; } });
    const controller = Object.assign(Object.create(ClientApiController.prototype), { api: service, auth: {} });
    await controller.updateProfileViaPut({ client: context }, { name: "新名字", email: null });
    await controller.updateProfile({ client: context }, { name: "新名字", email: null });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(Object.prototype.hasOwnProperty.call(ClientApiService.prototype, "updateProfile"), true);
  }
});

test("OpenAPI exposes minimal typed index and JSAPI contract, documents unavailable payment honestly", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  for (const [route, method] of [["/api/client/v1/my/orders", "get"], ["/api/client/v1/orders/{id}/cancel/preview", "post"], ["/api/client/v1/orders/{id}/mini-program-payment-intents", "post"], ["/api/client/v1/catalog", "get"]]) {
    assert.deepEqual(paths[route][method].security, [{ bearerAuth: [] }]);
    assert.deepEqual(paths[route][method]["x-requiredPermissions"], []);
  }
  const payment = paths["/api/client/v1/orders/{id}/mini-program-payment-intents"].post;
  // 微信 JSAPI 支付已接通：成功返回可重新签名的支付参数；缺可信身份时运行时用 409 wechat_identity_required 引导先绑微信（摘要注明）。
  assert.equal(payment.responses["200"].content["application/json"].schema.properties.data.$ref, "#/components/schemas/ClientPaymentIntentResponse");
  assert.match(payment.summary, /wechat_identity_required/u);
  const schemas = OPENAPI_DOCUMENT.components.schemas;
  assert.deepEqual(schemas.ClientWechatJsapiParameters.required, ["timeStamp", "nonceStr", "package", "signType", "paySign"]);
  assert.equal(schemas.ClientPaymentIntentResponse.properties.jsapi.$ref, "#/components/schemas/ClientWechatJsapiParameters");
  assert.equal(schemas.MyOrderIndex.additionalProperties, false);
  assert.equal(schemas.MyOrderIndex.properties.customerId, undefined);
  assert.deepEqual(schemas.MyOrderIndex.properties.itemSummary.required, ["firstItemGroupId", "firstItemName", "itemCount", "totalQuantity"]);
  assert.equal(schemas.MyOrderIndex.properties.itemSummary.additionalProperties, false);
});

test("catalog projects a starting price from the effective space rates and public location details only", async () => {
  const rates = [
    { id: "r1", pricingGroupId: "pg-std", itemGroupId: "cam", unit: "calendar_day", baseAmount: 150 },
    { id: "r2", pricingGroupId: "pg-pro", itemGroupId: "cam", unit: "calendar_day", baseAmount: 120 },
    { id: "r3", itemGroupId: "lens", unit: "day_24h", baseAmount: 80 },
    { id: "r4", itemGroupId: "lens", unit: "hour", baseAmount: -1 }
  ];
  const business = {
    profile: { categoryCode: "camera", terminology: {} },
    settings: { calendar: { timeZone: "Asia/Shanghai" }, pricing: { currency: "CNY" }, fulfillment: { enabledModes: ["store_pickup_return", "delivery"], allowDifferentReturnLocation: true } },
    groups: [
      { id: "cam", code: "CAM", name: "相机", status: "enabled", inventoryMode: "serialized", images: [], attributes: {} },
      { id: "lens", code: "LENS", name: "镜头", status: "enabled", inventoryMode: "quantity", attributes: {} },
      { id: "tripod", code: "TRI", name: "三脚架", status: "enabled", inventoryMode: "quantity", attributes: {} },
      { id: "old", code: "OLD", name: "下架", status: "disabled", inventoryMode: "quantity", attributes: {} }
    ],
    pricingGroups: [
      { id: "pg-std", code: "STD", name: "标准", status: "enabled", memberItemGroupIds: ["cam"] },
      { id: "pg-pro", code: "PRO", name: "专业", status: "enabled", memberItemGroupIds: ["cam"] },
      { id: "pg-off", code: "OFF", name: "停用", status: "disabled", memberItemGroupIds: ["tripod"] }
    ],
    locations: [
      { id: "l1", code: "L1", name: "静安店", status: "enabled", address: "南京西路 1266 号", businessHours: "10:00-20:00", contactPhone: "021-000000", capabilities: ["pickup", "return"], operatorId: "op", operatorType: "partner", operatorName: "内部合作方" },
      { id: "l2", code: "L2", name: "停用店", status: "disabled", capabilities: ["pickup"] }
    ]
  };
  const service = api({
    context: () => business,
    auth: { listPublicWorkspaces: async () => ({ workspaces: [{ code: "camera", isDefault: true }] }) },
    business: { listSpaceRatesAt: async (tenantId, ctx, at) => { assert.equal(tenantId, context.tenantId); assert.equal(ctx, business); assert.ok(Date.parse(at)); return rates; }, listServices: () => [], listDiscountPlans: () => [] }
  });
  const catalog = await service.catalog(context);
  const byId = Object.fromEntries(catalog.items.map((item) => [item.id, item]));
  assert.deepEqual(byId.cam.startingPrice, { amount: 120, unit: "calendar_day", currency: "CNY" }, "定价分组中取最低基础价");
  assert.deepEqual(byId.lens.startingPrice, { amount: 80, unit: "day_24h", currency: "CNY" }, "负数费率不参与");
  assert.equal(byId.tripod.startingPrice, undefined, "停用定价分组不提供起价，也不以 0 元替代");
  assert.equal(byId.old, undefined);
  assert.deepEqual(catalog.locations, [{ id: "l1", code: "L1", name: "静安店", status: "enabled", address: "南京西路 1266 号", businessHours: "10:00-20:00", contactPhone: "021-000000", capabilities: ["pickup", "return"] }]);
  assert.deepEqual(catalog.fulfillment, { enabledModes: ["store_pickup_return", "delivery"], allowDifferentReturnLocation: true }, "履约方式投影透传经营空间设置");
  for (const location of catalog.locations) for (const field of ["operatorId", "operatorType", "operatorName", "settlementMode"]) assert.equal(field in location, false);
  const noVersion = api({ context: () => business, auth: { listPublicWorkspaces: async () => ({ workspaces: [] }) }, business: { listSpaceRatesAt: async () => [], listServices: () => [], listDiscountPlans: () => [] } });
  assert.ok((await noVersion.catalog(context)).items.every((item) => item.startingPrice === undefined));
});
