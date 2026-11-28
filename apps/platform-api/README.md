# 独立公共 API 宿主

这个宿主只装配公共 SaaS 服务和公共 schema，不依赖 `apps/api`、`@rental-os/shared`、Rental 或工单源码。默认不安装任何 Core。当前提供公共初始化、登录 / 本人 / 会话 / 改密、租户与人员角色 / 组织管理、安全配置、账户与租户外观、完整订阅办理、字典与编号、邀请 / 寄件 / 客服邮件、健康和 OpenAPI，基础集成、官方日历来源及标准 Core 管理也已接公共模块。独立运行包和标准 Core 组合已有正式入口，真实运行验收分别记录。[Core 接入手册](../../packages/core-contracts/README.md#五步快速接入)

## 安装组合只读诊断

源码检出可以先运行 [platform-doctor](../../scripts/ops/platform-doctor.cjs)。入口仅使用 Node 内置模块收集本地前置；已有同树 `@rental-os/core-contracts` 构建产物时，包、部署锁和兼容检查复用其正式出口。缺依赖时给出缺项，不安装依赖或借用父目录的 `node_modules`。

```sh
node scripts/ops/platform-doctor.cjs
node scripts/ops/platform-doctor.cjs --profile public-ai --root <公共AI解包目录> --json
node scripts/ops/platform-doctor.cjs --profile selected-core --root <组合目录> --host apps/example-tickets-api --lock <绝对锁路径> --core example-tickets=<绝对标准包目录> --platform-package <绝对底座tgz路径> --json
```

| 选择 | 检查对象与前置 |
| --- | --- |
| `platform`（默认） | 零 Core、无选装数据能力；检查根清单/npm v3 锁、宿主依赖、公共 Client 与启动产物。完整仓库根启动检查 `ZELO_PLATFORM_DATABASE_URL`，源码发行按其实际根命令检查 `DATABASE_URL` |
| `public-ai` | 零 Core＋单个 `ai-native` 数据包；检查组合来源回执、所选 schema/Client、`start:ai` 产物及配置。沿用 `CORE_DEPLOYMENT_LOCK_FILE`、`PLATFORM_AI_DATA_PACKAGE_DIR`、`PLATFORM_AI_PROFILE_ID`；不要求付费模型调用 |
| `selected-core` | `--lock` 固定所选 Core 和可选公共能力，`--host` 指定目标目录内宿主；每个 Core 传 `--core ID=<绝对包目录>`，每个能力传 `--capability ID=<绝对包目录>`。Core＋AI 的包组合可以诊断，但实际接线及 Client 必须沿所属宿主核验；公共 `start:ai` 不能直接用作有 Core 的宿主 |

`--root` 默认是工具所在源码根。`--lock` 显式参数优先；所选 Core 模式必须显式提供它，不猜测业务宿主的环境变量。传入锁后，使用 `--platform-package` 提供同一底座原归档。只报告锁声明的版本、固定来源与摘要，未经检查的来源地址隐藏；不将候选包或源码版本标成已运行版本。v2 分阶段新装锁通过正式合同识别，仍保留专属宿主/旧库兼容待核状态。

报告逐项包含状态、依据和具体处理入口。`pass` 只说明本项检查通过；启动产物存在只标为 `file-present-only`。退出 `1` 表示缺项或冲突，`2` 表示用法错误或检查不完整，`0` 表示所检查的前置无缺项。依赖检查覆盖所选宿主的 dependencies/devDependencies，选装和 peer 依赖继续由原构建与启动核验。源码回执的文件摘要一致只证明本地字节与回执一致，发行真实性须另核固定来源及实际归档。正式源码归档携带这些工具，并投影 `npm run doctor`、`npm run platform:install --`、`npm run platform:upgrade --`；完整仓库可直接运行同一 Node 文件。

**默认数据库为 `unknown / 未检查`。** 默认命令不读取原迁移账、账号或真实服务。获准读取所选库后，可在工具同树显式使用 `--profile platform|public-ai --database`，把[真实安装观察](#显式安装与真实就绪)合入报告。工具不读取 `.env`、不输出连接串、密钥、初始化口令或底层异常；诊断不执行下载、生成、初始化、Seed、迁移、授权或启动。部署准入、租户授权、成员分配、绑定和业务就绪仍由所属权威提供，数据库就绪不会代替这些状态。

另可显式添加 `--service`，使用下方升级入口的进程 API 地址和当前 SaaS 会话，从原包管理 `catalogue` 取得底座/Core/能力的实际版本与数据可用状态。运行集合、版本、来源和摘要须与本地 `--lock` 选择一致；不匹配或缺观察不会放行。此读口适用于提供正式部署观察的 Core＋AI 宿主，缺失的装配和业务权威仍保持未检查；它不直接连接该 Core 的库，也不代替租户/成员/绑定就绪。

已准备候选时可加 `--service --prepared <原sha256>`，在同一报告读取原 `preparation-receipt`，比较候选与本地所选组合；`candidatePreparation: recorded` 只表示原候选及其文件核定。候选尚未运行时，当前版本仍按实际宿主显示，不会因为有准备回执改成已部署。

所选 Core 还可加 `--member`，通过同一 API 地址和单独的 `PLATFORM_DOCTOR_MEMBER_ACCESS_TOKEN` 读取原本人 `session-context` 及 `scope/read`。使用要验收的当前租户成员会话；`--service` 的 SaaS 会话不代替它。报告逐 Core 显示所选版本是否相符、原准入、租户授权、成员分配、权限数量、绑定及业务就绪，不输出租户/用户/容器标识、自由文本或业务内容。没有出现在本人目录中的 Core 标为 `not_available_to_member`，其具体授权原因仍未核定，不推断授权行不存在。

租户级范围直接读本人原范围；容器型 Core 需 `--scope <Core-ID=绝对范围JSON>`。JSON 沿原 `CoreScopeBindingQuerySchema`，例如 `{"coreId":"example-tickets","container":{"type":"workspace","id":"实际已获权空间"}}`；字段只定位范围，实际访问权由原服务端核定。每个 Core 可传一份，未选择的 Core 或多余字段拒绝。会话事实在范围读取前后变化时返回未知。`runtime.member` 的状态与包版本、数据库分别记录：业务就绪不表示任意动作已获权，仍须完成实际页面/读写验收。

修复命令仅供使用者按自己的环境许可显式办理。后续初始化见下方五步；实际 Core 准入和授权见[公共宿主](../../packages/platform-core-host/README.md#部署准入与存量切换)，升级与中断恢复沿[原固定来源及升级预检](../../packages/core-contracts/README.md#分别更新底座或一个-core)。缺失应答按原操作和收据核对，不重跑初始化、迁移或业务动作。

## 从诊断到初始化与就绪

在原诊断命令后加 `--steps`，查看当前组合的办理顺序；`--steps --json` 将相同内容放入 `nextSteps`。每步列执行角色、前置、原入口、需核收的结果和中断处理。命令来自已有宿主说明，仅展示供显式执行；工具不代办操作、不记录完成度，也不接受人工填报的“数据库已就绪”。

```sh
node scripts/ops/platform-doctor.cjs --steps
node scripts/ops/platform-doctor.cjs --profile public-ai --root <公共AI解包目录> --steps --json
```

| 阶段 | 执行角色与核收 |
| --- | --- |
| 本地材料 | 部署者核固定源码、原锁、依赖、唯一 Client 和构建产物；检查通过只表示本地前置成立 |
| 数据观察与迁移 | 部署者在已指定环境核原迁移账及物理结构，再显式应用获批迁移。完整仓库的零 Core 根入口提供 `npm run db:migrate:status`；公共 AI 与业务 Core 使用各自数据观察，不能用零 Core 读取器判断其组合库 |
| 公共账号 | 迁移已核定后显式执行原初始化。`initialized: true` 表示创建公共 SaaS 主体，`false` 表示原主体核验通过；均不创建业务租户或 Core 授权 |
| 登录与租户开通 | SaaS 管理员完成实际登录和首次改密，再经原租户入口创建业务租户及首个管理员；租户管理员使用独立账号改密与登录 |
| Core 就绪 | 逐项核实际装配/数据、部署准入、租户授权、成员分配、业务角色、绑定和业务条件；每项只读回自己的原状态及操作收据 |
| 选装 AI | 核固定数据包、对应 Client、真实数据及适用权限。公共 AI 的角色授权显式办理；模型配置、业务工具可用和普通 Core 业务分别核验 |

数据库观察必须区分：没有任何对象的空库、迁移和结构已兼容但账号尚未核定的库、原账号可用的已初始化库，以及原账未知/不兼容/执行未完的库。后者停止初始化和迁移，沿原所有者升级或恢复入口处理。`db:migrate:status` 只读迁移与结构，不能判定账号、租户、权限或业务已经可用；读失败也不是空库。

首次初始化的 `SEED_PLATFORM_PASSWORD` 至少 8 位且含字母和数字，只通过受控进程配置提供。[原初始化服务](../../packages/platform-server/src/modules/platform/platform-initialization.ts)在同一 Serializable 事务创建主体，重复显式执行保留既有口令、角色及授权，只补录公共权限定义。执行初始化仍要求提供符合规则的初始口令，但它不用于登录或核对旧账号；无需索取旧租户密码。既有平台管理员不可用时返回冲突，不重置或恢复该账号。失应答先执行下方不需要口令的 `status`，读取原主体和初始化审计。

Core 步骤复用[唯一管理合同](../../packages/core-contracts/README.md#core-管理-http-合同)：先读取当前准入/授权/分配/绑定及修订，写入使用原 `operationId` 与版本条件，失应答继续查对应原操作。已有 `stopped`、撤回分配和业务配置保持原事实；重启或重开不重放 Seed。安装者、SaaS 管理员和租户管理员即使是同一人，也须在各入口使用适用的当前身份与权限。

真正收口还需要在指定环境完成零 Core 新装登录、所选 Core＋公共 AI 状态回读、重复初始化保留账号，以及必要的拒绝和恢复冒烟。`--steps` 的指导、静态检查、既有 CI 和本地依赖状态都不代替这些运行证据。

## 显式安装与真实就绪

[安装命令](../../scripts/ops/platform-doctor-install.cjs)要求显式选择 `platform` 或 `public-ai`，只使用工具同树的宿主、依赖、生成 Client 和原迁移。先按下方五步完成依赖、Client 和构建；公共 AI 先取得正式选装源码，并配置下文的锁和数据包。完整仓库的零 Core 使用 `ZELO_PLATFORM_DATABASE_URL`，继续限制为回环独立 `zelo_platform_*` 库；解包发行使用进程 `DATABASE_URL`。存在会被 Prisma 发现的 `.env` 时拒绝办理，不读取内容。

```sh
node scripts/ops/platform-doctor-install.cjs status --profile platform
node scripts/ops/platform-doctor-install.cjs migrate --profile platform --approve <本次status的migrationApproval>
node scripts/ops/platform-doctor-install.cjs initialize --profile platform
node scripts/ops/platform-doctor.cjs --profile platform --database --steps
```

公共 AI 将 `--profile platform` 替换为 `--profile public-ai`，并提供 `CORE_DEPLOYMENT_LOCK_FILE` 和 `PLATFORM_AI_DATA_PACKAGE_DIR`，或显式 `--lock` / `--capability ai-native=<绝对包目录>`。执行前后须使用同一选择。`selected-core` 暂不执行通用迁移或账号编排，继续由所属固定宿主提供数据和生命周期；材料诊断仍支持 Core＋AI。

| 原库观察 | 含义与可继续入口 |
| --- | --- |
| `unknown` | 未取得完整元数据可见性、连接/结构读取失败，或 AI 部分迁移需所属数据所有者恢复；停止写入 |
| `empty` | 已实际读取并确认没有数据库对象；可审核本次原迁移链后显式 migrate |
| `migration_pending` | 原账与已应用公共迁移前缀的物理结构一致；待迁移数量单列，可在核定执行范围后 migrate |
| `migration_incomplete` | 原账有未结束或失败收据；返回原迁移 ID/摘要，不重放、不执行 migrate resolve |
| `incompatible` | 原账缺失、历史摘要/顺序改变、出现未选对象或物理结构不符；沿旧库/所属数据恢复流程处理 |
| `ready` | 完整原迁移账与所属物理读取器核同；初始化状态另列，服务、登录及业务仍未检查 |

空库判定前核数据库账号的库级元数据可见性。当前支持显式库级/全局权限声明，须能读全部表、视图、事件、触发器及过程元数据；仅表级权限、角色间接授权或部分撤权无法可靠核定时返回 `metadata_visibility_unverified`，不会推断空库。工具只查询，不自行授予权限。所有数据库读取由[安装观察模块](src/installation.ts)在有界事务内办理并断开连接，沿原 `_prisma_migrations` 和物理结构读取器，不另建迁移账。

`migrationApproval` 绑定本次目标和所选 schema/锁/迁移摘要，是部署者核对执行范围的确认值，不是权限凭证。须先取得当前环境迁移许可、备份及停机条件，再传给 `migrate`；工具重新观察原库，仅对已核空库或公共前缀调用原 Prisma `migrate deploy`，完整链直接返回 `already_applied`。原 Prisma 排他锁与原迁移账保持；失败或失应答为 `unknown`，随后只读 `status` 核原阶段。工具不会从网络补引擎、覆盖 Client 或自动恢复 DDL。实际使用库的并发迁移/运行切换仍由部署窗口管理。

`initialization.state` 分为 `not_checked`、`uninitialized`、`initialized`、`conflict`。账号就绪复用原仓储的启用主体、租户、SaaS 身份和必要管理权限；只输出状态、首次改密标记以及 `platform.initialized` 审计是否存在。没有审计不补造历史收据。`initialize` 先核完整数据状态，再调用原初始化服务；旧的 `db:initialize`/workspace 命令保留。未知响应不自动重发，先用 `status` 判断原事务结果。账号存在不证明实际密码登录成功。

安装 `status` 退出 `0` 表示本次观察完成（可能仍为空库或待迁移），`1` 表示已知冲突，`2` 表示未知或用法错误。执行命令退出 `0` 表示本步骤完成，`1` 表示前置拒绝，`2` 表示结果未核定；不能只看退出码判定整套服务就绪。

## 单对象升级与中断接续

[升级命令](../../scripts/ops/platform-doctor-upgrade.cjs)消费正在运行的原 `/api/platform/core-packages` 接口，使用当前 SaaS 会话和宿主版本观察。先通过原登录入口取得会话，通过受控进程配置提供 `PLATFORM_DOCTOR_API_URL`（HTTPS origin 或回环 HTTP origin）和 `PLATFORM_DOCTOR_ACCESS_TOKEN`。令牌不放命令参数，不进入输出；请求禁止跳转和自动重试。包引用必须已由原发行/本地归档入口登记，命令不凭任意 URL 下载包。

```sh
node scripts/ops/platform-doctor-upgrade.cjs status
node scripts/ops/platform-doctor-upgrade.cjs plan --kind platform --reference <候选固定包引用>
node scripts/ops/platform-doctor-upgrade.cjs prepare --kind platform --reference <同一引用> --sha256 <预览返回的摘要>
node scripts/ops/platform-doctor-upgrade.cjs receipt --sha256 <同一摘要>
```

只更新 Core 时使用 `--kind core --id <Core-ID>`；只更新公共数据能力时使用 `--kind platform-capability --id <能力-ID>`。`status` 分别投影锁定与实际底座/Core/能力版本、固定来源和可用状态。宿主没有真实包/原账/物理观察时保持 `unavailable`，不把传入锁当运行版本。零 Core＋AI 和 Core＋AI 是否可用由各自宿主实际供给决定。

`plan` 调用原 `plan-update` 和 `preview-preparation`，复用正式 `planCoreUpdate` 的来源、不可变历史、可读范围和单对象更新约束，显示当前/候选及迁移差异。`prepare` 是显式写入原候选存储的操作，服务端重新核当前身份、原运行组合、材料和预期摘要，保留原提交意图审计；结果仍为 `deployment: pending`。准备不应用 SQL、不切换应用、不更改配置、租户授权或成员分配。

中断后保留原摘要并执行 `receipt`，核 `recorded` 原记录；没有原收据或读取失败保持 `unavailable/unknown`，不能以超时判定未执行或换摘要重发。迁移未批准时不继续执行；迁移中断看原账和真实物理状态，不重放 Seed。候选的 `baseAtPreparation` 只说明准备时基线，运行切换前须重新 `status`，再按[原固定部署、CI 与配对恢复入口](../../scripts/ops/deployment/README.md)办理。工具不自动调用服务器更新器或借用旧服务器授权。

切换后重新观察版本，并通过原登录/设置/授权入口核配置和权限保持。应用回退要求旧应用仍可读取当前数据；数据回填/结构已前进时，按所属迁移与已批准备份恢复方案处理，不能只换旧镜像或改原账。升级退出 `0` 只表示本次查询/候选办理有确定结果，`1` 为拒绝/缺项，`2` 为未知或用法错误，均不代替实际切换验收。

### 旧版归档白名单的维护桥接

`0.2.1`、`0.2.2` 的旧包管理器只认识当时的源码发行脚本清单，因此会拒绝本次新增安装入口的归档。不能通过删掉新脚本、放宽未知文件检查、覆盖旧包或改写已发布版本来升级。新工具随一个严格前进的新版本交付；相同版本的不同 SHA/归档继续由原 `planCoreUpdate` 拒绝。

本次源码版本准备为 `0.3.0`，须完成 PR 评审和原发行核收后才成为正式发行；分支、CI 归档和下列验证本身不代表已经发布或可以部署。

针对**零 Core、未选公共 AI/其他数据能力、Node/合同/能力声明不变、公共数据合同及全部 SQL 原字节相同**的旧宿主，本版提供只读 `bridge` 预检。其他组合、改变迁移、未知或不兼容原库必须交所属维护者核定方案，本入口不尝试通用转换。使用者按原发行规则独立核收两版归档、完整 SHA 和摘要；工具的字节检查不代替可信发行来源。

1. 保留旧运行目录、启动锁、归档、配置和可恢复备份。在新独立目录解包含本工具的正式新版本，沿原锁准备本目录依赖、Client 和构建，使用同一数据库与认证/存储配置。不得覆盖旧目录或借旧 `node_modules`/`dist`；这个阶段不启动新 API。
2. 提供旧宿主的 `PLATFORM_DOCTOR_API_URL`、当前 SaaS 会话和目标库进程配置，在**新目录**运行下列命令。两份 v1 锁沿上方[固定发行与部署锁](#固定发行与部署锁)取各自原发行，不复制修改旧锁充当新版本。新目录全部公共源码须与候选归档逐字节一致。工具通过原 HTTP 复核正在运行的旧组合，同时读取原库迁移/物理结构/账号，再用原升级函数核前进关系。

   ```sh
   node scripts/ops/platform-doctor-install.cjs bridge --profile platform --lock <新锁绝对JSON> --platform-package <新归档绝对tgz> --previous-lock <旧锁绝对JSON> --previous-package <旧归档绝对tgz>
   ```

3. 仅 `maintenance_bridge_checked` 且 `migration: not_required` 可进入已批准维护窗口；结果仍为 `deployment: pending`。部署者核两个配置确指同一原库，停止旧 API 并等待原在途处理结束，在新目录再次 `status --profile platform --lock <新锁>`，随后按原 `npm start`/服务管理入口启动新目录。新旧不得同时处理业务，不执行迁移、重新初始化或业务 Seed。新包归档索引、`CORE_PLATFORM_PACKAGE_REFERENCE` 和 `CORE_DEPLOYMENT_LOCK_FILE` 指向新版本的固定材料。
4. 用原登录入口验证既有口令，回读配置、角色授权和 `platform-doctor-upgrade status` 的实际新版本。旧候选仍按原 SHA `receipt` 回读；桥接不另造候选收据。首次切换失败时先停新进程，确认原账/数据未变化且旧程序仍可读，再用保留的旧目录、旧锁及原配置恢复。任何数据变化、未知在途操作或旧版不再可读，都转数据所有者的恢复流程，不能倒写迁移账或直接覆盖运行文件。

`bridge` 不改包校验器、锁、文件、账号、权限或服务，不自动下载新版本。运行版本变化、当前会话失效、候选文件变更和库状态不明均拒绝继续；重新开始只读核对不等于重新执行任何业务动作。执行权限仍来自本次部署窗口。

## 默认零 Core 的五步

在所选源码根目录执行以下步骤。workspace 命令同时适用于完整源码检出和零 Core 源码发行，实际依赖采用该发行的 npm v3 锁文件。开发环境使用 Node.js 22.12 或更新的受支持 LTS、Prisma 5.22.0 与独立 MySQL，独立 Linux 运行包的固定 Node 版本见下方打包说明。

| 步骤 | 操作 | 应取得的结果 |
| --- | --- | --- |
| 1 | 按锁文件准备依赖，并向当前进程提供下表配置 | 独立数据库、认证密钥和首次初始化口令已确定 |
| 2 | 从本宿主公共 schema 生成 Client | 本树 `apps/platform-api/generated/client`，包含同源声明与 schema |
| 3 | 构建公共 API | 六个后端 workspace 的 dist 可用，公共 OpenAPI 可离线读取 |
| 4 | 新公共库应用本宿主迁移，再初始化公共账号 | 原迁移账与物理结构就绪，`platform / admin` 首次账号已创建 |
| 5 | 启动 API，再按公共 Web 说明登录 | 首次改密后可创建租户，租户成员按当前权限使用公共设置与空 Core 目录 |

`DATABASE_URL`、`AUTH_TOKEN_SECRET`、`SEED_PLATFORM_PASSWORD` 由当前进程提供。PowerShell 使用 `$env:变量名 = '自己的值'`，Bash 使用 `export 变量名='自己的值'`。API 启动和初始化直接读取进程配置，配置文件的读取方式由各工具及宿主明确选择。[启动实现](src/main.ts) · [初始化实现](src/initialize.ts)

| 配置 | 使用位置 |
| --- | --- |
| `DATABASE_URL` | Client 生成、迁移、初始化及运行使用同一独立 MySQL |
| `AUTH_TOKEN_SECRET` | API 启动及公共认证，使用部署方自己的随机密钥 |
| `SEED_PLATFORM_PASSWORD` | 初始化口令至少 8 位且包含字母和数字，已有账号保留原口令 |
| `API_PORT` | API 默认 3000，允许 1～65535 的整数 |
| `DATABASE_CONNECT_ON_START` | 显式设为 `true` 时在数据库模块初始化阶段连接，其他情况下实际请求建立连接 |

`PLATFORM_DATA_SOURCE` 在启动时固定为 `mysql`。邮件、集成及包管理使用各自下文配置。以下命令由使用者在自己的独立环境办理。

```sh
npm ci
npm run prisma:generate -w @rental-os/platform-api
npm run build -w @rental-os/platform-api
npm run prisma:migrate:deploy -w @rental-os/platform-api
npm run initialize -w @rental-os/platform-api
npm run start -w @rental-os/platform-api
```

构建成功后，可用 `node packages/platform-server/dist/platform-openapi.js` 读取同版本公共接口资料。Web 的代理、首次改密和默认空态见[公共后台步骤](../platform-admin/README.md#本地使用)。已有组合库切换沿下方迁移边界核定。

## 选装公共 AI 管理

默认入口没有 AI。需要在零 Core 环境管理平台模型、费率、预算和额度时，使用同一固定组合的公共 AI 服务 SDK `0.2.1`、数据 SDK `0.2.3` 和独立数据包 `0.2.2`。从原公共 schema 与锁定的数据包生成此宿主的 115 模型 Client，再运行 `npm run build:ai -w @rental-os/platform-api`。选装工程不使用默认 Client 或旧混合 SDK。[服务包构建配置](../../packages/ai-native-server/tsconfig.public.json) · [数据包工厂](../../packages/ai-native-data/src/public-data-package.ts)

`start:ai` 使用原 `CORE_DEPLOYMENT_LOCK_FILE`、新安装的 `PLATFORM_AI_DATA_PACKAGE_DIR` 两个绝对路径，以及服务端固定的 `PLATFORM_AI_PROFILE_ID`。锁只能包含公共底座和一个公共 AI 数据包，包目录、版本、摘要及所选 Client 均须匹配。此入口不会安装包、应用迁移、建立默认模型或发起模型调用。实际接口走原 Guard、同一数据库/事务和原账观察；使用者仍须具有 `system:ai-provider:view` 或 `system:ai-provider:manage`，选装入口不会给默认角色授权。[显式启动与装配](src/ai-main.ts)

从已包含选装入口的固定 Zelo 提交准备源码组合，使用 [选装归档工具](../../scripts/prepare-platform-public-ai.cjs)：

```sh
node scripts/prepare-platform-public-ai.cjs --repo . --repository https://github.com/JinPen-G/Nativark --commit <完整SHA> --out <新tgz绝对路径>
```

在解包目录使用 Node 24.13.0，按锁安装、生成 Client 并构建。部署方仅对专用新库运行 `npm run db:migrate:deploy` 和 `npm run db:initialize`，将 `CORE_DEPLOYMENT_LOCK_FILE`、`PLATFORM_AI_DATA_PACKAGE_DIR` 分别指向解包中的 `apps/platform-api/prisma-deployment/core.deployment.lock.json` 和 `public-ai-data` 的绝对路径。旧混合库继续使用原发行及原账，不能重跑公共 AI 初始 SQL。

用部署账号执行 `npm run grant:ai -- --role role_saas_admin --access manage`，显式给新库的初始 SaaS 角色登记并授予读/写；也可以指定实际要授权的 SaaS 角色 ID，`--access view` 只添加查看权限。命令核对实际迁移账、数据结构及角色归属，保留其他角色和原授权，以同一事务写审计。重复执行不会重复授权；默认初始化与启动均不授权。配置 `PLATFORM_AI_PROFILE_ID` 后运行 `npm start`，再用[配套公共 AI 后台](../platform-admin/README.md#选装公共-ai-管理)进入已有设置页。

有 `system:params:manage` 的当前租户管理员可在 `/settings/ai` 管理本租户的模型配置，按原操作键核对保存结果。选装宿主从[公共租户设置模块](../../packages/ai-native-server/src/public-tenant-model-settings.ts)登记接口、Guard 和 OpenAPI，共用所选数据、当前会话和原事务，不要求安装业务 Core 或建立经营空间。

同一选装宿主提供[公共工作中心 API](../../packages/ai-native-server/src/public-ai-work-center.ts)。首次办理文本检测，先在原 SaaS 订阅目录发布 `ai.native.use` 并为租户配置在期权益，再保存租户自己的模型和凭据。用当前具完整租户范围的参数管理员依次提交 `allowTextProbe`、`saveTextPolicy`，两项都带原操作键和当前修订。`textPolicy` 读取计划政策，`textPolicyOperation` 核对原保存结果。工作中心使用原 `ai.capability.text` 挑战；会话 `create`、`admit` 保存定位，Task `create` 只建立元数据，`start` 才进入原 Runner 和唯一 Gateway。Task `snapshot`、`result` 及会话 `modelResult` 读取原结果。具体输入和返回以[本版 OpenAPI 的同源合同](../../packages/platform-contracts/src/ai-work-center.ts)为准；失应答只按原定位核对，不重发。这里的工作中心 API 尚未接公共 Web 页面，平台托管执行仍需可信费率和输入上限。

反向代理部署可设置进程配置 `TRUST_PROXY_HOPS` 为非负安全整数，默认 `0` 不信任转发头。只在 API 无法绕过代理直达、代理链跳数固定且入口代理正确重写转发头时，按实际跳数配置（例如单层受控代理设为 `1`）。公共限流继续使用 Express 据此解析的 `request.ip`，不直接采信任意 `X-Forwarded-For`，演示预约仍为每地址 5 次 / 600 秒，邀请阈值也保持原规则。非法配置在创建应用前拒绝。[启动实现](src/main.ts)

## 实现与功能入口

| 入口 | 职责 |
| --- | --- |
| [启动](src/main.ts) | 消费进程 `DATABASE_URL`、`AUTH_TOKEN_SECRET`、可选 `API_PORT`；不自动加载环境文件 |
| [唯一生命周期](src/lifecycle.ts) | 停止新 Guard / 处理器并等原初始化和在途工作结束，HTTP 关闭后释放唯一数据库池；断线不取消原事务 |
| [装配](src/app.module.ts) | 默认空 Core，只选择公共服务和唯一公共数据库 |
| [Core装配](src/core-assembly.ts) | 同一实际工厂供给标准Core管理、本人目录、范围和Guard；默认零Core，未知业务拒绝 |
| [Core包管理装配](../../packages/platform-core-host/src/core-package-assembly.ts) | 共用公共数据库和当前账号，实际审计与宿主文件配置供给四组 Controller，原部署及包材料按实际来源提供 |
| [当前底座发行读取](../../packages/platform-core-host/src/core-package-deployment.ts) | 固定启动锁，核对当前模块目录和标准包全部字节，沿原 MySQL 观察供给版本及候选材料 |
| [数据计划](src/platform-data.ts) | 固定迁移摘要、唯一数据版本、实际物理结构读取；清单和真实已应用账分别核验 |
| [初始化](src/initialize.ts) | 显式命令创建公共SaaS账号，口令来自进程；重复执行不重置已有账号，失败不补默认账号 |
| [数据库](src/database.ts) | 由本宿主 schema 生成的单一 Client；导入不连接，实际请求按 Prisma 建立连接。请求入口将公共运行库的官方 JSON 空值映射为本 Client 的单例，保留普通空对象与数组 |
| [公共订阅接入与 API](../../packages/platform-server/src/modules/subscription/README.md) | 当前租户查看/申请、SaaS 办理、目录与标准年费、原修订/排期/审计 |
| [公共组织与安全管理](../../packages/platform-server/src/modules/platform/README.md) | 当前主体和组织范围复验、固定平台安全读取、同事务保存与审计；七操作、五路径由同源政策/schema组合 |
| [公共字典与编号](../../packages/platform-server/src/modules/platform-tools/README.md) | 本租户工具权限、最高生效配置、同事务取号和审计；五个原操作共用 DTO 与 OpenAPI |
| [公共文件数据及依赖](../../packages/platform-server/src/modules/files/README.md) | 原文件/上传/清理收据两模型，存储配置变更在同一事务核真实文件依赖；业务文件 HTTP 另须受控权威 |
| [公共通知台账](../../packages/platform-server/src/modules/notifications/README.md) | 原通知模板与发送日志两模型，适配日志复用公共集成表；内容、收件范围及真实投递由所属宿主提供 |
| [公共异步任务](../../packages/platform-server/src/modules/jobs/job-ledger.ts) | 原AsyncJob模型、租户内台账及排期；创建登记与实际执行分开，执行者由所属业务提供 |
| [公共邀请与客服邮件](../../packages/platform-server/src/modules/messaging/README.md) | 同一数据库、账号权威、邮件运行时与四个 Controller；原邀请 / 邮箱游标 / 邮件三表保留原键、凭证哈希与 UID 唯一键 |
| [基础集成](../../packages/platform-server/src/modules/integrations/README.md) | 原配置、修订、连通性与受控宿主依赖 |
| [官方日历来源](../../packages/platform-server/src/modules/official-calendars/README.md) | 公共来源维护、年度版本追加与业务只读接点 |
| [公共 schema](prisma/schema.prisma) | 公共账号、角色、会话、外观与设置表；保留原表名和身份标识，行业关联仅为可空历史引用 |
| [迁移](prisma/migrations/20261115000000_public_foundation/migration.sql) | 新公共数据库的基线；旧 Rental 组合库继续原迁移链 |
| [公共实现导读](../../packages/platform-server/README.md) | HTTP / Guard → 认证与设置服务 → 仓储端口及直接消费者 |

上述公共构建由本宿主的 [package scripts](package.json) 串联原公共依赖。需要类型核对时使用 `npm run lint -w @rental-os/platform-api`，它的 prelint 同样先构建公共依赖。

默认零 Core 的数据库仍沿原 `onModuleInit` 可选连接和 `onModuleDestroy` 断开。所选宿主若需统一等待权限登记及在途请求，可在任何生命周期钩子开始前调用 `PlatformDatabaseClient.manageLifecycle`，绑定唯一实际宿主。数据库自己的 init/destroy 随后只委托该宿主，接管者在 HTTP dispose 后的 shutdown 断开同一池；重复绑定同一对象保持原归属，其他对象或晚到的接管拒绝。[公共数据库接点](src/database.ts) · [单工单实际接管](../example-tickets-api/src/lifecycle.ts)

Client 输出在本宿主 `generated/client`，运行产物从同一宿主目录读取。公共构建消费 `platform-contracts`、`platform-server` 和标准 `core-contracts` / `core-host` / `platform-core-host`。当前 schema 的41个模型均属平台，包含6个 Core 授权/绑定及原收据表、2个统一期限表、5个订阅办理表、2个基础集成表、2个官方日历来源表、2个文件/上传表、2个通知表、1个异步任务表、3个邀请/客服邮件表、1个官网演示申请表和1个公共限流桶表。公共数据版本为 `0.1.9`，十四份迁移摘要由数据计划固定；文件、通知与任务的原字段、唯一键、清理收据及外键保留。官网演示申请、SaaS预约列表和租户筛选预设已由公共模块挂载。匿名预约使用公共持久限流桶，完整Rental组合继续其原表与计数。[预约接入](../../packages/platform-server/src/modules/demo-requests/README.md) · [筛选预设](../../packages/platform-server/src/modules/platform-tools/README.md#筛选预设)。命令是否可执行取决于当前环境许可。

新公共库按 `npm run prisma:migrate:deploy -w @rental-os/platform-api` 应用本链。**不能把本基线套在已有 Rental 组合库**，已有库切换须先按原迁移来源和数据所有权演练兼容迁移。

## 固定发行与部署锁

开发或部署人员从同一次底座源码发行取得归档及其 JSON 回执。公开[导出命令](../../packages/core-contracts/README.md#单独取出底座源码)给出实际 `version`、`source` 与归档 `sha256`，`platform.source.json` 保存固定文件集。组合所需资料按下面的唯一合同核定。

| 材料 | 实际来源与用法 |
| --- | --- |
| 固定底座发行 JSON | [`CorePlatformReleaseSchema`](../../packages/core-contracts/src/update.ts)，`source` 和 `sha256`取同次归档，`versions.platform`取发行版本，`versions.contract`取正式 `CORE_CONTRACT_VERSION`，`versions.node`取目标运行版本，必需的 `versions.capabilities` 列实际能力版本。`data`取同版本[公共数据计划](src/platform-data.ts)的 `createPublicPlatformDataPlan().data` |
| 宿主版本 JSON | 取上述发行的完整 `versions` 子对象，用 [`CoreHostVersionsSchema`](../../packages/core-contracts/src/compatibility.ts)解析，供 Core 检查和安装准备使用 |
| 零 Core 部署锁 | 用 [`CoreDeploymentLockSchema`](../../packages/core-contracts/src/update.ts)解析 `lockVersion: 1`、上述 `platform` 与空 `cores`，选装数据能力集合保持空。所选 Core 的锁由对应宿主准备命令生成 |

本工单样例的清单 `requires` 为空，宿主能力映射可为 `{}`。这里的发行数据声明与运行中的迁移收据分别由各自来源提供，实际可用性继续读取原账及物理结构。固定包、更新预检和失败恢复见[公开详细参考](../../packages/core-contracts/README.md#分别更新底座或一个-core)。

## 独立后端运行包

[离线打包入口](../../scripts/package-platform-host.cjs)消费固定的完整底座源码归档、零 Core 部署锁、本树已构建的六个公共后端包和同一公共 Client 声明。它按原配置在内存重新编译六包、核对实际运行字节，并从原 npm 锁投影所需依赖；复用原迁移生成器输出所选发行的公共 schema、原 SQL 和完整部署锁。当前源码的数据计划为41模型、14份迁移，旧发行仍按其固定数据计划办理。

```powershell
node scripts/package-platform-host.cjs --lock C:\release\core.deployment.lock.json --platform-package C:\release\platform-source.tgz --platform-client C:\checkout\apps\platform-api\generated\client\index.d.ts --output C:\release\platform-host.tgz --deps C:\checkout\node_modules
```

输入和输出须为绝对路径，Client 必须属于执行脚本的本树；输出只写尚不存在的 `.tgz`。包内只含公共 API 所需运行材料，唯一启动入口为 `apps/platform-api/dist/main.js`，公共 Web 单独交付。`platform-host.context.json`绑定完整发行、源码/依赖锁、编译输入、唯一 Client 和实际产物；它是受控部署证据，不是外部签名。

当前 Dockerfile 固定 `node:24.13.0-bookworm-slim`，打包器要求发行 `versions.node=24.13.0`，合同版本与本次正式出口一致。目标 Linux 环境解包后可执行 `docker build --target runtime -t platform-host .`。Dockerfile 按原锁安装依赖，并用 Prisma 5.22.0 在目标平台生成唯一公共 Client，`verify-runtime.cjs`只检查包内摘要与模块解析，不启动应用。当前打包不执行安装、下载、镜像构建、数据库迁移或服务启动，结果保持 `imageBuild=not-run`、`configuration=pending`、`deployment=pending`。

部署方提供原数据库、认证与必要集成配置，沿原公共迁移账及物理结构核验办理准备。包内 `apps/platform-api/prisma/core.deployment.lock.json`是候选锁，不能代替迁移收据；版本读取还需下文的固定源码归档登记与存储配置。

构建后，在配置 `SEED_PLATFORM_PASSWORD` 的独立公共库执行 `npm run initialize -w @rental-os/platform-api`，创建 `platform` / `admin` 的SaaS账号。初始口令至少8位且包含字母和数字，首次登录必须改密。已有公共库升级后，同一命令核验原管理员并补录当前公共权限目录，角色编辑可选择原订阅权限码。原角色授权与账号口令由既有管理入口维护。主体核验失败时，目录补录随同一事务回滚。命令会访问数据库，口令不进入控制台和审计。

SaaS管理员通过 `POST /api/platform/tenants` 创建公共租户与首个管理员，创建响应返回一次临时口令。租户管理员改密后使用 `/api/platform/tenant`、`users`、`roles`、`permission-tree`；本人资料使用 `/api/platform/self-profile`，外观仍用原正式路径。详细字段、权限、副作用和错误从同版本 OpenAPI读取。

组织列表及维护使用 `/api/platform/organizations`，按当前租户及原组织范围开放。全平台安全配置使用 `/api/platform/security-baseline`，读取和 SaaS 保存分别授权；登录前读取复用同一个固定平台来源。公共后台对应组织页和安全页已直接消费这些接口，Core作者无需自行复制设置页。[公共后台](../platform-admin/README.md) · [管理方法与权限](../../packages/platform-server/src/modules/platform/README.md)

字典使用 `/api/platform/dictionaries`，编号规则及取号使用 `/api/platform/number-rules`，各自要求原工具权限；SaaS 账号不能代租户调用。公共初始化补录两项权限目录，原角色授权不因此扩大。公共缺省为空，租赁默认资料仍由原组合提供；新建和维护从公共后台完成。[五个操作、存储和原格式](../../packages/platform-server/src/modules/platform-tools/README.md)

文件配置停用和存储位置变更必须核原文件、上传及清理收据，默认零 Core 组合也通过同一事务执行该核验。保留文件或unknown依赖时先迁移/处理；查询失败不放行。当前已有公共文件数据和同源内核，业务文件HTTP仍需宿主提供真实对象/成员/范围及附件权威，不因数据表存在开放零 Core 任意上传。[实际接线](src/core-assembly.ts) · [文件迁移](prisma/migrations/20261118010000_public_files/migration.sql)

标准Core管理位于 `/api/platform/core-host`，当前组合已登记管理、本人Core目录和范围HTTP，默认本人目录为空。真正选中Core时提供固定服务、业务HTTP、真实订阅和数据观察；SaaS授权、成员分配与绑定分别成立。[标准宿主用法](../../packages/platform-core-host/README.md)

Core 包管理位于 `/api/platform/core-packages`，包含目录、发现、仓库、包检查、安装 / 更新预检、固定发行预览 / 保存 / 回读，以及候选预览 / 准备 / 回读十二个接口。四组 Controller 使用同一公共主体和数据库，原 Guard 的唯一 Core HTTP provider 合并标准管理与包管理政策。访问要求当前 SaaS 管理身份及 `system:tenant:manage` 或 `*`，保存与准备在原事务写入提交意图审计。[接口及状态](../../packages/platform-core-host/src/core-packages/README.md)

发行引用与候选存储读取进程配置 `CORE_PACKAGE_STORAGE_ROOT`。部署方指定绝对根，并预先建立 `releases`、`candidates` 普通子目录及服务账户访问权。留空时相应存储返回 `unavailable`，目录与父路径由原文件存储核查。准备结果保持 `pending`，发布后结果不明沿原引用或 SHA 读取原记录。[实际配置供给](src/core-assembly.ts) · [存储边界](../../packages/platform-core-host/src/core-package-preparation/README.md)

本地已下载包放入同一根下的 `archives` 普通目录，部署人员按 `CorePackageArchiveIndexSchema` 在 `archives/index.json` 登记固定引用、相对 `.tgz` 文件及完整发行投影。后台的“使用已下载包”发送该引用，服务端沿原包校验读取全部字节。索引首次成功读取后固定到本进程，登记更新通过重启装配采用，读取失败可重试。[登记格式及边界](../../packages/platform-core-host/src/core-package-preflight/README.md)

零 Core 标准底座部署可配置下列进程字段，供给当前版本观察与候选材料。运行目录和六个入口由本宿主的静态模块解析固定。独立运行包通过 `platform-host.context.json`核源码发行、编译输入与实际产物；原完整源码目录继续按标准包全部文件核同。已有运行收据损坏时直接不可用。[当前发行读取](../../packages/platform-core-host/src/core-package-deployment.ts)

| 配置 | 来源与用途 |
| --- | --- |
| `CORE_DEPLOYMENT_LOCK_FILE` | 本次运行组合的绝对 JSON 锁文件路径，启动时固定完整底座发行，Core 及所选数据能力集合为空 |
| `CORE_PLATFORM_PACKAGE_REFERENCE` | `archives/index.json` 中当前底座标准包的固定引用，完整发行须与启动锁一致 |

读取时复核启动锁、当前 Node / 已加载合同版本、完整标准包、六个公共模块及 schema / 迁移的实际字节，再由原 MySQL 读取器核迁移收据与物理结构。缺配置、缺标准包、运行证据或源码差异、原数据未就绪时保留 `unavailable`。启动锁更新通过重启装配采用，失败的启动锁读取同样须修复后重启。候选材料只读取已核同的原迁移字节，准备仍为 `pending`。[原数据观察](src/platform-data.ts)

所选 Core 宿主从实际使用包与原账提供自己的 `deployment`、`materials`，也可显式提供 `localArtifacts`。旧路由许可由该宿主可信策略提供精确方法 / 路径，默认空集合沿原 Core 命名空间检查。[公共装配端口](../../packages/platform-core-host/README.md#core-包管理接入)

组合客户端源码使用 `composeCorePrismaSchema(publicSchema, contributions)`，底座生成器与标量定义保持单源。Core迁移对公共表的明确外键通过 `mysqlForeignKeyExtension` 解析，并由 `createPublicPlatformDataPlan(extensions)` 纳入物理观察。默认空数组沿原零Core数据计划；所选关系、包摘要及原迁移账一起核定，不能只增加Prisma关系就判数据库就绪。[数据组合接入](../../packages/core-contracts/README.md#组合-prisma-源码)

Rental 提供自己的 schema、公共关系与实际数据计划，宿主按同一接点选择它；默认公共宿主继续只用公共数据。新组合 Client 和存量混合库的迁移分别准备。[Rental数据三步接入](https://github.com/JinPen-G/Zelo-rental-core/blob/78edf34dea4ca7ee7d20abe318f6f9696413beb2/prisma/README.md)

运行使用 `npm run start -w @rental-os/platform-api`；调用此命令会监听 API 端口并按请求访问配置的数据库。OpenAPI 从 `/api/openapi.json` 读取公共、Core 管理及包管理的组合，前述公共离线导出继续使用其公共文档入口。零 Core 的独立安装、HTTP、公共保存和重启已取得下方实际证据；其他组合与完整公共功能分别验证。公开开发入口为[公共服务](../../packages/platform-server/README.md)、[公共后台](../platform-admin/README.md)和[Core接入手册](../../packages/core-contracts/README.md#五步快速接入)。

公共邀请、寄件和客服邮件由 `PlatformServerModule` 自动装配，使用本宿主唯一公共数据库、邮件集成和审计。邀请与客服数据分别沿[邀请迁移](prisma/migrations/20261119000000_public_operator_invitations/migration.sql)和[邮件迁移](prisma/migrations/20261119010000_public_support_email/migration.sql)保持原 SQL。三张表仅引用公共 Tenant，没有 Rental 业务外键。

使用 `/api/platform/users/invitations` 邀请租户基础成员，显式传入 `workspaceAccesses: []`、普通租户角色和有效组织。接受邀请时，账号、角色、审计及一次性凭证在原事务内提交；Core 使用权另由标准 Core 管理分配。原 Rental 邀请继续其经营空间和角色校验。寄件与客服邮件使用 `/api/platform/dispatch` 和 `/api/platform/support/emails`；公开邀请只经 POST `inspect` / `accept` 传原凭证，先执行原限流。字段、方法、权限、读取 / 写入性质由同版本 OpenAPI 提供。[13 个操作与三步接入](../../packages/platform-server/src/modules/messaging/README.md#http请求与接口资料)

实际发信需要已核定的租户邮件集成和部署方 `ADMIN_PUBLIC_URL`，客服同步显式读取实际 IMAP。没有真实配置时沿原错误处理；链接页面、真实邮件 / 数据库及完整独立宿主验收分别验证。

## 验证入口

已在独立 Windows 源码根使用 Node 24.13.0、原 npm 锁、Prisma 5.22.0 和专用 MySQL 8.4 验证零 Core 组合。依赖独立安装后生成本根公共 Client，公共 API 与 Web 实际构建通过；13 份公共迁移形成40张公共表，未安装业务 Core。真实 HTTP 验证初始化、改密、两个租户登录、本人/租户/品牌/主题保存、旧修订409、跨租户403、匿名401及受限成员403。API 与数据库重启后五组保存快照保持一致，重复初始化不重置原密码。对应前端登录、公共外壳与设置回读见[公共后台证据](../platform-admin/README.md#验证入口)。邮件、供应商交易、其他 Core 及 Linux 镜像分别验证，此结果不代表发布或生产启用。

独立运行包保留源码 schema 的原字节摘要。官方生成的 Client schema 可以整理空白，打包和运行预检使用同一 token 比较；标识符、类型、属性和字符串默认值变化仍拒绝，迁移 SQL 的摘要规则保持原样。[共同核验](../../scripts/build-selected-prisma.cjs)

所选源码类型使用[内存类型命令](../../scripts/check-selected-prisma-types.cjs)的 `--mode platform` 与本宿主 `--config apps/platform-api/tsconfig.json`。公共合同使用 `npm test -w @rental-os/core-contracts`。原零 Core 与单工单运行包断言的 runner 同时编译旧双 Core 宿主，在[完整历史检出 `46db0945…`](https://github.com/JinPen-G/Zelo/tree/46db0945dee92ac916f7265e95948943fc8b641d)运行 `node tests/rental-host-package.test.cjs`。类型、内存根装配、真实监听 / 数据库及冷安装分别记录。
