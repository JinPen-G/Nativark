/** 宿主供给当前会话、经营空间和原鉴权传输，异步返回继续复验原范围。 */
import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { useCorePageHost } from "@rental-os/platform-admin/core";
import type { RentalCatalogImageRequest } from "../catalog/client";
import { createRentalCommercialApi, type RentalCommercialApi } from "./client";
import { RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_ACCESS } from "./pages";

export interface RentalCommercialPageContext {
  api: RentalCommercialApi;
  scopeKey: string;
  currentScopeKey: () => string | undefined;
}

export function createRentalCommercialPageContext({
  runtime,
  requestImage,
  scopeKey,
  currentScopeKey,
}: {
  runtime: AdminRuntime;
  requestImage: RentalCatalogImageRequest;
  scopeKey: string;
  currentScopeKey: RentalCommercialPageContext["currentScopeKey"];
}): RentalCommercialPageContext {
  const assertCurrent = () => {
    if (!scopeKey || currentScopeKey() !== scopeKey)
      throw new DOMException("商业页面的会话或经营空间已变化", "AbortError");
  };
  const request: AdminRuntime["request"] = async <Result,>(
    path: string,
    options?: AdminRequestOptions,
  ): Promise<Result> => {
    assertCurrent();
    const result = await runtime.request<Result>(path, options);
    assertCurrent();
    return result;
  };
  const imageRequest: RentalCatalogImageRequest = async (path, options) => {
    assertCurrent();
    const image = await requestImage(path, options);
    assertCurrent();
    return image;
  };
  return { api: createRentalCommercialApi(request, imageRequest), scopeKey, currentScopeKey };
}

const CommercialContext = createContext<RentalCommercialPageContext | null>(null);

export function RentalCommercialPageProvider({
  context,
  children,
}: {
  context: RentalCommercialPageContext;
  children: ReactNode;
}) {
  return createElement(CommercialContext.Provider, { value: context }, children);
}

export function useRentalCommercialPageContext(): RentalCommercialPageContext {
  const context = useContext(CommercialContext);
  if (!context) throw new Error("商业页面上下文不可用");
  return context;
}

export function useRentalCommercialWorkspaceAccess() {
  const context = useRentalCommercialPageContext();
  const host = useCorePageHost();
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const isCurrentScope = () =>
    active.current && Boolean(context.scopeKey) && context.currentScopeKey() === context.scopeKey;
  const canManage = host.canAccess(RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_ACCESS);
  const assertManage = () => {
    if (!isCurrentScope()) throw new DOMException("商业页面的会话或经营空间已变化", "AbortError");
    if (!host.canAccess(RENTAL_COMMERCIAL_CORE_ID, RENTAL_COMMERCIAL_ACCESS))
      throw new Error("当前操作不可用");
  };
  return { ...context, scope: context.scopeKey, host, canManage, isCurrentScope, assertManage };
}
