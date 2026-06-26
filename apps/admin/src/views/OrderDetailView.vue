<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  BillingMode,
  OrderMainStatus,
  PaymentStatus,
  StoreRentalMode,
  type FinanceDocumentRow,
  type StoreRentalFeeDirection,
  type StoreRentalFeeStage,
  type StoreRentalOrderDetail,
  type StoreRentalOrderSummary,
  type StoreStationSummary,
  type VehicleGroupMaster,
  type VehicleInstanceSummary
} from "@store-rental/shared";
import {
  createStoreRentalOrderContract,
  createStoreRentalOrderFee,
  createStoreRentalOrderNotification,
  createStoreRentalOrderRemark,
  closeStoreRentalOrderRemark,
  createStoreRentalOrderTransaction,
  getStoreRentalOrder,
  listFinanceDocuments,
  listStations,
  listVehicleGroups,
  listVehicles,
  listStoreRentalOrders,
  printStoreRentalContractMock,
  runStoreRentalOrderAction,
  signStoreRentalContractMock,
  waiveStoreRentalOrderFee
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

type TerminationAction = "cancel" | "mark-no-show" | "reject-order" | "close-order";
type MoreAction = TerminationAction | "register-accident";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const actionLoading = ref("");
const feeModalVisible = ref(false);
const activeFeeTab = ref("overview");
const createFeeDialogVisible = ref(false);
const waiveFeeDialogVisible = ref(false);
const transactionDialogVisible = ref(false);
const contractDialogVisible = ref(false);
const notificationDialogVisible = ref(false);
const remarkDialogVisible = ref(false);
const feeActionLoading = ref("");
const fulfillmentActionLoading = ref("");
const extendDialogVisible = ref(false);
const terminationDialogVisible = ref(false);
const accidentDialogVisible = ref(false);
const redirectionDialogVisible = ref(false);
const redirectionLoading = ref(false);
const returnLocationDialogVisible = ref(false);
const returnLocationLoading = ref(false);
const returnLocationMode = ref<"store" | "station">("store");
const returnLocationConflictResolved = ref(false);
const pickupWizardVisible = ref(false);
const pickupStep = ref(0);
const pickupSubmitting = ref(false);
const returnWizardVisible = ref(false);
const returnStep = ref(0);
const returnSubmitting = ref(false);
const pendingTerminationAction = ref<TerminationAction>("cancel");
const extensionRows = ref<StoreRentalOrderSummary[]>([]);
const redirectionVehicles = ref<VehicleInstanceSummary[]>([]);
const redirectionGroups = ref<VehicleGroupMaster[]>([]);
const returnLocationStations = ref<StoreStationSummary[]>([]);
const returnLocationOrders = ref<StoreRentalOrderSummary[]>([]);
const returnLocationVehicles = ref<VehicleInstanceSummary[]>([]);
const selectedFeeId = ref("");
const selectedFeeName = ref("");
const pendingTransactionType = ref<"payment" | "refund" | "monthly_bill">("payment");
const detail = ref<StoreRentalOrderDetail | null>(null);
const financeDocuments = ref<FinanceDocumentRow[]>([]);
const extensionForm = reactive({
  newReturnAt: "",
  settlementMode: "return_settlement" as "immediate" | "return_settlement" | "monthly",
  paymentPaid: false,
  operator: "营运端",
  memo: ""
});
const terminationForm = reactive({
  reason: "",
  contactResult: "",
  memo: "",
  operator: "营运端",
  specialWaiver: false,
  waiverReason: "",
  rejectionFeeAmount: 0,
  customerCommunicationConfirmed: false
});
const createFeeForm = reactive({
  code: "MANUAL_FEE",
  name: "其他费用",
  stage: "return_settlement" as StoreRentalFeeStage,
  direction: "charge" as StoreRentalFeeDirection,
  amount: 0,
  description: "",
  operator: "营运端"
});
const waiveFeeForm = reactive({
  amount: 0,
  operator: "营运端",
  reason: ""
});
const transactionForm = reactive({
  channel: "offline" as "online" | "offline" | "internal",
  amount: 0,
  operator: "营运端",
  relatedFeeIds: [] as string[],
  note: ""
});
const contractForm = reactive({
  type: "rental_contract" as "rental_contract" | "pickup_sheet" | "return_sheet" | "settlement_sheet",
  title: "门市租赁合约",
  status: "signed" as "pending" | "signed" | "fallback_uploaded" | "voided",
  signMethod: "counter" as "app" | "counter" | "offline_paper" | "system",
  signerName: "",
  fileUrl: "",
  operator: "营运端"
});
const notificationForm = reactive({
  scene: "manual" as "order_created" | "pickup_completed" | "return_completed" | "payment_due" | "post_charge" | "order_terminal" | "manual",
  channel: "manual" as "sms" | "app" | "email" | "manual",
  target: "",
  content: "",
  status: "sent" as "pending" | "sent" | "failed" | "skipped",
  operator: "营运端"
});
const remarkForm = reactive({
  category: "internal_note" as
    | "general"
    | "internal_note"
    | "customer_note"
    | "return_visit"
    | "fulfillment_followup"
    | "pickup"
    | "return"
    | "finance"
    | "risk"
    | "customer_followup",
  content: "",
  visibility: "internal" as "internal" | "customer_visible",
  followUpAt: "",
  reminderAt: "",
  responsibleName: "",
  status: "open" as "open" | "closed",
  operator: "营运端"
});
const accidentForm = reactive({
  description: "",
  accidentAt: "",
  location: "",
  responsibility: "customer",
  handlingStatus: "pending_assessment",
  estimatedAmount: 0,
  insuranceNo: "",
  operator: "营运端",
  remark: ""
});
const redirectionForm = reactive({
  selectionMode: "manual" as "manual" | "auto",
  vehicleGroupName: "",
  targetVehicleId: "",
  reason: "",
  priceHandling: "diff" as "diff" | "free",
  managerOverride: false,
  operator: "营运端",
  memo: ""
});
const returnLocationForm = reactive({
  targetStoreName: "",
  targetStationPath: [] as string[],
  reason: "",
  operator: "营运端",
  memo: ""
});
const pickupForm = reactive({
  driverName: "",
  driverPhone: "",
  identityNoMasked: "",
  licenseValidUntil: "",
  identityPhotoUploaded: true,
  licensePhotoUploaded: true,
  identityMatched: false,
  riskChecked: true,
  originalMarketingPlan: "订单创建时行销方案",
  marketingNeedVerification: false,
  marketingVerificationResult: "passed" as "passed" | "failed",
  proofFileCount: 0,
  changedMarketingPlan: "",
  marketingVerificationReason: "",
  preAuthMode: "performance_guarantee" as "performance_guarantee" | "rent_offset",
  preAuthStatus: "frozen" as "frozen" | "captured" | "released",
  preAuthAmount: 2000,
  pickupCollectedAmount: 0,
  balancePaid: false,
  monthlyBillingConfirmed: false,
  contractSigned: false,
  signMethod: "counter" as "app" | "counter" | "offline_paper",
  signerName: "",
  actualPickupAt: "",
  mileage: 0,
  fuelLevelPercent: 80,
  batteryLevelPercent: 0,
  vehicleStationName: "",
  deliveryLocation: "门市交付区",
  photoCount: 9,
  damageFound: false,
  damageDescription: "",
  customerSigned: false,
  operator: "营运端",
  memo: ""
});
const returnForm = reactive({
  actualReturnAt: "",
  returnStationName: "",
  parkingFloor: "",
  parkingSpaceNo: "",
  parkingPhotoCount: 0,
  returnMileage: 0,
  fuelLevelPercent: 80,
  batteryLevelPercent: 0,
  cleanliness: "normal" as "clean" | "normal" | "dirty",
  damageFound: false,
  damageDescription: "",
  missingItems: "",
  photoCount: 9,
  customerSigned: false,
  overtimeFeeAmount: 0,
  damageFeeAmount: 0,
  cleaningFeeAmount: 0,
  discountAmount: 0,
  settlementHandled: false,
  monthlyBillingPosted: false,
  operator: "营运端",
  memo: ""
});
const redirectionReasons = [
  { value: "vehicle_fault", label: "原车故障" },
  { value: "vehicle_not_ready", label: "原车未整备完成" },
  { value: "vehicle_unavailable", label: "原车事故/不可交付" },
  { value: "customer_upgrade", label: "客户要求升级" },
  { value: "customer_downgrade", label: "客户同意降级" },
  { value: "store_free_upgrade", label: "门店免费升等" },
  { value: "dispatch_adjustment", label: "车辆调度调整" },
  { value: "extend_conflict_followup", label: "续租冲突改派后续订单" },
  { value: "return_store_conflict_followup", label: "转单冲突改派后续订单" },
  { value: "other", label: "其他" }
];
const returnLocationReasons = [
  { value: "customer_request", label: "客户要求改还车门市" },
  { value: "store_negotiation", label: "门店协商改还车门市" },
  { value: "vehicle_rebalancing", label: "车辆回流安排" },
  { value: "original_store_unavailable", label: "原还车门市无法接收" },
  { value: "accident_exception", label: "事故/异常处理需要" },
  { value: "other", label: "其他" }
];
const accidentResponsibilityOptions = [
  { label: "客户责任", value: "customer" },
  { label: "门店责任", value: "store" },
  { label: "第三方责任", value: "third_party" },
  { label: "责任待定", value: "pending" }
];
const accidentHandlingStatusOptions = [
  { label: "待定损", value: "pending_assessment" },
  { label: "保险处理中", value: "insurance_processing" },
  { label: "客户确认中", value: "customer_confirming" },
  { label: "已结案", value: "closed" }
];

const orderId = computed(() => String(route.params.id ?? ""));
const isMonthly = computed(() => detail.value?.billingMode === BillingMode.Monthly);
const latestPickupInspection = computed(() =>
  detail.value?.inspectionRecords
    .filter((record) => record.stage === "pickup")
    .slice(-1)[0]
);
const eventSnapshots = computed(() => detail.value?.snapshots.events ?? []);
const eventTab = ref("all");

interface FulfillmentEvent {
  id: string;
  type: "action" | "dispatch" | "accident" | "fee" | "contract" | "notification" | "remark";
  title: string;
  summary: string;
  operator: string;
  time: string;
}

const allEvents = computed<FulfillmentEvent[]>(() => {
  const order = detail.value;
  if (!order) return [];
  const events: FulfillmentEvent[] = [];
  // Timeline events
  for (const item of order.timeline) {
    events.push({
      id: `timeline-${item.at}-${item.actor}`,
      type: "action",
      title: item.action,
      summary: "",
      operator: item.actor,
      time: item.at
    });
  }
  // Event snapshots
  for (const snap of eventSnapshots.value) {
    events.push({
      id: snap.id,
      type: "dispatch",
      title: snap.title,
      summary: snap.settlementTarget || "",
      operator: snap.operator,
      time: snap.snapshotRef
    });
  }
  return events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
});

const exceptionEvents = computed(() =>
  allEvents.value.filter((e) => e.title.includes("事故") || e.title.includes("取消") || e.title.includes("爽约") || e.title.includes("拒绝") || e.title.includes("关闭"))
);

const reassignEvents = computed(() =>
  allEvents.value.filter((e) => e.title.includes("改派") || e.title.includes("改还车"))
);

const accidentEvents = computed(() =>
  allEvents.value.filter((e) => e.title.includes("事故") || e.title.includes("出险"))
);

function eventTypeLabel(type: string) {
  const map: Record<string, string> = { action: "操作", dispatch: "调度", accident: "事故", fee: "费用", contract: "合同", notification: "通知", remark: "备注" };
  return map[type] || type;
}

function eventTypeTag(type: string) {
  const map: Record<string, string> = { action: "info", dispatch: "warning", accident: "danger", fee: "success", contract: "", notification: "info", remark: "info" };
  return map[type] || "";
}

function parseDispatchDetails(title: string): string {
  // 解析改派事件标题，提取原车辆、新车辆、原因
  // 格式示例：调度页人工改派：RX 7821 -> BCP 7315，原因：车辆调度调整，备注：xxx
  const match = title.match(/改派[：:]([^-]+)->([^,，]+)/);
  if (match) {
    const fromVehicle = match[1].trim();
    const toVehicle = match[2].trim().split(/[，,]/)[0].trim();
    return `原车辆：${fromVehicle} → 新车辆：${toVehicle}`;
  }
  return title;
}

function parseAccidentDetails(title: string): string {
  // 解析事故事件标题，提取事故描述
  // 格式示例：事故登记：xxx事故描述
  const match = title.match(/事故[：:](.+)/);
  if (match) {
    const description = match[1].trim().split(/[，,]/)[0].trim();
    return `事故描述：${description}`;
  }
  return title;
}

function invoiceStatusLabel(status: string) {
  const map: Record<string, string> = {
    issued: "已开具",
    voided: "已作废",
    pending: "待开具",
    draft: "草稿"
  };
  return map[status] || status;
}

const pickupBalanceDue = computed(() => {
  const order = detail.value;
  if (!order || isMonthly.value) {
    return 0;
  }
  const preAuthOffset =
    pickupForm.preAuthMode === "rent_offset" && pickupForm.preAuthStatus === "captured"
      ? pickupForm.preAuthAmount
      : 0;
  const due = Math.max(0, order.totalAmount - preAuthOffset - pickupForm.pickupCollectedAmount);
  return pickupForm.balancePaid ? 0 : due;
});
const canContinuePickupStep = computed(() => {
  if (!detail.value) {
    return false;
  }
  if (pickupStep.value === 0) {
    return (
      Boolean(pickupForm.driverName && pickupForm.driverPhone) &&
      pickupForm.identityPhotoUploaded &&
      pickupForm.licensePhotoUploaded &&
      pickupForm.identityMatched &&
      (!pickupForm.marketingNeedVerification ||
        (pickupForm.marketingVerificationResult === "passed"
          ? pickupForm.proofFileCount > 0
          : Boolean(pickupForm.changedMarketingPlan)))
    );
  }
  if (pickupStep.value === 1) {
    if (isMonthly.value) {
      return pickupForm.monthlyBillingConfirmed;
    }
    const preAuthReady =
      pickupForm.preAuthMode === "rent_offset"
        ? pickupForm.preAuthStatus === "captured"
        : pickupForm.preAuthStatus === "frozen" || pickupForm.preAuthStatus === "released";
    return preAuthReady && pickupBalanceDue.value === 0;
  }
  return (
    pickupForm.contractSigned &&
    pickupForm.mileage > 0 &&
    (pickupForm.fuelLevelPercent > 0 || pickupForm.batteryLevelPercent > 0) &&
    pickupForm.photoCount >= 9 &&
    pickupForm.customerSigned
  );
});
const returnFeeTotal = computed(
  () =>
    returnForm.overtimeFeeAmount +
    returnForm.damageFeeAmount +
    returnForm.cleaningFeeAmount -
    returnForm.discountAmount
);
const returnTransactionTotal = computed(() =>
  returnForm.settlementHandled || isMonthly.value ? returnFeeTotal.value : 0
);
const returnBalanceDue = computed(() =>
  isMonthly.value ? 0 : returnFeeTotal.value - returnTransactionTotal.value
);
const canSubmitReturnInspection = computed(() => {
  const pickupMileage = latestPickupInspection.value?.mileage ?? 0;
  return Boolean(
    returnForm.actualReturnAt &&
    returnForm.returnStationName &&
    returnForm.returnMileage >= pickupMileage &&
    (returnForm.fuelLevelPercent > 0 || returnForm.batteryLevelPercent > 0) &&
    returnForm.photoCount >= 9 &&
    returnForm.customerSigned
  );
});
const extensionHours = computed(() => {
  const order = detail.value;
  if (!order || !extensionForm.newReturnAt) {
    return 0;
  }
  const oldReturnAt = new Date(order.returnAt);
  const newReturnAt = new Date(extensionForm.newReturnAt);
  if (!Number.isFinite(oldReturnAt.getTime()) || !Number.isFinite(newReturnAt.getTime())) {
    return 0;
  }

  return Math.max(0, Math.ceil((newReturnAt.getTime() - oldReturnAt.getTime()) / 3_600_000));
});
const extensionBillableDays = computed(() =>
  extensionHours.value > 0 ? Math.max(1, Math.ceil(extensionHours.value / 24)) : 0
);
const extensionAmount = computed(() => {
  const order = detail.value;
  if (!order || extensionHours.value <= 0) {
    return 0;
  }
  const pickupAt = new Date(order.pickupAt);
  const returnAt = new Date(order.returnAt);
  const originalHours = Math.max(
    1,
    Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 3_600_000)
  );
  const originalBillableDays = Math.max(1, Math.ceil(originalHours / 24));
  const rentalAmount = Math.round(order.totalAmount * 0.78);

  return Math.round((rentalAmount / originalBillableDays) * extensionBillableDays.value);
});
const extensionImmediateReasons = computed(() => {
  const order = detail.value;
  if (!order || order.billingMode === BillingMode.Monthly) {
    return [];
  }
  const reasons: string[] = [];
  if (order.mainStatus === OrderMainStatus.Overdue) {
    reasons.push("逾期补办续租");
  }
  if (extensionHours.value > 24) {
    reasons.push("延长时长超过24小时");
  }
  if (extensionAmount.value > 1000) {
    reasons.push("续租金额超过1000元");
  }
  const riskFlags = ["blacklist", "黑名单", "license_issue", "证件异常", "高风险", "人工限制"];
  if (order.riskFlags.some((flag) => riskFlags.includes(flag))) {
    reasons.push("客户存在风险标记");
  }

  return reasons;
});
const extensionConflict = computed(() => {
  const order = detail.value;
  if (!order || !order.plateNo || !extensionForm.newReturnAt || extensionHours.value <= 0) {
    return undefined;
  }
  const oldReturnAt = new Date(order.returnAt);
  const newReturnAt = new Date(extensionForm.newReturnAt);
  const conflictEnd = new Date(newReturnAt.getTime() + 60 * 60_000);
  const occupyStatuses = [
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
  ];

  return extensionRows.value.find((row) => {
    const pickupAt = new Date(row.pickupAt);
    const returnAt = new Date(row.returnAt);
    return (
      row.id !== order.id &&
      row.plateNo === order.plateNo &&
      occupyStatuses.includes(row.mainStatus) &&
      oldReturnAt < returnAt &&
      pickupAt < conflictEnd
    );
  });
});
const extensionLatestReturnAt = computed(() => {
  if (!extensionConflict.value) {
    return "";
  }
  return new Date(new Date(extensionConflict.value.pickupAt).getTime() - 60 * 60_000).toISOString();
});
const canSubmitExtension = computed(() => {
  const order = detail.value;
  if (!order || extensionHours.value <= 0 || extensionAmount.value <= 0 || extensionConflict.value) {
    return false;
  }
  if (!order.plateNo || order.plateNo === "待人工派车") {
    return false;
  }
  if (order.billingMode === BillingMode.Monthly) {
    return true;
  }
  if (extensionImmediateReasons.value.length > 0) {
    return extensionForm.settlementMode === "immediate" && extensionForm.paymentPaid;
  }
  if (extensionForm.settlementMode === "immediate") {
    return extensionForm.paymentPaid;
  }
  return extensionForm.settlementMode === "return_settlement";
});
const terminalPreAuthAmount = computed(() => {
  const order = detail.value;
  if (!order || order.billingMode === BillingMode.Monthly || order.paymentStatus === PaymentStatus.Unpaid) {
    return 0;
  }
  return 2000;
});
const terminalPaidAmount = computed(() => {
  const order = detail.value;
  if (!order || order.billingMode === BillingMode.Monthly) {
    return 0;
  }
  return order.transactionRecords
    .filter((item) => item.status === "success" && item.type === "payment")
    .reduce((total, item) => total + item.amount, 0);
});
const hoursBeforePickup = computed(() => {
  const order = detail.value;
  if (!order) {
    return 0;
  }
  const pickupAt = new Date(order.pickupAt);
  if (!Number.isFinite(pickupAt.getTime())) {
    return 0;
  }
  return (pickupAt.getTime() - Date.now()) / 3_600_000;
});
const cancelOriginalFee = computed(() => {
  const order = detail.value;
  if (!order || order.mainStatus === OrderMainStatus.PendingPayment || hoursBeforePickup.value >= 24) {
    return 0;
  }
  const baseAmount = order.billingMode === BillingMode.Monthly ? order.totalAmount : terminalPreAuthAmount.value;
  if (hoursBeforePickup.value >= 12) {
    return Math.round(baseAmount * 0.2);
  }
  if (hoursBeforePickup.value >= 2) {
    return Math.round(baseAmount * 0.5);
  }
  return Math.round(baseAmount);
});
const cancelFeeAmount = computed(() =>
  terminationForm.specialWaiver ? 0 : cancelOriginalFee.value
);
const cancelTypeLabel = computed(() =>
  cancelOriginalFee.value > 0 ? "有责取消" : "免责取消"
);
const cancelRefundAmount = computed(() => Math.max(0, terminalPaidAmount.value));
const noShowFeeAmount = computed(() => 200);
const noShowPaymentDue = computed(() =>
  Math.max(0, noShowFeeAmount.value - terminalPreAuthAmount.value)
);
const rejectionPaymentDue = computed(() =>
  Math.max(0, terminationForm.rejectionFeeAmount - terminalPreAuthAmount.value)
);
const closeRefundAmount = computed(() => terminalPaidAmount.value);
const canSubmitTermination = computed(() => {
  if (pendingTerminationAction.value === "mark-no-show") {
    return Boolean(terminationForm.contactResult);
  }
  if (pendingTerminationAction.value === "close-order") {
    return Boolean(terminationForm.reason && terminationForm.customerCommunicationConfirmed);
  }
  return Boolean(terminationForm.reason);
});
const canSubmitAccident = computed(() =>
  Boolean(
    detail.value &&
      accidentForm.description.trim() &&
      accidentForm.accidentAt &&
      accidentForm.responsibility
  )
);
const accidentContextHint = computed(() => {
  const order = detail.value;
  if (!order) {
    return {
      title: "事故登记",
      status: "-",
      fee: "-",
      desc: "保存后写入事故记录、履约事件和费用审计。"
    };
  }
  const activeStatuses = [
    OrderMainStatus.Renting,
    OrderMainStatus.Renewing,
    OrderMainStatus.Overdue
  ];
  const settlementStatuses = [
    OrderMainStatus.SettlementPending,
    OrderMainStatus.PaymentDue,
    OrderMainStatus.RefundPending
  ];
  if (activeStatuses.includes(order.mainStatus)) {
    return {
      title: "履约中登记事故后，订单进入出险处理中",
      status: "进入出险处理中",
      fee: order.billingMode === BillingMode.Monthly ? "企业月结" : "还车结算",
      desc: "车辆仍可继续办理还车，事故费用、责任归属和处理状态会进入履约事件和费用中心。"
    };
  }
  if (order.mainStatus === OrderMainStatus.AccidentProcessing) {
    return {
      title: "出险处理中可追加事故进度和费用",
      status: "保持出险处理中",
      fee: order.billingMode === BillingMode.Monthly ? "企业月结" : "还车结算",
      desc: "追加记录不会关闭事故流程，客户还车后事故费用纳入结算。"
    };
  }
  if (settlementStatuses.includes(order.mainStatus)) {
    return {
      title: "结算中登记事故，订单保持当前结算状态",
      status: "保持当前状态",
      fee: order.billingMode === BillingMode.Monthly ? "企业月结" : "费用中心",
      desc: "事故费用参与还车账单；费用未确认时，订单可停留在待结算继续处理。"
    };
  }
  return {
    title: "已完成订单补录事故，主状态保持已完成",
    status: "保持已完成",
    fee: order.billingMode === BillingMode.Monthly ? "月结挂账" : "完成后追缴",
    desc: "保存后生成事故记录和追缴费用，订单主状态不回退。"
  };
});
const currentRedirectionVehicle = computed(() =>
  redirectionVehicles.value.find((item) => item.licensePlate === detail.value?.plateNo)
);
const redirectionGroupNames = computed(() =>
  Array.from(
    new Set(redirectionVehicles.value.map((item) => item.vehicleGroupName).filter(Boolean))
  )
);
const availableRedirectionVehicles = computed(() =>
  redirectionVehicles.value.filter((vehicle) => {
    const notCurrent = vehicle.licensePlate !== detail.value?.plateNo;
    const usable = vehicle.enabled && vehicle.operationStatus === "idle";
    const groupMatched =
      !redirectionForm.vehicleGroupName ||
      vehicle.vehicleGroupName === redirectionForm.vehicleGroupName;
    const sameCompany =
      !currentRedirectionVehicle.value?.assetCompanyName ||
      !vehicle.assetCompanyName ||
      currentRedirectionVehicle.value.assetCompanyName === vehicle.assetCompanyName;
    return notCurrent && usable && groupMatched && sameCompany;
  })
);
const recommendedRedirectionVehicles = computed(() => {
  const order = detail.value;
  if (!order) {
    return [];
  }
  return availableRedirectionVehicles.value
    .map((vehicle) => ({
      vehicle,
      score:
        (redirectionSameGroup(vehicle.vehicleGroupName) ? 3 : 0) +
        (vehicle.currentStoreName === order.pickupStoreName ? 2 : 0) +
        (vehicle.currentStoreName === order.returnStoreName ? 1 : 0)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.vehicle);
});
const selectedRedirectionVehicle = computed(() =>
  redirectionVehicles.value.find((item) => item.id === redirectionForm.targetVehicleId)
);
const isMidRentalRedirection = computed(() =>
  Boolean(
    detail.value &&
      [
        OrderMainStatus.Renting,
        OrderMainStatus.Renewing,
        OrderMainStatus.Overdue,
        OrderMainStatus.AccidentProcessing
      ].includes(detail.value.mainStatus)
  )
);
const redirectionRawDiff = computed(() => {
  const order = detail.value;
  const vehicle = selectedRedirectionVehicle.value;
  if (!order || !vehicle) {
    return 0;
  }
  if (redirectionSameGroup(vehicle.vehicleGroupName)) {
    return 0;
  }
  const oldAmount = redirectionPeriodAmount(order.vehicleGroupName);
  const newAmount = redirectionPeriodAmount(vehicle.vehicleGroupName);
  return Math.round(newAmount - oldAmount);
});
const redirectionActualDiff = computed(() =>
  redirectionForm.priceHandling === "free" && redirectionRawDiff.value > 0
    ? 0
    : redirectionRawDiff.value
);
const redirectionSettlementText = computed(() => {
  if (isMonthly.value) {
    return "企业月结";
  }
  return isMidRentalRedirection.value ? "还车结算" : "取车尾款";
});
const canSubmitRedirection = computed(() => {
  if (!detail.value || !selectedRedirectionVehicle.value || !redirectionForm.reason) {
    return false;
  }
  if (redirectionForm.reason === "other" && !redirectionForm.memo.trim()) {
    return false;
  }
  if (redirectionForm.priceHandling === "free") {
    return redirectionRawDiff.value > 0 && Boolean(redirectionForm.memo.trim());
  }
  return true;
});
const enabledReturnLocationStations = computed(() =>
  returnLocationStations.value.filter(
    (station) => station.status === "enabled" && station.serviceStatus === "normal"
  )
);
const returnStoreOptions = computed(() =>
  Array.from(
    new Set(
      enabledReturnLocationStations.value
        .filter((station) => station.storeRentalEnabled)
        .map((station) => station.parentStoreName)
    )
  )
);
const returnStationOptions = computed(() =>
  Array.from(
    new Set(enabledReturnLocationStations.value.map((station) => station.parentStoreName))
  ).map((storeName) => ({
    label: storeName,
    value: storeName,
    children: enabledReturnLocationStations.value
      .filter((station) => station.parentStoreName === storeName)
      .map((station) => ({
        label: station.name,
        value: station.id
      }))
  }))
);
const selectedReturnStation = computed(() => {
  const stationId = returnLocationForm.targetStationPath[1];
  return returnLocationStations.value.find((station) => station.id === stationId);
});
const targetReturnStoreName = computed(() =>
  returnLocationMode.value === "store"
    ? returnLocationForm.targetStoreName
    : selectedReturnStation.value?.parentStoreName ?? ""
);
const targetReturnStationName = computed(() =>
  returnLocationMode.value === "store"
    ? returnLocationStations.value.find(
        (station) => station.parentStoreName === returnLocationForm.targetStoreName
      )?.name
    : selectedReturnStation.value?.name
);
const returnLocationCurrentFee = computed(() => {
  const order = detail.value;
  if (!order) {
    return 0;
  }
  return oneWayReturnFee(order.pickupStoreName, order.returnStoreName);
});
const returnLocationNewFee = computed(() => {
  const order = detail.value;
  if (!order || !targetReturnStoreName.value) {
    return 0;
  }
  return oneWayReturnFee(order.pickupStoreName, targetReturnStoreName.value);
});
const returnLocationFeeDelta = computed(() =>
  Math.round(returnLocationNewFee.value - returnLocationCurrentFee.value)
);
const returnLocationFeeAbs = computed(() => Math.abs(returnLocationFeeDelta.value));
const returnLocationConflictOrder = computed(() => {
  const order = detail.value;
  if (!order || !order.plateNo || targetReturnStoreName.value === order.returnStoreName) {
    return undefined;
  }
  const returnAt = new Date(order.returnAt).getTime();
  return returnLocationOrders.value
    .filter((item) => item.id !== order.id)
    .filter((item) => item.plateNo === order.plateNo)
    .filter((item) => item.pickupStoreName === order.returnStoreName)
    .filter((item) =>
      [
        OrderMainStatus.Reserved,
        OrderMainStatus.PickupOverdue,
        OrderMainStatus.Inspecting
      ].includes(item.mainStatus)
    )
    .filter((item) => new Date(item.pickupAt).getTime() >= returnAt)
    .sort(
      (left, right) =>
        new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime()
    )[0];
});
const quickRedirectCandidate = computed(() => {
  const conflict = returnLocationConflictOrder.value;
  if (!conflict) {
    return undefined;
  }
  const requiredServiceType =
    conflict.mode === StoreRentalMode.SelfService24h ? "STORE_24H" : "STORE_STANDARD";
  return returnLocationVehicles.value
    .filter((vehicle) => vehicle.licensePlate !== conflict.plateNo)
    .filter((vehicle) => vehicle.enabled && vehicle.operationStatus === "idle")
    .filter((vehicle) => vehicle.serviceTypes.includes(requiredServiceType))
    .filter((vehicle) => vehicle.vehicleGroupName === conflict.vehicleGroupName)
    .map((vehicle) => ({
      vehicle,
      score:
        100 +
        (vehicle.currentStoreName === conflict.pickupStoreName ? 30 : 0) +
        (vehicle.currentServiceType === requiredServiceType ? 10 : 0)
    }))
    .sort((left, right) => right.score - left.score)[0]?.vehicle;
});
const returnLocationConflict = computed(() => ({
  checked: Boolean(targetReturnStoreName.value),
  hasConflict: Boolean(returnLocationConflictOrder.value),
  resolved: returnLocationConflictResolved.value,
  order: returnLocationConflictOrder.value,
  targetVehicle: quickRedirectCandidate.value
}));
const canSubmitReturnLocationChange = computed(() => {
  const order = detail.value;
  if (!order || !returnLocationForm.reason || !targetReturnStoreName.value) {
    return false;
  }
  if (returnLocationForm.reason === "other" && !returnLocationForm.memo.trim()) {
    return false;
  }
  if (returnLocationMode.value === "store") {
    return (
      targetReturnStoreName.value !== order.returnStoreName &&
      (!returnLocationConflict.value.hasConflict || returnLocationConflict.value.resolved)
    );
  }
  return (
    (targetReturnStoreName.value !== order.returnStoreName ||
      targetReturnStationName.value !== order.returnStationName) &&
    (!returnLocationConflict.value.hasConflict || returnLocationConflict.value.resolved)
  );
});
const canManageOrderFees = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:order:settle",
    "store-rental:order:fee-manage"
  ])
);
const pickupReturnRows = computed(() => {
  const order = detail.value;
  if (!order) {
    return [];
  }
  const pickupRecord = order.inspectionRecords.find((item) => item.stage === "pickup");
  const returnRecord = order.inspectionRecords.find((item) => item.stage === "return");

  return [
    {
      type: "取车",
      time: pickupRecord?.at ?? order.pickupAt,
      store: order.pickupStoreName,
      mileage: pickupRecord?.mileage ?? "-",
      energy:
        pickupRecord?.batteryLevelPercent ?? pickupRecord?.fuelLevelPercent ?? "-",
      photos: pickupRecord?.photoCount ?? 0,
      signed: pickupRecord?.customerSigned ?? false,
      operator: pickupRecord?.operator ?? "-"
    },
    {
      type: "还车",
      time: returnRecord?.at ?? order.returnAt,
      store: order.returnStoreName,
      mileage: returnRecord?.mileage ?? "-",
      energy:
        returnRecord?.batteryLevelPercent ?? returnRecord?.fuelLevelPercent ?? "-",
      photos: returnRecord?.photoCount ?? 0,
      signed: returnRecord?.customerSigned ?? false,
      operator: returnRecord?.operator ?? "-"
    }
  ];
});
const feeAuditRows = computed(() => {
  const order = detail.value;
  if (!order) {
    return [];
  }
  const feeRows = order.feeLedgerItems.map((item, index) => ({
    id: `fee_audit_${item.id}`,
    at: item.createdAt,
    action: item.source === "system" ? "系统生成" : "人工录入",
    detail: `${item.name} ${formatMoney(item.amount)}，状态：${feeStatusLabel(item.status)}`,
    operator: item.source === "system" ? "规则引擎" : "门店营运",
    order: index
  }));
  const transactionRows = order.transactionRecords.map((item, index) => ({
    id: `txn_audit_${item.id}`,
    at: item.at,
    action: transactionTypeLabel(item.type),
    detail: `${transactionChannelLabel(item.channel)} ${formatMoney(item.amount)}，${transactionStatusLabel(item.status)}`,
    operator: item.operator,
    order: index + 100
  }));

  return [...feeRows, ...transactionRows].sort((left, right) => left.order - right.order);
});

const invoiceDocuments = computed(() => {
  const order = detail.value;
  if (!order) {
    return [];
  }
  return financeDocuments.value.filter(
    (doc) => doc.orderId === order.id || doc.orderNo === order.orderNo
  );
});

async function loadDetail() {
  if (!orderId.value) {
    return;
  }
  loading.value = true;
  try {
    const [orderData, documentsData] = await Promise.all([
      getStoreRentalOrder(orderId.value),
      listFinanceDocuments()
    ]);
    detail.value = orderData;
    financeDocuments.value = documentsData;
  } catch {
    ElMessage.error("订单详情加载失败");
  } finally {
    loading.value = false;
  }
}

function goBack() {
  void router.push("/orders");
}

async function openExtendDialog() {
  const order = detail.value;
  if (!order) {
    return;
  }
  const nextReturnAt = new Date(new Date(order.returnAt).getTime() + 24 * 3_600_000);
  Object.assign(extensionForm, {
    newReturnAt: nextReturnAt.toISOString(),
    settlementMode:
      order.billingMode === BillingMode.Monthly
        ? "monthly"
        : order.mainStatus === OrderMainStatus.Overdue
          ? "immediate"
          : "return_settlement",
    paymentPaid: false,
    operator: "营运端",
    memo: ""
  });
  extendDialogVisible.value = true;
  try {
    extensionRows.value = await listStoreRentalOrders();
  } catch {
    extensionRows.value = [order];
  }
}

async function openRedirectionDialog() {
  const order = detail.value;
  if (!order) {
    return;
  }
  redirectionLoading.value = true;
  try {
    const [vehicles, groups] = await Promise.all([listVehicles(), listVehicleGroups()]);
    redirectionVehicles.value = vehicles;
    redirectionGroups.value = groups;
    Object.assign(redirectionForm, {
      selectionMode: "manual",
      vehicleGroupName: order.vehicleGroupName,
      targetVehicleId: "",
      reason: "",
      priceHandling: "diff",
      managerOverride: false,
      operator: "营运端",
      memo: ""
    });
    redirectionDialogVisible.value = true;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "改派候选车辆加载失败"));
  } finally {
    redirectionLoading.value = false;
  }
}

async function openReturnLocationDialog(mode: "store" | "station") {
  const order = detail.value;
  if (!order) {
    return;
  }
  returnLocationMode.value = mode;
  returnLocationLoading.value = true;
  try {
    const [stations, orders, vehicles] = await Promise.all([
      listStations(),
      listStoreRentalOrders(),
      listVehicles()
    ]);
    returnLocationStations.value = stations;
    returnLocationOrders.value = orders;
    returnLocationVehicles.value = vehicles;
    const fallbackStore = stations.find(
      (station) =>
        station.parentStoreName !== order.returnStoreName &&
        station.status === "enabled" &&
        station.serviceStatus === "normal"
    );
    const fallbackStation = stations.find(
      (station) =>
        (station.parentStoreName !== order.returnStoreName ||
          station.name !== order.returnStationName) &&
        station.status === "enabled" &&
        station.serviceStatus === "normal"
    );
    Object.assign(returnLocationForm, {
      targetStoreName: mode === "store" ? fallbackStore?.parentStoreName ?? "" : "",
      targetStationPath:
        mode === "station" && fallbackStation
          ? [fallbackStation.parentStoreName, fallbackStation.id]
          : [],
      reason: "",
      operator: "营运端",
      memo: ""
    });
    returnLocationConflictResolved.value = false;
    returnLocationDialogVisible.value = true;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "还车地点候选加载失败"));
  } finally {
    returnLocationLoading.value = false;
  }
}

async function submitReturnLocationChange() {
  const order = detail.value;
  if (!order || !canSubmitReturnLocationChange.value) {
    return;
  }
  const action =
    returnLocationMode.value === "store"
      ? "change-return-store"
      : "change-return-station";
  actionLoading.value = action;
  try {
    const result = await runStoreRentalOrderAction(order.id, action, {
      targetStoreName: targetReturnStoreName.value,
      targetStationId: selectedReturnStation.value?.id,
      targetStationName: targetReturnStationName.value,
      reason: returnLocationForm.reason,
      resolveFollowupConflict:
        returnLocationConflict.value.hasConflict && returnLocationConflict.value.resolved,
      followupConflictOrderId: returnLocationConflict.value.order?.id,
      followupTargetVehicleId: returnLocationConflict.value.targetVehicle?.id,
      followupTargetPlateNo: returnLocationConflict.value.targetVehicle?.licensePlate,
      operator: returnLocationForm.operator,
      memo: returnLocationForm.memo,
      source: "order-detail-page"
    });
    ElMessage.success(result.message);
    returnLocationDialogVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "改还车地点失败"));
  } finally {
    actionLoading.value = "";
  }
}

function resetReturnLocationConflict() {
  returnLocationConflictResolved.value = false;
}

function quickRedirectReturnLocationConflict() {
  const conflict = returnLocationConflict.value;
  if (!conflict.hasConflict || !conflict.order) {
    return;
  }
  if (!conflict.targetVehicle) {
    ElMessage.warning("暂无可快捷改派的同组或可升级空闲车辆，请先到调度页人工处理。");
    return;
  }
  returnLocationConflictResolved.value = true;
  ElMessage.success(
    `已选择 ${conflict.targetVehicle.licensePlate} 作为后续订单 ${conflict.order.orderNo} 的快捷改派车辆，确认转单时一并提交。`
  );
}

function selectRedirectionVehicle(vehicle: VehicleInstanceSummary) {
  redirectionForm.targetVehicleId = vehicle.id;
  redirectionForm.vehicleGroupName = vehicle.vehicleGroupName;
}

function redirectionSameGroup(vehicleGroupName: string) {
  const order = detail.value;
  if (!order) {
    return false;
  }
  const left = findRedirectionGroup(order.vehicleGroupName);
  const right = findRedirectionGroup(vehicleGroupName);
  if (left && right) {
    return left.id === right.id;
  }
  return (
    order.vehicleGroupName === vehicleGroupName ||
    order.vehicleGroupName.split(" / ")[0] === vehicleGroupName.split(" / ")[0]
  );
}

function findRedirectionGroup(vehicleGroupName: string) {
  return redirectionGroups.value.find(
    (group) =>
      vehicleGroupName === group.storeProductGroupName ||
      vehicleGroupName.includes(group.storeProductGroupName) ||
      vehicleGroupName.includes(group.brand) ||
      vehicleGroupName.includes(group.model)
  );
}

function redirectionDailyPrice(vehicleGroupName: string) {
  const order = detail.value;
  const group = findRedirectionGroup(vehicleGroupName);
  if (group?.dailyPrice) {
    return group.dailyPrice;
  }
  if (!order) {
    return 0;
  }
  const hours = Math.max(
    1,
    Math.ceil((new Date(order.returnAt).getTime() - new Date(order.pickupAt).getTime()) / 3_600_000)
  );
  return Math.round(order.totalAmount / Math.max(1, Math.ceil(hours / 24)));
}

function redirectionPeriodAmount(vehicleGroupName: string) {
  const order = detail.value;
  if (!order) {
    return 0;
  }
  const startAt = isMidRentalRedirection.value ? new Date() : new Date(order.pickupAt);
  const endAt = new Date(order.returnAt);
  const hours = Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / 3_600_000));
  const billableRatio = hours < 5 ? hours / 5 : Math.max(1, Math.ceil(hours / 24));
  return Math.round(redirectionDailyPrice(vehicleGroupName) * billableRatio);
}

function oneWayReturnFee(pickupStoreName: string, returnStoreName: string) {
  if (!pickupStoreName || !returnStoreName || pickupStoreName === returnStoreName) {
    return 0;
  }
  const pickupStoreCode = storeCodeByName(pickupStoreName);
  const returnStoreCode = storeCodeByName(returnStoreName);
  if (pickupStoreCode === "CENTRAL" && returnStoreCode === "AIRPORT") {
    return 180;
  }
  return 180;
}

function storeCodeByName(storeName: string) {
  const station = returnLocationStations.value.find(
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

const orderActionPermissionMap: Record<string, string[]> = {
  "payment-success": ["store-rental:order:operate", "store-rental:order:pickup"],
  "start-pickup": ["store-rental:order:operate", "store-rental:order:pickup"],
  "pickup-inspection": ["store-rental:order:operate", "store-rental:order:pickup"],
  "return-inspection": ["store-rental:order:operate", "store-rental:order:return"],
  "extend-rental": ["store-rental:order:operate", "store-rental:order:extend"],
  "redirect-order": ["store-rental:order:operate", "store-rental:dispatch:manage"],
  "change-return-store": ["store-rental:order:operate", "store-rental:dispatch:manage"],
  "change-return-station": ["store-rental:order:operate", "store-rental:dispatch:manage"],
  "confirm-settlement": ["store-rental:order:settle"],
  "release-operation-lock": ["store-rental:order:operate", "store-rental:order:pickup"],
  "register-accident": [
    "store-rental:order:operate",
    "store-rental:vehicle:status-action"
  ],
  "mark-no-show": ["store-rental:order:operate", "store-rental:order:cancel"],
  cancel: ["store-rental:order:operate", "store-rental:order:cancel"],
  "reject-order": ["store-rental:order:operate", "store-rental:order:close"],
  "close-order": ["store-rental:order:operate", "store-rental:order:close"]
};

function canRunOrderAction(action: string) {
  return authStore.hasAnyPermission(
    orderActionPermissionMap[action] ?? ["store-rental:order:operate"]
  );
}

function availableActions(row: StoreRentalOrderSummary) {
  let actions: string[] = [];
  const returnLocationAction =
    row.mode === StoreRentalMode.SelfService24h
      ? "change-return-station"
      : "change-return-store";
  if (row.mainStatus === OrderMainStatus.PendingPayment) {
    actions = ["payment-success", "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.Reserved) {
    actions = ["start-pickup", "redirect-order", returnLocationAction, "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.PickupOverdue) {
    actions = ["start-pickup", "redirect-order", returnLocationAction, "mark-no-show", "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.Inspecting) {
    actions = ["pickup-inspection", "redirect-order", returnLocationAction];
    return actions.filter(canRunOrderAction);
  }
  if (
    row.mainStatus === OrderMainStatus.Renting ||
    row.mainStatus === OrderMainStatus.Renewing ||
    row.mainStatus === OrderMainStatus.Overdue
  ) {
    actions = ["extend-rental", "redirect-order", returnLocationAction, "return-inspection"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.AccidentProcessing) {
    actions = ["redirect-order", returnLocationAction, "return-inspection"];
    return actions.filter(canRunOrderAction);
  }
  if (
    row.mainStatus === OrderMainStatus.SettlementPending ||
    row.mainStatus === OrderMainStatus.PaymentDue ||
    row.mainStatus === OrderMainStatus.RefundPending
  ) {
    actions = ["confirm-settlement"];
    return actions.filter(canRunOrderAction);
  }
  return [];
}

function isTerminationAction(action: string): action is TerminationAction {
  return ["cancel", "mark-no-show", "reject-order", "close-order"].includes(action);
}

function primaryActions(row: StoreRentalOrderSummary) {
  return availableActions(row).filter((action) => !isTerminationAction(action));
}

function moreActions(row: StoreRentalOrderSummary) {
  const actions: MoreAction[] = [];
  if (
    [
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue,
      OrderMainStatus.AccidentProcessing,
      OrderMainStatus.SettlementPending,
      OrderMainStatus.PaymentDue,
      OrderMainStatus.RefundPending,
      OrderMainStatus.Completed
    ].includes(row.mainStatus)
  ) {
    actions.push("register-accident");
  }
  if (
    [
      OrderMainStatus.PendingPayment,
      OrderMainStatus.Reserved,
      OrderMainStatus.PickupOverdue
    ].includes(row.mainStatus)
  ) {
    actions.push("cancel");
  }
  if (row.mainStatus === OrderMainStatus.PickupOverdue) {
    actions.push("mark-no-show");
  }
  if (row.mainStatus === OrderMainStatus.Inspecting) {
    actions.push("reject-order");
  }
  if (
    [
      OrderMainStatus.PendingPayment,
      OrderMainStatus.Reserved,
      OrderMainStatus.PickupOverdue,
      OrderMainStatus.Inspecting,
      OrderMainStatus.Renting,
      OrderMainStatus.Renewing,
      OrderMainStatus.Overdue,
      OrderMainStatus.AccidentProcessing
    ].includes(row.mainStatus)
  ) {
    actions.push("close-order");
  }
  return actions.filter(canRunOrderAction);
}

function handleMoreCommand(command: unknown) {
  const action = String(command);
  if (action === "register-accident") {
    void runAction(action);
    return;
  }
  if (isTerminationAction(action)) {
    void runAction(action);
    return;
  }
  if (action === "订单备注") {
    openRemarkDialog();
    return;
  }
  if (action === "打印单据") {
    openContractDialog("settlement_sheet");
    return;
  }
  showReservedFeeAction(action);
}

function nowInputValue() {
  return new Date().toISOString().slice(0, 16);
}

function resetPickupWizard(order: StoreRentalOrderDetail) {
  Object.assign(pickupForm, {
    driverName: order.customerName,
    driverPhone: order.customerPhoneMasked,
    identityNoMasked: "A123****",
    licenseValidUntil: "2027-12-31",
    identityPhotoUploaded: true,
    licensePhotoUploaded: true,
    identityMatched: false,
    riskChecked: true,
    originalMarketingPlan: "订单创建时行销方案",
    marketingNeedVerification: false,
    marketingVerificationResult: "passed",
    proofFileCount: 0,
    changedMarketingPlan: "",
    marketingVerificationReason: "",
    preAuthMode: "performance_guarantee",
    preAuthStatus: order.billingMode === BillingMode.Monthly ? "released" : "frozen",
    preAuthAmount: Math.max(terminalPreAuthAmount.value, 2000),
    pickupCollectedAmount: order.billingMode === BillingMode.Monthly ? 0 : order.totalAmount,
    balancePaid: order.billingMode !== BillingMode.Monthly,
    monthlyBillingConfirmed: order.billingMode === BillingMode.Monthly,
    contractSigned: false,
    signMethod: "counter",
    signerName: order.customerName,
    actualPickupAt: nowInputValue(),
    mileage: latestPickupInspection.value?.mileage ?? 12050,
    fuelLevelPercent: 80,
    batteryLevelPercent: order.vehicleGroupName.toLowerCase().includes("tesla") ? 80 : 0,
    vehicleStationName: order.pickupStationName || order.pickupStoreName,
    deliveryLocation: "门市交付区",
    photoCount: 9,
    damageFound: false,
    damageDescription: "",
    customerSigned: false,
    operator: "营运端",
    memo: ""
  });
  pickupStep.value = 0;
}

async function openPickupWizard(action: "start-pickup" | "pickup-inspection") {
  let order = detail.value;
  if (!order) {
    return;
  }
  if (action === "start-pickup") {
    actionLoading.value = "start-pickup";
    try {
      const result = await runStoreRentalOrderAction(order.id, "start-pickup", {
        operator: "营运端",
        source: "order-detail-pickup-wizard",
        idempotencyKey: `start-pickup-${order.id}-${Date.now()}`
      });
      ElMessage.success(result.message);
      await loadDetail();
      order = detail.value;
    } catch (error) {
      ElMessage.error(readErrorMessage(error, "取车操作锁创建失败"));
      return;
    } finally {
      actionLoading.value = "";
    }
  }
  if (!order) {
    return;
  }
  resetPickupWizard(order);
  pickupWizardVisible.value = true;
}

function nextPickupStep() {
  if (!canContinuePickupStep.value) {
    ElMessage.warning("请先补齐当前步骤必填项。");
    return;
  }
  pickupStep.value += 1;
}

async function submitPickupWizard() {
  const order = detail.value;
  if (!order || !canContinuePickupStep.value) {
    ElMessage.warning("请先补齐合约、验车照片和客户签字。");
    return;
  }
  pickupSubmitting.value = true;
  actionLoading.value = "pickup-inspection";
  try {
    const result = await runStoreRentalOrderAction(order.id, "pickup-inspection", {
      operator: pickupForm.operator,
      source: "order-detail-pickup-wizard",
      idempotencyKey: `pickup-inspection-${order.id}-${Date.now()}`,
      driverName: pickupForm.driverName,
      driverPhone: pickupForm.driverPhone,
      identityNoMasked: pickupForm.identityNoMasked,
      licenseValidUntil: pickupForm.licenseValidUntil,
      identityMatched: pickupForm.identityMatched,
      riskChecked: pickupForm.riskChecked,
      originalMarketingPlan: pickupForm.originalMarketingPlan,
      marketingVerificationResult: pickupForm.marketingVerificationResult,
      proofFileCount: pickupForm.proofFileCount,
      changedMarketingPlan: pickupForm.changedMarketingPlan,
      marketingVerificationReason: pickupForm.marketingVerificationReason,
      preAuthMode: pickupForm.preAuthMode,
      preAuthStatus: pickupForm.preAuthStatus,
      preAuthAmount: pickupForm.preAuthAmount,
      pickupBalanceDue: pickupBalanceDue.value,
      balancePaid: pickupForm.balancePaid,
      monthlyBillingConfirmed: pickupForm.monthlyBillingConfirmed,
      contractSigned: pickupForm.contractSigned,
      signMethod: pickupForm.signMethod,
      signerName: pickupForm.signerName,
      plateNo: order.plateNo,
      actualPickupAt: pickupForm.actualPickupAt,
      mileage: pickupForm.mileage,
      fuelLevelPercent: pickupForm.fuelLevelPercent,
      batteryLevelPercent: pickupForm.batteryLevelPercent,
      vehicleStationName: pickupForm.vehicleStationName,
      deliveryLocation: pickupForm.deliveryLocation,
      photoCount: pickupForm.photoCount,
      damageFound: pickupForm.damageFound,
      damageDescription: pickupForm.damageDescription,
      customerSigned: pickupForm.customerSigned,
      memo: pickupForm.memo
    });
    ElMessage.success(result.message);
    pickupWizardVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "确认发车失败"));
  } finally {
    pickupSubmitting.value = false;
    actionLoading.value = "";
  }
}

function resetReturnWizard(order: StoreRentalOrderDetail, step = 0) {
  Object.assign(returnForm, {
    actualReturnAt: nowInputValue(),
    returnStationName: order.returnStationName || order.returnStoreName,
    parkingFloor: "B2",
    parkingSpaceNo: "",
    parkingPhotoCount: 1,
    returnMileage: Math.max((latestPickupInspection.value?.mileage ?? 12050) + 120, 1),
    fuelLevelPercent: 70,
    batteryLevelPercent: order.vehicleGroupName.toLowerCase().includes("tesla") ? 70 : 0,
    cleanliness: "normal",
    damageFound: false,
    damageDescription: "",
    missingItems: "",
    photoCount: 9,
    customerSigned: false,
    overtimeFeeAmount: order.settlementSummary.overtimeFeeAmount,
    damageFeeAmount: order.settlementSummary.damageFeeAmount,
    cleaningFeeAmount: order.settlementSummary.cleaningFeeAmount,
    discountAmount: order.settlementSummary.discountAmount,
    settlementHandled: [OrderMainStatus.PaymentDue, OrderMainStatus.RefundPending].includes(order.mainStatus),
    monthlyBillingPosted: order.billingMode === BillingMode.Monthly,
    operator: "营运端",
    memo: ""
  });
  returnStep.value = step;
}

function openReturnWizard(action: "return-inspection" | "confirm-settlement") {
  const order = detail.value;
  if (!order) {
    return;
  }
  resetReturnWizard(order, action === "confirm-settlement" ? 1 : 0);
  returnWizardVisible.value = true;
}

async function submitReturnInspection() {
  const order = detail.value;
  if (!order || !canSubmitReturnInspection.value) {
    ElMessage.warning("请先补齐还车验车、照片和客户签字。");
    return;
  }
  returnSubmitting.value = true;
  actionLoading.value = "return-inspection";
  try {
    const result = await runStoreRentalOrderAction(order.id, "return-inspection", {
      operator: returnForm.operator,
      source: "order-detail-return-wizard",
      idempotencyKey: `return-inspection-${order.id}-${Date.now()}`,
      actualReturnAt: returnForm.actualReturnAt,
      returnStationName: returnForm.returnStationName,
      parkingFloor: returnForm.parkingFloor,
      parkingSpaceNo: returnForm.parkingSpaceNo,
      parkingPhotoCount: returnForm.parkingPhotoCount,
      pickupMileage: latestPickupInspection.value?.mileage,
      returnMileage: returnForm.returnMileage,
      fuelLevelPercent: returnForm.fuelLevelPercent,
      batteryLevelPercent: returnForm.batteryLevelPercent,
      cleanliness: returnForm.cleanliness,
      damageFound: returnForm.damageFound,
      damageDescription: returnForm.damageDescription,
      missingItems: returnForm.missingItems,
      photoCount: returnForm.photoCount,
      customerSigned: returnForm.customerSigned,
      overtimeFeeAmount: returnForm.overtimeFeeAmount,
      damageFeeAmount: returnForm.damageFeeAmount,
      cleaningFeeAmount: returnForm.cleaningFeeAmount,
      discountAmount: returnForm.discountAmount,
      finalReceivableAmount: returnFeeTotal.value,
      returnTransactionTotal: 0,
      memo: returnForm.memo
    });
    ElMessage.success(result.message);
    await loadDetail();
    returnStep.value = 1;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "提交还车验车失败"));
  } finally {
    returnSubmitting.value = false;
    actionLoading.value = "";
  }
}

async function submitReturnSettlement() {
  const order = detail.value;
  if (!order) {
    return;
  }
  returnSubmitting.value = true;
  actionLoading.value = "confirm-settlement";
  try {
    const result = await runStoreRentalOrderAction(order.id, "confirm-settlement", {
      operator: returnForm.operator,
      source: "order-detail-return-wizard",
      idempotencyKey: `confirm-settlement-${order.id}-${Date.now()}`,
      overtimeFeeAmount: returnForm.overtimeFeeAmount,
      damageFeeAmount: returnForm.damageFeeAmount,
      cleaningFeeAmount: returnForm.cleaningFeeAmount,
      discountAmount: returnForm.discountAmount,
      finalReceivableAmount: returnFeeTotal.value,
      returnTransactionTotal: returnTransactionTotal.value,
      monthlyBillingPosted: isMonthly.value || returnForm.monthlyBillingPosted,
      memo: returnForm.memo
    });
    ElMessage.success(result.message);
    await loadDetail();
    returnStep.value = 2;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "确认还车结算失败"));
  } finally {
    returnSubmitting.value = false;
    actionLoading.value = "";
  }
}

async function releasePickupOperationLock() {
  const order = detail.value;
  if (!order) {
    return;
  }
  actionLoading.value = "release-operation-lock";
  try {
    const result = await runStoreRentalOrderAction(order.id, "release-operation-lock", {
      operator: "营运端",
      reason: "操作锁超时或店长释放",
      memo: "释放取车锁并作废取车草稿",
      source: "order-detail-lock-panel",
      idempotencyKey: `release-lock-${order.id}-${Date.now()}`
    });
    ElMessage.success(result.message);
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "释放操作锁失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function runAction(action: string) {
  const order = detail.value;
  if (!order) {
    return;
  }
  if (action === "start-pickup" || action === "pickup-inspection") {
    await openPickupWizard(action);
    return;
  }
  if (action === "return-inspection" || action === "confirm-settlement") {
    openReturnWizard(action);
    return;
  }
  if (action === "extend-rental") {
    await openExtendDialog();
    return;
  }
  if (action === "redirect-order") {
    await openRedirectionDialog();
    return;
  }
  if (action === "change-return-store") {
    await openReturnLocationDialog("store");
    return;
  }
  if (action === "change-return-station") {
    await openReturnLocationDialog("station");
    return;
  }
  if (action === "register-accident") {
    openAccidentDialog();
    return;
  }
  if (isTerminationAction(action)) {
    openTerminationDialog(action);
    return;
  }
  actionLoading.value = action;
  try {
    const payload = defaultActionPayload(order, action);
    const result = await runStoreRentalOrderAction(order.id, action, payload);
    ElMessage.success(result.message);
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单操作失败"));
  } finally {
    actionLoading.value = "";
  }
}

function openContractDialog(
  type: "rental_contract" | "pickup_sheet" | "return_sheet" | "settlement_sheet" = "rental_contract"
) {
  const order = detail.value;
  if (!order) {
    return;
  }
  Object.assign(contractForm, {
    type,
    title: contractTypeLabel(type),
    status: "signed",
    signMethod: type === "settlement_sheet" ? "system" : "counter",
    signerName: order.customerName,
    fileUrl: "",
    operator: "营运端"
  });
  contractDialogVisible.value = true;
}

async function submitContract() {
  const order = detail.value;
  if (!order) {
    return;
  }
  fulfillmentActionLoading.value = "contract";
  try {
    await createStoreRentalOrderContract(order.id, {
      ...contractForm,
      signedAt: contractForm.status === "signed" ? new Date().toISOString() : undefined,
      fileUrl: contractForm.fileUrl || undefined,
      templateCode: contractForm.type,
      printStatus: "generated",
      snapshot: {
        orderNo: order.orderNo,
        mainStatus: order.mainStatus,
        vehicleGroupName: order.vehicleGroupName,
        plateNo: order.plateNo,
        pickupStoreName: order.pickupStoreName,
        returnStoreName: order.returnStoreName
      }
    });
    contractDialogVisible.value = false;
    await reloadAfterFulfillmentAction("单据记录已保存");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "单据保存失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

async function printContractRecord(
  recordId: string,
  mode: "print" | "download" = "print"
) {
  fulfillmentActionLoading.value = `${recordId}:${mode}`;
  try {
    const result = await printStoreRentalContractMock(recordId, {
      mode,
      operator: authStore.user?.displayName || "营运端"
    });
    await reloadAfterFulfillmentAction(result.message);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, mode === "download" ? "单据下载失败" : "单据打印失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

async function mockSignContractRecord(recordId: string) {
  const order = detail.value;
  fulfillmentActionLoading.value = `${recordId}:sign`;
  try {
    const result = await signStoreRentalContractMock(recordId, {
      operator: authStore.user?.displayName || "营运端",
      signerName: order?.customerName,
      signMethod: "counter"
    });
    await reloadAfterFulfillmentAction(result.message);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "mock 签署失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

function openNotificationDialog(scene: typeof notificationForm.scene = "manual") {
  const order = detail.value;
  if (!order) {
    return;
  }
  Object.assign(notificationForm, {
    scene,
    channel: "manual",
    target: order.customerPhoneMasked,
    status: "sent",
    content: `订单 ${order.orderNo} ${notificationSceneLabel(scene)}`,
    operator: "营运端"
  });
  notificationDialogVisible.value = true;
}

async function submitNotification() {
  const order = detail.value;
  if (!order) {
    return;
  }
  fulfillmentActionLoading.value = "notification";
  try {
    await createStoreRentalOrderNotification(order.id, {
      ...notificationForm,
      idempotencyKey: `notice-${order.id}-${Date.now()}`,
      payload: {
        orderNo: order.orderNo,
        mainStatus: order.mainStatus
      }
    });
    notificationDialogVisible.value = false;
    await reloadAfterFulfillmentAction("客户通知已记录");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "客户通知记录失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

function openRemarkDialog() {
  Object.assign(remarkForm, {
    category: "internal_note",
    content: "",
    visibility: "internal",
    followUpAt: "",
    reminderAt: "",
    responsibleName: authStore.user?.displayName || "营运端",
    status: "open",
    operator: authStore.user?.displayName || "营运端"
  });
  remarkDialogVisible.value = true;
}

async function submitRemark() {
  const order = detail.value;
  if (!order) {
    return;
  }
  fulfillmentActionLoading.value = "remark";
  try {
    await createStoreRentalOrderRemark(order.id, {
      ...remarkForm,
      followUpAt: remarkForm.followUpAt || undefined,
      reminderAt: remarkForm.reminderAt || undefined,
      responsibleName: remarkForm.responsibleName || undefined
    });
    remarkDialogVisible.value = false;
    await reloadAfterFulfillmentAction("订单备注已保存");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单备注保存失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

async function closeRemark(recordId: string) {
  const order = detail.value;
  if (!order) {
    return;
  }
  fulfillmentActionLoading.value = `${recordId}:close`;
  try {
    await closeStoreRentalOrderRemark(order.id, recordId, {
      operator: authStore.user?.displayName || "营运端",
      closeNote: "跟进已处理"
    });
    await reloadAfterFulfillmentAction("跟进记录已关闭");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "跟进记录关闭失败"));
  } finally {
    fulfillmentActionLoading.value = "";
  }
}

function openAccidentDialog() {
  Object.assign(accidentForm, {
    description: "",
    accidentAt: new Date().toISOString(),
    location: "",
    responsibility: "customer",
    handlingStatus: "pending_assessment",
    estimatedAmount: 0,
    insuranceNo: "",
    operator: "营运端",
    remark: ""
  });
  accidentDialogVisible.value = true;
}

async function submitAccident() {
  const order = detail.value;
  if (!order || !canSubmitAccident.value) {
    return;
  }
  actionLoading.value = "register-accident";
  try {
    const result = await runStoreRentalOrderAction(order.id, "register-accident", {
      description: accidentForm.description,
      accidentAt: accidentForm.accidentAt,
      location: accidentForm.location,
      responsibility: accidentForm.responsibility,
      handlingStatus: accidentForm.handlingStatus,
      estimatedAmount: accidentForm.estimatedAmount,
      insuranceNo: accidentForm.insuranceNo,
      operator: accidentForm.operator,
      remark: accidentForm.remark,
      source: "order-detail-page"
    });
    ElMessage.success(result.message);
    accidentDialogVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "事故登记失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function submitRedirection() {
  const order = detail.value;
  const vehicle = selectedRedirectionVehicle.value;
  if (!order || !vehicle || !canSubmitRedirection.value) {
    return;
  }
  actionLoading.value = "redirect-order";
  try {
    const result = await runStoreRentalOrderAction(order.id, "redirect-order", {
      targetVehicleId: vehicle.id,
      targetPlateNo: vehicle.licensePlate,
      reason: redirectionForm.reason,
      priceHandling: redirectionForm.priceHandling,
      managerOverride: redirectionForm.managerOverride,
      operator: redirectionForm.operator,
      memo: redirectionForm.memo,
      source: "order-detail-page"
    });
    ElMessage.success(result.message);
    redirectionDialogVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单改派失败"));
  } finally {
    actionLoading.value = "";
  }
}

function openTerminationDialog(action: TerminationAction) {
  pendingTerminationAction.value = action;
  Object.assign(terminationForm, {
    reason:
      action === "cancel"
        ? "行程变更"
        : action === "reject-order"
          ? "黑名单命中"
          : action === "close-order"
            ? "车辆严重故障"
            : "",
    contactResult: action === "mark-no-show" ? "客户超时未到店" : "",
    memo: "",
    operator: "营运端",
    specialWaiver: false,
    waiverReason: "",
    rejectionFeeAmount: 0,
    customerCommunicationConfirmed: false
  });
  terminationDialogVisible.value = true;
}

async function submitTerminationAction() {
  const order = detail.value;
  if (!order || !canSubmitTermination.value) {
    return;
  }
  const action = pendingTerminationAction.value;
  actionLoading.value = action;
  try {
    const payload: Record<string, unknown> = {
      operator: terminationForm.operator,
      memo: terminationForm.memo,
      source: "order-detail-page"
    };
    if (action === "cancel") {
      Object.assign(payload, {
        reason: terminationForm.reason,
        specialWaiver: terminationForm.specialWaiver,
        waiverReason: terminationForm.waiverReason
      });
    } else if (action === "mark-no-show") {
      Object.assign(payload, {
        reason: terminationForm.contactResult,
        contactResult: terminationForm.contactResult
      });
    } else if (action === "reject-order") {
      Object.assign(payload, {
        reason: terminationForm.reason,
        feeAmount: terminationForm.rejectionFeeAmount
      });
    } else if (action === "close-order") {
      Object.assign(payload, {
        reason: terminationForm.reason,
        customerCommunicationConfirmed: terminationForm.customerCommunicationConfirmed
      });
    }
    const result = await runStoreRentalOrderAction(order.id, action, payload);
    ElMessage.success(result.message);
    terminationDialogVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单操作失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function submitExtension() {
  const order = detail.value;
  if (!order || !canSubmitExtension.value) {
    return;
  }
  actionLoading.value = "extend-rental";
  try {
    const result = await runStoreRentalOrderAction(order.id, "extend-rental", {
      newReturnAt: extensionForm.newReturnAt,
      settlementMode:
        order.billingMode === BillingMode.Monthly ? "monthly" : extensionForm.settlementMode,
      paymentPaid: extensionForm.paymentPaid,
      operator: extensionForm.operator,
      memo: extensionForm.memo,
      source: "order-detail-page"
    });
    ElMessage.success(result.message);
    extendDialogVisible.value = false;
    await loadDetail();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "延长用车提交失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function reloadAfterFeeAction(message: string) {
  ElMessage.success(message);
  await loadDetail();
}

async function reloadAfterFulfillmentAction(message: string) {
  ElMessage.success(message);
  await loadDetail();
}

function openCreateFeeDialog() {
  Object.assign(createFeeForm, {
    code: "MANUAL_FEE",
    name: "其他费用",
    stage: detail.value?.mainStatus === OrderMainStatus.Completed ? "post_charge" : "return_settlement",
    direction: "charge",
    amount: 0,
    description: "",
    operator: "营运端"
  });
  createFeeDialogVisible.value = true;
}

async function submitCreateFee() {
  const order = detail.value;
  if (!order) {
    return;
  }
  feeActionLoading.value = "create-fee";
  try {
    await createStoreRentalOrderFee(order.id, { ...createFeeForm });
    createFeeDialogVisible.value = false;
    await reloadAfterFeeAction("费用已新增");
  } catch {
    ElMessage.error("新增费用失败");
  } finally {
    feeActionLoading.value = "";
  }
}

function openWaiveFeeDialog(feeId: string, feeName: string, amount: number) {
  selectedFeeId.value = feeId;
  selectedFeeName.value = feeName;
  Object.assign(waiveFeeForm, {
    amount,
    operator: "营运端",
    reason: ""
  });
  waiveFeeDialogVisible.value = true;
}

async function submitWaiveFee() {
  const order = detail.value;
  if (!order || !selectedFeeId.value) {
    return;
  }
  feeActionLoading.value = "waive-fee";
  try {
    await waiveStoreRentalOrderFee(order.id, selectedFeeId.value, { ...waiveFeeForm });
    waiveFeeDialogVisible.value = false;
    await reloadAfterFeeAction("费用已减免");
  } catch {
    ElMessage.error("费用减免失败");
  } finally {
    feeActionLoading.value = "";
  }
}

function openTransactionDialog(type: "payment" | "refund" | "monthly_bill") {
  const order = detail.value;
  if (!order) {
    return;
  }
  pendingTransactionType.value = type;
  const feeIds = order.feeLedgerItems
    .filter((item) => item.status === "pending" || item.status === "monthly_billing")
    .map((item) => item.id);
  Object.assign(transactionForm, {
    channel: type === "monthly_bill" ? "internal" : "offline",
    amount:
      type === "refund"
        ? order.financialOverview.refundAmount
        : type === "monthly_bill"
          ? order.financialOverview.monthlyBillingAmount
          : order.financialOverview.pendingAmount,
    operator: "营运端",
    relatedFeeIds: feeIds,
    note:
      type === "refund"
        ? "登记退款"
        : type === "monthly_bill"
          ? "登记企业月结挂账"
          : "登记收款"
  });
  transactionDialogVisible.value = true;
}

async function submitTransaction() {
  const order = detail.value;
  if (!order) {
    return;
  }
  feeActionLoading.value = "transaction";
  try {
    await createStoreRentalOrderTransaction(order.id, {
      type: pendingTransactionType.value,
      channel: transactionForm.channel,
      amount: transactionForm.amount,
      operator: transactionForm.operator,
      relatedFeeIds: transactionForm.relatedFeeIds,
      note: transactionForm.note
    });
    transactionDialogVisible.value = false;
    await reloadAfterFeeAction("资金记录已登记");
  } catch {
    ElMessage.error("资金登记失败");
  } finally {
    feeActionLoading.value = "";
  }
}

function defaultActionPayload(order: StoreRentalOrderDetail, action: string) {
  const base = {
    operator: "营运端",
    source: "order-detail-page",
    memo: "订单详情页快速操作",
    idempotencyKey: `${action}-${order.id}-${Date.now()}`
  };
  if (action === "pickup-inspection") {
    return {
      ...base,
      plateNo: order.plateNo,
      mileage: 0,
      fuelLevelPercent: 80,
      batteryLevelPercent: order.vehicleGroupName.includes("Tesla") ? 80 : 0,
      cleanliness: "normal",
      damageFound: false,
      photoCount: 6,
      customerSigned: true
    };
  }
  if (action === "return-inspection") {
    return {
      ...base,
      returnMileage: 0,
      fuelLevelPercent: 80,
      batteryLevelPercent: order.vehicleGroupName.includes("Tesla") ? 80 : 0,
      cleanliness: "normal",
      damageFound: false,
      photoCount: 6,
      customerSigned: true,
      overtimeFeeAmount: 0,
      damageFeeAmount: 0,
      cleaningFeeAmount: 0,
      discountAmount: 0
    };
  }
  if (action === "confirm-settlement") {
    return {
      ...base,
      finalReceivableAmount: order.settlementSummary.finalReceivableAmount,
      monthlyBillingPosted: order.billingMode === BillingMode.Monthly
    };
  }
  return base;
}

function actionLabel(action: string, row?: StoreRentalOrderSummary) {
  const map: Record<string, string> = {
    "payment-success": "支付",
    "start-pickup": "取车",
    "pickup-inspection": "继续取车",
    "extend-rental": row?.mainStatus === OrderMainStatus.Overdue ? "补办续租" : "延长用车",
    "redirect-order": "改派",
    "change-return-store": "改还车门市",
    "change-return-station": "改还车据点",
    "return-inspection": "还车",
    "confirm-settlement": "继续结算",
    "release-operation-lock": "释放操作锁",
    "register-accident": row?.mainStatus === OrderMainStatus.AccidentProcessing ? "处理事故" : "事故登记",
    "mark-no-show": "标记爽约",
    "reject-order": "拒绝履约",
    "close-order": "关闭订单",
    cancel: "取消订单"
  };
  return map[action] ?? action;
}

function terminationDialogTitle(action: string) {
  const map: Record<string, string> = {
    cancel: "取消订单",
    "mark-no-show": "标记爽约",
    "reject-order": "拒绝履约",
    "close-order": "关闭订单"
  };
  return map[action] ?? action;
}

function terminationConfirmLabel(action: string) {
  const map: Record<string, string> = {
    cancel: "确认取消订单",
    "mark-no-show": "确认标记爽约",
    "reject-order": "确认拒绝履约",
    "close-order": "确认关闭订单"
  };
  return map[action] ?? "确认提交";
}

function formatHourDistance(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value >= 0) {
    return `${value.toFixed(1)} 小时后取车`;
  }
  return `已超取车时间 ${Math.abs(value).toFixed(1)} 小时`;
}

function statusLabel(value: string) {
  const map: Record<string, string> = {
    pending_payment: "待支付",
    reserved: "已预订",
    pickup_overdue: "取车超时",
    inspecting: "验车中",
    renting: "租赁中",
    renewing: "续租中",
    overdue: "逾期未还",
    accident_processing: "出险处理中",
    settlement_pending: "待结算",
    payment_due: "待补缴",
    refund_pending: "待退款",
    completed: "已完成",
    cancelled: "已取消",
    no_show: "爽约",
    rejected: "已拒绝",
    closed: "已关闭"
  };
  return map[value] ?? value;
}

function statusType(value: string) {
  if (["renting", "reserved"].includes(value)) {
    return "success";
  }
  if (["pending_payment", "settlement_pending", "inspecting", "payment_due", "refund_pending"].includes(value)) {
    return "warning";
  }
  if (["overdue", "pickup_overdue", "accident_processing", "rejected"].includes(value)) {
    return "danger";
  }
  return "info";
}

function dispatchLabel(value?: string) {
  if (!value) {
    return "-";
  }
  const map: Record<string, string> = {
    pending: "待派车",
    pre_assigned: "已预派",
    locked: "已锁车",
    manual_reassigned: "人工改派",
    upgraded: "升舱",
    dispatch_manual_required: "需人工确认"
  };
  return map[value] ?? value;
}

function paymentLabel(value: string) {
  const map: Record<string, string> = {
    unpaid: "未支付",
    deposit_paid: "已预授权",
    monthly_billing: "企业月结",
    partial_paid: "部分支付",
    paid: "已支付",
    payment_due: "待补缴",
    refund_pending: "待退款",
    refunded: "已退款"
  };
  return map[value] ?? value;
}

function feeStageLabel(value: string) {
  const map: Record<string, string> = {
    booking: "下单",
    rental: "租期费用",
    pickup: "取车",
    return_settlement: "还车结算",
    cancellation: "取消/爽约",
    post_charge: "完成后追缴"
  };
  return map[value] ?? value;
}

function feeSourceLabel(value: string) {
  const map: Record<string, string> = {
    system: "系统费用",
    manual: "人工费用"
  };
  return map[value] ?? value;
}

function feeDirectionLabel(value: string) {
  const map: Record<string, string> = {
    charge: "应收",
    refund: "应退",
    waiver: "减免"
  };
  return map[value] ?? value;
}

function feeStatusLabel(value: string) {
  const map: Record<string, string> = {
    pending: "待处理",
    settled: "已结清",
    waived: "已减免",
    monthly_billing: "企业月结",
    voided: "已作废"
  };
  return map[value] ?? value;
}

function transactionTypeLabel(value: string) {
  const map: Record<string, string> = {
    pre_auth_freeze: "预授权冻结",
    pre_auth_release: "预授权释放",
    pre_auth_capture: "预授权扣款",
    payment: "订单收款",
    refund: "订单退款",
    waiver: "费用减免",
    monthly_bill: "企业月结"
  };
  return map[value] ?? value;
}

function transactionChannelLabel(value: string) {
  const map: Record<string, string> = {
    online: "线上支付",
    offline: "线下收退款",
    internal: "内部记账"
  };
  return map[value] ?? value;
}

function transactionStatusLabel(value: string) {
  const map: Record<string, string> = {
    pending: "待处理",
    success: "成功",
    failed: "失败"
  };
  return map[value] ?? value;
}

function transactionStatusType(value: string) {
  if (value === "success") {
    return "success";
  }
  if (value === "failed") {
    return "danger";
  }
  return "warning";
}

function contractTypeLabel(value: string) {
  const map: Record<string, string> = {
    rental_contract: "租赁合约",
    pickup_sheet: "取车交接单",
    return_sheet: "还车交接单",
    settlement_sheet: "结算单"
  };
  return map[value] ?? value;
}

function contractStatusLabel(value: string) {
  const map: Record<string, string> = {
    pending: "待签署",
    signed: "已签署",
    fallback_uploaded: "纸本已上传",
    voided: "已作废"
  };
  return map[value] ?? value;
}

function notificationSceneLabel(value: string) {
  const map: Record<string, string> = {
    order_created: "订单创建",
    pickup_completed: "取车完成",
    return_completed: "还车完成",
    payment_due: "待补缴",
    post_charge: "完成后追缴",
    order_terminal: "订单终止",
    manual: "人工通知"
  };
  return map[value] ?? value;
}

function notificationStatusType(value: string) {
  if (value === "sent") {
    return "success";
  }
  if (value === "failed") {
    return "danger";
  }
  if (value === "skipped") {
    return "info";
  }
  return "warning";
}

function remarkCategoryLabel(value: string) {
  const map: Record<string, string> = {
    general: "通用",
    pickup: "取车",
    return: "还车",
    finance: "财务",
    risk: "风险",
    internal_note: "内部备注",
    customer_note: "客户备注",
    return_visit: "回访记录",
    fulfillment_followup: "履约跟进",
    customer_followup: "客户跟进"
  };
  return map[value] ?? value;
}

function operationLockStatusLabel(value: string) {
  const map: Record<string, string> = {
    active: "操作中",
    interrupted: "已中断",
    expired: "已超时",
    released: "已释放"
  };
  return map[value] ?? value;
}

function feeStatusType(value: string) {
  if (["settled", "waived", "monthly_billing"].includes(value)) {
    return "success";
  }
  if (value === "voided") {
    return "info";
  }
  return "warning";
}

function readErrorMessage(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: { message?: string | string[] } } })
    ?.response;
  const message = response?.data?.message;
  if (Array.isArray(message)) {
    return message.join("；");
  }
  return message || fallback;
}

function showReservedFeeAction(action: string) {
  ElMessage.info(`${action}已按 PRD 预留入口，MVP 阶段先不接真实资金接口。`);
}

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-Hans-CN")}`;
}

onMounted(loadDetail);
</script>

<template>
  <AppLayout>
    <div v-loading="loading" class="space-y-6">
      <div class="flex items-center justify-between">
        <el-button icon="ArrowLeft" plain @click="goBack">返回</el-button>
        <div class="text-xs text-gray-400 font-mono">ID: {{ orderId }}</div>
      </div>

      <template v-if="detail">
        <section class="bg-white rounded-xl border border-gray-200 p-6">
          <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="text-2xl font-bold text-gray-900">订单 {{ detail.orderNo }}</h1>
                <el-tag :type="statusType(detail.mainStatus)" effect="dark" round>
                  {{ statusLabel(detail.mainStatus) }}
                </el-tag>
                <el-tag effect="plain" round>门市租赁</el-tag>
                <el-tag v-if="detail.corporateShortName" type="primary" effect="plain" round>
                  {{ detail.corporateShortName }}
                </el-tag>
                <el-tag v-if="isMonthly" type="primary" effect="plain" round>
                  企业月结
                </el-tag>
                <el-tag type="info" effect="plain" round>
                  {{ paymentLabel(detail.paymentStatus) }}
                </el-tag>
              </div>
              <div class="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                <span>{{ detail.customerName }} · {{ detail.customerPhoneMasked }}</span>
                <span>{{ detail.pickupAt }} 至 {{ detail.returnAt }}</span>
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs text-gray-400 mb-1">订单总额</div>
              <div class="text-3xl font-bold text-[#00689E] font-mono">
                {{ formatMoney(detail.totalAmount) }}
              </div>
            </div>
          </div>

          <div class="mt-5 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-2">
            <el-button
              v-for="action in primaryActions(detail)"
              :key="action"
              :type="['start-pickup', 'return-inspection', 'payment-success', 'extend-rental'].includes(action) ? 'primary' : 'default'"
              :plain="!['start-pickup', 'return-inspection', 'payment-success', 'extend-rental'].includes(action)"
              :loading="actionLoading === action"
              @click="runAction(action)"
            >
              {{ actionLabel(action, detail) }}
            </el-button>
            <el-button plain icon="Money" @click="feeModalVisible = true">费用</el-button>
            <el-dropdown trigger="click" @command="handleMoreCommand">
              <el-button plain>
                更多操作
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="action in moreActions(detail)"
                    :key="action"
                    :command="action"
                  >
                    {{ actionLabel(action, detail) }}
                  </el-dropdown-item>
                  <el-dropdown-item command="订单备注">订单备注</el-dropdown-item>
                  <el-dropdown-item command="打印单据">打印单据</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </section>

        <div class="grid grid-cols-12 gap-6">
          <section class="col-span-12 xl:col-span-8 bg-white rounded-xl border border-gray-200">
            <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">客户与预约资料</div>
            <div class="p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="客户">{{ detail.customerName }}</el-descriptions-item>
                <el-descriptions-item label="手机">{{ detail.customerPhoneMasked }}</el-descriptions-item>
                <el-descriptions-item label="企业">{{ detail.corporateShortName || "-" }}</el-descriptions-item>
                <el-descriptions-item label="结算">{{ isMonthly ? "企业月结" : "客户自付" }}</el-descriptions-item>
              </el-descriptions>
              <el-descriptions :column="1" border size="small">
                <el-descriptions-item label="取车门市">{{ detail.pickupStoreName }}</el-descriptions-item>
                <el-descriptions-item label="还车门市">{{ detail.returnStoreName }}</el-descriptions-item>
                <el-descriptions-item label="预定车组">{{ detail.vehicleGroupName }}</el-descriptions-item>
                <el-descriptions-item label="车辆">{{ detail.plateNo || "待派车" }}</el-descriptions-item>
              </el-descriptions>
            </div>
          </section>

          <section class="col-span-12 xl:col-span-4 bg-white rounded-xl border border-gray-200">
            <div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span class="font-bold text-gray-800">派车信息</span>
              <el-tag size="small" effect="plain">{{ dispatchLabel(detail.dispatchStatus) }}</el-tag>
            </div>
            <div class="p-5">
              <div class="text-2xl font-mono font-bold text-[#00689E]">{{ detail.plateNo || "待派车" }}</div>
              <div class="mt-2 text-sm text-gray-500">{{ detail.vehicleGroupName }}</div>
              <div class="mt-4 flex flex-wrap gap-2">
                <el-tag v-for="flag in detail.riskFlags" :key="flag" size="small" type="warning" effect="plain">
                  {{ flag }}
                </el-tag>
              </div>
            </div>
          </section>

          <section class="col-span-12 xl:col-span-4 bg-white rounded-xl border border-gray-200">
            <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">报价快照</div>
            <div class="p-5 space-y-3">
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">价格版本</span>
                <span class="font-medium text-gray-800">{{ detail.snapshots?.pricingVersion || "-" }}</span>
              </div>
              <div v-if="detail.snapshots?.priceVersionId" class="flex justify-between text-sm">
                <span class="text-gray-500">价格版本ID</span>
                <span class="font-mono text-xs text-gray-700">{{ detail.snapshots.priceVersionId }}</span>
              </div>
              <div v-if="detail.snapshots?.marketingPlanName" class="flex justify-between text-sm">
                <span class="text-gray-500">行销方案</span>
                <span class="font-medium text-gray-800">{{ detail.snapshots.marketingPlanName }}</span>
              </div>
              <div v-if="detail.snapshots?.marketingPlanVersionId" class="flex justify-between text-sm">
                <span class="text-gray-500">行销版本ID</span>
                <span class="font-mono text-xs text-gray-700">{{ detail.snapshots.marketingPlanVersionId }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-500">车辆分组</span>
                <span class="font-medium text-gray-800">{{ detail.snapshots?.vehicleGroup || "-" }}</span>
              </div>
            </div>
          </section>
        </div>

        <div class="grid grid-cols-12 gap-6">
          <div class="col-span-12 xl:col-span-8 space-y-6">
            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">取还车明细</div>
              <el-table :data="pickupReturnRows" style="width: 100%">
                <el-table-column prop="type" label="项目" width="90" />
                <el-table-column prop="time" label="时间" min-width="180" />
                <el-table-column prop="store" label="门市/据点" min-width="150" />
                <el-table-column prop="mileage" label="里程" width="110" />
                <el-table-column prop="energy" label="油/电量" width="110" />
                <el-table-column prop="photos" label="照片" width="90" />
                <el-table-column label="签名" width="90">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.signed ? 'success' : 'warning'" effect="plain">
                      {{ row.signed ? "已签名" : "待确认" }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="operator" label="操作员" width="110" />
              </el-table>
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">履约事件</div>
              <div class="p-5">
                <el-timeline>
                  <el-timeline-item
                    v-for="item in detail.timeline"
                    :key="item.at + item.action"
                    :timestamp="item.at"
                    placement="top"
                  >
                    <div class="text-sm font-medium text-gray-800">{{ item.action }}</div>
                    <div class="text-xs text-gray-500 mt-1">{{ item.actor }}</div>
                  </el-timeline-item>
                </el-timeline>
              </div>
            </section>
          </div>

          <div class="col-span-12 xl:col-span-4 space-y-6">
            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">账务总览</div>
              <div class="p-5 grid grid-cols-2 gap-3 text-xs">
                <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  合计应收<br><b>{{ formatMoney(detail.financialOverview.totalReceivableAmount) }}</b>
                </div>
                <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  客户实收<br><b>{{ formatMoney(detail.financialOverview.customerReceivedAmount) }}</b>
                </div>
                <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  待处理<br><b>{{ formatMoney(detail.financialOverview.pendingAmount) }}</b>
                </div>
                <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                  待退款<br><b>{{ formatMoney(detail.financialOverview.refundAmount) }}</b>
                </div>
              </div>
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">收费明细</div>
              <div class="divide-y divide-gray-100">
                <div
                  v-for="item in detail.feeLedgerItems"
                  :key="item.id"
                  class="px-5 py-3 text-sm"
                >
                  <div class="flex justify-between gap-3">
                    <div>
                      <div class="font-bold text-gray-800">{{ item.name }}</div>
                      <div class="text-xs text-gray-500 mt-1">{{ item.description }}</div>
                    </div>
                    <div class="text-right">
                      <div class="font-mono font-bold">{{ formatMoney(item.amount) }}</div>
                      <el-tag size="small" effect="plain" class="mt-1">{{ feeStatusLabel(item.status) }}</el-tag>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">资金记录</div>
              <div class="divide-y divide-gray-100">
                <div
                  v-for="record in detail.transactionRecords"
                  :key="record.id"
                  class="px-5 py-3 text-sm"
                >
                  <div class="flex justify-between gap-3">
                    <div>
                      <div class="font-bold text-gray-800">{{ transactionTypeLabel(record.type) }}</div>
                      <div class="text-xs text-gray-500 mt-1">{{ record.note }}</div>
                    </div>
                    <div class="text-right">
                      <div class="font-mono font-bold">{{ formatMoney(record.amount) }}</div>
                      <el-tag size="small" :type="record.status === 'success' ? 'success' : 'warning'" effect="plain" class="mt-1">
                        {{ record.status === "success" ? "成功" : "待处理" }}
                      </el-tag>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">履约事件</div>
              <el-tabs v-model="eventTab" class="px-5 pt-3">
                <el-tab-pane label="全部" name="all">
                  <div v-if="allEvents.length" class="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    <div v-for="event in allEvents.slice(0, 20)" :key="event.id" class="py-3 text-sm">
                      <div class="flex justify-between gap-3">
                        <div>
                          <el-tag size="small" :type="eventTypeTag(event.type)" effect="plain" class="mr-2">{{ eventTypeLabel(event.type) }}</el-tag>
                          <span class="font-medium text-gray-800">{{ event.title }}</span>
                          <div class="text-xs text-gray-500 mt-1">{{ event.summary || "-" }}</div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="text-xs text-gray-400">{{ event.operator }}</div>
                          <div class="text-[11px] text-gray-400 font-mono">{{ event.time }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="暂无履约事件" :image-size="60" />
                </el-tab-pane>
                <el-tab-pane label="异常" name="exception">
                  <div v-if="exceptionEvents.length" class="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    <div v-for="event in exceptionEvents" :key="event.id" class="py-3 text-sm">
                      <div class="flex justify-between gap-3">
                        <div>
                          <el-tag size="small" type="danger" effect="plain" class="mr-2">{{ eventTypeLabel(event.type) }}</el-tag>
                          <span class="font-medium text-gray-800">{{ event.title }}</span>
                          <div class="text-xs text-gray-500 mt-1">{{ event.summary || "-" }}</div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="text-xs text-gray-400">{{ event.operator }}</div>
                          <div class="text-[11px] text-gray-400 font-mono">{{ event.time }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="暂无异常事件" :image-size="60" />
                </el-tab-pane>
                <el-tab-pane label="改派" name="reassign">
                  <div v-if="reassignEvents.length" class="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    <div v-for="event in reassignEvents" :key="event.id" class="py-3 text-sm">
                      <div class="flex justify-between gap-3">
                        <div>
                          <el-tag size="small" type="warning" effect="plain" class="mr-2">改派</el-tag>
                          <span class="font-medium text-gray-800">{{ event.title }}</span>
                          <div class="text-xs text-gray-500 mt-1">{{ event.summary || "-" }}</div>
                          <!-- 改派事件详情：原车辆、新车辆、原因 -->
                          <div v-if="event.title.includes('改派')" class="text-xs text-gray-600 mt-1">
                            {{ parseDispatchDetails(event.title) }}
                          </div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="text-xs text-gray-400">{{ event.operator }}</div>
                          <div class="text-[11px] text-gray-400 font-mono">{{ event.time }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="暂无改派事件" :image-size="60" />
                </el-tab-pane>
                <el-tab-pane label="事故" name="accident">
                  <div v-if="accidentEvents.length" class="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                    <div v-for="event in accidentEvents" :key="event.id" class="py-3 text-sm">
                      <div class="flex justify-between gap-3">
                        <div>
                          <el-tag size="small" type="danger" effect="plain" class="mr-2">事故</el-tag>
                          <span class="font-medium text-gray-800">{{ event.title }}</span>
                          <div class="text-xs text-gray-500 mt-1">{{ event.summary || "-" }}</div>
                          <!-- 事故事件详情：事故描述、责任归属、处理状态 -->
                          <div v-if="event.title.includes('事故')" class="text-xs text-gray-600 mt-1">
                            {{ parseAccidentDetails(event.title) }}
                          </div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="text-xs text-gray-400">{{ event.operator }}</div>
                          <div class="text-[11px] text-gray-400 font-mono">{{ event.time }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <el-empty v-else description="暂无事故事件" :image-size="60" />
                </el-tab-pane>
                <el-tab-pane label="操作日志" name="log">
                  <div class="max-h-80 overflow-y-auto">
                    <el-table :data="detail.timeline" size="small" stripe>
                      <el-table-column label="时间" width="170">
                        <template #default="{ row }">
                          <div class="font-mono text-xs">{{ row.at }}</div>
                        </template>
                      </el-table-column>
                      <el-table-column label="操作" prop="action" min-width="150" />
                      <el-table-column label="详情" prop="detail" min-width="200" />
                      <el-table-column label="操作人" prop="actor" width="120" />
                      <el-table-column label="备注" prop="remark" min-width="150" />
                    </el-table>
                  </div>
                </el-tab-pane>
              </el-tabs>
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span class="font-bold text-gray-800">合同与单据</span>
                <el-button size="small" link type="primary" @click="openContractDialog()">登记</el-button>
              </div>
              <div v-if="detail.contracts.length" class="divide-y divide-gray-100">
                <div v-for="record in detail.contracts" :key="record.id" class="px-5 py-3 text-sm">
                  <div class="flex justify-between gap-3">
                    <div>
                      <div class="font-bold text-gray-800">{{ record.title }}</div>
                      <div class="text-xs text-gray-500 mt-1">{{ record.documentNo }} · {{ contractTypeLabel(record.type) }}</div>
                      <div class="text-xs text-gray-400 mt-1">
                        {{ record.printStatus === "printed" ? "已打印" : record.printStatus === "downloaded" ? "已下载" : record.printStatus === "generated" ? "已生成" : "未打印" }}
                        <span v-if="record.externalSignStatus === 'skipped'"> · 外部签署已跳过</span>
                      </div>
                    </div>
                    <div class="text-right">
                      <el-tag size="small" effect="plain">{{ contractStatusLabel(record.status) }}</el-tag>
                      <div class="text-xs text-gray-400 mt-1">{{ record.operator }}</div>
                      <div class="mt-2 flex justify-end gap-1">
                        <el-button
                          size="small"
                          link
                          type="primary"
                          :loading="fulfillmentActionLoading === `${record.id}:print`"
                          @click="printContractRecord(record.id, 'print')"
                        >
                          打印
                        </el-button>
                        <el-button
                          size="small"
                          link
                          type="primary"
                          :loading="fulfillmentActionLoading === `${record.id}:download`"
                          @click="printContractRecord(record.id, 'download')"
                        >
                          下载
                        </el-button>
                        <el-button
                          v-if="record.status === 'pending'"
                          size="small"
                          link
                          type="success"
                          :loading="fulfillmentActionLoading === `${record.id}:sign`"
                          @click="mockSignContractRecord(record.id)"
                        >
                          mock签署
                        </el-button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <el-empty v-else description="暂无合同或交接单记录" :image-size="70" />
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <span class="font-bold text-gray-800">通知与跟进</span>
                <div class="flex gap-2">
                  <el-button size="small" link type="primary" @click="openNotificationDialog()">通知</el-button>
                  <el-button size="small" link type="primary" @click="openRemarkDialog">备注</el-button>
                </div>
              </div>
              <div class="divide-y divide-gray-100 max-h-96 overflow-y-auto">
                <div v-for="record in detail.notifications.slice(0, 4)" :key="record.id" class="px-5 py-3 text-sm">
                  <div class="flex justify-between gap-3">
                    <div>
                      <div class="font-bold text-gray-800">{{ notificationSceneLabel(record.scene) }}</div>
                      <div class="text-xs text-gray-500 mt-1">{{ record.content }}</div>
                    </div>
                    <el-tag size="small" :type="notificationStatusType(record.status)" effect="plain">{{ record.status }}</el-tag>
                  </div>
                </div>
                <div v-for="record in detail.remarks" :key="record.id" class="px-5 py-3 text-sm">
                  <div class="flex justify-between gap-3">
                    <div class="font-bold text-gray-800">
                      {{ remarkCategoryLabel(record.category) }}
                      <span class="ml-2 text-xs font-normal text-gray-400">
                        {{ record.visibility === "customer_visible" ? "客户可见" : "内部" }}
                      </span>
                    </div>
                    <el-tag size="small" :type="record.status === 'closed' ? 'info' : 'warning'" effect="plain">
                      {{ record.status === "closed" ? "已关闭" : "待跟进" }}
                    </el-tag>
                  </div>
                  <div class="text-xs text-gray-500 mt-1">{{ record.content }}</div>
                  <div class="text-xs text-gray-400 mt-1">
                    责任人：{{ record.responsibleName || record.operator }}
                    <span class="mx-1">·</span>
                    记录人：{{ record.operator }}
                    <span class="mx-1">·</span>
                    {{ record.createdAt }}
                  </div>
                  <div v-if="record.followUpAt || record.reminderAt" class="text-xs text-gray-400 mt-1">
                    <span v-if="record.followUpAt">跟进时间：{{ record.followUpAt }}</span>
                    <span v-if="record.followUpAt && record.reminderAt" class="mx-1">·</span>
                    <span v-if="record.reminderAt">提醒时间：{{ record.reminderAt }}</span>
                  </div>
                  <div v-if="record.status === 'closed'" class="text-xs text-gray-400 mt-1">
                    关闭人：{{ record.closedBy || "营运端" }}
                    <span v-if="record.closedAt"> · {{ record.closedAt }}</span>
                    <span v-if="record.closeNote"> · {{ record.closeNote }}</span>
                  </div>
                  <div v-else class="mt-2">
                    <el-button
                      size="small"
                      link
                      type="primary"
                      :loading="fulfillmentActionLoading === `${record.id}:close`"
                      @click="closeRemark(record.id)"
                    >
                      关闭跟进
                    </el-button>
                  </div>
                </div>
              </div>
              <el-empty v-if="!detail.notifications.length && !detail.remarks.length" description="暂无通知或备注" :image-size="70" />
            </section>

            <section class="bg-white rounded-xl border border-gray-200">
              <div class="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">操作锁 / 幂等</div>
              <div class="p-5 space-y-3 text-sm">
                <div v-for="record in detail.operationLocks.slice(0, 3)" :key="record.id" class="rounded border border-gray-200 px-3 py-2">
                  <div class="flex justify-between">
                    <b>{{ record.stage }}</b>
                    <el-tag size="small" effect="plain">{{ operationLockStatusLabel(record.status) }}</el-tag>
                  </div>
                  <div class="text-xs text-gray-500 mt-1">{{ record.operator }} · {{ record.startedAt }}</div>
                </div>
                <div v-for="record in detail.idempotencyRecords.slice(0, 3)" :key="record.id" class="rounded border border-gray-200 px-3 py-2">
                  <div class="flex justify-between">
                    <b>{{ record.action }}</b>
                    <span class="text-xs text-gray-500">{{ record.status }}</span>
                  </div>
                  <div class="text-xs text-gray-500 mt-1 font-mono">{{ record.key }}</div>
                </div>
                <el-button
                  v-if="detail.mainStatus === OrderMainStatus.Inspecting && detail.operationLocks.some((record) => record.stage === 'pickup' && record.status !== 'released')"
                  size="small"
                  type="warning"
                  plain
                  :loading="actionLoading === 'release-operation-lock'"
                  @click="releasePickupOperationLock"
                >
                  释放取车操作锁
                </el-button>
                <el-empty v-if="!detail.operationLocks.length && !detail.idempotencyRecords.length" description="暂无锁或幂等记录" :image-size="70" />
              </div>
            </section>
          </div>
        </div>
      </template>
    </div>

    <el-dialog v-model="pickupWizardVisible" title="车辆取车作业" width="1100px" top="4vh" destroy-on-close>
      <template v-if="detail">
        <el-steps :active="pickupStep" finish-status="success" class="mb-5">
          <el-step title="身份与优惠资格" />
          <el-step title="押金尾款" />
          <el-step title="合约验车发车" />
        </el-steps>

        <div v-if="pickupStep === 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">驾驶人信息</div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="驾驶人姓名"><el-input v-model="pickupForm.driverName" /></el-form-item>
                <el-form-item label="手机号"><el-input v-model="pickupForm.driverPhone" /></el-form-item>
                <el-form-item label="身份证号"><el-input v-model="pickupForm.identityNoMasked" /></el-form-item>
                <el-form-item label="驾照有效期"><el-input v-model="pickupForm.licenseValidUntil" placeholder="YYYY-MM-DD" /></el-form-item>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <el-checkbox v-model="pickupForm.identityPhotoUploaded">身份证照片已上传</el-checkbox>
                <el-checkbox v-model="pickupForm.licensePhotoUploaded">驾照照片已上传</el-checkbox>
                <el-checkbox v-model="pickupForm.identityMatched">确认人证合一</el-checkbox>
              </div>
            </el-form>
          </section>
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">行销方案资格核验</div>
            <el-form label-position="top">
              <el-form-item label="当前行销方案"><el-input v-model="pickupForm.originalMarketingPlan" /></el-form-item>
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="到店核验">
                  <el-switch v-model="pickupForm.marketingNeedVerification" active-text="需核验" inactive-text="无需核验" />
                </el-form-item>
                <el-form-item label="核验结果">
                  <el-radio-group v-model="pickupForm.marketingVerificationResult">
                    <el-radio-button label="passed">通过</el-radio-button>
                    <el-radio-button label="failed">不通过</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <el-form-item label="证明文件数量"><el-input-number v-model="pickupForm.proofFileCount" :min="0" :max="3" class="w-full" /></el-form-item>
                <el-form-item label="更换后行销方案"><el-input v-model="pickupForm.changedMarketingPlan" placeholder="核验不通过时必填" /></el-form-item>
              </div>
              <el-form-item label="不通过原因 / 核验备注">
                <el-input v-model="pickupForm.marketingVerificationReason" type="textarea" :rows="2" />
              </el-form-item>
            </el-form>
          </section>
        </div>

        <div v-else-if="pickupStep === 1" class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="rounded border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs text-gray-500 mb-1">订单总额</div>
            <div class="text-2xl font-mono font-bold text-gray-900">{{ formatMoney(detail.totalAmount) }}</div>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs text-gray-500 mb-1">{{ isMonthly ? "企业月结金额" : "预授权押金" }}</div>
            <div class="text-2xl font-mono font-bold text-[#00689E]">{{ formatMoney(isMonthly ? detail.totalAmount : pickupForm.preAuthAmount) }}</div>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 p-4">
            <div class="text-xs text-gray-500 mb-1">{{ isMonthly ? "客户应收" : "应收尾款" }}</div>
            <div class="text-2xl font-mono font-bold" :class="pickupBalanceDue > 0 ? 'text-red-600' : 'text-green-600'">
              {{ formatMoney(pickupBalanceDue) }}
            </div>
          </div>
          <section class="lg:col-span-3 rounded border border-gray-200 p-4">
            <el-form label-position="top">
              <template v-if="!isMonthly">
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <el-form-item label="预授权处理方式">
                    <el-radio-group v-model="pickupForm.preAuthMode">
                      <el-radio-button label="performance_guarantee">履约担保</el-radio-button>
                      <el-radio-button label="rent_offset">转租金</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="预授权状态">
                    <el-select v-model="pickupForm.preAuthStatus" class="w-full">
                      <el-option label="已冻结" value="frozen" />
                      <el-option label="已扣款" value="captured" />
                      <el-option label="已释放" value="released" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="本次预授权金额"><el-input-number v-model="pickupForm.preAuthAmount" :min="0" :step="100" class="w-full" /></el-form-item>
                  <el-form-item label="取车已收租金"><el-input-number v-model="pickupForm.pickupCollectedAmount" :min="0" :step="100" class="w-full" /></el-form-item>
                </div>
                <el-checkbox v-model="pickupForm.balancePaid">确认应收尾款已结清</el-checkbox>
              </template>
              <template v-else>
                <div class="rounded border border-indigo-100 bg-indigo-50 text-indigo-700 px-3 py-2 text-sm mb-3">
                  企业月结订单不发起客户支付和预授权，确认企业月结结算方式后进入合约验车。
                </div>
                <el-checkbox v-model="pickupForm.monthlyBillingConfirmed">确认企业月结结算方式有效</el-checkbox>
              </template>
            </el-form>
          </section>
        </div>

        <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">租赁合约签署</div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="签署方式">
                  <el-select v-model="pickupForm.signMethod" class="w-full">
                    <el-option label="客户 App 签署" value="app" />
                    <el-option label="柜台现场签名" value="counter" />
                    <el-option label="线下纸质兜底" value="offline_paper" />
                  </el-select>
                </el-form-item>
                <el-form-item label="签署人"><el-input v-model="pickupForm.signerName" /></el-form-item>
              </div>
              <el-checkbox v-model="pickupForm.contractSigned">确认租赁合约已签署</el-checkbox>
            </el-form>
          </section>
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">验车发车</div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="实际取车时间"><el-input v-model="pickupForm.actualPickupAt" /></el-form-item>
                <el-form-item label="车辆所在据点"><el-input v-model="pickupForm.vehicleStationName" /></el-form-item>
                <el-form-item label="发车里程"><el-input-number v-model="pickupForm.mileage" :min="0" class="w-full" /></el-form-item>
                <el-form-item label="油量/电量"><el-input-number v-model="pickupForm.fuelLevelPercent" :min="0" :max="100" class="w-full" /></el-form-item>
                <el-form-item label="交付位置"><el-input v-model="pickupForm.deliveryLocation" /></el-form-item>
                <el-form-item label="标准照片数量"><el-input-number v-model="pickupForm.photoCount" :min="0" :max="12" class="w-full" /></el-form-item>
              </div>
              <el-checkbox v-model="pickupForm.damageFound">存在异常/损伤</el-checkbox>
              <el-input v-model="pickupForm.damageDescription" class="mt-2" type="textarea" :rows="2" placeholder="损伤位置、类型、照片说明" />
              <el-checkbox v-model="pickupForm.customerSigned" class="mt-3">客户确认并签字</el-checkbox>
            </el-form>
          </section>
        </div>
      </template>
      <template #footer>
        <el-button @click="pickupWizardVisible = false">关闭</el-button>
        <el-button v-if="pickupStep > 0" @click="pickupStep -= 1">上一步</el-button>
        <el-button v-if="pickupStep < 2" type="primary" color="#00689E" :disabled="!canContinuePickupStep" @click="nextPickupStep">下一步</el-button>
        <el-button v-else type="primary" color="#00689E" :loading="pickupSubmitting" :disabled="!canContinuePickupStep" @click="submitPickupWizard">确认发车</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="returnWizardVisible" title="车辆还车结算" width="1100px" top="4vh" destroy-on-close>
      <template v-if="detail">
        <el-steps :active="returnStep" finish-status="success" class="mb-5">
          <el-step title="验车录入" />
          <el-step title="费用结算" />
          <el-step title="还车完成" />
        </el-steps>

        <div v-if="returnStep === 0" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">还车时间与地点</div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="实际还车时间"><el-input v-model="returnForm.actualReturnAt" /></el-form-item>
                <el-form-item label="订单当前还车门市"><el-input :model-value="detail.returnStoreName" disabled /></el-form-item>
                <el-form-item label="归还据点"><el-input v-model="returnForm.returnStationName" /></el-form-item>
                <el-form-item label="车位号"><el-input v-model="returnForm.parkingSpaceNo" /></el-form-item>
                <el-form-item label="停车楼层"><el-input v-model="returnForm.parkingFloor" /></el-form-item>
                <el-form-item label="停车位照片数"><el-input-number v-model="returnForm.parkingPhotoCount" :min="0" class="w-full" /></el-form-item>
              </div>
            </el-form>
          </section>
          <section class="rounded border border-gray-200 p-4">
            <div class="font-bold text-gray-800 mb-3">里程、油电与车况</div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="取车里程"><el-input :model-value="latestPickupInspection?.mileage ?? '-'" disabled /></el-form-item>
                <el-form-item label="还车里程"><el-input-number v-model="returnForm.returnMileage" :min="0" class="w-full" /></el-form-item>
                <el-form-item label="还车油量/电量"><el-input-number v-model="returnForm.fuelLevelPercent" :min="0" :max="100" class="w-full" /></el-form-item>
                <el-form-item label="清洁状态">
                  <el-select v-model="returnForm.cleanliness" class="w-full">
                    <el-option label="正常" value="normal" />
                    <el-option label="干净" value="clean" />
                    <el-option label="需深度清洁" value="dirty" />
                  </el-select>
                </el-form-item>
                <el-form-item label="标准照片数量"><el-input-number v-model="returnForm.photoCount" :min="0" :max="12" class="w-full" /></el-form-item>
              </div>
              <el-checkbox v-model="returnForm.damageFound">新增异常/损伤</el-checkbox>
              <el-input v-model="returnForm.damageDescription" class="mt-2" type="textarea" :rows="2" placeholder="损伤位置、类型、照片说明" />
              <el-input v-model="returnForm.missingItems" class="mt-2" placeholder="缺失随车物品" />
              <el-checkbox v-model="returnForm.customerSigned" class="mt-3">客户确认并签字</el-checkbox>
            </el-form>
          </section>
        </div>

        <div v-else-if="returnStep === 1" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div class="rounded border border-gray-200 bg-gray-50 p-4">
              <div class="text-xs text-gray-500">超时费</div>
              <el-input-number v-model="returnForm.overtimeFeeAmount" :min="0" :step="50" class="w-full mt-2" />
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-4">
              <div class="text-xs text-gray-500">损伤赔偿</div>
              <el-input-number v-model="returnForm.damageFeeAmount" :min="0" :step="50" class="w-full mt-2" />
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-4">
              <div class="text-xs text-gray-500">清洁/缺件</div>
              <el-input-number v-model="returnForm.cleaningFeeAmount" :min="0" :step="50" class="w-full mt-2" />
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-4">
              <div class="text-xs text-gray-500">减免</div>
              <el-input-number v-model="returnForm.discountAmount" :min="0" :step="50" class="w-full mt-2" />
            </div>
          </div>
          <div class="rounded border p-4" :class="returnBalanceDue > 0 ? 'border-red-100 bg-red-50' : returnBalanceDue < 0 ? 'border-green-100 bg-green-50' : 'border-gray-200 bg-gray-50'">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div class="text-xs text-gray-500">{{ isMonthly ? "企业挂账金额" : "还车待结金额" }}</div>
                <div class="text-3xl font-mono font-bold" :class="returnBalanceDue > 0 ? 'text-red-600' : returnBalanceDue < 0 ? 'text-green-600' : 'text-gray-900'">
                  {{ formatMoney(isMonthly ? Math.max(0, detail.totalAmount + returnFeeTotal) : returnBalanceDue) }}
                </div>
              </div>
              <el-checkbox v-if="!isMonthly" v-model="returnForm.settlementHandled">
                已完成补缴/退款处理
              </el-checkbox>
              <el-checkbox v-else v-model="returnForm.monthlyBillingPosted">
                确认企业月结挂账
              </el-checkbox>
            </div>
          </div>
          <el-input v-model="returnForm.memo" type="textarea" :rows="2" placeholder="结算备注" />
        </div>

        <div v-else class="text-center py-10">
          <div class="text-3xl font-bold text-gray-900 mb-2">还车处理已提交</div>
          <div class="text-sm text-gray-500">订单状态、结算快照、合同单据和通知日志已写入。</div>
        </div>
      </template>
      <template #footer>
        <el-button @click="returnWizardVisible = false">{{ returnStep === 2 ? "关闭" : "暂停办理" }}</el-button>
        <el-button v-if="returnStep === 0" type="primary" color="#00689E" :loading="returnSubmitting" :disabled="!canSubmitReturnInspection" @click="submitReturnInspection">下一步</el-button>
        <el-button v-else-if="returnStep === 1" type="primary" color="#00689E" :loading="returnSubmitting" @click="submitReturnSettlement">
          {{ isMonthly ? "确认月结并还车" : "确认还车" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="returnLocationDialogVisible"
      :title="returnLocationMode === 'store' ? '改还车门市 / 转单' : '改还车据点'"
      width="720px"
      destroy-on-close
    >
      <template v-if="detail">
        <div v-loading="returnLocationLoading" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">取车门市</div>
              <div class="font-bold text-gray-800">{{ detail.pickupStoreName }}</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">当前还车门市</div>
              <div class="font-bold text-gray-800">
                {{ detail.returnStoreName }}
                <span v-if="detail.returnStationName" class="text-gray-500 font-normal">
                  / {{ detail.returnStationName }}
                </span>
              </div>
            </div>
          </div>

          <div class="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            确认后订单当前还车门市或据点会更新，新门市获得订单列表、详情和还车操作权限；差额进入费用中心。
          </div>
          <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            本期仅支持同车行内处理。若原还车门市存在后续预约占用，后端会阻断确认，需先改派后续订单。
          </div>

          <el-form label-position="top">
            <el-form-item v-if="returnLocationMode === 'store'" label="新还车门市">
              <el-select
                v-model="returnLocationForm.targetStoreName"
                class="w-full"
                placeholder="选择新还车门市"
                size="large"
                @change="resetReturnLocationConflict"
              >
                <el-option
                  v-for="storeName in returnStoreOptions"
                  :key="storeName"
                  :label="storeName"
                  :value="storeName"
                  :disabled="storeName === detail.returnStoreName"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-else label="新还车据点">
              <el-cascader
                v-model="returnLocationForm.targetStationPath"
                :options="returnStationOptions"
                class="w-full"
                clearable
                placeholder="选择门市与据点"
                size="large"
                @change="resetReturnLocationConflict"
              />
            </el-form-item>
            <el-form-item label="变更原因">
              <el-select
                v-model="returnLocationForm.reason"
                class="w-full"
                placeholder="选择变更原因"
                size="large"
              >
                <el-option
                  v-for="reason in returnLocationReasons"
                  :key="reason.value"
                  :label="returnLocationMode === 'station' ? reason.label.replace('门市', '据点') : reason.label"
                  :value="reason.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item :label="returnLocationForm.reason === 'other' ? '备注（必填）' : '备注'">
              <el-input
                v-model="returnLocationForm.memo"
                type="textarea"
                :rows="3"
                placeholder="记录客户说明、门店协商结果或异常情况"
              />
            </el-form-item>
          </el-form>

          <div
            v-if="returnLocationConflict.checked && returnLocationConflict.hasConflict"
            class="rounded border p-4"
            :class="returnLocationConflict.resolved ? 'border-green-100 bg-green-50' : 'border-red-200 bg-red-50'"
          >
            <div class="flex items-start gap-3">
              <el-icon
                class="text-xl mt-0.5"
                :class="returnLocationConflict.resolved ? 'text-green-600' : 'text-red-500'"
              >
                <CircleCheck v-if="returnLocationConflict.resolved" />
                <Warning v-else />
              </el-icon>
              <div class="flex-1">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h4 class="font-bold text-gray-800 text-sm mb-1">
                      {{ returnLocationConflict.resolved ? '后续订单已选择快捷改派车辆' : '原还车门市存在后续预约' }}
                    </h4>
                    <p
                      class="text-xs"
                      :class="returnLocationConflict.resolved ? 'text-green-700' : 'text-red-600'"
                    >
                      {{ detail.plateNo }} 改到 {{ targetReturnStoreName }} 后，原还车门市
                      {{ detail.returnStoreName }} 的后续订单需要先释放车辆占用。
                    </p>
                  </div>
                  <el-tag size="small" :type="returnLocationConflict.resolved ? 'success' : 'danger'">
                    {{ returnLocationConflict.resolved ? '已处理' : '需处理' }}
                  </el-tag>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                  <div class="bg-white/80 border rounded p-2">
                    <div class="text-gray-400">后续订单</div>
                    <div class="font-bold text-gray-800 mt-1">{{ returnLocationConflict.order?.orderNo }}</div>
                  </div>
                  <div class="bg-white/80 border rounded p-2">
                    <div class="text-gray-400">取车时间</div>
                    <div class="font-bold text-gray-800 mt-1">{{ returnLocationConflict.order?.pickupAt }}</div>
                  </div>
                  <div class="bg-white/80 border rounded p-2">
                    <div class="text-gray-400">客户</div>
                    <div class="font-bold text-gray-800 mt-1">{{ returnLocationConflict.order?.customerName }}</div>
                  </div>
                  <div class="bg-white/80 border rounded p-2">
                    <div class="text-gray-400">派车状态</div>
                    <div class="font-bold text-gray-800 mt-1">{{ dispatchLabel(returnLocationConflict.order?.dispatchStatus) }}</div>
                  </div>
                </div>
                <div class="flex items-center justify-between mt-3">
                  <div class="text-xs text-gray-600">
                    {{ returnLocationConflict.order?.plateNo }} ->
                    {{ returnLocationConflict.targetVehicle?.licensePlate || '暂无可用候选车' }}
                  </div>
                  <el-button
                    v-if="!returnLocationConflict.resolved"
                    type="danger"
                    size="small"
                    plain
                    @click="quickRedirectReturnLocationConflict"
                  >
                    快捷改派后续订单
                  </el-button>
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div class="rounded border border-gray-200 p-3">
              <div class="text-xs text-gray-500 mb-1">当前异地费</div>
              <div class="font-bold text-gray-800">{{ formatMoney(returnLocationCurrentFee) }}</div>
            </div>
            <div class="rounded border border-gray-200 p-3">
              <div class="text-xs text-gray-500 mb-1">新异地费</div>
              <div class="font-bold text-gray-800">{{ formatMoney(returnLocationNewFee) }}</div>
            </div>
            <div
              class="rounded border p-3"
              :class="returnLocationFeeDelta > 0 ? 'border-red-100 bg-red-50' : returnLocationFeeDelta < 0 ? 'border-green-100 bg-green-50' : 'border-gray-200 bg-gray-50'"
            >
              <div
                class="text-xs mb-1"
                :class="returnLocationFeeDelta > 0 ? 'text-red-500' : returnLocationFeeDelta < 0 ? 'text-green-600' : 'text-gray-500'"
              >
                本次差额
              </div>
              <div
                class="font-bold"
                :class="returnLocationFeeDelta > 0 ? 'text-red-600' : returnLocationFeeDelta < 0 ? 'text-green-700' : 'text-gray-800'"
              >
                {{ returnLocationFeeDelta >= 0 ? '+' : '-' }}{{ formatMoney(returnLocationFeeAbs) }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <el-button @click="returnLocationDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="actionLoading === 'change-return-store' || actionLoading === 'change-return-station'"
          :disabled="!canSubmitReturnLocationChange"
          @click="submitReturnLocationChange"
        >
          {{ returnLocationMode === 'store' ? '确认转单' : '确认改还车据点' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="redirectionDialogVisible"
      title="订单改派 & 车辆升级"
      width="850px"
      top="5vh"
      destroy-on-close
    >
      <template v-if="detail">
        <div v-loading="redirectionLoading" class="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 min-h-[520px]">
          <div class="flex flex-col min-h-0">
            <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 flex justify-between items-center">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-white rounded-full flex items-center justify-center text-gray-400 border border-gray-100">
                  <el-icon><Van /></el-icon>
                </div>
                <div>
                  <div class="text-xs text-gray-500">当前指派</div>
                  <div class="font-bold text-gray-800 text-sm">
                    {{ detail.vehicleGroupName }}
                    <span class="font-normal text-gray-400">{{ detail.plateNo || "待人工派车" }}</span>
                  </div>
                </div>
              </div>
              <div class="text-right">
                <div class="text-xs text-gray-500">日租金</div>
                <div class="font-bold text-gray-800">{{ formatMoney(redirectionDailyPrice(detail.vehicleGroupName)) }}</div>
              </div>
            </div>

            <el-segmented
              v-model="redirectionForm.selectionMode"
              :options="[
                { label: '手动选择', value: 'manual' },
                { label: '系统推荐', value: 'auto' }
              ]"
              class="mb-4"
            />

            <div v-if="redirectionForm.selectionMode === 'manual'" class="space-y-4">
              <div>
                <div class="text-sm font-bold text-gray-700 mb-2">选择车组</div>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <button
                    v-for="groupName in redirectionGroupNames"
                    :key="groupName"
                    type="button"
                    class="rounded-lg border px-3 py-2 text-sm text-left transition"
                    :class="redirectionForm.vehicleGroupName === groupName ? 'border-[#00689E] bg-blue-50 text-[#00689E]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'"
                    @click="redirectionForm.vehicleGroupName = groupName; redirectionForm.targetVehicleId = ''"
                  >
                    {{ groupName }}
                  </button>
                </div>
              </div>

              <el-form label-position="top">
                <el-form-item label="选择具体车辆">
                  <el-select
                    v-model="redirectionForm.targetVehicleId"
                    placeholder="请选择当前时段可用车辆"
                    filterable
                    class="w-full"
                    size="large"
                  >
                    <el-option
                      v-for="vehicle in availableRedirectionVehicles"
                      :key="vehicle.id"
                      :label="`${vehicle.vehicleGroupName} · ${vehicle.licensePlate}`"
                      :value="vehicle.id"
                    >
                      <div class="flex items-center justify-between gap-3 w-full">
                        <div class="min-w-0">
                          <div class="text-sm font-medium text-gray-800 truncate">
                            {{ vehicle.vehicleGroupName }} · {{ vehicle.licensePlate }}
                          </div>
                          <div class="text-xs text-gray-400 truncate">
                            {{ vehicle.assetCompanyName }} / {{ vehicle.currentStoreName }} - {{ vehicle.currentStationName }}
                          </div>
                        </div>
                        <div class="text-right shrink-0">
                          <div class="text-xs text-gray-500">{{ vehicle.operationStatus }}</div>
                          <div class="font-mono text-xs text-gray-500">{{ formatMoney(redirectionDailyPrice(vehicle.vehicleGroupName)) }}</div>
                        </div>
                      </div>
                    </el-option>
                  </el-select>
                </el-form-item>
              </el-form>
            </div>

            <div v-else class="space-y-3 max-h-[390px] overflow-y-auto pr-1">
              <button
                v-for="vehicle in recommendedRedirectionVehicles"
                :key="vehicle.id"
                type="button"
                class="w-full rounded-lg border p-3 flex justify-between items-center text-left transition"
                :class="redirectionForm.targetVehicleId === vehicle.id ? 'border-[#00689E] bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'"
                @click="selectRedirectionVehicle(vehicle)"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-11 h-11 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400 border border-gray-100">
                    <el-icon><Van /></el-icon>
                  </div>
                  <div class="min-w-0">
                    <div class="font-bold text-sm text-gray-800 truncate">{{ vehicle.vehicleGroupName }}</div>
                    <div class="flex gap-2 mt-1">
                      <el-tag size="small" effect="plain" round>
                        {{ redirectionSameGroup(vehicle.vehicleGroupName) ? "同组优先" : "可升级/降级" }}
                      </el-tag>
                      <span class="text-xs text-gray-400 font-mono pt-0.5">{{ vehicle.licensePlate }}</span>
                    </div>
                    <div class="text-xs text-gray-400 mt-1 truncate">
                      {{ vehicle.currentStoreName }} - {{ vehicle.currentStationName }}
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-bold text-gray-800">{{ formatMoney(redirectionDailyPrice(vehicle.vehicleGroupName)) }}</div>
                  <div class="text-xs" :class="redirectionSameGroup(vehicle.vehicleGroupName) ? 'text-green-600' : 'text-orange-600'">
                    {{ redirectionSameGroup(vehicle.vehicleGroupName) ? "价格不变" : "需试算差价" }}
                  </div>
                </div>
              </button>
            </div>

            <div class="mt-4 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              改派确认时后端会再次校验目标车辆状态、同车行限制和订单时段占用冲突。
            </div>
          </div>

          <div class="bg-slate-50 p-5 rounded-xl border border-gray-200 flex flex-col">
            <h4 class="font-bold text-gray-800 mb-4 border-b border-gray-200 pb-3 flex items-center gap-2">
              <el-icon class="text-[#00689E]"><Money /></el-icon>
              费用试算
            </h4>

            <div class="space-y-4 flex-1">
              <div class="bg-white p-3 rounded-lg border border-gray-100">
                <div class="flex justify-between items-center text-sm mb-2">
                  <span class="text-gray-500">{{ isMidRentalRedirection ? '原车剩余金额' : '原订单金额' }}</span>
                  <span class="font-mono text-gray-400 line-through">
                    {{ formatMoney(redirectionPeriodAmount(detail.vehicleGroupName)) }}
                  </span>
                </div>
                <div class="flex justify-between items-center text-sm">
                  <span class="text-gray-500">{{ isMidRentalRedirection ? '新车剩余金额' : '新方案金额' }}</span>
                  <span class="font-mono font-bold text-xl text-[#00689E]" v-if="selectedRedirectionVehicle">
                    {{ formatMoney(redirectionPeriodAmount(selectedRedirectionVehicle.vehicleGroupName)) }}
                  </span>
                  <span class="text-gray-300 font-mono" v-else>----</span>
                </div>
              </div>

              <div class="flex justify-between items-center px-2">
                <span class="text-gray-800 font-medium text-sm">预计差价</span>
                <div class="flex items-center gap-1">
                  <span
                    v-if="selectedRedirectionVehicle && redirectionRawDiff !== 0"
                    class="text-xs px-1.5 py-0.5 rounded"
                    :class="redirectionRawDiff > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'"
                  >
                    {{ isMonthly ? (redirectionRawDiff > 0 ? '月结调增' : '月结调减') : (redirectionRawDiff > 0 ? '需补款' : '需退款') }}
                  </span>
                  <span class="font-bold text-lg" :class="redirectionActualDiff > 0 ? 'text-red-500' : (redirectionActualDiff < 0 ? 'text-green-500' : 'text-gray-400')">
                    {{ selectedRedirectionVehicle ? (redirectionActualDiff > 0 ? '+' : '') + formatMoney(redirectionActualDiff) : '--' }}
                  </span>
                </div>
              </div>

              <div v-if="selectedRedirectionVehicle && !redirectionSameGroup(selectedRedirectionVehicle.vehicleGroupName)" class="bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                <div class="mb-2 font-bold text-xs text-indigo-900">差价处理规则</div>
                <el-radio-group v-model="redirectionForm.priceHandling" class="flex flex-col gap-2">
                  <el-radio label="diff">多退少补</el-radio>
                  <el-radio label="free" :disabled="redirectionRawDiff <= 0">免费升等</el-radio>
                </el-radio-group>
                <div class="mt-2 text-xs p-2 rounded-md border" :class="redirectionForm.priceHandling === 'free' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'">
                  {{ redirectionForm.priceHandling === 'free' ? '免费升等：不向客户收取差价，必须填写原因。' : `${redirectionSettlementText}：差价进入费用中心，不在改派时直接收退款。` }}
                </div>
              </div>

              <div v-else-if="selectedRedirectionVehicle" class="bg-green-50 p-3 rounded-lg border border-green-100 text-green-700 text-xs">
                同车组换车，保留原订单计费口径，价格不变。
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-gray-200">
              <el-select v-model="redirectionForm.reason" placeholder="选择改派原因" class="w-full mb-3" size="large">
                <el-option
                  v-for="reason in redirectionReasons"
                  :key="reason.value"
                  :label="reason.label"
                  :value="reason.value"
                />
              </el-select>
              <el-input
                v-model="redirectionForm.memo"
                :placeholder="redirectionForm.priceHandling === 'free' || redirectionForm.reason === 'other' ? '请填写原因说明（必填）' : '填写改派备注（可选）'"
                type="textarea"
                :rows="2"
                resize="none"
                class="mb-3"
              />
              <el-checkbox v-model="redirectionForm.managerOverride" class="mb-3">
                存在未结清费用时由店长授权继续
              </el-checkbox>
              <div class="flex gap-3">
                <el-button @click="redirectionDialogVisible = false" class="flex-1">取消</el-button>
                <el-button
                  type="primary"
                  color="#00689E"
                  class="flex-1"
                  :disabled="!canSubmitRedirection"
                  :loading="actionLoading === 'redirect-order'"
                  @click="submitRedirection"
                >
                  确认改派
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="extendDialogVisible"
      :title="detail?.mainStatus === OrderMainStatus.Overdue ? '补办续租' : '延长用车'"
      width="760px"
      destroy-on-close
    >
      <template v-if="detail">
        <div class="space-y-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">当前预计还车</div>
              <div class="font-mono text-gray-900">{{ detail.returnAt }}</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">延长时长</div>
              <div class="font-bold text-gray-900">{{ extensionHours }} 小时</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">计费天数</div>
              <div class="font-bold text-gray-900">{{ extensionBillableDays }} 天</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">续租租金</div>
              <div class="font-mono font-bold text-[#00689E]">{{ formatMoney(extensionAmount) }}</div>
            </div>
          </div>

          <el-form label-position="top">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <el-form-item label="新预计还车时间">
                <el-date-picker
                  v-model="extensionForm.newReturnAt"
                  type="datetime"
                  format="YYYY-MM-DD HH:mm"
                  value-format="YYYY-MM-DDTHH:mm:ssZ"
                  class="w-full"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="操作人">
                <el-input v-model="extensionForm.operator" />
              </el-form-item>
            </div>

            <div
              v-if="extensionConflict"
              class="rounded border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 mb-4"
            >
              库存冲突：车辆 {{ detail.plateNo }} 后续订单 {{ extensionConflict.orderNo }} 将于
              {{ extensionConflict.pickupAt }} 取车，最迟可延长至 {{ extensionLatestReturnAt }}。
            </div>
            <div v-else class="rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 mb-4">
              库存检测：当前车辆在延长时段加 60 分钟订单间隔内未发现后续占用冲突。
            </div>

            <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700 mb-4">
              费用试算：按订单计费快照代理口径计算新增租期，确认后生成“续租租金”费用项和事件级续租快照。
              <span v-if="extensionImmediateReasons.length">
                必须立即收款：{{ extensionImmediateReasons.join("、") }}。
              </span>
            </div>

            <template v-if="detail.billingMode === BillingMode.Monthly">
              <div class="rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700 mb-4">
                结算方式：企业月结。续租费用随还车最终应收进入企业月结账单，不发起客户收款。
              </div>
            </template>
            <template v-else>
              <el-form-item label="结算方式">
                <el-radio-group v-model="extensionForm.settlementMode">
                  <el-radio label="immediate">立即收款</el-radio>
                  <el-radio
                    label="return_settlement"
                    :disabled="extensionImmediateReasons.length > 0"
                  >
                    还车时结算
                  </el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item v-if="extensionForm.settlementMode === 'immediate'" label="收款确认">
                <el-switch
                  v-model="extensionForm.paymentPaid"
                  active-text="已完成续租收款"
                  inactive-text="未收款"
                />
              </el-form-item>
            </template>

            <el-form-item label="备注">
              <el-input
                v-model="extensionForm.memo"
                type="textarea"
                :rows="3"
                placeholder="记录客户说明、补充协议或门店处理说明"
              />
            </el-form-item>
          </el-form>
        </div>
      </template>
      <template #footer>
        <el-button @click="extendDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          color="#00689E"
          :disabled="!canSubmitExtension"
          :loading="actionLoading === 'extend-rental'"
          @click="submitExtension"
        >
          确认延长
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="accidentDialogVisible"
      title="事故登记"
      width="760px"
      destroy-on-close
    >
      <template v-if="detail">
        <div
          class="mb-4 rounded-lg border px-4 py-3 text-sm"
          :class="isMonthly ? 'bg-purple-50 border-purple-100 text-purple-700' : 'bg-red-50 border-red-100 text-red-700'"
        >
          <div class="font-bold">{{ accidentContextHint.title }}</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-xs">
            <div class="bg-white/80 border border-gray-200 rounded px-2 py-1">
              <span class="opacity-70">订单影响</span>
              <span class="font-bold ml-1">{{ accidentContextHint.status }}</span>
            </div>
            <div class="bg-white/80 border border-gray-200 rounded px-2 py-1">
              <span class="opacity-70">费用处理</span>
              <span class="font-bold ml-1">{{ accidentContextHint.fee }}</span>
            </div>
            <div class="bg-white/80 border border-gray-200 rounded px-2 py-1">
              <span class="opacity-70">当前车辆</span>
              <span class="font-bold ml-1">{{ detail.plateNo || "待人工派车" }}</span>
            </div>
          </div>
          <div class="text-xs mt-2 opacity-90">{{ accidentContextHint.desc }}</div>
        </div>

        <el-form :model="accidentForm" label-position="top">
          <el-form-item label="事故详情描述" required>
            <el-input
              v-model="accidentForm.description"
              type="textarea"
              :rows="3"
              placeholder="请详细描述事故部位、程度及原因..."
            />
          </el-form-item>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <el-form-item label="事故时间" required>
              <el-date-picker
                v-model="accidentForm.accidentAt"
                type="datetime"
                format="YYYY-MM-DD HH:mm"
                value-format="YYYY-MM-DDTHH:mm:ssZ"
                placeholder="选择事故时间"
                class="w-full"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="事故地点">
              <el-input
                v-model="accidentForm.location"
                placeholder="事故发生地点或停车位置"
              />
            </el-form-item>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <el-form-item label="责任归属" required>
              <el-select
                v-model="accidentForm.responsibility"
                placeholder="请选择责任归属"
                class="w-full"
              >
                <el-option
                  v-for="option in accidentResponsibilityOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="预估费用">
              <el-input-number
                v-model="accidentForm.estimatedAmount"
                :min="0"
                :step="100"
                class="!w-full"
                controls-position="right"
              />
            </el-form-item>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <el-form-item label="处理状态" required>
              <el-select v-model="accidentForm.handlingStatus" class="w-full">
                <el-option
                  v-for="option in accidentHandlingStatusOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="保险报案号">
              <el-input
                v-model="accidentForm.insuranceNo"
                placeholder="已报案时填写"
              />
            </el-form-item>
          </div>
          <el-form-item label="处理备注">
            <el-input
              v-model="accidentForm.remark"
              type="textarea"
              :rows="2"
              placeholder="填写保险报案、客户沟通或门店处理说明..."
            />
          </el-form-item>
          <el-form-item label="现场照片">
            <el-upload action="#" list-type="picture-card" :auto-upload="false" :limit="5">
              <el-icon><Plus /></el-icon>
            </el-upload>
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="accidentDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          color="#00689E"
          :disabled="!canSubmitAccident"
          :loading="actionLoading === 'register-accident'"
          @click="submitAccident"
        >
          确认登记
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="terminationDialogVisible"
      :title="terminationDialogTitle(pendingTerminationAction)"
      width="760px"
      destroy-on-close
    >
      <template v-if="detail">
        <div class="space-y-4">
          <div
            class="rounded border px-3 py-2 text-sm"
            :class="pendingTerminationAction === 'close-order' ? 'border-red-100 bg-red-50 text-red-700' : 'border-amber-100 bg-amber-50 text-amber-700'"
          >
            <template v-if="pendingTerminationAction === 'cancel'">订单取消后将无法恢复。</template>
            <template v-else-if="pendingTerminationAction === 'mark-no-show'">标记爽约后将释放车辆资源，并按爽约规则处理费用。</template>
            <template v-else-if="pendingTerminationAction === 'reject-order'">取车资质不通过，拒绝交车后订单将终止。</template>
            <template v-else>高风险操作。关闭订单仅用于客户无责异常关闭，确认后不可恢复。</template>
          </div>

          <div class="grid grid-cols-3 gap-3 text-sm">
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">当前状态</div>
              <div class="font-bold text-gray-900">{{ statusLabel(detail.mainStatus) }}</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">取车时间</div>
              <div class="font-mono text-gray-900">{{ detail.pickupAt }}</div>
            </div>
            <div class="rounded border border-gray-200 bg-gray-50 p-3">
              <div class="text-xs text-gray-500 mb-1">距取车时间</div>
              <div class="font-bold text-gray-900">{{ formatHourDistance(hoursBeforePickup) }}</div>
            </div>
          </div>

          <template v-if="pendingTerminationAction === 'cancel'">
            <div v-if="detail.billingMode === BillingMode.Monthly" class="rounded border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
              <div class="font-bold mb-2">企业月结取消处理</div>
              <div class="grid grid-cols-3 gap-3">
                <div>预计月结金额<br><b>{{ formatMoney(detail.totalAmount) }}</b></div>
                <div>取消费<br><b>{{ formatMoney(cancelFeeAmount) }}</b></div>
                <div>企业账单金额<br><b>{{ formatMoney(cancelFeeAmount) }}</b></div>
              </div>
              <div class="mt-2 text-xs">客户支付与预授权：不处理。</div>
            </div>
            <div v-else class="rounded border border-gray-200 p-4 text-sm">
              <div class="flex items-center gap-2 mb-3">
                <el-tag :type="cancelTypeLabel === '免责取消' ? 'success' : 'warning'" effect="plain">
                  {{ cancelTypeLabel }}
                </el-tag>
                <el-checkbox v-model="terminationForm.specialWaiver">申请特殊减免</el-checkbox>
              </div>
              <div class="grid grid-cols-4 gap-3">
                <div>已收金额<br><b>{{ formatMoney(terminalPaidAmount) }}</b></div>
                <div>取消费<br><b>{{ formatMoney(cancelFeeAmount) }}</b></div>
                <div>预授权处理<br><b>{{ cancelFeeAmount > 0 ? '扣款后释放余额' : '全额释放' }}</b></div>
                <div>退款金额<br><b>{{ formatMoney(cancelRefundAmount) }}</b></div>
              </div>
              <el-form-item v-if="terminationForm.specialWaiver" label="特殊减免说明" class="mt-4 mb-0">
                <el-input v-model="terminationForm.waiverReason" placeholder="请输入减免说明" />
              </el-form-item>
            </div>
            <el-form label-position="top">
              <el-form-item label="取消原因">
                <el-select v-model="terminationForm.reason" class="w-full">
                  <el-option label="行程变更" value="行程变更" />
                  <el-option label="价格问题" value="价格问题" />
                  <el-option label="预订错误" value="预订错误" />
                  <el-option v-if="terminationForm.specialWaiver" label="系统故障 (减免)" value="系统故障" />
                  <el-option v-if="terminationForm.specialWaiver" label="客户投诉补偿 (减免)" value="客户投诉补偿" />
                  <el-option label="其他" value="其他" />
                </el-select>
              </el-form-item>
            </el-form>
          </template>

          <template v-else-if="pendingTerminationAction === 'mark-no-show'">
            <div class="rounded border border-gray-200 p-4 text-sm">
              <div class="grid grid-cols-4 gap-3">
                <div>取车时间<br><b>{{ detail.pickupAt }}</b></div>
                <div>保留时长<br><b>2 小时</b></div>
                <div>爽约费<br><b>{{ formatMoney(noShowFeeAmount) }}</b></div>
                <div>{{ isMonthly ? '企业账单金额' : '待补缴金额' }}<br><b>{{ formatMoney(isMonthly ? noShowFeeAmount : noShowPaymentDue) }}</b></div>
              </div>
              <div class="mt-2 text-xs text-gray-500">费用规则：固定金额。客户自付优先从预授权扣款并释放余额。</div>
            </div>
            <el-form label-position="top">
              <el-form-item label="联系结果">
                <el-select v-model="terminationForm.contactResult" class="w-full">
                  <el-option label="客户确认不取车" value="客户确认不取车" />
                  <el-option label="多次联系无回应" value="多次联系无回应" />
                  <el-option label="客户超时未到店" value="客户超时未到店" />
                  <el-option label="其他" value="其他" />
                </el-select>
              </el-form-item>
            </el-form>
          </template>

          <template v-else-if="pendingTerminationAction === 'reject-order'">
            <div class="rounded border border-gray-200 p-4 text-sm">
              <div class="grid grid-cols-3 gap-3">
                <div>预授权处理<br><b>{{ terminationForm.rejectionFeeAmount > 0 ? '扣款后释放余额' : '全额释放' }}</b></div>
                <div>{{ isMonthly ? '企业月结金额' : '待补缴金额' }}<br><b>{{ formatMoney(isMonthly ? terminationForm.rejectionFeeAmount : rejectionPaymentDue) }}</b></div>
                <div>车辆资源<br><b>释放</b></div>
              </div>
            </div>
            <el-form label-position="top">
              <div class="grid grid-cols-2 gap-4">
                <el-form-item label="拒绝履约费用">
                  <el-input-number v-model="terminationForm.rejectionFeeAmount" :min="0" :step="50" class="w-full" />
                </el-form-item>
                <el-form-item label="拒绝原因">
                  <el-select v-model="terminationForm.reason" class="w-full">
                    <el-option label="黑名单命中" value="黑名单命中" />
                    <el-option label="驾照过期" value="驾照过期" />
                    <el-option label="证件异常" value="证件异常" />
                    <el-option label="预授权失败" value="预授权失败" />
                    <el-option label="风控拒绝" value="风控拒绝" />
                    <el-option label="其他" value="其他" />
                  </el-select>
                </el-form-item>
              </div>
            </el-form>
          </template>

          <template v-else>
            <div v-if="detail.billingMode === BillingMode.Monthly" class="rounded border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-800">
              <div class="font-bold mb-2">企业月结关闭处理</div>
              <div>关闭订单将释放车辆资源，不产生客户退款，不生成企业月结账单。</div>
            </div>
            <div v-else class="rounded border border-gray-200 p-4 text-sm">
              <div class="grid grid-cols-3 gap-3">
                <div>退款项目<br><b>已收订单款</b></div>
                <div>合计退款<br><b>{{ formatMoney(closeRefundAmount) }}</b></div>
                <div>预授权处理<br><b>全额释放</b></div>
              </div>
            </div>
            <el-form label-position="top">
              <el-form-item label="关闭原因">
                <el-select v-model="terminationForm.reason" class="w-full">
                  <el-option label="车辆严重故障" value="车辆严重故障" />
                  <el-option label="客户重大投诉" value="客户重大投诉" />
                  <el-option label="不可抗力" value="不可抗力" />
                  <el-option label="其他" value="其他" />
                </el-select>
              </el-form-item>
              <el-checkbox v-model="terminationForm.customerCommunicationConfirmed">
                {{ isMonthly ? '我确认已与企业或客户沟通并同意关闭订单' : '我确认已与客户沟通并同意全额退款' }}
              </el-checkbox>
            </el-form>
          </template>

          <el-form label-position="top">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <el-form-item label="操作人">
                <el-input v-model="terminationForm.operator" />
              </el-form-item>
            </div>
            <el-form-item :label="pendingTerminationAction === 'mark-no-show' ? '联系备注' : '备注'">
              <el-input v-model="terminationForm.memo" type="textarea" :rows="3" />
            </el-form-item>
          </el-form>
        </div>
      </template>
      <template #footer>
        <el-button @click="terminationDialogVisible = false">
          {{ pendingTerminationAction === 'reject-order' ? '返回取车' : pendingTerminationAction === 'mark-no-show' ? '暂不标记' : pendingTerminationAction === 'cancel' ? '暂不取消' : '取消' }}
        </el-button>
        <el-button
          type="primary"
          color="#00689E"
          :disabled="!canSubmitTermination"
          :loading="actionLoading === pendingTerminationAction"
          @click="submitTerminationAction"
        >
          {{ terminationConfirmLabel(pendingTerminationAction) }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="feeModalVisible" title="费用管理" width="1080px" top="4vh" destroy-on-close>
      <template v-if="detail">
        <div class="grid grid-cols-4 gap-3 mb-4 text-xs">
          <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            合计应收<br><b class="text-base">{{ formatMoney(detail.financialOverview.totalReceivableAmount) }}</b>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            客户实收<br><b class="text-base">{{ formatMoney(detail.financialOverview.customerReceivedAmount) }}</b>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            待处理<br><b class="text-base">{{ formatMoney(detail.financialOverview.pendingAmount) }}</b>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
            待退款<br><b class="text-base">{{ formatMoney(detail.financialOverview.refundAmount) }}</b>
          </div>
        </div>

        <div class="rounded border px-3 py-2 text-xs mb-4" :class="isMonthly ? 'border-indigo-100 bg-indigo-50 text-indigo-700' : 'border-green-100 bg-green-50 text-green-700'">
          {{ isMonthly ? "企业月结订单不向客户发起支付、预授权、收款或退款；费用确认后进入企业月结账单。" : "客户自付订单的预授权、收款、退款、减免和追缴都必须保留资金记录。" }}
        </div>

        <el-tabs v-model="activeFeeTab">
          <el-tab-pane label="收费明细" name="overview">
            <div class="flex justify-between items-center mb-3">
              <div class="text-sm text-gray-500">费用项和资金记录分离，费用项只表达业务金额。</div>
              <el-button
                v-if="canManageOrderFees"
                type="primary"
                color="#00689E"
                icon="Plus"
                @click="openCreateFeeDialog"
              >
                新增费用
              </el-button>
            </div>
            <el-table :data="detail.feeLedgerItems" border style="width: 100%">
              <el-table-column label="费用项" min-width="220">
                <template #default="{ row }">
                  <div class="font-bold text-gray-800">{{ row.name }}</div>
                  <div class="text-xs text-gray-500 mt-1">{{ row.description }}</div>
                  <div class="text-xs text-gray-400 mt-1">快照：{{ row.snapshotRef }}</div>
                </template>
              </el-table-column>
              <el-table-column label="阶段/来源" width="150">
                <template #default="{ row }">
                  <div>{{ feeStageLabel(row.stage) }}</div>
                  <div class="text-xs text-gray-500 mt-1">{{ feeSourceLabel(row.source) }}</div>
                </template>
              </el-table-column>
              <el-table-column label="方向" width="90">
                <template #default="{ row }">{{ feeDirectionLabel(row.direction) }}</template>
              </el-table-column>
              <el-table-column label="金额" width="120" align="right">
                <template #default="{ row }">
                  <span class="font-mono font-bold">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="待处理" width="120" align="right">
                <template #default="{ row }">{{ formatMoney(row.pendingAmount) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag size="small" :type="feeStatusType(row.status)" effect="plain">
                    {{ feeStatusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button
                    v-if="canManageOrderFees && row.status === 'pending' && row.direction === 'charge'"
                    type="primary"
                    link
                    @click="openWaiveFeeDialog(row.id, row.name, row.pendingAmount || row.amount)"
                  >
                    减免
                  </el-button>
                  <el-button type="primary" link @click="showReservedFeeAction('费用明细查看')">
                    明细
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="资金记录" name="transactions">
            <div class="flex justify-between items-center mb-3">
              <div class="text-sm text-gray-500">资金动作真实写入后端 mock 账本。</div>
              <div class="flex gap-2">
                <el-button
                  v-if="canManageOrderFees && !isMonthly"
                  plain
                  icon="Money"
                  @click="openTransactionDialog('payment')"
                >
                  登记收款
                </el-button>
                <el-button
                  v-if="canManageOrderFees && !isMonthly"
                  plain
                  icon="RefreshLeft"
                  @click="openTransactionDialog('refund')"
                >
                  登记退款
                </el-button>
                <el-button
                  v-if="canManageOrderFees && isMonthly"
                  plain
                  icon="Tickets"
                  @click="openTransactionDialog('monthly_bill')"
                >
                  登记月结
                </el-button>
              </div>
            </div>
            <el-table :data="detail.transactionRecords" border style="width: 100%">
              <el-table-column label="类型" width="140">
                <template #default="{ row }">{{ transactionTypeLabel(row.type) }}</template>
              </el-table-column>
              <el-table-column label="渠道" width="130">
                <template #default="{ row }">{{ transactionChannelLabel(row.channel) }}</template>
              </el-table-column>
              <el-table-column label="金额" width="120" align="right">
                <template #default="{ row }">
                  <span class="font-mono font-bold">{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag size="small" :type="transactionStatusType(row.status)" effect="plain">
                    {{ transactionStatusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="operator" label="操作人" width="130" />
              <el-table-column prop="at" label="时间" width="190" />
              <el-table-column prop="note" label="说明" min-width="220" />
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="发票记录" name="invoices">
            <div v-if="invoiceDocuments.length" class="divide-y divide-gray-100">
              <div v-for="record in invoiceDocuments" :key="record.id" class="py-3 text-sm">
                <div class="flex justify-between gap-3">
                  <div>
                    <el-tag size="small" :type="record.type === 'invoice' ? 'success' : 'info'" effect="plain" class="mr-2">
                      {{ record.type === "invoice" ? "发票" : "收据" }}
                    </el-tag>
                    <span class="font-medium text-gray-800">{{ record.title || record.documentNo }}</span>
                    <div class="text-xs text-gray-500 mt-1">{{ record.documentNo }} · {{ invoiceStatusLabel(record.status) }}</div>
                    <div v-if="record.relatedFeeIds && record.relatedFeeIds.length" class="text-xs text-gray-400 mt-1">
                      关联费用：{{ record.relatedFeeIds.join(", ") }}
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="font-mono font-bold">{{ formatMoney(record.amount) }}</div>
                    <div class="text-xs text-gray-400 mt-1">{{ record.issuedAt }}</div>
                  </div>
                </div>
              </div>
            </div>
            <el-empty v-else description="暂无发票记录" :image-size="60" />
          </el-tab-pane>

          <el-tab-pane label="费用审计" name="audit">
            <el-table :data="feeAuditRows" border style="width: 100%">
              <el-table-column prop="at" label="时间" width="190" />
              <el-table-column prop="action" label="动作" width="120" />
              <el-table-column prop="detail" label="详情" min-width="320" />
              <el-table-column prop="operator" label="操作人" width="140" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-dialog>

    <el-dialog v-model="contractDialogVisible" title="登记合同 / 单据" width="560px" destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="单据类型">
            <el-select v-model="contractForm.type" class="w-full" @change="contractForm.title = contractTypeLabel(contractForm.type)">
              <el-option label="租赁合约" value="rental_contract" />
              <el-option label="取车交接单" value="pickup_sheet" />
              <el-option label="还车交接单" value="return_sheet" />
              <el-option label="结算单" value="settlement_sheet" />
            </el-select>
          </el-form-item>
          <el-form-item label="签署状态">
            <el-select v-model="contractForm.status" class="w-full">
              <el-option label="待签署" value="pending" />
              <el-option label="已签署" value="signed" />
              <el-option label="纸本已上传" value="fallback_uploaded" />
              <el-option label="已作废" value="voided" />
            </el-select>
          </el-form-item>
          <el-form-item label="单据标题">
            <el-input v-model="contractForm.title" />
          </el-form-item>
          <el-form-item label="签署方式">
            <el-select v-model="contractForm.signMethod" class="w-full">
              <el-option label="App 签署" value="app" />
              <el-option label="柜台签名" value="counter" />
              <el-option label="线下纸本" value="offline_paper" />
              <el-option label="系统生成" value="system" />
            </el-select>
          </el-form-item>
          <el-form-item label="签署人">
            <el-input v-model="contractForm.signerName" />
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="contractForm.operator" />
          </el-form-item>
        </div>
        <el-form-item label="附件地址">
          <el-input v-model="contractForm.fileUrl" placeholder="MVP 可填写线下合同照片或文件 URL" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="contractDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="fulfillmentActionLoading === 'contract'" @click="submitContract">
          保存单据
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="notificationDialogVisible" title="记录客户通知" width="560px" destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="通知场景">
            <el-select v-model="notificationForm.scene" class="w-full">
              <el-option label="订单创建" value="order_created" />
              <el-option label="取车完成" value="pickup_completed" />
              <el-option label="还车完成" value="return_completed" />
              <el-option label="待补缴" value="payment_due" />
              <el-option label="完成后追缴" value="post_charge" />
              <el-option label="订单终止" value="order_terminal" />
              <el-option label="人工通知" value="manual" />
            </el-select>
          </el-form-item>
          <el-form-item label="渠道">
            <el-select v-model="notificationForm.channel" class="w-full">
              <el-option label="短信" value="sms" />
              <el-option label="App" value="app" />
              <el-option label="Email" value="email" />
              <el-option label="人工" value="manual" />
            </el-select>
          </el-form-item>
          <el-form-item label="接收对象">
            <el-input v-model="notificationForm.target" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="notificationForm.status" class="w-full">
              <el-option label="待发送" value="pending" />
              <el-option label="已发送" value="sent" />
              <el-option label="失败" value="failed" />
              <el-option label="已跳过" value="skipped" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="内容">
          <el-input v-model="notificationForm.content" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-input v-model="notificationForm.operator" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="notificationDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="fulfillmentActionLoading === 'notification'" @click="submitNotification">
          保存通知
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="remarkDialogVisible" title="订单备注 / 跟进" width="640px" destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="分类">
            <el-select v-model="remarkForm.category" class="w-full">
              <el-option label="通用" value="general" />
              <el-option label="取车" value="pickup" />
              <el-option label="还车" value="return" />
              <el-option label="财务" value="finance" />
              <el-option label="风险" value="risk" />
              <el-option label="内部备注" value="internal_note" />
              <el-option label="客户备注" value="customer_note" />
              <el-option label="回访记录" value="return_visit" />
              <el-option label="履约跟进" value="fulfillment_followup" />
              <el-option label="客户跟进" value="customer_followup" />
            </el-select>
          </el-form-item>
          <el-form-item label="可见范围">
            <el-select v-model="remarkForm.visibility" class="w-full">
              <el-option label="内部可见" value="internal" />
              <el-option label="客户可见" value="customer_visible" />
            </el-select>
          </el-form-item>
          <el-form-item label="跟进时间">
            <el-input v-model="remarkForm.followUpAt" placeholder="YYYY-MM-DD HH:mm" />
          </el-form-item>
          <el-form-item label="提醒时间">
            <el-input v-model="remarkForm.reminderAt" placeholder="YYYY-MM-DD HH:mm" />
          </el-form-item>
          <el-form-item label="责任人">
            <el-input v-model="remarkForm.responsibleName" placeholder="填写跟进责任人" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="remarkForm.status" class="w-full">
              <el-option label="待跟进" value="open" />
              <el-option label="已关闭" value="closed" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="备注内容">
          <el-input v-model="remarkForm.content" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-input v-model="remarkForm.operator" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="remarkDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="fulfillmentActionLoading === 'remark'" @click="submitRemark">
          保存备注
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createFeeDialogVisible" title="新增费用" width="560px" destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="费用名称">
            <el-input v-model="createFeeForm.name" />
          </el-form-item>
          <el-form-item label="费用编码">
            <el-input v-model="createFeeForm.code" />
          </el-form-item>
          <el-form-item label="费用阶段">
            <el-select v-model="createFeeForm.stage" class="w-full">
              <el-option label="取车" value="pickup" />
              <el-option label="租期费用" value="rental" />
              <el-option label="还车结算" value="return_settlement" />
              <el-option label="取消/爽约" value="cancellation" />
              <el-option label="完成后追缴" value="post_charge" />
            </el-select>
          </el-form-item>
          <el-form-item label="金额方向">
            <el-select v-model="createFeeForm.direction" class="w-full">
              <el-option label="应收" value="charge" />
              <el-option label="应退" value="refund" />
              <el-option label="减免" value="waiver" />
            </el-select>
          </el-form-item>
          <el-form-item label="金额">
            <el-input-number v-model="createFeeForm.amount" :min="0" :step="50" class="w-full" />
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="createFeeForm.operator" />
          </el-form-item>
        </div>
        <el-form-item label="费用说明">
          <el-input v-model="createFeeForm.description" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createFeeDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="feeActionLoading === 'create-fee'" @click="submitCreateFee">
          保存费用
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="waiveFeeDialogVisible" title="费用减免" width="520px" destroy-on-close>
      <el-form label-position="top">
        <div class="rounded border border-amber-100 bg-amber-50 text-amber-700 px-3 py-2 text-xs mb-4">
          当前减免费用：{{ selectedFeeName }}。减免会写入资金记录和费用审计。
        </div>
        <el-form-item label="减免金额">
          <el-input-number v-model="waiveFeeForm.amount" :min="0" :step="50" class="w-full" />
        </el-form-item>
        <el-form-item label="操作人">
          <el-input v-model="waiveFeeForm.operator" />
        </el-form-item>
        <el-form-item label="减免原因">
          <el-input v-model="waiveFeeForm.reason" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="waiveFeeDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="feeActionLoading === 'waive-fee'" @click="submitWaiveFee">
          确认减免
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="transactionDialogVisible" :title="transactionTypeLabel(pendingTransactionType)" width="560px" destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="渠道">
            <el-select v-model="transactionForm.channel" class="w-full">
              <el-option label="线上支付" value="online" />
              <el-option label="线下收退款" value="offline" />
              <el-option label="内部记账" value="internal" />
            </el-select>
          </el-form-item>
          <el-form-item label="金额">
            <el-input-number v-model="transactionForm.amount" :min="0" :step="50" class="w-full" />
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="transactionForm.operator" />
          </el-form-item>
        </div>
        <el-form-item label="说明">
          <el-input v-model="transactionForm.note" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transactionDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="feeActionLoading === 'transaction'" @click="submitTransaction">
          确认登记
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
