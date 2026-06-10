<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  AsyncJobSummary,
  CreateAsyncJobRequest,
  CreateDataExchangeJobRequest,
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  InfraAdapterCapability,
  InfraDashboardResult,
  InvokeMockAdapterRequest,
  SendMockNotificationRequest,
  TBoxDeviceSummary
} from "@rimo/shared";
import {
  bindTBoxDevice,
  createAsyncJob,
  createDataExchangeJob,
  createFileAsset,
  createPrintJob,
  getInfraDashboard,
  invokeMockAdapter,
  runAsyncJob,
  runDueAsyncJobs,
  sendMockNotification
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const activeTab = ref("capabilities");
const actionLoading = ref("");
const dashboard = reactive<InfraDashboardResult>(emptyDashboard());

const adapterForm = reactive<InvokeMockAdapterRequest>({
  provider: "mock-payment-adapter",
  capability: "pre_auth",
  operation: "freeze",
  businessType: "store_rental_order",
  businessId: "order_10001",
  payload: {
    amount: 666,
    channel: "credit_card"
  },
  operator: "营运端"
});

const fileForm = reactive<CreateFileAssetRequest>({
  businessModule: "store-rental",
  businessType: "vehicle_condition_photo",
  businessId: "vehicle_001",
  fileName: "RX7821-取车外观-01.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 368240,
  uploadScene: "condition_photo",
  uploadedBy: "营运端"
});

const notificationForm = reactive<SendMockNotificationRequest>({
  templateCode: "post_charge_notice",
  businessType: "store_rental_order",
  businessId: "order_10001",
  targetType: "member",
  targetName: "陈小明",
  targetMasked: "852****0001",
  channels: ["APP", "SMS"],
  variables: {
    订单号: "SR202605060001",
    金额: "HKD 180"
  },
  operator: "营运端"
});

const jobForm = reactive<CreateAsyncJobRequest>({
  jobType: "pending_payment_timeout",
  businessType: "store_rental_order",
  businessId: "order_10002",
  payload: {
    ruleSnapshot: "待支付资源保留 30 分钟"
  },
  operator: "营运端"
});

const printForm = reactive<CreatePrintJobRequest>({
  documentType: "rental_contract",
  templateCode: "store-rental-contract-v1",
  businessType: "store_rental_order",
  businessId: "order_10001",
  payload: {
    orderNo: "SR202605060001"
  },
  operator: "营运端"
});

const dataExchangeForm = reactive<CreateDataExchangeJobRequest>({
  operation: "export",
  targetModule: "store-rental",
  targetObject: "orders",
  templateCode: "orders-export-v1",
  filters: {
    mainStatus: "reserved"
  },
  operator: "营运端"
});

const capabilityMetrics = computed(() => ({
  enabled: dashboard.capabilities.filter((item) => item.status === "enabled").length,
  mock: dashboard.capabilities.filter((item) => item.mode === "mock").length,
  logs: dashboard.adapterLogs.length + dashboard.notificationLogs.length,
  jobs: dashboard.jobs.filter((item) => item.status === "queued").length
}));

const dataExchangeJobs = computed(() =>
  dashboard.jobs.filter(
    (item) => item.jobType.startsWith("data_") || typeof item.payload.dataExchangeOperation === "string"
  )
);

async function loadDashboard() {
  loading.value = true;
  try {
    Object.assign(dashboard, await getInfraDashboard());
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "外部接入数据加载失败"));
  } finally {
    loading.value = false;
  }
}

async function runAction(key: string, action: () => Promise<unknown>, success: string) {
  actionLoading.value = key;
  try {
    await action();
    ElMessage.success(success);
    await loadDashboard();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "操作失败"));
  } finally {
    actionLoading.value = "";
  }
}

function triggerAdapter(capability?: InfraAdapterCapability) {
  if (capability) {
    adapterForm.capability = capability;
    adapterForm.provider = providerByCapability(capability);
    adapterForm.operation = operationByCapability(capability);
  }
  return runAction(
    "adapter",
    () => invokeMockAdapter({ ...adapterForm, payload: { ...(adapterForm.payload ?? {}) } }),
    "adapter mock 调用已记录"
  );
}

function createFile() {
  return runAction("file", () => createFileAsset({ ...fileForm }), "附件元数据已创建");
}

function sendNotification() {
  return runAction(
    "notification",
    () =>
      sendMockNotification({
        ...notificationForm,
        channels: [...notificationForm.channels],
        variables: { ...(notificationForm.variables ?? {}) }
      }),
    "通知 mock 发送已记录"
  );
}

function createJob() {
  return runAction(
    "job",
    () => createAsyncJob({ ...jobForm, payload: { ...(jobForm.payload ?? {}) } }),
    "异步任务已入队"
  );
}

function runDueJobs() {
  return runAction("run-due", runDueAsyncJobs, "到期任务已执行");
}

function runSingleJob(id: string) {
  return runAction(`run-${id}`, () => runAsyncJob(id), "任务已执行");
}

function createDocument() {
  return runAction(
    "print",
    () => createPrintJob({ ...printForm, payload: { ...(printForm.payload ?? {}) } }),
    "打印单据 mock 记录已生成"
  );
}

function createDataExchange() {
  return runAction(
    "data-exchange",
    () =>
      createDataExchangeJob({
        ...dataExchangeForm,
        filters: { ...(dataExchangeForm.filters ?? {}) }
      }),
    "导入导出任务已入队"
  );
}

function selectDataExchangeTemplate(templateCode: string) {
  const template = dashboard.dataExchangeTemplates.find((item) => item.templateCode === templateCode);
  if (!template) {
    return;
  }
  dataExchangeForm.operation = template.operation;
  dataExchangeForm.targetModule = template.targetModule;
  dataExchangeForm.targetObject = template.targetObject;
}

function toggleTBoxBind(row: TBoxDeviceSummary) {
  const isBound = row.status === "bound";
  return runAction(
    `tbox-${row.id}`,
    () =>
      bindTBoxDevice(row.id, {
        plateNo: isBound ? undefined : "BCP 7315",
        vehicleId: isBound ? undefined : "vehicle_002",
        vehicleModel: isBound ? undefined : "Honda Freed",
        operator: "营运端"
      }),
    isBound ? "车机已 mock 解绑" : "车机已 mock 绑定"
  );
}

function providerByCapability(capability: InfraAdapterCapability | string) {
  const map: Record<string, string> = {
    payment: "mock-payment-adapter",
    pre_auth: "mock-payment-adapter",
    sms: "mock-notification-adapter",
    email: "mock-notification-adapter",
    app_push: "mock-notification-adapter",
    e_contract: "mock-contract-adapter",
    tbox: "mock-tbox-adapter",
    ai_dispatch: "mock-ai-dispatch-adapter",
    export: "mock-export-adapter",
    print: "mock-print-adapter",
    file: "mock-file-storage-adapter"
  };
  return map[capability] ?? "mock-adapter";
}

function operationByCapability(capability: InfraAdapterCapability | string) {
  const map: Record<string, string> = {
    payment: "create_payment",
    pre_auth: "freeze",
    sms: "send_sms",
    email: "send_email",
    app_push: "send_app_push",
    e_contract: "send_signature_notice",
    tbox: "bind_vehicle",
    ai_dispatch: "analyze_dispatch",
    export: "export_current_filter",
    print: "generate_document",
    file: "upload_metadata"
  };
  return map[capability] ?? "mock_call";
}

function capabilityLabel(capability: string) {
  const map: Record<string, string> = {
    payment: "支付",
    pre_auth: "预授权",
    sms: "短信",
    email: "邮件",
    app_push: "APP",
    e_contract: "电子合同",
    tbox: "TBox",
    ai_dispatch: "AI 调度",
    export: "导入导出",
    print: "打印",
    file: "附件"
  };
  return map[capability] ?? capability;
}

function dataExchangeOperationLabel(operation: string) {
  const map: Record<string, string> = {
    export: "导出",
    import_validate: "导入校验",
    template_download: "模板下载"
  };
  return map[operation] ?? operation;
}

function jobPayloadText(row: AsyncJobSummary, key: string) {
  const value = row.payload?.[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "-";
}

function statusTag(status: string) {
  if (["enabled", "mock_success", "success", "mock_generated", "bound"].includes(status)) {
    return "success";
  }
  if (["queued", "reserved", "unbound"].includes(status)) {
    return "warning";
  }
  if (["failed", "mock_failed", "fault"].includes(status)) {
    return "danger";
  }
  return "info";
}

function formatTime(value?: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "-";
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
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

function emptyDashboard(): InfraDashboardResult {
  return {
    generatedAt: "",
    capabilities: [],
    files: [],
    notificationTemplates: [],
    notificationLogs: [],
    adapterLogs: [],
    jobs: [],
    dataExchangeTemplates: [],
    printJobs: [],
    tboxDevices: []
  };
}

onMounted(loadDashboard);
</script>

<template>
  <AppLayout>
    <div v-loading="loading" class="space-y-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-gray-800 tracking-tight">外部接入与任务日志</h1>
          <p class="text-gray-500 text-sm mt-1">文件、通知、打印、TBox、AI、支付预授权与异步任务的统一预留层</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400">刷新时间：{{ formatTime(dashboard.generatedAt) }}</span>
          <el-button plain icon="Refresh" @click="loadDashboard">刷新</el-button>
        </div>
      </div>

      <div class="grid grid-cols-4 gap-4">
        <div class="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <div class="text-xs text-gray-500">启用能力</div>
          <div class="mt-2 text-2xl font-bold text-gray-800">{{ capabilityMetrics.enabled }}</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <div class="text-xs text-gray-500">Mock 能力</div>
          <div class="mt-2 text-2xl font-bold text-blue-600">{{ capabilityMetrics.mock }}</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <div class="text-xs text-gray-500">调用/通知日志</div>
          <div class="mt-2 text-2xl font-bold text-emerald-600">{{ capabilityMetrics.logs }}</div>
        </div>
        <div class="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <div class="text-xs text-gray-500">待执行任务</div>
          <div class="mt-2 text-2xl font-bold text-orange-500">{{ capabilityMetrics.jobs }}</div>
        </div>
      </div>

      <el-tabs
        v-model="activeTab"
        class="rimo-page-tabs w-full bg-white rounded-xl shadow-sm border border-gray-100 min-h-[640px]"
      >
        <el-tab-pane name="capabilities">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Connection /></el-icon>
              <span>能力总览</span>
            </span>
          </template>
          <div class="p-6 space-y-5">
            <el-table :data="dashboard.capabilities" border stripe>
              <el-table-column label="能力" width="150">
                <template #default="{ row }">
                  <div class="font-semibold text-gray-800">{{ row.name }}</div>
                  <div class="text-xs text-gray-400">{{ capabilityLabel(row.capability) }}</div>
                </template>
              </el-table-column>
              <el-table-column prop="provider" label="Adapter" width="220" />
              <el-table-column label="模式/状态" width="150">
                <template #default="{ row }">
                  <div class="flex gap-1">
                    <el-tag size="small" type="info" effect="plain">{{ row.mode }}</el-tag>
                    <el-tag size="small" :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="description" label="当前边界" min-width="240" />
              <el-table-column prop="nextIntegrationPoint" label="真实接入改造点" min-width="300" />
              <el-table-column label="最近调用" width="150">
                <template #default="{ row }">{{ formatTime(row.lastCalledAt) }}</template>
              </el-table-column>
              <el-table-column prop="totalLogs" label="日志数" width="90" align="center" />
              <el-table-column label="操作" width="110" fixed="right">
                <template #default="{ row }">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :loading="actionLoading === 'adapter'"
                    @click="triggerAdapter(row.capability)"
                  >
                    Mock 调用
                  </el-button>
                </template>
              </el-table-column>
            </el-table>

            <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
              <div class="mb-3 text-sm font-semibold text-gray-800">手动 adapter 调用</div>
              <div class="grid grid-cols-5 gap-3">
                <el-input v-model="adapterForm.provider" placeholder="provider" />
                <el-select v-model="adapterForm.capability" placeholder="能力">
                  <el-option
                    v-for="item in dashboard.capabilities"
                    :key="item.capability"
                    :label="item.name"
                    :value="item.capability"
                  />
                </el-select>
                <el-input v-model="adapterForm.operation" placeholder="operation" />
                <el-input v-model="adapterForm.businessId" placeholder="业务对象 ID" />
                <el-button type="primary" :loading="actionLoading === 'adapter'" @click="triggerAdapter()">
                  写入日志
                </el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="notifications">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Bell /></el-icon>
              <span>通知中心</span>
            </span>
          </template>
          <div class="grid gap-6 p-6" style="grid-template-columns: 360px minmax(0, 1fr);">
            <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
              <div class="mb-3 text-sm font-semibold text-gray-800">通知发送</div>
              <el-form label-position="top">
                <el-form-item label="模板">
                  <el-select v-model="notificationForm.templateCode" class="w-full">
                    <el-option
                      v-for="item in dashboard.notificationTemplates"
                      :key="item.code"
                      :label="item.name"
                      :value="item.code"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="业务对象">
                  <el-input v-model="notificationForm.businessId" />
                </el-form-item>
                <el-form-item label="接收人">
                  <el-input v-model="notificationForm.targetName" />
                </el-form-item>
                <el-form-item label="渠道">
                  <el-checkbox-group v-model="notificationForm.channels">
                    <el-checkbox label="APP">APP</el-checkbox>
                    <el-checkbox label="SMS">短信</el-checkbox>
                    <el-checkbox label="EMAIL">邮件</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <el-button
                  type="primary"
                  class="w-full"
                  :loading="actionLoading === 'notification'"
                  @click="sendNotification"
                >
                  Mock 发送
                </el-button>
              </el-form>
            </div>
            <div class="space-y-4 min-w-0">
              <el-table :data="dashboard.notificationTemplates" border stripe>
                <el-table-column prop="name" label="模板名称" width="160" />
                <el-table-column prop="trigger" label="触发时机" min-width="220" />
                <el-table-column label="渠道" width="180">
                  <template #default="{ row }">
                    <div class="flex gap-1">
                      <el-tag v-for="channel in row.channels" :key="channel" size="small" effect="plain">{{ channel }}</el-tag>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="content" label="内容模板" min-width="260" />
              </el-table>
              <el-table :data="dashboard.notificationLogs" border stripe>
                <el-table-column label="时间" width="150">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column prop="templateCode" label="模板" width="160" />
                <el-table-column prop="targetMasked" label="接收目标" width="140" />
                <el-table-column label="渠道" width="150">
                  <template #default="{ row }">
                    <el-tag v-for="channel in row.channels" :key="channel" size="small" class="mr-1">{{ channel }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="provider" label="Provider" min-width="200" />
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="files">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><FolderOpened /></el-icon>
              <span>附件与打印</span>
            </span>
          </template>
          <div class="grid gap-6 p-6" style="grid-template-columns: 360px minmax(0, 1fr);">
            <div class="space-y-4">
              <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div class="mb-3 text-sm font-semibold text-gray-800">附件元数据</div>
                <el-form label-position="top">
                  <el-form-item label="文件名">
                    <el-input v-model="fileForm.fileName" />
                  </el-form-item>
                  <el-form-item label="业务对象">
                    <el-input v-model="fileForm.businessId" />
                  </el-form-item>
                  <el-form-item label="上传场景">
                    <el-input v-model="fileForm.uploadScene" />
                  </el-form-item>
                  <el-button type="primary" class="w-full" :loading="actionLoading === 'file'" @click="createFile">
                    创建附件
                  </el-button>
                </el-form>
              </div>
              <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div class="mb-3 text-sm font-semibold text-gray-800">打印单据</div>
                <el-form label-position="top">
                  <el-form-item label="单据类型">
                    <el-select v-model="printForm.documentType" class="w-full">
                      <el-option label="租赁合约" value="rental_contract" />
                      <el-option label="交车单" value="pickup_sheet" />
                      <el-option label="还车单" value="return_sheet" />
                      <el-option label="发票" value="invoice" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="模板编码">
                    <el-input v-model="printForm.templateCode" />
                  </el-form-item>
                  <el-button type="primary" class="w-full" :loading="actionLoading === 'print'" @click="createDocument">
                    生成记录
                  </el-button>
                </el-form>
              </div>
              <div class="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <div class="mb-3 text-sm font-semibold text-gray-800">导入导出任务</div>
                <el-form label-position="top">
                  <el-form-item label="模板">
                    <el-select
                      v-model="dataExchangeForm.templateCode"
                      class="w-full"
                      @change="selectDataExchangeTemplate"
                    >
                      <el-option
                        v-for="item in dashboard.dataExchangeTemplates"
                        :key="item.templateCode"
                        :label="item.name"
                        :value="item.templateCode"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="操作">
                    <el-select v-model="dataExchangeForm.operation" class="w-full">
                      <el-option label="导出" value="export" />
                      <el-option label="模板下载" value="template_download" />
                      <el-option label="导入校验" value="import_validate" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="导入文件名">
                    <el-input v-model="dataExchangeForm.sourceFileName" placeholder="导入校验时填写" />
                  </el-form-item>
                  <el-button
                    type="primary"
                    class="w-full"
                    :loading="actionLoading === 'data-exchange'"
                    @click="createDataExchange"
                  >
                    创建任务
                  </el-button>
                </el-form>
              </div>
            </div>
            <div class="space-y-4 min-w-0">
              <el-table :data="dashboard.dataExchangeTemplates" border stripe>
                <el-table-column prop="name" label="导入导出模板" min-width="180" />
                <el-table-column label="操作" width="110">
                  <template #default="{ row }">
                    {{ dataExchangeOperationLabel(row.operation) }}
                  </template>
                </el-table-column>
                <el-table-column prop="targetObject" label="对象" width="120" />
                <el-table-column prop="mockFileName" label="Mock 文件" min-width="180" />
                <el-table-column prop="nextIntegrationPoint" label="真实接入点" min-width="260" />
              </el-table>
              <el-table :data="dashboard.files" border stripe>
                <el-table-column prop="fileName" label="文件名" min-width="220" />
                <el-table-column prop="businessType" label="对象类型" width="180" />
                <el-table-column prop="uploadScene" label="场景" width="150" />
                <el-table-column label="大小" width="110">
                  <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
                </el-table-column>
                <el-table-column prop="storageProvider" label="存储" width="150" />
                <el-table-column label="创建时间" width="150">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
              </el-table>
              <el-table :data="dashboard.printJobs" border stripe>
                <el-table-column prop="documentNo" label="单据号" width="180" />
                <el-table-column prop="documentType" label="类型" width="150" />
                <el-table-column prop="templateCode" label="模板" min-width="220" />
                <el-table-column label="状态" width="130">
                  <template #default="{ row }">
                    <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="创建时间" width="150">
                  <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
                </el-table-column>
              </el-table>
              <el-table :data="dataExchangeJobs" border stripe>
                <el-table-column prop="jobType" label="数据任务" width="170" />
                <el-table-column label="模板" min-width="180">
                  <template #default="{ row }">{{ jobPayloadText(row, "templateName") }}</template>
                </el-table-column>
                <el-table-column label="对象" width="120">
                  <template #default="{ row }">{{ jobPayloadText(row, "targetObject") }}</template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="{ row }">
                    <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="结果" min-width="220">
                  <template #default="{ row }">
                    <pre class="max-h-16 overflow-auto whitespace-pre-wrap text-xs text-gray-600">{{ row.result }}</pre>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="100" fixed="right">
                  <template #default="{ row }">
                    <el-button
                      link
                      type="primary"
                      size="small"
                      :disabled="row.status !== 'queued'"
                      :loading="actionLoading === `run-${row.id}`"
                      @click="runSingleJob(row.id)"
                    >
                      执行
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="jobs">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Clock /></el-icon>
              <span>异步任务</span>
            </span>
          </template>
          <div class="p-6 space-y-5">
            <div class="grid grid-cols-6 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-4">
              <el-input v-model="jobForm.jobType" placeholder="任务类型" />
              <el-input v-model="jobForm.businessId" placeholder="业务对象 ID" />
              <el-select v-model="jobForm.businessType" placeholder="对象类型">
                <el-option label="门市订单" value="store_rental_order" />
                <el-option label="企业月结" value="corporate_monthly_bill" />
                <el-option label="导出任务" value="export_job" />
              </el-select>
              <el-input v-model="jobForm.operator" placeholder="操作人" />
              <el-button type="primary" :loading="actionLoading === 'job'" @click="createJob">入队</el-button>
              <el-button plain :loading="actionLoading === 'run-due'" @click="runDueJobs">执行到期</el-button>
            </div>
            <el-table :data="dashboard.jobs" border stripe>
              <el-table-column prop="jobType" label="任务类型" min-width="200" />
              <el-table-column prop="businessId" label="业务对象" width="150" />
              <el-table-column label="状态" width="120">
                <template #default="{ row }">
                  <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="attempt" label="次数" width="90" align="center" />
              <el-table-column label="计划时间" width="150">
                <template #default="{ row }">{{ formatTime(row.scheduledAt) }}</template>
              </el-table-column>
              <el-table-column label="完成时间" width="150">
                <template #default="{ row }">{{ formatTime(row.finishedAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :disabled="row.status !== 'queued'"
                    :loading="actionLoading === `run-${row.id}`"
                    @click="runSingleJob(row.id)"
                  >
                    执行
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="tbox">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Cpu /></el-icon>
              <span>TBox</span>
            </span>
          </template>
          <div class="p-6">
            <el-table :data="dashboard.tboxDevices" border stripe>
              <el-table-column label="硬件身份" min-width="220">
                <template #default="{ row }">
                  <div class="font-mono font-semibold text-gray-800">{{ row.cid }}</div>
                  <div class="text-xs text-gray-500">SIM: {{ row.simNo || "-" }}</div>
                </template>
              </el-table-column>
              <el-table-column prop="model" label="型号" width="150" />
              <el-table-column label="系统版本" width="160">
                <template #default="{ row }">
                  <div class="text-xs text-gray-600">V1: {{ row.firmwareVersion || "-" }}</div>
                  <div class="text-xs text-gray-600">V2: {{ row.appVersion || "-" }}</div>
                </template>
              </el-table-column>
              <el-table-column label="电子钥匙" width="150">
                <template #default="{ row }">
                  <el-tag :type="row.supportsIButton ? 'success' : 'info'" effect="plain">
                    {{ row.supportsIButton ? row.iButtonCode || "支持" : "不支持" }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="近期通讯" width="170">
                <template #default="{ row }">{{ formatTime(row.lastHeartbeatAt) }}</template>
              </el-table-column>
              <el-table-column label="绑定车辆" width="160">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'bound' ? 'primary' : 'warning'" effect="plain">
                    {{ row.boundPlateNo || "在库闲置" }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button
                    link
                    type="primary"
                    size="small"
                    :loading="actionLoading === `tbox-${row.id}`"
                    @click="toggleTBoxBind(row)"
                  >
                    {{ row.status === "bound" ? "解绑" : "绑定" }}
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>

        <el-tab-pane name="logs">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Tickets /></el-icon>
              <span>Adapter日志</span>
            </span>
          </template>
          <div class="p-6">
            <el-table :data="dashboard.adapterLogs" border stripe>
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column prop="provider" label="Provider" width="220" />
              <el-table-column label="能力" width="130">
                <template #default="{ row }">{{ capabilityLabel(row.capability) }}</template>
              </el-table-column>
              <el-table-column prop="operation" label="操作" width="180" />
              <el-table-column prop="businessId" label="业务对象" width="150" />
              <el-table-column label="状态" width="130">
                <template #default="{ row }">
                  <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="结果" min-width="260">
                <template #default="{ row }">
                  <pre class="max-h-20 overflow-auto whitespace-pre-wrap text-xs text-gray-600">{{ row.responseJson }}</pre>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </AppLayout>
</template>
