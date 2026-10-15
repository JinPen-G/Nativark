# 订单费用依据的完整业务消费

开工原b8aefc55，分支ai/codex-ai-native-lane-a-20261007，tracked/index为空、无MERGE_HEAD/CHERRY_PICK_HEAD，仅原output未跟踪。按负责人强制要求先安全fast-forward固定5faa55a5d5bda3f3ce9e17c74feae23bc0fcda4e，实际HEAD同固定值，merge-base --is-ancestor退出0后才改功能。不追移动HEAD，固定历史带入的UI/shared/output等不属本片新增；全部保留。只修改本线tools/order-explanation-preparation.service.ts，不碰request-bound/model主干/Controller/module/公共执行或中央文档。

## 核查与唯一实现增量

原question范围已闭合status/fees/payments/next_steps，当前facts reader按history/payments/inspections选择读取；普通订单权限不继承finance。原费用准备已取得fulfillment（startAt/originalEndAt/effectiveEndAt/effectiveEndBasis及rental_period来源），但fees输出只order/amounts/history/inspections，导致原scene/model材料缺少实际当前租期依据。

现仅fees projection加入既有facts.fulfillment。实际composeAiAuthorizedBusinessTools.orderExplanationPreparation.prepare→tools.scenes.prepareOrderExplanation→既有原prepareTaskMaterial自动消费，无新增reader、包装服务、HTTP或共享DTO。当前租期与history原报价/规则/检查快照分别呈现，不推算租期费用、不把延期后的当前配置补为历史依据。现原orderSources最多五项，fees中order/amounts/fulfillment/history/inspections最多五来源，不放宽公共限制。

## 已有接线映射（复用，不重复计新增）

1. 当前最少事实：orderExplanationPreparation.prepare(question)→AiOrderExplanationFactsService.read的有限选择；status不取history/payment/inspection，fees取原history/inspection，payments用独立finance Guard及原有界本地PaymentRuntime；缺资金保持unavailable/not_loaded，无金额总计推导。
2. 历史来源：order.readHistoricalBasis→AiOrderSavedQuoteSource按同订单quoteId/当前受权scope取原快照；rule/price/template版本不符拒绝，缺历史保留missing等状态。orderExplanationPreparation.reopenCitation有限field/scope/order/version→同正式reader；原场景与artifact重开接点已有，未重写。
3. 再问/观察：orderExplanationPreparation.refresh重新prepare，只按原updatedAt字段比较，不建立第二历史/事件时间线。原Guard/ALS读后复验，资料不跨实例缓存。本片未扩原问题协议。
4. 人工材料：orderNextSteps.read/manualHandoff及原prepareOrderManualHandoff消费正式工具inventory；allowedActions仍unavailable/candidates_only，目的页面资源引用须再授权，不生成自动办理按钮/回调。原操作unknown由原quote/order receipt核对，不重发。
5. 开业：openingActions.recheck已重读正式readiness，未知/消失键cannot_determine而非resolved；readSection/prepareSections/prepareDifference仅原白名单候选，缺Core参加者不提交。notification无正式readiness分区，不借其他键执行，独立settings场景由主线维护。

## 实际验证与限制

一次inline驱动实际business-scenes.prepareOrderExplanation、RentalCoreService、AuthService/ApiAuthGuard/ALS、原事实/来源/refresh服务；订单/基础配置/支付DB执行为受控离线替身。状态问题inspection/payment读取0、输出无amounts；费用输出区分原endAt与effectiveEndAt，rental_period来源受权打开；无finance权限时payments.coverage=unavailable且无value，底层资金查询0；原订单updatedAt变后refresh反映版本改变，撤销会话拒绝。exit0。必要Compiler API noEmit（原场景模块/client-request入口依赖）0诊断/exit0，git diff --check0，无新改tests/fixtures，不虚报TAP计数。

实际命令：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际Core/Auth/业务scene来源断言>'；ts-node transpileOnly:false。DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT/TEMP/TMP为本树绝对路径，AI_OFFLINE_AUDIT=本树output/ca-order-source-20261015.audit。没有.env/网络/DB/模型/支付访问或共享生成，不把固定历史里的生成物当本轮执行生成。

未运行真实HTTP、MySQL、模型、设备/浏览器、完整A→B→A并发撤权/历史快照矩阵。本轮只证明业务scene消费正常与关键拒绝，不把未跑artifact模型全链写通过。检查记录原Core查询仍可能全量，AI输出max50不等于底层DB有界；若要规模验收需主线提供同order/scope的listInspectionsPage(tenantId,orderId,{limit,cursor?})及原当前Guard，本线不改Core。企业签约/付款独立资格和其他分区Core参加者缺失仍不可用。Runtime与Provider可替换边界不变：本片仅稳定业务材料/来源，不直接依赖SDK或运行器私有对象，不改Gateway/预算单账/审批。
