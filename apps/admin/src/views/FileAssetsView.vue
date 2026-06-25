<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  CreateFileAssetRequest,
  CreatePrintJobRequest,
  FileAssetSummary,
  PrintJobSummary
} from "@store-rental/shared";
import {
  createFileAsset,
  createPrintJob,
  listFileAssets,
  listPrintJobs
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const fileLoading = ref(false);
const printLoading = ref(false);
const files = ref<FileAssetSummary[]>([]);
const printJobs = ref<PrintJobSummary[]>([]);
const fileMetadataText = ref("来源=营运端补录\n用途=车辆证照附件");
const printPayloadText = ref("orderNo=SR202605060001\ncustomerName=陈小明");

const fileForm = reactive<CreateFileAssetRequest>({
  businessModule: "store-rental",
  businessType: "vehicle_credential",
  businessId: "vehicle_001",
  fileName: "RX7821-保险单.pdf",
  mimeType: "application/pdf",
  sizeBytes: 386240,
  uploadScene: "vehicle_credential",
  uploadedBy: "营运端"
});

const printForm = reactive<CreatePrintJobRequest>({
  documentType: "rental_contract",
  templateCode: "store-rental-contract-v1",
  businessType: "store_rental_order",
  businessId: "order_10001",
  payload: {
    orderNo: "SR202605060001",
    customerName: "陈小明"
  },
  operator: "营运端"
});

const metrics = computed(() => {
  const activeFiles = files.value.filter((item) => item.status === "active").length;
  const generatedPrintJobs = printJobs.value.filter(
    (item) => item.status === "mock_generated"
  ).length;
  const totalBytes = files.value.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
  return {
    files: files.value.length,
    activeFiles,
    printJobs: printJobs.value.length,
    generatedPrintJobs,
    totalBytes
  };
});

async function loadData() {
  loading.value = true;
  try {
    const [fileRows, printRows] = await Promise.all([
      listFileAssets(),
      listPrintJobs()
    ]);
    files.value = fileRows;
    printJobs.value = printRows;
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "附件与打印数据加载失败"));
  } finally {
    loading.value = false;
  }
}

async function submitFileAsset() {
  fileLoading.value = true;
  try {
    const created = await createFileAsset({
      ...fileForm,
      metadata: parseKeyValueText(fileMetadataText.value)
    });
    files.value = [created, ...files.value.filter((item) => item.id !== created.id)];
    ElMessage.success("附件元数据已创建");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "附件创建失败"));
  } finally {
    fileLoading.value = false;
  }
}

async function submitPrintJob() {
  printLoading.value = true;
  try {
    const created = await createPrintJob({
      ...printForm,
      payload: parseKeyValueText(printPayloadText.value)
    });
    printJobs.value = [created, ...printJobs.value.filter((item) => item.id !== created.id)];
    await refreshFilesSilently();
    ElMessage.success("打印任务已生成 mock 记录");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "打印任务创建失败"));
  } finally {
    printLoading.value = false;
  }
}

async function refreshFilesSilently() {
  try {
    files.value = await listFileAssets();
  } catch {
    // 打印任务已经创建成功；附件列表刷新失败时不打断当前操作。
  }
}

function parseKeyValueText(text: string) {
  const pairs = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const delimiterIndex = line.includes("=") ? line.indexOf("=") : line.indexOf(":");
      if (delimiterIndex < 0) {
        return undefined;
      }
      return [
        line.slice(0, delimiterIndex).trim(),
        line.slice(delimiterIndex + 1).trim()
      ] as const;
    })
    .filter((pair): pair is readonly [string, string] => Boolean(pair?.[0]));

  return Object.fromEntries(pairs);
}

function statusTag(status: string) {
  const map: Record<string, "success" | "warning" | "danger" | "info"> = {
    active: "success",
    deleted: "info",
    mock_generated: "success",
    queued: "warning",
    failed: "danger"
  };
  return map[status] ?? "info";
}

function formatTime(value?: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
}

function formatBytes(value?: number) {
  if (!value) {
    return "-";
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatJsonValue(value: unknown) {
  if (!value || typeof value !== "object") {
    return "-";
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) {
    return "-";
  }
  return entries.map(([key, item]) => `${key}: ${String(item)}`).join(" / ");
}

function readErrorMessage(error: unknown, fallback: string) {
  const response = error as {
    response?: {
      data?: {
        message?: string;
      };
    };
  };
  return response.response?.data?.message ?? fallback;
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button :loading="loading" @click="loadData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>附件与打印中心</h1>
        <p>统一维护业务附件元数据、打印任务和 mock 单据生成记录。</p>
      </div>
      <div class="flex gap-3">
        <el-tag type="success" effect="plain">MySQL 可落库</el-tag>
        <el-tag type="info" effect="plain">真实存储/打印预留</el-tag>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">附件总数</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.files }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">有效附件</div>
        <div class="mt-2 text-2xl font-bold text-[#00689E]">{{ metrics.activeFiles }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">附件容量</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ formatBytes(metrics.totalBytes) }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">打印任务</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.printJobs }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">已生成</div>
        <div class="mt-2 text-2xl font-bold text-emerald-600">{{ metrics.generatedPrintJobs }}</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <section class="col-span-12 xl:col-span-4 space-y-4">
        <div class="sr-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-gray-800">附件元数据</div>
              <div class="text-xs text-gray-400 mt-1">MVP 阶段只记录元数据和 mock 下载地址。</div>
            </div>
            <el-icon class="text-[#00689E] text-xl"><FolderOpened /></el-icon>
          </div>

          <el-form label-position="top">
            <el-form-item label="业务模块">
              <el-input v-model="fileForm.businessModule" />
            </el-form-item>
            <el-form-item label="业务类型">
              <el-select v-model="fileForm.businessType" class="w-full">
                <el-option label="车辆证照" value="vehicle_credential" />
                <el-option label="车辆车况照片" value="vehicle_condition_photo" />
                <el-option label="会员证件" value="member_identity" />
                <el-option label="企业合同" value="corporate_contract" />
                <el-option label="门市订单" value="store_rental_order" />
              </el-select>
            </el-form-item>
            <el-form-item label="业务对象 ID">
              <el-input v-model="fileForm.businessId" />
            </el-form-item>
            <el-form-item label="文件名">
              <el-input v-model="fileForm.fileName" />
            </el-form-item>
            <div class="grid grid-cols-2 gap-3">
              <el-form-item label="MIME">
                <el-input v-model="fileForm.mimeType" />
              </el-form-item>
              <el-form-item label="大小 Bytes">
                <el-input-number v-model="fileForm.sizeBytes" :min="0" :controls="false" class="w-full" />
              </el-form-item>
            </div>
            <el-form-item label="上传场景">
              <el-input v-model="fileForm.uploadScene" />
            </el-form-item>
            <el-form-item label="上传人">
              <el-input v-model="fileForm.uploadedBy" />
            </el-form-item>
            <el-form-item label="元数据">
              <el-input
                v-model="fileMetadataText"
                type="textarea"
                :rows="3"
                placeholder="每行一个键值，格式：用途=车辆证照附件"
              />
            </el-form-item>
            <el-button
              type="primary"
              color="#00689E"
              class="w-full"
              :loading="fileLoading"
              @click="submitFileAsset"
            >
              创建附件记录
            </el-button>
          </el-form>
        </div>

        <div class="sr-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-gray-800">打印任务</div>
              <div class="text-xs text-gray-400 mt-1">当前生成 mock 单据和关联附件记录。</div>
            </div>
            <el-icon class="text-[#00689E] text-xl"><Document /></el-icon>
          </div>

          <el-form label-position="top">
            <el-form-item label="单据类型">
              <el-select v-model="printForm.documentType" class="w-full">
                <el-option label="租赁合同" value="rental_contract" />
                <el-option label="取车单" value="pickup_sheet" />
                <el-option label="还车单" value="return_sheet" />
                <el-option label="发票" value="invoice" />
              </el-select>
            </el-form-item>
            <el-form-item label="模板编码">
              <el-input v-model="printForm.templateCode" />
            </el-form-item>
            <el-form-item label="业务类型">
              <el-input v-model="printForm.businessType" />
            </el-form-item>
            <el-form-item label="业务对象 ID">
              <el-input v-model="printForm.businessId" />
            </el-form-item>
            <el-form-item label="操作人">
              <el-input v-model="printForm.operator" />
            </el-form-item>
            <el-form-item label="打印变量">
              <el-input
                v-model="printPayloadText"
                type="textarea"
                :rows="3"
                placeholder="每行一个键值，格式：orderNo=SR202605060001"
              />
            </el-form-item>
            <el-button
              type="primary"
              color="#00689E"
              class="w-full"
              :loading="printLoading"
              @click="submitPrintJob"
            >
              生成打印记录
            </el-button>
          </el-form>
        </div>
      </section>

      <section class="col-span-12 xl:col-span-8 space-y-4 min-w-0">
        <div class="sr-card p-4">
          <div class="font-semibold text-gray-800 mb-3">附件列表</div>
          <el-table v-loading="loading" :data="files" border class="prototype-table">
            <el-table-column prop="fileName" label="文件名" min-width="220" fixed="left" />
            <el-table-column prop="businessType" label="对象类型" min-width="160" />
            <el-table-column prop="businessId" label="对象 ID" min-width="150" />
            <el-table-column prop="uploadScene" label="场景" min-width="150" />
            <el-table-column label="大小" width="110">
              <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
            </el-table-column>
            <el-table-column prop="storageProvider" label="存储" width="140" />
            <el-table-column prop="storageKey" label="存储 Key" min-width="220" show-overflow-tooltip />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="uploadedBy" label="上传人" width="120" />
            <el-table-column label="创建时间" width="150">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <div class="sr-card p-4">
          <div class="font-semibold text-gray-800 mb-3">打印任务</div>
          <el-table v-loading="loading" :data="printJobs" border class="prototype-table">
            <el-table-column prop="documentNo" label="单据号" min-width="180" fixed="left" />
            <el-table-column prop="documentType" label="类型" width="140" />
            <el-table-column prop="templateCode" label="模板" min-width="220" />
            <el-table-column prop="businessType" label="业务类型" min-width="160" />
            <el-table-column prop="businessId" label="业务对象" min-width="150" />
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="fileAssetId" label="附件 ID" min-width="170" />
            <el-table-column prop="operator" label="操作人" width="120" />
            <el-table-column label="变量快照" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ formatJsonValue(row.payload) }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="150">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
