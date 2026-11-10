import type { RentalAttributeDefinition, RentalCategoryDefinition, RentalCategoryTerminology, RentalFulfillmentLocation, RentalFulfillmentMode, RentalInspectionFieldDefinition } from "@rental-os/shared";
import { listCategories, listLocations, sessionContext } from "../api/context";
import { Emitter } from "./events";
import { applySessionContext, contextVersion, currentWorkspace, currentWorkspaceId, sessionEvents } from "./session";
import { ApiError } from "./http";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 工作上下文：当前经营空间的品类术语、资产字段、检查字段、能力、履约地点与当前地点。
 *
 * 多品类兼容的落点在这里：页面**不写死**“设备/相机/SN/出库”这类词，而是读 `terms()`；
 * 术语来自当前空间的服务端品类定义（GET /rental/v1/categories）。未加载时用通用术语；
 * 实际刷新缺定义就拒绝，不以其他空间缓存或空字段替代。业务执行和新品类准入仍由 Core 决定。
 */
export interface Terminology extends RentalCategoryTerminology {
  /** 资产集合的行业称呼（车队/库存）。 */
  collectionLabel: string;
  /** 序列号的行业称呼（序列号/批次号/车架号）；缺省回退“序列号”。 */
  serialLabel: string;
}

export interface WorkspaceContext {
  workspaceId: string;
  categoryCode: string;
  categoryName: string;
  terminology: Terminology;
  /** 品类声明的属性字段（资产详情与新建资产表单按此动态渲染）。 */
  assetFields: RentalAttributeDefinition[];
  /** 品类默认检查字段（无服务端模板时的兜底展示）。 */
  inspectionFields: RentalInspectionFieldDefinition[];
  capabilities: string[];
  fulfillmentModes: RentalFulfillmentMode[];
  /** 配送/上门类目的地：customer_address＝送到客户收货地址（需收地址快照）；tenant_location＝送到门店/据点（车辆）。 */
  deliveryDestination?: "customer_address" | "tenant_location";
  locations: RentalFulfillmentLocation[];
  /** 当前选中的履约地点；"" 表示“我有权限的全部地点”。 */
  currentLocationId: string;
  loadedAt: number;
}

/** 未知品类的通用术语：只描述“租出去的东西”，不带任何行业词。 */
const GENERIC_TERMS: Terminology = {
  itemLabel: "物品",
  itemGroupLabel: "型号",
  assetLabel: "物品",
  fulfillmentLabel: "门店",
  pickupLabel: "领取",
  returnLabel: "归还",
  identifierLabel: "编号",
  serialLabel: "序列号",
  collectionLabel: "库存"
};

export const contextEvents = new Emitter<WorkspaceContext>();

let cached: WorkspaceContext | undefined;
let inflight: Promise<WorkspaceContext> | undefined;
let generation = 0;
let cachedVersion = 0;

sessionEvents.on((event) => {
  if (event.type === "signed-out" || event.type === "workspace-changed" || event.type === "signed-in") {
    generation += 1;
    cached = undefined;
    inflight = undefined;
  }
});

export function cachedContext(): WorkspaceContext | undefined {
  const workspaceId = currentWorkspaceId();
  return cached && cached.workspaceId === workspaceId && cachedVersion === contextVersion() ? cached : undefined;
}

/** 当前术语；上下文未加载时按会话里的品类给一个合理兜底，避免页面闪“物品”。 */
export function terms(): Terminology {
  return cachedContext()?.terminology ?? GENERIC_TERMS;
}

function toTerminology(definition: RentalCategoryDefinition | undefined): Terminology {
  if (!definition) return GENERIC_TERMS;
  const t = definition.terminology;
  return { ...t, collectionLabel: t.assetCollectionLabel ?? "库存", serialLabel: t.serialLabel ?? "序列号" };
}

function readLocationChoice(workspaceId: string): string {
  const map = readStorage<Record<string, string>>(STORAGE_KEYS.locationByWorkspace) ?? {};
  return map[workspaceId] ?? "";
}

/** 加载（或复用）当前空间的上下文。force=true 时重新拉取会话上下文与地点列表。 */
export function loadContext(force = false): Promise<WorkspaceContext> {
  const existing = cachedContext();
  if (existing && !force) return Promise.resolve(existing);
  if (inflight && !force) return inflight;
  const startVersion = contextVersion();
  const startGeneration = ++generation;
  const owns = () => contextVersion() === startVersion && generation === startGeneration;
  const assertOwner = () => { if (!owns()) throw new ApiError("STALE_CONTEXT", "经营空间或账号已切换，该上下文已作废"); };
  const promise = (async () => {
    const [session, categories, locations] = await Promise.all([
      sessionContext().then((context) => {
        // Guard before applying permissions: a tenant-scoped late response must not replace the new identity.
        assertOwner();
        applySessionContext(context);
        return context;
      }),
      listCategories(),
      listLocations().catch(() => [] as RentalFulfillmentLocation[])
    ]);
    assertOwner();
    const workspaceId = currentWorkspaceId();
    const workspace = currentWorkspace();
    const categoryCode = workspace?.categoryCode ?? session.tenant.categoryCode ?? "";
    const definition = categories.find((row) => row.code === categoryCode);
    if (!definition) throw new Error("当前空间的品类定义缺失，请重新读取上下文或联系管理员");
    const enabledLocations = locations.filter((row) => row.status === "enabled");
    const saved = readLocationChoice(workspaceId);
    const context: WorkspaceContext = {
      workspaceId,
      categoryCode,
      categoryName: definition.name,
      terminology: toTerminology(definition),
      assetFields: definition.businessModel.assetFields,
      inspectionFields: definition.businessModel.defaults.inspectionFields,
      capabilities: (session.tenant.capabilities ?? []) as string[],
      fulfillmentModes: definition.businessModel.fulfillmentModes,
      deliveryDestination: definition.businessModel.deliveryDestination,
      locations: enabledLocations,
      currentLocationId: enabledLocations.some((row) => row.id === saved) ? saved : "",
      loadedAt: Date.now()
    };
    assertOwner();
    cached = context;
    cachedVersion = startVersion;
    contextEvents.emit(context);
    return context;
  })().finally(() => {
    if (owns()) inflight = undefined;
  });
  inflight = promise;
  return promise;
}

/** 设置当前履约地点（"" = 全部）；只影响本机列表筛选，不改变服务端范围。 */
export function setCurrentLocation(locationId: string): void {
  const context = cachedContext();
  if (!context) return;
  const map = readStorage<Record<string, string>>(STORAGE_KEYS.locationByWorkspace) ?? {};
  map[context.workspaceId] = locationId;
  writeStorage(STORAGE_KEYS.locationByWorkspace, map);
  cached = { ...context, currentLocationId: locationId };
  contextEvents.emit(cached);
}

export function currentLocation(): RentalFulfillmentLocation | undefined {
  const context = cachedContext();
  if (!context || !context.currentLocationId) return undefined;
  return context.locations.find((row) => row.id === context.currentLocationId);
}

/** 当前地点显示名：未选时显示“全部{门店术语}”。 */
export function currentLocationLabel(): string {
  const context = cachedContext();
  const location = currentLocation();
  if (location) return location.name;
  return `全部${context?.terminology.fulfillmentLabel ?? GENERIC_TERMS.fulfillmentLabel}`;
}

/** 某条记录是否落在当前地点范围内（未选地点即全部命中）。 */
export function inCurrentLocation(...locationIds: Array<string | undefined>): boolean {
  const current = cachedContext()?.currentLocationId;
  if (!current) return true;
  return locationIds.some((id) => id === current);
}

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

/** 仅供测试。 */
export function resetContextForTest(): void {
  generation += 1;
  cachedVersion = 0;
  cached = undefined;
  inflight = undefined;
}
