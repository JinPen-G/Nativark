放置官网 2.0 预约型首页 Hero 的背景视频（自动播放 / 静音 / 循环 / 无控件 / playsinline）。

命名规则：按「品类 id」命名，文件放进来、名字对上即自动生效（配置见 src/data/heroConfig.ts）。
演示模式（?tenant=single|double|multiple）的品类 id：
  vehicle.mp4        出行用车
  camera.mp4         摄影器材
  camping.mp4        露营装备
  digital.mp4        数码硬件
  construction.mp4   工程工具
  home.mp4           家居用品
  baby.mp4           母婴用品
  sports.mp4         运动户外
真实租户模式：品类 id = 已发布服务的 code（例如 CAMERA/VEHICLE 服务对应各自 code）；
按该 code 命名即可，未提供则回退到品类底图。

建议：H.264 / MP4，1080p 起步，合理控制码率避免拖慢首屏；每品类主体尽量居中或按
heroConfig.ts 里的 objectPosition/objectPositionMobile 调整裁切位。
说明：视频缺失/加载失败时，Hero 自动回退到该品类现有 webp 底图，再兜底深色底，绝不破坏布局或黑屏。
移动端只加载当前品类视频，切换时才加载目标视频，避免一次性下载多个高清视频。
