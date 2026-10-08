# AIN-05 流式终态发布顺序修复（2026-10-04）

## 基线与归属

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线 `0b13305`。工作区仅已知保全patch；Codex树只读核对仍为B07交接点1e0565f及两张旧截图。本片不接入在途辅助工作、不重派任务、不改main、schema、迁移或公共需求。

## 缺陷与修复

旧UnifiedAiGatewayService.stream在收到transport的result后立即yield，随后才结算用量和完成admission。于是调用方可先见成功，再遇结算失败；若消费者在result后return，清理分支反而把它记成unknown。

修复：

1. result只是终态候选，复制保存，不立刻发布；文本delta仍是非终态增量。
2. 候选后的重复result、额外delta或未知事件全部INVALID_RESPONSE。流必须自然结束，缺终态或候选之后源抛错不发布成功。
3. 派发前、源结束后、结算后、admission完成后检查取消；迟到候选不变成成功。
4. 只有源EOF、计量结算/未知计量记录、admission完成均成功，才在清理完毕后yield一次最终result。
5. 消费者中途return时取消transport signal并记录unknown；收到最终结果后return不会倒退完成状态。

## 验证

- 修复前定向11项：1通过、10失败，保留真实缺陷复现，不是descriptor。
- 修复后原11项通过；再补候选内容被源修改、结算/完成时取消、缺用量及补偿失败，共16项。
- 全量AI回归1169/1169，0 fail/cancel/skip/todo；API和Admin类型检查通过。
- 全量使用离线preload与固定无效DATABASE_URL，未启服务、未连接DB、模型或支付。数据库与transport均为明确替身，不宣称真实供应商或数据库并发验收。
- 首次Python编辑因Windows默认GBK读取含Unicode箭头的源码失败，未写入；改为显式UTF-8后测试通过，没有改动生产行为来绕过测试。
- 主Claude代码核对与自动化证据，未获得独立审查报告，不冒称独立Review通过。

## 未完成与下一步

本片不代表完整Gateway已经完成。当前类仍是内部legacy facade：真实scope解析与双轨路由、公共Intent/Port接线、dispatch单赢家、预算预留、全部await/iterator.return/清理的有界deadline均需继续。旧循环的for-await仍可能等待不合作迭代器，不能声称取消已能终止任意第三方实现。身份/预算/业务执行必须由后续真实端口保证，不依据本片提前启用工具。

本轮也未解决生产迁移部署链或审批业务原子消费；这些仍由主Claude继续。下一个优先切片是统一有界调用生命周期和真实scope/身份解析，辅助组件不作为前置。
