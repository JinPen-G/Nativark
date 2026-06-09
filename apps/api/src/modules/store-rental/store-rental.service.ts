import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import {
  BillingMode,
  ConfigStatus,
  CorporateContractAttachmentResult,
  CorporateMonthlyBillSummary,
  CreateStoreRentalContractRequest,
  CreateCorporateContractAttachmentRequest,
  CreateVehicleConditionPhotoRecordRequest,
  CreateVehicleLocationEventRequest,
  CreateVehicleAccidentRecordRequest,
  CreateVehicleMaintenanceRecordRequest,
  CreateStoreRentalFeeRequest,
  CreateStoreRentalNotificationRequest,
  CreateStoreRentalOperationLockRequest,
  CreateStoreRentalOrderRequest,
  CreateStoreRentalOrderResult,
  CreateStoreRentalRemarkRequest,
  CreateStoreRentalTransactionRequest,
  DispatchOptimizationReasonCode,
  DispatchOptimizationResultStatus,
  CorporateDetail,
  CorporateListQuery,
  CorporateListResult,
  CorporateSummary,
  BindTboxDeviceRequest,
  CreatePriceAdjustmentScheduleRequest,
  CreateVehicleTransferTaskRequest,
  AdvanceVehicleTransferTaskRequest,
  DispatchStatus,
  FinanceDocumentRow,
  FinanceManualAdjustmentRow,
  FinanceOverviewMetrics,
  FinancePreAuthorizationRow,
  FinanceReconciliationRow,
  FinanceTransactionRow,
  MarketingPlanDetail,
  MarketingPlanSummary,
  MemberDetail,
  MemberListQuery,
  MemberListResult,
  MemberReviewTask,
  MemberSummary,
  MembershipPlanSummary,
  OperationLockStatus,
  OrderMainStatus,
  PaymentStatus,
  PriceAdjustmentSchedule,
  PriceVersionRecord,
  PricingQuoteBillingSegment,
  PricingQuoteExplanationLine,
  PricingPlanDetail,
  PricingPlanSummary,
  PricingQuoteRequest,
  PricingQuoteResult,
  ProcessFinanceManualAdjustmentRequest,
  ProcessMemberReviewRequest,
  ProcessMemberRiskRequest,
  ProcessMemberRiskResult,
  RoleScope,
  SaveCorporateRequest,
  SaveFinanceDocumentRequest,
  SaveFinanceManualAdjustmentRequest,
  SaveFinancePreAuthorizationRequest,
  SaveMarketingPlanRequest,
  SaveMemberRequest,
  SaveMembershipPlanRequest,
  SavePricingPlanRequest,
  SaveStoreRentalRuleConfigRequest,
  SaveStationCalendarDayRequest,
  SaveVehicleAttachmentRequest,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  SettleCorporateMonthlyBillRequest,
  StationCalendarDay,
  StationCapacitySnapshot,
  StationCapacityRefreshResult,
  StoreRentalAvailabilityRequest,
  StoreRentalAvailabilityResult,
  StoreRentalAiDispatchAnalyzeRequest,
  StoreRentalAiDispatchAnalysisResult,
  StoreRentalAiDispatchRecommendation,
  StoreRentalAiDispatchRiskRow,
  StoreRentalCustomerType,
  StoreRentalDispatchApplyRequest,
  StoreRentalDispatchApplyResult,
  StoreRentalDispatchBoard,
  StoreRentalDispatchCandidate,
  StoreRentalDispatchEvent,
  StoreRentalDispatchEventQuery,
  StoreRentalDispatchHardLockRequest,
  StoreRentalDispatchManualReassignRequest,
  StoreRentalDispatchOptimizeRequest,
  StoreRentalDispatchOrderRow,
  StoreRentalDispatchPlan,
  StoreRentalDispatchResultRow,
  StoreRentalDispatchTask,
  StoreRentalDispatchTaskPool,
  StoreRentalDispatchTaskQuery,
  StoreRentalDispatchCloseTaskRequest,
  StoreRentalDispatchTaskActionResult,
  StoreRentalDispatchVehicleUnavailableOrderResult,
  StoreRentalDispatchVehicleUnavailableRequest,
  StoreRentalDispatchVehicleUnavailableResult,
  StoreRentalEventSnapshotRecord,
  StoreRentalFeeLedgerItem,
  StoreRentalInspectionRecord,
  StoreRentalContractRecord,
  StoreRentalIdempotencyRecord,
  StoreRentalNotificationRecord,
  StoreRentalOperationLockRecord,
  StoreRentalOrderNotificationRecord,
  StoreRentalOrderOperationRecord,
  StoreRentalOrderActionResult,
  StoreRentalOrderDetail,
  StoreRentalOrderFulfillmentRecords,
  StoreRentalOrderRemarkRecord,
  StoreRentalMode,
  StoreRentalOrderSummary,
  StoreRentalOrderTimelineItem,
  StoreRentalSettlementSummary,
  StoreRentalRuleConfig,
  StoreRentalRuleVersionRecord,
  StoreRentalTransactionRecord,
  StoreRentalVehicleDetail,
  StoreStationListQuery,
  StoreStationListResult,
  StoreStationHierarchyNode,
  StoreStationSummary,
  StoreValueAddedServiceSummary,
  TboxCommandRecord,
  TboxCommandResult,
  TboxDeviceSummary,
  UpdateVehicleAccidentRecordRequest,
  UpdateVehicleLocationEventRequest,
  UpdateVehicleMaintenanceRecordRequest,
  VehicleAccidentRecord,
  VehicleAttachmentRecord,
  VehicleConditionPhotoRecord,
  VehicleCredentialRecord,
  VehicleLocationEvent,
  VehicleOperationLog,
  VehicleGroupMaster,
  VehicleInstanceSummary,
  VehicleListQuery,
  VehicleListResult,
  VehicleMaintenanceRecord,
  VehicleOnboardItemRecord,
  VehicleStatusRecheckSummary,
  VehicleTransferTask,
  VehicleTransferTaskResult,
  RunTboxCommandRequest,
  WaiveStoreRentalFeeRequest,
  WorkflowTransition
} from "@rimo/shared";
import { IntegrationsService } from "../integrations/integrations.service";
import { StoreRentalRepository } from "./store-rental.repository";

interface OrderFilter {
  keyword?: string;
  status?: string;
}

interface StoredQuote {
  request: PricingQuoteRequest;
  result: PricingQuoteResult;
}

interface MarketingMatchResult {
  plan?: MarketingPlanDetail;
  discountAmount: number;
  segments: PricingQuoteBillingSegment[];
  explanationLines: PricingQuoteExplanationLine[];
  warnings: string[];
}

type ExtensionSettlementMode = "immediate" | "return_settlement" | "monthly";
type ReturnLocationChangeMode = "store" | "station";

type OrderActionEffect = {
  timelineAction: string;
  message: string;
};

type ReturnLocationQuickRedirectEffect = {
  order: StoreRentalOrderSummary;
  targetVehicle: VehicleInstanceSummary;
  previousPlateNo: string;
  operator: string;
  reasonLabel: string;
  fee?: StoreRentalFeeLedgerItem;
  settlementSummary: StoreRentalSettlementSummary;
  timelineAction: string;
  message: string;
};

type CancellationEstimate = {
  cancelType: "免责取消" | "有责取消";
  hoursBeforePickup: number;
  originalFeeAmount: number;
  feeAmount: number;
  waiverAmount: number;
};

type TerminationChargeInput = {
  code: string;
  name: string;
  source: StoreRentalFeeLedgerItem["source"];
  amount: number;
  description: string;
  operator: string;
  note: string;
};

type TerminationChargeResult = {
  feeId?: string;
  feeAmount: number;
  capturedAmount: number;
  pendingAmount: number;
};

@Injectable()
export class StoreRentalService {
  constructor(
    private readonly configService: ConfigService,
    private readonly storeRentalRepository: StoreRentalRepository,
    private readonly integrationsService: IntegrationsService
  ) {
    this.ruleVersionHistory = [
      this.createRuleVersionRecord(this.ruleConfig, 1, {
        savedBy: "系统初始化",
        savedAt: this.ruleConfig.effectiveAt,
        changeReason: "初始化门市租赁业务规则"
      })
    ];
  }

  private readonly quotes = new Map<string, StoredQuote>();
  private readonly dispatchEvents: StoreRentalDispatchEvent[] = [];
  private ruleVersionHistory: StoreRentalRuleVersionRecord[] = [];
  private readonly orderOperationRecords = new Map<
    string,
    StoreRentalOrderOperationRecord[]
  >();
  private readonly orderNotificationRecords = new Map<
    string,
    StoreRentalOrderNotificationRecord[]
  >();

  private ruleConfig: StoreRentalRuleConfig = {
    version: "store-rental-rules-v2026.05.01",
    status: ConfigStatus.Effective,
    effectiveAt: "2026-05-01T00:00:00+08:00",
    enabledModes: [StoreRentalMode.Store, StoreRentalMode.SelfService24h],
    payment: {
      enabledGateways: ["jiekou", "credit_card"],
      preAuthMode: "rental_ratio",
      preAuthRatioPercent: 100,
      fixedPreAuthAmount: 2000,
      maxPreAuthRatioPercent: 100,
      enterpriseMonthlyPreAuthAmount: 0,
      pickupFundHandling: ["performance_guarantee"],
      preAuthProvider: "mock"
    },
    pendingPayment: {
      enabled: true,
      holdMinutes: 30,
      timeoutAction: "cancel_release"
    },
    oneWayReturn: {
      enabled: true,
      baseFeeAmount: 180,
      crossCityFeeAmount: 350,
      requireStorePairRule: true
    },
    dispatch: {
      autoAssignEnabled: true,
      vehicleLockMode: "vehicle_group",
      minTurnoverMinutes: 30,
      allowManualOverride: true
    },
    durationBilling: {
      minBillableHours: 24,
      chargeAsDayAfterHours: 6,
      billingUnitMinutes: 60
    },
    pickupReturn: {
      allowEarlyPickup: true,
      earlyPickupGraceMinutes: 30,
      turnaroundMinutes: 60,
      operationLockEnabled: true,
      operationLockMinutes: 30,
      closePickupWindowAction: "keep_reserved",
      closeReturnWindowAction: "submit_return_inspection",
      allowEarlyReturn: true,
      earlyReturnRefundMode: "full_unused_days"
    },
    cancellation: {
      limitedFreeCancelEnabled: true,
      limitedFreeCancelMinutes: 30,
      freeCancelBeforeHours: 24,
      freeCancelRefundMode: "full_refund",
      freeCancelServiceFeeAmount: 50,
      responsibleCancelMode: "preauth_ratio",
      responsibleCancelFixedAmount: 200,
      responsibleCancelPreAuthRatioPercent: 30,
      tieredDeductionEnabled: true
    },
    noShow: {
      vehicleHoldHours: 2,
      autoReleaseEnabled: true,
      noShowGraceMinutes: 60,
      chargeNoShowFee: true,
      noShowFeeMode: "fixed_amount",
      noShowFeeAmount: 200,
      noShowPreAuthRatioPercent: 50
    },
    overdue: {
      graceMinutes: 30,
      billingUnitMinutes: 60,
      feeMultiplier: 1.2,
      penaltyEnabled: true,
      penaltyMode: "fixed_amount",
      fixedPenaltyAmount: 100,
      feeCapAmount: 0
    },
    extension: {
      allowExtension: true,
      allowOverdueExtension: true,
      customerPayMode: "pay_now",
      enterpriseMonthlyMode: "post_to_monthly_bill"
    },
    inspection: {
      requirePickupPhotos: true,
      requireReturnPhotos: true,
      damageReviewRole: "门店主管"
    },
    enterpriseBilling: {
      monthlySettlementEnabled: true,
      postOnOrderCompleted: true,
      requireCorporateSnapshot: true
    }
  };

  private readonly pricingPlans: PricingPlanDetail[] = [
    {
      id: "plan_store_standard",
      code: "STORE_STANDARD_202605",
      name: "门市租赁标准价目表",
      status: ConfigStatus.Effective,
      currency: "HKD",
      effectiveAt: "2026-05-01T00:00:00+08:00",
      version: "PRICE-STORE-20260501-001",
      vehicleGroupCount: 3,
      ruleLines: [
        {
          vehicleGroupCode: "GROUP_ECONOMY",
          vehicleGroupName: "Honda Jazz / 同级",
          baseDailyAmount: 620,
          weekendDailyAmount: 620,
          depositAmount: 2000
        },
        {
          vehicleGroupCode: "GROUP_SEVEN_SEATS",
          vehicleGroupName: "Toyota Noah / 同级 7座",
          baseDailyAmount: 980,
          weekendDailyAmount: 980,
          depositAmount: 3000
        },
        {
          vehicleGroupCode: "GROUP_EV",
          vehicleGroupName: "Tesla Model 3 / 同级",
          baseDailyAmount: 1080,
          weekendDailyAmount: 1080,
          depositAmount: 3500
        }
      ],
      serviceFees: [
        { code: "BASIC_PROTECTION", name: "基础保障", amount: 80, chargeMode: "per_day", enabled: true },
        { code: "NIGHT_PICKUP", name: "夜间取车服务", amount: 120, chargeMode: "fixed", enabled: true },
        { code: "CHILD_SEAT", name: "儿童座椅", amount: 60, chargeMode: "per_day", enabled: true }
      ],
      durationRules: [
        { minDays: 3, discountPercent: 5 },
        { minDays: 7, discountPercent: 12 }
      ],
      storeAdjustments: [
        {
          pickupStoreCode: "CENTRAL",
          returnStoreCode: "AIRPORT",
          amount: 180,
          name: "异店还车服务费"
        }
      ]
    }
  ];

  private priceVersionHistory: PriceVersionRecord[] = [
    {
      version: "PRICE-STORE-20260501-001",
      title: "五月门市标准价版本",
      savedBy: "价格规则管理员",
      savedAt: "2026-05-01T00:00:00+08:00",
      source: "manual",
      changeReason: "初始化门市租赁标准价",
      values: [
        {
          vehicleGroupCode: "GROUP_ECONOMY",
          vehicleGroupName: "Honda Jazz / 同级",
          dailyPrice: 620,
          depositAmount: 2000
        },
        {
          vehicleGroupCode: "GROUP_SEVEN_SEATS",
          vehicleGroupName: "Toyota Noah / 同级 7座",
          dailyPrice: 980,
          depositAmount: 3000
        },
        {
          vehicleGroupCode: "GROUP_EV",
          vehicleGroupName: "Tesla Model 3 / 同级",
          dailyPrice: 1080,
          depositAmount: 3500
        }
      ]
    },
    {
      version: "PRICE-STORE-20260401-001",
      title: "四月门市标准价版本",
      savedBy: "平台管理员",
      savedAt: "2026-04-01T09:00:00+08:00",
      source: "schedule",
      changeReason: "四月淡季价格表",
      values: [
        {
          vehicleGroupCode: "GROUP_ECONOMY",
          vehicleGroupName: "Honda Jazz / 同级",
          dailyPrice: 580,
          depositAmount: 2000
        },
        {
          vehicleGroupCode: "GROUP_SEVEN_SEATS",
          vehicleGroupName: "Toyota Noah / 同级 7座",
          dailyPrice: 920,
          depositAmount: 3000
        },
        {
          vehicleGroupCode: "GROUP_EV",
          vehicleGroupName: "Tesla Model 3 / 同级",
          dailyPrice: 980,
          depositAmount: 3500
        }
      ]
    }
  ];

  private priceSchedules: PriceAdjustmentSchedule[] = [
    {
      id: "schedule_store_20260515",
      effectiveAt: "2026-05-15T02:00:00+08:00",
      summary: "周末旺季门市标准价上调",
      status: "scheduled",
      createdBy: "价格规则管理员",
      createdAt: "2026-05-06T11:00:00+08:00",
      changes: [
        {
          vehicleGroupCode: "GROUP_ECONOMY",
          vehicleGroupName: "Honda Jazz / 同级",
          currentPrice: 620,
          newPrice: 680
        },
        {
          vehicleGroupCode: "GROUP_SEVEN_SEATS",
          vehicleGroupName: "Toyota Noah / 同级 7座",
          currentPrice: 980,
          newPrice: 1080
        }
      ]
    }
  ];

  private marketingPlans: MarketingPlanDetail[] = [
    this.createMarketingPlanSeed({
      id: "marketing_student",
      code: "MKT_STORE_STUDENT",
      name: "学生专案行销方案",
      displayName: "学生租车优惠",
      customerScope: "personal",
      priority: 80,
      manualVerification: true,
      qualificationName: "学生身份",
      requiredDocText: "学生证、在学证明等可证明学生身份的文件",
      weekdayRate: 0.85,
      holidayRate: 0.9,
      fixedDeductionAmount: 0,
      description: "学生身份到店核验后享受门市租车优惠",
      effectiveFrom: "2026-05-01T00:00:00+08:00",
      effectiveTo: "2026-12-31T23:59:59+08:00",
      vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
      rules: [
        {
          id: "rule_student_01",
          name: "资格核验后85折",
          vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
          membershipLevels: [],
          weekdayAction: { type: "discount", value: 0.85, label: "平日85折" },
          holidayAction: { type: "discount", value: 0.9, label: "假日9折" }
        }
      ]
    }),
    this.createMarketingPlanSeed({
      id: "marketing_weekday_member",
      code: "MKT_STORE_MEMBER_WEEKDAY",
      name: "个人会员平假日优惠",
      displayName: "个人会员平假日优惠",
      customerScope: "personal",
      priority: 60,
      manualVerification: false,
      weekdayRate: 0.9,
      holidayRate: 0.95,
      fixedDeductionAmount: 0,
      description: "个人会员门市租车标准优惠，平日与假日差异由行销方案承担",
      effectiveFrom: "2026-05-01T00:00:00+08:00",
      effectiveTo: "2026-09-30T23:59:59+08:00",
      vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
      rules: [
        {
          id: "rule_member_weekday_01",
          name: "平假日折扣",
          vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
          membershipLevels: [],
          weekdayAction: { type: "discount", value: 0.9, label: "平日9折" },
          holidayAction: { type: "discount", value: 0.95, label: "假日95折" }
        }
      ]
    }),
    this.createMarketingPlanSeed({
      id: "marketing_enterprise_monthly",
      code: "MKT_STORE_ENTERPRISE_MONTHLY",
      name: "企业月结协议方案",
      displayName: "企业月结协议方案",
      customerScope: "enterprise",
      priority: 90,
      manualVerification: false,
      weekdayRate: 0.8,
      holidayRate: 0.86,
      fixedDeductionAmount: 0,
      description: "企业资格客户可用；企业身份订单不支持优惠券和积分",
      effectiveFrom: "2026-05-01T00:00:00+08:00",
      effectiveTo: "2026-12-31T23:59:59+08:00",
      vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
      rules: [
        {
          id: "rule_enterprise_monthly_01",
          name: "企业资格折扣",
          vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
          membershipLevels: [],
          weekdayAction: { type: "discount", value: 0.8, label: "平日8折" },
          holidayAction: { type: "discount", value: 0.86, label: "假日86折" }
        }
      ]
    }),
    this.createMarketingPlanSeed({
      id: "marketing_long_rental",
      code: "MKT_STORE_LONG_RENTAL",
      name: "门市连租特惠",
      displayName: "连租3天特惠",
      customerScope: "all",
      priority: 50,
      manualVerification: false,
      weekdayRate: 0.95,
      holidayRate: 0.95,
      fixedDeductionAmount: 0,
      description: "连续租赁满 3 天自动候选，仍与其他行销方案互斥",
      effectiveFrom: "2026-05-01T00:00:00+08:00",
      effectiveTo: "2026-08-31T23:59:59+08:00",
      vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
      rules: [
        {
          id: "rule_long_rental_01",
          name: "连租3天95折",
          vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
          membershipLevels: [],
          minBillableDays: 3,
          weekdayAction: { type: "discount", value: 0.95, label: "连租95折" },
          holidayAction: { type: "discount", value: 0.95, label: "连租95折" }
        }
      ]
    })
  ];

  private orders: StoreRentalOrderSummary[] = [
    {
      id: "order_10001",
      orderNo: "SR202605060001",
      mode: StoreRentalMode.Store,
      memberId: "member_001",
      corporateId: "corp_001",
      customerName: "陈先生",
      customerPhoneMasked: "852****2388",
      corporateShortName: "ABC Trading",
      vehicleGroupName: "Toyota Noah / 同级 7座",
      plateNo: "RX 7821",
      pickupStoreName: "旺角门市",
      returnStoreName: "旺角门市",
      pickupAt: "2026-05-06T10:00:00+08:00",
      returnAt: "2026-05-08T10:00:00+08:00",
      totalAmount: 2380,
      billingMode: BillingMode.Monthly,
      mainStatus: OrderMainStatus.Renting,
      dispatchStatus: DispatchStatus.Locked,
      paymentStatus: PaymentStatus.MonthlyBilling,
      riskFlags: ["企业月结", "已验车"]
    },
    {
      id: "order_10002",
      orderNo: "SR202605060002",
      mode: StoreRentalMode.Store,
      memberId: "member_002",
      customerName: "林小姐",
      customerPhoneMasked: "852****6619",
      vehicleGroupName: "Honda Jazz / 同级",
      pickupStoreName: "中环门市",
      returnStoreName: "机场门市",
      pickupAt: "2026-05-06T15:30:00+08:00",
      returnAt: "2026-05-07T15:30:00+08:00",
      totalAmount: 780,
      billingMode: BillingMode.CustomerPay,
      mainStatus: OrderMainStatus.Reserved,
      dispatchStatus: DispatchStatus.PreAssigned,
      paymentStatus: PaymentStatus.DepositPaid,
      riskFlags: ["异店还车", "待取车"]
    },
    {
      id: "order_10003",
      orderNo: "SR202605060003",
      mode: StoreRentalMode.SelfService24h,
      memberId: "member_003",
      customerName: "王先生",
      customerPhoneMasked: "852****9081",
      vehicleGroupName: "Tesla Model 3 / 同级",
      pickupStoreName: "九龙湾自助点",
      returnStoreName: "九龙湾自助点",
      pickupAt: "2026-05-06T23:00:00+08:00",
      returnAt: "2026-05-07T23:00:00+08:00",
      totalAmount: 1180,
      billingMode: BillingMode.CustomerPay,
      mainStatus: OrderMainStatus.PendingPayment,
      dispatchStatus: DispatchStatus.ManualRequired,
      paymentStatus: PaymentStatus.Unpaid,
      riskFlags: ["夜间取车", "需人工确认"]
    }
  ];

  private readonly orderTimelines = new Map<
    string,
    StoreRentalOrderTimelineItem[]
  >();
  private readonly orderContracts = new Map<string, StoreRentalContractRecord[]>();
  private readonly orderNotifications = new Map<string, StoreRentalNotificationRecord[]>();
  private readonly orderRemarks = new Map<string, StoreRentalOrderRemarkRecord[]>();
  private readonly orderOperationLocks = new Map<string, StoreRentalOperationLockRecord[]>();
  private readonly orderIdempotencyRecords = new Map<string, StoreRentalIdempotencyRecord[]>();
  private readonly orderEventSnapshots = new Map<string, StoreRentalEventSnapshotRecord[]>();
  private readonly inspectionRecords = new Map<
    string,
    StoreRentalInspectionRecord[]
  >();
  private readonly settlementSummaries = new Map<
    string,
    StoreRentalSettlementSummary
  >();
  private readonly manualFeeLedgerItems = new Map<
    string,
    StoreRentalFeeLedgerItem[]
  >();
  private readonly persistedTransactions = new Map<
    string,
    StoreRentalTransactionRecord[]
  >();
  private readonly corporateMonthlyBillPayments = new Map<
    string,
    {
      paidAmount: number;
      lastPaidAt?: string;
      lastOperator?: string;
      note?: string;
    }
  >();
  private readonly financeDocuments: FinanceDocumentRow[] = [
    {
      id: "finance_doc_demo_001",
      documentNo: "INV202605080001",
      type: "invoice",
      status: "issued",
      orderId: "order_10001",
      orderNo: "SR202605060001",
      memberId: "member_001",
      corporateId: "corp_001",
      corporateShortName: "ABC Trading",
      customerName: "陈先生",
      title: "ABC Trading Limited",
      amount: 2380,
      issueSource: "monthly_bill",
      relatedFeeIds: ["fee_rental_10001", "fee_service_10001"],
      issuedAt: "2026-05-08T16:00:00+08:00",
      createdBy: "营运财务",
      remark: "企业月结开票",
      auditTrail: [
        {
          at: "2026-05-08T16:00:00+08:00",
          operator: "营运财务",
          action: "issued",
          remark: "企业月结开票",
          relatedFeeIds: ["fee_rental_10001", "fee_service_10001"]
        }
      ],
      createdAt: "2026-05-08T16:00:00+08:00"
    },
    {
      id: "finance_doc_demo_002",
      documentNo: "RCT202605060001",
      type: "receipt",
      status: "sent",
      orderId: "order_10002",
      orderNo: "SR202605060002",
      memberId: "member_002",
      customerName: "林小姐",
      title: "林小姐",
      amount: 780,
      issueSource: "order",
      relatedFeeIds: ["fee_rental_10002"],
      issuedAt: "2026-05-06T16:00:00+08:00",
      createdBy: "中环门市",
      remark: "客户自付收据",
      auditTrail: [
        {
          at: "2026-05-06T16:00:00+08:00",
          operator: "中环门市",
          action: "sent",
          remark: "客户自付收据",
          relatedFeeIds: ["fee_rental_10002"]
        }
      ],
      createdAt: "2026-05-06T16:00:00+08:00"
    }
  ];
  private readonly financePreAuthorizations: FinancePreAuthorizationRow[] = [
    {
      id: "finance_preauth_demo_001",
      preAuthNo: "PA202605060001",
      orderId: "order_10002",
      orderNo: "SR202605060002",
      memberId: "member_002",
      customerName: "林小姐",
      status: "frozen",
      channel: "online",
      provider: "mock_payment",
      authorizedAmount: 3000,
      capturedAmount: 0,
      releasedAmount: 0,
      remainingAmount: 3000,
      currency: "CNY",
      authCode: "MOCK-AUTH-060002",
      channelReferenceNo: "GW202605060002",
      paymentMethod: "信用卡预授权",
      frozenAt: "2026-05-06T10:10:00+08:00",
      expiresAt: "2026-05-20T10:10:00+08:00",
      operator: "中环门市",
      remark: "下单阶段线上预授权冻结。",
      createdAt: "2026-05-06T10:10:00+08:00"
    }
  ];
  private readonly financeManualAdjustments: FinanceManualAdjustmentRow[] = [
    {
      id: "finance_adj_demo_001",
      adjustmentNo: "ADJ202605080001",
      orderId: "order_10001",
      orderNo: "SR202605060001",
      memberId: "member_001",
      corporateId: "corp_001",
      corporateShortName: "ABC Trading",
      customerName: "陈先生",
      category: "ETC补录",
      direction: "charge",
      targetBillingMode: BillingMode.Monthly,
      amount: 120,
      status: "pending",
      reason: "还车后补录高速费用，按费用发生确认时间进入企业月结。",
      operator: "营运财务",
      createdAt: "2026-05-08T18:00:00+08:00"
    }
  ];
  private readonly vehicleOperationLogs = new Map<string, VehicleOperationLog[]>();
  private readonly vehicleLocationEvents = new Map<string, VehicleLocationEvent[]>();
  private readonly vehicleConditionPhotoRecords = new Map<
    string,
    VehicleConditionPhotoRecord[]
  >();
  private readonly vehicleMaintenanceRecords = new Map<
    string,
    VehicleMaintenanceRecord[]
  >();
  private readonly vehicleAccidentRecords = new Map<
    string,
    VehicleAccidentRecord[]
  >();
  private readonly vehicleCredentialRecords = new Map<
    string,
    VehicleCredentialRecord[]
  >();
  private readonly vehicleOnboardItems = new Map<string, VehicleOnboardItemRecord[]>();
  private readonly stationCalendarDays = new Map<string, StationCalendarDay[]>();
  private stationCapacitySnapshots: StationCapacitySnapshot[] = [];
  private vehicleTransferTasks: VehicleTransferTask[] = [];
  private tboxDevices: TboxDeviceSummary[] = [];
  private tboxCommandRecords: TboxCommandRecord[] = [];

  private stations: StoreStationSummary[] = [
    {
      id: "station_mk_counter",
      name: "旺角门市柜台",
      parentStoreName: "旺角门市",
      stationType: "门市柜台",
      serviceCapabilities: ["门市租车", "24小时自助"],
      parkingTotal: 18,
      parkingAvailable: 6,
      status: "enabled",
      serviceStatus: "normal",
      address: "九龙旺角弥敦道 610 号",
      contactName: "陈店长",
      contactPhone: "852-2388-0001",
      storeRentalEnabled: true,
      storeSelfServiceEnabled: true
    },
    {
      id: "station_central",
      name: "中环门市服务点",
      parentStoreName: "中环门市",
      stationType: "门市柜台",
      serviceCapabilities: ["门市租车"],
      parkingTotal: 12,
      parkingAvailable: 3,
      status: "enabled",
      serviceStatus: "normal",
      address: "中环干诺道中 88 号",
      contactName: "林主管",
      contactPhone: "852-6619-0002",
      storeRentalEnabled: true,
      storeSelfServiceEnabled: false
    },
    {
      id: "station_airport",
      name: "机场门市停车区",
      parentStoreName: "机场门市",
      stationType: "停车场",
      serviceCapabilities: ["门市租车", "24小时自助"],
      parkingTotal: 36,
      parkingAvailable: 11,
      status: "enabled",
      serviceStatus: "maintenance",
      address: "香港国际机场一号停车场",
      contactName: "机场值班",
      contactPhone: "852-3000-8000",
      storeRentalEnabled: true,
      storeSelfServiceEnabled: true
    }
  ];

  private vehicleGroupMasters: VehicleGroupMaster[] = [
    {
      id: "VG_ECONOMY",
      vehicleType: "汽车",
      brand: "Honda",
      model: "Fit",
      year: "2024",
      originType: "自有",
      seats: 5,
      displacement: "1.5L",
      trunkCapacity: "300L",
      features: ["自动挡", "倒车影像", "蓝牙"],
      storeProductGroupName: "经济型",
      dailyPrice: 620,
      freeKm: 300,
      pricePerKm: 1.5,
      status: "enabled"
    },
    {
      id: "VG_SEVEN",
      vehicleType: "汽车",
      brand: "Toyota",
      model: "Noah",
      year: "2024",
      originType: "自有",
      seats: 7,
      displacement: "2.0L",
      trunkCapacity: "500L",
      features: ["七人座", "电动侧门", "大行李空间"],
      storeProductGroupName: "七人座",
      dailyPrice: 980,
      freeKm: 300,
      pricePerKm: 2,
      status: "enabled"
    },
    {
      id: "VG_EV",
      vehicleType: "汽车",
      brand: "Tesla",
      model: "Model 3",
      year: "2025",
      originType: "租赁",
      seats: 5,
      displacement: "纯电 520km",
      trunkCapacity: "425L",
      features: ["电动车", "自动辅助驾驶", "特殊车辆"],
      storeProductGroupName: "电动车",
      dailyPrice: 1080,
      freeKm: 300,
      pricePerKm: 2,
      status: "enabled"
    }
  ];

  private vehicles: VehicleInstanceSummary[] = [
    {
      id: "VEH_001",
      licensePlate: "RX 7821",
      vin: "AHTLB3JE0R0001234",
      vehicleGroupName: "Toyota Noah / 同级 7座",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "旺角门市",
      currentStationName: "旺角门市柜台",
      operationStatus: "renting",
      enabled: true,
      currentServiceType: "STORE_STANDARD",
      serviceTypes: ["STORE_STANDARD", "STORE_24H"],
      mileage: 12880,
      color: "白色",
      cid: "TBOX-HK-001",
      isSpecial: false
    },
    {
      id: "VEH_002",
      licensePlate: "BCP 7315",
      vin: "JTMBW3FV0R1009012",
      vehicleGroupName: "Honda Jazz / 同级",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "中环门市",
      currentStationName: "中环门市服务点",
      operationStatus: "idle",
      enabled: true,
      currentServiceType: "STORE_STANDARD",
      serviceTypes: ["STORE_STANDARD"],
      mileage: 8021,
      color: "灰色",
      cid: "TBOX-HK-002",
      isSpecial: false
    },
    {
      id: "VEH_003",
      licensePlate: "EV 9308",
      vin: "LRW3E7FS0PC001122",
      vehicleGroupName: "Tesla Model 3 / 同级",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "机场门市",
      currentStationName: "机场门市停车区",
      operationStatus: "reserved",
      enabled: true,
      currentServiceType: "STORE_24H",
      serviceTypes: ["STORE_STANDARD", "STORE_24H"],
      mileage: 6420,
      color: "黑色",
      cid: "TBOX-HK-003",
      isSpecial: true
    },
    {
      id: "VEH_004",
      licensePlate: "HK 6208",
      vin: "JHMGK5850RS004208",
      vehicleGroupName: "Honda Jazz / 同级",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "旺角门市",
      currentStationName: "旺角门市柜台",
      operationStatus: "idle",
      enabled: true,
      currentServiceType: "STORE_STANDARD",
      serviceTypes: ["STORE_STANDARD", "STORE_24H"],
      mileage: 5120,
      color: "蓝色",
      cid: "TBOX-HK-004",
      isSpecial: false
    },
    {
      id: "VEH_005",
      licensePlate: "VN 3312",
      vin: "JTMBW3FV0R1003312",
      vehicleGroupName: "Toyota Noah / 同级 7座",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "中环门市",
      currentStationName: "中环门市服务点",
      operationStatus: "idle",
      enabled: true,
      currentServiceType: "STORE_STANDARD",
      serviceTypes: ["STORE_STANDARD"],
      mileage: 9300,
      color: "银色",
      cid: "TBOX-HK-005",
      isSpecial: false
    },
    {
      id: "VEH_006",
      licensePlate: "EV 2188",
      vin: "LRW3E7FS0PC002188",
      vehicleGroupName: "Tesla Model 3 / 同级",
      assetCompanyName: "RIMO 香港租户",
      currentStoreName: "机场门市",
      currentStationName: "机场门市停车区",
      operationStatus: "idle",
      enabled: true,
      currentServiceType: "STORE_24H",
      serviceTypes: ["STORE_STANDARD", "STORE_24H"],
      mileage: 3840,
      color: "白色",
      cid: "TBOX-HK-006",
      isSpecial: true
    }
  ];

  private valueAddedServices: StoreValueAddedServiceSummary[] = [
    {
      id: "svc_basic_protection",
      name: "基础保障",
      code: "BASIC_PROTECTION",
      category: "insurance",
      memberLimit: "不限",
      price: 80,
      unit: "/天",
      maxQuantity: 1,
      trackInventory: false,
      status: "enabled",
      version: "SVC-STORE-20260418-001",
      description: "门市租赁基础保障服务，按天计费。"
    },
    {
      id: "svc_child_seat",
      name: "儿童座椅",
      code: "CHILD_SEAT",
      category: "equipment",
      memberLimit: "不限",
      price: 60,
      unit: "/天",
      maxQuantity: 2,
      trackInventory: true,
      totalStock: 18,
      status: "enabled",
      version: "SVC-STORE-20260418-002",
      description: "门店按库存提供儿童安全座椅。"
    },
    {
      id: "svc_night_pickup",
      name: "夜间取车服务",
      code: "NIGHT_PICKUP",
      category: "service",
      memberLimit: "黄金会员及以上",
      price: 120,
      unit: "/次",
      maxQuantity: 1,
      trackInventory: false,
      status: "enabled",
      version: "SVC-STORE-20260418-003",
      description: "非柜台服务时间取车时加收一次性服务费。"
    }
  ];

  private membershipPlans: MembershipPlanSummary[] = [
    {
      id: "member_plan_silver",
      code: "MEMBER_SILVER",
      name: "白银会员",
      tierRank: 1,
      status: "enabled",
      upgradeCondition: "累计完成 1 单且无违约",
      benefitSummary: "基础会员价、订单短信提醒",
      orderDiscountPercent: 0,
      depositDiscountPercent: 0,
      freeServiceCount: 0
    },
    {
      id: "member_plan_gold",
      code: "MEMBER_GOLD",
      name: "黄金会员",
      tierRank: 2,
      status: "enabled",
      upgradeCondition: "累计完成 5 单或消费满 8,000",
      benefitSummary: "租金 95 折、免一次夜间服务费",
      orderDiscountPercent: 5,
      depositDiscountPercent: 10,
      freeServiceCount: 1
    },
    {
      id: "member_plan_black",
      code: "MEMBER_BLACK",
      name: "黑金会员",
      tierRank: 3,
      status: "enabled",
      upgradeCondition: "累计完成 12 单或消费满 30,000",
      benefitSummary: "租金 9 折、押金 8 折、优先保障库存",
      orderDiscountPercent: 10,
      depositDiscountPercent: 20,
      freeServiceCount: 2
    }
  ];

  private members: MemberDetail[] = [
    {
      id: "member_001",
      name: "陈嘉豪",
      phoneMasked: "852****2388",
      phone: "85261232388",
      source: "H5 注册",
      levelName: "黄金会员",
      pointsBalance: 1800,
      status: "active",
      reviewStatus: "approved",
      registerAt: "2026-03-12T10:20:00+08:00",
      totalOrders: 6,
      totalSpendAmount: 12880,
      tags: ["常用企业客户", "已完成认证"],
      identityVerified: true,
      driverLicenseVerified: true,
      identityNoMasked: "Z1234****",
      driverLicenseNoMasked: "HK-9***-881",
      birthday: "1990-08-12",
      emergencyContactName: "陈太太",
      emergencyContactPhone: "85261239999",
      notes: "偏好旺角门市取车。",
      riskNote: "",
      recentOrderNos: ["SR202605060001", "SR202604180021", "SR202604020013"],
      timeline: [
        {
          id: "member_001_t1",
          at: "2026-05-01T10:00:00+08:00",
          operator: "营运端",
          action: "升级为黄金会员",
          remark: "累计消费达到门槛"
        }
      ]
    },
    {
      id: "member_002",
      name: "林慧仪",
      phoneMasked: "852****6619",
      phone: "85251116619",
      source: "门店录入",
      levelName: "白银会员",
      pointsBalance: 0,
      status: "pending_review",
      reviewStatus: "pending",
      registerAt: "2026-05-18T15:10:00+08:00",
      totalOrders: 0,
      totalSpendAmount: 0,
      tags: ["新注册"],
      identityVerified: false,
      driverLicenseVerified: false,
      identityNoMasked: "R7788****",
      driverLicenseNoMasked: "HK-7***-612",
      birthday: "1995-11-04",
      emergencyContactName: "林先生",
      emergencyContactPhone: "85253334444",
      notes: "待审核驾照资料。",
      riskNote: "资料待人工核验",
      recentOrderNos: [],
      timeline: [
        {
          id: "member_002_t1",
          at: "2026-05-18T15:10:00+08:00",
          operator: "系统",
          action: "提交会员审核",
          remark: "待补人工校验"
        }
      ]
    },
    {
      id: "member_003",
      name: "王子俊",
      phoneMasked: "852****9081",
      phone: "85265099081",
      source: "企业导入",
      levelName: "黑金会员",
      pointsBalance: 3200,
      status: "suspended",
      reviewStatus: "approved",
      registerAt: "2025-12-02T09:12:00+08:00",
      totalOrders: 15,
      totalSpendAmount: 36600,
      tags: ["高价值客户", "逾期历史"],
      identityVerified: true,
      driverLicenseVerified: true,
      identityNoMasked: "Y8812****",
      driverLicenseNoMasked: "HK-3***-903",
      birthday: "1988-02-21",
      emergencyContactName: "王太",
      emergencyContactPhone: "85268881111",
      notes: "需营运主管确认后再恢复租车资格。",
      riskNote: "历史逾期两次，当前暂停租车资格",
      recentOrderNos: ["SR202605060003", "SR202604230008"],
      timeline: [
        {
          id: "member_003_t1",
          at: "2026-04-28T18:30:00+08:00",
          operator: "营运主管",
          action: "暂停会员资格",
          remark: "逾期事件待复核"
        }
      ]
    }
  ];

  private memberReviews: MemberReviewTask[] = [
    {
      id: "review_member_002",
      memberId: "member_002",
      memberName: "林慧仪",
      phoneMasked: "852****6619",
      submittedAt: "2026-05-18T15:10:00+08:00",
      reviewStatus: "pending",
      riskFlags: ["驾照待核验"],
      documents: ["身份证正面", "身份证反面", "驾照正面"],
      remark: "门店补录客户，待人工核验证件一致性"
    }
  ];

  private corporates: CorporateDetail[] = [
    {
      id: "corp_001",
      shortName: "ABC Trading",
      fullName: "ABC Trading Limited",
      status: "active",
      creditLimitAmount: 100000,
      accountPeriodDays: 30,
      contactName: "赵经理",
      contactPhone: "85263330001",
      activeOrderCount: 3,
      unpaidAmount: 18200,
      contractStatus: "active",
      billingEmail: "finance@abctrading.com",
      statementEmail: "statement@abctrading.com",
      billingCycleDay: 25,
      settlementMode: "monthly",
      reconciliationContactName: "陈财务",
      reconciliationContactPhone: "85263330002",
      autoGenerateStatement: true,
      creditWarningAmount: 85000,
      invoiceTitle: "ABC Trading Limited",
      linkedStores: ["旺角门市", "中环门市"],
      notes: "默认月结客户，支持旺角和中环门市下单。",
      recentOrderNos: ["SR202605060001", "SR202604290004"],
      contacts: [
        {
          id: "corp_001_contact_1",
          name: "赵经理",
          title: "行政经理",
          phone: "85263330001",
          email: "ops@abctrading.com"
        },
        {
          id: "corp_001_contact_2",
          name: "陈财务",
          title: "财务主管",
          phone: "85263330002",
          email: "finance@abctrading.com"
        }
      ],
      contracts: [
        {
          id: "corp_001_contract_1",
          contractNo: "CTR-ABC-2026-001",
          contractName: "ABC Trading 2026 年度门市租赁协议",
          status: "active",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          amount: 120000,
          linkedStores: ["旺角门市", "中环门市"],
          statementEmail: "statement@abctrading.com",
          attachments: ["abc-contract-2026.pdf"],
          remark: "年度框架协议，按月结算"
        }
      ]
    },
    {
      id: "corp_002",
      shortName: "Peak Studio",
      fullName: "Peak Studio Production Company",
      status: "paused",
      creditLimitAmount: 40000,
      accountPeriodDays: 15,
      contactName: "李制片",
      contactPhone: "85267770018",
      activeOrderCount: 1,
      unpaidAmount: 6200,
      contractStatus: "expiring",
      billingEmail: "ap@peakstudio.hk",
      statementEmail: "billing@peakstudio.hk",
      billingCycleDay: 15,
      settlementMode: "monthly",
      reconciliationContactName: "李制片",
      reconciliationContactPhone: "85267770018",
      autoGenerateStatement: false,
      creditWarningAmount: 30000,
      invoiceTitle: "Peak Studio Production Company",
      linkedStores: ["旺角门市"],
      notes: "合同即将到期，暂停新增订单。",
      recentOrderNos: ["SR202604230008"],
      contacts: [
        {
          id: "corp_002_contact_1",
          name: "李制片",
          title: "制片主任",
          phone: "85267770018",
          email: "ap@peakstudio.hk"
        }
      ],
      contracts: [
        {
          id: "corp_002_contract_1",
          contractNo: "CTR-PEAK-2026-002",
          contractName: "Peak Studio 项目用车月结协议",
          status: "expiring",
          startDate: "2026-02-01",
          endDate: "2026-05-31",
          amount: 50000,
          linkedStores: ["旺角门市"],
          statementEmail: "billing@peakstudio.hk",
          attachments: [],
          remark: "到期前暂停新增月结订单"
        }
      ]
    }
  ];

  listMembers(query: MemberListQuery = {}): MemberListResult | Promise<MemberListResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listMembers(query);
    }
    return this.buildMemberListResult(
      this.members.map((member) => this.toMemberSummary(member)),
      query
    );
  }

  private buildMemberListResult(
    rows: MemberSummary[],
    query: MemberListQuery = {}
  ): MemberListResult {
    const keyword = query.keyword?.trim().toLowerCase();
    const status = this.normalizeMemberStatusFilter(query.status);
    const reviewStatus = this.normalizeMemberReviewStatusFilter(query.reviewStatus);
    const tag = query.tag?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const availableTags = Array.from(
      new Set(rows.flatMap((row) => row.tags.map((item) => item.trim()).filter(Boolean)))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

    const filteredRows = rows.filter((row) => {
      const keywordMatched =
        !keyword ||
        row.name.toLowerCase().includes(keyword) ||
        row.phoneMasked.toLowerCase().includes(keyword);
      const statusMatched = !status || row.status === status;
      const reviewStatusMatched = !reviewStatus || row.reviewStatus === reviewStatus;
      const tagMatched = !tag || row.tags.includes(tag);
      return keywordMatched && statusMatched && reviewStatusMatched && tagMatched;
    });

    const offset = (page - 1) * pageSize;
    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      availableTags,
      stats: {
        total: filteredRows.length,
        active: filteredRows.filter((row) => row.status === "active").length,
        pendingReview: filteredRows.filter((row) => row.reviewStatus === "pending").length,
        blacklisted: filteredRows.filter((row) => row.status === "blacklisted").length
      }
    };
  }

  private normalizePositiveInteger(value: unknown, fallback: number) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }
    return Math.floor(numericValue);
  }

  private normalizeMemberStatusFilter(value: unknown): MemberSummary["status"] | undefined {
    return ["pending_review", "active", "suspended", "blacklisted"].includes(String(value))
      ? (value as MemberSummary["status"])
      : undefined;
  }

  private normalizeMemberReviewStatusFilter(
    value: unknown
  ): MemberSummary["reviewStatus"] | undefined {
    return ["pending", "approved", "rejected"].includes(String(value))
      ? (value as MemberSummary["reviewStatus"])
      : undefined;
  }

  getMemberDetail(id: string) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getMemberDetail(id);
    }
    const member = this.members.find((item) => item.id === id);
    if (!member) {
      throw new NotFoundException(`Member ${id} was not found`);
    }

    return structuredClone(member);
  }

  saveMember(input: SaveMemberRequest) {
    const name = input.name.trim();
    const phone = input.phone.trim();

    if (!name || !phone) {
      throw new BadRequestException("会员姓名和手机号不能为空。");
    }

    const normalizedInput: SaveMemberRequest = {
      ...input,
      name,
      phone,
      source: input.source?.trim() || "营运端录入",
      levelName: input.levelName?.trim() || "白银会员",
      tags: this.uniqueFlags([], input.tags ?? []),
      identityVerified: Boolean(input.identityVerified),
      driverLicenseVerified: Boolean(input.driverLicenseVerified),
      email: this.optionalString(input.email),
      identityNoMasked: this.optionalString(input.identityNoMasked),
      driverLicenseNoMasked: this.optionalString(input.driverLicenseNoMasked),
      birthday: this.optionalString(input.birthday),
      emergencyContactName: this.optionalString(input.emergencyContactName),
      emergencyContactPhone: this.optionalString(input.emergencyContactPhone),
      notes: this.optionalString(input.notes),
      riskNote: this.optionalString(input.riskNote)
    };

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveMember(normalizedInput);
    }

    const duplicated = this.members.some(
      (member) => member.id !== input.id && member.phone === phone
    );
    if (duplicated) {
      throw new BadRequestException("手机号已存在。");
    }

    const existingIndex = this.members.findIndex((item) => item.id === input.id);
    const current = existingIndex >= 0 ? this.members[existingIndex] : undefined;
    const detail: MemberDetail = {
      id: current?.id ?? `member_${randomUUID()}`,
      name,
      phone,
      phoneMasked: this.maskPhone(phone),
      source: normalizedInput.source || current?.source || "营运端录入",
      levelName: normalizedInput.levelName || current?.levelName || "白银会员",
      pointsBalance: current?.pointsBalance || 0,
      status: normalizedInput.status,
      reviewStatus:
        normalizedInput.status === "pending_review"
          ? "pending"
          : current?.reviewStatus === "rejected" && normalizedInput.status === "active"
            ? "approved"
            : current?.reviewStatus || "approved",
      registerAt: current?.registerAt || new Date().toISOString(),
      totalOrders: current?.totalOrders || 0,
      totalSpendAmount: current?.totalSpendAmount || 0,
      tags: normalizedInput.tags,
      identityVerified: normalizedInput.identityVerified,
      driverLicenseVerified: normalizedInput.driverLicenseVerified,
      email: normalizedInput.email,
      identityNoMasked: normalizedInput.identityNoMasked,
      driverLicenseNoMasked: normalizedInput.driverLicenseNoMasked,
      birthday: normalizedInput.birthday,
      emergencyContactName: normalizedInput.emergencyContactName,
      emergencyContactPhone: normalizedInput.emergencyContactPhone,
      notes: normalizedInput.notes,
      riskNote: normalizedInput.riskNote,
      recentOrderNos: current?.recentOrderNos || [],
      timeline: [
        {
          id: `member_timeline_${randomUUID()}`,
          at: new Date().toISOString(),
          operator: "营运端",
          action: current ? "更新会员资料" : "新增会员",
          remark: current ? "会员详情保存" : "创建会员档案"
        },
        ...(current?.timeline ?? [])
      ]
    };

    if (existingIndex >= 0) {
      this.members[existingIndex] = detail;
    } else {
      this.members.unshift(detail);
    }

    if (detail.reviewStatus === "pending" && !this.memberReviews.some((item) => item.memberId === detail.id)) {
      this.memberReviews.unshift({
        id: `review_${detail.id}`,
        memberId: detail.id,
        memberName: detail.name,
        phoneMasked: detail.phoneMasked,
        submittedAt: new Date().toISOString(),
        reviewStatus: "pending",
        riskFlags: detail.riskNote ? [detail.riskNote] : [],
        documents: ["身份证", "驾驶证"],
        remark: "会员资料待人工审核"
      });
    }

    return detail;
  }

  listMemberReviews() {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listMemberReviews();
    }
    return this.memberReviews;
  }

  processMemberReview(id: string, input: ProcessMemberReviewRequest) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.processMemberReview(id, input);
    }

    const review = this.memberReviews.find((item) => item.id === id);
    if (!review) {
      throw new NotFoundException(`Member review ${id} was not found`);
    }
    const member = this.members.find((item) => item.id === review.memberId);
    if (!member) {
      throw new NotFoundException(`Member ${review.memberId} was not found`);
    }

    review.reviewStatus = input.action === "approve" ? "approved" : "rejected";
    review.remark = this.optionalString(input.remark);
    member.reviewStatus = review.reviewStatus;
    member.status = input.action === "approve" ? "active" : "suspended";
    member.identityVerified = input.action === "approve" || member.identityVerified;
    member.driverLicenseVerified =
      input.action === "approve" || member.driverLicenseVerified;
    member.timeline.unshift({
      id: `member_review_${randomUUID()}`,
      at: new Date().toISOString(),
      operator: input.operator || "营运端审核",
      action: input.action === "approve" ? "审核通过" : "审核驳回",
      remark: review.remark
    });

    return {
      review,
      member
    };
  }

  async processMemberRisk(
    id: string,
    input: ProcessMemberRiskRequest
  ): Promise<ProcessMemberRiskResult> {
    const reason = input.reason?.trim();
    if (!reason) {
      throw new BadRequestException("风控原因不能为空。");
    }

    if (this.useMysqlDataSource()) {
      const member = await this.storeRentalRepository.getMemberDetail(id);
      const affectedOrders = this.orders.filter(
        (order) =>
          order.memberId === member.id ||
          order.customerPhoneMasked === member.phoneMasked ||
          order.customerName === member.name
      );

      if (input.action === "blacklist") {
        affectedOrders.forEach((order) => {
          order.riskFlags = this.uniqueFlags(order.riskFlags, ["blacklist", "黑名单"]);
        });
      } else if (input.action === "suspend") {
        affectedOrders.forEach((order) => {
          order.riskFlags = this.uniqueFlags(order.riskFlags, ["license_issue", "人工限制"]);
        });
      } else {
        affectedOrders.forEach((order) => {
          order.riskFlags = order.riskFlags.filter(
            (flag) => !["blacklist", "黑名单"].includes(flag)
          );
        });
      }

      const savedMember = await this.storeRentalRepository.processMemberRisk(id, {
        ...input,
        reason
      });

      return {
        member: savedMember,
        affectedOrderNos: affectedOrders.map((order) => order.orderNo),
        message: `会员风控状态已更新，影响 ${affectedOrders.length} 笔订单。`
      };
    }

    const member = this.members.find((item) => item.id === id);
    if (!member) {
      throw new NotFoundException(`Member ${id} was not found`);
    }

    const operator = input.operator?.trim() || "营运风控";
    const extraTags = input.tags ?? [];
    const affectedOrders = this.orders.filter(
      (order) =>
        order.memberId === member.id ||
        order.customerPhoneMasked === member.phoneMasked ||
        order.customerName === member.name
    );

    if (input.action === "blacklist") {
      member.status = "blacklisted";
      member.riskNote = reason;
      member.tags = this.uniqueFlags(member.tags, ["黑名单", "禁止租车", ...extraTags]);
      affectedOrders.forEach((order) => {
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["blacklist", "黑名单"]);
      });
    } else if (input.action === "suspend") {
      member.status = "suspended";
      member.riskNote = reason;
      member.tags = this.uniqueFlags(member.tags, ["人工限制", ...extraTags]);
      affectedOrders.forEach((order) => {
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["license_issue", "人工限制"]);
      });
    } else {
      member.status = member.reviewStatus === "pending" ? "pending_review" : "active";
      member.riskNote = reason;
      member.tags = this.uniqueFlags(
        member.tags.filter((tag) => !["黑名单", "禁止租车"].includes(tag)),
        ["风控已复核", ...extraTags]
      );
      affectedOrders.forEach((order) => {
        order.riskFlags = order.riskFlags.filter(
          (flag) => !["blacklist", "黑名单"].includes(flag)
        );
      });
    }

    member.timeline.unshift({
      id: `member_risk_${randomUUID()}`,
      at: new Date().toISOString(),
      operator,
      action:
        input.action === "blacklist"
          ? "加入黑名单"
          : input.action === "suspend"
            ? "暂停租车资格"
            : "恢复租车资格",
      remark: reason
    });

    return {
      member: structuredClone(member),
      affectedOrderNos: affectedOrders.map((order) => order.orderNo),
      message: `会员风控状态已更新，影响 ${affectedOrders.length} 笔订单。`
    };
  }

  listMembershipPlans() {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listMembershipPlans();
    }
    return this.membershipPlans;
  }

  saveMembershipPlan(input: SaveMembershipPlanRequest) {
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    if (!code || !name) {
      throw new BadRequestException("等级编码和名称不能为空。");
    }

    const normalizedInput: SaveMembershipPlanRequest = {
      ...input,
      code,
      name,
      tierRank: Number(input.tierRank || 1),
      upgradeCondition: input.upgradeCondition.trim(),
      benefitSummary: input.benefitSummary.trim(),
      orderDiscountPercent: Number(input.orderDiscountPercent || 0),
      depositDiscountPercent: Number(input.depositDiscountPercent || 0),
      freeServiceCount: Number(input.freeServiceCount || 0)
    };

    if (normalizedInput.tierRank <= 0) {
      throw new BadRequestException("等级层级必须大于 0。");
    }
    if (
      !this.isPercentInRange(normalizedInput.orderDiscountPercent) ||
      !this.isPercentInRange(normalizedInput.depositDiscountPercent)
    ) {
      throw new BadRequestException("租金折扣和押金折扣必须在 0% 到 100% 之间。");
    }
    if (normalizedInput.freeServiceCount < 0) {
      throw new BadRequestException("免费服务次数不能为负数。");
    }

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveMembershipPlan(normalizedInput);
    }

    const existingIndex = this.membershipPlans.findIndex((item) => item.id === input.id);
    const duplicated = this.membershipPlans.some(
      (item) => item.id !== input.id && item.code === code
    );
    if (duplicated) {
      throw new BadRequestException("等级编码已存在。");
    }

    const plan: MembershipPlanSummary = {
      id: existingIndex >= 0 ? this.membershipPlans[existingIndex].id : `member_plan_${randomUUID()}`,
      code,
      name,
      tierRank: normalizedInput.tierRank,
      status: normalizedInput.status,
      upgradeCondition: normalizedInput.upgradeCondition,
      benefitSummary: normalizedInput.benefitSummary,
      orderDiscountPercent: normalizedInput.orderDiscountPercent,
      depositDiscountPercent: normalizedInput.depositDiscountPercent,
      freeServiceCount: normalizedInput.freeServiceCount
    };

    if (existingIndex >= 0) {
      this.membershipPlans[existingIndex] = plan;
    } else {
      this.membershipPlans.unshift(plan);
    }

    return plan;
  }

  listCorporates(): CorporateSummary[] | Promise<CorporateSummary[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listCorporates();
    }
    return this.corporates.map((corporate) => this.toCorporateSummary(corporate));
  }

  listCorporatePage(
    query: CorporateListQuery = {}
  ): CorporateListResult | Promise<CorporateListResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listCorporatePage(query);
    }
    return this.buildCorporateListResult(
      this.corporates.map((corporate) => this.toCorporateSummary(corporate)),
      query
    );
  }

  private buildCorporateListResult(
    rows: CorporateSummary[],
    query: CorporateListQuery = {}
  ): CorporateListResult {
    const keyword = query.keyword?.trim().toLowerCase();
    const status = this.normalizeCorporateStatusFilter(query.status);
    const contractStatus = this.normalizeCorporateContractStatusFilter(query.contractStatus);
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const filteredRows = rows.filter((row) => {
      const keywordMatched =
        !keyword ||
        row.shortName.toLowerCase().includes(keyword) ||
        row.fullName.toLowerCase().includes(keyword);
      const statusMatched = !status || row.status === status;
      const contractStatusMatched = !contractStatus || row.contractStatus === contractStatus;
      return keywordMatched && statusMatched && contractStatusMatched;
    });
    const start = (page - 1) * pageSize;
    return {
      rows: filteredRows.slice(start, start + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      stats: {
        total: filteredRows.length,
        active: filteredRows.filter((row) => row.status === "active").length,
        paused: filteredRows.filter((row) => row.status === "paused").length,
        disabled: filteredRows.filter((row) => row.status === "disabled").length,
        expiringContracts: filteredRows.filter((row) => row.contractStatus === "expiring")
          .length,
        expiredContracts: filteredRows.filter((row) => row.contractStatus === "expired").length
      }
    };
  }

  private normalizeCorporateStatusFilter(value: unknown): CorporateSummary["status"] | undefined {
    return ["active", "paused", "disabled"].includes(String(value))
      ? (value as CorporateSummary["status"])
      : undefined;
  }

  private normalizeCorporateContractStatusFilter(
    value: unknown
  ): CorporateSummary["contractStatus"] | undefined {
    return ["active", "expiring", "expired"].includes(String(value))
      ? (value as CorporateSummary["contractStatus"])
      : undefined;
  }

  getCorporateDetail(id: string) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getCorporateDetail(id);
    }
    const corporate = this.corporates.find((item) => item.id === id);
    if (!corporate) {
      throw new NotFoundException(`Corporate ${id} was not found`);
    }

    return structuredClone(corporate);
  }

  async listCorporateContractAttachments(corporateId: string, contractId: string) {
    await this.findCorporateContract(corporateId, contractId);
    return this.integrationsService.listFiles({
      businessModule: "store_rental",
      businessType: "corporate_contract",
      businessId: contractId,
      status: "active",
      limit: 100
    });
  }

  async createCorporateContractAttachment(
    corporateId: string,
    contractId: string,
    input: CreateCorporateContractAttachmentRequest
  ): Promise<CorporateContractAttachmentResult> {
    const fileName = (input.fileName ?? "").trim();
    const mimeType = (input.mimeType ?? "").trim();
    if (!fileName || !mimeType) {
      throw new BadRequestException("附件文件名和文件类型不能为空。");
    }

    const { contract } = await this.findCorporateContract(corporateId, contractId);
    const file = await this.integrationsService.createFile({
      businessModule: "store_rental",
      businessType: "corporate_contract",
      businessId: contractId,
      fileName,
      mimeType,
      sizeBytes: input.sizeBytes,
      uploadScene: "corporate_contract_attachment",
      uploadedBy: this.optionalString(input.uploadedBy) ?? "企业客户管理员",
      metadata: {
        ...(input.metadata ?? {}),
        corporateId,
        contractId,
        contractNo: contract.contractNo,
        contractName: contract.contractName,
        mockAdapterBoundary: "FileStorageAdapter local_mock metadata only"
      }
    });

    const corporate = this.useMysqlDataSource()
      ? await this.storeRentalRepository.appendCorporateContractAttachment(
          corporateId,
          contractId,
          file.fileName
        )
      : this.appendMemoryCorporateContractAttachment(corporateId, contractId, file.fileName);
    const updatedContract = corporate.contracts.find((item) => item.id === contractId);
    if (!updatedContract) {
      throw new NotFoundException(`Corporate contract ${contractId} was not found`);
    }

    return {
      corporate,
      contract: updatedContract,
      file
    };
  }

  saveCorporate(input: SaveCorporateRequest) {
    const shortName = input.shortName.trim();
    const fullName = input.fullName.trim();

    if (!shortName || !fullName) {
      throw new BadRequestException("企业简称和企业全称不能为空。");
    }

    const normalizedInput: SaveCorporateRequest = {
      ...input,
      shortName,
      fullName,
      creditLimitAmount: Number(input.creditLimitAmount || 0),
      accountPeriodDays: Number(input.accountPeriodDays || 0),
      billingCycleDay: Number(input.billingCycleDay || 1),
      contactName: input.contactName.trim(),
      contactPhone: input.contactPhone.trim(),
      autoGenerateStatement: Boolean(input.autoGenerateStatement),
      creditWarningAmount:
        input.creditWarningAmount === undefined || input.creditWarningAmount === null
          ? undefined
          : Number(input.creditWarningAmount),
      billingEmail: this.optionalString(input.billingEmail),
      statementEmail: this.optionalString(input.statementEmail),
      reconciliationContactName: this.optionalString(input.reconciliationContactName),
      reconciliationContactPhone: this.optionalString(input.reconciliationContactPhone),
      invoiceTitle: this.optionalString(input.invoiceTitle),
      linkedStores: this.uniqueFlags([], input.linkedStores ?? []),
      notes: this.optionalString(input.notes),
      contacts: (input.contacts ?? []).map((contact) => ({
        ...contact,
        id: contact.id || `corp_contact_${randomUUID()}`,
        name: contact.name.trim(),
        title: contact.title.trim(),
        phone: contact.phone.trim(),
        email: this.optionalString(contact.email)
      })),
      contracts: (input.contracts ?? []).map((contract) => ({
        ...contract,
        id: contract.id || `corp_contract_${randomUUID()}`,
        contractNo: contract.contractNo.trim(),
        contractName: contract.contractName.trim(),
        statementEmail: this.optionalString(contract.statementEmail),
        attachments: this.uniqueFlags([], contract.attachments ?? []),
        linkedStores: this.uniqueFlags([], contract.linkedStores ?? []),
        remark: this.optionalString(contract.remark),
        amount: Number(contract.amount || 0)
      }))
    };

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveCorporate(normalizedInput);
    }

    const duplicated = this.corporates.some(
      (item) => item.id !== input.id && item.shortName === shortName
    );
    if (duplicated) {
      throw new BadRequestException("企业简称已存在。");
    }

    const existingIndex = this.corporates.findIndex((item) => item.id === input.id);
    const current = existingIndex >= 0 ? this.corporates[existingIndex] : undefined;
    const detail: CorporateDetail = {
      id: current?.id ?? `corp_${randomUUID()}`,
      shortName,
      fullName,
      status: normalizedInput.status,
      creditLimitAmount: normalizedInput.creditLimitAmount,
      accountPeriodDays: normalizedInput.accountPeriodDays,
      contactName: normalizedInput.contactName,
      contactPhone: normalizedInput.contactPhone,
      activeOrderCount: current?.activeOrderCount || 0,
      unpaidAmount: current?.unpaidAmount || 0,
      contractStatus: current?.contractStatus || "active",
      billingEmail: normalizedInput.billingEmail,
      statementEmail: normalizedInput.statementEmail,
      billingCycleDay: normalizedInput.billingCycleDay,
      settlementMode: normalizedInput.settlementMode,
      reconciliationContactName: normalizedInput.reconciliationContactName,
      reconciliationContactPhone: normalizedInput.reconciliationContactPhone,
      autoGenerateStatement: normalizedInput.autoGenerateStatement,
      creditWarningAmount: normalizedInput.creditWarningAmount,
      invoiceTitle: normalizedInput.invoiceTitle,
      linkedStores: normalizedInput.linkedStores,
      notes: normalizedInput.notes,
      recentOrderNos: current?.recentOrderNos || [],
      contacts: normalizedInput.contacts,
      contracts: normalizedInput.contracts
    };

    if (existingIndex >= 0) {
      this.corporates[existingIndex] = detail;
    } else {
      this.corporates.unshift(detail);
    }

    return detail;
  }

  private async findCorporateContract(corporateId: string, contractId: string) {
    const corporate = await this.getCorporateDetail(corporateId);
    const contract = corporate.contracts.find((item) => item.id === contractId);
    if (!contract) {
      throw new NotFoundException(`Corporate contract ${contractId} was not found`);
    }
    return { corporate, contract };
  }

  private appendMemoryCorporateContractAttachment(
    corporateId: string,
    contractId: string,
    fileName: string
  ) {
    const corporateIndex = this.corporates.findIndex((item) => item.id === corporateId);
    if (corporateIndex < 0) {
      throw new NotFoundException(`Corporate ${corporateId} was not found`);
    }
    const corporate = this.corporates[corporateIndex];
    const contractIndex = corporate.contracts.findIndex((item) => item.id === contractId);
    if (contractIndex < 0) {
      throw new NotFoundException(`Corporate contract ${contractId} was not found`);
    }

    corporate.contracts[contractIndex] = {
      ...corporate.contracts[contractIndex],
      attachments: this.uniqueFlags(corporate.contracts[contractIndex].attachments, [fileName])
    };
    this.corporates[corporateIndex] = corporate;
    return structuredClone(corporate);
  }

  async listCorporateMonthlyBills(
    corporateId: string
  ): Promise<CorporateMonthlyBillSummary[]> {
    const corporate = await this.getCorporateForRead(corporateId);
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listCorporateMonthlyBills(corporate.id);
    }

    const monthlyOrders = this.orders.filter(
      (order) =>
        order.billingMode === BillingMode.Monthly &&
        this.monthlyBillableAmount(order) > 0 &&
        (order.corporateId === corporate.id ||
          order.corporateShortName === corporate.shortName)
    );
    const grouped = monthlyOrders.reduce<Record<string, typeof monthlyOrders>>(
      (result, order) => {
        const period = this.monthlyBillPeriod(order);
        result[period] = [...(result[period] ?? []), order];
        return result;
      },
      {}
    );

    return Object.entries(grouped)
      .map(([period, orders]) => this.buildCorporateMonthlyBill(corporate, period, orders))
      .sort((left, right) => right.period.localeCompare(left.period));
  }

  async settleCorporateMonthlyBill(
    corporateId: string,
    billId: string,
    input: SettleCorporateMonthlyBillRequest
  ) {
    const amount = Number(input.amount || 0);
    if (amount <= 0) {
      throw new BadRequestException("回款金额必须大于 0。");
    }

    if (this.useMysqlDataSource()) {
      const corporate = await this.getCorporateForRead(corporateId);
      const bill = (await this.storeRentalRepository.listCorporateMonthlyBills(corporate.id)).find(
        (item) => item.id === billId
      );
      if (!bill) {
        throw new NotFoundException(`Monthly bill ${billId} was not found`);
      }
      return this.storeRentalRepository.settleCorporateMonthlyBill(billId, amount, {
        channel: input.channel,
        operator: input.operator,
        note: input.note
      });
    }

    const bill = (await this.listCorporateMonthlyBills(corporateId)).find(
      (item) => item.id === billId
    );
    if (!bill) {
      throw new NotFoundException(`Monthly bill ${billId} was not found`);
    }

    const existing = this.corporateMonthlyBillPayments.get(billId);
    const paidAmount = Math.min(bill.totalAmount, (existing?.paidAmount ?? 0) + amount);
    this.corporateMonthlyBillPayments.set(billId, {
      paidAmount,
      lastPaidAt: new Date().toISOString(),
      lastOperator: input.operator || "营运财务",
      note: this.optionalString(input.note)
    });

    const corporate = this.corporates.find((item) => item.id === corporateId);
    if (corporate && !this.useMysqlDataSource()) {
      corporate.unpaidAmount = Math.max(0, corporate.unpaidAmount - amount);
    }

    return (await this.listCorporateMonthlyBills(corporateId)).find(
      (item) => item.id === billId
    );
  }

  getFinanceOverview(): Promise<FinanceOverviewMetrics> | FinanceOverviewMetrics {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getFinanceOverview();
    }

    const transactions = this.listMemoryFinanceTransactions();
    const preAuthorizations = this.listFinancePreAuthorizations() as FinancePreAuthorizationRow[];
    const monthlyBills = this.corporates.flatMap((corporate) =>
      this.buildMemoryCorporateMonthlyBills(corporate)
    );
    return {
      customerReceivedAmount: transactions
        .filter(
          (item) =>
            item.status === "success" &&
            (item.type === "payment" || item.type === "pre_auth_capture")
        )
        .reduce((sum, item) => sum + item.amount, 0),
      preAuthFrozenAmount: Math.max(
        0,
        preAuthorizations
          .filter(
            (item) =>
              item.status === "frozen" ||
              item.status === "partially_captured" ||
              item.status === "pending"
          )
          .reduce((sum, item) => sum + item.remainingAmount, 0)
      ),
      refundAmount: transactions
        .filter((item) => item.status === "success" && item.type === "refund")
        .reduce((sum, item) => sum + item.amount, 0),
      monthlyBillingAmount: monthlyBills.reduce(
        (sum, item) => sum + item.totalAmount,
        0
      ),
      monthlyUnpaidAmount: monthlyBills.reduce(
        (sum, item) => sum + item.balanceAmount,
        0
      ),
      invoiceIssuedAmount: this.financeDocuments
        .filter((item) => item.type === "invoice" && item.status !== "voided")
        .reduce((sum, item) => sum + item.amount, 0),
      pendingAdjustmentAmount: this.financeManualAdjustments
        .filter((item) => item.status === "pending")
        .reduce((sum, item) => sum + item.amount, 0),
      exceptionCount:
        transactions.filter((item) => item.status === "failed").length +
        this.financeManualAdjustments.filter((item) => item.status === "rejected").length
    };
  }

  listFinanceTransactions(): Promise<FinanceTransactionRow[]> | FinanceTransactionRow[] {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listFinanceTransactions();
    }
    return this.listMemoryFinanceTransactions();
  }

  listFinanceDocuments(): Promise<FinanceDocumentRow[]> | FinanceDocumentRow[] {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listFinanceDocuments();
    }
    return this.financeDocuments;
  }

  saveFinanceDocument(
    input: SaveFinanceDocumentRequest
  ): Promise<FinanceDocumentRow> | FinanceDocumentRow {
    const amount = Number(input.amount || 0);
    if (amount <= 0) {
      throw new BadRequestException("单据金额必须大于 0。");
    }

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveFinanceDocument(input);
    }

    const order = input.orderId
      ? this.orders.find((item) => item.id === input.orderId)
      : input.orderNo
        ? this.orders.find((item) => item.orderNo === input.orderNo)
        : undefined;
    const existingIndex = this.financeDocuments.findIndex((item) => item.id === input.id);
    const existingDocument =
      existingIndex >= 0 ? this.financeDocuments[existingIndex] : undefined;
    const originalIndex = input.originalDocumentId
      ? this.financeDocuments.findIndex((item) => item.id === input.originalDocumentId)
      : input.originalDocumentNo
        ? this.financeDocuments.findIndex(
            (item) => item.documentNo === input.originalDocumentNo
          )
        : -1;
    const originalDocument =
      originalIndex >= 0 ? this.financeDocuments[originalIndex] : undefined;
    const now = new Date().toISOString();
    const relatedFeeIds = this.uniqueStringList(input.relatedFeeIds);
    const operator = input.createdBy || "营运财务";
    const documentNo =
      input.documentNo ||
      `${input.type === "receipt" ? "RCT" : "INV"}${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "")}${randomUUID().slice(0, 4).toUpperCase()}`;
    const auditTrail = this.appendFinanceDocumentAuditTrail(
      existingDocument?.auditTrail ?? input.auditTrail,
      {
        at: now,
        operator,
        action: originalDocument
          ? "reissued"
          : input.status === "voided"
            ? "voided"
            : input.status === "sent"
              ? "sent"
              : input.status === "issued"
                ? "issued"
                : existingDocument
                  ? "updated"
                  : "created",
        remark:
          input.voidReason ||
          input.remark ||
          (originalDocument ? `重开自 ${originalDocument.documentNo}` : undefined),
        relatedDocumentNo: originalDocument?.documentNo,
        relatedFeeIds
      }
    );
    const document: FinanceDocumentRow = {
      id: input.id || `finance_doc_${randomUUID()}`,
      documentNo,
      type: input.type,
      status: input.status,
      orderId: input.orderId ?? order?.id,
      orderNo: input.orderNo ?? order?.orderNo,
      memberId: input.memberId ?? order?.memberId,
      corporateId: input.corporateId ?? order?.corporateId,
      corporateShortName: input.corporateShortName ?? order?.corporateShortName,
      monthlyBillId: input.monthlyBillId,
      customerName: input.customerName || order?.customerName || "",
      title: input.title,
      taxNo: this.optionalString(input.taxNo),
      email: this.optionalString(input.email),
      amount,
      issueSource: input.issueSource || "manual",
      relatedFeeIds,
      originalDocumentId: input.originalDocumentId ?? originalDocument?.id,
      originalDocumentNo: input.originalDocumentNo ?? originalDocument?.documentNo,
      replacementDocumentId: input.replacementDocumentId,
      replacementDocumentNo: input.replacementDocumentNo,
      issuedAt:
        input.status === "issued" || input.status === "sent"
          ? input.issuedAt || now
          : undefined,
      voidedAt: input.status === "voided" ? now : undefined,
      voidReason:
        input.status === "voided" ? this.optionalString(input.voidReason) : undefined,
      voidedBy: input.status === "voided" ? input.voidedBy || operator : undefined,
      reissuedAt: originalDocument ? now : input.reissuedAt,
      createdBy: operator,
      remark: this.optionalString(input.remark),
      auditTrail,
      createdAt:
        existingIndex >= 0
          ? this.financeDocuments[existingIndex].createdAt
          : now
    };
    if (existingIndex >= 0) {
      this.financeDocuments[existingIndex] = document;
    } else {
      this.financeDocuments.unshift(document);
    }
    if (originalDocument && originalDocument.id !== document.id) {
      const originalDocumentIndex = this.financeDocuments.findIndex(
        (item) => item.id === originalDocument.id
      );
      const voidReason =
        this.optionalString(input.voidReason) ||
        this.optionalString(input.remark) ||
        `重开为 ${document.documentNo}`;
      if (originalDocumentIndex >= 0) {
        this.financeDocuments[originalDocumentIndex] = {
        ...originalDocument,
        status: "voided",
        voidedAt: originalDocument.voidedAt || now,
        voidReason,
        voidedBy: input.voidedBy || operator,
        replacementDocumentId: document.id,
        replacementDocumentNo: document.documentNo,
        reissuedAt: now,
        auditTrail: this.appendFinanceDocumentAuditTrail(originalDocument.auditTrail, {
          at: now,
          operator,
          action: "voided",
          remark: voidReason,
          relatedDocumentNo: document.documentNo,
          relatedFeeIds: originalDocument.relatedFeeIds
        })
      };
      }
    }
    return document;
  }

  listFinancePreAuthorizations():
    | Promise<FinancePreAuthorizationRow[]>
    | FinancePreAuthorizationRow[] {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listFinancePreAuthorizations();
    }

    const explicitOrderIds = new Set(
      this.financePreAuthorizations
        .map((item) => item.orderId)
        .filter((orderId): orderId is string => Boolean(orderId))
    );
    const derivedRows = this.buildMemoryFinancePreAuthorizations().filter(
      (row) => !row.orderId || !explicitOrderIds.has(row.orderId)
    );
    return [...this.financePreAuthorizations, ...derivedRows].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  saveFinancePreAuthorization(
    input: SaveFinancePreAuthorizationRequest
  ): Promise<FinancePreAuthorizationRow> | FinancePreAuthorizationRow {
    const authorizedAmount = Number(input.authorizedAmount || 0);
    const capturedAmount = Number(input.capturedAmount || 0);
    const releasedAmount = Number(input.releasedAmount || 0);
    if (authorizedAmount <= 0) {
      throw new BadRequestException("预授权金额必须大于 0。");
    }
    if (capturedAmount < 0 || releasedAmount < 0) {
      throw new BadRequestException("扣款和释放金额不能小于 0。");
    }
    if (capturedAmount + releasedAmount > authorizedAmount) {
      throw new BadRequestException("扣款和释放金额不能超过预授权金额。");
    }

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveFinancePreAuthorization(input);
    }

    const order = input.orderId
      ? this.orders.find((item) => item.id === input.orderId)
      : input.orderNo
        ? this.orders.find((item) => item.orderNo === input.orderNo)
        : undefined;
    const existingIndex = this.financePreAuthorizations.findIndex(
      (item) => item.id === input.id
    );
    const now = new Date().toISOString();
    const remainingAmount = Math.max(0, authorizedAmount - capturedAmount - releasedAmount);
    const row: FinancePreAuthorizationRow = {
      id: input.id || `finance_preauth_${randomUUID()}`,
      preAuthNo:
        input.preAuthNo ||
        `PA${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${randomUUID()
          .slice(0, 4)
          .toUpperCase()}`,
      orderId: input.orderId ?? order?.id,
      orderNo: input.orderNo ?? order?.orderNo,
      memberId: input.memberId ?? order?.memberId,
      corporateId: input.corporateId ?? order?.corporateId,
      corporateShortName: input.corporateShortName ?? order?.corporateShortName,
      customerName: input.customerName ?? order?.customerName,
      status: input.status,
      channel: input.channel,
      provider: input.provider || "mock_payment",
      authorizedAmount,
      capturedAmount,
      releasedAmount,
      remainingAmount,
      currency: input.currency || "CNY",
      authCode: this.optionalString(input.authCode),
      channelReferenceNo: this.optionalString(input.channelReferenceNo),
      paymentMethod: this.optionalString(input.paymentMethod),
      frozenAt:
        input.frozenAt ||
        (input.status !== "pending" ? now : undefined),
      capturedAt:
        input.capturedAt ||
        (capturedAmount > 0 ? now : undefined),
      releasedAt:
        input.releasedAt ||
        (releasedAmount > 0 || input.status === "released" ? now : undefined),
      expiresAt: this.optionalString(input.expiresAt),
      operator: input.operator || "营运财务",
      remark: this.optionalString(input.remark),
      createdAt:
        existingIndex >= 0
          ? this.financePreAuthorizations[existingIndex].createdAt
          : now
    };
    if (existingIndex >= 0) {
      this.financePreAuthorizations[existingIndex] = row;
    } else {
      this.financePreAuthorizations.unshift(row);
    }
    return row;
  }

  listFinanceManualAdjustments():
    | Promise<FinanceManualAdjustmentRow[]>
    | FinanceManualAdjustmentRow[] {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listFinanceManualAdjustments();
    }
    return this.financeManualAdjustments;
  }

  createFinanceManualAdjustment(
    input: SaveFinanceManualAdjustmentRequest
  ): Promise<FinanceManualAdjustmentRow> | FinanceManualAdjustmentRow {
    const amount = Number(input.amount || 0);
    if (amount <= 0) {
      throw new BadRequestException("调账金额必须大于 0。");
    }
    if (!input.reason?.trim()) {
      throw new BadRequestException("调账原因不能为空。");
    }

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.createFinanceManualAdjustment(input);
    }

    const order = input.orderId
      ? this.orders.find((item) => item.id === input.orderId)
      : input.orderNo
        ? this.orders.find((item) => item.orderNo === input.orderNo)
        : undefined;
    const adjustment: FinanceManualAdjustmentRow = {
      id: `finance_adj_${randomUUID()}`,
      adjustmentNo: `ADJ${new Date()
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "")}${randomUUID().slice(0, 4).toUpperCase()}`,
      orderId: input.orderId ?? order?.id,
      orderNo: input.orderNo ?? order?.orderNo,
      memberId: input.memberId ?? order?.memberId,
      corporateId: input.corporateId ?? order?.corporateId,
      corporateShortName: input.corporateShortName ?? order?.corporateShortName,
      customerName: input.customerName ?? order?.customerName,
      category: input.category,
      direction: input.direction,
      targetBillingMode: input.targetBillingMode,
      amount,
      status: "pending",
      reason: input.reason.trim(),
      operator: input.operator || "营运财务",
      createdAt: new Date().toISOString()
    };
    this.financeManualAdjustments.unshift(adjustment);
    return adjustment;
  }

  processFinanceManualAdjustment(
    id: string,
    input: ProcessFinanceManualAdjustmentRequest
  ): Promise<FinanceManualAdjustmentRow> | FinanceManualAdjustmentRow {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.processFinanceManualAdjustment(id, input);
    }

    const adjustment = this.financeManualAdjustments.find((item) => item.id === id);
    if (!adjustment) {
      throw new NotFoundException(`Finance adjustment ${id} was not found`);
    }
    adjustment.status = input.action === "approve" ? "posted" : "rejected";
    adjustment.approvedBy = input.operator || "营运财务";
    adjustment.approvalRemark = this.optionalString(input.remark);
    if (input.action === "approve") {
      adjustment.postedFeeId = `fee_adj_${adjustment.id}`;
      adjustment.postedTransactionId =
        adjustment.targetBillingMode === BillingMode.Monthly ||
        adjustment.direction === "waiver"
          ? `txn_adj_${adjustment.id}`
          : undefined;
      adjustment.postedAt = new Date().toISOString();
    }
    return adjustment;
  }

  listFinanceReconciliationRows():
    | Promise<FinanceReconciliationRow[]>
    | FinanceReconciliationRow[] {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listFinanceReconciliationRows();
    }
    return [
      ...this.listMemoryFinanceTransactions().map((item) => ({
        id: `txn_${item.id}`,
        sourceType: "transaction" as const,
        sourceNo: item.id,
        occurredAt: item.at,
        counterparty: item.corporateShortName ?? item.customerName ?? "客户自付订单",
        amount: item.amount,
        status:
          item.status === "failed"
            ? "exception" as const
            : item.status === "pending"
              ? "pending" as const
              : "matched" as const,
        issue: item.status === "pending" ? "资金记录待处理" : undefined,
        suggestedAction: item.status === "pending" ? "等待渠道回调或人工确认" : undefined
      })),
      ...this.financeManualAdjustments.map((item) => ({
        id: `adj_${item.id}`,
        sourceType: "manual_adjustment" as const,
        sourceNo: item.adjustmentNo,
        occurredAt: item.createdAt,
        counterparty: item.corporateShortName ?? item.customerName ?? "手工调账",
        amount: item.amount,
        status:
          item.status === "rejected"
            ? "exception" as const
            : item.status === "pending"
              ? "pending" as const
              : "matched" as const,
        issue:
          item.status === "pending"
            ? "手工调账待审核"
            : item.status === "rejected"
              ? "手工调账已驳回"
              : undefined,
        suggestedAction:
          item.status === "pending" ? "由具备财务调账权限的人员审核" : undefined
      }))
    ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async getRuleConfig() {
    await this.refreshRuleConfigFromRepository();
    return this.ruleConfig;
  }

  async listRuleVersions(): Promise<StoreRentalRuleVersionRecord[]> {
    if (this.useMysqlDataSource()) {
      const versions = await this.storeRentalRepository.listRentalRuleVersions();
      if (versions.length > 0) {
        this.ruleConfig = versions[0].snapshot;
        return versions;
      }
    }

    return this.ruleVersionHistory;
  }

  async getRuleVersion(version: string): Promise<StoreRentalRuleVersionRecord> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getRentalRuleVersion(version);
    }
    const record = this.ruleVersionHistory.find((item) => item.version === version);
    if (!record) {
      throw new NotFoundException(`Rental rule version ${version} was not found`);
    }

    return record;
  }

  async saveRuleConfig(input: SaveStoreRentalRuleConfigRequest) {
    const normalized = this.nextRuleConfig(input);
    if (this.useMysqlDataSource()) {
      this.ruleConfig = await this.storeRentalRepository.saveRentalRuleConfig(normalized);
      return this.ruleConfig;
    }

    this.ruleConfig = normalized;
    const nextHistory = this.ruleVersionHistory.map((record) =>
      normalized.status === ConfigStatus.Effective && record.status === ConfigStatus.Effective
        ? {
            ...record,
            status: ConfigStatus.Archived,
            snapshot: { ...record.snapshot, status: ConfigStatus.Archived }
          }
        : record
    );
    this.ruleVersionHistory = [
      this.createRuleVersionRecord(normalized, (nextHistory[0]?.versionNo ?? 0) + 1, {
        savedBy: input.operator || "营运端",
        savedAt: new Date().toISOString(),
        changeReason: input.changeReason || "保存门市租赁业务规则"
      }),
      ...nextHistory
    ];

    return this.ruleConfig;
  }

  listPricingPlans(): PricingPlanSummary[] {
    return this.pricingPlans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      status: plan.status,
      currency: plan.currency,
      effectiveAt: plan.effectiveAt,
      version: plan.version,
      vehicleGroupCount: plan.ruleLines.length
    }));
  }

  getPricingPlan(id: string) {
    const plan = this.pricingPlans.find((item) => item.id === id);
    if (!plan) {
      throw new NotFoundException(`Pricing plan ${id} was not found`);
    }

    return {
      ...plan,
      currentVersionId: plan.version,
      savedBy: this.priceVersionHistory[0]?.savedBy,
      savedAt: this.priceVersionHistory[0]?.savedAt,
      versions: this.priceVersionHistory,
      schedules: this.priceSchedules
    };
  }

  savePricingPlan(id: string, input: SavePricingPlanRequest) {
    const plan = this.getPricingPlan(id);
    const version = this.nextPriceVersionId();
    const nextLines = input.ruleLines.map((line) => ({
      ...line,
      baseDailyAmount: Math.max(0, Number(line.baseDailyAmount || 0)),
      weekendDailyAmount: Math.max(0, Number(line.baseDailyAmount || 0)),
      depositAmount: Math.max(0, Number(line.depositAmount || 0))
    }));

    const targetPlan = this.pricingPlans.find((item) => item.id === id);
    if (!targetPlan) {
      throw new NotFoundException(`Pricing plan ${id} was not found`);
    }

    targetPlan.ruleLines = nextLines;
    targetPlan.version = version;
    targetPlan.effectiveAt = new Date().toISOString();
    this.priceVersionHistory.unshift({
      version,
      title: "门市标准价当前版本",
      savedBy: input.operator || "价格规则管理员",
      savedAt: targetPlan.effectiveAt,
      source: "manual",
      changeReason: input.changeReason || "手动保存门市标准价",
      values: nextLines.map((line) => ({
        vehicleGroupCode: line.vehicleGroupCode,
        vehicleGroupName: line.vehicleGroupName,
        dailyPrice: line.baseDailyAmount,
        depositAmount: line.depositAmount
      }))
    });

    return {
      ...plan,
      ...targetPlan,
      currentVersionId: version,
      savedBy: input.operator || "价格规则管理员",
      savedAt: targetPlan.effectiveAt,
      versions: this.priceVersionHistory,
      schedules: this.priceSchedules
    };
  }

  createPriceSchedule(input: CreatePriceAdjustmentScheduleRequest) {
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime()) || effectiveAt.getTime() <= Date.now()) {
      throw new BadRequestException("定时调价计划的生效时间必须晚于当前时间。");
    }
    if (!input.changes.some((item) => item.newPrice !== item.currentPrice)) {
      throw new BadRequestException("价格未发生变化，不能创建调价计划。");
    }

    const schedule: PriceAdjustmentSchedule = {
      id: `schedule_store_${randomUUID()}`,
      effectiveAt: effectiveAt.toISOString(),
      summary: input.summary || "门市标准价调整",
      status: "scheduled",
      createdBy: input.operator || "价格规则管理员",
      createdAt: new Date().toISOString(),
      changes: input.changes.map((item) => ({
        ...item,
        currentPrice: Math.max(0, Number(item.currentPrice || 0)),
        newPrice: Math.max(0, Number(item.newPrice || 0))
      }))
    };

    this.priceSchedules.unshift(schedule);
    return schedule;
  }

  cancelPriceSchedule(id: string) {
    const schedule = this.priceSchedules.find((item) => item.id === id);
    if (!schedule) {
      throw new NotFoundException(`Price schedule ${id} was not found`);
    }
    if (schedule.status === "executed") {
      throw new BadRequestException("已执行的调价计划不能取消。");
    }
    schedule.status = "cancelled";
    return schedule;
  }

  listMarketingPlans(): MarketingPlanSummary[] {
    return this.marketingPlans.map((plan) => this.toMarketingSummary(plan));
  }

  getMarketingPlan(id: string) {
    const plan = this.marketingPlans.find((item) => item.id === id);
    if (!plan) {
      throw new NotFoundException(`Marketing plan ${id} was not found`);
    }

    return plan;
  }

  saveMarketingPlan(input: SaveMarketingPlanRequest): MarketingPlanDetail {
    const existing = input.id
      ? this.marketingPlans.find((item) => item.id === input.id)
      : undefined;
    const now = new Date().toISOString();
    const versionNo = existing ? existing.versionHistory[0].versionNo + 1 : 1;
    const versionId = `MKT-STORE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(
      versionNo
    ).padStart(3, "0")}`;
    const plan: MarketingPlanDetail = {
      id: existing?.id ?? `marketing_${randomUUID()}`,
      code: input.code || existing?.code || `MKT_STORE_${Date.now()}`,
      name: input.name,
      displayName: input.displayName,
      status: input.status,
      version: versionId,
      versionId,
      customerScope: input.customerScope,
      supportedModes: input.supportedModes,
      priority: input.priority,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      storeCodes: input.storeCodes,
      vehicleGroupCodes: input.vehicleGroupCodes,
      manualVerification: input.manualVerification,
      qualificationName: input.qualificationName,
      requiredDocText: input.requiredDocText,
      weekdayRate: input.weekdayRate,
      holidayRate: input.holidayRate,
      fixedDeductionAmount: input.fixedDeductionAmount,
      description: input.description,
      updatedAt: now,
      updatedBy: input.operator || "行销运营",
      ruleCount: input.rules.length,
      rules: input.rules,
      versionHistory: []
    };
    plan.versionHistory = [
      {
        versionId,
        versionNo,
        status: plan.status,
        savedBy: plan.updatedBy,
        savedAt: now,
        changeReason: input.changeReason || (existing ? "编辑行销方案" : "新建行销方案"),
        snapshot: this.toMarketingSummary(plan),
        rules: JSON.parse(JSON.stringify(input.rules)) as MarketingPlanDetail["rules"]
      },
      ...(existing?.versionHistory ?? [])
    ];

    if (existing) {
      Object.assign(existing, plan);
      return existing;
    }

    this.marketingPlans.unshift(plan);
    return plan;
  }

  async quote(input: PricingQuoteRequest): Promise<PricingQuoteResult> {
    await this.refreshRuleConfigFromRepository();
    const plan = this.getPricingPlan(input.planId);
    const line = plan.ruleLines.find(
      (item) => item.vehicleGroupCode === input.vehicleGroupCode
    );

    if (!line) {
      throw new NotFoundException(
        `Vehicle group ${input.vehicleGroupCode} has no price in ${plan.code}`
      );
    }

    const pickupAt = new Date(input.pickupAt);
    const returnAt = new Date(input.returnAt);
    const hours = Math.max(
      1,
      Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 3_600_000)
    );
    const billableDays = Math.max(1, Math.ceil(hours / 24));
    const rentalAmount = line.baseDailyAmount * billableDays;
    const serviceFeeItems = plan.serviceFees
      .filter((fee) => fee.enabled && input.serviceCodes?.includes(fee.code))
      .map((fee) => ({
        code: fee.code,
        name: fee.name,
        amount: fee.chargeMode === "per_day" ? fee.amount * billableDays : fee.amount
      }));
    const storeAdjustment = plan.storeAdjustments.find(
      (item) =>
        item.pickupStoreCode === input.pickupStoreCode &&
        item.returnStoreCode === input.returnStoreCode
    );
    const adjustmentAmount = storeAdjustment?.amount ?? 0;
    const marketing = this.resolveMarketing(input, line, pickupAt, billableDays);
    const baseDepositAmount =
      input.billingMode === BillingMode.Monthly
        ? this.ruleConfig.payment.enterpriseMonthlyPreAuthAmount
        : line.depositAmount;
    const membershipBenefit = await this.resolveMembershipQuoteBenefit(
      input,
      rentalAmount,
      baseDepositAmount
    );
    const discountAmount = marketing.discountAmount + membershipBenefit.rentalDiscountAmount;
    const serviceFeeAmount = serviceFeeItems.reduce(
      (total, item) => total + item.amount,
      0
    );
    const depositAmount =
      input.billingMode === BillingMode.Monthly
        ? baseDepositAmount
        : Math.max(0, baseDepositAmount - membershipBenefit.depositDiscountAmount);
    const orderAmount =
      rentalAmount + serviceFeeAmount + adjustmentAmount - discountAmount;
    const payableAmount =
      input.billingMode === BillingMode.Monthly ? 0 : orderAmount + depositAmount;

    const result: PricingQuoteResult = {
      quoteNo: `QT${Date.now()}`,
      planId: plan.id,
      currency: plan.currency,
      billableDays,
      rentalAmount,
      serviceFeeAmount,
      adjustmentAmount,
      discountAmount,
      depositAmount,
      payableAmount,
      monthlySettlementAmount:
        input.billingMode === BillingMode.Monthly ? orderAmount : undefined,
      feeItems: [
        { code: "RENTAL", name: `${line.vehicleGroupName} 租金`, amount: rentalAmount },
        ...serviceFeeItems,
        ...(storeAdjustment
          ? [
              {
                code: "STORE_ADJUSTMENT",
                name: storeAdjustment.name,
                amount: adjustmentAmount
              }
            ]
          : []),
        ...(discountAmount > 0
          ? [
              ...(marketing.discountAmount > 0
                ? [
                    {
                      code: "MARKETING_DISCOUNT",
                      name: marketing.plan
                        ? `${marketing.plan.displayName}优惠`
                        : "行销优惠方案",
                      amount: -marketing.discountAmount
                    }
                  ]
                : []),
              ...(membershipBenefit.rentalDiscountAmount > 0
                ? [
                    {
                      code: "MEMBERSHIP_RENTAL_DISCOUNT",
                      name: `${membershipBenefit.plan?.name ?? input.membershipLevel}租金权益`,
                      amount: -membershipBenefit.rentalDiscountAmount
                    }
                  ]
                : [])
            ]
          : []),
        ...(membershipBenefit.depositDiscountAmount > 0
          ? [
              {
                code: "MEMBERSHIP_DEPOSIT_DISCOUNT",
                name: `${membershipBenefit.plan?.name ?? input.membershipLevel}押金权益`,
                amount: -membershipBenefit.depositDiscountAmount
              }
            ]
          : []),
        { code: "DEPOSIT", name: "押金/预授权", amount: depositAmount }
      ],
      selectedMarketingPlan: marketing.plan
        ? {
            id: marketing.plan.id,
            versionId: marketing.plan.versionId,
            name: marketing.plan.name,
            displayName: marketing.plan.displayName,
            manualVerification: marketing.plan.manualVerification,
            qualificationName: marketing.plan.qualificationName,
            requiredDocText: marketing.plan.requiredDocText
          }
        : undefined,
      selectedMembershipPlan: membershipBenefit.plan
        ? {
            id: membershipBenefit.plan.id,
            code: membershipBenefit.plan.code,
            name: membershipBenefit.plan.name,
            orderDiscountPercent: membershipBenefit.plan.orderDiscountPercent,
            depositDiscountPercent: membershipBenefit.plan.depositDiscountPercent
          }
        : undefined,
      billingSegments: marketing.segments,
      explanationLines: [
        {
          code: "BASE_PRICE",
          title: "标准租金",
          detail: `${line.vehicleGroupName} 按 ${plan.version} 标准日租金 ¥${line.baseDailyAmount} × ${billableDays}天。`,
          amount: rentalAmount
        },
        ...marketing.explanationLines,
        ...membershipBenefit.explanationLines,
        ...serviceFeeItems.map((fee) => ({
          code: fee.code,
          title: fee.name,
          detail: "按已选择增值服务计入报价。",
          amount: fee.amount
        })),
        ...(storeAdjustment
          ? [
              {
                code: "STORE_ADJUSTMENT",
                title: storeAdjustment.name,
                detail: "按取还门市组合收取。",
                amount: adjustmentAmount
              }
            ]
          : []),
        {
          code: "DEPOSIT",
          title: "押金/预授权",
          detail:
            input.billingMode === BillingMode.Monthly
              ? "企业月结订单本期不发起客户押金预授权。"
              : membershipBenefit.depositDiscountAmount > 0
                ? `按车组押金标准 ¥${baseDepositAmount} 扣减会员押金权益 ¥${membershipBenefit.depositDiscountAmount}。`
                : "按车组押金标准计入本次预授权金额。",
          amount: depositAmount
        }
      ],
      snapshots: {
        pricingVersion: plan.version,
        priceVersionId: plan.version,
        ruleVersion: this.ruleConfig.version,
        vehicleGroupCode: input.vehicleGroupCode,
        pickupStoreCode: input.pickupStoreCode,
        returnStoreCode: input.returnStoreCode,
        baseDailyAmount: line.baseDailyAmount,
        marketingPlanId: marketing.plan?.id,
        marketingPlanVersionId: marketing.plan?.versionId,
        marketingPlanName: marketing.plan?.name,
        manualVerification: marketing.plan?.manualVerification,
        qualificationName: marketing.plan?.qualificationName,
        requiredDocText: marketing.plan?.requiredDocText,
        membershipPlanId: membershipBenefit.plan?.id,
        membershipPlanCode: membershipBenefit.plan?.code,
        membershipPlanName: membershipBenefit.plan?.name,
        membershipOrderDiscountPercent: membershipBenefit.plan?.orderDiscountPercent,
        membershipDepositDiscountPercent: membershipBenefit.plan?.depositDiscountPercent
      },
      warnings: [
        ...(input.billingMode === BillingMode.Monthly
          ? ["企业月结订单本期仅生成入账金额，跳过在线支付。"]
          : []),
        ...(input.customerType === "enterprise" || input.billingMode === BillingMode.Monthly
          ? ["企业身份订单不支持优惠券和积分抵扣。"]
          : []),
        ...membershipBenefit.warnings,
        ...marketing.warnings
      ]
    };

    this.quotes.set(result.quoteNo, {
      request: input,
      result
    });

    return result;
  }

  checkAvailability(
    input: StoreRentalAvailabilityRequest
  ): StoreRentalAvailabilityResult {
    const requestedCodes =
      input.vehicleGroupCodes && input.vehicleGroupCodes.length > 0
        ? input.vehicleGroupCodes
        : this.pricingPlans[0].ruleLines.map((line) => line.vehicleGroupCode);
    const pickupAt = new Date(input.pickupAt);
    const returnAt = new Date(input.returnAt);

    return {
      requestNo: `AV${Date.now()}`,
      checkedAt: new Date().toISOString(),
      ruleVersion: this.ruleConfig.version,
      pickupStoreCode: input.pickupStoreCode,
      returnStoreCode: input.returnStoreCode,
      groups: requestedCodes.map((vehicleGroupCode) => {
        const vehicleGroupName = this.getVehicleGroupNameByCode(vehicleGroupCode);
        const groupVehicles = this.vehicles.filter((vehicle) =>
          this.vehicleMatchesGroup(vehicle, vehicleGroupCode)
        );
        const disabledCount = groupVehicles.filter(
          (vehicle) => !vehicle.enabled || vehicle.operationStatus === "disabled"
        ).length;
        const rentingCount = groupVehicles.filter(
          (vehicle) => vehicle.operationStatus === "renting"
        ).length;
        const reservedCount = this.orders.filter(
          (order) =>
            this.orderMatchesGroup(order, vehicleGroupCode) &&
            this.orderOccupiesInventory(order) &&
            this.periodOverlaps(
              pickupAt,
              returnAt,
              new Date(order.pickupAt),
              new Date(order.returnAt)
            )
        ).length;
        const requiredServiceType =
          input.mode === StoreRentalMode.SelfService24h
            ? "STORE_24H"
            : "STORE_STANDARD";
        const serviceTypeMatched = groupVehicles.filter(
          (vehicle) =>
            vehicle.serviceTypes.includes(requiredServiceType) &&
            this.stationCanServeStoreRental(
              vehicle.currentStationName,
              requiredServiceType
            )
        );
        const totalCount = serviceTypeMatched.length;
        const idleCount = serviceTypeMatched.filter(
          (vehicle) => vehicle.enabled && vehicle.operationStatus === "idle"
        ).length;
        const availableCount = Math.max(0, idleCount - reservedCount);
        const recommendedStationNames = [
          ...new Set(
            serviceTypeMatched
              .filter((vehicle) => vehicle.enabled)
              .map((vehicle) => vehicle.currentStationName)
          )
        ];
        const warnings = [
          ...(availableCount === 0 ? ["当前时间段无可用库存，需人工调度或更换车组。"] : []),
          ...(input.pickupStoreCode !== input.returnStoreCode
            ? ["异店还车需读取门店对规则和异店服务费。"]
            : []),
          ...(input.mode === StoreRentalMode.SelfService24h
            ? ["24h 自助租车需确认站点自助服务能力和设备状态。"]
            : [])
        ];

        return {
          vehicleGroupCode,
          vehicleGroupName,
          totalCount,
          availableCount,
          reservedCount,
          rentingCount,
          disabledCount,
          recommendedStationNames,
          warnings
        };
      })
    };
  }

  getWorkflow(): WorkflowTransition[] {
    return [
      {
        from: OrderMainStatus.PendingPayment,
        action: "支付/预授权成功",
        to: OrderMainStatus.Reserved,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["payment", "sms"]
      },
      {
        from: OrderMainStatus.Reserved,
        action: "开始取车并创建操作锁",
        to: OrderMainStatus.Inspecting,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["risk", "sms"]
      },
      {
        from: OrderMainStatus.PickupOverdue,
        action: "逾期到店后继续取车",
        to: OrderMainStatus.Inspecting,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["risk", "sms"]
      },
      {
        from: OrderMainStatus.Inspecting,
        action: "确认发车",
        to: OrderMainStatus.Renting,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["file-storage", "tbox"]
      },
      {
        from: OrderMainStatus.Renting,
        action: "延长用车",
        to: OrderMainStatus.Renewing,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["payment", "risk", "inventory"]
      },
      {
        from: OrderMainStatus.Renewing,
        action: "续租中再次延长",
        to: OrderMainStatus.Renewing,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["payment", "risk", "inventory"]
      },
      {
        from: OrderMainStatus.Overdue,
        action: "补办续租",
        to: OrderMainStatus.Renewing,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["payment", "risk", "inventory"]
      },
      {
        from: OrderMainStatus.Renting,
        action: "还车验车完成",
        to: OrderMainStatus.SettlementPending,
        actorScope: [RoleScope.Operator, RoleScope.Store],
        requiredPermission: "store-rental:order:operate",
        integrationPlaceholders: ["file-storage"]
      },
      {
        from: OrderMainStatus.SettlementPending,
        action: "结算确认",
        to: OrderMainStatus.Completed,
        actorScope: [RoleScope.Operator],
        requiredPermission: "store-rental:order:settle",
        integrationPlaceholders: ["payment", "invoice", "enterprise-billing"]
      }
    ];
  }

  listStations() {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listStations();
    }
    return this.stations;
  }

  listStationPage(
    query: StoreStationListQuery = {}
  ): StoreStationListResult | Promise<StoreStationListResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listStationPage(query);
    }
    return this.buildStationListResult(this.stations, query);
  }

  private buildStationListResult(
    rows: StoreStationSummary[],
    query: StoreStationListQuery = {}
  ): StoreStationListResult {
    const keyword = query.keyword?.trim().toLowerCase();
    const serviceCapability = query.serviceCapability?.trim();
    const serviceStatus = this.normalizeStationServiceStatusFilter(query.serviceStatus);
    const status = this.normalizeStationStatusFilter(query.status);
    const scopeType = query.scopeType || "all";
    const scopeLabel = query.scopeLabel?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);

    const filteredRows = rows.filter((row) => {
      const keywordMatched =
        !keyword ||
        row.name.toLowerCase().includes(keyword) ||
        row.address.toLowerCase().includes(keyword) ||
        row.parentStoreName.toLowerCase().includes(keyword) ||
        (row.companyName ?? "").toLowerCase().includes(keyword);
      const scopeMatched =
        scopeType === "all" ||
        !scopeLabel ||
        (scopeType === "company" && (row.companyName || "RIMO 香港租户") === scopeLabel) ||
        (scopeType === "store" && row.parentStoreName === scopeLabel);
      const serviceMatched =
        !serviceCapability || row.serviceCapabilities.includes(serviceCapability);
      const rowServiceStatus =
        serviceCapability === "24小时自助"
          ? row.storeSelfServiceStatus
          : serviceCapability === "门市租车"
            ? row.storeRentalServiceStatus
            : row.serviceStatus;
      const serviceStatusMatched = !serviceStatus || rowServiceStatus === serviceStatus;
      const statusMatched = !status || row.status === status;
      return keywordMatched && scopeMatched && serviceMatched && serviceStatusMatched && statusMatched;
    });

    const offset = (page - 1) * pageSize;
    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      stats: this.buildStationListStats(filteredRows)
    };
  }

  private buildStationListStats(rows: StoreStationSummary[]): StoreStationListResult["stats"] {
    return {
      total: rows.length,
      enabled: rows.filter((row) => row.status === "enabled").length,
      disabled: rows.filter((row) => row.status === "disabled").length,
      normal: rows.filter((row) => row.serviceStatus === "normal").length,
      paused: rows.filter((row) => row.serviceStatus === "paused").length,
      maintenance: rows.filter((row) => row.serviceStatus === "maintenance").length
    };
  }

  private normalizeStationStatusFilter(
    value: unknown
  ): StoreStationSummary["status"] | undefined {
    return ["enabled", "disabled"].includes(String(value))
      ? (value as StoreStationSummary["status"])
      : undefined;
  }

  private normalizeStationServiceStatusFilter(
    value: unknown
  ): StoreStationSummary["serviceStatus"] | undefined {
    return ["normal", "paused", "maintenance"].includes(String(value))
      ? (value as StoreStationSummary["serviceStatus"])
      : undefined;
  }

  async listStationHierarchy(): Promise<StoreStationHierarchyNode[]> {
    const stations = await this.getStationsForRead();
    const companies = new Map<string, StoreStationHierarchyNode>();

    for (const station of stations) {
      const companyName = station.companyName || "RIMO 香港租户";
      const companyId = `company_${companyName}`;
      const storeId = `store_${companyName}_${station.parentStoreName}`;

      if (!companies.has(companyId)) {
        companies.set(companyId, {
          id: companyId,
          type: "company",
          label: companyName,
          stationCount: 0,
          children: []
        });
      }

      const company = companies.get(companyId)!;
      company.stationCount += 1;
      let store = company.children?.find((item) => item.id === storeId);
      if (!store) {
        store = {
          id: storeId,
          type: "store",
          parentId: companyId,
          label: station.parentStoreName,
          stationCount: 0,
          children: []
        };
        company.children?.push(store);
      }
      store.stationCount += 1;
    }

    return [
      {
        id: "all",
        type: "all",
        label: "全部",
        stationCount: stations.length,
        children: Array.from(companies.values())
      }
    ];
  }

  saveStation(input: StoreStationSummary) {
    const station = this.normalizeStation(input);
    this.validateStation(station);
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveStation(station);
    }
    const index = this.stations.findIndex((item) => item.id === station.id);

    if (index >= 0) {
      this.stations[index] = station;
    } else {
      this.stations.unshift(station);
    }

    return station;
  }

  listVehicleGroups() {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehicleGroups();
    }
    return this.vehicleGroupMasters;
  }

  async saveVehicleGroup(input: VehicleGroupMaster) {
    const vehicleGroup = this.normalizeVehicleGroup(input);
    const vehicleGroups = await this.getVehicleGroupsForRead();
    this.validateVehicleGroup(vehicleGroup, vehicleGroups);
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.saveVehicleGroup(vehicleGroup);
    }
    const index = this.vehicleGroupMasters.findIndex(
      (item) => item.id === vehicleGroup.id
    );

    if (index >= 0) {
      this.vehicleGroupMasters[index] = vehicleGroup;
    } else {
      this.vehicleGroupMasters.unshift(vehicleGroup);
    }

    return vehicleGroup;
  }

  listVehicles() {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehicles();
    }
    return this.vehicles;
  }

  listVehiclePage(query: VehicleListQuery = {}): VehicleListResult | Promise<VehicleListResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehiclePage(query);
    }
    return this.buildVehicleListResult(this.vehicles, query);
  }

  private buildVehicleListResult(
    rows: VehicleInstanceSummary[],
    query: VehicleListQuery = {}
  ): VehicleListResult {
    const keyword = query.keyword?.trim().toLowerCase();
    const operationStatus = this.normalizeVehicleStatusFilter(query.operationStatus);
    const serviceType = this.normalizeVehicleServiceTypeFilter(query.serviceType);
    const storeName = query.storeName?.trim();
    const page = this.normalizePositiveInteger(query.page, 1);
    const pageSize = Math.min(this.normalizePositiveInteger(query.pageSize, 20), 100);
    const availableStores = Array.from(
      new Set(rows.map((row) => row.currentStoreName.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const availableStations = Array.from(
      new Set(rows.map((row) => row.currentStationName.trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

    const filteredRows = rows.filter((row) => {
      const keywordMatched =
        !keyword ||
        row.licensePlate.toLowerCase().includes(keyword) ||
        row.vin.toLowerCase().includes(keyword) ||
        row.vehicleGroupName.toLowerCase().includes(keyword) ||
        (row.cid ?? "").toLowerCase().includes(keyword);
      const statusMatched = !operationStatus || row.operationStatus === operationStatus;
      const serviceMatched = !serviceType || row.serviceTypes.includes(serviceType);
      const storeMatched = !storeName || row.currentStoreName === storeName;
      return keywordMatched && statusMatched && serviceMatched && storeMatched;
    });

    const offset = (page - 1) * pageSize;
    return {
      rows: filteredRows.slice(offset, offset + pageSize),
      total: filteredRows.length,
      page,
      pageSize,
      availableStores,
      availableStations,
      stats: this.buildVehicleListStats(filteredRows)
    };
  }

  private buildVehicleListStats(rows: VehicleInstanceSummary[]): VehicleListResult["stats"] {
    return {
      total: rows.length,
      idle: rows.filter((row) => row.operationStatus === "idle").length,
      reserved: rows.filter((row) => row.operationStatus === "reserved").length,
      renting: rows.filter((row) => row.operationStatus === "renting").length,
      controlled: rows.filter((row) => row.operationStatus === "controlled").length,
      maintenance: rows.filter((row) => row.operationStatus === "maintenance").length,
      disabled: rows.filter((row) => row.operationStatus === "disabled").length
    };
  }

  private normalizeVehicleStatusFilter(
    value: unknown
  ): VehicleInstanceSummary["operationStatus"] | undefined {
    return ["idle", "reserved", "renting", "controlled", "maintenance", "disabled"].includes(
      String(value)
    )
      ? (value as VehicleInstanceSummary["operationStatus"])
      : undefined;
  }

  private normalizeVehicleServiceTypeFilter(
    value: unknown
  ): VehicleInstanceSummary["currentServiceType"] | undefined {
    return ["STORE_STANDARD", "STORE_24H"].includes(String(value))
      ? (value as VehicleInstanceSummary["currentServiceType"])
      : undefined;
  }

  async getVehicleDetail(id: string): Promise<StoreRentalVehicleDetail> {
    const vehicle = this.useMysqlDataSource()
      ? await this.storeRentalRepository.findVehicle(id)
      : this.findVehicle(id);
    return this.buildVehicleDetail(vehicle);
  }

  private async buildVehicleDetail(
    vehicle: VehicleInstanceSummary
  ): Promise<StoreRentalVehicleDetail> {
    const relatedOrders = this.orders
      .filter(
        (order) =>
          order.plateNo === vehicle.licensePlate ||
          order.vehicleGroupName.includes(vehicle.vehicleGroupName.split(" / ")[0])
      )
      .map((order) => ({
        orderId: order.id,
        orderNo: order.orderNo,
        customerName: order.customerName,
        pickupAt: order.pickupAt,
        returnAt: order.returnAt,
        pickupStoreName: order.pickupStoreName,
        returnStoreName: order.returnStoreName,
        mainStatus: order.mainStatus,
        dispatchStatus: order.dispatchStatus,
        totalAmount: order.totalAmount
      }));

    if (this.useMysqlDataSource()) {
      const [
        storedLocationEvents,
        conditionPhotos,
        maintenanceRecords,
        accidentRecords,
        credentialRecords,
        onboardItems,
        tboxDevices,
        statusChangeRecords,
        attachmentRecords,
        storedOperationLogs
      ] = await Promise.all([
        this.storeRentalRepository.listVehicleLocationEvents(vehicle.id),
        this.storeRentalRepository.listVehicleConditionPhotos(vehicle.id),
        this.storeRentalRepository.listVehicleMaintenanceRecords(vehicle.id),
        this.storeRentalRepository.listVehicleAccidentRecords(vehicle.id),
        this.storeRentalRepository.listVehicleCredentials(vehicle.id),
        this.storeRentalRepository.listVehicleOnboardItems(vehicle.id),
        this.storeRentalRepository.listTboxDevices(),
        this.storeRentalRepository.listVehicleStatusChangeRecords(vehicle.id),
        this.storeRentalRepository.listVehicleAttachmentRecords(vehicle.id),
        this.storeRentalRepository.listVehicleOperationLogs(vehicle)
      ]);
      const orderLocationEvents = this.buildVehicleLocationEvents({
        ...vehicle,
        id: `__orders_${vehicle.id}`
      }).filter((item) => item.source === "order");

      return {
        vehicle,
        relatedOrders,
        locationEvents: [...storedLocationEvents, ...orderLocationEvents].sort((left, right) =>
          right.at.localeCompare(left.at)
        ),
        conditionPhotos,
        maintenanceRecords,
        accidentRecords,
        credentialRecords,
        onboardItems,
        tboxDevice: tboxDevices.find((item) => item.boundVehicleId === vehicle.id),
        statusChangeRecords,
        attachmentRecords,
        operationLogs: [
          ...storedOperationLogs,
          ...this.buildVehicleOperationLogs({
            ...vehicle,
            id: `__defaults_${vehicle.id}`
          })
        ].sort((left, right) => right.at.localeCompare(left.at))
      };
    }

    return {
      vehicle,
      relatedOrders,
      locationEvents: this.buildVehicleLocationEvents(vehicle),
      conditionPhotos: this.buildVehicleConditionPhotos(vehicle),
      maintenanceRecords: this.buildVehicleMaintenanceRecords(vehicle),
      accidentRecords: this.buildVehicleAccidentRecords(vehicle),
      credentialRecords: this.buildVehicleCredentialRecords(vehicle),
      onboardItems: this.buildVehicleOnboardItems(vehicle),
      tboxDevice: this.findMemoryTboxDeviceByVehicle(vehicle.id),
      statusChangeRecords: [],
      attachmentRecords: [],
      operationLogs: this.buildVehicleOperationLogs(vehicle)
    };
  }

  createVehicleLocationEvent(
    id: string,
    input: CreateVehicleLocationEventRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.createMysqlVehicleLocationEvent(id, input);
    }
    const vehicle = this.findVehicle(id);
    const storeName = input.storeName?.trim();
    const stationName = input.stationName?.trim();
    const mileage = Number(input.mileage ?? vehicle.mileage);
    const at = input.at?.trim() || new Date().toISOString();
    const type = input.type;

    if (!storeName || !stationName) {
      throw new BadRequestException("请填写所属门市和站点。");
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      throw new BadRequestException("里程必须为大于等于 0 的有效数字。");
    }

    if (type === "transfer" && this.hasBlockingTransferOrder(vehicle)) {
      throw new BadRequestException("车辆当前存在履约中的订单，占用未释放前不能调拨。");
    }

    const station = this.stations.find((item) => item.name === stationName);
    if (!station) {
      throw new BadRequestException("站点不存在。");
    }
    if (station.parentStoreName !== storeName) {
      throw new BadRequestException("站点不属于所选门市。");
    }

    const records = this.vehicleLocationEvents.get(id) ?? [];
    const record: VehicleLocationEvent = {
      id: `loc_manual_${randomUUID()}`,
      at,
      type,
      storeName,
      stationName,
      mileage,
      operator: input.operator?.trim() || "营运端",
      source: type === "iot_sync" ? "iot" : "operation",
      note: input.note?.trim()
    };
    this.vehicleLocationEvents.set(id, [record, ...records].slice(0, 120));
    this.syncVehiclePositionFromStoredEvents(vehicle);

    this.appendVehicleOperationLog(vehicle, {
      operator: record.operator,
      action: "新增出入站流水",
      reason: `${record.storeName} / ${record.stationName} / ${record.type}`
    });

    return this.getVehicleDetail(id);
  }

  updateVehicleLocationEvent(
    id: string,
    recordId: string,
    input: UpdateVehicleLocationEventRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.updateMysqlVehicleLocationEvent(id, recordId, input);
    }
    const vehicle = this.findVehicle(id);
    const records = this.vehicleLocationEvents.get(id) ?? [];
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle location event ${recordId} was not found`);
    }

    const nextType = input.type ?? record.type;
    const nextStoreName = input.storeName?.trim() ?? record.storeName;
    const nextStationName = input.stationName?.trim() ?? record.stationName;
    const nextMileage =
      input.mileage !== undefined ? Number(input.mileage) : record.mileage;

    if (!nextStoreName || !nextStationName) {
      throw new BadRequestException("请填写所属门市和站点。");
    }
    if (!Number.isFinite(nextMileage) || nextMileage < 0) {
      throw new BadRequestException("里程必须为大于等于 0 的有效数字。");
    }
    if (nextType === "transfer" && this.hasBlockingTransferOrder(vehicle)) {
      throw new BadRequestException("车辆当前存在履约中的订单，占用未释放前不能调拨。");
    }

    const station = this.stations.find((item) => item.name === nextStationName);
    if (!station) {
      throw new BadRequestException("站点不存在。");
    }
    if (station.parentStoreName !== nextStoreName) {
      throw new BadRequestException("站点不属于所选门市。");
    }

    record.at = input.at?.trim() || record.at;
    record.type = nextType;
    record.storeName = nextStoreName;
    record.stationName = nextStationName;
    record.mileage = nextMileage;
    record.note = input.note !== undefined ? input.note?.trim() : record.note;
    record.operator = input.operator?.trim() || record.operator;
    record.source = nextType === "iot_sync" ? "iot" : "operation";

    this.syncVehiclePositionFromStoredEvents(vehicle);
    this.appendVehicleOperationLog(vehicle, {
      operator: input.operator?.trim() || "营运端",
      action: "编辑出入站流水",
      reason: `${record.storeName} / ${record.stationName} / ${record.type}`
    });

    return this.getVehicleDetail(id);
  }

  createVehicleConditionPhotoRecord(
    id: string,
    input: CreateVehicleConditionPhotoRecordRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.createMysqlVehicleConditionPhotoRecord(id, input);
    }
    const vehicle = this.findVehicle(id);
    const photos = (input.photos ?? []).map((item) => item.trim()).filter(Boolean);
    const remark = input.remark?.trim();

    if (photos.length === 0) {
      throw new BadRequestException("请至少提供一张车况照片。");
    }
    if (!remark) {
      throw new BadRequestException("请填写照片说明。");
    }

    const records = this.vehicleConditionPhotoRecords.get(id) ?? [];
    const record: VehicleConditionPhotoRecord = {
      id: `photo_${randomUUID()}`,
      at: input.at?.trim() || new Date().toISOString(),
      scene: input.scene || "manual",
      operator: input.operator?.trim() || "营运端",
      remark,
      photos
    };
    this.vehicleConditionPhotoRecords.set(id, [record, ...records].slice(0, 80));

    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = record.operator;
    this.appendVehicleOperationLog(vehicle, {
      operator: record.operator,
      action: "补录车况照片",
      reason: `${record.scene} / ${record.photos.length} 张`
    });

    return this.getVehicleDetail(id);
  }

  createVehicleMaintenanceRecord(
    id: string,
    input: CreateVehicleMaintenanceRecordRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.createMysqlVehicleMaintenanceRecord(id, input);
    }
    const vehicle = this.findVehicle(id);
    const type = input.type?.trim();
    const vendor = input.vendor?.trim();
    const mileage = Number(input.mileage ?? vehicle.mileage);
    const costAmount = Number(input.costAmount ?? 0);
    const status = input.status || "processing";

    if (!type || !vendor) {
      throw new BadRequestException("请填写维保类型和维保厂商。");
    }
    if (!Number.isFinite(mileage) || !Number.isFinite(costAmount)) {
      throw new BadRequestException("维保里程和费用必须为有效数字。");
    }
    if (mileage < 0 || costAmount < 0) {
      throw new BadRequestException("维保里程和费用不能小于 0。");
    }

    const record: VehicleMaintenanceRecord = {
      id: `maint_${randomUUID()}`,
      date: input.date || new Date().toISOString().slice(0, 10),
      type,
      vendor,
      mileage,
      costAmount,
      status,
      remark: input.remark?.trim()
    };
    const records = this.vehicleMaintenanceRecords.get(id) ?? [];
    this.vehicleMaintenanceRecords.set(id, [record, ...records].slice(0, 80));

    const operator = input.operator || "营运端";
    if (record.status !== "completed" && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "maintenance";
      vehicle.maintenanceReason = record.remark || record.type;
    }
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    this.appendVehicleOperationLog(vehicle, {
      operator,
      action: "新增维保记录",
      reason: `${record.type} / ${record.vendor}`
    });

    return this.getVehicleDetail(id);
  }

  updateVehicleMaintenanceRecord(
    id: string,
    recordId: string,
    input: UpdateVehicleMaintenanceRecordRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.updateMysqlVehicleMaintenanceRecord(id, recordId, input);
    }
    const vehicle = this.findVehicle(id);
    const records = this.vehicleMaintenanceRecords.get(id) ?? [];
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle maintenance record ${recordId} was not found`);
    }

    if (input.type !== undefined) {
      const type = input.type.trim();
      if (!type) {
        throw new BadRequestException("维保类型不能为空。");
      }
      record.type = type;
    }
    if (input.vendor !== undefined) {
      const vendor = input.vendor.trim();
      if (!vendor) {
        throw new BadRequestException("维保厂商不能为空。");
      }
      record.vendor = vendor;
    }
    if (input.date !== undefined) {
      record.date = input.date;
    }
    if (input.mileage !== undefined) {
      const mileage = Number(input.mileage);
      if (!Number.isFinite(mileage) || mileage < 0) {
        throw new BadRequestException("维保里程必须为大于等于 0 的有效数字。");
      }
      record.mileage = mileage;
    }
    if (input.costAmount !== undefined) {
      const costAmount = Number(input.costAmount);
      if (!Number.isFinite(costAmount) || costAmount < 0) {
        throw new BadRequestException("维保费用必须为大于等于 0 的有效数字。");
      }
      record.costAmount = costAmount;
    }
    if (input.status !== undefined) {
      record.status = input.status;
    }
    if (input.remark !== undefined) {
      record.remark = input.remark?.trim() || undefined;
    }

    const operator = input.operator || "营运端";
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;

    const hasOpenMaintenance = records.some((item) => item.status !== "completed");
    const hasOpenAccident = (this.vehicleAccidentRecords.get(id) ?? []).some(
      (item) => item.claimStatus !== "closed"
    );

    if (!hasOpenMaintenance && vehicle.operationStatus === "maintenance") {
      vehicle.operationStatus = hasOpenAccident ? "controlled" : "idle";
      delete vehicle.maintenanceReason;
    } else if (hasOpenMaintenance && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "maintenance";
      vehicle.maintenanceReason = record.remark || record.type;
    }

    this.appendVehicleOperationLog(vehicle, {
      operator,
      action: "更新维保记录",
      reason: `${record.type} / ${record.status}`
    });

    return this.getVehicleDetail(id);
  }

  createVehicleAccidentRecord(
    id: string,
    input: CreateVehicleAccidentRecordRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.createMysqlVehicleAccidentRecord(id, input);
    }
    const vehicle = this.findVehicle(id);
    const description = input.description?.trim();
    const estimatedCostAmount = Number(input.estimatedCostAmount ?? 0);
    const claimStatus = input.claimStatus || "processing";
    if (!description) {
      throw new BadRequestException("请填写事故/出险描述。");
    }
    if (!Number.isFinite(estimatedCostAmount)) {
      throw new BadRequestException("预估费用必须为有效数字。");
    }
    if (estimatedCostAmount < 0) {
      throw new BadRequestException("预估费用不能小于 0。");
    }

    const record: VehicleAccidentRecord = {
      id: `acc_${randomUUID()}`,
      date: input.date || new Date().toISOString().slice(0, 10),
      description,
      claimStatus,
      estimatedCostAmount,
      reportNo: input.reportNo?.trim() || `RP-${vehicle.id}-${Date.now()}`
    };
    const records = this.vehicleAccidentRecords.get(id) ?? [];
    this.vehicleAccidentRecords.set(id, [record, ...records].slice(0, 80));

    const operator = input.operator || "营运端";
    if (record.claimStatus !== "closed" && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "controlled";
      delete vehicle.maintenanceReason;
    }
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    this.appendVehicleOperationLog(vehicle, {
      operator,
      action: "新增事故/出险记录",
      reason: `${record.reportNo} / ${record.description}`
    });

    return this.getVehicleDetail(id);
  }

  updateVehicleAccidentRecord(
    id: string,
    recordId: string,
    input: UpdateVehicleAccidentRecordRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      return this.updateMysqlVehicleAccidentRecord(id, recordId, input);
    }
    const vehicle = this.findVehicle(id);
    const records = this.vehicleAccidentRecords.get(id) ?? [];
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle accident record ${recordId} was not found`);
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) {
        throw new BadRequestException("事故/出险描述不能为空。");
      }
      record.description = description;
    }
    if (input.date !== undefined) {
      record.date = input.date;
    }
    if (input.claimStatus !== undefined) {
      record.claimStatus = input.claimStatus;
    }
    if (input.estimatedCostAmount !== undefined) {
      const estimatedCostAmount = Number(input.estimatedCostAmount);
      if (!Number.isFinite(estimatedCostAmount) || estimatedCostAmount < 0) {
        throw new BadRequestException("预估费用必须为大于等于 0 的有效数字。");
      }
      record.estimatedCostAmount = estimatedCostAmount;
    }
    if (input.reportNo !== undefined) {
      record.reportNo = input.reportNo.trim() || record.reportNo;
    }

    const operator = input.operator || "营运端";
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;

    const hasOpenAccident = records.some((item) => item.claimStatus !== "closed");
    const hasOpenMaintenance = (this.vehicleMaintenanceRecords.get(id) ?? []).some(
      (item) => item.status !== "completed"
    );

    if (!hasOpenAccident && vehicle.operationStatus === "controlled") {
      vehicle.operationStatus = hasOpenMaintenance ? "maintenance" : "idle";
    } else if (hasOpenAccident && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "controlled";
    }

    this.appendVehicleOperationLog(vehicle, {
      operator,
      action: "更新事故/出险记录",
      reason: `${record.reportNo} / ${record.claimStatus}`
    });

    return this.getVehicleDetail(id);
  }

  private async createMysqlVehicleLocationEvent(
    id: string,
    input: CreateVehicleLocationEventRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const storeName = input.storeName?.trim();
    const stationName = input.stationName?.trim();
    const mileage = Number(input.mileage ?? vehicle.mileage);
    const at = input.at?.trim() || new Date().toISOString();
    const type = input.type;

    await this.validateVehicleLocationEventInput(
      vehicle,
      type,
      storeName,
      stationName,
      mileage
    );

    const record: VehicleLocationEvent = {
      id: `loc_manual_${randomUUID()}`,
      at,
      type,
      storeName: storeName!,
      stationName: stationName!,
      mileage,
      operator: input.operator?.trim() || "营运端",
      source: type === "iot_sync" ? "iot" : "operation",
      note: input.note?.trim()
    };
    await this.storeRentalRepository.createVehicleLocationEvent(id, record);
    await this.syncMysqlVehiclePositionFromStoredEvents(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator: record.operator,
      action: "新增出入站流水",
      reason: `${record.storeName} / ${record.stationName} / ${record.type}`
    });

    return this.getVehicleDetail(id);
  }

  private async updateMysqlVehicleLocationEvent(
    id: string,
    recordId: string,
    input: UpdateVehicleLocationEventRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const records = await this.storeRentalRepository.listVehicleLocationEvents(id);
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle location event ${recordId} was not found`);
    }

    const nextType = input.type ?? record.type;
    const nextStoreName = input.storeName?.trim() ?? record.storeName;
    const nextStationName = input.stationName?.trim() ?? record.stationName;
    const nextMileage =
      input.mileage !== undefined ? Number(input.mileage) : record.mileage;

    await this.validateVehicleLocationEventInput(
      vehicle,
      nextType,
      nextStoreName,
      nextStationName,
      nextMileage
    );

    const nextRecord: VehicleLocationEvent = {
      ...record,
      at: input.at?.trim() || record.at,
      type: nextType,
      storeName: nextStoreName,
      stationName: nextStationName,
      mileage: nextMileage,
      note: input.note !== undefined ? input.note?.trim() : record.note,
      operator: input.operator?.trim() || record.operator,
      source: nextType === "iot_sync" ? "iot" : "operation"
    };
    await this.storeRentalRepository.updateVehicleLocationEvent(id, nextRecord);
    await this.syncMysqlVehiclePositionFromStoredEvents(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator: input.operator?.trim() || "营运端",
      action: "编辑出入站流水",
      reason: `${nextRecord.storeName} / ${nextRecord.stationName} / ${nextRecord.type}`
    });

    return this.getVehicleDetail(id);
  }

  private async createMysqlVehicleConditionPhotoRecord(
    id: string,
    input: CreateVehicleConditionPhotoRecordRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const photos = (input.photos ?? []).map((item) => item.trim()).filter(Boolean);
    const remark = input.remark?.trim();

    if (photos.length === 0) {
      throw new BadRequestException("请至少提供一张车况照片。");
    }
    if (!remark) {
      throw new BadRequestException("请填写照片说明。");
    }

    const record: VehicleConditionPhotoRecord = {
      id: `photo_${randomUUID()}`,
      at: input.at?.trim() || new Date().toISOString(),
      scene: input.scene || "manual",
      operator: input.operator?.trim() || "营运端",
      remark,
      photos
    };
    await this.storeRentalRepository.createVehicleConditionPhotoRecord(id, record);

    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = record.operator;
    await this.storeRentalRepository.saveVehicle(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator: record.operator,
      action: "补录车况照片",
      reason: `${record.scene} / ${record.photos.length} 张`
    });

    return this.getVehicleDetail(id);
  }

  private async createMysqlVehicleMaintenanceRecord(
    id: string,
    input: CreateVehicleMaintenanceRecordRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const type = input.type?.trim();
    const vendor = input.vendor?.trim();
    const mileage = Number(input.mileage ?? vehicle.mileage);
    const costAmount = Number(input.costAmount ?? 0);
    const status = input.status || "processing";

    if (!type || !vendor) {
      throw new BadRequestException("请填写维保类型和维保厂商。");
    }
    if (!Number.isFinite(mileage) || !Number.isFinite(costAmount)) {
      throw new BadRequestException("维保里程和费用必须为有效数字。");
    }
    if (mileage < 0 || costAmount < 0) {
      throw new BadRequestException("维保里程和费用不能小于 0。");
    }

    const record: VehicleMaintenanceRecord = {
      id: `maint_${randomUUID()}`,
      date: input.date || new Date().toISOString().slice(0, 10),
      type,
      vendor,
      mileage,
      costAmount,
      status,
      remark: input.remark?.trim()
    };
    const operator = input.operator || "营运端";
    const saved = await this.storeRentalRepository.createVehicleMaintenanceRecord(
      id,
      record,
      operator
    );

    if (saved.status !== "completed" && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "maintenance";
      vehicle.maintenanceReason = saved.remark || saved.type;
    }
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    await this.storeRentalRepository.saveVehicle(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator,
      action: "新增维保记录",
      reason: `${saved.type} / ${saved.vendor}`
    });

    return this.getVehicleDetail(id);
  }

  private async updateMysqlVehicleMaintenanceRecord(
    id: string,
    recordId: string,
    input: UpdateVehicleMaintenanceRecordRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const records = await this.storeRentalRepository.listVehicleMaintenanceRecords(id);
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle maintenance record ${recordId} was not found`);
    }

    if (input.type !== undefined) {
      const type = input.type.trim();
      if (!type) {
        throw new BadRequestException("维保类型不能为空。");
      }
      record.type = type;
    }
    if (input.vendor !== undefined) {
      const vendor = input.vendor.trim();
      if (!vendor) {
        throw new BadRequestException("维保厂商不能为空。");
      }
      record.vendor = vendor;
    }
    if (input.date !== undefined) {
      record.date = input.date;
    }
    if (input.mileage !== undefined) {
      const mileage = Number(input.mileage);
      if (!Number.isFinite(mileage) || mileage < 0) {
        throw new BadRequestException("维保里程必须为大于等于 0 的有效数字。");
      }
      record.mileage = mileage;
    }
    if (input.costAmount !== undefined) {
      const costAmount = Number(input.costAmount);
      if (!Number.isFinite(costAmount) || costAmount < 0) {
        throw new BadRequestException("维保费用必须为大于等于 0 的有效数字。");
      }
      record.costAmount = costAmount;
    }
    if (input.status !== undefined) {
      record.status = input.status;
    }
    if (input.remark !== undefined) {
      record.remark = input.remark?.trim() || undefined;
    }

    const operator = input.operator || "营运端";
    const saved = await this.storeRentalRepository.updateVehicleMaintenanceRecord(
      id,
      record,
      operator
    );
    const nextRecords = (await this.storeRentalRepository.listVehicleMaintenanceRecords(id)).map(
      (item) => (item.id === saved.id ? saved : item)
    );
    const accidentRecords = await this.storeRentalRepository.listVehicleAccidentRecords(id);
    const hasOpenMaintenance = nextRecords.some((item) => item.status !== "completed");
    const hasOpenAccident = accidentRecords.some((item) => item.claimStatus !== "closed");

    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    if (!hasOpenMaintenance && vehicle.operationStatus === "maintenance") {
      vehicle.operationStatus = hasOpenAccident ? "controlled" : "idle";
      delete vehicle.maintenanceReason;
    } else if (hasOpenMaintenance && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "maintenance";
      vehicle.maintenanceReason = saved.remark || saved.type;
    }
    await this.storeRentalRepository.saveVehicle(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator,
      action: "更新维保记录",
      reason: `${saved.type} / ${saved.status}`
    });

    return this.getVehicleDetail(id);
  }

  private async createMysqlVehicleAccidentRecord(
    id: string,
    input: CreateVehicleAccidentRecordRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const description = input.description?.trim();
    const estimatedCostAmount = Number(input.estimatedCostAmount ?? 0);
    const claimStatus = input.claimStatus || "processing";
    if (!description) {
      throw new BadRequestException("请填写事故/出险描述。");
    }
    if (!Number.isFinite(estimatedCostAmount)) {
      throw new BadRequestException("预估费用必须为有效数字。");
    }
    if (estimatedCostAmount < 0) {
      throw new BadRequestException("预估费用不能小于 0。");
    }

    const record: VehicleAccidentRecord = {
      id: `acc_${randomUUID()}`,
      date: input.date || new Date().toISOString().slice(0, 10),
      description,
      claimStatus,
      estimatedCostAmount,
      reportNo: input.reportNo?.trim() || `RP-${vehicle.id}-${Date.now()}`
    };
    const operator = input.operator || "营运端";
    const saved = await this.storeRentalRepository.createVehicleAccidentRecord(
      id,
      record,
      operator
    );

    if (saved.claimStatus !== "closed" && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "controlled";
      delete vehicle.maintenanceReason;
    }
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    await this.storeRentalRepository.saveVehicle(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator,
      action: "新增事故/出险记录",
      reason: `${saved.reportNo} / ${saved.description}`
    });

    return this.getVehicleDetail(id);
  }

  private async updateMysqlVehicleAccidentRecord(
    id: string,
    recordId: string,
    input: UpdateVehicleAccidentRecordRequest
  ) {
    const vehicle = await this.storeRentalRepository.findVehicle(id);
    const records = await this.storeRentalRepository.listVehicleAccidentRecords(id);
    const record = records.find((item) => item.id === recordId);

    if (!record) {
      throw new NotFoundException(`Vehicle accident record ${recordId} was not found`);
    }

    if (input.description !== undefined) {
      const description = input.description.trim();
      if (!description) {
        throw new BadRequestException("事故/出险描述不能为空。");
      }
      record.description = description;
    }
    if (input.date !== undefined) {
      record.date = input.date;
    }
    if (input.claimStatus !== undefined) {
      record.claimStatus = input.claimStatus;
    }
    if (input.estimatedCostAmount !== undefined) {
      const estimatedCostAmount = Number(input.estimatedCostAmount);
      if (!Number.isFinite(estimatedCostAmount) || estimatedCostAmount < 0) {
        throw new BadRequestException("预估费用必须为大于等于 0 的有效数字。");
      }
      record.estimatedCostAmount = estimatedCostAmount;
    }
    if (input.reportNo !== undefined) {
      record.reportNo = input.reportNo.trim() || record.reportNo;
    }

    const operator = input.operator || "营运端";
    const saved = await this.storeRentalRepository.updateVehicleAccidentRecord(
      id,
      record,
      operator
    );
    const nextRecords = (await this.storeRentalRepository.listVehicleAccidentRecords(id)).map(
      (item) => (item.id === saved.id ? saved : item)
    );
    const maintenanceRecords = await this.storeRentalRepository.listVehicleMaintenanceRecords(id);
    const hasOpenAccident = nextRecords.some((item) => item.claimStatus !== "closed");
    const hasOpenMaintenance = maintenanceRecords.some(
      (item) => item.status !== "completed"
    );

    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = operator;
    if (!hasOpenAccident && vehicle.operationStatus === "controlled") {
      vehicle.operationStatus = hasOpenMaintenance ? "maintenance" : "idle";
    } else if (hasOpenAccident && vehicle.operationStatus !== "renting") {
      vehicle.operationStatus = "controlled";
    }
    await this.storeRentalRepository.saveVehicle(vehicle);
    await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
      operator,
      action: "更新事故/出险记录",
      reason: `${saved.reportNo} / ${saved.claimStatus}`
    });

    return this.getVehicleDetail(id);
  }

  private async validateVehicleLocationEventInput(
    vehicle: VehicleInstanceSummary,
    type: VehicleLocationEvent["type"],
    storeName: string | undefined,
    stationName: string | undefined,
    mileage: number
  ) {
    if (!storeName || !stationName) {
      throw new BadRequestException("请填写所属门市和站点。");
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      throw new BadRequestException("里程必须为大于等于 0 的有效数字。");
    }
    if (type === "transfer" && this.hasBlockingTransferOrder(vehicle)) {
      throw new BadRequestException("车辆当前存在履约中的订单，占用未释放前不能调拨。");
    }

    const stations = await this.getStationsForRead();
    const station = stations.find((item) => item.name === stationName);
    if (!station) {
      throw new BadRequestException("站点不存在。");
    }
    if (station.parentStoreName !== storeName) {
      throw new BadRequestException("站点不属于所选门市。");
    }
  }

  private async syncMysqlVehiclePositionFromStoredEvents(
    vehicle: VehicleInstanceSummary
  ) {
    const [latest] = await this.storeRentalRepository.listVehicleLocationEvents(
      vehicle.id
    );
    if (!latest) {
      return;
    }

    vehicle.currentStoreName = latest.storeName;
    vehicle.currentStationName = latest.stationName;
    vehicle.mileage = latest.mileage;
    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = latest.operator;
    await this.storeRentalRepository.saveVehicle(vehicle);
  }

  async saveVehicle(input: VehicleInstanceSummary) {
    const vehicle = this.normalizeVehicle(input);
    const [vehicles, stations, vehicleGroups] = await Promise.all([
      this.getVehiclesForRead(),
      this.getStationsForRead(),
      this.getVehicleGroupsForRead()
    ]);
    this.validateVehicle(vehicle, { vehicles, stations, vehicleGroups });
    if (this.useMysqlDataSource()) {
      const existed = vehicles.some((item) => item.id === vehicle.id);
      const saved = await this.storeRentalRepository.saveVehicle({
        ...vehicle,
        lastOperationAt: new Date().toISOString(),
        lastOperationBy: "营运端"
      });
      await this.storeRentalRepository.appendVehicleOperationLog(saved, {
        operator: "营运端",
        action: existed ? "编辑车辆档案" : "新增车辆档案",
        reason: "车辆档案保存"
      });
      return saved;
    }
    const index = this.vehicles.findIndex((item) => item.id === vehicle.id);

    if (index >= 0) {
      this.vehicles[index] = vehicle;
    } else {
      this.vehicles.unshift(vehicle);
    }

    this.appendVehicleOperationLog(vehicle, {
      operator: "营运端",
      action: index >= 0 ? "编辑车辆档案" : "新增车辆档案",
      reason: "车辆档案保存"
    });

    return vehicle;
  }

  deleteVehicleGroup(id: string) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.deleteVehicleGroup(id);
    }
    const group = this.vehicleGroupMasters.find((item) => item.id === id);
    if (!group) {
      throw new NotFoundException(`Vehicle group ${id} was not found`);
    }

    const referencedByVehicle = this.vehicles.some(
      (vehicle) =>
        vehicle.vehicleGroupName === group.storeProductGroupName ||
        vehicle.vehicleGroupName.includes(group.model) ||
        vehicle.vehicleGroupName.includes(group.brand)
    );
    const referencedByOrder = this.orders.some((order) =>
      order.vehicleGroupName.includes(group.storeProductGroupName)
    );

    if (referencedByVehicle || referencedByOrder) {
      throw new BadRequestException(
        "该车型组已被车辆或订单引用，不能删除。请先下架相关车辆或保留历史版本。"
      );
    }

    this.vehicleGroupMasters = this.vehicleGroupMasters.filter(
      (item) => item.id !== id
    );

    return {
      id,
      deleted: true,
      message: "车型组已删除"
    };
  }

  async saveVehicleAttachmentRecord(
    id: string,
    input: SaveVehicleAttachmentRequest
  ): Promise<StoreRentalVehicleDetail> {
    if (this.useMysqlDataSource()) {
      const saved = await this.storeRentalRepository.saveVehicleAttachmentRecord(id, input);
      const vehicle = await this.storeRentalRepository.findVehicle(id);
      await this.storeRentalRepository.appendVehicleOperationLog(vehicle, {
        operator: saved.operator,
        action: "维护车辆附件",
        reason: `${saved.category} / ${saved.name}`
      });
    }

    return this.getVehicleDetail(id);
  }

  async refreshStationCapacitySnapshots(
    stationId?: string
  ): Promise<StationCapacityRefreshResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.refreshStationCapacitySnapshots(stationId);
    }
    const snapshots = stationId
      ? this.stationCapacitySnapshots.filter((item) => item.stationId === stationId)
      : this.stationCapacitySnapshots;

    return {
      snapshots,
      message: stationId ? "站点容量快照已刷新" : "全部站点容量快照已刷新"
    };
  }

  async updateVehicleStatus(
    id: string,
    input: {
      enabled?: boolean;
      operationStatus?: VehicleInstanceSummary["operationStatus"];
      reason?: string;
      operator?: string;
    }
  ) {
    const vehicle = this.useMysqlDataSource()
      ? await this.storeRentalRepository.findVehicle(id)
      : this.vehicles.find((item) => item.id === id);
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }
    const stations = await this.getStationsForRead();

    if (
      input.operationStatus &&
      input.operationStatus !== "renting" &&
      vehicle.operationStatus === "renting"
    ) {
      throw new BadRequestException(
        "车辆租赁中，不能直接从车辆档案页改为其他状态，请先完成订单还车或事故处理。"
      );
    }

    if (input.enabled === false) {
      vehicle.enabled = false;
      if (vehicle.operationStatus === "idle") {
        vehicle.operationStatus = "disabled";
      }
      vehicle.disabledReason = input.reason || "营运端手动停用";
    }

    if (input.enabled === true) {
      vehicle.enabled = true;
      if (vehicle.operationStatus === "disabled") {
        vehicle.operationStatus = "idle";
      }
      delete vehicle.disabledReason;
    }

    if (input.operationStatus) {
      if (
        input.operationStatus === "idle" &&
        !this.stationCanServeStoreRental(
          vehicle.currentStationName,
          vehicle.currentServiceType,
          stations
        )
      ) {
        throw new BadRequestException(
          "当前据点未启用对应门市租赁服务能力，车辆不能恢复为空闲可派状态。"
        );
      }
      vehicle.operationStatus = input.operationStatus;
      if (input.operationStatus === "maintenance") {
        vehicle.maintenanceReason = input.reason || "营运端发起维保";
      }
      if (input.operationStatus !== "maintenance") {
        delete vehicle.maintenanceReason;
      }
    }

    vehicle.lastOperationAt = new Date().toISOString();
    vehicle.lastOperationBy = input.operator || "营运端";
    if (this.useMysqlDataSource()) {
      const before = structuredClone(vehicle);
      const saved = await this.storeRentalRepository.saveVehicle(vehicle);
      const recheckSummary = await this.storeRentalRepository.recheckVehicleUpcomingOrders(saved, {
        operator: saved.lastOperationBy || "营运端",
        reason: input.reason
      });
      await this.storeRentalRepository.recordVehicleStatusChange(before, saved, {
        operator: saved.lastOperationBy || "营运端",
        reason: input.reason,
        impactedOrderNos: recheckSummary.manualQueueOrderNos
      });
      await this.storeRentalRepository.appendVehicleOperationLog(saved, {
        operator: saved.lastOperationBy || "营运端",
        action: this.vehicleStatusActionLabel(input, saved),
        reason: input.reason
      });
      return {
        vehicle: saved,
        message: `车辆 ${saved.licensePlate} 状态已更新`,
        recheckSummary
      };
    }
    this.appendVehicleOperationLog(vehicle, {
      operator: vehicle.lastOperationBy,
      action: this.vehicleStatusActionLabel(input, vehicle),
      reason: input.reason
    });

    return {
      vehicle,
      message: `车辆 ${vehicle.licensePlate} 状态已更新`
    };
  }

  async listVehicleTransferTasks(): Promise<VehicleTransferTask[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehicleTransferTasks();
    }
    this.ensureMemoryFleetRecords();
    return this.vehicleTransferTasks;
  }

  async createVehicleTransferTask(
    input: CreateVehicleTransferTaskRequest
  ): Promise<VehicleTransferTaskResult> {
    const vehicleIds = Array.from(new Set(input.vehicleIds ?? []));
    const reason = input.reason?.trim();
    if (vehicleIds.length === 0) {
      throw new BadRequestException("请先选择需要调拨的车辆。");
    }
    if (!input.targetStoreName || !input.targetStationName || !input.targetServiceType) {
      throw new BadRequestException("请选择目标门市、目标站点和目标服务类型。");
    }
    if (!reason) {
      throw new BadRequestException("请填写调拨原因。");
    }

    const stations = await this.getStationsForRead();
    const targetStation = stations.find((station) => station.name === input.targetStationName);
    if (!targetStation || targetStation.parentStoreName !== input.targetStoreName) {
      throw new BadRequestException("目标站点不存在或不属于目标门市。");
    }
    if (
      !this.stationCanServeStoreRental(
        input.targetStationName,
        input.targetServiceType,
        stations
      )
    ) {
      throw new BadRequestException("目标站点未启用对应门市租赁服务能力。");
    }

    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.createVehicleTransferTask({
        ...input,
        vehicleIds,
        reason
      });
    }

    const operator = input.operator?.trim() || "营运端";
    const sourceVehicle = this.findVehicle(vehicleIds[0]);
    const items = vehicleIds.map((vehicleId) => {
      const vehicle = this.findVehicle(vehicleId);
      const base = {
        vehicleId: vehicle.id,
        licensePlate: vehicle.licensePlate,
        sourceStoreName: vehicle.currentStoreName,
        sourceStationName: vehicle.currentStationName,
        targetStoreName: input.targetStoreName,
        targetStationName: input.targetStationName,
        targetServiceType: input.targetServiceType
      };
      if (vehicle.operationStatus !== "idle") {
        return {
          ...base,
          result: "failed" as const,
          message: "车辆非空闲状态，不能直接调拨。"
        };
      }
      if (!vehicle.serviceTypes.includes(input.targetServiceType)) {
        return {
          ...base,
          result: "failed" as const,
          message: "车辆未配置目标服务类型。"
        };
      }

      vehicle.currentStoreName = input.targetStoreName;
      vehicle.currentStationName = input.targetStationName;
      vehicle.currentServiceType = input.targetServiceType;
      vehicle.lastOperationAt = new Date().toISOString();
      vehicle.lastOperationBy = operator;
      const records = this.vehicleLocationEvents.get(vehicle.id) ?? [];
      records.unshift({
        id: `loc_transfer_${randomUUID()}`,
        at: new Date().toISOString(),
        type: "transfer",
        storeName: input.targetStoreName,
        stationName: input.targetStationName,
        mileage: vehicle.mileage,
        operator,
        source: "operation",
        note: reason
      });
      this.vehicleLocationEvents.set(vehicle.id, records.slice(0, 120));
      this.appendVehicleOperationLog(vehicle, {
        operator,
        action: "车辆调拨",
        reason: `${base.sourceStoreName}/${base.sourceStationName} -> ${input.targetStoreName}/${input.targetStationName}`
      });

      return {
        ...base,
        result: "completed" as const,
        message: "调拨完成"
      };
    });
    const now = new Date().toISOString();
    const task: VehicleTransferTask = {
      id: `transfer_${randomUUID()}`,
      taskNo: `TR${now.replace(/\D/g, "").slice(0, 14)}`,
      status: items.some((item) => item.result === "failed") ? "pending" : "completed",
      sourceStoreName: sourceVehicle.currentStoreName,
      sourceStationName: sourceVehicle.currentStationName,
      targetStoreName: input.targetStoreName,
      targetStationName: input.targetStationName,
      targetServiceType: input.targetServiceType,
      vehicleCount: items.length,
      reason,
      operator,
      items,
      createdAt: now,
      completedAt: items.some((item) => item.result === "failed") ? undefined : now
    };
    this.vehicleTransferTasks.unshift(task);

    return {
      task,
      vehicles: vehicleIds.map((id) => this.findVehicle(id))
    };
  }

  async listVehicleCredentials(id: string): Promise<VehicleCredentialRecord[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehicleCredentials(id);
    }
    this.findVehicle(id);
    return this.buildVehicleCredentialRecords(this.findVehicle(id));
  }

  async saveVehicleCredential(
    id: string,
    input: SaveVehicleCredentialRequest
  ): Promise<VehicleCredentialRecord[]> {
    if (!input.credentialName || !input.certNo) {
      throw new BadRequestException("请填写证照名称和证件编号。");
    }
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.saveVehicleCredential(id, input);
      return this.storeRentalRepository.listVehicleCredentials(id);
    }
    const vehicle = this.findVehicle(id);
    const records = this.vehicleCredentialRecords.get(id) ?? this.buildVehicleCredentialRecords(vehicle);
    const now = new Date().toISOString();
    const record: VehicleCredentialRecord = {
      id: input.id || `cred_${randomUUID()}`,
      vehicleId: id,
      credentialType: input.credentialType,
      credentialName: input.credentialName.trim(),
      certNo: input.certNo.trim(),
      status: input.status || this.resolveCredentialStatus(input.expiresAt),
      issueAt: input.issueAt,
      expiresAt: input.expiresAt,
      reminderDays: input.reminderDays ?? 30,
      attachments: input.attachments ?? [],
      operator: input.operator || "营运端",
      createdAt: records.find((item) => item.id === input.id)?.createdAt || now,
      updatedAt: now
    };
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.unshift(record);
    }
    this.vehicleCredentialRecords.set(id, records);
    return records;
  }

  async listVehicleOnboardItems(id: string): Promise<VehicleOnboardItemRecord[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listVehicleOnboardItems(id);
    }
    this.findVehicle(id);
    return this.buildVehicleOnboardItems(this.findVehicle(id));
  }

  async saveVehicleOnboardItem(
    id: string,
    input: SaveVehicleOnboardItemRequest
  ): Promise<VehicleOnboardItemRecord[]> {
    if (!input.itemName) {
      throw new BadRequestException("请填写随车物品名称。");
    }
    if (input.actualQuantity < 0 || input.standardQuantity < 0) {
      throw new BadRequestException("随车物品数量不能为负数。");
    }
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.saveVehicleOnboardItem(id, input);
      return this.storeRentalRepository.listVehicleOnboardItems(id);
    }
    const vehicle = this.findVehicle(id);
    const records = this.vehicleOnboardItems.get(id) ?? this.buildVehicleOnboardItems(vehicle);
    const record: VehicleOnboardItemRecord = {
      id: input.id || `item_${randomUUID()}`,
      vehicleId: id,
      category: input.category,
      itemName: input.itemName.trim(),
      standardQuantity: input.standardQuantity,
      actualQuantity: input.actualQuantity,
      status:
        input.status ||
        (input.actualQuantity < input.standardQuantity ? "missing" : "normal"),
      priceAmount: input.priceAmount ?? 0,
      checkedAt: input.checkedAt || new Date().toISOString(),
      operator: input.operator || "营运端",
      remark: input.remark
    };
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.unshift(record);
    }
    this.vehicleOnboardItems.set(id, records);
    return records;
  }

  async advanceVehicleTransferTask(
    id: string,
    input: AdvanceVehicleTransferTaskRequest
  ): Promise<VehicleTransferTaskResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.advanceVehicleTransferTask(id, input);
    }
    const task = this.vehicleTransferTasks.find((item) => item.id === id);
    if (!task) {
      throw new NotFoundException(`Vehicle transfer task ${id} was not found`);
    }
    if (["completed", "cancelled"].includes(task.status)) {
      throw new BadRequestException("调拨任务已结束，不能继续推进。");
    }
    const now = new Date().toISOString();
    const operator = input.operator || "营运端";
    const reason = input.reason || task.reason || "车辆调拨流程推进";

    if (input.action === "approve") {
      task.status = "approved";
      task.approvedAt = now;
      task.items.forEach((item) => {
        if (item.result !== "failed") {
          item.message = "已确认，待出发。";
        }
      });
    } else if (input.action === "depart") {
      if (task.status !== "approved") {
        throw new BadRequestException("调拨任务需先确认后才能登记出发。");
      }
      task.status = "departed";
      task.departedAt = now;
      task.items.forEach((item) => {
        if (item.result !== "failed") {
          item.message = "车辆已出发，等待到达确认。";
        }
      });
    } else if (input.action === "arrive") {
      if (task.status !== "approved" && task.status !== "departed") {
        throw new BadRequestException("调拨任务需先确认后才能登记到达。");
      }
      task.status = "completed";
      task.completedAt = now;
      for (const item of task.items) {
        const vehicle = this.vehicles.find((row) => row.id === item.vehicleId);
        if (!vehicle || item.result === "failed") {
          continue;
        }
        vehicle.currentStoreName = task.targetStoreName;
        vehicle.currentStationName = task.targetStationName;
        vehicle.currentServiceType = task.targetServiceType;
        vehicle.operationStatus = vehicle.enabled ? "idle" : "disabled";
        vehicle.lastOperationAt = now;
        vehicle.lastOperationBy = operator;
        item.result = "completed";
        item.message = "调拨完成";
        this.appendVehicleOperationLog(vehicle, {
          operator,
          action: "车辆调拨到达",
          reason
        });
      }
    } else {
      task.status = "cancelled";
      task.cancelledAt = now;
      task.cancelReason = reason;
      task.items.forEach((item) => {
        if (item.result !== "failed") {
          item.message = "调拨已取消。";
        }
      });
    }

    return {
      task,
      vehicles: this.vehicles.filter((vehicle) =>
        task.items.some((item) => item.vehicleId === vehicle.id)
      )
    };
  }

  async listTboxDevices(): Promise<TboxDeviceSummary[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listTboxDevices();
    }
    this.ensureMemoryFleetRecords();
    return this.tboxDevices;
  }

  async bindTboxDevice(
    id: string,
    input: BindTboxDeviceRequest
  ): Promise<TboxDeviceSummary> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.bindTboxDevice(id, input);
    }
    this.ensureMemoryFleetRecords();
    const device = this.tboxDevices.find((item) => item.id === id);
    if (!device) {
      throw new NotFoundException(`TBox device ${id} was not found`);
    }
    if (input.vehicleId) {
      const vehicle = this.findVehicle(input.vehicleId);
      this.tboxDevices.forEach((item) => {
        if (item.boundVehicleId === vehicle.id) {
          delete item.boundVehicleId;
          delete item.boundPlateNo;
          delete item.boundVehicleGroupName;
          delete item.currentStationName;
        }
      });
      Object.assign(device, {
        boundVehicleId: vehicle.id,
        boundPlateNo: vehicle.licensePlate,
        boundVehicleGroupName: vehicle.vehicleGroupName,
        currentStationName: vehicle.currentStationName,
        onlineStatus: "online" as const,
        lastHeartbeatAt: new Date().toISOString()
      });
      vehicle.cid = device.cid;
    } else {
      delete device.boundVehicleId;
      delete device.boundPlateNo;
      delete device.boundVehicleGroupName;
      delete device.currentStationName;
      device.onlineStatus = "unknown";
    }
    return device;
  }

  async runTboxCommand(
    id: string,
    input: RunTboxCommandRequest
  ): Promise<TboxCommandResult> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.runTboxCommand(id, input);
    }
    this.ensureMemoryFleetRecords();
    const device = this.tboxDevices.find((item) => item.id === id);
    if (!device) {
      throw new NotFoundException(`TBox device ${id} was not found`);
    }
    const success = device.status === "active" && Boolean(device.boundVehicleId);
    const command: TboxCommandRecord = {
      id: `cmd_${randomUUID()}`,
      deviceId: device.id,
      cid: device.cid,
      vehiclePlateNo: device.boundPlateNo,
      command: input.command,
      status: success ? "success" : "failed",
      operator: input.operator || "营运端",
      note: success ? "预留接口模拟成功" : "设备未绑定或未启用",
      createdAt: new Date().toISOString()
    };
    this.tboxCommandRecords.unshift(command);
    device.onlineStatus = success ? "online" : device.onlineStatus;
    device.lastHeartbeatAt = new Date().toISOString();
    device.lastCommandStatus = command.status;
    return {
      device,
      command,
      message: success ? "TBox 预留指令已模拟下发。" : "TBox 指令未执行，设备未绑定或未启用。"
    };
  }

  async listStationCalendar(stationId: string): Promise<StationCalendarDay[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listStationCalendar(stationId);
    }
    this.ensureMemoryFleetRecords();
    this.ensureStationExists(stationId);
    return this.stationCalendarDays.get(stationId) ?? [];
  }

  async saveStationCalendarDay(
    stationId: string,
    input: SaveStationCalendarDayRequest
  ): Promise<StationCalendarDay[]> {
    if (!input.date) {
      throw new BadRequestException("请填写营业日期。");
    }
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.saveStationCalendarDay(stationId, input);
      return this.storeRentalRepository.listStationCalendar(stationId);
    }
    this.ensureMemoryFleetRecords();
    const station = this.ensureStationExists(stationId);
    const records = this.stationCalendarDays.get(stationId) ?? [];
    const date = input.date.slice(0, 10);
    const record: StationCalendarDay = {
      id: `cal_${stationId}_${date}`,
      stationId,
      stationName: station.name,
      date,
      businessStatus: input.businessStatus,
      openTime: input.openTime || "09:00",
      closeTime: input.closeTime || "20:00",
      capacityLimit: input.capacityLimit,
      note: input.note,
      operator: input.operator || "营运端",
      updatedAt: new Date().toISOString()
    };
    const index = records.findIndex((item) => item.date === date);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }
    records.sort((left, right) => left.date.localeCompare(right.date));
    this.stationCalendarDays.set(stationId, records);
    return records;
  }

  async listStationCapacitySnapshots(stationId?: string): Promise<StationCapacitySnapshot[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listStationCapacitySnapshots(stationId);
    }
    this.ensureMemoryFleetRecords();
    return this.stationCapacitySnapshots.filter(
      (item) => !stationId || item.stationId === stationId
    );
  }

  listValueAddedServices() {
    return this.valueAddedServices;
  }

  saveValueAddedService(input: StoreValueAddedServiceSummary) {
    const service: StoreValueAddedServiceSummary = {
      ...input,
      id: input.id || `svc_${randomUUID()}`,
      version: input.version || `SVC-STORE-${Date.now()}`
    };
    const index = this.valueAddedServices.findIndex((item) => item.id === service.id);

    if (index >= 0) {
      this.valueAddedServices[index] = service;
    } else {
      this.valueAddedServices.unshift(service);
    }

    return service;
  }

  async createOrder(
    input: CreateStoreRentalOrderRequest
  ): Promise<CreateStoreRentalOrderResult> {
    const storedQuote = this.quotes.get(input.quoteNo);
    if (storedQuote) {
      const availability = this.checkAvailability({
        mode: StoreRentalMode.Store,
        pickupStoreCode: storedQuote.request.pickupStoreCode,
        returnStoreCode: storedQuote.request.returnStoreCode,
        pickupAt: storedQuote.request.pickupAt,
        returnAt: storedQuote.request.returnAt,
        vehicleGroupCodes: [storedQuote.request.vehicleGroupCode]
      });
      const selectedGroup = availability.groups[0];

      if (!selectedGroup || selectedGroup.availableCount <= 0) {
        throw new BadRequestException("当前车组在所选时间段无可用库存，请更换车组或调整时间。");
      }
    }
    const isMonthly =
      input.billingMode === BillingMode.Monthly || input.collectionMode === "monthly";
    const isDeposit = input.collectionMode === "deposit";
    const member = input.memberId
      ? await this.getMemberForRead(input.memberId)
      : undefined;
    const corporate = input.corporateId
      ? await this.getCorporateForRead(input.corporateId)
      : undefined;

    if (member && member.status !== "active") {
      throw new BadRequestException("当前会员状态不可下单，请先完成审核或解除停用。");
    }
    if (member && (!member.identityVerified || !member.driverLicenseVerified)) {
      throw new BadRequestException("当前会员证件或驾驶证未完成认证，不能创建门市租赁订单。");
    }
    if (corporate && corporate.status !== "active") {
      throw new BadRequestException("当前企业客户不可下单，请先恢复企业状态。");
    }
    if (isMonthly && corporate && corporate.settlementMode !== "monthly") {
      throw new BadRequestException("当前企业未配置月结结算模式。");
    }

    const orderNo = `SR${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${Math.floor(
      Math.random() * 9000 + 1000
    )}`;
    const mainStatus =
      isMonthly || isDeposit ? OrderMainStatus.Reserved : OrderMainStatus.PendingPayment;
    const paymentStatus = isMonthly
      ? PaymentStatus.MonthlyBilling
      : isDeposit
        ? PaymentStatus.DepositPaid
        : PaymentStatus.Unpaid;

    const orderId = `order_${randomUUID()}`;
    const totalAmount =
      storedQuote?.result.monthlySettlementAmount ??
      storedQuote?.result.payableAmount ??
      0;
    if (
      corporate &&
      corporate.creditLimitAmount > 0 &&
      corporate.unpaidAmount + totalAmount > corporate.creditLimitAmount
    ) {
      throw new BadRequestException("企业未回款金额已超过授信额度，不能继续创建月结订单。");
    }
    const vehicleGroupName = storedQuote
      ? this.getVehicleGroupNameByCode(storedQuote.request.vehicleGroupCode)
      : "按报价锁定车组";
    const pickupStoreName = storedQuote
      ? this.getStoreNameByCode(storedQuote.request.pickupStoreCode)
      : "按报价快照";
    const returnStoreName = storedQuote
      ? this.getStoreNameByCode(storedQuote.request.returnStoreCode)
      : "按报价快照";
    const pickupAt = storedQuote?.request.pickupAt ?? new Date().toISOString();
    const returnAt =
      storedQuote?.request.returnAt ?? new Date(Date.now() + 86_400_000).toISOString();
    const customerName = member?.name ?? input.customerName;
    const customerPhoneMasked = member?.phoneMasked ?? this.maskPhone(input.customerPhone);
    const corporateShortName = corporate?.shortName ?? input.corporateShortName;
    const riskFlags = [
      "新建订单",
      input.quoteNo,
      ...(storedQuote?.result.selectedMarketingPlan
        ? [`行销:${storedQuote.result.selectedMarketingPlan.displayName}`]
        : []),
      ...(storedQuote?.result.warnings ?? [])
    ];

    const order: StoreRentalOrderSummary = {
      id: orderId,
      orderNo,
      mode: StoreRentalMode.Store,
      memberId: member?.id,
      corporateId: corporate?.id,
      customerName,
      customerPhoneMasked,
      corporateShortName,
      vehicleGroupName,
      pickupStoreName,
      returnStoreName,
      pickupAt,
      returnAt,
      totalAmount,
      billingMode: input.billingMode,
      mainStatus,
      dispatchStatus: DispatchStatus.Pending,
      paymentStatus,
      riskFlags
    };

    const timeline: StoreRentalOrderTimelineItem[] = [
      {
        at: new Date().toISOString(),
        actor: "系统",
        action: `创建订单，状态进入${mainStatus === OrderMainStatus.Reserved ? "已预订" : "待支付"}`
      },
      {
        at: new Date().toISOString(),
        actor: "规则引擎",
        action: `锁定价格快照 ${storedQuote?.result.snapshots.pricingVersion ?? "unknown"}、行销快照 ${storedQuote?.result.snapshots.marketingPlanVersionId ?? "none"} 与规则快照 ${this.ruleConfig.version}`
      },
      {
        at: new Date().toISOString(),
        actor: "库存引擎",
        action: "完成所选时间段资源可用性校验并占用库存"
      }
    ];

    if (this.useMysqlDataSource()) {
      const settlementSummary = this.defaultSettlementSummary(order);
      this.settlementSummaries.set(order.id, settlementSummary);
      const feeLedgerItems = this.buildFeeLedgerItems(order);
      const transactionRecords = this.buildTransactionRecords(order);
      const snapshots =
        storedQuote?.result.snapshots ?? {
          pricingVersion: "unknown",
          priceVersionId: "unknown",
          ruleVersion: this.ruleConfig.version,
          vehicleGroupCode: "unknown",
          pickupStoreCode: "unknown",
          returnStoreCode: "unknown",
          baseDailyAmount: 0
        };
      const marketingSnapshot = storedQuote?.result.selectedMarketingPlan
        ? JSON.parse(
            JSON.stringify({
              ...storedQuote.result.selectedMarketingPlan,
              discountAmount: storedQuote.result.discountAmount,
              billingSegments: storedQuote.result.billingSegments,
              explanationLines: storedQuote.result.explanationLines
            })
          )
        : undefined;

      await this.storeRentalRepository.createOrder({
        order,
        vehicleGroupCode: storedQuote?.request.vehicleGroupCode,
        pickupStoreCode: storedQuote?.request.pickupStoreCode,
        returnStoreCode: storedQuote?.request.returnStoreCode,
        pricingSnapshot: snapshots,
        marketingSnapshot,
        termsSnapshot: {
          ruleVersion: this.ruleConfig.version,
          termsVersion: "store-rental-terms-v2026.04.28"
        },
        settlementSummary,
        feeLedgerItems,
        transactionRecords,
        timeline
      });

      if (member) {
        await this.storeRentalRepository.recordMemberOrderCreated(member.id, orderNo);
      }
      if (corporate) {
        await this.storeRentalRepository.recordCorporateOrderCreated(corporate.id);
      }

      return {
        id: orderId,
        orderNo,
        quoteNo: input.quoteNo,
        mainStatus,
        paymentStatus,
        dispatchStatus: DispatchStatus.Pending,
        totalAmount,
        message: `已基于报价 ${input.quoteNo} 创建订单，并写入规则/价格快照。`,
        snapshots
      };
    }

    this.orders.unshift(order);

    if (member && this.useMysqlDataSource()) {
      await this.storeRentalRepository.recordMemberOrderCreated(member.id, orderNo);
    } else if (member) {
      member.recentOrderNos = [orderNo, ...member.recentOrderNos.filter((item) => item !== orderNo)].slice(0, 10);
      member.totalOrders += 1;
      member.timeline.unshift({
        id: `member_order_${randomUUID()}`,
        at: new Date().toISOString(),
        operator: "营运端下单",
        action: "创建门市租赁订单",
        remark: orderNo
      });
    }

    if (corporate && this.useMysqlDataSource()) {
      await this.storeRentalRepository.recordCorporateOrderCreated(corporate.id);
    } else if (corporate) {
      corporate.recentOrderNos = [
        orderNo,
        ...corporate.recentOrderNos.filter((item) => item !== orderNo)
      ].slice(0, 10);
      corporate.activeOrderCount += 1;
    }

    this.orderTimelines.set(orderId, timeline);

    return {
      id: orderId,
      orderNo,
      quoteNo: input.quoteNo,
      mainStatus,
      paymentStatus,
      dispatchStatus: DispatchStatus.Pending,
      totalAmount,
      message: `已基于报价 ${input.quoteNo} 创建模拟订单，并写入规则/价格快照。`,
      snapshots:
        storedQuote?.result.snapshots ?? {
          pricingVersion: "unknown",
          priceVersionId: "unknown",
          ruleVersion: this.ruleConfig.version,
          vehicleGroupCode: "unknown",
          pickupStoreCode: "unknown",
          returnStoreCode: "unknown",
          baseDailyAmount: 0
        }
    };
  }

  listOrders(filter: OrderFilter) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listOrders(filter);
    }

    const keyword = filter.keyword?.trim().toLowerCase();
    const status = filter.status?.trim();

    return this.orders.filter((order) => {
      const matchedKeyword =
        !keyword ||
        order.orderNo.toLowerCase().includes(keyword) ||
        order.customerName.toLowerCase().includes(keyword) ||
        order.vehicleGroupName.toLowerCase().includes(keyword);
      const matchedStatus = !status || order.mainStatus === status;

      return matchedKeyword && matchedStatus;
    });
  }

  getOrderDetail(id: string): StoreRentalOrderDetail | Promise<StoreRentalOrderDetail> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getOrderDetail(id);
    }

    const order = this.findOrder(id);

    return {
      ...order,
      timeline: this.orderTimelines.get(order.id) ?? this.defaultTimeline(order),
      feeItems: this.buildFeeItems(order),
      feeLedgerItems: this.buildFeeLedgerItems(order),
      transactionRecords: this.buildTransactionRecords(order),
      contracts: this.orderContracts.get(order.id) ?? [],
      notifications: this.orderNotifications.get(order.id) ?? [],
      remarks: this.orderRemarks.get(order.id) ?? [],
      operationLocks: this.orderOperationLocks.get(order.id) ?? [],
      idempotencyRecords: this.orderIdempotencyRecords.get(order.id) ?? [],
      financialOverview: this.buildFinancialOverview(order),
      inspectionRecords: this.inspectionRecords.get(order.id) ?? [],
      settlementSummary:
        this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order),
      snapshots: {
        vehicleGroup: order.vehicleGroupName,
        pickupStore: order.pickupStoreName,
        returnStore: order.returnStoreName,
        pricingVersion: this.pricingPlans[0].version,
        priceVersionId: this.pricingPlans[0].version,
        termsVersion: "store-rental-terms-v2026.04.28",
        events: this.orderEventSnapshots.get(order.id) ?? []
      }
    };
  }

  getOrderFeeCenter(id: string) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getOrderFeeCenter(id);
    }

    const order = this.findOrder(id);

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      feeLedgerItems: this.buildFeeLedgerItems(order),
      transactionRecords: this.buildTransactionRecords(order),
      financialOverview: this.buildFinancialOverview(order)
    };
  }

  getOrderFulfillmentRecords(
    id: string
  ): StoreRentalOrderFulfillmentRecords | Promise<StoreRentalOrderFulfillmentRecords> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getOrderFulfillmentRecords(id);
    }

    this.findOrder(id);

    return this.memoryFulfillmentRecords(id);
  }

  async createOrderContract(
    id: string,
    input: CreateStoreRentalContractRequest
  ): Promise<StoreRentalContractRecord> {
    if (!input.operator) {
      throw new BadRequestException("合同/单据记录必须填写操作人。");
    }
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const record = await this.storeRentalRepository.createOrderContractRecord(
        order.id,
        input
      );
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator,
        action: `登记单据：${record.title} / ${this.contractStatusLabel(record.status)}`
      });

      return record;
    }

    const order = this.findOrder(id);
    const now = new Date().toISOString();
    const record: StoreRentalContractRecord = {
      id: `contract_${randomUUID()}`,
      documentNo: `DOC-${now.slice(0, 10).replaceAll("-", "")}-${Math.floor(
        Math.random() * 9000 + 1000
      )}`,
      type: input.type,
      title: input.title || this.contractTypeLabel(input.type),
      status: input.status || "signed",
      signMethod: input.signMethod || "counter",
      signerName: input.signerName,
      signedAt: input.signedAt,
      fileUrl: input.fileUrl,
      operator: input.operator,
      createdAt: now,
      snapshot: input.snapshot ?? this.orderFulfillmentSnapshot(order)
    };
    this.prependMemoryRecord(this.orderContracts, order.id, record);
    this.appendOrderTimeline(
      order,
      input.operator,
      `登记单据：${record.title} / ${this.contractStatusLabel(record.status)}`
    );

    return record;
  }

  async createOrderNotification(
    id: string,
    input: CreateStoreRentalNotificationRequest
  ): Promise<StoreRentalNotificationRecord> {
    if (!input.target || !input.content) {
      throw new BadRequestException("通知必须填写接收对象和内容。");
    }
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const record = await this.storeRentalRepository.createOrderNotificationRecord(
        order.id,
        input
      );
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator || "营运端",
        action: `客户通知：${this.notificationSceneLabel(record.scene)} / ${record.channel} / ${record.status}`
      });

      return record;
    }

    const order = this.findOrder(id);
    const now = new Date().toISOString();
    const record: StoreRentalNotificationRecord = {
      id: `notice_${randomUUID()}`,
      scene: input.scene,
      channel: input.channel,
      target: input.target,
      status: input.status || "sent",
      content: input.content,
      idempotencyKey: input.idempotencyKey,
      operator: input.operator || "营运端",
      sentAt: input.status === "failed" || input.status === "skipped" ? undefined : now,
      createdAt: now,
      payload: input.payload ?? this.orderFulfillmentSnapshot(order)
    };
    this.prependMemoryRecord(this.orderNotifications, order.id, record);
    this.appendOrderTimeline(
      order,
      record.operator,
      `客户通知：${this.notificationSceneLabel(record.scene)} / ${record.channel} / ${record.status}`
    );

    return record;
  }

  async createOrderRemark(
    id: string,
    input: CreateStoreRentalRemarkRequest
  ): Promise<StoreRentalOrderRemarkRecord> {
    if (!input.content?.trim()) {
      throw new BadRequestException("订单备注不能为空。");
    }
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const record = await this.storeRentalRepository.createOrderRemarkRecord(
        order.id,
        input
      );
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator || "营运端",
        action: `订单备注：${this.remarkCategoryLabel(record.category)}`
      });

      return record;
    }

    const order = this.findOrder(id);
    const record: StoreRentalOrderRemarkRecord = {
      id: `remark_${randomUUID()}`,
      category: input.category || "general",
      content: input.content.trim(),
      visibility: input.visibility || "internal",
      operator: input.operator || "营运端",
      followUpAt: input.followUpAt,
      status: input.status || "open",
      createdAt: new Date().toISOString()
    };
    this.prependMemoryRecord(this.orderRemarks, order.id, record);
    this.appendOrderTimeline(
      order,
      record.operator,
      `订单备注：${this.remarkCategoryLabel(record.category)}`
    );

    return record;
  }

  async createOrderOperationLock(
    id: string,
    input: CreateStoreRentalOperationLockRequest
  ): Promise<StoreRentalOperationLockRecord> {
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      return this.storeRentalRepository.createOrderOperationLockRecord(order.id, input);
    }

    const order = this.findOrder(id);
    const now = new Date().toISOString();
    const record: StoreRentalOperationLockRecord = {
      id: `lock_${randomUUID()}`,
      stage: input.stage,
      status: input.status || OperationLockStatus.Active,
      operator: input.operator || "营运端",
      startedAt: now,
      expiresAt: input.expiresAt,
      releasedAt: input.releasedAt,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {}
    };
    this.prependMemoryRecord(this.orderOperationLocks, order.id, record);

    return record;
  }

  async createOrderFee(id: string, input: CreateStoreRentalFeeRequest) {
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const amount = this.positiveAmount(input.amount, "费用金额必须大于 0");
      const fee: StoreRentalFeeLedgerItem = this.feeLedgerItem({
        id: `fee_${randomUUID()}`,
        code: input.code || "MANUAL_FEE",
        name: input.name,
        stage: input.stage,
        source: "manual",
        direction: input.direction,
        status: order.billingMode === BillingMode.Monthly ? "monthly_billing" : "pending",
        amount,
        description: input.description,
        snapshotRef: `manual:${order.orderNo}:${Date.now()}`,
        createdAt: new Date().toISOString()
      });

      await this.storeRentalRepository.upsertOrderFeeItem(order.id, fee);
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator || "门店营运",
        action: `新增费用：${fee.name} ${fee.amount}`
      });

      if (order.billingMode === BillingMode.Monthly) {
        await this.storeRentalRepository.createOrderTransaction(order.id, {
          id: `txn_${randomUUID()}`,
          type: "monthly_bill",
          channel: "internal",
          amount: fee.amount,
          status: this.canPostMonthlyBill(order.mainStatus) ? "success" : "pending",
          at: new Date().toISOString(),
          operator: input.operator || "企业月结",
          relatedFeeIds: [fee.id],
          note: `人工费用进入企业月结：${fee.name}`
        });
      }

      return this.storeRentalRepository.getOrderFeeCenter(order.id);
    }

    const order = this.findOrder(id);
    const amount = this.positiveAmount(input.amount, "费用金额必须大于 0");
    const fee: StoreRentalFeeLedgerItem = this.feeLedgerItem({
      id: `fee_${randomUUID()}`,
      code: input.code || "MANUAL_FEE",
      name: input.name,
      stage: input.stage,
      source: "manual",
      direction: input.direction,
      status: order.billingMode === BillingMode.Monthly ? "monthly_billing" : "pending",
      amount,
      description: input.description,
      snapshotRef: `manual:${order.orderNo}:${Date.now()}`,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);
    this.appendOrderTimeline(
      order,
      input.operator || "门店营运",
      `新增费用：${fee.name} ${fee.amount}`
    );

    if (order.billingMode === BillingMode.Monthly) {
      this.persistTransaction(order.id, {
        type: "monthly_bill",
        channel: "internal",
        amount: fee.amount,
        operator: input.operator || "企业月结 mock",
        relatedFeeIds: [fee.id],
        note: `人工费用进入企业月结：${fee.name}`
      });
    }

    return this.getOrderFeeCenter(order.id);
  }

  async waiveOrderFee(
    id: string,
    feeId: string,
    input: WaiveStoreRentalFeeRequest
  ) {
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const fee = order.feeLedgerItems.find((item) => item.id === feeId);
      if (!fee) {
        throw new NotFoundException(`Fee ${feeId} was not found in order ${order.orderNo}`);
      }

      const amount = this.positiveAmount(input.amount, "减免金额必须大于 0");
      if (amount > fee.amount) {
        throw new BadRequestException("减免金额不能大于费用金额。");
      }

      await this.storeRentalRepository.createOrderTransaction(order.id, {
        id: `txn_${randomUUID()}`,
        type: "waiver",
        channel: "internal",
        amount,
        status: "success",
        at: new Date().toISOString(),
        operator: input.operator || "门店营运",
        relatedFeeIds: [fee.id],
        note: input.reason || `费用减免：${fee.name}`
      });
      await this.storeRentalRepository.updateOrderFeeStatus(order.id, fee.id, "waived");

      if (fee.stage === "return_settlement") {
        this.settlementSummaries.set(order.id, order.settlementSummary);
        const settlement = this.mergeSettlementSummary(order, {
          discountAmount: order.settlementSummary.discountAmount + amount,
          returnTransactionTotal: order.settlementSummary.returnTransactionTotal + amount
        });
        await this.storeRentalRepository.saveSettlementSummary(order.id, settlement);
      }

      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator || "门店营运",
        action: `费用减免：${fee.name} ${amount}`
      });

      return this.storeRentalRepository.getOrderFeeCenter(order.id);
    }

    const order = this.findOrder(id);
    const fee = this.findFeeLedgerItem(order, feeId);
    const amount = this.positiveAmount(input.amount, "减免金额必须大于 0");
    if (amount > fee.amount) {
      throw new BadRequestException("减免金额不能大于费用金额。");
    }

    this.persistTransaction(order.id, {
      type: "waiver",
      channel: "internal",
      amount,
      operator: input.operator || "门店营运",
      relatedFeeIds: [fee.id],
      note: input.reason || `费用减免：${fee.name}`
    });
    this.updateManualFeeStatus(order.id, fee.id, "waived");

    if (fee.stage === "return_settlement") {
      const settlement =
        this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
      this.settlementSummaries.set(
        order.id,
        this.mergeSettlementSummary(order, {
          discountAmount: settlement.discountAmount + amount,
          returnTransactionTotal: settlement.returnTransactionTotal + amount
        })
      );
    }

    this.appendOrderTimeline(
      order,
      input.operator || "门店营运",
      `费用减免：${fee.name} ${amount}`
    );

    return this.getOrderFeeCenter(order.id);
  }

  async createOrderTransaction(
    id: string,
    input: CreateStoreRentalTransactionRequest
  ) {
    if (this.useMysqlDataSource()) {
      const order = await this.storeRentalRepository.getOrderDetail(id);
      const amount = this.positiveAmount(input.amount, "资金金额必须大于 0");
      const record: StoreRentalTransactionRecord = {
        id: `txn_${randomUUID()}`,
        type: input.type,
        channel: input.channel,
        amount,
        status: "success",
        at: new Date().toISOString(),
        operator: input.operator || "门店营运",
        relatedFeeIds: input.relatedFeeIds ?? [],
        note: input.note
      };

      this.settlementSummaries.set(order.id, order.settlementSummary);
      await this.storeRentalRepository.createOrderTransaction(order.id, record);
      const previousStatus = order.mainStatus;
      this.applyTransactionToOrder(order, record);
      const nextSettlement =
        this.settlementSummaries.get(order.id) ?? order.settlementSummary;
      if (
        previousStatus !== order.mainStatus &&
        order.mainStatus === OrderMainStatus.Completed
      ) {
        await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
          order.plateNo,
          this.completedVehicleStatus(nextSettlement),
          {
            operator: input.operator || "门店营运",
            action: this.transactionLabel(input.type),
            reason: `订单 ${order.orderNo} ${this.transactionLabel(input.type)}完成`
          }
        );
      }
      await this.storeRentalRepository.updateOrderState(
        order,
        nextSettlement
      );
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator || "门店营运",
        action: `${this.transactionLabel(input.type)}：${amount}`
      });

      return this.storeRentalRepository.getOrderFeeCenter(order.id);
    }

    const order = this.findOrder(id);
    const amount = this.positiveAmount(input.amount, "资金金额必须大于 0");
    const record = this.persistTransaction(order.id, {
      type: input.type,
      channel: input.channel,
      amount,
      operator: input.operator || "门店营运",
      relatedFeeIds: input.relatedFeeIds ?? [],
      note: input.note
    });

    this.applyTransactionToOrder(order, record);
    this.appendOrderTimeline(
      order,
      input.operator || "门店营运",
      `${this.transactionLabel(input.type)}：${amount}`
    );

    return this.getOrderFeeCenter(order.id);
  }

  async runOrderAction(
    id: string,
    action: string,
    body: Record<string, unknown>
  ): Promise<StoreRentalOrderActionResult> {
    if (this.useMysqlDataSource()) {
      return this.runMysqlOrderAction(id, action, body);
    }

    const order = this.findOrder(id);
    const replayed = await this.replayOrderActionByIdempotency(order.id, action, body);
    if (replayed) {
      return replayed;
    }
    const previousStatus = order.mainStatus;
    const knownAction = [
      "payment-success",
      "start-pickup",
      "pickup-inspection",
      "extend-rental",
      "redirect-order",
      "change-return-store",
      "change-return-station",
      "return-inspection",
      "confirm-settlement",
      "register-accident",
      "release-operation-lock",
      "mark-no-show",
      "reject-order",
      "close-order",
      "cancel"
    ].includes(action);
    let actionTimelineDetail: string | undefined;
    let resultMessage: string | undefined;
    const operationContext = knownAction
      ? await this.beginOrderOperation(order, action, body)
      : undefined;

    if (operationContext?.duplicateResult) {
      return operationContext.duplicateResult;
    }

    if (knownAction) {
      this.ensureActionAllowed(order, action);
      this.ensureOrderOperationLock(order, action, body);
    }

    switch (action) {
      case "payment-success":
        order.mainStatus = OrderMainStatus.Reserved;
        order.paymentStatus = PaymentStatus.DepositPaid;
        order.dispatchStatus = DispatchStatus.PreAssigned;
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["已预授权", "待取车"]);
        break;
      case "start-pickup":
        order.mainStatus = OrderMainStatus.Inspecting;
        order.operationLockStatus = OperationLockStatus.Active;
        order.operationLockOperator = String(body.operator ?? "门店营运");
        order.operationLockExpiresAt = new Date(
          Date.now() + this.ruleConfig.pickupReturn.operationLockMinutes * 60_000
        ).toISOString();
        order.riskFlags = this.uniqueFlags(
          order.riskFlags.filter((flag) => flag !== "待取车"),
          ["取车中", "操作锁有效"]
        );
        break;
      case "pickup-inspection":
        this.validatePickupCompletion(order, body);
        order.mainStatus = OrderMainStatus.Renting;
        order.paymentStatus =
          order.paymentStatus === PaymentStatus.Unpaid
            ? PaymentStatus.DepositPaid
            : order.paymentStatus;
        order.dispatchStatus = DispatchStatus.Locked;
        order.operationLockStatus = OperationLockStatus.Released;
        delete order.operationLockExpiresAt;
        order.plateNo =
          this.optionalString(body.plateNo) ||
          order.plateNo ||
          this.findAssignablePlate(order.vehicleGroupName);
        this.updateVehicleOperationStatus(order.plateNo, "renting");
        order.riskFlags = this.uniqueFlags(
          order.riskFlags.filter((flag) => flag !== "操作锁有效"),
          ["已验车", "租赁中"]
        );
        this.appendInspectionRecord(order.id, {
          stage: "pickup",
          operator: String(body.operator ?? "门店营运"),
          plateNo: order.plateNo,
          mileage: this.optionalNumber(body.mileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          cleanliness: this.cleanlinessValue(body.cleanliness),
          damageFound: Boolean(body.damageFound),
          damageDescription: this.optionalString(body.damageDescription),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false,
          memo: this.optionalString(body.memo)
        });
        break;
      case "extend-rental":
        {
          const result = this.extendRental(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "redirect-order":
        {
          const result = this.redirectOrder(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "change-return-store":
        {
          const result = this.changeReturnLocation(
            order,
            body,
            previousStatus,
            "store",
            this.stations,
            this.orders,
            this.vehicles,
            this.vehicleGroupMasters
          );
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "change-return-station":
        {
          const result = this.changeReturnLocation(
            order,
            body,
            previousStatus,
            "station",
            this.stations,
            this.orders,
            this.vehicles,
            this.vehicleGroupMasters
          );
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "return-inspection":
        this.validateReturnInspection(order, body);
        order.mainStatus = OrderMainStatus.SettlementPending;
        order.dispatchStatus = DispatchStatus.Locked;
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["还车已验车", "待结算"]);
        this.appendInspectionRecord(order.id, {
          stage: "return",
          operator: String(body.operator ?? "门店营运"),
          plateNo: order.plateNo,
          mileage: this.optionalNumber(body.returnMileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          cleanliness: this.cleanlinessValue(body.cleanliness),
          damageFound: Boolean(body.damageFound),
          damageDescription: this.optionalString(body.damageDescription),
          missingItems: this.optionalString(body.missingItems),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false,
          memo: this.optionalString(body.memo)
        });
        this.settlementSummaries.set(
          order.id,
          this.mergeSettlementSummary(order, {
            overtimeFeeAmount: this.optionalNumber(body.overtimeFeeAmount) ?? 0,
            damageFeeAmount: this.optionalNumber(body.damageFeeAmount) ?? 0,
            cleaningFeeAmount: this.optionalNumber(body.cleaningFeeAmount) ?? 0,
            discountAmount: this.optionalNumber(body.discountAmount) ?? 0,
            finalReceivableAmount: this.optionalNumber(body.finalReceivableAmount),
            returnTransactionTotal: this.optionalNumber(body.returnTransactionTotal) ?? 0
          })
        );
        this.updateVehicleOperationStatus(order.plateNo, "controlled");
        break;
      case "confirm-settlement":
        {
          const settlementPatch = {
            overtimeFeeAmount: this.optionalNumber(body.overtimeFeeAmount),
            damageFeeAmount: this.optionalNumber(body.damageFeeAmount),
            cleaningFeeAmount: this.optionalNumber(body.cleaningFeeAmount),
            discountAmount: this.optionalNumber(body.discountAmount),
            finalReceivableAmount: this.optionalNumber(body.finalReceivableAmount),
            returnTransactionTotal: this.optionalNumber(body.returnTransactionTotal),
            monthlyBillingPosted:
              order.billingMode === BillingMode.Monthly ||
              Boolean(body.monthlyBillingPosted)
          };
          let settlement = this.mergeSettlementSummary(order, settlementPatch);

          if (
            order.mainStatus === OrderMainStatus.PaymentDue ||
            order.mainStatus === OrderMainStatus.RefundPending
          ) {
            settlement = this.mergeSettlementSummary(order, {
              ...settlementPatch,
              returnTransactionTotal: settlement.returnFeeTotal
            });
          }

          this.settlementSummaries.set(order.id, settlement);

          if (order.billingMode === BillingMode.Monthly) {
            order.mainStatus = OrderMainStatus.Completed;
            order.paymentStatus = PaymentStatus.MonthlyBilling;
            this.updateVehicleOperationStatus(
              order.plateNo,
              this.completedVehicleStatus(settlement)
            );
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["企业月结已挂账", "已结算"]
            );
          } else if (settlement.balanceDue > 0) {
            order.mainStatus = OrderMainStatus.PaymentDue;
            order.paymentStatus = PaymentStatus.PaymentDue;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["待补缴"]
            );
          } else if (settlement.balanceDue < 0) {
            order.mainStatus = OrderMainStatus.RefundPending;
            order.paymentStatus = PaymentStatus.RefundPending;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["待退款"]
            );
          } else {
            order.mainStatus = OrderMainStatus.Completed;
            order.paymentStatus = PaymentStatus.Paid;
            this.updateVehicleOperationStatus(
              order.plateNo,
              this.completedVehicleStatus(settlement)
            );
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter(
                (flag) => !["待结算", "待补缴", "待退款"].includes(flag)
              ),
              ["已结算"]
            );
          }
        }
        break;
      case "register-accident":
        {
          const result = this.registerOrderAccident(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "release-operation-lock":
        {
          const result = this.releaseOperationLock(order, body);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "mark-no-show":
        {
          const result = this.markOrderNoShow(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "reject-order":
        {
          const result = this.rejectOrder(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "close-order":
        {
          const result = this.closeOrder(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      case "cancel":
        {
          const result = this.cancelOrder(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
        }
        break;
      default:
        break;
    }

    const timeline = this.orderTimelines.get(order.id) ?? this.defaultTimeline(order);
    timeline.push({
      at: new Date().toISOString(),
      actor: String(body.operator ?? "门店营运"),
      action:
        actionTimelineDetail ??
        `${this.actionLabel(action)}：${previousStatus} -> ${order.mainStatus}${this.actionMemo(body)}`
    });
    this.orderTimelines.set(order.id, timeline);

    const result: StoreRentalOrderActionResult = {
      orderId: order.id,
      orderNo: order.orderNo,
      action,
      received: body,
      result: knownAction ? "updated" : "mocked",
      message: resultMessage ?? (knownAction
        ? "订单状态已按 MVP 内置状态机推进，外部系统调用仍为模拟。"
        : "MVP 阶段已跳过外部系统调用，仅记录模拟操作结果。"),
      nextStatus: order.mainStatus,
      nextPaymentStatus: order.paymentStatus,
      nextDispatchStatus: order.dispatchStatus,
      nextRecommendedActions: ["刷新订单", "查看操作记录", "继续结算流程"]
    };
    await this.recordOrderActionFulfillmentSideEffects(
      order,
      action,
      body,
      previousStatus
    );
    await this.saveOrderActionIdempotencyResult(order.id, action, body, result);

    if (operationContext?.record) {
      await this.completeOrderOperation(operationContext.record, result, order);
      await this.recordOrderNotificationForAction(order, action, body, result);
    }

    return result;
  }

  private async runMysqlOrderAction(
    id: string,
    action: string,
    body: Record<string, unknown>
  ): Promise<StoreRentalOrderActionResult> {
    const order = await this.storeRentalRepository.getOrderDetail(id);
    const replayed = await this.replayOrderActionByIdempotency(order.id, action, body);
    if (replayed) {
      return replayed;
    }
    const previousStatus = order.mainStatus;
    const knownAction = [
      "payment-success",
      "start-pickup",
      "pickup-inspection",
      "extend-rental",
      "redirect-order",
      "change-return-store",
      "change-return-station",
      "return-inspection",
      "confirm-settlement",
      "register-accident",
      "release-operation-lock",
      "mark-no-show",
      "reject-order",
      "close-order",
      "cancel"
    ].includes(action);
    let actionTimelineDetail: string | undefined;
    let resultMessage: string | undefined;
    let settlementToSave: StoreRentalSettlementSummary | undefined;
    const operationContext = knownAction
      ? await this.beginOrderOperation(order, action, body)
      : undefined;

    if (operationContext?.duplicateResult) {
      return operationContext.duplicateResult;
    }

    if (knownAction) {
      this.ensureActionAllowed(order, action);
      this.ensureOrderOperationLock(order, action, body);
    }

    this.settlementSummaries.set(order.id, order.settlementSummary);

    switch (action) {
      case "payment-success":
        order.mainStatus = OrderMainStatus.Reserved;
        order.paymentStatus = PaymentStatus.DepositPaid;
        order.dispatchStatus = DispatchStatus.PreAssigned;
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["已预授权", "待取车"]);
        break;
      case "start-pickup":
        order.mainStatus = OrderMainStatus.Inspecting;
        order.operationLockStatus = OperationLockStatus.Active;
        order.operationLockOperator = String(body.operator ?? "门店营运");
        order.operationLockExpiresAt = new Date(
          Date.now() + this.ruleConfig.pickupReturn.operationLockMinutes * 60_000
        ).toISOString();
        order.riskFlags = this.uniqueFlags(
          order.riskFlags.filter((flag) => flag !== "待取车"),
          ["取车中", "操作锁有效"]
        );
        break;
      case "pickup-inspection":
        {
          this.validatePickupCompletion(order, body);
          const plateNo = this.optionalString(body.plateNo) || order.plateNo;
          if (!plateNo || plateNo === "待人工派车") {
            throw new BadRequestException("取车验车必须录入实际车牌。");
          }
          order.mainStatus = OrderMainStatus.Renting;
          order.paymentStatus =
            order.paymentStatus === PaymentStatus.Unpaid
              ? PaymentStatus.DepositPaid
              : order.paymentStatus;
          order.dispatchStatus = DispatchStatus.Locked;
          order.operationLockStatus = OperationLockStatus.Released;
          delete order.operationLockExpiresAt;
          order.plateNo = plateNo;
          order.riskFlags = this.uniqueFlags(
            order.riskFlags.filter((flag) => flag !== "操作锁有效"),
            ["已验车", "租赁中"]
          );
          await this.storeRentalRepository.appendInspectionRecord(order.id, {
            id: `inspection_${randomUUID()}`,
            at: new Date().toISOString(),
            stage: "pickup",
            operator: String(body.operator ?? "门店营运"),
            plateNo: order.plateNo,
            mileage: this.optionalNumber(body.mileage),
            fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
            batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
            cleanliness: this.cleanlinessValue(body.cleanliness),
            damageFound: Boolean(body.damageFound),
            damageDescription: this.optionalString(body.damageDescription),
            photoCount: this.optionalNumber(body.photoCount) ?? 0,
            customerSigned: body.customerSigned !== false,
            memo: this.optionalString(body.memo)
          });
          await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
            order.plateNo,
            "renting",
            {
              operator: String(body.operator ?? "门店营运"),
              action: "确认发车",
              reason: `订单 ${order.orderNo} 已取车`
            }
          );
        }
        break;
      case "return-inspection":
        this.validateReturnInspection(order, body);
        order.mainStatus = OrderMainStatus.SettlementPending;
        order.dispatchStatus = DispatchStatus.Locked;
        order.riskFlags = this.uniqueFlags(order.riskFlags, ["还车已验车", "待结算"]);
        await this.storeRentalRepository.appendInspectionRecord(order.id, {
          id: `inspection_${randomUUID()}`,
          at: new Date().toISOString(),
          stage: "return",
          operator: String(body.operator ?? "门店营运"),
          plateNo: order.plateNo,
          mileage: this.optionalNumber(body.returnMileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          cleanliness: this.cleanlinessValue(body.cleanliness),
          damageFound: Boolean(body.damageFound),
          damageDescription: this.optionalString(body.damageDescription),
          missingItems: this.optionalString(body.missingItems),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false,
          memo: this.optionalString(body.memo)
        });
        await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
          order.plateNo,
          "controlled",
          {
            operator: String(body.operator ?? "门店营运"),
            action: "还车验车完成",
            reason: `订单 ${order.orderNo} 已还车，待结算`
          }
        );
        settlementToSave = this.mergeSettlementSummary(order, {
          overtimeFeeAmount: this.optionalNumber(body.overtimeFeeAmount) ?? 0,
          damageFeeAmount: this.optionalNumber(body.damageFeeAmount) ?? 0,
          cleaningFeeAmount: this.optionalNumber(body.cleaningFeeAmount) ?? 0,
          discountAmount: this.optionalNumber(body.discountAmount) ?? 0,
          finalReceivableAmount: this.optionalNumber(body.finalReceivableAmount),
          returnTransactionTotal: this.optionalNumber(body.returnTransactionTotal) ?? 0
        });
        this.settlementSummaries.set(order.id, settlementToSave);
        break;
      case "extend-rental":
        {
          const result = await this.runMysqlExtensionAction(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      case "redirect-order":
        {
          const result = await this.runMysqlRedirectionAction(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      case "change-return-store":
        {
          const result = await this.runMysqlReturnLocationChangeAction(
            order,
            body,
            previousStatus,
            "store"
          );
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      case "change-return-station":
        {
          const result = await this.runMysqlReturnLocationChangeAction(
            order,
            body,
            previousStatus,
            "station"
          );
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      case "confirm-settlement":
        {
          const settlementPatch = {
            overtimeFeeAmount: this.optionalNumber(body.overtimeFeeAmount),
            damageFeeAmount: this.optionalNumber(body.damageFeeAmount),
            cleaningFeeAmount: this.optionalNumber(body.cleaningFeeAmount),
            discountAmount: this.optionalNumber(body.discountAmount),
            finalReceivableAmount: this.optionalNumber(body.finalReceivableAmount),
            returnTransactionTotal: this.optionalNumber(body.returnTransactionTotal),
            monthlyBillingPosted:
              order.billingMode === BillingMode.Monthly ||
              Boolean(body.monthlyBillingPosted)
          };
          let settlement = this.mergeSettlementSummary(order, settlementPatch);

          if (
            order.mainStatus === OrderMainStatus.PaymentDue ||
            order.mainStatus === OrderMainStatus.RefundPending
          ) {
            settlement = this.mergeSettlementSummary(order, {
              ...settlementPatch,
              returnTransactionTotal: settlement.returnFeeTotal
            });
          }

          settlementToSave = settlement;
          this.settlementSummaries.set(order.id, settlement);

          if (order.billingMode === BillingMode.Monthly) {
            order.mainStatus = OrderMainStatus.Completed;
            order.paymentStatus = PaymentStatus.MonthlyBilling;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["企业月结已挂账", "已结算"]
            );
            if (settlement.monthlyBillAmount > 0) {
              await this.storeRentalRepository.createOrderTransaction(order.id, {
                id: `${order.id}_monthly_bill`,
                type: "monthly_bill",
                channel: "internal",
                amount: settlement.monthlyBillAmount,
                status: "success",
                at: new Date().toISOString(),
                operator: String(body.operator ?? "企业月结"),
                relatedFeeIds: order.feeLedgerItems
                  .filter((item) => item.status === "monthly_billing")
                  .map((item) => item.id),
                note: "企业月结订单完单后挂账。"
              });
            }
            await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
              order.plateNo,
              this.completedVehicleStatus(settlement),
              {
                operator: String(body.operator ?? "企业月结"),
                action: "结算确认",
                reason: `订单 ${order.orderNo} 企业月结完成`
              }
            );
          } else if (settlement.balanceDue > 0) {
            order.mainStatus = OrderMainStatus.PaymentDue;
            order.paymentStatus = PaymentStatus.PaymentDue;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["待补缴"]
            );
          } else if (settlement.balanceDue < 0) {
            order.mainStatus = OrderMainStatus.RefundPending;
            order.paymentStatus = PaymentStatus.RefundPending;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter((flag) => flag !== "待结算"),
              ["待退款"]
            );
          } else {
            order.mainStatus = OrderMainStatus.Completed;
            order.paymentStatus = PaymentStatus.Paid;
            order.riskFlags = this.uniqueFlags(
              order.riskFlags.filter(
                (flag) => !["待结算", "待补缴", "待退款"].includes(flag)
              ),
              ["已结算"]
            );
            await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
              order.plateNo,
              this.completedVehicleStatus(settlement),
              {
                operator: String(body.operator ?? "门店营运"),
                action: "结算确认",
                reason: `订单 ${order.orderNo} 已完成结算`
              }
            );
          }
        }
        break;
      case "register-accident":
        {
          const result = await this.runMysqlAccidentAction(order, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      case "release-operation-lock":
        {
          const previousPlateNo = order.plateNo;
          const result = this.releaseOperationLock(order, body);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          if (order.mainStatus === OrderMainStatus.NoShow) {
            await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
              previousPlateNo,
              "idle",
              {
                operator: String(body.operator ?? "营运端"),
                action: "释放取车操作锁",
                reason: `订单 ${order.orderNo} 释放取车锁后判定爽约`
              }
            );
          }
        }
        break;
      case "mark-no-show":
      case "reject-order":
      case "close-order":
      case "cancel":
        {
          const result = await this.runMysqlTerminalAction(order, action, body, previousStatus);
          actionTimelineDetail = result.timelineAction;
          resultMessage = result.message;
          settlementToSave = result.settlementSummary;
        }
        break;
      default:
        break;
    }

    await this.storeRentalRepository.updateOrderState(order, settlementToSave);
    await this.storeRentalRepository.appendOrderTimeline(order.id, {
      at: new Date().toISOString(),
      actor: String(body.operator ?? "门店营运"),
      action:
        actionTimelineDetail ??
        `${this.actionLabel(action)}：${previousStatus} -> ${order.mainStatus}${this.actionMemo(body)}`
    });

    const result: StoreRentalOrderActionResult = {
      orderId: order.id,
      orderNo: order.orderNo,
      action,
      received: body,
      result: knownAction ? "updated" : "mocked",
      message:
        resultMessage ??
        (knownAction
          ? "订单状态已按门市租赁状态机推进，并写入数据库。"
          : "MVP 阶段已跳过外部系统调用，仅记录模拟操作结果。"),
      nextStatus: order.mainStatus,
      nextPaymentStatus: order.paymentStatus,
      nextDispatchStatus: order.dispatchStatus,
      nextRecommendedActions: ["刷新订单", "查看操作记录", "继续结算流程"]
    };
    await this.recordOrderActionFulfillmentSideEffects(
      order,
      action,
      body,
      previousStatus
    );
    await this.saveOrderActionIdempotencyResult(order.id, action, body, result);

    if (operationContext?.record) {
      await this.completeOrderOperation(operationContext.record, result, order);
      await this.recordOrderNotificationForAction(order, action, body, result);
    }

    return result;
  }

  private async runMysqlExtensionAction(
    order: StoreRentalOrderDetail,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ) {
    const oldReturnAtText = order.returnAt;
    const oldReturnAt = new Date(order.returnAt);
    const newReturnAt = this.requiredDate(
      body.newReturnAt,
      "新预计还车时间不能为空。"
    );
    if (!Number.isFinite(oldReturnAt.getTime())) {
      throw new BadRequestException("当前订单预计还车时间无效，不能延长用车。");
    }

    const bufferMinutes = this.ruleConfig.pickupReturn.turnaroundMinutes || 60;
    const conflictEnd = new Date(newReturnAt.getTime() + bufferMinutes * 60_000);
    const conflict = await this.storeRentalRepository.findVehicleScheduleConflict(
      order.id,
      order.plateNo,
      oldReturnAt,
      conflictEnd
    );
    if (conflict) {
      throw new BadRequestException(
        `当前车辆在延长时段存在后续订单 ${conflict.orderNo}（取车时间 ${conflict.pickupAt}），请先解决库存冲突。`
      );
    }

    const settlementMode = this.extensionSettlementMode(
      body.settlementMode,
      order.billingMode === BillingMode.Monthly
    );
    const scratch = this.startMysqlOrderActionScratch(order);

    try {
      const effect = this.extendRental(order, body, previousStatus);
      const generatedFees = scratch.generatedFees();
      const generatedTransactions = scratch.generatedTransactions();
      const settlementSummary = scratch.settlementSummary();
      const extensionFee = generatedFees.find((item) => item.code === "extension_rent");

      await this.persistMysqlGeneratedFinancials(
        order,
        generatedFees,
        generatedTransactions
      );

      if (extensionFee) {
        const extensionHours = Math.max(
          1,
          Math.ceil((newReturnAt.getTime() - oldReturnAt.getTime()) / 3_600_000)
        );
        await this.storeRentalRepository.saveExtensionSnapshot(order.id, {
          id: `extension_${randomUUID()}`,
          snapshotRef:
            extensionFee.snapshotRef || `extension:${order.orderNo}:${Date.now()}`,
          oldReturnAt: oldReturnAtText,
          newReturnAt: order.returnAt,
          extensionHours,
          billableDays: Math.max(1, Math.ceil(extensionHours / 24)),
          amount: extensionFee.amount,
          settlementMode,
          operator: String(body.operator ?? "门店营运"),
          ruleSnapshot: {
            ruleVersion: this.ruleConfig.version,
            action: previousStatus === OrderMainStatus.Overdue ? "overdue_extension" : "extension",
            settlementMode,
            extensionHours,
            generatedFeeId: extensionFee.id
          },
          pricingSnapshot: {
            orderNo: order.orderNo,
            vehicleGroupName: order.vehicleGroupName,
            baseReturnAt: oldReturnAtText,
            newReturnAt: order.returnAt,
            pricingVersion: "store-rental-price-v2026.05.01"
          }
        });
      }

      return {
        ...effect,
        settlementSummary
      };
    } finally {
      scratch.restore();
    }
  }

  private async runMysqlRedirectionAction(
    order: StoreRentalOrderDetail,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): Promise<OrderActionEffect & { settlementSummary: StoreRentalSettlementSummary }> {
    const targetVehicle = await this.findMysqlRedirectionVehicle(body);
    const currentVehicle = await this.storeRentalRepository.findVehicleByPlateNo(
      order.plateNo
    );
    this.validateRedirectionVehicle(order, targetVehicle, currentVehicle);

    const conflict = await this.storeRentalRepository.findVehicleScheduleConflict(
      order.id,
      targetVehicle.licensePlate,
      new Date(order.pickupAt),
      new Date(order.returnAt)
    );
    if (conflict) {
      throw new BadRequestException(
        `目标车辆在订单时段存在后续订单 ${conflict.orderNo}（取车时间 ${conflict.pickupAt}），不能确认改派。`
      );
    }

    const vehicleGroups = await this.storeRentalRepository.listVehicleGroups();
    const scratch = this.startMysqlOrderActionScratch(order);

    try {
      const effect = this.applyOrderRedirection(
        order,
        body,
        targetVehicle,
        previousStatus,
        vehicleGroups
      );
      for (const fee of scratch.generatedFees().reverse()) {
        await this.storeRentalRepository.upsertOrderFeeItem(order.id, fee);
      }
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        effect.previousPlateNo,
        "idle",
        {
          operator: effect.operator,
          action: "订单改派释放原车",
          reason: `${order.orderNo} 改派至 ${targetVehicle.licensePlate}`
        }
      );
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        targetVehicle.licensePlate,
        this.redirectionTargetVehicleStatus(order),
        {
          operator: effect.operator,
          action:
            order.dispatchStatus === DispatchStatus.Upgraded ? "免费升等锁车" : "人工改派锁车",
          reason: `${order.orderNo} / ${effect.reasonLabel}`
        }
      );

      return {
        timelineAction: effect.timelineAction,
        message: effect.message,
        settlementSummary: effect.settlementSummary
      };
    } finally {
      scratch.restore();
    }
  }

  private async runMysqlTerminalAction(
    order: StoreRentalOrderDetail,
    action: string,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ) {
    const previousPlateNo = order.plateNo;
    const scratch = this.startMysqlOrderActionScratch(order);

    try {
      const effect =
        action === "cancel"
          ? this.cancelOrder(order, body, previousStatus)
          : action === "mark-no-show"
            ? this.markOrderNoShow(order, body, previousStatus)
            : action === "reject-order"
              ? this.rejectOrder(order, body, previousStatus)
              : action === "close-order"
                ? this.closeOrder(order, body, previousStatus)
                : undefined;

      if (!effect) {
        throw new BadRequestException("未知的终止类订单动作。");
      }

      const generatedFees = scratch.generatedFees();
      const generatedTransactions = scratch.generatedTransactions();
      const settlementSummary = scratch.settlementSummary();
      await this.persistMysqlGeneratedFinancials(
        order,
        generatedFees,
        generatedTransactions
      );
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        previousPlateNo,
        "idle",
        {
          operator: String(body.operator ?? "门店营运"),
          action: this.actionLabel(action),
          reason:
            this.optionalString(body.reason) ||
            this.optionalString(body.cancelReason) ||
            this.optionalString(body.rejectReason) ||
            this.optionalString(body.closeReason) ||
            this.optionalString(body.contactResult)
        }
      );

      return {
        ...effect,
        settlementSummary
      };
    } finally {
      scratch.restore();
    }
  }

  private startMysqlOrderActionScratch(order: StoreRentalOrderDetail) {
    const previousFees = this.manualFeeLedgerItems.get(order.id);
    const previousTransactions = this.persistedTransactions.get(order.id);
    const previousSettlement = this.settlementSummaries.get(order.id);

    this.manualFeeLedgerItems.set(order.id, []);
    this.persistedTransactions.set(order.id, []);
    this.settlementSummaries.set(order.id, structuredClone(order.settlementSummary));

    return {
      generatedFees: () => [...(this.manualFeeLedgerItems.get(order.id) ?? [])],
      generatedTransactions: () => [
        ...(this.persistedTransactions.get(order.id) ?? [])
      ],
      settlementSummary: () =>
        this.settlementSummaries.get(order.id) ?? order.settlementSummary,
      restore: () => {
        if (previousFees) {
          this.manualFeeLedgerItems.set(order.id, previousFees);
        } else {
          this.manualFeeLedgerItems.delete(order.id);
        }
        if (previousTransactions) {
          this.persistedTransactions.set(order.id, previousTransactions);
        } else {
          this.persistedTransactions.delete(order.id);
        }
        if (previousSettlement) {
          this.settlementSummaries.set(order.id, previousSettlement);
        } else {
          this.settlementSummaries.delete(order.id);
        }
      }
    };
  }

  private async persistMysqlGeneratedFinancials(
    order: StoreRentalOrderSummary,
    generatedFees: StoreRentalFeeLedgerItem[],
    generatedTransactions: StoreRentalTransactionRecord[]
  ) {
    for (const fee of [...generatedFees].reverse()) {
      await this.storeRentalRepository.upsertOrderFeeItem(order.id, fee);
    }

    for (const transaction of [...generatedTransactions].reverse()) {
      await this.storeRentalRepository.createOrderTransaction(order.id, transaction);
    }

    const monthlyBillFees = generatedFees.filter(
      (item) =>
        item.status === "monthly_billing" &&
        item.direction === "charge" &&
        item.amount > 0
    );
    const monthlyBillAmount = monthlyBillFees.reduce(
      (total, item) => total + item.amount,
      0
    );
    if (
      order.billingMode === BillingMode.Monthly &&
      monthlyBillAmount > 0 &&
      this.canPostMonthlyBill(order.mainStatus)
    ) {
      await this.storeRentalRepository.createOrderTransaction(order.id, {
        id: `txn_monthly_${randomUUID()}`,
        type: "monthly_bill",
        channel: "internal",
        amount: monthlyBillAmount,
        status: "success",
        at: new Date().toISOString(),
        operator: "企业月结",
        relatedFeeIds: monthlyBillFees.map((item) => item.id),
        note: "企业月结订单终止有责费用挂账。"
      });
    }
  }

  async getDispatchBoard(
    query: StoreRentalDispatchOptimizeRequest = { windowDays: 7 }
  ): Promise<StoreRentalDispatchBoard> {
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const windowDays = this.normalizeDispatchWindowDays(query.windowDays);
    const referenceDate = this.normalizeDispatchReferenceDate(query.referenceDate);
    const rows = orders
      .filter((order) => this.isDispatchBoardOrder(order))
      .filter((order) => this.matchesDispatchScope(order, query))
      .map((order) =>
        this.buildDispatchOrderRow(
          order,
          vehicles,
          orders,
          stations,
          vehicleGroups,
          referenceDate
        )
      )
      .sort(
        (left, right) =>
          new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime()
      );
    const scopedVehicles = vehicles.filter((vehicle) =>
      query.storeName ? vehicle.currentStoreName === query.storeName : true
    );

    return {
      generatedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      windowDays,
      storeScopeLabel: query.storeName || "全部门市",
      rows,
      vehicles: scopedVehicles,
      vehicleGroups,
      metrics: {
        activeOrders: rows.length,
        pendingOrders: rows.filter((row) => row.dispatchStatus === DispatchStatus.Pending)
          .length,
        preassignedOrders: rows.filter(
          (row) => row.dispatchStatus === DispatchStatus.PreAssigned
        ).length,
        lockedOrders: rows.filter((row) => row.dispatchStatus === DispatchStatus.Locked)
          .length,
        manualRequiredOrders: rows.filter(
          (row) => row.dispatchStatus === DispatchStatus.ManualRequired
        ).length,
        candidateVehicles: scopedVehicles.filter(
          (vehicle) =>
            vehicle.enabled &&
            !["controlled", "maintenance", "disabled"].includes(
              vehicle.operationStatus
            )
        ).length
      }
    };
  }

  async listDispatchTasks(
    query: StoreRentalDispatchTaskQuery = {}
  ): Promise<StoreRentalDispatchTaskPool> {
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const windowDays = this.normalizeDispatchWindowDays(query.windowDays ?? 7);
    const referenceDate = this.normalizeDispatchReferenceDate(query.referenceDate);
    const windowEnd = new Date(referenceDate);
    windowEnd.setDate(windowEnd.getDate() + windowDays);
    const latestEvents = await this.listDispatchEvents({ limit: 200 });
    const closedTaskKeys = new Set(
      latestEvents
        .filter((event) => event.eventType === "alert_closed")
        .map((event) => this.optionalString(event.payload?.taskKey))
        .filter(Boolean)
    );
    const tasks = orders
      .filter((order) => this.isDispatchBoardOrder(order))
      .filter((order) => this.matchesDispatchScope(order, query))
      .filter((order) => {
        const pickupAt = new Date(order.pickupAt);
        return (
          pickupAt.getTime() >= referenceDate.getTime() &&
          pickupAt.getTime() < windowEnd.getTime()
        );
      })
      .flatMap((order) => {
        const row = this.buildDispatchOrderRow(
          order,
          vehicles,
          orders,
          stations,
          vehicleGroups,
          referenceDate
        );
        const latestEvent = latestEvents.find((event) => event.orderId === order.id);
        return this.buildDispatchTasksForOrder(
          order,
          row,
          vehicles,
          orders,
          stations,
          vehicleGroups,
          referenceDate,
          latestEvent
        );
      })
      .filter((task) => !closedTaskKeys.has(`${task.orderId}:${task.taskType}`))
      .sort((left, right) => {
        const priorityWeight = { high: 0, medium: 1, low: 2 };
        const priorityDiff =
          priorityWeight[left.priority] - priorityWeight[right.priority];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        return new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime();
      });

    return {
      generatedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      storeScopeLabel: query.storeName || "全部门市",
      metrics: {
        totalTasks: tasks.length,
        highPriorityTasks: tasks.filter((task) => task.priority === "high").length,
        manualRequiredTasks: tasks.filter(
          (task) => task.taskType === "manual_required"
        ).length,
        vehicleUnavailableTasks: tasks.filter(
          (task) =>
            task.taskType === "vehicle_unavailable" ||
            task.taskType === "manual_protected_invalid"
        ).length,
        nearLockTasks: tasks.filter((task) => task.taskType === "near_lock_unlocked")
          .length
      },
      tasks
    };
  }

  async listDispatchEvents(
    query: StoreRentalDispatchEventQuery = {}
  ): Promise<StoreRentalDispatchEvent[]> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listDispatchEvents({ ...query, limit });
    }
    return this.dispatchEvents
      .filter((event) => (query.orderId ? event.orderId === query.orderId : true))
      .filter((event) => (query.planId ? event.planId === query.planId : true))
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )
      .slice(0, limit);
  }

  async closeDispatchTask(
    input: StoreRentalDispatchCloseTaskRequest
  ): Promise<StoreRentalDispatchTaskActionResult> {
    const reason = this.optionalString(input.reason);
    if (!reason) {
      throw new BadRequestException("关闭调度任务必须填写处理说明。");
    }

    const { orders } = await this.getDispatchDataset();
    const order = orders.find((item) => item.id === input.orderId);
    if (!order) {
      throw new BadRequestException("调度任务关联订单不存在。");
    }

    const operator = input.operator || "调度员";
    const highRiskTask = [
      "manual_required",
      "vehicle_unavailable",
      "manual_protected_invalid"
    ].includes(input.taskType);
    const event = await this.recordDispatchEvent({
      eventType: "alert_closed",
      source: "manual",
      title: "调度任务关闭",
      orderId: order.id,
      orderNo: order.orderNo,
      beforeVehicle: order.plateNo,
      reasonCode: "MANUAL_ALERT",
      reasonText: reason,
      riskLevel: highRiskTask ? "medium" : "low",
      operator,
      payload: {
        taskId: input.taskId,
        taskType: input.taskType,
        taskKey: `${order.id}:${input.taskType}`
      }
    });

    return {
      taskId: input.taskId,
      orderId: order.id,
      orderNo: order.orderNo,
      status: "closed",
      event,
      message: `调度任务 ${order.orderNo} 已关闭，后续可在事件流追溯。`
    };
  }

  async listOrderOperationRecords(
    orderId: string
  ): Promise<StoreRentalOrderOperationRecord[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listOrderOperationRecords(orderId);
    }
    return [...(this.orderOperationRecords.get(orderId) ?? [])].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  async listOrderNotificationRecords(
    orderId: string
  ): Promise<StoreRentalOrderNotificationRecord[]> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.listOrderNotificationRecords(orderId);
    }
    return [...(this.orderNotificationRecords.get(orderId) ?? [])].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  async previewDispatchOptimization(
    input: StoreRentalDispatchOptimizeRequest
  ): Promise<StoreRentalDispatchPlan> {
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const windowDays = this.normalizeDispatchWindowDays(input.windowDays);
    const referenceDate = this.normalizeDispatchReferenceDate(input.referenceDate);
    const windowEnd = new Date(referenceDate);
    windowEnd.setDate(windowEnd.getDate() + windowDays);
    const scopedOrders = orders
      .filter((order) => this.matchesDispatchScope(order, input))
      .filter(
        (order) =>
          new Date(order.pickupAt).getTime() >= referenceDate.getTime() &&
          new Date(order.pickupAt).getTime() < windowEnd.getTime()
      );
    const rows: StoreRentalDispatchResultRow[] = [];
    const simulation = new Map<string, Array<{ from: Date; to: Date }>>();
    const simulationRevenue = new Map<string, number>();
    const optimizableOrders = scopedOrders
      .filter((order) =>
        [DispatchStatus.Pending, DispatchStatus.PreAssigned].includes(
          order.dispatchStatus
        )
      )
      .sort((left, right) => this.dispatchOrderSort(left, right));

    for (const order of scopedOrders) {
      if (
        [DispatchStatus.ManualReassigned, DispatchStatus.Upgraded].includes(
          order.dispatchStatus
        )
      ) {
        rows.push(
          this.dispatchResultRow(order, {
            resultStatus: "skipped",
            reasonCode: "SKIP_MANUAL",
            reasonText: "人工结果保护",
            reasonDetail: "人工改派和免费升等订单固定不参与批量优化。",
            riskLevel: "medium",
            nearLock: this.isDispatchNearLock(order, referenceDate)
          })
        );
      } else if (order.dispatchStatus === DispatchStatus.Locked) {
        rows.push(
          this.dispatchResultRow(order, {
            resultStatus: "skipped",
            reasonCode: "SKIP_MANUAL",
            reasonText: "已硬锁保护",
            reasonDetail: "已硬锁订单不参与批量优化，只能通过订单改派流程调整。",
            riskLevel: "medium",
            nearLock: this.isDispatchNearLock(order, referenceDate)
          })
        );
      }
    }

    for (const order of optimizableOrders) {
      const nearLock = this.isDispatchNearLock(order, referenceDate);
      if (nearLock) {
        rows.push(
          this.dispatchResultRow(order, {
            resultStatus: "skipped",
            reasonCode: "SKIP_NEAR_LOCK",
            reasonText: "临近取车保护",
            reasonDetail: "已进入硬锁定时间点前 2 小时保护窗口，只能人工改派。",
            riskLevel: "medium",
            nearLock
          })
        );
        continue;
      }

      if (order.mainStatus !== OrderMainStatus.Reserved) {
        rows.push(
          this.dispatchResultRow(order, {
            resultStatus: "skipped",
            reasonCode: "SKIP_MANUAL",
            reasonText: "未纳入",
            reasonDetail: "只有已预订且未硬锁订单参与手动批量优化。",
            riskLevel: "medium",
            nearLock
          })
        );
        continue;
      }

      const candidates = this.buildDispatchCandidates(
        order,
        vehicles,
        orders,
        stations,
        vehicleGroups,
        referenceDate,
        simulation,
        simulationRevenue
      );
      if (candidates.length === 0) {
        rows.push(
          this.dispatchResultRow(order, {
            resultStatus: "skipped",
            reasonCode: "SKIP_NO_VEHICLE",
            reasonText: "无可用车辆",
            reasonDetail:
              "同门市、同车组、同时间窗内没有满足硬约束的可交付车辆，进入人工调度队列。",
            riskLevel: "high",
            nearLock
          })
        );
        continue;
      }

      const target = candidates[0];
      const currentVehicle = vehicles.find(
        (vehicle) => vehicle.licensePlate === order.plateNo
      );
      const currentStillAvailable =
        currentVehicle &&
        candidates.some((candidate) => candidate.vehicleId === currentVehicle.id);
      const currentScore = currentVehicle
        ? this.dispatchVehicleScore(
            currentVehicle,
            orders,
            vehicleGroups,
            simulationRevenue
          )
        : undefined;
      const scoreDelta =
        currentScore === undefined ? 1 : Math.abs(currentScore - target.score);
      const keepCurrent =
        currentStillAvailable &&
        order.dispatchStatus === DispatchStatus.PreAssigned &&
        scoreDelta < 0.05;
      const chosen = keepCurrent
        ? candidates.find((candidate) => candidate.vehicleId === currentVehicle?.id) ??
          target
        : target;

      this.reserveDispatchSimulation(order, chosen.licensePlate, simulation);
      simulationRevenue.set(
        chosen.licensePlate,
        (simulationRevenue.get(chosen.licensePlate) ?? 0) + order.totalAmount
      );

      rows.push(
        this.dispatchResultRow(order, {
          targetVehicle: chosen.licensePlate,
          targetVehicleId: chosen.vehicleId,
          resultStatus: keepCurrent ? "unchanged" : "optimized",
          reasonCode: keepCurrent
            ? "KEEP_CURRENT"
            : order.dispatchStatus === DispatchStatus.Pending
              ? "ASSIGN_PENDING"
              : currentStillAvailable
                ? "REPLACE_SCORE"
                : "REPLACE_CONFLICT",
          reasonText: keepCurrent
            ? "保持原车"
            : order.dispatchStatus === DispatchStatus.Pending
              ? "分配待派车"
              : currentStillAvailable
                ? "车辆评分更优"
                : "避免车辆冲突",
          reasonDetail: keepCurrent
            ? "原预分配车辆仍可交付，且调整收益不足以触发换车。"
            : `推荐 ${chosen.licensePlate}，车辆评分 ${chosen.scoreText}，满足同门市、同车组和时间窗校验。`,
          riskLevel: chosen.riskFlags.length ? "medium" : "low",
          nearLock
        })
      );
    }

    const sortedRows = rows.sort(
      (left, right) =>
        new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime()
    );

    const plan: StoreRentalDispatchPlan = {
      planId: `dispatch_plan_${Date.now()}`,
      generatedAt: new Date().toISOString(),
      referenceDate: referenceDate.toISOString(),
      windowDays,
      storeScopeLabel: input.storeName || "全部门市",
      metrics: {
        participatingOrders: optimizableOrders.length,
        preassignedOrders: scopedOrders.filter(
          (order) => order.dispatchStatus === DispatchStatus.PreAssigned
        ).length,
        pendingOrders: scopedOrders.filter(
          (order) => order.dispatchStatus === DispatchStatus.Pending
        ).length,
        lockedOrders: scopedOrders.filter(
          (order) => order.dispatchStatus === DispatchStatus.Locked
        ).length,
        manualProtectedOrders: scopedOrders.filter((order) =>
          [DispatchStatus.ManualReassigned, DispatchStatus.Upgraded].includes(
            order.dispatchStatus
          )
        ).length,
        nearLockOrders: sortedRows.filter((row) => row.nearLock).length,
        candidateVehicles: vehicles.filter((vehicle) =>
          input.storeName ? vehicle.currentStoreName === input.storeName : true
        ).length,
        optimizedRows: sortedRows.filter((row) => row.resultStatus === "optimized")
          .length,
        unchangedRows: sortedRows.filter((row) => row.resultStatus === "unchanged")
          .length,
        skippedRows: sortedRows.filter((row) => row.resultStatus === "skipped")
          .length
      },
      rows: sortedRows
    };

    await this.recordDispatchEvent({
      eventType: "optimization_preview",
      source: "manual",
      title: "智能优化预览",
      planId: plan.planId,
      reasonText: "调度员发起智能优化预览。",
      riskLevel: plan.metrics.skippedRows > 0 ? "medium" : "low",
      operator: input.operator || "营运端",
      payload: {
        windowDays,
        storeScopeLabel: plan.storeScopeLabel,
        participatingOrders: plan.metrics.participatingOrders,
        optimizedRows: plan.metrics.optimizedRows,
        skippedRows: plan.metrics.skippedRows
      }
    });

    return plan;
  }

  async applyDispatchOptimization(
    input: StoreRentalDispatchApplyRequest
  ): Promise<StoreRentalDispatchApplyResult> {
    const rows: StoreRentalDispatchResultRow[] = [];
    const operator = input.operator || "调度员";
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();

    for (const row of input.rows) {
      if (row.resultStatus !== "optimized" || !row.targetVehicleId) {
        rows.push({ ...row, applied: false });
        continue;
      }

      const order = orders.find((item) => item.id === row.orderId);
      const targetVehicle = vehicles.find((item) => item.id === row.targetVehicleId);
      if (!order || !targetVehicle) {
        await this.recordDispatchEvent({
          eventType: "optimization_apply_failed",
          source: "manual",
          title: "应用优化失败",
          orderId: row.orderId,
          orderNo: row.orderNo,
          planId: input.planId,
          beforeVehicle: row.beforeVehicle,
          targetVehicle: row.targetVehicle,
          reasonCode: "APPLY_VALIDATION_FAILED",
          reasonText: "订单或车辆不存在。",
          riskLevel: "high",
          operator
        });
        rows.push(
          this.failedDispatchRow(row, "APPLY_VALIDATION_FAILED", "订单或车辆不存在。")
        );
        continue;
      }

      const validation = this.validateDispatchPreAssignment(
        order,
        targetVehicle,
        orders,
        vehicles,
        stations,
        vehicleGroups,
        this.normalizeDispatchReferenceDate()
      );
      if (validation) {
        await this.recordDispatchEvent({
          eventType: "optimization_apply_failed",
          source: "manual",
          title: "应用优化失败",
          orderId: order.id,
          orderNo: order.orderNo,
          planId: input.planId,
          beforeVehicle: row.beforeVehicle,
          targetVehicle: targetVehicle.licensePlate,
          reasonCode: "APPLY_VALIDATION_FAILED",
          reasonText: validation,
          riskLevel: "high",
          operator
        });
        rows.push(this.failedDispatchRow(row, "APPLY_VALIDATION_FAILED", validation));
        continue;
      }

      await this.persistDispatchAssignment(order, targetVehicle, {
        dispatchStatus: DispatchStatus.PreAssigned,
        operator,
        action: "智能优化预分配",
        note: row.reasonText,
        timelineAction: `智能优化预分配：${order.plateNo || "未分配"} -> ${targetVehicle.licensePlate}，原因：${row.reasonText}`
      });
      await this.recordDispatchEvent({
        eventType: "optimization_apply",
        source: "manual",
        title: "应用优化结果",
        orderId: order.id,
        orderNo: order.orderNo,
        planId: input.planId,
        beforeVehicle: row.beforeVehicle,
        targetVehicle: targetVehicle.licensePlate,
        reasonCode: row.reasonCode,
        reasonText: row.reasonText,
        riskLevel: row.riskLevel,
        operator,
        payload: {
          reasonDetail: row.reasonDetail,
          nearLock: row.nearLock
        }
      });
      rows.push({ ...row, applied: true });
    }

    const appliedCount = rows.filter((row) => row.applied).length;
    const failedCount = rows.filter((row) => row.resultStatus === "failed").length;

    return {
      planId: input.planId,
      appliedCount,
      failedCount,
      rows,
      message: `已应用 ${appliedCount} 笔预分配结果${failedCount ? `，${failedCount} 笔失败` : ""}。`
    };
  }

  async hardLockDispatchOrders(
    input: StoreRentalDispatchHardLockRequest
  ): Promise<StoreRentalDispatchApplyResult> {
    const operator = input.operator || "调度员";
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const referenceDate = this.normalizeDispatchReferenceDate(input.referenceDate);
    const windowDays = this.normalizeDispatchWindowDays(input.windowDays ?? 7);
    const windowEnd = new Date(referenceDate);
    windowEnd.setDate(windowEnd.getDate() + windowDays);
    const scopedOrders = orders.filter((order) => {
      if (input.orderIds?.length) {
        return input.orderIds.includes(order.id);
      }
      return (
        this.matchesDispatchScope(order, input) &&
        new Date(order.pickupAt).getTime() >= referenceDate.getTime() &&
        new Date(order.pickupAt).getTime() < windowEnd.getTime()
      );
    });
    const rows: StoreRentalDispatchResultRow[] = [];

    for (const order of scopedOrders) {
      const baseRow = this.dispatchResultRow(order, {
        resultStatus: "optimized",
        reasonCode: "ASSIGN_PENDING",
        reasonText: "硬锁自动分派",
        riskLevel: "low",
        nearLock: this.isDispatchNearLock(order, referenceDate)
      });

      if (
        order.mainStatus !== OrderMainStatus.Reserved ||
        ![DispatchStatus.Pending, DispatchStatus.PreAssigned].includes(
          order.dispatchStatus
        )
      ) {
        await this.recordDispatchEvent({
          eventType: "hard_lock_failed",
          source: "system",
          title: "硬锁失败",
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: order.plateNo,
          reasonCode: "APPLY_VALIDATION_FAILED",
          reasonText: "订单状态或派车状态不允许硬锁。",
          riskLevel: "medium",
          operator
        });
        rows.push(
          this.failedDispatchRow(
            baseRow,
            "APPLY_VALIDATION_FAILED",
            "订单状态或派车状态不允许硬锁。"
          )
        );
        continue;
      }

      const currentVehicle = vehicles.find(
        (vehicle) => vehicle.licensePlate === order.plateNo
      );
      const currentValidation = currentVehicle
        ? this.validateDispatchPreAssignment(
            order,
            currentVehicle,
            orders,
            vehicles,
            stations,
            vehicleGroups,
            referenceDate
          )
        : "订单未绑定预分配车辆。";
      const fallbackCandidate = this.buildDispatchCandidates(
        order,
        vehicles,
        orders,
        stations,
        vehicleGroups,
        referenceDate
      )[0];
      const targetVehicle =
        currentVehicle && !currentValidation
          ? currentVehicle
          : fallbackCandidate
            ? vehicles.find((vehicle) => vehicle.id === fallbackCandidate.vehicleId)
            : undefined;

      if (!targetVehicle) {
        order.dispatchStatus = DispatchStatus.ManualRequired;
        order.riskFlags = this.uniqueFlags(order.riskFlags, [
          "人工调度",
          "硬锁失败"
        ]);
        await this.persistDispatchOrderOnly(
          order,
          operator,
          "硬锁失败：无可用车辆，进入人工调度队列。"
        );
        await this.recordDispatchEvent({
          eventType: "hard_lock_failed",
          source: "system",
          title: "硬锁失败",
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: order.plateNo,
          reasonCode: "SKIP_NO_VEHICLE",
          reasonText: "无可用车辆，已进入人工调度队列。",
          riskLevel: "high",
          operator
        });
        rows.push(
          this.failedDispatchRow(
            baseRow,
            "SKIP_NO_VEHICLE",
            "无可用车辆，已进入人工调度队列。"
          )
        );
        continue;
      }

      await this.persistDispatchAssignment(order, targetVehicle, {
        dispatchStatus: DispatchStatus.Locked,
        operator,
        action: "硬锁车辆",
        note: "取车前硬锁定",
        timelineAction: `硬锁车辆：${order.plateNo || "未分配"} -> ${targetVehicle.licensePlate}`
      });
      await this.recordDispatchEvent({
        eventType: "hard_lock_success",
        source: "system",
        title: "硬锁车辆",
        orderId: order.id,
        orderNo: order.orderNo,
        beforeVehicle: baseRow.beforeVehicle,
        targetVehicle: targetVehicle.licensePlate,
        reasonCode: "ASSIGN_PENDING",
        reasonText:
          currentVehicle && !currentValidation ? "保持原车硬锁" : "硬锁自动分派",
        riskLevel: "low",
        operator
      });
      rows.push({
        ...baseRow,
        targetVehicle: targetVehicle.licensePlate,
        targetVehicleId: targetVehicle.id,
        reasonText: currentVehicle && !currentValidation ? "保持原车硬锁" : "硬锁自动分派",
        applied: true
      });
    }

    const appliedCount = rows.filter((row) => row.applied).length;
    const failedCount = rows.filter((row) => row.resultStatus === "failed").length;

    return {
      appliedCount,
      failedCount,
      rows,
      message: `硬锁处理完成：成功 ${appliedCount} 笔，失败 ${failedCount} 笔。`
    };
  }

  async manualReassignFromDispatch(
    input: StoreRentalDispatchManualReassignRequest
  ): Promise<StoreRentalOrderActionResult> {
    const operator = input.operator || "调度员";
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const order = orders.find((item) => item.id === input.orderId);
    const targetVehicle = vehicles.find((vehicle) =>
      input.targetVehicleId
        ? vehicle.id === input.targetVehicleId
        : vehicle.licensePlate === input.targetPlateNo
    );
    if (!order) {
      throw new NotFoundException(`Store rental order ${input.orderId} was not found`);
    }
    if (!targetVehicle) {
      throw new BadRequestException("请选择人工改派目标车辆。");
    }
    if (
      ![OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue].includes(
        order.mainStatus
      )
    ) {
      throw new BadRequestException("调度页人工改派只处理已预订或逾期未取订单。");
    }
    const validation = this.validateDispatchPreAssignment(
      order,
      targetVehicle,
      orders,
      vehicles,
      stations,
      vehicleGroups,
      this.normalizeDispatchReferenceDate(),
      true
    );
    if (validation) {
      throw new BadRequestException(validation);
    }

    const beforePlateNo = order.plateNo;
    await this.persistDispatchAssignment(order, targetVehicle, {
      dispatchStatus: DispatchStatus.ManualReassigned,
      operator,
      action: "调度页人工改派",
      note: input.reason || "车辆调度调整",
      timelineAction:
        `调度页人工改派：${order.plateNo || "未分配"} -> ${targetVehicle.licensePlate}` +
        `${input.reason ? `，原因：${input.reason}` : ""}` +
        `${input.memo ? `，备注：${input.memo}` : ""}`
    });
    await this.recordDispatchEvent({
      eventType: "manual_reassign",
      source: "manual",
      title: "调度页人工改派",
      orderId: order.id,
      orderNo: order.orderNo,
      beforeVehicle: beforePlateNo,
      targetVehicle: targetVehicle.licensePlate,
      reasonCode: "MANUAL_ALERT",
      reasonText: input.reason || "车辆调度调整",
      riskLevel: "medium",
      operator,
      payload: {
        memo: input.memo
      }
    });

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      action: "dispatch-manual-reassign",
      received: input as unknown as Record<string, unknown>,
      result: "updated",
      message: `已人工改派至 ${targetVehicle.licensePlate}。`,
      nextStatus: order.mainStatus,
      nextPaymentStatus: order.paymentStatus,
      nextDispatchStatus: order.dispatchStatus,
      nextRecommendedActions: ["刷新排程看板", "查看完整订单详情", "查看操作记录"]
    };
  }

  async processDispatchVehicleUnavailable(
    input: StoreRentalDispatchVehicleUnavailableRequest
  ): Promise<StoreRentalDispatchVehicleUnavailableResult> {
    const operator = input.operator || "营运端";
    const { orders, vehicles, vehicleGroups, stations } =
      await this.getDispatchDataset();
    const seedOrder = input.orderId
      ? orders.find((order) => order.id === input.orderId)
      : undefined;
    const targetVehicle = vehicles.find((vehicle) => {
      if (input.vehicleId) {
        return vehicle.id === input.vehicleId;
      }
      if (input.plateNo) {
        return vehicle.licensePlate === input.plateNo;
      }
      return seedOrder?.plateNo && vehicle.licensePlate === seedOrder.plateNo;
    });

    if (!targetVehicle) {
      throw new BadRequestException("请选择需要标记不可交付的车辆。");
    }

    const targetOperationStatus =
      input.targetOperationStatus ?? this.defaultUnavailableOperationStatus(input.reason);
    const reasonText = this.vehicleUnavailableReasonText(input.reason);
    const unavailableNote =
      `${reasonText}${input.memo ? `，${input.memo.trim()}` : ""}`;

    targetVehicle.operationStatus = targetOperationStatus;
    if (targetOperationStatus === "disabled") {
      targetVehicle.enabled = false;
    }
    await this.markVehicleUnavailableForDispatch(
      targetVehicle.licensePlate,
      targetOperationStatus,
      operator,
      unavailableNote
    );

    const affectedOrders = orders
      .filter((order) => order.plateNo === targetVehicle.licensePlate)
      .filter((order) =>
        [OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue].includes(
          order.mainStatus
        )
      )
      .filter((order) =>
        [
          DispatchStatus.Pending,
          DispatchStatus.PreAssigned,
          DispatchStatus.Locked,
          DispatchStatus.ManualReassigned,
          DispatchStatus.Upgraded
        ].includes(order.dispatchStatus)
      )
      .sort(
        (left, right) =>
          new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime()
      );

    const rows: StoreRentalDispatchVehicleUnavailableOrderResult[] = [];

    for (const order of affectedOrders) {
      const beforeDispatchStatus = order.dispatchStatus;
      const beforePlateNo = order.plateNo;

      if (
        [DispatchStatus.ManualReassigned, DispatchStatus.Upgraded].includes(
          order.dispatchStatus
        )
      ) {
        order.riskFlags = this.uniqueFlags(order.riskFlags, [
          "人工结果已失效",
          "车辆不可交付"
        ]);
        await this.persistDispatchOrderOnly(
          order,
          operator,
          `车辆不可交付：${beforePlateNo} 因${unavailableNote}失效，人工结果保护，进入人工确认。`
        );
        await this.recordDispatchEvent({
          eventType: "vehicle_unavailable",
          source: "manual",
          title: "人工结果车辆不可交付",
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: beforePlateNo,
          reasonCode: "VEHICLE_UNAVAILABLE",
          reasonText: "人工改派或免费升等结果已失效，需人工重新确认。",
          riskLevel: "high",
          operator,
          payload: {
            reason: input.reason,
            memo: input.memo,
            targetOperationStatus
          }
        });
        rows.push({
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: beforePlateNo,
          beforeDispatchStatus,
          nextDispatchStatus: order.dispatchStatus,
          action: "manual_protected_alert",
          reasonText: "人工结果保护，已生成车辆不可交付告警。",
          riskLevel: "high"
        });
        continue;
      }

      const shouldTryAutoReassign = input.tryAutoReassign !== false;
      const candidate = shouldTryAutoReassign
        ? this.buildDispatchCandidates(
            order,
            vehicles,
            orders,
            stations,
            vehicleGroups,
            this.normalizeDispatchReferenceDate()
          ).find((item) => item.vehicleId !== targetVehicle.id)
        : undefined;
      const nextVehicle = candidate
        ? vehicles.find((vehicle) => vehicle.id === candidate.vehicleId)
        : undefined;

      if (nextVehicle) {
        const nextStatus =
          beforeDispatchStatus === DispatchStatus.Locked
            ? DispatchStatus.Locked
            : DispatchStatus.PreAssigned;
        await this.persistDispatchAssignment(order, nextVehicle, {
          dispatchStatus: nextStatus,
          operator,
          action: "车辆不可交付自动改派",
          note: unavailableNote,
          timelineAction:
            `车辆不可交付自动改派：${beforePlateNo || "未分配"} -> ${nextVehicle.licensePlate}` +
            `，原因：${unavailableNote}`
        });
        await this.recordDispatchEvent({
          eventType: "vehicle_unavailable",
          source: "system",
          title: "车辆不可交付自动改派",
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: beforePlateNo,
          targetVehicle: nextVehicle.licensePlate,
          reasonCode: "VEHICLE_UNAVAILABLE",
          reasonText: "原车辆不可交付，系统已按同门市同车组候选池自动改派。",
          riskLevel: "medium",
          operator,
          payload: {
            reason: input.reason,
            memo: input.memo,
            targetOperationStatus,
            targetVehicleId: nextVehicle.id
          }
        });
        rows.push({
          orderId: order.id,
          orderNo: order.orderNo,
          beforeVehicle: beforePlateNo,
          targetVehicle: nextVehicle.licensePlate,
          beforeDispatchStatus,
          nextDispatchStatus: order.dispatchStatus,
          action: "auto_reassigned",
          reasonText: "已自动改派到同门市、同车组、无冲突车辆。",
          riskLevel: "medium"
        });
        continue;
      }

      order.plateNo = undefined;
      order.dispatchStatus = DispatchStatus.ManualRequired;
      order.riskFlags = this.uniqueFlags(order.riskFlags, [
        "人工调度",
        "车辆不可交付"
      ]);
      await this.persistDispatchOrderOnly(
        order,
        operator,
        `车辆不可交付：${beforePlateNo || "未分配"} 因${unavailableNote}释放占用，进入人工调度队列。`
      );
      await this.recordDispatchEvent({
        eventType: "vehicle_unavailable",
        source: "system",
        title: "车辆不可交付进入人工队列",
        orderId: order.id,
        orderNo: order.orderNo,
        beforeVehicle: beforePlateNo,
        reasonCode: "VEHICLE_UNAVAILABLE",
        reasonText: shouldTryAutoReassign
          ? "同门市同车组无可用候选车辆，已释放原车并进入人工调度队列。"
          : "已按人工处理要求释放原车并进入人工调度队列。",
        riskLevel: "high",
        operator,
        payload: {
          reason: input.reason,
          memo: input.memo,
          targetOperationStatus,
          autoReassignAttempted: shouldTryAutoReassign
        }
      });
      rows.push({
        orderId: order.id,
        orderNo: order.orderNo,
        beforeVehicle: beforePlateNo,
        beforeDispatchStatus,
        nextDispatchStatus: order.dispatchStatus,
        action: "released_to_manual_queue",
        reasonText: shouldTryAutoReassign
          ? "自动改派失败，已释放原车并进入人工调度队列。"
          : "已释放原车并进入人工调度队列。",
        riskLevel: "high"
      });
    }

    if (rows.length === 0) {
      await this.recordDispatchEvent({
        eventType: "vehicle_unavailable",
        source: "manual",
        title: "车辆不可交付登记",
        beforeVehicle: targetVehicle.licensePlate,
        reasonCode: "VEHICLE_UNAVAILABLE",
        reasonText: "车辆已标记不可交付，当前没有未开始履约的后续订单受影响。",
        riskLevel: "low",
        operator,
        payload: {
          reason: input.reason,
          memo: input.memo,
          targetOperationStatus
        }
      });
    }

    const autoReassignedCount = rows.filter(
      (row) => row.action === "auto_reassigned"
    ).length;
    const manualQueueCount = rows.filter(
      (row) => row.action === "released_to_manual_queue"
    ).length;
    const protectedAlertCount = rows.filter(
      (row) => row.action === "manual_protected_alert"
    ).length;

    return {
      vehicleId: targetVehicle.id,
      plateNo: targetVehicle.licensePlate,
      reason: input.reason,
      targetOperationStatus,
      affectedCount: rows.length,
      autoReassignedCount,
      manualQueueCount,
      protectedAlertCount,
      rows,
      message:
        rows.length === 0
          ? `车辆 ${targetVehicle.licensePlate} 已标记不可交付，暂无后续订单受影响。`
          : `车辆不可交付处理完成：影响 ${rows.length} 笔，自动改派 ${autoReassignedCount} 笔，人工队列 ${manualQueueCount} 笔，人工保护告警 ${protectedAlertCount} 笔。`
    };
  }

  async analyzeDispatchWithAi(
    input: StoreRentalAiDispatchAnalyzeRequest
  ): Promise<StoreRentalAiDispatchAnalysisResult> {
    const operator = input.operator || "营运端";
    const board = await this.getDispatchBoard(input);
    const taskPool = await this.listDispatchTasks(input);
    const analysisId = `ai_dispatch_${Date.now()}`;
    const promptVersion = "rimo-store-dispatch-agent-v1";
    const packetVersion = "dispatch-packet-v1";
    const highRiskTasks = taskPool.tasks.filter((task) => task.priority === "high");
    const riskRows: StoreRentalAiDispatchRiskRow[] =
      taskPool.tasks.length > 0
        ? taskPool.tasks.slice(0, 12).map((task) => ({
            riskType: this.dispatchTaskAiRiskType(task.taskType),
            orderNo: task.orderNo,
            description: task.reasonText,
            suggestion: this.dispatchTaskAiSuggestion(task),
            severity: task.priority === "high" ? "高" : task.priority === "medium" ? "中" : "低"
          }))
        : [
            {
              riskType: "调度基线",
              description:
                "当前筛选范围内未发现待派车、临近未硬锁或车辆不可交付任务。",
              suggestion: "保持现有规则优化结果，临近硬锁窗口前继续复核。",
              severity: "低"
            }
          ];
    const recommendations: StoreRentalAiDispatchRecommendation[] = taskPool.tasks
      .slice(0, 20)
      .map((task) => {
        const candidate = task.candidates[0];
        if (candidate && task.taskType !== "manual_protected_invalid") {
          return {
            orderId: task.orderId,
            orderNo: task.orderNo,
            action: task.taskType === "near_lock_unlocked" ? "hard_lock" : "preassign",
            targetVehicleId: candidate.vehicleId,
            targetVehicle: candidate.licensePlate,
            confidence: candidate.riskFlags.length ? "medium" : "high",
            reasonText: `推荐 ${candidate.licensePlate}，来自系统合法候选池，${candidate.reasonTags.join("、")}。`,
            applyReady: true
          };
        }
        return {
          orderId: task.orderId,
          orderNo: task.orderNo,
          action: "manual_review",
          confidence: "medium",
          reasonText: task.reasonText,
          applyReady: false
        };
      });
    const requestSummary = {
      promptVersion,
      packetVersion,
      windowDays: board.windowDays,
      storeScopeLabel: board.storeScopeLabel,
      orderCount: board.rows.length,
      candidateVehicleCount: board.metrics.candidateVehicles,
      manualTaskCount: taskPool.metrics.totalTasks,
      highRiskTaskCount: highRiskTasks.length
    };

    const event = await this.recordDispatchEvent({
      eventType: "ai_analysis",
      source: "ai",
      title: "AI 调度分析请求",
      planId: analysisId,
      reasonText:
        "MVP 已生成调度分析数据包并记录日志；真实模型调用保留在租户 AI 配置接入后启用。",
      riskLevel: highRiskTasks.length > 0 ? "high" : taskPool.tasks.length > 0 ? "medium" : "low",
      operator,
      payload: {
        requestSummary,
        riskRows,
        recommendations,
        systemPrompt:
          "你是门市租赁调度分析 Agent，只能在同车行、同车组、车辆状态、时间窗、硬锁和人工保护约束内输出建议，不得直接执行动作。"
      }
    });

    return {
      analysisId,
      generatedAt: new Date().toISOString(),
      mode: "mock",
      promptVersion,
      packetVersion,
      requestSummary,
      riskRows,
      recommendations,
      event,
      message: "AI 调度分析请求已记录。本期预留真实模型接入，推荐结果需人工确认后再按现有调度接口应用。"
    };
  }

  getIntegrationPlaceholders() {
    return [
      { key: "payment", name: "支付/预授权", mode: "mock", status: "reserved" },
      { key: "invoice", name: "电子发票", mode: "mock", status: "reserved" },
      { key: "sms", name: "短信通知", mode: "mock", status: "reserved" },
      { key: "tbox", name: "TBox 车控", mode: "mock", status: "reserved" },
      { key: "map", name: "地图/距离", mode: "mock", status: "reserved" },
      { key: "ai-dispatch", name: "AI 调度分析", mode: "mock", status: "reserved" }
    ];
  }

  getReservedClientEndpoints() {
    return {
      operation: [
        "/api/store-rental/rules",
        "/api/store-rental/stations",
        "/api/store-rental/vehicle-groups",
        "/api/store-rental/vehicles",
        "/api/store-rental/value-added-services",
        "/api/store-rental/pricing/plans",
        "/api/store-rental/pricing/quote",
        "/api/store-rental/workflow",
        "/api/store-rental/orders",
        "/api/store-rental/dispatch/board",
        "/api/store-rental/dispatch/tasks",
        "/api/store-rental/dispatch/events",
        "/api/store-rental/dispatch/vehicle-unavailable",
        "/api/store-rental/dispatch/ai-analysis"
      ],
      enterprise: ["/api/enterprise/store-rental/orders"],
      userH5: ["/api/h5/store-rental/availability", "/api/h5/store-rental/orders"]
    };
  }

  private async beginOrderOperation(
    order: StoreRentalOrderSummary,
    action: string,
    body: Record<string, unknown>
  ): Promise<{
    record?: StoreRentalOrderOperationRecord;
    duplicateResult?: StoreRentalOrderActionResult;
  }> {
    const idempotencyKey = this.optionalString(
      body.idempotencyKey ?? body.operationKey ?? body.requestId
    );
    const requestHash = this.orderActionRequestHash(action, body);
    const duplicate = this.useMysqlDataSource()
      ? await this.storeRentalRepository.findCompletedOrderOperationRecord({
          orderId: order.id,
          action,
          idempotencyKey,
          requestHash
        })
      : this.findMemoryCompletedOrderOperation(order.id, action, idempotencyKey, requestHash);
    const result = duplicate?.payload?.result as
      | StoreRentalOrderActionResult
      | undefined;
    if (result) {
      return {
        duplicateResult: {
          ...result,
          message: `幂等命中：${result.message}`
        }
      };
    }

    const now = new Date().toISOString();
    const record: StoreRentalOrderOperationRecord = {
      id: `order_operation_${randomUUID()}`,
      orderId: order.id,
      orderNo: order.orderNo,
      action,
      actionLabel: this.actionLabel(action),
      status: "processing",
      idempotencyKey,
      requestHash,
      lockStatus: order.operationLockStatus,
      operator: String(body.operator ?? "门店营运"),
      expiresAt: order.operationLockExpiresAt,
      createdAt: now,
      payload: {
        request: this.operationRecordPayload(body)
      }
    };
    await this.persistOrderOperationRecord(record);
    return { record };
  }

  private async completeOrderOperation(
    record: StoreRentalOrderOperationRecord,
    result: StoreRentalOrderActionResult,
    order: StoreRentalOrderSummary
  ) {
    const completed: StoreRentalOrderOperationRecord = {
      ...record,
      status: "completed",
      lockStatus: order.operationLockStatus,
      expiresAt: order.operationLockExpiresAt,
      completedAt: new Date().toISOString(),
      message: result.message,
      payload: {
        ...(record.payload ?? {}),
        result
      }
    };
    await this.persistOrderOperationRecord(completed);
  }

  private async persistOrderOperationRecord(
    record: StoreRentalOrderOperationRecord
  ) {
    if (this.useMysqlDataSource()) {
      const existing = record.completedAt || record.status !== "processing";
      if (existing) {
        await this.storeRentalRepository.updateOrderOperationRecord(record);
      } else {
        await this.storeRentalRepository.createOrderOperationRecord(record);
      }
      return;
    }

    const records = this.orderOperationRecords.get(record.orderId) ?? [];
    const index = records.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      records[index] = record;
    } else {
      records.unshift(record);
    }
    this.orderOperationRecords.set(record.orderId, records.slice(0, 80));
  }

  private findMemoryCompletedOrderOperation(
    orderId: string,
    action: string,
    idempotencyKey: string | undefined,
    requestHash: string
  ) {
    return (this.orderOperationRecords.get(orderId) ?? []).find(
      (record) =>
        record.action === action &&
        record.status === "completed" &&
        (idempotencyKey
          ? record.idempotencyKey === idempotencyKey
          : record.requestHash === requestHash)
    );
  }

  private ensureOrderOperationLock(
    order: StoreRentalOrderSummary,
    action: string,
    body: Record<string, unknown>
  ) {
    if (!this.ruleConfig.pickupReturn.operationLockEnabled) {
      return;
    }
    const operator = String(body.operator ?? "门店营运");
    const expiresAt = order.operationLockExpiresAt
      ? new Date(order.operationLockExpiresAt)
      : undefined;
    const activeLock =
      order.operationLockStatus === OperationLockStatus.Active &&
      expiresAt &&
      expiresAt.getTime() > Date.now();

    if (action === "start-pickup" && activeLock) {
      throw new BadRequestException(
        `订单正在由 ${order.operationLockOperator || "其他同事"} 处理，请等待锁释放或由管理员覆盖。`
      );
    }

    if (["pickup-inspection", "reject-order"].includes(action)) {
      if (!activeLock) {
        throw new BadRequestException("取车操作锁已失效，请重新开始取车后再提交。");
      }
      if (
        order.operationLockOperator &&
        order.operationLockOperator !== operator &&
        body.overrideOperationLock !== true
      ) {
        throw new BadRequestException(
          `订单取车操作锁属于 ${order.operationLockOperator}，当前操作人不能直接提交。`
        );
      }
    }
  }

  private async recordOrderNotificationForAction(
    order: StoreRentalOrderSummary,
    action: string,
    body: Record<string, unknown>,
    result: StoreRentalOrderActionResult
  ) {
    const spec = this.orderNotificationSpec(action, result);
    if (!spec) {
      return;
    }
    const record: StoreRentalOrderNotificationRecord = {
      id: `order_notification_${randomUUID()}`,
      orderId: order.id,
      orderNo: order.orderNo,
      event: spec.event,
      eventLabel: spec.eventLabel,
      channel: "sms",
      targetMasked: order.customerPhoneMasked || "客户联系方式快照",
      status: "sent",
      templateCode: spec.templateCode,
      contentSummary: spec.contentSummary,
      operator: String(body.operator ?? "系统"),
      relatedAction: action,
      idempotencyKey: this.optionalString(
        body.idempotencyKey ?? body.operationKey ?? body.requestId
      ),
      sentAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      payload: {
        mockProvider: "notification-mock",
        nextStatus: result.nextStatus,
        nextPaymentStatus: result.nextPaymentStatus,
        nextDispatchStatus: result.nextDispatchStatus
      }
    };
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.createOrderNotificationRecord(record);
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: record.createdAt,
        actor: record.operator || "系统",
        action: `客户通知：${record.eventLabel}（${record.channel} mock ${record.status}）`
      });
      return;
    }
    const records = this.orderNotificationRecords.get(order.id) ?? [];
    records.unshift(record);
    this.orderNotificationRecords.set(order.id, records.slice(0, 80));
    this.appendOrderTimeline(
      order,
      record.operator || "系统",
      `客户通知：${record.eventLabel}（${record.channel} mock ${record.status}）`
    );
  }

  private orderNotificationSpec(
    action: string,
    result: StoreRentalOrderActionResult
  ):
    | {
        event: string;
        eventLabel: string;
        templateCode: string;
        contentSummary: string;
      }
    | undefined {
    const map: Record<
      string,
      { event: string; eventLabel: string; templateCode: string; summary: string }
    > = {
      "payment-success": {
        event: "payment_success",
        eventLabel: "支付/预授权成功通知",
        templateCode: "store_order_payment_success",
        summary: "订单已完成支付或预授权，通知客户取车安排。"
      },
      "start-pickup": {
        event: "pickup_started",
        eventLabel: "开始取车通知",
        templateCode: "store_order_pickup_started",
        summary: "门店已开始取车流程，提醒客户配合验车和签署。"
      },
      "pickup-inspection": {
        event: "pickup_confirmed",
        eventLabel: "取车完成通知",
        templateCode: "store_order_pickup_confirmed",
        summary: "取车验车完成，通知客户租期和车辆已生效。"
      },
      "extend-rental": {
        event: "rental_extended",
        eventLabel: "延长用车通知",
        templateCode: "store_order_rental_extended",
        summary: "订单已延长用车，通知客户新的还车安排和费用处理。"
      },
      "redirect-order": {
        event: "vehicle_redirected",
        eventLabel: "车辆改派通知",
        templateCode: "store_order_vehicle_redirected",
        summary: "订单车辆已改派，通知客户以最新车辆信息为准。"
      },
      "change-return-store": {
        event: "return_store_changed",
        eventLabel: "还车门市变更通知",
        templateCode: "store_order_return_store_changed",
        summary: "订单还车门市已变更，通知客户新的还车地点。"
      },
      "change-return-station": {
        event: "return_station_changed",
        eventLabel: "还车据点变更通知",
        templateCode: "store_order_return_station_changed",
        summary: "订单还车据点已变更，通知客户新的还车据点。"
      },
      "return-inspection": {
        event: "return_inspection_done",
        eventLabel: "还车验车通知",
        templateCode: "store_order_return_inspection_done",
        summary: "还车验车已完成，通知客户等待结算。"
      },
      "confirm-settlement": {
        event: "settlement_confirmed",
        eventLabel: "结算确认通知",
        templateCode: "store_order_settlement_confirmed",
        summary: "订单结算已确认，通知客户费用结果。"
      },
      "register-accident": {
        event: "accident_registered",
        eventLabel: "事故登记通知",
        templateCode: "store_order_accident_registered",
        summary: "订单已登记事故/出险，通知客户后续处理口径。"
      },
      "mark-no-show": {
        event: "no_show_marked",
        eventLabel: "爽约通知",
        templateCode: "store_order_no_show_marked",
        summary: "订单已标记爽约，通知客户费用和资源释放结果。"
      },
      "reject-order": {
        event: "fulfillment_rejected",
        eventLabel: "拒绝履约通知",
        templateCode: "store_order_fulfillment_rejected",
        summary: "门店已拒绝履约，通知客户原因和费用处理。"
      },
      "close-order": {
        event: "order_closed",
        eventLabel: "关闭订单通知",
        templateCode: "store_order_closed",
        summary: "订单已关闭，通知客户退款或企业月结处理结果。"
      },
      cancel: {
        event: "order_cancelled",
        eventLabel: "取消订单通知",
        templateCode: "store_order_cancelled",
        summary: "订单已取消，通知客户费用、预授权和资源释放结果。"
      }
    };
    const matched = map[action];
    if (!matched) {
      return undefined;
    }
    return {
      event: matched.event,
      eventLabel: matched.eventLabel,
      templateCode: matched.templateCode,
      contentSummary: `${matched.summary} 当前状态：${result.nextStatus}。`
    };
  }

  private orderActionRequestHash(action: string, body: Record<string, unknown>) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          action,
          payload: this.stableOperationPayload(body)
        })
      )
      .digest("hex");
  }

  private stableOperationPayload(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.stableOperationPayload(item));
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) =>
            !["idempotencyKey", "operationKey", "requestId"].includes(key)
        )
        .sort(([left], [right]) => left.localeCompare(right));
      return Object.fromEntries(
        entries.map(([key, item]) => [key, this.stableOperationPayload(item)])
      );
    }
    return value;
  }

  private operationRecordPayload(body: Record<string, unknown>) {
    const payload = this.stableOperationPayload(body);
    return payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : { value: payload };
  }

  private async recordDispatchEvent(
    input: Omit<StoreRentalDispatchEvent, "id" | "createdAt">
  ) {
    const event: StoreRentalDispatchEvent = {
      id: `dispatch_event_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...input
    };

    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.createDispatchEvent(event);
      return event;
    }

    this.dispatchEvents.unshift(event);
    if (this.dispatchEvents.length > 300) {
      this.dispatchEvents.splice(300);
    }
    return event;
  }

  private buildDispatchTasksForOrder(
    order: StoreRentalOrderSummary,
    row: StoreRentalDispatchOrderRow,
    vehicles: VehicleInstanceSummary[],
    orders: StoreRentalOrderSummary[],
    stations: StoreStationSummary[],
    vehicleGroups: VehicleGroupMaster[],
    referenceDate: Date,
    latestEvent?: StoreRentalDispatchEvent
  ): StoreRentalDispatchTask[] {
    if (
      ![OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue].includes(
        order.mainStatus
      )
    ) {
      return [];
    }

    const createTask = (
      taskType: StoreRentalDispatchTask["taskType"],
      priority: StoreRentalDispatchTask["priority"],
      title: string,
      description: string,
      reasonText: string
    ): StoreRentalDispatchTask => ({
      id: `dispatch_task_${order.id}_${taskType}`,
      taskType,
      priority,
      title,
      description,
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      pickupAt: order.pickupAt,
      returnAt: order.returnAt,
      pickupStoreName: order.pickupStoreName,
      vehicleGroupName: order.vehicleGroupName,
      currentPlateNo: order.plateNo,
      mainStatus: order.mainStatus,
      dispatchStatus: order.dispatchStatus,
      dueAt: order.pickupAt,
      reasonText,
      candidates: row.candidates,
      latestEvent
    });

    if (order.dispatchStatus === DispatchStatus.ManualRequired) {
      return [
        createTask(
          "manual_required",
          row.nearLock ? "high" : "medium",
          "人工调度待处理",
          "订单已进入人工调度队列，需要调度员选择车辆或走订单改派流程。",
          "无可用车辆、硬锁失败或异常改派失败。"
        )
      ];
    }

    const assignedVehicle = order.plateNo
      ? vehicles.find((vehicle) => vehicle.licensePlate === order.plateNo)
      : undefined;
    const invalidReason = assignedVehicle
      ? this.validateDispatchPreAssignment(
          order,
          assignedVehicle,
          orders,
          vehicles,
          stations,
          vehicleGroups,
          referenceDate,
          true
        )
      : undefined;

    if (
      invalidReason &&
      [DispatchStatus.ManualReassigned, DispatchStatus.Upgraded].includes(
        order.dispatchStatus
      )
    ) {
      return [
        createTask(
          "manual_protected_invalid",
          "high",
          "人工结果已失效",
          "人工改派或免费升等结果被车辆禁用、受控、维保、事故或时间窗冲突打断，需要人工重新处理。",
          invalidReason
        )
      ];
    }

    if (
      invalidReason &&
      [DispatchStatus.PreAssigned, DispatchStatus.Locked].includes(
        order.dispatchStatus
      )
    ) {
      return [
        createTask(
          "vehicle_unavailable",
          "high",
          "车辆不可交付",
          "订单已绑定车辆，但当前车辆不再满足派车或硬锁条件，需要解除占用并重新派车。",
          invalidReason
        )
      ];
    }

    if (
      row.nearLock &&
      ![DispatchStatus.Locked, DispatchStatus.ManualReassigned, DispatchStatus.Upgraded].includes(
        order.dispatchStatus
      )
    ) {
      return [
        createTask(
          "near_lock_unlocked",
          "high",
          "临近取车未硬锁",
          "订单已进入取车前硬锁保护窗口，不能再参与批量优化，需要立即硬锁或人工改派。",
          "临近取车保护窗口内尚未完成硬锁。"
        )
      ];
    }

    if (!order.plateNo || order.dispatchStatus === DispatchStatus.Pending) {
      return [
        createTask(
          "unassigned",
          "medium",
          "待派车",
          "订单已锁定车组库存，但尚未绑定具体可交付车辆。",
          "等待预分配或人工派车。"
        )
      ];
    }

    return [];
  }

  private defaultUnavailableOperationStatus(
    reason: StoreRentalDispatchVehicleUnavailableRequest["reason"]
  ): "controlled" | "maintenance" | "disabled" {
    if (reason === "disabled") {
      return "disabled";
    }
    if (reason === "maintenance") {
      return "maintenance";
    }
    return "controlled";
  }

  private vehicleUnavailableReasonText(
    reason: StoreRentalDispatchVehicleUnavailableRequest["reason"]
  ) {
    const map: Record<StoreRentalDispatchVehicleUnavailableRequest["reason"], string> = {
      disabled: "车辆禁用",
      controlled: "车辆被管控",
      maintenance: "车辆维保",
      accident: "事故/出险",
      license_issue: "证照异常",
      insurance_issue: "保险异常",
      cleaning_unready: "整备未完成",
      other: "其他不可交付原因"
    };
    return map[reason] ?? "车辆不可交付";
  }

  private async markVehicleUnavailableForDispatch(
    plateNo: string,
    status: "controlled" | "maintenance" | "disabled",
    operator: string,
    reason: string
  ) {
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        plateNo,
        status,
        {
          operator,
          action: "调度标记车辆不可交付",
          reason
        }
      );
      return;
    }
    this.updateVehicleOperationStatus(plateNo, status);
  }

  private dispatchTaskAiRiskType(taskType: StoreRentalDispatchTask["taskType"]) {
    const map: Record<StoreRentalDispatchTask["taskType"], string> = {
      unassigned: "待派车",
      near_lock_unlocked: "临近未硬锁",
      manual_required: "人工调度",
      vehicle_unavailable: "车辆不可交付",
      manual_protected_invalid: "人工结果失效"
    };
    return map[taskType];
  }

  private dispatchTaskAiSuggestion(task: StoreRentalDispatchTask) {
    if (task.taskType === "near_lock_unlocked") {
      return task.candidates.length > 0
        ? "立即执行硬锁复核，应用前再次校验车辆状态和时间窗。"
        : "无合法候选车辆，保留人工调度并联系门店协调。";
    }
    if (
      task.taskType === "vehicle_unavailable" ||
      task.taskType === "manual_protected_invalid"
    ) {
      return task.candidates.length > 0
        ? "按同门市同车组候选池改派；人工结果保护订单需调度员确认。"
        : "释放不可交付车辆占用，进入人工调度队列。";
    }
    if (task.taskType === "manual_required") {
      return "由调度员确认改派、免费升等或线下处理方案。";
    }
    return task.candidates.length > 0
      ? "先预分配首选候选车辆，临近硬锁前再复核。"
      : "暂无候选车辆，保持人工关注。";
  }

  private async getDispatchDataset() {
    if (this.useMysqlDataSource()) {
      const [orders, vehicles, vehicleGroups, stations] = await Promise.all([
        this.storeRentalRepository.listOrders({}),
        this.storeRentalRepository.listVehicles(),
        this.storeRentalRepository.listVehicleGroups(),
        this.storeRentalRepository.listStations()
      ]);

      return { orders, vehicles, vehicleGroups, stations };
    }

    return {
      orders: this.orders,
      vehicles: this.vehicles,
      vehicleGroups: this.vehicleGroupMasters,
      stations: this.stations
    };
  }

  private normalizeDispatchWindowDays(value?: number): 3 | 7 | 14 {
    return value === 3 || value === 14 ? value : 7;
  }

  private normalizeDispatchReferenceDate(value?: string) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
      return new Date();
    }
    return date;
  }

  private dispatchTurnoverMinutes() {
    return (
      this.ruleConfig.pickupReturn.turnaroundMinutes ||
      this.ruleConfig.dispatch.minTurnoverMinutes ||
      60
    );
  }

  private dispatchHardLockProtectionHours() {
    return 2;
  }

  private isDispatchBoardOrder(order: StoreRentalOrderSummary) {
    return [
      OrderMainStatus.Reserved,
      OrderMainStatus.PickupOverdue,
      OrderMainStatus.Inspecting,
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue,
      OrderMainStatus.AccidentProcessing,
      OrderMainStatus.SettlementPending,
      OrderMainStatus.PaymentDue,
      OrderMainStatus.RefundPending
    ].includes(order.mainStatus);
  }

  private matchesDispatchScope(
    order: StoreRentalOrderSummary,
    scope: { storeName?: string; vehicleGroupName?: string }
  ) {
    if (scope.storeName && order.pickupStoreName !== scope.storeName) {
      return false;
    }
    if (scope.vehicleGroupName && order.vehicleGroupName !== scope.vehicleGroupName) {
      return false;
    }
    return true;
  }

  private buildDispatchOrderRow(
    order: StoreRentalOrderSummary,
    vehicles: VehicleInstanceSummary[],
    orders: StoreRentalOrderSummary[],
    stations: StoreStationSummary[],
    vehicleGroups: VehicleGroupMaster[],
    referenceDate: Date
  ): StoreRentalDispatchOrderRow {
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      pickupAt: order.pickupAt,
      returnAt: order.returnAt,
      pickupStoreName: order.pickupStoreName,
      returnStoreName: order.returnStoreName,
      vehicleGroupName: order.vehicleGroupName,
      currentPlateNo: order.plateNo,
      mainStatus: order.mainStatus,
      dispatchStatus: order.dispatchStatus,
      totalAmount: order.totalAmount,
      occupancyHours: this.dispatchOccupancyHours(order),
      nearLock: this.isDispatchNearLock(order, referenceDate),
      riskFlags: order.riskFlags,
      candidates: this.buildDispatchCandidates(
        order,
        vehicles,
        orders,
        stations,
        vehicleGroups,
        referenceDate
      ).slice(0, 8)
    };
  }

  private dispatchOrderSort(
    left: StoreRentalOrderSummary,
    right: StoreRentalOrderSummary
  ) {
    const occupancyDelta =
      this.dispatchOccupancyHours(right) - this.dispatchOccupancyHours(left);
    if (occupancyDelta !== 0) {
      return occupancyDelta;
    }
    if (right.totalAmount !== left.totalAmount) {
      return right.totalAmount - left.totalAmount;
    }
    const pickupDelta =
      new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime();
    if (pickupDelta !== 0) {
      return pickupDelta;
    }
    return left.id.localeCompare(right.id);
  }

  private dispatchOccupancyHours(order: StoreRentalOrderSummary) {
    const window = this.dispatchBufferedWindow(order);
    return Math.max(0, (window.to.getTime() - window.from.getTime()) / 3_600_000);
  }

  private dispatchBufferedWindow(order: StoreRentalOrderSummary) {
    const bufferMs = this.dispatchTurnoverMinutes() * 60_000;
    return {
      from: new Date(new Date(order.pickupAt).getTime() - bufferMs),
      to: new Date(new Date(order.returnAt).getTime() + bufferMs)
    };
  }

  private isDispatchNearLock(order: StoreRentalOrderSummary, referenceDate: Date) {
    const diffMs = new Date(order.pickupAt).getTime() - referenceDate.getTime();
    return (
      diffMs >= 0 &&
      diffMs <= this.dispatchHardLockProtectionHours() * 3_600_000
    );
  }

  private buildDispatchCandidates(
    order: StoreRentalOrderSummary,
    vehicles: VehicleInstanceSummary[],
    orders: StoreRentalOrderSummary[],
    stations: StoreStationSummary[],
    vehicleGroups: VehicleGroupMaster[],
    referenceDate: Date,
    simulation = new Map<string, Array<{ from: Date; to: Date }>>(),
    simulationRevenue = new Map<string, number>()
  ): StoreRentalDispatchCandidate[] {
    const requiredServiceType: VehicleInstanceSummary["currentServiceType"] =
      order.mode === StoreRentalMode.SelfService24h ? "STORE_24H" : "STORE_STANDARD";
    const window = this.dispatchBufferedWindow(order);

    return vehicles
      .filter((vehicle) =>
        this.vehicleGroupsEquivalent(
          order.vehicleGroupName,
          vehicle.vehicleGroupName,
          vehicleGroups
        )
      )
      .filter((vehicle) => vehicle.enabled)
      .filter(
        (vehicle) =>
          !["controlled", "maintenance", "disabled"].includes(
            vehicle.operationStatus
          )
      )
      .filter((vehicle) => vehicle.currentStoreName === order.pickupStoreName)
      .filter((vehicle) => vehicle.serviceTypes.includes(requiredServiceType))
      .filter((vehicle) =>
        this.stationCanServeStoreRental(
          vehicle.currentStationName,
          requiredServiceType,
          stations
        )
      )
      .filter(
        (vehicle) =>
          !this.findDispatchScheduleConflict(
            orders,
            order.id,
            vehicle.licensePlate,
            window
          )
      )
      .filter(
        (vehicle) =>
          !(simulation.get(vehicle.licensePlate) ?? []).some((item) =>
            this.periodOverlaps(window.from, window.to, item.from, item.to)
          )
      )
      .map((vehicle) => {
        const score = this.dispatchVehicleScore(
          vehicle,
          orders,
          vehicleGroups,
          simulationRevenue,
          referenceDate
        );
        return {
          vehicleId: vehicle.id,
          licensePlate: vehicle.licensePlate,
          vehicleGroupName: vehicle.vehicleGroupName,
          currentStoreName: vehicle.currentStoreName,
          currentStationName: vehicle.currentStationName,
          operationStatus: vehicle.operationStatus,
          score,
          scoreText: score.toFixed(2),
          reasonTags: [
            "同门市",
            "同车组",
            vehicle.operationStatus === "idle" ? "当前空闲" : "未来可接续"
          ],
          riskFlags: [
            ...(vehicle.operationStatus !== "idle" ? ["当前非空闲，需按排程接续"] : []),
            ...(vehicle.isSpecial ? ["特殊车辆，需人工确认"] : [])
          ]
        };
      })
      .sort((left, right) => left.score - right.score);
  }

  private dispatchVehicleScore(
    vehicle: VehicleInstanceSummary,
    orders: StoreRentalOrderSummary[],
    vehicleGroups: VehicleGroupMaster[],
    simulationRevenue = new Map<string, number>(),
    referenceDate = new Date()
  ) {
    const group = this.findVehicleGroupForVehicle(vehicle.vehicleGroupName, vehicleGroups);
    const monthlyCost = Math.max((group?.dailyPrice ?? 500) * 20, 1);
    const month = referenceDate.getMonth();
    const year = referenceDate.getFullYear();
    const assignedRevenue = orders
      .filter((order) => order.plateNo === vehicle.licensePlate)
      .filter((order) => {
        const pickupAt = new Date(order.pickupAt);
        return pickupAt.getMonth() === month && pickupAt.getFullYear() === year;
      })
      .reduce((total, order) => total + order.totalAmount, 0);
    const revenueRatio =
      (assignedRevenue + (simulationRevenue.get(vehicle.licensePlate) ?? 0)) /
      monthlyCost;

    return 1 + revenueRatio;
  }

  private findDispatchScheduleConflict(
    orders: StoreRentalOrderSummary[],
    excludeOrderId: string,
    targetPlateNo: string,
    window: { from: Date; to: Date }
  ) {
    return orders.find((item) => {
      if (
        item.id === excludeOrderId ||
        item.plateNo !== targetPlateNo ||
        !this.orderOccupiesInventory(item)
      ) {
        return false;
      }
      const itemWindow = this.dispatchBufferedWindow(item);
      return this.periodOverlaps(
        window.from,
        window.to,
        itemWindow.from,
        itemWindow.to
      );
    });
  }

  private reserveDispatchSimulation(
    order: StoreRentalOrderSummary,
    plateNo: string,
    simulation: Map<string, Array<{ from: Date; to: Date }>>
  ) {
    const current = simulation.get(plateNo) ?? [];
    current.push(this.dispatchBufferedWindow(order));
    simulation.set(plateNo, current);
  }

  private dispatchResultRow(
    order: StoreRentalOrderSummary,
    input: {
      targetVehicle?: string;
      targetVehicleId?: string;
      resultStatus: DispatchOptimizationResultStatus;
      reasonCode: DispatchOptimizationReasonCode;
      reasonText: string;
      reasonDetail?: string;
      riskLevel: "low" | "medium" | "high";
      nearLock: boolean;
    }
  ): StoreRentalDispatchResultRow {
    return {
      id: `dispatch_row_${order.id}_${input.reasonCode}`,
      orderId: order.id,
      orderNo: order.orderNo,
      customerName: order.customerName,
      pickupAt: order.pickupAt,
      returnAt: order.returnAt,
      vehicleGroupName: order.vehicleGroupName,
      beforeVehicle: order.plateNo,
      targetVehicle: input.targetVehicle,
      targetVehicleId: input.targetVehicleId,
      resultStatus: input.resultStatus,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      reasonDetail: input.reasonDetail,
      riskLevel: input.riskLevel,
      nearLock: input.nearLock
    };
  }

  private failedDispatchRow(
    row: StoreRentalDispatchResultRow,
    reasonCode: DispatchOptimizationReasonCode,
    failureReason: string
  ): StoreRentalDispatchResultRow {
    return {
      ...row,
      resultStatus: "failed",
      reasonCode,
      reasonText:
        reasonCode === "SKIP_NO_VEHICLE" ? "无可用车辆" : "应用校验失败",
      riskLevel: "high",
      applied: false,
      failureReason
    };
  }

  private validateDispatchPreAssignment(
    order: StoreRentalOrderSummary,
    targetVehicle: VehicleInstanceSummary,
    orders: StoreRentalOrderSummary[],
    vehicles: VehicleInstanceSummary[],
    stations: StoreStationSummary[],
    vehicleGroups: VehicleGroupMaster[],
    referenceDate: Date,
    allowManual = false
  ) {
    if (!allowManual) {
      if (order.mainStatus !== OrderMainStatus.Reserved) {
        return "订单仍为已预订状态时才允许应用预分配优化。";
      }
      if (
        ![DispatchStatus.Pending, DispatchStatus.PreAssigned].includes(
          order.dispatchStatus
        )
      ) {
        return "订单派车状态已变化，不能应用本次优化结果。";
      }
      if (this.isDispatchNearLock(order, referenceDate)) {
        return "订单已进入临近取车保护窗口，不能批量应用预分配。";
      }
    }

    if (
      !this.vehicleGroupsEquivalent(
        order.vehicleGroupName,
        targetVehicle.vehicleGroupName,
        vehicleGroups
      )
    ) {
      return "目标车辆不属于订单预订车组。";
    }
    if (!targetVehicle.enabled) {
      return "目标车辆未启用。";
    }
    if (
      ["controlled", "maintenance", "disabled"].includes(
        targetVehicle.operationStatus
      )
    ) {
      return "目标车辆当前不可参与派车。";
    }
    if (targetVehicle.currentStoreName !== order.pickupStoreName) {
      return "本期不支持跨门市自动派车或调拨。";
    }
    const requiredServiceType: VehicleInstanceSummary["currentServiceType"] =
      order.mode === StoreRentalMode.SelfService24h ? "STORE_24H" : "STORE_STANDARD";
    if (!targetVehicle.serviceTypes.includes(requiredServiceType)) {
      return "目标车辆不支持当前订单服务类型。";
    }
    if (
      !this.stationCanServeStoreRental(
        targetVehicle.currentStationName,
        requiredServiceType,
        stations
      )
    ) {
      return "目标车辆所在据点未开启当前服务能力。";
    }
    const currentVehicle = vehicles.find(
      (vehicle) => vehicle.licensePlate === order.plateNo
    );
    if (
      currentVehicle?.assetCompanyName &&
      targetVehicle.assetCompanyName &&
      currentVehicle.assetCompanyName !== targetVehicle.assetCompanyName
    ) {
      return "本期不支持跨车行调度。";
    }
    const conflict = this.findDispatchScheduleConflict(
      orders,
      order.id,
      targetVehicle.licensePlate,
      this.dispatchBufferedWindow(order)
    );
    if (conflict) {
      return `目标车辆在订单时段与 ${conflict.orderNo} 冲突。`;
    }
    return undefined;
  }

  private async persistDispatchAssignment(
    order: StoreRentalOrderSummary,
    targetVehicle: VehicleInstanceSummary,
    input: {
      dispatchStatus: DispatchStatus;
      operator: string;
      action: string;
      note?: string;
      timelineAction: string;
    }
  ) {
    const previousPlateNo = order.plateNo;
    const previousVehicle = this.useMysqlDataSource()
      ? undefined
      : this.vehicles.find((vehicle) => vehicle.licensePlate === previousPlateNo);
    order.plateNo = targetVehicle.licensePlate;
    order.vehicleGroupName = targetVehicle.vehicleGroupName;
    order.dispatchStatus = input.dispatchStatus;
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter(
        (flag) => flag !== "人工调度" && flag !== "硬锁失败"
      ),
      [input.action]
    );

    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.updateOrderState(order);
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: input.operator,
        action: input.timelineAction
      });
      const vehicles = await this.storeRentalRepository.listVehicles();
      const storedPrevious = vehicles.find(
        (vehicle) => vehicle.licensePlate === previousPlateNo
      );
      if (
        previousPlateNo &&
        previousPlateNo !== targetVehicle.licensePlate &&
        storedPrevious?.operationStatus === "reserved"
      ) {
        await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
          previousPlateNo,
          "idle",
          {
            operator: input.operator,
            action: "释放调度预分配车辆",
            reason: order.orderNo
          }
        );
      }
      if (targetVehicle.operationStatus === "idle") {
        await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
          targetVehicle.licensePlate,
          "reserved",
          {
            operator: input.operator,
            action: input.action,
            reason: order.orderNo
          }
        );
      }
      return;
    }

    if (
      previousPlateNo &&
      previousPlateNo !== targetVehicle.licensePlate &&
      previousVehicle?.operationStatus === "reserved"
    ) {
      this.updateVehicleOperationStatus(previousPlateNo, "idle");
    }
    if (targetVehicle.operationStatus === "idle") {
      this.updateVehicleOperationStatus(targetVehicle.licensePlate, "reserved");
    }
    this.appendOrderTimeline(order, input.operator, input.timelineAction);
  }

  private async persistDispatchOrderOnly(
    order: StoreRentalOrderSummary,
    operator: string,
    timelineAction: string
  ) {
    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.updateOrderState(order);
      await this.storeRentalRepository.appendOrderTimeline(order.id, {
        at: new Date().toISOString(),
        actor: operator,
        action: timelineAction
      });
      return;
    }
    this.appendOrderTimeline(order, operator, timelineAction);
  }

  private defaultTimeline(order: StoreRentalOrderSummary): StoreRentalOrderTimelineItem[] {
    return [
      {
        at: "2026-05-05T18:04:00+08:00",
        actor: "系统",
        action: "创建订单并锁定价格快照"
      },
      {
        at: "2026-05-05T18:07:00+08:00",
        actor: "调度规则",
        action:
          order.dispatchStatus === DispatchStatus.ManualRequired
            ? "未自动派车，等待人工确认"
            : "按车型组预派车辆"
      },
      {
        at: "2026-05-06T09:40:00+08:00",
        actor: "门店营运",
        action:
          order.mainStatus === OrderMainStatus.Renting
            ? "完成取车验车记录"
            : "等待下一步门店操作"
      }
    ];
  }

  private memoryFulfillmentRecords(orderId: string): StoreRentalOrderFulfillmentRecords {
    return {
      contracts: this.orderContracts.get(orderId) ?? [],
      notifications: this.orderNotifications.get(orderId) ?? [],
      remarks: this.orderRemarks.get(orderId) ?? [],
      operationLocks: this.orderOperationLocks.get(orderId) ?? [],
      idempotencyRecords: this.orderIdempotencyRecords.get(orderId) ?? []
    };
  }

  private prependMemoryRecord<T extends { id: string }>(
    store: Map<string, T[]>,
    orderId: string,
    record: T
  ) {
    const records = store.get(orderId) ?? [];
    store.set(orderId, [record, ...records].slice(0, 100));
  }

  private orderFulfillmentSnapshot(order: StoreRentalOrderSummary) {
    return {
      orderNo: order.orderNo,
      mainStatus: order.mainStatus,
      paymentStatus: order.paymentStatus,
      dispatchStatus: order.dispatchStatus,
      billingMode: order.billingMode,
      customerName: order.customerName,
      customerPhoneMasked: order.customerPhoneMasked,
      vehicleGroupName: order.vehicleGroupName,
      plateNo: order.plateNo,
      pickupStoreName: order.pickupStoreName,
      returnStoreName: order.returnStoreName,
      pickupAt: order.pickupAt,
      returnAt: order.returnAt
    };
  }

  private contractTypeLabel(type: StoreRentalContractRecord["type"]) {
    const labels: Record<StoreRentalContractRecord["type"], string> = {
      rental_contract: "租赁合约",
      pickup_sheet: "取车交接单",
      return_sheet: "还车交接单",
      settlement_sheet: "结算单"
    };

    return labels[type];
  }

  private contractStatusLabel(status: StoreRentalContractRecord["status"]) {
    const labels: Record<StoreRentalContractRecord["status"], string> = {
      pending: "待签署",
      signed: "已签署",
      fallback_uploaded: "线下纸本已上传",
      voided: "已作废"
    };

    return labels[status];
  }

  private notificationSceneLabel(scene: StoreRentalNotificationRecord["scene"]) {
    const labels: Record<StoreRentalNotificationRecord["scene"], string> = {
      order_created: "订单创建",
      pickup_completed: "取车完成",
      return_completed: "还车完成",
      payment_due: "待补缴",
      post_charge: "完成后追缴",
      order_terminal: "订单终止",
      manual: "人工通知"
    };

    return labels[scene];
  }

  private remarkCategoryLabel(category: StoreRentalOrderRemarkRecord["category"]) {
    const labels: Record<StoreRentalOrderRemarkRecord["category"], string> = {
      general: "通用",
      pickup: "取车",
      return: "还车",
      finance: "财务",
      risk: "风险",
      customer_followup: "客户跟进"
    };

    return labels[category];
  }

  private async recordOrderActionFulfillmentSideEffects(
    order: StoreRentalOrderSummary,
    action: string,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ) {
    const operator = String(body.operator ?? "门店营运");
    const idempotencyKey = this.optionalString(body.idempotencyKey);
    const snapshot = {
      ...this.orderFulfillmentSnapshot(order),
      previousStatus,
      action
    };

    if (action === "start-pickup") {
      await this.persistOperationLockRecord(order, {
        stage: "pickup",
        status: OperationLockStatus.Active,
        operator,
        expiresAt: order.operationLockExpiresAt,
        idempotencyKey,
        payload: snapshot
      });
      return;
    }

    if (action === "pickup-inspection") {
      const signed = body.contractSigned !== false;
      await this.persistEventSnapshotRecord(order, {
        eventType: "pickup_qualification",
        title: "取车身份与优惠资格核验",
        triggerReason: this.optionalString(body.marketingVerificationReason) || "门店取车现场核验",
        settlementTarget:
          this.optionalString(body.marketingVerificationResult) === "failed"
            ? "取车尾款补收"
            : "不调整费用",
        before: {
          marketingPlanName: this.optionalString(body.originalMarketingPlan),
          customerName: order.customerName
        },
        after: {
          driverName: this.optionalString(body.driverName) || order.customerName,
          identityMatched: body.identityMatched === true,
          licenseValidUntil: this.optionalString(body.licenseValidUntil),
          marketingVerificationResult:
            this.optionalString(body.marketingVerificationResult) || "passed",
          changedMarketingPlan: this.optionalString(body.changedMarketingPlan)
        },
        payload: {
          ...snapshot,
          identityNoMasked: this.optionalString(body.identityNoMasked),
          proofFileCount: this.optionalNumber(body.proofFileCount) ?? 0,
          riskChecked: body.riskChecked === true,
          externalRiskProvider: "reserved"
        },
        operator
      });
      await this.persistEventSnapshotRecord(order, {
        eventType: "pickup_fund",
        title: "取车押金与尾款确认",
        triggerReason: "确认发车前资金校验",
        settlementTarget:
          order.billingMode === BillingMode.Monthly ? "企业月结" : "取车尾款",
        amount: this.optionalNumber(body.pickupBalanceDue) ?? 0,
        amountBreakdown: {
          orderTotalAmount: order.totalAmount,
          preAuthAmount: this.optionalNumber(body.preAuthAmount),
          preAuthMode: this.optionalString(body.preAuthMode),
          preAuthStatus: this.optionalString(body.preAuthStatus),
          pickupBalanceDue: this.optionalNumber(body.pickupBalanceDue) ?? 0,
          balancePaid: body.balancePaid === true,
          monthlyBillingConfirmed: body.monthlyBillingConfirmed === true
        },
        payload: {
          ...snapshot,
          paymentProvider: "reserved",
          externalPaymentSkipped: true
        },
        operator
      });
      await this.persistEventSnapshotRecord(order, {
        eventType: "pickup_delivery",
        title: "取车交付快照",
        triggerReason: "确认发车",
        settlementTarget: "履约事件",
        after: {
          plateNo: order.plateNo,
          pickupStoreName: order.pickupStoreName,
          vehicleStationName: this.optionalString(body.vehicleStationName),
          deliveryLocation: this.optionalString(body.deliveryLocation),
          mileage: this.optionalNumber(body.mileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          damageFound: Boolean(body.damageFound)
        },
        payload: {
          ...snapshot,
          standardPhotoSlots: this.optionalNumber(body.photoCount) ?? 0,
          damageDescription: this.optionalString(body.damageDescription),
          contractExternalProvider: "reserved"
        },
        operator
      });
      await this.persistContractRecord(order, {
        type: "rental_contract",
        title: "门市租赁合约",
        status: signed ? "signed" : "pending",
        signMethod: this.contractSignMethodFromPayload(body.signMethod),
        signerName: this.optionalString(body.signerName) || order.customerName,
        signedAt: signed ? new Date().toISOString() : undefined,
        operator,
        snapshot
      });
      await this.persistContractRecord(order, {
        type: "pickup_sheet",
        title: "取车交接单",
        status: "signed",
        signMethod: "counter",
        signerName: order.customerName,
        signedAt: new Date().toISOString(),
        operator,
        snapshot: {
          ...snapshot,
          mileage: this.optionalNumber(body.mileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false
        }
      });
      await this.persistNotificationRecord(order, {
        scene: "pickup_completed",
        channel: "app",
        target: order.customerPhoneMasked,
        status: "sent",
        content: `订单 ${order.orderNo} 已完成取车，车辆 ${order.plateNo || "已交付"}。`,
        idempotencyKey,
        operator,
        payload: snapshot
      });
      await this.persistOperationLockRecord(order, {
        stage: "pickup",
        status: OperationLockStatus.Released,
        operator,
        releasedAt: new Date().toISOString(),
        idempotencyKey,
        payload: snapshot
      });
      return;
    }

    if (action === "return-inspection") {
      await this.persistEventSnapshotRecord(order, {
        eventType: "return_inspection",
        title: "还车验车记录快照",
        triggerReason: "提交还车验车",
        settlementTarget: "还车结算",
        before: {
          pickupMileage: this.latestInspectionRecord(order, "pickup")?.mileage,
          pickupFuelLevelPercent:
            this.latestInspectionRecord(order, "pickup")?.fuelLevelPercent,
          pickupBatteryLevelPercent:
            this.latestInspectionRecord(order, "pickup")?.batteryLevelPercent
        },
        after: {
          returnStoreName: order.returnStoreName,
          returnStationName: this.optionalString(body.returnStationName),
          parkingFloor: this.optionalString(body.parkingFloor),
          parkingSpaceNo: this.optionalString(body.parkingSpaceNo),
          returnMileage: this.optionalNumber(body.returnMileage),
          fuelLevelPercent: this.optionalNumber(body.fuelLevelPercent),
          batteryLevelPercent: this.optionalNumber(body.batteryLevelPercent),
          damageFound: Boolean(body.damageFound),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false
        },
        payload: {
          ...snapshot,
          damageDescription: this.optionalString(body.damageDescription),
          missingItems: this.optionalString(body.missingItems),
          telematicsDefault: this.optionalString(body.telematicsDefault) || "manual"
        },
        operator
      });
      await this.persistEventSnapshotRecord(order, {
        eventType: "return_settlement",
        title: "还车结算试算快照",
        triggerReason: "验车数据提交后按订单规则快照重计费",
        settlementTarget:
          order.billingMode === BillingMode.Monthly ? "企业月结" : "还车补退",
        amount: this.optionalNumber(body.finalReceivableAmount),
        amountBreakdown: {
          overtimeFeeAmount: this.optionalNumber(body.overtimeFeeAmount) ?? 0,
          damageFeeAmount: this.optionalNumber(body.damageFeeAmount) ?? 0,
          cleaningFeeAmount: this.optionalNumber(body.cleaningFeeAmount) ?? 0,
          discountAmount: this.optionalNumber(body.discountAmount) ?? 0,
          returnTransactionTotal: this.optionalNumber(body.returnTransactionTotal) ?? 0
        },
        payload: {
          ...snapshot,
          ruleVersion: this.ruleConfig.version,
          externalFinanceProvider: "reserved"
        },
        operator
      });
      await this.persistContractRecord(order, {
        type: "return_sheet",
        title: "还车交接单",
        status: "signed",
        signMethod: "counter",
        signerName: order.customerName,
        signedAt: new Date().toISOString(),
        operator,
        snapshot: {
          ...snapshot,
          returnMileage: this.optionalNumber(body.returnMileage),
          damageFound: Boolean(body.damageFound),
          photoCount: this.optionalNumber(body.photoCount) ?? 0,
          customerSigned: body.customerSigned !== false
        }
      });
      await this.persistOperationLockRecord(order, {
        stage: "return",
        status: OperationLockStatus.Released,
        operator,
        releasedAt: new Date().toISOString(),
        idempotencyKey,
        payload: snapshot
      });
      return;
    }

    if (action === "confirm-settlement") {
      await this.persistEventSnapshotRecord(order, {
        eventType: "settlement_confirmation",
        title: "还车完成结算确认",
        triggerReason: "门店确认账单平衡或企业月结挂账",
        settlementTarget:
          order.billingMode === BillingMode.Monthly ? "企业月结账单" : "客户补退闭环",
        amount: this.optionalNumber(body.finalReceivableAmount),
        amountBreakdown: {
          finalReceivableAmount: this.optionalNumber(body.finalReceivableAmount),
          monthlyBillingPosted: body.monthlyBillingPosted === true,
          settlementStatus: order.mainStatus,
          paymentStatus: order.paymentStatus
        },
        payload: {
          ...snapshot,
          settlementSheetProvider: "reserved",
          invoiceProvider: "reserved"
        },
        operator
      });
      await this.persistContractRecord(order, {
        type: "settlement_sheet",
        title: "还车结算单",
        status: "signed",
        signMethod: "system",
        signerName: order.customerName,
        signedAt: new Date().toISOString(),
        operator,
        snapshot
      });
      await this.persistNotificationRecord(order, {
        scene: order.paymentStatus === PaymentStatus.PaymentDue ? "payment_due" : "return_completed",
        channel: "app",
        target: order.customerPhoneMasked,
        status: "sent",
        content: `订单 ${order.orderNo} 已完成还车结算，当前状态 ${order.mainStatus}。`,
        idempotencyKey,
        operator,
        payload: snapshot
      });
      return;
    }

    if (action === "release-operation-lock") {
      await this.persistEventSnapshotRecord(order, {
        eventType: "operation_lock_release",
        title: "释放取车操作锁",
        triggerReason: this.optionalString(body.reason) || "操作锁超时或店长释放",
        settlementTarget: "状态回退",
        before: { previousStatus },
        after: {
          mainStatus: order.mainStatus,
          operationLockStatus: OperationLockStatus.Released
        },
        payload: {
          ...snapshot,
          releaseMemo: this.optionalString(body.memo),
          draftVoided: true
        },
        operator
      });
      await this.persistOperationLockRecord(order, {
        stage: "pickup",
        status: OperationLockStatus.Released,
        operator,
        releasedAt: new Date().toISOString(),
        idempotencyKey,
        payload: snapshot
      });
      return;
    }

    if (["cancel", "mark-no-show", "reject-order", "close-order"].includes(action)) {
      await this.persistNotificationRecord(order, {
        scene: "order_terminal",
        channel: "manual",
        target: order.customerPhoneMasked,
        status: "sent",
        content: `订单 ${order.orderNo} 已处理为 ${order.mainStatus}，原因：${
          this.optionalString(body.reason) ||
          this.optionalString(body.cancelReason) ||
          this.optionalString(body.rejectReason) ||
          this.optionalString(body.closeReason) ||
          "门店处理"
        }。`,
        idempotencyKey,
        operator,
        payload: snapshot
      });
    }
  }

  private async replayOrderActionByIdempotency(
    orderId: string,
    action: string,
    body: Record<string, unknown>
  ): Promise<StoreRentalOrderActionResult | undefined> {
    const key = this.optionalString(body.idempotencyKey);
    if (!key) {
      return undefined;
    }

    const record = this.useMysqlDataSource()
      ? await this.storeRentalRepository.findOrderIdempotencyRecord(orderId, action, key)
      : (this.orderIdempotencyRecords.get(orderId) ?? []).find(
          (item) => item.action === action && item.key === key
        );

    if (record?.status === "success" && record.responseSnapshot) {
      return record.responseSnapshot as unknown as StoreRentalOrderActionResult;
    }

    return undefined;
  }

  private async saveOrderActionIdempotencyResult(
    orderId: string,
    action: string,
    body: Record<string, unknown>,
    result: StoreRentalOrderActionResult,
    status: StoreRentalIdempotencyRecord["status"] = "success"
  ) {
    const key = this.optionalString(body.idempotencyKey);
    if (!key) {
      return;
    }
    const now = new Date().toISOString();
    const record: StoreRentalIdempotencyRecord = {
      id: `idem_${randomUUID()}`,
      action,
      key,
      status,
      requestHash: JSON.stringify(body).slice(0, 180),
      responseSnapshot: result as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now
    };

    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.saveOrderIdempotencyRecord(orderId, record);
      return;
    }

    const records = this.orderIdempotencyRecords.get(orderId) ?? [];
    const next = records.filter((item) => !(item.action === action && item.key === key));
    this.orderIdempotencyRecords.set(orderId, [record, ...next].slice(0, 100));
  }

  private async persistContractRecord(
    order: StoreRentalOrderSummary,
    input: CreateStoreRentalContractRequest
  ) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.createOrderContractRecord(order.id, input);
    }

    const now = new Date().toISOString();
    const record: StoreRentalContractRecord = {
      id: `contract_${randomUUID()}`,
      documentNo: `DOC-${now.slice(0, 10).replaceAll("-", "")}-${Math.floor(
        Math.random() * 9000 + 1000
      )}`,
      type: input.type,
      title: input.title || this.contractTypeLabel(input.type),
      status: input.status || "signed",
      signMethod: input.signMethod || "counter",
      signerName: input.signerName,
      signedAt: input.signedAt,
      fileUrl: input.fileUrl,
      operator: input.operator,
      createdAt: now,
      snapshot: input.snapshot ?? this.orderFulfillmentSnapshot(order)
    };
    this.prependMemoryRecord(this.orderContracts, order.id, record);

    return record;
  }

  private async persistNotificationRecord(
    order: StoreRentalOrderSummary,
    input: CreateStoreRentalNotificationRequest
  ) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.createOrderNotificationRecord(order.id, input);
    }

    const now = new Date().toISOString();
    const record: StoreRentalNotificationRecord = {
      id: `notice_${randomUUID()}`,
      scene: input.scene,
      channel: input.channel,
      target: input.target,
      status: input.status || "sent",
      content: input.content,
      idempotencyKey: input.idempotencyKey,
      operator: input.operator || "营运端",
      sentAt: input.status === "failed" || input.status === "skipped" ? undefined : now,
      createdAt: now,
      payload: input.payload ?? this.orderFulfillmentSnapshot(order)
    };
    this.prependMemoryRecord(this.orderNotifications, order.id, record);

    return record;
  }

  private async persistOperationLockRecord(
    order: StoreRentalOrderSummary,
    input: CreateStoreRentalOperationLockRequest
  ) {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.createOrderOperationLockRecord(order.id, input);
    }

    const now = new Date().toISOString();
    const record: StoreRentalOperationLockRecord = {
      id: `lock_${randomUUID()}`,
      stage: input.stage,
      status: input.status || OperationLockStatus.Active,
      operator: input.operator || "营运端",
      startedAt: now,
      expiresAt: input.expiresAt,
      releasedAt: input.releasedAt,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? this.orderFulfillmentSnapshot(order)
    };
    this.prependMemoryRecord(this.orderOperationLocks, order.id, record);

    return record;
  }

  private async persistEventSnapshotRecord(
    order: StoreRentalOrderSummary,
    input: {
      eventType: StoreRentalEventSnapshotRecord["eventType"];
      title: string;
      triggerReason?: string;
      settlementTarget?: string;
      amount?: number;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      amountBreakdown?: Record<string, unknown>;
      payload?: Record<string, unknown>;
      operator?: string;
      occurredAt?: string;
      snapshotRef?: string;
    }
  ) {
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const record: StoreRentalEventSnapshotRecord = {
      id: `snapshot_${randomUUID()}`,
      snapshotRef:
        input.snapshotRef ??
        `${input.eventType}:${order.orderNo}:${Date.now()}:${Math.floor(
          Math.random() * 9000 + 1000
        )}`,
      eventType: input.eventType,
      title: input.title,
      triggerReason: input.triggerReason,
      settlementTarget: input.settlementTarget,
      amount: input.amount,
      before: input.before,
      after: input.after,
      amountBreakdown: input.amountBreakdown,
      payload: input.payload ?? this.orderFulfillmentSnapshot(order),
      operator: input.operator ?? "营运端",
      occurredAt,
      createdAt: new Date().toISOString()
    };

    if (this.useMysqlDataSource()) {
      await this.storeRentalRepository.saveOrderEventSnapshot(order.id, {
        id: record.id,
        snapshotRef: record.snapshotRef,
        eventType: record.eventType,
        title: record.title,
        triggerReason: record.triggerReason,
        settlementTarget: record.settlementTarget,
        amount: record.amount,
        before: record.before as any,
        after: record.after as any,
        amountBreakdown: record.amountBreakdown as any,
        payload: record.payload as any,
        operator: record.operator,
        occurredAt: record.occurredAt
      });
      return record;
    }

    this.prependMemoryRecord(this.orderEventSnapshots, order.id, record);
    return record;
  }

  private contractSignMethodFromPayload(value: unknown): StoreRentalContractRecord["signMethod"] {
    const raw = this.optionalString(value);
    return raw && ["app", "counter", "offline_paper", "system"].includes(raw)
      ? (raw as StoreRentalContractRecord["signMethod"])
      : "counter";
  }

  private normalizeStation(input: StoreStationSummary): StoreStationSummary {
    const storeRentalEnabled =
      input.storeRentalEnabled ?? (input.serviceCapabilities ?? []).includes("门市租车");
    const storeSelfServiceEnabled =
      input.storeSelfServiceEnabled ?? (input.serviceCapabilities ?? []).includes("24小时自助");
    const serviceCapabilities = [
      ...(storeRentalEnabled ? ["门市租车"] : []),
      ...(storeSelfServiceEnabled ? ["24小时自助"] : []),
      ...(input.serviceCapabilities ?? []).filter(
        (capability) => !["门市租车", "24小时自助"].includes(capability)
      )
    ];

    return {
      ...input,
      id: input.id || `station_${randomUUID()}`,
      companyName: input.companyName || "RIMO 香港租户",
      name: input.name?.trim() || "",
      parentStoreName: input.parentStoreName?.trim() || "",
      address: input.address?.trim() || "",
      parkingTotal: Number(input.parkingTotal || 0),
      parkingAvailable: Number(input.parkingAvailable || 0),
      serviceCapabilities: Array.from(new Set(serviceCapabilities)),
      serviceStatus: input.serviceStatus || "normal",
      storeRentalEnabled,
      storeRentalServiceStatus:
        input.storeRentalServiceStatus || (input.serviceStatus === "paused" ? "paused" : "normal"),
      storeRentalManualHandover: input.storeRentalManualHandover ?? true,
      storeRentalManualInspection: input.storeRentalManualInspection ?? true,
      storeSelfServiceEnabled,
      storeSelfServiceStatus:
        input.storeSelfServiceStatus || (input.serviceStatus === "paused" ? "paused" : "normal"),
      selfServiceAllowNightReturn: input.selfServiceAllowNightReturn ?? false,
      selfServicePickupMethods: input.selfServicePickupMethods ?? []
    };
  }

  private async refreshRuleConfigFromRepository() {
    if (!this.useMysqlDataSource()) {
      return;
    }
    const config = await this.storeRentalRepository.getCurrentRentalRuleConfig();
    if (config) {
      this.ruleConfig = config;
    }
  }

  private nextRuleConfig(input: SaveStoreRentalRuleConfigRequest): StoreRentalRuleConfig {
    const { operator: _operator, changeReason: _changeReason, ...config } = input;
    const savedAt = new Date().toISOString();
    const versionNo = (this.ruleVersionHistory[0]?.versionNo ?? 0) + 1;
    const effectiveAt = this.normalizeRuleEffectiveAt(config.effectiveAt, savedAt);

    return {
      ...config,
      version: this.nextRuleVersionId(versionNo, savedAt),
      status: config.status || ConfigStatus.Effective,
      effectiveAt
    };
  }

  private createRuleVersionRecord(
    config: StoreRentalRuleConfig,
    versionNo: number,
    metadata: { savedBy: string; savedAt: string; changeReason: string }
  ): StoreRentalRuleVersionRecord {
    return {
      version: config.version,
      versionNo,
      status: config.status,
      savedBy: metadata.savedBy,
      savedAt: metadata.savedAt,
      effectiveAt: config.effectiveAt,
      changeReason: metadata.changeReason,
      snapshot: structuredClone(config)
    };
  }

  private nextRuleVersionId(versionNo: number, savedAt: string) {
    const date = savedAt.slice(0, 10).replaceAll("-", "");
    return `RULE-STORE-${date}-${String(versionNo).padStart(3, "0")}`;
  }

  private normalizeRuleEffectiveAt(value: string | undefined, fallback: string) {
    if (!value) {
      return fallback;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? value : fallback;
  }

  private useMysqlDataSource() {
    return (
      this.configService.get<string>("STORE_RENTAL_DATA_SOURCE") ?? "memory"
    ).toLowerCase() === "mysql";
  }

  private listMemoryFinanceTransactions(): FinanceTransactionRow[] {
    return this.orders
      .flatMap((order) =>
        this.buildTransactionRecords(order).map((record) => ({
          ...record,
          orderId: order.id,
          orderNo: order.orderNo,
          corporateId: order.corporateId,
          corporateShortName: order.corporateShortName,
          customerName: order.customerName,
          billingMode: order.billingMode
        }))
      )
      .sort((left, right) => right.at.localeCompare(left.at));
  }

  private buildMemoryFinancePreAuthorizations(): FinancePreAuthorizationRow[] {
    const rows: FinancePreAuthorizationRow[] = [];
    for (const order of this.orders) {
      const transactions = this.buildTransactionRecords(order).filter(
        (record) =>
          record.status === "success" &&
          (record.type === "pre_auth_freeze" ||
            record.type === "pre_auth_capture" ||
            record.type === "pre_auth_release")
      );
      const authorizedAmount = transactions
        .filter((record) => record.type === "pre_auth_freeze")
        .reduce((sum, record) => sum + record.amount, 0);
      if (authorizedAmount <= 0) {
        continue;
      }
      const capturedAmount = transactions
        .filter((record) => record.type === "pre_auth_capture")
        .reduce((sum, record) => sum + record.amount, 0);
      const releasedAmount = transactions
        .filter((record) => record.type === "pre_auth_release")
        .reduce((sum, record) => sum + record.amount, 0);
      const remainingAmount = Math.max(
        0,
        authorizedAmount - capturedAmount - releasedAmount
      );
      const transactionAts = transactions.map((record) => record.at).sort();
      const latestAt = transactionAts[transactionAts.length - 1];
      const latestTransaction = transactions[transactions.length - 1];
      const status: FinancePreAuthorizationRow["status"] =
        remainingAmount <= 0
          ? capturedAmount > 0 && releasedAmount <= 0
            ? "captured"
            : "released"
          : capturedAmount > 0
            ? "partially_captured"
            : "frozen";
      const freezeTransaction = transactions.find(
        (record) => record.type === "pre_auth_freeze"
      );
      rows.push({
        id: `finance_preauth_derived_${order.id}`,
        preAuthNo: `PA-${order.orderNo}`,
        orderId: order.id,
        orderNo: order.orderNo,
        memberId: order.memberId,
        corporateId: order.corporateId,
        corporateShortName: order.corporateShortName,
        customerName: order.customerName,
        status,
        channel: "online",
        provider: "mock_payment",
        authorizedAmount,
        capturedAmount,
        releasedAmount,
        remainingAmount,
        currency: "CNY",
        paymentMethod: "线上预授权",
        frozenAt: freezeTransaction?.at,
        capturedAt: capturedAmount > 0 ? latestAt : undefined,
        releasedAt: releasedAmount > 0 ? latestAt : undefined,
        operator: latestTransaction?.operator,
        remark: "由订单预授权资金流水派生",
        createdAt: freezeTransaction?.at ?? order.pickupAt
      });
    }
    return rows;
  }

  private buildMemoryCorporateMonthlyBills(
    corporate: CorporateDetail
  ): CorporateMonthlyBillSummary[] {
    const monthlyOrders = this.orders.filter(
      (order) =>
        order.billingMode === BillingMode.Monthly &&
        this.monthlyBillableAmount(order) > 0 &&
        (order.corporateId === corporate.id ||
          order.corporateShortName === corporate.shortName)
    );
    const grouped = monthlyOrders.reduce<Record<string, typeof monthlyOrders>>(
      (result, order) => {
        const period = this.monthlyBillPeriod(order);
        result[period] = [...(result[period] ?? []), order];
        return result;
      },
      {}
    );

    return Object.entries(grouped).map(([period, orders]) =>
      this.buildCorporateMonthlyBill(corporate, period, orders)
    );
  }

  private getStationsForRead() {
    return this.useMysqlDataSource()
      ? this.storeRentalRepository.listStations()
      : Promise.resolve(this.stations);
  }

  private getVehicleGroupsForRead() {
    return this.useMysqlDataSource()
      ? this.storeRentalRepository.listVehicleGroups()
      : Promise.resolve(this.vehicleGroupMasters);
  }

  private getVehiclesForRead() {
    return this.useMysqlDataSource()
      ? this.storeRentalRepository.listVehicles()
      : Promise.resolve(this.vehicles);
  }

  private getMemberForRead(id: string): Promise<MemberDetail> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getMemberDetail(id);
    }

    const member = this.members.find((item) => item.id === id);
    if (!member) {
      throw new NotFoundException(`Member ${id} was not found`);
    }

    return Promise.resolve(member);
  }

  private getCorporateForRead(id: string): Promise<CorporateDetail> {
    if (this.useMysqlDataSource()) {
      return this.storeRentalRepository.getCorporateDetail(id);
    }

    const corporate = this.corporates.find((item) => item.id === id);
    if (!corporate) {
      throw new NotFoundException(`Corporate ${id} was not found`);
    }

    return Promise.resolve(corporate);
  }

  private validateStation(station: StoreStationSummary) {
    if (!station.name || !station.parentStoreName) {
      throw new BadRequestException("请先填写据点名称并选择所属门市。");
    }

    if (station.parkingAvailable > station.parkingTotal) {
      throw new BadRequestException("可用车位数不能大于总车位数。");
    }

    if (station.parkingTotal < 0 || station.parkingAvailable < 0) {
      throw new BadRequestException("车位数量不能为负数。");
    }

    if (!station.storeRentalEnabled && !station.storeSelfServiceEnabled) {
      throw new BadRequestException("本期至少需要启用一个门市租赁服务能力。");
    }

    if (
      station.storeSelfServiceEnabled &&
      station.storeSelfServiceStatus === "normal" &&
      (station.selfServicePickupMethods ?? []).length === 0
    ) {
      throw new BadRequestException("24 小时自助启用时，请至少选择一种自助取还方式。");
    }
  }

  private normalizeVehicleGroup(input: VehicleGroupMaster): VehicleGroupMaster {
    const id = input.id || `VG_${randomUUID()}`;
    return {
      ...input,
      id,
      brand: input.brand?.trim() || "",
      model: input.model?.trim() || "",
      storeProductGroupName: input.storeProductGroupName?.trim() || "",
      dailyPrice: Number(input.dailyPrice || 0),
      freeKm: Number(input.freeKm || 0),
      pricePerKm: Number(input.pricePerKm || 0),
      features: input.features ?? [],
      priceVersionId: input.priceVersionId || `PV_${id}_${Date.now()}`
    };
  }

  private validateVehicleGroup(
    group: VehicleGroupMaster,
    vehicleGroups: VehicleGroupMaster[] = this.vehicleGroupMasters
  ) {
    if (!group.brand || !group.model || !group.storeProductGroupName) {
      throw new BadRequestException("请填写品牌、型号并关联门市产品组。");
    }

    if (group.dailyPrice <= 0) {
      throw new BadRequestException("车组标准价必须大于 0。");
    }

    if (group.freeKm < 0 || group.pricePerKm < 0) {
      throw new BadRequestException("免费里程和超程单价不能为负数。");
    }

    const duplicated = vehicleGroups.some(
      (item) =>
        item.id !== group.id &&
        item.brand === group.brand &&
        item.model === group.model &&
        item.year === group.year
    );
    if (duplicated) {
      throw new BadRequestException("同品牌、型号和年款的车型组已存在。");
    }
  }

  private normalizeVehicle(input: VehicleInstanceSummary): VehicleInstanceSummary {
    const currentServiceType = input.currentServiceType || "STORE_STANDARD";
    const serviceTypes = Array.from(
      new Set([...(input.serviceTypes ?? []), currentServiceType])
    ) as VehicleInstanceSummary["serviceTypes"];

    return {
      ...input,
      id: input.id || `VEH_${randomUUID()}`,
      licensePlate: input.licensePlate?.trim().toUpperCase() || "",
      vin: input.vin?.trim().toUpperCase() || "",
      mileage: Number(input.mileage || 0),
      enabled: input.operationStatus === "disabled" ? false : input.enabled,
      currentServiceType,
      serviceTypes,
      tags: input.tags ?? []
    };
  }

  private validateVehicle(
    vehicle: VehicleInstanceSummary,
    context: {
      vehicles?: VehicleInstanceSummary[];
      stations?: StoreStationSummary[];
      vehicleGroups?: VehicleGroupMaster[];
    } = {}
  ) {
    const vehicles = context.vehicles ?? this.vehicles;
    const stations = context.stations ?? this.stations;
    const vehicleGroups = context.vehicleGroups ?? this.vehicleGroupMasters;

    if (!vehicle.licensePlate || !vehicle.vehicleGroupName || !vehicle.currentStoreName) {
      throw new BadRequestException("请填写车牌号、车型组和当前门市。");
    }

    if (vehicle.vin && vehicle.vin.length !== 17) {
      throw new BadRequestException("VIN 码需要为 17 位。");
    }

    if (!vehicle.serviceTypes.length) {
      throw new BadRequestException("车辆至少需要配置一种可服务类型。");
    }

    if (!vehicle.serviceTypes.includes(vehicle.currentServiceType)) {
      throw new BadRequestException("当前服务类型必须包含在车辆可服务类型中。");
    }

    const duplicatedPlate = vehicles.some(
      (item) => item.id !== vehicle.id && item.licensePlate === vehicle.licensePlate
    );
    if (duplicatedPlate) {
      throw new BadRequestException("车牌号已存在。");
    }

    const duplicatedVin =
      vehicle.vin &&
      vehicles.some((item) => item.id !== vehicle.id && item.vin === vehicle.vin);
    if (duplicatedVin) {
      throw new BadRequestException("VIN 码已存在。");
    }

    if (!this.findVehicleGroupForVehicle(vehicle.vehicleGroupName, vehicleGroups)) {
      throw new BadRequestException("请选择已存在的车型组。");
    }

    if (
      vehicle.enabled &&
      ["idle", "reserved"].includes(vehicle.operationStatus) &&
      !this.stationCanServeStoreRental(
        vehicle.currentStationName,
        vehicle.currentServiceType,
        stations
      )
    ) {
      throw new BadRequestException(
        "当前据点未启用对应门市租赁服务能力，车辆不能上架或参与派车。"
      );
    }
  }

  private findVehicleGroupForVehicle(
    vehicleGroupName: string,
    vehicleGroups: VehicleGroupMaster[] = this.vehicleGroupMasters
  ) {
    return vehicleGroups.find(
      (group) =>
        vehicleGroupName === group.storeProductGroupName ||
        vehicleGroupName.includes(group.storeProductGroupName) ||
        vehicleGroupName.includes(group.brand) ||
        vehicleGroupName.includes(group.model)
    );
  }

  private stationCanServeStoreRental(
    stationName: string,
    serviceType: VehicleInstanceSummary["currentServiceType"],
    stations: StoreStationSummary[] = this.stations
  ) {
    const station = stations.find((item) => item.name === stationName);
    if (!station || station.status !== "enabled" || station.serviceStatus !== "normal") {
      return false;
    }

    if (serviceType === "STORE_24H") {
      return (
        station.storeSelfServiceEnabled &&
        (station.storeSelfServiceStatus || "normal") === "normal"
      );
    }

    return (
      station.storeRentalEnabled &&
      (station.storeRentalServiceStatus || "normal") === "normal"
    );
  }

  private findVehicle(id: string) {
    const vehicle = this.vehicles.find((item) => item.id === id);
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${id} was not found`);
    }

    return vehicle;
  }

  private buildVehicleLocationEvents(vehicle: VehicleInstanceSummary) {
    const stored = this.vehicleLocationEvents.get(vehicle.id) ?? [];
    const orderEvents = this.orders
      .filter((order) => order.plateNo === vehicle.licensePlate)
      .flatMap((order) => [
        {
          id: `loc_${order.id}_pickup`,
          at: order.pickupAt,
          type: "pickup" as const,
          storeName: order.pickupStoreName,
          stationName: vehicle.currentStationName,
          mileage: Math.max(vehicle.mileage - 320, 0),
          operator: "门店营运",
          source: "order" as const,
          note: `订单 ${order.orderNo} 取车`
        },
        {
          id: `loc_${order.id}_return`,
          at: order.returnAt,
          type: "return" as const,
          storeName: order.returnStoreName,
          stationName: vehicle.currentStationName,
          mileage: vehicle.mileage,
          operator: "门店营运",
          source: "order" as const,
          note: `订单 ${order.orderNo} 还车`
        }
      ]);

    return [
      {
        id: `loc_${vehicle.id}_current`,
        at: vehicle.lastOperationAt || new Date().toISOString(),
        type: "iot_sync" as const,
        storeName: vehicle.currentStoreName,
        stationName: vehicle.currentStationName,
        mileage: vehicle.mileage,
        operator: "车机同步",
        source: "iot" as const,
        note: vehicle.cid ? `CID ${vehicle.cid}` : "未绑定车机，使用营运端记录"
      },
      ...stored,
      ...orderEvents
    ].sort((a, b) => b.at.localeCompare(a.at));
  }

  private buildVehicleConditionPhotos(vehicle: VehicleInstanceSummary) {
    const stored = this.vehicleConditionPhotoRecords.get(vehicle.id) ?? [];
    return [
      {
        id: `photo_${vehicle.id}_return`,
        at: "2026-05-06T10:10:00.000Z",
        scene: "return" as const,
        operator: "门店营运",
        remark: "还车验车照片，外观无新增明显损伤，内饰待清洁。",
        photos: [
          "https://via.placeholder.com/300x200?text=Return+Front",
          "https://via.placeholder.com/300x200?text=Return+Rear",
          "https://via.placeholder.com/300x200?text=Interior"
        ]
      },
      {
        id: `photo_${vehicle.id}_pickup`,
        at: "2026-05-05T09:28:00.000Z",
        scene: "pickup" as const,
        operator: "门店营运",
        remark: "取车验车照片，油量、里程已确认。",
        photos: [
          "https://via.placeholder.com/300x200?text=Pickup+Front",
          "https://via.placeholder.com/300x200?text=Dashboard"
        ]
      }
    ,
      ...stored
    ].sort((a, b) => b.at.localeCompare(a.at));
  }

  private buildVehicleCredentialRecords(vehicle: VehicleInstanceSummary) {
    const stored = this.vehicleCredentialRecords.get(vehicle.id);
    if (stored) {
      return stored;
    }
    const now = new Date().toISOString();
    const records: VehicleCredentialRecord[] = [
      {
        id: `cred_${vehicle.id}_license`,
        vehicleId: vehicle.id,
        credentialType: "license",
        credentialName: "车辆牌照登记证",
        certNo: `${vehicle.licensePlate.replace(/\s/g, "")}-LIC`,
        status: "valid",
        issueAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-12-31T23:59:59.000Z",
        reminderDays: 30,
        attachments: [],
        operator: "营运端",
        createdAt: now,
        updatedAt: now
      },
      {
        id: `cred_${vehicle.id}_insurance`,
        vehicleId: vehicle.id,
        credentialType: "insurance",
        credentialName: "车辆保险",
        certNo: `${vehicle.licensePlate.replace(/\s/g, "")}-INS`,
        status: vehicle.operationStatus === "maintenance" ? "expiring" : "valid",
        issueAt: "2026-01-01T00:00:00.000Z",
        expiresAt:
          vehicle.operationStatus === "maintenance"
            ? "2026-06-30T23:59:59.000Z"
            : "2026-12-31T23:59:59.000Z",
        reminderDays: 30,
        attachments: [],
        operator: "营运端",
        createdAt: now,
        updatedAt: now
      }
    ];
    this.vehicleCredentialRecords.set(vehicle.id, records);
    return records;
  }

  private buildVehicleOnboardItems(vehicle: VehicleInstanceSummary) {
    const stored = this.vehicleOnboardItems.get(vehicle.id);
    if (stored) {
      return stored;
    }
    const base: VehicleOnboardItemRecord[] = [
      {
        id: `item_${vehicle.id}_key`,
        vehicleId: vehicle.id,
        category: "key",
        itemName: "车辆钥匙",
        standardQuantity: 2,
        actualQuantity: vehicle.currentServiceType === "STORE_24H" ? 1 : 2,
        status: vehicle.currentServiceType === "STORE_24H" ? "missing" : "normal",
        priceAmount: 500,
        checkedAt: new Date().toISOString(),
        operator: "门店营运",
        remark: vehicle.currentServiceType === "STORE_24H" ? "自助点保留一把备用钥匙" : undefined
      },
      {
        id: `item_${vehicle.id}_doc`,
        vehicleId: vehicle.id,
        category: "document",
        itemName: "行驶证/登记文件影本",
        standardQuantity: 1,
        actualQuantity: 1,
        status: "normal",
        priceAmount: 0,
        checkedAt: new Date().toISOString(),
        operator: "门店营运"
      },
      {
        id: `item_${vehicle.id}_clean`,
        vehicleId: vehicle.id,
        category: "cleaning",
        itemName: "清洁包",
        standardQuantity: 1,
        actualQuantity: vehicle.operationStatus === "controlled" ? 0 : 1,
        status: vehicle.operationStatus === "controlled" ? "missing" : "normal",
        priceAmount: 80,
        checkedAt: new Date().toISOString(),
        operator: "门店营运"
      }
    ];
    this.vehicleOnboardItems.set(vehicle.id, base);
    return base;
  }

  private ensureMemoryFleetRecords() {
    if (this.tboxDevices.length === 0) {
      this.tboxDevices = this.vehicles
        .filter((vehicle) => Boolean(vehicle.cid))
        .map((vehicle, index): TboxDeviceSummary => ({
          id: `tbox_${vehicle.cid}`,
          cid: vehicle.cid!,
          provider: "RIMO reserved",
          modelNo: index % 2 === 0 ? "RTB-4G-V2" : "RTB-LTE-V1",
          status: "active",
          onlineStatus: vehicle.operationStatus === "maintenance" ? "offline" : "online",
          boundVehicleId: vehicle.id,
          boundPlateNo: vehicle.licensePlate,
          boundVehicleGroupName: vehicle.vehicleGroupName,
          currentStationName: vehicle.currentStationName,
          batteryLevel: vehicle.currentServiceType === "STORE_24H" ? 82 : 96,
          signalStrength: vehicle.operationStatus === "maintenance" ? 42 : 88,
          lastHeartbeatAt: new Date().toISOString()
        }));
    }

    for (const station of this.stations) {
      if (!this.stationCalendarDays.has(station.id)) {
        this.stationCalendarDays.set(
          station.id,
          Array.from({ length: 7 }).map((_, index) => {
            const date = new Date();
            date.setDate(date.getDate() + index);
            return {
              id: `cal_${station.id}_${date.toISOString().slice(0, 10)}`,
              stationId: station.id,
              stationName: station.name,
              date: date.toISOString().slice(0, 10),
              businessStatus:
                station.serviceStatus === "maintenance"
                  ? "paused"
                  : "open" as StationCalendarDay["businessStatus"],
              openTime: "09:00",
              closeTime: station.storeSelfServiceEnabled ? "23:59" : "20:00",
              capacityLimit: station.parkingTotal,
              note:
                station.serviceStatus === "maintenance"
                  ? "站点维护中，门市租赁订单需客服人工处理"
                  : undefined,
              operator: "系统",
              updatedAt: new Date().toISOString()
            };
          })
        );
      }
    }

    if (this.stationCapacitySnapshots.length === 0) {
      this.stationCapacitySnapshots = this.stations.map((station) => {
        const stationVehicles = this.vehicles.filter(
          (vehicle) => vehicle.currentStationName === station.name
        );
        const controlledVehicles = stationVehicles.filter(
          (vehicle) => vehicle.operationStatus === "controlled"
        ).length;
        const maintenanceVehicles = stationVehicles.filter(
          (vehicle) => vehicle.operationStatus === "maintenance"
        ).length;
        const disabledVehicles = stationVehicles.filter(
          (vehicle) => !vehicle.enabled || vehicle.operationStatus === "disabled"
        ).length;
        const rentingVehicles = stationVehicles.filter(
          (vehicle) => vehicle.operationStatus === "renting"
        ).length;
        const occupiedVehicles = stationVehicles.length - rentingVehicles;
        return {
          id: `cap_${station.id}_${Date.now()}`,
          stationId: station.id,
          stationName: station.name,
          date: new Date().toISOString().slice(0, 10),
          totalSpaces: station.parkingTotal,
          availableSpaces: Math.max(0, station.parkingAvailable),
          reservedSpaces: Math.max(0, station.parkingTotal - station.parkingAvailable),
          occupiedVehicles,
          controlledVehicles,
          maintenanceVehicles,
          disabledVehicles,
          rentingVehicles,
          pendingPickupVehicles: this.orders.filter(
            (order) => order.pickupStationName === station.name
          ).length,
          pendingReturnVehicles: this.orders.filter(
            (order) => order.returnStationName === station.name
          ).length,
          source: "system",
          createdAt: new Date().toISOString()
        };
      });
    }
  }

  private findMemoryTboxDeviceByVehicle(vehicleId: string) {
    this.ensureMemoryFleetRecords();
    return this.tboxDevices.find((item) => item.boundVehicleId === vehicleId);
  }

  private ensureStationExists(stationId: string) {
    const station = this.stations.find((item) => item.id === stationId);
    if (!station) {
      throw new NotFoundException(`Station ${stationId} was not found`);
    }
    return station;
  }

  private resolveCredentialStatus(expiresAt: string | undefined): VehicleCredentialRecord["status"] {
    if (!expiresAt) {
      return "missing";
    }
    const expires = new Date(expiresAt).getTime();
    if (!Number.isFinite(expires)) {
      return "missing";
    }
    const days = Math.ceil((expires - Date.now()) / 86_400_000);
    if (days < 0) {
      return "expired";
    }
    if (days <= 30) {
      return "expiring";
    }
    return "valid";
  }

  private syncVehiclePositionFromStoredEvents(vehicle: VehicleInstanceSummary) {
    const latestRecord = [...(this.vehicleLocationEvents.get(vehicle.id) ?? [])].sort((a, b) =>
      b.at.localeCompare(a.at)
    )[0];

    if (!latestRecord) {
      return;
    }

    vehicle.currentStoreName = latestRecord.storeName;
    vehicle.currentStationName = latestRecord.stationName;
    vehicle.mileage = latestRecord.mileage;
    vehicle.lastOperationAt = latestRecord.at;
    vehicle.lastOperationBy = latestRecord.operator;
  }

  private hasBlockingTransferOrder(vehicle: VehicleInstanceSummary) {
    return this.orders.some(
      (order) =>
        order.plateNo === vehicle.licensePlate &&
        [
          OrderMainStatus.Inspecting,
          OrderMainStatus.Renting,
          OrderMainStatus.Renewing,
          OrderMainStatus.Overdue,
          OrderMainStatus.SettlementPending,
          OrderMainStatus.PaymentDue,
          OrderMainStatus.RefundPending,
          OrderMainStatus.AccidentProcessing
        ].includes(order.mainStatus)
    );
  }

  private buildVehicleMaintenanceRecords(
    vehicle: VehicleInstanceSummary
  ): VehicleMaintenanceRecord[] {
    const stored = this.vehicleMaintenanceRecords.get(vehicle.id) ?? [];
    const hasStoredActiveMaintenance = stored.some(
      (record) => record.status !== "completed"
    );
    const activeMaintenance =
      vehicle.operationStatus === "maintenance" && !hasStoredActiveMaintenance
        ? [
            {
              id: `maint_${vehicle.id}_active`,
              date: new Date().toISOString().slice(0, 10),
              type: "临时维保",
              vendor: "门店自检",
              mileage: vehicle.mileage,
              costAmount: 0,
              status: "processing" as const,
              remark: vehicle.maintenanceReason || "营运端发起维保"
            }
          ]
        : [];

    return [
      ...stored,
      ...activeMaintenance,
      {
        id: `maint_${vehicle.id}_regular`,
        date: "2026-04-18",
        type: "例行保养",
        vendor: "RIMO 合作保养厂",
        mileage: Math.max(vehicle.mileage - 1200, 0),
        costAmount: 680,
        status: "completed" as const,
        remark: "机油、刹车、轮胎检查完成"
      }
    ];
  }

  private buildVehicleAccidentRecords(
    vehicle: VehicleInstanceSummary
  ): VehicleAccidentRecord[] {
    const stored = this.vehicleAccidentRecords.get(vehicle.id) ?? [];
    const baseline =
      vehicle.isSpecial || vehicle.operationStatus === "controlled"
        ? [
            {
              id: `acc_${vehicle.id}_demo`,
              date: "2026-03-22",
              description: "右后轮毂轻微擦伤，已记录定损。",
              claimStatus: "closed" as const,
              estimatedCostAmount: 900,
              reportNo: `RP-${vehicle.id}-001`
            }
          ]
        : [];

    return [...stored, ...baseline];
  }

  private buildVehicleOperationLogs(vehicle: VehicleInstanceSummary) {
    const stored = this.vehicleOperationLogs.get(vehicle.id) ?? [];
    const baseline: VehicleOperationLog[] = [
      {
        id: `log_${vehicle.id}_created`,
        at: "2026-05-01T02:10:00.000Z",
        operator: "系统初始化",
        action: "创建车辆档案",
        reason: "Demo 租户初始化",
        ip: "127.0.0.1"
      }
    ];

    if (vehicle.lastOperationAt) {
      baseline.unshift({
        id: `log_${vehicle.id}_last`,
        at: vehicle.lastOperationAt,
        operator: vehicle.lastOperationBy || "营运端",
        action: "最近一次车辆状态更新",
        reason: vehicle.disabledReason || vehicle.maintenanceReason,
        ip: "10.21.8.15"
      });
    }

    return [...stored, ...baseline].sort((a, b) => b.at.localeCompare(a.at));
  }

  private appendVehicleOperationLog(
    vehicle: VehicleInstanceSummary,
    input: {
      operator: string;
      action: string;
      reason?: string;
    }
  ) {
    const logs = this.vehicleOperationLogs.get(vehicle.id) ?? [];
    logs.unshift({
      id: `vlog_${randomUUID()}`,
      at: new Date().toISOString(),
      operator: input.operator,
      action: input.action,
      reason: input.reason,
      ip: "10.21.8.15"
    });
    this.vehicleOperationLogs.set(vehicle.id, logs.slice(0, 50));
  }

  private vehicleStatusActionLabel(
    input: {
      enabled?: boolean;
      operationStatus?: VehicleInstanceSummary["operationStatus"];
    },
    vehicle: VehicleInstanceSummary
  ) {
    if (input.enabled === false) {
      return "停用车辆";
    }
    if (input.enabled === true && vehicle.operationStatus === "idle") {
      return "启用车辆";
    }
    if (input.operationStatus === "maintenance") {
      return "发起维保";
    }
    if (input.operationStatus === "idle") {
      return "恢复空闲可派";
    }
    if (input.operationStatus === "controlled") {
      return "车辆转入整备";
    }

    return "更新车辆状态";
  }

  private buildFeeItems(order: StoreRentalOrderSummary) {
    const settlement = this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const extensionFees = (this.manualFeeLedgerItems.get(order.id) ?? [])
      .filter((item) => item.status !== "voided")
      .map((item) => ({
        name: item.name,
        amount:
          item.direction === "charge"
            ? item.amount
            : item.direction === "refund"
              ? -item.amount
              : -item.amount
      }));

    return [
      { name: "基础租金", amount: settlement.rentalAmount },
      { name: "增值服务/保障", amount: settlement.serviceFeeAmount },
      { name: "超时费用", amount: settlement.overtimeFeeAmount },
      { name: "损伤赔偿", amount: settlement.damageFeeAmount },
      { name: "清洁/缺件费用", amount: settlement.cleaningFeeAmount },
      ...(settlement.discountAmount > 0
        ? [{ name: "减免金额", amount: -settlement.discountAmount }]
        : []),
      ...extensionFees
    ];
  }

  private extendRental(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ) {
    const operator = String(body.operator ?? "门店营运");
    const oldReturnAtText = order.returnAt;
    const newReturnAtText =
      this.optionalString(body.newReturnAt) ?? new Date().toISOString();
    const oldReturnAt = new Date(order.returnAt);
    const newReturnAt = this.requiredDate(
      body.newReturnAt,
      "新预计还车时间不能为空。"
    );

    if (!Number.isFinite(oldReturnAt.getTime())) {
      throw new BadRequestException("当前订单预计还车时间无效，不能延长用车。");
    }
    if (newReturnAt <= oldReturnAt) {
      throw new BadRequestException("新预计还车时间必须晚于当前预计还车时间。");
    }
    if (!order.plateNo || order.plateNo === "待人工派车") {
      throw new BadRequestException("当前订单未锁定车辆，不能延长用车。");
    }

    const extensionHours = Math.max(
      1,
      Math.ceil((newReturnAt.getTime() - oldReturnAt.getTime()) / 3_600_000)
    );
    const conflict = this.findExtensionConflict(order, oldReturnAt, newReturnAt);
    if (conflict) {
      throw new BadRequestException(
        `当前车辆在延长时段存在后续订单 ${conflict.orderNo}（取车时间 ${conflict.pickupAt}），请先解决库存冲突。`
      );
    }

    const extensionAmount = this.calculateExtensionRent(
      order,
      oldReturnAt,
      newReturnAt
    );
    if (extensionAmount <= 0) {
      throw new BadRequestException("续租费用试算失败，不能确认延长用车。");
    }

    const isMonthly = order.billingMode === BillingMode.Monthly;
    const settlementMode = this.extensionSettlementMode(
      body.settlementMode,
      isMonthly
    );
    const immediateReasons = this.extensionImmediateReasons(
      order,
      previousStatus,
      extensionHours,
      extensionAmount
    );
    const paymentPaid =
      body.paymentPaid === true || String(body.paymentPaid ?? "") === "true";

    if (!isMonthly && immediateReasons.length > 0 && settlementMode !== "immediate") {
      throw new BadRequestException(
        `当前续租必须立即收款：${immediateReasons.join("、")}。`
      );
    }
    if (!isMonthly && settlementMode === "immediate" && !paymentPaid) {
      throw new BadRequestException("立即收款方式必须确认续租费用已收款成功。");
    }

    const feeStatus =
      settlementMode === "monthly"
        ? "monthly_billing"
        : settlementMode === "immediate"
          ? "settled"
          : "pending";
    const snapshotRef = `extension:${order.orderNo}:${Date.now()}`;
    const fee = this.feeLedgerItem({
      id: `fee_extension_${randomUUID()}`,
      code: "extension_rent",
      name: "续租租金",
      stage: "rental",
      source: "system",
      direction: "charge",
      status: feeStatus,
      amount: extensionAmount,
      description: `按订单计费快照试算新增租期 ${extensionHours} 小时。`,
      snapshotRef,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);

    const settlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    this.settlementSummaries.set(
      order.id,
      this.mergeSettlementSummary(order, {
        finalReceivableAmount: settlement.finalReceivableAmount + extensionAmount,
        returnTransactionTotal:
          settlement.returnTransactionTotal +
          (settlementMode === "immediate" ? extensionAmount : 0)
      })
    );

    if (settlementMode === "immediate") {
      this.persistTransaction(order.id, {
        type: "payment",
        channel: "offline",
        amount: extensionAmount,
        operator,
        relatedFeeIds: [fee.id],
        note: "延长用车续租租金立即收款。"
      });
    }

    order.returnAt = newReturnAtText;
    order.mainStatus = OrderMainStatus.Renewing;
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter(
        (flag) => !["逾期未还", "超期未还", "待还车"].includes(flag)
      ),
      previousStatus === OrderMainStatus.Overdue
        ? ["补办续租", "续租中"]
        : ["续租中"]
    );

    return {
      timelineAction:
        `${previousStatus === OrderMainStatus.Overdue ? "补办续租确认" : "延长用车确认"}` +
        `：原还车 ${oldReturnAtText}，新还车 ${newReturnAtText}，` +
        `续租费用 ${extensionAmount}，结算方式 ${this.extensionSettlementLabel(settlementMode)}` +
        `${immediateReasons.length ? `，风控原因：${immediateReasons.join("、")}` : ""}` +
        `${this.actionMemo(body)}`,
      message:
        previousStatus === OrderMainStatus.Overdue
          ? "补办续租成功，订单已回到续租中。"
          : "延长用车成功，订单已进入或保持续租中。"
    };
  }

  private redirectOrder(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const targetVehicle = this.findRedirectionVehicle(body);
    const currentVehicle = this.vehicles.find(
      (item) => item.licensePlate === order.plateNo
    );
    this.validateRedirectionVehicle(order, targetVehicle, currentVehicle);

    const conflict = this.findRedirectionConflict(order, targetVehicle.licensePlate);
    if (conflict) {
      throw new BadRequestException(
        `目标车辆在订单时段存在后续订单 ${conflict.orderNo}（取车时间 ${conflict.pickupAt}），不能确认改派。`
      );
    }

    const effect = this.applyOrderRedirection(
      order,
      body,
      targetVehicle,
      previousStatus,
      this.vehicleGroupMasters
    );
    this.updateVehicleOperationStatus(effect.previousPlateNo, "idle");
    this.updateVehicleOperationStatus(
      targetVehicle.licensePlate,
      this.redirectionTargetVehicleStatus(order)
    );

    return {
      timelineAction: effect.timelineAction,
      message: effect.message
    };
  }

  private findRedirectionVehicle(body: Record<string, unknown>) {
    const targetVehicleId =
      this.optionalString(body.targetVehicleId) || this.optionalString(body.vehicleId);
    const targetPlateNo =
      this.optionalString(body.targetPlateNo) ||
      this.optionalString(body.plateNo) ||
      this.optionalString(body.licensePlate);
    const vehicle = targetVehicleId
      ? this.findVehicle(targetVehicleId)
      : this.vehicles.find((item) => item.licensePlate === targetPlateNo);

    if (!vehicle) {
      throw new BadRequestException("请选择要改派的目标车辆。");
    }

    return vehicle;
  }

  private async findMysqlRedirectionVehicle(body: Record<string, unknown>) {
    const targetVehicleId =
      this.optionalString(body.targetVehicleId) || this.optionalString(body.vehicleId);
    if (targetVehicleId) {
      return this.storeRentalRepository.findVehicle(targetVehicleId);
    }

    const targetPlateNo =
      this.optionalString(body.targetPlateNo) ||
      this.optionalString(body.plateNo) ||
      this.optionalString(body.licensePlate);
    const vehicle = await this.storeRentalRepository.findVehicleByPlateNo(targetPlateNo);
    if (!vehicle) {
      throw new BadRequestException("请选择要改派的目标车辆。");
    }

    return vehicle;
  }

  private validateRedirectionVehicle(
    order: StoreRentalOrderSummary,
    targetVehicle: VehicleInstanceSummary,
    currentVehicle?: VehicleInstanceSummary
  ) {
    if (!order.plateNo || order.plateNo === "待人工派车") {
      throw new BadRequestException("当前订单未绑定车辆，不能确认改派。");
    }
    if (targetVehicle.licensePlate === order.plateNo) {
      throw new BadRequestException("目标车辆不能与当前车辆相同。");
    }
    if (!targetVehicle.enabled || targetVehicle.operationStatus !== "idle") {
      throw new BadRequestException("目标车辆当前不可用，不能确认改派。");
    }
    if (
      currentVehicle?.assetCompanyName &&
      targetVehicle.assetCompanyName &&
      currentVehicle.assetCompanyName !== targetVehicle.assetCompanyName
    ) {
      throw new BadRequestException("本期不支持跨车行改派，请在线下协调后再处理。");
    }
    if (!targetVehicle.serviceTypes.includes(targetVehicle.currentServiceType)) {
      throw new BadRequestException("目标车辆服务类型配置异常，不能确认改派。");
    }
  }

  private applyOrderRedirection(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    targetVehicle: VehicleInstanceSummary,
    previousStatus: OrderMainStatus,
    vehicleGroups: VehicleGroupMaster[]
  ) {
    this.ensureRedirectionFinancialAllowed(order, body);

    const operator = String(body.operator ?? "门店营运");
    const previousPlateNo = order.plateNo;
    const previousVehicleGroupName = order.vehicleGroupName;
    const reason = this.normalizeRedirectionReason(body.reason ?? body.redirectionReason);
    const note = this.optionalString(body.note) || this.optionalString(body.memo);
    const priceHandling = this.normalizeRedirectionPriceHandling(body.priceHandling);
    if (reason.value === "other" && !note) {
      throw new BadRequestException("选择其他改派原因时必须填写备注。");
    }

    const sameGroup = this.vehicleGroupsEquivalent(
      previousVehicleGroupName,
      targetVehicle.vehicleGroupName,
      vehicleGroups
    );
    const isMidRental = this.isMidRentalRedirection(previousStatus);
    const oldAmount = this.calculateRedirectionPeriodAmount(
      previousVehicleGroupName,
      order,
      isMidRental,
      vehicleGroups,
      body.effectiveAt
    );
    const newAmount = sameGroup
      ? oldAmount
      : this.calculateRedirectionPeriodAmount(
          targetVehicle.vehicleGroupName,
          order,
          isMidRental,
          vehicleGroups,
          body.effectiveAt
        );
    const rawDiff = Math.round(newAmount - oldAmount);
    if (priceHandling === "free" && rawDiff > 0 && !note) {
      throw new BadRequestException("免费升等必须填写原因说明。");
    }
    if (priceHandling === "free" && rawDiff <= 0) {
      throw new BadRequestException("免费升等只适用于新车辆价格高于原车辆的场景。");
    }

    const actualDiff = priceHandling === "free" && rawDiff > 0 ? 0 : rawDiff;
    const fee = this.createRedirectionFee(
      order,
      targetVehicle,
      actualDiff,
      isMidRental,
      priceHandling,
      reason.label,
      note
    );
    const baseSettlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const settlementSummary = this.mergeSettlementSummary(order, {
      finalReceivableAmount: Math.max(
        0,
        baseSettlement.finalReceivableAmount + actualDiff
      ),
      monthlyBillingPosted:
        order.billingMode === BillingMode.Monthly ||
        baseSettlement.monthlyBillingPosted
    });
    this.settlementSummaries.set(order.id, settlementSummary);

    if (!isMidRental && actualDiff !== 0) {
      order.totalAmount = Math.max(0, order.totalAmount + actualDiff);
    }

    order.plateNo = targetVehicle.licensePlate;
    order.vehicleGroupName = targetVehicle.vehicleGroupName;
    order.dispatchStatus =
      priceHandling === "free" && rawDiff > 0
        ? DispatchStatus.Upgraded
        : DispatchStatus.ManualReassigned;
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter((flag) => flag !== "待人工派车"),
      [
        order.dispatchStatus === DispatchStatus.Upgraded ? "免费升等" : "人工改派",
        actualDiff > 0 ? "改派差价待处理" : actualDiff < 0 ? "改派退费待处理" : "改派无差价"
      ]
    );

    const diffText =
      actualDiff > 0
        ? `改派差价 ${actualDiff}`
        : actualDiff < 0
          ? `改派退费 ${Math.abs(actualDiff)}`
          : priceHandling === "free" && rawDiff > 0
            ? `免费升等，原差价 ${rawDiff}`
            : "价格不变";
    const settlementText =
      order.billingMode === BillingMode.Monthly
        ? "企业月结"
        : isMidRental
          ? "还车结算"
          : "取车尾款";

    return {
      previousPlateNo,
      operator,
      reasonLabel: reason.label,
      fee,
      settlementSummary,
      timelineAction:
        `${order.dispatchStatus === DispatchStatus.Upgraded ? "免费升等" : "订单改派"}：` +
        `${previousVehicleGroupName} ${previousPlateNo} -> ${targetVehicle.vehicleGroupName} ${targetVehicle.licensePlate}，` +
        `${diffText}，${settlementText}处理，原因：${reason.label}` +
        `${note ? `，备注：${note}` : ""}`,
      message:
        order.billingMode === BillingMode.Monthly
          ? "订单改派成功，差价已按企业月结规则进入费用中心。"
          : fee
            ? "订单改派成功，差价已进入费用中心。"
            : "订单改派成功，同组换车或免费升等未生成应收差价。"
    };
  }

  private createRedirectionFee(
    order: StoreRentalOrderSummary,
    targetVehicle: VehicleInstanceSummary,
    actualDiff: number,
    isMidRental: boolean,
    priceHandling: "diff" | "free",
    reasonLabel: string,
    note?: string
  ) {
    if (actualDiff === 0 || priceHandling === "free") {
      return undefined;
    }

    const fee: StoreRentalFeeLedgerItem = this.feeLedgerItem({
      id: `fee_redirection_${randomUUID()}`,
      code: actualDiff > 0 ? "redirection_fee" : "redirection_refund",
      name: actualDiff > 0 ? "改派差价" : "改派退费",
      stage: isMidRental ? "return_settlement" : "pickup",
      source: "manual",
      direction: actualDiff > 0 ? "charge" : "refund",
      status:
        order.billingMode === BillingMode.Monthly ? "monthly_billing" : "pending",
      amount: Math.abs(actualDiff),
      description:
        `${targetVehicle.vehicleGroupName} / ${targetVehicle.licensePlate}，${reasonLabel}` +
        `${note ? `，${note}` : ""}`,
      snapshotRef: `redirection:${order.orderNo}:${Date.now()}`,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);

    return fee;
  }

  private async runMysqlReturnLocationChangeAction(
    order: StoreRentalOrderDetail,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus,
    mode: ReturnLocationChangeMode
  ): Promise<OrderActionEffect & { settlementSummary: StoreRentalSettlementSummary }> {
    const [stations, orders, vehicles, vehicleGroups] = await Promise.all([
      this.storeRentalRepository.listStations(),
      this.storeRentalRepository.listOrders({}),
      this.storeRentalRepository.listVehicles(),
      this.storeRentalRepository.listVehicleGroups()
    ]);
    const effect = this.changeReturnLocation(
      order,
      body,
      previousStatus,
      mode,
      stations,
      orders,
      vehicles,
      vehicleGroups
    );
    if (effect.quickRedirect) {
      const redirect = effect.quickRedirect;
      if (redirect.fee) {
        await this.storeRentalRepository.upsertOrderFeeItem(
          redirect.order.id,
          redirect.fee
        );
      }
      await this.storeRentalRepository.updateOrderState(
        redirect.order,
        redirect.settlementSummary
      );
      await this.storeRentalRepository.appendOrderTimeline(redirect.order.id, {
        at: new Date().toISOString(),
        actor: redirect.operator,
        action: redirect.timelineAction
      });
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        redirect.previousPlateNo,
        this.returnLocationOriginalVehicleStatus(order),
        {
          operator: redirect.operator,
          action: "转单冲突快捷改派释放后续占用",
          reason: `${order.orderNo} 转单影响后续订单 ${redirect.order.orderNo}`
        }
      );
      await this.storeRentalRepository.updateVehicleOperationStatusByPlate(
        redirect.targetVehicle.licensePlate,
        this.redirectionTargetVehicleStatus(redirect.order),
        {
          operator: redirect.operator,
          action: "转单冲突快捷改派锁车",
          reason: `${redirect.order.orderNo} / ${redirect.reasonLabel}`
        }
      );
    }
    if (effect.fee) {
      await this.storeRentalRepository.upsertOrderFeeItem(order.id, effect.fee);
    }

    return {
      timelineAction: effect.timelineAction,
      message: effect.message,
      settlementSummary: effect.settlementSummary
    };
  }

  private changeReturnLocation(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus,
    mode: ReturnLocationChangeMode,
    stations: StoreStationSummary[],
    orders: StoreRentalOrderSummary[],
    vehicles: VehicleInstanceSummary[],
    vehicleGroups: VehicleGroupMaster[]
  ) {
    const operator = String(body.operator ?? "门店营运");
    const reason = this.normalizeReturnLocationReason(
      body.reason ?? body.changeReason
    );
    const note = this.optionalString(body.note) || this.optionalString(body.memo);
    if (reason.value === "other" && !note) {
      throw new BadRequestException("选择其他变更原因时必须填写备注。");
    }

    const target = this.resolveReturnLocationTarget(order, body, mode, stations);
    const originalReturnStoreName = order.returnStoreName;
    const originalReturnStationName = order.returnStationName;
    this.validateReturnLocationTarget(order, target, mode, stations);

    const conflict = this.findReturnLocationConflict(
      order,
      originalReturnStoreName,
      orders
    );
    let quickRedirect: ReturnLocationQuickRedirectEffect | undefined;
    if (conflict && !this.truthyFlag(body.resolveFollowupConflict)) {
      throw new BadRequestException(
        `原还车门市存在后续预约 ${conflict.orderNo}（取车时间 ${conflict.pickupAt}，客户 ${conflict.customerName}），请先改派后续订单再确认转单。`
      );
    }
    if (conflict) {
      quickRedirect = this.quickRedirectReturnLocationConflict(
        order,
        conflict,
        body,
        vehicles,
        vehicleGroups,
        orders
      );
      const timeline = this.orderTimelines.get(conflict.id) ?? this.defaultTimeline(conflict);
      timeline.push({
        at: new Date().toISOString(),
        actor: quickRedirect.operator,
        action: quickRedirect.timelineAction
      });
      this.orderTimelines.set(conflict.id, timeline);
      this.updateVehicleOperationStatus(
        quickRedirect.previousPlateNo,
        this.returnLocationOriginalVehicleStatus(order)
      );
      this.updateVehicleOperationStatus(
        quickRedirect.targetVehicle.licensePlate,
        this.redirectionTargetVehicleStatus(conflict)
      );
    }

    const currentFee = this.calculateOneWayReturnFee(
      order.pickupStoreName,
      originalReturnStoreName,
      stations
    );
    const newFee = this.calculateOneWayReturnFee(
      order.pickupStoreName,
      target.storeName,
      stations
    );
    const diffAmount = Math.round(newFee - currentFee);
    const isMidRental = this.isMidRentalRedirection(previousStatus);
    const fee = this.createReturnLocationChangeFee(
      order,
      mode,
      target,
      diffAmount,
      isMidRental,
      reason.label,
      note
    );

    const baseSettlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const settlementSummary = this.mergeSettlementSummary(order, {
      finalReceivableAmount: Math.max(
        0,
        baseSettlement.finalReceivableAmount + diffAmount
      ),
      monthlyBillingPosted:
        order.billingMode === BillingMode.Monthly ||
        baseSettlement.monthlyBillingPosted
    });
    this.settlementSummaries.set(order.id, settlementSummary);

    if (!isMidRental && diffAmount !== 0) {
      order.totalAmount = Math.max(0, order.totalAmount + diffAmount);
    }

    order.returnStoreName = target.storeName;
    order.returnStationName = target.stationName;
    order.riskFlags = this.returnLocationRiskFlags(
      order,
      mode,
      diffAmount,
      target.storeName
    );

    const diffText =
      diffAmount > 0
        ? `调度费差额 ${diffAmount}`
        : diffAmount < 0
          ? `调度费退差 ${Math.abs(diffAmount)}`
          : "无调度费差额";
    const settlementText =
      order.billingMode === BillingMode.Monthly
        ? "企业月结"
        : isMidRental
          ? "还车结算"
          : "取车尾款";
    const title = mode === "store" ? "改还车门市/转单" : "改还车据点";

    return {
      operator,
      fee,
      quickRedirect,
      settlementSummary,
      timelineAction:
        `${title}：${originalReturnStoreName}${originalReturnStationName ? ` / ${originalReturnStationName}` : ""} -> ` +
        `${target.storeName}${target.stationName ? ` / ${target.stationName}` : ""}，` +
        `${diffText}，${settlementText}处理，原因：${reason.label}` +
        `${quickRedirect ? `，已快捷改派后续订单 ${quickRedirect.order.orderNo} 至 ${quickRedirect.targetVehicle.licensePlate}` : ""}` +
        `${note ? `，备注：${note}` : ""}`,
      message:
        diffAmount === 0
          ? `${title}成功，本次未产生费用差额。`
          : order.billingMode === BillingMode.Monthly
            ? `${title}成功，差额已按企业月结规则进入费用中心。`
            : `${title}成功，差额已进入费用中心。`
    };
  }

  private resolveReturnLocationTarget(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    mode: ReturnLocationChangeMode,
    stations: StoreStationSummary[]
  ) {
    if (mode === "station") {
      const stationId =
        this.optionalString(body.targetStationId) ||
        this.optionalString(body.newStationId) ||
        this.optionalString(body.returnStationId);
      const stationName =
        this.optionalString(body.targetStationName) ||
        this.optionalString(body.newStationName) ||
        this.optionalString(body.returnStationName);
      const station = stations.find((item) =>
        stationId ? item.id === stationId : item.name === stationName
      );
      if (!station) {
        throw new BadRequestException("请选择新的还车据点。");
      }

      return {
        storeName: station.parentStoreName,
        stationName: station.name,
        station
      };
    }

    const storeName =
      this.optionalString(body.targetStoreName) ||
      this.optionalString(body.newStoreName) ||
      this.optionalString(body.returnStoreName) ||
      this.optionalString(body.targetReturnStoreName);
    if (!storeName) {
      throw new BadRequestException("请选择新的还车门市。");
    }
    const station =
      stations.find((item) => item.parentStoreName === storeName) ||
      stations.find((item) => item.name === storeName);

    return {
      storeName,
      stationName:
        this.optionalString(body.targetStationName) ||
        this.optionalString(body.newStationName) ||
        station?.name ||
        order.returnStationName,
      station
    };
  }

  private validateReturnLocationTarget(
    order: StoreRentalOrderSummary,
    target: {
      storeName: string;
      stationName?: string;
      station?: StoreStationSummary;
    },
    mode: ReturnLocationChangeMode,
    stations: StoreStationSummary[]
  ) {
    if (mode === "store" && target.storeName === order.returnStoreName) {
      throw new BadRequestException("新还车门市不能与当前还车门市相同。");
    }
    if (
      mode === "station" &&
      target.storeName === order.returnStoreName &&
      target.stationName === order.returnStationName
    ) {
      throw new BadRequestException("新还车据点不能与当前还车据点相同。");
    }
    if (!target.station) {
      throw new BadRequestException("目标门市未配置可用据点，不能确认转单。");
    }
    const currentStation = stations.find(
      (item) =>
        item.parentStoreName === order.returnStoreName ||
        item.name === order.returnStationName
    );
    if (
      currentStation?.companyName &&
      target.station.companyName &&
      target.station.companyName !== currentStation.companyName
    ) {
      throw new BadRequestException("本期不支持跨车行改还车门市/据点。");
    }
    if (
      target.station.status !== "enabled" ||
      target.station.serviceStatus !== "normal"
    ) {
      throw new BadRequestException("目标门市或据点当前不可用，请联系客服处理。");
    }
    const supportsOrderMode =
      order.mode === StoreRentalMode.SelfService24h
        ? target.station.storeSelfServiceEnabled
        : target.station.storeRentalEnabled;
    if (!supportsOrderMode) {
      throw new BadRequestException("目标门市或据点未开启当前订单服务能力。");
    }
  }

  private findReturnLocationConflict(
    order: StoreRentalOrderSummary,
    originalReturnStoreName: string,
    orders: StoreRentalOrderSummary[]
  ) {
    if (!order.plateNo || order.plateNo === "待人工派车") {
      return undefined;
    }
    const returnAt = new Date(order.returnAt);
    return orders
      .filter((item) => item.id !== order.id)
      .filter((item) => item.plateNo === order.plateNo)
      .filter((item) => item.pickupStoreName === originalReturnStoreName)
      .filter((item) =>
        [
          OrderMainStatus.Reserved,
          OrderMainStatus.PickupOverdue,
          OrderMainStatus.Inspecting
        ].includes(item.mainStatus)
      )
      .filter((item) => new Date(item.pickupAt).getTime() >= returnAt.getTime())
      .sort(
        (left, right) =>
          new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime()
      )[0];
  }

  private quickRedirectReturnLocationConflict(
    currentOrder: StoreRentalOrderSummary,
    conflictOrder: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    vehicles: VehicleInstanceSummary[],
    vehicleGroups: VehicleGroupMaster[],
    orders: StoreRentalOrderSummary[]
  ): ReturnLocationQuickRedirectEffect {
    const requestedVehicleId = this.optionalString(body.followupTargetVehicleId);
    const requestedPlateNo = this.optionalString(body.followupTargetPlateNo);
    const targetVehicle =
      vehicles.find((vehicle) =>
        requestedVehicleId
          ? vehicle.id === requestedVehicleId
          : requestedPlateNo
            ? vehicle.licensePlate === requestedPlateNo
            : false
      ) ??
      this.findQuickRedirectVehicleForConflict(
        conflictOrder,
        vehicles,
        vehicleGroups,
        orders
      );
    const currentVehicle = vehicles.find(
      (vehicle) => vehicle.licensePlate === conflictOrder.plateNo
    );
    this.validateRedirectionVehicle(conflictOrder, targetVehicle, currentVehicle);
    if (
      this.findOrderScheduleConflict(
        orders,
        conflictOrder.id,
        targetVehicle.licensePlate,
        new Date(conflictOrder.pickupAt),
        new Date(conflictOrder.returnAt)
      )
    ) {
      throw new BadRequestException("快捷改派候选车辆在后续订单时段存在占用。");
    }
    const sameGroup = this.vehicleGroupsEquivalent(
      conflictOrder.vehicleGroupName,
      targetVehicle.vehicleGroupName,
      vehicleGroups
    );
    const originalDailyPrice = this.redirectionDailyPrice(
      conflictOrder.vehicleGroupName,
      conflictOrder,
      vehicleGroups
    );
    const targetDailyPrice = this.redirectionDailyPrice(
      targetVehicle.vehicleGroupName,
      conflictOrder,
      vehicleGroups
    );
    if (!sameGroup && targetDailyPrice < originalDailyPrice) {
      throw new BadRequestException("快捷改派只能选择同车组或可升级车辆。");
    }

    const operator = String(body.operator ?? "门店营运");
    const redirectBody: Record<string, unknown> = {
      targetVehicleId: targetVehicle.id,
      targetPlateNo: targetVehicle.licensePlate,
      reason: "return_store_conflict_followup",
      priceHandling: "diff",
      managerOverride: true,
      operator,
      memo:
        this.optionalString(body.followupMemo) ||
        `当前订单 ${currentOrder.orderNo} 改还车门市/据点导致后续预约占用冲突，系统快捷改派后续订单。`
    };

    const effect = this.applyOrderRedirection(
      conflictOrder,
      redirectBody,
      targetVehicle,
      conflictOrder.mainStatus,
      vehicleGroups
    );
    const previousPlateNo = effect.previousPlateNo ?? conflictOrder.plateNo;
    if (!previousPlateNo || previousPlateNo === "待人工派车") {
      throw new BadRequestException("后续冲突订单缺少原车辆，不能快捷改派。");
    }

    return {
      order: conflictOrder,
      targetVehicle,
      previousPlateNo,
      operator: effect.operator,
      reasonLabel: effect.reasonLabel,
      fee: effect.fee,
      settlementSummary: effect.settlementSummary,
      timelineAction:
        `转单冲突快捷改派：当前订单 ${currentOrder.orderNo} 转单前释放车辆占用；` +
        effect.timelineAction,
      message: effect.message
    };
  }

  private findQuickRedirectVehicleForConflict(
    conflictOrder: StoreRentalOrderSummary,
    vehicles: VehicleInstanceSummary[],
    vehicleGroups: VehicleGroupMaster[],
    orders: StoreRentalOrderSummary[]
  ) {
    if (!conflictOrder.plateNo || conflictOrder.plateNo === "待人工派车") {
      throw new BadRequestException("后续冲突订单未绑定车辆，不能快捷改派。");
    }
    const currentVehicle = vehicles.find(
      (vehicle) => vehicle.licensePlate === conflictOrder.plateNo
    );
    const requiredServiceType =
      conflictOrder.mode === StoreRentalMode.SelfService24h
        ? "STORE_24H"
        : "STORE_STANDARD";
    const currentDailyPrice = this.redirectionDailyPrice(
      conflictOrder.vehicleGroupName,
      conflictOrder,
      vehicleGroups
    );
    const candidates = vehicles
      .filter((vehicle) => vehicle.licensePlate !== conflictOrder.plateNo)
      .filter((vehicle) => vehicle.enabled && vehicle.operationStatus === "idle")
      .filter((vehicle) => vehicle.serviceTypes.includes(requiredServiceType))
      .filter(
        (vehicle) =>
          !currentVehicle?.assetCompanyName ||
          !vehicle.assetCompanyName ||
          currentVehicle.assetCompanyName === vehicle.assetCompanyName
      )
      .filter((vehicle) => {
        const sameGroup = this.vehicleGroupsEquivalent(
          conflictOrder.vehicleGroupName,
          vehicle.vehicleGroupName,
          vehicleGroups
        );
        const targetDailyPrice = this.redirectionDailyPrice(
          vehicle.vehicleGroupName,
          conflictOrder,
          vehicleGroups
        );
        return sameGroup || targetDailyPrice >= currentDailyPrice;
      })
      .filter(
        (vehicle) =>
          !this.findOrderScheduleConflict(
            orders,
            conflictOrder.id,
            vehicle.licensePlate,
            new Date(conflictOrder.pickupAt),
            new Date(conflictOrder.returnAt)
          )
      )
      .map((vehicle) => ({
        vehicle,
        score:
          (this.vehicleGroupsEquivalent(
            conflictOrder.vehicleGroupName,
            vehicle.vehicleGroupName,
            vehicleGroups
          )
            ? 100
            : 20) +
          (vehicle.currentStoreName === conflictOrder.pickupStoreName ? 30 : 0) +
          (vehicle.currentServiceType === requiredServiceType ? 10 : 0)
      }))
      .sort((left, right) => right.score - left.score)
      .map((item) => item.vehicle);

    if (!candidates.length) {
      throw new BadRequestException(
        `后续订单 ${conflictOrder.orderNo} 暂无同车行、同组或可升级的空闲车辆，不能快捷改派。`
      );
    }

    return candidates[0];
  }

  private findOrderScheduleConflict(
    orders: StoreRentalOrderSummary[],
    excludeOrderId: string,
    targetPlateNo: string,
    pickupAt: Date,
    returnAt: Date
  ) {
    return orders.find(
      (item) =>
        item.id !== excludeOrderId &&
        item.plateNo === targetPlateNo &&
        this.orderOccupiesInventory(item) &&
        this.periodOverlaps(
          pickupAt,
          returnAt,
          new Date(item.pickupAt),
          new Date(item.returnAt)
        )
    );
  }

  private calculateOneWayReturnFee(
    pickupStoreName: string,
    returnStoreName: string,
    stations: StoreStationSummary[]
  ) {
    if (pickupStoreName === returnStoreName) {
      return 0;
    }
    const pickupStoreCode = this.getStoreCodeByName(pickupStoreName, stations);
    const returnStoreCode = this.getStoreCodeByName(returnStoreName, stations);
    const storeAdjustment = this.pricingPlans[0].storeAdjustments.find(
      (item) =>
        item.pickupStoreCode === pickupStoreCode &&
        item.returnStoreCode === returnStoreCode
    );

    return storeAdjustment?.amount ?? this.ruleConfig.oneWayReturn.baseFeeAmount;
  }

  private createReturnLocationChangeFee(
    order: StoreRentalOrderSummary,
    mode: ReturnLocationChangeMode,
    target: { storeName: string; stationName?: string },
    diffAmount: number,
    isMidRental: boolean,
    reasonLabel: string,
    note?: string
  ) {
    if (diffAmount === 0) {
      return undefined;
    }

    const fee: StoreRentalFeeLedgerItem = this.feeLedgerItem({
      id: `fee_return_location_${randomUUID()}`,
      code:
        diffAmount > 0
          ? "return_store_change_fee"
          : "return_store_change_refund",
      name: diffAmount > 0 ? "改还车调度费差额" : "改还车调度费退差",
      stage: isMidRental ? "return_settlement" : "pickup",
      source: "manual",
      direction: diffAmount > 0 ? "charge" : "refund",
      status:
        order.billingMode === BillingMode.Monthly ? "monthly_billing" : "pending",
      amount: Math.abs(diffAmount),
      description:
        `${mode === "store" ? "改还车门市" : "改还车据点"}至 ${target.storeName}` +
        `${target.stationName ? ` / ${target.stationName}` : ""}，${reasonLabel}` +
        `${note ? `，${note}` : ""}`,
      snapshotRef: `return-location:${order.orderNo}:${Date.now()}`,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);

    return fee;
  }

  private normalizeReturnLocationReason(value: unknown) {
    const raw = this.optionalString(value);
    if (!raw) {
      throw new BadRequestException("请选择变更原因。");
    }
    const reasons: Record<string, { value: string; label: string }> = {
      customer_request: { value: "customer_request", label: "客户要求改还车门市" },
      "客户要求改还车门市": {
        value: "customer_request",
        label: "客户要求改还车门市"
      },
      store_negotiation: {
        value: "store_negotiation",
        label: "门店协商改还车门市"
      },
      "门店协商改还车门市": {
        value: "store_negotiation",
        label: "门店协商改还车门市"
      },
      vehicle_rebalancing: { value: "vehicle_rebalancing", label: "车辆回流安排" },
      "车辆回流安排": { value: "vehicle_rebalancing", label: "车辆回流安排" },
      original_store_unavailable: {
        value: "original_store_unavailable",
        label: "原还车门市无法接收"
      },
      "原还车门市无法接收": {
        value: "original_store_unavailable",
        label: "原还车门市无法接收"
      },
      accident_exception: {
        value: "accident_exception",
        label: "事故/异常处理需要"
      },
      "事故/异常处理需要": {
        value: "accident_exception",
        label: "事故/异常处理需要"
      },
      other: { value: "other", label: "其他" },
      "其他": { value: "other", label: "其他" }
    };
    const reason = reasons[raw];
    if (!reason) {
      throw new BadRequestException("变更原因无效。");
    }

    return reason;
  }

  private returnLocationRiskFlags(
    order: StoreRentalOrderSummary,
    mode: ReturnLocationChangeMode,
    diffAmount: number,
    targetStoreName: string
  ) {
    const flags = order.riskFlags.filter(
      (flag) =>
        ![
          "异店还车",
          "改还车门市",
          "改还车据点",
          "转单差价待处理",
          "转单退费待处理",
          "转单无差价"
        ].includes(flag)
    );
    const nextFlags = [
      ...flags,
      ...(order.pickupStoreName !== targetStoreName ? ["异店还车"] : []),
      mode === "store" ? "改还车门市" : "改还车据点",
      diffAmount > 0
        ? "转单差价待处理"
        : diffAmount < 0
          ? "转单退费待处理"
          : "转单无差价"
    ];

    return this.uniqueFlags([], nextFlags);
  }

  private normalizeRedirectionReason(value: unknown) {
    const raw = this.optionalString(value);
    if (!raw) {
      throw new BadRequestException("请选择改派原因。");
    }
    const reasons: Record<string, { value: string; label: string }> = {
      vehicle_fault: { value: "vehicle_fault", label: "原车故障" },
      "原车故障": { value: "vehicle_fault", label: "原车故障" },
      vehicle_not_ready: { value: "vehicle_not_ready", label: "原车未整备完成" },
      "原车未整备完成": { value: "vehicle_not_ready", label: "原车未整备完成" },
      vehicle_unavailable: { value: "vehicle_unavailable", label: "原车事故/不可交付" },
      "原车事故/不可交付": { value: "vehicle_unavailable", label: "原车事故/不可交付" },
      customer_upgrade: { value: "customer_upgrade", label: "客户要求升级" },
      "客户要求升级": { value: "customer_upgrade", label: "客户要求升级" },
      customer_downgrade: { value: "customer_downgrade", label: "客户同意降级" },
      "客户同意降级": { value: "customer_downgrade", label: "客户同意降级" },
      store_free_upgrade: { value: "store_free_upgrade", label: "门店免费升等" },
      "门店免费升等": { value: "store_free_upgrade", label: "门店免费升等" },
      dispatch_adjustment: { value: "dispatch_adjustment", label: "车辆调度调整" },
      "车辆调度调整": { value: "dispatch_adjustment", label: "车辆调度调整" },
      extend_conflict_followup: {
        value: "extend_conflict_followup",
        label: "续租冲突改派后续订单"
      },
      "续租冲突改派后续订单": {
        value: "extend_conflict_followup",
        label: "续租冲突改派后续订单"
      },
      return_store_conflict_followup: {
        value: "return_store_conflict_followup",
        label: "转单冲突改派后续订单"
      },
      "转单冲突改派后续订单": {
        value: "return_store_conflict_followup",
        label: "转单冲突改派后续订单"
      },
      other: { value: "other", label: "其他" },
      "其他": { value: "other", label: "其他" }
    };
    const matched = reasons[raw];
    if (!matched) {
      throw new BadRequestException("改派原因无效。");
    }

    return matched;
  }

  private normalizeRedirectionPriceHandling(value: unknown): "diff" | "free" {
    const raw = this.optionalString(value);
    if (!raw || raw === "diff") {
      return "diff";
    }
    if (raw === "free") {
      return "free";
    }
    throw new BadRequestException("改派差价处理方式无效。");
  }

  private ensureRedirectionFinancialAllowed(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>
  ) {
    const overview =
      "financialOverview" in order
        ? (order as StoreRentalOrderDetail).financialOverview
        : this.buildFinancialOverview(order);
    const unsettledAmount =
      overview.pendingAmount + overview.refundAmount + overview.postChargeAmount;
    if (unsettledAmount > 0 && !this.truthyFlag(body.managerOverride)) {
      throw new BadRequestException(
        "当前订单存在未结清费用，请先处理费用或由店长授权继续改派。"
      );
    }
    if (this.truthyFlag(body.managerOverride) && !this.optionalString(body.memo)) {
      throw new BadRequestException("店长授权继续改派时必须填写备注。");
    }
  }

  private vehicleGroupsEquivalent(
    leftName: string,
    rightName: string,
    vehicleGroups: VehicleGroupMaster[]
  ) {
    const left = this.findVehicleGroupForVehicle(leftName, vehicleGroups);
    const right = this.findVehicleGroupForVehicle(rightName, vehicleGroups);
    if (left && right) {
      return left.id === right.id;
    }
    return leftName === rightName || leftName.split(" / ")[0] === rightName.split(" / ")[0];
  }

  private calculateRedirectionPeriodAmount(
    vehicleGroupName: string,
    order: StoreRentalOrderSummary,
    isMidRental: boolean,
    vehicleGroups: VehicleGroupMaster[],
    effectiveAtValue: unknown
  ) {
    const dailyPrice = this.redirectionDailyPrice(vehicleGroupName, order, vehicleGroups);
    const startAt = isMidRental
      ? this.optionalString(effectiveAtValue)
        ? this.requiredDate(effectiveAtValue, "改派生效时间无效。")
        : new Date()
      : new Date(order.pickupAt);
    const endAt = new Date(order.returnAt);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      throw new BadRequestException("订单取还车时间无效，不能试算改派差价。");
    }
    const hours = Math.max(
      1,
      Math.ceil((endAt.getTime() - startAt.getTime()) / 3_600_000)
    );
    const billableRatio = hours < 5 ? hours / 5 : Math.max(1, Math.ceil(hours / 24));

    return Math.round(dailyPrice * billableRatio);
  }

  private redirectionDailyPrice(
    vehicleGroupName: string,
    order: StoreRentalOrderSummary,
    vehicleGroups: VehicleGroupMaster[]
  ) {
    const group = this.findVehicleGroupForVehicle(vehicleGroupName, vehicleGroups);
    if (group?.dailyPrice && group.dailyPrice > 0) {
      return group.dailyPrice;
    }

    const pickupAt = new Date(order.pickupAt);
    const returnAt = new Date(order.returnAt);
    const hours = Number.isFinite(pickupAt.getTime()) && Number.isFinite(returnAt.getTime())
      ? Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 3_600_000))
      : 24;
    const billableDays = Math.max(1, Math.ceil(hours / 24));

    return Math.max(1, Math.round(order.totalAmount / billableDays));
  }

  private isMidRentalRedirection(status: OrderMainStatus) {
    return [
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue,
      OrderMainStatus.AccidentProcessing
    ].includes(status);
  }

  private redirectionTargetVehicleStatus(
    order: StoreRentalOrderSummary
  ): VehicleInstanceSummary["operationStatus"] {
    return this.isMidRentalRedirection(order.mainStatus) ? "renting" : "reserved";
  }

  private returnLocationOriginalVehicleStatus(
    currentOrder: StoreRentalOrderSummary
  ): VehicleInstanceSummary["operationStatus"] {
    if (currentOrder.mainStatus === OrderMainStatus.AccidentProcessing) {
      return "controlled";
    }
    return this.redirectionTargetVehicleStatus(currentOrder);
  }

  private findRedirectionConflict(
    order: StoreRentalOrderSummary,
    targetPlateNo: string
  ) {
    const pickupAt = new Date(order.pickupAt);
    const returnAt = new Date(order.returnAt);
    return this.orders.find(
      (item) =>
        item.id !== order.id &&
        item.plateNo === targetPlateNo &&
        this.orderOccupiesInventory(item) &&
        this.periodOverlaps(
          pickupAt,
          returnAt,
          new Date(item.pickupAt),
          new Date(item.returnAt)
        )
    );
  }

  private registerOrderAccident(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const accident = this.buildOrderAccidentPayload(order, body);
    const vehicle = this.vehicles.find(
      (item) => item.licensePlate === order.plateNo
    );
    if (vehicle) {
      const records = this.vehicleAccidentRecords.get(vehicle.id) ?? [];
      records.unshift(accident.record);
      this.vehicleAccidentRecords.set(vehicle.id, records.slice(0, 80));
    }

    const financial = this.applyAccidentFeeToOrder(order, accident, previousStatus);
    this.applyAccidentStatusToOrder(order, previousStatus, accident);
    this.persistCompletedAccidentMonthlyBill(order, accident, financial.fee);
    if (accident.record.claimStatus !== "closed") {
      this.updateVehicleOperationStatus(order.plateNo, "controlled");
    }

    return this.accidentActionEffect(order, accident, financial.fee, previousStatus);
  }

  private async runMysqlAccidentAction(
    order: StoreRentalOrderDetail,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): Promise<OrderActionEffect & { settlementSummary: StoreRentalSettlementSummary }> {
    const accident = this.buildOrderAccidentPayload(order, body);
    const vehicle = await this.storeRentalRepository.findVehicleByPlateNo(order.plateNo);
    if (!vehicle) {
      throw new BadRequestException("事故登记必须关联有效车辆档案。");
    }

    const scratch = this.startMysqlOrderActionScratch(order);
    try {
      await this.storeRentalRepository.createVehicleAccidentRecord(
        vehicle.id,
        accident.record,
        accident.operator
      );

      const financial = this.applyAccidentFeeToOrder(order, accident, previousStatus);
      this.applyAccidentStatusToOrder(order, previousStatus, accident);

      for (const fee of scratch.generatedFees().reverse()) {
        await this.storeRentalRepository.upsertOrderFeeItem(order.id, fee);
      }
      if (
        order.billingMode === BillingMode.Monthly &&
        previousStatus === OrderMainStatus.Completed &&
        financial.fee
      ) {
        await this.storeRentalRepository.createOrderTransaction(order.id, {
          id: `txn_accident_${randomUUID()}`,
          type: "monthly_bill",
          channel: "internal",
          amount: financial.fee.amount,
          status: "success",
          at: new Date().toISOString(),
          operator: accident.operator,
          relatedFeeIds: [financial.fee.id],
          note: `完成后事故费用月结挂账：${accident.record.reportNo}`
        });
      }
      if (accident.record.claimStatus !== "closed") {
        await this.processDispatchVehicleUnavailable({
          plateNo: order.plateNo,
          reason: "accident",
          targetOperationStatus: "controlled",
          operator: accident.operator,
          memo: `${order.orderNo} / ${accident.record.reportNo} / ${accident.responsibilityLabel}`,
          tryAutoReassign: true
        });
      }

      return {
        ...this.accidentActionEffect(order, accident, financial.fee, previousStatus),
        settlementSummary: financial.settlementSummary
      };
    } finally {
      scratch.restore();
    }
  }

  private buildOrderAccidentPayload(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>
  ) {
    if (!order.plateNo || order.plateNo === "待人工派车") {
      throw new BadRequestException("事故登记必须有关联车辆。");
    }

    const description =
      this.optionalString(body.description) ||
      this.optionalString(body.accidentDescription);
    if (!description) {
      throw new BadRequestException("请填写事故描述。");
    }

    const responsibility = this.normalizeAccidentResponsibility(
      body.responsibility
    );
    const claimStatus = this.normalizeAccidentClaimStatus(
      body.claimStatus ?? body.handlingStatus
    );
    const accidentAt = this.requiredDate(
      body.accidentAt ?? body.accidentTime ?? new Date().toISOString(),
      "事故时间不能为空。"
    );
    const location = this.optionalString(body.location);
    const memo = this.optionalString(body.remark) || this.optionalString(body.memo);
    const estimatedCostAmount = Math.max(
      0,
      Math.round(
        this.optionalNumber(
          body.estimatedCostAmount ?? body.estimatedAmount ?? body.amount
        ) ?? 0
      )
    );
    const reportNo =
      this.optionalString(body.reportNo) ||
      this.optionalString(body.insuranceNo) ||
      `ACC-${order.orderNo}-${Date.now()}`;
    const detailParts = [
      description,
      location ? `事故地点：${location}` : undefined,
      `责任归属：${responsibility.label}`,
      memo ? `处理备注：${memo}` : undefined
    ].filter(Boolean);
    const record: VehicleAccidentRecord = {
      id: `acc_${randomUUID()}`,
      date: accidentAt.toISOString().slice(0, 10),
      description: detailParts.join("；"),
      claimStatus,
      estimatedCostAmount,
      reportNo
    };

    return {
      operator: String(body.operator ?? "门店营运"),
      record,
      responsibility: responsibility.value,
      responsibilityLabel: responsibility.label,
      chargeable: responsibility.chargeable,
      location,
      memo,
      estimatedCostAmount
    };
  }

  private normalizeAccidentResponsibility(value: unknown) {
    const raw = this.optionalString(value);
    if (!raw) {
      throw new BadRequestException("请选择责任归属。");
    }
    const key = raw.toLowerCase();
    const map: Record<string, { value: string; label: string; chargeable: boolean }> = {
      customer: { value: "customer", label: "客户责任", chargeable: true },
      "客户责任": { value: "customer", label: "客户责任", chargeable: true },
      store: { value: "store", label: "门店责任", chargeable: false },
      "门店责任": { value: "store", label: "门店责任", chargeable: false },
      third_party: {
        value: "third_party",
        label: "第三方责任",
        chargeable: true
      },
      thirdparty: {
        value: "third_party",
        label: "第三方责任",
        chargeable: true
      },
      "第三方责任": {
        value: "third_party",
        label: "第三方责任",
        chargeable: true
      },
      pending: { value: "pending", label: "责任待定", chargeable: true },
      "责任待定": { value: "pending", label: "责任待定", chargeable: true }
    };
    const matched = map[key] ?? map[raw];
    if (!matched) {
      throw new BadRequestException("责任归属无效。");
    }

    return matched;
  }

  private normalizeAccidentClaimStatus(
    value: unknown
  ): VehicleAccidentRecord["claimStatus"] {
    const raw = this.optionalString(value)?.toLowerCase();
    if (!raw) {
      return "processing";
    }
    if (["pending", "pending_assessment", "待定损"].includes(raw)) {
      return "pending";
    }
    if (["closed", "已结案"].includes(raw)) {
      return "closed";
    }
    if (
      [
        "processing",
        "insurance_processing",
        "customer_confirming",
        "保险处理中",
        "客户确认中"
      ].includes(raw)
    ) {
      return "processing";
    }

    throw new BadRequestException("事故处理状态无效。");
  }

  private accidentClaimStatusLabel(status: VehicleAccidentRecord["claimStatus"]) {
    const labels: Record<VehicleAccidentRecord["claimStatus"], string> = {
      pending: "待定损",
      processing: "处理中",
      closed: "已结案"
    };

    return labels[status];
  }

  private applyAccidentFeeToOrder(
    order: StoreRentalOrderSummary,
    accident: ReturnType<StoreRentalService["buildOrderAccidentPayload"]>,
    previousStatus: OrderMainStatus
  ) {
    const baseSettlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const amount = accident.chargeable ? accident.estimatedCostAmount : 0;
    if (amount <= 0) {
      return {
        settlementSummary: baseSettlement,
        fee: undefined as StoreRentalFeeLedgerItem | undefined
      };
    }

    const isPostCharge = previousStatus === OrderMainStatus.Completed;
    const fee = this.feeLedgerItem({
      id: `fee_accident_${randomUUID()}`,
      code: isPostCharge ? "accident_post_charge" : "accident_damage",
      name: isPostCharge ? "事故追缴" : "事故车损费用",
      stage: isPostCharge ? "post_charge" : "return_settlement",
      source: "manual",
      direction: "charge",
      status:
        order.billingMode === BillingMode.Monthly ? "monthly_billing" : "pending",
      amount,
      description: `${accident.responsibilityLabel}，${accident.record.description}`,
      snapshotRef: `accident:${order.orderNo}:${accident.record.id}`,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);

    const settlementSummary = this.mergeSettlementSummary(order, {
      finalReceivableAmount: baseSettlement.finalReceivableAmount + amount,
      monthlyBillingPosted:
        order.billingMode === BillingMode.Monthly ||
        baseSettlement.monthlyBillingPosted
    });
    this.settlementSummaries.set(order.id, settlementSummary);

    if (
      isPostCharge &&
      order.billingMode === BillingMode.CustomerPay &&
      order.paymentStatus !== PaymentStatus.MonthlyBilling
    ) {
      order.paymentStatus = PaymentStatus.PaymentDue;
    }

    return { settlementSummary, fee };
  }

  private applyAccidentStatusToOrder(
    order: StoreRentalOrderSummary,
    previousStatus: OrderMainStatus,
    accident: ReturnType<StoreRentalService["buildOrderAccidentPayload"]>
  ) {
    if (
      [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue
      ].includes(previousStatus)
    ) {
      order.mainStatus = OrderMainStatus.AccidentProcessing;
    }

    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter((flag) => flag !== "待还车"),
      [
        "事故上报",
        accident.record.claimStatus === "closed" ? "事故已结案" : "事故处理中",
        accident.chargeable && accident.estimatedCostAmount > 0
          ? "事故费用待处理"
          : "事故费用待定"
      ]
    );
  }

  private persistCompletedAccidentMonthlyBill(
    order: StoreRentalOrderSummary,
    accident: ReturnType<StoreRentalService["buildOrderAccidentPayload"]>,
    fee: StoreRentalFeeLedgerItem | undefined
  ) {
    if (
      !fee ||
      order.billingMode !== BillingMode.Monthly ||
      order.mainStatus !== OrderMainStatus.Completed
    ) {
      return;
    }

    this.persistTransaction(order.id, {
      type: "monthly_bill",
      channel: "internal",
      amount: fee.amount,
      operator: accident.operator,
      relatedFeeIds: [fee.id],
      note: `完成后事故费用月结挂账：${accident.record.reportNo}`
    });
  }

  private accidentActionEffect(
    order: StoreRentalOrderSummary,
    accident: ReturnType<StoreRentalService["buildOrderAccidentPayload"]>,
    fee: StoreRentalFeeLedgerItem | undefined,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const amountText =
      accident.estimatedCostAmount > 0
        ? `预估费用 ${accident.estimatedCostAmount}`
        : "预估费用待定";
    const timelineAction =
      `事故登记：${accident.record.reportNo}，${accident.responsibilityLabel}，` +
      `${this.accidentClaimStatusLabel(accident.record.claimStatus)}，${amountText}` +
      `${accident.location ? `，地点：${accident.location}` : ""}` +
      `${accident.memo ? `，备注：${accident.memo}` : ""}`;
    const activeStatus = [
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue
    ].includes(previousStatus);
    const completedPostCharge = previousStatus === OrderMainStatus.Completed;
    const feeMessage = fee
      ? order.billingMode === BillingMode.Monthly
        ? completedPostCharge
          ? "事故费用已生成企业月结挂账。"
          : "事故费用已进入企业月结费用中心，待还车结算挂账。"
        : completedPostCharge
          ? "事故费用已进入完成后追缴。"
          : "事故费用已进入费用中心并参与还车结算。"
      : "事故记录已保存，费用待定或不向客户收取。";

    return {
      timelineAction,
      message: activeStatus
        ? `事故已登记，订单进入出险处理中。${feeMessage}`
        : `事故已登记，订单主状态保持 ${order.mainStatus}。${feeMessage}`
    };
  }

  private cancelOrder(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const operator = String(body.operator ?? "门店营运");
    const reason = this.requiredActionReason(
      body.reason ?? body.cancelReason,
      "取消原因不能为空。"
    );
    const memo = this.optionalString(body.memo);
    const specialWaiver = this.truthyFlag(body.specialWaiver);
    if (specialWaiver && !memo && !this.optionalString(body.waiverReason)) {
      throw new BadRequestException("特殊减免必须填写减免说明。");
    }

    const customerReceivedAmount =
      order.billingMode === BillingMode.CustomerPay
        ? this.customerReceivedBeforeTerminal(order)
        : 0;
    const estimate = this.calculateCancellationEstimate(order, specialWaiver);
    const charge = this.addTerminationCharge(order, {
      code: "cancellation_fee",
      name: "取消费",
      source: "system",
      amount: estimate.feeAmount,
      description: `${estimate.cancelType}，按取消规则快照计算。`,
      operator,
      note: "取消订单扣取取消费。"
    });

    if (estimate.waiverAmount > 0) {
      this.persistTransaction(order.id, {
        type: "waiver",
        channel: "internal",
        amount: estimate.waiverAmount,
        operator,
        relatedFeeIds: charge.feeId ? [charge.feeId] : [],
        note: this.optionalString(body.waiverReason) || memo || "取消订单特殊减免。"
      });
    }

    const releaseAmount = this.releaseRemainingPreAuth(
      order,
      charge.feeId,
      charge.capturedAmount,
      "取消订单后释放剩余预授权。",
      operator
    );
    const refundAmount =
      order.billingMode === BillingMode.CustomerPay
        ? Math.max(0, Math.round(customerReceivedAmount))
        : 0;
    if (refundAmount > 0) {
      this.persistTransaction(order.id, {
        type: "refund",
        channel: "offline",
        amount: refundAmount,
        operator,
        relatedFeeIds: charge.feeId ? [charge.feeId] : [],
        note: "取消订单退还已收订单款。"
      });
    }

    this.applyTerminalSettlement(order, estimate.feeAmount, charge.capturedAmount);
    this.releaseOrderResources(order, "idle");
    order.mainStatus = OrderMainStatus.Cancelled;
    order.paymentStatus = this.terminalPaymentStatus(
      order,
      estimate.feeAmount,
      charge.pendingAmount,
      refundAmount,
      releaseAmount
    );
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter((flag) => !["待取车", "取车中", "操作锁有效"].includes(flag)),
      estimate.feeAmount > 0 ? ["已取消", "取消费"] : ["已取消"]
    );

    return {
      timelineAction:
        `取消订单：${previousStatus} -> ${order.mainStatus}，原因：${reason}，` +
        `取消类型：${estimate.cancelType}，取消费：${estimate.feeAmount}` +
        `${charge.capturedAmount > 0 ? `，预授权扣款：${charge.capturedAmount}` : ""}` +
        `${releaseAmount > 0 ? `，预授权释放：${releaseAmount}` : ""}` +
        `${refundAmount > 0 ? `，退款：${refundAmount}` : ""}` +
        `${this.actionMemo(body)}`,
      message:
        estimate.feeAmount > 0
          ? "订单已取消，取消费和预授权/退款处理已写入费用中心。"
          : "订单已取消，车辆资源已释放。"
    };
  }

  private markOrderNoShow(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const operator = String(body.operator ?? "门店营运");
    const contactResult = this.requiredActionReason(
      body.reason ?? body.contactResult,
      "联系结果不能为空。"
    );
    const pickupAt = new Date(order.pickupAt);
    const holdUntil = new Date(
      pickupAt.getTime() + this.ruleConfig.noShow.vehicleHoldHours * 3_600_000
    );
    if (Number.isFinite(holdUntil.getTime()) && new Date() < holdUntil) {
      throw new BadRequestException("未达到爽约保留时长，不能标记爽约。");
    }

    const noShowFeeAmount = this.calculateNoShowFee(order);
    const charge = this.addTerminationCharge(order, {
      code: "no_show_fee",
      name: "爽约费",
      source: "system",
      amount: noShowFeeAmount,
      description: "客户超过取车保留时长未履约，按爽约规则快照计算。",
      operator,
      note: "标记爽约扣取爽约费。"
    });
    const releaseAmount = this.releaseRemainingPreAuth(
      order,
      charge.feeId,
      charge.capturedAmount,
      "标记爽约后释放剩余预授权。",
      operator
    );

    this.applyTerminalSettlement(order, noShowFeeAmount, charge.capturedAmount);
    this.releaseOrderResources(order, "idle");
    order.mainStatus = OrderMainStatus.NoShow;
    order.paymentStatus = this.terminalPaymentStatus(
      order,
      noShowFeeAmount,
      charge.pendingAmount,
      0,
      releaseAmount
    );
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter((flag) => !["待取车", "取车中", "操作锁有效"].includes(flag)),
      noShowFeeAmount > 0 ? ["已爽约", "爽约费"] : ["已爽约"]
    );

    return {
      timelineAction:
        `标记爽约：${previousStatus} -> ${order.mainStatus}，联系结果：${contactResult}，` +
        `爽约费：${noShowFeeAmount}` +
        `${charge.capturedAmount > 0 ? `，预授权扣款：${charge.capturedAmount}` : ""}` +
        `${releaseAmount > 0 ? `，预授权释放：${releaseAmount}` : ""}` +
        `${this.actionMemo(body)}`,
      message: "订单已标记爽约，车辆资源已释放，费用中心已生成爽约处理记录。"
    };
  }

  private rejectOrder(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const operator = String(body.operator ?? "门店营运");
    const reason = this.requiredActionReason(
      body.reason ?? body.rejectReason,
      "拒绝履约原因不能为空。"
    );
    const rejectionFeeAmount = Math.max(
      0,
      Math.round(
        this.optionalNumber(body.feeAmount) ??
          this.optionalNumber(body.rejectionFeeAmount) ??
          0
      )
    );
    const charge = this.addTerminationCharge(order, {
      code: "rejection_fee",
      name: "拒绝履约费用",
      source: "manual",
      amount: rejectionFeeAmount,
      description: `取车资质不通过，拒绝履约原因：${reason}。`,
      operator,
      note: "拒绝履约收取责任费用。"
    });
    const releaseAmount = this.releaseRemainingPreAuth(
      order,
      charge.feeId,
      charge.capturedAmount,
      "拒绝履约后释放剩余预授权。",
      operator
    );

    this.applyTerminalSettlement(order, rejectionFeeAmount, charge.capturedAmount);
    this.releaseOrderResources(order, "idle");
    order.mainStatus = OrderMainStatus.Rejected;
    order.paymentStatus = this.terminalPaymentStatus(
      order,
      rejectionFeeAmount,
      charge.pendingAmount,
      0,
      releaseAmount
    );
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter((flag) => !["取车中", "操作锁有效"].includes(flag)),
      rejectionFeeAmount > 0 ? ["已拒绝履约", "拒绝履约费用"] : ["已拒绝履约"]
    );

    return {
      timelineAction:
        `拒绝履约：${previousStatus} -> ${order.mainStatus}，原因：${reason}，` +
        `拒绝履约费用：${rejectionFeeAmount}` +
        `${charge.capturedAmount > 0 ? `，预授权扣款：${charge.capturedAmount}` : ""}` +
        `${releaseAmount > 0 ? `，预授权释放：${releaseAmount}` : ""}` +
        `${this.actionMemo(body)}`,
      message: "订单已拒绝履约，车辆资源和操作锁已释放。"
    };
  }

  private closeOrder(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>,
    previousStatus: OrderMainStatus
  ): OrderActionEffect {
    const operator = String(body.operator ?? "门店营运");
    const reason = this.requiredActionReason(
      body.reason ?? body.closeReason,
      "关闭原因不能为空。"
    );
    if (
      !this.truthyFlag(body.customerCommunicationConfirmed) &&
      !this.truthyFlag(body.communicationConfirmed)
    ) {
      throw new BadRequestException("关闭订单必须确认已与客户或企业沟通。");
    }

    const refundAmount =
      order.billingMode === BillingMode.CustomerPay
        ? this.customerReceivedBeforeTerminal(order)
        : 0;
    const refundFeeId = this.addTerminalRefundFee(
      order,
      refundAmount,
      reason,
      operator
    );
    const releaseAmount = this.releaseRemainingPreAuth(
      order,
      refundFeeId,
      0,
      "关闭订单后释放预授权。",
      operator
    );

    this.applyTerminalSettlement(order, 0, 0);
    this.releaseOrderResources(order, "idle");
    order.mainStatus = OrderMainStatus.Closed;
    order.paymentStatus = this.terminalPaymentStatus(
      order,
      0,
      0,
      refundAmount,
      releaseAmount
    );
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter(
        (flag) => !["待取车", "取车中", "操作锁有效", "租赁中", "续租中"].includes(flag)
      ),
      ["已关闭"]
    );

    return {
      timelineAction:
        `关闭订单：${previousStatus} -> ${order.mainStatus}，原因：${reason}，` +
        `${refundAmount > 0 ? `退款：${refundAmount}，` : ""}` +
        `${releaseAmount > 0 ? `预授权释放：${releaseAmount}，` : ""}` +
        `确认已沟通${this.actionMemo(body)}`,
      message:
        order.billingMode === BillingMode.Monthly
          ? "订单已关闭，企业月结不生成账单，车辆资源已释放。"
          : "订单已关闭，退款和预授权释放记录已写入费用中心。"
    };
  }

  private requiredActionReason(value: unknown, message: string) {
    const reason = this.optionalString(value);
    if (!reason) {
      throw new BadRequestException(message);
    }

    return reason;
  }

  private truthyFlag(value: unknown) {
    return value === true || value === "true" || value === 1 || value === "1";
  }

  private calculateCancellationEstimate(
    order: StoreRentalOrderSummary,
    specialWaiver: boolean
  ): CancellationEstimate {
    const pickupAt = new Date(order.pickupAt);
    const hoursBeforePickup = Number.isFinite(pickupAt.getTime())
      ? (pickupAt.getTime() - Date.now()) / 3_600_000
      : 0;
    const baseAmount =
      order.billingMode === BillingMode.Monthly
        ? order.totalAmount
        : this.terminalPreAuthAmount(order);
    let originalFeeAmount = 0;

    if (
      order.mainStatus !== OrderMainStatus.PendingPayment &&
      hoursBeforePickup < this.ruleConfig.cancellation.freeCancelBeforeHours
    ) {
      if (this.ruleConfig.cancellation.tieredDeductionEnabled) {
        if (hoursBeforePickup >= 12) {
          originalFeeAmount = Math.round(baseAmount * 0.2);
        } else if (hoursBeforePickup >= 2) {
          originalFeeAmount = Math.round(baseAmount * 0.5);
        } else {
          originalFeeAmount = Math.round(baseAmount);
        }
      } else if (
        this.ruleConfig.cancellation.responsibleCancelMode === "fixed_amount"
      ) {
        originalFeeAmount = this.ruleConfig.cancellation.responsibleCancelFixedAmount;
      } else {
        originalFeeAmount = Math.round(
          baseAmount *
            (this.ruleConfig.cancellation.responsibleCancelPreAuthRatioPercent / 100)
        );
      }
    }

    const feeAmount = specialWaiver ? 0 : originalFeeAmount;

    return {
      cancelType: originalFeeAmount > 0 ? "有责取消" : "免责取消",
      hoursBeforePickup,
      originalFeeAmount,
      feeAmount,
      waiverAmount: Math.max(0, originalFeeAmount - feeAmount)
    };
  }

  private calculateNoShowFee(order: StoreRentalOrderSummary) {
    if (!this.ruleConfig.noShow.chargeNoShowFee) {
      return 0;
    }
    if (this.ruleConfig.noShow.noShowFeeMode === "fixed_amount") {
      return Math.max(0, Math.round(this.ruleConfig.noShow.noShowFeeAmount));
    }

    return Math.max(
      0,
      Math.round(
        this.terminalPreAuthAmount(order) *
          (this.ruleConfig.noShow.noShowPreAuthRatioPercent / 100)
      )
    );
  }

  private addTerminationCharge(
    order: StoreRentalOrderSummary,
    input: TerminationChargeInput
  ): TerminationChargeResult {
    const feeAmount = Math.max(0, Math.round(input.amount));
    if (feeAmount <= 0) {
      return {
        feeAmount: 0,
        capturedAmount: 0,
        pendingAmount: 0
      };
    }

    const isMonthly = order.billingMode === BillingMode.Monthly;
    const preAuthAmount = isMonthly ? 0 : this.terminalPreAuthAmount(order);
    const capturedAmount = isMonthly ? 0 : Math.min(feeAmount, preAuthAmount);
    const pendingAmount = isMonthly ? 0 : Math.max(0, feeAmount - capturedAmount);
    const fee = this.feeLedgerItem({
      id: `fee_terminal_${randomUUID()}`,
      code: input.code,
      name: input.name,
      stage: "rental",
      source: input.source,
      direction: "charge",
      status: isMonthly ? "monthly_billing" : pendingAmount > 0 ? "pending" : "settled",
      amount: feeAmount,
      description: input.description,
      snapshotRef: `${input.code}:${order.orderNo}:${Date.now()}`,
      createdAt: new Date().toISOString()
    });
    fee.settledAmount = isMonthly ? feeAmount : capturedAmount;
    fee.pendingAmount = pendingAmount;

    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);

    if (capturedAmount > 0) {
      this.persistTransaction(order.id, {
        type: "pre_auth_capture",
        channel: "online",
        amount: capturedAmount,
        operator: input.operator,
        relatedFeeIds: [fee.id],
        note: input.note
      });
    }

    return {
      feeId: fee.id,
      feeAmount,
      capturedAmount,
      pendingAmount
    };
  }

  private addTerminalRefundFee(
    order: StoreRentalOrderSummary,
    amount: number,
    reason: string,
    operator: string
  ) {
    const refundAmount = Math.max(0, Math.round(amount));
    if (refundAmount <= 0 || order.billingMode === BillingMode.Monthly) {
      return undefined;
    }

    const fee = this.feeLedgerItem({
      id: `fee_close_refund_${randomUUID()}`,
      code: "close_refund",
      name: "关闭退款",
      stage: "rental",
      source: "system",
      direction: "refund",
      status: "settled",
      amount: refundAmount,
      description: `客户无责关闭订单，关闭原因：${reason}。`,
      snapshotRef: `close_refund:${order.orderNo}:${Date.now()}`,
      createdAt: new Date().toISOString()
    });
    const fees = this.manualFeeLedgerItems.get(order.id) ?? [];
    fees.unshift(fee);
    this.manualFeeLedgerItems.set(order.id, fees);
    this.persistTransaction(order.id, {
      type: "refund",
      channel: "offline",
      amount: refundAmount,
      operator,
      relatedFeeIds: [fee.id],
      note: "关闭订单全额退款。"
    });

    return fee.id;
  }

  private releaseRemainingPreAuth(
    order: StoreRentalOrderSummary,
    relatedFeeId: string | undefined,
    capturedAmount: number,
    note: string,
    operator: string
  ) {
    if (order.billingMode === BillingMode.Monthly) {
      return 0;
    }

    const releaseAmount = Math.max(
      0,
      this.terminalPreAuthAmount(order) - Math.max(0, Math.round(capturedAmount))
    );
    if (releaseAmount > 0) {
      this.persistTransaction(order.id, {
        type: "pre_auth_release",
        channel: "online",
        amount: releaseAmount,
        operator,
        relatedFeeIds: relatedFeeId ? [relatedFeeId] : [],
        note
      });
    }

    return releaseAmount;
  }

  private terminalPreAuthAmount(order: StoreRentalOrderSummary) {
    if (
      order.billingMode !== BillingMode.CustomerPay ||
      order.paymentStatus === PaymentStatus.Unpaid
    ) {
      return 0;
    }

    return Math.max(0, Math.round(this.ruleConfig.payment.fixedPreAuthAmount));
  }

  private customerReceivedBeforeTerminal(order: StoreRentalOrderSummary) {
    return this.buildTransactionRecords(order)
      .filter(
        (item) =>
          item.status === "success" &&
          (item.type === "payment" || item.type === "pre_auth_capture")
      )
      .reduce((total, item) => total + item.amount, 0);
  }

  private applyTerminalSettlement(
    order: StoreRentalOrderSummary,
    receivableAmount: number,
    settledAmount: number
  ) {
    this.settlementSummaries.set(
      order.id,
      this.normalizeSettlementSummary(order, {
        rentalAmount: 0,
        serviceFeeAmount: 0,
        overtimeFeeAmount: 0,
        damageFeeAmount: 0,
        cleaningFeeAmount: 0,
        discountAmount: 0,
        finalReceivableAmount: Math.max(0, Math.round(receivableAmount)),
        returnFeeTotal: 0,
        returnTransactionTotal: Math.max(0, Math.round(settledAmount)),
        balanceDue: 0,
        customerPayableAmount: 0,
        customerRefundAmount: 0,
        monthlyBillAmount:
          order.billingMode === BillingMode.Monthly
            ? Math.max(0, Math.round(receivableAmount))
            : 0,
        monthlyBillingPosted:
          order.billingMode === BillingMode.Monthly && receivableAmount > 0
      })
    );
  }

  private releaseOrderResources(
    order: StoreRentalOrderSummary,
    vehicleStatus: VehicleInstanceSummary["operationStatus"]
  ) {
    const plateNo = order.plateNo;
    if (plateNo && plateNo !== "待人工派车") {
      this.updateVehicleOperationStatus(plateNo, vehicleStatus);
    }
    delete order.plateNo;
    order.dispatchStatus = DispatchStatus.Pending;
    order.operationLockStatus = OperationLockStatus.Released;
    delete order.operationLockOperator;
    delete order.operationLockExpiresAt;
  }

  private terminalPaymentStatus(
    order: StoreRentalOrderSummary,
    feeAmount: number,
    pendingAmount: number,
    refundAmount: number,
    releaseAmount: number
  ) {
    if (order.billingMode === BillingMode.Monthly) {
      return feeAmount > 0 ? PaymentStatus.MonthlyBilling : PaymentStatus.Unpaid;
    }
    if (pendingAmount > 0) {
      return PaymentStatus.PaymentDue;
    }
    if (refundAmount > 0 || releaseAmount > 0) {
      return PaymentStatus.Refunded;
    }
    if (feeAmount > 0) {
      return PaymentStatus.Paid;
    }

    return PaymentStatus.Unpaid;
  }

  private buildFeeLedgerItems(order: StoreRentalOrderSummary): StoreRentalFeeLedgerItem[] {
    const settlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const baseStatus = this.baseFeeStatus(order);
    const returnFeeStatus = this.returnFeeStatus(order, settlement);
    const createdAt = order.pickupAt;
    const baseSnapshotRef = "pricingVersion:store-rental-price-v2026.05.01";
    const returnSnapshotRef = `returnSettlement:${order.orderNo}`;
    const items: StoreRentalFeeLedgerItem[] = [
      this.feeLedgerItem({
        id: `${order.id}_rental`,
        code: "RENTAL",
        name: "车辆租金",
        stage: "booking",
        source: "system",
        direction: "charge",
        status: baseStatus,
        amount: settlement.rentalAmount,
        description: "订单创建时按价格快照生成的基础租金。",
        snapshotRef: baseSnapshotRef,
        createdAt
      }),
      this.feeLedgerItem({
        id: `${order.id}_service`,
        code: "SERVICE",
        name: "增值服务/保障",
        stage: "booking",
        source: "system",
        direction: "charge",
        status: baseStatus,
        amount: settlement.serviceFeeAmount,
        description: "订单创建时选择的保障、配件或服务项目。",
        snapshotRef: baseSnapshotRef,
        createdAt
      })
    ];

    if (settlement.overtimeFeeAmount > 0) {
      items.push(
        this.feeLedgerItem({
          id: `${order.id}_overtime`,
          code: "OVERTIME",
          name: "超时费用",
          stage: "return_settlement",
          source: "system",
          direction: "charge",
          status: returnFeeStatus,
          amount: settlement.overtimeFeeAmount,
          description: "还车阶段按实际还车时间和规则快照计算。",
          snapshotRef: returnSnapshotRef,
          createdAt: new Date().toISOString()
        })
      );
    }

    if (settlement.damageFeeAmount > 0) {
      items.push(
        this.feeLedgerItem({
          id: `${order.id}_damage`,
          code: "DAMAGE",
          name: "损伤赔偿",
          stage: "return_settlement",
          source: "manual",
          direction: "charge",
          status: returnFeeStatus,
          amount: settlement.damageFeeAmount,
          description: "还车验车发现新增损伤后由门店录入。",
          snapshotRef: returnSnapshotRef,
          createdAt: new Date().toISOString()
        })
      );
    }

    if (settlement.cleaningFeeAmount > 0) {
      items.push(
        this.feeLedgerItem({
          id: `${order.id}_cleaning`,
          code: "CLEANING",
          name: "清洁/缺件费用",
          stage: "return_settlement",
          source: "manual",
          direction: "charge",
          status: returnFeeStatus,
          amount: settlement.cleaningFeeAmount,
          description: "还车验车发现清洁、缺件或交接问题后由门店录入。",
          snapshotRef: returnSnapshotRef,
          createdAt: new Date().toISOString()
        })
      );
    }

    if (settlement.discountAmount > 0) {
      items.push(
        this.feeLedgerItem({
          id: `${order.id}_waiver`,
          code: "WAIVER",
          name: "费用减免",
          stage: "return_settlement",
          source: "manual",
          direction: "waiver",
          status:
            order.mainStatus === OrderMainStatus.Completed ? "waived" : returnFeeStatus,
          amount: settlement.discountAmount,
          description: "具备权限的营运人员在还车结算中录入的减免。",
          snapshotRef: returnSnapshotRef,
          createdAt: new Date().toISOString()
        })
      );
    }

    return [...items, ...(this.manualFeeLedgerItems.get(order.id) ?? [])];
  }

  private buildTransactionRecords(
    order: StoreRentalOrderSummary
  ): StoreRentalTransactionRecord[] {
    const settlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const persisted = this.persistedTransactions.get(order.id) ?? [];
    const records: StoreRentalTransactionRecord[] = [];

    if (
      order.billingMode === BillingMode.CustomerPay &&
      order.paymentStatus !== PaymentStatus.Unpaid
    ) {
      records.push({
        id: `${order.id}_preauth`,
        type: "pre_auth_freeze",
        channel: "online",
        amount: this.ruleConfig.payment.fixedPreAuthAmount,
        status: "success",
        at: order.pickupAt,
        operator: "支付 mock",
        relatedFeeIds: [],
        note: "MVP 阶段模拟下单预授权冻结。"
      });
    }

    if (
      order.billingMode === BillingMode.CustomerPay &&
      [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.SettlementPending,
        OrderMainStatus.PaymentDue,
        OrderMainStatus.RefundPending,
        OrderMainStatus.Completed
      ].includes(order.mainStatus)
    ) {
      records.push({
        id: `${order.id}_pickup_payment`,
        type: "payment",
        channel: "offline",
        amount: order.totalAmount,
        status: "success",
        at: order.pickupAt,
        operator: "门店营运",
        relatedFeeIds: [`${order.id}_rental`, `${order.id}_service`],
        note: "MVP 阶段模拟取车尾款已处理。"
      });
    }

    if (order.mainStatus === OrderMainStatus.PaymentDue) {
      records.push({
        id: `${order.id}_return_payment_pending`,
        type: "payment",
        channel: "offline",
        amount: settlement.customerPayableAmount,
        status: "pending",
        at: new Date().toISOString(),
        operator: "门店营运",
        relatedFeeIds: this.returnFeeIds(order),
        note: "还车结算后客户仍需补缴。"
      });
    }

    if (order.mainStatus === OrderMainStatus.RefundPending) {
      records.push({
        id: `${order.id}_return_refund_pending`,
        type: "refund",
        channel: "offline",
        amount: settlement.customerRefundAmount,
        status: "pending",
        at: new Date().toISOString(),
        operator: "门店营运",
        relatedFeeIds: this.returnFeeIds(order),
        note: "还车结算后仍需退款，退款需登记渠道和凭证。"
      });
    }

    if (
      order.mainStatus === OrderMainStatus.Completed &&
      settlement.returnFeeTotal > 0 &&
      !this.hasPersistedReturnTransaction(order, "payment")
    ) {
      records.push({
        id: `${order.id}_return_payment`,
        type: "payment",
        channel: "offline",
        amount: settlement.returnFeeTotal,
        status: "success",
        at: new Date().toISOString(),
        operator: "门店营运",
        relatedFeeIds: this.returnFeeIds(order),
        note: "还车补缴已处理。"
      });
    }

    if (
      order.mainStatus === OrderMainStatus.Completed &&
      settlement.returnFeeTotal < 0 &&
      !this.hasPersistedReturnTransaction(order, "refund")
    ) {
      records.push({
        id: `${order.id}_return_refund`,
        type: "refund",
        channel: "offline",
        amount: Math.abs(settlement.returnFeeTotal),
        status: "success",
        at: new Date().toISOString(),
        operator: "门店营运",
        relatedFeeIds: this.returnFeeIds(order),
        note: "还车退款已处理。"
      });
    }

    const monthlyBillAmount = this.monthlyBillableAmount(order);
    if (order.billingMode === BillingMode.Monthly && monthlyBillAmount > 0) {
      records.push({
        id: `${order.id}_monthly_bill`,
        type: "monthly_bill",
        channel: "internal",
        amount: monthlyBillAmount,
        status:
          [
            OrderMainStatus.Completed,
            OrderMainStatus.Cancelled,
            OrderMainStatus.NoShow,
            OrderMainStatus.Rejected
          ].includes(order.mainStatus)
            ? "success"
            : "pending",
        at: new Date().toISOString(),
        operator: "企业月结 mock",
        relatedFeeIds: this.buildFeeLedgerItems(order)
          .filter((item) => item.status === "monthly_billing")
          .map((item) => item.id),
        note: "企业月结订单不产生客户支付、预授权或退款。"
      });
    }

    return [...records, ...persisted];
  }

  private buildFinancialOverview(order: StoreRentalOrderSummary) {
    const settlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const feeLedgerItems = this.buildFeeLedgerItems(order);
    const transactionRecords = this.buildTransactionRecords(order);
    const totalReceivableAmount = feeLedgerItems.reduce((total, item) => {
      if (item.status === "voided") {
        return total;
      }
      if (item.direction === "charge") {
        return total + item.amount;
      }
      return total - item.amount;
    }, 0);
    const customerReceivedAmount = transactionRecords
      .filter(
        (item) =>
          item.status === "success" &&
          (item.type === "payment" || item.type === "pre_auth_capture")
      )
      .reduce((total, item) => total + item.amount, 0);
    const monthlyBillingAmount = transactionRecords
      .filter((item) => item.type === "monthly_bill" && item.status !== "failed")
      .reduce((total, item) => total + item.amount, 0);

    return {
      totalReceivableAmount,
      customerReceivedAmount,
      monthlyBillingAmount,
      pendingAmount: feeLedgerItems
        .filter((item) => item.status === "pending" && item.direction === "charge")
        .reduce((total, item) => total + item.pendingAmount, 0),
      refundAmount:
        settlement.customerRefundAmount +
        feeLedgerItems
          .filter((item) => item.status === "pending" && item.direction === "refund")
          .reduce((total, item) => total + item.pendingAmount, 0),
      postChargeAmount: feeLedgerItems
        .filter((item) => item.stage === "post_charge" && item.status === "pending")
        .reduce((total, item) => total + item.pendingAmount, 0)
    };
  }

  private feeLedgerItem(
    input: Omit<StoreRentalFeeLedgerItem, "settledAmount" | "pendingAmount">
  ): StoreRentalFeeLedgerItem {
    const isSettled = ["settled", "waived", "monthly_billing"].includes(input.status);

    return {
      ...input,
      settledAmount: isSettled ? input.amount : 0,
      pendingAmount: input.status === "pending" ? input.amount : 0
    };
  }

  private baseFeeStatus(
    order: StoreRentalOrderSummary
  ): StoreRentalFeeLedgerItem["status"] {
    if (
      [
        OrderMainStatus.Cancelled,
        OrderMainStatus.NoShow,
        OrderMainStatus.Rejected,
        OrderMainStatus.Closed
      ].includes(order.mainStatus)
    ) {
      return "voided";
    }
    if (order.billingMode === BillingMode.Monthly) {
      return "monthly_billing";
    }
    return order.paymentStatus === PaymentStatus.Unpaid ? "pending" : "settled";
  }

  private returnFeeStatus(
    order: StoreRentalOrderSummary,
    settlement: StoreRentalSettlementSummary
  ): StoreRentalFeeLedgerItem["status"] {
    if (order.billingMode === BillingMode.Monthly) {
      return "monthly_billing";
    }
    if (order.mainStatus === OrderMainStatus.Completed || settlement.balanceDue === 0) {
      return "settled";
    }
    return "pending";
  }

  private returnFeeIds(order: StoreRentalOrderSummary) {
    return [
      `${order.id}_overtime`,
      `${order.id}_damage`,
      `${order.id}_cleaning`,
      `${order.id}_waiver`,
      ...(this.manualFeeLedgerItems.get(order.id) ?? [])
        .filter(
          (item) =>
            ["rental", "return_settlement", "post_charge"].includes(item.stage) &&
            item.direction === "charge"
        )
        .map((item) => item.id)
    ];
  }

  private hasPersistedReturnTransaction(
    order: StoreRentalOrderSummary,
    type: StoreRentalTransactionRecord["type"]
  ) {
    const returnFeeIds = new Set(this.returnFeeIds(order));
    return (this.persistedTransactions.get(order.id) ?? []).some(
      (record) =>
        record.type === type &&
        record.relatedFeeIds.some((feeId) => returnFeeIds.has(feeId))
    );
  }

  private findFeeLedgerItem(order: StoreRentalOrderSummary, feeId: string) {
    const fee = this.buildFeeLedgerItems(order).find((item) => item.id === feeId);
    if (!fee) {
      throw new NotFoundException(`Fee ${feeId} was not found in order ${order.orderNo}`);
    }

    return fee;
  }

  private updateManualFeeStatus(
    orderId: string,
    feeId: string,
    status: StoreRentalFeeLedgerItem["status"]
  ) {
    const fees = this.manualFeeLedgerItems.get(orderId);
    if (!fees) {
      return;
    }
    const fee = fees.find((item) => item.id === feeId);
    if (fee) {
      fee.status = status;
      fee.settledAmount = ["settled", "waived", "monthly_billing"].includes(status)
        ? fee.amount
        : 0;
      fee.pendingAmount = status === "pending" ? fee.amount : 0;
    }
  }

  private persistTransaction(
    orderId: string,
    input: Omit<StoreRentalTransactionRecord, "id" | "status" | "at">
  ) {
    const record: StoreRentalTransactionRecord = {
      ...input,
      id: `txn_${randomUUID()}`,
      status: "success",
      at: new Date().toISOString()
    };
    const records = this.persistedTransactions.get(orderId) ?? [];
    records.unshift(record);
    this.persistedTransactions.set(orderId, records);

    return record;
  }

  private applyTransactionToOrder(
    order: StoreRentalOrderSummary,
    record: StoreRentalTransactionRecord
  ) {
    if (record.type === "payment" && order.mainStatus === OrderMainStatus.PaymentDue) {
      const settlement =
        this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
      this.settlementSummaries.set(
        order.id,
        this.mergeSettlementSummary(order, {
          returnTransactionTotal: settlement.returnFeeTotal
        })
      );
      order.mainStatus = OrderMainStatus.Completed;
      order.paymentStatus = PaymentStatus.Paid;
      this.updateVehicleOperationStatus(
        order.plateNo,
        this.completedVehicleStatus(settlement)
      );
    }

    if (record.type === "refund" && order.mainStatus === OrderMainStatus.RefundPending) {
      const settlement =
        this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
      this.settlementSummaries.set(
        order.id,
        this.mergeSettlementSummary(order, {
          returnTransactionTotal: settlement.returnFeeTotal
        })
      );
      order.mainStatus = OrderMainStatus.Completed;
      order.paymentStatus = PaymentStatus.Refunded;
      this.updateVehicleOperationStatus(
        order.plateNo,
        this.completedVehicleStatus(settlement)
      );
    }
  }

  private appendOrderTimeline(
    order: StoreRentalOrderSummary,
    actor: string,
    action: string
  ) {
    const timeline = this.orderTimelines.get(order.id) ?? this.defaultTimeline(order);
    timeline.push({
      at: new Date().toISOString(),
      actor,
      action
    });
    this.orderTimelines.set(order.id, timeline);
  }

  private requiredDate(value: unknown, message: string) {
    const raw = this.optionalString(value);
    if (!raw) {
      throw new BadRequestException(message);
    }
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) {
      throw new BadRequestException("时间格式无效。");
    }

    return date;
  }

  private findExtensionConflict(
    order: StoreRentalOrderSummary,
    oldReturnAt: Date,
    newReturnAt: Date
  ) {
    const bufferMinutes = this.ruleConfig.pickupReturn.turnaroundMinutes || 60;
    const conflictEnd = new Date(newReturnAt.getTime() + bufferMinutes * 60_000);

    return this.orders.find(
      (item) =>
        item.id !== order.id &&
        item.plateNo === order.plateNo &&
        this.orderOccupiesInventory(item) &&
        this.periodOverlaps(
          oldReturnAt,
          conflictEnd,
          new Date(item.pickupAt),
          new Date(item.returnAt)
        )
    );
  }

  private calculateExtensionRent(
    order: StoreRentalOrderSummary,
    oldReturnAt: Date,
    newReturnAt: Date
  ) {
    const pickupAt = new Date(order.pickupAt);
    const originalHours = Math.max(
      1,
      Math.ceil((oldReturnAt.getTime() - pickupAt.getTime()) / 3_600_000)
    );
    const extensionHours = Math.max(
      1,
      Math.ceil((newReturnAt.getTime() - oldReturnAt.getTime()) / 3_600_000)
    );
    const originalBillableDays = Math.max(1, Math.ceil(originalHours / 24));
    const extensionBillableDays = Math.max(1, Math.ceil(extensionHours / 24));
    const settlement =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const dailyRentalAmount = settlement.rentalAmount / originalBillableDays;

    return Math.round(dailyRentalAmount * extensionBillableDays);
  }

  private extensionSettlementMode(
    value: unknown,
    isMonthly: boolean
  ): ExtensionSettlementMode {
    if (isMonthly) {
      return "monthly";
    }
    if (value === "immediate" || value === "return_settlement") {
      return value;
    }
    throw new BadRequestException("延长用车结算方式无效。");
  }

  private extensionImmediateReasons(
    order: StoreRentalOrderSummary,
    previousStatus: OrderMainStatus,
    extensionHours: number,
    extensionAmount: number
  ) {
    const reasons: string[] = [];
    if (previousStatus === OrderMainStatus.Overdue) {
      reasons.push("逾期补办续租");
    }
    if (extensionHours > 24) {
      reasons.push("延长时长超过24小时");
    }
    if (extensionAmount > 1000) {
      reasons.push("续租金额超过1000元");
    }
    const riskFlags = ["blacklist", "黑名单", "license_issue", "证件异常", "高风险", "人工限制"];
    if (order.riskFlags.some((flag) => riskFlags.includes(flag))) {
      reasons.push("客户存在风险标记");
    }

    return reasons;
  }

  private extensionSettlementLabel(mode: ExtensionSettlementMode) {
    const labels: Record<ExtensionSettlementMode, string> = {
      immediate: "立即收款",
      return_settlement: "还车时结算",
      monthly: "企业月结"
    };

    return labels[mode];
  }

  private positiveAmount(value: number, message: string) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException(message);
    }

    return Math.round(amount);
  }

  private transactionLabel(type: StoreRentalTransactionRecord["type"]) {
    const labels: Record<StoreRentalTransactionRecord["type"], string> = {
      pre_auth_freeze: "预授权冻结",
      pre_auth_release: "预授权释放",
      pre_auth_capture: "预授权扣款",
      payment: "订单收款",
      refund: "订单退款",
      waiver: "费用减免",
      monthly_bill: "企业月结"
    };

    return labels[type];
  }

  private canPostMonthlyBill(status: OrderMainStatus) {
    return [
      OrderMainStatus.Completed,
      OrderMainStatus.Cancelled,
      OrderMainStatus.NoShow,
      OrderMainStatus.Rejected
    ].includes(status);
  }

  private defaultSettlementSummary(
    order: StoreRentalOrderSummary
  ): StoreRentalSettlementSummary {
    const rentalAmount = Math.round(order.totalAmount * 0.78);
    const serviceFeeAmount = Math.max(0, order.totalAmount - rentalAmount);

    return this.normalizeSettlementSummary(order, {
      rentalAmount,
      serviceFeeAmount,
      overtimeFeeAmount: 0,
      damageFeeAmount: 0,
      cleaningFeeAmount: 0,
      discountAmount: 0,
      finalReceivableAmount: order.totalAmount,
      returnFeeTotal: 0,
      returnTransactionTotal: 0,
      balanceDue: 0,
      customerPayableAmount: 0,
      customerRefundAmount: 0,
      monthlyBillAmount: order.billingMode === BillingMode.Monthly ? order.totalAmount : 0,
      monthlyBillingPosted: order.billingMode === BillingMode.Monthly
    });
  }

  private mergeSettlementSummary(
    order: StoreRentalOrderSummary,
    patch: Partial<StoreRentalSettlementSummary>
  ): StoreRentalSettlementSummary {
    const base =
      this.settlementSummaries.get(order.id) ?? this.defaultSettlementSummary(order);
    const next = {
      ...base,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      )
    } as StoreRentalSettlementSummary;
    next.finalReceivableAmount =
      patch.finalReceivableAmount ??
      next.rentalAmount +
        next.serviceFeeAmount +
        next.overtimeFeeAmount +
        next.damageFeeAmount +
        next.cleaningFeeAmount -
        next.discountAmount;

    return this.normalizeSettlementSummary(order, next);
  }

  private normalizeSettlementSummary(
    order: StoreRentalOrderSummary,
    summary: StoreRentalSettlementSummary
  ): StoreRentalSettlementSummary {
    const baseReceivableAmount = summary.rentalAmount + summary.serviceFeeAmount;
    const returnFeeTotal = Math.round(
      summary.finalReceivableAmount - baseReceivableAmount
    );
    const balanceDue =
      order.billingMode === BillingMode.Monthly
        ? 0
        : returnFeeTotal - summary.returnTransactionTotal;

    return {
      ...summary,
      returnFeeTotal,
      balanceDue,
      customerPayableAmount: Math.max(0, balanceDue),
      customerRefundAmount: Math.max(0, -balanceDue),
      monthlyBillAmount:
        order.billingMode === BillingMode.Monthly
          ? Math.max(0, summary.finalReceivableAmount)
          : 0,
      monthlyBillingPosted:
        order.billingMode === BillingMode.Monthly || summary.monthlyBillingPosted
    };
  }

  private appendInspectionRecord(
    orderId: string,
    input: Omit<StoreRentalInspectionRecord, "id" | "at">
  ) {
    const record: StoreRentalInspectionRecord = {
      ...input,
      id: `inspection_${randomUUID()}`,
      at: new Date().toISOString()
    };
    const records = this.inspectionRecords.get(orderId) ?? [];
    records.push(record);
    this.inspectionRecords.set(orderId, records);
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  private uniqueStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(
      new Set(
        value
          .map((item) => this.optionalString(item))
          .filter((item): item is string => Boolean(item))
      )
    );
  }

  private appendFinanceDocumentAuditTrail(
    value: unknown,
    item: NonNullable<FinanceDocumentRow["auditTrail"]>[number]
  ) {
    const current = Array.isArray(value)
      ? value.filter((record): record is NonNullable<FinanceDocumentRow["auditTrail"]>[number] => {
          if (!record || typeof record !== "object") {
            return false;
          }
          const candidate = record as Record<string, unknown>;
          return Boolean(this.optionalString(candidate.at));
        })
      : [];
    return [...current, item].slice(-20);
  }

  private optionalNumber(value: unknown) {
    const numberValue =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : undefined;
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  private cleanlinessValue(value: unknown): StoreRentalInspectionRecord["cleanliness"] {
    return value === "clean" || value === "dirty" ? value : "normal";
  }

  private actionMemo(body: Record<string, unknown>) {
    const memo = this.optionalString(body.memo);
    return memo ? `，备注：${memo}` : "";
  }

  private monthlyBillPeriod(order: StoreRentalOrderSummary) {
    const sourceAt = order.returnAt || order.pickupAt;
    return new Date(sourceAt).toISOString().slice(0, 7);
  }

  private monthlyBillableAmount(order: StoreRentalOrderSummary) {
    if (order.billingMode !== BillingMode.Monthly) {
      return 0;
    }

    return this.buildFeeLedgerItems(order)
      .filter((item) => item.status === "monthly_billing")
      .reduce(
        (total, item) =>
          item.direction === "charge" ? total + item.amount : total - item.amount,
        0
      );
  }

  private buildCorporateMonthlyBill(
    corporate: CorporateDetail,
    period: string,
    orders: StoreRentalOrderSummary[]
  ): CorporateMonthlyBillSummary {
    const billId = `bill_${corporate.id}_${period.replace("-", "")}`;
    const lineItems = orders
      .map((order) => {
        const feeLedgerItems = this.buildFeeLedgerItems(order).filter(
          (item) => item.status === "monthly_billing"
        );
        const amount = feeLedgerItems.reduce(
          (total, item) =>
            item.direction === "charge" ? total + item.amount : total - item.amount,
          0
        );

        return {
          id: `bill_line_${order.id}`,
          orderId: order.id,
          orderNo: order.orderNo,
          occurredAt: order.returnAt,
          customerName: order.customerName,
          vehicleGroupName: order.vehicleGroupName,
          pickupStoreName: order.pickupStoreName,
          returnStoreName: order.returnStoreName,
          amount,
          feeCodes: feeLedgerItems.map((item) => item.code),
          remark:
            [
              OrderMainStatus.Completed,
              OrderMainStatus.Cancelled,
              OrderMainStatus.NoShow,
              OrderMainStatus.Rejected
            ].includes(order.mainStatus)
              ? "已完成入账"
              : "履约中预计入账"
        };
      })
      .filter((item) => item.amount > 0);
    const totalAmount = lineItems.reduce((total, item) => total + item.amount, 0);
    const paidAmount = Math.min(
      totalAmount,
      this.corporateMonthlyBillPayments.get(billId)?.paidAmount ?? 0
    );
    const balanceAmount = Math.max(0, totalAmount - paidAmount);
    const dueDate = new Date(`${period}-01T00:00:00.000Z`);
    dueDate.setUTCDate(Math.min(28, corporate.billingCycleDay || 25));
    dueDate.setUTCDate(dueDate.getUTCDate() + Math.max(0, corporate.accountPeriodDays || 0));

    return {
      id: billId,
      billNo: `MB${period.replace("-", "")}${corporate.id.slice(-3).toUpperCase()}`,
      corporateId: corporate.id,
      corporateShortName: corporate.shortName,
      period,
      status:
        paidAmount <= 0
          ? "posted"
          : balanceAmount > 0
            ? "partially_paid"
            : "paid",
      generatedAt: new Date(`${period}-01T00:00:00.000Z`).toISOString(),
      dueDate: dueDate.toISOString(),
      orderCount: lineItems.length,
      totalAmount,
      paidAmount,
      balanceAmount,
      lineItems
    };
  }

  private maskPhone(phone: string) {
    if (phone.length <= 4) {
      return phone;
    }
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }

  private toMemberSummary(member: MemberDetail): MemberSummary {
    return {
      id: member.id,
      name: member.name,
      phoneMasked: member.phoneMasked,
      source: member.source,
      levelName: member.levelName,
      pointsBalance: member.pointsBalance,
      status: member.status,
      reviewStatus: member.reviewStatus,
      registerAt: member.registerAt,
      totalOrders: member.totalOrders,
      totalSpendAmount: member.totalSpendAmount,
      tags: member.tags,
      identityVerified: member.identityVerified,
      driverLicenseVerified: member.driverLicenseVerified
    };
  }

  private toCorporateSummary(corporate: CorporateDetail): CorporateSummary {
    return {
      id: corporate.id,
      shortName: corporate.shortName,
      fullName: corporate.fullName,
      status: corporate.status,
      creditLimitAmount: corporate.creditLimitAmount,
      accountPeriodDays: corporate.accountPeriodDays,
      settlementMode: corporate.settlementMode,
      contactName: corporate.contactName,
      contactPhone: corporate.contactPhone,
      activeOrderCount: corporate.activeOrderCount,
      unpaidAmount: corporate.unpaidAmount,
      contractStatus: corporate.contractStatus
    };
  }

  private actionLabel(action: string) {
    const labels: Record<string, string> = {
      "payment-success": "支付/预授权成功",
      "start-pickup": "开始取车",
      "pickup-inspection": "确认发车",
      "extend-rental": "延长用车",
      "redirect-order": "订单改派",
      "change-return-store": "改还车门市",
      "change-return-station": "改还车据点",
      "return-inspection": "还车验车完成",
      "confirm-settlement": "结算确认",
      "register-accident": "事故登记",
      "release-operation-lock": "释放操作锁",
      "mark-no-show": "标记爽约",
      "reject-order": "拒绝履约",
      "close-order": "关闭订单",
      cancel: "取消订单"
    };

    return labels[action] ?? action;
  }

  private ensureActionAllowed(order: StoreRentalOrderSummary, action: string) {
    const allowedStatusMap: Record<string, OrderMainStatus[]> = {
      "payment-success": [OrderMainStatus.PendingPayment],
      "start-pickup": [OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue],
      "pickup-inspection": [OrderMainStatus.Inspecting],
      "extend-rental": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue
      ],
      "redirect-order": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "change-return-store": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "change-return-station": [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "return-inspection": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      "confirm-settlement": [
        OrderMainStatus.SettlementPending,
        OrderMainStatus.PaymentDue,
        OrderMainStatus.RefundPending
      ],
      "register-accident": [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing,
        OrderMainStatus.SettlementPending,
        OrderMainStatus.PaymentDue,
        OrderMainStatus.RefundPending,
        OrderMainStatus.Completed
      ],
      "release-operation-lock": [OrderMainStatus.Inspecting],
      "mark-no-show": [OrderMainStatus.PickupOverdue],
      "reject-order": [OrderMainStatus.Inspecting],
      "close-order": [
        OrderMainStatus.PendingPayment,
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting,
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ],
      cancel: [
        OrderMainStatus.PendingPayment,
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue
      ]
    };
    const allowedStatuses = allowedStatusMap[action] ?? [];

    if (!allowedStatuses.includes(order.mainStatus)) {
      throw new BadRequestException(
        `订单 ${order.orderNo} 当前状态 ${order.mainStatus} 不允许执行 ${this.actionLabel(action)}`
      );
    }
  }

  private validatePickupCompletion(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>
  ) {
    const isMonthly = order.billingMode === BillingMode.Monthly;
    const plateNo = this.optionalString(body.plateNo) || order.plateNo;
    if (!plateNo || plateNo === "待人工派车") {
      throw new BadRequestException("取车确认前必须锁定并录入实际车牌。");
    }
    if (body.identityMatched !== true) {
      throw new BadRequestException("请先确认人证合一。");
    }
    if (this.optionalString(body.licenseValidUntil)) {
      const licenseValidUntil = new Date(String(body.licenseValidUntil));
      if (
        Number.isFinite(licenseValidUntil.getTime()) &&
        licenseValidUntil.getTime() < Date.now()
      ) {
        throw new BadRequestException("驾照已过有效期，不能确认发车。");
      }
    }
    if (
      this.optionalString(body.marketingVerificationResult) === "failed" &&
      !this.optionalString(body.changedMarketingPlan)
    ) {
      throw new BadRequestException("行销方案资格核验不通过时，必须更换方案或改为不使用优惠。");
    }
    if (!isMonthly) {
      const preAuthMode = this.optionalString(body.preAuthMode) || "performance_guarantee";
      const preAuthStatus = this.optionalString(body.preAuthStatus);
      if (preAuthMode === "rent_offset" && preAuthStatus !== "captured") {
        throw new BadRequestException("预授权转租金模式必须先完成预授权扣款。");
      }
      if (preAuthMode !== "rent_offset" && !["frozen", "released"].includes(preAuthStatus ?? "")) {
        throw new BadRequestException("履约担保模式必须确认预授权押金有效。");
      }
      const pickupBalanceDue = this.optionalNumber(body.pickupBalanceDue) ?? 0;
      if (pickupBalanceDue > 0 && body.balancePaid !== true) {
        throw new BadRequestException("请结清取车应收尾款后再确认发车。");
      }
    } else if (body.monthlyBillingConfirmed !== true) {
      throw new BadRequestException("企业月结订单必须确认企业月结结算方式。");
    }
    if (body.contractSigned !== true) {
      throw new BadRequestException("请先完成租赁合约签署。");
    }
    if (this.optionalNumber(body.mileage) === undefined) {
      throw new BadRequestException("请填写发车里程。");
    }
    if (
      this.optionalNumber(body.fuelLevelPercent) === undefined &&
      this.optionalNumber(body.batteryLevelPercent) === undefined
    ) {
      throw new BadRequestException("请填写发车油量或电量。");
    }
    if ((this.optionalNumber(body.photoCount) ?? 0) < 9) {
      throw new BadRequestException("请补齐发车外观和内饰标准照片。");
    }
    if (body.customerSigned !== true) {
      throw new BadRequestException("请完成客户取车签字确认。");
    }
  }

  private validateReturnInspection(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>
  ) {
    const returnMileage = this.optionalNumber(body.returnMileage);
    if (returnMileage === undefined) {
      throw new BadRequestException("请填写还车里程。");
    }
    const pickupMileage =
      this.optionalNumber(body.pickupMileage) ??
      this.latestInspectionRecord(order, "pickup")?.mileage;
    if (pickupMileage !== undefined && returnMileage < pickupMileage) {
      throw new BadRequestException("还车里程不能小于取车里程。");
    }
    if (
      this.optionalNumber(body.fuelLevelPercent) === undefined &&
      this.optionalNumber(body.batteryLevelPercent) === undefined
    ) {
      throw new BadRequestException("请填写还车油量或电量。");
    }
    if ((this.optionalNumber(body.photoCount) ?? 0) < 9) {
      throw new BadRequestException("请补齐还车外观和内饰标准照片。");
    }
    if (body.customerSigned !== true) {
      throw new BadRequestException("请完成客户还车签字确认。");
    }
  }

  private latestInspectionRecord(
    order: StoreRentalOrderSummary,
    stage: StoreRentalInspectionRecord["stage"]
  ) {
    const persisted =
      "inspectionRecords" in order
        ? (order as StoreRentalOrderDetail).inspectionRecords
        : this.inspectionRecords.get(order.id) ?? [];
    return [...persisted].reverse().find((record) => record.stage === stage);
  }

  private releaseOperationLock(
    order: StoreRentalOrderSummary,
    body: Record<string, unknown>
  ): OrderActionEffect {
    const nextStatus = this.pickupStatusAfterLockRelease(order);
    const operator = String(body.operator ?? "营运端");
    order.mainStatus = nextStatus;
    order.operationLockStatus = OperationLockStatus.Released;
    delete order.operationLockOperator;
    delete order.operationLockExpiresAt;
    order.riskFlags = this.uniqueFlags(
      order.riskFlags.filter(
        (flag) => !["取车中", "操作锁有效", "取车中断"].includes(flag)
      ),
      nextStatus === OrderMainStatus.NoShow
        ? ["操作锁已释放", "已爽约"]
        : ["操作锁已释放"]
    );
    if (nextStatus === OrderMainStatus.NoShow) {
      this.releaseOrderResources(order, "idle");
    }

    return {
      timelineAction: `释放取车操作锁：订单重新判定为 ${nextStatus}，操作人 ${operator}${this.actionMemo(body)}`,
      message:
        nextStatus === OrderMainStatus.NoShow
          ? "操作锁已释放，取车草稿已作废，订单已按保留规则判定为爽约。"
          : "操作锁已释放，取车草稿已作废，订单已按当前时间重新判定状态。"
    };
  }

  private pickupStatusAfterLockRelease(order: StoreRentalOrderSummary) {
    const pickupAt = new Date(order.pickupAt);
    if (!Number.isFinite(pickupAt.getTime()) || Date.now() <= pickupAt.getTime()) {
      return OrderMainStatus.Reserved;
    }
    const holdUntil = new Date(
      pickupAt.getTime() + this.ruleConfig.noShow.vehicleHoldHours * 3_600_000
    );
    if (
      this.ruleConfig.noShow.autoReleaseEnabled &&
      Number.isFinite(holdUntil.getTime()) &&
      Date.now() > holdUntil.getTime()
    ) {
      return OrderMainStatus.NoShow;
    }

    return OrderMainStatus.PickupOverdue;
  }

  private completedVehicleStatus(
    settlement: StoreRentalSettlementSummary
  ): VehicleInstanceSummary["operationStatus"] {
    return settlement.damageFeeAmount > 0 || settlement.cleaningFeeAmount > 0
      ? "controlled"
      : "idle";
  }

  private updateVehicleOperationStatus(
    plateNo: string | undefined,
    status: VehicleInstanceSummary["operationStatus"]
  ) {
    if (!plateNo) {
      return;
    }
    const vehicle = this.vehicles.find((item) => item.licensePlate === plateNo);
    if (!vehicle || vehicle.operationStatus === "disabled") {
      return;
    }
    vehicle.operationStatus = status;
  }

  private findAssignablePlate(vehicleGroupName: string) {
    return (
      this.vehicles.find(
        (vehicle) =>
          vehicle.enabled &&
          vehicle.operationStatus === "idle" &&
          vehicle.serviceTypes.includes("STORE_STANDARD") &&
          this.stationCanServeStoreRental(
            vehicle.currentStationName,
            "STORE_STANDARD"
          ) &&
          vehicleGroupName.includes(vehicle.vehicleGroupName.split(" / ")[0])
      )?.licensePlate ??
      this.vehicles.find(
        (vehicle) =>
          vehicle.enabled &&
          vehicle.operationStatus === "idle" &&
          vehicle.serviceTypes.includes("STORE_STANDARD") &&
          this.stationCanServeStoreRental(
            vehicle.currentStationName,
            "STORE_STANDARD"
          )
      )
        ?.licensePlate ??
      "待人工派车"
    );
  }

  private vehicleMatchesGroup(
    vehicle: VehicleInstanceSummary,
    vehicleGroupCode: string
  ) {
    const groupName = this.getVehicleGroupNameByCode(vehicleGroupCode);
    const primaryName = groupName.split(" / ")[0];

    return (
      vehicle.vehicleGroupName === groupName ||
      vehicle.vehicleGroupName.includes(primaryName) ||
      groupName.includes(vehicle.vehicleGroupName.split(" / ")[0])
    );
  }

  private orderMatchesGroup(
    order: StoreRentalOrderSummary,
    vehicleGroupCode: string
  ) {
    const groupName = this.getVehicleGroupNameByCode(vehicleGroupCode);
    const primaryName = groupName.split(" / ")[0];

    return (
      order.vehicleGroupName === groupName ||
      order.vehicleGroupName.includes(primaryName) ||
      groupName.includes(order.vehicleGroupName.split(" / ")[0])
    );
  }

  private orderOccupiesInventory(order: StoreRentalOrderSummary) {
    return [
      OrderMainStatus.PendingPayment,
      OrderMainStatus.Reserved,
      OrderMainStatus.PickupOverdue,
      OrderMainStatus.Inspecting,
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue,
      OrderMainStatus.AccidentProcessing,
      OrderMainStatus.SettlementPending,
      OrderMainStatus.PaymentDue,
      OrderMainStatus.RefundPending
    ].includes(order.mainStatus);
  }

  private periodOverlaps(
    leftStart: Date,
    leftEnd: Date,
    rightStart: Date,
    rightEnd: Date
  ) {
    return leftStart < rightEnd && rightStart < leftEnd;
  }

  private uniqueFlags(currentFlags: string[], nextFlags: string[]) {
    return [...new Set([...currentFlags, ...nextFlags])];
  }

  private findOrder(id: string) {
    const order = this.orders.find((item) => item.id === id);
    if (!order) {
      throw new NotFoundException(`Store rental order ${id} was not found`);
    }

    return order;
  }

  private createMarketingPlanSeed(
    input: Omit<
      SaveMarketingPlanRequest,
      "id" | "status" | "supportedModes" | "storeCodes" | "operator" | "changeReason"
    > & { id: string; code: string }
  ): MarketingPlanDetail {
    const versionId = `${input.code}-V001`;
    const savedAt = "2026-05-01T00:00:00+08:00";
    const plan: MarketingPlanDetail = {
      id: input.id,
      code: input.code,
      name: input.name,
      displayName: input.displayName,
      status: ConfigStatus.Effective,
      version: versionId,
      versionId,
      customerScope: input.customerScope,
      supportedModes: [StoreRentalMode.Store],
      priority: input.priority,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      storeCodes: ["MONGKOK", "CENTRAL", "AIRPORT"],
      vehicleGroupCodes: input.vehicleGroupCodes,
      manualVerification: input.manualVerification,
      qualificationName: input.qualificationName,
      requiredDocText: input.requiredDocText,
      weekdayRate: input.weekdayRate,
      holidayRate: input.holidayRate,
      fixedDeductionAmount: input.fixedDeductionAmount,
      description: input.description,
      updatedAt: savedAt,
      updatedBy: "行销运营",
      ruleCount: input.rules.length,
      rules: input.rules,
      versionHistory: []
    };

    plan.versionHistory = [
      {
        versionId,
        versionNo: 1,
        status: ConfigStatus.Effective,
        savedBy: plan.updatedBy,
        savedAt,
        changeReason: "初始化行销方案",
        snapshot: this.toMarketingSummary(plan),
        rules: JSON.parse(JSON.stringify(input.rules)) as MarketingPlanDetail["rules"]
      }
    ];

    return plan;
  }

  private toMarketingSummary(plan: MarketingPlanDetail): MarketingPlanSummary {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      displayName: plan.displayName,
      status: plan.status,
      version: plan.version,
      versionId: plan.versionId,
      customerScope: plan.customerScope,
      supportedModes: plan.supportedModes,
      priority: plan.priority,
      effectiveFrom: plan.effectiveFrom,
      effectiveTo: plan.effectiveTo,
      storeCodes: plan.storeCodes,
      vehicleGroupCodes: plan.vehicleGroupCodes,
      manualVerification: plan.manualVerification,
      qualificationName: plan.qualificationName,
      requiredDocText: plan.requiredDocText,
      weekdayRate: plan.weekdayRate,
      holidayRate: plan.holidayRate,
      fixedDeductionAmount: plan.fixedDeductionAmount,
      description: plan.description,
      updatedAt: plan.updatedAt,
      updatedBy: plan.updatedBy,
      ruleCount: plan.rules.length
    };
  }

  private nextPriceVersionId() {
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    return `PRICE-STORE-${date}-${String(this.priceVersionHistory.length + 1).padStart(
      3,
      "0"
    )}`;
  }

  private resolveMarketing(
    input: PricingQuoteRequest,
    line: PricingPlanDetail["ruleLines"][number],
    pickupAt: Date,
    billableDays: number
  ): MarketingMatchResult {
    const customerType: StoreRentalCustomerType =
      input.customerType ||
      (input.billingMode === BillingMode.Monthly || input.corporateId
        ? "enterprise"
        : "personal");
    const explicitNone = input.marketingPlanId === "none";
    const candidates = explicitNone
      ? []
      : this.marketingPlans
          .filter((plan) =>
            this.isMarketingEligible(plan, {
              customerType,
              vehicleGroupCode: input.vehicleGroupCode,
              pickupStoreCode: input.pickupStoreCode,
              pickupAt,
              billableDays,
              membershipLevel: input.membershipLevel
            })
          )
          .map((plan) => ({
            plan,
            result: this.calculateMarketingDiscount(plan, line, pickupAt, billableDays)
          }))
          .filter((item) => item.result.discountAmount > 0);

    const requested = input.marketingPlanId
      ? candidates.find((item) => item.plan.id === input.marketingPlanId)
      : undefined;
    const selected =
      requested ??
      (!input.marketingPlanId
        ? [...candidates].sort((left, right) => {
            const priorityDelta = right.plan.priority - left.plan.priority;
            if (priorityDelta !== 0) {
              return priorityDelta;
            }
            return right.result.discountAmount - left.result.discountAmount;
          })[0]
        : undefined);
    const baseSegments = this.buildBillingSegments(line.baseDailyAmount, pickupAt, billableDays);

    if (!selected) {
      return {
        discountAmount: 0,
        segments: baseSegments,
        explanationLines: [
          {
            code: "MARKETING_NONE",
            title: "行销优惠方案",
            detail: explicitNone
              ? "本次报价选择不使用行销方案。"
              : "未命中可用行销方案，按标准价生成报价。",
            amount: 0
          }
        ],
        warnings: input.marketingPlanId && !explicitNone
          ? ["所选行销方案当前不可用，已按标准价试算。"]
          : []
      };
    }

    return {
      plan: selected.plan,
      ...selected.result,
      warnings: [
        ...(selected.plan.manualVerification
          ? [
              `行销方案 ${selected.plan.displayName} 需取车时现场核验 ${selected.plan.qualificationName || "资格证明"}。`
            ]
          : [])
      ]
    };
  }

  private async resolveMembershipQuoteBenefit(
    input: PricingQuoteRequest,
    rentalAmount: number,
    baseDepositAmount: number
  ): Promise<{
    plan?: MembershipPlanSummary;
    rentalDiscountAmount: number;
    depositDiscountAmount: number;
    explanationLines: PricingQuoteExplanationLine[];
    warnings: string[];
  }> {
    const empty = {
      rentalDiscountAmount: 0,
      depositDiscountAmount: 0,
      explanationLines: [],
      warnings: []
    };
    const customerType: StoreRentalCustomerType =
      input.customerType ||
      (input.billingMode === BillingMode.Monthly || input.corporateId
        ? "enterprise"
        : "personal");
    const membershipLevel = input.membershipLevel?.trim();
    if (!membershipLevel || customerType !== "personal" || input.billingMode === BillingMode.Monthly) {
      return empty;
    }

    const normalizedLevel = this.normalizeMembershipLevelForMatch(membershipLevel);
    const plans = await this.listMembershipPlans();
    const matchedPlan = plans.find((plan) => {
      if (plan.status !== "enabled") {
        return false;
      }
      return [plan.name, plan.code, plan.id]
        .map((value) => this.normalizeMembershipLevelForMatch(value))
        .includes(normalizedLevel);
    });
    if (!matchedPlan) {
      const disabledPlan = plans.find((plan) =>
        [plan.name, plan.code, plan.id]
          .map((value) => this.normalizeMembershipLevelForMatch(value))
          .includes(normalizedLevel)
      );
      return {
        ...empty,
        warnings: disabledPlan
          ? [`会员等级 ${membershipLevel} 当前已停用，本次报价不享受等级权益。`]
          : [`未找到启用的会员等级方案 ${membershipLevel}，本次报价不享受等级权益。`]
      };
    }

    const orderDiscountPercent = this.normalizePercent(matchedPlan.orderDiscountPercent);
    const depositDiscountPercent = this.normalizePercent(matchedPlan.depositDiscountPercent);
    const rentalDiscountAmount = Math.round((rentalAmount * orderDiscountPercent) / 100);
    const depositDiscountAmount = Math.round((baseDepositAmount * depositDiscountPercent) / 100);

    return {
      plan: {
        ...matchedPlan,
        orderDiscountPercent,
        depositDiscountPercent
      },
      rentalDiscountAmount,
      depositDiscountAmount,
      explanationLines: [
        {
          code: "MEMBERSHIP_BENEFIT",
          title: "会员等级权益",
          detail:
            orderDiscountPercent > 0 || depositDiscountPercent > 0
              ? `${matchedPlan.name}：租金 ${orderDiscountPercent}% 优惠、押金 ${depositDiscountPercent}% 优惠。`
              : `${matchedPlan.name} 当前未配置租金或押金折扣。`,
          amount: -rentalDiscountAmount
        }
      ],
      warnings: []
    };
  }

  private normalizeMembershipLevelForMatch(value: string) {
    return value.trim().toLowerCase();
  }

  private normalizePercent(value: number) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }
    return Math.max(0, Math.min(100, numericValue));
  }

  private isPercentInRange(value: number) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100;
  }

  private isMarketingEligible(
    plan: MarketingPlanDetail,
    input: {
      customerType: StoreRentalCustomerType;
      vehicleGroupCode: string;
      pickupStoreCode: string;
      pickupAt: Date;
      billableDays: number;
      membershipLevel?: string;
    }
  ) {
    if (plan.status !== ConfigStatus.Effective) {
      return false;
    }
    if (!plan.supportedModes.includes(StoreRentalMode.Store)) {
      return false;
    }
    if (plan.customerScope !== "all" && plan.customerScope !== input.customerType) {
      return false;
    }
    if (plan.storeCodes.length > 0 && !plan.storeCodes.includes(input.pickupStoreCode)) {
      return false;
    }
    if (
      plan.vehicleGroupCodes.length > 0 &&
      !plan.vehicleGroupCodes.includes(input.vehicleGroupCode)
    ) {
      return false;
    }
    const pickupTime = input.pickupAt.getTime();
    if (
      pickupTime < new Date(plan.effectiveFrom).getTime() ||
      pickupTime > new Date(plan.effectiveTo).getTime()
    ) {
      return false;
    }

    return plan.rules.some((rule) => {
      const matchesGroup =
        rule.vehicleGroupCodes.length === 0 ||
        rule.vehicleGroupCodes.includes(input.vehicleGroupCode);
      const matchesDuration =
        !rule.minBillableDays || input.billableDays >= rule.minBillableDays;
      const matchesMember =
        rule.membershipLevels.length === 0 ||
        (input.membershipLevel && rule.membershipLevels.includes(input.membershipLevel));

      return matchesGroup && matchesDuration && matchesMember;
    });
  }

  private calculateMarketingDiscount(
    plan: MarketingPlanDetail,
    line: PricingPlanDetail["ruleLines"][number],
    pickupAt: Date,
    billableDays: number
  ): Omit<MarketingMatchResult, "plan" | "warnings"> {
    const rule =
      plan.rules.find((item) =>
        item.vehicleGroupCodes.length === 0 ||
        item.vehicleGroupCodes.includes(line.vehicleGroupCode)
      ) ?? plan.rules[0];
    const segments = this.buildBillingSegments(line.baseDailyAmount, pickupAt, billableDays).map(
      (segment) => {
        const action =
          segment.dayType === "holiday" ? rule.holidayAction : rule.weekdayAction;
        const discountAmount = this.applyMarketingAction(
          line.baseDailyAmount,
          action.type,
          action.value
        );
        return {
          ...segment,
          marketingActionLabel: action.label,
          discountAmount
        };
      }
    );
    const segmentDiscountAmount = segments.reduce(
      (total, segment) => total + segment.discountAmount,
      0
    );
    const rawDiscountAmount = segmentDiscountAmount + plan.fixedDeductionAmount;
    const discountAmount = Math.max(
      0,
      Math.min(rule.maxDeductionAmount ?? rawDiscountAmount, rawDiscountAmount)
    );

    return {
      discountAmount,
      segments,
      explanationLines: [
        {
          code: "MARKETING_PLAN",
          title: "行销优惠方案",
          detail: `${plan.displayName} / ${plan.versionId}，按${rule.weekdayAction.label}、${rule.holidayAction.label}计算；命中多个方案时按优先级与优惠力度取一个方案，不叠加。`,
          amount: -discountAmount
        }
      ]
    };
  }

  private buildBillingSegments(
    baseDailyAmount: number,
    pickupAt: Date,
    billableDays: number
  ): PricingQuoteBillingSegment[] {
    return Array.from({ length: billableDays }).map((_, index) => {
      const day = new Date(pickupAt);
      day.setDate(pickupAt.getDate() + index);
      const dayOfWeek = day.getDay();
      const dayType: PricingQuoteBillingSegment["dayType"] =
        dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0
          ? "holiday"
          : "weekday";

      return {
        date: day.toISOString().slice(0, 10),
        dayType,
        baseDailyAmount,
        discountAmount: 0
      };
    });
  }

  private applyMarketingAction(
    baseDailyAmount: number,
    type: "discount" | "amount_off" | "fixed_price",
    value: number
  ) {
    if (type === "amount_off") {
      return Math.max(0, Math.min(baseDailyAmount, Math.round(value)));
    }
    if (type === "fixed_price") {
      return Math.max(0, Math.round(baseDailyAmount - value));
    }
    return Math.max(0, Math.round(baseDailyAmount * (1 - value)));
  }

  private containsWeekend(start: Date, billableDays: number) {
    return Array.from({ length: billableDays }).some((_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day.getDay() === 0 || day.getDay() === 6;
    });
  }

  private getVehicleGroupNameByCode(code: string) {
    const plan = this.pricingPlans[0];
    return (
      plan.ruleLines.find((line) => line.vehicleGroupCode === code)?.vehicleGroupName ??
      code
    );
  }

  private getStoreNameByCode(code: string) {
    const names: Record<string, string> = {
      MONGKOK: "旺角门市",
      CENTRAL: "中环门市",
      AIRPORT: "机场门市"
    };

    return names[code] ?? code;
  }

  private getStoreCodeByName(storeName: string, stations: StoreStationSummary[]) {
    const station = stations.find(
      (item) => item.parentStoreName === storeName || item.name === storeName
    );
    if (station?.storeCode) {
      return station.storeCode;
    }
    const codes: Record<string, string> = {
      旺角门市: "MONGKOK",
      中环门市: "CENTRAL",
      机场门市: "AIRPORT"
    };

    return codes[storeName] ?? storeName;
  }
}
