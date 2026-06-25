import {
  BillingMode,
  ConfigStatus,
  StoreRentalMode,
  type StoreRentalRuleConfig
} from "@store-rental/shared";
import type {
  StoreStationSummary,
  StoreValueAddedServiceSummary,
  VehicleGroupMaster,
  VehicleInstanceSummary
} from "@store-rental/shared";

export const fallbackRules: StoreRentalRuleConfig = {
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

export const vehicleGroups = [
  {
    id: "ECONOMY",
    name: "经济型",
    aliasName: "Economy",
    models: "Honda Fit, Toyota Yaris",
    modelList: ["Honda Fit 1.5", "Toyota Yaris 1.5"],
    dailyPrice: 620,
    lastUpdated: "2026-04-18",
    freeKm: 300,
    pricePerKm: 1.5,
    dailyCap: 0,
    deposit: 2000,
    available: 8
  },
  {
    id: "SEVEN",
    name: "七人座",
    aliasName: "7-Seater",
    models: "Toyota Noah, Honda Stepwgn",
    modelList: ["Toyota Noah 2.0", "Honda Stepwgn 1.5T"],
    dailyPrice: 980,
    lastUpdated: "2026-04-18",
    freeKm: 300,
    pricePerKm: 2,
    dailyCap: 0,
    deposit: 3000,
    available: 5
  },
  {
    id: "EV",
    name: "电动车",
    aliasName: "EV",
    models: "Tesla Model 3, BYD Seal",
    modelList: ["Tesla Model 3", "BYD Seal"],
    dailyPrice: 1080,
    lastUpdated: "2026-04-18",
    freeKm: 300,
    pricePerKm: 2,
    dailyCap: 0,
    deposit: 3500,
    available: 3
  }
];

export const valueAddedServices = [
  { id: "BASIC_PROTECTION", name: "基础保障", price: 80, unit: "/天", maxQuantity: 1, selected: true, quantity: 1 },
  { id: "CHILD_SEAT", name: "儿童座椅", price: 60, unit: "/天", maxQuantity: 2, selected: false, quantity: 1 },
  { id: "NIGHT_PICKUP", name: "夜间取车服务", price: 120, unit: "/次", maxQuantity: 1, selected: false, quantity: 1 },
  { id: "ADDITIONAL_DRIVER", name: "附加驾驶人", price: 100, unit: "/次", maxQuantity: 2, selected: false, quantity: 1 }
];

export const customers = [
  {
    id: "c001",
    name: "陈先生",
    phone: "852****2388",
    levelName: "黄金会员",
    levelType: "warning",
    points: 2600,
    enterprise: {
      name: "ABC Trading",
      monthlyBillingEnabled: true
    }
  },
  {
    id: "c002",
    name: "林小姐",
    phone: "852****6619",
    levelName: "普通会员",
    levelType: "info",
    points: 800
  }
];

export const stores = [
  { code: "MONGKOK", name: "旺角门市" },
  { code: "CENTRAL", name: "中环门市" },
  { code: "AIRPORT", name: "机场门市" }
];

export const billingModes = [
  { label: "客户自付", value: BillingMode.CustomerPay },
  { label: "企业月结", value: BillingMode.Monthly }
];

export const stationRows: StoreStationSummary[] = [
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

export const vehicleGroupMasters: VehicleGroupMaster[] = [
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

export const vehicleRows: VehicleInstanceSummary[] = [
  {
    id: "VEH_001",
    licensePlate: "RX 7821",
    vin: "AHTLB3JE0R0001234",
    vehicleGroupName: "Toyota Noah / 同级 7座",
    assetCompanyName: "演示香港租户",
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
    assetCompanyName: "演示香港租户",
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
    assetCompanyName: "演示香港租户",
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
  }
];

export const storeServiceRows: StoreValueAddedServiceSummary[] = [
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
