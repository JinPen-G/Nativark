# 公共官方日历来源

本模块维护平台公共官方日历来源主档及只追加的年度版本。平台维护入口由 SaaS 管理员使用，业务侧通过只读来源接点取得原版本，再按自身权限形成和发布业务日历。

| 入口 | 职责 |
| --- | --- |
| [来源服务](official-calendar-source.service.ts)、[私有存储](official-calendar-store.ts) | 原来源主档维护、年度版本追加、同来源/年度 sequence、快照与历史读取 |
| [Controller](official-calendar-source.controller.ts)、[原 DTO](official-calendar-request.dto.ts) | 原五个操作、三条 `/platform/official-calendars` 路径与字段校验 |
| [政策](official-calendar-http-policy.ts)、[OpenAPI](official-calendar-openapi.ts) | SaaS 身份、`system:calendar-source:manage` 及原 operationId |
| [只读 reader](official-calendar-source-reader.ts) | 冻结六个读取方法，供实际宿主向业务参加者提供公共来源 |
| [公共 schema](../../../../../apps/platform-api/prisma/schema.prisma)、[公共迁移](../../../../../apps/platform-api/prisma/migrations/20261118000000_public_official_calendars/migration.sql) | 原两表最终定义、快照字段、数值序号及 RESTRICT 外键 |

## 实际宿主接点

宿主将同一数据库实例登记到 `OFFICIAL_CALENDAR_DATA_STORE`，并提供一个 `OfficialCalendarSourceService` 实例。维护 Controller 通过 `OFFICIAL_CALENDAR_APPLICATION` 消费该实例。两个 token 从 `@rental-os/platform-server/official-calendar-store` 导出，Controller 从 `/official-calendar-http` 导出。主装配合入本模块五个操作与 OpenAPI schemas，按原 SaaS 身份及权限复核每次维护请求。

[公共 Guard](../../platform-auth.guard.ts)每次核验原 operator 签名和会话，再从当前账号及有效角色读取 SaaS 身份与权限。已核验的 SaaS 管理员沿原官方日历维护分面访问上述五个登记操作，精确匹配 `system:calendar-source:manage`。普通租户账号即使持有该权限或 `*` 仍受 SaaS 身份门槛约束。未知路径或方法按原登记边界拒绝，账号、租户或会话失效及当前 SaaS 身份撤销后拒绝准入。

政策从 `@rental-os/platform-server/official-calendar-http-policy` 导出 `OFFICIAL_CALENDAR_HTTP_OPERATIONS`。字段和查询声明从 `/official-calendar-openapi` 导出 `OFFICIAL_CALENDAR_SCHEMAS` 与 `OFFICIAL_CALENDAR_OPENAPI_QUERY_SCHEMAS`。来源版本列表接受可选整数 `year`，过滤语义沿原 Controller。

业务读取通过 `@rental-os/platform-server/official-calendar-reader` 的 `OFFICIAL_CALENDAR_SOURCE_READER` 提供 `createOfficialCalendarSourceReader` 的冻结结果。该对象包含 `listVersions`、`getVersion`、`findVersionById`、`getApplicableVersion`、`latestVersionForYear` 和 `availableSourceSummaryForYear`，均调用同一来源实例。业务 Controller 继续使用其本端权限和原版本引用。

原 Rental [服务构造入口](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/rental-core/official-calendar-source.service.ts)保留单参数数据库构造并继承同一公共实现，[旧 Controller](https://github.com/JinPen-G/Zelo/blob/46db0945dee92ac916f7265e95948943fc8b641d/apps/api/src/modules/rental-core/official-calendar-source.controller.ts)再导出同一公共类。原配置 DTO 出口兼容同一运行时校验类。官方字段从 `@rental-os/platform-contracts/official-calendar` 正式出口消费，原 Rental/shared 合同由所属作者兼容再导出。

## 版本与历史规则

每次登记在原事务中取本来源、本年度最大的 sequence 并追加一行。两个唯一键保护版本号和数值序号，原唯一键冲突重试一次并最终返回明确冲突。来源名称、URL 和地区按登记时快照读取，来源主档后续维护保留历史版本的原含义。

停用来源后，`activeOnly` 列表过滤它，`getApplicableVersion` 拒绝新采用。`getVersion` 和 `findVersionById` 继续读取原历史版本。年度更新只在同一来源内比较，跨来源概况返回可用与总来源数。可选版本缺失与存储错误分别处理，原查询错误继续上抛。

独立公共迁移沿原注册表、快照/序号和 RESTRICT 三阶段的最终结构创建两表。原组合库的历史迁移及其回填依据留在原位，数据搬迁、真实迁移和历史行核验由实际部署流程办理。

原[日历范围冒烟](https://github.com/JinPen-G/Zelo-rental-core/blob/f4d27fce7d53fa21b1d3fc94ade7d5eab44f1445/workspace/tests/rental-calendar-range.test.cjs)和[MySQL E2E 官方来源阶段](../../../../../tests/mysql-e2e.test.cjs)保留。执行环境、数据库与外部连接按[项目规则](../../../../../AGENTS.md#修改验证与交付)核定，离线字段/存储/Controller 证据与真实宿主分开记录。
