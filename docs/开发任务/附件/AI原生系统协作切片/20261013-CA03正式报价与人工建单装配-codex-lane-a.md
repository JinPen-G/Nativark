# CA03/04 正式报价与人工建单装配

基线：048ac0941bd13fb0674e01cb9be0492ba6628e78 后同步固定 f59ecabb41325e6553ea8c5de2b650e60cc47ef7，merge 67d1a68ea7f104f33e2f02cc0de1c5ac0bc27cfb。只改本线 original-scenes.module.ts，不改核心、shared、tests 或 fixtures；output 全部保留。

新增实际入口 `AiOriginalScenesModule.registerHttpQuoteFlow(dependencies, options, business)`：组合原 registerHttpPersistedModel 与已有 AiHumanQuoteSelectionModule.registerHttpTask。前者提供当前请求身份下的原请求、原报价审阅/确认/原键收据和持久模型澄清；后者提供真实人类选择、原提案审阅/决定、原建单任务/等待/继续/核对/结果。没有新状态机、批准旁路、派发器或账本，不自动注册生产。

仅 quote_clarification 同版本，且两个依赖组共用 db/auth/guard/core/subscriptions 时允许装配；不能将原订单解释三步选项混入报价链。参数均服务器提供，公开请求仍用原 Controller/契约；确认报价不等于批准建单。审批/Core 当前动作和 immutable selection 绑定留在原服务执行，本模块不发放权限。

## 实际验证（离线）

固定无效 DATABASE_URL、原 prisma-offline-preload 和 lane-b-local-runtime；write root/audit/TEMP/TMP 全部本树。没有新增/修改脚本。

- Compiler API 内联 noEmit，根 original-scenes.module.ts，API tsconfig + 本树 shared 源及隔离 Prisma 声明：0 diagnostics，exit 0。
- 一次内联冒烟及失败修正：调用实际动态模块所有 provider factory、实际原请求根 reviewQuote/confirmQuote/readQuoteReceipt。登记阶段未增加 task/selection/approval，无模型发送。首先错读 review.result/provider 次序，以及合成默认候选不完整，均修冒烟命令，不改生产拒绝逻辑。
- 完整候选的 prepare 保持实际 availability unavailable；正式 Core 原操作报价调用返回 unavailable + quotePersistence=unknown + retryable=false + reconcile，未产生假审批或库存预占。原键读取当前离线 store 缺接口，被既有 route 边界映射 FORBIDDEN。正向报价/收据断言失败保留，不能将拒绝路径冒烟视为报价成功。
- 已确认该旧夹具的 absorbing business fact store 没有 findQuoteForOriginalOperation/saveQuoteForOriginalOperation/findQuoteForOriginalReference；正式 RentalBusinessService 对缺方法明确拒绝。没有给它补假成功，也没有修改 fixtures。正式宿主需注入既有 RentalBusinessFactStore 的这三个持久方法，才可验证原操作正向和应答不明读取。
- 当前权限撤销和跨依赖 db 拒绝由直接调用检查；没有执行真实 MySQL、HTTP、模型、支付、迁移或 AppModule 启用。

## 未完成与下一步

本包只是实际消费者统一装配，不是报价→人类选择→审批→Core 建单全正向验收。财务配置、可信计价和完整原操作持久 store/approval policies 仍需合法宿主提供；不足保持 unavailable/unknown，不重新创建报价。后续优先核验原请求/明确选择/原审批执行衔接断点，不扩展示、导航或风险包装；公共核心缺口给主线精确方法及调用位置。
