/** 原服务切换入口。复用同一清单、当前会话与认证 API，确认界面由宿主提供。 */
import { createRentalMiniProgramServiceFlow } from "@rental-os/rental-core/clients/miniprogram";
import { switchService as switchServiceApi } from "../api/auth";
import { cartLineCount, cartLocked, clearCart, getCart } from "./cart";
import { bumpContext, currentServiceCode, isSignedIn, lastServiceCode } from "./session";
import { writeStorage, STORAGE_KEYS } from "./storage";
import { confirmDialog, toast } from "./ui";

const flow = createRentalMiniProgramServiceFlow({
  cart: { cartLineCount, cartLocked, clearCart, getCart },
  switchServiceApi, bumpContext, currentServiceCode, isSignedIn, lastServiceCode,
  lastServiceStorageKey: STORAGE_KEYS.lastService,
  writeStorage, confirmDialog, toast,
});

export const { switchService, ensureServiceForOrder } = flow;
