# CA08 客户费用检查只读消费

接续19f65662，仅在A树完成真实客户端已存在的`GET /client/v1/orders/:id/fee-items`消费；未接客户回应POST、支付或退款。

## 实际功能

`composeAiClientScenes`扩展可选`member.feeItems(orderId)`：请求仍经过现有ClientAuthService/ApiAuthGuard/ALS、本人订单归属和发布workspace复核，不接受operator token或模型提供的租户。缺少正式feeItems端口时保持能力不可用，不以订单金额推断异常费用。

`composeRequestBoundClientApplication.readOrderExplanation(request,{orderId,question:'fees'})`现在组合读取本人`ClientOrderView`和正式`feeItems`结果。只读投影保留检查阶段、异常码/说明、已批准金额、币种、客户响应状态和证据数量；不执行客户确认/异议，不读取内部附件、操作人或其他客户。`status`问题仍不读取金额/费用；金额零值与缺失值分开。付款、退款、历史报价和允许动作仍显式缺口。

## 快检

没有新增测试脚本，扩既有`client scene authenticates`实际组合。首次快检因正式响应含`apiVersion`而投影schema拒绝，修为已知版本字段+白名单字段校验并保留未知键不透传；修后定向1pass/0fail/0skip/0todo，退出0。覆盖本人订单、费用检查结果、零金额、费用缺失、未加载付款退款、注销后拒绝；不覆盖真实HTTP或Core数据库。

命令：

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='client scene authenticates' tests/ai-native-lane-a-original-scene-host.test.cjs`

固定DATABASE_URL为`mysql://offline:offline@127.0.0.1:1/rental_os_offline`，审计为本树`output/ca08-client-fees.audit`，TEMP/TMP为本树output。API源码noEmit=0诊断退出0（`output/ca08-client-fees-types.audit`），`git diff --check`退出0。

## 边界与主线依赖

客户检查费用是已批准记录的只读呈现，不代表应收/已收、责任或最终结算；客户响应仍须现有正式POST和业务幂等。真实`ClientApiService.feeItems`底层复用Core `listInspections`，该查询的take/cursor边界缺口仍在主线，不以客户端投影上限冒称数据库有界。尚未验证真实MySQL/HTTP/支付/模型/浏览器/微信/设备/生产。
