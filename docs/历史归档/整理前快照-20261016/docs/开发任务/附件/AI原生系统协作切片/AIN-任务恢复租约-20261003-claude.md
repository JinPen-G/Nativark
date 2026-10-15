# 任务等待与取消中的恢复租约（2026-10-03）

## 实现

`AiTaskRepository.claimRecoveryRun` 补齐 WAITING_INPUT、WAITING_CONFIRMATION、WAITING_EXTERNAL 和 CANCEL_REQUESTED 任务的原run租约重新获取。普通 `claimRun` 仍只允许 QUEUED/RUNNING，不因新增恢复入口放宽执行入口。

- 通过单个真实Prisma `aiRun.updateMany` CAS绑定task/run ID、task/run revision、原fencingToken、完整scope/owner/audience及自动化政策条件。
- 只接管已到期或已释放的租约，拒绝还有效或仅有一半字段的租约；恢复不能使用0号fence。
- WAITING分支必须没有取消标记，CANCEL_REQUESTED必须有取消标记。原任务的取消时间、状态、revision、事件游标、步骤身份/指纹/结果均不改。
- 只提升run revision和fence、设置新holder及当前主体审计；返回 `purpose: recovery_only`，是调用方路由提示，不是执行授权。
- 恢复和普通claim都拒绝非当前C04 contractVersion。未知结果仍须Core核对，不能通过新run/action/key重发。
- 新增内部授权操作 `claim_recovery_run`；真实应用授权适配器接线时必须显式检查，不允许从普通read权限默认放行。
- 提交确认不明只返回 `AI_STORAGE_UNAVAILABLE`，不自动重试，也不承诺数据库已经回滚。

## 实际验证

- `node --check tests/ai-native-task-recovery.test.cjs` 通过。
- 六个 `tests/ai-native-task*.test.cjs`：118/118通过，0 fail/cancel/skip/todo，涵盖原C04决策、创建、事件、状态事务、租约以及新增恢复。
- 全量API TypeScript noEmit通过；`git diff --check`通过。
- 测试使用preload离线护栏与固定无效DATABASE_URL，无外联/.env读取拦截记录。
- 新测试替身实际执行生产生成的查询谓词，覆盖四种等待/取消、五种主体/audience、外租户/空间/owner、活跃和半残租约、旧协议、终态、取消竞争、CAS单赢家、旧holder释放失败、自动化政策变化、模糊写确认；scope谓词变异会破坏隔离oracle。
- 首轮新增测试替身少一个对象闭合括号导致SyntaxError，已修复后重跑上述118项；没有修改生产逻辑或移除断言来绕过失败。
- 独立agent基础设施仍无有效报告，本轮记录主协调者代码检查与自动化证据，不冒称独立审查通过。

## 边界

这是恢复租约基础，不是已上线的自动恢复worker：不注册Controller/AppModule/Cron，不自动扫描所有租户，不执行模型或业务工具，不自动完成/撤销订单，不隐含已获得输入/审批。后续worker取得租约仍须重新读任务/步骤、当前授权、逐步fencing，并通过现有状态机决定是否可resume；取消中的未知动作只能继续核对。

未改schema、迁移、公共shared/OpenAPI或Codex网关/知识代码。MySQL并发、业务提交幂等、真实HTTP Guard组合及运行器接线仍待后续，不把查询替身当真库验收。Codex继续独占B02新Profile/用量/知识模型的Prisma整合写入权。
