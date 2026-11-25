/** 员工订单卡片的原字段投影与脱敏。标签和媒体路径沿同一宿主实例，
 * 时间使用同源 Core 工具，图片下载、身份及媒体访问校验由原宿主处理。 */
import type { RentalItemGroup, RentalOrder } from "@rental-os/shared";
import type { createRentalStaffLabels, Tone } from "./labels";
import type { createRentalStaffDirectoryApi } from "./directory";
import { formatBusinessDate, formatBusinessDateTime } from "../time";

export interface OrderCard {
  id: string;
  orderNo: string;
  status: string;
  statusLabel: string;
  statusTone: Tone;
  customerName: string;
  phoneMasked: string;
  /** 首行型号名（缩略图与标题）。 */
  primaryItemName: string;
  primaryItemGroupId: string;
  itemsSummary: string;
  totalQuantity: number;
  periodText: string;
  startAtText: string;
  locationName: string;
  locationId: string;
  returnLocationId?: string;
  fulfillmentMode: string;
  imageSource: string;
  imagePath: string;
  amount: number;
  currency: string;
  endAt: string;
  effectiveEndAt?: string;
}

export interface RentalStaffPresentersPorts {
  labels: Pick<ReturnType<typeof createRentalStaffLabels>, "orderStatusLabel" | "orderStatusTone">;
  media: Pick<ReturnType<typeof createRentalStaffDirectoryApi>, "itemGroupImagePath">;
}

export function createRentalStaffPresenters(ports: RentalStaffPresentersPorts) {
  const { orderStatusLabel, orderStatusTone } = ports.labels;
  const { itemGroupImagePath } = ports.media;
  /**
   * 列表卡片视图模型：把服务端订单/资产投影成页面直接绑定的字段。
   * 客户手机号在此脱敏（服务端返回的是运营视角明文；员工端只显示尾号）。
   */
  function maskPhone(phone: string | undefined): string {
    if (!phone) return "";
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
    return `${phone.slice(0, 1)}***`;
  }



  /** 型号封面图的受保护路径（由 core/images 带令牌下载）。 */
  function itemGroupCover(group: RentalItemGroup | undefined): string {
    if (!group?.images?.length) return "";
    const cover = group.images.find((row) => row.isCover) ?? group.images[0];
    return cover.url || itemGroupImagePath(group.id, cover.id);
  }

  function orderCardOf(order: RentalOrder, timeZone: string, groups: Map<string, RentalItemGroup> = new Map()): OrderCard {
    const lines = order.lines ?? [];
    const first = lines[0];
    const totalQuantity = lines.reduce((sum, line) => sum + (line.quantity - (line.cancelledQuantity ?? 0)), 0);
    const names = lines.map((line) => line.itemGroupName);
    const group = first ? groups.get(first.itemGroupId) : undefined;
    const sameDay = formatBusinessDate(order.startAt, timeZone) === formatBusinessDate(order.effectiveEndAt ?? order.endAt, timeZone);
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      statusLabel: orderStatusLabel(order.status),
      statusTone: orderStatusTone(order.status),
      customerName: order.customerName,
      phoneMasked: maskPhone(order.contactPhone),
      primaryItemName: first?.itemGroupName ?? "",
      primaryItemGroupId: first?.itemGroupId ?? "",
      itemsSummary: names.length > 1 ? `${names[0]} 等 ${names.length} 种` : names[0] ?? "",
      totalQuantity,
      periodText: sameDay
        ? `${formatBusinessDateTime(order.startAt, timeZone)} ~ ${formatBusinessDateTime(order.effectiveEndAt ?? order.endAt, timeZone).slice(-5)}`
        : `${formatBusinessDate(order.startAt, timeZone)} ~ ${formatBusinessDate(order.effectiveEndAt ?? order.endAt, timeZone)}`,
      startAtText: formatBusinessDateTime(order.startAt, timeZone),
      locationName: order.fulfillmentLocationName,
      locationId: order.fulfillmentLocationId,
      returnLocationId: order.returnLocationId,
      fulfillmentMode: order.fulfillmentMode,
      imageSource: itemGroupCover(group),
      imagePath: "",
      amount: order.finalPayableAmount ?? order.payableAmount,
      currency: order.currency ?? "",
      endAt: order.endAt,
      effectiveEndAt: order.effectiveEndAt
    };
  }

  /** 把型号列表转成 id → 型号 的索引。 */
  function indexItemGroups(groups: RentalItemGroup[]): Map<string, RentalItemGroup> {
    const map = new Map<string, RentalItemGroup>();
    for (const group of groups) map.set(group.id, group);
    return map;
  }

  /** 首字（头像占位）。 */
  function initialOf(name: string | undefined): string {
    return (name ?? "").trim().charAt(0) || "·";
  }

  /** 相对时间：今天 HH:mm / 昨天 / M-D。 */
  function relativeDay(iso: string, timeZone: string): string {
    const today = formatBusinessDate(new Date().toISOString(), timeZone);
    const day = formatBusinessDate(iso, timeZone);
    if (day === today) return `今天 ${formatBusinessDateTime(iso, timeZone).slice(-5)}`;
    return formatBusinessDateTime(iso, timeZone);
  }
  return { maskPhone, itemGroupCover, orderCardOf, indexItemGroups, initialOf, relativeDay };
}
