<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import type {
  StoreRentalAiDispatchAnalysisResult,
  StoreRentalDispatchBoard,
  StoreRentalDispatchCandidate,
  StoreRentalDispatchEvent,
  StoreRentalDispatchOrderRow,
  StoreRentalDispatchPlan,
  StoreRentalDispatchResultRow,
  StoreRentalDispatchTask,
  StoreRentalDispatchTaskPool,
  StoreRentalDispatchVehicleUnavailableResult,
  StoreRentalVehicleUnavailableReason,
  VehicleInstanceSummary
} from "@store-rental/shared";
import {
  analyzeDispatchWithAi,
  applyDispatchOptimization,
  claimDispatchTask,
  closeDispatchTask,
  getDispatchBoard,
  getDispatchEvents,
  getDispatchTasks,
  hardLockDispatchOrders,
  manualReassignFromDispatch,
  processDispatchTask,
  processDispatchVehicleUnavailable,
  previewDispatchOptimization
} from "../api/client";

const router = useRouter();

const loading = ref(false);
const actionLoading = ref("");
const board = ref<StoreRentalDispatchBoard>();
const taskPool = ref<StoreRentalDispatchTaskPool>();
const dispatchEvents = ref<StoreRentalDispatchEvent[]>([]);
const currentDate = ref<Date>(new Date());
const viewMode = ref<"day" | "week" | "month">("week");
const filterStoreName = ref("");
const filterGroupName = ref("");
const selectedOrder = ref<StoreRentalDispatchOrderRow>();
const selectedVehicle = ref<VehicleInstanceSummary>();
const orderDrawerVisible = ref(false);
const vehicleDrawerVisible = ref(false);
const optimizationConfigVisible = ref(false);
const optimizationResultVisible = ref(false);
const aiDispatchVisible = ref(false);
const vehicleUnavailableVisible = ref(false);
const optimizationDays = ref<3 | 7 | 14>(7);
const optimizationPlan = ref<StoreRentalDispatchPlan>();
const aiAnalysisResult = ref<StoreRentalAiDispatchAnalysisResult>();
const vehicleUnavailableResult = ref<StoreRentalDispatchVehicleUnavailableResult>();

const vehicleUnavailableForm = reactive<{
  orderId?: string;
  vehicleId?: string;
  plateNo?: string;
  reason: StoreRentalVehicleUnavailableReason;
  targetOperationStatus: "controlled" | "maintenance" | "disabled";
  memo: string;
  tryAutoReassign: boolean;
}>({
  reason: "accident",
  targetOperationStatus: "controlled",
  memo: "",
  tryAutoReassign: true
});

const unavailableReasonOptions: Array<{ label: string; value: StoreRentalVehicleUnavailableReason }> = [
  { label: "事故/出险", value: "accident" },
  { label: "车辆维保", value: "maintenance" },
  { label: "车辆禁用", value: "disabled" },
  { label: "车辆被管控", value: "controlled" },
  { label: "证照异常", value: "license_issue" },
  { label: "保险异常", value: "insurance_issue" },
  { label: "整备未完成", value: "cleaning_unready" },
  { label: "其他", value: "other" }
];

const unavailableStatusOptions = [
  { label: "被管控中", value: "controlled" },
  { label: "维修中", value: "maintenance" },
  { label: "禁用", value: "disabled" }
];

const aiCards = [
  { label: "模型提供商", value: "OpenAI Compatible", hint: "租户自有 API Key 接入" },
  { label: "提示词版本", value: "store-rental-dispatch-agent-v1", hint: "系统内置提示词" },
  { label: "数据包版本", value: "dispatch-packet-v1", hint: "仅提交调度必要数据" },
  { label: "执行方式", value: "人工确认", hint: "AI 不直接改订单" }
];

const aiRiskRows = [
  {
    riskType: "整备压力",
    orderNo: "按当前筛选生成",
    description: "AI 分析本期仅预留接入，真实调用需先完成租户模型配置。",
    suggestion: "先使用规则智能优化结果作为基线方案。",
    severity: "中"
  },
  {
    riskType: "候选池约束",
    orderNo: "系统候选池",
    description: "AI 推荐车辆必须来自系统已完成硬约束过滤的候选池。",
    suggestion: "应用前仍执行订单、车辆、时间窗和人工保护校验。",
    severity: "高"
  }
];

const storeOptions = computed(() => [
  ...new Set(board.value?.vehicles.map((vehicle) => vehicle.currentStoreName) ?? [])
]);
const groupOptions = computed(() => [
  ...new Set(board.value?.vehicleGroups.map((group) => group.storeProductGroupName) ?? [])
]);

const referenceDateString = computed(() => toInputDate(currentDate.value));

const gridDates = computed(() => {
  const base = new Date(currentDate.value);
  const start =
    viewMode.value === "month"
      ? new Date(base.getFullYear(), base.getMonth(), 1)
      : viewMode.value === "week"
        ? startOfWeek(base)
        : new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const count =
    viewMode.value === "month"
      ? new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
      : viewMode.value === "week"
        ? 7
        : 1;

  return Array.from({ length: count }, (_, index) => addDays(start, index));
});

const gridStyle = computed(() => ({
  display: "grid",
  gridTemplateColumns: `250px repeat(${gridDates.value.length}, minmax(${viewMode.value === "month" ? "46px" : "140px"}, 1fr))`,
  width: "max-content",
  minWidth: "100%"
}));

const visibleVehicles = computed(() =>
  (board.value?.vehicles ?? []).filter((vehicle) => {
    if (filterStoreName.value && vehicle.currentStoreName !== filterStoreName.value) {
      return false;
    }
    if (filterGroupName.value && vehicle.vehicleGroupName !== filterGroupName.value) {
      return false;
    }
    return true;
  })
);

const vehicleGroups = computed(() => {
  const map = new Map<string, VehicleInstanceSummary[]>();
  visibleVehicles.value.forEach((vehicle) => {
    const current = map.get(vehicle.vehicleGroupName) ?? [];
    current.push(vehicle);
    map.set(vehicle.vehicleGroupName, current);
  });
  return [...map.entries()].map(([name, vehicles]) => ({ name, vehicles }));
});

const dispatchTasks = computed(() => taskPool.value?.tasks ?? []);

const summaryCards = computed(() => {
  const metrics = board.value?.metrics;
  return [
    { label: "排程订单", value: metrics?.activeOrders ?? 0, hint: "当前看板范围内有效订单" },
    { label: "待派车", value: metrics?.pendingOrders ?? 0, hint: "锁车组库存但未绑定具体车辆" },
    { label: "已预分配", value: metrics?.preassignedOrders ?? 0, hint: "可参与后续智能优化" },
    { label: "已硬锁", value: metrics?.lockedOrders ?? 0, hint: "不参与批量优化" },
    { label: "人工调度", value: metrics?.manualRequiredOrders ?? 0, hint: "无车可派或硬锁失败" },
    { label: "候选车辆", value: metrics?.candidateVehicles ?? 0, hint: "满足基础状态的车辆" }
  ];
});

const optimizationRows = computed(() => optimizationPlan.value?.rows ?? []);
const aiRiskRowsVisible = computed(() => aiAnalysisResult.value?.riskRows ?? aiRiskRows);
const aiRecommendationRows = computed(() => aiAnalysisResult.value?.recommendations ?? []);
const optimizationOverview = computed(() => {
  const metrics = optimizationPlan.value?.metrics;
  return [
    { label: "参与优化订单数", value: metrics?.participatingOrders ?? 0 },
    { label: "被调整订单数", value: metrics?.optimizedRows ?? 0 },
    { label: "保持不变订单数", value: metrics?.unchangedRows ?? 0 },
    { label: "未纳入订单数", value: metrics?.skippedRows ?? 0 },
    { label: "临近锁定", value: metrics?.nearLockOrders ?? 0 },
    { label: "涉及车辆数", value: metrics?.candidateVehicles ?? 0 }
  ];
});

onMounted(async () => {
  await loadBoard();
  const firstPickupAt = board.value?.rows
    .map((row) => new Date(row.pickupAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (firstPickupAt) {
    currentDate.value = firstPickupAt;
    await loadBoard();
  }
});

async function loadBoard() {
  loading.value = true;
  try {
    const params = {
      windowDays: optimizationDays.value,
      referenceDate: currentDate.value.toISOString(),
      storeName: filterStoreName.value || undefined,
      vehicleGroupName: filterGroupName.value || undefined
    };
    const [boardData, taskPoolData, eventData] = await Promise.all([
      getDispatchBoard(params),
      getDispatchTasks(params),
      getDispatchEvents({ limit: 20 })
    ]);
    board.value = boardData;
    taskPool.value = taskPoolData;
    dispatchEvents.value = eventData;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "车辆排程加载失败"));
  } finally {
    loading.value = false;
  }
}

function resetFilters() {
  filterStoreName.value = "";
  filterGroupName.value = "";
  void loadBoard();
}

function openOrderDrawer(row: StoreRentalDispatchOrderRow) {
  selectedOrder.value = row;
  orderDrawerVisible.value = true;
}

function openTask(task: StoreRentalDispatchTask) {
  const row = board.value?.rows.find((item) => item.orderId === task.orderId);
  if (row) {
    openOrderDrawer(row);
  }
}

async function claimTask(task: StoreRentalDispatchTask) {
  try {
    await ElMessageBox.confirm(
      `确认认领订单 ${task.orderNo} 的调度任务？认领后其他调度员将无法处理此任务。`,
      "认领调度任务",
      {
        confirmButtonText: "确认认领",
        cancelButtonText: "取消",
        type: "info"
      }
    );
    actionLoading.value = `claim-task-${task.id}`;
    await claimDispatchTask({
      taskId: task.id,
      orderId: task.orderId,
      taskType: task.taskType,
      operator: "营运端"
    });
    ElMessage.success("调度任务已认领");
    await loadBoard();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(readErrorMessage(error, "认领调度任务失败"));
    }
  } finally {
    actionLoading.value = "";
  }
}

async function processTask(task: StoreRentalDispatchTask) {
  try {
    const { value } = await ElMessageBox.prompt(
      "请输入处理说明，系统会写入调度事件流。",
      "处理调度任务",
      {
        confirmButtonText: "确认处理",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPlaceholder: "例如：已联系客户确认取车时间，建议保持当前派车方案",
        inputValidator: (value) => Boolean(value && value.trim()) || "请填写处理说明"
      }
    );
    actionLoading.value = `process-task-${task.id}`;
    await processDispatchTask({
      taskId: task.id,
      orderId: task.orderId,
      taskType: task.taskType,
      status: "processed",
      operator: "营运端",
      memo: value
    });
    ElMessage.success("调度任务已处理");
    await loadBoard();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(readErrorMessage(error, "处理调度任务失败"));
    }
  } finally {
    actionLoading.value = "";
  }
}

async function closeTask(task: StoreRentalDispatchTask) {
  try {
    const { value } = await ElMessageBox.prompt(
      "请输入关闭说明，系统会写入调度事件流。",
      "关闭调度任务",
      {
        confirmButtonText: "关闭任务",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPlaceholder: "例如：已电话确认门店人工处理，暂不需要系统继续提醒",
        inputValidator: (value) => Boolean(value && value.trim()) || "请填写关闭说明"
      }
    );
    actionLoading.value = `close-task-${task.id}`;
    await closeDispatchTask({
      taskId: task.id,
      orderId: task.orderId,
      taskType: task.taskType,
      reason: value,
      operator: "营运端"
    });
    ElMessage.success("调度任务已关闭");
    await loadBoard();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error(readErrorMessage(error, "关闭调度任务失败"));
    }
  } finally {
    actionLoading.value = "";
  }
}

function openVehicleDrawer(vehicle: VehicleInstanceSummary) {
  selectedVehicle.value = vehicle;
  vehicleDrawerVisible.value = true;
}

function openOptimizationConfig() {
  optimizationConfigVisible.value = true;
}

async function runOptimization() {
  actionLoading.value = "optimize";
  try {
    optimizationPlan.value = await previewDispatchOptimization({
      windowDays: optimizationDays.value,
      referenceDate: currentDate.value.toISOString(),
      storeName: filterStoreName.value || undefined,
      vehicleGroupName: filterGroupName.value || undefined,
      operator: "营运端"
    });
    optimizationConfigVisible.value = false;
    optimizationResultVisible.value = true;
    dispatchEvents.value = await getDispatchEvents({ limit: 20 });
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "智能优化失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function applyOptimization() {
  if (!optimizationPlan.value) {
    return;
  }
  actionLoading.value = "apply";
  try {
    const result = await applyDispatchOptimization({
      planId: optimizationPlan.value.planId,
      operator: "营运端",
      rows: optimizationPlan.value.rows
    });
    ElMessage.success(result.message);
    optimizationResultVisible.value = false;
    await loadBoard();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "应用优化结果失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function hardLockSelected(order?: StoreRentalDispatchOrderRow) {
  actionLoading.value = "hard-lock";
  try {
    const result = await hardLockDispatchOrders({
      orderIds: order ? [order.orderId] : undefined,
      windowDays: optimizationDays.value,
      referenceDate: currentDate.value.toISOString(),
      storeName: filterStoreName.value || undefined,
      operator: "营运端"
    });
    ElMessage.success(result.message);
    await loadBoard();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "硬锁处理失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function manualAssign(candidate: StoreRentalDispatchCandidate) {
  const order = selectedOrder.value;
  if (!order) {
    return;
  }
  // DP-01: 人工改派确认对话框
  try {
    await ElMessageBox.confirm(
      `确认将订单 ${order.orderNo} 改派至车辆 ${candidate.licensePlate}？\n当前车辆：${order.plateNo || '未分配'}\n目标车辆：${candidate.licensePlate} (${candidate.currentStoreName})`,
      "人工改派确认",
      { type: "warning", confirmButtonText: "确认改派", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  actionLoading.value = `manual-${candidate.vehicleId}`;
  try {
    const result = await manualReassignFromDispatch({
      orderId: order.orderId,
      targetVehicleId: candidate.vehicleId,
      reason: "车辆调度调整",
      operator: "营运端",
      memo: "调度页人工改派"
    });
    ElMessage.success(result.message);
    orderDrawerVisible.value = false;
    await loadBoard();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "人工改派失败"));
  } finally {
    actionLoading.value = "";
  }
}

function openAiDispatch() {
  aiDispatchVisible.value = true;
}

function openVehicleUnavailableFromOrder(order = selectedOrder.value) {
  if (!order?.currentPlateNo) {
    ElMessage.warning("当前订单未绑定车辆，无需释放车辆占用。");
    return;
  }
  Object.assign(vehicleUnavailableForm, {
    orderId: order.orderId,
    vehicleId: undefined,
    plateNo: order.currentPlateNo,
    reason: "accident" as StoreRentalVehicleUnavailableReason,
    targetOperationStatus: "controlled",
    memo: "",
    tryAutoReassign: true
  });
  vehicleUnavailableResult.value = undefined;
  vehicleUnavailableVisible.value = true;
}

function openVehicleUnavailableFromVehicle(vehicle = selectedVehicle.value) {
  if (!vehicle) {
    return;
  }
  Object.assign(vehicleUnavailableForm, {
    orderId: undefined,
    vehicleId: vehicle.id,
    plateNo: vehicle.licensePlate,
    reason:
      vehicle.operationStatus === "maintenance"
        ? ("maintenance" as StoreRentalVehicleUnavailableReason)
        : ("controlled" as StoreRentalVehicleUnavailableReason),
    targetOperationStatus:
      vehicle.operationStatus === "maintenance" ? "maintenance" : "controlled",
    memo: "",
    tryAutoReassign: true
  });
  vehicleUnavailableResult.value = undefined;
  vehicleUnavailableVisible.value = true;
}

function syncUnavailableStatusByReason(reason: StoreRentalVehicleUnavailableReason) {
  if (reason === "disabled") {
    vehicleUnavailableForm.targetOperationStatus = "disabled";
  } else if (reason === "maintenance") {
    vehicleUnavailableForm.targetOperationStatus = "maintenance";
  } else if (vehicleUnavailableForm.targetOperationStatus === "disabled") {
    vehicleUnavailableForm.targetOperationStatus = "controlled";
  }
}

async function submitVehicleUnavailable() {
  if (!vehicleUnavailableForm.plateNo && !vehicleUnavailableForm.vehicleId && !vehicleUnavailableForm.orderId) {
    ElMessage.warning("请选择需要处理的车辆或订单。");
    return;
  }
  actionLoading.value = "vehicle-unavailable";
  try {
    const result = await processDispatchVehicleUnavailable({
      orderId: vehicleUnavailableForm.orderId,
      vehicleId: vehicleUnavailableForm.vehicleId,
      plateNo: vehicleUnavailableForm.plateNo,
      reason: vehicleUnavailableForm.reason,
      targetOperationStatus: vehicleUnavailableForm.targetOperationStatus,
      memo: vehicleUnavailableForm.memo,
      operator: "营运端",
      tryAutoReassign: vehicleUnavailableForm.tryAutoReassign
    });
    vehicleUnavailableResult.value = result;
    ElMessage.success(result.message);
    await loadBoard();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "车辆不可交付处理失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function runAiAnalysis() {
  actionLoading.value = "ai-analysis";
  try {
    aiAnalysisResult.value = await analyzeDispatchWithAi({
      windowDays: optimizationDays.value,
      referenceDate: currentDate.value.toISOString(),
      storeName: filterStoreName.value || undefined,
      vehicleGroupName: filterGroupName.value || undefined,
      operator: "营运端"
    });
    dispatchEvents.value = await getDispatchEvents({ limit: 20 });
    ElMessage.success(aiAnalysisResult.value.message);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "AI 调度分析请求失败"));
  } finally {
    actionLoading.value = "";
  }
}

function goToOrderDetail(order?: StoreRentalDispatchOrderRow) {
  const target = order ?? selectedOrder.value;
  if (!target) {
    return;
  }
  void router.push(`/orders/${target.orderId}`);
}

function ordersForVehicleDay(vehicle: VehicleInstanceSummary, date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = addDays(start, 1);
  return (board.value?.rows ?? []).filter((row) => {
    if (row.currentPlateNo !== vehicle.licensePlate) {
      return false;
    }
    return new Date(row.pickupAt) < end && new Date(row.returnAt) > start;
  });
}

function vehicleOrders(vehicle: VehicleInstanceSummary) {
  return (board.value?.rows ?? [])
    .filter((row) => row.currentPlateNo === vehicle.licensePlate)
    .sort((left, right) => new Date(left.pickupAt).getTime() - new Date(right.pickupAt).getTime());
}

function rowClass(row: StoreRentalDispatchOrderRow) {
  const status = row.dispatchStatus;
  if (status === "locked") {
    return "bg-emerald-50 border border-emerald-200 text-emerald-800";
  }
  if (status === "manual_reassigned" || status === "upgraded") {
    return "bg-violet-50 border border-violet-200 text-violet-800";
  }
  if (status === "dispatch_manual_required") {
    return "bg-red-50 border border-red-200 text-red-700";
  }
  if (status === "pre_assigned") {
    return "bg-amber-50 border border-amber-200 text-amber-800";
  }
  return "bg-blue-50 border border-blue-200 text-blue-800";
}

function vehicleStatusType(status: VehicleInstanceSummary["operationStatus"]) {
  if (status === "idle") return "success";
  if (status === "renting") return "primary";
  if (status === "reserved") return "warning";
  return "info";
}

function vehicleStatusText(status: VehicleInstanceSummary["operationStatus"]) {
  const map: Record<string, string> = {
    idle: "空闲",
    renting: "租赁中",
    reserved: "已预约",
    controlled: "整备中",
    maintenance: "维保",
    disabled: "停用"
  };
  return map[status] || status;
}

function dispatchStatusText(status: string) {
  const map: Record<string, string> = {
    pending: "待派车",
    pre_assigned: "预分配",
    locked: "已硬锁",
    manual_reassigned: "人工改派",
    upgraded: "免费升等",
    dispatch_manual_required: "人工调度"
  };
  return map[status] ?? status;
}

function resultStatusText(status: string) {
  const map: Record<string, string> = {
    optimized: "已优化",
    unchanged: "保持原车",
    skipped: "未纳入",
    failed: "应用失败"
  };
  return map[status] ?? status;
}

function resultTagType(status: string) {
  if (status === "optimized") return "success";
  if (status === "skipped") return "info";
  if (status === "failed") return "danger";
  return "warning";
}

function riskTagType(level: string) {
  if (level === "high") return "danger";
  if (level === "medium") return "warning";
  return "success";
}

function taskTypeText(type: StoreRentalDispatchTask["taskType"]) {
  const map: Record<StoreRentalDispatchTask["taskType"], string> = {
    unassigned: "待派车",
    near_lock_unlocked: "临近未硬锁",
    manual_required: "人工调度",
    vehicle_unavailable: "车辆不可交付",
    manual_protected_invalid: "人工结果失效",
    accident_reassignment: "事故改派"
  };
  return map[type];
}

function taskPriorityType(priority: StoreRentalDispatchTask["priority"]) {
  if (priority === "high") return "danger";
  if (priority === "medium") return "warning";
  return "info";
}

function eventTypeText(type: StoreRentalDispatchEvent["eventType"]) {
  const map: Record<StoreRentalDispatchEvent["eventType"], string> = {
    optimization_preview: "优化预览",
    optimization_apply: "应用优化",
    optimization_apply_failed: "应用失败",
    hard_lock_success: "硬锁成功",
    hard_lock_failed: "硬锁失败",
    manual_reassign: "人工改派",
    manual_required: "人工告警",
    vehicle_unavailable: "车辆不可交付",
    ai_analysis: "AI分析",
    alert_closed: "告警关闭"
  };
  return map[type];
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDay(value: Date) {
  return `${pad(value.getMonth() + 1)}/${pad(value.getDate())}`;
}

function formatWeekday(value: Date) {
  return ["日", "一", "二", "三", "四", "五", "六"][value.getDay()];
}

function isToday(value: Date) {
  const today = new Date();
  return toInputDate(value) === toInputDate(today);
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setDate(date.getDate() - date.getDay());
  date.setHours(0, 0, 0, 0);
  return date;
}

function toInputDate(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function readErrorMessage(error: unknown, fallback: string) {
  const response = error as { response?: { data?: { message?: string } } };
  return response.response?.data?.message ?? fallback;
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车辆排程看板</h1>
        <p class="text-gray-500 text-sm mt-1">可视化管理车辆排班、调度与冲突处理。</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <el-button-group>
          <el-button :type="viewMode === 'day' ? 'primary' : ''" @click="viewMode = 'day'">日</el-button>
          <el-button :type="viewMode === 'week' ? 'primary' : ''" @click="viewMode = 'week'">周</el-button>
          <el-button :type="viewMode === 'month' ? 'primary' : ''" @click="viewMode = 'month'">月</el-button>
        </el-button-group>
        <el-date-picker
          v-model="currentDate"
          type="date"
          :clearable="false"
          style="width: 150px"
          @change="loadBoard"
        />
        <el-button type="primary" color="#4f46e5" @click="openOptimizationConfig">
          <el-icon class="mr-1"><MagicStick /></el-icon>
          智能优化
        </el-button>
        <el-button color="#7c3aed" @click="openAiDispatch">
          <el-icon class="mr-1"><Connection /></el-icon>
          AI分析
        </el-button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <div v-for="card in summaryCards" :key="card.label" class="rounded-lg border border-gray-200 bg-white p-4">
        <div class="text-xs text-gray-400 uppercase tracking-wider">{{ card.label }}</div>
        <div class="text-2xl font-bold text-gray-800 mt-2">{{ card.value }}</div>
        <div class="text-xs text-gray-500 mt-1">{{ card.hint }}</div>
      </div>
    </div>

    <div class="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-sm text-gray-500">筛选:</span>
        <el-select v-model="filterStoreName" placeholder="选择门市" clearable style="width: 180px" @change="loadBoard">
          <el-option v-for="store in storeOptions" :key="store" :label="store" :value="store" />
        </el-select>
        <el-select v-model="filterGroupName" placeholder="车型组" clearable style="width: 220px" @change="loadBoard">
          <el-option v-for="group in groupOptions" :key="group" :label="group" :value="group" />
        </el-select>
        <el-tooltip content="重置筛选" placement="top">
          <el-button circle @click="resetFilters"><el-icon><Refresh /></el-icon></el-button>
        </el-tooltip>
      </div>
      <div class="flex items-center gap-4 text-xs text-gray-500">
        <span class="inline-flex items-center"><span class="w-3 h-3 bg-blue-100 border border-blue-300 mr-1"></span> 待派车</span>
        <span class="inline-flex items-center"><span class="w-3 h-3 bg-amber-50 border border-amber-300 mr-1"></span> 预分配</span>
        <span class="inline-flex items-center"><span class="w-3 h-3 bg-emerald-50 border border-emerald-300 mr-1"></span> 已硬锁</span>
        <span class="inline-flex items-center"><span class="w-3 h-3 bg-red-50 border border-red-300 mr-1"></span> 人工调度</span>
      </div>
    </div>

    <div class="grid grid-cols-1 2xl:grid-cols-[1fr_320px] gap-4">
      <div v-loading="loading" class="overflow-auto custom-scroll bg-white rounded-lg border border-gray-200 shadow-sm min-h-[560px]">
        <div style="width: max-content; min-width: 100%;">
          <div class="sticky top-0 z-40 bg-slate-50 border-t border-l border-gray-200" :style="gridStyle">
            <div class="sticky left-0 z-50 bg-slate-50 border-r border-b border-gray-200 p-3 text-sm font-semibold text-gray-600 flex items-center justify-center">
              车辆资源
            </div>
            <div
              v-for="day in gridDates"
              :key="day.toISOString()"
              class="border-r border-b border-gray-200 p-2 text-center text-sm font-semibold text-gray-600"
              :class="isToday(day) ? 'bg-blue-50 text-blue-600' : ''"
            >
              <div>{{ formatDay(day) }}</div>
              <div class="text-xs mt-1">周{{ formatWeekday(day) }}</div>
            </div>
          </div>

          <template v-for="group in vehicleGroups" :key="group.name">
            <div class="border-l border-gray-200" :style="gridStyle">
              <div class="sticky left-0 z-30 bg-gray-100 border-r border-b border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">
                {{ group.name }} ({{ group.vehicles.length }}辆)
              </div>
              <div class="bg-gray-100 border-b border-gray-200" :style="{ gridColumn: '2 / -1' }"></div>

              <template v-for="vehicle in group.vehicles" :key="vehicle.id">
                <div
                  class="sticky left-0 z-30 bg-white border-r border-b border-gray-200 px-4 py-3 cursor-pointer hover:bg-gray-50"
                  @click="openVehicleDrawer(vehicle)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-bold text-slate-800 text-sm">{{ vehicle.licensePlate }}</span>
                    <el-tag size="small" effect="light" :type="vehicleStatusType(vehicle.operationStatus)">
                      {{ vehicle.operationStatus }}
                    </el-tag>
                  </div>
                  <div class="text-xs text-gray-400 mt-1 truncate">{{ vehicle.currentStoreName }} / {{ vehicle.currentStationName }}</div>
                </div>

                <div
                  v-for="day in gridDates"
                  :key="`${vehicle.id}_${day.toISOString()}`"
                  class="border-r border-b border-gray-200 min-h-[64px] p-1 flex gap-1"
                  :class="[0, 6].includes(day.getDay()) ? 'bg-slate-50' : 'bg-white'"
                >
                  <button
                    v-for="row in ordersForVehicleDay(vehicle, day)"
                    :key="row.orderId"
                    type="button"
                    class="min-w-[96px] flex-1 rounded px-2 py-1 text-xs text-left shadow-sm hover:shadow-md transition"
                    :class="rowClass(row)"
                    @click="openOrderDrawer(row)"
                  >
                    <div class="flex items-center justify-between gap-1">
                      <span class="flex items-center gap-1 font-bold truncate">
                        <el-icon v-if="row.dispatchStatus === 'locked'" class="text-emerald-600 shrink-0" :size="12"><Lock /></el-icon>
                        {{ row.customerName }}
                      </span>
                      <span class="shrink-0 border rounded px-1 py-[1px] text-[10px]" :class="row.dispatchStatus === 'locked' ? 'border-emerald-300 bg-emerald-100 text-emerald-700 font-semibold' : ''">
                        {{ dispatchStatusText(row.dispatchStatus) }}
                      </span>
                    </div>
                    <div class="mt-1 truncate">{{ formatDateTime(row.pickupAt) }} - {{ formatDateTime(row.returnAt) }}</div>
                  </button>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>

      <aside class="bg-white rounded-lg border border-gray-200 p-4 h-fit">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-sm font-semibold text-gray-800">待处理调度队列</div>
            <div class="text-xs text-gray-500 mt-1">待派车、临近未硬锁、车辆不可交付和人工告警</div>
          </div>
          <el-button size="small" :loading="actionLoading === 'hard-lock'" @click="hardLockSelected()">
            批量硬锁
          </el-button>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div class="rounded border border-gray-100 bg-slate-50 p-2">
            <div class="text-[11px] text-gray-400">任务</div>
            <div class="text-lg font-bold text-gray-800">{{ taskPool?.metrics.totalTasks ?? 0 }}</div>
          </div>
          <div class="rounded border border-gray-100 bg-red-50 p-2">
            <div class="text-[11px] text-red-400">高优先</div>
            <div class="text-lg font-bold text-red-700">{{ taskPool?.metrics.highPriorityTasks ?? 0 }}</div>
          </div>
          <div class="rounded border border-gray-100 bg-amber-50 p-2">
            <div class="text-[11px] text-amber-500">临近</div>
            <div class="text-lg font-bold text-amber-700">{{ taskPool?.metrics.nearLockTasks ?? 0 }}</div>
          </div>
        </div>
        <div class="space-y-2 max-h-[360px] overflow-auto custom-scroll">
          <div
            v-for="task in dispatchTasks"
            :key="task.id"
            role="button"
            tabindex="0"
            class="w-full text-left rounded-lg border border-gray-200 p-3 hover:border-blue-300 hover:bg-blue-50/40"
            @click="openTask(task)"
            @keydown.enter.prevent="openTask(task)"
            @keydown.space.prevent="openTask(task)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-sm text-gray-800">{{ task.orderNo }}</span>
              <el-tag size="small" :type="taskPriorityType(task.priority)">
                {{ taskTypeText(task.taskType) }}
              </el-tag>
            </div>
            <div class="text-xs text-gray-500 mt-2">{{ task.customerName }} / {{ task.vehicleGroupName }}</div>
            <div class="text-xs text-gray-400 mt-1">{{ formatDateTime(task.pickupAt) }} 取车</div>
            <div class="text-xs text-gray-500 mt-2 leading-5">{{ task.reasonText }}</div>
            <div class="flex items-center justify-between mt-2 text-[11px] text-gray-400">
              <span>{{ task.currentPlateNo || '未分配车辆' }}</span>
              <span>{{ task.candidates.length }} 辆候选</span>
            </div>
            <div class="mt-3 flex justify-end gap-2">
              <el-button size="small" text @click.stop="openTask(task)">查看订单</el-button>
              <el-button
                size="small"
                type="success"
                plain
                :loading="actionLoading === `claim-task-${task.id}`"
                @click.stop="claimTask(task)"
              >
                认领任务
              </el-button>
              <el-button
                size="small"
                type="primary"
                plain
                :loading="actionLoading === `process-task-${task.id}`"
                @click.stop="processTask(task)"
              >
                处理任务
              </el-button>
              <el-button
                size="small"
                type="warning"
                plain
                :loading="actionLoading === `close-task-${task.id}`"
                @click.stop="closeTask(task)"
              >
                关闭任务
              </el-button>
            </div>
          </div>
          <div v-if="dispatchTasks.length === 0" class="text-center text-sm text-gray-400 py-8">当前无待处理调度订单</div>
        </div>

        <div class="border-t border-gray-100 mt-4 pt-4">
          <div class="text-sm font-semibold text-gray-800 mb-3">调度事件历史时间线</div>
          <div class="max-h-[320px] overflow-auto custom-scroll">
            <el-timeline v-if="dispatchEvents.length > 0">
              <el-timeline-item
                v-for="event in dispatchEvents"
                :key="event.id"
                :type="event.riskLevel === 'high' ? 'danger' : event.riskLevel === 'medium' ? 'warning' : 'primary'"
                :color="event.eventType === 'hard_lock_success' ? '#10b981' : event.eventType === 'manual_reassign' ? '#8b5cf6' : event.eventType === 'vehicle_unavailable' ? '#ef4444' : undefined"
                :timestamp="formatDateTime(event.createdAt)"
                placement="top"
              >
                <div class="rounded-lg border border-gray-100 bg-slate-50 p-2.5">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-semibold text-gray-700">{{ eventTypeText(event.eventType) }}</span>
                    <div class="flex items-center gap-1">
                      <el-tag v-if="event.eventType === 'hard_lock_success'" size="small" type="success" effect="plain">
                        <el-icon class="mr-0.5"><Lock /></el-icon> 已锁
                      </el-tag>
                      <el-tag size="small" effect="plain" :type="riskTagType(event.riskLevel)">{{ event.riskLevel }}</el-tag>
                    </div>
                  </div>
                  <div class="text-xs text-gray-500 mt-1.5">{{ event.orderNo || event.planId || '全局调度' }}</div>
                  <div class="text-xs text-gray-400 mt-1">{{ event.reasonText || event.title }}</div>
                  <div class="text-[11px] text-gray-400 mt-1.5 flex items-center gap-2">
                    <span>{{ event.operator || event.source }}</span>
                    <span v-if="event.beforeVehicle && event.targetVehicle" class="text-indigo-500">
                      {{ event.beforeVehicle }} → {{ event.targetVehicle }}
                    </span>
                  </div>
                </div>
              </el-timeline-item>
            </el-timeline>
            <div v-else class="text-center text-sm text-gray-400 py-6">暂无调度事件</div>
          </div>
        </div>
      </aside>
    </div>

    <el-drawer v-model="orderDrawerVisible" title="订单调度详情" size="440px">
      <template v-if="selectedOrder">
        <div class="space-y-5">
          <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
            <div class="flex justify-between items-start mb-2">
              <span class="text-lg font-bold text-blue-900">{{ selectedOrder.customerName }}</span>
              <div class="flex items-center gap-2">
                <el-tag v-if="selectedOrder.dispatchStatus === 'locked'" type="success" effect="dark">
                  <el-icon class="mr-1"><Lock /></el-icon>已硬锁
                </el-tag>
                <el-tag>{{ dispatchStatusText(selectedOrder.dispatchStatus) }}</el-tag>
              </div>
            </div>
            <div class="text-sm text-blue-700 space-y-1">
              <div>订单：{{ selectedOrder.orderNo }}</div>
              <div>当前车辆：<b>{{ selectedOrder.currentPlateNo || '未分配' }}</b></div>
              <div>车组：{{ selectedOrder.vehicleGroupName }}</div>
            </div>
            <div v-if="selectedOrder.dispatchStatus === 'locked'" class="mt-3 flex items-center gap-2 rounded-md bg-emerald-100 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
              <el-icon class="shrink-0"><Lock /></el-icon>
              <span>此订单已硬锁，不参与批量优化。如需调整请先解锁后重新分配。</span>
            </div>
          </div>

          <div>
            <h4 class="text-sm font-bold text-gray-500 mb-3 uppercase">租期信息</h4>
            <el-timeline>
              <el-timeline-item :timestamp="formatDateTime(selectedOrder.pickupAt)" type="primary">
                <div class="font-medium">取车：{{ selectedOrder.pickupStoreName }}</div>
              </el-timeline-item>
              <el-timeline-item :timestamp="formatDateTime(selectedOrder.returnAt)" type="success">
                <div class="font-medium">还车：{{ selectedOrder.returnStoreName }}</div>
              </el-timeline-item>
            </el-timeline>
          </div>

          <div>
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-sm font-bold text-gray-500 uppercase">候选车辆</h4>
              <el-button size="small" :loading="actionLoading === 'hard-lock'" @click="hardLockSelected(selectedOrder)">
                硬锁本单
              </el-button>
            </div>
            <div class="space-y-2">
              <div
                v-for="candidate in selectedOrder.candidates"
                :key="candidate.vehicleId"
                class="rounded-lg border border-gray-200 p-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="font-bold text-gray-800">{{ candidate.licensePlate }}</span>
                      <el-tag v-if="candidate.operationStatus" size="small" :type="vehicleStatusType(candidate.operationStatus)" effect="plain">
                        {{ vehicleStatusText(candidate.operationStatus) }}
                      </el-tag>
                    </div>
                    <div class="text-xs text-gray-500 mt-1">{{ candidate.currentStoreName }} / {{ candidate.currentStationName }}</div>
                    <div v-if="candidate.score !== undefined" class="text-xs text-indigo-600 mt-1">
                      匹配度：{{ candidate.score }}{{ candidate.scoreText ? ` · ${candidate.scoreText}` : '' }}
                    </div>
                  </div>
                  <el-button
                    type="primary"
                    size="small"
                    plain
                    :loading="actionLoading === `manual-${candidate.vehicleId}`"
                    @click="manualAssign(candidate)"
                  >
                    改派至此车
                  </el-button>
                </div>
                <div class="flex flex-wrap gap-1 mt-3">
                  <el-tag v-for="tag in candidate.reasonTags" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
                  <el-tag v-for="flag in candidate.riskFlags" :key="flag" size="small" type="warning" effect="plain">{{ flag }}</el-tag>
                </div>
              </div>
              <div v-if="selectedOrder.candidates.length === 0" class="text-sm text-gray-400 text-center py-6 border rounded-lg">
                当前没有可用候选车辆
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-gray-100">
            <el-button type="primary" plain @click="goToOrderDetail(selectedOrder)">查看完整订单详情</el-button>
            <el-button
              type="danger"
              plain
              :disabled="!selectedOrder.currentPlateNo"
              @click="openVehicleUnavailableFromOrder(selectedOrder)"
            >
              车辆不可交付
            </el-button>
            <el-button plain @click="orderDrawerVisible = false">关闭</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <el-drawer v-model="vehicleDrawerVisible" title="车辆排程看板详情" size="450px">
      <template v-if="selectedVehicle">
        <div class="space-y-5">
          <div class="bg-gray-50 p-4 rounded-lg border border-gray-200">
            <div class="flex justify-between items-start mb-2">
              <span class="text-xl font-bold text-slate-800">{{ selectedVehicle.licensePlate }}</span>
              <el-tag :type="vehicleStatusType(selectedVehicle.operationStatus)">{{ selectedVehicle.operationStatus }}</el-tag>
            </div>
            <div class="text-sm text-gray-500">{{ selectedVehicle.vehicleGroupName }}</div>
            <div class="text-xs text-gray-400 mt-2">{{ selectedVehicle.currentStoreName }} / {{ selectedVehicle.currentStationName }}</div>
            <el-button
              class="mt-4 w-full"
              type="danger"
              plain
              @click="openVehicleUnavailableFromVehicle(selectedVehicle)"
            >
              车辆不可交付处理
            </el-button>
          </div>

          <div>
            <h4 class="text-sm font-bold text-gray-500 mb-4 uppercase">排班时间轴</h4>
            <el-timeline>
              <el-timeline-item
                v-for="row in vehicleOrders(selectedVehicle)"
                :key="row.orderId"
                :timestamp="formatDateTime(row.pickupAt)"
                color="#409eff"
              >
                <div class="bg-blue-50 p-3 rounded border border-blue-100 cursor-pointer" @click="openOrderDrawer(row)">
                  <div class="flex justify-between items-center mb-1">
                    <span class="font-bold text-blue-900">{{ row.customerName }}</span>
                    <el-tag size="small">{{ dispatchStatusText(row.dispatchStatus) }}</el-tag>
                  </div>
                  <div class="text-xs text-blue-700">{{ formatDateTime(row.pickupAt) }} - {{ formatDateTime(row.returnAt) }}</div>
                </div>
              </el-timeline-item>
              <el-timeline-item v-if="vehicleOrders(selectedVehicle).length === 0" color="#e4e7ed">
                <div class="text-gray-400 text-xs text-center py-2">未来暂无更多排班</div>
              </el-timeline-item>
            </el-timeline>
          </div>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="optimizationConfigVisible" width="820px" top="8vh">
      <template #header>
        <div>
          <div class="text-[22px] font-bold text-gray-800 tracking-tight">智能优化排班</div>
          <div class="text-sm text-gray-500 mt-1">对未硬锁定订单进行全局重排，生成更优的车辆预分配结果</div>
        </div>
      </template>
      <div class="space-y-5">
        <section class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="text-sm font-semibold text-gray-800 mb-4">优化时间窗口</div>
          <el-radio-group v-model="optimizationDays">
            <el-radio-button :label="3">未来 3 天</el-radio-button>
            <el-radio-button :label="7">未来 7 天</el-radio-button>
            <el-radio-button :label="14">未来 14 天</el-radio-button>
          </el-radio-group>
        </section>
        <section class="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-sm font-semibold text-gray-800">默认先预览</div>
              <div class="text-xs text-gray-500 mt-1 leading-5">开始优化后只生成结果，确认应用后才写入预分配。</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-sm font-semibold text-gray-800">保护人工结果</div>
              <div class="text-xs text-gray-500 mt-1 leading-5">人工改派和免费升等订单固定不参与批量优化。</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-sm font-semibold text-gray-800">临近取车保护</div>
              <div class="text-xs text-gray-500 mt-1 leading-5">进入硬锁定时间点前 2 小时的订单不参与批量优化。</div>
            </div>
            <div class="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div class="text-sm font-semibold text-gray-800">应用前校验</div>
              <div class="text-xs text-gray-500 mt-1 leading-5">确认应用时重查订单、车辆、门市和时间窗冲突。</div>
            </div>
          </div>
        </section>
      </div>
      <template #footer>
        <el-button @click="optimizationConfigVisible = false">取消</el-button>
        <el-button type="primary" :loading="actionLoading === 'optimize'" @click="runOptimization">开始优化</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="optimizationResultVisible" width="1180px" top="4vh">
      <template #header>
        <div>
          <div class="text-[22px] font-bold text-gray-800 tracking-tight">智能优化结果</div>
          <div class="text-sm text-gray-500 mt-1">已生成新的预分配方案，请确认是否应用</div>
        </div>
      </template>
      <div class="space-y-5 max-h-[70vh] overflow-y-auto pr-2">
        <section class="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div class="grid grid-cols-3 xl:grid-cols-6 gap-3">
            <div v-for="item in optimizationOverview" :key="item.label" class="rounded-lg border border-white bg-white p-4">
              <div class="text-xs uppercase tracking-wider text-gray-400">{{ item.label }}</div>
              <div class="text-[26px] font-bold text-gray-800 mt-2">{{ item.value }}</div>
            </div>
          </div>
        </section>
        <section class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="text-sm font-semibold text-gray-800">订单变更明细</div>
              <div class="text-xs text-gray-500 mt-1">展示本次重点变更、保持原车和未纳入优化的订单</div>
            </div>
            <el-tag type="success" effect="plain">{{ optimizationPlan?.metrics.optimizedRows ?? 0 }} 笔订单已优化</el-tag>
          </div>
          <el-table :data="optimizationRows" border stripe height="320">
            <el-table-column prop="orderNo" label="订单编号" width="150" />
            <el-table-column label="取还车时间" min-width="180">
              <template #default="{ row }: { row: StoreRentalDispatchResultRow }">
                <div class="text-sm text-gray-700">{{ formatDateTime(row.pickupAt) }} 取</div>
                <div class="text-xs text-gray-400 mt-1">{{ formatDateTime(row.returnAt) }} 还</div>
              </template>
            </el-table-column>
            <el-table-column prop="vehicleGroupName" label="车型组" width="180" />
            <el-table-column prop="beforeVehicle" label="优化前车辆" width="130" />
            <el-table-column prop="targetVehicle" label="优化后车辆" width="130" />
            <el-table-column prop="reasonText" label="变更原因" min-width="160" />
            <el-table-column label="状态" width="110">
              <template #default="{ row }: { row: StoreRentalDispatchResultRow }">
                <el-tag size="small" effect="plain" :type="resultTagType(row.resultStatus)">
                  {{ resultStatusText(row.resultStatus) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="风险" width="90">
              <template #default="{ row }: { row: StoreRentalDispatchResultRow }">
                <el-tag size="small" effect="plain" :type="riskTagType(row.riskLevel)">{{ row.riskLevel }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
      <template #footer>
        <el-button @click="optimizationResultVisible = false">关闭</el-button>
        <el-button type="primary" :loading="actionLoading === 'apply'" @click="applyOptimization">确认应用优化结果</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="aiDispatchVisible" width="980px" top="6vh">
      <template #header>
        <div>
          <div class="text-[22px] font-bold text-gray-800 tracking-tight">AI调度分析</div>
          <div class="text-sm text-gray-500 mt-1">基于租户模型配置、命中提示词和调度数据包生成风险诊断与推荐动作</div>
        </div>
      </template>
      <div class="space-y-5">
        <section class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <div v-for="item in aiCards" :key="item.label" class="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div class="text-xs uppercase tracking-wider text-gray-400">{{ item.label }}</div>
              <div class="text-sm font-semibold text-gray-800 mt-2">{{ item.value }}</div>
              <div class="text-xs text-gray-500 mt-2 leading-5">{{ item.hint }}</div>
            </div>
          </div>
        </section>
        <section class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="text-sm font-semibold text-gray-800 mb-4">风险诊断明细</div>
          <el-table :data="aiRiskRowsVisible" border stripe>
            <el-table-column prop="riskType" label="风险类型" width="130" />
            <el-table-column prop="orderNo" label="订单编号" width="150" />
            <el-table-column prop="description" label="风险说明" min-width="280" />
            <el-table-column prop="suggestion" label="建议动作" min-width="220" />
            <el-table-column prop="severity" label="等级" width="90" />
          </el-table>
        </section>
        <section v-if="aiAnalysisResult" class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <div class="text-sm font-semibold text-gray-800">请求包与推荐摘要</div>
              <div class="text-xs text-gray-500 mt-1">
                {{ aiAnalysisResult.requestSummary.storeScopeLabel }} /
                {{ aiAnalysisResult.requestSummary.windowDays }} 天 /
                {{ aiAnalysisResult.requestSummary.orderCount }} 笔订单 /
                {{ aiAnalysisResult.requestSummary.candidateVehicleCount }} 辆候选车
              </div>
            </div>
            <el-tag type="info" effect="plain">{{ aiAnalysisResult.mode }}</el-tag>
          </div>
          <el-table :data="aiRecommendationRows" border stripe max-height="260">
            <el-table-column prop="orderNo" label="订单编号" width="150" />
            <el-table-column prop="action" label="建议动作" width="130" />
            <el-table-column prop="targetVehicle" label="推荐车辆" width="130" />
            <el-table-column prop="reasonText" label="推荐说明" min-width="260" />
            <el-table-column prop="confidence" label="信心" width="90" />
            <el-table-column label="可应用" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.applyReady ? 'success' : 'info'" effect="plain">
                  {{ row.applyReady ? '是' : '否' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
      <template #footer>
        <div class="w-full flex items-center justify-between gap-3">
          <div class="text-xs text-gray-500">AI 推荐应用前仍执行订单状态、车辆状态、时间窗、人工保护和权限二次校验。</div>
          <div class="flex items-center gap-2">
            <el-button @click="aiDispatchVisible = false">关闭</el-button>
            <el-button type="primary" :loading="actionLoading === 'ai-analysis'" @click="runAiAnalysis">
              生成AI分析请求
            </el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="vehicleUnavailableVisible" width="920px" top="6vh">
      <template #header>
        <div>
          <div class="text-[22px] font-bold text-gray-800 tracking-tight">车辆不可交付处理</div>
          <div class="text-sm text-gray-500 mt-1">
            按 PRD 释放或改派后续未开始履约订单，人工结果保护订单进入人工确认。
          </div>
        </div>
      </template>
      <div class="space-y-5">
        <section class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <el-form-item label="车辆">
              <el-input v-model="vehicleUnavailableForm.plateNo" disabled />
            </el-form-item>
            <el-form-item label="不可交付原因">
              <el-select
                v-model="vehicleUnavailableForm.reason"
                class="w-full"
                @change="syncUnavailableStatusByReason"
              >
                <el-option
                  v-for="item in unavailableReasonOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="车辆处理状态">
              <el-select v-model="vehicleUnavailableForm.targetOperationStatus" class="w-full">
                <el-option
                  v-for="item in unavailableStatusOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="自动改派">
              <el-switch
                v-model="vehicleUnavailableForm.tryAutoReassign"
                active-text="尝试"
                inactive-text="直接人工"
              />
            </el-form-item>
            <el-form-item label="处理备注" class="md:col-span-2">
              <el-input
                v-model="vehicleUnavailableForm.memo"
                type="textarea"
                :rows="3"
                placeholder="记录事故、维保、证照异常、整备未完成或门店协调说明"
              />
            </el-form-item>
          </div>
        </section>

        <section v-if="vehicleUnavailableResult" class="rounded-lg border border-slate-200 bg-white p-5">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="rounded border border-slate-100 bg-slate-50 p-3">
              <div class="text-xs text-gray-400">影响订单</div>
              <div class="text-xl font-bold text-gray-800 mt-1">{{ vehicleUnavailableResult.affectedCount }}</div>
            </div>
            <div class="rounded border border-emerald-100 bg-emerald-50 p-3">
              <div class="text-xs text-emerald-500">自动改派</div>
              <div class="text-xl font-bold text-emerald-700 mt-1">{{ vehicleUnavailableResult.autoReassignedCount }}</div>
            </div>
            <div class="rounded border border-red-100 bg-red-50 p-3">
              <div class="text-xs text-red-500">人工队列</div>
              <div class="text-xl font-bold text-red-700 mt-1">{{ vehicleUnavailableResult.manualQueueCount }}</div>
            </div>
            <div class="rounded border border-amber-100 bg-amber-50 p-3">
              <div class="text-xs text-amber-500">人工保护</div>
              <div class="text-xl font-bold text-amber-700 mt-1">{{ vehicleUnavailableResult.protectedAlertCount }}</div>
            </div>
          </div>
          <el-table :data="vehicleUnavailableResult.rows" border stripe max-height="320">
            <el-table-column prop="orderNo" label="订单编号" width="150" />
            <el-table-column prop="beforeVehicle" label="原车辆" width="120" />
            <el-table-column prop="targetVehicle" label="新车辆" width="120" />
            <el-table-column label="处理动作" width="150">
              <template #default="{ row }">
                <el-tag
                  size="small"
                  effect="plain"
                  :type="row.action === 'auto_reassigned' ? 'success' : row.action === 'manual_protected_alert' ? 'warning' : 'danger'"
                >
                  {{ row.action }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="reasonText" label="处理说明" min-width="260" />
          </el-table>
        </section>
      </div>
      <template #footer>
        <el-button @click="vehicleUnavailableVisible = false">关闭</el-button>
        <el-button
          type="danger"
          :loading="actionLoading === 'vehicle-unavailable'"
          @click="submitVehicleUnavailable"
        >
          确认处理
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
