/** 原清单入口。绑定同一 Core 缓存与订阅，宿主供给原存储、事件、时钟与键。 */
import { createRentalMiniProgramCart } from "@rental-os/rental-core/clients/miniprogram";
import { serverNow } from "./clock";
import { newKey } from "./keys";
import { sessionEvents } from "./session";
import { STORAGE_KEYS, readStorage, removeStorage, writeStorage } from "./storage";

const cart = createRentalMiniProgramCart({
  serverNow, newKey, sessionEvents,
  cartStorageKey: STORAGE_KEYS.cart,
  readStorage, removeStorage, writeStorage,
});

export const {
  getCart,
  cartLineCount,
  cartLocked,
  updateCart,
  lineKey,
  addLine,
  setLineQuantity,
  removeLine,
  bindQuote,
  quoteIsCurrent,
  cartMissing,
  beginSubmission,
  markSubmissionUnknown,
  abandonSubmission,
  completeSubmission,
  clearCart,
  resetCartForTest,
} = cart;
export { isDeliveryMode, CartServiceMismatch, CartLocked } from "@rental-os/rental-core/clients/miniprogram";
export type { CartLine, CartServiceSelection, CartSubmission, CartState } from "@rental-os/rental-core/clients/miniprogram";
