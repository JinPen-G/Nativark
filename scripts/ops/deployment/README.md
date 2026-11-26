# 固定源码更新脚本

[hourly-update.py](hourly-update.py) 为现有 `nativark-demo` API、Web 更新流程固定 Git 提交，核对 CI、数据库文件差异、现有镜像与回退收据，并按 [Dockerfile](Dockerfile) 构建指定版本。

源码归档由 `git_source_archive` 的精确白名单生成。构建需要的两份脚本为 [build-selected-prisma.cjs](../../build-selected-prisma.cjs) 和 [miniprogram-shared-types.cjs](../../miniprogram-shared-types.cjs)，它们与 `scripts/ops/deployment` 一并进入归档。

`git_snapshot` 先以 `--depth=1 --no-tags --filter=blob:none` 取得运行版本和候选版本的两个固定提交及树。迁移比较仍沿原路径和 blob 身份进行。CI 与迁移检查通过后，`fetch_source_blobs` 从候选树列出 `SOURCE_PATHS` 中的 blob，通过 stdin 一批取得这些固定对象，再沿原 Git archive 生成构建上下文。元数据拉取限时 180 秒，构建文件批量拉取限时 300 秒，失败继续中止本次发布。

批量取得对象后会移除该次专用临时 Git 库的 promisor 配置。服务器 Git 2.34 的 archive 会对部分克隆隐式预取整棵树，因此归档阶段关闭这种下载，缺少所需对象时直接报错。

源码解包沿用 Python `data_filter` 的路径、链接和特殊文件限制，并将源码目录设为 0755。部署进程使用 umask 077 保护私有文件，`data_filter` 默认清空目录 mode，直接使用会让嵌套迁移目录以 0700 进入镜像，导致默认 `node` 用户无法遍历。该权限处理仅适用于固定源码归档。

运行镜像同时明确设置 API 与 Rental Core 的迁移源码目录为 0755，以兼容已有构建缓存。CI 使用默认非 root 用户读取各份迁移 SQL，并加载环境模块、Prisma Client 和 AppModule。

应用范围包括 API、admin 的完整目录，以及 Dockerfile 所需的其他应用 package.json。packages、assets、config、原部署脚本与 Git 归档所需的 `.gitattributes` 沿白名单进入归档。该清单同时供内容拉取和归档使用，自测检查全部 Docker COPY 来源，并拒绝无关应用源码进入上下文。初次浅拉取没有分支通配或完整历史下载，过滤后的检查阶段也无需下载两份快照的文件内容。

在 Git 检出中运行离线自测，需要 Python 3.12 或更新版本及 Git。

```sh
python -B scripts/ops/deployment/hourly-update.py --self-test
```

自测保留 CI 门禁断言，并在开始归档前解析一次完整 `HEAD`。它使用当前脚本白名单读取该固定 Git 对象的真实 tar 流，在内存中核对归档内 Dockerfile 的全部本地 `COPY` 字面路径，涵盖多源、续行、JSON 形式和选项。`COPY --from=...` 的来源归前序构建层或镜像，交由 Docker 构建验证。

两份构建脚本逐一缺失的反例必须被拒绝，脚本目录的归档范围同时受到断言约束。输出包含固定提交、归档文件数、本地 `COPY` 来源数与缺文件反例数。归档内容始终来自固定提交，运行中的脚本白名单用于验证待提交修复。

`--self-test` 的副作用限于读取本地 Git 对象与输出结果，归档和检查材料均在内存消费。镜像构建、服务器安装、服务切换、数据库及运行验收属于另行授权的执行范围。`--check` 会读取现有服务器与远端状态，`--apply` 会执行更新及必要回退。

## Zelo 仓库更名兼容

主仓库为 `JinPen-G/Zelo`，服务器部署根为 `/home/ritiadm/zelo`。服务器安装的更新器须同步 `REPOSITORY` 与 `ROOT`；仅更新 GitHub 链接或仓库源码不会自动替换已安装脚本。工作流显示名为“Zelo 发布”，文件路径 `nativark-release.yml` 保留，CI 仍严格核对固定提交、main push 和仓库身份。

已有 `nativark-demo` Compose 项目、镜像标签、数据库、回退收据及 `# Nativark hourly update managed images` 识别标记保持兼容。目录移动只按实际服务器维护授权执行；仓库更名不授权数据库迁移或改写历史发布包来源。

## 独立 Rental 发布材料离线校验

### 开发组合 CI

[`Rental 双仓开发构建`](../../../.github/workflows/rental-development-ci.yml) 使用工作流中固定的 Zelo 与 Rental 完整 SHA。它从固定 Zelo 锁安装编译依赖，按 `full` 装配和回读来源归档，通过原构建器在内存生成 Prisma 声明和 API 产物，并核后台及四端的 TypeScript 配置。

开发报告 `rental-development-build-1` 记录双源码、归档、投影锁、编译项目和 API 产物摘要。CI 唯一上传物是 JSON 报告，状态标明 `deployment: not-prepared`、`releaseApproved: false` 和 `serverUpdateEligible: false`。本地可在已有编译依赖的固定 Zelo 检出下复用同一入口，末项选 `host` 或 `full`。

```sh
node scripts/ops/release-rental-development.cjs <Zelo目录> <Zelo完整SHA> <Rental目录> <Rental完整SHA> full
```

正式候选仍须按真实版本 Tag 取得锁定底座与 Core 归档、完成 `prepared` 材料、通过下面的 `candidate` 校验，再由同一次正式 CI 核对 API 与 Web 镜像 ID。旧组合过渡继续等待原账桥接。

### 正式候选材料

[release-verify.cjs](../release-verify.cjs) 从已经核收并解包的正式宿主归档读取双仓来源、宿主收据、部署收据及实际文件。两个收据摘要取自可信归档核收结果。请分别提供上一份已核宿主和固定候选。

```sh
node scripts/ops/release-verify.cjs candidate <候选归档目录> <宿主收据SHA256>
node scripts/ops/release-verify.cjs prepared <基线归档目录> <基线宿主收据SHA256> <候选归档目录> <候选宿主收据SHA256>
node scripts/ops/release-verify.cjs mcp <本地ZeloGit目录> <基线完整SHA> <候选完整SHA>
```

`candidate` 是双仓 CI 的离线候选核验入口。它要求宿主收据的 `buildProvenance` 引用正式打包器生成的 `rental-host.build-provenance.json`，格式为 `rental-host-fixed-build-1`。校验绑定同一双仓来源、投影 npm 锁和部署锁，核对固定编译项目、编译器、Client 声明与 schema 证据，并逐项核对实际入包的运行产物。Rental Core 和选装 AI 数据包继续按部署锁核验。候选身份含核过的构建证明摘要。旧材料通过 `prepared` 比较迁移。正式 MCP 宿主编译证明仍待上游打包合同。

`prepared` 核对 `development.workspace.json` 的 `release` 模式和实际 `host` 或 `full` 选择，复算 API 宿主文件、运行 npm 锁、部署锁、schema、`migration_lock.toml` 和原 SQL 摘要。发布身份包含两仓完整 SHA、装配选择、原 npm 锁、组合投影锁、运行锁、部署锁及宿主收据摘要。比较按所有者和正式迁移身份报告增删、原文或原账变更，并检查次序、schema、数据合同和能力选择。编译产物及所选 Client 的回执随宿主材料核对，镜像内实际生成的 Client 与 Web 产物在后续构建核收。

选择 AI 时，旧发行 `0.1.1` 对应 `./data-package` 和原 `prisma/` 迁移，公共数据发行 `0.2.0` 对应 `./public-data-package` 和 `prisma-public/` 新装材料。两种发行分别核锁、包文件、导出和 SQL。运行 SDK `0.2.1` 缺正式数据发行身份时会被拒绝。旧混合与新公共数据之间的正反向比较均标记 `requiresAiDataBridge`，继续等待原账桥接。

选择 MCP 的 prepared 材料需同时提供正式宿主入口、部署锁中的 `mcp` `0.1.0` 能力、固定包文件及五项按正式 ID 排列的 SQL 和原账标识。原账名按 `platform-capability.mcp.*` 核对，既有库的历史映射仍由原宿主取得执行证据。`mcp` 模式使用支持 `--no-lazy-fetch` 的 Git 从本地固定对象读取公开贡献清单和原 SQL，仅核顺序、前置和摘要。现有宿主打包入口还需接入 MCP 能力和原账观察。

退出 `0` 表示材料核对通过，比较模式还表示材料无数据差异。`2` 表示有数据差异，`1` 表示输入验证失败或缺少必要材料。所有模式的 JSON 都标明 `releaseApproved: false` 和 `databaseChecked: false`。`domain`、旧单 SHA 证明和缺正式 AI 数据包的候选均被拒绝。旧组合基线可用 `prepared legacy-combined` 明确识别，校验会在读取现场材料前要求正式旧库桥接。原单仓更新器、原迁移门禁和回退继续沿上文入口。

### 双仓构建证据

[verifyPairedBuildEvidence](../release-build-evidence.cjs) 消费本进程已核过固定构建证明的 `verifyPreparedRental` 结果。调用方须先核收候选归档、固定 CI 策略、同一次运行的构建记录及实际镜像观察。它比较含构建证明摘要的候选身份与构建记录，校验 GitHub 运行的仓库、工作流、主分支、固定 SHA、编号、尝试次数及成功状态。策略中显式选择 `automatic` 对应 `push`，`manual` 对应 `workflow_dispatch`。两种来源都须提供同一记录中的 API 和 Web 镜像 ID，逐项与实际镜像观察匹配。

双仓工作流接入时，先核收正式宿主归档并执行 `candidate` 校验，再将候选身份绑定到同一次 API/Web 构建记录。消费记录时从可信 CI 来源核实其运行归属，并用已核归档在当前进程重做候选校验。辅助函数返回 `releaseApproved: false`，用于比对证据。实际工作流接线待独立 API、发行 Tag 和镜像产物固定后进行。
