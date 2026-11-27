# 公共持久限流

[计数内核](mysql-rate-limit.ts) 从原 [Rental限流服务](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/src/mysql-client-rate-limit.ts) 复用哈希、可信地址、窗口和原子计数 SQL。[窄存储端口](rate-limit.store.ts) 仅要求同一真实数据库的事务、executeRaw 和 queryRaw，使用官方参数化 SQL，无需加载默认生成 Client。

## 桶和事务

consumeRateLimitBucket 保持 client-api、原 rule.code 与原 identity 的 SHA256，时间窗口按原 floor(now/windowMs) 定位。INSERT 的重复键更新和 SELECT 在同一事务，原 scopeKey/bucketStart 唯一键、ID、日期及字段保持。超过限制的计数仍由原调用者在事务完成后拒绝，原次数和当前已消耗额度保留。

调用者在 beforeIncrement 供给原同事务父锁或授权函数。Rental 的验证码身份/租户预算使用原 lockRentalBusinessTenant，公共层只执行实际回调。普通原地址/会话消费继续使用其原有父锁安排。

缺表、SQL失败或事务失败向原调用者传播。INSERT 后缺行、坏类型、非安全整数或非正数明确 503，不能将不确定读取转为零。只有真实桶结果才返回计数。

## 宿主接点

[模块出口](index.ts) 由正式 @rental-os/platform-server/public-rate-limit 映射。宿主提供已核同库的 SqlRateLimitStore。consumeRateLimitBucket新增第六个可选源码参数SqlRateLimitTable，默认CLIENT_API_RATE_LIMIT_TABLE，允许的另一个值是PLATFORM_API_RATE_LIMIT_TABLE。内核仅引用本模块两个静态官方raw标识符片段，未知值在事务前拒绝。公共演示预约使用同源 WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE、clientAddress 与 consumeRateLimitBucket，identity 保持 ip:可信地址，按返回 count 大于5拒绝。

[公共演示预约 Controller](../demo-requests/public-demo-request.controller.ts) 的 DEMO_REQUEST_RATE_LIMIT 由[公共装配](../../platform-server.module.ts)供给。默认装配构造同库DemoRequestRateLimitService，使用公共表。[完整Rental装配](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/src/application-platform.ts)供给原application.client.rateLimit，routesToPlatform按[公共政策](../../platform-http-policy.ts)选择公共Guard，Controller计数一次并使用原旧桶。原组合宿主沿[原Guard](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/src/http-auth.ts)计数一次，旧Controller转接创建。

数据归属采用两个独立物理表。[公共schema](../../../../../apps/platform-api/prisma/schema.prisma) 的 PlatformApiRateBucket 映射 platform_api_rate_buckets，由[公共持久桶迁移](../../../../../apps/platform-api/prisma/migrations/20261123000000_public_rate_limit/migration.sql) 和[公共数据声明](../../../../../apps/platform-api/src/platform-data.ts)维护。零Core或工单宿主使用公共表，原Rental的ClientApiRateBucket/client_api_rate_buckets、原计数和迁移在原数据域保留。

[DemoRequestRateLimitService](demo-request-rate-limit.ts) 是可直接由独立宿主构造的真实参加者。构造签名为new DemoRequestRateLimitService(store)，store是同一真实SQL数据库的SqlRateLimitStore。服务源码固定公共表PLATFORM_API_RATE_LIMIT_TABLE，宿主注入 DEMO_REQUEST_RATE_LIMIT，沿固定Demo端口消费。assertAllowed输入沿固定Demo端口的method/path/ip，并接受可选socket.remoteAddress。地址归一沿原clientAddress，表名由源码固定常量选择。

该服务await原计数事务后，count大于5时抛原HttpException 429及“客户端请求过于频繁，请稍后重试”，已消耗计数保留。原Client超限响应和Nest默认JSON异常链采用省略Retry-After头的行为，参加者保持该语义。缺行、坏计数和SQL/事务异常直接沿冻结内核传播。HTTP路由/可信代理、模型迁移与清理由宿主原接点管理。

## 规则、生命周期与验证

所有原业务规则、小时/日次数、短信日预算、identity格式和拒绝文案继续归原 Rental 服务。WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE 保存原5次/600秒值，供公共宿主与Rental共用。清理仍由原唯一服务执行，宿主零Core场景的实际清理归其唯一生命周期安排，内核只计数。

类型沿 [原所选Prisma检查器](../../../../../scripts/check-selected-prisma-types.cjs)，原算法加载沿 [源码入口](../../../../../scripts/controller-sources.cjs)。必要离线冒烟比较原SQL/键/窗口、5次及第6拒绝、失败/缺行传播和原父锁次序。实际数据库并发、表部署及原清理timer沿宿主授权验证。
