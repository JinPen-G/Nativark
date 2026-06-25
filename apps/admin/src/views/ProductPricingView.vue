<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, reactive, ref } from "vue";
import AppLayout from "../components/AppLayout.vue";
import { vehicleGroups } from "../data/prototypeSeed";

interface ProductGroup {
  id: string;
  name: string;
  aliasName: string;
  dailyPrice: number;
  isUnifiedMileage: boolean;
  mileageRule: {
    freeKm: number;
    pricePerKm: number;
    dailyCap: number;
  };
  isSpecial: boolean;
  specialMembershipRequired?: string;
  models: Array<{
    modelId: string;
    mileageRule: {
      freeKm: number;
      pricePerKm: number;
      dailyCap: number;
    };
  }>;
}

const activeTab = ref("STORE");
const dialogVisible = ref(false);
const showModelSelector = ref(false);
const productVersionDialogVisible = ref(false);
const modelSearch = ref("");
const isEdit = ref(false);

const storeGroups = ref<ProductGroup[]>(
  vehicleGroups.map((group) => ({
    id: group.id,
    name: group.name,
    aliasName: group.aliasName,
    dailyPrice: group.dailyPrice,
    isUnifiedMileage: true,
    mileageRule: {
      freeKm: group.freeKm,
      pricePerKm: group.pricePerKm,
      dailyCap: group.dailyCap
    },
    isSpecial: group.id === "EV",
    specialMembershipRequired: group.id === "EV" ? "GOLD" : undefined,
    models: group.modelList.map((model) => ({
      modelId: model,
      mileageRule: {
        freeKm: group.freeKm,
        pricePerKm: group.pricePerKm,
        dailyCap: group.dailyCap
      }
    }))
  }))
);

const currentGroup = reactive<ProductGroup>({
  id: "",
  name: "",
  aliasName: "",
  dailyPrice: 0,
  isUnifiedMileage: true,
  mileageRule: {
    freeKm: 300,
    pricePerKm: 1.5,
    dailyCap: 0
  },
  isSpecial: false,
  models: []
});

const availableModels = [
  "Honda Fit 1.5",
  "Toyota Yaris 1.5",
  "Toyota Noah 2.0",
  "Honda Stepwgn 1.5T",
  "Tesla Model 3",
  "BYD Seal"
];

const filteredModels = computed(() =>
  availableModels.filter((model) => model.toLowerCase().includes(modelSearch.value.toLowerCase()))
);

function resetCurrentGroup() {
  Object.assign(currentGroup, {
    id: "",
    name: "",
    aliasName: "",
    dailyPrice: 0,
    isUnifiedMileage: true,
    mileageRule: {
      freeKm: 300,
      pricePerKm: 1.5,
      dailyCap: 0
    },
    isSpecial: false,
    specialMembershipRequired: undefined,
    models: []
  });
}

function openDialog() {
  resetCurrentGroup();
  isEdit.value = false;
  dialogVisible.value = true;
}

function openEdit(group: ProductGroup) {
  Object.assign(currentGroup, structuredClone(group));
  isEdit.value = true;
  dialogVisible.value = true;
}

function saveGroup() {
  if (!currentGroup.name.trim()) {
    ElMessage.warning("请输入产品组名称");
    return;
  }

  if (isEdit.value) {
    const index = storeGroups.value.findIndex((item) => item.id === currentGroup.id);
    if (index >= 0) {
      storeGroups.value[index] = structuredClone(currentGroup);
    }
  } else {
    storeGroups.value.push({
      ...structuredClone(currentGroup),
      id: `GROUP-${String(storeGroups.value.length + 1).padStart(3, "0")}`
    });
  }

  dialogVisible.value = false;
  ElMessage.success("产品组配置已保存，后续订单将写入产品组快照。");
}

function deleteGroup(group: ProductGroup) {
  storeGroups.value = storeGroups.value.filter((item) => item.id !== group.id);
  ElMessage.success(`已删除 ${group.name}`);
}

function addModel(modelId: string) {
  if (currentGroup.models.some((model) => model.modelId === modelId)) {
    return;
  }

  currentGroup.models.push({
    modelId,
    mileageRule: structuredClone(currentGroup.mileageRule)
  });
}

function removeModel(index: number) {
  currentGroup.models.splice(index, 1);
}

function openProductVersion() {
  productVersionDialogVisible.value = true;
}
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">基础产品定价</h1>
        <p class="text-gray-500 text-sm mt-1">定义不同服务类型下的车辆产品组，设置定价策略和里程费规则。</p>
      </div>
    </div>

    <el-tabs
      v-model="activeTab"
      class="service-product-tabs sr-page-tabs bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]"
    >
      <el-tab-pane name="SHARING">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Clock /></el-icon><span>分时租车</span></span>
        </template>
        <div class="p-6">
          <div class="text-sm text-gray-500 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center">
            分时租车本期暂不开发，仅保留原型页签位置。
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane name="STORE">
        <template #label>
          <span class="flex items-center gap-2"><el-icon><Shop /></el-icon><span>门市租赁</span></span>
        </template>
        <div class="p-6">
          <div class="flex justify-between items-center mb-6">
            <div class="text-sm text-gray-500">
              <span class="font-bold text-gray-700">说明：</span>
              门市租赁模式下，车组统一标准价基于<span class="text-blue-600 font-bold">产品组层级</span>设定且不区分平假日；里程费支持<span class="text-blue-600 font-bold">统一策略或按款型独立设定</span>。
            </div>
            <div class="flex items-center gap-2">
              <el-button plain @click="openProductVersion">历史版本</el-button>
              <el-button type="primary" size="large" class="shadow-md shadow-indigo-500/20" color="#00689E" @click="openDialog">
                <el-icon class="mr-1"><Plus /></el-icon>
                新增产品组
              </el-button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            <div
              v-for="group in storeGroups"
              :key="group.id"
              class="border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all bg-white flex flex-col h-full group"
            >
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h3 class="font-bold text-lg text-gray-800">
                    {{ group.name }}
                    <span class="ml-2 text-sm text-gray-400 font-normal tracking-wide">{{ group.aliasName }}</span>
                  </h3>
                  <div class="text-xs text-gray-400 mt-1">ID: {{ group.id }}</div>
                  <div class="text-xs text-indigo-500 mt-1 cursor-pointer underline decoration-dotted" @click="openProductVersion">
                    标准价版本：PRICE-{{ group.id }}-20260418
                  </div>
                </div>
                <div class="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded font-medium">门市</div>
              </div>

              <div class="flex-1 space-y-4">
                <div class="flex justify-between items-center py-2 border-b border-gray-50">
                  <span class="text-gray-500 text-sm">统一标准价</span>
                  <span class="font-bold text-slate-800">¥{{ group.dailyPrice }}<span class="text-xs text-gray-400 font-normal">/天</span></span>
                </div>

                <div v-if="group.isUnifiedMileage" class="bg-slate-50/80 rounded-lg px-3 py-2 border border-slate-100">
                  <div class="text-xs font-bold text-slate-600 mb-1.5 uppercase flex items-center">
                    <el-icon class="mr-1"><Odometer /></el-icon>
                    统一里程费规则
                  </div>
                  <div class="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div class="text-slate-400">免费里程</div>
                      <div class="font-mono font-medium text-gray-700">{{ group.mileageRule.freeKm }} km</div>
                    </div>
                    <div>
                      <div class="text-slate-400">超程单价</div>
                      <div class="font-mono font-medium text-gray-700">¥{{ group.mileageRule.pricePerKm }}/km</div>
                    </div>
                    <div>
                      <div class="text-slate-400">封顶</div>
                      <div class="font-mono font-medium text-gray-700">{{ group.mileageRule.dailyCap > 0 ? "¥" + group.mileageRule.dailyCap : "不限" }}</div>
                    </div>
                  </div>
                </div>
                <div v-else class="bg-slate-50/80 rounded-lg p-3 border border-slate-100">
                  <div class="text-xs font-bold text-slate-600 mb-2 uppercase flex items-center">
                    <el-icon class="mr-1"><Odometer /></el-icon>
                    个性化里程费
                  </div>
                  <div class="text-xs text-gray-500">已为 {{ group.models.length }} 款车型单独配置</div>
                </div>

                <div class="text-xs text-gray-500">
                  <span class="font-bold">包含 {{ group.models.length }} 款车型: </span>
                  <span class="truncate block mt-1">{{ group.models.map((model) => model.modelId).join(", ") || "暂无车型" }}</span>
                </div>
              </div>

              <div class="mt-5 flex gap-2 border-t border-gray-100 pt-4">
                <el-button class="flex-1" type="primary" plain size="small" @click="openEdit(group)">配置详情</el-button>
                <el-button type="danger" plain size="small" icon="Delete" circle @click="deleteGroup(group)" />
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="dialogVisible" :title="(isEdit ? '编辑' : '新增') + '门市租赁产品组'" width="960px">
      <el-form :model="currentGroup" label-position="top">
        <div class="grid grid-cols-2 gap-6">
          <div class="col-span-2 md:col-span-1">
            <el-form-item label="产品组名称" required>
              <el-input v-model="currentGroup.name" placeholder="例如: 经济型, 豪华型" />
            </el-form-item>
          </div>
          <div class="col-span-2 md:col-span-1">
            <el-form-item label="产品组别名 (如英文名)">
              <el-input v-model="currentGroup.aliasName" placeholder="例如: Economy, Luxury" />
            </el-form-item>
          </div>
          <div class="col-span-2 md:col-span-1">
            <el-form-item label="车组标准价 (元/天)" required>
              <el-input-number v-model="currentGroup.dailyPrice" :min="0" :step="10" class="w-full" />
            </el-form-item>
          </div>
        </div>

        <div class="mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div class="flex justify-between items-center mb-4">
            <div class="font-bold text-gray-800 flex items-center">
              <el-icon class="mr-1"><Odometer /></el-icon>
              里程费规则
            </div>
            <el-switch
              v-model="currentGroup.isUnifiedMileage"
              active-text="统一配置 (所有车型使用相同规则)"
              inactive-text="单独配置 (按车型分别设置)"
            />
          </div>
          <div v-if="currentGroup.isUnifiedMileage" class="grid grid-cols-3 gap-4">
            <el-form-item label="每日免费里程 (km)">
              <el-input-number v-model="currentGroup.mileageRule.freeKm" :min="0" :step="100" class="w-full" />
            </el-form-item>
            <el-form-item label="超程单价 (元/km)">
              <el-input-number v-model="currentGroup.mileageRule.pricePerKm" :min="0" :step="0.5" :precision="1" class="w-full" />
            </el-form-item>
            <el-form-item label="每日封顶金额 (元)">
              <el-input-number v-model="currentGroup.mileageRule.dailyCap" :min="0" :step="10" placeholder="0为不限" class="w-full" />
              <div class="text-xs text-gray-400 mt-1">设为 0 表示不封顶</div>
            </el-form-item>
          </div>
          <div v-else class="text-sm text-gray-500 italic">请在下方关联车型列表中，为每个车型单独设置里程费规则。</div>
        </div>

        <div class="mt-4 bg-yellow-50 p-4 rounded-lg border border-yellow-100">
          <div class="font-bold text-gray-800 mb-3 flex items-center">
            <el-icon class="mr-1 text-yellow-600"><Lock /></el-icon>
            特殊车辆管控
            <el-tag v-if="!isEdit" size="small" type="warning" effect="plain" class="ml-2">开发中</el-tag>
          </div>
          <div class="flex items-center">
            <el-checkbox v-model="currentGroup.isSpecial" class="mr-4" :disabled="!isEdit">标记为特殊产品组</el-checkbox>
            <div v-if="currentGroup.isSpecial" class="flex items-center">
              <span class="text-sm text-gray-600 mr-2">限制会员等级:</span>
              <el-select v-model="currentGroup.specialMembershipRequired" placeholder="请选择最低会员等级" :disabled="!isEdit" size="small" class="w-48">
                <el-option label="白银会员及以上" value="SILVER" />
                <el-option label="黄金会员及以上" value="GOLD" />
                <el-option label="黑钻会员及以上" value="DIAMOND" />
              </el-select>
            </div>
          </div>
          <div v-if="!isEdit" class="mt-3 flex items-center text-sm text-amber-700 bg-amber-100/70 border border-amber-200 rounded-lg px-3 py-2">
            <el-icon class="mr-2"><WarningFilled /></el-icon>
            功能开发中，暂不支持在新增产品时配置特殊车辆管控。
          </div>
          <div class="text-xs text-gray-500 mt-2">开启后，该产品组下的所有车辆将被视为特殊车辆，仅允许满足条件的会员预订。</div>
        </div>

        <div class="mt-6">
          <div class="flex justify-between items-center mb-2">
            <div class="font-bold text-gray-700">关联车型款型</div>
            <el-button type="primary" link icon="Plus" @click="showModelSelector = true">添加车型</el-button>
          </div>
          <div class="border border-gray-200 rounded-lg overflow-hidden">
            <el-table :data="currentGroup.models" style="width: 100%" max-height="300">
              <el-table-column label="车型款型" min-width="180">
                <template #default="{ row }">
                  <div class="font-bold text-sm">{{ row.modelId }}</div>
                </template>
              </el-table-column>
              <el-table-column v-if="!currentGroup.isUnifiedMileage" label="里程费配置 (特定款型)" min-width="350">
                <template #default="{ row }">
                  <div class="flex gap-2 items-center">
                    <div class="flex flex-col flex-1">
                      <span class="text-[10px] text-gray-400">免费里程</span>
                      <el-input-number v-model="row.mileageRule.freeKm" :min="0" size="small" :controls="false" class="!w-full" />
                    </div>
                    <div class="flex flex-col flex-1">
                      <span class="text-[10px] text-gray-400">单价(元/km)</span>
                      <el-input-number v-model="row.mileageRule.pricePerKm" :min="0" :step="0.1" :precision="1" size="small" :controls="false" class="!w-full" />
                    </div>
                    <div class="flex flex-col flex-1">
                      <span class="text-[10px] text-gray-400">封顶(元)</span>
                      <el-input-number v-model="row.mileageRule.dailyCap" :min="0" size="small" :controls="false" class="!w-full" />
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="60" align="center">
                <template #default="{ $index }">
                  <el-button type="danger" link icon="Close" @click="removeModel($index)" />
                </template>
              </el-table-column>
            </el-table>
            <div v-if="currentGroup.models.length === 0" class="py-8 text-center text-gray-400 text-sm bg-gray-50">
              暂未关联任何车型，点击右上角添加
            </div>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="saveGroup">保存配置</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showModelSelector" title="选择车型款型" width="500px">
      <el-input v-model="modelSearch" placeholder="搜索品牌或型号..." prefix-icon="Search" class="mb-4" />
      <div class="space-y-2">
        <button
          v-for="model in filteredModels"
          :key="model"
          class="w-full text-left rounded-lg border border-gray-100 px-4 py-3 hover:border-indigo-200 hover:bg-indigo-50"
          @click="addModel(model)"
        >
          {{ model }}
        </button>
      </div>
      <template #footer>
        <el-button @click="showModelSelector = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="productVersionDialogVisible" title="产品组历史版本" width="860px" destroy-on-close>
      <div class="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 mb-4">
        <div class="font-mono font-bold text-gray-900">PRODUCT-STORE-20260418-001</div>
        <div class="text-sm text-gray-700 mt-1">门市租赁产品组标准价与里程费基线</div>
        <div class="text-xs text-gray-500 mt-1">保存人：平台管理员 · 2026-04-18 10:30</div>
      </div>
      <el-table :data="storeGroups" border size="small">
        <el-table-column prop="name" label="产品组" min-width="160" />
        <el-table-column prop="dailyPrice" label="标准日租金" width="130" align="center" />
        <el-table-column label="里程规则" min-width="220">
          <template #default="{ row }">
            免费 {{ row.mileageRule.freeKm }} km / 超程 ¥{{ row.mileageRule.pricePerKm }}/km
          </template>
        </el-table-column>
        <el-table-column label="车型数量" width="100" align="center">
          <template #default="{ row }">{{ row.models.length }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="productVersionDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
