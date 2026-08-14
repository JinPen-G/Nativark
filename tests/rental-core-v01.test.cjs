const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RentalCoreOrderStatus, RentalInventoryMode } = require("@store-rental/shared");

const service = new RentalCoreService();
const business = new RentalBusinessService();
const cameraTenant = "tenant_001";
const campingTenant = "tenant_002";
const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const endAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

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
const savedCameraSettings = service.saveBusinessSettings(cameraTenant, {
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
const coupon = service.saveCouponTemplate(cameraTenant, {
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
assert.throws(() => service.saveBusinessSettings(campingTenant, {
  ...service.getBusinessSettings(campingTenant),
  payment: { ...service.getBusinessSettings(campingTenant).payment, preauthorizationRequired: true }
}, "test"), /不支持预授权/);

const cameraGroups = service.listItemGroups(cameraTenant);
const cameraLocation = service.listLocations(cameraTenant)[0];
const partnerLocation = service.saveLocation(cameraTenant, {
  code: "PARTNER-01",
  name: "合作器材取还点",
  type: "store",
  operatorType: "partner",
  operatorName: "测试摄影合作商",
  capabilities: ["pickup", "return"],
  status: "enabled"
});
assert.equal(partnerLocation.operatorType, "partner");
assert.throws(() => service.saveLocation(cameraTenant, {
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
const quote = business.createQuote(cameraTenant, cameraContext, {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: cameraLocation.id,
  startAt,
  endAt,
  lines: [{ itemGroupId: cameraBundle.id, quantity: 1 }]
});
const order = service.createOrder(cameraTenant, {
  quoteId: quote.id,
  customerType: "personal",
  customerName: "摄影测试客户",
  fulfillmentMode: quote.request.fulfillmentMode,
  fulfillmentLocationId: cameraLocation.id,
  startAt,
  endAt,
  lines: [{ itemGroupId: cameraBundle.id, quantity: 1 }]
}, "test", quote);
assert.equal(order.lines.length, 1);
assert.equal(order.quoteId, quote.id);
assert.equal(order.totalAmount, quote.payableAmount);
assert.equal(order.reservations.length, 2, "bundle should reserve its components");
assert.equal(order.status, RentalCoreOrderStatus.Draft);

service.confirmOrder(cameraTenant, order.id);
service.allocateOrder(cameraTenant, order.id);
assert.equal(order.status, RentalCoreOrderStatus.ReadyForPickup);
assert.equal(order.allocations.length, 2);

const pickup = service.listInspectionTemplates(cameraTenant, "pickup")[0];
service.createInspection(cameraTenant, order.id, {
  templateId: pickup.id,
  results: { appearance_ok: true, function_ok: true, shutter_count: 1200 }
}, "test");
assert.equal(order.status, RentalCoreOrderStatus.Renting);

const returned = service.listInspectionTemplates(cameraTenant, "return")[0];
service.createInspection(cameraTenant, order.id, {
  templateId: returned.id,
  results: { appearance_ok: true, function_ok: true, shutter_count: 1250 }
}, "test");
assert.equal(order.status, RentalCoreOrderStatus.Completed);
assert.ok(order.allocations.every((row) => row.status === "returned"));

const campingGroups = service.listItemGroups(campingTenant);
const campingLocation = service.listLocations(campingTenant)[0];
const campingBundle = campingGroups.find((row) => row.inventoryMode === RentalInventoryMode.Bundle);
const campingAvailability = service.availability(campingTenant, {
  locationId: campingLocation.id,
  startAt,
  endAt,
  lines: [{ itemGroupId: campingBundle.id, quantity: 6 }]
});
assert.equal(campingAvailability.available, true);

const overbooked = service.availability(campingTenant, {
  locationId: campingLocation.id,
  startAt,
  endAt,
  lines: [
    { itemGroupId: campingBundle.id, quantity: 6 },
    { itemGroupId: campingGroups.find((row) => row.code === "CAMP-CHAIR").id, quantity: 12 }
  ]
});
assert.equal(overbooked.available, false, "combined bundle/component demand must not overbook stock");
assert.equal(service.listOrders(campingTenant).length, 0, "tenant data must be isolated");

const newTenant = "tenant_new";
service.initializeTenant(newTenant, "construction");
assert.equal(service.listItemGroups(newTenant).length, 0);
const configured = service.saveProfile(newTenant, { categoryCode: "construction" });
assert.equal(configured.categoryCode, "construction", "an empty tenant can select its single rental category");
assert.throws(() => service.saveProfile(newTenant, { categoryCode: "vehicle" }), /创建后经营品类固定/, "initialized SaaS tenant category must be immutable even before products are created");
assert.equal(service.listInspectionTemplates(newTenant, "pickup")[0].categoryCode, "construction");
assert.throws(() => service.saveItemGroup(newTenant, {
  code: "EXC-001",
  name: "测试挖掘机",
  inventoryMode: "serialized",
  attributes: { model: "E20" },
  status: "enabled"
}), /制造商/, "construction groups must validate their category-specific fields");
const constructionGroup = service.saveItemGroup(newTenant, {
  code: "EXC-001",
  name: "测试挖掘机",
  inventoryMode: "serialized",
  attributes: { manufacturer: "测试重工", model: "E20" },
  status: "enabled"
});
const constructionLocation = service.listLocations(newTenant)[0];
assert.throws(() => service.saveAsset(newTenant, {
  itemGroupId: constructionGroup.id,
  assetNo: "EXC-ASSET-001",
  locationId: constructionLocation.id,
  attributes: {},
  status: "available"
}), /出厂编号/, "construction assets must validate their category-specific identifiers");
const constructionAsset = service.saveAsset(newTenant, {
  itemGroupId: constructionGroup.id,
  assetNo: "EXC-ASSET-001",
  locationId: constructionLocation.id,
  attributes: { factoryNo: "FACTORY-001" },
  status: "available"
});
assert.equal(constructionAsset.attributes.factoryNo, "FACTORY-001");
assert.ok(service.listOperators(cameraTenant).some((operator) => operator.name === "测试摄影合作商"), "partner locations must link to the operator master");

console.log("Rental Core v0.1 test passed: category isolation, bundle reservation, allocation, inspections and quantity availability verified.");
