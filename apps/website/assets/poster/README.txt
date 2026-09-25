放置各背景视频的封面图（视频加载前先显示，避免黑屏闪现）。

期望文件名（与 data-video 同名，webp）：
  hero-main.webp / hero-anything.webp / hero-business.webp / hero-brand.webp

建议：与对应视频首帧一致，webp 压缩。
说明：缺失时回退到场景 --scene-fallback 现有 webp 底图，再兜底近黑底 #0b0f14。
路径为相对路径 assets/poster/...，适配 GitHub Pages 子路径 /rental-os-website/。
