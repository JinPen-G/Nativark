import { navMetrics } from "../../core/nav";
import { back } from "../../core/ui";

/** 平台品牌 Logo（包内资源）：员工端是平台工具，统一显示 Rental OS 标识。 */
const LOGO = "/assets/logo.png";

/**
 * 自定义导航栏：状态栏留白 + 品牌 Logo 行（避让右侧胶囊），可在 Logo 右侧放一个“当前地点”切换胶囊；
 * 传 title 时改为“返回 + 标题”一行（深层页面）。
 * 组件同时渲染一个等高占位，页面只需把 <nav-bar> 放在最顶部。所有高度在这里算好。
 */
Component({
  options: { addGlobalClass: true },
  properties: {
    title: { type: String, value: "" },
    /** 是否显示返回按钮（有 title 时默认显示）。 */
    back: { type: Boolean, value: true },
    /** Logo 行右侧的地点名；为空则不显示切换胶囊。 */
    location: { type: String, value: "" },
    /** 透明背景（用于顶部有大图的页面）。 */
    transparent: { type: Boolean, value: false },
    /** 个人页只保留微信胶囊下方的留白。 */
    minimal: { type: Boolean, value: false }
  },
  data: { statusBarHeight: 20, navBarHeight: 44, capsuleReserve: 104, totalHeight: 64, logo: LOGO },
  lifetimes: {
    attached() {
      const metrics = navMetrics();
      const capsuleReserve = Math.max(0, metrics.windowWidth - metrics.capsuleLeft) + 8;
      this.setData({ statusBarHeight: metrics.statusBarHeight, navBarHeight: metrics.navBarHeight, capsuleReserve, totalHeight: metrics.statusBarHeight + metrics.navBarHeight });
    }
  },
  methods: {
    onBack() {
      this.triggerEvent("back");
      back();
    },
    onLocation() {
      this.triggerEvent("location");
    }
  }
});
