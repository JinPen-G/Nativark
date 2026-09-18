# Rental OS 官网首屏排版验收

- source visual truth: `C:\Users\Penn\AppData\Local\Temp\codex-clipboard-b01ace79-a29f-4878-8807-318e64c84461.png`（完整首屏背景图）及 `C:\Users\Penn\AppData\Local\Temp\codex-clipboard-2a7b9358-797e-47a6-ad8a-16a24cbd21fb.png`（区域构图参考）
- brand asset: `D:\工作文件\rental-OS\Rental-OS_Brand-Assets\01_Logo\01_logo-primary-with-tagline_官网宣传.png`，页头和页脚统一使用官网宣传版 Logo
- implementation: `D:\工作文件\rental-OS\apps\website\index.html`
- implementation screenshot: `D:\工作文件\rental-OS\output\playwright\website-spacing-after-top.png`（1440 × 1000 px，CSS 1x）
- full-page implementation screenshot: `D:\工作文件\rental-OS\output\playwright\website-spacing-after-desktop.png`（1425 × 2455 px，CSS 1x）
- focused capability screenshot: `D:\工作文件\rental-OS\output\playwright\website-compact-capability.png`（1440 × 391 px，CSS 1x）
- focused multi-device screenshot: `D:\工作文件\rental-OS\output\playwright\website-multi-shifted.png`（1440 × 341 px，CSS 1x；视觉组已向左微调）
- focused implementation screenshot: `D:\工作文件\rental-OS\apps\website\.playwright-cli\element-2026-09-14T14-47-57-749Z.png`
- latest mobile screenshot: `D:\工作文件\rental-OS\output\playwright\website-spacing-after-mobile.png`（390 × 844 CSS px viewport）
- viewport: 1440 × 1000 CSS px；Hero 实际约 1425 × 619 CSS px；移动端 390 × 844 CSS px
- state: desktop 首页顶部；移动端另以 390 x 844 CSS px 检查

## Findings

- [P1] Hero 初始高度偏低，文案组靠上：Hero 改为响应式 `560–660px`，1440px 桌面视口实际约 619px；`.hero .container` 使用上下留白与 `align-items:center`，文案组按内容区垂直居中。
- [P1] 能力区与多端区曾出现大段空白及图片越界：两区改为固定桌面高度，文案与视觉都以同一中轴线居中；区块自身负责裁切，不再通过负定位制造重叠。
- [P2] 移动端继承桌面高度和裁切规则会造成空白或截断：移动端重置为 `height:auto`、`min-height:auto`、`overflow:visible`，改用纵向排列。
- [P1] 内容区字体偏小且灰度偏浅：功能卡片、行业卡片、Hero 正文、指标副文案、能力区正文和页脚字号整体上调约 1–3px，并加深正文颜色；功能卡片高度同步增加 8px 以容纳放大后的文字。
- [P2] 客户证言照片未铺满且引用扩展名不一致：头像改为填满左侧图片栏，并切换到 PNG 素材；客户案例扩展为四条可轮播的示例案例。
- [P2] 功能卡片、行业卡片和案例轮播仍使用字符箭头，尺寸、层次和交互反馈偏弱：改为统一的几何箭头、渐变圆底、内高光、悬停位移和可见焦点样式。
- [P2] 多个内容区块上下留白偏紧：按排版参考图增大指标条与首个标题、标题与功能卡、功能卡与行业标题、行业说明与行业卡，以及证言、CTA、页脚之间的垂直间距。
- [P1] Hero 背景图与桌面舞台比例不一致时按宽度 `cover` 会放大笔记本主体并压近文案：主背景已改为宽幅全出血素材，按约 `2.91:1` 的比例覆盖桌面 Hero，左右不再依赖 CSS 底色补齐；窄桌面继续使用 `cover` 与收窄文案列，移动端仍切换为纵向布局。
- [P2] Hero 只有单一产品画面，首屏视觉缺少变化：新增两张同构图比例的产品背景，并以原生 JS 自动轮播；移动端继续使用独立的笔记本素材，避免窄屏裁切。
- [P1] 官网只有浅色固定外观，深色系统环境下对比度与品牌识别不足：新增跟随系统的主题初始化，并允许访客手动切换浅色或深色模式。

## Comparison

- Full view: 首屏使用完整背景图，蓝色光效与笔记本保持同一图像比例；没有叠加编辑标注，指标条覆盖在首屏底部并与后续内容自然衔接。
- Hero background: 主图 `hero-background.png` 使用 `2880 × 990`、比例 `2.9091:1` 的全幅延展素材；三张桌面背景都由图像承担整个 Hero 舞台，不用左右 CSS 色块补齐，窄桌面允许主体区域按比例裁切但不压住文案。
- Header/hero: 顶栏右侧透出首屏背景色，左侧保留品牌 Logo 与导航的清晰白底；文案与笔记本可见主体的高度基本对齐。
- Focused region: 左侧保留现有官网文案，落在背景图的浅色留白区；右侧不再叠加旧的 CSS 光环与独立笔记本，避免产生双重背景和错位。
- Typography: 保留现有 Rental OS 字体栈与标题层级；Hero 主标题保持比例，正文、卖点、指标副文案、功能卡片、行业卡片和能力区正文已按参考图放大并加深颜色；没有新增字体依赖。
- Testimonial: 客户案例扩展为摄影器材、露营装备、车辆租赁和工程设备四条示例案例；桌面端头像填满左侧栏，支持 5.6 秒自动轮播、圆点定位、前后切换；鼠标停留不阻断轮播，键盘聚焦时暂停，移动端按整行图片展示并保持人物主体可见。
- Arrow controls: 功能卡片、行业卡片、行业场景入口和客户案例切换按钮统一使用蓝色几何箭头与轻量圆形材质；箭头不再依赖字体字形，悬停时有轻微位移与阴影反馈，键盘焦点保持可见。
- Hero carousel: 首屏使用主背景与两张新增行业化产品背景自动轮播，每 5.6 秒切换；不因鼠标停留而暂停，只有键盘聚焦、页面不可见或系统要求减少动态效果时暂停；左侧 HTML 文案层保持不动。
- Brand sizing: 页头 Logo 放大至 190px 并下移 3px，页脚放大至 210px；移动端分别控制为 158px 与 185px。
- Feature rows: “强大的产品能力”与“一个系统，多端协同”均采用左文案、右视觉的同一横向结构，文字组和图片共享垂直中线；多端协同视觉按参考图从区块底部裁切，不完整展开。
- Spacing/layout: 桌面 Hero 使用响应式高度，指标条与首屏底部保持固定叠放关系；能力区与多端区使用固定的紧凑高度并以中轴线对齐；移动端改为纵向文案、独立笔记本素材和单列指标，避免背景图裁切遮挡文字。
- Vertical rhythm: 桌面端关键间距调整为指标条→首个标题 48px、说明→功能卡 32px、功能卡→行业标题 56px、行业说明→行业卡 39px、证言→CTA 36px、CTA→页脚 26px；移动端继续使用自适应流式布局。
- Colors/tokens: 继续使用 Rental OS 蓝色主题；完整背景图承担首屏主色和光效。
- Theme: 顶栏在“预约演示”前提供主题选择；默认跟随系统，也可固定为浅色或深色，选择写入本地浏览器并在下次访问时恢复；深色模式使用深蓝底色、浅色文字和官方深色 Logo 版本，不改变品牌蓝色强调色。
- Theme control: 顶栏主题选择收窄为简洁的圆形太阳/月亮图标按钮，不显示模式文字和下拉箭头；保留菜单中的三种模式、动态无障碍标签、键盘焦点和悬停反馈。
- Image fidelity: 使用本地 Hero、官方 Logo、四张行业图及四张客户案例头像；新增的两张 Hero 背景和四张案例头像均为本地生成并通过静态服务加载，不依赖外链。
- Copy/content: 现有文案未改动；手写标注已移除，避免首屏出现未要求的额外文案。

## Verification

- Desktop browser render checked at 1440 × 1000 CSS px；Hero 实际约 619px，文案组中心与 Hero 内容中心差约 8px。
- Typography render checked；6 张功能卡片和 4 张行业卡片均无内容溢出，桌面与移动端 `scrollWidth` 均等于可视区域宽度。
- Capability and multi-device focused renders checked；两区没有相互覆盖，图片裁切落在各自区块内。
- Mobile full-page render checked at 390 × 844 CSS px viewport；Hero、能力区、多端区均纵向展开，没有桌面固定高度造成的空白区。
- Mobile section flow checked；多端区改为自适应高度后不再覆盖证言区，证言头像与图片容器尺寸一致。
- Vertical spacing checked；桌面关键区块留白与排版参考图的层级关系一致，移动端页面总宽度与可视区域一致。
- Hero background checked at 901px、1024px、1440px 和 1920px desktop widths；主图以全幅 `cover` 覆盖 Hero，左右没有 CSS 补色带，原图主体不再被宽屏放大，文案与电脑主体不重叠，Hero 的 `scrollWidth` 与可视宽度一致。
- Theme checked in desktop and mobile browsers；默认 `system`、手动 `light`/`dark` 三种偏好均可切换并在刷新后保持，系统主题变化只在跟随系统时生效；菜单支持点击外部关闭与 Escape 返回主题按钮，桌面/移动端 `scrollWidth` 均未超出可视区域。
- Hero carousel checked；等待一个轮播周期后由当前背景切换到下一张，三张背景引用均返回 HTTP 200；鼠标移入 Hero 后仍持续切换，键盘聚焦、页面不可见和减少动态效果时按预期暂停，移动端仍隐藏桌面背景层并保留原有笔记本展示。
- Testimonial carousel checked；等待一个 5.6 秒周期后客户案例会自动切换，鼠标停留或点击切换按钮不会让自动轮播永久停住，键盘聚焦时按预期暂停，圆点与前后按钮仍可手动切换。
- Arrow controls checked；功能卡片、行业卡片、行业场景入口与客户案例前后切换均显示统一几何箭头，悬停反馈不改变布局；按钮焦点可见，移动端卡片无箭头遮挡或横向溢出。
- `scale: css` screenshots used for comparison；源图按像素尺寸记录，未做额外密度放大。
- Browser console: 页面包含内联客户案例轮播脚本；轮播切换无运行时错误，已补充项目正式 favicon.ico，静态预览不再缺少浏览器图标资源。
- Static asset requests: 页面引用的 Logo、背景、功能、行业及四张案例头像均返回 HTTP 200。

## Comparison history

1. 初始版本：Hero 过矮、文案偏上，能力区和多端区依赖绝对定位，存在越界和大段空白。
2. 第一轮修复：能力区与多端区改为横向对齐并增加区块高度，解决图片重叠，但高度留得过大。
3. 第二轮修复：两区改为固定桌面高度，文案和视觉使用同一中轴线居中，并重置移动端为自适应布局。
4. 当前轮：Hero 提升至约 619px，容器使用 flex 垂直居中；桌面和移动端重新截图复核。
5. 字体可读性修复：正文、卡片、指标和页脚文字放大并加深颜色，卡片高度同步补足；重新复测无溢出。
6. 多端协同微调：右侧电脑与手机视觉组向左收进，桌面端保持完整可见，移动端布局不受影响。
7. 垂直节奏调整：增大首屏指标与内容区、功能卡与行业区、证言与 CTA、CTA 与页脚之间的留白，重新复测桌面与移动端。
8. Hero 背景适配：停止 `cover` 放大裁切，改为按原图比例适配 Hero 高度并贴右显示，复测标准与宽屏视口。
9. 客户案例轮播：新增三张本地生成的案例头像与三条示例文案，接入 5.6 秒自动轮播、手动切换、键盘聚焦暂停和移动端自适应；鼠标停留不阻断自动切换。
10. Hero 背景轮播：新增两张本地生成的宽屏产品背景，接入 5.6 秒自动切换、键盘聚焦暂停、减少动态效果兼容和移动端降级；鼠标停留不阻断自动切换。
11. 箭头质感统一：卡片、行业入口、案例切换和 CTA 按钮改用 CSS 几何箭头，增加渐变圆底、内高光、阴影和悬停/焦点反馈。
12. 深色模式：主题按钮放在顶栏预约演示前，默认跟随系统，支持手动选择浅色/深色并记住偏好；补齐深色背景、卡片、文字、按钮、图片处理与深色 Logo，并复测桌面、移动端和键盘关闭行为。
13. Hero 窄桌面适配：在 901–1180px 使用 `cover` 并收窄文案列、调整背景水平裁切，避免电脑主体压住文案；宽桌面则按 Hero 高度显示背景，复测 901px、1024px、1440px 与 1920px。
14. Hero 轮播可见性：自动切换间隔调整为 5.6 秒，取消鼠标悬停暂停，避免用户停留在首屏时误以为没有轮播；保留页面不可见、键盘聚焦和减少动态效果的暂停规则。
15. 主题控件简化：右上角只保留当前生效主题的太阳/月亮图标，点击后仍可选择跟随系统、浅色或深色；移除按钮内的模式文字与下拉箭头，保留 aria-label、title 和键盘可达性。
16. Hero 原图比例修复：宽桌面不再用 `cover` 放大 2880×1240 原图，改用约 2.91:1 的宽幅全出血素材覆盖整个 Hero；本地轮播引用统一到实际存在的 `hero-background2.png`、`hero-background3.png`。
17. Hero 全幅背景修复：主图替换为 `2880 × 990` 的宽幅延展版本，恢复 `cover` 作为唯一桌面背景适配方式，去除左右 CSS 颜色补齐，确保图片、光效和地面反射在同一张图内连续。

## Follow-up polish

- 等用户提供下一版效果图和 UI 素材后，再继续对照具体区块做一比一的字号、裁切、边距和交互微调。

final result: passed
