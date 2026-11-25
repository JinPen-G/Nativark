/** 员工微信扫码入口。绑定同一会话、业务 API、原历史键与时钟，页面和相机沿微信宿主。 */
import { createRentalStaffScan } from "@rental-os/rental-core/clients/staff";
import { listAssets } from "../api/assets";
import { listItemGroups } from "../api/context";
import { listOrders } from "../api/orders";
import { listWorkOrders } from "../api/workOrders";
import { currentSession, currentWorkspaceId, contextVersion } from "./session";
import { terms } from "./context";
import { ApiError } from "./http";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

const scan = createRentalStaffScan({
  currentSession,
  currentWorkspaceId,
  contextVersion,
  staleContext: () => new ApiError("STALE_CONTEXT", "账号或经营空间已切换，该扫码结果已作废"),
  terms,
  listOrders,
  listAssets,
  listItemGroups,
  listWorkOrders,
  scanHistoryStorageKey: STORAGE_KEYS.scanHistory,
  readStorage,
  writeStorage,
  now: () => Date.now(),
});

export const { scanHistory, rememberScan, clearScanHistory, parseDeepLink, resolveScan, assertCurrentResult } = scan;
export type { ScanKind, ScanResult, ScanHistoryEntry } from "@rental-os/rental-core/clients/staff";
