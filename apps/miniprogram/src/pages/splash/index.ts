import { configProblem } from "../../config/public";
import { loadCatalog } from "../../core/catalogStore";
import { loadMerchant, resolveServiceCode } from "../../core/merchant";
import { ROUTES } from "../../core/ui";

/**
 * 启动页（品牌首屏，按设计稿：浅蓝底 + 居中品牌锁定图 + 底部波浪 + 旋转加载环）。
 *
 * 交互约定（负责人确认）：
 * - 强制停留 2 秒；这 2 秒内并行预拉首页所需数据（商户公开信息 + 当前服务目录），
 *   预热的是首页 bootstrap/loadItems 读取的同一份缓存，用户进入首页即见已加载内容，不再空转。
 * - reLaunch 到首页而非 navigate：启动页不该留在页面栈里可被返回。
 * - 数据即便没在 2 秒内就绪也照常进首页（首页自身仍有加载/重试态兜底）；配置缺失同样进首页（首页显示“尚未配置”）。
 * - 分享/深链接直接打开目标页时不经过本页。
 */
const STAY_MS = 2000;

Page({
  data: {},
  entered: false,

  onLoad() {
    const start = Date.now();
    // 并行：计时与预热同时进行，进首页时刻 = max(2s, 数据尽力而为)。这里以 2s 为准，数据慢则由首页兜底。
    void this.preloadHome();
    setTimeout(() => this.enterHome(), STAY_MS - (Date.now() - start));
  },

  /** 预热首页数据：商户信息 → 解析当前服务 → 目录。全部失败也不抛错，交给首页重试。 */
  async preloadHome() {
    if (configProblem()) return;
    try {
      const info = await loadMerchant();
      const serviceCode = resolveServiceCode(info);
      if (serviceCode) await loadCatalog(serviceCode);
    } catch {
      // 预热失败不阻塞进入首页；首页 onShow 会自行重新加载并显示重试。
    }
  },

  enterHome() {
    if (this.entered) return;
    this.entered = true;
    wx.reLaunch({ url: ROUTES.home, fail: () => wx.switchTab({ url: ROUTES.home }) });
  }
});
