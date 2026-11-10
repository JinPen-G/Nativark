"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { CATEGORY_GOVERNANCE_PERMISSIONS: permissions } = require("@rental-os/shared");
const { categoryCreationTemplates, composeCategoryCreation } = require("../apps/api/dist/modules/rental-core/category-creation-templates.js");
const { parsePublishedRentalCategory } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { CategoryGovernanceService } = require("../apps/api/dist/modules/rental-core/category-governance.service.js");
const { CapabilityHookRuntime } = require("../apps/api/dist/modules/rental-core/capability-hook.runtime.js");
const { CapabilityHookRegistrar } = require("../apps/api/dist/modules/rental-core/capability-hook.registrar.js");
const { requestFingerprint } = require("../apps/api/dist/modules/rental-core/rental-idempotency.repository.js");

const actor = { id: "platform-owner", isSaasAdmin: true, permissions: [permissions.view, permissions.edit] };
function input(templateId = "serialized", code = "stage_tools") {
  const source = categoryCreationTemplates().find(template => template.id === templateId).definition;
  return { code, name: "舞台用品", templateId, versionLabel: "1.0", inventoryModes: [...source.supportedInventoryModes],
    pricingUnits: [...source.businessModel.pricingUnits], defaultPricingUnit: source.businessModel.defaultPricingUnit,
    fulfillmentModes: [...source.businessModel.fulfillmentModes], capabilityCodes: [...source.defaultCapabilities] };
}
function hooks() {
  const runtime = new CapabilityHookRuntime({ enabledInstances: async () => [] });
  new CapabilityHookRegistrar(runtime).onApplicationBootstrap();
  return runtime;
}

test("all fixed templates produce independent canonical definitions with actual executable contracts", () => {
  const runtime = hooks();
  for (const template of categoryCreationTemplates()) {
    const request = input(template.id, `new_${template.id}`), original = structuredClone(template);
    const result = composeCategoryCreation(template.definition, request);
    assert.deepEqual(parsePublishedRentalCategory(result.definition, request.code), result.definition);
    assert.doesNotThrow(() => runtime.assertCategoryComposition(result.definition));
    assert.equal(result.definition.version, request.versionLabel);
    assert.equal(result.definitionHash, requestFingerprint(result.definition));
    assert.deepEqual(template, original);
    result.definition.businessModel.assetFields[0].label = "外部改动";
    assert.equal(categoryCreationTemplates().find(row => row.id === template.id).definition.businessModel.assetFields[0].label, "品牌");
  }
  const quantity = composeCategoryCreation(categoryCreationTemplates()[1].definition, input("quantity", "soft_goods")).definition;
  const kit = composeCategoryCreation(categoryCreationTemplates()[2].definition, input("kit", "event_kits")).definition;
  assert.notDeepEqual(quantity.supportedInventoryModes, kit.supportedInventoryModes);
  assert.ok(quantity.businessModel.pricingUnits.includes("night"));
  assert.deepEqual(kit.conditionalCapabilities, [{ code: "kit_handover", when: { inventoryModes: ["bundle"] } }]);
});

test("creation selections cannot invent algorithms, modes, identities or remove required Core mechanisms", () => {
  const source = categoryCreationTemplates()[0].definition;
  for (const mutate of [row => { row.code = "Stage_Tools"; }, row => { row.code = "path/tools"; }, row => { row.versionLabel = "1.0\n"; },
    row => { row.inventoryModes = ["quantity"]; }, row => { row.inventoryModes = []; }, row => { row.pricingUnits = ["invented"]; },
    row => { row.defaultPricingUnit = "night"; }, row => { row.fulfillmentModes = ["delivery"]; },
    row => { row.capabilityCodes = ["pickup", "return"]; }, row => { row.capabilityCodes.push("unregistered"); }]) {
    const request = input(); mutate(request); assert.throws(() => composeCategoryCreation(source, request));
  }
});

function serviceFixture() {
  let savedAudit;
  const calls = [];
  const tx = {
    rentalCategoryGovernanceAudit: {
      findUnique: async ({ where }) => savedAudit?.id === where.id ? savedAudit : null,
      create: async ({ data }) => { calls.push("audit"); savedAudit = structuredClone(data); return data; }
    },
    rentalCategoryDefinition: {
      findUnique: async () => null,
      create: async ({ data }) => { calls.push("identity"); assert.equal(data.openingScope, "unopened"); assert.equal(data.version, "1.0"); return data; }
    },
    rentalCategoryVersion: {
      findUnique: async () => null,
      create: async ({ data }) => { calls.push("draft"); return { ...data, sourceVersionId: data.sourceVersionId ?? null,
        dependencyDigest: null, publishedAt: null, publishedBy: null, publishReason: null,
        createdAt: new Date("2026-11-09T00:00:00Z"), updatedAt: new Date("2026-11-09T00:00:00Z") }; }
    }
  };
  const db = { ...tx, $transaction: async work => { calls.push("transaction"); return work(tx); } };
  const service = new CategoryGovernanceService(db, hooks());
  service.dynamicCreationEnabled = () => true;
  return { service, db, tx, calls, audit: () => savedAudit };
}

test("preview writes nothing; creation uses the supplied transaction and replays the original receipt after closure", async () => {
  const fixture = serviceFixture(), request = input("kit", "event_kits");
  const preview = await fixture.service.previewCreation(request, actor);
  assert.equal(preview.valid, true); assert.equal(preview.previewOnly, true); assert.deepEqual(fixture.calls, []);
  const create = { ...request, expectedDefinitionHash: preview.definitionHash, idempotencyKey: "create-event-kits-1", reason: "独立经营" };
  const created = await fixture.service.createCategory(create, actor);
  assert.deepEqual(fixture.calls, ["transaction", "identity", "draft", "audit"]);
  assert.equal(created.status, "draft"); assert.equal(created.categoryCode, request.code);
  fixture.service.dynamicCreationEnabled = () => false;
  assert.deepEqual(await fixture.service.createCategory(create, actor), created);
  assert.deepEqual(await fixture.service.readCreationReceipt(create.idempotencyKey, actor), { outcome: "created", version: created });
  await assert.rejects(fixture.service.createCategory({ ...create, reason: "改变输入" }, actor), /不同新品类输入/);
  assert.deepEqual(await fixture.service.readCreationReceipt(create.idempotencyKey, { ...actor, id: "another-platform-user" }), { outcome: "unknown" });
  assert.deepEqual(fixture.calls, ["transaction", "identity", "draft", "audit"], "receipt reads and retries do not run another create");
});

test("closed creation, altered previews, duplicate identities and missing execution block before active writes", async () => {
  for (const failure of ["closed", "fingerprint", "identity", "implementation"]) {
    const fixture = serviceFixture(), request = input("kit", `kit_${failure}`);
    const preview = await fixture.service.previewCreation(request, actor);
    const create = { ...request, expectedDefinitionHash: preview.definitionHash, idempotencyKey: "original-create-request", reason: "创建" };
    if (failure === "closed") fixture.service.dynamicCreationEnabled = () => false;
    if (failure === "fingerprint") create.name = "预览后变化";
    if (failure === "identity") fixture.tx.rentalCategoryDefinition.findUnique = async () => ({ code: request.code });
    if (failure === "implementation") fixture.service.hooks.reset();
    await assert.rejects(fixture.service.createCategory(create, actor));
    assert.equal(fixture.calls.includes("identity"), false);
    assert.equal(fixture.calls.includes("audit"), false);
  }
  const fixture = serviceFixture(), request = input();
  await assert.rejects(fixture.service.previewCreation({ ...request, sourceVersionId: "published-source" }, actor), /一个模板/);
  await assert.rejects(fixture.service.previewCreation({ ...request, templateId: undefined, sourceVersionId: "draft-source" }, actor), /已有发布版本/);
  for (const user of [{ ...actor, isSaasAdmin: false, permissions: ["*"] }, { ...actor, permissions: [permissions.view] }]) {
    await assert.rejects(fixture.service.previewCreation(request, user), /SaaS/);
    await assert.rejects(fixture.service.readCreationReceipt("original-create-key", user), /SaaS/);
  }
});

test("copying another published category preserves its immutable origin and supports later draft differences", async () => {
  const fixture = serviceFixture(), request = input("kit", "studio_kits");
  request.templateId = undefined; request.sourceVersionId = "original-published-source";
  const definition = categoryCreationTemplates().find(row => row.id === "kit").definition;
  const source = { id: request.sourceVersionId, categoryCode: definition.code, status: "published", definition: structuredClone(definition) };
  fixture.tx.rentalCategoryVersion.findUnique = async ({ where }) => where.id === source.id ? source : null;
  const preview = await fixture.service.previewCreation(request, actor);
  assert.equal(preview.valid, true);
  const created = await fixture.service.createCategory({ ...request, expectedDefinitionHash: preview.definitionHash, idempotencyKey: "original-copy-key", reason: "复制定义" }, actor);
  assert.equal(created.sourceVersionId, source.id); assert.equal(created.sourceKind, "category_copy");
  fixture.tx.rentalCategoryVersion.findFirst = async () => created;
  fixture.db.businessWorkspace = { count: async () => 0 };
  const difference = await fixture.service.preview(request.code, created.id, actor);
  assert.equal(difference.valid, true); assert.equal(difference.sourceVersionId, source.id);
  assert.equal(source.definition.code, definition.code);
  assert.equal(created.definition.code, request.code);
});

test("creation DTO and HTTP schemas retain all fields and reject extra input", async () => {
  const { plainToInstance } = require("class-transformer");
  const { validate } = require("class-validator");
  const { CreateRentalCategoryDto } = require("../apps/api/dist/modules/rental-core/category-governance-request.dto.js");
  const { CATEGORY_CREATION_REQUEST_SCHEMA, CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA, CATEGORY_CREATION_RECEIPT_SCHEMA } = require("../apps/api/dist/contracts/category-governance-schemas.js");
  const Ajv = require("ajv"), ajv = new Ajv({ strict: false }); require("ajv-formats")(ajv);
  const request = input("kit", "event_kits"), source = categoryCreationTemplates().find(row => row.id === "kit").definition;
  const create = { ...request, expectedDefinitionHash: composeCategoryCreation(source, request).definitionHash, idempotencyKey: "create-original-key", reason: "创建" };
  const dto = plainToInstance(CreateRentalCategoryDto, create);
  assert.deepEqual(await validate(dto, { whitelist: true, forbidNonWhitelisted: true }), []);
  assert.deepEqual(JSON.parse(JSON.stringify(dto)), create);
  const accepts = ajv.compile(CATEGORY_CREATION_REQUEST_SCHEMA), previews = ajv.compile(CATEGORY_CREATION_PREVIEW_REQUEST_SCHEMA);
  assert.equal(accepts(create), true, JSON.stringify(accepts.errors));
  assert.equal(accepts({ ...create, execute: "arbitrary" }), false);
  assert.equal(previews({ ...request, sourceVersionId: "both-sources" }), false);
  assert.equal(previews({ ...request, templateId: undefined }), false);
  const fixture = serviceFixture(), created = await fixture.service.createCategory(create, actor);
  const receipts = ajv.compile(CATEGORY_CREATION_RECEIPT_SCHEMA);
  assert.equal(receipts({ outcome: "created", version: created }), true, JSON.stringify(receipts.errors));
  assert.equal(receipts({ outcome: "unknown" }), true);
});
