# Rental 履约网络后台

地点与经营主体使用同一页面贡献，标题从当前品类的导航术语读取。导航复用原商品与资产分组，地点排在养护工单之后。地点类型、履约能力、组织映射、营业时间与联系方式沿原字段和服务端合同。[页面声明](pages.ts) · [页面实现](LocationPage.tsx)

## 宿主接入

宿主用 createRentalLocationPageContext 绑定唯一认证请求、包含租户和经营空间的会话身份、当前身份读取及原组织权限，再将上下文读取交给 createRentalLocationsAdminContribution。宿主将该贡献与订单、养护和能力页面合并为同一 Rental 贡献。[上下文](page-context.ts) · [贡献入口](index.tsx) · [统一 Rental 贡献](../index.tsx)

业务页面的查看与管理分别使用 station/view 和 station/manage，标准 Core 清单须登记这两个动作。原宿主继续使用 rental-os:station:view 和 rental-os:station:manage，兼容地址为 /rental/locations。[原宿主入口](../../../../apps/admin/src/features/fulfillment/LocationPage.tsx)

组织目录沿公共设置客户端读取。原映射要求当前主体的 dataScope 为 all、地点范围为非 selected 并拥有 system:user:manage，宿主分别供给组织查看与映射判断。[公共组织客户端](../../../platform-admin/src/features/platform-settings/client.ts)

## 请求与编辑

地点与档案读取复用订单客户端，经营主体和品类请求沿原 API 路径，组织读取复用公共请求。写入按对象 ID 使用原 POST 或 PUT。查询传递取消信号，范围在请求前后复验。[履约客户端](client.ts) · [订单客户端](../orders/client.ts) · [原 API 兼容入口](../../../../apps/admin/src/api/rentalCore.ts)

两份表单复用现有编辑驱动，保存按钮与回车共用真实在途 Promise。每次打开固定编辑代次，校验后复验当前对象和权限，保存失败保留输入，侧窗完成退出后再清空字段。地点保存仍按原权限保留组织映射的清除及省略语义，保存后刷新原地点与经营主体查询。[编辑驱动](../orders/useOrderEditor.ts) · [公共表单](../../../platform-admin/src/core/useCoreForm.ts) · [退出生命周期](../../../platform-admin/src/components/ui/useModalDismissal.ts)

地点与经营主体的按钮保存和回车提交共用各自原失败文案；失效页面、取消请求及字段校验不另弹通用失败提示。

## 列表与卡片

页面和卡片从 `@rental-os/platform-admin/ui` 使用原图标、列表宽度和卡片事实，列表预检使用该出口的同一 `ListPreflightError`。设置分区从 `/forms` 使用原 `SettingsWorkspace`，原表单与退出生命周期沿同一组件供给。[UI 出口](../../../platform-admin/src/components/ui/index.ts) · [表单出口](../../../platform-admin/src/forms.ts)

导出字段、只新增导入、启用经营主体编码解析、资料修订预检和批量状态载荷沿原逻辑。只有明确的 409 重复冲突可跳过，其他失败继续返回原错误，批量保存前重新检查当前管理权限。[列表能力](listCapabilities.ts) · [原列表兼容入口](../../../../apps/admin/src/features/listCapabilities.ts)

命中新鲜查询缓存时，首屏按当前受权范围呈现原导入和批量入口，不等待轮询或切换页签。页面退出、空间切换或撤权后，保留的回调仍须通过同一生命周期和当前权限检查。

卡片保留原当地时间、营业文本、能力标记和预览退出后编辑的交互，按钮使用公共原生 UIArc 出口。[卡片](locationCards.tsx) · [原卡片兼容入口](../../../../apps/admin/src/features/fulfillment/locationCards.tsx)

## 验证入口

类型入口为 Rental 后台 tsconfig 与原宿主，现有导航术语、列表交互、品类对齐及静态页面断言定位同一正文。界面操作通过原受权宿主入口验收。[类型配置](../tsconfig.json) · [导航术语用例](../../../../tests/admin-navigation-terminology.test.cjs) · [列表交互用例](../../../../tests/admin-list-interactions.test.cjs) · [品类对齐用例](../../../../tests/rental-category-core-alignment.test.cjs)

原宿主菜单、地点路由与页面上下文消费同一地点声明。品类档案与目录按原当前读取权限独立准入，缺接点或无权时使用通用地点标题；元数据等待与失败保持地点列表可用，地点创建仍依赖完整品类事实。读取后复验原权限与经营空间，撤权后隐藏缓存元数据。原手动刷新重读当前有权的附属资料，各自错误状态与地点结果独立处理。
