/**
 * 员工经营目录客户端。业务定义来自 Rental 合同，宿主 request 供给员工鉴权与请求范围。
 * 品类读取当前采用正文，空间上下文的缓存与提交由宿主 core/context 管理。
 */
import type { RentalCategoryDefinition, RentalFulfillmentLocation, RentalItemGroup } from "../../src/contracts";
import type { RentalStaffClientPorts } from "./ports";

export function createRentalStaffDirectoryApi({ request }: RentalStaffClientPorts) {
  function listCategories(): Promise<RentalCategoryDefinition[]> {
    return request<RentalCategoryDefinition[]>("/rental/v1/categories", { scope: "tenant" });
  }

  function listLocations(): Promise<RentalFulfillmentLocation[]> {
    return request<RentalFulfillmentLocation[]>("/rental/v1/locations");
  }

  let itemGroupCache: { workspaceKey: string; rows: RentalItemGroup[]; at: number } | undefined;

  /** 型号目录每次按原请求读取；force 形参保留原调用签名。 */
  async function listItemGroups(force = false): Promise<RentalItemGroup[]> {
    const rows = await request<RentalItemGroup[]>("/rental/v1/item-groups");
    void force;
    itemGroupCache = { workspaceKey: "", rows, at: Date.now() };
    return itemGroupCache.rows;
  }

  /** 员工门面相对图片路径，经宿主 core/images 与 apiUrl 使用员工令牌下载。 */
  function itemGroupImagePath(itemGroupId: string, imageId: string): string {
    return `/rental/v1/item-groups/${encodeURIComponent(itemGroupId)}/images/${encodeURIComponent(imageId)}`;
  }

  return {
    listCategories,
    listLocations,
    listItemGroups,
    itemGroupImagePath,
  };
}
