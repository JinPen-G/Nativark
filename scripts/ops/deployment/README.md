# Rental 组合留存与发布复核

存量 `nativark-demo` 使用已部署的 API 和 Web 镜像。[小时更新器](hourly-update.py) 沿原 cron 和排他锁检查现有健康地址，并发现官方 Zelo `main` 成功的正式配对运行。`--check` 核收候选并报告门禁状态，`--apply` 在本机授权有效、原数据材料完全相同且现场基线核同后成对切换。已有 `rollback.json` 优先进入原恢复入口，健康通过后才清除日志。数据库恢复由获批维护流程执行。

[历史复建 CI](../../../.github/workflows/nativark-release.yml) 按固定历史 Git 提交使用该版本自己的 Dockerfile、锁及迁移材料。新发布使用下文同一次正式双仓 CI 的配对证据。服务器上已经安装的旧脚本仍须在维护窗口按来源及 SHA-256 核准同步，公共主线提交不会自动替换它。

当前主线的 `start-dev.ps1 -Legacy`、Legacy 本地预检、旧 API 环境包装器，以及 `preflight`、`migration-status`、`backup`、`restore-drill`、`release-build`、`release-gate`、`upgrade-drill`、`restore-source` 八个旧 OPS CLI 均在加载旧配置或启动子进程前退出 1。Windows 的 `setup-local-mysql.ps1`、`backup-mysql.ps1`、`restore-mysql.ps1` 同样只返回迁址提示。需要原命令时，显式执行 `git worktree add --detach <独占目录> 46db0945dee92ac916f7265e95948943fc8b641d`，在该目录核对完整 HEAD、锁定依赖、Client 和隔离配置后再使用历史入口。默认公共启动仍按 8 个 workspace 预检；下述配对 `release-verify`、组合检查及库函数导入继续保留。

旧 `apply-column-comments.cjs`（含 dry-run/repair 参数）和 `seed-demo-tenant.cjs` 也在环境、Prisma 及业务 HTTP/DB 访问前返回同一提示、退出 1；根 `db:comments*` 和 `db:seed:demo` 可以继续指向这些脚本。两者原本均为自执行 CLI，没有库出口；误用 `require`/`import` 时抛出同一迁址错误，不执行原正文或终止调用方进程。

主仓库为 `JinPen-G/Zelo`，部署根为 `/home/ritiadm/zelo`。安装时保留 `nativark-demo` 项目、原镜像标签和 `# Nativark hourly update managed images` override 识别标记。已有 Compose 文件、证书、上传数据和私有媒体继续由现场维护。

## 小时双仓候选与本机授权

发现来源固定为仓库 ID `1332293015`、工作流 ID `431931928`、`.github/workflows/rental-release-candidate.yml`，要求同仓 `main` 的 `workflow_dispatch` 运行成功。每次读取最新成功候选的当前尝试次数，按同次产物名及 GitHub ZIP 摘要下载 `rental-image-input` 与 `rental-image-pair`。原 API 宿主、Web 文件、两锁、构建证明、双 SHA、稳定 Release、Tag 解引用及两份公开原资产均须核同。缺失或过期产物会阻断当次更新。

服务器先在 `.hourly-update/verifier/scripts/ops/` 安装固定 `f3bfce5800ea971af6148e843f1e63437d5fa94a` 的 `release-verify.cjs`、`release-composition.cjs`、`release-build-evidence.cjs` 三份 Git 原字节。脚本按内置 SHA-256 核对这组工具，使用既有 `/opt/preview/node-v24.13.0-linux-x64/bin/node`，沿原 `paired-review` 读取材料。核验器升级与更新器安装一同审阅。GitHub Actions 下载需要可用的只读访问能力，可在受信调度环境提供 `GH_TOKEN` 或 `GITHUB_TOKEN`，凭据保持私有。下载转向存储域名时移除认证头。

首次双仓部署核收后，运维在 `.hourly-update/prepared/<运行号>-<尝试号>/` 保留该次 `input` 目录的原内容与同次 `image-pair.json`。`api/` 是迁移比较基线。再登记 `.hourly-update/paired-active.json`，字段如下，摘要、镜像和批准记录均取实际核收结果。

```json
{
  "format": "zelo-paired-active-1",
  "directory": "/home/ritiadm/zelo/.hourly-update/prepared/<运行号>-<尝试号>/api",
  "contextSha256": "<原宿主收据摘要>",
  "identitySha256": "<原候选身份摘要>",
  "imagePairSha256": "<同次image-pair.json原字节摘要>",
  "imageIds": {"api": "sha256:<实际API镜像ID>", "web": "sha256:<实际Web镜像ID>"},
  "versions": {"platform": "<实际稳定版本>", "rental": "<实际稳定版本>"},
  "runId": 0,
  "runAttempt": 0,
  "runtimeConfigurationSha256": "<当前Compose展开配置去掉两个image字段后的摘要>",
  "dataApprovalReference": "<实际迁移账核收与适用旧库桥接批准记录>"
}
```

上例为字段说明。运行号、版本和摘要须填写真实值。配置摘要由已核更新器的 `runtime_configuration()` 在服务器显式启用 `app` profile 后读取，确认包含 API/Web，再返回摘要。它绑定实际环境、启动命令、挂载、网络和服务配置。默认镜像启动沿原路径处理，公共 AI 保留旧库组合须额外登记下文运行绑定。其他显式命令或 `entrypoint` 进入 `awaiting-runtime-binding-review` 或明确拒绝。

每小时无数据变化更新还需要 `.hourly-update/paired-authorization.json`。该文件由获得发布授权的运维写入，更新器只读取，CI 产物不能提供或改写它。

```json
{
  "format": "zelo-paired-authorization-1",
  "scope": "official-pair-no-data-change",
  "approvalReference": "<负责人实际批准本配置范围内自动更新的记录>",
  "runtimeConfigurationSha256": "<与已核运行基线相同的配置摘要>",
  "validUntil": "<带时区的授权截止时间>"
}
```

两份本机记录必须归当前运维用户所有，权限为 `0600`，路径为普通文件。首次旧库桥接与迁移账尚未核收时保留 `legacy-combined` 状态，由原门禁返回 `awaiting-migration-bridge`。数据、原 SQL、schema、能力或顺序变化返回迁移待批准；原 `pending-migration.json` 存在时也暂停切换。授权缺失或过期返回发布待批准。正式构建回执中的 `releaseApproved` 和 `serverUpdateEligible` 持续保留原 `false`，本机授权单独校验。

候选通过后先核同组镜像归档并加载，使用原 `--observe-pair` 核实际双镜像。切换前再核原镜像、Compose 配置、有效授权及同次 CI。版本分别比较，任何一仓降级或同版替换都进入保持状态。成对切换使用单独的 `compose.pair-images.yml` 叠加镜像选择，已登记旧库组合同时写入精确模板命令和该版归档挂载。原 `compose.override.yml` 继续提供其余核定配置。人工调用 Compose 时也须按相同顺序包含这两个 override。

更新前写入两镜像回退标签和原基线日志，失败或进程中断后沿原 `restore()` 恢复两角色和基线。该路径限定无数据变化更新，旧账迁移与数据恢复继续由维护流程处理。成功采用的原输入材料保留供下次比较和回退，下载 ZIP 与一次性解包目录在退出时清理。相同候选和本机条件的 pending 会复用紧凑结果，每小时仍核线上健康及官方运行状态。

安装此源码前需要核收上述工具、真实基线和本机授权。现有仅执行 `holding-current-pair` 的脚本提供小时健康巡检，自动发现和升级须以新入口实际安装及门禁结果分别核定。

### 公共 AI 保留旧库的运行绑定

首次旧库桥接、权限衔接和实际启动通过后，运维把该次正式底座归档原字节留在 `prepared/<运行号>-<尝试号>/runtime/platform-source.tgz`，将以下 `runtimeBinding` 加入真实 `paired-active.json`。归档与同目录 `api/` 中完整 v2 锁的 `base.platform.sha256` 必须一致。该登记属于首次维护核收，更新器只继承已生效的绑定。

```json
{
  "runtimeBinding": {
    "format": "zelo-legacy-public-retention-1",
    "platformArchive": "/home/ritiadm/zelo/.hourly-update/prepared/<运行号>-<尝试号>/runtime/platform-source.tgz",
    "platformSha256": "<该版正式底座归档SHA256>",
    "archiveTarget": "/run/zelo-release/platform-source.tgz",
    "templateSha256": "16052646c62dc7bcdc36f218d44c47ad9767fb0b5dad888f90879ddb437daa35"
  }
}
```

允许的 API command 是更新器 `legacy_command(runtimeBinding)` 返回的完整数组。它从同一 `dist-ai-public-retention` 读取原工厂，显式构造 `LegacyRentalDataSelection`，沿原 bootstrap 和旧账观察启动。模板只有归档容器路径一个变量，保留原 public-retention 选择且 MCP 关闭。首次已经采用 `/run/zelo-release/platform-source-<版本>.tgz` 的同正文模板也可登记，该容器路径之后保持固定，实际版本始终以所挂归档与锁的原摘要确定。使用新登记时推荐上述无版本容器路径。

归档挂载使用 `type: bind`、精确 source/target、`read_only: true`、`bind.create_host_path: false`。API 的工作目录为 `/app`、用户为 `node`，明确配置 `RENTAL_DEPLOYMENT_LOCK=/app/apps/rental-api/prisma-deployment/core.deployment.lock.json` 和 `RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR=/app/public-ai-data`。模板调用的九个宿主/公共出口产物按已核 0.2.2 镜像的字节清单验证，合同变化须核收后更新模板。额外挂载覆盖固定应用、依赖或归档时拒绝。Web 沿同次正式镜像默认 command/entrypoint 启动。

登记时配置摘要调用 `runtime_configuration(runtimeBinding)`。它先核完整模板、归档原字节、同版锁和精确只读挂载，随后只将受管归档的宿主 source 归一为固定标记，其他配置继续参与摘要。本机 `paired-authorization.json` 还须明确增加 `runtimeBindingFormat: zelo-legacy-public-retention-1` 和 `legacyTemplateSha256`，值与上例模板摘要相同。首次桥接记录、配置摘要、授权有效期、原 pending 和无数据变化要求继续逐项核对。

每次候选的底座归档由原正式 Release 下载核验取得，来源与同次 CI 的 API/Web、完整双 SHA 和部署锁核同，和 API 输入一起保存到新的 prepared 目录。切换用同一 Compose 覆盖文件绑定两个新镜像及新归档，启动后再核实际容器 command/entrypoint、API 用户/目录和只读挂载。授权摘要因此可跨已核同模板的无数据变化候选继续使用。

`zelo-paired-rollback-2` 日志保存旧 active、两镜像、旧运行绑定和候选绑定。失败或中断恢复先识别现场属于旧/新哪一份已核绑定，再成对恢复旧镜像和旧归档挂载，核健康和实际运行材料后恢复 active，最后删除 journal。旧版日志读取继续保留。已采用与待核失败材料各自留存，发现同运行目录已存在时暂停交人工核对，避免覆盖原恢复证据。此源码路径的实际服务器切换验收与安装分别记录。

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

选择 AI 时，旧数据发行 `0.1.1` 对应 dataVersion `0.1.0`、`./data-package` 和原 `prisma/` 迁移。公共数据发行 `0.2.0`、`0.2.2` 均对应 dataVersion `0.2.0`、`prisma-public/`、原 12 文件集合及 `public-data`、`public-data-package`、`public-mysql-data` 三个出口。各发行分别核锁、包文件、导出和原 SQL。`@rental-os/ai-native-data` 的四出口 SDK `0.2.1`、`0.2.3` 及未知发行被数据发行校验拒绝。公共保留的 `@rental-os/ai-native-server` SDK 按独立包身份和固定构建回执核定，本批版本为 `0.2.1`。两个公共数据发行之间继续使用相同迁移身份，旧混合与公共数据之间的正反向比较均标记 `requiresAiDataBridge`，由原账桥接核收。

选择 MCP 的 prepared 材料需同时提供正式宿主入口、部署锁中的 `mcp` `0.1.0` 或 `0.1.1` 发行、dataVersion `0.1.0`、固定包文件及五项按正式 ID 排列的 SQL 和原账标识。未知发行或数据版本会被拒绝。原账名按 `platform-capability.mcp.*` 核对，既有库的历史映射仍由原宿主取得执行证据。`mcp` 模式使用支持 `--no-lazy-fetch` 的 Git 从本地固定对象读取公开贡献清单和原 SQL，仅核顺序、前置和摘要。现有宿主打包入口还需接入 MCP 能力和原账观察。

退出 `0` 表示材料核对通过，比较模式还表示材料无数据差异。`2` 表示有数据差异，`1` 表示输入验证失败或缺少必要材料。所有模式的 JSON 都标明 `releaseApproved: false` 和 `databaseChecked: false`。`domain`、旧单 SHA 证明和缺正式 AI 数据包的候选均被拒绝。旧组合基线可用 `prepared legacy-combined` 明确识别，校验会在读取现场材料前要求正式旧库桥接。原迁移门禁和回退继续沿上文入口。

### 双仓构建证据

[verifyPairedBuildEvidence](../release-build-evidence.cjs) 消费本进程已核过固定构建证明的 `verifyPreparedRental` 结果。调用方须先核收候选归档、固定 CI 策略、同一次运行的构建记录及实际镜像观察。它比较含构建证明摘要的候选身份与构建记录，校验 GitHub 运行的仓库、工作流、主分支、固定 SHA、编号、尝试次数及成功状态。策略中显式选择 `automatic` 对应 `push`，`manual` 对应 `workflow_dispatch`。两种来源都须提供同一记录中的 API 和 Web 镜像 ID，逐项与实际镜像观察匹配。

### 生成下一对正式资产

Zelo `v0.1.18` 与 Rental Core `v0.1.15` 已于北京时间 2026-11-27 08:18（UTC 00:18）正式发布。两 Tag 分别固定到 `46db0945dee92ac916f7265e95948943fc8b641d` 与 `7e20d6ef0b206e16a9162f4a2a6e88c13cbc0497`，对应资产为 `platform-source-0.1.18.tgz` 和 `rental-0.1.15.tgz`。[Zelo 已发布版本](https://github.com/JinPen-G/Zelo/releases/tag/v0.1.18) · [Rental 已发布版本](https://github.com/JinPen-G/Zelo-rental-core/releases/tag/v0.1.15)

后继发版由两仓负责人确定各自尚未使用的新版本，提交配套修改并冻结完整 SHA。底座的根 manifest 与原 npm 锁版本须一致，Rental 的包版本、`RENTAL_CORE_VERSION` 和各宿主依赖须一致。已发布 Tag、资产和历史部署锁保持原身份，修订使用新的版本和 Tag。保持已经使用的发行来源 `JinPen-G/Nativark` 与 `JinPen-G/nativark-rental-core`。独立仓根 `core.manifest.json` 保留最后一次已核发现结果，待新资产回读和正式配对 CI 成功后按下文单独更新。

底座固定提交须已包含本节的正式工作流，派发时该提交是 `main` 的目标。下列 `ZELO_SHA`、`RENTAL_SHA`、`ZELO_TAG` 和 `RENTAL_TAG` 填写本次批准的新发行输入。开发 CI 的成功回执用于开发组合核验，正式发布和服务器切换分别取得对应材料与批准。

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

发行入口复用固定 `core-contracts` 的三段数字稳定版本规则，并按主、次、修订版本完整比较，要求底座高于已公开的 `0.1.18`、Rental 高于 `0.1.15`。例如 `0.2.0` 可进入后续 Tag 与兼容核验。预发布、带构建后缀、同版及旧版会被拒绝。

底座根锁依赖用于编译公共合同。业务发行编译由 [release-dependencies.cjs](../release-dependencies.cjs) 从同一双仓 `host` 投影读取根清单、原投影锁及所选 workspace 清单，在任务目录的 `build-dependencies` 内执行 `npm ci --include=dev --ignore-scripts`，通过原 `--deps` 交给发行器。安装后核输入原字节，构建结束或失败均清理该独占依赖目录。目录已存在或身份发生变化时拒绝覆盖／清理，保留错误供调用方处理。

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

[Rental 正式候选构建](../../../.github/workflows/rental-release-candidate.yml) 从可信 Zelo `main` 手动派发。填写已发布的两仓完整 SHA、各自版本 Tag 和独立核收的两个发行归档 SHA-256。Zelo SHA 须等于该次运行的 `GITHUB_SHA`。调用方先验证 Tag 解引用，再取得该 Tag 下的 `platform-source-<版号>.tgz` 与 `rental-<版号>.tgz`，逐一核对原字节。在受管 Linux runner 使用锁定依赖，按[材料生成入口](../release-prepare-pair.cjs)构建所选单 Rental 组合。

```sh
node scripts/ops/release-prepare-pair.cjs release "$ZELO_REPO" "$ZELO_COMMIT" "$RENTAL_REPO" "$RENTAL_COMMIT" "$TASK_DIR" "$PLATFORM_DIGEST" "$RENTAL_DIGEST"
```

`TASK_DIR` 是本次专用目录，输入归档分别存为 `platform.tgz`、`rental.tgz`。`prepareRentalReleaseWorkspace` 先核固定源码、两 Tag 和两归档，返回含所选 vendor 的最终 workspace。`withReleaseDependencies` 按该投影锁安装独占编译依赖，再在同一进程调用 `packageRentalReleaseWorkspace(prepared, { deps })` 正式重编译并复核原归档。Web 使用同一 workspace 的 npm 锁，直接消费 API 上下文中的 Core 包和同一份部署锁。归档生产与镜像运行使用同平台的锁定 Node 工具链，Linux 镜像使用 Linux 归档。`development` 模式省略两个发行摘要，仅为普通组合生成不可部署的演练材料。

候选选择使用 `--ai disabled|public-retention` 与 `--mcp disabled|enabled`，两项默认 `disabled`。对应 CI 输入为 `ai_mode`、`mcp_mode`。选择公共 AI 保留还须提供 `--ai-data-sha256`，对应 CI 的 `ai_data_sha256`，其值来自独立核收的实际数据发行。普通组合携带该摘要、单独启用 MCP、未知或重复选项均被拒绝。

`public-retention` 选择正式两阶段的公共 AI 保留宿主。须同时提交已独立核收的 AI 数据发行 SHA-256，第一阶段准备和第二阶段重编译均与此摘要核对。固定版本的实际安装、Web 和配对镜像结果分别记录。

- 固定双仓的 release 投影和正式宿主打包消费原发行资产，生成同次公共保留运行入口、v2 部署锁、18 条原迁移及 `postCapability` 来源。发布校验逐项核后置扩展原 SQL、schema、来源、前置迁移和原账名。数据发行摘要须与锁、实际数据包、宿主收据逐一相等，SDK 继续走独立版本和安装文件校验。
- API 与 Web 使用同一选择、投影 npm 锁和部署锁。Web 通过 `RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR` 读取 API 材料中的 `public-ai-data`。锁内显式选择 MCP 时，`RENTAL_MCP_DATA_PACKAGE_DIR` 指向同一 API 材料的 `packages/mcp-server`，完整包须经所选 Vite 入口核验。数据目录传递只提供构建材料，MCP HTTP 状态沿实际宿主收据核定。OP 收据核验覆盖 v2 原账、扩展 SQL、运行入口和实际编译项目后，才产生配对镜像输入。
- 公共保留与 MCP 联合选择目前由正式入口明确拒绝。已有23条新装数据组合和双能力 Web 消费沿各自入口验证，`data-only` 的 HTTP 状态仍由第一方权威和实际宿主装配核定。

正式 AI 归档、成对镜像和 CI 成功证据须从同一固定组合实际生成。旧线上 AI 升级继续经过三项旧迁移、首次旧账桥接、备份恢复和具体版本切换审批。

API 准备和原宿主打包复用上述同锁独占依赖入口。Web 构建继续按同一投影锁安装依赖，在缺少根 `tsconfig.json` 时生成继承该投影 `./tsconfig.base.json` 的临时构建配置，限定共用源码的配置查找范围。该文件仅用于本次 Web 构建，源码归档、npm 锁和正式候选身份继续按原材料核验。

所选新装投影中的 vendor 数据 SDK 精确使用 `@rental-os/ai-native-data@0.2.3`，由 `apps/rental-api` 以 `@rental-os/public-ai-data` 别名安装。公共保留 server SDK 仍为适配包独占的 `@rental-os/ai-native-server@0.2.1`。两者分别核包身份、固定来源、归档 SHA-256／SHA-512、文件清单与投影安装锁，再带入编译依赖目录。AI 数据发行 `0.2.2` 的摘要继续独立核定。

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

在独占 Docker 环境下载原配对产物，先对照可信来源独立核定的 Actions ZIP、`image-pair.json` 和压缩镜像摘要，再执行 `sha256sum -c SHA256SUMS`。加载同组镜像后，使用下文 `--local-images` 核对配置摘要、角色、部署锁和相同的 CI 运行标签。候选和回退各保全一组完整记录及镜像。更换前以已核原账判断旧程序是否仍能读取当前数据。隔离切换演练应对两个角色同时比对 ID 和健康结果，失败时以原两镜像恢复并重查。数据库恢复仍使用单独批准的原账与备份。

### 更新前只读复核

独立核收的 `policy.json` 记来源和外部锚点，包括 `origin`、`repositoryId`、`workflowId`、`workflowPath`、`headSource`、`runId`、`runAttempt`、`buildRecordSha256`。`workflowPath` 取实际调用工作流路径。证据目录另含真实 GitHub `run.json` 和该次原字节 `image-pair.json`。将同次交接的 API 宿主目录和 `input.json` 中已独立核收的 `contextSha256` 交给复核入口。

```sh
node scripts/ops/release-verify.cjs paired-review "$CANDIDATE_DIR" "$CONTEXT_SHA256" \
  legacy-combined - "$EVIDENCE_DIR" --local-images
```

`--local-images` 需要 Python 3 和本机 Docker。先核双仓、宿主、迁移材料与 CI，再观察已经加载的两个镜像。返回中的 `imageIds` 为 CI 记录的配置摘要，`runtimeImageIds` 为本机镜像 ID。OCI 镜像存储使用 manifest ID 时，从该固定 ID 流式导出并复算 manifest 原字节，再对照其中的 config digest。供已独立核收的历史观察材料复核时，可省略 `--local-images` 并由证据目录提供 `images.json`，其中 `api`、`web` 是独立核收的配置摘要。

证据不匹配时退出 `1`。旧组合或新旧 AI 数据切换返回 `awaiting-migration-bridge`。已有正式基线且迁移材料有差异时返回 `awaiting-migration-approval`，材料一致时返回 `awaiting-release-approval`。三种状态均退出 `2`，由后续现场审批处理。旧组合新增 SQL、备份和首次旧库桥接分别按原账与物理结构核准，镜像恢复不执行逆向 DDL。
