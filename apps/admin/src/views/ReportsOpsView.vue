<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import {
  BillingMode,
  DispatchStatus,
  OrderMainStatus,
  PaymentStatus,
  type StoreRentalFinanceReport,
  type StoreRentalMetricCard,
  type StoreRentalNamedMetric,
  type StoreRentalOpsHealth,
  type StoreRentalOpsLogRow,
  type StoreRentalOrdersReport,
  type StoreRentalReportDashboard,
  type StoreRentalReportExportJob,
  type StoreRentalReportQuery,
  type StoreRentalReportType,
  type StoreRentalVehiclesReport
} from "@rimo/shared";
import {
  createStoreRentalReportExport,
  downloadStoreRentalReportExport,
  getStoreRentalFinanceReport,
  getStoreRentalOpsHealth,
  getStoreRentalOrdersReport,
  getStoreRentalReportDashboard,
  getStoreRentalVehiclesReport,
  listStoreRentalOpsLogs,
  listStoreRentalReportExports
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const loading = ref(false);
const exportLoading = ref(false);
const downloadLoadingId = ref<string | null>(null);
const activeTab = ref<StoreRentalReportType>("overview");
const dateRange = ref<string[]>(defaultDateRange());

const filters = reactive({
  period: "30d" as StoreRentalReportQuery["period"],
  storeName: "",
  vehicleGroupName: "",
  billingMode: "all" as StoreRentalReportQuery["billingMode"]
});

const dashboard = ref<StoreRentalReportDashboard>(emptyDashboard());
const ordersReport = ref<StoreRentalOrdersReport>(emptyOrdersReport());
const vehiclesReport = ref<StoreRentalVehiclesReport>(emptyVehiclesReport());
const financeReport = ref<StoreRentalFinanceReport>(emptyFinanceReport());
const opsHealth = ref<StoreRentalOpsHealth>(emptyOpsHealth());
const opsLogs = ref<StoreRentalOpsLogRow[]>([]);
const exportJobs = ref<StoreRentalReportExportJob[]>([]);

const currentQuery = computed<StoreRentalReportQuery>(() => ({
  period: filters.period,
  from: dateRange.value[0],
  to: dateRange.value[1],
  storeName: filters.storeName || undefined,
  vehicleGroupName: filters.vehicleGroupName || undefined,
  billingMode: filters.billingMode
}));

const storeOptions = computed(() =>
  uniqueStrings([
    ...ordersReport.value.rows.flatMap((row) => [
      row.pickupStoreName,
      row.returnStoreName
    ]),
    ...vehiclesReport.value.rows.map((row) => row.currentStoreName)
  ])
);
const vehicleGroupOptions = computed(() =>
  uniqueStrings([
    ...ordersReport.value.rows.map((row) => row.vehicleGroupName),
    ...vehiclesReport.value.rows.map((row) => row.vehicleGroupName)
  ])
);
const canExport = computed(() => authStore.hasPermission("system:button:export"));
const activeReportLabel = computed(() => {
  const labels: Record<StoreRentalReportType, string> = {
    overview: "经营概览",
    orders: "订单报表",
    vehicles: "车辆报表",
    finance: "财务报表",
    ops: "运维日志"
  };
  return labels[activeTab.value];
});

async function loadReports() {
  loading.value = true;
  try {
    const query = currentQuery.value;
    const [dashboardData, ordersData, vehiclesData, financeData, healthData, logsData, exportsData] =
      await Promise.all([
        getStoreRentalReportDashboard(query),
        getStoreRentalOrdersReport(query),
        getStoreRentalVehiclesReport(query),
        getStoreRentalFinanceReport(query),
        getStoreRentalOpsHealth(query),
        listStoreRentalOpsLogs(query),
        listStoreRentalReportExports(query)
      ]);
    dashboard.value = dashboardData;
    ordersReport.value = ordersData;
    vehiclesReport.value = vehiclesData;
    financeReport.value = financeData;
    opsHealth.value = healthData;
    opsLogs.value = logsData;
    exportJobs.value = exportsData;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "报表数据加载失败，请确认 MySQL 已迁移并 seed"));
  } finally {
    loading.value = false;
  }
}

async function createExport() {
  if (!canExport.value) {
    ElMessage.warning("当前账号没有导出按钮权限");
    return;
  }
  exportLoading.value = true;
  try {
    const reportType = activeTab.value === "overview" ? "overview" : activeTab.value;
    const job = await createStoreRentalReportExport({
      reportType,
      filters: currentQuery.value,
      operator: authStore.user?.displayName || "营运端"
    });
    exportJobs.value.unshift(job);
    ElMessage.success(`导出任务已生成：${job.fileName}`);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "导出任务创建失败"));
  } finally {
    exportLoading.value = false;
  }
}

async function downloadExportJob(job: StoreRentalReportExportJob) {
  if (job.status !== "completed" || !job.downloadUrl) {
    ElMessage.warning("导出任务尚未生成可下载文件");
    return;
  }
  downloadLoadingId.value = job.id;
  try {
    const blob = await downloadStoreRentalReportExport(job.fileName);
    triggerBrowserDownload(blob, job.fileName);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "导出文件下载失败"));
  } finally {
    downloadLoadingId.value = null;
  }
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function applyPeriod(period: StoreRentalReportQuery["period"]) {
  filters.period = period;
  if (period === "today") {
    dateRange.value = [todayKey(), todayKey()];
  } else if (period === "7d") {
    dateRange.value = [offsetDateKey(-6), todayKey()];
  } else if (period === "30d") {
    dateRange.value = [offsetDateKey(-29), todayKey()];
  }
  void loadReports();
}

function resetFilters() {
  Object.assign(filters, {
    period: "30d",
    storeName: "",
    vehicleGroupName: "",
    billingMode: "all"
  });
  dateRange.value = defaultDateRange();
  void loadReports();
}

function metricClass(card: StoreRentalMetricCard) {
  const map: Record<StoreRentalMetricCard["severity"], string> = {
    normal: "border-blue-100 bg-blue-50 text-blue-700",
    success: "border-emerald-100 bg-emerald-50 text-emerald-700",
    warning: "border-amber-100 bg-amber-50 text-amber-700",
    danger: "border-red-100 bg-red-50 text-red-700",
    info: "border-indigo-100 bg-indigo-50 text-indigo-700"
  };
  return map[card.severity];
}

function barWidth(value: number, rows: StoreRentalNamedMetric[]) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return `${Math.max(6, Math.round((value / max) * 100))}%`;
}

function revenueBarWidth(value: number) {
  const max = Math.max(
    ...dashboard.value.weeklyRevenue.map((point) => point.revenueAmount),
    1
  );
  return `${Math.max(4, Math.round((value / max) * 100))}%`;
}

function statusLabel(status: OrderMainStatus) {
  const map: Record<OrderMainStatus, string> = {
    [OrderMainStatus.PendingPayment]: "待支付",
    [OrderMainStatus.Reserved]: "已预订",
    [OrderMainStatus.PickupOverdue]: "逾期未取",
    [OrderMainStatus.Inspecting]: "验车中",
    [OrderMainStatus.Renting]: "用车中",
    [OrderMainStatus.Renewing]: "续租中",
    [OrderMainStatus.Overdue]: "逾期未还",
    [OrderMainStatus.AccidentProcessing]: "出险处理中",
    [OrderMainStatus.SettlementPending]: "待结算",
    [OrderMainStatus.PaymentDue]: "待补缴",
    [OrderMainStatus.RefundPending]: "待退款",
    [OrderMainStatus.Completed]: "已完成",
    [OrderMainStatus.Cancelled]: "已取消",
    [OrderMainStatus.NoShow]: "爽约",
    [OrderMainStatus.Rejected]: "已拒绝",
    [OrderMainStatus.Closed]: "已关闭"
  };
  return map[status] ?? status;
}

function statusTag(status: OrderMainStatus) {
  if ([OrderMainStatus.Overdue, OrderMainStatus.AccidentProcessing, OrderMainStatus.PickupOverdue].includes(status)) {
    return "danger";
  }
  if ([OrderMainStatus.PaymentDue, OrderMainStatus.RefundPending, OrderMainStatus.SettlementPending].includes(status)) {
    return "warning";
  }
  if ([OrderMainStatus.Completed].includes(status)) {
    return "success";
  }
  return "info";
}

function dispatchLabel(status: DispatchStatus) {
  const map: Record<DispatchStatus, string> = {
    [DispatchStatus.Pending]: "待派车",
    [DispatchStatus.PreAssigned]: "已预分配",
    [DispatchStatus.Locked]: "已硬锁定",
    [DispatchStatus.ManualReassigned]: "人工改派",
    [DispatchStatus.Upgraded]: "免费升等",
    [DispatchStatus.ManualRequired]: "人工调度"
  };
  return map[status] ?? status;
}

function paymentLabel(status: PaymentStatus) {
  const map: Record<PaymentStatus, string> = {
    [PaymentStatus.Unpaid]: "未支付",
    [PaymentStatus.DepositPaid]: "已收预授权",
    [PaymentStatus.MonthlyBilling]: "企业月结",
    [PaymentStatus.PartialPaid]: "部分支付",
    [PaymentStatus.Paid]: "已结清",
    [PaymentStatus.PaymentDue]: "待补缴",
    [PaymentStatus.RefundPending]: "待退款",
    [PaymentStatus.Refunded]: "已退款"
  };
  return map[status] ?? status;
}

function vehicleStatusLabel(status: string) {
  const map: Record<string, string> = {
    idle: "可租用",
    reserved: "已预订",
    renting: "在租中",
    controlled: "封控中",
    maintenance: "维保中",
    disabled: "已停用"
  };
  return map[status] ?? status;
}

function exportStatusTag(status: StoreRentalReportExportJob["status"]) {
  const map: Record<StoreRentalReportExportJob["status"], "success" | "warning" | "danger" | "info"> = {
    queued: "info",
    processing: "warning",
    completed: "success",
    failed: "danger"
  };
  return map[status];
}

function formatMoney(value: number) {
  return `HK$${formatNumber(value)}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 1
  }).format(value);
}

function formatDateTime(value: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
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

function emptyDashboard(): StoreRentalReportDashboard {
  return {
    generatedAt: "",
    range: { from: "", to: "", period: "30d" },
    metricCards: [],
    orderFunnel: [],
    vehicleStatusDistribution: [],
    weeklyRevenue: [],
    topStores: [],
    topVehicleGroups: [],
    riskTrend: [],
    financeSummary: {
      receivableAmount: 0,
      settledAmount: 0,
      pendingAmount: 0,
      refundAmount: 0,
      waiverAmount: 0,
      monthlyBillingAmount: 0
    }
  };
}

function emptyOrdersReport(): StoreRentalOrdersReport {
  return {
    generatedAt: "",
    summary: {
      totalOrders: 0,
      pendingOrders: 0,
      inProgressOrders: 0,
      settlementOrders: 0,
      riskOrders: 0,
      monthlyOrders: 0
    },
    rows: []
  };
}

function emptyVehiclesReport(): StoreRentalVehiclesReport {
  return {
    generatedAt: "",
    summary: {
      totalVehicles: 0,
      rentableVehicles: 0,
      rentingVehicles: 0,
      maintenanceVehicles: 0,
      disabledVehicles: 0,
      utilizationPercent: 0
    },
    rows: []
  };
}

function emptyFinanceReport(): StoreRentalFinanceReport {
  return {
    generatedAt: "",
    summary: emptyDashboard().financeSummary,
    rows: [],
    monthlyBills: []
  };
}

function emptyOpsHealth(): StoreRentalOpsHealth {
  return {
    generatedAt: "",
    dataSource: "mysql",
    database: {
      connected: false,
      provider: "mysql",
      checkedAt: ""
    },
    seed: {
      tenantCount: 0,
      orderCount: 0,
      vehicleCount: 0,
      reportExportJobCount: 0
    },
    scripts: [],
    recentLogs: []
  };
}

function defaultDateRange() {
  return [offsetDateKey(-29), todayKey()];
}

function todayKey() {
  return offsetDateKey(0);
}

function offsetDateKey(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

onMounted(loadReports);
</script>

<template>
  <AppLayout>
    <div v-loading="loading" class="space-y-6">
      <div class="prototype-page-title">
        <div>
          <h1>战情分析看板</h1>
          <p>按门市租赁 PRD 口径汇总订单、车辆、财务、导出与运维日志</p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-3">
          <div class="prototype-segmented">
            <button :class="{ 'is-active': filters.period === 'today' }" @click="applyPeriod('today')">今日</button>
            <button :class="{ 'is-active': filters.period === '7d' }" @click="applyPeriod('7d')">近7日</button>
            <button :class="{ 'is-active': filters.period === '30d' }" @click="applyPeriod('30d')">近30日</button>
          </div>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 260px"
            @change="filters.period = 'custom'; loadReports()"
          />
          <el-button plain icon="Refresh" @click="loadReports">刷新</el-button>
          <el-button
            type="primary"
            plain
            icon="Download"
            :loading="exportLoading"
            :disabled="!canExport"
            @click="createExport"
          >
            导出{{ activeReportLabel }}
          </el-button>
        </div>
      </div>

      <div class="prototype-filter-panel">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
          <el-select v-model="filters.storeName" clearable placeholder="取还门店" @change="loadReports">
            <el-option v-for="item in storeOptions" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="filters.vehicleGroupName" clearable placeholder="车型组" @change="loadReports">
            <el-option v-for="item in vehicleGroupOptions" :key="item" :label="item" :value="item" />
          </el-select>
          <el-select v-model="filters.billingMode" placeholder="结算方式" @change="loadReports">
            <el-option label="全部结算" value="all" />
            <el-option label="客户自付" :value="BillingMode.CustomerPay" />
            <el-option label="企业月结" :value="BillingMode.Monthly" />
          </el-select>
          <el-button plain icon="CircleClose" @click="resetFilters">清空筛选</el-button>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div
          v-for="card in dashboard.metricCards"
          :key="card.key"
          class="rounded-xl border bg-white p-4 shadow-sm"
          :class="metricClass(card)"
        >
          <div class="flex items-center justify-between text-xs font-semibold">
            <span>{{ card.label }}</span>
            <el-icon><DataLine /></el-icon>
          </div>
          <div class="mt-3 text-2xl font-bold tracking-normal">{{ card.displayValue }}</div>
          <div class="mt-2 text-xs opacity-75">{{ card.trendText }}</div>
        </div>
      </div>

      <el-tabs v-model="activeTab" class="rimo-page-tabs w-full rounded-xl border border-gray-100 bg-white shadow-sm">
        <el-tab-pane name="overview">
          <template #label><span class="flex items-center gap-2"><el-icon><Histogram /></el-icon>经营概览</span></template>
          <div class="grid gap-6 p-6 xl:grid-cols-12">
            <section class="prototype-panel p-5 xl:col-span-7">
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <h3 class="text-base font-bold text-gray-800">每周营收分析</h3>
                  <p class="text-xs text-gray-500">按预计取车日期汇总订单金额与已处理资金</p>
                </div>
                <el-tag type="info" effect="plain">{{ dashboard.range.from }} 至 {{ dashboard.range.to }}</el-tag>
              </div>
              <div class="space-y-3">
                <div
                  v-for="point in dashboard.weeklyRevenue"
                  :key="point.label"
                  class="grid grid-cols-[90px_minmax(0,1fr)_130px] items-center gap-3"
                >
                  <div class="text-xs font-medium text-gray-500">{{ point.label }}</div>
                  <div class="h-8 rounded-lg bg-gray-100 p-1">
                    <div class="h-full rounded-md bg-[#00689E]" :style="{ width: revenueBarWidth(point.revenueAmount) }"></div>
                  </div>
                  <div class="text-right text-xs text-gray-500">
                    <div class="font-mono font-bold text-gray-800">{{ formatMoney(point.revenueAmount) }}</div>
                    <div>{{ point.orderCount }} 单</div>
                  </div>
                </div>
              </div>
            </section>

            <section class="prototype-panel p-5 xl:col-span-5">
              <div class="mb-4">
                <h3 class="text-base font-bold text-gray-800">当下车况分布</h3>
                <p class="text-xs text-gray-500">按车辆实例当前运营状态统计</p>
              </div>
              <div class="space-y-3">
                <div v-for="item in dashboard.vehicleStatusDistribution" :key="item.name">
                  <div class="mb-1 flex items-center justify-between text-sm">
                    <span class="font-medium text-gray-700">{{ item.name }}</span>
                    <span class="font-mono text-gray-500">{{ item.value }} 台 · {{ item.percent ?? 0 }}%</span>
                  </div>
                  <el-progress :percentage="item.percent ?? 0" :stroke-width="10" :show-text="false" />
                </div>
              </div>
            </section>

            <section class="prototype-panel p-5 xl:col-span-4">
              <h3 class="mb-4 text-base font-bold text-gray-800">订单状况统计</h3>
              <div class="space-y-2">
                <div
                  v-for="item in dashboard.orderFunnel"
                  :key="item.name"
                  class="rounded-lg bg-gray-50 p-3"
                >
                  <div class="mb-2 flex justify-between text-sm">
                    <span class="font-medium text-gray-700">{{ item.name }}</span>
                    <span class="font-mono font-bold text-gray-900">{{ item.value }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-gray-200">
                    <div class="h-2 rounded-full bg-blue-500" :style="{ width: barWidth(item.value, dashboard.orderFunnel) }"></div>
                  </div>
                </div>
              </div>
            </section>

            <section class="prototype-panel p-5 xl:col-span-4">
              <h3 class="mb-4 text-base font-bold text-gray-800">热门门市排行</h3>
              <div class="space-y-3">
                <div v-for="(item, index) in dashboard.topStores" :key="item.name" class="rank-row">
                  <span class="rank-index">{{ index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-gray-700">{{ item.name }}</div>
                    <div class="mt-1 h-1.5 rounded-full bg-gray-100">
                      <div class="h-1.5 rounded-full bg-emerald-500" :style="{ width: barWidth(item.value, dashboard.topStores) }"></div>
                    </div>
                  </div>
                  <span class="font-mono text-xs text-gray-500">{{ item.value }} 单</span>
                </div>
              </div>
            </section>

            <section class="prototype-panel p-5 xl:col-span-4">
              <h3 class="mb-4 text-base font-bold text-gray-800">热门车组排行</h3>
              <div class="space-y-3">
                <div v-for="(item, index) in dashboard.topVehicleGroups" :key="item.name" class="rank-row">
                  <span class="rank-index">{{ index + 1 }}</span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-gray-700">{{ item.name }}</div>
                    <div class="mt-1 h-1.5 rounded-full bg-gray-100">
                      <div class="h-1.5 rounded-full bg-indigo-500" :style="{ width: barWidth(item.value, dashboard.topVehicleGroups) }"></div>
                    </div>
                  </div>
                  <span class="font-mono text-xs text-gray-500">{{ item.value }} 单</span>
                </div>
              </div>
            </section>
          </div>
        </el-tab-pane>

        <el-tab-pane name="orders">
          <template #label><span class="flex items-center gap-2"><el-icon><List /></el-icon>订单报表</span></template>
          <div class="space-y-4 p-6">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div class="summary-tile"><span>全部订单</span><b>{{ ordersReport.summary.totalOrders }}</b></div>
              <div class="summary-tile"><span>待处理</span><b>{{ ordersReport.summary.pendingOrders }}</b></div>
              <div class="summary-tile"><span>履约中</span><b>{{ ordersReport.summary.inProgressOrders }}</b></div>
              <div class="summary-tile"><span>结算处理</span><b>{{ ordersReport.summary.settlementOrders }}</b></div>
              <div class="summary-tile"><span>异常风险</span><b>{{ ordersReport.summary.riskOrders }}</b></div>
              <div class="summary-tile"><span>企业月结</span><b>{{ ordersReport.summary.monthlyOrders }}</b></div>
            </div>
            <div class="prototype-table-panel">
              <el-table :data="ordersReport.rows" class="prototype-table" stripe>
                <el-table-column prop="orderNo" label="订单号" width="170" />
                <el-table-column label="客户" min-width="170">
                  <template #default="{ row }">
                    <div class="font-medium text-gray-800">{{ row.customerName }}</div>
                    <div class="mt-1 flex gap-1">
                      <el-tag v-if="row.corporateShortName" size="small" type="info">{{ row.corporateShortName }}</el-tag>
                      <el-tag v-for="flag in row.riskFlags" :key="flag" size="small" type="danger" effect="plain">{{ flag }}</el-tag>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="车辆" min-width="190">
                  <template #default="{ row }">
                    <div class="text-sm font-medium text-gray-800">{{ row.vehicleGroupName }}</div>
                    <div class="text-xs text-gray-500">{{ row.plateNo || "待派车" }} · {{ dispatchLabel(row.dispatchStatus) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="取还门店" min-width="190">
                  <template #default="{ row }">
                    <div class="text-sm text-gray-800">{{ row.pickupStoreName }}</div>
                    <div class="text-xs" :class="row.pickupStoreName === row.returnStoreName ? 'text-gray-500' : 'text-orange-600'">
                      {{ row.returnStoreName }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="行程时间" width="210">
                  <template #default="{ row }">
                    <div class="font-mono text-xs text-gray-700">{{ formatDateTime(row.pickupAt) }}</div>
                    <div class="font-mono text-xs text-gray-500">{{ formatDateTime(row.returnAt) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="金额" width="150" align="right">
                  <template #default="{ row }">
                    <div class="font-mono font-bold text-gray-900">{{ formatMoney(row.totalAmount) }}</div>
                    <div class="text-xs text-gray-500">{{ paymentLabel(row.paymentStatus) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="主状态" width="130">
                  <template #default="{ row }">
                    <el-tag :type="statusTag(row.mainStatus)" effect="plain">{{ statusLabel(row.mainStatus) }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="vehicles">
          <template #label><span class="flex items-center gap-2"><el-icon><Van /></el-icon>车辆报表</span></template>
          <div class="space-y-4 p-6">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div class="summary-tile"><span>车辆总数</span><b>{{ vehiclesReport.summary.totalVehicles }}</b></div>
              <div class="summary-tile"><span>可运营车辆</span><b>{{ vehiclesReport.summary.rentableVehicles }}</b></div>
              <div class="summary-tile"><span>在租车辆</span><b>{{ vehiclesReport.summary.rentingVehicles }}</b></div>
              <div class="summary-tile"><span>维保车辆</span><b>{{ vehiclesReport.summary.maintenanceVehicles }}</b></div>
              <div class="summary-tile"><span>停用车辆</span><b>{{ vehiclesReport.summary.disabledVehicles }}</b></div>
              <div class="summary-tile"><span>出租率</span><b>{{ vehiclesReport.summary.utilizationPercent }}%</b></div>
            </div>
            <div class="prototype-table-panel">
              <el-table :data="vehiclesReport.rows" class="prototype-table" stripe>
                <el-table-column prop="plateNo" label="车牌号" width="120" />
                <el-table-column prop="vehicleGroupName" label="车型组" min-width="180" />
                <el-table-column label="当前位置" min-width="190">
                  <template #default="{ row }">
                    <div class="text-sm text-gray-800">{{ row.currentStoreName }}</div>
                    <div class="text-xs text-gray-500">{{ row.currentStationName }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" effect="plain">{{ vehicleStatusLabel(row.operationStatus) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="orderCount" label="订单数" width="90" align="right" />
                <el-table-column label="营收" width="130" align="right">
                  <template #default="{ row }">{{ formatMoney(row.revenueAmount) }}</template>
                </el-table-column>
                <el-table-column label="出租率" width="150">
                  <template #default="{ row }">
                    <el-progress :percentage="row.utilizationPercent" :stroke-width="8" />
                  </template>
                </el-table-column>
                <el-table-column label="维保/事故" width="150">
                  <template #default="{ row }">
                    <div class="text-xs text-gray-600">维保 {{ formatMoney(row.maintenanceCostAmount) }}</div>
                    <div class="text-xs text-gray-500">事故 {{ row.accidentCount }} 起</div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="finance">
          <template #label><span class="flex items-center gap-2"><el-icon><Money /></el-icon>财务报表</span></template>
          <div class="space-y-4 p-6">
            <div class="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div class="summary-tile"><span>应收金额</span><b>{{ formatMoney(financeReport.summary.receivableAmount) }}</b></div>
              <div class="summary-tile"><span>已处理金额</span><b>{{ formatMoney(financeReport.summary.settledAmount) }}</b></div>
              <div class="summary-tile"><span>待处理金额</span><b>{{ formatMoney(financeReport.summary.pendingAmount) }}</b></div>
              <div class="summary-tile"><span>退款金额</span><b>{{ formatMoney(financeReport.summary.refundAmount) }}</b></div>
              <div class="summary-tile"><span>减免金额</span><b>{{ formatMoney(financeReport.summary.waiverAmount) }}</b></div>
              <div class="summary-tile"><span>月结金额</span><b>{{ formatMoney(financeReport.summary.monthlyBillingAmount) }}</b></div>
            </div>
            <div class="prototype-table-panel">
              <el-table :data="financeReport.rows" class="prototype-table" stripe>
                <el-table-column prop="orderNo" label="订单号" width="170" />
                <el-table-column prop="customerName" label="客户" min-width="140" />
                <el-table-column label="结算方式" width="110">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.billingMode === BillingMode.Monthly ? 'warning' : 'info'" effect="plain">
                      {{ row.billingMode === BillingMode.Monthly ? "企业月结" : "客户自付" }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="应收" width="120" align="right"><template #default="{ row }">{{ formatMoney(row.receivableAmount) }}</template></el-table-column>
                <el-table-column label="已处理" width="120" align="right"><template #default="{ row }">{{ formatMoney(row.settledAmount) }}</template></el-table-column>
                <el-table-column label="待处理" width="120" align="right"><template #default="{ row }">{{ formatMoney(row.pendingAmount) }}</template></el-table-column>
                <el-table-column label="退款/减免" width="140" align="right">
                  <template #default="{ row }">{{ formatMoney(row.refundAmount) }} / {{ formatMoney(row.waiverAmount) }}</template>
                </el-table-column>
                <el-table-column label="支付状态" width="120">
                  <template #default="{ row }">{{ paymentLabel(row.paymentStatus) }}</template>
                </el-table-column>
              </el-table>
            </div>
            <div class="prototype-table-panel">
              <div class="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-800">企业月结账单</div>
              <el-table :data="financeReport.monthlyBills" class="prototype-table" stripe>
                <el-table-column prop="billNo" label="账单号" width="180" />
                <el-table-column prop="corporateShortName" label="企业" min-width="160" />
                <el-table-column prop="period" label="账期" width="100" />
                <el-table-column prop="orderCount" label="订单数" width="90" align="right" />
                <el-table-column label="总金额" width="130" align="right"><template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template></el-table-column>
                <el-table-column label="已回款" width="130" align="right"><template #default="{ row }">{{ formatMoney(row.paidAmount) }}</template></el-table-column>
                <el-table-column label="未结清" width="130" align="right"><template #default="{ row }">{{ formatMoney(row.balanceAmount) }}</template></el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="ops">
          <template #label><span class="flex items-center gap-2"><el-icon><Operation /></el-icon>运维日志</span></template>
          <div class="grid gap-6 p-6 xl:grid-cols-12">
            <section class="prototype-panel p-5 xl:col-span-4">
              <h3 class="mb-4 text-base font-bold text-gray-800">本地 MySQL 健康检查</h3>
              <div class="space-y-3">
                <div class="summary-tile"><span>数据库连接</span><b>{{ opsHealth.database.connected ? "正常" : "未连接" }}</b></div>
                <div class="summary-tile"><span>租户数量</span><b>{{ opsHealth.seed.tenantCount }}</b></div>
                <div class="summary-tile"><span>订单数据</span><b>{{ opsHealth.seed.orderCount }}</b></div>
                <div class="summary-tile"><span>车辆数据</span><b>{{ opsHealth.seed.vehicleCount }}</b></div>
              </div>
            </section>
            <section class="prototype-panel p-5 xl:col-span-8">
              <h3 class="mb-4 text-base font-bold text-gray-800">本地运维脚本</h3>
              <el-table :data="opsHealth.scripts" size="small" stripe>
                <el-table-column prop="name" label="脚本" width="210" />
                <el-table-column prop="path" label="路径" width="260" />
                <el-table-column prop="purpose" label="用途" />
              </el-table>
            </section>
            <section class="prototype-panel p-5 xl:col-span-7">
              <h3 class="mb-4 text-base font-bold text-gray-800">可观测日志</h3>
              <el-table :data="opsLogs" size="small" stripe>
                <el-table-column prop="createdAt" label="时间" width="170">
                  <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="level" label="级别" width="90">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.level === 'error' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'" effect="plain">
                      {{ row.level }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="category" label="分类" width="140" />
                <el-table-column prop="message" label="内容" />
              </el-table>
            </section>
            <section class="prototype-panel p-5 xl:col-span-5">
              <h3 class="mb-4 text-base font-bold text-gray-800">导出任务</h3>
              <el-table :data="exportJobs" size="small" stripe>
                <el-table-column prop="fileName" label="文件名" min-width="220" />
                <el-table-column prop="reportType" label="类型" width="90" />
                <el-table-column prop="rowCount" label="行数" width="80" align="right" />
                <el-table-column prop="createdAt" label="创建时间" width="150">
                  <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="exportStatusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="100" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      link
                      type="primary"
                      icon="Download"
                      :loading="downloadLoadingId === row.id"
                      :disabled="row.status !== 'completed' || !row.downloadUrl"
                      @click="downloadExportJob(row)"
                    >
                      下载
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </section>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </AppLayout>
</template>

<style scoped>
.summary-tile {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
}

.summary-tile span {
  display: block;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.summary-tile b {
  display: block;
  margin-top: 6px;
  color: #111827;
  font-size: 18px;
  font-weight: 700;
}

.rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rank-index {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: #00689e;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}
</style>
