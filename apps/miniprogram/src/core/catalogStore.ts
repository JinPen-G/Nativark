import type { ClientCatalogItem, ClientCatalogLocation, ClientCatalogPricingGroup, ClientCatalogResponse } from "@rental-os/shared";
import { fetchCatalog, fetchPublicCatalog } from "../api/catalog";
import { distanceMeters, type GeoPoint } from "./geo";
import { resolveImage } from "./images";
import { inventoryLabel, pricingUnitLabel } from "./labels";
import { startingPriceParts } from "./money";
import { contextVersion, currentServiceCode, isSignedIn } from "./session";
import { rememberZone } from "./zones";

/**
 * 当前服务的目录缓存。已登录读私有目录（服务端按会话中的服务返回）；游客读拟新增的公开目录。
 * 缓存绑定上下文版本：切换服务/登录/退出后旧缓存自动失效，杜绝串空间。
 */
interface Snapshot {
  serviceCode: string;
  version: number;
  guest: boolean;
  catalog: ClientCatalogResponse;
  fetchedAt: number;
}

const TTL_MS = 2 * 60 * 1000;
let snapshot: Snapshot | undefined;
let inflight: { key: string; promise: Promise<ClientCatalogResponse> } | undefined;

export function cachedCatalog(serviceCode: string): ClientCatalogResponse | undefined {
  if (!snapshot || snapshot.serviceCode !== serviceCode || snapshot.version !== contextVersion()) return undefined;
  return snapshot.catalog;
}

export async function loadCatalog(serviceCode: string, force = false): Promise<ClientCatalogResponse> {
  const cached = cachedCatalog(serviceCode);
  if (cached && !force && Date.now() - snapshot!.fetchedAt < TTL_MS) return cached;
  const version = contextVersion();
  const guest = !isSignedIn();
  const key = `${serviceCode}@${version}@${guest ? "guest" : "member"}`;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = (async () => {
    if (!guest && currentServiceCode() !== serviceCode) {
      throw new Error("当前会话的服务与请求的服务不一致，请先切换服务");
    }
    const catalog = guest ? await fetchPublicCatalog(serviceCode) : await fetchCatalog();
    if (contextVersion() !== version || isSignedIn() === guest) throw new Error("会话已变化，请重新读取目录");
    if (catalog.workspace.workspaceCode !== serviceCode || catalog.categoryCode !== catalog.workspace.categoryCode) throw new Error("目录与当前服务不一致");
    if (catalog.categoryMetadata && catalog.categoryMetadata.structureVersion !== 1) throw new Error("当前客户端不支持此品类展示版本，请升级后重试");
    if (catalog?.timeZone) rememberZone(serviceCode, catalog.timeZone);
    snapshot = { serviceCode, version, guest, catalog, fetchedAt: Date.now() };
    return catalog;
  })();
  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = undefined;
  }
}

export function invalidateCatalog(): void {
  snapshot = undefined;
}

/** 首页搜索框 → 分类 Tab：switchTab 不能带参数，用内存中转一次搜索词。 */
let pendingSearch = "";
export function setPendingSearch(query: string): void {
  pendingSearch = query.trim().slice(0, 50);
}
export function takePendingSearch(): string {
  const value = pendingSearch;
  pendingSearch = "";
  return value;
}

/** 列表/网格卡片视图模型（需求 §6.2）。图片异步解析，缺图用中性占位；价格来自服务端起价。 */
export interface ItemCard {
  id: string;
  name: string;
  brand: string;
  desc: string;
  specs: string[];
  inventoryLabel: string;
  imageSource: string;
  imagePath: string;
  hasImage: boolean;
  priceSymbol: string;
  priceNumber: string;
  priceUnit: string;
  hasPrice: boolean;
}

const HIDDEN_ATTRIBUTES = new Set(["brand", "品牌", "manufacturer", "厂商", "category", "分类", "tags", "标签", "scenes", "场景", "适用场景", "model", "型号"]);
const SPEC_PRIORITY = ["sensor", "传感器", "mount", "卡口", "capacity", "容量", "people", "适用人数", "season", "季节规格", "seats", "座位数", "energyType", "能源类型", "transmission", "变速方式", "ratedLoad", "额定载荷", "power", "功率", "weightG", "自重", "material", "材质", "modelYear", "年款"];

function attributeText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return undefined;
}

export function brandOf(item: ClientCatalogItem): string {
  const attributes = item.attributes ?? {};
  return attributeText(attributes.brand) ?? attributeText(attributes["品牌"]) ?? attributeText(attributes.manufacturer) ?? attributeText(attributes["厂商"]) ?? "";
}

/** 商品属性里的自由列表：数组、逗号/顿号分隔字符串均可。 */
export function listAttribute(item: ClientCatalogItem, keys: string[]): string[] {
  const attributes = item.attributes ?? {};
  for (const key of keys) {
    const raw = attributes[key];
    if (Array.isArray(raw)) return raw.map((row) => attributeText(row)).filter((row): row is string => Boolean(row)).slice(0, 8);
    const text = attributeText(raw);
    if (text) return text.split(/[,，、;；|]/).map((row) => row.trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}

export function specsOf(item: ClientCatalogItem, limit = 3): string[] {
  const attributes = item.attributes ?? {};
  const specs: string[] = [];
  for (const key of SPEC_PRIORITY) {
    const text = attributeText(attributes[key]);
    if (text && !specs.includes(text)) specs.push(text);
    if (specs.length >= limit) break;
  }
  if (specs.length < limit) {
    for (const [key, value] of Object.entries(attributes)) {
      if (HIDDEN_ATTRIBUTES.has(key) || SPEC_PRIORITY.includes(key)) continue;
      const text = attributeText(value);
      if (text && !specs.includes(text)) specs.push(text);
      if (specs.length >= limit) break;
    }
  }
  return specs;
}

/** 全部可展示的规格（标签 + 值），供详情页“主要参数”。 */
export function specEntries(item: ClientCatalogItem): Array<{ label: string; value: string }> {
  return Object.entries(item.attributes ?? {})
    .filter(([key]) => !HIDDEN_ATTRIBUTES.has(key))
    .map(([key, value]) => ({ label: item.attributeLabels?.[key] ?? key, value: attributeText(value) ?? "" }))
    .filter((row) => row.value)
    .slice(0, 12);
}

export function catalogPricingUnitLabel(catalog: ClientCatalogResponse | undefined, code?: string | null): string {
  if (!code) return "";
  return catalog?.pricingUnits?.find((unit) => unit.code === code)?.label ?? pricingUnitLabel(code);
}

export function toItemCard(item: ClientCatalogItem, catalog?: ClientCatalogResponse): ItemCard {
  const image = item.images?.[0];
  const price = startingPriceParts(item.startingPrice, (unit) => catalogPricingUnitLabel(catalog, unit));
  const specs = specsOf(item);
  const brand = brandOf(item);
  const desc = item.description?.trim() || [brand, ...specs].filter(Boolean).join(" · ");
  return {
    id: item.id,
    name: item.name,
    brand,
    desc,
    specs,
    inventoryLabel: inventoryLabel(item.inventoryMode),
    imageSource: image?.url ?? "",
    imagePath: "",
    hasImage: Boolean(image?.url),
    priceSymbol: price.symbol,
    priceNumber: price.number,
    priceUnit: price.unit,
    hasPrice: price.available
  };
}

/** 分类芯片：来自商品的品牌/分类属性，只展示真实存在的值。 */
export function facetsOf(items: ClientCatalogItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const brand = brandOf(item);
    const category = attributeText(item.attributes?.category) ?? attributeText(item.attributes?.["分类"]);
    for (const facet of [category, brand]) if (facet) counts.set(facet, (counts.get(facet) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([facet]) => facet).slice(0, 12);
}

export function searchItems(items: ClientCatalogItem[], query: string, facet: string): ClientCatalogItem[] {
  const needle = query.trim().toLowerCase().slice(0, 50);
  return items.filter((item) => {
    if (facet) {
      const brand = brandOf(item);
      const category = attributeText(item.attributes?.category) ?? attributeText(item.attributes?.["分类"]) ?? "";
      if (brand !== facet && category !== facet) return false;
    }
    if (!needle) return true;
    const haystack = [item.name, item.code, brandOf(item), item.description ?? "", ...specsOf(item, 6), ...listAttribute(item, ["tags", "标签"])].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function pricingOptionsFor(catalog: ClientCatalogResponse, itemId: string): ClientCatalogPricingGroup[] {
  return catalog.pricingGroups.filter((group) => group.enabled && group.memberItemGroupIds.includes(itemId));
}

/** 首选门店：第一个可领取的地点（没有能力信息时取第一个）。 */
export function primaryLocation(catalog: ClientCatalogResponse | undefined): ClientCatalogLocation | undefined {
  const locations = catalog?.locations ?? [];
  return locations.find((row) => !row.capabilities || row.capabilities.includes("pickup")) ?? locations[0];
}

/** 离用户最近、且可领取的门店；无位置或无坐标门店时返回 undefined（调用方退回 primaryLocation）。 */
export function nearestLocation(locations: ClientCatalogLocation[] | undefined, here: GeoPoint | undefined): ClientCatalogLocation | undefined {
  if (!here || !locations?.length) return undefined;
  let best: ClientCatalogLocation | undefined;
  let bestMeters = Infinity;
  for (const row of locations) {
    if (row.status !== "enabled") continue;
    if (row.capabilities && !row.capabilities.includes("pickup")) continue;
    if (typeof row.latitude !== "number" || typeof row.longitude !== "number") continue;
    const meters = distanceMeters(here, { latitude: row.latitude, longitude: row.longitude });
    if (meters !== undefined && meters < bestMeters) { bestMeters = meters; best = row; }
  }
  return best;
}

/** 逐张解析受保护图片；apply 在每张图就绪时回调（调用方负责核对上下文版本）。 */
export function hydrateImages(cards: ItemCard[], apply: (index: number, path: string) => void): void {
  cards.forEach((card, index) => {
    if (!card.imageSource || card.imagePath) return;
    resolveImage(card.imageSource).then((path) => {
      if (path) apply(index, path);
    });
  });
}
