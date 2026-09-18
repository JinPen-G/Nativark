import { navMetrics } from "../../core/nav";
import { back } from "../../core/ui";

/**
 * 自定义导航栏：状态栏留白 + 品牌 Logo 行（避让右侧胶囊）；传 title 时再加一行“返回 + 标题”。
 * 组件同时渲染一个等高占位，页面只需把 <nav-bar> 放在最顶部。
 * 所有高度在这里算好（WXML 表达式不做括号运算）。
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
  data: { statusBarHeight: 20, navBarHeight: 44, capsuleReserve: 104, titleRowHeight: 44, totalHeight: 64 },
  lifetimes: {
    attached() {
      const metrics = navMetrics();
      // 品牌行右侧预留到胶囊左边界，按真实窗口宽度算，不假设 375px。
      const capsuleReserve = Math.max(0, metrics.windowWidth - metrics.capsuleLeft) + 8;
      this.setData({ statusBarHeight: metrics.statusBarHeight, navBarHeight: metrics.navBarHeight, capsuleReserve });
      this.updateTotal();
    }
  },
  observers: {
    title() {
      this.updateTotal();
    }
  },
  methods: {
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
