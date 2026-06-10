<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type { TboxDeviceSummary, VehicleInstanceSummary } from "@rimo/shared";
import { bindTboxDevice, listTboxDevices, listVehicles } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const dialogVisible = ref(false);
const devices = ref<TboxDeviceSummary[]>([]);
const vehicles = ref<VehicleInstanceSummary[]>([]);
const currentDevice = ref<TboxDeviceSummary | null>(null);
const keyword = ref("");
const bindForm = reactive({
  vehicleId: ""
});

const filteredDevices = computed(() =>
  devices.value.filter((device) => {
    const text = keyword.value.trim().toLowerCase();
    return (
      !text ||
      device.cid.toLowerCase().includes(text) ||
      device.provider.toLowerCase().includes(text) ||
      (device.boundPlateNo ?? "").toLowerCase().includes(text)
    );
  })
);
const bindableVehicles = computed(() =>
  vehicles.value.filter((vehicle) => vehicle.enabled && vehicle.serviceTypes.includes("STORE_24H"))
);

async function loadData() {
  loading.value = true;
  try {
    const [deviceRows, vehicleRows] = await Promise.all([
      listTboxDevices(),
      listVehicles()
    ]);
    devices.value = deviceRows;
    vehicles.value = vehicleRows;
  } finally {
    loading.value = false;
  }
}

function openBindDialog(device: TboxDeviceSummary) {
  currentDevice.value = device;
  bindForm.vehicleId = device.boundVehicleId || "";
  dialogVisible.value = true;
}

async function submitBind() {
  if (!currentDevice.value) {
    return;
  }
  const saved = await bindTboxDevice(currentDevice.value.id, {
    vehicleId: bindForm.vehicleId || undefined,
    operator: "营运端"
  });
  const index = devices.value.findIndex((item) => item.id === saved.id);
  if (index >= 0) {
    devices.value[index] = saved;
  }
  dialogVisible.value = false;
  ElMessage.success(bindForm.vehicleId ? "TBox 绑定已保存" : "TBox 已解绑");
}

function statusType(device: TboxDeviceSummary) {
  if (device.status === "fault") return "danger";
  if (device.onlineStatus === "online") return "success";
  return "info";
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">TBox 管理</h1>
        <p class="text-gray-500 text-sm mt-1">管理租户下所有车机设备，执行车辆换绑与授权验证操作。</p>
      </div>
      <el-button type="primary" plain @click="loadData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新设备
      </el-button>
    </div>

    <div class="grid grid-cols-12 gap-4 mb-5">
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">设备总数</div>
        <div class="text-2xl font-bold text-gray-800 mt-1">{{ devices.length }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">已绑定车辆</div>
        <div class="text-2xl font-bold text-blue-600 mt-1">{{ devices.filter((item) => item.boundVehicleId).length }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">在线设备</div>
        <div class="text-2xl font-bold text-emerald-600 mt-1">{{ devices.filter((item) => item.onlineStatus === "online").length }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">预留接口</div>
        <div class="text-lg font-bold text-gray-800 mt-2">Mock adapter</div>
      </div>
    </div>

    <div class="rimo-card p-5">
      <div class="flex items-center justify-between gap-4 mb-5">
        <el-input v-model="keyword" placeholder="CID/车牌/供应商" clearable prefix-icon="Search" style="width: 260px" />
        <div class="text-sm text-gray-500">共 {{ filteredDevices.length }} 台设备</div>
      </div>
      <el-table :data="filteredDevices" :loading="loading" border stripe>
        <el-table-column label="车机设备" min-width="210">
          <template #default="{ row }">
            <div class="font-bold text-gray-800">{{ row.cid }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.provider }} · {{ row.modelNo }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" effect="plain">{{ row.status }} / {{ row.onlineStatus }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目前绑定车辆" min-width="180">
          <template #default="{ row }">
            <div class="font-medium text-gray-800">{{ row.boundPlateNo || "未绑定" }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.boundVehicleGroupName || "请选择载体车辆" }}</div>
          </template>
        </el-table-column>
        <el-table-column label="站点" min-width="160">
          <template #default="{ row }">{{ row.currentStationName || "-" }}</template>
        </el-table-column>
        <el-table-column label="信号/电量" width="120">
          <template #default="{ row }">{{ row.signalStrength ?? "-" }} / {{ row.batteryLevel ?? "-" }}</template>
        </el-table-column>
        <el-table-column prop="lastHeartbeatAt" label="最后心跳" width="190" />
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openBindDialog(row)">
              {{ row.boundVehicleId ? "更换车辆" : "绑定车辆" }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" title="TBox 绑定车辆" width="560px" destroy-on-close>
      <div v-if="currentDevice" class="space-y-4">
        <div class="rounded-lg bg-blue-50 border border-blue-100 p-4 text-sm text-blue-700">
          换绑操作将使该车机取代目标车辆上原有的硬件授权信息。
        </div>
        <el-form label-position="top">
          <el-form-item label="当前设备">
            <el-input :model-value="currentDevice.cid" disabled />
          </el-form-item>
          <el-form-item label="选择载体车辆">
            <el-select v-model="bindForm.vehicleId" filterable clearable placeholder="为空则解绑" class="w-full">
              <el-option
                v-for="vehicle in bindableVehicles"
                :key="vehicle.id"
                :label="`${vehicle.licensePlate} · ${vehicle.vehicleGroupName}`"
                :value="vehicle.id"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="submitBind">保存绑定</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
