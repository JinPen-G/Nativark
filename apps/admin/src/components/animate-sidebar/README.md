# Animate UI 原版应用侧栏

来源：[Base UI Sidebar](https://animate-ui.com/docs/primitives/base-ui/sidebar)，固定提交与 SHA-256 见 sources.json；许可见 LICENSE.md（MIT＋Commons Clause）。vendor 保留原始示例与依赖组件。runtime 做导入、可访问文案、portal 主题接入，并提供可选 transition 与触发图标插槽；icon模式传入参考transition时，宽度间隔和固定侧栏使用Motion同帧驱动，未传时继续使用原尺寸与动效。租户侧栏按负责人要求参考 [UIArc Product listing 公开预览](https://uiarc.dev/components/screens/product-listing/frame) 的展开、收起和一级／二级菜单过渡，在 AppShell、NativeNavigation 和 sidebar-adapter.css 集成，不修改 vendor 或声称取得 Pro TSX。

- `BusinessShell`：管理端与企业端共用侧栏、页头插槽、内容边界与路由动效；身份、菜单和受权命令由宿主传入，不导入营运认证、API或Copilot运行时。
- `NativeNavigation`：宿主给出的路由、短名称、分组与菜单搜索；`flat`沿企业原链接和图标，内联分组继续原动画。
- `NativeContextSwitcher`：受控身份展示、已允许选项与原切换回调；防止重复提交，失败恢复入口。
- `NativeWorkspaceSwitcher`：营运宿主的既有品牌与空间切换命令，薄接共用身份视图；不改变权限或缓存边界。
- `TenantSidebarHeader`：租户身份区对齐、Logo悬停展开入口及收起态菜单搜索；空间切换继续由原子组件执行。
- `NativeAccountMenuView`：共用NavUser布局、示例默认头像、浏览器主题/语言与宿主账号动作；不读取营运会话。
- `NativeAccountMenu`：营运宿主按原权限传入订阅、设置及退出命令。
- `animate-sidebar.css`：原主题与 Tailwind 类；构建适配将 reset、变量和 portal 限定在侧栏，正文为作用域边界。半透明浮层沿用原样式。
- `MotionPreferenceProvider`：原 AnimateUIProvider 读取全局有效动效偏好，不重新挂载业务表单。

侧栏与圆角内容面板背后的背景共用 `--rental-sidebar-surface`，去除重复分隔边框。菜单和高亮/搜索/浮层分别复用按钮/输入框/容器圆角，头像保持圆形；空间下拉保留原图标槽，以品类 SVG 表达空间，顶部品牌 Logo 不变。

源码默认宽度为 16rem / 3rem / 18rem；`ADMIN_SIDEBAR_METRICS` 保留后台240px展开、48px收起的默认值，租户管理控制台与Agent侧栏按原站公开预览实测使用 `ADMIN_SHELL_METRICS` 的248px展开、56px收起。主/子菜单仍为32px行高、2px行间距、24px分组名、18px图标，移动端保留原Sheet规则。租户两种模式采用54px顶行与48px身份入口：相对侧栏8px内距，补齐右侧52px面包屑首行的1px边框差，让两侧中心线一致。保留22px品牌标志、上行13px租户名和下行12px空间名，右端为32px收缩按钮；长名称分别省略并通过title/aria保留完整值。收起态在Logo同一位置保留32px展开目标，悬停或键盘聚焦显示展开图标；空间切换入口在展开后使用。搜索收起为图标，点击展开并聚焦原菜单搜索。Logo、搜索、18px菜单图标与32px账号头像均在56px栏的中线上。移动端正文保留原28px打开入口。租户账号入口按原站44px高、两边6px内距适配，SaaS保留原48px入口。桌面内容面板上、下、右均为8px，外框仍方角贴边。用户弹窗保留 min-w-56、对齐与 4px 偏移，不另加宽高。

顶部空间入口使用原站Lucide `ChevronDown`，底部账号入口使用 `ChevronsUpDown`，均为14px、1.75线宽。空间箭头在名称后10px，普通态读取原 `text-muted`，悬停、聚焦或打开后读取前景色；账号箭头固定于入口右侧，普通、悬停和打开均保留弱色。菜单唯一滚动区使用6px滚动槽、4px可见圆角滑块与透明轨道，隐藏上下按钮；深浅色从侧栏前景和底色混合，Firefox使用原生thin回退。原站隐藏滚动条，这里按负责人要求保留细条，不改变滚动和导航语义。

## 共用宿主入口

`BusinessShell`沿当前管理主线提取，兼容企业固定`5b4398fa34ba0776e62aad5b8536dbbf1997bf5f`的品牌、账号、导航、时间及身份参数；只参考固定源码，没有覆盖企业工作树。`headerUtilities`接休息/通知/辅助面板，`headerTime`接第二行时间，页头Provider保留实际Form所属关系和当前页面标题。企业原`headerActions={<WorkspaceClock />}`自动归入时间行，其他操作仍在主按钮区。默认内容列使用同一圆角面板；`wrapContent`接完整页头/内容列，营运端交给原`CopilotLayout`保持340px独立侧板和原Sheet动效，共用框架不为客户端接入营运Copilot或休息权限。

`PageHeading`在共用外壳里将当前页名/操作送入页头，独立宿主保留原页头。自带面包屑的营运宿主用`headerTitleTarget={false}`及`WorkspaceBreadcrumbCurrent`，企业普通context默认追加当前标题。`identity`变化在绘制前取消原路由快照、释放inert与deadline，查询和客户授权仍由各宿主决定。共用文件与依赖经企业原tsconfig的固定入口覆盖在内存核验，不替代真实企业认证、浏览器或正式验收。

## 状态与交互

Provider 使用公开的 `animateOnHover=false`，避免焦点/展开项与新悬停项争抢浮动高亮。`ADMIN_SIDEBAR_REFERENCE_MOTION` 保存实测的0.3秒、bounce=0弹簧；侧栏宽度与二级菜单高度共用该弹簧，文字按150ms、cubic-bezier(.22,1,.36,1)淡出，二级内容显式收组时沿原站200ms进入／140ms退出。NativeNavigation在侧栏收起时保留同一父级和二级节点，使一级菜单随二级高度连续补位，展开恢复原组状态；退出内容立即 inert、aria-hidden，150ms后隐藏可见性。参考动效由宿主负责时不叠加原 SidebarPrimitive.Highlight 的整栏 blur 动画，选中背景仍使用独立受控 Highlight；SaaS保留原默认路径。所有参考参数沿 useTempoTransition 与共享减少动态设置。

当前路由以 `data-active` / `aria-current` 表达，租户控制台和Agent模式的菜单文字、图标、hover和选中态按UIArc Metrics Dashboard固定中性色在适配层接入，浮层同源；业务按钮和SaaS原主色保持独立。浅色外底为原foundation混合色、内容白色，深色外底19%/内容21.5% OKLCH。选中背景使用原 Animate UI `effects/highlight` 的受控 parent 模式，沿当前授权路由平滑移动，保留原生 highlight 弹簧与减少动态支持；hover/click 均关闭，悬停和焦点不改选中状态。当前分组关闭或侧栏收起时，背景移至所属分类；搜索无当前项时隐藏高亮。子项背景跟随原链接的 -1px 位移，避免错位。一级菜单高亮只测触发按钮这一行，不测包含二级菜单的整组li；该行随侧栏宽度收拢，租户收起完成后为40px宽、32px高的图标按钮。

收起态分类使用原 DropdownMenu 在右侧显示二级菜单，最小宽度由 `submenuMinWidth`（160px）维护、条目至少32px高，保留原浮层动效/主题/容器圆角。点击不会展开侧栏；选择后二级项自动关闭浮层，租户保持56px收起态；Enter/Esc及点击外侧沿用原键盘/焦点行为。展开态与移动抽屉仍使用内联折叠组。收起态图标居中，不保留隐形标签宽度或箭头占位。

页面入口使用 `data-sound="page"`，分类使用 `press`，统一由现有 GlobalInteractionSounds 处理；快照捕获期间的可信点击回放单独调用同一偏好门控，合成点击不再次播放。切换音效开关和动态偏好不修改业务记录。

## 回退

修改前基线：`b747e48c`；本地标记：`backup/admin-sidebar-before-animate-20261026`。首次接入提交：`978a7a55`。原 `AccountMenu`、`WorkspaceSwitcher`、`SidebarQuickEntries` 与旧共享菜单实现保留；旧 `AppShell` 完整存在于基线。

用户要求回退时，仅撤销本次侧栏接入及其配套样式/依赖提交，保留其余页面和未知工作；不要 reset 整个分支，不删除历史组件或并行成果。
