/** 宿主供给当前会话、资产基址和登录品牌默认文案。异步配置和品牌刷新绑定打开页面时的业务范围。 */
import { createContext, useContext, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type { ClientChannelProfileSummary } from "@rental-os/rental-core";
import { rentalOrderSessionIdentity, type RentalOrderSession } from "../orders/page-context";
import { createRentalClientChannelApi, type RentalClientChannelApi } from "./client";
import { createRentalWebsiteChannelApi, type RentalWebsiteChannelApi } from "./website-client";

export interface RentalChannelLoginDefaults {
  title: string;
  description: string;
  highlights: readonly { title: string; description: string }[];
  footerText: string;
}

export type RentalChannelBranding = Pick<ClientChannelProfileSummary,
  "brandName" | "brandLogoUrl" | "faviconUrl" | "themeColor" | "adminCornerRadius"
  | "adminContainerRadius" | "adminButtonRadius" | "adminInputRadius">;

export interface RentalChannelsPageContext {
  clientApi: RentalClientChannelApi;
  websiteApi: RentalWebsiteChannelApi;
  session: RentalOrderSession;
  queryScope: string;
  assetOrigin: string;
  loginDefaults: RentalChannelLoginDefaults;
  setTenantBranding: (branding: RentalChannelBranding) => void;
  isCurrent: () => boolean;
}

export function createRentalChannelsPageContext({
  runtime, session, getSession, queryScope, assetOrigin, loginDefaults, setTenantBranding,
}: Omit<RentalChannelsPageContext, "clientApi" | "websiteApi" | "isCurrent"> & {
  runtime: AdminRuntime;
  getSession: () => RentalOrderSession;
}): RentalChannelsPageContext {
  const identity = rentalOrderSessionIdentity(session, runtime.currentSessionEpoch());
  const isCurrent = () => {
    const current = getSession();
    return Boolean(current.sessionVerified && current.authenticated && current.tenant?.tenantId
      && current.user?.id && !current.user.isSaasAdmin
      && identity === rentalOrderSessionIdentity(current, runtime.currentSessionEpoch()));
  };
  const assertCurrent = () => {
    if (!isCurrent()) throw new DOMException("渠道配置的会话或业务范围已变化", "AbortError");
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
    clientApi: createRentalClientChannelApi(request),
    websiteApi: createRentalWebsiteChannelApi(request),
    session, queryScope, assetOrigin, loginDefaults, isCurrent,
    setTenantBranding: branding => { assertCurrent(); setTenantBranding(branding); },
  };
}

const Context = createContext<RentalChannelsPageContext | null>(null);

export function RentalChannelsPageProvider({ context, children }: {
  context: RentalChannelsPageContext;
  children: ReactNode;
}) {
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

export function useRentalChannelsContext(): RentalChannelsPageContext {
  const context = useContext(Context);
  if (!context) throw new Error("渠道配置须绑定当前宿主接点");
  return context;
}
