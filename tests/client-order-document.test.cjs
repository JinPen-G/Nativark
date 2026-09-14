const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const { ClientApiService } = require(path.join(repo, "apps/api/dist/modules/client/client-api.service.js"));

const context = {
  tenantId: "tenant_client_docs",
  tenantCode: "client-docs",
  customerId: "customer-1",
  customerType: "personal",
  displayName: "测试会员",
  phone: "13800000000",
  workspaceId: "workspace-1",
  workspaceCode: "camera",
  workspaceName: "摄影空间",
  categoryCode: "camera",
  membershipStatus: "active",
  sessionId: "session-1"
};

const service = Object.create(ClientApiService.prototype);
let renderInput;
service.assertClientOrder = async (_context, orderId) => {
  assert.equal(orderId, "order-1");
  return { id: orderId };
};
service.context = () => ({ profile: { terminology: { itemLabel: "器材" } } });
service.documents = {
  render: async (...args) => {
    renderInput = args;
    return { documentType: args[2], source: "server-renderer" };
  }
};

(async () => {
  const result = await service.orderDocument(context, "order-1", "settlement");
  assert.deepEqual(result, { documentType: "settlement", source: "server-renderer" });
  assert.deepEqual(renderInput, [
    context.tenantId,
    "order-1",
    "settlement",
    { includeFinancial: true, terminology: { itemLabel: "器材" } }
  ], "客户端凭证必须复用服务端渲染器并只传会话租户与品类术语");

  await assert.rejects(
    () => {
      service.assertClientOrder = async () => { throw new Error("订单不存在"); };
      return service.orderDocument(context, "other-order", "quote");
    },
    /订单不存在/u,
    "会员不属于自己的订单时不能渲染凭证"
  );

  const controllerSource = fs.readFileSync(
    path.join(repo, "apps/api/src/modules/client/client-api.controller.ts"),
    "utf8"
  );
  const contractSource = fs.readFileSync(
    path.join(repo, "apps/api/src/contracts/openapi-document.ts"),
    "utf8"
  );
  assert.match(controllerSource, /@Get\("orders\/:id\/documents\/:type"\)/u);
  assert.match(contractSource, /\/api\/client\/v1\/orders\/\{id\}\/documents\/\{type\}/u);
  console.log("client order document test passed: ownership gate, shared renderer and OpenAPI entry covered");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
