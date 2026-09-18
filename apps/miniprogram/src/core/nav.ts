/**
 * 自定义导航栏度量：状态栏高度与胶囊位置只需算一次。
 * 导航内容行高度 = 胶囊高度 + 胶囊上下留白×2，与系统原生导航栏一致，避免遮挡胶囊。
 */
export interface NavMetrics {
  statusBarHeight: number;
  navBarHeight: number;
  /** 状态栏 + 导航内容行。 */
  totalHeight: number;
  /** 胶囊左边界，用于限制标题/搜索框宽度。 */
  capsuleLeft: number;
  windowWidth: number;
}

let cached: NavMetrics | undefined;

export function navMetrics(): NavMetrics {
  if (cached) return cached;
  let statusBarHeight = 20;
  let windowWidth = 375;
  try {
    const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : (wx.getSystemInfoSync() as unknown as WechatMiniprogram.WindowInfo);
    statusBarHeight = info.statusBarHeight || statusBarHeight;
    windowWidth = info.windowWidth || windowWidth;
  } catch {
    // 使用默认值
  }
  let navBarHeight = 44;
  let capsuleLeft = windowWidth - 96;
  try {
    const capsule = wx.getMenuButtonBoundingClientRect();
    if (capsule && capsule.height > 0) {
      const gap = Math.max(0, capsule.top - statusBarHeight);
      navBarHeight = capsule.height + gap * 2;
      capsuleLeft = capsule.left;
    }
  } catch {
    // 开发者工具部分模式下取不到胶囊，退回默认值
  }
  cached = { statusBarHeight, navBarHeight, totalHeight: statusBarHeight + navBarHeight, capsuleLeft, windowWidth };
  return cached;
}
