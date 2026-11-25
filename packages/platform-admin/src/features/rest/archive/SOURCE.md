# 播放器组件来源

来源：[UIArc Now playing](https://uiarc.dev/components/now-playing) · [UIArc Media player](https://uiarc.dev/components/blocks/media-player)。由负责人指定的 UI 对话在本地 `uiarc-pro-archive` 组件库依据公开预览、公开 CSS 与文档独立还原；不是取得的官方 Pro TSX，不声称拥有 Pro 源码许可。公开资料原来源及许可界限继续保留，项目许可证不重新授予第三方素材权利。

本目录消费 UI 对话于2026-11-11冻结的 `snapshot-v3`，ZIP SHA-256：`f46032b9196f97ce6f8b925796538ef26f59828314d29f7e8ded79b2d200aeb1`。12个组件文件逐字节保留，未改内部样式、类型、控制与动效；只保留运行所需源码，没有复制演示音轨、示例图片、依赖或构建目录。v3包含原站64px／411px本体尺寸、30px／20px展开圆角、深色变量、同名曲目身份和统一Hook驱动的减少动态修正；[逐文件哈希](source-manifest.json)随源码保存。

- `media-player/`：完整 MediaPlayer、Transport与受控播放类型；音量0～1，时间为秒，coverSlot为宿主提供媒体内容。
- `now-playing/`：原缩小／展开、封面、进度手势及播放控制；没有内部模拟播放时钟。
- `primitives/motion.ts`：原组件运动参数。后台已有 [Motion适配](../../../../config/motionPreferenceAdapter.ts)在构建期仅把此模块的偏好Hook绑定到全局 System／Full／Reduced，源码和CSS保持原样。
- [RestExperience](../RestExperience.tsx)负责窗口位置、计时与关闭；[原生音频适配](../localAudioPlayer.ts)使用同一Audio播放默认曲目或用户选择的Object URL，缩小态只保留组件自带的小封面。[YouTube适配](../youtubePlayer.ts)及原回归保留，但当前宿主不加载IFrame或供应商脚本。用户另选的文件不上传且不因封面而宣称属于官方录音。

默认媒体由负责人于2026-11-11指定。MP3放入本端`public/media/rest-player/all-too-well-10-minute-version.mp3`，SHA-256为`2c06b9bd5f056434cd80ec76b995607923fcc9451c51b7997d95b07f732ccf5b`、24,560,943字节、实际时长613秒；该部署资源由同目录`.gitignore`排除，不随源码上传，缺失时保留真实失败与本地选择入口。源文件不修改。方形[封面](../../../../public/media/rest-player/red-taylors-version.jpg)取自[Apple Music官方专辑页](https://music.apple.com/cn/album/red-taylors-version-a-message-from-taylor/1590368448)公开的[600×600图片](https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/15/38/9b/15389bf4-8074-06c3-11ee-655b5453af68/21UM1IM25046.rgb.jpg/600x600bf-60.jpg)，原字节SHA-256为`04bd68a3faa8bc2857df2912ad7a2a28f35b9ca18d26324a53adf5135c258c80`；没有重绘、变色或替换为视频缩略图。录音与封面的权利归各自权利人，不属于UIArc组件许可。

原组件供应方已完成类型、格式、CSS引用检查；这不是Rental OS宿主或官方媒体的运行验收。消费方的实页、失败状态和验证边界只维护于[管理后台开发记录](../../../../../../docs/管理后台/管理后台-开发记录.md)。
