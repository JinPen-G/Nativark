# Rental OS 官网 2.0 — 文案与双语阶段

这是重新编写的 HTML / CSS / JavaScript 首页，不是把下载站的编译 bundle 再包一层，也不是恢复作者原始 Framer 工程。

首页文字已调整为 Rental OS 的业务定位与能力介绍，并提供简体中文和英文。品牌素材保留 Rental OS 文件名，并放在模板对应的目录：页头及页脚小 Logo 共用 `assets/icons/rentalos-logo.svg`，页底大字使用 `assets/images/rentalos-wordmark.svg`，均复制自 `Rental-OS_Brand-Assets/01_Logo/新版/` 中用户提供的纯黑 SVG；浏览器标签页和首屏“Rental OS 平台”轮播选项共用 `assets/images/rentalos-icon-color.svg`，使用用户提供的渐变色图标。品牌原文件未改动。页头在深色首屏通过 CSS 反色显示为白色，滚动后及移动端浅色菜单显示黑色。原模板其余图片、Lottie 和整体排版、动效仍保留；旧官网在上一级 `index.html`，没有覆盖。

模板中的客户评价、业绩数字与 GDPR/德国托管声明没有作为 Rental OS 的真实案例使用。故事区改为明确标注的租赁业务场景示例，数字区改为平台能力文案。其余图片和动画素材内的原模板英文尚未替换。

## 预览

Windows 下双击本目录的 `start-preview.cmd`，会用本机 Python 3 启动静态服务并打开 `http://127.0.0.1:4178/`。关闭命令窗口或按 Ctrl+C 可停止预览。也可以用任意静态 HTTP 服务器服务 `apps/website`，通过 `/2.0/` 访问。以上均为本地地址，不是线上地址。

部署时直接上传整个 `2.0/` 目录，入口是 `index.html`。不用 React、Framer、npm 安装或编译。建议通过 HTTP 预览，不要双击 HTML：Lottie JSON 和 WebGL shader 使用 `fetch`，本地文件协议可能阻止加载。

## 后续修改位置

| 要修改的内容 | 文件 |
| --- | --- |
| 文案、导航、按钮链接、图片引用、卡片结构 | `index.html` |
| 颜色、字体、间距、尺寸、布局、响应式规则 | `styles.css` |
| 菜单、轮播、卡片堆叠、入场动画、Lottie 控制 | `js/main.js` |
| 中英文文案、语言选择器、语言偏好 | `js/i18n.js` |
| 底部动态波纹背景的 WebGL 渲染及参数 | `js/effects.js` |
| 图片及标志 | `assets/images/` |
| 原模板图标 | `assets/icons/` |
| Inter 字体许可 | `assets/vendor/Inter-LICENSE.md` |
| 原 Lottie JSON 和波纹 shader | `assets/animations/` |

`styles.css` 顶部 `:root` 是通用颜色与宽度参数。主要响应式断点为 1199、959、599px；每块区域都有语义化 class 和注释。网站不需要 `output/` 中的检查脚本。

## 语言与文案

页脚右下角点击展开 `简体中文 / English`，与旧官网一样是选项选择，不是开关。优先采用用户选择并保存到 `localStorage` 的 `rental-os-language`；首次访问根据浏览器首选语言自动选择：`zh` 开头的语言用简体中文，英语及其他所有语言默认英文。手动选择后刷新仍保留。支持键盘上下键、Enter、Escape 和点击外部关闭。

HTML 的 `data-i18n` 标记对应 `js/i18n.js` 中的文字键。修改文案时同时更新 HTML 中的中文默认文案及字典中的中英文；翻译只更新文字节点，不重建轮播或数字动画。

标题、正文、导航和按钮统一使用 Inter 与系统中文字体链，集中配置在 `styles.css` 的 `--font-sans`。Inter 通过 `https://rsms.me/inter/inter.css` 远程加载，不在仓库保存字体文件；远程加载失败时使用系统字体。正文 400，导航、按钮和卡片标题 500，大标题与大数字 600。原 Favorit 试用字体和 Stack Sans 已移除。Inter 使用 SIL OFL 1.1，许可声明位于 `assets/vendor/Inter-LICENSE.md`。

## 交互与动效

- Hero 三张轮播、6 秒进度条、300ms 横向滑入和 1 秒文字跟随、按钮悬停彩色光晕；点击和键盘选择、移动端切换按钮。向下滚动时 Hero 以正常速度的 40% 上移，前景浅色内容层逐渐盖住轮播选项。
- 滚动后的玻璃导航、桌面下拉、移动端菜单。
- 客户标志滚动和错峰上移入场、区块入场淡入、80ms 一帧的字符小圆点动画。
- 桌面 XI / RI 卡片悬停弹簧展开（mass 1 / stiffness 210 / damping 30，展开权重 2.7）、XI 原数据浮层、RI 建筑与租约并排；移动端 sticky 堆叠缩放。
- 客户故事循环轮播和实时跟手拖动；故事大图随滚动从全屏左右各留 24px 收拢到居中基准宽度（最大 1280px），高度不变。滚动进度从视口底部到视口高度的 28%，使用原 cubic-in-out 与 4px 取整。
- 团队卡片保留按钮、键盘、鼠标拖动和原生触摸滚动；卡片可见时按页面滚动增量的 40% 横移（每事件增量限制 ±150px），沿用 stiffness 110 / damping 28 / mass 0.6 的弹簧参数，上滚反向移动，不是定时轮播。
- 信任区原 Lottie 动画、指标四重字符滚轮（单字 500ms、逐字延迟 100ms）；点击或按 Enter / 空格可重播。
- 滚轮阻尼滚动（按原 Lenis 的 lerp .1 重写）；触摸、嵌套滚动区和打开的菜单/弹窗仍使用原生滚动，键盘与外部定位可打断缓动。
- 底部 WebGL 波纹、页尾 sticky 大字标志。
- 减少动态效果偏好支持、Cookie 选择本地保存。

交互源码是重新实现的，动画时序并非作者原始 Framer 时间线逐帧恢复。Lottie 的内部绘图/动画仍来自原 JSON；如需修改内部构图，要编辑该素材，而非修改页面 HTML。

## 范围与安全

本轮语言与交互检查记录位于上一级 `output/playwright/`，包含系统语言、刷新持久化、选择器键盘操作、双语响应式，以及 Hero 遮挡、大图收拢和团队卡片横移的回归。原模板动效核实历史位于 `apps/primefold-clone/design-qa.md`。这不是上线或跨浏览器验收结论。

官网各处「预约演示」已连接同一个原生弹窗，姓名和联系方式必填，公司/门店及需求说明选填，支持手机、邮箱或微信。提交经后端校验与限流后写入数据库，只有 SaaS 管理员能在「平台管理 → 演示预约」读取分页列表；不会创建租户或客户账号。网络异常保留表单并支持幂等重试。

原模板产品、预约平台、登录及社交外链均已移除跳转，暂保留禁用占位；以后拿到新地址再接入。页面内锚点、语言选择和本地偏好仍可用。邮件订阅仅为本地预览反馈，不向第三方发送。图片和动画内部尚有原模板内容，发布前仍需替换并确认许可。

### 预约接口配置与验证

- 在 `js/config.js` 的 `apiBaseUrl` 填实际 HTTPS API 前缀（含 `/api`），不得填管理员密钥。留空时只有本机 HTTP 预览会连接 `http://127.0.0.1:3000/api`；线上留空会提示未配置，不会假报成功。
- API 的 `CORS_ALLOWED_ORIGINS` 加入官网的完整 origin（协议、域名及可选端口），多个用逗号分隔，不带 `/rental-os-website/` 等路径，不用通配符。反向代理部署按实际拓扑设置 `TRUST_PROXY_HOPS`，否则访问者可能共用代理 IP 的限流桶。
- 部署后端前应用 `20260929120000_platform_demo_requests` 迁移。公开接口为 `POST /api/public/demo-requests`，平台列表为 `GET /api/platform/demo-requests`，后者必须使用 SaaS 管理员登录态。
- 更新时同步整套 HTML、CSS 和 JS；入口里相关资源使用同一 `v` 版本，修改这批资源时一起递增，防止旧 CSS/翻译字典与新弹窗混用。所有资源路径保持相对路径。
- 仓库根运行 `npm run test:demo-requests` 验证校验、权限、幂等、限流及链接；`npm run test:demo-requests-db` 使用本机 MySQL 管理凭据创建临时独立库，验证真实迁移和持久化后仅删除本次创建的测试库。

图片、字体、标志与原动画的权利归原作者/权利人；商用发布前需确认模板及素材许可。Lottie 播放器使用 [lottie-web 5.13.0](https://github.com/airbnb/lottie-web)，MIT 许可文件随播放器保存在 `assets/vendor/`。
