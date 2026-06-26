<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  BillingMode,
  DispatchStatus,
  OrderMainStatus,
  PaymentStatus,
  StoreRentalMode,
  type PlatformFilterPreset,
  type StoreRentalOrderDetail,
  type StoreRentalOrderSummary
} from "@store-rental/shared";
import {
  deletePlatformFilterPreset,
  getStoreRentalOrder,
  listPlatformFilterPresets,
  listStoreRentalOrders,
  runStoreRentalOrderAction,
  savePlatformFilterPreset,
  setPlatformFilterPresetDefault
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const detailVisible = ref(false);
const detailLoading = ref(false);
const actionLoading = ref("");
const statsView = ref<"overview" | "task">("overview");
const activeStatFilter = ref("");
const searchPanelExpanded = ref(false);
const rows = ref<StoreRentalOrderSummary[]>([]);
const selectedOrder = ref<StoreRentalOrderDetail | null>(null);
const actionDialogVisible = ref(false);
const pendingAction = ref("");
const pendingActionRow = ref<StoreRentalOrderSummary | null>(null);
const filterPresetScope = "store-rental.orders" as const;
const filterPresets = ref<PlatformFilterPreset[]>([]);
const selectedFilterPresetId = ref("");
const filterPresetLoading = ref(false);

const actionForm = reactive({
  operator: "营运端",
  plateNo: "",
  mileage: 0,
  returnMileage: 0,
  fuelLevelPercent: 80,
  batteryLevelPercent: 80,
  cleanliness: "normal",
  damageFound: false,
  damageDescription: "",
  missingItems: "",
  photoCount: 6,
  customerSigned: true,
  overtimeFeeAmount: 0,
  extraMileageFeeAmount: 0,
  damageFeeAmount: 0,
  cleaningFeeAmount: 0,
  discountAmount: 0,
  finalReceivableAmount: 0,
  monthlyBillingPosted: true,
  newReturnAt: "",
  extensionSettlementMode: "return_settlement" as "immediate" | "return_settlement" | "monthly",
  extensionPaymentPaid: false,
  reason: "",
  contactResult: "",
  specialWaiver: false,
  waiverReason: "",
  memo: ""
});

const filters = reactive({
  keyword: "",
  clientType: "",
  billingMode: "",
  status: [] as string[],
  dateRange: [] as string[],
  postChargeStatus: "",
  riskFlag: "",
  pickupStore: "",
  returnStore: ""
});

const stores = ["旺角门市", "中环门市", "机场门市", "九龙湾自助点"];

const fallbackRows: StoreRentalOrderSummary[] = [
  {
    id: "order_local_001",
    orderNo: "SR202605060001",
    mode: StoreRentalMode.Store,
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
  }
];

const overviewStats = computed(() => [
  { key: "all", label: "全部订单", count: rows.value.length, color: "text-gray-900" },
  { key: "reserved", label: "待取车", count: countByStatus([OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue, OrderMainStatus.Inspecting]), color: "text-blue-600" },
  { key: "renting", label: "用车中", count: countByStatus([OrderMainStatus.Renting]), color: "text-emerald-600" },
  { key: "settlement_pending", label: "待结算", count: countByStatus([OrderMainStatus.SettlementPending]), color: "text-orange-600" },
  { key: "pending_payment", label: "待支付", count: countByStatus([OrderMainStatus.PendingPayment]), color: "text-amber-600" },
  { key: "risk", label: "风险订单", count: rows.value.filter((row) => row.riskFlags.length > 1).length, color: "text-red-600" },
  { key: "monthly", label: "企业月结", count: rows.value.filter((row) => row.billingMode === BillingMode.Monthly).length, color: "text-indigo-600" },
  { key: "completed", label: "已完成", count: countByStatus([OrderMainStatus.Completed]), color: "text-gray-500" }
]);

const taskStats = computed(() => [
  { key: "pickup_today", label: "今日取车", count: countByStatus([OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue, OrderMainStatus.Inspecting]), color: "text-blue-600" },
  { key: "return_today", label: "今日还车", count: countByStatus([OrderMainStatus.Renting]), color: "text-emerald-600" },
  { key: "settle_today", label: "今日结算", count: countByStatus([OrderMainStatus.SettlementPending]), color: "text-orange-600" },
  { key: "manual_dispatch", label: "人工调度", count: rows.value.filter((row) => row.dispatchStatus === DispatchStatus.ManualRequired).length, color: "text-red-600" },
  { key: "payment_due", label: "待收款", count: rows.value.filter((row) => row.paymentStatus === PaymentStatus.Unpaid).length, color: "text-amber-600" },
  { key: "monthly", label: "月结入账", count: rows.value.filter((row) => row.billingMode === BillingMode.Monthly).length, color: "text-indigo-600" },
  { key: "locked", label: "已锁车", count: rows.value.filter((row) => row.dispatchStatus === DispatchStatus.Locked).length, color: "text-green-600" },
  { key: "all", label: "全部作业", count: rows.value.length, color: "text-gray-900" }
]);

const currentStats = computed(() =>
  statsView.value === "overview" ? overviewStats.value : taskStats.value
);
const pendingExtensionHours = computed(() => {
  const row = pendingActionRow.value;
  if (!row || !actionForm.newReturnAt) {
    return 0;
  }
  const oldReturnAt = new Date(row.returnAt);
  const newReturnAt = new Date(actionForm.newReturnAt);
  if (!Number.isFinite(oldReturnAt.getTime()) || !Number.isFinite(newReturnAt.getTime())) {
    return 0;
  }

  return Math.max(0, Math.ceil((newReturnAt.getTime() - oldReturnAt.getTime()) / 3_600_000));
});
const pendingExtensionBillableDays = computed(() =>
  pendingExtensionHours.value > 0 ? Math.max(1, Math.ceil(pendingExtensionHours.value / 24)) : 0
);
const pendingExtensionAmount = computed(() => {
  const row = pendingActionRow.value;
  if (!row || pendingExtensionHours.value <= 0) {
    return 0;
  }
  const pickupAt = new Date(row.pickupAt);
  const returnAt = new Date(row.returnAt);
  const originalHours = Math.max(
    1,
    Math.ceil((returnAt.getTime() - pickupAt.getTime()) / 3_600_000)
  );
  const originalBillableDays = Math.max(1, Math.ceil(originalHours / 24));
  const rentalAmount = Math.round(row.totalAmount * 0.78);

  return Math.round((rentalAmount / originalBillableDays) * pendingExtensionBillableDays.value);
});
const pendingExtensionImmediateReasons = computed(() => {
  const row = pendingActionRow.value;
  if (!row || row.billingMode === BillingMode.Monthly) {
    return [];
  }
  const reasons: string[] = [];
  if (row.mainStatus === OrderMainStatus.Overdue) {
    reasons.push("逾期补办续租");
  }
  if (pendingExtensionHours.value > 24) {
    reasons.push("延长时长超过24小时");
  }
  if (pendingExtensionAmount.value > 1000) {
    reasons.push("续租金额超过1000元");
  }
  const riskFlags = ["blacklist", "黑名单", "license_issue", "证件异常", "高风险", "人工限制"];
  if (row.riskFlags.some((flag) => riskFlags.includes(flag))) {
    reasons.push("客户存在风险标记");
  }

  return reasons;
});
const pendingExtensionConflict = computed(() => {
  const row = pendingActionRow.value;
  if (!row || !row.plateNo || !actionForm.newReturnAt || pendingExtensionHours.value <= 0) {
    return undefined;
  }
  const oldReturnAt = new Date(row.returnAt);
  const newReturnAt = new Date(actionForm.newReturnAt);
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

  return rows.value.find((item) => {
    const pickupAt = new Date(item.pickupAt);
    const returnAt = new Date(item.returnAt);
    return (
      item.id !== row.id &&
      item.plateNo === row.plateNo &&
      occupyStatuses.includes(item.mainStatus) &&
      oldReturnAt < returnAt &&
      pickupAt < conflictEnd
    );
  });
});
const pendingExtensionLatestReturnAt = computed(() => {
  if (!pendingExtensionConflict.value) {
    return "";
  }
  return new Date(new Date(pendingExtensionConflict.value.pickupAt).getTime() - 60 * 60_000).toISOString();
});
const canSubmitPendingExtension = computed(() => {
  const row = pendingActionRow.value;
  if (!row || pendingExtensionHours.value <= 0 || pendingExtensionAmount.value <= 0 || pendingExtensionConflict.value) {
    return false;
  }
  if (!row.plateNo || row.plateNo === "待人工派车") {
    return false;
  }
  if (row.billingMode === BillingMode.Monthly) {
    return true;
  }
  if (pendingExtensionImmediateReasons.value.length > 0) {
    return actionForm.extensionSettlementMode === "immediate" && actionForm.extensionPaymentPaid;
  }
  if (actionForm.extensionSettlementMode === "immediate") {
    return actionForm.extensionPaymentPaid;
  }
  return actionForm.extensionSettlementMode === "return_settlement";
});
const pendingHoursBeforePickup = computed(() => {
  const row = pendingActionRow.value;
  if (!row) {
    return 0;
  }
  const pickupAt = new Date(row.pickupAt);
  if (!Number.isFinite(pickupAt.getTime())) {
    return 0;
  }
  return (pickupAt.getTime() - Date.now()) / 3_600_000;
});
const pendingTerminalPreAuthAmount = computed(() => {
  const row = pendingActionRow.value;
  if (!row || row.billingMode === BillingMode.Monthly || row.paymentStatus === PaymentStatus.Unpaid) {
    return 0;
  }
  return 2000;
});
const pendingCancelOriginalFee = computed(() => {
  const row = pendingActionRow.value;
  if (!row || row.mainStatus === OrderMainStatus.PendingPayment || pendingHoursBeforePickup.value >= 24) {
    return 0;
  }
  const baseAmount = row.billingMode === BillingMode.Monthly ? row.totalAmount : pendingTerminalPreAuthAmount.value;
  if (pendingHoursBeforePickup.value >= 12) {
    return Math.round(baseAmount * 0.2);
  }
  if (pendingHoursBeforePickup.value >= 2) {
    return Math.round(baseAmount * 0.5);
  }
  return Math.round(baseAmount);
});
const pendingCancelFeeAmount = computed(() =>
  actionForm.specialWaiver ? 0 : pendingCancelOriginalFee.value
);
const pendingCancelTypeLabel = computed(() =>
  pendingCancelOriginalFee.value > 0 ? "有责取消" : "免责取消"
);
const pendingNoShowFeeAmount = computed(() => 200);
const pendingNoShowPaymentDue = computed(() =>
  Math.max(0, pendingNoShowFeeAmount.value - pendingTerminalPreAuthAmount.value)
);
const canSubmitPendingAction = computed(() => {
  if (pendingAction.value === "extend-rental") {
    return canSubmitPendingExtension.value;
  }
  if (pendingAction.value === "cancel") {
    return Boolean(actionForm.reason);
  }
  if (pendingAction.value === "mark-no-show") {
    return Boolean(actionForm.contactResult);
  }
  return true;
});
const canCreateOrder = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:order:operate",
    "store-rental:order:create"
  ])
);
const selectedFilterPreset = computed(() =>
  filterPresets.value.find((preset) => preset.id === selectedFilterPresetId.value)
);

const filteredRows = computed(() => {
  const groupStatusMap: Record<string, string[]> = {
    group_todo: ["pending_payment", "reserved", "pickup_overdue"],
    group_active: ["inspecting", "renting", "renewing"],
    group_risk: ["overdue", "accident_processing"],
    group_settlement: ["settlement_pending", "payment_due", "refund_pending"],
    group_history: ["completed", "cancelled", "no_show", "rejected", "closed"]
  };
  const activeStatuses = new Set(
    filters.status.flatMap((item) => groupStatusMap[item] ?? [item])
  );

  return rows.value.filter((row) => {
    const matchedKeyword =
      !filters.keyword ||
      row.orderNo.includes(filters.keyword) ||
      row.customerName.includes(filters.keyword) ||
      row.vehicleGroupName.includes(filters.keyword) ||
      row.pickupStoreName.includes(filters.keyword) ||
      row.returnStoreName.includes(filters.keyword) ||
      row.plateNo?.includes(filters.keyword);
    const matchedStatus =
      activeStatuses.size === 0 || activeStatuses.has(row.mainStatus);
    const matchedBilling =
      !filters.billingMode || row.billingMode === filters.billingMode;
    const matchedClient =
      !filters.clientType ||
      (filters.clientType === "corporate"
        ? Boolean(row.corporateShortName)
        : !row.corporateShortName);
    const matchedPickupStore =
      !filters.pickupStore || row.pickupStoreName === filters.pickupStore;
    const matchedReturnStore =
      !filters.returnStore || row.returnStoreName === filters.returnStore;
    const matchedRisk =
      !filters.riskFlag || row.riskFlags.some((flag) => flag.includes("风险") || flag.includes("人工") || flag.includes("异常"));

    return (
      matchedKeyword &&
      matchedStatus &&
      matchedBilling &&
      matchedClient &&
      matchedPickupStore &&
      matchedReturnStore &&
      matchedRisk
    );
  });
});

function countByStatus(statuses: OrderMainStatus[]) {
  return rows.value.filter((row) => statuses.includes(row.mainStatus)).length;
}

function switchStatsView(view: "overview" | "task") {
  statsView.value = view;
  activeStatFilter.value = "";
}

function applyStatFilter(key: string) {
  activeStatFilter.value = key;
  const statusMap: Record<string, string[]> = {
    reserved: [OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue, OrderMainStatus.Inspecting],
    renting: [OrderMainStatus.Renting],
    settlement_pending: [OrderMainStatus.SettlementPending],
    pending_payment: [OrderMainStatus.PendingPayment],
    completed: [OrderMainStatus.Completed],
    pickup_today: [OrderMainStatus.Reserved, OrderMainStatus.PickupOverdue, OrderMainStatus.Inspecting],
    return_today: [OrderMainStatus.Renting],
    settle_today: [OrderMainStatus.SettlementPending]
  };
  filters.status = statusMap[key] ?? [];
  if (key === "monthly") {
    filters.billingMode = BillingMode.Monthly;
  }
  selectedFilterPresetId.value = "";
}

function resetFilters() {
  Object.assign(filters, {
    keyword: "",
    clientType: "",
    billingMode: "",
    status: [],
    dateRange: [],
    postChargeStatus: "",
    riskFlag: "",
    pickupStore: "",
    returnStore: ""
  });
  activeStatFilter.value = "";
  selectedFilterPresetId.value = "";
}

function filterPresetOperator() {
  return authStore.user?.displayName || "营运端";
}

function cloneOrderFilters() {
  return JSON.parse(JSON.stringify(filters)) as Record<string, unknown>;
}

function applyOrderPresetFilters(presetFilters: Record<string, unknown>) {
  Object.assign(filters, {
    keyword: typeof presetFilters.keyword === "string" ? presetFilters.keyword : "",
    clientType: typeof presetFilters.clientType === "string" ? presetFilters.clientType : "",
    billingMode: typeof presetFilters.billingMode === "string" ? presetFilters.billingMode : "",
    status: Array.isArray(presetFilters.status)
      ? presetFilters.status.map((item) => String(item))
      : [],
    dateRange: Array.isArray(presetFilters.dateRange)
      ? presetFilters.dateRange.map((item) => String(item))
      : [],
    postChargeStatus:
      typeof presetFilters.postChargeStatus === "string"
        ? presetFilters.postChargeStatus
        : "",
    riskFlag: typeof presetFilters.riskFlag === "string" ? presetFilters.riskFlag : "",
    pickupStore:
      typeof presetFilters.pickupStore === "string" ? presetFilters.pickupStore : "",
    returnStore:
      typeof presetFilters.returnStore === "string" ? presetFilters.returnStore : ""
  });
  activeStatFilter.value = "";
  searchPanelExpanded.value = Boolean(
    filters.postChargeStatus ||
      filters.riskFlag ||
      filters.pickupStore ||
      filters.returnStore
  );
}

function applySelectedFilterPreset() {
  const preset = selectedFilterPreset.value;
  if (!preset) {
    return;
  }
  applyOrderPresetFilters(preset.filters);
}

async function loadFilterPresets() {
  filterPresetLoading.value = true;
  try {
    filterPresets.value = await listPlatformFilterPresets({
      scopeKey: filterPresetScope
    });
    const defaultPreset = filterPresets.value.find((preset) => preset.isDefault);
    if (defaultPreset) {
      selectedFilterPresetId.value = defaultPreset.id;
      applyOrderPresetFilters(defaultPreset.filters);
    }
  } catch {
    filterPresets.value = [];
  } finally {
    filterPresetLoading.value = false;
  }
}

async function saveCurrentFilterPreset() {
  try {
    const { value } = await ElMessageBox.prompt(
      "请输入筛选预设名称",
      "保存筛选预设",
      {
        confirmButtonText: "保存",
        cancelButtonText: "取消",
        inputValue: selectedFilterPreset.value?.name ?? "",
        inputPattern: /^(?=.*\S).{1,40}$/,
        inputErrorMessage: "名称长度需为 1-40 个字符"
      }
    );
    const saved = await savePlatformFilterPreset({
      id: selectedFilterPreset.value?.id,
      scopeKey: filterPresetScope,
      name: value.trim(),
      filters: cloneOrderFilters(),
      isDefault: selectedFilterPreset.value?.isDefault,
      operator: filterPresetOperator()
    });
    await loadFilterPresets();
    selectedFilterPresetId.value = saved.id;
    ElMessage.success("筛选预设已保存");
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error("筛选预设保存失败");
    }
  }
}

async function setCurrentFilterPresetDefault() {
  if (!selectedFilterPreset.value) {
    ElMessage.warning("请先选择筛选预设");
    return;
  }
  try {
    const saved = await setPlatformFilterPresetDefault(
      selectedFilterPreset.value.id,
      filterPresetOperator()
    );
    await loadFilterPresets();
    selectedFilterPresetId.value = saved.id;
    ElMessage.success("已设为默认筛选预设");
  } catch {
    ElMessage.error("默认筛选预设设置失败");
  }
}

async function deleteCurrentFilterPreset() {
  if (!selectedFilterPreset.value) {
    ElMessage.warning("请先选择筛选预设");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除筛选预设“${selectedFilterPreset.value.name}”？`,
      "删除筛选预设",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
    await deletePlatformFilterPreset(
      selectedFilterPreset.value.id,
      filterPresetOperator()
    );
    selectedFilterPresetId.value = "";
    await loadFilterPresets();
    ElMessage.success("筛选预设已删除");
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error("筛选预设删除失败");
    }
  }
}

async function loadRows() {
  loading.value = true;
  try {
    rows.value = await listStoreRentalOrders();
  } catch {
    rows.value = fallbackRows;
  } finally {
    loading.value = false;
  }
}

function openDetail(row: StoreRentalOrderSummary) {
  void router.push(`/orders/${row.id}`);
}

const orderActionPermissionMap: Record<string, string[]> = {
  "payment-success": ["store-rental:order:operate", "store-rental:order:pickup"],
  "start-pickup": ["store-rental:order:operate", "store-rental:order:pickup"],
  "pickup-inspection": ["store-rental:order:operate", "store-rental:order:pickup"],
  "return-inspection": ["store-rental:order:operate", "store-rental:order:return"],
  "extend-rental": ["store-rental:order:operate", "store-rental:order:extend"],
  "confirm-settlement": ["store-rental:order:settle"],
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
  if (row.mainStatus === OrderMainStatus.PendingPayment) {
    actions = ["payment-success", "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.Reserved) {
    actions = ["start-pickup", "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.PickupOverdue) {
    actions = ["start-pickup", "mark-no-show", "cancel"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.Inspecting) {
    actions = ["pickup-inspection"];
    return actions.filter(canRunOrderAction);
  }
  if (
    row.mainStatus === OrderMainStatus.Renting ||
    row.mainStatus === OrderMainStatus.Renewing ||
    row.mainStatus === OrderMainStatus.Overdue
  ) {
    actions = ["extend-rental", "return-inspection"];
    return actions.filter(canRunOrderAction);
  }
  if (row.mainStatus === OrderMainStatus.AccidentProcessing) {
    actions = ["return-inspection"];
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

function resetActionForm(row: StoreRentalOrderSummary, action: string) {
  Object.assign(actionForm, {
    operator: "营运端",
    plateNo: row.plateNo || "",
    mileage: 0,
    returnMileage: 0,
    fuelLevelPercent: 80,
    batteryLevelPercent: row.vehicleGroupName.includes("Tesla") ? 80 : 0,
    cleanliness: "normal",
    damageFound: false,
    damageDescription: "",
    missingItems: "",
    photoCount: action === "confirm-settlement" ? 0 : 6,
    customerSigned: true,
    overtimeFeeAmount: 0,
    extraMileageFeeAmount: 0,
    damageFeeAmount: 0,
    cleaningFeeAmount: 0,
    discountAmount: 0,
    finalReceivableAmount: row.totalAmount,
    monthlyBillingPosted: row.billingMode === BillingMode.Monthly,
    newReturnAt: new Date(new Date(row.returnAt).getTime() + 24 * 3_600_000).toISOString(),
    extensionSettlementMode:
      row.billingMode === BillingMode.Monthly
        ? "monthly"
        : row.mainStatus === OrderMainStatus.Overdue
          ? "immediate"
          : "return_settlement",
    extensionPaymentPaid: false,
    reason: action === "cancel" ? "行程变更" : "",
    contactResult: action === "mark-no-show" ? "客户超时未到店" : "",
    specialWaiver: false,
    waiverReason: "",
    memo: ""
  });
}

function openOrderAction(row: StoreRentalOrderSummary, action: string) {
  if (["payment-success", "start-pickup"].includes(action)) {
    void runAction(row, action);
    return;
  }
  pendingAction.value = action;
  pendingActionRow.value = row;
  resetActionForm(row, action);
  actionDialogVisible.value = true;
}

async function confirmOrderAction() {
  if (!pendingActionRow.value || !pendingAction.value) {
    return;
  }
  const payload: Record<string, unknown> = { ...actionForm };
  if (pendingAction.value === "extend-rental") {
    Object.assign(payload, {
      newReturnAt: actionForm.newReturnAt,
      settlementMode:
        pendingActionRow.value.billingMode === BillingMode.Monthly
          ? "monthly"
          : actionForm.extensionSettlementMode,
      paymentPaid: actionForm.extensionPaymentPaid
    });
  }
  if (pendingAction.value === "cancel") {
    Object.assign(payload, {
      reason: actionForm.reason,
      specialWaiver: actionForm.specialWaiver,
      waiverReason: actionForm.waiverReason
    });
  }
  if (pendingAction.value === "mark-no-show") {
    Object.assign(payload, {
      reason: actionForm.contactResult,
      contactResult: actionForm.contactResult
    });
  }
  if (
    pendingAction.value === "confirm-settlement" &&
    [OrderMainStatus.PaymentDue, OrderMainStatus.RefundPending].includes(
      pendingActionRow.value.mainStatus
    )
  ) {
    [
      "overtimeFeeAmount",
      "extraMileageFeeAmount",
      "damageFeeAmount",
      "cleaningFeeAmount",
      "discountAmount",
      "finalReceivableAmount"
    ].forEach((key) => delete payload[key]);
  }
  await runAction(pendingActionRow.value, pendingAction.value, payload);
  actionDialogVisible.value = false;
}

async function runAction(
  row: StoreRentalOrderSummary,
  action: string,
  payload: Record<string, unknown> = {
    operator: "营运端",
    source: "orders-page"
  }
) {
  actionLoading.value = `${row.id}:${action}`;
  try {
    const result = await runStoreRentalOrderAction(row.id, action, {
      ...payload,
      source: "orders-page"
    });
    ElMessage.success(result.message);
    await loadRows();
    if (detailVisible.value) {
      selectedOrder.value = await getStoreRentalOrder(row.id);
    }
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单操作失败"));
  } finally {
    actionLoading.value = "";
  }
}

function runRowCommand(row: StoreRentalOrderSummary, action: unknown) {
  openOrderAction(row, String(action));
}

function actionLabel(action: string, row?: StoreRentalOrderSummary) {
  const map: Record<string, string> = {
    "payment-success": "支付/预授权成功",
    "start-pickup": "取车",
    "pickup-inspection": "确认发车",
    "extend-rental": row?.mainStatus === OrderMainStatus.Overdue ? "补办续租" : "延长",
    "return-inspection": "还车验车完成",
    "confirm-settlement": "继续结算",
    "mark-no-show": "标记爽约",
    cancel: "取消订单"
  };
  return map[action] ?? action;
}

function actionDialogTitle(action: string) {
  const map: Record<string, string> = {
    "pickup-inspection": "确认发车",
    "extend-rental": pendingActionRow.value?.mainStatus === OrderMainStatus.Overdue ? "补办续租" : "延长用车",
    "return-inspection": "还车验车",
    "confirm-settlement": "结算确认",
    "mark-no-show": "标记爽约",
    cancel: "取消订单"
  };
  return map[action] ?? actionLabel(action);
}

function actionConfirmLabel(action: string) {
  const map: Record<string, string> = {
    cancel: "确认取消订单",
    "mark-no-show": "确认标记爽约"
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

function dispatchLabel(value: string) {
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

function operationLockLabel(value?: string) {
  const map: Record<string, string> = {
    active: "有效",
    interrupted: "中断",
    expired: "已过期",
    released: "已释放"
  };
  return value ? map[value] ?? value : "无";
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

function formatMoney(value: number) {
  return `¥${value.toLocaleString("zh-Hans-CN")}`;
}

function goNewOrder() {
  void router.push("/new-order");
}

onMounted(() => {
  void loadRows();
  void loadFilterPresets();
});
</script>

<template>
  <AppLayout>
    <div class="prototype-page-title">
      <div>
        <h1>门市租赁订单</h1>
        <p>管理所有门市租赁订单，支持快速取还车、订单查询及状态跟踪。</p>
      </div>
      <el-dropdown
        v-if="canCreateOrder"
        split-button
        type="primary"
        size="large"
        class="shadow-md shadow-[#00689E]/20"
        color="#00689E"
        @click="goNewOrder"
        @command="goNewOrder"
      >
        <span class="flex items-center">
          <el-icon class="mr-1"><Plus /></el-icon>
          新建订单
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="store">新建门市租赁订单</el-dropdown-item>
            <el-dropdown-item command="self_service">新建24h自助租车订单</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="bg-white rounded-xl border border-gray-200 p-3 mb-4">
      <div class="flex items-center justify-between gap-4 mb-3">
        <div class="text-sm font-semibold text-gray-700">统计视角</div>
        <div class="prototype-segmented">
          <button :class="{ 'is-active': statsView === 'overview' }" @click="switchStatsView('overview')">
            运营总览
          </button>
          <button :class="{ 'is-active': statsView === 'task' }" @click="switchStatsView('task')">
            今日作业
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <button
          v-for="item in currentStats"
          :key="item.key"
          class="text-left rounded-lg border px-3 py-2 transition-colors"
          :class="activeStatFilter === item.key || (!activeStatFilter && statsView === 'overview' && item.key === 'all') ? 'border-[#00689E] bg-sky-50' : 'border-gray-100 hover:border-[#00689E] hover:bg-sky-50'"
          @click="applyStatFilter(item.key)"
        >
          <div class="text-xs text-gray-500">{{ item.label }}</div>
          <div class="mt-1 text-xl font-bold font-mono" :class="item.color">{{ item.count }}</div>
        </button>
      </div>
    </div>

    <div class="prototype-filter-panel">
      <div class="flex flex-wrap items-center gap-4">
        <el-input v-model="filters.keyword" placeholder="订单号 / 客户 / 企业名 / 车牌号" prefix-icon="Search" clearable style="width: 280px" />
        <el-select v-model="filters.clientType" placeholder="客户类型" clearable style="width: 120px">
          <el-option label="全部客户" value="" />
          <el-option label="个人客户" value="personal" />
          <el-option label="企业客户" value="corporate" />
        </el-select>
        <el-select v-model="filters.billingMode" placeholder="结算方式" clearable style="width: 130px">
          <el-option label="全部结算" value="" />
          <el-option label="客户自付" value="customer_pay" />
          <el-option label="企业月结" value="monthly" />
        </el-select>
        <el-select v-model="filters.status" placeholder="订单状态" multiple collapse-tags collapse-tags-tooltip clearable style="width: 180px">
          <el-option-group label="待处理">
            <el-option label="【全部待处理】" value="group_todo" class="font-bold text-blue-600 bg-blue-50" />
            <el-option label="待支付" value="pending_payment" />
            <el-option label="已预订" value="reserved" />
            <el-option label="逾期未取" value="pickup_overdue" />
          </el-option-group>
          <el-option-group label="进行中">
            <el-option label="【全部进行中】" value="group_active" class="font-bold text-green-600 bg-green-50" />
            <el-option label="验车中" value="inspecting" />
            <el-option label="用车中" value="renting" />
            <el-option label="续租中" value="renewing" />
          </el-option-group>
          <el-option-group label="异常/风险">
            <el-option label="【全部异常】" value="group_risk" class="font-bold text-red-600 bg-red-50" />
            <el-option label="逾期未还" value="overdue" />
            <el-option label="出险处理中" value="accident_processing" />
          </el-option-group>
          <el-option-group label="结算处理">
            <el-option label="【全部结算】" value="group_settlement" class="font-bold text-orange-600 bg-orange-50" />
            <el-option label="待结算" value="settlement_pending" />
            <el-option label="待补缴" value="payment_due" />
            <el-option label="待退款" value="refund_pending" />
          </el-option-group>
          <el-option-group label="已结束">
            <el-option label="【全部已结束】" value="group_history" class="font-bold text-gray-600 bg-gray-50" />
            <el-option label="已完成" value="completed" />
            <el-option label="已取消" value="cancelled" />
            <el-option label="爽约" value="no_show" />
            <el-option label="已拒绝" value="rejected" />
            <el-option label="已关闭" value="closed" />
          </el-option-group>
        </el-select>
        <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 260px" format="YYYY/MM/DD" value-format="YYYY-MM-DD" />
        <el-button type="primary" icon="Filter" plain @click="searchPanelExpanded = !searchPanelExpanded">
          {{ searchPanelExpanded ? "收起筛选" : "更多筛选" }}
        </el-button>
        <el-select
          v-model="selectedFilterPresetId"
          placeholder="筛选预设"
          clearable
          :loading="filterPresetLoading"
          style="width: 190px"
          @change="applySelectedFilterPreset"
        >
          <el-option
            v-for="preset in filterPresets"
            :key="preset.id"
            :label="preset.isDefault ? `${preset.name}（默认）` : preset.name"
            :value="preset.id"
          />
        </el-select>
        <el-button icon="Collection" plain @click="saveCurrentFilterPreset">
          保存视图
        </el-button>
        <el-tooltip content="设为默认" placement="top">
          <el-button
            icon="Star"
            circle
            :disabled="!selectedFilterPresetId"
            @click="setCurrentFilterPresetDefault"
          />
        </el-tooltip>
        <el-tooltip content="删除预设" placement="top">
          <el-button
            icon="Delete"
            circle
            :disabled="!selectedFilterPresetId"
            @click="deleteCurrentFilterPreset"
          />
        </el-tooltip>
        <el-button icon="Refresh" circle @click="resetFilters" />
        <el-button
          v-if="authStore.hasAnyPermission(['system:button:export'])"
          type="primary"
          plain
          icon="Download"
        >
          导出
        </el-button>
      </div>

      <div v-show="searchPanelExpanded" class="pt-4 mt-4 border-t border-gray-100">
        <div class="flex flex-wrap items-center gap-4">
          <el-select v-model="filters.postChargeStatus" placeholder="追缴状态" clearable style="width: 140px">
            <el-option label="全部追缴" value="" />
            <el-option label="存在追缴" value="any" />
            <el-option label="追缴待通知" value="pending_notify" />
            <el-option label="追缴已通知" value="notified" />
            <el-option label="追缴待支付" value="payment_due" />
            <el-option label="企业月结追缴" value="monthly_billing" />
            <el-option label="追缴已结清" value="paid" />
          </el-select>
          <el-select v-model="filters.riskFlag" placeholder="风险标记" clearable style="width: 130px">
            <el-option label="全部风险" value="" />
            <el-option label="黑名单" value="blacklist" />
            <el-option label="证件异常" value="license_issue" />
            <el-option label="人工调度" value="dispatch_manual_required" />
            <el-option label="需联系客户" value="pickup_overdue_contact" />
            <el-option label="事故上报" value="accident" />
            <el-option label="违章待处理" value="violation_pending" />
          </el-select>
          <el-select v-model="filters.pickupStore" placeholder="取车门店" clearable style="width: 150px">
            <el-option v-for="store in stores" :key="store" :label="store" :value="store" />
          </el-select>
          <el-select v-model="filters.returnStore" placeholder="还车门店" clearable style="width: 150px">
            <el-option v-for="store in stores" :key="store" :label="store" :value="store" />
          </el-select>
        </div>
      </div>
    </div>

    <div class="prototype-table-panel">
      <div class="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
        <div class="text-sm font-semibold text-gray-700">订单列表</div>
        <div class="text-sm text-gray-500">共 {{ filteredRows.length }} 笔订单</div>
      </div>
      <el-table v-loading="loading" :data="filteredRows" stripe style="width: 100%" class="prototype-table">
        <el-table-column label="订单信息" min-width="210">
          <template #default="{ row }">
            <div class="font-mono font-bold text-gray-900">{{ row.orderNo }}</div>
            <div class="text-xs text-gray-500 mt-1">
              {{ row.customerName }} · {{ row.customerPhoneMasked }}
            </div>
            <div v-if="row.corporateShortName" class="text-xs text-indigo-500 mt-1">
              {{ row.corporateShortName }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="车组 / 车辆" min-width="190">
          <template #default="{ row }">
            <div class="font-bold text-gray-800">{{ row.vehicleGroupName }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.plateNo || "待派车" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="取还门市" min-width="170">
          <template #default="{ row }">
            <div>{{ row.pickupStoreName }}</div>
            <div class="text-xs text-gray-500 mt-1">还：{{ row.returnStoreName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="行程时间" min-width="210">
          <template #default="{ row }">
            <div class="text-sm text-gray-700">{{ row.pickupAt }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.returnAt }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <div class="font-mono font-bold text-gray-900">{{ formatMoney(row.totalAmount) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150" align="center">
          <template #default="{ row }">
            <div class="space-y-1">
              <el-tag :type="statusType(row.mainStatus)" effect="plain">{{ statusLabel(row.mainStatus) }}</el-tag>
              <div class="text-xs text-gray-400">{{ paymentLabel(row.paymentStatus) }}</div>
              <div v-if="row.operationLockStatus" class="text-xs text-blue-500">
                操作锁：{{ operationLockLabel(row.operationLockStatus) }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="风险标签" min-width="160">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="flag in row.riskFlags" :key="flag" size="small" type="warning" effect="plain">{{ flag }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openDetail(row)">详情</el-button>
            <el-dropdown
              v-if="availableActions(row).length"
              trigger="click"
              @command="runRowCommand(row, $event)"
            >
              <el-button
                type="primary"
                link
                :loading="actionLoading.startsWith(row.id)"
              >
                操作
                <el-icon class="ml-1"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-for="action in availableActions(row)"
                    :key="action"
                    :command="action"
                  >
                    {{ actionLabel(action, row) }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <span v-else class="text-xs text-gray-400">无动作</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="p-3 border-t border-gray-100 flex justify-end bg-gray-50">
        <el-pagination
          :total="filteredRows.length"
          :page-size="10"
          small
          background
          layout="total, prev, pager, next"
        />
      </div>
    </div>

    <el-drawer
      v-model="detailVisible"
      title="门市租赁订单详情"
      size="560px"
      destroy-on-close
    >
      <div v-loading="detailLoading" class="space-y-6">
        <template v-if="selectedOrder">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-mono text-lg font-bold text-gray-900">
                {{ selectedOrder.orderNo }}
              </div>
              <div class="text-sm text-gray-500 mt-1">
                {{ selectedOrder.customerName }} · {{ selectedOrder.customerPhoneMasked }}
              </div>
            </div>
            <el-tag :type="statusType(selectedOrder.mainStatus)" effect="plain">
              {{ statusLabel(selectedOrder.mainStatus) }}
            </el-tag>
          </div>

          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="车组">
              {{ selectedOrder.vehicleGroupName }}
            </el-descriptions-item>
            <el-descriptions-item label="车辆">
              {{ selectedOrder.plateNo || "待派车" }}
            </el-descriptions-item>
            <el-descriptions-item label="取车门市">
              {{ selectedOrder.pickupStoreName }}
            </el-descriptions-item>
            <el-descriptions-item label="还车门市">
              {{ selectedOrder.returnStoreName }}
            </el-descriptions-item>
            <el-descriptions-item label="支付状态">
              {{ paymentLabel(selectedOrder.paymentStatus) }}
            </el-descriptions-item>
            <el-descriptions-item label="派车状态">
              {{ dispatchLabel(selectedOrder.dispatchStatus) }}
            </el-descriptions-item>
            <el-descriptions-item v-if="selectedOrder.operationLockStatus" label="取车操作锁" :span="2">
              {{ operationLockLabel(selectedOrder.operationLockStatus) }}
              <span v-if="selectedOrder.operationLockOperator" class="ml-2">
                操作人：{{ selectedOrder.operationLockOperator }}
              </span>
              <span v-if="selectedOrder.operationLockExpiresAt" class="ml-2">
                到期：{{ selectedOrder.operationLockExpiresAt }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="取车时间" :span="2">
              {{ selectedOrder.pickupAt }}
            </el-descriptions-item>
            <el-descriptions-item label="还车时间" :span="2">
              {{ selectedOrder.returnAt }}
            </el-descriptions-item>
          </el-descriptions>

          <section>
            <div class="font-bold text-gray-800 mb-3">账务总览</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                合计应收：{{ formatMoney(selectedOrder.financialOverview.totalReceivableAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                客户实收：{{ formatMoney(selectedOrder.financialOverview.customerReceivedAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                企业挂账：{{ formatMoney(selectedOrder.financialOverview.monthlyBillingAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                待处理：{{ formatMoney(selectedOrder.financialOverview.pendingAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                待退款：{{ formatMoney(selectedOrder.financialOverview.refundAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                完成后追缴：{{ formatMoney(selectedOrder.financialOverview.postChargeAmount) }}
              </div>
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">费用明细</div>
            <div class="rounded border border-gray-200 divide-y divide-gray-100">
              <div
                v-for="item in selectedOrder.feeItems"
                :key="item.name"
                class="flex justify-between px-3 py-2 text-sm"
              >
                <span class="text-gray-600">{{ item.name }}</span>
                <span class="font-mono font-bold text-gray-900">
                  {{ formatMoney(item.amount) }}
                </span>
              </div>
              <div class="flex justify-between px-3 py-2 text-sm bg-gray-50">
                <span class="font-bold text-gray-700">订单金额</span>
                <span class="font-mono font-bold text-gray-900">
                  {{ formatMoney(selectedOrder.totalAmount) }}
                </span>
              </div>
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">费用台账</div>
            <div class="rounded border border-gray-200 divide-y divide-gray-100">
              <div
                v-for="item in selectedOrder.feeLedgerItems"
                :key="item.id"
                class="px-3 py-3 text-sm"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="font-bold text-gray-800">{{ item.name }}</div>
                    <div class="text-xs text-gray-500 mt-1">
                      {{ feeStageLabel(item.stage) }} · {{ feeDirectionLabel(item.direction) }} · {{ item.description }}
                    </div>
                  </div>
                  <div class="text-right">
                    <div class="font-mono font-bold text-gray-900">{{ formatMoney(item.amount) }}</div>
                    <el-tag size="small" effect="plain" class="mt-1">
                      {{ feeStatusLabel(item.status) }}
                    </el-tag>
                  </div>
                </div>
                <div class="mt-2 text-xs text-gray-400">
                  快照：{{ item.snapshotRef }}，待处理：{{ formatMoney(item.pendingAmount) }}
                </div>
              </div>
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">资金记录</div>
            <div v-if="selectedOrder.transactionRecords.length" class="rounded border border-gray-200 divide-y divide-gray-100">
              <div
                v-for="record in selectedOrder.transactionRecords"
                :key="record.id"
                class="flex items-start justify-between gap-3 px-3 py-3 text-sm"
              >
                <div>
                  <div class="font-bold text-gray-800">{{ transactionTypeLabel(record.type) }}</div>
                  <div class="text-xs text-gray-500 mt-1">
                    {{ record.operator }} · {{ record.channel }} · {{ record.at }}
                  </div>
                  <div class="text-xs text-gray-400 mt-1">{{ record.note }}</div>
                </div>
                <div class="text-right">
                  <div class="font-mono font-bold text-gray-900">{{ formatMoney(record.amount) }}</div>
                  <el-tag size="small" :type="record.status === 'success' ? 'success' : record.status === 'failed' ? 'danger' : 'warning'" effect="plain" class="mt-1">
                    {{ record.status === "success" ? "成功" : record.status === "failed" ? "失败" : "待处理" }}
                  </el-tag>
                </div>
              </div>
            </div>
            <div v-else class="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-400 text-center">
              暂无资金记录
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">结算汇总</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                超时费：{{ formatMoney(selectedOrder.settlementSummary.overtimeFeeAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                超里程费：{{ formatMoney(selectedOrder.settlementSummary.extraMileageFeeAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                损伤赔偿：{{ formatMoney(selectedOrder.settlementSummary.damageFeeAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                清洁/缺件：{{ formatMoney(selectedOrder.settlementSummary.cleaningFeeAmount) }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                减免：{{ formatMoney(selectedOrder.settlementSummary.discountAmount) }}
              </div>
              <div class="col-span-2 rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-indigo-700">
                最终应收：{{ formatMoney(selectedOrder.settlementSummary.finalReceivableAmount) }}
                <span v-if="selectedOrder.settlementSummary.monthlyBillingPosted" class="ml-2">已按月结入账</span>
              </div>
              <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-blue-700">
                还车差额：{{ formatMoney(selectedOrder.settlementSummary.balanceDue) }}
              </div>
              <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-blue-700">
                待收/待退：
                {{ selectedOrder.settlementSummary.customerPayableAmount > 0
                  ? formatMoney(selectedOrder.settlementSummary.customerPayableAmount)
                  : selectedOrder.settlementSummary.customerRefundAmount > 0
                    ? `-${formatMoney(selectedOrder.settlementSummary.customerRefundAmount)}`
                    : formatMoney(0) }}
              </div>
              <div v-if="selectedOrder.billingMode === BillingMode.Monthly" class="col-span-2 rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-indigo-700">
                企业月结挂账：{{ formatMoney(selectedOrder.settlementSummary.monthlyBillAmount) }}
              </div>
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">取还车检查记录</div>
            <div v-if="selectedOrder.inspectionRecords.length" class="space-y-3">
              <div
                v-for="record in selectedOrder.inspectionRecords"
                :key="record.id"
                class="rounded border border-gray-200 bg-gray-50 p-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="font-bold text-gray-800">
                    {{ record.stage === "pickup" ? "取车验车" : "还车验车" }}
                  </div>
                  <el-tag size="small" :type="record.damageFound ? 'warning' : 'success'" effect="plain">
                    {{ record.damageFound ? "有异常" : "无异常" }}
                  </el-tag>
                </div>
                <div class="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-600">
                  <div>操作人：{{ record.operator }}</div>
                  <div>时间：{{ record.at }}</div>
                  <div>车辆：{{ record.plateNo || "-" }}</div>
                  <div>里程：{{ record.mileage ?? "-" }}</div>
                  <div>油量：{{ record.fuelLevelPercent ?? "-" }}%</div>
                  <div>电量：{{ record.batteryLevelPercent ?? "-" }}%</div>
                  <div>照片：{{ record.photoCount }} 张</div>
                  <div>签名：{{ record.customerSigned ? "已签名" : "未签名" }}</div>
                </div>
                <div v-if="record.damageDescription || record.missingItems || record.memo" class="mt-2 text-xs text-gray-500">
                  {{ record.damageDescription || record.missingItems || record.memo }}
                </div>
              </div>
            </div>
            <div v-else class="rounded border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-400 text-center">
              暂无取还车检查记录
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">订单快照</div>
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                价格版本：{{ selectedOrder.snapshots.pricingVersion }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                条款版本：{{ selectedOrder.snapshots.termsVersion }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                取车快照：{{ selectedOrder.snapshots.pickupStore }}
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                还车快照：{{ selectedOrder.snapshots.returnStore }}
              </div>
            </div>
          </section>

          <section>
            <div class="font-bold text-gray-800 mb-3">操作记录</div>
            <el-timeline>
              <el-timeline-item
                v-for="item in selectedOrder.timeline"
                :key="item.at + item.action"
                :timestamp="item.at"
                placement="top"
              >
                <div class="text-sm font-medium text-gray-800">{{ item.action }}</div>
                <div class="text-xs text-gray-500 mt-1">{{ item.actor }}</div>
              </el-timeline-item>
            </el-timeline>
          </section>

          <div v-if="availableActions(selectedOrder).length" class="flex gap-2 pt-2">
            <el-button
              v-for="action in availableActions(selectedOrder)"
              :key="action"
              type="primary"
              plain
              :loading="actionLoading === `${selectedOrder.id}:${action}`"
              @click="openOrderAction(selectedOrder, action)"
            >
              {{ actionLabel(action, selectedOrder) }}
            </el-button>
          </div>
        </template>
      </div>
    </el-drawer>

    <el-dialog
      v-model="actionDialogVisible"
      :title="actionDialogTitle(pendingAction)"
      width="680px"
      destroy-on-close
    >
      <div v-if="pendingActionRow" class="space-y-4">
        <div class="grid grid-cols-3 gap-3 text-sm">
          <div class="rounded border border-gray-200 bg-gray-50 p-3">
            <div class="text-xs text-gray-500 mb-1">订单号</div>
            <div class="font-mono font-bold text-gray-800">{{ pendingActionRow.orderNo }}</div>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 p-3">
            <div class="text-xs text-gray-500 mb-1">客户</div>
            <div class="font-bold text-gray-800">{{ pendingActionRow.customerName }}</div>
          </div>
          <div class="rounded border border-gray-200 bg-gray-50 p-3">
            <div class="text-xs text-gray-500 mb-1">当前状态</div>
            <div class="font-bold text-gray-800">{{ statusLabel(pendingActionRow.mainStatus) }}</div>
          </div>
        </div>

        <el-form label-position="top">
          <template v-if="pendingAction === 'extend-rental'">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">当前还车</div>
                <div class="font-mono text-gray-900">{{ pendingActionRow.returnAt }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">延长时长</div>
                <div class="font-bold text-gray-900">{{ pendingExtensionHours }} 小时</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">计费天数</div>
                <div class="font-bold text-gray-900">{{ pendingExtensionBillableDays }} 天</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">续租租金</div>
                <div class="font-mono font-bold text-[#00689E]">{{ formatMoney(pendingExtensionAmount) }}</div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <el-form-item label="新预计还车时间">
                <el-date-picker
                  v-model="actionForm.newReturnAt"
                  type="datetime"
                  format="YYYY-MM-DD HH:mm"
                  value-format="YYYY-MM-DDTHH:mm:ssZ"
                  class="w-full"
                  style="width: 100%"
                />
              </el-form-item>
              <el-form-item label="操作人">
                <el-input v-model="actionForm.operator" />
              </el-form-item>
            </div>

            <div
              v-if="pendingExtensionConflict"
              class="rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700 mb-4"
            >
              库存冲突：车辆 {{ pendingActionRow.plateNo }} 后续订单 {{ pendingExtensionConflict.orderNo }}
              将于 {{ pendingExtensionConflict.pickupAt }} 取车，最迟可延长至 {{ pendingExtensionLatestReturnAt }}。
            </div>
            <div v-else class="rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 mb-4">
              库存检测：当前车辆在延长时段加 60 分钟订单间隔内未发现后续占用冲突。
            </div>

            <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 mb-4">
              费用试算：确认后生成“续租租金”费用项。
              <span v-if="pendingExtensionImmediateReasons.length">
                必须立即收款：{{ pendingExtensionImmediateReasons.join("、") }}。
              </span>
            </div>

            <template v-if="pendingActionRow.billingMode === BillingMode.Monthly">
              <div class="rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 mb-4">
                结算方式：企业月结。续租费用随还车最终应收进入企业月结账单，不发起客户收款。
              </div>
            </template>
            <template v-else>
              <el-form-item label="结算方式">
                <el-radio-group v-model="actionForm.extensionSettlementMode">
                  <el-radio label="immediate">立即收款</el-radio>
                  <el-radio
                    label="return_settlement"
                    :disabled="pendingExtensionImmediateReasons.length > 0"
                  >
                    还车时结算
                  </el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item v-if="actionForm.extensionSettlementMode === 'immediate'" label="收款确认">
                <el-switch
                  v-model="actionForm.extensionPaymentPaid"
                  active-text="已完成续租收款"
                  inactive-text="未收款"
                />
              </el-form-item>
            </template>
          </template>

          <template v-else-if="pendingAction === 'cancel'">
            <div class="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700 mb-4">
              订单取消后将无法恢复，系统会释放车辆资源并按取消规则处理预授权、退款和企业月结费用。
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">距取车时间</div>
                <div class="font-bold text-gray-900">{{ formatHourDistance(pendingHoursBeforePickup) }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">取消类型</div>
                <div class="font-bold text-gray-900">{{ pendingCancelTypeLabel }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">取消费</div>
                <div class="font-mono font-bold text-[#00689E]">{{ formatMoney(pendingCancelFeeAmount) }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">预授权处理</div>
                <div class="font-bold text-gray-900">{{ pendingCancelFeeAmount > 0 ? '扣款后释放余额' : '全额释放' }}</div>
              </div>
            </div>
            <template v-if="pendingActionRow.billingMode === BillingMode.Monthly">
              <div class="rounded border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700 mb-4">
                企业月结取消处理：客户支付与预授权不处理，取消费进入企业月结。
              </div>
            </template>
            <el-form-item label="特殊减免">
              <el-checkbox v-model="actionForm.specialWaiver">申请特殊减免</el-checkbox>
            </el-form-item>
            <el-form-item v-if="actionForm.specialWaiver" label="特殊减免说明">
              <el-input v-model="actionForm.waiverReason" />
            </el-form-item>
            <el-form-item label="取消原因">
              <el-select v-model="actionForm.reason" class="w-full">
                <el-option label="行程变更" value="行程变更" />
                <el-option label="价格问题" value="价格问题" />
                <el-option label="预订错误" value="预订错误" />
                <el-option v-if="actionForm.specialWaiver" label="系统故障 (减免)" value="系统故障" />
                <el-option v-if="actionForm.specialWaiver" label="客户投诉补偿 (减免)" value="客户投诉补偿" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </template>

          <template v-else-if="pendingAction === 'mark-no-show'">
            <div class="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700 mb-4">
              标记爽约后将释放车辆资源，并生成爽约费处理记录。
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">取车时间</div>
                <div class="font-mono text-gray-900">{{ pendingActionRow.pickupAt }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">保留时长</div>
                <div class="font-bold text-gray-900">2 小时</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">爽约费</div>
                <div class="font-mono font-bold text-[#00689E]">{{ formatMoney(pendingNoShowFeeAmount) }}</div>
              </div>
              <div class="rounded border border-gray-200 bg-gray-50 p-3">
                <div class="text-xs text-gray-500 mb-1">{{ pendingActionRow.billingMode === BillingMode.Monthly ? '企业账单金额' : '待补缴金额' }}</div>
                <div class="font-mono font-bold text-gray-900">{{ formatMoney(pendingActionRow.billingMode === BillingMode.Monthly ? pendingNoShowFeeAmount : pendingNoShowPaymentDue) }}</div>
              </div>
            </div>
            <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 mb-4">
              费用规则：固定金额。客户自付优先从预授权扣款并释放余额。
            </div>
            <el-form-item label="联系结果">
              <el-select v-model="actionForm.contactResult" class="w-full">
                <el-option label="客户确认不取车" value="客户确认不取车" />
                <el-option label="多次联系无回应" value="多次联系无回应" />
                <el-option label="客户超时未到店" value="客户超时未到店" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </template>

          <template v-else-if="pendingAction === 'pickup-inspection'">
            <div class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 mb-4">
              订单已进入验车中。本步骤会校验取车资料、生成验车记录、锁定车辆，并确认发车进入租赁中。
            </div>
            <div class="grid grid-cols-2 gap-4">
              <el-form-item label="交付车辆">
                <el-input v-model="actionForm.plateNo" placeholder="请输入车牌号" />
              </el-form-item>
              <el-form-item label="出库里程">
                <el-input-number v-model="actionForm.mileage" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="油量百分比">
                <el-input-number v-model="actionForm.fuelLevelPercent" :min="0" :max="100" class="w-full" />
              </el-form-item>
              <el-form-item label="电量百分比">
                <el-input-number v-model="actionForm.batteryLevelPercent" :min="0" :max="100" class="w-full" />
              </el-form-item>
              <el-form-item label="车况清洁度">
                <el-select v-model="actionForm.cleanliness" class="w-full">
                  <el-option label="干净" value="clean" />
                  <el-option label="正常" value="normal" />
                  <el-option label="需清洁" value="dirty" />
                </el-select>
              </el-form-item>
              <el-form-item label="车况照片数量">
                <el-input-number v-model="actionForm.photoCount" :min="0" class="w-full" />
              </el-form-item>
            </div>
            <el-form-item label="发现损伤">
              <el-switch v-model="actionForm.damageFound" active-text="有损伤" inactive-text="无损伤" />
            </el-form-item>
            <el-form-item v-if="actionForm.damageFound" label="损伤说明">
              <el-input v-model="actionForm.damageDescription" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="客户签名">
              <el-switch v-model="actionForm.customerSigned" active-text="已签名" inactive-text="未签名" />
            </el-form-item>
          </template>

          <template v-else-if="pendingAction === 'return-inspection'">
            <div class="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700 mb-4">
              还车验车会生成归还检查记录，并把订单推进到待结算。超时、损伤和清洁费会进入结算汇总。
            </div>
            <div class="grid grid-cols-2 gap-4">
              <el-form-item label="还车里程">
                <el-input-number v-model="actionForm.returnMileage" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="车况照片数量">
                <el-input-number v-model="actionForm.photoCount" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="油量百分比">
                <el-input-number v-model="actionForm.fuelLevelPercent" :min="0" :max="100" class="w-full" />
              </el-form-item>
              <el-form-item label="电量百分比">
                <el-input-number v-model="actionForm.batteryLevelPercent" :min="0" :max="100" class="w-full" />
              </el-form-item>
              <el-form-item label="超时费用">
                <el-input-number v-model="actionForm.overtimeFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="超里程费用">
                <el-input-number v-model="actionForm.extraMileageFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="损伤赔偿">
                <el-input-number v-model="actionForm.damageFeeAmount" :min="0" :step="100" class="w-full" />
              </el-form-item>
              <el-form-item label="清洁/缺件费用">
                <el-input-number v-model="actionForm.cleaningFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="减免金额">
                <el-input-number v-model="actionForm.discountAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
            </div>
            <el-form-item label="发现新增损伤">
              <el-switch v-model="actionForm.damageFound" active-text="有损伤" inactive-text="无损伤" />
            </el-form-item>
            <el-form-item label="损伤/缺件说明">
              <el-input v-model="actionForm.damageDescription" type="textarea" :rows="3" placeholder="可记录损伤位置、缺失配件或清洁问题" />
            </el-form-item>
            <el-form-item label="客户签名">
              <el-switch v-model="actionForm.customerSigned" active-text="已签名" inactive-text="未签名" />
            </el-form-item>
          </template>

          <template v-else-if="pendingAction === 'confirm-settlement'">
            <div class="rounded border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 mb-4">
              结算会按还车差额推进状态：待补缴、待退款或完成。企业月结订单直接写入月结挂账并完成。
            </div>
            <div
              v-if="[OrderMainStatus.PaymentDue, OrderMainStatus.RefundPending].includes(pendingActionRow.mainStatus)"
              class="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 mb-4"
            >
              当前订单已进入{{ statusLabel(pendingActionRow.mainStatus) }}，确认后视为收款/退款已处理并完成还车。
            </div>
            <div v-else class="grid grid-cols-2 gap-4">
              <el-form-item label="超时费用">
                <el-input-number v-model="actionForm.overtimeFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="超里程费用">
                <el-input-number v-model="actionForm.extraMileageFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="损伤赔偿">
                <el-input-number v-model="actionForm.damageFeeAmount" :min="0" :step="100" class="w-full" />
              </el-form-item>
              <el-form-item label="清洁/缺件费用">
                <el-input-number v-model="actionForm.cleaningFeeAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="减免金额">
                <el-input-number v-model="actionForm.discountAmount" :min="0" :step="50" class="w-full" />
              </el-form-item>
              <el-form-item label="最终应收">
                <el-input-number v-model="actionForm.finalReceivableAmount" :min="0" :step="100" class="w-full" />
              </el-form-item>
              <el-form-item label="月结入账">
                <el-switch v-model="actionForm.monthlyBillingPosted" active-text="入账" inactive-text="不入账" />
              </el-form-item>
            </div>
          </template>

          <el-form-item label="操作备注">
            <el-input v-model="actionForm.memo" type="textarea" :rows="3" placeholder="记录门店备注、客户说明或异常处理说明" />
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="actionDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          color="#00689E"
          :disabled="!canSubmitPendingAction"
          :loading="Boolean(pendingActionRow && actionLoading === `${pendingActionRow.id}:${pendingAction}`)"
          @click="confirmOrderAction"
        >
          {{ actionConfirmLabel(pendingAction) }}
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
