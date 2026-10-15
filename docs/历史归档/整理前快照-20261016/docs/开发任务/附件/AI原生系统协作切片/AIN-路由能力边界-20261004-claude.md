# AIN-05 路由能力边界（2026-10-04）

## 基线与所有权

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线a2f37e56。工作区仅已知保全patch。Codex80b0de99只读核对，在途工作未合入，不再派工或跨会话消息。不改main、schema、迁移、公共需求。

## 实现

- ProviderRouter严格解析scope三分支：tenant必须有tenantId，workspace必须有tenant/workspace，platform不得混入租户字段；未知scene/mode/能力或额外字段拒绝。
- tenant_managed不能以PLATFORM作为消费者；平台模式仅在明确传入的platform owner中查询，不跨scope或跨mode降级。
- requiredCapabilities非空、去重后语义必须明确；Profile能力声明与预检证据取交集，不允许预检单独扩大配置能力。
- 预检返回的required必须与请求一致，missing/stale不得出现无关能力；allowed=true同时missing/stale非空拒绝。
- 读取后复制Profile，传给预检的是副本；等待期间调用方更改scope/scene/要求，或端口改写模型/凭据参数，不能污染待返回快照。真正配置撤销仍需dispatch前复验。
- Profile列表有100项上限；无效记录、重复ID、缺少端口、错误响应拒绝。相同角色使用profileKey/ID稳定排序，角色优先策略保留；这不是运行时供应商故障转移。
- knowledge场景解释为知识回答生成，默认选择DEFAULT，不再把EMBEDDING当回答模型。独立向量生成场景仍需后续明确契约。
- legacy Gateway文本调用明确包含text；stream明确包含text/streaming及原请求tools/structured_output等能力。未知feature拒绝，不再落成默认tools。

## 验证与限制

原provider与组合fixture补齐真实tenantId字段，未放松断言。新增路由边界测试覆盖输入、角色、证据矛盾、配置能力交集、稳定顺序、突变隔离、跨范围及端口异常；首轮定向33/33通过。增加Gateway能力传播测试后纳入完整回归，下方补记结果。

本片不构成真实身份授权或dispatch租约，未接通完整AiGatewayPortDraft，也未移除legacy Gateway的占位scope/mode。配置revision和能力证据需在实际派发前重新确认；mock/live可信证据、持久化预算和派发单赢家仍需继续。

全部离线，不启服务、不连DB/模型/支付，不修改Core。未执行真库或真实供应商验收；独立审查未运行，本片是主Claude自查及自动化证据。

## 全量验证补记

全量AI1297/1297通过，0 fail/skip/todo；API和Admin noEmit通过。offline preload审计无外联/.env读取拦截记录，git diff --check通过。本片不以离线计数替代任何原任务整项验收。
