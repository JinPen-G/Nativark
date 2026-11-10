import type { RentalCategoryDefinition, RentalFulfillmentLocation, RentalItemGroup, SessionContextResponse } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 工作上下文数据源：会话上下文（权限/空间/品类/能力）、品类定义（术语/字段）、履约地点、型号目录。
 * categories返回当前会话空间的明确采用正文；重新加载须复核，不能缓存成全局静态目录。
 */
export function sessionContext(): Promise<SessionContextResponse> {
  return request<SessionContextResponse>("/auth/session-context", { scope: "tenant" });
}

export function listCategories(): Promise<RentalCategoryDefinition[]> {
  return request<RentalCategoryDefinition[]>("/rental/v1/categories", { scope: "tenant" });
}

export function listLocations(): Promise<RentalFulfillmentLocation[]> {
  return request<RentalFulfillmentLocation[]>("/rental/v1/locations");
}

let itemGroupCache: { workspaceKey: string; rows: RentalItemGroup[]; at: number } | undefined;

/** 型号目录（扫码解析、资产表单选型号用）；同一空间 60 秒内复用。 */
export async function listItemGroups(force = false): Promise<RentalItemGroup[]> {
  const rows = await request<RentalItemGroup[]>("/rental/v1/item-groups");
  void force;
  itemGroupCache = { workspaceKey: "", rows, at: Date.now() };
  return itemGroupCache.rows;
}

/** 型号图片地址（受保护路径）。用员工门面相对路径，经 core/images → apiUrl 拼成 /api/staff/v1/... 带令牌下载；
 * 不能带 /api 前缀直连 operator 路由——员工令牌受众为 staff，直连会 401，且该子路由需走门面白名单。 */
export function itemGroupImagePath(itemGroupId: string, imageId: string): string {
  return `/rental/v1/item-groups/${encodeURIComponent(itemGroupId)}/images/${encodeURIComponent(imageId)}`;
}
