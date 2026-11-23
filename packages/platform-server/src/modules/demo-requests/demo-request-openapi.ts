/** 原演示预约 DTO 和 SaaS 列表字段资料，宿主合入公共 OpenAPI。 */
const text = { type: "string" };
const contactType = { type: "string", enum: ["phone", "email", "wechat"] };
const language = { type: "string", enum: ["zh", "en"] };
const row = { id: text, name: text, contactType, contactValue: text, company: text, message: text,
  language, createdAt: { type: "string", format: "date-time" } };
export const DEMO_REQUEST_QUERY_SCHEMAS = {
  "listWebsiteDemoRequests.keyword": { type: "string", maxLength: 120 },
  "listWebsiteDemoRequests.page": { type: "integer", minimum: 1, maximum: 100000, default: 1 },
  "listWebsiteDemoRequests.pageSize": { type: "integer", minimum: 1, maximum: 100, default: 20 }
} as const;
export const DEMO_REQUEST_SCHEMAS = {
  "DemoRequest.Create": { type: "object", additionalProperties: false, required: ["requestKey", "name", "contactType", "contactValue", "language"],
    properties: { requestKey: { type: "string", format: "uuid" }, name: { type: "string", minLength: 1, maxLength: 80 },
      contactType, contactValue: { type: "string", minLength: 1, maxLength: 160, description: "Phone with 7–20 digits, valid email, or 3–80 character WeChat ID (letters, digits, underscore, hyphen)." },
      company: { type: "string", maxLength: 120 }, message: { type: "string", maxLength: 1000 }, language } },
  "DemoRequest.Receipt": { type: "object", additionalProperties: false, required: ["received"], properties: { received: { type: "boolean", enum: [true] } } },
  "DemoRequest.Row": { type: "object", additionalProperties: false, required: Object.keys(row), properties: row },
  "DemoRequest.Page": { type: "object", additionalProperties: false, required: ["items", "total", "page", "pageSize"], properties: {
    items: { type: "array", items: { $ref: "#/components/schemas/DemoRequest.Row" } },
    total: { type: "integer" }, page: { type: "integer", minimum: 1, maximum: 100000 },
    pageSize: { type: "integer", minimum: 1, maximum: 100 } } }
} as const;
