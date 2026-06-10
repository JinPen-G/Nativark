<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref, watch } from "vue";
import type {
  PermissionLeaf,
  PermissionModule,
  SaveSystemRoleRequest,
  SystemDataScope,
  SystemRoleRow
} from "@rimo/shared";
import { RoleScope } from "@rimo/shared";
import {
  deleteSystemRole,
  getPermissionTree,
  getRoles,
  saveSystemRole
} from "../api/client";
import AppLayout from "../components/AppLayout.vue";

type BusinessScope =
  | "SHARING_ROUND"
  | "SHARING_ONEWAY"
  | "STORE_STANDARD"
  | "STORE_24H"
  | "GOV_FLEET"
  | "SYSTEM_GLOBAL";

interface PermissionGroup {
  title: string;
  permissions: PermissionLeaf[];
  readonly?: boolean;
}

const businessScopeOptions: Array<{
  label: string;
  value: BusinessScope;
  mvp: boolean;
}> = [
  { label: "同站租还", value: "SHARING_ROUND", mvp: false },
  { label: "甲租乙还", value: "SHARING_ONEWAY", mvp: false },
  { label: "门市租车", value: "STORE_STANDARD", mvp: true },
  { label: "24h门市租车", value: "STORE_24H", mvp: true },
  { label: "公务车", value: "GOV_FLEET", mvp: false },
  { label: "系统配置", value: "SYSTEM_GLOBAL", mvp: true }
];
const businessTabs = [
  { label: "分时-同站", name: "SHARING_ROUND" },
  { label: "分时-异地", name: "SHARING_ONEWAY" },
  { label: "门店-标准", name: "STORE_STANDARD" },
  { label: "门店-24H", name: "STORE_24H" },
  { label: "公务车", name: "GOV_FLEET" },
  { label: "系统配置", name: "SYSTEM_GLOBAL" }
] satisfies Array<{ label: string; name: BusinessScope }>;
const roleTypes = [
  { label: "营运 (Headquarters)", value: RoleScope.Operator },
  { label: "车行 (Provider)", value: RoleScope.CarShop },
  { label: "门市 (Store)", value: RoleScope.Store },
  { label: "站点 (Station)", value: RoleScope.Station }
];
const dataScopeOptions: Array<{ label: string; value: SystemDataScope }> = [
  { label: "全部数据", value: "all" },
  { label: "所属组织", value: "organization" },
  { label: "所属门市", value: "store" },
  { label: "仅本人", value: "own" }
];
const reservedPermissionGroups: Record<string, PermissionGroup[]> = {
  SHARING_ROUND: [
    {
      title: "订单管理",
      readonly: true,
      permissions: [
        { code: "reserved:sharing.round.order.view", name: "查看订单", description: "查看同站分时订单列表及详情" },
        { code: "reserved:sharing.round.order.finish", name: "强制还车", description: "处理异常订单，强制结束计费" }
      ]
    },
    {
      title: "车辆与网点",
      readonly: true,
      permissions: [
        { code: "reserved:sharing.round.vehicle.monitor", name: "车辆监控", description: "查看车辆实时位置及电量" },
        { code: "reserved:sharing.round.station.manage", name: "网点管理", description: "维护同站租还网点" }
      ]
    }
  ],
  SHARING_ONEWAY: [
    {
      title: "调度管理",
      readonly: true,
      permissions: [
        { code: "reserved:sharing.oneway.dispatch", name: "跨站调度", description: "处理异地还车后的车辆调拨" },
        { code: "reserved:sharing.oneway.station.manage", name: "网点管理", description: "新增或调整还车网点围栏" }
      ]
    }
  ],
  GOV_FLEET: [
    {
      title: "审批流程",
      readonly: true,
      permissions: [
        { code: "reserved:gov.approval.manage", name: "审批管理", description: "处理公务车用车审批" },
        { code: "reserved:gov.bill.view", name: "月结账单", description: "查看公务车月结账单" }
      ]
    }
  ]
};

const roles = ref<SystemRoleRow[]>([]);
const permissionTree = ref<PermissionModule[]>([]);
const selectedRoleId = ref("role_store_operator");
const checkedPermissions = ref<string[]>([]);
const currentScopes = ref<string[]>([]);
const currentDataScope = ref<SystemDataScope>("store");
const activeTab = ref<BusinessScope>("STORE_STANDARD");
const saving = ref(false);
const roleDialogVisible = ref(false);
const isEditRole = ref(false);

const roleForm = reactive<{
  id?: string;
  code: string;
  name: string;
  scope: RoleScope;
  dataScope: SystemDataScope;
  description: string;
  isActive: boolean;
}>({
  code: "",
  name: "",
  scope: RoleScope.Store,
  dataScope: "store",
  description: "",
  isActive: true
});

const selectedRole = computed(() =>
  roles.value.find((role) => role.id === selectedRoleId.value)
);
const allPermissionCodes = computed(() =>
  permissionTree.value.flatMap((module) =>
    module.children.map((permission) => permission.code)
  )
);

async function loadData() {
  const [roleRows, tree] = await Promise.all([getRoles(), getPermissionTree()]);
  roles.value = roleRows;
  permissionTree.value = tree;
  if (!roles.value.some((role) => role.id === selectedRoleId.value)) {
    selectedRoleId.value = roles.value[0]?.id ?? "";
  }
  syncSelectedRole();
}

function selectRole(role: SystemRoleRow) {
  selectedRoleId.value = role.id;
  syncSelectedRole();
}

function syncSelectedRole() {
  const role = selectedRole.value;
  if (!role) {
    checkedPermissions.value = [];
    currentScopes.value = [];
    currentDataScope.value = "store";
    return;
  }

  currentScopes.value = [...role.enabledBusinessScopes];
  currentDataScope.value =
    role.dataScope ?? defaultDataScopeByRoleScope(role.scope);
  checkedPermissions.value = role.fixedAllPermissions
    ? allPermissionCodes.value
    : [...new Set([...role.permissions, ...(role.buttonPermissions ?? [])])];
  activeTab.value = firstAvailableTab(currentScopes.value);
}

function firstAvailableTab(scopes: string[]) {
  return (
    businessTabs.find((tab) => scopes.includes(tab.name))?.name ?? "STORE_STANDARD"
  );
}

function filterPermissions(
  moduleCode: string,
  matcher: (permission: PermissionLeaf) => boolean
) {
  return (
    permissionTree.value
      .find((module) => module.code === moduleCode)
      ?.children.filter(matcher) ?? []
  );
}

function permissionGroupsFor(tab: string): PermissionGroup[] {
  if (tab === "STORE_STANDARD") {
    return [
      {
        title: "订单业务",
        permissions: filterPermissions("store-rental", (item) =>
          item.code.includes(":order:")
        )
      },
      {
        title: "车辆整备",
        permissions: filterPermissions("store-rental", (item) =>
          [":vehicle", ":vehicle-group", ":station", ":dispatch"].some((part) =>
            item.code.includes(part)
          )
        )
      },
      {
        title: "POS结算",
        permissions: filterPermissions("store-rental", (item) =>
          [":settle", ":finance", ":price", ":service", ":report", ":rules"].some((part) =>
            item.code.includes(part)
          )
        )
      }
    ];
  }

  if (tab === "STORE_24H") {
    return [
      {
        title: "自助设备监控",
        permissions: filterPermissions("store-rental", (item) =>
          [":station", ":vehicle"].some((part) => item.code.includes(part))
        )
      },
      {
        title: "异常订单介入",
        permissions: filterPermissions("store-rental", (item) =>
          [":order:", ":dispatch"].some((part) => item.code.includes(part))
        )
      }
    ];
  }

  if (tab === "SYSTEM_GLOBAL") {
    return [
      {
        title: "组织架构",
        permissions: filterPermissions("system", (item) =>
          [":user:", ":tenant:"].some((part) => item.code.includes(part))
        )
      },
      {
        title: "系统设置",
        permissions: filterPermissions("system", (item) =>
          [":role:", ":params:", ":dictionary:", ":number-rule:", ":button:"].some((part) =>
            item.code.includes(part)
          )
        )
      },
      {
        title: "平台治理",
        permissions: filterPermissions("system", (item) =>
          [":audit:", ":dictionary:", ":number-rule:", ":tenant:"].some((part) =>
            item.code.includes(part)
          )
        )
      }
    ];
  }

  return reservedPermissionGroups[tab] ?? [];
}

function isTabReadonly(tab: string) {
  return !businessScopeOptions.find((item) => item.value === tab)?.mvp;
}

function roleTypeLabel(scope?: RoleScope) {
  if (scope === RoleScope.CarShop) {
    return "车行";
  }
  if (scope === RoleScope.Store) {
    return "门市";
  }
  if (scope === RoleScope.Station) {
    return "站点";
  }
  return "营运";
}

function roleTagType(scope?: RoleScope) {
  if (scope === RoleScope.Operator) {
    return "danger";
  }
  if (scope === RoleScope.Store) {
    return "warning";
  }
  return "success";
}

function dataScopeLabel(scope?: SystemDataScope) {
  return dataScopeOptions.find((item) => item.value === scope)?.label ?? "所属门市";
}

function defaultScopesByRoleScope(scope: RoleScope) {
  return scope === RoleScope.Operator
    ? ["STORE_STANDARD", "STORE_24H", "SYSTEM_GLOBAL"]
    : ["STORE_STANDARD", "STORE_24H"];
}

function generateRoleCode() {
  return `CUSTOM_${Date.now()}`;
}

function isButtonPermission(code: string) {
  return code.includes(":button:") || [
    "store-rental:order:create",
    "store-rental:order:pickup",
    "store-rental:order:return",
    "store-rental:order:extend",
    "store-rental:order:cancel",
    "store-rental:order:close",
    "store-rental:order:fee-manage",
    "store-rental:vehicle:status-action",
    "store-rental:member:risk-action",
    "store-rental:corporate:monthly-settle",
    "store-rental:finance:adjust",
    "store-rental:finance:invoice",
    "system:button:export"
  ].includes(code);
}

function defaultDataScopeByRoleScope(scope: RoleScope): SystemDataScope {
  if (scope === RoleScope.Operator) {
    return "organization";
  }
  if (scope === RoleScope.Store || scope === RoleScope.Station) {
    return "store";
  }
  return "organization";
}

async function savePermissions() {
  const role = selectedRole.value;
  if (!role) {
    return;
  }
  if (role.fixedAllPermissions) {
    ElMessage.info("平台管理员固定拥有全部权限，无需保存。");
    return;
  }

  saving.value = true;
  try {
    const payload: SaveSystemRoleRequest = {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      scope: role.scope,
      enabledBusinessScopes: currentScopes.value,
      permissions: checkedPermissions.value.filter(
        (code) => !code.startsWith("reserved:") && !isButtonPermission(code)
      ),
      buttonPermissions: checkedPermissions.value.filter(
        (code) => !code.startsWith("reserved:") && isButtonPermission(code)
      ),
      dataScope: currentDataScope.value,
      isActive: role.isActive
    };
    const savedRole = await saveSystemRole(payload);
    const index = roles.value.findIndex((item) => item.id === savedRole.id);
    if (index >= 0) {
      roles.value[index] = savedRole;
    }
    selectRole(savedRole);
    ElMessage.success("权限配置已保存");
  } finally {
    saving.value = false;
  }
}

function resetPermissions() {
  syncSelectedRole();
  ElMessage.info("已重置为保存状态");
}

function openAddRoleDialog() {
  isEditRole.value = false;
  Object.assign(roleForm, {
    id: undefined,
    code: "",
    name: "",
    scope: RoleScope.Store,
    dataScope: defaultDataScopeByRoleScope(RoleScope.Store),
    description: "",
    isActive: true
  });
  roleDialogVisible.value = true;
}

function openEditRoleDialog() {
  const role = selectedRole.value;
  if (!role || role.fixedAllPermissions) {
    return;
  }
  isEditRole.value = true;
  Object.assign(roleForm, {
    id: role.id,
    code: role.code,
    name: role.name,
    scope: role.scope,
    dataScope: role.dataScope ?? defaultDataScopeByRoleScope(role.scope),
    description: role.description ?? "",
    isActive: role.isActive
  });
  roleDialogVisible.value = true;
}

async function confirmRoleDialog() {
  if (!roleForm.name.trim()) {
    ElMessage.warning("请输入角色名称");
    return;
  }

  const editingCurrentRole =
    isEditRole.value && selectedRole.value?.id === roleForm.id;
  const payload: SaveSystemRoleRequest = {
    id: roleForm.id,
    code: roleForm.code || generateRoleCode(),
    name: roleForm.name,
    description: roleForm.description,
    scope: roleForm.scope,
    enabledBusinessScopes: editingCurrentRole
      ? currentScopes.value
      : defaultScopesByRoleScope(roleForm.scope),
    permissions: editingCurrentRole
      ? checkedPermissions.value.filter(
          (code) => !code.startsWith("reserved:") && !isButtonPermission(code)
        )
      : [],
    buttonPermissions: editingCurrentRole
      ? checkedPermissions.value.filter(
          (code) => !code.startsWith("reserved:") && isButtonPermission(code)
        )
      : [],
    dataScope: roleForm.dataScope,
    isActive: roleForm.isActive
  };

  const savedRole = await saveSystemRole(payload);
  const index = roles.value.findIndex((role) => role.id === savedRole.id);
  if (index >= 0) {
    roles.value[index] = savedRole;
  } else {
    roles.value.unshift(savedRole);
  }
  roleDialogVisible.value = false;
  selectRole(savedRole);
  ElMessage.success(isEditRole.value ? "角色信息已更新" : "角色创建成功");
}

function deleteRole() {
  const role = selectedRole.value;
  if (!role || role.fixedAllPermissions) {
    return;
  }

  void ElMessageBox.confirm(
    `确定要删除角色 "${role.name}" 吗？此操作无法撤销。`,
    "删除确认",
    { confirmButtonText: "确定删除", cancelButtonText: "取消", type: "warning" }
  ).then(async () => {
    await deleteSystemRole(role.id);
    roles.value = roles.value.filter((item) => item.id !== role.id);
    selectedRoleId.value = roles.value[0]?.id ?? "";
    syncSelectedRole();
    ElMessage.success("角色已删除");
  });
}

watch(
  currentScopes,
  (scopes) => {
    if (!scopes.includes(activeTab.value)) {
      activeTab.value = firstAvailableTab(scopes);
    }
  },
  { deep: true }
);

watch(allPermissionCodes, () => {
  if (selectedRole.value?.fixedAllPermissions) {
    checkedPermissions.value = allPermissionCodes.value;
  }
});

watch(
  () => roleForm.scope,
  (scope) => {
    if (roleDialogVisible.value && !isEditRole.value) {
      roleForm.dataScope = defaultDataScopeByRoleScope(scope);
    }
  }
);

onMounted(loadData);
</script>

<template>
  <AppLayout>
    <template #header-actions>
      <el-button
        type="primary"
        color="#00689E"
        :loading="saving"
        :disabled="selectedRole?.fixedAllPermissions"
        @click="savePermissions"
      >
        <el-icon class="mr-1"><Check /></el-icon>
        保存配置
      </el-button>
    </template>

    <div class="prototype-page-title">
      <div>
        <h1>权限管理</h1>
        <p>按角色控制营运端账号可访问的业务线、菜单与操作权限。</p>
      </div>
    </div>

    <div class="flex min-h-[calc(100vh-168px)] gap-6">
      <aside class="w-72 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col">
        <div class="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-xl">
          <span class="font-bold text-gray-700">角色列表</span>
          <el-button type="primary" link icon="Plus" @click="openAddRoleDialog">新增</el-button>
        </div>
        <div class="flex-1 overflow-y-auto custom-scroll p-2 space-y-1">
          <button
            v-for="role in roles"
            :key="role.id"
            class="role-item p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors w-full text-left"
            :class="{ active: selectedRoleId === role.id }"
            @click="selectRole(role)"
          >
            <div class="flex justify-between items-start gap-2">
              <div class="min-w-0">
                <div class="font-medium text-gray-800 truncate">{{ role.name }}</div>
                <div class="text-xs text-gray-400 mt-1 line-clamp-2">{{ role.description }}</div>
              </div>
              <div class="flex gap-1 ml-2 shrink-0">
                <el-tag v-if="role.fixedAllPermissions" size="small" type="info">预设</el-tag>
                <el-tag size="small" :type="roleTagType(role.scope)" effect="plain">
                  {{ roleTypeLabel(role.scope) }}
                </el-tag>
              </div>
            </div>
          </button>
        </div>
      </aside>

      <section class="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden">
        <div class="p-6 border-b border-gray-100">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h2 class="text-xl font-bold text-gray-800 flex items-center">
                <el-icon class="mr-2 text-[#00689E]"><UserFilled /></el-icon>
                {{ selectedRole?.name || "-" }}
                <el-tag v-if="selectedRole?.code" class="ml-2" type="info">
                  {{ selectedRole.code }}
                </el-tag>
              </h2>
              <p class="text-gray-500 text-sm mt-1">{{ selectedRole?.description || "-" }}</p>
            </div>
            <div class="space-x-3 flex items-center">
              <template v-if="selectedRole && !selectedRole.fixedAllPermissions">
                <el-tooltip content="编辑角色信息" placement="top">
                  <el-button circle icon="Edit" @click="openEditRoleDialog" />
                </el-tooltip>
                <el-tooltip content="删除角色" placement="top">
                  <el-button circle type="danger" plain icon="Delete" @click="deleteRole" />
                </el-tooltip>
                <el-divider direction="vertical" />
              </template>
              <el-button @click="resetPermissions">重置</el-button>
              <el-button
                type="primary"
                color="#00689E"
                :loading="saving"
                :disabled="selectedRole?.fixedAllPermissions"
                @click="savePermissions"
              >
                <el-icon class="mr-1"><Check /></el-icon>
                保存配置
              </el-button>
            </div>
          </div>

          <div class="bg-blue-50 rounded-lg p-4 border border-blue-100">
            <div class="text-sm font-bold text-blue-800 mb-3 flex items-center justify-between gap-4">
              <span class="flex items-center">
                <el-icon class="mr-1"><Key /></el-icon>
                业务线授权 (Business Scope Authorization)
              </span>
              <div class="flex items-center gap-2 text-xs text-blue-700">
                <span>数据范围</span>
                <el-select
                  v-model="currentDataScope"
                  size="small"
                  style="width: 116px"
                  :disabled="selectedRole?.fixedAllPermissions"
                >
                  <el-option
                    v-for="scope in dataScopeOptions"
                    :key="scope.value"
                    :label="scope.label"
                    :value="scope.value"
                  />
                </el-select>
              </div>
            </div>
            <el-checkbox-group v-model="currentScopes" :disabled="selectedRole?.fixedAllPermissions">
              <el-checkbox
                v-for="scope in businessScopeOptions"
                :key="scope.value"
                :label="scope.value"
              >
                {{ scope.label }}
              </el-checkbox>
            </el-checkbox-group>
            <div class="mt-2 text-xs text-blue-600">
              当前角色保存后按“{{ dataScopeLabel(currentDataScope) }}”查询业务数据。
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-hidden flex flex-col">
          <el-tabs v-model="activeTab" class="h-full flex flex-col custom-tabs" type="border-card">
            <el-tab-pane
              v-for="tab in businessTabs"
              :key="tab.name"
              :label="tab.label"
              :name="tab.name"
              :disabled="!currentScopes.includes(tab.name)"
            >
              <div class="p-4 h-full overflow-y-auto custom-scroll">
                <div
                  v-for="group in permissionGroupsFor(tab.name)"
                  :key="group.title"
                  class="permission-group mb-4"
                >
                  <div class="text-sm font-bold text-gray-700 mb-3">{{ group.title }}</div>
                  <el-checkbox-group
                    v-model="checkedPermissions"
                    :disabled="selectedRole?.fixedAllPermissions || group.readonly || isTabReadonly(tab.name)"
                  >
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <el-checkbox
                        v-for="permission in group.permissions"
                        :key="permission.code"
                        :label="permission.code"
                        border
                        class="permission-card"
                      >
                        <div>
                          <div class="font-medium text-gray-800 flex items-center gap-2">
                            <span>{{ permission.name }}</span>
                            <el-tag
                              v-if="isButtonPermission(permission.code)"
                              size="small"
                              type="warning"
                              effect="plain"
                            >
                              按钮
                            </el-tag>
                          </div>
                          <div class="text-xs text-gray-400 mt-0.5">{{ permission.description || permission.code }}</div>
                        </div>
                      </el-checkbox>
                    </div>
                  </el-checkbox-group>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </section>
    </div>

    <el-dialog v-model="roleDialogVisible" :title="isEditRole ? '编辑角色' : '新增角色'" width="500px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="角色名称">
          <el-input v-model="roleForm.name" placeholder="例如：财务助理" />
        </el-form-item>
        <el-form-item label="角色类型">
          <el-select v-model="roleForm.scope" placeholder="请选择角色所属层级" style="width: 100%">
            <el-option
              v-for="type in roleTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="roleForm.dataScope" placeholder="请选择数据范围" style="width: 100%">
            <el-option
              v-for="scope in dataScopeOptions"
              :key="scope.value"
              :label="scope.label"
              :value="scope.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="角色描述">
          <el-input
            v-model="roleForm.description"
            type="textarea"
            :rows="3"
            placeholder="简要描述该角色的职责范围..."
          />
        </el-form-item>
        <el-form-item label="角色状态" class="mb-0">
          <el-switch v-model="roleForm.isActive" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" color="#00689E" @click="confirmRoleDialog">
          {{ isEditRole ? "保存修改" : "确认创建" }}
        </el-button>
      </template>
    </el-dialog>
  </AppLayout>
</template>
