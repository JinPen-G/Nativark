<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import {
  ConfigStatus,
  StoreRentalMode,
  type MarketingPlanDetail,
  type MarketingPlanSummary,
  type SaveMarketingPlanRequest
} from "@rimo/shared";
import { getMarketingPlan, listMarketingPlans, saveMarketingPlan } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const activeView = ref<"list" | "calendar">("list");
const activeBusinessTab = ref<"STORE" | "SHARING">("STORE");
const keyword = ref("");
const loading = ref(false);
const detailVisible = ref(false);
const versionVisible = ref(false);
const currentPlan = ref<MarketingPlanDetail | null>(null);
const plans = ref<MarketingPlanSummary[]>([]);

const vehicleGroupOptions = [
  { code: "GROUP_ECONOMY", name: "Honda Jazz / 同级" },
  { code: "GROUP_SEVEN_SEATS", name: "Toyota Noah / 同级 7座" },
  { code: "GROUP_EV", name: "Tesla Model 3 / 同级" }
];

const storeOptions = [
  { code: "MONGKOK", name: "旺角门市" },
  { code: "CENTRAL", name: "中环门市" },
  { code: "AIRPORT", name: "机场门市" }
];

const planForm = reactive({
  id: "",
  code: "",
  name: "",
  displayName: "",
  status: ConfigStatus.Effective,
  customerScope: "personal" as SaveMarketingPlanRequest["customerScope"],
  priority: 60,
  effectiveRange: ["2026-05-01", "2026-12-31"] as [string, string],
  storeCodes: ["MONGKOK", "CENTRAL", "AIRPORT"] as string[],
  vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"] as string[],
  manualVerification: false,
  qualificationName: "",
  requiredDocText: "",
  weekdayRate: 0.9,
  holidayRate: 0.95,
  fixedDeductionAmount: 0,
  description: ""
});

const filteredPlans = computed(() => {
  const term = keyword.value.trim().toLowerCase();
  return plans.value.filter((plan) => {
    const matchesTerm =
      !term ||
      plan.name.toLowerCase().includes(term) ||
      plan.displayName.toLowerCase().includes(term) ||
      plan.versionId.toLowerCase().includes(term);
    return matchesTerm && plan.supportedModes.includes(StoreRentalMode.Store);
  });
});

const calendarDays = computed(() => {
  const base = new Date("2026-05-01T00:00:00+08:00");
  return Array.from({ length: 35 }).map((_, index) => {
    const day = new Date(base);
    day.setDate(base.getDate() + index);
    const date = day.toISOString().slice(0, 10);
    const events = filteredPlans.value.filter(
      (plan) => date >= plan.effectiveFrom.slice(0, 10) && date <= plan.effectiveTo.slice(0, 10)
    );
    return { date, dayNo: day.getDate(), events };
  });
});

async function loadPlans() {
  loading.value = true;
  try {
    plans.value = await listMarketingPlans();
  } catch {
    ElMessage.error("行销方案数据加载失败");
  } finally {
    loading.value = false;
  }
}

async function openPlan(row?: MarketingPlanSummary) {
  if (!row) {
    Object.assign(planForm, {
      id: "",
      code: "",
      name: "门市行销优惠方案",
      displayName: "门市行销优惠方案",
      status: ConfigStatus.Effective,
      customerScope: "personal",
      priority: 60,
      effectiveRange: ["2026-05-01", "2026-12-31"],
      storeCodes: ["MONGKOK", "CENTRAL", "AIRPORT"],
      vehicleGroupCodes: ["GROUP_ECONOMY", "GROUP_SEVEN_SEATS", "GROUP_EV"],
      manualVerification: false,
      qualificationName: "",
      requiredDocText: "",
      weekdayRate: 0.9,
      holidayRate: 0.95,
      fixedDeductionAmount: 0,
      description: ""
    });
    currentPlan.value = null;
    detailVisible.value = true;
    return;
  }

  try {
    const detail = await getMarketingPlan(row.id);
    currentPlan.value = detail;
    Object.assign(planForm, {
      id: detail.id,
      code: detail.code,
      name: detail.name,
      displayName: detail.displayName,
      status: detail.status,
      customerScope: detail.customerScope,
      priority: detail.priority,
      effectiveRange: [detail.effectiveFrom.slice(0, 10), detail.effectiveTo.slice(0, 10)],
      storeCodes: detail.storeCodes,
      vehicleGroupCodes: detail.vehicleGroupCodes,
      manualVerification: detail.manualVerification,
      qualificationName: detail.qualificationName ?? "",
      requiredDocText: detail.requiredDocText ?? "",
      weekdayRate: detail.weekdayRate,
      holidayRate: detail.holidayRate,
      fixedDeductionAmount: detail.fixedDeductionAmount,
      description: detail.description
    });
    detailVisible.value = true;
  } catch {
    ElMessage.error("行销方案详情加载失败");
  }
}

async function submitPlan() {
  if (!planForm.name.trim()) {
    ElMessage.warning("请输入方案名称");
    return;
  }

  const payload: SaveMarketingPlanRequest = {
    id: planForm.id || undefined,
    code: planForm.code || undefined,
    name: planForm.name,
    displayName: planForm.displayName || planForm.name,
    status: planForm.status,
    customerScope: planForm.customerScope,
    supportedModes: [StoreRentalMode.Store],
    priority: planForm.priority,
    effectiveFrom: `${planForm.effectiveRange[0]}T00:00:00+08:00`,
    effectiveTo: `${planForm.effectiveRange[1]}T23:59:59+08:00`,
    storeCodes: planForm.storeCodes,
    vehicleGroupCodes: planForm.vehicleGroupCodes,
    manualVerification: planForm.manualVerification,
    qualificationName: planForm.qualificationName || undefined,
    requiredDocText: planForm.requiredDocText || undefined,
    weekdayRate: planForm.weekdayRate,
    holidayRate: planForm.holidayRate,
    fixedDeductionAmount: planForm.fixedDeductionAmount,
    description: planForm.description,
    operator: "行销运营",
    changeReason: planForm.id ? "编辑行销方案" : "新建行销方案",
    rules: [
      {
        id: currentPlan.value?.rules[0]?.id ?? `rule_${Date.now()}`,
        name: "门市平假日优惠",
        vehicleGroupCodes: planForm.vehicleGroupCodes,
        membershipLevels: [],
        weekdayAction: {
          type: "discount",
          value: planForm.weekdayRate,
          label: `平日${formatDiscountRate(planForm.weekdayRate)}`
        },
        holidayAction: {
          type: "discount",
          value: planForm.holidayRate,
          label: `假日${formatDiscountRate(planForm.holidayRate)}`
        }
      }
    ]
  };

  try {
    await saveMarketingPlan(payload);
    detailVisible.value = false;
    await loadPlans();
    ElMessage.success("行销方案已保存，并生成新的方案版本。");
  } catch {
    ElMessage.error("行销方案保存失败");
  }
}

function openVersions(row: MarketingPlanSummary) {
  getMarketingPlan(row.id)
    .then((detail) => {
      currentPlan.value = detail;
      versionVisible.value = true;
    })
    .catch(() => ElMessage.error("历史版本加载失败"));
}

function formatDiscountRate(rate: number) {
  return `${Math.round(rate * 100)}折`;
}

function statusLabel(status: ConfigStatus) {
  const labels: Record<string, string> = {
    [ConfigStatus.Draft]: "草稿",
    [ConfigStatus.Effective]: "启用",
    [ConfigStatus.Archived]: "停用"
  };
  return labels[status] ?? status;
}

function statusType(status: ConfigStatus) {
  return status === ConfigStatus.Effective ? "success" : status === ConfigStatus.Draft ? "warning" : "info";
}

function scopeLabel(scope: MarketingPlanSummary["customerScope"]) {
  if (scope === "enterprise") return "企业资格";
  if (scope === "personal") return "个人会员";
  return "个人/企业";
}

onMounted(loadPlans);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button plain @click="activeView = activeView === 'list' ? 'calendar' : 'list'">
        <el-icon class="mr-1"><Calendar /></el-icon>
        {{ activeView === "list" ? "行销日历" : "方案列表" }}
      </el-button>
      <el-button type="primary" color="#00689E" @click="openPlan()">
        <el-icon class="mr-1"><Plus /></el-icon>
        新建门市方案
      </el-button>
    </template>

    <div class="flex justify-between items-end mb-6">
      <div>
        <div class="text-sm text-gray-400 mb-2">营销中心 / 行销优惠中心</div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">行销优惠中心</h1>
        <p class="text-gray-500 text-sm mt-1">统一管理门市与分时业务的行销优惠方案，支持精细化场景配置。</p>
      </div>
    </div>

    <el-tabs v-model="activeBusinessTab" class="rimo-page-tabs bg-white rounded-xl shadow-sm border border-gray-100 min-h-[620px]">
      <el-tab-pane name="STORE">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Shop /></el-icon><span>门市租赁</span></span>
        </template>

        <div class="p-6">
          <div class="flex items-center justify-between mb-5">
            <el-radio-group v-model="activeView">
              <el-radio-button label="list">方案列表</el-radio-button>
              <el-radio-button label="calendar">行销日历</el-radio-button>
            </el-radio-group>
            <el-input v-model="keyword" placeholder="搜索方案名称" prefix-icon="Search" clearable style="width: 240px" />
          </div>

          <el-table v-if="activeView === 'list'" v-loading="loading" :data="filteredPlans" stripe>
            <el-table-column prop="name" label="方案名称" min-width="220">
              <template #default="{ row }">
                <div class="font-bold text-gray-800">{{ row.name }}</div>
                <div class="text-xs text-gray-400 mt-1">{{ row.description }}</div>
              </template>
            </el-table-column>
            <el-table-column label="方案版本" width="190">
              <template #default="{ row }">
                <el-button type="primary" link class="font-mono" @click="openVersions(row)">{{ row.versionId }}</el-button>
                <div class="text-xs text-gray-400 mt-1">订单快照按版本追溯</div>
              </template>
            </el-table-column>
            <el-table-column label="适用资格" width="120">
              <template #default="{ row }">
                <el-tag size="small" type="primary" effect="plain">{{ scopeLabel(row.customerScope) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="有效期" width="220">
              <template #default="{ row }">
                {{ row.effectiveFrom.slice(0, 10) }} ~ {{ row.effectiveTo.slice(0, 10) }}
              </template>
            </el-table-column>
            <el-table-column label="优惠动作" min-width="180">
              <template #default="{ row }">
                <span class="font-bold text-orange-600">平日{{ formatDiscountRate(row.weekdayRate) }}</span>
                <span class="text-gray-300 mx-2">/</span>
                <span class="font-bold text-red-500">假日{{ formatDiscountRate(row.holidayRate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="优先级" width="90" align="center" prop="priority" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link @click="openPlan(row)">编辑</el-button>
                <el-button type="primary" link @click="openVersions(row)">历史版本</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-else class="grid grid-cols-7 border border-gray-100 rounded-lg overflow-hidden bg-white">
            <div v-for="label in ['一', '二', '三', '四', '五', '六', '日']" :key="label" class="h-10 bg-gray-50 border-b border-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
              周{{ label }}
            </div>
            <div v-for="day in calendarDays" :key="day.date" class="min-h-[112px] border-b border-r border-gray-100 p-2">
              <div class="text-xs font-bold text-gray-500 mb-2">{{ day.dayNo }}</div>
              <div class="space-y-1">
                <div v-for="event in day.events.slice(0, 3)" :key="event.id" class="text-[11px] rounded bg-indigo-50 text-indigo-700 px-2 py-1 truncate">
                  {{ event.displayName }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="SHARING">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Clock /></el-icon><span>分时租赁</span></span>
        </template>
        <div class="p-6 text-sm text-gray-400">分时租赁本期暂不开发，仅保留原型页签位置。</div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="detailVisible" title="配置门市优惠方案" size="60%">
      <div class="space-y-6">
        <el-card shadow="never" class="!rounded-lg">
          <template #header><span class="font-bold">方案基础信息</span></template>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="方案名称">
                <el-input v-model="planForm.name" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="前台展示名称">
                <el-input v-model="planForm.displayName" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="方案等级 (排序权重)">
                <el-input-number v-model="planForm.priority" :min="0" :max="999" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="状态">
                <el-select v-model="planForm.status" class="w-full">
                  <el-option label="启用" :value="ConfigStatus.Effective" />
                  <el-option label="草稿" :value="ConfigStatus.Draft" />
                  <el-option label="停用" :value="ConfigStatus.Archived" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="适用资格">
                <el-select v-model="planForm.customerScope" class="w-full">
                  <el-option label="个人会员" value="personal" />
                  <el-option label="企业资格" value="enterprise" />
                  <el-option label="个人/企业" value="all" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="方案有效期">
                <el-date-picker v-model="planForm.effectiveRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="方案说明">
                <el-input v-model="planForm.description" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>

        <el-card shadow="never" class="!rounded-lg">
          <template #header><span class="font-bold">适用范围与资格核验</span></template>
          <el-row :gutter="20">
            <el-col :span="12">
              <el-form-item label="适用门店">
                <el-select v-model="planForm.storeCodes" multiple class="w-full">
                  <el-option v-for="store in storeOptions" :key="store.code" :label="store.name" :value="store.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="适用车组">
                <el-select v-model="planForm.vehicleGroupCodes" multiple class="w-full">
                  <el-option v-for="group in vehicleGroupOptions" :key="group.code" :label="group.name" :value="group.code" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="到店人工核验">
                <el-switch v-model="planForm.manualVerification" active-text="需要" inactive-text="不需要" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="资格名称">
                <el-input v-model="planForm.qualificationName" :disabled="!planForm.manualVerification" placeholder="如学生身份" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="证明文件说明">
                <el-input v-model="planForm.requiredDocText" :disabled="!planForm.manualVerification" placeholder="如学生证、在学证明" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>

        <el-card shadow="never" class="!rounded-lg">
          <template #header><span class="font-bold">优惠动作</span></template>
          <el-row :gutter="20">
            <el-col :span="8">
              <el-form-item label="常规平日折扣">
                <el-input-number v-model="planForm.weekdayRate" :min="0" :max="1" :step="0.01" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="常规假日折扣">
                <el-input-number v-model="planForm.holidayRate" :min="0" :max="1" :step="0.01" class="w-full" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="固定抵扣金额">
                <el-input-number v-model="planForm.fixedDeductionAmount" :min="0" :step="10" class="w-full" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-card>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <el-button @click="detailVisible = false">取消</el-button>
          <el-button type="primary" color="#00689E" @click="submitPlan">提交方案</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="versionVisible" title="行销方案历史版本" width="880px" destroy-on-close>
      <div v-if="currentPlan" class="grid grid-cols-[250px_1fr] border rounded-lg overflow-hidden">
        <div class="bg-gray-50 border-r">
          <div class="px-3 py-2 bg-gray-100 text-xs font-bold text-gray-500">版本列表</div>
          <div v-for="version in currentPlan.versionHistory" :key="version.versionId" class="px-3 py-3 border-b">
            <div class="font-mono font-bold text-indigo-700">{{ version.versionId }}</div>
            <div class="text-xs text-gray-400 mt-1">{{ version.savedBy }} · {{ version.savedAt }}</div>
          </div>
        </div>
        <div class="p-4">
          <div class="font-bold text-gray-800 mb-3">{{ currentPlan.name }}</div>
          <el-table :data="currentPlan.versionHistory[0]?.rules ?? []" border size="small">
            <el-table-column prop="name" label="规则名称" />
            <el-table-column label="适用车组">
              <template #default="{ row }">{{ row.vehicleGroupCodes.join("、") }}</template>
            </el-table-column>
            <el-table-column label="优惠动作">
              <template #default="{ row }">{{ row.weekdayAction.label }} / {{ row.holidayAction.label }}</template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </el-dialog>
  </AppLayout>
</template>
