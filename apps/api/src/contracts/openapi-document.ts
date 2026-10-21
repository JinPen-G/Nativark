import { AI_NATIVE_COMPONENT_SCHEMAS } from "./ai-native-schemas";
import { AI_TASK_DRAFT_COMPONENT_SCHEMAS } from "./ai-task-draft-schemas";
import { AI_LEAF_COMPONENT_SCHEMAS } from "./ai-leaf-components";
import { AI_CLIENT_ENTRY_HTTP_DRAFT, AI_SCENE_MODEL_HTTP_DRAFT, AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT } from "@rental-os/shared";
import { AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT } from "@rental-os/shared";
import { AI_TEXT_CAPABILITY_HTTP_DRAFT } from "@rental-os/shared";
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT } from "@rental-os/shared";
import { AI_MODEL_SETTINGS_HTTP_DRAFT, AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT } from '@rental-os/shared';
import { AI_TASK_CENTER_HTTP_DRAFT, AI_TASK_CENTER_ENTRY_PERMISSIONS } from '@rental-os/shared';
import { AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT } from '@rental-os/shared';
import { AI_MEMORY_MANAGEMENT_HTTP_DRAFT, AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT } from '@rental-os/shared';
import { AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT } from '@rental-os/shared';
import { AI_SCENE_ORDER_READ_HTTP_DRAFT, AI_SCENE_PLAN_POLICY_HTTP_DRAFT, AI_SCENE_REQUEST_HTTP_DRAFT } from "@rental-os/shared";
import { AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT, AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT } from '@rental-os/shared';
import { AI_CLIENT_TASK_POLICY_HTTP_DRAFT } from '@rental-os/shared';

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface SchemaObject {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: (string | number | boolean | null)[];
  exclusiveMinimum?: boolean;
  exclusiveMaximum?: boolean;
  not?: SchemaObject;
  allOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  writeOnly?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: SchemaObject;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: SchemaObject[];
  properties?: Record<string, SchemaObject>;
  minProperties?: number;
  maxProperties?: number;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  nullable?: boolean;
}

interface ParameterObject {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  schema: SchemaObject;
}

export interface ContractOperation {
  method: HttpMethod;
  path: string;
  tag: string;
  operationId: string;
  summary: string;
  permissions: string[];
  authRequired?: boolean;
  requestSchema?: string | SchemaObject;
  responseSchema?: string | SchemaObject;
  parameters?: ParameterObject[];
  rawResponseContentType?: string;
  rateLimited?: boolean;
  serviceUnavailableReason?: string;
}

const stringSchema: SchemaObject = { type: "string" };
const numberSchema: SchemaObject = { type: "number" };
const booleanSchema: SchemaObject = { type: "boolean" };
const objectSchema: SchemaObject = { type: "object", additionalProperties: true };

function ref(name: string): SchemaObject {
  return { $ref: `#/components/schemas/${name}` };
}

function arrayOf(schema: string | SchemaObject): SchemaObject {
  return {
    type: "array",
    items: typeof schema === "string" ? ref(schema) : schema
  };
}

function objectOf(
  properties: Record<string, SchemaObject>,
  required: string[] = [],
  additionalProperties: boolean | SchemaObject = true
): SchemaObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties
  };
}

function queryParam(name: string, schema: SchemaObject = stringSchema): ParameterObject {
  return {
    name,
    in: "query",
    required: false,
    schema
  };
}

function toSchema(schema?: string | SchemaObject): SchemaObject {
  if (!schema) {
    return objectSchema;
  }
  return typeof schema === "string" ? ref(schema) : schema;
}

function apiResult(schema?: string | SchemaObject): SchemaObject {
  return objectOf(
    {
      data: toSchema(schema),
      requestId: stringSchema
    },
    ["data", "requestId"]
  );
}

function pathParameters(path: string, parameters: ParameterObject[] = []) {
  const names = Array.from(path.matchAll(/\{([^}]+)\}/g)).map((match) => match[1]);
  const existing = new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`));
  const inferred = names
    .filter((name) => !existing.has(`path:${name}`))
    .map((name) => ({
      name,
      in: "path" as const,
      required: true,
      schema: stringSchema
    }));

  return [...inferred, ...parameters];
}

function operation(config: ContractOperation) {
  const parameters = pathParameters(config.path, config.parameters);
  const securityRequired = config.authRequired || config.permissions.length > 0;
  const responseContentType = config.rawResponseContentType ?? "application/json";
  const responseSchema = config.rawResponseContentType || config.path === "/api/openapi.json"
    ? toSchema(config.responseSchema)
    : apiResult(config.responseSchema);
  const item: Record<string, unknown> = {
    tags: [config.tag],
    operationId: config.operationId,
    summary: config.summary,
    parameters,
    security: securityRequired ? [{ bearerAuth: [] }] : [],
    "x-requiredPermissions": config.permissions,
    "x-permissionMode": config.permissions.length > 0 ? "any" : "none",
    responses: {
      "200": {
        description: "Success",
        content: {
          [responseContentType]: { schema: responseSchema }
        }
      }
    }
  };

  if (config.requestSchema) {
    item.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: toSchema(config.requestSchema)
        }
      }
    };
  }

  if (config.serviceUnavailableReason) {
    // 未激活的客户端契约不能在文档中伪装成已经可成功创建真实支付。
    item.responses = { "503": { description: config.serviceUnavailableReason, content: { "application/json": { schema: objectSchema } } } };
  }

  if (config.rateLimited) {
    (item.responses as Record<string, unknown>)["429"] = {
      description: "Client request rate limit exceeded",
      content: { "application/json": { schema: objectSchema } }
    };
  }

  return item;
}

function buildPaths(operations: ContractOperation[]) {
  const paths: Record<string, Record<HttpMethod, unknown>> = {};
  for (const item of operations) {
    paths[item.path] ??= {} as Record<HttpMethod, unknown>;
    paths[item.path][item.method] = operation(item);
  }
  return paths;
}

export const OPENAPI_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  // AIN-02/S01：只公开草案结构，无对应运行路由；不得据此认为工具已可执行。
  ...AI_NATIVE_COMPONENT_SCHEMAS,
  ...AI_TASK_DRAFT_COMPONENT_SCHEMAS,
  ...AI_LEAF_COMPONENT_SCHEMAS,
  OpenApiDocument: objectSchema,
  GenericObject: objectSchema,
  RentalOperationLockRequest: {
    oneOf: [
      { ...objectOf({ action: { type: "string", enum: ["acquire"] }, token: stringSchema, reason: stringSchema }, ["action"], false) },
      { ...objectOf({ action: { type: "string", enum: ["release"] }, token: stringSchema, reason: stringSchema }, ["action"], false) },
      { ...objectOf({ action: { type: "string", enum: ["force-release"] }, token: stringSchema, reason: { type: "string", minLength: 3, maxLength: 500 } }, ["action", "reason"], false) }
    ]
  },
  CreateRentalOrderInternalNoteRequest: objectOf(
    { content: { type: "string", minLength: 1, maxLength: 1000 } },
    ["content"],
    false
  ),
  RentalOrderInternalNote: objectOf(
    {
      id: stringSchema,
      content: stringSchema,
      operatorName: stringSchema,
      operatorId: stringSchema,
      createdAt: { type: "string", format: "date-time" }
    },
    ["id", "content", "operatorName", "createdAt"],
    false
  ),
  CustomerMembershipBenefitScope: {
    oneOf: [
      { ...objectOf({ type: { type: "string", enum: ["tenant"] } }, ["type"]), additionalProperties: false },
      { ...objectOf({ type: { type: "string", enum: ["workspaces"] }, workspaceIds: { type: "array", items: stringSchema, minItems: 1 } }, ["type", "workspaceIds"]), additionalProperties: false },
      { ...objectOf({ type: { type: "string", enum: ["categories"] }, categoryCodes: { type: "array", items: { type: "string", enum: ["camera", "camping", "vehicle", "construction"] }, minItems: 1 } }, ["type", "categoryCodes"]), additionalProperties: false }
    ]
  },
  CustomerMembershipBenefit: objectOf({
    type: { type: "string", enum: ["rental_discount", "deposit_reduction", "preauth_reduction", "service_benefit", "priority_reservation", "quote_validity_extension"] },
    calculation: { type: "string", enum: ["percentage", "amount", "quota", "priority"] },
    value: numberSchema,
    maximum: numberSchema,
    applicableServiceIds: arrayOf(stringSchema),
    stackable: booleanSchema,
    conditions: objectSchema,
    scope: ref("CustomerMembershipBenefitScope")
  }, ["type", "calculation", "value"]),
  HealthStatus: objectOf(
    {
      service: stringSchema,
      status: stringSchema,
      time: { type: "string", format: "date-time" }
    },
    ["service", "status", "time"]
  ),
  LoginRequest: objectOf(
    {
      tenantCode: stringSchema,
      account: stringSchema,
      password: { type: "string", format: "password" }
    },
    ["tenantCode", "account", "password"]
  ),
  ResetLocalDemoPasswordRequest: objectOf(
    { password: { type: "string", format: "password" } },
    ["password"]
  ),
  ResetLocalDemoPasswordResult: objectOf(
    { reset: { type: "boolean" }, accounts: arrayOf(stringSchema) },
    ["reset", "accounts"]
  ),
  LoginResponse: objectOf(
    {
      accessToken: stringSchema,
      refreshToken: stringSchema,
      expiresIn: numberSchema,
      tenant: ref("TenantContext"),
      user: ref("AuthUser"),
      needsTenantOnboarding: booleanSchema
    },
    ["accessToken", "refreshToken", "expiresIn", "tenant", "user"]
  ),
  RefreshSessionRequest: objectOf(
    { refreshToken: stringSchema },
    ["refreshToken"]
  ),
  SwitchWorkspaceRequest: objectOf(
    { workspaceId: stringSchema },
    ["workspaceId"]
  ),
  ChangePasswordRequest: objectOf(
    {
      currentPassword: { type: "string", format: "password" },
      newPassword: { type: "string", format: "password" }
    },
    ["currentPassword", "newPassword"]
  ),
  TenantContext: objectOf(
    {
      tenantId: stringSchema,
      tenantCode: stringSchema,
      tenantName: stringSchema,
      tenantStatus: stringSchema,
      brandName: stringSchema,
      brandLogoUrl: stringSchema,
      faviconUrl: stringSchema,
      themeColor: stringSchema,
      adminCornerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminContainerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminButtonRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminInputRadius: { type: "integer", minimum: 8, maximum: 999 },
      categoryCode: stringSchema,
      categoryName: stringSchema,
      capabilities: arrayOf(stringSchema)
    },
    ["tenantId", "tenantCode", "tenantName", "tenantStatus"]
  ),
  AuthUser: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      account: stringSchema,
      displayName: stringSchema,
      roleNames: arrayOf(stringSchema),
      roleIds: arrayOf(stringSchema),
      scope: stringSchema,
      dataScope: stringSchema,
      locationScope: objectOf({ mode: stringSchema, locationIds: arrayOf(stringSchema) }, ["mode", "locationIds"]),
      organizationId: stringSchema,
      organizationName: stringSchema,
      isPlatformAdmin: booleanSchema,
      isSaasAdmin: booleanSchema,
      mustChangePassword: booleanSchema,
      permissions: arrayOf(stringSchema),
      tenantMembership: objectOf({ permissions: arrayOf(stringSchema), dataScope: stringSchema, isTenantAdmin: booleanSchema }, ["permissions", "dataScope", "isTenantAdmin"])
    },
    ["id", "tenantId", "account", "displayName", "roleNames", "scope"]
  ),
  MiniProgramChannelSummary: objectOf(
    {
      configured: booleanSchema, appId: stringSchema, secretConfigured: booleanSchema, enabled: booleanSchema, revision: numberSchema,
      lastTestStatus: { type: "string", enum: ["not_tested", "passed", "failed"] }, lastTestAt: { type: "string", format: "date-time" }, lastTestError: stringSchema,
      identityCount: numberSchema, updatedAt: { type: "string", format: "date-time" }
    },
    ["configured", "secretConfigured", "enabled", "revision", "lastTestStatus", "identityCount"],
    false
  ),
  SaveMiniProgramChannelRequest: objectOf(
    { appId: stringSchema, appSecret: stringSchema, enabled: booleanSchema },
    ["appId", "enabled"]
  ),
  MiniProgramChannelTestResult: objectOf({ ok: booleanSchema, message: stringSchema, testedAt: { type: "string", format: "date-time" } }, ["ok", "message", "testedAt"]),
  ClientChannelAgreementConfig: objectOf({ name: stringSchema, version: stringSchema, url: stringSchema, body: stringSchema }, ["name", "version"], false),
  ClientChannelFaqItem: objectOf({ question: stringSchema, answer: stringSchema }, ["question", "answer"], false),
  ClientChannelWorkspaceOption: objectOf({ id: stringSchema, code: stringSchema, name: stringSchema, categoryCode: stringSchema, status: stringSchema }, ["id", "code", "name", "categoryCode", "status"], false),
  TenantAppearanceProfile: objectOf(
    {
      brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, themeColor: stringSchema,
      adminCornerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminContainerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminButtonRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminInputRadius: { type: "integer", minimum: 8, maximum: 999 },
      revision: numberSchema, updatedAt: { type: "string", format: "date-time" }
    },
    ["revision"],
    false
  ),
  SaveTenantAppearanceRequest: objectOf(
    {
      expectedRevision: numberSchema,
      brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, themeColor: stringSchema,
      adminCornerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminContainerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminButtonRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminInputRadius: { type: "integer", minimum: 8, maximum: 999 }
    },
    [],
    false
  ),
  // 账户级外观（跟随登录账户的管理后台主题色，与租户品牌色相互独立）。
  AccountAppearanceProfile: objectOf({ themeColor: stringSchema, updatedAt: { type: "string", format: "date-time" } }, [], false),
  SaveAccountAppearanceRequest: objectOf({ themeColor: stringSchema }, [], false),
  AdminLoginBranding: objectOf({
    backgroundImageUrl: { type: "string", maxLength: 512 },
    title: { type: "string", maxLength: 80 },
    description: { type: "string", maxLength: 300 },
    highlights: { type: "array", maxItems: 3, items: objectOf({ title: { type: "string", maxLength: 24 }, description: { type: "string", maxLength: 80 } }, [], false) },
    footerText: { type: "string", maxLength: 160 }
  }, [], false),
  ClientChannelProfileSummary: objectOf(
    {
      configured: booleanSchema, revision: numberSchema,
      brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, customerServicePhone: stringSchema, customerServiceHours: stringSchema,
      userAgreement: ref("ClientChannelAgreementConfig"), privacyPolicy: ref("ClientChannelAgreementConfig"),
      helpIntro: stringSchema, helpFaq: arrayOf("ClientChannelFaqItem"), bannerTitle: stringSchema, bannerSubtitle: stringSchema, themeColor: stringSchema,
      adminLogin: ref("AdminLoginBranding"),
      adminCornerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminContainerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminButtonRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminInputRadius: { type: "integer", minimum: 8, maximum: 999 },
      smsLoginEnabled: booleanSchema, passwordLoginEnabled: booleanSchema,
      publishedWorkspaceIds: arrayOf(stringSchema), defaultWorkspaceId: stringSchema,
      workspaces: arrayOf("ClientChannelWorkspaceOption"),
      readiness: objectOf({ ready: booleanSchema, missing: arrayOf(stringSchema) }, ["ready", "missing"], false),
      updatedAt: { type: "string", format: "date-time" }
    },
    ["configured", "revision", "adminCornerRadius", "smsLoginEnabled", "passwordLoginEnabled", "publishedWorkspaceIds", "workspaces", "readiness"],
    false
  ),
  SaveClientChannelProfileRequest: objectOf(
    {
      expectedRevision: numberSchema, brandName: stringSchema, brandLogoUrl: stringSchema, faviconUrl: stringSchema, customerServicePhone: stringSchema, customerServiceHours: stringSchema,
      userAgreement: ref("ClientChannelAgreementConfig"), privacyPolicy: ref("ClientChannelAgreementConfig"),
      helpIntro: stringSchema, helpFaq: arrayOf("ClientChannelFaqItem"), bannerTitle: stringSchema, bannerSubtitle: stringSchema, themeColor: stringSchema,
      adminLogin: ref("AdminLoginBranding"),
      adminCornerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminContainerRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminButtonRadius: { type: "integer", minimum: 8, maximum: 999 },
      adminInputRadius: { type: "integer", minimum: 8, maximum: 999 },
      smsLoginEnabled: booleanSchema, passwordLoginEnabled: booleanSchema, publishedWorkspaceIds: arrayOf(stringSchema), defaultWorkspaceId: stringSchema
    },
    ["smsLoginEnabled", "passwordLoginEnabled", "publishedWorkspaceIds"]
  ),
  WebsiteChannelProfileSummary: objectOf(
    {
      configured: booleanSchema, revision: numberSchema, enabled: booleanSchema,
      slogan: stringSchema, heroTitle: stringSchema, heroDescription: stringSchema, heroImageUrl: stringSchema,
      secondaryColor: stringSchema, footerText: stringSchema, contactAddress: stringSchema,
      ctaTitle: stringSchema, ctaDescription: stringSchema,
      seoTitle: stringSchema, seoDescription: stringSchema, seoKeywords: stringSchema,
      showPoweredBy: booleanSchema, customDomain: stringSchema,
      categoryImages: arrayOf(objectOf({ code: stringSchema, imageUrl: stringSchema }, ["code", "imageUrl"], false)),
      advantages: arrayOf(objectOf({ icon: stringSchema, title: stringSchema, description: stringSchema }, ["title"], false)),
      steps: arrayOf(objectOf({ title: stringSchema, description: stringSchema }, ["title"], false)),
      testimonials: arrayOf(objectOf({ name: stringSchema, context: stringSchema, text: stringSchema }, ["name", "text"], false)),
      categories: arrayOf(objectOf({ code: stringSchema, name: stringSchema }, ["code", "name"], false)),
      readiness: objectOf({ ready: booleanSchema, missing: arrayOf(stringSchema) }, ["ready", "missing"], false),
      updatedAt: { type: "string", format: "date-time" }
    },
    ["configured", "revision", "enabled", "showPoweredBy", "readiness"],
    false
  ),
  SaveWebsiteChannelProfileRequest: objectOf(
    {
      expectedRevision: numberSchema, enabled: booleanSchema,
      slogan: stringSchema, heroTitle: stringSchema, heroDescription: stringSchema, heroImageUrl: stringSchema,
      secondaryColor: stringSchema, footerText: stringSchema, contactAddress: stringSchema,
      ctaTitle: stringSchema, ctaDescription: stringSchema,
      seoTitle: stringSchema, seoDescription: stringSchema, seoKeywords: stringSchema, showPoweredBy: booleanSchema, customDomain: stringSchema,
      categoryImages: arrayOf(objectOf({ code: stringSchema, imageUrl: stringSchema }, ["code", "imageUrl"], false)),
      advantages: arrayOf(objectOf({ icon: stringSchema, title: stringSchema, description: stringSchema }, ["title"], false)),
      steps: arrayOf(objectOf({ title: stringSchema, description: stringSchema }, ["title"], false)),
      testimonials: arrayOf(objectOf({ name: stringSchema, context: stringSchema, text: stringSchema }, ["name", "text"], false))
    },
    ["enabled", "showPoweredBy"]
  ),
  TenantIntegrationCatalogResponse: objectOf(
    { providers: arrayOf(objectSchema), configs: arrayOf(objectSchema) },
    ["providers", "configs"]
  ),
  SaveTenantIntegrationRequest: objectOf(
    { enabled: booleanSchema, isDefault: booleanSchema, settings: objectSchema, credentials: objectSchema },
    ["enabled", "isDefault", "settings"]
  ),
  TenantIntegrationTestResult: objectOf(
    {
      capability: stringSchema,
      provider: stringSchema,
      ok: booleanSchema,
      mode: stringSchema,
      message: stringSchema,
      checkedAt: { type: "string", format: "date-time" },
      missingFields: arrayOf(stringSchema)
    },
    ["capability", "provider", "ok", "mode", "message", "checkedAt", "missingFields"]
  ),
  CreatePaymentRefundRequest: objectOf(
    { amount: numberSchema, reason: stringSchema, idempotencyKey: stringSchema },
    ["amount", "reason", "idempotencyKey"]
  ),
  ReviewRentalInspectionExceptionRequest: objectOf(
    {
      decision: { type: "string", enum: ["approved", "rejected"] },
      approvedChargeAmount: { type: "number", minimum: 0 },
      waiverDecision: { type: "string", enum: ["covered", "excluded"], description: "Required for a positive approved charge when the order has damage waiver services; review frozen terms and record the basis in reason." },
      incidentAt: { type: "string", format: "date-time", description: "Verified incident time, required with incidentBasis for positive damage assessments on orders with waiver services. Must not be inferred from inspection time." },
      incidentBasis: { type: "string", minLength: 1, maxLength: 1000 },
      waiverOccurrenceId: { type: "string", maxLength: 200, description: "Optional explicit occurrence from frozen order services." },
      liability: { type: "string", enum: ["customer", "normal_wear", "lessor", "third_party", "undetermined"], description: "A positive customer charge requires an explicit customer liability decision supported by reason." },
      reason: { type: "string", minLength: 1 }
    },
    ["decision", "reason"]
  ),
  PaymentRefundResponse: objectOf(
    {
      refundId: stringSchema,
      paymentIntentId: stringSchema,
      orderId: stringSchema,
      provider: stringSchema,
      method: stringSchema,
      amount: numberSchema,
      currency: stringSchema,
      merchantRefundNo: stringSchema,
      status: stringSchema,
      externalRefundId: stringSchema,
      externalStatus: stringSchema,
      reason: stringSchema,
      failureReason: stringSchema,
      acceptedAt: { type: "string", format: "date-time" },
      succeededAt: { type: "string", format: "date-time" },
      fundedAt: { type: "string", format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    },
    ["refundId", "paymentIntentId", "orderId", "provider", "method", "amount", "currency", "merchantRefundNo", "status", "reason", "createdAt", "updatedAt"]
  ),
  PaymentReconciliationSummary: objectOf(
    {
      scanned: numberSchema,
      processed: numberSchema,
      paid: numberSchema,
      closed: numberSchema,
      refunded: numberSchema,
      pending: numberSchema,
      failed: numberSchema,
      results: arrayOf(objectOf({
        kind: stringSchema,
        id: stringSchema,
        orderId: stringSchema,
        previousStatus: stringSchema,
        status: stringSchema,
        error: stringSchema
      }, ["kind", "id", "orderId", "previousStatus", "status"]))
    },
    ["scanned", "processed", "paid", "closed", "refunded", "pending", "failed", "results"]
  ),
  ImportPaymentStatementRequest: objectOf(
    { provider: stringSchema, file: { type: "string", format: "binary" } },
    ["provider", "file"]
  ),
  ReviewPaymentStatementLineRequest: objectOf(
    { decision: stringSchema, reason: stringSchema },
    ["decision", "reason"]
  ),
  PaymentStatementBatchSummary: objectOf(
    {
      id: stringSchema,
      workspaceId: stringSchema,
      provider: stringSchema,
      fileName: stringSchema,
      fileSha256: stringSchema,
      status: stringSchema,
      totalRows: numberSchema,
      matchedRows: numberSchema,
      differenceRows: numberSchema,
      acknowledgedRows: numberSchema,
      importedBy: stringSchema,
      importedAt: { type: "string", format: "date-time" }
    },
    ["id", "workspaceId", "provider", "fileName", "fileSha256", "status", "totalRows", "matchedRows", "differenceRows", "acknowledgedRows", "importedAt"]
  ),
  PaymentStatementLineSummary: objectOf(
    {
      id: stringSchema,
      batchId: stringSchema,
      rowNumber: numberSchema,
      kind: stringSchema,
      merchantOrderNo: stringSchema,
      merchantRefundNo: stringSchema,
      externalId: stringSchema,
      statementStatus: stringSchema,
      normalizedStatus: stringSchema,
      amount: numberSchema,
      currency: stringSchema,
      occurredAt: { type: "string", format: "date-time" },
      localRecordId: stringSchema,
      localStatus: stringSchema,
      differenceCodes: arrayOf(stringSchema),
      differenceDetail: stringSchema,
      reviewStatus: stringSchema,
      reviewReason: stringSchema,
      reviewedBy: stringSchema,
      reviewedAt: { type: "string", format: "date-time" }
    },
    ["id", "batchId", "rowNumber", "kind", "merchantOrderNo", "statementStatus", "normalizedStatus", "amount", "currency", "differenceCodes", "reviewStatus"]
  ),
  PaymentStatementBatchDetail: objectOf(
    {
      id: stringSchema,
      workspaceId: stringSchema,
      provider: stringSchema,
      fileName: stringSchema,
      fileSha256: stringSchema,
      status: stringSchema,
      totalRows: numberSchema,
      matchedRows: numberSchema,
      differenceRows: numberSchema,
      acknowledgedRows: numberSchema,
      importedBy: stringSchema,
      importedAt: { type: "string", format: "date-time" },
      lines: arrayOf("PaymentStatementLineSummary")
    },
    ["id", "workspaceId", "provider", "fileName", "fileSha256", "status", "totalRows", "matchedRows", "differenceRows", "acknowledgedRows", "importedAt", "lines"]
  ),
  PaymentStatementBatchList: arrayOf("PaymentStatementBatchSummary"),
  CreateFileUploadSessionRequest: objectOf(
    {
      businessModule: stringSchema,
      businessType: stringSchema,
      businessId: stringSchema,
      fileName: stringSchema,
      mimeType: stringSchema,
      sizeBytes: numberSchema,
      uploadScene: stringSchema,
      idempotencyKey: stringSchema,
      metadata: objectSchema
    },
    ["businessModule", "businessType", "businessId", "fileName", "mimeType", "sizeBytes", "uploadScene", "idempotencyKey"]
  ),
  CompleteFileUploadRequest: objectOf({ checksum: stringSchema }),
  CreateCustomerIdentityUploadRequest: objectOf(
    { fileName: stringSchema, mimeType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] }, sizeBytes: { type: "integer", minimum: 1, maximum: 20971520 }, idempotencyKey: stringSchema },
    ["fileName", "mimeType", "sizeBytes", "idempotencyKey"]
  ),
  CreateCarrierEvidenceUploadRequest: objectOf(
    { fileName: { type: "string", maxLength: 180 }, mimeType: { type: "string", enum: ["image/jpeg", "image/png", "image/webp", "application/pdf"] }, sizeBytes: { type: "integer", minimum: 1, maximum: 20971520 }, idempotencyKey: { type: "string", maxLength: 191 } },
    ["fileName", "mimeType", "sizeBytes", "idempotencyKey"],
    false
  ),
  CreateRentalCarrierShipmentEventRequest: objectOf(
    {
      type: { type: "string", enum: ["outbound_dispatched", "customer_handoff"] },
      occurredAt: { type: "string", format: "date-time" },
      carrierName: { type: "string", minLength: 1, maxLength: 120 },
      trackingNumber: { type: "string", minLength: 1, maxLength: 191 },
      evidenceFileAssetIds: { type: "array", minItems: 1, uniqueItems: true, items: stringSchema }
    },
    ["type", "occurredAt", "carrierName", "trackingNumber", "evidenceFileAssetIds"],
    false
  ),
  RentalCarrierShipmentEventSummary: objectOf(
    {
      id: stringSchema, tenantId: stringSchema, workspaceId: stringSchema, orderId: stringSchema,
      type: { type: "string", enum: ["outbound_dispatched", "customer_signed", "customer_handoff", "warehouse_received"] },
      occurredAt: { type: "string", format: "date-time" }, carrierName: stringSchema, trackingNumber: stringSchema,
      evidenceFileAssetIds: arrayOf(stringSchema), recordedBy: stringSchema, createdAt: { type: "string", format: "date-time" }
    },
    ["id", "tenantId", "workspaceId", "orderId", "type", "occurredAt", "carrierName", "trackingNumber", "evidenceFileAssetIds", "recordedBy", "createdAt"],
    false
  ),
  RentalCarrierShipmentEventList: arrayOf("RentalCarrierShipmentEventSummary"),
  SaveCustomerIdentityVerificationRequest: objectOf(
    {
      credentialType: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$" },
      result: { type: "string", enum: ["verified", "rejected", "revoked"] },
      evidenceFileAssetIds: { type: "array", uniqueItems: true, minItems: 0, maxItems: 5, items: stringSchema },
      reason: { type: "string", minLength: 1, maxLength: 500 }
    },
    ["credentialType", "result", "evidenceFileAssetIds", "reason"]
  ),
  CustomerIdentityVerificationSummary: objectOf(
    {
      id: stringSchema, tenantId: stringSchema, customerId: stringSchema, credentialType: stringSchema,
      result: { type: "string", enum: ["verified", "rejected", "revoked"] }, evidenceFileAssetIds: { type: "array", items: stringSchema },
      reason: stringSchema, reviewerUserId: stringSchema, reviewerName: stringSchema,
      reviewedAt: { type: "string", format: "date-time" }, verifiedAt: { type: "string", format: "date-time" }
    },
    ["id", "tenantId", "customerId", "credentialType", "result", "evidenceFileAssetIds", "reason", "reviewerUserId", "reviewerName", "reviewedAt"]
  ),
  CustomerIdentityVerificationList: { type: "array", items: ref("CustomerIdentityVerificationSummary") },
  FileUploadSessionSummary: objectOf(
    {
      sessionId: stringSchema,
      fileAssetId: stringSchema,
      provider: stringSchema,
      mode: stringSchema,
      status: stringSchema,
      uploadUrl: stringSchema,
      uploadHeaders: objectSchema,
      expiresAt: { type: "string", format: "date-time" }
    },
    ["sessionId", "fileAssetId", "provider", "mode", "status", "expiresAt"]
  ),
  FileDownloadUrlSummary: objectOf(
    {
      fileAssetId: stringSchema,
      provider: stringSchema,
      mode: stringSchema,
      downloadUrl: stringSchema,
      expiresAt: { type: "string", format: "date-time" }
    },
    ["fileAssetId", "provider", "mode", "downloadUrl"]
  ),
  FileUploadCleanupSummary: objectOf(
    {
      scanned: numberSchema,
      invalidated: numberSchema,
      deletedObjects: numberSchema,
      cleanupPending: numberSchema,
      sessionIds: { type: "array", items: stringSchema }
    },
    ["scanned", "invalidated", "deletedObjects", "cleanupPending", "sessionIds"]
  ),
  SessionContextResponse: objectOf(
    {
      tenant: ref("TenantContext"),
      user: ref("AuthUser")
    },
    ["tenant", "user"]
  ),
  TenantSummary: objectOf(
    {
      tenantId: stringSchema,
      tenantCode: stringSchema,
      tenantName: stringSchema,
      tenantStatus: stringSchema,
      enabledBusinessLines: arrayOf(stringSchema),
      categoryCode: stringSchema,
      categoryName: stringSchema,
      userCount: numberSchema,
      organizationCount: numberSchema,
      orderCount: numberSchema,
      statusReason: stringSchema,
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    },
    ["tenantId", "tenantCode", "tenantName", "tenantStatus", "enabledBusinessLines"]
  ),
  ResetUserPasswordResult: objectOf(
    {
      userId: stringSchema,
      account: stringSchema,
      temporaryPassword: stringSchema,
      message: stringSchema
    },
    ["userId", "account", "temporaryPassword", "message"]
  ),
  OrganizationSummary: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      parentId: stringSchema,
      type: stringSchema,
      code: stringSchema,
      name: stringSchema,
      status: stringSchema
    },
    ["id", "tenantId", "type", "code", "name", "status"]
  ),
  PermissionModule: objectOf(
    {
      code: stringSchema,
      name: stringSchema,
      children: arrayOf(
        objectOf({
          code: stringSchema,
          name: stringSchema,
          description: stringSchema
        })
      )
    },
    ["code", "name", "children"]
  ),
  SystemRoleRow: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      code: stringSchema,
      name: stringSchema,
      description: stringSchema,
      scope: stringSchema,
      fixedAllPermissions: booleanSchema,
      enabledBusinessScopes: arrayOf(stringSchema),
      isActive: booleanSchema,
      permissions: arrayOf(stringSchema),
      buttonPermissions: arrayOf(stringSchema),
      dataScope: stringSchema
    },
    [
      "id",
      "code",
      "name",
      "scope",
      "fixedAllPermissions",
      "enabledBusinessScopes",
      "isActive",
      "permissions",
      "buttonPermissions",
      "dataScope"
    ]
  ),
  SaveSystemRoleRequest: objectOf(
    {
      id: stringSchema,
      code: stringSchema,
      name: stringSchema,
      description: stringSchema,
      scope: stringSchema,
      enabledBusinessScopes: arrayOf(stringSchema),
      permissions: arrayOf(stringSchema),
      buttonPermissions: arrayOf(stringSchema),
      dataScope: stringSchema,
      isActive: booleanSchema
    },
    ["code", "name", "scope", "enabledBusinessScopes", "permissions", "isActive"]
  ),
  SystemUserRow: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      account: stringSchema,
      displayName: stringSchema,
      phone: stringSchema,
      organizationId: stringSchema,
      organizationName: stringSchema,
      roleIds: arrayOf(stringSchema),
      roleNames: arrayOf(stringSchema),
      scope: stringSchema,
      isPlatformAdmin: booleanSchema,
      isSaasAdmin: booleanSchema,
      mustChangePassword: booleanSchema,
      temporaryPassword: stringSchema,
      isActive: booleanSchema,
      permissions: arrayOf(stringSchema),
      dataScope: stringSchema
    },
    [
      "id",
      "tenantId",
      "account",
      "displayName",
      "roleIds",
      "roleNames",
      "scope",
      "isPlatformAdmin",
      "isActive",
      "permissions",
      "dataScope"
    ]
  ),
  SaveSystemUserRequest: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      account: stringSchema,
      displayName: stringSchema,
      phone: stringSchema,
      organizationId: stringSchema,
      roleIds: arrayOf(stringSchema),
      isPlatformAdmin: booleanSchema,
      isActive: booleanSchema
    },
    ["tenantId", "account", "displayName", "roleIds", "isActive"]
  ),
  SaveWorkspaceAccessRequest: objectOf(
    {
      workspaceId: stringSchema,
      roleId: stringSchema,
      dataScope: stringSchema,
      isActive: booleanSchema
    },
    ["workspaceId", "isActive"]
  ),
  SaveSystemUserAccessRequest: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      account: stringSchema,
      displayName: stringSchema,
      phone: stringSchema,
      organizationId: stringSchema,
      roleIds: arrayOf(stringSchema),
      isPlatformAdmin: booleanSchema,
      isActive: booleanSchema,
      workspaceAccesses: arrayOf("SaveWorkspaceAccessRequest")
    },
    ["account", "displayName", "roleIds", "isActive", "workspaceAccesses"]
  ),
  SystemRulesConfig: objectSchema,
  SaveSystemRuleSectionRequest: objectOf(
    {
      config: ref("SystemRulesConfig"),
      operator: stringSchema
    },
    ["config"]
  ),
  SystemAiConnectionTestRequest: objectOf({
    operator: stringSchema
  }),
  SystemAiConnectionTestResult: objectOf(
    {
      status: stringSchema,
      testedAt: { type: "string", format: "date-time" },
      provider: stringSchema,
      modelName: stringSchema,
      message: stringSchema
    },
    ["status", "testedAt", "provider", "modelName", "message"]
  ),
  SystemSecurityBaselineConfig: objectSchema,
  SaveSecurityBaselineRequest: objectOf(
    {
      config: ref("SystemSecurityBaselineConfig"),
      operator: stringSchema
    },
    ["config"]
  ),
  SecondConfirmationCheckRequest: objectOf(
    {
      action: stringSchema,
      confirmationCode: stringSchema
    },
    ["action"]
  ),
  PlatformAuditResult: objectOf(
    {
      rows: arrayOf("PlatformAuditLogRow"),
      total: numberSchema
    },
    ["rows", "total"]
  ),
  PlatformAuditLogRow: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      workspaceId: stringSchema,
      action: stringSchema,
      operator: stringSchema,
      targetType: stringSchema,
      targetId: stringSchema,
      detail: stringSchema,
      createdAt: { type: "string", format: "date-time" }
    },
    ["id", "tenantId", "action", "operator", "targetType", "detail", "createdAt"]
  ),
  PlatformDictionaryGroup: objectOf(
    {
      code: stringSchema,
      name: stringSchema,
      module: stringSchema,
      description: stringSchema,
      items: arrayOf("PlatformDictionaryItem"),
      updatedAt: { type: "string", format: "date-time" },
      updatedBy: stringSchema
    },
    ["code", "name", "module", "items", "updatedAt", "updatedBy"]
  ),
  PlatformDictionaryItem: objectOf(
    {
      code: stringSchema,
      label: stringSchema,
      value: stringSchema,
      sortNo: numberSchema,
      enabled: booleanSchema,
      remark: stringSchema
    },
    ["code", "label", "value", "sortNo", "enabled"]
  ),
  SavePlatformDictionaryGroupRequest: objectOf(
    {
      name: stringSchema,
      module: stringSchema,
      description: stringSchema,
      items: arrayOf("PlatformDictionaryItem"),
      operator: stringSchema
    },
    ["name", "module", "items", "operator"]
  ),
  PlatformNumberRule: objectOf(
    {
      code: stringSchema,
      name: stringSchema,
      module: stringSchema,
      prefix: stringSchema,
      datePattern: stringSchema,
      sequenceLength: numberSchema,
      currentSequence: numberSchema,
      resetCycle: stringSchema,
      enabled: booleanSchema,
      sample: stringSchema,
      updatedAt: { type: "string", format: "date-time" },
      updatedBy: stringSchema
    },
    [
      "code",
      "name",
      "module",
      "prefix",
      "datePattern",
      "sequenceLength",
      "currentSequence",
      "resetCycle",
      "enabled",
      "sample",
      "updatedAt",
      "updatedBy"
    ]
  ),
  SavePlatformNumberRuleRequest: objectOf(
    {
      name: stringSchema,
      module: stringSchema,
      prefix: stringSchema,
      datePattern: stringSchema,
      sequenceLength: numberSchema,
      currentSequence: numberSchema,
      resetCycle: stringSchema,
      enabled: booleanSchema,
      operator: stringSchema
    },
    ["name", "module", "prefix", "datePattern", "sequenceLength", "resetCycle", "enabled", "operator"]
  ),
  GeneratePlatformNumberRequest: objectOf(
    {
      code: stringSchema,
      operator: stringSchema
    },
    ["code", "operator"]
  ),
  GeneratePlatformNumberResult: objectOf(
    {
      code: stringSchema,
      generatedNo: stringSchema,
      nextSequence: numberSchema
    },
    ["code", "generatedNo", "nextSequence"]
  ),
  PlatformFilterPreset: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      scopeKey: stringSchema,
      name: stringSchema,
      description: stringSchema,
      filters: objectSchema,
      isDefault: booleanSchema,
      isSystem: booleanSchema,
      updatedAt: { type: "string", format: "date-time" },
      updatedBy: stringSchema
    },
    [
      "id",
      "tenantId",
      "scopeKey",
      "name",
      "filters",
      "isDefault",
      "isSystem",
      "updatedAt",
      "updatedBy"
    ]
  ),
  SavePlatformFilterPresetRequest: objectOf(
    {
      id: stringSchema,
      tenantId: stringSchema,
      scopeKey: stringSchema,
      name: stringSchema,
      description: stringSchema,
      filters: objectSchema,
      isDefault: booleanSchema,
      operator: stringSchema
    },
    ["scopeKey", "name", "filters"]
  ),
  SetPlatformFilterPresetDefaultRequest: objectOf({
    operator: stringSchema
  }),
  DeletePlatformFilterPresetResult: objectOf(
    {
      id: stringSchema,
      deleted: booleanSchema
    },
    ["id", "deleted"]
  ),
  TenantBootstrapRequest: objectOf(
    {
      tenantCode: stringSchema,
      tenantName: stringSchema,
      categoryCode: stringSchema,
      operator: stringSchema,
      adminAccount: stringSchema,
      adminDisplayName: stringSchema,
      adminPhone: stringSchema,
      storeName: stringSchema,
      storeCode: stringSchema
    },
    ["tenantCode", "tenantName", "categoryCode", "operator", "adminAccount", "adminDisplayName"]
  ),
  UpdateTenantRequest: objectOf(
    { tenantName: stringSchema },
    ["tenantName"]
  ),
  UpdateTenantStatusRequest: objectOf(
    {
      status: stringSchema,
      reason: stringSchema
    },
    ["status", "reason"]
  ),
  TenantBootstrapPreview: objectSchema,
  TenantBootstrapResult: objectOf(
    {
      tenant: ref("TenantSummary"),
      adminUser: ref("SystemUserRow"),
      preview: ref("TenantBootstrapPreview"),
      templateExecution: objectSchema,
      message: stringSchema,
      temporaryPassword: stringSchema
    },
    ["tenant", "adminUser", "preview", "message"]
  ),
  RolePermissionsRequest: objectOf({
    permissions: arrayOf(stringSchema)
  }),
  UserStatusRequest: objectOf({
    isActive: booleanSchema
  }),
  ClientWorkspaceSummary: objectOf(
    {
      workspaceCode: stringSchema,
      workspaceName: stringSchema,
      categoryCode: stringSchema,
      membershipStatus: stringSchema,
      isDefault: booleanSchema
    },
    ["workspaceCode", "workspaceName", "categoryCode", "membershipStatus"]
  ),
  ClientWorkspaceDirectory: objectOf(
    {
      apiVersion: stringSchema,
      tenantCode: stringSchema,
      tenantName: stringSchema,
      workspaces: arrayOf(ref("ClientWorkspaceSummary"))
    },
    ["apiVersion", "tenantCode", "tenantName", "workspaces"]
  ),
  ClientRegistrationChallengeRequest: objectOf(
    {
      tenantCode: stringSchema,
      workspaceCode: stringSchema,
      method: { type: "string", enum: ["sms", "email"] },
      identifier: stringSchema,
      idempotencyKey: stringSchema
    },
    ["tenantCode", "method", "identifier", "idempotencyKey"]
  ),
  ClientRegistrationChallengeResponse: objectOf(
    {
      apiVersion: stringSchema,
      challengeId: stringSchema,
      status: stringSchema,
      method: stringSchema,
      maskedDestination: stringSchema,
      expiresAt: { type: "string", format: "date-time" },
      retryAfterSeconds: numberSchema,
      developmentCode: stringSchema,
      deliveryMode: stringSchema
    },
    ["apiVersion", "challengeId", "status", "method", "maskedDestination", "expiresAt"]
  ),
  VerifyClientRegistrationChallengeRequest: objectOf(
    { code: { type: "string", minLength: 6, maxLength: 6 } },
    ["code"]
  ),
  VerifyClientRegistrationChallengeResponse: objectOf(
    {
      apiVersion: stringSchema,
      verificationToken: stringSchema,
      expiresAt: { type: "string", format: "date-time" }
    },
    ["apiVersion", "verificationToken", "expiresAt"]
  ),
  ClientPersonalMembershipRegistrationRequest: objectOf(
    {
      tenantCode: stringSchema,
      workspaceCode: stringSchema,
      name: stringSchema,
      phone: stringSchema,
      email: stringSchema,
      identityNo: stringSchema,
      password: { type: "string", format: "password" },
      verificationToken: stringSchema,
      consent: objectOf(
        {
          userAgreementVersion: stringSchema,
          privacyPolicyVersion: stringSchema,
          agreedAt: { type: "string", format: "date-time" }
        },
        ["userAgreementVersion", "privacyPolicyVersion", "agreedAt"]
      ),
      idempotencyKey: stringSchema
    },
    ["tenantCode", "name", "phone", "password", "verificationToken", "consent", "idempotencyKey"]
  ),
  ClientPersonalMembershipRegistrationResponse: objectOf(
    {
      apiVersion: stringSchema,
      result: stringSchema,
      registrationId: stringSchema,
      customerId: stringSchema,
      reviewStatus: stringSchema,
      membershipStatus: stringSchema
    },
    ["apiVersion", "result", "registrationId", "reviewStatus", "membershipStatus"]
  ),
  ClientMembershipLoginRequest: objectOf(
    {
      tenantCode: stringSchema,
      loginIdentifier: stringSchema,
      password: { type: "string", format: "password" },
      workspaceCode: stringSchema,
      clientId: stringSchema
    },
    ["tenantCode", "loginIdentifier", "password"]
  ),
  ClientMembershipSessionResponse: objectOf(
    {
      apiVersion: stringSchema,
      accessToken: stringSchema,
      refreshToken: stringSchema,
      expiresIn: numberSchema,
      customer: objectOf(
        {
          customerId: stringSchema,
          customerType: stringSchema,
          displayName: stringSchema,
          loginIdentifierMasked: stringSchema
        },
        ["customerId", "customerType", "displayName", "loginIdentifierMasked"]
      ),
      workspaces: arrayOf(ref("ClientWorkspaceSummary")),
      workspace: ref("ClientWorkspaceSummary"),
      wechatBound: booleanSchema
    },
    ["apiVersion", "accessToken", "refreshToken", "expiresIn", "customer", "workspaces"]
  ),
  ClientRefreshRequest: objectOf({ refreshToken: stringSchema }, ["refreshToken"]),
  ClientSwitchWorkspaceRequest: objectOf({ workspaceCode: stringSchema }, ["workspaceCode"]),
  ClientChangePasswordRequest: objectOf(
    {
      currentPassword: { type: "string", format: "password" },
      newPassword: { type: "string", format: "password" }
    },
    ["currentPassword", "newPassword"]
  ),
  ClientActionResult: objectOf({ success: booleanSchema }),
  ClientChannelBootstrapResponse: objectOf(
    {
      apiVersion: stringSchema,
      tenantCode: stringSchema,
      client: { type: "string", enum: ["wechat_miniprogram", "app", "web"] },
      merchant: objectOf({ name: stringSchema, logoUrl: stringSchema, faviconUrl: stringSchema, servicePhone: stringSchema, serviceHours: stringSchema }, ["name"], false),
      adminLogin: ref("AdminLoginBranding"),
      services: arrayOf(objectOf({ code: stringSchema, name: stringSchema, categoryCode: stringSchema, isDefault: booleanSchema, status: { type: "string", enum: ["open", "paused"] } }, ["code", "name", "categoryCode", "status"], false)),
      categories: arrayOf(objectOf({ code: stringSchema, name: stringSchema }, ["code", "name"], false)),
      defaultServiceCode: stringSchema,
      agreements: objectOf({
        userAgreement: objectOf({ name: stringSchema, version: stringSchema, url: stringSchema, hasBody: booleanSchema }, ["name", "version", "hasBody"], false),
        privacyPolicy: objectOf({ name: stringSchema, version: stringSchema, url: stringSchema, hasBody: booleanSchema }, ["name", "version", "hasBody"], false)
      }, ["userAgreement", "privacyPolicy"], false),
      help: objectOf({ available: booleanSchema, faqCount: numberSchema }, ["available", "faqCount"], false),
      banner: objectOf({ title: stringSchema, subtitle: stringSchema }, ["title"], false),
      themeColor: stringSchema,
      loginMethods: arrayOf({ type: "string", enum: ["wechat_phone", "sms", "password"] }),
      capabilities: objectOf({ publicCatalog: booleanSchema, wechatPay: booleanSchema, delivery: booleanSchema, feeResponse: booleanSchema, accountClosure: booleanSchema }, ["publicCatalog", "wechatPay", "delivery", "feeResponse", "accountClosure"], false),
      website: ref("ClientWebsiteConfig"),
      source: { type: "string", enum: ["channel", "workspace_directory"] }
    },
    ["apiVersion", "tenantCode", "client", "merchant", "services", "categories", "help", "loginMethods", "capabilities", "source"],
    false
  ),
  ClientWebsiteConfig: objectOf(
    {
      slogan: stringSchema, heroTitle: stringSchema, heroDescription: stringSchema, heroImageUrl: stringSchema,
      secondaryColor: stringSchema, footerText: stringSchema, contactAddress: stringSchema,
      ctaTitle: stringSchema, ctaDescription: stringSchema,
      seoTitle: stringSchema, seoDescription: stringSchema, seoKeywords: stringSchema,
      categoryImages: arrayOf(objectOf({ code: stringSchema, imageUrl: stringSchema }, ["code", "imageUrl"], false)),
      advantages: arrayOf(objectOf({ icon: stringSchema, title: stringSchema, description: stringSchema }, ["title"], false)),
      steps: arrayOf(objectOf({ title: stringSchema, description: stringSchema }, ["title"], false)),
      testimonials: arrayOf(objectOf({ name: stringSchema, context: stringSchema, text: stringSchema }, ["name", "text"], false)),
      showPoweredBy: booleanSchema
    },
    ["showPoweredBy"],
    false
  ),
  ClientWebsiteHostResolution: objectOf({ tenantCode: { type: "string", nullable: true } }, ["tenantCode"], false),
  ClientPublicDocumentResponse: objectOf(
    {
      apiVersion: stringSchema, tenantCode: stringSchema, kind: { type: "string", enum: ["user_agreement", "privacy_policy", "help"] },
      name: stringSchema, version: stringSchema, url: stringSchema, body: stringSchema, intro: stringSchema,
      faq: arrayOf("ClientChannelFaqItem"), updatedAt: { type: "string", format: "date-time" }
    },
    ["apiVersion", "tenantCode", "kind", "name"],
    false
  ),
  ClientChallengeRequest: objectOf(
    { tenantCode: stringSchema, workspaceCode: stringSchema, method: { type: "string", enum: ["sms", "email"] }, identifier: stringSchema, idempotencyKey: stringSchema, purpose: { type: "string", enum: ["registration", "login"] } },
    ["tenantCode", "method", "identifier", "idempotencyKey", "purpose"]
  ),
  ClientSmsLoginRequest: objectOf(
    { tenantCode: stringSchema, loginIdentifier: stringSchema, verificationToken: stringSchema, workspaceCode: stringSchema, clientId: stringSchema },
    ["tenantCode", "loginIdentifier", "verificationToken"]
  ),
  ClientWechatPhoneLoginRequest: objectOf(
    { tenantCode: stringSchema, appId: stringSchema, loginCode: stringSchema, phoneCode: stringSchema, consent: objectOf({ userAgreementVersion: stringSchema, privacyPolicyVersion: stringSchema, agreedAt: { type: "string", format: "date-time" } }, ["userAgreementVersion", "privacyPolicyVersion", "agreedAt"]), workspaceCode: stringSchema, clientId: stringSchema },
    ["tenantCode", "loginCode", "phoneCode", "consent"]
  ),
  ClientWechatBindRequest: objectOf({ loginCode: stringSchema, appId: stringSchema }, ["loginCode"]),
  ClientWechatBindResponse: objectOf({ apiVersion: stringSchema, bound: booleanSchema, appId: stringSchema, boundAt: { type: "string", format: "date-time" } }, ["apiVersion", "bound", "appId", "boundAt"], false),
  ClientAccountClosurePreview: objectOf(
    {
      apiVersion: stringSchema, closable: booleanSchema,
      blockers: arrayOf(objectOf({ code: stringSchema, message: stringSchema, count: numberSchema }, ["code", "message"])),
      manualConfirmations: arrayOf(objectOf({ code: stringSchema, message: stringSchema }, ["code", "message"]))
    },
    ["apiVersion", "closable", "blockers", "manualConfirmations"], false
  ),
  ClientAccountClosureRequest: objectOf(
    { loginIdentifier: stringSchema, verificationToken: stringSchema, acknowledgedManualChecks: booleanSchema, reason: stringSchema },
    ["loginIdentifier", "verificationToken", "acknowledgedManualChecks"]
  ),
  ClientAccountClosureResponse: objectOf({ apiVersion: stringSchema, closed: booleanSchema, closedAt: { type: "string", format: "date-time" } }, ["apiVersion", "closed", "closedAt"], false),
  ClientDeliveryAddressRequest: objectOf(
    {
      id: stringSchema, revision: numberSchema, recipient: stringSchema, phone: stringSchema, countryCode: stringSchema, province: stringSchema, city: stringSchema,
      district: stringSchema, detail: stringSchema, postalCode: stringSchema, latitude: numberSchema, longitude: numberSchema, isDefault: booleanSchema
    },
    ["recipient", "phone", "province", "city", "detail"]
  ),
  ClientDeliveryAddress: objectOf(
    {
      id: stringSchema, revision: numberSchema, recipient: stringSchema, phoneMasked: stringSchema, countryCode: stringSchema, province: stringSchema, city: stringSchema,
      district: stringSchema, detail: stringSchema, postalCode: stringSchema, latitude: numberSchema, longitude: numberSchema, isDefault: booleanSchema, updatedAt: { type: "string", format: "date-time" }
    },
    ["id", "revision", "recipient", "phoneMasked", "countryCode", "province", "city", "detail", "isDefault", "updatedAt"],
    false
  ),
  ClientDeliveryAddressList: objectOf({ apiVersion: stringSchema, items: arrayOf(ref("ClientDeliveryAddress")) }, ["apiVersion", "items"], false),
  ClientDeliveryAddressSnapshot: objectOf(
    {
      addressId: stringSchema, recipient: stringSchema, phoneMasked: stringSchema, countryCode: stringSchema, province: stringSchema, city: stringSchema, district: stringSchema,
      detail: stringSchema, postalCode: stringSchema, latitude: numberSchema, longitude: numberSchema, capturedAt: { type: "string", format: "date-time" }
    },
    ["recipient", "phoneMasked", "countryCode", "province", "city", "detail", "capturedAt"],
    false
  ),
  ClientFeeItem: objectOf(
    {
      inspectionId: stringSchema, exceptionIndex: numberSchema, stage: { type: "string", enum: ["pickup", "return"] }, code: stringSchema, description: stringSchema,
      amount: numberSchema, currency: stringSchema, reviewedAt: { type: "string", format: "date-time" },
      responseStatus: { type: "string", enum: ["pending", "confirmed", "disputed"] }, responseReason: stringSchema, respondedAt: { type: "string", format: "date-time" },
      adjustments: arrayOf(objectOf({ fromAmount: numberSchema, toAmount: numberSchema, reason: stringSchema, adjustedAt: { type: "string", format: "date-time" } }, ["fromAmount", "toAmount", "reason", "adjustedAt"], false)),
      history: arrayOf(objectOf({ decision: { type: "string", enum: ["confirmed", "disputed"] }, reason: stringSchema, respondedAt: { type: "string", format: "date-time" } }, ["decision", "reason", "respondedAt"], false)),
      evidenceCount: numberSchema
    },
    ["inspectionId", "exceptionIndex", "stage", "code", "description", "amount", "currency", "responseStatus", "adjustments", "history", "evidenceCount"],
    false
  ),
  ClientFeeItemsResponse: objectOf({ apiVersion: stringSchema, orderId: stringSchema, items: arrayOf(ref("ClientFeeItem")), pendingCount: numberSchema }, ["apiVersion", "orderId", "items", "pendingCount"], false),
  ClientFeeResponseRequest: objectOf({ decision: { type: "string", enum: ["confirmed", "disputed"] }, reason: stringSchema }, ["decision", "reason"]),
  ClientFeeResponseResult: objectOf({ apiVersion: stringSchema, item: ref("ClientFeeItem"), replayed: booleanSchema }, ["apiVersion", "item", "replayed"], false),
  ClientMembershipStatus: objectOf(
    {
      apiVersion: stringSchema,
      customerId: stringSchema,
      customerType: stringSchema,
      displayName: stringSchema,
      phoneMasked: stringSchema,
      email: stringSchema,
      accountStatus: stringSchema,
      workspace: ref("ClientWorkspaceSummary"),
      workspaces: arrayOf(ref("ClientWorkspaceSummary")),
      reviews: arrayOf(objectSchema),
      qualifications: arrayOf(objectSchema)
    },
    ["apiVersion", "customerId", "customerType", "displayName", "phoneMasked", "accountStatus", "workspace", "workspaces", "reviews", "qualifications"]
  ),
  ClientProfileUpdateRequest: objectOf(
    {
      name: stringSchema,
      email: stringSchema
    },
    []
  ),
  ClientContactRequest: objectOf(
    {
      id: stringSchema,
      kind: { type: "string", enum: ["emergency", "corporate", "other"] },
      name: stringSchema,
      phone: stringSchema,
      email: stringSchema,
      relation: stringSchema,
      isPrimary: booleanSchema
    },
    ["kind", "name", "phone"]
  ),
  ClientContact: objectOf(
    {
      id: stringSchema,
      kind: { type: "string", enum: ["emergency", "corporate", "other"] },
      name: stringSchema,
      phoneMasked: stringSchema,
      email: stringSchema,
      relation: stringSchema,
      isPrimary: booleanSchema,
      status: stringSchema
    },
    ["id", "kind", "name", "phoneMasked", "isPrimary", "status"]
  ),
  ClientContacts: objectOf(
    { apiVersion: stringSchema, items: arrayOf(ref("ClientContact")) },
    ["apiVersion", "items"]
  ),
  ClientProfile: objectOf(
    {
      apiVersion: stringSchema,
      customerId: stringSchema,
      customerType: stringSchema,
      name: stringSchema,
      phoneMasked: stringSchema,
      email: stringSchema,
      identityVerified: booleanSchema,
      identityNoMasked: stringSchema,
      accountStatus: stringSchema,
      workspace: ref("ClientWorkspaceSummary"),
      corporate: objectSchema,
      contacts: arrayOf(ref("ClientContact"))
    },
    ["apiVersion", "customerId", "customerType", "name", "phoneMasked", "identityVerified", "accountStatus", "workspace", "contacts"]
  ),
  ClientMembershipPlan: objectOf(
    {
      planId: stringSchema,
      code: stringSchema,
      name: stringSchema,
      targetType: stringSchema,
      versionId: stringSchema,
      version: numberSchema,
      levelRank: numberSchema,
      isDefault: booleanSchema,
      isRecommended: booleanSchema,
      benefits: arrayOf(ref("CustomerMembershipBenefit")),
      effectiveFrom: { type: "string", format: "date-time" },
      effectiveTo: { type: "string", format: "date-time" }
    },
    ["planId", "code", "name", "targetType", "versionId", "version", "levelRank", "isDefault", "isRecommended", "benefits"]
  ),
  ClientMembershipPlans: objectOf(
    { apiVersion: stringSchema, plans: arrayOf(ref("ClientMembershipPlan")) },
    ["apiVersion", "plans"]
  ),
  ClientMembershipAssignment: objectOf(
    {
      id: stringSchema,
      planId: stringSchema,
      planVersionId: stringSchema,
      planName: stringSchema,
      targetType: stringSchema,
      source: stringSchema,
      status: stringSchema,
      effectiveFrom: { type: "string", format: "date-time" },
      effectiveTo: { type: "string", format: "date-time" },
      benefits: arrayOf(ref("CustomerMembershipBenefit")),
      reason: stringSchema,
      createdAt: { type: "string", format: "date-time" }
    },
    ["id", "planId", "planVersionId", "planName", "targetType", "source", "status", "effectiveFrom", "benefits", "createdAt"]
  ),
  ClientMembershipAssignments: objectOf(
    { apiVersion: stringSchema, items: arrayOf(ref("ClientMembershipAssignment")) },
    ["apiVersion", "items"]
  ),
  ClientMembershipBenefits: objectOf(
    {
      apiVersion: stringSchema,
      personal: ref("ClientMembershipAssignment"),
      corporate: ref("ClientMembershipAssignment")
    },
    ["apiVersion"]
  ),
  ClientCorporateIdentity: objectOf(
    {
      corporateCustomerId: stringSchema,
      corporateName: stringSchema,
      legalName: stringSchema,
      unifiedSocialCreditCodeMasked: stringSchema,
      registeredAddress: stringSchema,
      role: stringSchema,
      department: stringSchema,
      employeeNo: stringSchema,
      membershipId: stringSchema,
      effectiveTo: { type: "string", format: "date-time" }
    },
    ["corporateCustomerId", "corporateName", "role", "membershipId"]
  ),
  ClientCorporateIdentities: objectOf(
    { apiVersion: stringSchema, items: arrayOf(ref("ClientCorporateIdentity")) },
    ["apiVersion", "items"]
  ),
  ClientPaymentCapabilities: objectOf(
    {
      apiVersion: stringSchema,
      mode: stringSchema,
      realPaymentEnabled: { type: "boolean" },
      methods: arrayOf(stringSchema),
      instruments: arrayOf(stringSchema)
    },
    ["apiVersion", "mode", "realPaymentEnabled", "methods", "instruments"]
  ),
  ClientConfig: objectOf(
    {
      apiVersion: stringSchema,
      tenantCode: stringSchema,
      workspace: ref("ClientWorkspaceSummary"),
      categoryCode: stringSchema,
      timeZone: stringSchema,
      registration: objectOf({ mode: stringSchema, verificationMethods: arrayOf(stringSchema), providerMode: stringSchema }, ["mode", "verificationMethods", "providerMode"]),
      features: objectOf({ profile: booleanSchema, contacts: booleanSchema, membershipPlans: booleanSchema, qualifications: booleanSchema, coupons: booleanSchema, orderExtensions: booleanSchema, notifications: booleanSchema, delivery: booleanSchema, feeResponse: booleanSchema, accountClosure: booleanSchema, wechatBinding: booleanSchema }, ["profile", "contacts", "membershipPlans", "qualifications", "coupons", "orderExtensions", "notifications", "delivery", "feeResponse", "accountClosure", "wechatBinding"]),
      payment: ref("ClientPaymentCapabilities")
    },
    ["apiVersion", "tenantCode", "workspace", "categoryCode", "timeZone", "registration", "features", "payment"]
  ),
  ClientBookingOption: objectOf(
    {
      bookingIdentity: stringSchema,
      corporateCustomerId: stringSchema,
      corporateName: stringSchema,
      membershipId: stringSchema,
      label: stringSchema,
      eligible: booleanSchema,
      reason: stringSchema
    },
    ["bookingIdentity", "label", "eligible"]
  ),
  ClientQualificationRequest: objectOf(
    {
      qualificationType: stringSchema,
      referenceNo: stringSchema,
      issuedAt: { type: "string", format: "date-time" },
      expiresAt: { type: "string", format: "date-time" },
      evidenceRef: stringSchema
    },
    ["qualificationType"]
  ),
  ClientQualificationUploadSessionRequest: objectOf(
    {
      qualificationType: stringSchema,
      fileName: stringSchema,
      mimeType: stringSchema,
      sizeBytes: numberSchema,
      idempotencyKey: stringSchema
    },
    ["qualificationType", "fileName", "mimeType", "sizeBytes", "idempotencyKey"]
  ),
  ClientQualificationUploadCompleteRequest: objectOf({ checksum: stringSchema }),
  ClientCatalog: objectOf(
    {
      apiVersion: stringSchema,
      tenantCode: stringSchema,
      workspace: ref("ClientWorkspaceSummary"),
      categoryCode: stringSchema,
      timeZone: stringSchema,
      terminology: objectOf({
        itemLabel: stringSchema,
        itemGroupLabel: stringSchema,
        assetLabel: stringSchema,
        fulfillmentLabel: stringSchema,
        pickupLabel: stringSchema,
        returnLabel: stringSchema,
        deliveryLabel: stringSchema,
        usageMetricLabel: stringSchema
      }, ["itemLabel", "itemGroupLabel", "assetLabel", "fulfillmentLabel", "pickupLabel", "returnLabel"], false),
      pricingUnits: arrayOf(objectOf({ code: stringSchema, label: stringSchema }, ["code", "label"], false)),
      items: arrayOf(objectSchema),
      pricingGroups: arrayOf(objectSchema),
      services: arrayOf(objectSchema),
      locations: arrayOf(objectSchema),
      discountPlans: arrayOf(objectSchema),
      fulfillment: objectOf({
        enabledModes: arrayOf(stringSchema),
        allowDifferentReturnLocation: booleanSchema,
        deliveryDestination: stringSchema,
        deliveryLabel: stringSchema,
        pickupLabel: stringSchema,
        returnLabel: stringSchema
      }, ["enabledModes", "allowDifferentReturnLocation", "deliveryDestination", "pickupLabel", "returnLabel"], false)
    },
    ["apiVersion", "tenantCode", "workspace", "categoryCode", "timeZone", "terminology", "pricingUnits", "items", "pricingGroups", "services", "locations", "discountPlans", "fulfillment"]
  ),
  ClientAvailabilityRequest: objectOf(
    {
      locationId: stringSchema,
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      lines: arrayOf(objectOf({ itemGroupId: stringSchema, quantity: numberSchema }, ["itemGroupId", "quantity"]))
    },
    ["locationId", "startAt", "endAt", "lines"]
  ),
  ClientQuoteRequest: objectOf(
    {
      bookingIdentity: objectSchema,
      fulfillmentMode: stringSchema,
      fulfillmentLocationId: stringSchema,
      returnLocationId: stringSchema,
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      pricingPlanId: stringSchema,
      discountPlanId: stringSchema,
      customerCouponId: stringSchema,
      lines: arrayOf(objectSchema),
      services: arrayOf(objectSchema),
      deliveryAddressId: stringSchema
    },
    ["fulfillmentMode", "fulfillmentLocationId", "startAt", "endAt", "lines"]
  ),
  ClientQuote: objectOf(
    {
      id: stringSchema,
      quoteNo: stringSchema,
      request: ref("ClientQuoteRequest"),
      rentalAmount: numberSchema,
      discountAmount: numberSchema,
      couponAmount: numberSchema,
      serviceAmount: numberSchema,
      finalPayableAmount: numberSchema,
      expiresAt: { type: "string", format: "date-time" }
    },
    ["id", "request"]
  ),
  ClientCreateOrderRequest: objectOf(
    {
      quoteId: stringSchema,
      contactPhone: stringSchema
    },
    ["quoteId"]
  ),
  ClientOrder: objectOf(
    {
      id: stringSchema,
      orderNo: stringSchema,
      status: stringSchema,
      customerName: stringSchema,
      fulfillmentMode: stringSchema,
      fulfillmentLocationName: stringSchema,
      returnLocationName: stringSchema,
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      effectiveEndAt: { type: "string", format: "date-time" },
      rentalAmount: numberSchema,
      discountAmount: numberSchema,
      couponAmount: numberSchema,
      serviceAmount: numberSchema,
      fulfillmentAmount: numberSchema,
      depositAmount: numberSchema,
      preAuthAmount: numberSchema,
      payableAmount: numberSchema,
      adjustmentAmount: numberSchema,
      finalPayableAmount: numberSchema,
      currency: stringSchema,
      lines: arrayOf(objectSchema),
      chargeLines: arrayOf(objectSchema),
      allocations: arrayOf(objectSchema),
      deliveryAddress: ref("ClientDeliveryAddressSnapshot"),
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    },
    ["id", "orderNo", "status", "customerName", "fulfillmentMode", "fulfillmentLocationName", "startAt", "endAt", "rentalAmount", "discountAmount", "couponAmount", "serviceAmount", "fulfillmentAmount", "depositAmount", "preAuthAmount", "payableAmount", "adjustmentAmount", "finalPayableAmount", "lines", "chargeLines", "createdAt", "updatedAt"]
  ),
  MyOrderIndex: objectOf(
    {
      orderId: stringSchema, orderNo: stringSchema, tenantCode: stringSchema,
      workspaceCode: stringSchema, workspaceName: stringSchema, categoryCode: stringSchema, status: stringSchema,
      startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" },
      effectiveEndAt: { type: "string", format: "date-time" }, finalPayableAmount: numberSchema, currency: stringSchema,
      createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
      itemSummary: objectOf(
        { firstItemGroupId: stringSchema, firstItemName: stringSchema, itemCount: { type: "integer", minimum: 0 }, totalQuantity: { type: "integer", minimum: 0 } },
        ["firstItemGroupId", "firstItemName", "itemCount", "totalQuantity"],
        false
      )
    },
    ["orderId", "orderNo", "tenantCode", "workspaceCode", "workspaceName", "categoryCode", "status", "startAt", "endAt", "finalPayableAmount", "currency", "createdAt", "updatedAt"],
    false
  ),
  ClientMyOrdersResponse: objectOf(
    { apiVersion: stringSchema, items: arrayOf(ref("MyOrderIndex")), page: { type: "integer", minimum: 1, maximum: 1000000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 }, total: { type: "integer", minimum: 0 } },
    ["apiVersion", "items", "page", "pageSize", "total"], false
  ),
  ClientCancellationPreview: objectOf(
    {
      apiVersion: stringSchema, orderId: stringSchema, cancellationCharge: numberSchema, currency: stringSchema,
      calculatedAt: { type: "string", format: "date-time" }, estimated: { type: "boolean", description: "Always true; cancellation rechecks state, time and settlement hooks. Not a refund quote." }
    },
    ["apiVersion", "orderId", "cancellationCharge", "currency", "calculatedAt", "estimated"], false
  ),
  ClientOrderMutation: objectOf({ order: ref("ClientOrder"), replayed: booleanSchema }, ["order", "replayed"]),
  ClientOrderList: objectOf({ items: arrayOf(ref("ClientOrder")), page: numberSchema, pageSize: numberSchema, total: numberSchema }, ["items", "page", "pageSize", "total"]),
  ClientFulfillment: objectOf(
    {
      orderId: stringSchema,
      orderNo: stringSchema,
      status: stringSchema,
      fulfillmentMode: stringSchema,
      fulfillmentLocationName: stringSchema,
      returnLocationName: stringSchema,
      startAt: { type: "string", format: "date-time" },
      endAt: { type: "string", format: "date-time" },
      effectiveEndAt: { type: "string", format: "date-time" },
      allocations: arrayOf(objectSchema)
    },
    ["orderId", "orderNo", "status", "fulfillmentMode", "fulfillmentLocationName", "startAt", "endAt", "allocations"]
  ),
  ClientNotificationList: objectOf(
    {
      items: arrayOf(objectSchema),
      page: numberSchema,
      pageSize: numberSchema,
      total: numberSchema
    },
    ["items", "page", "pageSize", "total"]
  ),
  ClientOrderExtensionRequest: objectOf(
    {
      newEndAt: { type: "string", format: "date-time" },
      services: arrayOf(objectSchema),
      memo: stringSchema
    },
    ["newEndAt"]
  ),
  ClientExtensionList: arrayOf(objectSchema),
  ClientExtensionPreview: objectSchema,
  ClientCancelOrderRequest: objectOf({ reason: stringSchema }, ["reason"]),
  ClientFunding: arrayOf(objectSchema),
  ClientPaymentSimulationRequest: objectOf(
    {
      instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
      action: { type: "string", enum: ["initiate", "append", "capture", "refund", "release", "fail"] },
      amount: numberSchema,
      reason: stringSchema,
      failureCode: stringSchema
    },
    ["instrument", "action", "reason"]
  ),
  ClientPaymentIntentRequest: objectOf(
    {
      instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
      method: { type: "string", enum: ["alipay", "wechat_pay"] },
      idempotencyKey: stringSchema
    },
    ["instrument", "method", "idempotencyKey"]
  ),
  ClientMiniProgramPaymentIntentRequest: objectOf(
    { instrument: { type: "string", enum: ["rental"] }, idempotencyKey: { type: "string", minLength: 1, maxLength: 191 } },
    ["instrument", "idempotencyKey"], false
  ),
  ClientWechatJsapiParameters: objectOf(
    { timeStamp: stringSchema, nonceStr: stringSchema, package: stringSchema, signType: { type: "string", enum: ["RSA"] }, paySign: stringSchema },
    ["timeStamp", "nonceStr", "package", "signType", "paySign"], false
  ),
  ClientPaymentIntentResponse: objectOf(
    {
      apiVersion: stringSchema,
      intentId: stringSchema,
      provider: stringSchema,
      method: stringSchema,
      instrument: stringSchema,
      amount: numberSchema,
      currency: stringSchema,
      status: stringSchema,
      checkoutUrl: stringSchema,
      jsapi: ref("ClientWechatJsapiParameters"),
      expiresAt: { type: "string", format: "date-time" },
      paidAt: { type: "string", format: "date-time" },
      message: stringSchema
    },
    ["apiVersion", "intentId", "provider", "method", "instrument", "amount", "currency", "status", "expiresAt"]
  ),
};

function backlogOperation(
  method: HttpMethod,
  path: string,
  tag: string,
  operationId: string,
  summary: string,
  permissions: string[] = [],
  authRequired = true,
  requestSchema?: string,
  responseSchema?: string,
  parameters?: ParameterObject[]
): ContractOperation {
  return {
    method,
    path,
    tag,
    operationId,
    summary,
    permissions,
    authRequired,
    requestSchema: requestSchema ?? (method === "get" || method === "delete" ? undefined : "GenericObject"),
    responseSchema: responseSchema ?? "GenericObject",
    parameters
  };
}

/** CLIENT-01 的字段级契约，不让移动端把 GenericObject 当成正式协议。 */
function clientOperation(
  method: HttpMethod,
  path: string,
  operationId: string,
  summary: string,
  options: { requestSchema?: string; responseSchema?: string | SchemaObject; authRequired?: boolean; parameters?: ParameterObject[]; rawResponseContentType?: string; rateLimited?: boolean; serviceUnavailableReason?: string } = {}
): ContractOperation {
  return {
    method,
    path,
    tag: "Client",
    operationId,
    summary,
    permissions: [],
    authRequired: options.authRequired ?? true,
    requestSchema: options.requestSchema,
    responseSchema: options.responseSchema ?? "GenericObject",
    parameters: options.parameters,
    rawResponseContentType: options.rawResponseContentType,
    rateLimited: options.rateLimited ?? true,
    serviceUnavailableReason: options.serviceUnavailableReason
  };
}

const TENANT_INTEGRATION_OPERATIONS: ContractOperation[] = [
  {
    method: "get",
    path: "/api/platform/integrations",
    tag: "Platform",
    operationId: "listTenantIntegrationConfigs",
    summary: "List tenant SMS, payment and file provider configurations",
    permissions: ["system:integration:manage"],
    responseSchema: "TenantIntegrationCatalogResponse"
  },
  {
    method: "put",
    path: "/api/platform/integrations/{capability}/{provider}",
    tag: "Platform",
    operationId: "saveTenantIntegrationConfig",
    summary: "Save one tenant provider configuration",
    permissions: ["system:integration:manage"],
    requestSchema: "SaveTenantIntegrationRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "post",
    path: "/api/platform/integrations/{capability}/{provider}/test",
    tag: "Platform",
    operationId: "testTenantIntegrationConfig",
    summary: "Validate one tenant provider configuration",
    permissions: ["system:integration:manage"],
    responseSchema: "TenantIntegrationTestResult"
  }
];

const INTEGRATION_BACKLOG_OPERATIONS: ContractOperation[] = [
  backlogOperation("get", "/api/files", "Files", "listFileAssets", "List file assets", ["system:integration:manage"]),
  backlogOperation("post", "/api/files", "Files", "createFileAsset", "Create file asset", ["system:integration:manage"]),
  backlogOperation("post", "/api/files/upload-sessions", "Files", "createFileUploadSession", "Create a tenant-scoped presigned upload session", ["system:integration:manage"], true, "CreateFileUploadSessionRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/upload-sessions/{id}/complete", "Files", "completeFileUpload", "Confirm a presigned upload and activate its file metadata", ["system:integration:manage"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("post", "/api/files/customer-identity/{customerId}/upload-sessions", "Files", "createCustomerIdentityUploadSession", "Create a customer identity evidence upload session bound to the tenant customer", ["rental-os:member:manage", "rental-os:customer:reveal-sensitive"], true, "CreateCustomerIdentityUploadRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/customer-identity/{customerId}/upload-sessions/{id}/complete", "Files", "completeCustomerIdentityUpload", "Complete a customer identity evidence upload bound to the same customer and uploader", ["rental-os:member:manage", "rental-os:customer:reveal-sensitive"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("get", "/api/files/customer-identity/{customerId}/{fileAssetId}/download-url", "Files", "customerIdentityDownloadUrl", "Create a short-lived customer identity evidence URL; also requires sensitive-data reveal and member-view permissions", ["rental-os:member:view", "rental-os:customer:reveal-sensitive"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("post", "/api/files/rental-orders/{orderId}/carrier-evidence/upload-sessions", "Files", "createCarrierEvidenceUploadSession", "Create an order/workspace-bound carrier shipment evidence upload session", ["rental-os:order:operate"], true, "CreateCarrierEvidenceUploadRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/files/rental-orders/{orderId}/carrier-evidence/upload-sessions/{id}/complete", "Files", "completeCarrierEvidenceUpload", "Complete a carrier evidence upload for the same carrier-shipping order", ["rental-os:order:operate"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("get", "/api/files/rental-orders/{orderId}/carrier-evidence/{fileAssetId}/download-url", "Files", "carrierEvidenceDownloadUrl", "Create a short-lived download URL for evidence attached to the current carrier-shipping order", ["rental-os:order:view"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("post", "/api/files/upload-sessions/cleanup-expired", "Files", "cleanupExpiredFileUploads", "Invalidate expired upload sessions and clean their provider objects", ["system:integration:manage"], true, undefined, "FileUploadCleanupSummary"),
  backlogOperation("get", "/api/files/{id}/download-url", "Files", "getFileDownloadUrl", "Create a short-lived tenant-scoped download URL", ["system:integration:manage"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("get", "/api/integrations/adapter-logs", "Integrations", "listAdapterLogs", "List adapter logs", ["system:integrations:manage"]),
  backlogOperation("post", "/api/integrations/adapters/mock-call", "Integrations", "invokeMockAdapter", "Invoke mock adapter", ["system:integrations:manage"]),
  backlogOperation("get", "/api/integrations/data-exchange/templates", "Integrations", "listDataExchangeTemplates", "List data exchange templates", ["system:integrations:manage"]),
  backlogOperation("post", "/api/integrations/data-exchange/jobs", "Integrations", "createDataExchangeJob", "Create data exchange job", ["system:integrations:manage"]),
  backlogOperation("get", "/api/integrations/dashboard", "Integrations", "getInfraDashboard", "Get integrations dashboard", ["system:integrations:manage"]),
  backlogOperation("get", "/api/integrations/tbox-devices", "Integrations", "listIntegrationTboxDevices", "List integration TBox devices", ["system:integrations:manage"]),
  backlogOperation("post", "/api/integrations/tbox-devices", "Integrations", "saveIntegrationTboxDevice", "Save integration TBox device", ["system:integrations:manage"]),
  backlogOperation("put", "/api/integrations/tbox-devices/{id}", "Integrations", "updateIntegrationTboxDevice", "Update integration TBox device", ["system:integrations:manage"]),
  backlogOperation("post", "/api/integrations/tbox-devices/{id}/bind", "Integrations", "bindIntegrationTboxDevice", "Bind integration TBox device", ["system:integrations:manage"]),
  backlogOperation("get", "/api/jobs", "Jobs", "listAsyncJobs", "List async jobs", ["system:jobs:manage"]),
  backlogOperation("post", "/api/jobs", "Jobs", "createAsyncJob", "Create async job", ["system:jobs:manage"]),
  backlogOperation("post", "/api/jobs/{id}/run", "Jobs", "runAsyncJob", "Run async job", ["system:jobs:manage"]),
  backlogOperation("get", "/api/jobs/print", "Jobs", "listPrintJobs", "List print jobs", ["system:jobs:manage"]),
  backlogOperation("post", "/api/jobs/print", "Jobs", "createPrintJob", "Create print job", ["system:jobs:manage"]),
  backlogOperation("post", "/api/jobs/run-due", "Jobs", "runDueJobs", "Run due jobs", ["system:jobs:manage"]),
  backlogOperation("get", "/api/notifications/logs", "Notifications", "listNotificationLogs", "List notification logs", ["system:notifications:manage"]),
  backlogOperation("post", "/api/notifications/send", "Notifications", "sendNotification", "Send notification", ["system:notifications:manage"]),
  backlogOperation("get", "/api/notifications/templates", "Notifications", "listNotificationTemplates", "List notification templates", ["system:notifications:manage"]),
  // MP-01：租户微信小程序渠道（AppID/AppSecret、品牌、协议、发布空间）。AppSecret 只写不读。
  backlogOperation("get", "/api/platform/mini-program-channel", "Platform", "getMiniProgramChannel", "Get the tenant mini-program channel configuration (secret never returned)", ["system:integration:manage"], true, undefined, "MiniProgramChannelSummary"),
  backlogOperation("put", "/api/platform/mini-program-channel", "Platform", "saveMiniProgramChannel", "Save the tenant mini-program channel configuration", ["system:integration:manage"], true, "SaveMiniProgramChannelRequest", "MiniProgramChannelSummary"),
  backlogOperation("post", "/api/platform/mini-program-channel/test", "Platform", "testMiniProgramChannel", "Verify the mini-program AppID/AppSecret by fetching an access token only", ["system:integration:manage"], true, undefined, "MiniProgramChannelTestResult"),
  backlogOperation("get", "/api/platform/client-channel", "Platform", "getClientChannelProfile", "Get the tenant-level client channel profile (brand, service, agreements, help, published services) shared by mini-program and app", ["system:integration:manage"], true, undefined, "ClientChannelProfileSummary"),
  backlogOperation("put", "/api/platform/client-channel", "Platform", "saveClientChannelProfile", "Save the tenant-level client channel profile with optimistic revision check", ["system:integration:manage"], true, "SaveClientChannelProfileRequest", "ClientChannelProfileSummary"),
  // APPEARANCE-01：租户级「品牌与外观」（管理后台 UI 身份：品牌标识/主题色/圆角），从客户端渠道拆出的独立领域。
  backlogOperation("get", "/api/platform/appearance", "Platform", "getTenantAppearance", "Get the tenant-level brand & appearance profile (brand identity, theme color, corner radii)", ["system:integration:manage"], true, undefined, "TenantAppearanceProfile"),
  backlogOperation("put", "/api/platform/appearance", "Platform", "saveTenantAppearance", "Save the tenant-level brand & appearance profile with optimistic revision check", ["system:integration:manage"], true, "SaveTenantAppearanceRequest", "TenantAppearanceProfile"),
  // 账户级外观自助：登录账户本人的管理后台主题色，跟随账户、与租户品牌色相互独立；任何已登录账号读写自己的（无业务权限）。
  backlogOperation("get", "/api/platform/account-appearance", "Platform", "getAccountAppearance", "Get the signed-in account's admin theme color (follows the account, independent of the tenant brand color)", [], true, undefined, "AccountAppearanceProfile"),
  backlogOperation("put", "/api/platform/account-appearance", "Platform", "saveAccountAppearance", "Save the signed-in account's admin theme color", [], true, "SaveAccountAppearanceRequest", "AccountAppearanceProfile"),
  // WEBSITE-CHANNEL-01：租户级 web 官网渠道配置（官网特有设定项：标语、Hero、辅助色、页脚、CTA、SEO）。
  backlogOperation("get", "/api/platform/website-channel", "Platform", "getWebsiteChannelProfile", "Get the tenant-level website channel profile (website-only settings: slogan, hero, secondary color, footer, CTA, SEO)", ["system:integration:manage"], true, undefined, "WebsiteChannelProfileSummary"),
  backlogOperation("put", "/api/platform/website-channel", "Platform", "saveWebsiteChannelProfile", "Save the tenant-level website channel profile with optimistic revision check", ["system:integration:manage"], true, "SaveWebsiteChannelProfileRequest", "WebsiteChannelProfileSummary"),
  backlogOperation("post", "/api/platform/website-channel/assets", "Platform", "uploadWebsiteAsset", "Upload a website brand image (logo/hero/category) and get its public URL", ["system:integration:manage"], true, "GenericObject", "GenericObject"),
  // SPACE-01：经营空间主档与成员关系的最小管理面。
  // 刻意没有"切换当前空间"操作——会话空间上下文属 SPACE-02。
  backlogOperation("get", "/api/platform/workspaces", "Platform", "listBusinessWorkspaces", "List business workspaces", ["system:org:manage"]),
  backlogOperation("post", "/api/platform/workspaces", "Platform", "createBusinessWorkspace", "Create business workspace", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}", "Platform", "updateBusinessWorkspace", "Update business workspace", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/workspaces/{id}/members", "Platform", "listWorkspaceMembers", "List workspace members", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/workspaces/{id}/fulfillment-locations", "Platform", "listWorkspaceFulfillmentLocations", "List fulfillment locations assignable to a workspace staff member", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}/members", "Platform", "saveWorkspaceMember", "Save workspace member", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/tenants/{id}/workspaces", "Platform", "listTenantBusinessWorkspaces", "List target tenant business workspaces", ["system:tenant:manage"]),
  backlogOperation("post", "/api/platform/tenants/{id}/workspaces", "Platform", "createTenantBusinessWorkspace", "Create target tenant business workspace", ["system:tenant:manage"]),
  backlogOperation("put", "/api/platform/tenants/{id}/workspaces/{workspaceId}", "Platform", "updateTenantBusinessWorkspace", "Update target tenant business workspace", ["system:tenant:manage"]),
  backlogOperation("get", "/api/platform/customers", "Platform", "listSharedCustomers", "List tenant shared customers", ["rental-os:member:view"]),
  backlogOperation("post", "/api/platform/customers", "Platform", "registerSharedCustomer", "Register a tenant member using the shared review policy", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}", "Platform", "getCustomerDetail", "Get customer detail with masked sensitive fields", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/profile", "Platform", "getCustomerProfileOverview", "Get the categorized customer profile overview including addresses, qualifications, benefits and order summaries", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/identity-verifications", "Platform", "customerIdentityVerifications", "List append-only customer identity verification records; requires member-view and sensitive-data reveal permissions", ["rental-os:customer:reveal-sensitive"], true, undefined, "CustomerIdentityVerificationList"),
  backlogOperation("post", "/api/platform/customers/{customerId}/identity-verifications", "Platform", "saveCustomerIdentityVerification", "Record an identity verification decision with tenant/customer-bound evidence and reviewer attribution; requires member-manage and sensitive-data reveal permissions", ["rental-os:member:manage"], true, "SaveCustomerIdentityVerificationRequest", "CustomerIdentityVerificationSummary"),
  backlogOperation("put", "/api/platform/customers/{customerId}/addresses", "Platform", "saveCustomerProfileAddress", "Create or update a customer delivery address; the response keeps the phone masked", ["rental-os:member:manage"]),
  backlogOperation("delete", "/api/platform/customers/{customerId}/addresses/{addressId}", "Platform", "removeCustomerProfileAddress", "Soft-delete a customer delivery address", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/account", "Platform", "ensureCustomerAccount", "Open a login account for the customer (idempotent)", ["rental-os:member:manage"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/account-status", "Platform", "changeCustomerAccountStatus", "Change customer account status; close requires customer:close, other states require member:manage", ["rental-os:member:manage", "rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/status-history", "Platform", "listCustomerStatusHistory", "List customer status timeline (account and workspace scope)", ["rental-os:member:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/sensitive-access", "Platform", "listCustomerSensitiveAccess", "List sensitive data access audit for the customer", ["rental-os:customer:reveal-sensitive"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/membership-status", "Platform", "changeCustomerMembershipStatus", "Change workspace membership status; close and risk restriction use separate permissions", ["rental-os:member:manage", "rental-os:member:risk-action", "rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/risk-records", "Platform", "listCustomerRiskRecords", "List tenant-wide and current-workspace customer risk records", ["rental-os:member:view", "rental-os:member:risk-action"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/risk-records", "Platform", "createCustomerRiskRecord", "Create an auditable workspace or tenant risk record under the customer gate lock", ["rental-os:member:risk-action"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/risk-records/{riskRecordId}/decision", "Platform", "reviewCustomerRiskRecord", "Move an open risk into review or close it with a required outcome", ["rental-os:member:risk-action"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/transactability", "Platform", "getCustomerTransactability", "Check whether the customer may start new business in the current workspace", ["rental-os:member:view"]),
  // CUSTOMER-01C：企业开票资料、合同、授信账期。按租户级客户身份维护，不按空间隔离——
  // 同一家企业在两个空间是同一家企业，开票与合同不该各存一份。
  backlogOperation("get", "/api/platform/customers/{customerId}/invoice-profiles", "Platform", "listCustomerInvoiceProfiles", "List corporate invoice profiles", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/invoice-profiles", "Platform", "saveCustomerInvoiceProfile", "Create or update a corporate invoice profile", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/contracts", "Platform", "listCustomerContracts", "List corporate contracts", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/contracts", "Platform", "saveCustomerContract", "Create or update a corporate contract", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit", "Platform", "getCustomerCredit", "Get corporate credit limit and settlement terms", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/platform/customers/{customerId}/credit", "Platform", "saveCustomerCredit", "Set corporate credit limit and settlement terms", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit/account", "Platform", "getCustomerCreditAccount", "Read the current corporate credit reserve and receivable summary", ["rental-os:corporate:view"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/credit/ledger", "Platform", "listCustomerCreditLedger", "Read the append-only corporate credit ledger", ["rental-os:corporate:view"]),
  backlogOperation("post", "/api/platform/customers/{customerId}/credit/payments", "Platform", "recordCustomerCreditPayment", "Record an idempotent corporate credit payment", ["rental-os:corporate:manage"]),
  // CUSTOMER-01D：重复识别、人工合并与注销。需求 4.8.14 要求合并与注销**分别授权**——
  // 两者都不可逆且影响面不同（合并改身份归属、注销终止业务资格），共用「会员管理」
  // 等于让任何能改会员等级的人都能合并或注销客户。
  // 候选与预览虽是只读，但暴露「哪些主档可能是同一人」，属合并决策信息，同按合并权限。
  backlogOperation("get", "/api/platform/customers/{customerId}/duplicates", "Platform", "findCustomerDuplicates", "List possible duplicate customers within the tenant", ["rental-os:customer:merge"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/merge-preview", "Platform", "previewCustomerMerge", "Preview a manual customer merge (read-only conflict report)", ["rental-os:customer:merge"]),
  backlogOperation("post", "/api/platform/customers/merge", "Platform", "mergeCustomers", "Submit a manual customer merge (keeps original business references)", ["rental-os:customer:merge"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/closability", "Platform", "getCustomerClosability", "Check whether the customer account may be closed", ["rental-os:customer:close"]),
  backlogOperation("get", "/api/platform/customers/{customerId}/membership-closability", "Platform", "getCustomerMembershipClosability", "Check whether the current-workspace membership may be closed", ["rental-os:customer:close"]),
  backlogOperation("get", "/api/membership/qualification-options", "Membership", "listMembershipQualificationOptions", "Read current workspace qualification choices for tenant member submissions", ["rental-os:member:view", "rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal-options", "Membership", "listPersonalMembershipOptions", "List active tenant members with minimal fields for employee selection", ["rental-os:member:view", "rental-os:corporate:employee-manage"]),
  backlogOperation("get", "/api/membership/benefit-scope-options", "Membership", "membershipBenefitScopeOptions", "List tenant workspace and category identifiers for membership benefits", ["rental-os:member:view", "rental-os:member:plan:manage"]),
  backlogOperation("get", "/api/rental/v1/booking-members", "RentalCore", "listBookingMembers", "List minimal tenant member summaries for authorized order creation", ["rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/booking-members/{customerId}/booking-options", "RentalCore", "listBookingMemberOptions", "List tenant corporate identities available in the current workspace booking", ["rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/booking-members/{customerId}/delivery-addresses", "RentalCore", "listBookingMemberDeliveryAddresses", "List a member's saved delivery addresses for authorized delivery-order creation", ["rental-os:order:create"]),
  backlogOperation("get", "/api/membership/registration-settings", "Membership", "getMembershipRegistrationSettings", "Get tenant registration review mode", ["rental-os:member:view"]),
  backlogOperation("put", "/api/membership/registration-settings", "Membership", "saveMembershipRegistrationSettings", "Set current workspace registration review mode", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal", "Membership", "listPersonalMembershipMembers", "List personal members in current workspace", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/personal", "Membership", "registerPersonalMembership", "Create or register a personal member in current workspace", ["rental-os:member:manage"]),
  backlogOperation("put", "/api/membership/personal/{customerId}", "Membership", "savePersonalMembership", "Edit a personal member profile in current workspace", ["rental-os:member:manage"]),
  backlogOperation("put", "/api/membership/personal/{customerId}/temporary-password", "Membership", "setMembershipTemporaryPassword", "Set a one-time temporary password without exposing stored credentials", ["rental-os:member:account-manage"]),
  backlogOperation("post", "/api/membership/personal/{customerId}/qualifications", "Membership", "submitMembershipQualification", "Submit a personal member qualification for separate review", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/qualification-history", "Membership", "listMembershipQualificationHistory", "List immutable qualification submission and review snapshots", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/benefits", "Membership", "resolveMembershipBenefits", "Resolve current personal and explicitly selected corporate membership benefits", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/personal/{customerId}/booking-options", "Membership", "listMembershipBookingOptions", "List active corporate employee relationships selectable for a personal member booking", ["rental-os:member:view"]),
  backlogOperation("get", "/api/membership/reviews", "Membership", "listMembershipReviews", "List registration and qualification review tasks", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/reviews/{reviewId}/decision", "Membership", "decideMembershipReview", "Approve, reject, request supplement, or cancel a membership review", ["rental-os:member:review", "rental-os:member:qualification-review"]),
  backlogOperation("get", "/api/membership/qualification-types", "Membership", "listMembershipQualificationTypes", "List current workspace dynamic qualification types", ["rental-os:member:view"]),
  backlogOperation("put", "/api/membership/qualification-types", "Membership", "saveMembershipQualificationType", "Create or update a current workspace qualification type", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/membership/corporate", "Membership", "listCorporateMembershipMembers", "List enterprise members in current workspace", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/membership/corporate", "Membership", "saveCorporateMembership", "Create or edit an enterprise member profile in current workspace", ["rental-os:corporate:manage"]),
  backlogOperation("get", "/api/membership/corporate/{corporateCustomerId}/employees", "Membership", "listCorporateMembershipEmployees", "List enterprise administrators and employees", ["rental-os:corporate:view"]),
  backlogOperation("put", "/api/membership/corporate/{corporateCustomerId}/employees", "Membership", "saveCorporateMembershipEmployee", "Create or update an enterprise administrator or employee relation", ["rental-os:corporate:employee-manage"]),
  backlogOperation("get", "/api/membership/plans", "Membership", "listCustomerMembershipPlans", "List current workspace membership plans and versions", ["rental-os:member:view"]),
  backlogOperation("put", "/api/membership/plans", "Membership", "saveCustomerMembershipPlan", "Create or update a membership plan draft", ["rental-os:member:plan:manage"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/publish", "Membership", "publishCustomerMembershipPlan", "Publish an immutable membership plan version", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/disable", "Membership", "disableCustomerMembershipPlanVersion", "Disable a published membership plan version with an audit reason", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/{planId}/versions/{versionId}/restore", "Membership", "restoreCustomerMembershipPlanVersion", "Create a draft from a historical membership plan version", ["rental-os:member:plan:publish"]),
  backlogOperation("post", "/api/membership/plans/assignments", "Membership", "assignCustomerMembershipPlan", "Grant a published personal or corporate membership plan", ["rental-os:member:plan:manage"]),
  backlogOperation("get", "/api/membership/plans/assignments/{customerId}", "Membership", "listCustomerMembershipPlanAssignments", "List membership plan grants for a customer in the current workspace", ["rental-os:member:view"]),
  backlogOperation("post", "/api/membership/plans/assignments/{assignmentId}/revoke", "Membership", "revokeCustomerMembershipPlanAssignment", "Revoke an active membership plan grant with an audit reason", ["rental-os:member:plan:manage"]),
  backlogOperation("post", "/api/platform/organizations", "Platform", "createOrganization", "Create organization", ["system:org:manage"]),  backlogOperation("put", "/api/platform/organizations/{id}", "Platform", "updateOrganization", "Update organization", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/organizations/{id}/status", "Platform", "setOrganizationStatus", "Set organization status", ["system:org:manage"]),
];

export const API_CONTRACT_OPERATIONS: ContractOperation[] = [
  { method: 'post', path: '/api/ai-native/privacy/cleanup', tag: 'AI Native', operationId: 'cleanupAiRetention',
    permissions: ['system:params:manage'], authRequired: true,
    summary: 'Explicit bounded retention cleanup. Requires current full-workspace operator scope; unknown effects and original business receipts are held. No timer or automatic retry.',
    requestSchema: { type: 'object', additionalProperties: false, required: ['kind'], properties: {
      kind: { type: 'string', enum: ['task', 'request', 'knowledge', 'memory', 'material', 'attachment'] },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      after: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } } } },
  { method: 'post', path: '/api/ai-native/privacy/receipt', tag: 'AI Native', operationId: 'readAiRetentionReceipt',
    permissions: ['system:params:manage'], authRequired: true, summary: 'Observe only an owned original cleanup receipt; does not resend an unknown object deletion.',
    requestSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } },
  { method: 'post', path: '/api/ai-native/privacy/receipts', tag: 'AI Native', operationId: 'listAiRetentionReceipts',
    permissions: ['system:params:manage'], authRequired: true, summary: 'Bounded current-workspace receipt observation after an ambiguous batch reply.',
    requestSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 50 }, before: { type: 'string', format: 'date-time' } } } },
  ...([AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath, AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath]
    .flatMap((base, surface) => ([
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities, 'AiClientHostCapabilitiesRequest', 'AiClientHostCapabilities'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial, 'AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt, 'AiClientOrderMaterialRequest', 'AiClientOrderMaterialReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, 'AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation, 'AiClientTaskReadRequest', 'AiClientTaskCreationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult, 'AiClientTaskReadRequest', 'AiClientTaskModelResultReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput, 'AiClientTaskReadRequest', 'AiClientTaskInputReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput, 'AiClientTaskInputSubmissionRequest', 'AiClientTaskInputSubmissionReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, 'AiClientTaskInputSubmissionRequest', 'AiClientTaskInputReceiptReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput, 'AiClientTaskInputSubmissionRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel, 'AiClientTaskReadRequest', 'AiClientTaskModelControlResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationReceipt, 'AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCancellationSettlementReceipt, 'AiClientTaskCancelRequest', 'AiClientTaskCancellationObservation'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.settleTaskUnstartedCancellation, 'AiClientTaskCancelRequest', 'AiClientTaskUnstartedCancellationReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskAccounting, 'AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskAccounting, 'AiClientTaskAccountingRequest', 'AiClientTaskAccountingResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingAcceptance, 'AiBookingAcceptanceReadRequest', 'AiBookingAcceptanceReadResponse'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission, 'AiBookingSubmissionAcceptanceRequest', 'AiBookingSubmissionAcceptance'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking, 'AiBookingSubmissionDecision', 'AiBookingSubmissionReceipt'],
      [AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission, 'AiBookingSubmissionSelection', 'AiBookingSubmissionReceipt'],
    ] as const).map(([route, requestSchema, responseSchema]) => clientOperation('post', `/api/${base}/${route}`,
      `clientAi_${surface}_${route.replace(/\//gu, '_')}`,
      'Current independent customer identity and persisted surface/scene policy required. Observation does not grant execution; only an explicit original-page decision submits through Core. Unknown uses the same original receipt, never automatic resubmission.',
      { requestSchema, responseSchema })))),
  ...(['detail', 'create', 'patch', 'validate', 'review'] as const).map(operation => ({
    method: 'post' as const, path: `/api/ai-native/category-drafts/${operation}`, tag: 'AI Native',
    operationId: `aiCategoryDraft_${operation}`, permissions: [operation === 'create' || operation === 'patch'
      ? 'system:rental-category:edit' : 'system:rental-category:view'],
    summary: 'Human draft preparation through original platform CAT-GOV permissions, preview gate and DTO/CAS. New work is server-disabled by default; publication and adoption are unavailable. Unknown draft writes require manual original-state review, not automatic retry. Payload remains the existing internal draft adapter, not a new public governance contract.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  { method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/history-read', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionHistory', permissions: ['rental-os:order:view'],
    summary: 'Read bounded owned historical inspection draft references under current staff/order/location authorization; no media access or execution.',
    requestSchema: 'AiStaffInspectionHistoryRequest', responseSchema: 'AiStaffInspectionHistoryResponse' },
  ...(['read', 'change', 'operation', 'readModelPlan', 'changeModelPlan'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT.basePath}/${AI_CLIENT_TASK_POLICY_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `manageClientTaskPolicy_${operation}`, permissions: ['system:params:manage'],
    summary: 'Server-opt-in operator management of the existing quote-clarification customer policy and text plan. Current workspace/identity and original CAS/audit are mandatory; no customer scope/scene/tool overrides. Changes do not grant model capabilities, budget or booking approval. Unknown policy writes use their original operation key; plan uncertainty requires observing the original plan, not blind retry.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  ...(['create', 'readCreation', 'start', 'reconcile', 'requestCancel', 'readInput', 'resume', 'readAnswer', 'continueAnswer'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: ['readCreation', 'requestCancel', 'readAnswer'].includes(operation)
      ? 'Original owned staff task metadata, exact cancellation revision or exact human-answer receipt. Current order/resource and task action policies remain required independently of NEW recognition configuration, profile or draft expiry. Receipts do not resume execution, reopen attachment bytes, release budget or attest remote rollback. Unknown is observed only by the original key. Draft payload remains GenericObject.'
      : 'Server opt-in candidate recognition only: original owner/order/stage/attachment, current policies, entitlement, capabilities and single Gateway ledger remain required. Creation is not dispatch; unknown uses original evidence. Draft payload remains GenericObject, not a frozen complete response schema.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  { method: 'post', path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.readCancelReceipt}`, tag: 'AI Native',
    operationId: 'staffRecognition_readCancelReceipt', permissions: ['rental-os:order:view'],
    summary: 'Read the exact original task cancellation revision under CURRENT staff owner/resource/read policies, independently of NEW recognition enablement. Observation never cancels a provider, releases budget, retries execution or proves rollback. Not observed is not proof of an uncommitted write.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject' },
  ...(['settleUnstartedCancellation', 'settleReleasedInputCancellation', 'readCancellationSettlementReceipt'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Original owned staff task cancellation settlement/receipt, not provider cancellation or business rollback. Current resource and task action policies required. The original task transaction must prove either never-started work without execution evidence, or a released input wait with persisted measured model result and all four recorded resource charges. Running/unknown/unmeasured work is refused; expiry is not proof. No refund, new run or model dispatch; lost acknowledgement is observed by the original revision only.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  ...(['readAccounting', 'reconcileAccounting'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT.basePath}/${AI_INSPECTION_RECOGNITION_TASK_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `staffRecognition_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Current same-staff task read policy and original invocation/usage only. Available independently of NEW recognition enablement, profile, input freshness or file storage. Does not dispatch, reserve, submit an inspection or prove business payment; unknown is observed by the original call key.',
    requestSchema: 'AiStaffTaskAccountingRequest', responseSchema: 'AiTaskAccountingObservation'
  })),
  ...(['read', 'configure', 'clear'] as const).map(operation => ({
    method: 'post' as const, path: `/api/${AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT.basePath}/${AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT[operation]}`, tag: 'AI Native',
    operationId: `staffRecognitionPolicy_${operation}`, permissions: ['rental-os:order:view'],
    summary: 'Human CAS policy management for the original owned inspection candidate task only. Stage authority and current server plan bound every operation. Not approval, Core submission or platform policy management.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  { method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/receipt-host-read', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionReceiptHost', permissions: ['rental-os:order:view'],
    summary: 'Open an explicitly selected original historical receipt host. Does not authorize recognition or original inspection submission.',
    requestSchema: 'AiStaffInspectionReceiptHostRequest', responseSchema: 'AiStaffInspectionReceiptHostProjection' },
  { method: 'post', path: '/api/staff/v1/ai-native/inspection-assist/result-save-receipt', tag: 'AI Native',
    operationId: 'readOwnedStaffInspectionRecognitionSaveReceipt', permissions: ['rental-os:order:view'],
    summary: 'Observe only the exact saved recognition association under current owner/order/location authority. Missing evidence is not permission to retry a write.',
    requestSchema: AI_LEAF_COMPONENT_SCHEMAS.AiStaffInspectionReceiptHostRequest.properties!.recognitionSave,
    responseSchema: 'GenericObject' },
  ...(['host-read', 'template-read', 'draft-create', 'draft-read', 'draft-edit', 'evidence-bind',
    'evidence-fingerprint', 'evidence-replace', 'draft-operation', 'input-prepare', 'input-receipt', 'result-read', 'result-save', 'submission-review',
    'submission-prepare', 'submission-preparation', 'submission-submit', 'submission-read'] as const).map(operation => ({
    method: 'post' as const, path: `/api/staff/v1/ai-native/inspection-assist/${operation}`, tag: 'AI Native',
    operationId: `staffInspection_${operation.replace(/-/gu, '_')}`, permissions: ['rental-os:order:view'],
    summary: 'Original staff/order/location and stage action authorization is rechecked. Manual work and recognition require separate server opt-ins; exact original receipts remain readable. Recognition results are candidate evidence only, not field adoption or Core submission. An unknown write is observed by its original key, never automatically resent. Wire payload remains the existing draft; GenericObject does not certify full schema coverage.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject'
  })),
  { method: 'post', path: '/api/ai-native/scene-requests', tag: 'AI Native', operationId: 'createOriginalOrderFactsRequest',
    summary: 'Prepare an owner-bound order explanation request; requires persisted enabled scene policy and AI entitlement. Creates metadata only, no model, execution or business write. Preparation is bounded and disconnect closes request credentials; a write acknowledgement timeout is unknown and must be observed by the same original request key, never recreated.',
    permissions: ['rental-os:order:view'], requestSchema: 'AiSceneRequestCreateDraft' },
  ...([
    ['observeUpload', 'ObserveUploadRequestDraft', 'ObserveUploadResponseDraft'],
    ['observeRevisionUpload', 'ObserveRevisionUploadRequestDraft', 'ObserveUploadResponseDraft'],
    ['findOriginalUpload', 'FindOriginalUploadRequestDraft', 'FindOriginalUploadResponseDraft'],
    ['findOriginalRevisionUpload', 'FindOriginalRevisionUploadRequestDraft', 'FindOriginalUploadResponseDraft'],
    ['beginUpload', 'BeginUploadRequestDraft', 'BeginUploadResponseDraft'], ['completeUpload', 'CompleteUploadRequestDraft', 'CompleteUploadResponseDraft'],
    ['beginRevisionUpload', 'BeginRevisionUploadRequestDraft', 'BeginRevisionUploadResponseDraft'],
    ['completeRevisionUpload', 'CompleteRevisionUploadRequestDraft', 'CompleteRevisionUploadResponseDraft'],
    ['prepareCreate', 'PrepareRequestDraft', 'PrepareResponseDraft'], ['create', 'CreateRequestDraft', 'CommandResponseDraft'],
    ['parse', 'ParseRequestDraft', 'CommandResponseDraft'], ['reconcileParse', 'ReconcileParseRequestDraft', 'CommandResponseDraft'],
    ['revise', 'ReviseRequestDraft', 'CommandResponseDraft'], ['publish', 'PublishRequestDraft', 'CommandResponseDraft'],
    ['withdraw', 'WithdrawRequestDraft', 'CommandResponseDraft'], ['delete', 'DeleteRequestDraft', 'CommandResponseDraft'],
    ['operationStatus', 'OperationRequestDraft', 'OperationResponseDraft'],
    ['indexRead', 'IndexReadRequestDraft', 'IndexReadResponseDraft'], ['indexRequest', 'IndexRequestDraft', 'IndexMutationResponseDraft'],
    ['indexResume', 'IndexResumeRequestDraft', 'IndexMutationResponseDraft'], ['indexOperationRead', 'IndexOperationRequestDraft', 'IndexOperationResponseDraft']
  ] as const).map(([action, request, response]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageCurrentAiKnowledge_${action}`, permissions: ['system:params:manage'],
    summary: 'Current operator and exact persisted document/upload action policy, ACL, version and original file integration required. No ambient file grants or model call. Human confirmation is action-specific; upload, document commit and publication are separate facts. Unknown writes require original operation observation.',
    requestSchema: `AiKnowledgeManagement${request}`, responseSchema: `AiKnowledgeManagement${response}` })),
  ...([
    ['readDocument', 'AiKnowledgeDocumentReadRequestDraft', 'AiKnowledgeDocumentReadResponseDraft'],
    ['openSource', 'AiKnowledgeSourceReadRequestDraft', 'AiKnowledgeSourceReadResponseDraft'],
    ['readMemory', 'AiKnowledgeMemoryReadRequestDraft', 'AiKnowledgeMemoryReadResponseDraft'],
    ['readPreferences', 'AiKnowledgePreferencesReadRequestDraft', 'AiKnowledgePreferencesReadResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_CONSUMPTION_HTTP_DRAFT[action]}`, tag: 'AI Native',
      operationId: `readCurrentAiKnowledge_${action}`, permissions: ['system:params:manage'],
      summary: 'Existing operator management entry permission plus exact persisted knowledge/memory action policy and original document/version/file ACL are required; management permission alone grants no resource access. Confirmed owner preferences only. Bounded read-only request, no model, task, write, download URL or business authority.',
    requestSchema, responseSchema })),
  ...([
    ['list', 'ListRequestDraft', 'ListResponseDraft'], ['state', 'StateRequestDraft', 'StateDraft'],
    ['read', 'ReadRequestDraft', 'MutationDraft'], ['propose', 'ProposeRequestDraft', 'MutationDraft'],
    ['confirm', 'ConfirmRequestDraft', 'MutationDraft'], ['resumeConfirmation', 'ConfirmRequestDraft', 'MutationDraft'],
    ['confirmation', 'ConfirmationRequestDraft', 'ConfirmationResponseDraft'], ['change', 'ChangeRequestDraft', 'MutationDraft'],
    ['changeStatus', 'ChangeStatusRequestDraft', 'ChangeStatusResponseDraft'], ['revoke', 'RevokeRequestDraft', 'RevokeResponseDraft'],
    ['operation', 'OperationRequestDraft', 'OperationResponseDraft']
  ] as const).map(([action, request, response]) => ({ method: 'post' as const,
    path: `/api/${AI_MEMORY_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_MEMORY_MANAGEMENT_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageOwnedAiMemory_${action}`, permissions: ['system:params:manage'],
    summary: 'Current human owner and persisted action policy required. Explicit consent is not business approval. Bounded request; uncertain writes must use the original memory operation, never automatic retry.',
    requestSchema: `AiMemoryManagement${request}`, responseSchema: `AiMemoryManagement${response}` })),
  ...([
    ['prepareTarget', 'AiKnowledgeTargetSelectionDraft', 'GenericObject'],
    ['target', 'AiKnowledgeTargetReadDraft', 'GenericObject'], ['bindTarget', 'AiKnowledgeTargetBindDraft', 'GenericObject'],
    ['read', 'AiKnowledgeTargetSelectionDraft', 'GenericObject'],
    ['prepare', 'AiKnowledgePolicyChangeDraft', 'AiKnowledgePolicyPrepareHttpResponseDraft'],
    ['preparation', 'AiKnowledgePolicyPreparationSelectionDraft', 'AiKnowledgePolicyReviewHttpResponseDraft'],
    ['commit', 'AiKnowledgePolicyCommitDraft', 'AiKnowledgePolicyCommitHttpResponseDraft'],
    ['operation', 'AiKnowledgePolicyReceiptSelectionDraft', 'AiKnowledgePolicyOperationHttpResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `manageCurrentAiKnowledgePolicy_${action}`, permissions: ['system:params:manage'],
    summary: 'Current tenant manager plus persisted exact management authority, participants and resource basis required. No default root/policy, file access, model execution or business approval is created. Unknown writes require original operation observation.',
    requestSchema, responseSchema })),
  { method: 'get', path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}`, tag: 'AI Native',
    operationId: 'listPlatformAiModelConfigurations', permissions: ['system:ai-provider:view'],
    summary: 'Current SaaS viewer only. Keyset page of at most 50 platform-owned configuration metadata records; no credentials, base URLs, capability proof or execution grant.',
    parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50 } },
      { name: 'after', in: 'query', required: false, schema: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][\\w.:-]{0,35}$' } }],
    responseSchema: 'AiPlatformModelDirectoryDraft' },
  { method: 'get', path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}`, tag: 'AI Native',
    operationId: 'readPlatformAiModelConfiguration', permissions: ['system:ai-provider:view'],
    summary: 'Current explicitly authorized SaaS platform viewer. Masked current configuration, not an original save receipt, write permission or connection/capability proof.',
    responseSchema: 'AiPlatformModelSettingsSummaryDraft' },
  { method: 'put', path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}`, tag: 'AI Native',
    operationId: 'savePlatformAiModelConfiguration', permissions: ['system:ai-provider:manage'],
    summary: 'SaaS platform manager CAS + encrypted Vault/Profile transaction. Revision zero provisions only the first DEFAULT profile; no policy, capability evidence or budget is granted. Lost acknowledgement requires observing current configuration, never automatic retry.',
    requestSchema: 'AiPlatformModelSettingsInputDraft', responseSchema: 'AiPlatformModelSettingsSaveDraft' },
  { method: 'get', path: `/api/${AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT.basePath}/{profileId}/operations/{operationKey}`, tag: 'AI Native',
    operationId: 'readOriginalPlatformModelConfigurationSave', permissions: ['system:ai-provider:view'],
    summary: 'Current SaaS viewer and original actor only. Exact immutable save receipt, independent of later config rotations; missing is unknown, not rollback or permission to resend. No credential or execution grant.',
    responseSchema: 'AiModelConfigurationOperationDraft' },
  ...(['input', 'resumeInput', 'inputReceipt', 'continueInput'] as const).map(action => ({
    method: 'post' as const, path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `aiTaskCenterOriginalClarification_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: action === 'input' ? 'AiTaskClarificationQueryDraft' : action === 'inputReceipt'
      ? 'AiTaskClarificationReceiptRequestDraft' : action === 'continueInput' ? 'AiTaskClarificationContinueQueryDraft' : 'AiTaskClarificationAnswerDraft',
    responseSchema: action === 'input' ? 'AiTaskClarificationObservationDraft' : 'AiTaskClarificationProgressDraft',
    summary: action === 'input' || action === 'inputReceipt'
      ? 'Read same-owner original question or exact answer receipt under current task/source authority. No start, model call, approval or automatic retry.'
      : 'Explicit original answer/continuation through the existing configured host. Continuation accepts the exact original reference, resolving verified stored answers internally; it does not submit answers again. Binds immutable question revision/submission key and cumulative resources; answers do not approve Core writes. Unknown: read exact input receipt, never resubmit or redispatch automatically.' })),
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.list}`,
    tag: 'AI Native', operationId: 'aiTaskCenterList', summary: 'Read current owner task metadata; no task/run creation',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: 'AiTaskMetadataQueryDraft', responseSchema: 'AiTaskMetadataPageDraft' },
  ...(['review', 'decision', 'decisionReceipt'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`, tag: 'AI Native',
    operationId: `aiTaskCenterHuman_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: action === 'review' ? 'Read deterministic original waiting-step order/settings proposal under current domain authority.'
      : action === 'decision' ? 'Explicit human decision on the exact reviewed proposal; server gate and current task/domain authority required. No runner continuation or Core execution. Unknown: read original decision receipt, never auto retry.'
        : 'Read original same-actor decision after expiry or new-execution closure. Missing is not rollback or permission to resubmit.',
    requestSchema: action === 'review' ? 'AiTaskReviewQueryDraft' : 'AiTaskDecisionQueryDraft',
    responseSchema: action === 'review' ? 'AiTaskHumanReviewDraft' : 'AiTaskHumanDecisionReceiptDraft' })),
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.business}`, tag: 'AI Native',
    operationId: 'aiTaskCenterOriginalBusinessReceipt', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: 'AiTaskReviewQueryDraft', responseSchema: 'AiTaskBusinessObservationDraft',
    summary: 'Current owner exact original selection/Core order or settings operation receipt. No latest-object fallback, runner continuation, reconciliation write or inference of payment/fulfillment. Missing retains uncertainty.' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.continue}`, tag: 'AI Native',
    operationId: 'aiTaskCenterContinueOriginalApprovedTask', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    requestSchema: 'AiTaskHumanContinueDraft', responseSchema: 'AiTaskHumanContinuationDraft',
    summary: 'Explicit human continuation of exact current checkpoint/review/revision with recorded same-actor approval. Delegates to the existing configured order/settings host: current claim/fencing/resource/Core authority remains mandatory. Unknown is observed by original business receipt, never auto retried.' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.result}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalModelResult',
    summary: 'Read original order/opening/quote model text via current business/source authorization. No raw artifact fallback or model invocation.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      resultId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'resultId'], false),
    responseSchema: 'AiTaskModelObservationDraft' },
  ...(['stop', 'stopReceipt'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `aiTaskCenterOriginal_${action}`, permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: action === 'stop' ? 'Explicit cancellation intent through the current owned task transition policy/CAS, including model and settings tasks. Independent of new execution, model provenance or financial admission. Not rollback, remote cancellation or refund. Unknown: read exact original receipt; never resubmit.'
      : 'Read cancellation request at exact original task revision and current owner/metadata/event authority, independent of new execution. Absence grants no retry.',
    requestSchema: 'AiTaskStopQueryDraft', responseSchema: 'AiTaskStopObservationDraft' })),
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.source}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalModelSource', permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS],
    summary: 'Reopen one server-issued frozen source through current original scene authority and knowledge ACL. Hash/index are lookups, not authorization. Bounded inert text/JSON only; never a URL, download, model invocation or execution.',
    requestSchema: 'AiTaskModelSourceQueryDraft', responseSchema: 'AiTaskModelSourceObservationDraft' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.confirmation}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalConfirmationHistory',
    summary: 'Observe exact persisted confirmation phases and human decisions, independent of new execution. No approval, continuation, claim or business-success attestation.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      runId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      stepId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'runId', 'stepId'], false),
    responseSchema: 'AiTaskConfirmationHistoryDraft' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.usage}`,
    tag: 'AI Native', operationId: 'aiTaskCenterOriginalUsage', summary: 'Current owner original ledger page, not provider invoice or proof of business success. No new-execution gate, dispatch or settlement.',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      limit: { type: 'integer', minimum: 1, maximum: 20 }, after: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId', 'limit'], false),
    responseSchema: 'AiTaskBudgetUsagePageDraft' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.snapshot}`,
    tag: 'AI Native', operationId: 'aiTaskCenterSnapshot', summary: 'Read authorized task snapshot and persisted event watermark',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' } }, ['taskId'], false), responseSchema: 'AiTaskSnapshotDraft' },
  { method: 'post', path: `/api/${AI_TASK_CENTER_HTTP_DRAFT.basePath}/${AI_TASK_CENTER_HTTP_DRAFT.events}`,
    tag: 'AI Native', operationId: 'aiTaskCenterEvents', summary: 'Read persisted events after original cursor; reset is read-only',
    permissions: [...AI_TASK_CENTER_ENTRY_PERMISSIONS], requestSchema: objectOf({ taskId: { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' },
      after: { type: 'string', maxLength: 20, pattern: '^(0|[1-9][0-9]*)$' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['taskId', 'after', 'limit'], false),
    responseSchema: { oneOf: [ref('AiTaskEventPageDraft'), ref('AiTaskEventResetDraft')] } },
  { method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.read}`,
    tag: 'AI Native', operationId: 'readCurrentTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'Current tenant only. New tenant returns platform product default at revision zero with execution disabled. Masked configuration is not capability, budget or connection verification.',
    requestSchema: objectOf({}, [], false), responseSchema: 'AiTenantModelSettingsSummaryDraft' },
  { method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.save}`,
    tag: 'AI Native', operationId: 'saveCurrentTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'One expectedRevision CAS saves mode/service gate and retained or explicitly changed BYOK credential with its Profile. configId is the current tenant configuration, not a provider Profile. Uncertain acknowledgement must be observed, never retried with a new revision; current read is not an original operation receipt. Does not grant budget or execution.',
    requestSchema: 'AiTenantModelSettingsInputDraft', responseSchema: 'AiTenantModelSettingsSummaryDraft' },
  { method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.operation}`,
    tag: 'AI Native', operationId: 'readOriginalTenantModelConfigurationSave', permissions: ['system:params:manage'],
    summary: 'Current tenant/workspace/original actor only. Observe the operationKey saved with the original config/Profile CAS, not current head or capability proof. Unknown is never automatic retry permission.',
    requestSchema: 'AiModelConfigurationOperationReadDraft', responseSchema: 'AiModelConfigurationOperationDraft' },
  { method: 'post', path: `/api/${AI_MODEL_SETTINGS_HTTP_DRAFT.basePath}/${AI_MODEL_SETTINGS_HTTP_DRAFT.legacy}`,
    tag: 'AI Native', operationId: 'reviewPreservedLegacyTenantModelSettings', permissions: ['system:params:manage'],
    summary: 'Current authorized tenant review only. Returns a keyed original source/version reference, never old keys, masks, prompts or logs. Explicit save with legacySource requires revision zero, a replacement credential, operationKey and disabled BYOK; original settings remain unchanged and current capability/budget is not granted.',
    requestSchema: objectOf({}, [], false), responseSchema: 'AiLegacyModelConfigurationDraft' },
  ...(['operator', 'staff'] as const).flatMap(audience => [
    ['candidates/read', 'readCandidate'], ['candidates/prepare', 'prepareCandidate'], ['candidates/prepare-pending', 'preparePending'],
    ['inputs/prepare', 'prepareInput'], ['inputs/read', 'readInput'], ['tasks/create', 'createTask'], ['tasks/read-creation', 'readCreation'],
    ['reviews/read', 'read'], ['reviews/queue', 'readQueue'], ['reviews/for-event', 'forEvent'], ['reviews/close', 'close'], ['reviews/feedback', 'feedback'], ['reviews/operation', 'operation']
  ].map(([suffix, action]) => ({ method: 'post' as const, path: `/api/ai-native/automation/${audience}/${suffix}`, tag: 'AI Native',
    operationId: `humanAutomation_${audience}_${action}`,
    permissions: audience === 'staff' ? ['rental-os:order:view']
      : ['rental-os:order:view', 'system:integration:manage', 'rental-os:finance:view', 'rental-os:finance:reconcile'],
    summary: 'Original human audience/tenant/workspace/location and event source are revalidated. Metadata preparation/close is not business resolution or execution. New shadow/manual task production additionally needs server-selected original policy, independent automation identity, budget and current persisted grants. Unknown is read by its original key; no worker, model or automatic business action. Response remains draft-polymorphic.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject' }))),
  ...(['read', 'preview', 'prepare', 'preparation', 'review', 'operation', 'commit'] as const).map(action => ({
    method: 'post' as const, path: `/api/ai-native/automation/operator/policies/${action}`, tag: 'AI Native',
    operationId: `humanAutomationPolicy_${action}`, permissions: ['system:params:manage'],
    summary: 'Current operator settings permission plus original scoped management grant. Prepare/commit use persisted CAS and original receipts. Only disabled/shadow/manual_confirmation; no default grants, real automatic execution, model or business write. Unknown must use the original preparation/operation. Draft-polymorphic response, not a frozen full protocol.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject' })),
  ...Object.entries(AI_SCENE_MODEL_HTTP_DRAFT).filter(([name]) => /Settings/u.test(name)).map(([name, action]) => ({
    method: 'post' as const, path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native',
    operationId: `originalNotificationSettings_${name}`, permissions: ['rental-os:price:manage'],
    summary: 'Original notification-settings lifecycle only, not arbitrary configuration. Current original business Guard, owner, persisted scene/task policies and real human approval remain mandatory. New preparation/execution additionally needs the server-only settings host gate; original receipt/metadata observations do not. Same runner and Core transaction, no model, worker, self-approval or second budget. Unknown requires original change/task/decision/operation observation; draft-polymorphic response.',
    requestSchema: 'GenericObject', responseSchema: 'GenericObject' })),
  ...[AI_QUOTE_SELECTION_HTTP_DRAFT, AI_HUMAN_QUOTE_ORDER_HTTP_DRAFT, AI_SELECTED_QUOTE_TASK_HTTP_DRAFT].flatMap(contract =>
    Object.entries(contract).filter(([name]) => name !== 'basePath').map(([name, action]) => ({
      method: 'post' as const, path: `/api/${contract.basePath}${action ? `/${action}` : ''}`, tag: 'AI Native',
      operationId: `originalSelectedQuote_${name}_${contract.basePath.split('/').at(-1)}`,
      permissions: ['select', 'start', 'continueConfirmation', 'decideSelectedProposal', 'reprepareSelectedProposal'].includes(name)
        ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
      summary: 'Same current owner/original input and exact persisted Core quote selection. Selection is not approval; only the existing runner consumes a real human approval through the original Core transaction. New actions require the server quote-order host/limits and current persisted policies. Disabled execution still permits original selection/approval/order receipt reads; unknown is never a new quote/order. No model, stock/payment success claim or second runtime. Response is draft-polymorphic.',
      requestSchema: 'GenericObject', responseSchema: 'GenericObject' }))),
  { method: 'post', path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.queryOrders}`,
    tag: 'AI Native', operationId: 'readAiOrderCandidates', authRequired: true, permissions: ['rental-os:order:view'],
    summary: 'Bounded current Core order page under current Guard/ALS, workspace, data and location scope. Only minimal order facts; no model call, task creation, financial totals or stock reservation. Time filters mean rental-interval overlap, not today-created or pickup/return due.',
    requestSchema: 'AiOrderCandidatesQueryDraft', responseSchema: 'AiOrderCandidatesPageDraft' },
  { method: 'post', path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT.previewOrderExtension}`,
    tag: 'AI Native', operationId: 'previewOriginalOrderExtension',
    summary: 'Current owner-bound original next-steps request and exact order version. Reuses human Core extension permission and pricing; no persistence, inventory reservation, approval, extension or payment. Response remains a draft projection, not an execution receipt.',
    permissions: ['rental-os:order:extend', 'rental-os:order:operate'],
    requestSchema: 'AiSceneOrderExtensionPreviewDraft', responseSchema: 'GenericObject' },
  ...([
    ['quoteReview', 'AiSceneRequestReadDraft', false], ['quoteConfirm', 'AiSceneQuoteConfirmDraft', true],
    ['quoteReceipt', 'AiSceneQuoteReceiptReadDraft', false], ['compareOriginalQuotes', 'AiSceneOriginalQuotesCompareDraft', false]
  ] as const).map(([action, requestSchema, write]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_REQUEST_HTTP_DRAFT.basePath}/${AI_SCENE_REQUEST_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `consumeOriginalQuote_${action}`,
    permissions: write ? ['rental-os:order:create'] : ['rental-os:order:view', 'rental-os:order:create'],
    summary: write ? 'Explicit human confirmation of the immutable original quote inputs. Original Core pricing/persistence only; no stock reservation, order approval, order creation or model call. Unknown is observed by its original quote receipt, never recreated.'
      : 'Current original-owner quote preparation or exact Core receipt. Historical receipt and current admissibility are separate; no quotation, inventory reservation, approval or new execution.',
    requestSchema, responseSchema: 'GenericObject' })),
  ...(['read', 'material', 'recovery'] as const).map(action => ({ method: 'post' as const,
    path: `/api/ai-native/scene-requests/${action}`, tag: 'AI Native', operationId: `readOriginalOrderFacts_${action}`,
    summary: 'Read the exact original owner-bound request/current authorized facts with bounded dependency waits and request-local cancellation; no worker, new run, approval or model invocation. A closed observation is not evidence of rollback or unused budget.',
    permissions: ['rental-os:order:view'], requestSchema: 'AiSceneRequestReadDraft' })),
  { method: 'post', path: '/api/ai-native/scene-requests/reconcile', tag: 'AI Native', operationId: 'reconcileOriginalOrderFactsRequest',
    summary: 'Observe the exact original request key after an uncertain acknowledgement, using bounded current authorization and no write/retry. Absence or an interrupted observation is not permission to create another request.',
    permissions: ['rental-os:order:view'], requestSchema: 'AiSceneRequestCreateDraft' },
  ...([
    ['start', 'AiSceneOrderReadReferenceDraft'], ['recover', 'AiSceneOrderReadReferenceDraft'],
    ['readPreparation', 'AiSceneOrderReadReferenceDraft'], ['resumePrepared', 'AiSceneOrderReadReferenceDraft'],
    ['readAnswer', 'AiSceneOrderReadReferenceDraft'], ['readOrderResult', 'AiSceneOrderReadReferenceDraft'],
    ['readModelResult', 'AiSceneOrderReadReferenceDraft'], ['readTaskScene', 'AiSceneOrderReadReferenceDraft'],
    ['readNextSteps', 'AiSceneOrderReadReferenceDraft'], ['readTaskSnapshot', 'AiSceneOrderReadReferenceDraft'],
    ['reopenModelSource', 'AiSceneOrderReadReferenceDraft'], ['takeover', 'AiSceneOrderReadTakeoverDraft'],
    ['readTakeoverReceipt', 'AiSceneOrderReadTakeoverDraft'], ['requestCancel', 'AiSceneOrderReadCancelDraft'],
    ['readCancellationReceipt', 'AiSceneOrderReadCancelDraft'], ['settleUnstartedCancellation', 'AiSceneOrderReadCancelDraft'],
    ['readCancellationSettlementReceipt', 'AiSceneOrderReadCancelDraft']
  ] as const).map(([action, requestSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_ORDER_READ_HTTP_DRAFT.basePath}/${AI_SCENE_ORDER_READ_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalOrderReadChain_${action}`, authRequired: true,
    permissions: ['rental-os:order:view'], requestSchema, responseSchema: 'GenericObject',
    summary: 'Default closed without explicit trusted server execution configuration. Uses only the original owner-bound model/order/answer chain; current action/plan permissions, verified route and single financial ledger still apply. Recovery observes original effects, never redispatches unknown work. Historical read-only observation remains independently available.' })),
  ...([
    ['read', 'AiBudgetSettingsReadDraft', 'AiBudgetSettingsSummaryDraft'],
    ['readOperation', 'AiBudgetSettingsOperationReadDraft', 'AiBudgetSettingsOperationReceiptDraft'],
    ['change', 'AiBudgetSettingsChangeDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['initialize', 'AiBudgetSettingsInitializeDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['refreshConfiguration', 'AiBudgetSettingsRefreshConfigurationDraft', 'AiBudgetSettingsChangeResponseDraft'],
    ['platformRead', 'AiPlatformBudgetSettingsReadDraft', 'AiPlatformBudgetSettingsSummaryDraft'],
    ['platformSave', 'AiPlatformBudgetSettingsSaveDraft', 'AiPlatformBudgetSettingsSummaryDraft'],
    ['platformReadOperation', 'AiPlatformBudgetSettingsOperationReadDraft', 'AiPlatformBudgetSettingsOperationReceiptDraft'],
    ['readPriceConfiguration', 'AiGatewayPriceConfigurationReadDraft', 'AiGatewayPriceConfigurationDraft'],
    ['reviewPrice', 'AiGatewayPriceReviewDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['readPriceReview', 'AiGatewayPriceReviewReadDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['platformReviewPrice', 'AiGatewayPriceReviewDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['platformPriceReviewReceipt', 'AiGatewayPriceReviewReadDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['adoptPlatformPrice', 'AiGatewayPlatformPriceAdoptionDraft', 'AiGatewayPriceReviewResponseDraft'],
    ['previewPlatformPrice', 'AiGatewayPlatformPriceAdoptionReadDraft', 'AiGatewayPlatformPricePreviewDraft'],
    ['readPlatformPriceAdoption', 'AiGatewayPlatformPriceAdoptionReadDraft', 'AiGatewayPriceReviewResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageAiBudgetSettings_${action}`, authRequired: true,
    permissions: [['platformPriceReviewReceipt', 'platformRead', 'platformReadOperation'].includes(action) ? 'system:ai-provider:view'
      : action.startsWith('platform') ? 'system:ai-provider:manage' : 'system:params:manage'],
    requestSchema, responseSchema,
    summary: action === 'platformRead' || action === 'platformSave' || action === 'platformReadOperation'
      ? 'Current SaaS authority manages the original platform/scene policy with CAS and server-selected configuration. Keyed saves append an immutable, actor/scope/scene/hash-bound configuration receipt in the same policy transaction; original observation requires only current platform view, not a live Profile or new execution permission. Lost replies never authorize another save or imply rollback. No tenant audit attribution, budget admission, supplier call or second ledger.'
      : action === 'readPriceConfiguration'
      ? 'Current tenant settings-read authority resolves the unique tenant-owned default BYOK Profile and revision under current selection. Bounded read with identity and configuration revalidation; no caller-selected owner, model/credential disclosure, price publication, input-count proof or execution grant. Tenant settings object ID is not the Profile ID. Original review receipts remain independent of current configuration.'
      : action === 'previewPlatformPrice'
      ? 'Current tenant settings-read authority reviews one immutable platform rate under current server-selected platform configuration and validity. No reviewer identity, provider, model, credential, adoption, input-count certification or execution grant. Preview is read-only; adoption remains an explicit separate write; original adoption receipts remain independently readable.'
      : action === 'platformReviewPrice' || action === 'platformPriceReviewReceipt' || action === 'adoptPlatformPrice' || action === 'readPlatformPriceAdoption'
      ? 'SaaS authority reviews immutable platform budget rates under the server-selected Profile, optionally including explicit cache read/write per-million rates. Tenants adopt only that exact version, without rate overrides. Reservations use the maximum reviewed input rate; settlement uses persisted disjoint token counters with one six-decimal rounding. Missing cache rates retain unknown accounting. Original review/adoption receipts remain readable under current authority after profile changes; unknown does not authorize another publication. No supplier invoice, input counting or dispatch grant. The default-disabled management gate is independent of model execution.'
      : action === 'reviewPrice' || action === 'readPriceReview'
      ? 'Current authorized BYOK administrator reviews immutable budget rates, optionally explicit inputCache read/write per-million rates, never inferred supplier discounts. Cache counters are disjoint subsets of total input: exact BigInt amounts are rounded once; admission uses the maximum reviewed input rate. This is not a supplier invoice or input-token certificate. Profile revision and ownership are verified under locks; price and review receipt commit atomically. Lost responses require the original operation key, not a new version retry. No platform rate, reservation or dispatch grant. The default-disabled management gate is independent of model execution.'
      : 'Standard server-composed settings host, default unavailable without trusted management configuration; legacy explicit execution configuration remains compatible. Explicit management disable wins. Current tenant/workspace or distinct platform management Guard, version CAS and original single-ledger policies remain mandatory. No policy seed, unlimited default, model call, reservation or dispatch. Rebinding uses the current server-selected profile and disables its policy gate. Tenant writes with operationKey atomically record original actor/workspace/scene, command hash and saved revision in OperationLog; operation reads observe only that original save under current authority, independently of a live Profile. Unknown never means rollback or permission to retry. Unkeyed historical writes cannot be reconstructed from current policy values.' })),
  ...([
    ['priceRead', 'AiGatewayPriceReadDraft', 'AiGatewayPriceSummaryDraft'],
    ['pricePublicationRead', 'AiGatewayPricePublicationReadDraft', 'AiGatewayPriceSummaryDraft'],
    ['inputBoundRead', 'AiGatewayInputBoundReadDraft', 'AiGatewayInputBoundSummaryDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath}/${AI_BUDGET_MANAGEMENT_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `readHistoricalGatewayPricing_${action}`, authRequired: true,
    permissions: ['system:params:manage'], requestSchema, responseSchema,
    summary: 'Standard read-only host for persisted pricing evidence under current management authority; input-bound reads also bind the current owner and original invocation scene. Producer/profile availability, rate expiry and new execution gates are not history gates. Request-local credentials close on abort or bounded wait; no late disclosure. No publication, certification, reserve or dispatch.' })),
  ...([
    ['prepare', 'AiTextCapabilityPrepareRequestDraft', 'AiTextCapabilityPrepareResponseDraft'],
    ['publish', 'AiTextCapabilityPrepareRequestDraft', 'AiTextCapabilityPublishResponseDraft'],
    ['readOriginal', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReadOriginalResponseDraft'],
    ['createTask', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityCreateTaskResponseDraft'],
    ['readTask', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReadTaskResponseDraft'],
    ['configureTaskAction', 'AiTextCapabilityConfigureActionDraft', 'AiTextCapabilityConfigureActionResponseDraft'],
    ['readTaskAction', 'AiTextCapabilityActionRequestDraft', 'AiTextCapabilityReadActionResponseDraft'],
    ['start', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityRunResponseDraft'],
    ['inspect', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityInspectResponseDraft'],
    ['cancel', 'AiTextCapabilityCancelRequestDraft', 'AiTextCapabilityCancelResponseDraft'],
    ['reconcile', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityRunResponseDraft'],
    ['readCapabilityReceipt', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityReceiptResponseDraft'],
    ['preflight', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityPreflightResponseDraft'],
    ['readHistory', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityHistoryResponseDraft'],
    ['readAccounting', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft'],
    ['releaseUnsent', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft'],
    ['reconcileAccounting', 'AiTextCapabilityRequestDraft', 'AiTextCapabilityAccountingResponseDraft']
  ] as const).map(([action, requestSchema, responseSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_TEXT_CAPABILITY_HTTP_DRAFT.basePath}/${AI_TEXT_CAPABILITY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalProbeAccounting_${action}`, authRequired: true,
    permissions: ['system:params:manage'], requestSchema, responseSchema,
    summary: 'Standard capability workflow, unavailable without separate trusted server probe configuration. Human configuration of persisted scene and same-owner task policies is required; never seeded on task creation. Immutable original input, measured runner, unique Gateway dispatch and the original single ledger remain mandatory. Probe completion is not capability evidence: read its persisted receipt. Historical observations/accounting do not dispatch; unknown uses the same original key, never automatic retry or caller usage. Calls quotas do not prove supplier token/money pricing.' })),
  ...(['read', 'releaseUnsent', 'reconcile'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT.basePath}/${AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `originalAiTaskAccounting_${action}`, authRequired: true,
    permissions: ['rental-os:order:view'], requestSchema: 'AiOriginalTaskAccountingRequestDraft',
    responseSchema: 'AiOriginalTaskAccountingResponseDraft',
    summary: 'Standard original order recovery host, independent of new-execution configuration. Current owner, original resource and task action required. Read an original AI budget balance, release only a proved never-dispatched reservation, or reconcile persisted same-call usage. No new reservation/model call or business-funds action; uncertain responses require the original read, never retry dispatch. Other scenes still require their own explicit trusted composition.' })),
  ...(['read', 'configure', 'clear'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT.basePath}/${AI_ORIGINAL_TASK_ACTION_POLICY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageOriginalTaskReadPolicy_${action}`, permissions: ['system:params:manage'], authRequired: true,
    summary: 'Current manager and same-owner original-resource access required, with bounded expiry and revision CAS. Defaults to read policies only. Explicit trusted order execution configuration additionally exposes claim/recovery/release/transition/takeover policy management for the original closed order chain. No automatic policy seed, approval, arbitrary input, lease, financial grant or dispatch.',
    requestSchema: objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' },
      operation: { type: 'string', enum: ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run',
        'claim_recovery_run', 'release_run', 'transition_task', 'takeover_run'] },
      ...(action === 'read' ? {} : { expectedRevision: action === 'configure'
        ? { oneOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: 4294967294 }] }
        : { type: 'integer', minimum: 1, maximum: 4294967293 } }) },
      action === 'read' ? ['original', 'operation'] : ['original', 'operation', 'expectedRevision'], false) })),
  ...(['read', 'change'] as const).map(action => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_PLAN_POLICY_HTTP_DRAFT.basePath}/${AI_SCENE_PLAN_POLICY_HTTP_DRAFT[action]}`,
    tag: 'AI Native', operationId: `manageOriginalOrderPlanPolicy_${action}`, authRequired: true,
    permissions: ['system:params:manage'], responseSchema: 'GenericObject',
    summary: 'Default unavailable without trusted server order execution configuration. Current configuration Guard selects the workspace; the server fixes order_explanation v1 and only ai.model.text/rental.order.explain. Change uses revision CAS and same-transaction audit. No automatic task permission, approval, lease, invocation or financial occupancy. Lost write acknowledgements require original policy read.',
    requestSchema: objectOf({ sceneCode: { type: 'string', enum: ['order_explanation'] },
      ...(action === 'read' ? {} : { change: objectOf({ expectedRevision: { type: 'integer', minimum: 1, maximum: 4294967293, nullable: true },
        enabled: { type: 'boolean' }, expiresAt: { type: 'string', format: 'date-time' },
        limits: objectOf({ maxSteps: { type: 'integer', minimum: 1, maximum: 1000 },
          maxCalls: { type: 'integer', minimum: 1, maximum: 1000 }, maxConcurrent: { type: 'integer', enum: [1] },
          maxTotalMs: { type: 'integer', minimum: 1, maximum: 86400000 },
          maxStepMs: { type: 'integer', minimum: 1, maximum: 86400000, description: 'Must not exceed maxTotalMs.' },
          maxOutputBytes: { type: 'integer', minimum: 1, maximum: 16777216 } },
          ['maxSteps', 'maxCalls', 'maxConcurrent', 'maxTotalMs', 'maxStepMs', 'maxOutputBytes'], false) },
        ['expectedRevision', 'enabled', 'limits', 'expiresAt'], false) }) },
      action === 'read' ? ['sceneCode'] : ['sceneCode', 'change'], false) })),
  ...([
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskPage, objectOf({ limit: { type: 'integer', minimum: 1, maximum: 50 },
      cursor: { type: 'string', maxLength: 512 }, status: { type: 'string', maxLength: 64 },
      sceneCode: { type: 'string', maxLength: 191 } }, [], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskEvents, objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' },
      after: { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, ['original', 'after', 'limit'], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskUsage, 'AiSceneTaskUsageReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance, 'AiSceneTaskPerformanceReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene, 'AiSceneModelTaskSceneDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readInput, 'AiSceneRequestReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readRecoverySnapshot, objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' }, runId: { type: 'string', minLength: 1, maxLength: 191 } }, ['original', 'runId'], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readTakeoverReceipt, objectOf({ original: { $ref: '#/components/schemas/AiSceneRequestReadDraft' },
      runId: { type: 'string', minLength: 1, maxLength: 191 }, expectedTaskRevision: { type: 'integer', minimum: 1, maximum: 4294967294 },
      expectedRunRevision: { type: 'integer', minimum: 1, maximum: 4294967294 }, expectedFencingToken: { type: 'string', pattern: '^[1-9][0-9]{0,19}$' } },
      ['original', 'runId', 'expectedTaskRevision', 'expectedRunRevision', 'expectedFencingToken'], false)],
    [AI_SCENE_MODEL_HTTP_DRAFT.readCancellationReceipt, 'AiSceneModelCancelDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readCancellationSettlementReceipt, 'AiSceneModelCancelDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readAnswer, 'AiSceneModelResumeDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.readModelResult, 'AiSceneModelResultReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.reopenModelSource, 'AiSceneModelSourceReadDraft'],
    [AI_SCENE_MODEL_HTTP_DRAFT.reopenOpeningModelSource, 'AiSceneOpeningModelSourceReadDraft'],
  ] as const).map(([action, requestSchema]) => ({ method: 'post' as const,
    path: `/api/${AI_SCENE_MODEL_HTTP_DRAFT.basePath}/${action}`, tag: 'AI Native', operationId: `observeOriginalAiTask_${action.replace(/\//gu, '_')}`,
    responseSchema: action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskPerformance ? 'AiTaskPerformanceObservationDraft' : undefined,
    permissions: action === AI_SCENE_MODEL_HTTP_DRAFT.readTaskScene
      ? ['rental-os:order:view', 'rental-os:order:create', 'rental-os:price:manage'] : ['rental-os:order:view'], authRequired: true, requestSchema,
    summary: 'Current owner, scope, original resource and action policy are rechecked. Financial observations include exact integer-atom amounts for the visible page only: reserved, pending, settled, released reservation and settled excess, separated by unit and currency. Missing records are not zero consumption, and page amounts are neither whole-task totals nor supplier invoices. Performance observations include original recorded budget-gate rejections in a bounded invocation window: absence is not admission success and rejection is not release evidence. Fixed scene aggregation can consume original selected-quote approval/Core receipts or notification-settings preparation and waiting/receipt readers even while new execution is closed. Read-only observation without a model, runner start, execution grant or budget reservation. Missing result policy/ACL remains unavailable.' })),
  { method: "get", path: "/api/rental/v1/category-adoption/candidates", tag: "Rental Core", operationId: "listCategoryAdoptionCandidates", summary: "List same-category published target IDs and labels allowed for the session tenant/space; operation=upgrade|restore; no bodies, pilot lists or platform drafts", permissions: ["rental-os:category:adopt"], responseSchema: "GenericObject" },
  { method: "get", path: "/api/rental/v1/category-adoption/{targetId}/preparation", tag: "Rental Core", operationId: "previewCategoryAdoptionPreparation", summary: "Read current-session-space candidate fields, differences and staged inputs; operation=upgrade|restore, no active facts changed", permissions: ["rental-os:category:adopt"], responseSchema: "GenericObject" },
  { method: "put", path: "/api/rental/v1/category-adoption/{targetId}/preparation", tag: "Rental Core", operationId: "saveCategoryAdoptionPreparation", summary: "Stage target-version model/asset attribute patches with source and entity revision checks; does not adopt or publish prices/rules", permissions: ["rental-os:category:adopt"], requestSchema: objectOf({
    expectedSourceVersionId: stringSchema, expectedSourceRevision: { type: "integer", minimum: 0 }, expectedPreparationRevision: { type: "integer", minimum: 0 },
    operation: { type: "string", enum: ["upgrade", "restore"] }, reason: stringSchema,
    patches: arrayOf(objectOf({ entityType: { type: "string", enum: ["item_group", "asset"] }, entityId: stringSchema, expectedUpdatedAt: { type: "string", format: "date-time" }, values: objectSchema }, ["entityType", "entityId", "expectedUpdatedAt", "values"], false))
  }, ["expectedSourceVersionId", "expectedSourceRevision", "expectedPreparationRevision", "operation", "reason", "patches"], false), responseSchema: "GenericObject" },
  ...([
    ["get", "", "listPlatformRentalCategoryGovernance", "List category governance summaries", "view"],
    ["get", "/capability-catalog", "rentalCategoryCapabilityCatalog", "Read executable capability and pricing catalog", "view"],
    ["get", "/tenant-directory", "rentalCategoryTenantDirectory", "Read bounded tenant identifiers and labels for pilot selection; no business facts", "view"],
    ["get", "/{code}", "rentalCategoryDetail", "Read category identity and immutable versions", "view"],
    ["get", "/{code}/candidates/{tenantId}/{operation}", "rentalCategoryAdoptionCandidates", "Read versions allowed by the same opening and adoption scope predicates used at commit", "view"],
    ["post", "/{code}/drafts", "createRentalCategoryDraft", "Clone a published same-category version into a draft", "edit", objectOf({ sourceVersionId: stringSchema, versionLabel: stringSchema, reason: stringSchema }, ["sourceVersionId", "versionLabel", "reason"], false)],
    ["patch", "/{code}/versions/{id}/sections/{section}", "patchRentalCategoryDraftSection", "Save only the selected draft section with revision checking", "edit", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, values: objectSchema, reason: stringSchema }, ["expectedRevision", "values", "reason"], false)],
    ["post", "/{code}/versions/{id}/validate", "validateRentalCategoryDraft", "Validate executable category dependencies without publication", "view"],
    ["get", "/{code}/versions/{id}/preview", "previewRentalCategoryDraft", "Preview section changes without changing tenant facts", "view"],
    ["post", "/{code}/versions/{id}/publish", "publishRentalCategoryDraft", "Publish the whole draft atomically; adoption is closed by default", "publish", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, idempotencyKey: stringSchema, reason: stringSchema }, ["expectedRevision", "idempotencyKey", "reason"], false)],
    ["post", "/{code}/versions/{id}/archive", "archiveRentalCategoryDraft", "Archive an unpublished draft only", "edit", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, reason: stringSchema }, ["expectedRevision", "reason"], false)],
    ["put", "/{code}/opening-policy", "saveRentalCategoryOpeningPolicy", "Set category opening scope independently of existing tenant spaces", "opening", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, scope: { type: "string", enum: ["all", "pilot", "unopened", "stopped"] }, tenantIds: arrayOf(stringSchema), recommendedVersionId: stringSchema, reason: stringSchema }, ["expectedRevision", "scope", "tenantIds", "reason"], false)],
    ["put", "/{code}/versions/{id}/adoption-policy", "saveRentalCategoryAdoptionPolicy", "Set independent create, upgrade and restore qualification", "publish", objectOf({ expectedRevision: { type: "integer", minimum: 0 }, createScope: { type: "string", enum: ["all", "pilot", "none"] }, createTenantIds: arrayOf(stringSchema), upgradeScope: { type: "string", enum: ["all", "pilot", "none"] }, upgradeTenantIds: arrayOf(stringSchema), restoreScope: { type: "string", enum: ["all", "pilot", "none"] }, restoreTenantIds: arrayOf(stringSchema), reason: stringSchema }, ["expectedRevision", "createScope", "createTenantIds", "upgradeScope", "upgradeTenantIds", "restoreScope", "restoreTenantIds", "reason"], false)],
    ["get", "/{code}/audits", "rentalCategoryGovernanceAudits", "Read platform configuration audit records, not tenant business data", "audit"]
  ] as Array<[HttpMethod, string, string, string, string, SchemaObject?]>).map(([method, suffix, operationId, summary, permission, requestSchema]): ContractOperation => ({
    method, path: `/api/platform/rental-categories${suffix}`, tag: "Platform Rental Core",
    operationId, summary, permissions: [`system:rental-category:${permission}`], requestSchema, responseSchema: "GenericObject"
  })),
  {
    method: "post",
    path: "/api/public/demo-requests",
    tag: "Platform",
    operationId: "createWebsiteDemoRequest",
    summary: "Submit a website demo request; anonymous, idempotent and IP rate-limited (5 per 10 minutes)",
    permissions: [],
    authRequired: false,
    rateLimited: true,
    requestSchema: objectOf({
      requestKey: { type: "string", format: "uuid" },
      name: { type: "string", minLength: 1, maxLength: 80 },
      contactType: { type: "string", enum: ["phone", "email", "wechat"] },
      contactValue: { type: "string", minLength: 1, maxLength: 160, description: "Phone with 7–20 digits, valid email, or 3–80 character WeChat ID (letters, digits, underscore, hyphen)." },
      company: { type: "string", maxLength: 120 },
      message: { type: "string", maxLength: 1000 },
      language: { type: "string", enum: ["zh", "en"] }
    }, ["requestKey", "name", "contactType", "contactValue", "language"], false),
    responseSchema: objectOf({ received: booleanSchema }, ["received"], false)
  },
  {
    method: "get",
    path: "/api/platform/demo-requests",
    tag: "Platform",
    operationId: "listWebsiteDemoRequests",
    summary: "SaaS administrators only: newest-first paginated website demo requests, never tenant customer data",
    permissions: ["system:demo-request:view"],
    parameters: [queryParam("page", { type: "integer", minimum: 1, maximum: 100000 }), queryParam("pageSize", { type: "integer", minimum: 1, maximum: 100 })],
    responseSchema: objectOf({
      items: arrayOf(objectOf({
        id: stringSchema, name: stringSchema,
        contactType: { type: "string", enum: ["phone", "email", "wechat"] },
        contactValue: stringSchema, company: stringSchema, message: stringSchema,
        language: { type: "string", enum: ["zh", "en"] },
        createdAt: { type: "string", format: "date-time" }
      }, ["id", "name", "contactType", "contactValue", "company", "message", "language", "createdAt"], false)),
      total: { type: "integer" }, page: { type: "integer" }, pageSize: { type: "integer" }
    }, ["items", "total", "page", "pageSize"], false)
  },
  {
    method: "get",
    path: "/api/openapi.json",
    tag: "Contract",
    operationId: "getOpenApiDocument",
    summary: "Get OpenAPI contract document",
    permissions: [],
    responseSchema: "OpenApiDocument"
  },
  {
    method: "get",
    path: "/api/health",
    tag: "Health",
    operationId: "getHealth",
    summary: "Get API health status",
    permissions: [],
    responseSchema: "HealthStatus"
  },
  {
    method: "post",
    path: "/api/auth/login",
    tag: "Auth",
    operationId: "login",
    summary: "Login and issue access token",
    permissions: [],
    requestSchema: "LoginRequest",
    responseSchema: "LoginResponse"
  },
  {
    method: "post",
    path: "/api/auth/development/reset-demo-password",
    tag: "Auth",
    operationId: "resetLocalDemoPassword",
    summary: "Set local development demo account password",
    permissions: [],
    requestSchema: "ResetLocalDemoPasswordRequest",
    responseSchema: "ResetLocalDemoPasswordResult"
  },
  {
    method: "get",
    path: "/api/auth/me",
    tag: "Auth",
    operationId: "getCurrentUser",
    summary: "Get current authenticated user",
    permissions: [],
    authRequired: true,
    responseSchema: "AuthUser"
  },
  {
    method: "get",
    path: "/api/auth/session-context",
    tag: "Auth",
    operationId: "getSessionContext",
    summary: "Refresh authenticated user and tenant capability context",
    permissions: [],
    authRequired: true,
    responseSchema: "SessionContextResponse"
  },
  {
    method: "post",
    path: "/api/auth/refresh",
    tag: "Auth",
    operationId: "refreshSession",
    summary: "Rotate refresh token and issue a new access token",
    permissions: [],
    requestSchema: "RefreshSessionRequest",
    responseSchema: "LoginResponse"
  },
  {
    method: "post",
    path: "/api/auth/logout",
    tag: "Auth",
    operationId: "logout",
    summary: "Revoke the current refresh session",
    permissions: [],
    authRequired: true,
    requestSchema: "RefreshSessionRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "post",
    path: "/api/auth/change-password",
    tag: "Auth",
    operationId: "changePassword",
    summary: "Change password and revoke other sessions",
    permissions: [],
    authRequired: true,
    requestSchema: "ChangePasswordRequest",
    responseSchema: "LoginResponse"
  },
  {
    // SPACE-02：切换当前经营空间。只接受 workspaceId，其余会话范围从令牌与会话推导。
    method: "post",
    path: "/api/auth/switch-workspace",
    tag: "Auth",
    operationId: "switchWorkspace",
    summary: "Switch current business workspace",
    permissions: [],
    authRequired: true,
    requestSchema: "SwitchWorkspaceRequest",
    responseSchema: "LoginResponse"
  },
  backlogOperation("post", "/api/staff/v1/auth/login", "Auth", "staffLogin", "Login and issue a staff-audience access token", [], false, "LoginRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/refresh", "Auth", "refreshStaffSession", "Rotate a staff-audience refresh token", [], false, "RefreshSessionRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/logout", "Auth", "logoutStaffSession", "Revoke a staff-audience refresh session", [], false, "RefreshSessionRequest", "GenericObject"),
  backlogOperation("get", "/api/staff/v1/auth/me", "Auth", "getCurrentStaffUser", "Get the authenticated staff account", [], true, undefined, "AuthUser"),
  backlogOperation("get", "/api/staff/v1/auth/session-context", "Auth", "getStaffSessionContext", "Refresh staff identity, workspace, location scope and permissions", [], true, undefined, "SessionContextResponse"),
  backlogOperation("post", "/api/staff/v1/auth/change-password", "Auth", "changeStaffPassword", "Change a staff password and revoke other sessions", [], true, "ChangePasswordRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/auth/switch-workspace", "Auth", "switchStaffWorkspace", "Switch the current staff workspace", [], true, "SwitchWorkspaceRequest", "LoginResponse"),
  backlogOperation("post", "/api/staff/v1/uploads/sessions", "Files", "createStaffUploadSession", "Create a staff-scoped upload session bound to an order or work order", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, "CreateFileUploadSessionRequest", "FileUploadSessionSummary"),
  backlogOperation("post", "/api/staff/v1/uploads/sessions/{id}/complete", "Files", "completeStaffUpload", "Complete a staff upload after verifying its actor, scope and business owner", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, "CompleteFileUploadRequest", "GenericObject"),
  backlogOperation("get", "/api/staff/v1/uploads/{fileAssetId}/download-url", "Files", "getStaffFileDownloadUrl", "Create a staff-scoped short-lived file URL", ["rental-os:order:pickup", "rental-os:order:return", "rental-os:order:offline-payment", "rental-core:maintenance:manage"], true, undefined, "FileDownloadUrlSummary"),
  backlogOperation("get", "/api/staff/v1/offline-payments", "RentalCore", "listStaffOfflinePaymentRegistrations", "List pending and confirmed offline payment registrations for an order", ["rental-os:order:view"], true, undefined, "GenericObject", [{ name: "orderId", in: "query", required: true, schema: stringSchema }]),
  backlogOperation("post", "/api/staff/v1/offline-payments", "RentalCore", "registerStaffOfflinePayment", "Register an offline payment for independent confirmation", ["rental-os:order:offline-payment"], true, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/staff/v1/offline-payments/{id}/confirm", "RentalCore", "confirmStaffOfflinePayment", "Confirm an offline payment and atomically write the funding event", ["rental-os:order:settle"], true, "GenericObject", "GenericObject"),
  {
    method: "get",
    path: "/api/platform/tenants",
    tag: "Platform",
    operationId: "listTenants",
    summary: "List tenants",
    permissions: ["system:tenant:manage"],
    responseSchema: arrayOf("TenantSummary")
  },
  {
    method: "get",
    path: "/api/platform/tenants/{id}",
    tag: "Platform",
    operationId: "getTenant",
    summary: "Get one SaaS tenant",
    permissions: ["system:tenant:manage"],
    responseSchema: "TenantSummary"
  },
  {
    method: "put",
    path: "/api/platform/tenants/{id}",
    tag: "Platform",
    operationId: "updateTenant",
    summary: "Update one SaaS tenant",
    permissions: ["system:tenant:manage"],
    requestSchema: "UpdateTenantRequest",
    responseSchema: "TenantSummary"
  },
  {
    method: "put",
    path: "/api/platform/tenants/{id}/status",
    tag: "Platform",
    operationId: "updateTenantStatus",
    summary: "Change one SaaS tenant lifecycle status",
    permissions: ["system:tenant:manage"],
    requestSchema: "UpdateTenantStatusRequest",
    responseSchema: "TenantSummary"
  },
  {
    method: "post",
    path: "/api/platform/tenants/{id}/admin/reset-password",
    tag: "Platform",
    operationId: "resetTenantAdminPassword",
    summary: "Reset a tenant administrator password",
    permissions: ["system:tenant:manage"],
    responseSchema: "ResetUserPasswordResult",
    parameters: [{ name: "id", in: "path", required: true, schema: stringSchema }]
  },
  {
    method: "get",
    path: "/api/platform/organizations",
    tag: "Platform",
    operationId: "listOrganizations",
    summary: "List organizations",
    permissions: ["system:user:manage"],
    parameters: [queryParam("tenantId")],
    responseSchema: arrayOf("OrganizationSummary")
  },
  {
    method: "get",
    path: "/api/platform/permission-tree",
    tag: "Platform",
    operationId: "listPermissionTree",
    summary: "List permission tree",
    permissions: ["system:role:manage"],
    responseSchema: arrayOf("PermissionModule")
  },
  {
    method: "get",
    path: "/api/platform/system-rules",
    tag: "Platform",
    operationId: "getSystemRules",
    summary: "Get system rules",
    permissions: ["system:params:manage"],
    responseSchema: "SystemRulesConfig"
  },
  {
    method: "put",
    path: "/api/platform/system-rules/{sectionKey}",
    tag: "Platform",
    operationId: "saveSystemRuleSection",
    summary: "Save one system rule section",
    permissions: ["system:params:manage"],
    requestSchema: "SaveSystemRuleSectionRequest",
    responseSchema: "SystemRulesConfig"
  },
  {
    method: "post",
    path: "/api/platform/system-rules/ai-test",
    tag: "Platform",
    operationId: "testAiConnection",
    summary: "Test AI model connection",
    permissions: ["system:params:manage"],
    requestSchema: "SystemAiConnectionTestRequest",
    responseSchema: "SystemAiConnectionTestResult"
  },
  {
    method: "get",
    path: "/api/platform/security-baseline",
    tag: "Platform",
    operationId: "getSecurityBaseline",
    summary: "Get security baseline",
    permissions: ["system:params:manage"],
    responseSchema: "SystemSecurityBaselineConfig"
  },
  {
    method: "put",
    path: "/api/platform/security-baseline",
    tag: "Platform",
    operationId: "saveSecurityBaseline",
    summary: "Save security baseline",
    permissions: ["system:params:manage"],
    requestSchema: "SaveSecurityBaselineRequest",
    responseSchema: "SystemSecurityBaselineConfig"
  },
  {
    method: "post",
    path: "/api/platform/security-baseline/second-confirmation/check",
    tag: "Platform",
    operationId: "checkSecondConfirmation",
    summary: "Check second confirmation code",
    permissions: ["system:params:manage"],
    requestSchema: "SecondConfirmationCheckRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/platform/data-permission-preview",
    tag: "Platform",
    operationId: "getDataPermissionPreview",
    summary: "Preview current data permissions",
    permissions: ["system:user:manage", "system:role:manage"],
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/platform/audit-logs",
    tag: "Platform",
    operationId: "listAuditLogs",
    summary: "List platform audit logs",
    permissions: ["system:audit:view"],
    parameters: [
      queryParam("tenantId"),
      queryParam("action"),
      queryParam("operator"),
      queryParam("targetType"),
      queryParam("limit", { type: "integer", format: "int32" })
    ],
    responseSchema: "PlatformAuditResult"
  },
  {
    method: "get",
    path: "/api/platform/filter-presets",
    tag: "Platform",
    operationId: "listFilterPresets",
    summary: "List saved filter presets",
    permissions: [],
    authRequired: true,
    parameters: [queryParam("tenantId"), queryParam("scopeKey")],
    responseSchema: arrayOf("PlatformFilterPreset")
  },
  {
    method: "post",
    path: "/api/platform/filter-presets",
    tag: "Platform",
    operationId: "saveFilterPreset",
    summary: "Save filter preset",
    permissions: [],
    authRequired: true,
    requestSchema: "SavePlatformFilterPresetRequest",
    responseSchema: "PlatformFilterPreset"
  },
  {
    method: "put",
    path: "/api/platform/filter-presets/{id}/default",
    tag: "Platform",
    operationId: "setDefaultFilterPreset",
    summary: "Set default filter preset",
    permissions: [],
    authRequired: true,
    requestSchema: "SetPlatformFilterPresetDefaultRequest",
    responseSchema: "PlatformFilterPreset"
  },
  {
    method: "delete",
    path: "/api/platform/filter-presets/{id}",
    tag: "Platform",
    operationId: "deleteFilterPreset",
    summary: "Delete filter preset",
    permissions: [],
    authRequired: true,
    parameters: [queryParam("operator")],
    responseSchema: "DeletePlatformFilterPresetResult"
  },
  {
    method: "get",
    path: "/api/platform/dictionaries",
    tag: "Platform",
    operationId: "listDictionaries",
    summary: "List dictionary groups",
    permissions: ["system:dictionary:manage"],
    responseSchema: arrayOf("PlatformDictionaryGroup")
  },
  {
    method: "put",
    path: "/api/platform/dictionaries/{code}",
    tag: "Platform",
    operationId: "saveDictionaryGroup",
    summary: "Save dictionary group",
    permissions: ["system:dictionary:manage"],
    requestSchema: "SavePlatformDictionaryGroupRequest",
    responseSchema: "PlatformDictionaryGroup"
  },
  {
    method: "get",
    path: "/api/platform/number-rules",
    tag: "Platform",
    operationId: "listNumberRules",
    summary: "List number rules",
    permissions: ["system:number-rule:manage"],
    responseSchema: arrayOf("PlatformNumberRule")
  },
  {
    method: "put",
    path: "/api/platform/number-rules/{code}",
    tag: "Platform",
    operationId: "saveNumberRule",
    summary: "Save number rule",
    permissions: ["system:number-rule:manage"],
    requestSchema: "SavePlatformNumberRuleRequest",
    responseSchema: "PlatformNumberRule"
  },
  {
    method: "post",
    path: "/api/platform/number-rules/generate",
    tag: "Platform",
    operationId: "generateNumber",
    summary: "Generate sample number",
    permissions: ["system:number-rule:manage"],
    requestSchema: "GeneratePlatformNumberRequest",
    responseSchema: "GeneratePlatformNumberResult"
  },
  {
    method: "get",
    path: "/api/platform/tenant-bootstrap/preview",
    tag: "Platform",
    operationId: "getTenantBootstrapPreview",
    summary: "Preview tenant bootstrap template",
    permissions: ["system:tenant:bootstrap", "system:tenant:manage"],
    responseSchema: "TenantBootstrapPreview"
  },
  {
    method: "post",
    path: "/api/platform/tenant-bootstrap",
    tag: "Platform",
    operationId: "bootstrapTenant",
    summary: "Bootstrap tenant",
    permissions: ["system:tenant:bootstrap", "system:tenant:manage"],
    requestSchema: "TenantBootstrapRequest",
    responseSchema: "TenantBootstrapResult"
  },
  {
    method: "get",
    path: "/api/platform/roles",
    tag: "Platform",
    operationId: "listRoles",
    summary: "List roles",
    permissions: ["system:user:manage", "system:role:manage"],
    responseSchema: arrayOf("SystemRoleRow")
  },
  {
    method: "post",
    path: "/api/platform/roles",
    tag: "Platform",
    operationId: "createRole",
    summary: "Create role",
    permissions: ["system:user:manage", "system:role:manage"],
    requestSchema: "SaveSystemRoleRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "put",
    path: "/api/platform/roles/{id}",
    tag: "Platform",
    operationId: "updateRole",
    summary: "Update role",
    permissions: ["system:role:manage"],
    requestSchema: "SaveSystemRoleRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "delete",
    path: "/api/platform/roles/{id}",
    tag: "Platform",
    operationId: "deleteRole",
    summary: "Delete role",
    permissions: ["system:role:manage"],
    responseSchema: "GenericObject"
  },
  {
    method: "put",
    path: "/api/platform/roles/{id}/permissions",
    tag: "Platform",
    operationId: "saveRolePermissions",
    summary: "Save role permissions",
    permissions: ["system:role:manage"],
    requestSchema: "RolePermissionsRequest",
    responseSchema: "SystemRoleRow"
  },
  {
    method: "get",
    path: "/api/platform/users",
    tag: "Platform",
    operationId: "listUsers",
    summary: "List system users",
    permissions: ["system:user:manage"],
    parameters: [queryParam("tenantId")],
    responseSchema: arrayOf("SystemUserRow")
  },
  {
    method: "post",
    path: "/api/platform/users",
    tag: "Platform",
    operationId: "createUser",
    summary: "Create system user",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "put",
    path: "/api/platform/users/{id}",
    tag: "Platform",
    operationId: "updateUser",
    summary: "Update system user",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "post",
    path: "/api/platform/users/access",
    tag: "Platform",
    operationId: "createUserWithWorkspaceAccess",
    summary: "Create system user with workspace access atomically",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserAccessRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "put",
    path: "/api/platform/users/{id}/access",
    tag: "Platform",
    operationId: "updateUserWithWorkspaceAccess",
    summary: "Update system user and workspace access atomically",
    permissions: ["system:user:manage"],
    requestSchema: "SaveSystemUserAccessRequest",
    responseSchema: "SystemUserRow",
    parameters: [{ name: "id", in: "path", required: true, schema: stringSchema }]
  },
  {
    method: "put",
    path: "/api/platform/users/{id}/status",
    tag: "Platform",
    operationId: "setUserStatus",
    summary: "Set system user status",
    permissions: ["system:user:manage"],
    requestSchema: "UserStatusRequest",
    responseSchema: "SystemUserRow"
  },
  {
    method: "post",
    path: "/api/platform/users/{id}/reset-password",
    tag: "Platform",
    operationId: "resetUserPassword",
    summary: "Reset system user password",
    permissions: ["system:user:manage"],
    responseSchema: "GenericObject"
  },
  // ===== 2026-06-25 DP-01 调度任务认领新增的契约操作 =====
  {
    method: "get", path: "/api/rental/v1/categories", tag: "RentalCore", operationId: "listRentalCategories",
    summary: "List supported rental categories", permissions: ["system:tenant:manage", "rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    // REPORT-01A：当前经营空间的经营报表。空间取自会话，客户端不得传入。
    method: "get", path: "/api/rental/v1/reports/operations", tag: "RentalCore", operationId: "getRentalWorkspaceOperationReport",
    summary: "Get current workspace operation report", permissions: ["rental-os:report:view"], responseSchema: "GenericObject"
  },
  {
    // REPORT-01B：同一份报表的 CSV 导出。与页面共用仓储方法、筛选、权限与空间范围。
    method: "get", path: "/api/rental/v1/reports/operations/export", tag: "RentalCore", operationId: "exportRentalWorkspaceOperationReport",
    summary: "Export current workspace operation report as CSV", permissions: ["rental-os:report:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "getRentalTenantProfile",
    summary: "Get tenant rental profile", permissions: ["rental-os:order:view", "rental-core:catalog:view", "rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/tenant-readiness", tag: "RentalBusiness", operationId: "getTenantReadiness",
    summary: "Tenant onboarding readiness status for the current workspace", permissions: ["rental-os:order:view", "rental-os:price:manage", "system:user:manage", "system:role:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "saveRentalTenantProfile",
    summary: "Save tenant rental profile", permissions: ["rental-os:rules:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "getRentalBusinessSettings",
    summary: "Get category-constrained tenant rental settings", permissions: ["rental-os:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "saveRentalBusinessSettings",
    summary: "Save category-constrained tenant rental settings", permissions: ["rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "listRentalCouponTemplates",
    summary: "List tenant coupon templates", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "createRentalCouponTemplate",
    summary: "Create tenant coupon template", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/coupon-templates/{id}", tag: "RentalCore", operationId: "updateRentalCouponTemplate",
    summary: "Update tenant coupon template", permissions: ["rental-os:marketing:manage", "rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "listRentalLocations",
    summary: "List generic fulfillment locations", permissions: ["rental-os:station:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "createRentalLocation",
    summary: "Create generic fulfillment location", permissions: ["rental-os:station:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/locations/{id}", tag: "RentalCore", operationId: "updateRentalLocation",
    summary: "Update generic fulfillment location", permissions: ["rental-os:station:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/item-groups", tag: "RentalCore", operationId: "listRentalItemGroups",
    summary: "List generic rental item groups", permissions: ["rental-core:catalog:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/item-groups", tag: "RentalCore", operationId: "createRentalItemGroup",
    summary: "Create generic rental item group", permissions: ["rental-core:catalog:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/item-groups/{id}", tag: "RentalCore", operationId: "updateRentalItemGroup",
    summary: "Update generic rental item group", permissions: ["rental-core:catalog:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/item-groups/{id}/images", tag: "RentalCore", operationId: "uploadRentalItemGroupImage",
    summary: "Upload an authenticated product-model image", permissions: ["rental-core:catalog:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/item-groups/{id}/images/{imageId}", tag: "RentalCore", operationId: "getRentalItemGroupImage",
    summary: "Read an authenticated product-model image", permissions: ["rental-core:catalog:view"], responseSchema: "GenericObject"
  },
  {
    method: "delete", path: "/api/rental/v1/item-groups/{id}/images/{imageId}", tag: "RentalCore", operationId: "deleteRentalItemGroupImage",
    summary: "Delete a product-model image", permissions: ["rental-core:catalog:manage"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/pricing-groups", tag: "RentalCore", operationId: "listRentalPricingGroups",
    summary: "List tenant-defined pricing groups and their product-model members", permissions: ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/pricing-groups", tag: "RentalCore", operationId: "createRentalPricingGroup",
    summary: "Create a tenant pricing group", permissions: ["rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/pricing-groups/{id}", tag: "RentalCore", operationId: "updateRentalPricingGroup",
    summary: "Update a tenant pricing group and its member models", permissions: ["rental-os:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "patch", path: "/api/rental/v1/pricing-groups/{id}/security-rates", tag: "RentalCore", operationId: "updateRentalPricingGroupSecurityRates",
    summary: "Append a space price version with updated deposit and pre-authorization rates for one pricing group",
    permissions: ["rental-os:price:manage"],
    requestSchema: objectOf({
      rates: {
        type: "array",
        minItems: 1,
        items: objectOf({
          unit: stringSchema,
          depositAmount: numberSchema,
          depositMultiple: numberSchema,
          preAuthAmount: numberSchema,
          preAuthMultiple: numberSchema
        }, ["unit"], false)
      }
    }, ["rates"], false),
    responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/assets", tag: "RentalCore", operationId: "listRentalAssets",
    summary: "List serialized rental assets", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/assets/{id}/status-history", tag: "RentalCore", operationId: "listRentalAssetStatusHistory",
    summary: "List serialized asset status history", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/assets", tag: "RentalCore", operationId: "createRentalAsset",
    summary: "Create serialized rental asset", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/assets/{id}", tag: "RentalCore", operationId: "updateRentalAsset",
    summary: "Update serialized rental asset", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-balances", tag: "RentalCore", operationId: "listRentalStockBalances",
    summary: "List quantity stock balances", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/stock-balances", tag: "RentalCore", operationId: "saveRentalStockBalance",
    summary: "Save quantity stock balance", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-ledger", tag: "RentalCore", operationId: "listRentalStockLedger",
    summary: "List quantity stock operation ledger", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject",
    parameters: [queryParam("itemGroupId"), queryParam("locationId"), queryParam("batchNo"), queryParam("sourceDocumentNo"), queryParam("limit")]
  },
  {
    method: "post", path: "/api/rental/v1/stock-operations", tag: "RentalCore", operationId: "applyRentalStockOperation",
    summary: "Apply an auditable quantity stock operation", permissions: ["rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/stock-dispositions", tag: "RentalCore", operationId: "listRentalStockDispositions",
    summary: "List return stock dispositions", permissions: ["rental-core:maintenance:view", "rental-core:asset:view", "rental-core:asset:manage"], responseSchema: "GenericObject",
    parameters: [queryParam("orderId")]
  },
  {
    method: "post", path: "/api/rental/v1/stock-dispositions/{dispositionId}/restore", tag: "RentalCore", operationId: "restoreRentalStockDisposition",
    summary: "Restore a return stock disposition", permissions: ["rental-core:maintenance:review", "rental-core:asset:manage"] , responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/stock-dispositions/{dispositionId}/write-off", tag: "RentalCore", operationId: "writeOffRentalStockDisposition",
    summary: "Write off quarantined quantity stock with a reason and auditable ledger entry", permissions: ["rental-core:maintenance:review", "rental-core:asset:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/work-orders", tag: "RentalCore", operationId: "listRentalWorkOrders",
    summary: "List maintenance work orders", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject",
    parameters: [queryParam("status")]
  },
  {
    method: "get", path: "/api/rental/v1/work-order-assignees", tag: "RentalCore", operationId: "listRentalWorkOrderAssignees",
    summary: "List current workspace work order assignees", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject",
    parameters: [queryParam("locationId")]
  },
  {
    method: "post", path: "/api/rental/v1/work-orders", tag: "RentalCore", operationId: "createRentalWorkOrder",
    summary: "Create maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/work-orders/{id}/assign", tag: "RentalCore", operationId: "assignRentalWorkOrder",
    summary: "Assign maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/start", tag: "RentalCore", operationId: "startRentalWorkOrder",
    summary: "Start maintenance work order", permissions: ["rental-core:maintenance:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/submit", tag: "RentalCore", operationId: "submitRentalWorkOrder",
    summary: "Submit maintenance work order for review", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/review", tag: "RentalCore", operationId: "reviewRentalWorkOrder",
    summary: "Review maintenance work order", permissions: ["rental-core:maintenance:review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/work-orders/{id}/cancel", tag: "RentalCore", operationId: "cancelRentalWorkOrder",
    summary: "Cancel maintenance work order", permissions: ["rental-core:maintenance:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/work-orders/{id}/history", tag: "RentalCore", operationId: "listRentalWorkOrderHistory",
    summary: "List maintenance work order history", permissions: ["rental-core:maintenance:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/availability", tag: "RentalCore", operationId: "checkRentalAvailability",
    summary: "Check generic rental availability", permissions: ["rental-os:order:operate", "rental-os:order:create"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    // ORDER-LIST-01：筛选与分页在服务端执行。不带 page/pageSize 返回纯数组（兼容旧调用方），
    // 带任一分页参数返回 { items, page, pageSize, total } 信封。空间取自会话。
    method: "get", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "listRentalCoreOrders",
    summary: "List Rental Core orders (server-side filters; paged envelope when page/pageSize given)", permissions: ["rental-os:order:view"], responseSchema: "GenericObject",
    parameters: [
      queryParam("page", { type: "integer", minimum: 1, maximum: 1000000 }),
      queryParam("pageSize", { type: "integer", minimum: 1, maximum: 200 }),
      queryParam("status", { type: "string", enum: ["draft", "reserved", "pickup_overdue", "ready_for_pickup", "renting", "return_inspection", "settling", "completed", "cancelled", "no_show"] }),
      queryParam("keyword", { type: "string", maxLength: 100 }),
      queryParam("from", { type: "string", format: "date-time" }),
      queryParam("to", { type: "string", format: "date-time" }),
      queryParam("assignment", { type: "string", enum: ["pending", "partial", "unlocked", "locked", "issue"] }),
      queryParam("pendingFeeOnly", { type: "boolean" })
    ]
  },
  {
    method: "get", path: "/api/rental/v1/workbench/todos", tag: "RentalCore", operationId: "listRentalWorkbenchTodos",
    summary: "List actionable workbench todos for the current workspace", permissions: ["rental-os:report:view", "rental-os:order:view", "rental-core:maintenance:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "createRentalCoreOrder",
    summary: "Create multi-line Rental Core order", permissions: ["rental-os:order:operate", "rental-os:order:create"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/expire-pending", tag: "RentalCore", operationId: "expirePendingRentalCoreOrders",
    summary: "Expire pending-payment soft reservations in the current workspace", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/reconcile-pickup-overdue", tag: "RentalCore", operationId: "reconcilePickupOverdueRentalCoreOrders",
    summary: "Advance overdue pickup orders and finalize eligible no-shows", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}", tag: "RentalCore", operationId: "getRentalCoreOrder",
    summary: "Get Rental Core order", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/carrier-shipment/events", tag: "RentalCore", operationId: "listRentalCarrierShipmentEvents",
    summary: "List carrier shipment milestones and their evidence for one carrier-shipping order", permissions: ["rental-os:order:view"], responseSchema: "RentalCarrierShipmentEventList"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/carrier-shipment/events", tag: "RentalCore", operationId: "createRentalCarrierShipmentEvent",
    summary: "Record outbound dispatch or customer carrier handoff with evidence; rental and inventory effects are derived from verified milestones", permissions: ["rental-os:order:operate"], requestSchema: "CreateRentalCarrierShipmentEventRequest", responseSchema: "RentalCarrierShipmentEventSummary",
    parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 191 } }]
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/delivery-address/reveal", tag: "RentalCore", operationId: "revealRentalOrderDeliveryAddress",
    summary: "Reveal an order delivery contact to authorized staff; access is recorded", permissions: ["rental-os:customer:reveal-sensitive"], responseSchema: "GenericObject"
  },
  {
    // DOC-PRINT-01：管理端与 APP 共用的客户可读凭证快照；不代表正式 PDF/法定票据。
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}", tag: "RentalCore", operationId: "renderRentalOrderDocument",
    summary: "Render a customer-readable order document snapshot", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}/versions", tag: "RentalCore", operationId: "listRentalOrderDocumentVersions",
    summary: "List immutable versions of a customer-readable order document", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/documents/{type}/versions/{snapshotId}", tag: "RentalCore", operationId: "readRentalOrderDocumentVersion",
    summary: "Read one immutable order document version", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/expire-pending", tag: "RentalCore", operationId: "expirePendingRentalCoreOrder",
    summary: "Expire one pending-payment soft reservation when all holds have elapsed", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/mark-pickup-overdue", tag: "RentalCore", operationId: "markPickupOverdueRentalCoreOrder",
    summary: "Move an order past pickup grace into pending no-show", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/no-show-notice", tag: "RentalCore", operationId: "sendNoShowNoticeRentalCoreOrder",
    summary: "Record a simulated customer notice for a pending no-show", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/confirm-no-show", tag: "RentalCore", operationId: "confirmNoShowRentalCoreOrder",
    summary: "Finalize an eligible no-show and release its resources", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/resume-pickup", tag: "RentalCore", operationId: "resumePickupRentalCoreOrder",
    summary: "Resume a pending no-show order back to ready-for-pickup", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/confirm", tag: "RentalCore", operationId: "confirmRentalCoreOrder",
    summary: "Confirm Rental Core reservation", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/allocate", tag: "RentalCore", operationId: "allocateRentalCoreOrder",
    summary: "Allocate Rental Core inventory", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/allocation-candidates", tag: "RentalCore", operationId: "rentalAllocationCandidates",
    summary: "Get scoped allocation candidates, or exchange candidates for a fulfilled order line", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject",
    parameters: [queryParam("exchangeOrderLineId"), queryParam("replacementItemGroupId")]
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/assignments", tag: "RentalCore", operationId: "manageRentalAllocations",
    summary: "Preassign or lock resources; unlock, release and reassign additionally require order:reassign", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/internal-notes", tag: "RentalCore", operationId: "listRentalOrderInternalNotes",
    summary: "List operations-only internal notes for a rental order", permissions: ["rental-os:order:view"], responseSchema: arrayOf("RentalOrderInternalNote")
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/internal-notes", tag: "RentalCore", operationId: "createRentalOrderInternalNote",
    summary: "Add an idempotent operations-only internal note to a rental order", permissions: ["rental-os:order:operate"], requestSchema: "CreateRentalOrderInternalNoteRequest", responseSchema: "RentalOrderInternalNote",
    parameters: [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 191 } }]
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/operation-lock", tag: "RentalCore", operationId: "rentalOrderOperationLock",
    summary: "Acquire or release a fenced handover operation lock; managers may force-release another employee's active lock with a reason", permissions: ["rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return", "rental-os:order:reassign"], requestSchema: "RentalOperationLockRequest", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/substitute-bundle-component", tag: "RentalCore", operationId: "substituteRentalBundleComponent",
    summary: "Substitute a reserved bundle component within its configured group", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/partial-return", tag: "RentalCore", operationId: "partialReturnRentalCoreOrder",
    summary: "Return selected allocated assets or quantities while keeping the order renting", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/cancel", tag: "RentalCore", operationId: "cancelRentalCoreOrder",
    summary: "Cancel Rental Core order", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/handover/{stage}", tag: "RentalCore", operationId: "handoverRentalCoreOrder",
    summary: "Complete pickup or return handover when inspection is not required", permissions: ["rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/settle", tag: "RentalCore", operationId: "settleRentalCoreOrder",
    summary: "Settle and close a returned Rental Core order", permissions: ["rental-os:order:settle"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/services/{occurrenceId}/execution", tag: "RentalCore", operationId: "updateRentalServiceOccurrenceExecution",
    summary: "Record a value-added service execution outcome and settle its capacity/refund review", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/services/{occurrenceId}/refund", tag: "RentalCore", operationId: "refundRentalServiceOccurrence",
    summary: "Record the approved value-added service refund and close its refund state", permissions: ["rental-os:order:settle"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/extensions", tag: "RentalCore", operationId: "listRentalOrderExtensions",
    summary: "List order extension records", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/changes", tag: "RentalCore", operationId: "listRentalOrderChanges",
    summary: "List append-only order change records", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/partial-cancel/preview", tag: "RentalCore", operationId: "previewRentalOrderPartialCancellation",
    summary: "Preview a pre-pickup whole-line cancellation", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/partial-cancel", tag: "RentalCore", operationId: "applyRentalOrderPartialCancellation",
    summary: "Apply a confirmed pre-pickup whole-line cancellation", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/post-pickup-exchange/preview", tag: "RentalCore", operationId: "previewRentalOrderPostPickupExchange",
    summary: "Preview a confirmed post-pickup item exchange", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/changes/post-pickup-exchange", tag: "RentalCore", operationId: "applyRentalOrderPostPickupExchange",
    summary: "Apply a post-pickup exchange, freeze replacement policy/inspection/capability evidence and defer the difference to settlement", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/preview", tag: "RentalCore", operationId: "previewRentalOrderExtension",
    summary: "Quote an order extension without persisting", permissions: ["rental-os:order:extend", "rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions", tag: "RentalCore", operationId: "requestRentalOrderExtension",
    summary: "Apply for an order extension", permissions: ["rental-os:order:extend", "rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/{extensionId}/pay", tag: "RentalCore", operationId: "payRentalOrderExtension",
    summary: "Confirm extension payment and extend the rental period", permissions: ["rental-os:order:extend", "rental-os:order:operate"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/fee-reviews/{reviewId}/review", tag: "RentalCore", operationId: "reviewRentalOrderFeeReview",
    summary: "Decide a pending fee review (manual overdue collection or early-return refund)", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/extensions/{extensionId}/refund-review", tag: "RentalCore", operationId: "reviewRentalExtensionRefund",
    summary: "Review an extension price reduction without issuing a cash refund", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/inspection-templates", tag: "RentalCore", operationId: "listRentalInspectionTemplates",
    parameters: [queryParam("stage", { type: "string", enum: ["pickup", "return"] }), queryParam("orderId")],
    summary: "List inspection templates; orderId projects immutable original/replacement requirements with allocationIds for separate return batches, otherwise current configuration", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "listRentalOrderInspections",
    summary: "List Rental Core inspections", permissions: ["rental-os:order:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "createRentalOrderInspection",
    summary: "Complete pickup or return inspection", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/usage-correction", tag: "RentalCore", operationId: "correctRentalInspectionUsage",
    summary: "Append a traceable correction to an inspection usage reading", permissions: ["rental-os:order:operate"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/review", tag: "RentalCore", operationId: "reviewRentalOrderInspectionException",
    summary: "Approve or reject a suggested inspection exception charge", permissions: ["rental-os:order:fee-review"], requestSchema: "ReviewRentalInspectionExceptionRequest", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/customer-response", tag: "RentalCore", operationId: "recordRentalOrderInspectionExceptionCustomerResponse",
    summary: "Record customer confirmation or dispute for an approved inspection exception charge", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections/{inspectionId}/exceptions/{exceptionIndex}/re-review", tag: "RentalCore", operationId: "reReviewRentalOrderInspectionException",
    summary: "Adjust a disputed inspection exception charge and require customer reconfirmation", permissions: ["rental-os:order:fee-review"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/capabilities", tag: "RentalCore", operationId: "listWorkspaceCapabilities",
    summary: "List workspace capability instances with declared/implemented/enabled state",
    permissions: ["rental-core:capability:view", "rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/capabilities", tag: "RentalCore", operationId: "saveWorkspaceCapability",
    summary: "Enable, pause, disable or reconfigure a workspace capability",
    permissions: ["rental-core:capability:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/capabilities/{code}/upgrade", tag: "RentalCore", operationId: "upgradeWorkspaceCapability",
    summary: "Upgrade a workspace capability to the registry implementation version",
    permissions: ["rental-core:capability:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    // Review P1-3：存量空间的显式对账入口。迁移与租户初始化都不静默补启用，
    // 因此必须有一条由人触发、留 system_initialize 审计的转正路径。
    method: "post", path: "/api/rental/v1/capabilities/initialize-required", tag: "RentalCore", operationId: "initializeRequiredWorkspaceCapabilities",
    summary: "Initialize the category-required capabilities of the current workspace (idempotent reconciliation)",
    permissions: ["rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/capability-audits", tag: "RentalCore", operationId: "listWorkspaceCapabilityAudits",
    summary: "List workspace capability lifecycle audit events",
    permissions: ["rental-core:capability:view", "rental-core:capability:manage"], responseSchema: "GenericObject"
  },
  ...rentalBusinessOperations(),
  ...TENANT_INTEGRATION_OPERATIONS,
  ...INTEGRATION_BACKLOG_OPERATIONS
];

function rentalBusinessOperations(): ContractOperation[] { return [
  backlogOperation("get", "/api/rental/v1/fulfillment-operators", "RentalCore", "listRentalFulfillmentOperators", "List fulfillment operators", ["rental-os:station:view"]),
  backlogOperation("post", "/api/rental/v1/fulfillment-operators", "RentalCore", "createRentalFulfillmentOperator", "Create fulfillment operator", ["rental-os:station:manage"]),
  backlogOperation("put", "/api/rental/v1/fulfillment-operators/{id}", "RentalCore", "updateRentalFulfillmentOperator", "Update fulfillment operator", ["rental-os:station:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-plans", "RentalBusiness", "listRentalPricingPlans", "List generic pricing plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans", "RentalBusiness", "createRentalPricingPlan", "Create generic pricing plan", ["rental-os:price:manage"]),
  backlogOperation("put", "/api/rental/v1/pricing-plans/{id}", "RentalBusiness", "updateRentalPricingPlan", "Update generic pricing plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-versions", "RentalBusiness", "listRentalPriceVersions", "List immutable space price versions", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),
  backlogOperation("get", "/api/rental/v1/pricing-versions/{sequence}", "RentalBusiness", "getRentalPriceVersion", "Get immutable space price version", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),
  backlogOperation("post", "/api/rental/v1/pricing-versions/{sequence}/restore", "RentalBusiness", "restoreRentalPriceVersion", "Restore an immutable price snapshot by appending a new version", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-plans/{id}/versions", "RentalBusiness", "listLegacyRentalPricingPlanVersions", "Compatibility entry for space price versions", ["rental-os:price:manage", "rental-os:order:view", "rental-os:order:create"]),

  backlogOperation("get", "/api/rental/v1/pricing-plans/{id}/adjustments", "RentalBusiness", "listRentalPriceAdjustments", "List price adjustment plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/adjustments/run-due", "RentalBusiness", "runDueRentalPriceAdjustments", "Apply due scheduled price adjustments", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments", "RentalBusiness", "createRentalPriceAdjustment", "Create a price adjustment plan (diff + final-price preview)", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments/{aid}/confirm", "RentalBusiness", "confirmRentalPriceAdjustment", "Confirm a price adjustment plan (immediate or schedule)", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans/{id}/adjustments/{aid}/cancel", "RentalBusiness", "cancelRentalPriceAdjustment", "Cancel a draft or pending price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-adjustments", "RentalBusiness", "listSpaceRentalPriceAdjustments", "List workspace price adjustment plans", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments", "RentalBusiness", "createSpaceRentalPriceAdjustment", "Create a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments/{aid}/confirm", "RentalBusiness", "confirmSpaceRentalPriceAdjustment", "Confirm a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-adjustments/{aid}/cancel", "RentalBusiness", "cancelSpaceRentalPriceAdjustment", "Cancel a workspace price adjustment plan", ["rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/discount-plans", "RentalBusiness", "listRentalDiscountPlans", "List rental discount plans", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/discount-plans", "RentalBusiness", "createRentalDiscountPlan", "Create rental discount plan", ["rental-os:marketing:manage"]),
  backlogOperation("put", "/api/rental/v1/discount-plans/{id}", "RentalBusiness", "updateRentalDiscountPlan", "Update rental discount plan", ["rental-os:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/value-added-services", "RentalBusiness", "listRentalValueAddedServices", "List value-added services", ["rental-os:service:manage"]),
  backlogOperation("post", "/api/rental/v1/value-added-services", "RentalBusiness", "createRentalValueAddedService", "Create value-added service", ["rental-os:service:manage"]),
  backlogOperation("put", "/api/rental/v1/value-added-services/{id}", "RentalBusiness", "updateRentalValueAddedService", "Update value-added service", ["rental-os:service:manage"]),
  backlogOperation("get", "/api/rental/v1/service-capacities", "RentalBusiness", "listRentalServiceCapacities", "List service capacity windows", ["rental-os:service:manage"]),
  backlogOperation("post", "/api/rental/v1/service-capacities", "RentalBusiness", "createRentalServiceCapacity", "Create service capacity window", ["rental-os:service:manage"]),
  backlogOperation("put", "/api/rental/v1/service-capacities/{id}", "RentalBusiness", "updateRentalServiceCapacity", "Update service capacity window", ["rental-os:service:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}", "RentalBusiness", "getRentalBusinessCalendar", "Get annual business calendar", ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage", "rental-os:order:view"]),
  backlogOperation("get", "/api/rental/v1/official-calendar-sources", "RentalBusiness", "listRentalOfficialCalendarSourceVersions", "List public official calendar source versions", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/apply-official-source", "RentalBusiness", "applyRentalOfficialCalendarSource", "Apply a public official calendar source version to the workspace draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("get", "/api/platform/official-calendars", "OfficialCalendarSource", "listOfficialCalendarSources", "List public official calendar sources", ["system:calendar-source:manage"]),
  backlogOperation("post", "/api/platform/official-calendars", "OfficialCalendarSource", "createOfficialCalendarSource", "Register a public official calendar source", ["system:calendar-source:manage"]),
  backlogOperation("put", "/api/platform/official-calendars/{id}", "OfficialCalendarSource", "updateOfficialCalendarSource", "Update a public official calendar source", ["system:calendar-source:manage"]),
  backlogOperation("get", "/api/platform/official-calendars/{id}/versions", "OfficialCalendarSource", "listOfficialCalendarSourceVersions", "List versions of a public official calendar source", ["system:calendar-source:manage"]),
  backlogOperation("post", "/api/platform/official-calendars/{id}/versions", "OfficialCalendarSource", "registerOfficialCalendarSourceVersion", "Register a new annual version of a public official calendar source", ["system:calendar-source:manage"]),
  // SUB-01 SaaS 版本订阅（§5.2/§7/§8）。租户端 platform/subscription（单数）自读/申请；平台端 platform/subscriptions（复数）跨租户管理，守卫另有 fail-closed。
  backlogOperation("get", "/api/platform/subscription/view", "Subscription", "getTenantSubscriptionView", "Get the calling tenant's subscription aggregate view", ["rental-os:subscription:view"]),
  backlogOperation("get", "/api/platform/subscription/reminder", "Subscription", "getTenantSubscriptionReminder", "Get the authenticated tenant's expiry summary without commercial details", []),
  backlogOperation("post", "/api/platform/subscription/requests", "Subscription", "submitTenantSubscriptionRequest", "Submit an upgrade/renew/consult request for the calling tenant", ["rental-os:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscription/requests/{id}/cancel", "Subscription", "cancelTenantSubscriptionRequest", "Cancel the calling tenant's own pending request", ["rental-os:subscription:manage"]),
  backlogOperation("get", "/api/platform/subscriptions", "Subscription", "listTenantSubscriptions", "List tenant subscriptions (plan/serviceStatus/dueWithin/keyword filters)", ["system:tenant:subscription:manage"]),
  backlogOperation("get", "/api/platform/subscriptions/feature-catalog", "Subscription", "listSubscriptionFeatureCatalog", "List the platform feature catalog", ["system:tenant:subscription:manage"]),
  backlogOperation("get", "/api/platform/subscriptions/standard-prices", "Subscription", "listSubscriptionStandardPrices", "List standard plan prices", ["system:tenant:subscription:manage"]),
  backlogOperation("patch", "/api/platform/subscriptions/requests/{id}", "Subscription", "handleSubscriptionRequest", "Handle (process/reject) a subscription request", ["system:tenant:subscription:manage"]),
  backlogOperation("put", "/api/platform/subscriptions/feature-catalog/{code}", "Subscription", "upsertSubscriptionFeatureCatalog", "Upsert a feature catalog entry (full PUT)", ["system:tenant:subscription:manage"]),
  backlogOperation("put", "/api/platform/subscriptions/standard-prices/{plan}", "Subscription", "setSubscriptionStandardPrice", "Set a standard plan price", ["system:tenant:subscription:manage"]),
  backlogOperation("get", "/api/platform/subscriptions/{tenantId}", "Subscription", "getTenantSubscriptionDetail", "Get one tenant's subscription detail", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/provision", "Subscription", "provisionTenantSubscription", "Provision a tenant subscription", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/renew", "Subscription", "renewTenantSubscription", "Renew a tenant subscription", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/upgrade", "Subscription", "upgradeTenantSubscriptionPro", "Upgrade a tenant subscription to PRO", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/extend", "Subscription", "extendTenantSubscription", "Temporarily extend a tenant subscription end", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/schedule-next", "Subscription", "scheduleNextTenantSubscription", "Schedule the next subscription segment", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/feature-grants", "Subscription", "grantTenantFeature", "Grant a tenant-specific feature", ["system:tenant:subscription:manage"]),
  backlogOperation("post", "/api/platform/subscriptions/{tenantId}/feature-grants/revoke", "Subscription", "revokeTenantFeature", "Revoke a tenant-specific feature grant", ["system:tenant:subscription:manage"]),
  backlogOperation("get", "/api/rental/v1/subscription/context", "Subscription", "getStaffSubscriptionContext", "Staff/operator read-only subscription & entitlement context for the staff mini-program (amounts redacted)", []),
  backlogOperation("put", "/api/rental/v1/calendars/{year}/days/{date}", "RentalBusiness", "updateRentalBusinessCalendarDay", "Update tenant calendar day", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("delete", "/api/rental/v1/calendars/{year}/days/{date}", "RentalBusiness", "removeRentalBusinessCalendarDayOverride", "Remove tenant calendar day override", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-preview", "RentalBusiness", "previewRentalBusinessCalendarRangeOverride", "Preview a date or datetime range override over the annual calendar draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range", "RentalBusiness", "applyRentalBusinessCalendarRangeOverride", "Apply an atomic date or datetime range override (shared reason, batch and single revision)", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-remove-preview", "RentalBusiness", "previewRentalBusinessCalendarRangeRemove", "Preview restoring a date range to its next-priority source", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/days/range-remove", "RentalBusiness", "applyRentalBusinessCalendarRangeRemove", "Remove overrides across a date range atomically", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/publish", "RentalBusiness", "publishRentalBusinessCalendar", "Publish annual business calendar", ["rental-os:calendar:publish", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/versions/{version}/void", "RentalBusiness", "voidRentalBusinessCalendarVersion", "Void annual business calendar draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/versions/{version}/restore", "RentalBusiness", "restoreRentalBusinessCalendarVersion", "Restore an annual business calendar version into a new draft", ["rental-os:calendar:edit", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/versions", "RentalBusiness", "listRentalBusinessCalendarVersions", "List annual business calendar versions", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/versions/{version}", "RentalBusiness", "getRentalBusinessCalendarVersion", "Get annual business calendar version detail", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/override-audits", "RentalBusiness", "listRentalBusinessCalendarOverrideAudits", "List annual business calendar override audits", ["rental-os:calendar:view-history", "rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}/publish-preview", "RentalBusiness", "previewRentalBusinessCalendarPublish", "Preview annual business calendar publish impact", ["rental-os:calendar:edit", "rental-os:calendar:publish", "rental-os:price:manage", "rental-os:rules:manage"]),
  // RULE-01A：读取（列表、详情、发布预览、审计）manage 或 publish 任一即可；
  // 发布与作废只认 rules:publish，存草稿与恢复为新草稿只认 rules:manage（需求 4.6.14）。
  backlogOperation("get", "/api/rental/v1/rule-versions", "RentalBusiness", "listRentalRuleVersionsV1", "List rental rule versions", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/current", "RentalBusiness", "getCurrentRentalRuleVersionV1", "Match the rental rule version effective at a moment", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/audits", "RentalBusiness", "listRentalRuleVersionAuditsV1", "List rental rule version publish/restore/void audits", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/{version}", "RentalBusiness", "getRentalRuleVersionV1", "Get rental rule version detail", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/{version}/publish-preview", "RentalBusiness", "previewRentalRuleVersionPublishV1", "Preview rental rule version publish impact", ["rental-os:rules:manage", "rental-os:rules:publish", "rental-os:price:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions", "RentalBusiness", "saveRentalRuleVersionDraftV1", "Create or update a rental rule draft version", ["rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/restore", "RentalBusiness", "restoreRentalRuleVersionV1", "Restore a historical rental rule version as a new draft", ["rental-os:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/publish", "RentalBusiness", "publishRentalRuleVersionV1", "Publish or schedule a rental rule version", ["rental-os:rules:publish"]),
  backlogOperation("post", "/api/rental/v1/rule-versions/{version}/void", "RentalBusiness", "voidRentalRuleVersionV1", "Void a pending or effective rental rule version", ["rental-os:rules:publish"]),
  // RULE-01B：押金/预授权模拟资金事件（需求 4.4.7、4.6.3）。读用 order:view 或 order:settle；资金动作只认 order:settle。
  backlogOperation("get", "/api/rental/v1/orders/{orderId}/funding-events", "RentalBusiness", "listRentalOrderFundingEventsV1", "List order deposit/pre-auth funding events and balances", ["rental-os:order:view", "rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/initiate", "RentalBusiness", "initiateRentalOrderFundingV1", "Initiate a deposit collection or pre-auth freeze (mock)", ["rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/append", "RentalBusiness", "appendRentalOrderFundingV1", "Append to a deposit or pre-auth (mock)", ["rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/capture", "RentalBusiness", "captureRentalOrderFundingV1", "Capture/deduct from a deposit or pre-auth (mock)", ["rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/refund", "RentalBusiness", "refundRentalOrderFundingV1", "Refund a deposit (mock)", ["rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/release", "RentalBusiness", "releaseRentalOrderFundingV1", "Release a pre-auth freeze (mock)", ["rental-os:order:settle"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/funding-events/fail", "RentalBusiness", "failRentalOrderFundingV1", "Record a failed deposit/pre-auth funding action (mock)", ["rental-os:order:settle"]),
  backlogOperation("get", "/api/rental/v1/orders/{orderId}/payment-intents", "Payments", "listRentalPaymentIntents", "List real payment intents for an order", ["rental-os:finance:view", "rental-os:finance:reconcile"]),
  backlogOperation("get", "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds", "Payments", "listRentalPaymentRefunds", "List provider refund records for a payment intent", ["rental-os:finance:view", "rental-os:finance:reconcile"]),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds", "Payments", "createRentalPaymentRefund", "Create a real provider refund after an approved order credit", ["rental-os:finance:reconcile"], true, "CreatePaymentRefundRequest", "PaymentRefundResponse"),
  backlogOperation("post", "/api/rental/v1/orders/{orderId}/payment-intents/{intentId}/refunds/{refundId}/refresh", "Payments", "refreshRentalPaymentRefund", "Query and recover a provider refund", ["rental-os:finance:reconcile"], true, undefined, "PaymentRefundResponse"),
  backlogOperation("post", "/api/rental/v1/payment-reconciliation", "Payments", "reconcileRentalPayments", "Reconcile unresolved payment intents and refunds in the current workspace", ["rental-os:finance:reconcile"], true, undefined, "PaymentReconciliationSummary", [queryParam("limit", numberSchema)]),
  backlogOperation("post", "/api/rental/v1/payment-reconciliation/statements", "Payments", "importRentalPaymentStatement", "Import a tenant-scoped payment provider statement without mutating payment facts", ["rental-os:finance:reconcile"], true, "ImportPaymentStatementRequest", "PaymentStatementBatchDetail"),
  backlogOperation("get", "/api/rental/v1/payment-reconciliation/statements", "Payments", "listRentalPaymentStatements", "List imported payment provider statements for the current workspace", ["rental-os:finance:reconcile"], true, undefined, "PaymentStatementBatchList", [queryParam("limit", numberSchema)]),
  backlogOperation("get", "/api/rental/v1/payment-reconciliation/statements/{batchId}", "Payments", "getRentalPaymentStatement", "Get one imported payment provider statement and its differences", ["rental-os:finance:reconcile"], true, undefined, "PaymentStatementBatchDetail"),
  backlogOperation("post", "/api/rental/v1/payment-reconciliation/statements/{batchId}/lines/{lineId}/review", "Payments", "reviewRentalPaymentStatementLine", "Acknowledge or query one payment statement difference without changing funding facts", ["rental-os:finance:reconcile"], true, "ReviewPaymentStatementLineRequest", "PaymentStatementBatchDetail"),
  backlogOperation("get", "/api/rental/v1/customer-coupons", "RentalBusiness", "listRentalCustomerCoupons", "List customer coupons", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/customer-coupons/{id}/void", "RentalBusiness", "voidRentalCustomerCoupon", "Void an available customer coupon with a reason", ["rental-os:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/customer-coupons/claim", "RentalBusiness", "claimRentalCustomerCoupon", "Claim customer coupon", ["rental-os:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/rewards", "RentalBusiness", "listRentalRewardLedger", "List reward ledger", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/rental/v1/benefit-accounts", "RentalBusiness", "listRentalBenefitAccounts", "List customer benefit accounts", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/grant", "RentalBusiness", "grantRentalReward", "Grant idempotent membership reward", ["rental-os:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/{id}/reverse", "RentalBusiness", "reverseRentalReward", "Reverse membership reward", ["rental-os:member:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-templates", "RentalBusiness", "listRentalNotificationTemplates", "List tenant notification templates", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-templates", "RentalBusiness", "createRentalNotificationTemplate", "Create tenant notification template", ["system:integration:manage"]),
  backlogOperation("put", "/api/rental/v1/notification-templates/{id}", "RentalBusiness", "updateRentalNotificationTemplate", "Update tenant notification template", ["system:integration:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-logs", "RentalBusiness", "listRentalNotificationLogs", "List notification send logs", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/retry-due", "RentalBusiness", "retryDueRentalNotifications", "Retry due business SMS notifications", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/{id}/query-delivery", "RentalBusiness", "queryRentalNotificationDelivery", "Query provider delivery receipt for one SMS notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-logs/{id}/retry", "RentalBusiness", "retryRentalNotification", "Retry one business SMS notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/rental/v1/notifications/send", "RentalBusiness", "sendRentalNotification", "Render and send tenant notification", ["system:integration:manage"]),
  backlogOperation("post", "/api/payments/webhooks/alipay", "Integrations", "receiveAlipayPaymentWebhook", "Receive and verify an Alipay payment notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/wechat_pay", "Integrations", "receiveWechatPaymentWebhook", "Receive and verify a WeChat Pay API v3 notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/stripe", "Integrations", "receiveStripeWebhook", "Receive and verify a Stripe webhook (checkout session and refund events)", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/alipay/refund", "Integrations", "receiveAlipayRefundWebhook", "Receive a signed Alipay refund notification when the provider supplies a definitive result", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/payments/webhooks/wechat_pay/refund", "Integrations", "receiveWechatRefundWebhook", "Receive and verify a WeChat Pay API v3 refund result notification", [], false, "GenericObject", "GenericObject"),
  backlogOperation("post", "/api/rental/v1/quotes", "RentalBusiness", "createRentalQuote", "Create server-side rental quote", ["rental-os:order:operate"]),
  backlogOperation("get", "/api/rental/v1/quotes/{id}", "RentalBusiness", "getRentalQuote", "Get rental quote snapshot", ["rental-os:order:view"]),

  // CLIENT-01：移动端/小程序独立 API。客户端路径不使用运营 RBAC 权限码，
  // 但受独立客户 bearer token 保护；这里使用字段级 schema 供小程序/App 生成客户端。
  clientOperation("get", "/api/client/v1/tenants/{tenantCode}/workspaces", "listClientWorkspaces", "List active workspaces for client registration", { responseSchema: "ClientWorkspaceDirectory", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/registration/challenges", "createClientRegistrationChallenge", "Create a client registration verification challenge", { requestSchema: "ClientRegistrationChallengeRequest", responseSchema: "ClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("get", "/api/client/v1/public/bootstrap", "getClientChannelBootstrap", "Public client channel bootstrap: brand, agreements, service phone, help, banner, published services, login methods and capability flags; client=wechat_miniprogram|app|web overlays channel capabilities, and client=web additionally returns the website-only config block", { responseSchema: "ClientChannelBootstrapResponse", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "client", in: "query", schema: { type: "string", enum: ["wechat_miniprogram", "app", "web"] } }, { name: "appId", in: "query", schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/site-resolve", "resolveClientWebsiteHost", "Public host-to-tenant resolution for the tenant website: returns the tenantCode bound to a custom domain (enabled website channel only), or null when unbound", { responseSchema: "ClientWebsiteHostResolution", authRequired: false, parameters: [{ name: "host", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/documents/{kind}", "getClientPublicDocument", "Public document body (user agreement / privacy policy / help) from the tenant client channel profile; rendered in-client, guest-readable", { responseSchema: "ClientPublicDocumentResponse", authRequired: false, parameters: [{ name: "kind", in: "path", required: true, schema: { type: "string", enum: ["user_agreement", "privacy_policy", "help"] } }, { name: "tenantCode", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/catalog", "getClientPublicCatalog", "Guest catalog for a service published to the mini-program channel (same whitelisted projection as the member catalog)", { responseSchema: "ClientCatalog", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "service", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/website-assets/{tenantCode}/{assetId}", "getClientWebsiteAsset", "Public tenant brand image (logo/favicon/hero/category) by tenantCode + assetId", { rawResponseContentType: "image/*", authRequired: false, parameters: [{ name: "tenantCode", in: "path", required: true, schema: stringSchema }, { name: "assetId", in: "path", required: true, schema: stringSchema }] }),
  clientOperation("get", "/api/client/v1/public/catalog/items/{itemGroupId}/images/{imageId}", "getClientPublicCatalogItemImage", "Guest catalog image for a published service", { rawResponseContentType: "image/*", authRequired: false, parameters: [{ name: "tenantCode", in: "query", required: true, schema: stringSchema }, { name: "service", in: "query", required: true, schema: stringSchema }] }),
  clientOperation("post", "/api/client/v1/auth/challenges", "createClientChallenge", "Create a purpose-bound verification challenge (registration or login)", { requestSchema: "ClientChallengeRequest", responseSchema: "ClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/sms-login", "clientSmsLogin", "Login with a login-purpose SMS proof for an already registered phone", { requestSchema: "ClientSmsLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/wechat/phone-login", "clientWechatPhoneLogin", "WeChat mini-program phone-number login; openid and phone are resolved server-side with the merchant AppSecret", { requestSchema: "ClientWechatPhoneLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/wechat/bind", "bindClientWechatIdentity", "Bind the current WeChat identity to the logged-in customer for mini-program payment", { requestSchema: "ClientWechatBindRequest", responseSchema: "ClientWechatBindResponse" }),
  clientOperation("get", "/api/client/v1/auth/closure/preview", "previewClientAccountClosure", "Tenant-wide closure preflight for the current customer", { responseSchema: "ClientAccountClosurePreview" }),
  clientOperation("post", "/api/client/v1/auth/closure/challenge", "createClientClosureChallenge", "Send the closure verification code to the current account phone", { responseSchema: "ClientRegistrationChallengeResponse" }),
  clientOperation("post", "/api/client/v1/auth/closure", "closeClientAccount", "Close the current membership and login account after preflight and SMS proof", { requestSchema: "ClientAccountClosureRequest", responseSchema: "ClientAccountClosureResponse" }),
  clientOperation("post", "/api/client/v1/auth/registration/challenges/{challengeId}/verify", "verifyClientRegistrationChallenge", "Verify a client registration challenge", { requestSchema: "VerifyClientRegistrationChallengeRequest", responseSchema: "VerifyClientRegistrationChallengeResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/register", "registerClientPersonalMembership", "Register a personal client membership", { requestSchema: "ClientPersonalMembershipRegistrationRequest", responseSchema: "ClientPersonalMembershipRegistrationResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/login", "clientLogin", "Login a customer client account", { requestSchema: "ClientMembershipLoginRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/refresh", "refreshClientSession", "Refresh a customer client session", { requestSchema: "ClientRefreshRequest", responseSchema: "ClientMembershipSessionResponse", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/logout", "logoutClientSession", "Revoke a customer client session", { requestSchema: "ClientRefreshRequest", responseSchema: "ClientActionResult", authRequired: false }),
  clientOperation("post", "/api/client/v1/auth/switch-workspace", "switchClientWorkspace", "Switch the current customer client session to an authorized workspace", { requestSchema: "ClientSwitchWorkspaceRequest", responseSchema: "ClientMembershipSessionResponse" }),
  clientOperation("get", "/api/client/v1/auth/me", "getClientMe", "Get the current customer client profile", { responseSchema: "ClientMembershipStatus" }),
  clientOperation("post", "/api/client/v1/auth/change-password", "changeClientPassword", "Change the current customer client password", { requestSchema: "ClientChangePasswordRequest", responseSchema: "ClientActionResult" }),
  clientOperation("get", "/api/client/v1/config", "getClientConfig", "Get client-safe workspace configuration and feature availability", { responseSchema: "ClientConfig" }),
  clientOperation("get", "/api/client/v1/payment/capabilities", "getClientPaymentCapabilities", "Get client payment capability status without exposing a provider", { responseSchema: "ClientPaymentCapabilities" }),
  clientOperation("get", "/api/client/v1/profile", "getClientProfile", "Get the current customer profile and masked contact data", { responseSchema: "ClientProfile" }),
  clientOperation("patch", "/api/client/v1/profile", "updateClientProfile", "Update the editable part of the current customer profile", { requestSchema: "ClientProfileUpdateRequest", responseSchema: "ClientProfile" }),
  clientOperation("put", "/api/client/v1/profile", "updateClientProfileViaPut", "PUT alias of the partial profile update for hosts without PATCH support (WeChat mini program)", { requestSchema: "ClientProfileUpdateRequest", responseSchema: "ClientProfile" }),
  clientOperation("get", "/api/client/v1/profile/contacts", "listClientContacts", "List the current customer contacts", { responseSchema: "ClientContacts" }),
  clientOperation("put", "/api/client/v1/profile/contacts", "saveClientContact", "Create or update a current customer contact", { requestSchema: "ClientContactRequest", responseSchema: "ClientContact" }),
  clientOperation("get", "/api/client/v1/profile/addresses", "listClientDeliveryAddresses", "List the current customer's delivery addresses", { responseSchema: "ClientDeliveryAddressList" }),
  clientOperation("put", "/api/client/v1/profile/addresses", "saveClientDeliveryAddress", "Create or update one of the current customer's delivery addresses", { requestSchema: "ClientDeliveryAddressRequest", responseSchema: "ClientDeliveryAddress" }),
  clientOperation("delete", "/api/client/v1/profile/addresses/{addressId}", "deleteClientDeliveryAddress", "Soft-delete one of the current customer's delivery addresses (order snapshots unaffected)", { responseSchema: "ClientActionResult" }),
  clientOperation("delete", "/api/client/v1/profile/contacts/{contactId}", "deleteClientContact", "Deactivate a current customer contact", { responseSchema: "ClientActionResult" }),
  clientOperation("get", "/api/client/v1/membership/status", "getClientMembershipStatus", "Get current customer membership and review status", { responseSchema: "ClientMembershipStatus" }),
  clientOperation("get", "/api/client/v1/notifications", "listClientNotifications", "List notifications for the current customer orders", { responseSchema: "ClientNotificationList", parameters: [queryParam("page", numberSchema), queryParam("pageSize", numberSchema)] }),
  clientOperation("get", "/api/client/v1/membership/booking-options", "listClientBookingOptions", "List personal and enterprise booking identities", { responseSchema: arrayOf(ref("ClientBookingOption")) }),
  clientOperation("get", "/api/client/v1/membership/plans", "listClientMembershipPlans", "List published APP-visible membership plans for the current workspace", { responseSchema: "ClientMembershipPlans" }),
  clientOperation("get", "/api/client/v1/membership/assignments", "listClientMembershipAssignments", "List the current customer's membership plan assignments", { responseSchema: "ClientMembershipAssignments" }),
  clientOperation("get", "/api/client/v1/membership/benefits", "getClientMembershipBenefits", "Resolve personal and optionally selected enterprise benefits", { responseSchema: "ClientMembershipBenefits", parameters: [queryParam("corporateCustomerId", stringSchema)] }),
  clientOperation("get", "/api/client/v1/membership/corporates", "listClientCorporateIdentities", "List active enterprise identities available to the current personal member", { responseSchema: "ClientCorporateIdentities" }),
  clientOperation("get", "/api/client/v1/membership/qualification-types", "listClientQualificationTypes", "List qualification types for the current workspace", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("get", "/api/client/v1/membership/qualifications", "listClientQualifications", "List current customer qualification submissions", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("post", "/api/client/v1/membership/qualifications", "submitClientQualification", "Submit a customer qualification for review", { requestSchema: "ClientQualificationRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/membership/qualifications/files", "createClientQualificationUploadSession", "Create a client qualification evidence upload session bound to the current customer", { requestSchema: "ClientQualificationUploadSessionRequest", responseSchema: "FileUploadSessionSummary" }),
  clientOperation("post", "/api/client/v1/membership/qualifications/files/{sessionId}/complete", "completeClientQualificationUpload", "Complete a client qualification evidence upload", { requestSchema: "ClientQualificationUploadCompleteRequest", responseSchema: objectSchema }),
  clientOperation("get", "/api/client/v1/membership/qualifications/files/{fileAssetId}/download-url", "getClientQualificationFileUrl", "Create a short-lived URL for the current customer's qualification evidence", { responseSchema: "FileDownloadUrlSummary" }),
  clientOperation("get", "/api/client/v1/catalog", "getClientCatalog", "Get the current workspace client catalog", { responseSchema: "ClientCatalog" }),
  clientOperation("get", "/api/client/v1/catalog/items/{itemGroupId}/images/{imageId}", "getClientCatalogItemImage", "Get a client-authenticated catalog item image", { responseSchema: { type: "string", format: "binary" }, rawResponseContentType: "image/*" }),
  clientOperation("post", "/api/client/v1/availability", "getClientAvailability", "Check rental availability for the client", { requestSchema: "ClientAvailabilityRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/quotes", "createClientQuote", "Create a server-side client rental quote", { requestSchema: "ClientQuoteRequest", responseSchema: "ClientQuote" }),
  clientOperation("get", "/api/client/v1/quotes/{id}", "getClientQuote", "Get a client rental quote", { responseSchema: "ClientQuote" }),
  clientOperation("get", "/api/client/v1/coupons", "listClientCoupons", "List current customer coupons", { responseSchema: arrayOf(objectSchema) }),
  clientOperation("post", "/api/client/v1/coupons/{templateId}/claim", "claimClientCoupon", "Claim an available customer coupon", { responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/orders", "createClientOrder", "Create a rental order from a client quote", { requestSchema: "ClientCreateOrderRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/my/orders", "listClientMyOrders", "Read-only paginated index of this personal customer's orders across the current tenant's workspaces; does not switch session or grant workspace access", { responseSchema: "ClientMyOrdersResponse", parameters: [queryParam("page", { type: "integer", minimum: 1, maximum: 1000000 }), queryParam("pageSize", { type: "integer", minimum: 1, maximum: 50 })] }),
  clientOperation("get", "/api/client/v1/orders", "listClientOrders", "List the current customer orders", { responseSchema: "ClientOrderList", parameters: [queryParam("page", numberSchema), queryParam("pageSize", numberSchema), queryParam("status")] }),
  clientOperation("get", "/api/client/v1/orders/{id}", "getClientOrder", "Get a customer order", { responseSchema: "ClientOrder" }),
  clientOperation("get", "/api/client/v1/orders/{id}/fulfillment", "getClientOrderFulfillment", "Get customer-visible fulfillment and allocation progress", { responseSchema: "ClientFulfillment" }),
  clientOperation("get", "/api/client/v1/orders/{id}/documents/{type}", "getClientOrderDocument", "Render a customer-readable order document snapshot for the current member", { responseSchema: "GenericObject" }),
  clientOperation("get", "/api/client/v1/orders/{id}/documents/{type}/versions", "listClientOrderDocumentVersions", "List immutable document versions for the current member order", { responseSchema: "GenericObject" }),
  clientOperation("get", "/api/client/v1/orders/{id}/fee-items", "listClientFeeItems", "Approved inspection charges that need the customer's confirmation or dispute", { responseSchema: "ClientFeeItemsResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/fee-items/{inspectionId}/{exceptionIndex}/response", "respondClientFeeItem", "Record the customer's confirmation or dispute for an approved inspection charge (append-only)", { requestSchema: "ClientFeeResponseRequest", responseSchema: "ClientFeeResponseResult" }),
  clientOperation("post", "/api/client/v1/orders/{id}/cancel/preview", "previewClientCancellation", "Preview the existing cancellation charge without cancelling or refunding; final cancellation rechecks state and time", { responseSchema: "ClientCancellationPreview" }),
  clientOperation("post", "/api/client/v1/orders/{id}/cancel", "cancelClientOrder", "Cancel a customer order", { requestSchema: "ClientCancelOrderRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/orders/{id}/extensions", "listClientOrderExtensions", "List customer order extensions", { responseSchema: "ClientExtensionList" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions/preview", "previewClientOrderExtension", "Preview a customer order extension", { requestSchema: "ClientOrderExtensionRequest", responseSchema: "ClientExtensionPreview" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions", "applyClientOrderExtension", "Apply a customer order extension", { requestSchema: "ClientOrderExtensionRequest", responseSchema: "ClientOrderMutation" }),
  clientOperation("post", "/api/client/v1/orders/{id}/extensions/{extensionId}/pay", "payClientOrderExtension", "Complete a customer order extension after payment", { responseSchema: "ClientOrderMutation" }),
  clientOperation("get", "/api/client/v1/orders/{id}/funding", "getClientOrderFunding", "Get customer order funding status", { responseSchema: "ClientFunding" }),
  clientOperation("post", "/api/client/v1/orders/{id}/funding/simulate", "simulateClientOrderFunding", "Record a development-only simulated customer funding event", { requestSchema: "ClientPaymentSimulationRequest", responseSchema: objectSchema }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents", "createClientPaymentIntent", "Create a real Alipay or WeChat Pay rental payment intent", { requestSchema: "ClientPaymentIntentRequest", responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/mini-program-payment-intents", "createClientMiniProgramPaymentIntent", "Create a WeChat JSAPI rental payment intent; the payer openid comes only from the server-side WeChat identity binding (409 wechat_identity_required when absent), never from the request body or Native QR parameters", { requestSchema: "ClientMiniProgramPaymentIntentRequest", responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("get", "/api/client/v1/orders/{id}/payment-intents/{intentId}", "getClientPaymentIntent", "Get the status of a client payment intent", { responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents/{intentId}/refresh", "refreshClientPaymentIntent", "Query the payment provider and reconcile a client payment intent", { responseSchema: "ClientPaymentIntentResponse" }),
  clientOperation("post", "/api/client/v1/orders/{id}/payment-intents/{intentId}/close", "closeClientPaymentIntent", "Close an unpaid client payment intent", { responseSchema: "ClientPaymentIntentResponse" })
]; }

export const OPENAPI_DOCUMENT = {
  openapi: "3.0.3",
  info: {
    title: "Rental OS API",
    version: "0.1.0",
    description:
      "Internal OpenAPI contract for the Rental OS platform. Runtime responses are wrapped as { data, requestId } unless the path is /api/openapi.json."
  },
  servers: [
    {
      url: "http://localhost:3000"
    }
  ],
  tags: [
    { name: "Contract" },
    { name: "Health" },
    { name: "Auth" },
    { name: "Platform" },
    { name: "RentalOS" },
    { name: "Dispatch" },
    { name: "MasterData" },
    { name: "Customer" },
    { name: "Order" },
    { name: "RentalCore" },
    { name: "RentalBusiness" },
    { name: "Reports" }
  ],
  paths: buildPaths(API_CONTRACT_OPERATIONS),
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer"
      }
    },
    schemas: OPENAPI_COMPONENT_SCHEMAS
  }
};
