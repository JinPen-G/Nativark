import type { ClientCatalogResponse } from "../../src/client-contracts";

/** 公开浏览和登录预约共用当前目录的结构门禁；未声明元数据仍兼容旧合同。
 * 已声明但不支持的结构不能开始新流程，历史订单与原报价收据不经过此门禁。 */
export function assertSupportedCatalogVersion(catalog: ClientCatalogResponse): ClientCatalogResponse {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)
    || typeof catalog.categoryCode !== "string" || !catalog.categoryCode) {
    throw new Error("商品目录无法读取，请重新加载");
  }
  const metadata = catalog.categoryMetadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== "object"
    || Array.isArray(metadata) || metadata.structureVersion !== 1)) {
    throw new Error("当前网站不支持此品类展示版本，请刷新页面；仍无法使用时请联系商户");
  }
  return catalog;
}
