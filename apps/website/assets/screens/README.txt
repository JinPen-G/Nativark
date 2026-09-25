放置首页「真实产品界面」区块的截图（WHAT IS / 业务能力 / 产品体验）。
当前这些位置用统一占位框（.v2-shot）展示；丢入真图后，把对应占位框里的
<div class="v2-shot-label">…</div> 换成 <img src="assets/screens/xxx.webp" alt="…" loading="lazy" decoding="async" />
即可（.v2-shot 已用绝对定位铺满，图会自动 object-fit: cover）。

建议文件名与位置：
  admin-overview.webp   管理后台 · 经营概览（WHAT IS 区）
  cal-booking.webp      可租日历 · 预约（业务能力 01）
  orders.webp           订单管理 · 履约（业务能力 02）
  stores.webp           多门店 · 库存（业务能力 03）
  admin-dashboard.webp  管理后台 Dashboard（产品体验 主图）
  booking-site.webp     用户预约官网（产品体验）
  miniprogram.webp      移动端 / 小程序（产品体验）

建议：真机截图，webp，宽度 1600px 起，控制体积（GitHub Pages 首屏性能）。
路径为相对路径 assets/screens/...，适配 GitHub Pages 子路径 /rental-os-website/。
