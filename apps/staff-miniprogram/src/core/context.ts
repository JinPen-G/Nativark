/** 员工微信经营上下文入口。同一会话、事件与历史地点键供给 Core，图标和首页配图沿微信资源。 */
import { createRentalStaffContext, type WorkspaceContext } from "@rental-os/rental-core/clients/staff";
import { listCategories, listLocations, sessionContext } from "../api/context";
import { Emitter } from "./events";
import { applySessionContext, contextVersion, currentWorkspace, currentWorkspaceId, sessionEvents } from "./session";
import { ApiError } from "./http";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

export const contextEvents = new Emitter<WorkspaceContext>();

const workspaceContext = createRentalStaffContext({
  sessionContext,
  listCategories,
  listLocations,
  currentWorkspace,
  currentWorkspaceId,
  contextVersion,
  applySessionContext,
  onSessionEvent: (listener) => sessionEvents.on(listener),
  contextEvents,
  staleContext: () => new ApiError("STALE_CONTEXT", "经营空间或账号已切换，该上下文已作废"),
  locationStorageKey: STORAGE_KEYS.locationByWorkspace,
  readStorage,
  writeStorage,
  now: () => Date.now(),
});

export const {
  cachedContext, terms, loadContext, setCurrentLocation, currentLocation,
  currentLocationLabel, inCurrentLocation, resetContextForTest,
} = workspaceContext;
export type { Terminology, WorkspaceContext } from "@rental-os/rental-core/clients/staff";

/**
 * 品类图标名（ui-icon）。按品类码映射，未知品类用通用“box”。
 * 图标和首页配图是客户端资源，服务端术语表不描述它们。
 */
export function categoryIcon(categoryCode?: string): string {
  switch (categoryCode ?? cachedContext()?.categoryCode) {
    case "camera":
      return "camera";
    case "camping":
      return "tent";
    case "vehicle":
      return "car";
    case "construction":
      return "crane";
    default:
      return "box";
  }
}

/** 首页横幅配图只用于视觉，不替代真实商品/资产图片。 */
export function categoryArtwork(categoryCode?: string): string {
  const art: Record<string, string> = {
    camera: "/assets/hero-camera-cutout.webp",
    camping: "/assets/hero-camping.webp",
    vehicle: "/assets/hero-vehicle.webp",
    construction: "/assets/hero-construction.webp"
  };
  return art[categoryCode ?? cachedContext()?.categoryCode ?? ""] ?? "";
}
