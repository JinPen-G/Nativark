<script setup lang="ts">
import { ElMessage } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";
import type {
  OrganizationSummary,
  SaveOrganizationRequest,
  TenantSummary
} from "@store-rental/shared";
import { RoleScope } from "@store-rental/shared";
import {
  listOrganizations,
  listTenants,
  saveOrganization,
  setOrganizationStatus
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

interface OrganizationTreeNode {
  id: string;
  label: string;
  summary: OrganizationSummary;
  children: OrganizationTreeNode[];
}

const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const selectedTenantId = ref("tenant_001");
const selectedOrgId = ref("");
const searchKeyword = ref("");
const tenants = ref<TenantSummary[]>([]);
const organizations = ref<OrganizationSummary[]>([]);

const form = reactive<SaveOrganizationRequest>({
  tenantId: "tenant_001",
  parentId: undefined,
  type: RoleScope.Operator,
  code: "",
  name: "",
  status: "enabled",
  operator: "平台管理员"
});

const selectedTenant = computed(() =>
  tenants.value.find((tenant) => tenant.tenantId === selectedTenantId.value)
);
const currentTenantOrganizations = computed(() =>
  organizations.value.filter((item) => item.tenantId === selectedTenantId.value)
);
const filteredOrganizations = computed(() => {
  const keyword = searchKeyword.value.trim();
  return currentTenantOrganizations.value.filter(
    (item) =>
      !keyword ||
      item.name.includes(keyword) ||
      item.code.includes(keyword) ||
      typeLabel(item.type).includes(keyword)
  );
});
const selectedOrganization = computed(() =>
  organizations.value.find((item) => item.id === selectedOrgId.value)
);
const parentOptions = computed(() =>
  organizations.value.filter(
    (item) =>
      item.tenantId === form.tenantId &&
      item.id !== form.id &&
      item.status === "enabled"
  )
);
const organizationTree = computed(() => buildTree(currentTenantOrganizations.value));
const metrics = computed(() => ({
  total: currentTenantOrganizations.value.length,
  enabled: currentTenantOrganizations.value.filter((item) => item.status === "enabled").length,
  disabled: currentTenantOrganizations.value.filter((item) => item.status === "disabled").length,
  operators: currentTenantOrganizations.value.filter((item) => item.type === RoleScope.Operator).length,
  stores: currentTenantOrganizations.value.filter((item) =>
    [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(item.type)
  ).length
}));
const isEdit = computed(() => Boolean(form.id));

async function loadData() {
  loading.value = true;
  try {
    const [tenantRows, orgRows] = await Promise.all([
      listTenants(),
      listOrganizations()
    ]);
    tenants.value = tenantRows;
    organizations.value = orgRows;
    if (!selectedTenantId.value && tenantRows[0]) {
      selectedTenantId.value = tenantRows[0].tenantId;
    }
    if (!selectedOrgId.value) {
      selectedOrgId.value = currentTenantOrganizations.value[0]?.id ?? "";
    }
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "组织架构数据加载失败"));
  } finally {
    loading.value = false;
  }
}

function buildTree(rows: OrganizationSummary[]) {
  const nodes = new Map<string, OrganizationTreeNode>();
  rows.forEach((item) => {
    nodes.set(item.id, {
      id: item.id,
      label: item.name,
      summary: item,
      children: []
    });
  });

  const roots: OrganizationTreeNode[] = [];
  nodes.forEach((node) => {
    const parent = node.summary.parentId ? nodes.get(node.summary.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return sortTree(roots);
}

function sortTree(nodes: OrganizationTreeNode[]): OrganizationTreeNode[] {
  return nodes
    .sort((a, b) => typeSort(a.summary.type) - typeSort(b.summary.type) || a.summary.code.localeCompare(b.summary.code))
    .map((node) => ({
      ...node,
      children: sortTree(node.children)
    }));
}

function typeSort(type: RoleScope) {
  const order: Record<string, number> = {
    [RoleScope.Operator]: 1,
    [RoleScope.CarShop]: 2,
    [RoleScope.Store]: 3,
    [RoleScope.Station]: 4
  };
  return order[type] ?? 9;
}

function openCreate(parent?: OrganizationSummary) {
  Object.assign(form, {
    id: undefined,
    tenantId: selectedTenantId.value,
    parentId: parent?.id,
    type: parent?.type === RoleScope.Operator ? RoleScope.Store : RoleScope.Operator,
    code: "",
    name: "",
    status: "enabled",
    operator: "平台管理员"
  });
  dialogVisible.value = true;
}

function openEdit(row: OrganizationSummary) {
  Object.assign(form, {
    id: row.id,
    tenantId: row.tenantId,
    parentId: row.parentId,
    type: row.type,
    code: row.code,
    name: row.name,
    status: row.status,
    operator: "平台管理员"
  });
  dialogVisible.value = true;
}

async function submitOrganization() {
  if (!form.code.trim() || !form.name.trim()) {
    ElMessage.warning("组织编码和组织名称不能为空");
    return;
  }

  saving.value = true;
  try {
    const saved = await saveOrganization({ ...form });
    replaceOrganization(saved);
    selectedTenantId.value = saved.tenantId;
    selectedOrgId.value = saved.id;
    dialogVisible.value = false;
    ElMessage.success(isEdit.value ? "组织信息已更新" : "组织已创建");
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "组织保存失败"));
  } finally {
    saving.value = false;
  }
}

async function handleStatusChange(row: OrganizationSummary) {
  const nextStatus = row.status === "enabled" ? "disabled" : "enabled";
  try {
    const saved = await setOrganizationStatus(row.id, nextStatus, "平台管理员");
    replaceOrganization(saved);
    ElMessage.success(`组织 ${saved.name} 已${saved.status === "enabled" ? "启用" : "停用"}`);
  } catch (error) {
    ElMessage.error(readErrorMessage(error, "组织状态更新失败"));
  }
}

function replaceOrganization(row: OrganizationSummary) {
  const index = organizations.value.findIndex((item) => item.id === row.id);
  if (index >= 0) {
    organizations.value[index] = row;
  } else {
    organizations.value.push(row);
  }
}

function selectOrganization(node: OrganizationTreeNode | OrganizationSummary) {
  selectedOrgId.value = node.id;
}

function typeLabel(type: RoleScope) {
  if (type === RoleScope.CarShop) {
    return "车行";
  }
  if (type === RoleScope.Store) {
    return "门店";
  }
  if (type === RoleScope.Station) {
    return "站点";
  }
  return "营运部门";
}

function typeTag(type: RoleScope) {
  if (type === RoleScope.Operator) {
    return "info";
  }
  if (type === RoleScope.Station) {
    return "success";
  }
  return "warning";
}

function parentName(row: OrganizationSummary) {
  if (!row.parentId) {
    return "-";
  }
  return organizations.value.find((item) => item.id === row.parentId)?.name ?? "-";
}

function readErrorMessage(error: unknown, fallback: string) {
  const response = error as {
    response?: {
      data?: {
        message?: string;
      };
    };
  };
  return response.response?.data?.message ?? fallback;
}

watch(selectedTenantId, () => {
  selectedOrgId.value = currentTenantOrganizations.value[0]?.id ?? "";
});

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button :loading="loading" @click="loadData">
        <el-icon class="mr-1"><Refresh /></el-icon>
        刷新
      </el-button>
      <el-button type="primary" color="#00689E" @click="openCreate()">
        <el-icon class="mr-1"><Plus /></el-icon>
        新增组织
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>组织架构</h1>
        <p>维护营运部门、车行、门店与站点的归属关系，支撑账号权限和数据范围。</p>
      </div>
      <div class="flex gap-3">
        <el-select v-model="selectedTenantId" size="large" style="width: 220px">
          <el-option
            v-for="tenant in tenants"
            :key="tenant.tenantId"
            :label="tenant.tenantName"
            :value="tenant.tenantId"
          />
        </el-select>
        <el-button size="large" type="primary" color="#00689E" @click="openCreate()">
          <el-icon class="mr-1"><Plus /></el-icon>
          新增组织
        </el-button>
      </div>
    </div>

    <div class="grid grid-cols-1 xl:grid-cols-5 gap-4 mb-4">
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">组织总数</div>
        <div class="mt-2 text-2xl font-bold text-gray-800">{{ metrics.total }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">启用</div>
        <div class="mt-2 text-2xl font-bold text-emerald-600">{{ metrics.enabled }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">停用</div>
        <div class="mt-2 text-2xl font-bold text-gray-500">{{ metrics.disabled }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">营运部门</div>
        <div class="mt-2 text-2xl font-bold text-[#00689E]">{{ metrics.operators }}</div>
      </div>
      <div class="sr-card p-4">
        <div class="text-xs text-gray-400">车行/门店/站点</div>
        <div class="mt-2 text-2xl font-bold text-amber-600">{{ metrics.stores }}</div>
      </div>
    </div>

    <div class="flex gap-6 min-h-[calc(100vh-230px)]">
      <aside class="w-80 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col p-4 overflow-y-auto custom-scroll">
        <div class="flex items-center justify-between mb-3">
          <div>
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider">组织树</div>
            <div class="text-xs text-gray-400 mt-1">{{ selectedTenant?.tenantName || "未选择租户" }}</div>
          </div>
          <el-button link type="primary" @click="openCreate(selectedOrganization)">新增下级</el-button>
        </div>

        <el-tree
          v-loading="loading"
          :data="organizationTree"
          node-key="id"
          default-expand-all
          :expand-on-click-node="false"
          class="employee-org-tree"
          @node-click="selectOrganization"
        >
          <template #default="{ data }">
            <span
              class="flex w-full items-center rounded-lg px-2 py-1"
              :class="selectedOrgId === data.id ? 'text-[#00689E] font-semibold' : 'text-gray-700'"
            >
              <el-icon class="mr-2 employee-tree-icon">
                <OfficeBuilding v-if="data.summary.type === RoleScope.Operator" />
                <Shop v-else-if="data.summary.type === RoleScope.CarShop || data.summary.type === RoleScope.Store" />
                <Location v-else />
              </el-icon>
              <span class="truncate">{{ data.label }}</span>
            </span>
          </template>
        </el-tree>
      </aside>

      <section class="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div class="p-4 border-b border-gray-100 bg-gray-50 flex items-center gap-3">
          <el-input
            v-model="searchKeyword"
            clearable
            placeholder="搜索组织名称/编码/类型"
            prefix-icon="Search"
            style="width: 280px"
          />
          <div class="text-sm text-gray-500 ml-auto">共 {{ filteredOrganizations.length }} 个组织</div>
        </div>

        <el-table
          v-loading="loading"
          :data="filteredOrganizations"
          border
          class="prototype-table flex-1"
        >
          <el-table-column prop="name" label="组织名称" min-width="180" fixed="left" />
          <el-table-column prop="code" label="组织编码" min-width="150" />
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              <el-tag :type="typeTag(row.type)" effect="plain">{{ typeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="上级组织" min-width="180">
            <template #default="{ row }">{{ parentName(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="{ row }">
              <el-tag :type="row.status === 'enabled' ? 'success' : 'info'" effect="plain">
                {{ row.status === "enabled" ? "启用" : "停用" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right" align="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
              <el-button
                :type="row.status === 'enabled' ? 'warning' : 'success'"
                link
                @click="handleStatusChange(row)"
              >
                {{ row.status === "enabled" ? "停用" : "启用" }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑组织' : '新增组织'" width="520px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="租户">
          <el-select v-model="form.tenantId" class="w-full" :disabled="isEdit">
            <el-option
              v-for="tenant in tenants"
              :key="tenant.tenantId"
              :label="tenant.tenantName"
              :value="tenant.tenantId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="上级组织">
          <el-select v-model="form.parentId" class="w-full" clearable placeholder="无上级组织">
            <el-option
              v-for="org in parentOptions"
              :key="org.id"
              :label="`${org.name}（${typeLabel(org.type)}）`"
              :value="org.id"
            />
          </el-select>
        </el-form-item>
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="组织类型">
            <el-select v-model="form.type" class="w-full">
              <el-option label="营运部门" :value="RoleScope.Operator" />
              <el-option label="车行" :value="RoleScope.CarShop" />
              <el-option label="门店" :value="RoleScope.Store" />
              <el-option label="站点" :value="RoleScope.Station" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="form.status" class="w-full">
              <el-option label="启用" value="enabled" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </el-form-item>
          <el-form-item label="组织编码">
            <el-input v-model="form.code" placeholder="例如 STORE-MK" />
          </el-form-item>
          <el-form-item label="组织名称">
            <el-input v-model="form.name" placeholder="请输入组织名称" />
          </el-form-item>
        </div>
        <el-form-item label="操作人" class="mb-0">
          <el-input v-model="form.operator" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submitOrganization">
          {{ isEdit ? "保存修改" : "确认创建" }}
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
