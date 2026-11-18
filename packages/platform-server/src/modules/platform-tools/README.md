# 公共字典与编号

本模块持有原租户字典维护、编号规则维护和取号实现。公共宿主通过原会话、当前租户及两个原工具权限访问，原 Rental 组合通过薄适配消费同一服务与纯逻辑。数据继续保存在原 `SystemParameterSet`，合同使用平台合同包的原正式类型。[合同](../../../../platform-contracts/src/index.ts) · [公共身份围栏](../platform/platform-principal.authority.ts)

## 调用链

| 入口 | 职责与消费者 |
| --- | --- |
| [正式模块出口](index.ts) | 服务、Controller、存储类型、HTTP 声明与原格式函数 |
| [Controller](platform-tools.controller.ts) | 原五个 HTTP 操作，路径编码覆盖请求体编码 |
| [DTO](platform-tools.dto.ts) | 原四个请求类，保持嵌套字典项、日期、周期和数值校验 |
| [服务](platform-tools.service.ts) | 原主体授权、当前租户读写、取号、提交前复验及同事务审计 |
| [仓储](platform-tools.repository.ts) | 当前租户的最高生效版本，保留历史、草稿及其他 JSON 字段 |
| [私有存储端口](platform-tools.store.ts) | 原身份、配置和审计操作，由宿主同一数据库实现 |
| [原纯逻辑](platform-tools.values.ts) | 字典正规化、规则正规化、格式与递增，供原演示内存分支消费 |
| [HTTP 政策](platform-tools-http-policy.ts) | 两个原权限、五个原路径及租户 audience 边界 |
| [OpenAPI 字段](platform-tools-openapi.ts) | 宿主组合需要的请求与响应 schema |

原 [PlatformService](../../../../../apps/api/src/modules/platform/platform.service.ts) 的 MySQL 分支委托五个同名公共方法。`listDictionaries(defaults?)` 与 `listNumberRules(defaults?)` 允许可信 Rental 适配传入原默认资料，其他方法的原请求及结果保持。原 [Controller](../../../../../apps/api/src/modules/platform/platform.controller.ts) 保留窄入口，独立公共宿主注册本模块 Controller，各组合按实际装配选择唯一 HTTP 执行者。宿主通过原 `PLATFORM_AUTH_DATA_STORE` 注入相同数据库。[公共页面](../../../../platform-admin/src/features/platform-tools/README.md)

原三个默认字典和五条默认编号含租赁业务语义，继续留在 Rental 适配及初始化来源。零 Core 公共缺省为空。仓库搜索中，五个方法的业务入口均经原平台 Controller，未发现 Rental 订单或合同服务调用此取号器。现有业务自己的编号算法继续由原领域负责。[原默认资料](../../../../../apps/api/src/modules/platform/platform.service.ts) · [原初始化](../../../../../apps/api/prisma/seed.ts)

## 范围、原子性与历史

字典使用 `system:dictionary:manage`，编号使用 `system:number-rule:manage`。租户管理员及原有效通配权限沿原授权生效，SaaS 账号拒绝租户工具。原 Guard 对这两类配置没有另设 `all` 或全部地点门槛，公共服务保留对应工具权限在当前租户内的语义。当前账号、角色、会话、租户状态及签名范围由公共主体围栏在事务中核对。[原 Guard](../../../../../apps/api/src/common/api-auth.guard.ts)

每次操作采用 Serializable 事务，先锁原 Tenant 父记录，再沿原公共身份围栏锁定和复验账号、会话、角色及权限。取号、规则保存、配置写入与审计共用此事务。取号递增在锁内读取最新序列，保存省略当前流水时同样在锁内保留原值。审计失败、提交前撤权、配置版本/状态变化和数据库冲突均使本事务失败，调用方重新读取核对，取号失败后是否已提交沿原结果处理。

读取显式包含当前租户、原 module 和 `EFFECTIVE`，按 `versionNo` 降序。写入使用读取到的生效行 id、租户、module、版本及状态匹配，保留其他 JSON 字段。没有生效行时在已有最大版本之后创建生效记录，保留同键草稿。历史 JSON null 和缺字段沿原缺省读取，无法核对的结构拒绝。原规则编码、序列、启停、审计动作和字段保留，保存先正规化编码再查现有规则，防止空格或大小写造成序号回退。

格式保持原前缀、连字符、日期和 `padStart` 算法，日期使用宿主本地时间。`resetCycle` 沿原行为保存，取号连续递增。安全整数边界在递增前拒绝，避免 JavaScript 精度造成重复流水。显式提交 `currentSequence` 继续沿原维护合同处理，页面省略未提供编辑控件的该字段，防止旧页面快照覆盖新取号结果。

## 验证入口

定向验证复用原离线守卫、类型检查器和主体/事务 fixture，通过短 stdin 执行，临时目录集中到本树 `output/.tmp` 并由退出清理释放。正常与拒绝范围覆盖当前租户、原格式、正规化、并发递增、规则保存、历史生效行/草稿/JSON、审计与撤权回滚、DTO 及 HTTP 声明。[项目验证规则](../../../../../AGENTS.md#修改验证与交付)

fixture 中的事务与锁用于验证参加者调用及提交边界。真实 MySQL 锁竞争、HTTP、浏览器和完整组合运行由专项原验收入口接续。[当前专项入口](../../../../../docs/平台底座/Core接入/平台Core接入-协作接续.md)
