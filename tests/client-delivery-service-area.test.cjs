const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
});

const { evaluateDeliveryServiceArea } = require(path.join(
  root,
  "apps/api/src/modules/client/client-delivery-service-area"
));
const { ClientDeliveryAddressService } = require(path.join(
  root,
  "apps/api/src/modules/client/client-delivery-address.service"
));
const { RentalCoreService } = require(path.join(
  root,
  "apps/api/src/modules/rental-core/rental-core.service"
));
const { createAbsorbingConfigStore, createAbsorbingFactStore } = require(path.join(
  __dirname,
  "helpers/absorbing-config-store.cjs"
));

const address = {
  id: "address-1",
  revision: 1,
  tenantId: "tenant-1",
  customerId: "customer-1",
  recipient: "测试客户",
  phone: "13800000000",
  phoneMasked: "138****0000",
  countryCode: "CN",
  province: "上海市",
  city: "上海市",
  district: "徐汇区",
  detail: "漕溪北路 1 号",
  postalCode: null,
  latitude: null,
  longitude: null,
  isDefault: true,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function run() {
  const deliveryTenant = "tenant_delivery_area_test";
  const deliveryCore = new RentalCoreService(
    createAbsorbingConfigStore([{
      id: "ws_delivery_area_test",
      tenantId: deliveryTenant,
      categoryCode: "camera",
      isDefault: true,
    }]),
    createAbsorbingFactStore()
  );
  await deliveryCore.onApplicationBootstrap();
  const initialSettings = deliveryCore.getBusinessSettings(deliveryTenant);
  const saveDeliveryPolicy = (deliveryServiceArea) => deliveryCore.saveBusinessSettings(
    deliveryTenant,
    {
      ...initialSettings,
      fulfillment: { ...initialSettings.fulfillment, deliveryServiceArea },
    },
    "delivery-area-test"
  );
  const savedPolicy = await saveDeliveryPolicy({
    mode: "allowlist",
    areas: [{ province: " 上海市 ", city: " 上海市 ", district: " 徐汇区 " }],
  });
  assert.deepEqual(savedPolicy.fulfillment.deliveryServiceArea, {
    mode: "allowlist",
    areas: [{ province: "上海市", city: "上海市", district: "徐汇区" }],
  }, "服务端持久化前应清理空白并规范区域列表");
  await assert.rejects(
    () => saveDeliveryPolicy({ mode: "allowlist", areas: [] }),
    /至少添加一个配送区域/u,
    "启用白名单后不允许保存空区域"
  );
  await assert.rejects(
    () => saveDeliveryPolicy({
      mode: "allowlist",
      areas: [
        { province: "上海市", city: "上海市" },
        { province: " 上海市 ", city: "上海市" },
      ],
    }),
    /不能重复/u,
    "规范化后重复的区域必须由服务端拒绝"
  );

  assert.deepEqual(
    evaluateDeliveryServiceArea(undefined, { province: "任意省", city: "任意市" }),
    { mode: "all", allowed: true },
    "旧租户未配置配送区域时保持兼容"
  );

  const cityWide = {
    mode: "allowlist",
    areas: [{ province: "上海市", city: "上海市" }],
  };
  assert.equal(evaluateDeliveryServiceArea(cityWide, address).allowed, true);
  assert.equal(
    evaluateDeliveryServiceArea(cityWide, { ...address, province: "江苏省" }).allowed,
    false,
    "区域匹配必须按省、市精确判断，不能用子串猜测"
  );

  const districtOnly = {
    mode: "allowlist",
    areas: [{ province: "上海市", city: "上海市", district: "徐汇区" }],
  };
  assert.equal(evaluateDeliveryServiceArea(districtOnly, address).allowed, true);
  assert.equal(
    evaluateDeliveryServiceArea(districtOnly, { ...address, district: "浦东新区" }).allowed,
    false,
    "配置区县时不得放行同城其他区县"
  );
  assert.equal(
    evaluateDeliveryServiceArea(districtOnly, { ...address, district: null }).allowed,
    false,
    "缺少区县时不能绕过区县白名单"
  );

  let storedSnapshot;
  const prisma = {
    customerDeliveryAddress: {
      findFirst: async ({ where }) => where?.id === "outside-zone"
        ? { ...address, province: "江苏省" }
        : address,
    },
    clientOrderDeliverySnapshot: {
      create: async ({ data }) => {
        storedSnapshot = data.snapshot;
        return { snapshot: data.snapshot };
      },
      findFirst: async () => ({ snapshot: storedSnapshot }),
    },
  };
  const rentalCore = {
    getBusinessSettings: () => ({
      fulfillment: { deliveryServiceArea: districtOnly },
    }),
  };
  const service = new ClientDeliveryAddressService(prisma, rentalCore);
  const context = {
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    customerId: "customer-1",
  };
  const acceptedAddress = await service.requireOwnAddress(context, "address-1");
  const quoteSnapshot = await service.snapshotForQuote(context, "quote-1", acceptedAddress);
  assert.deepEqual(quoteSnapshot.deliveryServiceAreaDecision, {
    mode: "allowlist",
    allowed: true,
    matchedArea: { province: "上海市", city: "上海市", district: "徐汇区" },
  });

  const customerSnapshot = await service.snapshotForOrder(context, { id: "order-1" });
  assert.equal(customerSnapshot.phoneMasked, "138****0000");
  assert.equal("phone" in customerSnapshot, false, "客户端快照不得暴露完整联系电话");
  assert.equal(
    "deliveryServiceAreaDecision" in customerSnapshot,
    false,
    "内部配送判定不进入客户地址响应"
  );

  await assert.rejects(
    () => service.requireOwnAddress(context, "outside-zone"),
    /不在当前经营空间的配送范围内/u,
    "报价入口必须在创建报价前拒绝超区域地址"
  );

  const categoryPage = fs.readFileSync(
    path.join(root, "apps/admin/src/features/settings/governance/CategoryTab.tsx"),
    "utf8"
  );
  const coreSettings = fs.readFileSync(
    path.join(root, "apps/api/src/modules/rental-core/rental-core.service.ts"),
    "utf8"
  );
  assert.match(categoryPage, /仅限指定省市区/u);
  assert.match(categoryPage, /deliveryServiceArea/u);
  assert.match(categoryPage, /new Set\(keys\)\.size !== keys\.length/u);
  assert.match(categoryPage, /setFieldValue\(\["fulfillment", "deliveryServiceArea", "areas"\], \[\]\)/u);
  assert.match(coreSettings, /启用按地区限制时至少添加一个配送区域/u);
  console.log("client delivery service-area test passed: compatibility, exact matching, quote gate, immutable decision snapshot and customer privacy");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
