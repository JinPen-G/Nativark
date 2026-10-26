# Animate UI 原版应用侧栏

来源：[Base UI Sidebar](https://animate-ui.com/docs/primitives/base-ui/sidebar)，固定提交与 SHA-256 见 sources.json；许可见 LICENSE.md（MIT＋Commons Clause）。vendor 保留原始示例与依赖组件，runtime 只做导入、可访问文案和 portal 主题接入；几何与原动效保持原版。

- `NativeNavigation`：授权路由、短名称、分组与真实菜单搜索。
- `NativeWorkspaceSwitcher`：既有品牌与空间切换命令；不改变权限或缓存边界。
- `NativeAccountMenu`：原 NavUser 布局、示例默认头像，替换为真实设置/订阅/主题/语言/退出。
- `animate-sidebar.css`：原主题与 Tailwind 类；构建适配将 reset、变量和 portal 限定在侧栏，正文为作用域边界。半透明浮层沿用原样式。
- `MotionPreferenceProvider`：原 AnimateUIProvider 读取全局有效动效偏好，不重新挂载业务表单。

原宽度常量为 16rem / 3rem / 18rem；移动端同时保留原 Sheet 的 3/4 可用宽度与最大宽度规则，不额外强制像素。原菜单按钮 32px、子项 28px、顶部收缩按钮 28px、品牌/头像 32px、空间/账号入口 48px。用户弹窗保留 min-w-56、对齐与 4px 偏移，不另加宽高。

## 回退

修改前基线：`b747e48c`；本地标记：`backup/admin-sidebar-before-animate-20261026`。首次接入提交：`978a7a55`。原 `AccountMenu`、`WorkspaceSwitcher`、`SidebarQuickEntries` 与旧共享菜单实现保留；旧 `AppShell` 完整存在于基线。

用户要求回退时，仅撤销本次侧栏接入及其配套样式/依赖提交，保留其余页面和未知工作；不要 reset 整个分支，不删除历史组件或并行成果。
