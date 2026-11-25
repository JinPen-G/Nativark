/** 商品、资产与库存沿原API路径；JSON和图片共用宿主已认证的传输接点。 */
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import type {
  RentalAsset,
  RentalAssetStatusHistory,
  RentalItemGroup,
  RentalStockBalance,
  RentalStockLedgerEntry,
  RentalStockOperationRequest,
  RentalStockOperationResult,
  SaveRentalAssetRequest,
  SaveRentalItemGroupRequest,
} from "@rental-os/rental-core";
import { createRentalOrderApi } from "../orders/client";
import { createRentalLocationApi } from "../locations/client";
import { createRentalWorkOrderApi } from "../work-orders/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;
export type RentalCatalogImageRequest = (path: string, options?: ReadOptions) => Promise<Blob>;

export function createRentalCatalogApi(
  request: AdminRuntime["request"],
  requestImage: RentalCatalogImageRequest,
) {
  const orders = createRentalOrderApi(request);
  const locations = createRentalLocationApi(request);
  const workOrders = createRentalWorkOrderApi(request);
  return {
    profile: orders.profile,
    itemGroups: orders.itemGroups,
    pricingGroups: orders.pricingGroups,
    locations: orders.locations,
    categories: locations.categories,
    saveItemGroup: (data: SaveRentalItemGroupRequest) =>
      request<RentalItemGroup>(data.id ? "/rental/v1/item-groups/" + data.id : "/rental/v1/item-groups", {
        method: data.id ? "put" : "post",
        data,
      }),
    uploadItemGroupImage: (id: string, file: File) => {
      const data = new FormData();
      data.append("file", file);
      return request<RentalItemGroup>("/rental/v1/item-groups/" + id + "/images", { method: "post", data });
    },
    removeItemGroupImage: (id: string, imageId: string) =>
      request<RentalItemGroup>("/rental/v1/item-groups/" + id + "/images/" + imageId, { method: "delete" }),
    itemGroupImageBlob: (id: string, imageId: string, options?: ReadOptions) =>
      requestImage("/rental/v1/item-groups/" + id + "/images/" + imageId, options),
    assets: (options?: ReadOptions) => request<RentalAsset[]>("/rental/v1/assets", options),
    assetStatusHistory: (assetId: string, options?: ReadOptions) =>
      request<RentalAssetStatusHistory[]>(
        "/rental/v1/assets/" + encodeURIComponent(assetId) + "/status-history",
        options,
      ),
    saveAsset: (data: SaveRentalAssetRequest) =>
      request<RentalAsset>(data.id ? "/rental/v1/assets/" + data.id : "/rental/v1/assets", {
        method: data.id ? "put" : "post",
        data,
      }),
    stockBalances: (options?: ReadOptions) =>
      request<RentalStockBalance[]>("/rental/v1/stock-balances", options),
    stockDispositions: workOrders.stockDispositions,
    stockLedger: (
      params?: {
        itemGroupId?: string;
        locationId?: string;
        batchNo?: string;
        sourceDocumentNo?: string;
        limit?: number;
      },
      options?: ReadOptions,
    ) => request<RentalStockLedgerEntry[]>("/rental/v1/stock-ledger", { params, ...options }),
    applyStockOperation: (data: RentalStockOperationRequest) =>
      request<RentalStockOperationResult>("/rental/v1/stock-operations", { method: "post", data }),
  };
}
export type RentalCatalogApi = ReturnType<typeof createRentalCatalogApi>;
