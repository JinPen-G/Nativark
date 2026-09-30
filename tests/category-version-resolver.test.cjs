"use strict";

const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { parsePublishedRentalCategory, RentalCategoryResolver } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { WorkspaceCapabilityRepository } = require("../apps/api/dist/modules/rental-core/workspace-capability.repository.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { ClientApiService } = require("../apps/api/dist/modules/client/client-api.service.js");
const { prepareRentalCategoryUniqueClaims, validateRentalCategoryAttributes } = require("../apps/api/dist/modules/rental-core/rental-category-attributes.js");

const clone = (value) => JSON.parse(JSON.stringify(value));
for (const definition of RENTAL_CATEGORY_DEFINITIONS) {
  assert.deepEqual(parsePublishedRentalCategory(clone(definition), definition.code), definition);
}
const baseline = clone(RENTAL_CATEGORY_DEFINITIONS[0]);
const rejects = (change, label) => {
  const value = clone(baseline);
  change(value);
  assert.throws(() => parsePublishedRentalCategory(value, baseline.code), /品类版本不可执行/u, label);
};
rejects((value) => { value.code = "camping"; }, "错品类不能复用版本");
rejects((value) => { value.businessModel.pricingUnits = ["hour", "hour"]; }, "重复单位不能发布");
rejects((value) => { value.businessModel.defaultPricingUnit = "night"; }, "默认单位必须受支持");
rejects((value) => { value.businessModel.fulfillmentModes = ["arbitrary_delivery"]; }, "未知履约方式拒绝");
rejects((value) => { value.requiredCapabilities = ["unregistered"]; }, "未知必选能力拒绝");
rejects((value) => { value.unexpected = { execute: "code" }; }, "未知顶层字段拒绝");
rejects((value) => { value.businessModel.unexpected = true; }, "未知业务字段拒绝");
rejects((value) => { value.description = "x".repeat(256 * 1024); }, "超大正文拒绝");
rejects((value) => { value.terminology.itemLabel = null; }, "必填术语不能为空");
rejects((value) => { value.attributeSchema.brand = "executable"; }, "属性概要不能含未知类型");
rejects((value) => { value.businessModel.defaults = {}; }, "初始化默认值必须完整");
rejects((value) => { value.businessModel.defaults.initialSetup.locationType = "unlisted"; }, "默认地点必须属于品类支持范围");
rejects((value) => { value.businessModel.assetFields.push({ ...value.businessModel.assetFields[0] }); }, "动态字段编码不可重复");
rejects((value) => { value.businessModel.defaults.payment.timing = "unimplemented"; }, "未知支付时点拒绝");
rejects((value) => { value.businessModel.defaults.overdue.feeMode = "unimplemented"; }, "未知逾时算法拒绝");
rejects((value) => { value.businessModel.defaults.overdue.graceMinutes = 0.5; }, "宽限分钟必须是整数");
rejects((value) => { value.businessModel.defaults.rules.cancellation.lateFeeValue = 101; }, "百分比取消费不得超百分之百");
rejects((value) => { value.businessModel.defaults.rules.cancellation.freeBeforeHours = -1; }, "取消免费窗口不得为负");
rejects((value) => { value.businessModel.defaults.rules.cancellation.weatherExceptionEnabled = "true"; }, "天气例外不得用字符串冒充布尔值");
rejects((value) => { value.businessModel.defaults.rules.qualificationDocumentTypes = ["驾驶证", "驾驶证"]; }, "资质类型不得重复");
rejects((value) => { value.businessModel.defaults.inspectionFields[0].usageMetric = true; }, "非数值字段不能当累计读数");
rejects((value) => { value.businessModel.defaults.inspectionFields.push({ ...value.businessModel.defaults.inspectionFields[0] }); }, "检查字段编码不得重复");
rejects((value) => { value.businessModel.defaults.inspectionFields[0].options = ["yes"]; }, "非枚举检查字段不得配置选项");
rejects((value) => { value.businessModel.defaults.execute = "arbitrary"; }, "未知初始化字段拒绝");
rejects((value) => { value.businessModel.catalogPresentation = { fixedInventoryMode: "consumable" }; }, "展示固定库存不得越过品类范围");
rejects((value) => { value.terminology.navigationLabels.inventoryGroup = {}; }, "导航文案不可注入对象");
rejects((value) => { value.businessModel.assetFields.find((field) => field.scope === "transaction").unique = true; }, "不支持的交易字段唯一性不得假称受保障");
rejects((value) => { value.defaultCapabilities.push("vehicle_dispatch"); }, "专用品类能力不能跨品类声明");
rejects((value) => { value.defaultCapabilities = value.defaultCapabilities.filter((code) => code !== "serialized_inventory"); }, "能力依赖不可缺失");
rejects((value) => { value.businessModel.assetFields[0].code = "constructor"; }, "对象保留键不能当业务属性编码");
const candidateFields = [{ code: "identity", label: "标识", scope: "item_group", type: "string", required: true, unique: true }];
const records = [{ id: "a", attributes: { identity: " Ａ１２３ " } }, { id: "b", attributes: { identity: "B456" } }];
const untouched = clone(records);
assert.equal(prepareRentalCategoryUniqueClaims(candidateFields, "item_group", records)[0].normalizedValue, "A123");
assert.deepEqual(records, untouched, "目标版本预检不得提前改变经营事实");
assert.throws(() => prepareRentalCategoryUniqueClaims(candidateFields, "item_group", [records[0], { id: "b", attributes: { identity: "a123" } }]), /不能采用目标品类版本/u);
assert.throws(() => prepareRentalCategoryUniqueClaims(candidateFields, "item_group", [{ id: "a", attributes: {} }]), /不能为空/u);
assert.throws(() => validateRentalCategoryAttributes([{ code: "choice", label: "选项", scope: "asset", type: "select", options: ["1"] }], "asset", { choice: 1 }), /允许选项/u);
assert.throws(() => validateRentalCategoryAttributes([{ code: "date", label: "日期", scope: "asset", type: "date" }], "asset", { date: true }), /有效日期/u);
const dateFields = [{ code: "date", label: "日期", scope: "asset", type: "date" }];
for (const invalid of ["2026-02-30", "2026-02-29", "2026-02-30T12:00:00+08:00", "2026-04-31", "1", "2026-13-01"]) {
  assert.throws(() => validateRentalCategoryAttributes(dateFields, "asset", { date: invalid }), /有效日期/u, `不可自动折算无效日期 ${invalid}`);
}
for (const valid of ["2024-02-29", "2026-02-28", "2024-02-29T23:30:00-08:00"]) {
  assert.doesNotThrow(() => validateRentalCategoryAttributes(dateFields, "asset", { date: valid }), "有效闰日及带时区日期应保持可用");
}
void (async () => {
  let currentVersionId = "published-v1";
  const versions = new Map([
    ["published-v1", { id: "published-v1", categoryCode: "CAMERA", structureVersion: 1, status: "published", definition: clone(baseline) }],
    ["draft-v2", { id: "draft-v2", categoryCode: "CAMERA", structureVersion: 1, status: "draft", definition: clone(baseline) }],
    ["published-unsupported", { id: "published-unsupported", categoryCode: "CAMERA", structureVersion: 999, status: "published", definition: clone(baseline) }],
    ["published-v2", { id: "published-v2", categoryCode: "CAMERA", structureVersion: 1, status: "published", definition: {
      ...clone(baseline), requiredCapabilities: ["camera_compatibility"]
    } }]
  ]);
  const prisma = {
    businessWorkspace: { findFirst: async ({ where }) => where.tenantId === "tenant" && where.id === "space"
      ? { categoryCode: "CAMERA", categoryVersionId: currentVersionId, categoryAdoptionRevision: currentVersionId === "published-v1" ? 1 : 2 }
      : null },
    rentalCategoryVersion: { findUnique: async ({ where }) => versions.get(where.id) ?? null }
  };
  const resolver = new RentalCategoryResolver(prisma);
  let txReads = 0;
  const tx = {
    ...prisma,
    rentalCategoryDefinition: { findFirst: async () => ({ recommendedVersionId: "published-v2" }) },
    rentalCategoryVersion: { findUnique: async ({ where }) => { txReads += 1; return versions.get(where.id); } }
  };
  assert.deepEqual((await resolver.forNewWorkspace("camera", tx)).requiredCapabilities, ["camera_compatibility"], "新空间初始化从事务内推荐版本取模板");
  await resolver.forWorkspace("tenant", "space", tx);
  assert.equal(txReads, 2, "事务未提交的版本读取不可跳出外层事务");
  await assert.rejects(resolver.forNewWorkspace("camera", { ...tx, rentalCategoryDefinition: { findFirst: async () => ({ recommendedVersionId: "draft-v2" }) } }), /未发布/u);
  const capabilityRepository = new WorkspaceCapabilityRepository(prisma, resolver);
  assert.equal((await resolver.forWorkspace("tenant", "space")).categoryVersionId, "published-v1");
  assert.equal((await resolver.forWorkspace("tenant", "space")).adoptionRevision, 1);
  assert.deepEqual((await capabilityRepository.workspaceScope("tenant", "space")).requiredCodes, []);
  await assert.rejects(resolver.forWorkspace("other", "space"), /经营空间不存在/u);
  await assert.rejects(resolver.forVersion("camping", "published-v1"), /编码不匹配/u);
  await assert.rejects(resolver.forVersion("camera", "published-unsupported"), /升级兼容程序/u);
  currentVersionId = "draft-v2";
  await assert.rejects(resolver.forWorkspace("tenant", "space"), /未发布/u, "绑定变化必须每次重读且不执行草稿");
  assert.equal((await resolver.forVersion("camera", "published-v1")).code, "camera", "历史业务可读取原发布版本");
  currentVersionId = "published-v2";
  assert.deepEqual((await capabilityRepository.workspaceScope("tenant", "space")).requiredCodes, ["camera_compatibility"], "能力范围必须随发布版本绑定变化");
  const core = Object.create(RentalCoreService.prototype);
  const revised = clone(baseline);
  revised.terminology.pickupLabel = "新版交付";
  revised.businessModel.defaults.inspectionFields = [{ code: "new_check", label: "新版检查", type: "boolean", required: true }];
  const initialized = core.seedState("new-tenant", "camera", "new-space", "CNY", revised);
  assert.deepEqual(initialized.inspectionTemplates[0].fields, revised.businessModel.defaults.inspectionFields, "初始化检查模板不能偷偷回退到代码默认字段");
  assert.equal(initialized.inspectionTemplates[0].name, "新版交付检查");
  core.categoryResolver = resolver;
  assert.deepEqual((await core.getWorkspaceCategoryInTransaction("tenant", "space", "camera", tx)).requiredCapabilities, ["camera_compatibility"]);
  await assert.rejects(core.getWorkspaceCategoryInTransaction("tenant", "space", "camping", tx), /初始化模板不一致/u);
  let evaluated;
  core.hooks = { evaluate: async (input) => { evaluated = input; return {}; } };
  core.categoryResolver = resolver;
  core.workspaceOf = () => "space";
  core.state = () => ({ profile: { categoryCode: "camera" } });
  const order = { id: "old-order", categoryVersionId: "published-v1", capabilityPolicy: "snapshot" };
  await core.runHook("tenant", "pickup_delivery", { type: "order", id: order.id }, { order, results: {} });
  assert.deepEqual(evaluated.requiredCapabilities, [], "嵌套交接 payload 必须使用旧单版本而非空间新版必选政策");
  await core.runHook("tenant", "settlement", { type: "order", id: order.id }, order);
  assert.deepEqual(evaluated.requiredCapabilities, [], "直接订单 payload 同样使用旧版政策");
  const version2 = versions.get("published-v2");
  version2.definition.businessModel.defaults.inspectionFields.push({
    code: "version2_optional_check", label: "第二版检查项", type: "boolean", required: false
  });
  const baselineState = core.seedState("tenant", "camera", "space", "CNY", baseline);
  core.state = () => baselineState;
  assert.ok((await core.listInspectionTemplates("tenant", "pickup"))[0].fields.some((field) => field.code === "version2_optional_check"), "当前模板补齐项应读取绑定版本而非静态四品类默认值");
  const oldOrderTemplates = await core.listInspectionTemplates("tenant", "pickup", {
    tenantId: "tenant", categoryCode: "camera", categoryVersionId: "published-v1"
  });
  assert.equal(oldOrderTemplates[0].fields.some((field) => field.code === "version2_optional_check"), false, "旧单不能被新版默认检查项追改");
  const frozenOrder = {
    tenantId: "tenant", categoryCode: "camera", categoryVersionId: "published-v1",
    inspectionTemplateSnapshots: clone(oldOrderTemplates)
  };
  baselineState.inspectionTemplates[0].fields = [{ code: "changed_required", label: "后来新增", type: "string", required: true }];
  baselineState.inspectionTemplates[0].enabled = false;
  const frozenRead = await core.listInspectionTemplates("tenant", "pickup", frozenOrder);
  assert.deepEqual(frozenRead, oldOrderTemplates, "模板主体修改/停用后仍读取订单完整快照");
  frozenRead[0].fields[0].label = "外部篡改";
  assert.deepEqual(await core.listInspectionTemplates("tenant", "pickup", frozenOrder), oldOrderTemplates, "读取结果不得泄漏快照引用");
  assert.deepEqual(await core.listInspectionTemplates("tenant", "pickup", { ...frozenOrder, inspectionTemplateSnapshots: [] }), [], "明确空快照不得回退活动模板");
  core.lockedOrder = async () => ({ ...frozenOrder, status: "ready_for_pickup" });
  await assert.rejects(core.createInspection("tenant", "frozen-order", { templateId: oldOrderTemplates[0].id, results: {} }, "operator"), /缺少必填检查项/u, "当前模板已停用仍按旧单原必填项检查");
  core.lockedOrder = async () => ({ ...frozenOrder, inspectionTemplateSnapshots: [], status: "ready_for_pickup" });
  await assert.rejects(core.createInspection("tenant", "frozen-order", { templateId: oldOrderTemplates[0].id, results: {} }, "operator"), /模板不存在/u, "空快照不能自动改用活动模板");
  await assert.rejects(core.listInspectionTemplates("tenant", "pickup", {
    tenantId: "other", categoryCode: "camera", categoryVersionId: "published-v1"
  }), /不属于当前租户/u);
  const publicService = Object.create(ClientApiService.prototype);
  const publicProfile = {
    defaultWorkspaceId: "public-space", publishedWorkspaces: [
      { workspaceId: "public-space", workspace: { code: "camera-rental", name: "公开空间", categoryCode: "CAMERA", isDefault: true, status: "ACTIVE" } },
      { workspaceId: "frozen-space", workspace: { code: "frozen", name: "冻结空间", categoryCode: "CAMPING", isDefault: false, status: "FROZEN" } }
    ]
  };
  publicService.prisma = {
    tenant: { findFirst: async () => ({ id: "tenant", code: "public-tenant", name: "公开租户" }) },
    clientChannelProfile: { findUnique: async ({ include }) => {
      assert.equal(include.publishedWorkspaces.where.enabled, true, "未发布的空间不能进入元数据候选");
      return publicProfile;
    } },
    miniProgramChannel: { findFirst: async () => null }
  };
  publicService.core = { listCategories: () => { throw new Error("不可读静态品类表"); } };
  publicService.tenantIntegrations = { catalog: async () => ({ configs: [] }) };
  publicService.anyWorkspaceEnablesDelivery = async () => false;
  const publicReads = [];
  publicService.categoryResolver = { forWorkspace: async (tenantId, workspaceId) => {
    publicReads.push([tenantId, workspaceId]);
    return { definition: { ...baseline, name: "采用版本的公开名称" } };
  } };
  const bootstrap = await publicService.channelBootstrap("public-tenant");
  assert.deepEqual(publicReads, [["tenant", "public-space"]], "公开元数据只解析本租户已发布且有效的空间");
  assert.deepEqual(bootstrap.categories, [{ code: "camera", name: "采用版本的公开名称" }]);
  assert.deepEqual(Object.keys(bootstrap.categories[0]).sort(), ["code", "name"], "公开投影不能返回政策、字段或内部配置");
  publicProfile.publishedWorkspaces = [];
  assert.deepEqual((await publicService.channelBootstrap("public-tenant")).categories, [], "无公开空间时不回退平台全品类目录");
  console.log("Published rental-category parser and workspace/version resolver passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
