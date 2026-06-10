<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

interface NavItem {
  to: string;
  icon: string;
  label: string;
  permission?: string;
  disabled?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "核心工作区",
    items: [{ to: "/login", icon: "UserFilled", label: "登录页" }]
  },
  {
    title: "数据看板",
    items: [
      { to: "/reports", icon: "Histogram", label: "数据报表", permission: "store-rental:report:view" }
    ]
  },
  {
    title: "订单中心",
    items: [
      { to: "/new-order", icon: "Plus", label: "新建门市订单", permission: "store-rental:order:operate" },
      { to: "/orders", icon: "List", label: "门市租赁订单", permission: "store-rental:order:view" }
    ]
  },
  {
    title: "定价与服务",
    items: [
      { to: "/service-products", icon: "Grid", label: "基础产品定价", permission: "store-rental:price:manage" },
      { to: "/pricing", icon: "Money", label: "动态调价策略", permission: "store-rental:price:manage" },
      { to: "/services", icon: "Goods", label: "增值服务管理", permission: "store-rental:service:manage" },
      { to: "/rental-rules", icon: "Setting", label: "租赁业务规则", permission: "store-rental:rules:manage" }
    ]
  },
  {
    title: "营销中心",
    items: [
      { to: "/marketing", icon: "Ticket", label: "营销方案管理", permission: "store-rental:marketing:manage" }
    ]
  },
  {
    title: "站点与区域",
    items: [{ to: "/stations", icon: "Location", label: "服务站点管理", permission: "store-rental:station:view" }]
  },
  {
    title: "车辆资产",
    items: [
      { to: "/vehicles", icon: "Files", label: "车辆档案库", permission: "store-rental:vehicle:view" },
      { to: "/vehicle-groups", icon: "Briefcase", label: "车型组管理", permission: "store-rental:vehicle-group:manage" },
      { to: "/tbox-management", icon: "Connection", label: "TBox 管理", permission: "store-rental:vehicle:manage" }
    ]
  },
  {
    title: "车辆营运与调度",
    items: [
      { to: "/dispatch", icon: "Van", label: "车辆排程看板", permission: "store-rental:dispatch:manage" },
      { to: "/vehicle-transfer", icon: "Switch", label: "车辆调拨管理", permission: "store-rental:vehicle:manage" },
      { to: "/vehicle-status", icon: "DataAnalysis", label: "车辆速查表", permission: "store-rental:vehicle:view" },
      { to: "/vehicle-console", icon: "Monitor", label: "车辆控制台", permission: "store-rental:vehicle:status-action" }
    ]
  },
  {
    title: "客户运营",
    items: [
      { to: "/members", icon: "User", label: "个人会员管理", permission: "store-rental:member:view" },
      { to: "/member-reviews", icon: "Checked", label: "会员审核", permission: "store-rental:member:manage" },
      { to: "/membership-plans", icon: "Medal", label: "客户等级方案", permission: "store-rental:member:manage" },
      { to: "/corporates", icon: "OfficeBuilding", label: "企业客户管理", permission: "store-rental:corporate:view" }
    ]
  },
  {
    title: "财务中心",
    items: [
      { to: "/finance", icon: "Money", label: "财务结算", permission: "store-rental:finance:view" }
    ]
  },
  {
    title: "系统管理",
    items: [
      { to: "/organizations", icon: "OfficeBuilding", label: "组织架构", permission: "system:user:manage" },
      { to: "/users", icon: "Avatar", label: "平台账户管理", permission: "system:user:manage" },
      { to: "/permissions", icon: "Lock", label: "权限管理", permission: "system:role:manage" },
      { to: "/system-rules", icon: "Operation", label: "系统通用参数", permission: "system:params:manage" },
      { to: "/security-baseline", icon: "DocumentChecked", label: "安全基线", permission: "system:params:manage" },
      { to: "/platform-governance", icon: "Tickets", label: "平台治理中心", permission: "system:audit:view" },
      { to: "/notifications", icon: "Bell", label: "通知中心", permission: "system:integration:manage" },
      { to: "/file-assets", icon: "FolderOpened", label: "附件与打印", permission: "system:integration:manage" },
      { to: "/async-jobs", icon: "Clock", label: "异步任务", permission: "system:integration:manage" },
      { to: "/integrations", icon: "Connection", label: "外部接入与任务", permission: "system:integration:manage" }
    ]
  }
];

const visibleNavGroups = computed(() =>
  navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => item.disabled || authStore.hasPermission(item.permission)
      )
    }))
    .filter((group) => group.items.length > 0)
);
const title = computed(() => String(route.meta.title ?? "租赁业务规则"));
const section = computed(() => String(route.meta.section ?? "定价与服务"));

async function logout() {
  authStore.logout();
  await router.push("/login");
}
</script>

<template>
  <div class="page-shell" v-cloak>
    <aside class="w-64 shrink-0 bg-[#00689E] text-white flex flex-col">
      <div class="h-16 flex items-center px-6 border-b border-white/10">
        <RouterLink to="/rental-rules" class="text-white font-bold text-xl tracking-wider flex items-center group">
          <el-icon class="mr-2 group-hover:rotate-12 transition-transform">
            <Platform />
          </el-icon>
          RIMO Rental
        </RouterLink>
      </div>

      <nav class="flex-1 py-6 px-3 space-y-1 text-sm custom-scroll overflow-y-auto">
        <template v-for="group in visibleNavGroups" :key="group.title">
          <div class="pt-3 mt-3 border-t border-white/10 first:border-t-0 first:pt-0 first:mt-0">
            <div class="px-3 py-2 text-xs text-white/40 font-medium uppercase tracking-wider">{{ group.title }}</div>
            <template v-for="item in group.items" :key="item.label">
              <span
                v-if="item.disabled"
                class="flex items-center px-3 py-2.5 rounded-lg text-white/35 cursor-not-allowed relative"
              >
                <el-icon class="mr-3 text-lg">
                  <component :is="item.icon" />
                </el-icon>
                <span class="font-medium">{{ item.label }}</span>
              </span>
              <RouterLink v-else :to="item.to" class="rimo-sidebar-link">
                <el-icon class="mr-3 text-lg">
                  <component :is="item.icon" />
                </el-icon>
                <span class="font-medium">{{ item.label }}</span>
              </RouterLink>
            </template>
          </div>
        </template>
      </nav>
    </aside>

    <div class="flex-1 flex flex-col min-w-0">
      <header class="h-16 bg-white shadow-sm border-b px-6 flex items-center justify-between z-10">
        <div class="flex items-center text-gray-500 text-sm">
          <el-icon class="mr-2">
            <HomeFilled />
          </el-icon>
          <span>首页</span><span class="mx-2">/</span>
          <span>{{ section }}</span><span class="mx-2">/</span>
          <span class="text-gray-800 font-bold">{{ title }}</span>
        </div>
        <div class="flex items-center gap-4">
          <el-dropdown>
            <span class="el-dropdown-link flex items-center text-sm font-medium text-gray-700 cursor-pointer">
              <span class="w-2 h-2 rounded-full bg-green-500 mr-2"></span>
              {{ authStore.tenant?.tenantName || "RIMO 香港租户" }}
              <el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item>{{ authStore.user?.displayName || "未登录用户" }}</el-dropdown-item>
                <el-dropdown-item>{{ authStore.user?.roleNames?.join("、") || "默认全功能预览" }}</el-dropdown-item>
                <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <slot name="header-actions" />
        </div>
      </header>

      <main class="flex-1 overflow-auto p-6 custom-scroll bg-gray-50/70">
        <slot />
      </main>
    </div>
  </div>
</template>
