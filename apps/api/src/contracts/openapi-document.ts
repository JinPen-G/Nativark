type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

interface SchemaObject {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  items?: SchemaObject;
  properties?: Record<string, SchemaObject>;
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
          "application/json": {
            schema:
              config.path === "/api/openapi.json"
                ? toSchema(config.responseSchema)
                : apiResult(config.responseSchema)
          }
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
  OpenApiDocument: objectSchema,
  GenericObject: objectSchema,
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
  LoginResponse: objectOf(
    {
      accessToken: stringSchema,
      refreshToken: stringSchema,
      expiresIn: numberSchema,
      tenant: ref("TenantContext"),
      user: ref("AuthUser")
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
      organizationId: stringSchema,
      organizationName: stringSchema,
      isPlatformAdmin: booleanSchema,
      isSaasAdmin: booleanSchema,
      mustChangePassword: booleanSchema,
      permissions: arrayOf(stringSchema)
    },
    ["id", "tenantId", "account", "displayName", "roleNames", "scope"]
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
  StoreRentalRuleConfig: objectSchema,
  StoreRentalRuleVersionRecord: objectSchema,
  PricingPlanSummary: objectSchema,
  PricingPlanDetail: objectSchema,
  PricingQuoteRequest: objectOf(
    {
      planId: stringSchema,
      vehicleGroupCode: stringSchema,
      pickupStoreCode: stringSchema,
      returnStoreCode: stringSchema,
      pickupAt: { type: "string", format: "date-time" },
      returnAt: { type: "string", format: "date-time" },
      billingMode: stringSchema,
      serviceCodes: arrayOf(stringSchema),
      corporateId: stringSchema
    },
    ["planId", "vehicleGroupCode", "pickupStoreCode", "returnStoreCode", "pickupAt", "returnAt", "billingMode"]
  ),
  PricingQuoteResult: objectSchema,
  StoreRentalAvailabilityRequest: objectOf(
    {
      mode: stringSchema,
      pickupStoreCode: stringSchema,
      returnStoreCode: stringSchema,
      pickupAt: { type: "string", format: "date-time" },
      returnAt: { type: "string", format: "date-time" },
      vehicleGroupCodes: arrayOf(stringSchema)
    },
    ["mode", "pickupStoreCode", "returnStoreCode", "pickupAt", "returnAt"]
  ),
  StoreRentalAvailabilityResult: objectSchema,
  WorkflowTransition: objectSchema,
  StoreRentalDispatchBoard: objectSchema,
  StoreRentalDispatchTaskPool: objectSchema,
  StoreRentalDispatchEvent: objectSchema,
  StoreRentalDispatchOptimizeRequest: objectSchema,
  StoreRentalDispatchApplyRequest: objectSchema,
  StoreRentalDispatchHardLockRequest: objectSchema,
  StoreRentalDispatchManualReassignRequest: objectSchema,
  StoreRentalDispatchPlan: objectSchema,
  StoreRentalDispatchApplyResult: objectSchema,
  StoreStationSummary: objectSchema,
  StoreStationHierarchyNode: objectSchema,
  StationCapacityRefreshResult: objectSchema,
  VehicleGroupMaster: objectSchema,
  DeleteVehicleGroupResult: objectSchema,
  VehicleInstanceSummary: objectOf(
    {
      id: stringSchema,
      licensePlate: stringSchema,
      vin: stringSchema,
      vehicleGroupName: stringSchema,
      assetCompanyName: stringSchema,
      currentStoreName: stringSchema,
      currentStationName: stringSchema,
      operationStatus: stringSchema,
      enabled: booleanSchema,
      currentServiceType: stringSchema,
      serviceTypes: arrayOf(stringSchema),
      mileage: numberSchema,
      color: stringSchema,
      cid: stringSchema,
      isSpecial: booleanSchema,
      disabledReason: stringSchema,
      maintenanceReason: stringSchema,
      tags: arrayOf(stringSchema)
    },
    [
      "id",
      "licensePlate",
      "vin",
      "vehicleGroupName",
      "assetCompanyName",
      "currentStoreName",
      "currentStationName",
      "operationStatus",
      "enabled",
      "currentServiceType",
      "serviceTypes",
      "mileage",
      "color",
      "isSpecial"
    ]
  ),
  StoreRentalVehicleDetail: objectSchema,
  CreateVehicleLocationEventRequest: objectSchema,
  UpdateVehicleLocationEventRequest: objectSchema,
  CreateVehicleConditionPhotoRecordRequest: objectSchema,
  CreateVehicleMaintenanceRecordRequest: objectSchema,
  UpdateVehicleMaintenanceRecordRequest: objectSchema,
  CreateVehicleAccidentRecordRequest: objectSchema,
  UpdateVehicleAccidentRecordRequest: objectSchema,
  UpdateVehicleStatusRequest: objectSchema,
  VehicleStatusActionResult: objectSchema,
  StoreValueAddedServiceSummary: objectSchema,
  MemberSummary: objectSchema,
  MemberDetail: objectSchema,
  SaveMemberRequest: objectSchema,
  ProcessMemberRiskRequest: objectSchema,
  ProcessMemberRiskResult: objectSchema,
  MemberReviewTask: objectSchema,
  ProcessMemberReviewRequest: objectSchema,
  MembershipPlanSummary: objectSchema,
  SaveMembershipPlanRequest: objectSchema,
  CorporateSummary: objectSchema,
  CorporateDetail: objectSchema,
  SaveCorporateRequest: objectSchema,
  CorporateMonthlyBillSummary: objectSchema,
  SettleCorporateMonthlyBillRequest: objectSchema,
  StoreRentalOrderSummary: objectSchema,
  StoreRentalOrderDetail: objectSchema,
  StoreRentalFeeCenter: objectSchema,
  CreateStoreRentalOrderRequest: objectOf(
    {
      quoteNo: stringSchema,
      memberId: stringSchema,
      corporateId: stringSchema,
      customerName: stringSchema,
      customerPhone: stringSchema,
      corporateShortName: stringSchema,
      billingMode: stringSchema,
      collectionMode: stringSchema
    },
    ["quoteNo", "customerName", "customerPhone", "billingMode", "collectionMode"]
  ),
  CreateStoreRentalOrderResult: objectSchema,
  StoreRentalOrderActionRequest: objectSchema,
  StoreRentalOrderActionResult: objectSchema,
  CreateStoreRentalFeeRequest: objectSchema,
  CreateStoreRentalTransactionRequest: objectSchema,
  WaiveStoreRentalFeeRequest: objectSchema,
  // ===== 2026-06-25 新增的 Schema 定义 =====
  StoreRentalContractCenter: objectSchema,
  StoreRentalContractTemplate: objectSchema,
  StoreRentalContractPrintRequest: objectSchema,
  StoreRentalContractPrintResult: objectSchema,
  StoreRentalContractMockSignRequest: objectSchema,
  StoreRentalContractMockSignResult: objectSchema,
  StoreRentalDispatchCloseTaskRequest: objectSchema,
  FinancePreAuthorizationRow: objectSchema,
  SaveFinancePreAuthorizationRequest: objectSchema,
  StoreRentalOrderNotificationRecord: objectSchema,
  StoreRentalOrderOperationRecord: objectSchema,
  CloseStoreRentalRemarkRequest: objectSchema,
  AdvanceVehicleTransferTaskRequest: objectSchema,
  // ===== 2026-06-25 DP-01 调度任务认领新增的 Schema =====
  StoreRentalDispatchClaimTaskRequest: objectSchema,
  StoreRentalDispatchProcessTaskRequest: objectSchema,
  StoreRentalDispatchTaskActionResult: objectSchema
};

function backlogOperation(
  method: HttpMethod,
  path: string,
  tag: string,
  operationId: string,
  summary: string,
  permissions: string[] = [],
  authRequired = true
): ContractOperation {
  return {
    method,
    path,
    tag,
    operationId,
    summary,
    permissions,
    authRequired,
    requestSchema: method === "get" || method === "delete" ? undefined : "GenericObject",
    responseSchema: "GenericObject"
  };
}

const INTEGRATION_BACKLOG_OPERATIONS: ContractOperation[] = [
  backlogOperation("get", "/api/files", "Files", "listFileAssets", "List file assets", ["system:files:manage"]),
  backlogOperation("post", "/api/files", "Files", "createFileAsset", "Create file asset", ["system:files:manage"]),
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
  // SPACE-01：经营空间主档与成员关系的最小管理面。
  // 刻意没有"切换当前空间"操作——会话空间上下文属 SPACE-02。
  backlogOperation("get", "/api/platform/workspaces", "Platform", "listBusinessWorkspaces", "List business workspaces", ["system:org:manage"]),
  backlogOperation("post", "/api/platform/workspaces", "Platform", "createBusinessWorkspace", "Create business workspace", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}", "Platform", "updateBusinessWorkspace", "Update business workspace", ["system:org:manage"]),
  backlogOperation("get", "/api/platform/workspaces/{id}/members", "Platform", "listWorkspaceMembers", "List workspace members", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/workspaces/{id}/members", "Platform", "saveWorkspaceMember", "Save workspace member", ["system:org:manage"]),
  // SPACE-04：租户共享客户主档与空间接入。
  // customers 按租户共享（跨空间可见是设计），workspace-customers 按当前会话空间隔离。
  backlogOperation("get", "/api/platform/customers", "Platform", "listSharedCustomers", "List tenant shared customers", ["store-rental:member:view"]),
  backlogOperation("post", "/api/platform/customers", "Platform", "registerSharedCustomer", "Register shared customer in current workspace", ["store-rental:member:manage"]),
  backlogOperation("get", "/api/platform/workspace-customers", "Platform", "listWorkspaceCustomers", "List customers linked to current workspace", ["store-rental:member:view"]),
  backlogOperation("post", "/api/platform/workspace-customers", "Platform", "linkCustomerToWorkspace", "Link existing shared customer to current workspace", ["store-rental:member:manage"]),
  backlogOperation("post", "/api/platform/organizations", "Platform", "createOrganization", "Create organization", ["system:org:manage"]),  backlogOperation("put", "/api/platform/organizations/{id}", "Platform", "updateOrganization", "Update organization", ["system:org:manage"]),
  backlogOperation("put", "/api/platform/organizations/{id}/status", "Platform", "setOrganizationStatus", "Set organization status", ["system:org:manage"]),
  backlogOperation("get", "/api/reports/dashboard", "Reports", "getReportsDashboard", "Get reports dashboard", ["reports:view"]),
  backlogOperation("get", "/api/reports/exports", "Reports", "listReportExports", "List report exports", ["reports:view"]),
  backlogOperation("post", "/api/reports/exports", "Reports", "createReportExport", "Create report export", ["reports:export"]),
  backlogOperation("get", "/api/reports/finance", "Reports", "getFinanceReport", "Get finance report", ["reports:view"]),
  backlogOperation("get", "/api/reports/risk", "Reports", "getRiskReport", "Get risk report", ["reports:view"]),
  backlogOperation("get", "/api/reports/ops/health", "Reports", "getReportsOpsHealth", "Get reports ops health", ["reports:view"]),
  backlogOperation("get", "/api/reports/ops/logs", "Reports", "listReportsOpsLogs", "List reports ops logs", ["reports:view"]),
  backlogOperation("get", "/api/reports/orders", "Reports", "getOrderReport", "Get order report", ["reports:view"]),
  backlogOperation("get", "/api/reports/vehicles", "Reports", "getVehicleReport", "Get vehicle report", ["reports:view"]),
  backlogOperation("post", "/api/store-rental/dispatch/ai-analysis", "Dispatch", "runDispatchAiAnalysis", "Run dispatch AI analysis", ["store-rental:dispatch:manage"]),
  backlogOperation("post", "/api/store-rental/dispatch/vehicle-unavailable", "Dispatch", "markDispatchVehicleUnavailable", "Mark dispatch vehicle unavailable", ["store-rental:dispatch:manage"]),
  backlogOperation("get", "/api/store-rental/finance/documents", "Finance", "listFinanceDocuments", "List finance documents", ["store-rental:finance:view"]),
  backlogOperation("post", "/api/store-rental/finance/documents", "Finance", "createFinanceDocument", "Create finance document", ["store-rental:finance:manage"]),
  backlogOperation("put", "/api/store-rental/finance/documents/{id}", "Finance", "updateFinanceDocument", "Update finance document", ["store-rental:finance:manage"]),
  backlogOperation("get", "/api/store-rental/finance/manual-adjustments", "Finance", "listManualAdjustments", "List manual adjustments", ["store-rental:finance:view"]),
  backlogOperation("post", "/api/store-rental/finance/manual-adjustments", "Finance", "createManualAdjustment", "Create manual adjustment", ["store-rental:finance:manage"]),
  backlogOperation("post", "/api/store-rental/finance/manual-adjustments/{id}/process", "Finance", "processManualAdjustment", "Process manual adjustment", ["store-rental:finance:manage"]),
  backlogOperation("get", "/api/store-rental/finance/overview", "Finance", "getFinanceOverview", "Get finance overview", ["store-rental:finance:view"]),
  backlogOperation("get", "/api/store-rental/finance/reconciliation", "Finance", "getFinanceReconciliation", "Get finance reconciliation", ["store-rental:finance:view"]),
  backlogOperation("get", "/api/store-rental/finance/transactions", "Finance", "listFinanceTransactions", "List finance transactions", ["store-rental:finance:view"]),
  backlogOperation("get", "/api/store-rental/marketing/plans", "Marketing", "listMarketingPlans", "List marketing plans", ["store-rental:pricing:view"]),
  backlogOperation("post", "/api/store-rental/marketing/plans", "Marketing", "createMarketingPlan", "Create marketing plan", ["store-rental:pricing:manage"]),
  backlogOperation("get", "/api/store-rental/marketing/plans/{id}", "Marketing", "getMarketingPlan", "Get marketing plan", ["store-rental:pricing:view"]),
  backlogOperation("put", "/api/store-rental/marketing/plans/{id}", "Marketing", "updateMarketingPlan", "Update marketing plan", ["store-rental:pricing:manage"]),
  backlogOperation("post", "/api/store-rental/orders/{id}/contracts", "Order", "createOrderContract", "Create order contract", ["store-rental:order:operate"]),
  backlogOperation("get", "/api/store-rental/orders/{id}/fulfillment", "Order", "getOrderFulfillment", "Get order fulfillment", ["store-rental:order:view"]),
  backlogOperation("post", "/api/store-rental/orders/{id}/notifications", "Order", "createOrderNotification", "Create order notification", ["store-rental:order:operate"]),
  backlogOperation("post", "/api/store-rental/orders/{id}/operation-locks", "Order", "createOrderOperationLock", "Create order operation lock", ["store-rental:order:operate"]),
  backlogOperation("post", "/api/store-rental/orders/{id}/remarks", "Order", "createOrderRemark", "Create order remark", ["store-rental:order:operate"]),
  backlogOperation("put", "/api/store-rental/pricing/plans/{id}", "Pricing", "updatePricingPlan", "Update pricing plan", ["store-rental:pricing:manage"]),
  backlogOperation("post", "/api/store-rental/pricing/schedules", "Pricing", "createPriceSchedule", "Create price schedule", ["store-rental:pricing:manage"]),
  backlogOperation("patch", "/api/store-rental/pricing/schedules/{id}/cancel", "Pricing", "cancelPriceSchedule", "Cancel price schedule", ["store-rental:pricing:manage"]),
  backlogOperation("get", "/api/store-rental/stations/{id}/calendar", "MasterData", "getStationCalendar", "Get station calendar", ["store-rental:station:view"]),
  backlogOperation("put", "/api/store-rental/stations/{id}/calendar", "MasterData", "saveStationCalendar", "Save station calendar", ["store-rental:station:manage"]),
  backlogOperation("get", "/api/store-rental/stations/capacity-snapshots", "MasterData", "listStationCapacitySnapshots", "List station capacity snapshots", ["store-rental:station:view"]),
  backlogOperation("get", "/api/store-rental/tbox-devices", "MasterData", "listStoreRentalTboxDevices", "List store rental TBox devices", ["store-rental:vehicle:view"]),
  backlogOperation("put", "/api/store-rental/tbox-devices/{id}/binding", "MasterData", "updateStoreRentalTboxBinding", "Update store rental TBox binding", ["store-rental:vehicle:manage"]),
  backlogOperation("post", "/api/store-rental/tbox-devices/{id}/commands", "MasterData", "runStoreRentalTboxCommand", "Run store rental TBox command", ["store-rental:vehicle:manage"]),
  backlogOperation("get", "/api/store-rental/vehicles/{id}/credentials", "MasterData", "listVehicleCredentials", "List vehicle credentials", ["store-rental:vehicle:view"]),
  backlogOperation("put", "/api/store-rental/vehicles/{id}/credentials", "MasterData", "saveVehicleCredential", "Save vehicle credential", ["store-rental:vehicle:manage"]),
  backlogOperation("get", "/api/store-rental/vehicles/{id}/onboard-items", "MasterData", "listVehicleOnboardItems", "List vehicle onboard items", ["store-rental:vehicle:view"]),
  backlogOperation("put", "/api/store-rental/vehicles/{id}/onboard-items", "MasterData", "saveVehicleOnboardItem", "Save vehicle onboard item", ["store-rental:vehicle:manage"]),
  backlogOperation("get", "/api/store-rental/vehicles/transfer-tasks", "MasterData", "listVehicleTransferTasks", "List vehicle transfer tasks", ["store-rental:vehicle:view"]),
  backlogOperation("post", "/api/store-rental/vehicles/transfer-tasks", "MasterData", "createVehicleTransferTask", "Create vehicle transfer task", ["store-rental:vehicle:manage"])
];

export const API_CONTRACT_OPERATIONS: ContractOperation[] = [
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
  {
    method: "get",
    path: "/api/store-rental/data-dictionary",
    tag: "StoreRental",
    operationId: "getDataDictionary",
    summary: "Get all status/type label mappings",
    permissions: ["store-rental:order:view", "store-rental:vehicle:view", "store-rental:member:view"],
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/store-rental/rules",
    tag: "StoreRental",
    operationId: "getStoreRentalRules",
    summary: "Get store rental rules",
    permissions: ["store-rental:rules:manage"],
    responseSchema: "StoreRentalRuleConfig"
  },
  {
    method: "get",
    path: "/api/store-rental/rules/versions",
    tag: "StoreRental",
    operationId: "listStoreRentalRuleVersions",
    summary: "List store rental rule versions",
    permissions: ["store-rental:rules:manage"],
    responseSchema: arrayOf("StoreRentalRuleVersionRecord")
  },
  {
    method: "get",
    path: "/api/store-rental/rules/versions/{version}",
    tag: "StoreRental",
    operationId: "getStoreRentalRuleVersion",
    summary: "Get store rental rule version",
    permissions: ["store-rental:rules:manage"],
    responseSchema: "StoreRentalRuleVersionRecord"
  },
  {
    method: "put",
    path: "/api/store-rental/rules",
    tag: "StoreRental",
    operationId: "saveStoreRentalRules",
    summary: "Save store rental rules",
    permissions: ["store-rental:rules:manage"],
    requestSchema: "StoreRentalRuleConfig",
    responseSchema: "StoreRentalRuleConfig"
  },
  {
    method: "get",
    path: "/api/store-rental/pricing/plans",
    tag: "StoreRental",
    operationId: "listPricingPlans",
    summary: "List pricing plans",
    permissions: ["store-rental:price:manage"],
    responseSchema: arrayOf("PricingPlanSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/pricing/plans/{id}",
    tag: "StoreRental",
    operationId: "getPricingPlan",
    summary: "Get pricing plan",
    permissions: ["store-rental:price:manage"],
    responseSchema: "PricingPlanDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/pricing/quote",
    tag: "StoreRental",
    operationId: "quotePricing",
    summary: "Quote pricing",
    permissions: ["store-rental:price:manage"],
    requestSchema: "PricingQuoteRequest",
    responseSchema: "PricingQuoteResult"
  },
  {
    method: "get",
    path: "/api/store-rental/pricing/explanation/{quoteNo}",
    tag: "StoreRental",
    operationId: "getPricingExplanation",
    summary: "Get pricing explanation by quote number",
    permissions: ["store-rental:price:manage", "store-rental:order:view"]
  },
  {
    method: "post",
    path: "/api/store-rental/availability",
    tag: "StoreRental",
    operationId: "checkAvailability",
    summary: "Check vehicle group availability",
    permissions: ["store-rental:order:operate", "store-rental:vehicle:view"],
    requestSchema: "StoreRentalAvailabilityRequest",
    responseSchema: "StoreRentalAvailabilityResult"
  },
  {
    method: "get",
    path: "/api/store-rental/workflow",
    tag: "StoreRental",
    operationId: "getWorkflow",
    summary: "Get order workflow transitions",
    permissions: ["store-rental:order:view", "store-rental:order:operate"],
    responseSchema: arrayOf("WorkflowTransition")
  },
  {
    method: "get",
    path: "/api/store-rental/dispatch/board",
    tag: "Dispatch",
    operationId: "getDispatchBoard",
    summary: "Get dispatch board",
    permissions: ["store-rental:dispatch:manage", "store-rental:order:view"],
    parameters: [
      queryParam("windowDays", { type: "integer", format: "int32" }),
      queryParam("referenceDate"),
      queryParam("storeName"),
      queryParam("vehicleGroupName")
    ],
    responseSchema: "StoreRentalDispatchBoard"
  },
  {
    method: "get",
    path: "/api/store-rental/dispatch/tasks",
    tag: "Dispatch",
    operationId: "listDispatchTasks",
    summary: "List dispatch tasks",
    permissions: ["store-rental:dispatch:manage", "store-rental:order:view"],
    parameters: [
      queryParam("windowDays", { type: "integer", format: "int32" }),
      queryParam("referenceDate"),
      queryParam("storeName"),
      queryParam("vehicleGroupName")
    ],
    responseSchema: "StoreRentalDispatchTaskPool"
  },
  {
    method: "get",
    path: "/api/store-rental/dispatch/events",
    tag: "Dispatch",
    operationId: "listDispatchEvents",
    summary: "List dispatch events",
    permissions: ["store-rental:dispatch:manage", "store-rental:order:view"],
    parameters: [
      queryParam("orderId"),
      queryParam("planId"),
      queryParam("limit", { type: "integer", format: "int32" })
    ],
    responseSchema: arrayOf("StoreRentalDispatchEvent")
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/optimize",
    tag: "Dispatch",
    operationId: "previewDispatchOptimization",
    summary: "Preview dispatch optimization",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchOptimizeRequest",
    responseSchema: "StoreRentalDispatchPlan"
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/apply",
    tag: "Dispatch",
    operationId: "applyDispatchOptimization",
    summary: "Apply dispatch optimization",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchApplyRequest",
    responseSchema: "StoreRentalDispatchApplyResult"
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/hard-lock",
    tag: "Dispatch",
    operationId: "hardLockDispatchOrders",
    summary: "Hard lock dispatch orders",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchHardLockRequest",
    responseSchema: "StoreRentalDispatchApplyResult"
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/manual-reassign",
    tag: "Dispatch",
    operationId: "manualReassignFromDispatch",
    summary: "Manual reassign from dispatch board",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchManualReassignRequest",
    responseSchema: "StoreRentalDispatchApplyResult"
  },
  {
    method: "get",
    path: "/api/store-rental/stations",
    tag: "MasterData",
    operationId: "listStations",
    summary: "List stations",
    permissions: ["store-rental:station:view"],
    responseSchema: arrayOf("StoreStationSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/stations/hierarchy",
    tag: "MasterData",
    operationId: "listStationHierarchy",
    summary: "List station hierarchy",
    permissions: ["store-rental:station:view"],
    responseSchema: arrayOf("StoreStationHierarchyNode")
  },
  {
    method: "post",
    path: "/api/store-rental/stations/capacity-snapshots/refresh",
    tag: "MasterData",
    operationId: "refreshStationCapacitySnapshots",
    summary: "Refresh station capacity snapshots",
    permissions: ["store-rental:station:manage"],
    responseSchema: "StationCapacityRefreshResult"
  },
  {
    method: "post",
    path: "/api/store-rental/stations",
    tag: "MasterData",
    operationId: "createStation",
    summary: "Create station",
    permissions: ["store-rental:station:manage"],
    requestSchema: "StoreStationSummary",
    responseSchema: "StoreStationSummary"
  },
  {
    method: "put",
    path: "/api/store-rental/stations/{id}",
    tag: "MasterData",
    operationId: "updateStation",
    summary: "Update station",
    permissions: ["store-rental:station:manage"],
    requestSchema: "StoreStationSummary",
    responseSchema: "StoreStationSummary"
  },
  {
    method: "get",
    path: "/api/store-rental/vehicle-groups",
    tag: "MasterData",
    operationId: "listVehicleGroups",
    summary: "List vehicle groups",
    permissions: ["store-rental:vehicle-group:manage"],
    responseSchema: arrayOf("VehicleGroupMaster")
  },
  {
    method: "post",
    path: "/api/store-rental/vehicle-groups",
    tag: "MasterData",
    operationId: "createVehicleGroup",
    summary: "Create vehicle group",
    permissions: ["store-rental:vehicle-group:manage"],
    requestSchema: "VehicleGroupMaster",
    responseSchema: "VehicleGroupMaster"
  },
  {
    method: "put",
    path: "/api/store-rental/vehicle-groups/{id}",
    tag: "MasterData",
    operationId: "updateVehicleGroup",
    summary: "Update vehicle group",
    permissions: ["store-rental:vehicle-group:manage"],
    requestSchema: "VehicleGroupMaster",
    responseSchema: "VehicleGroupMaster"
  },
  {
    method: "delete",
    path: "/api/store-rental/vehicle-groups/{id}",
    tag: "MasterData",
    operationId: "deleteVehicleGroup",
    summary: "Delete vehicle group",
    permissions: ["store-rental:vehicle-group:manage"],
    responseSchema: "DeleteVehicleGroupResult"
  },
  {
    method: "get",
    path: "/api/store-rental/vehicles",
    tag: "MasterData",
    operationId: "listVehicles",
    summary: "List vehicles",
    permissions: ["store-rental:vehicle:view"],
    responseSchema: arrayOf("VehicleInstanceSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/vehicles/{id}",
    tag: "MasterData",
    operationId: "getVehicleDetail",
    summary: "Get vehicle detail",
    permissions: ["store-rental:vehicle:view"],
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/vehicles/{id}/location-events",
    tag: "MasterData",
    operationId: "createVehicleLocationEvent",
    summary: "Create vehicle location event",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "CreateVehicleLocationEventRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "patch",
    path: "/api/store-rental/vehicles/{id}/location-events/{recordId}",
    tag: "MasterData",
    operationId: "updateVehicleLocationEvent",
    summary: "Update vehicle location event",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "UpdateVehicleLocationEventRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/vehicles/{id}/condition-photos",
    tag: "MasterData",
    operationId: "createVehicleConditionPhotoRecord",
    summary: "Create vehicle condition photo record",
    permissions: ["store-rental:vehicle:manage"],
    requestSchema: "CreateVehicleConditionPhotoRecordRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/vehicles/{id}/maintenance-records",
    tag: "MasterData",
    operationId: "createVehicleMaintenanceRecord",
    summary: "Create vehicle maintenance record",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "CreateVehicleMaintenanceRecordRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "patch",
    path: "/api/store-rental/vehicles/{id}/maintenance-records/{recordId}",
    tag: "MasterData",
    operationId: "updateVehicleMaintenanceRecord",
    summary: "Update vehicle maintenance record",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "UpdateVehicleMaintenanceRecordRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/vehicles/{id}/accident-records",
    tag: "MasterData",
    operationId: "createVehicleAccidentRecord",
    summary: "Create vehicle accident record",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "CreateVehicleAccidentRecordRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "patch",
    path: "/api/store-rental/vehicles/{id}/accident-records/{recordId}",
    tag: "MasterData",
    operationId: "updateVehicleAccidentRecord",
    summary: "Update vehicle accident record",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "UpdateVehicleAccidentRecordRequest",
    responseSchema: "StoreRentalVehicleDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/vehicles",
    tag: "MasterData",
    operationId: "createVehicle",
    summary: "Create vehicle",
    permissions: ["store-rental:vehicle:manage"],
    requestSchema: "VehicleInstanceSummary",
    responseSchema: "VehicleInstanceSummary"
  },
  {
    method: "put",
    path: "/api/store-rental/vehicles/{id}",
    tag: "MasterData",
    operationId: "updateVehicle",
    summary: "Update vehicle",
    permissions: ["store-rental:vehicle:manage"],
    requestSchema: "VehicleInstanceSummary",
    responseSchema: "VehicleInstanceSummary"
  },
  {
    method: "patch",
    path: "/api/store-rental/vehicles/{id}/status",
    tag: "MasterData",
    operationId: "updateVehicleStatus",
    summary: "Update vehicle status",
    permissions: ["store-rental:vehicle:manage", "store-rental:vehicle:status-action"],
    requestSchema: "UpdateVehicleStatusRequest",
    responseSchema: "VehicleStatusActionResult"
  },
  {
    method: "get",
    path: "/api/store-rental/value-added-services",
    tag: "MasterData",
    operationId: "listValueAddedServices",
    summary: "List value-added services",
    permissions: ["store-rental:service:manage"],
    responseSchema: arrayOf("StoreValueAddedServiceSummary")
  },
  {
    method: "post",
    path: "/api/store-rental/value-added-services",
    tag: "MasterData",
    operationId: "createValueAddedService",
    summary: "Create value-added service",
    permissions: ["store-rental:service:manage"],
    requestSchema: "StoreValueAddedServiceSummary",
    responseSchema: "StoreValueAddedServiceSummary"
  },
  {
    method: "put",
    path: "/api/store-rental/value-added-services/{id}",
    tag: "MasterData",
    operationId: "updateValueAddedService",
    summary: "Update value-added service",
    permissions: ["store-rental:service:manage"],
    requestSchema: "StoreValueAddedServiceSummary",
    responseSchema: "StoreValueAddedServiceSummary"
  },
  {
    method: "get",
    path: "/api/store-rental/members",
    tag: "Customer",
    operationId: "listMembers",
    summary: "List members",
    permissions: ["store-rental:member:view"],
    responseSchema: arrayOf("MemberSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/members/{id}",
    tag: "Customer",
    operationId: "getMemberDetail",
    summary: "Get member detail",
    permissions: ["store-rental:member:view"],
    responseSchema: "MemberDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/members",
    tag: "Customer",
    operationId: "createMember",
    summary: "Create member",
    permissions: ["store-rental:member:manage"],
    requestSchema: "SaveMemberRequest",
    responseSchema: "MemberDetail"
  },
  {
    method: "put",
    path: "/api/store-rental/members/{id}",
    tag: "Customer",
    operationId: "updateMember",
    summary: "Update member",
    permissions: ["store-rental:member:manage"],
    requestSchema: "SaveMemberRequest",
    responseSchema: "MemberDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/members/{id}/risk-actions",
    tag: "Customer",
    operationId: "processMemberRisk",
    summary: "Process member risk action",
    permissions: ["store-rental:member:manage", "store-rental:member:risk-action"],
    requestSchema: "ProcessMemberRiskRequest",
    responseSchema: "ProcessMemberRiskResult"
  },
  {
    method: "get",
    path: "/api/store-rental/member-reviews",
    tag: "Customer",
    operationId: "listMemberReviews",
    summary: "List member reviews",
    permissions: ["store-rental:member:view"],
    responseSchema: arrayOf("MemberReviewTask")
  },
  {
    method: "post",
    path: "/api/store-rental/member-reviews/{id}/process",
    tag: "Customer",
    operationId: "processMemberReview",
    summary: "Process member review",
    permissions: ["store-rental:member:manage"],
    requestSchema: "ProcessMemberReviewRequest",
    responseSchema: "MemberReviewTask"
  },
  {
    method: "get",
    path: "/api/store-rental/membership-plans",
    tag: "Customer",
    operationId: "listMembershipPlans",
    summary: "List membership plans",
    permissions: ["store-rental:member:manage"],
    responseSchema: arrayOf("MembershipPlanSummary")
  },
  {
    method: "post",
    path: "/api/store-rental/membership-plans",
    tag: "Customer",
    operationId: "createMembershipPlan",
    summary: "Create membership plan",
    permissions: ["store-rental:member:manage"],
    requestSchema: "SaveMembershipPlanRequest",
    responseSchema: "MembershipPlanSummary"
  },
  {
    method: "put",
    path: "/api/store-rental/membership-plans/{id}",
    tag: "Customer",
    operationId: "updateMembershipPlan",
    summary: "Update membership plan",
    permissions: ["store-rental:member:manage"],
    requestSchema: "SaveMembershipPlanRequest",
    responseSchema: "MembershipPlanSummary"
  },
  {
    method: "get",
    path: "/api/store-rental/corporates",
    tag: "Customer",
    operationId: "listCorporates",
    summary: "List corporates",
    permissions: ["store-rental:corporate:view"],
    responseSchema: arrayOf("CorporateSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/corporates/{id}/monthly-bills",
    tag: "Customer",
    operationId: "listCorporateMonthlyBills",
    summary: "List corporate monthly bills",
    permissions: ["store-rental:corporate:view"],
    responseSchema: arrayOf("CorporateMonthlyBillSummary")
  },
  {
    method: "post",
    path: "/api/store-rental/corporates/{id}/monthly-bills/{billId}/settle",
    tag: "Customer",
    operationId: "settleCorporateMonthlyBill",
    summary: "Settle corporate monthly bill",
    permissions: [
      "store-rental:corporate:manage",
      "store-rental:corporate:monthly-settle",
      "store-rental:order:fee-manage"
    ],
    requestSchema: "SettleCorporateMonthlyBillRequest",
    responseSchema: "CorporateMonthlyBillSummary"
  },
  {
    method: "get",
    path: "/api/store-rental/corporates/{id}/contracts/{contractId}/attachments",
    tag: "Customer",
    operationId: "listCorporateContractAttachments",
    summary: "List corporate contract attachments",
    permissions: ["store-rental:corporate:view"],
    responseSchema: "GenericObject"
  },
  {
    method: "post",
    path: "/api/store-rental/corporates/{id}/contracts/{contractId}/attachments",
    tag: "Customer",
    operationId: "createCorporateContractAttachment",
    summary: "Create corporate contract attachment",
    permissions: ["store-rental:corporate:manage"],
    requestSchema: "GenericObject",
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/store-rental/corporates/{id}",
    tag: "Customer",
    operationId: "getCorporateDetail",
    summary: "Get corporate detail",
    permissions: ["store-rental:corporate:view"],
    responseSchema: "CorporateDetail"
  },
  {
    method: "post",
    path: "/api/store-rental/corporates",
    tag: "Customer",
    operationId: "createCorporate",
    summary: "Create corporate",
    permissions: ["store-rental:corporate:manage"],
    requestSchema: "SaveCorporateRequest",
    responseSchema: "CorporateDetail"
  },
  {
    method: "put",
    path: "/api/store-rental/corporates/{id}",
    tag: "Customer",
    operationId: "updateCorporate",
    summary: "Update corporate",
    permissions: ["store-rental:corporate:manage"],
    requestSchema: "SaveCorporateRequest",
    responseSchema: "CorporateDetail"
  },
  {
    method: "get",
    path: "/api/store-rental/orders",
    tag: "Order",
    operationId: "listOrders",
    summary: "List store rental orders",
    permissions: ["store-rental:order:view"],
    parameters: [queryParam("keyword"), queryParam("status")],
    responseSchema: arrayOf("StoreRentalOrderSummary")
  },
  {
    method: "get",
    path: "/api/store-rental/orders/{id}",
    tag: "Order",
    operationId: "getOrderDetail",
    summary: "Get order detail",
    permissions: ["store-rental:order:view"],
    responseSchema: "StoreRentalOrderDetail"
  },
  {
    method: "get",
    path: "/api/store-rental/orders/{id}/fees",
    tag: "Order",
    operationId: "getOrderFeeCenter",
    summary: "Get order fee center",
    permissions: ["store-rental:order:view"],
    responseSchema: "StoreRentalFeeCenter"
  },
  {
    method: "post",
    path: "/api/store-rental/orders/{id}/fees",
    tag: "Order",
    operationId: "createOrderFee",
    summary: "Create order fee",
    permissions: ["store-rental:order:settle", "store-rental:order:fee-manage"],
    requestSchema: "CreateStoreRentalFeeRequest",
    responseSchema: "StoreRentalFeeCenter"
  },
  {
    method: "post",
    path: "/api/store-rental/orders/{id}/fees/{feeId}/waive",
    tag: "Order",
    operationId: "waiveOrderFee",
    summary: "Waive order fee",
    permissions: ["store-rental:order:settle", "store-rental:order:fee-manage"],
    requestSchema: "WaiveStoreRentalFeeRequest",
    responseSchema: "StoreRentalFeeCenter"
  },
  {
    method: "post",
    path: "/api/store-rental/orders/{id}/transactions",
    tag: "Order",
    operationId: "createOrderTransaction",
    summary: "Create order transaction",
    permissions: ["store-rental:order:settle", "store-rental:order:fee-manage"],
    requestSchema: "CreateStoreRentalTransactionRequest",
    responseSchema: "StoreRentalFeeCenter"
  },
  {
    method: "post",
    path: "/api/store-rental/orders",
    tag: "Order",
    operationId: "createOrder",
    summary: "Create store rental order",
    permissions: ["store-rental:order:operate", "store-rental:order:create"],
    requestSchema: "CreateStoreRentalOrderRequest",
    responseSchema: "CreateStoreRentalOrderResult"
  },
  {
    method: "post",
    path: "/api/store-rental/orders/{id}/actions/{action}",
    tag: "Order",
    operationId: "runOrderAction",
    summary: "Run order action",
    permissions: ["store-rental:order:operate"],
    requestSchema: "StoreRentalOrderActionRequest",
    responseSchema: "StoreRentalOrderActionResult"
  },
  {
    method: "get",
    path: "/api/store-rental/integrations",
    tag: "StoreRental",
    operationId: "listIntegrationPlaceholders",
    summary: "List integration placeholders",
    permissions: [],
    authRequired: true,
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/store-rental/client-endpoints",
    tag: "StoreRental",
    operationId: "listReservedClientEndpoints",
    summary: "List reserved client endpoints",
    permissions: [],
    authRequired: true,
    responseSchema: "GenericObject"
  },
  // ===== 2026-06-25 新增的契约操作 =====
  {
    method: "get",
    path: "/api/reports/exports/{fileName}",
    tag: "Reports",
    operationId: "downloadReportExport",
    summary: "Download report export file",
    permissions: ["store-rental:report:view"],
    authRequired: true,
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/store-rental/contracts",
    tag: "StoreRental",
    operationId: "listContracts",
    summary: "List store rental contracts",
    permissions: ["store-rental:order:view"],
    authRequired: true,
    responseSchema: "StoreRentalContractCenter"
  },
  {
    method: "get",
    path: "/api/store-rental/contracts/templates",
    tag: "StoreRental",
    operationId: "listContractTemplates",
    summary: "List contract templates",
    permissions: ["store-rental:order:view"],
    authRequired: true,
    responseSchema: "StoreRentalContractTemplate"
  },
  {
    method: "post",
    path: "/api/store-rental/contracts/{id}/print-mock",
    tag: "StoreRental",
    operationId: "printContractMock",
    summary: "Print contract mock",
    permissions: ["store-rental:order:operate"],
    requestSchema: "StoreRentalContractPrintRequest",
    responseSchema: "StoreRentalContractPrintResult"
  },
  {
    method: "post",
    path: "/api/store-rental/contracts/{id}/sign-mock",
    tag: "StoreRental",
    operationId: "signContractMock",
    summary: "Sign contract mock",
    permissions: ["store-rental:order:operate"],
    requestSchema: "StoreRentalContractMockSignRequest",
    responseSchema: "StoreRentalContractMockSignResult"
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/tasks/close",
    tag: "Dispatch",
    operationId: "closeDispatchTask",
    summary: "Close dispatch task",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchCloseTaskRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "get",
    path: "/api/store-rental/finance/pre-authorizations",
    tag: "Finance",
    operationId: "listFinancePreAuthorizations",
    summary: "List finance pre-authorizations",
    permissions: ["store-rental:order:settle"],
    authRequired: true,
    responseSchema: "FinancePreAuthorizationRow"
  },
  {
    method: "post",
    path: "/api/store-rental/finance/pre-authorizations",
    tag: "Finance",
    operationId: "createFinancePreAuthorization",
    summary: "Create finance pre-authorization",
    permissions: ["store-rental:order:settle"],
    requestSchema: "SaveFinancePreAuthorizationRequest",
    responseSchema: "FinancePreAuthorizationRow"
  },
  {
    method: "put",
    path: "/api/store-rental/finance/pre-authorizations/{id}",
    tag: "Finance",
    operationId: "updateFinancePreAuthorization",
    summary: "Update finance pre-authorization",
    permissions: ["store-rental:order:settle"],
    requestSchema: "SaveFinancePreAuthorizationRequest",
    responseSchema: "FinancePreAuthorizationRow"
  },
  {
    method: "get",
    path: "/api/store-rental/orders/{id}/notifications",
    tag: "Order",
    operationId: "listOrderNotifications",
    summary: "List order notifications",
    permissions: ["store-rental:order:view"],
    authRequired: true,
    responseSchema: "StoreRentalOrderNotificationRecord"
  },
  {
    method: "get",
    path: "/api/store-rental/orders/{id}/operation-records",
    tag: "Order",
    operationId: "listOrderOperationRecords",
    summary: "List order operation records",
    permissions: ["store-rental:order:view"],
    authRequired: true,
    responseSchema: "StoreRentalOrderOperationRecord"
  },
  {
    method: "patch",
    path: "/api/store-rental/orders/{id}/remarks/{remarkId}/close",
    tag: "Order",
    operationId: "closeOrderRemark",
    summary: "Close order remark",
    permissions: ["store-rental:order:operate"],
    requestSchema: "CloseStoreRentalRemarkRequest",
    responseSchema: "GenericObject"
  },
  {
    method: "patch",
    path: "/api/store-rental/vehicles/transfer-tasks/{id}",
    tag: "MasterData",
    operationId: "updateVehicleTransferTask",
    summary: "Update vehicle transfer task",
    permissions: ["store-rental:vehicle:manage"],
    requestSchema: "AdvanceVehicleTransferTaskRequest",
    responseSchema: "GenericObject"
  },
  // ===== 2026-06-25 DP-01 调度任务认领新增的契约操作 =====
  {
    method: "post",
    path: "/api/store-rental/dispatch/tasks/claim",
    tag: "Dispatch",
    operationId: "claimDispatchTask",
    summary: "Claim dispatch task",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchClaimTaskRequest",
    responseSchema: "StoreRentalDispatchTaskActionResult"
  },
  {
    method: "post",
    path: "/api/store-rental/dispatch/tasks/process",
    tag: "Dispatch",
    operationId: "processDispatchTask",
    summary: "Process dispatch task",
    permissions: ["store-rental:dispatch:manage"],
    requestSchema: "StoreRentalDispatchProcessTaskRequest",
    responseSchema: "StoreRentalDispatchTaskActionResult"
  },
  {
    method: "get", path: "/api/rental/v1/categories", tag: "RentalCore", operationId: "listRentalCategories",
    summary: "List supported rental categories", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "getRentalTenantProfile",
    summary: "Get tenant rental profile", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/tenant-profile", tag: "RentalCore", operationId: "saveRentalTenantProfile",
    summary: "Save tenant rental profile", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "getRentalBusinessSettings",
    summary: "Get category-constrained tenant rental settings", permissions: ["store-rental:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/business-settings", tag: "RentalCore", operationId: "saveRentalBusinessSettings",
    summary: "Save category-constrained tenant rental settings", permissions: ["store-rental:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "listRentalCouponTemplates",
    summary: "List tenant coupon templates", permissions: ["store-rental:marketing:manage", "store-rental:price:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/coupon-templates", tag: "RentalCore", operationId: "createRentalCouponTemplate",
    summary: "Create tenant coupon template", permissions: ["store-rental:marketing:manage", "store-rental:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/coupon-templates/{id}", tag: "RentalCore", operationId: "updateRentalCouponTemplate",
    summary: "Update tenant coupon template", permissions: ["store-rental:marketing:manage", "store-rental:price:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "listRentalLocations",
    summary: "List generic fulfillment locations", permissions: ["store-rental:station:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/locations", tag: "RentalCore", operationId: "createRentalLocation",
    summary: "Create generic fulfillment location", permissions: ["store-rental:station:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "put", path: "/api/rental/v1/locations/{id}", tag: "RentalCore", operationId: "updateRentalLocation",
    summary: "Update generic fulfillment location", permissions: ["store-rental:station:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
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
    method: "get", path: "/api/rental/v1/assets", tag: "RentalCore", operationId: "listRentalAssets",
    summary: "List serialized rental assets", permissions: ["rental-core:asset:view"], responseSchema: "GenericObject"
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
    method: "post", path: "/api/rental/v1/availability", tag: "RentalCore", operationId: "checkRentalAvailability",
    summary: "Check generic rental availability", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "listRentalCoreOrders",
    summary: "List Rental Core orders", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders", tag: "RentalCore", operationId: "createRentalCoreOrder",
    summary: "Create multi-line Rental Core order", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}", tag: "RentalCore", operationId: "getRentalCoreOrder",
    summary: "Get Rental Core order", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/confirm", tag: "RentalCore", operationId: "confirmRentalCoreOrder",
    summary: "Confirm Rental Core reservation", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/allocate", tag: "RentalCore", operationId: "allocateRentalCoreOrder",
    summary: "Allocate Rental Core inventory", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/cancel", tag: "RentalCore", operationId: "cancelRentalCoreOrder",
    summary: "Cancel Rental Core order", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/handover/{stage}", tag: "RentalCore", operationId: "handoverRentalCoreOrder",
    summary: "Complete pickup or return handover when inspection is not required", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/inspection-templates", tag: "RentalCore", operationId: "listRentalInspectionTemplates",
    summary: "List category inspection templates", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "get", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "listRentalOrderInspections",
    summary: "List Rental Core inspections", permissions: ["store-rental:order:view", "store-rental:vehicle:view"], responseSchema: "GenericObject"
  },
  {
    method: "post", path: "/api/rental/v1/orders/{id}/inspections", tag: "RentalCore", operationId: "createRentalOrderInspection",
    summary: "Complete pickup or return inspection", permissions: ["store-rental:order:operate", "store-rental:vehicle:manage"], requestSchema: "GenericObject", responseSchema: "GenericObject"
  },
  ...rentalBusinessOperations(),
  ...INTEGRATION_BACKLOG_OPERATIONS
];

function rentalBusinessOperations(): ContractOperation[] { return [
  backlogOperation("get", "/api/rental/v1/fulfillment-operators", "RentalCore", "listRentalFulfillmentOperators", "List fulfillment operators", ["store-rental:station:view"]),
  backlogOperation("post", "/api/rental/v1/fulfillment-operators", "RentalCore", "createRentalFulfillmentOperator", "Create fulfillment operator", ["store-rental:station:manage"]),
  backlogOperation("put", "/api/rental/v1/fulfillment-operators/{id}", "RentalCore", "updateRentalFulfillmentOperator", "Update fulfillment operator", ["store-rental:station:manage"]),
  backlogOperation("get", "/api/rental/v1/pricing-plans", "RentalBusiness", "listRentalPricingPlans", "List generic pricing plans", ["store-rental:price:manage"]),
  backlogOperation("post", "/api/rental/v1/pricing-plans", "RentalBusiness", "createRentalPricingPlan", "Create generic pricing plan", ["store-rental:price:manage"]),
  backlogOperation("put", "/api/rental/v1/pricing-plans/{id}", "RentalBusiness", "updateRentalPricingPlan", "Update generic pricing plan", ["store-rental:price:manage"]),
  backlogOperation("get", "/api/rental/v1/discount-plans", "RentalBusiness", "listRentalDiscountPlans", "List rental discount plans", ["store-rental:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/discount-plans", "RentalBusiness", "createRentalDiscountPlan", "Create rental discount plan", ["store-rental:marketing:manage"]),
  backlogOperation("put", "/api/rental/v1/discount-plans/{id}", "RentalBusiness", "updateRentalDiscountPlan", "Update rental discount plan", ["store-rental:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/value-added-services", "RentalBusiness", "listRentalValueAddedServices", "List value-added services", ["store-rental:service:manage"]),
  backlogOperation("post", "/api/rental/v1/value-added-services", "RentalBusiness", "createRentalValueAddedService", "Create value-added service", ["store-rental:service:manage"]),
  backlogOperation("put", "/api/rental/v1/value-added-services/{id}", "RentalBusiness", "updateRentalValueAddedService", "Update value-added service", ["store-rental:service:manage"]),
  backlogOperation("get", "/api/rental/v1/calendars/{year}", "RentalBusiness", "getRentalBusinessCalendar", "Get annual business calendar", ["store-rental:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/import", "RentalBusiness", "importRentalBusinessCalendar", "Import official business calendar", ["store-rental:price:manage"]),
  backlogOperation("put", "/api/rental/v1/calendars/{year}/days/{date}", "RentalBusiness", "updateRentalBusinessCalendarDay", "Update tenant calendar day", ["store-rental:price:manage"]),
  backlogOperation("post", "/api/rental/v1/calendars/{year}/publish", "RentalBusiness", "publishRentalBusinessCalendar", "Publish annual business calendar", ["store-rental:price:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions", "RentalBusiness", "listRentalRuleVersionsV1", "List rental rule versions", ["store-rental:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/rule-versions/current", "RentalBusiness", "getCurrentRentalRuleVersionV1", "Get current rental rule", ["store-rental:rules:manage"]),
  backlogOperation("post", "/api/rental/v1/rule-versions", "RentalBusiness", "createRentalRuleVersionV1", "Create or publish rental rule version", ["store-rental:rules:manage"]),
  backlogOperation("get", "/api/rental/v1/customer-coupons", "RentalBusiness", "listRentalCustomerCoupons", "List customer coupons", ["store-rental:marketing:manage"]),
  backlogOperation("post", "/api/rental/v1/customer-coupons/claim", "RentalBusiness", "claimRentalCustomerCoupon", "Claim customer coupon", ["store-rental:marketing:manage"]),
  backlogOperation("get", "/api/rental/v1/rewards", "RentalBusiness", "listRentalRewardLedger", "List reward ledger", ["store-rental:member:manage"]),
  backlogOperation("get", "/api/rental/v1/benefit-accounts", "RentalBusiness", "listRentalBenefitAccounts", "List customer benefit accounts", ["store-rental:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/grant", "RentalBusiness", "grantRentalReward", "Grant idempotent membership reward", ["store-rental:member:manage"]),
  backlogOperation("post", "/api/rental/v1/rewards/{id}/reverse", "RentalBusiness", "reverseRentalReward", "Reverse membership reward", ["store-rental:member:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-templates", "RentalBusiness", "listRentalNotificationTemplates", "List tenant notification templates", ["system:params:manage"]),
  backlogOperation("post", "/api/rental/v1/notification-templates", "RentalBusiness", "createRentalNotificationTemplate", "Create tenant notification template", ["system:params:manage"]),
  backlogOperation("put", "/api/rental/v1/notification-templates/{id}", "RentalBusiness", "updateRentalNotificationTemplate", "Update tenant notification template", ["system:params:manage"]),
  backlogOperation("get", "/api/rental/v1/notification-logs", "RentalBusiness", "listRentalNotificationLogs", "List notification send logs", ["system:params:manage"]),
  backlogOperation("post", "/api/rental/v1/notifications/send", "RentalBusiness", "sendRentalNotification", "Render and send tenant notification", ["system:params:manage"]),
  backlogOperation("post", "/api/rental/v1/quotes", "RentalBusiness", "createRentalQuote", "Create server-side rental quote", ["store-rental:order:operate"]),
  backlogOperation("get", "/api/rental/v1/quotes/{id}", "RentalBusiness", "getRentalQuote", "Get rental quote snapshot", ["store-rental:order:view"])
]; }

export const OPENAPI_DOCUMENT = {
  openapi: "3.0.3",
  info: {
    title: "Store Rental Platform API",
    version: "0.1.0",
    description:
      "Internal OpenAPI contract for the store rental platform MVP. Runtime responses are wrapped as { data, requestId } unless the path is /api/openapi.json."
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
    { name: "StoreRental" },
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
