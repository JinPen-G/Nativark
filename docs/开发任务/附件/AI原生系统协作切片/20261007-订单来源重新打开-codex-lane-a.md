# 订单解释来源重新打开

前片 067c4acf。此片修既有调用链，不新增任务状态机或公共 API。

## 真实入口与行为

composeAiAuthorizedBusinessTools(...).orderExplanationPreparation(serverOrderId).reopenCitation(reference)。reference 除原 question/resourceType/resourceId/field，现必须带既有来源中的 scope 与 version；旧的仅 ID 引用拒绝，调用方需要重读来源。这是本线内部契约加严，未改 shared 或 HTTP DTO。

读取通过既有 AiOrderRouteContextAuthority 的实际 Guard/ALS，核对当前身份、资源、scope。相同订单 ID 在另一空间的引用拒绝。版本变化返回 stale 且不带事实值，不把当前配置/事实冒充旧依据。saved_basis/payment_records 只按选定来源分别加载历史/资金，原 Finance 权限不扩大。rental_period 直接消费真实 fulfillment 来源，修复原先被最小问题投影裁掉而始终 missing 的路径。

资金内容为当前本地观察，不声明订单 version 是支付全量快照版本，也不查询真实渠道。可选源 unavailable 与不存在历史来源保留原语义。来源再次打开不是持久化原请求、任务执行或业务授权凭证。

## 验证

红测：带 scope/version 的实际组合调用原实现拒绝 INVALID_REQUEST，pass 0 / fail 1 / skip 0 / todo 0，退出 1。修后首次组合 6/7，失败是测试预期 FORBIDDEN 与现有授权 adapter 统一 AI_ACCESS_DENIED 不同；断言改为实际明确拒绝码，未放松实现。

最终 node --test tests/ai-native-lane-a-second-batch.test.cjs tests/ai-native-lane-a-order-consumption.test.cjs：pass 7 / fail 0 / skip 0 / todo 0，退出 0。覆盖 scope 不同、旧版本、租期来源和会话撤销。API tsc -p apps/api/tsconfig.json --noEmit --incremental false：退出 0。git diff --check：退出 0。

所有 Node 使用 --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs；DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=D:/工作文件/rental-OS/.claude/worktrees/codex-ai-native-lane-a/output/lane-a-resume-audit.jsonl。数据库/配置执行为离线替身，权限走实际 Auth/Guard 实现；无真库、HTTP、模型或生产验收。

## 队列与阻塞

HEAD 以后续本片提交为准；本轮未继承未知 WIP，未修改其他施工树。原请求→任务创建仍受前片所列持久模型与正式场景授权来源阻塞；批准建单输入组合在主线存在但须固定依赖提交和正式接口才可装配；公共 API 缺冻结原请求 DTO。未完成部分没有以本轮修复或测试计数代替。保留既有功能、output、历史。
