<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { AsyncJobSummary, CreateAsyncJobRequest } from "@store-rental/shared";
import {
  createAsyncJob,
  listAsyncJobs,
  runAsyncJob,
  runDueAsyncJobs
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const actionLoading = ref("");
const jobs = ref<AsyncJobSummary[]>([]);
const payloadText = ref("ruleSnapshot=待支付资源保留 30 分钟\nnextAction=释放库存并发送通知");
const lastRunMessage = ref("");

const jobForm = reactive<CreateAsyncJobRequest>({
  jobType: "pending_payment_timeout",
  businessType: "store_rental_order",
  businessId: "order_10002",
  scheduledAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  payload: {
    ruleSnapshot: "待支付资源保留 30 分钟",
    nextAction: "释放库存并发送通知"
  },
  operator: "营运端"
});

const metrics = computed(() => {
  const now = Date.now();
  const queued = jobs.value.filter((item) => item.status === "queued");
  return {
    total: jobs.value.length,
    queued: queued.length,
    running: jobs.value.filter((item) => item.status === "running").length,
    success: jobs.value.filter((item) => item.status === "success").length,
    failed: jobs.value.filter((item) => item.status === "failed").length,
    due: queued.filter((item) => !item.scheduledAt || Date.parse(item.scheduledAt) <= now).length
  };
});

async function loadJobs() {
  loading.value = true;
  try {
    jobs.value = await listAsyncJobs();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "异步任务数据加载失败"));
  } finally {
    loading.value = false;
  }
}

async function submitJob() {
  actionLoading.value = "create";
  try {
    const created = await createAsyncJob({
      ...jobForm,
      payload: parseKeyValueText(payloadText.value)
    });
    jobs.value = [created, ...jobs.value.filter((item) => item.id !== created.id)];
    ElMessage.success("异步任务已入队");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "异步任务创建失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function runSingleJob(id: string) {
  actionLoading.value = `run-${id}`;
  try {
    const finished = await runAsyncJob(id);
    replaceJob(finished);
    ElMessage.success("任务已执行");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "任务执行失败"));
  } finally {
    actionLoading.value = "";
  }
}

async function runDueJobs() {
  actionLoading.value = "run-due";
  try {
    const result = await runDueAsyncJobs();
    lastRunMessage.value = result.message;
    await loadJobs();
    ElMessage.success(result.message);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "到期任务执行失败"));
  } finally {
    actionLoading.value = "";
  }
}

function replaceJob(job: AsyncJobSummary) {
  const index = jobs.value.findIndex((item) => item.id === job.id);
  if (index >= 0) {
    jobs.value[index] = job;
  } else {
    jobs.value.unshift(job);
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
  const map: Record<string, "success" | "warning" | "danger" | "info" | "primary"> = {
    queued: "warning",
    running: "primary",
    success: "success",
    failed: "danger",
    skipped: "info"
  };
  return map[status] ?? "info";
}

function isDue(row: AsyncJobSummary) {
  return row.status === "queued" && (!row.scheduledAt || Date.parse(row.scheduledAt) <= Date.now());
}

function formatTime(value?: string) {
  if (!value) {
    return "-";
  }
  return value.replace("T", " ").slice(0, 16);
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

onMounted(loadJobs);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button :loading="loading" @click="loadJobs">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
      <el-button
        type="primary"
        color="#00689E"
        :loading="actionLoading === 'run-due'"
        @click="runDueJobs"
      >
        <el-icon class="mr-1"><VideoPlay /></el-icon>
        执行到期任务
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>异步任务中心</h1>
        <p>统一管理待支付超时、通知补发、月结生成、导出打印等后台任务。</p>
      </div>
      <div class="flex gap-3">
        <el-tag type="success" effect="plain">MySQL 可落库</el-tag>
        <el-tag type="info" effect="plain">真实 runner 预留</el-tag>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-6 gap-4 mb-4">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">任务总数</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.total }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">排队中</div>
        <div class="mt-2 text-2xl font-bold text-amber-600">{{ metrics.queued }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">已到期</div>
        <div class="mt-2 text-2xl font-bold text-[#00689E]">{{ metrics.due }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">运行中</div>
        <div class="mt-2 text-2xl font-bold text-sky-600">{{ metrics.running }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">成功</div>
        <div class="mt-2 text-2xl font-bold text-emerald-600">{{ metrics.success }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">失败</div>
        <div class="mt-2 text-2xl font-bold text-red-600">{{ metrics.failed }}</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <section class="col-span-12 xl:col-span-4 sr-card p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="font-semibold text-gray-800">创建任务</div>
            <div class="text-xs text-gray-400 mt-1">MVP 阶段写入任务表并支持手动执行。</div>
          </div>
          <el-icon class="text-[#00689E] text-xl"><Clock /></el-icon>
        </div>

        <el-form label-position="top">
          <el-form-item label="任务类型">
            <el-select v-model="jobForm.jobType" class="w-full">
              <el-option label="待支付超时释放" value="pending_payment_timeout" />
              <el-option label="通知补发" value="notification_retry" />
              <el-option label="企业月结生成" value="corporate_monthly_bill_generate" />
              <el-option label="车辆证照到期提醒" value="vehicle_credential_expiry_notice" />
              <el-option label="导出任务" value="report_export" />
            </el-select>
          </el-form-item>
          <el-form-item label="业务类型">
            <el-select v-model="jobForm.businessType" class="w-full" clearable>
              <el-option label="门市订单" value="store_rental_order" />
              <el-option label="通知日志" value="notification_send_log" />
              <el-option label="企业月结" value="corporate_monthly_bill" />
              <el-option label="车辆证照" value="vehicle_credential" />
              <el-option label="报表导出" value="report_export_job" />
            </el-select>
          </el-form-item>
          <el-form-item label="业务对象 ID">
            <el-input v-model="jobForm.businessId" />
          </el-form-item>
          <el-form-item label="计划执行时间">
            <el-input v-model="jobForm.scheduledAt" placeholder="ISO 时间，例如 2026-06-09T09:00:00.000Z" />
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="jobForm.operator" />
          </el-form-item>
          <el-form-item label="任务参数">
            <el-input
              v-model="payloadText"
              type="textarea"
              :rows="4"
              placeholder="每行一个键值，格式：nextAction=释放库存"
            />
          </el-form-item>
          <el-button
            type="primary"
            color="#00689E"
            class="w-full"
            :loading="actionLoading === 'create'"
            @click="submitJob"
          >
            创建异步任务
          </el-button>
        </el-form>
      </section>

      <section class="col-span-12 xl:col-span-8 sr-card p-4 min-w-0">
        <div class="flex items-center justify-between mb-3">
          <div class="font-semibold text-gray-800">任务列表</div>
          <div v-if="lastRunMessage" class="text-xs text-gray-400">{{ lastRunMessage }}</div>
        </div>

        <el-table v-loading="loading" :data="jobs" border class="prototype-table">
          <el-table-column prop="jobType" label="任务类型" min-width="210" fixed="left" />
          <el-table-column prop="businessType" label="业务类型" min-width="160" />
          <el-table-column prop="businessId" label="业务对象" min-width="150" />
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="是否到期" width="100">
            <template #default="{ row }">
              <el-tag :type="isDue(row) ? 'warning' : 'info'" effect="plain">
                {{ isDue(row) ? "到期" : "未到期" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="attempt" label="次数" width="80" align="center" />
          <el-table-column prop="maxAttempts" label="上限" width="80" align="center" />
          <el-table-column label="计划时间" width="160">
            <template #default="{ row }">{{ formatTime(row.scheduledAt) }}</template>
          </el-table-column>
          <el-table-column label="开始时间" width="160">
            <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="完成时间" width="160">
            <template #default="{ row }">{{ formatTime(row.finishedAt) }}</template>
          </el-table-column>
          <el-table-column prop="operator" label="操作人" width="120" />
          <el-table-column label="参数" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ formatJsonValue(row.payload) }}</template>
          </el-table-column>
          <el-table-column label="结果" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ formatJsonValue(row.result) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
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
      </section>
    </div>
  </AppLayout>
</template>
