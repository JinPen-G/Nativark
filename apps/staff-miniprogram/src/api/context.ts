import type { SessionContextResponse } from "@rental-os/shared";
import { createRentalStaffDirectoryApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

/**
 * 员工工作上下文入口。经营目录由 Rental 客户端实现，会话上下文经原员工运输读取。
 * 当前采用正文与空间上下文的缓存、权限应用和迟到提交由 core/context 复核。
 */
export function sessionContext(): Promise<SessionContextResponse> {
  return request<SessionContextResponse>("/auth/session-context", { scope: "tenant" });
}

export const {
  listCategories,
  listLocations,
  listItemGroups,
  itemGroupImagePath,
} = createRentalStaffDirectoryApi({ request });
