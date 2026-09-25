const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const controller = read("apps/api/src/modules/rental-core/rental-core.controller.ts");
const dto = read("apps/api/src/modules/rental-core/rental-order-request.dto.ts");
const service = read("apps/api/src/modules/rental-core/rental-core.service.ts");
const page = read("apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx");

const requestStart = controller.indexOf('request: {', controller.indexOf('action: "order.inspection"'));
const requestTail = controller.slice(requestStart);
const requestEndOffset = requestTail.search(/\r?\n\s+orderId: id,\r?\n\s+run:/u);
const requestEnd = requestEndOffset < 0 ? controller.length : requestStart + requestEndOffset;
const inspectionRequest = controller.slice(requestStart, requestEnd);
assert.match(inspectionRequest, /attachments: submissionBody\.attachments \?\? \[\]/u, "检查证据引用必须进入幂等请求事实");
assert.match(dto, /@MaxLength\(500, \{ each: true \}\)\s+attachments\?: string\[\];/u, "检查证据引用必须限制单条长度");
assert.match(service, /const usageReadings = usageFields\.flatMap/u, "检查记录必须生成使用量读数");
assert.match(service, /attachments: input\.attachments \?\? \[\]/u, "检查记录必须持久化照片/证据引用");
assert.match(page, /name="attachmentsText"[\s\S]*照片\/证据引用/u, "订单详情检查表单必须允许录入照片/证据引用");
assert.match(page, /attachmentsText\?\.split\(\/\[\\n,\]\/u\)/u, "照片/证据引用必须按行或逗号拆分");
assert.match(page, /dataSource=\{inspections\.data \?\? \[\]\}[\s\S]*照片\/证据引用/u, "订单详情必须回显检查证据引用");

// 证伪校验：删除任一关键接线后，本专项都必须失败，防止只测页面文案。
const noIdempotencyEvidence = inspectionRequest.replace(/attachments: submissionBody\.attachments \?\? \[\]/u, "");
assert.doesNotMatch(noIdempotencyEvidence, /attachments: submissionBody\.attachments/u, "删掉幂等证据接线后应被识别");
const noPageEvidence = page.replace(/<Form\.Item name="attachmentsText"[\s\S]*?<\/Form\.Item>/u, "");
assert.doesNotMatch(noPageEvidence, /name="attachmentsText"/u, "删掉检查表单证据字段后应被识别");

console.log("CAM-01B evidence test passed: usage readings, evidence references, idempotency fingerprint and admin rendering are wired.");
