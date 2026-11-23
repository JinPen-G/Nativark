/** 原 Agent/Copilot 页面身份映射到当前宿主登记，公共页面由公共宿主端口定位。
 * 导航只复核当前会话、原权限与 Core 使用目录，不创建客户端或授予业务权限。 */
import { matchRoutes } from "react-router-dom";
import { corePageKey, type CoreRegisteredPage } from "@rental-os/core-contracts";
import { useCoreSession, type CoreRouteComponent } from "@rental-os/platform-admin/core";
import { rentalLegacyPagePolicy, type RentalPageId } from "@rental-os/rental-core/permissions";
import type { RentalBrowserAdminSession } from "./browser";
import { createRentalNavigation } from "./browser-navigation";
import type { RentalAssistantNavigation, RentalAssistantRoute } from "./assistant";

interface OriginalRoute extends RentalAssistantRoute {
  audience: "tenant" | "saas";
  scope?: "tenant-membership" | "tenant-management";
  legacyPermissions?: readonly string[];
}

/** 保留原 APP_ROUTES 的标识、路径和显示信息；登记缺失时保留身份但拒绝访问。 */
export const RENTAL_ASSISTANT_ROUTES: Readonly<Record<string, OriginalRoute>> = Object.freeze({
  aiOperator: Object.freeze({"path":"/ai-operator","label":"Agent工作台","permission":"rental-os:report:view","legacyPermissions":["rental-os:order:view","rental-core:catalog:view","rental-core:asset:view","rental-core:maintenance:view","rental-os:member:view","system:integration:manage"],"audience":"tenant"}),
  workbench: Object.freeze({"path":"/workbench","label":"运营概览","permission":"rental-os:report:view","legacyPermissions":["rental-os:order:view","rental-core:maintenance:view"],"audience":"tenant","menu":true}),
  notifications: Object.freeze({"path":"/notifications","label":"消息中心","permission":"","audience":"tenant","menu":true}),
  operationReport: Object.freeze({"path":"/reports/operations","label":"经营报表","permission":"rental-os:report:view","audience":"tenant","menu":true}),
  orderCreate: Object.freeze({"path":"/rental/orders/new","label":"新建订单","permission":"rental-os:order:create","audience":"tenant"}),
  orders: Object.freeze({"path":"/rental/orders","label":"订单管理","permission":"rental-os:order:view","audience":"tenant","menu":true}),
  orderDetail: Object.freeze({"path":"/rental/orders/:id","label":"订单详情","permission":"rental-os:order:view","audience":"tenant"}),
  itemGroups: Object.freeze({"path":"/rental/item-groups","label":"商品目录","permission":"rental-core:catalog:view","audience":"tenant","menu":true}),
  pricingGroups: Object.freeze({"path":"/rental/pricing-groups","label":"定价分组","permission":"rental-os:price:manage","audience":"tenant","menu":true}),
  assets: Object.freeze({"path":"/rental/assets","label":"资产与库存","permission":"rental-core:asset:view","audience":"tenant","menu":true}),
  workOrders: Object.freeze({"path":"/rental/work-orders","label":"养护工单","permission":"rental-core:maintenance:view","audience":"tenant","menu":true}),
  workOrderDetail: Object.freeze({"path":"/rental/work-orders/:workOrderId","label":"养护工单详情","permission":"rental-core:maintenance:view","audience":"tenant"}),
  locations: Object.freeze({"path":"/rental/locations","label":"履约地点","permission":"rental-os:station:view","audience":"tenant","menu":true}),
  pricing: Object.freeze({"path":"/rental/pricing","label":"价格版本与调价","permission":"rental-os:price:manage","audience":"tenant","menu":true}),
  pricingVersions: Object.freeze({"path":"/rental/pricing/versions","label":"空间价格版本","permission":"rental-os:price:manage","audience":"tenant"}),
  pricingVersionDetail: Object.freeze({"path":"/rental/pricing/versions/:sequence","label":"价格版本详情","permission":"rental-os:price:manage","audience":"tenant"}),
  discounts: Object.freeze({"path":"/rental/discounts","label":"优惠方案","permission":"rental-os:price:manage","audience":"tenant","menu":true}),
  coupons: Object.freeze({"path":"/rental/coupons","label":"优惠券","permission":"rental-os:price:manage","audience":"tenant","menu":true}),
  services: Object.freeze({"path":"/rental/services","label":"增值服务","permission":"rental-os:price:manage","audience":"tenant","menu":true}),
  rentalSettings: Object.freeze({"path":"/rental/settings","label":"品类与业务规则","permission":"rental-os:price:manage","legacyPermissions":["rental-os:calendar:edit","rental-os:calendar:publish","rental-os:calendar:view-history","rental-os:rules:manage","rental-os:rules:publish","system:integration:manage"],"audience":"tenant","menu":true}),
  rentalCapabilities: Object.freeze({"path":"/rental/capabilities","label":"经营空间能力","permission":"rental-core:capability:view","legacyPermissions":["rental-core:capability:manage"],"audience":"tenant","menu":true}),
  membershipReviews: Object.freeze({"scope":"tenant-membership","path":"/membership/reviews","label":"会员审核","permission":"rental-os:member:view","legacyPermissions":["rental-os:member:review","rental-os:member:qualification-review"],"audience":"tenant","menu":true}),
  personalMembers: Object.freeze({"scope":"tenant-membership","path":"/membership/personal","label":"个人会员","permission":"rental-os:member:view","legacyPermissions":["rental-os:member:manage"],"audience":"tenant","menu":true}),
  personalMemberDetail: Object.freeze({"scope":"tenant-membership","path":"/membership/personal/:customerId","label":"个人会员资料","permission":"rental-os:member:view","legacyPermissions":["rental-os:member:manage"],"audience":"tenant"}),
  corporateMembers: Object.freeze({"scope":"tenant-membership","path":"/membership/corporate","label":"企业会员","permission":"rental-os:corporate:view","legacyPermissions":["rental-os:corporate:manage","rental-os:corporate:employee-manage"],"audience":"tenant","menu":true}),
  corporateMemberDetail: Object.freeze({"scope":"tenant-membership","path":"/membership/corporate/:customerId","label":"企业资料","permission":"rental-os:corporate:view","legacyPermissions":["rental-os:corporate:manage","rental-os:corporate:employee-manage"],"audience":"tenant"}),
  membershipPlans: Object.freeze({"scope":"tenant-membership","path":"/membership/plans","label":"会员方案","permission":"rental-os:member:view","legacyPermissions":["rental-os:member:plan:manage","rental-os:member:plan:publish"],"audience":"tenant","menu":true}),
  membershipRewards: Object.freeze({"path":"/membership/rewards","label":"会员激励","permission":"rental-os:price:manage","legacyPermissions":["rental-os:rules:manage","system:params:manage"],"audience":"tenant","menu":true}),
  qualificationTypes: Object.freeze({"path":"/rental/qualification-types","label":"空间证件类型","permission":"rental-os:qualification-type:manage","legacyPermissions":["rental-os:member:manage","rental-os:member:view"],"audience":"tenant","menu":true}),
  tenantReadiness: Object.freeze({"path":"/tenant/readiness","label":"开业配置","permission":"rental-os:order:view","legacyPermissions":["rental-os:price:manage","system:user:manage","system:role:manage"],"audience":"tenant","menu":true}),
  tenantAccounts: Object.freeze({"path":"/tenant/accounts","label":"运营账号","permission":"system:user:manage","audience":"tenant","menu":true}),
  tenantRoles: Object.freeze({"path":"/tenant/roles","label":"角色权限","permission":"system:role:manage","audience":"tenant","menu":true}),
  tenantIntegrations: Object.freeze({"path":"/tenant/integrations","label":"第三方服务","permission":"system:integration:manage","audience":"tenant","menu":true}),
  tenantDispatch: Object.freeze({"scope":"tenant-management","path":"/tenant/dispatch","label":"寄件中心","permission":"system:integration:manage","audience":"tenant","menu":true}),
  customerSupport: Object.freeze({"scope":"tenant-management","path":"/tenant/support","label":"客服中心","permission":"system:integration:manage","audience":"tenant","menu":true}),
  clientChannel: Object.freeze({"path":"/tenant/client-channel","label":"客户端渠道","permission":"system:integration:manage","audience":"tenant","menu":true}),
  appearance: Object.freeze({"path":"/settings/appearance","label":"外观与音效","permission":"system:integration:manage","audience":"tenant","menu":true}),
  aiSettings: Object.freeze({"path":"/settings/ai","label":"AI 服务设置","permission":"system:params:manage","audience":"tenant","menu":true}),
  clientAuthorization: Object.freeze({"path":"/settings/client-authorization","label":"客户端授权","permission":"system:params:manage","audience":"tenant","menu":true}),
  aiTasks: Object.freeze({"path":"/ai/tasks","label":"AI 任务中心","permission":"rental-os:order:view","legacyPermissions":["rental-os:order:create","rental-os:price:manage","system:params:manage","system:integration:manage","rental-os:finance:view","rental-os:finance:reconcile"],"audience":"tenant","menu":true}),
  paymentReconciliation: Object.freeze({"path":"/rental/payment-reconciliation","label":"支付对账","permission":"rental-os:finance:reconcile","audience":"tenant","menu":true}),
  paymentReconciliationDetail: Object.freeze({"path":"/rental/payment-reconciliation/:batchId","label":"对账批次详情","permission":"rental-os:finance:reconcile","audience":"tenant"}),
  platformTenants: Object.freeze({"path":"/platform/tenants","label":"SaaS 租户","permission":"system:tenant:manage","audience":"saas","menu":true}),
  platformCategories: Object.freeze({"path":"/platform/rental-categories","label":"租赁品类","permission":"system:rental-category:view","audience":"saas","menu":false}),
  platformCategoryCapabilities: Object.freeze({"path":"/platform/rental-category-capabilities","label":"内核能力目录","permission":"system:rental-category:view","audience":"saas","menu":false}),
  platformDemoRequests: Object.freeze({"path":"/platform/demo-requests","label":"演示预约","permission":"system:demo-request:view","audience":"saas","menu":true}),
  platformUsers: Object.freeze({"path":"/platform/users","label":"组织与权限","permission":"system:user:manage","audience":"saas","menu":true}),
  platformSystem: Object.freeze({"path":"/platform/system","label":"平台参数","permission":"system:params:manage","audience":"saas","menu":true}),
  platformAi: Object.freeze({"path":"/platform/ai","label":"平台 AI 配置","permission":"system:ai-provider:view","audience":"saas","menu":true}),
  platformOperations: Object.freeze({"path":"/platform/operations","label":"平台运维","permission":"system:params:manage","audience":"saas","menu":true}),
  platformTools: Object.freeze({"path":"/platform/tools","label":"平台工具与治理","permission":"system:params:manage","audience":"saas","menu":true}),
  platformOfficialCalendars: Object.freeze({"path":"/platform/official-calendars","label":"公共官方日历","permission":"system:calendar-source:manage","audience":"saas","menu":true}),
  subscription: Object.freeze({"path":"/settings/subscription","label":"版本与订阅","permission":"rental-os:subscription:view","audience":"tenant","menu":true}),
  subscriptionPro: Object.freeze({"path":"/settings/subscription/pro","label":"版本对比","permission":"rental-os:subscription:view","audience":"tenant"}),
  subscriptionRequestDetail: Object.freeze({"path":"/settings/subscription/requests/:id","label":"申请详情","permission":"rental-os:subscription:view","audience":"tenant"}),
  platformSubscriptions: Object.freeze({"path":"/platform/subscriptions","label":"租户订阅","permission":"system:tenant:subscription:manage","audience":"saas","menu":true}),
  platformSubscriptionDetail: Object.freeze({"path":"/platform/subscriptions/:id","label":"租户订阅详情","permission":"system:tenant:subscription:manage","audience":"saas"}),
  subscriptionCatalog: Object.freeze({"path":"/platform/subscription-catalog","label":"功能目录与定价","permission":"system:tenant:subscription:manage","audience":"saas","menu":true}),
});

const corePageIds: Readonly<Record<string, RentalPageId | "notifications">> = {
  aiOperator: "ai-operator", aiSettings: "ai-settings", aiTasks: "ai-tasks", notifications: "notifications",
  workbench: "workbench", operationReport: "operation-report", orderCreate: "order-create",
  orders: "orders", orderDetail: "order-detail", itemGroups: "item-groups", pricingGroups: "pricing-groups",
  assets: "assets", workOrders: "work-orders", workOrderDetail: "work-order-detail", locations: "locations",
  pricing: "pricing", pricingVersions: "pricing-versions", pricingVersionDetail: "pricing-version-detail",
  discounts: "discounts", coupons: "coupons", services: "services", rentalSettings: "governance",
  rentalCapabilities: "capabilities", membershipReviews: "membership-reviews", personalMembers: "personal-members",
  personalMemberDetail: "personal-member-detail", corporateMembers: "corporate-members",
  corporateMemberDetail: "corporate-member-detail", membershipPlans: "membership-plans",
  membershipRewards: "membership-rewards", qualificationTypes: "qualification-types", tenantReadiness: "tenant-readiness",
  clientChannel: "client-channel", paymentReconciliation: "payment-reconciliation",
  paymentReconciliationDetail: "payment-reconciliation-detail",
};
const assistantEntryIds = ["workbench", "orders", "locations", "assets", "personalMembers", "pricingGroups",
  "paymentReconciliation", "rentalSettings", "operationReport"];
const originalRoutes = Object.entries(RENTAL_ASSISTANT_ROUTES).map(([id, route]) => ({ path: route.path, handle: id }));

export interface RentalAssistantNavigationOptions {
  /** 由公共应用明确供给其真实登记与当前权限；缺省不开放公共页面，更不制造 Rental 登记。 */
  publicNavigation?: Pick<RentalAssistantNavigation, "canAccess" | "resolve" | "originalPath">;
}

function localLocation(href: string): URL | undefined {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//") || href.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(href)) return;
  try {
    const url = new URL(href, "https://rental.invalid");
    if (url.origin !== "https://rental.invalid" || /[\u0000-\u001f\u007f]/.test(decodeURIComponent(url.pathname))) return;
    return url;
  } catch { return; }
}

/** 在同一公共 Runtime/QueryClient 内使用；工厂可先创建，登记表须在组件挂载前填妥。 */
export function createRentalAssistantNavigation(
  pages: ReadonlyMap<string, CoreRegisteredPage<CoreRouteComponent>>,
  session: RentalBrowserAdminSession,
  { publicNavigation }: RentalAssistantNavigationOptions = {},
): () => RentalAssistantNavigation {
  return function useRentalAssistantNavigation(): RentalAssistantNavigation {
    const auth = session.useAuthStore(), cores = useCoreSession();
    const epoch = session.currentSessionEpoch();
    const identity = (state: typeof auth) => JSON.stringify([
      state.sessionVerified, Boolean(state.token), state.tenant, state.user, state.currentWorkspaceId,
    ]);
    const originalIdentity = identity(auth);
    const registered = new Map(pages);
    const navigation = createRentalNavigation(pages, session);
    const currentRoutes = [...registered.values()].filter(page => page.coreId === "rental")
      .map(page => ({ path: page.path, handle: page.definition.id }));
    const currentAuth = () => {
      const current = session.useAuthStore.getState();
      return current.sessionVerified && current.token && current.tenant?.tenantId && current.user?.id
        && session.currentSessionEpoch() === epoch && identity(current) === originalIdentity ? current : undefined;
    };

    function canAccessId(id: string): boolean {
      const current = currentAuth(), route = RENTAL_ASSISTANT_ROUTES[id];
      if (!current || !route || (route.audience === "saas") !== Boolean(current.user?.isSaasAdmin)) return false;
      const pageId = corePageIds[id];
      if (!pageId) return Boolean(publicNavigation?.canAccess(route));
      const key = corePageKey("rental", pageId), page = pages.get(key);
      if (!page || page !== registered.get(key) || !cores.canAccess("rental", page.definition.permissions)) return false;
      // 原 Agent 入口允许租户会员范围，无需捏造经营空间；每个候选仍核自己的当前登记与范围。
      if (pageId === "ai-operator") return assistantEntryIds.some(canAccessId);
      if (!navigation.canAccessPage(pageId, current)) return false;
      if (pageId === "notifications") return true;
      const policy = rentalLegacyPagePolicy(pageId);
      const hasPermission = policy.scope === "tenant-membership" ? current.hasTenantMembershipPermission : current.hasPermission;
      return policy.permissions.some(permission => hasPermission(permission));
    }

    function currentPage(href: string) {
      const target = navigation.resolvePageHref(href);
      if (!target) return;
      const url = localLocation(target);
      if (!url) return;
      const matched = matchRoutes(currentRoutes, url.pathname)?.at(-1);
      if (!matched) return;
      const id = Object.keys(corePageIds).find(key => corePageIds[key] === matched.route.handle);
      return id ? { id, matched, target } : undefined;
    }

    function publicPage(pathname: string) {
      const original = publicNavigation?.originalPath(pathname);
      const url = original && localLocation(original);
      if (!url) return;
      const matched = matchRoutes(originalRoutes, url.pathname)?.at(-1);
      const id = matched?.route.handle;
      return id && !corePageIds[id] ? { id, pathname: url.pathname } : undefined;
    }

    return {
      routes: RENTAL_ASSISTANT_ROUTES,
      canAccess(route) {
        const id = Object.keys(RENTAL_ASSISTANT_ROUTES).find(key => RENTAL_ASSISTANT_ROUTES[key].path === route?.path);
        // 调用者只能引用登记身份，不能改 permission/label 后自授权。
        return Boolean(id && canAccessId(id));
      },
      resolve(href) {
        const url = localLocation(href);
        if (!url || !currentAuth()) return null;
        const business = currentPage(href);
        if (business) return canAccessId(business.id) ? business.target : null;
        const original = matchRoutes(originalRoutes, url.pathname)?.at(-1)?.route.handle;
        const id = original && !corePageIds[original] ? original : publicPage(url.pathname)?.id;
        if (!id || !canAccessId(id)) return null;
        const target = publicNavigation?.resolve(href);
        const location = target && localLocation(target);
        // 公共宿主须能反向确认同一真实页面，不能借公共端口跳入另一 Core 或任意 URL。
        return location && publicPage(location.pathname)?.id === id ? target! : null;
      },
      originalPath(pathname) {
        const url = localLocation(pathname);
        if (!url || !currentAuth()) return null;
        const business = currentPage(url.pathname);
        if (business) {
          if (!canAccessId(business.id)) return null;
          return RENTAL_ASSISTANT_ROUTES[business.id].path.replace(/:([a-z][a-zA-Z0-9]*)/g, (_match, key: string) =>
            encodeURIComponent(business.matched.params[key]!));
        }
        const entry = publicPage(url.pathname);
        return entry && canAccessId(entry.id) ? entry.pathname : null;
      },
    };
  };
}
