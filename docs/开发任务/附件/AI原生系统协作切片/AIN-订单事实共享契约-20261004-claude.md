# AIN-02/08 订单事实共享契约（2026-10-04）

## 基线与范围

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线00de3e19。开工只见已知保全patch；Codex新提交773aa34b只读核对，未合入、未代派工或跨会话消息。不改main、公共需求/任务文档、schema或迁移。

## 实现

新增唯一shared导出的AiOrderReadFactsDraft与AI_ORDER_FACTS_DRAFT_SCHEMAS，独立草案版本ain-order-facts-draft-1。表示最小当前订单事实，不是完整订单解释结果，也不是实际支付证据。

- 固定operator/staff与workspace范围；只允许既有Core订单状态。
- 明确原结束/当前结束日期及effectiveEndAt/endAt_fallback来源。
- 金额保持Core数值，有限非负且不超过安全整数上限；缺失为null，不能省字段或以0代替。
- 只包含一个当前订单来源引用，支付和历史费用证据固定not_loaded，不能伪造paid/verified。
- 所有对象闭合；个人资料、内部字段、模型原文等额外字段拒绝。
- AiOrderReadFactsService显式返回共享类型，带新draftVersion；日期和数值的生产者边界与schema同步。不改工具目录成熟度，不添加HTTP路由。

JSON Schema使用type:[number,null]。OpenAPI 3.0转换器新增精确的单类型+null映射到type/nullable:true；非nullable多类型联合、重复null或更多类型仍拒绝。既有不支持string/number联合的负例保留，并新增raw与OpenAPI nullable语义一致性验证。

## 已执行验证

- shared build和API类型检查通过。
- 实际Auth/Guard/Core读取输出，同时通过共享schema和发布OpenAPI schema；缺失证据、越权身份、错误范围、额外字段、非法值及来源数量均有拒绝例。
- 定向44/44通过；490 controller operations及490路由权限检查通过。
- 全量结果在下方补记，不用定向数冒充全量。测试使用offline preload与固定无效DATABASE_URL；无模型/DB/支付访问，无服务启动。

## 未验收

契约仍未正式冻结，不等于可执行工具上线。来源与订单ID/scope的语义绑定由实际读取服务保证，schema只验证结构；客户端不能凭构造一个合法JSON取得访问权。

支付/资金状态、历史报价与规则依据、完整模型解释、客户及平台身份分支、API/worker接线仍需后续实现。真数据库/设备/模型未验收。独立审查未运行，本片记录主Claude代码核对与自动化证据。

## 全量验证补记

完整AI1268/1268通过，0 fail/skip/todo；API与Admin noEmit通过。全量及路由验证audit无外联/.env读取拦截记录。git diff --check通过；全部变更仅属于本片契约、读取服务、验证器和测试。
