# 公共 SaaS 契约

`@rental-os/platform-contracts` 提供租户、账号、角色、认证、公共设置、文件生命周期、第三方服务标识及原SaaS订阅的正式类型和运行时常量。此包没有运行依赖，不加载 Core、ORM 或 Web 框架。[唯一源码](src/index.ts) · [订阅合同](src/subscription.ts) · [包出口](package.json)

```ts
import { TenantStatus, type PlatformSessionContextResponse } from "@rental-os/platform-contracts";
```

原 `@rental-os/shared` 和 `@rental-os/shared/platform` 再导出同一声明，保留 Rental 与各端既有导入。新增公共消费者使用本包，行业字段继续由所属 Core 契约扩展。[原兼容出口](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/workspace/packages/shared/src/platform-identity.ts)

公共成员密码重置和局部角色权限保存分别使用 `ResetUserPasswordRequest`、`SaveRolePermissionsRequest`，复用原人员／角色合同的字段和可选性。旧 `/auth-dto` 的 `SwitchWorkspaceDto` 关联 `LegacySwitchWorkspaceRequest`，仅保留原 `workspaceId` 传输格式；公共认证控制器不挂载空间切换，空间权限和切换结果仍由 Rental Core 裁定。[请求合同](src/index.ts) · [认证 DTO](../platform-server/src/modules/auth/auth-session.dto.ts) · [管理 DTO](../platform-server/src/modules/platform/platform-management.dto.ts)

订阅可从 `@rental-os/platform-contracts/subscription` 单独导入。原 `@rental-os/shared` 继续再导出同一枚举和字段，基础版/PRO、统一期限、金额可空及原请求语义沿SUB专项。Core开通、成员分配和业务权限不由套餐字段代替。

服务端通过 `@rental-os/platform-contracts/request-fingerprint` 使用原确定性 SHA-256 算法。平台审计、文件绑定和 Core 幂等共用这一实现，原 API 路径转接同一函数。该 Node 子出口按需加载，根合同继续用于浏览器及业务类型消费。[指纹源码](src/request-fingerprint.ts) · [原 API 接点](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/common/request-fingerprint.ts)

文件冻结校验从 @rental-os/platform-contracts/file-content-binding 导入，只核原内容摘要、提交路径和稳定存储位置。位置引用不包含凭据或供应商客户端，缺冻结证据返回undefined；不能把文件存在或旧active状态当成已冻结、可读取或允许上传。该Node子出口按需加载，Rental与其他文件消费者共用同一校验。[冻结依据](src/file-content-binding.ts) · [旧文件接点](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/integrations/file-content-binding.ts)

文件上传、完成与下载合同可从 `@rental-os/platform-contracts/files` 导入，根出口也提供同一类型。原shared/infrastructure再导出原八项声明，已有DTO、OpenAPI与客户端消费的字段保持；业务对象归属、文件ACL和冻结证据仍由服务端核验。[文件合同](src/files.ts) · [原兼容出口](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/workspace/packages/shared/src/infrastructure.ts)

第三方服务标识从 `@rental-os/platform-contracts/integration-provider` 导入。原 shared/tenant-integrations 再导出同一类型，目录和现有DTO/API字段保持；标识不携带SDK、密钥或调用权限。公共通知结果使用该标识描述原服务商回执。[服务标识](src/integration-provider.ts) · [原兼容合同](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/workspace/packages/shared/src/tenant-integrations.ts) · [通知结果](../platform-server/src/common/notification-delivery.ts)

通知目录、发送日志与适配日志从 `@rental-os/platform-contracts/notifications` 导入，根合同及原 shared/infrastructure 再导出同一五项声明。模板内容、业务触发和真实发送由宿主提供，模拟回执仍使用原状态字段；声明不包含业务默认模板或额外授权。[通知合同](src/notifications.ts) · [原兼容出口](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/workspace/packages/shared/src/infrastructure.ts)

异步任务的 `AsyncJobSummary`、`CreateAsyncJobRequest` 和打印任务的 `PrintJobSummary`、`CreatePrintJobRequest` 从 `@rental-os/platform-contracts/jobs` 导入，根和原 shared/infrastructure 再导出同一声明。创建、尝试次数、排期、历史状态及可空结果沿原字段；台账登记不授予业务执行权限。存储和日志参加者由宿主提供，打印模板、业务裁定和实际执行由所属业务负责。[作业合同](src/jobs.ts) · [公共台账](../platform-server/src/modules/jobs/job-ledger.ts)

运营邀请、寄件中心和客服邮件从 `@rental-os/platform-contracts/tenant-messaging` 导入，根出口及原shared再导出同一声明。原账号/邀请载荷的`workspaceAccesses`字段保持兼容，由宿主按所属Core核验，公共租户角色与Core使用权分别处理；字段本身不强制新Core采用Rental经营空间。投递状态、邀请原操作键和邮件分页字段保持，公开结果不包含邀请令牌或SMTP凭据。[消息合同](src/tenant-messaging.ts) · [公共应用](../platform-server/src/modules/messaging/README.md)

官方日历来源从 `@rental-os/platform-contracts/official-calendar` 导入，根出口提供同一声明。来源主档、年度不可变版本、原来源快照和轻量摘要归平台；日期字段保留原代码及可选字段，Core自行决定业务采用、营业和价格规则。原Rental/shared继续再导出同名类型，公共合同不依赖Rental日期实体。[来源合同](src/official-calendar.ts) · [Rental兼容与业务采用](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/src/contracts.ts)

官网演示预约从 `@rental-os/platform-contracts/demo-request` 导入，根及原 shared 出口提供同一声明。匿名提交只返回接收回执，列表为 SaaS 管理能力；平台线索不归属业务 Core，不开放按联系方式查询或匿名回显。[预约合同](src/demo-request.ts) · [原兼容出口](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/workspace/packages/shared/src/demo-request.ts)

原 AI Native 的任务/步骤状态、版本和 Runner 结果从 `@rental-os/platform-contracts/ai-task` 导入，根和原 shared 草案再导出同一声明。它们不包含 Rental 工具、对象或 ORM 类型，不授予任务和业务权限；原字面量及 unknown 恢复语义保持。[任务合同](src/ai-task.ts) · [公共 Runner](../platform-server/src/ai-runtime/README.md)

选装公共工作中心从 `@rental-os/platform-contracts/ai-work-center` 读取操作、原定位和封闭结果 schema。`AI_PUBLIC_WORK_CENTER_ORIGINAL_READS` 给 HTTP 与受控 MCP 共用的 Task／会话摘要及原结果返回组件。租户身份、当前角色与源对象权限仍由实际宿主复验。[同源合同](src/ai-work-center.ts)

同一入口提供原 Step 事件、结果错误及 `createAiStepDraftSchemas`。公共宿主按自己的已发布工具和版本核验；原 Rental OpenAPI 沿原工具枚举生成同一组件，shared 的状态类型保留该枚举。来源引用仍受本端对象与字段授权。[原 Step schema](src/ai-step-draft-schemas.ts) · [持久化消费](../ai-native-server/src/task-steps.ts)

业务 Core 的事实引用使用 `resourceType: "core:<coreId>:<resourceKind>"`，例如 `core:example-tickets:ticket`；两个标识各为 1–64 位小写字母、数字和单连字符，且以字母开头。`resourceId` 保留原业务对象 ID，`scope` 与 `basis` 保留真实范围及原结果依据。原六类引用兼容不变；公共 Step 和知识入口共同校验新增格式。格式通过不证明 Core 已安装、对象可读或业务已提交，宿主必须按静态登记的 Core 读取原收据并核当前权限，不把类型名转换成 URL 或任意工具调用。

AI上下文与C03 Gateway从 `@rental-os/platform-contracts/ai-gateway` 导入。调用、结果、事件和Gateway端口以已注册工具请求为泛型，默认不接工具；`createAiGatewayDraftSchemas()`只允许空工具数组，传入Core明确的严格schema后才接受对应工具结构。上下文、配置引用、用量与unknown使用原版本，结构校验不替代当前权限、批准或业务裁定。原shared继续以原订单解释契约特化，并生成完全相同的旧schema。[正式接点](src/ai-gateway.ts) · [工具槽与版本](src/ai-gateway-draft.ts) · [上下文schema](src/ai-context-schemas.ts) · [有限schema读取](src/ai-leaf-schema-validation.ts)

模型配置、原操作收据和用量从 `@rental-os/platform-contracts/ai-usage` 导入，模型目录发现从 `@rental-os/platform-contracts/ai-provider-discovery` 导入。原 C07 版本、严格 schema、金额精度、凭据变更和目录仅元数据语义保持，shared 原出口再导出同一声明及 schema 对象。实际保存由宿主当前授权、原配置/Profile 事务和原键收据裁定。[配置与用量](src/ai-usage.ts) · [目录发现](src/ai-provider-discovery.ts) · [公共配置工厂](../ai-native-server/src/model-configuration.ts)

阅读时从正式类型到 [公共服务](../platform-server/README.md)，再到 [公共宿主](../../apps/platform-api/README.md)。`PlatformTenantSummary.enabledBusinessLines` 是兼容字段，公共身份返回空集合；实际 Core 使用权从当前部署、租户授权及成员分配读取。租户、角色或公共文档存在不会赋予业务工具权限。

构建使用 `npm run build -w @rental-os/platform-contracts`，类型检查使用本包 `lint`。字段变化须核原 shared 出口、生产者、HTTP DTO / OpenAPI 及直接消费者，按 [项目规则](../../AGENTS.md#业务与安全边界) 保存兼容与验证证据。
