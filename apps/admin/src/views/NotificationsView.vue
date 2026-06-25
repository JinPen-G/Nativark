<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  NotificationSendLogSummary,
  NotificationTemplateSummary,
  SendMockNotificationRequest
} from "@store-rental/shared";
import {
  listNotificationLogs,
  listNotificationTemplates,
  sendMockNotification
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const sendLoading = ref(false);
const templates = ref<NotificationTemplateSummary[]>([]);
const logs = ref<NotificationSendLogSummary[]>([]);
const variablesText = ref("订单号=SR202605060001\n金额=HKD 180");

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

const selectedTemplate = computed(() =>
  templates.value.find((item) => item.code === notificationForm.templateCode)
);

const metrics = computed(() => {
  const enabledTemplates = templates.value.filter((item) => item.enabled).length;
  const successLogs = logs.value.filter((item) => item.status === "mock_success").length;
  const skippedLogs = logs.value.filter((item) => item.status === "skipped").length;
  return {
    templates: templates.value.length,
    enabledTemplates,
    successLogs,
    skippedLogs
  };
});

async function loadData() {
  loading.value = true;
  try {
    const [templateRows, logRows] = await Promise.all([
      listNotificationTemplates(),
      listNotificationLogs()
    ]);
    templates.value = templateRows;
    logs.value = logRows;
    if (!notificationForm.templateCode && templateRows[0]) {
      selectTemplate(templateRows[0].code);
    }
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "通知中心数据加载失败"));
  } finally {
    loading.value = false;
  }
}

function selectTemplate(code: string) {
  notificationForm.templateCode = code;
  const template = templates.value.find((item) => item.code === code);
  if (template?.channels?.length) {
    notificationForm.channels = [...template.channels];
  }
}

function parseVariables() {
  const entries = variablesText.value
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
    .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0]));

  return Object.fromEntries(entries);
}

async function submitNotification() {
  if (!notificationForm.channels.length) {
    ElMessage.warning("至少选择一个通知渠道");
    return;
  }

  sendLoading.value = true;
  try {
    const created = await sendMockNotification({
      ...notificationForm,
      channels: [...notificationForm.channels],
      variables: parseVariables()
    });
    logs.value = [created, ...logs.value.filter((item) => item.id !== created.id)];
    ElMessage.success("通知 mock 发送已记录");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "通知发送失败"));
  } finally {
    sendLoading.value = false;
  }
}

function statusTag(status: string) {
  const map: Record<string, "success" | "warning" | "danger" | "info"> = {
    mock_success: "success",
    mock_failed: "danger",
    skipped: "warning"
  };
  return map[status] ?? "info";
}

function enabledTag(enabled: boolean) {
  return enabled ? "success" : "info";
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
        <h1>通知中心</h1>
        <p>统一查看短信、邮件、站内消息模板，并通过 mock provider 记录发送日志。</p>
      </div>
      <div class="flex gap-3">
        <el-tag type="success" effect="plain">MySQL 可落库</el-tag>
        <el-tag type="info" effect="plain">外部供应商预留</el-tag>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-4 gap-4 mb-4">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">模板总数</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.templates }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">启用模板</div>
        <div class="mt-2 text-2xl font-bold text-[#00689E]">{{ metrics.enabledTemplates }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">mock 成功</div>
        <div class="mt-2 text-2xl font-bold text-emerald-600">{{ metrics.successLogs }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">跳过发送</div>
        <div class="mt-2 text-2xl font-bold text-amber-600">{{ metrics.skippedLogs }}</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <section class="col-span-12 xl:col-span-4 sr-card p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="font-semibold text-gray-800">模拟发送</div>
            <div class="text-xs text-gray-400 mt-1">当前只写发送日志，不调用真实短信/邮件网关。</div>
          </div>
          <el-icon class="text-[#00689E] text-xl"><Bell /></el-icon>
        </div>

        <el-form label-position="top">
          <el-form-item label="通知模板">
            <el-select
              v-model="notificationForm.templateCode"
              class="w-full"
              placeholder="选择模板"
              @change="selectTemplate"
            >
              <el-option
                v-for="item in templates"
                :key="item.code"
                :disabled="!item.enabled"
                :label="item.name"
                :value="item.code"
              />
            </el-select>
          </el-form-item>

          <div v-if="selectedTemplate" class="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
            <div class="font-medium text-gray-700">{{ selectedTemplate.trigger }}</div>
            <div class="mt-2 text-gray-500 leading-6">{{ selectedTemplate.content }}</div>
          </div>

          <el-form-item label="业务类型">
            <el-input v-model="notificationForm.businessType" />
          </el-form-item>
          <el-form-item label="业务对象 ID">
            <el-input v-model="notificationForm.businessId" />
          </el-form-item>
          <el-form-item label="接收目标">
            <div class="grid grid-cols-2 gap-3 w-full">
              <el-select v-model="notificationForm.targetType">
                <el-option label="个人会员" value="member" />
                <el-option label="企业客户" value="corporate" />
                <el-option label="营运人员" value="operator" />
              </el-select>
              <el-input v-model="notificationForm.targetName" placeholder="接收人" />
            </div>
          </el-form-item>
          <el-form-item label="脱敏号码/账号">
            <el-input v-model="notificationForm.targetMasked" />
          </el-form-item>
          <el-form-item label="渠道">
            <el-checkbox-group v-model="notificationForm.channels">
              <el-checkbox label="APP">APP</el-checkbox>
              <el-checkbox label="SMS">短信</el-checkbox>
              <el-checkbox label="EMAIL">邮件</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="变量">
            <el-input
              v-model="variablesText"
              type="textarea"
              :rows="4"
              placeholder="每行一个变量，格式：订单号=SR202605060001"
            />
          </el-form-item>
          <el-button
            type="primary"
            color="#00689E"
            class="w-full"
            :loading="sendLoading"
            @click="submitNotification"
          >
            Mock 发送
          </el-button>
        </el-form>
      </section>

      <section class="col-span-12 xl:col-span-8 space-y-4 min-w-0">
        <div class="sr-card p-4">
          <div class="font-semibold text-gray-800 mb-3">通知模板</div>
          <el-table v-loading="loading" :data="templates" border class="prototype-table">
            <el-table-column prop="name" label="模板名称" min-width="170" fixed="left" />
            <el-table-column prop="category" label="分类" width="120" />
            <el-table-column prop="trigger" label="触发时机" min-width="230" />
            <el-table-column label="渠道" width="180">
              <template #default="{ row }">
                <el-tag v-for="channel in row.channels" :key="channel" size="small" effect="plain" class="mr-1">
                  {{ channel }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="启用" width="90">
              <template #default="{ row }">
                <el-tag :type="enabledTag(row.enabled)" effect="plain">
                  {{ row.enabled ? "启用" : "停用" }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="content" label="内容模板" min-width="280" show-overflow-tooltip />
            <el-table-column label="更新时间" width="150">
              <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <div class="sr-card p-4">
          <div class="font-semibold text-gray-800 mb-3">发送日志</div>
          <el-table v-loading="loading" :data="logs" border class="prototype-table">
            <el-table-column label="创建时间" width="150" fixed="left">
              <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column prop="templateCode" label="模板编码" min-width="160" />
            <el-table-column prop="businessType" label="业务类型" min-width="160" />
            <el-table-column prop="businessId" label="业务对象" min-width="150" />
            <el-table-column prop="targetName" label="接收人" width="120" />
            <el-table-column prop="targetMasked" label="接收目标" width="140" />
            <el-table-column label="渠道" width="150">
              <template #default="{ row }">
                <el-tag v-for="channel in row.channels" :key="channel" size="small" class="mr-1">
                  {{ channel }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="130">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" effect="plain">{{ row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="provider" label="Provider" min-width="190" />
            <el-table-column label="变量快照" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ formatJsonValue(row.requestJson?.variables) }}</template>
            </el-table-column>
          </el-table>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
