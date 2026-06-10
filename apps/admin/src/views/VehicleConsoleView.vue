<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import type { RunTboxCommandRequest, TboxCommandRecord, TboxDeviceSummary } from "@rimo/shared";
import { listTboxDevices, runTboxCommand } from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const actionLoading = ref("");
const devices = ref<TboxDeviceSummary[]>([]);
const activeDeviceId = ref("");
const commandLogs = ref<TboxCommandRecord[]>([]);
const keyword = ref("");

const filteredDevices = computed(() =>
  devices.value.filter((device) => {
    const text = keyword.value.trim().toLowerCase();
    return (
      !text ||
      device.cid.toLowerCase().includes(text) ||
      (device.boundPlateNo ?? "").toLowerCase().includes(text)
    );
  })
);
const activeDevice = computed(
  () => devices.value.find((device) => device.id === activeDeviceId.value) ?? filteredDevices.value[0]
);

async function loadData() {
  loading.value = true;
  try {
    devices.value = await listTboxDevices();
    activeDeviceId.value = activeDeviceId.value || devices.value[0]?.id || "";
  } finally {
    loading.value = false;
  }
}

function commandName(command: RunTboxCommandRequest["command"]) {
  const map = {
    LOCK_DOOR: "远程锁车",
    UNLOCK_DOOR: "远程开锁",
    FIND_CAR: "鸣笛寻车",
    SYNC_STATUS: "同步状态"
  };
  return map[command];
}

async function runCommand(command: RunTboxCommandRequest["command"]) {
  if (!activeDevice.value) {
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定要对车辆 ${activeDevice.value.boundPlateNo || activeDevice.value.cid} 执行【${commandName(command)}】操作吗？`,
      "车辆控制台",
      {
        confirmButtonText: "确认执行",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
  } catch {
    return;
  }
  actionLoading.value = command;
  try {
    const result = await runTboxCommand(activeDevice.value.id, {
      command,
      operator: "营运端"
    });
    const index = devices.value.findIndex((device) => device.id === result.device.id);
    if (index >= 0) {
      devices.value[index] = result.device;
    }
    commandLogs.value.unshift(result.command);
    ElMessage.success(result.message);
  } finally {
    actionLoading.value = "";
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车辆控制台</h1>
        <p class="text-gray-500 text-sm mt-1">远程实时操作车辆硬件接口，监控门锁、网络终端和车辆基础工况。</p>
      </div>
      <el-button type="primary" plain @click="loadData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        同步设备
      </el-button>
    </div>

    <div class="grid grid-cols-12 gap-5">
      <aside class="col-span-12 xl:col-span-3">
        <div class="rimo-card p-4">
          <div class="font-bold text-gray-800 mb-3">目标车辆检索</div>
          <el-input v-model="keyword" placeholder="车牌/CID" clearable prefix-icon="Search" class="mb-3" />
          <div v-loading="loading" class="space-y-2 max-h-[640px] overflow-y-auto custom-scroll pr-1">
            <button
              v-for="device in filteredDevices"
              :key="device.id"
              class="w-full text-left rounded-lg border px-3 py-3 transition"
              :class="activeDevice?.id === device.id ? 'border-[#00689E] bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'"
              @click="activeDeviceId = device.id"
            >
              <div class="flex items-center justify-between">
                <span class="font-semibold text-gray-800">{{ device.boundPlateNo || "未绑定车辆" }}</span>
                <el-tag :type="device.onlineStatus === 'online' ? 'success' : 'info'" size="small" effect="plain">
                  {{ device.onlineStatus }}
                </el-tag>
              </div>
              <div class="text-xs text-gray-500 mt-1">{{ device.cid }} · {{ device.currentStationName || "未定位" }}</div>
            </button>
          </div>
        </div>
      </aside>

      <section class="col-span-12 xl:col-span-9">
        <div v-if="activeDevice" class="space-y-5">
          <div class="rimo-card p-5">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div class="text-xs text-gray-500">当前控制车辆</div>
                <div class="text-2xl font-bold text-gray-800 mt-1">{{ activeDevice.boundPlateNo || "未绑定车辆" }}</div>
                <div class="text-sm text-gray-500 mt-1">{{ activeDevice.cid }} · {{ activeDevice.boundVehicleGroupName || "待绑定车型组" }}</div>
              </div>
              <div class="flex gap-3">
                <el-button type="primary" color="#00689E" :loading="actionLoading === 'UNLOCK_DOOR'" @click="runCommand('UNLOCK_DOOR')">远程开锁</el-button>
                <el-button type="warning" :loading="actionLoading === 'LOCK_DOOR'" @click="runCommand('LOCK_DOOR')">远程锁车</el-button>
                <el-button :loading="actionLoading === 'FIND_CAR'" @click="runCommand('FIND_CAR')">鸣笛寻车</el-button>
                <el-button :loading="actionLoading === 'SYNC_STATUS'" @click="runCommand('SYNC_STATUS')">同步状态</el-button>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-12 gap-4">
            <div class="rimo-card p-5 col-span-12 md:col-span-4">
              <div class="text-xs text-gray-500">终端状态</div>
              <div class="mt-3 flex items-center gap-2">
                <el-tag :type="activeDevice.onlineStatus === 'online' ? 'success' : 'info'" effect="plain">{{ activeDevice.onlineStatus }}</el-tag>
                <el-tag :type="activeDevice.status === 'active' ? 'success' : 'danger'" effect="plain">{{ activeDevice.status }}</el-tag>
              </div>
            </div>
            <div class="rimo-card p-5 col-span-12 md:col-span-4">
              <div class="text-xs text-gray-500">信号强度</div>
              <el-progress class="mt-4" :percentage="activeDevice.signalStrength ?? 0" />
            </div>
            <div class="rimo-card p-5 col-span-12 md:col-span-4">
              <div class="text-xs text-gray-500">电量</div>
              <el-progress class="mt-4" :percentage="activeDevice.batteryLevel ?? 0" status="success" />
            </div>
          </div>

          <div class="rimo-card p-5">
            <div class="font-bold text-gray-800 mb-4">车辆远程控制指令台账</div>
            <el-table :data="commandLogs" empty-text="暂无本次会话指令" stripe>
              <el-table-column prop="createdAt" label="时间" width="190" />
              <el-table-column prop="cid" label="CID" width="150" />
              <el-table-column label="指令" width="120">
                <template #default="{ row }">{{ commandName(row.command) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'success' ? 'success' : 'danger'" effect="plain">{{ row.status }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="operator" label="操作人" width="120" />
              <el-table-column prop="note" label="说明" min-width="220" />
            </el-table>
          </div>
        </div>

        <div v-else class="rimo-card h-[520px] flex flex-col items-center justify-center text-gray-400">
          <el-icon size="72"><Monitor /></el-icon>
          <div class="text-xl font-bold mt-4">未选择监控车辆</div>
          <div class="text-sm mt-2">请在左侧检索栏中选择一台车辆以开启实时控制与监控面板</div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>
