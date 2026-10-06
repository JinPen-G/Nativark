# AIN-24 Lane B：威胁模型与实际入口

本文件是离线辅助评测范围，不修改 AIN 原需求、中央进度或完成率；不宣布上线或生产安全验收。主线负责公共授权、Gateway、预算、审批及运行器。本树只读消费这些实现。

## 资产、攻击者与信任边界

保护资产：租户/空间/客户知识正文与引用、确认偏好、模型凭据、审批事实、调用预算、恢复执行权、审计证据。攻击者包括受限员工/客户、过期 automation、恶意 BYOK 端点、恶意模型响应和被污染的文档/附件。

客户端/模型提供的 actor、scope、权限、审批、价格和工具参数都不是授权事实。文档/模型输出是数据，不能转换为系统指令、永久授权、任意 URL/SQL/代码执行或 Core 写入。数据库与正式服务端适配才是持久状态/当前授权来源；离线 DB、DNS、连接及业务端口替身不是外部验收。

## 固定与对抗用例到实际实现

入口：`apps/api/src/modules/ai-native/evaluation/offline-threat-suite.cjs`。冻结清单按文件执行现有固定正常/拒绝用例与对抗变体，不另建测试专用工作台或预算/权限算法。以下只是证据路由；具体断言在对应测试中。

| 风险 | 实际方法/套件 | 离线证据与剩余边界 |
|---|---|---|
| 越权、跨租户/空间/客户引用 | KnowledgeRetrievalService / KnowledgeSourceService；knowledge-access | 真实服务，合成当前权限/仓储；非完整 Guard/HTTP |
| 撤回/删除、缓存命中泄漏、ACL修订 | KnowledgeCache / PublicationService / IndexCoordinator；knowledge-cache | 真实本地缓存与头状态；不证明分布式通知与外部索引物理删除 |
| 身份替换、下载权限修订变化 | authorize / SourceService.download；knowledge-lane-b-authority | 新红测修复；下载只返回受控资源引用，实际 HTTP 文件端点仍需接同一当前门 |
| 文档提示注入、任意工具请求、无来源回答 | KnowledgeGatewayContext / KnowledgeTextParser；knowledge-flow / knowledge-parser | 实际 user-data 组装、引用复验与 no_results 不调用；Gateway/模型外部执行为替身 |
| 格式欺骗、恶意附件、过量读取 | KnowledgeTextParser / DocumentService.parseDocument；knowledge-parser / knowledge-access | UTF8、NUL、字节/字符/chunk上限，未知格式拒绝；不支持PDF/Office/OCR，不伪称解析成功 |
| 记忆永久授权/密钥、跨空间摘要、伪造确认 | StructuredMemoryService；memory-service | 封闭偏好、owner/scope绑定、90天期限及删除/修改；正式确认来源仍由主线提供 |
| 确认撤销与读取竞态 | StructuredMemoryService.read；memory-lane-b-revocation | 最后读回后重新核验确认；顺序复验非原子授权承诺 |
| SSRF、metadata、私网、DNS重绑定、重定向 | ModelEgressTransport.post / modelEgressUrl / publicModelAddress；model-egress | 实际请求构造、地址固定与重定向拒绝，DNS/HTTPS是显式替身；没有真实 DNS/外联 |
| 平台/租户凭据与模式混用、跨scope兜底 | ProviderRouter / UnifiedGateway；router-boundaries | 实际路由/Gateway，凭据端口为合成依赖，不接真实Vault/供应商 |
| 配置 revision 过期/await期间篡改 | TenantModelConfigService；config-boundaries | 实际配置服务与合成CAS/加密依赖；非配置HTTP链 |
| 未验证能力/mock冒live | ProviderCapabilityService；capability-evidence-boundaries | 实际证据失效/必需能力拒绝；未做live探测 |
| 审批伪造/重放/主体与关联替换 | AiApprovalConsumptionService；ain07-approval-consumption | 实际消费服务，业务写入/仓储为明确替身；不证明Core事务和真实审批HTTP |
| 财务预算修订竞态、金额边界、unknown重放 | PrismaBudgetRepository / BudgetService；c03-budget / c01-budget | 实际仓储/服务、事务替身；不证明MySQL行锁 |
| 财务预算最后额度、部分写入回滚、跨租户策略 | BudgetService + PrismaBudgetRepository；lane-b-financial-race | 实际预算算法/仓储，锁与回滚由数据库执行替身模拟；最后额度只测单层策略，三层/多数据库进程尚未验 |
| 跨恢复资源最后单位争抢 | PrismaTaskExecutionBudgetRepository；execution-budget-repository | 实际adapter、序列化事务替身；资源预算不扣币，不能替代上一行财务争抢证据 |
| 恢复提权/撤权/旧holder接管 | 正式授权运行器组合 / PrismaTaskTakeoverRepository；task-authorized-recovery | 实际组合与持久事务替身；不证明真库崩溃恢复 |
| XSS/危险链接/超长模型文本 | 管理端真实 ModelText；lane-b-render-security | 实际React SSR转义及上限；不是DOM点击、浏览器CSP或微信真机验收 |
| 审计思维链/正文/密钥泄漏、模型自评分 | evaluationAudit / evaluationSummary；lane-b-audit | 实际封闭格式校验；不是生产审计持久化、可信摘要生产或服务端授权 |

## 判定与审计

确定性测试：按实际退出码、pass/fail/skip/todo及证据层级报告。未知/超时/计数缺失不可算通过，失败退出1，不修改旧失败或使用skip/todo变绿。语言质量单列 `not_sampled`；本集没有模型给自身打分，没有人工耗时/修正率/成功率采样。

审计格式只保存 hash、计划/工具引用及受控结果码，不允许提示词、来源正文、原始错误、秘密、内部授权封套或思维链。hash不是授权证明；正式当前授权及摘要生产者未接入时不得用于生产放行。统一CLI只打印白名单计数，不透传异常正文。

## 仍需主线/后续授权

- 当前正式 ACL/确认/内容生产来源，跨进程撤销传播、真正文件下载端点与知识授权一致性。
- 财务预算三层交集/多进程最后额度竞争和真库锁行为；单层最后额度已由LB05实际service+Prisma adapter离线用例覆盖。资源竞争证据不能冒充财务竞争；本树不跨范围修预算。
- 审批消费与Core同事务/COMMIT应答丢失组合、平台Vault真实隔离、恢复租约真库故障、真实能力探测。
- 真实模型指令服从/语言质量、真实网络、DB、HTTP、浏览器、微信宿主/设备和生产灰度全部未验。

这些是明确未覆盖项/接线缺口，不是已确认的跨模块代码缺陷；不得报告成已通过。作者自查非独立 Review。
