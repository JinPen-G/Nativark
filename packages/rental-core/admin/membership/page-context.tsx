/** 会员页消费宿主当前会话、原请求和可选 AI 展示，租户会员与经营空间权限分别核定。 */
import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  AdminRequestOptions,
  AdminRuntime,
} from "@rental-os/platform-admin/runtime";
import { useLocale } from "@rental-os/platform-admin/locale";
import {
  rentalOrderSessionIdentity,
  type RentalOrderSession,
} from "../orders/page-context";
import { createRentalMembershipApi, type RentalMembershipApi } from "./client";
import {
  createRentalCustomerApi,
  type RentalCustomerApi,
} from "./customer-client";
import {
  createRentalMembershipRewardsApi,
  type RentalMembershipRewardsApi,
} from "./rewards-client";

export interface RentalMembershipSession extends RentalOrderSession {
  hasTenantMembershipPermission: (permission: string) => boolean;
}
export interface RentalMembershipFiles {
  avatar: (customerId: string, signal?: AbortSignal) => Promise<Blob>;
  application: (
    applicationId: string,
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<Blob>;
  management: (
    requestId: string,
    fileId: string,
    signal?: AbortSignal,
  ) => Promise<Blob>;
}
export interface RentalMembershipComponents {
  MemberNameFlow?: ComponentType<{
    identity: string;
    customerId?: string;
    current: () => boolean;
    onAccessDenied: () => void;
  }>;
  NotificationDraftFlow?: ComponentType<{
    customerId: string;
    current: () => boolean;
    visible?: boolean;
  }>;
}
export interface RentalMembershipPageContext {
  api: RentalMembershipApi;
  customerApi: RentalCustomerApi;
  rewardsApi: RentalMembershipRewardsApi;
  runtime: AdminRuntime;
  session: RentalMembershipSession;
  getSession: () => RentalMembershipSession;
  request: AdminRuntime["request"];
  requestOriginal: AdminRuntime["request"];
  queryScope: string;
  files: RentalMembershipFiles;
  components: RentalMembershipComponents;
  managementText?: (text: string) => string;
}
export type RentalMembershipOperationContext = Pick<
  RentalMembershipPageContext,
  "runtime" | "session" | "getSession" | "request" | "requestOriginal"
>;

export function createRentalMembershipPageContext(
  dependencies: Pick<
    RentalMembershipPageContext,
    "runtime" | "session" | "getSession" | "queryScope" | "managementText"
  > & {
    files?: Partial<RentalMembershipFiles>;
    components?: RentalMembershipComponents;
  },
): RentalMembershipPageContext {
  const { runtime, session, getSession } = dependencies;
  const identity = rentalOrderSessionIdentity(
    session,
    runtime.currentSessionEpoch(),
  );
  const assertCurrent = () => {
    const current = getSession();
    if (
      !current.sessionVerified ||
      !current.authenticated ||
      !current.tenant?.tenantId ||
      !current.user?.id ||
      current.user.isSaasAdmin ||
      identity !==
        rentalOrderSessionIdentity(current, runtime.currentSessionEpoch())
    )
      throw new DOMException("会员页面的会话或业务范围已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Output,>(
    path: string,
    options?: AdminRequestOptions,
  ): Promise<Output> => {
    assertCurrent();
    const result = await runtime.request<Output>(path, options);
    assertCurrent();
    return result;
  };
  const unavailable = (): Promise<Blob> =>
    Promise.reject(new Error("会员文件读取不可用"));
  const bindFile =
    <Arguments extends unknown[]>(
      read: (...args: Arguments) => Promise<Blob>,
    ) =>
    async (...args: Arguments) => {
      assertCurrent();
      const result = await read(...args);
      assertCurrent();
      return result;
    };
  return {
    ...dependencies,
    api: createRentalMembershipApi(request),
    customerApi: createRentalCustomerApi(request),
    rewardsApi: createRentalMembershipRewardsApi(request),
    request,
    requestOriginal: <Output,>(path: string, options?: AdminRequestOptions) =>
      request<Output>(path, { ...options, retryAuthentication: false }),
    files: {
      avatar: bindFile(dependencies.files?.avatar ?? unavailable),
      application: bindFile(dependencies.files?.application ?? unavailable),
      management: bindFile(dependencies.files?.management ?? unavailable),
    },
    components: dependencies.components ?? {},
  };
}
const Context = createContext<RentalMembershipPageContext | null>(null);
export function RentalMembershipPageProvider({
  context,
  children,
}: {
  context: RentalMembershipPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useRentalMembershipContext(): RentalMembershipPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("会员页面须绑定当前宿主接点");
  return context;
}
export function useRentalMembershipSession(): RentalMembershipSession;
export function useRentalMembershipSession<Value>(
  selector: (session: RentalMembershipSession) => Value,
): Value;
export function useRentalMembershipSession(
  selector?: (session: RentalMembershipSession) => unknown,
) {
  const session = useRentalMembershipContext().session;
  return selector ? selector(session) : session;
}
export function useMembershipQueryIdentity() {
  return useRentalMembershipContext().queryScope;
}
export function useMembershipManagementLocale() {
  const locale = useLocale();
  const { managementText } = useRentalMembershipContext();
  return { ...locale, t: managementText ?? locale.t };
}
