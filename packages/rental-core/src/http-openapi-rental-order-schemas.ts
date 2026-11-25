/** Rental 订单列表与详情的只读字段贡献，沿原领域合同和公开映射描述历史快照。
 * 当前身份、经营空间、对象可见性及敏感资料释放由原 Guard 和 Core 读取入口裁定。 */
import type {
  CustomerOrderSubjectSnapshot,
  RentalAllocation,
  RentalAssignmentState,
  RentalCapabilityDecisionSnapshot,
  RentalCapabilityExceptionSnapshot,
  RentalCapabilityRequirementSnapshot,
  RentalDeliveryAddressSnapshot,
  RentalFulfillmentLocationSnapshot,
  RentalMembershipBenefitEvaluation,
  RentalMembershipSnapshot,
  RentalOrder,
  RentalOrderFeeReview,
  RentalOrderLine,
  RentalOrderListSummary,
  RentalOrderPage,
  RentalOrderServiceOccurrence,
  RentalQuoteCalendarDay,
  RentalQuoteChargeLine,
  RentalReservation,
  RentalRuleConfig,
  RentalWorkspaceCapabilitySnapshotEntry
} from "./contracts";
import { RentalCoreOrderStatus } from "./contracts";
import {
  arrayOf,
  booleanSchema,
  numberSchema,
  objectOf,
  objectSchema,
  ref,
  stringSchema,
  type SchemaObject
} from "./http-openapi-contract";

const timestampSchema: SchemaObject = { type: "string", format: "date-time" };

export const RENTAL_ORDER_COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  RentalOrderLine: objectOf({
    id: stringSchema,
    pricingGroupId: stringSchema,
    pricingGroupCode: stringSchema,
    pricingGroupName: stringSchema,
    reservationPrecision: { type: "string", enum: ["group", "exact_model"] },
    pricingGroupMemberItemGroupIds: arrayOf(stringSchema),
    itemGroupId: stringSchema,
    itemGroupCode: stringSchema,
    itemGroupName: stringSchema,
    inventoryMode: stringSchema,
    quantity: numberSchema,
    cancelledQuantity: numberSchema,
    unitPrice: numberSchema,
    amount: numberSchema,
    note: stringSchema
  } satisfies Record<keyof RentalOrderLine, SchemaObject>, [
    "id", "itemGroupId", "itemGroupCode", "itemGroupName", "inventoryMode", "quantity", "unitPrice", "amount"
  ]),
  RentalOrderReservation: objectOf({
    id: stringSchema,
    orderId: stringSchema,
    orderLineId: stringSchema,
    itemGroupId: stringSchema,
    locationId: stringSchema,
    quantity: numberSchema,
    releasedQuantity: numberSchema,
    status: stringSchema,
    expiresAt: timestampSchema,
    createdAt: timestampSchema
  } satisfies Record<keyof RentalReservation, SchemaObject>, [
    "id", "orderId", "orderLineId", "itemGroupId", "locationId", "quantity", "releasedQuantity", "status", "createdAt"
  ]),
  RentalOrderAllocation: objectOf({
    id: stringSchema,
    orderId: stringSchema,
    orderLineId: stringSchema,
    itemGroupId: stringSchema,
    assetId: stringSchema,
    assetNo: stringSchema,
    quantity: numberSchema,
    status: stringSchema,
    metadata: objectOf({
      reservationId: stringSchema,
      source: { type: "string", enum: ["manual", "automatic"] },
      protected: booleanSchema,
      assignedAt: stringSchema,
      lockedAt: stringSchema,
      itemGroupName: stringSchema,
      locationId: stringSchema,
      exchangeId: stringSchema,
      exchangeDisposition: { type: "string", enum: ["return_to_warehouse", "off_shelf"] },
      returnReceipt: objectOf({
        batchId: stringSchema,
        returnedAt: stringSchema,
        sourceAllocationId: stringSchema,
        orderLineId: stringSchema,
        quantity: numberSchema
      }, ["batchId", "returnedAt", "sourceAllocationId", "orderLineId", "quantity"])
    }, ["source", "protected", "assignedAt"])
  } satisfies Record<keyof RentalAllocation, SchemaObject>, ["id", "orderId", "orderLineId", "quantity", "status"]),
  RentalOrderAssignment: {
    ...objectOf({
      revision: numberSchema,
      issue: stringSchema,
      issueSource: objectOf({
        version: { type: "string", enum: ["rental-fulfillment-issue-1"] },
        code: { type: "string", enum: ["resource_shortage", "assigned_resource_unavailable", "configuration_unavailable", "allocation_incomplete"] }
      }, ["version", "code"]),
      history: arrayOf(objectOf({
        id: stringSchema,
        at: stringSchema,
        actor: stringSchema,
        action: stringSchema,
        reason: stringSchema,
        before: arrayOf("RentalOrderAllocation"),
        after: arrayOf("RentalOrderAllocation")
      }, ["id", "at", "actor", "action", "before", "after"])),
      operationLock: objectOf({
        ownerId: stringSchema,
        ownerName: stringSchema,
        token: { type: "string", enum: [""], readOnly: true, description: "原公开映射固定返回空串。操作锁凭证由原锁操作单独取得。" },
        expiresAt: stringSchema
      }, ["ownerId", "ownerName", "token", "expiresAt"], false)
    } satisfies Record<keyof RentalAssignmentState, SchemaObject>, ["revision", "history"]),
    description: "原分配修订、异常及历史。读取返回的锁信息仅含公开状态。"
  },
  RentalOrderFulfillmentLocationSnapshot: objectOf({
    id: stringSchema,
    code: stringSchema,
    name: stringSchema,
    type: stringSchema,
    capabilities: arrayOf(stringSchema),
    address: stringSchema,
    contactName: stringSchema,
    contactPhone: stringSchema,
    businessHours: stringSchema,
    operator: objectOf({
      id: stringSchema,
      code: stringSchema,
      name: stringSchema,
      type: stringSchema,
      settlementMode: stringSchema
    }, ["id", "code", "name", "type"])
  } satisfies Record<keyof RentalFulfillmentLocationSnapshot, SchemaObject>, ["id", "code", "name", "type", "capabilities", "operator"]),
  RentalOrderDeliveryAddressSnapshot: {
    ...objectOf({
      addressId: stringSchema,
      recipient: stringSchema,
      phoneMasked: stringSchema,
      countryCode: stringSchema,
      province: stringSchema,
      city: stringSchema,
      district: stringSchema,
      detail: stringSchema,
      postalCode: stringSchema,
      latitude: numberSchema,
      longitude: numberSchema
    } satisfies Record<Exclude<keyof RentalDeliveryAddressSnapshot, "phone">, SchemaObject>, [
      "recipient", "phoneMasked", "countryCode", "province", "city", "detail"
    ], false),
    description: "原配送地址的公开投影，联系电话沿 publicOrder 脱敏。完整收件信息通过原独立受权读取入口取得。"
  },
  RentalOrderChargeLine: {
    ...objectOf({
      code: stringSchema,
      name: stringSchema,
      type: stringSchema,
      amount: numberSchema,
      sourceId: stringSchema,
      sourceVersion: stringSchema,
      detail: stringSchema
    } satisfies Record<keyof RentalQuoteChargeLine, SchemaObject>, ["code", "name", "type", "amount"]),
    description: "原追加费用事实。提前归还退款和订单变更差额按原记录保留金额正负号。"
  },
  RentalOrderFeeReview: objectOf({
    id: stringSchema,
    type: stringSchema,
    sourceId: stringSchema,
    suggestedAmount: { type: "number", nullable: true, description: "原建议金额。null 表示金额待核定。" },
    maximumAmount: numberSchema,
    basis: arrayOf(stringSchema),
    status: { type: "string", enum: ["pending", "approved", "rejected"] },
    decidedAmount: numberSchema,
    reason: stringSchema,
    reviewedBy: stringSchema,
    reviewedAt: stringSchema,
    createdAt: stringSchema
  } satisfies Record<keyof RentalOrderFeeReview, SchemaObject>, ["id", "type", "suggestedAmount", "basis", "status", "createdAt"]),
  RentalOrderRuleSnapshot: {
    ...objectOf({
      pricing: objectSchema,
      payment: objectSchema,
      deposit: objectSchema,
      preauthorization: objectSchema,
      membershipSecurityReduction: objectSchema,
      fulfillment: objectSchema,
      overdue: objectSchema,
      cancellation: objectSchema,
      qualification: objectSchema,
      damage: objectSchema,
      extension: objectSchema,
      earlyReturn: objectSchema,
      tax: objectSchema
    } satisfies Record<keyof RentalRuleConfig, SchemaObject>),
    description: "原订单保存的规则快照，各规则块保留原版本结构与历史字段。读取沿原订单关联快照。"
  },
  RentalOrderCalendarDay: objectOf({
    date: stringSchema,
    year: numberSchema,
    dayType: stringSchema,
    businessStatus: stringSchema,
    source: stringSchema,
    calendarVersion: stringSchema,
    itemGroupId: stringSchema,
    itemGroupCode: stringSchema,
    unitCount: numberSchema,
    unitAmount: numberSchema,
    multiplier: numberSchema,
    amount: numberSchema,
    priceAt: stringSchema,
    hitLayer: stringSchema,
    pricingPlanVersion: stringSchema
  } satisfies Record<keyof RentalQuoteCalendarDay, SchemaObject>, [
    "date", "year", "dayType", "businessStatus", "source", "calendarVersion", "itemGroupId", "itemGroupCode", "unitCount", "unitAmount", "multiplier", "amount"
  ]),
  RentalOrderMembershipSnapshot: {
    ...objectOf({
      enterpriseBasis: objectSchema,
      bookingIdentity: { type: "string", enum: ["personal", "enterprise_employee"] },
      personalCustomerId: stringSchema,
      personalCustomerName: stringSchema,
      corporateCustomerId: stringSchema,
      corporateCustomerName: stringSchema,
      corporateMembershipId: stringSchema,
      enterpriseContractAndPayer: booleanSchema,
      settlement: objectOf({
        mode: stringSchema,
        payerCustomerId: stringSchema,
        currency: stringSchema,
        billingCycle: stringSchema,
        creditId: stringSchema,
        creditRevision: numberSchema,
        confirmedAt: stringSchema
      }, ["mode", "payerCustomerId", "currency", "billingCycle", "confirmedAt"]),
      benefitSource: { type: "string", enum: ["personal", "corporate"] },
      personalPlan: objectSchema,
      corporatePlan: objectSchema,
      qualifications: arrayOf(objectSchema),
      resolvedAt: stringSchema
    } satisfies Record<keyof RentalMembershipSnapshot, SchemaObject>, [
      "bookingIdentity", "personalCustomerId", "personalCustomerName", "enterpriseContractAndPayer", "benefitSource", "qualifications", "resolvedAt"
    ]),
    description: "原报价继承的会员身份、企业关系及方案快照。企业依据、资格与方案正文保留原历史结构。"
  },
  RentalOrderMembershipBenefitEvaluation: objectOf({
    applicableServiceIds: arrayOf(stringSchema),
    scope: ref("CustomerMembershipBenefitScope"),
    scopeMatched: booleanSchema,
    source: stringSchema,
    planId: stringSchema,
    planVersionId: stringSchema,
    planName: stringSchema,
    type: stringSchema,
    calculation: stringSchema,
    configuredValue: numberSchema,
    appliesTo: stringSchema,
    appliedAmount: numberSchema,
    base: numberSchema,
    configuredMaximum: numberSchema,
    securityRiskLevels: arrayOf(stringSchema),
    securityRiskAssessments: arrayOf(objectOf({
      itemGroupId: stringSchema,
      pricingGroupId: stringSchema,
      riskLevel: stringSchema,
      allowed: booleanSchema,
      quantity: numberSchema
    }, ["riskLevel", "allowed", "quantity"])),
    securityRiskCheck: stringSchema,
    securityPolicySnapshot: objectSchema,
    securityOriginalAmount: numberSchema,
    securityEligibleBase: numberSchema,
    skippedReason: stringSchema,
    allocations: { type: "object", additionalProperties: numberSchema },
    detail: stringSchema
  } satisfies Record<keyof RentalMembershipBenefitEvaluation, SchemaObject>, [
    "source", "planId", "planVersionId", "planName", "type", "calculation", "configuredValue", "appliesTo", "appliedAmount", "detail"
  ]),
  RentalOrderCapabilitySnapshot: objectOf({
    code: stringSchema,
    implementationVersion: stringSchema,
    configVersion: stringSchema,
    config: objectSchema
  } satisfies Record<keyof RentalWorkspaceCapabilitySnapshotEntry, SchemaObject>, ["code", "implementationVersion", "configVersion", "config"]),
  RentalOrderCapabilityRequirementsSnapshot: objectOf({
    structureVersion: { type: "number", enum: [1] },
    categoryCode: stringSchema,
    definitionVersion: stringSchema,
    policyHash: stringSchema,
    fulfillmentMode: stringSchema,
    rootItemGroupIds: arrayOf(stringSchema),
    items: arrayOf(objectOf({
      itemGroupId: stringSchema,
      inventoryMode: stringSchema,
      attributes: { type: "object", additionalProperties: { oneOf: [stringSchema, booleanSchema] } },
      componentItemGroupIds: arrayOf(stringSchema)
    }, ["itemGroupId", "inventoryMode", "attributes", "componentItemGroupIds"])),
    matches: arrayOf(objectOf({ code: stringSchema, itemGroupIds: arrayOf(stringSchema) }, ["code", "itemGroupIds"]))
  } satisfies Record<keyof RentalCapabilityRequirementSnapshot, SchemaObject>, [
    "structureVersion", "categoryCode", "definitionVersion", "policyHash", "fulfillmentMode", "rootItemGroupIds", "items", "matches"
  ]),
  RentalOrderCapabilityDecisionSnapshot: objectOf({
    id: stringSchema,
    point: stringSchema,
    capability: stringSchema,
    implementationVersion: stringSchema,
    configVersion: stringSchema,
    rulesetVersion: stringSchema,
    decision: stringSchema,
    riskCodes: arrayOf(stringSchema),
    blockReasons: arrayOf(objectSchema),
    notices: arrayOf(objectSchema),
    feeBases: arrayOf(objectSchema),
    equipment: arrayOf(objectSchema),
    at: stringSchema
  } satisfies Record<keyof RentalCapabilityDecisionSnapshot, SchemaObject>, [
    "id", "point", "capability", "implementationVersion", "configVersion", "decision", "riskCodes", "blockReasons", "notices", "feeBases", "at"
  ]),
  RentalOrderCapabilityExceptionSnapshot: objectOf({
    capability: stringSchema,
    riskCode: stringSchema,
    reason: stringSchema,
    confirmedBy: stringSchema,
    confirmedWithPermission: stringSchema,
    confirmedAt: stringSchema,
    decisionId: stringSchema,
    implementationVersion: stringSchema,
    configVersion: stringSchema,
    rulesetVersion: stringSchema,
    equipment: arrayOf(objectSchema)
  } satisfies Record<keyof RentalCapabilityExceptionSnapshot, SchemaObject>, [
    "capability", "riskCode", "reason", "confirmedBy", "confirmedWithPermission", "confirmedAt", "implementationVersion", "configVersion"
  ]),
  RentalOrderSubjectSnapshot: objectOf({
    role: stringSchema,
    customerId: stringSchema,
    customerType: stringSchema,
    name: stringSchema,
    phoneMasked: stringSchema,
    corporateName: stringSchema,
    unifiedSocialCreditCodeMasked: stringSchema,
    agentId: stringSchema,
    authorityScope: { type: "object", additionalProperties: booleanSchema },
    authorityValidFrom: stringSchema,
    authorityValidTo: stringSchema,
    contractId: stringSchema,
    contractNo: stringSchema,
    invoiceProfileId: stringSchema
  } satisfies Record<keyof CustomerOrderSubjectSnapshot, SchemaObject>, ["role", "name"]),
  RentalOrderServiceOccurrence: objectOf({
    serviceId: stringSchema,
    serviceCode: stringSchema,
    serviceName: stringSchema,
    serviceType: stringSchema,
    serviceVersion: stringSchema,
    workspaceId: stringSchema,
    billingUnit: stringSchema,
    selectionMode: stringSchema,
    requiredByRule: booleanSchema,
    mandatoryRuleHit: stringSchema,
    unitPrice: numberSchema,
    quantity: numberSchema,
    billingUnits: numberSchema,
    amount: numberSchema,
    formula: stringSchema,
    coverageLimit: numberSchema,
    deductible: numberSchema,
    applicableItemGroupIds: arrayOf(stringSchema),
    termsVersion: stringSchema,
    terms: stringSchema,
    eligibility: arrayOf(objectOf({ rule: stringSchema, passed: booleanSchema, detail: stringSchema }, ["rule", "passed"])),
    insuredDisplayable: { type: "boolean", enum: [false] },
    insuranceProviderStatus: stringSchema,
    insuranceProviderName: stringSchema,
    requiresCapacity: booleanSchema,
    scheduledStartAt: stringSchema,
    scheduledEndAt: stringSchema,
    serviceLocationId: stringSchema,
    capacityQuantity: numberSchema,
    discountAllocatedAmount: numberSchema,
    couponAllocatedAmount: numberSchema,
    occurrenceId: stringSchema,
    origin: stringSchema,
    exchangeId: stringSchema,
    customerConfirmationRecordedBy: stringSchema,
    customerConfirmationChannel: stringSchema,
    extensionId: stringSchema,
    extensionSequence: numberSchema,
    reservationKey: stringSchema,
    executionStatus: stringSchema,
    actualStartAt: stringSchema,
    actualEndAt: stringSchema,
    executionResult: stringSchema,
    executedQuantity: numberSchema,
    cancelledQuantity: numberSchema,
    executionSegments: arrayOf(objectOf({
      quantity: numberSchema,
      actualStartAt: stringSchema,
      actualEndAt: stringSchema,
      result: stringSchema,
      evidenceAttachments: arrayOf(stringSchema),
      customerConfirmedAt: stringSchema,
      executedBy: stringSchema
    }, ["quantity", "actualEndAt", "result"])),
    failureReason: stringSchema,
    evidenceAttachments: arrayOf(stringSchema),
    customerConfirmedAt: stringSchema,
    executedBy: stringSchema,
    refundStatus: stringSchema,
    refundAmount: numberSchema,
    refundReviewId: stringSchema,
    refundedAt: stringSchema,
    refundedBy: stringSchema,
    compensationAmount: numberSchema
  } satisfies Record<keyof RentalOrderServiceOccurrence, SchemaObject>, [
    "serviceId", "serviceCode", "serviceName", "serviceType", "serviceVersion", "workspaceId", "billingUnit", "selectionMode", "requiredByRule",
    "unitPrice", "quantity", "billingUnits", "amount", "formula", "termsVersion", "terms", "eligibility", "insuredDisplayable",
    "requiresCapacity", "scheduledStartAt", "scheduledEndAt", "serviceLocationId", "capacityQuantity"
  ]),
  RentalOrder: {
    ...objectOf({
      inspectionTemplateSnapshots: arrayOf(objectSchema),
      categoryVersionId: stringSchema,
      id: stringSchema,
      tenantId: stringSchema,
      orderNo: stringSchema,
      categoryCode: stringSchema,
      status: { type: "string", enum: Object.values(RentalCoreOrderStatus) },
      customerType: { type: "string", enum: ["personal", "corporate"] },
      customerId: stringSchema,
      customerName: stringSchema,
      contactPhone: stringSchema,
      membershipSnapshot: ref("RentalOrderMembershipSnapshot"),
      membershipBenefitEvaluations: arrayOf("RentalOrderMembershipBenefitEvaluation"),
      fulfillmentMode: stringSchema,
      fulfillmentLocationId: stringSchema,
      fulfillmentLocationName: stringSchema,
      fulfillmentLocationSnapshot: ref("RentalOrderFulfillmentLocationSnapshot"),
      returnLocationId: stringSchema,
      returnLocationName: stringSchema,
      returnLocationSnapshot: ref("RentalOrderFulfillmentLocationSnapshot"),
      deliveryAddressSnapshot: ref("RentalOrderDeliveryAddressSnapshot"),
      startAt: timestampSchema,
      actualRentalStartAt: timestampSchema,
      endAt: { ...timestampSchema, description: "原始约定归还时点，读取原订单保存值。" },
      effectiveEndAt: { ...timestampSchema, description: "当前约定归还时点，存量省略时沿原消费者回落到 endAt。" },
      carrierRentalDueAt: timestampSchema,
      quoteId: stringSchema,
      quoteNo: stringSchema,
      pricingPlanVersion: stringSchema,
      priceVersionId: stringSchema,
      priceVersion: stringSchema,
      ruleVersion: stringSchema,
      ruleSnapshot: ref("RentalOrderRuleSnapshot"),
      calendarVersion: stringSchema,
      calendarSnapshot: arrayOf("RentalOrderCalendarDay"),
      capabilitySnapshot: arrayOf("RentalOrderCapabilitySnapshot"),
      capabilityRequirementsSnapshot: ref("RentalOrderCapabilityRequirementsSnapshot"),
      capabilityDecisions: arrayOf("RentalOrderCapabilityDecisionSnapshot"),
      capabilityExceptions: arrayOf("RentalOrderCapabilityExceptionSnapshot"),
      serviceSnapshots: arrayOf("RentalOrderServiceOccurrence"),
      contractSubjectCustomerId: stringSchema,
      payerSubjectCustomerId: stringSchema,
      userSubjectCustomerId: stringSchema,
      agentId: stringSchema,
      subjectSnapshot: arrayOf("RentalOrderSubjectSnapshot"),
      capabilityPolicy: { type: "string", enum: ["snapshot", "legacy_empty"], description: "原持久读取对缺能力快照的存量订单采用 legacy_empty。" },
      chargeLines: arrayOf("RentalOrderChargeLine"),
      feeReviews: arrayOf("RentalOrderFeeReview"),
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
      taxRate: numberSchema,
      taxAmount: numberSchema,
      currency: stringSchema,
      cancellationReason: stringSchema,
      cancelledAt: timestampSchema,
      pickupOverdueAt: timestampSchema,
      noShowNoticeAt: timestampSchema,
      noShowAt: timestampSchema,
      noShowReason: stringSchema,
      completedAt: timestampSchema,
      totalAmount: numberSchema,
      lines: arrayOf("RentalOrderLine"),
      reservations: arrayOf("RentalOrderReservation"),
      allocations: arrayOf("RentalOrderAllocation"),
      assignment: ref("RentalOrderAssignment"),
      createdBy: stringSchema,
      createdAt: timestampSchema,
      updatedAt: timestampSchema
    } satisfies Record<keyof RentalOrder, SchemaObject>, [
      "id", "tenantId", "orderNo", "categoryCode", "status", "customerType", "customerName", "fulfillmentMode",
      "fulfillmentLocationId", "fulfillmentLocationName", "fulfillmentLocationSnapshot", "returnLocationSnapshot", "startAt", "endAt",
      "quoteId", "quoteNo", "pricingPlanVersion", "ruleVersion", "ruleSnapshot", "chargeLines", "rentalAmount", "discountAmount",
      "couponAmount", "serviceAmount", "fulfillmentAmount", "depositAmount", "preAuthAmount", "payableAmount", "adjustmentAmount",
      "finalPayableAmount", "totalAmount", "lines", "reservations", "allocations", "createdBy", "createdAt", "updatedAt"
    ]),
    description: "原 RentalOrder 公开读取。金额和币种取原订单，关联快照保留历史版本与省略字段。配送电话与操作锁凭证沿原公开映射释放。"
  },
  RentalOrderListSummary: objectOf({
    statusBreakdown: arrayOf(objectOf({
      status: { type: "string", enum: Object.values(RentalCoreOrderStatus) },
      count: { type: "integer", minimum: 0 }
    }, ["status", "count"])),
    pendingFeeCount: { type: "integer", minimum: 0 }
  } satisfies Record<keyof RentalOrderListSummary, SchemaObject>, ["statusBreakdown", "pendingFeeCount"]),
  RentalOrderPage: {
    ...objectOf({
      items: arrayOf("RentalOrder"),
      page: { type: "integer", minimum: 1 },
      pageSize: { type: "integer", minimum: 1, maximum: 200 },
      total: { type: "integer", minimum: 0 },
      summary: ref("RentalOrderListSummary")
    } satisfies Record<keyof RentalOrderPage, SchemaObject>, ["items", "page", "pageSize", "total"]),
    description: "提供 page 或 pageSize 时的原分页响应。摘要按同一筛选集合计算，历史调用方可省略 summary。",
    example: { items: [], page: 1, pageSize: 20, total: 0, summary: { statusBreakdown: [], pendingFeeCount: 0 } }
  },
  RentalOrderListResponse: {
    oneOf: [arrayOf("RentalOrder"), ref("RentalOrderPage")],
    description: "省略 page 和 pageSize 时返回原纯数组，提供任一分页参数时返回 RentalOrderPage。",
    example: []
  }
};
