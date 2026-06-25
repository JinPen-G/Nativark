<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { CorporateListQuery, CorporateSummary, PlatformFilterPreset } from "@store-rental/shared";
import {
  deletePlatformFilterPreset,
  listCorporatePage,
  listPlatformFilterPresets,
  savePlatformFilterPreset,
  setPlatformFilterPresetDefault
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

const router = useRouter();
const authStore = useAuthStore();
const filterPresetScope = "store-rental.corporates" as const;
const rows = ref<CorporateSummary[]>([]);
const loading = ref(false);
const search = ref("");
const statusFilter = ref("");
const contractStatusFilter = ref("");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const stats = ref({
  total: 0,
  active: 0,
  paused: 0,
  disabled: 0,
  expiringContracts: 0,
  expiredContracts: 0
});
const filterPresets = ref<PlatformFilterPreset[]>([]);
const selectedFilterPresetId = ref("");
const filterPresetLoading = ref(false);

const selectedFilterPreset = computed(() =>
  filterPresets.value.find((preset) => preset.id === selectedFilterPresetId.value)
);

async function loadData() {
  loading.value = true;
  try {
    const query: CorporateListQuery = {
      keyword: search.value.trim() || undefined,
      status: statusFilter.value as CorporateListQuery["status"],
      contractStatus: contractStatusFilter.value as CorporateListQuery["contractStatus"],
      page: page.value,
      pageSize: pageSize.value
    };
    const result = await listCorporatePage(query);
    rows.value = result.rows;
    total.value = result.total;
    page.value = result.page;
    pageSize.value = result.pageSize;
    stats.value = result.stats;
  } finally {
    loading.value = false;
  }
}

async function applyFilters() {
  page.value = 1;
  await loadData();
}

async function resetFilters() {
  search.value = "";
  statusFilter.value = "";
  contractStatusFilter.value = "";
  selectedFilterPresetId.value = "";
  page.value = 1;
  await loadData();
}

async function handlePageSizeChange(nextPageSize: number) {
  pageSize.value = nextPageSize;
  page.value = 1;
  await loadData();
}

function filterPresetOperator() {
  return authStore.user?.displayName || "营运端";
}

function cloneCorporateFilters() {
  return {
    search: search.value,
    status: statusFilter.value,
    contractStatus: contractStatusFilter.value
  } satisfies Record<string, unknown>;
}

function applyCorporatePresetFilters(presetFilters: Record<string, unknown>) {
  search.value = typeof presetFilters.search === "string" ? presetFilters.search : "";
  statusFilter.value = typeof presetFilters.status === "string" ? presetFilters.status : "";
  contractStatusFilter.value =
    typeof presetFilters.contractStatus === "string" ? presetFilters.contractStatus : "";
}

async function applySelectedFilterPreset() {
  const preset = selectedFilterPreset.value;
  if (!preset) {
    return;
  }
  applyCorporatePresetFilters(preset.filters);
  await applyFilters();
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
      applyCorporatePresetFilters(defaultPreset.filters);
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
      filters: cloneCorporateFilters(),
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

onMounted(async () => {
  await loadFilterPresets();
  await loadData();
});
</script>

<template>
  <AppLayout>
    <div class="flex justify-between items-end mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-800">企业客户管理</h1>
        <p class="text-sm text-gray-500 mt-1">管理企业客户、账期授信、联系人和月结信息。</p>
      </div>
      <el-button type="primary" color="#00689E" @click="router.push('/corporates/new')">新增企业客户</el-button>
    </div>

    <div class="sr-card p-5">
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <el-input
          v-model="search"
          clearable
          placeholder="企业简称 / 企业全称"
          style="width: 280px"
          @keyup.enter="applyFilters"
        />
        <el-select v-model="statusFilter" clearable placeholder="企业状态" style="width: 150px">
          <el-option label="正常" value="active" />
          <el-option label="暂停" value="paused" />
          <el-option label="停用" value="disabled" />
        </el-select>
        <el-select v-model="contractStatusFilter" clearable placeholder="合同状态" style="width: 150px">
          <el-option label="有效" value="active" />
          <el-option label="将到期" value="expiring" />
          <el-option label="已过期" value="expired" />
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
        <el-button type="primary" color="#00689E" @click="applyFilters">查询</el-button>
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
        <el-tooltip content="重置筛选" placement="top">
          <el-button icon="Refresh" circle @click="resetFilters" />
        </el-tooltip>
        <el-button @click="loadData">刷新</el-button>
        <div class="text-sm text-gray-500 ml-auto">
          共 {{ total }} 家企业，正常 {{ stats.active }} 家，将到期合同 {{ stats.expiringContracts }} 家
        </div>
      </div>

      <el-table v-loading="loading" :data="rows" stripe>
        <el-table-column label="企业客户" min-width="240">
          <template #default="{ row }">
            <div class="font-semibold text-gray-900">{{ row.shortName }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ row.fullName }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'paused' ? 'warning' : 'info'" effect="plain">
              {{ row.status === "active" ? "正常" : row.status === "paused" ? "暂停" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="联系人" min-width="180">
          <template #default="{ row }">
            <div>{{ row.contactName }}</div>
            <div class="text-xs text-gray-500">{{ row.contactPhone }}</div>
          </template>
        </el-table-column>
        <el-table-column label="账期" width="100" align="center">
          <template #default="{ row }">{{ row.accountPeriodDays }} 天</template>
        </el-table-column>
        <el-table-column label="授信额度" width="130" align="right">
          <template #default="{ row }">¥{{ row.creditLimitAmount }}</template>
        </el-table-column>
        <el-table-column label="未回款" width="120" align="right">
          <template #default="{ row }">¥{{ row.unpaidAmount }}</template>
        </el-table-column>
        <el-table-column label="合同状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.contractStatus === 'active' ? 'success' : row.contractStatus === 'expiring' ? 'warning' : 'danger'" effect="plain">
              {{ row.contractStatus === "active" ? "有效" : row.contractStatus === "expiring" ? "将到期" : "已过期" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="router.push(`/corporates/${row.id}`)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex justify-end mt-4">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          @current-change="loadData"
          @size-change="handlePageSizeChange"
        />
      </div>
    </div>
  </AppLayout>
</template>
