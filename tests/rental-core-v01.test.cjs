const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreOrderStatus, RentalInventoryMode } = require("@store-rental/shared");

const service = new RentalCoreService();
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

const order = service.createOrder(cameraTenant, {
  customerType: "personal",
  customerName: "摄影测试客户",
  fulfillmentLocationId: cameraLocation.id,
  startAt,
  endAt,
  lines: [{ itemGroupId: cameraBundle.id, quantity: 1, unitPrice: 299 }]
}, "test");
assert.equal(order.lines.length, 1);
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
assert.equal(service.listItemGroups(newTenant).length, 0);
const configured = service.saveProfile(newTenant, { categoryCode: "construction" });
assert.equal(configured.categoryCode, "construction", "an empty tenant can select its single rental category");
assert.equal(service.listInspectionTemplates(newTenant, "pickup")[0].categoryCode, "construction");

console.log("Rental Core v0.1 test passed: category isolation, bundle reservation, allocation, inspections and quantity availability verified.");
