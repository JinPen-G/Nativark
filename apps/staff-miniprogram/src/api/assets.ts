import type { RentalAsset, RentalAssetStatusHistory, RentalStockBalance, RentalStockLedgerEntry, SaveRentalAssetRequest } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 资产与库存：资产列表/详情/状态历史、快速登记、库存流水与库存操作（转移/入库/报损）。
 * 服务端按会话空间隔离；地点筛选在客户端按当前地点范围做（服务端地点范围为后端前置 STAFF-BE-01）。
 */
let assetCache: { rows: RentalAsset[]; at: number } | undefined;
const ASSET_TTL_MS = 30_000;

export async function listAssets(force = false): Promise<RentalAsset[]> {
  if (!force && assetCache && Date.now() - assetCache.at < ASSET_TTL_MS) return assetCache.rows;
  const rows = await request<RentalAsset[]>("/rental/v1/assets");
  assetCache = { rows, at: Date.now() };
  return rows;
}

export function invalidateAssets(): void {
  assetCache = undefined;
}

export async function getAsset(assetId: string): Promise<RentalAsset | undefined> {
  const rows = await listAssets();
  return rows.find((row) => row.id === assetId) ?? (await listAssets(true)).find((row) => row.id === assetId);
}

export function assetStatusHistory(assetId: string): Promise<RentalAssetStatusHistory[]> {
  return request<RentalAssetStatusHistory[]>(`/rental/v1/assets/${encodeURIComponent(assetId)}/status-history`);
}

/** 新建或更新资产（快速登记）。 */
export async function saveAsset(input: SaveRentalAssetRequest): Promise<RentalAsset> {
  const result = input.id
    ? await request<RentalAsset>(`/rental/v1/assets/${encodeURIComponent(input.id)}`, { method: "PUT", data: input })
    : await request<RentalAsset>("/rental/v1/assets", { method: "POST", data: input });
  invalidateAssets();
  return result;
}

export function listStockBalances(): Promise<RentalStockBalance[]> {
  return request<RentalStockBalance[]>("/rental/v1/stock-balances");
}

export function listStockLedger(filters: { itemGroupId?: string; locationId?: string; batchNo?: string; limit?: number } = {}): Promise<RentalStockLedgerEntry[]> {
  return request<RentalStockLedgerEntry[]>("/rental/v1/stock-ledger", { query: { itemGroupId: filters.itemGroupId, locationId: filters.locationId, batchNo: filters.batchNo, limit: filters.limit } });
}
