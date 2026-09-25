放置平台官网 2.0 首页的背景视频（自动播放 / 静音 / 循环，无控件）。

期望文件名（与页面中各 <section class="v2-scene"> 的 data-video 对应，可自由增删）：
  hero-main.mp4      首屏 Hero：ONE OS. EVERY RENTAL BUSINESS.
  hero-anything.mp4  第二幕：ANYTHING CAN BE RENTED.（多品类）
  hero-business.mp4  第三幕：ONE BUSINESS. ONE SYSTEM.（完整业务）
  hero-brand.mp4     第四幕：BUILT FOR RENTAL.（品牌收束）

建议：H.264 / MP4，1080p 起步，合理控制码率避免拖慢首屏；移动端可在对应 <section>
上加 style="--scene-pos-mobile:60% center" 调整裁切位，避免主体被裁。
说明：文件缺失时页面自动回退到 poster / 场景 --scene-fallback 底图（现有 webp），
不会黑屏或破坏布局。路径为相对路径 assets/video/...，适配 GitHub Pages 子路径 /rental-os-website/。
