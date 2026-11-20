# 固定下载与候选准备

[HTTP](http.ts) → [应用](application.ts) → [原包预检](../core-package-preflight/README.md) → [实际材料与候选文件](bundle.ts) → [一次发布和原回读](file-store.ts)。[固定 Release 读取](github-source.ts)提供同一包来源端口，[校验与端口](ports.ts)保存请求、摘要及 pending 投影，[浏览器协议](protocol.ts)提供同源路径和类型出口。

[管理页面](../../../platform-admin/src/features/core-packages/README.md)消费同一预览、准备与回执，固定引用或候选摘要作为原结果核对入口。协议路径常量可独立供浏览器使用，端口继续再导出原常量。

宿主登记固定 Release pin 或供给已下载包来源。GitHub 读取先后核对原 Release、Tag 提交、资产 ID、长度及摘要，原归档和包检查继续生效。同一固定发行的引用合并在途读取，缓存保留一个已下载固定包。原固定内容可以用于后续准备，新的发行选择由宿主另行登记。

候选准备复用原 `prepareCoreInstall` 与 `createCoreMigrationDeployment`。宿主提供原基础组合、完整平台迁移和当前实际 Core 包文件，替换前先按当前部署锁核对全部原材料，再用新包替换指定对象。目标包或原迁移材料已修改、缺失及集合冲突均停止候选生成，保留当前组合和用户改动。底座迁移采用实际 `prisma/migrations/<原目录>/migration.sql` 映射，原组合与候选的全部迁移摘要、Core 包和声明顺序均由原部署生成器核查。

旧 API 许可来自宿主可信 `legacyApiRoutes`，按 Core ID 绑定精确方法和路径。固定 GitHub 下载、原预检、候选材料生成、原部署生成器和文件存储共用同一许可，独立文件存储省略许可仍执行原命名空间拒绝。`prepareGitHubCoreRelease` 在原 fetcher 参数之后接受同一精确集合，并传给原 `prepareCoreInstall`。[宿主供给](../core-package-assembly.ts) · [固定发行合同](../../../core-contracts/src/github.ts)

基础组合已选择的数据能力须由材料来源提供同一固定完整包，经 `requirePlatformDataCapabilityFiles` 核查后进入原部署生成器。候选同时保存能力全部代码、schema、迁移和资料文件，原能力发行及全文件摘要参与同一指纹。缺包、仅有 SQL、额外能力或公共/Core 数据前置不符均拒绝准备。原锁省略能力字段时继续生成原未选装组合。

单能力更新使用已登记的 `platform-capability` 包引用。原预检核当前完整发行与数据观察，再将选中能力的完整归档替换到候选材料映射。底座、Core及其他能力继续使用原固定材料，目标能力代码、schema、历史与新增迁移一并写入其固定版本目录。原部署生成器复核全部材料与候选锁，准备只发布同一 SHA 的 pending 文件及回执。

静态包检查失败时，准备结果保留原文件位置和失败原因，页面就地显示同一诊断。缺实际材料或原迁移执行证据时，沿原 unavailable 返回。

| 入口 | 输入和结果 |
| --- | --- |
| `POST /platform/core-packages/preview-preparation` | 读取固定材料，返回原组合、候选及确定性摘要 |
| `POST /platform/core-packages/prepare` | 使用同一请求与原 `expectedSha256` 发布 pending 文件 |
| `POST /platform/core-packages/preparation-receipt` | 使用原摘要核对已发布文件及原准备记录 |

请求采用 `operation` 和同一预检 `package` 对象。准备再提供原预览摘要。当前组合、包、文件或请求变化时拒绝旧摘要，原候选仍可按原摘要读取。unknown 保留同一引用，原结果 unavailable 表示缺少可核定证据。

网络与包材料读取在主体锁外完成，文件发布持有原账号、会话、角色及租户锁，返回前再核当前授权和原部署。候选目录按摘要固定，已存在目录只核原内容。新 Core 包由原安装准备写入，完整迁移和记录在同一暂存目录验证后一次发布，失败清理本次尚未发布目录。

完整公共装配使用 `createPlatformCorePackageAudit` 在原事务写入 `requested` 提交意图。审计失败在文件派发前拒绝，审计之后再次核当前主体和原部署。文件派发后遇数据库提交、主体复验或原部署读取失败，继续返回原候选 SHA 的 `unknown`，原操作冲突保持原拒绝状态。[同事务审计](../core-package-audit.ts)

宿主存储返回的成功记录须经原记录 schema、请求 SHA 和完整候选指纹核对。准备已调用存储而回包不可核定时返回携带原 SHA 的 unknown，后续读取同一摘要。原回读发现记录摘要或计划指纹不符时拒绝，写入失应答返回另一摘要时按原操作冲突拒绝。

候选记录及 HTTP 结果中的 `deployment` 一直为 `pending`。部署者继续核当前数据与原迁移执行，完成所需构建、迁移、切换和注册，再进入租户授权及成员分配。完整独立运行、真实数据库和宿主验收沿原专项门槛核收。

GitHub 传输复用正式 `@rental-os/core-contracts/github-http`。本模块通过 `@rental-os/platform-core-host/core-package-preparation` 导出，公共 API 使用统一装配供给 Guard、OpenAPI 和宿主文件配置。缺来源、材料或存储均明确 unavailable。源码类型、受控运输/文件 fixture 与真实 GitHub、文件系统、HTTP 和部署验证分别记录。[公共宿主](../../../../apps/platform-api/README.md)
