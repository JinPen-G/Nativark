# AIN-10-LB41：知识、偏好与业务事实分区

## 实现

- 在既有知识上下文包中增加显式 `sections` 语义：知识仅来自本次受权来源，偏好仅是可选的已确认结构化投影，业务事实必须由 Core 权威端口提供。
- 不把订单、价格、库存、付款或资格读入知识索引；`businessFacts: core_authoritative_only` 只是边界标记，不是伪造的事实内容或权限。
- 复验入口接受并保留该分区标记，同时兼容没有该标记的旧包并在复验结果中补回明确分区。

## 验证

既有 `tests/ai-native-knowledge-lane-b-input-composition.test.cjs` 实际组合断言扩展，使用离线真实知识/Memory服务门面：1 test 文件内 1 主流程 + 1 回归分支通过，退出码 0。

## 未验与阻塞

Core 业务事实生产者、真实 Memory/Knowledge 授权和模型冻结仍由主线提供；本分区不构造事实、不授予权限、不触发 Gateway。
