/** 原跨页面服务切换。沿宿主当前会话与用户确认，换发成功后清理同一清单。 */
import type { createRentalMiniProgramAuthApi } from "./auth";
import type { createRentalMiniProgramCart } from "./cart";

export interface RentalMiniProgramServiceFlowPorts {
  cart: Pick<ReturnType<typeof createRentalMiniProgramCart>, "cartLineCount" | "cartLocked" | "clearCart" | "getCart">;
  switchServiceApi: ReturnType<typeof createRentalMiniProgramAuthApi>["switchService"];
  bumpContext(reason: string): number;
  currentServiceCode(): string;
  isSignedIn(): boolean;
  lastServiceCode(): string | undefined;
  lastServiceStorageKey: string;
  writeStorage(key: string, value: unknown): void;
  confirmDialog(options: {
    title: string;
    content: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }): Promise<boolean>;
  toast(message: string): void;
}

export function createRentalMiniProgramServiceFlow(ports: RentalMiniProgramServiceFlowPorts) {
  const { switchServiceApi, bumpContext, currentServiceCode, isSignedIn,
    lastServiceCode, lastServiceStorageKey, writeStorage, confirmDialog, toast } = ports;
  const { cartLineCount, cartLocked, clearCart, getCart } = ports.cart;

  /**
   * 跨页面的业务流程（需求 §2.3 切换与草稿）。
   *
   * 切换服务：
   * - 有未提交清单时先问“继续当前租赁 / 清空并切换”，不能静默清空；
   * - 正在提交或结果未知时禁止切换；
   * - 已登录：经服务端换发会话；游客：只更新本地选择。
   * 返回 true 表示已切换。
   */
  async function switchService(targetCode: string, targetName?: string): Promise<boolean> {
    if (!targetCode) return false;
    const current = isSignedIn() ? currentServiceCode() : lastServiceCode();
    if (current === targetCode) return true;
    if (cartLocked()) {
      toast("上一次提交的结果尚未确认，暂不能切换服务");
      return false;
    }
    const cart = getCart();
    const mustClear = Boolean(cart && cart.lines.length > 0 && cart.serviceCode !== targetCode);
    if (mustClear) {
      const confirmed = await confirmDialog({
        title: "切换服务",
        content: `你在“${cart!.serviceName}”还有 ${cartLineCount()} 件未提交的设备。切换到“${targetName ?? targetCode}”后需要重新选择本次租赁内容。`,
        confirmText: "清空并切换",
        cancelText: "继续当前租赁",
        danger: true
      });
      if (!confirmed) return false;
    }
    if (isSignedIn()) {
      // 先由服务端换发会话，成功后才清空清单：切换失败时用户仍在原服务，清单不能先没了。
      await switchServiceApi(targetCode);
    } else {
      writeStorage(lastServiceStorageKey, targetCode);
      bumpContext("guest-switch");
    }
    if (mustClear) clearCart();
    return true;
  }

  /**
   * 打开另一服务的订单前，先把会话切到该订单所属服务（服务端复核归属）。
   * 有未提交清单时同样保护，不静默清空。
   */
  async function ensureServiceForOrder(serviceCode: string, serviceName?: string): Promise<boolean> {
    if (!isSignedIn()) return false;
    if (currentServiceCode() === serviceCode) return true;
    return switchService(serviceCode, serviceName);
  }

  return { switchService, ensureServiceForOrder };
}
