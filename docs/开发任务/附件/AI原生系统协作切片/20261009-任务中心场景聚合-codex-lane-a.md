# 任务中心场景聚合（CA09）

工作树：`codex-ai-native-lane-a`；分支：`ai/codex-ai-native-lane-a-20261007`。承接通知设置业务消费者 `12a4d494`；本片只修改现有 `task-center-scene.composition.ts` 和本线既有场景行为测试，不创建第二任务 facade、状态机、事件水位或执行循环。

## 实际入口

`composeAiTaskCenterScene(...).readScene` 现在组合已有正式读取边界：

- `kind: original`：原请求、任务/运行快照、原输入、模型结果、可选审批评审/决定、可选原订单结果分别读取；传入的 task/run 必须匹配原持久引用。
- `kind: settings`：复用 `settingsActions.read`，读取当前通知配置差异、原准备/提案/决定/业务回执和服务器持久 confirmation；不批准、不启动、不恢复、不写 Core。
- 任务元数据与事件水位继续由原 `AiTaskEventRepository.readSnapshot` 读取；游标保持字符串，跨业务读取标为 `independent_authorized_reads`，不伪称一个跨表原子快照。
- 返回统一标记 `submission: not_attested_by_approval` 和 `execution: read_only_no_start_no_reconnect_side_effect`；“已批准”不变成“业务已执行”。未知/不可用继续由原消费者返回，不以空结果或旧缓存补齐。

未提供正式输入、设置消费者、模型结果、审批或订单读取端口时保持 unavailable/not_requested；不接受任意 reader/tool 名称、URL或客户端权限。场景结果读取后重新校验原请求和当前任务修订，撤权/变更拒绝旧敏感结果。

## 定向验证

使用本树离线预加载：`DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline`，本树绝对 `AI_OFFLINE_WRITE_ROOT`、`AI_OFFLINE_AUDIT` 和临时目录；没有 .env、真实服务、数据库、模型或支付连接。

命令：

```text
node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='persisted scene model result|settings normal host starts' tests/ai-native-lane-a-original-scene-host.test.cjs tests/ai-native-plan-input-source.test.cjs
```

结果：`pass=2 fail=0 skip=0 todo=0 cancelled=0`，退出码0。实际覆盖原模型结果聚合、字符串大游标快照、原输入绑定、通知设置等待引用聚合、错 task/run、缺宿主、撤权拒绝；测试中的 `AI_RESOURCE_UNAVAILABLE` 为保留断言的预期拒绝诊断，不是失败。

API source-mapped `noEmit` 检查：`ROOTS=523 DIAGNOSTICS=0`，退出码0；`git diff --check` 退出码0。没有运行会读取 .env 的普通 build，也没有新增大测试脚本或全量回归。

## 未验与主线依赖

真实 HTTP/数据库/MySQL 一致性、模型、支付、浏览器/微信和生产模块仍未验。该聚合未注册路由/AppModule；主线接入时仍需显式提供原任务中心、settings、订单/审批/模型结果读取端口，并保留其各自 Guard/ALS 与授权复核。跨读一致性是顺序复验，不是跨源原子事务。Runtime/Provider SDK 仍不接入。
