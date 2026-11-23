# Rental 商业后台

定价分组、整体价格版本、调价计划、优惠、优惠券和服务容量共用包内页面与客户端。价格、预算、券状态和容量占用读取原服务端事实。[页面贡献](index.tsx) · [七页声明](pages.ts) · [请求工厂](client.ts)

## 宿主接入

宿主通过 createRentalCommercialPageContext 供给当前 AdminRuntime、原鉴权图片读取、包含租户与经营空间的 scopeKey 和当前身份读取函数，再将上下文交给 createRentalCommercialAdminContribution。JSON 与图片传输在请求前后复验同一身份，查询传递取消信号。[上下文](page-context.ts) · [旧宿主上下文](../../../../apps/admin/src/features/commercial/legacy-commercial-context.ts) · [原图片传输](../../../../apps/admin/src/api/rentalCore.ts)

统一 Rental 贡献合并这七页。页面权限为 price/manage，旧宿主继续复验 rental-os:price:manage。版本详情参数由已匹配的宿主路由供给，正整数与安全整数检查沿原页面。页头主操作、价格版本入口与返回动作使用正式 CorePage 声明。“价格版本”沿原正文辅助操作区使用 tools 插槽，新增调价计划沿原顶部主操作区，返回沿 navigation 插槽，版本导航解析当前注册表。[商业页面](RentalCommercialPage.tsx) · [旧路由适配](../../../../apps/admin/src/features/commercial/legacy-commercial-page.tsx) · [统一贡献](../index.tsx)

| 页面 | 声明路径 | 旧兼容路径 |
| --- | --- | --- |
| 定价分组 | /pricing-groups | /rental/pricing-groups |
| 价格与调价 | /pricing | /rental/pricing |
| 价格版本列表 | /pricing/versions | /rental/pricing/versions |
| 价格版本详情 | /pricing/versions/:sequence | /rental/pricing/versions/:sequence |
| 优惠方案 | /discounts | /rental/discounts |
| 优惠券 | /coupons | /rental/coupons |
| 增值服务 | /services | /rental/services |

原英文词条由 rentalCommercialMessages 提供，宿主合并到公共 AdminUiProvider.messages。商业字段、枚举与品类导航术语继续通过同一语言 Context 呈现。[商业词典](messages.ts) · [公共语言 Provider](../../../platform-admin/src/AdminUiProvider.tsx)

## 编辑与历史依据

九个保存型表单复用现有编辑驱动，保存按钮与回车共用打开代次的校验和真实请求 Promise。保存期间保留原编辑对象，关闭后再打开的默认值成为新的表单基线。[编辑驱动](../orders/useOrderEditor.ts)

保存期间的 Modal 通过 mask.closable 控制遮罩关闭。优惠编辑沿公共 Drawer 的 maskClosable 契约保护遮罩交互，关闭回调再复验提交代次。[弹窗适配](../../../platform-admin/src/components/ui/Modal.tsx) · [抽屉适配](../../../platform-admin/src/components/ui/Drawer.tsx)

定价组新增时沿原 initialRates 转换，时间费率和用量费率分别保留对应字段。资金费率保存使用原整体版本追加接口。[定价分组](PricingGroupPage.tsx) · [初始费率转换](pricing-group-initial-rate.ts)

定价分组主列表及原费率继续读取原价格权限释放的业务对象。型号目录按 catalog/view、catalog/manage、order/view 或 order/create 读取，经营术语按 order/view、catalog/view 或 asset/view 读取，两者均由当前已验证宿主核对，请求前后及手动刷新复验权限和页面身份。附属失败或受限独立呈现，旧型号图片树撤下，主记录已有的成员名称与数量保留；标题沿原静态默认，币种、计价单位和历史价格仍来自原业务设置与价格版本。编辑及资金费率保存继续要求原完整型号和必需查询，保存前核对当前查询状态，刷新保留原草稿代次。[定价查询与保存](PricingGroupPage.tsx) · [卡片型号状态](commercialCards.tsx) · [原服务端权限](../../src/http-auth.ts)

调价草稿冻结打开时的版本与费率，提交时只保留操作者改过的价格项。创建草稿后继续核对预览及确认，恢复历史版本使用原原因和追加接口。当前版本列表与详情复用同一查询键及生效时间判据。[商业页面](RentalCommercialPage.tsx) · [版本读取](usePriceVersions.ts)

券模板、发放和作废沿原订单台账请求。券门槛、预算、领用限制和日期绑定保留原载荷。增值服务条款、适用范围与容量时间窗口由同一商业客户端提交。[优惠券](CouponPage.tsx)

优惠券模板列表沿原 price/manage 权限读取。关联商品按原 catalog/view、catalog/manage、order/view 或 order/create 权限查询，由当前宿主、页面身份及经营空间在请求前后复验；缺权限时停止附属请求和旧引用展示。模板已有的适用商品数量、全部商品规则、优惠及领用事实保留，指定商品资料受限、失败和等待分别呈现。列表刷新仅读取当前有权资料，保留编辑草稿；创建和编辑仍要求原完整引用，打开和保存时复验当前权限及必需查询成功状态。发放、作废和预算台账继续使用原请求与业务规则。[优惠券查询与保存](CouponPage.tsx) · [卡片引用状态](couponCards.tsx) · [原服务端权限](../../src/http-auth.ts)

增值服务的页面、主按钮、访问驱动和容量操作消费正式 service/manage 权限，其他商业页沿访问驱动默认的价格权限。经营资料、商品、业务设置和地点按原 HTTP 权限分别读取，请求前后及手动刷新复验当前身份；服务页沿自身主查询展示服务和原计费单位，附属受限或失败独立提示，未提供金额或币种明确显示，旧无权缓存退出展示。服务编辑继续要求原完整关联事实和币种，容量保存保留原地点、选定服务与容量查询前置，两类保存紧前均复验当前权限和必需查询状态。原载荷、日期转换、草稿代次和台账流程由现有客户端及表单驱动维护。[服务列表与保存](RentalCommercialPage.tsx) · [访问驱动](page-context.ts) · [页面声明](pages.ts) · [正式权限来源](../../src/permissions.ts)

原管理后台的商业薄适配将标准权限通过唯一原权限映射交给当前 Auth 检查，服务、价格以及商品、地点等附属权限均沿同一来源。范围变化、跨 Core 和未登记权限继续拒绝，主页面、查询及动作复用同一宿主检查。[原路由薄适配](../../../../apps/admin/src/features/commercial/legacy-commercial-page.tsx) · [原权限映射](../../src/permissions.ts)

## 卡片与来源

定价组、优惠、服务和优惠券卡片保留原只读预览、关闭后操作与样式。头像缓存键绑定当前范围、型号和图片，渲染首帧复验对象 URL 对应的身份及 Blob，替换和卸载时释放 URL。[商业卡片](commercialCards.tsx) · [优惠券卡片](couponCards.tsx) · [头像与卡片呈现](commercialCardParts.tsx)

演示优惠继续由 DISCOUNT_PLAN_DEMO 控制，演示发布与停用留在原页面内存。Spotlight 编译预览的插槽、原样式和来源许可随同迁入。[演示页面](DiscountPlanShowcase.tsx) · [原演示数据](discountPlanDemo.ts) · [来源与许可](archive/spotlight-grid/SOURCE.md)

## 公共整合要求

- Rental 包提供 admin/commercial、admin/commercial/client、admin/commercial/context 和 admin/commercial/pages 的 exports 与 typesVersions，后台类型配置包含 commercial。
- 统一 Rental 上下文提供 useCommercialContext，统一贡献合并七页，价格与服务页分别沿正式 price/manage 和 service/manage 映射。
- 公共 native-ui 提供 avatarGroupClasses，消费原 Avatar group CSS。公共 motion 提供 motionTokens 和 usePrefersReducedMotion，消费原 UIArc 动效参数与偏好。
- 公共 ui 提供卡片事实、原图标与列表宽度，shell 提供 SettingsWorkspace；页面使用正式出口，编译预览与外层适配从公共 motion 读取同一 motionTokens 和 usePrefersReducedMotion，原函数和 CSS 按来源说明维护。
- 宿主合并 rentalCommercialMessages，并将旧菜单、路由和面包屑绑定同一页面声明。

## 验证入口

现有交互用例读取 Core 调价正文，计价用例核初始费率转换和商业英文词条，品类、导航术语与列表呈现用例读取同一通用页面。类型检查同时覆盖 Core 页面和旧消费者。浏览器、真实 HTTP、对象传输与完整标准装配分别验收。[后台类型配置](../tsconfig.json) · [列表交互](../../../../tests/admin-list-interactions.test.cjs) · [用量计价](../../../../tests/rental-usage-pricing-admin.test.cjs) · [品类对齐](../../../../tests/rental-category-core-alignment.test.cjs) · [导航术语](../../../../tests/admin-navigation-terminology.test.cjs) · [列表呈现](../../../../tests/rental-order-list-presentation.test.cjs)
