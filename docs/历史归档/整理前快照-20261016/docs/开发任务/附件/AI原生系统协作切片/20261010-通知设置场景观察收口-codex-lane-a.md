# CA06/07 通知设置场景观察收口

固定依赖 b852cb54015a6a5aef44315392ecf5274b33897c 已通过 9ace6eae 合入；开始 HEAD cb232f94，源码干净，output 保留。只修改本线 settings-business-consumer 和既有定向用例。

## 已接入口

`composeAiAuthorizedBusinessTools(...).settingsActions.read/humanHandoff` 已消费原通知设置 preparation、proposal、已存人类 decision、原 operation receipt；`composeAiTaskCenterScene(...).readScene({kind:'settings',...})` 已接同一消费者。固定服务器 `settingsHost.application.readConfirmation({taskId,runId,stepId})` 已交付并复用，返回 checkpointRef/taskRevision，仍与原提案 hash 比较和重读。不创建 settingsTask facade，不复制主线在途组合，不调用发布/批准/续跑。

本片输出明确 inputPublication=published_reference、execution=not_attested，并保留原 workflowStatus。cancel_requested 仅表达 requested_not_rollback。approve 或任务 succeeded 没有原业务收据时，businessOutcome 仍 not_observed；只有原操作收据与 THIS task/change 的原执行者读取完全一致才 committed。

返回前补原 readDecisionReceipt 复读：在多次 await 之间人类决定发生变化时拒绝旧聚合。humanHandoff 复用相同 unknown 处理，保存原 nextAction/retryable:false，不在 unknown 时拼接缺失任务或暗示可继续。权限拒绝仍抛出，未吞为业务降级。

## 实际验证

固定无效 DATABASE_URL；AI_OFFLINE_WRITE_ROOT 本树；AI_OFFLINE_AUDIT 本树 output/ca-settings-observation.audit 或 ca-settings-observation-types.audit；TEMP/TMP 本树 output/entry-booking-tmp。

`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='settings normal host starts' tests/ai-native-plan-input-source.test.cjs`

1 pass / 0 fail / 0 skip / 0 todo / 0 cancelled，exit 0。实际原 runner→等待→消费者/任务中心→原人类批准→原 Core 收据调用；补断言待确认时输入已发布/执行未证实、approve 尚无业务结果、succeeded 不附原键时不能证明配置生效。测试里的 Core/数据库为离线替身。预期拒绝诊断不是失败；没有新测试脚本或全矩阵。

API Compiler API/noEmit：原 tsconfig，rootDir 本树、shared 源码和私有 Prisma paths、incremental:false，525 roots / 0 diagnostics / exit 0。git diff --check exit 0。unknown 手工交接和取消说明的新增分支本轮只做代码核查，未扩充对应故障矩阵；不宣称完整故障验收。

## 依赖与边界

通知设置以外分区/普通客户资料仍只 prepared_not_submitted，缺正式获准字段、版本与提案/原业务操作端口；不借 order.commit 写配置。原服务器能力/HTTP 发布和真实 DB 锁未验，未连接 HTTP/DB/模型/支付/设备、无生产启用。

业务消费只读原输入、提案、决定和业务事实；不持有 Runtime/Provider SDK 类型。未来分别换编排或 Gateway adapter 时保留此证据边界，unknown 不改键重发。回退可以撤去新增观察字段的消费，不改变原批准/配置事务。
