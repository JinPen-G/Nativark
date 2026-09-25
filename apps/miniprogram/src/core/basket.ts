import { Emitter } from "./events";
import { currentSession, sessionEvents } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 购物车（长期保存，按客户分桶）。与“本次租赁清单”(core/cart) 区分：
 * - cart：单服务、直接进入确认下单的临时清单（“立即预约/立即购买”）。
 * - basket：可跨多个服务/品类、长期保留的购物车；结算时按所选服务分组各自报价与下单
 *   （多品类合并支付见 docs/跨品类合并支付方案）。
 * 只存选择意图（服务/型号/选项/数量），不存价格；价格与库存在结算报价时以服务端为准。
 * 游客购物车在登录后并入本人；退出登录保留本机购物车但按客户分桶，不泄漏给下一个登录者。
 */
export interface BasketLine {
  /** itemGroupId(@pricingGroupId) 组成的稳定键。 */
  key: string;
  itemGroupId: string;
  itemName: string;
  pricingGroupId?: string;
  pricingGroupName?: string;
  inventoryMode?: string;
  imageSource?: string;
  quantity: number;
}

export interface BasketGroup {
  serviceCode: string;
  serviceName: string;
  categoryCode: string;
  lines: BasketLine[];
}

/** ownerKey(customerId 或 guest) → 分服务的购物车分组。 */
type BasketStore = Record<string, BasketGroup[]>;

export const basketEvents = new Emitter<{ type: "changed" }>();

function ownerKey(): string {
  return currentSession()?.customer.customerId ?? "guest";
}

function load(): BasketStore {
  return readStorage<BasketStore>(STORAGE_KEYS.basket) ?? {};
}

function save(store: BasketStore): void {
  writeStorage(STORAGE_KEYS.basket, store);
  basketEvents.emit({ type: "changed" });
}

function lineKey(itemGroupId: string, pricingGroupId?: string): string {
  return pricingGroupId ? `${itemGroupId}@${pricingGroupId}` : itemGroupId;
}

// APPEND-MARKER

export function listBasket(): BasketGroup[] {
  return load()[ownerKey()] ?? [];
}

/** 购物车内商品总件数（各分组数量之和），用于角标。 */
export function basketCount(): number {
  return listBasket().reduce((sum, group) => sum + group.lines.reduce((s, line) => s + line.quantity, 0), 0);
}

/** 对本人购物车做一次修改：拷贝后变更、丢弃空分组、落库并广播。 */
function mutate(mutator: (groups: BasketGroup[]) => void): BasketGroup[] {
  const store = load();
  const owner = ownerKey();
  const groups = (store[owner] ?? []).map((group) => ({ ...group, lines: group.lines.map((line) => ({ ...line })) }));
  mutator(groups);
  const pruned = groups.filter((group) => group.lines.length > 0);
  store[owner] = pruned;
  save(store);
  return pruned;
}

export function addToBasket(group: { serviceCode: string; serviceName: string; categoryCode: string }, line: Omit<BasketLine, "key" | "quantity">, quantity = 1): void {
  if (!Number.isInteger(quantity) || quantity < 1) return;
  mutate((groups) => {
    let target = groups.find((row) => row.serviceCode === group.serviceCode);
    if (!target) {
      target = { serviceCode: group.serviceCode, serviceName: group.serviceName, categoryCode: group.categoryCode, lines: [] };
      groups.push(target);
    } else {
      // 服务名/品类可能更新，取最新一次。
      target.serviceName = group.serviceName;
      target.categoryCode = group.categoryCode;
    }
    const key = lineKey(line.itemGroupId, line.pricingGroupId);
    const existing = target.lines.find((row) => row.key === key);
    if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
    else target.lines.push({ ...line, key, quantity });
  });
}

export function setBasketQuantity(serviceCode: string, key: string, quantity: number): void {
  mutate((groups) => {
    const group = groups.find((row) => row.serviceCode === serviceCode);
    if (!group) return;
    const index = group.lines.findIndex((row) => row.key === key);
    if (index < 0) return;
    if (quantity < 1) group.lines.splice(index, 1);
    else group.lines[index].quantity = Math.min(99, Math.floor(quantity));
  });
}

export function removeBasketLine(serviceCode: string, key: string): void {
  setBasketQuantity(serviceCode, key, 0);
}

export function clearBasketGroup(serviceCode: string): void {
  mutate((groups) => {
    const index = groups.findIndex((group) => group.serviceCode === serviceCode);
    if (index >= 0) groups.splice(index, 1);
  });
}

/** 登录后把游客购物车并入本人：同服务同型号合并数量，其余追加。 */
function mergeGuestBasket(): void {
  const store = load();
  const owner = ownerKey();
  if (owner === "guest" || !store.guest?.length) return;
  const mine = (store[owner] ?? []).map((group) => ({ ...group, lines: group.lines.map((line) => ({ ...line })) }));
  for (const guestGroup of store.guest) {
    const target = mine.find((row) => row.serviceCode === guestGroup.serviceCode);
    if (!target) {
      mine.push({ ...guestGroup, lines: guestGroup.lines.map((line) => ({ ...line })) });
      continue;
    }
    for (const line of guestGroup.lines) {
      const existing = target.lines.find((row) => row.key === line.key);
      if (existing) existing.quantity = Math.min(99, existing.quantity + line.quantity);
      else target.lines.push({ ...line });
    }
  }
  store[owner] = mine.filter((group) => group.lines.length > 0);
  delete store.guest;
  save(store);
}

// 登录成功时合并游客购物车；退出登录不动本人桶（下一个 guest 从空开始）。
sessionEvents.on((event) => {
  if (event.type === "signed-in") mergeGuestBasket();
});

