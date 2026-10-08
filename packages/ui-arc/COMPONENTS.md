# 后台组件源码与接入清单

> 由 `node scripts/audit-admin-components.cjs` 只读扫描生成。引用不等于运行验收，也不等于所有兼容分支均已替换。

本地 123 个公开源码条目 / 262 个唯一文件；Pro 101 个仅有目录元数据；源码校验异常 2 个（日期范围组件 TSX/CSS 与清单哈希不同，本轮未修改这些 vendor 文件）。

## 使用入口

`@/components/ui` 是业务页统一入口；原始源码在 `packages/ui-arc/vendor`，下载记录及哈希在 `manifest.json`。

新增页面先查本清单和适配器 API；备用组件按需单独接入并安装其依赖，不要打包整个目录。不要修改 vendor，尺寸与动效保留原设计；颜色、圆角、语言和声音由平台适配层负责。

已导出的平台 API：`Button`、`Form`、`FormField`、`FormSection`、`SidebarMenu`、`Dropdown`、`Drawer`、`Tabs`、`Segmented`、`Tooltip`、`Input`、`SearchField`、`Select`、`Checkbox`、`Slider`、`PasswordField`、`PasswordStrength`、`PhoneInput`、`FeedbackProvider`、`useFeedback`、`ConfirmAction`、`Switch`、`ActionButton`、`SaveButton`、`CopyButton`、`Alert`、`Progress`、`Steps`、`Pagination`、`DatePicker`、`ColorPicker`、`RichTextEditor`、`Upload`、`Table`、`TimePicker`、`TimeInput`、`FileUpload`、`FileUploadItem`、`FileUploadProps`。

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
| checkbox | 已引用（可能含兼容分支） | `components/ui/Checkbox.tsx` |
| switch | 已引用（可能含兼容分支） | `components/ui/Switch.tsx` |
| multi-select | 已引用（可能含兼容分支） | `components/ui/Select.tsx` |
| number-field | 已下载备用 | — |
| password-field | 已引用（可能含兼容分支） | `components/ui/Input.tsx`<br>`components/ui/PasswordField.tsx` |
| search-field | 已引用（可能含兼容分支） | `components/ui/SearchField.tsx` |
| tag-input | 已下载备用 | — |
| file-dropzone | 已下载备用 | — |
| radio-group | 已下载备用 | — |
| segmented-control | 已引用（可能含兼容分支） | `components/ui/Segmented.tsx` |
| calendar | 已下载备用 | — |
| date-picker | 已引用（可能含兼容分支） | `components/ui/DatePicker.tsx` |
| time-picker | 已引用（可能含兼容分支） | `components/ui/DatePicker.tsx`<br>`components/ui/TimePicker.tsx` |
| accordion | 已下载备用 | — |
| dialog | 已下载备用 | — |
| popover | 已下载备用 | — |
| tooltip | 已引用（可能含兼容分支） | `components/ui/Tooltip.tsx` |
| tabs | 已引用（可能含兼容分支） | `components/ui/Tabs.tsx` |
| expandable-card | 已下载备用 | — |
| breadcrumb | 已下载备用 | — |
| alert | 已引用（可能含兼容分支） | `components/ui/Alert.tsx` |
| toast | 已下载备用 | — |
| progress | 已引用（可能含兼容分支） | `components/ui/Progress.tsx` |
| skeleton | 已下载备用 | — |
| badge | 已下载备用 | — |
| card | 已下载备用 | — |
| metric-card | 已下载备用 | — |
| empty-state | 已下载备用 | — |
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
| toast-stack | 已引用（可能含兼容分支） | `components/ui/Feedback.tsx` |
| usage-meter | 已下载备用 | — |
| image-compare | 已下载备用 | — |
| carousel | 已下载备用 | — |
| bar-chart | 已下载备用 | — |
| activity-heatmap | 已下载备用 | — |
| timeline | 已下载备用 | — |
| user-menu | 已引用（适配层扩展语言行与本地化，复用原版 CSS/动效） | `components/ui/UserMenu.tsx`；账号接入 `components/AccountMenu.tsx` |
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
| plan-comparison | 已下载备用 | — |
| command-palette | 已下载备用 | — |
| notification-center | 已下载备用 | — |
| file-upload | 已引用（可能含兼容分支） | `components/ui/FileUpload.tsx`<br>`components/ui/Upload.tsx` |
| otp-input | 已引用（可能含兼容分支） | `features/auth/AuthCodePreview.tsx` |
| changelog-feed | 已下载备用 | — |
| sign-in | 已下载备用 | — |
| page-header | 已下载备用 | — |
| empty-states | 已下载备用 | — |
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

## 仍直接依赖 Ant 的范围

以下包含布局、表单状态、数据展示、消息服务及未替换控件，不应一律作为视觉替换遗漏。适配器内部的 Ant 分支不在此表内，应同时查看对应源码。

| Ant API | 引用文件数 | 文件 |
| --- | --- | --- |
| App | 50 | `app/App.tsx`<br>`components/AppShell.tsx`<br>`components/WorkspaceSwitcher.tsx`<br>`features/appearance/AppearancePage.tsx`<br>`features/auth/PasswordChangeGate.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/membership/QualificationTypesPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/RentalGovernancePage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/FeatureCatalogModal.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/StandardPriceModal.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/SubscriptionRequestModal.tsx`<br>`features/subscription/TenantFeatureGrantModal.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Avatar | 1 | `components/AppShell.tsx` |
| Breadcrumb | 1 | `components/AppShell.tsx` |
| Card | 50 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/platform/DemoRequestsPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Col | 22 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/tenant-access/TenantAccessPages.tsx` |
| ConfigProvider | 1 | `app/App.tsx` |
| Descriptions | 17 | `features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx` |
| Divider | 4 | `features/channel/ClientChannelPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/settings/CalendarRangeModal.tsx` |
| Empty | 11 | `components/QueryState.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx` |
| Image | 1 | `features/catalog/ItemGroupPhoto.tsx` |
| InputNumber | 22 | `features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/StandardPriceModal.tsx` |
| Layout | 1 | `components/AppShell.tsx` |
| Modal | 17 | `features/auth/LoginPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/subscription/FeatureCatalogModal.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/StandardPriceModal.tsx`<br>`features/subscription/SubscriptionRequestModal.tsx`<br>`features/subscription/TenantFeatureGrantModal.tsx` |
| Popconfirm | 2 | `features/commercial/RentalCommercialPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx` |
| Popover | 1 | `components/PageHeader.tsx` |
| Radio | 3 | `features/membership/MembershipReviewPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx` |
| Result | 2 | `app/AppRouter.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx` |
| Row | 22 | `features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/tenant-access/TenantAccessPages.tsx` |
| Slider | 1 | `features/appearance/AppearancePage.tsx` |
| Space | 54 | `components/PageHeader.tsx`<br>`features/appearance/AppearancePage.tsx`<br>`features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/platform/DemoRequestsPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetailPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Spin | 1 | `components/WorkspaceSwitcher.tsx` |
| Statistic | 3 | `features/membership/CustomerProfileDrawer.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| Tag | 45 | `features/catalog/AssetWorkspacePage.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/fulfillment/LocationPage.tsx`<br>`features/membership/CorporateMembershipPage.tsx`<br>`features/membership/CustomerProfileDrawer.tsx`<br>`features/membership/MembershipPlanPage.tsx`<br>`features/membership/MembershipReviewPage.tsx`<br>`features/membership/MembershipRewardsPage.tsx`<br>`features/membership/PersonalMembershipPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/rental-core/RentalOrdersPage.tsx`<br>`features/reports/WorkspaceOperationReportPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/subscription/PlatformSubscriptionDetailPage.tsx`<br>`features/subscription/PlatformSubscriptionsPage.tsx`<br>`features/subscription/SubscriptionCatalogPage.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |
| theme | 1 | `app/theme.tsx` |
| Timeline | 3 | `features/rental-core/CarrierShipmentPanel.tsx`<br>`features/rental-core/OrderAllocationPanel.tsx`<br>`features/subscription/SubscriptionRequestDetails.tsx` |
| Typography | 38 | `features/appearance/AppearancePage.tsx`<br>`features/auth/LoginPage.tsx`<br>`features/auth/PasswordChangeGate.tsx`<br>`features/catalog/CatalogPage.tsx`<br>`features/catalog/StockOperationsPanel.tsx`<br>`features/channel/ClientChannelPage.tsx`<br>`features/commercial/CouponPage.tsx`<br>`features/commercial/PricingGroupPage.tsx`<br>`features/commercial/RentalCommercialPage.tsx`<br>`features/platform/OfficialCalendarSourcePage.tsx`<br>`features/platform/PlatformOperationsPage.tsx`<br>`features/platform/PlatformPage.tsx`<br>`features/platform/PlatformToolsPage.tsx`<br>`features/platform/TenantManagementPage.tsx`<br>`features/rental-core/CapabilityGovernancePage.tsx`<br>`features/rental-core/MaintenanceWorkOrdersPage.tsx`<br>`features/rental-core/OrderDocumentsPanel.tsx`<br>`features/rental-core/RentalOrderCreatePage.tsx`<br>`features/rental-core/RentalOrderDetailPage.tsx`<br>`features/settings/CalendarMonthGrid.tsx`<br>`features/settings/CalendarRangeModal.tsx`<br>`features/settings/governance/CalendarTab.tsx`<br>`features/settings/governance/CategoryTab.tsx`<br>`features/settings/governance/MembershipRewardRulesTab.tsx`<br>`features/settings/governance/NotificationsTab.tsx`<br>`features/settings/governance/ruleSections.tsx`<br>`features/settings/governance/RuleSetupWizard.tsx`<br>`features/settings/governance/RulesTab.tsx`<br>`features/settings/PaymentReconciliationPage.tsx`<br>`features/settings/TenantIntegrationsPage.tsx`<br>`features/settings/TenantReadinessPage.tsx`<br>`features/sound/SoundSettingCard.tsx`<br>`features/subscription/PlatformSubscriptionActionForm.tsx`<br>`features/subscription/SubscriptionExpiryFloatingCard.tsx`<br>`features/subscription/SubscriptionProPage.tsx`<br>`features/subscription/TenantSubscriptionBody.tsx`<br>`features/tenant-access/TenantAccessPages.tsx`<br>`features/workbench/WorkbenchPage.tsx` |

## 明确保留的兼容边界

- InputNumber：原生 NumberField 不支持空值，不能把未填写金额变成 0；金额 stringMode、格式器、精度和清空语义保留 Ant。新非空计数器可按需接入 number-field。
- Select：基础单选/显式关闭搜索的 multiple/按名称搜索的单选使用原组件；多选默认搜索、自定义筛选、异步加载、树/分组、tags、复杂事件和弹层控制仍保留兼容实现。
- Checkbox：普通文本选项使用原勾选动效；Group、复杂内容/事件仍保留 Ant。
- Input：普通密码与固定行数 TextArea 使用原组件并保留表单 ref；自定义密码显隐/图标、自动高度、计数、清空及复杂样式仍保留 Ant。
- Radio：原 radio-group 是纵向选项卡，不直接替换现有紧凑横排及含禁用规则的单选组。
- Table/Form：保留业务数据引擎和验证状态；不能用展示示例替代排序、选择、分页、校验和权限。
- Modal/App.message/notification：仍有直接使用，尚未完成原生替换；需要适配静态调用、Promise、上下文和嵌套关闭行为。
- 日期/上传/提示/步骤等适配器的特殊模式有显式 fallback，详见适配器源码和 README。
- Pro：只有元数据，未经许可不下载、不模仿受限源码。

## 更新流程

改动接入后运行只读扫描更新本清单；上游新增组件再核对官方 registry/catalog，审核许可与依赖后补源码和 manifest。日常开发无需每次去官网找组件。
