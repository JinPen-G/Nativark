"use strict";
const assert = require("node:assert/strict");
module.exports = async ({ request, platformToken, tenantToken, mysqlQuery }) => {
  const platform = "/api/platform/rental-categories";
  const candidatePath = "/api/rental/v1/category-adoption/candidates";
  const call = async (method, path, body, token = tenantToken, expected = 200) => {
    const result = await request(method, path, body, token);
    assert.equal(result.status, expected, `${method} ${path}: ${JSON.stringify(result.body).slice(0, 900)}`);
    return result.body.data;
  };
  const detail = await call("GET", `${platform}/camera`, undefined, platformToken);
  const source = detail.versions.find((row) => row.id === detail.recommendedVersionId);
  const draft = await call("POST", `${platform}/camera/drafts`, { sourceVersionId: source.id, versionLabel: "e2e-preparation-required", reason: "候选必填准备" }, platformToken, 201);
  await call("GET", candidatePath, undefined, platformToken, 403);
  await call("GET", candidatePath + "?operation=create", undefined, tenantToken, 400);
  assert.ok(!(await call("GET", candidatePath)).versions.some((row) => row.id === draft.id), "草稿不得进入租户目标目录");
  const fields = [...source.definition.businessModel.assetFields,
    { scope: "item_group", code: "adoptionProof", label: "目标型号资料", type: "string", required: true },
    { scope: "asset", code: "adoptionProofAsset", label: "目标资产资料", type: "select", options: ["B"], required: true }];
  const attributes = await call("PATCH", `${platform}/camera/versions/${draft.id}/sections/attributes`, { expectedRevision: 0, values: { assetFields: fields }, reason: "新增必填" }, platformToken);
  const catalog = await call("GET", `${platform}/capability-catalog`, undefined, platformToken);
  const implemented = new Set(catalog.capabilities.filter((row) => row.implemented).map((row) => row.code));
  const prepared = await call("PATCH", `${platform}/camera/versions/${draft.id}/sections/capabilities`, { expectedRevision: attributes.revision, values: { defaultCapabilities: source.definition.defaultCapabilities.filter((code) => implemented.has(code)) }, reason: "仅已实现能力" }, platformToken);
  await call("POST", `${platform}/camera/versions/${draft.id}/publish`, { expectedRevision: prepared.revision, idempotencyKey: "e2e-preparation-publish", reason: "准备专项" }, platformToken, 201);
  assert.ok(!(await call("GET", candidatePath)).versions.some((row) => row.id === draft.id), "已发布但未开放采用的版本不得进入目录");
  await call("PUT", `${platform}/camera/versions/${draft.id}/adoption-policy`, { expectedRevision: 0, createScope: "none", createTenantIds: [], upgradeScope: "pilot", upgradeTenantIds: ["tenant_001"], restoreScope: "none", restoreTenantIds: [], reason: "只允许本租户升级准备" }, platformToken);
  const candidates = await call("GET", candidatePath + "?tenantId=forged&workspaceId=forged");
  const candidate = candidates.versions.find((row) => row.id === draft.id);
  assert.deepEqual(Object.keys(candidate).sort(), ["definitionExecutable", "id", "versionLabel"], "只投影最小元数据，不泄漏正文和租户试点清单");
  assert.equal(candidate.definitionExecutable, true);
  assert.ok(!candidates.versions.some((row) => row.id === candidates.sourceVersionId), "当前已采用版本不再次作为目标");
  assert.ok(!(await call("GET", candidatePath + "?operation=restore")).versions.some((row) => row.id === draft.id), "恢复资格不能借用升级资格");
  const path = `/api/rental/v1/category-adoption/${draft.id}/preparation`;
  await call("GET", path, undefined, platformToken, 403);
  await call("GET", path + "?operation=restore", undefined, tenantToken, 403);
  await call("GET", path + "?operation=invalid", undefined, tenantToken, 400);
  // Ensure demo asset facts are materialized before reading candidate revisions.
  await call("GET", "/api/rental/v1/assets");
  const current = await call("GET", path);
  assert.equal(current.validationScope, "entity_attributes_inventory_uniqueness");
  assert.equal(current.businessCompatibility.complete, false, "局部经营检查不得冒充完整采用验收");
  assert.equal(current.validation.valid, false, "目标新增必填时应显示真实缺项");
  assert.ok(current.entities.itemGroups.length && current.entities.assets.length, "必须覆盖型号与资产两类实体");
  const before = mysqlQuery("SELECT id, CAST(attributes AS CHAR), updatedAt FROM rental_item_groups WHERE tenantId='tenant_001' ORDER BY id; SELECT id, CAST(attributes AS CHAR), updatedAt FROM rental_assets WHERE tenantId='tenant_001' ORDER BY id; SELECT id, categoryVersionId, categoryAdoptionRevision FROM business_workspaces WHERE tenantId='tenant_001' ORDER BY id;");
  const patches = [
    ...current.entities.itemGroups.map((row) => ({ entityType: "item_group", entityId: row.id, expectedUpdatedAt: row.updatedAt, values: { adoptionProof: "ready" } })),
    ...current.entities.assets.map((row) => ({ entityType: "asset", entityId: row.id, expectedUpdatedAt: row.updatedAt, values: { adoptionProofAsset: "B" } }))
  ];
  const body = { expectedSourceVersionId: current.sourceVersionId, expectedSourceRevision: current.sourceRevision, expectedPreparationRevision: 0, operation: "upgrade", patches, reason: "完成候选资料但保持原版营业" };
  const saved = await call("PUT", path, { ...body, workspaceId: "forged" });
  assert.equal(mysqlQuery(`SELECT COUNT(*) FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND workspaceId='forged';`).trim().split(/\r?\n/u).at(-1), "0", "未知请求字段会被 DTO 白名单剔除，不得改变会话空间");
  assert.equal(saved.revision, 1);
  assert.equal(saved.preparedOnly, true);
  assert.equal(saved.adoptionImplemented, false);
  await call("PUT", path, body, tenantToken, 409);
  const after = mysqlQuery("SELECT id, CAST(attributes AS CHAR), updatedAt FROM rental_item_groups WHERE tenantId='tenant_001' ORDER BY id; SELECT id, CAST(attributes AS CHAR), updatedAt FROM rental_assets WHERE tenantId='tenant_001' ORDER BY id; SELECT id, categoryVersionId, categoryAdoptionRevision FROM business_workspaces WHERE tenantId='tenant_001' ORDER BY id;");
  assert.equal(after, before, "准备不得修改任何活动资料或绑定");
  assert.equal((await call("GET", path)).validation.valid, true);
  await call("PUT", path, { ...body, expectedPreparationRevision: 1, patches: [{ ...patches[0], entityId: "cross-space-id" }, ...patches.slice(1)] }, tenantToken, 400);
  assert.equal((await call("GET", path)).preparation.revision, 1, "失败不得推进准备修订");
  const id = patches[0].entityId;
  assert.match(id, /^[A-Za-z0-9_-]+$/u);
  mysqlQuery(`UPDATE rental_item_groups SET updatedAt=DATE_ADD(updatedAt, INTERVAL 1 SECOND) WHERE id='${id}';`);
  const stale = await call("GET", path);
  assert.equal(stale.validation.valid, false);
  assert.match(stale.validation.errors[0], /来源实体已修改/);
  await call("PUT", path, { ...body, expectedPreparationRevision: 1 }, tenantToken, 409);
  // A scheduled price must be checked even when today's compatible version wins.
  // Core GET does not initialize business price versions. Create explicit
  // isolated fixtures instead of assuming a read has pricing side effects.
  mysqlQuery(`INSERT INTO rental_price_versions (id,tenantId,workspaceId,sequence,effectiveFrom,rates,createdAt) SELECT 'e2e_category_current_price',tenantId,workspaceId,1000001,'2020-01-01',JSON_ARRAY(JSON_OBJECT('unit','hour','baseAmount',100)),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'; INSERT INTO rental_price_versions (id,tenantId,workspaceId,sequence,effectiveFrom,rates,createdAt) SELECT 'e2e_category_future_price',tenantId,workspaceId,1000002,'2126-01-01',JSON_ARRAY(JSON_OBJECT('unit','shift','baseAmount',100)),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  const incompatible = await call("GET", path);
  assert.equal(incompatible.businessCompatibility.valid, false);
  assert.ok(incompatible.businessCompatibility.blockers.some((row) => row.domain === "price" && row.id === "e2e_category_future_price"), "不能只看今天价格而忽略已发布的未来价格");
  mysqlQuery(`INSERT INTO rental_rule_versions (id,tenantId,workspaceId,categoryCode,version,status,config,changeReason,createdBy,effectiveFrom,createdAt) SELECT 'e2e_category_future_safety',tenantId,id,categoryCode,'e2e-future-safety','published',JSON_OBJECT('payment',JSON_OBJECT('preauthorizationRequired',false,'depositMode','none'),'overdue',JSON_OBJECT('feeMode','none'),'qualification',JSON_OBJECT('required',true),'fulfillment',JSON_OBJECT('pickupInspectionRequired',true,'returnInspectionRequired',true)),'兼容专项','fixture','2126-01-01',NOW() FROM business_workspaces WHERE id=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'); UPDATE rental_inspection_templates SET enabled=false WHERE tenantId='tenant_001' AND workspaceId=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001') AND stage='return';`);
  const safetyPreview = await call("GET", path);
  assert.ok(safetyPreview.businessCompatibility.blockers.some((row) => row.domain === "inspection" && row.id === "e2e_category_future_safety:return"), "未来要求归还检查的规则不能使用停用模板");
  if (!source.definition.businessModel.supportsQualificationReview) assert.ok(safetyPreview.businessCompatibility.blockers.some((row) => row.domain === "rule" && row.id === "e2e_category_future_safety"), "新版不支持资质审核时须指出未来规则冲突");
  mysqlQuery(`INSERT INTO workspace_capability_instances (id,tenantId,workspaceId,code,status,implementationVersion,configVersion,config,revision,createdAt,updatedAt) SELECT 'e2e_category_invalid_capability',tenantId,workspaceId,'camera_kit_handover','enabled','missing-implementation','v1',JSON_OBJECT(),1,NOW(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  const capabilityPreview = await call("GET", path);
  assert.ok(capabilityPreview.businessCompatibility.blockers.some((row) => row.domain === "capability" && row.id === "camera_kit_handover"), "已启用实例的缺失实现不能被忽略");
  assert.ok(capabilityPreview.businessCompatibility.checkedCapabilityCodes.includes("camera_kit_handover"));
  mysqlQuery("UPDATE workspace_capability_instances SET status='disabled' WHERE id='e2e_category_invalid_capability';");
  const disabledPreview = await call("GET", path);
  assert.ok(!disabledPreview.businessCompatibility.checkedCapabilityCodes.includes("camera_kit_handover"), "停用实例保留事实但不执行当前组合");
  mysqlQuery(`DELETE FROM workspace_capability_instances WHERE id='e2e_category_invalid_capability'; INSERT INTO workspace_capability_instances (id,tenantId,workspaceId,code,status,implementationVersion,configVersion,config,revision,createdAt,updatedAt) SELECT 'e2e_category_invalid_capability',tenantId,workspaceId,'camera_compatibility','enabled','cam-1.0','v1',JSON_OBJECT('relations',JSON_ARRAY(JSON_OBJECT('id','invalid-scoped-ref','relationType','model_fit','outcome','warn','sourceName','fixture','reason','scoped-reference-test','source',JSON_OBJECT('kind','item_group','id','foreign-space-model'),'target',JSON_OBJECT('kind','attribute','field','retired_unknown_field','value','x')))),1,NOW(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001' ON DUPLICATE KEY UPDATE status=VALUES(status),implementationVersion=VALUES(implementationVersion),config=VALUES(config);`);
  const referencesPreview = await call("GET", path);
  assert.ok(referencesPreview.businessCompatibility.blockers.some((row) => row.domain === "capability_reference" && row.id.endsWith(":source")), "格式正确也不能引用空间外型号");
  assert.ok(referencesPreview.businessCompatibility.blockers.some((row) => row.domain === "capability_reference" && row.id.endsWith(":target")), "目标不支持的属性不能继续当作兼容关系使用");
  mysqlQuery(`UPDATE rental_inspection_templates SET enabled=true,fields=JSON_ARRAY() WHERE tenantId='tenant_001' AND workspaceId=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001') AND stage='return'; UPDATE rental_rule_versions SET config=JSON_SET(config,'$.qualification.documentTypes',JSON_ARRAY('unregistered-proof')) WHERE id='e2e_category_future_safety';`);
  const completenessPreview = await call("GET", path);
  assert.ok(completenessPreview.businessCompatibility.blockers.some((row) => row.domain === "inspection" && row.id === "e2e_category_future_safety:return"), "空检查模板不能满足强制归还检查");
  assert.ok(completenessPreview.businessCompatibility.blockers.some((row) => row.domain === "rule" && row.id === "e2e_category_future_safety:qualification:unregistered-proof"), "未在会话空间启用的证件不能作为资质规则依赖");
  // A governance-only fixture may never have initialized business prices.
  // Create an explicit scoped plan instead of silently INSERT...SELECT zero rows.
  mysqlQuery(`INSERT INTO rental_pricing_plans (id,tenantId,workspaceId,categoryCode,code,name,status,version,effectiveFrom,rates,fulfillmentFees,createdAt,updatedAt) SELECT 'e2e_category_fee_plan',tenantId,id,categoryCode,'ADOPT-FEES','采用费用专项','enabled','1.0','2020-01-01',JSON_ARRAY(JSON_OBJECT('unit','hour','baseAmount',100)),JSON_ARRAY(JSON_OBJECT('mode','onsite_delivery','amount',10)),NOW(),NOW() FROM business_workspaces WHERE id=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'); INSERT INTO rental_price_adjustment_plans (id,tenantId,workspaceId,planId,code,name,status,changes,scheduledAt,finalRates,changeReason,createdAt,updatedAt) SELECT 'e2e_category_pending_price',tenantId,workspaceId,id,'ADOPT-PENDING','采用兼容专项','pending',JSON_ARRAY(),'2126-01-01',JSON_ARRAY(JSON_OBJECT('unit','shift','baseAmount',100)),'专项',NOW(),NOW() FROM rental_pricing_plans WHERE id='e2e_category_fee_plan';`);
  assert.equal(mysqlQuery("SELECT COUNT(*) FROM rental_price_adjustment_plans WHERE id='e2e_category_pending_price';").trim().split(/\r?\n/u).at(-1), "1", "待生效价格夹具必须确实落库");
  const pendingPricePreview = await call("GET", path);
  assert.ok(pendingPricePreview.businessCompatibility.blockers.some((row) => row.domain === "price" && row.id === "e2e_category_pending_price"), "尚未生成价格版本的待生效调价也必须检查");
  assert.ok(pendingPricePreview.businessCompatibility.blockers.some((row) => row.domain === "price" && row.id.endsWith(":fulfillmentFees")), "启用价格计划的履约费用不应漏查");
  mysqlQuery("UPDATE rental_price_adjustment_plans SET status='cancelled' WHERE id='e2e_category_pending_price';");
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.id === "e2e_category_pending_price"), "已取消计划保留历史但不参与后续执行检查");
  console.log("category-preparation-api: 会话空间与独立权限、候选资料隔离、修订冲突、经营依赖及待生效调价/履约收费检查通过");
};
