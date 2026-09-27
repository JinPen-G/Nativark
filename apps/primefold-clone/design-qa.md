# Primefold 可编辑静态源码 — 设计与交互复核

final result: passed

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

### 最终复核

已完成最终截图与回归记录复核，当前未发现 P0–P2 阻断项。重新捕获实现的桌面及手机视图，复核全视图和局部对比；团队卡片另外归一到第一张进行组件截图，避免原模板横向滚动位置不同造成误判。组件的尺寸、内边距和文字换行均已恢复。

34 / 34 项 Edge 浏览器检查通过，九档宽度没有页面横向溢出；图片全部解码，测试过程无页面运行异常及 HTTP 400+ 响应。静态引用无缺失，两个自编写脚本语法检查通过，原下载首页未改动。此结果为本地重建版本交付检查通过，不代表原作者工程恢复、线上发布或跨浏览器验收。

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

- [P3] 原 Framer 时间线/物理弹簧没有源工程可恢复；原生实现保留动效种类与素材，但悬停、堆叠、逐字入场的逐帧时序与裁切位置仍可能有细微差别，不宣称逐像素/逐帧完全相同。
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
