/** 宿主供给当前会话、客户预览和原文本传输，异步结果归属打开页面时的业务范围。 */
import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import {
  rentalOrderSessionIdentity,
  type RentalOrderCustomerPreviewProps,
  type RentalOrderSession,
} from "../orders/page-context";
import {
  createRentalOperationsApi,
  type RentalOperationsApi,
  type RentalOperationsTextRequest,
} from "./client";

export interface RentalOperationsPageContext {
  api: RentalOperationsApi;
  session: RentalOrderSession;
  queryScope: string;
  components: { CustomerPreview: ComponentType<RentalOrderCustomerPreviewProps> };
}

export function createRentalOperationsPageContext({
  runtime,
  requestText,
  session,
  getSession,
  queryScope,
  components,
}: Omit<RentalOperationsPageContext, "api"> & {
  runtime: AdminRuntime;
  requestText: RentalOperationsTextRequest;
  getSession: () => RentalOrderSession;
}): RentalOperationsPageContext {
  const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
  const assertCurrent = () => {
    const current = getSession();
    if (!current.sessionVerified || !current.authenticated || !current.tenant?.tenantId
      || !current.user?.id || current.user.isSaasAdmin
      || identity !== rentalOrderSessionIdentity(current, runtime.currentSessionEpoch()))
      throw new DOMException("经营页面的会话或业务范围已变化", "AbortError");
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
  const textRequest: RentalOperationsTextRequest = async (path, params) => {
    assertCurrent();
    const result = await requestText(path, params);
    assertCurrent();
    return result;
  };
  return { api: createRentalOperationsApi(request, textRequest), session, queryScope, components };
}

const Context = createContext<RentalOperationsPageContext | null>(null);

export function RentalOperationsPageProvider({ context, children }: {
  context: RentalOperationsPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalOperationsContext(): RentalOperationsPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("经营页面须绑定当前宿主接点");
  return context;
}
