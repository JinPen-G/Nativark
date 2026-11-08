# 后台组件源码与接入清单

> 由 `node scripts/audit-admin-components.cjs` 只读扫描生成。引用不等于运行验收，也不等于所有兼容分支均已替换。

本地 123 个公开源码条目 / 263 个唯一文件；Pro 101 个仅有目录元数据；源码校验异常 0 个（2026-10-24 复核，263 文件零异常）。

2026-10-08 原源码复核：日期范围选择器的 TSX/CSS 曾偏离下载清单，已从官方 `https://uiarc.dev/r/date-range-picker.json` 重新同步，并补齐该版本新增的 `lib/use-today.ts`。恢复上游月份容器布局与 `AnimatePresence mode="popLayout"`；仅将上游导入路径映射到项目 vendor 别名，不修改样式、动画参数或行为。三个文件均与本次官网响应逐字核对（导入路径及换行规范化后）；manifest 分别记录上游响应哈希、本地规范化哈希及同步日期。

适配层复核：Accordion、Dialog、RadioGroup、ToastStack、UserMenu、Dropdown 的动效常量、Motion 属性及 `animate()` 调用与各自保留的官方源码一致。业务接口、本地化、禁用状态、租户主题/圆角、音效和此前明确要求的登录容器布局继续由适配层负责；兼容分支不冒称原生 UIArc。类型检查及现有表单、日期范围、账号菜单、侧栏动效、主题动效静态回归通过；未进行浏览器视觉验收。

## 使用入口

`@/components/ui` 是业务页统一入口；原始源码在 `packages/ui-arc/vendor`，下载记录及哈希在 `manifest.json`。

新增页面先查本清单和适配器 API；备用组件按需单独接入并安装其依赖，不要打包整个目录。不要修改 vendor，尺寸与动效保留原设计；颜色、圆角、语言和声音由平台适配层负责。

已导出的平台 API：`Button`、`Form`、`FormField`、`FormSection`、`SidebarMenu`、`UserMenu`、`Modal`、`App`、`Empty`、`Skeleton`、`Radio`、`Collapse`、`Dropdown`、`Drawer`、`Tabs`、`Segmented`、`Tooltip`、`InfoPopover`、`Input`、`SearchField`、`DataTableLeading`、`DataTableMoney`、`dataTableSelectionColumn`、`DataTableSelectionSummary`、`useDataTableSelection`、`DataTableStatus`、`DataTableNote`、`DataTableStatusTone`、`Select`、`Checkbox`、`Slider`、`PasswordField`、`PasswordStrength`、`PhoneInput`、`FeedbackProvider`、`useFeedback`、`ConfirmAction`、`Switch`、`ActionButton`、`SaveButton`、`CopyButton`、`Alert`、`Progress`、`Steps`、`Pagination`、`DatePicker`、`ColorPicker`、`RichTextEditor`、`Upload`、`Table`、`ListSection`、`ListFilters`、`useListFilter`、`ListFilterBar`、`ListFilterItem`、`AnimatedTable`、`DataTable`、`DataTableColumnHeader`、`DataTableViewOptions`、`DataTableSortList`、`DataTableToolbar`、`TableRefreshProvider`、`DataTableRowActions`、`DataTableRowAction`、`TimePicker`、`TimeInput`、`FileUpload`、`FileUploadItem`、`FileUploadProps`。

## 2026-10-29 业务 Copilot 预览

业务侧栏复用本地归档 `ai-side-panel` 原 CSS 的停靠/底部面板；用户限定仅取按钮与侧栏效果，业务内容在独立适配层装配。原组件目录、shared、许可与导入哈希保留，来源和实际接入范围见 [Copilot 说明](../../apps/admin/src/features/copilot/README.md)。右键菜单沿已安装的 Animate UI Base UI ContextMenu；共享列表、卡片和已接入详情按完整记录提供上下文，不提供字段级右键。仅本地演示，未连接模型或执行真实业务；未改 vendor。

## 2026-11-08 公共结果态

共享`Result`已从`@/components/ui`导出，与租户空态复用原`empty-state`及现有EmptyScene字级/间距。AppRouter的两处访问拒绝与订单创建成功已接入，直接Ant Result引用为0；不修改原权限、成功条件或vendor。实看SaaS无权页、返回已授权页面及390px深色英文；订单成功分支未执行真实创建。下面2026-10-24的Result数量仅为当时保留记录。

平台AI的状态表单显式使用Tabs.forceRender，对应原TabsContent.forceMount并隐藏非当前面板；共享ContentTransition承担可见内容过渡，普通Tabs原动画及destroyOnHidden优先级不变。实际原组件服务端渲染已检查保留/隐藏/销毁分支，获权AI页面的浏览器验证仍待完成。

## 2026-10-24 实页复核与保留项

已读查租户端 28 个主菜单入口、平台端 5 个主菜单入口（含错误态）、业务设置与客户端渠道 8 个页签；对工作台、订单和定价分组追加 1600/1280/1024/390px 检查，查看新增订单及定价分组抽屉、深色英文页面说明。只读请求及常规认证刷新放行，业务写请求拦截，未保存/发布/删除或执行资金操作。平台非菜单入口部分跳转或权限拒绝，不能算已验收；SaaS 租户页的品类读取返回 409，未在本轮修改业务接口。

已修正共享列表选择框继承 100% 宽度造成分行、分段控件整体密度、订单窄屏网格最小内容宽度裁切、工作台指标与待办层级；去掉数据库诊断式长说明、报价前重复提示和品类模型版本。主题硬编码颜色转共享语义色，5 个图标动作补名称。页面说明已从 Ant Popover 换为本地原版免费 UIArc Popover，通过 InfoPopover 统一入口复用；上游 263 文件哈希异常仍为 0。

| 仍保留的直接 Ant 组件 | 引用文件数 | 原因及可用的免费来源 |
| --- | --- | --- |
| InputNumber | 24 | 114 处数值输入含未填写 null、金额精度及格式化契约；原 number-field 不能直接表示空值，保留兼容，不能把空金额改成零 |
| Card / Tag / Descriptions | 39 / 46 / 17 | 仍用于表单、状态、指标和只读事实，已走共享主题；普通列表外壳已去除。card / badge 可作为后续适配来源，不能盲换后丢失折行、色义或操作槽 |
| Timeline | 3 | 分配历史、承运轨迹、订阅处理记录；免费 timeline 有自己的事件结构、排序及分日/相对时间语义，需明确映射，当前保持真实事件顺序与时区 |
| Popconfirm | 2 | 库存操作、养护工单；免费 confirm-morph 已有 ConfirmAction 入口，后续迁移须传真实异步承诺，不能把 fire-and-forget 回调当成功 |
| Image / Spin / Breadcrumb / Result | 1 / 1 / 1 / 2 | 分别保留受保护图片预览、切换空间的紧凑等待、导航和权限/结果态。简单空态已用原 empty-state，页面等待沿用既定方格效果 |

下表含布局及表单状态 API 的全部直接引用；这不是“全部都必须视觉替换”的清单。另有输入/选择/日期/弹窗等共享适配器中的显式兼容分支，见文末。开发检查仍观察到独立字段调用 Form.Item.useStatus 的 Ant 开发提示，未为消除提示而引入私有表单上下文或更改校验逻辑。

## 全量公开源码清单

新增导出 `UserMenu`：复用原版个人菜单的样式、菜单动效和滑动分段开关，支持本地化与额外偏好行。业务账号接入由 `AccountMenu` 负责，主题行在语言行上方。

| 名称 | 接入状态 | 当前引用位置 |
| --- | --- | --- |
| arc-foundation | 已引用（可能含兼容分支） | `main.tsx` |
| button | 已引用（可能含兼容分支） | `components/ui/Button.tsx` |
| action-button | 已引用（可能含兼容分支） | `components/ui/ActionButton.tsx` |
| split-button | 已下载备用 | — |
| dropdown-menu | 已引用（可能含兼容分支） | `components/ui/Dropdown.tsx` |
| context-menu | 已下载备用 | — |
| copy-button | 已引用（可能含兼容分支） | `components/ui/CopyButton.tsx` |
| drawer | 已引用（可能含兼容分支） | `components/ui/Drawer.tsx` |
| theme-switch | 已引用（可能含兼容分支） | `app/theme.tsx`<br>`components/AppearanceSwitcher.tsx` |
| theme-switch-eclipse | 已引用（可能含兼容分支） | `app/theme.tsx`<br>`components/AppearanceSwitcher.tsx` |
| theme-switch-split | 已引用（可能含兼容分支） | `app/theme.tsx`<br>`components/AppearanceSwitcher.tsx` |
| theme-switch-rise | 已引用（可能含兼容分支） | `app/theme.tsx`<br>`components/AppearanceSwitcher.tsx` |
| avatar | 已下载备用 | — |
| avatar-group | 已下载备用 | — |
| input | 已引用（可能含兼容分支） | `components/ui/Input.tsx`<br>`features/auth/AuthCodePreview.tsx` |
| textarea | 已引用（可能含兼容分支） | `components/ui/Input.tsx` |
| select | 已引用（可能含兼容分支） | `components/ui/Pagination.tsx`<br>`components/ui/Select.tsx` |
| combobox | 已引用（可能含兼容分支） | `components/ui/Select.tsx` |
| checkbox | 已引用（可能含兼容分支） | `components/ui/Checkbox.tsx`<br>`components/ui/data-table/DataTableSelection.tsx` |
| switch | 已引用（可能含兼容分支） | `components/ui/Switch.tsx` |
| multi-select | 已引用（可能含兼容分支） | `components/ui/Select.tsx` |
| number-field | 已下载备用 | — |
| password-field | 已引用（可能含兼容分支） | `components/ui/Input.tsx`<br>`components/ui/PasswordField.tsx` |
| search-field | 已引用（可能含兼容分支） | `components/ui/SearchField.tsx` |
| tag-input | 已下载备用 | — |
| file-dropzone | 已下载备用 | — |
| radio-group | 已引用（可能含兼容分支） | `components/ui/RadioGroup.tsx` |
| segmented-control | 已引用（可能含兼容分支） | `components/ui/Segmented.tsx` |
| calendar | 已下载备用 | — |
| date-picker | 已适配：原CSS/动效，月份边界与浮层宿主派生 | `components/ui/DatePicker.tsx`, `components/ui/SourceDatePicker.tsx`；来源与边界见[README](README.md) |
| time-picker | 已引用（可能含兼容分支） | `components/ui/DatePicker.tsx`<br>`components/ui/TimePicker.tsx` |
| accordion | 已引用（可能含兼容分支） | `components/ui/Accordion.tsx` |
| dialog | 已引用（可能含兼容分支） | `components/ui/Dialog.tsx` |
| popover | 已引用（可能含兼容分支） | `components/ui/InfoPopover.tsx` |
| tooltip | 已引用（可能含兼容分支） | `components/ui/Tooltip.tsx` |
| tabs | 已引用（可能含兼容分支） | `components/ui/Tabs.tsx` |
| expandable-card | 已下载备用 | — |
| breadcrumb | 已下载备用 | — |
| alert | 已引用（可能含兼容分支） | `components/ui/Alert.tsx` |
| toast | 已下载备用 | — |
| progress | 已引用（可能含兼容分支） | `components/ui/Progress.tsx` |
| skeleton | 已引用（可能含兼容分支） | `components/ui/Skeleton.tsx` |
| badge | 已下载备用 | — |
| card | 已下载备用 | — |
| metric-card | 已下载备用 | — |
| empty-state | 已引用（可能含兼容分支） | `components/ui/Empty.tsx`, `components/ui/EmptyScene.tsx`, `components/ui/Result.tsx` |
| tree-view | 已下载备用 | — |
| pagination | 已引用（可能含兼容分支） | `components/ui/Pagination.tsx` |
| filter-toolbar | 已下载备用 | — |
| sortable-data-table | 已下载备用 | — |
| sparkline | 已下载备用 | — |
| gauge | 已下载备用 | — |
| animated-counter | 已下载备用 | — |
| code-block | 已下载备用 | — |
| text-reveal | 已下载备用 | — |
| in-view-title | 已下载备用 | — |
| text-morph | 已下载备用 | — |
| text-shimmer | 已下载备用 | — |
| hold-to-confirm | 已下载备用 | — |
| swipe-actions | 已下载备用 | — |
| slider | 已引用（可能含兼容分支） | `components/ui/Slider.tsx` |
| inline-edit | 已下载备用 | — |
| chip-group | 已下载备用 | — |
| password-strength | 已引用（可能含兼容分支） | `components/ui/PasswordStrength.tsx` |
| bottom-sheet | 已下载备用 | — |
| hover-card | 已下载备用 | — |
| resizable-panels | 已下载备用 | — |
| toast-stack | 已引用（可能含兼容分支） | `components/ui/ToastStack.tsx` |
| usage-meter | 已下载备用 | — |
| image-compare | 已下载备用 | — |
| carousel | 已下载备用 | — |
| bar-chart | 已下载备用 | — |
| activity-heatmap | 已下载备用 | — |
| timeline | 已下载备用 | — |
| user-menu | 已引用（可能含兼容分支） | `components/ui/UserMenu.tsx` |
| stepper | 已引用（可能含兼容分支） | `components/ui/Steps.tsx` |
| signature-pad | 已下载备用 | — |
| date-range-picker | 已引用（可能含兼容分支） | `components/ui/DatePicker.tsx` |
| color-picker | 已引用（可能含兼容分支） | `components/ui/ColorPicker.tsx` |
| line-chart | 已下载备用 | — |
| donut-chart | 已下载备用 | — |
| streamgraph | 已下载备用 | — |
| brush-chart | 已下载备用 | — |
| ridgeline | 已下载备用 | — |
| treemap | 已下载备用 | — |
| waffle-chart | 已下载备用 | — |
| slope-chart | 已下载备用 | — |
| announcement-bar | 已下载备用 | — |
| phone-input | 已引用（可能含兼容分支） | `components/ui/PhoneInput.tsx` |
| shortcut-recorder | 已下载备用 | — |
| confirm-morph | 已引用（可能含兼容分支） | `components/ui/ConfirmAction.tsx` |
| mention-input | 已下载备用 | — |
| chat-thread | 已下载备用 | — |
| rich-text-editor | 已引用（可能含兼容分支） | `components/ui/RichTextEditor.tsx` |
| billing-toggle | 已下载备用 | — |
| scroll-area | 已下载备用 | — |
| radio-cards | 已下载备用 | — |
| comment-thread | 已下载备用 | — |
| slot-text | 已下载备用 | — |
| signup-form | 已下载备用 | — |
| logo-marquee | 已下载备用 | — |
| plan-comparison | 已适配：租户对比与 SaaS 配置预览 | `features/subscription/plan-comparison/PlanComparison.tsx` |
| command-palette | 已下载备用 | — |
| notification-center | 已下载备用 | — |
| file-upload | 已引用（可能含兼容分支） | `components/ui/FileUpload.tsx`<br>`components/ui/Upload.tsx` |
| otp-input | 已引用（可能含兼容分支） | `features/auth/AuthCodePreview.tsx` |
| changelog-feed | 已下载备用 | — |
| sign-in | 已下载备用 | — |
| page-header | 已下载备用 | — |
| empty-states | 已适配：独立场景、共享空列表 | `components/ui/EmptyScene.tsx`, `components/ui/empty-scene/` |
| login-centered | 已引用（可能含兼容分支） | `features/auth/AuthCodePreview.tsx`<br>`features/auth/LoginPage.tsx` |
| site-header | 已下载备用 | — |
| site-footer | 已下载备用 | — |
| hero-section | 已下载备用 | — |
| faq-section | 已下载备用 | — |
| contact-section | 已下载备用 | — |
| blog-grid | 已下载备用 | — |
| comparison-table | 已下载备用 | — |
| stats-band | 已下载备用 | — |
| cta-section | 已下载备用 | — |
| newsletter-signup | 已下载备用 | — |
| expanding-search | 已下载备用 | — |
| json-viewer | 已下载备用 | — |

日期区间适配支持将`minDate`/`maxDate`转换为原UIArc DateRangePicker边界；营业日历的同年度选择不再进入双端点浮层。日期时间、动态禁选及允许单端为空的兼容契约继续保留。全年营业视图复用现有业务日历与UIArc切换/详情入口，是本项目扩展，不标为官方Pro组件；原站Week calendar用于事件排期，本地没有可直接承担12个月营业状态的Pro实现。

## 仍直接依赖 Ant 的范围

以下包含布局、表单状态、数据展示、消息服务及未替换控件，不应一律作为视觉替换遗漏。适配器内部的 Ant 分支不在此表内，应同时查看对应源码。

| Ant API | 引用文件数 | 文件 |
| --- | --- | --- |
| App | 1 | `app/App.tsx` |
| Breadcrumb | 1 | `components/AppShell.tsx` |
| Card | 39 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/platform/CategoryDraftEditor.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Col | 21 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/tenant-access/TenantAccessPages.tsx` |
| ConfigProvider | 1 | `app/App.tsx` |
| Descriptions | 17 | `features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx` |
| Divider | 4 | `features/channel/ClientChannelPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/settings/CalendarRangeModal.tsx` |
| Image | 1 | `features/catalog/ItemGroupPhoto.tsx` |
| InputNumber | 24 | `features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/CategoryDraftEditor.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryPreparationDialog.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/StandardPriceModal.tsx` |
| Layout | 1 | `components/AppShell.tsx` |
| Popconfirm | 2 | `features/commercial/RentalCommercialPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx` |
| Row | 21 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/tenant-access/TenantAccessPages.tsx` |
| Space | 57 | `components/PageHeader.tsx`<br>`features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/platform/CategoryDraftEditor.tsx`<br>`features/platform/CategoryGovernancePage.tsx`<br>`features/platform/CategoryPolicyDialog.tsx`<br>`features/platform/DemoRequestsPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryPreparationDialog.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Spin | 1 | `components/WorkspaceSwitcher.tsx` |
| Statistic | 3 | `features/membership/CustomerProfileDrawer.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Tag | 46 | `features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/platform/CategoryGovernancePage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| theme | 1 | `app/theme.tsx` |
| Timeline | 3 | `features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx` |
| Typography | 39 | `features/appearance/AppearancePage.tsx`<br>`features/auth/LoginPage.tsx`<br>`features/auth/PasswordChangeGate.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryPreparationDialog.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |

## 明确保留的兼容边界

- InputNumber：原生 NumberField 不支持空值，不能把未填写金额变成 0；金额 stringMode、格式器、精度和清空语义保留 Ant。新非空计数器可按需接入 number-field。
- Select：基础单选/显式关闭搜索的 multiple/按名称搜索的单选使用原组件；多选默认搜索、自定义筛选、异步加载、树/分组、tags、复杂事件和弹层控制仍保留兼容实现。
- Checkbox：普通文本选项使用原勾选动效；Group、复杂内容/事件仍保留 Ant。
- Input：普通密码与固定行数 TextArea 使用原组件并保留表单 ref；自定义密码显隐/图标、自动高度、计数、清空及复杂样式仍保留 Ant。
- Radio：普通选项接原 radio-group，紧凑按钮组接共享 Segmented；自定义 children、复杂事件和特殊选项保留 Ant。
- Table：普通业务列通过共享桥接使用订单同一 Tablecn/TanStack 渲染、工具与分页；未适配的选择/筛选/树/自定义渲染契约显式回退 Ant，不用展示示例替代业务功能。Form 保留原验证与权限状态。
- Modal/App.message/notification：普通对话框与消息由共享适配器接入原版 Dialog/ToastStack；静态确认、复杂节点、Promise 上下文和嵌套关闭等特殊契约显式保留 Ant，不等于普通弹窗未迁移。
- 日期/上传/提示/步骤等适配器的特殊模式有显式 fallback，详见适配器源码和 README。
- Pro：只有元数据，未经许可不下载、不模仿受限源码。

## 更新流程

改动接入后运行只读扫描更新本清单；上游新增组件再核对官方 registry/catalog，审核许可与依赖后补源码和 manifest。日常开发无需每次去官网找组件。
