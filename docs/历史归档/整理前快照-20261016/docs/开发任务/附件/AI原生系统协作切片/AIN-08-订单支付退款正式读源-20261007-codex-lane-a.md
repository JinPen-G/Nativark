# AIN-08 订单支付/退款正式只读源

基线e9c1709e。新增AiOrderPaymentFactsService并接到composeAiAuthorizedBusinessTools.orderPayments(serverOrderId)。宿主传已有PaymentRuntimeService，省略时CAPABILITY_UNSUPPORTED，不用空数组冒充已加载。

实际链：原订单Guard/ALS/getOrder→固定GET payment-intents原finance:view或finance:reconcile权限及资源范围→实际PaymentRuntimeService.listPaymentIntents→逐intent固定GET refunds与实际listPaymentRefunds→投影→两层读后身份复验。原Guard负责owner/地点，财务权限不能由普通order:view替代；caller不能指定URL、HTTP动作、tenant/workspace。未调用create/refresh/provider，不授予审批/权益或生产启用。

仅返回intentId/instrument/金额/币种/已有支付状态/有效期，以及refundId/原关联/金额/币种/原退款状态/时间。paid、funding_failed、pending、退款pending/accepted/funding_pending/succeeded/failed/closed保持不同；不从支付状态推算订单状态，不把受理变成功。押金/预授权与租金按原instrument区分。资金账本not_loaded、总额not_computed、local_records_not_provider_refresh；不把这些局部记录当完整实收或完整退款证据。URL/JSAPI/原始错误/客户原因/供应商外部ID不透传。

单次最多20支付单、每单50退款、总计100退款，超量拒绝而非截断，最多20次退款读。**这些是服务边界，不是DB行数上限**：原listPaymentIntents/listPaymentRefunds的findMany仍无take。请求主线在`apps/api/src/modules/integrations/payment.runtime.service.ts`新增有界只读重载/专用入口，参数tenantId/workspaceId/orderId、refund额外intentId及limit，保留requirePaymentIntent关联，take=limit+1、稳定createdAt/id排序、显式hasMore或拒绝；本线未改原服务。会员原无界查询补丁请求沿用上片记录。

一次定向冒烟：实际PaymentRuntimeService、Core和Auth/Guard，Prisma只读执行替身；正常状态/脱敏及关键财务拒绝，共2项；同次带前片装配冒烟2项。最终4pass/0fail/0cancelled/0skip/0todo，exit0；API tsc exit0；diff check exit0。未扩大全矩阵，深度竞争/撤权矩阵后补。

命令（A树）：

```powershell
$env:DATABASE_URL='mysql://offline:offline@127.0.0.1:1/rental_os_offline'
$env:AI_OFFLINE_AUDIT=(Join-Path (Get-Location) 'output/lane-a-payment-smoke.audit')
node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/ai-native-lane-a-order-payment-smoke.test.cjs tests/ai-native-lane-a-business-tools-smoke.test.cjs
exit $LASTEXITCODE
```

类型同环境，audit改本树绝对output/lane-a-payment-types.audit：
`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit','--incremental','false'];require('typescript/lib/tsc')"`。

未运行真实HTTP/DB/支付/模型/浏览器设备、全量回归或独立审计。缺依赖拒绝；本片没有修改shared、公共Guard、Core、schema或运行器，不代表AIN08或订单解释编排整项完成。
