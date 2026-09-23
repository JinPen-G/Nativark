import type { CancelRentalOrderRequest, CreateRentalInspectionRequest, CreateRentalOrderRequest, ManageRentalAllocationRequest, PartialReturnRentalOrderRequest, RentalAllocationCandidates, RentalInspectionRecord, RentalInspectionTemplate, RentalOperationLockRequest, RentalOrder, RentalOrderExtension, RentalOrderListQuery, RentalOrderPage, RentalQuoteRequest, RentalQuoteSnapshotV1 } from "@rental-os/shared";
import { request } from "../core/http";

/**
 * 订单与履约：列表/详情、配货、检查、交付/归还、以及处理层动作（确认/取消/爽约）。
 * 所有写动作都带幂等键或修订号；交接类动作附带操作锁令牌。
 */
const ORDERS = "/rental/v1/orders";
const orderPath = (orderId: string, suffix = "") => `${ORDERS}/${encodeURIComponent(orderId)}${suffix}`;

/** 不带分页参数时服务端返回纯数组；这里统一成数组，分页查询用 queryOrders。 */
export async function listOrders(query: RentalOrderListQuery = {}): Promise<RentalOrder[]> {
  const result = await request<RentalOrder[] | RentalOrderPage>(ORDERS, { query: { status: query.status, keyword: query.keyword, from: query.from, to: query.to, pendingFeeOnly: query.pendingFeeOnly } });
  return Array.isArray(result) ? result : result.items;
}

export function queryOrders(query: RentalOrderListQuery): Promise<RentalOrderPage> {
  return request<RentalOrderPage>(ORDERS, { query: { page: query.page ?? 1, pageSize: query.pageSize ?? 20, status: query.status, keyword: query.keyword, from: query.from, to: query.to, pendingFeeOnly: query.pendingFeeOnly } });
}

export function getOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId));
}

export function quoteOrder(input: RentalQuoteRequest): Promise<RentalQuoteSnapshotV1> {
  return request<RentalQuoteSnapshotV1>("/rental/v1/quotes", { method: "POST", data: input });
}

export function createOrder(input: CreateRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
  return request<RentalOrder>(ORDERS, { method: "POST", data: input, idempotencyKey });
}

/* ---------- 处理层：确认 / 取消 / 超时 / 爽约 ---------- */

export function confirmOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/confirm"), { method: "POST" });
}

export function cancelOrder(orderId: string, input: CancelRentalOrderRequest, idempotencyKey: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/cancel"), { method: "POST", data: input, idempotencyKey });
}

export function expirePendingOrder(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/expire-pending"), { method: "POST" });
}

export function markPickupOverdue(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/mark-pickup-overdue"), { method: "POST" });
}

export function sendNoShowNotice(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/no-show-notice"), { method: "POST" });
}

export function confirmNoShow(orderId: string, reason: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/confirm-no-show"), { method: "POST", data: { reason } });
}

export function resumePickup(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/resume-pickup"), { method: "POST" });
}

/* ---------- 配货 / 分配 / 操作锁 ---------- */

export function allocationCandidates(orderId: string): Promise<RentalAllocationCandidates> {
  return request<RentalAllocationCandidates>(orderPath(orderId, "/allocation-candidates"));
}

export function autoAllocate(orderId: string): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/allocate"), { method: "POST" });
}

export function manageAllocations(orderId: string, input: ManageRentalAllocationRequest): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/assignments"), { method: "POST", data: input });
}

export function operationLock(orderId: string, input: RentalOperationLockRequest): Promise<{ token?: string; expiresAt?: string; ownerName?: string } & Record<string, unknown>> {
  return request(orderPath(orderId, "/operation-lock"), { method: "POST", data: input });
}

/* ---------- 检查 / 交付 / 归还 ---------- */

export function listInspectionTemplates(stage?: "pickup" | "return"): Promise<RentalInspectionTemplate[]> {
  return request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { query: { stage } });
}

export function listInspections(orderId: string): Promise<RentalInspectionRecord[]> {
  return request<RentalInspectionRecord[]>(orderPath(orderId, "/inspections"));
}

/** 提交检查：领取检查完成即交付（服务端原子推进）；归还检查带 returnItems 为分批归还。 */
export function createInspection(orderId: string, input: CreateRentalInspectionRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<{ inspection: RentalInspectionRecord; order: RentalOrder }> {
  return request(orderPath(orderId, "/inspections"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

/** 无检查模板时的直接交接（服务端仍复核资金/资质/营业时段）。 */
export function handover(orderId: string, stage: "pickup" | "return", options: { idempotencyKey: string; operationToken?: string }): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, `/handover/${stage}`), { method: "POST", idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

export function partialReturn(orderId: string, input: PartialReturnRentalOrderRequest, options: { idempotencyKey: string; operationToken?: string }): Promise<RentalOrder> {
  return request<RentalOrder>(orderPath(orderId, "/partial-return"), { method: "POST", data: input, idempotencyKey: options.idempotencyKey, operationToken: options.operationToken });
}

export function listExtensions(orderId: string): Promise<RentalOrderExtension[]> {
  return request<RentalOrderExtension[]>(orderPath(orderId, "/extensions"));
}
