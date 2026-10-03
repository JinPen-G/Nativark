# 真实 AiScope 记录解析（2026-10-04）

## 基线与所有权

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线10a25a0。开工只见已知保全patch。Codex树只读核对到b4d08b8（小程序配套在途），未合入或改写，没有再次派工或跨会话消息。

## 本片实现

新增只读AiScopeRepository.resolveCurrent，无调用方scope/tenant/workspace参数。必需的AiCurrentScopeAuthority从服务端绑定凭据重新解析C01上下文；schema合法不代表业务权限，仓储不提供默认授权器。

- 根据权威context生成已有length-prefixed canonical scopeKey，查询实际AiScope主键，不再在这个解析器中拼tenantId:workspaceId或使用platform-default。
- 支持platform/tenant/workspace，非空间分支不造workspace，缺记录明确资源不可用，不upsert或fallback。
- 查询前后重授权，比较主体、scope、权限、地点与自动化政策。仅requestId/authorizedAt允许刷新，其余改变丢弃缓冲数据。
- 对SQL查回字段逐字核对，防MySQL不区分大小写匹配被误当成完全相同scope；ID与字段损坏拒绝。
- 返回最少scope字段及刚重授权的context，无凭据/配置/供应商信息。失败脱敏，不自动重试。

## 验证

新增22项通过；联合task、router、usage settlement依赖回归176/176，0 fail/cancel/skip/todo，API noEmit通过。使用离线preload与无效DATABASE_URL，未访问DB、DNS、模型或支付，未启动服务。没有改schema/迁移、main或公共需求。

首次超长Bash写入被shell截断而未完成，改用专用文件工具后验证通过。代码为主Claude自查与自动化证据，没有独立审查报告，不冒称独立验收。

## 明确未交付

本片完成的是实际scope记录查询适配，不是AuthService/ClientAuthService的具体绑定，也未替换legacy Gateway的scope()。Gateway迁移须同时处理公共Intent/Port、双轨配置来源、当前主体与配置所有者范围，不能只替换字符串而保留权限绕过。后续主Claude继续接真实身份和这条调用链。

解析出的scope不是长期授权凭据，不授予模型调用、订单读取、确认审批或执行权限。未注册HTTP/AppModule/Worker，未宣布任何AI工具可执行。真库/真实供应商/设备仍未验；此轮176条局部回归不更新为全专项验收数量。
