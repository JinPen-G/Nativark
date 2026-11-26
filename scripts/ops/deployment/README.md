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

### 生成下一对正式资产

先由两仓负责人提交配套新版本并冻结完整 SHA。以 `0.1.18`／`0.1.15` 为下一组拟定版本，底座的根 manifest 与原 npm 锁版本须一致，Rental 的包版本、`RENTAL_CORE_VERSION` 和各宿主依赖须一致。保持已经使用的发行来源 `JinPen-G/Nativark` 与 `JinPen-G/nativark-rental-core`。独立仓根 `core.manifest.json` 保留最后一次已核发现结果，等本次完成后再单独回填。底座固定提交须已包含本节的正式工作流，派发时该提交是 `main` 的目标。两仓批准的 commit 和实际 Tag 值是下列命令的输入。

在固定 Linux Node 24.13.0 构建环境，已安装 Zelo 原锁依赖，并采用本仓离线守卫的任务目录设置。`ASSET_DIR` 是现存空目录。先在各自仓库发布不存在的新版本 Tag，普通推送。用 `git ls-remote --tags` 回读两 Tag 的提交，检查与 `ZELO_SHA` 和 `RENTAL_SHA` 完全一致。以下是两个已批准新 Tag 都尚未创建时的命令。已有 Tag 或同名 Release 时先核其原对象与资产。

```sh
git -C "$ZELO_REPO" tag -a "$ZELO_TAG" "$ZELO_SHA" -m "Zelo 底座 $ZELO_TAG"
git -C "$RENTAL_REPO" tag -a "$RENTAL_TAG" "$RENTAL_SHA" -m "Rental Core $RENTAL_TAG"
git -C "$ZELO_REPO" push origin "refs/tags/$ZELO_TAG"
git -C "$RENTAL_REPO" push origin "refs/tags/$RENTAL_TAG"
```

```sh
node --require "$ZELO_REPO/tests/fixtures/ai-native/prisma-offline-preload.cjs" \
  scripts/ops/release-rental-assets.cjs "$ZELO_REPO" "$ZELO_SHA" "$RENTAL_REPO" "$RENTAL_SHA" "$ASSET_DIR"
```

入口从固定源码调用原底座及 Core 归档器，回读两个实际资产和包内清单，打印 `rental-release-assets-1` 回执。回执的 `platform.asset.sha256`、`rental.asset.sha256` 用于正式 CI。下列命令适用于已安装并已授权 `gh` 的终端。`ZELO_TAG` 和 `RENTAL_TAG` 分别是已经核对的真实新 Tag。

```sh
gh release create "$ZELO_TAG" "$ASSET_DIR/platform-source-${ZELO_TAG#v}.tgz" \
  --repo JinPen-G/Zelo --verify-tag --title "Zelo 底座 $ZELO_TAG" --notes '固定源码归档，供双仓候选构建与核验。'
gh release create "$RENTAL_TAG" "$ASSET_DIR/rental-${RENTAL_TAG#v}.tgz" \
  --repo JinPen-G/Zelo-rental-core --verify-tag --title "Rental Core $RENTAL_TAG" --notes '固定业务包，供双仓候选构建与核验。'
```

发布后重新下载原资产，核文件名、长度、原字节 SHA-256 与回执一致。再从目标 Zelo `main` 运行正式候选 CI，保存同运行的镜像回执及镜像留存摘要。取得两仓 Release 回读和正式配对 CI 的成功回执后，将 `core.manifest.next.json` 的完整原字节作为独立仓根 `core.manifest.json` 单独提交。先核待写清单的来源提交、版本和包摘要所属 Release，再用原发现及 `inspect` 入口回读新版本。发现更新提交与业务发行 Tag 对应的源码提交分别记录。

```sh
gh workflow run rental-release-candidate.yml --repo JinPen-G/Zelo --ref main \
  -f platform_commit="$ZELO_SHA" -f rental_commit="$RENTAL_SHA" \
  -f platform_tag="$ZELO_TAG" -f rental_tag="$RENTAL_TAG" \
  -f platform_asset_sha256="$PLATFORM_DIGEST" -f rental_asset_sha256="$RENTAL_DIGEST" \
  -f retain_images=true
```

[Rental 正式候选构建](../../../.github/workflows/rental-release-candidate.yml) 从可信 Zelo `main` 手动派发。填写已发布的两仓完整 SHA、各自版本 Tag 和独立核收的两个发行归档 SHA-256。Zelo SHA 须等于该次运行的 `GITHUB_SHA`。调用方先验证 Tag 解引用，再取得该 Tag 下的 `platform-source-<版号>.tgz` 与 `rental-<版号>.tgz`，逐一核对原字节。在受管 Linux runner 使用锁定依赖，按[材料生成入口](../release-prepare-pair.cjs)构建普通单 Rental 组合。

```sh
node scripts/ops/release-prepare-pair.cjs release "$ZELO_REPO" "$ZELO_COMMIT" "$RENTAL_REPO" "$RENTAL_COMMIT" "$TASK_DIR" "$PLATFORM_DIGEST" "$RENTAL_DIGEST"
```

`TASK_DIR` 是本次专用目录，输入归档分别存为 `platform.tgz`、`rental.tgz`。调用从固定源码投影重新对照底座发行，使用原准备器生成部署锁、schema 和原迁移 SQL，再用正式宿主打包器构建 API。Web 使用同一源投影 npm 锁，直接消费 API 上下文中的 Core 包和同一份部署锁。归档生产与镜像运行使用同平台的锁定 Node 工具链，Linux 镜像使用 Linux 归档。`development` 模式省略两个发行摘要，使用原开发运行包生成离线演练材料并标记不可部署。

产物 job 将 `rental-image-input-<run_id>-<run_attempt>` 交给双仓镜像工作流，并独立传递 `input.json` 的原文 SHA-256。镜像工作流按调用方 `github.workflow_ref` 核对固定入口。[双仓镜像工作流](../../../.github/workflows/rental-image-ci.yml) · [GitHub 可复用工作流上下文](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#github-context)

交接包含以下文件。

| 路径 | 来源及要求 |
| --- | --- |
| `api/` | 正式 `package-rental-host` 归档解包结果，含 `.dockerignore`、实际宿主文件和三份来源／部署／构建收据 |
| `web/` | 同一双仓、同一选择和锁的正式 Web 构建输出，含非空 `index.html`。Web 文件表用 [digestFiles](../release-facts.cjs) 的相对路径和原字节摘要算法汇总 |
| `input.json` | `format: rental-image-input-1`、`sourceMode: release`、双 SHA、构建器 SHA、两锁摘要，以及 API 宿主收据的 `contextSha256`、强核验给出的 `identitySha256`、Web 的 `webFilesSha256` |

产物上传须包含核过的隐藏文件，实际运行环境文件、TLS 凭据和私有媒体继续走原现场管理。调用输入为 `platform_commit`、`rental_commit` 和 `input_sha256`。两个 `v<version>` Tag 均须分别解引用到候选完整 SHA。脚本从实际 API 文件重做强门禁，并核对同次可信 Web 产物及交接摘要。材料缺件、开发报告和 Tag 不匹配均在 Docker 构建前拒绝。

同一托管 runner 由正式宿主 Dockerfile 与 [Web 固定配方](Dockerfile.rental-web) 建两个本地镜像，逐项核双仓、组合身份、部署锁、投影锁、宿主构建证明及运行编号标签，按各自镜像 ID 做无网络预检。默认产物是 `image-pair.json`，其中 `releaseApproved` 与 `serverUpdateEligible` 均为 `false`。

### 镜像留存与回退核对

当全部镜像材料可公开时，派发参数 `retain_images` 可保留同次 `rental-images.tar.gz` 和 `SHA256SUMS`，Actions 留存七天。归档前逐一对照 API/Web 镜像 ID，双镜像放入同一个归档。同次记录、归档和摘要作为一组核收。长期留存使用受限存储并记录原 Actions 产物和 SHA-256。TLS、环境配置、业务数据与私有媒体继续单独管理。

在独占 Docker 环境下载原配对产物，先对照可信 CI 的 `image-pair.json` 摘要，再执行 `sha256sum -c SHA256SUMS`。加载同组镜像后，对照记录中的 API/Web ID、角色、部署锁和相同的 CI 运行标签。候选和回退各保全一组完整记录及镜像。更换前以已核原账判断旧程序是否仍能读取当前数据。隔离切换演练应对两个角色同时比对 ID 和健康结果，失败时以原两镜像恢复并重查。数据库恢复仍使用单独批准的原账与备份。

### 更新前只读复核

独立核收的 `policy.json` 记批准核验的 CI 来源及其外部锚点，包括 `origin`、`repositoryId`、`workflowId`、`workflowPath`、`headSource`、`runId`、`runAttempt`、`buildRecordSha256`。`workflowPath` 取 GitHub 实际调用工作流路径。证据目录另含真实 GitHub `run.json`、该次产物 `image-pair.json` 和独立镜像观察 `images.json`，其中 `images.json` 使用 `api`、`web` 两个实际 `sha256:` 镜像 ID。

```sh
node scripts/ops/release-verify.cjs paired-review <候选目录> <候选收据SHA256> <基线目录或legacy-combined> <基线收据SHA256或-> <证据目录>
```

证据不匹配时退出 `1`。已核镜像组合如果涉及旧库或新旧 AI 数据切换，返回 `awaiting-migration-bridge`。已有 prepared 基线的迁移材料有差异时返回 `awaiting-migration-approval`，一致时等待 `awaiting-release-approval`。三种待处理状态均退出 `2`，保留正式审批入口。首切后续须另核原账、数据库前置、实际 TLS／私有媒体和应用健康。现行定时更新器继续使用原单仓工作流与回退路径。
