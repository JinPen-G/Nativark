<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import type {
  MemberDetail,
  MemberSummary,
  PlatformFilterPreset,
  SaveMemberRequest
} from "@rimo/shared";
import {
  deletePlatformFilterPreset,
  getMemberDetail,
  listMemberPage,
  listPlatformFilterPresets,
  processMemberRisk,
  saveMember,
  savePlatformFilterPreset,
  setPlatformFilterPresetDefault
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const filterPresetScope = "store-rental.members" as const;
const rows = ref<MemberSummary[]>([]);
const loading = ref(false);
const search = ref("");
const statusFilter = ref("");
const reviewStatusFilter = ref("");
const tagFilter = ref("");
const availableTags = ref<string[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const stats = ref({
  total: 0,
  active: 0,
  pending: 0,
  blacklisted: 0
});
const filterPresets = ref<PlatformFilterPreset[]>([]);
const selectedFilterPresetId = ref("");
const filterPresetLoading = ref(false);
const dialogVisible = ref(false);
const isEdit = ref(false);
const detailLoading = ref(false);
const saving = ref(false);
const tagsText = ref("");
const memberForm = reactive<SaveMemberRequest>({
  name: "",
  phone: "",
  email: "",
  levelName: "白银会员",
  status: "pending_review",
  source: "营运端录入",
  tags: [],
  identityVerified: false,
  driverLicenseVerified: false,
  identityNoMasked: "",
  driverLicenseNoMasked: "",
  birthday: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  notes: "",
  riskNote: ""
});

const canManageMember = computed(() =>
  authStore.hasAnyPermission(["store-rental:member:manage"])
);
const canRunRiskAction = computed(() =>
  authStore.hasAnyPermission([
    "store-rental:member:manage",
    "store-rental:member:risk-action"
  ])
);
const selectedFilterPreset = computed(() =>
  filterPresets.value.find((preset) => preset.id === selectedFilterPresetId.value)
);

function statusLabel(status: MemberSummary["status"]) {
  return {
    pending_review: "待审核",
    active: "正常",
    suspended: "已暂停",
    blacklisted: "黑名单"
  }[status];
}

function statusType(status: MemberSummary["status"]) {
  return {
    pending_review: "warning",
    active: "success",
    suspended: "info",
    blacklisted: "danger"
  }[status] as "warning" | "success" | "info" | "danger";
}

function reviewLabel(status: MemberSummary["reviewStatus"]) {
  return {
    pending: "待审核",
    approved: "已通过",
    rejected: "已驳回"
  }[status];
}

function resetMemberForm(detail?: MemberDetail) {
  Object.assign(memberForm, {
    id: detail?.id,
    name: detail?.name ?? "",
    phone: detail?.phone ?? "",
    email: detail?.email ?? "",
    levelName: detail?.levelName ?? "白银会员",
    status: detail?.status ?? "pending_review",
    source: detail?.source ?? "营运端录入",
    tags: detail?.tags ?? [],
    identityVerified: detail?.identityVerified ?? false,
    driverLicenseVerified: detail?.driverLicenseVerified ?? false,
    identityNoMasked: detail?.identityNoMasked ?? "",
    driverLicenseNoMasked: detail?.driverLicenseNoMasked ?? "",
    birthday: detail?.birthday ?? "",
    emergencyContactName: detail?.emergencyContactName ?? "",
    emergencyContactPhone: detail?.emergencyContactPhone ?? "",
    notes: detail?.notes ?? "",
    riskNote: detail?.riskNote ?? ""
  });
  tagsText.value = (detail?.tags ?? []).join("、");
}

function openCreateDialog() {
  if (!canManageMember.value) {
    ElMessage.warning("当前角色没有会员管理权限");
    return;
  }
  isEdit.value = false;
  resetMemberForm();
  dialogVisible.value = true;
}

async function openEditDialog(row: MemberSummary) {
  if (!canManageMember.value) {
    ElMessage.warning("当前角色没有会员管理权限");
    return;
  }
  isEdit.value = true;
  dialogVisible.value = true;
  detailLoading.value = true;
  try {
    resetMemberForm(await getMemberDetail(row.id));
  } catch {
    dialogVisible.value = false;
    ElMessage.error("会员详情加载失败");
  } finally {
    detailLoading.value = false;
  }
}

function buildMemberPayload(): SaveMemberRequest {
  return {
    ...memberForm,
    email: memberForm.email?.trim() || undefined,
    identityNoMasked: memberForm.identityNoMasked?.trim() || undefined,
    driverLicenseNoMasked: memberForm.driverLicenseNoMasked?.trim() || undefined,
    birthday: memberForm.birthday?.trim() || undefined,
    emergencyContactName: memberForm.emergencyContactName?.trim() || undefined,
    emergencyContactPhone: memberForm.emergencyContactPhone?.trim() || undefined,
    notes: memberForm.notes?.trim() || undefined,
    riskNote: memberForm.riskNote?.trim() || undefined,
    name: memberForm.name.trim(),
    phone: memberForm.phone.trim(),
    source: memberForm.source.trim() || "营运端录入",
    levelName: memberForm.levelName.trim() || "白银会员",
    tags: tagsText.value
      .split(/[、,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

async function submitMember() {
  if (!memberForm.name.trim() || !memberForm.phone.trim()) {
    ElMessage.warning("请填写会员姓名和手机号");
    return;
  }
  saving.value = true;
  try {
    await saveMember(buildMemberPayload());
    dialogVisible.value = false;
    await loadData();
    ElMessage.success("会员资料已保存");
  } catch {
    ElMessage.error("会员资料保存失败");
  } finally {
    saving.value = false;
  }
}

async function loadData() {
  loading.value = true;
  try {
    const result = await listMemberPage({
      keyword: search.value.trim() || undefined,
      status: (statusFilter.value || undefined) as MemberSummary["status"] | undefined,
      reviewStatus: (reviewStatusFilter.value || undefined) as
        | MemberSummary["reviewStatus"]
        | undefined,
      tag: tagFilter.value || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    rows.value = result.rows;
    total.value = result.total;
    availableTags.value = result.availableTags;
    stats.value = {
      total: result.stats.total,
      active: result.stats.active,
      pending: result.stats.pendingReview,
      blacklisted: result.stats.blacklisted
    };
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  page.value = 1;
  void loadData();
}

function handlePageSizeChange() {
  page.value = 1;
  void loadData();
}

function resetFilters() {
  search.value = "";
  statusFilter.value = "";
  reviewStatusFilter.value = "";
  tagFilter.value = "";
  selectedFilterPresetId.value = "";
  applyFilters();
}

function filterPresetOperator() {
  return authStore.user?.displayName || "营运端";
}

function cloneMemberFilters() {
  return {
    search: search.value,
    status: statusFilter.value,
    reviewStatus: reviewStatusFilter.value,
    tag: tagFilter.value
  } satisfies Record<string, unknown>;
}

function applyMemberPresetFilters(presetFilters: Record<string, unknown>) {
  search.value = typeof presetFilters.search === "string" ? presetFilters.search : "";
  statusFilter.value = typeof presetFilters.status === "string" ? presetFilters.status : "";
  reviewStatusFilter.value =
    typeof presetFilters.reviewStatus === "string" ? presetFilters.reviewStatus : "";
  tagFilter.value = typeof presetFilters.tag === "string" ? presetFilters.tag : "";
}

function applySelectedFilterPreset() {
  const preset = selectedFilterPreset.value;
  if (!preset) {
    return;
  }
  applyMemberPresetFilters(preset.filters);
  applyFilters();
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
      applyMemberPresetFilters(defaultPreset.filters);
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
      filters: cloneMemberFilters(),
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

async function runRiskAction(row: MemberSummary, action: "suspend" | "blacklist" | "restore") {
  if (!canRunRiskAction.value) {
    ElMessage.warning("当前角色没有会员风控动作权限");
    return;
  }

  const actionText = {
    suspend: "暂停租车资格",
    blacklist: "加入黑名单",
    restore: "恢复租车资格"
  }[action];

  try {
    const result = await ElMessageBox.prompt(`请输入${actionText}原因`, actionText, {
      confirmButtonText: "确认",
      cancelButtonText: "取消",
      inputPattern: /\S+/,
      inputErrorMessage: "必须填写原因"
    });
    const response = await processMemberRisk(row.id, {
      action,
      reason: result.value,
      operator: "营运风控"
    });
    ElMessage.success(response.message);
    await loadData();
  } catch {
    // 用户取消时不提示。
  }
}

onMounted(async () => {
  await loadFilterPresets();
  await loadData();
});
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">个人会员管理</h1>
        <p class="text-sm text-gray-500 mt-1">管理会员档案、审核状态、等级和风控标签。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="openCreateDialog">新增会员</el-button>
    </div>

    <div class="grid grid-cols-4 gap-4 mb-6">
      <div class="rimo-card p-4">
        <div class="text-xs text-gray-400">会员总数</div>
        <div class="text-2xl font-bold text-gray-900 mt-2">{{ stats.total }}</div>
      </div>
      <div class="rimo-card p-4">
        <div class="text-xs text-gray-400">正常会员</div>
        <div class="text-2xl font-bold text-emerald-600 mt-2">{{ stats.active }}</div>
      </div>
      <div class="rimo-card p-4">
        <div class="text-xs text-gray-400">待审核</div>
        <div class="text-2xl font-bold text-amber-600 mt-2">{{ stats.pending }}</div>
      </div>
      <div class="rimo-card p-4">
        <div class="text-xs text-gray-400">黑名单</div>
        <div class="text-2xl font-bold text-rose-600 mt-2">{{ stats.blacklisted }}</div>
      </div>
    </div>

    <div class="rimo-card p-5">
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <el-input
          v-model="search"
          placeholder="会员姓名 / 手机号"
          clearable
          style="width: 260px"
          @keyup.enter="applyFilters"
        />
        <el-select v-model="statusFilter" clearable placeholder="会员状态" style="width: 160px">
          <el-option label="正常" value="active" />
          <el-option label="待审核" value="pending_review" />
          <el-option label="已暂停" value="suspended" />
          <el-option label="黑名单" value="blacklisted" />
        </el-select>
        <el-select v-model="reviewStatusFilter" clearable placeholder="审核状态" style="width: 150px">
          <el-option label="待审核" value="pending" />
          <el-option label="已通过" value="approved" />
          <el-option label="已驳回" value="rejected" />
        </el-select>
        <el-select v-model="tagFilter" clearable placeholder="会员标签" style="width: 170px">
          <el-option
            v-for="tag in availableTags"
            :key="tag"
            :label="tag"
            :value="tag"
          />
        </el-select>
        <el-select
          v-model="selectedFilterPresetId"
          placeholder="筛选预设"
          clearable
          :loading="filterPresetLoading"
          style="width: 190px"
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
        <el-button icon="Refresh" circle @click="resetFilters" />
        <el-button type="primary" plain @click="applyFilters">查询</el-button>
        <el-button @click="loadData">刷新</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column label="会员信息" min-width="220">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.name }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.phoneMasked }} · {{ row.source }}</div>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="120" prop="levelName" />
        <el-table-column label="会员状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="plain">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="审核状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.reviewStatus === 'pending' ? 'warning' : row.reviewStatus === 'approved' ? 'success' : 'danger'" effect="plain">
              {{ reviewLabel(row.reviewStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="标签" min-width="180">
          <template #default="{ row }">
            <el-tag
              v-for="tag in row.tags"
              :key="tag"
              class="mr-2 mb-1"
              :type="tag.includes('黑名单') || tag.includes('限制') ? 'danger' : 'info'"
              effect="plain"
            >
              {{ tag }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="订单数" width="100" align="right">
          <template #default="{ row }">{{ row.totalOrders }}</template>
        </el-table-column>
        <el-table-column label="累计消费" width="130" align="right">
          <template #default="{ row }">¥{{ row.totalSpendAmount }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260" align="right" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/members/${row.id}`)">详情</el-button>
            <el-button v-if="canManageMember" link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button
              v-if="row.reviewStatus === 'pending'"
              link
              type="warning"
              @click="router.push(`/member-reviews?memberId=${row.id}`)"
            >
              审核
            </el-button>
            <el-button
              v-if="canRunRiskAction && row.status === 'active'"
              link
              type="warning"
              @click="runRiskAction(row, 'suspend')"
            >
              暂停
            </el-button>
            <el-button
              v-if="canRunRiskAction && row.status !== 'blacklisted'"
              link
              type="danger"
              @click="runRiskAction(row, 'blacklist')"
            >
              拉黑
            </el-button>
            <el-button
              v-if="canRunRiskAction && ['suspended', 'blacklisted'].includes(row.status)"
              link
              type="success"
              @click="runRiskAction(row, 'restore')"
            >
              恢复
            </el-button>
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
          @current-change="loadData"
          @size-change="handlePageSizeChange"
        />
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑会员' : '新增会员'"
      width="900px"
      top="4vh"
      destroy-on-close
    >
      <el-form v-loading="detailLoading" :model="memberForm" label-position="top">
        <div class="mb-5">
          <div class="text-sm font-bold text-gray-700 mb-3">基本资料</div>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="会员姓名" required class="col-span-12 md:col-span-4">
              <el-input v-model="memberForm.name" placeholder="请输入姓名" />
            </el-form-item>
            <el-form-item label="手机号" required class="col-span-12 md:col-span-4">
              <el-input v-model="memberForm.phone" placeholder="0912-345-678" />
            </el-form-item>
            <el-form-item label="Email" class="col-span-12 md:col-span-4">
              <el-input v-model="memberForm.email" placeholder="email@example.com" />
            </el-form-item>
            <el-form-item label="来源" class="col-span-12 md:col-span-4">
              <el-select v-model="memberForm.source" class="w-full">
                <el-option label="H5 注册" value="H5 注册" />
                <el-option label="门店录入" value="门店录入" />
                <el-option label="企业导入" value="企业导入" />
                <el-option label="营运端录入" value="营运端录入" />
              </el-select>
            </el-form-item>
            <el-form-item label="会员等级" class="col-span-12 md:col-span-4">
              <el-select v-model="memberForm.levelName" class="w-full">
                <el-option label="普通会员" value="普通会员" />
                <el-option label="白银会员" value="白银会员" />
                <el-option label="黄金会员" value="黄金会员" />
                <el-option label="黑金会员" value="黑金会员" />
              </el-select>
            </el-form-item>
            <el-form-item label="会员状态" class="col-span-12 md:col-span-4">
              <el-select v-model="memberForm.status" class="w-full">
                <el-option label="待审核" value="pending_review" />
                <el-option label="正常" value="active" />
                <el-option label="已暂停" value="suspended" />
                <el-option label="黑名单" value="blacklisted" />
              </el-select>
            </el-form-item>
            <el-form-item label="生日" class="col-span-12 md:col-span-4">
              <el-date-picker
                v-model="memberForm.birthday"
                type="date"
                value-format="YYYY-MM-DD"
                class="w-full"
              />
            </el-form-item>
            <el-form-item label="标签" class="col-span-12 md:col-span-8">
              <el-input v-model="tagsText" placeholder="多个标签用 、 分隔" />
            </el-form-item>
          </div>
        </div>

        <div class="mb-5">
          <div class="text-sm font-bold text-gray-700 mb-3">证件与认证</div>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="身份证号" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.identityNoMasked" placeholder="A123456789" />
            </el-form-item>
            <el-form-item label="驾驶证号" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.driverLicenseNoMasked" placeholder="DL123456" />
            </el-form-item>
            <el-form-item label="身份证认证" class="col-span-12 md:col-span-6">
              <el-switch
                v-model="memberForm.identityVerified"
                active-text="已认证"
                inactive-text="未认证"
              />
            </el-form-item>
            <el-form-item label="驾驶证认证" class="col-span-12 md:col-span-6">
              <el-switch
                v-model="memberForm.driverLicenseVerified"
                active-text="已认证"
                inactive-text="未认证"
              />
            </el-form-item>
          </div>
        </div>

        <div>
          <div class="text-sm font-bold text-gray-700 mb-3">联络与风控</div>
          <div class="grid grid-cols-12 gap-4">
            <el-form-item label="紧急联系人" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.emergencyContactName" />
            </el-form-item>
            <el-form-item label="紧急联系人电话" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.emergencyContactPhone" />
            </el-form-item>
            <el-form-item label="备注" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.notes" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="风险备注" class="col-span-12 md:col-span-6">
              <el-input v-model="memberForm.riskNote" type="textarea" :rows="3" />
            </el-form-item>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submitMember">
          保存
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
