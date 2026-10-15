# AIN-04 订单只读真实身份接线（2026-10-04）

## 基线

唯一施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，HEAD 8991d12。开工只见已知保全patch；Codex在其树推进B09，当前fa1e98e只读核对、不合入、不直接消息。未改main、公共文档、schema/迁移。

## 实现

新增 `AiOrderRouteContextAuthority`，作为订单只读场景的AiCurrentScopeAuthority具体适配器：

- 每次从服务端绑定的credential source取当前Bearer凭据及预期operator/staff入口身份，禁止额外scope/actor字段。
- 为固定GET订单读取路径建立新ExecutionContextHost，实际调用既有ApiAuthGuard；由其调用现有AuthService验证签名、当前会话、成员状态和有效workspace，不复制JWT/权限算法。
- 每次在独立runWithRequestIdentity({})中运行，不能继承父请求的管理员或其他租户身份，也不污染父上下文。
- 只有Guard明确返回true，且request.user和Guard生成的ALS身份一致、存在有效workspace时，才从实际权限、dataScope及解析后的locationScope投影C01上下文。
- SaaS不能通过租户订单读取入口，client/automation令牌不能代入本片operator/staff入口。路径只由严格orderId组成，拒绝路径/查询注入及大小写变体的保留操作名。
- 返回中不含Bearer/token或原始Auth错误；每次resolve重新跑当前授权。
- 已组合真实Guard上下文→AiScopeRepository→真实scope ID查询；在读取scope期间撤权会丢弃缓冲结果。

## 验证

- 新增18项，实际AuthService签名/解析和ApiAuthGuard执行，只有会话/用户/数据库读取与配置密钥提供者使用合成替身。
- 覆盖operator/staff正例与错audience、失效会话/成员/账号、撤权、无workspace、SaaS拒绝、JWT旧wid不覆盖会话、own/地点约束、父ALS隔离、并行主体隔离、scope组合后二次撤权。
- 全量1230/1230，0 fail/skip/todo；API/Admin noEmit通过。自查加入保留路由名大小写负例后，定向18/18再次通过。
- 测试导入前加载offline preload，未访问.env/外网/DB/模型/支付；无拦截记录。未启动服务。长Bash写测试命令截断未成功，使用专用文件工具完成，没有关闭类型校验。
- 主Claude自查与自动化证据，不声称独立Review通过；真实数据库会话撤权和HTTP宿主链未验。

## 不能误解为已完成的部分

这是固定订单GET路由的身份投影，不是订单正文读取器或AI场景授权。Guard对全范围用户不一定读取订单正文；实际工具必须继续通过Core检查资源存在/归属与字段裁剪。本片不能拿读取context批准写操作或修改订阅/工具成熟度。

未自动注册Controller/AppModule/worker，credential source必须由未来可信请求/任务入口绑定；不存储长期Bearer，不让模型传凭据。真实ClientAuth、SaaS平台任务、租户非空间对象、automation政策及其业务入口仍需对应适配，不能假借本片完成。

下一步主Claude继续订单事实读取和受控工具输出、公共Gateway真实scope/双轨接线、审批消费与dispatch单赢家；既有AI工具保持unavailable直至完整验收。主线不等待辅助批次完成。
