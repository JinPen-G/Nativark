# 后台工作区表面与页面入场

这是现有后台的有限共享层，负责左侧导航引发的页面层叠切换，以及已有页面的单次淡入。外层 Card 与材质 class 已取消，不重新给搜索和表格套容器。

## 使用与职责

- `GlassWorkspace.module.css` 的 `surface`：保留为未启用参考，不被订单页引用；不得为了用上材质重新给搜索和表格套容器。订单页间距直接复用 foundation 的 `--space-*`。
- `WorkspaceNavigation`：只由 AppShell 左侧导航触发。新页面从内容区下方覆入，旧页面缩至0.94并淡至0.6，500ms，沿Animate UI stack的resize曲线；参数由ADMIN_NAVIGATION_MOTION维护。侧栏、顶部栏保持稳定，详情跳转、内部Tab、筛选和排序不触发。
- `WorkspaceRouteReady`：在原Suspense内报告目标路由已提交，避免把懒加载占位当作目的页面。使用浏览器快照，只有一份活跃React页面，不复制旧表单、查询或事件。
- `PageEnter`：固定版本 Animate UI Fade 的一次页面入场。层叠导航时跳过淡入，避免双重入场；首次进入等原有场景保持现状。不能按筛选/分页/请求状态改变 key。
- 原 UIArc 控件及动效仍走 `@/components/ui`；不在这里重复实现或包装相同动效。

## 来源与许可

固定提交、文件和规范化 LF 的 SHA-256 见 [sources.json](sources.json)。Fade、视口 hook 和 Slot 保留上游逻辑，仅归一导入路径；`classNames.ts` 是普通 CSS module 类名的本地导入桥，不处理 Tailwind utilities，`PageEnter` 不开放 `asChild`。

层叠切换对照Animate UI文档站`effect="stack"`及固定版本PageTransition实现，仅适配该效果与参数。上游完整组件要求React 19.3；本项目保留React 19.2，以原生Document.startViewTransition适配现有React Router，没有安装或升级依赖，不声称直接运行上游完整组件。

Animate UI 此次实际取得的版本采用 **MIT + Commons Clause License Condition**，不是不附条件的纯 MIT；完整原文保留在 [许可文件](vendor/animate-ui/LICENSE.md)。按该原文作为应用组成使用，不将这些组件单独或打包为组件商品出售/再分发。未来扩展分发方式时重新核对许可，不只照旧文档简称。

Solid Glass 的边缘光照思路来自固定提交的 `src/solid-glass.css`，采用 [MIT](vendor/solid-glass/LICENSE)。经负责人确认改为黑白边缘质感：不沿用其带色底面、透明度与大幅阴影参数，不声称完整原样移植。派生值集中在 `GlassWorkspace.module.css`，没有复制整个 shadcn/Tailwind 主题、其控件、字体、图标或 AI blocks。

## 兼容与回退

- `.surface` 只有黑白边缘处理，背景沿用既有不透明承载；不依赖 backdrop-filter。更高对比度和强制颜色模式保留明确边界。
- `PageEnter` 通过原公开参数适配 reduced-motion，不改 vendor，不额外加入 transform/layout 动画。
- 层叠导航在不支持View Transitions、减少动态、已有模态浮层/主题过渡时直接导航；移动端抽屉保留原退出动效。重复点击当前页不播放。连续导航以最后一次为准；隐藏、改变窗口尺寸或超时释放快照与inert状态。慢路由不为动效额外延迟业务请求，2秒上限只防渲染锁悬挂。
- 容器不设置 overflow 裁切；紧凑筛选工具条局部层级高于表格固定列。原分段控件自行负责横向滚动，外层不再嵌第二个滚动轨道。
- 不对 portal、全局背景或主题扫屏做材质覆盖。若某处必须改原控件效果才成立，则该处不应用材质。

## 核验边界

2026-10-25在用户登录的真实Chrome中核对运营概览→会员方案→器材型号。捕获到stack进入/退出关键帧，顶部栏与侧栏边界一致，结束后inert及标记已清除。证据见`output/playwright/workspace-stack-*`。完整连续点击、移动端与减少动态浏览器复核未完成：独立窗口随后关闭，重启被工具策略拒绝；已按用户选择请求打开内置浏览器。静态/类型检查不替代这些交互验收。未保存业务表单、安装依赖或部署。
