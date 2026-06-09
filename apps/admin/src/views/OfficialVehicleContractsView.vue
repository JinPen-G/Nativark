<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  BillingMode,
  OrderMainStatus,
  type StoreRentalContractCenter,
  type StoreRentalContractCenterRow,
  type StoreRentalContractRecord,
  type StoreRentalOrderSummary
} from "@rimo/shared";
import {
  createStoreRentalOrderContract,
  getStoreRentalContractCenter,
  listStoreRentalOrders,
  printStoreRentalContractMock,
  signStoreRentalContractMock
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const orderLoading = ref(false);
const actionLoading = ref("");
const generateDialogVisible = ref(false);
const detailDrawerVisible = ref(false);
const center = ref<StoreRentalContractCenter>({
  rows: [],
  stats: {
    total: 0,
    pending: 0,
    signed: 0,
    fallbackUploaded: 0,
    voided: 0,
    printed: 0,
    skippedExternalCalls: 0
  },
  templates: []
});
const orders = ref<StoreRentalOrderSummary[]>([]);
const selectedRecord = ref<StoreRentalContractCenterRow | null>(null);

const filters = reactive({
  keyword: "",
  type: "" as "" | StoreRentalContractRecord["type"],
  status: "" as "" | StoreRentalContractRecord["status"],
  orderStatus: "" as "" | OrderMainStatus
});

const generateForm = reactive({
  orderId: "",
  type: "rental_contract" as StoreRentalContractRecord["type"],
  status: "pending" as StoreRentalContractRecord["status"],
  signMethod: "counter" as StoreRentalContractRecord["signMethod"],
  signerName: "",
  operator: "营运端",
  fileUrl: ""
});

const selectedOrder = computed(() =>
  orders.value.find((order) => order.id === generateForm.orderId)
);

const rows = computed(() => center.value.rows);

const statsCards = computed(() => [
  {
    label: "单据总数",
    value: center.value.stats.total,
    suffix: "份",
    color: "text-[#00689E]",
    bg: "bg-sky-50"
  },
  {
    label: "待签署/确认",
    value: center.value.stats.pending,
    suffix: "待处理",
    color: "text-amber-600",
    bg: "bg-amber-50"
  },
  {
    label: "已签署",
    value: center.value.stats.signed + center.value.stats.fallbackUploaded,
    suffix: "已闭环",
    color: "text-emerald-600",
    bg: "bg-emerald-50"
  },
  {
    label: "打印/下载",
    value: center.value.stats.printed,
    suffix: "mock",
    color: "text-slate-700",
    bg: "bg-slate-100"
  }
]);

async function loadContracts() {
  loading.value = true;
  try {
    center.value = await getStoreRentalContractCenter({
      keyword: filters.keyword || undefined,
      type: filters.type || undefined,
      status: filters.status || undefined,
      orderStatus: filters.orderStatus || undefined
    });
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "合同与单据加载失败"));
  } finally {
    loading.value = false;
  }
}

async function loadOrders() {
  orderLoading.value = true;
  try {
    orders.value = await listStoreRentalOrders();
    if (!generateForm.orderId && orders.value.length > 0) {
      generateForm.orderId = orders.value[0].id;
    }
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "订单列表加载失败"));
  } finally {
    orderLoading.value = false;
  }
}

function openGenerateDialog(type: StoreRentalContractRecord["type"] = "rental_contract") {
  generateForm.type = type;
  generateForm.status = type === "rental_contract" ? "pending" : "signed";
  generateForm.signMethod = type === "settlement_sheet" ? "system" : "counter";
  generateForm.signerName = selectedOrder.value?.customerName || "";
  generateForm.fileUrl = "";
  generateDialogVisible.value = true;
}

async function submitGenerate() {
  const order = selectedOrder.value;
  if (!order) {
    ElMessage.warning("请选择订单。");
    return;
  }
  if (!generateForm.operator.trim()) {
    ElMessage.warning("请填写操作人。");
    return;
  }

  actionLoading.value = "generate";
  try {
    await createStoreRentalOrderContract(order.id, {
      type: generateForm.type,
      title: contractTypeLabel(generateForm.type),
      status: generateForm.status,
      signMethod: generateForm.signMethod,
      signerName: generateForm.signerName || order.customerName,
      signedAt:
        generateForm.status === "signed" || generateForm.status === "fallback_uploaded"
          ? new Date().toISOString()
          : undefined,
      fileUrl: generateForm.fileUrl || undefined,
      templateCode: generateForm.type,
      printStatus: "generated",
      operator: generateForm.operator,
      snapshot: {
        orderNo: order.orderNo,
        mainStatus: order.mainStatus,
        paymentStatus: order.paymentStatus,
        billingMode: order.billingMode,
        customerName: order.customerName,
        customerPhoneMasked: order.customerPhoneMasked,
        corporateShortName: order.corporateShortName,
        vehicleGroupName: order.vehicleGroupName,
        plateNo: order.plateNo,
        pickupStoreName: order.pickupStoreName,
        returnStoreName: order.returnStoreName,
        pickupAt: order.pickupAt,
        returnAt: order.returnAt,
        externalPrintProvider: "reserved",
        externalSignProvider: "reserved"
      }
    });
    ElMessage.success("单据已生成，外部打印/签署接入保持预留并自动跳过。");
    generateDialogVisible.value = false;
    await loadContracts();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "单据生成失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function handlePrint(row: StoreRentalContractCenterRow, mode: "print" | "download") {
  actionLoading.value = `${row.id}:${mode}`;
  try {
    const result = await printStoreRentalContractMock(row.id, {
      mode,
      operator: authStore.user?.displayName || "营运端"
    });
    ElMessage.success(result.message);
    await loadContracts();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, mode === "download" ? "下载单据失败" : "打印单据失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function handleMockSign(row: StoreRentalContractCenterRow) {
  actionLoading.value = `${row.id}:sign`;
  try {
    const result = await signStoreRentalContractMock(row.id, {
      operator: authStore.user?.displayName || "营运端",
      signerName: row.signerName || row.customerName,
      signMethod: row.signMethod || "counter",
      fileUrl: row.fileUrl
    });
    ElMessage.success(result.message);
    await loadContracts();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "mock 签署失败"));
  } finally {
    actionLoading.value = "";
  }
}

function openDetail(row: StoreRentalContractCenterRow) {
  selectedRecord.value = row;
  detailDrawerVisible.value = true;
}

async function goOrder(row: StoreRentalContractCenterRow) {
  await router.push(`/orders/${row.orderId}`);
}

function resetFilters() {
  filters.keyword = "";
  filters.type = "";
  filters.status = "";
  filters.orderStatus = "";
  void loadContracts();
}

function contractTypeLabel(value: StoreRentalContractRecord["type"]) {
  const labels: Record<StoreRentalContractRecord["type"], string> = {
    rental_contract: "门市租赁合约",
    pickup_sheet: "取车交接单",
    return_sheet: "还车交接单",
    settlement_sheet: "还车结算单"
  };
  return labels[value];
}

function contractStatusLabel(value: StoreRentalContractRecord["status"]) {
  const labels: Record<StoreRentalContractRecord["status"], string> = {
    pending: "待签署",
    signed: "已签署",
    fallback_uploaded: "线下件",
    voided: "已作废"
  };
  return labels[value];
}

function contractStatusType(value: StoreRentalContractRecord["status"]) {
  if (value === "signed") return "success";
  if (value === "fallback_uploaded") return "warning";
  if (value === "voided") return "info";
  return "warning";
}

function printStatusLabel(value?: StoreRentalContractRecord["printStatus"]) {
  const labels: Record<NonNullable<StoreRentalContractRecord["printStatus"]>, string> = {
    not_generated: "未生成",
    generated: "已生成",
    printed: "已打印",
    downloaded: "已下载"
  };
  return labels[value || "not_generated"];
}

function orderStatusLabel(value: OrderMainStatus) {
  const labels: Record<OrderMainStatus, string> = {
    [OrderMainStatus.PendingPayment]: "待支付",
    [OrderMainStatus.Reserved]: "已预订",
    [OrderMainStatus.PickupOverdue]: "逾期未取",
    [OrderMainStatus.Inspecting]: "验车中",
    [OrderMainStatus.Renting]: "租赁中",
    [OrderMainStatus.Renewing]: "续租中",
    [OrderMainStatus.Overdue]: "已逾期",
    [OrderMainStatus.AccidentProcessing]: "处理事故",
    [OrderMainStatus.SettlementPending]: "待结算",
    [OrderMainStatus.PaymentDue]: "待补缴",
    [OrderMainStatus.RefundPending]: "待退款",
    [OrderMainStatus.Completed]: "已完成",
    [OrderMainStatus.Cancelled]: "已取消",
    [OrderMainStatus.NoShow]: "爽约",
    [OrderMainStatus.Rejected]: "拒绝履约",
    [OrderMainStatus.Closed]: "已关闭"
  };
  return labels[value] || value;
}

function billingModeLabel(value: BillingMode) {
  return value === BillingMode.Monthly ? "企业月结" : "客户自付";
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function snapshotText(record: StoreRentalContractCenterRow | null) {
  if (!record) return "{}";
  return JSON.stringify(record.snapshot ?? {}, null, 2);
}

function readErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { message?: string } } })?.response?.data;
  return data?.message || (error instanceof Error ? error.message : fallback);
}

onMounted(async () => {
  await Promise.all([loadContracts(), loadOrders()]);
});
</script>

<template>
  <AppLayout>
    <div class="space-y-5">
      <section class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">合同与单据</h1>
          <p class="mt-1 text-sm text-slate-500">订单合同、交接单、结算单与打印签署记录</p>
        </div>
        <div class="flex gap-2">
          <el-button icon="Refresh" :loading="loading" @click="loadContracts">刷新</el-button>
          <el-button type="primary" color="#00689E" icon="Plus" @click="openGenerateDialog()">
            生成单据
          </el-button>
        </div>
      </section>

      <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div
          v-for="item in statsCards"
          :key="item.label"
          class="rounded-lg border border-slate-200 bg-white p-4"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-slate-500">{{ item.label }}</span>
            <span :class="['h-8 w-8 rounded-full', item.bg]"></span>
          </div>
          <div class="mt-2 flex items-baseline gap-2">
            <span :class="['text-3xl font-bold', item.color]">{{ item.value }}</span>
            <span class="text-xs text-slate-400">{{ item.suffix }}</span>
          </div>
        </div>
      </section>

      <section class="rounded-lg border border-slate-200 bg-white">
        <div class="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 p-4">
          <el-input
            v-model="filters.keyword"
            placeholder="搜索单据号 / 订单号 / 客户 / 车牌"
            prefix-icon="Search"
            clearable
            class="!w-72"
            @keyup.enter="loadContracts"
          />
          <el-select v-model="filters.type" placeholder="单据类型" clearable class="!w-40">
            <el-option label="门市租赁合约" value="rental_contract" />
            <el-option label="取车交接单" value="pickup_sheet" />
            <el-option label="还车交接单" value="return_sheet" />
            <el-option label="还车结算单" value="settlement_sheet" />
          </el-select>
          <el-select v-model="filters.status" placeholder="签署状态" clearable class="!w-36">
            <el-option label="待签署" value="pending" />
            <el-option label="已签署" value="signed" />
            <el-option label="线下件" value="fallback_uploaded" />
            <el-option label="已作废" value="voided" />
          </el-select>
          <el-select v-model="filters.orderStatus" placeholder="订单状态" clearable class="!w-36">
            <el-option
              v-for="status in Object.values(OrderMainStatus)"
              :key="status"
              :label="orderStatusLabel(status)"
              :value="status"
            />
          </el-select>
          <div class="ml-auto flex gap-2">
            <el-button @click="resetFilters">重置</el-button>
            <el-button type="primary" color="#00689E" :loading="loading" @click="loadContracts">
              查询
            </el-button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 border-b border-slate-100 p-4 lg:grid-cols-4">
          <button
            v-for="template in center.templates"
            :key="template.code"
            type="button"
            class="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-[#00689E] hover:bg-sky-50/50"
            @click="openGenerateDialog(template.code)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold text-slate-900">{{ template.name }}</span>
              <el-tag size="small" effect="plain">预留接入</el-tag>
            </div>
            <p class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{{ template.description }}</p>
          </button>
        </div>

        <el-table :data="rows" v-loading="loading" class="w-full" empty-text="暂无合同或单据记录">
          <el-table-column label="单据编号与标题" min-width="240">
            <template #default="{ row }">
              <button class="text-left" type="button" @click="openDetail(row)">
                <div class="font-mono text-sm font-semibold text-slate-900">{{ row.documentNo }}</div>
                <div class="mt-1 text-xs text-slate-500">{{ row.title }}</div>
              </button>
            </template>
          </el-table-column>
          <el-table-column label="订单与客户" min-width="220">
            <template #default="{ row }">
              <div class="text-sm font-semibold text-slate-800">{{ row.orderNo }}</div>
              <div class="mt-1 text-xs text-slate-500">
                {{ row.customerName }} · {{ row.corporateShortName || billingModeLabel(row.billingMode) }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="车辆与门市" min-width="230">
            <template #default="{ row }">
              <div class="text-sm text-slate-800">{{ row.vehicleGroupName }}</div>
              <div class="mt-1 text-xs text-slate-500">
                {{ row.plateNo || "待派车" }} · {{ row.pickupStoreName }} -> {{ row.returnStoreName }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="类型" width="130">
            <template #default="{ row }">
              <el-tag effect="plain">{{ contractTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="170">
            <template #default="{ row }">
              <div class="flex flex-col gap-1">
                <el-tag :type="contractStatusType(row.status)" effect="plain">
                  {{ contractStatusLabel(row.status) }}
                </el-tag>
                <span class="text-xs text-slate-400">{{ printStatusLabel(row.printStatus) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="签署/打印" min-width="210">
            <template #default="{ row }">
              <div class="text-xs text-slate-600">
                <div>{{ row.signerName || row.customerName }} · {{ row.signMethod || "counter" }}</div>
                <div class="mt-1 text-slate-400">
                  {{ row.signedAt ? formatDateTime(row.signedAt) : "未签署" }}
                  <span v-if="row.externalSignStatus === 'skipped'"> · 外部签署已跳过</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="270" fixed="right">
            <template #default="{ row }">
              <div class="flex flex-wrap gap-1">
                <el-button link type="primary" size="small" @click="openDetail(row)">查看</el-button>
                <el-button link type="primary" size="small" @click="goOrder(row)">订单</el-button>
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="actionLoading === `${row.id}:print`"
                  @click="handlePrint(row, 'print')"
                >
                  打印
                </el-button>
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="actionLoading === `${row.id}:download`"
                  @click="handlePrint(row, 'download')"
                >
                  下载
                </el-button>
                <el-button
                  v-if="row.status === 'pending'"
                  link
                  type="success"
                  size="small"
                  :loading="actionLoading === `${row.id}:sign`"
                  @click="handleMockSign(row)"
                >
                  mock签署
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <el-dialog v-model="generateDialogVisible" title="生成合同 / 单据" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="关联订单">
          <el-select
            v-model="generateForm.orderId"
            filterable
            class="w-full"
            :loading="orderLoading"
            placeholder="选择订单"
          >
            <el-option
              v-for="order in orders"
              :key="order.id"
              :label="`${order.orderNo} · ${order.customerName} · ${orderStatusLabel(order.mainStatus)}`"
              :value="order.id"
            />
          </el-select>
        </el-form-item>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <el-form-item label="单据类型">
            <el-select v-model="generateForm.type" class="w-full">
              <el-option label="门市租赁合约" value="rental_contract" />
              <el-option label="取车交接单" value="pickup_sheet" />
              <el-option label="还车交接单" value="return_sheet" />
              <el-option label="还车结算单" value="settlement_sheet" />
            </el-select>
          </el-form-item>
          <el-form-item label="签署状态">
            <el-select v-model="generateForm.status" class="w-full">
              <el-option label="待签署" value="pending" />
              <el-option label="已签署" value="signed" />
              <el-option label="线下件" value="fallback_uploaded" />
            </el-select>
          </el-form-item>
          <el-form-item label="签署方式">
            <el-select v-model="generateForm.signMethod" class="w-full">
              <el-option label="客户 App" value="app" />
              <el-option label="柜台签署" value="counter" />
              <el-option label="线下纸质" value="offline_paper" />
              <el-option label="系统生成" value="system" />
            </el-select>
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="generateForm.operator" />
          </el-form-item>
        </div>
        <el-form-item label="签署人">
          <el-input v-model="generateForm.signerName" :placeholder="selectedOrder?.customerName || '客户姓名'" />
        </el-form-item>
        <el-form-item label="线下件 / 文件 URL">
          <el-input v-model="generateForm.fileUrl" placeholder="可选，真实附件中心未接入前保留 URL" />
        </el-form-item>
        <div class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          打印、PDF、电子签平台为 mock 预留接入，提交后自动跳过外部调用并写入单据记录。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="generateDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          color="#00689E"
          :loading="actionLoading === 'generate'"
          @click="submitGenerate"
        >
          确认生成
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailDrawerVisible" title="单据详情" size="520px">
      <div v-if="selectedRecord" class="space-y-4">
        <div class="rounded-lg border border-slate-200 p-4">
          <div class="font-mono text-sm font-semibold text-slate-900">{{ selectedRecord.documentNo }}</div>
          <div class="mt-1 text-lg font-bold text-slate-900">{{ selectedRecord.title }}</div>
          <div class="mt-3 flex flex-wrap gap-2">
            <el-tag :type="contractStatusType(selectedRecord.status)" effect="plain">
              {{ contractStatusLabel(selectedRecord.status) }}
            </el-tag>
            <el-tag effect="plain">{{ contractTypeLabel(selectedRecord.type) }}</el-tag>
            <el-tag type="info" effect="plain">{{ printStatusLabel(selectedRecord.printStatus) }}</el-tag>
          </div>
        </div>
        <div class="rounded-lg border border-slate-200 p-4 text-sm">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="text-xs text-slate-400">订单号</div>
              <div class="font-semibold text-slate-800">{{ selectedRecord.orderNo }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">订单状态</div>
              <div class="font-semibold text-slate-800">{{ orderStatusLabel(selectedRecord.mainStatus) }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">客户</div>
              <div class="font-semibold text-slate-800">{{ selectedRecord.customerName }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">车辆</div>
              <div class="font-semibold text-slate-800">{{ selectedRecord.plateNo || "待派车" }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">签署人</div>
              <div class="font-semibold text-slate-800">{{ selectedRecord.signerName || "-" }}</div>
            </div>
            <div>
              <div class="text-xs text-slate-400">签署时间</div>
              <div class="font-semibold text-slate-800">{{ formatDateTime(selectedRecord.signedAt) }}</div>
            </div>
          </div>
        </div>
        <div class="rounded-lg border border-slate-200 p-4">
          <div class="mb-2 text-sm font-semibold text-slate-800">订单快照</div>
          <pre class="max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs leading-5 text-slate-100">{{ snapshotText(selectedRecord) }}</pre>
        </div>
      </div>
    </el-drawer>
  </AppLayout>
</template>
