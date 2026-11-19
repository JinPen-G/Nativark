/** 当前宿主供给已验证的会话和请求。对账读取、导入与处理前后复核同一经营范围。 */
import { createContext, useContext, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "../orders/page-context";
import { createRentalPaymentReconciliationApi, type RentalPaymentReconciliationApi } from "./client";
import { rentalPaymentReconciliationLegacyPageAllowed } from "./pages";

export interface RentalPaymentReconciliationPageContext {
  api: RentalPaymentReconciliationApi;
  session: RentalOrderSession;
  queryScope: string;
  isCurrent: () => boolean;
}

export function createRentalPaymentReconciliationPageContext({
  runtime, session, getSession, queryScope,
}: Omit<RentalPaymentReconciliationPageContext, "api" | "isCurrent"> & {
  runtime: AdminRuntime;
  getSession: () => RentalOrderSession;
}): RentalPaymentReconciliationPageContext {
  const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
  const isCurrent = () => {
    const current = getSession();
    return Boolean(queryScope && current.tenant?.tenantId && current.user?.id
      && rentalPaymentReconciliationLegacyPageAllowed(current)
      && identity === rentalOrderSessionIdentity(current, runtime.currentSessionEpoch()));
  };
  const assertCurrent = () => {
    if (!isCurrent()) throw new DOMException("对账页面的会话或经营范围已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Output,>(
    path: string, options?: AdminRequestOptions,
  ): Promise<Output> => {
    assertCurrent();
    const result = await runtime.request<Output>(path, options);
    assertCurrent();
    return result;
  };
  return { api: createRentalPaymentReconciliationApi(request), session, queryScope, isCurrent };
}

const Context = createContext<RentalPaymentReconciliationPageContext | null>(null);

export function RentalPaymentReconciliationPageProvider({ context, children }: {
  context: RentalPaymentReconciliationPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalPaymentReconciliationContext(): RentalPaymentReconciliationPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("支付对账页面须绑定当前宿主接点");
  return context;
}
