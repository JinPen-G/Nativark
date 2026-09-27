# 可继续开发的 Primefold 静态源码

这是重新编写的 HTML / CSS / JavaScript 首页，不是把下载站的编译 bundle 再包一层，也不是恢复作者原始 Framer 工程。

原模板的英文文案、图片、标志、字体、Lottie 动画素材保留；没有换成 Rental OS 内容。原下载站仍在上一级 `index.html` 与 `assets/`，未覆盖。

## 预览

在上一级目录运行现有静态服务器：

```powershell
node serve.mjs
```

打开 `http://localhost:8137/source/` 看可编辑版本；`http://localhost:8137/` 看原下载模板。

部署时直接上传整个 `source/` 目录，入口是 `index.html`。不用 React、Framer、npm 安装或编译。建议通过 HTTP 预览，不要双击 HTML：Lottie JSON 和 WebGL shader 使用 `fetch`，本地文件协议可能阻止加载。

## 后续修改位置

| 要修改的内容 | 文件 |
| --- | --- |
| 文案、导航、按钮链接、图片引用、卡片结构 | `index.html` |
| 颜色、字体、间距、尺寸、布局、响应式规则 | `styles.css` |
| 菜单、轮播、卡片堆叠、入场动画、Lottie 控制 | `js/main.js` |
| 底部动态波纹背景的 WebGL 渲染及参数 | `js/effects.js` |
| 图片及标志 | `assets/images/` |
| 原模板图标 | `assets/icons/` |
| 原模板字体 | `assets/fonts/` |
| 原 Lottie JSON 和波纹 shader | `assets/animations/` |

`styles.css` 顶部 `:root` 是通用颜色与宽度参数。主要响应式断点为 1199、959、599px；每块区域都有语义化 class 和注释。网站不需要 `output/` 中的检查脚本。

## 交互与动效

- Hero 三张轮播、进度条、点击和键盘选择、移动端切换按钮。
- 滚动后的玻璃导航、桌面下拉、移动端菜单。
- 客户标志滚动、区块入场淡入。
- 产品卡片悬停 Lottie、移动端 sticky 堆叠缩放。
- 客户故事循环轮播和拖动、团队卡片横向滚动。
- 信任区原 Lottie 动画、指标文字入场。
- 底部 WebGL 波纹、页尾 sticky 大字标志。
- 减少动态效果偏好支持、Cookie 选择本地保存。

交互源码是重新实现的，动画时序并非作者原始 Framer 时间线逐帧恢复。Lottie 的内部绘图/动画仍来自原 JSON；如需修改内部构图，要编辑该素材，而非修改页面 HTML。

## 范围与安全

本地验证已通过 34 项 Edge 浏览器回归检查，响应宽度覆盖 320–1920px；桌面和手机截图已与原模板对照。详细证据、差异及尚未测试的范围见上一级 [设计与交互复核](../design-qa.md)。这不是上线或跨浏览器验收结论。

本次只重建这份首页。外链保持原模板目标，其他页面没有复制。邮件订阅仅为本地预览反馈，不向原站或第三方提交数据；真实订阅、账号及后台接口尚未接入。Cookie 弹窗使用原生 dialog 重写，没有接入原站统计或营销脚本。

图片、字体、标志与原动画的权利归原作者/权利人；商用发布前需确认模板及素材许可。Lottie 播放器使用 [lottie-web 5.13.0](https://github.com/airbnb/lottie-web)，MIT 许可文件随播放器保存在 `assets/vendor/`。
