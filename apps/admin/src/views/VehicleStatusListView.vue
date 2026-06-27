<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { TboxDeviceSummary, VehicleInstanceSummary, VehicleCredentialRecord, VehicleOnboardItemRecord } from "@store-rental/shared";
import { listTboxDevices, listVehicles, updateVehicleStatus, listVehicleCredentials, listVehicleOnboardItems } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const rows = ref<VehicleInstanceSummary[]>([]);
const tboxDevices = ref<TboxDeviceSummary[]>([]);
const selectedVehicles = ref<VehicleInstanceSummary[]>([]);
const filters = reactive({
  keyword: "",
  station: "",
  operationStatus: "",
  serviceType: ""
});
const credentialCache = ref<Record<string, VehicleCredentialRecord[]>>({});
const onboardCache = ref<Record<string, VehicleOnboardItemRecord[]>>({});

async function handleExpandChange(row: VehicleInstanceSummary, expanded: boolean) {
  if (!expanded) return;
  if (credentialCache.value[row.id]) return;
  try {
    const [creds, items] = await Promise.all([
      listVehicleCredentials(row.id),
      listVehicleOnboardItems(row.id)
    ]);
    credentialCache.value[row.id] = creds;
    onboardCache.value[row.id] = items;
  } catch {
    ElMessage.error("加载证照/物资数据失败");
  }
}

function credentialTypeLabel(type: string) {
  const map: Record<string, string> = { license: "行驶/登记证", insurance: "保险", inspection: "年检", permit: "营运许可", other: "其他" };
  return map[type] || type;
}
function credentialStatusLabel(status: string) {
  const map: Record<string, string> = { valid: "有效", expiring: "即将到期", expired: "已到期", missing: "缺失" };
  return map[status] || status;
}
function credentialStatusType(status: string) {
  return status === "valid" ? "success" : status === "expiring" ? "warning" : "danger";
}
function isCredentialExpired(status: string) {
  return status === "expired" || status === "missing";
}
function onboardItemCategoryLabel(category: string) {
  const map: Record<string, string> = { key: "钥匙/卡片", document: "随车文件", equipment: "随车工具", cleaning: "清洁整备", other: "其他" };
  return map[category] || category;
}
function onboardItemStatusLabel(status: string) {
  const map: Record<string, string> = { normal: "正常", missing: "缺失", damaged: "损坏" };
  return map[status] || status;
}
function onboardItemStatusType(status: string) {
  return status === "normal" ? "success" : status === "missing" ? "danger" : "warning";
}

function handleSelectionChange(selection: VehicleInstanceSummary[]) {
  selectedVehicles.value = selection;
}

async function batchSetMaintenance() {
  if (selectedVehicles.value.length === 0) {
    ElMessage.warning("请先选择要操作的车辆");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认将 ${selectedVehicles.value.length} 台车辆设置为维保状态？`,
      "批量维保确认",
      { type: "warning" }
    );
    for (const vehicle of selectedVehicles.value) {
      await updateVehicleStatus(vehicle.id, {
        operationStatus: "maintenance",
        reason: "批量维保操作",
        operator: "营运端"
      });
    }
    ElMessage.success(`已将 ${selectedVehicles.value.length} 台车辆设置为维保状态`);
    selectedVehicles.value = [];
    await loadData();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error("批量维保操作失败");
    }
  }
}

async function batchSetDisabled() {
  if (selectedVehicles.value.length === 0) {
    ElMessage.warning("请先选择要操作的车辆");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认将 ${selectedVehicles.value.length} 台车辆设置为停用状态？`,
      "批量停用确认",
      { type: "warning" }
    );
    for (const vehicle of selectedVehicles.value) {
      await updateVehicleStatus(vehicle.id, {
        operationStatus: "disabled",
        reason: "批量停用操作",
        operator: "营运端"
      });
    }
    ElMessage.success(`已将 ${selectedVehicles.value.length} 台车辆设置为停用状态`);
    selectedVehicles.value = [];
    await loadData();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error("批量停用操作失败");
    }
  }
}

async function batchSetIdle() {
  if (selectedVehicles.value.length === 0) {
    ElMessage.warning("请先选择要操作的车辆");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认将 ${selectedVehicles.value.length} 台车辆设置为空闲状态？`,
      "批量启用确认",
      { type: "warning" }
    );
    for (const vehicle of selectedVehicles.value) {
      await updateVehicleStatus(vehicle.id, {
        operationStatus: "idle",
        reason: "批量启用操作",
        operator: "营运端"
      });
    }
    ElMessage.success(`已将 ${selectedVehicles.value.length} 台车辆设置为空闲状态`);
    selectedVehicles.value = [];
    await loadData();
  } catch (error) {
    if (error !== "cancel") {
      ElMessage.error("批量启用操作失败");
    }
  }
}

const stationOptions = computed(() =>
  Array.from(new Set(rows.value.map((row) => row.currentStationName))).filter(Boolean)
);
const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const keyword = filters.keyword.trim().toLowerCase();
    return (
      (!keyword ||
        row.licensePlate.toLowerCase().includes(keyword) ||
        row.vehicleGroupName.toLowerCase().includes(keyword) ||
        (row.cid ?? "").toLowerCase().includes(keyword)) &&
      (!filters.station || row.currentStationName === filters.station) &&
      (!filters.operationStatus || row.operationStatus === filters.operationStatus) &&
      (!filters.serviceType || row.currentServiceType === filters.serviceType)
    );
  })
);
const metrics = computed(() => ({
  total: rows.value.length,
  idle: rows.value.filter((row) => row.operationStatus === "idle").length,
  occupied: rows.value.filter((row) => ["reserved", "renting"].includes(row.operationStatus)).length,
  exception: rows.value.filter((row) => ["controlled", "maintenance", "disabled"].includes(row.operationStatus)).length
}));

async function loadData() {
  loading.value = true;
  try {
    const [vehicles, devices] = await Promise.all([listVehicles(), listTboxDevices()]);
    rows.value = vehicles;
    tboxDevices.value = devices;
  } finally {
    loading.value = false;
  }
}

function deviceOf(row: VehicleInstanceSummary) {
  return tboxDevices.value.find(
    (device) => device.boundVehicleId === row.id || device.cid === row.cid
  );
}

function operationStatusName(status: VehicleInstanceSummary["operationStatus"]) {
  const map = {
    idle: "空闲",
    reserved: "已预约",
    renting: "租赁中",
    controlled: "整备中",
    maintenance: "维保",
    disabled: "停用"
  };
  return map[status];
}

function statusTagType(status: VehicleInstanceSummary["operationStatus"]) {
  if (status === "idle") return "success";
  if (status === "controlled" || status === "maintenance") return "warning";
  if (status === "disabled") return "info";
  return "primary";
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车辆速查表</h1>
        <p class="text-gray-500 text-sm mt-1">全局查询车辆实时运行工况、调度定位与当前订单分配。</p>
      </div>
      <el-button type="primary" plain @click="loadData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
    </div>

    <div class="grid grid-cols-12 gap-4 mb-5">
      <div class="sr-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">车辆总数</div>
        <div class="text-2xl font-bold text-gray-800 mt-1">{{ metrics.total }}</div>
      </div>
      <div class="sr-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">空闲可派</div>
        <div class="text-2xl font-bold text-emerald-600 mt-1">{{ metrics.idle }}</div>
      </div>
      <div class="sr-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">预约/租赁中</div>
        <div class="text-2xl font-bold text-blue-600 mt-1">{{ metrics.occupied }}</div>
      </div>
      <div class="sr-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">整备/异常</div>
        <div class="text-2xl font-bold text-amber-600 mt-1">{{ metrics.exception }}</div>
      </div>
    </div>

    <div class="sr-card p-5">
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <el-input v-model="filters.keyword" placeholder="车牌/CID/车型组" clearable prefix-icon="Search" style="width: 240px" />
        <el-select v-model="filters.station" placeholder="据点/门店" clearable style="width: 180px">
          <el-option v-for="station in stationOptions" :key="station" :label="station" :value="station" />
        </el-select>
        <el-select v-model="filters.operationStatus" placeholder="车辆状态" clearable style="width: 150px">
          <el-option label="空闲" value="idle" />
          <el-option label="已预约" value="reserved" />
          <el-option label="租赁中" value="renting" />
          <el-option label="整备中" value="controlled" />
          <el-option label="维保" value="maintenance" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-select v-model="filters.serviceType" placeholder="服务类型" clearable style="width: 160px">
          <el-option label="门市租赁" value="STORE_STANDARD" />
          <el-option label="24小时自助" value="STORE_24H" />
        </el-select>
        <div class="ml-auto flex items-center gap-3">
        <div v-if="selectedVehicles.length > 0" class="flex items-center gap-2">
          <el-tag type="info" effect="plain">已选 {{ selectedVehicles.length }} 台</el-tag>
          <el-button size="small" type="warning" plain @click="batchSetMaintenance">批量维保</el-button>
          <el-button size="small" type="danger" plain @click="batchSetDisabled">批量停用</el-button>
          <el-button size="small" type="success" plain @click="batchSetIdle">批量启用</el-button>
        </div>
        <div class="text-sm text-gray-500">共 {{ filteredRows.length }} 台</div>
      </div>
      </div>

      <el-table :data="filteredRows" :loading="loading" border stripe @selection-change="handleSelectionChange" @expand-change="handleExpandChange">
        <el-table-column type="selection" width="50" />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="p-4 grid grid-cols-2 gap-6" style="background: #fafbfc;">
              <div>
                <h4 class="text-sm font-bold text-gray-700 mb-2">车辆证照</h4>
                <el-table :data="credentialCache[row.id] ?? []" size="small" border empty-text="暂无证照记录" :row-class-name="(scope: any) => isCredentialExpired(scope.row.status) ? 'credential-expired-row' : ''">
                  <el-table-column label="证照类型" width="110">
                    <template #default="{ row: r }">{{ credentialTypeLabel(r.credentialType) }}</template>
                  </el-table-column>
                  <el-table-column prop="credentialName" label="证照名称" min-width="120" />
                  <el-table-column prop="certNo" label="证件编号" min-width="120" />
                  <el-table-column label="状态" width="100">
                    <template #default="{ row: r }">
                      <el-tag :type="credentialStatusType(r.status)" effect="plain">{{ credentialStatusLabel(r.status) }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="到期日" width="120">
                    <template #default="{ row: r }">
                      <span :class="{ 'text-red-600 font-bold': isCredentialExpired(r.status) }">{{ r.expiresAt?.slice(0, 10) ?? "-" }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div>
                <h4 class="text-sm font-bold text-gray-700 mb-2">随车物资</h4>
                <el-table :data="onboardCache[row.id] ?? []" size="small" border empty-text="暂无随车物资">
                  <el-table-column label="类别" width="100">
                    <template #default="{ row: r }">{{ onboardItemCategoryLabel(r.category) }}</template>
                  </el-table-column>
                  <el-table-column prop="itemName" label="物资名称" min-width="120" />
                  <el-table-column label="数量" width="80">
                    <template #default="{ row: r }">{{ r.actualQuantity }} / {{ r.standardQuantity }}</template>
                  </el-table-column>
                  <el-table-column label="状态" width="80">
                    <template #default="{ row: r }">
                      <el-tag :type="onboardItemStatusType(r.status)" effect="plain">{{ onboardItemStatusLabel(r.status) }}</el-tag>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="车辆基础信息" align="center">
          <el-table-column label="车牌 / 车型组" min-width="220">
            <template #default="{ row }">
              <div class="font-bold text-gray-800">{{ row.licensePlate }}</div>
              <div class="text-xs text-gray-500 mt-1">{{ row.vehicleGroupName }}</div>
            </template>
          </el-table-column>
          <el-table-column label="所属车行/据点" width="210">
            <template #default="{ row }">
              <div>{{ row.currentStoreName }}</div>
              <div class="text-xs text-gray-500 mt-1">{{ row.currentStationName }}</div>
            </template>
          </el-table-column>
          <el-table-column label="里程" width="100" prop="mileage" />
        </el-table-column>
        <el-table-column label="营运状态" align="center">
          <el-table-column label="车辆状态" width="130">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.operationStatus)" effect="plain">
                {{ operationStatusName(row.operationStatus) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="服务类型" width="130">
            <template #default="{ row }">
              {{ row.currentServiceType === "STORE_24H" ? "24小时自助" : "门市租赁" }}
            </template>
          </el-table-column>
        </el-table-column>
        <el-table-column label="车机状态" align="center">
          <el-table-column label="CID" width="150">
            <template #default="{ row }">{{ row.cid || "未绑定" }}</template>
          </el-table-column>
          <el-table-column label="在线" width="110">
            <template #default="{ row }">
              <el-tag :type="deviceOf(row)?.onlineStatus === 'online' ? 'success' : 'info'" effect="plain">
                {{ deviceOf(row)?.onlineStatus || "unknown" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="信号/电量" width="130">
            <template #default="{ row }">
              {{ deviceOf(row)?.signalStrength ?? "-" }} / {{ deviceOf(row)?.batteryLevel ?? "-" }}
            </template>
          </el-table-column>
        </el-table-column>
      </el-table>
    </div>
  </AppLayout>
</template>

<style scoped>
:deep(.credential-expired-row) {
  background-color: #fef2f2 !important;
}
:deep(.credential-expired-row:hover > td) {
  background-color: #fee2e2 !important;
}
</style>
