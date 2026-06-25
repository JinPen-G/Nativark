<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  OrganizationSummary,
  SaveSystemUserRequest,
  SystemRoleRow,
  SystemUserRow,
  TenantSummary
} from "@store-rental/shared";
import { RoleScope } from "@store-rental/shared";
import {
  listOrganizations,
  getRoles,
  listSystemUsers,
  listTenants,
  resetSystemUserPassword,
  saveSystemUser,
  setSystemUserStatus
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";
import { useAuthStore } from "../stores/auth";

type SidebarTab = "ALL" | "HEADQUARTERS" | "PROVIDERS";
type FormOrgType = "HEADQUARTERS" | "STORE";

const router = useRouter();
const authStore = useAuthStore();
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const tenants = ref<TenantSummary[]>([]);
const organizations = ref<OrganizationSummary[]>([]);
const roles = ref<SystemRoleRow[]>([]);
const users = ref<SystemUserRow[]>([]);
const selectedUsers = ref<SystemUserRow[]>([]);
const selectedTenantId = ref("tenant_001");
const sidebarTab = ref<SidebarTab>("ALL");
const filterOrgId = ref("");
const searchKeyword = ref("");
const filterRole = ref("");
const filterStatus = ref<boolean | "" | undefined>("");
const currentPage = ref(1);
const pageSize = ref(10);
const formOrgType = ref<FormOrgType>("HEADQUARTERS");

const form = reactive<SaveSystemUserRequest>({
  tenantId: "tenant_001",
  account: "",
  displayName: "",
  phone: "",
  organizationId: "org_operator_hk",
  roleIds: [],
  isPlatformAdmin: false,
  isActive: true
});

const selectedTenant = computed(() =>
  tenants.value.find((tenant) => tenant.tenantId === selectedTenantId.value)
);
const tenantOrganizations = computed(() =>
  organizations.value.filter((item) => item.tenantId === form.tenantId)
);
const currentTenantOrganizations = computed(() =>
  organizations.value.filter((item) => item.tenantId === selectedTenantId.value)
);
const departments = computed(() =>
  currentTenantOrganizations.value.filter((item) => item.type === RoleScope.Operator)
);
const providerOrganizations = computed(() =>
  currentTenantOrganizations.value.filter((item) =>
    [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(item.type)
  )
);
const scopedFormOrganizations = computed(() =>
  tenantOrganizations.value.filter((item) => {
    if (formOrgType.value === "HEADQUARTERS") {
      return item.type === RoleScope.Operator;
    }
    return [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(item.type);
  })
);
const editableRoles = computed(() => {
  if (form.isPlatformAdmin) {
    return roles.value.filter((role) => role.fixedAllPermissions);
  }

  return roles.value.filter((role) => {
    if (role.fixedAllPermissions) {
      return false;
    }
    if (formOrgType.value === "HEADQUARTERS") {
      return role.scope === RoleScope.Operator;
    }
    return [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(role.scope);
  });
});
const canExport = computed(() =>
  authStore.hasAnyPermission(["system:button:export"])
);
const filteredUsers = computed(() =>
  users.value.filter((user) => {
    const keyword = searchKeyword.value.trim();
    const matchedKeyword =
      !keyword ||
      user.displayName.includes(keyword) ||
      user.account.includes(keyword) ||
      user.phone?.includes(keyword) ||
      user.organizationName?.includes(keyword);
    const matchedRole = !filterRole.value || user.roleIds.includes(filterRole.value);
    const matchedStatus =
      filterStatus.value === "" ||
      filterStatus.value === undefined ||
      user.isActive === filterStatus.value;
    const matchedType =
      sidebarTab.value === "ALL" ||
      (sidebarTab.value === "HEADQUARTERS" && user.scope === RoleScope.Operator) ||
      (sidebarTab.value === "PROVIDERS" &&
        [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(user.scope));
    const matchedOrg = !filterOrgId.value || user.organizationId === filterOrgId.value;

    return matchedKeyword && matchedRole && matchedStatus && matchedType && matchedOrg;
  })
);
const pagedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredUsers.value.slice(start, start + pageSize.value);
});
const isEdit = computed(() => Boolean(form.id));

async function loadData() {
  loading.value = true;
  try {
    const [tenantRows, orgRows, roleRows, userRows] = await Promise.all([
      listTenants(),
      listOrganizations(),
      getRoles(),
      listSystemUsers(selectedTenantId.value)
    ]);
    tenants.value = tenantRows;
    organizations.value = orgRows;
    roles.value = roleRows;
    users.value = userRows;
  } finally {
    loading.value = false;
  }
}

async function reloadUsers() {
  users.value = await listSystemUsers(selectedTenantId.value);
  selectedUsers.value = [];
}

function firstOrganizationId(tenantId: string, orgType: FormOrgType) {
  const scopes =
    orgType === "HEADQUARTERS"
      ? [RoleScope.Operator]
      : [RoleScope.CarShop, RoleScope.Store, RoleScope.Station];
  return organizations.value.find(
    (item) => item.tenantId === tenantId && scopes.includes(item.type)
  )?.id;
}

function defaultRoleIds(orgType: FormOrgType, isAdmin = false) {
  if (isAdmin) {
    return ["role_platform_admin"];
  }
  const scopes =
    orgType === "HEADQUARTERS"
      ? [RoleScope.Operator]
      : [RoleScope.CarShop, RoleScope.Store, RoleScope.Station];
  const role = roles.value.find(
    (item) => !item.fixedAllPermissions && scopes.includes(item.scope)
  );
  return role ? [role.id] : [];
}

function openCreate() {
  formOrgType.value = "HEADQUARTERS";
  Object.assign(form, {
    id: undefined,
    tenantId: selectedTenantId.value,
    account: "",
    displayName: "",
    phone: "",
    organizationId: firstOrganizationId(selectedTenantId.value, "HEADQUARTERS"),
    roleIds: defaultRoleIds("HEADQUARTERS"),
    isPlatformAdmin: false,
    isActive: true
  });
  dialogVisible.value = true;
}

function openEdit(row: SystemUserRow) {
  formOrgType.value = [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(
    row.scope
  )
    ? "STORE"
    : "HEADQUARTERS";
  Object.assign(form, {
    id: row.id,
    tenantId: row.tenantId,
    account: row.account,
    displayName: row.displayName,
    phone: row.phone ?? "",
    organizationId: row.organizationId,
    roleIds: [...row.roleIds],
    isPlatformAdmin: row.isPlatformAdmin,
    isActive: row.isActive
  });
  dialogVisible.value = true;
}

function switchSidebarTab(tab: SidebarTab) {
  sidebarTab.value = tab;
  filterOrgId.value = "";
}

function selectOrganization(id: string) {
  filterOrgId.value = id;
}

function setFormOrgType(type: FormOrgType) {
  formOrgType.value = type;
  form.organizationId = firstOrganizationId(form.tenantId, type);
  form.roleIds = defaultRoleIds(type, Boolean(form.isPlatformAdmin));
}

function togglePlatformAdmin(value: boolean | string | number) {
  form.roleIds = defaultRoleIds(formOrgType.value, Boolean(value));
}

async function submit() {
  if (!form.account.trim() || !form.displayName.trim()) {
    ElMessage.warning("账号和姓名不能为空");
    return;
  }
  if (!form.organizationId) {
    ElMessage.warning("请选择归属组织");
    return;
  }
  if (!form.isPlatformAdmin && form.roleIds.length === 0) {
    ElMessage.warning("普通用户至少选择一个角色");
    return;
  }

  saving.value = true;
  try {
    await saveSystemUser({ ...form });
    ElMessage.success(isEdit.value ? "员工信息已更新" : "员工创建成功");
    dialogVisible.value = false;
    await reloadUsers();
  } finally {
    saving.value = false;
  }
}

async function handleStatusChange(row: SystemUserRow) {
  try {
    const savedUser = await setSystemUserStatus(row.id, row.isActive);
    const index = users.value.findIndex((item) => item.id === row.id);
    if (index >= 0) {
      users.value[index] = savedUser;
    }
    ElMessage.success(`员工 ${row.displayName} 已${savedUser.isActive ? "启用" : "禁用"}`);
  } catch {
    row.isActive = !row.isActive;
    ElMessage.error("状态更新失败");
  }
}

async function resetPassword(row: SystemUserRow) {
  const result = await resetSystemUserPassword(row.id);
  ElMessage.success(result.message);
}

function handleMoreCommand(command: string, row: SystemUserRow) {
  if (command === "resetPwd") {
    void ElMessageBox.confirm(
      `确定要重置员工 ${row.displayName} 的登录密码吗？`,
      "重置密码",
      { confirmButtonText: "确认重置", cancelButtonText: "取消", type: "warning" }
    ).then(() => resetPassword(row));
  }
}

async function batchSetStatus(command: "enable" | "disable") {
  if (selectedUsers.value.length === 0) {
    return;
  }
  const nextStatus = command === "enable";
  await Promise.all(
    selectedUsers.value.map((row) => setSystemUserStatus(row.id, nextStatus))
  );
  ElMessage.success(
    `成功将 ${selectedUsers.value.length} 个账号设为${nextStatus ? "启用" : "禁用"}状态`
  );
  await reloadUsers();
}

function handleSelectionChange(selection: SystemUserRow[]) {
  selectedUsers.value = selection;
}

function handleImportCommand() {
  ElMessage.info("导入接口已预留，MVP 阶段暂不执行文件导入。");
}

function handleExport() {
  ElMessage.info("导出接口已预留，MVP 阶段暂不生成文件。");
}

function roleType(row: SystemUserRow) {
  return row.isPlatformAdmin ? "success" : "info";
}

function scopeLabel(row: SystemUserRow) {
  if (row.scope === RoleScope.Store) {
    return "门店";
  }
  if (row.scope === RoleScope.Station) {
    return "站点";
  }
  if (row.scope === RoleScope.CarShop) {
    return "车行";
  }
  return "营运";
}

function accountCount(tab: SidebarTab) {
  if (tab === "HEADQUARTERS") {
    return users.value.filter((user) => user.scope === RoleScope.Operator).length;
  }
  if (tab === "PROVIDERS") {
    return users.value.filter((user) =>
      [RoleScope.CarShop, RoleScope.Store, RoleScope.Station].includes(user.scope)
    ).length;
  }
  return users.value.length;
}

function goToRoles() {
  void router.push("/permissions");
}

watch([searchKeyword, filterRole, filterStatus, sidebarTab, filterOrgId], () => {
  currentPage.value = 1;
});

watch(
  () => form.tenantId,
  (tenantId) => {
    const currentOrgStillValid = tenantOrganizations.value.some(
      (org) => org.id === form.organizationId
    );
    if (!currentOrgStillValid) {
      form.organizationId = firstOrganizationId(tenantId, formOrgType.value);
    }
  }
);

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button type="primary" color="#00689E" @click="openCreate">
        <el-icon class="mr-1"><Plus /></el-icon>
        新增员工
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>平台账户管理</h1>
        <p>管理公司内部员工账号、所属部门及系统角色权限。</p>
      </div>
      <div class="flex gap-3">
        <el-select v-model="selectedTenantId" size="large" style="width: 220px" @change="reloadUsers">
          <el-option
            v-for="tenant in tenants"
            :key="tenant.tenantId"
            :label="tenant.tenantName"
            :value="tenant.tenantId"
          />
        </el-select>
        <el-button size="large" @click="goToRoles">
          <el-icon class="mr-1"><Key /></el-icon>
          角色管理
        </el-button>
        <el-button
          type="primary"
          size="large"
          class="shadow-md shadow-indigo-500/20"
          color="#00689E"
          @click="openCreate"
        >
          <el-icon class="mr-1"><Plus /></el-icon>
          新增员工
        </el-button>
      </div>
    </div>

    <div class="flex gap-6 min-h-[calc(100vh-168px)]">
      <aside
        class="w-72 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col p-4 overflow-y-auto custom-scroll"
      >
        <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">账号类型</div>
        <div class="space-y-2 mb-6">
          <button
            class="employee-filter-button"
            :class="sidebarTab === 'ALL' ? 'employee-filter-active' : 'employee-filter-idle'"
            @click="switchSidebarTab('ALL')"
          >
            <span class="employee-filter-icon" :class="sidebarTab === 'ALL' ? 'employee-filter-icon-active' : ''">
              <Grid />
            </span>
            <span class="font-medium text-sm">全部账户</span>
            <span class="ml-auto text-xs opacity-70">{{ accountCount("ALL") }}</span>
          </button>
          <button
            class="employee-filter-button"
            :class="sidebarTab === 'HEADQUARTERS' ? 'employee-filter-active' : 'employee-filter-idle'"
            @click="switchSidebarTab('HEADQUARTERS')"
          >
            <span class="employee-filter-icon" :class="sidebarTab === 'HEADQUARTERS' ? 'employee-filter-icon-active' : ''">
              <OfficeBuilding />
            </span>
            <span class="font-medium text-sm">营运账户</span>
            <span class="ml-auto text-xs opacity-70">{{ accountCount("HEADQUARTERS") }}</span>
          </button>
          <button
            class="employee-filter-button"
            :class="sidebarTab === 'PROVIDERS' ? 'employee-filter-active' : 'employee-filter-idle'"
            @click="switchSidebarTab('PROVIDERS')"
          >
            <span class="employee-filter-icon" :class="sidebarTab === 'PROVIDERS' ? 'employee-filter-icon-active' : ''">
              <Shop />
            </span>
            <span class="font-medium text-sm">车行账户</span>
            <span class="ml-auto text-xs opacity-70">{{ accountCount("PROVIDERS") }}</span>
          </button>
        </div>

        <template v-if="sidebarTab === 'HEADQUARTERS'">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-bold text-gray-400 uppercase tracking-wider">部门列表</div>
            <el-button link type="primary" size="small">新增</el-button>
          </div>
          <div class="space-y-1">
            <button
              v-for="dept in departments"
              :key="dept.id"
              class="employee-filter-button"
              :class="filterOrgId === dept.id ? 'employee-filter-active' : 'employee-filter-idle'"
              @click="selectOrganization(dept.id)"
            >
              <span class="employee-filter-icon" :class="filterOrgId === dept.id ? 'employee-filter-icon-active' : ''">
                <OfficeBuilding />
              </span>
              <span class="truncate font-medium text-sm flex-1 text-left">{{ dept.name }}</span>
            </button>
          </div>
        </template>

        <template v-else-if="sidebarTab === 'PROVIDERS'">
          <div class="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">车行结构</div>
          <div class="rounded-xl border border-gray-100 bg-gray-50/70 p-2">
            <button
              v-for="org in providerOrganizations"
              :key="org.id"
              class="employee-tree-row"
              :class="filterOrgId === org.id ? 'text-[#00689E] bg-white shadow-sm' : 'text-gray-600 hover:bg-white'"
              @click="selectOrganization(org.id)"
            >
              <el-icon class="mr-2 text-gray-400">
                <Shop v-if="org.type === RoleScope.Store || org.type === RoleScope.CarShop" />
                <Location v-else />
              </el-icon>
              <span class="flex-1 truncate text-sm text-left">{{ org.name }}</span>
            </button>
          </div>
        </template>

        <div class="mt-auto pt-5 text-xs text-gray-400 leading-relaxed">
          当前租户：{{ selectedTenant?.tenantName || "未选择" }}
        </div>
      </aside>

      <section class="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div class="p-4 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索姓名/电话/账号"
              clearable
              style="width: 240px"
              prefix-icon="Search"
            />
            <el-select v-model="filterRole" placeholder="搜索角色" filterable clearable style="width: 160px">
              <el-option
                v-for="role in roles"
                :key="role.id"
                :label="role.name"
                :value="role.id"
              />
            </el-select>
            <el-select v-model="filterStatus" placeholder="状态" clearable style="width: 120px">
              <el-option label="启用" :value="true" />
              <el-option label="禁用" :value="false" />
            </el-select>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <el-button type="success" plain @click="handleImportCommand">
              <el-icon class="mr-1"><Upload /></el-icon>
              导入
            </el-button>
            <el-button v-if="canExport" type="primary" plain @click="handleExport">
              <el-icon class="mr-1"><Download /></el-icon>
              导出
            </el-button>
            <el-dropdown @command="batchSetStatus" trigger="click">
              <el-button type="warning" plain :disabled="selectedUsers.length === 0">
                批量设置
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="enable" class="text-emerald-600">
                    <el-icon><Check /></el-icon>
                    批量启用
                  </el-dropdown-item>
                  <el-dropdown-item command="disable" class="text-red-500">
                    <el-icon><Close /></el-icon>
                    批量禁用
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <span
              v-if="selectedUsers.length > 0"
              class="text-xs text-blue-600 font-medium whitespace-nowrap bg-blue-50 px-2 py-1 rounded border border-blue-100"
            >
              已选 {{ selectedUsers.length }} 项
            </span>
          </div>
          <div class="text-sm text-gray-500 whitespace-nowrap ml-auto">共 {{ filteredUsers.length }} 人员</div>
        </div>

        <el-table
          v-loading="loading"
          :data="pagedUsers"
          stripe
          style="width: 100%"
          class="prototype-table flex-1"
          :header-cell-style="{ backgroundColor: '#f9fafb', color: '#374151', fontWeight: 'bold' }"
          @selection-change="handleSelectionChange"
        >
          <el-table-column type="selection" width="55" align="center" />
          <el-table-column label="姓名" width="300">
            <template #default="{ row }">
              <div class="flex items-center min-w-0">
                <el-avatar :size="32" class="bg-blue-100 text-blue-600 mr-3 border border-blue-200 shrink-0">
                  {{ row.displayName.charAt(0) }}
                </el-avatar>
                <div class="min-w-0">
                  <div class="font-medium text-gray-900">{{ row.displayName }}</div>
                  <div class="text-xs text-gray-400 whitespace-nowrap" :title="row.account">{{ row.account }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="归属组织" min-width="180">
            <template #default="{ row }">
              <div class="flex items-center">
                <el-tag
                  size="small"
                  :type="row.scope === RoleScope.Operator ? 'info' : 'warning'"
                  class="mr-1"
                >
                  {{ scopeLabel(row) }}
                </el-tag>
                <span class="text-sm">{{ row.organizationName || "-" }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="180">
            <template #default="{ row }">
              <div class="flex flex-wrap gap-1">
                <el-tag
                  v-for="roleName in row.roleNames"
                  :key="roleName"
                  size="small"
                  :type="roleType(row)"
                  effect="plain"
                >
                  {{ roleName }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="联系方式" min-width="180">
            <template #default="{ row }">
              <div class="text-sm text-gray-900">{{ row.phone || "-" }}</div>
              <div class="text-xs text-gray-400">{{ row.isPlatformAdmin ? "固定全部权限" : `${row.permissions.length} 项权限` }}</div>
            </template>
          </el-table-column>
          <el-table-column label="最后登录" width="160">
            <template #default>
              <span class="text-gray-500 text-sm">-</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-switch
                v-model="row.isActive"
                size="small"
                style="--el-switch-on-color: #10b981;"
                @change="handleStatusChange(row)"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="160" align="right" fixed="right">
            <template #default="{ row }">
              <div class="flex justify-end gap-2">
                <el-button type="primary" link size="small" @click="openEdit(row)">编辑</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleMoreCommand(cmd, row)">
                  <el-button type="info" link size="small">
                    更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="resetPwd">重置密码</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <div class="p-3 border-t border-gray-100 flex justify-end bg-gray-50">
          <el-pagination
            v-model:current-page="currentPage"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50]"
            :total="filteredUsers.length"
            small
            background
            layout="total, prev, pager, next"
          />
        </div>
      </section>
    </div>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑员工' : '新增员工'" width="560px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="归属组织" class="mb-6">
          <el-radio-group v-model="formOrgType" class="full-width-radio" @change="setFormOrgType">
            <el-radio-button label="HEADQUARTERS">营运账户</el-radio-button>
            <el-radio-button label="STORE">车行账户</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="租户">
            <el-select v-model="form.tenantId" class="w-full">
              <el-option
                v-for="tenant in tenants"
                :key="tenant.tenantId"
                :label="tenant.tenantName"
                :value="tenant.tenantId"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="账号">
            <el-input v-model="form.account" :disabled="Boolean(form.id)" placeholder="请输入账号" />
          </el-form-item>
          <el-form-item label="姓名">
            <el-input v-model="form.displayName" placeholder="请输入员工姓名" />
          </el-form-item>
          <el-form-item label="手机号">
            <el-input v-model="form.phone" placeholder="请输入手机号" />
          </el-form-item>
        </div>

        <div class="mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">职位与权限</div>
        <div class="bg-gray-50 p-4 rounded-lg mb-4 border border-gray-100">
          <el-form-item :label="formOrgType === 'HEADQUARTERS' ? '所属部门' : '车行/门店/站点'">
            <el-select v-model="form.organizationId" class="w-full" placeholder="请选择归属组织">
              <el-option
                v-for="org in scopedFormOrganizations"
                :key="org.id"
                :label="org.name"
                :value="org.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="平台管理员">
            <el-switch
              v-model="form.isPlatformAdmin"
              active-text="固定全部权限"
              inactive-text="按角色配置"
              @change="togglePlatformAdmin"
            />
          </el-form-item>
          <el-form-item label="角色" class="mb-0">
            <el-select v-model="form.roleIds" multiple class="w-full" :disabled="form.isPlatformAdmin">
              <el-option
                v-for="role in editableRoles"
                :key="role.id"
                :label="role.name"
                :value="role.id"
              />
            </el-select>
          </el-form-item>
        </div>

        <el-form-item label="激活状态" class="mb-0">
          <div class="flex items-center justify-between w-full">
            <span class="text-xs text-gray-400">关闭后员工将无法登录系统</span>
            <el-switch v-model="form.isActive" active-text="启用" inactive-text="禁用" />
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" :loading="saving" @click="submit">
          {{ isEdit ? "保存修改" : "确认创建" }}
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
