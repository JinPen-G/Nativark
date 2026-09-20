import { cachedMerchant, merchantEvents } from "./merchant";

/**
 * 客户端主题色（档位三：先只接主按钮等主色）。
 *
 * app.wxss 把 `--primary / --primary-weak / --primary-dark` 定义在 page 上，
 * `.btn--primary/secondary/outline/ghost` 等主色元素都读这三个变量。
 * 用 page-meta 的 page-style 在页面根上覆盖它们，即可让主按钮跟随租户色，
 * 无需逐个改按钮。商户未设置主题色时返回空串，页面用系统默认色。
 *
 * 只做主色三件套：图标等零散硬编码色暂不跟随（后续档位再收敛）。
 */
const SYSTEM_PRIMARY = "#1677FF";

function normalizeHex(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const raw = input.trim();
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u.exec(raw);
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** 把 #RRGGBB 按比例调暗（factor<1）用于 --primary-dark（按下态）。 */
function darken(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clampChannel(((n >> 16) & 0xff) * factor);
  const g = clampChannel(((n >> 8) & 0xff) * factor);
  const b = clampChannel((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()}`;
}

/** 生成 --primary-weak（浅底：次按钮/信息条背景），用低透明度 rgba 保证任何主色都协调。 */
function weak(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, 0.12)`;
}

/**
 * 当前租户主题色对应的 page-style 覆盖串；未设置或非法时返回空串（页面用系统默认色）。
 * 页面把它绑定到 <page-meta page-style="{{themeStyle}}">。
 */
export function themeStyle(color?: string): string {
  const hex = normalizeHex(color ?? cachedMerchant()?.themeColor);
  if (!hex || hex === SYSTEM_PRIMARY) return "";
  return `--primary: ${hex}; --primary-dark: ${darken(hex, 0.85)}; --primary-weak: ${weak(hex)};`;
}

/**
 * 页面接主题的便捷封装：立刻按缓存商户色 setData，并订阅商户信息更新（晚到时刷新）。
 * 返回取消订阅函数，页面在 onUnload 调用。data 里需有 themeStyle 字段。
 */
export function bindTheme(page: { setData: (data: Record<string, unknown>) => void }): () => void {
  page.setData({ themeStyle: themeStyle() });
  return merchantEvents.on((info) => page.setData({ themeStyle: themeStyle(info.themeColor) }));
}
