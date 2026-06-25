<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  SystemAiCallLog,
  SystemPushRule,
  SystemRuleSpecialDate,
  SystemRulesConfig
} from "@store-rental/shared";
import {
  getSystemRules,
  saveSystemRuleSection,
  testSystemAiConnection
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const activeTab = ref("MEMBER");
const loading = ref(false);
const savingKey = ref("");
const specialDateDialogVisible = ref(false);
const pushDialogVisible = ref(false);
const aiLogDialogVisible = ref(false);
const editingPushIndex = ref(-1);
const selectedAiLog = ref<SystemAiCallLog | null>(null);

const ruleLocks = reactive<Record<string, boolean>>({
  memberRegister: true,
  memberPoints: true,
  fleetMaintenance: true,
  fleetCleaning: true,
  calendarFixed: true,
  aiModel: true
});

const systemConfig = reactive<SystemRulesConfig>(emptySystemConfig());
const newSpecialDate = reactive<{
  type: SystemRuleSpecialDate["type"];
  range: string[];
  name: string;
}>({
  type: "HOLIDAY",
  range: [],
  name: ""
});
const pushForm = reactive<SystemPushRule>({
  id: "",
  category: "系统",
  title: "",
  content: "",
  trigger: "",
  channels: ["APP"],
  enabled: true
});

const isSpecialDateValid = computed(
  () => newSpecialDate.range.length === 2 && Boolean(newSpecialDate.name.trim())
);

function emptySystemConfig(): SystemRulesConfig {
  return {
    member: {
      accountType: "MOBILE",
      auditRequired: true,
      welcomeGift: { enabled: false, trigger: "AUDIT_PASS", amount: 0, validity: 365 },
      referralGift: {
        enabled: false,
        trigger: "INVITEE_AUDIT_PASS",
        amount: 0,
        validity: 365
      }
    },
    fleet: {
      maintenance: {
        thresholdMileage: 0,
        thresholdMonths: 1,
        advanceKm: 0,
        advanceDays: 1
      },
      cleaning: {
        thresholdCount: 1,
        thresholdDays: 1,
        advanceCount: 0,
        advanceDays: 1
      }
    },
    calendar: {
      weekly: [],
      specialDates: []
    },
    push: {
      list: []
    },
    aiModel: {
      enabled: false,
      provider: "OPENAI_COMPATIBLE",
      baseUrl: "",
      modelName: "",
      apiKeyMasked: "",
      promptSourceText: "",
      promptConfigVersion: "",
      promptVersion: "",
      promptHash: "",
      lastTestStatus: "未测试",
      lastTestTime: "",
      guardrails: [],
      logs: []
    },
    security: {
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
    },
    updatedAt: "",
    updatedBy: ""
  };
}

function cloneConfig(config: SystemRulesConfig = systemConfig) {
  return JSON.parse(JSON.stringify(config)) as SystemRulesConfig;
}

async function loadSystemRules() {
  loading.value = true;
  try {
    Object.assign(systemConfig, await getSystemRules());
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "系统参数加载失败"));
  } finally {
    loading.value = false;
  }
}

function unlockRule(key: string) {
  ruleLocks[key] = false;
}

async function cancelRule(key: string) {
  ruleLocks[key] = true;
  await loadSystemRules();
  ElMessage.info("已取消编辑");
}

async function saveRule(key: string) {
  savingKey.value = key;
  try {
    const result = await saveSystemRuleSection({
      sectionKey: key,
      config: cloneConfig(),
      operator: "营运端"
    });
    Object.assign(systemConfig, result);
    if (key in ruleLocks) {
      ruleLocks[key] = true;
    }
    ElMessage.success("系统参数已保存");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "系统参数保存失败"));
  } finally {
    savingKey.value = "";
  }
}

function openSpecialDateDialog() {
  Object.assign(newSpecialDate, {
    type: "HOLIDAY",
    range: [],
    name: ""
  });
  specialDateDialogVisible.value = true;
}

async function addSpecialDate() {
  if (!isSpecialDateValid.value) {
    return;
  }
  systemConfig.calendar.specialDates.push({
    range: [newSpecialDate.range[0], newSpecialDate.range[1]],
    type: newSpecialDate.type,
    name: newSpecialDate.name.trim()
  });
  specialDateDialogVisible.value = false;
  await saveRule("calendarSpecial");
}

async function removeSpecialDate(index: number) {
  systemConfig.calendar.specialDates.splice(index, 1);
  await saveRule("calendarSpecial");
}

function openPushDialog(row: SystemPushRule, index: number) {
  editingPushIndex.value = index;
  Object.assign(pushForm, clonePushRule(row));
  pushDialogVisible.value = true;
}

async function savePushRule() {
  if (editingPushIndex.value >= 0) {
    systemConfig.push.list[editingPushIndex.value] = clonePushRule(pushForm);
  }
  pushDialogVisible.value = false;
  await saveRule("push");
}

function clonePushRule(rule: SystemPushRule): SystemPushRule {
  return JSON.parse(JSON.stringify(rule)) as SystemPushRule;
}

async function testAIConnection() {
  savingKey.value = "ai-test";
  try {
    const result = await testSystemAiConnection("营运端");
    ElMessage.success(result.message);
    await loadSystemRules();
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "AI 连接测试失败"));
  } finally {
    savingKey.value = "";
  }
}

function openAiLogDetail(row: SystemAiCallLog) {
  selectedAiLog.value = row;
  aiLogDialogVisible.value = true;
}

function getPushCategoryTag(category: string) {
  if (category === "订单") {
    return "primary";
  }
  if (category === "营销") {
    return "warning";
  }
  return "info";
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

function showReservedAction(action: string) {
  ElMessage.info(`${action}已预留，MVP 阶段不接外部系统。`);
}

onMounted(loadSystemRules);
</script>

<template>
  <AppLayout>
    <div v-loading="loading" class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-800 tracking-tight">系统通用参数</h1>
          <p class="text-gray-500 text-sm mt-1">配置全局系统规则，包括会员策略、运维规则、日历设定和推送通知</p>
        </div>
        <div class="text-xs text-gray-400">
          最近保存：{{ systemConfig.updatedAt || "-" }} · {{ systemConfig.updatedBy || "-" }}
        </div>
      </div>

      <el-tabs
        v-model="activeTab"
        class="sr-page-tabs w-full bg-white rounded-xl shadow-sm border border-gray-100 min-h-[600px]"
      >
        <el-tab-pane name="MEMBER">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><User /></el-icon>
              <span>会员策略</span>
            </span>
          </template>
          <div class="grid gap-6 p-6 system-rules-grid">
            <div class="system-rule-nav rounded-xl border border-gray-100 bg-gray-50 p-3 h-fit">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">设置项</div>
              <a href="#member-register">注册与审核</a>
              <a href="#member-points">积分奖励</a>
            </div>
            <div class="space-y-6 min-w-0">
              <section id="member-register" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-blue-600"><User /></el-icon>
                    注册设置
                  </h3>
                  <el-button
                    v-if="ruleLocks.memberRegister"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('memberRegister')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('memberRegister')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'memberRegister'"
                      @click="saveRule('memberRegister')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-gray-50 rounded-lg p-5 border border-gray-200">
                  <el-form
                    label-width="140px"
                    label-position="left"
                    :disabled="ruleLocks.memberRegister"
                  >
                    <el-form-item label="预设账号类型">
                      <el-radio-group v-model="systemConfig.member.accountType">
                        <el-radio label="MOBILE">手机号</el-radio>
                        <el-radio label="ID_CARD">身份证号</el-radio>
                      </el-radio-group>
                      <div class="text-xs text-gray-400 mt-1">新会员注册时默认使用的唯一标识</div>
                    </el-form-item>
                    <el-form-item label="注册后审核">
                      <el-switch
                        v-model="systemConfig.member.auditRequired"
                        active-text="开启"
                        inactive-text="关闭"
                      />
                      <div class="text-xs text-gray-400 mt-1">开启后，新会员注册后需管理员审核通过方可使用</div>
                    </el-form-item>
                  </el-form>
                </div>
              </section>

              <section id="member-points" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-orange-600"><Star /></el-icon>
                    积分奖励策略
                  </h3>
                  <el-button
                    v-if="ruleLocks.memberPoints"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('memberPoints')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('memberPoints')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'memberPoints'"
                      @click="saveRule('memberPoints')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-orange-50 rounded-lg p-5 border border-orange-200 space-y-6">
                  <div class="flex items-start gap-4">
                    <el-switch
                      v-model="systemConfig.member.welcomeGift.enabled"
                      :disabled="ruleLocks.memberPoints"
                      active-color="#f97316"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-gray-800 mb-2">新人礼 (Welcome Gift)</div>
                      <div v-if="systemConfig.member.welcomeGift.enabled" class="flex flex-wrap gap-4 items-center">
                        <span class="text-sm text-gray-600">当会员</span>
                        <el-select
                          v-model="systemConfig.member.welcomeGift.trigger"
                          :disabled="ruleLocks.memberPoints"
                          size="small"
                          style="width: 140px"
                        >
                          <el-option label="注册成功后" value="REGISTER" />
                          <el-option label="审核通过后" value="AUDIT_PASS" />
                        </el-select>
                        <span class="text-sm text-gray-600">赠送</span>
                        <el-input-number
                          v-model="systemConfig.member.welcomeGift.amount"
                          :disabled="ruleLocks.memberPoints"
                          :min="0"
                          size="small"
                          style="width: 100px"
                        />
                        <span class="text-sm text-gray-600">积分，有效期</span>
                        <el-input-number
                          v-model="systemConfig.member.welcomeGift.validity"
                          :disabled="ruleLocks.memberPoints"
                          :min="1"
                          size="small"
                          style="width: 80px"
                        />
                        <span class="text-sm text-gray-600">天</span>
                      </div>
                      <div v-else class="text-xs text-gray-400">开启后可配置新用户获赠积分规则</div>
                    </div>
                  </div>

                  <el-divider class="!my-2" />

                  <div class="flex items-start gap-4">
                    <el-switch
                      v-model="systemConfig.member.referralGift.enabled"
                      :disabled="ruleLocks.memberPoints"
                      active-color="#f97316"
                    />
                    <div class="flex-1">
                      <div class="font-medium text-gray-800 mb-2">邀请礼 (Referral Gift)</div>
                      <div v-if="systemConfig.member.referralGift.enabled" class="flex flex-wrap gap-4 items-center">
                        <span class="text-sm text-gray-600">当被邀请人</span>
                        <el-select
                          v-model="systemConfig.member.referralGift.trigger"
                          :disabled="ruleLocks.memberPoints"
                          size="small"
                          style="width: 140px"
                        >
                          <el-option label="注册成功后" value="INVITEE_REGISTER" />
                          <el-option label="审核通过后" value="INVITEE_AUDIT_PASS" />
                        </el-select>
                        <span class="text-sm text-gray-600">邀请人获得</span>
                        <el-input-number
                          v-model="systemConfig.member.referralGift.amount"
                          :disabled="ruleLocks.memberPoints"
                          :min="0"
                          size="small"
                          style="width: 100px"
                        />
                        <span class="text-sm text-gray-600">积分，有效期</span>
                        <el-input-number
                          v-model="systemConfig.member.referralGift.validity"
                          :disabled="ruleLocks.memberPoints"
                          :min="1"
                          size="small"
                          style="width: 80px"
                        />
                        <span class="text-sm text-gray-600">天</span>
                      </div>
                      <div v-else class="text-xs text-gray-400">开启后可配置邀请返利规则</div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="FLEET">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Van /></el-icon>
              <span>运维规则</span>
            </span>
          </template>
          <div class="grid gap-6 p-6 system-rules-grid">
            <div class="system-rule-nav rounded-xl border border-gray-100 bg-gray-50 p-3 h-fit">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">设置项</div>
              <a href="#fleet-maintenance">保养提醒</a>
              <a href="#fleet-cleaning">清洁提醒</a>
            </div>
            <div class="space-y-6 min-w-0">
              <section id="fleet-maintenance" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-blue-600"><Tools /></el-icon>
                    保养提醒规则
                  </h3>
                  <el-button
                    v-if="ruleLocks.fleetMaintenance"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('fleetMaintenance')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('fleetMaintenance')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'fleetMaintenance'"
                      @click="saveRule('fleetMaintenance')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-blue-50 rounded-lg p-5 border border-blue-200">
                  <el-form label-position="top" :disabled="ruleLocks.fleetMaintenance">
                    <div class="font-medium text-blue-800 mb-3 border-b border-blue-200 pb-2">触发条件 (满足任一)</div>
                    <div class="grid grid-cols-2 gap-4 max-w-xl">
                      <el-form-item label="行驶里程 (Km)">
                        <el-input-number
                          v-model="systemConfig.fleet.maintenance.thresholdMileage"
                          :min="0"
                          :step="1000"
                          class="w-full"
                        />
                      </el-form-item>
                      <el-form-item label="时间间隔 (月)">
                        <el-input-number
                          v-model="systemConfig.fleet.maintenance.thresholdMonths"
                          :min="1"
                          class="w-full"
                        />
                      </el-form-item>
                    </div>
                    <div class="font-medium text-blue-800 mb-3 border-b border-blue-200 pb-2 mt-4">提前预警</div>
                    <div class="grid grid-cols-2 gap-4 max-w-xl">
                      <el-form-item label="提前里程 (Km)">
                        <el-input-number
                          v-model="systemConfig.fleet.maintenance.advanceKm"
                          :min="0"
                          :step="100"
                          class="w-full"
                        />
                      </el-form-item>
                      <el-form-item label="提前天数">
                        <el-input-number
                          v-model="systemConfig.fleet.maintenance.advanceDays"
                          :min="1"
                          class="w-full"
                        />
                      </el-form-item>
                    </div>
                  </el-form>
                </div>
              </section>

              <section id="fleet-cleaning" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-cyan-600"><Brush /></el-icon>
                    清洁提醒规则
                  </h3>
                  <el-button
                    v-if="ruleLocks.fleetCleaning"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('fleetCleaning')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('fleetCleaning')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'fleetCleaning'"
                      @click="saveRule('fleetCleaning')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-cyan-50 rounded-lg p-5 border border-cyan-200">
                  <el-form label-position="top" :disabled="ruleLocks.fleetCleaning">
                    <div class="font-medium text-cyan-800 mb-3 border-b border-cyan-200 pb-2">触发条件 (满足任一)</div>
                    <div class="grid grid-cols-2 gap-4 max-w-xl">
                      <el-form-item label="租用次数">
                        <el-input-number
                          v-model="systemConfig.fleet.cleaning.thresholdCount"
                          :min="1"
                          class="w-full"
                        />
                      </el-form-item>
                      <el-form-item label="时间间隔 (天)">
                        <el-input-number
                          v-model="systemConfig.fleet.cleaning.thresholdDays"
                          :min="1"
                          class="w-full"
                        />
                      </el-form-item>
                    </div>
                    <div class="font-medium text-cyan-800 mb-3 border-b border-cyan-200 pb-2 mt-4">提前预警</div>
                    <div class="grid grid-cols-2 gap-4 max-w-xl">
                      <el-form-item label="提前剩余次数">
                        <el-input-number
                          v-model="systemConfig.fleet.cleaning.advanceCount"
                          :min="0"
                          class="w-full"
                        />
                      </el-form-item>
                      <el-form-item label="提前天数">
                        <el-input-number
                          v-model="systemConfig.fleet.cleaning.advanceDays"
                          :min="1"
                          class="w-full"
                        />
                      </el-form-item>
                    </div>
                  </el-form>
                </div>
              </section>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="CALENDAR">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Calendar /></el-icon>
              <span>日历与假日</span>
            </span>
          </template>
          <div class="grid gap-6 p-6 system-rules-grid">
            <div class="system-rule-nav rounded-xl border border-gray-100 bg-gray-50 p-3 h-fit">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">设置项</div>
              <a href="#calendar-weekly">固定假日</a>
              <a href="#calendar-special">特殊日期</a>
            </div>
            <div class="space-y-6 min-w-0">
              <section id="calendar-weekly" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-indigo-600"><Calendar /></el-icon>
                    固定假日设定
                  </h3>
                  <el-button
                    v-if="ruleLocks.calendarFixed"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('calendarFixed')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('calendarFixed')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'calendarFixed'"
                      @click="saveRule('calendarFixed')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <table class="w-full text-sm text-left">
                    <thead class="bg-gray-50 text-gray-600 border-b">
                      <tr>
                        <th class="px-4 py-3 w-24">星期</th>
                        <th class="px-4 py-3 w-32">是否假日</th>
                        <th class="px-4 py-3">具体规则 (默认全天，可指定时段)</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                      <tr v-for="day in systemConfig.calendar.weekly" :key="day.id" class="hover:bg-gray-50">
                        <td class="px-4 py-3 font-medium">{{ day.name }}</td>
                        <td class="px-4 py-3">
                          <el-checkbox v-model="day.isHoliday" :disabled="ruleLocks.calendarFixed">是假日</el-checkbox>
                        </td>
                        <td class="px-4 py-3">
                          <div v-if="day.isHoliday" class="flex items-center gap-2">
                            <el-switch
                              v-model="day.isFullDay"
                              :disabled="ruleLocks.calendarFixed"
                              active-text="全天"
                              inactive-text="非整天"
                              size="small"
                            />
                            <div v-if="!day.isFullDay" class="flex items-center gap-2 ml-4">
                              <span class="text-gray-500">从</span>
                              <el-time-select
                                v-model="day.startTime"
                                :disabled="ruleLocks.calendarFixed"
                                start="00:00"
                                step="00:30"
                                end="23:30"
                                placeholder="开始时间"
                                size="small"
                                style="width: 120px"
                              />
                              <span class="text-gray-500">以后算作假日</span>
                            </div>
                          </div>
                          <span v-else class="text-gray-400 text-xs">平日 (工作日)</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section id="calendar-special" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-purple-600"><Timer /></el-icon>
                    特殊日期 (调休/节假日)
                  </h3>
                  <el-button type="primary" size="small" plain icon="Plus" @click="openSpecialDateDialog">
                    新增特殊规则
                  </el-button>
                </div>
                <div class="bg-purple-50 rounded-lg p-5 border border-purple-200">
                  <div class="space-y-2">
                    <div
                      v-for="(item, index) in systemConfig.calendar.specialDates"
                      :key="`${item.name}_${index}`"
                      class="flex items-center justify-between bg-white p-3 rounded border border-purple-100 shadow-sm"
                    >
                      <div class="flex items-center gap-3">
                        <el-tag :type="item.type === 'HOLIDAY' ? 'danger' : 'success'" size="small">
                          {{ item.type === "HOLIDAY" ? "假日" : "平日" }}
                        </el-tag>
                        <span class="font-mono text-gray-700 font-medium">{{ item.range[0] }} ~ {{ item.range[1] }}</span>
                        <span class="text-gray-500 text-sm ml-2">({{ item.name }})</span>
                      </div>
                      <el-button link type="danger" icon="Delete" @click="removeSpecialDate(index)" />
                    </div>
                    <div v-if="systemConfig.calendar.specialDates.length === 0" class="text-center text-gray-400 py-4 text-sm">
                      暂无特殊日期规则
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="PUSH">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Bell /></el-icon>
              <span>推送通知</span>
            </span>
          </template>
          <div class="p-6 space-y-4">
            <div class="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-100">
              <div>
                <div class="text-sm font-semibold text-gray-800">推送规则列表</div>
                <div class="text-xs text-gray-500 mt-1">管理系统自动推送给用户的消息内容、触发时机和推送渠道</div>
              </div>
            </div>
            <div class="rounded-xl border border-gray-100 overflow-hidden">
              <el-table :data="systemConfig.push.list" style="width: 100%" stripe>
                <el-table-column prop="category" label="分类" width="100">
                  <template #default="{ row }">
                    <el-tag :type="getPushCategoryTag(row.category)">{{ row.category }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="title" label="标题" width="200" />
                <el-table-column prop="content" label="内容模板" min-width="300">
                  <template #default="{ row }">
                    <div class="line-clamp-2 text-sm text-gray-600">{{ row.content }}</div>
                  </template>
                </el-table-column>
                <el-table-column prop="trigger" label="触发时机" width="150" />
                <el-table-column label="推送渠道" width="180">
                  <template #default="{ row }">
                    <div class="flex gap-1">
                      <el-tag v-if="row.channels.includes('APP')" size="small" type="info">APP</el-tag>
                      <el-tag v-if="row.channels.includes('SMS')" size="small" type="success">短信</el-tag>
                      <el-tag v-if="row.channels.includes('EMAIL')" size="small" type="warning">邮件</el-tag>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="100">
                  <template #default="{ row }">
                    <el-switch v-model="row.enabled" size="small" @change="saveRule('push')" />
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="100" fixed="right">
                  <template #default="{ row, $index }">
                    <el-button link type="primary" size="small" @click="openPushDialog(row, $index)">编辑</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="AI">
          <template #label>
            <span class="flex items-center gap-2">
              <el-icon><Connection /></el-icon>
              <span>AI模型接入</span>
            </span>
          </template>
          <div class="grid gap-6 p-6 system-rules-grid">
            <div class="system-rule-nav rounded-xl border border-gray-100 bg-gray-50 p-3 h-fit">
              <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">设置项</div>
              <a href="#ai-dispatch">调度分析模型</a>
              <a href="#ai-security">安全与提示词</a>
              <a href="#ai-logs">调用日志</a>
            </div>
            <div class="space-y-6 min-w-0">
              <section id="ai-dispatch" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-purple-600"><Connection /></el-icon>
                    AI调度分析模型
                  </h3>
                  <el-button
                    v-if="ruleLocks.aiModel"
                    type="primary"
                    plain
                    size="small"
                    @click="unlockRule('aiModel')"
                  >
                    <el-icon class="mr-1"><Lock /></el-icon>
                    解锁编辑
                  </el-button>
                  <div v-else class="flex gap-2">
                    <el-button size="small" @click="cancelRule('aiModel')">取消</el-button>
                    <el-button
                      type="primary"
                      size="small"
                      :loading="savingKey === 'aiModel'"
                      @click="saveRule('aiModel')"
                    >
                      <el-icon class="mr-1"><Check /></el-icon>
                      保存
                    </el-button>
                  </div>
                </div>
                <div class="bg-purple-50 rounded-lg p-5 border border-purple-200">
                  <el-form label-width="140px" label-position="left" :disabled="ruleLocks.aiModel">
                    <el-form-item label="启用状态">
                      <el-switch
                        v-model="systemConfig.aiModel.enabled"
                        active-text="启用"
                        inactive-text="停用"
                        active-color="#7c3aed"
                      />
                      <div class="text-xs text-gray-400 mt-1">启用后，车辆排程看板可发起 AI 调度分析。</div>
                    </el-form-item>
                    <el-form-item label="模型提供商">
                      <el-select v-model="systemConfig.aiModel.provider" style="width: 240px">
                        <el-option label="OpenAI" value="OPENAI" />
                        <el-option label="Gemini" value="GEMINI" />
                        <el-option label="OpenAI Compatible" value="OPENAI_COMPATIBLE" />
                      </el-select>
                    </el-form-item>
                    <el-form-item v-if="systemConfig.aiModel.provider === 'OPENAI_COMPATIBLE'" label="Base URL">
                      <el-input
                        v-model="systemConfig.aiModel.baseUrl"
                        placeholder="https://api.example.com/v1"
                        style="max-width: 420px"
                      />
                      <div class="text-xs text-gray-400 mt-1">兼容 OpenAI 协议的模型服务必填。</div>
                    </el-form-item>
                    <el-form-item label="模型名称">
                      <el-input
                        v-model="systemConfig.aiModel.modelName"
                        placeholder="例如 gpt-xxx / gemini-xxx"
                        style="max-width: 320px"
                      />
                    </el-form-item>
                    <el-form-item label="API Key">
                      <el-input
                        v-model="systemConfig.aiModel.apiKeyMasked"
                        placeholder="保存后仅显示掩码"
                        show-password
                        style="max-width: 420px"
                      />
                      <div class="text-xs text-gray-400 mt-1">API Key 服务端加密保存，前端不读取明文。</div>
                    </el-form-item>
                    <el-form-item label="用途范围">
                      <el-tag type="info" effect="plain">门市租赁 AI 调度分析</el-tag>
                    </el-form-item>
                    <el-form-item label="提示词来源">
                      <div class="flex items-center gap-3">
                        <el-tag type="warning" effect="plain">{{ systemConfig.aiModel.promptSourceText }}</el-tag>
                        <span class="text-xs text-gray-500">{{ systemConfig.aiModel.promptConfigVersion }}</span>
                      </div>
                      <div class="text-xs text-gray-400 mt-1">优先使用租户专属提示词；未配置时使用全租户默认提示词。</div>
                    </el-form-item>
                    <el-form-item label="连接测试">
                      <div class="flex items-center gap-3">
                        <el-button
                          type="primary"
                          plain
                          size="small"
                          :loading="savingKey === 'ai-test'"
                          @click="testAIConnection"
                        >
                          测试连接
                        </el-button>
                        <el-tag
                          :type="systemConfig.aiModel.lastTestStatus === '成功' ? 'success' : 'warning'"
                          effect="plain"
                        >
                          {{ systemConfig.aiModel.lastTestStatus }}
                        </el-tag>
                        <span class="text-xs text-gray-500">{{ systemConfig.aiModel.lastTestTime }}</span>
                      </div>
                    </el-form-item>
                  </el-form>
                </div>
              </section>

              <section id="ai-security" class="system-rule-section">
                <h3 class="text-lg font-bold text-gray-800 flex items-center mb-4">
                  <el-icon class="mr-2 text-slate-600"><DocumentChecked /></el-icon>
                  安全与提示词
                </h3>
                <div class="bg-slate-50 rounded-lg p-5 border border-slate-200">
                  <div class="grid grid-cols-3 gap-4">
                    <div
                      v-for="item in systemConfig.aiModel.guardrails"
                      :key="item.title"
                      class="bg-white rounded-lg border border-slate-200 p-4"
                    >
                      <div class="text-sm font-semibold text-gray-800">{{ item.title }}</div>
                      <div class="text-xs text-gray-500 mt-2 leading-5">{{ item.desc }}</div>
                    </div>
                  </div>
                  <div class="mt-4 rounded-lg border border-purple-100 bg-white p-4">
                    <div class="text-xs text-gray-400 uppercase tracking-wider">当前提示词版本</div>
                    <div class="text-sm font-semibold text-gray-800 mt-2">{{ systemConfig.aiModel.promptVersion }}</div>
                    <div class="text-xs text-gray-500 mt-2">提示词由独立配置文件维护，可使用全租户默认版或租户专属版；营运平台不开放租户直接编辑提示词正文。</div>
                  </div>
                </div>
              </section>

              <section id="ai-logs" class="system-rule-section">
                <div class="flex justify-between items-center mb-4">
                  <h3 class="text-lg font-bold text-gray-800 flex items-center">
                    <el-icon class="mr-2 text-indigo-600"><Tickets /></el-icon>
                    AI调用日志
                  </h3>
                  <el-tag type="info" effect="plain">保留实际请求内容</el-tag>
                </div>
                <div class="bg-white rounded-lg p-5 border border-slate-200">
                  <div class="text-xs text-gray-500 mb-4">用于查看历史 AI 调度分析实际提交给模型的提示词、请求数据包、模型返回和系统校验结果。</div>
                  <el-table :data="systemConfig.aiModel.logs" border stripe>
                    <el-table-column prop="time" label="发起时间" width="170" />
                    <el-table-column prop="analysisId" label="任务ID" width="220" />
                    <el-table-column prop="operator" label="发起人" width="120" />
                    <el-table-column prop="model" label="模型" width="150" />
                    <el-table-column label="提示词" min-width="220">
                      <template #default="{ row }">
                        <div class="text-sm font-medium text-gray-800">{{ row.promptVersion }}</div>
                        <div class="text-xs text-gray-500">{{ row.promptSourceText }} · {{ row.promptHash }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="隐私过滤" width="110">
                      <template #default="{ row }">
                        <el-tag size="small" type="success" effect="plain">{{ row.filteredCount }} 类</el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column prop="status" label="状态" width="110">
                      <template #default="{ row }">
                        <el-tag
                          size="small"
                          :type="row.status === '成功' ? 'success' : 'warning'"
                          effect="plain"
                        >
                          {{ row.status }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="120" fixed="right">
                      <template #default="{ row }">
                        <el-button link type="primary" size="small" @click="openAiLogDetail(row)">查看日志</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </section>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog v-model="specialDateDialogVisible" title="新增特殊日期规则" width="500px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="规则类型">
          <div class="grid grid-cols-2 gap-4 w-full">
            <div
              class="cursor-pointer border-2 rounded-lg p-4 text-center transition-all"
              :class="newSpecialDate.type === 'HOLIDAY' ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-200'"
              @click="newSpecialDate.type = 'HOLIDAY'"
            >
              <div class="font-bold" :class="newSpecialDate.type === 'HOLIDAY' ? 'text-red-600' : 'text-gray-600'">
                设为假日
              </div>
              <div class="text-xs text-gray-400 mt-1">工作日放假/调休</div>
            </div>
            <div
              class="cursor-pointer border-2 rounded-lg p-4 text-center transition-all"
              :class="newSpecialDate.type === 'WORKDAY' ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-200'"
              @click="newSpecialDate.type = 'WORKDAY'"
            >
              <div class="font-bold" :class="newSpecialDate.type === 'WORKDAY' ? 'text-green-600' : 'text-gray-600'">
                设为平日
              </div>
              <div class="text-xs text-gray-400 mt-1">周末补班</div>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker
            v-model="newSpecialDate.range"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            size="large"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注说明">
          <el-input v-model="newSpecialDate.name" placeholder="例如：五一劳动节调休" size="large" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="specialDateDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!isSpecialDateValid" @click="addSpecialDate">保存规则</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="pushDialogVisible" title="编辑推送规则" width="600px" destroy-on-close>
      <el-form :model="pushForm" label-width="100px">
        <el-form-item label="消息分类">
          <el-select v-model="pushForm.category" style="width: 100%">
            <el-option label="系统通知" value="系统" />
            <el-option label="订单相关" value="订单" />
            <el-option label="营销推广" value="营销" />
          </el-select>
        </el-form-item>
        <el-form-item label="消息标题">
          <el-input v-model="pushForm.title" />
        </el-form-item>
        <el-form-item label="触发时机">
          <el-input v-model="pushForm.trigger" placeholder="例如：订单创建后、审核通过时" />
        </el-form-item>
        <el-form-item label="内容模板">
          <el-input v-model="pushForm.content" type="textarea" :rows="4" placeholder="可用变量: {用户}, {订单号}" />
        </el-form-item>
        <el-form-item label="推送渠道">
          <el-checkbox-group v-model="pushForm.channels">
            <el-checkbox label="APP">APP推送</el-checkbox>
            <el-checkbox label="SMS">短信</el-checkbox>
            <el-checkbox label="EMAIL">邮件</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="pushForm.enabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pushDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="savePushRule">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="aiLogDialogVisible" title="AI调用请求日志" width="960px" destroy-on-close>
      <div v-if="selectedAiLog" class="space-y-4">
        <div class="grid grid-cols-4 gap-3">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="text-xs text-gray-400">任务ID</div>
            <div class="text-sm font-semibold text-gray-800 mt-1">{{ selectedAiLog.analysisId }}</div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="text-xs text-gray-400">模型</div>
            <div class="text-sm font-semibold text-gray-800 mt-1">{{ selectedAiLog.model }}</div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="text-xs text-gray-400">提示词来源</div>
            <div class="text-sm font-semibold text-gray-800 mt-1">{{ selectedAiLog.promptSourceText }}</div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="text-xs text-gray-400">隐私过滤</div>
            <div class="text-sm font-semibold text-gray-800 mt-1">{{ selectedAiLog.filteredCount }} 类资料</div>
          </div>
        </div>
        <el-tabs>
          <el-tab-pane label="完整提示词">
            <pre class="h-[260px] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-5 text-slate-100 whitespace-pre-wrap">{{ selectedAiLog.promptText }}</pre>
          </el-tab-pane>
          <el-tab-pane label="请求数据包">
            <pre class="h-[260px] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-5 text-slate-100 whitespace-pre-wrap">{{ selectedAiLog.requestPayload }}</pre>
          </el-tab-pane>
          <el-tab-pane label="模型返回">
            <pre class="h-[260px] overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-5 text-slate-100 whitespace-pre-wrap">{{ selectedAiLog.responsePayload }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button @click="aiLogDialogVisible = false">关闭</el-button>
        <el-button type="primary" plain @click="showReservedAction('导出 JSON')">导出 JSON</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>

<style scoped>
.system-rules-grid {
  grid-template-columns: 200px minmax(0, 1fr);
}

.system-rule-nav a {
  display: block;
  border-radius: 8px;
  padding: 8px 12px;
  color: #4b5563;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.system-rule-nav a:hover,
.system-rule-nav a:focus {
  background: #fff;
  color: #00689e;
}

.system-rule-section {
  scroll-margin-top: 80px;
}

@media (max-width: 1024px) {
  .system-rules-grid {
    grid-template-columns: 1fr;
  }
}
</style>
