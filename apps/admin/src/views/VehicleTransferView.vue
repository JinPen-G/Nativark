<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  AdvanceVehicleTransferTaskRequest,
  CreateVehicleTransferTaskRequest,
  StoreStationSummary,
  VehicleInstanceSummary,
  VehicleTransferTask
} from "@rimo/shared";
import {
  advanceVehicleTransferTask,
  createVehicleTransferTask,
  listStations,
  listVehicleTransferTasks,
  listVehicles
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

const loading = ref(false);
const drawerVisible = ref(false);
const taskActionLoading = ref("");
const rows = ref<VehicleInstanceSummary[]>([]);
const stations = ref<StoreStationSummary[]>([]);
const transferTasks = ref<VehicleTransferTask[]>([]);
const selectedVehicles = ref<VehicleInstanceSummary[]>([]);
const filters = reactive({
  keyword: "",
  stationName: "",
  serviceType: ""
});
const transferForm = reactive<CreateVehicleTransferTaskRequest>({
  vehicleIds: [],
  targetStoreName: "",
  targetStationName: "",
  targetServiceType: "STORE_STANDARD",
  reason: "",
  operator: "营运端"
});

const storeOptions = computed(() =>
  Array.from(new Set(stations.value.map((station) => station.parentStoreName)))
);
const targetStationOptions = computed(() =>
  stations.value.filter(
    (station) =>
      !transferForm.targetStoreName ||
      station.parentStoreName === transferForm.targetStoreName
  )
);
const filteredRows = computed(() =>
  rows.value.filter((row) => {
    const keyword = filters.keyword.trim().toLowerCase();
    return (
      (!keyword ||
        row.licensePlate.toLowerCase().includes(keyword) ||
        row.vehicleGroupName.toLowerCase().includes(keyword)) &&
      (!filters.stationName || row.currentStationName === filters.stationName) &&
      (!filters.serviceType || row.currentServiceType === filters.serviceType)
    );
  })
);
const idleCount = computed(
  () => rows.value.filter((row) => row.operationStatus === "idle").length
);

async function loadData() {
  loading.value = true;
  try {
    const [vehicleRows, stationRows, tasks] = await Promise.all([
      listVehicles(),
      listStations(),
      listVehicleTransferTasks()
    ]);
    rows.value = vehicleRows;
    stations.value = stationRows;
    transferTasks.value = tasks;
  } finally {
    loading.value = false;
  }
}

function handleSelectionChange(selection: VehicleInstanceSummary[]) {
  selectedVehicles.value = selection;
}

function openTransfer(row?: VehicleInstanceSummary) {
  const vehicles = row ? [row] : selectedVehicles.value;
  if (vehicles.length === 0) {
    ElMessage.warning("请先选择需要调拨的车辆");
    return;
  }
  transferForm.vehicleIds = vehicles.map((vehicle) => vehicle.id);
  transferForm.targetStoreName = vehicles[0].currentStoreName;
  transferForm.targetStationName = vehicles[0].currentStationName;
  transferForm.targetServiceType = vehicles[0].currentServiceType;
  transferForm.reason = "";
  drawerVisible.value = true;
}

async function submitTransfer() {
  if (!transferForm.targetStoreName || !transferForm.targetStationName) {
    ElMessage.warning("请选择目标门市和目标站点");
    return;
  }
  if (!transferForm.reason.trim()) {
    ElMessage.warning("请填写调拨原因");
    return;
  }
  const result = await createVehicleTransferTask({
    ...transferForm,
    reason: transferForm.reason.trim()
  });
  transferTasks.value.unshift(result.task);
  await loadData();
  drawerVisible.value = false;
  ElMessage.success(`调拨任务 ${result.task.taskNo} 已创建，待确认`);
}

function statusName(status: VehicleInstanceSummary["operationStatus"]) {
  const map = {
    idle: "空闲中",
    reserved: "已预约",
    renting: "租赁中",
    controlled: "整备中",
    maintenance: "维保中",
    disabled: "已停用"
  };
  return map[status];
}

function serviceTypeName(type: VehicleInstanceSummary["currentServiceType"]) {
  return type === "STORE_24H" ? "24小时自助" : "门市租赁";
}

function taskStatusName(status: VehicleTransferTask["status"]) {
  const map = {
    pending: "待确认",
    approved: "已确认",
    departed: "已出发",
    arrived: "已到达",
    completed: "已完成",
    cancelled: "已取消"
  };
  return map[status];
}

function taskStatusTagType(status: VehicleTransferTask["status"]) {
  if (status === "completed") return "success";
  if (status === "cancelled") return "info";
  if (status === "departed") return "warning";
  return "primary";
}

function transferActionName(action: AdvanceVehicleTransferTaskRequest["action"]) {
  const map = {
    approve: "确认申请",
    depart: "登记出发",
    arrive: "确认到达",
    cancel: "取消任务"
  };
  return map[action];
}

function availableTaskActions(task: VehicleTransferTask) {
  if (task.status === "pending") {
    return ["approve", "cancel"] as AdvanceVehicleTransferTaskRequest["action"][];
  }
  if (task.status === "approved") {
    return ["depart", "arrive", "cancel"] as AdvanceVehicleTransferTaskRequest["action"][];
  }
  if (task.status === "departed" || task.status === "arrived") {
    return ["arrive", "cancel"] as AdvanceVehicleTransferTaskRequest["action"][];
  }
  return [] as AdvanceVehicleTransferTaskRequest["action"][];
}

function completedTaskItemCount(task: VehicleTransferTask) {
  return task.items.filter((item) => item.result === "completed").length;
}

function failedTaskItemCount(task: VehicleTransferTask) {
  return task.items.filter((item) => item.result === "failed").length;
}

async function advanceTask(
  task: VehicleTransferTask,
  action: AdvanceVehicleTransferTaskRequest["action"]
) {
  const label = transferActionName(action);
  let reason = "";
  try {
    if (action === "cancel") {
      const result = await ElMessageBox.prompt("请填写取消原因", "取消调拨任务", {
        confirmButtonText: "确认取消",
        cancelButtonText: "返回",
        inputPattern: /\S+/,
        inputErrorMessage: "取消原因不能为空",
        type: "warning"
      });
      reason = result.value.trim();
    } else {
      await ElMessageBox.confirm(
        `确认对调拨任务 ${task.taskNo} 执行【${label}】吗？`,
        "车辆调拨流转",
        {
          confirmButtonText: "确认",
          cancelButtonText: "取消",
          type: action === "arrive" ? "warning" : "info"
        }
      );
    }
  } catch {
    return;
  }

  const loadingKey = `${task.id}:${action}`;
  taskActionLoading.value = loadingKey;
  try {
    await advanceVehicleTransferTask(task.id, {
      action,
      operator: "营运端",
      reason: reason || undefined
    });
    await loadData();
    ElMessage.success(`${label}已完成`);
  } finally {
    taskActionLoading.value = "";
  }
}

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <div class="flex items-end justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车辆调拨管理</h1>
        <p class="text-gray-500 text-sm mt-1">负责修改门市租赁车辆站点分布或执行服务类型切换。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openTransfer()">
        <el-icon class="mr-1"><Switch /></el-icon>
        批量调拨 ({{ selectedVehicles.length }})
      </el-button>
    </div>

    <div class="grid grid-cols-12 gap-4 mb-5">
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">监控车辆池</div>
        <div class="text-2xl font-bold text-gray-800 mt-1">{{ rows.length }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">可直接调拨</div>
        <div class="text-2xl font-bold text-emerald-600 mt-1">{{ idleCount }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">调拨任务</div>
        <div class="text-2xl font-bold text-gray-800 mt-1">{{ transferTasks.length }}</div>
      </div>
      <div class="rimo-card p-4 col-span-12 md:col-span-3">
        <div class="text-xs text-gray-500">当前范围</div>
        <div class="text-lg font-bold text-gray-800 mt-2">门市租赁</div>
      </div>
    </div>

    <div class="rimo-card p-5 mb-5">
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <el-input v-model="filters.keyword" placeholder="车牌/车型组" clearable prefix-icon="Search" style="width: 220px" />
        <el-select v-model="filters.stationName" placeholder="当前所在站点" clearable style="width: 200px">
          <el-option v-for="station in stations" :key="station.id" :label="station.name" :value="station.name" />
        </el-select>
        <el-select v-model="filters.serviceType" placeholder="服务类型" clearable style="width: 160px">
          <el-option label="门市租赁" value="STORE_STANDARD" />
          <el-option label="24小时自助" value="STORE_24H" />
        </el-select>
        <div class="ml-auto text-sm text-gray-500">共 {{ filteredRows.length }} 台车辆</div>
      </div>

      <el-table :data="filteredRows" stripe border :loading="loading" @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" align="center" />
        <el-table-column label="车辆信息" min-width="210">
          <template #default="{ row }">
            <div class="font-bold text-gray-800">{{ row.licensePlate }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.vehicleGroupName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前站点" min-width="190">
          <template #default="{ row }">
            <div>{{ row.currentStoreName }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.currentStationName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="服务类型" width="130">
          <template #default="{ row }">
            <el-tag effect="plain">{{ serviceTypeName(row.currentServiceType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="车辆状态" width="130">
          <template #default="{ row }">
            <el-tag :type="row.operationStatus === 'idle' ? 'success' : 'info'" effect="plain">
              {{ statusName(row.operationStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="mileage" label="里程" width="100" />
        <el-table-column label="操作" width="130" align="right">
          <template #default="{ row }">
            <el-button type="primary" link :disabled="row.operationStatus !== 'idle'" @click="openTransfer(row)">
              调拨
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="rimo-card p-5">
      <div class="font-bold text-gray-800 mb-4">调拨任务记录</div>
      <el-table :data="transferTasks" stripe>
        <el-table-column prop="taskNo" label="任务号" width="180" />
        <el-table-column label="目标站点" min-width="220">
          <template #default="{ row }">{{ row.targetStoreName }} / {{ row.targetStationName }}</template>
        </el-table-column>
        <el-table-column label="车辆数" width="90" align="center" prop="vehicleCount" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="taskStatusTagType(row.status)" effect="plain">
              {{ taskStatusName(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="车辆结果" width="140">
          <template #default="{ row }">
            <div class="text-xs text-gray-500">
              {{ completedTaskItemCount(row) }} 完成 /
              {{ failedTaskItemCount(row) }} 失败
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="operator" label="操作人" width="120" />
        <el-table-column prop="createdAt" label="创建时间" width="190" />
        <el-table-column prop="reason" label="原因" min-width="220" />
        <el-table-column label="流转操作" width="250" fixed="right">
          <template #default="{ row }">
            <div class="flex flex-wrap justify-end gap-2">
              <el-button
                v-for="action in availableTaskActions(row)"
                :key="action"
                size="small"
                :type="action === 'cancel' ? 'danger' : action === 'arrive' ? 'success' : 'primary'"
                plain
                :loading="taskActionLoading === `${row.id}:${action}`"
                @click="advanceTask(row, action)"
              >
                {{ transferActionName(action) }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="drawerVisible" title="车辆调拨配置" size="560px" destroy-on-close>
      <div class="space-y-5">
        <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div class="text-sm font-semibold text-gray-800">调拨执行清单</div>
          <div class="text-xs text-gray-500 mt-1">共 {{ transferForm.vehicleIds.length }} 台车辆，非空闲车辆会由后端拦截。</div>
        </div>
        <el-form label-position="top">
          <el-form-item label="目标门市" required>
            <el-select v-model="transferForm.targetStoreName" class="w-full" @change="transferForm.targetStationName = ''">
              <el-option v-for="store in storeOptions" :key="store" :label="store" :value="store" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标站点" required>
            <el-select v-model="transferForm.targetStationName" class="w-full">
              <el-option
                v-for="station in targetStationOptions"
                :key="station.id"
                :label="`${station.name}（${station.serviceCapabilities.join('、')}）`"
                :value="station.name"
                :disabled="station.status === 'disabled'"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="目标服务类型" required>
            <el-radio-group v-model="transferForm.targetServiceType">
              <el-radio-button label="STORE_STANDARD">门市租赁</el-radio-button>
              <el-radio-button label="STORE_24H">24小时自助</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="调拨原因" required>
            <el-input v-model="transferForm.reason" type="textarea" :rows="4" placeholder="例如：周末旺角门市备车、机场门市维修暂停后的车辆回流" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="submitTransfer">确认执行调拨</el-button>
      </template>
    </el-drawer>
  </AppLayout>
</template>
