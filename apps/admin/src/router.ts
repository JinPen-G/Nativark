import { createRouter, createWebHistory } from "vue-router";
import AsyncJobsView from "./views/AsyncJobsView.vue";
import CorporateDetailView from "./views/CorporateDetailView.vue";
import CorporatesView from "./views/CorporatesView.vue";
import DispatchView from "./views/DispatchView.vue";
import DynamicPricingView from "./views/DynamicPricingView.vue";
import FileAssetsView from "./views/FileAssetsView.vue";
import FinanceCenterView from "./views/FinanceCenterView.vue";
import IntegrationOpsView from "./views/IntegrationOpsView.vue";
import LoginView from "./views/LoginView.vue";
import MarketingView from "./views/MarketingView.vue";
import MemberDetailView from "./views/MemberDetailView.vue";
import MemberReviewView from "./views/MemberReviewView.vue";
import MembersView from "./views/MembersView.vue";
import MembershipPlansView from "./views/MembershipPlansView.vue";
import NewOrderView from "./views/NewOrderView.vue";
import NotificationsView from "./views/NotificationsView.vue";
import OrganizationManagementView from "./views/OrganizationManagementView.vue";
import OrderDetailView from "./views/OrderDetailView.vue";
import OrdersView from "./views/OrdersView.vue";
import PlatformGovernanceView from "./views/PlatformGovernanceView.vue";
import ProductPricingView from "./views/ProductPricingView.vue";
import PermissionsView from "./views/PermissionsView.vue";
import RentalRulesView from "./views/RentalRulesView.vue";
import ReportsOpsView from "./views/ReportsOpsView.vue";
import SecurityBaselineView from "./views/SecurityBaselineView.vue";
import StationsView from "./views/StationsView.vue";
import SystemRulesView from "./views/SystemRulesView.vue";
import UserManagementView from "./views/UserManagementView.vue";
import ValueAddedServicesView from "./views/ValueAddedServicesView.vue";
import VehicleGroupsView from "./views/VehicleGroupsView.vue";
import VehicleConsoleView from "./views/VehicleConsoleView.vue";
import VehicleStatusListView from "./views/VehicleStatusListView.vue";
import VehicleTransferView from "./views/VehicleTransferView.vue";
import VehiclesView from "./views/VehiclesView.vue";
import TboxManagementView from "./views/TboxManagementView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/rental-rules"
    },
    {
      path: "/login",
      component: LoginView,
      meta: {
        title: "登录页",
        section: "核心工作区"
      }
    },
    {
      path: "/rental-rules",
      component: RentalRulesView,
      meta: {
        title: "租赁业务规则",
        section: "定价与服务",
        permission: "store-rental:rules:manage"
      }
    },
    {
      path: "/service-products",
      component: ProductPricingView,
      meta: {
        title: "基础产品定价",
        section: "定价与服务",
        permission: "store-rental:price:manage"
      }
    },
    {
      path: "/services",
      component: ValueAddedServicesView,
      meta: {
        title: "增值服务管理",
        section: "定价与服务",
        permission: "store-rental:service:manage"
      }
    },
    {
      path: "/stations",
      component: StationsView,
      meta: {
        title: "服务站点管理",
        section: "站点与区域",
        permission: "store-rental:station:view"
      }
    },
    {
      path: "/vehicle-groups",
      component: VehicleGroupsView,
      meta: {
        title: "车型组管理",
        section: "车辆资产",
        permission: "store-rental:vehicle-group:manage"
      }
    },
    {
      path: "/vehicles",
      component: VehiclesView,
      meta: {
        title: "车辆档案库",
        section: "车辆资产",
        permission: "store-rental:vehicle:view"
      }
    },
    {
      path: "/vehicle-status",
      component: VehicleStatusListView,
      meta: {
        title: "车辆速查表",
        section: "车辆营运与调度",
        permission: "store-rental:vehicle:view"
      }
    },
    {
      path: "/vehicle-transfer",
      component: VehicleTransferView,
      meta: {
        title: "车辆调拨管理",
        section: "车辆营运与调度",
        permission: "store-rental:vehicle:manage"
      }
    },
    {
      path: "/vehicle-console",
      component: VehicleConsoleView,
      meta: {
        title: "车辆控制台",
        section: "车辆营运与调度",
        permission: "store-rental:vehicle:status-action"
      }
    },
    {
      path: "/tbox-management",
      component: TboxManagementView,
      meta: {
        title: "TBox 管理",
        section: "车辆资产",
        permission: "store-rental:vehicle:manage"
      }
    },
    {
      path: "/dispatch",
      component: DispatchView,
      meta: {
        title: "车辆排程看板",
        section: "车辆营运与调度",
        permission: "store-rental:dispatch:manage"
      }
    },
    {
      path: "/reports",
      component: ReportsOpsView,
      meta: {
        title: "数据报表",
        section: "数据看板",
        permission: "store-rental:report:view"
      }
    },
    {
      path: "/members",
      component: MembersView,
      meta: {
        title: "个人会员管理",
        section: "客户运营",
        permission: "store-rental:member:view"
      }
    },
    {
      path: "/members/:id",
      component: MemberDetailView,
      meta: {
        title: "会员详情",
        section: "客户运营",
        permission: "store-rental:member:view"
      }
    },
    {
      path: "/member-reviews",
      component: MemberReviewView,
      meta: {
        title: "会员审核",
        section: "客户运营",
        permission: "store-rental:member:manage"
      }
    },
    {
      path: "/membership-plans",
      component: MembershipPlansView,
      meta: {
        title: "客户等级方案",
        section: "客户运营",
        permission: "store-rental:member:manage"
      }
    },
    {
      path: "/corporates",
      component: CorporatesView,
      meta: {
        title: "企业客户管理",
        section: "客户运营",
        permission: "store-rental:corporate:view"
      }
    },
    {
      path: "/corporates/:id",
      component: CorporateDetailView,
      meta: {
        title: "企业客户详情",
        section: "客户运营",
        permission: "store-rental:corporate:view"
      }
    },
    {
      path: "/finance",
      component: FinanceCenterView,
      meta: {
        title: "财务结算",
        section: "财务中心",
        permission: "store-rental:finance:view"
      }
    },
    {
      path: "/organizations",
      component: OrganizationManagementView,
      meta: {
        title: "组织架构",
        section: "系统管理",
        permission: "system:user:manage"
      }
    },
    {
      path: "/users",
      component: UserManagementView,
      meta: {
        title: "平台账户管理",
        section: "系统管理",
        permission: "system:user:manage"
      }
    },
    {
      path: "/permissions",
      component: PermissionsView,
      meta: {
        title: "权限管理",
        section: "系统管理",
        permission: "system:role:manage"
      }
    },
    {
      path: "/system-rules",
      component: SystemRulesView,
      meta: {
        title: "系统通用参数",
        section: "系统管理",
        permission: "system:params:manage"
      }
    },
    {
      path: "/security-baseline",
      component: SecurityBaselineView,
      meta: {
        title: "安全基线",
        section: "系统管理",
        permission: "system:params:manage"
      }
    },
    {
      path: "/platform-governance",
      component: PlatformGovernanceView,
      meta: {
        title: "平台治理中心",
        section: "系统管理",
        permission: "system:audit:view"
      }
    },
    {
      path: "/integrations",
      component: IntegrationOpsView,
      meta: {
        title: "外部接入与任务日志",
        section: "系统管理",
        permission: "system:integration:manage"
      }
    },
    {
      path: "/notifications",
      component: NotificationsView,
      meta: {
        title: "通知中心",
        section: "系统管理",
        permission: "system:integration:manage"
      }
    },
    {
      path: "/file-assets",
      component: FileAssetsView,
      meta: {
        title: "附件与打印中心",
        section: "系统管理",
        permission: "system:integration:manage"
      }
    },
    {
      path: "/async-jobs",
      component: AsyncJobsView,
      meta: {
        title: "异步任务中心",
        section: "系统管理",
        permission: "system:integration:manage"
      }
    },
    {
      path: "/pricing",
      component: DynamicPricingView,
      meta: {
        title: "动态调价策略",
        section: "定价与服务",
        permission: "store-rental:price:manage"
      }
    },
    {
      path: "/marketing",
      component: MarketingView,
      meta: {
        title: "营销方案管理",
        section: "营销中心",
        permission: "store-rental:marketing:manage"
      }
    },
    {
      path: "/new-order",
      component: NewOrderView,
      meta: {
        title: "新建门市订单",
        section: "订单中心",
        permission: "store-rental:order:operate"
      }
    },
    {
      path: "/orders",
      component: OrdersView,
      meta: {
        title: "门市租赁订单",
        section: "订单中心",
        permission: "store-rental:order:view"
      }
    },
    {
      path: "/orders/:id",
      component: OrderDetailView,
      meta: {
        title: "门市订单详情",
        section: "订单中心",
        permission: "store-rental:order:view"
      }
    }
  ]
});

const publicPaths = new Set(["/login"]);

function hasStoredPermission(permission?: unknown) {
  if (!permission || typeof permission !== "string") {
    return true;
  }

  const raw = window.localStorage.getItem("rimo_user");
  if (!raw) {
    return false;
  }

  try {
    const user = JSON.parse(raw) as {
      isPlatformAdmin?: boolean;
      permissions?: string[];
    };
    return Boolean(
      user.isPlatformAdmin ||
        user.permissions?.includes("*") ||
        user.permissions?.includes(permission)
    );
  } catch {
    return false;
  }
}

function firstAllowedPath() {
  const raw = window.localStorage.getItem("rimo_user");
  if (!raw) {
    return "/login";
  }

  try {
    const user = JSON.parse(raw) as {
      isPlatformAdmin?: boolean;
      permissions?: string[];
    };
    const permissions = user.permissions ?? [];
    const has = (code: string) =>
      Boolean(
        user.isPlatformAdmin || permissions.includes("*") || permissions.includes(code)
      );

    if (has("store-rental:rules:manage")) {
      return "/rental-rules";
    }
    if (has("store-rental:order:view")) {
      return "/orders";
    }
    if (has("store-rental:order:operate")) {
      return "/new-order";
    }
    if (has("store-rental:station:view")) {
      return "/stations";
    }
    if (has("store-rental:vehicle:view")) {
      return "/vehicles";
    }
    if (has("store-rental:dispatch:manage")) {
      return "/dispatch";
    }
    if (has("store-rental:report:view")) {
      return "/reports";
    }
    if (has("store-rental:member:view")) {
      return "/members";
    }
    if (has("store-rental:corporate:view")) {
      return "/corporates";
    }
    if (has("store-rental:finance:view")) {
      return "/finance";
    }
    if (has("system:user:manage")) {
      return "/users";
    }
    if (has("system:params:manage")) {
      return "/system-rules";
    }
    if (has("system:audit:view")) {
      return "/platform-governance";
    }
    if (has("system:integration:manage")) {
      return "/integrations";
    }
    if (has("system:audit:view")) {
      return "/platform-governance";
    }
  } catch {
    return "/login";
  }

  return "/login";
}

router.beforeEach((to) => {
  const token = window.localStorage.getItem("rimo_access_token");

  if (!publicPaths.has(to.path) && !token) {
    return {
      path: "/login",
      query: {
        redirect: to.fullPath
      }
    };
  }

  if (to.path === "/login" && token) {
    return "/rental-rules";
  }

  if (!hasStoredPermission(to.meta.permission)) {
    const fallback = firstAllowedPath();
    if (fallback === "/login") {
      window.localStorage.removeItem("rimo_access_token");
      window.localStorage.removeItem("rimo_tenant");
      window.localStorage.removeItem("rimo_user");
    }
    return fallback;
  }

  return true;
});
