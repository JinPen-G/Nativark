import { bindTheme } from "./theme";

/**
 * 页面主题 Behavior：统一提供 themeStyle（租户主色覆盖）与 themeClass（强制深/浅色根 class）两个 data 字段，
 * 并在 attached/detached 订阅主题与商户变化。页面只需 `behaviors: [themeBehavior]`，
 * 并在 WXML 首行放 `<page-meta page-style="{{themeStyle}}" root-class="{{themeClass}}">`。
 *
 * 用 Behavior 而非逐页手写：20 个页面免重复样板，主题切换/租户色更新在所有页一致生效。
 */
export const themeBehavior = Behavior({
  data: { themeStyle: "", themeClass: "" },
  lifetimes: {
    attached() {
      (this as unknown as { _themeOff?: () => void })._themeOff = bindTheme(this as unknown as { setData: (d: Record<string, unknown>) => void });
    },
    detached() {
      (this as unknown as { _themeOff?: () => void })._themeOff?.();
    }
  }
});
