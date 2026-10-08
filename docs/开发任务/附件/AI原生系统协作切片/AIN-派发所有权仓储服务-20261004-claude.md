# AIN 派发所有权仓储与服务边界（2026-10-04，进行中）

## 归属与基线

唯一施工树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，HEAD `1ddb7513`。前一片路由接线改动仍未提交，恢复时文件归属与记录一致。可达会话列表未显示其他活跃写入者；这不是操作系统级排他锁。Codex 树只读核对 HEAD `7eefc006`，仅有两张旧截图未跟踪；按用户明确要求在对话交付 B12 三端离线验收与接入契约任务，未直接跨会话发送。

## 本轮实际实现

- 新增 `InvocationDispatchService` 与严格的 dispatch binding schema，绑定 admission id、消费者 scope、actor、callId、requestHash、profileId 和 dispatchId。
- `PrismaAdmissionRepository.claimDispatch` 在有界 Serializable 事务内，以全部绑定字段、admitted 状态、空 dispatchId、未撤销/未完成和 expiresAt 条件执行 updateMany CAS。保留现有状态枚举，以 admitted + 非空 dispatchId 表示已被领取；不改 schema 或历史迁移。
- 同一 token 也不能再次领取。领取应答丢失只能返回 ACCOUNTING_PENDING，不因重读到 token 就再次发放派发权。
- `finishDispatch` 仅接受匹配 token 的 admitted 行，转 completed/cancelled/unknown；不允许未知状态自动重派或自动 reconcile。已拥有调用的计量收尾不因 admission 到期而无法执行。
- 旧 transition 禁止写 dispatchId，且拒绝处理已经带 token 的记录，避免无 token 补偿路径越过新所有权边界。
- 仓储 readback 和服务 readback 均校验绑定。输入在异步边界前复制。

## 验证与审查

- 新增离线测试驱动真实 PrismaAdmissionRepository 和 InvocationDispatchService，Prisma delegates/事务为内存模拟；16 个并发请求验证单赢家、重复 token、绑定字段不符、到期/撤销、应答丢失、错误 token 收尾、旧接口绕过、畸形输入、输入突变。
- 三套 admission/dispatch 定向测试：51/51 通过，fail/cancelled/skipped/todo 均 0，退出 0。
- API lint（tsc --noEmit）和 git diff --check 均通过；组合命令已进入随后全量测试，只有既有 LF/CRLF 警告。
- 第一次全量测试因后台时限设为 120 秒被终止，不作为全量通过证据。随后以 600 秒时限重新运行（任务 bpluneh5j），已收到完成通知并核对输出：1413/1413 通过，fail/cancelled/skipped/todo 均 0，退出 0。
- 定向、首次全量、全量重跑三个 AI_OFFLINE_AUDIT 路径均不存在，未记录被拦外联或 .env 读取。完成后复核分支仍为指定专项分支、HEAD 仍为 1ddb7513，工作区归属与本轮记录一致。
- 前一片路由独立审查因审查模型接口 HTTP 400 提前失败，无审查结论。未重复派审，未冒称审查通过；当前不提交这两片。

## 后续接线进展（同日）

- UnifiedAiGatewayService 的 invoke/stream 现已在 usage.reserve 前调用 dispatch.claim，token 由服务端 randomUUID 生成。缺失 dispatch 端口时拒绝，不降级为旧路径。
- claim 成功后才记录本尝试拥有清理权；重复调用输家不预留、不传输、不取消赢家。未领取的迟到 admission 留给持久状态/到期处理，不能无 token 取消。迟到领取成功通过原 token 执行有界取消。
- 正常完成及异常/消费中止均走 dispatch.finish 完整绑定；旧 admission.transition 不再用于 Gateway 清理。领取与收尾都使用 GatewayDeadline，保持既有共享 cleanup 时限。
- 既有生命周期测试用显式 synthetic dispatch fixture 保留原观察点，它不是 CAS 证明。新增组合直接调用真实 InvocationDispatchService 与 PrismaAdmissionRepository（事务/delegates 仍为内存模拟），覆盖 invoke/stream 并发输家不污染预算、应答丢失不派发、迟到领取仅清理自己的 token。dispatch 文件现为27/27，退出0。
- 五套接线/生命周期/真实路由回归及 API lint 的组合命令退出0。新增 claim 挂起的 invoke/stream deadline 用例后，全量回归 bfta3qhhs 已完成并核对输出：1421/1421通过，fail/cancelled/skipped/todo均0；此前串行执行的API lint与git diff --check亦退出0。前文1413/1413为接线前基线。
- 用户陆续通知 B13 首片 b032f52a 已交付；只读核对 HEAD 与两张旧截图后，交付 B14-A～F 长批任务（真实页面/双轨配置/任务恢复/来源知识/提案展示/离线验收），明确连续执行、默认关闭、核心保留主线。客户端法律页36/37静态检查为Codex报告的阻塞，未冒称本线已复验。

## 未完成与下一步

当前内部 workspace Gateway 已接线单赢家领取，但尚未做真实 MySQL 并发验证，也未具备公共C03全身份支持、实际Nest组合根或完整预算限额。下一步核对接线后完整回归，补充计量/完成应答丢失和完整调用指纹冲突边界，然后进入公共 Gateway Intent 映射与预算交集。

未运行真实 MySQL 并发、迁移、真实授权 composition root、模型、支付、浏览器或微信宿主验收。内存事务序列化不是 MySQL 锁行为证明。不启服务、不读 .env、不推送、不合 main、不生产启用；AIN-01～AIN-28 尚未整体交付。5 分钟心跳 0f6f70c1 已查询确认仍存在。
