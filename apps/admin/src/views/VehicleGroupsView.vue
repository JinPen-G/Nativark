<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { VehicleGroupMaster } from "@rimo/shared";
import {
  deleteVehicleGroup as removeVehicleGroup,
  listVehicleGroups,
  saveVehicleGroup as persistVehicleGroup
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { vehicleGroupMasters } from "../data/prototypeSeed";

const searchQuery = ref("");
const dialogVisible = ref(false);
const isEdit = ref(false);
const rows = ref<VehicleGroupMaster[]>(structuredClone(vehicleGroupMasters));
const featureInput = ref("");

const currentGroup = reactive<VehicleGroupMaster>({
  id: "",
  vehicleType: "汽车",
  brand: "",
  model: "",
  year: "",
  originType: "自有",
  seats: 5,
  displacement: "",
  trunkCapacity: "",
  features: [],
  storeProductGroupName: "",
  dailyPrice: 0,
  freeKm: 300,
  pricePerKm: 1.5,
  status: "enabled",
  isSpecial: false,
  minMemberLevel: "",
  versionNote: ""
});

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const keyword = searchQuery.value.trim().toLowerCase();
    return !keyword || `${row.brand} ${row.model} ${row.storeProductGroupName}`.toLowerCase().includes(keyword);
  })
);

async function loadRows() {
  try {
    rows.value = await listVehicleGroups();
  } catch {
    rows.value = structuredClone(vehicleGroupMasters);
  }
}

function openCreate() {
  isEdit.value = false;
  Object.assign(currentGroup, {
    id: "",
    vehicleType: "汽车",
    brand: "",
    model: "",
    year: "",
    originType: "自有",
    seats: 5,
    displacement: "",
    trunkCapacity: "",
    features: [],
    storeProductGroupName: "",
    dailyPrice: 0,
    freeKm: 300,
    pricePerKm: 1.5,
    status: "enabled",
    isSpecial: false,
    minMemberLevel: "",
    versionNote: ""
  });
  featureInput.value = "";
  dialogVisible.value = true;
}

function openEdit(row: VehicleGroupMaster) {
  isEdit.value = true;
  Object.assign(currentGroup, structuredClone(row));
  featureInput.value = row.features.join(",");
  dialogVisible.value = true;
}

function parseFeatures() {
  currentGroup.features = featureInput.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveGroup() {
  parseFeatures();
  if (!currentGroup.brand || !currentGroup.model || !currentGroup.storeProductGroupName) {
    ElMessage.warning("请填写品牌、型号并关联门市产品组");
    return;
  }
  if (currentGroup.dailyPrice <= 0) {
    ElMessage.warning("车组标准价必须大于 0");
    return;
  }
  if (currentGroup.freeKm < 0 || currentGroup.pricePerKm < 0) {
    ElMessage.warning("免费里程和超程单价不能为负数");
    return;
  }

  let savedGroup = structuredClone(currentGroup);
  try {
    savedGroup = await persistVehicleGroup(savedGroup);
  } catch {
    ElMessage.error("车型组保存失败，请检查价格、里程、重复车型和后端校验");
    return;
  }

  if (isEdit.value) {
    const index = rows.value.findIndex((row) => row.id === currentGroup.id);
    if (index >= 0) {
      rows.value[index] = savedGroup;
    }
  } else {
    rows.value.unshift(savedGroup);
  }
  dialogVisible.value = false;
  ElMessage.success("车型组已保存");
}

async function deleteGroup(row: VehicleGroupMaster) {
  try {
    await ElMessageBox.confirm(
      "删除前系统会校验是否已有车辆或订单引用。已有引用时不能删除，只能停用或保留历史版本。",
      "删除车型组",
      {
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
    await removeVehicleGroup(row.id);
    rows.value = rows.value.filter((item) => item.id !== row.id);
    ElMessage.success("车型组已删除");
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.warning("车型组删除未完成，可能已被车辆或订单引用");
    }
  }
}

onMounted(loadRows);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车型组管理</h1>
        <p class="text-gray-500 text-sm mt-1">维护车辆品牌、型号、座位、特性标签，并关联门市租赁产品组。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>
        新增车型组
      </el-button>
    </div>

    <div class="rimo-card p-5">
      <div class="flex justify-between items-center mb-5">
        <el-input v-model="searchQuery" placeholder="搜索品牌或型号..." clearable style="width: 260px" />
        <div class="text-sm text-gray-500">共 {{ filteredRows.length }} 个车型组</div>
      </div>
      <el-table :data="filteredRows" stripe style="width: 100%">
        <el-table-column label="车型图片" width="120">
          <template #default>
            <div class="w-20 h-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
              <el-icon><Van /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="品牌 / 型号" min-width="180">
          <template #default="{ row }">
            <div class="font-bold text-gray-800">{{ row.brand }} {{ row.model }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.year }} · {{ row.storeProductGroupName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="载具类型" width="100">
          <template #default="{ row }"><el-tag effect="plain">{{ row.vehicleType }}</el-tag></template>
        </el-table-column>
        <el-table-column label="门市定价" width="160" align="center">
          <template #default="{ row }">
            <div class="font-mono font-bold text-gray-800">¥{{ row.dailyPrice }}/天</div>
            <div class="text-xs text-gray-400">免费 {{ row.freeKm }} km</div>
          </template>
        </el-table-column>
        <el-table-column label="版本 / 状态" width="150" align="center">
          <template #default="{ row }">
            <div class="text-xs text-gray-500">{{ row.priceVersionId || "待生成版本" }}</div>
            <el-tag class="mt-1" :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
              {{ row.status === "enabled" ? "上架" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="特性标签" min-width="250">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-1">
              <el-tag v-for="feature in row.features" :key="feature" size="small" type="info" effect="plain">{{ feature }}</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link @click="deleteGroup(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑车型组' : '新增车型组'" width="860px">
      <el-form :model="currentGroup" label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="载具类型" required class="col-span-12 md:col-span-4">
            <el-select v-model="currentGroup.vehicleType" placeholder="请选择载具类型" class="w-full">
              <el-option label="汽车" value="汽车" />
              <el-option label="机车" value="机车" />
            </el-select>
          </el-form-item>
          <el-form-item label="品牌" required class="col-span-12 md:col-span-4">
            <el-select v-model="currentGroup.brand" placeholder="请选择品牌" filterable allow-create class="w-full">
              <el-option label="Honda" value="Honda" />
              <el-option label="Toyota" value="Toyota" />
              <el-option label="Tesla" value="Tesla" />
              <el-option label="BYD" value="BYD" />
            </el-select>
          </el-form-item>
          <el-form-item label="型号" required class="col-span-12 md:col-span-4">
            <el-input v-model="currentGroup.model" placeholder="例如: Model 3" />
          </el-form-item>
          <el-form-item label="年款" class="col-span-12 md:col-span-3">
            <el-input v-model="currentGroup.year" placeholder="例如: 2024" />
          </el-form-item>
          <el-form-item label="所属类型" class="col-span-12 md:col-span-3">
            <el-select v-model="currentGroup.originType" placeholder="请选择" class="w-full">
              <el-option label="自有" value="自有" />
              <el-option label="租赁" value="租赁" />
            </el-select>
          </el-form-item>
          <el-form-item label="座位数" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentGroup.seats" :min="1" class="w-full" />
          </el-form-item>
          <el-form-item label="排量" class="col-span-12 md:col-span-3">
            <el-input v-model="currentGroup.displacement" placeholder="例如: 2.0L / 纯电" />
          </el-form-item>
          <el-form-item label="行李箱容量 (L)" class="col-span-12 md:col-span-3">
            <el-input v-model="currentGroup.trunkCapacity" placeholder="例如: 500L" />
          </el-form-item>
          <el-form-item label="关联门市产品组" class="col-span-12 md:col-span-3">
            <el-select v-model="currentGroup.storeProductGroupName" class="w-full">
              <el-option label="经济型" value="经济型" />
              <el-option label="七人座" value="七人座" />
              <el-option label="电动车" value="电动车" />
            </el-select>
          </el-form-item>
          <el-form-item label="车组标准价 (元/天)" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentGroup.dailyPrice" :min="0" :step="10" class="w-full" />
          </el-form-item>
          <el-form-item label="免费里程 (km/天)" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentGroup.freeKm" :min="0" :step="50" class="w-full" />
          </el-form-item>
          <el-form-item label="超程单价 (元/km)" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentGroup.pricePerKm" :min="0" :step="0.5" :precision="1" class="w-full" />
          </el-form-item>
          <el-form-item label="上下架状态" class="col-span-12 md:col-span-3">
            <el-select v-model="currentGroup.status" class="w-full">
              <el-option label="上架" value="enabled" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
          <el-form-item label="特殊车辆管控" class="col-span-12 md:col-span-3">
            <el-switch v-model="currentGroup.isSpecial" active-text="开启" inactive-text="关闭" />
          </el-form-item>
          <el-form-item v-if="currentGroup.isSpecial" label="最低会员等级" class="col-span-12 md:col-span-3">
            <el-select v-model="currentGroup.minMemberLevel" class="w-full">
              <el-option label="白银会员及以上" value="SILVER" />
              <el-option label="黄金会员及以上" value="GOLD" />
              <el-option label="企业认证用户" value="CORPORATE" />
            </el-select>
          </el-form-item>
          <el-form-item label="特性标签 (逗号分隔)" class="col-span-12">
            <el-input v-model="featureInput" placeholder="例如: 自动挡,倒车影像,全景天窗" @blur="parseFeatures" />
          </el-form-item>
          <el-form-item label="变更说明" class="col-span-12">
            <el-input v-model="currentGroup.versionNote" type="textarea" :rows="2" placeholder="记录本次价格、里程或车型绑定调整原因" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="saveGroup">保存</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
