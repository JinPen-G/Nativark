import { themeBehavior } from "../../core/theme-behavior";
import { basketCount, basketEvents, clearBasketGroup, listBasket, removeBasketLine, setBasketQuantity, type BasketGroup } from "../../core/basket";
import { addLine, cartLocked, clearCart } from "../../core/cart";
import { describeError } from "../../core/errors";
import { switchService } from "../../core/flow";
import { categoryIcon } from "../../core/labels";
import { emptyState, readyState, type ViewState } from "../../core/page";
import { sessionEvents } from "../../core/session";
import { ROUTES, buildUrl, navigate, requireSignIn, toast } from "../../core/ui";

/**
 * 购物车（长期、可跨品类）。按服务分组展示，可勾选分组、改数量、删除。
 * 结算：单个品类直接进入现有确认页；多品类合并结算+一次收款依赖后端支付组，落地前给出说明入口。
 * 选择状态保存在内存 selected（服务编码集合）：新加入的分组默认勾选，用户取消的保留取消，商品清空后自动移除。
 */
interface GroupVM extends BasketGroup {
  icon: string;
  selected: boolean;
  count: number;
}

interface CartData {
  view: ViewState;
  groups: GroupVM[];
  totalCount: number;
  selectedCount: number;
  selectedServiceCount: number;
  allSelected: boolean;
}

Page({
  behaviors: [themeBehavior],
  data: { view: readyState(), groups: [], totalCount: 0, selectedCount: 0, selectedServiceCount: 0, allSelected: true } as CartData,
  selected: new Set<string>(),
  known: new Set<string>(),
  offBasket: undefined as (() => void) | undefined,
  offSession: undefined as (() => void) | undefined,

  onLoad() {
    this.offBasket = basketEvents.on(() => this.refresh());
    // 登录/登出后归属桶变化，购物车内容随之变化。
    this.offSession = sessionEvents.on(() => this.refresh());
  },

  onUnload() {
    this.offBasket?.();
    this.offSession?.();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const groups = listBasket();
    const codes = new Set(groups.map((group) => group.serviceCode));
    for (const code of Array.from(this.selected)) if (!codes.has(code)) this.selected.delete(code);
    for (const code of Array.from(this.known)) if (!codes.has(code)) this.known.delete(code);
    // 新出现的分组默认勾选；已知分组沿用当前勾选状态（保留用户的取消）。
    for (const group of groups) if (!this.known.has(group.serviceCode)) { this.known.add(group.serviceCode); this.selected.add(group.serviceCode); }
    const vms: GroupVM[] = groups.map((group) => ({
      ...group,
      icon: categoryIcon(group.categoryCode),
      selected: this.selected.has(group.serviceCode),
      count: group.lines.reduce((sum, line) => sum + line.quantity, 0)
    }));
    const selectedGroups = vms.filter((vm) => vm.selected);
    this.setData({
      view: groups.length ? readyState() : emptyState("购物车是空的", "去挑选设备，加入购物车后可一次结算。", "去逛逛", "", "none"),
      groups: vms,
      totalCount: basketCount(),
      selectedCount: selectedGroups.reduce((sum, vm) => sum + vm.count, 0),
      selectedServiceCount: selectedGroups.length,
      allSelected: groups.length > 0 && selectedGroups.length === groups.length
    });
  },

  onToggleGroup(event: WechatMiniprogram.TouchEvent) {
    const code = String(event.currentTarget.dataset.code ?? "");
    if (this.selected.has(code)) this.selected.delete(code);
    else this.selected.add(code);
    this.refresh();
  },

  onToggleAll() {
    if (this.data.allSelected) this.selected.clear();
    else for (const group of this.data.groups) this.selected.add(group.serviceCode);
    this.refresh();
  },

  onIncrease(event: WechatMiniprogram.TouchEvent) {
    const service = String(event.currentTarget.dataset.service ?? "");
    const key = String(event.currentTarget.dataset.key ?? "");
    const line = listBasket().find((group) => group.serviceCode === service)?.lines.find((row) => row.key === key);
    if (line) setBasketQuantity(service, key, line.quantity + 1);
  },

  onDecrease(event: WechatMiniprogram.TouchEvent) {
    const service = String(event.currentTarget.dataset.service ?? "");
    const key = String(event.currentTarget.dataset.key ?? "");
    const line = listBasket().find((group) => group.serviceCode === service)?.lines.find((row) => row.key === key);
    if (line) setBasketQuantity(service, key, line.quantity - 1);
  },

  onRemove(event: WechatMiniprogram.TouchEvent) {
    removeBasketLine(String(event.currentTarget.dataset.service ?? ""), String(event.currentTarget.dataset.key ?? ""));
  },

  onClearGroup(event: WechatMiniprogram.TouchEvent) {
    clearBasketGroup(String(event.currentTarget.dataset.code ?? ""));
  },

  onItemTap(event: WechatMiniprogram.TouchEvent) {
    const service = String(event.currentTarget.dataset.service ?? "");
    const item = String(event.currentTarget.dataset.item ?? "");
    if (item) navigate(buildUrl(ROUTES.item, { id: item, service }));
  },

  /**
   * 去结算：单个品类直接进入现有确认页（把该分组载入本次租赁清单）；
   * 多品类合并结算+一次收款需后端支付组，落地前先引导用户单品类结算。
   */
  async onCheckout() {
    const selected = this.data.groups.filter((group) => group.selected);
    if (!selected.length) {
      toast("请先勾选要结算的商品");
      return;
    }
    if (!requireSignIn(ROUTES.cart)) return;
    if (selected.length > 1) {
      toast("多品类合并结算即将上线，请先选择单个品类结算", { duration: 3000 });
      return;
    }
    if (cartLocked()) {
      toast("有一笔提交结果待确认，请先在确认页处理后再结算", { duration: 3000 });
      return;
    }
    const group = selected[0];
    try {
      const switched = await switchService(group.serviceCode, group.serviceName);
      if (!switched) return;
      clearCart();
      for (const line of group.lines) {
        addLine(group.serviceCode, group.serviceName, { itemGroupId: line.itemGroupId, itemName: line.itemName, pricingGroupId: line.pricingGroupId, pricingGroupName: line.pricingGroupName, inventoryMode: line.inventoryMode, imageSource: line.imageSource }, line.quantity);
      }
      navigate(ROUTES.checkout);
    } catch (error) {
      toast(describeError(error).message, { duration: 3000 });
    }
  },

  onBrowse() {
    wx.switchTab({ url: ROUTES.catalog });
  },

  onViewAction() {
    this.onBrowse();
  }
});
