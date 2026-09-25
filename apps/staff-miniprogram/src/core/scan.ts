import type { RentalAsset, RentalItemGroup, RentalOrder, RentalWorkOrder } from "@rental-os/shared";
import { listAssets } from "../api/assets";
import { listItemGroups } from "../api/context";
import { listOrders } from "../api/orders";
import { listWorkOrders } from "../api/workOrders";
import { currentSession, currentWorkspaceId } from "./session";
import { terms } from "./context";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 扫码：码值只用于定位候选对象，最终仍由服务端按租户、空间、状态和权限校验。
 * 第一阶段没有服务端解析接口，客户端按“订单号 → 资产编号/序列号 → 型号编码 → 工单号”顺序在授权范围内查找。
 * 支持的码：纯文本编号，或形如 `rental-os://order/<id>` / `rental-os://asset/<id>` 的小程序码内容。
 */
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

const HISTORY_LIMIT = 50;

function historyKey(): string {
  const session = currentSession();
  return `${STORAGE_KEYS.scanHistory}:${session?.tenant.tenantId ?? ""}:${session?.user.id ?? ""}`;
}

export function scanHistory(): ScanHistoryEntry[] {
  return readStorage<ScanHistoryEntry[]>(historyKey()) ?? [];
}

export function rememberScan(entry: Omit<ScanHistoryEntry, "at">): void {
  const rows = scanHistory().filter((row) => !(row.kind === entry.kind && row.id === entry.id));
  rows.unshift({ ...entry, at: Date.now() });
  writeStorage(historyKey(), rows.slice(0, HISTORY_LIMIT));
}

export function clearScanHistory(): void {
  writeStorage(historyKey(), []);
}

/** 解析码值里的显式对象引用；不是小程序码格式时返回 undefined。 */
export function parseDeepLink(code: string): { kind: ScanKind; id: string } | undefined {
  const match = /^rental-os:\/\/(order|asset|item-group|work-order)\/([A-Za-z0-9_-]+)/i.exec(code.trim());
  if (!match) return undefined;
  const kind: ScanKind = match[1] === "order" ? "order" : match[1] === "asset" ? "asset" : match[1] === "item-group" ? "itemGroup" : "workOrder";
  return { kind, id: match[2] };
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** 在当前空间内按编号查找对象。找不到返回 kind=unknown，由页面给出明确原因。 */
export async function resolveScan(code: string): Promise<ScanResult> {
  const raw = code.trim();
  const workspaceId = currentWorkspaceId();
  const link = parseDeepLink(raw);
  const key = normalize(link?.id ?? raw);
  const unknown: ScanResult = { kind: "unknown", code: raw, id: "", title: "未识别的码", subtitle: `在当前经营空间未找到编号为 ${raw} 的订单、${terms().assetLabel}、${terms().itemGroupLabel}或工单` };
  if (!key || !workspaceId) return unknown;

  const tryOrder = async (): Promise<ScanResult | undefined> => {
    const orders = await listOrders({ keyword: link?.id ?? raw, pageSize: 20 }).catch(() => []);
    const order = orders.find((row) => normalize(row.orderNo) === key || normalize(row.id) === key);
    if (!order) return undefined;
    return { kind: "order", code: raw, id: order.id, title: `订单 ${order.orderNo}`, subtitle: `${order.customerName} · ${order.lines.map((line) => line.itemGroupName).join("、")}`, status: order.status, locationName: order.fulfillmentLocationName, order };
  };
  const tryAsset = async (): Promise<ScanResult | undefined> => {
    const assets = await listAssets().catch(() => []);
    const asset = assets.find((row) => normalize(row.assetNo) === key || (row.serialNo && normalize(row.serialNo) === key) || normalize(row.id) === key);
    if (!asset) return undefined;
    return { kind: "asset", code: raw, id: asset.id, title: asset.itemGroupName, subtitle: asset.serialNo ? `${asset.assetNo} · ${terms().serialLabel} ${asset.serialNo}` : asset.assetNo, status: asset.status, locationName: asset.locationName, asset };
  };
  const tryItemGroup = async (): Promise<ScanResult | undefined> => {
    const groups = await listItemGroups().catch(() => []);
    const group = groups.find((row) => normalize(row.code) === key || normalize(row.id) === key);
    if (!group) return undefined;
    return { kind: "itemGroup", code: raw, id: group.id, title: group.name, subtitle: `型号编码 ${group.code}`, itemGroup: group };
  };
  const tryWorkOrder = async (): Promise<ScanResult | undefined> => {
    const rows = await listWorkOrders().catch(() => []);
    const workOrder = rows.find((row) => normalize(row.workNo) === key || normalize(row.id) === key);
    if (!workOrder) return undefined;
    return { kind: "workOrder", code: raw, id: workOrder.id, title: `工单 ${workOrder.workNo}`, subtitle: workOrder.reason, status: workOrder.status, workOrder };
  };

  const order: ScanKind[] = link ? [link.kind] : ["order", "asset", "itemGroup", "workOrder"];
  for (const kind of order) {
    const found = kind === "order" ? await tryOrder() : kind === "asset" ? await tryAsset() : kind === "itemGroup" ? await tryItemGroup() : await tryWorkOrder();
    if (found) return found;
  }
  return unknown;
}
