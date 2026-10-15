# A线任务中心读取与通知设置接续

施工树 codex-ai-native-lane-a；分支 ai/codex-ai-native-lane-a-20261007。接续380ba891，保留output，未写其他树。功能优先，仅扩已有host烟测，不新增测试脚本。

## CA09 实际补修

既有 composeAiTaskCenterScene 的 readInput/readSelection/readApprovalReview/readApprovalReceipt 接口保留。审批读取先用现有 parseQuoteSelectionProof 校验完整选择，并核对外层原请求、task/run，拒绝把另一任务审批包装到当前详情。可选读取前后比较同一身份hash、原请求contentHash、task/run/revision，读取途中撤权或变化拒绝返回旧内容。依赖缺失仍不可用，不决定审批、不启动任务、不写Core。

复用 tests/ai-native-lane-a-original-scene-host.test.cjs 的 persisted scene model result 单例，驱动真实任务中心、原请求/当前权限/任务仓储；只替代可选宿主端口。检查缺处理器、正常null输入、另一任务选择未调用审批端口、await期间撤权不返回旧值。DB/业务依赖为原离线替身。首轮0pass/1fail因新增测试selectionId/taskId不符合正式UUID schema，修正夹具，未放宽schema或拒绝断言。

## 旧报告纠正与验证命令

前次普通ts-node/tsc报shared出口缺失，实际源码index已有出口，解析的是旧dist；不能据此声称缺少整个公共源码。沿用现有lane-b-local-runtime.cjs，验证本树源码及带owner标记的私有Prisma，不生成或修改共享产物。

所有Node命令前置：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为本树output/ca09-source-runtime.audit（类型用ca09-source-types.audit）；TEMP/TMP为本树output/lane-a-original-request-tmp。

定向命令：`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='persisted scene model result' tests/ai-native-lane-a-original-scene-host.test.cjs`。最终结果见本记录后续追加，不把启动失败或旧阶段结果称最新通过。

最终同项复验：1 pass / 0 fail / 0 skip / 0 todo，退出0；一个案例循环订单、开业、报价三场景，不计为三项测试。git diff --check退出0。

API源码noEmit使用typescript.readConfigFile/parseJsonConfigFileContent/createProgram，保留原strict配置，只设rootDir为本树、noEmit=true、incremental=false及baseUrl/paths指向本树packages/shared/src/index.ts与apps/api/node_modules/@prisma/client/index.d.ts；getPreEmitDiagnostics=0，退出0。普通dist解析命令的历史失败保留，不宣称普通构建通过。

## CA06/07 精确依赖

已只读核验主线固定e26b9a13：composeRequestBoundApprovedSettingsApplication已有readCurrent、prepareChange、readChangeReceipt、publishTaskInput、readTaskInputReceipt、prepare、readPreparationReceipt、readProposal、decide、readDecisionReceipt、commitApprovedChange、readOperation。先前“participant缺失”判断不准确，撤回；真正未接的是设置专用runner执行链，归总线。本树尚无上述settings应用/输入/Core participant源码，不复制协议或借order.commit。

准备只允许正式通知数组；prepared_not_approved不是活动配置已保存，输入发布不是step登记成功，决定不是Core执行成功。应答不明按原changeKey/原operationKey读取，不能换ID重发。普通profile资料不借通知participant修改。

前次c138固定merge真实冲突已abort，未重试或粗暴选一侧；公共schema/shared/runner/knowledge不由A解决。已向主线报告，请交可安全同步的固定依赖/解冲突方案。CA06/07消费尚未实现，不能按本记录计完成。真实MySQL、HTTP、模型、支付、设备/浏览器及生产全部未验。

Runtime与Provider未来分别可替换，当前均不接入；消费层不拥有派发/财务账本/审批权限。
