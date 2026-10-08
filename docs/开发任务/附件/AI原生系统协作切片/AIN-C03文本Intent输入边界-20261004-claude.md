# AIN C03 文本 Intent 输入边界（2026-10-04，进行中）

## 归属

施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，HEAD `1ddb7513`。开始前复核分支、未提交文件与上一轮记录一致；可达会话列表无其他活跃写入者（非全机进程排他锁）。本轮未派新 Codex 任务、未修改其树。此前路由/dispatch片仍未提交，独立审查接口失败不作通过证据，不重复派审。

## 实际代码

- 新增 `gateway-intent.ts`，使用已有 C03 draft-2 类型，严格验证 Agent-facing Intent，不修改 shared 契约。
- 拒绝注入 model/provider/baseUrl/config/context/credentialRef/authorizedToolRequests 等非 Intent 字段，以及未知版本、角色、内容字段和重复/冲突的能力声明。
- 服务端 policy 限定精确 sceneCode 和 maxOutputTokens 上限，调用方不能自行换场景或提升限额。policy 本身不是身份授权。
- 文本内容按原顺序拼接后再次使用现有内部 request 校验，防止多块文本绕过单消息总长度限制。输出不包含占位 model 或供应商地址，留给真实路由选择。
- 当前明确只准备 text/streaming。必需的 tools、structured_output、image、audio、embedding、reasoning 提前拒绝；附件即使对应 optional feature 也拒绝，不能静默丢弃。未启用 optional feature 列入 omittedOptionalFeatures，不标为 supported。
- stream 模式自动要求 streaming 能力，即使调用方漏声明也不会以 text-only 准入。

## 验证

`tests/ai-native-gateway-intent.test.cjs` 29/29通过，fail/cancelled/skipped/todo均0；API lint（tsc --noEmit）与git diff --check退出0，只有LF/CRLF提示。测试通过 prisma-offline-preload 与 blockNetwork 执行，未启服务或调用真实依赖。本轮未重跑完整AI Native套件；最近接线后全量基线为1421/1421，不能把29项简单相加冒称新全量通过。

## 仍未完成

本文件是严格输入准备器，**尚未接入 UnifiedAiGatewayService，也不是完整 AiGatewayPortDraft 实现**。公共结果的 actual/config/evidence 和 started事件必须从一次真实授权路由解析取得，不能为满足类型填假值。下一步将无model请求接入同一Gateway生命周期，绑定服务端scene与路由解析，保留单赢家/预算/授权复检；再补公共result/unknown/stream映射。客户/平台/automation桥接及完整预算交集仍待实现。真实Nest组合根、MySQL并发、真实模型、生产链路未验。
