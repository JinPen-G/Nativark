/** 原公共组织与安全字段。数据投影、保存准入及原 MVP 工具边界由公共管理服务执行。 */
const string = { type: "string" };
const boolean = { type: "boolean" };
const requiredText = { type: "string", minLength: 1 };
const nonNegativeNumber = { type: "number", minimum: 0 };
const organizationProperties = {
  id: string, tenantId: string, parentId: string, type: { type: "string", enum: ["operator", "car_shop", "store", "station"] },
  code: string, name: string, status: { type: "string", enum: ["enabled", "disabled"] }
};
const securityProperties = {
  loginRateLimit: { type: "object", properties: { enabled: boolean, maxFailures: nonNegativeNumber,
    windowMinutes: nonNegativeNumber, lockMinutes: nonNegativeNumber } },
  passwordPolicy: { type: "object", properties: { minLength: nonNegativeNumber, requireLetter: boolean,
    requireNumber: boolean, disallowDefaultPassword: boolean, expireDays: nonNegativeNumber } },
  masking: { type: "object", properties: { phone: boolean, identityNo: boolean, driverLicenseNo: boolean,
    email: boolean, apiKey: boolean } },
  secondConfirmation: { type: "object", properties: { enabled: boolean, actions: { type: "array", items: string } } }
};

export const PLATFORM_SETTINGS_OPENAPI_QUERY_SCHEMAS = { tenantId: string } as const;

export const PLATFORM_SETTINGS_SCHEMAS = {
  "PlatformSettings.Organization": { type: "object", required: ["id", "tenantId", "type", "code", "name", "status"], properties: organizationProperties },
  "PlatformSettings.Organizations": { type: "array", items: { $ref: "#/components/schemas/PlatformSettings.Organization" } },
  "PlatformSettings.SaveOrganization": { type: "object", required: ["tenantId", "type", "code", "name", "status"], properties: {
    ...organizationProperties, id: requiredText, tenantId: requiredText,
    parentId: { ...requiredText, nullable: true, description: "省略保留原上级；null移回根级，新建省略时为根级。上级不能为自身或下级组织。" },
    code: requiredText, name: requiredText, operator: requiredText
  } },
  "PlatformSettings.OrganizationStatus": { type: "object", required: ["status"], properties: {
    status: organizationProperties.status, operator: requiredText, tenantId: requiredText
  } },
  "PlatformSettings.SecurityBaseline": { type: "object", required: ["loginRateLimit", "passwordPolicy", "masking", "secondConfirmation"], properties: securityProperties },
  "PlatformSettings.SaveSecurityBaseline": { type: "object", required: ["config"], properties: {
    config: { type: "object", properties: securityProperties }, operator: requiredText
  } },
  "PlatformSettings.SecondConfirmation": { type: "object", required: ["action"], properties: { action: requiredText, confirmationCode: requiredText } },
  "PlatformSettings.SecondConfirmationResult": { type: "object", required: ["action", "required", "accepted", "message"], properties: {
    action: string, required: boolean, accepted: boolean, message: string
  }, description: "原MVP管理工具保留演示确认码规则，业务执行使用自身正式批准与授权。" }
} as const;
