放置各品类 Hero 视频的封面图（视频加载前先显示，避免黑屏闪现）。

命名规则：与视频同名，按「品类 id」命名（配置见 src/data/heroConfig.ts）：
  vehicle.webp / camera.webp / camping.webp / digital.webp /
  construction.webp / home.webp / baby.webp / sports.webp
真实租户模式：文件名 = 已发布服务的 code。

建议：与对应视频首帧一致，webp 压缩。
说明：poster 缺失时，Hero 直接回退到该品类现有 webp 底图（heroConfig.ts 的 fallbackImage），不会黑屏。
