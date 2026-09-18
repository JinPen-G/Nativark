import { switchService as switchServiceApi } from "../api/auth";
import { cartLineCount, cartLocked, clearCart, getCart } from "./cart";
import { bumpContext, currentServiceCode, isSignedIn, lastServiceCode } from "./session";
import { writeStorage, STORAGE_KEYS } from "./storage";
import { confirmDialog, toast } from "./ui";

/**
 * 跨页面的业务流程（需求 §2.3 切换与草稿）。
 *
 * 切换服务：
 * - 有未提交清单时先问“继续当前租赁 / 清空并切换”，不能静默清空；
 * - 正在提交或结果未知时禁止切换；
 * - 已登录：经服务端换发会话；游客：只更新本地选择。
 * 返回 true 表示已切换。
 */
export async function switchService(targetCode: string, targetName?: string): Promise<boolean> {
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
    writeStorage(STORAGE_KEYS.lastService, targetCode);
    bumpContext("guest-switch");
  }
  if (mustClear) clearCart();
  return true;
}

/**
 * 打开另一服务的订单前，先把会话切到该订单所属服务（服务端复核归属）。
 * 有未提交清单时同样保护，不静默清空。
 */
export async function ensureServiceForOrder(serviceCode: string, serviceName?: string): Promise<boolean> {
  if (!isSignedIn()) return false;
  if (currentServiceCode() === serviceCode) return true;
  return switchService(serviceCode, serviceName);
}
