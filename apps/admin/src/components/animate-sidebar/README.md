# Animate UI 原版应用侧栏

来源：[Base UI Sidebar](https://animate-ui.com/docs/primitives/base-ui/sidebar)，固定提交与 SHA-256 见 sources.json；许可见 LICENSE.md（MIT＋Commons Clause）。vendor 保留原始示例与依赖组件，runtime 只做导入、可访问文案和 portal 主题接入；原始尺寸与动效保留在 runtime，中文菜单在集成层调整；`sidebar-adapter.css` 将圆角按三组接入平台现有 token，保留原圆角外壳与内容面板。

- `NativeNavigation`：授权路由、短名称、分组与真实菜单搜索。
- `NativeWorkspaceSwitcher`：既有品牌与空间切换命令；不改变权限或缓存边界。
- `NativeAccountMenu`：原 NavUser 布局、示例默认头像，替换为真实设置/订阅/主题/语言/退出。
- `animate-sidebar.css`：原主题与 Tailwind 类；构建适配将 reset、变量和 portal 限定在侧栏，正文为作用域边界。半透明浮层沿用原样式。
- `MotionPreferenceProvider`：原 AnimateUIProvider 读取全局有效动效偏好，不重新挂载业务表单。

侧栏与圆角内容面板背后的背景共用 `--rental-sidebar-surface`，去除重复分隔边框。菜单和高亮/搜索/浮层分别复用按钮/输入框/容器圆角，头像保持圆形；空间下拉保留原图标槽，以品类 SVG 表达空间，顶部品牌 Logo 不变。

源码默认宽度为 16rem / 3rem / 18rem；后台由 `ADMIN_SIDEBAR_METRICS` 统一适配为 240px 展开、48px 收起，32px 主/子菜单行高、1px 行间距、24px 分组名、18px 图标。移动端保留原 Sheet 规则。顶部收缩按钮 28px、品牌/头像 32px、空间/账号入口 48px 保持原尺寸。用户弹窗保留 min-w-56、对齐与 4px 偏移，不另加宽高。

## 状态与交互

Provider 使用公开的 `animateOnHover=false`，避免焦点/展开项与新悬停项争抢浮动高亮；原收缩和浮层动效保留。当前路由以 `data-active` / `aria-current` 表达，账户主色与对比文字色通过根节点语义 token 接入，不能被本地参考配色覆盖。选中背景使用原 Animate UI `effects/highlight` 的受控 parent 模式，沿当前授权路由平滑移动，保留原生 highlight 弹簧与减少动态支持；hover/click 均关闭，悬停和焦点不改选中状态。当前分组关闭或侧栏收起时，背景移至所属分类；搜索无当前项时隐藏高亮。子项背景跟随原链接的 -1px 位移，避免错位。

收起态分类使用原 DropdownMenu 在右侧显示二级菜单，最小宽度由 `submenuMinWidth`（160px）维护、条目至少32px高，保留原浮层动效/主题/容器圆角。点击不会展开侧栏；选择后二级项自动关闭浮层，保持48px收起态；Enter/Esc及点击外侧沿用原键盘/焦点行为。展开态与移动抽屉仍使用内联折叠组。收起态图标居中，不保留隐形标签宽度或箭头占位。

页面入口使用 `data-sound="page"`，分类使用 `press`，统一由现有 GlobalInteractionSounds 处理；快照捕获期间的可信点击回放单独调用同一偏好门控，合成点击不再次播放。切换音效开关和动态偏好不修改业务记录。

## 回退

修改前基线：`b747e48c`；本地标记：`backup/admin-sidebar-before-animate-20261026`。首次接入提交：`978a7a55`。原 `AccountMenu`、`WorkspaceSwitcher`、`SidebarQuickEntries` 与旧共享菜单实现保留；旧 `AppShell` 完整存在于基线。

用户要求回退时，仅撤销本次侧栏接入及其配套样式/依赖提交，保留其余页面和未知工作；不要 reset 整个分支，不删除历史组件或并行成果。
