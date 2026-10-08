# 四线固定成果整合与本地 main 交接（2026-10-08）

## 授权与现场保全

负责人明确授权：整合四条辅助树成果并合入本地 main；确认 main 原作者停写，允许先提交 main 全部既有未提交成果。仅是整合与本地合并，不授权安装框架、恢复后台循环、数据库迁移、生产启用或推送。

- main 原 HEAD `558c7851`；既有修改独立保全 `fb43bc53`（102 文件，包含既有删除状态，不是本轮新增功能验收）。原内容均可从该提交及其父提交恢复。
- AI 主线原 HEAD `668ebdff`；已有 547 材料包暂存现场保存为 `8df963a6`，未重复摘取。
- 已有中央记录与总册文档 WIP 独立保存 `9a214f14`，不将其当本轮新增实现。
- 四辅助树仅只读，原 HEAD、源码、output 与历史资源未改动。主线/main 历史 output 不提交、不清理。

## 固定成果与整合提交

| 原线/固定包 | 主线提交 | 实际整合 |
| --- | --- | --- |
| A `547e8c30` | `8df963a6` | 原已暂存客户材料持久化及原操作收据 |
| A `8097c260` | `0447a8d8` | 持久客户政策/冻结输入到原任务创建；readCreation 文件与主线 blob 完全一致，自动不重复写入 |
| AIN-06 `5b98b053` | `0fd7747a` | 两阶段执行、确认暂停及原资源 charges；夹具冲突保留主线原请求/quote selection/decisionExpiresAt 与新 phase/upsert/decrement 语义 |
| AIN-07 `c5fe3553` | `2631e0e0` | 通知设置正式审批 participant、request-bound 应用和两份叶子契约；f4 的工具码已主线等价，未重复摘取 |
| B `dd89ddf7` | `21d663f6` | 独立 automation management grant、准备/提交收据、CAS及计数保留；AiScope 冲突同时保留 originalRequests 和三项新关系 |
| 联合补齐 | `44b26934` | 与两份客户 DDL 对齐的三个 Prisma 模型、复合归属/FK/索引、BusinessWorkspace 反向关系；通知设置 shared 总出口与 OpenAPI components（不新增 HTTP paths） |

已有四线更早成果按最新总册等价主线记录复用，不因 SHA 不同重摘整链。以上是功能成果整合，不是把四辅助分支每个重复依赖提交重新 merge 一遍。

## 本轮验证（每条结果独立）

统一 Node 前置：`--require ./tests/fixtures/ai-native/prisma-offline-preload.cjs`；DATABASE_URL 固定 `mysql://offline:offline@127.0.0.1:1/rental_os_offline`，AI_OFFLINE_AUDIT/WRITE_ROOT/TEMP/TMP 使用当前施工树绝对路径，禁 compile cache。没有读 .env、启服务、真实外联、安装或数据库执行。

1. `node ... --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-concurrency=1 tests/ai-native-lane-a-original-scene-host.test.cjs tests/ai-native-confirmation-checkpoint.test.cjs tests/ai-native-events-contracts.test.cjs`：58 pass / 0 fail / 0 skip / 0 todo / 0 cancelled，exit 0。真实服务/控制器/运行器，DB/Auth存储/Core事实为显式离线替身。日志主线 `output/codex-integration-20261008/integration-smoke.tap`。
2. TypeScript createProgram 读取 apps/api/tsconfig.json，noEmit/incremental:false/rootDir=本树，paths 指向本树 shared 源码和私有 Prisma：502 API 文件，0 diagnostics，exit 0，`api-types.log`。未写共享生成物。
3. `node ... scripts/ai-native-generate-local-prisma.cjs`：隔离生成 exit 0，schemaHash `60c4b8fae0bac3a58fd6111ad751c69580cd0da665bfca26c92e79eae51ffd15`，guardViolations=0，sharedArtifactsUnchanged=true。原 previous/junction/temp 保留。
4. 独立 schema-check 目录复制联合 schema，仅运行既有 Prisma CLI `validate --schema schema.prisma` 与 `migrate diff --from-empty --to-schema-datamodel schema.prisma --script`：均 exit 0，不连接数据库。第一次误用生成器已清理的临时 CLI 路径，两命令 MODULE_NOT_FOUND/exit1；保留初次日志，改用真实已安装 CLI 后通过，不声称首轮通过。此 diff 是 datamodel DDL 生成，不是已部署数据库 drift 检查，也不能证明 MySQL FK/索引/锁可执行。
5. 原 `tests/category-config-write.test.cjs` 用 output 中验证专用 source-dist-preload 将 dist 请求映射当前真实源码执行：exit 0，`settings-smoke.log`。Core/Guard/仓储是真的实现，数据库/批准 participant 是替身；当前正式 settings task/input/step 生产链仍未接齐，不能称 AI 正向审批执行全链通过。
6. 公共总出口接入后原 `tests/ai-native-leaf-publication.test.cjs` 初次失败：新增 generatedText 的 const:null 不被既有转换器支持。改为语义等价 `{type:'null'}`，将 settings 叶子纳入既有差分集合；复验 7 pass / 0 fail / 0 skip / 0 todo，exit0。没有放宽 OpenAPI 转换器。
7. main 合并工作区 Admin TypeScript createProgram/noEmit：212 入口、0 diagnostics、exit0。`node ... --test tests/admin-account-menu.test.cjs tests/admin-datetime-range.test.cjs tests/ai-native-b05-ui-arc.test.cjs`：12 pass/0fail/0skip/0todo，exit0；静态/React SSR及离线方法替身不是浏览器/读屏验收。
8. 合并冲突：后台订单页自动合并后保留 App/Modal 适配和默认关闭 AiTaskWorkbench；正式文档按最新版本逐段保留，B05历史记录语义等价保留原main表述，B05测试保留AI线新增断言。每次 diff check 的退出码单独检查。

## 剩余边界

客户端目前只正式创建 QUEUED 元数据，不因此启动模型/runner；企业/个人会话授权不能由 caller 自授。自动化政策管理需要可信 grant 置备及真实宿主；不 seed、不启 worker。R04后继run与预算继承、settings正式输入/计划/运行器生产者、公共媒体Gateway完整输入绑定等仍按原总册保留，未为合并补造默认成功。

未运行全专项数百/数千项回归、真MySQL迁移/锁/并发、真实HTTP/模型/支付、浏览器/微信/设备、部署或生产验收。不执行会 loadEnv 的普通 Admin build。不安装或迁移 LangGraph/Provider SDK，不擅自解决两份路线文档之间的决策差异。局部验证和合入main不改变原AIN任务验收状态。

本轮 main 合并时出现 shared/src 下未跟踪 .js/.map 产物，未夹带提交或删除；它们不是正式共享生成方案的交付。源码以已提交 .ts 为准，后续运行源测试需避免被未跟踪 JS 遮蔽。

## 已执行的本地 main 合并与最终复核

- `04f6d72a`：AI 主线及四条固定交付与 main 的保全提交合并，逐段解决五个文档/测试冲突；订单详情页自动合并后经 Admin 类型及定向回归确认。
- `9acda19d`：纳入 null-only schema 修复、既有契约测试扩充和本交接记录。该时点 main 已包含 AI 主线 `503a454b`，ancestor 检查 exit0，apps/api 与 packages/shared 对比专项分支无差异。
- main 最终 API noEmit：502 入口/0诊断/exit0，明确只读使用与已合并 schema 匹配的 foundation 隔离 Prisma 类型，未生成或覆盖 main 共享 client。
- main `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/miniprogram-static.test.cjs tests/staff-miniprogram-static.test.cjs`：62pass/0fail/0skip/0todo/0cancelled，exit0，含现有脚本的两端构建验证；这是静态/离线微信宿主替身，不是真微信/真机验收。日志 main `output/codex-main-merge-20261008/client-static.tap`。
- main 无未解决冲突、MERGE_HEAD 不存在（verify exit1为预期不存在），tracked status 干净，diff check exit0。未跟踪 JS/map/output 继续保留，不称整个工作区零资源。
- 本次授权只执行整合和本地合并，没有 push、部署、真实迁移/HTTP/DB/模型/支付；原未完成功能与整项验收门槛仍然有效。后续单独文档同步提交不改变上述代码验证结果。
