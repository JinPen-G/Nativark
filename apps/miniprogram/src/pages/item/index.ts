import { themeBehavior } from "../../core/theme-behavior";
import type { ClientCatalogItem, ClientCatalogPricingGroup, ClientCatalogResponse } from "@rental-os/shared";
import { fetchQualificationTypes } from "../../api/profile";
import { CartLocked, CartServiceMismatch, addLine } from "../../core/cart";
import { catalogPricingUnitLabel, listAttribute, loadCatalog, pricingOptionsFor, primaryLocation, specEntries, specsOf } from "../../core/catalogStore";
import { describeError } from "../../core/errors";
import { favoriteEvents, isFavorite, toggleFavorite } from "../../core/favorites";
import { switchService } from "../../core/flow";
import { isApiError } from "../../core/http";
import { resolveImage } from "../../core/images";
import { inventoryLabel } from "../../core/labels";
import { cachedMerchant, findService } from "../../core/merchant";
import { startingPriceParts } from "../../core/money";
import { emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { contextVersion, currentServiceCode, isSignedIn, lastServiceCode } from "../../core/session";
import { ROUTES, buildUrl, callPhone, confirmDialog, navigate, requireSignIn, toast } from "../../core/ui";

/**
 * P03 设备详情（V2 设计稿）：大图 + 收藏/分享 → 名称与起价 → 标签 → 商品简介 → 主要参数 → 适用场景 → 服务门店 → 联系客服 / 立即预约。
 * “立即预约”把该设备加入本次租赁并进入确认订单页；加入不锁库存，价格以确认页服务端报价为准。
 */
interface Spec {
  label: string;
  value: string;
}

interface ItemData {
  view: ViewState;
  serviceName: string;
  item?: ClientCatalogItem;
  images: string[];
  imageIndex: number;
  imageTotal: number;
  imagesResolved: boolean;
  priceSymbol: string;
  priceNumber: string;
  priceUnit: string;
  hasPrice: boolean;
  tags: string[];
  specs: Spec[];
  allSpecs: Spec[];
  scenes: string[];
  inventoryLabel: string;
  options: ClientCatalogPricingGroup[];
  optionId: string;
  showOptionSheet: boolean;
  showSpecSheet: boolean;
  components: Array<{ name: string; quantity: number; optional: boolean }>;
  qualificationNotes: string[];
  store?: { id: string; name: string; address: string; hours: string; phone: string };
  favorite: boolean;
  servicePhone: string;
  signedIn: boolean;
}

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    serviceName: "",
    images: [],
    imageIndex: 0,
    imageTotal: 0,
    imagesResolved: false,
    priceSymbol: "",
    priceNumber: "",
    priceUnit: "",
    hasPrice: false,
    tags: [],
    specs: [],
    allSpecs: [],
    scenes: [],
    inventoryLabel: "",
    options: [],
    optionId: "",
    showOptionSheet: false,
    showSpecSheet: false,
    components: [],
    qualificationNotes: [],
    favorite: false,
    servicePhone: "",
    signedIn: false
  } as ItemData,

  itemId: "" as string,
  serviceCode: "" as string,
  reserving: false,
  unsubscribe: undefined as (() => void) | undefined,

  onLoad(options: Record<string, string | undefined>) {
    this.itemId = options.id ?? "";
    this.serviceCode = options.service || (isSignedIn() ? currentServiceCode() : lastServiceCode()) || "";
    const merchant = cachedMerchant();
    const service = findService(merchant, this.serviceCode);
    this.setData({ serviceName: service?.name ?? "", servicePhone: merchant?.servicePhone ?? "", signedIn: isSignedIn(), favorite: isFavorite(this.itemId) });
    this.unsubscribe = favoriteEvents.on(() => this.setData({ favorite: isFavorite(this.itemId) }));
  },

  onUnload() {
    this.unsubscribe?.();
  },

  onShow() {
    this.setData({ signedIn: isSignedIn(), favorite: isFavorite(this.itemId) });
    void this.load();
  },

  onShareAppMessage() {
    return { title: this.data.item?.name ?? "租设备", path: buildUrl(ROUTES.item, { id: this.itemId, service: this.serviceCode }) };
  },

  async load() {
    if (!this.itemId || !this.serviceCode) {
      this.setData({ view: emptyState("商品不存在", "该链接可能已失效。", "回首页", "", "none") });
      return;
    }
    try {
      // 分享深链接可能指向另一个服务：已登录且当前服务不同则先切换（会保护未提交清单）。
      if (isSignedIn() && currentServiceCode() && currentServiceCode() !== this.serviceCode) {
        const switched = await switchService(this.serviceCode, this.data.serviceName);
        if (!switched) {
          this.setData({ view: emptyState("已保留当前租赁", "要查看该设备需切换到它所属的服务。", "回首页", "", "none") });
          return;
        }
      }
      const version = contextVersion();
      const catalog = await loadCatalog(this.serviceCode, false);
      if (contextVersion() !== version) return;
      const item = catalog.items.find((row) => row.id === this.itemId);
      if (!item) {
        this.setData({ view: emptyState("商品已下架", "该设备当前不可租用；如有历史订单可在“订单”查看。", "看看其他设备", "", "none") });
        return;
      }
      this.apply(catalog, item);
      void this.loadQualificationNotes();
    } catch (error) {
      if (isApiError(error, "STALE_CONTEXT")) return;
      if (!isSignedIn() && isApiError(error) && (error.code === "UNAVAILABLE" || error.code === "AUTH_REQUIRED")) {
        this.setData({ view: emptyState("登录后查看设备详情", "商户尚未开放游客浏览。", "去登录", "", "login") });
        return;
      }
      // 二次加载失败保留已加载详情，只在首屏无数据时整屏报错。
      if (this.data.item) toast("刷新失败，已保留已加载的详情");
      else this.setData({ view: errorState(error) });
    }
  },

  apply(catalog: ClientCatalogResponse, item: ClientCatalogItem) {
    const sameItem = this.data.item?.id === item.id;
    const price = startingPriceParts(item.startingPrice, (unit) => catalogPricingUnitLabel(catalog, unit));
    const allSpecs = specEntries(item);
    const options = pricingOptionsFor(catalog, item.id);
    const components = ((item as unknown as { bundleComponents?: Array<{ itemGroupName: string; quantity: number; optional?: boolean }> }).bundleComponents ?? []).map((component) => ({ name: component.itemGroupName, quantity: component.quantity, optional: Boolean(component.optional) }));
    const tags = listAttribute(item, ["tags", "标签"]);
    const store = primaryLocation(catalog);
    this.setData({
      view: readyState(),
      item,
      images: sameItem ? this.data.images : [],
      imagesResolved: sameItem ? this.data.imagesResolved : false,
      imageIndex: sameItem ? this.data.imageIndex : 0,
      imageTotal: item.images?.length ?? 0,
      priceSymbol: price.symbol,
      priceNumber: price.number,
      priceUnit: price.unit,
      hasPrice: price.available,
      tags: tags.length ? tags : specsOf(item, 4),
      specs: allSpecs.slice(0, 3),
      allSpecs,
      scenes: listAttribute(item, ["scenes", "场景", "适用场景"]),
      inventoryLabel: inventoryLabel(item.inventoryMode),
      options,
      optionId: options.length === 1 ? options[0].id : this.data.optionId && options.some((row) => row.id === this.data.optionId) ? this.data.optionId : "",
      components,
      store: store ? { id: store.id, name: store.name, address: store.address ?? "", hours: store.businessHours ?? "", phone: store.contactPhone ?? "" } : undefined
    });
    const version = contextVersion();
    Promise.all((item.images ?? []).map((image) => resolveImage(image.url))).then((paths) => {
      if (contextVersion() !== version || this.data.item?.id !== item.id) return;
      this.setData({ images: paths.filter(Boolean), imagesResolved: true });
    });
  },

  async loadQualificationNotes() {
    if (!isSignedIn()) return;
    try {
      const types = await fetchQualificationTypes();
      const required = types.filter((type) => type.status === "enabled" && type.requiredForBooking);
      this.setData({ qualificationNotes: required.map((type) => `租用本服务设备需提供「${type.name}」`) });
    } catch {
      // 资质提示是辅助信息，读取失败不影响浏览。
    }
  },

  onSwiperChange(event: WechatMiniprogram.SwiperChange) {
    this.setData({ imageIndex: event.detail.current });
  },

  onPreview() {
    if (!this.data.images.length) return;
    wx.previewImage({ urls: this.data.images, current: this.data.images[this.data.imageIndex] });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: ROUTES.home });
  },

  onFavorite() {
    const item = this.data.item;
    if (!item) return;
    const image = item.images?.[0]?.url ?? "";
    const priceText = this.data.hasPrice ? `${this.data.priceSymbol}${this.data.priceNumber}${this.data.priceUnit}` : "";
    const added = toggleFavorite({ itemId: item.id, serviceCode: this.serviceCode, serviceName: this.data.serviceName, name: item.name, imageSource: image, priceText });
    toast(added ? "已收藏（保存在本机）" : "已取消收藏");
  },

  onShowSpecs() {
    this.setData({ showSpecSheet: true });
  },

  onCloseSpecs() {
    this.setData({ showSpecSheet: false });
  },

  onCloseOptions() {
    this.setData({ showOptionSheet: false });
  },

  onPickOption(event: WechatMiniprogram.TouchEvent) {
    this.setData({ optionId: String(event.currentTarget.dataset.id ?? ""), showOptionSheet: false });
    void this.reserve();
  },

  onStoreTap() {
    navigate(buildUrl(ROUTES.locations, { service: this.serviceCode }));
  },

  onContact() {
    callPhone(this.data.store?.phone || this.data.servicePhone);
  },

  onReserve() {
    if (!this.data.item) return;
    if (!requireSignIn(buildUrl(ROUTES.item, { id: this.itemId, service: this.serviceCode }))) return;
    if (!this.data.options.length) {
      toast("该设备暂无可选租赁选项，请联系商户", { duration: 3000 });
      return;
    }
    if (!this.data.optionId && this.data.options.length > 1) {
      this.setData({ showOptionSheet: true });
      return;
    }
    void this.reserve();
  },

  /** 加入本次租赁（不锁库存）并进入确认订单页。 */
  async reserve() {
    if (this.reserving) return;
    const item = this.data.item;
    const option = this.data.options.find((row) => row.id === this.data.optionId) ?? this.data.options[0];
    if (!item || !option) return;
    this.reserving = true;
    try {
      const line = { itemGroupId: item.id, itemName: item.name, pricingGroupId: option.id, pricingGroupName: option.name, inventoryMode: item.inventoryMode, imageSource: item.images?.[0]?.url ?? "" };
      try {
        addLine(this.serviceCode, this.data.serviceName, line, 1);
      } catch (error) {
        if (error instanceof CartServiceMismatch) {
          const confirmed = await confirmDialog({
            title: "切换服务",
            content: `你在“${error.currentServiceName}”还有未提交的设备。预约本设备需要清空并切换到“${this.data.serviceName}”。`,
            confirmText: "清空并切换",
            cancelText: "继续当前租赁",
            danger: true
          });
          if (!confirmed) return;
          const switched = await switchService(this.serviceCode, this.data.serviceName).catch((switchError) => {
            toast(describeError(switchError).message);
            return false;
          });
          if (!switched) return;
          addLine(this.serviceCode, this.data.serviceName, line, 1);
        } else if (error instanceof CartLocked) {
          toast(error.message, { duration: 3000 });
          navigate(ROUTES.checkout);
          return;
        } else {
          toast(describeError(error).message);
          return;
        }
      }
      navigate(ROUTES.checkout);
    } finally {
      this.reserving = false;
    }
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.item, { id: this.itemId, service: this.serviceCode }) })) return;
    if (this.data.view.actionText === "看看其他设备") wx.switchTab({ url: ROUTES.catalog });
    else if (this.data.view.actionText === "回首页") wx.switchTab({ url: ROUTES.home });
    else void this.load();
  }
});
