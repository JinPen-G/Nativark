# Enterprise portal

独立企业客户 Web，供当前商户的企业客户管理者处理成员、邀请、使用政策、预约审批和资料申请。共用原个人客户登录，但管理动作逐次核验企业权限；不是商户营运后台，也不在此重建商城、库存或资金业务。生产启用、真实环境与阶段缺口见[企业专项接续](../../docs/企业客户后台/企业客户后台-协作接续.md)，页面存在不代表整项验收。

视觉和交互沿[管理后台规范](../../docs/公共技术资料/界面规范/管理后台-界面规范.md)及[UI 适配规则](../admin/AGENTS.md)，复用原 React/UIArc、主题、语言与原生侧栏，不修改 vendor。订单、财务、全员审计和导出缺正式授权或来源时保持不可用，不展示假记录或假额度。

## 阅读路线

| 领域 | 入口 → 应用服务 → 原来源与消费者 |
| --- | --- |
| 商户入口、客户会话与企业选择 | [main](src/main.tsx) / [App](src/App.tsx) → [企业会话宿主](src/enterprise-session.tsx) → [共用客户 transport](../../packages/web-client/src/session.ts) → 原客户 Auth/Guard、[企业访问服务](../api/src/modules/client/enterprise-access.service.ts) |
| 界面与显式开通 | [Shell](src/EnterpriseShell.tsx) → [窄 UI 出口](../admin/src/components/ui/customer-entry.ts) / [UI 宿主作用域](../admin/src/components/ui/BusinessUiScope.tsx)；商户[配置面板](../admin/src/features/membership/EnterprisePortalConfiguration.tsx) → [门户配置服务](../api/src/modules/platform/enterprise-portal.service.ts) |
| 企业申请与材料 | [申请页](src/WorkflowPages.tsx) / [上传恢复](src/AuthorityUpload.tsx) → [客户 Controller](../api/src/modules/enterprise/enterprise-workflows.controller.ts) → [申请服务](../api/src/modules/enterprise/enterprise-application.service.ts) → [原客户仓储](../api/src/modules/platform/shared-customer.repository.ts) / 原文件服务；商户[审核页](../admin/src/features/membership/EnterpriseApplications.tsx)是独立营运消费者 |
| 邀请、加入与成员交接 | [加入/邀请页](src/WorkflowPages.tsx)、[原申请审阅](src/WorkflowReview.tsx)、[成员操作](src/MemberLifecycle.tsx)、[管理员编辑](src/AdministratorEditor.tsx) → [成员服务](../api/src/modules/enterprise/enterprise-members.service.ts) → 原企业关系及门户动作 grant；[邀请回跳](../../packages/web-client/src/enterprise-invite.ts)只携带同标签邀请，不运输登录凭据 |
| 范围与付费政策 | [政策页](src/PolicyPage.tsx) / 商户[政策配置](../admin/src/features/membership/EnterpriseRentalPolicy.tsx) → [政策服务](../api/src/modules/enterprise/enterprise-policy.service.ts) → 原会员、经营空间与 Core 最终门禁 |
| 原报价审批与执行核对 | [审批页](src/ApprovalsPage.tsx) → [单条审阅](src/ApprovalReview.tsx) / [明确确认](src/ApprovalDecision.tsx) → [审批服务](../api/src/modules/enterprise/enterprise-approval.service.ts) → 原[Core 建单事务](../api/src/modules/rental-core/rental-order-confirmation.service.ts)；网站[消费者](../tenant-website/src/components/EnterpriseBookingApproval.tsx)与小程序[结算页](../miniprogram/src/pages/checkout/index.ts)只消费本人的原引用 |
| 原续租新增支出批准 | [续租审批页](src/ExtensionApprovalsPage.tsx) → [续租批准服务](../api/src/modules/enterprise/enterprise-extension-approval.service.ts) → [客户续租桥](../api/src/modules/client/client-api.service.ts) / [原 Core](../api/src/modules/rental-core/rental-core.service.ts) / [事务内原试算](../api/src/modules/rental-core/rental-business.service.ts)；网站[订单消费者](../tenant-website/src/components/EnterpriseExtensionApproval.tsx)与小程序[续租页](../miniprogram/src/pages/extend/index.ts) / [原操作引用](../miniprogram/src/core/enterprise-extension-operation.ts)只消费本人原续租 |
| 原换货费用申请与审批 | [换货审批页](src/ExchangeApprovalsPage.tsx) → [换货批准服务](../api/src/modules/enterprise/enterprise-exchange-approval.service.ts) → [原换货试算](../api/src/modules/rental-core/rental-exchange-preview.service.ts) / [政策交集](../api/src/modules/enterprise/enterprise-policy.service.ts) / 原 operations；仅费用审阅，商户实物执行及 Core 批准消费尚未接通 |
| 资料与管理申请 | [管理申请页](src/ManagementRequestsPage.tsx) → [申请服务](../api/src/modules/enterprise/enterprise-management-request.service.ts) → 原主档/授信/政策修订及文件 ACL；商户[审核页](../admin/src/features/membership/EnterpriseManagementRequests.tsx)只记录审核，不实际改主档或账本 |
| 本人待办与记录 | [页面](src/TasksPage.tsx) → [派生读模型](../api/src/modules/enterprise/enterprise-task-center.service.ts) → 原申请、批准及本人收据；不冒充全员审计、财务提醒或外部通知 |

公共契约沿 [shared 正式出口](../../packages/shared/src/index.ts)、[DTO](../api/src/modules/enterprise/enterprise-request.dto.ts)、[OpenAPI schemas](../api/src/modules/enterprise/enterprise-workflow-schemas.ts)。营运认证、Copilot 及营运路由不能进入客户 bundle；[Vite 边界](vite.config.ts)拒绝这些运行时导入。旧 `role=admin` 不自动获得开通或动作权限。

## 原操作与恢复

[原操作门闸](src/original-workflow-operation.ts)先持久保存原键/登记路径/状态，再派发一次；本地不保存申请资料、理由、邀请码或凭据。结果未知只读原收据，不以 `not_recorded`、断线或超时推断可重发。身份切换隔离迟到响应；相同客户重新登录仍可核对原引用。商户[原操作适配](../admin/src/features/membership/original-enterprise-operation.ts)同样只持久保存 opaque 引用，复用原营运认证而不重发写入；两种身份和存储命名空间独立。

审批只授权，不占库存/额度，也不自动建单。员工逐条核对原报价后明确提交，批准消费与订单、报价和原 Core 收据同事务。执行中需要结束时，由本人明确请求受控封闭；它与 Core 共用提交锁，已成立订单只读原结果，不取消或退款。封闭后的旧键/报价/批准不能复用，新报价及新审批必须由用户另行发起。已消费批准在幂等收据过期后，仍可沿服务端同事务保存的精确订单引用核对。

续租批准绑定原订单修订、原意图与事务内试算、当前政策和审批人修订。本人明确提交后，原续租记录、幂等、批准消费和命令收据在原事务中关联；补款/生效仍走原资金、资格、库存与服务容量门禁，待补款不改原归还时间。账期新增保证金的真实补足合同缺失时拒绝，不以批准代替收款或冻结。原结果仅沿精确 extensionId/key 回读；未读到收据不证明回滚。有批准 ID 的本人原提交可另行明确请求受控终结：与提交共用订单→批准锁，无消费证据才同事务封闭批准并保留原提交键的终结收据；已消费仅返回原续租，不取消或退款。终结失应答仍按原终结键回读，精确 closed/key 后才解除原未决；无批准 ID 的未知申请现可由本人独立确认封闭原申请键：与申请共用原订单锁，申请先成立只恢复原申请、不撤回；封闭先成立则同事务永久 seal 原键与结束收据，阻止迟到申请。三端只在原订单/空间/本人/原键及独立结束键的证据匹配后解除未决；结束失应答只回读，不重新发送。旧企业 Web 缺原订单引用的未知申请仍保留原引用，不猜补目标。Core 原办理凭证和冻结约束保留，结果未知不是回滚证明。换货/其他新增支出与商户代客委托仍未由此批准放行。

换货费用申请仅接受本人当前空间的逐单企业付费订单，固定原订单修订、商品/分配/替换引用、原试算和政策指纹；非本人当前审核人可批准或拒绝，本人可撤回。复核保留完整价格/规则/日历/检查依据，仅排除试算生成时点。原申请失应答持久保留订单/原键，只在原收据与本人原申请关联匹配后解除；缺收据不可重发或换键。待办展示本人跟进与当前空间非自审队列，不把费用批准作为可执行换货。当前申请表使用资源引用，友好候选选择、网站/小程序换货消费者、商户委托及 Core 原子消费仍待接通；原换货门禁保持拒绝，审批不是实际换货或资金成功。

## 同源分发约束

公共文档路径为 `/:tenantCode/enterprise`，登记商户域为 `/enterprise`。子页仅使用[登记清单](../../packages/web-client/src/enterprise-entry.ts)，包括本人申请、加入、待办、成员、政策和审批；`orders` / `finance` 虽有登记入口但当前不可用。`tenantCode` 是商户编码，客户登录后再选择其下可管理企业，query 不能覆盖商户。

静态资产固定 `/enterprise-assets/`，不与文档路径混用。获准部署时，先将登记企业路径回源到企业 `index.html`，再应用租户网站的通用 SPA 回退；不能由网站 wildcard 接管企业页。API 保持本站 `/api/client/v1`，两应用共用客户会话和同一 Web Lock；跨 origin 凭据运输和小程序浏览器免登录不在此合同内。

Vite 使用 `envDir:false`，无 API 代理；已批准的 offline 模式不请求业务后端，只显示未连接限制。构建不自动授权启服务、迁移或部署，正式 host / 代理和真实客户链须在获准环境核验。

## 验证入口

- [企业访问](../../tests/enterprise-portal-access.test.cjs)、[共用 Web 会话与邀请回跳](../../tests/web-client-session.test.cjs)。
- [申请/邀请/成员/管理申请](../../tests/enterprise-workflows.test.cjs)、[政策](../../tests/enterprise-policy.test.cjs)、[审批](../../tests/enterprise-approval.test.cjs)。
- [真实审批/命令/政策与 Core 方法组合](../../tests/enterprise-core-execution.test.cjs)：存储、事务与原业务依赖仍是明确替身，不证明 MySQL 锁或资金执行。
- [原续租/企业批准/政策与幂等组合](../../tests/enterprise-extension-approval.test.cjs)：含真实原试算算法、Nest DTO 管道和 ClientApi 原资金门禁调用顺序；持久配置、付款证据与数据库仍为明确替身，不证明真实资金或 MySQL 锁。
- [实际前端事件闭包与原结果消费者](../../tests/enterprise-consumers.test.cjs)：不是 React DOM、浏览器、微信宿主或真实 HTTP 联调。
- 本应用 [tsconfig](tsconfig.json)、[构建配置](vite.config.ts)；命令及退出码统一记入[现有开发记录](../../docs/企业客户后台/企业客户后台-开发记录.md)，不在模块导读维护测试数量或任务流水。
