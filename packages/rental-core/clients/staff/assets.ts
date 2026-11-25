/**
 * 员工资产业务与实例内缓存。宿主会话版本限定缓存归属，刷新事件清除旧缓存，
 * 请求代次保护较新读取与保存后的失效点，范围授权继续由真实员工运输和服务端裁定。
 */
import type {
  RentalAsset,
  RentalAssetStatusHistory,
  RentalStockBalance,
  RentalStockLedgerEntry,
  SaveRentalAssetRequest,
} from "../../src/contracts";
import type { RentalStaffAssetsPorts } from "./ports";

const ASSET_TTL_MS = 30_000;

export function createRentalStaffAssetsApi({ request, contextVersion, staleContext }: RentalStaffAssetsPorts) {
  let assetCache: { rows: RentalAsset[]; at: number; contextVersion: number } | undefined;
  let requestGeneration = 0;

  function assertContext(version: number): void {
    if (contextVersion() !== version) throw staleContext();
  }

  async function listAssets(force = false): Promise<RentalAsset[]> {
    const version = contextVersion();
    if (!force && assetCache && assetCache.contextVersion === version && Date.now() - assetCache.at < ASSET_TTL_MS) {
      // 缓存读取也有 await 边界，当前调用返回前切换会话时必须放弃旧范围结果。
      const rows = await Promise.resolve(assetCache.rows);
      assertContext(version);
      return rows;
    }
    const generation = ++requestGeneration;
    const rows = await request<RentalAsset[]>("/rental/v1/assets");
    assertContext(version);
    // 旧请求只能结束自身读取，不能覆盖较新请求或保存后清空的缓存。
    if (generation === requestGeneration) assetCache = { rows, at: Date.now(), contextVersion: version };
    return rows;
  }

  function invalidateAssets(): void {
    requestGeneration += 1;
    assetCache = undefined;
  }

  async function getAsset(assetId: string): Promise<RentalAsset | undefined> {
    const version = contextVersion();
    let rows = await listAssets();
    assertContext(version);
    const asset = rows.find((row) => row.id === assetId);
    if (asset) return asset;
    rows = await listAssets(true);
    assertContext(version);
    return rows.find((row) => row.id === assetId);
  }

  function assetStatusHistory(assetId: string): Promise<RentalAssetStatusHistory[]> {
    return request<RentalAssetStatusHistory[]>(`/rental/v1/assets/${encodeURIComponent(assetId)}/status-history`);
  }

  /** 新建或更新资产（快速登记）。 */
  async function saveAsset(input: SaveRentalAssetRequest): Promise<RentalAsset> {
    const version = contextVersion();
    const result = input.id
      ? await request<RentalAsset>(`/rental/v1/assets/${encodeURIComponent(input.id)}`, { method: "PUT", data: input })
      : await request<RentalAsset>("/rental/v1/assets", { method: "POST", data: input });
    assertContext(version);
    invalidateAssets();
    return result;
  }

  function listStockBalances(): Promise<RentalStockBalance[]> {
    return request<RentalStockBalance[]>("/rental/v1/stock-balances");
  }

  function listStockLedger(filters: { itemGroupId?: string; locationId?: string; batchNo?: string; limit?: number } = {}): Promise<RentalStockLedgerEntry[]> {
    return request<RentalStockLedgerEntry[]>("/rental/v1/stock-ledger", { query: { itemGroupId: filters.itemGroupId, locationId: filters.locationId, batchNo: filters.batchNo, limit: filters.limit } });
  }

  return { listAssets, invalidateAssets, getAsset, assetStatusHistory, saveAsset, listStockBalances, listStockLedger };
}
