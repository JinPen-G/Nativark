import { themeBehavior } from "../../core/theme-behavior";
import { favoriteEvents, listFavorites, removeFavorite, type FavoriteItem } from "../../core/favorites";
import { resolveImage } from "../../core/images";
import { isSignedIn } from "../../core/session";
import { ROUTES, buildUrl, navigate } from "../../core/ui";

/** 我的收藏（本机保存）：收藏只是再看/再租的意图，进入详情后按当时的目录与报价为准。 */
interface FavoriteRow extends FavoriteItem {
  imagePath: string;
}

Page({
  behaviors: [themeBehavior],
  data: { rows: [] as FavoriteRow[], signedIn: false },
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
    const rows: FavoriteRow[] = listFavorites().map((item) => ({ ...item, imagePath: this.data.rows.find((row) => row.itemId === item.itemId)?.imagePath ?? "" }));
    this.setData({ rows, signedIn: isSignedIn() });
    rows.forEach((row, index) => {
      if (!row.imageSource || row.imagePath || !isSignedIn()) return;
      resolveImage(row.imageSource).then((path) => {
        if (path && this.data.rows[index]?.itemId === row.itemId) this.setData({ [`rows[${index}].imagePath`]: path });
      });
    });
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
