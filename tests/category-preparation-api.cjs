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
  assert.equal(mysqlQuery("SELECT COUNT(*) FROM tenant_subscriptions WHERE tenantId='tenant_001';").trim().split(/\r?\n/u).at(-1), "0", "本专项订阅夹具不得覆盖已有订阅");
  mysqlQuery("INSERT INTO tenant_subscriptions (id,tenantId,revision,plan,source,startAt,endAt,createdAt,updatedAt) VALUES ('e2e_category_term','tenant_001',1,'standard','historical_register','2020-01-01','2020-01-02',NOW(),NOW());");
  const expired = await call("GET", path);
  assert.equal(expired.commercialContext.serviceStatus, "expired");
  assert.equal(expired.commercialContext.complete, false);
  assert.equal(expired.businessCompatibility.valid, false);
  assert.ok(expired.businessCompatibility.blockers.some((row) => row.domain === "commercial" && row.id === "subscription_term"));
  assert.doesNotMatch(JSON.stringify(expired.commercialContext), /currentAmount|internalNote|sourceReason/);
  const termFacts = mysqlQuery("SELECT revision,startAt,endAt,updatedAt FROM tenant_subscriptions WHERE id='e2e_category_term';");
  const repaired = await call("PUT", path, { ...body, expectedPreparationRevision: 1 });
  assert.equal(repaired.revision, 2, "到期资料准备仍可保存，不等于允许正式采用");
  assert.equal(mysqlQuery("SELECT revision,startAt,endAt,updatedAt FROM tenant_subscriptions WHERE id='e2e_category_term';"), termFacts, "预览与准备不修改商业期限");
  mysqlQuery("UPDATE tenant_subscriptions SET endAt='2126-01-01' WHERE id='e2e_category_term';");
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "commercial"), "恢复有效期限后不误报到期");
  mysqlQuery("DELETE FROM tenant_subscriptions WHERE id='e2e_category_term';");
  await call("PUT", path, { ...body, expectedPreparationRevision: 2, patches: [{ ...patches[0], entityId: "cross-space-id" }, ...patches.slice(1)] }, tenantToken, 400);
  assert.equal((await call("GET", path)).preparation.revision, 2, "失败不得推进准备修订");
  const id = patches[0].entityId;
  assert.match(id, /^[A-Za-z0-9_-]+$/u);
  mysqlQuery(`UPDATE rental_item_groups SET updatedAt=DATE_ADD(updatedAt, INTERVAL 1 SECOND) WHERE id='${id}';`);
  const stale = await call("GET", path);
  assert.equal(stale.validation.valid, false);
  assert.match(stale.validation.errors[0], /来源实体已修改/);
  await call("PUT", path, { ...body, expectedPreparationRevision: 2 }, tenantToken, 409);
  // A scheduled price must be checked even when today's compatible version wins.
  // Core GET does not initialize business price versions. Create explicit
  // isolated fixtures instead of assuming a read has pricing side effects.
  mysqlQuery(`INSERT INTO rental_price_versions (id,tenantId,workspaceId,sequence,effectiveFrom,rates,createdAt) SELECT 'e2e_category_current_price',tenantId,workspaceId,1000001,'2020-01-01',JSON_ARRAY(JSON_OBJECT('unit','hour','baseAmount',100)),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'; INSERT INTO rental_price_versions (id,tenantId,workspaceId,sequence,effectiveFrom,rates,createdAt) SELECT 'e2e_category_future_price',tenantId,workspaceId,1000002,'2126-01-01',JSON_ARRAY(JSON_OBJECT('unit','shift','baseAmount',100)),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  const incompatible = await call("GET", path);
  assert.equal(incompatible.businessCompatibility.valid, false);
  assert.ok(incompatible.businessCompatibility.blockers.some((row) => row.domain === "price" && row.id === "e2e_category_future_price"), "不能只看今天价格而忽略已发布的未来价格");
  for (const priceId of ["e2e_category_current_price", "e2e_category_future_price"]) assert.ok(incompatible.businessCompatibility.blockers.some((row) => row.domain === "price_reference" && row.id === priceId), "费率缺少执行对象不能被单位校验掩盖");
  mysqlQuery(`UPDATE rental_price_versions SET rates=JSON_ARRAY(JSON_OBJECT('itemGroupId','${id}','unit','hour','baseAmount',100),JSON_OBJECT('itemGroupId','${id}','unit','hour','baseAmount',200)) WHERE id='e2e_category_current_price'; UPDATE rental_price_versions SET rates=JSON_ARRAY(JSON_OBJECT('itemGroupId','foreign-price-target','unit','hour','baseAmount',100)) WHERE id='e2e_category_future_price';`);
  const priceReferenceFacts = mysqlQuery("SELECT id,CAST(rates AS CHAR) FROM rental_price_versions WHERE id IN ('e2e_category_current_price','e2e_category_future_price') ORDER BY id;");
  const priceReferencePreview = await call("GET", path);
  for (const priceId of ["e2e_category_current_price", "e2e_category_future_price"]) assert.ok(priceReferencePreview.businessCompatibility.blockers.some((row) => row.domain === "price_reference" && row.id === priceId), "重复对象单位和不存在的执行对象必须报告");
  assert.equal(mysqlQuery("SELECT id,CAST(rates AS CHAR) FROM rental_price_versions WHERE id IN ('e2e_category_current_price','e2e_category_future_price') ORDER BY id;"), priceReferenceFacts, "预览不得改写费率事实");
  mysqlQuery(`UPDATE rental_price_versions SET rates=JSON_ARRAY(JSON_OBJECT('itemGroupId','${id}','unit','hour','baseAmount',100)) WHERE id='e2e_category_current_price';`);
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "price_reference" && row.id === "e2e_category_current_price"), "本空间有效型号费率可读执行");
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
  mysqlQuery(`INSERT INTO rental_value_added_services (id,tenantId,workspaceId,categoryCode,code,name,serviceType,billingUnit,price,termsVersion,terms,applicableItemGroupIds,applicableFulfillmentModes,mandatoryRule,status,version,createdAt,updatedAt) SELECT 'e2e_category_incompatible_service',tenantId,id,categoryCode,'ADOPT-SERVICE','采用服务专项','other','per_order',10,'1.0','专项条款',JSON_ARRAY(),JSON_ARRAY('onsite_delivery'),JSON_OBJECT('fulfillmentModes',JSON_ARRAY('onsite_delivery')),'enabled','1.0',NOW(),NOW() FROM business_workspaces WHERE id=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001');`);
  assert.equal(mysqlQuery("SELECT COUNT(*) FROM rental_value_added_services WHERE id='e2e_category_incompatible_service';").trim().split(/\r?\n/u).at(-1), "1", "服务兼容夹具必须确实落库");
  const serviceFacts = mysqlQuery("SELECT CAST(applicableFulfillmentModes AS CHAR),CAST(mandatoryRule AS CHAR),version FROM rental_value_added_services WHERE id='e2e_category_incompatible_service';");
  const servicePreview = await call("GET", path);
  assert.ok(servicePreview.businessCompatibility.blockers.some((row) => row.domain === "service" && row.id === "e2e_category_incompatible_service:fulfillmentModes"), "启用服务的适用履约方式必须检查");
  assert.ok(servicePreview.businessCompatibility.blockers.some((row) => row.domain === "service" && row.id === "e2e_category_incompatible_service:mandatoryRule"), "强制服务触发的履约方式必须检查");
  mysqlQuery("UPDATE rental_value_added_services SET status='disabled' WHERE id='e2e_category_incompatible_service';");
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.id.startsWith("e2e_category_incompatible_service:")), "停用服务保留资料但不阻挡目标版本预览");
  assert.equal(mysqlQuery("SELECT CAST(applicableFulfillmentModes AS CHAR),CAST(mandatoryRule AS CHAR),version FROM rental_value_added_services WHERE id='e2e_category_incompatible_service';"), serviceFacts, "采用预览不得改写服务配置及版本");
  mysqlQuery(`UPDATE rental_value_added_services SET status='enabled',applicableFulfillmentModes=JSON_ARRAY(),mandatoryRule=JSON_OBJECT('itemGroupIds',JSON_ARRAY('foreign-space-model')),applicableItemGroupIds=JSON_ARRAY('foreign-space-model'),applicableLocationIds=JSON_ARRAY('foreign-space-location') WHERE id='e2e_category_incompatible_service'; INSERT INTO rental_discount_plans (id,tenantId,workspaceId,categoryCode,code,name,status,discountType,discountValue,minimumSpend,customerScope,applicableItemGroupIds,applicablePricingGroupIds,applicableDayTypes,stackableWithOtherPlans,effectiveFrom,version,createdAt,updatedAt) SELECT 'e2e_category_invalid_discount',tenantId,id,categoryCode,'ADOPT-REFS','引用专项','enabled','percentage',5,0,'all',JSON_ARRAY('foreign-space-model'),JSON_ARRAY('foreign-space-price-group'),JSON_ARRAY(),false,'2020-01-01','1.0',NOW(),NOW() FROM business_workspaces WHERE id=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'); INSERT INTO rental_coupon_templates (id,tenantId,workspaceId,code,name,discountType,discountValue,minimumSpend,totalQuota,claimFrom,claimTo,effectiveFrom,effectiveTo,applicableItemGroupIds,status,version,createdAt,updatedAt) SELECT 'e2e_category_invalid_coupon',tenantId,workspaceId,'ADOPT-REFS','券引用专项','amount',10,0,100,'2020-01-01','2126-01-01','2020-01-01','2126-01-01',JSON_ARRAY('foreign-space-model'),'active','1.0',NOW(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  for (const table of ['rental_discount_plans', 'rental_coupon_templates']) assert.equal(mysqlQuery(`SELECT COUNT(*) FROM ${table} WHERE code='ADOPT-REFS';`).trim().split(/\r?\n/u).at(-1), "1", "营销引用夹具必须确实落库");
  const marketingPreview = await call("GET", path);
  for (const id of ['e2e_category_incompatible_service:itemGroups', 'e2e_category_incompatible_service:locations', 'e2e_category_incompatible_service:mandatoryItemGroups', 'e2e_category_invalid_discount:itemGroups', 'e2e_category_invalid_discount:pricingGroups', 'e2e_category_invalid_coupon:itemGroups']) assert.ok(marketingPreview.businessCompatibility.blockers.some((row) => row.domain === "marketing_reference" && row.id === id), `营销引用不得漏查 ${id}`);
  mysqlQuery("UPDATE rental_value_added_services SET status='disabled' WHERE id='e2e_category_incompatible_service'; UPDATE rental_discount_plans SET effectiveTo='2020-01-02' WHERE id='e2e_category_invalid_discount'; UPDATE rental_coupon_templates SET claimTo='2020-01-02' WHERE id='e2e_category_invalid_coupon';");
  const retiredMarketingPreview = await call("GET", path);
  assert.deepEqual(retiredMarketingPreview.businessCompatibility.blockers.filter((row) => row.domain === "marketing_reference").map((row) => row.id), ["e2e_category_invalid_coupon:itemGroups"], "领取截止不等于模板停用；启用模板仍可能被奖励发券使用");
  mysqlQuery("UPDATE rental_coupon_templates SET status='scheduled' WHERE id='e2e_category_invalid_coupon';");
  assert.ok((await call("GET", path)).businessCompatibility.blockers.some((row) => row.id === "e2e_category_invalid_coupon:itemGroups"), "计划投放模板仍需检查引用");
  mysqlQuery("UPDATE rental_coupon_templates SET status='paused' WHERE id='e2e_category_invalid_coupon';");
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "marketing_reference"), "已停用服务与券模板、已过期方案保留配置但不阻挡预览");
  assert.equal(mysqlQuery("SELECT CAST(applicableItemGroupIds AS CHAR) FROM rental_coupon_templates WHERE id='e2e_category_invalid_coupon';").trim().split(/\r?\n/u).at(-1), '["foreign-space-model"]', "预览不清洗券模板历史配置");
  // Disabled locations are absent from the active-location check, but an enabled
  // service capacity still preserves its configured location for future reuse.
  mysqlQuery(`UPDATE rental_value_added_services SET status='enabled',requiresCapacity=true,applicableItemGroupIds=JSON_ARRAY(),applicableLocationIds=JSON_ARRAY(),mandatoryRule=NULL WHERE id='e2e_category_incompatible_service'; INSERT INTO rental_fulfillment_locations (id,tenantId,workspaceId,code,name,type,capabilities,status,createdAt,updatedAt) SELECT 'e2e_category_capacity_location',tenantId,workspaceId,'ADOPT-CAPACITY','容量采用地点','unsupported',JSON_ARRAY(),'disabled',NOW(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001'; INSERT INTO rental_service_capacities (id,tenantId,workspaceId,serviceId,locationId,windowStart,windowEnd,totalCapacity,reservedQuantity,usedQuantity,status,createdAt,updatedAt) SELECT 'e2e_category_capacity',tenantId,workspaceId,'e2e_category_incompatible_service','e2e_category_capacity_location','2125-01-01','2126-01-01',4,0,0,'enabled',NOW(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  const capacityFacts = mysqlQuery("SELECT id,serviceId,locationId,windowStart,windowEnd,totalCapacity,reservedQuantity,usedQuantity,status,updatedAt FROM rental_service_capacities WHERE id='e2e_category_capacity'; SELECT COUNT(*) FROM rental_service_reservations WHERE capacityId='e2e_category_capacity';");
  assert.ok((await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "service_capacity" && row.id === "e2e_category_capacity"), "未结束启用容量的目标地点类型必须检查，即使地点当前停用");
  assert.equal(mysqlQuery("SELECT id,serviceId,locationId,windowStart,windowEnd,totalCapacity,reservedQuantity,usedQuantity,status,updatedAt FROM rental_service_capacities WHERE id='e2e_category_capacity'; SELECT COUNT(*) FROM rental_service_reservations WHERE capacityId='e2e_category_capacity';"), capacityFacts, "预览不改写容量计数或创建预留");
  for (const statement of ["UPDATE rental_service_capacities SET status='disabled' WHERE id='e2e_category_capacity';", "UPDATE rental_service_capacities SET status='enabled',windowEnd='2020-01-02',windowStart='2020-01-01' WHERE id='e2e_category_capacity';", "UPDATE rental_service_capacities SET windowStart='2125-01-01',windowEnd='2126-01-01' WHERE id='e2e_category_capacity'; UPDATE rental_value_added_services SET status='disabled' WHERE id='e2e_category_incompatible_service';"]) {
    mysqlQuery(statement);
    assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "service_capacity"), "停用/已结束容量或停用服务不阻碍新采用，不重写历史预留");
  }
  const allowedLocation = source.definition.businessModel.locationTypes[0];
  assert.match(allowedLocation, /^[a-z_]+$/u);
  mysqlQuery(`UPDATE rental_value_added_services SET status='enabled' WHERE id='e2e_category_incompatible_service'; UPDATE rental_fulfillment_locations SET type='${allowedLocation}' WHERE id='e2e_category_capacity_location';`);
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "service_capacity"), "本空间兼容地点的容量不应误报");
  // These are real foreign-space IDs, not merely nonexistent strings. Legacy
  // ID-only foreign keys can accept them; preparation must use scoped lookups.
  const graphAssetId = current.entities.assets[0].id;
  assert.match(graphAssetId, /^[A-Za-z0-9_-]+$/u);
  const graphAssetOriginal = JSON.parse(mysqlQuery(`SELECT JSON_OBJECT('itemGroupId',itemGroupId,'locationId',locationId) FROM rental_assets WHERE id='${graphAssetId}';`).trim().split(/\r?\n/u).at(-1));
  for (const value of Object.values(graphAssetOriginal)) assert.match(value, /^[A-Za-z0-9_-]+$/u);
  mysqlQuery(`INSERT INTO rental_item_groups (id,tenantId,workspaceId,categoryCode,code,name,inventoryMode,unit,attributes,status,createdAt,updatedAt) SELECT 'e2e_graph_foreign_model',tenantId,id,categoryCode,'ADOPT-GRAPH-FOREIGN','外空间关系夹具','serialized','件',JSON_OBJECT(),'enabled',NOW(),NOW() FROM business_workspaces WHERE id<>(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001') ORDER BY id LIMIT 1; INSERT INTO rental_fulfillment_locations (id,tenantId,workspaceId,code,name,type,capabilities,status,createdAt,updatedAt) SELECT 'e2e_graph_foreign_location',tenantId,workspaceId,'ADOPT-GRAPH-FOREIGN','外空间地点夹具','store',JSON_ARRAY(),'enabled',NOW(),NOW() FROM rental_item_groups WHERE id='e2e_graph_foreign_model'; INSERT INTO rental_pricing_groups (id,tenantId,workspaceId,categoryCode,code,name,defaultPricingUnit,status,createdAt,updatedAt) SELECT 'e2e_graph_pricing',tenantId,workspaceId,categoryCode,'ADOPT-GRAPH','分组关系夹具','shift','enabled',NOW(),NOW() FROM rental_item_groups WHERE id='${id}'; INSERT INTO rental_pricing_group_members (id,pricingGroupId,itemGroupId,createdAt) VALUES ('e2e_graph_member','e2e_graph_pricing','e2e_graph_foreign_model',NOW()); INSERT INTO rental_item_groups (id,tenantId,workspaceId,categoryCode,code,name,inventoryMode,unit,attributes,status,createdAt,updatedAt) SELECT 'e2e_graph_bundle',tenantId,workspaceId,categoryCode,'ADOPT-GRAPH-BUNDLE','套装关系夹具','bundle','套',JSON_OBJECT(),'enabled',NOW(),NOW() FROM rental_item_groups WHERE id='${id}'; INSERT INTO rental_bundle_components (id,bundleItemGroupId,componentItemGroupId,quantity,createdAt) VALUES ('e2e_graph_component','e2e_graph_bundle','e2e_graph_foreign_model',1,NOW()); UPDATE rental_assets SET itemGroupId='e2e_graph_foreign_model',locationId='e2e_graph_foreign_location' WHERE id='${graphAssetId}';`);
  const graphQuery = `SELECT itemGroupId,locationId FROM rental_assets WHERE id='${graphAssetId}'; SELECT defaultPricingUnit FROM rental_pricing_groups WHERE id='e2e_graph_pricing'; SELECT itemGroupId FROM rental_pricing_group_members WHERE id='e2e_graph_member'; SELECT componentItemGroupId,quantity FROM rental_bundle_components WHERE id='e2e_graph_component';`;
  const graphFacts = mysqlQuery(graphQuery);
  const graphPreview = await call("GET", path);
  for (const [domain, blockerId] of [["asset_reference", graphAssetId], ["pricing_group", "e2e_graph_pricing:defaultUnit"], ["pricing_group", "e2e_graph_pricing:members"], ["bundle_reference", "e2e_graph_bundle"]]) assert.ok(graphPreview.businessCompatibility.blockers.some((row) => row.domain === domain && row.id === blockerId), `真实外空间关联或目标默认单位不得漏查 ${blockerId}`);
  assert.equal(mysqlQuery(graphQuery), graphFacts, "关联预览不得改资产、套装或分组事实");
  mysqlQuery(`UPDATE rental_assets SET itemGroupId='${graphAssetOriginal.itemGroupId}',locationId='${graphAssetOriginal.locationId}' WHERE id='${graphAssetId}'; UPDATE rental_pricing_groups SET defaultPricingUnit='hour' WHERE id='e2e_graph_pricing'; UPDATE rental_pricing_group_members SET itemGroupId='${id}' WHERE id='e2e_graph_member'; UPDATE rental_bundle_components SET componentItemGroupId='${id}' WHERE id='e2e_graph_component';`);
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => ["asset_reference", "pricing_group", "bundle_reference"].includes(row.domain)), "修复为空间内合法关联后不得误报");
  mysqlQuery("UPDATE rental_rule_versions SET config=JSON_OBJECT('payment',JSON_OBJECT(),'overdue',NULL) WHERE id='e2e_category_future_safety';");
  assert.ok((await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "rule" && row.id === "e2e_category_future_safety" && row.message.includes("结构")), "异常未来规则应返回可理解阻碍，不是500");
  assert.equal(mysqlQuery("SELECT JSON_TYPE(JSON_EXTRACT(config,'$.overdue')) FROM rental_rule_versions WHERE id='e2e_category_future_safety';").trim().split(/\r?\n/u).at(-1), "NULL", "不以默认逾时规则替换异常配置");
  mysqlQuery("UPDATE rental_rule_versions SET config=JSON_OBJECT('payment',JSON_OBJECT(),'overdue',JSON_OBJECT('feeMode',JSON_OBJECT('toString','none'))) WHERE id='e2e_category_future_safety';");
  assert.ok((await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "rule" && row.id === "e2e_category_future_safety" && row.message.includes("结构")), "非文本费率模式不能触发隐式转换或500");
  mysqlQuery(`INSERT INTO rental_price_versions (id,tenantId,workspaceId,sequence,effectiveFrom,rates,createdAt) SELECT 'e2e_graph_empty_price',tenantId,workspaceId,1000003,'2127-01-01',JSON_ARRAY(),NOW() FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001';`);
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "price_reference" && row.id === "e2e_graph_empty_price"), "最后计划到期后的空价格时间轴不应误报损坏对象引用");
  mysqlQuery(`UPDATE rental_rule_versions SET config=JSON_OBJECT('payment',JSON_OBJECT(),'overdue',JSON_OBJECT('feeMode','none'),'fulfillment',JSON_OBJECT('pickupInspectionRequired',false,'returnInspectionRequired',false)) WHERE id='e2e_category_future_safety'; INSERT INTO rental_inspection_templates (id,tenantId,workspaceId,categoryCode,code,name,stage,version,fields,enabled,createdAt,updatedAt) SELECT 'e2e_category_return_template',tenantId,id,categoryCode,'ADOPT-BROKEN-TEMPLATE','可选检查异常夹具','return','1.0',JSON_OBJECT('broken',true),true,NOW(),NOW() FROM business_workspaces WHERE id=(SELECT workspaceId FROM rental_category_adoption_preparations WHERE targetVersionId='${draft.id}' AND tenantId='tenant_001');`);
  const brokenTemplates = await call("GET", path);
  assert.ok(brokenTemplates.businessCompatibility.blockers.some((row) => row.domain === "inspection" && row.id === "e2e_category_return_template"), "即使新规则不强制检查，启用的畸形模板也会进入报价快照，不能漏查");
  assert.equal(mysqlQuery("SELECT JSON_TYPE(fields) FROM rental_inspection_templates WHERE id='e2e_category_return_template';").trim().split(/\r?\n/u).at(-1), "OBJECT", "预览不覆盖模板正文");
  mysqlQuery("UPDATE rental_inspection_templates SET fields=JSON_ARRAY(),categoryCode='VEHICLE' WHERE id='e2e_category_return_template';");
  assert.ok((await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "inspection" && row.id === "e2e_category_return_template"), "同一空间中残留其他品类模板也会让真实报价拒绝，采用预检须同步拒绝");
  mysqlQuery("UPDATE rental_inspection_templates SET enabled=false WHERE id='e2e_category_return_template';");
  assert.ok(!(await call("GET", path)).businessCompatibility.blockers.some((row) => row.domain === "inspection" && row.id === "e2e_category_return_template"), "停用异常模板不阻碍新组合、不影响旧单检查快照");
  {
  // Candidate capability configuration never changes the live instance or its audit.
  const capabilityPreview = await call("GET", path);
  const live = capabilityPreview.entities.capabilities.find((row) => row.code === "camera_compatibility" && row.status === "enabled");
  assert.ok(live, "演示摄影空间必须有已启用的真实兼容能力");
  const capabilityFactsQuery = "SELECT code,status,revision,implementationVersion,configVersion,CAST(config AS CHAR) FROM workspace_capability_instances WHERE tenantId='tenant_001' AND workspaceId='ws_tenant_001' ORDER BY code; SELECT COUNT(*) FROM workspace_capability_audits WHERE tenantId='tenant_001' AND workspaceId='ws_tenant_001';";
  const liveFacts = mysqlQuery(capabilityFactsQuery);
  const refreshedPatches = [
    ...capabilityPreview.entities.itemGroups.map((row) => ({ entityType: "item_group", entityId: row.id, expectedUpdatedAt: row.updatedAt, values: { adoptionProof: "ready" } })),
    ...capabilityPreview.entities.assets.map((row) => ({ entityType: "asset", entityId: row.id, expectedUpdatedAt: row.updatedAt, values: { adoptionProofAsset: "B" } }))
  ];
  const capabilityBody = { ...body, patches: refreshedPatches, expectedPreparationRevision: capabilityPreview.preparation.revision, capabilityPatches: [{ code: live.code, expectedRevision: live.revision, expectedImplementationVersion: live.implementationVersion, config: { relations: [] } }] };
  await call("PUT", path, { ...capabilityBody, capabilityPatches: [{ ...capabilityBody.capabilityPatches[0], config: { unsupported: true } }] }, tenantToken, 400);
  await call("PUT", path, { ...capabilityBody, capabilityPatches: [{ ...capabilityBody.capabilityPatches[0], expectedRevision: live.revision + 1 }] }, tenantToken, 409);
  let configured = await call("PUT", path, capabilityBody);
  assert.equal(configured.revision, capabilityPreview.preparation.revision + 1);
  assert.deepEqual((await call("GET", path)).preparation.patches.capabilityPatches, capabilityBody.capabilityPatches);
  configured = await call("PUT", path, { ...body, patches: refreshedPatches, expectedPreparationRevision: configured.revision });
  assert.deepEqual((await call("GET", path)).preparation.patches.capabilityPatches, capabilityBody.capabilityPatches, "旧版资料客户端省略能力字段时不得清空独立预备配置");
  assert.equal(mysqlQuery(capabilityFactsQuery), liveFacts, "保存和预览不能改活动能力、版本、修订或审计");
  mysqlQuery("UPDATE workspace_capability_instances SET revision=revision+1 WHERE tenantId='tenant_001' AND workspaceId='ws_tenant_001' AND code='camera_compatibility';");
  const staleCapability = await call("GET", path);
  assert.equal(staleCapability.validation.valid, false);
  assert.ok(staleCapability.validation.errors.some((error) => error.includes("能力实例")));
  assert.deepEqual(staleCapability.preparation.patches.capabilityPatches, capabilityBody.capabilityPatches, "冲突后保留待修正输入");
  await call("PUT", path, { ...capabilityBody, expectedPreparationRevision: configured.revision }, tenantToken, 409);
  mysqlQuery("UPDATE workspace_capability_instances SET revision=revision-1 WHERE tenantId='tenant_001' AND workspaceId='ws_tenant_001' AND code='camera_compatibility';");
  assert.equal(mysqlQuery(capabilityFactsQuery), liveFacts);
  }
  console.log("category-preparation-api: 经营兼容、空间关联、异常结构、空时间轴及能力配置独立准备/陈旧来源保留通过");
};
