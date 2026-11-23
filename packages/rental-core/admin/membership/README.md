# Rental 会员与客户后台

[页面贡献](index.tsx)提供个人与企业会员、客户资料、审核、方案、奖励和空间证件类型。页面正文、客户预览及企业操作由 Rental 单源维护，宿主供给当前身份、请求、文件和可选 AI 展示接点。

## 页面接入

宿主调用 `createRentalMembershipAdminContribution`，传入当前实现版本与页面上下文 hook，将返回值合入同一个 Rental 贡献。公共 `CoreRoutes` 供给页面宿主，菜单、详情父级和页名从[八页描述](pages.ts)读取，主操作与辅助操作通过公共 `CorePage` 声明进入页头。

个人会员页的“注册设置”和“当前空间证件类型”沿原 `tools` 插槽位于正文辅助区，“新增个人会员”继续使用顶部主操作。会员激励的“补发奖励”沿原 `tools` 插槽与默认按钮样式呈现，表单、弹窗确认与原奖励请求保持同一接点。

上下文 hook 使用[上下文工厂](page-context.tsx)，将原 `AdminRuntime`、当前会员会话、实时会话读取和已有列表查询身份绑定到本页。会话、租户、账号、经营空间或授权范围变化时，旧请求和文件结果会被隔离。

| 业务入口 | 正文与直接消费者 |
| --- | --- |
| 个人会员与客户资料 | [个人会员页](PersonalMembershipPage.tsx)、[客户资料](CustomerProfileDetails.tsx)、[客户分析](CustomerAnalysis.tsx) |
| 企业会员与账务 | [企业会员页](CorporateMembershipPage.tsx)、[授信草稿](corporate-credit-draft.ts)、[回款冲销引用](corporate-payment-reference.ts) |
| 注册与证件审核 | [审核页](MembershipReviewPage.tsx)、[空间证件类型](QualificationTypesPage.tsx) |
| 方案与奖励 | [方案页](MembershipPlanPage.tsx)、[奖励页](MembershipRewardsPage.tsx)、[列表导入与批量操作](list-capabilities.ts) |
| 客户引用与会员卡 | [客户预览](CustomerPreview.tsx)、[头像](CustomerAvatar.tsx)、[会员卡](membershipPlanCards.tsx)、[卡面偏好](memberCardAppearance.ts) |
| 企业政策与行政办理 | [租赁政策](EnterpriseRentalPolicy.tsx)、[门户配置](EnterprisePortalConfiguration.tsx)、[申请审核](EnterpriseApplications.tsx)、[管理请求](EnterpriseManagementRequests.tsx)、[行政交接](EnterpriseRentalHandoffs.tsx) |

[组件出口](components.ts)供给客户预览、资料编辑及企业办理内容。[逻辑出口](logic.ts)供给原操作定位、材料投影、卡面偏好和授信/回款引用。[会员分析](MembershipInsights.tsx)复用公共指标出口，并保留原趋势、时间线及分析分区。

## 请求、权限与文件

[会员客户端](client.ts)、[客户客户端](customer-client.ts)和[奖励客户端](rewards-client.ts)使用同一真实请求端口。URL、方法、载荷、版本和收据读取沿原服务端执行，资金与资格的结果使用服务端返回的事实。

租户共享会员、客户主档、方案和审核沿原租户会员权限。证件类型配置使用当前经营空间，订单、资金、奖励和企业交接沿各自的原经营空间权限与数据范围。账号状态与租户会员状态保持各自独立的请求，历史授予与订单继续读取关联快照。[旧地址的 OR 权限映射](pages.ts)供兼容宿主核对原页面准入。

头像、申请材料和管理请求材料通过上下文的文件接点读取 `Blob`。宿主复用原鉴权文件请求，业务页保留原对象、文件 ID、MIME、大小、读取前后复核及下载释放。缺文件接点时读取明确失败。

`MemberNameFlow` 与 `NotificationDraftFlow` 由宿主按需供给，管理文案使用宿主传入的原翻译接点。业务上下文继续约束它们的会话与展示寿命。普通会员功能使用原业务请求。[语言目录](messages.ts)保留原英文词条，由宿主并入公共语言目录。

## 表单与原操作

列表导入与批量操作从 `@rental-os/platform-admin/ui` 使用同一 `ListPreflightError`，当前资料与权限预检继续在原派发前执行，错误类身份与公共列表执行者一致。[列表能力](list-capabilities.ts) · [UI 出口](../../../platform-admin/src/components/ui/index.ts)

企业会员的折叠分组、客户资料的分区标题及奖励内容栈从 `@rental-os/platform-admin/record-detail.module.css` 默认导入原详情样式模块，分别复用 `disclosure`、`sectionTitle`、`stack` 类。[公共详情样式](../../../platform-admin/src/components/RecordDetailLayout.module.css) · [正式包出口](../../../platform-admin/package.json)

会员业务表单复用[既有编辑驱动](../orders/useOrderEditor.ts)，按钮、回车及弹窗确认共用原校验和异步保存 Promise。完整 Form 实例与编辑代次一并保留，关闭经过对应 `dismiss`，异步校验和已派发请求绑定到原编辑对象。

[企业原操作](original-enterprise-operation.ts)保留登记路径白名单、跨页锁、原存储键和精确收据核对。请求派发使用公共单次传输模式。unknown 沿原键与可信收据恢复，表单和当前查询继续各自保留原依据。

[回款冲销](corporate-payment-reference.ts)继续使用原 `ConfirmAction`、回款引用与服务端精确收据。[授信编辑](corporate-credit-draft.ts)使用输入建立时的原修订，后续查询通过原显式采纳流程更新编辑基线。

会员卡复用[HoloCard 适配](HoloCard.tsx)与[原归档](archive/holo-card/SOURCE.md)。归档 JS、CSS、类型和来源说明保持原字节，公共宿主负责映射已有动效偏好。卡面存储沿原账号、租户与方案键读取。

## 原宿主与验证入口

原[会员宿主适配](../../../../apps/admin/src/features/membership/legacy-membership-context.tsx)供给 Auth、原鉴权 Blob 请求及原 AI 组件，并为页面和表单绑定公共页面宿主。旧会员页、客户预览和企业组件窄转接本模块，旧[会员 API](../../../../apps/admin/src/api/membership.ts)、[客户 API](../../../../apps/admin/src/api/customer.ts)及[列表能力](../../../../apps/admin/src/features/listCapabilities.ts)继续供给同一实现。

定向验证沿现有[企业消费者](../../../../tests/enterprise-consumers.test.cjs)、[回款与授信恢复](../../../../tests/admin-session-recovery-review.test.cjs)、[门户授权](../../../../tests/enterprise-portal-access.test.cjs)、[列表交互](../../../../tests/admin-list-interactions.test.cjs)、[客户预览呈现](../../../../tests/rental-order-list-presentation.test.cjs)和[表单/地址操作](../../../../tests/rental-order-command-review.test.cjs)。[客户完整验收](../../../../tests/customer-admin-acceptance.test.cjs)包含真实数据库访问，执行条件按该入口及负责人授权核定。
