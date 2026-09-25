const assert = require("node:assert/strict");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { ClientApiService } = require("../apps/api/dist/modules/client/client-api.service.js");

const models = [
  { id: "body-a", code: "BODY-A", status: "enabled" },
  { id: "body-b", code: "BODY-B", status: "enabled" }
];
const pricingGroup = {
  id: "group", code: "CAM-BODY", name: "相机机身", status: "enabled",
  memberItemGroupIds: models.map((model) => model.id)
};
const service = {
  factContext: async () => ({ pricingGroups: [pricingGroup] }),
  loadInventorySnapshot: async () => ({}),
  group: (_state, id) => models.find((model) => model.id === id),
  availableQuantity: () => 1,
  computeAvailability: () => ({ available: true })
};
const base = {
  fulfillmentLocationId: "store", startAt: "2030-01-01T00:00:00.000Z",
  endAt: "2030-01-02T00:00:00.000Z"
};

void (async () => {
  const groupQuote = await RentalCoreService.prototype.resolvePricingGroupQuoteRequest.call(service, "tenant", {
    ...base, lines: [{ pricingGroupId: "group", quantity: 1, reservationPrecision: "exact_model",
      pricingGroupMemberItemGroupIds: ["foreign"], pricingGroupCode: "spoofed" }]
  });
  assert.equal(groupQuote.lines[0].reservationPrecision, "group", "客户端不能自报准确型号精度");
  assert.deepEqual(groupQuote.lines[0].pricingGroupMemberItemGroupIds, ["body-a", "body-b"], "成员范围必须来自服务端");
  assert.equal(groupQuote.lines[0].pricingGroupCode, "CAM-BODY", "名称编码快照必须来自服务端");

  const exactQuote = await RentalCoreService.prototype.resolvePricingGroupQuoteRequest.call(service, "tenant", {
    ...base, lines: [{ pricingGroupId: "group", itemGroupId: "body-b", quantity: 1,
      reservationPrecision: "group", pricingGroupMemberItemGroupIds: ["body-a"] }]
  });
  assert.equal(exactQuote.lines[0].itemGroupId, "body-b");
  assert.equal(exactQuote.lines[0].reservationPrecision, "exact_model", "客户指定型号时必须冻结准确型号精度");
  assert.deepEqual(exactQuote.lines[0].pricingGroupMemberItemGroupIds, ["body-a", "body-b"]);

  await assert.rejects(
    RentalCoreService.prototype.resolvePricingGroupQuoteRequest.call(service, "tenant", {
      ...base, lines: [{ pricingGroupId: "group", itemGroupId: "foreign", quantity: 1 }]
    }),
    /不属于该定价分组/,
    "准确型号必须属于所选定价分组"
  );

  let clientResolved = false;
  const clientService = {
    requireActiveMembership: () => undefined,
    context: () => ({}),
    core: {
      resolvePricingGroupQuoteRequest: async (_tenantId, request) => {
        clientResolved = true;
        assert.equal(request.lines[0].itemGroupId, undefined, "客户端可只选定价组");
        return { ...request, lines: [{ ...request.lines[0], itemGroupId: "body-a", reservationPrecision: "group" }] };
      }
    },
    business: {
      createQuote: async (_tenantId, _context, request) => {
        assert.equal(request.lines[0].reservationPrecision, "group", "客户端报价必须使用服务端解析结果");
        return { id: "quote-client", request };
      }
    }
  };
  const clientQuote = await ClientApiService.prototype.createQuote.call(
    clientService,
    { tenantId: "tenant", customerId: "customer" },
    { ...base, fulfillmentMode: "store_pickup_return", lines: [{ pricingGroupId: "group", quantity: 1 }] }
  );
  assert.equal(clientResolved, true, "客户端报价不得绕过定价组解析");
  assert.equal(clientQuote.request.lines[0].itemGroupId, "body-a");
  console.log("reservation precision server derivation passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
