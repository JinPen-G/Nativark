# 主线步骤登记与动作幂等（2026-10-03）

## 施工与所有权

开工确认主树 `D:/工作文件/rental-OS/.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，HEAD `12bc88a`。旧中央文档及保全patch仍是已知遗留，本片不纳入。会话列表无其他运行中的本树写入者；未发现新增来源不明改动。

Codex新增提交只做只读核验。负责人明确告知其尚未完成，并要求主Claude继续：本片不合入Codex在途内容、不另派任务、不发跨会话消息。主Claude是AIN-01～28主力，不以Codex是否交付为工作前提；等负责人明确通知其完成再处理下一批。

## 实现

- 新增 `AiStepRegistrationRepository`：命令只有taskId、registrationRef、task revision、lease。actionId/sequence/输入指纹/身份不能来自命令。
- 必需授权端口解析不可变服务端计划与Core输入指纹，严格C01上下文校验；本片不提供allow-all适配或模型自授计划引用。
- actionId按独立命名空间、scope、task和registrationRef确定性生成；不是Core业务幂等key。相同计划的inputRef/tool/version/fingerprint改变会冲突，不创建第二动作。
- 新登记在一个Serializable事务中：task锁与revision/cursor预留 → 有界步骤读取/总数及未决结果检查 → run锁/fence → 重授权及冻结输入比对 → 新时钟复验租约 → PENDING/NONE步骤创建 → step.registered事件追加。
- 每task最多1000步；同run序号由库中已有序号计算，不听取调用方序号。有RUNNING/UNKNOWN未决步骤不绕过它再注册新动作。
- 同action重放只返回原step/run/sequence/revision，不清unknown、不改原run、不追加事件、不刷新lease，也不代表允许dispatch；返回replayed=true、event=null、runRevision=null。模糊提交后显式重放仍找到原step。
- 当前C04未冻结草案新增独立 `step.registered` 事件分支（stepRevision只能1），shared类型、文档schema、轮询解码同时更新；不伪装成start，也未改变旧事件字段。没有已上线读者；若以后协议冻结，须按版本发布，旧读者不可假定认识新增事件。
- 提取 `task-contract-validation.ts` 复用C01/C04校验，步骤转换和登记均使用相同严格schema。同步校验只有返回true才通过，不把可能的Promise当成功。
- 组合测试实际串起登记仓储→现有步骤转换仓储→事件分页，读回registered/changed两条事件。这里只测试元数据链，不执行Core业务/模型。

## 验证

- 首次API类型检查发现Ajv类型返回可能为Promise，已显式要求返回true，未关闭类型检查。
- shared build通过；四文件定向190/190通过。
- 最终全量AI测试 **972/972通过，0 fail/skip/todo**；API noEmit、490 controller operations覆盖及490路由权限通过。
- 全测试和路由脚本用离线preload、固定无效DATABASE_URL；未启服务、未连数据库、未调用真实网络/模型/支付。
- Prisma schema/迁移与HEAD无差异。旧公共需求/进度文档未修改或提交。
- 本片为主Claude代码核对与自动化回归；未获得独立review报告，不冒称通过。测试含历史KNOWN GAP/descriptor，不是972个生产场景验收。

## 下一依赖与未验收

登记和转换仍需要真实请求身份、服务端计划/结果证据适配；这些关键关口由主Claude继续实现。必须经过权限、资源、Core结果核验，不能以C01形状或metadata lease替代授权。接着完成统一授权、审批持久化/消费、Gateway关键门、场景与多端，不将本片当AIN-01～28结项。

未注册HTTP/AppModule/worker，工具继续unavailable。真实MySQL并发/锁、业务提交同事务、设备、真实供应商均未验收；内存替身只执行真实查询谓词和模拟事务控制流，不声称证明数据库隔离。
