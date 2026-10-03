# AIN-05 网关有界等待（2026-10-04）

## 基线与范围

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线8f1c786。开工仅已知保全patch未跟踪。只改主线Gateway生命周期、测试与本记录；不改main、schema、迁移、公共需求或其他工作树。

## 实现

- 新增GatewayDeadline：单调时钟控制总执行期限；wait在调用前和完成后校验，并与停止信号竞速。不能仅给不合作端口发AbortSignal然后无限await。
- invoke/stream的路由、准入、预算预留、审计、模型、计量与完成状态共用总期限。准入和预留的expiresAt取同一开始时刻的deadline，不在后面阶段重置。
- 手动推进流迭代器，next经有界wait；异常/取消后return经有界cleanup，不因第三方return永不完成挂住请求。
- 清理共用250ms总宽限，不给每个清理动作重开完整超时。信号/定时器结束时释放；仍未完成的第三方Promise保留异常观察，不成为未处理rejection。
- 中止原因取最早一次，取消不会后来变成超时；业务失败码在清理前固定，不因清理期间到期篡改原始错误。
- 准入/预留异步完成晚于请求结束时，尝试有界取消准入或将迟到预留记为LATE_RESERVATION；绝不继续dispatch、不按零消费释放。清理预算耗尽或存储拒绝时保留原记录，依赖后续持久化过期扫描/核对，不承诺补偿必然完成。

## 实际验证

- 新增21项测试；与流式发布测试组合37/37通过。
- 覆盖invoke/stream各阶段不合作Promise、取消等待、迟到准入/预留、next/return挂起、清理挂起、清理共用预算和首次中止原因。
- 首次定向发现清理超时覆盖了之前transport失败码；固定进入catch时的错误再清理，复跑通过。TypeScript闭包捕获可选值的错误以快照常量修复，没有关闭类型检查。
- 全量AI1190/1190，0 fail/cancel/skip/todo；API与Admin noEmit通过。全部使用离线preload，未启服务或访问真实模型、DB、DNS、支付。
- 本片为主Claude自查和自动化证据，未获得独立Review报告，不冒称独立验收。

## 未完成与限制

有界等待不等于远端操作终止，也不能抢占阻塞JavaScript事件循环的同步死循环。消费者暂停在yield且从不继续/return时，信号会到期，但生成器收尾仍需后续消费驱动；生产流宿主必须传递断连/取消。

本类仍是内部legacy facade，尚有硬编码模式/scene与占位scope。真实身份/scope解析、公共AiGatewayPortDraft接线、dispatch单赢家、预算完整预留和持久化过期恢复是后续主Claude核心任务。没有启用Controller/AppModule/worker，不将当前类直接暴露给模型或客户端。

## 夜间辅助工作

负责人明确报告B08交接30e4d104dcab3dcce6b678695ede496560730b5b（员工构建通过，客户端legal页shared运行时导入仍阻塞）。已在对话派B09共24个连续配套里程碑，包括限定的客户端构建修复、两端实际组件交互与回归；仍禁止改主线安全/业务核心。辅助不需等待本片；完成后由负责人转交，不能靠新提交推断已完成。

心跳01cc7af2已核对仍在，每小时7/27/47分触发。运行环境不可用时不保证执行，循环最多7天；用户叫停则取消。保持整个AIN-01～28范围，不以本片完成宣布专项完成。
