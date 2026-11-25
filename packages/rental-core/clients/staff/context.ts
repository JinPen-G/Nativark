/**
 * 员工经营空间上下文。宿主供给同一会话代次、权限应用、事件与存储，
 * 品类、字段、能力和地点沿真实业务读取，旧代次在应用会话权限前拒绝。
 */
import type { RentalAttributeDefinition, RentalCategoryDefinition, RentalCategoryTerminology, RentalFulfillmentLocation, RentalFulfillmentMode, RentalInspectionFieldDefinition } from "../../src/contracts";
import type { SessionContextResponse } from "../../src/auth-contracts";
import type { createRentalStaffDirectoryApi } from "./directory";

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

export interface RentalStaffContextPorts
  extends Pick<ReturnType<typeof createRentalStaffDirectoryApi>, "listCategories" | "listLocations"> {
  sessionContext(): Promise<SessionContextResponse>;
  currentWorkspace(): { categoryCode: string } | undefined;
  currentWorkspaceId(): string;
  contextVersion(): number;
  applySessionContext(context: SessionContextResponse): unknown;
  onSessionEvent(listener: (event: { type: string }) => void): () => void;
  contextEvents: { emit(context: WorkspaceContext): void };
  staleContext(): Error;
  locationStorageKey: string;
  readStorage<T>(key: string): T | undefined;
  writeStorage(key: string, value: unknown): void;
  now(): number;
}

export function createRentalStaffContext(ports: RentalStaffContextPorts) {
  const {
    sessionContext, listCategories, listLocations, currentWorkspace, currentWorkspaceId,
    contextVersion, applySessionContext, onSessionEvent, contextEvents, staleContext,
    locationStorageKey, readStorage, writeStorage, now,
  } = ports;

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

  let cached: WorkspaceContext | undefined;
  let inflight: Promise<WorkspaceContext> | undefined;
  let generation = 0;
  let cachedVersion = 0;

  let disposed = false;

  function invalidateContext(): void {
    generation += 1;
    cachedVersion = 0;
    cached = undefined;
    inflight = undefined;
  }

  function handleSessionEvent(event: { type: string }): void {
    if (event.type === "signed-out" || event.type === "workspace-changed" || event.type === "signed-in") {
      invalidateContext();
    }
  }

  let offSession = onSessionEvent(handleSessionEvent);

  function cachedContext(): WorkspaceContext | undefined {
    const workspaceId = currentWorkspaceId();
    return cached && cached.workspaceId === workspaceId && cachedVersion === contextVersion() ? cached : undefined;
  }

  /** 当前术语，未加载前沿原通用术语展示。 */
  function terms(): Terminology {
    return cachedContext()?.terminology ?? GENERIC_TERMS;
  }

  function toTerminology(definition: RentalCategoryDefinition | undefined): Terminology {
    if (!definition) return GENERIC_TERMS;
    const t = definition.terminology;
    return { ...t, collectionLabel: t.assetCollectionLabel ?? "库存", serialLabel: t.serialLabel ?? "序列号" };
  }

  function readLocationChoice(workspaceId: string): string {
    const map = readStorage<Record<string, string>>(locationStorageKey) ?? {};
    return map[workspaceId] ?? "";
  }

  /** 加载（或复用）当前空间的上下文。force=true 时重新拉取会话上下文与地点列表。 */
  function loadContext(force = false): Promise<WorkspaceContext> {
    if (disposed) return Promise.reject(staleContext());
    const existing = cachedContext();
    if (existing && !force) return Promise.resolve(existing);
    if (inflight && !force) return inflight;
    const startVersion = contextVersion();
    const startGeneration = ++generation;
    const owns = () => !disposed && contextVersion() === startVersion && generation === startGeneration;
    const assertOwner = () => { if (!owns()) throw staleContext(); };
    const promise = (async () => {
      const [session, categories, locations] = await Promise.all([
        sessionContext().then((context) => {
          // 会话读取按租户范围返回，应用权限前须确认原空间与本人代次仍有效。
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
      const locationScope = session.locationScope;
      const enabledLocations = locations.filter((row) => row.status === "enabled"
        && (locationScope?.mode !== "selected" || locationScope.locationIds.includes(row.id)));
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
        loadedAt: now()
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
  function setCurrentLocation(locationId: string): void {
    const context = cachedContext();
    if (!context) return;
    if (locationId && !context.locations.some((row) => row.id === locationId && row.status === "enabled")) return;
    const map = readStorage<Record<string, string>>(locationStorageKey) ?? {};
    map[context.workspaceId] = locationId;
    writeStorage(locationStorageKey, map);
    cached = { ...context, currentLocationId: locationId };
    contextEvents.emit(cached);
  }

  function currentLocation(): RentalFulfillmentLocation | undefined {
    const context = cachedContext();
    if (!context || !context.currentLocationId) return undefined;
    return context.locations.find((row) => row.id === context.currentLocationId);
  }

  /** 当前地点显示名：未选时显示“全部{门店术语}”。 */
  function currentLocationLabel(): string {
    const context = cachedContext();
    const location = currentLocation();
    if (location) return location.name;
    return `全部${context?.terminology.fulfillmentLabel ?? GENERIC_TERMS.fulfillmentLabel}`;
  }

  /** 某条记录是否落在当前地点范围内（未选地点即全部命中）。 */
  function inCurrentLocation(...locationIds: Array<string | undefined>): boolean {
    const current = cachedContext()?.currentLocationId;
    if (!current) return true;
    return locationIds.some((id) => id === current);
  }

  /** 重置原测试入口，释放旧订阅后只重绑本实例的一条会话订阅。 */
  function resetContextForTest(): void {
    if (disposed) return;
    offSession();
    invalidateContext();
    offSession = onSessionEvent(handleSessionEvent);
  }

  /** 宿主卸载本实例时释放自己的订阅，并作废尚未返回的上下文读取。 */
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    offSession();
    invalidateContext();
  }

  return {
    cachedContext, terms, loadContext, setCurrentLocation, currentLocation,
    currentLocationLabel, inCurrentLocation, resetContextForTest, dispose,
  };
}
