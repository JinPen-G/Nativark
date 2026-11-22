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

网络与包材料读取在主体锁外完成，文件发布持有原账号、会话、角色及租户锁，返回前再核当前授权和原部署。候选目录按摘要固定，同摘要并发准备复用先发布的完整目录、原回执及准备时间。只有确认目标目录缺失才开始暂存，目录读取失败返回 `preparation_read_failed`。新 Core 包由原安装准备写入，完整迁移和记录在同一暂存目录验证后一次发布。发布失应答时沿同一摘要回读，重新打开存储仍可取得原准备时间及回执。普通退出由 `finally` 只清理仍存在的本次暂存目录；强制退出可能留下未发布的 `.core-candidate-*` 目录，须先核明创建者、绝对路径、进程及在用状态和实际文件归属，不能按 TTL 或目录年龄推定安全删除，也不能把已发布的原候选目录当作暂存残留。

摘要目录中的 `deployment/core.deployment.lock.json` 保存完整候选组合，Core 迁移原文位于 `deployment/migrations/core.<Core ID>.<迁移 ID>/migration.sql`。选中 Core 的完整包位于 `package/<Core ID>-<版本>-<包 SHA>/`，所选数据能力的完整包位于 `platform-capabilities/<能力 ID>-<版本>-<包 SHA>/`。重新打开 `createCorePackagePreparationFileStore` 后，用原 SHA 调用 `read` 核对这些文件与原准备时间，再由应用的回执入口复验当前管理权限。

回执入口独立使用当前管理主体与候选存储，可在上游来源、材料或当前部署读取不可用时继续核对原 SHA。摘要目录缺失返回 `preparation_unavailable`，只表示尚无可核定的发布结果；即使取消等待发生在发布前，也不能从目录缺失推断原请求未执行或已终止，原请求仍可能在准备或发布。已存在目录的记录或文件损坏返回 `operation_conflict`。当前管理权限撤销时拒绝读取，文件冲突按原候选记录和实际字节处理。

[管理页面](../../../platform-admin/src/features/core-packages/README.md)的 sessionStorage 指针只覆盖同一标签页会话内的重载，不保证关闭标签页后恢复。关闭标签页前须另行保存原候选 SHA；关闭后使用当前有效 SaaS 会话，通过[正式 HTTP](http.ts)的 `POST /api/platform/core-packages/preparation-receipt` 与 `{"sha256":"<原候选SHA>"}` 读取同一结果。指针和摘要只定位原结果，不授予权限。

完整公共装配使用 `createPlatformCorePackageAudit` 在原事务写入 `requested` 提交意图。审计失败在文件派发前拒绝，审计之后再次核当前主体和原部署。文件派发后遇数据库提交、主体复验或原部署读取失败，继续返回原候选 SHA 的 `unknown`，原操作冲突保持原拒绝状态。[同事务审计](../core-package-audit.ts)

宿主存储返回的成功记录须经原记录 schema、请求 SHA 和完整候选指纹核对。准备已调用存储而回包不可核定时返回携带原 SHA 的 unknown，后续读取同一摘要。原回读发现记录摘要或计划指纹不符时拒绝，写入失应答返回另一摘要时按原操作冲突拒绝。

存储调用返回 `unavailable` 时，准备应用保留原错误并转换为携带原 SHA 的 `unknown`，页面继续使用原指针核对回执。客户端取消等待或连接中断不等于撤销发布，已经派发的准备沿原摘要读取，当前授权在读取时重新核验。下载超时及发布前缺少来源、材料或存储由准备请求的发布前准入返回具体失败；该返回与回执查询的目录缺失 unavailable 分别判断。

候选记录及 HTTP 结果中的 `deployment` 一直为 `pending`。部署交接沿以下四步办理；命令在与固定发行相符、已完成正式源码构建和所选 Client 准备的仓库根执行。示例中的 `C:\checkout`、`C:\release`、原准备 SHA 和完整包目录须替换成实际绝对路径；新文件的父目录须存在，输出文件及新迁移目录不得已存在。

1. 用 `POST /platform/core-packages/preparation-receipt` 和 `{"sha256":"<原准备SHA>"}` 回读原候选，重新核当前管理权限、记录和全部文件。失应答或 `unknown` 继续核同一 SHA；准备摘要与平台/Core 包摘要各有用途，不能互换。回执成功只证明原 pending 材料可核定。
2. 保留候选 `deployment/core.deployment.lock.json`、所选完整包及锁中未变对象的原固定材料。Core 更新的目标包取自候选 `package/<Core ID>-<版本>-<包 SHA>/`，未更新 Core 继续用与候选 pin 一致的原完整包；数据能力同样使用候选保存的完整固定包。底座更新在候选 `platform/` 保存文件，打包仍须提供最初预检的完整底座 `.tgz`，其摘要须等于候选锁的 `platform.sha256`。将锁中的 `platform` 对象单独导出给原准备入口，不能把整份部署锁当发行 JSON：

   ```powershell
   $candidateLock = 'C:\release\candidates\<原准备SHA>\deployment\core.deployment.lock.json'
   node -e "const fs=require('node:fs'); const lock=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); fs.writeFileSync(process.argv[2],JSON.stringify(lock.platform,null,2)+'\n',{flag:'wx'});" $candidateLock C:\release\platform.release.json
   ```

3. Rental 或双 Core 先用[原部署准备](../../../../apps/rental-api/src/prepare-deployment.ts)生成完整 schema、迁移和锁。通用候选的 `deployment/schema.prisma` 仅含数据源，不能直接当作 Rental 打包材料。下面是关闭 AI 的 Rental 命令；双 Core 在末尾加 `--additional-core C:\release\example-tickets-core`，所选完整包及顺序须与候选锁一致。新迁移目录须是实际 `apps/rental-api` 根的直接子目录，使生成器指向同一 `../generated/client`。生成后比较完整锁，失败即停止交包：

   ```powershell
   node apps/rental-api/dist/prepare-deployment.js C:\release\platform.release.json C:\release\rental-core C:\checkout\apps\rental-api\prisma-update
   node -e "const fs=require('node:fs'); const read=p=>JSON.parse(fs.readFileSync(p,'utf8')); require('node:assert/strict').deepEqual(read(process.argv[1]),read(process.argv[2]));" $candidateLock C:\checkout\apps\rental-api\prisma-update\core.deployment.lock.json
   ```

   已选 AI 时，在三个位置参数后、`--additional-core` 前再传候选 `dataCapabilities` 中的固定 AI 数据发行 JSON 和完整 AI 包目录；打包对应使用 `--ai enabled --ai-data-package <同一完整AI包绝对目录>`。此步骤不生成 Client、不执行 SQL、不证明实际迁移就绪；所选 Client 仍按[宿主构建步骤](../../../../apps/rental-api/README.md)准备并核对同一 schema。
4. 完整材料与候选锁一致后交原打包器。零 Core 公共宿主直接用候选锁，打包器自行核原公共 schema/迁移；单工单宿主在公共命令后加 `--host example-tickets --tickets-package C:\release\example-tickets-core`。Rental 使用上一步的新完整部署目录，双 Core 在 Rental 命令后加 `--host example-multi-core --tickets-package C:\release\example-tickets-core`：

   ```powershell
   node scripts/package-platform-host.cjs --lock $candidateLock --platform-package C:\release\platform-source.tgz --platform-client C:\checkout\apps\platform-api\generated\client\index.d.ts --output C:\release\platform-host.tgz --deps C:\checkout\node_modules
   node scripts/package-rental-host.cjs --ai disabled --deployment C:\checkout\apps\rental-api\prisma-update --platform-package C:\release\platform-source.tgz --rental-package C:\release\rental-core --client C:\checkout\apps\rental-api\generated\client\index.d.ts --platform-client C:\checkout\apps\platform-api\generated\client\index.d.ts --output C:\release\rental-host.tgz --deps C:\checkout\node_modules
   ```

   按实际组合选择其中一个命令，使用本仓库已生成的专属 Client 和固定完整包。[公共打包器](../../../../scripts/package-platform-host.cjs)与[Rental 打包器](../../../../scripts/package-rental-host.cjs)核源码/包、依赖锁、完整部署材料与启动出口；打包不办理镜像构建、迁移、切换或注册，结果继续为 pending。

前进更新仍由[原更新规划](../../../core-contracts/src/update.ts)拒绝程序或数据降版。兼容程序恢复须使用上次已验证的完整运行包及其原部署锁，先确认当前数据可由旧程序读取、原迁移链和物理结构符合该锁，全部所选底座/Core/能力及合同相互兼容，并核历史与在途操作、当前授权/分配/绑定的保留。同一数据版本不自动证明这些条件；部分迁移或 unknown 继续按原收据核对。旧候选、修改锁、倒写数据版本或放宽包校验均不能作为回退依据。本链没有通用程序回退执行器，实际恢复及不兼容拒绝须由目标环境验证。部署者继续办理当前数据核验、原迁移、切换和注册，租户授权及成员分配沿原入口保持。完整独立运行、真实数据库和宿主验收沿原专项门槛核收。

GitHub 传输复用正式 `@rental-os/core-contracts/github-http`。本模块通过 `@rental-os/platform-core-host/core-package-preparation` 导出，公共 API 使用统一装配供给 Guard、OpenAPI 和宿主文件配置。新候选的存储派发前缺少来源、材料或存储适配时返回 unavailable。源码类型、受控运输/文件 fixture 与真实 GitHub、文件系统、HTTP 和部署验证分别记录。[公共宿主](../../../../apps/platform-api/README.md)

读取及删除前核对当前路径、原文件身份、长度、修改时间和实际字节；候选存储保留原准备失败与清理失败。打开描述符后、写入内容前再次核对普通父目录及描述符对应路径，发现目录替换立即停止内容写入。Windows的wx打开可能先创建空文件，程序不会据此删除根外或并行文件。

安装准备事务使用独立的30秒期限，用于锁内核对当前完整安装材料和发布前后授权。普通业务事务沿原设置；超过准备期限时停止并沿原SHA核对unknown，不自动重发。
