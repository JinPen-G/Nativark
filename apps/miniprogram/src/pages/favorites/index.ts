import { themeBehavior } from "../../core/theme-behavior";
import { favoriteEvents, listFavorites, removeFavorite, type FavoriteItem } from "../../core/favorites";
import { isSignedIn } from "../../core/session";
import { ROUTES, buildUrl, navigate } from "../../core/ui";

/** 我的收藏（本机保存）：收藏只是再看/再租的意图，进入详情后按当时的目录与报价为准。图片由 lazy-image 组件自解析。 */
Page({
  behaviors: [themeBehavior],
  data: { rows: [] as FavoriteItem[], signedIn: false },
  unsubscribe: undefined as (() => void) | undefined,

  onLoad() {
    this.unsubscribe = favoriteEvents.on(() => this.refresh());
  },

  onUnload() {
    this.unsubscribe?.();
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    this.setData({ rows: listFavorites(), signedIn: isSignedIn() });
  },

  onOpen(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    const row = this.data.rows.find((item) => item.itemId === id);
    if (!row) return;
    navigate(buildUrl(ROUTES.item, { id: row.itemId, service: row.serviceCode }));
  },

  onRemove(event: WechatMiniprogram.TouchEvent) {
    removeFavorite(String(event.currentTarget.dataset.id ?? ""));
  },

  onBrowse() {
    wx.switchTab({ url: ROUTES.catalog });
  }
});
