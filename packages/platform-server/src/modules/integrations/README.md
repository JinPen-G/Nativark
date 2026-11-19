# 公共第三方服务接入

本模块维护租户共享的第三方配置、服务端凭据、配置修订和连接测试，并提供原短信发送／回执、对象存储签名／HTTP及SMTP/IMAP运输。业务结算、支付执行、通知 outbox、文件 ACL 和原业务事实由实际宿主供给。

| 阅读入口 | 职责 |
| --- | --- |
| [租户 HTTP](tenant-integration.controller.ts)、[政策](integration-http-policy.ts)、[OpenAPI](integration-openapi.ts) | 原目录、保存和测试路径，共用当前租户的 `system:integration:manage` |
| [配置服务](tenant-integration.service.ts)、[窄存储](integration-store.ts) | 原配置行锁、同毫秒修订防重、默认平台切换、测试 CAS 与字段存在性观察 |
| [凭据保管](../../common/secret-box.ts)、[出站校验](../../common/outbound-url.ts) | 原 AES-GCM v1/v2 信封、历史密钥与稳定指纹，原 HTTPS／DNS／重定向限制 |
| [连接测试](tenant-integration.connectivity.service.ts)、[支付探针](integration-probe.ts) | 先核配置与修订，再原子占用 30 秒窗口，供应商错误按原安全投影返回 |
| [短信运行](tenant-integration.runtime.service.ts)、[投递结果](../../common/notification-delivery.ts) | 阿里云／腾讯云的原发送、确定性 nonce 与原回执查询，unknown 保留原操作 |
| [邮箱运行](tenant-email.runtime.service.ts)、[SMTP](smtp-transport.ts)、[IMAP](imap-reader.ts)、[安全邮件解析](inbound-mail-codec.ts) | `/integration-email`、`/integration-smtp`、`/integration-imap`、`/integration-inbound-mail`共用原加密连接、投递结果、只读收信和文本投影 |
| [对象存储](object-storage.provider.service.ts)、[OSS V4](aliyun-oss-v4.ts) | 原 OSS／COS／S3 签名与受控 HTTP，连接测试使用随机对象 HEAD |
| [支付运输](payment-provider-transport.ts)、[Stripe验签](stripe-signature.ts)、[回调限流](payment-webhook-rate-limit.ts) | 原RSA/HMAC签名、精确微信验签材料、受控请求、供应商错误分类和只读连接探针，业务资金及回调归属由实际Core裁定 |
| [微信运输](wechat-mini-program.adapter.ts) | `/integration-wechat` 共用原 code/session、手机号一次性凭证、AppID token 缓存与错误类；不保存客户身份，业务调用者核渠道与水印 |
| [Rental 参加者](../../../../../apps/api/src/modules/integrations/rental-integration-business.participant.ts) | 在原配置事务核租赁结算、支付／退款、短信队列及文件／上传依赖 |
| [公共 schema](../../../../../apps/platform-api/prisma/schema.prisma)、[数据计划](../../../../../apps/platform-api/src/platform-data.ts) | 独立公共链的配置和适配日志表，迁移摘要与实际应用账分别核验 |

## 装配与生命周期

`PlatformServerModule.register` 从同一个数据库提供认证、管理、订阅、配置和日志。`TENANT_INTEGRATION_APPLICATION` 与 `TENANT_INTEGRATION_CONNECTIVITY` 指向原应用服务的同一实例，原 Rental Controller 也消费这两个接点。

宿主通过 `integrationBusiness` 或 `integrationBusinessProvider` 提供结算与依赖核验。停用及更换商户／存储位置均在原配置行锁内读取未完成与历史事实。参加者收到该宿主同一事务，读取范围由所属业务维护。缺参加者的停用或身份更换返回 503。

默认无 Core 宿主从与主装配相同的受控空目录核验业务依赖，并读取公共文件及通知台账，再裁定配置停用。支付启用需要实际结算币种依据。已有支付配置仍留在目录供核对，支付测试需要宿主的 `integrationPaymentProbe`。运行观察的 `integrationRuntimeProviders` 由受控装配声明实际适配，公共默认包含短信、文件和SMTP邮箱。

公共邮箱运行时与连接探针共用一个实例。测试只验证SMTP加密连接和登录，启用收信时再验证IMAP只读连接，不投递或修改邮件。`receiveEnabled`开启后必须提供完整IMAP配置，已存凭据在保存时沿原合并规则保留。通知发送方继续负责当前授权、原消息和投递台账；提交后结果不明保留原操作，不换键重发。

停用邮箱或改变服务器/发件身份时，在原配置事务内核同租户、同提供方的`NotificationSendLog`；`queued`和`delivery_uncertain`拒绝该变更。密码轮换保持原身份规则。查询失败向上返回，空Core目录不能证明没有待核邮件。原邀请、寄件中心和客服同步仍由各自应用服务裁定。

IMAP 使用 `EXAMINE` 和 `BODY.PEEK`。超过 1 MB 的邮件只读取最多 64 KiB 的指定信封头，MIME 解析异常沿同一安全信封解析保留提示。结果携带原 UID、UIDVALIDITY、异常原因和源大小，结果文本为原邮箱处理提示，附件元数据为空，后续邮件继续读取。验证码短信异常将结构化 `deliveryStatus` 保存到原适配日志，结果未知保留 `delivery_uncertain` 和原请求键。

原 Rental 兼容服务保留业务币种的历史回退、进行中支付／退款、待投递／unknown 通知及文件／上传保护。原文件运行服务继承公共存储接点，继续持有业务归属、ACL、字节冻结、上传完成和删除恢复。原支付运行服务提供自己的连接探针及原资金执行者。

目录位于 `GET /api/platform/integrations`，保存位于 `PUT /api/platform/integrations/:capability/:provider`，测试位于同一路径的 `/test` POST。当前租户来自 Guard 与 ALS。公开响应只包含非秘密设置、秘密字段配置标记和原测试结果。

保存先校验目录字段、原凭据及供应商地址，在原事务锁配置、核修订和依赖，然后更新唯一配置与默认选择。空白凭据的保留由原客户端转换与服务端合并共同完成。保存会清除原测试结果。

测试区分 `configuration` 和 `live`。占用、探针和结果均关联原配置内容与修订，迟到结果继续拒绝。短信探针查询模板，存储探针 HEAD 随机对象，支付探针由原宿主读取供应商接口。新业务默认要求当前配置通过 live 测试，原事实恢复可沿原调用使用 `requireLiveTest: false`，并保留业务权限和配置关联。

测试账通过窄存储的 `updateTestConfiguration` 核对租户、配置 ID、修订时间、启用与默认标志、设置、凭据密文和秘密字段。`integrationTestWhere` 将 JSON `null` 映射为当前宿主生成客户端的 `Prisma.JsonNull`，其余条件按原值传递。[公共数据库](../../../../../apps/platform-api/src/database.ts)与[Rental 兼容入口](../../../../../apps/api/src/modules/integrations/tenant-integration.service.ts)分别使用自身客户端，空对象与空数组仍按原值比较。

凭据使用原 `INTEGRATION_ENCRYPTION_KEY`、密钥 ID／历史环及稳定指纹设置。公共宿主只消费进程配置，密钥由部署人员维护。历史信封、存储前缀和 nonce 前缀沿原格式。

## 支付运输

`PaymentProviderTransport`提供原支付宝查询/关闭、微信签名请求与响应验证、Stripe live REST请求和连接探针。它的实例由所选宿主或业务应用持有，配置来自同一公共集成服务。业务创建请求携带所属Core已经裁定的金额、币种和原操作编号。

微信按精确的证书序列号或公钥ID选择材料，校验原始请求/响应和时间戳。Stripe回调复用原HMAC、v1签名及时间容差。请求保留HTTPS/出站地址校验、重定向限制、超时和响应读取清理。

`PaymentProviderUnknownError`、`PaymentProviderDefinitiveError`和HTTP错误保持原类别，由业务应用保存原结果和占用。Rental支付运行与对账文件应用维护原订单金额、退款额度、当前权限、配置锁、资金事务及回调台账。原回调候选缓存由Rental运行实例持有。

## 验证入口

复用原 [安全检查](../../../../../tests/integrations-security.test.cjs)、[内存租户隔离](../../../../../tests/integrations-memory-scope.test.cjs)、[连接与修订](../../../../../tests/tenant-integration-connectivity.test.cjs) 和 [默认选择／历史依赖](../../../../../tests/tenant-integration-default.test.cjs)。原 npm 入口会构建 shared 和组合 API，执行前沿 [项目验证规则](../../../../../AGENTS.md#修改验证与交付) 核环境与写入范围。

支付复用原[unknown](../../../../../tests/payment-provider-unknown.test.cjs)、[付款回调](../../../../../tests/payment-callback-integrity.test.cjs)、[退款回调](../../../../../tests/payment-refund-webhook.test.cjs)、[退款终态与过期](../../../../../tests/payment-refund-terminal.test.cjs)、[恢复](../../../../../tests/payment-recovery-review.test.cjs)、[主动对账](../../../../../tests/payment-reconciliation.test.cjs)、[文件对账](../../../../../tests/payment-reconciliation-file.test.cjs)、[Stripe工具](../../../../../tests/stripe-payment.test.cjs)和[匿名回调权限](../../../../../tests/payment-webhook-guard.test.cjs)。

离线 fixture 验证配置、授权、探针请求和恢复边界。真实 HTTP、供应商、数据库并发、迁移与浏览器证据按各宿主实际环境核验。
