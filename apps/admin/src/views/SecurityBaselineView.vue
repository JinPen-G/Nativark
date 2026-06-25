<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { SystemSecurityBaselineConfig } from "@store-rental/shared";
import {
  checkSecondConfirmation,
  getSecurityBaseline,
  saveSecurityBaseline
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const saving = ref(false);
const checkLoading = ref(false);
const testAction = ref("finance.adjust");
const confirmationCode = ref("000000");
const checkResult = ref("");

const form = reactive<SystemSecurityBaselineConfig>({
  loginRateLimit: {
    enabled: true,
    maxFailures: 5,
    windowMinutes: 15,
    lockMinutes: 30
  },
  passwordPolicy: {
    minLength: 8,
    requireLetter: true,
    requireNumber: true,
    disallowDefaultPassword: true,
    expireDays: 90
  },
  masking: {
    phone: true,
    identityNo: true,
    driverLicenseNo: true,
    email: true,
    apiKey: true
  },
  secondConfirmation: {
    enabled: true,
    actions: ["order.settle", "finance.adjust", "tenant.disable", "role.permission.update"]
  }
});

const secondConfirmationOptions = [
  { label: "订单确认结算", value: "order.settle" },
  { label: "财务人工调账", value: "finance.adjust" },
  { label: "停用租户", value: "tenant.disable" },
  { label: "角色权限变更", value: "role.permission.update" },
  { label: "重置员工密码", value: "system.user.reset-password" },
  { label: "关闭订单", value: "order.close" }
];

const maskingFields = [
  { key: "phone", label: "手机号" },
  { key: "identityNo", label: "身份证/证件号" },
  { key: "driverLicenseNo", label: "驾驶证号" },
  { key: "email", label: "邮箱" },
  { key: "apiKey", label: "API Key" }
] as const;

const metrics = computed(() => ({
  rateLimit: form.loginRateLimit.enabled ? "已启用" : "未启用",
  passwordRules: [
    form.passwordPolicy.requireLetter,
    form.passwordPolicy.requireNumber,
    form.passwordPolicy.disallowDefaultPassword
  ].filter(Boolean).length,
  maskingCount: maskingFields.filter((item) => form.masking[item.key]).length,
  confirmationActions: form.secondConfirmation.actions.length
}));

async function loadBaseline() {
  loading.value = true;
  try {
    Object.assign(form, await getSecurityBaseline());
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "安全基线加载失败"));
  } finally {
    loading.value = false;
  }
}

async function submitBaseline() {
  saving.value = true;
  try {
    const saved = await saveSecurityBaseline({ ...form }, "平台管理员");
    Object.assign(form, saved);
    ElMessage.success("安全基线已保存");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "安全基线保存失败"));
  } finally {
    saving.value = false;
  }
}

async function runSecondConfirmationCheck() {
  checkLoading.value = true;
  try {
    const result = await checkSecondConfirmation(testAction.value, confirmationCode.value);
    checkResult.value = `${result.required ? "需要确认" : "无需确认"} / ${result.accepted ? "通过" : "未通过"}：${result.message}`;
    if (result.accepted) {
      ElMessage.success(result.message);
    } else {
      ElMessage.warning(result.message);
    }
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "二次确认校验失败"));
  } finally {
    checkLoading.value = false;
  }
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

onMounted(loadBaseline);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button :loading="loading" @click="loadBaseline">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
      <el-button type="primary" color="#00689E" :loading="saving" @click="submitBaseline">
        <el-icon class="mr-1"><Check /></el-icon>
        保存安全基线
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>安全基线</h1>
        <p>维护登录限流、密码策略、敏感字段脱敏和关键操作二次确认。</p>
      </div>
      <div class="flex gap-3">
        <el-tag type="success" effect="plain">MySQL 可落库</el-tag>
        <el-tag type="info" effect="plain">MVP 确认码 000000</el-tag>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-4 gap-4 mb-4">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">登录限流</div>
        <div class="mt-2 text-2xl font-bold text-[#00689E]">{{ metrics.rateLimit }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">密码规则</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.passwordRules }} 项</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">脱敏字段</div>
        <div class="mt-2 text-2xl font-bold text-emerald-600">{{ metrics.maskingCount }} 类</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">二次确认动作</div>
        <div class="mt-2 text-2xl font-bold text-amber-600">{{ metrics.confirmationActions }}</div>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <section class="col-span-12 xl:col-span-7 space-y-4">
        <div class="sr-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-gray-800">登录限流</div>
              <div class="text-xs text-gray-400 mt-1">用于防止同租户同账号连续失败登录。</div>
            </div>
            <el-switch v-model="form.loginRateLimit.enabled" active-text="启用" inactive-text="关闭" />
          </div>
          <div class="grid grid-cols-3 gap-4">
            <el-form-item label="失败次数">
              <el-input-number v-model="form.loginRateLimit.maxFailures" :min="1" :max="20" class="w-full" />
            </el-form-item>
            <el-form-item label="统计窗口（分钟）">
              <el-input-number v-model="form.loginRateLimit.windowMinutes" :min="1" :max="240" class="w-full" />
            </el-form-item>
            <el-form-item label="锁定时长（分钟）">
              <el-input-number v-model="form.loginRateLimit.lockMinutes" :min="1" :max="1440" class="w-full" />
            </el-form-item>
          </div>
        </div>

        <div class="sr-card p-5">
          <div class="font-semibold text-gray-800 mb-4">密码策略</div>
          <div class="grid grid-cols-2 gap-4">
            <el-form-item label="最小长度">
              <el-input-number v-model="form.passwordPolicy.minLength" :min="6" :max="32" class="w-full" />
            </el-form-item>
            <el-form-item label="有效期（天）">
              <el-input-number v-model="form.passwordPolicy.expireDays" :min="0" :max="365" class="w-full" />
            </el-form-item>
          </div>
          <div class="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <label class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between">
              <span class="text-sm text-gray-700">必须包含字母</span>
              <el-switch v-model="form.passwordPolicy.requireLetter" />
            </label>
            <label class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between">
              <span class="text-sm text-gray-700">必须包含数字</span>
              <el-switch v-model="form.passwordPolicy.requireNumber" />
            </label>
            <label class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between">
              <span class="text-sm text-gray-700">禁止默认密码</span>
              <el-switch v-model="form.passwordPolicy.disallowDefaultPassword" />
            </label>
          </div>
        </div>

        <div class="sr-card p-5">
          <div class="font-semibold text-gray-800 mb-4">敏感字段脱敏</div>
          <div class="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <label
              v-for="item in maskingFields"
              :key="item.key"
              class="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3"
            >
              <div class="text-sm text-gray-700 mb-2">{{ item.label }}</div>
              <el-switch v-model="form.masking[item.key]" />
            </label>
          </div>
        </div>
      </section>

      <section class="col-span-12 xl:col-span-5 space-y-4">
        <div class="sr-card p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-gray-800">关键操作二次确认</div>
              <div class="text-xs text-gray-400 mt-1">用于订单结算、调账、权限变更等高风险动作。</div>
            </div>
            <el-switch v-model="form.secondConfirmation.enabled" active-text="启用" inactive-text="关闭" />
          </div>
          <el-checkbox-group v-model="form.secondConfirmation.actions" class="grid grid-cols-1 gap-2">
            <el-checkbox
              v-for="item in secondConfirmationOptions"
              :key="item.value"
              :label="item.value"
              border
            >
              {{ item.label }}
              <span class="ml-2 text-xs text-gray-400">{{ item.value }}</span>
            </el-checkbox>
          </el-checkbox-group>
        </div>

        <div class="sr-card p-5">
          <div class="font-semibold text-gray-800 mb-4">二次确认校验</div>
          <el-form label-position="top">
            <el-form-item label="动作编码">
              <el-select v-model="testAction" class="w-full" filterable allow-create>
                <el-option
                  v-for="item in secondConfirmationOptions"
                  :key="item.value"
                  :label="`${item.label} · ${item.value}`"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="确认码">
              <el-input v-model="confirmationCode" placeholder="MVP 演示码 000000" />
            </el-form-item>
            <el-button
              type="primary"
              color="#00689E"
              class="w-full"
              :loading="checkLoading"
              @click="runSecondConfirmationCheck"
            >
              校验确认码
            </el-button>
          </el-form>
          <div v-if="checkResult" class="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {{ checkResult }}
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
