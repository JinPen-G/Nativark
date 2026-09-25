放置各视频的封面图（视频加载前先显示，避免黑屏闪现）。

期望文件名（与 src/data/heroScenes.ts 对应）：
  hero-01.webp ... hero-05.webp

建议：与对应视频首帧一致，webp 压缩。
说明：缺失时自动回退到 heroScenes.ts 里配置的 posterFallback（现有 webp 底图）。
