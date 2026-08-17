const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RentalCoreOrderStatus, RentalInventoryMode } = require("@store-rental/shared");
const { createAbsorbingConfigStore, createAbsorbingFactStore, createAbsorbingBusinessConfigStore } = require("./helpers/absorbing-config-store.cjs");

// 配置的事实源是数据库；本用例不连库，注入吸收式 store 让写穿落空，
// 配置读取仍由服务的内存写穿缓存提供。依赖持久化语义的断言在 mysql-e2e 里。
const service = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());
const business = new RentalBusinessService(createAbsorbingBusinessConfigStore());
const cameraTenant = "tenant_001";
const campingTenant = "tenant_002";
const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const endAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

// 配置写方法已随「配置落库」转为异步，.cjs 无顶层 await，故整体包一层异步 IIFE。
void (async () => {

const cameraProfile = service.getProfile(cameraTenant);
const campingProfile = service.getProfile(campingTenant);
assert.equal(cameraProfile.categoryCode, "camera");
assert.equal(campingProfile.categoryCode, "camping");
const categories = service.listCategories();
assert.equal(categories.length, 4);
assert.ok(categories.every((category) => category.businessModel.assetFields.length > 0));
assert.ok(categories.find((category) => category.code === "vehicle").businessModel.assetFields.some((field) => field.code === "licensePlate" && field.scope === "asset"));
assert.ok(categories.find((category) => category.code === "camera").businessModel.assetFields.some((field) => field.code === "model" && field.scope === "item_group"));
assert.ok(categories.find((category) => category.code === "camping").businessModel.assetFields.some((field) => field.code === "people" && field.scope === "item_group"));
assert.ok(service.listItemGroups(campingTenant).every((group) => group.categoryCode === "camping"));
assert.ok(service.listItemGroups(campingTenant).some((group) => group.code === "CAMP-TENT"));
assert.ok(service.listItemGroups(campingTenant).every((group) => !group.code.startsWith("CAM-")));
assert.equal(service.listItemGroups(cameraTenant).find((group) => group.code === "CAM-BODY").attributes.model, "Alpha 7 IV");
assert.equal(service.listItemGroups(campingTenant).find((group) => group.code === "CAMP-TENT").attributes.brand, "Naturehike");

const cameraSettings = service.getBusinessSettings(cameraTenant);
assert.equal(cameraSettings.categoryCode, "camera");
assert.ok(cameraSettings.pricing.enabledUnits.includes("day_24h"));
const savedCameraSettings = await service.saveBusinessSettings(cameraTenant, {
  pricing: { ...cameraSettings.pricing, enabledUnits: ["hour", "day_24h"], defaultUnit: "day_24h" },
  fulfillment: { ...cameraSettings.fulfillment, enabledModes: ["store_pickup_return", "delivery"] },
  payment: { ...cameraSettings.payment, preauthorizationRequired: true },
  overdue: { ...cameraSettings.overdue, graceMinutes: 45 },
  calendar: cameraSettings.calendar,
  membership: { ...cameraSettings.membership, signupRewardEnabled: true, signupRewardAmount: 100 },
  notifications: cameraSettings.notifications
}, "test");
assert.equal(savedCameraSettings.overdue.graceMinutes, 45);
assert.equal(savedCameraSettings.updatedBy, "test");
const coupon = await service.saveCouponTemplate(cameraTenant, {
  code: "WELCOME-20",
  name: "新客满减券",
  discountType: "fixed_amount",
  discountValue: 20,
  minimumSpend: 200,
  totalQuota: 1000,
  perCustomerLimit: 1,
  effectiveFrom: startAt,
  effectiveTo: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  applicableItemGroupIds: [],
  status: "enabled"
});
assert.equal(coupon.version, "1.0");
assert.equal(service.listCouponTemplates(cameraTenant).length, 1);
assert.equal(service.listCouponTemplates(campingTenant).length, 0, "coupon templates must remain tenant isolated");
await assert.rejects(async () => service.saveBusinessSettings(campingTenant, {
  ...service.getBusinessSettings(campingTenant),
  payment: { ...service.getBusinessSettings(campingTenant).payment, preauthorizationRequired: true }
}, "test"), /不支持预授权/);

const cameraGroups = service.listItemGroups(cameraTenant);
const cameraLocation = service.listLocations(cameraTenant)[0];
const partnerLocation = await service.saveLocation(cameraTenant, {
  code: "PARTNER-01",
  name: "合作器材取还点",
  type: "store",
  operatorType: "partner",
  operatorName: "测试摄影合作商",
  capabilities: ["pickup", "return"],
  status: "enabled"
});
assert.equal(partnerLocation.operatorType, "partner");
await assert.rejects(async () => service.saveLocation(cameraTenant, {
  code: "SITE-01",
  name: "错误项目现场",
  type: "project_site",
  operatorType: "partner",
  operatorName: "错误合作商",
  capabilities: ["pickup"]
}), /不支持该履约地点类型/);
const cameraBundle = cameraGroups.find((row) => row.inventoryMode === RentalInventoryMode.Bundle);
assert.ok(cameraBundle && cameraBundle.bundleComponents.length === 2);

const cameraContext = {
  profile: service.getProfile(cameraTenant),
  category: service.listCategories().find((item) => item.code === service.getProfile(cameraTenant).categoryCode),
  settings: service.getBusinessSettings(cameraTenant),
  groups: service.listItemGroups(cameraTenant),
  couponTemplates: service.listCouponTemplates(cameraTenant)
};
// ── 订单生命周期与可用量断言已移交 tests/mysql-e2e.test.cjs ──
// RC-01 阶段 3 把订单、预占、分配、资产、库存和检查记录迁到数据库后，服务不再就地
// 修改调用方持有的 order 对象，而是从库加载副本再写回。原先"调 confirmOrder 后
// 断言 order.status 变了"的写法依赖的正是那个就地修改，本质上测的是内存实现细节。
//
// 这些断言现在由 E2E 对真实 MySQL 验证，覆盖面反而更宽：
//   第 9 节  摄影套装 → 报价/下单/确认/配货/取还检查、资产 reserved→rented→available
//   第 10 节 露营数量+套装合并占用、缺件污损计费、库存完整释放
//   第 11 节 非法状态转移拒绝、收费窗口取消、库存释放
//   第 16 节 双租户并发隔离（原 listOrders 隔离断言在吸收式 stub 下恒为空数组，
//            已无区分力，不再保留）
//
// 本文件保留的是不依赖持久化的部分：品类 schema 形状、配置隔离、动态字段校验。

const newTenant = "tenant_new";
await service.initializeTenant(newTenant, "construction");
assert.equal(service.listItemGroups(newTenant).length, 0);
const configured = await service.saveProfile(newTenant, { categoryCode: "construction" });
assert.equal(configured.categoryCode, "construction", "an empty tenant can select its single rental category");
await assert.rejects(async () => service.saveProfile(newTenant, { categoryCode: "vehicle" }), /创建后经营品类固定/, "initialized SaaS tenant category must be immutable even before products are created");
assert.equal(service.listInspectionTemplates(newTenant, "pickup")[0].categoryCode, "construction");
await assert.rejects(async () => service.saveItemGroup(newTenant, {
  code: "EXC-001",
  name: "测试挖掘机",
  inventoryMode: "serialized",
  attributes: { model: "E20" },
  status: "enabled"
}), /制造商/, "construction groups must validate their category-specific fields");
const constructionGroup = await service.saveItemGroup(newTenant, {
  code: "EXC-001",
  name: "测试挖掘机",
  inventoryMode: "serialized",
  attributes: { manufacturer: "测试重工", model: "E20" },
  status: "enabled"
});
const constructionLocation = service.listLocations(newTenant)[0];
await assert.rejects(async () => service.saveAsset(newTenant, {
  itemGroupId: constructionGroup.id,
  assetNo: "EXC-ASSET-001",
  locationId: constructionLocation.id,
  attributes: {},
  status: "available"
}), /出厂编号/, "construction assets must validate their category-specific identifiers");
const constructionAsset = await service.saveAsset(newTenant, {
  itemGroupId: constructionGroup.id,
  assetNo: "EXC-ASSET-001",
  locationId: constructionLocation.id,
  attributes: { factoryNo: "FACTORY-001" },
  status: "available"
});
assert.equal(constructionAsset.attributes.factoryNo, "FACTORY-001");
assert.ok(service.listOperators(cameraTenant).some((operator) => operator.name === "测试摄影合作商"), "partner locations must link to the operator master");

console.log("Rental Core v0.1 test passed: category schema, config isolation and dynamic field validation verified (order lifecycle, inventory and inspections are asserted against real MySQL in tests/mysql-e2e.test.cjs).");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
