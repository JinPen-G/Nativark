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
        rowCount: demoOrders.length,
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
