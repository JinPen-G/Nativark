<script setup lang="ts">
import { ElMessage } from "element-plus";
import { onMounted, reactive, ref } from "vue";
import type {
  SaveStationCalendarDayRequest,
  StationCalendarDay,
  StationCapacitySnapshot,
  StoreStationHierarchyNode,
  StoreStationListQuery,
  StoreStationSummary
} from "@rimo/shared";
import {
  listStationHierarchy,
  listStationCalendar,
  listStationCapacitySnapshots,
  listStationPage,
  refreshStationCapacitySnapshots,
  saveStationCalendarDay,
  saveStation as persistStation
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { stationRows } from "../data/prototypeSeed";

const searchQuery = ref("");
const serviceFilter = ref("");
const serviceStatusFilter = ref("");
const statusFilter = ref("");
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const dialogVisible = ref(false);
const detailDrawerVisible = ref(false);
const detailActionLoading = ref(false);
const activeDetailTab = ref("CALENDAR");
const isEdit = ref(false);
const rows = ref<StoreStationSummary[]>(structuredClone(stationRows));
const hierarchyRows = ref<StoreStationHierarchyNode[]>([]);
const calendarRows = ref<StationCalendarDay[]>([]);
const capacityRows = ref<StationCapacitySnapshot[]>([]);
const selectedStation = ref<StoreStationSummary | null>(null);
const currentScope = ref<StoreStationHierarchyNode>({
  id: "all",
  type: "all",
  label: "全部",
  stationCount: 0,
  children: []
});

const currentStation = reactive<StoreStationSummary>({
  id: "",
  name: "",
  parentStoreName: "",
  stationType: "门市柜台",
  serviceCapabilities: [],
  parkingTotal: 0,
  parkingAvailable: 0,
  status: "enabled",
  serviceStatus: "normal",
  address: "",
  contactName: "",
  contactPhone: "",
  storeRentalEnabled: true,
  storeRentalServiceStatus: "normal",
  storeRentalManualHandover: true,
  storeRentalManualInspection: true,
  storeSelfServiceEnabled: false,
  storeSelfServiceStatus: "normal",
  selfServiceAllowNightReturn: false,
  selfServicePickupMethods: []
});
const calendarForm = reactive<SaveStationCalendarDayRequest>({
  date: new Date().toISOString().slice(0, 10),
  businessStatus: "open",
  openTime: "09:00",
  closeTime: "20:00",
  capacityLimit: 0,
  note: "",
  operator: "营运端"
});

async function loadRows() {
  loading.value = true;
  try {
    const [stationResult, hierarchy] = await Promise.all([
      listStationPage({
        keyword: searchQuery.value.trim() || undefined,
        serviceCapability: serviceFilter.value || undefined,
        serviceStatus: (serviceStatusFilter.value || undefined) as
          | StoreStationListQuery["serviceStatus"]
          | undefined,
        status: (statusFilter.value || undefined) as StoreStationListQuery["status"] | undefined,
        scopeType: currentScope.value.type,
        scopeLabel: currentScope.value.type === "all" ? undefined : currentScope.value.label,
        page: page.value,
        pageSize: pageSize.value
      }),
      listStationHierarchy()
    ]);
    rows.value = stationResult.rows;
    total.value = stationResult.total;
    hierarchyRows.value = hierarchy;
    if (currentScope.value.type === "all") {
      currentScope.value = hierarchy[0] || currentScope.value;
    }
  } catch {
    rows.value = structuredClone(stationRows);
    total.value = rows.value.length;
    hierarchyRows.value = buildFallbackHierarchy(rows.value);
  } finally {
    loading.value = false;
  }
}

async function openStationDetail(row: StoreStationSummary) {
  selectedStation.value = row;
  detailDrawerVisible.value = true;
  activeDetailTab.value = "CALENDAR";
  Object.assign(calendarForm, {
    date: new Date().toISOString().slice(0, 10),
    businessStatus: row.serviceStatus === "normal" ? "open" : "paused",
    openTime: "09:00",
    closeTime: row.storeSelfServiceEnabled ? "23:59" : "20:00",
    capacityLimit: row.parkingTotal,
    note: "",
    operator: "营运端"
  });
  try {
    const [calendar, capacity] = await Promise.all([
      listStationCalendar(row.id),
      listStationCapacitySnapshots(row.id)
    ]);
    calendarRows.value = calendar;
    capacityRows.value = capacity;
  } catch {
    calendarRows.value = [];
    capacityRows.value = [];
  }
}

async function submitCalendarDay() {
  if (!selectedStation.value) {
    return;
  }
  if (!calendarForm.date) {
    ElMessage.warning("请填写营业日期");
    return;
  }
  calendarRows.value = await saveStationCalendarDay(selectedStation.value.id, {
    ...calendarForm,
    operator: "营运端"
  });
  ElMessage.success("营业日历已保存");
}

async function refreshCapacitySnapshots() {
  if (!selectedStation.value) {
    return;
  }
  detailActionLoading.value = true;
  try {
    const result = await refreshStationCapacitySnapshots(selectedStation.value.id);
    capacityRows.value = result.snapshots;
    ElMessage.success(result.message);
  } catch {
    ElMessage.error("容量快照刷新失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function buildFallbackHierarchy(stations: StoreStationSummary[]): StoreStationHierarchyNode[] {
  const company: StoreStationHierarchyNode = {
    id: "company_RIMO 香港租户",
    type: "company",
    label: "RIMO 香港租户",
    stationCount: stations.length,
    children: Array.from(new Set(stations.map((station) => station.parentStoreName))).map(
      (store): StoreStationHierarchyNode => ({
        id: `store_${store}`,
        type: "store",
        label: store,
        stationCount: stations.filter((station) => station.parentStoreName === store).length,
        children: []
      })
    )
  };

  return [
    {
      id: "all",
      type: "all",
      label: "全部",
      stationCount: stations.length,
      children: [company]
    }
  ];
}

function handleScopeChange(node: StoreStationHierarchyNode) {
  currentScope.value = node;
  page.value = 1;
  void loadRows();
}

function applyStationFilters() {
  page.value = 1;
  void loadRows();
}

function resetStationFilters() {
  searchQuery.value = "";
  serviceFilter.value = "";
  serviceStatusFilter.value = "";
  statusFilter.value = "";
  page.value = 1;
  void loadRows();
}

function handleStationPageSizeChange() {
  page.value = 1;
  void loadRows();
}

function openCreate() {
  isEdit.value = false;
  Object.assign(currentStation, {
    id: "",
    name: "",
    parentStoreName: "旺角门市",
    stationType: "门市柜台",
    serviceCapabilities: ["门市租车"],
    parkingTotal: 0,
    parkingAvailable: 0,
    status: "enabled",
    serviceStatus: "normal",
    address: "",
    contactName: "",
    contactPhone: "",
    storeRentalEnabled: true,
    storeRentalServiceStatus: "normal",
    storeRentalManualHandover: true,
    storeRentalManualInspection: true,
    storeSelfServiceEnabled: false,
    storeSelfServiceStatus: "normal",
    selfServiceAllowNightReturn: false,
    selfServicePickupMethods: []
  });
  dialogVisible.value = true;
}

function openEdit(row: StoreStationSummary) {
  isEdit.value = true;
  Object.assign(currentStation, structuredClone(row));
  dialogVisible.value = true;
}

async function saveStation() {
  if (!currentStation.name || !currentStation.parentStoreName) {
    ElMessage.warning("请先填写据点名称并选择所属门市");
    return;
  }
  if (currentStation.parkingAvailable > currentStation.parkingTotal) {
    ElMessage.warning("可用车位数不能大于总车位数");
    return;
  }
  if (!currentStation.storeRentalEnabled && !currentStation.storeSelfServiceEnabled) {
    ElMessage.warning("本期至少需要启用一个门市租赁服务能力");
    return;
  }
  if (
    currentStation.storeSelfServiceEnabled &&
    currentStation.storeSelfServiceStatus === "normal" &&
    (currentStation.selfServicePickupMethods ?? []).length === 0
  ) {
    ElMessage.warning("24 小时自助启用时，请至少选择一种自助取还方式");
    return;
  }

  currentStation.serviceCapabilities = [
    ...(currentStation.storeRentalEnabled ? ["门市租车"] : []),
    ...(currentStation.storeSelfServiceEnabled ? ["24小时自助"] : [])
  ];
  currentStation.serviceStatus =
    (currentStation.storeRentalEnabled && currentStation.storeRentalServiceStatus === "normal") ||
    (currentStation.storeSelfServiceEnabled && currentStation.storeSelfServiceStatus === "normal")
      ? "normal"
      : "paused";

  let savedStation = structuredClone(currentStation);
  try {
    savedStation = await persistStation(savedStation);
  } catch {
    ElMessage.error("据点保存失败，请检查所属门市、服务能力、车位和后端校验");
    return;
  }

  if (isEdit.value) {
    const index = rows.value.findIndex((row) => row.id === currentStation.id);
    if (index >= 0) {
      rows.value[index] = savedStation;
    }
  } else {
    rows.value.unshift(savedStation);
  }

  hierarchyRows.value = buildFallbackHierarchy(rows.value);
  dialogVisible.value = false;
  await loadRows();
  ElMessage.success("据点已保存");
}

function statusType(status: StoreStationSummary["serviceStatus"]) {
  return status === "normal" ? "success" : status === "maintenance" ? "warning" : "info";
}

onMounted(loadRows);
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">服务站点管理</h1>
        <p class="text-gray-500 text-sm mt-1">管理车行、门市及据点，配置各业务模式的服务能力。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>
        新增据点
      </el-button>
    </div>

    <div class="grid grid-cols-12 gap-5">
      <aside class="col-span-12 xl:col-span-3">
        <div class="rimo-card p-4">
          <div class="flex items-center justify-between mb-3">
            <div>
              <div class="text-sm font-bold text-gray-800">站点与区域</div>
              <div class="text-xs text-gray-500 mt-1">左侧只切换车行/门市范围</div>
            </div>
            <el-tag effect="plain">{{ currentScope.stationCount }}</el-tag>
          </div>
          <el-tree
            :data="hierarchyRows"
            node-key="id"
            default-expand-all
            highlight-current
            :props="{ label: 'label', children: 'children' }"
            @node-click="handleScopeChange"
          >
            <template #default="{ data }">
              <div class="flex items-center justify-between w-full pr-3 py-1">
                <span class="text-sm">{{ data.label }}</span>
                <span class="text-xs text-gray-400">{{ data.stationCount }}</span>
              </div>
            </template>
          </el-tree>
        </div>
      </aside>

      <div class="col-span-12 xl:col-span-9">
        <div class="rimo-card p-5">
      <div class="flex items-center justify-between gap-4 mb-5">
        <div class="flex items-center gap-3">
          <el-input
            v-model="searchQuery"
            placeholder="搜索据点名称/地址..."
            prefix-icon="Search"
            clearable
            style="width: 260px"
            @keyup.enter="applyStationFilters"
          />
          <el-select v-model="serviceFilter" placeholder="服务能力" clearable style="width: 220px">
            <el-option label="门市租车" value="门市租车" />
            <el-option label="24小时自助" value="24小时自助" />
          </el-select>
          <el-select v-model="serviceStatusFilter" placeholder="服务状态" clearable style="width: 140px">
            <el-option label="启用中" value="normal" />
            <el-option label="已暂停" value="paused" />
            <el-option label="维护中" value="maintenance" />
          </el-select>
          <el-select v-model="statusFilter" placeholder="据点状态" clearable style="width: 160px">
            <el-option label="启用" value="enabled" />
            <el-option label="停用" value="disabled" />
          </el-select>
          <el-button type="primary" plain @click="applyStationFilters">查询</el-button>
          <el-button icon="Refresh" circle @click="resetStationFilters" />
        </div>
        <div class="text-sm text-gray-500">共 {{ total }} 个据点</div>
      </div>

      <el-table v-loading="loading" :data="rows" stripe style="width: 100%">
        <el-table-column type="selection" :reserve-selection="true" width="52" align="center" />
        <el-table-column prop="name" label="据点名称" min-width="180">
          <template #default="{ row }">
            <div class="font-bold text-gray-800">{{ row.name }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.address }}</div>
          </template>
        </el-table-column>
        <el-table-column label="所属门市" min-width="160">
          <template #default="{ row }">
            <div class="text-sm text-gray-700">{{ row.parentStoreName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="据点类型" width="150">
          <template #default="{ row }">
            <el-tag effect="plain">{{ row.stationType }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="服务能力" min-width="200">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-2">
              <el-tag
                v-for="capability in row.serviceCapabilities"
                :key="capability"
                :type="capability === '24小时自助' ? 'info' : 'warning'"
                effect="plain"
              >
                {{ capability }}
                <span v-if="capability === '门市租车' && row.storeRentalServiceStatus === 'paused'"> · 暂停</span>
                <span v-if="capability === '24小时自助' && row.storeSelfServiceStatus === 'paused'"> · 暂停</span>
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="车位概况" width="220">
          <template #default="{ row }">
            <div class="text-sm text-gray-700">可用 {{ row.parkingAvailable }} / 总计 {{ row.parkingTotal }}</div>
            <el-progress :percentage="Math.round((row.parkingAvailable / Math.max(row.parkingTotal, 1)) * 100)" :show-text="false" />
          </template>
        </el-table-column>
        <el-table-column label="据点状态" width="120">
          <template #default="{ row }">
            <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
              {{ row.status === "enabled" ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="primary" link @click="openStationDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadRows"
          @size-change="handleStationPageSizeChange"
        />
      </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑据点' : '新增据点'" width="880px" destroy-on-close>
      <el-form :model="currentStation" label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="据点类型" class="col-span-12 md:col-span-4">
            <el-select v-model="currentStation.stationType" placeholder="请选择据点类型" class="w-full">
              <el-option label="门市柜台" value="门市柜台" />
              <el-option label="停车场" value="停车场" />
              <el-option label="自助取还点" value="自助取还点" />
            </el-select>
          </el-form-item>
          <el-form-item label="所属门市" required class="col-span-12 md:col-span-4">
            <el-select v-model="currentStation.parentStoreName" placeholder="请先选择车行，再选择门市" class="w-full">
              <el-option label="旺角门市" value="旺角门市" />
              <el-option label="中环门市" value="中环门市" />
              <el-option label="机场门市" value="机场门市" />
            </el-select>
          </el-form-item>
          <el-form-item label="据点名称" required class="col-span-12 md:col-span-4">
            <el-input v-model="currentStation.name" placeholder="例如：机场门市停车区" />
          </el-form-item>
          <el-form-item label="联络人" class="col-span-12 md:col-span-3">
            <el-input v-model="currentStation.contactName" placeholder="请输入联络人" />
          </el-form-item>
          <el-form-item label="联络电话" class="col-span-12 md:col-span-3">
            <el-input v-model="currentStation.contactPhone" placeholder="请输入联络电话" />
          </el-form-item>
          <el-form-item label="详细地址" class="col-span-12 md:col-span-6">
            <el-input v-model="currentStation.address" placeholder="请输入街道、楼层或停车场位置说明" />
          </el-form-item>
          <el-form-item label="总车位数" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentStation.parkingTotal" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="可用车位数" class="col-span-12 md:col-span-3">
            <el-input-number v-model="currentStation.parkingAvailable" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="服务状态" class="col-span-12 md:col-span-3">
            <el-select v-model="currentStation.serviceStatus" class="w-full">
              <el-option label="正常" value="normal" />
              <el-option label="暂停" value="paused" />
              <el-option label="维护中" value="maintenance" />
            </el-select>
          </el-form-item>
          <el-form-item label="据点状态" class="col-span-12 md:col-span-3">
            <el-select v-model="currentStation.status" class="w-full">
              <el-option label="启用" value="enabled" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
        </div>

        <div class="mt-2 rounded-xl border border-orange-100 bg-orange-50 p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="font-semibold text-gray-800">门市租赁</div>
              <p class="text-xs text-gray-500 mt-1">统一配置门市租赁的服务时间，再分别启用门市租车和 24 小时自助。</p>
              <p class="text-xs text-orange-600 mt-1">门市租赁下，门市租车面向门市办理，24 小时自助只保留接口与服务能力。</p>
            </div>
            <el-tag :type="statusType(currentStation.serviceStatus)" effect="plain">
              {{ currentStation.serviceStatus }}
            </el-tag>
          </div>

          <div class="grid grid-cols-2 gap-4 mt-4">
            <div class="rounded-lg bg-white border border-orange-100 p-4">
              <el-checkbox v-model="currentStation.storeRentalEnabled">
                <span class="font-medium text-gray-800">门市租车</span>
              </el-checkbox>
              <div v-if="currentStation.storeRentalEnabled" class="mt-3 pl-6 space-y-3">
                <el-form-item label="服务状态" class="!mb-0 w-full">
                  <el-select v-model="currentStation.storeRentalServiceStatus" class="w-full">
                    <el-option label="启用中" value="normal" />
                    <el-option label="暂停" value="paused" />
                  </el-select>
                </el-form-item>
                <el-form-item label="柜台服务时间" class="!mb-0 w-full">
                  <el-time-picker is-range class="w-full" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" />
                </el-form-item>
                <div class="flex items-center gap-5">
                  <el-checkbox v-model="currentStation.storeRentalManualHandover">人工交车</el-checkbox>
                  <el-checkbox v-model="currentStation.storeRentalManualInspection">人工验车</el-checkbox>
                </div>
              </div>
            </div>
            <div class="rounded-lg bg-white border border-orange-100 p-4">
              <el-checkbox v-model="currentStation.storeSelfServiceEnabled">
                <span class="font-medium text-gray-800">24小时自助</span>
              </el-checkbox>
              <div v-if="currentStation.storeSelfServiceEnabled" class="mt-3 pl-6 space-y-3">
                <el-form-item label="服务状态" class="!mb-0 w-full">
                  <el-select v-model="currentStation.storeSelfServiceStatus" class="w-full">
                    <el-option label="启用中" value="normal" />
                    <el-option label="暂停" value="paused" />
                  </el-select>
                </el-form-item>
                <el-checkbox v-model="currentStation.selfServiceAllowNightReturn">允许夜间还车</el-checkbox>
                <el-form-item label="自助取还方式" class="!mb-0 w-full">
                  <el-select v-model="currentStation.selfServicePickupMethods" multiple placeholder="请选择自助取还方式" class="w-full">
                    <el-option label="TBox 远程开关锁" value="tbox" />
                    <el-option label="密码钥匙柜" value="key_box" />
                    <el-option label="自助机取还" value="kiosk" />
                    <el-option label="远程审核开通" value="remote_review" />
                  </el-select>
                </el-form-item>
              </div>
            </div>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="saveStation">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailDrawerVisible" size="900px" destroy-on-close>
      <template #header>
        <div v-if="selectedStation">
          <div class="text-lg font-bold text-gray-800">{{ selectedStation.name }}</div>
          <div class="text-sm text-gray-500 mt-1">{{ selectedStation.parentStoreName }} · {{ selectedStation.address }}</div>
        </div>
      </template>
      <div v-if="selectedStation" class="h-full flex flex-col">
        <div class="grid grid-cols-12 gap-4 mb-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 col-span-12 md:col-span-4">
            <div class="text-xs text-gray-500">车位容量</div>
            <div class="text-xl font-bold text-gray-800 mt-1">{{ selectedStation.parkingAvailable }} / {{ selectedStation.parkingTotal }}</div>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 col-span-12 md:col-span-4">
            <div class="text-xs text-gray-500">服务状态</div>
            <el-tag class="mt-2" :type="statusType(selectedStation.serviceStatus)" effect="plain">{{ selectedStation.serviceStatus }}</el-tag>
          </div>
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4 col-span-12 md:col-span-4">
            <div class="text-xs text-gray-500">服务能力</div>
            <div class="flex flex-wrap gap-2 mt-2">
              <el-tag v-for="capability in selectedStation.serviceCapabilities" :key="capability" effect="plain">{{ capability }}</el-tag>
            </div>
          </div>
        </div>

        <el-tabs v-model="activeDetailTab" class="flex-1 overflow-hidden">
          <el-tab-pane label="营业日历" name="CALENDAR" class="h-full overflow-y-auto pr-2">
            <div class="grid grid-cols-12 gap-4 mb-5">
              <div class="col-span-12 lg:col-span-4 rounded-lg border border-slate-200 p-4">
                <div class="font-bold text-gray-800 mb-3">维护营业日</div>
                <el-form label-position="top">
                  <el-form-item label="日期" required>
                    <el-date-picker v-model="calendarForm.date" value-format="YYYY-MM-DD" type="date" class="w-full" />
                  </el-form-item>
                  <el-form-item label="营业状态" required>
                    <el-radio-group v-model="calendarForm.businessStatus">
                      <el-radio-button label="open">营业</el-radio-button>
                      <el-radio-button label="paused">暂停</el-radio-button>
                      <el-radio-button label="closed">关闭</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="营业时间">
                    <div class="grid grid-cols-2 gap-2 w-full">
                      <el-time-picker v-model="calendarForm.openTime" value-format="HH:mm" placeholder="开始" />
                      <el-time-picker v-model="calendarForm.closeTime" value-format="HH:mm" placeholder="结束" />
                    </div>
                  </el-form-item>
                  <el-form-item label="容量上限">
                    <el-input-number v-model="calendarForm.capacityLimit" :min="0" class="w-full" />
                  </el-form-item>
                  <el-form-item label="说明">
                    <el-input v-model="calendarForm.note" type="textarea" :rows="3" placeholder="例如：维修暂停、节假日延长营业、客服人工处理" />
                  </el-form-item>
                </el-form>
                <el-button type="primary" color="#00689E" class="w-full" @click="submitCalendarDay">保存营业日</el-button>
              </div>
              <div class="col-span-12 lg:col-span-8">
                <el-table :data="calendarRows" stripe border empty-text="暂无营业日历">
                  <el-table-column prop="date" label="日期" width="120" />
                  <el-table-column label="状态" width="100">
                    <template #default="{ row }">
                      <el-tag :type="row.businessStatus === 'open' ? 'success' : 'warning'" effect="plain">{{ row.businessStatus }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="营业时间" width="150">
                    <template #default="{ row }">{{ row.openTime }} - {{ row.closeTime }}</template>
                  </el-table-column>
                  <el-table-column prop="capacityLimit" label="容量上限" width="100" />
                  <el-table-column prop="note" label="说明" min-width="200" />
                  <el-table-column prop="operator" label="操作人" width="110" />
                </el-table>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="库存/容量" name="CAPACITY" class="h-full overflow-y-auto pr-2">
            <div class="mb-3 flex justify-between items-center">
              <div class="text-sm text-gray-500">根据站点营业日历、车位数、站内车辆和待取还订单生成容量快照。</div>
              <el-button
                type="primary"
                plain
                :loading="detailActionLoading"
                @click="refreshCapacitySnapshots"
              >
                刷新容量快照
              </el-button>
            </div>
            <el-table :data="capacityRows" stripe border empty-text="暂无容量快照">
              <el-table-column prop="date" label="日期" width="120" />
              <el-table-column prop="totalSpaces" label="总车位" width="90" />
              <el-table-column prop="availableSpaces" label="可用车位" width="100" />
              <el-table-column prop="reservedSpaces" label="预留/占用" width="110" />
              <el-table-column prop="occupiedVehicles" label="站内车辆" width="100" />
              <el-table-column prop="pendingPickupVehicles" label="待取车" width="90" />
              <el-table-column prop="pendingReturnVehicles" label="待还车" width="90" />
              <el-table-column prop="source" label="来源" width="90" />
              <el-table-column prop="createdAt" label="快照时间" min-width="180" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>
  </AppLayout>
</template>
