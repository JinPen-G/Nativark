import { cachedMerchant, merchantEvents } from "../../core/merchant";
import { navMetrics } from "../../core/nav";
import { resolvePublicImageUrl } from "../../core/public-asset";
import { back } from "../../core/ui";

/** 系统默认 Logo（包内资源）；租户在运营端配置了品牌 Logo 时用租户的，否则用它，不用平台品牌冒充商户但保留一个中性占位。 */
const DEFAULT_LOGO = "/assets/logo.png";

/**
 * 自定义导航栏：状态栏留白 + 品牌 Logo 行（避让右侧胶囊）；传 title 时再加一行“返回 + 标题”。
 * 品牌 Logo 默认用系统图，商户在客户端渠道配置里传了 brandLogoUrl（经 bootstrap → merchant.logoUrl）就换成商户的；
 * 远程图加载失败（域名未加白名单/坏链）回落系统图，不显示破图。
 * 组件同时渲染一个等高占位，页面只需把 <nav-bar> 放在最顶部。所有高度在这里算好（WXML 表达式不做括号运算）。
 */
Component({
  options: { addGlobalClass: true },
  properties: {
    title: { type: String, value: "" },
    /** 是否显示返回按钮（有 title 时默认显示）。 */
    back: { type: Boolean, value: true },
    /** 透明背景（用于顶部有大图的页面）。 */
    transparent: { type: Boolean, value: false }
  },
  data: { statusBarHeight: 20, navBarHeight: 44, capsuleReserve: 104, titleRowHeight: 44, totalHeight: 64, logo: DEFAULT_LOGO },
  lifetimes: {
    attached() {
      const metrics = navMetrics();
      // 品牌行右侧预留到胶囊左边界，按真实窗口宽度算，不假设 375px。
      const capsuleReserve = Math.max(0, metrics.windowWidth - metrics.capsuleLeft) + 8;
      this.setData({ statusBarHeight: metrics.statusBarHeight, navBarHeight: metrics.navBarHeight, capsuleReserve });
      this.applyLogo(cachedMerchant()?.logoUrl);
      // 商户信息在应用启动/首页拉取后可能晚到；订阅一次，拿到租户 Logo 就替换。
      (this as unknown as { _unsubscribe?: () => void })._unsubscribe = merchantEvents.on((info) => this.applyLogo(info.logoUrl));
      this.updateTotal();
    },
    detached() {
      (this as unknown as { _unsubscribe?: () => void })._unsubscribe?.();
    }
  },
  observers: {
    title() {
      this.updateTotal();
    }
  },
  methods: {
    /** 仅接受可信 API 域名下的租户图片；其它一律回落系统图。 */
    applyLogo(url: string | undefined) {
      const next = resolvePublicImageUrl(url) ?? DEFAULT_LOGO;
      if (next !== this.data.logo) this.setData({ logo: next });
    },
    /** 远程 Logo 加载失败：回落系统图，避免破图。 */
    onLogoError() {
      if (this.data.logo !== DEFAULT_LOGO) this.setData({ logo: DEFAULT_LOGO });
    },
    updateTotal() {
      const data = this.data as { statusBarHeight: number; navBarHeight: number; titleRowHeight: number; title: string };
      this.setData({ totalHeight: data.statusBarHeight + data.navBarHeight + (data.title ? data.titleRowHeight : 0) });
    },
    onBack() {
      this.triggerEvent("back");
      back();
    }
  }
});
