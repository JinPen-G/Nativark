/** 员工资产业务宿主，当前会话版本与事件供给同一实例的缓存失效。 */
import { createRentalStaffAssetsApi } from "@rental-os/rental-core/clients/staff";
import { ApiError, request } from "../core/http";
import { contextVersion, sessionEvents } from "../core/session";

export const {
  listAssets,
  invalidateAssets,
  getAsset,
  assetStatusHistory,
  saveAsset,
  listStockBalances,
  listStockLedger,
} = createRentalStaffAssetsApi({
  request,
  contextVersion,
  staleContext: () => new ApiError("STALE_CONTEXT", "经营空间已切换，该结果已作废"),
});

sessionEvents.on(invalidateAssets);
