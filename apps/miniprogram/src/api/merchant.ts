import type { ClientChannelBootstrapResponse, ClientConfigResponse, ClientPublicDocumentKind, ClientPublicDocumentResponse } from "@rental-os/shared";
import { PUBLIC_CONFIG } from "../config/public";
import { contractMissing } from "../contracts/planned";
import { request } from "../core/http";

/** 现有公开接口：租户下可展示的服务空间（渠道未配置时的回退来源）。 */
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
 * 渠道启动配置（MP-01）。服务端在商户未配置渠道时仍返回回退投影（source=workspace_directory）；
 * 只有商户不存在等硬错误才返回 undefined，调用方再退回现有公开接口。
 */
export async function fetchBootstrap(): Promise<ClientChannelBootstrapResponse | undefined> {
  try {
    return await request<ClientChannelBootstrapResponse>("/public/bootstrap", {
      auth: "none",
      // 本包是微信小程序渠道；APP 端复用同一接口传 client=app。
      query: { tenantCode: PUBLIC_CONFIG.tenantCode, client: "wechat_miniprogram", appId: PUBLIC_CONFIG.appId || undefined }
    });
  } catch (error) {
    if (contractMissing(error)) return undefined;
    throw error;
  }
}

/** 公开文档正文（用户协议 / 隐私政策 / 帮助），游客可读；商户未提供时抛 UNAVAILABLE，页面显示“商户未提供”。 */
export async function fetchPublicDocument(kind: ClientPublicDocumentKind): Promise<ClientPublicDocumentResponse | undefined> {
  try {
    return await request<ClientPublicDocumentResponse>(`/public/documents/${encodeURIComponent(kind)}`, {
      auth: "none",
      query: { tenantCode: PUBLIC_CONFIG.tenantCode }
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
