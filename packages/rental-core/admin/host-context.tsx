/** 统一供给 Rental 后台各组上下文，复用公共 Runtime、原请求及各组范围复验。
 * 已验证的业务会话、范围与权限投影由实际宿主提供。页面导航消费当前登记路由。
 * 会话、QueryClient、凭据、业务裁定与 AI 执行沿所属宿主和服务保持唯一来源。 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  corePageKey,
  resolveCorePageLocation,
  type CorePageLocation,
} from "@rental-os/core-contracts";
import { useCorePageHost } from "@rental-os/platform-admin/core";
import {
  clearSettingsReference,
  readSettingsReference,
  retainSettingsReference,
} from "@rental-os/platform-admin/forms";
import {
  AdminRuntimeProvider,
  type AdminRequestOptions,
  type AdminRuntime,
} from "@rental-os/platform-admin/runtime";
import type { RentalAdminContexts } from "./index";
import {
  createRentalOrderPageContext,
  rentalOrderSessionIdentity,
  type RentalOrderPageContext,
  type RentalOrderReferenceJournal,
} from "./orders/page-context";
import { rentalOrderCreateLocation, rentalOrderLocation } from "./orders/pages";
import type { OrderQuickAction } from "./orders/orderQuickActions";
import { createRentalWorkOrderApi } from "./work-orders/client";
import type { RentalWorkOrderPageContext } from "./work-orders/page-context";
import { rentalWorkOrderLocation } from "./work-orders/pages";
import {
  createRentalCapabilityPageContext,
  type RentalCapabilityPageContext,
} from "./capabilities/page-context";
import {
  createRentalLocationPageContext,
  type RentalLocationPageContext,
} from "./locations/page-context";
import {
  createRentalCatalogPageContext,
  RentalCatalogPageProvider,
  type RentalCatalogPageContext,
} from "./catalog/page-context";
import type { RentalCatalogImageRequest } from "./catalog/client";
import { ItemGroupPhoto } from "./catalog/ItemGroupPhoto";
import {
  createRentalCommercialPageContext,
  type RentalCommercialPageContext,
} from "./commercial/page-context";
import {
  createRentalGovernancePageContext,
  type RentalGovernancePageContext,
} from "./governance/page-context";
import {
  createRentalMembershipPageContext,
  type RentalMembershipPageContext,
  type RentalMembershipSession,
} from "./membership/page-context";
import {
  createRentalOperationsPageContext,
  type RentalOperationsPageContext,
} from "./operations/page-context";
import type { RentalOperationsTextRequest } from "./operations/client";
import {
  createRentalChannelsPageContext,
  type RentalChannelsPageContext,
} from "./channels/page-context";
import {
  createRentalSetupPageContext,
  type RentalSetupPageContext,
} from "./setup/page-context";
import {
  createRentalPaymentReconciliationPageContext,
  type RentalPaymentReconciliationPageContext,
} from "./payment-reconciliation/page-context";

export interface RentalAdminHostState {
  session: RentalMembershipSession;
  /** 宿主原经营空间身份键，包含会话代次和受权范围。缺经营空间时可以缺失。 */
  scopeKey?: string;
  /** 复用宿主原列表身份，租户级会员及渠道也须有独立的当前查询范围。 */
  queryScope: string;
  workOrderPermissions: RentalWorkOrderPageContext["permissions"];
  categoryGovernancePreviewEnabled: boolean;
  governanceNavigationTarget?: RentalGovernancePageContext["navigationTarget"];
}

export interface RentalAdminHostOptions {
  runtime: AdminRuntime;
  /** 同一已验证宿主的当前投影。变化时通知 runtime.subscribe，可每次返回新对象。 */
  getState: () => RentalAdminHostState;
  requestImage: RentalCatalogImageRequest;
  requestText: RentalOperationsTextRequest;
  refreshSession: RentalCapabilityPageContext["refreshSession"];
  CustomerPreview: RentalOrderPageContext["components"]["CustomerPreview"];
  canViewOrganizations: RentalLocationPageContext["canViewOrganizations"];
  canManageOrganizationMapping: RentalLocationPageContext["canManageOrganizationMapping"];
  channels: Pick<RentalChannelsPageContext, "assetOrigin" | "loginDefaults" | "setTenantBranding">;
  OrderFactsEntry?: RentalOrderPageContext["components"]["OrderFactsEntry"];
  membership?: Pick<Parameters<typeof createRentalMembershipPageContext>[0],
    "files" | "components" | "managementText">;
  governance?: Pick<Parameters<typeof createRentalGovernancePageContext>[0],
    "components" | "ruleText" | "calendarText">;
  accounts?: RentalSetupPageContext["accounts"];
}

export interface RentalAdminHost {
  Provider: ComponentType<{ children: ReactNode }>;
  contexts: RentalAdminContexts;
}

interface RentalAdminHostValue {
  order: Omit<RentalOrderPageContext, "api" | "navigation">;
  workOrder: Omit<RentalWorkOrderPageContext, "openOrder">;
  capability: RentalCapabilityPageContext;
  location: RentalLocationPageContext;
  catalog: RentalCatalogPageContext;
  commercial: RentalCommercialPageContext;
  governance: RentalGovernancePageContext;
  membership: RentalMembershipPageContext;
  operations: RentalOperationsPageContext;
  channels: RentalChannelsPageContext;
  setup: RentalSetupPageContext;
  paymentReconciliation: RentalPaymentReconciliationPageContext;
}

const references: RentalOrderReferenceJournal = {
  read: readSettingsReference,
  retain: retainSettingsReference,
  clear: clearSettingsReference,
};

/** 未装配 AI 展示时保留普通订单页面。 */
function OptionalOrderFactsEntry() {
  return null;
}

/** 在受控宿主装配时调用一次，返回可直接交给统一页面贡献的钩子与 Provider。 */
export function createRentalAdminHost(options: RentalAdminHostOptions): RentalAdminHost {
  const { runtime } = options;
  const required = {
    getState: options.getState,
    getSession: runtime?.getSession,
    subscribe: runtime?.subscribe,
    currentSessionEpoch: runtime?.currentSessionEpoch,
    currentSessionSignal: runtime?.currentSessionSignal,
    request: runtime?.request,
    requestImage: options.requestImage,
    requestText: options.requestText,
    refreshSession: options.refreshSession,
    canViewOrganizations: options.canViewOrganizations,
    canManageOrganizationMapping: options.canManageOrganizationMapping,
    setTenantBranding: options.channels?.setTenantBranding,
  };
  for (const [name, port] of Object.entries(required)) {
    if (typeof port !== "function") throw new Error(`Rental 后台宿主缺少 ${name} 接点`);
  }
  if (!options.CustomerPreview || !options.channels.loginDefaults) {
    throw new Error("Rental 后台宿主需要客户预览和登录品牌默认文案");
  }

  const Context = createContext<RentalAdminHostValue | null>(null);
  // 两份投影必须来自同一当前会话，旧 Rental 投影不能继续使用新的公共身份。
  const readSession = (state: RentalAdminHostState): RentalMembershipSession => {
    const session = state.session;
    const platform = runtime.getSession();
    const epoch = runtime.currentSessionEpoch();
    const identity = rentalOrderSessionIdentity(session, epoch);
    const platformIdentity = rentalOrderSessionIdentity({
      ...session,
      sessionVerified: platform.sessionVerified,
      tenant: platform.tenant,
      user: platform.user,
    }, epoch);
    return identity === platformIdentity ? session : { ...session, sessionVerified: false };
  };
  // 只订阅稳定值，业务投影每次新建对象时也不会造成 React snapshot 循环。
  const getRentalSnapshot = () => {
    const state = options.getState();
    return JSON.stringify([
      rentalOrderSessionIdentity(readSession(state), runtime.currentSessionEpoch()),
      state.scopeKey,
      state.queryScope,
      state.workOrderPermissions.manage,
      state.workOrderPermissions.review,
      state.workOrderPermissions.viewOrders,
      state.workOrderPermissions.restore,
      state.categoryGovernancePreviewEnabled,
      state.governanceNavigationTarget?.key,
      state.governanceNavigationTarget?.tab,
    ]);
  };
  const requestOriginal: AdminRuntime["request"] = <Output,>(
    path: string,
    requestOptions?: AdminRequestOptions,
  ) => runtime.request<Output>(path, { ...requestOptions, retryAuthentication: false });
  const components: RentalOrderPageContext["components"] = {
    CustomerPreview: options.CustomerPreview,
    ItemGroupPhoto,
    OrderFactsEntry: options.OrderFactsEntry ?? OptionalOrderFactsEntry,
  };

  function Provider({ children }: { children: ReactNode }) {
    const platform = useSyncExternalStore(runtime.subscribe, runtime.getSession, runtime.getSession);
    const snapshot = useSyncExternalStore(runtime.subscribe, getRentalSnapshot, getRentalSnapshot);
    const value = useMemo<RentalAdminHostValue>(() => {
      const state = options.getState();
      const session = readSession(state);
      const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
      const getTenantSession = () => {
        const current = options.getState();
        const currentSession = readSession(current);
        return state.queryScope && current.queryScope === state.queryScope
          ? currentSession : { ...currentSession, sessionVerified: false };
      };
      const currentScopeKey = () => {
        const current = options.getState();
        const currentSession = readSession(current);
        if (!state.queryScope || current.queryScope !== state.queryScope
          || !currentSession.sessionVerified || !currentSession.authenticated
          || !currentSession.tenant?.tenantId || !currentSession.user?.id
          || !currentSession.currentWorkspaceId || currentSession.user.isSaasAdmin
          || identity !== rentalOrderSessionIdentity(currentSession, runtime.currentSessionEpoch())) {
          return undefined;
        }
        return current.scopeKey;
      };
      const scopeKey = currentScopeKey() ?? "";
      const getWorkspaceSession = () => {
        const currentSession = getTenantSession();
        return scopeKey && currentScopeKey() === scopeKey
          ? currentSession : { ...currentSession, sessionVerified: false };
      };
      const workspaceSession = getWorkspaceSession();
      const workspace = { runtime, scopeKey, currentScopeKey };
      const scopedRequest: AdminRuntime["request"] = async <Output,>(
        path: string,
        requestOptions?: AdminRequestOptions,
      ): Promise<Output> => {
        const assertCurrent = () => {
          if (!scopeKey || currentScopeKey() !== scopeKey) {
            throw new DOMException("工单页面的会话或经营范围已变化", "AbortError");
          }
        };
        assertCurrent();
        const result = await runtime.request<Output>(path, requestOptions);
        assertCurrent();
        return result;
      };
      const catalog = createRentalCatalogPageContext({ ...workspace, requestImage: options.requestImage });
      const tenant = { runtime, session, getSession: getTenantSession, queryScope: state.queryScope };
      const business = { ...tenant, session: workspaceSession, getSession: getWorkspaceSession };
      return {
        order: {
          runtime,
          session: workspaceSession,
          getSession: getWorkspaceSession,
          requestOriginal,
          references,
          components,
        },
        workOrder: {
          api: createRentalWorkOrderApi(scopedRequest),
          scopeKey,
          currentScopeKey,
          permissions: state.workOrderPermissions,
        },
        capability: createRentalCapabilityPageContext({ ...workspace, refreshSession: options.refreshSession }),
        location: createRentalLocationPageContext({
          ...workspace,
          canViewOrganizations: options.canViewOrganizations,
          canManageOrganizationMapping: options.canManageOrganizationMapping,
        }),
        catalog,
        commercial: createRentalCommercialPageContext({ ...workspace, requestImage: options.requestImage }),
        governance: createRentalGovernancePageContext({
          ...business,
          ...workspace,
          ...options.governance,
          refreshSession: async () => { await options.refreshSession(); },
          categoryGovernancePreviewEnabled: state.categoryGovernancePreviewEnabled,
          navigationTarget: state.governanceNavigationTarget,
        }),
        membership: createRentalMembershipPageContext({ ...tenant, ...options.membership }),
        operations: createRentalOperationsPageContext({
          ...business,
          requestText: options.requestText,
          components: { CustomerPreview: options.CustomerPreview },
        }),
        channels: createRentalChannelsPageContext({ ...tenant, ...options.channels }),
        setup: createRentalSetupPageContext({ ...business, accounts: options.accounts }),
        paymentReconciliation: createRentalPaymentReconciliationPageContext(business),
      };
    }, [platform, snapshot]);
    // 订单与列表中的照片也消费同一商品图片供给器。
    return <AdminRuntimeProvider runtime={runtime}>
      <Context.Provider value={value}>
        <RentalCatalogPageProvider context={value.catalog}>{children}</RentalCatalogPageProvider>
      </Context.Provider>
    </AdminRuntimeProvider>;
  }

  function useHostContext() {
    const context = useContext(Context);
    if (!context) throw new Error("Rental 页面须位于当前 Rental 后台宿主 Provider 内");
    return context;
  }

  function useRegisteredNavigation(context: RentalAdminHostValue) {
    const host = useCorePageHost();
    const active = useRef(true);
    useLayoutEffect(() => {
      active.current = true;
      return () => { active.current = false; };
    }, []);
    return useMemo(() => (location: CorePageLocation, action?: OrderQuickAction) => {
      const scope = context.catalog;
      if (!active.current || !scope.scopeKey || scope.currentScopeKey() !== scope.scopeKey) {
        throw new DOMException("Rental 页面或经营范围已变化", "AbortError");
      }
      const target = host.pages.get(corePageKey(location.coreId, location.pageId));
      if (!target || !host.canAccess(host.page.coreId, host.page.definition.permissions)
        || !host.canAccess(target.coreId, target.definition.permissions)) {
        throw new Error("当前 Rental 页面目标不可用");
      }
      const path = resolveCorePageLocation(host.pages, location);
      host.navigate(action ? `${path}?action=${encodeURIComponent(action)}` : path);
    }, [context, host]);
  }

  function useOrderContext(): RentalOrderPageContext {
    const context = useHostContext();
    const navigate = useRegisteredNavigation(context);
    return useMemo(() => createRentalOrderPageContext({
      ...context.order,
      navigation: {
        openOrder: (orderId, action) => navigate(rentalOrderLocation(orderId), action),
        createOrder: () => navigate(rentalOrderCreateLocation()),
        openWorkOrders: () => navigate(rentalWorkOrderLocation()),
      },
    }), [context, navigate]);
  }

  function useWorkOrderContext(): RentalWorkOrderPageContext {
    const context = useHostContext();
    const navigate = useRegisteredNavigation(context);
    return useMemo(() => ({
      ...context.workOrder,
      openOrder: (orderId: string) => navigate(rentalOrderLocation(orderId)),
    }), [context, navigate]);
  }

  return {
    Provider,
    contexts: {
      useOrderContext,
      useWorkOrderContext,
      useCapabilityContext: () => useHostContext().capability,
      useLocationContext: () => useHostContext().location,
      useCatalogContext: () => useHostContext().catalog,
      useCommercialContext: () => useHostContext().commercial,
      useGovernanceContext: () => useHostContext().governance,
      useMembershipContext: () => useHostContext().membership,
      useOperationsContext: () => useHostContext().operations,
      useChannelsContext: () => useHostContext().channels,
      useSetupContext: () => useHostContext().setup,
      usePaymentReconciliationContext: () => useHostContext().paymentReconciliation,
    },
  };
}
