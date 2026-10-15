# 通知设置原任务业务消费（CA06/07）

施工树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007；承接 a8372194 的本线在途三个文件。没有合并移动主线、没有修改 runner、approval、Core、shared、schema；历史 output 保留。

## 实际入口

- `composeAiAuthorizedBusinessTools({ ..., approvedSettings })` 暴露 `settingsActions.read` 和 `settingsActions.humanHandoff`。缺正式依赖时保持 unavailable，读取拒绝，不创建政策或默认授权。
- `composeAiSettingsBusinessConsumer` 复用真实 ApprovedSettingsTaskAuthority、composeApprovedSettingsApplication、composeTaskSettingsHost。严格原 preparation 合同，核对 task/run/step、工具版本、changeId/hash；读取原当前配置、准备收据、提案、决策、原操作回执，分开展示，不把批准当业务已写入。
- 已提交回执另经原 settings.readCommittedChange 按 THIS task/step 重新解析核对；不重写操作键算法、不接受另一任务的同 change 回执作本任务成功依据。聚合结束复验当前身份、任务/步骤快照、当前配置与提案。
- 保留 read_only / not_observed / unknown；原应答不明异常只映射到原收据读取，不自动重试写入。授权失败不降级为旧事实。
- humanHandoff 只交原 preparation reference、决策和步骤关联；不 approve、不领取 lease、不发布输入、不调用 continueConfirmation 或 Core 写操作。

## 定向快检

环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT 为本树绝对路径；AI_OFFLINE_AUDIT 分别为本树 output/ca-settings-consumer.audit、output/ca-settings-types.audit；TEMP/TMP=本树 output/entry-booking-tmp。不读 .env、不联网。

命令：

`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='settings normal host starts' tests/ai-native-plan-input-source.test.cjs`

最终 pass=1、fail=0、skip=0、todo=0、cancelled=0，退出码0。本轮收口前该定向测试也通过，未声称新增红测。复用原正常宿主用例，没有新增脚本：实际 runner 开始→持久暂停→业务只读材料与人工交接→实际审批→原恢复→原 Core 提交回执→业务材料读回。新增断言覆盖错任务、缺host、当前撤权拒绝；读与交接不会生成 approval/operation。数据库事务、持久事实和 Core 执行是离线替身，授权、原执行器、仓储、业务消费者是真实代码。

类型命令：同上两个 preload 后使用 `node -e` 调用既有 TypeScript API：readConfigFile/parseJsonConfigFileContent(apps/api/tsconfig.json)，createProgram，noEmit=true、incremental=false、rootDir=本树，paths 的 @rental-os/shared 指向本树 packages/shared/src/index.ts，@prisma/client 指向本树 apps/api/node_modules/@prisma/client/index.d.ts；getPreEmitDiagnostics。523入口、0诊断、退出码0。没有生成共享产物，不冒称原未运行构建通过。

`git diff --check` 退出码0。没有扩大为全专项回归，没有独立审查、真库、真实模型、HTTP、浏览器或设备验收。

## 精确待接

- 主线显式提供原 settingsHost、真实当前身份/Guard/ALS、权益、db/Core 和可信场景；消费者不注册 HTTP/AppModule，不自动启用。
- 原暂停续跑要求当前服务器 checkpointRef。业务交接仅提供原提案引用与 step.resultRef，明确缺 `current_server_checkpoint_reference`，不把结果引用冒称 checkpoint、不自行领取恢复租约。
- 仅已正式实现的通知配置变更；不开放任意配置路径，不扩客户资料写动作，不冒称 CA06/07 或 AIN-14/16 整项完成。
- Runtime 与 Provider SDK 均不接入；业务消费依赖原宿主/正式合同，不含 SDK 类型，不另造运行循环。
