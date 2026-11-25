/** 原商户入口。绑定同一 Core 公开缓存，保留宿主原事件对象、存储与当前会话。 */
import { createRentalMiniProgramMerchantStore, type MerchantInfo } from "@rental-os/rental-core/clients/miniprogram";
import { fetchBootstrap, listPublicServices } from "../api/merchant";
import { Emitter } from "./events";
import { currentSession, lastServiceCode } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

export const merchantEvents = new Emitter<MerchantInfo>();
const merchant = createRentalMiniProgramMerchantStore({
  merchant: { fetchBootstrap, listPublicServices },
  merchantEvents, currentSession, lastServiceCode,
  now: () => Date.now(),
  bootstrapStorageKey: STORAGE_KEYS.bootstrap,
  readStorage, writeStorage,
});

export const {
  cachedMerchant,
  categoryName,
  loadMerchant,
  resolveServiceCode,
  findService,
  preferredServiceCode,
  resetMerchantForTest,
} = merchant;
export type { MerchantService, MerchantInfo } from "@rental-os/rental-core/clients/miniprogram";
