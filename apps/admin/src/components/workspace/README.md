# 后台工作区表面与页面入场

这是后台的共享连续交互层，负责左侧导航层叠、普通路由入场和状态内容更换。外层 Card 与材质 class 已取消，不重新给搜索和表格套容器。

## 使用与职责

- `GlassWorkspace.module.css` 的 `surface`：保留为未启用参考，不被订单页引用；不得为了用上材质重新给搜索和表格套容器。订单页间距直接复用 foundation 的 `--space-*`。
- `WorkspaceNavigation`：AppShell左侧导航使用stack，新页面从内容区下方覆入，旧页面缩至0.94并淡至0.6，500ms，沿Animate UI stack的resize曲线；参数由ADMIN_NAVIGATION_MOTION维护。详情、返回和其他普通路由在就绪后短淡入；内部Tab、筛选和排序不触发路由层动效。侧栏与顶部栏保持稳定。
- `WorkspaceRouteReady`：在原Suspense内报告目标路由已提交，避免把懒加载占位当作目的页面。使用浏览器快照，只有一份活跃React页面，不复制旧表单、查询或事件。
- `PageEnter`：保留固定版本Animate UI Fade；在WorkspaceNavigation内统一抑制，由工作区负责入场，避免双重淡入。不能按筛选/分页/请求状态改变key。
- `ContentTransition` / `useContentTransition`：使用已安装Animate UI 2.3.0的fade token与tempo API，200ms；起始透明度由ADMIN_CONTENT_MOTION维护。只在明确的内容状态变化后播放，保持节点、表单和焦点的原所有权，不复制退出树、不设key、不改变定位上下文。层叠或父层淡入时跳过；中断、减少动态及卸载恢复原透明度并清除标记。
- QueryState负责loading/error/ready；外置页签传transitionKey。列表/卡片共享内容层；原Tabs、卡片预览和Motiq不叠同职责动画。多选浮栏使用原Animate UI Slide与8px短位移、200ms淡入淡出，退出即inert；导入/批量确认保留Modal关闭周期，完成后再卸载。
- 原 UIArc 控件及动效仍走 `@/components/ui`；不在这里重复实现或包装相同动效。
- 动效偏好由外观页的“跟随系统 / 完整动效 / 减少动效”控制，默认跟随系统，当前浏览器保存、立即生效。`motionPreferences` 是唯一解析入口；构建适配统一原组件的偏好 hook 和 CSS 媒体规则，vendor 源码不改。减少动效直接导航并释放快照；切回完整动效恢复原参数，不重挂业务页。

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

2026-10-26在用户登录的真实Chrome中逐页打开当前账号的28个租户入口并截图，核对切换收尾、横向溢出及锁定残留；详情进入/返回覆盖订单、个人会员、企业会员，库存与业务规则外置页签均观测到内容过渡。列表/卡片连续切换保留选择，多选浮栏与导入/批量确认退出生命周期已核查。动态偏好切换保留未提交的搜索文字和节点；跟随系统减少动态时无快照、淡入和锁定残留，明确完整动效可覆盖系统偏好；390px库存无页面横向溢出。未执行导入、停用等业务命令。证据位于`output/playwright/admin-motion-review/`及同级定向检查记录。SaaS专属页面和Electron运行时未做浏览器验收；共享接入的静态检查不能替代这些验收。未安装依赖、保存业务配置或部署。
