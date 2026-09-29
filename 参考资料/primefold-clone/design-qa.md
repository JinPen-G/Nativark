# Primefold 可编辑静态源码 — 设计与交互复核

final result: passed — 本地基础回归与本轮新增动效检查；不代表逐帧完全一致

## 对比目标与证据

- 原下载模板：项目根目录 `index.html`，预览 `http://localhost:8137/`。
- 可编辑实现：`source/index.html`，预览 `http://localhost:8137/source/`。
- 浏览器：Microsoft Edge，经 Playwright CLI 驱动；不是只做静态/构建检查。
- 桌面 CSS 视口 1440 × 1000；原图与实现截图均 1440 × 1000 像素，devicePixelRatio 为 1。
- 手机 CSS 视口 390 × 844；原图与实现截图均 390 × 844 像素，devicePixelRatio 为 1。
- 未进行密度缩放。对比图左右并排，顶部加 28px 说明条，截图不含浏览器 chrome。
- 顶部对比为 Platform 第一张 Hero、Products 下拉展开；正文对比为相同滚动位置、菜单关闭。移动端使用同视口，但不是实体手机触摸测试。
- 捕获前移开指针并解除焦点；原模板的滚动定位会受延迟布局和 scroll anchoring 影响，等待入场后再次定位并记录实际 scrollY。

原图路径：`output/playwright/source-desktop-menu.png`、`source-desktop-{1250,2250,3150,3950,4750,5550,6250,7000}.png`、`source-mobile-fresh.png`、`source-mobile-{850,2200,3550,4600,5800,7100,8400}.png`。

实现截图：`output/playwright/built-desktop-{0,1250,2250,3150,3950,4750,5550,6250,7000}.png`、`built-mobile-{0,850,2200,3550,4600,5800,7100,8400}.png`。

全视图并排对比：`output/playwright/compare-desktop-top.png`、`compare-desktop-2250.png`、`compare-desktop-5550.png` 及同目录各 `compare-*.png`。

局部并排对比：`output/playwright/focus-desktop-top.png`（导航字体、下拉）、`focus-desktop-2250.png`（产品视觉）、`focus-desktop-5550.png`（指标/正文）、`focus-mobile-7100.png`（手机指标排版）、`compare-mobile-team-detail.png`（320 × 364px 团队卡片）。

## 发现与修复历史

### 第一轮：blocked

- [P2] Hero 与客户故事图像明暗不一致。最初依赖原图的暗色，遗漏模板的黑色覆盖层；对照 DOM 渐变/不透明度后，加入原模板数值的覆盖层。修复后证据：`compare-desktop-top.png`、`compare-mobile-top.png`。
- [P2] 页尾布局、背景和列宽偏差；960px 还出现横向溢出。重写底部面板层级及网格断点，保持原模板背景/大字标志结构。修复后证据：`compare-desktop-7000.png`、`compare-mobile-8400.png` 和宽度测试。
- [P2] 客户故事标题曾使用错误的展示字体，改变换行。恢复原模板 Stack Sans Headline；移动端按原模板使用 ABC Favorit。修复后证据：`compare-desktop-3150.png`、`compare-mobile-3550.png`。

### 第二轮：blocked

- [P2] 悬停 Lottie 错误隐藏产品原图，出现空白视觉区。现在浮层只叠加，不隐藏底图；移动端 Experience 卡片在可见时播放，Property 保留建筑与租约预览。修复后证据：`compare-mobile-2200.png`；回归检查：`product hover retains base image`、`product hover reveals lease card`。
- [P2] 指标按字符动画时允许逐字换行，手机端挤压正文。设为 nowrap、固定字符高度，并恢复原模板 ABC Favorit 350、80px、ss11、0.05em 字符间距。修复后证据：`focus-mobile-7100.png`、`focus-desktop-5550.png`；回归检查：`mobile metrics stay on one line`。
- [P2] Property 手机视觉高度过大，且租约预览未进入画面。恢复 376px 视觉区、原 PDF 素材与预览内容；修复后证据：`compare-mobile-2200.png`。
- [P2] 手机第三张 sticky 产品卡片过早离开固定区域，留下过大的空白。保持原区块总高度，修正 sticky 容器的底部内边距；修复后证据：`compare-mobile-3550.png`。
- [P2] 手机团队卡片曾为 340 × 444px，而原模板实际为 320 × 364px；正文也因容器宽度不同多换行。按源 DOM 恢复尺寸、401px 内部文字区域及右对齐控制，修复 scroll-snap 初始偏移，并补回区块底部留白。修复后证据：`compare-mobile-4600.png` 与独立卡片局部对比。
- 捕获修正：前次鼠标焦点使正文截图残留 Products 下拉；原模板延迟排版会将截图实际 scrollY 改变 64px。重新捕获相同状态，避免把截图状态差异误当布局差异。

### 前轮复核（基础交互与静态截图）

前轮完成基础交互与截图复核，但这些检查没有覆盖悬停宽度过渡、数字滚轮内部帧和滚轮惯性。用户后续指出 HTTP 运行下的额外动效缺失，本轮重新核验并补齐，不能用之前的 34 项结果证明完整动效一致。

34 / 34 项 Edge 浏览器检查通过，九档宽度没有页面横向溢出；图片全部解码，测试过程无页面运行异常及 HTTP 400+ 响应。静态引用无缺失，两个自编写脚本语法检查通过，原下载首页未改动。此结果为本地重建版本交付检查通过，不代表原作者工程恢复、线上发布或跨浏览器验收。

### 本轮：HTTP 运行态动效补齐

对 `http://localhost:8137/` 的悬停/滚动状态采样，并阅读下载目录内的组件参数，未修改原模板或引入其 React / Framer 编译 bundle。

- [P2，已修复] 产品卡片缺少横向伸展。恢复 XI / RI 悬停权重 2.7、mass 1 / stiffness 210 / damping 30 的可打断弹簧；CI 在原运行态没有悬停展开，保持原状。标题保留，状态补充信息在右侧浮现，桌面 Explore 按钮出现。
- [P2，已修复] XI 浮层素材映射错误，RI 还会显示 XI 的调查数据。XI 改用原组件引用的 `xNm1ok67qiSXrtlhAImlRlSghE.json`，696 × 376；RI 去掉错误浮层，恢复 383 × 312 建筑与 227 × 312 租约并排展开。收窄时保留固定尺寸照片的裁切窗口。
- [P2，已修复] 数字区被简化为单次淡入。恢复四重字符纵向滚轮、单字 500ms / 间隔 100ms、blur 0–2–2–0px 和原 cubic-bezier；可点击/键盘重播，减少动态效果时静止。
- [P2，已修复] Hero 原横向切换被替换为淡出淡入。恢复图片 300ms、内容 1000ms、递增 60 / 80 / 100px 的水平位移，以及原按钮 7px 模糊的橙青光晕。轮播周期恢复 6 秒。
- [P2，已修复] 滚轮直接跳动，未复现原 Lenis 的阻尼。使用可读原生控制器恢复 lerp .1 的时间归一阻尼，不复制完整框架；菜单/弹窗/嵌套滚动区不劫持，外部 scrollTo、键盘、触摸及减少动态效果可打断。
- [P3，已修复] 小圆点之前旋转单个字符，客户标志缺少错峰入场，故事拖动只在释放后跳转。分别恢复 80ms 字符帧、20px / 300ms / 80ms 标志入场，以及实时跟手拖动。

新增测试脚本：`output/playwright/test-restored-motion.js`。证据包含 `restored-xi-mid.png`、`restored-hover-{xi,ri}.png`、`restored-metric-{mid,end}.png`、`restored-hero-mid.png`、`restored-mobile-hero.png`；原运行态为 `motion-ref-*.png`、`ref-hover-{xi,ri,ci}.png` 与 `motion-original.json`。最终测试结果写入 `restored-motion-results.json`、`restored-regression-results.json`。

检查的不仅是最终 class：实际采集了卡片中间宽度、数字中间 transform/blur、首屏横移矩阵、释放前拖动距离、滚动早期与结束坐标，并检查快速打断、窗口缩小和减少动态效果。

最终结果：26 / 26 项新增动效检查和重跑的 34 / 34 项基础回归均通过；9 档宽度无页面横向溢出，两个自编写脚本语法通过，静态引用无缺失，原下载首页与 `assets/` 无 Git diff。测试期间页面无运行异常或 HTTP 400+ 请求。没有进行线上部署或 Git 推送。

### 2026-09-27：三处滚动联动补齐

前面的基础与动效回归未覆盖这三处行为。本轮先核实原 HTTP 运行态与下载组件参数，再在可读源码中恢复，没有改文案、素材或原模板。

- Hero 沿用 speed 40：向下滚动 180px 时首屏上移 72px，z-index 4 的浅色前景自然遮住轮播选项 76px；不是新增一个白色遮罩。七档滚动位置的几何与原版采样相同，回滚恢复。
- 故事大图沿用 full-page spread：1920px 视口下宽度从 1872px 收拢到 1280px，始终居中、高度保持 650px。进度由视口底部到视口高度 28%，cubic-in-out、4px 取整；七档宽度采样与原版相同。独立布局槽保持轮播步长，避免扩展宽度影响循环与拖动。
- 团队卡片沿用页面滚动增量的 40%，每事件限制 ±150px，弹簧 stiffness 110 / damping 28 / mass 0.6；向下左移，向上右移，停止滚动后平滑停住。按钮、键盘、拖动和原生滑动优先，修复自动页面定位与横移同时发生时打断手动滚动的问题。
- 依据动效检查要求验证反向滚动、实时拖动、手动打断和系统减少动态效果；减少动态效果时三处滚动联动关闭，操作控件仍可用。

新回归为 `output/playwright/test-scroll-motion.js`，记录 `scroll-motion-results.json`；截图 `scroll-restored-{hero-180,story-wide,story-narrow,team-drift,mobile-top}.png`。原版核实脚本为 `inspect-hero-cover.js`、`inspect-team-scroll.js`，不是网站运行依赖。

最终本地 Edge 检查：36 / 36 项滚动专项、26 / 26 项原动效、34 / 34 项基础交互通过。覆盖 320–1920px 九档宽度，无页面横向溢出、运行异常或缺失资源。原下载首页与素材未改动；不宣称逐帧完全一致、跨浏览器或线上验收。

## 必须检查的五个一致性面

1. 字体与排版：保留原模板本地字体素材；标题使用 Stack Sans Headline，其他 Hero / 产品标题与指标按源站使用 ABC Favorit，正文/导航使用 Inter。原模板导航为 500，不沿用 Rental OS 旧站字体设置。长指标在手机端与原模板一样保持单行并裁切，完整内容有 aria-label。
2. 间距与布局：原有区块顺序、三产品网格、客户故事轮播、团队横向卡片、Trust 双栏、指标拼接网格、页尾列结构均重建；手机端保留 sticky 产品堆叠。
3. 颜色与视觉参数：原图、黑色叠层、浅暖白背景、橙/青品牌色、玻璃导航与圆角，来自模板而非重新设计。
4. 图片与素材：复用原照片、品牌标志、产品标志、PDF、图标和 SVG 路径；没有用 emoji、占位头像或手绘 logo 替换。Lottie JSON 和 Wave Gradient shader 保留，动画宿主和交互控制重新编写。
5. 文案与内容：保留 Primefold 英文文案和原目标链接，不换成 Rental OS。订阅提交的额外反馈明确标注 Preview only，以免误向原公司提交。

## 交互与技术验证

回归记录：`output/playwright/native-test.log`。包含菜单展开/Escape、产品悬停底图、租约预览、Hero 手动/键盘/自动轮播、滚动导航与回顶、故事循环切换、团队滚动、订阅预览、Cookie 弹窗/持久化、移动菜单与 Hero 控制、减少动态效果偏好、图片解码及网络/运行异常检查。

响应宽度检查覆盖 1920、1440、1200、1024、960、768、599、390、320px。静态引用检查和 `node --check` 均运行；原 `index.html` 无 Git diff。页面运行脚本只有 `assets/vendor/lottie.min.js`、`js/main.js`、`js/effects.js`，不引用原 Framer/React 编译 bundle。

## 可接受的边界与后续微调

- [P3] 原作者工程无法从下载产物完整恢复。本轮已按可查参数补回主要遗漏类型，但原生网格弹簧、滚动控制、堆叠与逐字滚轮不等于完整 Framer / Lenis 引擎；逐帧时序、弹簧中间位置及裁切仍可能有细微差别，不宣称逐像素/逐帧完全相同。
- [P3] WebGL 波纹和 Lottie 会因时间相位产生不同截图；使用同一素材/参数，不能用两张不同时间的截图证明逐帧匹配。
- [P3] 手机端下游区块仍有少量累计位置差异，部分字体基线及按钮宽度也有细微偏差；不影响交互或内容可读性。团队卡片超出容器的文字裁切与原模板一致，未自行修改原文案。
- 实体手机、Safari、Firefox、超大字体/系统辅助功能组合未实测；Edge 响应式和减少动态效果已验证。
- 只重写这一份首页，不包含原公司的后台、账号系统或真实邮件订阅；外链仍指向原模板目标。商用前需要确认模板、字体和素材许可。

## 实施检查表

- [x] 原模板与素材未覆盖。
- [x] HTML / CSS / 主交互脚本为可读源码，无运行前编译要求。
- [x] 原模板文案、素材与区块结构保留。
- [x] 菜单、轮播、滚动及弹窗可操作。
- [x] 最后截图对比与测试记录复核完成。
