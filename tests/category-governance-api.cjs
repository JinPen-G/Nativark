"use strict";
const assert = require("node:assert/strict");

module.exports = async function categoryGovernanceApi({ request, token, tenantToken, mysqlQuery }) {
  const base = "/api/platform/rental-categories";
  const call = async (method, suffix, body, status = 200) => {
    const result = await request(method, base + suffix, body, token);
    assert.equal(result.status, status, `${method} ${suffix}: ${JSON.stringify(result.body).slice(0, 700)}`);
    return result.body.data;
  };
  assert.equal((await request("GET", base, undefined, tenantToken)).status, 403, "租户管理员不可越权治理平台品类");
  const initial = await call("GET", "/camera");
  const source = initial.versions.find((v) => v.id === initial.recommendedVersionId);
  assert.ok(source, "已有推荐版本必须存在");
  const original = structuredClone(source.definition);
  const draft = await call("POST", "/camera/drafts", { sourceVersionId: source.id, versionLabel: "e2e-governance-v2", reason: "专项复制草稿" }, 201);
  const section = `/camera/versions/${draft.id}/sections/basic`;
  await call("PATCH", section, { expectedRevision: 0, values: { code: "vehicle" }, reason: "禁止跨页改身份" }, 400);
  const patched = await call("PATCH", section, { expectedRevision: 0, values: { name: "测试摄影品类" }, reason: "仅保存基础页" });
  assert.equal(patched.revision, 1);
  assert.deepEqual(patched.definition.businessModel, original.businessModel, "基础页保存不能覆盖其他页签");
  await call("PATCH", section, { expectedRevision: 0, values: { name: "过期修改" }, reason: "并发冲突" }, 409);
  await call("PATCH", `/camera/versions/${source.id}/sections/basic`, { expectedRevision: source.revision, values: { name: "不得改发布版" }, reason: "不可变性" }, 409);
  await call("POST", `/camera/versions/${source.id}/archive`, { expectedRevision: source.revision, reason: "不得归档发布版" }, 409);
  const catalog = await call("GET", "/capability-catalog");
  assert.equal(catalog.dynamicCreationEnabled, false, "枚举迁移前不得假称支持新编码");
  const implemented = new Set(catalog.capabilities.filter((v) => v.implemented).map((v) => v.code));
  const prepared = await call("PATCH", `/camera/versions/${draft.id}/sections/capabilities`, {
    expectedRevision: 1, values: { defaultCapabilities: original.defaultCapabilities.filter((v) => implemented.has(v)) }, reason: "只声明已实现能力"
  });
  const check = await call("POST", `/camera/versions/${draft.id}/validate`, undefined, 201);
  assert.equal(check.valid, true, JSON.stringify(check.errors));
  const preview = await call("GET", `/camera/versions/${draft.id}/preview`);
  assert.equal(preview.previewOnly, true);
  assert.ok(preview.changedSections.includes("basic"));
  const payload = { expectedRevision: prepared.revision, idempotencyKey: "e2e-publish-category-v2", reason: "完整版本发布" };
  const attempts = await Promise.all([call("POST", `/camera/versions/${draft.id}/publish`, payload, 201), call("POST", `/camera/versions/${draft.id}/publish`, payload, 201)]);
  assert.equal(attempts[0].id, attempts[1].id, "并发重复发布必须返回同一版本");
  assert.equal(attempts[0].policy.createScope, "none");
  await call("POST", `/camera/versions/${draft.id}/publish`, { ...payload, idempotencyKey: "different-idempotency-key" }, 409);
  const after = await call("GET", "/camera");
  assert.equal(after.recommendedVersionId, initial.recommendedVersionId, "发布不等于自动推荐或采用");
  assert.deepEqual(after.versions.find((v) => v.id === source.id).definition, original, "源发布正文不得改写");
  const audits = await call("GET", "/camera/audits");
  assert.equal(audits.filter((a) => a.action === "publish" && a.versionId === draft.id).length, 1, "只允许一条发布审计");
  await call("PUT", `/camera/versions/${draft.id}/adoption-policy`, {
    expectedRevision: 0, createScope: "pilot", createTenantIds: ["tenant_001"], upgradeScope: "pilot", upgradeTenantIds: ["tenant_001"], restoreScope: "none", restoreTenantIds: [], reason: "新版本仅授权试点"
  });
  const pilot = await call("GET", "/camera/candidates/tenant_001/upgrade");
  const outside = await call("GET", "/camera/candidates/tenant_002/upgrade");
  assert.ok(pilot.some((v) => v.id === draft.id));
  assert.ok(!outside.some((v) => v.id === draft.id), "非试点不能看到目标版本采用候选");
  await call("PUT", `/camera/versions/${draft.id}/adoption-policy`, {
    expectedRevision: 1, createScope: "pilot", createTenantIds: ["tenant-does-not-exist"], upgradeScope: "all", upgradeTenantIds: [], restoreScope: "none", restoreTenantIds: [], reason: "无效政策必须整体回滚"
  }, 400);
  const preserved = await call("GET", "/camera");
  assert.equal(preserved.versions.find((v) => v.id === draft.id).policy.revision, 1, "失败政策不得推进修订号");
  assert.ok(!(await call("GET", "/camera/candidates/tenant_002/upgrade")).some((v) => v.id === draft.id));
  // Dedicated test DB only. The existing token must reflect revoked action rights.
  try {
    mysqlQuery("DELETE rp FROM RolePermission rp JOIN Permission p ON p.id=rp.permissionId WHERE rp.roleId='role_saas_admin' AND p.code IN ('system:rental-category:edit','system:rental-category:publish','system:rental-category:opening','system:rental-category:audit');");
    await call("GET", "/camera");
    await call("POST", "/camera/drafts", { sourceVersionId: source.id, versionLabel: "denied-v3", reason: "仅查看不可编辑" }, 403);
    await call("POST", `/camera/versions/${draft.id}/publish`, payload, 403);
    await call("PUT", "/camera/opening-policy", { expectedRevision: after.openingRevision, scope: "stopped", tenantIds: [], reason: "仅查看不可停用" }, 403);
    await call("GET", "/camera/audits", undefined, 403);
  } finally {
    mysqlQuery("INSERT IGNORE INTO RolePermission (roleId,permissionId) SELECT 'role_saas_admin',id FROM Permission WHERE code IN ('system:rental-category:edit','system:rental-category:publish','system:rental-category:opening','system:rental-category:audit');");
  }
  await call("PUT", "/camera/opening-policy", { expectedRevision: after.openingRevision, scope: "stopped", tenantIds: [], reason: "验证停止新开通" });
  const blocked = await request("POST", "/api/platform/tenants/tenant_001/workspaces", { code: "governance-blocked", name: "测试停用", categoryCode: "camera" }, token);
  assert.equal(blocked.status, 403, `停止开通后创建必须拒绝：${JSON.stringify(blocked.body)}`);
  assert.equal((await request("GET", "/api/rental/v1/orders", undefined, tenantToken)).status, 200, "停止新开通不能停止既有空间经营");
};
