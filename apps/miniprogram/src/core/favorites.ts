import { Emitter } from "./events";
import { currentSession } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 我的收藏（本机保存）。收藏只是“想再看/想再租”的意图，不锁库存、不保存价格；
 * 按客户分开保存，游客的收藏在登录后归到该客户名下。服务端收藏同步属后续任务。
 */
export interface FavoriteItem {
  itemId: string;
  serviceCode: string;
  serviceName: string;
  name: string;
  imageSource: string;
  priceText: string;
  savedAt: number;
}

type FavoriteStore = Record<string, FavoriteItem[]>;

export const favoriteEvents = new Emitter<{ type: "changed" }>();

function ownerKey(): string {
  return currentSession()?.customer.customerId ?? "guest";
}

function load(): FavoriteStore {
  return readStorage<FavoriteStore>(STORAGE_KEYS.favorites) ?? {};
}

function save(store: FavoriteStore): void {
  writeStorage(STORAGE_KEYS.favorites, store);
  favoriteEvents.emit({ type: "changed" });
}

export function listFavorites(): FavoriteItem[] {
  const store = load();
  const owner = ownerKey();
  const mine = store[owner] ?? [];
  // 登录后把游客期间的收藏并入本人（同一商品只保留一份）。
  if (owner !== "guest" && store.guest?.length) {
    const merged = [...mine];
    for (const item of store.guest) if (!merged.some((row) => row.itemId === item.itemId)) merged.push(item);
    store[owner] = merged;
    delete store.guest;
    save(store);
    return merged;
  }
  return mine;
}

export function isFavorite(itemId: string): boolean {
  return listFavorites().some((row) => row.itemId === itemId);
}

export function toggleFavorite(item: Omit<FavoriteItem, "savedAt">): boolean {
  const store = load();
  const owner = ownerKey();
  const mine = store[owner] ?? [];
  const index = mine.findIndex((row) => row.itemId === item.itemId);
  if (index >= 0) mine.splice(index, 1);
  else mine.unshift({ ...item, savedAt: Date.now() });
  store[owner] = mine.slice(0, 200);
  save(store);
  return index < 0;
}

export function removeFavorite(itemId: string): void {
  const store = load();
  const owner = ownerKey();
  store[owner] = (store[owner] ?? []).filter((row) => row.itemId !== itemId);
  save(store);
}
