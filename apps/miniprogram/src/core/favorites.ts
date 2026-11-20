/** 原收藏入口。绑定同一 Core 收藏流程，保留宿主原会话、存储和收藏事件对象。 */
import { createRentalMiniProgramFavorites } from "@rental-os/rental-core/clients/miniprogram";
import { Emitter } from "./events";
import { currentSession, sessionEvents } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

export const favoriteEvents = new Emitter<{ type: "changed" }>();
const favorites = createRentalMiniProgramFavorites({
  currentSession, sessionEvents, favoriteEvents,
  favoritesStorageKey: STORAGE_KEYS.favorites,
  readStorage, writeStorage,
  now: () => Date.now(),
});

export const { listFavorites, isFavorite, toggleFavorite, removeFavorite } = favorites;
export type { FavoriteItem } from "@rental-os/rental-core/clients/miniprogram";
