# Rental API 组合

本目录持有公共平台与 Rental 标准包的同实例组合。当前提供构造、数据准备和生命周期入口，完整 HTTP 请求管线仍在接入，尚无可独立启动的 `main` 或 `AppModule`。

## 入口

| 入口 | 职责 |
| --- | --- |
| [assembly.ts](src/assembly.ts) | 解析实际部署锁、核定标准 Rental 包，使用唯一数据库构造原认证、业务、HTTP、作业与标准 Core 接点。当前只接受显式 `aiMode: "disabled"`；所选数据能力非空会拒绝。 |
| [database.ts](src/database.ts) | 公共 40 模型与 Rental 121 模型组成的宿主 Client；公共数据库令牌指向同一连接池。生成目录只归本宿主，导入不连接数据库。 |
| [lifecycle.ts](src/lifecycle.ts) | 原 Core/业务初始化与预热只运行一次，再启动配货、到期任务、文件清理和限流清理。退出先停新并等待在途工作，HTTP 关闭后断开唯一数据库；排空失败不提前断库。 |
| [deployment-package.ts](src/deployment-package.ts) | 从实际依赖位置读取固定标准包并校验文件摘要；源码位置、同名版本和准备结果均不能替代实际部署证据。 |
| [Rental 应用](../../packages/rental-core/src/application.ts) | 组合原领域、客户、企业、支付、文件、渠道、品类和作业。构造不查询数据库、不调用供应商、不启动定时器。 |

`assembly.http` 供给原 `RentalHttpModule` 的九组服务，`assembly.extensions` 供给独立 `RentalHttpExtensionsModule` 的空间切换、开发重置密码及员工订阅上下文。原组合宿主已登记这三个路径的薄适配 Controller，不能再次导入扩展模块。公共六项认证仍使用公共模块，同一认证、订阅和 Guard 实例不得重复构造。

客户管理通过 [createRentalCustomerManagementApplication](../../packages/rental-core/src/application-customer-management.ts) 选择已构造客户服务，空间管理通过 [createRentalWorkspaceManagementApplication](../../packages/rental-core/src/application-workspace-management.ts) 使用同一数据库、Core 和能力实例。两者分别供给 `RentalCustomersHttpModule`、`RentalWorkspacesHttpModule`；旧 `PlatformController` 已有对应35及11条路径，不能再次挂载。空间档案、品类必选能力及账号复合授权保留原提交边界，SaaS 代建空间与普通租户的 Core 准入仍需按各自真实主体接入。

## 请求与事务

[application-access](../../packages/rental-core/src/application-access.ts) 的 `run` 须覆盖原 Guard 和完整请求处理；Guard 成功后才可 `withRequest`，并由原业务的 [Tenant 父锁](../../packages/rental-core/src/mysql-business-fence.ts) 在原事务中复核当前 Core 授权、适用成员分配、绑定和实际部署。该接点不替代原角色、客户、对象、地点或文件权限。

纯 GET/HEAD 只接受宿主代码明确登记的 `{ bufferedRead: true }`，消费期间不能写业务、直接发送 Response 或打开响应流；返回缓冲结果前再做短事务复核。普通写请求不在提交后追加拒绝，避免将已成功的原操作收据伪装成失败。不得把请求体中的同名字段作为路由登记。

目前企业及客户部分独立事务、公开客户认证、媒体直出、支付与回调仍需逐条衔接。`assembly` 暴露的原 Guard 只是原权限实例，不能单独挂上全部业务接口来代替上述请求管线。Core 停用后的当前善后授权尚未接齐，不能以统一拒绝作为完整兼容验收。

## 可选 AI 与验证边界

未启用 AI 时选用 161 模型，不提供 AI 出箱、正文维护或工具参加者；客户检查出箱合同使用显式 `null` 表达此选择，`undefined` 和残缺对象会拒绝。启用 AI 的应用工厂必须取得实际失败出箱、同事务事件和通知草稿读取器；此目录尚未提供启用组合，247 模型的类型证据不代表选装数据已经落库或可运行。

已完成的验证为离线源码组合、原权限/事务行为、所选 schema 类型及虚拟时钟生命周期检查。尚未执行实际数据库迁移、供应商请求、真实 HTTP 服务或生产发布。准备数据只能形成待部署材料，不能写入迁移成功记录。实例作为生命周期 provider 的登记必须只由本目录 `RentalApplicationLifecycle` 统一负责，避免重复预热、计时器和断库。
