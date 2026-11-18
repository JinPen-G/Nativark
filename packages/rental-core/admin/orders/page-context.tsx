/** 宿主为 Rental 订单页提供当前会话、原请求与跨领域组件，页面沿这些接点消费真实业务。 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { AuthUser, TenantIdentity } from "@rental-os/platform-contracts";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { RentalItemGroupImage } from "@rental-os/rental-core";
import { createRentalOrderApi, type RentalOrderApi } from "./client";
import type { OrderQuickAction } from "./orderQuickActions";

export interface RentalOrderSession {
  sessionVerified: boolean;
  /** 原宿主凭据是否就绪，仅用于沿用浏览器端准入与失效判断。 */
  authenticated: boolean;
  tenant?: TenantIdentity;
  user?: AuthUser;
  currentWorkspaceId?: string;
  hasPermission: (permission: string) => boolean;
}

export interface RentalOrderCustomerPreviewProps {
  customerId?: string;
  name: string;
  type?: "personal" | "corporate";
  phoneMasked?: string;
  membershipStatus?: string;
  levelName?: string;
  companyName?: string;
  region?: string;
  updatedAt?: string;
  snapshot?: boolean;
  children?: ReactNode;
  presentation?: "inline" | "list";
  secondary?: ReactNode;
}

export type RentalOrderReferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 复用宿主现有原操作引用实现，保留损坏、占用及写入确认的原失败语义。 */
export interface RentalOrderReferenceJournal {
  read<T>(storage: RentalOrderReferenceStorage | undefined, key: string,
    parse: (value: unknown) => T | null): { pending: T | null; blocked: boolean };
  retain(storage: RentalOrderReferenceStorage | undefined, key: string, reference: object): void;
  clear(storage: RentalOrderReferenceStorage | undefined, key: string, reference: object): void;
}

export interface RentalOrderPageContext {
  api: RentalOrderApi;
  runtime: AdminRuntime;
  session: RentalOrderSession;
  /** 每次读取均沿当前已验证的宿主状态，包含 Rental 经营空间与原权限。 */
  getSession: () => RentalOrderSession;
  /** 原委托与换货链使用同一 HTTP 传输，并明确关闭 401 后的请求重放。 */
  requestOriginal: AdminRuntime["request"];
  references: RentalOrderReferenceJournal;
  components: {
    CustomerPreview: ComponentType<RentalOrderCustomerPreviewProps>;
    ItemGroupPhoto: ComponentType<{ groupId: string; image: RentalItemGroupImage; size?: number;
      presentation?: "card"; alt?: string }>;
    OrderFactsEntry: ComponentType<{ orderId: string }>;
  };
  navigation: {
    openOrder: (orderId: string, action?: OrderQuickAction) => void;
    createOrder: () => void;
    openWorkOrders: () => void;
  };
}

/** 原委托、检查与批准 hook 只依赖会话和单次传输，独立消费者无需提供页面导航。 */
export type RentalOrderOperationContext = Pick<RentalOrderPageContext, "session" | "runtime" | "getSession" | "requestOriginal">;

const Context = createContext<RentalOrderPageContext | null>(null);

export function RentalOrderPageContextProvider({ context, children }: {
  context: RentalOrderPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalOrderContext(): RentalOrderPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("Rental 订单页须绑定当前宿主接点");
  return context;
}

/** 将旧回调固定到打开页面时的实际身份，异步办理的下一步仍须属于同一范围。 */
export function createRentalOrderPageContext(dependencies: Omit<RentalOrderPageContext, "api">): RentalOrderPageContext {
  const { runtime, session, getSession } = dependencies;
  const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
  const assertCurrent = () => {
    const current = getSession();
    if (!current.sessionVerified || !current.authenticated
      || rentalOrderSessionIdentity(current, runtime.currentSessionEpoch()) !== identity)
      throw new DOMException("订单页面的会话或业务范围已变化", "AbortError");
  };
  const bindRequest = (request: AdminRuntime["request"]): AdminRuntime["request"] => async <Output,>(
    path: string, options?: AdminRequestOptions
  ): Promise<Output> => {
    assertCurrent();
    const result = await request<Output>(path, options);
    assertCurrent();
    return result;
  };
  return { ...dependencies, api: createRentalOrderApi(bindRequest(runtime.request)),
    requestOriginal: bindRequest(dependencies.requestOriginal) };
}

export function rentalOrderSessionScope(session: RentalOrderSession): string {
  return session.sessionVerified && session.tenant?.tenantId && session.currentWorkspaceId && session.user?.id
    ? JSON.stringify([session.tenant.tenantId, session.currentWorkspaceId, session.user.id]) : "";
}

/** 与原商户操作身份键保持同一字段顺序，历史引用继续使用原租户、空间和用户键。 */
export function rentalOrderSessionIdentity(session: RentalOrderSession, epoch: number): string {
  const user = session.user;
  return JSON.stringify([epoch, session.sessionVerified, session.authenticated, session.tenant?.tenantId,
    session.currentWorkspaceId, user?.id, user?.tenantId, user?.scope, user?.dataScope, user?.organizationId,
    user?.locationScope, user?.isPlatformAdmin, user?.isSaasAdmin, user?.permissions, user?.tenantMembership]);
}
