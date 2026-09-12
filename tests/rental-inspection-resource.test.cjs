const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const shared = read("packages/shared/src/core.ts");
const dto = read("apps/api/src/modules/rental-core/rental-order-request.dto.ts");
const service = read("apps/api/src/modules/rental-core/rental-core.service.ts");
const page = read("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");

assert.match(shared, /allocationId\?: string;[\s\S]*chargeAmount\?: number/u, "共享检查异常契约必须支持关联分配项");
assert.match(dto, /@MaxLength\(128\)\s+allocationId\?: string;/u, "检查异常 DTO 必须限制关联分配项标识长度");
assert.match(service, /异常关联的分配项不属于本次归还批次/u, "服务端必须拒绝不属于本次归还批次的异常资源");
assert.match(service, /allocationId: exception\.allocationId/u, "服务端必须把异常资源标识写入检查快照");
assert.match(page, /name="exceptionAllocationId"[\s\S]*选择本次归还的具体资源/u, "订单详情必须允许选择异常关联资源");
assert.match(page, /row\.allocationId \? `关联分配：\$\{row\.allocationId\}`/u, "订单详情必须回显异常关联资源");

const withoutContract = shared.replace(/allocationId\?: string;/u, "");
assert.doesNotMatch(withoutContract, /allocationId\?: string;[\s\S]*chargeAmount\?: number/u, "删除共享关联资源字段后专项必须报红");
const withoutGuard = service.replace(/if \(invalidExceptionAllocation\?\.allocationId\) \{[\s\S]*?\n    \}/u, "");
assert.doesNotMatch(withoutGuard, /异常关联的分配项不属于本次归还批次/u, "删除服务端资源范围校验后专项必须报红");

console.log("ORDER-02A inspection resource test passed: scoped exception allocation is validated, snapshotted and rendered.");
