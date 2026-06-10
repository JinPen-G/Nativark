<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { PriceAdjustmentSchedule, PriceVersionRecord } from "@rimo/shared";
import { cancelPriceSchedule, createPriceSchedule, getPricingPlan, savePricingPlan } from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { vehicleGroups } from "../data/prototypeSeed";

interface PriceRow {
  id: string;
  name: string;
  models: string;
  dailyPrice: number;
  depositAmount: number;
  lastUpdated: string;
}

interface SchedulePlan {
  id: string;
  effectiveTime: string;
  summary: string;
  status: PriceAdjustmentSchedule["status"];
  changes: Array<{
    vehicleGroupCode: string;
    name: string;
    currentPrice: number;
    newPrice: number;
  }>;
}

const activeTab = ref("STORE");
const isLocked = ref(true);
const isModified = ref(false);
const scheduleDialogVisible = ref(false);
const viewDialogVisible = ref(false);
const priceVersionDialogVisible = ref(false);
const currentVersionId = ref("PRICE-STORE-20260501-001");
const selectedPriceVersion = ref("PRICE-STORE-20260501-001");
const currentViewPlan = ref<SchedulePlan | null>(null);
const priceVersions = ref<PriceVersionRecord[]>([]);

const priceRows = ref<PriceRow[]>(
  vehicleGroups.map((group) => ({
    id: group.id,
    name: group.name,
    models: group.models,
    dailyPrice: group.dailyPrice,
    depositAmount: group.deposit,
    lastUpdated: group.lastUpdated
  }))
);

const scheduledList = ref<SchedulePlan[]>([
  {
    id: "schedule_store_20260515",
    effectiveTime: "2026-05-15 02:00",
    summary: "周末旺季门市标准价上调",
    status: "scheduled",
    changes: [
      { vehicleGroupCode: "GROUP_ECONOMY", name: "经济型", currentPrice: 620, newPrice: 680 },
      { vehicleGroupCode: "GROUP_SEVEN_SEATS", name: "七人座", currentPrice: 980, newPrice: 1080 }
    ]
  }
]);

const scheduleForm = reactive({
  effectiveTime: "",
  summary: "",
  prices: [] as Array<{
    vehicleGroupCode: string;
    name: string;
    currentPrice: number;
    newPrice: number;
  }>
});

const storePriceVersions = computed(() =>
  priceVersions.value.map((version) => ({
    ...version,
    sourceText: version.source === "manual" ? "手动保存" : "定时计划",
    values: version.values.map((row) => ({
      group: row.vehicleGroupName,
      models: row.vehicleGroupName,
      dailyPrice: row.dailyPrice,
      mileage: "每日免费 300km，超程按产品组规则",
      lastUpdated: version.savedAt.slice(0, 10)
    }))
  }))
);

async function loadPlan() {
  try {
    const plan = await getPricingPlan("plan_store_standard");
    currentVersionId.value = plan.currentVersionId ?? plan.version;
    selectedPriceVersion.value = currentVersionId.value;
    priceRows.value = plan.ruleLines.map((line) => ({
      id: line.vehicleGroupCode,
      name: line.vehicleGroupName,
      models: line.vehicleGroupName,
      dailyPrice: line.baseDailyAmount,
      depositAmount: line.depositAmount,
      lastUpdated: plan.savedAt?.slice(0, 10) ?? plan.effectiveAt.slice(0, 10)
    }));
    priceVersions.value = plan.versions ?? [];
    scheduledList.value = (plan.schedules ?? []).map((item) => ({
      id: item.id,
      effectiveTime: item.effectiveAt.replace("T", " ").slice(0, 16),
      summary: item.summary,
      status: item.status,
      changes: item.changes.map((change) => ({
        vehicleGroupCode: change.vehicleGroupCode,
        name: change.vehicleGroupName,
        currentPrice: change.currentPrice,
        newPrice: change.newPrice
      }))
    }));
  } catch {
    // Keep prototype seed data when API is not running.
  }
}

function unlockPricing() {
  isLocked.value = false;
}

function cancelEdit() {
  isLocked.value = true;
  isModified.value = false;
}

function handlePriceChange() {
  isModified.value = true;
}

async function savePricing() {
  try {
    const plan = await savePricingPlan("plan_store_standard", {
      operator: "价格规则管理员",
      changeReason: "营运端手动保存门市标准价",
      ruleLines: priceRows.value.map((row) => ({
        vehicleGroupCode: row.id,
        vehicleGroupName: row.name,
        baseDailyAmount: row.dailyPrice,
        weekendDailyAmount: row.dailyPrice,
        depositAmount: row.depositAmount
      }))
    });
    currentVersionId.value = plan.currentVersionId ?? plan.version;
    priceVersions.value = plan.versions ?? [];
    isLocked.value = true;
    isModified.value = false;
    ElMessage.success("门市标准价已保存，新订单将写入新的价格快照。");
  } catch {
    ElMessage.error("门市标准价保存失败");
  }
}

function openScheduleDialog() {
  scheduleForm.effectiveTime = "";
  scheduleForm.summary = "";
  scheduleForm.prices = priceRows.value.map((row) => ({
    vehicleGroupCode: row.id,
    name: row.name,
    currentPrice: row.dailyPrice,
    newPrice: row.dailyPrice
  }));
  scheduleDialogVisible.value = true;
}

function batchSetNewPrice() {
  scheduleForm.prices.forEach((row) => {
    row.newPrice = Math.round(row.currentPrice * 1.1);
  });
}

async function confirmSchedule() {
  try {
    const schedule = await createPriceSchedule({
      effectiveAt: scheduleForm.effectiveTime,
      summary: scheduleForm.summary || "门市标准价调整",
      operator: "价格规则管理员",
      changes: scheduleForm.prices.map((row) => ({
        vehicleGroupCode: row.vehicleGroupCode,
        vehicleGroupName: row.name,
        currentPrice: row.currentPrice,
        newPrice: row.newPrice
      }))
    });
    scheduledList.value.unshift({
      id: schedule.id,
      effectiveTime: schedule.effectiveAt.replace("T", " ").slice(0, 16),
      summary: schedule.summary,
      status: schedule.status,
      changes: schedule.changes.map((row) => ({
        vehicleGroupCode: row.vehicleGroupCode,
        name: row.vehicleGroupName,
        currentPrice: row.currentPrice,
        newPrice: row.newPrice
      }))
    });
    scheduleDialogVisible.value = false;
    ElMessage.success("定时调价计划已创建。");
  } catch {
    ElMessage.error("定时调价计划创建失败");
  }
}

function viewSchedule(plan: SchedulePlan) {
  currentViewPlan.value = plan;
  viewDialogVisible.value = true;
}

async function cancelSchedule(index: number) {
  try {
    const schedule = await cancelPriceSchedule(scheduledList.value[index].id);
    scheduledList.value[index].status = schedule.status;
    ElMessage.success("定时调价计划已取消。");
  } catch {
    ElMessage.error("取消计划失败");
  }
}

function getStatusType(status: SchedulePlan["status"]) {
  return status === "scheduled" ? "warning" : status === "executed" ? "success" : "info";
}

function getScheduleStatusText(status: SchedulePlan["status"]) {
  const labels: Record<SchedulePlan["status"], string> = {
    scheduled: "待执行",
    executed: "已执行",
    cancelled: "已取消"
  };
  return labels[status];
}

function getDiffText(row: { currentPrice: number; newPrice: number }) {
  const diff = row.newPrice - row.currentPrice;
  if (diff === 0) {
    return "无变化";
  }
  return `${diff > 0 ? "+" : ""}${diff}`;
}

function getDiffClass(row: { currentPrice: number; newPrice: number }) {
  return row.newPrice > row.currentPrice ? "text-orange-600 font-bold" : "text-green-600 font-bold";
}

onMounted(loadPlan);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button type="primary" color="#00689E" :disabled="!isModified" @click="savePricing">
        <el-icon class="mr-1"><Check /></el-icon>
        保存更改
      </el-button>
    </template>

    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">动态调价策略</h1>
        <p class="text-gray-500 text-sm mt-1">设定各车组的标准租金，管理门市与分时业务的差异化定价策略。</p>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="rimo-page-tabs bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]">
      <el-tab-pane name="STORE">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Shop /></el-icon><span>门市租赁</span></span>
        </template>
        <div class="p-6">
          <div class="bg-white rounded-xl border p-6 pricing-card">
            <div class="flex items-center justify-between mb-5 border-b border-gray-100 pb-4">
              <div class="flex items-center gap-4">
                <h3 class="font-bold text-gray-800 text-lg">门市标准价</h3>
                <el-tag v-if="isLocked" type="info" size="small" effect="plain">
                  <el-icon class="mr-1"><Lock /></el-icon>
                  已锁定
                </el-tag>
              </div>
              <div v-if="isLocked">
                <el-button type="primary" plain @click="unlockPricing">
                  <el-icon class="mr-1"><Lock /></el-icon>
                  解锁编辑
                </el-button>
              </div>
              <div v-else class="flex items-center gap-2">
                <el-button @click="cancelEdit">取消</el-button>
                <el-button type="primary" @click="savePricing">
                  <el-icon class="mr-1"><Check /></el-icon>
                  保存
                </el-button>
              </div>
            </div>

            <div class="mb-5 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-800 flex items-center justify-between gap-4">
              <div>
                当前标准价版本：
                <span class="font-mono font-bold cursor-pointer underline decoration-dotted" @click="priceVersionDialogVisible = true">
                  {{ currentVersionId }}
                </span>
                。新订单按当前版本写入订单计费快照，历史订单继续按下单时版本结算。
              </div>
              <el-button size="small" type="primary" link @click="priceVersionDialogVisible = true">历史版本</el-button>
            </div>

            <el-table :data="priceRows" stripe style="width: 100%">
              <el-table-column label="车组名称" min-width="200">
                <template #default="{ row }">
                  <div>
                    <div class="font-bold text-gray-800">{{ row.name }}</div>
                    <div class="text-xs text-gray-500 mt-1">{{ row.models }}</div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="价格版本" width="180" align="center">
                <template #default>
                  <el-tag size="small" type="primary" effect="plain" class="cursor-pointer" @click="priceVersionDialogVisible = true">
                    {{ currentVersionId }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="标准日租金 (元/天)" align="center">
                <template #default="{ row }">
                  <div v-if="isLocked" class="font-bold text-gray-700 font-mono">¥{{ row.dailyPrice }}</div>
                  <div v-else class="flex items-center justify-center gap-2">
                    <el-input-number v-model="row.dailyPrice" :min="0" :step="10" size="default" style="width: 140px" @change="handlePriceChange" />
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="上次更新" width="180" align="center">
                <template #default="{ row }">
                  <span class="text-gray-500 text-sm">{{ row.lastUpdated }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="mt-8">
            <div class="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6">
              <h4 class="font-bold text-gray-800 text-sm mb-3">调价说明：</h4>
              <div class="flex items-start gap-3">
                <el-icon class="text-blue-500 text-lg mt-0.5"><InfoFilled /></el-icon>
                <div class="text-sm text-gray-600 space-y-2">
                  <p><span class="font-bold text-gray-800">新订单执行：</span> 调价计划生效后，所有新创建的订单将立即按照新设定的价格执行。</p>
                  <p><span class="font-bold text-gray-800">已预约订单：</span>在此之前已预约及用车中未结算的订单，<span class="text-orange-600 font-medium">不受调价影响</span>，继续按原预约时的锁定价格结算。</p>
                  <p><span class="font-bold text-gray-800">版本追溯：</span> 手动保存或调价计划执行后生成新的标准价版本，订单详情可查看下单时命中的版本。</p>
                </div>
              </div>
            </div>

            <div class="flex justify-between items-center mb-2">
              <h3 class="font-bold text-gray-800 flex items-center gap-2 text-lg">
                <el-icon class="text-blue-600"><Clock /></el-icon>
                定时调价计划
                <el-tag type="info" size="small" effect="plain">自动化</el-tag>
              </h3>
              <el-button type="primary" plain @click="openScheduleDialog">
                <el-icon class="mr-1"><Plus /></el-icon>
                新增计划
              </el-button>
            </div>
            <p class="text-xs text-gray-400 pl-1 mb-4 flex items-center gap-1">
              <el-icon><WarningFilled /></el-icon>
              提示：定时调价用于统一调整车组标准价，仅影响生效时间后的新建订单。
            </p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                v-for="(item, index) in scheduledList"
                :key="item.effectiveTime + item.summary"
                class="bg-white rounded-xl p-5 border border-gray-200 shadow-sm relative overflow-hidden group hover:border-blue-300 transition-colors"
              >
                <div class="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                <div class="flex items-center justify-between pl-2">
                  <div class="flex items-center gap-4">
                    <div class="flex flex-col items-center justify-center bg-blue-50 text-blue-600 rounded-lg w-14 h-14">
                      <el-icon class="text-xl mb-1"><Calendar /></el-icon>
                      <span class="text-xs font-bold">计划</span>
                    </div>
                    <div>
                      <div class="flex items-center gap-2 mb-1">
                        <span class="text-gray-900 font-bold text-lg">{{ item.effectiveTime }}</span>
                        <el-tag size="small" effect="dark" :type="getStatusType(item.status)">{{ getScheduleStatusText(item.status) }}</el-tag>
                      </div>
                      <p class="text-gray-500 text-sm">{{ item.summary }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    <el-button type="primary" link size="small" @click="viewSchedule(item)">查看详情</el-button>
                    <el-button v-if="item.status === 'scheduled'" type="danger" plain size="small" @click="cancelSchedule(index)">取消计划</el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="SHARING">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Clock /></el-icon><span>分时租车</span></span>
        </template>
        <div class="p-6 text-sm text-gray-400">分时租车本期暂不开发，仅保留原型页签位置。</div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="scheduleDialogVisible" title="新增门市调价计划" width="700px" destroy-on-close>
      <div class="bg-orange-50 p-3 rounded-lg border border-orange-100 flex items-start gap-2 mb-4">
        <el-icon class="text-orange-500 mt-0.5"><WarningFilled /></el-icon>
        <div class="text-xs text-orange-800 leading-relaxed">到达设定的<b>生效时间</b>时，系统将自动更新价格。请确保时间准确。</div>
      </div>
      <el-form label-position="top">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="生效时间" required>
              <el-date-picker v-model="scheduleForm.effectiveTime" type="datetime" placeholder="请选择生效时间" format="YYYY-MM-DD HH:mm" value-format="YYYY-MM-DD HH:mm:ss" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="计划摘要" required>
              <el-input v-model="scheduleForm.summary" placeholder="例如：五一假期涨价" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div class="mt-2">
        <div class="flex items-center justify-between mb-2">
          <span class="font-bold text-gray-700 text-sm">价格配置预览</span>
          <el-button size="small" type="primary" link @click="batchSetNewPrice">
            <el-icon class="mr-1"><ArrowUp /></el-icon>
            批量上调 10%
          </el-button>
        </div>
        <el-table :data="scheduleForm.prices" height="300" border size="small" stripe>
          <el-table-column prop="name" label="车组名称" min-width="160" />
          <el-table-column label="当前价格" width="100" align="right">
            <template #default="{ row }"><span class="text-gray-500">{{ row.currentPrice }}</span></template>
          </el-table-column>
          <el-table-column label="生效后新价格" width="160" align="center">
            <template #default="{ row }">
              <div class="flex items-center justify-center gap-2">
                <el-input-number v-model="row.newPrice" :min="0" :step="10" size="small" style="width: 100px" controls-position="right" />
                <el-icon v-if="row.newPrice !== row.currentPrice" class="text-orange-500"><EditPen /></el-icon>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="scheduleDialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!scheduleForm.effectiveTime" @click="confirmSchedule">确认创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="viewDialogVisible" title="门市调价计划详情" width="600px">
      <div v-if="currentViewPlan" class="space-y-4">
        <div class="bg-gray-50 p-4 rounded-lg border border-gray-100 grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-gray-400 mb-1">计划状态</div>
            <el-tag :type="getStatusType(currentViewPlan.status)">{{ currentViewPlan.status }}</el-tag>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">生效时间</div>
            <div class="font-bold text-gray-800">{{ currentViewPlan.effectiveTime }}</div>
          </div>
          <div class="col-span-2">
            <div class="text-xs text-gray-400 mb-1">计划摘要</div>
            <div class="text-sm text-gray-600">{{ currentViewPlan.summary }}</div>
          </div>
        </div>
        <div>
          <div class="font-bold text-gray-700 text-sm mb-2">价格调整明细</div>
          <el-table :data="currentViewPlan.changes" height="300" border size="small" stripe>
            <el-table-column prop="name" label="车组名称" min-width="160" />
            <el-table-column label="原价格" width="100" align="right">
              <template #default="{ row }">{{ row.currentPrice }}</template>
            </el-table-column>
            <el-table-column label="新价格" width="120" align="center">
              <template #default="{ row }"><span class="font-bold text-orange-600">{{ row.newPrice }}</span></template>
            </el-table-column>
            <el-table-column label="变动" width="100" align="center">
              <template #default="{ row }"><span :class="getDiffClass(row)">{{ getDiffText(row) }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </el-dialog>

    <el-dialog v-model="priceVersionDialogVisible" title="门市标准价历史版本" width="860px" destroy-on-close>
      <div class="grid grid-cols-3 gap-4">
        <div class="col-span-1 border border-gray-100 rounded-lg overflow-hidden">
          <div class="px-3 py-2 bg-gray-50 text-xs font-bold text-gray-500">版本列表</div>
          <div class="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
            <button
              v-for="version in storePriceVersions"
              :key="version.version"
              class="w-full text-left px-3 py-3 hover:bg-indigo-50 transition-colors"
              :class="selectedPriceVersion === version.version ? 'bg-indigo-50' : 'bg-white'"
              @click="selectedPriceVersion = version.version"
            >
              <div class="font-mono text-xs text-indigo-600 font-bold">{{ version.version }}</div>
              <div class="text-sm text-gray-800 mt-1">{{ version.title }}</div>
              <div class="text-xs text-gray-400 mt-1">{{ version.savedAt }} · {{ version.sourceText }}</div>
            </button>
          </div>
        </div>
        <div class="col-span-2 space-y-4">
          <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3">
            <div class="font-mono font-bold text-gray-900">{{ selectedPriceVersion }}</div>
            <div class="text-sm text-gray-700 mt-1">门市标准价历史版本</div>
            <div class="text-xs text-gray-500 mt-1">订单创建时会保存命中的价格版本。</div>
          </div>
          <el-table :data="storePriceVersions.find((item) => item.version === selectedPriceVersion)?.values ?? []" border size="small">
            <el-table-column label="车组名称" min-width="170">
              <template #default="{ row }">
                <div class="font-bold text-gray-800">{{ row.group }}</div>
                <div class="text-xs text-gray-500 mt-1">{{ row.models }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="dailyPrice" label="标准日租金 (元/天)" width="150" align="center" />
            <el-table-column prop="mileage" label="里程规则" min-width="220" />
            <el-table-column prop="lastUpdated" label="上次更新" width="110" align="center" />
          </el-table>
        </div>
      </div>
      <template #footer>
        <el-button @click="priceVersionDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
