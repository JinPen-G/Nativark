/** 官方来源 HTTP 字段沿原合同与 DTO。来源版本摘要只投影计数，详情保留原日期与快照字段。 */
const sourceProperties = {
  id: { type: "string" }, region: { type: "string", enum: ["CN"] }, name: { type: "string" }, url: { type: "string" },
  notes: { type: "string" }, isActive: { type: "boolean" },
  createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }
};
const dayProperties = {
  date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  dayType: { type: "string", enum: ["statutory_holiday", "makeup_workday"] }, name: { type: "string" },
  pricingMultiplier: { type: "number", minimum: 0, maximum: 10 }, closed: { type: "boolean" }
};
const historicalDayProperties = {
  ...dayProperties,
  dayType: { type: "string", enum: ["workday", "weekend", "statutory_holiday", "makeup_workday", "tenant_special"] },
  pricingMultiplier: { type: "number" }
};
const versionProperties = {
  id: { type: "string" }, sourceId: { type: "string" }, sourceName: { type: "string" }, sourceUrl: { type: "string" },
  region: { type: "string", enum: ["CN"] }, year: { type: "integer" }, version: { type: "string" },
  sequence: { type: "integer", minimum: 1 }, publishedAt: { type: "string", format: "date-time" },
  importedAt: { type: "string", format: "date-time" }, importedBy: { type: "string" }
};
const sourceRequired = ["id", "region", "name", "url", "isActive", "createdAt", "updatedAt"];
const versionRequired = ["id", "sourceId", "sourceName", "sourceUrl", "region", "year", "version", "sequence", "publishedAt", "importedAt"];

export const OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS = {
  year: { type: "integer" }
} as const;

export const OFFICIAL_CALENDAR_SCHEMAS = {
  "OfficialCalendar.SaveSource": { type: "object", required: ["region", "name", "url"], properties: {
    id: { type: "string", minLength: 1 }, region: sourceProperties.region, name: { type: "string", maxLength: 191, pattern: "\\S" },
    url: { type: "string", format: "uri", maxLength: 191, pattern: "^https://" }, notes: sourceProperties.notes, isActive: sourceProperties.isActive
  } },
  "OfficialCalendar.RegisterVersion": { type: "object", required: ["year", "publishedAt", "days"], properties: {
    year: { type: "integer", minimum: 2000, maximum: 2999 }, publishedAt: versionProperties.publishedAt,
    days: { type: "array", minItems: 1, items: { type: "object", required: ["date", "dayType", "name"], properties: dayProperties } }
  } },
  "OfficialCalendar.Source": { type: "object", required: sourceRequired, properties: sourceProperties },
  "OfficialCalendar.Sources": { type: "array", items: { $ref: "#/components/schemas/OfficialCalendar.Source" } },
  "OfficialCalendar.Version": { type: "object", required: [...versionRequired, "days"], properties: {
    ...versionProperties, days: { type: "array", items: { type: "object", required: ["date", "dayType", "name"], properties: historicalDayProperties } }
  } },
  "OfficialCalendar.VersionSummary": { type: "object", required: [...versionRequired, "dayCount", "sourceActive"], properties: {
    ...versionProperties, dayCount: { type: "integer", minimum: 0 }, sourceActive: { type: "boolean" }
  } },
  "OfficialCalendar.Versions": { type: "array", items: { $ref: "#/components/schemas/OfficialCalendar.VersionSummary" } }
} as const;
