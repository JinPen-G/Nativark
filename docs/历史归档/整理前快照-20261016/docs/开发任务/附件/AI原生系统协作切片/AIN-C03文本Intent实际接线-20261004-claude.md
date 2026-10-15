# AIN C03 文本 Intent 接入既有 Gateway（2026-10-04）

## 基线、范围与归属

唯一施工树 `.claude/worktrees/claude-ai-native-foundation`，专项分支 `ai/ai-native-contracts-s01-20261002`。路由/dispatch及B06–B14整合基线338a3c4c；本轮离线入口修复单独提交91b9d187。所有本片变更为主Claude，Codex只负责另外的三端/评测配套，未写其树。

## 实际实现

- UnifiedAiGatewayService新增invokeTextIntent/streamTextIntent：输入消费已有C03 draft-2，不需要model/provider/baseUrl。与现有invoke/stream共享同一内部生命周期，不新增第二套派发或计量。
- 服务端构造时提供严格sceneCode/routeScene/maxOutputTokens绑定；绑定复制并冻结，未配置不启用桥接，实际路由scene不符在admission与预算前拒绝。
- 模型只由真实路由profile补入，输入策略不填占位模型。原内部ModelRequest入口保持兼容，不修改shared公共类型。
- 指纹包含完整原始Intent及invoke/stream模式、服务端场景policy和现有真实路由绑定。即使合并文本后相同，原始块、必需/可选能力或场景变化也不会落到同一个调用指纹。
- 纯文本Intent严格验证返回值，只允许text、合法reported usage及空toolRequests。未请求的工具/结构化结果或私有额外字段拒绝为INVALID_RESPONSE，在已派发情况下保留未知收尾，不能写完成或公开泄漏。
- stream桥接yield*复用既有清理、截止时间和最终发布顺序；消费者提前return后不发布完成结果。异步路由期间输入/身份变更不能替换已复制的调用。

## 验证

- 定向首轮117项：116通过、1失败。失败来自新增测试在GatewayDeadline微任务进入路由之前调用未赋值release，已用受控ready Promise修正，不修改生产逻辑迎合时序。
- 最终整合前AI Native全量任务b95o5sp4b：1721/1721通过，fail/cancelled/skipped/todo均0，退出0；随后API lint（tsc --noEmit）和git diff --check退出0。
- 执行node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test --test-concurrency=1 --test-reporter=tap，固定端口1离线DATABASE_URL。新增Intent组合使用真实Gateway，routing/计量为明确内存替身；真实dispatch仓储组合由独立文件回归。
- 没有新的独立Review通过结论，不反复派审。仅主Claude自查和自动化证据。

## 尚未交付

这是**workspace/user内部桥接**，不是完整AiGatewayPortDraft实现。public actual/config/evidence、完整AiExecutionContext复核、public started/terminal/unknown映射、客户/平台/automation支持仍须实现；不伪造live证据或config元数据。工具和附件请求保持不支持。真实Nest组合根、MySQL并发、模型、支付、浏览器/微信宿主/生产均未验。本次不变更公共进度为整项完成。

下一步先整合用户新交付的B15/B16固定提交并重跑产物与行为回归，然后继续预算限额/持久化及公共Gateway结果接线；B17–B19活动代码不提前合入。
