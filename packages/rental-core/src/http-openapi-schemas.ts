/** Rental 原 HTTP schema 单源。保留历史宽泛字段，字段完整性缺口由接口贡献明确列出。 */
import { STAFF_UPLOAD_OBSERVATION_SCHEMAS } from "@rental-os/shared";
import { RentalInventoryMode, RENTAL_LOCATION_TYPES, RENTAL_PRICING_UNIT_CODES, RENTAL_SERVICE_EXECUTION_ACTIONS } from "./contracts";
import type {
  InitiateRentalFundingRequest,
  RefundRentalServiceRequest,
  RentalFundingAmountRequest,
  RentalFundingFailureRequest,
  UpdateRentalServiceOccurrenceRequest
} from "./contracts";
import type { RentalFundingReleaseDto } from "./order-request.dto";
import { RENTAL_EXCHANGE_INSPECTION_SCHEMAS } from "./http-openapi-rental-exchange-inspection-preparation.schemas";
import { ENTERPRISE_COMPONENT_SCHEMAS } from "./http-openapi-enterprise-schemas";
import { ENTERPRISE_ORDER_DELEGATION_SCHEMAS } from "./http-openapi-enterprise-order-delegation-schemas";
import { RENTAL_ORDER_COMPONENT_SCHEMAS } from "./http-openapi-rental-order-schemas";
import { RENTAL_ORDER_DOCUMENT_COMPONENT_SCHEMAS } from "./http-openapi-rental-order-document-schemas";
import { RENTAL_PAYMENT_COMPONENT_SCHEMAS } from "./http-openapi-rental-payment-schemas";

import { RENTAL_CATEGORY_CODE_PATTERN, RENTAL_CATEGORY_ICON_CODES } from "@rental-os/shared";
import { AI_CATEGORY_DRAFT_HTTP_SCHEMAS, AI_EXTENSION_PREVIEW_HTTP_SCHEMAS } from "@rental-os/shared";
import { aiLeafToOpenApi30 } from "./http-openapi-json-schema";
import { adminContainerRadiusInput, adminControlRadiusInput, storedAdminRadiusSchema, stringSchema, numberSchema, booleanSchema, objectSchema, ref, arrayOf, objectOf, type SchemaObject } from "./http-openapi-contract";

export const RENTAL_HTTP_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  ...STAFF_UPLOAD_OBSERVATION_SCHEMAS,
  AiExtensionServiceSnapshotDraft: aiLeafToOpenApi30(AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionServiceSnapshotDraft, "AiExtensionServiceSnapshotDraft"),
  AiCategoryDraftJson: aiLeafToOpenApi30(AI_CATEGORY_DRAFT_HTTP_SCHEMAS.AiCategoryDraftJson, "AiCategoryDraftJson"),
  AiCategoryGovernanceAuditWire: aiLeafToOpenApi30(AI_CATEGORY_DRAFT_HTTP_SCHEMAS.AiCategoryGovernanceAuditWire, "AiCategoryGovernanceAuditWire"),
  AiCategoryGovernanceAuditPage: aiLeafToOpenApi30(AI_CATEGORY_DRAFT_HTTP_SCHEMAS.AiCategoryGovernanceAuditPage, "AiCategoryGovernanceAuditPage"),
  ...ENTERPRISE_COMPONENT_SCHEMAS,
  ...ENTERPRISE_ORDER_DELEGATION_SCHEMAS,
  ...RENTAL_EXCHANGE_INSPECTION_SCHEMAS,
  ...RENTAL_ORDER_COMPONENT_SCHEMAS,
  ...RENTAL_ORDER_DOCUMENT_COMPONENT_SCHEMAS,
  ...RENTAL_PAYMENT_COMPONENT_SCHEMAS,
  GenericObject: objectSchema,
  RentalBundleComponentInput: {
    ...objectOf({
      itemGroupId: { type: "string", minLength: 1, description: "当前空间已建档的单品型号 id。" },
      quantity: { type: "integer", minimum: 1, description: "原 DTO 接收数字，Core 保存入口核验正整数。" },
      optional: { type: "boolean", nullable: true, description: "省略或 null 时采用 false。替代候选须填写 substitutionGroup。" },
      substitutionGroup: { type: "string", nullable: true, description: "原保存入口去除首尾空白。同组至少两个候选，且恰有一个默认组成。" }
    }, ["itemGroupId", "quantity"]),
    description: "原 RentalBundleComponentInputDto。组成型号唯一，套装引用及替代组规则沿原 Core 入口核验。"
  },
  SaveRentalItemGroupRequest: {
    ...objectOf({
      id: { type: "string", minLength: 1, nullable: true, description: "POST 省略 id 时新建，提供已有 id 时更新。PUT 使用路径 id。" },
      code: { type: "string", minLength: 1, pattern: "\\S" },
      name: { type: "string", minLength: 1, pattern: "\\S" },
      inventoryMode: { type: "string", enum: Object.values(RentalInventoryMode), description: "原库存模式，当前经营品类须已支持所选模式。" },
      unit: { type: "string", nullable: true, description: "原保存入口去除首尾空白，空值采用件。" },
      description: { type: "string", nullable: true },
      attributes: { ...objectSchema, nullable: true, description: "原品类字段对象，沿当前已采用定义核验字段、类型、必填和唯一性，并保留原历史字段。" },
      bundleComponents: { ...arrayOf("RentalBundleComponentInput"), nullable: true, description: "bundle 模式至少一个组成项，其他模式采用空集合。省略或 null 时采用空集合。" },
      status: { type: "string", enum: ["enabled", "disabled", null], nullable: true, description: "省略或 null 时新增采用 enabled，更新沿原保存入口保留已存状态。" },
      operator: { type: "string", nullable: true, description: "保留的原 DTO 兼容字段，商品写入与审计归属由当前服务端上下文确定。" }
    }, ["code", "name", "inventoryMode"]),
    description: "原 SaveRentalItemGroupDto 输入。原品类绑定、商品建档 Hook、唯一属性和配置写入沿同一 Core 保存入口处理。",
    example: {
      code: "CAMERA-KIT",
      name: "摄影设备套装",
      inventoryMode: "bundle",
      unit: "套",
      bundleComponents: [{ itemGroupId: "item_group_component", quantity: 1 }]
    }
  },
  RentalBundleComponent: objectOf({
    itemGroupId: stringSchema,
    itemGroupCode: stringSchema,
    itemGroupName: stringSchema,
    quantity: numberSchema,
    optional: { type: "boolean", description: "原保存结果包含默认值，持久读取可省略 false。" },
    substitutionGroup: stringSchema
  }, ["itemGroupId", "itemGroupCode", "itemGroupName", "quantity"], false),
  RentalItemGroupImage: {
    ...objectOf({
      id: stringSchema,
      fileName: stringSchema,
      mimeType: { type: "string", description: "原已存图片的媒体类型。" },
      sizeBytes: numberSchema,
      isCover: { type: "boolean", description: "原封面标记。历史图片记录可能省略该字段。" },
      url: { type: "string", description: "通过当前营运会话读取的原型号图片路径。" }
    }, ["id", "fileName", "mimeType", "sizeBytes", "url"]),
    description: "原 RentalItemGroupImage 公开投影。原文件资产标识由服务端图片台账保管。"
  },
  RentalItemGroup: {
    ...objectOf({
      id: stringSchema,
      tenantId: stringSchema,
      categoryCode: stringSchema,
      code: stringSchema,
      name: stringSchema,
      inventoryMode: { type: "string", description: "原已存库存模式。" },
      unit: stringSchema,
      description: stringSchema,
      attributes: { ...objectSchema, description: "原公开品类字段及保留的历史字段，内部图片台账由公开映射剔除。" },
      images: arrayOf("RentalItemGroupImage"),
      bundleComponents: arrayOf("RentalBundleComponent"),
      status: { type: "string", description: "原已存启用状态。" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }, ["id", "tenantId", "categoryCode", "code", "name", "inventoryMode", "unit", "attributes", "images", "bundleComponents", "status", "createdAt", "updatedAt"], false),
    description: "原 RentalItemGroup 与公开映射的完整型号、图片和套装组成投影。",
    example: {
      id: "item_group_bundle",
      tenantId: "tenant_example",
      categoryCode: "camera",
      code: "CAMERA-KIT",
      name: "摄影设备套装",
      inventoryMode: "bundle",
      unit: "套",
      attributes: {},
      images: [{
        id: "img_example",
        fileName: "camera-kit.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        isCover: true,
        url: "/api/rental/v1/item-groups/item_group_bundle/images/img_example"
      }],
      bundleComponents: [{
        itemGroupId: "item_group_component",
        itemGroupCode: "CAMERA-A",
        itemGroupName: "摄影设备型号",
        quantity: 1,
        optional: false
      }],
      status: "enabled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  },
  RentalItemGroupImageUploadRequest: objectOf({
    file: { type: "string", format: "binary", description: "单个 JPEG、PNG 或 WebP 图片，最多 5 MiB。原服务核对文件签名和字节长度，每个型号最多六张。" }
  }, ["file"]),
  SaveRentalFulfillmentOperatorRequest: {
    ...objectOf({
      id: { type: "string", minLength: 1, nullable: true, description: "POST 省略 id 时新建，提供已有 id 时更新。PUT 使用路径 id。" },
      code: { type: "string", minLength: 1, pattern: "\\S" },
      name: { type: "string", minLength: 1, pattern: "\\S" },
      type: { type: "string", enum: ["self_operated", "partner"] },
      contactName: { type: "string", nullable: true },
      contactPhone: { type: "string", nullable: true },
      settlementMode: { type: "string", enum: ["self", "monthly", "per_order", null], nullable: true, description: "省略或 null 时，自营采用 self，合作经营主体采用 monthly。" },
      status: { type: "string", enum: ["enabled", "disabled"], description: "省略时新增采用 enabled，更新在原事务内读取并保留已存状态。" }
    }, ["code", "name", "type"]),
    description: "原 SaveRentalFulfillmentOperatorDto 输入。原保存入口规范化编码、名称和联系人，仓储核验当前品类绑定与租户、空间归属。",
    example: { code: "SELF", name: "自营经营主体", type: "self_operated" }
  },
  RentalFulfillmentOperator: {
    ...objectOf({
      id: stringSchema,
      tenantId: stringSchema,
      code: stringSchema,
      name: stringSchema,
      type: { type: "string", description: "原已存主体类型。" },
      contactName: stringSchema,
      contactPhone: stringSchema,
      settlementMode: { type: "string", description: "原已存结算模式。" },
      status: { type: "string", description: "原已存状态。" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }, ["id", "tenantId", "code", "name", "type", "status", "createdAt", "updatedAt"], false),
    description: "原 RentalFulfillmentOperator 与保存、读取映射的完整经营主体投影。",
    example: {
      id: "operator_example",
      tenantId: "tenant_example",
      code: "SELF",
      name: "自营经营主体",
      type: "self_operated",
      settlementMode: "self",
      status: "enabled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  },
  RentalPricingTier: objectOf({
    minUnits: { type: "integer", minimum: 1, description: "阶梯起始单位数，含该单位。累进阶梯的首档从 1 开始，各档起点唯一。" },
    unitAmount: { type: "number", minimum: 0, description: "原业务币种下的阶梯单价。" }
  }, ["minUnits", "unitAmount"]),
  RentalPricingGroupInitialRate: {
    ...objectOf({
      unit: { type: "string", enum: [...RENTAL_PRICING_UNIT_CODES], description: "当前品类已启用的计价单位，每个单位提交一条基本价。" },
      baseAmount: { type: "number", minimum: 0, description: "原业务币种下每单位基本租金，沿所属业务金额精度。" },
      depositAmount: { type: "number", minimum: 0, nullable: true, description: "固定押金模式的每件金额，省略或 null 由原创建入口采用 0。" },
      depositMultiple: { type: "number", minimum: 0, description: "押金租金倍数，是否必需由当前生效规则核验。" },
      preAuthAmount: { type: "number", minimum: 0, nullable: true, description: "固定预授权模式的每件冻结额度，省略或 null 由原创建入口采用 0。" },
      preAuthMultiple: { type: "number", minimum: 0, description: "预授权租金倍数或风险附加倍数，由当前生效规则核验。" },
      includedUsage: { type: "number", minimum: 0, description: "使用量计价包含量，单位来自当前品类。" },
      excessUsageAmount: { type: "number", minimum: 0, description: "使用量的统一超额单价，与累进阶梯分别配置。" },
      usagePrecision: { type: "integer", enum: [0, 1, 2], description: "使用量向上进位精度，0 为整数、1 为 0.1、2 为 0.01，原缺省为 0。" },
      tierMode: { type: "string", enum: ["progressive", null], nullable: true },
      tiers: { ...arrayOf("RentalPricingTier"), nullable: true },
      maxAmount: { type: "number", minimum: 0, description: "单行租金封顶，0 表示免租，省略表示未设置封顶。" }
    }, ["unit", "baseAmount"]),
    description: "原 RentalPricingGroupInitialRateInputDto 输入。使用量单位提供统一超额单价，或选择 progressive 并提供从 1 开始的累进阶梯。包含量、超额单价和精度沿原保存校验仅用于 usage。"
  },
  SaveRentalPricingGroupRequest: {
    ...objectOf({
      id: { type: "string", minLength: 1, nullable: true, description: "省略时创建，提供已有 id 时原保存入口更新。PUT 使用路径 id。" },
      code: { type: "string", minLength: 1, pattern: "\\S" },
      name: { type: "string", minLength: 1, pattern: "\\S" },
      description: { type: "string", nullable: true },
      defaultPricingUnit: { type: "string", enum: [...RENTAL_PRICING_UNIT_CODES, null], nullable: true, description: "当前品类已启用的计价单位。POST 省略或 null 时采用首条基本价的单位。" },
      initialRates: { ...arrayOf("RentalPricingGroupInitialRate"), nullable: true, description: "POST 入口同时保存基本价。PUT 沿原保存入口维护分组配置。" },
      memberItemGroupIds: { type: "array", minItems: 1, uniqueItems: true, items: stringSchema, description: "当前空间已启用且库存方式相同的产品型号，至少选择一个。" },
      status: { type: "string", enum: ["enabled", "disabled", null], nullable: true, description: "省略或 null 时新增采用 enabled，更新采用已存状态。" }
    }, ["code", "name", "memberItemGroupIds"]),
    description: "原 SaveRentalPricingGroupDto。品类绑定、型号归属、唯一编码和原提交边界由原 Guard、Core 保存及仓储核验。"
  },
  CreateRentalPricingGroupRequest: {
    allOf: [
      ref("SaveRentalPricingGroupRequest"),
      objectOf({ initialRates: { ...arrayOf("RentalPricingGroupInitialRate"), minItems: 1 } }, ["initialRates"])
    ],
    description: "原 POST 入口要求至少一条基本价，并在同一事务内保存分组和基本价计划。",
    example: {
      code: "CAMERA-DAY",
      name: "摄影设备日租",
      memberItemGroupIds: ["item_group_example"],
      initialRates: [{ unit: "day_24h", baseAmount: 100 }]
    }
  },
  RentalPricingGroup: {
    ...objectOf({
      id: stringSchema,
      tenantId: stringSchema,
      categoryCode: stringSchema,
      code: stringSchema,
      name: stringSchema,
      description: stringSchema,
      defaultPricingUnit: { type: "string", nullable: true, description: "原已存计价单位，保存结果可包含 null。" },
      memberItemGroupIds: arrayOf(stringSchema),
      members: arrayOf(objectOf({
        id: stringSchema,
        code: stringSchema,
        name: stringSchema,
        inventoryMode: stringSchema,
        unit: stringSchema,
        status: stringSchema
      }, ["id", "code", "name", "inventoryMode", "unit", "status"], false)),
      status: { type: "string", description: "原已存状态。" },
      version: { type: "integer" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" }
    }, ["id", "tenantId", "categoryCode", "code", "name", "memberItemGroupIds", "members", "status", "version", "createdAt", "updatedAt"], false),
    description: "原 RentalPricingGroup 与 toPricingGroup / savePricingGroup 返回的完整分组及型号投影。",
    example: {
      id: "pricing_group_example",
      tenantId: "tenant_example",
      categoryCode: "camera",
      code: "CAMERA-DAY",
      name: "摄影设备日租",
      defaultPricingUnit: "day_24h",
      memberItemGroupIds: ["item_group_example"],
      members: [{
        id: "item_group_example",
        code: "CAMERA-A",
        name: "摄影设备型号",
        inventoryMode: "serialized",
        unit: "台",
        status: "enabled"
      }],
      status: "enabled",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  },
  RentalPricingGroupSecurityRateOverride: {
    ...objectOf({
      unit: { type: "string", enum: [...RENTAL_PRICING_UNIT_CODES] },
      depositAmount: { type: "number", minimum: 0, description: "每件固定押金，省略沿用当前费率。" },
      depositMultiple: { type: "number", minimum: 0, description: "押金租金倍数，省略沿用当前费率。" },
      preAuthAmount: { type: "number", minimum: 0, description: "每件预授权冻结额度，省略沿用当前费率。" },
      preAuthMultiple: { type: "number", minimum: 0, description: "预授权倍数，省略沿用当前费率。" }
    }, ["unit"]),
    description: "原 RentalPricingGroupSecurityRateOverrideDto。资金字段沿原业务金额或倍率精度，由当前生效规则核验。"
  },
  UpdateRentalPricingGroupSecurityRatesRequest: {
    ...objectOf({ rates: { ...arrayOf("RentalPricingGroupSecurityRateOverride"), minItems: 1 } }, ["rates"]),
    description: "计价单位唯一，完整覆盖该组当前空间价格版本的单位集合。原服务在同一事务内追加通过当前资金规则校验的空间价格版本。",
    example: { rates: [{ unit: "day_24h", depositAmount: 500 }] }
  },
  RentalPricingGroupSecurityRatesResult: {
    ...objectOf({
      id: stringSchema,
      sequence: { type: "integer" },
      version: stringSchema,
      effectiveFrom: { type: "string", format: "date-time" },
      changeReason: { type: "string", nullable: true }
    }, ["id", "sequence", "version", "effectiveFrom"], false),
    description: "原 updatePricingGroupSecurityRates 返回的已追加空间价格版本摘要。",
    example: {
      id: "price_version_example",
      sequence: 2,
      version: "v2",
      effectiveFrom: "2026-01-02T00:00:00.000Z",
      changeReason: "维护定价分组的押金与预授权费率"
    }
  },
  SaveRentalFulfillmentLocationRequest: {
    ...objectOf({
      id: { type: "string", minLength: 1, nullable: true, description: "POST 省略 id 时新建，提供已有 id 时沿原保存入口更新。PUT 使用路径 id。" },
      organizationId: { type: "string", minLength: 1, nullable: true, description: "省略或空白保留原组织，null 清除归属。提供该字段时原 Guard 另核账号管理权限及全租户、全部地点范围。" },
      code: { type: "string", minLength: 1, pattern: "\\S" },
      name: { type: "string", minLength: 1, pattern: "\\S" },
      type: { type: "string", enum: [...RENTAL_LOCATION_TYPES], description: "原正式经营品类另核支持的地点类型。" },
      operatorId: { type: "string", nullable: true, description: "引用当前空间已启用的经营主体。" },
      operatorType: { type: "string", enum: ["self_operated", "partner", null], nullable: true },
      operatorName: { type: "string", nullable: true, description: "原名称兼容入口可匹配经营主体或在同一地点事务中创建经营主体。" },
      parentLocationId: { type: "string", nullable: true },
      capabilities: { type: "array", minItems: 1, items: { type: "string", enum: ["pickup", "return", "storage", "delivery"] } },
      address: { type: "string", nullable: true },
      province: { type: "string", maxLength: 64, nullable: true },
      city: { type: "string", maxLength: 64, nullable: true },
      district: { type: "string", maxLength: 64, nullable: true },
      timezone: { type: "string", maxLength: 64, nullable: true },
      latitude: { type: "number", minimum: -90, maximum: 90, nullable: true, description: "经纬度成对提供，空值表示未填写。沿原坐标流程规范化。" },
      longitude: { type: "number", minimum: -180, maximum: 180, nullable: true, description: "经纬度成对提供，空值表示未填写。沿原坐标流程规范化。" },
      contactName: { type: "string", nullable: true },
      contactPhone: { type: "string", nullable: true },
      businessHours: { type: "string", nullable: true },
      status: { type: "string", enum: ["enabled", "disabled"], description: "省略时新增采用 enabled，更新在原事务中保留已存状态。" }
    }, ["code", "name", "type", "capabilities"]),
    description: "原 SaveRentalFulfillmentLocationDto 输入。业务对象归属、经营主体、上级地点、成对坐标和当前品类支持由原 Guard 与保存应用核验。"
  },
  RentalFulfillmentLocation: objectOf({
    id: stringSchema,
    tenantId: stringSchema,
    organizationId: stringSchema,
    code: stringSchema,
    name: stringSchema,
    type: { type: "string", description: "原地点类型，读取保留历史字符串。" },
    operatorId: stringSchema,
    operatorType: { type: "string", description: "原经营主体类型，读取保留历史字符串。" },
    operatorName: stringSchema,
    parentLocationId: { type: "string", nullable: true },
    capabilities: { type: "array", items: stringSchema, description: "原能力数组。保存去重，读取保留历史配置。" },
    address: stringSchema,
    province: stringSchema,
    city: stringSchema,
    district: stringSchema,
    timezone: stringSchema,
    latitude: numberSchema,
    longitude: numberSchema,
    contactName: stringSchema,
    contactPhone: stringSchema,
    businessHours: stringSchema,
    status: { type: "string", description: "原地点状态，读取保留历史字符串。" }
  }, ["id", "tenantId", "code", "name", "type", "capabilities", "status"], false),
  RentalHttpErrorResponse: objectOf({
    statusCode: { type: "integer", minimum: 400, maximum: 599 },
    message: { oneOf: [stringSchema, arrayOf(stringSchema)] },
    error: stringSchema
  }, ["statusCode", "message"], false),
  CustomerAvatarUploadRequest: objectOf({
    file: { type: "string", format: "binary", description: "单个 PNG、JPEG 或 WebP 位图，最多 5 MiB。原服务核对声明格式、文件签名和字节长度。" }
  }, ["file"]),
  CustomerAvatarSaveResult: objectOf({ customerId: stringSchema, avatarUrl: stringSchema }, ["customerId", "avatarUrl"], false),
  StaffInspectionBindingRequest: objectOf({
    orderId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    allocationId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    templateId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]*$" },
    stage: { type: "string", enum: ["pickup", "return"] }
  }, ["orderId", "allocationId", "templateId", "stage"], false),
  StaffInspectionBindingResult: objectOf({
    attachmentId: stringSchema, attachmentRevision: { type: "integer", minimum: 1, maximum: 1000 }
  }, ["attachmentId", "attachmentRevision"], false),
  CustomerProfileOverview: objectOf({ profile: objectSchema, addresses: arrayOf(objectSchema), qualificationRevisions: arrayOf(objectSchema),
    statusHistory: arrayOf(objectSchema), sensitiveAccess: arrayOf(objectSchema), corporateRelations: arrayOf(objectSchema),
    membershipPlanAssignments: arrayOf(objectSchema), access: objectOf({ orders: { type: "string", enum: ["available", "restricted"] },
      orderAmounts: { type: "string", enum: ["available", "restricted"] }, benefits: { type: "string", enum: ["available", "restricted"] },
      qualifications: { type: "string", enum: ["available", "restricted"] }, audit: { type: "string", enum: ["available", "restricted"] } },
    ["orders", "orderAmounts", "benefits", "qualifications", "audit"], false),
    benefits: objectOf({ accounts: arrayOf(objectSchema), rewards: arrayOf(objectSchema), coupons: arrayOf(objectSchema) }),
    orders: objectOf({ items: arrayOf(objectOf({ id: stringSchema, orderNo: stringSchema, workspaceId: stringSchema,
      workspaceName: stringSchema, categoryCode: stringSchema, status: stringSchema, relation: arrayOf(stringSchema), startAt: stringSchema,
      endAt: stringSchema, effectiveEndAt: stringSchema, finalPayableAmount: numberSchema, currency: stringSchema, createdAt: stringSchema },
    ["id", "orderNo", "workspaceId", "status", "currency"])), page: numberSchema, pageSize: numberSchema, total: numberSchema }) },
  ["profile", "addresses", "qualificationRevisions", "statusHistory", "corporateRelations", "membershipPlanAssignments", "benefits", "orders"]),
  RentalExtensionBalanceBasis: objectOf({ version: { type: "integer", enum: [1] },
    approvedReductionExtensionIds: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true } },
    ["version", "approvedReductionExtensionIds"], false),
  RentalExtensionPricingSnapshot: objectOf({ method: { type: "string", enum: ["original_version_difference"] },
    scope: { type: "string", enum: ["order", "exchange_line"] }, context: objectSchema,
    balanceBasis: { ...ref("RentalExtensionBalanceBasis"), description: "Frozen approved reduction sources actually consumed; absent on legacy receipts. Never infer or backfill from wall-clock timestamps." },
    previousPayableAmount: numberSchema, recalculatedPayableAmount: numberSchema,
    recalculatedRentalAmount: numberSchema, rentalLineAmounts: { type: "object", additionalProperties: numberSchema }, recalculatedServiceAmount: numberSchema,
    recalculatedDiscountAmount: numberSchema, recalculatedCouponAmount: numberSchema, totalBillableUnits: numberSchema,
    differenceAmount: numberSchema, fullChargeLines: arrayOf(objectSchema), chargeLines: arrayOf(objectSchema),
    discountEvaluations: arrayOf(objectSchema), couponEvaluation: objectSchema, membershipBenefitEvaluations: arrayOf(objectSchema),
    refundReview: objectOf({ amount: numberSchema, status: { type: "string", enum: ["pending", "approved", "rejected", "superseded"] },
      reason: stringSchema, reviewedBy: stringSchema, reviewedAt: { type: "string", format: "date-time" } }, ["amount", "status"]) }),
  RentalOrderExtensionRecord: objectOf({ id: stringSchema, tenantId: stringSchema, workspaceId: stringSchema, orderId: stringSchema,
    sequence: { type: "integer", minimum: 1 }, status: { type: "string", enum: ["pending_payment", "effective", "cancelled", "expired"] },
    originalEndAt: stringSchema, newEndAt: stringSchema, billableUnits: numberSchema, rentalAmount: numberSchema,
    serviceAmount: numberSchema, depositDelta: numberSchema, preAuthDelta: numberSchema, payableAmount: numberSchema,
    currency: stringSchema, settlementMode: { type: "string", enum: ["immediate", "monthly"] }, executionBasis: objectSchema,
    pricingSnapshot: ref("RentalExtensionPricingSnapshot"), rateSnapshot: arrayOf(objectSchema), ruleSnapshot: objectSchema,
    calendarSnapshot: arrayOf(objectSchema), serviceSnapshots: arrayOf(objectSchema), priceVersionId: stringSchema, priceVersion: stringSchema,
    ruleVersion: stringSchema, memo: stringSchema, createdBy: stringSchema, createdAt: stringSchema, paidAt: stringSchema,
    effectiveAt: stringSchema, idempotencyKey: stringSchema }),
  RentalOrderExtensionPreview: objectOf({ orderId: stringSchema, originalEndAt: stringSchema, newEndAt: stringSchema,
    billableUnits: numberSchema, rentalAmount: numberSchema, serviceAmount: numberSchema, depositDelta: numberSchema,
    preAuthDelta: numberSchema, payableAmount: numberSchema, currency: stringSchema,
    settlementMode: { type: "string", enum: ["immediate", "monthly"] }, paymentRequired: booleanSchema,
    executionBasis: objectSchema, pricingSnapshot: ref("RentalExtensionPricingSnapshot"), chargeLines: arrayOf(objectSchema),
    calendarSnapshot: arrayOf(objectSchema), serviceSnapshots: arrayOf(objectSchema), priceVersionId: stringSchema,
    priceVersion: stringSchema, ruleVersion: stringSchema }),
  RentalOrderExtensionResult: objectOf({ order: objectSchema, extension: ref("RentalOrderExtensionRecord") }, ["order", "extension"]),
  RentalExchangePricingSegment: objectOf({ orderLineId: stringSchema, itemGroupId: stringSchema, pricingGroupId: stringSchema,
    quantity: { type: "integer", minimum: 1 }, startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" },
    source: objectOf({ kind: { type: "string", enum: ["quote", "extension", "price_version"] }, id: stringSchema,
      priceVersionId: stringSchema, priceVersion: stringSchema }, ["kind", "id", "priceVersion"]),
    rate: objectSchema, context: objectOf({ timeZone: stringSchema, legacyDayTypeMultipliers: booleanSchema,
      calendars: arrayOf(objectSchema), dayRates: arrayOf(objectSchema) }, ["timeZone", "legacyDayTypeMultipliers", "calendars"]),
    ruleSnapshot: objectSchema, calendarSnapshot: arrayOf(objectSchema), applyMinimumUnits: booleanSchema,
    selectedUnitAmount: numberSchema, billableUnits: numberSchema, billedHours: numberSchema, amount: numberSchema,
    membershipBenefit: objectSchema, couponBenefit: objectSchema, discountBenefit: objectSchema,
    discountLayers: arrayOf(objectOf({ evaluation: objectSchema,
      splitBasis: objectOf({ amount: numberSchema, reduction: numberSchema, consumedAmount: numberSchema, consumedReduction: numberSchema },
        ["amount", "reduction", "consumedAmount", "consumedReduction"]) }, ["evaluation"])),
    discountSplitBasis: objectOf({ amount: numberSchema, reduction: numberSchema, consumedAmount: numberSchema, consumedReduction: numberSchema },
      ["amount", "reduction", "consumedAmount", "consumedReduction"]),
    couponSplitBasis: objectOf({ amount: numberSchema, reduction: numberSchema, consumedAmount: numberSchema, consumedReduction: numberSchema },
      ["amount", "reduction", "consumedAmount", "consumedReduction"]),
    membershipSplitBasis: objectOf({ amount: numberSchema, reduction: numberSchema, consumedAmount: numberSchema, consumedReduction: numberSchema },
      ["amount", "reduction", "consumedAmount", "consumedReduction"]),
    splitBasis: objectOf({ startAt: { type: "string", format: "date-time" }, endAt: { type: "string", format: "date-time" },
      amount: numberSchema, billableUnits: numberSchema, billedHours: numberSchema, applyMinimumUnits: booleanSchema,
      consumedAmount: numberSchema, consumedUnits: numberSchema, consumedHours: numberSchema },
    ["startAt", "endAt", "amount", "billableUnits", "billedHours", "applyMinimumUnits", "consumedAmount", "consumedUnits", "consumedHours"]) },
  ["orderLineId", "itemGroupId", "quantity", "startAt", "endAt", "source", "rate", "context", "ruleSnapshot", "calendarSnapshot",
    "applyMinimumUnits", "selectedUnitAmount", "billableUnits", "billedHours", "amount"]),
  RentalExchangeExecutionBasis: objectOf({ effectiveFrom: { type: "string", format: "date-time" },
    priceBasis: { type: "string", enum: ["original_order_price", "replacement_current_price"] },
    categoryCode: stringSchema, categoryVersionId: stringSchema, adoptionRevision: numberSchema, categoryPolicySnapshot: objectSchema,
    pricingStrategies: arrayOf(objectOf({ unit: stringSchema, implementationVersion: stringSchema }, ["unit", "implementationVersion"])),
    rateSnapshot: arrayOf(objectSchema), ruleSnapshot: objectSchema, calendarSnapshot: arrayOf(objectSchema), pricingSnapshot: objectSchema,
    inspectionTemplateSnapshots: arrayOf(objectSchema), capabilitySnapshot: arrayOf(objectSchema),
    linePricing: objectOf({ version: { type: "integer", enum: [1] }, orderLineId: stringSchema,
      originalAmount: numberSchema, replacementAmount: numberSchema, previousSegments: arrayOf("RentalExchangePricingSegment"),
      segments: arrayOf("RentalExchangePricingSegment"), overdueBasis: ref("RentalExchangePricingSegment"),
      membershipPricing: objectOf({ version: { type: "integer", enum: [1] }, originalReduction: numberSchema,
        replacementReduction: numberSchema, originalNetAmount: numberSchema, replacementNetAmount: numberSchema, benefit: objectSchema },
      ["version", "originalReduction", "replacementReduction", "originalNetAmount", "replacementNetAmount", "benefit"]),
      couponPricing: objectOf({ version: { type: "integer", enum: [1] }, originalReduction: numberSchema,
        replacementReduction: numberSchema, originalNetAmount: numberSchema, replacementNetAmount: numberSchema, coupon: objectSchema },
      ["version", "originalReduction", "replacementReduction", "originalNetAmount", "replacementNetAmount", "coupon"]),
      discountPricing: { oneOf: [
        objectOf({ version: { type: "integer", enum: [1] }, originalReduction: numberSchema,
          replacementReduction: numberSchema, originalNetAmount: numberSchema, replacementNetAmount: numberSchema, evaluation: objectSchema },
        ["version", "originalReduction", "replacementReduction", "originalNetAmount", "replacementNetAmount", "evaluation"]),
        objectOf({ version: { type: "integer", enum: [2] }, originalReduction: numberSchema,
          replacementReduction: numberSchema, originalNetAmount: numberSchema, replacementNetAmount: numberSchema,
          evaluations: { type: "array", items: objectSchema, minItems: 2 } },
        ["version", "originalReduction", "replacementReduction", "originalNetAmount", "replacementNetAmount", "evaluations"])
      ] } },
    ["version", "orderLineId", "originalAmount", "replacementAmount", "previousSegments", "segments", "overdueBasis"]) },
  ["effectiveFrom", "priceBasis", "categoryCode", "pricingStrategies", "rateSnapshot", "ruleSnapshot", "calendarSnapshot", "inspectionTemplateSnapshots"]),
  RentalOrderChangeRecord: objectOf({ id: stringSchema, tenantId: stringSchema, workspaceId: stringSchema, orderId: stringSchema,
    type: stringSchema, status: stringSchema, sequence: numberSchema, request: objectSchema, beforeSnapshot: objectSchema, afterSnapshot: objectSchema,
    diff: objectOf({ exchange: objectOf({ executionBasis: ref("RentalExchangeExecutionBasis") }) }),
    refundAmount: numberSchema, additionalAmount: numberSchema, depositDelta: numberSchema, preAuthDelta: numberSchema,
    idempotencyKey: stringSchema, requestedBy: stringSchema, appliedBy: stringSchema, requestedAt: stringSchema, appliedAt: stringSchema, createdAt: stringSchema }),
  RentalExchangeServiceOption: objectOf({ id: stringSchema, tenantId: stringSchema, categoryCode: stringSchema,
    code: stringSchema, name: stringSchema, serviceType: stringSchema, billingUnit: stringSchema, price: numberSchema,
    minimumQuantity: numberSchema, maximumQuantity: numberSchema, coverageLimit: numberSchema, deductible: numberSchema,
    termsVersion: stringSchema, terms: stringSchema, applicableItemGroupIds: arrayOf(stringSchema),
    applicableFulfillmentModes: arrayOf(stringSchema), applicableLocationIds: arrayOf(stringSchema), customerScope: stringSchema,
    selectionMode: stringSchema, mandatoryRule: objectSchema, insuranceProviderStatus: stringSchema, insuranceProviderName: stringSchema,
    requiresCapacity: booleanSchema, status: stringSchema, version: stringSchema, createdAt: stringSchema, updatedAt: stringSchema },
  ["id", "tenantId", "categoryCode", "code", "name", "serviceType", "billingUnit", "price", "termsVersion", "terms",
    "applicableItemGroupIds", "applicableFulfillmentModes", "applicableLocationIds", "requiresCapacity", "status", "version"]),
  RentalExchangeServiceOptions: arrayOf("RentalExchangeServiceOption"),
  RentalExchangeServiceSelection: objectOf({ serviceId: stringSchema, quantity: { type: "integer", minimum: 1 },
    scheduledStartAt: { type: "string", format: "date-time" }, scheduledEndAt: { type: "string", format: "date-time" },
    serviceLocationId: stringSchema }, ["serviceId", "quantity", "scheduledStartAt", "scheduledEndAt", "serviceLocationId"], false),
  RentalExchangePickupInspectionRequest: objectOf({ templateId: stringSchema, templateVersion: stringSchema,
    confirmationHash: { type: "string", pattern: "^[a-f0-9]{64}$" }, results: objectSchema,
    attachments: { type: "array", items: stringSchema, maxItems: 50 }, handoverSignatureFileAssetId: stringSchema,
    customerConfirmed: booleanSchema }, ["templateId", "templateVersion", "confirmationHash", "results", "customerConfirmed"], false),
  RentalExchangePickupInspectionRequirements: objectOf({ required: booleanSchema, confirmationHash: stringSchema,
    templates: arrayOf(objectSchema) }, ["required", "confirmationHash", "templates"]),
  RentalPostPickupExchangeRequest: objectOf({ type: { type: "string", enum: ["post_pickup_exchange"] }, orderLineId: stringSchema,
    allocationId: stringSchema, replacementItemGroupId: stringSchema, replacementAssetId: stringSchema, replacementPricingGroupId: stringSchema,
    priceBasis: { type: "string", enum: ["original_order_price", "replacement_current_price"] },
    originalDisposition: { type: "string", enum: ["return_to_warehouse", "off_shelf"] }, exchangeLocationId: stringSchema,
    cancelServiceOccurrenceIds: arrayOf(stringSchema), services: { type: "array", items: ref("RentalExchangeServiceSelection"), maxItems: 20 },
    serviceConfirmationHash: { type: "string", pattern: "^[a-f0-9]{64}$", description: "Required when confirming new services; never an authorization credential." },
    inspectionSnapshot: objectSchema, reason: stringSchema, customerConfirmed: booleanSchema, expectedUpdatedAt: stringSchema },
  ["type", "orderLineId", "allocationId", "replacementItemGroupId"]),
  RentalPostPickupExchangeApplyRequest: { allOf: [ref("RentalPostPickupExchangeRequest"), {
    type: "object", properties: { replacementPickupInspection: ref("RentalExchangePickupInspectionRequest") },
    required: ["reason", "customerConfirmed", "expectedUpdatedAt", "inspectionSnapshot"] }] },
  RentalPostPickupExchangePreview: objectOf({ orderId: stringSchema, type: { type: "string", enum: ["post_pickup_exchange"] },
    beforePayableAmount: numberSchema, recalculatedPayableAmount: numberSchema, differenceAmount: numberSchema,
    additionalAmount: numberSchema, refundAmount: numberSchema, depositDelta: numberSchema, preAuthDelta: numberSchema, currency: stringSchema,
    exchange: objectOf({ orderLineId: stringSchema, allocationId: stringSchema, originalAmount: numberSchema, replacementAmount: numberSchema,
      serviceSnapshots: arrayOf("AiExtensionServiceSnapshotDraft"), serviceConfirmationHash: stringSchema,
      pickupInspection: ref("RentalExchangePickupInspectionRequirements"),
      executionBasis: ref("RentalExchangeExecutionBasis") }), pricingSnapshot: objectOf({ scope: { type: "string", enum: ["exchange_line"] },
      fullChargeLines: arrayOf(objectSchema), previousPayableAmount: numberSchema, recalculatedPayableAmount: numberSchema, differenceAmount: numberSchema }) }),
  RentalPostPickupExchangeResult: objectOf({ order: objectSchema, change: ref("RentalOrderChangeRecord") }, ["order", "change"]),
  RentalFundingEvent: objectOf({ id: stringSchema, tenantId: stringSchema, workspaceId: stringSchema, orderId: stringSchema,
    instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
    action: { type: "string", enum: ["initiate", "append", "capture", "refund", "release", "fail"] },
    amount: numberSchema, balanceAfter: numberSchema,
    provider: { type: "string", enum: ["mock", "offline", "alipay", "wechat_pay", "stripe"] },
    paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer"] },
    idempotencyKey: stringSchema, reason: stringSchema, operator: stringSchema, failureCode: stringSchema,
    at: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" } },
    ["id", "tenantId", "workspaceId", "orderId", "instrument", "action", "amount", "balanceAfter", "provider", "idempotencyKey", "reason", "at", "createdAt"]),
  UpdateRentalServiceOccurrenceRequest: {
    ...objectOf({
      action: { type: "string", enum: [...RENTAL_SERVICE_EXECUTION_ACTIONS] },
      actualAt: { type: "string", nullable: true, description: "原 DTO 接受 ISO8601。省略或 null 使用服务端当前时刻，实际时间及先后顺序由原履约服务核验。" },
      result: { type: "string", maxLength: 2000, nullable: true, description: "complete 须填写有效执行结果，原服务去除首尾空白。" },
      executedQuantity: { type: "integer", minimum: 1, nullable: true, description: "本段实际数量。complete 省略时完成全部剩余数量，显式 null 由原执行器前校验拒绝，剩余上限由原服务核验。" },
      reason: { type: "string", maxLength: 1000, nullable: true, description: "cancel、fail 和 no_show 须填写有效原因。" },
      evidenceAttachments: { ...arrayOf({ type: "string", maxLength: 500 }), nullable: true, description: "原证据引用。省略或 null 保留该发生项已有引用。" },
      customerConfirmed: { type: "boolean", nullable: true, description: "complete 须明确提供，省略会拒绝。false 或 null 记录为未确认；相同请求与原键重试读取同一执行收据，改为其他确认值仍按原指纹拒绝。" },
      refundAmount: { type: "number", minimum: 0, nullable: true, description: "终止动作的建议退款额，省略或 null 采用原未执行净额，实际建议由原服务限制并生成审核事实。" },
      compensationAmount: { type: "number", minimum: 0, nullable: true, description: "终止动作的补偿金额，省略保留原值，提供时沿原金额工具保存。" }
    } satisfies Record<keyof UpdateRentalServiceOccurrenceRequest, SchemaObject>, ["action"]),
    description: "原 UpdateRentalServiceOccurrenceDto。complete 每段使用独立稳定的 Idempotency-Key 请求头，重试保持原键与原请求。原执行器前的完成参数拒绝给出 serviceExecutionNotCommitted，事务及提交后错误沿原收据核对。",
    example: { action: "complete", executedQuantity: 1, result: "完成本段服务", customerConfirmed: true }
  },
  RefundRentalServiceRequest: {
    ...objectOf({
      amount: { type: "number", minimum: 0.01, description: "原 DTO 接受不小于 0.01 的数字，原服务按金额工具核对已批准金额及原审核事实。" },
      idempotencyKey: { type: "string", minLength: 1, maxLength: 191, pattern: "\\S" },
      reason: { type: "string", minLength: 1, maxLength: 1000, pattern: "\\S" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer", null], nullable: true, description: "省略或 null 采用 offline_cash，原资金事务核验当前空间已启用方式。" }
    } satisfies Record<keyof RefundRentalServiceRequest, SchemaObject>, ["amount", "idempotencyKey", "reason"]),
    description: "原 RefundRentalServiceDto。原 Controller 派生服务退款资金键，在同一事务写入模拟资金事件、服务退款事实和操作收据。纯演练准入、当前订单范围及批准金额沿原服务核验。",
    example: { amount: 90, idempotencyKey: "service-refund-example", reason: "按原服务审核金额退款" }
  },
  RentalServiceExecutionResult: {
    ...objectOf({ order: ref("RentalOrder"), occurrence: ref("RentalOrderServiceOccurrence") }, ["order", "occurrence"]),
    description: "原履约更新及服务退款响应。order 是当前受权并脱敏的订单投影，履约重试的 occurrence 保留该原操作提交的发生项收据。"
  },
  RentalServiceExecutionReceipt: {
    oneOf: [
      objectOf({ status: { type: "string", enum: ["committed"] }, order: ref("RentalOrder"), occurrence: ref("RentalOrderServiceOccurrence") }, ["status", "order", "occurrence"]),
      objectOf({ status: { type: "string", enum: ["unknown"] } }, ["status"], false)
    ],
    description: "原 RentalServiceExecutionReceipt。读取前核当前订单范围，committed 保留原段收据和当前受权订单，unknown 仅返回状态并保留原操作等待核对。"
  },
  InitiateRentalFundingRequest: {
    ...objectOf({
      instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
      idempotencyKey: { type: "string", minLength: 1, pattern: "\\S", description: "原服务去除首尾空白，按空间、订单、款项、动作及同一键读取原事件。" },
      reason: { type: "string", minLength: 1, pattern: "\\S" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer", null], nullable: true, description: "省略或 null 采用 offline_cash，沿原资金事务核验当前空间已启用方式。" }
    } satisfies Record<keyof InitiateRentalFundingRequest, SchemaObject>, ["instrument", "idempotencyKey", "reason"]),
    description: "原 InitiateRentalFundingDto。首次金额由原订单及适用待补款续租取得。原通用入口使用 mock 来源，沿原服务核验非生产进程、development 空间且订单无真实资金、支付单或线下登记。",
    example: { instrument: "deposit", idempotencyKey: "funding-initiate-example", reason: "原订单押金演练" }
  },
  RentalFundingAmountRequest: {
    ...objectOf({
      instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
      amount: { type: "number", minimum: 0.01, description: "原 DTO 接受不小于 0.01 的数字。模拟动作沿原金额工具及存储精度，原线下押金处置另要求金额精确到分。" },
      idempotencyKey: { type: "string", minLength: 1, pattern: "\\S" },
      reason: { type: "string", minLength: 1, pattern: "\\S" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer", null], nullable: true, description: "追加或退款时省略或 null 采用 offline_cash，抵扣时原 Controller 采用 undefined。" },
      offlineDeposit: {
        ...objectOf({
          sourceEventId: { type: "string", minLength: 1, maxLength: 191 },
          evidenceFileAssetId: { type: "string", minLength: 1, maxLength: 191 }
        }, ["sourceEventId", "evidenceFileAssetId"]),
        nullable: true,
        description: "仅原线下实收押金的退款或抵扣，绑定本订单原 offline 收款事件和同空间已完成的线下凭证。省略或 null 时沿原模拟入口，退款方式须匹配原实收方式。"
      }
    } satisfies Record<keyof RentalFundingAmountRequest, SchemaObject>, ["instrument", "amount", "idempotencyKey", "reason"]),
    description: "原 RentalFundingAmountDto。追加、抵扣和退款分别沿原款项动作矩阵、余额与待收待退门禁。线下实收押金处置保存原凭证与资金事件的同事务收据。",
    example: { instrument: "deposit", amount: 10, idempotencyKey: "funding-amount-example", reason: "原订单押金动作演练" }
  },
  RentalFundingReleaseRequest: {
    ...objectOf({
      amount: { type: "number", minimum: 0.01, nullable: true, description: "原 HTTP DTO 的可选金额。省略时由服务端释放当前全部剩余冻结额度，显式 null 沿原正金额门禁拒绝。" },
      idempotencyKey: { type: "string", minLength: 1, pattern: "\\S" },
      reason: { type: "string", minLength: 1, pattern: "\\S" }
    } satisfies Record<keyof RentalFundingReleaseDto, SchemaObject>, ["idempotencyKey", "reason"]),
    description: "原 RentalFundingReleaseDto，款项固定为 preauthorization。原 SDK 以幂等键和原因请求全额释放，HTTP DTO 同时保留可选部分金额，模拟准入与当前余额由原资金服务核验。",
    example: { idempotencyKey: "funding-release-example", reason: "释放原演练预授权余额" }
  },
  RentalFundingFailureRequest: {
    ...objectOf({
      instrument: { type: "string", enum: ["rental", "deposit", "preauthorization"] },
      failureCode: { type: "string", minLength: 1 },
      idempotencyKey: { type: "string", minLength: 1, pattern: "\\S" },
      reason: { type: "string", minLength: 1, pattern: "\\S" },
      paymentMethod: { type: "string", enum: ["offline_cash", "offline_transfer", null], nullable: true, description: "省略或 null 采用 offline_cash，沿原资金事务核验当前空间已启用方式。" }
    } satisfies Record<keyof RentalFundingFailureRequest, SchemaObject>, ["instrument", "failureCode", "idempotencyKey", "reason"]),
    description: "原 RentalFundingFailureDto。沿纯演练准入追加金额为 0 的失败事件并保留原失败码，原款项余额保持原服务计算值。",
    example: { instrument: "deposit", failureCode: "simulation_failed", idempotencyKey: "funding-failure-example", reason: "记录原演练失败" }
  },
  RentalFundingBalance: objectOf({ orderId: stringSchema, balanceBasis: { type: "string", enum: ["real", "simulated"] },
    simulationAllowed: booleanSchema,
    rental: objectOf({ payable: numberSchema, collected: numberSchema, refunded: numberSchema, securityCaptured: numberSchema,
      corporatePaid: { type: "number", description: "Original corporate repayment allocations reconciled to their aggregate payment; not extra cash. Legacy responses may omit it." },
      balance: { type: "number", description: "Signed remaining receivable after original cash, security captures and corporate allocations; negative means unresolved overpayment." },
      pendingExtensionAmount: numberSchema, due: { type: "number", minimum: 0, description: "Server-computed current rental cash demand, including pending payable extensions." } },
      ["payable", "collected", "refunded", "securityCaptured", "balance", "pendingExtensionAmount", "due"]),
    deposit: objectOf({ collected: numberSchema, captured: numberSchema, refunded: numberSchema, balance: numberSchema,
      requiredAmount: numberSchema, pendingExtensionAmount: numberSchema, due: numberSchema },
      ["collected", "captured", "refunded", "balance", "requiredAmount", "pendingExtensionAmount", "due"]),
    preauthorization: objectOf({ frozen: numberSchema, captured: numberSchema, released: numberSchema, balance: numberSchema,
      requiredAmount: numberSchema, pendingExtensionAmount: numberSchema },
      ["frozen", "captured", "released", "balance", "requiredAmount", "pendingExtensionAmount"]), events: arrayOf("RentalFundingEvent") },
    ["orderId", "balanceBasis", "simulationAllowed", "rental", "deposit", "preauthorization", "events"]),
  RegisterPersonalMembershipRequest: objectOf({
    name: { type: "string", minLength: 1, maxLength: 120 }, phone: { type: "string", minLength: 1, maxLength: 40 },
    email: { type: "string", maxLength: 160 }, identityNo: { type: "string", maxLength: 80 },
    gender: stringSchema, birthday: { type: "string", format: "date" }, sourceChannel: stringSchema, region: { type: "string", maxLength: 64 },
    channel: { type: "string", enum: ["admin", "app"] }, temporaryPassword: { type: "string", minLength: 8, maxLength: 128, writeOnly: true },
    directApprove: { type: "boolean" }, idempotencyKey: { type: "string", maxLength: 100 },
    onlyNew: { type: "boolean", description: "Admin import only. Existing membership returns skipped=true under the customer business lock without changing status, profile, review or credentials." },
  }, ["name", "phone", "channel"]),
  RegisterPersonalMembershipResponse: objectOf({ customerId: stringSchema, membershipStatus: stringSchema, skipped: { type: "boolean" }, review: objectSchema }, ["customerId", "membershipStatus"]),
  MembershipRegistrationSettings: objectOf({ registrationMode: { type: "string", enum: ["manual", "automatic"] }, updatedAt: { type: "string", format: "date-time" }, supportsOnlyNewImport: { type: "boolean", description: "Server supports create-only imports. Legacy servers omit this field; clients must hide that import until supported." } }, ["registrationMode"]),
  RecordCustomerCorporateCreditMaturityRequest: objectOf({ ledgerId: { type: "string", minLength: 1, maxLength: 191 },
    dueAt: { type: "string", format: "date-time" }, basisRef: { type: "string", minLength: 1, maxLength: 191 },
    reason: { type: "string", minLength: 1, maxLength: 500 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 191 } },
    ["ledgerId", "dueAt", "basisRef", "reason", "idempotencyKey"], false),
  CustomerCorporateCreditMaturityReceipt: objectOf({ ledgerId: stringSchema, orderId: stringSchema, currency: stringSchema,
    dueAt: { type: "string", format: "date-time" }, basisRef: stringSchema, reason: stringSchema, idempotencyKey: stringSchema,
    recordedBy: stringSchema, recordedAt: { type: "string", format: "date-time" } },
    ["ledgerId", "orderId", "currency", "dueAt", "basisRef", "reason", "idempotencyKey", "recordedBy", "recordedAt"], false),
  ReverseCustomerCorporateCreditPaymentRequest: objectOf({ basisRef: { type: "string", minLength: 1, maxLength: 191 },
    reason: { type: "string", minLength: 1, maxLength: 500 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 191 } },
    ["basisRef", "reason", "idempotencyKey"], false),
  CustomerCorporateCreditPaymentReversalReceipt: objectOf({ paymentId: stringSchema, reversalId: stringSchema, customerId: stringSchema,
    amount: numberSchema, currency: stringSchema, allocations: arrayOf(objectOf({ allocationId: stringSchema, reversalId: stringSchema,
      orderId: stringSchema, workspaceId: stringSchema, amount: numberSchema }, ["allocationId", "reversalId", "orderId", "workspaceId", "amount"], false)),
    basisRef: stringSchema, reason: stringSchema, idempotencyKey: stringSchema, recordedBy: stringSchema, recordedAt: { type: "string", format: "date-time" } },
    ["paymentId", "reversalId", "customerId", "amount", "currency", "allocations", "basisRef", "reason", "idempotencyKey", "recordedBy", "recordedAt"], false),
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
      { ...objectOf({ type: { type: "string", enum: ["categories"] }, categoryCodes: { type: "array", items: { type: "string", pattern: RENTAL_CATEGORY_CODE_PATTERN.source, minLength: 2, maxLength: 64 }, minItems: 1 } }, ["type", "categoryCodes"]), additionalProperties: false }
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
      operatorShortName: { type: "string", maxLength: 64, description: "后台营运商简称；未设置时省略，展示沿原租户全称。" },
      tenantStatus: stringSchema,
      brandName: stringSchema,
      brandLogoUrl: stringSchema,
      faviconUrl: stringSchema,
      themeColor: stringSchema,
      adminCornerRadius: storedAdminRadiusSchema,
      adminContainerRadius: storedAdminRadiusSchema,
      adminButtonRadius: storedAdminRadiusSchema,
      adminInputRadius: storedAdminRadiusSchema,
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
  AdminLoginBranding: objectOf({
    showTitle: booleanSchema, showDescription: booleanSchema, showHighlights: booleanSchema, showFooter: booleanSchema,
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
      adminCornerRadius: storedAdminRadiusSchema,
      adminContainerRadius: storedAdminRadiusSchema,
      adminButtonRadius: storedAdminRadiusSchema,
      adminInputRadius: storedAdminRadiusSchema,
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
      adminCornerRadius: adminContainerRadiusInput,
      adminContainerRadius: adminContainerRadiusInput,
      adminButtonRadius: adminControlRadiusInput,
      adminInputRadius: adminControlRadiusInput,
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
  SaveWorkspaceAccessRequest: objectOf(
    {
      workspaceId: stringSchema,
      roleId: stringSchema,
      dataScope: stringSchema,
      locationScope: objectOf({ mode: { type: "string", enum: ["all", "selected"] }, locationIds: arrayOf(stringSchema) }, ["mode", "locationIds"]),
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
      categoryMetadata: objectOf({
        structureVersion: { type: "integer", enum: [1] }, categoryVersionId: stringSchema,
        definitionVersion: stringSchema, name: stringSchema,
        icon: { type: "string", enum: [...RENTAL_CATEGORY_ICON_CODES] },
        fields: arrayOf(objectOf({ code: stringSchema, label: stringSchema,
          type: { type: "string", enum: ["string", "number", "boolean", "date", "select"] }, unit: stringSchema, options: arrayOf(stringSchema)
        }, ["code", "label", "type"], false))
      }, ["structureVersion", "definitionVersion", "name", "fields"], false),
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
      items: arrayOf(objectOf({ id: stringSchema, code: stringSchema, name: stringSchema, description: stringSchema,
        inventoryMode: stringSchema, images: arrayOf(objectOf({ url: stringSchema, alt: stringSchema }, ["url"], false)),
        attributes: objectOf({}, [], { oneOf: [stringSchema, numberSchema, booleanSchema] }),
        attributeLabels: objectOf({}, [], stringSchema),
        startingPrice: objectOf({ amount: numberSchema, unit: stringSchema, currency: stringSchema }, ["amount", "unit", "currency"], false)
      }, ["id", "code", "name", "inventoryMode"], false)),
      pricingGroups: arrayOf(objectSchema),
      services: arrayOf(objectSchema),
      locations: arrayOf(objectOf({ id: stringSchema, code: stringSchema, name: stringSchema, status: stringSchema,
        address: stringSchema, city: stringSchema, latitude: numberSchema, longitude: numberSchema,
        businessHours: stringSchema, contactPhone: stringSchema,
        capabilities: arrayOf({ type: "string", enum: ["pickup", "return", "storage", "delivery"] })
      }, ["id", "code", "name", "status"], false)),
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
  ClientQuoteDeliveryAddressDraft: objectOf(
    {
      recipient: { type: "string", minLength: 1, maxLength: 120 },
      phone: { type: "string", minLength: 1, maxLength: 40, pattern: "^\\+?[0-9][0-9\\s()-]{5,38}$" },
      countryCode: { type: "string", maxLength: 8 },
      province: { type: "string", minLength: 1, maxLength: 100 },
      city: { type: "string", minLength: 1, maxLength: 100 },
      district: { type: "string", maxLength: 100 },
      detail: { type: "string", minLength: 1, maxLength: 500 },
      postalCode: { type: "string", maxLength: 20 }
    },
    ["recipient", "phone", "province", "city", "detail"], false
  ),
  ClientQuoteRequest: {
    ...objectOf(
      {
        bookingIdentity: { $ref: "#/components/schemas/RentalBookingIdentityInput" },
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
        deliveryAddressId: stringSchema,
        deliveryAddressDraft: ref("ClientQuoteDeliveryAddressDraft")
      },
      ["fulfillmentMode", "fulfillmentLocationId", "startAt", "endAt", "lines"], false
    ),
    not: { type: "object", properties: { deliveryAddressId: stringSchema,
      deliveryAddressDraft: ref("ClientQuoteDeliveryAddressDraft") },
      required: ["deliveryAddressId", "deliveryAddressDraft"] }
  },
  RentalQuoteSourceSnapshot: objectOf({
    version: { type: 'string', enum: ['rental-quote-source-1'], readOnly: true },
    tenantId: stringSchema, workspaceId: stringSchema,
    actor: objectOf({ kind: { type: 'string', enum: ['user', 'customer'] }, id: stringSchema }, ['kind', 'id'], false),
    audience: { type: 'string', enum: ['operator', 'staff', 'client'] }
  }, ['version', 'tenantId', 'workspaceId', 'actor', 'audience'], false),
  RentalQuoteInventoryBasis: objectOf({
    version: { type: 'string', enum: ['rental-quote-inventory-1'], readOnly: true },
    tenantId: stringSchema, workspaceId: stringSchema,
    groups: { ...arrayOf(objectOf({
      id: stringSchema, tenantId: stringSchema, categoryCode: stringSchema, code: stringSchema, name: stringSchema,
      inventoryMode: { type: 'string', enum: ['serialized', 'quantity', 'consumable', 'bundle'] },
      unit: stringSchema, status: { type: 'string', enum: ['enabled', 'disabled'] },
      bundleComponents: { ...arrayOf(objectOf({ itemGroupId: stringSchema, itemGroupCode: stringSchema,
        itemGroupName: stringSchema, quantity: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        optional: { type: 'boolean' }, substitutionGroup: stringSchema
      }, ['itemGroupId', 'itemGroupCode', 'itemGroupName', 'quantity', 'optional'], false)), maxItems: 256 }
    }, ['id', 'tenantId', 'categoryCode', 'code', 'name', 'inventoryMode', 'unit', 'status', 'bundleComponents'], false)), minItems: 1, maxItems: 100 }
  }, ['version', 'tenantId', 'workspaceId', 'groups'], false),
  RentalQuoteSnapshot: objectOf({
    id: stringSchema, tenantId: stringSchema, quoteNo: stringSchema, request: objectSchema,
    inventoryBasis: { ...ref('RentalQuoteInventoryBasis'), readOnly: true, description: 'Core-owned inventory composition; not a reservation or authorization. Legacy records omit it.' },
    sourceSnapshot: { ...ref('RentalQuoteSourceSnapshot'), readOnly: true,
      description: 'Server-derived provenance, never authorization. Legacy records may omit it; own-scope access then fails closed.' },
    deliveryAddressSnapshot: objectSchema, rentalLineAmounts: { type: 'object', additionalProperties: numberSchema },
    chargeLines: arrayOf(objectSchema), rentalAmount: numberSchema, discountAmount: numberSchema,
    couponAmount: numberSchema, serviceAmount: numberSchema, fulfillmentAmount: numberSchema,
    depositAmount: numberSchema, preAuthAmount: numberSchema, payableAmount: numberSchema, receivableAmount: numberSchema,
    expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' },
    consumedAt: { type: 'string', format: 'date-time' }, consumedOrderId: stringSchema
  }, ['id', 'tenantId', 'quoteNo', 'request', 'chargeLines', 'rentalAmount', 'discountAmount', 'couponAmount',
    'serviceAmount', 'fulfillmentAmount', 'depositAmount', 'preAuthAmount', 'payableAmount', 'receivableAmount', 'expiresAt', 'createdAt']),
  ClientQuote: objectOf(
    {
      id: stringSchema,
      quoteNo: stringSchema,
      sourceSnapshot: { ...ref('RentalQuoteSourceSnapshot'), readOnly: true },
      rentalLineAmounts: { type: 'object', additionalProperties: numberSchema },
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
  ClientExtensionList: arrayOf("RentalOrderExtensionRecord"),
  ClientExtensionPreview: ref("RentalOrderExtensionPreview"),
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
  )
};
