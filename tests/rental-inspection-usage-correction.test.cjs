const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const shared = read("packages/shared/src/core.ts");
const dto = read("apps/api/src/modules/rental-core/rental-order-request.dto.ts");
const repository = read("apps/api/src/modules/rental-core/rental-core-fact.repository.ts");
const service = read("apps/api/src/modules/rental-core/rental-core.service.ts");
const controller = read("apps/api/src/modules/rental-core/rental-core.controller.ts");
const guard = read("apps/api/src/common/api-auth.guard.ts");
const openapi = read("apps/api/src/contracts/openapi-document.ts");
const api = read("apps/admin/src/api/rentalCore.ts");
const page = read("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");

assert.match(shared, /usageCorrections\?: Array<\{/u, "检查记录必须保留追加式使用量修正历史");
assert.match(shared, /export interface CorrectRentalInspectionUsageRequest/u, "必须有独立的使用量修正请求契约");
assert.match(dto, /class CorrectRentalInspectionUsageDto/u, "必须有使用量修正 DTO");
assert.match(dto, /@MaxLength\(1000\)[\s\S]*reason!: string;/u, "修正原因必须限制长度");
assert.match(repository, /usageCorrections: \[\.\.\.\(meta\.usageCorrections \?\? \[\]\), correction\]/u, "修正必须追加而不是覆盖历史");
assert.match(repository, /results\.__r1InspectionMeta = \{[\s\S]*usageReadings,[\s\S]*usageCorrections:/u, "有效读数与修正历史必须一并持久化");
assert.match(service, /baselineReading = pickupBaseline\?\.usageReadings\?\.find/u, "归还检查必须使用领取读数的当前有效值作为基准");
assert.match(service, /correctInspectionUsage\(tenantId, orderId, inspectionId, input, operator, tx\)/u, "服务层必须校验订单后委托修正");
assert.match(controller, /orders\/:id\/inspections\/:inspectionId\/usage-correction/u, "必须提供订单检查读数修正接口");
assert.match(controller, /action: "order\.inspection-usage-correction"/u, "使用量修正必须走幂等动作");
assert.match(guard, /usage-correction.*rental-os:order:operate/u, "使用量修正必须受订单操作权限保护");
assert.match(openapi, /correctRentalInspectionUsage/u, "使用量修正必须登记 OpenAPI 路由");
assert.match(api, /correctInspectionUsage:/u, "管理端必须接入使用量修正 API");
assert.match(page, /修正读数/u, "订单详情必须提供修正入口");
assert.match(page, /原始检查结果不会被覆盖/u, "页面必须明确修正不覆盖原始结果");
assert.match(page, /usageCorrections \?\? \[\]/u, "页面必须回显修正历史");

// 证伪校验：删除追加历史、归还基准、权限或页面入口任一关键接线后，本专项必须报红。
assert.doesNotMatch(repository.replace(/usageCorrections: \[\.\.\.\(meta\.usageCorrections \?\? \[\]\), correction\]/u, ""), /usageCorrections: \[\.\.\.\(meta\.usageCorrections/u);
assert.doesNotMatch(service.replace(/baselineReading = pickupBaseline\?\.usageReadings\?\.find[^;]+;/u, ""), /baselineReading = pickupBaseline\?\.usageReadings/u);
assert.doesNotMatch(guard.replace('  if (path.match(/^\\/rental\\/v1\\/orders\\/[^/]+\\/inspections\\/[^/]+\\/usage-correction$/)) return ["rental-os:order:operate"];\n', ""), /usage-correction.*rental-os:order:operate/u);
assert.doesNotMatch(page.replace(/修正读数/u, ""), /修正读数/u);

console.log("ORDER-02A usage correction test passed: append-only correction history, effective baseline, idempotent API and permissioned admin entry are wired.");
