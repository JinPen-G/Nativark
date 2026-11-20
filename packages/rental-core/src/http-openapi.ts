/** Rental HTTP 文档贡献与旧组合的同源出口。只组织原操作和 schema。
 * 宿主负责精确旧路由许可、实际挂载及当前功能可用性，原 Guard/应用负责执行授权。 */
import type { CoreOpenApiContribution } from "@rental-os/core-contracts";
import { buildPaths, type ContractOperation } from "./http-openapi-contract";
import { RENTAL_HTTP_OPERATIONS } from "./http-openapi-operations";
import { RENTAL_HTTP_COMPONENT_SCHEMAS } from "./http-openapi-schemas";

export * from "./http-openapi-contract";
export * from "./http-openapi-category-governance-schemas";
export * from "./http-openapi-enterprise-schemas";
export * from "./http-openapi-enterprise-workflow-schemas";
export * from "./http-openapi-enterprise-exchange-schemas";
export * from "./http-openapi-enterprise-extension-schemas";
export * from "./http-openapi-enterprise-transfer-decision.schemas";
export * from "./http-openapi-enterprise-finance-schemas";
export * from "./http-openapi-enterprise-order-delegation-schemas";
export * from "./http-openapi-rental-exchange-inspection-preparation.schemas";
export { aiLeafToOpenApi30 } from "./http-openapi-json-schema";
export { RENTAL_HTTP_OPERATIONS, RENTAL_HTTP_COMPONENT_SCHEMAS };

export interface RentalHttpDocumentationGap {
  method: "GET" | "POST";
  path: string;
  source: string;
  kind: "missing-operation" | "unmounted-legacy-operation";
  availability?: "disabled-ai-host-unavailable";
}

/** 路由缺口沿原处理器核对，已补齐操作从清单移除。公共种类保留供宿主核对后续缺项。 */
export const RENTAL_HTTP_DOCUMENTATION_GAPS: readonly RentalHttpDocumentationGap[] = [
  {
    method: "GET", path: "/api/platform/tenant-bootstrap/category-options",
    source: "getRentalCategoryOpeningOptions", kind: "unmounted-legacy-operation"
  }
];

/** 独立贡献保留原无 AI 宿主的绑定限制，旧组合沿已装配权威描述原成功投影。 */
export const RENTAL_HTTP_OPERATION_AVAILABILITY = [
  {
    method: "POST", path: "/api/staff/v1/uploads/{fileAssetId}/inspection-binding",
    source: "StaffUploadsController.bindInspectionEvidence", availability: "disabled-ai-host-unavailable",
    reason: "检查草稿证据绑定未启用"
  }
] as const;

const unavailableHostRoutes = new Map<string, (typeof RENTAL_HTTP_OPERATION_AVAILABILITY)[number]>(RENTAL_HTTP_OPERATION_AVAILABILITY
  .map(item => [`${item.method} ${item.path}`, item] as const));

const unmountedLegacyRoutes = new Set<string>(RENTAL_HTTP_DOCUMENTATION_GAPS
  .filter(gap => gap.kind === "unmounted-legacy-operation")
  .map(gap => `${gap.method} ${gap.path}`));

function unspecifiedSchema(schema: ContractOperation["responseSchema"]): boolean {
  return schema === "GenericObject" || schema !== undefined && typeof schema === "object"
    && schema.type === "object" && schema.additionalProperties === true && !schema.properties;
}

/** 原宽泛合同保持可读，同时列出需按 DTO/响应投影继续补齐的字段。 */
export const RENTAL_HTTP_SCHEMA_GAPS = RENTAL_HTTP_OPERATIONS.flatMap(operation => {
  const fields: string[] = [];
  if (unspecifiedSchema(operation.requestSchema)) fields.push("requestSchema");
  if (operation.responseSchema === undefined || unspecifiedSchema(operation.responseSchema)) fields.push("responseSchema");
  return fields.length ? [{ operationId: operation.operationId, method: operation.method,
    path: operation.path, fields }] : [];
});

function namespaceReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(namespaceReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/components/schemas/")) {
      const name = child.slice("#/components/schemas/".length);
      if (!Object.hasOwn(RENTAL_HTTP_COMPONENT_SCHEMAS, name)) {
        throw new Error(`Rental OpenAPI 缺少原 schema ${name}`);
      }
      return [key, `#/components/schemas/rental.${name}`];
    }
    // 示例、默认值和扩展字段是业务值，不能当作 schema 引用改写。
    return [key, key === "example" || key === "default" || key === "enum" || key.startsWith("x-")
      ? structuredClone(child) : namespaceReferences(child)];
  }));
}

/** 返回可供 composeCoreOpenApi 检查/组合的独立片段。
 * 旧组合继续消费原 operationId/schema 名称，独立贡献使用 rental. 命名空间。
 * 未挂原路径保留在旧合同及缺口清单，独立片段仅包含原宿主实际挂载的已描述操作。 */
export function createRentalOpenApi(): CoreOpenApiContribution {
  const operations = RENTAL_HTTP_OPERATIONS.filter(operation =>
    !unmountedLegacyRoutes.has(`${operation.method.toUpperCase()} ${operation.path}`));
  const legacyPaths = buildPaths(operations.map(operation => {
    const unavailable = unavailableHostRoutes.get(`${operation.method.toUpperCase()} ${operation.path}`);
    return unavailable ? { ...operation, serviceUnavailableReason: unavailable.reason } : operation;
  }));
  const paths: CoreOpenApiContribution["paths"] = {};
  for (const [path, methods] of Object.entries(legacyPaths)) {
    const item: Record<string, unknown> = {};
    for (const [method, operation] of Object.entries(methods)) {
      const original = operation as Record<string, unknown>;
      const contribution = namespaceReferences(original) as Record<string, unknown>;
      contribution.operationId = `rental.${original.operationId}`;
      contribution["x-legacyOperationId"] = original.operationId;
      const unavailable = unavailableHostRoutes.get(`${method.toUpperCase()} ${path}`);
      if (unavailable) contribution["x-availability"] = unavailable.availability;
      const gap = RENTAL_HTTP_SCHEMA_GAPS.find(value => value.operationId === original.operationId);
      if (gap) {
        contribution["x-schemaStatus"] = "incomplete";
        contribution["x-schemaGaps"] = [...gap.fields];
      }
      item[method] = contribution;
    }
    paths[path] = item;
  }
  const schemas = Object.fromEntries(Object.entries(RENTAL_HTTP_COMPONENT_SCHEMAS)
    .map(([name, schema]) => [`rental.${name}`, namespaceReferences(schema) as Record<string, unknown>]));
  return { paths, schemas };
}
