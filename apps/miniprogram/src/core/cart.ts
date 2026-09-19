import { serverNow } from "./clock";
import { Emitter } from "./events";
import { newKey } from "./keys";
import { sessionEvents } from "./session";
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from "./storage";

/**
 * 本次租赁清单（需求 §6.4）：一次订单的临时清单，不是长期购物车。
 *
 * 硬规则：
 * - 只属于一个服务（经营空间）。往清单里加另一个服务的商品必须先清空——由调用方经用户确认后执行，这里只拒绝。
 * - 同一商品 + 同一租赁选项合并数量。
 * - 每次修改 revision +1；报价绑定生成时的 revision，任何修改后旧报价作废。
 * - 提交：生成稳定的幂等键并持久化；结果未知期间禁止修改清单，只能用同键查询/重放；
 *   明确成功后清空，明确失败（服务端未创建）后释放键允许继续修改。
 */
export interface CartLine {
  /** itemGroupId + pricingGroupId 组成的稳定键。 */
  key: string;
  itemGroupId: string;
  itemName: string;
  pricingGroupId?: string;
  pricingGroupName?: string;
  inventoryMode?: string;
  /** 目录图片地址（受保护路径），确认页据此显示缩略图。 */
  imageSource?: string;
  quantity: number;
}

export interface CartServiceSelection {
  serviceId: string;
  name: string;
  quantity: number;
}

export interface CartSubmission {
  key: string;
  quoteId: string;
  status: "pending" | "unknown";
  startedAt: number;
}

export interface CartState {
  serviceCode: string;
  serviceName: string;
  revision: number;
  lines: CartLine[];
  startAt?: string;
  endAt?: string;
  fulfillmentMode: string;
  locationId?: string;
  locationName?: string;
  returnLocationId?: string;
  returnLocationName?: string;
  /** 配送履约方式下的本人地址簿地址（MP-06）；快照在报价时由服务端固化。 */
  deliveryAddressId?: string;
  deliveryAddressLabel?: string;
  couponId?: string;
  services: CartServiceSelection[];
  /** 备注（写入每个商品行的 note）。 */
  memo?: string;
  quote?: { id: string; revision: number; expiresAt: string };
  submission?: CartSubmission;
  updatedAt: number;
}

/** 需要送到本人地址的履约方式；其余为到店/取货点自取。 */
export const DELIVERY_FULFILLMENT_MODES = ["delivery", "onsite_delivery"] as const;

export function isDeliveryMode(mode: string | undefined): boolean {
  return mode === "delivery" || mode === "onsite_delivery";
}

export type CartEvent = { type: "changed"; cart: CartState | undefined };
export const cartEvents = new Emitter<CartEvent>();

export class CartServiceMismatch extends Error {
  constructor(readonly currentServiceCode: string, readonly currentServiceName: string) {
    super("清单中已有另一服务的商品");
    this.name = "CartServiceMismatch";
  }
}

export class CartLocked extends Error {
  constructor() {
    super("上一次提交的结果尚未确认，请先查询原提交结果，再修改租赁内容");
    this.name = "CartLocked";
  }
}

let cached: CartState | undefined;
let loaded = false;

// 退出登录/会话失效时存储已被清空；内存缓存必须同步失效，否则下一个登录者会看到上一个人的清单。
sessionEvents.on((event) => {
  if (event.type === "signed-out") {
    cached = undefined;
    loaded = true;
    cartEvents.emit({ type: "changed", cart: undefined });
  }
});

function load(): CartState | undefined {
  if (!loaded) {
    loaded = true;
    cached = readStorage<CartState>(STORAGE_KEYS.cart);
  }
  return cached;
}

function save(next: CartState | undefined): void {
  cached = next;
  if (next) writeStorage(STORAGE_KEYS.cart, next);
  else removeStorage(STORAGE_KEYS.cart);
  cartEvents.emit({ type: "changed", cart: next });
}

export function getCart(): CartState | undefined {
  return load();
}

export function cartLineCount(): number {
  return (load()?.lines ?? []).reduce((sum, line) => sum + line.quantity, 0);
}

export function cartLocked(): boolean {
  return Boolean(load()?.submission);
}

function emptyCart(serviceCode: string, serviceName: string): CartState {
  return {
    serviceCode,
    serviceName,
    revision: 1,
    lines: [],
    fulfillmentMode: "store_pickup_return",
    services: [],
    updatedAt: Date.now()
  };
}

function assertEditable(cart: CartState | undefined): void {
  if (cart?.submission) throw new CartLocked();
}

/** 对清单做一次修改：revision +1，旧报价作废。 */
export function updateCart(serviceCode: string, serviceName: string, mutate: (draft: CartState) => void): CartState {
  const current = load();
  assertEditable(current);
  if (current && current.lines.length > 0 && current.serviceCode !== serviceCode) {
    throw new CartServiceMismatch(current.serviceCode, current.serviceName);
  }
  const draft: CartState = current && current.serviceCode === serviceCode ? { ...current, lines: current.lines.map((line) => ({ ...line })), services: current.services.map((row) => ({ ...row })) } : emptyCart(serviceCode, serviceName);
  mutate(draft);
  draft.revision += 1;
  draft.quote = undefined;
  draft.updatedAt = Date.now();
  save(draft);
  return draft;
}

export function lineKey(itemGroupId: string, pricingGroupId?: string): string {
  return pricingGroupId ? `${itemGroupId}@${pricingGroupId}` : itemGroupId;
}

export function addLine(serviceCode: string, serviceName: string, line: Omit<CartLine, "key" | "quantity">, quantity: number): CartState {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("数量必须是不小于 1 的整数");
  return updateCart(serviceCode, serviceName, (draft) => {
    const key = lineKey(line.itemGroupId, line.pricingGroupId);
    const existing = draft.lines.find((row) => row.key === key);
    if (existing) existing.quantity += quantity;
    else draft.lines.push({ ...line, key, quantity });
  });
}

export function setLineQuantity(serviceCode: string, serviceName: string, key: string, quantity: number): CartState {
  return updateCart(serviceCode, serviceName, (draft) => {
    const index = draft.lines.findIndex((row) => row.key === key);
    if (index < 0) return;
    if (quantity < 1) draft.lines.splice(index, 1);
    else draft.lines[index].quantity = Math.floor(quantity);
  });
}

export function removeLine(serviceCode: string, serviceName: string, key: string): CartState {
  return setLineQuantity(serviceCode, serviceName, key, 0);
}

/** 绑定服务端报价到当前 revision。 */
export function bindQuote(quoteId: string, expiresAt: string): CartState | undefined {
  const current = load();
  if (!current) return undefined;
  const next: CartState = { ...current, quote: { id: quoteId, revision: current.revision, expiresAt } };
  save(next);
  return next;
}

export function quoteIsCurrent(cart: CartState | undefined, now = serverNow()): boolean {
  if (!cart?.quote) return false;
  if (cart.quote.revision !== cart.revision) return false;
  const expires = Date.parse(cart.quote.expiresAt);
  return !Number.isFinite(expires) || expires > now;
}

/** 缺项检查（需求 §6.3“无选择时明确缺项”）。 */
export function cartMissing(cart: CartState | undefined): string[] {
  const missing: string[] = [];
  if (!cart || cart.lines.length === 0) missing.push("还没有选择设备");
  if (!cart?.startAt || !cart?.endAt) missing.push("请选择领取与归还时间");
  else if (Date.parse(cart.endAt) <= Date.parse(cart.startAt)) missing.push("归还时间必须晚于领取时间");
  // 配送需要本人收货地址；自取需要领取门店。发货源门店（locationId）两种方式都需要，由页面按主门店预置。
  if (isDeliveryMode(cart?.fulfillmentMode) && !cart?.deliveryAddressId) missing.push("请选择收货地址");
  if (!cart?.locationId) missing.push(isDeliveryMode(cart?.fulfillmentMode) ? "请选择发货门店" : "请选择领取地点");
  return missing;
}

/**
 * 开始提交：复用未决的提交键（结果未知时重放同键），否则生成新键。
 * 必须已有与当前 revision 匹配的报价。
 */
export function beginSubmission(): CartSubmission {
  const current = load();
  if (!current) throw new Error("清单为空");
  if (current.submission) return current.submission;
  if (!quoteIsCurrent(current)) throw new Error("报价已失效，请重新获取报价");
  const submission: CartSubmission = { key: newKey("order-create"), quoteId: current.quote!.id, status: "pending", startedAt: Date.now() };
  save({ ...current, submission });
  return submission;
}

/** 响应丢失：保留键，标记未知，禁止修改清单。 */
export function markSubmissionUnknown(): void {
  const current = load();
  if (!current?.submission) return;
  save({ ...current, submission: { ...current.submission, status: "unknown" } });
}

/** 服务端明确未创建订单（4xx）：释放键，允许修改与重新报价。 */
export function abandonSubmission(): void {
  const current = load();
  if (!current) return;
  save({ ...current, submission: undefined });
}

/** 订单已创建：清空清单。 */
export function completeSubmission(): void {
  save(undefined);
}

export function clearCart(): void {
  save(undefined);
}

/** 仅供测试。 */
export function resetCartForTest(): void {
  cached = undefined;
  loaded = false;
}
