import { configProblem } from "./config/public";
import { loadContext } from "./core/context";
import { clearImageCache } from "./core/images";
import { isSignedIn, sessionEvents } from "./core/session";
import { startThemeWatch, syncNativeTheme } from "./core/theme";

/**
 * 应用入口。启动时：开始主题跟随；已登录则预热工作上下文（术语/地点/权限），失败由页面自行重试。
 * 退出登录时清理图片缓存与内存上下文（core/context 订阅了会话事件）。
 */
App({
  onLaunch() {
    startThemeWatch();
    if (!configProblem() && isSignedIn()) {
      loadContext().catch(() => {
        // 页面进入时会再次加载并显示错误出口。
      });
    }
    sessionEvents.on((event) => {
      if (event.type === "signed-out") clearImageCache();
    });
  },
  onShow() {
    syncNativeTheme();
  }
});
