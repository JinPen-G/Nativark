import type { RentalCarrierShipmentEventType } from "@rental-os/shared";

export interface CarrierShipmentTimelineFact {
  type: RentalCarrierShipmentEventType;
  occurredAt: string | Date;
}

export interface CarrierShipmentEventAttempt {
  mode: string;
  orderStatus: string;
  eventType: RentalCarrierShipmentEventType;
  occurredAt: string | Date;
  events: CarrierShipmentTimelineFact[];
  now?: string | Date;
}

const timestamp = (value: string | Date) => value instanceof Date ? value.getTime() : Date.parse(value);

/** 签收和仓库验收分别与取还检查/库存事务原子落库，不允许从普通时间线入口预写。 */
export function canRecordCarrierShipmentEventDirectly(type: RentalCarrierShipmentEventType): boolean {
  return type === "outbound_dispatched" || type === "customer_handoff";
}

/** 在运单已发出、仓库尚未实物验收期间，订单继续占用库存，禁止任何释放/改配写入。 */
export function carrierShipmentInventoryMutationBlocked(events: Array<{ type: string }>): boolean {
  return events.some((event) => event.type === "outbound_dispatched")
    && !events.some((event) => event.type === "warehouse_received");
}

/**
 * After shifting a shipped rental to its real signature time, ensure its locked assets do not
 * consume the last units promised to later, not-yet-allocated orders.
 */
export function carrierSerializedCapacityConflict(input: {
  eligibleAssetIds: string[];
  currentOrderAssetIds: string[];
  overlappingReservations: Array<{ quantity: number; assetIds?: string[] }>;
}): boolean {
  const committedElsewhere = new Set(input.currentOrderAssetIds);
  let unassignedDemand = 0;
  for (const reservation of input.overlappingReservations) {
    const assigned = new Set(reservation.assetIds ?? []);
    for (const assetId of assigned) {
      if (committedElsewhere.has(assetId)) return true;
      committedElsewhere.add(assetId);
    }
    unassignedDemand += Math.max(0, reservation.quantity - assigned.size);
  }
  const alternatives = input.eligibleAssetIds.filter((assetId) => !committedElsewhere.has(assetId)).length;
  return alternatives < unassignedDemand;
}

export interface CarrierRentalOrderWindow {
  fulfillmentMode: string;
  startAt: string | Date;
  endAt: string | Date;
  effectiveEndAt?: string | Date | null;
  actualRentalStartAt?: string | Date | null;
  carrierRentalDueAt?: string | Date | null;
}

/** 所有逾期、资源占用和续租入口共用的当前归还时点。 */
export function rentalOrderDueAt(order: CarrierRentalOrderWindow): string {
  if (order.fulfillmentMode === "carrier_shipping") {
    if (order.carrierRentalDueAt) {
      const dueAt = timestamp(order.carrierRentalDueAt);
      if (Number.isFinite(dueAt)) return new Date(dueAt).toISOString();
    }
    if (order.actualRentalStartAt) {
      const actualStart = timestamp(order.actualRentalStartAt);
      const bookedStart = timestamp(order.startAt);
      const bookedDue = timestamp(order.effectiveEndAt ?? order.endAt);
      if (Number.isFinite(actualStart) && Number.isFinite(bookedStart) && Number.isFinite(bookedDue) && bookedDue > bookedStart) {
        return new Date(actualStart + bookedDue - bookedStart).toISOString();
      }
    }
  }
  const fallback = timestamp(order.effectiveEndAt ?? order.endAt);
  if (!Number.isFinite(fallback)) throw new Error("订单约定归还时间无效，需人工核对");
  return new Date(fallback).toISOString();
}

/** 首次客户签收将预约时长平移到真实起租时点；仅能在尚未起租时调用。 */
export function shiftedCarrierDueAt(order: CarrierRentalOrderWindow, actualStartAt: string | Date): string | undefined {
  const actualStart = timestamp(actualStartAt);
  const bookedStart = timestamp(order.startAt);
  const bookedDue = timestamp(order.effectiveEndAt ?? order.endAt);
  if (order.fulfillmentMode !== "carrier_shipping" || order.actualRentalStartAt || !Number.isFinite(actualStart)
    || !Number.isFinite(bookedStart) || !Number.isFinite(bookedDue) || bookedDue <= bookedStart) return undefined;
  return new Date(actualStart + bookedDue - bookedStart).toISOString();
}

/**
 * SHIP-01：纯时间线闸门。记录事件前检查订单状态与前序里程碑，避免用乱序/重复时间
 * 自动起租、止租或提前释放在途资源。
 */
export function carrierShipmentEventError(input: CarrierShipmentEventAttempt): string | undefined {
  if (input.mode !== "carrier_shipping") return "只有承运寄送订单可以登记承运里程碑";
  const occurredAt = timestamp(input.occurredAt);
  const now = timestamp(input.now ?? new Date());
  if (!Number.isFinite(occurredAt)) return "里程碑发生时间无效";
  if (!Number.isFinite(now) || occurredAt > now) return "里程碑发生时间不能晚于当前时间";

  const events = [...input.events].sort((a, b) => timestamp(a.occurredAt) - timestamp(b.occurredAt));
  if (events.some((row) => !Number.isFinite(timestamp(row.occurredAt)))) return "已有承运时间线包含无效时间，必须先人工核对";
  const first = (type: RentalCarrierShipmentEventType) => events.find((row) => row.type === type);
  const duplicate = (type: RentalCarrierShipmentEventType) => events.some((row) => row.type === type);

  if (input.eventType === "outbound_dispatched") {
    if (input.orderStatus !== "ready_for_pickup") return "只有已完成配货、待交承运商的订单才能登记发出";
    if (events.length || duplicate("outbound_dispatched")) return "运单发出只能登记一次，且必须是首个承运里程碑";
    return undefined;
  }

  const dispatched = first("outbound_dispatched");
  if (!dispatched) return "缺少已登记的出库发运运单";
  const dispatchedAt = timestamp(dispatched.occurredAt);
  if (occurredAt < dispatchedAt) return "里程碑时间不能早于运单发出时间";

  if (input.eventType === "customer_signed") {
    if (input.orderStatus !== "ready_for_pickup") return "只有待领取订单可以登记客户签收";
    if (duplicate("customer_signed")) return "客户签收只能登记一次";
    return undefined;
  }

  const signed = first("customer_signed");
  if (!signed) return "缺少已核实的客户签收时间，不能登记交寄或仓库验收";
  const signedAt = timestamp(signed.occurredAt);
  if (occurredAt < signedAt) return "后续里程碑时间不能早于客户签收时间";

  if (input.eventType === "customer_handoff") {
    if (input.orderStatus !== "renting") return "只有租赁中的订单可以登记客户交寄";
    if (duplicate("customer_handoff")) return "客户交寄只能登记一次";
    return undefined;
  }

  const handoff = first("customer_handoff");
  if (!handoff) return "缺少已核实的客户交寄与揽收凭证";
  if (input.orderStatus !== "renting") return "仓库验收只能发生在订单实物归还前";
  if (occurredAt < timestamp(handoff.occurredAt)) return "仓库验收时间不能早于客户交寄时间";
  if (duplicate("warehouse_received")) return "仓库验收只能登记一次";
  return undefined;
}

/** 客户交寄后承运时延不计租；仍未签收前也不开始计租。 */
export function carrierBillableWindow(input: {
  signedAt: string | Date;
  handoffAt: string | Date;
}): { startAt: string; endAt: string } | undefined {
  const startMs = timestamp(input.signedAt);
  const endMs = timestamp(input.handoffAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return undefined;
  return { startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString() };
}
