<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { TboxDeviceSummary, VehicleInstanceSummary } from "@rimo/shared";
import { listTboxDevices, listVehicles } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const rows = ref<VehicleInstanceSummary[]>([]);
const tboxDevices = ref<TboxDeviceSummary[]>([]);
const filters = reactive({
  keyword: "",
  station: "",
  operationStatus: "",
  serviceType: ""
});

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
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">车辆总数</div>
        <div class="text-2xl font-bold text-gray-800 mt-1">{{ metrics.total }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">空闲可派</div>
        <div class="text-2xl font-bold text-emerald-600 mt-1">{{ metrics.idle }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">预约/租赁中</div>
        <div class="text-2xl font-bold text-blue-600 mt-1">{{ metrics.occupied }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">整备/异常</div>
        <div class="text-2xl font-bold text-amber-600 mt-1">{{ metrics.exception }}</div>
      </div>
    </div>

    <div class="rimo-card p-5">
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
        <div class="ml-auto text-sm text-gray-500">共 {{ filteredRows.length }} 台</div>
      </div>

      <el-table :data="filteredRows" :loading="loading" border stripe>
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
