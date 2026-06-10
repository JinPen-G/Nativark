<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, ref } from "vue";
import {
  getRentalRuleVersion,
  getRentalRules,
  listRentalRuleVersions,
  saveRentalRules
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { fallbackRules } from "../data/prototypeSeed";
import type { StoreRentalRuleConfig, StoreRentalRuleVersionRecord } from "@rimo/shared";

const activeTab = ref("TRANSACTION");
const loading = ref(false);
const saving = ref(false);
const rules = ref<StoreRentalRuleConfig>(structuredClone(fallbackRules));
const versionLoading = ref(false);
const versionDialogVisible = ref(false);
const ruleVersions = ref<StoreRentalRuleVersionRecord[]>([]);
const selectedRuleVersion = ref<StoreRentalRuleVersionRecord>();

async function loadRules() {
  loading.value = true;
  try {
    rules.value = await getRentalRules();
    await loadRuleVersions();
  } catch {
    rules.value = structuredClone(fallbackRules);
    ruleVersions.value = [buildFallbackVersion()];
    selectedRuleVersion.value = ruleVersions.value[0];
    ElMessage.warning("API 暂不可用，当前展示本地默认规则。");
  } finally {
    loading.value = false;
  }
}

async function loadRuleVersions() {
  versionLoading.value = true;
  try {
    const versions = await listRentalRuleVersions();
    ruleVersions.value = versions.length > 0 ? versions : [buildFallbackVersion()];
    selectedRuleVersion.value = ruleVersions.value[0];
  } catch {
    ruleVersions.value = [buildFallbackVersion()];
    selectedRuleVersion.value = ruleVersions.value[0];
  } finally {
    versionLoading.value = false;
  }
}

async function saveRules() {
  saving.value = true;
  try {
    rules.value = await saveRentalRules(rules.value);
    await loadRuleVersions();
    ElMessage.success("租赁业务规则已保存，并生成新的规则版本。");
  } catch {
    ElMessage.success("已模拟保存租赁业务规则。");
  } finally {
    saving.value = false;
  }
}

async function openRuleVersion(record?: StoreRentalRuleVersionRecord) {
  versionDialogVisible.value = true;
  if (!record) {
    selectedRuleVersion.value = ruleVersions.value[0] ?? buildFallbackVersion();
    return;
  }
  selectedRuleVersion.value = record;
  try {
    selectedRuleVersion.value = await getRentalRuleVersion(record.version);
  } catch {
    selectedRuleVersion.value = record;
  }
}

function buildFallbackVersion(): StoreRentalRuleVersionRecord {
  return {
    version: rules.value.version,
    versionNo: 1,
    status: rules.value.status,
    savedBy: "营运端",
    savedAt: rules.value.effectiveAt,
    effectiveAt: rules.value.effectiveAt,
    changeReason: "当前展示规则",
    snapshot: structuredClone(rules.value)
  };
}

function statusLabel(status: StoreRentalRuleVersionRecord["status"]) {
  return {
    draft: "草稿",
    effective: "生效中",
    archived: "历史版本"
  }[status];
}

function statusType(status: StoreRentalRuleVersionRecord["status"]) {
  return status === "effective" ? "success" : status === "draft" ? "warning" : "info";
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : value;
}

function preAuthModeLabel(value?: string) {
  return value === "fixed_amount" ? "固定额度" : "租金比例";
}

function pickupFundHandlingLabels(value?: string[]) {
  const map: Record<string, string> = {
    performance_guarantee: "履约担保",
    preauth_to_rental: "预授权转租金"
  };
  return value?.map((item) => map[item] ?? item).join("、") || "-";
}

onMounted(loadRules);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button type="primary" color="#00689E" :loading="saving" @click="saveRules">
        <el-icon class="mr-1"><Check /></el-icon>
        保存更改
      </el-button>
    </template>

    <div class="flex justify-between items-end mb-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">租赁业务规则</h1>
        <p class="text-gray-500 text-sm mt-1">
          配置门市租车全流程的交易授权、计费、履约、取消、爽约、超时和月结规则。
        </p>
      </div>
      <el-tag type="primary" effect="plain" class="cursor-pointer" @click="openRuleVersion(ruleVersions[0])">
        {{ rules.version }}
      </el-tag>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div class="text-xs text-gray-400 mb-1">当前规则版本</div>
        <div class="flex items-center justify-between gap-2">
          <div
            class="font-mono font-bold text-gray-800 cursor-pointer underline decoration-dotted"
            @click="openRuleVersion(ruleVersions[0])"
          >
            {{ rules.version }}
          </div>
          <el-button size="small" type="primary" link @click="openRuleVersion()">历史版本</el-button>
        </div>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div class="text-xs text-gray-400 mb-1">版本范围</div>
        <div class="text-sm font-medium text-gray-800">门市租车全局配置</div>
      </div>
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div class="text-xs text-gray-400 mb-1">订单快照</div>
        <div class="text-sm font-medium text-gray-800">仅影响后续新建订单</div>
      </div>
    </div>

    <el-tabs
      v-loading="loading"
      v-model="activeTab"
      class="rimo-page-tabs bg-white rounded-xl shadow-sm border border-gray-100 min-h-[600px]"
    >
      <el-tab-pane name="TRANSACTION">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><CreditCard /></el-icon>交易与授权</span>
        </template>
        <div class="p-6 space-y-6">
          <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
            本期下单阶段的预授权押金统一采用线上预授权，不支持现金押金、线下押金或仅登记线下凭证。
          </div>

          <div class="grid grid-cols-12 gap-5">
            <div class="col-span-12 lg:col-span-7 rimo-card p-6">
              <div class="font-bold text-gray-800 mb-4">支付方式开关</div>
              <el-form label-position="top">
                <el-form-item label="客户自付可用渠道">
                  <el-checkbox-group v-model="rules.payment.enabledGateways">
                    <el-checkbox label="jiekou">街口支付</el-checkbox>
                    <el-checkbox label="credit_card">信用卡</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
                <el-form-item label="企业月结">
                  <div class="flex items-center gap-4">
                    <el-switch v-model="rules.enterpriseBilling.monthlySettlementEnabled" active-text="启用" inactive-text="禁用" />
                    <span class="text-sm text-gray-500">企业月结订单不读取客户支付方式，不发起预授权。</span>
                  </div>
                </el-form-item>
                <el-form-item label="取车资金处理口径">
                  <el-checkbox-group v-model="rules.payment.pickupFundHandling">
                    <el-checkbox label="performance_guarantee">履约担保</el-checkbox>
                    <el-checkbox label="preauth_to_rental">预授权转租金</el-checkbox>
                  </el-checkbox-group>
                </el-form-item>
              </el-form>
            </div>

            <div class="col-span-12 lg:col-span-5 rimo-card p-6">
              <div class="font-bold text-gray-800 mb-4">预授权押金策略</div>
              <el-form label-position="top">
                <el-form-item label="预授权额度模式">
                  <el-radio-group v-model="rules.payment.preAuthMode">
                    <el-radio-button label="rental_ratio">租金比例</el-radio-button>
                    <el-radio-button label="fixed_amount">固定额度</el-radio-button>
                  </el-radio-group>
                </el-form-item>
                <div class="grid grid-cols-2 gap-4">
                  <el-form-item label="预授权比例">
                    <el-input-number v-model="rules.payment.preAuthRatioPercent" :min="0" :max="rules.payment.maxPreAuthRatioPercent" class="w-full" />
                  </el-form-item>
                  <el-form-item label="固定额度">
                    <el-input-number v-model="rules.payment.fixedPreAuthAmount" :min="0" :step="100" class="w-full" />
                  </el-form-item>
                </div>
                <el-form-item label="企业月结预授权金额">
                  <el-input-number v-model="rules.payment.enterpriseMonthlyPreAuthAmount" :min="0" :step="100" class="w-full" />
                </el-form-item>
              </el-form>
            </div>

            <div class="col-span-12 rimo-card p-6">
              <div class="font-bold text-gray-800 mb-4">待支付资源保留</div>
              <div class="grid grid-cols-12 gap-4 items-end">
                <el-form-item label="启用待支付资源保留" class="col-span-12 md:col-span-3 mb-0">
                  <el-switch v-model="rules.pendingPayment.enabled" active-text="开启" inactive-text="关闭" />
                </el-form-item>
                <el-form-item label="保留时长 (分钟)" class="col-span-12 md:col-span-3 mb-0">
                  <el-input-number v-model="rules.pendingPayment.holdMinutes" :min="1" class="w-full" />
                </el-form-item>
                <div class="col-span-12 md:col-span-6 text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-100 px-4 py-3">
                  保留时长到期仍未完成预授权押金时，订单进入已取消并释放车组资源。
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="BILLING">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Timer /></el-icon>计费与取还车</span>
        </template>
        <div class="p-6 grid grid-cols-12 gap-5">
          <div class="col-span-12 lg:col-span-6 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">时租与日租转换</div>
            <div class="grid grid-cols-3 gap-4">
              <el-form-item label="起租小时">
                <el-input-number v-model="rules.durationBilling.minBillableHours" :min="1" class="w-full" />
              </el-form-item>
              <el-form-item label="超过多少小时按天">
                <el-input-number v-model="rules.durationBilling.chargeAsDayAfterHours" :min="1" class="w-full" />
              </el-form-item>
              <el-form-item label="计费单位 (分钟)">
                <el-input-number v-model="rules.durationBilling.billingUnitMinutes" :min="1" class="w-full" />
              </el-form-item>
            </div>
          </div>

          <div class="col-span-12 lg:col-span-6 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">异地还车规则</div>
            <div class="grid grid-cols-2 gap-4">
              <el-form-item label="允许异地还车">
                <el-switch v-model="rules.oneWayReturn.enabled" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="要求门店对规则">
                <el-switch v-model="rules.oneWayReturn.requireStorePairRule" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="异店还车基础费">
                <el-input-number v-model="rules.oneWayReturn.baseFeeAmount" :min="0" :step="10" class="w-full" />
              </el-form-item>
              <el-form-item label="跨城市还车费">
                <el-input-number v-model="rules.oneWayReturn.crossCityFeeAmount" :min="0" :step="10" class="w-full" />
              </el-form-item>
            </div>
          </div>

          <div class="col-span-12 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">取车、还车和操作锁规则</div>
            <div class="grid grid-cols-12 gap-4">
              <el-form-item label="允许提前取车" class="col-span-12 md:col-span-3">
                <el-switch v-model="rules.pickupReturn.allowEarlyPickup" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="提前取车免费宽限 (分钟)" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.pickupReturn.earlyPickupGraceMinutes" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="订单间隔/整备缓冲 (分钟)" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.pickupReturn.turnaroundMinutes" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="启用履约操作锁" class="col-span-12 md:col-span-3">
                <el-switch v-model="rules.pickupReturn.operationLockEnabled" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="操作锁有效期 (分钟)" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.pickupReturn.operationLockMinutes" :min="1" class="w-full" />
              </el-form-item>
              <el-form-item label="关闭取车窗口处理" class="col-span-12 md:col-span-4">
                <el-select v-model="rules.pickupReturn.closePickupWindowAction" class="w-full">
                  <el-option label="固定保留订单" value="keep_reserved" />
                  <el-option label="自动爽约" value="auto_no_show" />
                </el-select>
              </el-form-item>
              <el-form-item label="关闭还车窗口处理" class="col-span-12 md:col-span-4">
                <el-select v-model="rules.pickupReturn.closeReturnWindowAction" class="w-full">
                  <el-option label="按还车提交验车" value="submit_return_inspection" />
                  <el-option label="保持租赁中" value="keep_renting" />
                </el-select>
              </el-form-item>
              <el-form-item label="提前还车退款规则" class="col-span-12 md:col-span-4">
                <el-select v-model="rules.pickupReturn.earlyReturnRefundMode" class="w-full">
                  <el-option label="仅退还剩余完整天数租金" value="full_unused_days" />
                  <el-option label="不退还租金" value="no_refund" />
                </el-select>
              </el-form-item>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="EXCEPTION">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><WarningFilled /></el-icon>取消与超时</span>
        </template>
        <div class="p-6 grid grid-cols-12 gap-5">
          <div class="col-span-12 lg:col-span-4 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">免责取消</div>
            <el-form label-position="top">
              <el-form-item label="下单后限时取消">
                <div class="flex items-center gap-3">
                  <el-switch v-model="rules.cancellation.limitedFreeCancelEnabled" />
                  <el-input-number v-model="rules.cancellation.limitedFreeCancelMinutes" :min="0" />
                  <span class="text-sm text-gray-500">分钟</span>
                </div>
              </el-form-item>
              <el-form-item label="取车前提前取消">
                <el-input-number v-model="rules.cancellation.freeCancelBeforeHours" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="免责取消手续费">
                <el-input-number v-model="rules.cancellation.freeCancelServiceFeeAmount" :min="0" class="w-full" />
              </el-form-item>
            </el-form>
          </div>

          <div class="col-span-12 lg:col-span-4 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">有责取消</div>
            <el-form label-position="top">
              <el-form-item label="计算方式">
                <el-radio-group v-model="rules.cancellation.responsibleCancelMode">
                  <el-radio-button label="preauth_ratio">预授权比例</el-radio-button>
                  <el-radio-button label="fixed_amount">固定金额</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="有责取消固定金额">
                <el-input-number v-model="rules.cancellation.responsibleCancelFixedAmount" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="有责取消预授权比例">
                <el-input-number v-model="rules.cancellation.responsibleCancelPreAuthRatioPercent" :min="0" :max="100" class="w-full" />
              </el-form-item>
              <el-form-item label="阶梯扣费">
                <el-switch v-model="rules.cancellation.tieredDeductionEnabled" active-text="开启" inactive-text="关闭" />
              </el-form-item>
            </el-form>
          </div>

          <div class="col-span-12 lg:col-span-4 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">未取车爽约</div>
            <el-form label-position="top">
              <el-form-item label="保留车辆时长 (小时)">
                <el-input-number v-model="rules.noShow.vehicleHoldHours" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="自动释放资源">
                <el-switch v-model="rules.noShow.autoReleaseEnabled" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="收取爽约违约金">
                <el-switch v-model="rules.noShow.chargeNoShowFee" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="固定违约金">
                <el-input-number v-model="rules.noShow.noShowFeeAmount" :min="0" class="w-full" />
              </el-form-item>
            </el-form>
          </div>

          <div class="col-span-12 rimo-card p-6">
            <div class="font-bold text-gray-800 mb-4">超时还车与续租</div>
            <div class="grid grid-cols-12 gap-4">
              <el-form-item label="超时免费宽限 (分钟)" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.overdue.graceMinutes" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="超时计费单位 (分钟)" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.overdue.billingUnitMinutes" :min="1" class="w-full" />
              </el-form-item>
              <el-form-item label="超时费用倍率" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.overdue.feeMultiplier" :min="1" :step="0.1" class="w-full" />
              </el-form-item>
              <el-form-item label="超时罚款固定金额" class="col-span-12 md:col-span-3">
                <el-input-number v-model="rules.overdue.fixedPenaltyAmount" :min="0" class="w-full" />
              </el-form-item>
              <el-form-item label="允许延长用车" class="col-span-12 md:col-span-3">
                <el-switch v-model="rules.extension.allowExtension" active-text="开启" inactive-text="关闭" />
              </el-form-item>
              <el-form-item label="允许逾期补办续租" class="col-span-12 md:col-span-3">
                <el-switch v-model="rules.extension.allowOverdueExtension" active-text="开启" inactive-text="关闭" />
              </el-form-item>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="versionDialogVisible" title="租赁业务规则历史版本" width="960px" destroy-on-close>
      <div v-loading="versionLoading" class="grid grid-cols-12 gap-5">
        <div class="col-span-12 lg:col-span-5">
          <el-table
            :data="ruleVersions"
            size="small"
            height="460"
            highlight-current-row
            @row-click="openRuleVersion"
          >
            <el-table-column prop="version" label="版本号" min-width="190">
              <template #default="{ row }">
                <div class="font-mono text-xs text-gray-800">{{ row.version }}</div>
                <div class="text-xs text-gray-400">{{ row.changeReason }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small" effect="plain">
                  {{ statusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="savedAt" label="保存时间" width="150">
              <template #default="{ row }">{{ formatDateTime(row.savedAt) }}</template>
            </el-table-column>
          </el-table>
        </div>

        <div class="col-span-12 lg:col-span-7 rounded-lg border border-gray-100 bg-gray-50 p-4">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <div class="text-xs text-gray-400 mb-1">版本详情</div>
              <div class="font-mono font-bold text-gray-800">
                {{ selectedRuleVersion?.version || "-" }}
              </div>
            </div>
            <el-tag v-if="selectedRuleVersion" :type="statusType(selectedRuleVersion.status)" effect="plain">
              {{ statusLabel(selectedRuleVersion.status) }}
            </el-tag>
          </div>

          <el-descriptions :column="2" border size="small" class="mb-4">
            <el-descriptions-item label="保存人">{{ selectedRuleVersion?.savedBy || "-" }}</el-descriptions-item>
            <el-descriptions-item label="保存时间">{{ formatDateTime(selectedRuleVersion?.savedAt) }}</el-descriptions-item>
            <el-descriptions-item label="生效时间">{{ formatDateTime(selectedRuleVersion?.effectiveAt) }}</el-descriptions-item>
            <el-descriptions-item label="变更原因">{{ selectedRuleVersion?.changeReason || "-" }}</el-descriptions-item>
          </el-descriptions>

          <div class="space-y-4 text-sm">
            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="font-bold text-gray-800 mb-3">交易与授权</div>
              <div class="grid grid-cols-2 gap-3 text-gray-600">
                <div>预授权模式：{{ preAuthModeLabel(selectedRuleVersion?.snapshot.payment.preAuthMode) }}</div>
                <div>预授权比例：{{ selectedRuleVersion?.snapshot.payment.preAuthRatioPercent ?? "-" }}%</div>
                <div>固定额度：{{ selectedRuleVersion?.snapshot.payment.fixedPreAuthAmount ?? "-" }}</div>
                <div>企业月结预授权：{{ selectedRuleVersion?.snapshot.payment.enterpriseMonthlyPreAuthAmount ?? "-" }}</div>
                <div class="col-span-2">取车资金处理：{{ pickupFundHandlingLabels(selectedRuleVersion?.snapshot.payment.pickupFundHandling) }}</div>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="font-bold text-gray-800 mb-3">计费与取还车</div>
              <div class="grid grid-cols-2 gap-3 text-gray-600">
                <div>起租小时：{{ selectedRuleVersion?.snapshot.durationBilling.minBillableHours ?? "-" }}</div>
                <div>超过按天小时：{{ selectedRuleVersion?.snapshot.durationBilling.chargeAsDayAfterHours ?? "-" }}</div>
                <div>整备缓冲：{{ selectedRuleVersion?.snapshot.pickupReturn.turnaroundMinutes ?? "-" }} 分钟</div>
                <div>操作锁有效期：{{ selectedRuleVersion?.snapshot.pickupReturn.operationLockMinutes ?? "-" }} 分钟</div>
              </div>
            </div>

            <div class="rounded-lg border border-gray-200 bg-white p-4">
              <div class="font-bold text-gray-800 mb-3">取消、爽约与超时</div>
              <div class="grid grid-cols-2 gap-3 text-gray-600">
                <div>免费取消提前：{{ selectedRuleVersion?.snapshot.cancellation.freeCancelBeforeHours ?? "-" }} 小时</div>
                <div>有责取消比例：{{ selectedRuleVersion?.snapshot.cancellation.responsibleCancelPreAuthRatioPercent ?? "-" }}%</div>
                <div>爽约保留：{{ selectedRuleVersion?.snapshot.noShow.vehicleHoldHours ?? "-" }} 小时</div>
                <div>超时宽限：{{ selectedRuleVersion?.snapshot.overdue.graceMinutes ?? "-" }} 分钟</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </AppLayout>
</template>
