<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import type {
  CreateVehicleConditionPhotoRecordRequest,
  CreateVehicleLocationEventRequest,
  CreateVehicleAccidentRecordRequest,
  CreateVehicleMaintenanceRecordRequest,
  PlatformFilterPreset,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  StoreRentalVehicleDetail,
  StoreStationSummary,
  VehicleCredentialRecord,
  VehicleGroupMaster,
  VehicleInstanceSummary,
  VehicleListQuery,
  VehicleOnboardItemRecord
} from "@rimo/shared";
import {
  createVehicleConditionPhotoRecord,
  createVehicleLocationEvent,
  createVehicleAccidentRecord,
  createVehicleMaintenanceRecord,
  deletePlatformFilterPreset,
  getVehicleDetail,
  listPlatformFilterPresets,
  listStations,
  listVehicleGroups,
  listVehiclePage,
  saveVehicle as persistVehicle,
  savePlatformFilterPreset,
  saveVehicleCredential,
  saveVehicleOnboardItem,
  setPlatformFilterPresetDefault,
  updateVehicleAccidentRecord,
  updateVehicleLocationEvent,
  updateVehicleMaintenanceRecord,
  updateVehicleStatus
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { vehicleRows } from "../data/prototypeSeed";
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const searchQuery = ref("");
const statusFilter = ref("");
const serviceFilter = ref("");
const storeFilter = ref("");
const loading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const availableStores = ref<string[]>([]);
const filterPresetScope = "store-rental.vehicles" as const;
const filterPresets = ref<PlatformFilterPreset[]>([]);
const selectedFilterPresetId = ref("");
const filterPresetLoading = ref(false);
const dialogVisible = ref(false);
const activeDialogTab = ref("BASIC");
const isEdit = ref(false);
const rows = ref<VehicleInstanceSummary[]>(structuredClone(vehicleRows));
const selectedVehicles = ref<VehicleInstanceSummary[]>([]);
const actionLoading = ref("");
const stationOptions = ref<StoreStationSummary[]>([]);
const vehicleGroupOptions = ref<VehicleGroupMaster[]>([]);
const detailDrawerVisible = ref(false);
const detailLoading = ref(false);
const activeDetailTab = ref("OVERVIEW");
const vehicleDetail = ref<StoreRentalVehicleDetail | null>(null);
const photoHistoryVisible = ref(false);
const photoDialogVisible = ref(false);
const locationDialogVisible = ref(false);
const maintenanceDialogVisible = ref(false);
const accidentDialogVisible = ref(false);
const credentialDialogVisible = ref(false);
const onboardItemDialogVisible = ref(false);
const detailActionLoading = ref(false);
const editingLocationRecordId = ref("");
const editingCredentialId = ref("");
const editingOnboardItemId = ref("");

const photoForm = reactive<CreateVehicleConditionPhotoRecordRequest>({
  scene: "manual",
  remark: "",
  photos: []
});
const photoUrlText = ref("");

const locationForm = reactive<CreateVehicleLocationEventRequest>({
  type: "manual_adjust",
  at: "",
  storeName: "",
  stationName: "",
  mileage: 0,
  note: ""
});

const maintenanceForm = reactive<CreateVehicleMaintenanceRecordRequest>({
  type: "临时维保",
  vendor: "门店自检",
  mileage: 0,
  costAmount: 0,
  status: "processing",
  remark: ""
});

const accidentForm = reactive<CreateVehicleAccidentRecordRequest>({
  description: "",
  claimStatus: "processing",
  estimatedCostAmount: 0,
  reportNo: ""
});

const credentialForm = reactive<SaveVehicleCredentialRequest>({
  credentialType: "license",
  credentialName: "",
  certNo: "",
  status: undefined,
  issueAt: "",
  expiresAt: "",
  reminderDays: 30,
  attachments: [],
  operator: "营运端"
});
const credentialAttachmentText = ref("");

const onboardItemForm = reactive<SaveVehicleOnboardItemRequest>({
  category: "key",
  itemName: "",
  standardQuantity: 1,
  actualQuantity: 1,
  status: "normal",
  priceAmount: 0,
  checkedAt: "",
  operator: "营运端",
  remark: ""
});

const currentVehicle = reactive<VehicleInstanceSummary>({
  id: "",
  licensePlate: "",
  vin: "",
  vehicleGroupName: "",
  assetCompanyName: "RIMO 香港租户",
  currentStoreName: "旺角门市",
  currentStationName: "旺角门市柜台",
  operationStatus: "idle",
  enabled: true,
  currentServiceType: "STORE_STANDARD",
  serviceTypes: ["STORE_STANDARD"],
  mileage: 0,
  color: "",
  cid: "",
  isSpecial: false
});

const storeOptions = computed(() =>
  availableStores.value.length > 0
    ? availableStores.value
    : Array.from(new Set(stationOptions.value.map((station) => station.parentStoreName)))
);

const stationOptionsByStore = computed(() =>
  stationOptions.value.filter(
    (station) => !currentVehicle.currentStoreName || station.parentStoreName === currentVehicle.currentStoreName
  )
);

const detailStationOptionsByStore = computed(() =>
  stationOptions.value.filter(
    (station) => !locationForm.storeName || station.parentStoreName === locationForm.storeName
  )
);

const occupyingStatuses = new Set([
  "pending_payment",
  "reserved",
  "pickup_overdue",
  "inspecting",
  "renting",
  "renewing",
  "overdue",
  "settlement_pending",
  "payment_due",
  "refund_pending",
  "accident_processing"
]);

const occupancyOrders = computed(() => {
  if (!vehicleDetail.value) {
    return [];
  }

  return [...vehicleDetail.value.relatedOrders]
    .filter((order) => occupyingStatuses.has(order.mainStatus))
    .sort((left, right) => left.pickupAt.localeCompare(right.pickupAt));
});
const canRunVehicleStatusAction = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:vehicle:manage",
    "store-rental:vehicle:status-action"
  ])
);
const selectedFilterPreset = computed(() =>
  filterPresets.value.find((preset) => preset.id === selectedFilterPresetId.value)
);

function filterPresetOperator() {
  return authStore.user?.displayName || "营运端";
}

function cloneVehicleFilters() {
  return {
    searchQuery: searchQuery.value,
    statusFilter: statusFilter.value,
    serviceFilter: serviceFilter.value,
    storeFilter: storeFilter.value
  };
}

function applyVehiclePresetFilters(presetFilters: Record<string, unknown>) {
  searchQuery.value =
    typeof presetFilters.searchQuery === "string" ? presetFilters.searchQuery : "";
  statusFilter.value =
    typeof presetFilters.statusFilter === "string" ? presetFilters.statusFilter : "";
  serviceFilter.value =
    typeof presetFilters.serviceFilter === "string" ? presetFilters.serviceFilter : "";
  storeFilter.value =
    typeof presetFilters.storeFilter === "string" ? presetFilters.storeFilter : "";
}

function applySelectedFilterPreset() {
  const preset = selectedFilterPreset.value;
  if (!preset) {
    return;
  }
  applyVehiclePresetFilters(preset.filters);
  applyVehicleFilters();
}

function resetVehicleFilters() {
  searchQuery.value = "";
  statusFilter.value = "";
  serviceFilter.value = "";
  storeFilter.value = "";
  selectedFilterPresetId.value = "";
  applyVehicleFilters();
}

function applyVehicleFilters() {
  page.value = 1;
  void loadRows();
}

function handleVehiclePageSizeChange() {
  page.value = 1;
  void loadRows();
}

async function loadFilterPresets() {
  filterPresetLoading.value = true;
  try {
    filterPresets.value = await listPlatformFilterPresets({
      scopeKey: filterPresetScope
    });
    const defaultPreset = filterPresets.value.find((preset) => preset.isDefault);
    if (defaultPreset) {
      selectedFilterPresetId.value = defaultPreset.id;
      applyVehiclePresetFilters(defaultPreset.filters);
    }
  } catch {
    filterPresets.value = [];
  } finally {
    filterPresetLoading.value = false;
  }
}

async function saveCurrentFilterPreset() {
  try {
    const { value } = await ElMessageBox.prompt(
      "请输入筛选预设名称",
      "保存筛选预设",
      {
        confirmButtonText: "保存",
        cancelButtonText: "取消",
        inputValue: selectedFilterPreset.value?.name ?? "",
        inputPattern: /^(?=.*\S).{1,40}$/,
        inputErrorMessage: "名称长度需为 1-40 个字符"
      }
    );
    const saved = await savePlatformFilterPreset({
      id: selectedFilterPreset.value?.id,
      scopeKey: filterPresetScope,
      name: value.trim(),
      filters: cloneVehicleFilters(),
      isDefault: selectedFilterPreset.value?.isDefault,
      operator: filterPresetOperator()
    });
    await loadFilterPresets();
    selectedFilterPresetId.value = saved.id;
    ElMessage.success("筛选预设已保存");
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error("筛选预设保存失败");
    }
  }
}

async function setCurrentFilterPresetDefault() {
  if (!selectedFilterPreset.value) {
    ElMessage.warning("请先选择筛选预设");
    return;
  }
  try {
    const saved = await setPlatformFilterPresetDefault(
      selectedFilterPreset.value.id,
      filterPresetOperator()
    );
    await loadFilterPresets();
    selectedFilterPresetId.value = saved.id;
    ElMessage.success("已设为默认筛选预设");
  } catch {
    ElMessage.error("默认筛选预设设置失败");
  }
}

async function deleteCurrentFilterPreset() {
  if (!selectedFilterPreset.value) {
    ElMessage.warning("请先选择筛选预设");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除筛选预设“${selectedFilterPreset.value.name}”？`,
      "删除筛选预设",
      {
        confirmButtonText: "删除",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
    await deletePlatformFilterPreset(
      selectedFilterPreset.value.id,
      filterPresetOperator()
    );
    selectedFilterPresetId.value = "";
    await loadFilterPresets();
    ElMessage.success("筛选预设已删除");
  } catch (error) {
    if (error !== "cancel" && error !== "close") {
      ElMessage.error("筛选预设删除失败");
    }
  }
}

async function loadRows() {
  loading.value = true;
  try {
    const [vehicleResult, stations, vehicleGroups] = await Promise.all([
      listVehiclePage({
        keyword: searchQuery.value.trim() || undefined,
        operationStatus: (statusFilter.value || undefined) as
          | VehicleListQuery["operationStatus"]
          | undefined,
        serviceType: (serviceFilter.value || undefined) as
          | VehicleListQuery["serviceType"]
          | undefined,
        storeName: storeFilter.value || undefined,
        page: page.value,
        pageSize: pageSize.value
      }),
      listStations(),
      listVehicleGroups()
    ]);
    rows.value = vehicleResult.rows;
    total.value = vehicleResult.total;
    availableStores.value = vehicleResult.availableStores;
    selectedVehicles.value = [];
    stationOptions.value = stations;
    vehicleGroupOptions.value = vehicleGroups;
  } catch {
    rows.value = structuredClone(vehicleRows);
    total.value = rows.value.length;
    availableStores.value = Array.from(
      new Set(rows.value.map((row) => row.currentStoreName).filter(Boolean))
    );
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  isEdit.value = false;
  Object.assign(currentVehicle, {
    id: "",
    licensePlate: "",
    vin: "",
    vehicleGroupName: "",
    assetCompanyName: "RIMO 香港租户",
    currentStoreName: "旺角门市",
    currentStationName: "旺角门市柜台",
    operationStatus: "idle",
    enabled: true,
    currentServiceType: "STORE_STANDARD",
    serviceTypes: ["STORE_STANDARD"],
    mileage: 0,
    color: "",
    cid: "",
    isSpecial: false
  });
  activeDialogTab.value = "BASIC";
  dialogVisible.value = true;
}

function openEdit(row: VehicleInstanceSummary) {
  isEdit.value = true;
  Object.assign(currentVehicle, structuredClone(row));
  activeDialogTab.value = "BASIC";
  dialogVisible.value = true;
}

async function saveVehicle() {
  if (!currentVehicle.licensePlate || !currentVehicle.vehicleGroupName || !currentVehicle.currentStoreName) {
    ElMessage.warning("请填写车牌号、车型组和当前门市");
    return;
  }
  if (currentVehicle.currentServiceType && !currentVehicle.serviceTypes.includes(currentVehicle.currentServiceType)) {
    ElMessage.warning("当前服务类型必须包含在可服务类型中");
    return;
  }

  let savedVehicle = structuredClone(currentVehicle);
  try {
    savedVehicle = await persistVehicle(savedVehicle);
  } catch {
    ElMessage.error("车辆保存失败，请检查车牌/VIN、车型组、当前据点和服务能力");
    return;
  }

  if (isEdit.value) {
    const index = rows.value.findIndex((row) => row.id === currentVehicle.id);
    if (index >= 0) {
      rows.value[index] = savedVehicle;
    }
  } else {
    rows.value.unshift(savedVehicle);
  }

  dialogVisible.value = false;
  await loadRows();
  ElMessage.success("车辆已保存");
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

function operationStatusType(status: VehicleInstanceSummary["operationStatus"]) {
  return status === "idle" ? "success" : ["renting", "controlled"].includes(status) ? "warning" : status === "maintenance" ? "danger" : "info";
}

function serviceTypeName(type: "STORE_STANDARD" | "STORE_24H") {
  return type === "STORE_STANDARD" ? "门市租赁" : "24H门市";
}

function replaceVehicle(updated: VehicleInstanceSummary) {
  const index = rows.value.findIndex((row) => row.id === updated.id);
  if (index >= 0) {
    rows.value[index] = updated;
  }
}

async function applyVehicleStatus(
  row: VehicleInstanceSummary,
  payload: Parameters<typeof updateVehicleStatus>[1]
) {
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  actionLoading.value = row.id;
  try {
    const result = await updateVehicleStatus(row.id, {
      operator: "营运端",
      ...payload
    });
    replaceVehicle(result.vehicle);
    await loadRows();
    if (vehicleDetail.value?.vehicle.id === result.vehicle.id) {
      await openVehicleDetail(result.vehicle, true);
    }
    ElMessage.success(result.message);
  } finally {
    actionLoading.value = "";
  }
}

async function toggleVehicleEnabled(row: VehicleInstanceSummary, enabled: boolean) {
  if (!enabled) {
    try {
      await ElMessageBox.confirm(
        "停用后车辆不再接受新订单、自动派车或人工改派，已创建订单保留历史记录。",
        "确认停用车辆",
        {
          confirmButtonText: "确认停用",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }
  }
  await applyVehicleStatus(row, {
    enabled,
    reason: enabled ? "营运端启用车辆" : "营运端停用车辆"
  });
}

async function setMaintenance(row: VehicleInstanceSummary) {
  await applyVehicleStatus(row, {
    operationStatus: "maintenance",
    reason: "营运端发起维保"
  });
}

async function finishMaintenance(row: VehicleInstanceSummary) {
  await applyVehicleStatus(row, {
    enabled: true,
    operationStatus: "idle",
    reason: "维保结束恢复可派"
  });
}

function handleSelectionChange(selection: VehicleInstanceSummary[]) {
  selectedVehicles.value = selection;
}

async function batchSetEnabled(enabled: boolean) {
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  for (const vehicle of selectedVehicles.value) {
    await applyVehicleStatus(vehicle, {
      enabled,
      reason: enabled ? "批量启用车辆" : "批量停用车辆"
    });
  }
}

async function openVehicleDetail(row: VehicleInstanceSummary, silent = false) {
  detailLoading.value = true;
  if (!silent) {
    detailDrawerVisible.value = true;
    activeDetailTab.value = "OVERVIEW";
  }
  try {
    vehicleDetail.value = await getVehicleDetail(row.id);
  } catch {
    ElMessage.error("车辆详情读取失败");
  } finally {
    detailLoading.value = false;
  }
}

function syncVehicleDetail(nextDetail: StoreRentalVehicleDetail) {
  vehicleDetail.value = nextDetail;
  replaceVehicle(nextDetail.vehicle);
}

function openPhotoDialog() {
  photoForm.scene = "manual";
  photoForm.remark = "";
  photoForm.photos = [];
  photoUrlText.value = "";
  photoDialogVisible.value = true;
}

async function submitPhotoRecord() {
  if (!vehicleDetail.value) {
    return;
  }
  const photos = photoUrlText.value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (photos.length === 0) {
    ElMessage.warning("请至少填写一张图片地址");
    return;
  }
  if (!photoForm.remark) {
    ElMessage.warning("请填写照片说明");
    return;
  }

  detailActionLoading.value = true;
  try {
    const detail = await createVehicleConditionPhotoRecord(vehicleDetail.value.vehicle.id, {
      ...photoForm,
      photos,
      operator: "营运端"
    });
    syncVehicleDetail(detail);
    photoDialogVisible.value = false;
    activeDetailTab.value = "OVERVIEW";
    ElMessage.success("车况照片已补录");
  } catch {
    ElMessage.error("车况照片补录失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function openLocationDialog(record?: StoreRentalVehicleDetail["locationEvents"][number]) {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  editingLocationRecordId.value = record?.id || "";
  Object.assign(locationForm, {
    type: record?.type || "manual_adjust",
    at: record?.at || new Date().toISOString(),
    storeName: record?.storeName || vehicleDetail.value.vehicle.currentStoreName,
    stationName: record?.stationName || vehicleDetail.value.vehicle.currentStationName,
    mileage: record?.mileage ?? vehicleDetail.value.vehicle.mileage,
    note: record?.note || ""
  });
  locationDialogVisible.value = true;
}

function openTransferDialog() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  editingLocationRecordId.value = "";
  Object.assign(locationForm, {
    type: "transfer",
    at: new Date().toISOString(),
    storeName: vehicleDetail.value.vehicle.currentStoreName,
    stationName: vehicleDetail.value.vehicle.currentStationName,
    mileage: vehicleDetail.value.vehicle.mileage,
    note: "车辆调拨"
  });
  locationDialogVisible.value = true;
}

async function submitLocationEvent() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  if (!locationForm.storeName || !locationForm.stationName) {
    ElMessage.warning("请填写门市和站点");
    return;
  }
  if (locationForm.mileage < 0) {
    ElMessage.warning("里程不能小于 0");
    return;
  }

  detailActionLoading.value = true;
  try {
    const isEditing = Boolean(editingLocationRecordId.value);
    const detail = editingLocationRecordId.value
      ? await updateVehicleLocationEvent(
          vehicleDetail.value.vehicle.id,
          editingLocationRecordId.value,
          {
            ...locationForm,
            operator: "营运端"
          }
        )
      : await createVehicleLocationEvent(vehicleDetail.value.vehicle.id, {
          ...locationForm,
          operator: "营运端"
        });
    syncVehicleDetail(detail);
    locationDialogVisible.value = false;
    editingLocationRecordId.value = "";
    activeDetailTab.value = "LOCATION";
    ElMessage.success(isEditing ? "出入站流水已更新" : "出入站流水已新增");
  } catch {
    ElMessage.error(editingLocationRecordId.value ? "出入站流水更新失败" : "出入站流水新增失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function openMaintenanceDialog() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  Object.assign(maintenanceForm, {
    type: "临时维保",
    vendor: "门店自检",
    mileage: vehicleDetail.value.vehicle.mileage,
    costAmount: 0,
    status: "processing",
    remark: ""
  });
  maintenanceDialogVisible.value = true;
}

async function submitMaintenanceRecord() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  if (!maintenanceForm.type || !maintenanceForm.vendor) {
    ElMessage.warning("请填写维保类型和维保厂商");
    return;
  }
  if (maintenanceForm.mileage < 0 || maintenanceForm.costAmount < 0) {
    ElMessage.warning("里程和费用不能小于 0");
    return;
  }

  detailActionLoading.value = true;
  try {
    const detail = await createVehicleMaintenanceRecord(vehicleDetail.value.vehicle.id, {
      ...maintenanceForm,
      operator: "营运端"
    });
    syncVehicleDetail(detail);
    maintenanceDialogVisible.value = false;
    activeDetailTab.value = "RISK";
    ElMessage.success("维保记录已新增");
  } catch {
    ElMessage.error("维保记录新增失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function openAccidentDialog() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  Object.assign(accidentForm, {
    description: "",
    claimStatus: "processing",
    estimatedCostAmount: 0,
    reportNo: ""
  });
  accidentDialogVisible.value = true;
}

async function submitAccidentRecord() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  if (!accidentForm.description) {
    ElMessage.warning("请填写事故/出险描述");
    return;
  }
  if (accidentForm.estimatedCostAmount < 0) {
    ElMessage.warning("预估费用不能小于 0");
    return;
  }

  detailActionLoading.value = true;
  try {
    const detail = await createVehicleAccidentRecord(vehicleDetail.value.vehicle.id, {
      ...accidentForm,
      operator: "营运端"
    });
    syncVehicleDetail(detail);
    accidentDialogVisible.value = false;
    activeDetailTab.value = "RISK";
    ElMessage.success("事故/出险记录已新增");
  } catch {
    ElMessage.error("事故/出险记录新增失败");
  } finally {
    detailActionLoading.value = false;
  }
}

async function completeMaintenanceRecord(recordId: string) {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  detailActionLoading.value = true;
  try {
    const detail = await updateVehicleMaintenanceRecord(vehicleDetail.value.vehicle.id, recordId, {
      status: "completed",
      operator: "营运端"
    });
    syncVehicleDetail(detail);
    ElMessage.success("维保记录已完成");
  } catch {
    ElMessage.error("维保记录更新失败");
  } finally {
    detailActionLoading.value = false;
  }
}

async function closeAccidentRecord(recordId: string) {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆状态动作权限");
    return;
  }

  detailActionLoading.value = true;
  try {
    const detail = await updateVehicleAccidentRecord(vehicleDetail.value.vehicle.id, recordId, {
      claimStatus: "closed",
      operator: "营运端"
    });
    syncVehicleDetail(detail);
    ElMessage.success("事故/出险记录已结案");
  } catch {
    ElMessage.error("事故/出险记录更新失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function openCredentialDialog(record?: VehicleCredentialRecord) {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆证照维护权限");
    return;
  }

  editingCredentialId.value = record?.id ?? "";
  Object.assign(credentialForm, {
    id: record?.id,
    credentialType: record?.credentialType ?? "license",
    credentialName: record?.credentialName ?? "",
    certNo: record?.certNo ?? "",
    status: record?.status,
    issueAt: record?.issueAt ?? "",
    expiresAt: record?.expiresAt ?? "",
    reminderDays: record?.reminderDays ?? 30,
    attachments: record?.attachments ? [...record.attachments] : [],
    operator: "营运端"
  });
  credentialAttachmentText.value = record?.attachments?.join("\n") ?? "";
  credentialDialogVisible.value = true;
}

async function submitVehicleCredential() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有车辆证照维护权限");
    return;
  }
  if (!credentialForm.credentialName || !credentialForm.certNo) {
    ElMessage.warning("请填写证照名称和证件编号");
    return;
  }

  detailActionLoading.value = true;
  try {
    const attachments = credentialAttachmentText.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const records = await saveVehicleCredential(vehicleDetail.value.vehicle.id, {
      ...credentialForm,
      id: editingCredentialId.value || undefined,
      attachments
    });
    vehicleDetail.value = {
      ...vehicleDetail.value,
      credentialRecords: records
    };
    credentialDialogVisible.value = false;
    activeDetailTab.value = "ASSETS";
    ElMessage.success("车辆证照已保存");
  } catch {
    ElMessage.error("车辆证照保存失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function openOnboardItemDialog(record?: VehicleOnboardItemRecord) {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有随车物资维护权限");
    return;
  }

  editingOnboardItemId.value = record?.id ?? "";
  Object.assign(onboardItemForm, {
    id: record?.id,
    category: record?.category ?? "key",
    itemName: record?.itemName ?? "",
    standardQuantity: record?.standardQuantity ?? 1,
    actualQuantity: record?.actualQuantity ?? 1,
    status: record?.status ?? "normal",
    priceAmount: record?.priceAmount ?? 0,
    checkedAt: record?.checkedAt ?? "",
    operator: "营运端",
    remark: record?.remark ?? ""
  });
  onboardItemDialogVisible.value = true;
}

async function submitVehicleOnboardItem() {
  if (!vehicleDetail.value) {
    return;
  }
  if (!canRunVehicleStatusAction.value) {
    ElMessage.warning("当前角色没有随车物资维护权限");
    return;
  }
  if (!onboardItemForm.itemName) {
    ElMessage.warning("请填写随车物资名称");
    return;
  }
  if (onboardItemForm.standardQuantity < 0 || onboardItemForm.actualQuantity < 0) {
    ElMessage.warning("物资数量不能为负数");
    return;
  }

  detailActionLoading.value = true;
  try {
    const records = await saveVehicleOnboardItem(vehicleDetail.value.vehicle.id, {
      ...onboardItemForm,
      id: editingOnboardItemId.value || undefined
    });
    vehicleDetail.value = {
      ...vehicleDetail.value,
      onboardItems: records
    };
    onboardItemDialogVisible.value = false;
    activeDetailTab.value = "ASSETS";
    ElMessage.success("随车物资已保存");
  } catch {
    ElMessage.error("随车物资保存失败");
  } finally {
    detailActionLoading.value = false;
  }
}

function orderStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending_payment: "待支付",
    reserved: "已预订",
    pickup_overdue: "逾期未取",
    inspecting: "验车中",
    renting: "租赁中",
    renewing: "续租中",
    overdue: "逾期中",
    settlement_pending: "待结算",
    payment_due: "待补缴",
    refund_pending: "待退款",
    completed: "已完成",
    cancelled: "已取消",
    no_show: "爽约"
  };
  return map[status] ?? status;
}

function locationEventTypeLabel(type: string) {
  const map: Record<string, string> = {
    pickup: "取车",
    return: "还车",
    transfer: "调拨",
    manual_adjust: "人工调整",
    iot_sync: "车机同步"
  };
  return map[type] ?? type;
}

function photoSceneLabel(scene: string) {
  const map: Record<string, string> = {
    pickup: "取车验车",
    return: "还车验车",
    maintenance: "维保",
    manual: "人工记录"
  };
  return map[scene] ?? scene;
}

function claimStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待处理",
    processing: "处理中",
    closed: "已结案"
  };
  return map[status] ?? status;
}

function credentialTypeLabel(type: VehicleCredentialRecord["credentialType"]) {
  const map: Record<VehicleCredentialRecord["credentialType"], string> = {
    license: "行驶/登记证",
    insurance: "保险",
    inspection: "年检",
    permit: "营运许可",
    other: "其他"
  };
  return map[type];
}

function credentialStatusLabel(status: VehicleCredentialRecord["status"]) {
  const map: Record<VehicleCredentialRecord["status"], string> = {
    valid: "有效",
    expiring: "即将到期",
    expired: "已到期",
    missing: "缺失"
  };
  return map[status];
}

function credentialStatusType(status: VehicleCredentialRecord["status"]) {
  return status === "valid" ? "success" : status === "expiring" ? "warning" : "danger";
}

function onboardItemCategoryLabel(category: VehicleOnboardItemRecord["category"]) {
  const map: Record<VehicleOnboardItemRecord["category"], string> = {
    key: "钥匙/卡片",
    document: "随车文件",
    equipment: "随车工具",
    cleaning: "清洁整备",
    other: "其他"
  };
  return map[category];
}

function onboardItemStatusLabel(status: VehicleOnboardItemRecord["status"]) {
  const map: Record<VehicleOnboardItemRecord["status"], string> = {
    normal: "正常",
    missing: "缺失",
    damaged: "损坏"
  };
  return map[status];
}

function onboardItemStatusType(status: VehicleOnboardItemRecord["status"]) {
  return status === "normal" ? "success" : status === "missing" ? "danger" : "warning";
}

function isCurrentOccupancy(status: string) {
  return ["renting", "renewing", "overdue", "settlement_pending", "payment_due", "refund_pending", "accident_processing"].includes(status);
}

onMounted(async () => {
  await loadFilterPresets();
  await loadRows();
});
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800 tracking-tight">车辆档案库</h1>
        <p class="text-gray-500 text-sm mt-1">管理所有车辆实例，监控状态、里程及服务能力。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>
        新增车辆
      </el-button>
    </div>

    <div class="rimo-card p-5">
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <el-input
          v-model="searchQuery"
          placeholder="车牌号 / VIN"
          prefix-icon="Search"
          clearable
          style="width: 240px"
          @keyup.enter="applyVehicleFilters"
        />
        <el-select placeholder="资产归属" style="width: 150px">
          <el-option label="RIMO 香港租户" value="rimo" />
        </el-select>
        <el-select v-model="storeFilter" placeholder="当前位置" clearable style="width: 210px">
          <el-option
            v-for="store in storeOptions"
            :key="store"
            :label="store"
            :value="store"
          />
        </el-select>
        <el-select v-model="statusFilter" placeholder="营运状态" clearable style="width: 150px">
          <el-option label="空闲" value="idle" />
          <el-option label="已预约" value="reserved" />
          <el-option label="租赁中" value="renting" />
          <el-option label="整备中" value="controlled" />
          <el-option label="维保" value="maintenance" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-select v-model="serviceFilter" placeholder="服务类型" clearable style="width: 180px">
          <el-option label="门市租赁" value="STORE_STANDARD" />
          <el-option label="24H门市" value="STORE_24H" />
        </el-select>
        <el-select
          v-model="selectedFilterPresetId"
          placeholder="筛选预设"
          clearable
          :loading="filterPresetLoading"
          style="width: 180px"
          @change="applySelectedFilterPreset"
        >
          <el-option
            v-for="preset in filterPresets"
            :key="preset.id"
            :label="preset.isDefault ? `${preset.name}（默认）` : preset.name"
            :value="preset.id"
          />
        </el-select>
        <el-button icon="Collection" plain @click="saveCurrentFilterPreset">
          保存视图
        </el-button>
        <el-tooltip content="设为默认" placement="top">
          <el-button
            icon="Star"
            circle
            :disabled="!selectedFilterPresetId"
            @click="setCurrentFilterPresetDefault"
          />
        </el-tooltip>
        <el-tooltip content="删除预设" placement="top">
          <el-button
            icon="Delete"
            circle
            :disabled="!selectedFilterPresetId"
            @click="deleteCurrentFilterPreset"
          />
        </el-tooltip>
        <el-button icon="Refresh" circle @click="resetVehicleFilters" />
        <el-button type="primary" plain @click="applyVehicleFilters">查询</el-button>
        <el-button
          v-if="canRunVehicleStatusAction"
          plain
          :disabled="selectedVehicles.length === 0"
          @click="batchSetEnabled(true)"
        >
          批量启用
        </el-button>
        <el-button
          v-if="canRunVehicleStatusAction"
          plain
          type="warning"
          :disabled="selectedVehicles.length === 0"
          @click="batchSetEnabled(false)"
        >
          批量停用
        </el-button>
      </div>

      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        style="width: 100%"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="40" />
        <el-table-column label="车辆信息" min-width="240">
          <template #default="{ row }">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                <el-icon><Van /></el-icon>
              </div>
              <div>
                <div class="font-mono font-bold text-gray-900">{{ row.licensePlate }}</div>
                <div class="text-xs text-gray-500">{{ row.vehicleGroupName }}</div>
                <div class="text-xs text-gray-400">VIN: {{ row.vin }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="资产归属" min-width="180">
          <template #default="{ row }">{{ row.assetCompanyName }}</template>
        </el-table-column>
        <el-table-column label="当前位置" min-width="180">
          <template #default="{ row }">
            <div class="font-medium text-gray-800">{{ row.currentStoreName }}</div>
            <div class="text-xs text-gray-500">{{ row.currentStationName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="营运状态" width="110">
          <template #default="{ row }">
            <el-tag :type="operationStatusType(row.operationStatus)" effect="plain">{{ operationStatusName(row.operationStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="是否启用" width="90" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :loading="actionLoading === row.id"
              :disabled="!canRunVehicleStatusAction"
              @change="toggleVehicleEnabled(row, !row.enabled)"
            />
          </template>
        </el-table-column>
        <el-table-column label="当前上架" width="150">
          <template #default="{ row }">
            <el-tag type="warning" effect="plain">{{ serviceTypeName(row.currentServiceType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="里程" width="120" prop="mileage" sortable>
          <template #default="{ row }">{{ row.mileage.toLocaleString() }} km</template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="right" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="primary" link @click="openVehicleDetail(row)">详情</el-button>
            <el-dropdown v-if="canRunVehicleStatusAction">
              <el-button type="primary" link>
                更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :disabled="row.operationStatus === 'renting'" @click="setMaintenance(row)">发起维保</el-dropdown-item>
                  <el-dropdown-item @click="finishMaintenance(row)">结束维保</el-dropdown-item>
                  <el-dropdown-item divided>删除车辆</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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
          @size-change="handleVehiclePageSizeChange"
        />
      </div>
    </div>

    <el-drawer v-model="detailDrawerVisible" size="80%" :with-header="false" destroy-on-close>
      <div v-loading="detailLoading" class="h-full bg-slate-50 flex flex-col" v-if="vehicleDetail">
        <div class="px-8 py-6 bg-white border-b border-slate-200 flex items-start justify-between gap-6">
          <div>
            <div class="flex items-center gap-4">
              <h2 class="text-3xl font-mono font-bold text-gray-900 tracking-tight">
                {{ vehicleDetail.vehicle.licensePlate }}
              </h2>
              <el-tag :type="operationStatusType(vehicleDetail.vehicle.operationStatus)" effect="light" round size="large">
                {{ operationStatusName(vehicleDetail.vehicle.operationStatus) }}
              </el-tag>
              <el-tag :type="vehicleDetail.vehicle.enabled ? 'success' : 'info'" effect="plain">
                {{ vehicleDetail.vehicle.enabled ? "已启用" : "已停用" }}
              </el-tag>
            </div>
            <div class="mt-2 text-sm text-gray-500 flex flex-wrap items-center gap-3">
              <span class="font-medium text-gray-700">{{ vehicleDetail.vehicle.vehicleGroupName }}</span>
              <span class="h-3 w-px bg-gray-300"></span>
              <span class="font-mono">VIN: {{ vehicleDetail.vehicle.vin || "未登记" }}</span>
              <span class="h-3 w-px bg-gray-300"></span>
              <span>{{ vehicleDetail.vehicle.assetCompanyName }}</span>
            </div>
          </div>
          <div class="flex gap-3 shrink-0">
            <el-button icon="Edit" plain @click="openEdit(vehicleDetail.vehicle)">编辑资料</el-button>
            <el-button v-if="canRunVehicleStatusAction" plain @click="openTransferDialog">车辆调拨</el-button>
            <el-button
              v-if="canRunVehicleStatusAction && vehicleDetail.vehicle.operationStatus !== 'maintenance'"
              icon="Tools"
              type="warning"
              plain
              @click="setMaintenance(vehicleDetail.vehicle)"
            >
              发起维保
            </el-button>
            <el-button
              v-else-if="canRunVehicleStatusAction"
              icon="CircleCheck"
              type="success"
              plain
              @click="finishMaintenance(vehicleDetail.vehicle)"
            >
              结束维保
            </el-button>
          </div>
        </div>

        <div class="px-8 py-4 bg-white border-b border-slate-100 grid grid-cols-4 gap-6">
          <div>
            <div class="text-[11px] text-gray-400 font-bold uppercase">当前位置</div>
            <div class="mt-1 font-semibold text-gray-800">{{ vehicleDetail.vehicle.currentStoreName }}</div>
            <div class="text-xs text-gray-500">{{ vehicleDetail.vehicle.currentStationName }}</div>
          </div>
          <div>
            <div class="text-[11px] text-gray-400 font-bold uppercase">当前上架</div>
            <div class="mt-1">
              <el-tag type="warning" effect="plain">{{ serviceTypeName(vehicleDetail.vehicle.currentServiceType) }}</el-tag>
              <span class="ml-2 text-xs text-gray-500">可服务 {{ vehicleDetail.vehicle.serviceTypes.length }} 项</span>
            </div>
          </div>
          <div>
            <div class="text-[11px] text-gray-400 font-bold uppercase">里程</div>
            <div class="mt-1 font-mono text-xl font-bold text-gray-900">{{ vehicleDetail.vehicle.mileage.toLocaleString() }} km</div>
          </div>
          <div>
            <div class="text-[11px] text-gray-400 font-bold uppercase">最近操作</div>
            <div class="mt-1 text-sm font-semibold text-gray-800">{{ vehicleDetail.vehicle.lastOperationBy || "系统初始化" }}</div>
            <div class="text-xs text-gray-500">{{ vehicleDetail.vehicle.lastOperationAt || "暂无记录" }}</div>
          </div>
        </div>

        <div v-if="occupancyOrders.length > 0" class="px-8 py-4 border-b border-amber-100 bg-amber-50/70">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-sm font-semibold text-amber-900">车辆占用排程提示</div>
              <div class="mt-1 text-xs text-amber-700">
                当前车辆存在 {{ occupancyOrders.length }} 条有效订单占用记录，调拨、停用、改派前需先核对履约影响。
              </div>
            </div>
            <el-button link type="warning" @click="activeDetailTab = 'ORDERS'">查看订单记录</el-button>
          </div>
          <div class="mt-3 grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div
              v-for="order in occupancyOrders.slice(0, 3)"
              :key="order.orderId"
              class="rounded-lg border border-amber-200 bg-white px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="font-mono text-sm font-semibold text-gray-900">{{ order.orderNo }}</div>
                <el-tag :type="isCurrentOccupancy(order.mainStatus) ? 'danger' : 'warning'" effect="plain">
                  {{ isCurrentOccupancy(order.mainStatus) ? "当前占用" : "未来占用" }}
                </el-tag>
              </div>
              <div class="mt-2 text-sm text-gray-700">{{ order.customerName }}</div>
              <div class="mt-1 text-xs text-gray-500">{{ order.pickupAt }} 至 {{ order.returnAt }}</div>
            </div>
          </div>
        </div>

        <el-tabs v-model="activeDetailTab" class="flex-1 overflow-hidden px-8 pt-4">
          <el-tab-pane label="车辆概况" name="OVERVIEW" class="h-full overflow-y-auto pb-8">
            <div class="grid grid-cols-12 gap-5">
              <div class="col-span-12 xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                <el-descriptions title="车辆基础档案" :column="3" border>
                  <el-descriptions-item label="车牌号">{{ vehicleDetail.vehicle.licensePlate }}</el-descriptions-item>
                  <el-descriptions-item label="颜色">{{ vehicleDetail.vehicle.color || "未登记" }}</el-descriptions-item>
                  <el-descriptions-item label="设备 CID">{{ vehicleDetail.vehicle.cid || "未绑定" }}</el-descriptions-item>
                  <el-descriptions-item label="车型组" :span="2">{{ vehicleDetail.vehicle.vehicleGroupName }}</el-descriptions-item>
                  <el-descriptions-item label="特殊车辆">{{ vehicleDetail.vehicle.isSpecial ? "是" : "否" }}</el-descriptions-item>
                  <el-descriptions-item label="资产所属" :span="2">{{ vehicleDetail.vehicle.assetCompanyName }}</el-descriptions-item>
                  <el-descriptions-item label="当前位置">{{ vehicleDetail.vehicle.currentStoreName }} / {{ vehicleDetail.vehicle.currentStationName }}</el-descriptions-item>
                  <el-descriptions-item label="可服务类型" :span="3">
                    <el-tag v-for="type in vehicleDetail.vehicle.serviceTypes" :key="type" class="mr-2" effect="plain">
                      {{ serviceTypeName(type) }}
                    </el-tag>
                  </el-descriptions-item>
                </el-descriptions>
              </div>

              <div class="col-span-12 xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="font-bold text-gray-800">最新车况照片</h3>
                  <div class="flex items-center gap-3">
                    <el-button link type="primary" size="small" @click="openPhotoDialog">补录照片</el-button>
                    <el-button link type="primary" size="small" @click="photoHistoryVisible = true">查看历史照片</el-button>
                  </div>
                </div>
                <template v-if="vehicleDetail.conditionPhotos[0]">
                  <div class="grid grid-cols-2 gap-3">
                    <img
                      v-for="photo in vehicleDetail.conditionPhotos[0].photos.slice(0, 4)"
                      :key="photo"
                      :src="photo"
                      class="h-28 w-full rounded-lg object-cover border border-slate-200"
                    />
                  </div>
                  <div class="mt-3 text-sm text-gray-700">{{ vehicleDetail.conditionPhotos[0].remark }}</div>
                  <div class="mt-1 text-xs text-gray-500">
                    {{ photoSceneLabel(vehicleDetail.conditionPhotos[0].scene) }} · {{ vehicleDetail.conditionPhotos[0].operator }} · {{ vehicleDetail.conditionPhotos[0].at }}
                  </div>
                </template>
                <el-empty v-else description="暂无车况照片" :image-size="80" />
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="证照与物资" name="ASSETS" class="h-full overflow-y-auto pb-8">
            <div class="grid grid-cols-12 gap-5">
              <div class="col-span-12 xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
                <div class="flex items-center justify-between mb-4">
                  <div>
                    <div class="font-bold text-gray-800">车辆证照档案</div>
                    <div class="text-xs text-gray-500 mt-1">维护行驶证、保险、年检和营运许可，到期状态会进入车辆可用性判断。</div>
                  </div>
                  <el-button
                    v-if="canRunVehicleStatusAction"
                    type="primary"
                    size="small"
                    plain
                    icon="Plus"
                    @click="openCredentialDialog()"
                  >
                    新增证照
                  </el-button>
                </div>
                <el-table :data="vehicleDetail.credentialRecords" size="small" border empty-text="暂无证照记录">
                  <el-table-column label="证照类型" width="110">
                    <template #default="{ row }">{{ credentialTypeLabel(row.credentialType) }}</template>
                  </el-table-column>
                  <el-table-column prop="credentialName" label="证照名称" min-width="150" />
                  <el-table-column prop="certNo" label="证件编号" min-width="150" />
                  <el-table-column label="状态" width="105">
                    <template #default="{ row }">
                      <el-tag :type="credentialStatusType(row.status)" effect="plain">
                        {{ credentialStatusLabel(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="有效期" width="180">
                    <template #default="{ row }">
                      <div class="text-xs text-gray-700">{{ row.expiresAt || "未登记" }}</div>
                      <div class="text-[11px] text-gray-400">提前 {{ row.reminderDays }} 天提醒</div>
                    </template>
                  </el-table-column>
                  <el-table-column label="附件" width="80" align="center">
                    <template #default="{ row }">{{ row.attachments.length }}</template>
                  </el-table-column>
                  <el-table-column label="操作" width="90" align="center">
                    <template #default="{ row }">
                      <el-button
                        v-if="canRunVehicleStatusAction"
                        link
                        type="primary"
                        :disabled="detailActionLoading"
                        @click="openCredentialDialog(row)"
                      >
                        编辑
                      </el-button>
                      <span v-else class="text-xs text-slate-400">无权限</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <div class="col-span-12 xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
                <div class="flex items-center justify-between mb-4">
                  <div>
                    <div class="font-bold text-gray-800">随车物资</div>
                    <div class="text-xs text-gray-500 mt-1">记录钥匙、ETC、工具、清洁物资等交接基线。</div>
                  </div>
                  <el-button
                    v-if="canRunVehicleStatusAction"
                    type="primary"
                    size="small"
                    plain
                    icon="Plus"
                    @click="openOnboardItemDialog()"
                  >
                    新增物资
                  </el-button>
                </div>
                <el-table :data="vehicleDetail.onboardItems" size="small" border empty-text="暂无随车物资">
                  <el-table-column label="类别" width="100">
                    <template #default="{ row }">{{ onboardItemCategoryLabel(row.category) }}</template>
                  </el-table-column>
                  <el-table-column prop="itemName" label="物资名称" min-width="130" />
                  <el-table-column label="数量" width="90">
                    <template #default="{ row }">{{ row.actualQuantity }} / {{ row.standardQuantity }}</template>
                  </el-table-column>
                  <el-table-column label="状态" width="90">
                    <template #default="{ row }">
                      <el-tag :type="onboardItemStatusType(row.status)" effect="plain">
                        {{ onboardItemStatusLabel(row.status) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="80" align="center">
                    <template #default="{ row }">
                      <el-button
                        v-if="canRunVehicleStatusAction"
                        link
                        type="primary"
                        :disabled="detailActionLoading"
                        @click="openOnboardItemDialog(row)"
                      >
                        编辑
                      </el-button>
                      <span v-else class="text-xs text-slate-400">无权限</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="订单记录" name="ORDERS" class="h-full overflow-y-auto pb-8">
            <el-table :data="vehicleDetail.relatedOrders" border stripe>
              <el-table-column prop="orderNo" label="订单号" min-width="160" />
              <el-table-column prop="customerName" label="客户" width="120" />
              <el-table-column label="租期" min-width="260">
                <template #default="{ row }">{{ row.pickupAt }} 至 {{ row.returnAt }}</template>
              </el-table-column>
              <el-table-column label="门市" min-width="180">
                <template #default="{ row }">{{ row.pickupStoreName }} / {{ row.returnStoreName }}</template>
              </el-table-column>
              <el-table-column label="状态" width="110">
                <template #default="{ row }">
                  <el-tag effect="plain">{{ orderStatusLabel(row.mainStatus) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="120" align="right">
                <template #default="{ row }">¥{{ row.totalAmount }}</template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="出入站流水" name="LOCATION" class="h-full overflow-y-auto pb-8">
            <div class="mb-4 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
              <div>
                <div class="text-sm font-semibold text-gray-800">车辆出入站与位置流水</div>
                <div class="text-xs text-gray-500 mt-1">支持补录调拨、人工调整和门市履约位置记录。</div>
              </div>
              <el-button type="primary" size="small" plain icon="Plus" @click="openLocationDialog">新增流水</el-button>
            </div>
            <el-table :data="vehicleDetail.locationEvents" border stripe>
              <el-table-column prop="at" label="时间" width="190" />
              <el-table-column label="类型" width="110">
                <template #default="{ row }">
                  <el-tag effect="plain">{{ locationEventTypeLabel(row.type) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="站点/停车场" min-width="220">
                <template #default="{ row }">
                  <div class="font-medium text-gray-800">{{ row.storeName }}</div>
                  <div class="text-xs text-gray-500">{{ row.stationName }}</div>
                </template>
              </el-table-column>
              <el-table-column label="里程" width="130">
                <template #default="{ row }">{{ row.mileage.toLocaleString() }} km</template>
              </el-table-column>
              <el-table-column prop="operator" label="操作人" width="120" />
              <el-table-column prop="note" label="说明" min-width="220" />
              <el-table-column label="操作" width="90" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="canRunVehicleStatusAction && row.source !== 'order'"
                    link
                    type="primary"
                    :disabled="detailActionLoading"
                    @click="openLocationDialog(row)"
                  >
                    编辑
                  </el-button>
                  <span v-else class="text-xs text-slate-400">{{ row.source === "order" ? "系统记录" : "无权限" }}</span>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="维保与事故" name="RISK" class="h-full overflow-y-auto pb-8">
            <div class="grid grid-cols-12 gap-5">
              <div class="col-span-12 xl:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
                <div class="flex items-center justify-between mb-4">
                  <div class="font-bold text-gray-800">维保记录</div>
                  <el-button
                    v-if="canRunVehicleStatusAction"
                    type="primary"
                    size="small"
                    plain
                    icon="Plus"
                    @click="openMaintenanceDialog"
                  >
                    新增记录
                  </el-button>
                </div>
                <el-table :data="vehicleDetail.maintenanceRecords" size="small" border>
                  <el-table-column prop="date" label="日期" width="110" />
                  <el-table-column prop="type" label="类型" width="110" />
                  <el-table-column prop="vendor" label="厂商" min-width="140" />
                  <el-table-column label="状态" width="96">
                    <template #default="{ row }">
                      <el-tag :type="row.status === 'completed' ? 'success' : 'warning'" effect="plain">
                        {{ row.status === "completed" ? "已完成" : row.status === "pending" ? "待处理" : "处理中" }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="费用" width="100">
                    <template #default="{ row }">¥{{ row.costAmount }}</template>
                  </el-table-column>
                  <el-table-column prop="remark" label="说明" min-width="180" />
                  <el-table-column label="操作" width="90" align="center">
                    <template #default="{ row }">
                      <el-button
                        v-if="canRunVehicleStatusAction && row.status !== 'completed'"
                        link
                        type="primary"
                        :disabled="detailActionLoading"
                        @click="completeMaintenanceRecord(row.id)"
                      >
                        完成
                      </el-button>
                      <span v-else class="text-xs text-slate-400">{{ row.status === "completed" ? "已完成" : "无权限" }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div class="col-span-12 xl:col-span-6 bg-white border border-slate-200 rounded-lg p-5">
                <div class="flex items-center justify-between mb-4">
                  <div class="font-bold text-gray-800">事故/出险记录</div>
                  <el-button
                    v-if="canRunVehicleStatusAction"
                    type="primary"
                    size="small"
                    plain
                    icon="Plus"
                    @click="openAccidentDialog"
                  >
                    新增记录
                  </el-button>
                </div>
                <el-table :data="vehicleDetail.accidentRecords" size="small" border empty-text="暂无事故记录">
                  <el-table-column prop="date" label="日期" width="110" />
                  <el-table-column prop="description" label="事故描述" min-width="180" />
                  <el-table-column label="理赔状态" width="110">
                    <template #default="{ row }">
                      <el-tag :type="row.claimStatus === 'closed' ? 'success' : 'warning'" effect="plain">
                        {{ claimStatusLabel(row.claimStatus) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="预估费用" width="110">
                    <template #default="{ row }">¥{{ row.estimatedCostAmount }}</template>
                  </el-table-column>
                  <el-table-column label="操作" width="90" align="center">
                    <template #default="{ row }">
                      <el-button
                        v-if="canRunVehicleStatusAction && row.claimStatus !== 'closed'"
                        link
                        type="primary"
                        :disabled="detailActionLoading"
                        @click="closeAccidentRecord(row.id)"
                      >
                        结案
                      </el-button>
                      <span v-else class="text-xs text-slate-400">{{ row.claimStatus === "closed" ? "已结案" : "无权限" }}</span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="操作记录" name="LOGS" class="h-full overflow-y-auto pb-8">
            <el-table :data="vehicleDetail.operationLogs" border stripe>
              <el-table-column prop="at" label="时间" width="190" />
              <el-table-column prop="operator" label="操作人" width="130" />
              <el-table-column prop="action" label="动作" min-width="160" />
              <el-table-column prop="reason" label="原因/说明" min-width="260" />
              <el-table-column prop="ip" label="IP" width="130" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-drawer>

    <el-dialog v-model="photoHistoryVisible" title="历史车况照片" width="760px" append-to-body destroy-on-close>
      <el-timeline v-if="vehicleDetail">
        <el-timeline-item
          v-for="record in vehicleDetail.conditionPhotos"
          :key="record.id"
          :timestamp="record.at"
          placement="top"
        >
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div class="font-semibold text-gray-800">{{ photoSceneLabel(record.scene) }} · {{ record.operator }}</div>
            <div class="text-sm text-gray-600 mt-1">{{ record.remark }}</div>
            <div class="grid grid-cols-3 gap-3 mt-3">
              <img v-for="photo in record.photos" :key="photo" :src="photo" class="h-28 w-full rounded-lg object-cover border border-slate-200" />
            </div>
          </div>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>

    <el-dialog v-model="photoDialogVisible" title="补录车况照片" width="620px" append-to-body destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="照片场景" required class="col-span-12 md:col-span-6">
            <el-select v-model="photoForm.scene" class="w-full">
              <el-option label="人工记录" value="manual" />
              <el-option label="取车验车" value="pickup" />
              <el-option label="还车验车" value="return" />
              <el-option label="维保留档" value="maintenance" />
            </el-select>
          </el-form-item>
          <el-form-item label="图片地址" required class="col-span-12">
            <el-input
              v-model="photoUrlText"
              type="textarea"
              :rows="4"
              placeholder="每行一张图片 URL，可先用对象存储地址或示意图地址"
            />
          </el-form-item>
          <el-form-item label="照片说明" required class="col-span-12">
            <el-input
              v-model="photoForm.remark"
              type="textarea"
              :rows="3"
              placeholder="记录拍摄场景、车辆状态、损伤说明或交接结论"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="photoDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="detailActionLoading" @click="submitPhotoRecord">保存照片</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="locationDialogVisible"
      :title="editingLocationRecordId ? '编辑出入站流水' : locationForm.type === 'transfer' ? '车辆调拨' : '新增出入站流水'"
      width="620px"
      append-to-body
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="流水类型" required class="col-span-12 md:col-span-6">
            <el-select v-model="locationForm.type" class="w-full">
              <el-option label="人工调整" value="manual_adjust" />
              <el-option label="车辆调拨" value="transfer" />
              <el-option label="取车" value="pickup" />
              <el-option label="还车" value="return" />
              <el-option label="车机同步" value="iot_sync" />
            </el-select>
          </el-form-item>
          <el-form-item label="发生时间" class="col-span-12 md:col-span-6">
            <el-date-picker
              v-model="locationForm.at"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              class="w-full"
              placeholder="请选择时间"
            />
          </el-form-item>
          <el-form-item label="所属门市" required class="col-span-12 md:col-span-6">
            <el-select
              v-model="locationForm.storeName"
              class="w-full"
              placeholder="请选择门市"
              @change="locationForm.stationName = ''"
            >
              <el-option v-for="store in storeOptions" :key="store" :label="store" :value="store" />
            </el-select>
          </el-form-item>
          <el-form-item label="所属站点" required class="col-span-12 md:col-span-6">
            <el-select v-model="locationForm.stationName" class="w-full" placeholder="请选择站点">
              <el-option
                v-for="station in detailStationOptionsByStore"
                :key="station.id"
                :label="station.name"
                :value="station.name"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="当前里程 (km)" class="col-span-12 md:col-span-6">
            <el-input-number v-model="locationForm.mileage" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="说明" class="col-span-12">
            <el-input
              v-model="locationForm.note"
              type="textarea"
              :rows="3"
              placeholder="记录调拨原因、停车场变化、补录依据等"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="locationDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canRunVehicleStatusAction"
          :loading="detailActionLoading"
          @click="submitLocationEvent"
        >
          保存流水
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="maintenanceDialogVisible" title="新增维保记录" width="560px" append-to-body destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="维保类型" required class="col-span-12 md:col-span-6">
            <el-select v-model="maintenanceForm.type" class="w-full">
              <el-option label="临时维保" value="临时维保" />
              <el-option label="例行保养" value="例行保养" />
              <el-option label="故障检修" value="故障检修" />
              <el-option label="清洁整备" value="清洁整备" />
            </el-select>
          </el-form-item>
          <el-form-item label="维保厂商" required class="col-span-12 md:col-span-6">
            <el-input v-model="maintenanceForm.vendor" placeholder="请输入厂商/门店" />
          </el-form-item>
          <el-form-item label="当前里程 (km)" class="col-span-12 md:col-span-6">
            <el-input-number v-model="maintenanceForm.mileage" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="费用" class="col-span-12 md:col-span-6">
            <el-input-number v-model="maintenanceForm.costAmount" :min="0" :precision="2" class="w-full" />
          </el-form-item>
          <el-form-item label="处理状态" class="col-span-12">
            <el-radio-group v-model="maintenanceForm.status">
              <el-radio-button label="pending">待处理</el-radio-button>
              <el-radio-button label="processing">处理中</el-radio-button>
              <el-radio-button label="completed">已完成</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="说明" class="col-span-12">
            <el-input v-model="maintenanceForm.remark" type="textarea" :rows="3" placeholder="记录维保原因、处理项或预计完成时间" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="maintenanceDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canRunVehicleStatusAction"
          :loading="detailActionLoading"
          @click="submitMaintenanceRecord"
        >
          保存记录
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="accidentDialogVisible" title="新增事故/出险记录" width="560px" append-to-body destroy-on-close>
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="理赔状态" class="col-span-12 md:col-span-6">
            <el-radio-group v-model="accidentForm.claimStatus">
              <el-radio-button label="pending">待处理</el-radio-button>
              <el-radio-button label="processing">处理中</el-radio-button>
              <el-radio-button label="closed">已结案</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="预估费用" class="col-span-12 md:col-span-6">
            <el-input-number v-model="accidentForm.estimatedCostAmount" :min="0" :precision="2" class="w-full" />
          </el-form-item>
          <el-form-item label="报案号/理赔号" class="col-span-12">
            <el-input v-model="accidentForm.reportNo" placeholder="为空时系统自动生成" />
          </el-form-item>
          <el-form-item label="事故/出险描述" required class="col-span-12">
            <el-input v-model="accidentForm.description" type="textarea" :rows="4" placeholder="记录事故位置、损伤范围、客户责任和处理进度" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="accidentDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canRunVehicleStatusAction"
          :loading="detailActionLoading"
          @click="submitAccidentRecord"
        >
          保存记录
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="credentialDialogVisible"
      :title="editingCredentialId ? '编辑车辆证照' : '新增车辆证照'"
      width="640px"
      append-to-body
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="证照类型" required class="col-span-12 md:col-span-6">
            <el-select v-model="credentialForm.credentialType" class="w-full">
              <el-option label="行驶/登记证" value="license" />
              <el-option label="保险" value="insurance" />
              <el-option label="年检" value="inspection" />
              <el-option label="营运许可" value="permit" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="证照状态" class="col-span-12 md:col-span-6">
            <el-select v-model="credentialForm.status" clearable class="w-full" placeholder="不填则按到期日自动判断">
              <el-option label="有效" value="valid" />
              <el-option label="即将到期" value="expiring" />
              <el-option label="已到期" value="expired" />
              <el-option label="缺失" value="missing" />
            </el-select>
          </el-form-item>
          <el-form-item label="证照名称" required class="col-span-12 md:col-span-6">
            <el-input v-model="credentialForm.credentialName" placeholder="例如：车辆保险 / 行驶证" />
          </el-form-item>
          <el-form-item label="证件编号" required class="col-span-12 md:col-span-6">
            <el-input v-model="credentialForm.certNo" placeholder="请输入证件编号或保单号" />
          </el-form-item>
          <el-form-item label="签发日期" class="col-span-12 md:col-span-6">
            <el-date-picker
              v-model="credentialForm.issueAt"
              type="date"
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              class="w-full"
              placeholder="请选择签发日期"
            />
          </el-form-item>
          <el-form-item label="到期日期" class="col-span-12 md:col-span-6">
            <el-date-picker
              v-model="credentialForm.expiresAt"
              type="date"
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              class="w-full"
              placeholder="请选择到期日期"
            />
          </el-form-item>
          <el-form-item label="提前提醒天数" class="col-span-12 md:col-span-6">
            <el-input-number v-model="credentialForm.reminderDays" :min="0" :max="365" class="w-full" />
          </el-form-item>
          <el-form-item label="附件地址" class="col-span-12">
            <el-input
              v-model="credentialAttachmentText"
              type="textarea"
              :rows="3"
              placeholder="每行一个附件 URL 或文件标识，后续接附件中心"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="credentialDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canRunVehicleStatusAction"
          :loading="detailActionLoading"
          @click="submitVehicleCredential"
        >
          保存证照
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="onboardItemDialogVisible"
      :title="editingOnboardItemId ? '编辑随车物资' : '新增随车物资'"
      width="600px"
      append-to-body
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="grid grid-cols-12 gap-4">
          <el-form-item label="物资类别" required class="col-span-12 md:col-span-6">
            <el-select v-model="onboardItemForm.category" class="w-full">
              <el-option label="钥匙/卡片" value="key" />
              <el-option label="随车文件" value="document" />
              <el-option label="随车工具" value="equipment" />
              <el-option label="清洁整备" value="cleaning" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态" class="col-span-12 md:col-span-6">
            <el-radio-group v-model="onboardItemForm.status">
              <el-radio-button label="normal">正常</el-radio-button>
              <el-radio-button label="missing">缺失</el-radio-button>
              <el-radio-button label="damaged">损坏</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="物资名称" required class="col-span-12">
            <el-input v-model="onboardItemForm.itemName" placeholder="例如：主钥匙 / ETC 卡 / 反光衣" />
          </el-form-item>
          <el-form-item label="标准数量" class="col-span-12 md:col-span-4">
            <el-input-number v-model="onboardItemForm.standardQuantity" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="实际数量" class="col-span-12 md:col-span-4">
            <el-input-number v-model="onboardItemForm.actualQuantity" :min="0" class="w-full" />
          </el-form-item>
          <el-form-item label="赔付金额" class="col-span-12 md:col-span-4">
            <el-input-number v-model="onboardItemForm.priceAmount" :min="0" :precision="2" class="w-full" />
          </el-form-item>
          <el-form-item label="盘点时间" class="col-span-12 md:col-span-6">
            <el-date-picker
              v-model="onboardItemForm.checkedAt"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ssZ"
              class="w-full"
              placeholder="请选择盘点时间"
            />
          </el-form-item>
          <el-form-item label="备注" class="col-span-12">
            <el-input v-model="onboardItemForm.remark" type="textarea" :rows="3" placeholder="记录缺失、损坏、补配或交接说明" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="onboardItemDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="!canRunVehicleStatusAction"
          :loading="detailActionLoading"
          @click="submitVehicleOnboardItem"
        >
          保存物资
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑车辆' : '新增车辆'" width="920px" top="4vh" destroy-on-close>
      <el-tabs v-model="activeDialogTab" class="flex-1 overflow-hidden">
        <el-tab-pane label="基础资料" name="BASIC" class="h-full overflow-y-auto custom-scroll pr-2">
          <el-divider content-position="left"><el-icon><Document /></el-icon> 车辆识别</el-divider>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="车牌号" required class="col-span-12 md:col-span-4">
              <el-input v-model="currentVehicle.licensePlate" placeholder="例如: RAA-1234" />
            </el-form-item>
            <el-form-item label="车架号 (VIN)" class="col-span-12 md:col-span-4">
              <el-input v-model="currentVehicle.vin" placeholder="17位 VIN 码" maxlength="17" />
            </el-form-item>
            <el-form-item label="所属车型组" required class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.vehicleGroupName" placeholder="请选择车型组" class="w-full">
                <el-option
                  v-for="group in vehicleGroupOptions"
                  :key="group.id"
                  :label="`${group.brand} ${group.model} / ${group.storeProductGroupName}`"
                  :value="`${group.brand} ${group.model} / ${group.storeProductGroupName}`"
                  :disabled="group.status === 'disabled'"
                />
              </el-select>
            </el-form-item>
          </div>

          <el-divider content-position="left"><el-icon><Location /></el-icon> 资产归属与位置</el-divider>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="资产所属车行" required class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.assetCompanyName" placeholder="请选择资产所属车行" class="w-full">
                <el-option label="RIMO 香港租户" value="RIMO 香港租户" />
              </el-select>
            </el-form-item>
            <el-form-item label="当前门市" required class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.currentStoreName" placeholder="请选择当前门市" class="w-full">
                <el-option v-for="store in storeOptions" :key="store" :label="store" :value="store" />
              </el-select>
            </el-form-item>
            <el-form-item label="当前据点" required class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.currentStationName" placeholder="请选择当前据点" class="w-full">
                <el-option
                  v-for="station in stationOptionsByStore"
                  :key="station.id"
                  :label="`${station.name}（${station.serviceCapabilities.join('、')}）`"
                  :value="station.name"
                  :disabled="station.status === 'disabled'"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="颜色" class="col-span-12 md:col-span-3">
              <el-input v-model="currentVehicle.color" placeholder="例如: 白色" />
            </el-form-item>
            <el-form-item label="当前里程 (km)" class="col-span-12 md:col-span-3">
              <el-input-number v-model="currentVehicle.mileage" :min="0" class="w-full" />
            </el-form-item>
          </div>
        </el-tab-pane>

        <el-tab-pane label="运营配置" name="OPS" class="h-full overflow-y-auto custom-scroll pr-2">
          <div class="text-sm text-gray-500 mb-4">位置调整通过调度或调拨处理，当前页主要维护上架状态、可服务范围和设备标签。</div>
          <el-divider content-position="left"><el-icon><Operation /></el-icon> 上架与状态</el-divider>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="运营状态" class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.operationStatus" class="w-full">
                <el-option label="空闲" value="idle" />
                <el-option label="已预约" value="reserved" />
                <el-option label="租赁中" value="renting" />
                <el-option label="整备中" value="controlled" />
                <el-option label="维保" value="maintenance" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </el-form-item>
            <el-form-item label="当前服务类型" required class="col-span-12 md:col-span-4">
              <el-select v-model="currentVehicle.currentServiceType" placeholder="选择当前上架的业务线" class="w-full">
                <el-option label="门市租赁" value="STORE_STANDARD" />
                <el-option label="24H门市" value="STORE_24H" />
              </el-select>
            </el-form-item>
            <el-form-item label="启用状态" class="col-span-12 md:col-span-4">
              <el-switch v-model="currentVehicle.enabled" active-text="启用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="可服务类型" class="col-span-12">
              <el-checkbox-group v-model="currentVehicle.serviceTypes">
                <el-checkbox label="STORE_STANDARD">门市租赁</el-checkbox>
                <el-checkbox label="STORE_24H">24H门市</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="车机设备CID" class="col-span-12 md:col-span-6">
              <el-input v-model="currentVehicle.cid" placeholder="T-Box ID / Device ID" />
            </el-form-item>
            <el-form-item label="特殊车辆限制" class="col-span-12">
              <el-checkbox v-model="currentVehicle.isSpecial">标记为特殊车辆</el-checkbox>
              <div class="text-xs text-yellow-700 mt-1">仅影响会员可见性和可预约资格，不改变车辆营运状态。</div>
            </el-form-item>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="saveVehicle">保存</el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
