/** 开业页读取当前经营空间事实，宿主供给受权的公共账号入口。 */
import { createContext, useContext, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "../orders/page-context";
import { createRentalSetupApi, type RentalSetupApi } from "./client";

export interface RentalSetupPageContext {
  api: RentalSetupApi;
  session: RentalOrderSession;
  queryScope: string;
  isCurrent: () => boolean;
  accounts?: { canOpen: () => boolean; open: () => void };
}

export function createRentalSetupPageContext({
  runtime, session, getSession, queryScope, accounts,
}: Omit<RentalSetupPageContext, "api" | "isCurrent"> & {
  runtime: AdminRuntime;
  getSession: () => RentalOrderSession;
}): RentalSetupPageContext {
  const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
  const isCurrent = () => {
    const current = getSession();
    return Boolean(current.sessionVerified && current.authenticated && current.tenant?.tenantId
      && current.currentWorkspaceId && current.user?.id && !current.user.isSaasAdmin
      && identity === rentalOrderSessionIdentity(current, runtime.currentSessionEpoch()));
  };
  const assertCurrent = () => {
    if (!isCurrent()) throw new DOMException("开业配置的会话或业务范围已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Output,>(
    path: string, options?: AdminRequestOptions,
  ): Promise<Output> => {
    assertCurrent();
    const result = await runtime.request<Output>(path, options);
    assertCurrent();
    return result;
  };
  return {
    api: createRentalSetupApi(request), session, queryScope, isCurrent,
    accounts: accounts && {
      canOpen: () => isCurrent() && accounts.canOpen(),
      open: () => {
        assertCurrent();
        if (!accounts.canOpen()) throw new Error("当前账号管理入口不可用");
        accounts.open();
      },
    },
  };
}

const Context = createContext<RentalSetupPageContext | null>(null);

export function RentalSetupPageProvider({ context, children }: {
  context: RentalSetupPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalSetupContext(): RentalSetupPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("开业配置须绑定当前宿主接点");
  return context;
}
