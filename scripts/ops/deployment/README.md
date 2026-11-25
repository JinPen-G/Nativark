# 固定源码更新脚本

[hourly-update.py](hourly-update.py) 为现有 `nativark-demo` API、Web 更新流程固定 Git 提交，核对 CI、数据库文件差异、现有镜像与回退收据，并按 [Dockerfile](Dockerfile) 构建指定版本。

源码归档由 `git_source_archive` 的精确白名单生成。构建需要的两份脚本为 [build-selected-prisma.cjs](../../build-selected-prisma.cjs) 和 [miniprogram-shared-types.cjs](../../miniprogram-shared-types.cjs)，它们与 `scripts/ops/deployment` 一并进入归档。

`git_snapshot` 先以 `--depth=1 --no-tags --filter=blob:none` 取得运行版本和候选版本的两个固定提交及树。迁移比较仍沿原路径和 blob 身份进行。CI 与迁移检查通过后，`fetch_source_blobs` 从候选树列出 `SOURCE_PATHS` 中的 blob，通过 stdin 一批取得这些固定对象，再沿原 Git archive 生成构建上下文。元数据拉取限时 180 秒，构建文件批量拉取限时 300 秒，失败继续中止本次发布。

批量取得对象后会移除该次专用临时 Git 库的 promisor 配置。服务器 Git 2.34 的 archive 会对部分克隆隐式预取整棵树，因此归档阶段关闭这种下载，缺少所需对象时直接报错。

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
