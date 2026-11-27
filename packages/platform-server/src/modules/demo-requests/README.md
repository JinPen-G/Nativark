# 平台演示预约

匿名提交入口在 [PublicDemoRequestController](public-demo-request.controller.ts)，SaaS 列表入口在 [PlatformDemoRequestController](platform-demo-request.controller.ts)。两者使用同一 [DemoRequestService](demo-request.service.ts) 和宿主公共数据库的 [存储端口](demo-request.store.ts)。[DTO](demo-request.dto.ts) 复用原校验，正式类型来自 @rental-os/platform-contracts/demo-request。

## 创建和恢复

创建保留原字段归一顺序、requestKey、payloadHash 和官方 Prisma P2002 错误语义。独立生成 Client 各自持有运行库，使用[公共错误识别](../../prisma-runtime.ts)核官方 Error 的类型标识，不跨包比较构造器，也不接受普通带 code 的对象。唯一键冲突按原 requestKey 读取 payloadHash，同摘要返回原 received 回执，缺原行或不同摘要返回 409。其他存储错误继续抛出。匿名回执只含 received。

## 权限和分页

列表由原 operator Guard 建立签名 ALS，同时要求真实 SaaS 身份。原 Guard 对 system:demo-request:view 按 SaaS 身份提供隐含能力，账号未列出显式权限码时也保留原合法读取。租户管理员及其通配权限继续拒绝。服务在查询前和返回前分别沿 [当前主体权威](../platform/platform-principal.authority.ts) 锁定并复验原租户、账号、会话与角色。两次身份复验使用同一宿主数据库的短 Serializable 事务，分页保留原批量 count/findMany 事务、createdAt/id 倒序及原字段投影。返前撤权将拒绝返回个人资料。

## 宿主接入

注册 [PlatformServerModule](../../platform-server.module.ts) 即挂载同一 DemoRequestService 和两个唯一 Controller，PLATFORM_AUTH_DATA_STORE 指向同一身份及 DemoRequest 数据库。正式包子出口 @rental-os/platform-server/demo-requests 映射[模块出口](index.ts)。[HTTP 政策](demo-request-http-policy.ts)和[OpenAPI](demo-request-openapi.ts)已合入公共聚合，匿名仅开放 POST，列表的 saas_demo_request 政策由公共 Guard 显式核 SaaS 身份，保留原隐含能力，system:demo-request:view 仍为正式能力标识。两个 HTTP 回应沿原 no-store。

公共匿名 Controller 必须取得 DEMO_REQUEST_RATE_LIMIT，其 assertAllowed 使用真实原子桶，按可信 request.ip 执行原 5 次 / 600 秒规则。缺参加者拒绝，限流异常在创建前传播。原组合宿主的 Guard 已执行这一次限流，因此 [旧匿名 Controller](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/demo-requests/public-demo-request.controller.ts) 保留 Guard 前置路径，只转接公共创建。公共 Controller 使用自身限流路径，宿主须按所注册 Controller 明确唯一扣额处。

默认公共模块构造 [DemoRequestRateLimitService](../public-rate-limit/demo-request-rate-limit.ts)，使用公共 PlatformApiRateBucket。公共数据版本0.1.9增加[独立限流表迁移](../../../../../apps/platform-api/prisma/migrations/20261123000000_public_rate_limit/migration.sql)，部署仍须应用同版迁移。完整 Rental 宿主通过 [PlatformApplicationBindings.demoRequestRateLimit](../../platform-server.module.ts)提供原 [ClientApiRateLimitService](../../../../rental-core/src/mysql-client-rate-limit.ts)，沿旧表、旧桶及原清理生命周期。其[公共路径分流](../../../../rental-core/src/application-platform.ts)使该请求走公共 Guard，再由 Controller 扣额一次；原组合继续由原 Guard 扣额、旧 Controller 只创建。公共新表不重复创建或清空 Rental 旧表。

## 消费和验证

原 [DemoRequestService adapter](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/demo-requests/demo-request.service.ts) 保留 PrismaService 注入位置并委托同一公共类，原 DTO 转出公共类。管理端 [客户端](../../../../platform-admin/src/features/platform-settings/demo-requests-client.ts) 和 [页面](../../../../platform-admin/src/features/platform-settings/DemoRequestsPage.tsx) 保持原列表路径及字段，沿宿主 SaaS 页面范围消费。原 [SaaS Controller](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/demo-requests/platform-demo-request.controller.ts) 保留原双重身份保护，公共服务进一步复验。

必要类型沿 [所选 Prisma 检查器](../../../../../scripts/check-selected-prisma-types.cjs)，元数据和短行为验证沿 [原 Controller 源码入口](../../../../../scripts/controller-sources.cjs)。离线验证使用明确数据库和限流存储夹具，实际部署的数据库、可信代理、DI 注册及 HTTP 由宿主同版验证。
