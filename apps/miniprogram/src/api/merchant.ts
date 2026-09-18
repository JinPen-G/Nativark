import type { ClientConfigResponse } from "@rental-os/shared";
import { PUBLIC_CONFIG } from "../config/public";
import { PLANNED_CONTRACTS, contractMissing, type ChannelBootstrapContract } from "../contracts/planned";
import { request } from "../core/http";

/** 现有公开接口：租户下可展示的服务空间。 */
export interface PublicServicesResponse {
  apiVersion: string;
  tenantCode: string;
  tenantName: string;
  workspaces: Array<{ code: string; name: string; categoryCode: string; isDefault?: boolean }>;
}

export async function listPublicServices(): Promise<PublicServicesResponse> {
  return request<PublicServicesResponse>(`/tenants/${encodeURIComponent(PUBLIC_CONFIG.tenantCode)}/workspaces`, { auth: "none" });
}

/**
 * 渠道启动配置（拟新增 MP-01）。服务端未提供时返回 undefined，调用方退回现有公开接口，
 * 只能得到商户名称与服务列表，没有 Logo/协议/客服——页面据实标注“商户未提供”。
 */
export async function fetchBootstrap(): Promise<ChannelBootstrapContract | undefined> {
  try {
    return await request<ChannelBootstrapContract>(PLANNED_CONTRACTS.bootstrap.path, {
      auth: "none",
      query: { tenantCode: PUBLIC_CONFIG.tenantCode, appId: PUBLIC_CONFIG.appId || undefined }
    });
  } catch (error) {
    if (contractMissing(error)) return undefined;
    throw error;
  }
}

/** 登录后的当前服务配置：时区、注册模式、功能开关与支付能力。 */
export async function fetchConfig(): Promise<ClientConfigResponse> {
  return request<ClientConfigResponse>("/config");
}
