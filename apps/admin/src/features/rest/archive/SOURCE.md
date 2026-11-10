# 播放器组件来源

来源：[UIArc Now playing](https://uiarc.dev/components/now-playing) · [UIArc Media player](https://uiarc.dev/components/blocks/media-player)。由负责人指定的 UI 对话在本地 `uiarc-pro-archive` 组件库依据公开预览、公开 CSS 与文档独立还原；不是取得的官方 Pro TSX，不声称拥有 Pro 源码许可。公开资料原来源及许可界限继续保留，项目许可证不重新授予第三方素材权利。

本目录消费 UI 对话于2026-11-11冻结的 `snapshot-v3`，ZIP SHA-256：`f46032b9196f97ce6f8b925796538ef26f59828314d29f7e8ded79b2d200aeb1`。12个组件文件逐字节保留，未改内部样式、类型、控制与动效；只保留运行所需源码，没有复制演示音轨、示例图片、依赖或构建目录。v3包含原站64px／411px本体尺寸、30px／20px展开圆角、深色变量、同名曲目身份和统一Hook驱动的减少动态修正；[逐文件哈希](source-manifest.json)随源码保存。

- `media-player/`：完整 MediaPlayer、Transport与受控播放类型；音量0～1，时间为秒，coverSlot为宿主提供媒体内容。
- `now-playing/`：原缩小／展开、封面、进度手势及播放控制；没有内部模拟播放时钟。
- `primitives/motion.ts`：原组件运动参数。后台已有 [Motion适配](../../../../config/motionPreferenceAdapter.ts)在构建期仅把此模块的偏好Hook绑定到全局 System／Full／Reduced，源码和CSS保持原样。
- [RestExperience](../RestExperience.tsx)负责窗口位置、计时、关闭及官方可见IFrame；[YouTube适配](../youtubePlayer.ts)负责实际播放和清理。官方YouTube资源在线加载，不提取、不缓存或转存完整歌曲；供应商拒绝嵌入时按实际错误显示。用户可另外选择已有[本地音频](../localAudioPlayer.ts)，文件不上传且不因封面而宣称属于官方录音。

原组件供应方已完成类型、格式、CSS引用检查；这不是Rental OS宿主或官方媒体的运行验收。消费方的实页、失败状态和验证边界只维护于[管理后台开发记录](../../../../../../docs/管理后台/管理后台-开发记录.md)。
