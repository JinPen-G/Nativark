import {
  BillingMode,
  DispatchStatus,
  FeeDirection,
  FeeStage,
  FeeStatus,
  MonthlyBillStatus,
  OrderMainStatus,
  PaymentStatus,
  PrismaClient,
  StoreRentalMode,
  VehicleOperationStatus
} from "@prisma/client";

const prisma = new PrismaClient();
const tenantId = "tenant_001";

type DemoOrder = {
  id: string;
  orderNo: string;
  memberId?: string;
  corporateId?: string;
  customerName: string;
  customerPhoneMasked: string;
  corporateShortName?: string;
  vehicleGroupId: string;
  assignedVehicleId?: string;
  pickupStationId: string;
  returnStationId: string;
  pickupAt: string;
  returnAt: string;
  totalAmount: number;
  mainStatus: OrderMainStatus;
  dispatchStatus: DispatchStatus;
  paymentStatus: PaymentStatus;
  billingMode: BillingMode;
  riskFlags: string[];
  fees: Array<{
    code: string;
    name: string;
    stage: FeeStage;
    direction: FeeDirection;
    status: FeeStatus;
    amount: number;
    settledAmount: number;
  }>;
  transactions: Array<{
    type: string;
    status: string;
    amount: number;
    channel: string;
    operator: string;
  }>;
};

/**
 * OPS-04: 主状态覆盖说明
 *
 * 本文件 22 个演示订单覆盖全部 16 种 OrderMainStatus:
 *   PENDING_PAYMENT   -> report_order_014
 *   RESERVED          -> report_order_007
 *   PICKUP_OVERDUE    -> report_order_006
 *   INSPECTING        -> report_order_015
 *   RENTING           -> report_order_002, 010, 013
 *   RENEWING          -> report_order_009
 *   OVERDUE           -> report_order_016
 *   ACCIDENT_PROCESSING -> report_order_003, 011
 *   SETTLEMENT_PENDING  -> report_order_019, 021
 *   PAYMENT_DUE       -> report_order_004
 *   REFUND_PENDING    -> report_order_005
 *   COMPLETED         -> report_order_001, 008
 *   CANCELLED         -> report_order_012
 *   NO_SHOW           -> report_order_017
 *   REJECTED          -> report_order_020, 022
 *   CLOSED            -> report_order_018
 */

const demoOrders: DemoOrder[] = [
  {
    id: "report_order_001",
    orderNo: "SR-DEMO-202606-0001",
    memberId: "member_001",
    corporateId: undefined,
    customerName: "陈嘉豪",
    customerPhoneMasked: "852****2388",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: "VEH_001",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-02T10:00:00+08:00",
    returnAt: "2026-06-04T10:00:00+08:00",
    totalAmount: 2380,
    mainStatus: OrderMainStatus.COMPLETED,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["已完成验车"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 2180, settledAmount: 2180 },
      { code: "SERVICE", name: "儿童座椅", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 200, settledAmount: 200 }
    ],
    transactions: [
      { type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" },
      { type: "payment", status: "success", amount: 2380, channel: "online", operator: "seed" }
    ]
  },
  {
    id: "report_order_002",
    orderNo: "SR-DEMO-202606-0002",
    memberId: "member_001",
    corporateId: "corp_001",
    customerName: "ABC 行政用车",
    customerPhoneMasked: "852****0001",
    corporateShortName: "ABC Trading",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: "VEH_001",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_central",
    pickupAt: "2026-06-03T09:30:00+08:00",
    returnAt: "2026-06-06T18:00:00+08:00",
    totalAmount: 4200,
    mainStatus: OrderMainStatus.RENTING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.MONTHLY_BILLING,
    billingMode: BillingMode.MONTHLY,
    riskFlags: ["异地还车"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 3980, settledAmount: 0 },
      { code: "ONEWAY", name: "异地还车费", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 220, settledAmount: 0 }
    ],
    transactions: [{ type: "monthly_bill", status: "success", amount: 4200, channel: "internal", operator: "seed" }]
  },
  {
    id: "report_order_003",
    orderNo: "SR-DEMO-202606-0003",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-05T11:00:00+08:00",
    returnAt: "2026-06-07T11:00:00+08:00",
    totalAmount: 3360,
    mainStatus: OrderMainStatus.ACCIDENT_PROCESSING,
    dispatchStatus: DispatchStatus.MANUAL_REQUIRED,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["事故出险", "人工调度"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 2960, settledAmount: 0 },
      { code: "DAMAGE", name: "事故车损预估", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 400, settledAmount: 0 }
    ],
    transactions: [{ type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_004",
    orderNo: "SR-DEMO-202606-0004",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: "VEH_002",
    pickupStationId: "station_central",
    returnStationId: "station_central",
    pickupAt: "2026-06-06T14:00:00+08:00",
    returnAt: "2026-06-06T22:00:00+08:00",
    totalAmount: 860,
    mainStatus: OrderMainStatus.PAYMENT_DUE,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PAYMENT_DUE,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["待补缴"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 620, settledAmount: 620 },
      { code: "OVERTIME", name: "超时费", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 240, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 620, channel: "offline", operator: "seed" }]
  },
  {
    id: "report_order_005",
    orderNo: "SR-DEMO-202606-0005",
    memberId: "member_001",
    corporateId: undefined,
    customerName: "陈嘉豪",
    customerPhoneMasked: "852****2388",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: "VEH_002",
    pickupStationId: "station_central",
    returnStationId: "station_central",
    pickupAt: "2026-06-07T09:00:00+08:00",
    returnAt: "2026-06-07T18:00:00+08:00",
    totalAmount: 780,
    mainStatus: OrderMainStatus.REFUND_PENDING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.REFUND_PENDING,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 780, settledAmount: 780 },
      { code: "EARLY_RETURN", name: "提前还车退费", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.REFUND, status: FeeStatus.PENDING, amount: 120, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 780, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_006",
    orderNo: "SR-DEMO-202606-0006",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-08T08:00:00+08:00",
    returnAt: "2026-06-09T08:00:00+08:00",
    totalAmount: 980,
    mainStatus: OrderMainStatus.PICKUP_OVERDUE,
    dispatchStatus: DispatchStatus.PENDING,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["需联系客户"],
    fees: [{ code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 980, settledAmount: 0 }],
    transactions: [{ type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_007",
    orderNo: "SR-DEMO-202606-0007",
    memberId: "member_001",
    corporateId: "corp_001",
    customerName: "ABC 商务接待",
    customerPhoneMasked: "852****0001",
    corporateShortName: "ABC Trading",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: undefined,
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-09T10:00:00+08:00",
    returnAt: "2026-06-11T10:00:00+08:00",
    totalAmount: 2580,
    mainStatus: OrderMainStatus.RESERVED,
    dispatchStatus: DispatchStatus.PRE_ASSIGNED,
    paymentStatus: PaymentStatus.MONTHLY_BILLING,
    billingMode: BillingMode.MONTHLY,
    riskFlags: [],
    fees: [{ code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 2580, settledAmount: 0 }],
    transactions: []
  },
  {
    id: "report_order_008",
    orderNo: "SR-DEMO-202606-0008",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-10T12:00:00+08:00",
    returnAt: "2026-06-12T12:00:00+08:00",
    totalAmount: 3600,
    mainStatus: OrderMainStatus.COMPLETED,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PARTIAL_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["追缴待通知"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 3200, settledAmount: 3200 },
      { code: "POST_ETC", name: "ETC追缴", stage: FeeStage.POST_CHARGE, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 400, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 3200, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_009",
    orderNo: "SR-DEMO-202606-0009",
    memberId: "member_001",
    corporateId: undefined,
    customerName: "陈嘉豪",
    customerPhoneMasked: "852****2388",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: "VEH_001",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-02T10:00:00+08:00",
    returnAt: "2026-06-10T10:00:00+08:00",
    totalAmount: 5980,
    mainStatus: OrderMainStatus.RENEWING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["续租中"],
    fees: [
      { code: "RENTAL", name: "原租期租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 3580, settledAmount: 3580 },
      { code: "RENTAL_EXT", name: "续租延期费", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 2400, settledAmount: 0 }
    ],
    transactions: [
      { type: "payment", status: "success", amount: 3580, channel: "online", operator: "seed" }
    ]
  },
  {
    id: "report_order_010",
    orderNo: "SR-DEMO-202606-0010",
    memberId: undefined,
    corporateId: "corp_001",
    customerName: "ABC 项目用车",
    customerPhoneMasked: "852****0001",
    corporateShortName: "ABC Trading",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: "VEH_002",
    pickupStationId: "station_central",
    returnStationId: "station_central",
    pickupAt: "2026-06-04T09:00:00+08:00",
    returnAt: "2026-06-06T09:00:00+08:00",
    totalAmount: 1760,
    mainStatus: OrderMainStatus.RENTING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.MONTHLY_BILLING,
    billingMode: BillingMode.MONTHLY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 1560, settledAmount: 0 },
      { code: "SERVICE", name: "GPS服务费", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 200, settledAmount: 0 }
    ],
    transactions: [{ type: "monthly_bill", status: "success", amount: 1760, channel: "internal", operator: "seed" }]
  },
  {
    id: "report_order_011",
    orderNo: "SR-DEMO-202606-0011",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-05T14:00:00+08:00",
    returnAt: "2026-06-08T14:00:00+08:00",
    totalAmount: 4980,
    mainStatus: OrderMainStatus.ACCIDENT_PROCESSING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PARTIAL_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["事故出险", "追缴待通知"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 3760, settledAmount: 3760 },
      { code: "DAMAGE", name: "事故车损", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 800, settledAmount: 0 },
      { code: "POST_ETC", name: "ETC追缴", stage: FeeStage.POST_CHARGE, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 420, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 3760, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_012",
    orderNo: "SR-DEMO-202606-0012",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-09T15:00:00+08:00",
    returnAt: "2026-06-10T15:00:00+08:00",
    totalAmount: 780,
    mainStatus: OrderMainStatus.CANCELLED,
    dispatchStatus: DispatchStatus.PENDING,
    paymentStatus: PaymentStatus.REFUNDED,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.VOIDED, amount: 780, settledAmount: 0 },
      { code: "CANCEL_FEE", name: "取消手续费", stage: FeeStage.CANCELLATION, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 100, settledAmount: 100 }
    ],
    transactions: [
      { type: "refund", status: "success", amount: 780, channel: "online", operator: "seed" },
      { type: "payment", status: "success", amount: 100, channel: "online", operator: "seed" }
    ]
  },
  {
    id: "report_order_013",
    orderNo: "SR-DEMO-202606-0013",
    memberId: undefined,
    corporateId: "corp_002",
    customerName: "Peak Studio 拍摄用车",
    customerPhoneMasked: "852****0018",
    corporateShortName: "Peak Studio",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: "VEH_002",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-12T09:00:00+08:00",
    returnAt: "2026-06-14T09:00:00+08:00",
    totalAmount: 1600,
    mainStatus: OrderMainStatus.RENTING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.MONTHLY_BILLING,
    billingMode: BillingMode.MONTHLY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 1200, settledAmount: 0 },
      { code: "SERVICE", name: "GPS服务费", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.MONTHLY_BILLING, amount: 400, settledAmount: 0 }
    ],
    transactions: [{ type: "monthly_bill", status: "success", amount: 1600, channel: "internal", operator: "seed" }]
  },
  {
    id: "report_order_014",
    orderNo: "SR-DEMO-202606-0014",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_central",
    returnStationId: "station_central",
    pickupAt: "2026-06-13T10:00:00+08:00",
    returnAt: "2026-06-15T10:00:00+08:00",
    totalAmount: 1280,
    mainStatus: OrderMainStatus.PENDING_PAYMENT,
    dispatchStatus: DispatchStatus.PRE_ASSIGNED,
    paymentStatus: PaymentStatus.UNPAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["等待付款"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 1180, settledAmount: 0 },
      { code: "DEPOSIT", name: "押金预授权", stage: FeeStage.PRE_AUTH, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 100, settledAmount: 0 }
    ],
    transactions: []
  },
  {
    id: "report_order_015",
    orderNo: "SR-DEMO-202606-0015",
    memberId: "member_001",
    corporateId: undefined,
    customerName: "陈嘉豪",
    customerPhoneMasked: "852****2388",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: "VEH_001",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-13T14:00:00+08:00",
    returnAt: "2026-06-16T14:00:00+08:00",
    totalAmount: 3180,
    mainStatus: OrderMainStatus.INSPECTING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 2980, settledAmount: 0 },
      { code: "SERVICE", name: "保险升级", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 200, settledAmount: 0 }
    ],
    transactions: [{ type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_016",
    orderNo: "SR-DEMO-202606-0016",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-01T09:00:00+08:00",
    returnAt: "2026-06-03T09:00:00+08:00",
    totalAmount: 2560,
    mainStatus: OrderMainStatus.OVERDUE,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PARTIAL_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["逾期未还", "持续催缴"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 1960, settledAmount: 1960 },
      { code: "OVERDUE_FEE", name: "逾期滞纳金", stage: FeeStage.POST_CHARGE, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 600, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 1960, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_017",
    orderNo: "SR-DEMO-202606-0017",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-14T08:00:00+08:00",
    returnAt: "2026-06-15T08:00:00+08:00",
    totalAmount: 680,
    mainStatus: OrderMainStatus.NO_SHOW,
    dispatchStatus: DispatchStatus.PENDING,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["客户未到店"],
    fees: [
      { code: "NO_SHOW_FEE", name: "未到店手续费", stage: FeeStage.CANCELLATION, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 680, settledAmount: 0 }
    ],
    transactions: [{ type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_018",
    orderNo: "SR-DEMO-202606-0018",
    memberId: undefined,
    corporateId: "corp_001",
    customerName: "ABC 车辆调换",
    customerPhoneMasked: "852****0001",
    corporateShortName: "ABC Trading",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_central",
    returnStationId: "station_central",
    pickupAt: "2026-06-11T10:00:00+08:00",
    returnAt: "2026-06-12T10:00:00+08:00",
    totalAmount: 0,
    mainStatus: OrderMainStatus.CLOSED,
    dispatchStatus: DispatchStatus.PENDING,
    paymentStatus: PaymentStatus.REFUNDED,
    billingMode: BillingMode.MONTHLY,
    riskFlags: [],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.VOIDED, amount: 960, settledAmount: 0 }
    ],
    transactions: []
  },
  {
    id: "report_order_019",
    orderNo: "SR-DEMO-202606-0019",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-15T09:00:00+08:00",
    returnAt: "2026-06-18T09:00:00+08:00",
    totalAmount: 4560,
    mainStatus: OrderMainStatus.SETTLEMENT_PENDING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.PARTIAL_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["待结算"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 3960, settledAmount: 3960 },
      { code: "OVERTIME", name: "超时费", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 600, settledAmount: 0 }
    ],
    transactions: [{ type: "payment", status: "success", amount: 3960, channel: "online", operator: "seed" }]
  },
  {
    id: "report_order_020",
    orderNo: "SR-DEMO-202606-0020",
    memberId: "member_002",
    corporateId: undefined,
    customerName: "林慧仪",
    customerPhoneMasked: "852****6619",
    vehicleGroupId: "VG_ECONOMY",
    assignedVehicleId: undefined,
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-16T10:00:00+08:00",
    returnAt: "2026-06-18T10:00:00+08:00",
    totalAmount: 1560,
    mainStatus: OrderMainStatus.REJECTED,
    dispatchStatus: DispatchStatus.PENDING,
    paymentStatus: PaymentStatus.REFUNDED,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["验车不通过"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.VOIDED, amount: 1460, settledAmount: 0 },
      { code: "INSPECT_FEE", name: "验车手续费", stage: FeeStage.PICKUP, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 100, settledAmount: 100 }
    ],
    transactions: [
      { type: "refund", status: "success", amount: 1460, channel: "online", operator: "seed" },
      { type: "payment", status: "success", amount: 100, channel: "online", operator: "seed" }
    ]
  },
  // 补充: SETTLEMENT_PENDING 状态 (还车待结算)
  {
    id: "report_order_021",
    orderNo: "SR-DEMO-202606-0021",
    memberId: "member_003",
    corporateId: undefined,
    customerName: "王子俊",
    customerPhoneMasked: "852****9081",
    vehicleGroupId: "VG_EV",
    assignedVehicleId: "VEH_003",
    pickupStationId: "station_airport",
    returnStationId: "station_airport",
    pickupAt: "2026-06-17T09:00:00+08:00",
    returnAt: "2026-06-19T09:00:00+08:00",
    totalAmount: 3160,
    mainStatus: OrderMainStatus.SETTLEMENT_PENDING,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["待结算"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.SETTLED, amount: 2760, settledAmount: 2760 },
      { code: "DAMAGE", name: "车辆刮蹭修复费", stage: FeeStage.RETURN_SETTLEMENT, direction: FeeDirection.CHARGE, status: FeeStatus.PENDING, amount: 400, settledAmount: 0 }
    ],
    transactions: [
      { type: "pre_auth_freeze", status: "success", amount: 0, channel: "online", operator: "seed" },
      { type: "payment", status: "success", amount: 2760, channel: "online", operator: "seed" }
    ]
  },
  // 补充: REJECTED 状态 (验车不通过, 租金已退款)
  {
    id: "report_order_022",
    orderNo: "SR-DEMO-202606-0022",
    memberId: "member_001",
    corporateId: undefined,
    customerName: "陈嘉豪",
    customerPhoneMasked: "852****2388",
    vehicleGroupId: "VG_SEVEN",
    assignedVehicleId: "VEH_001",
    pickupStationId: "station_mk_counter",
    returnStationId: "station_mk_counter",
    pickupAt: "2026-06-18T14:00:00+08:00",
    returnAt: "2026-06-20T14:00:00+08:00",
    totalAmount: 2780,
    mainStatus: OrderMainStatus.REJECTED,
    dispatchStatus: DispatchStatus.LOCKED,
    paymentStatus: PaymentStatus.REFUNDED,
    billingMode: BillingMode.CUSTOMER_PAY,
    riskFlags: ["验车不通过", "已退款"],
    fees: [
      { code: "RENTAL", name: "车辆租金", stage: FeeStage.RENTAL, direction: FeeDirection.CHARGE, status: FeeStatus.VOIDED, amount: 2580, settledAmount: 0 },
      { code: "DEPOSIT", name: "押金退还", stage: FeeStage.PICKUP, direction: FeeDirection.REFUND, status: FeeStatus.SETTLED, amount: 200, settledAmount: 200 }
    ],
    transactions: [
      { type: "refund", status: "success", amount: 2780, channel: "online", operator: "seed" }
    ]
  }
];

async function upsertDemoOrders() {
  for (const order of demoOrders) {
    const vehicleGroup = await prisma.vehicleGroup.findUniqueOrThrow({
      where: { id: order.vehicleGroupId }
    });
    const pickupStation = await prisma.storeStation.findUniqueOrThrow({
      where: { id: order.pickupStationId }
    });
    const returnStation = await prisma.storeStation.findUniqueOrThrow({
      where: { id: order.returnStationId }
    });
    const vehicle = order.assignedVehicleId
      ? await prisma.vehicle.findUnique({ where: { id: order.assignedVehicleId } })
      : undefined;

    await prisma.feeItem.deleteMany({ where: { orderId: order.id } });
    await prisma.transactionRecord.deleteMany({ where: { orderId: order.id } });
    await prisma.orderTimelineEvent.deleteMany({ where: { orderId: order.id } });

    await prisma.storeRentalOrder.upsert({
      where: { id: order.id },
      update: {
        mainStatus: order.mainStatus,
        dispatchStatus: order.dispatchStatus,
        paymentStatus: order.paymentStatus,
        billingMode: order.billingMode,
        memberId: order.memberId,
        corporateId: order.corporateId,
        customerName: order.customerName,
        customerPhoneMasked: order.customerPhoneMasked,
        corporateShortName: order.corporateShortName,
        vehicleGroupId: order.vehicleGroupId,
        assignedVehicleId: order.assignedVehicleId,
        assignedVehicleSnapshot: vehicle
          ? { plateNo: vehicle.plateNo, vehicleGroupName: vehicleGroup.name }
          : undefined,
        pickupStationId: order.pickupStationId,
        returnStationId: order.returnStationId,
        pickupAt: new Date(order.pickupAt),
        returnAt: new Date(order.returnAt),
        totalAmount: order.totalAmount,
        riskFlags: order.riskFlags,
        vehicleGroupSnapshot: { id: vehicleGroup.id, name: vehicleGroup.name },
        pickupStoreSnapshot: {
          name: pickupStation.parentStoreName,
          stationName: pickupStation.name
        },
        returnStoreSnapshot: {
          name: returnStation.parentStoreName,
          stationName: returnStation.name
        },
        pricingSnapshot: { source: "report-demo", version: "price-demo-v1" },
        marketingSnapshot: { source: "report-demo" },
        termsSnapshot: { source: "report-demo", version: "terms-demo-v1" },
        settlementSummary: { source: "report-demo" }
      },
      create: {
        id: order.id,
        tenantId,
        mode: StoreRentalMode.STORE_RENTAL,
        orderNo: order.orderNo,
        mainStatus: order.mainStatus,
        dispatchStatus: order.dispatchStatus,
        paymentStatus: order.paymentStatus,
        billingMode: order.billingMode,
        memberId: order.memberId,
        corporateId: order.corporateId,
        customerName: order.customerName,
        customerPhoneMasked: order.customerPhoneMasked,
        corporateShortName: order.corporateShortName,
        vehicleGroupId: order.vehicleGroupId,
        vehicleGroupSnapshot: { id: vehicleGroup.id, name: vehicleGroup.name },
        assignedVehicleId: order.assignedVehicleId,
        assignedVehicleSnapshot: vehicle
          ? { plateNo: vehicle.plateNo, vehicleGroupName: vehicleGroup.name }
          : undefined,
        pickupStationId: order.pickupStationId,
        returnStationId: order.returnStationId,
        pickupStoreSnapshot: {
          name: pickupStation.parentStoreName,
          stationName: pickupStation.name
        },
        returnStoreSnapshot: {
          name: returnStation.parentStoreName,
          stationName: returnStation.name
        },
        pickupAt: new Date(order.pickupAt),
        returnAt: new Date(order.returnAt),
        totalAmount: order.totalAmount,
        riskFlags: order.riskFlags,
        pricingSnapshot: { source: "report-demo", version: "price-demo-v1" },
        marketingSnapshot: { source: "report-demo" },
        termsSnapshot: { source: "report-demo", version: "terms-demo-v1" },
        settlementSummary: { source: "report-demo" },
        createdById: "user_admin_001"
      }
    });

    await prisma.feeItem.createMany({
      data: order.fees.map((fee, index) => ({
        id: `${order.id}_fee_${index + 1}`,
        orderId: order.id,
        code: fee.code,
        name: fee.name,
        stage: fee.stage,
        direction: fee.direction,
        status: fee.status,
        amount: fee.amount,
        settledAmount: fee.settledAmount,
        pendingAmount: Math.max(0, fee.amount - fee.settledAmount),
        source: "system",
        description: "report demo data",
        snapshotRef: "report-demo",
        ruleSnapshot: { source: "report-demo" }
      }))
    });

    await prisma.transactionRecord.createMany({
      data: order.transactions.map((transaction, index) => ({
        id: `${order.id}_txn_${index + 1}`,
        orderId: order.id,
        type: transaction.type,
        status: transaction.status,
        amount: transaction.amount,
        provider: "mock",
        channel: transaction.channel,
        operator: transaction.operator,
        relatedFeeIds: [],
        note: "report demo transaction"
      }))
    });

    await prisma.orderTimelineEvent.create({
      data: {
        id: `${order.id}_timeline_created`,
        orderId: order.id,
        type: "report_demo",
        title: "报表演示数据初始化",
        detail: { orderNo: order.orderNo },
        operator: "seed"
      }
    });
  }
}

async function upsertMonthlyBill() {
  await prisma.corporateMonthlyBillLine.deleteMany({
    where: { billId: "report_bill_001" }
  });
  await prisma.corporateMonthlyBillSettlement.deleteMany({
    where: { billId: "report_bill_001" }
  });
  await prisma.corporateMonthlyBill.upsert({
    where: { id: "report_bill_001" },
    update: {
      tenantId,
      corporateId: "corp_001",
      billNo: "BILL-DEMO-202606",
      period: "2026-06",
      status: MonthlyBillStatus.POSTED,
      orderCount: 2,
      totalAmount: 6780,
      paidAmount: 3000,
      balanceAmount: 3780,
      dueDate: new Date("2026-07-25T00:00:00+08:00")
    },
    create: {
      id: "report_bill_001",
      tenantId,
      corporateId: "corp_001",
      billNo: "BILL-DEMO-202606",
      period: "2026-06",
      status: MonthlyBillStatus.POSTED,
      orderCount: 2,
      totalAmount: 6780,
      paidAmount: 3000,
      balanceAmount: 3780,
      dueDate: new Date("2026-07-25T00:00:00+08:00")
    }
  });

  await prisma.corporateMonthlyBillLine.createMany({
    data: [
      {
        id: "report_bill_001_line_1",
        billId: "report_bill_001",
        orderId: "report_order_002",
        orderNo: "SR-DEMO-202606-0002",
        customerName: "ABC 行政用车",
        vehicleGroupName: "Toyota Noah / 同级 7座",
        pickupStoreName: "旺角门市",
        returnStoreName: "中环门市",
        amount: 4200,
        remark: "企业月结租赁费用"
      },
      {
        id: "report_bill_001_line_2",
        billId: "report_bill_001",
        orderId: "report_order_007",
        orderNo: "SR-DEMO-202606-0007",
        customerName: "ABC 商务接待",
        vehicleGroupName: "Toyota Noah / 同级 7座",
        pickupStoreName: "旺角门市",
        returnStoreName: "旺角门市",
        amount: 2580,
        remark: "企业月结预约费用"
      }
    ],
    skipDuplicates: true
  });

  // corp_002 (Peak Studio) monthly bill
  await prisma.corporateMonthlyBillLine.deleteMany({
    where: { billId: "report_bill_002" }
  });
  await prisma.corporateMonthlyBillSettlement.deleteMany({
    where: { billId: "report_bill_002" }
  });
  await prisma.corporateMonthlyBill.upsert({
    where: { id: "report_bill_002" },
    update: {
      tenantId,
      corporateId: "corp_002",
      billNo: "BILL-DEMO-202606-PS",
      period: "2026-06",
      status: MonthlyBillStatus.POSTED,
      orderCount: 1,
      totalAmount: 1600,
      paidAmount: 0,
      balanceAmount: 1600,
      dueDate: new Date("2026-07-25T00:00:00+08:00")
    },
    create: {
      id: "report_bill_002",
      tenantId,
      corporateId: "corp_002",
      billNo: "BILL-DEMO-202606-PS",
      period: "2026-06",
      status: MonthlyBillStatus.POSTED,
      orderCount: 1,
      totalAmount: 1600,
      paidAmount: 0,
      balanceAmount: 1600,
      dueDate: new Date("2026-07-25T00:00:00+08:00")
    }
  });

  await prisma.corporateMonthlyBillLine.createMany({
    data: [
      {
        id: "report_bill_002_line_1",
        billId: "report_bill_002",
        orderId: "report_order_013",
        orderNo: "SR-DEMO-202606-0013",
        customerName: "Peak Studio 拍摄用车",
        vehicleGroupName: "Honda Jazz / 同级",
        pickupStoreName: "旺角门市",
        returnStoreName: "旺角门市",
        amount: 1600,
        remark: "Peak Studio 企业月结拍摄用车"
      }
    ],
    skipDuplicates: true
  });
}

async function upsertOpsArtifacts() {
  await prisma.reportExportJob.createMany({
    data: [
      {
        id: "report_export_demo_001",
        tenantId,
        reportType: "orders",
        fileName: "store-rental-orders-2026-06-demo.csv",
        status: "completed",
        filters: { from: "2026-06-01", to: "2026-06-30" },
        rowCount: 18,
        downloadUrl: "/api/reports/exports/store-rental-orders-2026-06-demo.csv",
        operator: "seed",
        completedAt: new Date("2026-06-08T11:00:00+08:00")
      },
      {
        id: "report_export_demo_002",
        tenantId,
        reportType: "finance",
        fileName: "store-rental-finance-2026-06-demo.csv",
        status: "completed",
        filters: { from: "2026-06-01", to: "2026-06-30" },
        rowCount: 6,
        downloadUrl: "/api/reports/exports/store-rental-finance-2026-06-demo.csv",
        operator: "seed",
        completedAt: new Date("2026-06-08T11:20:00+08:00")
      }
    ],
    skipDuplicates: true
  });

  await prisma.opsEventLog.createMany({
    data: [
      {
        id: "ops_log_report_seed_001",
        tenantId,
        level: "info",
        category: "seed",
        message: "report demo data seeded",
        payload: { orderCount: demoOrders.length },
        traceId: "seed-report-demo"
      },
      {
        id: "ops_log_report_export_001",
        tenantId,
        level: "info",
        category: "report-export",
        message: "demo export job completed",
        payload: { reportType: "orders", rowCount: demoOrders.length },
        traceId: "report-export-demo"
      },
      {
        id: "ops_log_report_mysql_001",
        tenantId,
        level: "warning",
        category: "mysql",
        message: "backup schedule reserved, manual backup script available",
        payload: { script: "scripts/backup-mysql.ps1" },
        traceId: "ops-backup-demo"
      }
    ],
    skipDuplicates: true
  });
}

async function updateVehicleStatuses() {
  await prisma.vehicle.update({ where: { id: "VEH_001" }, data: { operationStatus: VehicleOperationStatus.RENTING, status: "renting" } });
  await prisma.vehicle.update({ where: { id: "VEH_002" }, data: { operationStatus: VehicleOperationStatus.IDLE, status: "idle" } });
  await prisma.vehicle.update({ where: { id: "VEH_003" }, data: { operationStatus: VehicleOperationStatus.MAINTENANCE, status: "maintenance" } });
}

async function main() {
  await upsertDemoOrders();
  await upsertMonthlyBill();
  await upsertOpsArtifacts();
  await updateVehicleStatuses();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Store rental report demo seed completed.");
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
