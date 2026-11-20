/**
 * 员工扫码候选与本人历史。宿主供给同一会话、空间代次、原业务 API、术语与存储，
 * 候选返回和顺序读取前复验当前主体，业务授权与操作由真实员工运输和服务端裁定。
 */
import type { RentalAsset, RentalItemGroup, RentalOrder, RentalWorkOrder, RentalCategoryTerminology } from "../../src/contracts";
import type { createRentalStaffOrdersApi } from "./orders";
import type { createRentalStaffAssetsApi } from "./assets";
import type { createRentalStaffDirectoryApi } from "./directory";
import type { createRentalStaffWorkOrdersApi } from "./workOrders";

export type ScanKind = "order" | "asset" | "itemGroup" | "workOrder" | "unknown";

export interface ScanResult {
  kind: ScanKind;
  code: string;
  id: string;
  title: string;
  subtitle: string;
  /** 附加信息（状态、地点等），页面按 kind 展示。 */
  status?: string;
  locationName?: string;
  imageSource?: string;
  order?: RentalOrder;
  asset?: RentalAsset;
  itemGroup?: RentalItemGroup;
  workOrder?: RentalWorkOrder;
}

export interface ScanHistoryEntry {
  code: string;
  kind: ScanKind;
  id: string;
  title: string;
  subtitle: string;
  /** 扫码后执行的动作标签（出库/入库/绑定订单/查看），用于历史列表角标。 */
  action: string;
  imageSource?: string;
  at: number;
}

export interface RentalStaffScanPorts
  extends Pick<ReturnType<typeof createRentalStaffOrdersApi>, "listOrders">,
    Pick<ReturnType<typeof createRentalStaffAssetsApi>, "listAssets">,
    Pick<ReturnType<typeof createRentalStaffDirectoryApi>, "listItemGroups">,
    Pick<ReturnType<typeof createRentalStaffWorkOrdersApi>, "listWorkOrders"> {
  currentSession(): { tenant: { tenantId: string }; user: { id: string } } | undefined;
  currentWorkspaceId(): string;
  contextVersion(): number;
  staleContext(): Error;
  terms(): Pick<RentalCategoryTerminology, "assetLabel" | "itemGroupLabel" | "serialLabel">;
  scanHistoryStorageKey: string;
  readStorage<T>(key: string): T | undefined;
  writeStorage(key: string, value: unknown): void;
  now(): number;
}

export function createRentalStaffScan(ports: RentalStaffScanPorts) {
  const {
    currentSession, currentWorkspaceId, contextVersion, staleContext, terms,
    listOrders, listAssets, listItemGroups, listWorkOrders,
    scanHistoryStorageKey, readStorage, writeStorage, now,
  } = ports;

  const HISTORY_LIMIT = 50;
  let scanGeneration = 0;
  const resultOwnership = new WeakMap<ScanResult, () => void>();

  /** 使用同一工厂返回的原结果，在记历史、展示及导航前复验其原主体与调用代次。 */
  function assertCurrentResult(result: ScanResult): void {
    const assertCurrent = resultOwnership.get(result);
    if (!assertCurrent) throw staleContext();
    assertCurrent();
  }

  function historyKey(): string {
    const session = currentSession();
    return `${scanHistoryStorageKey}:${session?.tenant.tenantId ?? ""}:${session?.user.id ?? ""}`;
  }

  function scanHistory(): ScanHistoryEntry[] {
    return readStorage<ScanHistoryEntry[]>(historyKey()) ?? [];
  }

  function rememberScan(entry: Omit<ScanHistoryEntry, "at">): void {
    const rows = scanHistory().filter((row) => !(row.kind === entry.kind && row.id === entry.id));
    rows.unshift({ ...entry, at: now() });
    writeStorage(historyKey(), rows.slice(0, HISTORY_LIMIT));
  }

  function clearScanHistory(): void {
    writeStorage(historyKey(), []);
  }

  /** 解析码值里的显式对象引用；不是小程序码格式时返回 undefined。 */
  function parseDeepLink(code: string): { kind: ScanKind; id: string } | undefined {
    const match = /^rental-os:\/\/(order|asset|item-group|work-order)\/([A-Za-z0-9_-]+)/i.exec(code.trim());
    if (!match) return undefined;
    const referenceKind = match[1].toLowerCase();
    const kind: ScanKind = referenceKind === "order" ? "order" : referenceKind === "asset" ? "asset" : referenceKind === "item-group" ? "itemGroup" : "workOrder";
    return { kind, id: match[2] };
  }

  function normalize(text: string): string {
    return text.trim().toLowerCase();
  }

  /** 在当前空间内按编号查找对象。找不到返回 kind=unknown，由页面给出明确原因。 */
  async function resolveScan(code: string): Promise<ScanResult> {
    const generation = ++scanGeneration;
    const raw = code.trim();
    const session = currentSession();
    const tenantId = session?.tenant.tenantId;
    const userId = session?.user.id;
    const workspaceId = currentWorkspaceId();
    const version = contextVersion();

    // 普通候选读取失败仍按原顺序继续，主体变化则必须在下一次读取及字段投影前拒绝。
    function assertCurrent(): void {
      const current = currentSession();
      if (
        scanGeneration !== generation || contextVersion() !== version || currentWorkspaceId() !== workspaceId
        || current?.tenant.tenantId !== tenantId || current?.user.id !== userId
      ) {
        throw staleContext();
      }
    }

    const link = parseDeepLink(raw);
    const key = normalize(link?.id ?? raw);
    const unknown: ScanResult = { kind: "unknown", code: raw, id: "", title: "未识别的码", subtitle: `在当前经营空间未找到编号为 ${raw} 的订单、${terms().assetLabel}、${terms().itemGroupLabel}或工单` };
    resultOwnership.set(unknown, assertCurrent);
    if (!key || !workspaceId) {
      assertCurrent();
      return unknown;
    }

    const tryOrder = async (): Promise<ScanResult | undefined> => {
      assertCurrent();
      const orders = await listOrders({ keyword: link?.id ?? raw, pageSize: 20 }).catch(() => []);
      assertCurrent();
      const order = orders.find((row) => normalize(row.orderNo) === key || normalize(row.id) === key);
      if (!order) return undefined;
      return { kind: "order", code: raw, id: order.id, title: `订单 ${order.orderNo}`, subtitle: `${order.customerName} · ${order.lines.map((line) => line.itemGroupName).join("、")}`, status: order.status, locationName: order.fulfillmentLocationName, order };
    };
    const tryAsset = async (): Promise<ScanResult | undefined> => {
      assertCurrent();
      const assets = await listAssets().catch(() => []);
      assertCurrent();
      const asset = assets.find((row) => normalize(row.assetNo) === key || (row.serialNo && normalize(row.serialNo) === key) || normalize(row.id) === key);
      if (!asset) return undefined;
      return { kind: "asset", code: raw, id: asset.id, title: asset.itemGroupName, subtitle: asset.serialNo ? `${asset.assetNo} · ${terms().serialLabel} ${asset.serialNo}` : asset.assetNo, status: asset.status, locationName: asset.locationName, asset };
    };
    const tryItemGroup = async (): Promise<ScanResult | undefined> => {
      assertCurrent();
      const groups = await listItemGroups().catch(() => []);
      assertCurrent();
      const group = groups.find((row) => normalize(row.code) === key || normalize(row.id) === key);
      if (!group) return undefined;
      return { kind: "itemGroup", code: raw, id: group.id, title: group.name, subtitle: `型号编码 ${group.code}`, itemGroup: group };
    };
    const tryWorkOrder = async (): Promise<ScanResult | undefined> => {
      assertCurrent();
      const rows = await listWorkOrders().catch(() => []);
      assertCurrent();
      const workOrder = rows.find((row) => normalize(row.workNo) === key || normalize(row.id) === key);
      if (!workOrder) return undefined;
      return { kind: "workOrder", code: raw, id: workOrder.id, title: `工单 ${workOrder.workNo}`, subtitle: workOrder.reason, status: workOrder.status, workOrder };
    };

    const order: ScanKind[] = link ? [link.kind] : ["order", "asset", "itemGroup", "workOrder"];
    for (const kind of order) {
      const found = kind === "order" ? await tryOrder() : kind === "asset" ? await tryAsset() : kind === "itemGroup" ? await tryItemGroup() : await tryWorkOrder();
      assertCurrent();
      if (found) {
        resultOwnership.set(found, assertCurrent);
        return found;
      }
    }
    return unknown;
  }

  return { scanHistory, rememberScan, clearScanHistory, parseDeepLink, resolveScan, assertCurrentResult };
}
