import { configProblem } from "./config/public";
import { clearImageCache } from "./core/images";
import { loadMerchant } from "./core/merchant";
import { sessionEvents } from "./core/session";

/**
 * 应用入口。启动时只做两件事：拉商户公开信息（失败不阻塞，页面自己重试），
 * 以及在退出登录时清理图片缓存。会话刷新由 http 层按需单飞执行，不在这里预刷新。
 */
App({
  onLaunch() {
    if (!configProblem()) {
      loadMerchant().catch(() => {
        // 首页会显示重试入口。
      });
    }
    sessionEvents.on((event) => {
      if (event.type === "signed-out") clearImageCache();
    });
  },
  onShow() {
    // 切前台不做自动刷新；各页面 onShow 自行读取最新事实（需求 §4.3）。
  }
});
