const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });

const { redactDeliveryAddressPhone } = require("../apps/api/src/modules/rental-core/rental-delivery-address-privacy");
const { OperationLogService } = require("../apps/api/src/common/operation-log.service");
const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const original = {
  id: "order-1",
  deliveryAddressSnapshot: { recipient: "林女士", phone: "13800000000", phoneMasked: "138****0000", detail: "测试路 1 号" },
  request: { deliveryAddressDraft: { recipient: "林女士", phone: "13800000000", phoneMasked: "138****0000", detail: "测试路 1 号" } },
  nested: [{ deliveryAddressSnapshot: { recipient: "张先生", phone: "13900000000", phoneMasked: "139****0000" } }]
};
const ordinaryResponse = redactDeliveryAddressPhone(original);
assert.equal(ordinaryResponse.deliveryAddressSnapshot.phone, undefined);
assert.equal(ordinaryResponse.deliveryAddressSnapshot.phoneMasked, "138****0000");
assert.equal(ordinaryResponse.request.deliveryAddressDraft.phone, undefined);
assert.equal(ordinaryResponse.request.deliveryAddressDraft.phoneMasked, "138****0000");
assert.equal(ordinaryResponse.nested[0].deliveryAddressSnapshot.phone, undefined);
assert.equal(original.deliveryAddressSnapshot.phone, "13800000000", "redaction must not mutate stored/source facts");
assert.equal(original.request.deliveryAddressDraft.phone, "13800000000", "draft redaction must not mutate quote/source facts");
assert.equal(original.nested[0].deliveryAddressSnapshot.phone, "13900000000", "nested redaction must not mutate source facts");
assert.strictEqual(redactDeliveryAddressPhone({ id: "unrelated" }).id, "unrelated");

const guard = source("apps/api/src/common/api-auth.guard.ts");
assert.match(guard, /delivery-address\\\/reveal.*return \["rental-os:customer:reveal-sensitive"\]/u);
const staffPolicy = source("apps/api/src/common/staff-api-policy.ts");
assert.doesNotMatch(staffPolicy, /delivery-address\\\/reveal/u, "the staff facade must not expose the PII reveal route");
const controller = source("apps/api/src/modules/rental-core/rental-core.controller.ts");
assert.match(controller, /delivery-address\/reveal/u);
assert.match(controller, /order\.delivery_address\.revealed/u);
assert.match(controller, /requireSuccess: true/u, "full delivery details must only return after a durable audit record");
assert.match(controller, /redactDeliveryAddressPhone\(resolved\)/u);
const businessController = source("apps/api/src/modules/rental-core/rental-business.controller.ts");
assert.match(businessController, /redactDeliveryAddressPhone\(this\.business\.getQuote/u);
const page = source("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");
assert.match(page, /canRevealSensitive && !fullPhoneVisible/u);
assert.match(page, /address\.phoneMasked/u);
assert.match(page, /revealOrderDeliveryAddress\(id\)/u);
const openapi = source("apps/api/src/contracts/openapi-document.ts");
assert.match(openapi, /orders\/\{id\}\/delivery-address\/reveal/u);

const audit = new OperationLogService({ operationLog: { create: async () => { throw new Error("database unavailable"); } } });
const auditFailureCheck = assert.rejects(
  audit.record({ tenantId: "tenant-1", action: "order.delivery_address.revealed", targetType: "rental-order", requireSuccess: true }),
  /敏感资料审计失败/u,
  "sensitive data must not be revealed when its audit write fails"
);

auditFailureCheck.then(() => {
  console.log("Rental delivery address privacy checks passed (redaction, permission, audit, staff boundary, UI, and contract).");
});
