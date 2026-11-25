# 固定源码更新脚本

[hourly-update.py](hourly-update.py) 为现有 `nativark-demo` API、Web 更新流程固定 Git 提交，核对 CI、数据库文件差异、现有镜像与回退收据，并按 [Dockerfile](Dockerfile) 构建指定版本。

源码归档由 `git_source_archive` 的精确白名单生成。构建需要的两份脚本为 [build-selected-prisma.cjs](../../build-selected-prisma.cjs) 和 [miniprogram-shared-types.cjs](../../miniprogram-shared-types.cjs)，它们与 `scripts/ops/deployment` 一并进入归档。

在 Git 检出中运行离线自测，需要 Python 3.12 或更新版本及 Git。

```sh
python -B scripts/ops/deployment/hourly-update.py --self-test
```

自测保留 CI 门禁断言，并在开始归档前解析一次完整 `HEAD`。它使用当前脚本白名单读取该固定 Git 对象的真实 tar 流，在内存中核对归档内 Dockerfile 的全部本地 `COPY` 字面路径，涵盖多源、续行、JSON 形式和选项。`COPY --from=...` 的来源归前序构建层或镜像，交由 Docker 构建验证。

两份构建脚本逐一缺失的反例必须被拒绝，脚本目录的归档范围同时受到断言约束。输出包含固定提交、归档文件数、本地 `COPY` 来源数与缺文件反例数。归档内容始终来自固定提交，运行中的脚本白名单用于验证待提交修复。

`--self-test` 的副作用限于读取本地 Git 对象与输出结果，归档和检查材料均在内存消费。镜像构建、服务器安装、服务切换、数据库及运行验收属于另行授权的执行范围。`--check` 会读取现有服务器与远端状态，`--apply` 会执行更新及必要回退。
